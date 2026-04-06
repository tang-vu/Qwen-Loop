/**
 * Available agent types for the Qwen Loop system
 */
export enum AgentType {
  QWEN = 'qwen',
  CUSTOM = 'custom'
}

/**
 * Possible states for a task in the queue
 */
export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

/**
 * Priority levels for task scheduling
 */
export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

/**
 * Status states for agents in the system
 */
export enum AgentStatus {
  IDLE = 'idle',
  BUSY = 'busy',
  ERROR = 'error',
  OFFLINE = 'offline'
}

/**
 * Represents a unit of work to be executed by an agent
 */
export interface Task {
  /** Unique identifier for the task */
  id: string;
  /** Human-readable description of what the task does */
  description: string;
  /** Priority level for scheduling */
  priority: TaskPriority;
  /** Current status of the task */
  status: TaskStatus;
  /** ID of the agent assigned to this task (optional) */
  assignedAgent?: string;
  /** Timestamp when the task was created */
  createdAt: Date;
  /** Timestamp when the task execution started (optional) */
  startedAt?: Date;
  /** Timestamp when the task completed (optional) */
  completedAt?: Date;
  /** Result output if the task succeeded (optional) */
  result?: string;
  /** Error message if the task failed (optional) */
  error?: string;
  /** Additional metadata associated with the task (optional) */
  metadata?: Record<string, any>;
}

/**
 * Configuration settings for an agent
 */
export interface AgentConfig {
  /** Name identifier for the agent */
  name: string;
  /** Type of agent (Qwen or custom) */
  type: AgentType;
  /** Model identifier for Qwen agents (optional) */
  model?: string;
  /** Maximum number of tokens for responses (optional) */
  maxTokens?: number;
  /** Timeout in milliseconds for task execution (optional) */
  timeout?: number;
  /** Working directory for the agent (optional) */
  workingDirectory?: string;
  /** Additional command-line arguments to pass (optional) */
  additionalArgs?: string[];
}

/**
 * Result of an agent's task execution
 */
export interface AgentResult {
  /** Whether the task execution was successful */
  success: boolean;
  /** Output from successful execution (optional) */
  output?: string;
  /** Error message if execution failed (optional) */
  error?: string;
  /** Time taken to execute the task in milliseconds */
  executionTime: number;
  /** List of files modified during execution (optional) */
  filesModified?: string[];
  /** List of files created during execution (optional) */
  filesCreated?: string[];
  /** List of files deleted during execution (optional) */
  filesDeleted?: string[];
}

/**
 * Interface that all agents must implement
 */
export interface IAgent {
  /** Unique identifier for the agent (read-only) */
  readonly id: string;
  /** Name of the agent (read-only) */
  readonly name: string;
  /** Type of the agent (read-only) */
  readonly type: AgentType;
  /** Current status of the agent */
  status: AgentStatus;

  /**
   * Initialize the agent and prepare for task execution
   * @throws Error if initialization fails
   */
  initialize(): Promise<void>;

  /**
   * Execute a specific task
   * @param task - The task to execute
   * @returns Promise resolving to the execution result
   */
  executeTask(task: Task): Promise<AgentResult>;

  /**
   * Cancel the currently executing task
   */
  cancelTask(): Promise<void>;

  /**
   * Get the current status of the agent
   * @returns The agent's current status
   */
  getStatus(): AgentStatus;

  /**
   * Check if the agent is available to accept new tasks
   * @returns True if the agent is idle and can accept tasks
   */
  isAvailable(): boolean;
}

/**
 * Interface for the agent orchestration system
 */
export interface IAgentOrchestrator {
  /**
   * Register an agent with the orchestrator
   * @param agent - The agent to register
   */
  registerAgent(agent: IAgent): void;

  /**
   * Remove a registered agent
   * @param agentId - ID of the agent to remove
   */
  removeAgent(agentId: string): void;

  /**
   * Assign a task to an available agent
   * @param task - The task to assign
   * @returns The assigned agent, or null if none available
   */
  assignTask(task: Task): Promise<IAgent | null>;

  /**
   * Get all agents that are currently available
   * @returns Array of available agents
   */
  getAvailableAgents(): IAgent[];

  /**
   * Get all registered agents
   * @returns Array of all agents
   */
  getAllAgents(): IAgent[];
}

/**
 * Interface for the task queue system
 */
export interface ITaskQueue {
  /**
   * Add a task to the queue
   * @param task - The task to enqueue
   */
  enqueue(task: Task): void;

  /**
   * Remove and return the highest priority task
   * @returns The dequeued task, or null if queue is empty
   */
  dequeue(): Task | null;

  /**
   * View the highest priority task without removing it
   * @returns The next task to be dequeued, or null
   */
  peek(): Task | null;

  /**
   * Check if the queue is empty
   * @returns True if queue has no tasks
   */
  isEmpty(): boolean;

  /**
   * Get the total number of tasks in the queue
   * @returns Number of pending tasks
   */
  size(): number;

  /**
   * Get all tasks with a specific status
   * @param status - The status to filter by
   * @returns Array of matching tasks
   */
  getTasksByStatus(status: TaskStatus): Task[];

  /**
   * Get all tasks in the queue
   * @returns Array of all tasks
   */
  getAllTasks(): Task[];
}

/**
 * Interface for the loop manager system
 */
export interface ILoopManager {
  /**
   * Start the agent loop
   */
  start(): Promise<void>;

  /**
   * Stop the agent loop
   */
  stop(): Promise<void>;

  /**
   * Pause the agent loop
   */
  pause(): Promise<void>;

  /**
   * Resume the agent loop
   */
  resume(): Promise<void>;

  /**
   * Check if the loop is currently running
   * @returns True if the loop is active and not paused
   */
  isRunning(): boolean;

  /**
   * Get statistics about the loop execution
   * @returns Object containing loop statistics
   */
  getStats(): LoopStats;
}

/**
 * Statistics about the loop execution
 */
export interface LoopStats {
  /** Total number of tasks processed */
  totalTasks: number;
  /** Number of successfully completed tasks */
  completedTasks: number;
  /** Number of failed tasks */
  failedTasks: number;
  /** Number of currently running tasks */
  runningTasks: number;
  /** Number of active (available) agents */
  activeAgents: number;
  /** Time since loop started (milliseconds) */
  uptime: number;
  /** Average time to complete a task (milliseconds) */
  averageExecutionTime: number;
  /** Number of loop iterations completed (optional) */
  loopIterations?: number;
  /** Maximum allowed loop iterations (optional) */
  maxLoopIterations?: number;
}

/**
 * Configuration for a specific project in multi-project mode
 */
export interface ProjectConfig {
  /** Name of the project */
  name: string;
  /** Working directory for the project */
  workingDirectory: string;
  /** Override global agents for this project (optional) */
  agents?: AgentConfig[];
  /** Override global concurrent task limit (optional) */
  maxConcurrentTasks?: number;
  /** Override global loop iteration limit (optional) */
  maxLoopIterations?: number;
}

/**
 * Main configuration for the Qwen Loop system
 */
export interface LoopConfig {
  /** List of agent configurations */
  agents: AgentConfig[];
  /** Maximum number of tasks to run concurrently */
  maxConcurrentTasks: number;
  /** Interval between loop iterations in milliseconds */
  loopInterval: number;
  /** Maximum number of retry attempts for failed tasks */
  maxRetries: number;
  /** Default working directory */
  workingDirectory: string;
  /** Logging verbosity level */
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  /** Whether to automatically start processing tasks */
  enableAutoStart: boolean;
  /** Maximum number of loop iterations (0 = unlimited) */
  maxLoopIterations?: number;
  /** Whether to auto-generate tasks by analyzing project */
  enableSelfTaskGeneration?: boolean;
  /** List of projects for multi-project mode (optional) */
  projects?: ProjectConfig[];
}
