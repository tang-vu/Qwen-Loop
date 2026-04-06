import { LoopConfig, LoopStats, ProjectConfig, AgentConfig, AgentType, TaskPriority, TaskStatus, HealthReport, AgentHealthStatus, Task, IAgent } from '../types.js';
import { LoopManager } from './loop-manager.js';
import { QwenAgent, CustomAgent } from '../agents/index.js';
import { logger } from '../logger.js';

/**
 * Manages multiple projects, each with its own LoopManager.
 * Cycles through projects sequentially, processing tasks for each.
 */
export class MultiProjectManager {
  private projectManagers: Map<string, LoopManager> = new Map();
  private projectConfigs: Map<string, LoopConfig> = new Map();
  private projectNames: string[] = [];
  private currentIndex = 0;
  private isRunning = false;
  private loopInterval: NodeJS.Timeout | null = null;
  private globalConfig: LoopConfig;

  /**
   * Creates a new MultiProjectManager instance.
   *
   * @param globalConfig - The global configuration that defines default settings for all projects.
   */
  constructor(globalConfig: LoopConfig) {
    this.globalConfig = globalConfig;
  }

  /**
   * Initialize all projects from the global configuration.
   * Sets up LoopManager instances, agents, and orchestrators for each configured project.
   *
   * @throws Error if no projects are configured in the global config.
   */
  async initialize(): Promise<void> {
    if (!this.globalConfig.projects || this.globalConfig.projects.length === 0) {
      throw new Error('No projects configured. Use single-project mode instead.');
    }

    logger.info(`Initializing ${this.globalConfig.projects.length} projects...`);

    for (const projectConfig of this.globalConfig.projects) {
      await this.addProject(projectConfig);
    }

    logger.info(`All ${this.projectNames.length} projects initialized`);
  }

  /**
   * Add a new project to the manager.
   * Creates a LoopManager, initializes agents, and registers them with the orchestrator.
   *
   * @param projectConfig - Configuration for the project including name, working directory, and optional agent overrides.
   * @throws Error if projectConfig is null/undefined or if project name is empty.
   */
  async addProject(projectConfig: ProjectConfig): Promise<void> {
    if (!projectConfig) {
      throw new Error('Project configuration cannot be null or undefined.');
    }
    if (!projectConfig.name || projectConfig.name.trim().length === 0) {
      throw new Error('Project name must be provided and cannot be empty.');
    }
    if (!projectConfig.workingDirectory) {
      throw new Error(`Project "${projectConfig.name}" is missing a working directory.`);
    }
    const projectLoopConfig = this.buildProjectConfig(projectConfig);

    const loopManager = new LoopManager(projectLoopConfig);

    // Create agents for this project
    const agents = projectConfig.agents || this.globalConfig.agents;
    for (const agentConfig of agents) {
      const fullAgentConfig: AgentConfig = {
        ...agentConfig,
        workingDirectory: agentConfig.workingDirectory || projectConfig.workingDirectory
      };

      let agent;
      switch (agentConfig.type) {
        case AgentType.QWEN:
          agent = new QwenAgent(fullAgentConfig);
          break;
        case AgentType.CUSTOM:
          agent = new CustomAgent(fullAgentConfig);
          break;
        default:
          logger.error(`Unknown agent type: ${agentConfig.type} for project ${projectConfig.name}`);
          continue;
      }

      loopManager.getOrchestrator().registerAgent(agent);
    }

    // Initialize agents
    await loopManager.getOrchestrator().initializeAll();

    this.projectManagers.set(projectConfig.name, loopManager);
    this.projectConfigs.set(projectConfig.name, projectLoopConfig);
    this.projectNames.push(projectConfig.name);

    logger.info(`Project "${projectConfig.name}" added (working dir: ${projectConfig.workingDirectory})`);
  }

  /**
   * Start cycling through all projects sequentially.
   * Begins processing tasks from the first project and continues round-robin.
   *
   * @throws Error if no projects have been initialized before starting.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Multi-project loop is already running');
      return;
    }

    if (this.projectNames.length === 0) {
      throw new Error('Cannot start multi-project loop: no projects initialized. Call initialize() first.');
    }

    this.isRunning = true;
    this.currentIndex = 0;

    logger.info(`Starting multi-project loop with ${this.projectNames.length} projects`);
    logger.info(`Projects: ${this.projectNames.join(', ')}`);

    // Start with first project
    await this.processCurrentProject();
  }

  /**
   * Stop all project loops and clean up resources.
   * Halts task processing across all managed projects and clears the scheduling interval.
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }

    // Stop all loop managers
    for (const [name, manager] of this.projectManagers) {
      if (manager.isRunning()) {
        await manager.stop();
        logger.info(`Stopped project "${name}"`);
      }
    }

    logger.info('All projects stopped');
  }

  /**
   * Get combined health report across all projects.
   * Aggregates agent health, task throughput, and priority/status breakdowns from all managed projects.
   *
   * @returns A comprehensive HealthReport covering all projects.
   * @throws Error if no projects have been initialized.
   */
  getHealthReport(): HealthReport {
    if (this.projectNames.length === 0) {
      throw new Error('Cannot generate health report: no projects have been initialized. Call initialize() first.');
    }

    // Combine stats from all projects into a single health report
    // Use the first project's health checker as the base
    const firstProject = this.projectManagers.get(this.projectNames[0]);
    if (!firstProject) {
      throw new Error('Cannot generate health report: first project manager not found despite being in project list.');
    }

    const baseReport = firstProject.getHealthReport();

    // Aggregate agent information from all projects
    const allAgents: AgentHealthStatus[] = [];
    let totalCompleted = 0;
    let totalFailed = 0;
    let totalExecutionTime = 0;
    const allTasks: Task[] = [];

    for (const name of this.projectNames) {
      const manager = this.projectManagers.get(name);
      if (!manager) {
        logger.warn(`Project manager not found for "${name}" during health report generation`);
        continue;
      }

      const projectReport = manager.getHealthReport();
      allAgents.push(...projectReport.agents);
      totalCompleted += projectReport.taskThroughput.completedTasks;
      totalFailed += projectReport.taskThroughput.failedTasks;
      totalExecutionTime += projectReport.taskThroughput.averageExecutionTime * projectReport.taskThroughput.completedTasks;

      // Collect tasks
      const allProjectTasks = manager.getTaskQueue().getAllTasks();
      allTasks.push(...allProjectTasks);
    }

    // Update the base report with combined data
    baseReport.agents = allAgents;
    baseReport.taskThroughput.completedTasks = totalCompleted;
    baseReport.taskThroughput.failedTasks = totalFailed;
    baseReport.taskThroughput.totalTasks = totalCompleted + totalFailed;
    baseReport.taskThroughput.averageExecutionTime = totalCompleted > 0 ? totalExecutionTime / totalCompleted : 0;

    const totalTasks = totalCompleted + totalFailed;
    baseReport.taskThroughput.errorRate = totalTasks > 0 ? (totalFailed / totalTasks) * 100 : 0;
    baseReport.taskThroughput.successRate = totalTasks > 0 ? (totalCompleted / totalTasks) * 100 : 100;

    // Recalculate priority and status breakdown
    const byPriority: Record<TaskPriority, number> = {
      [TaskPriority.CRITICAL]: 0,
      [TaskPriority.HIGH]: 0,
      [TaskPriority.MEDIUM]: 0,
      [TaskPriority.LOW]: 0
    };
    const byStatus: Record<TaskStatus, number> = {
      [TaskStatus.PENDING]: 0,
      [TaskStatus.RUNNING]: 0,
      [TaskStatus.COMPLETED]: 0,
      [TaskStatus.FAILED]: 0,
      [TaskStatus.CANCELLED]: 0
    };

    for (const task of allTasks) {
      const priorityKey = task.priority as TaskPriority;
      const statusKey = task.status as TaskStatus;
      byPriority[priorityKey] = (byPriority[priorityKey] || 0) + 1;
      byStatus[statusKey] = (byStatus[statusKey] || 0) + 1;
    }

    baseReport.priorityBreakdown = { byPriority, byStatus };
    baseReport.config.agentCount = allAgents.length;

    // Update warnings and errors from all projects
    const allWarnings: string[] = [];
    const allErrors: string[] = [];
    for (const name of this.projectNames) {
      const manager = this.projectManagers.get(name);
      if (!manager) continue;
      const projectReport = manager.getHealthReport();
      allWarnings.push(...projectReport.warnings);
      allErrors.push(...projectReport.errors);
    }
    baseReport.warnings = allWarnings;
    baseReport.errors = allErrors;

    // Recalculate overall status based on aggregated data
    if (allErrors.length > 0) {
      baseReport.status = 'unhealthy';
    } else if (allWarnings.length > 0 || allAgents.some(a => !a.healthy)) {
      baseReport.status = 'degraded';
    } else {
      baseReport.status = 'healthy';
    }

    return baseReport;
  }

  /**
   * Get combined stats across all projects as a formatted string.
   * Includes per-project statistics like completed/failed tasks and average execution time.
   *
   * @returns A formatted string containing stats for all managed projects.
   */
  getAllStats(): string {
    let report = '\n=== Multi-Project Status ===\n\n';

    for (const name of this.projectNames) {
      const manager = this.projectManagers.get(name);
      if (!manager) continue;

      const stats = manager.getStats();
      const isActive = manager.isRunning();
      const icon = isActive ? '🟢' : '⚪';

      report += `${icon} **${name}**\n`;
      report += `   Working Dir: ${this.projectConfigs.get(name)?.workingDirectory}\n`;
      report += `   Completed: ${stats.completedTasks} | Failed: ${stats.failedTasks}\n`;
      report += `   Avg Time: ${stats.averageExecutionTime.toFixed(0)}ms\n\n`;
    }

    return report;
  }

  /**
   * Get agent status for all projects as a formatted string.
   * Includes per-project agent status sections.
   *
   * @returns A formatted string containing agent status for all projects.
   */
  getAllAgentStatus(): string {
    let report = '\n=== Agent Status (All Projects) ===\n';

    for (const name of this.projectNames) {
      const manager = this.projectManagers.get(name);
      if (!manager) continue;

      report += `\n--- ${name} ---\n`;
      report += manager.getAgentStatusReport();
    }

    return report;
  }

  /**
   * Get the names of all managed projects.
   *
   * @returns An array of project name strings.
   */
  getProjectNames(): string[] {
    return this.projectNames;
  }

  /**
   * Check if the multi-project loop is currently running.
   *
   * @returns True if the loop is active, false otherwise.
   */
  isRunningStatus(): boolean {
    return this.isRunning;
  }

  /**
   * Get the LoopManager instance for a specific project.
   *
   * @param name - The name of the project to retrieve.
   * @returns The LoopManager for the project, or undefined if not found.
   */
  getProjectManager(name: string): LoopManager | undefined {
    if (!name || name.trim().length === 0) {
      throw new Error('Project name must be provided and cannot be empty.');
    }
    return this.projectManagers.get(name);
  }

  /**
   * Build a complete LoopConfig for a project by merging project-specific and global settings.
   *
   * Project-specific values (agents, maxConcurrentTasks, maxLoopIterations, workingDirectory)
   * override global values when provided. All other values come from the global configuration.
   *
   * @param projectConfig - The project configuration containing project-specific overrides.
   * @returns A complete LoopConfig object with all required fields populated.
   * @throws Error if projectConfig is missing required fields (name, workingDirectory).
   */
  private buildProjectConfig(projectConfig: ProjectConfig): LoopConfig {
    if (!projectConfig.workingDirectory) {
      throw new Error(`Project "${projectConfig.name}" is missing a working directory.`);
    }

    return {
      agents: projectConfig.agents || this.globalConfig.agents,
      maxConcurrentTasks: projectConfig.maxConcurrentTasks || this.globalConfig.maxConcurrentTasks,
      loopInterval: this.globalConfig.loopInterval,
      maxRetries: this.globalConfig.maxRetries,
      workingDirectory: projectConfig.workingDirectory,
      logLevel: this.globalConfig.logLevel,
      enableAutoStart: false,
      maxLoopIterations: projectConfig.maxLoopIterations || this.globalConfig.maxLoopIterations,
      enableSelfTaskGeneration: this.globalConfig.enableSelfTaskGeneration ?? true
    };
  }

  /**
   * Process tasks for the current project in the round-robin cycle.
   *
   * Starts the LoopManager for the current project, waits for it to complete
   * (reaching max iterations or being stopped), then advances to the next project.
   * Uses a polling interval to check project status every 5 seconds.
   *
   * Handles errors gracefully by logging them and advancing to the next project
   * rather than halting the entire multi-project loop.
   */
  private async processCurrentProject(): Promise<void> {
    if (!this.isRunning || this.projectNames.length === 0) {
      return;
    }

    const projectName = this.projectNames[this.currentIndex];
    const manager = this.projectManagers.get(projectName);

    if (!manager) {
      logger.error(`Project manager not found for "${projectName}"`);
      this.currentIndex = (this.currentIndex + 1) % this.projectNames.length;
      return;
    }

    logger.info(`\n📁 Working on project: ${projectName}`);

    try {
      // Start the project's loop
      await manager.start();

      // Wait for the project to complete its max iterations or stop
      // Check every 5 seconds
      const checkInterval = setInterval(async () => {
        if (!this.isRunning) {
          clearInterval(checkInterval);
          return;
        }

        try {
          const isProjectRunning = manager.isRunning();
          if (!isProjectRunning) {
            clearInterval(checkInterval);
            logger.info(`Project "${projectName}" completed its tasks`);

            // Move to next project
            this.currentIndex = (this.currentIndex + 1) % this.projectNames.length;

            if (this.currentIndex === 0) {
              logger.info('\n🔄 Completed all projects, starting from beginning...');
            }

            // Small delay before next project
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Start next project
            await this.processCurrentProject().catch((error) => {
              logger.error(`Error processing next project: ${error instanceof Error ? error.message : String(error)}`);
            });
          }
        } catch (error) {
          logger.error(`Error checking project status: ${error instanceof Error ? error.message : String(error)}`);
        }
      }, 5000);
    } catch (error) {
      logger.error(`Failed to start project "${projectName}": ${error instanceof Error ? error.message : String(error)}`);
      // Move to next project even if this one failed
      this.currentIndex = (this.currentIndex + 1) % this.projectNames.length;

      if (this.currentIndex === 0) {
        logger.info('\n🔄 Completed all projects, starting from beginning...');
      }

      // Small delay before next project
      setTimeout(async () => {
        await this.processCurrentProject().catch((error) => {
          logger.error(`Error processing next project: ${error instanceof Error ? error.message : String(error)}`);
        });
      }, 2000);
    }
  }
}
