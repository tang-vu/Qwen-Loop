import { IAgent, AgentConfig, AgentStatus, AgentType, Task, AgentResult, TaskStatus } from '../types.js';
import { logger } from '../logger.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Abstract base class for all agents in the system.
 *
 * Provides core agent functionality including task execution lifecycle,
 * status management, and cancellation support. Subclasses must implement
 * `onInitialize()` and `onExecuteTask()` to provide agent-specific behavior.
 *
 * @example
 * ```typescript
 * class MyAgent extends BaseAgent {
 *   protected async onInitialize(): Promise<void> {
 *     // Setup logic
 *   }
 *
 *   protected async onExecuteTask(task: Task, signal: AbortSignal): Promise<AgentResult> {
 *     // Task execution logic
 *   }
 * }
 * ```
 */
export abstract class BaseAgent implements IAgent {
  /** Unique identifier for this agent instance */
  public readonly id: string;
  /** Human-readable name for the agent */
  public readonly name: string;
  /** The type of agent (e.g., QWEN, CUSTOM) */
  public readonly type: AgentType;
  /** Current operational status of the agent */
  public status: AgentStatus = AgentStatus.OFFLINE;

  /** Agent configuration object */
  protected config: AgentConfig;
  /** Currently executing task, or null if no task is active */
  protected currentTask: Task | null = null;
  /** Abort controller for cancelling the current task */
  protected abortController: AbortController | null = null;

  /**
   * Creates a new BaseAgent instance.
   *
   * Validates the configuration and initializes the agent's identity.
   *
   * @param config - Configuration object defining agent properties including name and type
   * @throws Error if config is null, undefined, or missing required fields
   */
  constructor(config: AgentConfig) {
    if (!config) {
      throw new Error('Agent configuration is required');
    }
    if (!config.name || typeof config.name !== 'string' || config.name.trim().length === 0) {
      throw new Error('Agent name is required in configuration and must be a non-empty string');
    }
    if (!config.type) {
      throw new Error('Agent type is required in configuration');
    }

    this.id = uuidv4();
    this.name = config.name;
    this.type = config.type;
    this.config = config;
    logger.debug(`🤖 Agent created: ${this.name}`, {
      agent: this.name,
      operation: 'agent.init'
    });
  }

  /**
   * Initializes the agent and transitions it to IDLE status.
   *
   * Calls the subclass-specific `onInitialize()` method. If initialization fails,
   * the agent status is set to ERROR and the error is re-thrown.
   *
   * @returns Promise that resolves when initialization is complete
   * @throws Error if `onInitialize()` fails
   */
  async initialize(): Promise<void> {
    try {
      this.status = AgentStatus.IDLE;
      await this.onInitialize();
      logger.info(`✅ Agent initialized: ${this.name}`, {
        agent: this.name,
        operation: 'agent.init'
      });
    } catch (error) {
      this.status = AgentStatus.ERROR;
      logger.error(`❌ Agent initialization failed: ${this.name}`, {
        agent: this.name,
        operation: 'agent.init',
        error: error instanceof Error ? error : new Error(String(error))
      });
      throw error;
    }
  }

  /**
   * Executes a task using the agent's implementation.
   *
   * This method manages the full task lifecycle:
   * 1. Validates agent availability
   * 2. Sets task metadata (status, timestamps, assignment)
   * 3. Delegates to `onExecuteTask()` for actual execution
   * 4. Updates task status based on result
   * 5. Handles errors and cancellation
   *
   * @param task - The task to execute, must have a valid description and id
   * @returns Promise resolving to an AgentResult with success status, output/error, and timing
   * @throws Error if the agent is not available (not in IDLE status)
   */
  async executeTask(task: Task): Promise<AgentResult> {
    if (!task) {
      throw new Error('Task is required and cannot be null or undefined');
    }
    if (!this.isAvailable()) {
      throw new Error(`Agent '${this.name}' is not available to execute tasks. Current status: ${this.status}`);
    }

    this.currentTask = task;
    this.status = AgentStatus.BUSY;
    this.abortController = new AbortController();

    const startTime = Date.now();
    task.status = TaskStatus.RUNNING;
    task.startedAt = new Date();
    task.assignedAgent = this.id;

    logger.debug(`▶️ Starting task execution`, {
      agent: this.name,
      task: task.id,
      operation: 'task.execution'
    });

    try {
      const result = await this.onExecuteTask(task, this.abortController.signal);

      const executionTime = Date.now() - startTime;
      result.executionTime = executionTime;

      if (result.success) {
        task.status = TaskStatus.COMPLETED;
        task.completedAt = new Date();
        task.result = result.output;
      } else {
        task.status = TaskStatus.FAILED;
        task.completedAt = new Date();
        task.error = result.error;
        logger.warn(`⚠️ Task failed: ${this.name}`, {
          agent: this.name,
          task: task.id,
          operation: 'task.failure',
          error: result.error?.slice(0, 100)
        });
      }

      logger.debug(`✅ Task execution finished`, {
        agent: this.name,
        task: task.id,
        operation: 'task.execution',
        duration: executionTime,
        success: result.success
      });

      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      task.status = TaskStatus.FAILED;
      task.completedAt = new Date();
      task.error = errorMessage;

      logger.error('❌ Task execution error', {
        agent: this.name,
        task: task.id,
        operation: 'task.error',
        error // Pass original Error object to capture stack trace
      });

      return {
        success: false,
        error: errorMessage,
        executionTime
      };
    } finally {
      this.status = AgentStatus.IDLE;
      this.currentTask = null;
      this.abortController = null;
    }
  }

  /**
   * Cancels the currently executing task, if any.
   *
   * Sends an abort signal to the running task and resets the agent
   * to IDLE status. If no task is currently running, this is a no-op.
   *
   * @returns Promise that resolves when cancellation is complete
   */
  async cancelTask(): Promise<void> {
    if (this.currentTask && this.abortController) {
      logger.debug(`🚫 Cancelling task`, {
        agent: this.name,
        task: this.currentTask.id,
        operation: 'task.cancel'
      });

      this.abortController.abort();

      // Wait a tick for the abort signal to propagate
      await new Promise(resolve => setImmediate(resolve));

      if (this.currentTask && this.currentTask.status !== TaskStatus.CANCELLED) {
        this.currentTask.status = TaskStatus.CANCELLED;
      }

      this.currentTask = null;
      this.status = AgentStatus.IDLE;
    }
  }

  /**
   * Gets the current operational status of the agent.
   *
   * @returns The agent's current status (OFFLINE, IDLE, BUSY, or ERROR)
   */
  getStatus(): AgentStatus {
    return this.status;
  }

  /**
   * Checks whether the agent is available to accept new tasks.
   *
   * An agent is available only when it is in IDLE status.
   *
   * @returns `true` if the agent is idle and can accept tasks, `false` otherwise
   */
  isAvailable(): boolean {
    return this.status === AgentStatus.IDLE;
  }

  /**
   * Initializes agent-specific resources. Must be implemented by subclasses.
   *
   * This method is called during `initialize()` and should set up any resources
   * needed for task execution (e.g., verifying CLI availability, loading models).
   *
   * @returns Promise that resolves when initialization is complete
   * @throws Error if initialization fails and the agent should not be used
   */
  protected abstract onInitialize(): Promise<void>;

  /**
   * Executes a specific task. Must be implemented by subclasses.
   *
   * This method is called by `executeTask()` and contains the agent-specific
   * logic for processing a task. It should respect the abort signal for
   * cooperative cancellation.
   *
   * @param task - The task to execute, containing description and metadata
   * @param signal - AbortSignal that can be used to detect cancellation requests
   * @returns Promise resolving to an AgentResult indicating success/failure and output
   */
  protected abstract onExecuteTask(task: Task, signal: AbortSignal): Promise<AgentResult>;
}
