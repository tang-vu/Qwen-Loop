import { IAgent, IAgentOrchestrator, Task, AgentStatus } from '../types.js';
import { logger } from '../logger.js';

/**
 * Manages agent registration, task assignment, and orchestration.
 * Coordinates multiple agents and distributes tasks among them.
 */
export class AgentOrchestrator implements IAgentOrchestrator {
  private agents: Map<string, IAgent> = new Map();
  private taskAssignments: Map<string, string> = new Map(); // taskId -> agentId

  /**
   * Register an agent with the orchestrator
   * @param agent - The agent instance to register
   * @throws Error if agent is null or undefined
   */
  registerAgent(agent: IAgent): void {
    if (!agent) {
      throw new Error('Cannot register null or undefined agent');
    }
    this.agents.set(agent.id, agent);
    logger.debug(`Agent registered: ${agent.name}`, { agent: agent.name });
  }

  /**
   * Remove a registered agent and clean up its task assignments
   * @param agentId - The unique identifier of the agent to remove
   */
  removeAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      // Cancel any running tasks
      agent.cancelTask().catch((error) => {
        logger.error(`Error cancelling task during agent removal`, {
          agent: agent.name,
          error
        });
      });

      this.agents.delete(agentId);

      // Remove task assignments
      for (const [taskId, assignedAgentId] of this.taskAssignments.entries()) {
        if (assignedAgentId === agentId) {
          this.taskAssignments.delete(taskId);
        }
      }

      logger.debug(`Agent removed: ${agent.name}`, { agent: agent.name });
    }
  }

  /**
   * Assign a task to an available agent
   * @param task - The task to assign
   * @returns The assigned agent, or null if no agents are available
   */
  async assignTask(task: Task): Promise<IAgent | null> {
    const availableAgents = this.getAvailableAgents();

    if (availableAgents.length === 0) {
      logger.warn('No available agents to assign task', { task: task.id });
      return null;
    }

    // Select the first available agent (can be enhanced with load balancing, priority, etc.)
    const selectedAgent = availableAgents[0];

    this.taskAssignments.set(task.id, selectedAgent.id);
    task.assignedAgent = selectedAgent.id;

    logger.debug(`Task assigned to agent: ${selectedAgent.name}`, {
      agent: selectedAgent.name,
      task: task.id
    });

    return selectedAgent;
  }

  /**
   * Get all agents that are currently available (idle)
   * @returns Array of available agent instances
   */
  getAvailableAgents(): IAgent[] {
    const available: IAgent[] = [];

    for (const agent of this.agents.values()) {
      if (agent.isAvailable()) {
        available.push(agent);
      }
    }

    return available;
  }

  /**
   * Get all registered agents
   * @returns Array of all registered agents
   */
  getAllAgents(): IAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get an agent by its ID
   * @param agentId - The unique identifier of the agent
   * @returns The agent instance if found, undefined otherwise
   */
  getAgentById(agentId: string): IAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get the agent ID assigned to a specific task
   * @param taskId - The unique identifier of the task
   * @returns The agent ID if assigned, undefined otherwise
   */
  getTaskAssignment(taskId: string): string | undefined {
    return this.taskAssignments.get(taskId);
  }

  /**
   * Remove a task assignment
   * @param taskId - The unique identifier of the task
   */
  removeTaskAssignment(taskId: string): void {
    this.taskAssignments.delete(taskId);
  }

  /**
   * Get a formatted status report for all agents
   * @returns A human-readable status report showing agent states
   */
  getAgentStatusReport(): string {
    let report = '\n=== Agent Status Report ===\n';
    report += `Total Agents: ${this.agents.size}\n`;
    report += `Available: ${this.getAvailableAgents().length}\n`;
    report += `Busy: ${this.getAllAgents().filter(a => a.getStatus() === AgentStatus.BUSY).length}\n`;
    report += `Error: ${this.getAllAgents().filter(a => a.getStatus() === AgentStatus.ERROR).length}\n\n`;

    for (const agent of this.agents.values()) {
      const status = agent.getStatus();
      const statusIcon = status === AgentStatus.IDLE ? '🟢' :
                         status === AgentStatus.BUSY ? '🔴' :
                         status === AgentStatus.ERROR ? '❌' : '⚫';
      report += `${statusIcon} ${agent.name} (${agent.type}) - ${status}\n`;
    }

    return report;
  }

  /**
   * Initialize all registered agents
   * @throws Does not throw; logs errors for individual agent failures
   */
  async initializeAll(): Promise<void> {
    logger.info('Initializing agents...');

    const initPromises = Array.from(this.agents.values()).map(async (agent) => {
      try {
        await agent.initialize();
        logger.debug(`Agent initialized: ${agent.name}`, { agent: agent.name });
      } catch (error) {
        logger.error(`Failed to initialize agent ${agent.name}`, {
          agent: agent.name,
          error
        });
      }
    });

    await Promise.all(initPromises);

    logger.info('Agent initialization complete', { count: this.agents.size });
  }

  /**
   * Cancel all currently running tasks across all agents
   * @throws Does not throw; logs errors for individual agent failures
   */
  async cancelAllTasks(): Promise<void> {
    const cancelPromises = Array.from(this.agents.values()).map(async (agent) => {
      try {
        await agent.cancelTask();
      } catch (error) {
        logger.error(`Error cancelling task during bulk cancel`, {
          agent: agent.name,
          error
        });
      }
    });

    await Promise.all(cancelPromises);
  }
}
