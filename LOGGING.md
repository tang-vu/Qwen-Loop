# Logging System Documentation

## Overview

Qwen Loop uses a production-ready, structured logging system built on **Winston** with enhanced features for analysis, debugging, and operational monitoring.

## Features

### ✅ Structured JSON Logging
All logs are written in structured JSON format to `logs/qwen-loop.log` with consistent schema for easy parsing and analysis.

### ✅ Dual Output
- **Console**: Human-readable, colorized output for development
- **File**: Structured JSON with rotation (5MB max, 5 files retained)

### ✅ Automatic Sanitization
Sensitive data (API keys, tokens, passwords, secrets) are automatically redacted with `[REDACTED]`

### ✅ Smart Sampling
Repetitive debug messages are automatically deduplicated to reduce noise:
- Default: 5-second interval
- Custom rules for common messages (e.g., "No tasks in queue" = 10s)

### ✅ Operation Tagging
Every log includes an `operation` field for categorization:
- `loop.lifecycle` - Loop start/stop/pause/resume
- `loop.init` - Initialization operations
- `task.lifecycle` - Task enqueue/execute/complete
- `task.retry` - Task retry attempts
- `task.failure` - Failed tasks
- `queue.enqueue` / `queue.dequeue` - Queue operations
- `agent.init` - Agent initialization
- `task.execution` - Task execution details
- `orchestrator.assignment` - Task assignment
- `config.load` / `config.save` - Configuration operations
- `git.commit` - Git auto-commit operations

### ✅ Enhanced Error Context
Error logs include:
- Error message
- Error name (for classification)
- Full stack trace (in file logs)
- Operation context
- Related metadata (task ID, agent, etc.)

## Log Levels

| Level | Usage | Example |
|-------|-------|---------|
| `error` | Failures requiring attention | Task failures, config errors, agent errors |
| `warn` | Non-fatal issues | Retry attempts, git failures, missing agents |
| `info` | Important lifecycle events | Loop start/stop, task completion, agent init |
| `debug` | Operational details (sampled) | Queue operations, CLI checks, file reads |

## Log Schema (File Output)

```json
{
  "timestamp": "2026-04-07 15:30:45",
  "level": "info",
  "message": "✅ Task completed",
  "operation": "task.lifecycle",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "task": "task-123",
  "agent": "qwen-agent-1",
  "duration": 3450,
  "description": "Refactor authentication module",
  "error": "Error message (if applicable)",
  "errorName": "Error (if applicable)",
  "stack": "Stack trace (if applicable)"
}
```

## Console Output Format

```
2026-04-07 15:30:45 INFO  [qwen-agent-1] [Task:task-123] [3.5s] ✅ Task completed "Refactor authentication module" {priority=MEDIUM}
```

### Console Tags
- `[agent-name]` - Agent identifier (cyan)
- `[Task:task-id]` - Task identifier (yellow, truncated to 8 chars)
- `[project-name]` - Project name in multi-project mode (magenta)
- `[duration]` - Operation duration (green)
- `{key=value}` - Essential metadata (gray)

## API Usage

### Basic Logging

```typescript
import { logger } from '../logger.js';

logger.info('Task started', { 
  operation: 'task.lifecycle',
  task: task.id,
  agent: agent.name 
});

logger.warn('Retrying task', { 
  operation: 'task.retry',
  task: taskId,
  retryCount: 2 
});

logger.error('Task failed', { 
  operation: 'task.failure',
  task: taskId,
  error: errorObject 
});

logger.debug('Queue empty', { 
  operation: 'queue.status' 
}, 10000); // Custom sampling interval
```

### Helper Functions

```typescript
import { 
  createCorrelationId, 
  buildLogContext, 
  buildErrorContext,
  createDurationTracker 
} from '../logger.js';

// Generate correlation ID for tracing related operations
const correlationId = createCorrelationId();

// Build standardized context
const context = buildLogContext({
  correlationId,
  agent: 'my-agent',
  task: 'task-123',
  operation: 'task.execution'
}, { priority: 'HIGH' });

// Build error context
const errorContext = buildErrorContext(error, {
  operation: 'task.failure',
  task: taskId
});

// Track duration
const tracker = createDurationTracker();
// ... perform operation ...
logger.info('Operation complete', { 
  duration: tracker.elapsed() 
});
```

## Configuration

### Log Level

Set in `qwen-loop.config.json`:

```json
{
  "logLevel": "info"
}
```

Valid values: `"error"`, `"warn"`, `"info"`, `"debug"`

### Runtime Changes

```typescript
import { setLogLevel } from '../logger.js';

setLogLevel('debug'); // Enable verbose logging
```

### Log Rotation

Default configuration:
- **Directory**: `logs/`
- **Filename**: `qwen-loop.log`
- **Max size**: 5MB per file
- **Max files**: 5 (oldest rotated out)
- **Format**: JSON with tailable rotation

## Log Sampling

Repetitive debug messages are automatically sampled. Default rules:

| Message Pattern | Interval |
|----------------|----------|
| "No tasks in queue" | 15s |
| "Max concurrent tasks reached" | 10s |
| "Agent output received" | 15s |
| "Agent stderr received" | 15s |
| "Task status updated" | 10s |
| "Agent registered" | 10s |
| "Configuration loaded" | 10s |
| "No configuration file found" | 30s |
| All other debug messages | 5s (default) |

Custom sampling can be configured by modifying `DEFAULT_LOG_SAMPLING` in `logger.ts`.

## One-Time Logging

For messages that should only appear once, use these helper methods:

```typescript
// Log warning only once
logger.warnOnce('Deprecation notice', { operation: 'config.deprecated' });

// Log info only once
logger.infoOnce('Feature enabled', { operation: 'feature.flag' });

// Log debug only once (no sampling)
logger.debugOnce('Important debug', { operation: 'debug.info' });
```

## Log Analysis

### Viewing Logs

```bash
# View recent logs
tail -f logs/qwen-loop.log

# Search for errors
grep '"level":"error"' logs/qwen-loop.log

# Find task completions
grep '"operation":"task.lifecycle"' logs/qwen-loop.log

# Extract specific task
grep '"task":"task-123"' logs/qwen-loop.log
```

### Using jq for Analysis

```bash
# Count errors by type
jq -r 'select(.level == "error") | .errorName' logs/qwen-loop.log | sort | uniq -c

# Average task duration
jq -r 'select(.operation == "task.lifecycle") | .duration' logs/qwen-loop.log | awk '{sum+=$1; count++} END {print sum/count}'

# Find failed tasks
jq -r 'select(.level == "error" and .operation == "task.failure") | .task' logs/qwen-loop.log
```

## Best Practices

### 1. Use Operation Tags
Always include `operation` field for categorization:

```typescript
logger.info('Task completed', {
  operation: 'task.lifecycle',  // ✅ Good
  task: taskId
});
```

### 2. Include Context
Add relevant identifiers for tracing:

```typescript
logger.debug('Processing', {
  operation: 'task.execution',
  task: taskId,
  agent: agentName,
  priority: taskPriority
});
```

### 3. Pass Error Objects Directly
Always pass Error objects directly to enable full stack trace capture:

```typescript
// ✅ Good - preserves stack trace
logger.error('Task failed', {
  operation: 'task.failure',
  task: taskId,
  error: error instanceof Error ? error : new Error(String(error))
});

// ❌ Bad - loses stack trace
logger.error('Task failed', {
  error: error.message  // Loses stack trace
});
```

### 4. Truncate Long Data
Descriptions and errors are auto-truncated, but pre-truncate for performance:

```typescript
logger.info('Task started', {
  description: task.description.slice(0, 80)  // ✅ Good
});
```

### 5. Use Appropriate Log Levels
- **error**: Critical failures requiring attention (task failures, config errors)
- **warn**: Non-fatal issues (retries, git failures, missing agents)
- **info**: Important lifecycle events (start/stop, completions, initializations)
- **debug**: Operational details with sampling (queue ops, CLI checks, file reads)

### 6. Leverage Correlation IDs
For complex operations, generate correlation IDs to trace related events:

```typescript
const correlationId = createCorrelationId();
logger.info('Starting complex operation', { correlationId });
// ... later ...
logger.info('Step 1 complete', { correlationId });
// ... later ...
logger.info('Operation complete', { correlationId });
```

### 7. Use One-Time Logging for Rare Events
For events that should only be logged once:

```typescript
logger.infoOnce('Feature enabled', { operation: 'feature.init' });
logger.warnOnce('Deprecated API used', { operation: 'api.deprecated' });
```

## Troubleshooting

### Logs Not Appearing

1. Check log level in config
2. Verify `logs/` directory exists and is writable
3. Check console output for errors

### Too Verbose

- Set log level to `info` or `warn`
- Debug messages are auto-sampled; adjust intervals if needed

### Missing Details

- Check file logs for full error stacks
- Console output omits verbose metadata by design
- Use `debug` level for maximum detail

## Future Enhancements

Potential improvements:
- [ ] Log shipping to external services (e.g., ELK, Datadog)
- [ ] Custom log formatters
- [ ] Per-module log levels
- [ ] Log compression for rotated files
- [ ] Real-time log streaming API
