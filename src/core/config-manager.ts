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

        logger.debug(`Configuration loaded from ${this.configPath}`);
        this.configLoadedFromFile = true;

        return {
          ...DEFAULT_CONFIG,
          ...config,
          agents: config.agents || []
        } as LoopConfig;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to load configuration: ${errorMessage}`);
        
        if (strictMode) {
          throw new Error(`Failed to parse configuration file at ${this.configPath}: ${errorMessage}`);
        }
        
        logger.warn('Falling back to default configuration due to parse error');
        return this.getDefaultConfig();
      }
    } else {
      logger.debug('No configuration file found, using defaults');
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
      logger.debug(`Configuration saved to ${this.configPath}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to save configuration: ${errorMessage}`);
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
   * @param updates - Partial configuration to merge with current config
   */
  updateConfig(updates: Partial<LoopConfig>): void {
    this.config = {
      ...this.config,
      ...updates
    };
    this.saveConfig();
  }

  /**
   * Add a new agent configuration to the config
   * @param agentConfig - The agent configuration to add
   */
  addAgent(agentConfig: AgentConfig): void {
    this.config.agents.push(agentConfig);
    this.saveConfig();
    logger.debug(`Agent added to configuration: ${agentConfig.name}`);
  }

  /**
   * Remove an agent configuration by name
   * @param agentName - Name of the agent to remove
   */
  removeAgent(agentName: string): void {
    const index = this.config.agents.findIndex(a => a.name === agentName);
    if (index !== -1) {
      this.config.agents.splice(index, 1);
      this.saveConfig();
      logger.debug(`Agent removed from configuration: ${agentName}`);
    }
  }

  /**
   * Get all agent configurations
   * @returns Array of agent configurations
   */
  getAgents(): AgentConfig[] {
    return this.config.agents;
  }

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
