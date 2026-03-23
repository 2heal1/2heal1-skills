# Setup Guide

## 快速上手

### 1. 安装依赖

```bash
npm install -g @google/chrome-devtools-mcp
# 或直接用 npx 免安装运行
npx @google/chrome-devtools-mcp
```

### 2. 启动 Chrome（调试模式）

**macOS**：
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-debug-profile \
  --no-first-run
```

**Windows（PowerShell）**：
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="C:\chrome-debug"
```

**Linux**：
```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-debug \
  --no-sandbox
```

### 3. 验证连接

打开 http://localhost:9222/json 应该看到 JSON 格式的 Target 列表。

### 4. 在 Aime 中配置

将以下配置添加到 Aime 的 MCP 设置中：

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "@google/chrome-devtools-mcp"],
      "env": {
        "CHROME_DEBUGGING_PORT": "9222",
        "CHROME_DEBUGGING_HOST": "localhost"
      }
    }
  }
}
```

## 常见问题

### Q: 连接失败 / 无法找到 Chrome

确认 Chrome 已以调试模式启动，访问 `http://localhost:9222/json` 验证。

### Q: 读取不到日志

确认目标 Tab 已打开，使用 `list_targets` 查看可用的 Tab，再用 `navigate_to` 切换到目标页面。

### Q: 权限报错

部分系统需要 `--no-sandbox` 参数（尤其是 Linux CI 环境），本地开发一般不需要。
