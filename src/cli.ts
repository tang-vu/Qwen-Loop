#!/usr/bin/env node

import { Command } from 'commander';
import { LoopManager } from './core/loop-manager.js';
import { MultiProjectManager } from './core/multi-project-manager.js';
import { ConfigManager } from './core/config-manager.js';
import { QwenAgent, CustomAgent } from './agents/index.js';
import { TaskPriority, AgentType, AgentConfig } from './types.js';
import { logger, setLogLevel } from './logger.js';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('qwen-loop')
  .description('Autonomous multi-agent loop for continuous code development')
  .version(packageJson.version);

program
  .command('init')
  .description('Generate example configuration file (single project)')
  .action(() => {
    const configManager = new ConfigManager();
    const exampleConfig = configManager.generateExampleConfig();

    const configPath = join(process.cwd(), 'qwen-loop.config.json');
    writeFileSync(configPath, exampleConfig);

    console.log(`\n✓ Example configuration created at: ${configPath}`);
    console.log('\nEdit the configuration file to set up your agents, then run:');
    console.log('  qwen-loop start');
  });

program
  .command('init-multi')
  .description('Generate multi-project configuration file')
  .action(() => {
    const configManager = new ConfigManager();
    const exampleConfig = configManager.generateMultiProjectExampleConfig();

    const configPath = join(process.cwd(), 'qwen-loop.config.json');
    writeFileSync(configPath, exampleConfig);

    console.log(`\n✓ Multi-project configuration created at: ${configPath}`);
    console.log('\nEdit the projects array to add your own projects, then run:');
    console.log('  qwen-loop start');
  });

program
  .command('start')
  .description('Start the agent loop (single or multi-project)')
  .option('-c, --config <path>', 'Configuration file path')
  .option('--auto-start', 'Automatically start processing tasks')
  .action(async (opts) => {
    try {
      const configManager = new ConfigManager(opts.config);
      const config = configManager.getConfig();

      // Set log level
      setLogLevel(config.logLevel);

      // Validate configuration
      const errors = configManager.validateConfig();
      if (errors.length > 0) {
        console.error('\n⚠ Configuration warnings/errors:');
        errors.forEach(err => console.error(`  - ${err}`));
        console.log('\nContinuing anyway...\n');
      }

      // Handle graceful shutdown
      const setupShutdown = async (stopFn: () => Promise<void>) => {
        process.on('SIGINT', async () => {
          console.log('\n\nShutting down...');
          await stopFn();
          process.exit(0);
        });

        process.on('SIGTERM', async () => {
          console.log('\n\nShutting down...');
          await stopFn();
          process.exit(0);
        });
      };

      // Check if multi-project mode
      if (config.projects && config.projects.length > 0) {
        console.log('\n🌐 Multi-project mode detected\n');

        const multiManager = new MultiProjectManager(config);
        await multiManager.initialize();
        await multiManager.start();

        // Print status every 30 seconds
        const statusInterval = setInterval(() => {
          if (!multiManager.isRunningStatus()) {
            clearInterval(statusInterval);
            return;
          }
          console.log(multiManager.getAllStats());
        }, 30000);

        await setupShutdown(() => multiManager.stop());

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

        console.log('\n🚀 Qwen Loop is running...');
        console.log('Press Ctrl+C to stop\n');

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

        await setupShutdown(() => loopManager.stop());

        // Keep the process alive
        await new Promise(() => {});
      }
    } catch (error) {
      logger.error(`Failed to start Qwen Loop: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

program
  .command('add-task <description>')
  .description('Add a task to the queue')
  .option('-p, --priority <priority>', 'Task priority (low, medium, high, critical)', 'medium')
  .option('-c, --config <path>', 'Configuration file path')
  .action(async (description, opts) => {
    try {
      const priorityMap: Record<string, TaskPriority> = {
        low: TaskPriority.LOW,
        medium: TaskPriority.MEDIUM,
        high: TaskPriority.HIGH,
        critical: TaskPriority.CRITICAL
      };

      const priority = priorityMap[opts.priority.toLowerCase()] || TaskPriority.MEDIUM;

      console.log(`\n✓ Task added with ${priority} priority:`);
      console.log(`  ${description}\n`);
    } catch (error) {
      logger.error(`Failed to add task: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show current status of agents and tasks')
  .option('-c, --config <path>', 'Configuration file path')
  .action((opts) => {
    console.log('\n📊 Qwen Loop Status');
    console.log('==================\n');
    console.log('Note: Start the loop first to see real-time status');
    console.log('Run: qwen-loop start\n');
  });

program
  .command('config')
  .description('Show current configuration')
  .option('-c, --config <path>', 'Configuration file path')
  .action((opts) => {
    const configManager = new ConfigManager(opts.config);
    const config = configManager.getConfig();
    
    console.log('\n⚙ Configuration');
    console.log('================\n');
    console.log(`Working Directory: ${config.workingDirectory}`);
    console.log(`Max Concurrent Tasks: ${config.maxConcurrentTasks}`);
    console.log(`Loop Interval: ${config.loopInterval}ms`);
    console.log(`Max Retries: ${config.maxRetries}`);
    console.log(`Log Level: ${config.logLevel}`);
    console.log(`Auto Start: ${config.enableAutoStart}`);
    console.log(`\nAgents (${config.agents.length}):`);
    
    for (const agent of config.agents) {
      console.log(`  - ${agent.name} (${agent.type})`);
      if (agent.model) console.log(`    Model: ${agent.model}`);
      if (agent.workingDirectory) console.log(`    Working Dir: ${agent.workingDirectory}`);
    }
    console.log('');
  });

program
  .command('validate')
  .description('Validate configuration')
  .option('-c, --config <path>', 'Configuration file path')
  .action((opts) => {
    const configManager = new ConfigManager(opts.config);
    const errors = configManager.validateConfig();
    
    if (errors.length === 0) {
      console.log('\n✓ Configuration is valid\n');
    } else {
      console.log('\n⚠ Configuration issues:');
      errors.forEach(err => console.error(`  - ${err}`));
      console.log('');
    }
  });

// Export for programmatic use
export { LoopManager, MultiProjectManager, ConfigManager, QwenAgent, CustomAgent };

// Parse CLI arguments
program.parse(process.argv);
