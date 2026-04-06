#!/usr/bin/env node

import { Command, Help, Option } from 'commander';
import { LoopManager } from './core/loop-manager.js';
import { MultiProjectManager } from './core/multi-project-manager.js';
import { ConfigManager } from './core/config-manager.js';
import { QwenAgent, CustomAgent } from './agents/index.js';
import { TaskPriority, AgentType, AgentStatus, AgentConfig, ProjectConfig, LoopConfig, IAgent } from './types.js';
import { logger, setLogLevel } from './logger.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { confirm, input, select } from '@inquirer/prompts';
import { registerHealthCommand } from './commands/health-command.js';
import ora from 'ora';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageJson: { version: string } = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
);

// Track if color output should be disabled
let enableColors = true;

/**
 * Error codes for programmatic exit
 */
enum ExitCode {
  SUCCESS = 0,
  GENERAL_ERROR = 1,
  CONFIG_NOT_FOUND = 2,
  CONFIG_INVALID = 3,
  FILE_NOT_FOUND = 4,
  PERMISSION_DENIED = 5,
  PORT_IN_USE = 6,
  VALIDATION_FAILED = 7,
  USER_CANCELLED = 130,
}

// Setup global error handlers
process.on('uncaughtException', (error) => {
  const msg = enableColors ? chalk.red.bold('✖ Error') : '✖ Error';
  const detail = enableColors ? chalk.gray : (s: string) => s;
  console.error(`\n${msg}: ${error.message || 'An unexpected error occurred'}`);
  console.error(detail('\nThis is likely a bug. Please report it at:'));
  console.error('  https://github.com/tang-vu/Qwen-Loop/issues\n');
  process.exit(ExitCode.GENERAL_ERROR);
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const msg = enableColors ? chalk.red.bold('✖ Error') : '✖ Error';
  const detail = enableColors ? chalk.gray : (s: string) => s;
  console.error(`\n${msg}: ${message}`);
  console.error(detail('\nThis is likely a bug. Please report it at:'));
  console.error('  https://github.com/tang-vu/Qwen-Loop/issues\n');
  process.exit(ExitCode.GENERAL_ERROR);
});

/**
 * Helper: Get command descriptions for help text
 */
function getCommandSummary(): string {
  const cmd = (text: string) => enableColors ? chalk.yellow(text) : text;
  const bold = (text: string) => enableColors ? chalk.bold(text) : text;
  const dim = (text: string) => enableColors ? chalk.dim(text) : text;
  const green = (text: string) => enableColors ? chalk.green(text) : text;
  const cyan = (text: string) => enableColors ? chalk.cyan(text) : text;

  const commandGroups = [
    {
      title: enableColors ? chalk.bold.cyan('🔧 Setup Commands:') : '🔧 Setup Commands:',
      commands: [
        { name: 'init', desc: 'Create configuration file (single project)', alias: '' },
        { name: 'init-multi', desc: 'Create multi-project configuration file', alias: '' },
        { name: 'validate', desc: 'Validate configuration and check for issues', alias: 'val' },
      ]
    },
    {
      title: enableColors ? chalk.bold.cyan('▶ Execution Commands:') : '▶ Execution Commands:',
      commands: [
        { name: 'start', desc: 'Start the agent loop', alias: 'run' },
        { name: 'add-task', desc: 'Add a task to the queue', alias: 'add' },
      ]
    },
    {
      title: enableColors ? chalk.bold.cyan('ℹ Information Commands:') : 'ℹ Information Commands:',
      commands: [
        { name: 'status', desc: 'Show current status of agents and tasks', alias: 'st' },
        { name: 'health', desc: 'Show system health status', alias: '' },
        { name: 'config', desc: 'Show current configuration details', alias: 'cfg' },
      ]
    },
  ];

  const lines: string[] = [];

  for (const group of commandGroups) {
    lines.push(`\n${group.title}`);
    for (const c of group.commands) {
      const cmdText = cmd(c.name.padEnd(12));
      const aliasText = c.alias ? dim(` [alias: ${c.alias}]`) : '';
      lines.push(`  ${cmdText} ${bold(c.desc)}${aliasText}`);
    }
  }

  return lines.join('\n');
}

const program = new Command();

program
  .name('qwen-loop')
  .description('Autonomous multi-agent loop for continuous code development')
  .version(packageJson.version, '-V, --version', 'Show Qwen Loop version number')
  .option('--no-color', 'Disable color output')
  .hook('preAction', (thisCommand) => {
    // Handle --no-color flag
    if (thisCommand.opts().color === false) {
      enableColors = false;
      chalk.level = 0;
    }
  })
  .addHelpText('beforeAll', () => {
    const banner = enableColors
      ? `\n${chalk.bold.cyan('🤖 Qwen Loop')} ${chalk.dim(`v${packageJson.version}`)} - Autonomous Multi-Agent Loop System`
      : `\n🤖 Qwen Loop v${packageJson.version} - Autonomous Multi-Agent Loop System`;
    return banner + '\n';
  })
  .addHelpText('afterAll', () => {
    const dim = (text: string) => enableColors ? chalk.dim(text) : text;
    const cyan = (text: string) => enableColors ? chalk.cyan(text) : text;
    const bold = (text: string) => enableColors ? chalk.bold(text) : text;

    return enableColors
      ? `\n${chalk.bold('Global Options:')}\n  ${chalk.cyan('--no-color')}              Disable colored output (useful for scripts)\n  ${chalk.cyan('-V, --version')}            Show Qwen Loop version number\n\n${chalk.bold('Environment Variables:')}\n  ${chalk.cyan('QWEN_LOOP_CONFIG')}    Custom config file path\n  ${chalk.cyan('QWEN_LOOP_LOG_LEVEL')}  Log level (debug|info|warn|error)\n  ${chalk.cyan('NO_COLOR')}              Disable colored output\n`
      : `\nGlobal Options:\n  --no-color              Disable colored output (useful for scripts)\n  -V, --version            Show Qwen Loop version number\n\nEnvironment Variables:\n  QWEN_LOOP_CONFIG    Custom config file path\n  QWEN_LOOP_LOG_LEVEL  Log level (debug|info|warn|error)\n  NO_COLOR              Disable colored output\n`;
  })
  .configureHelp({
    styleTitle: (str) => enableColors ? chalk.bold.underline(str) : str,
    styleCommandText: (str) => enableColors ? chalk.yellow(str) : str,
    styleCommandDescription: (str) => enableColors ? chalk.green(str) : str,
    styleOptionText: (str) => enableColors ? chalk.cyan(str) : str,
    styleDescriptionText: (str) => enableColors ? chalk.white(str) : str,
    styleArgumentText: (str) => enableColors ? chalk.yellow(str) : str,
    showGlobalOptions: true,
  })
  .addHelpText('after', () => {
    const cmd = (text: string) => enableColors ? chalk.yellow(text) : text;
    const bold = (text: string) => enableColors ? chalk.bold(text) : text;
    const dim = (text: string) => enableColors ? chalk.dim(text) : text;
    const cyan = (text: string) => enableColors ? chalk.cyan(text) : text;
    const gray = (text: string) => enableColors ? chalk.gray(text) : text;
    const green = (text: string) => enableColors ? chalk.green(text) : text;

    const quickStart = enableColors
      ? chalk.bold.cyan('🚀 Quick Start:')
      : '🚀 Quick Start:';

    const tips = enableColors ? chalk.bold('💡 Tips:') : '💡 Tips:';
    const resources = enableColors ? chalk.bold('📚 Resources:') : '📚 Resources:';
    const examples = enableColors ? chalk.bold('📖 Common Workflows:') : '📖 Common Workflows:';
    const aliases = enableColors ? chalk.bold('🔗 Command Aliases:') : '🔗 Command Aliases:';

    return `
${getCommandSummary()}

${quickStart}
  ${dim('1.')} Create config:  ${cmd('qwen-loop init --interactive')}  ${dim('# Guided setup')}
  ${dim('2.')} Validate:       ${cmd('qwen-loop validate')}           ${dim('# Check config')}
  ${dim('3.')} Start loop:     ${cmd('qwen-loop start')}              ${dim('# Begin processing')}

${tips}
  • Use ${cmd('--interactive')} flag on init commands for guided setup
  • Press ${cmd('Ctrl+C')} to gracefully stop the agent loop
  • Add ${cmd('--json')} to status/health/config for script-friendly output
  • Run ${cmd('qwen-loop <command> --help')} for command-specific help
  • Use ${cmd('--no-color')} to disable color output for scripts
  • Tab completion available for most commands and options

${aliases}
  ${cmd('start')} = ${cmd('run')}          ${dim('Start the agent loop')}
  ${cmd('add-task')} = ${cmd('add')}       ${dim('Add a task to queue')}
  ${cmd('status')} = ${cmd('st')}          ${dim('Show current status')}
  ${cmd('config')} = ${cmd('cfg')}         ${dim('Show configuration')}
  ${cmd('validate')} = ${cmd('val')}       ${dim('Validate config')}

${resources}
  Documentation  ${cyan('https://github.com/tang-vu/Qwen-Loop#readme')}
  Report Issues  ${cyan('https://github.com/tang-vu/Qwen-Loop/issues')}

${examples}
  ${gray('# First-time setup with interactive prompts')}
  ${cmd('qwen-loop init --interactive')}

  ${gray('# Validate and fix configuration issues')}
  ${cmd('qwen-loop validate')}

  ${gray('# Start loop with health monitoring on port 8080')}
  ${cmd('qwen-loop start --health-port 8080')}

  ${gray('# Add urgent task and check status')}
  ${cmd('qwen-loop add-task "Fix critical bug" --priority critical')}
  ${cmd('qwen-loop status')}

  ${gray('# Monitor system health in real-time')}
  ${cmd('qwen-loop health --live --port 8080')}
`;
  });

/**
 * Helper: Display error message with optional suggestion
 */
function displayError(message: string, suggestion?: string | string[], exitCode?: ExitCode): void {
  const errorLabel = enableColors ? `${chalk.red.bold('✖ Error')}` : '✖ Error';
  const suggestionLabel = enableColors ? chalk.dim('💡 Suggestion:') : '💡 Suggestion:';
  const dim = enableColors ? chalk.dim : (s: string) => s;

  console.error(`\n${errorLabel}: ${message}`);
  if (suggestion) {
    const suggestions = Array.isArray(suggestion) ? suggestion : [suggestion];
    console.error(`\n${suggestionLabel}`);
    suggestions.forEach((s, i) => {
      console.error(`  ${dim(`${i + 1}.`)} ${s}`);
    });
  }
  console.error(dim('\nFor more information, run: qwen-loop <command> --help'));
  console.error(dim('Report bugs: https://github.com/tang-vu/Qwen-Loop/issues\n'));
  
  if (exitCode !== undefined) {
    process.exit(exitCode);
  }
}

/**
 * Helper: Display error with error code for better debugging
 */
function displayErrorCode(message: string, code: string, suggestion?: string | string[]): void {
  const errorLabel = enableColors ? `${chalk.red.bold('✖ Error')}` : '✖ Error';
  const codeLabel = enableColors ? chalk.yellow(`[${code}]`) : `[${code}]`;
  const suggestionLabel = enableColors ? chalk.dim('💡 Suggestion:') : '💡 Suggestion:';
  const dim = enableColors ? chalk.dim : (s: string) => s;

  console.error(`\n${errorLabel} ${codeLabel}: ${message}`);
  if (suggestion) {
    const suggestions = Array.isArray(suggestion) ? suggestion : [suggestion];
    console.error(`\n${suggestionLabel}`);
    suggestions.forEach((s, i) => {
      console.error(`  ${dim(`${i + 1}.`)} ${s}`);
    });
  }
  console.error(dim('\nFor more information, run: qwen-loop <command> --help'));
  console.error(dim('Report bugs: https://github.com/tang-vu/Qwen-Loop/issues\n'));
}

/**
 * Helper: Display context-aware error based on error message patterns
 */
function displayContextualError(message: string, context?: string, ...additionalSuggestions: string[]): void {
  const suggestions: string[] = [];
  
  // Add context-specific suggestions
  if (context === 'config' || message.includes('config')) {
    suggestions.push('Run "qwen-loop validate" to check your configuration');
    suggestions.push('Use "qwen-loop init" to create a fresh configuration');
  }
  
  if (context === 'file' || message.includes('ENOENT') || message.includes('not found')) {
    suggestions.push('Ensure all referenced files and directories exist');
    suggestions.push('Check working directory paths in your configuration');
  }
  
  if (context === 'permission' || message.includes('EPERM') || message.includes('EACCES')) {
    suggestions.push('Check file permissions for the config file and working directory');
    suggestions.push('Run with appropriate privileges');
  }
  
  if (context === 'network' || message.includes('EADDRINUSE')) {
    suggestions.push('Use a different port or stop the process using the current port');
    suggestions.push('Check for other running instances of Qwen Loop');
  }

  // Add any additional custom suggestions
  suggestions.push(...additionalSuggestions);
  
  // Always include help resources
  suggestions.push('Run "qwen-loop --help" for usage information');

  displayError(message, suggestions);
}

/**
 * Helper: Display success message
 */
function displaySuccess(message: string): void {
  const successLabel = enableColors ? chalk.green.bold('✓ Success') : '✓ Success';
  console.log(`\n${successLabel}: ${message}\n`);
}

/**
 * Helper: Display warning message
 */
function displayWarning(message: string, suggestion?: string | string[]): void {
  const warningLabel = enableColors ? chalk.yellow.bold('⚠ Warning') : '⚠ Warning:';
  const dim = enableColors ? chalk.dim : (s: string) => s;

  console.log(`\n${warningLabel}: ${message}`);
  if (suggestion) {
    const suggestions = Array.isArray(suggestion) ? suggestion : [suggestion];
    console.log(dim('\nSuggestions:'));
    suggestions.forEach((s, i) => {
      console.log(`  ${dim(`${i + 1}.`)} ${s}`);
    });
  }
  console.log('');
}

/**
 * Helper: Display info message
 */
function displayInfo(message: string): void {
  const infoLabel = enableColors ? chalk.cyan.bold('ℹ Info') : 'ℹ Info:';
  console.log(`\n${infoLabel}: ${message}\n`);
}

/**
 * Helper: Calculate Levenshtein distance for fuzzy matching
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

/**
 * Helper: Suggest correct command if user made a typo
 */
function suggestCommand(typed: string): string | null {
  const validCommands = ['init', 'init-multi', 'start', 'run', 'add-task', 'add', 'status', 'st', 'health', 'config', 'cfg', 'validate', 'val'];
  
  let bestMatch: string | null = null;
  let bestDistance = Infinity;
  const threshold = 3; // Only suggest if distance is small enough

  for (const cmd of validCommands) {
    const distance = levenshteinDistance(typed.toLowerCase(), cmd.toLowerCase());
    if (distance < bestDistance && distance <= threshold) {
      bestDistance = distance;
      bestMatch = cmd;
    }
  }

  return bestMatch;
}

/**
 * Helper: Suggest correct option if user made a typo
 */
function suggestOption(typed: string, validOptions: string[]): string | null {
  let bestMatch: string | null = null;
  let bestDistance = Infinity;
  const threshold = 2;

  for (const option of validOptions) {
    const distance = levenshteinDistance(typed.toLowerCase(), option.toLowerCase());
    if (distance < bestDistance && distance <= threshold) {
      bestDistance = distance;
      bestMatch = option;
    }
  }

  return bestMatch;
}

/**
 * Helper: Auto-detect configuration file with fallback search
 */
function autoDetectConfigFile(preferredPath?: string): string | null {
  // If preferred path exists, use it
  if (preferredPath && existsSync(preferredPath)) {
    return preferredPath;
  }
  
  // Search common config file locations
  const searchPaths = [
    'qwen-loop.config.json',
    'qwen-loop.config.js',
    'qwen-loop.json',
    '.qwen-loop.json',
    'config.json',
  ];
  
  // Check in current working directory
  for (const filename of searchPaths) {
    const fullPath = join(process.cwd(), filename);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }
  
  // Check in parent directories (up to 3 levels)
  let currentDir = process.cwd();
  for (let level = 0; level < 3; level++) {
    const parentDir = join(currentDir, '..');
    if (parentDir === currentDir) break; // Reached root
    
    for (const filename of searchPaths) {
      const fullPath = join(parentDir, filename);
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }
    
    currentDir = parentDir;
  }
  
  return null;
}

/**
 * Helper: Check if config file exists, display helpful error if not
 */
function requireConfig(configManager: ConfigManager): void {
  if (!configManager.isConfigLoadedFromFile()) {
    // Try auto-detection
    const detectedPath = autoDetectConfigFile();

    if (detectedPath) {
      displayErrorCode(
        'No active configuration file found',
        'CONFIG_NOT_FOUND',
        [
          `Auto-detected config file at: ${chalk.cyan(detectedPath)}`,
          `Use detected config: ${chalk.yellow(`qwen-loop start --config ${detectedPath}`)}`,
          `Create a new one: ${chalk.yellow('qwen-loop init')}`,
        ]
      );
    } else {
      displayErrorCode(
        'No configuration file found',
        'CONFIG_NOT_FOUND',
        [
          `Run ${chalk.yellow('qwen-loop init')} to create a new configuration file`,
          `Use ${chalk.yellow('qwen-loop init --interactive')} for guided setup`,
          `Or specify a custom path with ${chalk.yellow('qwen-loop start -c <path>')}`,
        ]
      );
    }
    process.exit(ExitCode.CONFIG_NOT_FOUND);
  }
}

/**
 * Helper: Validate that a directory exists, with helpful error message
 */
function requireDirectory(dirPath: string, context: string): boolean {
  if (!existsSync(dirPath)) {
    displayError(
      `Directory does not exist: ${dirPath}`,
      `Create the directory or update the ${context} configuration`
    );
    return false;
  }
  return true;
}

/**
 * Helper: Get command examples for help text
 */
function getCommandExamples(command: string): string {
  const cmd = (text: string) => enableColors ? chalk.yellow(text) : text;
  const gray = (text: string) => enableColors ? chalk.gray(text) : text;

  const examples: Record<string, string[]> = {
    'init': [
      `${gray('# Create default config')} → ${cmd('qwen-loop init')}`,
      `${gray('# Interactive setup')} → ${cmd('qwen-loop init --interactive')}`,
      `${gray('# Force overwrite')} → ${cmd('qwen-loop init --force')}`,
    ],
    'init-multi': [
      `${gray('# Create multi-project config')} → ${cmd('qwen-loop init-multi')}`,
      `${gray('# Interactive setup')} → ${cmd('qwen-loop init-multi --interactive')}`,
      `${gray('# Force overwrite')} → ${cmd('qwen-loop init-multi --force')}`,
    ],
    'start': [
      `${gray('# Start with defaults')} → ${cmd('qwen-loop start')}`,
      `${gray('# With health check')} → ${cmd('qwen-loop start --health-port 8080')}`,
      `${gray('# Custom config file')} → ${cmd('qwen-loop start --config my-config.json')}`,
    ],
    'add-task': [
      `${gray('# Add medium priority task')} → ${cmd('qwen-loop add-task "Write tests"')}`,
      `${gray('# Add critical task')} → ${cmd('qwen-loop add-task "Fix security issue" --priority critical')}`,
      `${gray('# Interactive mode')} → ${cmd('qwen-loop add-task --interactive')}`,
    ],
    'status': [
      `${gray('# Human-readable')} → ${cmd('qwen-loop status')}`,
      `${gray('# JSON output')} → ${cmd('qwen-loop status --json')}`,
    ],
    'health': [
      `${gray('# Full health report')} → ${cmd('qwen-loop health')}`,
      `${gray('# Agent health only')} → ${cmd('qwen-loop health agents')}`,
      `${gray('# Resource usage')} → ${cmd('qwen-loop health resources')}`,
      `${gray('# Task throughput')} → ${cmd('qwen-loop health throughput')}`,
      `${gray('# Summary status')} → ${cmd('qwen-loop health summary')}`,
      `${gray('# Live metrics')} → ${cmd('qwen-loop health --live')}`,
      `${gray('# Watch mode')} → ${cmd('qwen-loop health --watch')}`,
      `${gray('# JSON for scripts')} → ${cmd('qwen-loop health --json')}`,
    ],
    'config': [
      `${gray('# Show config')} → ${cmd('qwen-loop config')}`,
      `${gray('# JSON output')} → ${cmd('qwen-loop config --json')}`,
    ],
    'validate': [
      `${gray('# Validate')} → ${cmd('qwen-loop validate')}`,
      `${gray('# JSON output')} → ${cmd('qwen-loop validate --json')}`,
    ],
  };

  return (examples[command] || []).join('\n  ');
}

/**
 * Helper: Get options table for command help
 */
function getOptionsTable(options: Array<{flag: string, description: string, default?: string}>): string {
  const bold = (text: string) => enableColors ? chalk.bold(text) : text;
  const cyan = (text: string) => enableColors ? chalk.cyan(text) : text;
  const dim = (text: string) => enableColors ? chalk.dim(text) : text;

  const lines = [bold('\nOptions:')];
  for (const opt of options) {
    const flagText = cyan(opt.flag.padEnd(30));
    const defaultText = opt.default ? dim(` (default: ${opt.default})`) : '';
    lines.push(`  ${flagText} ${opt.description}${defaultText}`);
  }
  return lines.join('\n');
}

program
  .command('init')
  .description('Create configuration file (single project mode)')
  .option('--interactive', 'Use interactive mode to configure settings step-by-step')
  .option('-f, --force', 'Overwrite existing configuration file without prompting')
  .option('--dry-run', 'Preview the configuration without writing to disk')
  .addHelpText('after', () => {
    const examples = getCommandExamples('init');
    return enableColors
      ? `\n${chalk.bold('📝 Examples:')}\n  ${examples}\n`
      : `\n📝 Examples:\n  ${examples}\n`;
  })
  .action(async (opts: { interactive?: boolean; force?: boolean; dryRun?: boolean }) => {
    try {
      const configPath = join(process.cwd(), 'qwen-loop.config.json');
      const spinner = ora({ isEnabled: !opts.dryRun }).start('Generating configuration...');

      // Check if config file already exists
      if (existsSync(configPath) && !opts.force && !opts.dryRun) {
        spinner.stop();
        const overwrite = await confirm({
          message: enableColors
            ? chalk.yellow(`Configuration file already exists at ${configPath}. Overwrite?`)
            : `Configuration file already exists at ${configPath}. Overwrite?`,
          default: false
        });

        if (!overwrite) {
          console.log(enableColors
            ? chalk.cyan('\nℹ Keeping existing configuration file.')
            : '\nℹ Keeping existing configuration file.');
          console.log(enableColors
            ? chalk.gray(`   Use --force to overwrite: qwen-loop init --force\n`)
            : `   Use --force to overwrite: qwen-loop init --force\n`);
          return;
        }
        spinner.start();
      }

      let configData: string;

      if (opts.interactive) {
        spinner.stop();
        console.log(enableColors
          ? `\n${chalk.bold.cyan('🔧 Interactive Configuration Setup')}`
          : `\n🔧 Interactive Configuration Setup`);
        console.log(enableColors
          ? chalk.dim('Answer the following questions to set up your project\n')
          : 'Answer the following questions to set up your project\n');

        // Ask for working directory
        const workingDir = await input({
          message: enableColors ? chalk.white('Working directory (press Enter for current dir):') : 'Working directory (press Enter for current dir):',
          default: './project',
          validate: (value) => {
            const trimmed = value.trim();
            if (trimmed === '') return true; // Allow empty (will use default)
            
            // Check for invalid characters
            if (/[<>:"|?*]/.test(trimmed)) {
              return 'Directory path contains invalid characters. Avoid: < > : " | ? *';
            }
            
            return true;
          }
        });

        // Validate directory path format
        if (workingDir.includes('..')) {
          displayWarning(
            'Relative parent directory paths can be error-prone',
            'Make sure the path resolves to your intended directory'
          );
        }

        // Ask for agent type
        const agentType = await select({
          message: enableColors ? chalk.white('Select agent type:') : 'Select agent type:',
          choices: [
            { name: 'Qwen - Use Qwen AI model (recommended)', value: AgentType.QWEN },
            { name: 'Custom - Custom agent implementation', value: AgentType.CUSTOM },
          ]
        });

        // Ask for agent name
        const agentName = await input({
          message: enableColors ? chalk.white('Agent name:') : 'Agent name:',
          default: agentType === AgentType.QWEN ? 'qwen-dev' : 'custom-agent',
          validate: (value) => {
            const trimmed = value.trim();
            if (!trimmed) return 'Agent name cannot be empty';
            if (trimmed.length < 3) return 'Agent name must be at least 3 characters';
            if (trimmed.length > 50) return 'Agent name must be less than 50 characters';
            if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
              return 'Agent name can only contain letters, numbers, hyphens, and underscores';
            }
            return true;
          }
        });

        // Ask for max concurrent tasks
        const maxConcurrentStr = await input({
          message: enableColors ? chalk.white('Max concurrent tasks (1-10):') : 'Max concurrent tasks (1-10):',
          default: '1',
          validate: (value) => {
            const num = parseInt(value);
            if (isNaN(num) || num < 1 || num > 10) {
              return 'Please enter a number between 1 and 10';
            }
            return true;
          }
        });

        // Ask for loop interval
        const intervalStr = await input({
          message: enableColors ? chalk.white('Loop interval in milliseconds (1000-60000):') : 'Loop interval in milliseconds (1000-60000):',
          default: '5000',
          validate: (value) => {
            const num = parseInt(value);
            if (isNaN(num) || num < 1000 || num > 60000) {
              return 'Please enter a number between 1000 and 60000 (1-60 seconds)';
            }
            return true;
          }
        });

        // Ask for max retries
        const retriesStr = await input({
          message: enableColors ? chalk.white('Max retries on failure (0-10):') : 'Max retries on failure (0-10):',
          default: '2',
          validate: (value) => {
            const num = parseInt(value);
            if (isNaN(num) || num < 0 || num > 10) {
              return 'Please enter a number between 0 and 10';
            }
            return true;
          }
        });

        // Generate config based on answers
        const configManager = new ConfigManager();
        const exampleConfig = configManager.generateExampleConfig();
        const config = JSON.parse(exampleConfig);

        config.agents[0].name = agentName;
        config.agents[0].type = agentType;
        config.workingDirectory = workingDir;
        config.agents[0].workingDirectory = workingDir;
        config.maxConcurrentTasks = parseInt(maxConcurrentStr);
        config.loopInterval = parseInt(intervalStr);
        config.maxRetries = parseInt(retriesStr);

        configData = JSON.stringify(config, null, 2);
      } else {
        // Non-interactive: use default example config
        const configManager = new ConfigManager();
        configData = configManager.generateExampleConfig();
      }

      // Handle dry-run mode
      if (opts.dryRun) {
        spinner.stop();
        console.log(enableColors 
          ? `\n${chalk.bold.cyan('🔍 Dry Run Mode - Configuration Preview')}`
          : `\n🔍 Dry Run Mode - Configuration Preview`);
        console.log(enableColors 
          ? chalk.dim('\nThe following configuration would be generated:\n')
          : '\nThe following configuration would be generated:\n');
        console.log(configData);
        console.log(enableColors 
          ? chalk.dim(`\nℹ No file was written. To save this configuration:`)
          : `\nℹ No file was written. To save this configuration:`);
        console.log(enableColors 
          ? chalk.yellow(`   Run: qwen-loop init (without --dry-run)\n`)
          : `   Run: qwen-loop init (without --dry-run)\n`);
        process.exit(ExitCode.SUCCESS);
      }

      spinner.text = 'Writing configuration...';
      writeFileSync(configPath, configData);
      spinner.succeed('Configuration file created');
      
      displaySuccess(`Configuration file created at ${chalk.cyan(configPath)}`);

      console.log(enableColors ? chalk.bold.cyan('\n📝 Next steps:') : '\n📝 Next steps:');
      console.log(enableColors ? chalk.dim('  1. Edit the configuration file if needed:') : '  1. Edit the configuration file if needed:');
      console.log(enableColors ? chalk.cyan(`     ${configPath}`) : `     ${configPath}`);
      console.log(enableColors ? chalk.dim('  2. Validate your configuration:') : '  2. Validate your configuration:');
      console.log(enableColors ? chalk.yellow('     qwen-loop validate') : '     qwen-loop validate');
      console.log(enableColors ? chalk.dim('  3. Start the agent loop:') : '  3. Start the agent loop:');
      console.log(enableColors ? chalk.yellow('     qwen-loop start\n') : '     qwen-loop start\n');
    } catch (error) {
      if (error instanceof Error && error.message === 'User force closed the prompt') {
        console.log(enableColors
          ? chalk.dim('\n\n⚠ Configuration cancelled by user.\n')
          : '\n\n⚠ Configuration cancelled by user.\n');
        process.exit(ExitCode.USER_CANCELLED);
      }

      const message = error instanceof Error ? error.message : String(error);

      // Provide specific error messages
      if (message.includes('EPERM') || message.includes('EACCES')) {
        displayErrorCode(
          'Permission denied when writing configuration file',
          'PERMISSION_DENIED',
          [`Check that you have write permissions for the current directory`, `Run with elevated privileges if needed`]
        );
        process.exit(ExitCode.PERMISSION_DENIED);
      } else if (message.includes('ENOSPC')) {
        displayErrorCode(
          'No space left on device',
          'DISK_FULL',
          ['Free up disk space and try again']
        );
        process.exit(ExitCode.GENERAL_ERROR);
      } else {
        displayErrorCode(
          `Failed to create configuration file: ${message}`,
          'FILE_WRITE_ERROR',
          ['Check that you have write permissions in the current directory']
        );
        process.exit(ExitCode.GENERAL_ERROR);
      }
    }
  });

program
  .command('init-multi')
  .description('Create multi-project configuration file')
  .option('--interactive', 'Use interactive mode to configure projects step-by-step')
  .option('-f, --force', 'Overwrite existing configuration file without prompting')
  .option('--dry-run', 'Preview the configuration without writing to disk')
  .addHelpText('after', () => {
    const examples = getCommandExamples('init-multi');
    return enableColors
      ? `\n${chalk.bold('📝 Examples:')}\n  ${examples}\n`
      : `\n📝 Examples:\n  ${examples}\n`;
  })
  .action(async (opts: { interactive?: boolean; force?: boolean; dryRun?: boolean }) => {
    try {
      const configPath = join(process.cwd(), 'qwen-loop.config.json');
      const spinner = ora({ isEnabled: !opts.dryRun }).start('Generating multi-project configuration...');

      // Check if config file already exists
      if (existsSync(configPath) && !opts.force && !opts.dryRun) {
        spinner.stop();
        const overwrite = await confirm({
          message: enableColors
            ? chalk.yellow(`Configuration file already exists at ${configPath}. Overwrite?`)
            : `Configuration file already exists at ${configPath}. Overwrite?`,
          default: false
        });

        if (!overwrite) {
          console.log(enableColors
            ? chalk.cyan('\nℹ Keeping existing configuration file.')
            : '\nℹ Keeping existing configuration file.');
          console.log(enableColors
            ? chalk.gray(`   Use --force to overwrite: qwen-loop init-multi --force\n`)
            : `   Use --force to overwrite: qwen-loop init-multi --force\n`);
          return;
        }
        spinner.start();
      }

      let configData: string;

      if (opts.interactive) {
        spinner.stop();
        console.log(enableColors
          ? `\n${chalk.bold.cyan('🔧 Multi-Project Interactive Setup')}`
          : `\n🔧 Multi-Project Interactive Setup`);
        console.log(enableColors
          ? chalk.gray('Configure multiple projects to run agents on\n')
          : 'Configure multiple projects to run agents on\n');

        // Ask for global settings
        const maxConcurrentStr = await input({
          message: enableColors ? chalk.white('Max concurrent tasks across all projects (1-10):') : 'Max concurrent tasks across all projects (1-10):',
          default: '3',
          validate: (value) => {
            const num = parseInt(value);
            if (isNaN(num) || num < 1 || num > 10) {
              return 'Please enter a number between 1 and 10';
            }
            return true;
          }
        });

        const intervalStr = await input({
          message: enableColors ? chalk.white('Loop interval in milliseconds (1000-60000):') : 'Loop interval in milliseconds (1000-60000):',
          default: '5000',
          validate: (value) => {
            const num = parseInt(value);
            if (isNaN(num) || num < 1000 || num > 60000) {
              return 'Please enter a number between 1000 and 60000 (1-60 seconds)';
            }
            return true;
          }
        });

        const retriesStr = await input({
          message: enableColors ? chalk.white('Max retries on failure (0-10):') : 'Max retries on failure (0-10):',
          default: '2',
          validate: (value) => {
            const num = parseInt(value);
            if (isNaN(num) || num < 0 || num > 10) {
              return 'Please enter a number between 0 and 10';
            }
            return true;
          }
        });

        // Ask for projects
        const projects: ProjectConfig[] = [];
        let addMore = true;

        while (addMore) {
          console.log(enableColors
            ? chalk.cyan(`\n--- Project ${projects.length + 1} ---`)
            : `\n--- Project ${projects.length + 1} ---`);

          const projectName = await input({
            message: enableColors ? chalk.white('Project name:') : 'Project name:',
            default: `project-${projects.length + 1}`,
            validate: (value) => {
              const trimmed = value.trim();
              if (!trimmed) return 'Project name cannot be empty';
              if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
                return 'Project name can only contain letters, numbers, hyphens, and underscores';
              }
              // Check for duplicates
              if (projects.some(p => p.name === trimmed)) {
                return `Project name "${trimmed}" already exists. Use a unique name.`;
              }
              return true;
            }
          });

          const projectDir = await input({
            message: enableColors ? chalk.white('Working directory:') : 'Working directory:',
            default: `./${projectName}`,
            validate: (value) => {
              const trimmed = value.trim();
              if (!trimmed) return 'Working directory cannot be empty';
              if (/[<>:"|?*]/.test(trimmed)) {
                return 'Directory path contains invalid characters. Avoid: < > : " | ? *';
              }
              return true;
            }
          });

          const maxIterationsStr = await input({
            message: enableColors ? chalk.white('Max loop iterations (0 for unlimited):') : 'Max loop iterations (0 for unlimited):',
            default: '3',
            validate: (value) => {
              const num = parseInt(value);
              if (isNaN(num) || num < 0) {
                return 'Please enter a non-negative number';
              }
              return true;
            }
          });

          projects.push({
            name: projectName,
            workingDirectory: projectDir,
            maxLoopIterations: parseInt(maxIterationsStr)
          });

          if (projects.length >= 10) {
            console.log(enableColors
              ? chalk.yellow('\n⚠ Maximum of 10 projects reached.')
              : '\n⚠ Maximum of 10 projects reached.');
            break;
          }

          addMore = await confirm({
            message: enableColors ? chalk.white('Add another project?') : 'Add another project?',
            default: true
          });
        }

        // Generate config
        const configManager = new ConfigManager();
        const baseConfig = configManager.generateMultiProjectExampleConfig();
        const config = JSON.parse(baseConfig);

        config.maxConcurrentTasks = parseInt(maxConcurrentStr);
        config.loopInterval = parseInt(intervalStr);
        config.maxRetries = parseInt(retriesStr);
        config.projects = projects;

        configData = JSON.stringify(config, null, 2);
      } else {
        // Non-interactive: use default example config
        const configManager = new ConfigManager();
        configData = configManager.generateMultiProjectExampleConfig();
      }

      // Handle dry-run mode
      if (opts.dryRun) {
        spinner.stop();
        console.log(enableColors 
          ? `\n${chalk.bold.cyan('🔍 Dry Run Mode - Multi-Project Configuration Preview')}`
          : `\n🔍 Dry Run Mode - Multi-Project Configuration Preview`);
        console.log(enableColors 
          ? chalk.dim('\nThe following configuration would be generated:\n')
          : '\nThe following configuration would be generated:\n');
        console.log(configData);
        console.log(enableColors 
          ? chalk.dim(`\nℹ No file was written. To save this configuration:`)
          : `\nℹ No file was written. To save this configuration:`);
        console.log(enableColors 
          ? chalk.yellow(`   Run: qwen-loop init-multi (without --dry-run)\n`)
          : `   Run: qwen-loop init-multi (without --dry-run)\n`);
        process.exit(ExitCode.SUCCESS);
      }

      spinner.text = 'Writing configuration...';
      writeFileSync(configPath, configData);
      spinner.succeed('Multi-project configuration file created');
      
      displaySuccess(`Multi-project configuration file created at ${chalk.cyan(configPath)}`);

      console.log(enableColors ? chalk.bold('\n📝 Next steps:') : '\n📝 Next steps:');
      console.log(enableColors ? chalk.gray('  1. Edit the projects array in the configuration file:') : '  1. Edit the projects array in the configuration file:');
      console.log(enableColors ? chalk.cyan(`     ${configPath}`) : `     ${configPath}`);
      console.log(enableColors ? chalk.gray('  2. Validate your configuration:') : '  2. Validate your configuration:');
      console.log(enableColors ? chalk.yellow('     qwen-loop validate') : '     qwen-loop validate');
      console.log(enableColors ? chalk.gray('  3. Start the agent loop for all projects:') : '  3. Start the agent loop for all projects:');
      console.log(enableColors ? chalk.yellow('     qwen-loop start\n') : '     qwen-loop start\n');
    } catch (error) {
      if (error instanceof Error && error.message === 'User force closed the prompt') {
        console.log(enableColors
          ? chalk.gray('\n\n⚠ Configuration cancelled by user.\n')
          : '\n\n⚠ Configuration cancelled by user.\n');
        process.exit(ExitCode.USER_CANCELLED);
      }
      const message = error instanceof Error ? error.message : String(error);
      
      // Provide specific error messages
      if (message.includes('EPERM') || message.includes('EACCES')) {
        displayErrorCode(
          'Permission denied when writing configuration file',
          'PERMISSION_DENIED',
          [`Check that you have write permissions for the current directory`, `Run with elevated privileges if needed`]
        );
        process.exit(ExitCode.PERMISSION_DENIED);
      } else if (message.includes('ENOSPC')) {
        displayErrorCode(
          'No space left on device',
          'DISK_FULL',
          ['Free up disk space and try again']
        );
        process.exit(ExitCode.GENERAL_ERROR);
      } else {
        displayErrorCode(
          `Failed to create configuration file: ${message}`,
          'FILE_WRITE_ERROR',
          ['Check that you have write permissions in the current directory']
        );
        process.exit(ExitCode.GENERAL_ERROR);
      }
    }
  });

program
  .command('start')
  .description('Start the agent loop (auto-detects single or multi-project mode)')
  .alias('run')
  .option('-c, --config <path>', 'Path to configuration file (default: auto-detect)')
  .option('--auto-start', 'Automatically start processing tasks')
  .option('--health-port <port>', 'Enable HTTP health check server on specified port')
  .option('--interactive', 'Use interactive mode to configure startup options')
  .addHelpText('after', () => {
    const examples = getCommandExamples('start');
    return enableColors
      ? `\n${chalk.bold('📝 Examples:')}\n  ${examples}\n`
      : `\n📝 Examples:\n  ${examples}\n`;
  })
  .action(async (opts: {
    config?: string;
    autoStart?: boolean;
    healthPort?: string;
    interactive?: boolean;
  }) => {
    try {
      // Interactive mode: prompt for startup options
      let configPath = opts.config;
      let healthPort = opts.healthPort ? parseInt(opts.healthPort, 10) : undefined;

      // Validate health port if provided
      if (opts.healthPort) {
        const port = parseInt(opts.healthPort, 10);
        if (isNaN(port) || port < 1024 || port > 65535) {
          displayErrorCode(
            `Invalid health check port: ${opts.healthPort}`,
            'INVALID_ARGUMENT',
            [`Port must be between 1024 and 65535`, `Example: ${chalk.yellow('qwen-loop start --health-port 8080')}`]
          );
          process.exit(ExitCode.GENERAL_ERROR);
        }
        healthPort = port;
      }

      if (opts.interactive) {
        console.log(enableColors
          ? `\n${chalk.bold.cyan('🚀 Qwen Loop Interactive Startup')}`
          : `\n🚀 Qwen Loop Interactive Startup`);
        console.log(enableColors
          ? chalk.dim('Configure and start the agent loop\n')
          : 'Configure and start the agent loop\n');

        // Try to auto-detect config files
        const detectedConfig = autoDetectConfigFile();
        const defaultConfigHint = detectedConfig 
          ? `press Enter for ${detectedConfig}`
          : 'press Enter for auto-detect';

        // Ask for config file path
        const configPathInput = await input({
          message: enableColors ? chalk.white(`Configuration file path (${defaultConfigHint}):`) : `Configuration file path (${defaultConfigHint}):`,
          default: detectedConfig || '',
        });

        // Ask if they want to enable health check
        const enableHealth = await confirm({
          message: enableColors ? chalk.white('Enable health check server?') : 'Enable health check server?',
          default: false
        });

        if (enableHealth) {
          const healthPortStr = await input({
            message: enableColors ? chalk.white('Health check port (default: 3100):') : 'Health check port (default: 3100):',
            default: '3100',
            validate: (value) => {
              const port = parseInt(value);
              if (isNaN(port) || port < 1024 || port > 65535) {
                return 'Please enter a valid port number (1024-65535)';
              }
              return true;
            }
          });
          healthPort = parseInt(healthPortStr);
        }

        // Update for downstream logic
        configPath = configPathInput || undefined;
      }

      const configManager = new ConfigManager(configPath);

      // Check if config file was loaded or using defaults
      const actualConfigPath = configManager['configPath'];
      if (!actualConfigPath || !existsSync(actualConfigPath)) {
        // Try auto-detection to provide a better error message
        const detectedPath = autoDetectConfigFile(configPath);
        
        if (detectedPath) {
          displayErrorCode(
            'No active configuration file found',
            'CONFIG_NOT_FOUND',
            [
              `Auto-detected config file at: ${chalk.cyan(detectedPath)}`,
              `Use detected config: ${chalk.yellow(`qwen-loop start --config ${detectedPath}`)}`,
              `Create a new one: ${chalk.yellow('qwen-loop init')}`,
            ]
          );
        } else {
          displayErrorCode(
            'No configuration file found',
            'CONFIG_NOT_FOUND',
            [
              `Run ${chalk.yellow('qwen-loop init')} to create a configuration file`,
              `Use ${chalk.yellow('qwen-loop init --interactive')} for guided setup`,
              `Or specify a config file: ${chalk.yellow('qwen-loop start --config my-config.json')}`,
            ]
          );
        }
        process.exit(ExitCode.CONFIG_NOT_FOUND);
      }

      const config = configManager.getConfig();

      const startSpinner = ora('Starting Qwen Loop...').start();
      startSpinner.text = `Loading configuration from ${configManager['configPath']}`;

      // Set log level
      setLogLevel(config.logLevel);

      // Validate configuration
      const errors = configManager.validateConfig();
      if (errors.length > 0) {
        console.error(`\n${enableColors ? chalk.yellow.bold('⚠ Configuration Issues:') : '⚠ Configuration Issues:'} (${errors.length} found)`);
        errors.forEach(err => console.error(`  ${enableColors ? chalk.red('•') : '•'} ${err}`));

        // Ask user if they want to continue
        try {
          const shouldContinue = await confirm({
            message: enableColors ? chalk.yellow('\nDo you want to continue anyway? (not recommended)') : '\nDo you want to continue anyway? (not recommended)',
            default: false
          });

          if (!shouldContinue) {
            console.log(enableColors ? chalk.cyan('\nℹ Aborted. Fix the issues above and try again.\n') : '\nℹ Aborted. Fix the issues above and try again.\n');
            console.log(enableColors ? chalk.dim('💡 Tips:') : '💡 Tips:');
            console.log(enableColors ? chalk.dim('  • Run "qwen-loop validate" for detailed validation output') : '  • Run "qwen-loop validate" for detailed validation output');
            console.log(enableColors ? chalk.dim('  • Run "qwen-loop init" to create a fresh configuration\n') : '  • Run "qwen-loop init" to create a fresh configuration\n');
            process.exit(0);
          }
          console.log(enableColors ? chalk.yellow('\n⚠ Continuing with warnings...\n') : '\n⚠ Continuing with warnings...\n');
        } catch (error) {
          // User cancelled (Ctrl+C)
          console.log(enableColors ? chalk.dim('\n\n⚠ Aborted.\n') : '\n\n⚠ Aborted.\n');
          process.exit(0);
        }
      }

      // Handle graceful shutdown
      const setupShutdown = async (stopFn: () => Promise<void>) => {
        process.on('SIGINT', async () => {
          const yellow = enableColors ? chalk.yellow : (s: string) => s;
          const green = enableColors ? chalk.green : (s: string) => s;
          console.log(yellow('\n\n⏹ Shutting down gracefully...'));
          await stopFn();
          console.log(green('✓ Shutdown complete.\n'));
          process.exit(ExitCode.SUCCESS);
        });

        process.on('SIGTERM', async () => {
          const yellow = enableColors ? chalk.yellow : (s: string) => s;
          const green = enableColors ? chalk.green : (s: string) => s;
          console.log(yellow('\n\n⏹ Shutting down gracefully...'));
          await stopFn();
          console.log(green('✓ Shutdown complete.\n'));
          process.exit(ExitCode.SUCCESS);
        });
      };

      // Check if multi-project mode
      if (config.projects && config.projects.length > 0) {
        startSpinner.stop();
        console.log(`\n${chalk.bold.cyan('🌐 Multi-Project Mode')} ${chalk.dim(`(${config.projects.length} projects)`)}\n`);
        config.projects.forEach((p: ProjectConfig, i: number) => {
          console.log(`  ${i + 1}. ${chalk.cyan(p.name)} - ${p.workingDirectory}`);
        });
        console.log('');

        const multiManager = new MultiProjectManager(config);
        startSpinner.text = 'Initializing projects...';
        await multiManager.initialize();
        startSpinner.text = 'Starting agents...';
        await multiManager.start();
        startSpinner.succeed('Agents started in multi-project mode');

        // Start health server if requested
        let healthServer: import('./core/health-server.js').HealthServer | undefined;
        if (healthPort) {
          const { HealthServer } = await import('./core/health-server.js');
          const { HealthChecker } = await import('./core/health-checker.js');

          // Create a health checker that aggregates all projects
          const healthChecker = new HealthChecker();
          // We'll update it periodically with multi-manager stats
          const updateHealthChecker = () => {
            const report = multiManager.getHealthReport();
            // Collect actual agent instances from all project managers
            const allAgents: IAgent[] = [];
            for (const projectName of multiManager.getProjectNames()) {
              const projectManager = multiManager.getProjectManager(projectName);
              if (projectManager) {
                const agents = projectManager.getOrchestrator().getAllAgents();
                allAgents.push(...agents);
              }
            }
            healthChecker.updateAgents(allAgents);
            healthChecker.updateLoopStats({
              completedTasks: report.taskThroughput.completedTasks,
              failedTasks: report.taskThroughput.failedTasks,
              totalExecutionTime: report.taskThroughput.averageExecutionTime * report.taskThroughput.completedTasks,
              maxConcurrentTasks: config.maxConcurrentTasks,
              loopInterval: config.loopInterval,
              maxRetries: config.maxRetries,
              workingDirectory: config.workingDirectory
            });
          };

          healthServer = new HealthServer(healthChecker, healthPort);
          await healthServer.start();
          updateHealthChecker();

          // Update health checker every 5 seconds
          const healthUpdateInterval = setInterval(updateHealthChecker, 5000);
        }

        // Print status every 30 seconds
        const statusInterval = setInterval(() => {
          if (!multiManager.isRunningStatus()) {
            clearInterval(statusInterval);
            if (opts.healthPort) {
              // Also clear health update interval
              // This will be handled by the shutdown handler
            }
            return;
          }
          console.log(multiManager.getAllStats());
        }, 30000);

        await setupShutdown(async () => {
          if (healthServer) {
            await healthServer.stop();
          }
          await multiManager.stop();
        });

        // Keep process alive
        await new Promise(() => {});
      } else {
        // Single project mode
        startSpinner.text = 'Initializing single-project mode...';
        
        const loopManager = new LoopManager(config);

        // Create and register agents
        startSpinner.text = `Registering ${config.agents.length} agent(s)...`;
        for (const agentConfig of config.agents) {
          let agent;

          switch (agentConfig.type) {
            case AgentType.QWEN:
              agent = new QwenAgent(agentConfig);
              break;
            case AgentType.CUSTOM:
              agent = new CustomAgent(agentConfig);
              break;
            default:
              logger.error(`Unknown agent type: ${agentConfig.type}`);
              continue;
          }

          loopManager.getOrchestrator().registerAgent(agent);
        }

        logger.info(`Registered ${config.agents.length} agents`);

        // Start the loop
        startSpinner.text = 'Starting loop...';
        await loopManager.start();
        startSpinner.succeed('Qwen Loop started successfully');

        // Start health server if requested
        let healthServer: import('./core/health-server.js').HealthServer | undefined;
        if (healthPort) {
          const { HealthServer } = await import('./core/health-server.js');
          healthServer = new HealthServer(loopManager.getHealthChecker(), healthPort);
          await healthServer.start();
        }

        console.log(`\n${chalk.green('🚀 Qwen Loop Started Successfully!')}`);
        if (healthServer) {
          console.log(`${chalk.blue('📊 Health check:')} ${chalk.cyan(healthServer.getUrl())}`);
        }
        console.log(chalk.gray('Press Ctrl+C to stop the loop\n'));

        // Print status every 30 seconds
        const statusInterval = setInterval(() => {
          if (!loopManager.isRunning()) {
            clearInterval(statusInterval);
            return;
          }
          const stats = loopManager.getStats();
          console.log('\n' + loopManager.getAgentStatusReport());
          console.log(loopManager.getTaskQueueStats());
        }, 30000);

        await setupShutdown(async () => {
          if (healthServer) {
            await healthServer.stop();
          }
          await loopManager.stop();
        });

        // Keep the process alive
        await new Promise(() => {});
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Provide specific error messages for common issues
      if (message.includes('ENOENT') || message.includes('not found')) {
        displayErrorCode(
          'Required file or directory not found',
          'FILE_NOT_FOUND',
          [
            `Run ${chalk.yellow('qwen-loop validate')} to check your configuration`,
            `Ensure working directories exist and are accessible`,
          ]
        );
      } else if (message.includes('EADDRINUSE')) {
        const port = opts.healthPort ? parseInt(opts.healthPort, 10) : 3100;
        displayErrorCode(
          `Health check port ${port} is already in use`,
          'PORT_IN_USE',
          [
            `Use a different port: ${chalk.yellow(`qwen-loop start --health-port <different-port>`)}`,
            `Or stop the process using port ${port}`,
          ]
        );
      } else if (message.includes('EPERM') || message.includes('EACCES')) {
        displayErrorCode(
          'Permission denied when accessing configuration or working directory',
          'PERMISSION_DENIED',
          [
            `Check file permissions for the config file and working directory`,
            `Run with appropriate privileges`,
          ]
        );
      } else if (message.includes('qwen') && (message.includes('command') || message.includes('not found'))) {
        displayErrorCode(
          'Qwen Code CLI is not installed or not in PATH',
          'DEPENDENCY_MISSING',
          [
            `Install Qwen Code CLI: ${chalk.yellow('npm install -g @qwen-code/qwen-code')}`,
            `Verify installation: ${chalk.yellow('qwen --help')}`,
            `Restart your terminal after installation`,
          ]
        );
      } else {
        displayError(
          `Failed to start Qwen Loop: ${message}`,
          [
            `Run ${chalk.yellow('qwen-loop validate')} to check your configuration`,
            `Check the logs for detailed error: ${chalk.cyan('logs/qwen-loop.log')}`,
          ],
          ExitCode.GENERAL_ERROR
        );
      }
      process.exit(ExitCode.GENERAL_ERROR);
    }
  });

program
  .command('add-task <description>')
  .description('Add a task to the queue')
  .alias('add')
  .option('-p, --priority <priority>', 'Task priority: low, medium, high, critical', 'medium')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('--interactive', 'Use interactive mode to configure the task')
  .addHelpText('after', () => {
    const examples = getCommandExamples('add-task');
    return enableColors
      ? `\n${chalk.bold('📝 Examples:')}\n  ${examples}\n`
      : `\n📝 Examples:\n  ${examples}\n`;
  })
  .action(async (description, opts) => {
    try {
      // Validate description
      if (!description || description.trim().length === 0) {
        displayErrorCode(
          'Task description cannot be empty',
          'INVALID_ARGUMENT',
          [`Provide a meaningful description: ${chalk.yellow('qwen-loop add-task "Fix login bug"')}`]
        );
        process.exit(ExitCode.GENERAL_ERROR);
      }

      let priorityKey: string;
      let priority: TaskPriority;

      if (opts.interactive) {
        console.log(enableColors
          ? `\n${chalk.bold.cyan('📝 Add New Task')}`
          : `\n📝 Add New Task`);
        console.log(enableColors
          ? chalk.dim('Configure task settings\n')
          : 'Configure task settings\n');

        // Show description and confirm
        const confirmedDesc = await input({
          message: enableColors ? chalk.white('Task description:') : 'Task description:',
          default: description,
          validate: (value) => value.trim() ? true : 'Description cannot be empty'
        });
        description = confirmedDesc;

        // Prompt for priority
        const selectedPriority = await select({
          message: enableColors ? chalk.white('Select task priority:') : 'Select task priority:',
          choices: [
            { name: '🔵 Low - Background tasks, nice to have', value: 'low' },
            { name: '🟢 Medium - Normal tasks (default)', value: 'medium' },
            { name: '🟡 High - Important tasks', value: 'high' },
            { name: '🔴 Critical - Urgent tasks', value: 'critical' },
          ],
          default: 'medium'
        });
        priorityKey = selectedPriority;

        // Confirm task creation
        const shouldCreate = await confirm({
          message: enableColors ? chalk.white(`\nCreate ${priorityKey} priority task: "${description}"?`) : `\nCreate ${priorityKey} priority task: "${description}"?`,
          default: true
        });

        if (!shouldCreate) {
          console.log(enableColors ? chalk.cyan('\nℹ Task creation cancelled.\n') : '\nℹ Task creation cancelled.\n');
          return;
        }
      } else {
        // Non-interactive: validate priority from CLI option
        priorityKey = opts.priority.toLowerCase();
        const priorityMap: Record<string, TaskPriority> = {
          low: TaskPriority.LOW,
          medium: TaskPriority.MEDIUM,
          high: TaskPriority.HIGH,
          critical: TaskPriority.CRITICAL
        };

        if (!priorityMap[priorityKey]) {
          // Try to suggest correct priority
          const validPriorities = ['low', 'medium', 'high', 'critical'];
          const suggestion = suggestOption(opts.priority, validPriorities);

          const suggestions = suggestion
            ? [
                `Did you mean: "${suggestion}"?`,
                `Valid priorities are: ${validPriorities.map(p => chalk.yellow(p)).join(', ')}`,
                `Example: ${chalk.yellow(`qwen-loop add-task "Fix bug" --priority ${suggestion}`)}`,
              ]
            : [
                `Valid priorities are: ${validPriorities.map(p => chalk.yellow(p)).join(', ')}`,
                `Example: ${chalk.yellow('qwen-loop add-task "Fix bug" --priority high')}`,
              ];

          displayErrorCode(
            `Invalid priority: "${opts.priority}"`,
            'INVALID_ARGUMENT',
            suggestions
          );
          process.exit(ExitCode.GENERAL_ERROR);
        }
      }

      const priorityMap: Record<string, TaskPriority> = {
        low: TaskPriority.LOW,
        medium: TaskPriority.MEDIUM,
        high: TaskPriority.HIGH,
        critical: TaskPriority.CRITICAL
      };

      priority = priorityMap[priorityKey];

      // Auto-detect config if not specified
      let configPath = opts.config;
      if (!configPath) {
        const detectedPath = autoDetectConfigFile();
        if (detectedPath) {
          configPath = detectedPath;
        }
      }

      const configManager = new ConfigManager(configPath);
      requireConfig(configManager);

      const config = configManager.getConfig();

      // Validate that at least one agent is configured
      if (!config.agents || config.agents.length === 0) {
        displayError(
          'No agents configured in configuration file',
          [
            `Run 'qwen-loop init' to set up agents`,
            `Or edit your config file to add at least one agent`,
          ]
        );
        process.exit(ExitCode.CONFIG_INVALID);
      }

      // Create a temporary loop manager to add the task
      const loopManager = new LoopManager(config);

      // Create and register agents if any
      for (const agentConfig of config.agents) {
        let agent;

        switch (agentConfig.type) {
          case AgentType.QWEN:
            agent = new QwenAgent(agentConfig);
            break;
          case AgentType.CUSTOM:
            agent = new CustomAgent(agentConfig);
            break;
          default:
            logger.error(`Unknown agent type: ${agentConfig.type}`);
            continue;
        }

        loopManager.getOrchestrator().registerAgent(agent);
      }

      const task = loopManager.addTask(description, priority);

      console.log(enableColors ? `\n${chalk.green.bold('✓ Task Added Successfully')}` : '\n✓ Task Added Successfully');
      console.log(enableColors ? chalk.gray('─'.repeat(60)) : '─'.repeat(60));
      console.log(`  ${enableColors ? chalk.bold('Description:') : 'Description:'} ${description}`);
      console.log(`  ${enableColors ? chalk.bold('Priority:') : 'Priority:'}    ${
        enableColors
          ? (priority === TaskPriority.CRITICAL ? chalk.red.bold(priority)
            : priority === TaskPriority.HIGH ? chalk.yellow(priority)
            : priority === TaskPriority.MEDIUM ? chalk.green(priority)
            : chalk.blue(priority))
          : priority
      }`);
      console.log(`  ${enableColors ? chalk.bold('Task ID:') : 'Task ID:'}     ${task.id}`);
      console.log(`  ${enableColors ? chalk.bold('Created:') : 'Created:'}     ${task.createdAt.toISOString()}`);
      console.log(`  ${enableColors ? chalk.bold('Status:') : 'Status:'}      ${enableColors ? chalk.yellow('PENDING') : 'PENDING'}`);
      console.log(enableColors ? chalk.gray('─'.repeat(60)) : '─'.repeat(60));

      // Show queue context
      const queueStatsOutput = loopManager.getTaskQueueStats();
      console.log(enableColors ? chalk.dim(`\n📊 Task Queue:`) : `\n📊 Task Queue:`);
      console.log(queueStatsOutput);
      
      if (config.enableAutoStart) {
        console.log(enableColors ? chalk.green('\n✅ Auto-start enabled - task will be processed automatically') : '\n✅ Auto-start enabled - task will be processed automatically');
      } else {
        console.log(enableColors ? chalk.gray('\n💡 Start processing with: qwen-loop start\n') : '\n💡 Start processing with: qwen-loop start\n');
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'User force closed the prompt') {
        console.log(enableColors
          ? chalk.dim('\n\n⚠ Task creation cancelled by user.\n')
          : '\n\n⚠ Task creation cancelled by user.\n');
        process.exit(ExitCode.USER_CANCELLED);
      }

      const message = error instanceof Error ? error.message : String(error);
      displayError(
        `Failed to add task: ${message}`,
        [
          'Make sure your configuration file is valid',
          'Ensure at least one agent is configured',
          'Run "qwen-loop validate" to check configuration',
        ]
      );
      process.exit(ExitCode.CONFIG_INVALID);
    }
  });

program
  .command('status')
  .description('Show current status of agents and tasks')
  .alias('st')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('--json', 'Output in JSON format')
  .option('--live', 'Try to fetch live status from running instance')
  .option('--health-port <port>', 'Health server port for live status (default: 3100)', '3100')
  .addHelpText('after', () => {
    const examples = getCommandExamples('status');
    return enableColors
      ? `\n${chalk.bold('📝 Examples:')}\n  ${examples}\n`
      : `\n📝 Examples:\n  ${examples}\n`;
  })
  .action(async (opts: {
    config?: string;
    json?: boolean;
    live?: boolean;
    healthPort?: string;
  }) => {
    try {
      let configPath = opts.config;
      
      // Auto-detect config if not specified
      if (!configPath) {
        const detectedPath = autoDetectConfigFile();
        if (detectedPath) {
          configPath = detectedPath;
        }
      }

      const configManager = new ConfigManager(configPath);

      // Check if config exists
      const actualConfigPath = configManager['configPath'];
      if (!actualConfigPath || !existsSync(actualConfigPath)) {
        // Try auto-detection to provide a better error message
        const detectedPath = autoDetectConfigFile();
        
        if (detectedPath) {
          displayErrorCode(
            'No active configuration file found',
            'CONFIG_NOT_FOUND',
            [
              `Auto-detected config file at: ${chalk.cyan(detectedPath)}`,
              `Use detected config: ${chalk.yellow(`qwen-loop status --config ${detectedPath}`)}`,
              `Create a new one: ${chalk.yellow('qwen-loop init')}`,
            ]
          );
        } else {
          displayErrorCode(
            'No configuration file found',
            'CONFIG_NOT_FOUND',
            [
              'Run "qwen-loop init" to create a configuration file',
              'Or specify a config file: qwen-loop status --config my-config.json',
            ]
          );
        }
        process.exit(ExitCode.CONFIG_NOT_FOUND);
      }

      const config = configManager.getConfig();

      // Try to fetch live status if requested
      let liveData = null;
      if (opts.live || opts.healthPort) {
        try {
          const port = parseInt(opts.healthPort || '3100', 10);
          const { isHealthServerAvailable, fetchHealthReport } = await import('./utils/health-client.js');
          const serverAvailable = await isHealthServerAvailable('localhost', port);
          
          if (serverAvailable) {
            liveData = await fetchHealthReport({ host: 'localhost', port });
          } else if (opts.live) {
            displayWarning(
              'Could not connect to running instance',
              [
                `Make sure Qwen Loop is running with --health-port ${port}`,
                `Example: qwen-loop start --health-port ${port}`,
              ]
            );
          }
        } catch (err) {
          // Silently ignore live data errors, fall back to static status
          liveData = null;
        }
      }

      if (opts.json) {
        // JSON output
        const statusData = {
          configFile: configManager['configPath'],
          workingDirectory: config.workingDirectory,
          agents: config.agents.map((a: AgentConfig) => ({
            name: a.name,
            type: a.type,
            model: a.model || null,
          })),
          maxConcurrentTasks: config.maxConcurrentTasks,
          loopInterval: config.loopInterval,
          maxRetries: config.maxRetries,
          projects: config.projects?.map((p: ProjectConfig) => ({
            name: p.name,
            workingDirectory: p.workingDirectory,
          })) || [],
          live: liveData ? {
            connected: true,
            port: opts.healthPort,
            agents: liveData.agents || [],
            taskThroughput: liveData.taskThroughput || {},
          } : {
            connected: false,
          },
        };
        console.log(JSON.stringify(statusData, null, 2));
        return;
      }

      console.log(enableColors ? `\n${chalk.bold.cyan('📊 Qwen Loop Status')}` : '\n📊 Qwen Loop Status');
      console.log(enableColors ? chalk.gray('═'.repeat(70)) : '═'.repeat(70));

      // Show live status if available
      if (liveData) {
        console.log(enableColors ? chalk.bold.green('\n● Live Status (connected)') : '\n● Live Status (connected)');
        console.log(enableColors ? chalk.gray('─'.repeat(70)) : '─'.repeat(70));
        
        if (liveData.agents && liveData.agents.length > 0) {
          console.log(enableColors ? chalk.bold.cyan('\n🤖 Active Agents:') : '\n🤖 Active Agents:');
          for (const agent of liveData.agents) {
            const statusIcon = agent.status === AgentStatus.BUSY
              ? (enableColors ? chalk.green('✓') : '✓')
              : agent.status === AgentStatus.IDLE
              ? (enableColors ? chalk.yellow('○') : '○')
              : (enableColors ? chalk.red('✗') : '✗');
            
            console.log(`  ${statusIcon} ${enableColors ? chalk.cyan(agent.name) : agent.name} (${enableColors ? chalk.yellow(agent.type) : agent.type})`);
            console.log(`    ${enableColors ? chalk.dim('Status:') : 'Status:'} ${agent.status}`);
            console.log(`    ${enableColors ? chalk.dim('Healthy:') : 'Healthy:'} ${agent.healthy ? (enableColors ? chalk.green('yes') : 'yes') : (enableColors ? chalk.red('no') : 'no')}`);
            console.log(`    ${enableColors ? chalk.dim('Tasks Executed:') : 'Tasks Executed:'} ${agent.totalTasksExecuted}`);
            if (agent.failedTasks > 0) {
              console.log(`    ${enableColors ? chalk.dim('Failed Tasks:') : 'Failed Tasks:'} ${agent.failedTasks}`);
            }
            if (agent.error) {
              console.log(`    ${enableColors ? chalk.dim('Error:') : 'Error:'} ${agent.error}`);
            }
          }
        }
        
        if (liveData.taskThroughput) {
          console.log(enableColors ? chalk.bold.cyan('\n📋 Task Metrics:') : '\n📋 Task Metrics:');
          console.log(`  ${enableColors ? chalk.bold('Completed:') : 'Completed:'} ${liveData.taskThroughput.completedTasks}`);
          console.log(`  ${enableColors ? chalk.bold('Failed:') : 'Failed:'} ${liveData.taskThroughput.failedTasks}`);
          if (liveData.taskThroughput.averageExecutionTime > 0) {
            console.log(`  ${enableColors ? chalk.bold('Avg Execution Time:') : 'Avg Execution Time:'} ${liveData.taskThroughput.averageExecutionTime.toFixed(0)}ms`);
          }
        }
        
        console.log(enableColors ? chalk.gray('\n─'.repeat(70)) : '\n─'.repeat(70));
      }

      // Show configuration summary
      console.log(enableColors ? chalk.bold.cyan('\n⚙ Configuration:') : '\n⚙ Configuration:');
      console.log(`  ${enableColors ? chalk.bold('Config File:') : 'Config File:'}    ${enableColors ? chalk.cyan(configManager['configPath']) : configManager['configPath']}`);
      console.log(`  ${enableColors ? chalk.bold('Working Dir:') : 'Working Dir:'}    ${config.workingDirectory}`);
      console.log(`  ${enableColors ? chalk.bold('Agents:') : 'Agents:'}         ${config.agents.length}`);
      console.log(`  ${enableColors ? chalk.bold('Max Tasks:') : 'Max Tasks:'}      ${config.maxConcurrentTasks}`);
      console.log(`  ${enableColors ? chalk.bold('Interval:') : 'Interval:'}       ${config.loopInterval}ms (${(config.loopInterval / 1000).toFixed(1)}s)`);
      console.log(`  ${enableColors ? chalk.bold('Max Retries:') : 'Max Retries:'}   ${config.maxRetries}`);
      if (config.maxLoopIterations && config.maxLoopIterations > 0) {
        console.log(`  ${enableColors ? chalk.bold('Max Iterations:') : 'Max Iterations:'} ${config.maxLoopIterations}`);
      } else {
        console.log(`  ${enableColors ? chalk.bold('Max Iterations:') : 'Max Iterations:'} ${enableColors ? chalk.green('unlimited') : 'unlimited'}`);
      }
      console.log(`  ${enableColors ? chalk.bold('Task Gen:') : 'Task Gen:'}      ${config.enableSelfTaskGeneration ? (enableColors ? chalk.green('enabled') : 'enabled') : (enableColors ? chalk.yellow('disabled') : 'disabled')}`);

      if (config.projects && config.projects.length > 0) {
        console.log(enableColors ? `\n${chalk.bold.cyan(`📁 Projects (${config.projects.length}):`)}` : `\n📁 Projects (${config.projects.length}):`);
        config.projects.forEach((project: ProjectConfig, index: number) => {
          const dirExists = existsSync(project.workingDirectory);
          const statusIcon = dirExists 
            ? (enableColors ? chalk.green('✓') : '✓')
            : (enableColors ? chalk.red('✗') : '✗');
          console.log(`  ${statusIcon} ${index + 1}. ${enableColors ? chalk.cyan(project.name) : project.name}`);
          console.log(`     ${enableColors ? chalk.dim('Directory:') : 'Directory:'} ${project.workingDirectory}${dirExists ? '' : (enableColors ? chalk.red(' (not found)') : ' (not found)')}`);
        });
      }

      if (config.agents.length > 0) {
        console.log(enableColors ? `\n${chalk.bold.cyan(`🤖 Agents (${config.agents.length}):`)}` : `\n🤖 Agents (${config.agents.length}):`);
        config.agents.forEach((agent: AgentConfig, index: number) => {
          const statusIcon = enableColors ? chalk.green('●') : '●';
          console.log(`  ${statusIcon} ${index + 1}. ${enableColors ? chalk.cyan(agent.name) : agent.name} (${enableColors ? chalk.yellow(agent.type) : agent.type})`);
          if (agent.model) console.log(`     ${enableColors ? chalk.dim('Model:') : 'Model:'} ${agent.model}`);
          if (agent.workingDirectory) console.log(`     ${enableColors ? chalk.dim('Working Dir:') : 'Working Dir:'} ${agent.workingDirectory}`);
          if (agent.timeout) console.log(`     ${enableColors ? chalk.dim('Timeout:') : 'Timeout:'} ${(agent.timeout / 1000).toFixed(0)}s`);
        });
      } else {
        console.log(enableColors ? `\n${chalk.yellow.bold('⚠ No agents configured')}` : '\n⚠ No agents configured');
        console.log(enableColors ? chalk.gray('  Run "qwen-loop init" to set up agents') : '  Run "qwen-loop init" to set up agents');
      }

      console.log(enableColors ? `\n${chalk.gray('ℹ For live task status, the loop must be running.')}` : '\nℹ For live task status, the loop must be running.');
      console.log(enableColors ? chalk.gray('  Start with: qwen-loop start\n') : '  Start with: qwen-loop start\n');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      displayError(`Failed to show status: ${message}`);
      process.exit(ExitCode.GENERAL_ERROR);
    }
  });

// Register the enhanced health command with subcommands
registerHealthCommand(program);

/**
 * Show the current configuration
 */
program
  .command('config')
  .description('Show current configuration details')
  .alias('cfg')
  .option('-c, --config <path>', 'Path to configuration file (default: ./qwen-loop.config.json)')
  .option('--json', 'Output in JSON format')
  .addHelpText('after', () => {
    const examples = getCommandExamples('config');
    return enableColors
      ? `\n${chalk.bold('📝 Examples:')}\n  ${examples}\n`
      : `\n📝 Examples:\n  ${examples}\n`;
  })
  .action(async (opts: { config?: string; json?: boolean }) => {
    try {
      // Auto-detect config if not specified
      let configPath = opts.config;
      if (!configPath) {
        const detectedPath = autoDetectConfigFile();
        if (detectedPath) {
          configPath = detectedPath;
        }
      }

      const configManager = new ConfigManager(configPath);
      const actualConfigPath = configManager['configPath'];

      if (!actualConfigPath || !existsSync(actualConfigPath)) {
        const detectedPath = autoDetectConfigFile();
        
        if (detectedPath) {
          displayErrorCode(
            'No active configuration file found',
            'CONFIG_NOT_FOUND',
            [
              `Auto-detected config file at: ${chalk.cyan(detectedPath)}`,
              `Use detected config: ${chalk.yellow(`qwen-loop config --config ${detectedPath}`)}`,
              `Create a new one: ${chalk.yellow('qwen-loop init')}`,
            ]
          );
        } else {
          displayError(
            `Configuration file not found`,
            [
              `Run 'qwen-loop init' to create a configuration file`,
              `Use 'qwen-loop init --interactive' for guided setup`,
              `Or specify a custom path: qwen-loop config --config <path>`,
            ]
          );
        }
        process.exit(ExitCode.CONFIG_NOT_FOUND);
      }

      const config = configManager.getConfig();

      if (opts.json) {
        console.log(JSON.stringify(config, null, 2));
        return;
      }

      console.log(enableColors ? `\n${chalk.bold.cyan('⚙ Configuration Details')}` : '\n⚙ Configuration Details');
      console.log(enableColors ? chalk.gray('═'.repeat(70)) : '═'.repeat(70));

      console.log(enableColors ? chalk.bold.cyan('\n📋 General:') : '\n📋 General:');
      console.log(`  ${enableColors ? chalk.bold('Config File:') : 'Config File:'}      ${enableColors ? chalk.cyan(configPath) : configPath}`);
      console.log(`  ${enableColors ? chalk.bold('Working Directory:') : 'Working Directory:'} ${config.workingDirectory}`);
      console.log(`  ${enableColors ? chalk.bold('Max Concurrent:') : 'Max Concurrent:'}    ${config.maxConcurrentTasks}`);
      console.log(`  ${enableColors ? chalk.bold('Loop Interval:') : 'Loop Interval:'}     ${config.loopInterval}ms (${(config.loopInterval / 1000).toFixed(1)}s)`);
      console.log(`  ${enableColors ? chalk.bold('Max Retries:') : 'Max Retries:'}       ${config.maxRetries}`);
      console.log(`  ${enableColors ? chalk.bold('Log Level:') : 'Log Level:'}         ${config.logLevel}`);
      console.log(`  ${enableColors ? chalk.bold('Auto Start:') : 'Auto Start:'}        ${config.enableAutoStart}`);
      console.log(`  ${enableColors ? chalk.bold('Max Loop Iterations:') : 'Max Loop Iterations:'} ${config.maxLoopIterations || (enableColors ? chalk.green('unlimited') : 'unlimited')}`);
      console.log(`  ${enableColors ? chalk.bold('Self Task Gen:') : 'Self Task Gen:'}     ${config.enableSelfTaskGeneration ? (enableColors ? chalk.green('enabled') : 'enabled') : (enableColors ? chalk.yellow('disabled') : 'disabled')}`);

      if (config.projects && config.projects.length > 0) {
        console.log(enableColors ? `\n${chalk.bold.cyan(`📁 Projects (${config.projects.length}):`)}` : `\n📁 Projects (${config.projects.length}):`);
        config.projects.forEach((project: ProjectConfig, index: number) => {
          console.log(`\n  ${index + 1}. ${enableColors ? chalk.cyan(project.name) : project.name}`);
          console.log(`     ${enableColors ? chalk.bold('Working Dir:') : 'Working Dir:'} ${project.workingDirectory}`);
          if (project.maxLoopIterations) {
            console.log(`     ${enableColors ? chalk.bold('Max Iterations:') : 'Max Iterations:'} ${project.maxLoopIterations}`);
          }
        });
      }

      console.log(enableColors ? `\n${chalk.bold.cyan(`🤖 Agents (${config.agents.length}):`)}` : `\n🤖 Agents (${config.agents.length}):`);
      if (config.agents.length === 0) {
        console.log(enableColors ? chalk.yellow('  No agents configured') : '  No agents configured');
      } else {
        for (const agent of config.agents) {
          console.log(`\n  ${enableColors ? chalk.cyan(agent.name) : agent.name} (${enableColors ? chalk.yellow(agent.type) : agent.type})`);
          if (agent.model) console.log(`    Model: ${agent.model}`);
          if (agent.workingDirectory) console.log(`    Working Dir: ${agent.workingDirectory}`);
          if (agent.maxTokens) console.log(`    Max Tokens: ${agent.maxTokens}`);
          if (agent.timeout) console.log(`    Timeout: ${agent.timeout}ms (${(agent.timeout / 1000).toFixed(1)}s)`);
        }
      }
      console.log('');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      displayError(`Failed to load configuration: ${message}`);
      process.exit(ExitCode.GENERAL_ERROR);
    }
  });

/**
 * Validate the configuration
 */
program
  .command('validate')
  .description('Validate configuration and check for issues')
  .alias('val')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('--json', 'Output in JSON format')
  .addHelpText('after', () => {
    const examples = getCommandExamples('validate');
    return enableColors
      ? `\n${chalk.bold('📝 Examples:')}\n  ${examples}\n`
      : `\n📝 Examples:\n  ${examples}\n`;
  })
  .action(async (opts: { config?: string; json?: boolean }) => {
    try {
      const configManager = new ConfigManager(opts.config);
      const configPath = configManager['configPath'];

      // Check if config file exists
      if (!existsSync(configPath)) {
        if (opts.json) {
          console.log(JSON.stringify({
            valid: false,
            errors: [`Configuration file not found at ${configPath}`]
          }, null, 2));
        } else {
          displayError(
            `Configuration file not found at "${configPath}"`,
            [
              `Run 'qwen-loop init' to create a configuration file`,
              `Use 'qwen-loop init --interactive' for guided setup`,
              `Or specify a custom path: qwen-loop validate --config <path>`,
            ]
          );
        }
        process.exit(ExitCode.CONFIG_NOT_FOUND);
      }

      const config = configManager.getConfig();
      const errors = configManager.validateConfig();

      if (opts.json) {
        console.log(JSON.stringify({
          valid: errors.length === 0,
          errors: errors,
          summary: {
            totalIssues: errors.length,
            agentsConfigured: config.agents.length,
            projectsConfigured: config.projects?.length || 0,
            workingDirectory: config.workingDirectory
          }
        }, null, 2));
      } else {
        console.log(enableColors ? `\n${chalk.bold.cyan('🔍 Configuration Validation')}` : '\n🔍 Configuration Validation');
        console.log(enableColors ? chalk.gray('═'.repeat(60)) : '═'.repeat(60));
        console.log(`  ${enableColors ? chalk.bold('Config File:') : 'Config File:'} ${enableColors ? chalk.cyan(configPath) : configPath}`);
        console.log(`  ${enableColors ? chalk.bold('Working Dir:') : 'Working Dir:'} ${config.workingDirectory}\n`);

        if (errors.length === 0) {
          console.log(enableColors 
            ? chalk.green.bold('✓ Configuration is valid - No issues found\n')
            : '✓ Configuration is valid - No issues found\n');
        } else {
          console.log(enableColors 
            ? chalk.red.bold(`✖ Found ${errors.length} issue(s):\n`)
            : `✖ Found ${errors.length} issue(s):\n`);
          errors.forEach((err, index) => {
            console.log(`  ${enableColors ? chalk.red(`${index + 1}.`) : `${index + 1}.`} ${err}`);
          });
          console.log(enableColors ? `\n${chalk.yellow.bold('💡 Suggestions:')}` : '\n💡 Suggestions:');

          // Provide specific suggestions based on errors
          if (errors.some(e => e.includes('No agents configured'))) {
            console.log(enableColors ? chalk.gray('  • Add at least one agent to the "agents" array in your config') : '  • Add at least one agent to the "agents" array in your config');
            console.log(enableColors ? chalk.gray('  • Run "qwen-loop init" to create a fresh configuration') : '  • Run "qwen-loop init" to create a fresh configuration');
          }

          if (errors.some(e => e.includes('does not exist'))) {
            console.log(enableColors ? chalk.gray('  • Create the missing directories') : '  • Create the missing directories');
            console.log(enableColors ? chalk.gray('  • Update the workingDirectory paths in your config') : '  • Update the workingDirectory paths in your config');
          }

          if (errors.some(e => e.includes('must be at least'))) {
            console.log(enableColors ? chalk.gray('  • Update the configuration values to meet minimum requirements') : '  • Update the configuration values to meet minimum requirements');
          }

          console.log('');
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (opts.json) {
        console.log(JSON.stringify({
          valid: false,
          errors: [`Failed to validate configuration: ${message}`]
        }, null, 2));
      } else {
        displayError(`Failed to validate configuration: ${message}`);
      }
      process.exit(ExitCode.VALIDATION_FAILED);
    }
  });

// Export for programmatic use
export { LoopManager, MultiProjectManager, ConfigManager, QwenAgent, CustomAgent };

// Add command-not-found handler with suggestions

// Override the error handler for unknown commands
program.on('command:*', () => {
  const args = process.argv.slice(2);
  const typedCmd = args.find(arg => !arg.startsWith('-') && arg !== '--help' && arg !== '-h' && arg !== '--version' && arg !== '-V');

  if (typedCmd) {
    const suggestion = suggestCommand(typedCmd);
    if (suggestion) {
      displayErrorCode(
        `Unknown command: "${typedCmd}"`,
        'UNKNOWN_COMMAND',
        [
          `Did you mean: ${chalk.yellow(suggestion)}?`,
          `Run ${chalk.yellow('qwen-loop --help')} to see all available commands`,
        ]
      );
    } else {
      // Provide contextual suggestions based on what they might be trying to do
      const commonCommands = ['init', 'start', 'add-task', 'status', 'validate', 'health', 'config'];
      const similarCmd = commonCommands.find(cmd => 
        cmd.toLowerCase().includes(typedCmd.toLowerCase()) || 
        typedCmd.toLowerCase().includes(cmd.toLowerCase())
      );

      const suggestions = similarCmd
        ? [
            `Did you mean: ${chalk.yellow(similarCmd)}?`,
            `Run ${chalk.yellow(`qwen-loop ${similarCmd} --help`)} for command-specific help`,
          ]
        : [
            `Run ${chalk.yellow('qwen-loop --help')} to see all available commands`,
            `Most used: ${commonCommands.slice(0, 5).map(c => chalk.yellow(c)).join(', ')}`,
          ];

      displayErrorCode(
        `Unknown command: "${typedCmd}"`,
        'UNKNOWN_COMMAND',
        suggestions
      );
    }
  } else {
    displayErrorCode(
      'No command specified',
      'MISSING_COMMAND',
      [
        `Run ${chalk.yellow('qwen-loop --help')} to see available commands`,
        `Get started: ${chalk.yellow('qwen-loop init --interactive')}`,
      ]
    );
  }
  process.exit(ExitCode.GENERAL_ERROR);
});

// Parse CLI arguments
program.parse(process.argv);
