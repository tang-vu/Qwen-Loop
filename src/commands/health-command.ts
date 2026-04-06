import { Command } from 'commander';
import { ConfigManager } from '../core/config-manager.js';
import { HealthChecker } from '../core/health-checker.js';
import { QwenAgent, CustomAgent } from '../agents/index.js';
import { AgentType, AgentStatus } from '../types.js';
import { existsSync } from 'fs';
import chalk from 'chalk';
import { logger } from '../logger.js';
import type { HealthReport } from '../types.js';

// Track if color output should be disabled
let enableColors = true;

/**
 * Register the enhanced health command with subcommands
 */
export function registerHealthCommand(program: Command): void {
  program
    .command('health')
    .description('Show system health status including agents, tasks, and resources')
    .argument('[subcommand]', 'Specific health metric to check (agents, resources, throughput, summary)')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('--json', 'Output in JSON format for scripts')
    .option('--host <host>', 'Health server hostname (default: localhost)', 'localhost')
    .option('--port <port>', 'Health server port (default: 3100)', '3100')
    .option('--live', 'Fetch live metrics from running instance')
    .option('--watch', 'Continuously monitor health status (refreshes every 5s)')
    .option('--watch-interval <seconds>', 'Watch mode refresh interval in seconds (default: 5)', '5')
    .addHelpText('after', () => {
      const cmd = (text: string) => enableColors ? chalk.yellow(text) : text;
      const bold = (text: string) => enableColors ? chalk.bold(text) : text;
      const gray = (text: string) => enableColors ? chalk.gray(text) : text;
      
      return enableColors
        ? `\n${chalk.bold('📝 Examples:')}\n  ${gray('# Full health report')} → ${cmd('qwen-loop health')}\n  ${gray('# Agent health only')} → ${cmd('qwen-loop health agents')}\n  ${gray('# Resource usage only')} → ${cmd('qwen-loop health resources')}\n  ${gray('# Task throughput')} → ${cmd('qwen-loop health throughput')}\n  ${gray('# Summary status')} → ${cmd('qwen-loop health summary')}\n  ${gray('# Live metrics')} → ${cmd('qwen-loop health --live')}\n  ${gray('# Watch mode')} → ${cmd('qwen-loop health --watch')}\n  ${gray('# JSON for scripts')} → ${cmd('qwen-loop health --json')}\n  ${gray('# Custom refresh')} → ${cmd('qwen-loop health --watch --watch-interval 10')}\n`
        : `\n📝 Examples:\n  # Full health report → qwen-loop health\n  # Agent health only → qwen-loop health agents\n  # Resource usage only → qwen-loop health resources\n  # Task throughput → qwen-loop health throughput\n  # Summary status → qwen-loop health summary\n  # Live metrics → qwen-loop health --live\n  # Watch mode → qwen-loop health --watch\n  # JSON for scripts → qwen-loop health --json\n  # Custom refresh → qwen-loop health --watch --watch-interval 10\n`;
    })
    .action(async (subcommand: string | undefined, opts: any) => {
      try {
        // Validate subcommand
        const validSubcommands = ['agents', 'resources', 'throughput', 'summary', undefined];
        if (subcommand && !validSubcommands.includes(subcommand)) {
          console.error(enableColors ? chalk.red.bold('\n✖ Error') : '\n✖ Error');
          console.error(enableColors ? chalk.red(`  Invalid subcommand: ${subcommand}`) : `  Invalid subcommand: ${subcommand}`);
          console.error(enableColors ? chalk.gray('\nValid subcommands: agents, resources, throughput, summary') : '\nValid subcommands: agents, resources, throughput, summary');
          console.error(enableColors ? chalk.gray("Run 'qwen-loop health --help' for usage information\n") : "\nRun 'qwen-loop health --help' for usage information\n");
          process.exit(1);
        }

        // Watch mode
        if (opts.watch) {
          const interval = parseInt(opts.watchInterval, 10) * 1000 || 5000;
          console.log(enableColors ? chalk.yellow(`\n🔄 Watch mode enabled (refreshing every ${interval / 1000}s). Press Ctrl+C to stop.\n`) : `\n🔄 Watch mode enabled (refreshing every ${interval / 1000}s). Press Ctrl+C to stop.\n`);
          
          const watchHealth = async () => {
            try {
              await displayHealth(subcommand, opts, false);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              console.error(enableColors ? chalk.red(`\n✖ Error: ${message}`) : `\n✖ Error: ${message}`);
            }
          };

          // Initial display
          await watchHealth();
          
          // Set up interval
          const watchInterval = setInterval(watchHealth, interval);
          
          // Handle cleanup on exit
          process.on('SIGINT', () => {
            clearInterval(watchInterval);
            console.log(enableColors ? chalk.green('\n✔ Watch mode stopped.') : '\n✔ Watch mode stopped.');
            process.exit(0);
          });
          
          // Keep process alive
          await new Promise(() => {});
          return;
        }

        // Single health check
        await displayHealth(subcommand, opts, true);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(enableColors ? chalk.red(`\n✖ Error: Failed to generate health report: ${message}`) : `\n✖ Error: Failed to generate health report: ${message}`);
        process.exit(1);
      }
    });
}

/**
 * Helper function to display health information
 */
async function displayHealth(
  subcommand: string | undefined,
  opts: any,
  showHeader: boolean
): Promise<void> {
  const { isHealthServerAvailable, fetchHealthReport } = await import('../utils/health-client.js');
  
  // Try to fetch from running instance if --live flag is set or if we can connect
  const port = parseInt(opts.port, 10);
  const serverAvailable = await isHealthServerAvailable(opts.host, port);

  let report: HealthReport;

  if (opts.live || serverAvailable) {
    if (!serverAvailable) {
      console.error(enableColors ? chalk.red.bold('\n✖ Error: Cannot connect to health server') : '\n✖ Error: Cannot connect to health server');
      console.error(enableColors ? chalk.gray(`\nMake sure the loop is running with --health-port ${port}`) : `\nMake sure the loop is running with --health-port ${port}`);
      console.error(enableColors ? chalk.gray(`Example: qwen-loop start --health-port ${port}`) : `Example: qwen-loop start --health-port ${port}`);
      console.error(enableColors ? chalk.gray('Or check health without running: qwen-loop health\n') : 'Or check health without running: qwen-loop health\n');
      process.exit(1);
    }

    report = await fetchHealthReport({ host: opts.host, port });
  } else {
    // Fallback to static report from config
    const configManager = new ConfigManager(opts.config);

    if (!existsSync(configManager['configPath'])) {
      console.error(enableColors ? chalk.red.bold('\n✖ Error: No configuration file found') : '\n✖ Error: No configuration file found');
      console.error(enableColors ? chalk.gray('Run "qwen-loop init" to create a configuration file first\n') : 'Run "qwen-loop init" to create a configuration file first\n');
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

    // Try to initialize agents for more accurate health info
    try {
      const agents = [];
      for (const agentConfig of config.agents) {
        let agent;
        if (agentConfig.type === AgentType.QWEN) {
          agent = new QwenAgent(agentConfig);
        } else {
          agent = new CustomAgent(agentConfig);
        }
        
        // Try to initialize agent
        try {
          await agent.initialize();
          agents.push(agent);
        } catch (initError) {
          // Agent failed to initialize, still add it but it will show as unhealthy
          logger.warn(`Agent ${agentConfig.name} failed to initialize: ${(initError as Error).message}`);
          agents.push(agent);
        }
      }
      
      if (agents.length > 0) {
        healthChecker.updateAgents(agents);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to initialize agents for health check', { error: errorMessage });
    }

    report = healthChecker.getJsonReport();

    if (showHeader && !subcommand) {
      console.log(enableColors ? chalk.yellow('\nℹ Note:') : '\nℹ Note:');
      console.log(enableColors ? chalk.gray('  For live metrics, start the loop with --health-port and use --live flag.') : '  For live metrics, start the loop with --health-port and use --live flag.');
      console.log(enableColors ? chalk.gray('  This report shows system resources and configuration status.\n') : '  This report shows system resources and configuration status.\n');
    }
  }

  // Display header
  if (showHeader) {
    console.log(enableColors ? chalk.bold.cyan('\n📊 Qwen Loop Health Check') : '\n📊 Qwen Loop Health Check');
    console.log(enableColors ? chalk.gray('═'.repeat(60)) : '═'.repeat(60));
  }

  // Display specific subcommand output
  if (subcommand) {
    displaySubcommandReport(subcommand, report, opts);
  } else {
    // Display full report
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      const healthChecker = new HealthChecker();
      console.log(healthChecker.formatReportForConsole(report));
    }
  }
}

/**
 * Display specific subcommand report
 */
function displaySubcommandReport(
  subcommand: string,
  report: HealthReport,
  opts: any
): void {
  switch (subcommand) {
    case 'agents':
      if (opts.json) {
        console.log(JSON.stringify(report.agents, null, 2));
      } else {
        console.log(enableColors ? chalk.bold.cyan(`\n🤖 Agent Health (${report.agents.length} agents)`) : `\n🤖 Agent Health (${report.agents.length} agents)`);
        console.log(enableColors ? chalk.gray('─'.repeat(60)) : '─'.repeat(60));
        
        const healthyCount = report.agents.filter(a => a.healthy).length;
        const busyCount = report.agents.filter(a => a.status === AgentStatus.BUSY).length;
        const errorCount = report.agents.filter(a => a.status === AgentStatus.ERROR).length;
        
        console.log(`\n${enableColors ? chalk.green(`✔ Healthy: ${healthyCount}`) : `✔ Healthy: ${healthyCount}`}`);
        console.log(`${enableColors ? chalk.yellow(`● Busy: ${busyCount}`) : `● Busy: ${busyCount}`}`);
        console.log(`${enableColors ? chalk.red(`✖ Errors: ${errorCount}`) : `✖ Errors: ${errorCount}`}\n`);
        
        for (const agent of report.agents) {
          const statusIcon = agent.healthy 
            ? (agent.status === AgentStatus.BUSY ? (enableColors ? chalk.yellow('●') : '●') : (enableColors ? chalk.green('✔') : '✔'))
            : (enableColors ? chalk.red('✖') : '✖');
          
          console.log(`${statusIcon} ${enableColors ? chalk.bold(agent.name) : agent.name} (${agent.type})`);
          console.log(`   Status: ${enableColors ? chalk.yellow(agent.status) : agent.status}`);
          console.log(`   Tasks: ${agent.totalTasksExecuted} executed | ${agent.failedTasks} failed`);
          
          if (agent.timeSinceLastTask) {
            const seconds = Math.floor(agent.timeSinceLastTask / 1000);
            console.log(`   Last Task: ${seconds}s ago`);
          }
          
          if (agent.error) {
            console.log(`${enableColors ? chalk.red(`   ⚠ Error: ${agent.error}`) : `   ⚠ Error: ${agent.error}`}`);
          }
          
          console.log('');
        }
      }
      break;
      
    case 'resources':
      if (opts.json) {
        console.log(JSON.stringify(report.resources, null, 2));
      } else {
        console.log(enableColors ? chalk.bold.cyan('\n💻 Resource Usage') : '\n💻 Resource Usage');
        console.log(enableColors ? chalk.gray('─'.repeat(60)) : '─'.repeat(60));
        
        const res = report.resources;
        const cpuColor = res.cpuUsage > 80 ? chalk.red : res.cpuUsage > 50 ? chalk.yellow : chalk.green;
        const memColor = res.memoryUsagePercent > 80 ? chalk.red : res.memoryUsagePercent > 50 ? chalk.yellow : chalk.green;
        const heapPercent = (res.heapUsed / res.heapLimit) * 100;
        const heapColor = heapPercent > 90 ? chalk.red : heapPercent > 70 ? chalk.yellow : chalk.green;
        
        console.log(`\n${enableColors ? chalk.dim('CPU Usage:') : 'CPU Usage:'}          ${enableColors ? cpuColor(`${res.cpuUsage.toFixed(1)}%`) : `${res.cpuUsage.toFixed(1)}%`}`);
        console.log(`${enableColors ? chalk.dim('Memory Usage:') : 'Memory Usage:'}        ${enableColors ? memColor(`${(res.memoryUsage / 1024 / 1024).toFixed(1)} MB (${res.memoryUsagePercent.toFixed(1)}%)`) : `${(res.memoryUsage / 1024 / 1024).toFixed(1)} MB (${res.memoryUsagePercent.toFixed(1)}%)`}`);
        console.log(`${enableColors ? chalk.dim('Heap Usage:') : 'Heap Usage:'}          ${enableColors ? heapColor(`${(res.heapUsed / 1024 / 1024).toFixed(1)} MB / ${(res.heapLimit / 1024 / 1024).toFixed(1)} MB (${heapPercent.toFixed(1)}%)`) : `${(res.heapUsed / 1024 / 1024).toFixed(1)} MB / ${(res.heapLimit / 1024 / 1024).toFixed(1)} MB (${heapPercent.toFixed(1)}%)`}`);
        console.log(`${enableColors ? chalk.dim('Active Processes:') : 'Active Processes:'}    ${res.activeProcesses}`);
        console.log(`${enableColors ? chalk.dim('System Uptime:') : 'System Uptime:'}      ${formatUptime(res.uptime)}`);
        console.log(`${enableColors ? chalk.dim('Process Uptime:') : 'Process Uptime:'}     ${formatUptime(report.uptime)}\n`);
      }
      break;
      
    case 'throughput':
      if (opts.json) {
        console.log(JSON.stringify(report.taskThroughput, null, 2));
      } else {
        console.log(enableColors ? chalk.bold.cyan('\n📈 Task Throughput') : '\n📈 Task Throughput');
        console.log(enableColors ? chalk.gray('─'.repeat(60)) : '─'.repeat(60));
        
        const tp = report.taskThroughput;
        const successColor = tp.successRate >= 90 ? chalk.green : tp.successRate >= 70 ? chalk.yellow : chalk.red;
        const errorColor = tp.errorRate < 10 ? chalk.green : tp.errorRate < 30 ? chalk.yellow : chalk.red;
        
        console.log(`\n${enableColors ? chalk.dim('Total Tasks:') : 'Total Tasks:'}         ${tp.totalTasks}`);
        console.log(`${enableColors ? chalk.dim('Completed:') : 'Completed:'}           ${enableColors ? chalk.green(tp.completedTasks.toString()) : tp.completedTasks}`);
        console.log(`${enableColors ? chalk.dim('Failed:') : 'Failed:'}              ${enableColors ? chalk.red(tp.failedTasks.toString()) : tp.failedTasks}`);
        console.log(`${enableColors ? chalk.dim('Running:') : 'Running:'}             ${tp.runningTasks}`);
        console.log(`${enableColors ? chalk.dim('Pending:') : 'Pending:'}             ${tp.pendingTasks}`);
        console.log(`${enableColors ? chalk.dim('Throughput:') : 'Throughput:'}          ${tp.tasksPerMinute.toFixed(2)} tasks/min`);
        console.log(`${enableColors ? chalk.dim('Avg Execution:') : 'Avg Execution:'}       ${tp.averageExecutionTime.toFixed(0)}ms`);
        console.log(`${enableColors ? chalk.dim('Success Rate:') : 'Success Rate:'}        ${enableColors ? successColor(`${tp.successRate.toFixed(1)}%`) : `${tp.successRate.toFixed(1)}%`}`);
        console.log(`${enableColors ? chalk.dim('Error Rate:') : 'Error Rate:'}          ${enableColors ? errorColor(`${tp.errorRate.toFixed(1)}%`) : `${tp.errorRate.toFixed(1)}%`}\n`);
      }
      break;
      
    case 'summary':
      if (opts.json) {
        console.log(JSON.stringify({
          status: report.status,
          summary: report.summary,
          uptime: report.uptime,
          timestamp: report.timestamp,
          warnings: report.warnings,
          errors: report.errors,
        }, null, 2));
      } else {
        const statusIcon = report.status === 'healthy' ? (enableColors ? chalk.green('🟢') : '🟢') 
          : report.status === 'degraded' ? (enableColors ? chalk.yellow('🟡') : '🟡') 
          : (enableColors ? chalk.red('🔴') : '🔴');
        
        console.log(`\n${statusIcon} ${enableColors ? chalk.bold(`Overall Status: ${report.status.toUpperCase()}`) : `Overall Status: ${report.status.toUpperCase()}`}`);
        console.log(`${enableColors ? chalk.dim('Summary:') : 'Summary:'} ${report.summary}`);
        console.log(`${enableColors ? chalk.dim('Uptime:') : 'Uptime:'} ${formatUptime(report.uptime)}`);
        console.log(`${enableColors ? chalk.dim('Timestamp:') : 'Timestamp:'} ${report.timestamp.toISOString()}\n`);
        
        if (report.warnings.length > 0) {
          console.log(enableColors ? chalk.yellow(`⚠ ${report.warnings.length} Warning(s):`) : `⚠ ${report.warnings.length} Warning(s):`);
          for (const warning of report.warnings) {
            console.log(`  ${enableColors ? chalk.yellow('-') : '-'} ${warning}`);
          }
          console.log('');
        }
        
        if (report.errors.length > 0) {
          console.log(enableColors ? chalk.red(`✖ ${report.errors.length} Error(s):`) : `✖ ${report.errors.length} Error(s):`);
          for (const error of report.errors) {
            console.log(`  ${enableColors ? chalk.red('-') : '-'} ${error}`);
          }
          console.log('');
        }
      }
      break;
  }
}

/**
 * Format uptime milliseconds to human-readable string
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
