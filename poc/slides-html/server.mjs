// PoC server: holds one deck (the agent writes it, the person edits it), serves each slide in a sandboxed document,
// and exports PDF / PPTX through a headless Chrome. No framework, no persistence: it is a PoC.
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SLIDES_MAX = 40
const SLIDE_MAX_BYTES = 60_000
const BODY_MAX = 1_000_000

const STATIC = {
  '/kit.css': ['kit.css', 'text/css; charset=utf-8'],
  '/bridge.js': ['bridge.js', 'text/javascript; charset=utf-8'],
  '/charts.js': ['charts.js', 'text/javascript; charset=utf-8'],
  '/studio.js': ['studio.js', 'text/javascript; charset=utf-8'],
  '/studio.css': ['studio.css', 'text/css; charset=utf-8'],
  '/': ['studio.html', 'text/html; charset=utf-8'],
  '/vendor/chart.umd.js': ['node_modules/chart.js/dist/chart.umd.js', 'text/javascript; charset=utf-8'],
  '/vendor/dom-to-pptx.bundle.js': ['node_modules/dom-to-pptx/dist/dom-to-pptx.bundle.js', 'text/javascript; charset=utf-8'],
}

// ── the deck ────────────────────────────────────────────────────────────────
const state = { title: 'Untitled', theme: 'dark', version: 0, userRev: 0, slides: [], history: [], edits: new Map() }

/** Defence in depth only: the iframe sandbox and the CSP are the real fence. A production build uses a real sanitiser. */
export function sanitise (html) {
  return String(html)
    .replace(/<\s*(script|iframe|object|embed|link|meta|base|form)\b[\s\S]*?(<\s*\/\s*\1\s*>|$)/gi, '')
    .replace(/<\s*(script|iframe|object|embed|link|meta|base|form)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src|xlink:href)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2')
}

function asSlide (raw) {
  const html = sanitise(typeof raw === 'string' ? raw : raw?.html ?? '')
  if (html.length === 0 || html.length > SLIDE_MAX_BYTES) return null
  const root = /^\s*<(section|div)\b[^>]*class="[^"]*\bslide\b/i.test(html) ? html : `<div class="slide">${html}</div>`
  const notes = typeof raw?.notes === 'string' ? raw.notes.slice(0, 2000) : ''
  return { html: root, notes }
}

function putDeck (body) {
  const slides = (Array.isArray(body.slides) ? body.slides : []).slice(0, SLIDES_MAX).map(asSlide).filter(Boolean)
  if (slides.length === 0) throw new Error('slides must be a non-empty array of {html} (each under 60 KB)')
  const changed = slides.map((s, i) => state.slides[i]?.html !== s.html)
  state.slides = slides
  if (typeof body.title === 'string' && body.title.trim()) state.title = body.title.trim().slice(0, 120)
  if (['dark', 'paper', 'light'].includes(body.theme)) state.theme = body.theme
  state.version += 1
  if (body.clear_edits === true) state.edits.clear()
  state.history.unshift({ version: state.version, who: 'agent', t: Date.now(), slides: slides.length, changed: changed.map((c, i) => (c ? i : -1)).filter((i) => i >= 0) })
  state.history.length = Math.min(state.history.length, 30)
  return { version: state.version, slides: slides.length }
}

function recordEdit (body) {
  const i = Number(body.slide)
  if (!Number.isInteger(i) || i < 0 || i >= state.slides.length) throw new Error('unknown slide')
  const key = `${i}:${body.id}`
  const before = state.edits.get(key)?.before ?? String(body.before ?? '')
  const after = String(body.after ?? '').slice(0, 2000)
  if (before === after) state.edits.delete(key)
  else state.edits.set(key, { slide: i, id: String(body.id), before, after, t: Date.now() })
  const slide = asSlide(body.html)
  if (slide) { state.slides[i] = { ...state.slides[i], html: slide.html }; state.userRev += 1 }
  return { edits: state.edits.size, userRev: state.userRev }
}

// ── documents ───────────────────────────────────────────────────────────────
const themeAttr = () => `data-theme="${state.theme}"`
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')

/** One slide as a standalone document for the sandboxed iframe (no same-origin, scripts only from our own kit). */
function slideDoc (i, { thumb = false } = {}) {
  return `<!doctype html><html lang="en" data-slide="${i}"><head><meta charset="utf-8"><link rel="stylesheet" href="/kit.css"></head>`
    + `<body ${themeAttr()}>${state.slides[i].html}`
    + `<script src="/vendor/chart.umd.js"></script><script src="/charts.js"></script>${thumb ? '' : '<script src="/bridge.js"></script>'}</body></html>`
}

/** All slides in one document (main DOM): the source for PDF and PPTX export. */
function allSlidesDoc ({ pptx = false } = {}) {
  const css = pptx
    ? 'html,body{width:1600px;height:auto;overflow:visible} .slide{margin:0 0 40px 0}'
    : '@page{size:1600px 900px;margin:0} html,body{width:1600px;height:auto;overflow:visible} .slide{break-after:page;page-break-after:always}'
  const notes = (s) => (s.notes ? ` data-pptx-notes="${esc(s.notes)}"` : '')
  const body = state.slides.map((s) => (notes(s) ? s.html.replace(/^(\s*<\w+)/, `$1${notes(s)}`) : s.html)).join('\n')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/kit.css"><style>${css}</style></head>`
    + `<body ${themeAttr()}>${body}<script src="/vendor/chart.umd.js"></script><script src="/charts.js"></script></body></html>`
}

// ── exports (headless Chrome) ───────────────────────────────────────────────
let browserPromise = null
async function browser () {
  if (!browserPromise) {
    const puppeteer = (await import('puppeteer-core')).default
    if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME} (set CHROME_PATH)`)
    browserPromise = puppeteer.launch({ executablePath: CHROME, headless: true })
  }
  return browserPromise
}

async function exportPdf (base) {
  const page = await (await browser()).newPage()
  try {
    await page.setViewport({ width: 1600, height: 900 })
    await page.goto(`${base}/export/all.html`, { waitUntil: 'networkidle0' })
    await page.waitForFunction('window.__chartsReady === true', { timeout: 15000 })
    return Buffer.from(await page.pdf({ width: '1600px', height: '900px', printBackground: true, preferCSSPageSize: true }))
  } finally { await page.close() }
}

async function exportPptx (base) {
  const page = await (await browser()).newPage()
  try {
    await page.setViewport({ width: 1600, height: 900 })
    await page.goto(`${base}/export/pptx.html`, { waitUntil: 'networkidle0' })
    await page.waitForFunction('window.__chartsReady === true', { timeout: 15000 })
    const b64 = await page.evaluate(async (title) => {
      const blob = await window.domToPptx.exportToPptx(Array.from(document.querySelectorAll('.slide')), { skipDownload: true, fileName: 'deck.pptx', title })
      const buf = new Uint8Array(await blob.arrayBuffer())
      let s = ''
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000))
      return btoa(s)
    }, state.title)
    return Buffer.from(b64, 'base64')
  } finally { await page.close() }
}

// ── http ────────────────────────────────────────────────────────────────────
const SLIDE_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data: blob: 'self'; font-src data: 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'"

function readBody (req) {
  return new Promise((resolve, reject) => {
    let size = 0; const parts = []
    req.on('data', (c) => { size += c.length; if (size > BODY_MAX) { reject(new Error('body too large')); req.destroy(); return } parts.push(c) })
    req.on('end', () => { try { resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}) } catch { reject(new Error('invalid JSON')) } })
    req.on('error', reject)
  })
}

const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra })
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

export function start (port = 0) {
  const server = createServer(async (req, res) => {
    // DNS-rebinding fence: only answer to our own loopback names.
    const host = String(req.headers.host || '').replace(/:\d+$/, '')
    if (host !== '127.0.0.1' && host !== 'localhost') return send(res, 421, { error: 'bad host' })
    const u = new URL(req.url, 'http://localhost')
    const base = `http://127.0.0.1:${server.address().port}`
    try {
      if (req.method === 'GET' && STATIC[u.pathname]) {
        const [file, type] = STATIC[u.pathname]
        return send(res, 200, readFileSync(join(HERE, file)), type)
      }
      if (req.method === 'GET' && u.pathname === '/favicon.ico') { res.writeHead(204); return res.end() }
      let m
      if (req.method === 'GET' && (m = u.pathname.match(/^\/slide\/(\d+)\.html$/))) {
        const i = Number(m[1])
        if (!state.slides[i]) return send(res, 404, { error: 'no such slide' })
        return send(res, 200, slideDoc(i, { thumb: u.searchParams.get('thumb') === '1' }), 'text/html; charset=utf-8', { 'content-security-policy': SLIDE_CSP })
      }
      if (req.method === 'GET' && u.pathname === '/export/all.html') return send(res, 200, allSlidesDoc(), 'text/html; charset=utf-8')
      if (req.method === 'GET' && u.pathname === '/export/pptx.html') {
        return send(res, 200, allSlidesDoc({ pptx: true }).replace('</body>', '<script src="/vendor/dom-to-pptx.bundle.js"></script></body>'), 'text/html; charset=utf-8')
      }
      if (req.method === 'GET' && u.pathname === '/api/state') {
        return send(res, 200, { title: state.title, theme: state.theme, version: state.version, userRev: state.userRev, slides: state.slides.length, edits: state.edits.size, history: state.history })
      }
      if (req.method === 'GET' && u.pathname === '/api/deck') return send(res, 200, { title: state.title, theme: state.theme, version: state.version, slides: state.slides })
      if (req.method === 'PUT' && u.pathname === '/api/deck') return send(res, 200, putDeck(await readBody(req)))
      if (req.method === 'POST' && u.pathname === '/api/theme') {
        const b = await readBody(req); if (['dark', 'paper', 'light'].includes(b.theme)) state.theme = b.theme
        return send(res, 200, { theme: state.theme })
      }
      if (req.method === 'POST' && u.pathname === '/api/edits') return send(res, 200, recordEdit(await readBody(req)))
      if (req.method === 'GET' && u.pathname === '/api/edits') return send(res, 200, { version: state.version, edits: [...state.edits.values()] })
      if (req.method === 'DELETE' && u.pathname === '/api/edits') { state.edits.clear(); return send(res, 200, { edits: 0 }) }
      if (req.method === 'GET' && u.pathname === '/api/export/pdf') {
        return send(res, 200, await exportPdf(base), 'application/pdf', { 'content-disposition': 'attachment; filename="deck.pdf"' })
      }
      if (req.method === 'GET' && u.pathname === '/api/export/pptx') {
        return send(res, 200, await exportPptx(base), 'application/vnd.openxmlformats-officedocument.presentationml.presentation', { 'content-disposition': 'attachment; filename="deck.pptx"' })
      }
      return send(res, 404, { error: 'not found' })
    } catch (e) {
      return send(res, 400, { error: String(e?.message ?? e) })
    }
  })
  server.on('close', () => { browserPromise?.then((b) => b.close()).catch(() => {}) })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await start(Number(process.env.PORT ?? 47321))
  console.log(`LISTENING ${server.address().port}`)
  process.on('SIGTERM', () => server.close(() => process.exit(0)))
}
