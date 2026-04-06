import { LoopConfig, AgentConfig, AgentType } from '../types.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { logger } from '../logger.js';
import { statSync } from 'fs';

const DEFAULT_CONFIG: Partial<LoopConfig> = {
  maxConcurrentTasks: 3,
  loopInterval: 5000, // 5 seconds
  maxRetries: 3,
  workingDirectory: process.cwd(),
  logLevel: 'info',
  enableAutoStart: false,
  maxLoopIterations: 0, // 0 = unlimited
  enableSelfTaskGeneration: true
};

/**
 * Manages loading, saving, and validating Qwen Loop configuration.
 * Provides defaults and helper methods for configuration management.
 */
export class ConfigManager {
  private configPath: string;
  private config: LoopConfig;
  private configLoadedFromFile: boolean;

  /**
   * Create a new ConfigManager
   * @param configPath - Optional path to configuration file (defaults to qwen-loop.config.json in CWD)
   * @param strictMode - If true, throws errors on invalid config instead of falling back to defaults
   */
  constructor(configPath?: string, strictMode: boolean = false) {
    this.configPath = configPath || join(process.cwd(), 'qwen-loop.config.json');
    this.configLoadedFromFile = false;
    this.config = this.loadConfig(strictMode);
  }

  private loadConfig(strictMode: boolean = false): LoopConfig {
    if (existsSync(this.configPath)) {
      try {
        const configData = readFileSync(this.configPath, 'utf-8');
        const config = JSON.parse(configData);

        logger.debug(`📄 Configuration loaded from ${this.configPath}`, {
          operation: 'config.load'
        });
        this.configLoadedFromFile = true;

        return {
          ...DEFAULT_CONFIG,
          ...config,
          agents: config.agents || []
        } as LoopConfig;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`❌ Failed to load configuration`, {
          operation: 'config.error',
          configPath: this.configPath,
          error: errorMessage
        });

        if (strictMode) {
          throw new Error(`Failed to parse configuration file at ${this.configPath}: ${errorMessage}`);
        }

        logger.warn('⚠️ Falling back to default configuration due to parse error', {
          operation: 'config.fallback'
        });
        return this.getDefaultConfig();
      }
    } else {
      logger.debug('📝 No configuration file found, using defaults', {
        operation: 'config.load'
      });
      return this.getDefaultConfig();
    }
  }

  private getDefaultConfig(): LoopConfig {
    return {
      ...DEFAULT_CONFIG,
      agents: [],
      maxConcurrentTasks: DEFAULT_CONFIG.maxConcurrentTasks!,
      loopInterval: DEFAULT_CONFIG.loopInterval!,
      maxRetries: DEFAULT_CONFIG.maxRetries!,
      workingDirectory: DEFAULT_CONFIG.workingDirectory!,
      logLevel: DEFAULT_CONFIG.logLevel!,
      enableAutoStart: DEFAULT_CONFIG.enableAutoStart!
    };
  }

  /**
   * Save the current configuration to disk
   * @throws Error if saving fails
   */
  saveConfig(): void {
    try {
      const configDir = dirname(this.configPath);
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }

      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      logger.debug(`💾 Configuration saved to ${this.configPath}`, {
        operation: 'config.save'
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Failed to save configuration`, {
        operation: 'config.error',
        configPath: this.configPath,
        error: errorMessage
      });
      throw new Error(`Failed to save configuration: ${errorMessage}`);
    }
  }

  /**
   * Get the current configuration
   * @returns The current LoopConfig object
   */
  getConfig(): LoopConfig {
    return this.config;
  }

  /**
   * Check if the configuration was successfully loaded from a file
   * @returns True if config file exists and was parsed, false if using defaults
   */
  isConfigLoadedFromFile(): boolean {
    return this.configLoadedFromFile;
  }

  /**
   * Update the configuration with new values and save to disk
   *
   * Merges the provided updates with the current configuration and persists
   * the result to the configuration file. Updates are applied shallowly.
   *
   * @param updates - Partial configuration object to merge with current config
   * @throws Error if saving the configuration fails
   */
  updateConfig(updates: Partial<LoopConfig>): void {
    if (!updates || typeof updates !== 'object') {
      throw new Error('Configuration updates must be a valid object');
    }
    this.config = {
      ...this.config,
      ...updates
    };
    this.saveConfig();
  }

  /**
   * Add a new agent configuration to the config
   *
   * Appends the agent to the configuration's agents array and persists
   * the changes to disk.
   *
   * @param agentConfig - The agent configuration to add
   * @throws Error if agentConfig is invalid or saving fails
   */
  addAgent(agentConfig: AgentConfig): void {
    if (!agentConfig || !agentConfig.name || !agentConfig.type) {
      throw new Error('Agent configuration must include name and type');
    }
    this.config.agents.push(agentConfig);
    this.saveConfig();
    logger.debug(`➕ Agent added to configuration: ${agentConfig.name}`, {
      operation: 'config.agent',
      agent: agentConfig.name
    });
  }

  /**
   * Remove an agent configuration by name
   *
   * Finds and removes the first agent matching the provided name, then
   * persists the changes to disk.
   *
   * @param agentName - Name of the agent to remove
   * @returns True if an agent was found and removed, false otherwise
   */
  removeAgent(agentName: string): boolean {
    const index = this.config.agents.findIndex(a => a.name === agentName);
    if (index !== -1) {
      const removed = this.config.agents.splice(index, 1)[0];
      this.saveConfig();
      logger.debug(`➖ Agent removed from configuration: ${agentName}`, {
        operation: 'config.agent',
        agent: agentName
      });
      return true;
    }
    return false;
  }

  /**
   * Get all agent configurations
   * @returns Array of agent configurations
   */
  getAgents(): AgentConfig[] {
    return this.config.agents;
  }

  /**
   * Generate an example configuration for single-project mode.
   *
   * Returns a pre-configured LoopConfig object with sensible defaults, including
   * a Qwen agent, conservative task limits, and self-task generation enabled.
   * Useful as a starting point for new users or for testing.
   *
   * @returns A JSON-formatted string representing an example LoopConfig object.
   */
  generateExampleConfig(): string {
    const exampleConfig: LoopConfig = {
      agents: [
        {
          name: 'qwen-dev',
          type: AgentType.QWEN,
          maxTokens: 8192,
          timeout: 300000,
          workingDirectory: './project'
        }
      ],
      maxConcurrentTasks: 1,
      loopInterval: 5000,
      maxRetries: 2,
      workingDirectory: './project',
      logLevel: 'info',
      enableAutoStart: false,
      maxLoopIterations: 5,
      enableSelfTaskGeneration: true
    };

    return JSON.stringify(exampleConfig, null, 2);
  }

  /**
   * Generate an example configuration for multi-project mode.
   *
   * Returns a pre-configured LoopConfig object with a `projects` array containing
   * two example projects. Useful for users who want to run the loop across
   * multiple repositories or directories.
   *
   * @returns A JSON-formatted string representing an example multi-project LoopConfig.
   */
  generateMultiProjectExampleConfig(): string {
    const exampleConfig: LoopConfig = {
      agents: [
        {
          name: 'qwen-dev',
          type: AgentType.QWEN,
          timeout: 120000
        }
      ],
      maxConcurrentTasks: 1,
      loopInterval: 5000,
      maxRetries: 2,
      workingDirectory: './',
      logLevel: 'info',
      enableAutoStart: false,
      maxLoopIterations: 3,
      enableSelfTaskGeneration: true,
      projects: [
        {
          name: 'project-a',
          workingDirectory: './project-a',
          maxLoopIterations: 3
        },
        {
          name: 'project-b',
          workingDirectory: './project-b',
          maxLoopIterations: 5
        }
      ]
    };

    return JSON.stringify(exampleConfig, null, 2);
  }

  /**
   * Validate the current configuration and return a list of errors.
   *
   * Checks for required fields, valid ranges, and filesystem existence of directories.
   * An empty array indicates a valid configuration.
   *
   * @returns An array of error message strings. Empty if configuration is valid.
   */
  validateConfig(): string[] {
    const errors: string[] = [];

    if (!this.config.agents || this.config.agents.length === 0) {
      errors.push('No agents configured');
    }

    if (this.config.maxConcurrentTasks < 1) {
      errors.push('maxConcurrentTasks must be at least 1');
    }

    if (this.config.loopInterval < 1000) {
      errors.push('loopInterval must be at least 1000ms (1 second)');
    }

    if (this.config.maxRetries < 0) {
      errors.push('maxRetries must be non-negative');
    }

    // Validate working directory exists
    if (this.config.workingDirectory && !existsSync(this.config.workingDirectory)) {
      errors.push(`Working directory does not exist: ${this.config.workingDirectory}`);
    }

    // Validate agents
    for (const agent of this.config.agents) {
      if (!agent.name) {
        errors.push('Agent must have a name');
      }
      if (!agent.type) {
        errors.push(`Agent ${agent.name} must have a type`);
      }
      // Validate agent working directory if specified
      if (agent.workingDirectory && !existsSync(agent.workingDirectory)) {
        errors.push(`Agent ${agent.name} working directory does not exist: ${agent.workingDirectory}`);
      }
    }

    return errors;
  }
}
