# Chrome Browser Debug Skill

## 概述

本 Skill 封装了通过 **chrome-devtools-mcp**（基于 Chrome DevTools Protocol / CDP）直接连接浏览器，获取控制台日志、网络请求、JS 运行时变量等能力，供 Aime Agent 在调试前端项目时直接使用。

## 背景

Google 官方维护的 `chrome-devtools-mcp` 项目将 Chrome DevTools Protocol 包装为 MCP Server，使 AI Agent 能像人工使用 DevTools 一样：

- 读取 Console 日志（含报错、警告）
- 监控 Network 请求（请求/响应/状态码）
- 执行 JS 表达式，取运行时变量值
- 截图当前页面状态

## 工具配置

### 启动 MCP Server

```bash
npx @google/chrome-devtools-mcp
```

Chrome 需要以远程调试模式启动：

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-debug

# Windows
chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\chrome-debug
```

### MCP 配置示例（mcp_settings.json）

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["@google/chrome-devtools-mcp"],
      "env": {
        "CHROME_DEBUGGING_PORT": "9222"
      }
    }
  }
}
```

## 核心工具能力

| 工具名 | 说明 |
|--------|------|
| `list_console_messages` | 获取浏览器 Console 日志（含 error/warn/log） |
| `list_network_requests` | 获取当前页面的网络请求列表 |
| `evaluate_script` | 在页面上下文中执行 JS，读取运行时变量 |
| `take_screenshot` | 截图当前页面 |
| `list_targets` | 列出所有可调试的 Chrome Tab/Target |
| `navigate_to` | 导航到指定 URL |

## 典型使用场景

### 场景 1：调试前端 A2UI 渲染问题

> 「帮我看一下浏览器里有没有报错，顺便把 `window.__a2ui_state__` 的值取出来」

Agent 会调用：
1. `list_console_messages` 过滤 error 级别日志
2. `evaluate_script` 执行 `window.__a2ui_state__`

### 场景 2：排查 MF 模块加载失败

> 「MF 组件加载不出来，帮我看看 Network 里有没有 400/500」

Agent 会调用：
1. `list_network_requests` 过滤状态码 >= 400 的请求

### 场景 3：截图对比 UI 渲染结果

> 「帮我截一下现在的页面」

Agent 会调用：
1. `take_screenshot`

## 注意事项

- Chrome 必须以 `--remote-debugging-port` 模式启动，普通模式不支持 CDP 连接
- 生产环境不要开启远程调试端口，仅限本地开发使用
- 如果连接失败，先用 `list_targets` 检查 Chrome 是否正确暴露了调试接口
