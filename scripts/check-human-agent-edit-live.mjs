#!/usr/bin/env node
// The person and the agent edit the same file (case J15-05), in a real GUI, with a stub model as the agent.
//
//   source scripts/sandbox/env.sh && node scripts/check-human-agent-edit-live.mjs --out <evidence dir>
//
// What it plays, on one slide deck (the agent's only way to rewrite a file the editor opens: `create_deck` on the same path replaces it):
//   S1  the person edits a slide and has NOT saved; the agent replaces the deck; the person presses Save.
//       Read: the conflict card (its words, its three buttons), that nothing was written by the refused Save, that « Keep editing » does not
//       open a way round it, that « Save a copy » keeps both versions, and what « Reload (lose my changes) » leaves the next Save with.
//   S2  the person saves first; the agent then replaces the deck without asking. Read: what the agent's tool says, what is on disk, whether the
//       person's saved version is kept anywhere, and what « Undo last save » says once the file changed behind it.
//   S3  the deck is open read-only; the agent replaces it. Read: whether the pane shows the new slides, and how soon.
//
// It adds a stub model to the sandbox profile (a backup is put back), restarts the sandbox twice and writes one folder in the chat's working
// folder that it removes again. Nothing leaves the machine. Needs the editors built into the sandbox. Refuses :3080 and any DSH home that is
// not a sandbox's. Exit code 0 when the run went through (the findings are in the report), 1 when it broke, 3 when it cannot start.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openGui, sleep } from './lib-e2e-gui.mjs'
import { connect } from './cdp-lib.mjs'

const args = process.argv.slice(2)
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : null
if (OUT === null) { console.error('usage: --out <evidence dir>'); process.exit(3) }
mkdirSync(join(OUT, 'shots'), { recursive: true })
const here = dirname(fileURLToPath(import.meta.url))
const host = process.env.KB_HOST || '127.0.0.1:3080'
const home = process.env.DSH_HOME || ''
if (/:3080$/.test(host) || !home.includes('.kybernos-sandbox')) { console.error('○ inconclusive: needs a sandbox DSH (source scripts/sandbox/env.sh), not :3080.'); process.exit(3) }
if (!existsSync(join(home, 'kybernos', 'kybernos-office', 'editors', 'deck', 'standalone.js'))) { console.error('○ inconclusive: build the editors first'); process.exit(3) }

const report = { when: new Date().toISOString(), host, steps: [], findings: {} }
const note = (k, v) => { report.findings[k] = v; console.log('  ○ ' + k + ': ' + JSON.stringify(v).slice(0, 400)) }
const check = (name, ok, detail) => { report.steps.push({ name, ok: !!ok, detail: detail === undefined ? undefined : detail }); console.log((ok ? '  ✓ ' : '  ✗ ') + name + (!ok && detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 300) : '')) }

// ── the stub model: a turn is chosen by a marker in the last user message ─────────────────────────────────────────
const probe = { cwd: null, toolNames: [], results: {}, turns: [], fileTools: [], seen: [] }
const deckOf = (title, bullets) => ({ path: 'Guard-check/plan.deck.html', title, language: 'en', slides: [{ layout: 'cover', title, subtitle: 'Guard check' }, { layout: 'bullets', title: 'Points', bullets }] })
const DECKS = { A1: deckOf('Plan v1', ['one', 'two']), A2: deckOf('Agent rewrite', ['agent one', 'agent two']), A3: deckOf('Agent overwrite', ['over one', 'over two']), A4: deckOf('Agent again', ['again one', 'again two']) }
const sse = (res, delta, finish) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const base = { id: 'chatcmpl-stub', object: 'chat.completion.chunk', created: 1, model: 'stub-1' }
  res.write('data: ' + JSON.stringify(Object.assign({}, base, { choices: [{ index: 0, delta, finish_reason: null }] })) + '\n\n')
  res.write('data: ' + JSON.stringify(Object.assign({}, base, { choices: [{ index: 0, delta: {}, finish_reason: finish }] })) + '\n\n')
  res.end('data: [DONE]\n\n')
}
const call = (id, name, argsObj) => ({ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(argsObj) } })
const textOf = (m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (d) => { body += d })
  req.on('end', () => {
    let j = {}
    try { j = JSON.parse(body) } catch (e) { j = {} }
    if (String(req.url).indexOf('/chat/completions') < 0) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'kbstub/stub-1', object: 'model' }] })); return }
    if (!Array.isArray(j.tools) || j.tools.length === 0) { sse(res, { role: 'assistant', content: 'Stub' }, 'stop'); return }
    probe.toolNames = j.tools.map((t) => (t.function ? t.function.name : ''))
    probe.fileTools = j.tools.filter((t) => t.function && /write|edit|patch/i.test(t.function.name)).map((t) => t.function.name)
    const msgs = Array.isArray(j.messages) ? j.messages : []
    const flat = msgs.map(textOf).join('\n')
    const m = flat.match(/Current working directory:\s*"([^"]+)"/)
    if (m) probe.cwd = m[1]
    // the message that carries the marker: the engine may add user-role messages of its own after the person's
    let lastUser = -1
    for (let i = msgs.length - 1; i >= 0; i -= 1) { if (msgs[i].role === 'user' && /\[(A[1-9])\]/.test(textOf(msgs[i]))) { lastUser = i; break } }
    const marker = lastUser >= 0 ? (textOf(msgs[lastUser]).match(/\[(A[1-9])\]/) || [])[1] : null
    if (probe.seen.length < 12) probe.seen.push({ roles: msgs.map((x) => x.role).join(','), marker, tail: textOf(msgs[msgs.length - 1]).slice(0, 120) })
    const results = msgs.slice(lastUser + 1).filter((x) => x.role === 'tool').map(textOf)
    if (marker && results.length > 0) probe.results[marker] = results
    if (marker === null || DECKS[marker] === undefined) { sse(res, { role: 'assistant', content: 'No scripted turn.' }, 'stop'); return }
    const need = marker === 'A1' ? 2 : 1
    if (results.length >= need) { sse(res, { role: 'assistant', content: 'Done.' }, 'stop'); return }
    if (results.length === 0) { probe.turns.push(marker); sse(res, { role: 'assistant', tool_calls: [call('call_' + marker + '_1', 'create_deck', DECKS[marker])] }, 'tool_calls'); return }
    sse(res, { role: 'assistant', tool_calls: [call('call_' + marker + '_2', 'deliver_files', { files: [{ path: DECKS[marker].path, description: 'The plan deck' }] })] }, 'tool_calls')
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const stubPort = server.address().port

const profile = join(home, 'profiles', 'web', 'cordis.patch.yml')
const backup = profile + '.bak-human-agent'
const anchor = '- id: llm-pi-ai\n  config:\n    providers:\n'
const patch = existsSync(profile) ? readFileSync(profile, 'utf8') : ''
if (patch.indexOf(anchor) < 0) { console.error('○ inconclusive: the sandbox profile has no llm-pi-ai providers block to add the stub model to'); process.exit(3) }
const sandbox = (script, extraEnv) => spawnSync('bash', [join(here, 'sandbox', script)], { env: Object.assign({}, process.env, { KB_SANDBOX_TTL: '7200' }, extraEnv || {}), encoding: 'utf8', timeout: 240000 })
const restart = (extraEnv) => { sandbox('stop.sh'); return sandbox('start.sh', extraEnv).status === 0 }
const provider = '      kbstub:\n        api: openai-completions\n        baseURL: http://127.0.0.1:' + stubPort + '/v1\n        apiKeyEnv: KB_STUB_KEY\n        models:\n          - id: kbstub/stub-1\n            name: Stub\n'

// ── the pane and its frame ────────────────────────────────────────────────────────────────────────────────────────
let g = null
let frameConn = null
let frameTargetId = ''
const frameTarget = async () => {
  try {
    const debugBase = 'http://' + new URL(g.page.info.webSocketDebuggerUrl.replace(/^ws/, 'http')).host
    const list = await (await fetch(debugBase + '/json/list')).json()
    const t = list.find((x) => /\/kybernos-office\/v\/[0-9a-f]+\/deck\//.test(x.url) && x.type !== 'page' && x.type !== 'service_worker')
    if (!t) return null
    if (frameConn === null || frameTargetId !== t.id) {
      try { if (frameConn) frameConn.close() } catch (e) { /* gone */ }
      frameConn = await connect(t)
      frameTargetId = t.id
      await frameConn.send('Runtime.enable', {})
    }
    return frameConn
  } catch (e) { return null }
}
const fq = async (js, ms = 15000) => { const c = await frameTarget(); if (c === null) return { __err: 'no frame target' }; const r = await c.evalJs(js, ms); return r.err ? { __err: r.err } : r.val }
const pane = (js) => g.val(`(() => { const p = document.querySelector('.kyo-pane'); if (!p) return null; ${js} })()`)
const statusText = () => pane(`const s = p.querySelector('[data-kb="office-status"]'); return s ? s.textContent.trim() : null`)
const noticeText = () => pane(`const n = p.querySelector('[data-kb="office-notice"]'); return n && !n.hidden ? n.textContent.trim() : ''`)
const conflictCard = () => g.val(`(() => { const c = document.querySelector('[data-kb="office-conflict"]'); if (!c || c.hidden || c.offsetParent === null) return null; return { text: c.innerText.replace(/\\s+/g, ' ').trim(), buttons: Array.from(c.querySelectorAll('button')).map((b) => b.innerText.trim()) } })()`)
const undoCard = () => g.val(`(() => { const c = document.querySelector('[data-kb="office-undo-confirm"]'); if (!c || c.hidden || c.offsetParent === null) return null; return { text: c.innerText.replace(/\\s+/g, ' ').trim(), buttons: Array.from(c.querySelectorAll('button')).map((b) => b.innerText.trim()) } })()`)
const shot = async (name) => { try { await g.shot(join(OUT, 'shots', name + '.png')) } catch (e) { /* no shot */ } }
const disk = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null)
const titleOf = (html) => (html === null ? null : ((html.match(/<h1[^>]*>([^<]*)<\/h1>/) || [])[1] || null))
const slideTitle = () => fq("(() => { const e = document.querySelector('.cell.cur h1') || document.querySelector('#deck .cell h1'); return e ? e.textContent : null })()")

const openPane = async () => {
  const pressed = await g.press('[data-presented-file] button[aria-label$="/plan.deck.html in sidebar"]', 8000)
  const up = pressed ? await g.until(async () => { const n = await fq("document.querySelectorAll('#deck .cell').length"); return n === 2 ? true : null }, 30000, 400) : null
  await sleep(1000)
  return up === true
}
const typeIntoTitle = async (suffix) => {
  const box = await g.val(`(() => { const f = document.querySelector('.kyo-pane [data-kb="office-frame"]'); const r = f.getBoundingClientRect(); return { x: r.left, y: r.top } })()`)
  const c = await fq("(() => { const e = document.querySelector('.cell.cur h1'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()")
  if (!c || c.__err || typeof c.x !== 'number') return false
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await g.page.send('Input.dispatchMouseEvent', { type, x: box.x + c.x, y: box.y + c.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 })
  await sleep(500)
  await g.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
  await g.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
  for (const ch of suffix) { await g.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch }); await g.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch }); await sleep(30) }
  await sleep(700)
  return true
}
const pressEdit = async () => { await g.until(() => g.val(`(() => { const b = document.querySelector('.kyo-pane [data-kb="office-edit"]'); return !!b && !b.disabled && !b.hidden })()`), 15000, 300); await g.press('.kyo-pane [data-kb="office-edit"]', 6000); return (await g.until(async () => ((await fq("document.body.classList.contains('editing')")) === true ? true : null), 30000, 400)) === true }
const pressSave = async () => { await g.until(() => g.val(`(() => { const b = document.querySelector('.kyo-pane [data-kb="office-save"]'); return !!b && !b.disabled })()`), 6000, 200); return g.press('.kyo-pane [data-kb="office-save"]', 6000) }
const agent = async (marker, text) => {
  const before = probe.turns.length
  await g.send('[' + marker + '] ' + text)
  await g.until(() => (probe.results[marker] && probe.results[marker].length >= (marker === 'A1' ? 2 : 1) ? true : null), marker === 'A1' ? 45000 : 90000, 400)
  await sleep(1500)
  return { ran: probe.turns.length > before, results: probe.results[marker] || [] }
}

// The right-hand pane is a tab (« plan.deck.ht ✕ »): its cross is pressed with a real mouse, wherever the DOM keeps it.
const closePaneTab = async () => {
  const spot = await g.val(`(() => {
    const tabs = Array.from(document.querySelectorAll('[role="tab"], [class*="tab"]')).filter((e) => { const r = e.getBoundingClientRect(); return r.left > innerWidth * 0.5 && r.top < 60 && r.width > 40 && /plan\\.deck/.test(e.innerText || '') })
    const t = tabs.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0]
    if (!t) return null
    const btn = Array.from(t.querySelectorAll('button, [role="button"], svg')).pop()
    const r = (btn || t).getBoundingClientRect()
    const tr = t.getBoundingClientRect()
    return { x: btn ? r.left + r.width / 2 : tr.right - 12, y: btn ? r.top + r.height / 2 : tr.top + tr.height / 2, label: btn ? (btn.getAttribute('aria-label') || btn.tagName) : 'tab edge' }
  })()`)
  if (!spot || spot.err) return { pressed: false, spot }
  await g.mouse(spot.x, spot.y)
  await sleep(1200)
  const left = await g.val(`!!document.querySelector('.kyo-pane [data-kb="office-frame"]')`)
  return { pressed: true, label: spot.label, paneStillThere: left === true }
}

let folder = null
try {
  copyFileSync(profile, backup)
  writeFileSync(profile, patch.replace(anchor, anchor + provider))
  console.log('\n── set up: a stub model, a deck made by the agent ──')
  check('the sandbox restarts with a stub model', restart({ KB_STUB_KEY: 'stub' }) === true)
  g = await openGui(host, { width: 1500, height: 950 })
  await g.reload()
  await g.selectModel('Stub')
  const a1 = await agent('A1', 'Make me a plan deck and give it to me here')
  check('the agent made the deck and handed it over', a1.results.length >= 2 && /Deck written/.test(a1.results[0]), a1.results)
  if (a1.results.length < 2) throw new Error('the first agent turn did not run: ' + JSON.stringify(probe.seen))
  note('the tools the agent has that write a file', probe.fileTools)
  folder = probe.cwd === null ? null : join(probe.cwd, 'Guard-check')
  const file = folder === null ? null : join(folder, 'plan.deck.html')
  check('the deck is one file in the chat\'s folder', file !== null && existsSync(file) && titleOf(disk(file)) === 'Plan v1', file)
  const opened = await openPane()
  check('the deck opens in the pane, read-only', opened === true)

  console.log('\n── S1: the person has unsaved changes, the agent replaces the deck, the person presses Save ──')
  check('Edit turns the pane into the editor', await pressEdit())
  check('a title is typed (unsaved)', await typeIntoTitle(' HUMAN1'))
  note('S1 status before the agent', await statusText())
  check('nothing was written yet', titleOf(disk(file)) === 'Plan v1', titleOf(disk(file)))
  const v1 = disk(file)
  const s1 = await agent('A2', 'Rewrite the plan deck, I want it different')
  note('S1 what the agent was told by create_deck', s1.results)
  check('the agent replaced the file without being refused', /Deck written/.test(s1.results[0] || '') && titleOf(disk(file)) === 'Agent rewrite', { disk: titleOf(disk(file)), result: s1.results })
  await sleep(4000)
  note('S1 pane after the agent wrote (status / notice / slide)', { status: await statusText(), notice: await noticeText(), conflict: await conflictCard() !== null, slide: await slideTitle() })
  await shot('s1-1-after-agent-write')
  const v2 = disk(file)
  check('the pane did not save anything by itself', disk(file) === v2)
  check('Save is pressed', await pressSave())
  const card = await g.until(() => conflictCard(), 12000, 300)
  note('S1 the conflict card', card)
  check('a conflict card says the file changed', card !== null && card !== undefined && /changed/i.test(card.text) && card.buttons.length === 3, card)
  note('S1 status after the refused Save', await statusText())
  await shot('s1-2-conflict-card')
  check('the refused Save wrote nothing: the agent\'s file is still on disk, whole', disk(file) === v2, titleOf(disk(file)))

  console.log('\n── S1b: Keep editing, then Save again ──')
  check('Keep editing is pressed', await g.pressText('Keep editing'))
  await sleep(700)
  note('S1b after Keep editing', { status: await statusText(), conflict: (await conflictCard()) !== null, slide: await slideTitle() })
  check('Save is pressed again', await pressSave())
  const card2 = await g.until(() => conflictCard(), 12000, 300)
  check('the same refusal comes again (no way round it)', card2 !== null && card2 !== undefined, card2)
  check('still nothing written', disk(file) === v2)

  console.log('\n── S1c: Save a copy ──')
  check('Save a copy is pressed', await g.pressText('Save a copy'))
  await sleep(3000)
  note('S1c status after Save a copy', await statusText())
  const names = readdirSync(folder).sort()
  note('S1c the folder now', names)
  const copy = names.find((n) => n !== 'plan.deck.html' && /\(edited/.test(n))
  note('S1c the copy\'s name', copy || null)
  check('a copy exists next to the original', typeof copy === 'string')
  note('S1c the copy still ends in .deck.html (the only name the deck editor takes)', typeof copy === 'string' ? /\.deck\.html$/i.test(copy) : null)
  note('S1c the copy is still a deck by content (marker + one main#deck)', typeof copy === 'string' ? /<meta name="kybernos-deck"/.test(disk(join(folder, copy)) || '') : null)
  check('the copy holds the person\'s version (the HUMAN1 title)', typeof copy === 'string' && /HUMAN1/.test(titleOf(disk(join(folder, copy))) || ''), typeof copy === 'string' ? titleOf(disk(join(folder, copy))) : null)
  check('the original still holds the agent\'s version, untouched', disk(file) === v2)
  await shot('s1-3-copy-saved')
  note('S1c what the pane shows after the copy', { status: await statusText(), slide: await slideTitle(), dirty: /Unsaved/.test(String(await statusText())) })

  console.log('\n── S1d: Reload (lose my changes), then edit and Save again ──')
  // bring the card back by pressing Save with a new edit, or by the conflict path again
  await typeIntoTitle(' H1B')
  await pressSave()
  const card3 = await g.until(() => conflictCard(), 12000, 300)
  note('S1d after a Save following the copy, the conflict card is back', card3 !== null && card3 !== undefined)
  if (card3) {
    check('Reload (lose my changes) is pressed', await g.pressText('Reload (lose my changes)'))
    await sleep(3500)
    note('S1d after Reload', { status: await statusText(), slide: await slideTitle(), disk: titleOf(disk(file)) })
    await shot('s1-4-reloaded')
    const edited = await typeIntoTitle(' H1C')
    note('S1d typed again after the reload', edited)
    const saved = await pressSave()
    await sleep(3000)
    const c4 = await conflictCard()
    note('S1d the next Save after Reload', { pressed: saved, status: await statusText(), conflictAgain: c4 !== null, disk: titleOf(disk(file)) })
    await shot('s1-5-save-after-reload')
  }

  console.log('\n── S2: the person saves, then the agent replaces the deck without asking ──')
  // a clean start: the card again, a fresh open (a fresh base)
  await g.val(`(() => { const b = document.querySelector('.kyo-pane [data-kb="office-discard"], .kyo-pane button[aria-label="Close"]'); if (b) b.click() })()`)
  await sleep(500)
  const openedAgain = await openPane()
  note('S2 the deck opens again', openedAgain)
  const before2 = titleOf(disk(file))
  check('Edit', await pressEdit())
  check('a title is typed', await typeIntoTitle(' SAVED2'))
  check('Save is pressed', await pressSave())
  const saved2 = await g.until(async () => (/Saved/.test(String(await statusText())) ? true : null), 15000, 300)
  note('S2 the person\'s Save', { status: await statusText(), disk: titleOf(disk(file)), before: before2 })
  check('the person\'s save is on disk', typeof (titleOf(disk(file)) || '') === 'string' && /SAVED2/.test(titleOf(disk(file)) || ''), titleOf(disk(file)))
  const savedBytes = disk(file)
  await shot('s2-1-saved')
  const s2 = await agent('A3', 'Replace the plan deck again with my new version')
  note('S2 what the agent was told by create_deck', s2.results)
  note('S2 on disk after the agent', titleOf(disk(file)))
  check('the agent replaced the person\'s saved file with no refusal', /Deck written/.test(s2.results[0] || '') && titleOf(disk(file)) === 'Agent overwrite', { result: s2.results, disk: titleOf(disk(file)) })
  // is the person's saved version kept anywhere? the snapshot holds the bytes BEFORE the save, not after
  const snapRoot = join(home, 'kybernos', 'kybernos-office', 'snapshots')
  const holders = []
  const walk = (d) => { try { for (const n of readdirSync(d)) { const p = join(d, n); const st = statSync(p); if (st.isDirectory()) walk(p); else if (st.size < 8e6 && readFileSync(p, 'utf8').includes('SAVED2')) holders.push(p.slice(snapRoot.length)) } } catch (e) { /* none */ } }
  walk(snapRoot)
  note('S2 where the person\'s saved version (SAVED2) is still kept', { inSnapshots: holders, inFolder: readdirSync(folder).filter((n) => /SAVED2/.test(readFileSync(join(folder, n), 'utf8'))) })
  check('the person\'s saved version no longer exists in the file', !/SAVED2/.test(disk(file) || ''))
  await sleep(2500)
  note('S2 pane after the agent overwrote (status / notice / slide)', { status: await statusText(), notice: await noticeText(), slide: await slideTitle() })
  await shot('s2-2-after-agent-overwrite')
  const undoOn = await g.val(`(() => { const b = document.querySelector('.kyo-pane [data-kb="office-undo"]'); return !!b && !b.disabled })()`)
  note('S2 Undo last save is offered', undoOn)
  if (undoOn === true) {
    await g.press('.kyo-pane [data-kb="office-undo"]', 6000)
    const uc = await g.until(() => undoCard(), 12000, 300)
    note('S2 the card Undo shows once the file changed behind it', uc)
    await shot('s2-3-undo-card')
    check('Undo does not silently erase the agent\'s file', uc !== null && uc !== undefined && /changed/i.test(uc.text), uc)
    check('the agent\'s file is still on disk', titleOf(disk(file)) === 'Agent overwrite')
    if (uc) await g.pressText('Cancel')
  }

  console.log('\n── S3: the deck is open read-only, the agent replaces it ──')
  const closed = await closePaneTab()
  note('S3 the pane tab was closed (a person pressing its cross)', closed)
  const open3 = await openPane()
  note('S3 the deck is open read-only', { opened: open3, slide: await slideTitle(), status: await statusText() })
  const t0 = Date.now()
  const s3 = await agent('A4', 'Change the plan deck once more')
  note('S3 what the agent was told', s3.results)
  let seen = null
  for (let i = 0; i < 40 && seen === null; i += 1) { const t = await slideTitle(); if (t === 'Agent again') seen = Date.now() - t0; else await sleep(500) }
  note('S3 the pane shows the agent\'s new slide after (ms from the send)', seen)
  note('S3 slide at the end', await slideTitle())
  await shot('s3-1-readonly-after-agent')
  console.log('\n(done)')
} catch (e) {
  report.broke = String(e && e.stack ? e.stack : e).slice(0, 800)
  console.log('  ✗ the run broke — ' + report.broke)
} finally {
  try { if (frameConn !== null) frameConn.close() } catch (e) { /* gone */ }
  try { if (g !== null) await g.close() } catch (e) { /* page already gone */ }
  server.close()
  try { copyFileSync(backup, profile); rmSync(backup, { force: true }) } catch (e) { /* no backup was made */ }
  if (folder !== null) { try { rmSync(folder, { recursive: true, force: true }) } catch (e) { /* kept */ } }
  report.probe = { cwd: probe.cwd, turns: probe.turns, results: probe.results, seen: probe.seen }
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 1))
  restart({ OLLAMA_LOCAL_API_KEY: 'ollama' })
}
const bad = report.steps.filter((s) => !s.ok).length
console.log(`\n${report.steps.length - bad} ok, ${bad} not as expected. Report: ${join(OUT, 'report.json')}`)
process.exit(report.broke ? 1 : 0)
