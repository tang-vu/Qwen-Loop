import { BaseAgent } from './base-agent.js';
import { AgentConfig, Task, AgentResult, AgentType } from '../types.js';
import { logger } from '../logger.js';
import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Agent implementation that uses Qwen Code CLI to execute tasks.
 *
 * This agent spawns the `qwen` CLI process with task descriptions as prompts.
 * It supports custom models, working directories, and additional CLI arguments.
 *
 * @example
 * ```typescript
 * const agent = new QwenAgent({
 *   name: 'code-reviewer',
 *   type: AgentType.QWEN,
 *   model: 'qwen-max',
 *   workingDirectory: '/path/to/project'
 * });
 * await agent.initialize();
 * const result = await agent.executeTask({
 *   id: 'task-1',
 *   description: 'Review the codebase for issues'
 * });
 * ```
 */
export class QwenAgent extends BaseAgent {
  /** Path to the Qwen Code CLI executable */
  private qwenPath: string;
  /** Working directory for Qwen CLI operations */
  private workingDir: string;

  /**
   * Creates a new QwenAgent instance.
   *
   * @param config - Agent configuration. May include optional `model`, `workingDirectory`,
   *                 and `additionalArgs` for customizing Qwen CLI behavior.
   * @throws Error if config is null or undefined
   */
  constructor(config: AgentConfig) {
    if (!config) {
      throw new Error('Agent configuration is required for QwenAgent');
    }

    super({
      ...config,
      type: AgentType.QWEN
    });

    // On Windows, use .cmd extension
    const isWindows = process.platform === 'win32';
    this.qwenPath = process.env.QWEN_PATH || (isWindows ? 'qwen.cmd' : 'qwen');
    this.workingDir = config.workingDirectory || process.cwd();

    if (!existsSync(this.workingDir)) {
      logger.debug(`📁 Creating working directory`, { 
        agent: this.name, 
        workingDir: this.workingDir,
        operation: 'agent.init'
      });
      mkdirSync(this.workingDir, { recursive: true });
    }
  }

  /**
   * Initializes the QwenAgent by verifying CLI availability.
   *
   * Runs `qwen --version` to confirm the CLI is installed and accessible.
   * This ensures tasks won't fail later due to a missing executable.
   *
   * @returns Promise that resolves when CLI verification is complete
   * @throws Error if Qwen Code CLI is not found in PATH
   */
  protected async onInitialize(): Promise<void> {
    logger.debug('🔍 Verifying Qwen Code CLI availability', {
      agent: this.name,
      operation: 'agent.init',
      qwenPath: this.qwenPath
    });

    return new Promise((resolve, reject) => {
      const checkProcess = spawn(this.qwenPath, ['--version'], {
        windowsHide: true,
        shell: true
      });

      checkProcess.on('close', (code: number | null) => {
        logger.debug(`✅ Qwen Code CLI check complete`, {
          agent: this.name,
          exitCode: code,
          operation: 'agent.init'
        });
        resolve();
      });

      checkProcess.on('error', (error: Error) => {
        logger.error(`❌ Qwen Code CLI not found`, {
          agent: this.name,
          operation: 'agent.init',
          error,
          path: this.qwenPath
        });
        reject(new Error(
          `Qwen Code CLI is not installed or not in PATH. ` +
          `Searched for: '${this.qwenPath}'. ` +
          `Install it first or set QWEN_PATH environment variable.`
        ));
      });
    });
  }

  /**
   * Executes a task by spawning Qwen Code CLI with the task description as a prompt.
   *
   * The CLI is invoked with the task description as a positional argument,
   * along with `--yolo` mode and any configured model or additional arguments.
   *
   * @param task - The task to execute. Must have a valid `description` field.
   * @param signal - AbortSignal for cooperative task cancellation
   * @returns Promise resolving to an AgentResult with CLI output, modified/created files, and timing
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

    logger.info(`▶️ Executing task`, {
      operation: 'task.execution',
      agent: this.name,
      task: task.id,
      description: task.description.slice(0, 80)
    });

    // Build the command based on task description
    const args = this.buildCommandArgs(task);

    return new Promise((resolve) => {
      const qwenProcess = spawn(this.qwenPath, args, {
        cwd: this.workingDir,
        windowsHide: true,
        shell: true
      });

      let output = '';
      let errorOutput = '';
      const filesModified: string[] = [];
      const filesCreated: string[] = [];

      qwenProcess.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;

        // Log only significant output (errors or substantial content)
        if (text.length > 50 && !text.includes('Progress')) {
          logger.debug(`📝 Agent output received`, { 
            operation: 'task.execution',
            agent: this.name, 
            task: task.id, 
            length: text.length 
          }, 10000);
        }

        // Try to detect file operations from output
        this.parseFileOperations(text, filesModified, filesCreated);
      });

      qwenProcess.stderr.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        // Only log stderr if it's significant (not just warnings)
        if (!text.includes('Warning') && !text.includes('warning')) {
          logger.debug(`⚠️ Agent stderr received`, { 
            operation: 'task.execution',
            agent: this.name, 
            task: task.id, 
            length: text.length 
          }, 10000);
        }
      });

      // Handle abort signal
      signal.addEventListener('abort', () => {
        logger.info('🚫 Task aborted by user', { 
          operation: 'task.abort',
          agent: this.name, 
          task: task.id 
        });
        qwenProcess.kill();
        resolve({
          success: false,
          error: 'Task was cancelled by user',
          executionTime: Date.now() - startTime
        });
      }, { once: true });

      qwenProcess.on('close', (code) => {
        const success = code === 0;

        resolve({
          success,
          output: output || undefined,
          error: success ? undefined : (errorOutput || `Qwen process exited with code ${code}`),
          executionTime: Date.now() - startTime,
          filesModified: filesModified.length > 0 ? filesModified : undefined,
          filesCreated: filesCreated.length > 0 ? filesCreated : undefined
        });
      });

      qwenProcess.on('error', (error) => {
        resolve({
          success: false,
          error: `Failed to start Qwen process ('${this.qwenPath}'): ${error.message}`,
          executionTime: Date.now() - startTime
        });
      });
    });
  }

  /**
   * Builds CLI arguments for the Qwen process based on task and configuration.
   *
   * Constructs the argument array in this order:
   * 1. Task description (positional prompt)
   * 2. `--yolo` flag for autonomous mode
   * 3. Model flag (if configured)
   * 4. Output format flag
   * 5. Any additional arguments from config
   *
   * @param task - The task containing the description to use as a prompt
   * @returns Array of CLI arguments to pass to spawn
   */
  private buildCommandArgs(task: Task): string[] {
    const args: string[] = [];

    // Use positional prompt (Qwen CLI default behavior)
    // Format: qwen "prompt" -o text
    args.push(task.description);

    // Use --yolo shorthand flag (official, shorter, well-tested)
    args.push('--yolo');

    // Add model if specified
    if (this.config.model) {
      args.push('-m', this.config.model);
    }

    // Add output format
    args.push('-o', 'text');

    // Add custom args from config
    if (this.config.additionalArgs) {
      args.push(...this.config.additionalArgs);
    }

    return args;
  }

  /**
   * Parses CLI output to detect file modification and creation operations.
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
    // Simple regex patterns to detect file operations
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
   * Get the Qwen CLI path configured for this agent
   *
   * @returns The path or command name for the Qwen CLI executable
   */
  getQwenPath(): string {
    return this.qwenPath;
  }
}
