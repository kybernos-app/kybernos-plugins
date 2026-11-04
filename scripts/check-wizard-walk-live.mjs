// The first-run wizard played the way a person plays it, screen by screen, in one language, with a real mouse and a measure of every screen.
// It answers nothing for the product: it writes one JSON line per screen (heading, step label, text, buttons with their boxes, what is cut or
// runs past the window, every « undefined » / « NaN » / unfilled { }, controls under 32 px, the English-looking lines in a French run) and a
// picture, then reads the new-chat page behind the wizard once it is closed. SANDBOX ONLY: it rewrites the sandbox's onboarding state (`completed:false`)
// and puts the file back at the end (also when the run is cut).
//
//   source scripts/sandbox/env.sh && node scripts/check-wizard-walk-live.mjs --lang en --out <folder outside the repo>
//   options: --lang en|fr|es|ar   --field <n> (0-based tile of the field screen, default 0)   --model keep|account (default keep)
//            --width 1440 --height 900
//   « keep » presses « Keep as is » on the model question, « account » presses « Connect an account » and reads the waiting screen (the sandbox
//   must have KYBERNOS_CLOUD_API pointing at a disposable server; a plain sandbox would talk to the real one, so the run refuses then).
//
// Exit 0 = the walk reached the new-chat page, 1 = it stopped on a screen it could not leave, 2 = refusal, 3 = wrong environment.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { goToSettingsPage, openLivePage, openSettings } from './live-page.mjs'

const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt }
const LANG = arg('lang', 'en')
const OUT = arg('out', '')
const FIELD = Number(arg('field', '0'))
const MODEL = arg('model', 'keep')
// --app-language fr: first put the whole app in the built-in French (Settings > Language > Use, in this browser), then open the wizard: it opens in the app's language.
const APP_LANG = arg('app-language', '')
const WIDTH = Number(arg('width', '1440'))
const HEIGHT = Number(arg('height', '900'))
const authority = process.env.KB_HOST || '127.0.0.1:3080'
const dshHome = process.env.DSH_HOME
if (authority === '127.0.0.1:3080') { console.error('refusing to run against :3080: this check rewrites the onboarding state. Use a sandbox (source scripts/sandbox/env.sh).'); process.exit(2) }
if (!dshHome || !dshHome.includes('.kybernos-sandbox')) { console.error('DSH_HOME is not a sandbox home: source scripts/sandbox/env.sh'); process.exit(3) }
if (OUT === '') { console.error('--out <folder outside the repository> is required'); process.exit(2) }
if (OUT.includes('/worktrees/') || OUT.startsWith(process.cwd() + '/')) { console.error('refusing an output folder inside the repository'); process.exit(2) }
if (!['en', 'fr', 'es', 'ar'].includes(LANG)) { console.error('--lang is one of en, fr, es, ar'); process.exit(2) }
if (!['keep', 'account'].includes(MODEL)) { console.error('--model is keep or account'); process.exit(2) }
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const onboardingFile = join(dshHome, 'kybernos/onboarding.json')
let backup = null
try { backup = readFileSync(onboardingFile, 'utf8') } catch (e) { backup = null }
const restore = () => { try { if (backup !== null) writeFileSync(onboardingFile, backup) } catch (e) { /* the sandbox is nobody's */ } }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restore(); process.exit(130) })
const NOT_DONE = JSON.stringify({ version: 1, completed: false, installedAt: '2026-01-01T00:00:00.000Z', completedAt: null, profil: null, uiMode: null }) + '\n'

const LOOK = `(() => {
  const o = document.querySelector('.kb-ob')
  if (!o) return null
  const vw = innerWidth; const vh = innerHeight
  const R = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }
  const shown = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
  const step = o.querySelector('.kb-ob-step') || o.querySelector('main') || o
  const main = o.querySelector('main')
  const pv = o.querySelector('.kb-ob-pv')
  const lines = (step.innerText || '').split('\\n').map((s) => s.trim()).filter(Boolean)
  const buttons = Array.from(o.querySelectorAll('button, a[href], input, textarea, [role=button]')).filter(shown).filter((e) => !(pv && pv.contains(e))).map((e) => ({
    text: (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().slice(0, 70), cls: String(e.className || '').slice(0, 40), rect: R(e),
    disabled: e.disabled === true, label: e.getAttribute('aria-label') || null }))
  const small = buttons.filter((b) => b.rect[3] < 32 || b.rect[2] < 32).map((b) => ({ text: b.text || b.label, rect: b.rect }))
  const cut = []
  for (const e of Array.from(o.querySelectorAll('*'))) {
    if (!shown(e) || (pv && pv.contains(e))) continue
    const cs = getComputedStyle(e)
    if (e.children.length === 0 && (e.textContent || '').trim() !== '' && e.scrollWidth > e.clientWidth + 1 && (cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis')) cut.push({ text: e.textContent.trim().slice(0, 60), scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, ellipsis: cs.textOverflow === 'ellipsis' })
  }
  const past = []
  for (const e of Array.from(step.querySelectorAll('*'))) {
    if (!shown(e)) continue
    const r = e.getBoundingClientRect()
    if (r.right > vw + 1 || r.left < -1) past.push({ what: (e.innerText || e.className || e.tagName).toString().trim().slice(0, 40), rect: R(e) })
  }
  const body = lines.join(' | ')
  const bad = body.match(/undefined|NaN|\\[object|\\bnull\\b|\\{[a-zA-Z.]+\\}|%s|\\$\\{/g) || []
  const active = document.activeElement
  const bar = o.querySelector('.kb-ob-bar i')
  return {
    h1: ((o.querySelector('h1') || {}).textContent || '').trim(),
    stepLabel: (lines.find((l) => /\\b\\d+\\b.*\\b\\d+\\b/.test(l) && l.length < 30) || null),
    lang: o.getAttribute('lang'), dir: o.getAttribute('dir'), role: o.getAttribute('role'), modal: o.getAttribute('aria-modal'), ariaLabel: o.getAttribute('aria-label'),
    dialog: R(o), main: main ? R(main) : null, mainScroll: main ? { scrollHeight: main.scrollHeight, clientHeight: main.clientHeight } : null,
    progress: bar ? bar.style.width : null,
    previewShown: pv ? shown(pv) : false,
    lines, buttons, small, cut, past, bad,
    scrollsSideways: document.documentElement.scrollWidth > vw + 1,
    focus: active ? ((active.className || active.tagName) + ':' + (active.textContent || '').trim().slice(0, 30)) : null,
    viewport: [vw, vh],
  }
})()`

const live = await openLivePage({ keepKeyDialog: true, width: WIDTH, height: HEIGHT }).catch((e) => { console.error('inconclusive: ' + e.message); process.exit(3) })
const page = live.page
const ev = async (js, ms) => { const r = await page.evalJs(js, ms || 8000); return r.err ? { __err: r.err } : r.val }
const press = async (sel, idx = 0, text = null) => {
  const r = await ev(`(() => {
    const all = Array.from(document.querySelectorAll(${JSON.stringify(sel)}))
    const want = ${JSON.stringify(text)}
    const list = want === null ? all : all.filter((e) => (e.innerText || '').trim().replace(/\\s+/g, ' ').toLowerCase().includes(want.toLowerCase()))
    const e = list[${idx}]
    if (!e) return null
    e.scrollIntoView({ block: 'center' })
    const b = e.getBoundingClientRect()
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, text: (e.innerText || '').trim().slice(0, 40) }
  })()`)
  if (!r || r.__err) return null
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  return r
}
const ENGLISH = /\b(the|and|your|you|with|for|this|that|from|only|will|not|about|have|can|are|is|to|of|in|on)\b/i
const shots = []
const seen = []
const shot = async (name) => { const f = join(OUT, name + '.png'); await page.shot(f).catch(() => {}); shots.push(f); return f }
const look = async (label) => {
  const d = await ev(LOOK)
  if (d === null || d === undefined || d.__err) { console.log('## ' + label + ' | no wizard on screen'); return null }
  if (LANG === 'fr') d.englishLooking = d.lines.filter((l) => ENGLISH.test(l) && !/^[A-Z][A-Za-z]+$/.test(l)).slice(0, 12)
  d.label = label
  d.picture = await shot(String(seen.length + 1).padStart(2, '0') + '-' + LANG + '-' + label.replace(/[^a-z0-9]+/gi, '-').toLowerCase())
  seen.push(d)
  console.log('## ' + label + ' | h1: ' + d.h1 + ' | ' + (d.stepLabel || '-') + ' | buttons ' + d.buttons.length + ' | small ' + d.small.length + ' | cut ' + d.cut.length + ' | past ' + d.past.length + ' | bad ' + JSON.stringify(d.bad))
  return d
}
const waitH1 = async (notText, ms = 8000) => {
  const end = Date.now() + ms
  while (Date.now() < end) { const h = await ev(`((document.querySelector('.kb-ob h1')||{}).textContent||'').trim()`); if (h && h !== notText) return h; await sleep(250) }
  return null
}

let code = 0
let newChat = null
try {
  if (APP_LANG === 'fr') {
    await openSettings(page)
    await goToSettingsPage(page, /^(Language|Langue)$/, { marker: `!!document.querySelector('[data-lang]')` })
    await ev(`(() => { const b = document.querySelector('[data-lang="kybernos"] [data-act="use"]'); if (b) b.click(); return !!b })()`)
    await sleep(3000)
    console.log('## the app language is now: ' + (await ev('document.documentElement.lang')))
  }
  writeFileSync(onboardingFile, NOT_DONE)
  await page.send('Page.reload', {})
  await sleep(4000)
  const up = await (async () => { for (let i = 0; i < 40; i += 1) { if ((await ev(`!!document.querySelector('.kb-ob h1')`)) === true) return true; await sleep(500) } return false })()
  if (!up) { console.error('inconclusive: the wizard did not open (is the onboarding state read at start-up?)'); code = 3; throw new Error('no wizard') }
  if (MODEL === 'account') {
    // The account path asks a server for a pairing code: only a disposable one (KYBERNOS_CLOUD_API on a loopback address) may be asked.
    const st = await ev(`fetch('/kybernos-servers/status').then((r) => r.text()).catch(() => '')`)
    if (!/"source"\s*:\s*"env"/u.test(String(st))) { console.error('inconclusive: --model account needs a sandbox started with KYBERNOS_CLOUD_API on a disposable server'); code = 3; throw new Error('plain sandbox') }
  }
  await look('welcome-first')
  // The wizard opens in the language the app is in; the language button changes only the wizard's own language.
  const startedIn = await ev(`document.querySelector('.kb-ob').getAttribute('lang')`)
  console.log('## the wizard opens in: ' + startedIn)
  if (LANG !== startedIn) {
    const menu = await press('.kb-ob-lang-btn'); await sleep(300)
    const items = await ev(`Array.from(document.querySelectorAll('.kb-ob-menu button')).map((b) => b.getAttribute('lang') + ':' + b.textContent.trim())`)
    console.log('## language menu | ' + JSON.stringify(items))
    seen.push({ label: 'language-menu', items, menuPressed: menu !== null })
    await shot('lang-menu')
    await press('.kb-ob-menu button[lang="' + LANG + '"]'); await sleep(600)
  }
  const welcome = await look('welcome')
  let h = welcome ? welcome.h1 : ''
  await press('[data-kb-ob-primary]'); h = (await waitH1(h)) || h
  await sleep(600)
  await look('field')
  await press('.kb-ob-tile', FIELD); await sleep(500)
  await look('field-chosen')
  await press('[data-kb-ob-primary]'); h = (await waitH1(h)) || h
  await sleep(600)
  await look('goals')
  await press('.kb-ob-chip', 0); await sleep(300)
  await look('goals-one-more')
  await press('[data-kb-ob-primary]'); h = (await waitH1(h)) || h
  await sleep(600)
  await look('model')
  if (MODEL === 'account') {
    await press('.kb-ob-row', 0); await sleep(300)
    await press('[data-kb-ob-primary]'); await sleep(2500)
    await look('account-waiting')
    await press('.kb-ob-back'); await sleep(1200)
    await look('model-after-back')
  }
  await press('.kb-ob-ghost', 0); h = (await waitH1(h)) || h
  await sleep(700)
  await look('about')
  await press('[data-kb-ob-primary]'); h = (await waitH1(h)) || h
  await sleep(700)
  await look('agents')
  await press('[data-kb-ob-primary]'); h = (await waitH1(h)) || h
  await sleep(1500)
  await look('kit')
  await press('.kb-ob-ghost', 0); h = (await waitH1(h)) || h
  await sleep(1500)
  await look('plan')
  await press('.kb-ob-second', 1); await sleep(2500)
  await look('done')
  await press('[data-kb-ob-primary]'); await sleep(2500)
  const gone = (await ev(`!document.querySelector('.kb-ob')`)) === true
  console.log('## wizard closed: ' + gone)
  newChat = await ev(`(() => {
    const vw = innerWidth
    const R = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }
    const txt = document.body.innerText.replace(/\\s+/g, ' ').trim()
    const bad = txt.match(/undefined|NaN|\\[object|\\bnull\\b/g) || []
    const composer = document.querySelector('textarea, [contenteditable="true"], [role="textbox"]')
    const headings = Array.from(document.querySelectorAll('h1, h2, [role=heading]')).map((e) => e.textContent.trim().slice(0, 60))
    return { title: document.title, headings, composer: composer ? R(composer) : null, bad, scrollsSideways: document.documentElement.scrollWidth > vw + 1, text: txt.slice(0, 900), lang: document.documentElement.lang }
  })()`)
  await shot('99-' + LANG + '-new-chat')
  const state = JSON.parse(readFileSync(onboardingFile, 'utf8'))
  // the answers only (no secret is kept in this file): what the wizard wrote
  const answers = { completed: state.completed, profil: state.profil, uiMode: state.uiMode, lang: state.lang, domain: state.domain, goals: state.goals, customGoals: state.customGoals, agents: state.agents, model: state.model, theme: state.theme }
  const chips = await ev(`Array.from(document.querySelectorAll('button')).map((b) => (b.innerText || '').trim()).filter((t) => /mode$|^mode|mode /i.test(t) && t.length < 40).slice(0, 6)`)
  console.log('## onboarding file after: ' + JSON.stringify(answers) + ' | mode chips on the page: ' + JSON.stringify(chips))
  seen.push({ label: 'after', wizardClosed: gone, newChat, onboarding: answers, modeChips: chips })
  if (!gone || state.completed !== true) code = 1
} catch (e) {
  if (code === 0) code = 1
  console.error('stopped: ' + (e && e.message ? e.message : e))
} finally {
  writeFileSync(join(OUT, 'walk-' + LANG + '.json'), JSON.stringify({ lang: LANG, field: FIELD, model: MODEL, viewport: [WIDTH, HEIGHT], screens: seen }, null, 1))
  restore()
  try { await live.close() } catch (e) { /* gone */ }
}
process.exit(code)
