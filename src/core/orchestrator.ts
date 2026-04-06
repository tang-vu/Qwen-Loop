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
    logger.debug(`📝 Agent registered: ${agent.name}`, { 
      operation: 'orchestrator.agent',
      agent: agent.name 
    });
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
        logger.error('❌ Error cancelling task during agent removal', {
          operation: 'orchestrator.cleanup',
          agent: agent.name,
          error: error instanceof Error ? error : new Error(String(error))
        });
      });

      this.agents.delete(agentId);

      // Remove task assignments
      for (const [taskId, assignedAgentId] of this.taskAssignments.entries()) {
        if (assignedAgentId === agentId) {
          this.taskAssignments.delete(taskId);
        }
      }

      logger.debug(`🗑️ Agent removed: ${agent.name}`, {
        operation: 'orchestrator.agent',
        agent: agent.name
      });
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
      logger.warn('⚠️ No available agents to assign task', { 
        operation: 'orchestrator.assignment',
        task: task.id 
      });
      return null;
    }

    // Select the first available agent (can be enhanced with load balancing, priority, etc.)
    const selectedAgent = availableAgents[0];

    this.taskAssignments.set(task.id, selectedAgent.id);
    task.assignedAgent = selectedAgent.id;

    logger.debug(`📤 Task assigned to agent: ${selectedAgent.name}`, {
      operation: 'orchestrator.assignment',
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
   * Retrieve an agent by its unique identifier
   *
   * @param agentId - The unique identifier of the agent
   * @returns The agent instance if found, undefined otherwise
   */
  getAgentById(agentId: string): IAgent | undefined {
    if (!agentId || typeof agentId !== 'string') {
      logger.warn('Attempted to get agent with invalid ID', {
        operation: 'orchestrator.get',
        agentId
      });
      return undefined;
    }
    return this.agents.get(agentId);
  }

  /**
   * Retrieve the agent ID assigned to a specific task
   *
   * @param taskId - The unique identifier of the task
   * @returns The agent ID if assigned, undefined otherwise
   */
  getTaskAssignment(taskId: string): string | undefined {
    if (!taskId || typeof taskId !== 'string') {
      return undefined;
    }
    return this.taskAssignments.get(taskId);
  }

  /**
   * Remove a task assignment
   *
   * @param taskId - The unique identifier of the task
   */
  removeTaskAssignment(taskId: string): void {
    if (!taskId || typeof taskId !== 'string') {
      return;
    }
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
   *
   * Attempts to initialize each registered agent in parallel. Agents that fail
   * to initialize are logged but don't prevent other agents from initializing.
   *
   * @throws Does not throw; logs errors for individual agent failures
   */
  async initializeAll(): Promise<void> {
    logger.info('🔧 Initializing agents...', { operation: 'orchestrator.init' });

    const initPromises = Array.from(this.agents.values()).map(async (agent) => {
      try {
        await agent.initialize();
        logger.debug(`✅ Agent initialized: ${agent.name}`, {
          operation: 'orchestrator.init',
          agent: agent.name
        });
      } catch (error) {
        logger.error(`❌ Failed to initialize agent ${agent.name}`, {
          operation: 'orchestrator.init',
          agent: agent.name,
          error: error instanceof Error ? error : new Error(String(error))
        });
        // Agent remains in ERROR state from BaseAgent.initialize()
      }
    });

    await Promise.allSettled(initPromises);

    const allAgents = Array.from(this.agents.values());
    const initializedCount = allAgents.filter(a => a.getStatus() !== AgentStatus.ERROR).length;
    logger.info('✅ Agent initialization complete', {
      operation: 'orchestrator.init',
      count: this.agents.size,
      initialized: initializedCount,
      failed: this.agents.size - initializedCount
    });
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
        logger.error(`❌ Error cancelling task during bulk cancel`, {
          operation: 'orchestrator.cleanup',
          agent: agent.name,
          error: error instanceof Error ? error : new Error(String(error))
        });
      }
    });

    await Promise.all(cancelPromises);
  }
}
