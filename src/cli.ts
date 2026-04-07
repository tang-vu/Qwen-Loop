#!/usr/bin/env node

import { Command } from 'commander';
import { LoopManager } from './core/loop-manager.js';
import { MultiProjectManager } from './core/multi-project-manager.js';
import { ConfigManager } from './core/config-manager.js';
import { QwenAgent, CustomAgent } from './agents/index.js';
import { TaskPriority, AgentType } from './types.js';
import { logger, setLogLevel } from './logger.js';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

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
    const configPath = join(process.cwd(), 'qwen-loop.config.json');
    writeFileSync(configPath, JSON.stringify(configManager.generateExampleConfig(), null, 2));
    console.log(`\n✓ Configuration created: ${configPath}`);
    console.log('Edit the file, then run: qwen-loop start\n');
  });

program
  .command('init-multi')
  .description('Generate multi-project configuration file')
  .action(() => {
    const configManager = new ConfigManager();
    const configPath = join(process.cwd(), 'qwen-loop.config.json');
    writeFileSync(configPath, JSON.stringify(configManager.generateMultiProjectExampleConfig(), null, 2));
    console.log(`\n✓ Multi-project config created: ${configPath}`);
    console.log('Edit the projects array, then run: qwen-loop start\n');
  });

program
  .command('start')
  .description('Start the agent loop (single or multi-project)')
  .option('-c, --config <path>', 'Configuration file path')
  .action(async (opts) => {
    try {
      const configManager = new ConfigManager(opts.config);
      const config = configManager.getConfig();
      setLogLevel(config.logLevel);

      const errors = configManager.validateConfig();
      if (errors.length > 0) {
        console.warn('\n⚠ Config warnings:');
        errors.forEach(e => console.warn(`  - ${e}`));
        console.log('');
      }

      const shutdown = async (stopFn: () => Promise<void>) => {
        process.on('SIGINT', async () => { console.log('\n\nShutting down...'); await stopFn(); process.exit(0); });
        process.on('SIGTERM', async () => { console.log('\n\nShutting down...'); await stopFn(); process.exit(0); });
      };

      if (config.projects && config.projects.length > 0) {
        console.log('\n🌐 Multi-project mode\n');
        const multiManager = new MultiProjectManager(config);
        await multiManager.initialize();
        await multiManager.start();

        const interval = setInterval(() => {
          if (!multiManager.isRunningStatus()) { clearInterval(interval); return; }
          console.log(multiManager.getAllStats());
        }, 30000);

        await shutdown(() => multiManager.stop());
        await new Promise(() => {});
      } else {
        const loopManager = new LoopManager(config);

        for (const agentConfig of config.agents) {
          let agent;
          switch (agentConfig.type) {
            case AgentType.QWEN: agent = new QwenAgent(agentConfig); break;
            case AgentType.CUSTOM: agent = new CustomAgent(agentConfig); break;
            default: logger.error(`Unknown agent type: ${agentConfig.type}`); continue;
          }
          loopManager.getOrchestrator().registerAgent(agent);
        }

        logger.info(`Registered ${config.agents.length} agents`);
        await loopManager.start();

        console.log('\n🚀 Qwen Loop running... Press Ctrl+C to stop\n');

        const interval = setInterval(() => {
          if (!loopManager.isRunning()) { clearInterval(interval); return; }
          console.log('\n' + loopManager.getAgentStatusReport());
          console.log(loopManager.getTaskQueueStats());
        }, 30000);

        await shutdown(() => loopManager.stop());
        await new Promise(() => {});
      }
    } catch (error) {
      logger.error(`Failed to start: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

program
  .command('add-task <description>')
  .description('Add a task to the queue')
  .option('-p, --priority <priority>', 'Priority: low, medium, high, critical', 'medium')
  .action((description, opts) => {
    const priorityMap: Record<string, TaskPriority> = {
      low: TaskPriority.LOW, medium: TaskPriority.MEDIUM,
      high: TaskPriority.HIGH, critical: TaskPriority.CRITICAL
    };
    const priority = priorityMap[opts.priority.toLowerCase()] || TaskPriority.MEDIUM;
    console.log(`\n✓ Task added (${priority}): ${description}\n`);
  });

program
  .command('status')
  .description('Show current status')
  .action(() => {
    console.log('\n📊 Start the loop first to see real-time status');
    console.log('Run: qwen-loop start\n');
  });

program
  .command('config')
  .description('Show current configuration')
  .option('-c, --config <path>', 'Configuration file path')
  .action((opts) => {
    const configManager = new ConfigManager(opts.config);
    const config = configManager.getConfig();
    console.log('\n⚙ Configuration\n');
    console.log(`Working Dir: ${config.workingDirectory}`);
    console.log(`Max Concurrent: ${config.maxConcurrentTasks}`);
    console.log(`Interval: ${config.loopInterval}ms`);
    console.log(`Max Retries: ${config.maxRetries}`);
    console.log(`Log Level: ${config.logLevel}`);
    console.log(`Agents (${config.agents.length}):`);
    config.agents.forEach(a => console.log(`  - ${a.name} (${a.type})`));
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
      console.log('\n⚠ Issues:');
      errors.forEach(e => console.error(`  - ${e}`));
      console.log('');
    }
  });

program.parse(process.argv);
