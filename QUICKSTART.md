# Quick Start Guide

## 🚀 Get Started in 5 Minutes

### 1. Install Qwen Code CLI

```bash
# npm
npm install -g @qwen-code/qwen-code

# Or Linux/macOS script
curl -fsSL https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen.sh | bash

# Or Windows script (admin CMD)
curl -fsSL -o %TEMP%\install-qwen.bat https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen.bat && %TEMP%\install-qwen.bat

# Verify
qwen --help
```

> **Note:** Restart your terminal after installation.

### 1.5. Authenticate (one-time)

```bash
qwen
```

Opens browser for OAuth login (free). Close after success.

### 2. Install Dependencies

```bash
npm install
```

### 3. Initialize Configuration

**Single project:**
```bash
npm start -- init
```

**Multi-project:**
```bash
npm start -- init-multi
```

### 4. Configure Your Project

Edit `qwen-loop.config.json`:

```json
{
  "agents": [{ "name": "qwen-dev", "type": "qwen", "timeout": 120000 }],
  "maxConcurrentTasks": 1,
  "loopInterval": 5000,
  "maxRetries": 2,
  "workingDirectory": "./your-project",
  "maxLoopIterations": 0,
  "enableSelfTaskGeneration": true
}
```

| Setting | Description |
|---------|-------------|
| `maxLoopIterations` | `0` = run forever, `N` = stop after N tasks |
| `enableSelfTaskGeneration` | Auto-analyze project and generate tasks |

### 5. Run!

```bash
npm start -- start
```

Press `Ctrl+C` to stop.

## 📋 Common Commands

```bash
npm start -- init           # Single-project config
npm start -- init-multi     # Multi-project config
npm start -- start          # Start the loop
npm start -- validate       # Check config
npm start -- config         # Show config details
npm run dev                 # Dev mode with auto-reload
```

## 🌐 Multi-Project Example

```json
{
  "agents": [{ "name": "qwen", "type": "qwen", "timeout": 120000 }],
  "maxLoopIterations": 3,
  "enableSelfTaskGeneration": true,
  "projects": [
    { "name": "frontend", "workingDirectory": "./my-app" },
    { "name": "backend", "workingDirectory": "./my-api" }
  ]
}
```

```bash
npm start -- start
# → Works on frontend (3 tasks) → then backend (3 tasks) → cycles
```

## ⚙️ Configuration Tips

1. **Loop speed**: Lower `loopInterval` = faster, more resource usage
2. **Safety first**: Set `maxLoopIterations` > 0 for testing, `0` for production
3. **Parallel tasks**: Increase `maxConcurrentTasks` (Qwen handles one at a time)
4. **Multiple agents**: Run different Qwen agents with different models

## 📊 Monitoring

Status prints every 30 seconds:

```
🟢 qwen-dev (qwen) - idle
=== Task Queue Stats ===
  COMPLETED: 3 | FAILED: 0 | RUNNING: 0
```

View live logs:
```bash
tail -f logs/qwen-loop.log
```

## 🛑 Stopping

`Ctrl+C` → graceful shutdown, stops after current task finishes.

## 🔧 Troubleshooting

| Issue | Fix |
|-------|-----|
| `qwen: command not found` | `npm install -g @qwen-code/qwen-code`, restart terminal |
| `Authentication required` | Run `qwen` once to login |
| No agents configured | Run `npm start -- init` |
| Qwen asks for permission | Check `.qwen/settings.json` has `"defaultMode": "yolo"` |
| Git push fails | Run `git push` manually once to setup remote |

## 📚 Next Steps

- Read full [README.md](README.md) for architecture details
- Check [SECURITY.md](SECURITY.md) for risks of autonomous agents
- See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute

---

**Happy autonomous coding!** 🤖✨
