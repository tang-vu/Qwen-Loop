import { IAgent, AgentConfig, AgentStatus, AgentType, Task, AgentResult, TaskStatus } from '../types.js';
import { logger } from '../logger.js';
import { v4 as uuidv4 } from 'uuid';

export abstract class BaseAgent implements IAgent {
  public readonly id: string;
  public readonly name: string;
  public readonly type: AgentType;
  public status: AgentStatus = AgentStatus.OFFLINE;
  
  protected config: AgentConfig;
  protected currentTask: Task | null = null;
  protected abortController: AbortController | null = null;

  constructor(config: AgentConfig) {
    this.id = uuidv4();
    this.name = config.name;
    this.type = config.type;
    this.config = config;
    logger.info(`Agent ${this.name} (${this.type}) created`, { agent: this.name });
  }

  async initialize(): Promise<void> {
    try {
      logger.info(`Initializing agent ${this.name}...`, { agent: this.name });
      this.status = AgentStatus.IDLE;
      await this.onInitialize();
      logger.info(`Agent ${this.name} initialized successfully`, { agent: this.name });
    } catch (error) {
      this.status = AgentStatus.ERROR;
      logger.error(`Failed to initialize agent ${this.name}: ${error}`, { agent: this.name });
      throw error;
    }
  }

  async executeTask(task: Task): Promise<AgentResult> {
    if (!this.isAvailable()) {
      throw new Error(`Agent ${this.name} is not available. Current status: ${this.status}`);
    }

    this.currentTask = task;
    this.status = AgentStatus.BUSY;
    this.abortController = new AbortController();

    const startTime = Date.now();
    task.status = TaskStatus.RUNNING;
    task.startedAt = new Date();
    task.assignedAgent = this.id;

    logger.info(`Agent ${this.name} starting task: ${task.description}`, { 
      agent: this.name, 
      task: task.id 
    });

    try {
      const result = await this.onExecuteTask(task, this.abortController.signal);
      
      const executionTime = Date.now() - startTime;
      result.executionTime = executionTime;
      
      if (result.success) {
        task.status = TaskStatus.COMPLETED;
        task.completedAt = new Date();
        task.result = result.output;
        logger.info(`Agent ${this.name} completed task successfully in ${executionTime}ms`, {
          agent: this.name,
          task: task.id
        });
      } else {
        task.status = TaskStatus.FAILED;
        task.completedAt = new Date();
        task.error = result.error;
        logger.warn(`Agent ${this.name} failed task: ${result.error}`, {
          agent: this.name,
          task: task.id
        });
      }

      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      task.status = TaskStatus.FAILED;
      task.completedAt = new Date();
      task.error = errorMessage;

      logger.error(`Agent ${this.name} encountered error: ${errorMessage}`, {
        agent: this.name,
        task: task.id
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

  async cancelTask(): Promise<void> {
    if (this.currentTask && this.abortController) {
      logger.info(`Cancelling task ${this.currentTask.id} for agent ${this.name}`, {
        agent: this.name,
        task: this.currentTask.id
      });

      this.abortController.abort();

      if (this.currentTask) {
        this.currentTask.status = TaskStatus.CANCELLED;
        this.currentTask = null;
      }

      this.status = AgentStatus.IDLE;
    }
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  isAvailable(): boolean {
    return this.status === AgentStatus.IDLE;
  }

  // Abstract methods to be implemented by concrete agents
  protected abstract onInitialize(): Promise<void>;
  protected abstract onExecuteTask(task: Task, signal: AbortSignal): Promise<AgentResult>;
}
