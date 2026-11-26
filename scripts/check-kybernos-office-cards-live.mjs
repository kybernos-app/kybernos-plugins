#!/usr/bin/env node
// Files a chat made, delivered as cards, in a real GUI: a stub model that answers one request by writing a Word, an Excel, a PDF, a Markdown and an HTML file in the chat's folder and
// calling `deliver_files`, then the real chat draws the cards, and a real mouse click on each opens it in the right-hand panel: the .docx, .xlsx, .pdf and .md in our editors.
//
//   source scripts/sandbox/env.sh && node scripts/check-kybernos-office-cards-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh) with the editors built into it (node packages/kybernos-office/build-editors.mjs --home "$DSH_HOME"). Refuses :3080 and any
// DSH home that is not a sandbox's. It adds a stub model to the sandbox profile (a backup is put back), restarts the sandbox twice, and writes the five files in a folder of the sandbox's
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
import { docx, md, pdf, xlsx } from '../packages/kybernos-office/lib-test-files.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : join(tmpdir(), 'kb-office-cards')
mkdirSync(shotDir, { recursive: true })
const here = dirname(fileURLToPath(import.meta.url))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const host = process.env.KB_HOST || '127.0.0.1:3080'
const home = process.env.DSH_HOME || ''
if (/:3080$/.test(host) || !home.includes('.kybernos-sandbox')) { console.error('○ inconclusive: this check needs a DSH that serves this checkout (a sandbox instance), not the one on :3080. source scripts/sandbox/env.sh first.'); process.exit(3) }
if (!existsSync(join(home, 'kybernos', 'kybernos-office', 'editors', 'manifest.json'))) { console.error('○ inconclusive: build the editors first: node packages/kybernos-office/build-editors.mjs --home "$DSH_HOME"'); process.exit(3) }

// ── the stub model ───────────────────────────────────────────────────────────────────────────────────────────────────────
const probe = { toolNames: [], cwd: null, calls: 0, delivered: null, folder: null }
const FILES = [['Note.docx', docx({ text: 'A note' })], ['Budget.xlsx', xlsx({})], ['Summary.pdf', pdf({ text: 'Summary' })], ['Plan.md', md({})], ['Mockup.html', Buffer.from('<!doctype html><title>Mockup</title><h1>Mockup</h1>')]]
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
    if (!Array.isArray(j.tools) || j.tools.length === 0) { sse(res, { role: 'assistant', content: 'Stub' }, 'stop'); return } // the engine's side calls (a title)
    probe.calls += 1
    probe.toolNames = j.tools.map((t) => (t.function ? t.function.name : ''))
    const msgs = Array.isArray(j.messages) ? j.messages : []
    const flat = msgs.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n')
    if (msgs.some((m) => m.role === 'tool')) { probe.toolResult = msgs.filter((m) => m.role === 'tool').pop(); sse(res, { role: 'assistant', content: 'Done: the files are in the cards above.' }, 'stop'); return }
    const m = flat.match(/Current working directory:\s*"([^"]+)"/)
    probe.cwd = m ? m[1] : null
    if (probe.cwd === null) { sse(res, { role: 'assistant', content: 'no cwd' }, 'stop'); return }
    probe.folder = join(probe.cwd, 'Examples-check')
    mkdirSync(probe.folder, { recursive: true })
    for (const [name, bytes] of FILES) writeFileSync(join(probe.folder, name), bytes)
    const call = { name: 'deliver_files', arguments: JSON.stringify({ files: FILES.map(([name], i) => ({ path: 'Examples-check/' + name, description: 'Example ' + (i + 1) })) }) }
    sse(res, { role: 'assistant', tool_calls: [{ index: 0, id: 'call_cards_1', type: 'function', function: call }] }, 'tool_calls')
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const stubPort = server.address().port

const profile = join(home, 'profiles', 'web', 'cordis.patch.yml')
const backup = profile + '.bak-cards-check'
const anchor = '- id: llm-pi-ai\n  config:\n    providers:\n'
const patch = existsSync(profile) ? readFileSync(profile, 'utf8') : ''
if (patch.indexOf(anchor) < 0) { console.error('○ inconclusive: the sandbox profile has no llm-pi-ai providers block to add the stub model to'); process.exit(3) }
const sandbox = (script, extraEnv) => spawnSync('bash', [join(here, 'sandbox', script)], { env: Object.assign({}, process.env, extraEnv || {}), encoding: 'utf8', timeout: 240000 })
const restart = (extraEnv) => { sandbox('stop.sh'); return sandbox('start.sh', extraEnv).status === 0 }
const provider = '      kbstub:\n        api: openai-completions\n        baseURL: http://127.0.0.1:' + stubPort + '/v1\n        apiKeyEnv: KB_STUB_KEY\n        models:\n          - id: kbstub/stub-1\n            name: Stub\n'

let g = null
try {
  copyFileSync(profile, backup)
  writeFileSync(profile, patch.replace(anchor, anchor + provider))
  console.log('\n── the chat writes five files and delivers them ──')
  check('the sandbox restarts with a stub model', restart({ KB_STUB_KEY: 'stub' }) === true)
  g = await openGui(host, { width: 1500, height: 950 })
  await g.reload()
  await g.selectModel('Stub')
  await g.send('Create me an example of a document, a sheet, a PDF, a note and a mockup, and give them to me here')
  const cards = await g.until(() => g.val(`document.querySelectorAll('[data-presented-file]').length`), 90000, 500)
  await sleep(800)
  await g.shot(join(shotDir, '1-cards.png'))
  check('the model was offered deliver_files', probe.toolNames.includes('deliver_files'), probe.toolNames.slice(0, 40))
  check('the tool answered with the five files', (() => { try { const t = probe.toolResult; const s = typeof t.content === 'string' ? t.content : JSON.stringify(t.content); return /Delivered .*Note\.docx/.test(s) && /Mockup\.html/.test(s) } catch (e) { return false } })(), probe.toolResult)
  check('four cards stand in the chat, the fifth behind « All 5 files »', cards === 4 && (await g.leaf('All 5 files')) !== null, cards)
  const names = await g.val(`Array.from(document.querySelectorAll('[data-presented-file]')).map((c) => (c.innerText || '').replace(/\\s+/g, ' ').trim())`)
  check('each card names its file and what it is', Array.isArray(names) && names.some((n) => /Note\.docx/.test(n) && /Example 1/.test(n)) && names.some((n) => /Plan\.md/.test(n) && /Example 4/.test(n)), names)

  console.log('\n── a click on a card opens the file in the right-hand panel ──')
  const frameSrc = () => g.val(`(() => { const f = Array.from(document.querySelectorAll('.kyo-pane [data-kb="office-frame"]')).filter((x) => x.offsetParent !== null).pop(); return f ? f.getAttribute('src') : null })()`)
  for (const [file, editor] of [['Note.docx', 'doc'], ['Budget.xlsx', 'sheet'], ['Summary.pdf', 'pdf'], ['Plan.md', 'md']]) {
    const pressed = await g.press(`[data-presented-file] button[aria-label$="/${file} in sidebar"]`, 6000)
    check('the card of ' + file + ' can be pressed', pressed === true)
    const src = await g.until(async () => { const s = await frameSrc(); return typeof s === 'string' && s.includes('/kybernos-office/v/') && s.includes('/' + editor + '/') ? s : null }, 25000, 300)
    check(file + ' opens in our ' + editor + ' editor in the panel', typeof src === 'string' && src !== null, await frameSrc())
    await sleep(2500)
    await g.shot(join(shotDir, '2-' + editor + '.png'))
  }
  check('« All 5 files » opens the list', (await g.pressText('All 5 files')) === true && (await g.until(() => g.val(`document.querySelectorAll('[data-presented-file]').length === 5`), 4000)) === true)
  const pressedHtml = await g.press('[data-presented-file] button[aria-label$="/Mockup.html in sidebar"]', 6000)
  check('the card of Mockup.html can be pressed (DSH shows its own preview)', pressedHtml === true)
  await sleep(2500)
  await g.shot(join(shotDir, '3-html.png'))
  const errors = await g.val(`(window.__kbErrors || []).length`)
  console.log('  ○ page errors seen: ' + JSON.stringify(errors))
} catch (e) {
  fail += 1
  console.log('  ✗ the run broke — ' + String(e && e.stack ? e.stack : e).slice(0, 600))
} finally {
  try { if (g !== null) await g.close() } catch (e) { /* page already gone */ }
  server.close()
  try { copyFileSync(backup, profile); rmSync(backup, { force: true }) } catch (e) { /* no backup was made */ }
  if (probe.folder !== null) { try { rmSync(probe.folder, { recursive: true, force: true }) } catch (e) { /* kept */ } }
  restart({})
}
console.log(`\n${pass} ok, ${fail} failed. Screenshots in ${shotDir}`)
process.exit(fail === 0 ? 0 : 1)
