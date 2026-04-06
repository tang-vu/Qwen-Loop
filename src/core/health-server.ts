import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { HealthChecker } from './health-checker.js';
import { HealthReport, AgentHealthStatus } from '../types.js';
import { logger } from '../logger.js';

/**
 * Lightweight HTTP server that exposes health check endpoints.
 * Uses only Node.js built-in modules (no external dependencies).
 */
export class HealthServer {
  private server: Server | null = null;
  private healthChecker: HealthChecker;
  private port: number;
  private host: string;

  /**
   * Create a new HealthServer instance
   * @param healthChecker - The health checker to query for health data
   * @param port - Port number to listen on (default: 3100)
   * @param host - Hostname to bind to (default: 'localhost')
   */
  constructor(healthChecker: HealthChecker, port = 3100, host = '0.0.0.0') {
    this.healthChecker = healthChecker;
    this.port = port;
    this.host = host;
  }

  /**
   * Start the health check HTTP server
   *
   * Binds to the configured host and port and begins listening for
   * incoming HTTP requests. Resolves when the server is ready.
   *
   * @throws Error if the port is already in use or cannot be bound
   */
  async start(): Promise<void> {
    if (this.server) {
      logger.warn('Health server is already running');
      return;
    }

    this.server = createServer((req, res) => {
      this.handleRequest(req, res);
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(this.port, this.host, () => {
        logger.info(`Health server started on ${this.getUrl()}`);
        resolve();
      }).on('error', (error) => {
        logger.error(`Failed to start health server: ${error.message}`);
        reject(error);
      });
    });
  }

  /**
   * Stop the health check HTTP server
   *
   * Gracefully closes all connections and stops listening for new requests.
   *
   * @throws Error if an error occurs while closing the server
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.server!.close((error) => {
        if (error) {
          logger.error(`Error stopping health server: ${error.message}`);
          reject(error);
        } else {
          logger.info('Health check server stopped');
          this.server = null;
          resolve();
        }
      });
    });
  }

  /**
   * Get the server URL
   *
   * @returns The full URL where the health server is accessible
   */
  getUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  /**
   * Handle incoming HTTP requests and route to appropriate handlers
   *
   * @param req - The incoming HTTP request
   * @param res - The HTTP response object
   */
  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    try {
      const requestUrl = req.url ?? '/';
      let url: URL;

      try {
        url = new URL(requestUrl, `http://${this.host}:${this.port}`);
      } catch (urlError) {
        // Malformed URL - return 400 Bad Request instead of 500
        const errorMessage = urlError instanceof Error ? urlError.message : String(urlError);
        logger.debug(`Malformed URL in health server request: ${requestUrl}`, {
          operation: 'health.request',
          error: errorMessage
        });
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad Request: Invalid URL');
        return;
      }

      const path = url.pathname;

      // Set CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
        return;
      }

      switch (path) {
        case '/health':
        case '/health/':
          this.handleFullHealthReport(req, res);
          break;
        case '/health/json':
          this.handleJsonReport(res);
          break;
        case '/health/live':
        case '/health/live/':
          this.handleLiveness(res);
          break;
        case '/health/ready':
        case '/health/ready/':
          this.handleReadiness(res);
          break;
        case '/health/metrics':
        case '/health/metrics/':
          this.handleMetrics(res);
          break;
        case '/health/agents':
        case '/health/agents/':
          this.handleAgentStatus(res);
          break;
        case '/health/throughput':
        case '/health/throughput/':
          this.handleThroughput(res);
          break;
        case '/health/resources':
        case '/health/resources/':
          this.handleResources(res);
          break;
        default:
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
      }
    } catch (error) {
      logger.error(`Error handling health check request: ${error instanceof Error ? error.message : String(error)}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'error',
        message: error instanceof Error ? error.message : 'Internal server error'
      }));
    }
  }

  /**
   * Handle full health check request, returning HTML or JSON based on Accept header
   *
   * @param req - The incoming HTTP request
   * @param res - The HTTP response object
   */
  private handleFullHealthReport(req: IncomingMessage, res: ServerResponse): void {
    // Check Accept header to determine response format
    const acceptHeader = req.headers['accept'] || '';
    const wantsJson = acceptHeader.includes('application/json');

    if (wantsJson) {
      this.handleJsonReport(res);
    } else {
      this.handleHtmlReport(res);
    }
  }

  /**
   * Handle JSON health report request
   */
  private handleJsonReport(res: ServerResponse): void {
    const report = this.healthChecker.getJsonReport();

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache'
    });
    res.end(JSON.stringify(report, null, 2));
  }

  /**
   * Handle HTML health report request
   */
  private handleHtmlReport(res: ServerResponse): void {
    const report = this.healthChecker.getJsonReport();
    const html = this.generateHtmlReport(report);

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache'
    });
    res.end(html);
  }

  /**
   * Handle liveness check request
   */
  private handleLiveness(res: ServerResponse): void {
    // Simple liveness check - is the process running?
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    }));
  }

  /**
   * Handle readiness check request
   */
  private handleReadiness(res: ServerResponse): void {
    // Readiness check - is the system ready to accept tasks?
    const report = this.healthChecker.getJsonReport();
    const hasHealthyAgent = report.agents.length > 0 && report.agents.some(a => a.healthy);
    const isReady = report.status !== 'unhealthy' && hasHealthyAgent;

    if (isReady) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ready',
        health: report.status,
        healthyAgents: report.agents.filter(a => a.healthy).length,
        totalAgents: report.agents.length
      }));
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'not_ready',
        health: report.status,
        healthyAgents: report.agents.filter(a => a.healthy).length,
        totalAgents: report.agents.length,
        errors: report.errors,
        message: report.agents.length === 0 ? 'No agents configured or initialized yet' : undefined
      }));
    }
  }

  /**
   * Handle detailed metrics request
   */
  private handleMetrics(res: ServerResponse): void {
    const report = this.healthChecker.getJsonReport();
    
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache'
    });
    res.end(JSON.stringify({
      timestamp: report.timestamp,
      uptime: report.uptime,
      taskThroughput: report.taskThroughput,
      priorityBreakdown: report.priorityBreakdown,
      resources: report.resources,
      config: report.config
    }, null, 2));
  }

  /**
   * Handle agent status request
   */
  private handleAgentStatus(res: ServerResponse): void {
    const report = this.healthChecker.getJsonReport();
    
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache'
    });
    res.end(JSON.stringify({
      timestamp: report.timestamp,
      totalAgents: report.agents.length,
      healthyAgents: report.agents.filter(a => a.healthy).length,
      agents: report.agents
    }, null, 2));
  }

  /**
   * Handle throughput metrics request
   */
  private handleThroughput(res: ServerResponse): void {
    const report = this.healthChecker.getJsonReport();
    
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache'
    });
    res.end(JSON.stringify({
      timestamp: report.timestamp,
      uptime: report.uptime,
      throughput: report.taskThroughput,
      priorityBreakdown: report.priorityBreakdown
    }, null, 2));
  }

  /**
   * Handle resource usage request
   */
  private handleResources(res: ServerResponse): void {
    const report = this.healthChecker.getJsonReport();
    
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache'
    });
    res.end(JSON.stringify({
      timestamp: report.timestamp,
      resources: report.resources,
      summary: report.summary
    }, null, 2));
  }

  /**
   * Generate an HTML report from the health report data
   */
  private generateHtmlReport(report: HealthReport): string {
    const statusColor = report.status === 'healthy' ? '#22c55e' : report.status === 'degraded' ? '#f59e0b' : '#ef4444';
    const statusIcon = report.status === 'healthy' ? '🟢' : report.status === 'degraded' ? '🟡' : '🔴';

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Qwen Loop - Health Check</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { text-align: center; margin-bottom: 30px; font-size: 2em; }
    .status-badge { display: inline-block; padding: 8px 16px; border-radius: 20px; background: ${statusColor}; color: white; font-weight: bold; margin-bottom: 20px; }
    .card { background: #1e293b; border-radius: 8px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155; }
    .card h2 { margin-bottom: 15px; color: #94a3b8; font-size: 1.2em; border-bottom: 2px solid #334155; padding-bottom: 10px; }
    .metric { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #334155; }
    .metric:last-child { border-bottom: none; }
    .metric-label { color: #94a3b8; }
    .metric-value { font-weight: bold; color: #e2e8f0; }
    .agent { background: #0f172a; padding: 12px; border-radius: 6px; margin-bottom: 10px; }
    .agent-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .agent-name { font-weight: bold; }
    .agent-status { padding: 4px 8px; border-radius: 4px; font-size: 0.85em; }
    .healthy { background: #22c55e20; color: #22c55e; }
    .busy { background: #ef444420; color: #ef4444; }
    .error { background: #ef444430; color: #ef4444; }
    .warning { background: #f59e0b20; color: #f59e0b; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; }
    .summary { text-align: center; padding: 20px; background: #1e293b; border-radius: 8px; margin-bottom: 20px; }
    .timestamp { text-align: center; color: #64748b; font-size: 0.9em; margin-top: 20px; }
    code { background: #0f172a; padding: 2px 6px; border-radius: 4px; font-family: 'Courier New', monospace; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🤖 Qwen Loop - Health Check</h1>
    
    <div class="summary">
      <div class="status-badge">${statusIcon} ${report.status.toUpperCase()}</div>
      <p style="margin-top: 10px;">${report.summary}</p>
    </div>

    <div class="grid">
      <div class="card">
        <h2>📊 Task Throughput</h2>
        <div class="metric"><span class="metric-label">Total Tasks</span><span class="metric-value">${report.taskThroughput.totalTasks}</span></div>
        <div class="metric"><span class="metric-label">Completed</span><span class="metric-value" style="color: #22c55e;">${report.taskThroughput.completedTasks}</span></div>
        <div class="metric"><span class="metric-label">Failed</span><span class="metric-value" style="color: #ef4444;">${report.taskThroughput.failedTasks}</span></div>
        <div class="metric"><span class="metric-label">Running</span><span class="metric-value">${report.taskThroughput.runningTasks}</span></div>
        <div class="metric"><span class="metric-label">Pending</span><span class="metric-value">${report.taskThroughput.pendingTasks}</span></div>
        <div class="metric"><span class="metric-label">Throughput</span><span class="metric-value">${report.taskThroughput.tasksPerMinute.toFixed(2)} tasks/min</span></div>
        <div class="metric"><span class="metric-label">Success Rate</span><span class="metric-value">${report.taskThroughput.successRate.toFixed(1)}%</span></div>
        <div class="metric"><span class="metric-label">Avg Time</span><span class="metric-value">${report.taskThroughput.averageExecutionTime.toFixed(0)}ms</span></div>
      </div>

      <div class="card">
        <h2>💻 Resource Usage</h2>
        <div class="metric"><span class="metric-label">CPU</span><span class="metric-value">${report.resources.cpuUsage.toFixed(1)}%</span></div>
        <div class="metric"><span class="metric-label">Memory</span><span class="metric-value">${(report.resources.memoryUsage / 1024 / 1024).toFixed(1)} MB (${report.resources.memoryUsagePercent.toFixed(1)}%)</span></div>
        <div class="metric"><span class="metric-label">Heap Used</span><span class="metric-value">${(report.resources.heapUsed / 1024 / 1024).toFixed(1)} MB / ${(report.resources.heapLimit / 1024 / 1024).toFixed(1)} MB</span></div>
        <div class="metric"><span class="metric-label">Uptime</span><span class="metric-value">${this.formatUptime(report.uptime)}</span></div>
        <div class="metric"><span class="metric-label">Active Processes</span><span class="metric-value">${report.resources.activeProcesses}</span></div>
      </div>

      <div class="card">
        <h2>⚙️ Configuration</h2>
        <div class="metric"><span class="metric-label">Max Concurrent</span><span class="metric-value">${report.config.maxConcurrentTasks}</span></div>
        <div class="metric"><span class="metric-label">Loop Interval</span><span class="metric-value">${report.config.loopInterval}ms</span></div>
        <div class="metric"><span class="metric-label">Max Retries</span><span class="metric-value">${report.config.maxRetries}</span></div>
        <div class="metric"><span class="metric-label">Agents</span><span class="metric-value">${report.config.agentCount}</span></div>
        <div class="metric"><span class="metric-label">Working Dir</span><span class="metric-value"><code>${report.config.workingDirectory}</code></span></div>
      </div>
    </div>

    <div class="card">
      <h2>🤖 Agents (${report.agents.length})</h2>
      ${report.agents.map((agent: AgentHealthStatus) => {
        const statusClass = agent.healthy ? (agent.status === 'busy' ? 'busy' : 'healthy') : 'error';
        return `
      <div class="agent">
        <div class="agent-header">
          <span class="agent-name">${agent.name} (${agent.type})</span>
          <span class="agent-status ${statusClass}">${agent.status.toUpperCase()}</span>
        </div>
        <div class="metric"><span class="metric-label">Tasks Executed</span><span class="metric-value">${agent.totalTasksExecuted}</span></div>
        <div class="metric"><span class="metric-label">Failed</span><span class="metric-value">${agent.failedTasks}</span></div>
        ${agent.timeSinceLastTask ? `<div class="metric"><span class="metric-label">Last Task</span><span class="metric-value">${this.formatUptime(agent.timeSinceLastTask)} ago</span></div>` : ''}
        ${agent.error ? `<div style="margin-top: 8px; color: #ef4444;">⚠️ ${agent.error}</div>` : ''}
      </div>`;
      }).join('')}
    </div>

    ${report.warnings.length > 0 ? `
    <div class="card">
      <h2>⚠️ Warnings</h2>
      <ul style="list-style: none; padding: 0;">
        ${report.warnings.map((w: string) => `<li style="padding: 8px; background: #f59e0b10; margin-bottom: 5px; border-left: 3px solid #f59e0b;">⚠️ ${w}</li>`).join('')}
      </ul>
    </div>` : ''}

    ${report.errors.length > 0 ? `
    <div class="card">
      <h2>❌ Errors</h2>
      <ul style="list-style: none; padding: 0;">
        ${report.errors.map((e: string) => `<li style="padding: 8px; background: #ef444410; margin-bottom: 5px; border-left: 3px solid #ef4444;">❌ ${e}</li>`).join('')}
      </ul>
    </div>` : ''}

    <div class="timestamp">
      Last updated: ${report.timestamp.toISOString()} | 
      <a href="/health/json" style="color: #60a5fa;">View JSON</a>
    </div>
  </div>
</body>
</html>`.trim();
  }

  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}
