#!/usr/bin/env node
// End-to-end check of the Theme page (packages/kybernos-theme) in the REAL GUI —
// signed in through docs/dev/live-testing.md.
//
//   node scripts/check-theme-live.mjs [--shots <dir>] [--only <id,id,…>]
//   --only runs just those sections (the baseline always runs): render, skins, default, persist,
//   accent, wallpaper, font, advanced, colors, a11y, reset, gaps, sharing, library, gallery, verre, forme, access, boot, animation, runtime, light, french, disk.
//
// Named check-*, not test-*: CI runs every scripts/test-*.mjs on a runner with no `dsh web`,
// where a live script would exit 3 and fail the build (see docs/dev/live-testing.md, Traps).
//
// Everything is real: the page, the clicks (CDP mouse and key events), the DSH token
// layer (`themeSvc.overrideTokens`), the wallpaper <div>, the font style tag, the
// localStorage store (`kybernos.theme.v1`) and the reload at boot. Assertions read
// COMPUTED styles (`getComputedStyle(document.body)` for the --dsw-* tokens), not
// the source. No LLM, no stub.
//
// The page has no Simple/Advanced switch: eight vertical tabs, « Essentiel » (appearance, colour,
// background, font) open by default after every load.
//
// ⚠ The plugin calls DSH's own theme service, which PERSISTS two native preferences
// in the profile's configuration (`ui-theme` in cordis.patch.yml) — on this machine,
// not in the throw-away browser:
//   • the light/dark/system MODE  (setTheme)   — the test never leaves the mode it found:
//     it clicks only dark and mode-less themes while the mode is Dark, only mode-less
//     ones otherwise, and never the Light themes nor the System/Light buttons;
//   • the FONT SIZE              (setFontSize) — moved by ±1 px for a moment, then put back.
// A `finally` (and SIGINT/SIGTERM) verifies both, restores them if needed, reads the
// stored values back and shouts if they are not the ones found at the start.
// "Surprise me" (random mode) is never used. The DSH language is never touched.
//
// Blocks printed at the end, besides ✓/✗:
//   KNOWN GAPS (not counted as failures) — controls that call commit({ key }) with a
//     key that is not in DEF (so it is neither applied nor restored), the export limits;
//   OBSERVATIONS (not counted)           — behaviours worth knowing that are not clear bugs.
//
// Exit code: 0 all green, 1 a check failed, 3 inconclusive (no Chrome, no GUI, the Theme
// page cannot be reached).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage } from './live-page.mjs'
import { createFlow } from './lib-language-flow.mjs'
import { profilePatch } from './dsh-home.mjs'

const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
const only = args.indexOf('--only') >= 0 ? new Set(String(args[args.indexOf('--only') + 1]).split(',')) : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
const gaps = []
const gapRows = []     // every Advanced control measured by the « gaps » section
const workingControls = []  // …and the ones among them that really work
const observations = []
const short = (v, n = 320) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s === undefined ? 'undefined' : (s.length > n ? s.slice(0, n) + '…' : s) }
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + short(detail))) }
}
const note = (text) => { observations.push(text) }

// ── what the page calls things (English UI in this environment, French is the source) ──
const THEME_LABELS = ['Thème', 'Theme']
const STORE = 'kybernos.theme.v1'
const LIB = 'kybernos.theme.presets.v1'
const MODES = ['system', 'light', 'dark']
const TOKENS = [
  ['base', '--dsw-alias-bg-base'], ['l1', '--dsw-alias-bg-layer-1'], ['l2', '--dsw-alias-bg-layer-2'], ['l3', '--dsw-alias-bg-layer-3'],
  ['side', '--dsw-specific-sidebar-fill'], ['input', '--dsw-specific-input-major'], ['code', '--dsw-alias-markdown-code-block'],
  ['t1', '--dsw-alias-label-primary'], ['t2', '--dsw-alias-label-secondary'], ['t3', '--dsw-alias-label-tertiary'], ['t4', '--dsw-alias-label-caption'],
  ['link', '--dsw-alias-link'], ['err', '--dsw-alias-state-error-primary'], ['ok', '--dsw-alias-state-success-primary'],
  ['warn', '--dsw-alias-state-warn-primary'], ['biz', '--dsw-alias-state-business-primary'], ['brand', '--dsw-alias-brand-primary'],
]
const V = Object.fromEntries(TOKENS)
const TOKEN_VARS = TOKENS.map((t) => t[1])
const BORDER_VARS = ['--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-border-l3', '--dsw-alias-border-l4']

// The 18 ready-made themes, in the order of the page. `mode` is what clicking the theme does to the
// native mode: 'dark' (sets Dark), 'light' (sets Light — NEVER clicked here), null (mode-less pack,
// follows the current mode). `brand`/`base` are the dark-scheme values the layer must produce, `lbrand`/`lbase`
// the light-scheme ones (used only if the mode found is not Dark); null brand = neutral accent = the DSH value.
const SKINS = [
  { id: 'dsh', names: ['DSH default', 'Défaut DSH'], mode: 'dark' },
  { id: 'bleu', names: ['Deep blue', 'Bleu profond'], mode: 'dark', brand: '#4176E6', wp: true, vis: 70 },
  { id: 'aurore', names: ['Aurora', 'Aurore'], mode: 'dark', brand: '#2DD4BF', wp: true, vis: 60 },
  { id: 'nebuleuse', names: ['Nebula', 'Nébuleuse'], mode: 'dark', brand: '#A855F7', wp: true, vis: 60 },
  { id: 'ambre', names: ['Amber', 'Ambre'], mode: 'dark', brand: '#F59E0B', wp: true, vis: 60 },
  { id: 'oled', names: ['OLED midnight', 'Minuit OLED'], mode: 'dark', brand: null, wp: true, vis: 100 },
  { id: 'papier', names: ['Paper', 'Papier'], mode: 'light' },
  { id: 'clair', names: ['Clean light', 'Clair net'], mode: 'light' },
  { id: 'neutre', names: ['Neutral violet', 'Neutre violet'], mode: 'light' },
  { id: 'rose', names: ['Rose'], mode: 'light' },
  { id: 'kb-ember', names: ['Ember', 'Braise'], mode: null, base: '#191513', brand: '#e2805a', lbase: '#faf5ef', lbrand: '#c1552f' },
  { id: 'kb-stone-cloud', names: ['Stone & Cloud', 'Pierre & Nuage'], mode: null, base: '#141517', brand: '#94a3b8', lbase: '#fafafa', lbrand: '#64748b' },
  { id: 'kb-indigo-pulse', names: ['Indigo pulse', 'Pulsation indigo'], mode: null, base: '#131320', brand: '#818cf8', lbase: '#f8f8fd', lbrand: '#4f46e5' },
  { id: 'kb-midnight-pulse', names: ['Midnight pulse', 'Pulsation minuit'], mode: null, base: '#101623', brand: '#60a5fa', lbase: '#f6f8fc', lbrand: '#1e40af' },
  { id: 'kb-olive-grove', names: ['Olive grove', 'Olivaie'], mode: null, base: '#141610', brand: '#a3c060', lbase: '#f8faf1', lbrand: '#5f7a28' },
  { id: 'kb-aurora-bloom', names: ['Floral dawn', 'Aube florale'], mode: null, base: '#1a1216', brand: '#f472b6', lbase: '#fdf6f9', lbrand: '#d5286c' },
  { id: 'kb-sunset-dream', names: ['Twilight dream', 'Rêve de crépuscule'], mode: null, base: '#191510', brand: '#fbbf24', lbase: '#fdf9f1', lbrand: '#d97706' },
  { id: 'kb-plum-haze', names: ['Plum mist', 'Brume de prune'], mode: null, base: '#17121f', brand: '#a78bfa', lbase: '#faf7fe', lbrand: '#7c3aed' },
]
const SKIN = (id) => SKINS.find((d) => d.id === id)   // by id: the table grows, positions move
const CATS = [['colors'], ['gradients'], ['patterns'], ['images']]

// ── colours ────────────────────────────────────────────────────────────────────────
const rgbOf = (c) => {
  const s = String(c || '').trim().toLowerCase()
  let m = /^#([0-9a-f]{3,8})$/.exec(s)
  if (m) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = h.split('').map((d) => d + d).join('')
    if (h.length === 6 || h.length === 8) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
    return null
  }
  m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(s)     // what Chrome prints for a colour made with color-mix()
  if (m) return [Math.round(Number(m[1]) * 255), Math.round(Number(m[2]) * 255), Math.round(Number(m[3]) * 255)]
  m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(s)
  return m ? [Math.round(Number(m[1])), Math.round(Number(m[2])), Math.round(Number(m[3]))] : null
}
const sameColor = (a, b) => { const x = rgbOf(a), y = rgbOf(b); return x !== null && y !== null && x[0] === y[0] && x[1] === y[1] && x[2] === y[2] }
const luminance = (c) => { const p = rgbOf(c) || [0, 0, 0]; const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(p[0]) + 0.7152 * f(p[1]) + 0.0722 * f(p[2]) }
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }

// ── what the user's DSH has STORED (ui-theme in the profile's cordis.patch.yml) ───────
const storedUi = () => {
  try {
    const yml = profilePatch()
    if (yml === null) return null
    const at = yml.indexOf('- id: ui-theme')
    if (at < 0) return null
    const rest = yml.slice(at + 1)
    const next = rest.indexOf('\n- id:')
    const block = next < 0 ? rest : rest.slice(0, next)
    const pref = /preference:\s*(\S+)/.exec(block)
    const size = /fontSize:\s*(\d+)/.exec(block)
    return { preference: pref ? pref[1] : null, fontSize: size ? Number(size[1]) : null }
  } catch (e) { return null }
}

// ── uncaught exceptions and console errors, from a second CDP connection to the page ──
// (cdp-lib only keeps console.error; an exception thrown by a click handler would be missed.)
async function watchErrors(page) {
  const events = []
  const ws = new WebSocket(page.info.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })
  ws.addEventListener('message', (ev) => {
    let m = null
    try { m = JSON.parse(ev.data) } catch (e) { return }
    const text = (args) => (args || []).map((a) => (a.value !== undefined ? String(a.value) : (a.description || ''))).join(' ')
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {}
      events.push({ kind: 'exception', text: ((d.exception && d.exception.description) || d.text || '').slice(0, 500), url: d.url || '' })
    } else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'assert')) {
      events.push({ kind: 'console.error', text: text(m.params.args).slice(0, 500), url: '' })
    } else if (m.method === 'Log.entryAdded' && m.params.entry && m.params.entry.level === 'error') {
      events.push({ kind: 'log', text: String(m.params.entry.text || '').slice(0, 300), url: m.params.entry.url || '' })
    }
  })
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }))
  ws.send(JSON.stringify({ id: 2, method: 'Log.enable' }))
  return { events, close: () => { try { ws.close() } catch (e) { /* closed */ } } }
}
// An error is « the theme's » when it says so, when its stack names one of the plugin’s own functions, or when it is
// DSH’s slot boundary reporting that a Settings section crashed (the only section ever open during a run is the theme’s).
// A network error logged by Chrome (kind « log », e.g. « Failed to load resource: 400 » for a route that answers with a
// refusal) is never attributed by its URL alone.
const isThemeError = (ev) => (ev.kind === 'log' ? /\[kybernos-theme\]/.test(ev.text) : /\[kybernos-theme\]|kybernos-theme|kbth-/.test(ev.text + ' ' + ev.url)) ||
  (ev.kind !== 'log' && (/slot entry crashed in 'settings\.section'/.test(ev.text) ||
    /\bat (appliquer\w+|estNaturel|makeTheme|readState|writeState|legacyAdopt|skinPatch|skinDot|skinMeta|selecteurPolice|commit|Page)\b/.test(ev.text)))

// ═══ the browser ═════════════════════════════════════════════════════════════════════
const startUi = storedUi()
const live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const flow = await createFlow(page)
const { val, mouse } = flow
// A CDP command that never answers (a page stuck in a script) must not hang the run forever: give each one 20 s.
{
  const rawSend = page.send
  page.send = (method, params) => Promise.race([rawSend(method, params), new Promise((res) => setTimeout(() => res({ timeout: method }), 20000))])
}
// The animation runtime has a host half (disk). It is off for the whole run: every document gets the flag before
// its scripts run, so nothing of the animation tab can reach the user's disk. (The very first document is loaded
// inside openLivePage, before this can be installed; it can only GET a route that is not live, and nothing writes.)
const LD_KEY = 'kybernos.theme.loader.v1'
const LD_CACHE = 'kybernos.theme.loader.cache.v1'
const flagScript = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__KB_THEME_HOST_STORE__ = false' })
const FLAG_SRC = 'window.__KB_THEME_HOST_STORE__ = false'
let flagScriptId = flagScript && flagScript.result ? flagScript.result.identifier : null
await val(`localStorage.removeItem(${JSON.stringify(LD_KEY)}); localStorage.removeItem(${JSON.stringify(LD_CACHE)})`)
let watcher = null
try { watcher = await watchErrors(page) } catch (e) { console.log('  ! second CDP connection refused (' + e.message + '): only console.error will be caught') }
const errors = watcher !== null ? watcher.events : []
const themeErrorsSince = (mark) => errors.slice(mark).filter(isThemeError)
const shot = async (name) => { if (shotsDir !== null) await page.shot(shotsDir + '/' + name + '.png') }

// ── interaction helpers ──────────────────────────────────────────────────────────────
const until = async (fn, ms = 4000, step = 120) => {
  const end = Date.now() + ms
  let r = await fn()
  while (!r && Date.now() < end) { await sleep(step); r = await fn() }
  return r
}
const DEFAULT_STORE = { skin: 'dsh', acc: null, wp: 'none', fontText: 'dsh', fs: 15, ov: {}, contrastMode: 'standard' }
/** The stored state, or the defaults when nothing was committed yet (the page only writes on change). */
const storeOrDefault = async () => (await store()) || DEFAULT_STORE
const store = async () => {
  const raw = await val(`localStorage.getItem(${JSON.stringify(STORE)})`)
  if (raw === null || raw === undefined) return null
  try { return JSON.parse(raw) } catch (e) { return undefined }
}
const clicks = { skins: [], modeOutsideRestore: 0 }   // evidence for the safety check at the end
let startMode = (startUi !== null && MODES.indexOf(startUi.preference) >= 0) ? startUi.preference : null   // 'system' | 'light' | 'dark': what DSH has stored
let startFont = startUi !== null ? startUi.fontSize : null   // px DSH has stored
let modeSafe = startMode === 'dark'                           // true only when the mode found is Dark
let inRestore = false
const trail = []     // the last actions, to say what happened if the native mode ever moves
let aborting = false  // set by SIGINT / SIGTERM: the running section stops at its next action, the restore goes ahead alone
/** The test must never leave DSH’s native mode: before every action, the mode DSH reports is the one found at the start. */
const modeGuard = async () => {
  if (aborting && !inRestore) throw new Error('interrupted')
  if (startMode === null || inRestore) return
  const src = await val(`document.documentElement.getAttribute('data-ds-theme-source')`)
  if (src !== startMode) throw new Error('NATIVE MODE CHANGED: DSH reports "' + src + '" instead of "' + startMode + '" — last actions: ' + trail.slice(-5).join(' > '))
}
/** Real mouse click at the centre of the element `expr` evaluates to (after scrolling it into view);
 *  refuses to click if something else covers that point. */
const clickEl = async (expr) => {
  trail.push('click ' + expr.replace(/\s+/g, ' ').slice(0, 70))
  await modeGuard()
  await val(`(() => { const e = ${expr}; if (e) e.scrollIntoView({ block: 'center' }) })()`)
  await sleep(60)
  const pos = await val(`(() => { const e = ${expr}; if (!e) return null; const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return 'hidden'; const x = r.left + r.width / 2, y = r.top + r.height / 2; const t = document.elementFromPoint(x, y); const ms = ${Q.modeSeg}; return JSON.stringify({ x, y, ok: !!t && (e === t || e.contains(t) || t.contains(e)), over: t ? (t.tagName + '.' + String(t.className).slice(0, 40)) : null, // a theme of yours was saved from the look in use: it carries the mode that is already there (the library section checks it), so it is not a « Light theme » click
  skin: e.classList.contains('kbth-skin') && !e.closest('[data-kb=theme-mine]') ? (e.getAttribute('aria-label') || '?') : null, mode: !!ms && ms.contains(e) }) })()`)
  if (pos === null || pos === undefined) throw new Error('element not found: ' + expr.slice(0, 90))
  if (pos === 'hidden') throw new Error('element not visible: ' + expr.slice(0, 90))
  const p = JSON.parse(pos)
  if (!p.ok) throw new Error('click point covered by ' + p.over + ': ' + expr.slice(0, 90))
  if (p.skin !== null) clicks.skins.push(p.skin)
  if (p.mode && !inRestore) clicks.modeOutsideRestore += 1
  await mouse(p.x, p.y)
  return true
}
const KEYCODES = { Tab: 9, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13, Escape: 27 }
const press = async (key, times = 1, modifiers = 0) => {
  trail.push('key ' + key + (times > 1 ? ' x' + times : ''))
  await modeGuard()
  for (let i = 0; i < times; i += 1) {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: KEYCODES[key], nativeVirtualKeyCode: KEYCODES[key], modifiers })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: KEYCODES[key], nativeVirtualKeyCode: KEYCODES[key], modifiers })
  }
}
const focusEl = (expr) => val(`(() => { const e = ${expr}; if (e) { e.scrollIntoView({ block: 'center' }); e.focus() } return !!e })()`)
/** Type into a text field the way a user does (select all, then a real insertText). */
const typeInto = async (expr, text) => {
  trail.push('type ' + JSON.stringify(text))
  await modeGuard()
  await focusEl(expr)
  await val(`(() => { const e = ${expr}; if (e && e.select) e.select() })()`)
  await page.send('Input.insertText', { text })
  await sleep(150)
}
/** What a native colour picker does when the user picks a value (React listens to `input`). */
const setColor = async (expr, hex) => {
  trail.push('colour ' + hex)
  await modeGuard()
  return val(`(() => { const e = ${expr}; if (!e) return null; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, ${JSON.stringify(hex)}); e.dispatchEvent(new Event('input', { bubbles: true })); return e.value })()`)
}

// ── page-side expressions ────────────────────────────────────────────────────────────
const Q = {
  tabOn: `document.querySelector('.kbth-adv-tab.on')`,
  // The Mode row: the three-button segment reading System / Light / Dark (either language). Nothing else looks like it.
  modeSeg: `Array.from(document.querySelectorAll('.kbth-seg')).find((s) => s.children.length === 3 && /^(system|système)$/i.test(s.children[0].textContent.trim()) && /^(light|clair)$/i.test(s.children[1].textContent.trim()) && /^(dark|sombre)$/i.test(s.children[2].textContent.trim())) || null`,
  skin: (i) => `document.querySelectorAll('.kbth-skin')[${i}]`,
  dot: (i) => `document.querySelectorAll('.kbth-dots .kbth-dot')[${i}]`,
  cat: (i) => `document.querySelectorAll('.kbth-wpcats .kbth-cat')[${i}]`,
  wp: (i) => `document.querySelectorAll('.kbth-wps .kbth-wp')[${i}]`,
  tab: (i) => `document.querySelectorAll('.kbth-adv-tab')[${i}]`,
  pane: `document.querySelector('.kbth-adv-pane')`,
  // a slider found by the label of its block (EN or FR), within an optional scope expression
  slider: (re, scope = 'document') => `(() => { const b = Array.from(${scope}.querySelectorAll('.kbth-sl')).find((x) => ${re}.test((x.querySelector('.kbth-sl-lb') || { textContent: '' }).textContent)); return b ? b.querySelector('input') : null })()`,
  hexInput: `document.querySelector('.kbth-hex input')`,
  footBtn: (i) => `document.querySelectorAll('.kbth-foot button')[${i}]`,
}
// The eight tabs, in the order of the page (« Conversation » and « Terminal » are gone: nothing to apply in the web GUI).
const TAB = { essentiel: 0, verre: 1, couleurs: 2, texte: 3, animation: 4, accessibilite: 5, partage: 6, galerie: 7 }
const TAB_NAMES = [/^(essentiel|essentials?)$/i, /^(verre et fond|glass and background)$/i, /^(couleurs|colou?rs)$/i, /^(texte et forme|text and shape)$/i, /^animation$/i, /^(accessibilit[ée]|accessibility)$/i, /^(partage|sharing)$/i, /^(galerie|gallery)$/i]
const RE = { vis: '/visib/i', blur: '/blur|flou/i', tint: '/tint|teinte/i', size: '/size|taille/i',
  glass: '/flou du verre|glass blur/i', side: '/barre|sidebar/i', field: '/champ|field|input/i', menu: '/menu/i', imgblur: '/flou de l|image blur|blur of the image/i',
  bright: '/lumin|bright/i', contrast: '/^contrast/i', sat: '/satur/i', dark: '/assombr|darken/i' }
// toggles of the tabs after « Essentiel », found by the label (either language)
const TG = { lig: '/ligat/i', brand: '/logo/i', reduce: '/r[ée]duire|reduce/i', targets: '/44/', underline: '/soulign|underlin/i', cb: '/dalton|colou?r.?blind/i', linked: '/lier|link the sidebar|sidebar/i', mirror: '/miroir|mirror/i' }
const toggleQ = (key) => `Array.from(document.querySelectorAll('.kbth-adv-pane .kbth-toggle')).find((b) => ${TG[key]}.test(b.getAttribute('aria-label') || ''))`
const sliderQ = (key, scope) => Q.slider(RE[key], scope)

const readTokens = async () => {
  const arr = JSON.parse(await val(`JSON.stringify(${JSON.stringify(TOKEN_VARS)}.map((v) => getComputedStyle(document.body).getPropertyValue(v).trim()))`))
  const o = {}
  TOKEN_VARS.forEach((v, i) => { o[v] = arr[i] })
  return o
}
const readBorders = async () => JSON.parse(await val(`JSON.stringify(${JSON.stringify(BORDER_VARS)}.map((v) => getComputedStyle(document.body).getPropertyValue(v).trim()))`))
const readWallpaper = async () => {
  const r = await val(`(() => {
    const all = Array.from(document.body.children).filter((e) => e.tagName === 'DIV' && e.style.position === 'fixed' && e.style.zIndex === '-1')
    if (all.length === 0) return JSON.stringify({ count: 0 })
    const d = all[0], cs = getComputedStyle(d), r = d.getBoundingClientRect()
    return JSON.stringify({ count: all.length, opacity: cs.opacity, filter: cs.filter, position: cs.position, zIndex: cs.zIndex, pe: cs.pointerEvents, bgImage: cs.backgroundImage, bgColor: cs.backgroundColor, bgSize: cs.backgroundSize, bgRepeat: cs.backgroundRepeat, w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight })
  })()`)
  return JSON.parse(r)
}
const readFont = async () => JSON.parse(await val(`JSON.stringify({
  tags: Array.from(document.querySelectorAll('style')).filter((s) => s.dataset.plugin === '@local/kybernos-theme' && s.textContent.indexOf('--dsw-font-family') >= 0).map((s) => s.textContent.trim()),
  html: getComputedStyle(document.documentElement).getPropertyValue('--dsw-font-family').trim(),
  body: getComputedStyle(document.body).fontFamily,
  size: document.body.style.getPropertyValue('--dsh-content-font-size'),
})`))
const readPage = () => val(`JSON.stringify({
  open: !!document.querySelector('.kbth-page'),
  pills: Array.from(document.querySelectorAll('.kbth-foot .kbth-pill')).map((e) => e.textContent.trim()),
  skinPressed: Array.from(document.querySelectorAll('.kbth-skin')).map((e, i) => e.getAttribute('aria-pressed') === 'true' ? i : -1).filter((i) => i >= 0),
  current: (document.querySelector('.kbth-sum-n') || { textContent: '' }).textContent,
  summaryPills: Array.from(document.querySelectorAll('.kbth-sum-n .kbth-pill')).map((e) => e.textContent.trim()),
})`).then((s) => JSON.parse(s))
const modeInfo = async () => JSON.parse(await val(`(() => { const s = ${Q.modeSeg}; const i = s ? Array.from(s.children).findIndex((b) => b.getAttribute('aria-pressed') === 'true') : -2; return JSON.stringify({ idx: i, has: !!s, source: document.documentElement.getAttribute('data-ds-theme-source') }) })()`))
/** Waits until the Mode row, DSH’s own report (html[data-ds-theme-source]) and — once known — the mode found at the start all agree. */
const settleMode = async () => {
  // (On any tab but « Essentiel » there is no Mode row: DSH’s own report is then the only witness.)
  const ok = await until(async () => { const m = await modeInfo(); return (!m.has || MODES[m.idx] === m.source) && (startMode === null ? MODES.indexOf(m.source) >= 0 : m.source === startMode) }, 10000)
  await sleep(250)
  return !!ok
}
const alive = () => val(`document.body ? document.body.innerText.length : 0`)

/** Opens Settings › Theme from a clean page (and retries: the first click on the account footer can miss). */
const openTheme = async ({ fresh = false, settle = true } = {}) => {
  if (fresh) await val(`localStorage.removeItem(${JSON.stringify(STORE)}); localStorage.removeItem(${JSON.stringify(LIB)}); localStorage.removeItem(${JSON.stringify(LD_KEY)}); localStorage.removeItem(${JSON.stringify(LD_CACHE)})`)
  for (let i = 0; i < 3; i += 1) {
    await flow.openSettings(THEME_LABELS)
    if (await until(() => val(`!!document.querySelector('.kbth-page')`), 5000)) {
      try { await page.send('Page.bringToFront', {}); await page.send('Emulation.setFocusEmulationEnabled', { enabled: true }) } catch (e) { /* not available */ }
      if (settle && !(await settleMode())) throw new Error('the native mode never settled on "' + startMode + '" (nothing is clicked): ' + JSON.stringify({ ui: await modeInfo(), stored: storedUi(), level: (await store() || {}).level }))
      return true
    }
  }
  throw new Error('the Theme page did not open (3 tries)')
}
// A page that Chrome considers HIDDEN (display asleep, window occluded on a long unattended run) loses its animation clock
// and the plugin’s polls (it skips them on purpose): what depends on them is then not a verdict on the plugin.
let inconclusive = 0
const hiddenNow = async () => (await val(`document.visibilityState`)) === 'hidden'
const needVisible = async (what) => {
  if (!(await hiddenNow())) return true
  inconclusive += 1
  console.log('  ○ ' + what + ': skipped — the page is reported HIDDEN (display asleep or window occluded): Chrome pauses its animations and timers, so this proves nothing')
  return false
}
const reloadBoot = async () => { await flow.reload(); await sleep(300) }

// ── native state of the user's DSH: found at the start, put back at the end ───────────
const skipped = []
let restoring = false
const restoreUserSettings = async () => {
  if (restoring) return
  restoring = true
  inRestore = true
  try {
    if (startMode === null) return
    // Nothing moved? Then there is nothing to put back (DSH writes its configuration a moment after the change).
    await sleep(1200)
    const u = storedUi()
    if (u !== null && u.preference === startMode && u.fontSize === startFont && (await val(`document.documentElement.getAttribute('data-ds-theme-source')`)) === startMode) return
    // From a clean store, on « Essentiel » (open by default): the Mode row and the font-size slider are right there.
    await openTheme({ fresh: true, settle: false })
    await sleep(1500)
    const m = await modeInfo()
    if (m.has && MODES[m.idx] !== startMode) {
      console.log('  ! restoring the mode: pressing « ' + startMode + ' »')
      await clickEl(`(${Q.modeSeg}).children[${MODES.indexOf(startMode)}]`)
      await sleep(1500)
    }
    if (startFont !== null && startFont >= 12 && startFont <= 17) {
      const cur = (await readFont()).size
      if (cur !== startFont + 'px') {
        console.log('  ! restoring the font size: ' + cur + ' → ' + startFont + 'px')
        await focusEl(sliderQ('size'))
        await press('Home')
        await press('ArrowRight', startFont - 12)
        await sleep(1200)
      }
    }
  } catch (e) {
    console.log('  ! restoring the native settings failed: ' + short(e && e.message ? e.message : e))
  } finally {
    inRestore = false
    restoring = false
  }
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { aborting = true; await sleep(300); await restoreUserSettings(); await live.close(); process.exit(130) })

// ── a section = a titled group of checks; a crash inside it is one ✗ and the run goes on ──
const provoked = new Set() // indexes of errors the test caused on purpose
const section = async (id, title, fn) => {
  if (only !== null && !only.has(id) && id !== 'baseline') return
  console.log('\n── ' + title + ' ──')
  const lang0 = await val(`document.documentElement.lang`)
  const mark = errors.length
  try { await fn() } catch (e) {
    fail += 1
    console.log('  ✗ section stopped: ' + short(e && e.message && /^NATIVE MODE CHANGED/.test(e.message) ? e.message : (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ⏎ ') : e), 600))
    if (e && e.message && /^NATIVE MODE CHANGED/.test(e.message)) { console.log('  ! putting the native mode back at once'); await restoreUserSettings() }
  }
  const lang1 = await val(`document.documentElement.lang`)
  if (lang0 !== lang1) console.log('  ! the interface language changed during this section (' + lang0 + ' → ' + lang1 + '): another session switched DSH’s language (the page reloads); this section’s results may be invalid')
  const bad = errors.slice(mark).filter((ev, i) => isThemeError(ev) && !provoked.has(mark + i))
  check('no [kybernos-theme] console error or exception during this section', bad.length === 0, bad.slice(0, 3))
}

const skinLabels = async () => JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('.kbth-skin')).map((b) => b.getAttribute('aria-label') || ''))`))
/** Index of a theme dot by its name (either language), and whether it is safe to click: it must be a dark or a
 *  mode-less theme — never a Light one, whatever the table says. */
const findSkin = (labels, def) => {
  const idx = labels.findIndex((l) => def.names.some((n) => l.indexOf(n + ' — ') === 0))
  if (idx < 0) return { idx, safe: false, meta: null }
  const meta = labels[idx].split(' — ').slice(1).join(' — ')
  const both = /(Light|Clair) \+ (dark|sombre)/i.test(meta)
  const darkOnly = /(Dark|Sombre)/i.test(meta) && !/(Light|Clair)/i.test(meta)
  return { idx, meta, safe: both || (darkOnly && modeSafe) }
}

// ═════════════════════════════════════════════════════════════════════════════════════
let NATIVE = {}
let NATIVE_BORDERS = []
let NATIVE_FONT = ''
let baselineOk = false
try {
  await section('baseline', 'The native look and the mode, measured before anything is touched', async () => {
    // The mode found is what DSH STORED before this run started (read from its configuration, before any browser);
    // when that file is unreadable, it is what the GUI reports once it has settled.
    await openTheme({ fresh: true, settle: startMode !== null })
    if (startMode === null) { await sleep(4000); const m0 = await modeInfo(); startMode = m0.idx >= 0 ? MODES[m0.idx] : (MODES.indexOf(m0.source) >= 0 ? m0.source : null); modeSafe = startMode === 'dark' }
    const w0 = errors.length
    await val(`console.error('[kybernos-theme] watcher self-test (expected: this one is the check’s own)')`)
    await sleep(300)
    for (let k = w0; k < errors.length; k += 1) provoked.add(k)
    check('the error watcher works: a console.error tagged [kybernos-theme] is caught and attributed to the plugin', errors.slice(w0).some(isThemeError), errors.slice(w0))
    check('this run keeps the animation tab off the disk: window.__KB_THEME_HOST_STORE__ is false in the reloaded page', (await val(`window.__KB_THEME_HOST_STORE__`)) === false)
    const m = await modeInfo()
    const fontNow = (await readFont()).size
    if (startFont === null && /^\d+px$/.test(fontNow)) startFont = parseInt(fontNow, 10)
    check('the mode found is readable, and the Mode row, DSH’s own report (html[data-ds-theme-source]) and the stored preference all agree on it', startMode !== null && m.source === startMode && MODES[m.idx] === startMode, { m, stored: startUi })
    console.log('  · native mode found: ' + startMode + (modeSafe ? ' → every dark and mode-less theme will be exercised' : ' → NOT Dark: only mode-less themes, « DSH default » and « Reset all » are skipped (they force Dark)') + '; native font size: ' + startFont + ' px (the plugin ADOPTS DSH’s size at boot; the test moves it by 1 px for a moment and puts the found size back)')
    NATIVE = await readTokens()
    NATIVE_BORDERS = await readBorders()
    const wp = await readWallpaper()
    const font = await readFont()
    NATIVE_FONT = font.html
    check('the 17 tokens are read from the computed style of <body> (all non-empty)', TOKEN_VARS.every((v) => NATIVE[v] !== ''), NATIVE)
    check('fresh browser: no wallpaper <div>, no theme font tag, no layer yet', wp.count === 0 && font.tags.length === 0, { wp, tags: font.tags })
    const st = await store()
    check('fresh browser: nothing stored but the defaults', st === null || (st.skin === 'dsh' && st.acc === null && st.wp === 'none' && Object.keys(st.ov).length === 0), st)
    baselineOk = true
    console.log('  · native: brand ' + NATIVE[V.brand] + ' · base ' + NATIVE[V.base] + ' · label ' + NATIVE[V.t1] + ' · font size ' + fontNow)
  })
  if (!baselineOk || startMode === null) {
    console.error('○ inconclusive: the Theme page could not be reached or the native mode could not be read — nothing was measured')
    if (watcher !== null) watcher.close()
    await live.close()
    process.exit(3)
  }

  // ═══ 1. the page ═══════════════════════════════════════════════════════════════════
  await section('render', 'The Theme page renders', async () => {
    await openTheme({ fresh: true })
    await shot('01-essentiel')
    const j = JSON.parse(await val(`JSON.stringify({
      title: (document.querySelector('.kbth-title') || { textContent: '' }).textContent.trim(),
      switchLike: !!document.querySelector('.kbth-head .kbth-seg') || Array.from(document.querySelectorAll('.kbth-page button')).some((b) => /^(simple|avanc[ée]e?|advanced)$/i.test(b.textContent.trim())),
      sub: (document.querySelector('.kbth-sub') || { textContent: '' }).textContent.trim(),
      tabs: Array.from(document.querySelectorAll('.kbth-adv-tab')).map((b) => { const r = b.getBoundingClientRect(); return { text: b.textContent.trim(), on: b.classList.contains('on'), pressed: b.getAttribute('aria-pressed'), x: Math.round(r.left), y: Math.round(r.top) } }),
      mode: Array.from((${Q.modeSeg}).children).map((b) => b.getAttribute('aria-pressed')),
      skins: document.querySelectorAll('.kbth-skin:not(.kbth-skin-add)').length,
      skinNamed: Array.from(document.querySelectorAll('.kbth-skin:not(.kbth-skin-add)')).every((b) => (b.getAttribute('aria-label') || '').indexOf(' — ') > 0 && b.querySelector('.kbth-skin-dot') && b.querySelector('.kbth-skin-name')),
      dots: document.querySelectorAll('.kbth-dots .kbth-dot').length,
      pipette: document.querySelectorAll('.kbth-sw input[type=color]').length,
      hex: document.querySelectorAll('.kbth-hex input').length,
      cats: document.querySelectorAll('.kbth-wpcats .kbth-cat').length,
      tiles: document.querySelectorAll('.kbth-wps .kbth-wp').length,
      fsbtn: (document.querySelector('.kbth-fsbtn') || { textContent: '' }).textContent.trim(),
      fsOpen: (document.querySelector('.kbth-fsbtn') || { getAttribute: () => null }).getAttribute('aria-expanded'),
      sliders: Array.from(document.querySelectorAll('.kbth-slider')).map((s) => [s.min, s.max, s.value]),
    })`))
    const pg = await readPage()
    check('Settings › Theme opens on the real GUI (title « Theme »)', /^(theme|thème)$/i.test(j.title), j.title)
    check('there is no Simple / Advanced switch any more (no button of that name, no segment in the header)', j.switchLike === false, j.switchLike)
    check('eight tabs stacked vertically on the left, « Essentiel » the one open (and the only one pressed)', j.tabs.length === 8 && j.tabs.every((t) => t.x === j.tabs[0].x) && j.tabs.every((t, i) => i === 0 || t.y > j.tabs[i - 1].y) && j.tabs[0].on === true && j.tabs[0].pressed === 'true' && j.tabs.filter((t) => t.on).length === 1, j.tabs)
    check('the header says the basic settings are in « Essentiel »', /essentiel|essentials?/i.test(j.sub), j.sub)
    check('Mode row: System / Light / Dark, exactly one pressed, and it is the native one (' + startMode + ')', j.mode.filter((x) => x === 'true').length === 1 && j.mode[MODES.indexOf(startMode)] === 'true', j.mode)
    check('18 shipped theme dots (and the add button next to « My themes »), each with a coloured disc, a name and « name — mode · accent » as label', j.skins === 18 && j.skinNamed === true, { n: j.skins, named: j.skinNamed })
    const labels = await skinLabels()
    check('every theme of the catalogue is there, under its name', SKINS.every((d) => findSkin(labels, d).idx >= 0), labels)
    check('« DSH default » is the pressed one (and the only one)', pg.skinPressed.length === 1 && pg.skinPressed[0] === 0, pg.skinPressed)
    check('accent: a row of dots (' + j.dots + '), a colour picker and a hex field', j.dots >= 8 && j.pipette === 1 && j.hex === 1, j)
    check('wallpaper: 4 categories and a grid of tiles (no sliders while no wallpaper is set)', j.cats === 4 && j.tiles > 0 && j.sliders.length === 1, { cats: j.cats, tiles: j.tiles, sliders: j.sliders })
    check('font selector: a closed button showing the DSH default, and the text-size slider 12…17 showing DSH’s real size (' + startFont + ', adopted at boot)', /dsh/i.test(j.fsbtn) && j.fsOpen === 'false' && j.sliders[0][0] === '12' && j.sliders[0][1] === '17' && j.sliders[0][2] === String(startFont), { fsbtn: j.fsbtn, fsOpen: j.fsOpen, slider: j.sliders[0], dshStored: startFont })
    check('footer pill says the look is native (no layer)', /native|natif/i.test(pg.pills[0] || ''), pg.pills)
    const french = JSON.parse(await val(`JSON.stringify((() => { const t = document.querySelector('.kbth-page').innerText; const words = ['Visibilité', 'Flou', 'Teinte des surfaces', 'Petits carreaux', 'Personnalisé', 'jeton(s)', 'Opacité', 'Adoucit', 'Rechercher une police']; return words.filter((w) => t.indexOf(w) >= 0) })())`))
    if (french.length) note('the page is shown in English but still carries French text (' + french.join(', ') + '): hardcoded strings the live translation does not cover (see scripts/audit-i18n-live.mjs)')
  })

  // ═══ 2. ready-made themes ══════════════════════════════════════════════════════════
  await section('skins', 'Ready-made themes: stored, applied to the tokens, wallpaper, mode untouched', async () => {
    await openTheme({ fresh: true })
    const labels = await skinLabels()
    for (const def of SKINS) {
      if (def.id === 'dsh' || def.mode === 'light') continue
      if (def.mode === 'dark' && !modeSafe) { skipped.push(def.names[0]); continue }
      const f = findSkin(labels, def)
      if (!f.safe) { check(def.names[0] + ': safe to click (dark or mode-less according to its own label)', false, f); continue }
      await clickEl(Q.skin(f.idx))
      const st = await until(async () => { const s = await store(); return s && s.skin === def.id ? s : null }, 4000)
      const tok = await readTokens()
      const wp = await readWallpaper()
      const font = await readFont()
      const pg = await readPage()
      const mode = await modeInfo()
      const isDark = (await val(`document.body.hasAttribute('data-ds-dark-theme')`)) === true
      const wantBase = isDark ? def.base : def.lbase, wantBrand = isDark ? def.brand : (def.lbrand !== undefined ? def.lbrand : def.brand)
      const problems = []
      if (!st) problems.push('stored skin is not ' + def.id)
      else {
        if (st.mode !== startMode) problems.push('stored mode ' + st.mode)
        if (def.mode === null && Object.keys(st.ov).length < 12) problems.push('pack palette not stored in ov (' + Object.keys(st.ov).length + ' keys)')
        if (def.mode !== null && def.brand && st.acc !== def.brand) problems.push('stored accent ' + st.acc)
      }
      if (wantBrand !== undefined && wantBrand !== null && !sameColor(tok[V.brand], wantBrand)) problems.push('brand ' + tok[V.brand] + ' ≠ ' + wantBrand)
      if (def.brand === null && !sameColor(tok[V.brand], NATIVE[V.brand])) problems.push('neutral brand ' + tok[V.brand] + ' ≠ native ' + NATIVE[V.brand])
      if (wantBase && !sameColor(tok[V.base], wantBase)) problems.push('base ' + tok[V.base] + ' ≠ ' + wantBase)
      if (wantBase && sameColor(tok[V.base], NATIVE[V.base])) problems.push('base did not change vs native')
      if (def.wp) {
        if (wp.count !== 1) problems.push('wallpaper <div> count ' + wp.count)
        else {
          if (Math.abs(Number(wp.opacity) - def.vis / 100) > 0.011) problems.push('wallpaper opacity ' + wp.opacity + ' ≠ ' + def.vis / 100)
          if (wp.position !== 'fixed' || wp.zIndex !== '-1' || wp.pe !== 'none') problems.push('wallpaper not fixed/z-index -1/pointer-events none: ' + short([wp.position, wp.zIndex, wp.pe]))
        }
      } else if (wp.count !== 0) problems.push('unexpected wallpaper <div> (' + wp.count + ')')
      if (font.tags.length !== 0) problems.push('font tag present')
      if (pg.skinPressed.length !== 1 || pg.skinPressed[0] !== f.idx) problems.push('pressed dots ' + pg.skinPressed)
      if (!def.names.some((n) => pg.current.indexOf(n) >= 0)) problems.push('summary line: ' + pg.current.slice(0, 60))
      if (/native|natif/i.test(pg.pills[0] || '')) problems.push('pill still says native')
      if (mode.source !== startMode) problems.push('NATIVE MODE CHANGED to ' + mode.source)
      check(def.names[0] + (def.mode === null ? ' (mode-less pack)' : '') + ': skin stored, tokens' + (def.wp ? ', wallpaper' : '') + ', pill, native mode kept', problems.length === 0, problems)
    }
    await shot('02-skins')
    if (skipped.length) console.log('  · skipped (the mode is not Dark): ' + skipped.join(', '))
  })

  // ═══ 3. DSH default ═══════════════════════════════════════════════════════════════
  await section('default', '« DSH default » restores the native look', async () => {
    if (!modeSafe) { console.log('  · skipped: this theme forces Dark and the mode found is ' + startMode); return }
    await openTheme({ fresh: true })
    const labels = await skinLabels()
    const dsh = findSkin(labels, SKIN('dsh'))
    for (const from of [SKIN('bleu'), SKIN('kb-ember')]) { // a dark theme with wallpaper, then a pack whose palette lives in `ov`
      const f = findSkin(labels, from)
      await clickEl(Q.skin(f.idx))
      await until(async () => { const s = await store(); return s && s.skin === from.id }, 4000)
      const during = await readTokens()
      const changed = TOKEN_VARS.filter((v) => !sameColor(during[v], NATIVE[v])).length
      await clickEl(Q.skin(dsh.idx))
      await until(async () => { const s = await store(); return s && s.skin === 'dsh' }, 4000)
      await sleep(250)
      const st = await store()
      const tok = await readTokens()
      const wp = await readWallpaper()
      const font = await readFont()
      const pg = await readPage()
      const diff = TOKEN_VARS.filter((v) => !sameColor(tok[v], NATIVE[v]))
      check('from « ' + from.names[0] + ' » (' + changed + ' tokens differed from native): all 17 tokens are back to the values measured at the start', diff.length === 0, diff.map((v) => v + ' ' + tok[v] + ' ≠ ' + NATIVE[v]))
      check('… the wallpaper <div> is gone, no theme font tag, pill says native', wp.count === 0 && font.tags.length === 0 && /native|natif/i.test(pg.pills[0] || ''), { wp: wp.count, tags: font.tags, pill: pg.pills[0] })
      check('… stored state is the default one (skin dsh, no accent, no wallpaper, ov empty)', st.skin === 'dsh' && st.acc === null && st.wp === 'none' && Object.keys(st.ov).length === 0, st)
    }
  })

  // ═══ 4. persistence ═══════════════════════════════════════════════════════════════
  await section('persist', 'Persistence: after a reload everything is applied at boot, BEFORE Settings is opened', async () => {
    await openTheme({ fresh: true })
    const labels = await skinLabels()
    const A = modeSafe ? SKIN('nebuleuse') : SKIN('kb-ember')   // Nebula, or Ember when the mode is not Dark
    const fa = findSkin(labels, A)
    await clickEl(Q.skin(fa.idx))
    await until(async () => { const s = await store(); return s && s.skin === A.id })
    await reloadBoot()
    let t0 = Date.now()
    const darkNow = (await val(`document.body.hasAttribute('data-ds-dark-theme')`)) === true
    const wantBrand = darkNow ? A.brand : (A.lbrand !== undefined ? A.lbrand : A.brand)
    const want = wantBrand !== undefined && wantBrand !== null ? wantBrand : null
    const booted = await until(async () => { const t = await readTokens(); return want === null || sameColor(t[V.brand], want) ? t : null }, 6000)
    const wpA = await readWallpaper()
    check('theme « ' + A.names[0] + ' » re-applied at boot (tokens' + (A.wp ? ' + wallpaper' : '') + ') with the Settings closed — ' + (Date.now() - t0) + ' ms after the shell was ready',
      booted !== null && (A.wp ? wpA.count === 1 : wpA.count === 0) && (await val(`!document.querySelector('.kbth-page')`)) === true, { brand: booted && booted[V.brand], wp: wpA.count })
    const stA = await store()
    check('… and the stored state still names it', stA && stA.skin === A.id, stA)
    await openTheme()
    const pgA = await readPage()
    check('opening Settings › Theme afterwards shows it pressed', pgA.skinPressed.length === 1 && pgA.skinPressed[0] === fa.idx, pgA)

    // accent + wallpaper + font all together (the theme in use stays selected and reads « modified »)
    await openTheme({ fresh: true })
    const dotTitle = await val(`document.querySelectorAll('.kbth-dots .kbth-dot')[7].title`)
    await clickEl(Q.dot(7))
    await clickEl(Q.cat(1))
    const wpTitle = await val(`document.querySelectorAll('.kbth-wps .kbth-wp')[3].title`)
    await clickEl(Q.wp(3))
    await clickEl(`document.querySelector('.kbth-fsbtn')`)
    await typeInto(`document.querySelector('.kbth-fssearch')`, 'georgia')
    await clickEl(`document.querySelector('.kbth-fsopt')`)
    const stB = await until(async () => { const s = await store(); return s && s.fontText === 'georgia' && s.wp !== 'none' && s.acc ? s : null })
    check('accent « ' + dotTitle + ' », wallpaper « ' + wpTitle + ' » and font Georgia are stored', !!stB && sameColor(stB.acc, dotTitle), stB)
    await reloadBoot()
    t0 = Date.now()
    const tokB = await until(async () => { const t = await readTokens(); return sameColor(t[V.brand], dotTitle) ? t : null }, 6000)
    const wpB = await readWallpaper()
    const fontB = await readFont()
    check('after a reload, with Settings closed: accent in the tokens, wallpaper <div> present, Georgia in --dsw-font-family', !!tokB && wpB.count === 1 && /^Georgia/.test(fontB.html) && fontB.tags.length === 1, { brand: tokB && tokB[V.brand], wp: wpB.count, font: fontB.html })
    await openTheme()
    const ui = JSON.parse(await val(`JSON.stringify({ dot: Array.from(document.querySelectorAll('.kbth-dots .kbth-dot')).findIndex((d) => d.getAttribute('aria-pressed') === 'true'), tile: Array.from(document.querySelectorAll('.kbth-wps .kbth-wp')).findIndex((d) => d.getAttribute('aria-pressed') === 'true'), font: document.querySelector('.kbth-fsbtn').textContent.trim() })`))
    check('the Settings page then reflects it (accent dot, wallpaper tile and font button)', ui.dot === 7 && ui.tile === 3 && /georgia/i.test(ui.font), ui)
    await openTheme({ fresh: true })
    const nat = await readTokens()
    check('a browser without stored state boots back to the native tokens', TOKEN_VARS.every((v) => sameColor(nat[v], NATIVE[v])) && (await readWallpaper()).count === 0, TOKEN_VARS.filter((v) => !sameColor(nat[v], NATIVE[v])))
  })

  // ═══ 5. accent ════════════════════════════════════════════════════════════════════
  await section('accent', 'Accent: dots, hex field, invalid input, reset', async () => {
    await openTheme({ fresh: true })
    const titles = JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('.kbth-dots .kbth-dot')).map((d) => d.title))`))
    const bad = []          // a dot whose brand token is not its colour (or its colour lifted)
    const lifted = []       // dots whose colour was below 3:1 on layer 1 and had to be lightened
    const dim = []          // dots whose brand token stays under 3:1 on layer 1 (the bug that made the last dot invisible)
    const weakText = []     // dots whose accent TEXT (the ratio the page shows) is under 4.5:1
    for (let i = 0; i < titles.length; i += 1) {
      await clickEl(Q.dot(i))
      const st = await until(async () => { const s = await store(); return s && s.acc && sameColor(s.acc, titles[i]) ? s : null }, 3000)
      const tok = await readTokens()
      const pressed = JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('.kbth-dots .kbth-dot')).map((d, k) => d.getAttribute('aria-pressed') === 'true' ? k : -1).filter((k) => k >= 0))`))
      const raw = contrast(titles[i], tok[V.l1])
      const brandRatio = contrast(tok[V.brand], tok[V.l1])
      const wasLifted = raw < 3
      if (wasLifted) lifted.push(titles[i] + ' ' + raw.toFixed(2) + ' → ' + brandRatio.toFixed(2) + ':1')
      if (brandRatio < 3) dim.push(titles[i] + ' ' + brandRatio.toFixed(2) + ':1')
      // the token is the colour itself when it is readable enough, a lightened version of it otherwise
      const tokenOk = wasLifted ? (!sameColor(tok[V.brand], titles[i]) && brandRatio >= 3) : sameColor(tok[V.brand], titles[i])
      if (!st || !tokenOk || pressed.length !== 1 || pressed[0] !== i || st.skin !== 'dsh') bad.push({ dot: titles[i], store: st && st.acc, brand: tok[V.brand], pressed })
      const shown = JSON.parse(await val(`(() => { const e = document.querySelector('.kbth-acc-ratio'); return JSON.stringify(e ? { t: e.getAttribute('data-texte'), f: e.getAttribute('data-fond') } : null) })()`))
      if (shown === null || contrast(shown.t, shown.f) < 4.5) weakText.push(titles[i] + ' ' + (shown ? contrast(shown.t, shown.f).toFixed(2) : '?') + ':1')
      if (i === 1) {
        const hexShown = await val(`document.querySelector('.kbth-hex input').value`)
        const tabColor = await until(async () => { const c = await val(`getComputedStyle(${Q.tabOn}).color`); return sameColor(c, tok[V.brand]) ? c : null }, 1500) || await val(`getComputedStyle(${Q.tabOn}).color`)
        check('an accent dot: stored (the theme in use stays selected), brand token set, dot pressed, hex field follows (' + titles[i] + ')', bad.length === 0 && String(hexShown).toLowerCase() === titles[i].slice(1).toLowerCase(), { bad, hexShown })
        check('… and the page itself follows: the open tab takes the accent colour', sameColor(tabColor, tok[V.brand]), { tab: tabColor, brand: tok[V.brand] })
      }
    }
    check('every one of the ' + titles.length + ' accent dots sets the brand token: its own colour, or that colour lightened when it would be under 3:1', bad.length === 0, bad)
    check('no accent dot leaves the brand colour under 3:1 against layer 1 in Dark (the near-black last dot used to give 1.2:1)', dim.length === 0, dim)
    check('the accent TEXT the page shows (« pour le texte d’accent ») stays at 4.5:1 or more for every dot', weakText.length === 0, weakText)
    if (lifted.length) note('accent lifting: ' + lifted.length + ' dot(s) are lightened in Dark to reach 3:1 on layer 1 (' + lifted.join(', ') + ')')

    // typed hex: valid, invalid, reset
    await clickEl(Q.dot(0))
    await until(async () => (await store()).acc !== null)
    const before = await store()
    const brandBefore = (await readTokens())[V.brand]
    await typeInto(Q.hexInput, 'zz12')
    const badClass = await val(`document.querySelector('.kbth-hex').classList.contains('bad')`)
    const afterBad = await store()
    const brandBad = (await readTokens())[V.brand]
    check('typing an invalid hex (« zz12 ») marks the field .bad', badClass === true)
    check('… and changes nothing: same stored accent, same brand token', afterBad.acc === before.acc && sameColor(brandBad, brandBefore), { before: before.acc, after: afterBad.acc, brandBad })
    await typeInto(Q.hexInput, 'f0a')
    const st3 = await until(async () => { const s = await store(); return s.acc && sameColor(s.acc, '#ff00aa') ? s : null }, 2000)
    check('a valid 3-digit hex (« f0a ») is accepted, expanded to #ff00aa, and clears .bad', !!st3 && (await val(`!document.querySelector('.kbth-hex').classList.contains('bad')`)) === true, st3 && st3.acc)
    await typeInto(Q.hexInput, 'ec4899')
    const st6 = await until(async () => { const s = await store(); return s.acc && sameColor(s.acc, '#ec4899') ? s : null }, 2000)
    check('a valid 6-digit hex (« ec4899 ») sets the accent and the brand token', !!st6 && sameColor((await readTokens())[V.brand], '#ec4899'), st6 && st6.acc)
    await setColor(`document.querySelector('.kbth-sw input[type=color]')`, '#00ff88')
    const stp = await until(async () => { const s = await store(); return s.acc && sameColor(s.acc, '#00ff88') ? s : null }, 2000)
    check('the colour picker (native <input type=color>) sets the accent too', !!stp && sameColor((await readTokens())[V.brand], '#00ff88'), stp && stp.acc)
    await clickEl(`document.querySelector('.kbth-acc .kbth-btn')`)
    const stn = await until(async () => { const s = await store(); return s.acc === null ? s : null }, 2000)
    const tn = await readTokens()
    check('« Reset » returns to the neutral accent (acc null, brand token = the DSH brand, no dot pressed)', !!stn && sameColor(tn[V.brand], NATIVE[V.brand]) && (await val(`document.querySelectorAll('.kbth-dots .kbth-dot[aria-pressed=true]').length`)) === 0, { acc: stn && stn.acc, brand: tn[V.brand] })
    check('… and the Reset button disappears once there is nothing to reset', (await val(`!document.querySelector('.kbth-acc .kbth-btn')`)) === true)
  })

  /** How much of the main area shows the wallpaper layer: for each sampled point, is there an opaque element of the shell above it?
   *  (The <body>/<html> backgrounds are painted on the canvas, under the layer: they do not count.) */
  const coverage = async () => JSON.parse(await val(`(() => {
    const alpha = (c) => { const m = /^rgba?\\(([^)]+)\\)$/.exec(c); if (m) { const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1 } const k = /^color\\(.*\\/\\s*([\\d.]+%?)\\)$/.exec(c); if (k) return k[1].endsWith('%') ? parseFloat(k[1]) / 100 : parseFloat(k[1]); return c === 'transparent' ? 0 : 1 }
    let visible = 0, total = 0, big = 0
    const hiders = {}
    const main = (innerWidth - 340) * innerHeight
    for (let x = 340; x < innerWidth - 10; x += 60) for (let y = 20; y < innerHeight - 10; y += 60) {
      total += 1
      const hid = document.elementsFromPoint(x, y).find((e) => { if (e === document.body || e === document.documentElement) return false; const cs = getComputedStyle(e); return alpha(cs.backgroundColor) > 0.9 || cs.backgroundImage !== 'none' })
      if (!hid) visible += 1
      else {
        const r = hid.getBoundingClientRect()
        const isBig = r.width * r.height > 0.3 * main      // a page-wide surface, not a card or a button
        if (isBig) big += 1
        const k = (isBig ? 'LAYER ' : '') + hid.tagName + '.' + String(hid.className).slice(0, 24) + ' ' + getComputedStyle(hid).backgroundColor
        hiders[k] = (hiders[k] || 0) + 1
      }
    }
    return JSON.stringify({ total, visible, bigLayer: big, top: Object.entries(hiders).sort((a, b) => b[1] - a[1]).slice(0, 3) })
  })()`))
  // ═══ 6. wallpaper ═════════════════════════════════════════════════════════════════
  await section('wallpaper', 'Wallpaper: categories, tiles, visibility, blur, surface tint', async () => {
    await openTheme({ fresh: true })
    const seen = []
    for (let c = 0; c < CATS.length; c += 1) {
      await clickEl(Q.cat(c))
      await sleep(150)
      const n = await val(`document.querySelectorAll('.kbth-wps .kbth-wp').length`)
      const pressed = await val(`document.querySelectorAll('.kbth-wpcats .kbth-cat')[${c}].getAttribute('aria-pressed')`)
      const names = await val(`JSON.stringify(Array.from(document.querySelectorAll('.kbth-wps .kbth-wp')).map((b) => b.title))`)
      seen.push(names)
      const first = JSON.parse(await val(`JSON.stringify((() => { const b = document.querySelector('.kbth-wps .kbth-wp'); return { title: b.title, pressed: b.getAttribute('aria-pressed') } })())`))
      check('category ' + (c + 1) + ' (' + CATS[c][0] + '): pressed, and it lists its tiles (' + (n - 1) + ') after a first « None » tile (pressed while there is no wallpaper)', pressed === 'true' && n >= 5 && /^(none|aucun)$/i.test(first.title) && first.pressed === 'true', { pressed, n, first })
    }
    check('the four categories list different tiles', new Set(seen).size === 4)
    // one tile per category
    let lastWp = null
    for (let c = 0; c < CATS.length; c += 1) {
      await clickEl(Q.cat(c))
      await sleep(120)
      await clickEl(Q.wp(1))          // index 0 is the « None » tile
      const st = await until(async () => { const s = await store(); return s && s.wp !== 'none' && s.wp !== lastWp ? s : null }, 3000)
      lastWp = st && st.wp
      const seenWp = lastWp
      const wp = await readWallpaper()
      const ok = wp.count === 1 && wp.position === 'fixed' && wp.zIndex === '-1' && wp.pe === 'none' && wp.w === wp.vw && wp.h === wp.vh && (CATS[c][0] === 'colors' ? wp.bgColor !== 'rgba(0, 0, 0, 0)' : /gradient/.test(wp.bgImage))
      check('first tile of « ' + CATS[c][0] + ' » (' + seenWp + '): one fixed, full-window, click-through <div> at z-index -1 painting it; the theme in use stays selected', ok && st.skin === 'dsh', { wp, skin: st && st.skin })
    }
    // pattern tile: the shorthand size must survive (the grid is drawn by background-size)
    await clickEl(Q.cat(2))
    await sleep(120)
    await clickEl(Q.wp(1))
    await until(async () => (await store()).wp === 'carreaux', 2000)
    const wpP = await readWallpaper()
    const bandSize = await val(`getComputedStyle(document.querySelectorAll('.kbth-wps .kbth-wp-band')[1]).backgroundSize`)
    check('a pattern wallpaper keeps the tile size of its thumbnail (the grid is made by background-size)', wpP.bgSize === bandSize, { wallpaperDiv: wpP.bgSize, thumbnail: bandSize })
    // sliders
    const sliders = await val(`document.querySelectorAll('.kbth-slider').length`)
    check('picking a wallpaper reveals three sliders (visibility, blur, surface tint) above the text-size one', sliders === 4, sliders)
    await focusEl(sliderQ('vis'))
    await press('End'); await sleep(200)
    const w100 = await readWallpaper()
    await press('Home'); await sleep(200)
    const w0 = await readWallpaper()
    check('Visibility: End → opacity 1 (stored 100), Home → opacity 0 (stored 0)', w100.opacity === '1' && w0.opacity === '0' && (await store()).wpVis === 0, { w100: w100.opacity, w0: w0.opacity })
    const r = JSON.parse(await val(`(() => { const e = ${sliderQ('vis')}; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return JSON.stringify({ x: b.left + b.width * 0.25, y: b.top + b.height / 2 }) })()`))
    await mouse(r.x, r.y)
    await sleep(250)
    const wq = await readWallpaper()
    check('Visibility: a real mouse click at 25 % of the track sets about 0.25', Math.abs(Number(wq.opacity) - 0.25) < 0.1, wq.opacity)
    await focusEl(sliderQ('blur'))
    await press('End'); await sleep(200)
    const b40 = await readWallpaper()
    await press('Home'); await sleep(200)
    const b0 = await readWallpaper()
    check('Blur: End → filter blur(40px) (stored 40), Home → none', b40.filter === 'blur(40px)' && b0.filter === 'none' && (await store()).wpBlur === 0, { b40: b40.filter, b0: b0.filter })
    await focusEl(sliderQ('tint'))
    await press('Home'); await sleep(200)
    const base0 = (await readTokens())[V.base]
    await press('End'); await sleep(200)
    const base100 = (await readTokens())[V.base]
    check('Surface tint: End pulls the surface tokens towards the wallpaper colour (base token changes), Home gives them back', !sameColor(base0, base100) && sameColor(base0, NATIVE[V.base]), { home: base0, end: base100, native: NATIVE[V.base] })
    await press('Home'); await sleep(150)
    await shot('03-wallpaper')
    // removal: the first tile of every category is « None »
    const sliders1 = await val(`document.querySelectorAll('.kbth-slider').length`)
    await clickEl(Q.wp(0))
    const stNone = await until(async () => { const s = await store(); return s && s.wp === 'none' ? s : null }, 3000)
    const wpNone = await readWallpaper()
    const baseNone = (await readTokens())[V.base]
    const noneState = JSON.parse(await val(`JSON.stringify({ pressed: document.querySelector('.kbth-wps .kbth-wp').getAttribute('aria-pressed'), sliders: document.querySelectorAll('.kbth-slider').length })`))
    check('the « None » tile takes the wallpaper off without touching anything else: stored wp none, <div> gone, tile pressed, only the text-size slider left, surface tokens native', !!stNone && wpNone.count === 0 && noneState.pressed === 'true' && noneState.sliders === 1 && sliders1 === 4 && sameColor(baseNone, NATIVE[V.base]), { stNone: stNone && stNone.wp, wp: wpNone.count, noneState, sliders1, baseNone })
    await clickEl(Q.wp(1))
    await until(async () => (await readWallpaper()).count === 1, 3000)
    check('… and another tile puts a wallpaper back (one <div>, never two)', (await readWallpaper()).count === 1)
    // Is it SEEN? Close Settings and look, point by point, whether an opaque element of the shell sits on top of the layer
    // (the <body> background is painted on the canvas, under the layer: it does not count). The main area only (x > 340).
    await focusEl(sliderQ('vis')); await press('End'); await sleep(200)
    await press('Escape'); await sleep(700)
    const cov = await coverage()
    await shot('03b-wallpaper-home')
    check('the wallpaper is VISIBLE on the main screen at 100 % visibility: a clear majority of the sampled points of the main area have no opaque surface above the layer (' + cov.visible + ' of ' + cov.total + ')', cov.visible >= cov.total * 0.8, cov)
    for (const [names, label] of [[['Skills', 'Compétences'], 'Skills'], [['Creations', 'Créations', 'Livrables', 'Deliverables'], 'Creations'], [['Agent Teams', 'Équipes d’agents', 'Équipes'], 'Agent Teams']]) {
      let clicked = false
      for (const n of names) { if (await flow.click(n)) { clicked = true; break } }
      await sleep(1500)
      const cv = await coverage()
      check('… and on the « ' + label + ' » page: no page-wide opaque layer hides it (' + cv.bigLayer + ' of ' + cv.total + ' points), the wallpaper shows between the page’s own opaque cards (' + cv.visible + ' of ' + cv.total + ' points free)', clicked && cv.bigLayer <= cv.total * 0.05 && cv.visible >= cv.total * 0.3, { clicked, cv })
    }
  })

  // ═══ 7. font ═════════════════════════════════════════════════════════════════════
  await section('font', 'Font selector and text size', async () => {
    await openTheme({ fresh: true })
    const fs = '.kbth-fsbtn'
    const opts = () => val(`JSON.stringify(Array.from(document.querySelectorAll('.kbth-fsopt-name')).map((e) => e.textContent.trim()))`).then((s) => JSON.parse(s))
    const open = () => val(`document.querySelector('.kbth-fsbtn').getAttribute('aria-expanded')`)
    await clickEl(`document.querySelector('${fs}')`)
    await sleep(250)
    const all = await opts()
    check('opening the selector shows the search field (focused) and the list of families (' + all.length + ')', (await open()) === 'true' && all.length >= 20 && (await val(`document.activeElement && document.activeElement.classList.contains('kbth-fssearch')`)) === true, { open: await open(), n: all.length })
    await shot('04-font-open')
    await page.send('Input.insertText', { text: 'georgia' }); await sleep(200)
    let o = await opts()
    check('search « georgia » → only Georgia', o.length === 1 && /georgia/i.test(o[0]), o)
    await typeInto(`document.querySelector('.kbth-fssearch')`, 'systeme')
    const o1 = await opts()
    await typeInto(`document.querySelector('.kbth-fssearch')`, 'système')
    const o2 = await opts()
    check('search is accent-insensitive: « systeme » and « système » give the same, non-empty list', o1.length >= 2 && JSON.stringify(o1) === JSON.stringify(o2), { o1, o2 })
    await typeInto(`document.querySelector('.kbth-fssearch')`, 'mono')
    o = await opts()
    check('search « mono » → the families whose name contains it (Mono système, IBM Plex Mono, JetBrains Mono, SF Mono)', o.length === 4 && o.every((n) => /mono/i.test(n)), o)
    await typeInto(`document.querySelector('.kbth-fssearch')`, 'zzzzzz')
    check('no match → an « empty » message and no option', (await opts()).length === 0 && (await val(`!!document.querySelector('.kbth-fsempty')`)) === true)
    await press('Enter'); await sleep(200)
    check('Enter with no match changes nothing (panel stays, font unchanged)', (await open()) === 'true' && (await storeOrDefault()).fontText === 'dsh')
    await typeInto(`document.querySelector('.kbth-fssearch')`, '')
    const active = () => val(`Array.from(document.querySelectorAll('.kbth-fsopt')).findIndex((b) => b.getAttribute('data-actif') === '1')`)
    const a0 = await active()
    await press('ArrowDown', 2); await sleep(150)
    const a2 = await active()
    await press('ArrowUp'); await sleep(150)
    const a1 = await active()
    check('keyboard: the active option starts on the first one, ArrowDown ×2 → 3rd, ArrowUp → 2nd', a0 === 0 && a2 === 2 && a1 === 1, [a0, a2, a1])
    await press('Enter'); await sleep(300)
    let st = await until(async () => { const s = await store(); return s.fontText !== 'dsh' ? s : null }, 2000)
    let font = await readFont()
    check('Enter picks the active option (« ' + (st && st.fontText) + ' »): stored, panel closed, exactly one font style tag with its stack', !!st && (await open()) === 'false' && font.tags.length === 1 && font.tags[0].indexOf('system-ui') >= 0 && /system-ui/.test(font.html), { st: st && st.fontText, tags: font.tags, html: font.html })
    await clickEl(`document.querySelector('${fs}')`); await sleep(200)
    await press('Escape'); await sleep(350)
    const settingsOpen = await val(`!!document.querySelector('.kbth-page')`)
    check('Escape closes the font panel and keeps Settings open (a real key event on the focused search field; BUG if the key also reaches DSH’s dialog and closes the whole Settings)', settingsOpen === true && (await open()) === 'false', { settingsStillOpen: settingsOpen, panelExpanded: settingsOpen ? await open() : 'n/a (page gone)' })
    if (!settingsOpen) await openTheme()
    check('… and the current font is kept', (await store()).fontText === st.fontText)
    await clickEl(`document.querySelector('${fs}')`); await sleep(200)
    await clickEl(`document.querySelector('.kbth-title')`); await sleep(250)
    check('a click outside closes the panel', (await open()) === 'false' && (await val(`!document.querySelector('.kbth-fspanel')`)) === true)
    await clickEl(`document.querySelector('${fs}')`); await sleep(200)
    await typeInto(`document.querySelector('.kbth-fssearch')`, 'georgia')
    await clickEl(`document.querySelector('.kbth-fsopt')`)
    st = await until(async () => { const s = await store(); return s.fontText === 'georgia' ? s : null }, 2000)
    font = await readFont()
    check('clicking « Georgia »: stored, --dsw-font-family is Georgia on :root, the body text really uses it, one tag only', !!st && /^Georgia/.test(font.html) && /^Georgia/.test(font.body) && font.tags.length === 1, font)
    check('… the selector button is drawn in the chosen font and its caption shows the stack', (await val(`getComputedStyle(document.querySelector('${fs}')).fontFamily`)).indexOf('Georgia') === 0 && /Georgia/.test(await val(`document.querySelector('.kbth-fsmeta').textContent`)))
    await shot('05-font-georgia')
    await clickEl(`document.querySelector('${fs}')`); await sleep(200)
    await typeInto(`document.querySelector('.kbth-fssearch')`, 'mono')
    await clickEl(`document.querySelector('.kbth-fsopt')`)
    st = await until(async () => { const s = await store(); return s.fontText !== 'georgia' ? s : null }, 2000)
    font = await readFont()
    check('another family replaces the first one (still ONE tag, no stacking)', !!st && font.tags.length === 1 && /monospace/.test(font.html), { st: st && st.fontText, tags: font.tags })
    await clickEl(`document.querySelector('${fs}')`); await sleep(200)
    await typeInto(`document.querySelector('.kbth-fssearch')`, 'dsh')
    await clickEl(`document.querySelector('.kbth-fsopt')`)
    st = await until(async () => { const s = await store(); return s.fontText === 'dsh' ? s : null }, 2000)
    font = await readFont()
    check('« DSH (default) » removes the font tag and gives DSH’s own stack back', !!st && font.tags.length === 0 && font.html === NATIVE_FONT, { tags: font.tags, html: font.html })
    // text size: +1 px only (DSH persists it on this machine; the check puts it back below)
    const size0 = (await readFont()).size
    await focusEl(sliderQ('size'))
    await press('ArrowRight'); await sleep(400)
    const size1 = (await readFont()).size
    const st1 = await store()
    check('text size: ArrowRight → DSH’s own setFontSize (body --dsh-content-font-size ' + size0 + ' → ' + size1 + '), stored in fs', parseInt(size1, 10) === parseInt(size0, 10) + 1 && st1.fs === parseInt(size0, 10) + 1, { size0, size1, fs: st1.fs })
    const persisted = await until(() => { const u = storedUi(); return u !== null && u.fontSize === parseInt(size1, 10) }, 8000)
    check('… and DSH persisted it in the profile configuration (ui-theme.fontSize) — this is why the test puts it back', !!persisted, storedUi())
    await reloadBoot()
    await sleep(500)
    check('text size: after a reload, with Settings closed, DSH’s size is still ' + size1, (await readFont()).size === size1 && (await store()).fs === parseInt(size1, 10), { size: (await readFont()).size, fs: (await store()).fs })
    // A first start: no Theme state in the browser, while DSH’s own size is something else (here size1).
    await val(`localStorage.removeItem(${JSON.stringify(STORE)})`)
    await reloadBoot()
    await sleep(2000)
    const afterBoot = storedUi()
    check('booting with no Theme state leaves DSH’s own text size alone (it was ' + size1 + '; BUG if the default 15 is written over it)', afterBoot !== null && afterBoot.fontSize === parseInt(size1, 10), { nativeBefore: size1, storedAfterBoot: afterBoot && afterBoot.fontSize })
    const adopted = await store()
    check('… and it ADOPTS that size into its own store (fs = ' + parseInt(size1, 10) + ', not the default 15)', adopted !== null && adopted !== undefined && adopted.fs === parseInt(size1, 10), adopted && adopted.fs)
    await openTheme()
    const shown = await val(`document.querySelector('.kbth-slider') ? Array.from(document.querySelectorAll('.kbth-slider')).pop().value : null`)
    check('… and the text-size slider of the page shows it', shown === String(parseInt(size1, 10)), shown)
    // put it back: one step down, then wait until DSH has written it
    await focusEl(sliderQ('size'))
    await press('ArrowLeft'); await sleep(400)
    const back = await until(() => { const u = storedUi(); return u !== null && u.fontSize === parseInt(size0, 10) }, 8000)
    check('text size: ArrowLeft puts DSH’s size back to ' + size0 + ' (page and profile configuration)', (await readFont()).size === size0 && !!back, { page: (await readFont()).size, stored: storedUi() })
  })

  // ═══ 8. The eight tabs ═════════════════════════════════════════════════════════════
  const goTab = async (i) => {
    await clickEl(Q.tab(i))
    await until(() => val(`document.querySelectorAll('.kbth-adv-tab')[${i}].classList.contains('on')`), 2000)
    await sleep(200)
  }
  const tabInfo = async () => JSON.parse(await val(`JSON.stringify((() => { const p = document.querySelector('.kbth-adv-pane'); const q = (s) => p.querySelectorAll(s).length; const t = p.innerText; return {
    chars: t.length, skins: q('.kbth-skin:not(.kbth-skin-add)'), segs: q('.kbth-seg'), toggles: q('.kbth-toggle'), sliders: q('.kbth-slider'), colors: q('input[type=color]'), toks: q('.kbth-tok'),
    ansi: q('.kbth-ansi-swatch'), a11y: q('.kbth-a11y-row'), note: q('.kbth-note'), exportCode: q('.kbth-export-code'), fsbtn: q('.kbth-fsbtn'), term: q('.kbth-term-preview'),
    gpv: q('[data-kb=glass-preview]'), galState: q('[data-kb=theme-gal],[data-kb=theme-gal-loading],[data-kb=theme-gal-error],[data-kb=theme-gal-none]'), ldSummary: q('[data-kb=ld-summary]'), ldPane: q('[data-kb=ld-pane]'), ldPreview: q('[data-kb=ld-preview]'), ldAmb: q('[data-kb=ld-amb]'), ldSettings: q('[data-kb=ld-settings]'), slots: q('.kbth-lds'),
    broken: t.indexOf('undefined') >= 0 || t.indexOf('NaN') >= 0 || t.indexOf('[object') >= 0 } })())`))
  const TAB_ID = Object.keys(TAB)
  const TAB_EXPECT = {
    essentiel: (s) => s.skins === 18 && s.fsbtn === 1 && s.sliders >= 1 && s.ldSummary === 1,
    verre: (s) => s.sliders >= 10 && s.toggles === 2 && s.segs === 2 && s.gpv === 1,
    couleurs: (s) => s.toks === 7 && s.colors === 3 && s.segs === 1,
    texte: (s) => s.sliders === 1 && s.toggles === 2 && s.segs === 1,
    animation: (s) => s.ldPane === 1 && s.ldPreview === 1 && s.ldAmb === 1 && s.ldSettings === 1 && s.slots === 4,
    accessibilite: (s) => s.a11y === 6 && s.segs === 2 && s.toggles === 4,
    partage: (s) => s.exportCode >= 1 && s.segs === 1 && s.toggles === 0,
    // whatever the host answers: the grid, the loading placeholders or the error card — never an empty pane
    galerie: (s) => s.galState >= 1,
  }
  await section('advanced', 'The eight vertical tabs', async () => {
    await openTheme({ fresh: true })
    const tabs = JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('.kbth-adv-tab')).map((b) => { const r = b.getBoundingClientRect(); return { text: b.textContent.trim(), on: b.classList.contains('on'), x: Math.round(r.left), y: Math.round(r.top) } }))`))
    check('eight tabs, stacked vertically on the left, in the expected order (Essentiel, Verre et fond, Couleurs, Texte et forme, Animation, Accessibilité, Partage, Galerie — no Conversation, no Terminal)', tabs.length === 8 && tabs.every((t, i) => TAB_NAMES[i].test(t.text)) && tabs.every((t) => t.x === tabs[0].x) && tabs.every((t, i) => i === 0 || t.y > tabs[i - 1].y), tabs)
    check('… « Essentiel » is the one open by default', tabs[0].on === true && tabs.filter((t) => t.on).length === 1, tabs.map((t) => t.on))
    await goTab(2)
    const st = await store()
    check('the open tab is not stored: with « Colors » open, the state has no level / tab key', st === null || (st.level === undefined && st.advTab === undefined && st.tab === undefined), st)
    await openTheme()       // a plain reload: the stored state is kept
    check('… and after a reload « Essentiel » is open again', (await val(`Array.from(document.querySelectorAll('.kbth-adv-tab')).findIndex((b) => b.classList.contains('on'))`)) === 0)
    await shot('06-advanced')
    for (let i = 0; i < 8; i += 1) {
      const mark = errors.length
      await goTab(i)
      await sleep(250)
      const info = await tabInfo()
      const alive0 = await val(`!!document.querySelector('.kbth-page')`)
      check('tab ' + (i + 1) + ' « ' + tabs[i].text + ' » renders (' + TAB_ID[i] + '), nothing « undefined »/« NaN » in it, and no error', alive0 === true && info.chars > 40 && info.broken === false && TAB_EXPECT[TAB_ID[i]](info) && themeErrorsSince(mark).length === 0, { info, errors: themeErrorsSince(mark).slice(0, 2) })
    }
  })

  // ═══ 9. Advanced › Colors ═════════════════════════════════════════════════════════
  const uiTokens = async () => {
    // Advanced › Colors lists the 17 tokens, four categories at a time, with the hex the page computed for them.
    const out = {}
    for (let c = 0; c < 4; c += 1) {
      await clickEl(`document.querySelectorAll('.kbth-adv-pane .kbth-seg')[0].children[${c}]`)
      await sleep(200)
      const rows = JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('.kbth-tok')).map((t) => [t.querySelector('.kbth-tok-css').textContent.trim(), t.querySelector('.kbth-tok-hex').textContent.trim()]))`))
      for (const [css, hex] of rows) out[css] = hex
    }
    return out
  }
  const editor = (i) => `document.querySelectorAll('.kbth-adv-editor input[type=color]')[${i}]`
  await section('colors', 'Advanced › Colors: what the page shows is what is applied; token editor and its reset', async () => {
    if (!modeSafe) { console.log('  · skipped: the editor checks below address the Dark half of each token, and the mode found is ' + startMode); return }
    await openTheme({ fresh: true })
    await goTab(2)
    // (a) with the native look: the page shows its own « official » palette
    const ui0 = await uiTokens()
    const mism = TOKEN_VARS.filter((v) => !sameColor(ui0[v], NATIVE[v]))
    check('the page lists the 17 tokens, four categories (Surfaces, Text, States, Brand)', Object.keys(ui0).length === 17 && TOKEN_VARS.every((v) => ui0[v] !== undefined), Object.keys(ui0))
    if (mism.length) note('native look: ' + mism.length + ' of the 17 tokens differ between the palette the page shows and the value DSH really has (' + mism.map((v) => v.replace('--dsw-', '') + ' ' + ui0[v] + ' vs ' + NATIVE[v]).join('; ') + ') — choosing any theme swaps DSH’s value for the page’s')
    // (b) with a pack applied: UI and DOM agree on all 17
    await goTab(0)
    const labels = await skinLabels()
    const ember = findSkin(labels, SKIN('kb-ember'))
    await clickEl(Q.skin(ember.idx))
    await until(async () => (await store()).skin === 'kb-ember', 3000)
    await goTab(2)
    let ui = await uiTokens()
    let dom = await readTokens()
    let diff = TOKEN_VARS.filter((v) => !sameColor(ui[v], dom[v]))
    check('with « Ember » applied, the 17 hex codes the page shows equal the 17 computed tokens', diff.length === 0, diff.map((v) => v + ' page ' + ui[v] + ' / dom ' + dom[v]))
    if (modeSafe) {
      await goTab(0)
      await clickEl(Q.skin(findSkin(labels, SKIN('nebuleuse')).idx))
      await until(async () => (await store()).skin === 'nebuleuse', 3000)
      await focusEl(sliderQ('tint'))
      await press('End'); await sleep(250)
      await goTab(2)
      ui = await uiTokens()
      dom = await readTokens()
      diff = TOKEN_VARS.filter((v) => !sameColor(ui[v], dom[v]))
      check('… and with « Nebula » + surface tint 100 % (surfaces mixed towards the wallpaper)', diff.length === 0 && !sameColor(dom[V.base], NATIVE[V.base]), diff.map((v) => v + ' page ' + ui[v] + ' / dom ' + dom[v]))
    }
    // (c) editing one token from a clean state
    await openTheme({ fresh: true })
    await goTab(2)
    await clickEl(`document.querySelectorAll('.kbth-tok')[1]`)   // Surfaces › Layer 1
    await sleep(200)
    const sel = await val(`JSON.stringify({ label: document.querySelector('.kbth-adv-label').textContent, css: document.querySelector('.kbth-adv-css').textContent, pressed: document.querySelector('.kbth-tok[aria-pressed=true] .kbth-tok-css').textContent })`)
    check('selecting a token row opens its editor (Layer 1 → --dsw-alias-bg-layer-1) with a light and a dark picker', JSON.parse(sel).css === V.l1 && (await val(`document.querySelectorAll('.kbth-adv-editor input[type=color]').length`)) === 2, sel)
    check('… and no « Reset » button while the token is untouched', (await val(`!document.querySelector('.kbth-adv-editor .kbth-btn')`)) === true)
    await setColor(editor(1), '#102030')
    let stc = await until(async () => { const s = await store(); return s && s.ov && s.ov['dark:l1'] ? s : null }, 2500)
    check('picking a dark value: stored as ov["dark:l1"], the theme in use stays selected, and the live token follows', !!stc && stc.ov['dark:l1'] === '#102030' && stc.skin === 'dsh' && sameColor((await readTokens())[V.l1], '#102030'), stc && { ov: stc.ov, skin: stc.skin })
    const pills = (await readPage()).pills
    check('the footer counts tokens, not halves: one scheme of one token edited → « 1 jeton(s) retouché(s) » (it used to say 0.5)', /^1\s/.test(pills[1] || ''), pills)
    check('a « Reset » button appears for that token', (await val(`!!document.querySelector('.kbth-adv-editor .kbth-btn')`)) === true)
    await setColor(editor(0), '#eef0f5')
    await until(async () => { const s = await store(); return s.ov['light:l1'] }, 2000)
    check('picking the light value too is stored separately (the dark token is untouched in Dark), and it is still ONE token in the footer', (await store()).ov['light:l1'] === '#eef0f5' && sameColor((await readTokens())[V.l1], '#102030') && /^1\s/.test((await readPage()).pills[1] || ''), (await readPage()).pills)
    await clickEl(`document.querySelector('.kbth-adv-editor .kbth-btn')`)
    stc = await until(async () => { const s = await store(); return s && s.ov['dark:l1'] === undefined && s.ov['light:l1'] === undefined ? s : null }, 2500)
    check('« Reset » removes both halves from ov and the live token is back to the DSH value; the footer says 0', !!stc && sameColor((await readTokens())[V.l1], NATIVE[V.l1]) && (await val(`!document.querySelector('.kbth-adv-editor .kbth-btn')`)) === true && /^0\s/.test((await readPage()).pills[1] || ''), stc && stc.ov)
    // a text token and the brand token go through the same door
    await clickEl(`document.querySelectorAll('.kbth-adv-pane .kbth-seg')[0].children[1]`)  // Text
    await clickEl(`document.querySelectorAll('.kbth-tok')[1]`)  // Secondary text
    await setColor(editor(1), '#aabbcc')
    await until(async () => { const s = await store(); return s.ov['dark:t2'] }, 2000)
    check('a text token (secondary text) can be edited: --dsw-alias-label-secondary follows', sameColor((await readTokens())[V.t2], '#aabbcc'), (await readTokens())[V.t2])
    await clickEl(`document.querySelectorAll('.kbth-adv-pane .kbth-seg')[0].children[3]`)  // Brand
    await clickEl(`document.querySelectorAll('.kbth-tok')[0]`)
    await setColor(editor(1), '#22c55e')
    await until(async () => { const s = await store(); return s.ov['dark:brand'] }, 2000)
    check('the brand token can be edited too (--dsw-alias-brand-primary), with acc still null; two tokens are now retouched', sameColor((await readTokens())[V.brand], '#22c55e') && (await store()).acc === null && /^2\s/.test((await readPage()).pills[1] || ''), { brand: (await readTokens())[V.brand], pills: (await readPage()).pills })
    // reset inside a mode-less pack: does it go back to the pack or to DSH?
    await openTheme({ fresh: true })
    await goTab(0)
    const lab2 = await skinLabels()
    await clickEl(Q.skin(findSkin(lab2, SKIN('kb-ember')).idx))
    await until(async () => (await store()).skin === 'kb-ember', 3000)
    await goTab(2)
    await clickEl(`document.querySelectorAll('.kbth-tok')[1]`)
    await setColor(editor(1), '#102030')
    await until(async () => (await store()).ov['dark:l1'] === '#102030', 2000)
    await clickEl(`document.querySelector('.kbth-adv-editor .kbth-btn')`)
    await sleep(300)
    const l1 = (await readTokens())[V.l1]
    if (sameColor(l1, NATIVE[V.l1])) note('Colors › Reset on a token of a pack (Ember, layer 1) goes back to the DSH value ' + l1 + ', not to the pack’s own #201b18 — the pack’s value is deleted with the edit')
  })

  // ═══ 10. Advanced › Accessibility ═════════════════════════════════════════════════
  await section('a11y', 'Advanced › Accessibility: contrast levels', async () => {
    if (!modeSafe) { console.log('  · skipped: the contrast ratios below are measured in Dark, and the mode found is ' + startMode); return }
    await openTheme({ fresh: true })
    await goTab(TAB.accessibilite)
    const level = (i) => `document.querySelectorAll('.kbth-adv-pane .kbth-seg')[0].children[${i}]`
    const measure = async () => {
      const t = await readTokens()
      const rows = JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('.kbth-a11y-row')).map((r) => [r.querySelector('.kbth-a11y-hex').textContent.trim(), r.querySelector('.kbth-a11y-ratio').textContent.trim()]))`))
      return { t, rows, b: await readBorders() }
    }
    const res = {}
    for (const [i, id, label] of [[0, 'standard', 'Standard'], [1, 'plus', 'Reinforced'], [2, 'max', 'Maximum'], [0, 'standard', 'Standard again']]) {
      await clickEl(level(i))
      await until(async () => (await storeOrDefault()).contrastMode === id, 2500)
      await sleep(300)
      const m = await measure()
      res[label] = m
      const pressed = await val(`Array.from(document.querySelectorAll('.kbth-adv-pane .kbth-seg')[0].children).map((b) => b.getAttribute('aria-pressed') === 'true' ? 1 : 0).join('')`)
      check('level « ' + label + ' »: button pressed, stored contrastMode = ' + id, pressed === ['100', '010', '001', '100'][['Standard', 'Reinforced', 'Maximum', 'Standard again'].indexOf(label)] && (await storeOrDefault()).contrastMode === id, { pressed })
    }
    const r = (m, k) => contrast(m.t[V[k]], m.t[V.l1])
    const S = res['Standard'], P = res['Reinforced'], M = res['Maximum'], S2 = res['Standard again']
    for (const k of ['t2', 't3', 't4']) {
      check('contrast: ' + V[k].replace('--dsw-alias-', '') + ' against layer 1 rises Standard → Reinforced → Maximum (' + r(S, k).toFixed(1) + ' → ' + r(P, k).toFixed(1) + ' → ' + r(M, k).toFixed(1) + ':1)', r(P, k) > r(S, k) + 0.1 && r(M, k) > r(P, k) + 0.1, [r(S, k), r(P, k), r(M, k)])
    }
    check('contrast: links are lifted to at least 4.5:1 at Reinforced and 7:1 at Maximum (' + r(P, 'link').toFixed(1) + ' and ' + r(M, 'link').toFixed(1) + ':1)', r(P, 'link') >= 4.5 && r(M, 'link') >= 7, [r(P, 'link'), r(M, 'link')])
    check('contrast: … and « Reinforced » does not make links LESS contrasted than Standard (' + r(S, 'link').toFixed(1) + ' → ' + r(P, 'link').toFixed(1) + ':1; Standard keeps DSH’s own ' + S.t[V.link] + ', the layer swaps in its own and only walks it up to 4.5)', r(P, 'link') >= r(S, 'link') - 0.01, { standard: S.t[V.link], reinforced: P.t[V.link], maximum: M.t[V.link] })
    check('contrast: the primary text keeps at least the Standard ratio at every level', r(P, 't1') >= r(S, 't1') - 0.01 && r(M, 't1') >= r(P, 't1') - 0.01, [r(S, 't1'), r(P, 't1'), r(M, 't1')])
    check('back to Standard (layer removed again): the 17 tokens are the native ones', TOKEN_VARS.every((v) => sameColor(S2.t[v], NATIVE[v])), TOKEN_VARS.filter((v) => !sameColor(S2.t[v], NATIVE[v])))
    // what the table shows vs what is applied (Maximum, Dark)
    const keys = ['t1', 't2', 't3', 't4', 'link', 'brand']
    const hexOk = keys.every((k, i) => sameColor(M.rows[i][0], M.t[V[k]]))
    check('Maximum: the six hex codes of the table equal the applied tokens', hexOk, keys.map((k, i) => k + ' ' + M.rows[i][0] + ' / ' + M.t[V[k]]))
    const shown = keys.map((k, i) => parseFloat(M.rows[i][1]))
    const real = keys.map((k) => contrast(M.t[V[k]], M.t[V.l1]))
    const wrong = keys.filter((k, i) => Math.abs(shown[i] - real[i]) > 0.2)
    check('Maximum: the ratio shown beside each colour is the ratio of the colours applied in Dark (BUG otherwise: it is computed from the LIGHT scheme)', wrong.length === 0, wrong.map((k) => k + ' shows ' + shown[keys.indexOf(k)] + ':1, real ' + real[keys.indexOf(k)].toFixed(1) + ':1'))
    const bordersMoved = BORDER_VARS.filter((v, i) => !sameColor(M.b[i], NATIVE_BORDERS[i]) && M.b[i] !== NATIVE_BORDERS[i])
    if (bordersMoved.length === 0) note('Accessibility › Contrast says « readability of texts and borders », but the border tokens (--dsw-alias-border-l1…l4) are identical at Standard and Maximum: the layer only maps 17 tokens, none of them a border')
  })

  // ═══ 11. Reset all ════════════════════════════════════════════════════════════════
  const DEFAULTS = { mode: 'dark', skin: 'dsh', acc: null, wp: 'none', wpVis: 60, wpBlur: 0, tint: 0, fs: 15, fontText: 'dsh', contrastMode: 'standard', cbSafe: false,
    glassEffect: 'frosted', glassBlur: 18, sidebarLinked: true, sidebarOpacity: 25, fieldOpacity: 20, floatOpacity: 10, bgBrightness: 100, bgContrast: 100, bgSaturation: 100, bgDarken: 0, bgFit: 'cover', bgMirror: false,
    ligatures: true, radius: 'standard', showBrand: true, reduceMotion: false, focusRing: 'accent', largeTargets: false, underlineLinks: false }
  await section('reset', '« Reset all » returns to the native state', async () => {
    if (!modeSafe) { console.log('  · skipped: it sets Dark and the mode found is ' + startMode); return }
    await openTheme({ fresh: true })
    // dirty everything on « Essentiel », then three other tabs
    const labels = await skinLabels()
    await clickEl(Q.skin(findSkin(labels, SKIN('nebuleuse')).idx))
    await clickEl(Q.dot(5))
    await clickEl(Q.cat(1)); await clickEl(Q.wp(3))
    await clickEl(`document.querySelector('.kbth-fsbtn')`)
    await typeInto(`document.querySelector('.kbth-fssearch')`, 'georgia')
    await clickEl(`document.querySelector('.kbth-fsopt')`)
    await goTab(TAB.accessibilite); await clickEl(`document.querySelectorAll('.kbth-adv-pane .kbth-seg')[0].children[1]`)
    await goTab(TAB.texte); await clickEl(`document.querySelectorAll('.kbth-adv-pane .kbth-seg')[0].children[2]`)   // Rayons › Doux (outside DEF)
    await goTab(TAB.verre); await focusEl(sliderQ('vis', Q.pane)); await press('End')
    await sleep(300)
    const dirty = await store()
    check('before the reset the state is really dirty (accent, wallpaper, font, contrast, an Advanced control)', dirty.acc !== null && dirty.wp !== 'none' && dirty.fontText === 'georgia' && dirty.contrastMode === 'plus' && dirty.radius === 'soft', dirty)
    await clickEl(Q.footBtn(0))
    await sleep(500)
    const st = await store()
    const bad = Object.keys(DEFAULTS).filter((k) => JSON.stringify(st[k]) !== JSON.stringify(DEFAULTS[k]))
    check('« Reset all »: the ' + (Object.keys(DEFAULTS).length + 1) + ' stored keys are the defaults (and ov is empty)', bad.length === 0 && Object.keys(st.ov).length === 0, bad.map((k) => k + '=' + JSON.stringify(st[k])))
    const tok = await readTokens()
    const wp = await readWallpaper()
    const font = await readFont()
    await goTab(0)
    const pg = await readPage()
    check('… the 17 tokens are the native ones, no wallpaper <div>, no font tag, the pill says native, and the page still shows its tabs', TOKEN_VARS.every((v) => sameColor(tok[v], NATIVE[v])) && wp.count === 0 && font.tags.length === 0 && /native|natif/i.test(pg.pills[0] || '') && (await val(`document.querySelectorAll('.kbth-skin:not(.kbth-skin-add)').length`)) === 18, { diff: TOKEN_VARS.filter((v) => !sameColor(tok[v], NATIVE[v])), wp: wp.count, tags: font.tags, pill: pg.pills[0] })
    check('… « DSH default » is the pressed theme again; the native mode is still ' + startMode, pg.skinPressed.length === 1 && pg.skinPressed[0] === 0 && (await modeInfo()).source === startMode, pg.skinPressed)
    const junk = Object.keys(st).filter((k) => DEFAULTS[k] === undefined && k !== 'ov')
    check('… and nothing is left behind in the stored state: « Reset all » REPLACES it (a key outside the defaults, such as radius, would otherwise survive)', junk.length === 0, junk.map((k) => k + '=' + JSON.stringify(st[k])))
    await goTab(3)
    const radius = await val(`JSON.stringify(Array.from(document.querySelectorAll('.kbth-adv-pane .kbth-seg')[0].children).map((b) => b.getAttribute('aria-pressed')))`)
    check('… the Advanced controls are back to their defaults too (Texte et forme › Radii shows the middle choice)', radius === JSON.stringify(['false', 'true', 'false']), radius)
    await reloadBoot()
    const natReload = await readTokens()
    check('after a reload the native look stays', TOKEN_VARS.every((v) => sameColor(natReload[v], NATIVE[v])) && (await readWallpaper()).count === 0)
  })

  // ═══ 12. KNOWN GAPS: controls whose key is outside DEF ════════════════════════════
  const FINGERPRINT = `(() => {
    const out = {}
    const props = (tag, cs) => { for (let i = 0; i < cs.length; i += 1) { const n = cs[i]; if (n.charAt(0) === '-' && n.charAt(1) === '-') out[tag + ' ' + n] = cs.getPropertyValue(n) } }
    props('body', getComputedStyle(document.body)); props('html', getComputedStyle(document.documentElement))
    const attrs = (el) => Array.from(el.attributes).filter((a) => a.name !== 'data-input-modality').map((a) => a.name + '=' + a.value).sort().join(' ')
    out['html@'] = attrs(document.documentElement); out['body@'] = attrs(document.body)
    const sheets = {}
    document.querySelectorAll('style').forEach((s) => { const k = s.dataset.plugin || 'anonymous'; sheets[k] = (sheets[k] || 0) + s.textContent.length })
    out['styles'] = JSON.stringify(sheets)
    let hsh = 5381; document.querySelectorAll('style').forEach((s) => { if (s.dataset.plugin === '@local/kybernos-theme') { const t = s.textContent; for (let i = 0; i < t.length; i += 1) hsh = ((hsh * 33) ^ t.charCodeAt(i)) >>> 0 } })
    out['themeCss'] = String(hsh)
    out['adopted'] = Array.from(document.adoptedStyleSheets).map((s) => s.cssRules.length).join(',')
    const b = getComputedStyle(document.body), h = getComputedStyle(document.documentElement)
    out['text'] = [b.fontSize, b.lineHeight, b.fontFamily, b.letterSpacing, b.fontVariantLigatures, b.zoom, h.fontSize, h.zoom, h.scrollWidth].join('|')
    const w = Array.from(document.body.children).find((e) => e.tagName === 'DIV' && e.style.position === 'fixed' && e.style.zIndex === '-1')
    out['wallpaper'] = w ? w.getAttribute('style') : ''
    out['classes'] = document.documentElement.className + '|' + document.body.className
    const sample = Array.from(document.querySelectorAll('nav button, [role=dialog] nav a')).slice(0, 6).map((e) => { const c = getComputedStyle(e); return [c.borderRadius, c.height, c.paddingTop, c.fontSize, c.transitionDuration, c.outlineWidth].join(',') })
    out['nav'] = sample.join(';')
    return JSON.stringify(out)
  })()`
  const fingerprint = async () => JSON.parse(await val(FINGERPRINT))
  const diffKeys = (a, b, ignore) => Object.keys(Object.assign({}, a, b)).filter((k) => a[k] !== b[k] && !ignore.has(k))
  const DESCRIBE = `JSON.stringify(Array.from(document.querySelector('.kbth-adv-pane').querySelectorAll('.kbth-toggle, .kbth-slider, .kbth-seg')).map((e, i) => {
    const kind = e.classList.contains('kbth-toggle') ? 'toggle' : (e.classList.contains('kbth-slider') ? 'slider' : 'seg')
    const row = e.closest('.kbth-row')
    const label = kind === 'seg' ? ((row && row.querySelector('.kbth-lb')) ? row.querySelector('.kbth-lb').textContent.trim() : '?') : e.getAttribute('aria-label')
    const state = kind === 'toggle' ? e.getAttribute('aria-checked') : (kind === 'slider' ? e.value : String(Array.from(e.children).findIndex((b) => b.getAttribute('aria-pressed') === 'true')))
    return { i, kind, label, state, n: kind === 'seg' ? e.children.length : 0, min: e.min, max: e.max, skip: kind === 'slider' && e.min === '12' && e.max === '17' }
  }))`
  const ctrl = (i) => `document.querySelector('.kbth-adv-pane').querySelectorAll('.kbth-toggle, .kbth-slider, .kbth-seg')[${i}]`
  // The controls of the tabs after « Essentiel » that write a setting. (Partage › Format is the format of the export preview, a
  // view option that is not stored; the text-size slider drives DSH's own size and has its own section.)
  const SWEEP_TABS = [[TAB.verre, 'Glass and background'], [TAB.texte, 'Text and shape'], [TAB.accessibilite, 'Accessibility']]
  await section('gaps', 'Every control of the tabs after « Essentiel »: is it kept after a reload AND does it change the page?', async () => {
    // a wallpaper, so that the glass and image controls have something to act on
    await val(`localStorage.setItem(${JSON.stringify(STORE)}, ${JSON.stringify(JSON.stringify({ skin: 'custom', wp: 'aurore', wpVis: 100 }))})`)
    await openTheme()
    check('the starting point has a wallpaper (aurore, visibility 100) applied at boot', (await readWallpaper()).count === 1)
    const f0 = await fingerprint(); await sleep(500); const f1 = await fingerprint()
    const noise = new Set(diffKeys(f0, f1, new Set()))
    console.log('  · DOM fingerprint: ' + Object.keys(f0).length + ' measures (custom properties of <html>/<body>, attributes, style tags, text metrics, wallpaper, nav metrics), ' + noise.size + ' unstable ones ignored')
    for (const [tab, tabName] of SWEEP_TABS) {
      await goTab(tab)
      const list = JSON.parse(await val(DESCRIBE)).filter((c) => !c.skip)
      // sliders and segments first, toggles last: « Lier la barre latérale » off would make the sidebar slider inert
      list.sort((x, y) => (x.kind === 'toggle' ? 1 : 0) - (y.kind === 'toggle' ? 1 : 0))
      for (const c of list) {
        const before = await fingerprint()
        const sBefore = await store()
        let want
        if (c.kind === 'toggle') { await clickEl(ctrl(c.i)); want = c.state === 'true' ? 'false' : 'true' }
        else if (c.kind === 'seg') { const to = c.state === String(c.n - 1) ? 0 : c.n - 1; await clickEl(`${ctrl(c.i)}.children[${to}]`); want = String(to) }
        else { await focusEl(ctrl(c.i)); const atMax = c.state === c.max; await press(atMax ? 'Home' : 'End'); want = atMax ? c.min : c.max }
        await sleep(260)
        const after = await fingerprint()
        const sAfter = await store()
        const now = JSON.parse(await val(DESCRIBE)).find((x) => x.i === c.i)
        const keys = Object.keys(Object.assign({}, sBefore, sAfter)).filter((k) => JSON.stringify((sBefore || {})[k]) !== JSON.stringify((sAfter || {})[k]))
        gapRows.push({ tab, tabName, c, want, uiFollows: !!now && now.state === want, storedKeys: keys, dom: diffKeys(before, after, noise) })
      }
    }
    await shot('07-gaps')
    check('every control follows the click inside the session (toggle flips, segment moves, slider moves)', gapRows.every((g) => g.uiFollows), gapRows.filter((g) => !g.uiFollows).map((g) => g.tabName + ' › ' + g.c.label))
    await reloadBoot()
    await openTheme()                            // keeps the stored state
    for (const [tab] of SWEEP_TABS) {
      await goTab(tab)
      const list = JSON.parse(await val(DESCRIBE))
      for (const g of gapRows.filter((x) => x.tab === tab)) { const now = list.find((x) => x.i === g.c.i); g.restored = !!now && now.state === g.want }
    }
    const yn = (b) => (b ? 'yes' : 'NO ')
    const w = Math.max(7, ...gapRows.map((g) => (g.tabName + ' › ' + g.c.label).length))
    console.log('  ' + 'control'.padEnd(w) + '  persisted  applied   key')
    for (const g of gapRows) console.log('  ' + (g.tabName + ' › ' + g.c.label).padEnd(w) + '  ' + yn(g.restored).padEnd(10) + ' ' + yn(g.dom.length > 0).padEnd(9) + ' ' + (g.storedKeys.join(',') || '—'))
    const dead = gapRows.filter((g) => !(g.restored === true && g.dom.length > 0))
    check('all ' + gapRows.length + ' controls are PERSISTED (their position is back after a reload) and APPLIED (the page changes when they move)' + (dead.length ? ' — ' + dead.length + ' do not' : ''), dead.length === 0, dead.map((g) => g.tabName + ' › ' + g.c.label + ' [' + g.storedKeys.join(',') + '] persisted=' + g.restored + ' applied=' + (g.dom.length > 0)))
    check('… and each one writes a key the plugin knows (no key outside the state)', gapRows.every((g) => g.storedKeys.length >= 1), gapRows.filter((g) => g.storedKeys.length === 0).map((g) => g.c.label))
    workingControls.push(...gapRows.map((g) => g.c.label))
  })

  // ═══ 13. Advanced › Sharing ═══════════════════════════════════════════════════════
  await section('sharing', 'Advanced › Sharing: the current look exports (3 real formats), copy; a file imports as a THEME in My themes and applies nothing', async () => {
    await openTheme({ fresh: true })
    await clickEl(Q.dot(2))                                          // a state that is not the default
    await clickEl(Q.cat(1)); await clickEl(Q.wp(3))
    await until(async () => { const s0 = await store(); return s0 && s0.wp !== 'none' && s0.acc !== null }, 3000)
    await goTab(TAB.partage)
    await val(`document.querySelector('[data-kb=theme-export-fold]').open = true`)     // the file of the current look is folded away
    await val(`window.__copied = []; Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: (t) => { window.__copied.push(String(t)); return Promise.resolve() } })`)
    const fmtBtn = (f) => `document.querySelectorAll('.kbth-adv-pane .kbth-seg')[0].children[${f}]`
    const view = async () => JSON.parse(await val(`JSON.stringify({ file: document.querySelectorAll('.kbth-export-bar span')[0].textContent, lines: (document.querySelector('[data-kb=theme-export-lines]') || { textContent: '' }).textContent, code: (document.querySelector('[data-kb=theme-export]') || { textContent: '' }).textContent })`))
    const views = {}
    const copied = {}
    for (const [f, id] of [[0, 'yaml'], [1, 'json'], [2, 'css']]) {
      await clickEl(fmtBtn(f)); await sleep(200)
      views[id] = await view()
      const n0 = Number(await val(`window.__copied.length`))
      await clickEl(`document.querySelector('[data-kb=theme-copy]')`); await sleep(250)
      copied[id] = { n: Number(await val(`window.__copied.length`)) - n0, arg: await val(`window.__copied[window.__copied.length - 1]`) }
    }
    check('the three formats show DIFFERENT real content in [data-kb=theme-export] (YAML, JSON and CSS never equal)', new Set([views.yaml.code, views.json.code, views.css.code]).size === 3 && views.yaml.code.length > 100 && views.json.code.length > 100 && views.css.code.length > 100, { yaml: views.yaml.code.slice(0, 40), json: views.json.code.slice(0, 40), css: views.css.code.slice(0, 40) })
    check('… each looks like what it claims to be: YAML has « theme: » and « skin: », JSON parses, CSS has :root and body[data-ds-dark-theme] blocks', /(^|\n)theme:\n/.test(views.yaml.code) && /skin:/.test(views.yaml.code) && (() => { try { return typeof JSON.parse(views.json.code) === 'object' } catch (e) { return false } })() && /:root/.test(views.css.code) && /body\[data-ds-dark-theme\]/.test(views.css.code))
    check('the file name follows the format: dsh-theme.yml / dsh-theme.json / dsh-theme.css', views.yaml.file === 'dsh-theme.yml' && views.json.file === 'dsh-theme.json' && views.css.file === 'dsh-theme.css', [views.yaml.file, views.json.file, views.css.file])
    check('the « N lines » label is the real line count of the text shown (each format)', ['yaml', 'json', 'css'].every((f) => Number((views[f].lines.match(/\d+/) || ['-1'])[0]) === views[f].code.split('\n').length), ['yaml', 'json', 'css'].map((f) => views[f].lines + ' / ' + views[f].code.split('\n').length))
    check('« Copy » calls navigator.clipboard.writeText exactly once with EXACTLY the preview text, for each format', ['yaml', 'json', 'css'].every((f) => copied[f].n === 1 && copied[f].arg === views[f].code), ['yaml', 'json', 'css'].map((f) => f + ': calls ' + copied[f].n + ', same text ' + (copied[f].arg === views[f].code)))
    const declarations = (views.css.code.match(/--dsw-[a-z0-9-]+\s*:/g) || [])
    check('the CSS export has 17 tokens × 2 schemes (34 declarations, 17 distinct names)', declarations.length === 34 && new Set(declarations).size === 17, { declarations: declarations.length, distinct: new Set(declarations).size })

    // The old export (the whole look, no frame) still imports: as a THEME, not over the current look.
    const exported = JSON.parse(views.json.code)
    await goTab(TAB.essentiel)
    await clickEl(Q.dot(7)); await until(async () => !sameColor((await store()).acc, exported.acc), 3000)
    const changed = await store()
    await goTab(TAB.partage)
    const rowsN = async () => Number(await val(`document.querySelectorAll('[data-kb=theme-row]').length`))
    const libJson = async () => { const raw = await val(`localStorage.getItem(${JSON.stringify(LIB)})`); try { return raw ? JSON.parse(raw) : null } catch (e) { return undefined } }
    const importFile = (name, text) => val(`(() => { const input = document.querySelector('.kbth-adv-pane input[type=file]'); const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, { type: 'application/json' })); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); return !!input })()`)
    const importNote = async () => JSON.parse(await val(`JSON.stringify((() => { const n = document.querySelector('[data-kb=theme-note]'); return n ? { text: n.textContent.trim(), color: getComputedStyle(n).color, cls: n.className } : null })())`))
    const snapshot = async () => ({ store: JSON.stringify(await store()), tokens: JSON.stringify(await readTokens()), lib: JSON.stringify(await libJson()) })
    const picker = JSON.parse(await val(`JSON.stringify((() => { const i = document.querySelector('.kbth-adv-pane input[type=file]'); return { accept: i ? i.accept : null, label: i ? i.closest('label').textContent.trim() : '', hook: i ? i.getAttribute('data-kb') : null } })())`))
    check('the file picker only offers .json (accept names .json and no other format; the label names no other format)', /\.json/.test(picker.accept || '') && !/yml|yaml|css/i.test(picker.accept || '') && /\.json/.test(picker.label) && !/yml|yaml|css/i.test(picker.label) && picker.hook === 'theme-import', picker)
    const before = await snapshot()
    await importFile('dsh-theme.json', views.json.code)
    await until(async () => (await rowsN()) === 1, 4000)
    const after = await snapshot()
    const note1 = await importNote()
    check('importing the JSON export ADDS one theme to My themes and applies nothing: the stored state and the 17 tokens are exactly what they were', (await rowsN()) === 1 && after.store === before.store && after.tokens === before.tokens && JSON.parse(after.lib).presets.length === 1, { rows: await rowsN(), sameStore: after.store === before.store, sameTokens: after.tokens === before.tokens })
    check('… the note is green and says it is in My themes, not applied, and that an old file brings the whole look', note1 !== null && /kbth-ok/.test(note1.cls) && /Mes thèmes|My themes/i.test(note1.text) && /pas appliqu|not applied/i.test(note1.text) && /ancien|old/i.test(note1.text), note1)
    check('… the new row is named « Thème importé » and says where it comes from (« importé »)', /Thème importé|Imported theme/i.test(await val(`document.querySelector('[data-kb=theme-row] .kbth-trow-n').textContent`)) && /import/i.test(await val(`document.querySelector('[data-kb=theme-row] .kbth-trow-n').textContent`)))
    await clickEl(`document.querySelector('[data-kb=theme-row] [data-kb=theme-apply]')`)
    await until(async () => { const s = await store(); return s && sameColor(s.acc, exported.acc) }, 3000)
    const back = await store()
    const low = (v) => JSON.stringify(v, (k, x) => (typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x) ? x.toLowerCase() : x))
    const settingKeys = Object.keys(exported).filter((k) => !['skin', 'fs', 'showBrand'].includes(k))
    const differs = settingKeys.filter((k) => low(back[k]) !== low(exported[k]))
    check('« Appliquer » on that row gives back the exported look: after changing the accent, the same stored values (all ' + settingKeys.length + ' keys a theme carries)', !sameColor(changed.acc, exported.acc) && differs.length === 0, { differs: differs.map((k) => k + ': ' + JSON.stringify(back[k]) + ' vs ' + JSON.stringify(exported[k])) })
    check('… the text size and the brand toggle are not part of a theme (they stay as they were)', back.fs === changed.fs && back.showBrand === changed.showBrand, { fs: [changed.fs, back.fs] })

    // Anything that is not a theme file is refused, visibly, and changes nothing.
    const mark = errors.length
    for (const [name, text, what] of [
      ['theme.yml', 'theme:\n  skin: kb-ember\n  accent: "#ff0000"\n', 'a .yml file'],
      ['theme.css', ':root { --dsw-alias-brand-primary: #ff0000; }\n', 'a .css file'],
      ['broken.json', '{ this is not json', 'invalid JSON'],
      ['array.json', '[1, 2, 3]', 'a JSON array'],
      ['null-ov.json', '{"ov":null}', '{"ov": null} (used to crash the whole section)'],
      ['unknown.json', '{"exportFormat":"css","level":"x","bogus":1,"glassBlurr":3}', 'JSON with only unknown keys'],
      ['framed-empty.json', '{"format":"kybernos-theme-preset","version":1,"name":"Vide","settings":{"evil":1}}', 'a framed theme with nothing a theme may carry'],
    ]) {
      const a = await snapshot()
      await importFile(name, text); await sleep(700)
      const b = await snapshot()
      const n = await importNote()
      const problems = []
      if (a.store !== b.store) problems.push('the stored state changed')
      if (a.tokens !== b.tokens) problems.push('the tokens changed')
      if (a.lib !== b.lib) problems.push('the library changed')
      if (n === null) problems.push('no visible note'); else if (!/rien|nothing|non reconnu|not recogni/i.test(n.text) || !/kbth-bad/.test(n.cls)) problems.push('the note does not say (in red) that it was refused: ' + n.text)
      if (!(await val(`!!document.querySelector('.kbth-page')`))) problems.push('the Theme section is gone')
      check('importing ' + what + ' is refused: a visible red note says so, nothing is changed (state, tokens, library), nothing crashes', problems.length === 0, problems.concat(n ? [n.text] : []))
    }
    const bad = themeErrorsSince(mark)
    check('… and none of those imports raised an exception or a console error', bad.length === 0, bad.slice(0, 2).map((e) => e.text.split('\n')[0]))

    const a2 = await snapshot()
    await importFile('theme.json', '{"acc":"#ff00aa","skin":"custom"}'); await sleep(700)
    const b2 = await snapshot()
    check('a valid old-style .json becomes a theme too (2 rows now); the accent #ff00aa is NOT applied until « Appliquer »', (await rowsN()) === 2 && JSON.parse(b2.store).acc === JSON.parse(a2.store).acc && a2.tokens === b2.tokens, { rows: await rowsN(), acc: JSON.parse(b2.store).acc })
    await clickEl(`document.querySelectorAll('[data-kb=theme-row]')[1].querySelector('[data-kb=theme-apply]')`)
    await until(async () => { const s = await store(); return s && sameColor(s.acc, '#ff00aa') }, 3000)
    const applied = await store()
    check('« Appliquer » then applies it: accent stored and in the brand token', sameColor(applied.acc, '#ff00aa') && sameColor((await readTokens())[V.brand], '#ff00aa'), { acc: applied.acc })
    await importFile('sanitised.json', '{"acc":"#12ab34","wpVis":150,"radius":"banana","glassBlur":999,"ligatures":"yes","bogus":1,"ov":{"dark:l1":"nothex","evil:l1":"#ffffff"}}'); await sleep(700)
    await clickEl(`document.querySelectorAll('[data-kb=theme-row]')[2].querySelector('[data-kb=theme-apply]')`)
    await until(async () => { const s = await store(); return s && sameColor(s.acc, '#12ab34') }, 3000)
    const clean = await store()
    check('a file is validated before it is kept: the colour is stored, numbers are clamped (wpVis 150 → 100, glassBlur 999 → 40), an invalid choice (radius « banana ») and a non-boolean (ligatures « yes ») are dropped, unknown keys and invalid token overrides are not stored', clean.acc === '#12ab34' && clean.wpVis === 100 && clean.glassBlur === 40 && clean.radius === DEFAULTS.radius && clean.ligatures === DEFAULTS.ligatures && !('bogus' in clean) && !('evil:l1' in clean.ov) && !Object.keys(clean.ov).some((k) => /^evil/.test(k)) && clean.ov['dark:l1'] === undefined, clean)
    await reloadBoot()
    await openTheme()
    const st2 = await store()
    check('after a reload the page opens on the applied state, and the three themes are still in My themes', (await val(`!!document.querySelector('.kbth-page')`)) === true && st2 !== null && st2.acc === '#12ab34' && typeof st2.ov === 'object' && st2.ov !== null && JSON.parse(await val(`localStorage.getItem(${JSON.stringify(LIB)})`)).presets.length === 3, st2)
    if (modeSafe) {
      await goTab(TAB.partage)
      await clickEl(`(() => { const r = Array.from(document.querySelectorAll('.kbth-adv-pane .kbth-row')).find((x) => x.querySelector('.kbth-btn') && /reset|rétablir|réinit/i.test(x.querySelector('.kbth-btn').textContent) && /tous|all/i.test((x.querySelector('.kbth-lb') || { textContent: '' }).textContent)); return r ? r.querySelector('.kbth-btn') : null })()`)
      await sleep(500)
      const st3 = await store()
      const junk3 = Object.keys(st3).filter((k) => DEFAULTS[k] === undefined && k !== 'ov')
      check('Sharing › Reset: back to the defaults (skin dsh, no accent, ov empty), and it REPLACES the state: no key left over', st3.skin === 'dsh' && st3.acc === null && Object.keys(st3.ov).length === 0 && junk3.length === 0, st3)
      const tok = await readTokens()
      check('… and the 17 tokens are the native ones', TOKEN_VARS.every((v) => sameColor(tok[v], NATIVE[v])), TOKEN_VARS.filter((v) => !sameColor(tok[v], NATIVE[v])))
      check('… and Reset leaves your saved themes alone (the three are still there)', (await rowsN()) === 3, await rowsN())
    }
    await val(`localStorage.removeItem(${JSON.stringify(LIB)})`)
  })

  // ═══ 13b. My themes ═══════════════════════════════════════════════════════════════
  await section('library', 'My themes: save, modify, update, apply, rename, export, delete; then the disk copy (sandbox only)', async () => {
    const sandbox = /^(127\.0\.0\.1|localhost):(?!3080$)\d+$/.test(process.env.KB_HOST || '127.0.0.1:3080') && /sandbox/i.test(process.env.DSH_HOME || '')
    const hostFile = join(String(process.env.DSH_HOME || ''), 'kybernos', 'theme-presets.json')
    const libJson = async () => { const raw = await val(`localStorage.getItem(${JSON.stringify(LIB)})`); try { return raw ? JSON.parse(raw) : null } catch (e) { return undefined } }
    const mineDots = () => val(`document.querySelectorAll('[data-kb=theme-mine] .kbth-skin:not(.kbth-skin-add)').length`)
    const summary = async () => JSON.parse(await val(`JSON.stringify({ name: ((document.querySelector('.kbth-sum-n') || { childNodes: [] }).childNodes[0] || { textContent: '' }).textContent, pills: Array.from(document.querySelectorAll('.kbth-sum-n .kbth-pill')).map((e) => e.textContent.trim()), modified: !!document.querySelector('[data-kb=theme-modified]'), update: !!document.querySelector('[data-kb=theme-update]'), revert: !!document.querySelector('[data-kb=theme-revert]'), note: (document.querySelector('[data-kb=theme-note]') || { textContent: '' }).textContent.trim() })`))
    const dlg = () => val(`!!document.querySelector('[data-kb=theme-save-dlg]')`)
    const kb = (k) => `document.querySelector('[data-kb=${k}]')`
    const markLib = errors.length

    await openTheme({ fresh: true })
    const labels = await skinLabels()
    const ember = findSkin(labels, SKINS.find((d) => d.id === 'kb-ember'))
    const stone = findSkin(labels, SKINS.find((d) => d.id === 'kb-stone-cloud'))
    check('the add button sits next to « My themes », and with no theme of yours the page says so and points to Sharing', (await mineDots()) === 0 && (await val(`!!document.querySelector('[data-kb=theme-add]')`)) && /Aucun thème à vous|You have no theme/i.test(await val(`document.querySelector('[data-kb=theme-block]').innerText`)) && (await val(`!!document.querySelector('[data-kb=theme-open-sharing]')`)))
    await clickEl(Q.skin(ember.idx))
    await until(async () => { const s = await store(); return s && s.skin === 'kb-ember' }, 4000)
    let sm = await summary()
    check('a shipped theme in use: named in the summary, flagged « livré », not modified, no Update and no Revert', /Braise|Ember/.test(sm.name) && sm.pills.length === 1 && /livré|shipped/i.test(sm.pills[0]) && !sm.modified && !sm.update && !sm.revert, sm)

    await clickEl(Q.dot(3))                                  // an accent of the dot row
    await until(async () => (await summary()).modified, 3000)
    sm = await summary()
    const edited = await store()
    check('moving the accent keeps the theme selected and says « modifié » (it used to un-select every theme)', sm.modified && edited.skin === 'kb-ember' && sameColor(edited.acc, '#22A06B') && (await readPage()).skinPressed.length === 1, { sm, skin: edited.skin, acc: edited.acc })
    check('… a shipped theme offers « Enregistrer sous… » and « Annuler les changements », never « Mettre à jour »', !sm.update && sm.revert && (await val(`!!document.querySelector('[data-kb=theme-save]')`)))
    await clickEl(kb('theme-revert'))
    await until(async () => { const s = await store(); return s && s.acc === null }, 3000)
    sm = await summary()
    check('« Annuler les changements » puts the theme back (accent null again, pill gone, the native mode kept)', !sm.modified && (await store()).acc === null && (await modeInfo()).source === startMode, sm)

    await clickEl(Q.dot(3)); await until(async () => (await summary()).modified, 3000)
    await shot('13b-essentiel-modified')
    // — the save window
    await clickEl(kb('theme-save'))
    await until(dlg, 2000)
    await shot('13b-save-window')
    const dl = JSON.parse(await val(`JSON.stringify((() => { const d = document.querySelector('[data-kb=theme-save-dlg]'); const t = Array.from(d.querySelectorAll('.kbth-toggle')).map((b) => b.getAttribute('aria-checked')); return { role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'), label: d.getAttribute('aria-labelledby'), name: d.querySelector('[data-kb=theme-save-name]').value, focus: document.activeElement === d.querySelector('[data-kb=theme-save-name]'), toggles: t, inBody: d.parentElement === document.body || !!d.closest('body') } })())`))
    check('« Enregistrer sous… » opens a window: a dialog with a name field (focused, pre-filled) and four switches: font, corners, glass on; accessibility OFF', dl.role === 'dialog' && dl.modal === 'true' && dl.name.length > 0 && dl.focus && dl.toggles.join() === 'true,true,true,false', dl)
    await press('Tab', 12)
    check('Tab stays inside the window', await val(`!!document.activeElement.closest('[data-kb=theme-save-dlg]')`))
    await press('Escape'); await sleep(250)
    check('Escape closes the window only: Settings stays open and the focus goes back to the button that opened it', !(await dlg()) && (await val(`!!document.querySelector('.kbth-page')`)) && (await val(`document.activeElement && document.activeElement.getAttribute('data-kb')`)) === 'theme-save')
    check('… and nothing was saved', (await libJson()) === null || (await libJson()).presets.length === 0)

    await clickEl(kb('theme-save')); await until(dlg, 2000)
    await typeInto(`document.querySelector('[data-kb=theme-save-name]')`, '   ')
    await clickEl(kb('theme-save-ok')); await sleep(250)
    check('an empty name is refused inside the window, in red, and the window stays', (await dlg()) && /nom|name/i.test(await val(`(document.querySelector('[data-kb=theme-save-error]') || { textContent: '' }).textContent`)))
    await typeInto(`document.querySelector('[data-kb=theme-save-name]')`, 'Défaut DSH')
    await clickEl(kb('theme-save-ok')); await sleep(250)
    check('a name already used by a shipped theme is refused too', (await dlg()) && /existe|exists/i.test(await val(`(document.querySelector('[data-kb=theme-save-error]') || { textContent: '' }).textContent`)))
    await typeInto(`document.querySelector('[data-kb=theme-save-name]')`, 'Bureau')
    await clickEl(kb('theme-save-ok'))
    await until(async () => (await mineDots()) === 1, 3000)
    const saved = await libJson()
    const st1 = await store()
    sm = await summary()
    check('saving closes the window, adds a dot to My themes, selects it and says so', !(await dlg()) && (await mineDots()) === 1 && st1.skin === saved.presets[0].id && /Bureau/.test(sm.name) && /à vous|yours/i.test(sm.pills.join(' ')) && /enregistré|saved/i.test(sm.note), { sm, skin: st1.skin })
    const p0 = saved.presets[0]
    check('the saved theme keeps the colours, the accent, the font, the corners and the wallpaper — and NOT the accessibility settings', p0.name === 'Bureau' && p0.source === 'me' && sameColor(p0.settings.acc, '#22A06B') && p0.settings.fontText === 'dsh' && p0.settings.radius === 'standard' && p0.settings.wp === 'none' && Object.keys(p0.settings.ov).length >= 12 && !('contrastMode' in p0.settings) && !('cbSafe' in p0.settings) && !('skin' in p0.settings) && !('fs' in p0.settings), p0.settings && Object.keys(p0.settings))
    check('… and it is not « modified » right after being saved', !sm.modified)

    await clickEl(Q.dot(5)); await until(async () => (await summary()).modified, 3000)
    sm = await summary()
    check('your own theme with another accent: « modifié », « Mettre à jour » first, « Enregistrer sous… », « Annuler »', sm.modified && sm.update && sm.revert)
    await clickEl(kb('theme-update'))
    await until(async () => { const l = await libJson(); return l && sameColor(l.presets[0].settings.acc, '#F59E0B') }, 3000)
    sm = await summary()
    const brandSaved = (await readTokens())[V.brand]      // the engine may darken an accent that is too light for the scheme: what matters is that the same look comes back
    check('« Mettre à jour » rewrites it (accent now #F59E0B in the library, lower-case like any saved theme), the pill goes, the note says so', !sm.modified && /mis à jour|updated/i.test(sm.note) && (await libJson()).presets[0].settings.acc === '#f59e0b', sm)

    await clickEl(Q.skin(stone.idx))
    await until(async () => { const s = await store(); return s && s.skin === 'kb-stone-cloud' }, 4000)
    await clickEl(`document.querySelector('[data-kb=theme-mine] .kbth-skin:not(.kbth-skin-add)')`)
    await until(async () => { const s = await store(); return s && s.skin === p0.id }, 4000)
    const again = await store()
    const tok = await readTokens()
    check('choosing your theme again restores everything it retains (skin, accent, overrides) and applies it to the 17 tokens; the native mode is untouched', again.skin === p0.id && sameColor(again.acc, '#F59E0B') && JSON.stringify(Object.keys(again.ov).sort()) === JSON.stringify(Object.keys(p0.settings.ov).sort()) && sameColor(tok[V.brand], brandSaved) && !sameColor(tok[V.brand], NATIVE[V.brand]) && (await modeInfo()).source === startMode, { skin: again.skin, acc: again.acc, brand: tok[V.brand], expected: brandSaved })

    // — Sharing: the row
    await goTab(TAB.partage)
    check('Sharing lists it: one row, the source (« à vous »), what it retains, and the four actions (the theme in use has no « Appliquer »)', (await val(`document.querySelectorAll('[data-kb=theme-row]').length`)) === 1 && /retient|keeps|retains/i.test(await val(`document.querySelector('[data-kb=theme-row]').innerText`)) && !(await val(`!!document.querySelector('[data-kb=theme-row] [data-kb=theme-apply]')`)) && (await val(`['theme-export-one', 'theme-rename', 'theme-delete'].every((k) => !!document.querySelector('[data-kb=theme-row] [data-kb=' + k + ']'))`)))
    await clickEl(kb('theme-rename'))
    await until(() => val(`!!document.querySelector('[data-kb=theme-rename-in]')`), 2000)
    await typeInto(kb('theme-rename-in'), 'Clair net')
    await press('Enter'); await sleep(300)
    check('renaming to a name that exists is refused with a visible red note, and the row keeps its name', /existe|exists/i.test(await val(`(document.querySelector('[data-kb=theme-note]') || { textContent: '' }).textContent`)) && (await libJson()).presets[0].name === 'Bureau')
    await typeInto(kb('theme-rename-in'), 'Bureau du matin')
    await press('Enter'); await sleep(300)
    check('renaming works (Enter): the library and the row have the new name, the settings are untouched', (await libJson()).presets[0].name === 'Bureau du matin' && /Bureau du matin/.test(await val(`document.querySelector('[data-kb=theme-row] .kbth-trow-n').textContent`)) && sameColor((await libJson()).presets[0].settings.acc, '#F59E0B'))
    await val(`window.__copied = []; Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: (t) => { window.__copied.push(String(t)); return Promise.resolve() } })`)
    await clickEl(kb('theme-export-one')); await sleep(250)
    await shot('13b-sharing-export')
    const fileTxt = await val(`(document.querySelector('[data-kb=theme-file]') || { textContent: '' }).textContent`)
    let fileObj = null
    try { fileObj = JSON.parse(fileTxt) } catch (e) { fileObj = null }
    check('« Exporter » shows the file of that theme: framed JSON (format, version, name, settings), nothing else of the page in it', fileObj !== null && fileObj.format === 'kybernos-theme-preset' && fileObj.version === 1 && fileObj.name === 'Bureau du matin' && fileObj.settings && sameColor(fileObj.settings.acc, '#F59E0B') && !('skin' in fileObj.settings), fileTxt.slice(0, 120))
    await clickEl(kb('theme-copy-one')); await sleep(250)
    check('… « Copier » puts exactly that text on the clipboard', Number(await val(`window.__copied.length`)) === 1 && (await val(`window.__copied[0]`)) === fileTxt)
    // the file we just exported comes back as a second theme (the exchange between two machines, in one)
    await val(`window.__file = ${JSON.stringify('')}`)
    const importFile = (name, text) => val(`(() => { const input = document.querySelector('.kbth-adv-pane input[type=file]'); const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, { type: 'application/json' })); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); return !!input })()`)
    await importFile('theme-bureau.json', fileTxt); await sleep(600)
    const l2 = await libJson()
    check('an exported theme imports back as a second one: same settings, a free name (« Bureau du matin (2) »), source « importé », not applied', l2.presets.length === 2 && l2.presets[1].name === 'Bureau du matin (2)' && l2.presets[1].source === 'file' && JSON.stringify(l2.presets[1].settings) === JSON.stringify(l2.presets[0].settings) && (await store()).skin === p0.id, l2.presets.map((p) => p.name))
    const evil = JSON.stringify({ format: 'kybernos-theme-preset', version: 1, name: '<img src=x onerror="window.__pwned=1">', author: '<b>x</b>', settings: { mode: 'dark', acc: '#ff0000', fontText: 'url(//evil.test/f)', evil: true } })
    await importFile('evil.json', evil); await sleep(600)
    await shot('13b-sharing-rows')
    const hostile = JSON.parse(await val(`JSON.stringify({ img: !!document.querySelector('.kbth-page img'), bold: !!document.querySelector('.kbth-page b'), pwned: window.__pwned === 1, row: Array.from(document.querySelectorAll('[data-kb=theme-row] .kbth-trow-n span:first-child')).map((e) => e.textContent) })`))
    check('a hostile file is data: its name is drawn as text (no element, no handler), its unknown font is dropped', !hostile.img && !hostile.bold && !hostile.pwned && hostile.row.some((t) => /<img/.test(t)) && !JSON.stringify((await libJson()).presets[2].settings).includes('evil'), hostile)
    await clickEl(`document.querySelectorAll('[data-kb=theme-row]')[2].querySelector('[data-kb=theme-delete]')`)
    await sleep(150)
    check('« Supprimer » asks first, in place (no browser dialog), naming the theme', /Supprimer|Delete/i.test(await val(`document.querySelectorAll('[data-kb=theme-row]')[2].innerText`)) && (await val(`!!document.querySelector('[data-kb=theme-delete-yes]')`)) && (await libJson()).presets.length === 3)
    await clickEl(kb('theme-delete-yes')); await sleep(300)
    check('… and confirming removes that theme only', (await libJson()).presets.length === 2 && (await val(`document.querySelectorAll('[data-kb=theme-row]').length`)) === 2)
    await clickEl(`document.querySelectorAll('[data-kb=theme-row]')[1].querySelector('[data-kb=theme-delete]')`); await clickEl(kb('theme-delete-yes')); await sleep(300)
    await goTab(TAB.essentiel)
    // delete the one in use
    await goTab(TAB.partage)
    await clickEl(kb('theme-delete')); await clickEl(kb('theme-delete-yes')); await sleep(400)
    await goTab(TAB.essentiel)
    sm = await summary()
    check('deleting the theme in use leaves the look as it is and reads « Personnalisé »; the library is empty again', (await libJson()).presets.length === 0 && /Personnalisé|Custom/i.test(sm.name) && sameColor((await store()).acc, '#F59E0B'), sm)
    check('a reload keeps the library as it is (empty) and nothing raised an error', (await mineDots()) === 0 && themeErrorsSince(markLib).length === 0, themeErrorsSince(markLib).slice(0, 2).map((e) => e.text.split('\n')[0]))

    // ── the disk copy, on the real route of the sandbox ─────────────────────────────
    if (!sandbox) { console.log('  · the disk copy is not played here: it writes <DSH_HOME>/kybernos/theme-presets.json, so it needs the isolated instance (source scripts/sandbox/env.sh; this run targets ' + (process.env.KB_HOST || '127.0.0.1:3080') + ')'); return }
    check('the disk copy is played against the sandbox only (KB_HOST is not :3080, DSH_HOME is the sandbox one)', sandbox)
    rmSync(hostFile, { force: true })
    if (flagScriptId !== null) { await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: flagScriptId }); flagScriptId = null }
    try {
      await val(`localStorage.removeItem(${JSON.stringify(LIB)})`)
      await reloadBoot()
      await openTheme()
      check('no theme on the disk yet: the route answers « library: null »', JSON.stringify(await val(`fetch('/kybernos-theme/preset-store').then((r) => r.json())`, 8000)) === '{"ok":true,"library":null}')
      await clickEl(kb('theme-save')); await until(dlg, 2000)
      await typeInto(`document.querySelector('[data-kb=theme-save-name]')`, 'Sur disque')
      await clickEl(kb('theme-save-ok'))
      const onDisk = await until(() => existsSync(hostFile), 5000, 150)
      let disk = null
      try { disk = JSON.parse(readFileSync(hostFile, 'utf8')) } catch (e) { disk = null }
      check('saving writes <DSH_HOME>/kybernos/theme-presets.json (after a short pause): one theme, same name, same clock as the browser copy', !!onDisk && disk !== null && disk.presets.length === 1 && disk.presets[0].name === 'Sur disque' && disk.updatedAt === (await libJson()).updatedAt, disk && { n: disk.presets.length, at: disk.updatedAt })
      check('… the file holds only data: known settings, no skin, no text size', disk !== null && !('skin' in disk.presets[0].settings) && !('fs' in disk.presets[0].settings) && Object.keys(disk.presets[0].settings).every((k) => /^(mode|acc|ov|fontText|ligatures|radius|wp|wpVis|wpBlur|tint|glass\w+|sidebar\w+|fieldOpacity|floatOpacity|bg\w+)$/.test(k)), disk && Object.keys(disk.presets[0].settings))
      // clear the browser: the disk brings it back
      await val(`localStorage.removeItem(${JSON.stringify(LIB)})`)
      await reloadBoot()
      await openTheme()
      const back2 = await until(async () => (await mineDots()) === 1, 6000)
      check('after clearing the browser copy and reloading, the theme comes back from the disk, and is kept in the browser again', !!back2 && (await libJson()) !== null && (await libJson()).presets[0].name === 'Sur disque', await mineDots())
      await goTab(TAB.partage)
      await clickEl(kb('theme-delete')); await clickEl(kb('theme-delete-yes'))
      const gone = await until(() => { try { return JSON.parse(readFileSync(hostFile, 'utf8')).presets.length === 0 } catch (e) { return false } }, 5000, 150)
      check('deleting it empties the disk copy too (the library is replaced as a whole: nothing comes back after a reload)', !!gone)
      await reloadBoot(); await openTheme(); await sleep(1500)
      check('… after a reload it stays deleted', (await mineDots()) === 0)
    } finally {
      rmSync(hostFile, { force: true })
      const again = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: FLAG_SRC })
      flagScriptId = again && again.result ? again.result.identifier : null
      await val(FLAG_SRC)
      await val(`localStorage.removeItem(${JSON.stringify(LIB)})`)
    }
  })

  // ═══ 13c. The gallery ═════════════════════════════════════════════════════════════
  await section('gallery', 'The gallery: the shipped catalogue on the sandbox host, search, filter, try, install, update', async () => {
    const sandbox = /^(127\.0\.0\.1|localhost):(?!3080$)\d+$/.test(process.env.KB_HOST || '127.0.0.1:3080') && /sandbox/i.test(process.env.DSH_HOME || '')
    if (!sandbox) { console.log('  · the gallery is read by the HOST and caches under <DSH_HOME>/kybernos: it needs the isolated instance (source scripts/sandbox/env.sh; this run targets ' + (process.env.KB_HOST || '127.0.0.1:3080') + ')'); return }
    const shipped = JSON.parse(readFileSync(new URL('../packages/kybernos-theme/gallery.json', import.meta.url), 'utf8'))
    // The host half is ON in this section, so a saved library goes to the SANDBOX's disk: start and end with none there.
    const hostLibFile = join(String(process.env.DSH_HOME || ''), 'kybernos', 'theme-presets.json')
    const libJson = async () => { const raw = await val(`localStorage.getItem(${JSON.stringify(LIB)})`); try { return raw ? JSON.parse(raw) : null } catch (e) { return undefined } }
    const kb = (k) => `document.querySelector('[data-kb=${k}]')`
    const cards = () => val(`document.querySelectorAll('[data-kb=theme-gal-card]').length`)
    const cardBtn = (id, k) => `document.querySelector('[data-kb=theme-gal-card][data-id=${id}] [data-kb=${k}]')`
    const sameMode = shipped.themes.find((t) => t.settings.mode === startMode)
    const otherMode = shipped.themes.find((t) => t.settings.mode !== startMode && (t.settings.mode === 'light' || t.settings.mode === 'dark'))
    const mark = errors.length
    if (flagScriptId !== null) { await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: flagScriptId }); flagScriptId = null }
    rmSync(hostLibFile, { force: true })
    try {
      await val(`localStorage.removeItem(${JSON.stringify(LIB)})`)
      await reloadBoot()
      await openTheme({ fresh: true })
      const tok0 = await readTokens()
      await goTab(TAB.galerie)
      check('the Galerie tab opens and shows one card per shipped theme', !!(await until(async () => (await cards()) === shipped.themes.length, 8000)), { cards: await cards(), want: shipped.themes.length })
      const cardNames = JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb=theme-gal-card] .kbth-card-n')).map((e) => e.textContent))`))
      // (the interface may be live-translated: a theme called « Crépuscule » then reads « Twilight », so the cards are matched by id)
      const ids = JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb=theme-gal-card]')).map((e) => e.getAttribute('data-id')))`))
      const parts = { missing: shipped.themes.filter((t) => !ids.includes(t.id)).map((t) => t.id), unnamed: cardNames.filter((n) => n.trim() === '').length, thumbs: await val(`document.querySelectorAll('[data-kb=theme-gal-card] .kbth-thumb').length`), authors: await val(`document.querySelectorAll('[data-kb=theme-gal-card] .kbth-card-a').length`), descs: await val(`document.querySelectorAll('[data-kb=theme-gal-card] .kbth-card-d').length`) }
      check('...each under its name, with thumbnail, author and description', parts.missing.length === 0 && parts.unnamed === 0 && parts.thumbs === shipped.themes.length && parts.authors === shipped.themes.length && parts.descs === shipped.themes.length, parts)
      const src = await val(`(document.querySelector('[data-kb=theme-gal-source]') || { textContent: '' }).textContent`)
      check('the source line says they are shipped with Kybernos (no key is embedded yet) and counts them', /Livré avec Kybernos|Shipped with Kybernos/i.test(src) && src.includes(String(shipped.themes.length)), src)
      const online = await until(async () => (await val(`(document.querySelector('[data-kb=theme-gal-online]') || { textContent: '' }).textContent`)) || null, 8000)
      check('...and says in plain words why the online catalogue is not shown (no key embedded yet, or none reachable)', !!online && /pas encore activé|injoignable|not active yet|cannot be reached|turned off/i.test(online), online)
      check('...with no « Actualiser » while the online catalogue is not active', !(await val(`!!document.querySelector('[data-kb=theme-gal-refresh]')`)) || /injoignable|cannot be reached|unreachable/i.test(online || ''))
      const asked = JSON.parse(await val(`fetch('/kybernos-theme/gallery').then((r) => r.json()).then((j) => JSON.stringify({ ok: j.ok, source: j.source, n: j.themes.length, state: j.online.state, reason: j.online.reason }))`, 8000))
      check('the route answers from the disk: shipped, the same count, and the state the page showed', asked.ok === true && asked.source === 'shipped' && asked.n === shipped.themes.length, asked)

      // search and filter
      await shot('13c-gallery')
      const some = shipped.themes[2]
      await typeInto(kb('theme-gal-q'), some.name.slice(0, 5))
      await sleep(300)
      check('searching a few letters of a name narrows the grid to that theme', (await cards()) >= 1 && (await cards()) < shipped.themes.length && (await val(`!!${cardBtn(some.id, 'theme-gal-install')}`)), { cards: await cards() })
      await typeInto(kb('theme-gal-q'), 'zzzz-nothing')
      await sleep(300)
      check('a search with no match says so and offers to clear it', (await cards()) === 0 && (await val(`!!document.querySelector('[data-kb=theme-gal-none]')`)))
      await typeInto(kb('theme-gal-q'), '')
      await sleep(300)
      await clickEl(`Array.from(document.querySelectorAll('.kbth-adv-pane .kbth-seg button')).find((b) => /^(sombre|dark)$/i.test(b.textContent.trim()))`)
      await sleep(250)
      const darkIds = shipped.themes.filter((t) => t.settings.mode === 'dark').map((t) => t.id)
      check('the filter « Sombre » keeps only the dark themes', (await cards()) === darkIds.length && (await val(`Array.from(document.querySelectorAll('[data-kb=theme-gal-card]')).every((c) => ${JSON.stringify(darkIds)}.includes(c.getAttribute('data-id')))`)))
      await clickEl(`Array.from(document.querySelectorAll('.kbth-adv-pane .kbth-seg button')).find((b) => /^(tous|all)$/i.test(b.textContent.trim()))`)
      await sleep(250)
      check('...and « Tous » brings them all back', (await cards()) === shipped.themes.length)

      if (sameMode === undefined || (startMode !== 'dark' && startMode !== 'light')) {
        console.log('  · try / install are not played: the mode found (' + startMode + ') has no shipped theme of its own, and a theme of the other mode would change DSH\'s native mode')
      } else {
        const t = sameMode
        // a trial draws the theme and stores nothing
        await clickEl(cardBtn(t.id, 'theme-gal-try'))
        await until(() => val(`!!document.querySelector('[data-kb=theme-trial]')`), 3000)
        await sleep(300)
        const tokTry = await readTokens()
        const stTry = await store()
        await shot('13c-gallery-trial')
        check('« Essayer » shows a banner and draws the theme: the brand token is no longer the native one', (await val(`!!document.querySelector('[data-kb=theme-trial]')`)) && !sameColor(tokTry[V.brand], tok0[V.brand]) && /Essai de|Trial of/.test(await val(`document.querySelector('[data-kb=theme-trial]').textContent`)), { brand: tokTry[V.brand], native: tok0[V.brand] })
        check('...and stores NOTHING: the stored look is the one from before, and My themes is empty', (stTry === null || stTry.skin === 'dsh') && ((await libJson()) === null || (await libJson()).presets.length === 0), stTry && stTry.skin)
        check('...the card says « En essai » and is disabled', /En essai|Trying/i.test(await val(`${cardBtn(t.id, 'theme-gal-try')}.textContent`)) && (await val(`${cardBtn(t.id, 'theme-gal-try')}.disabled`)) === true)
        await clickEl(kb('theme-trial-end'))
        await sleep(400)
        const tokBack = await readTokens()
        check('« Revenir à mon thème » puts the look back (all 17 tokens as before), the banner is gone', TOKEN_VARS.every((v) => sameColor(tokBack[v], tok0[v])) && !(await val(`!!document.querySelector('[data-kb=theme-trial]')`)), TOKEN_VARS.filter((v) => !sameColor(tokBack[v], tok0[v])))
        // closing Settings during a trial gives the stored look back
        await clickEl(cardBtn(t.id, 'theme-gal-try')); await sleep(300)
        await val(`(Array.from(document.querySelectorAll('button')).find((b) => /back to workspace|retour/i.test(b.textContent)) || { click() {} }).click()`)
        await sleep(600)
        const tokClosed = await readTokens()
        check('closing Settings in the middle of a trial puts the stored look back', TOKEN_VARS.every((v) => sameColor(tokClosed[v], tok0[v])), TOKEN_VARS.filter((v) => !sameColor(tokClosed[v], tok0[v])))
        await reloadBoot(); await openTheme(); await goTab(TAB.galerie)
        await until(async () => (await cards()) === shipped.themes.length, 8000)

        // install
        await clickEl(cardBtn(t.id, 'theme-gal-install'))
        await until(async () => { const l = await libJson(); return l && l.presets.length === 1 }, 4000)
        const l1 = await libJson()
        const st1 = await store()
        check('« Installer » adds the theme to My themes (source gallery, its catalogue id, version, author) and applies it', l1.presets[0].source === 'gallery' && l1.presets[0].gid === t.id && l1.presets[0].v === t.v && l1.presets[0].author === t.author && l1.presets[0].name === t.name && st1.skin === l1.presets[0].id, l1.presets[0])
        check('...the note says so and the card now reads « Installé »', /installé|installed/i.test(await val(`(document.querySelector('[data-kb=theme-note]') || { textContent: '' }).textContent`)) && /Installé|Installed/i.test(await val(`document.querySelector('[data-kb=theme-gal-card][data-id=${t.id}]').textContent`)) && !(await val(`!!${cardBtn(t.id, 'theme-gal-install')}`)))
        check('...the native mode is still the one found, and the look is the theme\'s (brand token moved)', (await modeInfo()).source === startMode && !sameColor((await readTokens())[V.brand], tok0[V.brand]))
        check('no accessibility setting was touched by the install', st1.contrastMode === DEFAULTS.contrastMode && st1.cbSafe === DEFAULTS.cbSafe && st1.reduceMotion === DEFAULTS.reduceMotion && st1.largeTargets === DEFAULTS.largeTargets && st1.underlineLinks === DEFAULTS.underlineLinks && st1.focusRing === DEFAULTS.focusRing, st1)
        // update: pretend the installed copy is older than the catalogue
        await val(`(() => { const l = JSON.parse(localStorage.getItem(${JSON.stringify(LIB)})); l.presets[0].v = 0; localStorage.setItem(${JSON.stringify(LIB)}, JSON.stringify(l)) })()`)
        await reloadBoot(); await openTheme(); await goTab(TAB.galerie)
        await until(async () => (await cards()) === shipped.themes.length, 8000)
        check('an installed copy older than the catalogue offers « Mettre à jour » on that card only', (await val(`!!${cardBtn(t.id, 'theme-gal-update')}`)) && (await val(`document.querySelectorAll('[data-kb=theme-gal-update]').length`)) === 1)
        await clickEl(cardBtn(t.id, 'theme-gal-update'))
        await until(async () => { const l = await libJson(); return l && l.presets[0].v === t.v }, 4000)
        check('...clicking it moves the copy to the catalogue\'s version and the button goes away', (await libJson()).presets[0].v === t.v && !(await val(`!!${cardBtn(t.id, 'theme-gal-update')}`)))
        // a second theme of the same mode: a second install, and « Partage » lists both with their source
        const t2 = shipped.themes.find((x) => x.settings.mode === startMode && x.id !== t.id)
        if (t2 !== undefined) {
          await clickEl(cardBtn(t2.id, 'theme-gal-install'))
          await until(async () => { const l = await libJson(); return l && l.presets.length === 2 }, 4000)
          await goTab(TAB.partage)
          check('Sharing lists both, each flagged « Galerie · Kybernos »', (await val(`document.querySelectorAll('[data-kb=theme-row]').length`)) === 2 && (await val(`Array.from(document.querySelectorAll('[data-kb=theme-row]')).every((r) => /Galerie · Kybernos|Gallery · Kybernos/.test(r.textContent))`)))
          await goTab(TAB.galerie)
        }
        if (otherMode !== undefined) {
          const before = await store()
          check('a theme of the other mode is NOT installed by this test (it would change DSH\'s native mode); the card is simply there', (await val(`!!${cardBtn(otherMode.id, 'theme-gal-install')}`)) && (await store()).mode === before.mode)
        }
      }
      const bad = themeErrorsSince(mark)
      check('nothing raised an exception or a console error in the gallery', bad.length === 0, bad.slice(0, 2).map((e) => e.text.split('\n')[0]))
    } finally {
      await sleep(900)                                   // let a pending push of the library reach the disk before it is removed
      rmSync(hostLibFile, { force: true })
      await val(`localStorage.removeItem(${JSON.stringify(LIB)})`)
      const again = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: FLAG_SRC })
      flagScriptId = again && again.result ? again.result.identifier : null
      await val(FLAG_SRC)
    }
  })

  // ═══ B–F. The controls that used to be dead, now wired: each one is measured on the real GUI (computed styles) ═══════════
  const alphaOf = (c) => {
    const t = String(c).trim().toLowerCase()
    let m = /^#([0-9a-f]{8})$/.exec(t); if (m) return parseInt(m[1].slice(6), 16) / 255
    if (/^#[0-9a-f]{6}$/.test(t)) return 1
    m = /^rgba\(\s*[\d.]+[ ,]+[\d.]+[ ,]+[\d.]+[ ,/]+([\d.]+)/.exec(t); if (m) return Number(m[1])
    m = /^color\(srgb[^/]*\/\s*([\d.]+)/.exec(t); if (m) return Number(m[1])
    return 1
  }
  const bodyVar = (v) => val(`getComputedStyle(document.body).getPropertyValue(${JSON.stringify(v)}).trim()`)
  const cs = (sel, prop) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? getComputedStyle(e)[${JSON.stringify(prop)}] : null })()`)
  const backdrop = async (sel) => (await val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const c = getComputedStyle(e); return c.backdropFilter || c.webkitBackdropFilter || 'none' })()`))
  const SIDEBAR = '[data-slot="sidebar"]'
  const COMPOSER = '[data-composer-card]'
  const px = (v) => parseFloat(String(v))
  const filterParts = (f) => { const o = {}; String(f).replace(/([a-z-]+)\(([\d.]+)(px)?\)/g, (m, n, v) => { o[n] = Number(v); return m }); return o }
  const seedTheme = (state) => val(`localStorage.setItem(${JSON.stringify(STORE)}, ${JSON.stringify(JSON.stringify(state))}); localStorage.removeItem(${JSON.stringify(LD_KEY)}); localStorage.removeItem(${JSON.stringify(LD_CACHE)})`)
  const pluginStyles = () => val(`JSON.stringify((() => { const t = Array.from(document.querySelectorAll('style')).filter((s) => s.dataset.plugin === '@local/kybernos-theme'); return { count: t.length, len: t.reduce((n, s) => n + s.textContent.length, 0) } })())`).then((x) => JSON.parse(x))
  const adjust = async (key, how) => { await focusEl(sliderQ(key, Q.pane)); if (typeof how === 'number') { await press('Home'); await press('ArrowRight', how) } else await press(how); await sleep(220) }

  await section('verre', 'Verre et fond: wallpaper visible, glass, transparency, image adjustments, preview — measured on the real GUI', async () => {
    // (a) no wallpaper: the note, the preview, and nothing blurred whatever the sliders say
    await openTheme({ fresh: true })
    await goTab(TAB.verre)
    const none = JSON.parse(await val(`JSON.stringify({ note: document.querySelectorAll('.kbth-adv-pane .kbth-note').length, preview: !!document.querySelector('[data-kb=glass-preview]'), noteText: (document.querySelector('.kbth-adv-pane .kbth-note') || { textContent: '' }).textContent })`))
    check('no wallpaper: the tab says the settings apply once a background is chosen (« Ces réglages s’appliquent dès qu’un fond est choisi »), and the preview [data-kb=glass-preview] is there', none.note === 1 && none.preview === true && /fond|background|wallpaper/i.test(none.noteText), none)
    check('no wallpaper: no backdrop-filter on the sidebar nor on the composer card (blur 18 is set, nothing to blur)', (await backdrop(SIDEBAR)) === 'none' && (await backdrop(COMPOSER)) === 'none', { sidebar: await backdrop(SIDEBAR), composer: await backdrop(COMPOSER) })

    // (b) with a wallpaper
    await seedTheme({ skin: 'custom', wp: 'aurore', wpVis: 100 })
    await openTheme()
    await goTab(TAB.verre)
    const wp0 = await readWallpaper()
    check('the wallpaper layer exists at boot (aurore, opacity 1), and the tab no longer shows the « choose a background » note', wp0.count === 1 && wp0.opacity === '1' && (await val(`document.querySelectorAll('.kbth-adv-pane .kbth-note').length`)) === 0, { wp: wp0.count, opacity: wp0.opacity })
    check('--dsw-alias-bg-base computes to a fully transparent #151517 (alpha 0) while a wallpaper is on, so the layer shows through', sameColor(await bodyVar(V.base), '#151517') && alphaOf(await bodyVar(V.base)) === 0, await bodyVar(V.base))
    check('sidebar transparency 25 % → --dsw-specific-sidebar-fill alpha .75; fields 20 % → --dsw-specific-input-major alpha .8; menus 10 % → --dsw-specific-menu alpha .9', Math.abs(alphaOf(await bodyVar('--dsw-specific-sidebar-fill')) - 0.75) < 0.02 && Math.abs(alphaOf(await bodyVar('--dsw-specific-input-major')) - 0.8) < 0.02 && Math.abs(alphaOf(await bodyVar('--dsw-specific-menu')) - 0.9) < 0.02, { side: await bodyVar('--dsw-specific-sidebar-fill'), input: await bodyVar('--dsw-specific-input-major'), menu: await bodyVar('--dsw-specific-menu') })
    check('frosted glass: backdrop-filter is blur(18px) on the sidebar and on the composer card', (await backdrop(SIDEBAR)) === 'blur(18px)' && (await backdrop(COMPOSER)) === 'blur(18px)', { sidebar: await backdrop(SIDEBAR), composer: await backdrop(COMPOSER) })
    const pv = () => val(`(() => { const p = document.querySelector('[data-kb=glass-preview]'); const s = p.querySelector('.kbth-gpv-side'); const m = p.querySelector('.kbth-gpv-input'); return JSON.stringify({ side: getComputedStyle(s).backgroundColor, input: getComputedStyle(m).backgroundColor, bf: getComputedStyle(s).backdropFilter }) })()`).then((x) => JSON.parse(x))
    const pv0 = await pv()
    await adjust('side', 'End')
    const sideEnd = alphaOf(await bodyVar('--dsw-specific-sidebar-fill'))
    const pv1 = await pv()
    await adjust('side', 'Home')
    const sideHome = alphaOf(await bodyVar('--dsw-specific-sidebar-fill'))
    await adjust('field', 'End'); const fieldEnd = alphaOf(await bodyVar('--dsw-specific-input-major'))
    await adjust('field', 'Home'); const fieldHome = alphaOf(await bodyVar('--dsw-specific-input-major'))
    await adjust('menu', 'End'); const menuEnd = alphaOf(await bodyVar('--dsw-specific-menu'))
    await adjust('menu', 'Home'); const menuHome = alphaOf(await bodyVar('--dsw-specific-menu'))
    check('the three transparency sliders drive their token: 100 % → alpha 0, 0 % → alpha 1 (sidebar, fields, menus)', sideEnd < 0.02 && sideHome > 0.98 && fieldEnd < 0.02 && fieldHome > 0.98 && menuEnd < 0.02 && menuHome > 0.98, { sideEnd, sideHome, fieldEnd, fieldHome, menuEnd, menuHome })
    check('the preview [data-kb=glass-preview] follows the sliders (its sidebar colour changes between 25 % and 100 %)', pv0.side !== pv1.side, { at25: pv0.side, at100: pv1.side })
    await adjust('side', 25)                // back to 25 %
    // linked / not linked
    await clickEl(toggleQ('linked')); await sleep(300)
    const solid = await bodyVar('--dsw-specific-sidebar-fill')
    const greyed = JSON.parse(await val(`JSON.stringify((() => { const i = ${sliderQ('side', Q.pane)}; let e = i; while (e && e !== document.querySelector('.kbth-adv-pane')) { if (e.style && e.style.pointerEvents === 'none') return { opacity: getComputedStyle(e).opacity, pe: getComputedStyle(e).pointerEvents }; e = e.parentElement } return null })())`))
    check('« Lier la barre latérale » off: the sidebar fill stays a 6-digit solid colour (' + solid + ') and the sidebar slider is greyed out and inert', /^#[0-9a-f]{6}$/i.test(solid) && greyed !== null && Number(greyed.opacity) < 0.6 && greyed.pe === 'none', { solid, greyed })
    check('… the sidebar is no longer blurred, the composer card still is', (await backdrop(SIDEBAR)) === 'none' && (await backdrop(COMPOSER)) === 'blur(18px)', { sidebar: await backdrop(SIDEBAR), composer: await backdrop(COMPOSER) })
    await clickEl(toggleQ('linked')); await sleep(300)
    check('… and linked again gives the alpha .75 fill back', Math.abs(alphaOf(await bodyVar('--dsw-specific-sidebar-fill')) - 0.75) < 0.02)
    // frosted / liquid / blur 0
    await clickEl(`document.querySelectorAll('.kbth-adv-pane .kbth-seg')[0].children[1]`); await sleep(300)
    const liquid = { sidebar: await backdrop(SIDEBAR), composer: await backdrop(COMPOSER) }
    check('liquid glass: backdrop-filter is blur(18px) saturate(1.65) brightness(1.06) on the sidebar and the composer card', liquid.sidebar === 'blur(18px) saturate(1.65) brightness(1.06)' && liquid.composer === liquid.sidebar, liquid)
    await clickEl(`document.querySelectorAll('.kbth-adv-pane .kbth-seg')[0].children[0]`); await sleep(300)
    check('… frosted gives plain blur(18px) back', (await backdrop(SIDEBAR)) === 'blur(18px)')
    await adjust('glass', 'Home')
    check('glass blur 0 → backdrop-filter none (sidebar and composer card)', (await backdrop(SIDEBAR)) === 'none' && (await backdrop(COMPOSER)) === 'none', { sidebar: await backdrop(SIDEBAR), composer: await backdrop(COMPOSER) })
    await adjust('glass', 'End')
    check('glass blur 40 → blur(40px)', (await backdrop(COMPOSER)) === 'blur(40px)', await backdrop(COMPOSER))
    await adjust('glass', 18)
    // the wallpaper element: its filter composes the four adjustments and the blur
    const fl = async () => filterParts((await readWallpaper()).filter)
    await adjust('bright', 'End'); const f1 = await fl()
    await adjust('contrast', 'End'); const f2 = await fl()
    await adjust('sat', 'End'); const f3 = await fl()
    await adjust('imgblur', 'End'); const f4 = await fl()
    await adjust('dark', 50); const f5 = await fl()
    await adjust('dark', 'End'); const f6 = await fl()
    check('the wallpaper’s computed filter composes brightness 200 % → brightness(2), + contrast 200 % → contrast(2), + saturation 200 % → saturate(2), + image blur 40 → blur(40px)', f1.brightness === 2 && f2.brightness === 2 && f2.contrast === 2 && f3.saturate === 2 && f4.blur === 40 && f4.saturate === 2, { f1, f2, f3, f4 })
    check('… darkening multiplies the brightness: 50 % darkening on 200 % brightness → brightness 1 (no brightness() left); 100 % → brightness(0)', f5.brightness === undefined && f5.contrast === 2 && f6.brightness === 0, { f5, f6 })
    await adjust('bright', 'Home'); await adjust('contrast', 'Home'); await adjust('sat', 'Home'); await adjust('imgblur', 'Home'); await adjust('dark', 'Home')
    for (const k of ['bright', 'contrast', 'sat']) await adjust(k, 100)
    const fz = (await readWallpaper()).filter
    check('all adjustments back to 100 % / 0 → filter none', fz === 'none', fz)
    // fit
    const sizes = []
    for (const [i, want] of [[1, 'contain'], [2, 'auto'], [3, '100% 100%'], [0, 'cover']]) {
      await clickEl(`document.querySelectorAll('.kbth-adv-pane .kbth-seg')[1].children[${i}]`); await sleep(250)
      const got = (await readWallpaper()).bgSize
      sizes.push([want, got])
    }
    check('« Ajustement » changes the wallpaper’s background-size: Remplir → contain, Centrer → auto, Étirer → 100% 100%, Couvrir → cover', sizes.every(([w, g]) => new Set(String(g).split(', ')).size === 1 && String(g).split(', ')[0] === w), sizes)
    // mirror
    await clickEl(toggleQ('mirror')); await sleep(250)
    const mirrored = await val(`(() => { const d = Array.from(document.body.children).find((e) => e.tagName === 'DIV' && e.style.position === 'fixed' && e.style.zIndex === '-1'); return d ? getComputedStyle(d).transform : null })()`)
    await clickEl(toggleQ('mirror')); await sleep(250)
    const plain = await val(`(() => { const d = Array.from(document.body.children).find((e) => e.tagName === 'DIV' && e.style.position === 'fixed' && e.style.zIndex === '-1'); return d ? getComputedStyle(d).transform : null })()`)
    check('« Miroir horizontal » flips the wallpaper (transform matrix(-1, 0, 0, 1, 0, 0)) and off gives none back', /^matrix\(-1, 0, 0, 1, 0, 0\)$/.test(String(mirrored)) && plain === 'none', { mirrored, plain })
  })

  await section('forme', 'Texte et forme: ligatures, rayons, logo — measured on the real GUI', async () => {
    await openTheme({ fresh: true })
    await goTab(TAB.texte)
    const lig = async () => ({ body: await cs('body', 'fontVariantLigatures'), title: await cs('.kbth-title', 'fontVariantLigatures'), composer: await cs(COMPOSER, 'fontVariantLigatures') })
    const l0 = await lig()
    await clickEl(toggleQ('lig')); await sleep(300)
    const l1 = await lig()
    const feat = await cs('.kbth-title', 'fontFeatureSettings')
    await clickEl(toggleQ('lig')); await sleep(300)
    const l2 = await lig()
    check('ligatures off: font-variant-ligatures is none on the page, on the composer card and on the title (' + JSON.stringify(l0.body) + ' → none), font-feature-settings turns liga/calt off; on again restores it', l0.body !== 'none' && l1.body === 'none' && l1.title === 'none' && l1.composer === 'none' && /"liga" 0/.test(String(feat)) && l2.body !== 'none', { l0, l1, feat, l2 })
    // radius
    const radius = async () => ({ md: await bodyVar('--dsw-radius-md'), panel: await bodyVar('--dsw-radius-panel'), composer: px(await cs(COMPOSER, 'borderRadius')) })
    const r0 = await radius()
    const segBtn = (i) => `document.querySelectorAll('.kbth-adv-pane .kbth-seg')[0].children[${i}]`
    await clickEl(segBtn(0)); await sleep(300)
    const rSharp = await radius()
    const pillSharp = (await readPage()).pills[0]
    await clickEl(segBtn(2)); await sleep(300)
    const rSoft = await radius()
    await clickEl(segBtn(1)); await sleep(300)
    const rStd = await radius()
    const pillStd = (await readPage()).pills[0]
    check('« Rayons »: Net → --dsw-radius-md 3px, Doux → 18px, Standard → the DSH 12px', rSharp.md === '3px' && rSoft.md === '18px' && rStd.md === '12px' && r0.md === '12px', { start: r0.md, sharp: rSharp.md, soft: rSoft.md, standard: rStd.md })
    check('… a real element follows: the composer card’s border-radius is smaller with Net and larger with Doux than with Standard (' + rSharp.composer + ' < ' + rStd.composer + ' < ' + rSoft.composer + ' px)', rSharp.composer < rStd.composer && rStd.composer < rSoft.composer, { sharp: rSharp.composer, standard: rStd.composer, soft: rSoft.composer })
    check('… Standard posts NO radius token: the footer pill says « DSH native » again (it said a layer was on with Net: « ' + pillSharp + ' »)', !/native|natif/i.test(pillSharp || '') && /native|natif/i.test(pillStd || ''), { sharp: pillSharp, standard: pillStd })
    // brand
    const brand = async () => ({ name: await cs('[data-slot="sidebar.brand.name"]', 'display'), mark: await cs('[data-slot="sidebar.brand.mark"]', 'display'), hero: await cs('[data-slot="conversation.hero.brand.mark"]', 'display') })
    const b0 = await brand()
    await clickEl(toggleQ('brand')); await sleep(300)
    const b1 = await brand()
    await clickEl(toggleQ('brand')); await sleep(300)
    const b2 = await brand()
    check('« Logo et nom » off: the sidebar brand name and mark and the home hero mark compute display:none; on again restores them (' + b0.name + ')', b0.name !== 'none' && b1.name === 'none' && b1.mark === 'none' && b1.hero === 'none' && b2.name !== 'none' && b2.hero !== 'none', { b0, b1, b2 })
  })

  await section('access', 'Accessibilité: motion, focus ring, 44 px targets, link underline, colour-blind palette — measured on the real GUI', async () => {
    await openTheme({ fresh: true })
    await goTab(TAB.accessibilite)
    // links: a probe <a href> added to the page
    await val(`(() => { const a = document.createElement('a'); a.id = 'kb-probe'; a.href = '#kb-probe'; a.textContent = 'probe'; a.style.cssText = 'position:fixed;left:2px;bottom:2px;z-index:99999;text-decoration:none'; document.body.appendChild(a) })()`)
    try {
      // reduced motion: the attribute, the preview text, the animation runtime
      const att = () => val(`document.documentElement.getAttribute('data-kbth-reduced')`)
      check('before: no data-kbth-reduced on <html>', (await att()) === null)
      await goTab(TAB.animation)
      const shimBefore = await cs('.kbth-ldp-text', 'animationName')
      await goTab(TAB.accessibilite)
      await clickEl(toggleQ('reduce')); await sleep(300)
      const attOn = await att()
      await goTab(TAB.animation)
      const shimAfter = await cs('.kbth-ldp-text', 'animationName')
      check('« Réduire les animations »: html[data-kbth-reduced="1"], and the Animation tab’s status-line preview text stops animating (animation-name ' + shimBefore + ' → ' + shimAfter + ')', attOn === '1' && shimBefore !== 'none' && shimAfter === 'none', { attOn, shimBefore, shimAfter })
      await goTab(TAB.accessibilite)
      await clickEl(toggleQ('reduce')); await sleep(300)
      check('… off removes the attribute again', (await att()) === null)
      // focus ring: a real Tab key, then the computed outline of the focused element
      const ring = async () => JSON.parse(await val(`JSON.stringify((() => { const a = document.activeElement; if (!a || a === document.body) return null; const c = getComputedStyle(a); return { tag: a.tagName, vis: a.matches(':focus-visible'), width: c.outlineWidth, style: c.outlineStyle, shadow: c.boxShadow, color: c.outlineColor } })())`))
      const ringSeg = (i) => `document.querySelectorAll('.kbth-adv-pane .kbth-seg')[1].children[${i}]`
      const tabbed = async () => { await press('Tab'); await sleep(200); let r = await ring(); if (!r || !r.vis) { await press('Tab'); await sleep(200); r = await ring() } return r }
      await clickEl(ringSeg(2))                 // Épais
      await sleep(250)
      const thick = await tabbed()
      await clickEl(ringSeg(1))                 // Double
      await sleep(250)
      const dbl = await tabbed()
      await clickEl(ringSeg(0))                 // Accent (default)
      await sleep(250)
      const std = await tabbed()
      check('« Anneau de focus » Épais: after a real Tab key the focused element (:focus-visible) has a 3px solid outline', !!thick && thick.vis === true && thick.width === '3px' && thick.style === 'solid', thick)
      check('… Double: a 2px outline plus a box-shadow ring', !!dbl && dbl.vis === true && dbl.width === '2px' && dbl.style === 'solid' && dbl.shadow !== 'none', dbl)
      check('… Accent (default): neither (outline is not 3px, no ring shadow)', !!std && std.width !== '3px' && !(std.width === '2px' && std.shadow !== 'none'), std)
      // 44 px targets
      const mh = () => cs('.kbth-foot .kbth-btn', 'minHeight')
      const mh0 = await mh()
      await clickEl(toggleQ('targets')); await sleep(300)
      const mh1 = await mh()
      const hgt = px(await cs('.kbth-foot .kbth-btn', 'height'))
      await clickEl(toggleQ('targets')); await sleep(300)
      check('« Cibles de 44 px »: a .kbth-btn computes min-height 44px (and is at least 44 px tall: ' + hgt + '), off gives it back (' + mh0 + ')', mh0 !== '44px' && mh1 === '44px' && hgt >= 44 && (await mh()) !== '44px', { before: mh0, on: mh1, height: hgt })
      // links underline
      const ul = () => cs('#kb-probe', 'textDecorationLine')
      const u0 = await ul()
      await clickEl(toggleQ('underline')); await sleep(300)
      const u1 = await ul()
      await clickEl(toggleQ('underline')); await sleep(300)
      check('« Soulignement des liens »: an <a href> probe computes text-decoration-line underline (was ' + u0 + '), off gives it back', u0 !== 'underline' && u1 === 'underline' && (await ul()) !== 'underline', { before: u0, on: u1 })
      // colour-blind palette: it alone posts the layer
      const succ = () => bodyVar(V.ok)
      const errv = () => bodyVar(V.err)
      const c0 = { ok: await succ(), err: await errv(), pill: (await readPage()).pills[0] }
      await clickEl(toggleQ('cb')); await sleep(400)
      const c1 = { ok: await succ(), err: await errv(), pill: (await readPage()).pills[0] }
      await clickEl(toggleQ('cb')); await sleep(400)
      const c2 = { ok: await succ(), err: await errv(), pill: (await readPage()).pills[0] }
      check('« Palette daltonisme »: success → #56B4E9 and error → #FF8A3D on Dark, and on its own it posts the layer (the pill no longer says « DSH native »)', sameColor(c1.ok, '#56B4E9') && sameColor(c1.err, '#FF8A3D') && !/native|natif/i.test(c1.pill || '') && /native|natif/i.test(c0.pill || ''), { before: c0, on: c1 })
      check('… off gives DSH’s own success/error colours and the « DSH native » pill back', sameColor(c2.ok, c0.ok) && sameColor(c2.err, c0.err) && /native|natif/i.test(c2.pill || ''), { before: c0, after: c2 })
    } finally {
      await val(`(() => { const a = document.getElementById('kb-probe'); if (a) a.remove() })()`)
    }
  })

  await section('boot', 'Every new key survives a reload and applies BEFORE Settings is opened; « Reset all » removes every effect', async () => {
    await openTheme({ fresh: true })
    const base = await pluginStyles()
    const all = { skin: 'custom', wp: 'aurore', wpVis: 100, glassEffect: 'liquid', glassBlur: 30, sidebarOpacity: 40, bgSaturation: 150, bgFit: 'stretch', bgMirror: true,
      ligatures: false, radius: 'soft', showBrand: false, reduceMotion: true, focusRing: 'thick', largeTargets: true, underlineLinks: true, cbSafe: true }
    await seedTheme(all)
    await reloadBoot()
    await sleep(600)
    const wp = await readWallpaper()
    const g = {
      wp: wp.count === 1 && wp.opacity === '1' && /saturate\(1\.5\)/.test(wp.filter) && /^matrix\(-1, 0, 0, 1, 0, 0\)$/.test(String(await val(`(() => { const d = Array.from(document.body.children).find((e) => e.tagName === 'DIV' && e.style.position === 'fixed' && e.style.zIndex === '-1'); return d ? getComputedStyle(d).transform : null })()`))) && wp.bgSize.split(', ')[0] === '100% 100%',
      radius: (await bodyVar('--dsw-radius-md')) === '18px',
      reduced: (await val(`document.documentElement.getAttribute('data-kbth-reduced')`)) === '1',
      lig: (await cs('body', 'fontVariantLigatures')) === 'none',
      brand: (await cs('[data-slot="sidebar.brand.name"]', 'display')) === 'none',
      liquid: (await backdrop(COMPOSER)) === 'blur(30px) saturate(1.65) brightness(1.06)',
      cb: sameColor(await bodyVar(V.ok), '#56B4E9') && sameColor(await bodyVar(V.err), '#FF8A3D'),
      sidebar: Math.abs(alphaOf(await bodyVar('--dsw-specific-sidebar-fill')) - 0.6) < 0.02,
      base: alphaOf(await bodyVar(V.base)) === 0,
    }
    const underlineProbe = await val(`(() => { const a = document.createElement('a'); a.href = '#x'; a.textContent = 'x'; a.style.textDecoration = 'none'; document.body.appendChild(a); const u = getComputedStyle(a).textDecorationLine; a.remove(); return u })()`)
    const bigBtn = await val(`(() => { const b = document.createElement('button'); b.textContent = 'x'; document.body.appendChild(b); const m = getComputedStyle(b).minHeight; b.remove(); return m })()`)
    g.underline = underlineProbe === 'underline'
    g.targets = bigBtn === '44px'
    check('after a reload, with Settings CLOSED, every new key is already applied: wallpaper (mirror, stretch, saturation), radius token 18px, reduced-motion attribute, no ligatures, brand hidden, liquid glass blur(30px), colour-blind colours, sidebar alpha .6, transparent base, link underline, 44 px targets', Object.values(g).every((v) => v === true) && (await val(`!document.querySelector('.kbth-page')`)) === true, g)
    // Settings shows the same state
    await openTheme()
    await goTab(TAB.verre)
    const st = await store()
    check('… and the stored state holds them all (' + Object.keys(all).length + ' keys)', Object.keys(all).every((k) => JSON.stringify(st[k]) === JSON.stringify(all[k])), Object.keys(all).filter((k) => JSON.stringify(st[k]) !== JSON.stringify(all[k])))
    const withEffects = await pluginStyles()
    check('with these effects on, the plugin posts more style (' + withEffects.len + ' vs ' + base.len + ' characters in its style tags) — so the next check can tell they went away', withEffects.len > base.len + 200, { base, withEffects })
    if (!modeSafe) { console.log('  · skipped: « Reset all » forces Dark and the mode found is ' + startMode); return }
    await clickEl(Q.footBtn(0)); await sleep(700)
    const st2 = await store()
    const left = Object.keys(DEFAULTS).filter((k) => JSON.stringify(st2[k]) !== JSON.stringify(DEFAULTS[k]))
    const after = await pluginStyles()
    const wp2 = await readWallpaper()
    const underline2 = await val(`(() => { const a = document.createElement('a'); a.href = '#x'; a.textContent = 'x'; a.style.textDecoration = 'none'; document.body.appendChild(a); const u = getComputedStyle(a).textDecorationLine; a.remove(); return u })()`)
    const big2 = await val(`(() => { const b = document.createElement('button'); b.textContent = 'x'; document.body.appendChild(b); const m = getComputedStyle(b).minHeight; b.remove(); return m })()`)
    check('« Reset all » returns every key to its default', left.length === 0, left.map((k) => k + '=' + JSON.stringify(st2[k])))
    check('… and removes the effects: wallpaper element gone, --dsw-radius-md back to 12px, no reduced-motion attribute, ligatures back, brand shown, no backdrop-filter, DSH’s own success colour, no underline/44 px rule', wp2.count === 0 && (await bodyVar('--dsw-radius-md')) === '12px' && (await val(`document.documentElement.getAttribute('data-kbth-reduced')`)) === null && (await cs('body', 'fontVariantLigatures')) !== 'none' && (await cs('[data-slot="sidebar.brand.name"]', 'display')) !== 'none' && (await backdrop(COMPOSER)) === 'none' && sameColor(await bodyVar(V.ok), NATIVE[V.ok]) && underline2 !== 'underline' && big2 !== '44px', { wp: wp2.count, md: await bodyVar('--dsw-radius-md'), underline2, big2 })
    check('… the plugin leaves no style of its own behind besides the page’s (' + after.count + ' tag(s), ' + after.len + ' characters; at the start ' + base.count + ' / ' + base.len + ')', after.count === base.count && after.len === base.len, { base, after })
    const tokR = await readTokens()
    check('… and the 17 tokens are the native ones', TOKEN_VARS.every((v) => sameColor(tokR[v], NATIVE[v])), TOKEN_VARS.filter((v) => !sameColor(tokR[v], NATIVE[v])))
  })

  // ═══ 14. The « Animation » tab ═════════════════════════════════════════════════════
  // Settings live in their own key (kybernos.theme.loader.v1), the host (disk) half is OFF for the whole run.
  const ldGet = async () => { const raw = await val(`localStorage.getItem(${JSON.stringify(LD_KEY)})`); if (raw === null || raw === undefined) return null; try { return JSON.parse(raw) } catch (e) { return undefined } }
  const ldCacheGet = async () => { const raw = await val(`localStorage.getItem(${JSON.stringify(LD_CACHE)})`); if (raw === null || raw === undefined) return null; try { return JSON.parse(raw) } catch (e) { return undefined } }
  const kb = (name, extra = '') => `document.querySelector('[data-kb=${name}]${extra}')`
  const cardsInfo = async () => JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('.kbth-lcard')).map((c) => { const b = c.querySelector('[data-kb=ld-toggle]'); const n = c.querySelector('.kb-ld'); return { id: c.getAttribute('data-id'), name: c.querySelector('.kbth-lcard-nm').textContent, on: c.classList.contains('on'), disabled: !!(b && b.disabled), label: b ? b.textContent.trim() : '', kind: n ? n.getAttribute('data-kind') : null } }))`))
  const pickerIs = (open) => until(async () => ((await val(`!!document.querySelector('[data-kb=ld-picker]')`)) === true) === open, 3000)
  const noteOf = async () => JSON.parse(await val(`JSON.stringify((() => { const n = document.querySelector('[data-kb=ld-note]'); return n ? { text: n.textContent.trim(), cls: n.className } : null })())`))
  const ambOptions = async () => JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb=ld-amb] .kbth-fsopt')).map((b) => ({ id: b.getAttribute('data-id'), name: b.querySelector('.kbth-fsopt-name').textContent, disabled: b.disabled, active: b.getAttribute('data-actif') === '1', selected: b.getAttribute('aria-selected') === 'true' })))`))
  const ambOpen = () => val(`${kb('ld-amb', ' .kbth-fsbtn')}.getAttribute('aria-expanded')`)
  const settingsPageOpen = () => val(`!!document.querySelector('.kbth-page')`)
  const activeKb = () => val(`(document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-kb')) || null`)
  const setBody = `document.querySelector('.kbth-setbody')`
  const setSlider = (re) => Q.slider(re, setBody)
  const openAnimation = async (opts) => { await openTheme(opts); await goTab(TAB.animation) }

  await section('animation', 'The « Animation » tab: page, picker, text ambiance, word pack, settings, imports', async () => {
    await openTheme({ fresh: true })
    check('the animation host store is OFF in this page (window.__KB_THEME_HOST_STORE__ === false): nothing can reach the disk', (await val(`window.__KB_THEME_HOST_STORE__`)) === false)
    const sum0 = JSON.parse(await val(`JSON.stringify((() => { const e = document.querySelector('[data-kb=ld-summary]'); return e ? { text: e.innerText.replace(/\\s+/g, ' ').trim(), btn: !!e.querySelector('[data-kb=ld-open]') } : null })())`))
    check('« Essentiel » ends with a one-block summary of the thinking animation (title, one hint line, a button to open the tab)', sum0 !== null && sum0.btn === true && sum0.text.length > 20, sum0)

    // ── (a) the page: four blocks, nothing of the library or the import until the picker opens, settings folded ──
    await goTab(TAB.animation)
    const a = JSON.parse(await val(`JSON.stringify((() => {
      const p = document.querySelector('[data-kb=ld-pane]')
      if (!p) return null
      const disc = p.querySelector('[data-kb=ld-settings]')
      const sm = disc ? disc.querySelector('.kbth-disc-s') : null
      const cs = sm ? getComputedStyle(sm) : null
      const has = (n) => !!p.querySelector('[data-kb=' + n + ']')
      return { preview: has('ld-preview'), slots: p.querySelectorAll('.kbth-lds').length, empty: p.querySelectorAll('.kbth-lds.empty').length, openPicker: has('ld-open-picker'), surpriseAnim: has('ld-surprise-anim'),
        amb: has('ld-amb'), surpriseText: has('ld-surprise-text'), openPack: has('ld-open-pack'), settings: !!disc, expanded: disc ? disc.getAttribute('aria-expanded') : null,
        body: !!p.querySelector('.kbth-setbody'), summary: sm ? sm.textContent : '', oneLine: cs ? (cs.whiteSpace === 'nowrap' && cs.textOverflow === 'ellipsis' && sm.textContent.indexOf('\\n') < 0) : false,
        discH: disc ? Math.round(disc.getBoundingClientRect().height) : 0, picker: !!document.querySelector('[data-kb=ld-picker]'), file: !!document.querySelector('[data-kb=ld-file]'),
        cards: document.querySelectorAll('.kbth-lcard').length, grid: !!document.querySelector('.kbth-lgrid'), drawDisabled: (p.querySelector('[data-kb=ld-draw]') || {}).disabled === true }
    })())`))
    check('the tab holds four blocks: preview, rotation (4 free slots + picker button + « surprise »), text ambiance (select + « surprise » + pack), folded settings', a !== null && a.preview && a.slots === 4 && a.empty === 4 && a.openPicker && a.surpriseAnim && a.amb && a.surpriseText && a.openPack && a.settings, a)
    check('… and nothing of the library or of the import is in the page until the picker opens (no dialog, no file input, no grid, no card)', a !== null && !a.picker && !a.file && !a.grid && a.cards === 0, a && { picker: a.picker, file: a.file, grid: a.grid, cards: a.cards })
    check('… the settings are folded behind one line of summary (aria-expanded false, no body, a single ellipsised line mentioning px and ×)', a !== null && a.expanded === 'false' && a.body === false && a.oneLine === true && a.discH > 0 && a.discH < 70 && /px/.test(a.summary) && /×|x/.test(a.summary), a && { expanded: a.expanded, body: a.body, summary: a.summary, oneLine: a.oneLine, h: a.discH })
    check('… with nothing chosen, the preview simulation button is disabled (the DSH whale tail is what would show)', a !== null && a.drawDisabled === true)
    await shot('09-animation')

    // ── (b) the picker ───────────────────────────────────────────────────────────────
    await clickEl(kb('ld-open-picker'))
    check('« + Add an animation » opens the picker', await pickerIs(true))
    const pk = JSON.parse(await val(`JSON.stringify((() => { const d = document.querySelector('[data-kb=ld-picker]'); return { role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'), parentIsBody: d.parentElement === document.body, tabs: Array.from(document.querySelectorAll('[data-kb=ld-tab]')).map((b) => [b.getAttribute('data-id'), b.textContent.trim(), b.getAttribute('aria-pressed')]), focusIn: d === document.activeElement || d.contains(document.activeElement) } })())`))
    check('… it is a modal dialog mounted on <body> (portal), focus moved inside, three tabs with « examples » pressed', pk.role === 'dialog' && pk.modal === 'true' && pk.parentIsBody === true && pk.focusIn === true && pk.tabs.map((t) => t[0]).join() === 'examples,mine,add' && pk.tabs[0][2] === 'true', pk)
    let cards = await cardsInfo()
    check('… 14 example cards (and the tab label says 14)', cards.length === 14 && /14/.test(pk.tabs[0][1]), { n: cards.length, label: pk.tabs[0][1] })
    for (let i = 0; i < 4; i += 1) {
      await clickEl(`document.querySelectorAll('.kbth-lcard')[${i}].querySelector('[data-kb=ld-toggle]')`)
      await until(async () => { const s = await ldGet(); return s && s.sel.length === i + 1 }, 2500)
    }
    cards = await cardsInfo()
    const rot4 = await ldGet()
    const others = cards.filter((c) => !c.on)
    check('adding 4 animations fills the rotation (stored sel of 4), and the 5th card’s button is disabled, reading « Rotation pleine / Full rotation »', rot4 && rot4.sel.length === 4 && cards.filter((c) => c.on).length === 4 && others.length === 10 && others.every((c) => c.disabled) && /pleine|full/i.test(others[0].label), { sel: rot4 && rot4.sel, label: others[0] && others[0].label, disabled: others.filter((c) => c.disabled).length })
    const fullHint = await val(`(document.querySelector('[data-kb=ld-picker] .kbth-mft .kbth-hint') || { textContent: '' }).textContent`)
    check('… the footer says the rotation is full', /pleine|full/i.test(String(fullHint)), fullHint)
    await clickEl(`document.querySelectorAll('.kbth-lcard')[3].querySelector('[data-kb=ld-toggle]')`)
    await until(async () => { const s = await ldGet(); return s && s.sel.length === 3 }, 2500)
    cards = await cardsInfo()
    check('removing one frees a slot: stored sel of 3, the other cards are enabled again', cards.filter((c) => c.on).length === 3 && cards.filter((c) => !c.on).every((c) => !c.disabled), cards.filter((c) => c.disabled).length)
    const chosenIds = (await ldGet()).sel
    const chosenNames = cards.filter((c) => c.on).map((c) => c.name)
    await clickEl(`document.querySelectorAll('.kbth-pillb')[1]`)
    await sleep(200)
    const fMono = await cardsInfo()
    await clickEl(`document.querySelectorAll('.kbth-pillb')[2]`)
    await sleep(200)
    const fCol = await cardsInfo()
    await clickEl(`document.querySelectorAll('.kbth-pillb')[0]`)
    await sleep(200)
    const fAll = await cardsInfo()
    check('filters: « one colour » shows only mono animations, « coloured » only the others, « all » the 14', fMono.length >= 5 && fMono.every((c) => c.kind === 'mono') && fCol.length >= 4 && fCol.every((c) => c.kind === 'color') && fMono.length + fCol.length === 14 && fAll.length === 14, { mono: fMono.length, color: fCol.length, all: fAll.length })
    await press('Escape')
    const closed = await pickerIs(false)
    check('Escape closes the picker without closing Settings, and the focus returns to the button that opened it', closed && (await settingsPageOpen()) === true && (await activeKb()) === 'ld-open-picker', { closed, settings: await settingsPageOpen(), focus: await activeKb() })
    await clickEl(kb('ld-open-picker'))
    await pickerIs(true)
    const outside = []
    for (let i = 0; i < 24; i += 1) {
      await press('Tab')
      const inside = await val(`(() => { const d = document.querySelector('[data-kb=ld-picker]'); return !!d && (d === document.activeElement || d.contains(document.activeElement)) })()`)
      if (inside !== true) outside.push('Tab ' + (i + 1) + ': ' + await val(`document.activeElement ? document.activeElement.tagName + '.' + String(document.activeElement.className).slice(0, 30) : 'none'`))
    }
    for (let i = 0; i < 6; i += 1) {
      await press('Tab', 1, 8)
      const inside = await val(`(() => { const d = document.querySelector('[data-kb=ld-picker]'); return !!d && (d === document.activeElement || d.contains(document.activeElement)) })()`)
      if (inside !== true) outside.push('Shift+Tab ' + (i + 1))
    }
    check('Tab (24 times) and Shift+Tab (6 times) never leave the open picker', outside.length === 0, outside.slice(0, 3))
    await press('Escape'); await pickerIs(false)

    // ── (d) the text ambiance: a big select ─────────────────────────────────────────
    await clickEl(kb('ld-amb', ' .kbth-fsbtn'))
    await sleep(250)
    let opts = await ambOptions()
    const perso0 = opts.find((o) => o.id === 'perso')
    check('the ambiance select opens: 12 ambiances + « Mon pack », which is disabled while the pack is empty', (await ambOpen()) === 'true' && opts.length === 13 && opts.filter((o) => o.id !== 'perso').length === 12 && perso0 !== undefined && perso0.disabled === true && opts[0].id === 'dsh' && opts[0].selected === true, { n: opts.length, perso: perso0, first: opts[0] })
    await page.send('Input.insertText', { text: 'sante' }); await sleep(200)
    const oSante = await ambOptions()
    await typeInto(`document.querySelector('[data-kb=ld-amb] .kbth-fssearch')`, 'edu')
    const oEdu = await ambOptions()
    check('search ignores accents: « sante » → Santé mentale only, « edu » → Éducation only', oSante.length === 1 && oSante[0].id === 'sante-mentale' && oEdu.length === 1 && oEdu[0].id === 'education', { sante: oSante.map((o) => o.name), edu: oEdu.map((o) => o.name) })
    await typeInto(`document.querySelector('[data-kb=ld-amb] .kbth-fssearch')`, '')
    await press('ArrowDown'); await sleep(150)
    const idxDown = (await ambOptions()).findIndex((o) => o.active)
    await press('Enter'); await sleep(300)
    const stMer = await ldGet()
    check('ArrowDown moves to the second ambiance and Enter picks it (« mer »): stored, list closed', idxDown === 1 && stMer && stMer.pack === 'mer' && (await ambOpen()) === 'false', { idxDown, pack: stMer && stMer.pack, open: await ambOpen() })
    await clickEl(kb('ld-amb', ' .kbth-fsbtn')); await sleep(200)
    await press('Escape'); await sleep(350)
    const escOpen = await settingsPageOpen()
    check('Escape closes only the ambiance list, not Settings (a real key press on the focused search field)', (await ambOpen()) === 'false' && escOpen === true, { settingsStillOpen: escOpen })
    if (!escOpen) await openAnimation()
    await clickEl(kb('ld-amb', ' .kbth-fsbtn')); await sleep(200)
    await clickEl(kb('ld-pane', ' .kbth-sec-t'))
    await sleep(250)
    check('a click outside closes the ambiance list', (await ambOpen()) === 'false')
    // the sample under the big button MOVES: a different trio of the pack’s words every ~3 s; DSH’s own does not
    const sample = () => val(`document.querySelector('[data-kb=ld-amb] .kbth-fsmeta').textContent`)
    const sam1 = await sample()
    await sleep(3700)
    const sam2 = await sample()
    check('the ambiance sample under the big button MOVES: after ~3.7 s it is a different trio of the same pack’s words (« ' + sam1 + ' » → « ' + sam2 + ' »)', sam1 !== sam2 && sam1.split('·').length >= 3 && sam2.split('·').length >= 3, { sam1, sam2 })
    await clickEl(kb('ld-amb', ' .kbth-fsbtn')); await sleep(250)
    await clickEl(`document.querySelector('[data-kb=ld-amb] .kbth-fsopt[data-id="dsh"]')`); await sleep(300)
    const d1 = await sample()
    await sleep(3700)
    const d2 = await sample()
    check('« DSH d’origine » shows « Deep diving for 12s ··· » and does not move', /Deep diving for 12s/.test(d1) && d1 === d2, { d1, d2 })
    const packBefore = (await ldGet()).pack
    await clickEl(kb('ld-surprise-text'))
    await sleep(250)
    const packAfter = (await ldGet()).pack
    check('« Surprise me » (text) switches to another ambiance (not DSH’s own, not the empty pack): ' + packBefore + ' → ' + packAfter, packAfter !== packBefore && packAfter !== 'dsh' && packAfter !== 'perso', { packBefore, packAfter })
    const selBefore = (await ldGet()).sel.join()
    await clickEl(kb('ld-surprise-anim'))
    await sleep(300)
    const stSurp = await ldGet()
    check('« Surprise me » (animations) puts exactly 3 distinct catalogue animations in the rotation', stSurp.sel.length === 3 && new Set(stSurp.sel).size === 3 && stSurp.sel.every((id) => cards.some((c) => c.id === id)), { before: selBefore, after: stSurp.sel })
    // put back a known rotation (ring, orbit, pulse) through the picker, as a user would
    await clickEl(kb('ld-open-picker')); await pickerIs(true)
    for (const c of await cardsInfo()) if (c.on && !chosenIds.includes(c.id)) await clickEl(`document.querySelector('.kbth-lcard[data-id="${c.id}"] [data-kb=ld-toggle]')`)
    for (const id of chosenIds) { const c = (await cardsInfo()).find((x) => x.id === id); if (c && !c.on) await clickEl(`document.querySelector('.kbth-lcard[data-id="${id}"] [data-kb=ld-toggle]')`) }
    await press('Escape'); await pickerIs(false)
    check('… the known rotation is back (' + chosenIds.join(', ') + ')', JSON.stringify((await ldGet()).sel.slice().sort()) === JSON.stringify(chosenIds.slice().sort()), (await ldGet()).sel)

    // ── (e) my pack of words ───────────────────────────────────────────────────────────
    await clickEl(kb('ld-open-pack'))
    await until(() => val(`!!document.querySelector('[data-kb=ld-word]')`), 4000)
    const packDlg = await val(`!!document.querySelector('[data-kb=ld-pack]')`)
    const chips = () => val(`Array.from(document.querySelectorAll('.kbth-wchip')).map((c) => c.firstChild.textContent)`)
    await typeInto(kb('ld-word'), 'Café')
    await press('Enter'); await sleep(250)
    const c1 = await chips()
    await typeInto(kb('ld-word'), 'CAFÉ')
    await press('Enter'); await sleep(250)
    const c2 = await chips()
    await typeInto(kb('ld-word'), 'Thé')
    await until(() => val(`!!document.querySelector('[data-kb=ld-wadd]')`), 3000)
    await clickEl(kb('ld-wadd')); await sleep(250)
    const c3 = await chips()
    const cache1 = await ldCacheGet()
    check('the pack window opens; a word typed + Enter becomes a chip and is kept (cache)', packDlg === true && JSON.stringify(c1) === '["Café"]' && cache1 && Array.isArray(cache1.words) && cache1.words.includes('Café'), { packDlg, c1, cache: cache1 && cache1.words })
    check('a duplicate (« CAFÉ » after « Café », case-insensitive) is refused: still one Café; a different word (« Thé ») is added with the button', JSON.stringify(c2) === '["Café"]' && c3.length === 2 && c3.includes('Thé'), { c2, c3 })
    await clickEl(`document.querySelectorAll('[data-kb=ld-wdel]')[1]`); await sleep(250)
    const c4 = await chips()
    check('a chip is removed with its × (Thé gone, Café stays)', JSON.stringify(c4) === '["Café"]', c4)
    await clickEl(`document.querySelectorAll('[data-kb=ld-wdel]')[0]`); await sleep(250)
    await val(`window.__copied = []; Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: (t) => { window.__copied.push(String(t)); return Promise.resolve() } })`)
    const cmd2Shown = await val(`(document.querySelector('[data-kb=ld-pack] .kbth-codeln span') || { textContent: '' }).textContent`)
    await clickEl(kb('ld-copy2')); await sleep(250)
    check('the pack window shows and copies DSH’s real command form: /skill-loading-text <your job>', /^\/skill-loading-text\s+\S/.test(String(cmd2Shown)) && (await val(`window.__copied[0]`)) === cmd2Shown, { shown: cmd2Shown })
    await press('Escape'); await pickerIs(false); await sleep(200)
    check('Escape closes the pack window and the focus returns to « Modifier mon pack »', (await val(`!document.querySelector('[data-kb=ld-pack]')`)) === true && (await activeKb()) === 'ld-open-pack' && (await settingsPageOpen()) === true, { focus: await activeKb() })
    await clickEl(kb('ld-amb', ' .kbth-fsbtn')); await sleep(200)
    const persoEmpty = (await ambOptions()).find((o) => o.id === 'perso')
    await press('Escape'); await sleep(250)
    if (!(await settingsPageOpen())) await openAnimation()
    check('with the pack emptied again, « Mon pack » is disabled', persoEmpty && persoEmpty.disabled === true, persoEmpty)
    await clickEl(kb('ld-open-pack')); await sleep(300)
    await typeInto(kb('ld-word'), 'Café'); await press('Enter'); await sleep(200)
    await typeInto(kb('ld-word'), 'Thé'); await press('Enter'); await sleep(200)
    await press('Escape'); await sleep(300)
    await clickEl(kb('ld-amb', ' .kbth-fsbtn')); await sleep(200)
    const persoFull = (await ambOptions()).find((o) => o.id === 'perso')
    await clickEl(`document.querySelector('[data-kb=ld-amb] .kbth-fsopt[data-id="perso"]')`).catch(() => {})
    await sleep(300)
    check('once a word exists, « Mon pack » becomes selectable and picking it is stored (pack = perso)', persoFull && persoFull.disabled === false && (await ldGet()).pack === 'perso', { perso: persoFull, pack: (await ldGet()).pack })

    // ── (c) the store: selection, settings, resets ─────────────────────────────────────
    const ld1 = await ldGet()
    check('the choice is stored in kybernos.theme.loader.v1 (sel, pack) and NOT in kybernos.theme.v1', ld1 && ld1.sel.length === 3 && ld1.pack === 'perso' && (await val(`(() => { const t = JSON.parse(localStorage.getItem(${JSON.stringify(STORE)}) || '{}'); return t.sel === undefined && t.pack === undefined && t.loader === undefined })()`)) === true, ld1)
    await openTheme()           // a reload; the stored state is kept
    const sumAfter = await val(`(document.querySelector('[data-kb=ld-summary]') || { innerText: '' }).innerText.replace(/\\s+/g, ' ')`)
    await goTab(TAB.animation)
    const slotIds = await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb=ld-remove]')).map((b) => b.getAttribute('data-id')))`)
    const slotNames = JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('.kbth-lds-nm')).map((e) => e.textContent))`))
    const sumNames = (String(sumAfter).split(/NOUVEAU|NEW/)[1] || '').split('·')[0].split(',').map((x) => x.trim()).filter(Boolean)
    check('after a reload the selection is still there: the rotation shows the same 3 animations and « Essentiel » lists 3 names in its summary (not DSH’s whale)', JSON.stringify(JSON.parse(slotIds).slice().sort()) === JSON.stringify(ld1.sel.slice().sort()) && sumNames.length === ld1.sel.length, { slots: JSON.parse(slotIds), names: slotNames, summary: sumAfter, listed: sumNames })
    await clickEl(kb('ld-open-picker')); await pickerIs(true)
    const cardsAfter = await cardsInfo()
    check('… the picker shows them as chosen (« Retirer / Remove ») and the pack as « perso » in the select', cardsAfter.filter((c) => c.on).map((c) => c.id).sort().join() === ld1.sel.slice().sort().join() && cardsAfter.filter((c) => c.on).every((c) => /retir|remove/i.test(c.label)), cardsAfter.filter((c) => c.on))
    await press('Escape'); await pickerIs(false)
    // settings
    await clickEl(kb('ld-settings')); await sleep(250)
    const openedBody = await val(`!!${setBody}`)
    await clickEl(`${setBody}.querySelectorAll('.kbth-seg')[0].children[2]`)            // size: Grande
    await focusEl(setSlider('/vitesse|speed/i')); await press('End')                     // speed 2
    await focusEl(setSlider('/d[ée]lai|delay/i')); await press('Home')                  // delay 0
    await clickEl(`${setBody}.querySelectorAll('.kbth-seg')[1].children[1]`)            // change every 8 s
    await sleep(300)
    const ld2 = await ldGet()
    check('the settings disclosure opens; size Large, speed 2×, delay 0 ms, « every 8 s » are stored in the loader key', openedBody === true && ld2.size === 'large' && ld2.speed === 2 && ld2.delay === 0 && ld2.rot === '8', ld2)
    await openTheme()
    await goTab(TAB.animation)
    await clickEl(kb('ld-settings')); await sleep(250)
    const summaryNow = await val(`document.querySelector('[data-kb=ld-settings] .kbth-disc-s').textContent`)
    const ld3 = await ldGet()
    const sizeSeg = JSON.parse(await val(`JSON.stringify(Array.from(${setBody}.querySelectorAll('.kbth-seg')[0].children).map((b) => b.getAttribute('aria-pressed')))`))
    check('… and they survive a reload: same values, the summary line says 40 px and 2,00 ×, the size segment shows Large', ld3.size === 'large' && ld3.speed === 2 && ld3.delay === 0 && ld3.rot === '8' && /40/.test(summaryNow) && /2[,.]00/.test(summaryNow) && JSON.stringify(sizeSeg) === '["false","false","true"]', { ld3, summaryNow, sizeSeg })
    await clickEl(kb('ld-reset')); await sleep(300)
    const ld4 = await ldGet()
    check('« Rétablir ces réglages » puts size / speed / delay / change-rate back to standard / 1× / 300 ms / one word per answer, and keeps the rotation AND the pack', ld4.size === 'standard' && ld4.speed === 1 && ld4.delay === 300 && ld4.rot === 'fixed' && ld4.dur === true && JSON.stringify(ld4.sel) === JSON.stringify(ld1.sel) && ld4.pack === 'perso', ld4)
    if (modeSafe) {
      const rawBefore = await val(`localStorage.getItem(${JSON.stringify(LD_KEY)})`)
      const cacheBefore = await val(`localStorage.getItem(${JSON.stringify(LD_CACHE)})`)
      await clickEl(Q.footBtn(0)); await sleep(500)
      const rawAfter = await val(`localStorage.getItem(${JSON.stringify(LD_KEY)})`)
      const cacheAfter = await val(`localStorage.getItem(${JSON.stringify(LD_CACHE)})`)
      const themeAfter = await store()
      check('the Theme page’s « Reset all » leaves the animation store alone (kybernos.theme.loader.v1 and its cache are byte-for-byte the same) while it resets the theme store', rawBefore === rawAfter && cacheBefore === cacheAfter && themeAfter && themeAfter.skin === 'dsh', { same: rawBefore === rawAfter, cacheSame: cacheBefore === cacheAfter })
    } else console.log('  · skipped: « Reset all » forces Dark and the mode found is ' + startMode)

    // ── (f) imports in « Add your own » ───────────────────────────────────────────────
    await clickEl(kb('ld-open-picker')); await pickerIs(true)
    const importFile = (name, { text, bytes, type }) => val(`(() => { const input = document.querySelector('[data-kb=ld-file]'); if (!input) return false; const dt = new DataTransfer(); dt.items.add(new File([${text !== undefined ? JSON.stringify(text) : `'x'.repeat(${bytes})`}], ${JSON.stringify(name)}, { type: ${JSON.stringify(type || '')} })); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
    const doImport = async (name, spec) => {
      await clickEl(`document.querySelector('[data-kb=ld-tab][data-id=add]')`)       // also clears the previous banner
      await sleep(150)
      const ok = await importFile(name, spec)
      const note = await until(async () => noteOf(), 4000)
      await sleep(150)
      const tabNow = await val(`(document.querySelector('[data-kb=ld-tab][aria-pressed=true]') || { getAttribute: () => null }).getAttribute('data-id')`)
      return { ok, note: note || null, tab: tabNow }
    }
    const mineCount = async () => Number(((await val(`document.querySelector('[data-kb=ld-tab][data-id=mine]').textContent`)).match(/\d+/) || ['-1'])[0])
    const GOOD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><g><animateTransform attributeName="transform" type="rotate" from="0 24 24" to="360 24 24" dur="0.8s" repeatCount="indefinite"/><circle cx="24" cy="7" r="6" fill="currentColor"/><circle cx="24" cy="41" r="3" fill="currentColor" opacity=".4"/></g></svg>'
    const HOSTILE = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 48 48" onload="alert(1)"><script>alert(1)</script><foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject><image href="http://evil.example/x.png" width="10" height="10"/><a xlink:href="http://evil.example/"><circle cx="24" cy="24" r="10" fill="currentColor" onclick="alert(2)"/></a><circle cx="8" cy="8" r="3" fill="currentColor"><animate attributeName="r" values="3;6;3" dur="1s" repeatCount="indefinite"/></circle></svg>'
    const n0 = await mineCount()
    await clickEl(`document.querySelector('[data-kb=ld-tab][data-id=add]')`); await sleep(200)
    await val(`window.__copied = []; Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: (t) => { window.__copied.push(String(t)); return Promise.resolve() } })`)
    const cmdShown = await val(`(document.querySelector('.kbth-add2 .kbth-codeln span') || { textContent: '' }).textContent`)
    await clickEl(kb('ld-copy')); await sleep(250)
    const cmdCopied = await val(`window.__copied[0]`)
    check('« Create with Claude » shows and copies DSH’s real command form: /skill-loader <description>', /^\/skill-loader\s+\S/.test(String(cmdShown)) && cmdCopied === cmdShown, { shown: cmdShown, copied: cmdCopied })
    const rGood = await doImport('spin-good.svg', { text: GOOD, type: 'image/svg+xml' })
    check('host OFF (flag): a good SVG is kept in this browser and the banner says so in yellow — « added … not saved on the disk, it stays in this browser until the reload » — and the picker switches to « Mes animations »', rGood.note !== null && /warn/.test(rGood.note.cls) && /enregistr|saved/i.test(rGood.note.text) && rGood.tab === 'mine', { note: rGood.note, tab: rGood.tab })
    await clickEl(`document.querySelector('[data-kb=ld-tab][data-id=mine]')`); await sleep(400)
    const mine1 = await cardsInfo()
    const goodCard = mine1.find((c) => /spin-good/.test(c.name))
    check('a good animated SVG with currentColor lands in « Mes animations » (' + (n0 + 1) + ' there), as a one-colour (mono) animation', !!goodCard && (await mineCount()) === n0 + 1 && goodCard.kind === 'mono', { goodCard, n: await mineCount() })
    if (goodCard) {
      const pv = JSON.parse(await val(`JSON.stringify((() => { const c = document.querySelector('.kbth-lcard[data-id="${goodCard.id}"]'); c.scrollIntoView({ block: 'center' }); const n = c.querySelector('.kb-ld'); const cs = getComputedStyle(n); const r = n.getBoundingClientRect(); return { cls: n.className, mask: cs.maskImage || cs.webkitMaskImage, w: r.width, h: r.height, x: r.left, y: r.top, sx: window.scrollX, sy: window.scrollY, bg: cs.backgroundColor, color: cs.color } })())`))
      check('… and renders as a CSS mask over the text colour (kb-ld-mask, mask-image is a data:image/svg+xml url, background = currentColor)', /kb-ld-mask/.test(pv.cls) && /^url\(.*data:image\/svg\+xml/.test(pv.mask) && pv.bg === pv.color && pv.w > 20, pv)
      const sample = async (clip) => {
        const frames = []
        for (const gap of [53, 137, 211, 89, 163, 301]) {     // irregular gaps: a loop period can never line up with all of them
          const r = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, clip.x - 2) + (clip.sx || 0), y: Math.max(0, clip.y - 2) + (clip.sy || 0), width: Math.ceil(clip.w) + 4, height: Math.ceil(clip.h) + 4, scale: 1 } })
          frames.push(r && r.result ? r.result.data : null)
          await sleep(gap)
        }
        return new Set(frames.filter((f) => f !== null)).size
      }
      let distinct = await sample(pv)
      if (distinct < 2) distinct = Math.max(distinct, await sample(pv))
      // positive control of the measure itself: the same sampling on a catalogue animation that is known to move
      await clickEl(`document.querySelector('[data-kb=ld-tab][data-id=examples]')`); await sleep(400)
      const rg = JSON.parse(await val(`JSON.stringify((() => { const c = document.querySelector('.kbth-lcard[data-id="ring"]'); c.scrollIntoView({ block: 'center' }); const r = c.querySelector('.kb-ld').getBoundingClientRect(); return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height } })())`))
      let ctlDistinct = await sample({ x: rg.x, y: rg.y, w: rg.w, h: rg.h })
      if (ctlDistinct < 2) ctlDistinct = Math.max(ctlDistinct, await sample({ x: rg.x, y: rg.y, w: rg.w, h: rg.h }))
      const animOk = (await needVisible('the animation checks'))
      if (animOk) check('the pixel sampling itself is sound: on the catalogue’s « Anneau », known to spin, 6 irregularly spaced samples give ' + ctlDistinct + ' distinct images', ctlDistinct >= 2, ctlDistinct)
      await clickEl(`document.querySelector('[data-kb=ld-tab][data-id=mine]')`); await sleep(300)
      if (animOk && ctlDistinct >= 2) check('… and the mask really animates: 6 irregularly spaced pixel samples of the card give ' + distinct + ' distinct images (a frozen mask would give 1)', distinct >= 2, { distinct })
    }
    const rHostile = await doImport('hostile.svg', { text: HOSTILE, type: 'image/svg+xml' })
    check('the hostile SVG’s banner says how many dangerous elements were removed (yellow here: not saved on the disk)', rHostile.note !== null && /\d+\D{0,40}(retir|remov)/i.test(rHostile.note.text) && /warn/.test(rHostile.note.cls), rHostile.note)
    await clickEl(`document.querySelector('[data-kb=ld-tab][data-id=mine]')`); await sleep(400)
    const mine2 = await cardsInfo()
    const hostCard = mine2.find((c) => /hostile/.test(c.name))
    // choose it (rotation has 3, one free) so the browser cache keeps its data, then read both the cache and the rendered url
    if (hostCard) { await clickEl(`document.querySelector('.kbth-lcard[data-id="${hostCard.id}"] [data-kb=ld-toggle]')`); await sleep(400) }
    const cacheH = await ldCacheGet()
    const stored = cacheH && Array.isArray(cacheH.loaders) ? cacheH.loaders.find((l) => hostCard && l.id === hostCard.id) : null
    const rendered = hostCard ? await val(`(() => { const n = document.querySelector('.kbth-lcard[data-id="${hostCard.id}"] .kb-ld'); if (!n) return null; const cs = getComputedStyle(n); const img = n.querySelector('img'); const u = img ? img.src : (cs.maskImage || cs.webkitMaskImage); const body = String(u).slice(String(u).indexOf(',') + 1).replace(/"?\\)\\s*$/, ''); try { return decodeURIComponent(body) } catch (e) { return body } })()`) : null
    const BAD = /<script|onload|onclick|foreignobject|evil\.example|javascript:|<image|xlink:href="http/i
    check('a hostile SVG (script, onload, onclick, http link, image, foreignObject) is accepted only after cleaning: it appears in « Mes animations »', !!hostCard, mine2.map((c) => c.name))
    check('… and neither the stored data (browser cache of the chosen animation) nor the url the card renders contains any of those pieces', !!stored && typeof stored.data === 'string' && !BAD.test(stored.data) && typeof rendered === 'string' && !BAD.test(rendered) && /<svg/.test(rendered), { stored: stored && String(stored.data).slice(0, 160), rendered: String(rendered).slice(0, 160) })
    check('… the harmless parts survived (the circles and the SMIL animate are still there)', !!stored && /<circle/.test(stored.data) && /<animate/.test(stored.data), stored && String(stored.data).slice(0, 200))
    const nBefore = await mineCount()
    const rBig = await doImport('huge.svg', { bytes: 215040, type: 'image/svg+xml' })
    check('a 210 KB file is refused with the size message (« pèse 210 Ko … la limite est de 200 Ko »), as an error banner, and nothing is added', rBig.note !== null && /err/.test(rBig.note.cls) && /210/.test(rBig.note.text) && /200/.test(rBig.note.text) && (await mineCount()) === nBefore, rBig.note)
    const rExe = await doImport('virus.exe', { text: 'MZ\u0090\u0000', type: 'application/x-msdownload' })
    check('a .exe is refused (« Format .exe non pris en charge »), as an error banner, and nothing is added', rExe.note !== null && /err/.test(rExe.note.cls) && /exe/i.test(rExe.note.text) && (await mineCount()) === nBefore, rExe.note)
    const rJson = await doImport('not-lottie.json', { text: '{"hello":"world","layers":"nope"}', type: 'application/json' })
    check('a JSON that is not Lottie is refused (« n’est pas une animation Lottie »), as an error banner, and nothing is added', rJson.note !== null && /err/.test(rJson.note.cls) && /lottie/i.test(rJson.note.text) && (await mineCount()) === nBefore, rJson.note)
    const rBad = await doImport('broken.json', { text: '{ not json', type: 'application/json' })
    check('invalid JSON is refused as well', rBad.note !== null && /err/.test(rBad.note.cls) && (await mineCount()) === nBefore, rBad.note)
    // (g2) the disk unreachable with the flag ON — every request to the route is blocked in the browser itself, so nothing can be written
    await page.send('Network.enable', {})
    await page.send('Network.setBlockedURLs', { urls: ['*kybernos-theme/loader-store*', '*kybernos-theme/vendor*'] })
    await val(`window.__KB_THEME_HOST_STORE__ = true`)
    const probe = await val(`fetch('/kybernos-theme/loader-store').then((r) => 'HTTP ' + r.status, (e) => 'BLOCKED ' + e.name)`, 8000)
    if (!/^BLOCKED/.test(String(probe))) {
      await val(`window.__KB_THEME_HOST_STORE__ = false`)
      console.log('  · the route could not be blocked at the network level (' + probe + '): the « disk unreachable » banner is not tested, the flag is back to false')
    } else {
      const warnOn = await until(() => val(`!!document.querySelector('[data-kb=ld-picker] .kbth-status.warn:not([data-kb=ld-note])')`), 7000)
      const warnText = await val(`(document.querySelector('[data-kb=ld-picker] .kbth-status.warn:not([data-kb=ld-note])') || { textContent: '' }).textContent`)
      check('with the flag ON and the disk route unreachable (blocked in the browser, nothing leaves it), the picker shows the yellow « the disk does not answer — imports stay in this browser until reload » banner', warnOn === true && /disque|disk/i.test(String(warnText)), warnText)
      const rLocal = await doImport('local-only.svg', { text: GOOD, type: 'image/svg+xml' })
      check('… and an import then is kept locally: a yellow banner says it is not saved on the disk and stays until the reload, and the picker switches to « Mes animations »', rLocal.note !== null && /warn/.test(rLocal.note.cls) && /enregistr|saved/i.test(rLocal.note.text) && rLocal.tab === 'mine', { note: rLocal.note, tab: rLocal.tab })
      await val(`window.__KB_THEME_HOST_STORE__ = false`)
      await page.send('Network.setBlockedURLs', { urls: [] })
    }
    await shot('10-animation-import')
    await press('Escape'); await pickerIs(false)
  })

  // ═══ 15. The bottom status line (faithful copy of DSH's running block) ═════════════════
  // The real block only exists during a model run, which a check must not trigger. So the page below builds, with DSH's
  // REAL hashed class names (read from its loaded stylesheets), the same DOM React renders:
  //   div.running[data-chat-running] > span.visuallyHidden[role=status], span.runningDivider, span.runningContent >
  //     ( span.runningIcon > svg, span.root[data-shimmer] > ( span.content > span.text > "label",
  //                                                           span.decoration > span.sweep > span.content.highlight > span.text[data-shimmer-text="label"] ) )
  // and rewrites the label once a second, as React does (the text node, and the attribute that the ::after paints).
  const FAITHFUL = String.raw`(() => {
    if (window.__kbFaith) { try { window.__kbFaith.unmount() } catch (e) { /* none */ } }
    const cls = {}
    document.querySelectorAll('style[data-plugin-css]').forEach((s) => {
      if (!/ChatView\.module\.css/.test(s.getAttribute('data-plugin-css'))) return
      ;['running', 'runningDivider', 'runningContent', 'runningIcon', 'runningWhaleStill', 'runningText'].forEach((k) => {
        const m = new RegExp('\\.([A-Za-z0-9]+_' + k + ')(?![A-Za-z0-9_])').exec(s.textContent)
        if (m && !cls[k]) cls[k] = m[1]
      })
    })
    const walk = (rules, fn) => { for (const r of Array.from(rules)) { if (r.selectorText) fn(r); if (r.cssRules) walk(r.cssRules, fn) } }
    const shim = {}
    let vis = null
    for (const sh of Array.from(document.styleSheets)) {
      let rules; try { rules = sh.cssRules } catch (e) { continue }
      const local = []; walk(rules, (r) => local.push(r))
      if (vis === null) { const v = local.find((r) => /\.([A-Za-z0-9_]*visuallyHidden[A-Za-z0-9_]*)/.test(r.selectorText)); if (v) vis = /\.([A-Za-z0-9_]*visuallyHidden[A-Za-z0-9_]*)/.exec(v.selectorText)[1] }
      const sw = local.find((r) => /\._sweep_[a-z0-9]+_\d+/.test(r.selectorText))
      if (!sw) continue
      const hash = /\._sweep_([a-z0-9]+)_\d+/.exec(sw.selectorText)[1]
      ;['root', 'content', 'text', 'decoration', 'sweep', 'highlight'].forEach((k) => {
        const re = new RegExp('\\._' + k + '_' + hash + '_\\d+')
        const r = local.find((x) => re.test(x.selectorText))
        if (r) shim[k] = re.exec(r.selectorText)[0].slice(1)
      })
    }
    const missing = ['running', 'runningDivider', 'runningContent', 'runningIcon', 'runningText'].filter((k) => !cls[k]).concat(['root', 'content', 'text', 'decoration', 'sweep', 'highlight'].filter((k) => !shim[k]).map((k) => 'shimmer.' + k))
    const mk = (tag, cn, attrs) => { const e = document.createElement(tag); if (cn) e.className = cn; for (const k in (attrs || {})) e.setAttribute(k, attrs[k]); return e }
    const label = (n) => 'Deep diving for ' + n + 's ···'
    let wrap = null, timer = null, base = null, attrEl = null
    const api = { missing, cls, shim, rewrites: 0,
      mount(start) {
        api.unmount()
        wrap = mk('div', '', { 'data-kb-faith': '1' })
        wrap.style.cssText = 'position:fixed;left:340px;bottom:70px;width:520px;z-index:2147483000;padding:10px 14px;border-radius:10px;background:var(--dsw-alias-bg-base);--dsh-content-font-size:15px;'
        const run = mk('div', cls.running, { 'data-chat-running': 'true' })
        const hid = mk('span', vis || '', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }); if (!vis) hid.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)'; hid.textContent = 'Deep diving'
        const div = mk('span', cls.runningDivider, { 'aria-hidden': 'true' })
        const content = mk('span', cls.runningContent)
        const icon = mk('span', cls.runningIcon, { 'aria-hidden': 'true' })
        icon.innerHTML = '<svg class="' + (cls.runningWhaleStill || '') + '" viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><path d="M8.844 13.742C8.967 12.328 8.45 10.4 8.45 9.65C8.45 8.94 8.88 8.43 9.6 8.43C11.285 8.43 12.106 8.281 12.685 8.104" stroke="currentColor" stroke-width="1"/></svg>'
        const root = mk('span', shim.root + ' ' + cls.runningText, { 'data-shimmer': 'true' })
        const c1 = mk('span', shim.content); const t1 = mk('span', shim.text); base = document.createTextNode(label(start)); t1.appendChild(base); c1.appendChild(t1)
        const deco = mk('span', shim.decoration, { 'aria-hidden': 'true', inert: '' }); const sweep = mk('span', shim.sweep)
        const c2 = mk('span', shim.content + ' ' + shim.highlight); attrEl = mk('span', shim.text, { 'data-shimmer-text': label(start) })
        c2.appendChild(attrEl); sweep.appendChild(c2); deco.appendChild(sweep); root.appendChild(c1); root.appendChild(deco)
        content.appendChild(icon); content.appendChild(root); run.appendChild(hid); run.appendChild(div); run.appendChild(content); wrap.appendChild(run)
        document.body.appendChild(wrap)
        let n = start
        api.rewrites = 0
        timer = setInterval(() => { n += 1; base.nodeValue = label(n); attrEl.setAttribute('data-shimmer-text', label(n)); api.rewrites += 1 }, 1000)
        api.refs = { run, content, icon, root, base, attrEl, t1 }
      },
      unmount() { if (timer) clearInterval(timer); timer = null; if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap); wrap = null },
      state() {
        const r = api.refs
        if (!wrap || !r) return null
        const node = r.content.querySelector('[data-kb-ld-run]')
        const out = { firstIsLoader: !!node && r.content.firstElementChild === node, hasLoader: !!node, iconHidden: r.icon.hasAttribute('data-kb-ld-hide'), iconDisplay: getComputedStyle(r.icon).display,
          base: r.base.nodeValue, attr: r.attrEl.getAttribute('data-shimmer-text'), after: getComputedStyle(r.attrEl, '::after').content, rewrites: api.rewrites,
          notext: r.run.hasAttribute('data-kb-ld-notext'), textColor: getComputedStyle(r.t1).color, runningColor: getComputedStyle(r.run).color }
        const sc = getComputedStyle(r.root)
        out.shim = { position: sc.position, width: sc.width, height: sc.height, clip: sc.clipPath }
        if (node) { const cs = getComputedStyle(node); const rc = node.getBoundingClientRect(); out.node = { w: cs.width, h: cs.height, color: cs.color, visibility: cs.visibility, kind: node.getAttribute('data-kind'), cls: node.className, html: node.innerHTML.slice(0, 600), rect: [Math.round(rc.width), Math.round(rc.height)] } }
        return out
      } }
    window.__kbFaith = api
    return JSON.stringify({ missing, cls, shim, vis })
  })()`
  const MEDECINE = ['Examining', 'Taking the history', 'Weighing differentials', 'Cross-checking guidelines', 'Triaging', 'Examen', 'Anamnèse', 'Diagnostic différentiel', 'Recoupement des recommandations', 'Triage']
  const wordRe = new RegExp('^(' + MEDECINE.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ') for \\d+s ···$')
  const faithState = async () => JSON.parse(await val(`JSON.stringify(window.__kbFaith.state())`))
  /** Loads the page with these settings (read at load), mounts the faithful copy and returns a function to read it. */
  const runtimeLoad = async (settings, themeState) => {
    await val(`localStorage.setItem(${JSON.stringify(LD_KEY)}, ${JSON.stringify(JSON.stringify(settings))}); ${themeState ? `localStorage.setItem(${JSON.stringify(STORE)}, ${JSON.stringify(JSON.stringify(themeState))})` : `localStorage.removeItem(${JSON.stringify(STORE)})`}; localStorage.removeItem(${JSON.stringify(LD_CACHE)})`)
    await reloadBoot()
    await sleep(1500)                      // the plugin starts its observer when it is applied
    const info = JSON.parse(await val(FAITHFUL))
    return info
  }
  const LDBASE = { sel: [], mode: 'order', size: 'standard', tint: true, keep: true, speed: 1, avoid: true, delay: 0, pack: 'dsh', rot: 'fixed', dur: true, updatedAt: 1 }

  await section('runtime', 'The thinking animation in DSH’s bottom status line (a faithful copy of the running block, DSH’s own classes)', async () => {
    await openTheme({ fresh: true })
    const lang = await val(`document.documentElement.lang`)
    if (!/^en/i.test(String(lang))) { console.log('  · skipped: the copy uses DSH’s English phrase and the interface language is « ' + lang + ' »'); return }
    // ── R1: ring + orbit in order, ambiance « Médecine », size standard, no delay ──
    const info = await runtimeLoad({ ...LDBASE, sel: ['ring', 'orbit'], pack: 'medecine', size: 'standard', delay: 0 }, null)
    check('the copy is built with DSH’s real hashed classes (running, runningContent, runningIcon, runningText + the TextShimmer module’s root/content/text/decoration/sweep/highlight)', info.missing.length === 0, info)
    await val(`window.__kbFaith.mount(12)`)
    await sleep(700)
    let st = await faithState()
    check('the loader node [data-kb-ld-run] is the FIRST child of the running content, the whale icon carries data-kb-ld-hide and is display:none', st.firstIsLoader === true && st.iconHidden === true && st.iconDisplay === 'none', { firstIsLoader: st.firstIsLoader, iconHidden: st.iconHidden, iconDisplay: st.iconDisplay })
    check('the loader is 24 × 24 px at the standard size, visible at once (delay 0)', st.node && st.node.w === '24px' && st.node.h === '24px' && st.node.visibility === 'visible', st.node)
    check('the words come from the « Médecine » pack with the duration, in the TEXT NODE: « ' + st.base + ' »', wordRe.test(st.base), st.base)
    check('… and in the data-shimmer-text ATTRIBUTE of the sweep copy (the one the ::after paints): « ' + st.attr + ' »', wordRe.test(st.attr), st.attr)
    check('… and what the sweep actually PAINTS (::after content) is the replaced phrase, not « Deep diving »: ' + st.after, wordRe.test(String(st.after).replace(/^"|"$/g, '')), st.after)
    const word0 = (wordRe.exec(st.base) || [])[1]
    await until(async () => (await faithState()).rewrites >= 3, 6000, 250)
    await sleep(250)
    st = await faithState()
    check('after 3 simulated React rewrites (' + st.rewrites + ' so far) both copies still carry a Médecine word + the new duration, the SAME word, and never « Deep diving »', wordRe.test(st.base) && wordRe.test(st.attr) && (wordRe.exec(st.base) || [])[1] === (wordRe.exec(st.attr) || [])[1] && (wordRe.exec(st.base) || [])[1] === word0 && !/Deep diving/.test(st.base + st.attr) && wordRe.test(String(st.after).replace(/^"|"$/g, '')), { base: st.base, attr: st.attr, after: st.after, word0 })
    check('mono loader (ring): it takes the colour of the running text (DSH’s deep-diving blue) when no accent is set', st.node && st.node.kind === 'mono' && sameColor(st.node.color, st.textColor) && sameColor(st.textColor, st.runningColor), { loader: st.node && st.node.color, text: st.textColor, running: st.runningColor })
    const shotPath = join(tmpdir(), 'kb-theme-status-copy.png')
    try { await page.shot(shotPath); console.log('  · screenshot of the faithful copy (temp folder, never committed): ' + shotPath) } catch (e) { console.log('  · the screenshot failed: ' + short(e.message)) }
    const kindOf = (s) => (s.node ? (/<g class="vb a-spin"/.test(s.node.html) ? 'orbit' : (/<circle class="vb a-spin"/.test(s.node.html) ? 'ring' : s.node.html.slice(0, 60))) : null)
    const seq = [kindOf(st)]
    // order mode: a NEW answer (block gone for > 1.5 s) takes the next animation
    for (let i = 0; i < 2; i += 1) {
      await val(`window.__kbFaith.unmount()`)
      await sleep(2000)
      await val(`window.__kbFaith.mount(1)`)
      await sleep(500)
      seq.push(kindOf(await faithState()))
    }
    check('order mode: successive answers go ring → orbit → ring (' + seq.join(' → ') + ')', JSON.stringify(seq) === '["ring","orbit","ring"]', seq)
    // the same answer re-mounted by React within a second keeps its animation and its word
    const tick0 = (await faithState()).rewrites
    await until(async () => (await faithState()).rewrites > tick0, 4000, 100)
    await sleep(300)                       // a tick (hence the plugin’s own heartbeat) has just happened
    const sA = await faithState()
    await val(`window.__kbFaith.mount(14)`)
    await sleep(500)
    const sB = await faithState()
    check('re-mounting the block within a second (React does it mid-answer) keeps the same animation (' + kindOf(sA) + ') and the same word', kindOf(sA) === kindOf(sB) && (wordRe.exec(sA.base) || [])[1] === (wordRe.exec(sB.base) || [])[1], { a: kindOf(sA), b: kindOf(sB), wa: sA.base, wb: sB.base })
    await val(`window.__kbFaith.unmount()`)

    // ── R2: compact size, an accent set in the Theme page, delay 300, ambiance unchanged ──
    await runtimeLoad({ ...LDBASE, sel: ['ring'], size: 'compact', delay: 300, tint: true, pack: 'dsh' }, { acc: '#EC4899', skin: 'custom' })
    const early = JSON.parse(await val(`(async () => { window.__kbFaith.mount(12); await new Promise((r) => setTimeout(r, 80)); return JSON.stringify(window.__kbFaith.state()) })()`))
    await until(async () => (await faithState()).node.visibility === 'visible', 4000, 150)
    st = await faithState()
    const brand = (await readTokens())[V.brand]
    check('compact size: the loader is 14 × 14 px', st.node && st.node.w === '14px' && st.node.h === '14px', st.node)
    if (await needVisible('the 300 ms delay check')) check('delay 300 ms: the loader is hidden 80 ms after the block appears and becomes visible shortly after', early.node && early.node.visibility === 'hidden' && st.node.visibility === 'visible', { early: early.node && early.node.visibility, later: st.node && st.node.visibility })
    check('a theme accent is set: the mono loader takes the accent (computed colour = --dsw-alias-brand-primary ' + brand + ')', st.node && sameColor(st.node.color, brand) && !sameColor(st.node.color, st.textColor), { loader: st.node && st.node.color, brand, text: st.textColor })
    check('ambiance « DSH’s own »: the phrase is left exactly as DSH wrote it (text node and attribute)', /^Deep diving for \d+s ···$/.test(st.base) && st.base === st.attr, { base: st.base, attr: st.attr })
    await val(`window.__kbFaith.unmount()`)

    // ── R3: large size, accent set but « tint » off, « keep the text » off ──
    await runtimeLoad({ ...LDBASE, sel: ['ring'], size: 'large', tint: false, keep: false, delay: 0, pack: 'medecine' }, { acc: '#EC4899', skin: 'custom' })
    await val(`window.__kbFaith.mount(12)`)
    await sleep(700)
    st = await faithState()
    check('large size: the loader is 40 × 40 px', st.node && st.node.w === '40px' && st.node.h === '40px', st.node)
    check('tint off: the mono loader keeps the running text colour although an accent is set', st.node && sameColor(st.node.color, st.textColor), { loader: st.node && st.node.color, text: st.textColor })
    check('« keep the status text » off: the words are visually hidden (data-kb-ld-notext, 1 × 1 px, clipped) while the loader stays visible', st.notext === true && st.shim.position === 'absolute' && st.shim.width === '1px' && st.shim.height === '1px' && /inset/.test(st.shim.clip) && st.node && st.node.rect[0] === 40, { notext: st.notext, shim: st.shim, rect: st.node && st.node.rect })
    await val(`window.__kbFaith.unmount()`)

    // ── R5: « Réduire les animations » of the Theme page: the loader stands still ──
    await runtimeLoad({ ...LDBASE, sel: ['ring'], delay: 0, pack: 'dsh' }, null)
    await val(`window.__kbFaith.mount(12)`)
    await sleep(700)
    const spinName = () => val(`(() => { const n = document.querySelector('[data-kb-faith] [data-kb-ld-run] .a-spin'); return n ? getComputedStyle(n).animationName : null })()`)
    const spinNormal = await spinName()
    await val(`window.__kbFaith.unmount()`)
    await runtimeLoad({ ...LDBASE, sel: ['ring'], delay: 0, pack: 'dsh' }, { reduceMotion: true })
    await val(`window.__kbFaith.mount(12)`)
    await sleep(700)
    const spinReduced = await spinName()
    const attrR = await val(`document.documentElement.getAttribute('data-kbth-reduced')`)
    st = await faithState()
    check('reduced motion (stored by the Theme page): html[data-kbth-reduced="1"] at boot and the loader’s spinning element has animation-name none (' + spinNormal + ' without it); the loader is still there', attrR === '1' && spinNormal && spinNormal !== 'none' && spinReduced === 'none' && st.hasLoader === true, { attrR, spinNormal, spinReduced, hasLoader: st.hasLoader })
    await val(`window.__kbFaith.unmount()`)

    // ── R4: nothing chosen, DSH’s own ambiance: DSH is left untouched ──
    await runtimeLoad({ ...LDBASE, sel: [], pack: 'dsh' }, null)
    await val(`window.__kbFaith.mount(12)`)
    await sleep(900)
    st = await faithState()
    check('nothing chosen: no loader node, the whale icon is not hidden (display ≠ none) and has no hide attribute, the phrase is untouched', st.hasLoader === false && st.iconHidden === false && st.iconDisplay !== 'none' && /^Deep diving for \d+s ···$/.test(st.base) && st.base === st.attr && st.notext === false, { hasLoader: st.hasLoader, iconHidden: st.iconHidden, iconDisplay: st.iconDisplay, base: st.base, attr: st.attr })
    await val(`window.__kbFaith.unmount()`)
    await val(`localStorage.removeItem(${JSON.stringify(LD_KEY)}); localStorage.removeItem(${JSON.stringify(LD_CACHE)}); localStorage.removeItem(${JSON.stringify(STORE)})`)
  })


  // ── the live translators (English UI) run on timers: the throw-away headless Chrome sometimes has them throttled (about
  //    once a second, or worse, when macOS naps the browser). To tell a LATE translation from a MISSING one, a canary text that
  //    the dictionary knows (« Copier » → « Copy ») is added inside the page, and the view is read only once it has been
  //    translated: the translators' pass is synchronous, so the whole page was translated by then.
  const wakeTranslator = async () => {
    const lateness = await val(`new Promise((r) => { const t0 = performance.now(); setTimeout(() => r(Math.round(performance.now() - t0)), 120) })`, 15000)
    const t0 = Date.now()
    await val(`(() => { const r = document.querySelector('.kbth-page') || document.body; const e = document.createElement('span'); e.setAttribute('data-kb-test-canary', '1'); e.style.cssText = 'position:absolute;opacity:0.01;pointer-events:none'; e.textContent = 'Copier'; r.appendChild(e) })()`)
    let ok = false
    while (Date.now() - t0 < 12000) {
      await sleep(120)
      if ((await val(`(() => { const e = document.querySelector('[data-kb-test-canary]'); return e ? e.textContent : null })()`)) !== 'Copier') { ok = true; break }
    }
    await val(`(() => { const e = document.querySelector('[data-kb-test-canary]'); if (e) e.remove() })()`)
    return { ok, ms: Date.now() - t0, lateness }
  }

  // ═══ I. The Light scheme, WITHOUT touching the user’s preference ════════════════════════════
  // The Mode / Light buttons are never pressed. Only the page’s own copy of the scheme is flipped, client-side: the attribute
  // data-ds-dark-theme is removed from <body> (DSH’s light tokens then apply), measured, and put back. Nothing is persisted:
  // DSH’s own report (html[data-ds-theme-source]) is watched by the mode guard throughout, and a reload restores everything.
  // Two measures per view: (1) EVERY visible text of the Theme page and of its two windows (not a hand-made list), compared
  // with 4.5:1; (2) the selectors the plugin lifts in Light (read from its own stylesheet rule), which must keep their
  // tertiary / caption colour in Dark.
  const LIGHT_RULE = (() => {
    try {
      const src = readFileSync(fileURLToPath(new URL('../packages/kybernos-theme/client.js', import.meta.url)), 'utf8')
      const m = /body:not\(\[data-ds-dark-theme\]\) :is\(([^)]*)\)\{color:var\(--dsw-alias-label-secondary\)\}/.exec(src)
      return m === null ? [] : m[1].split(',').map((x) => x.trim()).filter(Boolean)
    } catch (e) { return [] }
  })()
  const LIGHT_EXTRA = ['.kbth-sec-t', '.kbth-ldp-run', '.kbth-lcard-nm']      // texts that were below 4.5:1 once and must stay measured
  const INSPECT_IN_PAGE = `(scopes, listed) => {
    const parse = (c) => {
      c = String(c).trim()
      let m = /^rgba?\\(([^)]+)\\)$/.exec(c)
      if (m) { const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1] }
      m = /^color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*\\/\\s*([\\d.]+%?))?\\)$/.exec(c)
      if (m) { const a = m[4] === undefined ? 1 : (m[4].slice(-1) === '%' ? parseFloat(m[4]) / 100 : Number(m[4])); return [m[1] * 255, m[2] * 255, m[3] * 255, a] }
      return [0, 0, 0, 0]
    }
    const over = (fg, bg) => { const a = fg[3]; return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1] }
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
    const bgOf = (el) => {
      const layers = []
      for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 0.999) break }
      let acc = [255, 255, 255, 1]
      for (let i = layers.length - 1; i >= 0; i -= 1) acc = over(layers[i], acc)
      return acc
    }
    const ink = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).color); if (c[3] > 0) return c } return [0, 0, 0, 1] }    // « transparent » text (background-clip) takes its parent’s ink
    const shown = (e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(e).visibility !== 'hidden' }
    const ratioOf = (e) => { const bg = bgOf(e); const fg = over(ink(e), bg); const l1 = lum(fg), l2 = lum(bg); return { ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05), fg: 'rgb(' + fg.slice(0, 3).map(Math.round).join(',') + ')', bg: 'rgb(' + bg.slice(0, 3).map(Math.round).join(',') + ')' } }
    const low = []
    let texts = 0
    const seen = new Set()
    for (const scope of scopes) {
      for (const root of document.querySelectorAll(scope)) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const t = (n.nodeValue || '').trim()
          const el = n.parentElement
          if (!t || !el || /^(SCRIPT|STYLE|OPTION)$/.test(el.tagName) || !shown(el) || el.closest('button:disabled,[aria-disabled=true],input:disabled,.kbth-a11y-aa')) continue    // « Aa » samples: both colours are the pair under test, set inline from the plugin’s own model — not a text of the scheme
          texts += 1
          const r = ratioOf(el)
          if (r.ratio < 4.5) {
            const key = el.tagName + '.' + String(el.className) + '|' + r.fg
            if (seen.has(key)) continue
            seen.add(key)
            low.push({ cls: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : ''), text: t.slice(0, 34), ratio: Math.round(r.ratio * 100) / 100, fg: r.fg, bg: r.bg })
          }
        }
      }
    }
    const lifted = []
    for (const sel of listed) {
      let els = []
      try { els = Array.from(document.querySelectorAll(sel)).filter(shown) } catch (e) { els = [] }
      if (els.length === 0) continue
      const colors = Array.from(new Set(els.map((e) => getComputedStyle(e).color)))
      let worst = null
      for (const e of els) { if (!(e.textContent || '').trim()) continue; const r = ratioOf(e); if (worst === null || r.ratio < worst.ratio) worst = { ratio: Math.round(r.ratio * 100) / 100, text: (e.textContent || '').trim().slice(0, 24) } }
      lifted.push({ sel, n: els.length, colors, worst })
    }
    return { texts, low, lifted }
  }`
  await section('light', 'Light scheme (page-only, preference untouched): contrast of EVERY text of the Theme page, its picker and its word pack', async () => {
    if (LIGHT_RULE.length < 10) { console.log('  · the plugin’s Light rule could not be read from its stylesheet'); check('the plugin’s « small texts in Light » rule is present in client.js (≥ 10 selectors)', false, LIGHT_RULE) ; return }
    await openTheme({ fresh: true })
    const origAttr = await val(`document.body.getAttribute('data-ds-dark-theme')`)
    const darkOn = () => val(`document.body.setAttribute('data-ds-dark-theme', ${JSON.stringify(origAttr === null ? '' : origAttr)})`)
    const setLight = async () => { await val(`document.body.removeAttribute('data-ds-dark-theme')`); await sleep(350); await val(`document.body.removeAttribute('data-ds-dark-theme')`); await sleep(150) }
    const inspect = async () => JSON.parse(await val(`JSON.stringify((${INSPECT_IN_PAGE})(['.kbth-page', '[data-kb=ld-picker]', '[data-kb=ld-pack]', '[data-kb=theme-save-dlg]'], ${JSON.stringify(LIGHT_RULE.concat(LIGHT_EXTRA))}))`, 12000))
    const lightShot = async (name) => { const f = join(tmpdir(), 'kb-theme-light-' + name + '.png'); try { await page.shot(f); console.log('  · screenshot (Light, temp folder, never committed): ' + f) } catch (e) { console.log('  · the screenshot failed: ' + short(e.message)) } }
    const SHOTS = { 'Essentiel': 'essentiel', 'Animation': 'animation', 'Animation › picker › examples': 'picker', 'Verre et fond': 'verre', 'Accessibilité': 'access', 'Animation › word pack': 'pack' }
    const dark = { tert: await bodyVar('--dsw-alias-label-tertiary'), cap: await bodyVar('--dsw-alias-label-caption'), sec: await bodyVar('--dsw-alias-label-secondary') }
    // Under an English interface the screenshots must show the translated page: wait until the French of the view has gone.
    const english = /^en/i.test(String(await val(`document.documentElement.lang`)))
    const audit = english ? await import('./lib-i18n-audit.mjs') : null
    const slowTranslation = []
    const throttled = []
    const translated = async (name) => {
      if (audit === null) return
      const w = await wakeTranslator()
      if (!w.ok) slowTranslation.push(name + ' (the translators never answered a canary text in 12 s)')
      if (w.lateness > 500) throttled.push(w.lateness)
      const t0 = Date.now()
      let n = 99
      let frNow = []
      while (Date.now() - t0 < 2000) {
        let fr = []
        for (const scope of ['.kbth-page', '[data-kb=ld-picker]', '[data-kb=ld-pack]', '[data-kb=theme-save-dlg]']) fr = fr.concat(audit.analyse(JSON.parse((await val(audit.collectIn(scope), 10000)) || '[]')).fr)
        frNow = fr.filter((t) => !/^#/.test(t) && t !== 'Fermer')
        n = frNow.length
        if (n === 0) break
        await sleep(250)
      }
      if (n > 0) slowTranslation.push(name + ' (' + n + ' French: ' + frNow.map((t) => '« ' + t.slice(0, 40) + ' »').join(' ') + ')')
    }
    const views = []
    const seenLifted = new Map()
    const darkWrong = []
    const darkSeen = []
    let allLow = []
    let textsTotal = 0
    const visit = async (name, enter) => {
      await enter()
      await sleep(500)
      await translated(name)                         // a view shows its French source for a moment, until the live translators have passed
      const d = await inspect()                       // Dark first: the lifted selectors keep their tertiary / caption colour
      for (const l of d.lifted) {
        seenLifted.set(l.sel, (seenLifted.get(l.sel) || 0) + l.n)
        if (LIGHT_RULE.indexOf(l.sel) < 0) continue
        const bad = l.colors.filter((c) => !sameColor(c, dark.tert) && !sameColor(c, dark.cap))
        darkSeen.push({ view: name, sel: l.sel, colors: l.colors })
        if (bad.length) darkWrong.push(name + ' ' + l.sel + ' ' + bad.join(' / '))
      }
      await setLight()
      const r = await inspect()
      textsTotal += r.texts
      views.push({ name, texts: r.texts, low: r.low, lifted: r.lifted })
      allLow = allLow.concat(r.low.map((x) => Object.assign({ view: name }, x)))
      if (SHOTS[name]) await lightShot(SHOTS[name])
      await darkOn()
    }
    try {
      await visit('Essentiel', async () => { await goTab(TAB.essentiel) })
      await visit('Essentiel › font list, no match', async () => { await clickEl(`document.querySelector('.kbth-page .kbth-fsbtn')`); await sleep(250); await typeInto(`document.querySelector('.kbth-fssearch')`, 'zzzzzz'); await sleep(300) })
      await press('Escape'); await sleep(300)
      if (!(await settingsPageOpen())) await openTheme()
      await visit('Verre et fond', async () => { await goTab(TAB.verre) })
      await visit('Couleurs', async () => { await goTab(TAB.couleurs) })
      await visit('Texte et forme', async () => { await goTab(TAB.texte) })
      await visit('Animation', async () => { await goTab(TAB.animation) })
      await visit('Animation › settings', async () => { await clickEl(kb('ld-settings')); await sleep(300) })
      await visit('Animation › ambiances', async () => { await clickEl(kb('ld-amb', ' .kbth-fsbtn')); await sleep(300) })
      await visit('Animation › ambiances, no match', async () => { await typeInto(kb('ld-amb', ' .kbth-fssearch'), 'zzzzzz'); await sleep(300) })
      await press('Escape'); await sleep(300)
      await visit('Animation › picker › examples', async () => { await clickEl(kb('ld-open-picker')); await pickerIs(true) })
      for (const t of ['mine', 'add']) await visit('Animation › picker › ' + t, async () => { await clickEl(`document.querySelector('[data-kb=ld-tab][data-id=${t}]')`); await sleep(300) })
      // two animations chosen, played in order: the rotation slots then show their number and their remove button
      await clickEl(`document.querySelector('[data-kb=ld-tab][data-id=examples]')`); await sleep(300)
      for (let i = 0; i < 2; i += 1) await clickEl(`document.querySelectorAll('.kbth-lcard')[${i}].querySelector('[data-kb=ld-toggle]')`)
      await visit('Animation › picker › two animations chosen', async () => { await sleep(300) })
      await press('Escape'); await pickerIs(false)
      await visit('Animation › rotation filled, in order', async () => { await clickEl(`Array.from(document.querySelectorAll('.kbth-page button')).find((b) => /ordre|in order/i.test(b.textContent))`); await sleep(400) })
      await visit('Animation › word pack', async () => { await clickEl(kb('ld-open-pack')); await until(() => val(`!!document.querySelector('[data-kb=ld-pack]')`), 3000) })
      await visit('Animation › word pack with two words', async () => { await until(() => val(`!!document.querySelector('[data-kb=ld-word]')`), 3000); for (const w of ['Hello', 'World']) { await typeInto(kb('ld-word'), w); await press('Enter'); await sleep(250) } })
      await press('Escape'); await sleep(400)
      if (!(await settingsPageOpen())) { await openTheme(); }
      await visit('Accessibilité', async () => { await goTab(TAB.accessibilite) })
      // (the export of the current look sits in a folded block: a browser does not recompute the colours of what is folded, so it is opened to be measured)
      await visit('Partage', async () => { await goTab(TAB.partage); await val(`(document.querySelector('[data-kb=theme-export-fold]') || {}).open = true`) })
      // My themes and the gallery: two themes of yours (one from the gallery), the save window, the file of a theme, the gallery. None of them is IN USE:
      // a theme in use posts the token layer, and the Light emulation (the attribute removed from <body>, in the page only) cannot flip a posted layer.
      await val(`localStorage.setItem(${JSON.stringify(LIB)}, JSON.stringify({ v: 1, updatedAt: 9, presets: [{ id: 'u-a', name: 'Bureau', source: 'me', at: 1, settings: { mode: ${JSON.stringify(startMode)}, acc: '#22a06b', ov: {} } }, { id: 'g-b', name: 'Calcaire', source: 'gallery', author: 'Kybernos', gid: 'calcaire', v: 1, settings: { mode: ${JSON.stringify(startMode)}, acc: '#4d7c0f' } }] }))`)
      await reloadBoot(); await openTheme()
      await visit('Essentiel › my themes', async () => { await goTab(TAB.essentiel) })
      await visit('Save window', async () => { await clickEl(`document.querySelector('[data-kb=theme-add]')`); await until(() => val(`!!document.querySelector('[data-kb=theme-save-dlg]')`), 3000) })
      await press('Escape'); await sleep(300)
      if (!(await settingsPageOpen())) { await openTheme() }
      await visit('Partage › my themes', async () => { await goTab(TAB.partage); await val(`(document.querySelector('[data-kb=theme-export-fold]') || {}).open = true`) })
      await visit('Partage › a theme file shown', async () => { await clickEl(`document.querySelector('[data-kb=theme-export-one]')`); await sleep(300) })
      await visit('Galerie', async () => { await val(`window.__KB_THEME_HOST_STORE__ = true`); await goTab(TAB.galerie); await until(async () => (await val(`document.querySelectorAll('[data-kb=theme-gal-card]').length`)) > 0, 8000) })
      await val(`window.__KB_THEME_HOST_STORE__ = false`)
    } finally {
      await darkOn()
      await val(`localStorage.removeItem(${JSON.stringify(LIB)})`)
    }
    const restoredAttr = await val(`document.body.getAttribute('data-ds-dark-theme')`)
    check('the attribute is put back on <body> and DSH never stopped reporting « ' + startMode + ' » (nothing was persisted)', restoredAttr === origAttr && (await modeInfo()).source === startMode && storedUi() !== null && storedUi().preference === startMode, { orig: origAttr, now: restoredAttr })
    console.log('  · ' + views.length + ' views, ' + textsTotal + ' visible texts measured in Light (every text node of the page and of the two windows); ' + LIGHT_RULE.length + ' selectors in the plugin’s Light rule')
    for (const v of views) console.log('      ' + v.name.padEnd(34) + String(v.texts).padStart(4) + ' texts, ' + (v.low.length === 0 ? 'none below 4.5:1' : v.low.length + ' below'))
    const lowest = Math.min(...views.map((v) => Math.min(100, ...v.lifted.map((l) => (l.worst ? l.worst.ratio : 100)))))
    console.log('  · lowest ratio among the lifted selectors in Light: ' + lowest + ':1')
    if (throttled.length) note('Light scheme: Chrome throttled the page’s timers ' + throttled.length + ' time(s) (a 120 ms timer took up to ' + Math.max(...throttled) + ' ms): the screenshots were taken only after the live translation had run')
    if (slowTranslation.length) note('English UI: views still showing French once the translators were awake (live translation late or missing, or the user’s own words): ' + slowTranslation.join(', '))
    check('Light scheme: no visible text of the Theme page, its picker or its word pack is below 4.5:1 (WCAG AA) — ' + textsTotal + ' texts over ' + views.length + ' views' + (allLow.length ? ', ' + allLow.length + ' BELOW' : ''), allLow.length === 0 && textsTotal > 300, allLow.slice(0, 8).map((x) => x.view + ' ' + x.cls + ' « ' + x.text + ' » ' + x.ratio + ':1 ' + x.fg + ' on ' + x.bg))
    const notSeen = LIGHT_RULE.filter((sel) => !seenLifted.has(sel))
    check('the selectors the plugin lifts in Light were really on screen and measured (' + (LIGHT_RULE.length - notSeen.length) + ' of ' + LIGHT_RULE.length + '; not reached: ' + (notSeen.join(', ') || 'none') + ')', LIGHT_RULE.length - notSeen.length >= LIGHT_RULE.length * 0.75, notSeen)
    if (notSeen.length) note('Light scheme: selectors of the plugin’s Light rule that no view of the run could show: ' + notSeen.join(', '))
    check('Dark did not change: on every view, each lifted selector still computes DSH’s tertiary (' + dark.tert + ') or caption (' + dark.cap + ') colour, never the secondary one', darkWrong.length === 0, darkWrong.slice(0, 6))
    const darkSet = {}
    for (const d of darkSeen) for (const c of d.colors) (darkSet[d.sel] = darkSet[d.sel] || new Set()).add(c)
    console.log('  · Dark colours of the lifted selectors: ' + Object.keys(darkSet).map((k) => k + '=' + Array.from(darkSet[k]).join('|')).join(' ; ').slice(0, 900))
    for (const sel of LIGHT_EXTRA.concat(['.kbth-hint', '.kbth-pill'])) check('… ' + sel + ' was on screen and measured in Light', seenLifted.has(sel), sel)
  })

  // ═══ J. French left on the Theme page under an English interface ═════════════════════════════
  // Two live translators work on this page (kybernos-plugin `passe()` and kybernos-language `LIVE_ROOTS`), on the settings
  // section and on the two windows. Each view is read, then re-read until nothing changes for a moment; what is still French
  // then is a leftover. How long the translation took is reported too (a window shows its French source until the first pass).
  await section('french', 'English UI: nothing French is left on the Theme page, its picker or its word pack (except the export’s file content)', async () => {
    const lang = await val(`document.documentElement.lang`)
    if (!/^en/i.test(String(lang))) { console.log('  · skipped: the interface language is « ' + lang + ' »'); return }
    const { collectIn, analyse } = await import('./lib-i18n-audit.mjs')
    await openTheme({ fresh: true })
    const read = async (scope) => analyse(JSON.parse((await val(collectIn(scope), 10000)) || '[]'))
    const left = []
    const timings = []
    /** Waits until the live translators are awake (see wakeTranslator), then reads the view until nothing changes for 1.5 s. */
    const settleView = async (area, scope) => {
      const t0 = Date.now()
      const first = (await read(scope)).fr.length
      const w = await wakeTranslator()
      let res = await read(scope)
      let lastChange = Date.now()
      let prev = res.fr.join('|')
      while (res.fr.length > 0 && Date.now() - lastChange < 1500 && Date.now() - t0 < 20000) {
        await sleep(200)
        res = await read(scope)
        const now = res.fr.join('|')
        if (now !== prev) { prev = now; lastChange = Date.now() }
      }
      timings.push({ area, first, rest: res.fr.length, awake: w.ok, wakeMs: w.ms, lateness: w.lateness, ms: Date.now() - t0, clean: res.fr.length === 0 })
      res.fr.forEach((t) => { if (!left.some((x) => x.text === t && x.area === area)) left.push({ area, text: t }) })
      return res
    }
    const NAMES = ['Essentiel', 'Verre et fond', 'Couleurs', 'Texte et forme', 'Animation', 'Accessibilité', 'Partage', 'Galerie']
    for (let i = 0; i < 8; i += 1) {
      await goTab(i)
      await settleView(NAMES[i], '.kbth-page')
      if (i === TAB.essentiel) {
        await clickEl(`document.querySelector('.kbth-page .kbth-fsbtn')`); await settleView('Essentiel › font list', '.kbth-page')
        await typeInto(`document.querySelector('.kbth-fssearch')`, 'zzzzzz'); await settleView('Essentiel › font list, no match', '.kbth-page')
        await press('Escape'); await sleep(300)
        if (!(await settingsPageOpen())) { await openTheme(); await goTab(TAB.essentiel) }
      }
      if (i === TAB.animation) {
        await clickEl(kb('ld-settings')); await settleView('Animation › settings', '.kbth-page')
        await clickEl(kb('ld-amb', ' .kbth-fsbtn')); await settleView('Animation › ambiances', '.kbth-page')
        await typeInto(kb('ld-amb', ' .kbth-fssearch'), 'zzzzzz'); await settleView('Animation › ambiances, no match', '.kbth-page'); await press('Escape'); await sleep(300)
        for (const t of ['examples', 'mine', 'add']) {
          if (t === 'examples') { await clickEl(kb('ld-open-picker')); await pickerIs(true) } else await clickEl(`document.querySelector('[data-kb=ld-tab][data-id=${t}]')`)
          await settleView('Animation › picker › ' + t, '[data-kb=ld-picker]')
        }
        // two animations chosen and played in order (the rotation slots then carry a number and a remove button)
        await clickEl(`document.querySelector('[data-kb=ld-tab][data-id=examples]')`); await sleep(300)
        for (let k = 0; k < 2; k += 1) await clickEl(`document.querySelectorAll('.kbth-lcard')[${k}].querySelector('[data-kb=ld-toggle]')`)
        await settleView('Animation › picker › two animations chosen', '[data-kb=ld-picker]')
        await press('Escape'); await pickerIs(false)
        await clickEl(`Array.from(document.querySelectorAll('.kbth-page button')).find((b) => /ordre|in order/i.test(b.textContent))`); await settleView('Animation › rotation filled, in order', '.kbth-page')
        await clickEl(kb('ld-open-pack')); await settleView('Animation › word pack', '[data-kb=ld-pack]')
        for (const w of ['Hello', 'World']) { await typeInto(kb('ld-word'), w); await press('Enter'); await sleep(250) }      // words in English: the user’s own words are not interface copy
        await settleView('Animation › word pack with two words', '[data-kb=ld-pack]')
        await press('Escape'); await sleep(300)
        if (!(await settingsPageOpen())) { await openTheme(); await goTab(TAB.animation) }
      }
    }
    // ── My themes and the gallery, in the states a person meets ────────────────────────────────
    {
      const at = (k) => `document.querySelector('[data-kb=${k}]')`
      await openTheme({ fresh: true })
      await goTab(TAB.essentiel)
      const labels = await skinLabels()
      await clickEl(Q.skin(findSkin(labels, SKIN('kb-ember')).idx))
      await clickEl(Q.dot(3))
      await settleView('Essentiel › theme modified', '.kbth-page')
      await clickEl(at('theme-save')); await sleep(300)
      await settleView('Save window', '[data-kb=theme-save-dlg]')
      await typeInto(at('theme-save-name'), '   '); await clickEl(at('theme-save-ok')); await sleep(250)
      await settleView('Save window, name missing', '[data-kb=theme-save-dlg]')
      await typeInto(at('theme-save-name'), 'Bureau'); await clickEl(at('theme-save-ok')); await sleep(400)
      await settleView('Essentiel › theme saved (note)', '.kbth-page')
      await goTab(TAB.partage)
      await settleView('Partage › one theme', '.kbth-page')
      await clickEl(at('theme-export-one')); await sleep(200)
      await settleView('Partage › theme file shown', '.kbth-page')
      await clickEl(at('theme-rename')); await sleep(200)
      await settleView('Partage › renaming', '.kbth-page')
      await press('Escape'); await sleep(200)
      if (!(await settingsPageOpen())) { await openTheme(); await goTab(TAB.partage) }
      await clickEl(at('theme-delete')); await sleep(200)
      await settleView('Partage › delete asked', '.kbth-page')
      await val(`(() => { const input = document.querySelector('.kbth-adv-pane input[type=file]'); const dt = new DataTransfer(); dt.items.add(new File(['nope'], 'x.json', { type: 'application/json' })); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })) })()`)
      await sleep(500)
      await settleView('Partage › refused file', '.kbth-page')
      // the gallery, read by the sandbox host (the flag that keeps the run off the disk is lifted for these views only)
      await val(`window.__KB_THEME_HOST_STORE__ = true`)
      await goTab(TAB.essentiel); await goTab(TAB.galerie)
      await until(async () => (await val(`document.querySelectorAll('[data-kb=theme-gal-card]').length`)) > 0, 8000)
      await settleView('Galerie › cards', '.kbth-page')
      await typeInto(at('theme-gal-q'), 'zzzzzz'); await sleep(250)
      await settleView('Galerie › no match', '.kbth-page')
      await typeInto(at('theme-gal-q'), ''); await sleep(250)
      const gal0 = JSON.parse(readFileSync(new URL('../packages/kybernos-theme/gallery.json', import.meta.url), 'utf8')).themes.find((t) => t.settings.mode === startMode)
      if (gal0 !== undefined) {         // a theme of ANOTHER mode would move DSH's native mode: only a theme of the mode found is tried
        await clickEl(`document.querySelector('[data-kb=theme-gal-card][data-id=${gal0.id}] [data-kb=theme-gal-try]')`); await sleep(300)
        await settleView('Galerie › trying a theme', '.kbth-page')
      }
      if (gal0 !== undefined) { await clickEl(at('theme-trial-end')); await sleep(300) }
      await val(`window.__KB_THEME_HOST_STORE__ = false`)
      await val(`localStorage.removeItem(${JSON.stringify(LIB)})`)
    }
    const slow = timings.filter((t) => t.first > 0)
    console.log('  · ' + timings.length + ' views read; ' + slow.length + ' of them showed French at first sight and were then translated by the live translators:')
    for (const t of slow) console.log('      ' + t.area.padEnd(34) + String(t.first).padStart(3) + ' French at first sight → ' + (t.rest === 0 ? 'none left' : t.rest + ' left') + '; translators awake after ' + (t.awake ? t.wakeMs + ' ms' : 'NEVER (12 s)') + ' (a 120 ms timer ran in ' + t.lateness + ' ms)')
    const lateTimers = timings.filter((t) => t.lateness > 500)
    if (lateTimers.length) note('English UI: Chrome throttled the throw-away browser’s timers in ' + lateTimers.length + ' of ' + timings.length + ' views (a 120 ms timer took up to ' + Math.max(...lateTimers.map((t) => t.lateness)) + ' ms): the live translation was late then, which is not a plugin defect — the check waits for it')
    const byArea = {}
    for (const l of left) (byArea[l.area] = byArea[l.area] || []).push(l.text)
    console.log('  · ' + left.length + ' French string(s) left under an English interface, over the eight tabs and their windows:')
    for (const area of Object.keys(byArea)) console.log('      ' + area + ' (' + byArea[area].length + '): ' + byArea[area].map((t) => '« ' + t.slice(0, 70) + ' »').join(' | '))
    // Allowed: the CONTENT of the exported file (its YAML header comment is the file’s own text, not interface copy).
    const unexpected = left.filter((l) => !(l.area.indexOf('Partage') === 0 && /^#/.test(l.text)) && !/^Open Sans$/.test(l.text))      // « Open Sans »: a font family name that the French-words heuristic mistakes for French
    check('English UI: nothing French is left on the eight tabs, the picker or the word pack, except the file content of the export (' + left.length + ' listed, ' + unexpected.length + ' not allowed)', unexpected.length === 0, unexpected.map((l) => l.area + ' « ' + l.text.slice(0, 60) + ' »'))
    const asleep = timings.filter((t) => !t.awake)
    if (asleep.length) note('English UI: the live translators did not answer a canary text within 12 s in ' + asleep.map((t) => t.area).join(', ') + ' (the browser’s timers were throttled; not a verdict on the plugin)')
    if (left.length) note('French left under an English interface (' + left.length + '): ' + Object.keys(byArea).map((a) => a + ' ' + byArea[a].length).join(', ') + ' — listed in the « french » section of the run')
  })

  // ═══ 16. Client ↔ host, end to end, on a TEMP « DSH home » ═══════════════════════════
  // The host half is packages/kybernos-theme/loader-store.mjs. It is not live in the running dsh web, and a check must not
  // write to ~/.dsh anyway: the browser's requests to the two routes are paused at the network level (CDP Fetch) and ANSWERED
  // FROM NODE, by the real serveLoaderStore working on a temp folder. The handler never lets a request through: whatever
  // happens (a mode, a cleanup, an exception) it answers or fails it.
  await section('disk', 'Client ↔ host end to end on a temp folder (routes answered from node by the real loader-store; nothing of ~/.dsh is touched)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'kb-theme-disk-'))
    const dir = join(tmp, 'kybernos')
    const loadersDir = join(dir, 'loaders')
    const settingsFile = join(dir, 'loader-settings.json')
    const wordsFile = join(dir, 'loading-text.json')
    const lottieFile = fileURLToPath(new URL('../packages/kybernos-theme/vendor/lottie_light.min.js', import.meta.url))
    const diskMark = errors.length
    let active = true
    let fetchOn = false
    const disk = { mode: 'up', requests: [], lottie: [] }
    const rd = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch (e) { return null } }
    const files = () => { try { return readdirSync(loadersDir).sort() } catch (e) { return [] } }
    const waitFile = (f, ms = 3500) => until(() => existsSync(f), ms, 100)
    const waitGone = (f, ms = 3500) => until(() => !existsSync(f), ms, 100)
    try {
      const { serveLoaderStore } = await import(new URL('../packages/kybernos-theme/loader-store.mjs', import.meta.url).href)
      const lottieBody = readFileSync(lottieFile).toString('base64')
      const json = (status, body) => ({ status, body: Buffer.from(JSON.stringify(body)).toString('base64'), type: 'application/json' })
      const answer = async (p) => {
        const url = new URL(p.request.url)
        const done = (o) => page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: o.status, responseHeaders: [{ name: 'content-type', value: o.type }, { name: 'cache-control', value: 'no-store' }], body: o.body })
        if (!active) return page.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'ConnectionRefused' })   // after the cleanup: refused, never forwarded
        if (/\/kybernos-theme\/vendor\/lottie\.js$/.test(url.pathname)) {
          disk.lottie.push(url.pathname + url.search)
          return done({ status: 200, body: lottieBody, type: 'application/javascript' })
        }
        if (!/\/kybernos-theme\/loader-store$/.test(url.pathname)) return page.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'ConnectionRefused' })
        const method = p.request.method
        let post = p.request.postData
        if (post === undefined && p.request.hasPostData) { const r = await page.send('Network.getRequestPostData', { requestId: p.networkId }); post = r && r.result ? r.result.postData : undefined }
        let op = null
        try { op = post ? JSON.parse(post).op : null } catch (e) { op = null }
        const rec = { method, op, mode: disk.mode, status: 0, ok: null, at: Date.now() }
        disk.requests.push(rec)
        if (disk.mode === 'e500') { rec.status = 500; return done({ status: 500, body: Buffer.from('<h1>Internal Server Error</h1>').toString('base64'), type: 'text/html' }) }
        if (disk.mode === 'badjson') { rec.status = 200; return done({ status: 200, body: Buffer.from('{ this is not json').toString('base64'), type: 'application/json' }) }
        let out = { status: 500, body: { ok: false, error: 'no answer' } }
        await serveLoaderStore({ method, headers: {} }, {}, {
          home: async () => tmp, sameOriginStrict: () => true, sameOriginLax: () => true,
          readJson: async (req, max) => { if (post === undefined || Buffer.byteLength(post) > max) throw new Error('body too large'); return JSON.parse(post) },
          send: (res, status, body) => { out = { status, body } },
        })
        rec.status = out.status; rec.ok = out.body ? out.body.ok : null
        return done(json(out.status, out.body))
      }
      page.on('Fetch.requestPaused', (p) => { answer(p).catch(() => { /* the page times out: never forwarded */ }) })
      await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/kybernos-theme/loader-store*', requestStage: 'Request' }, { urlPattern: '*/kybernos-theme/vendor/lottie.js*', requestStage: 'Request' }] })
      fetchOn = true
      // The probe: a plain GET from the page (a read, even if it were not intercepted) must be answered by US.
      const probe = await val(`fetch('/kybernos-theme/loader-store?probe=1').then((r) => r.text(), (e) => 'ERR ' + e)`, 8000)
      let pj = null
      try { pj = JSON.parse(String(probe)) } catch (e) { pj = null }
      if (disk.requests.length !== 1 || pj === null || pj.ok !== true || !Array.isArray(pj.loaders) || !Array.isArray(pj.skipped)) {
        throw new Error('the interception does not answer (' + short(probe, 120) + '; seen ' + disk.requests.length + '): section aborted before the plugin can talk to the real route')
      }
      check('the routes are answered from node: a probe GET of /kybernos-theme/loader-store is paused and answered by the real store on ' + '<temp>/kybernos' + ' (empty snapshot)', pj.loaders.length === 0 && pj.settings === null && pj.words === null, pj)
      disk.requests.length = 0
      // from now on the host is ON: the flag script is removed, a reload gives documents without it
      if (flagScriptId !== null) await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: flagScriptId })
      flagScriptId = null

      const dropFile = (name, text, type) => val(`(() => { const input = document.querySelector('[data-kb=ld-file]'); if (!input) return false; const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, { type: ${JSON.stringify(type || '')} })); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
      const importIn = async (name, text, type) => {
        await clickEl(`document.querySelector('[data-kb=ld-tab][data-id=add]')`)
        await sleep(150)
        await dropFile(name, text, type)
        const note = await until(async () => noteOf(), 4000)
        await sleep(200)
        const tabNow = await val(`(document.querySelector('[data-kb=ld-tab][aria-pressed=true]') || { getAttribute: () => null }).getAttribute('data-id')`)
        return { note: note || null, tab: tabNow }
      }
      const openPickerOn = async (tab) => { await clickEl(kb('ld-open-picker')); await pickerIs(true); await clickEl(`document.querySelector('[data-kb=ld-tab][data-id=${tab}]')`); await sleep(300) }
      const closePicker = async () => { await press('Escape'); await pickerIs(false) }
      const GOOD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><g><animateTransform attributeName="transform" type="rotate" from="0 24 24" to="360 24 24" dur="0.8s" repeatCount="indefinite"/><circle cx="24" cy="7" r="6" fill="currentColor"/><circle cx="24" cy="41" r="3" fill="currentColor" opacity=".4"/></g></svg>'
      const HOSTILE = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 48 48" onload="alert(1)"><script>alert(1)</script><foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject><image href="http://evil.example/x.png" width="10" height="10"/><a xlink:href="http://evil.example/"><circle cx="24" cy="24" r="10" fill="currentColor" onclick="alert(2)"/></a><circle cx="8" cy="8" r="3" fill="currentColor"><animate attributeName="r" values="3;6;3" dur="1s" repeatCount="indefinite"/></circle></svg>'
      const BAD = /<script|onload|onclick|foreignobject|<image|href="http|evil\.example|alert\(|javascript:/i
      const WAVE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="currentColor"><rect x="6" y="14" width="6" height="20" rx="3"><animate attributeName="height" values="20;34;20" dur="0.9s" repeatCount="indefinite"/></rect><rect x="21" y="14" width="6" height="20" rx="3"><animate attributeName="height" values="34;20;34" dur="0.9s" repeatCount="indefinite"/></rect></svg>'

      // ── (a) settings: written to loader-settings.json, restored from it in a fresh browser ──
      await openAnimation({ fresh: true })
      check('host ON for this section: window.__KB_THEME_HOST_STORE__ is not set, and the plugin’s own GET reached the interceptor (empty store)', (await val(`typeof window.__KB_THEME_HOST_STORE__`)) === 'undefined' && (await until(() => disk.requests.some((r) => r.method === 'GET' && r.status === 200), 4000)) === true, disk.requests.slice(0, 3))
      await clickEl(kb('ld-amb', ' .kbth-fsbtn')); await sleep(200)
      await clickEl(`document.querySelector('[data-kb=ld-amb] .kbth-fsopt[data-id="mer"]')`)
      await openPickerOn('examples')
      await clickEl(`document.querySelectorAll('.kbth-lcard')[0].querySelector('[data-kb=ld-toggle]')`)
      await clickEl(`document.querySelectorAll('.kbth-lcard')[1].querySelector('[data-kb=ld-toggle]')`)
      await closePicker()
      await clickEl(kb('ld-settings')); await sleep(250)
      await clickEl(`${setBody}.querySelectorAll('.kbth-seg')[0].children[2]`)       // size: Large
      const tLast = Date.now()
      const writtenFile = await until(() => { const j = rd(settingsFile); return j && j.size === 'large' && j.pack === 'mer' && Array.isArray(j.sel) && j.sel.length === 2 ? j : null }, 3500, 100)
      const lag = Date.now() - tLast
      check('after the last change, <temp>/kybernos/loader-settings.json holds the choice within ~1 s (pack mer, 2 animations, size large; found after ' + lag + ' ms)', !!writtenFile && lag < 3000 && typeof writtenFile.updatedAt === 'number', writtenFile)
      const settingsPosts = disk.requests.filter((r) => r.op === 'put-settings')
      check('… through debounced POSTs (fewer put-settings requests than clicks), each accepted (HTTP 200, ok)', settingsPosts.length >= 1 && settingsPosts.length <= 4 && settingsPosts.every((r) => r.status === 200 && r.ok === true), settingsPosts)
      // a fresh browser profile: everything the page stored is gone
      await val(`localStorage.clear()`)
      await openTheme()
      const restored = await until(async () => { const j = await ldGet(); return j && j.pack === 'mer' && j.size === 'large' && j.sel && j.sel.length === 2 ? j : null }, 6000, 200)
      check('a fresh profile (localStorage cleared) gets its choice back from the disk after the reload: pack, 2 animations, size — written into kybernos.theme.loader.v1', !!restored && JSON.stringify(restored.sel) === JSON.stringify(writtenFile.sel), restored)
      await goTab(TAB.animation)
      const slotsNow = await val(`document.querySelectorAll('[data-kb=ld-remove]').length`)
      const sumNow = await val(`document.querySelector('[data-kb=ld-settings] .kbth-disc-s').textContent`)
      const ambShown = await val(`document.querySelector('[data-kb=ld-amb] .kbth-fsname').textContent`)
      const ambMeta = await val(`document.querySelector('[data-kb=ld-amb] .kbth-fsmeta').textContent`)
      check('… and the tab shows it: 2 chosen animations in the rotation, the ambiance select no longer reads DSH’s own (« ' + ambShown + ' », sample words « ' + String(ambMeta).slice(0, 40) + ' »), the settings summary says 40 px', slotsNow === 2 && !/^(dsh|deep)/i.test(String(ambShown)) && /Diving|Sounding|Charting|Surfacing|Keeping watch|Plongée|Sondage|Cap sur|Remontée|Veille/.test(String(ambMeta)) && /40/.test(sumNow), { slotsNow, ambShown, ambMeta, sumNow })

      // ── (b) a good SVG: written as <id>.json, back after a reload, selectable, deletable ──
      await openPickerOn('add')
      const rG = await importIn('good-spin.svg', GOOD, 'image/svg+xml')
      const rec = (await until(() => files().find((f) => /^good-spin-.*\.json$/.test(f)) || null, 3500, 100))
      const gj = rec ? rd(join(loadersDir, rec)) : null
      check('a good animated SVG with currentColor: green banner « added to Mes animations » (the host answered ok), the picker switches to that tab, and <temp>/kybernos/loaders/<id>.json appears', rG.note !== null && /ok/.test(rG.note.cls) && !/warn|err/.test(rG.note.cls) && rG.tab === 'mine' && !!rec, { note: rG.note, tab: rG.tab, files: files() })
      check('… the file is a record of type svg, kind mono, source file, size ≤ 200 KB and the data is the SVG', !!gj && gj.type === 'svg' && gj.kind === 'mono' && gj.source === 'file' && gj.size > 0 && gj.size <= 204800 && /<svg/.test(gj.data) && /<circle/.test(gj.data), gj && { type: gj.type, kind: gj.kind, source: gj.source, size: gj.size })
      await closePicker()
      await openTheme()
      await goTab(TAB.animation)
      await openPickerOn('mine')
      const listed = await until(async () => (await cardsInfo()).find((c) => /good-spin/.test(c.name)) || null, 7000, 250)
      check('after a reload it is listed in « Mes animations » (read back from the disk) and its button is enabled', !!listed && listed.disabled === false && /ajouter|add/i.test(listed.label), listed)
      if (listed) {
        await clickEl(`document.querySelector('.kbth-lcard[data-id="${listed.id}"] [data-kb=ld-toggle]')`)
        const selected = await until(async () => { const j = await ldGet(); return j && j.sel.includes(listed.id) ? j : null }, 3000, 150)
        check('… it can be selected (stored in the rotation: 3 of 4)', !!selected && selected.sel.length === 3, selected && selected.sel)
        await clickEl(`document.querySelector('.kbth-lcard[data-id="${listed.id}"] [data-kb=ld-delete]')`)
        const gone = await waitGone(join(loadersDir, listed.id + '.json'))
        const removedFromSel = await until(async () => { const j = await ldGet(); return j && !j.sel.includes(listed.id) ? j : null }, 3000, 150)
        check('deleting it from the picker removes <id>.json from the disk and takes it out of the rotation', gone === true && !!removedFromSel, { gone, sel: removedFromSel && removedFromSel.sel })
      }

      // ── (c) the hostile SVG: what reached the disk is clean; a record that still contains <script is REFUSED by the host ──
      const rH = await importIn('hostile.svg', HOSTILE, 'image/svg+xml')
      const recH = (await until(() => files().find((f) => /^hostile-.*\.json$/.test(f)) || null, 3500, 100))
      const hj = recH ? rd(join(loadersDir, recH)) : null
      const rawH = recH ? readFileSync(join(loadersDir, recH), 'utf8') : ''
      check('the hostile SVG is accepted after cleaning: green banner naming the number of dangerous elements removed, record written', rH.note !== null && /ok/.test(rH.note.cls) && /\d+\D{0,40}(retir|remov)/i.test(rH.note.text) && !!hj, { note: rH.note, file: recH })
      check('… and the file on the disk contains none of <script, onload, onclick, foreignObject, <image, an http href, evil.example', !!hj && !BAD.test(rawH) && /<circle/.test(hj.data) && /<animate/.test(hj.data), rawH.slice(0, 200))
      const hostRefusalsBefore = disk.requests.filter((r) => r.ok === false).length
      const refusalMark = errors.length
      const forcedJson = await val(`fetch('/kybernos-theme/loader-store', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'put-loader', loader: { id: 'forced-bad', name: 'Forced', type: 'svg', kind: 'mono', source: 'file', data: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="3"/></svg>' } }) }).then((r) => r.json()).then((j) => JSON.stringify(j))`, 8000)
      let fj = null
      try { fj = JSON.parse(String(forcedJson)) } catch (e) { fj = null }
      check('a record that still has <script, POSTed straight through the page’s own fetch, is refused by the host as a NORMAL answer (HTTP 200 with ok:false, the reason names the script) and NO file is written', fj !== null && fj.ok === false && /script/i.test(String(fj.error)) && !existsSync(join(loadersDir, 'forced-bad.json')) && disk.requests.filter((r) => r.ok === false).length === hostRefusalsBefore + 1 && disk.requests.some((r) => r.status === 200 && r.ok === false && r.op === 'put-loader'), { answer: fj, files: files(), requests: disk.requests.filter((r) => r.ok === false) })
      await closePicker()

      const polls = await needVisible('the checks that rely on the pane’s 4 s poll (bare files, words file, host failures)')
      // ── (d) bare files dropped by the skill ──
      await openPickerOn('mine')
      if (polls) {
        writeFileSync(join(loadersDir, 'wave-test.svg'), WAVE)
        writeFileSync(join(loadersDir, 'bad-script.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><circle cx="5" cy="5" r="3" fill="currentColor"/></svg>')
        const tDrop = Date.now()
        const wave = await until(async () => (await cardsInfo()).find((c) => /wave/i.test(c.name)) || null, 11000, 250)
        const waveMeta = wave ? await val(`document.querySelector('.kbth-lcard[data-id="${wave.id}"] .kbth-lcard-meta').textContent`) : ''
        check('a bare <name>.svg dropped in the loaders folder shows up by itself in the open « Mes animations » tab (the pane polls every 4 s; seen after ' + (Date.now() - tDrop) + ' ms) as a Skill card of one colour', !!wave && wave.id === 'f-wave-test' && wave.kind === 'mono' && /skill/i.test(waveMeta) && Date.now() - tDrop < 9500, { wave, meta: waveMeta })
        const snap = JSON.parse(await val(`fetch('/kybernos-theme/loader-store').then((r) => r.json()).then((j) => JSON.stringify({ ids: j.loaders.map((l) => l.id), skipped: j.skipped }))`, 8000))
        const cardsNow = await cardsInfo()
        check('an invalid bare SVG (with <script) in the same folder does NOT appear as a card, and the GET answer lists it in `skipped` with the reason', !cardsNow.some((c) => /bad/i.test(c.name)) && !snap.ids.includes('f-bad-script') && snap.skipped.some((x) => x.file === 'bad-script.svg' && /script/i.test(x.reason)), snap)
        await clickEl(`document.querySelector('.kbth-lcard[data-id="f-wave-test"] [data-kb=ld-delete]')`)
        check('deleting a bare-file animation from the picker removes the .svg file too', (await waitGone(join(loadersDir, 'wave-test.svg'))) === true, files())
        rmSync(join(loadersDir, 'bad-script.svg'), { force: true })
        await closePicker()
      }

      // ── (e) the user's pack of words, written by the skill ──
      await clickEl(kb('ld-amb', ' .kbth-fsbtn')); await sleep(250)
      if (polls) {
        const persoBefore = (await ambOptions()).find((o) => o.id === 'perso')
        writeFileSync(wordsFile, JSON.stringify({ version: 1, words: ['Écoute', 'Suivi'] }))
        const tW = Date.now()
        const persoOn = await until(async () => { const o = (await ambOptions()).find((x) => x.id === 'perso'); return o && o.disabled === false ? o : null }, 11000, 300)
        check('writing <temp>/kybernos/loading-text.json makes « Mon pack » selectable by itself (was disabled: ' + (persoBefore && persoBefore.disabled) + '; seen after ' + (Date.now() - tW) + ' ms)', !!persoBefore && persoBefore.disabled === true && !!persoOn, { before: persoBefore, after: persoOn })
        if (persoOn) {
          await clickEl(`document.querySelector('[data-kb=ld-amb] .kbth-fsopt[data-id="perso"]')`)
          const label = await until(async () => { const t = await val(`(document.querySelector('[data-kb=ld-label]') || { textContent: '' }).textContent`); return /Écoute|Suivi/.test(String(t)) ? t : null }, 4000, 200)
          check('choosing it stores pack = perso and the preview label uses one of those words (« ' + label + ' »)', (await ldGet()).pack === 'perso' && !!label, label)
        }
      }

      // ── (f) Lottie for real ──
      const LOTTIE = { v: '5.7.0', fr: 30, ip: 0, op: 60, w: 100, h: 100, nm: 'Spinner test', ddd: 0, assets: [], layers: [{ ddd: 0, ind: 1, ty: 4, nm: 'rect', sr: 1, ks: { o: { a: 0, k: 100 }, r: { a: 1, k: [{ i: { x: [0.667], y: [1] }, o: { x: [0.333], y: [0] }, t: 0, s: [0] }, { t: 60, s: [360] }] }, p: { a: 0, k: [50, 50, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } }, ao: 0, shapes: [{ ty: 'gr', it: [{ ty: 'rc', d: 1, s: { a: 0, k: [40, 40] }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 6 }, nm: 'Rect' }, { ty: 'fl', c: { a: 0, k: [0.9, 0.3, 0.3, 1] }, o: { a: 0, k: 100 }, r: 1, nm: 'Fill' }, { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 } }], nm: 'Group' }], ip: 0, op: 60, st: 0, bm: 0 }] }
      await openPickerOn('add')
      const lottieReqBefore = disk.lottie.length
      const rL = await importIn('spinner.json', JSON.stringify(LOTTIE), 'application/json')
      const recL = await until(() => files().find((f) => /^spinner-.*\.json$/.test(f)) || null, 3500, 100)
      const lj = recL ? rd(join(loadersDir, recL)) : null
      check('a small valid Lottie JSON is accepted by the host: green banner, record of type lottie written to the disk', rL.note !== null && /ok/.test(rL.note.cls) && !!lj && lj.type === 'lottie' && lj.data && lj.data.layers.length === 1, { note: rL.note, type: lj && lj.type })
      if (lj) {
        await clickEl(`document.querySelector('.kbth-lcard[data-id="${lj.id}"] [data-kb=ld-toggle]')`).catch(async () => { await clickEl(`document.querySelector('[data-kb=ld-tab][data-id=mine]')`); await sleep(300); await clickEl(`document.querySelector('.kbth-lcard[data-id="${lj.id}"] [data-kb=ld-toggle]')`) })
        const lotSel = await until(async () => { const j = await ldGet(); return j && j.sel.includes(lj.id) ? j : null }, 3000, 150)
        const engine = await until(() => val(`typeof window.lottie !== 'undefined' && !!window.lottie.loadAnimation`), 8000, 250)
        check('selecting it makes the page load /kybernos-theme/vendor/lottie.js (the interceptor served the vendored file: ' + disk.lottie.join(', ') + ') and window.lottie exists', !!lotSel && engine === true && disk.lottie.length > lottieReqBefore && /lottie\.js/.test(disk.lottie[0]), { requests: disk.lottie, engine, before: lottieReqBefore })
        await closePicker()
        const drawn = await until(() => val(`(() => { const slot = Array.from(document.querySelectorAll('.kbth-lds')).find((s) => s.textContent.indexOf('Spinner test') >= 0); const svg = slot && slot.querySelector('.kb-ld svg'); return svg ? svg.innerHTML.length : 0 })()`), 8000, 250)
        const snap1 = await val(`(() => { const slot = Array.from(document.querySelectorAll('.kbth-lds')).find((s) => s.textContent.indexOf('Spinner test') >= 0); const g = slot && slot.querySelector('.kb-ld svg'); return g ? g.innerHTML : '' })()`)
        const moved = await until(async () => (await val(`(() => { const slot = Array.from(document.querySelectorAll('.kbth-lds')).find((s) => s.textContent.indexOf('Spinner test') >= 0); const g = slot && slot.querySelector('.kb-ld svg'); return g ? g.innerHTML : '' })()`)) !== snap1, 3000, 150)
        check('the rotation slot of that Lottie contains an <svg> drawn by the engine (' + drawn + ' characters), and it MOVES (the markup changes between two samples)', drawn > 100 && moved === true, { drawn, moved })
      }
      const extFilesBefore = files().length
      await openPickerOn('add')
      const rE = await importIn('external.json', JSON.stringify({ ...LOTTIE, nm: 'External asset', assets: [{ id: 'i', w: 1, h: 1, u: 'http://x/', p: 'a.png' }] }), 'application/json')
      check('a Lottie that references an external image asset is refused BY THE HOST with a red banner « Refusée par DSH : lottie refused … embedded », nothing is added and no file is written', rE.note !== null && /err/.test(rE.note.cls) && /DSH|refus/i.test(rE.note.text) && /embedded|lottie/i.test(rE.note.text) && files().length === extFilesBefore && !(await cardsInfo()).some((c) => /external/i.test(c.name)), { note: rE.note, files: files().length, before: extFilesBefore })
      const refusals = disk.requests.filter((r) => r.ok === false)
      const refusalLogs = errors.slice(refusalMark).filter((e) => e.kind === 'log' && /loader-store/.test(e.url))
      check('both refusals (the forced <script record, the Lottie with an external image) were HTTP 200 answers, and they left NO « Failed to load resource » line for loader-store in the console', refusals.length === 2 && refusals.every((r) => r.status === 200) && refusalLogs.length === 0, { refusals: refusals.map((r) => r.op + ' ' + r.status), logs: refusalLogs.map((e) => e.text) })
      await closePicker()

      // ── (g) the host fails: the page keeps working and says so ──
      await openPickerOn('mine')
      if (polls) {
        const warnNow = () => val(`(() => { const w = document.querySelector('[data-kb=ld-picker] .kbth-status.warn:not([data-kb=ld-note])'); return w ? w.textContent : null })()`)
        check('while the host answers, no yellow « the disk does not answer » banner', (await warnNow()) === null)
        const errMark = errors.length
        disk.mode = 'e500'
        const w500 = await until(warnNow, 11000, 300)
        check('a GET answered with HTTP 500 leaves the yellow « Le disque de DSH ne répond pas » banner (the pane polls every 4 s)', !!w500 && /disque|disk/i.test(String(w500)), w500)
        check('… and the page keeps working: Settings and the picker are still there, the cards still listed', (await settingsPageOpen()) === true && (await val(`!!document.querySelector('[data-kb=ld-picker]')`)) === true && (await cardsInfo()).length >= 1, { cards: (await cardsInfo()).length })
        const rLocal = await importIn('local-500.svg', GOOD, 'image/svg+xml')
        check('an import while the host fails is kept in the browser: yellow banner « not saved on the disk, it stays in this browser until the reload », picker on « Mes animations », and no file is written', rLocal.note !== null && /warn/.test(rLocal.note.cls) && /enregistr|saved/i.test(rLocal.note.text) && rLocal.tab === 'mine' && !files().some((f) => /^local-500/.test(f)), { note: rLocal.note, tab: rLocal.tab, files: files() })
        disk.mode = 'up'
        const wGone = await until(async () => ((await warnNow()) === null ? true : null), 11000, 300)
        check('when the host answers again the banner goes away by itself', wGone === true)
        disk.mode = 'badjson'
        const wBad = await until(warnNow, 11000, 300)
        check('a GET answered with 200 and invalid JSON leaves the same yellow banner', !!wBad && /disque|disk/i.test(String(wBad)), wBad)
        disk.mode = 'up'
        const themeErrs = themeErrorsSince(errMark)
        check('… without any [kybernos-theme] error or exception in the console during the failures', themeErrs.length === 0, themeErrs.slice(0, 2))
        await closePicker()
      }

      // malformed requests are still 400 (they are not a refused record: nothing the page itself sends)
      const bad = await val(`Promise.all([{ op: 'nope' }, [1, 2], 'text'].map((b) => fetch('/kybernos-theme/loader-store', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(async (r) => r.status + ':' + ((await r.json()).ok)))).then((a) => a.join(' '))`, 8000)
      check('malformed requests (unknown op, an array body, a bare string) are still HTTP 400 with ok:false', bad === '400:false 400:false 400:false', bad)
      check('the section only ever talked to the interceptor: ' + disk.requests.length + ' requests to loader-store (' + [...new Set(disk.requests.map((r) => r.method + ' ' + (r.op || '')))].join(', ') + ') and ' + disk.lottie.length + ' to the lottie file, all answered from node', disk.requests.length > 5 && disk.lottie.length >= 1)
    } finally {
      // The page must never talk to the real route after this: flag back on in the live document and in every future one,
      // THEN stop intercepting (a late request is refused, not forwarded).
      try { await val(`window.__KB_THEME_HOST_STORE__ = false`) } catch (e) { /* page gone */ }
      if (flagScriptId === null) { const r = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: FLAG_SRC }); flagScriptId = r && r.result ? r.result.identifier : null }
      await sleep(900)                                   // a debounced push of the last change (700 ms) is dropped by the flag
      active = false
      if (fetchOn) { try { await page.send('Fetch.disable', {}) } catch (e) { /* closed */ } }
      try { rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* busy */ }
      if (existsSync(tmp)) console.log('  ! the temp folder could not be removed: ' + tmp)
    }
  })

} catch (e) {
  fail += 1
  console.log('  ✗ the test itself stopped: ' + short(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ⏎ ') : e))
} finally {
  await restoreUserSettings()
}
{
  const lightOnly = (l) => { const meta = l.split(' — ').slice(1).join(' — '); return /(Light|Clair)/i.test(meta) && !/(Light|Clair) \+ (dark|sombre)/i.test(meta) }
  check('safety: ' + clicks.skins.length + ' theme dots were clicked, none of them a Light theme; the Mode buttons were not touched (only the restore step may press one)', !clicks.skins.some(lightOnly) && clicks.modeOutsideRestore === 0, { light: clicks.skins.filter(lightOnly), mode: clicks.modeOutsideRestore })
}
if (startUi !== null) {
  const ok = await until(() => { const u = storedUi(); return u !== null && u.preference === startUi.preference && u.fontSize === startUi.fontSize }, 8000)
  if (!ok) console.log('\n  !!! NOT RESTORED — DSH’s own settings are not what they were: found at the start ' + JSON.stringify(startUi) + ', now ' + JSON.stringify(storedUi()) + '. Put them back in Settings › Theme (mode) and with the text-size slider.')
  check('no residue: the mode and the font size DSH has STORED are back to what they were (' + JSON.stringify(startUi) + ')', ok === true, { before: startUi, after: storedUi() })
}
const otherErrors = errors.filter((ev, i) => !isThemeError(ev) && !provoked.has(i))
if (gaps.length) {
  console.log('\n══ KNOWN GAPS (not counted as failures) ══')
  for (const g of gaps.filter((x) => x.kind === 'note')) console.log('  • ' + g.area + ': ' + g.text)
}
if (observations.length) {
  console.log('\n══ OBSERVATIONS (not counted as failures) ══')
  for (const o of observations) console.log('  · ' + o)
}
if (otherErrors.length) console.log('\n  (' + otherErrors.length + ' console error(s) from the rest of DSH, none from kybernos-theme: ' + [...new Set(otherErrors.map((ev) => short(ev.text.split('\n')[0], 90)))].slice(0, 3).join(' | ') + ')')
if (watcher !== null) watcher.close()
await live.close()
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
