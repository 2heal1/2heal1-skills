# Long-Chain Capture

Keep a tab alive across multiple steps — navigate, click through interactions, then capture.

## Usage

```bash
# Step 1 — open tab, keep it alive
TAB=$(node scripts/capture.mjs "https://example.com" --keep-tab | jq -r .tabId)

# Step 2 — click through the interaction chain (each step waits for network idle)
node scripts/capture.mjs --tab-id "$TAB" --click "个人"
node scripts/capture.mjs --tab-id "$TAB" --click "收藏"

# Step 3 — final action, capture variables, close tab
node scripts/capture.mjs --tab-id "$TAB" --click "添加" --vars __FEDERATION__ --close
```

## Flags

| Flag | Description |
|---|---|
| `--keep-tab` | Don't close tab after capture; outputs `tabId` in result |
| `--tab-id <id>` | Attach to existing tab instead of navigating |
| `--click "<text or selector>"` | Click an element, then wait for network idle |
| `--dump-dom` | Output page DOM structure (for identifying selectors) |
| `--close` | Close the tab after this step |

## Click matching

Applied in order:
1. If query starts with `#`, `.`, `[`, or contains `>` → CSS selector
2. Otherwise → text match: **exact** → **prefix** → **contains**

## When element is not found

Use `--dump-dom` to let Claude inspect the page and identify the correct selector:

```bash
node scripts/capture.mjs --tab-id "$TAB" --dump-dom
# Claude analyzes the DOM, then:
node scripts/capture.mjs --tab-id "$TAB" --click "#profile-nav-btn"
```

## Tab lifecycle

- New tab (no `--tab-id`) → auto-closes unless `--keep-tab`
- Existing tab (`--tab-id`) → stays open unless `--close`
