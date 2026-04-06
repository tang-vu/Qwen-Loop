import { LoopConfig, LoopStats, ProjectConfig, AgentConfig, AgentType, TaskPriority } from '../types.js';
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

  constructor(globalConfig: LoopConfig) {
    this.globalConfig = globalConfig;
  }

  /**
   * Initialize all projects from config
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
   * Add a single project
   */
  async addProject(projectConfig: ProjectConfig): Promise<void> {
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
   * Start cycling through all projects
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Multi-project loop is already running');
      return;
    }

    this.isRunning = true;
    this.currentIndex = 0;

    logger.info(`Starting multi-project loop with ${this.projectNames.length} projects`);
    logger.info(`Projects: ${this.projectNames.join(', ')}`);

    // Start with first project
    await this.processCurrentProject();
  }

  /**
   * Stop all projects
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
   * Get combined stats across all projects
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
   * Get agent status for all projects
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
   * Get project names
   */
  getProjectNames(): string[] {
    return this.projectNames;
  }

  /**
   * Check if running
   */
  isRunningStatus(): boolean {
    return this.isRunning;
  }

  /**
   * Get loop manager for a specific project
   */
  getProjectManager(name: string): LoopManager | undefined {
    return this.projectManagers.get(name);
  }

  // Private methods

  private buildProjectConfig(projectConfig: ProjectConfig): LoopConfig {
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
            await this.processCurrentProject();
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
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Start next project
      await this.processCurrentProject();
    }
  }
}
