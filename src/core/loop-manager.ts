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
      logger.debug('🔧 Self-task generation enabled', { operation: 'loop.init' });
    }
  }

  /**
   * Start the agent loop
   */
  async start(): Promise<void> {
    if (this.isLoopRunning) {
      logger.warn('Loop already running, skipping start', { 
        operation: 'loop.lifecycle',
        iterations: this.loopIterationCount 
      });
      return;
    }

    logger.info('🚀 Starting Qwen Loop', { operation: 'loop.lifecycle' });

    // Initialize all agents
    await this.orchestrator.initializeAll();

    // Analyze project and generate initial tasks if self-task generation is enabled
    if (this.selfTaskGenerator) {
      try {
        const analysis = this.selfTaskGenerator.analyzeProject();
        logger.info(`📊 Project analysis complete`, { 
          operation: 'loop.init',
          files: analysis.files.length, 
          totalLines: analysis.totalLines 
        });

        // Generate and enqueue initial tasks
        const tasks = this.selfTaskGenerator.generateTasks(analysis);
        for (const taskDesc of tasks) {
          this.addTask(taskDesc.description, taskDesc.priority, { category: taskDesc.category, selfGenerated: true });
        }
        logger.info(`✨ Generated initial tasks`, { 
          operation: 'loop.init',
          count: tasks.length 
        });
      } catch (error) {
        logger.error('❌ Failed to generate self-directed tasks', {
          operation: 'loop.init',
          error: error instanceof Error ? error : new Error(String(error))
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
    logger.info(`✅ Loop started`, {
      operation: 'loop.lifecycle',
      interval: this.config.loopInterval,
      maxIterations: iterLimit
    });

    // Start the loop
    this.runLoop();
  }

  /**
   * Stop the agent loop and clean up resources
   *
   * Halts task processing, clears the scheduling interval, and cancels
   * all currently running tasks across all agents.
   *
   * @throws Does not throw; logs errors for individual failures
   */
  async stop(): Promise<void> {
    if (!this.isLoopRunning) {
      logger.debug('Loop not running, skip stop', { operation: 'loop.lifecycle' });
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

    logger.info('🛑 Loop stopped', { operation: 'loop.lifecycle' });
  }

  /**
   * Pause the agent loop
   *
   * Temporarily halts task processing while maintaining the current state.
   * Call `resume()` to continue processing.
   *
   * @throws Does not throw; logs a debug message if loop is not running
   */
  async pause(): Promise<void> {
    if (!this.isLoopRunning) {
      logger.debug('Loop not running, cannot pause', { operation: 'loop.lifecycle' });
      return;
    }

    this.isLoopPaused = true;

    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }

    logger.debug('⏸️ Loop paused', { operation: 'loop.lifecycle' });
  }

  /**
   * Resume the agent loop
   */
  async resume(): Promise<void> {
    if (!this.isLoopRunning || !this.isLoopPaused) {
      logger.debug('Loop not running or not paused, cannot resume', { operation: 'loop.lifecycle' });
      return;
    }

    this.isLoopPaused = false;
    logger.debug('▶️ Loop resumed', { operation: 'loop.lifecycle' });
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
   *
   * Creates a task with a unique ID and enqueues it for processing.
   * The task will be picked up by the next available agent in the loop.
   *
   * @param description - Human-readable description of the task
   * @param priority - Priority level (defaults to MEDIUM)
   * @param metadata - Optional metadata to attach to the task
   * @returns The created Task object
   * @throws Error if description is empty or whitespace-only
   */
  addTask(description: string, priority: TaskPriority = TaskPriority.MEDIUM, metadata?: Record<string, unknown>): Task {
    if (!description || description.trim().length === 0) {
      throw new Error('Task description cannot be empty or whitespace-only');
    }

    const task: Task = {
      id: uuidv4(),
      description,
      priority,
      status: TaskStatus.PENDING,
      createdAt: new Date(),
      metadata
    };

    this.taskQueue.enqueue(task);
    logger.debug(`📥 Task enqueued`, {
      operation: 'queue.enqueue',
      task: task.id,
      priority,
      description: description.slice(0, 60)
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
        logger.error('❌ Error in loop iteration', {
          operation: 'loop.error',
          iteration: this.loopIterationCount,
          error: error instanceof Error ? error : new Error(errorMessage)
        });
      }
    }, this.config.loopInterval);

    // Run immediately first
    try {
      await this.processLoopIteration();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error in initial loop iteration', {
        operation: 'loop.error',
        iteration: this.loopIterationCount,
        error: error instanceof Error ? error : new Error(errorMessage)
      });
    }
  }

  private async processLoopIteration(): Promise<void> {
    // Check if we've reached max concurrent tasks
    const runningTasks = this.taskQueue.getTasksByStatus(TaskStatus.RUNNING);
    if (runningTasks.length >= this.config.maxConcurrentTasks) {
      logger.debug(`⏳ Max concurrent tasks reached (${this.config.maxConcurrentTasks})`, {
        operation: 'loop.throttle',
        count: runningTasks.length
      }, 10000);
      return;
    }

    // Dequeue next task
    let task = this.taskQueue.dequeue();

    // If queue is empty and self-task generation is enabled, generate more tasks
    if (!task && this.selfTaskGenerator) {
      try {
        const analysis = this.selfTaskGenerator.analyzeProject();
        task = this.selfTaskGenerator.getNextTask(analysis);
        if (task) {
          this.taskQueue.enqueue(task);
          logger.debug(`🔄 Self-generated task: ${task.description.slice(0, 60)}...`, {
            operation: 'task.generation',
            task: task.id
          });
          task = this.taskQueue.dequeue(); // Re-dequeue the newly added task
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('❌ Failed to generate self-directed task during loop iteration', {
          operation: 'task.generation',
          error: error instanceof Error ? error : new Error(errorMessage)
        });
        // Continue without self-task generation for this iteration
        return;
      }
    }

    if (!task) {
      logger.debug('📭 No tasks in queue', { operation: 'queue.status' }, 10000);
      return;
    }

    // Check max iterations limit (count completed tasks)
    if (this.config.maxLoopIterations && this.config.maxLoopIterations > 0) {
      if (this.loopIterationCount >= this.config.maxLoopIterations) {
        logger.info(`🏁 Reached max iterations (${this.config.maxLoopIterations}), stopping`, {
          operation: 'loop.lifecycle',
          iterations: this.loopIterationCount
        });
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
      let result: AgentResult;
      try {
        result = await agent.executeTask(task);
      } catch (agentError) {
        // Handle unexpected agent execution errors
        const agentErrorMessage = agentError instanceof Error ? agentError.message : String(agentError);
        logger.error('❌ Unexpected agent execution error', {
          operation: 'task.execution',
          task: task.id,
          agent: task.assignedAgent,
          error: agentError instanceof Error ? agentError : new Error(agentErrorMessage)
        });

        result = {
          success: false,
          error: `Agent execution failed: ${agentErrorMessage}`,
          executionTime: 0
        };
      }

      // Count iteration after task completes
      this.loopIterationCount++;

      if (result.success) {
        this.completedTasksCount++;
        this.totalExecutionTime += result.executionTime;
        logger.info(`✅ Task completed`, {
          operation: 'task.lifecycle',
          task: task.id,
          agent: task.assignedAgent,
          duration: result.executionTime,
          description: task.description.slice(0, 80)
        });
        if (task.assignedAgent) {
          this.healthChecker.trackTaskCompletion(task.assignedAgent, true, result.executionTime);
        }

        // Auto commit and push after each task
        try {
          const commitMsg = `chore(ai): ${task.description.slice(0, 72)}`;
          const gitResult = await gitCommitPush(commitMsg, this.config.workingDirectory);
          if (!gitResult.success) {
            logger.warn(`⚠️ Git auto-commit failed`, {
              operation: 'git.commit',
              task: task.id,
              exitCode: gitResult.output.slice(0, 100)
            });
          }
        } catch (gitError) {
          // Log git errors but don't fail the task
          const gitErrorMessage = gitError instanceof Error ? gitError.message : String(gitError);
          logger.warn(`⚠️ Git auto-commit encountered an error`, {
            operation: 'git.error',
            task: task.id,
            error: gitErrorMessage
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
        const retryCount = (task.metadata?.retryCount as number) || 0;
        if (retryCount < this.config.maxRetries) {
          task.metadata = task.metadata || {};
          task.metadata.retryCount = retryCount + 1;
          task.status = TaskStatus.PENDING;
          this.taskQueue.enqueue(task);
          logger.warn(`🔁 Retrying task (${retryCount + 1}/${this.config.maxRetries})`, {
            operation: 'task.retry',
            task: task.id,
            agent: task.assignedAgent,
            retryCount: retryCount + 1,
            maxRetries: this.config.maxRetries,
            error: result.error?.slice(0, 100)
          });
        } else {
          logger.error(`❌ Task failed after max retries`, {
            operation: 'task.failure',
            task: task.id,
            agent: task.assignedAgent,
            retryCount,
            maxRetries: this.config.maxRetries,
            error: result.error ? new Error(result.error) : undefined
          });
        }
      }
    } catch (error) {
      this.failedTasksCount++;
      this.loopIterationCount++;
      logger.error('❌ Task execution error', {
        operation: 'task.error',
        task: task.id,
        agent: task.assignedAgent,
        error: error instanceof Error ? error : new Error(String(error))
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
