import { ILoopManager, LoopStats, LoopConfig, Task, TaskStatus, TaskPriority, AgentResult, HealthReport } from '../types.js';
import { AgentOrchestrator } from './orchestrator.js';
import { TaskQueue } from './task-queue.js';
import { SelfTaskGenerator } from './self-task-generator.js';
import { HealthChecker } from './health-checker.js';
import { gitCommitPush } from './git-utils.js';
import { logger } from '../logger.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Manages the autonomous agent loop, handling task scheduling,
 * execution, and lifecycle management.
 */
export class LoopManager implements ILoopManager {
  private orchestrator: AgentOrchestrator;
  private taskQueue: TaskQueue;
  private healthChecker: HealthChecker;
  private selfTaskGenerator: SelfTaskGenerator | null = null;
  private config: LoopConfig;

  private isLoopRunning = false;
  private isLoopPaused = false;
  private loopInterval: NodeJS.Timeout | null = null;
  private startTime: Date | null = null;
  private completedTasksCount = 0;
  private failedTasksCount = 0;
  private totalExecutionTime = 0;
  private loopIterationCount = 0;

  /**
   * Create a new LoopManager
   * @param config - Configuration for the loop
   */
  constructor(config: LoopConfig) {
    this.config = config;
    this.orchestrator = new AgentOrchestrator();
    this.taskQueue = new TaskQueue();
    this.healthChecker = new HealthChecker();

    if (config.enableSelfTaskGeneration) {
      this.selfTaskGenerator = new SelfTaskGenerator(config.workingDirectory);
      logger.debug('Self-task generation enabled');
    }
  }

  /**
   * Start the agent loop
   */
  async start(): Promise<void> {
    if (this.isLoopRunning) {
      logger.warn('Loop already running', { iterations: this.loopIterationCount });
      return;
    }

    logger.info('Starting Qwen Loop');

    // Initialize all agents
    await this.orchestrator.initializeAll();

    // Analyze project and generate initial tasks if self-task generation is enabled
    if (this.selfTaskGenerator) {
      try {
        const analysis = this.selfTaskGenerator.analyzeProject();
        logger.info(`Project analysis complete: ${analysis.files.length} files, ${analysis.totalLines} lines`);

        // Generate and enqueue initial tasks
        const tasks = this.selfTaskGenerator.generateTasks(analysis);
        for (const taskDesc of tasks) {
          this.addTask(taskDesc.description, taskDesc.priority, { category: taskDesc.category, selfGenerated: true });
        }
        logger.info(`Generated ${tasks.length} initial tasks`, { count: tasks.length });
      } catch (error) {
        logger.error('Failed to generate self-directed tasks', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        // Continue without self-task generation
      }
    }

    this.isLoopRunning = true;
    this.isLoopPaused = false;
    this.startTime = new Date();
    this.loopIterationCount = 0;

    // Initialize health checker
    this.updateHealthChecker();

    const iterLimit = this.config.maxLoopIterations && this.config.maxLoopIterations > 0
      ? `${this.config.maxLoopIterations} iterations`
      : 'unlimited';
    logger.info(`Loop started`, { 
      duration: this.config.loopInterval,
      maxIterations: iterLimit
    });

    // Start the loop
    this.runLoop();
  }

  /**
   * Stop the agent loop and clean up resources
   */
  async stop(): Promise<void> {
    if (!this.isLoopRunning) {
      return;
    }

    this.isLoopRunning = false;
    this.isLoopPaused = false;

    // Clear the interval to stop the loop
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }

    // Cancel all running tasks
    await this.orchestrator.cancelAllTasks();

    logger.info('Loop stopped');
  }

  /**
   * Pause the agent loop
   */
  async pause(): Promise<void> {
    if (!this.isLoopRunning) {
      return;
    }

    this.isLoopPaused = true;

    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }

    logger.debug('Loop paused');
  }

  /**
   * Resume the agent loop
   */
  async resume(): Promise<void> {
    if (!this.isLoopRunning || !this.isLoopPaused) {
      return;
    }

    this.isLoopPaused = false;
    logger.debug('Loop resumed');
    this.runLoop();
  }

  /**
   * Check if the loop is currently running
   * @returns True if the loop is active and not paused
   */
  isRunning(): boolean {
    return this.isLoopRunning && !this.isLoopPaused;
  }

  /**
   * Get statistics about the loop execution
   * @returns Object containing loop statistics
   */
  getStats(): LoopStats {
    const uptime = this.startTime ? Date.now() - this.startTime.getTime() : 0;
    const averageExecutionTime = this.completedTasksCount > 0
      ? this.totalExecutionTime / this.completedTasksCount
      : 0;

    return {
      totalTasks: this.taskQueue.getAllTasks().length,
      completedTasks: this.completedTasksCount,
      failedTasks: this.failedTasksCount,
      runningTasks: this.taskQueue.getTasksByStatus(TaskStatus.RUNNING).length,
      activeAgents: this.orchestrator.getAvailableAgents().length,
      uptime,
      averageExecutionTime,
      loopIterations: this.loopIterationCount,
      maxLoopIterations: this.config.maxLoopIterations || 0
    };
  }

  /**
   * Add a new task to the queue
   * @param description - Human-readable description of the task
   * @param priority - Priority level (defaults to MEDIUM)
   * @param metadata - Optional metadata to attach to the task
   * @returns The created Task object
   */
  addTask(description: string, priority: TaskPriority = TaskPriority.MEDIUM, metadata?: Record<string, any>): Task {
    const task: Task = {
      id: uuidv4(),
      description,
      priority,
      status: TaskStatus.PENDING,
      createdAt: new Date(),
      metadata
    };

    this.taskQueue.enqueue(task);
    logger.debug(`Task enqueued: ${description.slice(0, 60)}${description.length > 60 ? '...' : ''}`, {
      task: task.id,
      priority
    });

    return task;
  }

  /**
   * Get the task queue instance
   *
   * Provides access to the underlying task queue for inspection and management.
   *
   * @returns The TaskQueue instance used by this loop manager.
   */
  getTaskQueue(): TaskQueue {
    return this.taskQueue;
  }

  /**
   * Get the orchestrator instance
   *
   * Provides access to the agent orchestrator for registering and managing agents.
   *
   * @returns The AgentOrchestrator instance used by this loop manager.
   */
  getOrchestrator(): AgentOrchestrator {
    return this.orchestrator;
  }

  /**
   * Get the current configuration
   *
   * Returns the loop configuration including agents, intervals, and working directory.
   *
   * @returns The LoopConfig object for this loop manager.
   */
  getConfig(): LoopConfig {
    return this.config;
  }

  private async runLoop(): Promise<void> {
    this.loopInterval = setInterval(async () => {
      if (this.isLoopPaused || !this.isLoopRunning) {
        return;
      }

      try {
        await this.processLoopIteration();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Error in loop iteration', {
          iteration: this.loopIterationCount,
          error: errorMessage
        });
      }
    }, this.config.loopInterval);

    // Run immediately first
    try {
      await this.processLoopIteration();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error in initial loop iteration', {
        iteration: this.loopIterationCount,
        error: errorMessage
      });
    }
  }

  private async processLoopIteration(): Promise<void> {
    // Check if we've reached max concurrent tasks
    const runningTasks = this.taskQueue.getTasksByStatus(TaskStatus.RUNNING);
    if (runningTasks.length >= this.config.maxConcurrentTasks) {
      logger.debug(`Max concurrent tasks reached (${this.config.maxConcurrentTasks})`, undefined, 10000);
      return;
    }

    // Dequeue next task
    let task = this.taskQueue.dequeue();

    // If queue is empty and self-task generation is enabled, generate more tasks
    if (!task && this.selfTaskGenerator) {
      const analysis = this.selfTaskGenerator.analyzeProject();
      task = this.selfTaskGenerator.getNextTask(analysis);
      if (task) {
        this.taskQueue.enqueue(task);
        logger.debug(`Self-generated task: ${task.description.slice(0, 60)}...`);
        task = this.taskQueue.dequeue(); // Re-dequeue the newly added task
      }
    }

    if (!task) {
      logger.debug('No tasks in queue', undefined, 10000);
      return;
    }

    // Check max iterations limit (count completed tasks)
    if (this.config.maxLoopIterations && this.config.maxLoopIterations > 0) {
      if (this.loopIterationCount >= this.config.maxLoopIterations) {
        logger.info(`Reached max iterations (${this.config.maxLoopIterations}), stopping`);
        await this.stop();
        return;
      }
    }

    // Assign task to an available agent
    const agent = await this.orchestrator.assignTask(task);
    if (!agent) {
      // No available agents, re-enqueue the task
      this.taskQueue.enqueue(task);
      return;
    }

    // Execute the task
    task.status = TaskStatus.RUNNING;

    try {
      const result = await agent.executeTask(task);

      // Count iteration after task completes
      this.loopIterationCount++;

      if (result.success) {
        this.completedTasksCount++;
        this.totalExecutionTime += result.executionTime;
        logger.info(`Task completed`, {
          task: task.id,
          agent: task.assignedAgent,
          duration: result.executionTime,
          description: task.description.slice(0, 80)
        });
        if (task.assignedAgent) {
          this.healthChecker.trackTaskCompletion(task.assignedAgent, true, result.executionTime);
        }

        // Auto commit and push after each task
        const commitMsg = `chore(ai): ${task.description.slice(0, 72)}`;
        const gitResult = await gitCommitPush(commitMsg, this.config.workingDirectory);
        if (!gitResult.success) {
          logger.warn(`Git operation failed`, {
            task: task.id,
            agent: task.assignedAgent,
            output: gitResult.output.slice(0, 100)
          });
        }
      } else {
        this.failedTasksCount++;
        this.totalExecutionTime += result.executionTime;

        // Track in health checker
        if (task.assignedAgent) {
          this.healthChecker.trackTaskCompletion(task.assignedAgent, false, result.executionTime);
        }

        // Retry logic
        const retryCount = task.metadata?.retryCount || 0;
        if (retryCount < this.config.maxRetries) {
          task.metadata = task.metadata || {};
          task.metadata.retryCount = retryCount + 1;
          task.status = TaskStatus.PENDING;
          this.taskQueue.enqueue(task);
          logger.warn(`Task failed, retrying`, {
            task: task.id,
            agent: task.assignedAgent,
            retryCount: retryCount + 1,
            error: result.error?.slice(0, 100)
          });
        } else {
          this.loopIterationCount++; // Count failed retries too
          logger.error(`Task failed after max retries`, {
            task: task.id,
            agent: task.assignedAgent,
            retryCount,
            error: result.error
          });
        }
      }
    } catch (error) {
      this.failedTasksCount++;
      this.loopIterationCount++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Task execution error', {
        task: task.id,
        agent: task.assignedAgent,
        error: errorMessage
      });

      // Track in health checker
      if (task.assignedAgent) {
        this.healthChecker.trackTaskCompletion(task.assignedAgent, false, 0);
      }
    }
  }

  /**
   * Update health checker with current state
   */
  private updateHealthChecker(): void {
    const allTasks = this.taskQueue.getAllTasks();
    this.healthChecker.updateAgents(this.orchestrator.getAllAgents());
    this.healthChecker.updateLoopStats({
      loopStartTime: this.startTime,
      completedTasks: this.completedTasksCount,
      failedTasks: this.failedTasksCount,
      totalExecutionTime: this.totalExecutionTime,
      maxConcurrentTasks: this.config.maxConcurrentTasks,
      loopInterval: this.config.loopInterval,
      maxRetries: this.config.maxRetries,
      workingDirectory: this.config.workingDirectory
    });
    this.healthChecker.updateTaskQueue(allTasks.map(t => ({
      id: t.id,
      status: t.status,
      priority: t.priority
    })));
  }

  /**
   * Get the health checker instance for generating health reports
   *
   * Updates the health checker with current task queue and agent stats
   * before returning it.
   *
   * @returns The HealthChecker instance for this loop manager.
   */
  getHealthChecker(): HealthChecker {
    this.updateHealthChecker();
    return this.healthChecker;
  }

  /**
   * Get a comprehensive health report
   *
   * Generates a detailed report including agent health, task throughput,
   * resource usage, and priority breakdown.
   *
   * @returns A HealthReport object with current system metrics.
   */
  getHealthReport(): HealthReport {
    this.updateHealthChecker();
    return this.healthChecker.getJsonReport();
  }

  /**
   * Get a formatted status report showing agent states
   *
   * @returns A formatted string with agent status information.
   */
  getAgentStatusReport(): string {
    return this.orchestrator.getAgentStatusReport();
  }

  /**
   * Get formatted task queue statistics
   *
   * @returns A formatted string with task queue metrics.
   */
  getTaskQueueStats(): string {
    return this.taskQueue.getQueueStats();
  }
}
