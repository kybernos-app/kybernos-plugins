#!/usr/bin/env node
// The actions under the agent's answers, shown by a TAP on the phone (the locked Simple preset's `messageActions: 'tap'`), in a real GUI at the owner's phone conditions
// (406 px wide, device pixel ratio 3, the exact user agent of the Kybernos app) with a stub model for the answers.
//
//   source scripts/sandbox/env.sh && node scripts/check-message-actions-live.mjs --out <evidence dir>
//
// What it plays, on an isolated DSH (the sandbox; it refuses :3080 and any DSH home that is not a sandbox's):
//   A  the full app on a desktop (no Kaby token): nothing of the tap mode is there (no mark, no stylesheet), the row under the last answer is drawn as ever.
//   B  the phone: by default no row is drawn under any answer or user message (`data-clock="start"` is hidden until tapped); a tap on the text of an answer shows ITS row, with every button a
//      44 px zone (including the two thumbs; the five stars stay hidden in Simple); a second tap hides it; a tap on the person's own message hides the answer row and reveals the message's own row; a tap elsewhere hides it; one row at a time; a tap on a link, on the copy of a code block, on a selected text, a long
//      press and a drag do not toggle; the row grows over several frames (not in one); with « reduce motion » there is no transition; read after scrolling up, the text of the tapped
//      answer does not move (at the very bottom the engine keeps the chat glued to its end, so the text rises by the row's height: measured and reported, not hidden).
//   C  an answer still being written has no row to show: a tap on it shows nothing, and once finished its row comes out hidden and a tap shows it.
//   D  (list item 31) the row an answer shows carries Cite (a tap puts the answer, quoted, in the composer); the row of the person's own message carries Edit (a tap puts its text back in the composer as a draft; nothing is sent).
// It adds a stub model to the sandbox profile (a backup is put back) and restarts the sandbox once. Nothing leaves the machine.
// Exit code 0: every check passed (what it could not see is under « not seen » in the report), 1: a check failed, 3: it cannot start.
// 406 px screenshots go to <out>/shots: they are meant to be LOOKED at, not only counted.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openGui, sleep } from './lib-e2e-gui.mjs'

const args = process.argv.slice(2)
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : null
if (OUT === null) { console.error('usage: --out <evidence dir>'); process.exit(3) }
mkdirSync(join(OUT, 'shots'), { recursive: true })
const here = dirname(fileURLToPath(import.meta.url))
const host = process.env.KB_HOST || '127.0.0.1:3080'
const home = process.env.DSH_HOME || ''
if (/:3080$/.test(host) || !home.includes('.kybernos-sandbox')) { console.error('○ inconclusive: needs a sandbox DSH (source scripts/sandbox/env.sh), not :3080.'); process.exit(3) }

const OWNER_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 KybernosHost/0.1.0 (android) KabyMode/1 KybernosCaps/where,account,plans,referral,signout KybernosPlace/local'
const SHELL_JS = 'window.__kbOut = []; window.ReactNativeWebView = { postMessage: function (s) { try { window.__kbOut.push(String(s)) } catch (e) {} } }; (function(){ var f = function(){ if (document.documentElement) document.documentElement.classList.add("kb-native-insets") }; f(); document.addEventListener("DOMContentLoaded", f) })();'

const report = { when: new Date().toISOString(), host, steps: [], notSeen: [], measured: {} }
let failed = 0
const check = (name, ok, detail) => {
  report.steps.push({ name, ok: !!ok, detail: ok || detail === undefined ? undefined : detail })
  if (!ok) failed += 1
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (!ok && detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 700) : ''))
}
const notSeen = (what) => { report.notSeen.push(what); console.log('  ○ not seen: ' + what) }

// ── the stub model: [K1] a short answer, [K2] several paragraphs with a link and a code block, [K9] an answer written word by word for ~13 s ───────────────
const LONG = 'Here is a longer answer so that the phone has something to read.\n\nA second paragraph with a [link to the docs](https://example.test/docs) and some `inline code`, long enough to wrap on a phone: Kaby would help you with your day, your mail and your files.\n\n```\nnpm run build\n```\n\nA last paragraph, a little shorter than the others.'
const textOf = (m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
const sse = (res, delta, finish) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const base = { id: 'chatcmpl-stub', object: 'chat.completion.chunk', created: 1, model: 'stub-1' }
  res.write('data: ' + JSON.stringify(Object.assign({}, base, { choices: [{ index: 0, delta, finish_reason: null }] })) + '\n\n')
  res.write('data: ' + JSON.stringify(Object.assign({}, base, { choices: [{ index: 0, delta: {}, finish_reason: finish }] })) + '\n\n')
  res.end('data: [DONE]\n\n')
}
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (d) => { body += d })
  req.on('end', () => {
    let j = {}
    try { j = JSON.parse(body) } catch (e) { j = {} }
    if (String(req.url).indexOf('/chat/completions') < 0) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'kbstub/stub-1', object: 'model' }] })); return }
    if (!Array.isArray(j.tools) || j.tools.length === 0) { sse(res, { role: 'assistant', content: 'Stub' }, 'stop'); return }
    const msgs = Array.isArray(j.messages) ? j.messages : []
    let marker = null
    for (let i = msgs.length - 1; i >= 0; i -= 1) { if (msgs[i].role === 'user' && /\[(K[1-9])\]/.test(textOf(msgs[i]))) { marker = (textOf(msgs[i]).match(/\[(K[1-9])\]/) || [])[1]; break } }
    if (marker === 'K9') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const base = { id: 'chatcmpl-stub', object: 'chat.completion.chunk', created: 1, model: 'stub-1' }
      const words = 'This answer is still being written, word after word, so that the phone can show a message that has not finished yet.'.split(' ')
      let i = 0
      const t = setInterval(() => {
        if (i >= words.length || res.writableEnded) { clearInterval(t); if (!res.writableEnded) { res.write('data: ' + JSON.stringify(Object.assign({}, base, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })) + '\n\n'); res.end('data: [DONE]\n\n') } return }
        res.write('data: ' + JSON.stringify(Object.assign({}, base, { choices: [{ index: 0, delta: i === 0 ? { role: 'assistant', content: words[i] } : { content: ' ' + words[i] }, finish_reason: null }] })) + '\n\n')
        i += 1
      }, 700)
      res.on('close', () => clearInterval(t))
      return
    }
    if (marker === 'K2') { sse(res, { role: 'assistant', content: LONG }, 'stop'); return }
    sse(res, { role: 'assistant', content: 'Hello. This is a stub answer, long enough to wrap on a phone: Kaby would help you with your day, your mail and your files.' }, 'stop')
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const stubPort = server.address().port

const profile = join(home, 'profiles', 'web', 'cordis.patch.yml')
const backup = profile + '.bak-msg-actions'
const anchor = '- id: llm-pi-ai\n  config:\n    providers:\n'
const patch = existsSync(profile) ? readFileSync(profile, 'utf8') : ''
if (patch.indexOf(anchor) < 0) { console.error('○ inconclusive: the sandbox profile has no llm-pi-ai providers block to add the stub model to'); process.exit(3) }
const sandbox = (script, extraEnv) => spawnSync('bash', [join(here, 'sandbox', script)], { env: Object.assign({}, process.env, { KB_SANDBOX_TTL: '10800' }, extraEnv || {}), encoding: 'utf8', timeout: 240000 })
const restart = (extraEnv) => { sandbox('stop.sh'); return sandbox('start.sh', extraEnv).status === 0 }
const provider = '      kbstub:\n        api: openai-completions\n        baseURL: http://127.0.0.1:' + stubPort + '/v1\n        apiKeyEnv: KB_STUB_KEY\n        models:\n          - id: kbstub/stub-1\n            name: Stub\n'

// ── the page ───────────────────────────────────────────────────────────────────────────────────────────────────
let g = null
const shot = async (name) => { try { await g.shot(join(OUT, 'shots', name + '.png')) } catch (e) { /* no shot */ } }
const val = (js) => g.val(js)
const cdp = (m, p) => g.page.send(m, p)
const phone = async () => {
  await cdp('Emulation.setDeviceMetricsOverride', { width: 406, height: 880, deviceScaleFactor: 3, mobile: true })
  await cdp('Emulation.setUserAgentOverride', { userAgent: OWNER_UA, platform: 'Linux armv8l' })
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: SHELL_JS })
  await g.val('window.__kbStale = true')
  await cdp('Page.reload', { ignoreCache: true })
  await g.waitFor("window.__kbStale === undefined && document.readyState === 'complete'", 30000)
  await sleep(3500)
}
// a finger: down, (move,) hold, up: Chrome turns it into the click the page listens to
const finger = async (x, y, { hold = 0, to = null } = {}) => {
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  if (to !== null) { for (let i = 1; i <= 4; i += 1) { await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + ((to.x - x) * i) / 4, y: y + ((to.y - y) * i) / 4 }] }); await sleep(30) } }
  if (hold > 0) await sleep(hold)
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(450)
  if (process.env.KB_DEBUG) console.log('      finger', x, y, hold, to, '→ drawer left', await val(`(() => { const e = document.querySelector('[data-slot="sidebar"]'); return e ? Math.round(e.getBoundingClientRect().left) : 'none' })()`), 'open', await val(`document.querySelectorAll('[data-kb-reveal]').length`))
}
const SCROLLER = `(() => { let e = document.querySelector('[data-chat-flow]'); while (e && e !== document.body) { const o = getComputedStyle(e); if (/(auto|scroll)/.test(o.overflowY) && e.scrollHeight > e.clientHeight) return e; e = e.parentElement } return null })()`
const ANSWERS = `[...document.querySelectorAll('[data-chat-flow-kind="assistant-step"]')]`
const ROWS = `[...document.querySelectorAll('[data-turn-tail]')].filter((t) => t.querySelector(':scope > [data-clock="end"]'))`
// where to put the finger on an answer: the middle of the first line of its first paragraph (n = index from the end, 0 = the last answer)
const textPoint = (n = 0, kind = 'p') => val(`(() => { const a = ${ANSWERS}; const el = a[a.length - 1 - ${n}]; if (!el) return null; const p = el.querySelector(${JSON.stringify(kind)}) || el; const b = p.getBoundingClientRect(); return { x: Math.round(b.left + 40), y: Math.round(b.top + 10), top: Math.round(b.top), turn: el.getAttribute('data-chat-turn') } })()`)
const rowsInfo = () => val(`JSON.stringify(${ROWS}.map((t) => { const b = t.getBoundingClientRect(); const cs = getComputedStyle(t); const flow = t.closest('[data-chat-flow-kind="turn-tail"]'); return { turn: flow && flow.getAttribute('data-chat-turn'), reveal: flow && flow.getAttribute('data-kb-reveal'), h: Math.round(b.height), vis: cs.visibility, op: cs.opacity } }))`).then((s) => JSON.parse(s))
const open = async () => (await rowsInfo()).filter((r) => r.reveal === '1')
const answerCount = () => val(`${ANSWERS}.length`)
// the chat of a sandbox is kept from one run to the next: a wait is on the NUMBER of answers, never on a text an older run left
const sendAndWait = async (message, until = /./) => {
  const n = Number(await answerCount())
  await g.send(message)
  await g.until(async () => (Number(await answerCount()) > n && until.test(String(await val(`(() => { const a = ${ANSWERS}; return a[a.length - 1].innerText })()`))) ? true : null), 60000, 300)
}
const revealCount = () => val(`document.querySelectorAll('[data-kb-reveal]').length`)

try {
  const clean = patch.replace(/ {6}kbstub:\n(?: {8,}.*\n)+/, '')
  writeFileSync(backup, clean)
  writeFileSync(profile, clean.replace(anchor, anchor + provider))
  console.log('\n── set up: a stub model, one answer on the desktop ──')
  check('the sandbox restarts with a stub model', restart({ KB_STUB_KEY: 'stub' }) === true)
  g = await openGui(host, { width: 1500, height: 950 })
  await g.reload()
  await g.selectModel('Stub')
  await sendAndWait('[K1] hello', /stub answer/)
  await sleep(2000)

  console.log('\n── A  the full app on a desktop: nothing of the tap mode ──')
  check('no mark on <html>, no tap stylesheet', (await val(`document.documentElement.getAttribute('data-kb-msg-actions') === null && !document.querySelector('style[data-kybernos="kb-actions-tap"]')`)) === true)
  const deskRows = await rowsInfo()
  check('the row under the last answer is drawn as ever', deskRows.length >= 1 && deskRows[deskRows.length - 1].h > 0 && deskRows[deskRows.length - 1].vis === 'visible', deskRows)

  console.log('\n── B  the phone: 406 px, ratio 3, the exact user agent ──')
  await phone()
  await sendAndWait('[K1] hello', /stub answer/)
  await sendAndWait('[K2] a longer one', /A last paragraph/)
  await sleep(2500)
  const facts = JSON.parse(await val(`JSON.stringify({ w: innerWidth, dpr: devicePixelRatio, kaby: document.documentElement.classList.contains('kb-kaby'), attr: document.documentElement.getAttribute('data-kb-msg-actions'), style: !!document.querySelector('style[data-kybernos="kb-actions-tap"]') })`))
  check('the page is the owner\'s phone (406 px, ratio 3, Kaby mode) and the tap mode is on', facts.w === 406 && facts.dpr === 3 && facts.kaby === true && facts.attr === 'tap' && facts.style === true, facts)
  let rows = await rowsInfo()
  check('by default no row is drawn under any answer (height 0, hidden)', rows.length >= 2 && rows.every((r) => r.h === 0 && r.vis === 'hidden' && r.reveal === null), rows)
  const userRows = JSON.parse(await val(`JSON.stringify([...document.querySelectorAll('[data-clock="start"]')].map((e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { h: Math.round(b.height), vis: cs.visibility } }))`))
  check('by default the person\'s own rows (`data-clock="start"`) are hidden too (height 0, hidden)', userRows.length >= 2 && userRows.every((r) => r.h === 0 && r.vis === 'hidden'), userRows)
  await shot('01-default')

  // a tap on the last answer: its row comes in, over several frames
  const tapLast = await textPoint(0)
  await val(`window.__rec = []; (() => { const t0 = performance.now(); const sc = ${SCROLLER}; const f = () => { const r = ${ROWS}; const row = r[r.length - 1]; const a = ${ANSWERS}; const p = a[a.length - 1].querySelector('p'); window.__rec.push([Math.round(performance.now() - t0), Math.round(row.getBoundingClientRect().height), Math.round(p.getBoundingClientRect().top), sc ? Math.round(sc.scrollTop) : -1]); if (performance.now() - t0 < 900) requestAnimationFrame(f) }; requestAnimationFrame(f) })()`)
  await finger(tapLast.x, tapLast.y)
  await sleep(700)
  const rec = JSON.parse(await val('JSON.stringify(window.__rec)'))
  rows = await rowsInfo()
  const lastRow = rows[rows.length - 1]
  check('a tap on the last answer shows ITS row and no other', (await revealCount()) === 1 && lastRow.reveal === '1' && lastRow.vis === 'visible' && lastRow.h >= 44, rows)
  const growth = rec.map((r) => r[1])
  check('the row grows over several frames, not in one (at least 2 steps between 0 and its height)', growth.filter((h) => h > 0 && h < Math.max(...growth)).length >= 2, growth.slice(0, 30))
  const bottomShift = rec[0][2] - rec[rec.length - 1][2]
  report.measured.atBottom = { rowHeight: lastRow.h, textRose: bottomShift, scrollTopMoved: rec[rec.length - 1][3] - rec[0][3] }
  check('at the very bottom the chat stays glued to its end: the answer rises by exactly the height of the row (nothing else moves)', bottomShift === lastRow.h, report.measured.atBottom)
  await shot('02-last-open')
  const btn = JSON.parse(await val(`JSON.stringify((() => { const r = ${ROWS}; const row = r[r.length - 1]; const flow = row.closest('[data-chat-flow-kind="turn-tail"]'); return [...flow.querySelectorAll('button')].filter((b) => { const bb = b.getBoundingClientRect(); return bb.width > 0 && bb.height > 0 && getComputedStyle(b).visibility === 'visible' }).map((b) => { const bb = b.getBoundingClientRect(); return { l: (b.getAttribute('aria-label') || b.className || '').toString().slice(0, 24), w: Math.round(bb.width * 10) / 10, h: Math.round(bb.height * 10) / 10, x1: Math.round(bb.right), x0: Math.round(bb.left), star: b.classList.contains('kbq-rating-etoile'), thumb: b.classList.contains('kbq-rating-pouce') } }) })())`))
  const nonThumb = btn.filter((b) => !b.thumb)
  const thumbs = btn.filter((b) => b.thumb)
  const stars = btn.filter((b) => b.star)
  check('every button of the open row (copy, read aloud, cite, thumbs, branch, report flag) is a 44 px zone', btn.length >= 4 && btn.every((b) => b.w >= 43.5 && b.h >= 43.5), btn)
  check('in Simple the rating uses two 44 px thumbs rather than the five stars', thumbs.length === 2 && thumbs.every((b) => b.w >= 43.5 && b.h >= 43.5) && stars.length === 0, { thumbs, stars })
  check('the row is ONE line of 44 px that fits the page (no button outside 0..406)', lastRow.h <= 48 && btn.every((b) => b.x0 >= 0 && b.x1 <= 406), { h: lastRow.h, btn })
  const flag = nonThumb.find((b) => /report/i.test(b.l))
  check('« Report » (the flag) is in the row, the last thing on its line', flag !== undefined && flag.x1 >= 360 && btn.every((b) => b.x1 <= flag.x1), btn)

  // a second tap hides it
  await finger(tapLast.x, tapLast.y - bottomShift)
  rows = await rowsInfo()
  check('a second tap on the same answer hides its row', (await revealCount()) === 0 && rows.every((r) => r.h === 0), rows)

  // one at a time, tap elsewhere
  await finger(tapLast.x, tapLast.y)
  const before = await textPoint(1)
  await finger(before.x, before.y)
  const o2 = await open()
  check('a tap on another answer opens that one and closes the first (one row at a time)', (await revealCount()) === 1 && o2.length === 1, o2)
  const userPoint = async (openOnly) => JSON.parse(await val(`JSON.stringify((() => { const all = [...document.querySelectorAll('[data-chat-flow-kind="user"]')]; const u = ${openOnly === true} ? all.find((e) => e.getAttribute('data-kb-reveal') === '1') : all.filter((e) => { const b = e.getBoundingClientRect(); return b.top > 60 && b.bottom < innerHeight - 200 }).pop(); if (!u) return null; const t = [...u.querySelectorAll('span, p')].find((x) => { const b = x.getBoundingClientRect(); return b.width > 0 && b.height > 0 && x.children.length === 0 && x.textContent.length > 3 }); if (!t) return null; const b = t.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) } })())`))
  const user = await userPoint(false)
  if (user === null) notSeen('a tap on the person\'s own message (none on screen)')
  else {
    await finger(user.x, user.y)
    const userReveal = JSON.parse(await val(`JSON.stringify((() => { const u = document.querySelector('[data-chat-flow-kind="user"][data-kb-reveal="1"]'); const r = u ? u.querySelector('[data-clock="start"]') : null; const b = r ? r.getBoundingClientRect() : null; return { openAnswers: document.querySelectorAll('[data-chat-flow-kind="turn-tail"][data-kb-reveal="1"]').length, userOpen: !!u, h: b ? Math.round(b.height) : 0, vis: r ? getComputedStyle(r).visibility : null } })())`))
    check('a tap on the person\'s own message closes the answer row and reveals its own row', userReveal.openAnswers === 0 && userReveal.userOpen === true && userReveal.h > 0 && userReveal.vis === 'visible', userReveal)
    // Opening the row can move the text: read the open message's fresh centre instead of tapping its old coordinates.
    const userAgain = await userPoint(true)
    if (userAgain !== null) await finger(userAgain.x, userAgain.y)
    const userClosed = JSON.parse(await val(`JSON.stringify({ user: document.querySelectorAll('[data-chat-flow-kind="user"][data-kb-reveal]').length, answers: document.querySelectorAll('[data-chat-flow-kind="turn-tail"][data-kb-reveal]').length })`))
    check('(and a second tap on the person\'s own message hides its row)', userAgain !== null && userClosed.user === 0 && userClosed.answers === 0, userClosed)
  }

  // taps that are not for the answer
  const checkAnswerLink = async () => {
    await val(`window.__clicked = []; document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a'); if (a) { window.__clicked.push(a.getAttribute('href')); e.preventDefault() } }, true)`)
    await val(`document.querySelectorAll('[data-chat-flow-kind="assistant-step"] a').forEach((l) => { l.setAttribute('href', '#kb-link-test'); l.addEventListener('click', (e) => e.preventDefault(), { capture: true }) })`)
    await val(`(() => { const a = ${ANSWERS}; const el = a[a.length - 1]; const l = [...el.querySelectorAll('a')].find((x) => { const b = x.getBoundingClientRect(); return b.width > 0 && b.height > 0 }); if (l) l.scrollIntoView({ block: 'center', behavior: 'instant' }) })()`)
    await sleep(300)
    const link = JSON.parse(await val(`JSON.stringify((() => { const a = ${ANSWERS}; const el = a[a.length - 1]; const l = [...el.querySelectorAll('a')].find((x) => x.getClientRects().length > 0); if (!l) return null; for (const r of [...l.getClientRects()]) { for (const fy of [0.25, 0.5, 0.75]) { for (const fx of [0.2, 0.5, 0.8]) { const x = Math.round(r.left + r.width * fx); const y = Math.round(r.top + r.height * fy); const hit = document.elementFromPoint(x, y); if (hit && (hit === l || l.contains(hit))) return { x, y, href: l.getAttribute('href') } } } } return null })())`))
    if (link === null) notSeen('the link of the answer (none drawn)')
    else {
      await finger(link.x, link.y)
      const clicked = await val('window.__clicked')
      check('a tap on a link in the answer does not show the row', (await revealCount()) === 0, { link, clicked })
    }
  }

  const copyCode = await val(`JSON.stringify((() => { const a = ${ANSWERS}; const el = a[a.length - 1]; const b = [...el.querySelectorAll('button')].find((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 }); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })())`)
  if (copyCode === 'null') notSeen('the copy button of the code block (none drawn)')
  else { const c = JSON.parse(copyCode); await finger(c.x, c.y); check('a tap on the copy button of a code block does not show the row', (await revealCount()) === 0) }
  // a selected text
  const sel = await textPoint(0)
  await val(`(() => { const a = ${ANSWERS}; const p = a[a.length - 1].querySelector('p'); const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r) })()`)
  await finger(sel.x, sel.y)
  check('a tap on a selected text does not show the row', (await revealCount()) === 0)
  await val('getSelection().removeAllRanges()')
  await sleep(200)
  const lp = await textPoint(0)
  await finger(lp.x, lp.y, { hold: 650 })
  check('a long press does not show the row', (await revealCount()) === 0)
  await val('getSelection().removeAllRanges()')
  const dr = await textPoint(0)
  await finger(dr.x, dr.y, { to: { x: dr.x, y: dr.y - 70 } })
  check('a drag of the finger (a scroll) does not show the row', (await revealCount()) === 0)
  await val('getSelection().removeAllRanges()')
  await val(`${SCROLLER}.scrollTop = ${SCROLLER}.scrollHeight`)
  await sleep(500)
  const again = await textPoint(0)
  await val(`window.__ck = []; document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('[data-chat-flow-kind="assistant-step"]'); window.__ck.push({ tag: e.target.tagName, cls: String(e.target.className).slice(0, 30), step: !!a, attr: document.documentElement.getAttribute('data-kb-msg-actions'), sel: getSelection().toString().length, x: e.clientX, y: e.clientY }) }, { capture: true, once: true })`)
  await finger(again.x, again.y)
  check('(and a plain tap still does, after all of that)', (await revealCount()) === 1, { again, clicks: await val('window.__ck'), sel: await val('getSelection().toString()'), rows: (await rowsInfo()).filter((r) => r.reveal !== null || r.h > 0) })
  await finger(again.x, again.y - 44)
  await sleep(300)

  // read after scrolling up: the text does not move
  await val(`(() => { const sc = ${SCROLLER}; sc.scrollTop = Math.max(0, sc.scrollHeight - sc.clientHeight - 520) })()`)
  await sleep(700)
  const mid = JSON.parse(await val(`JSON.stringify((() => { const a = ${ANSWERS}; const i = a.map((e, k) => [e, k]).filter(([e, k]) => { const b = e.querySelector('p').getBoundingClientRect(); return b.top > 120 && b.top < 560 && k < a.length - 1 }).map(([e, k]) => k).pop(); if (i === undefined) return null; const b = a[i].querySelector('p').getBoundingClientRect(); return { x: Math.round(b.left + 40), y: Math.round(b.top + 10), top: Math.round(b.top), n: a.length - 1 - i } })())`))
  if (mid === null) notSeen('an answer in the middle of the screen after scrolling up (none)')
  else {
    await finger(mid.x, mid.y)
    const after = await textPoint(mid.n)
    check('scrolled up, the tapped answer\'s text does not move when its row comes in (±1 px)', (await revealCount()) === 1 && Math.abs(after.top - mid.top) <= 1, { before: mid.top, after: after.top })
    await shot('03-middle-open-scrolled-up')
    await finger(after.x, after.y)
    check('(and its second tap hides it)', (await revealCount()) === 0)
  }

  // reduced motion
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await sleep(200)
  const td = await val(`getComputedStyle(${ROWS}[0]).transitionDuration`)
  check('with « reduce motion » the row has no transition', /^0s(, 0s)*$/.test(String(td)), td)
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await sleep(200)
  const td2 = await val(`getComputedStyle(${ROWS}[0]).transitionDuration`)
  check('otherwise it glides (a fade and a slide, about 0.2 s)', /0\.(16|22)s/.test(String(td2)), td2)

  // the thumbs: the rating card keeps the row open
  await val(`${SCROLLER}.scrollTop = ${SCROLLER}.scrollHeight`)
  await sleep(500)
  const lt = await textPoint(0)
  await finger(lt.x, lt.y)
  const thumb = await val(`JSON.stringify((() => { const s = [...document.querySelectorAll('.kbq-rating-pouce')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && getComputedStyle(e).visibility === 'visible' }).pop(); if (!s) return null; const b = s.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) } })())`)
  if (thumb === 'null') notSeen('the thumbs of the open row (none drawn)')
  else {
    const sp = JSON.parse(thumb)
    await finger(sp.x, sp.y)
    await sleep(500)
    const pop = await val(`!!document.querySelector('.kbq-rating-pop, [data-kb-rating]')`)
    if (pop !== true) notSeen('the rating card opened by thumbs-down (the stub server has no rating endpoint; the row\'s own state after the tap: ' + (await revealCount()) + ' open)')
    check('a tap on thumbs-down does not hide the row', (await revealCount()) === 1)
    await shot('04-after-thumb')
  }
  await val(`${SCROLLER}.scrollTop = ${SCROLLER}.scrollHeight`)
  await sleep(300)
  const closeAll = await textPoint(0)
  if ((await revealCount()) === 1) await finger(closeAll.x, closeAll.y - 44)

  console.log('\n── C  an answer still being written ──')
  if ((await revealCount()) > 0) {
    const comp = JSON.parse(await val(`JSON.stringify((() => { const c = document.querySelector('[data-slot="conversation.composer.bar"], [data-slot="conversation.composer"]'); if (!c) return null; const b = c.getBoundingClientRect(); return { x: Math.round(b.left + 20), y: Math.round(b.top + b.height / 2) } })())`))
    if (comp !== null) await finger(comp.x, comp.y)
  }
  await sendAndWait('[K9] write slowly', /This answer/)
  await sleep(1500)
  const during = await rowsInfo()
  const nowRows = await val(`${ROWS}.length`)
  const streamingTurn = await val(`(() => { const a = ${ANSWERS}; const l = a[a.length - 1]; const t = l.getAttribute('data-chat-turn'); return { turn: t, streaming: !!l.querySelector('[data-streaming="true"]'), text: l.innerText.slice(0, 60), hasRow: !!document.querySelector('[data-chat-flow-kind="turn-tail"][data-chat-turn="' + t + '"] [data-turn-tail] > [data-clock="end"]') } })()`)
  check('the answer being written is streaming and has no row yet', streamingTurn.streaming === true && streamingTurn.hasRow === false, streamingTurn)
  const sp2 = await textPoint(0)
  await finger(sp2.x, sp2.y)
  check('a tap on the answer being written shows nothing', (await revealCount()) === 0, await rowsInfo())
  await shot('05-streaming')
  check('the rows of the finished answers stay hidden meanwhile', during.every((r) => r.h === 0), during)
  await g.until(async () => (Number(await g.val(`${ROWS}.length`)) > nowRows ? true : null), 90000, 400)
  await sleep(900)
  const doneRows = await rowsInfo()
  const fresh = doneRows[doneRows.length - 1]
  check('once finished its row is there, and hidden', fresh.h === 0 && fresh.vis === 'hidden' && fresh.reveal === null, fresh)
  await val(`${SCROLLER}.scrollTop = ${SCROLLER}.scrollHeight`)
  await sleep(400)
  const sp3 = await textPoint(0)
  await finger(sp3.x, sp3.y)
  const o3 = await open()
  check('and a tap shows it', o3.length === 1 && o3[0].h >= 44, o3)
  await shot('06-after-stream-open')

  console.log('\n── D  Cite on an answer, Edit on the person\'s own message (list item 31) ──')
  const composerText = () => val(`(() => { const e = Array.from(document.querySelectorAll('[contenteditable="true"], textarea')).filter((x) => { const r = x.getBoundingClientRect(); return r.width > 100 && r.height > 10 }).pop(); return e ? String(e.value !== undefined ? e.value : e.innerText) : null })()`)
  const before31 = String(await composerText() || '')
  // the row of the last answer is open (C ended on it): Cite is there, a real touch zone
  const cite = JSON.parse(await val(`JSON.stringify((() => { const b = document.querySelector('[data-kb-reveal] [data-kb="msg-cite"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), vis: getComputedStyle(b).visibility } })())`))
  check('the row a tap shows has a Cite button, a 44 px touch zone like its neighbours', cite !== null && cite.w >= 44 && cite.h >= 44 && cite.vis === 'visible', cite)
  await shot('07-cite-in-row')
  if (cite !== null) {
    await finger(cite.x, cite.y)
    await sleep(900)
    const t1 = String(await composerText() || '')
    check('a tap on Cite puts the answer in the composer as a quote, and does not send anything', t1 !== before31 && /(^|\n)> /.test(t1) && /This answer/.test(t1), t1.slice(0, 200))
    await shot('08-cite-draft')
  }
  // the person's own message: a tap shows its row, with Edit
  await val(`(() => { const u = [...document.querySelectorAll('[data-chat-flow-kind="user"]')].pop(); if (u) u.scrollIntoView({ block: 'center' }) })()`)
  await sleep(700)
  const mine = JSON.parse(await val(`JSON.stringify((() => { const u = [...document.querySelectorAll('[data-chat-flow-kind="user"]')].pop(); if (!u) return null; const t = [...u.querySelectorAll('span, p')].find((x) => { const b = x.getBoundingClientRect(); return b.width > 0 && b.height > 0 && /write slowly/.test(x.textContent || '') && x.children.length === 0 }); if (!t) return null; const b = t.getBoundingClientRect(); return { x: Math.round(b.left + Math.min(b.width / 2, 40)), y: Math.round(b.top + b.height / 2) } })())`))
  if (mine === null) notSeen('Edit on the person\'s own message (the last message is not on screen)')
  else {
    await finger(mine.x, mine.y)
    await sleep(700)
    const edit = JSON.parse(await val(`JSON.stringify((() => { const b = document.querySelector('[data-kb-reveal] [data-kb="msg-edit"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), label: (b.getAttribute('aria-label') || '') } })())`))
    check('a tap on the person\'s own message shows its row with an Edit button (44 px high at least)', edit !== null && edit.w >= 44 && edit.h >= 44 && edit.label === 'Edit', edit)
    await shot('09-edit-in-row')
    if (edit !== null) {
      const answersBefore = Number(await answerCount())
      await finger(edit.x, edit.y)
      await sleep(900)
      const t2 = String(await composerText() || '')
      check('a tap on Edit puts the message text back in the composer as a draft; nothing is sent', /write slowly/.test(t2) && Number(await answerCount()) === answersBefore, t2.slice(0, 200))
      check('and the row closes', (await revealCount()) === 0, await rowsInfo())
      await shot('10-edit-draft')
    }
  }
  await checkAnswerLink()

} catch (e) {
  failed += 1
  console.log('  ✗ the run broke: ' + String(e && e.stack ? e.stack : e).slice(0, 600))
} finally {
  try { writeFileSync(profile, readFileSync(backup, 'utf8')) } catch (e) { /* kept */ }
  try { if (g) await g.close() } catch (e) { /* closed */ }
  try { server.close() } catch (e) { /* closed */ }
}
report.failed = failed
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log('\n' + (failed === 0 ? '✓ ' + report.steps.length + ' checks passed' : '✗ ' + failed + ' failed') + (report.notSeen.length > 0 ? ', ' + report.notSeen.length + ' not seen' : ''))
process.exit(failed === 0 ? 0 : 1)
