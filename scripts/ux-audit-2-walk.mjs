// Second UX and bug audit — screen walker (French, Arabic RTL, 375/768 px, keyboard).
// Read-only: it only opens things (pages, tabs, dialogs). It runs against an isolated
// instance (scripts/sandbox), never the real DSH on :3080.
//
//   source scripts/sandbox/env.sh
//   node scripts/ux-audit-2-walk.mjs --out /tmp/ux-audit-2 --lang fr --width 1400
//
// Per screen it writes a screenshot (PNG) and the probe scan (JSON) to --out, so the
// auditor can LOOK at every one. It never clicks Save, Install, Delete, Send or a
// language switch: the language is driven separately by ux-audit-2-lang.mjs.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage, openSettings, goToSettingsPage, showAllSettingsPages, clickText, waitFor } from './live-page.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d }
const OUT = argOf('--out', '/tmp/ux-audit-2/walk')
const WIDTH = Number(argOf('--width', '1400'))
const HEIGHT = Number(argOf('--height', '900'))
const LANG = argOf('--lang', 'en') // informational label for the output folders
const ONLY = argOf('--only', '') // comma list of screen ids to walk
const KEYBOARD = process.argv.includes('--keyboard')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ refusing to run against :3080 — use the sandbox (scripts/sandbox)'); process.exit(3) }
mkdirSync(join(OUT, 'shots'), { recursive: true })

// The skill folder lives in the SHARED tree (not copied into every worktree).
const probesPath = process.env.KB_PROBES || join(REPO_ROOT, '.claude', 'skills', 'ux-bug-hunter', 'probes.js')
const probes = readFileSync(probesPath, 'utf8')

const live = await openLivePage({ width: WIDTH, height: HEIGHT })
const page = live.page
const ev = async (js, ms = 15000) => (await page.evalJs(js, ms)).val

const results = []
const n = { i: 0 }
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

const shot = async (id) => {
  const name = String(n.i++).padStart(3, '0') + '-' + slug(id) + '.png'
  const ok = await page.shot(join(OUT, 'shots', name))
  return ok ? name : null
}

const scan = async () => {
  await page.evalJs(probes, 8000)
  return JSON.parse((await ev('JSON.stringify(window.__UXH__.scan())', 20000)) || '{"findings":[]}')
}

/** Record one screen: screenshot + probe scan + a few measured boxes. */
const record = async (id, extra = {}) => {
  await sleep(400)
  const img = await shot(id)
  const findings = await scan()
  const overflow = JSON.parse((await ev(`JSON.stringify((() => {
    const out = []
    for (const e of document.querySelectorAll('*')) {
      const r = e.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      if (r.right > window.innerWidth + 1 || r.left < -1) {
        const cs = getComputedStyle(e)
        if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.opacity === '0') continue
        out.push({ tag: e.tagName, cls: (e.className && e.className.baseVal !== undefined ? e.className.baseVal : String(e.className || '')).slice(0, 60), left: Math.round(r.left), right: Math.round(r.right), text: (e.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 60) })
      }
    }
    return out.slice(0, 25)
  })()))`)) || '[]')
  const cut = JSON.parse((await ev(`JSON.stringify((() => {
    const out = []
    for (const e of document.querySelectorAll('*')) {
      if (e.children.length) continue
      const t = (e.innerText || e.value || e.placeholder || '').replace(/\\s+/g, ' ').trim()
      if (!t || t.length < 6) continue
      const cs = getComputedStyle(e)
      if (cs.overflow === 'visible' && cs.textOverflow !== 'ellipsis') continue
      if (e.scrollWidth > e.clientWidth + 2 && cs.textOverflow !== 'ellipsis' && !e.getAttribute('title') && !e.getAttribute('aria-label')) {
        out.push({ tag: e.tagName, cls: String(e.className || '').slice(0, 50), text: t.slice(0, 70), scrollWidth: e.scrollWidth, clientWidth: e.clientWidth })
      }
    }
    return out.slice(0, 25)
  })()))`)) || '[]')
  const entry = { id, lang: LANG, width: WIDTH, shot: img, findings: findings.findings || findings, overflow, cut, ...extra }
  results.push(entry)
  writeFileSync(join(OUT, 'walk.json'), JSON.stringify(results, null, 2))
  console.log('✓ ' + id + (img ? '' : ' (no screenshot)') + ' — ' + ((entry.findings || []).length) + ' findings, ' + overflow.length + ' overflowing, ' + cut.length + ' cut')
  return entry
}

// ── 1. sidebar pages ────────────────────────────────────────────────────────────
const PAGES = [
  { id: 'kaby', label: 'Kaby' },
  { id: 'dashboards', label: 'Dashboards' },
  { id: 'agent-teams', label: 'Agent Teams' },
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'creations', label: 'Creations' },
  { id: 'automations', label: 'Automations' },
  { id: 'skills', label: 'Skills' },
  { id: 'connectors', label: 'Connectors' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'documents', label: 'Documents' },
]
const ALIASES = {
  kaby: ['Kaby', 'Kaby'],
  dashboards: ['Dashboards', 'Tableaux de bord'],
  'agent-teams': ['Agent Teams', 'Kybers', 'Équipes'],
  workspaces: ['Workspaces', 'Projets', 'Espaces'],
  creations: ['Creations', 'Créations', 'Livrables'],
  automations: ['Automations', 'Automatisations'],
  skills: ['Skills', 'Compétences'],
  connectors: ['Connectors', 'Connecteurs'],
  plugins: ['Plugins', 'Extensions'],
  documents: ['Documents', 'Docs'],
}

const wanted = ONLY ? ONLY.split(',').map((x) => x.trim()) : null

const clickSidebar = async (label) => {
  const js = `(() => {
    const want = ${JSON.stringify(label.toLowerCase())}
    const els = Array.from(document.querySelectorAll('[data-slot="sidebar"] button, [data-slot="sidebar"] [role=button]'))
    const hit = els.find((e) => {
      const r = e.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) return false
      return (e.innerText || e.getAttribute('aria-label') || '').trim().split('\\n')[0].trim().toLowerCase() === want
    })
    if (!hit) return false
    hit.scrollIntoView({ block: 'center' })
    const r = hit.getBoundingClientRect()
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
  })()`
  const pos = await ev(js, 6000)
  if (!pos) return false
  const { x, y } = JSON.parse(pos)
  for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 })
  await sleep(1200)
  return true
}

const openPageById = async (p) => {
  for (const label of (ALIASES[p.id] || [p.label])) if (await clickSidebar(label)) return true
  return false
}

// The home / chat screen first.
await waitFor(page, `document.body && document.body.innerText.length > 40`, 20000)
await sleep(1500)
await record('home')

for (const p of PAGES) {
  if (wanted && !wanted.includes(p.id)) continue
  if (!(await openPageById(p))) { console.log('✗ sidebar entry not found: ' + p.label); results.push({ id: p.id, error: 'sidebar entry not found' }); continue }
  await record(p.id)
}

// ── 2. settings pages ───────────────────────────────────────────────────────────
if (!wanted || wanted.includes('settings')) {
  if (await openSettings(page)) {
    await showAllSettingsPages(page)
    await sleep(800)
    const cells = (await ev(`JSON.stringify(Array.from(document.querySelectorAll('button[class*="navCell"]')).filter((b) => { const r = b.getBoundingClientRect(); return r.width > 4 && r.height > 4 }).map((b) => (b.innerText || '').trim().split('\\n')[0]))`)) || '[]'
    const names = JSON.parse(cells)
    writeFileSync(join(OUT, 'settings-cells.json'), JSON.stringify(names, null, 2))
    for (const name of names) {
      if (!(await goToSettingsPage(page, name, { settleMs: 900 }))) { console.log('✗ settings cell not reached: ' + name); continue }
      await record('set-' + slug(name))
    }
    // Frame diff across the settings pages.
    const frames = []
    for (const name of names) {
      if (!(await goToSettingsPage(page, name, { settleMs: 500 }))) continue
      frames.push({ label: name, frame: JSON.parse((await ev('JSON.stringify(window.__UXH__.frame())')) || '{}') })
    }
    const moved = JSON.parse((await ev(`JSON.stringify(window.__UXH__.diffFrames(${JSON.stringify(frames)}))`)) || '[]')
    writeFileSync(join(OUT, 'settings-frames.json'), JSON.stringify({ frames, moved }, null, 2))
    console.log('frame drift entries: ' + moved.length)
  } else {
    console.log('✗ settings did not open')
  }
}

// ── 3. right-pane tabs and the main dialogs (what opens, never what writes) ─────
if (!wanted || wanted.includes('dialogs')) {
  // back to a clean page
  await page.send('Page.navigate', { url: 'http://' + host + '/' })
  await sleep(3000)
  await waitFor(page, `document.body && document.body.innerText.length > 40`, 20000)
  await sleep(1000)
  // Right pane tabs (Slides, Bricks, Modeleur, Motion...) — open each tab body.
  const tabs = JSON.parse((await ev(`JSON.stringify(Array.from(document.querySelectorAll('[data-slot="rightbar"] button, [data-slot="rightbar.session"] button, [class*="rightPane"] button')).map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim().split('\\n')[0]).filter(Boolean).slice(0, 20))`)) || '[]')
  writeFileSync(join(OUT, 'right-tabs.json'), JSON.stringify(tabs, null, 2))
  for (const t of tabs) {
    if (await clickText(page, t)) { await sleep(900); await record('rp-' + slug(t)) }
  }
}

// ── 4. keyboard walk ────────────────────────────────────────────────────────────
if (KEYBOARD) {
  await page.send('Page.navigate', { url: 'http://' + host + '/' })
  await sleep(3000)
  await waitFor(page, `document.body && document.body.innerText.length > 40`, 20000)
  const tabWalk = async (id, steps = 30) => {
    const seen = []
    for (let i = 0; i < steps; i += 1) {
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
      await sleep(120)
      const info = JSON.parse((await ev(`JSON.stringify((() => {
        const a = document.activeElement
        if (!a || a === document.body) return { none: true }
        const r = a.getBoundingClientRect()
        const cs = getComputedStyle(a)
        return { tag: a.tagName, text: (a.innerText || a.getAttribute('aria-label') || a.getAttribute('placeholder') || '').replace(/\\s+/g, ' ').trim().slice(0, 50), w: Math.round(r.width), h: Math.round(r.height), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, shadow: cs.boxShadow.slice(0, 60) }
      }))()`)) || {})
      seen.push(info)
    }
    return seen
  }
  const keyboard = {}
  keyboard.home = await tabWalk('home', 40)
  writeFileSync(join(OUT, 'keyboard.json'), JSON.stringify(keyboard, null, 2))
  console.log('keyboard walk recorded: ' + keyboard.home.length + ' stops')
  await record('kbd-home')
}

writeFileSync(join(OUT, 'walk.json'), JSON.stringify(results, null, 2))
console.log('\nwalked ' + results.length + ' screens → ' + OUT)
await live.close()
