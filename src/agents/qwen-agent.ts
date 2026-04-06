import { BaseAgent } from './base-agent.js';
import { AgentConfig, Task, AgentResult, AgentType } from '../types.js';
import { logger } from '../logger.js';
import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export class QwenAgent extends BaseAgent {
  private qwenPath: string;
  private workingDir: string;

  constructor(config: AgentConfig) {
    super({
      ...config,
      type: AgentType.QWEN
    });

    // On Windows, use .cmd extension
    const isWindows = process.platform === 'win32';
    this.qwenPath = process.env.QWEN_PATH || (isWindows ? 'qwen.cmd' : 'qwen');
    this.workingDir = config.workingDirectory || process.cwd();

    if (!existsSync(this.workingDir)) {
      mkdirSync(this.workingDir, { recursive: true });
    }
  }

  protected async onInitialize(): Promise<void> {
    logger.info('Checking Qwen Code CLI installation...', { agent: this.name });

    return new Promise((resolve, reject) => {
      const checkProcess = spawn(this.qwenPath, ['--version'], {
        windowsHide: true,
        shell: true
      });

      let output = '';

      checkProcess.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      checkProcess.stderr.on('data', (data: Buffer) => {
        output += data.toString();
      });

      checkProcess.on('close', (code: number | null) => {
        logger.info(`Qwen Code CLI is available (exit code: ${code})`, { agent: this.name });
        resolve();
      });

      checkProcess.on('error', (error: Error) => {
        logger.error(`Qwen Code CLI not found: ${error.message}`, { agent: this.name });
        reject(new Error(`Qwen Code CLI is not installed or not in PATH. Install it first.`));
      });
    });
  }

  protected async onExecuteTask(task: Task, signal: AbortSignal): Promise<AgentResult> {
    const startTime = Date.now();
    
    logger.info(`Executing Qwen task: ${task.description}`, { 
      agent: this.name, 
      task: task.id 
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
        logger.debug(`Qwen output: ${text}`, { agent: this.name, task: task.id });
        
        // Try to detect file operations from output
        this.parseFileOperations(text, filesModified, filesCreated);
      });

      qwenProcess.stderr.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        logger.warn(`Qwen stderr: ${text}`, { agent: this.name, task: task.id });
      });

      // Handle abort signal
      if (signal) {
        signal.addEventListener('abort', () => {
          logger.info('Task aborted by controller', { agent: this.name, task: task.id });
          qwenProcess.kill();
          resolve({
            success: false,
            error: 'Task was cancelled',
            executionTime: Date.now() - startTime
          });
        }, { once: true });
      }

      qwenProcess.on('close', (code) => {
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

      qwenProcess.on('error', (error) => {
        resolve({
          success: false,
          error: `Failed to start Qwen process: ${error.message}`,
          executionTime: Date.now() - startTime
        });
      });
    });
  }

  private buildCommandArgs(task: Task): string[] {
    const args: string[] = [];

    // Use positional prompt (Qwen CLI default behavior)
    // Format: qwen "prompt" --approval-mode yolo --allowed-tools ... -o text
    args.push(task.description);

    // Auto-approve ALL actions - no confirmation prompts
    args.push('--approval-mode', 'yolo');

    // Auto-approve all core tools so Qwen never asks for permission
    args.push('--allowed-tools', 'Read,Write,Edit,MultiEdit,NotebookEdit,Bash,BashOutput,KillShell,Grep,LS,Glob,TodoWrite,NotebookEdit');

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
      if (!filesModified.includes(file)) {
        filesModified.push(file);
      }
    }

    while ((match = createdPattern.exec(output)) !== null) {
      const file = match[1];
      if (!filesCreated.includes(file)) {
        filesCreated.push(file);
      }
    }
  }
}
