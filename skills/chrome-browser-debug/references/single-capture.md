# Single Capture

Navigate to a URL, collect logs + variables, tab auto-closes.

## Usage

```bash
node scripts/capture.mjs "<url>" [timeout_ms] [--vars var1,var2,...]
```

Increase timeout for slow pages or heavy SPAs:
```bash
node scripts/capture.mjs "https://example.com/dashboard" 30000
```

Capture JavaScript variables:
```bash
node scripts/capture.mjs "https://example.com" 20000 --vars __FEDERATION__,__NEXT_DATA__,featureFlags
```

## Output format

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
      "value": { "runtime": "webpack" },
      "skippedPaths": [
        { "path": "__FEDERATION__.snapshotHandler.HostInstance", "reason": "circular", "circularRef": "__FEDERATION__.snapshotHandler" },
        { "path": "__FEDERATION__.moduleCache.init", "reason": "function", "detail": "init" }
      ]
    },
    "__NEXT_DATA__": { "exists": false, "skippedPaths": [] }
  },
  "entries": [
    { "t": "2026-03-20T10:00:01.234Z", "level": "error", "msg": "Cannot read properties of undefined (reading 'user')", "stack": "https://example.com/assets/app.js:1:84231" },
    { "t": "2026-03-20T10:00:02.100Z", "level": "warn",  "msg": "[HTTP] 404 Not Found — https://api.example.com/user/profile", "stack": null }
  ]
}
```

## Log levels captured

- `error` / `warn` / `log` / `info` / `debug` — from `console.*`
- `error` — uncaught JS exceptions (includes stack trace when available)
- `warn` / `error` — HTTP 4xx / 5xx responses
- `error` — network failures (CORS, DNS, connection refused)
- `warn` / `error` — browser-native entries (CSP violations, deprecations)

## Variable serialization

Non-serializable values are handled gracefully:
- Circular references → `[Circular -> path]`
- Functions → `[Function: name]`
- Depth > 5 → `[max depth]`
- `skippedPaths` records every property that could not be fully serialized
