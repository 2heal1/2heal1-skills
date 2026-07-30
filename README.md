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

**Single capture** — navigate + collect, tab auto-closes:
```bash
node scripts/capture.mjs "<url>" [timeout_ms] [--vars var1,var2,...]
```

**Long-chain** — keep tab alive, click through interactions:
```bash
TAB=$(node scripts/capture.mjs "https://example.com" --keep-tab | jq -r .tabId)
node scripts/capture.mjs --tab-id "$TAB" --click "个人"
node scripts/capture.mjs --tab-id "$TAB" --click "收藏"
node scripts/capture.mjs --tab-id "$TAB" --click "添加" --vars __FEDERATION__ --close
```

**All flags:**

| Flag | Description |
|------|-------------|
| `--vars v1,v2` | Extract JS variables from the page |
| `--keep-tab` | Don't close tab; outputs `tabId` |
| `--tab-id <id>` | Attach to existing tab |
| `--click "<text>"` | Click by text or CSS selector, waits for network idle |
| `--dump-dom` | Output page DOM (for identifying selectors) |
| `--close` | Close the tab after this step |

### Real-world results

| Site | Variable | Result |
|------|----------|--------|
| douyin.com | `__VMOK__` | 2 instances: `@demo/douyin-web` v0.17.0, `@revenue-wallet-fe/recharge-web` v0.15.0 |
| tiktok.com | `__FEDERATION__` | 2 instances: `@tiktok/webapp-desktop` v0.18.3, `@webapp-shared/login-vmok` v0.16.0 |

---

## agent-activity-report

Generate Markdown daily or weekly reports from local Codex, Claude Code, Copilot, and Git activity history.

### When it triggers

- "生成今天 Codex 和 Claude Code 做了什么的日报"
- "整理上周 AI agent 做的事情，按大任务分组"
- "提取 Codex / Claude Code / Copilot / Git 最近一周的工作，生成周报"
- "把长期任务下面的小任务归到同一个标题里"

### Script usage

```bash
python3 skills/agent-activity-report/scripts/collect_activity.py \
  --range "last week" \
  --output reports/weekly-last-week.md \
  --json-output reports/weekly-last-week.evidence.json
```

Supported ranges include `today`, `yesterday`, `this week`, `last week`, `past 7 days`, `YYYY-MM-DD..YYYY-MM-DD`, `今天`, `昨天`, `本周`, `上周`, and `过去7天`.

---

## npm-oidc-release

Set up and run npm package release flows that use GitHub Actions trusted publishing/OIDC, with a safe local bootstrap path when an npm OTP is required.

### When it triggers

- "创建 release.yml，配置 npm OIDC 发包"
- "这个包需要先本地发一次，我给你 OTP"
- "帮我配置 npm trusted publishing"
- "修一下 npm 发布 workflow"
- "Use OIDC for npm publish instead of NPM_TOKEN"

### What it covers

- Create or repair `.github/workflows/release.yml`.
- Configure npm trusted publishing with the workflow filename, for example `release.yml`.
- Publish the first package version locally when npm requires the package to exist before OIDC can be configured.
- Use a user-provided OTP only for the publish command that needs it.
- Verify package archives and `npm view` results after publishing.

### Safety

The skill does not store OTP codes, npm tokens, or auth state in repo files. It prefers existing repository release scripts over direct `npm publish` whenever those scripts exist.

---

## bootstrap-npm-oidc-repo

Initialize an npm package repository and leave contributors with a complete CI,
preview release, release pull request, and automatic OIDC publishing flow.

### When it triggers

- "初始化这个 npm 包仓库，并配置 OIDC 发布"
- "给 pnpm 项目搭好 CI、预览版本和 release PR"
- "发布初始包，然后配置 npm trusted publishing"
- "把一个空仓库交付成可自动发包的仓库"

### What it covers

- Confirms the package name, initial version, package manager, and repository
  before publishing.
- Keeps pnpm or npm metadata, lockfiles, commands, and workflows consistent.
- Creates CI, Changesets preview publishing, release pull requests, and stable
  publishing after merge.
- Reuses `npm-oidc-release` for OTP-assisted bootstrap publishing and trusted
  publisher setup.
- Includes a validator that catches package-manager mismatches and unsafe
  release workflow changes.

---

## Directory structure

```
2heal1-skills/
└── skills/
    ├── agent-activity-report/
    │   ├── SKILL.md
    │   ├── scripts/
    │   │   └── collect_activity.py
    │   └── references/
    │       ├── grouping-rules.md
    │       └── report-workflow.md
    ├── bootstrap-npm-oidc-repo/
    │   ├── SKILL.md
    │   ├── agents/
    │   │   └── openai.yaml
    │   ├── scripts/
    │   │   └── validate_release_setup.mjs
    │   └── references/
    │       └── repository-contract.md
    ├── chrome-browser-debug/
    │   ├── SKILL.md                  # skill entry point (read by Claude)
    │   ├── scripts/
    │   │   └── capture.mjs           # CDP capture script
    │   └── references/
    │       ├── setup.md              # one-time Chrome setup
    │       ├── single-capture.md     # single capture usage + output format
    │       └── long-chain.md         # long-chain usage (click / tabId / DOM dump)
    └── npm-oidc-release/
        ├── SKILL.md
        ├── agents/
        │   └── openai.yaml
        └── references/
            └── npm-oidc-release.md
```
