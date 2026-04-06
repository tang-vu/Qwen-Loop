#!/usr/bin/env node

import { Command, Help, Option } from 'commander';
import { LoopManager } from './core/loop-manager.js';
import { MultiProjectManager } from './core/multi-project-manager.js';
import { ConfigManager } from './core/config-manager.js';
import { QwenAgent, CustomAgent } from './agents/index.js';
import { TaskPriority, AgentType, AgentConfig, ProjectConfig, LoopConfig, IAgent } from './types.js';
import { logger, setLogLevel } from './logger.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { confirm, input, select } from '@inquirer/prompts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageJson: { version: string } = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

// Track if color output should be disabled
let enableColors = true;

// Setup global error handlers
process.on('uncaughtException', (error) => {
  const msg = enableColors ? chalk.red('✖ Error') : '✖ Error';
  const detail = enableColors ? chalk.gray : (s: string) => s;
  console.error(`\n${msg}: ${error.message || 'An unexpected error occurred'}`);
  console.error(detail('\nThis is likely a bug. Please report it at:'));
  console.error('  https://github.com/tang-vu/Qwen-Loop/issues\n');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const msg = enableColors ? chalk.red('✖ Error') : '✖ Error';
  const detail = enableColors ? chalk.gray : (s: string) => s;
  console.error(`\n${msg}: ${message}`);
  console.error(detail('\nThis is likely a bug. Please report it at:'));
  console.error('  https://github.com/tang-vu/Qwen-Loop/issues\n');
  process.exit(1);
});

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
      ? `\n${chalk.bold.cyan('🤖 Qwen Loop')} ${chalk.gray(`v${packageJson.version}`)} - Autonomous Multi-Agent Loop System`
      : `\n🤖 Qwen Loop v${packageJson.version} - Autonomous Multi-Agent Loop System`;
    return banner + '\n';
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
    const tip = (text: string) => enableColors ? chalk.bold('💡 Tips:') : '💡 Tips:';
    const res = (text: string) => enableColors ? chalk.bold('📚 Resources:') : '📚 Resources:';
    const gray = (text: string) => enableColors ? chalk.gray(text) : text;
    const cyan = (text: string) => enableColors ? chalk.cyan(text) : text;
    
    return `
${tip('')}
  • Run ${cmd('qwen-loop init')} to create your first configuration file
  • Use ${cmd('qwen-loop init --interactive')} for guided setup
  • Try ${cmd('qwen-loop validate')} to check your configuration for issues
  • Add ${cmd('--json')} to health and status commands for script-friendly output
  • Press ${cmd('Ctrl+C')} to gracefully stop the agent loop

${res('')}
  Documentation  ${cyan('https://github.com/tang-vu/Qwen-Loop#readme')}
  Report Issues  ${cyan('https://github.com/tang-vu/Qwen-Loop/issues')}

${enableColors ? chalk.bold('📖 Example Usage:') : '📖 Example Usage:'}
  ${gray('# Create configuration interactively')}
  ${cmd('qwen-loop init --interactive')}
  
  ${gray('# Start the agent loop with health check on port 8080')}
  ${cmd('qwen-loop start --health-port 8080')}
  
  ${gray('# Add a high-priority task')}
  ${cmd('qwen-loop add-task "Fix login bug" --priority high')}
  
  ${gray('# Check system health in JSON format')}
  ${cmd('qwen-loop health --json')}
`;
  });

/**
 * Helper: Display error message with optional suggestion
 */
function displayError(message: string, suggestion?: string): void {
  const errorLabel = enableColors ? `${chalk.red('✖ Error')}` : '✖ Error';
  const suggestionLabel = enableColors ? chalk.gray('💡 Suggestion:') : '💡 Suggestion:';
  
  console.error(`\n${errorLabel}: ${message}`);
  if (suggestion) {
    console.error(`\n${suggestionLabel} ${suggestion}`);
  }
  console.error('');
}

/**
 * Helper: Display success message
 */
function displaySuccess(message: string): void {
  const successLabel = enableColors ? chalk.green('✓') : '✓';
  console.log(`\n${successLabel} ${message}\n`);
}

/**
 * Helper: Display warning message
 */
function displayWarning(message: string): void {
  const warningLabel = enableColors ? chalk.yellow('⚠ Warning:') : '⚠ Warning:';
  console.log(`\n${warningLabel} ${message}\n`);
}

/**
 * Helper: Display info message
 */
function displayInfo(message: string): void {
  const infoLabel = enableColors ? chalk.cyan('ℹ Info:') : 'ℹ Info:';
  console.log(`\n${infoLabel} ${message}\n`);
}

/**
 * Helper: Check if config file exists, display helpful error if not
 */
function requireConfig(configManager: ConfigManager): void {
  if (!configManager.isConfigLoadedFromFile()) {
    const configPath = configManager['configPath'];
    displayError(
      `Configuration file not found at ${configPath}`,
      `Run 'qwen-loop init' to create a configuration file, or specify one with --config <path>`
    );
    process.exit(1);
  }
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
      `${gray('# Force overwrite')} → ${cmd('qwen-loop init-multi --force')}`,
    ],
    'start': [
      `${gray('# Start with defaults')} → ${cmd('qwen-loop start')}`,
      `${gray('# With health check')} → ${cmd('qwen-loop start --health-port 8080')}`,
      `${gray('# Check health')} → ${cmd('qwen-loop health --live --port 8080')}`,
      `${gray('# Custom config file')} → ${cmd('qwen-loop start --config my-config.json')}`,
    ],
    'add-task': [
      `${gray('# Add medium priority task')} → ${cmd('qwen-loop add-task "Write tests"')}`,
      `${gray('# Add critical task')} → ${cmd('qwen-loop add-task "Fix security issue" --priority critical')}`,
    ],
    'status': [
      `${gray('# Human-readable')} → ${cmd('qwen-loop status')}`,
      `${gray('# JSON output')} → ${cmd('qwen-loop status --json')}`,
    ],
    'health': [
      `${gray('# Check health')} → ${cmd('qwen-loop health')}`,
      `${gray('# Live metrics')} → ${cmd('qwen-loop health --live')}`,
      `${gray('# JSON for scripts')} → ${cmd('qwen-loop health --json')}`,
      `${gray('# Custom port')} → ${cmd('qwen-loop health --port 8080')}`,
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

program
  .command('init')
  .description('Create configuration file (single project mode)')
  .option('--interactive', 'Use interactive mode to configure settings step-by-step')
  .option('-f, --force', 'Overwrite existing configuration file without prompting')
  .addHelpText('after', () => {
    const examples = getCommandExamples('init');
    return enableColors 
      ? `\n${chalk.bold('📝 Examples:')}\n  ${examples}\n`
      : `\n📝 Examples:\n  ${examples}\n`;
  })
  .action(async (opts) => {
    try {
      const configPath = join(process.cwd(), 'qwen-loop.config.json');

      // Check if config file already exists
      if (existsSync(configPath) && !opts.force) {
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
      }

      let configData: string;

      if (opts.interactive) {
        console.log(enableColors
          ? `\n${chalk.bold.cyan('🔧 Interactive Configuration Setup')}`
          : `\n🔧 Interactive Configuration Setup`);
        console.log(enableColors
          ? chalk.gray('Answer the following questions to set up your project\n')
          : 'Answer the following questions to set up your project\n');

        // Ask for working directory
        const workingDir = await input({
          message: enableColors ? chalk.white('Working directory (press Enter for current dir):') : 'Working directory (press Enter for current dir):',
          default: './project',
          validate: (value) => {
            if (value.trim() === '') return true;
            return true;
          }
        });

        // Ask for agent type
        const agentType = await select({
          message: enableColors ? chalk.white('Select agent type:') : 'Select agent type:',
          choices: [
            { name: 'Qwen - Use Qwen AI model', value: AgentType.QWEN },
            { name: 'Custom - Custom agent implementation', value: AgentType.CUSTOM },
          ]
        });

        // Ask for agent name
        const agentName = await input({
          message: enableColors ? chalk.white('Agent name:') : 'Agent name:',
          default: agentType === AgentType.QWEN ? 'qwen-dev' : 'custom-agent',
          validate: (value) => value.trim() ? true : 'Agent name cannot be empty'
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

      writeFileSync(configPath, configData);
      displaySuccess(`Configuration file created at ${chalk.cyan(configPath)}`);

      console.log(enableColors ? chalk.bold('\n📝 Next steps:') : '\n📝 Next steps:');
      console.log(enableColors ? chalk.gray('  1. Edit the configuration file if needed:') : '  1. Edit the configuration file if needed:');
      console.log(enableColors ? chalk.cyan(`     ${configPath}`) : `     ${configPath}`);
      console.log(enableColors ? chalk.gray('  2. Validate your configuration:') : '  2. Validate your configuration:');
      console.log(enableColors ? chalk.yellow('     qwen-loop validate') : '     qwen-loop validate');
      console.log(enableColors ? chalk.gray('  3. Start the agent loop:') : '  3. Start the agent loop:');
      console.log(enableColors ? chalk.yellow('     qwen-loop start\n') : '     qwen-loop start\n');
    } catch (error) {
      if (error instanceof Error && error.message === 'User force closed the prompt') {
        console.log(enableColors 
          ? chalk.gray('\n\n⚠ Configuration cancelled by user.\n')
          : '\n\n⚠ Configuration cancelled by user.\n');
        process.exit(0);
      }
      const message = error instanceof Error ? error.message : String(error);
      displayError(
        `Failed to create configuration file: ${message}`, 
        'Check that you have write permissions in the current directory'
      );
      process.exit(1);
    }
  });

program
  .command('init-multi')
  .description('Create multi-project configuration file')
  .option('--interactive', 'Use interactive mode to configure projects step-by-step')
  .option('-f, --force', 'Overwrite existing configuration file without prompting')
  .addHelpText('after', () => {
    const examples = getCommandExamples('init-multi');
    return enableColors 
      ? `\n${chalk.bold('📝 Examples:')}\n  ${examples}\n`
      : `\n📝 Examples:\n  ${examples}\n`;
  })
  .action(async (opts) => {
    try {
      const configPath = join(process.cwd(), 'qwen-loop.config.json');

      // Check if config file already exists
      if (existsSync(configPath) && !opts.force) {
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
      }

      let configData: string;

      if (opts.interactive) {
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
            validate: (value) => value.trim() ? true : 'Project name cannot be empty'
          });

          const projectDir = await input({
            message: enableColors ? chalk.white('Working directory:') : 'Working directory:',
            default: `./${projectName}`,
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

      writeFileSync(configPath, configData);
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
        process.exit(0);
      }
      const message = error instanceof Error ? error.message : String(error);
      displayError(
        `Failed to create configuration file: ${message}`,
        'Check that you have write permissions in the current directory'
      );
      process.exit(1);
    }
  });

program
  .command('start')
  .description('Start the agent loop (auto-detects single or multi-project mode)')
  .option('-c, --config <path>', 'Path to configuration file (default: ./qwen-loop.config.json)')
  .option('--auto-start', 'Automatically start processing tasks')
  .option('--health-port <port>', 'Enable HTTP health check server on specified port', parseInt)
  .action(async (opts) => {
    try {
      const configManager = new ConfigManager(opts.config);
      const config = configManager.getConfig();

      // Check if config file was loaded or using defaults
      if (!existsSync(configManager['configPath'])) {
        displayError(
          `Configuration file not found at ${configManager['configPath']}`,
          `Run 'qwen-loop init' first to create a configuration file`
        );
        process.exit(1);
      }

      // Set log level
      setLogLevel(config.logLevel);

      // Validate configuration
      const errors = configManager.validateConfig();
      if (errors.length > 0) {
        console.error(`\n${chalk.yellow('⚠ Configuration Issues:')} (${errors.length} found)`);
        errors.forEach(err => console.error(`  ${chalk.red('•')} ${err}`));
        
        // Ask user if they want to continue
        try {
          const shouldContinue = await confirm({
            message: chalk.yellow('\nDo you want to continue anyway? (not recommended)'),
            default: false
          });
          
          if (!shouldContinue) {
            console.log(chalk.cyan('\nℹ Aborted. Fix the issues above and try again.\n'));
            console.log(chalk.gray('💡 Tips:'));
            console.log(chalk.gray('  • Run "qwen-loop validate" for detailed validation output'));
            console.log(chalk.gray('  • Run "qwen-loop init" to create a fresh configuration\n'));
            process.exit(0);
          }
          console.log(chalk.yellow('\n⚠ Continuing with warnings...\n'));
        } catch (error) {
          // User cancelled (Ctrl+C)
          console.log(chalk.gray('\n\n⚠ Aborted.\n'));
          process.exit(0);
        }
      }

      // Handle graceful shutdown
      const setupShutdown = async (stopFn: () => Promise<void>) => {
        process.on('SIGINT', async () => {
          console.log(chalk.yellow('\n\n⏹ Shutting down gracefully...'));
          await stopFn();
          console.log(chalk.green('✓ Shutdown complete.\n'));
          process.exit(0);
        });

        process.on('SIGTERM', async () => {
          console.log(chalk.yellow('\n\n⏹ Shutting down gracefully...'));
          await stopFn();
          console.log(chalk.green('✓ Shutdown complete.\n'));
          process.exit(0);
        });
      };

      // Check if multi-project mode
      if (config.projects && config.projects.length > 0) {
        console.log(`\n${chalk.bold.cyan('🌐 Multi-Project Mode')}\n`);

        const multiManager = new MultiProjectManager(config);
        await multiManager.initialize();
        await multiManager.start();

        // Start health server if requested
        let healthServer: import('./core/health-server.js').HealthServer | undefined;
        if (opts.healthPort) {
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

          healthServer = new HealthServer(healthChecker, opts.healthPort);
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
        const loopManager = new LoopManager(config);

        // Create and register agents
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
        await loopManager.start();

        // Start health server if requested
        let healthServer: import('./core/health-server.js').HealthServer | undefined;
        if (opts.healthPort) {
          const { HealthServer } = await import('./core/health-server.js');
          healthServer = new HealthServer(loopManager.getHealthChecker(), opts.healthPort);
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
        displayError(
          `Failed to start: Configuration or dependency missing`,
          `Run 'qwen-loop validate' to check your configuration`
        );
      } else if (message.includes('EADDRINUSE')) {
        displayError(
          `Port is already in use`,
          `Use a different port: qwen-loop start --health-port <different-port>`
        );
      } else {
        displayError(`Failed to start Qwen Loop: ${message}`);
      }
      process.exit(1);
    }
  });

program
  .command('add-task <description>')
  .description('Add a task to the queue')
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
      let priorityKey: string;
      let priority: TaskPriority;

      if (opts.interactive) {
        // Interactive mode: prompt for priority
        const selectedPriority = await select({
          message: enableColors ? chalk.white('Select task priority:') : 'Select task priority:',
          choices: [
            { name: 'Low - Background tasks', value: 'low' },
            { name: 'Medium - Normal tasks (default)', value: 'medium' },
            { name: 'High - Important tasks', value: 'high' },
            { name: 'Critical - Urgent tasks', value: 'critical' },
          ],
          default: 'medium'
        });
        priorityKey = selectedPriority;
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
          displayError(
            `Invalid priority: ${opts.priority}`,
            `Valid priorities are: low, medium, high, critical`
          );
          process.exit(1);
        }
      }

      const priorityMap: Record<string, TaskPriority> = {
        low: TaskPriority.LOW,
        medium: TaskPriority.MEDIUM,
        high: TaskPriority.HIGH,
        critical: TaskPriority.CRITICAL
      };

      priority = priorityMap[priorityKey];

      const configManager = new ConfigManager(opts.config);
      requireConfig(configManager);

      const config = configManager.getConfig();

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
      console.log(enableColors ? chalk.gray('─'.repeat(50)) : '─'.repeat(50));
      console.log(`  ${enableColors ? chalk.bold('Description:') : 'Description:'} ${description}`);
      console.log(`  ${enableColors ? chalk.bold('Priority:') : 'Priority:'}    ${enableColors ? chalk.cyan(priority) : priority}`);
      console.log(`  ${enableColors ? chalk.bold('Task ID:') : 'Task ID:'}     ${task.id}`);
      console.log(`  ${enableColors ? chalk.bold('Created:') : 'Created:'}     ${task.createdAt.toISOString()}`);
      console.log(enableColors ? chalk.gray('─'.repeat(50)) : '─'.repeat(50));
      console.log(enableColors ? chalk.gray('\n💡 Start processing with: qwen-loop start\n') : '\n💡 Start processing with: qwen-loop start\n');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      displayError(
        `Failed to add task: ${message}`, 
        'Make sure your configuration file is valid and contains at least one agent'
      );
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show current status of agents and tasks')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('--json', 'Output in JSON format')
  .addHelpText('after', () => {
    const examples = getCommandExamples('status');
    return enableColors 
      ? `\n${chalk.bold('📝 Examples:')}\n  ${examples}\n`
      : `\n📝 Examples:\n  ${examples}\n`;
  })
  .action(async (opts) => {
    try {
      const configManager = new ConfigManager(opts.config);

      // Check if config exists
      if (!existsSync(configManager['configPath'])) {
        displayError(
          'No configuration file found',
          'Run "qwen-loop init" to create a configuration file first'
        );
        process.exit(1);
      }

      const config = configManager.getConfig();

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
        };
        console.log(JSON.stringify(statusData, null, 2));
        return;
      }

      console.log(enableColors ? `\n${chalk.bold.cyan('📊 Qwen Loop Status')}` : '\n📊 Qwen Loop Status');
      console.log(enableColors ? chalk.gray('═'.repeat(60)) : '═'.repeat(60));

      // Show configuration summary
      console.log(enableColors ? chalk.bold.cyan('\n⚙ Configuration:') : '\n⚙ Configuration:');
      console.log(`  ${enableColors ? chalk.bold('Config File:') : 'Config File:'}  ${enableColors ? chalk.cyan(configManager['configPath']) : configManager['configPath']}`);
      console.log(`  ${enableColors ? chalk.bold('Working Dir:') : 'Working Dir:'}  ${config.workingDirectory}`);
      console.log(`  ${enableColors ? chalk.bold('Agents:') : 'Agents:'}       ${config.agents.length}`);
      console.log(`  ${enableColors ? chalk.bold('Max Tasks:') : 'Max Tasks:'}    ${config.maxConcurrentTasks}`);
      console.log(`  ${enableColors ? chalk.bold('Interval:') : 'Interval:'}     ${config.loopInterval}ms (${(config.loopInterval / 1000).toFixed(1)}s)`);
      console.log(`  ${enableColors ? chalk.bold('Max Retries:') : 'Max Retries:'}  ${config.maxRetries}`);

      if (config.projects && config.projects.length > 0) {
        console.log(enableColors ? `\n${chalk.bold.cyan(`📁 Projects (${config.projects.length}):`)}` : `\n📁 Projects (${config.projects.length}):`);
        config.projects.forEach((project: ProjectConfig, index: number) => {
          console.log(`  ${index + 1}. ${enableColors ? chalk.cyan(project.name) : project.name} - ${project.workingDirectory}`);
        });
      }

      if (config.agents.length > 0) {
        console.log(enableColors ? `\n${chalk.bold.cyan(`🤖 Agents (${config.agents.length}):`)}` : `\n🤖 Agents (${config.agents.length}):`);
        config.agents.forEach((agent: AgentConfig, index: number) => {
          console.log(`  ${index + 1}. ${enableColors ? chalk.cyan(agent.name) : agent.name} (${enableColors ? chalk.yellow(agent.type) : agent.type})`);
          if (agent.model) console.log(`     Model: ${agent.model}`);
          if (agent.workingDirectory) console.log(`     Working Dir: ${agent.workingDirectory}`);
        });
      }

      console.log(enableColors ? `\n${chalk.gray('ℹ For live task status, the loop must be running.')}` : '\nℹ For live task status, the loop must be running.');
      console.log(enableColors ? chalk.gray('  Start with: qwen-loop start\n') : '  Start with: qwen-loop start\n');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      displayError(`Failed to show status: ${message}`);
      process.exit(1);
    }
  });

program
  .command('health')
  .description('Show system health status including agents, tasks, and resources')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('--json', 'Output in JSON format for scripts')
  .option('--host <host>', 'Health server hostname (default: localhost)', 'localhost')
  .option('--port <port>', 'Health server port (default: 3100)', '3100')
  .option('--live', 'Fetch live metrics from running instance')
  .addHelpText('after', () => {
    const examples = getCommandExamples('health');
    return enableColors
      ? `\n${chalk.bold('📝 Examples:')}\n  ${examples}\n`
      : `\n📝 Examples:\n  ${examples}\n`;
  })
  .action(async (opts) => {
    try {
      console.log(enableColors ? `\n${chalk.bold.cyan('📊 Qwen Loop Health Check')}` : '\n📊 Qwen Loop Health Check');
      console.log(enableColors ? chalk.gray('═'.repeat(60)) : '═'.repeat(60));

      // Try to fetch from running instance if --live flag is set or if we can connect
      const port = parseInt(opts.port, 10);
      const { isHealthServerAvailable } = await import('./utils/health-client.js');
      const serverAvailable = await isHealthServerAvailable(opts.host, port);

      if (opts.live || serverAvailable) {
        if (!serverAvailable) {
          displayError(
            'Cannot connect to health server',
            `Make sure the loop is running with --health-port ${port}`
          );
          process.exit(1);
        }

        const { fetchHealthReport } = await import('./utils/health-client.js');
        const report = await fetchHealthReport({ host: opts.host, port });

        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          const { HealthChecker } = await import('./core/health-checker.js');
          const healthChecker = new HealthChecker();
          console.log(healthChecker.formatReportForConsole(report));
        }
      } else {
        // Fallback to static report from config
        const { HealthChecker } = await import('./core/health-checker.js');
        const configManager = new ConfigManager(opts.config);

        if (!existsSync(configManager['configPath'])) {
          displayError(
            'No configuration file found',
            'Run "qwen-loop init" to create a configuration file first'
          );
          process.exit(1);
        }

        const config = configManager.getConfig();

        const healthChecker = new HealthChecker();

        // Update with config info
        healthChecker.updateLoopStats({
          maxConcurrentTasks: config.maxConcurrentTasks,
          loopInterval: config.loopInterval,
          maxRetries: config.maxRetries,
          workingDirectory: config.workingDirectory
        });

        console.log(enableColors ? `\n${chalk.yellow('ℹ Note:')}` : '\nℹ Note:');
        console.log(enableColors ? chalk.gray('  For live metrics, start the loop with --health-port and use --live flag.') : '  For live metrics, start the loop with --health-port and use --live flag.');
        console.log(enableColors ? chalk.gray('  This report shows configuration and system resource status.\n') : '  This report shows configuration and system resource status.\n');

        // Update with agent configs
        const agentConfigs = config.agents;
        if (agentConfigs.length > 0) {
          console.log(enableColors ? chalk.bold.cyan(`🤖 Configured Agents (${agentConfigs.length}):`) : `🤖 Configured Agents (${agentConfigs.length}):`);
          for (const agent of agentConfigs) {
            console.log(`  ${enableColors ? chalk.green('•') : '•'} ${enableColors ? chalk.cyan(agent.name) : agent.name} (${enableColors ? chalk.yellow(agent.type) : agent.type})`);
          }
          console.log('');
        }

        // Generate and display report
        const report = healthChecker.getJsonReport();

        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(healthChecker.formatReportForConsole(report));
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      displayError(`Failed to generate health report: ${message}`);
      process.exit(1);
    }
  });

/**
 * Show the current configuration
 */
program
  .command('config')
  .description('Show current configuration details')
  .option('-c, --config <path>', 'Path to configuration file (default: ./qwen-loop.config.json)')
  .option('--json', 'Output in JSON format')
  .addHelpText('after', () => {
    const examples = getCommandExamples('config');
    return enableColors 
      ? `\n${chalk.bold('📝 Examples:')}\n  ${examples}\n`
      : `\n📝 Examples:\n  ${examples}\n`;
  })
  .action(async (opts) => {
    try {
      const configManager = new ConfigManager(opts.config);
      const configPath = configManager['configPath'];

      if (!existsSync(configPath)) {
        displayError(
          `Configuration file not found at ${configPath}`,
          `Run 'qwen-loop init' to create a configuration file`
        );
        process.exit(1);
      }

      const config = configManager.getConfig();

      if (opts.json) {
        console.log(JSON.stringify(config, null, 2));
        return;
      }

      console.log(enableColors ? `\n${chalk.bold.cyan('⚙ Configuration Details')}` : '\n⚙ Configuration Details');
      console.log(enableColors ? chalk.gray('═'.repeat(60)) : '═'.repeat(60));
      
      console.log(enableColors ? chalk.bold.cyan('\n📋 General:') : '\n📋 General:');
      console.log(`  ${enableColors ? chalk.bold('Config File:') : 'Config File:'}      ${enableColors ? chalk.cyan(configPath) : configPath}`);
      console.log(`  ${enableColors ? chalk.bold('Working Directory:') : 'Working Directory:'} ${config.workingDirectory}`);
      console.log(`  ${enableColors ? chalk.bold('Max Concurrent:') : 'Max Concurrent:'}    ${config.maxConcurrentTasks}`);
      console.log(`  ${enableColors ? chalk.bold('Loop Interval:') : 'Loop Interval:'}     ${config.loopInterval}ms (${(config.loopInterval / 1000).toFixed(1)}s)`);
      console.log(`  ${enableColors ? chalk.bold('Max Retries:') : 'Max Retries:'}       ${config.maxRetries}`);
      console.log(`  ${enableColors ? chalk.bold('Log Level:') : 'Log Level:'}         ${config.logLevel}`);
      console.log(`  ${enableColors ? chalk.bold('Auto Start:') : 'Auto Start:'}        ${config.enableAutoStart}`);
      console.log(`  ${enableColors ? chalk.bold('Max Loop Iterations:') : 'Max Loop Iterations:'} ${config.maxLoopIterations || 'unlimited'}`);
      console.log(`  ${enableColors ? chalk.bold('Self Task Gen:') : 'Self Task Gen:'}     ${config.enableSelfTaskGeneration ? 'enabled' : 'disabled'}`);

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
      process.exit(1);
    }
  });

/**
 * Validate the configuration
 */
program
  .command('validate')
  .description('Validate configuration and check for issues')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('--json', 'Output in JSON format')
  .addHelpText('after', () => {
    const examples = getCommandExamples('validate');
    return enableColors 
      ? `\n${chalk.bold('📝 Examples:')}\n  ${examples}\n`
      : `\n📝 Examples:\n  ${examples}\n`;
  })
  .action(async (opts) => {
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
            `Configuration file not found at ${configPath}`,
            `Run 'qwen-loop init' to create a configuration file`
          );
        }
        process.exit(1);
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
      process.exit(1);
    }
  });

// Export for programmatic use
export { LoopManager, MultiProjectManager, ConfigManager, QwenAgent, CustomAgent };

// Parse CLI arguments
program.parse(process.argv);
