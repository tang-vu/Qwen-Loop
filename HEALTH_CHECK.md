# Health Check System - Implementation Summary

## Overview

The Qwen Loop health check system provides comprehensive monitoring and reporting capabilities for system status, including agent health, task throughput, error rates, and resource usage.

## Architecture

The health check system consists of three main components:

### 1. HealthChecker (`src/core/health-checker.ts`)
Core metrics collection engine that gathers:
- **Agent Health**: Status, task counts, failure rates per agent
- **Task Throughput**: Completion rates, success/error rates, tasks per minute
- **Resource Usage**: CPU, memory, heap utilization, active processes
- **Priority Breakdown**: Task distribution by priority and status

**Key Methods:**
- `updateAgents(agents: IAgent[])` - Update agent list
- `updateLoopStats(stats)` - Update loop statistics
- `updateTaskQueue(tasks)` - Update task queue state
- `trackTaskCompletion(agentId, success, executionTime)` - Track individual task
- `generateHealthReport()` - Generate comprehensive health report
- `formatReportForConsole(report)` - Format for human-readable output
- `getJsonReport()` - Get JSON-serializable report

### 2. HealthServer (`src/core/health-server.ts`)
HTTP server exposing health metrics via REST endpoints:

**Endpoints:**
- `GET /health` - Full health report (HTML or JSON based on Accept header)
- `GET /health/json` - JSON health report
- `GET /health/live` - Liveness check (`{"status": "alive"}`)
- `GET /health/ready` - Readiness check (200/503)
- `GET /health/metrics` - Detailed metrics (throughput, resources, config)
- `GET /health/agents` - Agent status and health
- `GET /health/throughput` - Task throughput metrics
- `GET /health/resources` - Resource usage metrics

**Features:**
- CORS headers for cross-origin requests
- Beautiful HTML dashboard with CSS styling
- JSON responses for API consumption
- Error handling and graceful degradation

### 3. Enhanced Health CLI (`src/commands/health-command.ts`)
Command-line interface with subcommands and monitoring:

**Subcommands:**
- `health` - Full health report (all metrics)
- `health agents` - Agent health and status only
- `health resources` - CPU, memory, heap usage only
- `health throughput` - Task completion rates and error rates only
- `health summary` - Quick status summary only

**Flags:**
- `--live` - Fetch live metrics from running instance
- `--watch` - Continuous monitoring mode (refreshes every 5s by default)
- `--watch-interval <seconds>` - Custom refresh interval for watch mode
- `--json` - JSON output format for scripts/automation
- `--host <host>` - Health server hostname (default: localhost)
- `--port <port>` - Health server port (default: 3100)
- `--config <path>` - Custom config file path

**Smart Behavior:**
- Automatically detects if a running instance is available
- Falls back to static report from config if no running instance
- Initializes agents for accurate health metrics even without running loop
- Color-coded output with visual indicators (🟢🟡🔴✔●✖)

## Usage Examples

### Basic Health Check
```bash
# Full report
qwen-loop health

# Specific metrics
qwen-loop health agents
qwen-loop health resources
qwen-loop health throughput
qwen-loop health summary
```

### Live Monitoring
```bash
# Start loop with health server
qwen-loop start --health-port 3100

# Fetch live metrics
qwen-loop health --live
qwen-loop health agents --live
```

### Continuous Monitoring
```bash
# Watch mode (default 5s refresh)
qwen-loop health --watch

# Custom refresh interval
qwen-loop health summary --watch --watch-interval 10
```

### Script Integration
```bash
# JSON output for automation
qwen-loop health --json
qwen-loop health agents --json

# Check in scripts
STATUS=$(qwen-loop health summary --json | jq -r '.status')
if [ "$STATUS" = "healthy" ]; then
  echo "System is healthy"
fi
```

### HTTP API Integration
```bash
# Start with health server
qwen-loop start --health-port 3100

# Use curl to check health
curl http://localhost:3100/health/live
curl http://localhost:3100/health/json
curl http://localhost:3100/health/agents
curl http://localhost:3100/health/resources

# View HTML dashboard
open http://localhost:3100/health
```

## Health Report Structure

```json
{
  "status": "healthy|degraded|unhealthy",
  "timestamp": "2026-04-07T01:37:56.789Z",
  "uptime": 123456,
  "agents": [
    {
      "id": "...",
      "name": "agent-name",
      "type": "qwen|custom",
      "status": "idle|busy|error|offline",
      "healthy": true,
      "totalTasksExecuted": 15,
      "failedTasks": 2,
      "timeSinceLastTask": 45000,
      "error": "optional error message"
    }
  ],
  "taskThroughput": {
    "totalTasks": 23,
    "completedTasks": 20,
    "failedTasks": 3,
    "runningTasks": 0,
    "pendingTasks": 5,
    "tasksPerMinute": 2.5,
    "averageExecutionTime": 15000,
    "successRate": 87.0,
    "errorRate": 13.0
  },
  "priorityBreakdown": {
    "byPriority": { "critical": 0, "high": 2, "medium": 3, "low": 0 },
    "byStatus": { "pending": 5, "running": 0, "completed": 20, "failed": 3, "cancelled": 0 }
  },
  "resources": {
    "cpuUsage": 23.5,
    "memoryUsage": 4200000000,
    "memoryUsagePercent": 52.3,
    "memoryTotal": 8000000000,
    "memoryFree": 3800000000,
    "heapSize": 31700000,
    "heapUsed": 15680000,
    "heapLimit": 31700000,
    "uptime": 5400000,
    "activeProcesses": 1
  },
  "config": {
    "maxConcurrentTasks": 1,
    "loopInterval": 5000,
    "maxRetries": 2,
    "agentCount": 1,
    "workingDirectory": "./my-project"
  },
  "summary": "1/1 agents healthy | 20 tasks completed | 87.0% success rate | 52.3% memory used",
  "warnings": ["optional warning messages"],
  "errors": ["optional error messages"]
}
```

## Health Status Determination

The system determines overall status based on thresholds:

**Unhealthy (🔴):**
- Any errors present
- All agents unhealthy
- Memory usage > 95%
- Error rate > 50%

**Degraded (🟡):**
- Warnings present
- Some agents unhealthy
- Memory usage > 80%
- Error rate > 20%
- Heap usage > 90%

**Healthy (🟢):**
- All other cases

## Integration Points

### With LoopManager
The `LoopManager` integrates with `HealthChecker` to:
- Track task completion via `trackTaskCompletion()`
- Update loop statistics via `updateLoopStats()`
- Update task queue state via `updateTaskQueue()`

### With MultiProjectManager
The `MultiProjectManager` aggregates health across all projects:
- Combines agent lists from all projects
- Aggregates task counts and execution times
- Provides unified health report via `getHealthReport()`

### With HTTP Server
When started with `--health-port`:
- Creates `HealthServer` with `HealthChecker` instance
- Updates health checker every 5 seconds during loop execution
- Provides real-time metrics via HTTP endpoints

## Best Practices

1. **Enable Health Server in Production**
   ```bash
   qwen-loop start --health-port 3100
   ```

2. **Monitor with Watch Mode During Development**
   ```bash
   qwen-loop health --watch
   ```

3. **Integrate with External Monitoring**
   Use HTTP endpoints with Prometheus, Grafana, or custom monitoring tools

4. **Automate Health Checks**
   ```bash
   # Cron job or scheduled task
   */5 * * * * qwen-loop health summary --json >> /var/log/qwen-loop-health.json
   ```

5. **Set Up Alerts**
   Monitor for "degraded" or "unhealthy" status in automated scripts

## Performance Considerations

- **CPU Usage Measurement**: Platform-specific (wmic on Windows, top on Unix) with fallback estimation
- **Memory Overhead**: Minimal, uses Node.js built-in `process.memoryUsage()`
- **Health Server**: Lightweight, uses only Node.js `http` module (no external dependencies)
- **Watch Mode**: Configurable refresh interval to balance responsiveness and resource usage

## Troubleshooting

### Cannot Connect to Health Server
```bash
# Check if loop is running with health port
qwen-loop health --live --port 3100

# If not running, check health without live flag
qwen-loop health
```

### Agent Shows as Unhealthy
- Check agent configuration (name, type, working directory)
- Verify the agent's CLI tool is installed and accessible
- Check logs for initialization errors

### High Memory Usage
- Reduce `maxConcurrentTasks` in config
- Monitor heap usage in health report
- Restart the loop periodically if needed

### High Error Rate
- Check agent error messages in `health agents` output
- Review task descriptions for validity
- Verify working directory and permissions

## Future Enhancements

Potential improvements for the health check system:
- Prometheus metrics export format
- WebSocket real-time updates
- Historical metrics storage and trending
- Alert notifications (email, Slack, etc.)
- Health check authentication
- Custom health check plugins
- Performance profiling and bottleneck detection
