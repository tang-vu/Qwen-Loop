import { ILoopManager, LoopStats, LoopConfig, Task, TaskStatus, TaskPriority, AgentResult } from '../types.js';
import { AgentOrchestrator } from './orchestrator.js';
import { TaskQueue } from './task-queue.js';
import { SelfTaskGenerator } from './self-task-generator.js';
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

    if (config.enableSelfTaskGeneration) {
      this.selfTaskGenerator = new SelfTaskGenerator(config.workingDirectory);
      logger.info('Self-task generation enabled');
    }
  }

  /**
   * Start the agent loop
   */
  async start(): Promise<void> {
    if (this.isLoopRunning) {
      logger.warn('Loop is already running');
      return;
    }

    logger.info('Starting Qwen Loop...');

    // Initialize all agents
    await this.orchestrator.initializeAll();

    // Analyze project and generate initial tasks if self-task generation is enabled
    if (this.selfTaskGenerator) {
      try {
        logger.info('Analyzing project and generating self-directed tasks...');
        const analysis = this.selfTaskGenerator.analyzeProject();
        logger.info(`Project analysis: ${analysis.files.length} files, ${analysis.totalLines} lines, complexity: ${analysis.complexity}`);

        // Generate and enqueue initial tasks
        const tasks = this.selfTaskGenerator.generateTasks(analysis);
        for (const taskDesc of tasks) {
          this.addTask(taskDesc.description, taskDesc.priority, { category: taskDesc.category, selfGenerated: true });
        }
        logger.info(`Generated ${tasks.length} self-directed tasks`);
      } catch (error) {
        logger.error(`Failed to generate self-directed tasks: ${error instanceof Error ? error.message : String(error)}`);
        // Continue without self-task generation
      }
    }

    this.isLoopRunning = true;
    this.isLoopPaused = false;
    this.startTime = new Date();
    this.loopIterationCount = 0;

    logger.info(`Loop started with interval ${this.config.loopInterval}ms`);
    if (this.config.maxLoopIterations && this.config.maxLoopIterations > 0) {
      logger.info(`Max iterations: ${this.config.maxLoopIterations}`);
    } else {
      logger.info('Max iterations: unlimited (run until stopped)');
    }

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

    logger.info('Stopping Qwen Loop...');

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

    logger.info('Pausing Qwen Loop...');
    this.isLoopPaused = true;

    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }

    logger.info('Loop paused');
  }

  /**
   * Resume the agent loop
   */
  async resume(): Promise<void> {
    if (!this.isLoopRunning || !this.isLoopPaused) {
      return;
    }

    logger.info('Resuming Qwen Loop...');
    this.isLoopPaused = false;
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
    logger.info(`Task added to queue: ${task.id} - ${description}`);
    
    return task;
  }

  /**
   * Get the task queue instance
   * @returns The TaskQueue instance
   */
  getTaskQueue(): TaskQueue {
    return this.taskQueue;
  }

  /**
   * Get the orchestrator instance
   * @returns The AgentOrchestrator instance
   */
  getOrchestrator(): AgentOrchestrator {
    return this.orchestrator;
  }

  /**
   * Get the current configuration
   * @returns The LoopConfig object
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
        logger.error(`Error in loop iteration: ${error}`);
      }
    }, this.config.loopInterval);

    // Run immediately first
    try {
      await this.processLoopIteration();
    } catch (error) {
      logger.error(`Error in initial loop iteration: ${error}`);
    }
  }

  private async processLoopIteration(): Promise<void> {
    // Check if we've reached max concurrent tasks
    const runningTasks = this.taskQueue.getTasksByStatus(TaskStatus.RUNNING);
    if (runningTasks.length >= this.config.maxConcurrentTasks) {
      logger.debug(`Max concurrent tasks reached (${this.config.maxConcurrentTasks}), waiting...`);
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
        logger.info(`Self-generated new task: ${task.description.slice(0, 80)}...`);
        task = this.taskQueue.dequeue(); // Re-dequeue the newly added task
      }
    }

    if (!task) {
      logger.debug('No tasks in queue');
      return;
    }

    // Check max iterations limit (count completed tasks)
    if (this.config.maxLoopIterations && this.config.maxLoopIterations > 0) {
      if (this.loopIterationCount >= this.config.maxLoopIterations) {
        logger.info(`Reached max iterations (${this.config.maxLoopIterations}), stopping loop`);
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
        logger.info(`Task ${task.id} completed successfully in ${result.executionTime}ms`, {
          task: task.id
        });

        // Auto commit and push after each task
        const commitMsg = `chore(ai): ${task.description.slice(0, 72)}`;
        const gitResult = await gitCommitPush(commitMsg, this.config.workingDirectory);
        if (gitResult.success) {
          logger.info(`Changes committed and pushed: ${commitMsg}`, { task: task.id });
        } else {
          logger.warn(`Git push failed: ${gitResult.output}`, { task: task.id });
        }
      } else {
        this.failedTasksCount++;
        this.totalExecutionTime += result.executionTime;

        // Retry logic
        const retryCount = task.metadata?.retryCount || 0;
        if (retryCount < this.config.maxRetries) {
          task.metadata = task.metadata || {};
          task.metadata.retryCount = retryCount + 1;
          task.status = TaskStatus.PENDING;
          this.taskQueue.enqueue(task);
          logger.warn(`Task ${task.id} failed, retrying (${retryCount + 1}/${this.config.maxRetries})`, {
            task: task.id
          });
        } else {
          this.loopIterationCount++; // Count failed retries too
          logger.error(`Task ${task.id} failed after ${retryCount} retries: ${result.error}`, {
            task: task.id
          });
        }
      }
    } catch (error) {
      this.failedTasksCount++;
      this.loopIterationCount++;
      logger.error(`Unexpected error executing task ${task.id}: ${error}`, {
        task: task.id
      });
    }
  }

  getAgentStatusReport(): string {
    return this.orchestrator.getAgentStatusReport();
  }

  getTaskQueueStats(): string {
    return this.taskQueue.getQueueStats();
  }
}
