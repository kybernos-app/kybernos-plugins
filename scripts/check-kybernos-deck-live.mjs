#!/usr/bin/env node
// Slides a chat makes, in a real GUI: a stub model that answers one request by calling `create_deck` (the deck as a `.deck.html` file in the chat's folder) and `deliver_files`, the card
// the real chat draws, a real click on it that opens the deck in our editor in the right-hand panel, a real edit typed into a slide, Save, and the file read back from disk.
//
//   source scripts/sandbox/env.sh && node scripts/check-kybernos-deck-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh) with the editors built into it (node packages/kybernos-office/build-editors.mjs --home "$DSH_HOME"). Refuses :3080 and any
// DSH home that is not a sandbox's. It adds a stub model to the sandbox profile (a backup is put back), restarts the sandbox twice, and writes one deck in a folder of the sandbox's
// workspace that it removes again. Nothing leaves the machine; no credential of the user's is involved.
//
// Named check-* on purpose: it needs a running DSH, the built editors and Chrome, so CI must not run it. Exit code 0 / 1 / 3 (3 = inconclusive: no sandbox).
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openGui, sleep } from './lib-e2e-gui.mjs'
import { connect } from './cdp-lib.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : join(tmpdir(), 'kb-office-deck-live')
mkdirSync(shotDir, { recursive: true })
const here = dirname(fileURLToPath(import.meta.url))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const host = process.env.KB_HOST || '127.0.0.1:3080'
const home = process.env.DSH_HOME || ''
if (/:3080$/.test(host) || !home.includes('.kybernos-sandbox')) { console.error('○ inconclusive: this check needs a DSH that serves this checkout (a sandbox instance), not the one on :3080. source scripts/sandbox/env.sh first.'); process.exit(3) }
if (!existsSync(join(home, 'kybernos', 'kybernos-office', 'editors', 'deck', 'standalone.js'))) { console.error('○ inconclusive: build the editors first: node packages/kybernos-office/build-editors.mjs --home "$DSH_HOME"'); process.exit(3) }

// ── the stub model: one request, two tool calls (create_deck, then deliver_files) ──────────────────────────────────
const DECK = {
  path: 'Deck-check/results.deck.html',
  title: 'Quarterly results',
  language: 'en',
  theme: { primary: '#0B3D2E', accent: '#F2A900' },
  slides: [
    { layout: 'cover', title: 'Quarterly results', subtitle: 'Kybernos team', tagline: 'Revenue up 18 % on the year', notes: 'Open on the number.' },
    { layout: 'bullets', title: 'Three things to remember', bullets: ['**Revenue** reaches 4.8 M€', 'Users double in six months', 'Churn stays low'] },
    { layout: 'stats', title: 'Key figures', stats: [{ value: '4.8 M€', label: 'Revenue' }, { value: '+18 %', label: 'Growth' }, { value: '118 %', label: 'Net retention' }] },
    { layout: 'chart', title: 'Revenue grows every quarter', chart: { type: 'column', categories: ['Q4', 'Q1', 'Q2', 'Q3'], series: [{ name: 'Revenue', values: [3.9, 4.1, 4.4, 4.8] }] } },
    { layout: 'table', title: 'Plans', table: { header: ['Plan', 'Price'], rows: [['Free', '0 €'], ['Plus', '19 €']] } },
    { layout: 'section', title: 'Thank you', number: '05', subtitle: 'Questions welcome' },
  ],
}
const probe = { toolNames: [], cwd: null, calls: 0, toolResults: [], folder: null }
const sse = (res, delta, finish) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const base = { id: 'chatcmpl-stub', object: 'chat.completion.chunk', created: 1, model: 'stub-1' }
  res.write('data: ' + JSON.stringify(Object.assign({}, base, { choices: [{ index: 0, delta, finish_reason: null }] })) + '\n\n')
  res.write('data: ' + JSON.stringify(Object.assign({}, base, { choices: [{ index: 0, delta: {}, finish_reason: finish }] })) + '\n\n')
  res.end('data: [DONE]\n\n')
}
const call = (id, name, argsObj) => ({ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(argsObj) } })
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (d) => { body += d })
  req.on('end', () => {
    let j = {}
    try { j = JSON.parse(body) } catch (e) { j = {} }
    if (String(req.url).indexOf('/chat/completions') < 0) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'kbstub/stub-1', object: 'model' }] })); return }
    if (!Array.isArray(j.tools) || j.tools.length === 0) { sse(res, { role: 'assistant', content: 'Stub' }, 'stop'); return } // the engine's side calls (a title)
    probe.calls += 1
    probe.toolNames = j.tools.map((t) => (t.function ? t.function.name : ''))
    probe.toolSpec = (j.tools.find((t) => t.function && t.function.name === 'create_deck') || {}).function
    const msgs = Array.isArray(j.messages) ? j.messages : []
    const tools = msgs.filter((m) => m.role === 'tool')
    const flat = msgs.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n')
    probe.toolResults = tools.map((t) => (typeof t.content === 'string' ? t.content : JSON.stringify(t.content)))
    if (tools.length >= 2) { sse(res, { role: 'assistant', content: 'Done: your deck is in the card above.' }, 'stop'); return }
    if (tools.length === 1) { sse(res, { role: 'assistant', tool_calls: [call('call_deck_2', 'deliver_files', { files: [{ path: DECK.path, description: 'Quarterly results deck' }] })] }, 'tool_calls'); return }
    const m = flat.match(/Current working directory:\s*"([^"]+)"/)
    probe.cwd = m ? m[1] : null
    if (probe.cwd === null) { sse(res, { role: 'assistant', content: 'no cwd' }, 'stop'); return }
    probe.folder = join(probe.cwd, 'Deck-check')
    sse(res, { role: 'assistant', tool_calls: [call('call_deck_1', 'create_deck', DECK)] }, 'tool_calls')
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const stubPort = server.address().port

const profile = join(home, 'profiles', 'web', 'cordis.patch.yml')
const backup = profile + '.bak-deck-check'
const anchor = '- id: llm-pi-ai\n  config:\n    providers:\n'
const patch = existsSync(profile) ? readFileSync(profile, 'utf8') : ''
if (patch.indexOf(anchor) < 0) { console.error('○ inconclusive: the sandbox profile has no llm-pi-ai providers block to add the stub model to'); process.exit(3) }
const sandbox = (script, extraEnv) => spawnSync('bash', [join(here, 'sandbox', script)], { env: Object.assign({}, process.env, extraEnv || {}), encoding: 'utf8', timeout: 240000 })
const restart = (extraEnv) => { sandbox('stop.sh'); return sandbox('start.sh', extraEnv).status === 0 }
const provider = '      kbstub:\n        api: openai-completions\n        baseURL: http://127.0.0.1:' + stubPort + '/v1\n        apiKeyEnv: KB_STUB_KEY\n        models:\n          - id: kbstub/stub-1\n            name: Stub\n'

let g = null
let frameConn = null
let frameTargetId = ''
try {
  copyFileSync(profile, backup)
  writeFileSync(profile, patch.replace(anchor, anchor + provider))
  console.log('\n── the chat makes a deck and delivers it ──')
  check('the sandbox restarts with a stub model', restart({ KB_STUB_KEY: 'stub' }) === true)
  g = await openGui(host, { width: 1500, height: 950 })
  await g.reload()
  await g.selectModel('Stub')
  await g.send('Make me an example slide deck about our quarterly results and give it to me here')
  const cards = await g.until(() => g.val(`document.querySelectorAll('[data-presented-file]').length`), 90000, 500)
  await sleep(800)
  await g.shot(join(shotDir, '1-card.png'))
  check('the model was offered create_deck and deliver_files', probe.toolNames.includes('create_deck') && probe.toolNames.includes('deliver_files'), probe.toolNames.slice(0, 40))
  const spec = probe.toolSpec || {}
  check('create_deck tells the model to make decks, not .pptx files, and to hand them over', /\.pptx/.test(spec.description || '') && /deliver_files/.test(spec.description || '') && /EDIT/.test(spec.description || ''), String(spec.description).slice(0, 120))
  check('the tool answered: 6 slides written', probe.toolResults.some((t) => /Deck written: Deck-check\/results\.deck\.html \(6 slides\)/.test(t)), probe.toolResults.slice(0, 2))
  const file = probe.folder === null ? null : join(probe.folder, 'results.deck.html')
  check('the deck is one file in the chat\'s folder', file !== null && existsSync(file) && /<meta name="kybernos-deck"/.test(readFileSync(file, 'utf8')))
  check('one card stands in the chat, naming the deck', cards === 1)
  const names = await g.val(`Array.from(document.querySelectorAll('[data-presented-file]')).map((c) => (c.innerText || '').replace(/\\s+/g, ' ').trim())`)
  check('the card names the file', Array.isArray(names) && names.some((n) => /results\.deck\.html/.test(n)), names)

  console.log('\n── a click on the card opens the deck in our editor ──')
  const frameSrc = () => g.val(`(() => { const f = Array.from(document.querySelectorAll('.kyo-pane [data-kb="office-frame"]')).filter((x) => x.offsetParent !== null).pop(); return f ? f.getAttribute('src') : null })()`)
  const pressed = await g.press('[data-presented-file] button[aria-label$="/results.deck.html in sidebar"]', 6000)
  check('the card can be pressed', pressed === true)
  const src = await g.until(async () => { const s = await frameSrc(); return typeof s === 'string' && s.includes('/kybernos-office/v/') && s.includes('/deck/') ? s : null }, 25000, 300)
  check('it opens in the deck editor, in the panel', typeof src === 'string', await frameSrc())
  check('the frame is told the file\'s name and starts read-only', typeof src === 'string' && /[?&]name=results\.deck\.html(&|$)/.test(src) && /[?&]ro=1(&|$)/.test(src), src)
  const barKind = await g.val(`(() => { const k = document.querySelector('.kyo-pane [data-kb="office-kind"]'); return k ? k.textContent : null })()`)
  console.log('  ○ bar kind badge: ' + JSON.stringify(barKind))

  // The frame is a sandboxed page that Chrome keeps in a process of its own: a target of its own, driven through its own connection.
  const debugBase = 'http://' + new URL(g.page.info.webSocketDebuggerUrl.replace(/^ws/, 'http')).host
  const frameTarget = async () => {
    try {
      const list = await (await fetch(debugBase + '/json/list')).json()
      const t = list.find((x) => /\/kybernos-office\/v\/[0-9a-f]+\/deck\//.test(x.url) && x.type !== 'page' && x.type !== 'service_worker')
      if (!t) return null
      if (frameConn === null || frameTargetId !== t.id) {
        try { if (frameConn) frameConn.close() } catch (e) { /* gone */ }
        frameConn = await connect(t)
        frameTargetId = t.id
        await frameConn.send('Runtime.enable', {})
        await frameConn.send('Log.enable', {})
        frameConn.logs = []
        frameConn.on('Log.entryAdded', (p) => { if (p.entry && p.entry.level !== 'verbose') frameConn.logs.push(p.entry.level + ': ' + String(p.entry.text).slice(0, 200)) })
        frameConn.on('Runtime.exceptionThrown', (p) => frameConn.logs.push('exception: ' + String((p.exceptionDetails && (p.exceptionDetails.exception && p.exceptionDetails.exception.description || p.exceptionDetails.text)) || '').slice(0, 300)))
      }
      return frameConn
    } catch (e) { return null }
  }
  const fq = async (js, ms = 15000) => { const c = await frameTarget(); if (c === null) return { __err: 'no frame target' }; const r = await c.evalJs(js, ms); return r.err ? { __err: r.err } : r.val }
  const up = await g.until(async () => { const n = await fq("document.querySelectorAll('#deck .cell').length"); return n === 6 ? true : null }, 30000, 400)
  check('the deck draws its six slides in the frame', up === true)
  await sleep(1200)
  await g.shot(join(shotDir, '2-opened-readonly.png'))
  const ro = await fq("({ editing: document.body.classList.contains('editing'), edit: !!document.querySelector('#b-edit'), charts: document.querySelectorAll('.chart svg').length })")
  check('read-only first: no editing mode, no edit button in the player', ro && ro.editing === false && ro.edit === false, ro)

  console.log('\n── Edit turns it into the editor; a typed change is saved into the file ──')
  const hasEditButton = await g.until(() => g.val(`(() => { const b = document.querySelector('.kyo-pane [data-kb="office-edit"]'); return !!b && !b.disabled && !b.hidden })()`), 15000, 300)
  check('« Edit » is offered in the bar', hasEditButton === true)
  await g.press('.kyo-pane [data-kb="office-edit"]', 6000)
  const editing = await g.until(async () => { const v = await fq("document.body.classList.contains('editing')"); return v === true ? true : null }, 30000, 400)
  check('the frame is now the editor', editing === true)
  await sleep(1500)
  await g.shot(join(shotDir, '3-editing.png'))
  // A real click into the title of the first slide, then real key events.
  const box = await g.val(`(() => { const f = document.querySelector('.kyo-pane [data-kb="office-frame"]'); const r = f.getBoundingClientRect(); return { x: r.left, y: r.top } })()`)
  const c = await fq("(() => { const e = document.querySelector('.cell.cur h1'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()")
  check('the title of the first slide is on screen', c && !c.__err && typeof c.x === 'number', c)
  if (c && typeof c.x === 'number') {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await g.page.send('Input.dispatchMouseEvent', { type, x: box.x + c.x, y: box.y + c.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 })
    await sleep(500)
    await g.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
    await g.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
    for (const ch of ' EDITED') {
      await g.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch })
      await g.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
      await sleep(30)
    }
  }
  await sleep(600)
  await g.shot(join(shotDir, '4-typed.png'))
  const dirty = await g.until(() => g.val(`(() => { const s = document.querySelector('.kyo-pane [data-kb="office-status"]'); return s ? s.textContent : '' })()`).then((t) => (/Unsaved/.test(String(t)) ? t : null)), 8000, 300)
  check('the bar says there are unsaved changes (the amber dot)', typeof dirty === 'string', dirty)
  const tone = await g.val(`(() => { const s = document.querySelector('.kyo-pane [data-kb="office-status"]'); return s ? s.getAttribute('data-tone') : null })()`)
  check('the status dot is amber (dirty)', tone === 'dirty', tone)
  const before = file === null ? '' : readFileSync(file, 'utf8')
  check('nothing was written before Save', file !== null && !/EDITED/.test(before))
  const savable = await g.until(() => g.val(`(() => { const b = document.querySelector('.kyo-pane [data-kb="office-save"]'); return !!b && !b.disabled })()`), 6000, 200)
  check('Save is on', savable === true)
  await g.press('.kyo-pane [data-kb="office-save"]', 6000)
  const saved = await g.until(() => g.val(`(() => { const s = document.querySelector('.kyo-pane [data-kb="office-status"]'); return s ? s.textContent : '' })()`).then((t) => (/Saved/.test(String(t)) ? t : null)), 15000, 300)
  check('the bar says Saved', typeof saved === 'string', saved)
  const after = file === null ? '' : readFileSync(file, 'utf8')
  check('the file on disk has the typed text in its first slide', /<h1[^>]*>Quarterly results EDITED<\/h1>/.test(after), (after.match(/<h1[^>]*>[^<]*<\/h1>/) || [])[0])
  check('only the slides changed: the head, the theme and the player are as written', after.slice(0, after.indexOf('<main id="deck">')) === before.slice(0, before.indexOf('<main id="deck">')) && after.slice(after.indexOf('</main>')) === before.slice(before.indexOf('</main>')))
  const restBefore = before.split('<div class="cell">').slice(2).join('')
  const restAfter = after.split('<div class="cell">').slice(2).join('')
  let at = 0
  while (at < restBefore.length && restBefore[at] === restAfter[at]) at++
  check('the slides outside the first one are as written', restAfter === restBefore, restAfter === restBefore ? '' : 'differs at ' + at + ': «' + restBefore.slice(Math.max(0, at - 40), at + 80) + '» vs «' + restAfter.slice(Math.max(0, at - 40), at + 80) + '»')
  check('the saved file is still a deck the guard takes (marker, main#deck, one player)', /<meta name="kybernos-deck"/.test(after) && (after.match(/<main id="deck">/g) || []).length === 1 && (after.match(/<script data-kb|<script data-kd="runtime">/g) || []).length === 1)
  const logs = frameConn === null ? [] : frameConn.logs.filter((l) => !/favicon/.test(l))
  check('the frame logged no error or CSP violation', logs.length === 0, logs.slice(0, 4))
  await sleep(500)
  await g.shot(join(shotDir, '5-saved.png'))
  const undoOn = await g.val(`(() => { const b = document.querySelector('.kyo-pane [data-kb="office-undo"]'); return !!b && !b.disabled })()`)
  check('Undo last save is on', undoOn === true)
  const errors = await g.val(`(window.__kbErrors || []).length`)
  console.log('  ○ page errors seen: ' + JSON.stringify(errors))
} catch (e) {
  fail += 1
  console.log('  ✗ the run broke — ' + String(e && e.stack ? e.stack : e).slice(0, 600))
} finally {
  try { if (frameConn !== null) frameConn.close() } catch (e) { /* gone */ }
  try { if (g !== null) await g.close() } catch (e) { /* page already gone */ }
  server.close()
  try { copyFileSync(backup, profile); rmSync(backup, { force: true }) } catch (e) { /* no backup was made */ }
  if (probe.folder !== null) { try { rmSync(probe.folder, { recursive: true, force: true }) } catch (e) { /* kept */ } }
  restart({ OLLAMA_LOCAL_API_KEY: 'ollama' })
}
console.log(`\n${pass} ok, ${fail} failed. Screenshots in ${shotDir}`)
process.exit(fail === 0 ? 0 : 1)
