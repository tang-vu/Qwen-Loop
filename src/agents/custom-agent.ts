import { BaseAgent } from './base-agent.js';
import { AgentConfig, Task, AgentResult, AgentType } from '../types.js';
import { logger } from '../logger.js';
import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';

/**
 * Agent implementation that uses a custom CLI command to execute tasks.
 *
 * This agent spawns the specified command with task descriptions as arguments.
 * It is useful for integrating with any CLI-based tool that can process task
 * descriptions from the command line.
 *
 * @example
 * ```typescript
 * const agent = new CustomAgent({
 *   name: 'my-custom-tool',  // The command to execute
 *   type: AgentType.CUSTOM,
 *   workingDirectory: '/path/to/project',
 *   additionalArgs: ['--verbose']
 * });
 * await agent.initialize();
 * const result = await agent.executeTask({
 *   id: 'task-1',
 *   description: 'Process this data'
 * });
 * ```
 */
export class CustomAgent extends BaseAgent {
  /** The CLI command to execute for tasks */
  private command: string;
  /** Working directory for command execution */
  private workingDir: string;

  /**
   * Creates a new CustomAgent instance.
   *
   * @param config - Agent configuration where `name` is the command to execute.
   *                 May include `workingDirectory`, `model`, `maxTokens`, and `additionalArgs`.
   * @throws Error if config is null or undefined
   */
  constructor(config: AgentConfig) {
    if (!config) {
      throw new Error('Agent configuration is required for CustomAgent');
    }
    if (!config.name) {
      throw new Error('Agent name (CLI command) is required for CustomAgent');
    }

    super({
      ...config,
      type: AgentType.CUSTOM
    });

    // For custom agents, the config.name should be the command to execute
    this.command = config.name;
    this.workingDir = config.workingDirectory || process.cwd();

    if (!existsSync(this.workingDir)) {
      logger.debug(`Creating working directory`, { agent: this.name, workingDir: this.workingDir });
      mkdirSync(this.workingDir, { recursive: true });
    }
  }

  /**
   * Initializes the CustomAgent by verifying command availability.
   *
   * Runs `<command> --help` to confirm the CLI is accessible. Unlike QwenAgent,
   * this method resolves even on failure to allow execution attempts
   * (some commands may not support --help but still work).
   *
   * @returns Promise that resolves when command verification is complete
   */
  protected async onInitialize(): Promise<void> {
    logger.debug(`Verifying custom agent command`, { agent: this.name, command: this.command });

    return new Promise((resolve) => {
      const checkProcess = spawn(this.command, ['--help'], {
        timeout: 10000,
        windowsHide: true
      });

      checkProcess.on('close', (code) => {
        logger.debug(`Command check complete`, { agent: this.name, exitCode: code });
        resolve();
      });

      checkProcess.on('error', (error) => {
        logger.warn(`Command verification failed`, { 
          agent: this.name, 
          command: this.command, 
          error: error.message 
        });
        // Still resolve to allow execution (some commands may not support --help)
        resolve();
      });
    });
  }

  /**
   * Executes a task by spawning the configured CLI command.
   *
   * The command is invoked with any configured additional arguments,
   * followed by the task description. Model and max-tokens arguments
   * are added if present in the configuration.
   *
   * @param task - The task to execute. Must have a valid `description` field.
   * @param signal - AbortSignal for cooperative task cancellation
   * @returns Promise resolving to an AgentResult with command output, modified/created files, and timing
   * @throws Error if task description is null or empty
   */
  protected async onExecuteTask(task: Task, signal: AbortSignal): Promise<AgentResult> {
    if (!task || !task.description) {
      return {
        success: false,
        error: 'Task description is required and cannot be null or empty',
        executionTime: 0
      };
    }

    const startTime = Date.now();

    logger.info(`Executing task`, {
      agent: this.name,
      task: task.id,
      description: task.description.slice(0, 80)
    });

    // Build the command
    const args = this.buildCommandArgs(task);

    return new Promise((resolve) => {
      const childProcess = spawn(this.command, args, {
        cwd: this.workingDir,
        windowsHide: true,
        shell: true
      });

      let output = '';
      let errorOutput = '';
      const filesModified: string[] = [];
      const filesCreated: string[] = [];

      childProcess.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;
        // Log only significant output
        if (text.length > 50 && !text.includes('Progress')) {
          logger.debug(`Agent output received`, { agent: this.name, task: task.id, length: text.length }, 10000);
        }
        this.parseFileOperations(text, filesModified, filesCreated);
      });

      childProcess.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        errorOutput += text;
        // Only log stderr if it's significant (not just warnings)
        if (!text.includes('Warning') && !text.includes('warning')) {
          logger.debug(`Agent stderr received`, { agent: this.name, task: task.id, length: text.length }, 10000);
        }
      });

      signal.addEventListener('abort', () => {
        logger.info('Task aborted by user', { agent: this.name, task: task.id });
        childProcess.kill();
        resolve({
          success: false,
          error: 'Task was cancelled by user',
          executionTime: Date.now() - startTime
        });
      }, { once: true });

      childProcess.on('close', (code: number | null) => {
        const success = code === 0;

        resolve({
          success,
          output: output || undefined,
          error: success ? undefined : (errorOutput || `Process exited with code ${code}`),
          executionTime: Date.now() - startTime,
          filesModified: filesModified.length > 0 ? filesModified : undefined,
          filesCreated: filesCreated.length > 0 ? filesCreated : undefined
        });
      });

      childProcess.on('error', (error: Error) => {
        resolve({
          success: false,
          error: `Failed to start process ('${this.command}'): ${error.message}`,
          executionTime: Date.now() - startTime
        });
      });
    });
  }

  /**
   * Builds CLI arguments for the child process based on task and configuration.
   *
   * Constructs the argument array in this order:
   * 1. Additional arguments from config (if any)
   * 2. Task description (positional argument)
   * 3. Model argument (if configured)
   * 4. Max-tokens argument (if configured)
   *
   * @param task - The task containing the description to pass as an argument
   * @returns Array of CLI arguments to pass to spawn
   */
  private buildCommandArgs(task: Task): string[] {
    const args: string[] = [];

    if (this.config.additionalArgs) {
      args.push(...this.config.additionalArgs);
    }

    args.push(task.description);

    if (this.config.model) {
      args.push('--model', this.config.model);
    }

    if (this.config.maxTokens) {
      args.push('--max-tokens', this.config.maxTokens.toString());
    }

    return args;
  }

  /**
   * Parses command output to detect file modification and creation operations.
   *
   * Uses regex patterns to identify lines indicating files were modified or created.
   * Results are accumulated in the provided arrays.
   *
   * @param output - The stdout text to parse
   * @param filesModified - Array to accumulate detected modified file paths
   * @param filesCreated - Array to accumulate detected created file paths
   */
  private parseFileOperations(
    output: string,
    filesModified: string[],
    filesCreated: string[]
  ): void {
    const modifiedPattern = /(?:modified|updated|changed)\s+([^\s]+\.\w+)/gi;
    const createdPattern = /(?:created|written|new file)\s+([^\s]+\.\w+)/gi;

    let match;
    while ((match = modifiedPattern.exec(output)) !== null) {
      const file = match[1];
      if (file && !filesModified.includes(file)) {
        filesModified.push(file);
      }
    }

    while ((match = createdPattern.exec(output)) !== null) {
      const file = match[1];
      if (file && !filesCreated.includes(file)) {
        filesCreated.push(file);
      }
    }
  }

  /**
   * Get the working directory configured for this agent
   *
   * @returns The absolute or relative path to the working directory
   */
  getWorkingDirectory(): string {
    return this.workingDir;
  }

  /**
   * Get the CLI command configured for this agent
   *
   * @returns The command name or path to the CLI executable
   */
  getCommand(): string {
    return this.command;
  }
}
