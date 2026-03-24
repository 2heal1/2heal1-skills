#!/usr/bin/env node
// capture.mjs — collect browser logs + JS variables via Chrome DevTools Protocol
//
// New tab:      node capture.mjs <url> [timeout_ms] [--vars v1,v2] [--keep-tab] [--click "text"] [--dump-dom]
// Existing tab: node capture.mjs --tab-id <id> [--click "text"] [--fill "ph::text"] [--select "ph::value"] [--vars v1,v2] [--dump-dom] [--close]
//
// Long-chain example:
//   TAB=$(node capture.mjs https://example.com --keep-tab | jq -r .tabId)
//   node capture.mjs --tab-id $TAB --click "个人"
//   node capture.mjs --tab-id $TAB --fill "搜索框placeholder::关键词"
//   node capture.mjs --tab-id $TAB --select "请选择::选项A"
//   node capture.mjs --tab-id $TAB --click "添加" --vars __FEDERATION__ --close

const CDP_BASE = 'http://localhost:9222'
const IDLE_MS  = 500

// ── argument parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2)

function flagVal(flag) {
  const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null
}

const tabId       = flagVal('--tab-id')
const clickTarget = flagVal('--click')
const fillArg     = flagVal('--fill')    // "placeholder::text"
const selectArg   = flagVal('--select')  // "placeholder::value"
const varNamesRaw = flagVal('--vars')
const varNames    = varNamesRaw ? varNamesRaw.split(',').map(s => s.trim()).filter(Boolean) : []
const keepTab     = args.includes('--keep-tab')
const closeTab    = args.includes('--close')
const dumpDom     = args.includes('--dump-dom')

// positional args: skip flag names and their values
const flagsWithValues = new Set(['--tab-id', '--click', '--fill', '--select', '--vars'])
const skipIdx = new Set()
args.forEach((a, i) => { if (flagsWithValues.has(a)) { skipIdx.add(i); skipIdx.add(i + 1) } })
const positional = args.filter((a, i) => !a.startsWith('--') && !skipIdx.has(i))

const targetUrl = positional[0] ?? null
const timeout   = Number(positional[1] ?? 15_000)

if (!targetUrl && !tabId) {
  process.stderr.write(
    'Usage:\n' +
    '  node capture.mjs <url> [timeout_ms] [--vars v1,v2] [--keep-tab] [--click "text"] [--dump-dom]\n' +
    '  node capture.mjs --tab-id <id> [--click "text"] [--vars v1,v2] [--dump-dom] [--close]\n'
  )
  process.exit(1)
}

if (typeof WebSocket === 'undefined') {
  process.stderr.write('Node.js 21+ required (built-in WebSocket). Current: ' + process.version + '\n')
  process.exit(1)
}

// ── CDP session ───────────────────────────────────────────────────────────────

class Session {
  #ws; #nextId = 1; #pending = new Map(); #listeners = new Map()

  constructor(wsUrl) {
    this.#ws = new WebSocket(wsUrl)
    this.#ws.addEventListener('message', ({ data }) => {
      const msg = JSON.parse(data)
      if (msg.id != null) {
        const p = this.#pending.get(msg.id); this.#pending.delete(msg.id)
        msg.error ? p?.reject(new Error(msg.error.message)) : p?.resolve(msg.result)
      }
      if (msg.method) this.#listeners.get(msg.method)?.forEach(fn => fn(msg.params))
    })
  }

  open() {
    return new Promise((resolve, reject) => {
      this.#ws.addEventListener('open',  resolve, { once: true })
      this.#ws.addEventListener('error', e => reject(new Error(String(e.message ?? e))), { once: true })
    })
  }

  send(method, params = {}) {
    const id = this.#nextId++
    this.#ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }))
  }

  on(event, fn) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, [])
    this.#listeners.get(event).push(fn)
  }

  close() { this.#ws.close() }
}

// ── verify Chrome reachable ───────────────────────────────────────────────────

try {
  await fetch(`${CDP_BASE}/json/version`)
} catch {
  process.stderr.write(
    'Cannot reach Chrome on port 9222.\n\n' +
    'Quit Chrome and relaunch with remote debugging (macOS):\n' +
    '  CHROME=$(find /Applications ~/Applications -name "Google Chrome" -path "*/MacOS/Google Chrome" 2>/dev/null | head -1)\n' +
    '  killall "Google Chrome" 2>/dev/null; sleep 1\n' +
    '  "$CHROME" --remote-debugging-port=9222 --user-data-dir="$HOME/Library/Application Support/Google/Chrome" &\n\n' +
    'This uses your REAL Chrome profile — all cookies and login sessions are preserved.\n'
  )
  process.exit(1)
}

// ── get or create tab ─────────────────────────────────────────────────────────

let tab

if (tabId) {
  const tabs = await (await fetch(`${CDP_BASE}/json/list`)).json()
  tab = tabs.find(t => t.id === tabId)
  if (!tab) {
    process.stderr.write(`Tab not found: ${tabId}\nActive tabs:\n`)
    tabs.forEach(t => process.stderr.write(`  ${t.id}  ${t.url}\n`))
    process.exit(1)
  }
  process.stderr.write(`Attaching to tab: ${tab.url}\n`)
} else {
  process.stderr.write(`Navigating to ${targetUrl} (timeout: ${timeout / 1000}s)...\n`)
  tab = await (await fetch(`${CDP_BASE}/json/new`, { method: 'PUT' })).json()
}

const session = new Session(tab.webSocketDebuggerUrl)
await session.open()

// ── log collection ────────────────────────────────────────────────────────────

const logs = []
const stamp = () => new Date().toISOString()

session.on('Runtime.consoleAPICalled', ({ type, args: a, stackTrace }) => {
  const msg = a.map(x =>
    x.type === 'string' ? x.value
    : x.description     ? x.description
    : x.value != null   ? String(x.value)
    : x.type
  ).join(' ')
  const f = stackTrace?.callFrames?.[0]
  logs.push({ t: stamp(), level: type === 'warning' ? 'warn' : type, msg, stack: f ? `${f.url}:${f.lineNumber + 1}:${f.columnNumber + 1}` : null })
})

session.on('Runtime.exceptionThrown', ({ exceptionDetails: ex }) => {
  const msg = ex.exception?.description ?? ex.text ?? 'Unknown exception'
  const f = ex.stackTrace?.callFrames?.[0]
  logs.push({ t: stamp(), level: 'error', msg, stack: f ? `${f.url}:${f.lineNumber + 1}` : null })
})

session.on('Network.responseReceived', ({ response }) => {
  if (response.status < 400) return
  logs.push({ t: stamp(), level: response.status >= 500 ? 'error' : 'warn', msg: `[HTTP] ${response.status} ${response.statusText} — ${response.url}`, stack: null })
})

const pendingUrls = new Map()
session.on('Network.requestWillBeSent', ({ requestId, request }) => pendingUrls.set(requestId, request.url))
session.on('Network.loadingFailed', ({ requestId, errorText, blockedReason, canceled }) => {
  if (canceled) return
  logs.push({ t: stamp(), level: 'error', msg: `[network] ${blockedReason ?? errorText} — ${pendingUrls.get(requestId) ?? '?'}`, stack: null })
  pendingUrls.delete(requestId)
})

session.on('Log.entryAdded', ({ entry }) => {
  if (entry.level === 'verbose') return
  logs.push({ t: stamp(), level: entry.level === 'warning' ? 'warn' : entry.level, msg: entry.text, stack: entry.url ? `${entry.url}:${entry.lineNumber ?? 0}` : null })
})

// ── reusable network-idle waiter ──────────────────────────────────────────────

let inflight = 0
let idleTimer = null
const idleCallbacks = new Set()

function fireIdle() { const cbs = [...idleCallbacks]; idleCallbacks.clear(); cbs.forEach(cb => cb()) }
function scheduleIdle() {
  if (inflight === 0 && idleCallbacks.size > 0) { clearTimeout(idleTimer); idleTimer = setTimeout(fireIdle, IDLE_MS) }
}

session.on('Network.requestWillBeSent', () => { inflight++; clearTimeout(idleTimer); idleTimer = null })
session.on('Network.loadingFinished',   () => { inflight = Math.max(0, inflight - 1); scheduleIdle() })
session.on('Network.loadingFailed',     () => { inflight = Math.max(0, inflight - 1); scheduleIdle() })

function waitForNetworkIdle(maxMs = timeout) {
  return Promise.race([
    new Promise(r => { idleCallbacks.add(r); scheduleIdle() }),
    new Promise(r => setTimeout(r, maxMs)),
  ])
}

// ── enable domains & navigate ─────────────────────────────────────────────────

await Promise.all([
  session.send('Runtime.enable'),
  session.send('Network.enable'),
  session.send('Log.enable'),
  session.send('Page.enable'),
])

if (!tabId && targetUrl) {
  const pageLoaded = new Promise(r => session.on('Page.loadEventFired', r))
  await session.send('Page.navigate', { url: targetUrl })
  await pageLoaded
  await waitForNetworkIdle(timeout)
}

// ── click element ─────────────────────────────────────────────────────────────

let clickResult = null

if (clickTarget) {
  process.stderr.write(`Clicking: "${clickTarget}"\n`)

  const r = await session.send('Runtime.evaluate', {
    expression: `(function(q) {
      let el = null;
      // try as CSS selector if it looks like one
      const isSelector = q.startsWith('#') || q.startsWith('.') || q.startsWith('[') || q.includes('>');
      if (isSelector) { try { el = document.querySelector(q) } catch(e) {} }
      // fall back to text match across all interactive elements
      if (!el) {
        const candidates = Array.from(document.querySelectorAll(
          'button, a, [role=button], [role=tab], [role=menuitem], [role=option], li, span, div, input[type=submit]'
        ));
        el = candidates.find(e => e.textContent.trim() === q)
          ?? candidates.find(e => e.textContent.trim().startsWith(q))
          ?? candidates.find(e => e.textContent.trim().includes(q));
      }
      if (!el) return JSON.stringify({ found: false, tried: q });
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
      el.click();
      return JSON.stringify({
        found: true,
        tag:  el.tagName.toLowerCase(),
        text: el.textContent.trim().slice(0, 80),
        id:   el.id || null,
      });
    })(${JSON.stringify(clickTarget)})`,
    returnByValue: true,
  })

  clickResult = JSON.parse(r?.result?.value ?? '{"found":false}')

  if (!clickResult.found) {
    process.stderr.write(`  Warning: element not found for "${clickTarget}"\n`)
  } else {
    process.stderr.write(`  Clicked: <${clickResult.tag}> "${clickResult.text}"\n`)
    // wait briefly for click-triggered requests to start, then wait for idle
    await new Promise(r => setTimeout(r, 200))
    await waitForNetworkIdle(timeout)
  }
}

// ── fill input (locate by placeholder) ───────────────────────────────────────

let fillResult = null

if (fillArg) {
  const sep = fillArg.indexOf('::')
  const placeholder = sep !== -1 ? fillArg.slice(0, sep) : fillArg
  const text        = sep !== -1 ? fillArg.slice(sep + 2) : ''
  process.stderr.write(`Filling: placeholder="${placeholder}" text="${text}"\n`)

  const r = await session.send('Runtime.evaluate', {
    expression: `(function(ph, txt) {
      const el = document.querySelector('input[placeholder="' + ph + '"], textarea[placeholder="' + ph + '"]');
      if (!el) return JSON.stringify({ found: false, tried: ph });
      el.focus();
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
      // React/Vue-compatible: use native setter to trigger synthetic events
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, txt);
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return JSON.stringify({ found: true, tag: el.tagName.toLowerCase(), placeholder: el.placeholder });
    })(${JSON.stringify(placeholder)}, ${JSON.stringify(text)})`,
    returnByValue: true,
  })

  fillResult = JSON.parse(r?.result?.value ?? '{"found":false}')
  if (!fillResult.found) {
    process.stderr.write(`  Warning: input not found for placeholder="${placeholder}"\n`)
  } else {
    process.stderr.write(`  Filled: <${fillResult.tag}> placeholder="${fillResult.placeholder}"\n`)
    await new Promise(r => setTimeout(r, 200))
    await waitForNetworkIdle(timeout)
  }
}

// ── select option (locate by placeholder) ────────────────────────────────────

let selectResult = null

if (selectArg) {
  const sep         = selectArg.indexOf('::')
  const placeholder = sep !== -1 ? selectArg.slice(0, sep) : selectArg
  const value       = sep !== -1 ? selectArg.slice(sep + 2) : ''
  process.stderr.write(`Selecting: placeholder="${placeholder}" value="${value}"\n`)

  // Step 1: try native <select>, otherwise click the custom dropdown trigger
  const r1 = await session.send('Runtime.evaluate', {
    expression: `(function(ph, val) {
      // native <select>: match by placeholder attr or first option text
      const selects = Array.from(document.querySelectorAll('select'));
      const nativeSel = selects.find(s =>
        s.getAttribute('placeholder') === ph ||
        (s.options[0] && s.options[0].text.trim() === ph)
      );
      if (nativeSel) {
        const opt = Array.from(nativeSel.options).find(o => o.text.trim() === val || o.value === val);
        if (!opt) return JSON.stringify({ found: false, reason: 'option not found', tried: val });
        nativeSel.value = opt.value;
        nativeSel.dispatchEvent(new Event('change', { bubbles: true }));
        return JSON.stringify({ found: true, type: 'native', value: opt.value, text: opt.text.trim() });
      }
      // custom dropdown: find trigger by placeholder attr or visible placeholder text
      let trigger = document.querySelector('[placeholder="' + ph + '"]');
      if (!trigger) {
        const candidates = Array.from(document.querySelectorAll(
          '[role=combobox], [aria-haspopup], [class*=select], [class*=dropdown]'
        ));
        trigger = candidates.find(e => e.textContent.trim() === ph);
      }
      if (!trigger) return JSON.stringify({ found: false, reason: 'trigger not found', tried: ph });
      trigger.scrollIntoView({ behavior: 'instant', block: 'center' });
      trigger.click();
      return JSON.stringify({ found: true, type: 'custom', step: 'trigger_clicked' });
    })(${JSON.stringify(placeholder)}, ${JSON.stringify(value)})`,
    returnByValue: true,
  })

  selectResult = JSON.parse(r1?.result?.value ?? '{"found":false}')

  if (selectResult.type === 'custom' && selectResult.step === 'trigger_clicked') {
    // Step 2: wait for dropdown to open, then click the matching option
    await new Promise(r => setTimeout(r, 300))
    const r2 = await session.send('Runtime.evaluate', {
      expression: `(function(val) {
        const opts = Array.from(document.querySelectorAll(
          'option, [role=option], [role=menuitem], [class*=option-item], [class*=dropdown-item]'
        ));
        const opt = opts.find(e => e.textContent.trim() === val)
          ?? opts.find(e => e.textContent.trim().includes(val));
        if (!opt) return JSON.stringify({ found: false, tried: val });
        opt.click();
        return JSON.stringify({ found: true, type: 'custom', text: opt.textContent.trim() });
      })(${JSON.stringify(value)})`,
      returnByValue: true,
    })
    selectResult = JSON.parse(r2?.result?.value ?? '{"found":false}')
  }

  if (!selectResult.found) {
    process.stderr.write(`  Warning: select target not found (${selectResult.reason ?? 'unknown'})\n`)
  } else {
    process.stderr.write(`  Selected: [${selectResult.type}] "${selectResult.text ?? selectResult.value}"\n`)
    await new Promise(r => setTimeout(r, 200))
    await waitForNetworkIdle(timeout)
  }
}

// ── DOM dump (for Claude to identify selectors) ───────────────────────────────

let domSnapshot = null

if (dumpDom) {
  const r = await session.send('Runtime.evaluate', {
    expression: `(function() {
      function walk(el, depth) {
        if (depth > 4) return null;
        const tag = el.tagName?.toLowerCase();
        if (!tag || ['script','style','svg','noscript','head'].includes(tag)) return null;
        const text = el.children.length === 0 ? el.textContent.trim().slice(0, 120) : '';
        const attrs = {};
        if (el.id) attrs.id = el.id;
        if (el.className && typeof el.className === 'string') {
          const cls = el.className.split(' ').filter(Boolean);
          if (cls.length) attrs.class = cls.slice(0, 4).join(' ');
        }
        const role = el.getAttribute('role'); if (role) attrs.role = role;
        const children = Array.from(el.children).map(c => walk(c, depth + 1)).filter(Boolean);
        if (!text && !children.length && !Object.keys(attrs).length) return null;
        return { tag, ...(Object.keys(attrs).length ? { attrs } : {}), ...(text ? { text } : {}), ...(children.length ? { children } : {}) };
      }
      return JSON.stringify(walk(document.body, 0));
    })()`,
    returnByValue: true,
  })
  domSnapshot = JSON.parse(r?.result?.value ?? 'null')
}

// ── variable capture ──────────────────────────────────────────────────────────

const variables = {}

if (varNames.length) {
  process.stderr.write(`Capturing variables: ${varNames.join(', ')}\n`)

  const safeSerializerSrc = `
    (function captureVar(name) {
      const skipped = [];
      const seen = new WeakMap();

      function safe(val, path, depth) {
        if (depth > 5) { skipped.push({ path, reason: 'max_depth' }); return '[max depth]'; }
        if (val === null || val === undefined) return val;
        const t = typeof val;
        if (t === 'boolean' || t === 'number' || t === 'string') return val;
        if (t === 'bigint') return val.toString() + 'n';
        if (t === 'symbol') return val.toString();
        if (t === 'function') {
          skipped.push({ path, reason: 'function', detail: val.name || 'anonymous' });
          return '[Function: ' + (val.name || 'anonymous') + ']';
        }
        if (seen.has(val)) {
          skipped.push({ path, reason: 'circular', circularRef: seen.get(val) });
          return '[Circular -> ' + seen.get(val) + ']';
        }
        seen.set(val, path);
        if (Array.isArray(val)) return val.map((v, i) => safe(v, path + '[' + i + ']', depth + 1));
        const obj = {};
        for (const k of Object.keys(val)) {
          try { obj[k] = safe(val[k], path + '.' + k, depth + 1); }
          catch (e) { skipped.push({ path: path + '.' + k, reason: 'error', detail: e.message }); obj[k] = '[Error: ' + e.message + ']'; }
        }
        return obj;
      }

      let val;
      try { val = window[name]; } catch(e) { return JSON.stringify({ exists: false, error: e.message, skippedPaths: [] }); }
      if (val === undefined) return JSON.stringify({ exists: false, skippedPaths: [] });
      return JSON.stringify({ exists: true, value: safe(val, name, 0), skippedPaths: skipped });
    })
  `

  for (const varName of varNames) {
    try {
      const r = await session.send('Runtime.evaluate', {
        expression: `(${safeSerializerSrc})(${JSON.stringify(varName)})`,
        returnByValue: true,
      })
      variables[varName] = r?.result?.value
        ? JSON.parse(r.result.value)
        : { exists: false, error: r?.result?.description ?? 'unknown' }
    } catch (e) {
      variables[varName] = { exists: false, error: String(e.message) }
    }
    process.stderr.write(`  ${varName}: ${variables[varName].exists ? 'found' : 'not found'}${variables[varName].skippedPaths?.length ? ` (${variables[varName].skippedPaths.length} paths skipped)` : ''}\n`)
  }
}

// ── close or keep tab ─────────────────────────────────────────────────────────
// Default behaviour:
//   new tab  (no --tab-id)  → close unless --keep-tab
//   existing tab (--tab-id) → keep unless --close

const shouldClose = closeTab || (!keepTab && !tabId)
session.close()
if (shouldClose) await fetch(`${CDP_BASE}/json/close/${tab.id}`)

// ── output ────────────────────────────────────────────────────────────────────

const result = {
  ...(keepTab || tabId ? { tabId: tab.id } : {}),
  url:        targetUrl ?? tab.url,
  capturedAt: stamp(),
  total:      logs.length,
  errors:     logs.filter(l => l.level === 'error').length,
  warns:      logs.filter(l => l.level === 'warn').length,
  ...(clickTarget     ? { click:  clickResult  } : {}),
  ...(fillArg         ? { fill:   fillResult   } : {}),
  ...(selectArg       ? { select: selectResult } : {}),
  ...(dumpDom         ? { dom:    domSnapshot  } : {}),
  ...(varNames.length ? { variables }          : {}),
  entries: logs,
}

process.stderr.write(`Done: ${result.errors} errors, ${result.warns} warns, ${result.total} total\n`)
process.stdout.write(JSON.stringify(result, null, 2) + '\n')
