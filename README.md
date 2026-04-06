# Qwen Loop

Autonomous multi-agent AI coding loop — **Qwen Code** agents that self-direct, self-improve, and continuously develop your projects 24/7.

## 🚀 Features

- **No API Keys** — Uses Qwen Code CLI directly with Qwen OAuth (free)
- **Self-Directed Tasks** — Automatically analyzes your project and generates relevant tasks
- **Auto Git Commit & Push** — Every completed task is committed and pushed automatically
- **Continuous Loop** — Runs indefinitely or up to a configured iteration limit
- **Multi-Project Support** — Cycle through multiple projects from a single config
- **Priority Task Queue** — CRITICAL → HIGH → MEDIUM → LOW scheduling
- **Auto-Approve (YOLO Mode)** — Fully autonomous, never asks for permission
- **Extensible** — Add any CLI-based AI tool as a custom agent

## 📦 Installation

```bash
git clone <your-repo-url>
cd Qwen-Loop
npm install
```

## 🛠 Quick Start

### 1. Install Qwen Code CLI

```bash
# Option 1: npm
npm install -g @qwen-code/qwen-code

# Option 2: Script (Linux/macOS)
curl -fsSL https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen.sh | bash

# Option 3: Script (Windows, in admin CMD)
curl -fsSL -o %TEMP%\install-qwen.bat https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen.bat && %TEMP%\install-qwen.bat

# Verify
qwen --help
```

> **Note:** Restart your terminal after installation.

### 2. Authenticate (One-Time)

```bash
qwen
```

First run opens a browser for Qwen OAuth login (free). Close after success.

### 3. Initialize Configuration

**Single project:**
```bash
npm start -- init
```

**Multi-project:**
```bash
npm start -- init-multi
```

### 4. Configure & Run

Edit `qwen-loop.config.json`, then:

```bash
npm start -- start
```

Press `Ctrl+C` to stop.

## 📖 Usage

### CLI Commands

| Command | Description |
|---------|-------------|
| `npm start -- init` | Generate single-project config |
| `npm start -- init-multi` | Generate multi-project config |
| `npm start -- start` | Start the loop (auto-detects single/multi) |
| `npm start -- start --health-port 3100` | Start with HTTP health check server |
| `npm start -- validate` | Validate configuration |
| `npm start -- config` | Show current configuration |
| `npm start -- health` | Show full system health status |
| `npm start -- health agents` | Show agent health and status |
| `npm start -- health resources` | Show CPU, memory, heap usage |
| `npm start -- health throughput` | Show task completion rates |
| `npm start -- health summary` | Show quick status summary |
| `npm start -- health --watch` | Continuous health monitoring |
| `npm start -- health --json` | Show health status in JSON format |

### Single-Project Config

```json
{
  "agents": [{ "name": "qwen-dev", "type": "qwen", "timeout": 120000 }],
  "maxConcurrentTasks": 1,
  "loopInterval": 5000,
  "maxRetries": 2,
  "workingDirectory": "./my-project",
  "maxLoopIterations": 0,
  "enableSelfTaskGeneration": true
}
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxLoopIterations` | `0` (unlimited) | Max tasks before loop stops. `0` = run forever |
| `enableSelfTaskGeneration` | `true` | Auto-generate tasks by analyzing the project |

### Multi-Project Config

```json
{
  "agents": [{ "name": "qwen", "type": "qwen", "timeout": 120000 }],
  "maxConcurrentTasks": 1,
  "loopInterval": 5000,
  "maxRetries": 2,
  "maxLoopIterations": 3,
  "enableSelfTaskGeneration": true,
  "projects": [
    { "name": "frontend", "workingDirectory": "./my-app" },
    { "name": "backend", "workingDirectory": "./my-api" },
    { "name": "docs", "workingDirectory": "./docs", "maxLoopIterations": 5 }
  ]
}
```

Each project gets its own LoopManager instance. After one project finishes its iterations, the loop moves to the next.

## 🔄 How the Loop Works

```
1. Analyze project → generate self-directed tasks
2. Pick highest priority task → execute via Qwen Code
3. Qwen writes code → auto git commit & push
4. Count iteration → pick next task → repeat
5. Max iterations reached → stop (or 0 = infinite)
```

**Flow diagram:**
```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Analyze     │────▶│ Generate     │────▶│ Execute via  │
│  Project     │     │ Tasks        │     │ Qwen Code    │
└─────────────┘     └──────────────┘     └──────────────┘
       ▲                                       │
       │                                       ▼
       │                              ┌──────────────┐
       │                              │ Auto Git     │
       │                              │ Commit+Push  │
       │                              └──────────────┘
       │                                       │
       │                                       ▼
       │                              ┌──────────────┐
       │                              │ Next Task    │
       └──────────────────────────────│ or Stop      │
                                      └──────────────┘
```

## 🤖 Agent Configuration

### Qwen Agent (Default)

```json
{
  "name": "qwen-dev",
  "type": "qwen",
  "timeout": 120000,
  "workingDirectory": "./project"
}
```

### Custom Agent

Add any CLI tool:

```json
{
  "name": "aider",
  "type": "custom",
  "workingDirectory": "./project",
  "additionalArgs": ["--auto-commits", "--yes-always"]
}
```

## 📁 Auto-Created Settings

Qwen Loop creates `.qwen/settings.json` in your working directory with:

```json
{
  "permissions": {
    "defaultMode": "yolo",
    "confirmShellCommands": false,
    "confirmFileEdits": false
  }
}
```

This ensures Qwen Code **never asks for permission** — fully autonomous.

## 📊 Monitoring

### Console Status

Status prints every 30 seconds during loop execution:

```
=== Agent Status Report ===
Total Agents: 1
Available: 1
Busy: 0
Error: 0

🟢 qwen-dev (qwen) - idle

=== Task Queue Stats ===
Total Tasks: 5
Pending in Queue: 3

By Status:
  PENDING: 3
  RUNNING: 0
  COMPLETED: 2
  FAILED: 0
```

### Health Check CLI

Get comprehensive system health status with enhanced subcommands and real-time monitoring:

```bash
# Full health report (all metrics)
npm start -- health

# Specific metrics only
npm start -- health agents        # Agent health and status
npm start -- health resources     # CPU, memory, heap usage
npm start -- health throughput    # Task completion rates and error rates
npm start -- health summary       # Quick status summary

# Live metrics from running instance
npm start -- health --live

# Continuous monitoring (watch mode, refreshes every 5s)
npm start -- health --watch
npm start -- health --watch --watch-interval 10   # Custom refresh interval

# JSON format (for automation/monitoring tools)
npm start -- health --json
npm start -- health agents --json

# Custom host/port
npm start -- health --live --host localhost --port 8080
```

**Health report includes:**
- 🤖 **Agent Health**: Status, task counts, failure rates per agent
- 📊 **Task Throughput**: Completion rates, success/error rates, tasks per minute
- 💻 **Resource Usage**: CPU, memory, heap usage, active processes
- ⚙️ **Configuration**: Current settings summary
- ⚠️ **Warnings/Errors**: Detected issues and anomalies

**Health CLI Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `[subcommand]` | Specific metric: `agents`, `resources`, `throughput`, `summary` | Full report |
| `--live` | Fetch live metrics from running instance | - |
| `--watch` | Continuously monitor health status | - |
| `--watch-interval <seconds>` | Watch mode refresh interval | `5` |
| `--host <host>` | Health server hostname | `localhost` |
| `--port <port>` | Health server port | `3100` |
| `--json` | Output in JSON format | - |
| `-c, --config <path>` | Path to configuration file | `./qwen-loop.config.json` |

**Example Outputs:**

```bash
# Agent health output
npm start -- health agents

🤖 Agent Health (2 agents)
────────────────────────────────────────────────────────────

✔ Healthy: 1
● Busy: 1
✖ Errors: 0

✔ qwen-dev (qwen)
   Status: idle
   Tasks: 15 executed | 2 failed
   Last Task: 45s ago

● custom-agent (custom)
   Status: busy
   Tasks: 8 executed | 0 failed
   Last Task: 120s ago

# Resource usage output
npm start -- health resources

💻 Resource Usage
────────────────────────────────────────────────────────────

CPU Usage:          23.5%
Memory Usage:        4.2 GB (52.3%)
Heap Usage:          156.8 MB / 512.0 MB (30.6%)
Active Processes:    1
System Uptime:       2h 15m
Process Uptime:      1h 30m

# Watch mode output
npm start -- health summary --watch

🔄 Watch mode enabled (refreshing every 5s). Press Ctrl+C to stop.

🟢 Overall Status: HEALTHY
Summary: 2/2 agents healthy | 23 tasks completed | 87.5% success rate | Memory: 52.3%
Uptime: 1h 30m
Timestamp: 2026-04-07T01:37:56.789Z

[Refreshes every 5 seconds...]
```

### HTTP Health Endpoint (Optional)

Start an HTTP server for monitoring integration:

```bash
npm start -- start --health-port 3100
```

**Endpoints:**

| Endpoint | Description | Response |
|----------|-------------|----------|
| `GET /health` | Full health report (HTML or JSON based on Accept header) | HTML page or JSON |
| `GET /health/json` | JSON health report | JSON object |
| `GET /health/live` | Simple liveness check | `{"status": "alive"}` |
| `GET /health/ready` | Readiness check (200 if ready, 503 if not) | JSON status |
| `GET /health/metrics` | Detailed metrics (throughput, resources, config) | JSON object |
| `GET /health/agents` | Detailed agent status and health | JSON object |
| `GET /health/throughput` | Task throughput and priority breakdown | JSON object |
| `GET /health/resources` | System resource usage metrics | JSON object |

**Example usage:**

```bash
# Check if service is alive
curl http://localhost:3100/health/live

# Get full health report in JSON
curl http://localhost:3100/health/json

# Get detailed agent status
curl http://localhost:3100/health/agents

# Get task throughput metrics
curl http://localhost:3100/health/throughput

# Get resource usage
curl http://localhost:3100/health/resources

# View HTML dashboard in browser
open http://localhost:3100/health
```

**JSON Response Structure:**

```json
{
  "status": "healthy|degraded|unhealthy",
  "timestamp": "2026-04-07T01:37:56.789Z",
  "uptime": 123456,
  "agents": [...],
  "taskThroughput": {...},
  "priorityBreakdown": {...},
  "resources": {...},
  "config": {...},
  "summary": "...",
  "warnings": [...],
  "errors": [...]
}
```

## 🔍 Troubleshooting

| Issue | Fix |
|-------|-----|
| `qwen: command not found` | Install Qwen Code CLI, restart terminal |
| `Authentication required` | Run `qwen` once to complete OAuth login |
| Task fails with spawn error | Check workingDirectory exists, increase timeout |
| Git push fails | Ensure repo is initialized, run `git push` manually first |

## 📋 Requirements

- Node.js 18+
- Qwen Code CLI (installed globally)
- Git (for auto commit/push)
- Qwen OAuth (free, one-time browser login)

## 🏗 Architecture

| Component | Description |
|-----------|-------------|
| `QwenAgent` | Adapter for Qwen Code CLI with `--yolo` auto-approve |
| `CustomAgent` | Extensible adapter for any CLI tool |
| `AgentOrchestrator` | Manages agent registration and task assignment |
| `TaskQueue` | Priority-based queue (CRITICAL → LOW) |
| `LoopManager` | Controls execution loop with retry and iteration limits |
| `SelfTaskGenerator` | Analyzes project code and generates improvement tasks |
| `MultiProjectManager` | Cycles through multiple projects sequentially |
| `GitUtils` | Auto `git add` → `commit` → `push` after each task |
| `ConfigManager` | JSON config with validation |
| `Logger` | Winston logging with file rotation |

## 🌟 Example Use Cases

1. **Automated Code Review** — Agents review and improve code quality
2. **Bug Fixing Pipeline** — Auto-detect and fix common issues
3. **Feature Development** — Implement new features autonomously
4. **Documentation Updates** — Keep docs in sync with code
5. **Test Generation** — Generate and maintain test suites
6. **Refactoring** — Continuous code improvement
7. **Multi-Project Maintenance** — Cycle through all your repos

## 📝 Logging

Logs are in `logs/qwen-loop.log` (5MB max, 5 files rotation).

```bash
# Real-time
tail -f logs/qwen-loop.log     # Unix
Get-Content logs/qwen-loop.log -Wait  # Windows
```

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## ⚠️ Security

Qwen Loop runs AI agents in **YOLO mode** — they can read, modify, create, and delete files without confirmation. Always:
- Use version control (commits are automatic)
- Start with a small `maxLoopIterations` to test
- Use a dedicated working directory, not your entire project root

See [SECURITY.md](SECURITY.md) for details.

## 📄 License

MIT

---

**Built for autonomous development with AI agents** 🤖
