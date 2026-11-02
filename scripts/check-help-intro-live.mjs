#!/usr/bin/env node
// The help that explains and links, in a real GUI: the animated help that opens the first time a page is visited (Skills, Connectors,
// Remote Control), the one « ? How it works » button on every page, the article link on a card, and the lines that say what Usage,
// Tools, Workers and Commands are for.
//
//   source scripts/sandbox/env.sh && node scripts/check-help-intro-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh): the hub, the pages and the help.json catalogue are the checkout's.
// Refuses :3080. Read-only: nothing here changes a setting (the browser is a throw-away one, its localStorage starts empty: that IS
// « the first visit »). Exit code 0 / 1 / 3.
import { join } from 'node:path'
import { openLivePage } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 400))) } }

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a DSH that serves this checkout (a sandbox instance), not the one on :3080. Set KB_HOST, DSH_HOME and HOME.'); process.exit(3) }

const live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const shot = async (name) => { if (shotDir !== null) { try { await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const poll = async (fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(250) } }
const mouse = async (x, y) => { for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }) }
const press = async (sel) => { const p = await val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`); if (p === null || p === undefined) return false; await mouse(p.x, p.y); await sleep(350); return true }

const sidebar = async (label, marker) => {
  // The sidebar entries (Skills, Connectors…): click the leaf of the left column that says the word.
  // The entry appears when the plugins have loaded: wait for it rather than click on nothing.
  const p = await poll(() => val(`(() => { const e = Array.from(document.querySelectorAll('[data-slot="sidebar"] *, nav *')).filter((x) => x.children.length === 0 && (x.innerText || '').trim() === ${JSON.stringify(label)} && x.getBoundingClientRect().width > 3)[0]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`), 20000)
  if (p === null || p === undefined || p === false) return false
  // A click made while the shell is still settling can open nothing: the page is there once its own text is, so click again if it is not.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await mouse(p.x, p.y)
    await sleep(1200)
    if (marker === undefined) return true
    if ((await poll(() => val(`document.body.innerText.includes(${JSON.stringify(marker)})`), 4000)) === true) return true
  }
  return false
}
const inSettings = async () => (await val(`/Back to workspace/.test(document.body.innerText)`)) === true
const openSettingsDialog = async () => {
  if (await inSettings()) return true
  await val(`document.querySelector('[class*="settingsArea"] button[class*="trigger"]').click()`)
  return (await poll(inSettings, 8000)) === true
}
const leaveSettings = async () => {
  if (!(await inSettings())) return
  await val(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /Back to workspace/.test(x.innerText)); if (b) b.click() })()`)
  await sleep(1200)
}
const goTo = async (label) => {
  const ok = await val(`(() => { const b = Array.from(document.querySelectorAll('button[class*="navCell"]')).find((x) => x.innerText.trim().split('\\n')[0] === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true })()`)
  await sleep(1800)
  return ok
}
const reload = async () => { await page.send('Page.reload', { ignoreCache: true }); await sleep(3500) }

const intro = (id) => `document.querySelector('[data-kb="help-intro"][data-id="${id}"]')`
const hasIntro = (id) => val(`!!${intro(id)}`)
const store = (id) => val(`localStorage.getItem('kybernos.help.intro.${id}')`)
// How many CSS animations are running inside the animation of a page, and which step is lit (opacity 1) right now.
const running = (id) => val(`(() => { const r = ${intro(id)}; if (!r) return -1; return document.getAnimations().filter((a) => { const t = a.effect && a.effect.target; return t && r.contains(t) && a.playState === 'running' }).length })()`)
const lit = (id) => val(`(() => { const r = ${intro(id)}; if (!r) return null; return Array.from(r.querySelectorAll('.kbhi-step')).map((s) => getComputedStyle(s).opacity === '1' ? 1 : 0).join('') })()`)
const mockState = (id) => val(`(() => { const r = ${intro(id)}; if (!r) return null; const o = (q) => { const e = r.querySelector(q); return e ? getComputedStyle(e).opacity : null }; return { t1: o('.kbhi-mm-st .t1'), t2: o('.kbhi-mm-st .t2'), t3: o('.kbhi-mm-st .t3'), done: o('.kbhi-mm-done'), go: o('.kbhi-mm-go'), hot: o('.kbhi-mm-row.hot') } })()`)
const introText = (id) => val(`(() => { const r = ${intro(id)}; return r ? r.innerText.replace(/\\s+/g, ' ').trim() : '' })()`)

// The « ? How it works » button of a page, whatever draws it: the Suite's, the core's header button, the Calls tab line. What a person sees.
const pills = () => val(`(() => Array.from(document.querySelectorAll('button')).filter((b) => { const r = b.getBoundingClientRect(); if (r.width < 20 || r.height < 10) return false; const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return top !== null && b.contains(top) && /^\\??\\s*(How it works|Comment ça marche)$/.test(b.innerText.replace(/\\s+/g, ' ').trim()) }).map((b) => { const cs = getComputedStyle(b); const r = b.getBoundingClientRect(); return { h: Math.round(r.height), radius: cs.borderTopLeftRadius, border: cs.borderTopWidth, font: cs.fontSize, cls: b.className.split(' ')[0], kb: b.getAttribute('data-kb') || b.getAttribute('data-act') || '' } }))()`)

try {
  await sleep(3000)

  // ═══ Skills: the first visit ═══
  console.log('\n── Skills: the animation opens the first time ──')
  check('the Skills page opens', (await sidebar('Skills', 'Discover')) === true)
  const sk = await poll(() => hasIntro('kybernos-skills'), 10000)
  check('an animated help is there, on a browser that never saw the page', sk === true)
  check('three steps, each with its sentence', (await val(`${intro('kybernos-skills')} ? ${intro('kybernos-skills')}.querySelectorAll('.kbhi-step').length : 0`)) === 3)
  const txt = await introText('kybernos-skills')
  check('it speaks the page’s own words (Install, Featured, Yours)', /Install/.test(txt) && /Featured/.test(txt) && /Yours/.test(txt), txt)
  await sleep(1500)
  const n = await running('kybernos-skills')
  check('the mock is really animating (12 or more CSS animations running)', n >= 12, n)
  // The steps are sampled on the loop's own clock (the 12 s of the animation), not on the test's: at 2 s, 6 s and 9.5 s of the loop.
  const loopAt = async (from) => { const end = Date.now() + 15000; while (Date.now() < end) { const t = await val(`(() => { const r = ${intro('kybernos-skills')}; const a = r && document.getAnimations().find((x) => x.effect && r.contains(x.effect.target) && x.playState === 'running'); return a ? Math.round(a.currentTime % 12000) : -1 })()`); if (t >= from && t <= from + 700) return t; await sleep(120) } return -1 }
  const marks = []
  for (const at of [1500, 5500, 9000]) { const t = await loopAt(at); marks.push([t, await lit('kybernos-skills')]) }
  check('the steps light up in turn on the loop’s clock (step 1, then 2, then 3)', marks[0][1] === '100' && marks[1][1] === '010' && marks[2][1] === '001', marks)
  await shot('intro-skills')
  const pl = await pills()
  check('one « ? How it works » button on the page', Array.isArray(pl) && pl.length === 1, pl)
  // On screen for more than 8 s: the page counts as seen, and does not come back by itself.
  await sleep(1500)
  check('on screen long enough: marked « seen »', (await store('kybernos-skills')) === 'seen', await store('kybernos-skills'))
  await reload()
  await sidebar('Skills', 'Discover')
  await sleep(1500)
  check('the next visit does not open it again', (await hasIntro('kybernos-skills')) === false)

  // The card: article link, and the animation back.
  console.log('\n── the card brings it back and links to the article ──')
  check('the button opens its card', (await press('[data-kb="help-button"][data-id="kybernos-skills"]')) === true)
  const link = await val(`(() => { const a = document.querySelector('[data-kb="help-panel"] [data-kb="help-link"]'); return a ? { href: a.href, target: a.target, rel: a.rel, text: a.innerText.trim() } : null })()`)
  check('the card ends with a link to the article, in a new tab, with noopener', link !== null && link.href === 'https://help.kybernos.app/en/features/what-are-skills-and-memory/' && link.target === '_blank' && /noopener/.test(link.rel) && /Read the article/.test(link.text), link)
  await shot('card-skills')
  check('and a « Watch the animation » button', (await val(`!!document.querySelector('[data-kb="help-panel"] [data-kb="help-replay"]')`)) === true)
  await press('[data-kb="help-panel"] [data-kb="help-replay"]')
  await sleep(600)
  check('pressing it plays the animation again, and closes the card', (await hasIntro('kybernos-skills')) === true && (await val(`!document.querySelector('[data-kb="help-panel"]')`)) === true)
  await press('[data-kb="help-intro-close"]')
  await sleep(400)
  check('its ✕ closes it and remembers: « closed »', (await hasIntro('kybernos-skills')) === false && (await store('kybernos-skills')) === 'closed')
  await reload()
  await sidebar('Skills', 'Discover')
  await sleep(1500)
  check('closed once: still closed after a reload', (await hasIntro('kybernos-skills')) === false)

  // ═══ Connectors ═══
  console.log('\n── Connectors ──')
  check('the Connectors page opens', (await sidebar('Connectors', 'Discover')) === true)
  check('an animated help opens at the first visit', (await poll(() => hasIntro('kybernos-composio'), 10000)) === true)
  const ct = await introText('kybernos-composio')
  check('with the real words: Add a connection, Connected, Pending', /Add a connection/.test(ct) && /Connected/.test(ct) && /Pending/.test(ct), ct)
  await shot('intro-connectors')
  const cp = await pills()
  check('one « ? How it works » button, the Suite’s, and not the icon-only « ? » it had', Array.isArray(cp) && cp.length === 1 && cp[0].cls === 'kbhp-btn' && (await val(`!document.querySelector('.kb6-helpbtn') && !document.querySelector('.kb7-help')`)) === true, cp)
  await press('[data-kb="help-button"][data-id="kybernos-composio"]')
  const clink = await val(`(() => { const a = document.querySelector('[data-kb="help-panel"] [data-kb="help-link"]'); return a ? a.href : null })()`)
  check('its card links to the article on app connections', clink === 'https://help.kybernos.app/en/features/what-are-app-connections/', clink)
  await press('[data-kb="help-button"][data-id="kybernos-composio"]')
  await press('[data-kb="help-intro-close"]')

  // ═══ one form of the button on every page ═══
  console.log('\n── one « ? How it works » button, the same on every page ──')
  const forms = []
  const looks = async (label, ok, getter) => {
    if (ok !== true) { check(label + ' — the page opens', false); return }
    await sleep(900)
    const p = await getter()
    check(label + ' — exactly one help button, labelled « How it works »', Array.isArray(p) && p.length === 1, p)
    if (Array.isArray(p) && p.length === 1) forms.push(label + ':' + [p[0].h, p[0].radius, p[0].border, p[0].font].join('/'))
  }
  await looks('Agent Teams', await sidebar('Agent Teams'), pills)
  await shot('pill-agent-teams')
  await looks('Automations', await sidebar('Automations'), pills)
  await looks('Skills', await sidebar('Skills'), pills)
  await looks('Connectors', await sidebar('Connectors'), pills)
  await openSettingsDialog()
  await looks('Calls', await goTo('Calls'), async () => { await sleep(500); return pills() })
  await shot('pill-calls')
  await looks('Usage', await goTo('Usage'), pills)
  await looks('Memory & Lessons', await goTo('Memory & Lessons'), pills)
  await looks('Remote Control', await goTo('Remote Control'), pills)
  await looks('Agent presets', await goTo('Agent presets'), pills)
  await looks('Language', await goTo('Language'), pills)
  await looks('Atlas', await goTo('Atlas'), pills)
  // The pages that style every button of their own (« button{font:inherit} »): the pill must not follow them.
  for (const label of ['Commands', 'Workers', 'Theme', 'Web Search', 'Kybernos Suite']) await looks(label, await goTo(label), pills)
  const shapes = new Set(forms.map((f) => f.split(':')[1]))
  check('the same size, round ends, border and font on all of them (' + forms.length + ' pages)', forms.length >= 15 && shapes.size === 1 && [...shapes][0].startsWith('30/16px/1px/12.5px'), forms)

  // ═══ Remote Control ═══
  console.log('\n── Remote Control ──')
  await goTo('Remote Control')
  check('an animated help opens at the first visit', (await poll(() => hasIntro('kybernos-mobile'), 8000)) === true)
  const rt = await introText('kybernos-mobile')
  check('with the words of the screen: the QR, the 4-digit code, Allow', /QR/.test(rt) && /4-digit code/.test(rt) && /Allow/.test(rt), rt)
  await shot('intro-remote-control')
  await press('[data-kb="help-button"][data-id="kybernos-mobile"]')
  const rl = await val(`(() => { const a = document.querySelector('[data-kb="help-panel"] [data-kb="help-link"]'); return a ? a.href : null })()`)
  check('its card links to the Remote Control article', rl === 'https://help.kybernos.app/en/features/what-is-remote-control/', rl)
  await press('[data-kb="help-button"][data-id="kybernos-mobile"]')

  // ═══ Agent presets: a page of DSH itself ═══
  console.log('\n── Agent presets (a page of DSH itself, drawn by no plugin) ──')
  check('the Agent presets page opens', (await goTo('Agent presets')) === true)
  check('the animation opens on it at the first visit', (await poll(() => hasIntro('kybernos-plugin-presets'), 8000)) === true)
  check('it sits right after the page’s introduction, above the cards', (await val(`(() => { const h = document.querySelector('[data-kb="native-intro-host"]'); return !!h && h.previousElementSibling !== null && h.previousElementSibling.tagName === 'P' && /Choose the agent/.test(h.previousElementSibling.innerText) && !!h.nextElementSibling && /Built-in/.test(h.nextElementSibling.innerText) })()`)) === true)
  const pt = await introText('kybernos-plugin-presets')
  check('it explains presets with the page’s own words (Standard mode, PTC, Creator, New task default)', /Know the modes/.test(pt) && /PTC/.test(pt) && /Creator/.test(pt) && /New task default/.test(pt) && /Standard mode/.test(pt), pt)
  check('it is animating', (await running('kybernos-plugin-presets')) >= 12)
  await shot('intro-agent-presets')
  await press('[data-kb="help-button"][data-id="kybernos-plugin"][data-page="presets"]')
  const pc = await val(`(() => { const p = document.querySelector('[data-kb="help-panel"]'); return p ? p.innerText.replace(/\\s+/g, ' ') : '' })()`)
  check('its card is the page’s own (what a preset is), with « Watch the animation » and no link (there is no article yet)', /A preset is a way for the agent to work/.test(pc) && !/Agent Teams/.test(pc) && /Watch the animation/.test(pc) && (await val(`!document.querySelector('[data-kb="help-panel"] [data-kb="help-link"]')`)) === true, pc.slice(0, 200))
  await press('[data-kb="help-button"][data-id="kybernos-plugin"][data-page="presets"]')
  check('the page itself still works: its own button « Let the agent help me create a preset » is there', (await val(`/Let the agent help me create a preset/.test(document.body.innerText)`)) === true)
  await press('[data-kb="help-intro-close"]')
  await sleep(300)
  check('closed once, remembered', (await hasIntro('kybernos-plugin-presets')) === false && (await store('kybernos-plugin-presets')) === 'closed')
  await goTo('Models')
  check('the other DSH pages are left alone (no host, no animation)', (await val(`!document.querySelector('[data-kb="native-intro-host"]') && !document.querySelector('[data-kb="help-intro"]')`)) === true)
  await goTo('General')
  check('…also General', (await val(`!document.querySelector('[data-kb="native-intro-host"]')`)) === true)
  await goTo('Agent presets')
  await sleep(800)
  check('back on Agent presets: still closed, and the page is back as it was', (await hasIntro('kybernos-plugin-presets')) === false && (await val(`!!document.querySelector('[data-kb="native-intro-host"]')`)) === true)
  await press('[data-kb="help-button"][data-id="kybernos-plugin"][data-page="presets"]')
  await press('[data-kb="help-panel"] [data-kb="help-replay"]')
  await sleep(500)
  check('« Watch the animation » brings it back on this page too', (await hasIntro('kybernos-plugin-presets')) === true)
  await press('[data-kb="help-intro-close"]')

  // Reduced motion: no animation at all, and the end of the story is what stays on screen.
  console.log('\n── reduced motion ──')
  // Back on Remote Control, where the animation was seen once: the card plays it again.
  await goTo('Remote Control')
  await sleep(800)
  if ((await hasIntro('kybernos-mobile')) !== true) { await press('[data-kb="help-button"][data-id="kybernos-mobile"]'); await press('[data-kb="help-panel"] [data-kb="help-replay"]'); await sleep(500) }
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await sleep(600)
  const rn = await running('kybernos-mobile')
  const ms = await mockState('kybernos-mobile')
  const rlit = await lit('kybernos-mobile')
  check('nothing moves', rn === 0, rn)
  check('the end of the story shows: the last state, the end label, every step readable', ms !== null && ms.t3 === '1' && ms.t1 === '0' && ms.t2 === '0' && ms.done === '1' && ms.go === '0' && rlit === '111', { ms, rlit })
  await shot('intro-reduced-motion')
  await page.send('Emulation.setEmulatedMedia', { features: [] })
  await sleep(400)

  // ═══ the lines that say what a page is for ═══
  console.log('\n── what each page is for ──')
  await goTo('Usage')
  await sleep(1000)
  const ut = await val(`(() => { const e = document.querySelector('[data-kb="kybernos-usage-page"] .kbus-for'); return e ? e.innerText : null })()`)
  check('Usage says what it covers and how it differs from the console', ut !== null && /every model you use here/.test(ut) && /console/.test(ut) && /per member and per day/.test(ut), ut)
  await shot('usage')
  await goTo('Tools')
  await sleep(1500)
  const tt = await val(`(() => { const e = document.querySelector('.kbt2-entete'); return e ? e.innerText.replace(/\\s+/g, ' ') : null })()`)
  check('Tools says what it adds to a profile and points to Workers', tt !== null && /Tools add abilities to a DSH profile/.test(tt) && /own page, Workers/.test(tt), tt)
  await shot('tools')
  await goTo('Workers')
  await sleep(1500)
  const wt = await val(`document.body.innerText.replace(/\\s+/g, ' ')`)
  check('Workers names Tools as the other door', /Settings › Tools is the other door/.test(wt), wt.slice(0, 200))
  await goTo('Commands')
  await sleep(1500)
  check('Commands: an animated help opens at the first visit, with the page’s words', (await poll(() => hasIntro('kybernos-slash'), 8000)) === true && /Save a prompt/.test(await introText('kybernos-slash')) && /Call it with \//.test(await introText('kybernos-slash')) && /run it on a reply/i.test(await introText('kybernos-slash')))
  await shot('intro-commands')
  const cpills = await pills()
  check('Commands: one « ? How it works » button', Array.isArray(cpills) && cpills.length === 1, cpills)
  const c1 = await val(`(() => { const e = document.querySelector('.kbsl-tabfor'); return e ? e.innerText : null })()`)
  check('Commands: the slash tab says what a slash command is', c1 !== null && /A slash command is a saved prompt/.test(c1), c1)
  await press('.kbsl-tabs button:nth-of-type(2)')
  await sleep(500)
  const c2 = await val(`(() => { const e = document.querySelector('.kbsl-tabfor'); return e ? e.innerText : null })()`)
  check('…and the Message actions tab says what an action is', c2 !== null && /A message action is a button under each assistant reply/.test(c2), c2)
  await shot('commands')

  // ═══ French ═══
  console.log('\n── French ──')
  await val(`window.__kbOrig = window.__KB_LANG_RESOLVE__; window.__kbLang = document.documentElement.lang; window.__KB_LANG_RESOLVE__ = () => 'kybernos'; document.documentElement.lang = 'fr'; localStorage.removeItem('kybernos.help.intro.kybernos-mobile')`)
  await goTo('Usage')
  await goTo('Remote Control')
  await poll(() => hasIntro('kybernos-mobile'), 8000)
  const ft = await introText('kybernos-mobile')
  check('the Remote Control animation speaks French', /Relier un téléphone en trois étapes/.test(ft) && /Affiche le code/.test(ft) && /Autoriser/.test(ft), ft)
  await press('[data-kb="help-button"][data-id="kybernos-mobile"]')
  const fl = await val(`(() => { const a = document.querySelector('[data-kb="help-panel"] [data-kb="help-link"]'); return a ? { href: a.href, text: a.innerText.trim() } : null })()`)
  check('the card’s link says « Lire l’article » and goes to the French article', fl !== null && /Lire l’article/.test(fl.text) && fl.href === 'https://help.kybernos.app/fr/features/what-is-remote-control/', fl)
  await shot('intro-remote-control-fr')
  await val(`window.__KB_LANG_RESOLVE__ = window.__kbOrig; document.documentElement.lang = window.__kbLang`)

} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + e.message)
} finally {
  await live.close()
}
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
