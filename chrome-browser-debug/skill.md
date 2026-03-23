---
name: chrome-browser-debug
description: Given a URL, navigate to it in the user's Chrome and capture browser diagnostics via Chrome DevTools Protocol — including console logs (errors/warns/info), JavaScript variable values, and network request details (status codes, payloads, failures). Use this skill whenever the user wants to inspect what's happening inside a browser page: frontend bugs, white screens, JS exceptions, API call failures, CORS errors, or wants to read a specific variable/state from the running page. Also trigger when user says things like "帮我看看报错", "页面崩了", "浏览器有错误", "前端报错了", "看看这个接口返回了什么", "帮我查一下这个变量的值". Always attempt to capture diagnostics before asking the user to copy-paste errors manually.
---

# chrome-browser-debug

Navigate to a URL in the user's running Chrome, collect all console logs and errors, return structured JSON for analysis.

Uses the user's existing Chrome session — cookies and auth state are preserved. Works for localhost and production URLs alike.

## Prerequisites

- **Node.js 21+** — required for built-in WebSocket
- **Chrome with remote debugging** — one-time setup, see `references/setup.md`

Chrome must be running with remote debugging enabled:

```bash
curl -s http://localhost:9222/json/version
```

If this fails, ask the user to relaunch Chrome with `--remote-debugging-port=9222`.

## Workflow

### Step 1 — Verify Chrome is reachable

```bash
curl -s http://localhost:9222/json/version
```

- Connection refused → list available Chrome profiles, let user pick, then relaunch:

  **1a. List profiles and detect current one:**
  ```bash
  node -e "
  const fs = require('fs'), path = require('path');
  const base = process.env.HOME + '/Library/Application Support/Google/Chrome';
  const state = JSON.parse(fs.readFileSync(base + '/Local State', 'utf8'));
  const cache = state.profile.info_cache;
  const last  = state.profile.last_used;
  console.log('Available Chrome profiles:\n');
  Object.entries(cache).forEach(([dir, info]) => {
    const tag = dir === last ? ' ← current' : '';
    console.log('  ' + dir.padEnd(12) + info.name + tag);
  });
  console.log('\nDefault profile dir: ' + last);
  "
  ```

  **1b. Sync the selected profile to the debug location and launch:**
  ```bash
  # Set PROFILE to the dir shown above (default: current profile)
  PROFILE="Default"   # ← change to e.g. "Profile 1" if needed
  CHROME=$(find /Applications ~/Applications -name "Google Chrome" -path "*/MacOS/Google Chrome" 2>/dev/null | head -1)
  REAL="$HOME/Library/Application Support/Google/Chrome/$PROFILE"
  DEBUG_DIR="$HOME/Library/Application Support/Google/ChromeDebug"
  # Sync profile (only copies changed files, fast after first run)
  rsync -a --delete "$REAL/" "$DEBUG_DIR/Default/"
  # Relaunch Chrome with debug profile
  killall "Google Chrome" 2>/dev/null; sleep 1
  "$CHROME" --remote-debugging-port=9222 --user-data-dir="$DEBUG_DIR" &
  sleep 3 && curl -s http://localhost:9222/json/version
  ```

  > **Note:** `rsync --delete` keeps the debug copy in sync with the real profile. Re-run this block any time sessions have expired.

- Returns JSON → proceed

### Step 2 — Capture logs

```bash
node scripts/capture.mjs "<url>" [timeout_ms] [--vars var1,var2,...]
```

The script:
1. Opens a new tab in the user's Chrome (shares their cookies / auth)
2. Navigates to the URL
3. Waits until network goes idle for 500ms, or the timeout expires (default: 15s)
4. Optionally evaluates JavaScript variables in the page context
5. Closes the tab and returns all captured data as JSON to stdout

Increase timeout for slow pages or heavy SPAs:
```bash
node scripts/capture.mjs "https://example.com/dashboard" 30000
```

Capture JavaScript variables (e.g. Module Federation runtime, Next.js data, feature flags):
```bash
node scripts/capture.mjs "https://example.com" 20000 --vars __FEDERATION__,__NEXT_DATA__,featureFlags
```

Variable capture notes:
- Variables are evaluated after the page settles (post network-idle)
- Non-serializable values are handled gracefully: circular references → `[Circular -> path]`, functions → `[Function: name]`, depth > 5 → `[max depth]`
- `skippedPaths` lists every property that could not be fully serialized, with the reason

### Step 3 — Analyze the output

Output format:
```json
{
  "url": "https://example.com/dashboard",
  "capturedAt": "2026-03-20T10:00:05.123Z",
  "total": 42,
  "errors": 3,
  "warns": 5,
  "variables": {
    "__FEDERATION__": {
      "exists": true,
      "value": { "runtime": "webpack", "...": "..." },
      "skippedPaths": [
        { "path": "__FEDERATION__.snapshotHandler.HostInstance", "reason": "circular", "circularRef": "__FEDERATION__.snapshotHandler" },
        { "path": "__FEDERATION__.moduleCache.init", "reason": "function", "detail": "init" }
      ]
    },
    "__NEXT_DATA__": {
      "exists": false,
      "skippedPaths": []
    }
  },
  "entries": [
    {
      "t": "2026-03-20T10:00:01.234Z",
      "level": "error",
      "msg": "Cannot read properties of undefined (reading 'user')",
      "stack": "https://example.com/assets/app.js:1:84231"
    },
    {
      "t": "2026-03-20T10:00:02.100Z",
      "level": "warn",
      "msg": "[HTTP] 404 Not Found — https://api.example.com/user/profile",
      "stack": null
    }
  ]
}
```

**Log levels captured:**
- `error` / `warn` / `log` / `info` / `debug` — from `console.*`
- `error` — uncaught JS exceptions (includes stack trace when available)
- `warn` / `error` — HTTP 4xx / 5xx responses
- `error` — network failures (CORS, DNS, connection refused)
- `warn` / `error` — browser-native entries (CSP violations, deprecations)

**Structure your analysis as:**
1. **Error summary** — count by level
2. **Critical errors first** — entries with stack traces, most recent first
3. **Patterns** — repeated errors or sequences pointing to root cause
4. **HTTP / network failures** — API issues, CORS, 404s
5. **Recommended fixes** — concrete, tied to specific log entries

### Step 4 — Offer follow-up

- Re-run with a longer timeout if logs seem cut off
- Re-run after the user takes a specific action to capture interaction errors

## Reference files

- `references/setup.md` — one-time Chrome setup
- `scripts/capture.mjs` — the capture script
