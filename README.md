# 2heal1-skills

A collection of custom skills.

---

## chrome-browser-debug

Navigate to a URL in the user's real Chrome via Chrome DevTools Protocol (CDP), capture console logs, JS exceptions, network errors, and optionally extract JavaScript variable values.

### When it triggers

Just describe what you need — Agent will invoke this skill automatically:

- "Check errors on https://example.com"
- "Visit this page and get the `__FEDERATION__` variable"
- "The page is broken, check browser errors for me"
- "帮我看看报错 / 页面崩了 / 查一下这个变量"

### One-time setup

Chrome refuses remote debugging on its default profile directory. You need to sync the real profile to a separate location first.

**Step 1 — List available profiles:**

```bash
node -e "
const fs = require('fs');
const base = process.env.HOME + '/Library/Application Support/Google/Chrome';
const state = JSON.parse(fs.readFileSync(base + '/Local State', 'utf8'));
const last = state.profile.last_used;
Object.entries(state.profile.info_cache).forEach(([dir, info]) => {
  console.log((dir === last ? '* ' : '  ') + dir.padEnd(12) + info.name);
});
console.log('\nCurrent profile dir: ' + last);
"
```

**Step 2 — Sync the chosen profile to the debug directory:**

```bash
PROFILE="Profile 1"   # ← change to match your profile dir
rsync -a --delete \
  "$HOME/Library/Application Support/Google/Chrome/$PROFILE/" \
  "$HOME/Library/Application Support/Google/ChromeDebug/Default/"
```

**Optional: add a shell function to `~/.zshrc`** for quick launch with profile selection:

```bash
chrome-debug() {
  local PROFILE="${1:-Profile 1}"   # default profile, change as needed
  local REAL="$HOME/Library/Application Support/Google/Chrome/$PROFILE"
  local DEBUG_DIR="$HOME/Library/Application Support/Google/ChromeDebug"
  local CHROME=$(find /Applications ~/Applications -name "Google Chrome" -path "*/MacOS/Google Chrome" 2>/dev/null | head -1)
  echo "Syncing: $PROFILE → $DEBUG_DIR"
  mkdir -p "$DEBUG_DIR"
  rsync -a --delete "$REAL/" "$DEBUG_DIR/Default/"
  killall "Google Chrome" 2>/dev/null; sleep 1
  "$CHROME" --remote-debugging-port=9222 --user-data-dir="$DEBUG_DIR" &
  echo "Chrome launched with remote debugging on port 9222"
}
```

```bash
chrome-debug              # use default profile
chrome-debug "Default"   # use the anonymous profile
chrome-debug "Profile 2" # use a specific account
```

> **Why rsync?** `rsync --delete` is incremental — fast after the first sync. Re-run any time sessions have expired. Cookies remain decryptable because the macOS Keychain entry (`Chrome Safe Storage`) is shared between the original and the copied profile.

### Script usage

```bash
node scripts/capture.mjs "<url>" [timeout_ms] [--vars var1,var2,...]
```

**Examples:**

```bash
# Capture logs only
node scripts/capture.mjs "https://www.douyin.com/" 20000

# Capture logs + extract JS variables
node scripts/capture.mjs "https://www.douyin.com/" 25000 --vars __VMOK__
node scripts/capture.mjs "https://www.tiktok.com/" 25000 --vars __FEDERATION__,__NEXT_DATA__
```

### Output format

```json
{
  "url": "https://www.douyin.com/",
  "capturedAt": "2026-03-23T11:46:38.671Z",
  "total": 78,
  "errors": 35,
  "warns": 6,
  "variables": {
    "__VMOK__": {
      "exists": true,
      "value": {
        "__GLOBAL_PLUGIN__": ["..."],
        "__INSTANCES__": ["..."],
        "__SHARE__": {}
      },
      "skippedPaths": [
        { "path": "__VMOK__.snapshotHandler", "reason": "circular", "circularRef": "__VMOK__" },
        { "path": "__VMOK__.init", "reason": "function", "detail": "init" }
      ]
    }
  },
  "entries": [
    { "t": "...", "level": "error", "msg": "...", "stack": "file.js:1:100" }
  ]
}
```

**Variable serialization rules:**

| Case | Output |
|------|--------|
| Circular reference | `[Circular -> path.to.original]` |
| Function | `[Function: functionName]` |
| Depth > 5 | `[max depth]` |
| Property access error | `[Error: message]` |

All skipped paths are recorded in `skippedPaths[]` with `path`, `reason`, and `detail` fields.

### Real-world results

| Site | Variable | Result |
|------|----------|--------|
| douyin.com | `__VMOK__` | 2 instances: `@demo/douyin-web` v0.17.0, `@revenue-wallet-fe/recharge-web` v0.15.0 |
| tiktok.com | `__FEDERATION__` | 2 instances: `@tiktok/webapp-desktop` v0.18.3, `@webapp-shared/login-vmok` v0.16.0 |

---

## Directory structure

```
2heal1-skills/
└── chrome-browser-debug/
    ├── SKILL.md               # skill entry point (read by Claude)
    ├── scripts/
    │   └── capture.mjs        # CDP capture script
    └── references/
        └── setup.md           # one-time setup guide
```
