import { ITaskQueue, Task, TaskStatus, TaskPriority } from '../types.js';
import { logger } from '../logger.js';

/**
 * Priority-based task queue implementation.
 * Maintains separate queues for each priority level and processes
 * tasks in priority order (CRITICAL > HIGH > MEDIUM > LOW).
 */
export class TaskQueue implements ITaskQueue {
  private tasks: Map<string, Task> = new Map();
  private priorityQueues: Map<TaskPriority, Task[]> = new Map();

  constructor() {
    // Initialize priority queues
    this.priorityQueues.set(TaskPriority.CRITICAL, []);
    this.priorityQueues.set(TaskPriority.HIGH, []);
    this.priorityQueues.set(TaskPriority.MEDIUM, []);
    this.priorityQueues.set(TaskPriority.LOW, []);
  }

  /**
   * Add a task to the queue with the specified priority.
   *
   * Sets the task status to PENDING and assigns a creation timestamp.
   * If the task already has a `createdAt` timestamp (e.g., a re-queued task),
   * the original timestamp is preserved.
   *
   * @param task - The task to enqueue. Must be a valid Task object with a unique `id`.
   * @throws {Error} If `task` is null or undefined.
   * @throws {Error} If a task with the same `id` already exists in the queue.
   */
  enqueue(task: Task): void {
    if (!task) {
      throw new Error('TaskQueue.enqueue: task must not be null or undefined');
    }
    if (!task.id) {
      throw new Error('TaskQueue.enqueue: task must have a valid non-empty "id" string');
    }
    if (this.tasks.has(task.id)) {
      throw new Error(`TaskQueue.enqueue: a task with id "${task.id}" already exists in the queue. Remove the existing task first or use a unique id.`);
    }

    task.status = TaskStatus.PENDING;

    // Preserve existing createdAt for re-queued tasks; only set it for brand-new tasks
    if (!task.createdAt) {
      task.createdAt = new Date();
    }

    this.tasks.set(task.id, task);

    const queue = this.priorityQueues.get(task.priority);
    if (queue) {
      queue.push(task);
      logger.debug(`📥 Task enqueued`, { 
        operation: 'queue.enqueue',
        task: task.id, 
        priority: task.priority 
      });
    } else {
      // This should be unreachable if TaskPriority enum is used correctly
      throw new Error(`TaskQueue.enqueue: invalid priority level "${task.priority}" for task "${task.id}"`);
    }
  }

  /**
   * Remove and return the highest priority task from the queue.
   *
   * Iterates through priority levels in descending order (CRITICAL > HIGH > MEDIUM > LOW)
   * and returns the first available task.
   *
   * @returns The highest-priority pending task, or `null` if the queue is empty.
   */
  dequeue(): Task | null {
    // Process tasks in priority order: CRITICAL > HIGH > MEDIUM > LOW
    const priorityOrder = [
      TaskPriority.CRITICAL,
      TaskPriority.HIGH,
      TaskPriority.MEDIUM,
      TaskPriority.LOW
    ];

    for (const priority of priorityOrder) {
      const queue = this.priorityQueues.get(priority);
      if (queue && queue.length > 0) {
        const task = queue.shift()!;
        logger.debug(`📤 Task dequeued`, { 
          operation: 'queue.dequeue',
          task: task.id, 
          priority: task.priority 
        });
        return task;
      }
    }

    return null;
  }

  /**
   * View the highest priority task without removing it from the queue.
   *
   * Inspects the queue in priority order (CRITICAL > HIGH > MEDIUM > LOW) and
   * returns the first available task without modifying the queue state.
   *
   * @returns The next task that would be dequeued, or `null` if the queue is empty.
   */
  peek(): Task | null {
    const priorityOrder = [
      TaskPriority.CRITICAL,
      TaskPriority.HIGH,
      TaskPriority.MEDIUM,
      TaskPriority.LOW
    ];

    for (const priority of priorityOrder) {
      const queue = this.priorityQueues.get(priority);
      if (queue && queue.length > 0) {
        return queue[0];
      }
    }

    return null;
  }

  /**
   * Check whether the queue contains any pending tasks.
   *
   * Scans all priority levels to determine if there are tasks waiting to be processed.
   *
   * @returns `true` if no pending tasks exist across all priority levels, `false` otherwise.
   */
  isEmpty(): boolean {
    for (const queue of this.priorityQueues.values()) {
      if (queue.length > 0) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get the total number of pending tasks currently in the queue.
   *
   * Sums the task counts across all priority levels. Note that this only counts
   * tasks still in the priority queues (pending), not all tasks tracked by the queue.
   *
   * @returns The total number of pending tasks across all priority levels.
   */
  size(): number {
    let total = 0;
    for (const queue of this.priorityQueues.values()) {
      total += queue.length;
    }
    return total;
  }

  /**
   * Retrieve all tasks that match a specific status.
   *
   * Searches through all tasks tracked by the queue (not just pending ones) and
   * returns shallow copies of those whose `status` matches the provided value.
   * Returning copies prevents external mutation of internal task state.
   *
   * @param status - The task status to filter by (e.g., `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`).
   * @returns An array of task copies with the specified status. Returns an empty array if none match.
   */
  getTasksByStatus(status: TaskStatus): Task[] {
    return Array.from(this.tasks.values())
      .filter(task => task.status === status)
      .map(task => ({ ...task })); // Return shallow copies to prevent external mutation
  }

  /**
   * Retrieve all tasks currently tracked by the queue.
   *
   * This includes tasks in every state (pending, running, completed, failed),
   * not just those still waiting in the priority queues.
   * Returns shallow copies to prevent external mutation of internal state.
   *
   * @returns An array of task copies regardless of their current status.
   */
  getAllTasks(): Task[] {
    return Array.from(this.tasks.values()).map(task => ({ ...task })); // Return shallow copies
  }

  /**
   * Retrieve a specific task by its unique identifier.
   *
   * Returns a shallow copy of the task to prevent external mutation of internal state.
   *
   * @param taskId - The unique identifier of the task to look up.
   * @returns A copy of the matching `Task` if found, or `undefined` if no task with the given ID exists.
   */
  getTaskById(taskId: string): Task | undefined {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : undefined; // Return shallow copy
  }

  /**
   * Update the status of an existing task.
   *
   * @param taskId - The unique identifier of the task to update.
   * @param status - The new status to assign to the task.
   * @throws {Error} If `taskId` is null, undefined, or empty.
   * @throws {Error} If no task with the given `taskId` exists in the queue.
   */
  updateTaskStatus(taskId: string, status: TaskStatus): void {
    if (!taskId) {
      throw new Error('TaskQueue.updateTaskStatus: taskId must not be null, undefined, or empty');
    }
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`TaskQueue.updateTaskStatus: no task found with id "${taskId}"`);
    }
    task.status = status;
    logger.debug(`🔄 Task status updated`, { 
      operation: 'queue.status',
      task: taskId, 
      status 
    });
  }

  /**
   * Remove a task from the queue by its unique identifier.
   *
   * Removes the task from both the internal task map and the corresponding priority queue.
   *
   * @param taskId - The unique identifier of the task to remove.
   * @returns `true` if the task was found and removed, `false` if no task with the given ID existed.
   * @throws {Error} If `taskId` is null, undefined, or empty.
   */
  removeTask(taskId: string): boolean {
    if (!taskId) {
      throw new Error('TaskQueue.removeTask: taskId must not be null, undefined, or empty');
    }
    const task = this.tasks.get(taskId);
    if (task) {
      this.tasks.delete(taskId);

      // Remove from priority queue
      for (const queue of this.priorityQueues.values()) {
        const index = queue.findIndex(t => t.id === taskId);
        if (index !== -1) {
          queue.splice(index, 1);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Generate a formatted, human-readable report with current queue statistics.
   *
   * Includes total task counts, per-priority breakdowns, and per-status breakdowns.
   *
   * @returns A multi-line string containing queue statistics.
   */
  getQueueStats(): string {
    let stats = '\n=== Task Queue Stats ===\n';
    stats += `Total Tasks: ${this.tasks.size}\n`;
    stats += `Pending in Queue: ${this.size()}\n\n`;
    
    stats += 'By Priority:\n';
    for (const [priority, queue] of this.priorityQueues.entries()) {
      stats += `  ${priority}: ${queue.length}\n`;
    }
    
    const pendingTasks = this.getTasksByStatus(TaskStatus.PENDING);
    const runningTasks = this.getTasksByStatus(TaskStatus.RUNNING);
    const completedTasks = this.getTasksByStatus(TaskStatus.COMPLETED);
    const failedTasks = this.getTasksByStatus(TaskStatus.FAILED);
    
    stats += '\nBy Status:\n';
    stats += `  PENDING: ${pendingTasks.length}\n`;
    stats += `  RUNNING: ${runningTasks.length}\n`;
    stats += `  COMPLETED: ${completedTasks.length}\n`;
    stats += `  FAILED: ${failedTasks.length}\n`;
    
    return stats;
  }
}
