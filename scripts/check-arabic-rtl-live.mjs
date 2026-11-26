#!/usr/bin/env node
// J18-03 (vision): the Arabic (right-to-left) interface of the real DSH GUI, on a sandbox.
//
//   source scripts/sandbox/env.sh && node scripts/check-arabic-rtl-live.mjs [--out <folder>]
//
// What it does, in order:
//   1. starts a scripted stand-in model on 127.0.0.1:${KB_STANDIN_PORT:-3252} (an OpenAI-compatible
//      chat server; the sandbox's local provider must point at it, see the run's notes). No real model.
//   2. adds Arabic with the stubbed translator (scripts/lib-language-flow.mjs), so the page is drawn
//      right to left. The UI strings come back as ⟦English⟧ marks: direction and widths are real, the words are not Arabic.
//   3. sends a mixed message (Arabic, English, numbers) and gets a reply with a code block.
//   4. pictures eight screens and measures each one (direction, sidebar side, icon mirroring, rectangles past
//      the window edge, clipped text, controls under 32 px). Pictures and measures go to --out.
//   5. puts English back in a finally.
//
// Exit: 0 when the run completed (findings are reported, not judged here), 1 when a screen could not be reached,
// 3 inconclusive (wrong environment, no sandbox).
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { openLivePage, openSettings, goToSettingsPage } from './live-page.mjs'
import { createFlow, assertEnglishStored } from './lib-language-flow.mjs'

const args = process.argv.slice(2)
const outDir = args.indexOf('--out') >= 0 ? args[args.indexOf('--out') + 1] : join(homedir(), 'kybernos-archive', 'user-journey-2026-11-04', 'ev', 'r5-agents', 'vision-ui', 'j18-03-arabic')
mkdirSync(outDir, { recursive: true })
const host = process.env.KB_HOST || ''
if (host === '' || /:3080$/.test(host)) { console.error('○ inconclusive: KB_HOST must be a sandbox (not :3080)'); process.exit(3) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 1. the scripted stand-in model ───────────────────────────────────────────
const STANDIN_PORT = Number(process.env.KB_STANDIN_PORT || 3252)
const REPLY = [
  'مرحبا بك في Kybernos. هذا مثال على الكود:\n\n',
  '```js\nconst total = items.reduce((sum, x) => sum + x.price, 0) // 1,250 USD\nconsole.log("Q4 =", total, "2026-11-04")\n```\n\n',
  'الميزانية 1,250 دولار في Q4، و 3 مشاريع نشطة (15% أكثر من الربع الماضي) مع API v2.',
].join('')
const standin = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    if (req.method === 'GET' && req.url.startsWith('/v1/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ object: 'list', data: [{ id: 'qwen3.5:9b', object: 'model' }] })); return }
    if (req.method === 'POST' && req.url.startsWith('/v1/chat/completions')) {
      let stream = false
      try { stream = JSON.parse(body).stream === true } catch (e) { /* not JSON */ }
      const id = 'chatcmpl-standin'
      if (!stream) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id, object: 'chat.completion', created: 0, model: 'qwen3.5:9b', choices: [{ index: 0, message: { role: 'assistant', content: REPLY }, finish_reason: 'stop' }] })); return }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      const chunk = (delta, finish) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 0, model: 'qwen3.5:9b', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
      res.write(chunk({ role: 'assistant', content: '' }, null))
      for (let i = 0; i < REPLY.length; i += 12) res.write(chunk({ content: REPLY.slice(i, i + 12) }, null))
      res.write(chunk({}, 'stop'))
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}')
  })
})
await new Promise((r, j) => { standin.once('error', j); standin.listen(STANDIN_PORT, '127.0.0.1', r) })

// ── measures, read in the page ─────────────────────────────────────────────
const MEASURE_JS = `(() => {
  const W = innerWidth
  const norm = (s) => (s || '').replace(/[⟦⟧]/g, '').replace(/\\s+/g, ' ').trim()
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
  const R = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }
  const out = { dir: document.documentElement.dir, lang: document.documentElement.lang, win: [innerWidth, innerHeight], hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth }
  // the sidebar: the column that holds the « New chat » button
  const nc = [...document.querySelectorAll('button,a,[role=button]')].find((b) => vis(b) && norm(b.innerText) === 'New chat')
  if (nc) {
    let col = nc
    while (col.parentElement && col.parentElement !== document.body && col.parentElement.getBoundingClientRect().width < 360) col = col.parentElement
    const r = col.getBoundingClientRect()
    out.sidebar = { rect: R(col), dir: getComputedStyle(col).direction, side: r.left + r.width / 2 > W / 2 ? 'right' : 'left' }
  } else out.sidebar = null
  // icons: label, mirrored or not (a negative x scale on the icon or one of its three ancestors)
  out.icons = []
  for (const s of document.querySelectorAll('svg')) {
    if (!vis(s)) continue
    const host = s.closest('button,a,[role=button],[role=menuitem],[role=switch]') || s.parentElement
    const label = norm(host.getAttribute('aria-label') || host.getAttribute('title') || host.innerText || '').slice(0, 40)
    let flip = false; let e = s; let depth = 0; let tf = 'none'
    while (e && depth < 4) { const t = getComputedStyle(e).transform; if (t && t !== 'none') { tf = t; const m = /matrix\\(([^,]+)/.exec(t); if (m && parseFloat(m[1]) < 0) flip = true }; e = e.parentElement; depth++ }
    const r = s.getBoundingClientRect()
    out.icons.push({ label, cls: String(s.getAttribute('class') || '').slice(0, 40), rect: R(s), flip, transform: tf.slice(0, 60), inRtl: document.documentElement.dir === 'rtl' })
  }
  // text that leaves the window or its box
  out.pastEdge = []
  out.clipped = []
  for (const e of document.querySelectorAll('body *')) {
    if (!vis(e) || e.children.length > 0) continue
    const t = (e.innerText || '').trim(); if (!t) continue
    const r = e.getBoundingClientRect()
    if (r.right > W + 1 || r.left < -1) out.pastEdge.push({ text: t.slice(0, 40), rect: R(e) })
    if (e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow !== 'visible') out.clipped.push({ text: t.slice(0, 40), rect: R(e), scrollW: e.scrollWidth, clientW: e.clientWidth })
  }
  out.pastEdge = out.pastEdge.slice(0, 30); out.clipped = out.clipped.slice(0, 30)
  // controls under 32 px
  const small = [...document.querySelectorAll('button,a,[role=button],[role=switch],input,[role=menuitem]')].filter((e) => vis(e) && (e.getBoundingClientRect().height < 32 || e.getBoundingClientRect().width < 32))
  out.smallControls = { count: small.length, sample: small.slice(0, 12).map((e) => ({ label: norm(e.getAttribute('aria-label') || e.innerText).slice(0, 30), rect: R(e) })) }
  // the composer and the code blocks: direction as the browser computes it
  const comp = document.querySelector('[role=textbox], textarea, [contenteditable]')
  out.composer = comp ? { dir: getComputedStyle(comp).direction, align: getComputedStyle(comp).textAlign, rect: R(comp), placeholder: (comp.getAttribute('placeholder') || comp.getAttribute('aria-placeholder') || comp.getAttribute('data-placeholder') || '').slice(0, 40) } : null
  out.codeBlocks = [...document.querySelectorAll('pre, code')].filter(vis).slice(0, 6).map((e) => ({ tag: e.tagName, dir: getComputedStyle(e).direction, align: getComputedStyle(e).textAlign, rect: R(e), text: (e.innerText || '').slice(0, 30) }))
  out.mixedParagraphs = [...document.querySelectorAll('p, li, div')].filter((e) => vis(e) && e.children.length === 0 && /Kybernos|API|Q4|1,250/.test(e.innerText || '')).slice(0, 6).map((e) => ({ dir: getComputedStyle(e).direction, align: getComputedStyle(e).textAlign, rect: R(e), text: (e.innerText || '').slice(0, 60) }))
  out.timeLabels = [...document.querySelectorAll('span,div,time')].filter((e) => vis(e) && e.children.length === 0 && /^(now|\\d+\\s?(min|h|d|s))$/i.test((e.innerText || '').trim())).slice(0, 8).map((e) => ({ text: e.innerText.trim(), rect: R(e) }))
  out.arrowGlyphs = [...document.querySelectorAll("body *")].filter((e) => vis(e) && e.children.length === 0 && /[←→‹›«»]/.test(e.innerText || "")).slice(0, 12).map((e) => ({ text: e.innerText.trim().slice(0, 40), rect: R(e) }))
  out.brand = [...document.querySelectorAll("body *")].filter((e) => vis(e) && e.children.length === 0 && /ybernos/.test(e.innerText || "")).slice(0, 3).map((e) => ({ text: e.innerText.trim().slice(0, 20), rect: R(e) }))
  out.consoleBidi = document.body.innerText.length
  return JSON.stringify(out)
})()`

const SWITCHES_JS = `(() => {
  const norm = (s) => (s || '').replace(/[⟦⟧]/g, '').replace(/\\s+/g, ' ').trim()
  const sw = [...document.querySelectorAll('[role=switch], input[type=checkbox]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
  return JSON.stringify(sw.slice(0, 12).map((e) => {
    const row = e.closest('label, li, div[class*="row"], div[class*="Row"], div') || e.parentElement
    const r = e.getBoundingClientRect()
    const cs = getComputedStyle(e)
    return { checked: e.getAttribute('aria-checked') || String(e.checked || ''), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], rowText: norm(row ? row.innerText : '').slice(0, 50), rowDir: row ? getComputedStyle(row).direction : null, transform: cs.transform, flipped: /matrix\\(-/.test(cs.transform) }
  }))
})()`

// ── helpers for the page ─────────────────────────────────────────────────────
const shotClip = async (page, file, clip) => {
  const r = await page.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } })
  if (!(r.result && r.result.data)) throw new Error('no clip picture for ' + file)
  writeFileSync(file, Buffer.from(r.result.data, 'base64'))
}
const press = async (page, x, y) => { for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }) }
const centreOf = async (page, name, scopeMaxY = 1e9) => {
  const r = await page.evalJs(`(() => { const want = ${JSON.stringify(name)}; const norm = (s) => (s || '').replace(/[⟦⟧]/g, '').replace(/\\s+/g, ' ').trim(); const cand = [...document.querySelectorAll('button,a,[role=button],[role=menuitem],[role=tab]')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < ${scopeMaxY} && (norm(b.innerText) === want || norm(b.getAttribute('aria-label')) === want) }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top); const b = cand[0]; if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`, 6000)
  return r.val === undefined ? null : r.val
}
const clickNamed = async (page, name, scopeMaxY) => { const c = await centreOf(page, name, scopeMaxY); if (c === null) return false; await press(page, c.x, c.y); await sleep(900); return true }
const measure = async (page) => JSON.parse((await page.evalJs(MEASURE_JS, 15000)).val)

// ── the run ──────────────────────────────────────────────────────────────────
const findings = { run: 'J18-03', standinPort: STANDIN_PORT, host, screens: [] }
let flow = null
let live = null
const shoot = async (name) => { await live.page.shot(join(outDir, name + '.png')) }
const record = async (name, note) => {
  const m = await measure(live.page)
  findings.screens.push({ screen: name, note, measure: m })
  writeFileSync(join(outDir, 'measures.json'), JSON.stringify(findings, null, 2))
  console.log('  · ' + name + ' dir=' + m.dir + ' sidebar=' + (m.sidebar ? m.sidebar.side + ' ' + JSON.stringify(m.sidebar.rect) : 'none') + ' flipped=' + m.icons.filter((i) => i.flip).length + '/' + m.icons.length + ' pastEdge=' + m.pastEdge.length + ' clipped=' + m.clipped.length + ' small=' + m.smallControls.count + ' hscroll=' + m.hscroll)
}

let exitCode = 0
try {
  assertEnglishStored()
  live = await openLivePage({ width: 1440, height: 900 })
  flow = await createFlow(live.page)
  await flow.installStub()
  console.log('adding Arabic (stubbed translation) …')
  await flow.pseudoLanguage('ar')
  await sleep(2500)

  // S1: new chat
  await clickNamed(live.page, '⟦New chat⟧') || await clickNamed(live.page, 'New chat')
  await sleep(1200)
  await shoot('01-new-chat')
  await record('01-new-chat', 'new chat, Arabic, before any message')

  // S2: a mixed message, the reply with a code block
  const focus = await live.page.evalJs(`(() => { const t = document.querySelector('[role=textbox], textarea, [contenteditable]'); if (!t) return false; t.focus(); return true })()`, 6000)
  if (focus.val !== true) throw new Error('no composer on the new chat page')
  await live.page.send('Input.insertText', { text: 'مرحبا، اعرض لي مثال الكود مع Kybernos و 1,250 USD' })
  await sleep(300)
  for (const t of ['keyDown', 'keyUp']) await live.page.send('Input.dispatchKeyEvent', { type: t, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  let done = false
  for (let i = 0; i < 40 && !done; i++) { await sleep(500); done = (await live.page.evalJs(`document.body.innerText.includes('API v2')`, 4000)).val === true }
  await sleep(1500)
  if (!done) console.log('  ! the reply did not finish in 20 s (see the picture)')
  await shoot('02-chat-code-block')
  await record('02-chat-code-block', 'chat with a code block, a mixed Arabic/English/number reply and the user message')

  // S3: the sidebar, as a clip of the left-most 320 px
  await shotClip(live.page, join(outDir, '03-sidebar-clip.png'), { x: 0, y: 0, width: 320, height: 900 })
  await record('03-sidebar', 'sidebar opened on the chat page (clip of the left 320 px in the picture)')

  // S4: Settings home
  const opened = await openSettings(live.page, { tries: 3 })
  await sleep(900)
  await shoot('04-settings-home')
  await record('04-settings-home', 'Settings dialog home (opened=' + opened + ')')

  // S5: a Settings page with switches (first of General, Tools, Usage, Learned skills that has a switch)
  let switchPage = null
  for (const label of [/Automations/, /General/, /Usage/]) {
    if (await goToSettingsPage(live.page, label, { tries: 2, settleMs: 900 })) {
      const sw = JSON.parse((await live.page.evalJs(SWITCHES_JS, 6000)).val || '[]')
      if (sw.length > 0) { switchPage = label.source; findings.switches = sw; break }
    }
  }
  await sleep(500)
  await shoot('05-settings-switches')
  await record('05-settings-switches', 'Settings page with switches: ' + (switchPage || 'none found') + '; switches in findings.switches')

  // S6-S8: Creations, Automations, the account menu (close the dialog first)
  await live.page.evalJs(`(() => { const b = [...document.querySelectorAll('button,a,[role=button]')].find((x) => /Retour au workspace|Back to workspace/.test(x.innerText || '')); if (b) b.click() })()`, 4000)
  await sleep(1200)
  await clickNamed(live.page, 'Créations', 600) || await clickNamed(live.page, '⟦Creations⟧', 600) || await clickNamed(live.page, 'Creations', 600)
  await sleep(1400)
  await shoot('06-creations')
  await record('06-creations', 'Creations page')

  await clickNamed(live.page, '⟦Automations⟧', 300) || await clickNamed(live.page, 'Automations', 300)
  await sleep(1400)
  await shoot('07-automations-list')
  await record('07-automations-list', 'Automations list')

  const acct = await live.page.evalJs(`(() => { const nc = [...document.querySelectorAll('button,a,[role=button]')].find((b) => /New chat/.test((b.innerText || ''))); if (!nc) return null; let col = nc; while (col.parentElement && col.parentElement !== document.body && col.parentElement.getBoundingClientRect().width < 360) col = col.parentElement; const cr = col.getBoundingClientRect(); const b = [...col.querySelectorAll('button')].filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.top > innerHeight - 90 && r.left >= cr.left - 1 }).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).pop() || null; if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`, 6000)
  if (acct.val) await press(live.page, acct.val.x, acct.val.y)
  await sleep(1200)
  await shoot('08-account-menu')
  await record('08-account-menu', 'account menu opened from the sidebar footer')
} catch (e) {
  console.error('✗ ' + e.message)
  exitCode = 1
} finally {
  try { if (flow) await flow.restoreEnglish() } catch (e) { console.error('  ! restoring English failed: ' + e.message) }
  try { if (live) await live.close() } catch (e) { /* gone */ }
  standin.close()
  writeFileSync(join(outDir, 'measures.json'), JSON.stringify(findings, null, 2))
}
process.exit(exitCode)
