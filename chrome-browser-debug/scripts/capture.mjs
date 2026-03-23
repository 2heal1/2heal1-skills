#!/usr/bin/env node
// capture.mjs — collect browser logs + JS variables via Chrome DevTools Protocol
// Usage: node capture.mjs <url> [timeout_ms] [--vars var1,var2,...]
// Requires: Chrome running with --remote-debugging-port=9222, Node.js 21+

const CDP_BASE = 'http://localhost:9222'
const IDLE_MS  = 500   // ms of network silence → "page settled"

// ── argument parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const targetUrl = args[0]
const varsIdx   = args.indexOf('--vars')
const varNames  = varsIdx !== -1 ? args[varsIdx + 1]?.split(',').map(s => s.trim()).filter(Boolean) : []
const timeout   = Number(args.find((a, i) => i > 0 && i !== varsIdx && i !== varsIdx + 1 && !a.startsWith('--')) ?? 15_000)

if (!targetUrl) {
  process.stderr.write('Usage: node capture.mjs <url> [timeout_ms] [--vars var1,var2,...]\n')
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
        const p = this.#pending.get(msg.id)
        this.#pending.delete(msg.id)
        msg.error ? p?.reject(new Error(msg.error.message)) : p?.resolve(msg.result)
      }
      if (msg.method) {
        this.#listeners.get(msg.method)?.forEach(fn => fn(msg.params))
      }
    })
  }

  open() {
    return new Promise((resolve, reject) => {
      this.#ws.addEventListener('open',  resolve, { once: true })
      this.#ws.addEventListener('error', (e) => reject(new Error(String(e.message ?? e))), { once: true })
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

// ── open new tab (shares user's cookies / auth state) ────────────────────────

process.stderr.write(`Navigating to ${targetUrl} (timeout: ${timeout / 1000}s)...\n`)
if (varNames.length) process.stderr.write(`Capturing variables: ${varNames.join(', ')}\n`)

const tabRes = await fetch(`${CDP_BASE}/json/new`, { method: 'PUT' })
const tab    = await tabRes.json()
const session = new Session(tab.webSocketDebuggerUrl)
await session.open()

// ── log collection ────────────────────────────────────────────────────────────

const logs = []
const stamp = () => new Date().toISOString()

// console.log / warn / error / info / debug
session.on('Runtime.consoleAPICalled', ({ type, args, stackTrace }) => {
  const msg = args.map(a =>
    a.type === 'string' ? a.value
    : a.description     ? a.description
    : a.value != null   ? String(a.value)
    : a.type
  ).join(' ')
  const f = stackTrace?.callFrames?.[0]
  logs.push({
    t:     stamp(),
    level: type === 'warning' ? 'warn' : type,
    msg,
    stack: f ? `${f.url}:${f.lineNumber + 1}:${f.columnNumber + 1}` : null,
  })
})

// uncaught JS exceptions
session.on('Runtime.exceptionThrown', ({ exceptionDetails: ex }) => {
  const msg = ex.exception?.description ?? ex.text ?? 'Unknown exception'
  const f   = ex.stackTrace?.callFrames?.[0]
  logs.push({
    t:     stamp(),
    level: 'error',
    msg,
    stack: f ? `${f.url}:${f.lineNumber + 1}` : null,
  })
})

// HTTP 4xx / 5xx
session.on('Network.responseReceived', ({ response }) => {
  if (response.status < 400) return
  logs.push({
    t:     stamp(),
    level: response.status >= 500 ? 'error' : 'warn',
    msg:   `[HTTP] ${response.status} ${response.statusText} — ${response.url}`,
    stack: null,
  })
})

// network failures (CORS, DNS, timeout, connection refused …)
const pendingUrls = new Map()
session.on('Network.requestWillBeSent', ({ requestId, request }) => {
  pendingUrls.set(requestId, request.url)
})
session.on('Network.loadingFailed', ({ requestId, errorText, blockedReason, canceled }) => {
  if (canceled) return   // user navigated away — not an error
  const url = pendingUrls.get(requestId) ?? '?'
  pendingUrls.delete(requestId)
  logs.push({
    t:     stamp(),
    level: 'error',
    msg:   `[network] ${blockedReason ?? errorText} — ${url}`,
    stack: null,
  })
})

// browser-native entries: CSP violations, deprecations, security warnings …
session.on('Log.entryAdded', ({ entry }) => {
  if (entry.level === 'verbose') return
  logs.push({
    t:     stamp(),
    level: entry.level === 'warning' ? 'warn' : entry.level,
    msg:   entry.text,
    stack: entry.url ? `${entry.url}:${entry.lineNumber ?? 0}` : null,
  })
})

// ── network-idle detection ────────────────────────────────────────────────────
//
// Strategy: track in-flight requests. Once the page's load event has fired
// AND inflight drops to 0, start a 500ms quiet timer. If no new request
// interrupts it, we consider the page settled.

let inflight  = 0
let idleTimer = null
let resolveIdle
const idlePromise = new Promise(r => { resolveIdle = r })
let pageLoaded    = false

function scheduleIdle() {
  if (pageLoaded && inflight === 0 && !idleTimer) {
    idleTimer = setTimeout(resolveIdle, IDLE_MS)
  }
}

session.on('Network.requestWillBeSent', () => {
  inflight++
  clearTimeout(idleTimer)
  idleTimer = null
})
session.on('Network.loadingFinished', () => { inflight = Math.max(0, inflight - 1); scheduleIdle() })
session.on('Network.loadingFailed',   () => { inflight = Math.max(0, inflight - 1); scheduleIdle() })

// Only start idle countdown after the initial load event fires
session.on('Page.loadEventFired', () => { pageLoaded = true; scheduleIdle() })

// ── enable domains & navigate ─────────────────────────────────────────────────

await Promise.all([
  session.send('Runtime.enable'),
  session.send('Network.enable'),
  session.send('Log.enable'),
  session.send('Page.enable'),
])

await session.send('Page.navigate', { url: targetUrl })

await Promise.race([
  idlePromise,
  new Promise(r => setTimeout(r, timeout)),
])

// ── variable capture ──────────────────────────────────────────────────────────
//
// Evaluates each requested variable in the page context using a safe serializer
// that handles circular references and non-serializable values. Skipped paths
// (circular, functions, max-depth) are recorded separately.

const variables = {}

if (varNames.length) {
  // The safe serializer runs inside the page — injected as a string expression
  const safeSerializerSrc = `
    (function captureVar(name) {
      const skipped = [];
      const seen = new WeakMap();

      function safe(val, path, depth) {
        if (depth > 5) {
          skipped.push({ path, reason: 'max_depth' });
          return '[max depth]';
        }
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
        if (Array.isArray(val)) {
          return val.map((v, i) => safe(v, path + '[' + i + ']', depth + 1));
        }
        const obj = {};
        for (const k of Object.keys(val)) {
          try {
            obj[k] = safe(val[k], path + '.' + k, depth + 1);
          } catch (e) {
            skipped.push({ path: path + '.' + k, reason: 'error', detail: e.message });
            obj[k] = '[Error: ' + e.message + ']';
          }
        }
        return obj;
      }

      let val;
      try { val = window[name]; } catch(e) {
        return JSON.stringify({ exists: false, error: e.message, skippedPaths: [] });
      }
      if (val === undefined) {
        return JSON.stringify({ exists: false, skippedPaths: [] });
      }
      const serialized = safe(val, name, 0);
      return JSON.stringify({ exists: true, value: serialized, skippedPaths: skipped });
    })
  `

  for (const varName of varNames) {
    try {
      const expr = `(${safeSerializerSrc})(${JSON.stringify(varName)})`
      const r = await session.send('Runtime.evaluate', { expression: expr, returnByValue: true })
      if (r?.result?.value) {
        variables[varName] = JSON.parse(r.result.value)
      } else {
        variables[varName] = { exists: false, error: r?.result?.description ?? 'unknown' }
      }
    } catch (e) {
      variables[varName] = { exists: false, error: String(e.message) }
    }
    process.stderr.write(`  ${varName}: ${variables[varName].exists ? 'found' : 'not found'}${variables[varName].skippedPaths?.length ? ` (${variables[varName].skippedPaths.length} paths skipped)` : ''}\n`)
  }
}

session.close()
await fetch(`${CDP_BASE}/json/close/${tab.id}`)

// ── output ────────────────────────────────────────────────────────────────────

const result = {
  url:        targetUrl,
  capturedAt: stamp(),
  total:      logs.length,
  errors:     logs.filter(l => l.level === 'error').length,
  warns:      logs.filter(l => l.level === 'warn').length,
  ...(varNames.length ? { variables } : {}),
  entries:    logs,
}

process.stderr.write(`Done: ${result.errors} errors, ${result.warns} warns, ${result.total} total\n`)
process.stdout.write(JSON.stringify(result, null, 2) + '\n')
