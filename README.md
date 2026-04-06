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
| `npm start -- validate` | Validate configuration |
| `npm start -- config` | Show current configuration |

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
