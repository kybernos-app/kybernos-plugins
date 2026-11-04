#!/usr/bin/env node
// Case J19-12 of docs/tests/user-journey: the modules that had no live check — Mermaid diagrams, reference chips, the activity log, the Bricks panel — in the real GUI of account
// A's sandbox, against the local replica's stand-in model. No real model, key or money is involved.
//
//   source "$KB_E2E_DIR/env.sh" && node scripts/check-uncovered-live.mjs     (KB_E2E_HOME_A / KB_E2E_HOST_A of the replica harness; no sandbox env: it changes HOME)
//
// One chat turn does the work of three modules: the stand-in answers with a text that holds a valid ```mermaid fence, a fence that cannot be drawn and a sentence with two
// links, then the checks read the page (the diagram card and its Code/Diagram switch, the error card with the parser's reason and the source kept, one chip per block of links with
// the link hidden and a card with the host, the address and « Open ») and Settings › Activity log (the call is listed, the body of the answer is not; the session title, made from the words said, is, and is printed as a NOTE).
// A second turn has the stand-in call the `animer_briques` tool, and the Bricks panel's route is read back. The database viewer is read on a small SQLite file the check
// makes in the sandbox's `kybers/` folder (and removes): the routes, the refusals (a write, two statements, a path), and the panel in the right sidebar.
// The conversation flow is read with a turn held open by the stand-in (`delay_ms`): two messages wait in the queue dock, a handle is on each, Alt+Up on the second puts it first, and the
// replies come in that order. The media player is read on a 0.2 s silent WAV the check writes in the chat's folder (and removes), opened from the Files sidebar.
// Exit 0 all green, 1 a check failed, 3 inconclusive (no replica, no composer).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { cwdOf, mainCalls, makeContext, openGui, sleep } from './e2e-teams/common.mjs'
import { goToSettingsPage, openSettings } from './live-page.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const READY = 'J19-12 answer ready'
const MARKER = 'J19-12 prompt marker'
const REPLY = [
  READY + '.',
  '',
  '```mermaid',
  'flowchart TD',
  '  A[Start] --> B{Choice}',
  '  B -->|yes| C[Done]',
  '  B -->|no| D[Stop]',
  '```',
  '',
  'Sources: [first page](https://example.com/one) and [second page](https://docs.example.org/two).',
  '',
  '```mermaid',
  'flowchart TD',
  '  A[Start] -->',
  '```',
].join('\n')
const LIMIT = 90000

let ctx
try { ctx = await makeContext() } catch (e) { console.error('○ inconclusive: ' + e.message); process.exit(3) }
const host = ctx.as('a')
let g
try { g = await openGui(host); await sleep(2500); await g.selectModel('GLM') } catch (e) { console.error('○ inconclusive: ' + e.message); process.exit(3) }
const startedAt = Date.now()
let wavPath = null
const read = (js) => g.val(js)
const mine = ctx.hostOf('a')
// A sandbox is a clone of the owner's profile, where he may have switched some modules off (`disabled: true` in cordis.patch.yml): a module that never loaded cannot be judged.
const loaded = await read(`performance.getEntriesByType('resource').map((e) => e.name).join(' ')`)
const missing = ['dsh-mermaid', 'kybernos-refs'].filter((m) => !String(loaded).includes(m))
if (missing.length > 0) { console.error('○ inconclusive: ' + missing.join(', ') + ' did not load in this sandbox (switched off in its profile: take the « disabled: true » line out of cordis.patch.yml and restart it, see scripts/soft-takeoff-freeze.mjs)'); process.exit(3) }

try {
  await ctx.engine({ text: REPLY, prompt: 3, completion: 4 })
  await g.send(MARKER)
  const answered = await g.until(async () => String(await g.body()).includes(READY), LIMIT, 500)
  if (!answered) { console.error('○ inconclusive: the stand-in did not answer within ' + LIMIT / 1000 + ' s'); process.exit(3) }
  // the diagram library is 3 MB and is loaded when the first fence is met: give the cards time to be drawn
  await g.until(async () => (await read(`document.querySelectorAll('.dsh-mermaid').length`)) >= 2, 25000, 300)
  await sleep(800)

  console.log('Mermaid')
  const cards = await read(`Array.from(document.querySelectorAll('.dsh-mermaid')).map((c) => ({ state: c.getAttribute('data-dsh-mermaid-state'), svg: c.querySelectorAll('svg').length, text: (c.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 300) }))`)
  const good = Array.isArray(cards) ? cards.find((c) => c.state !== 'error' && c.svg > 0) : undefined
  const bad = Array.isArray(cards) ? cards.find((c) => c.state === 'error') : undefined
  check('two diagram cards are drawn for the two fences', Array.isArray(cards) && cards.length === 2, cards)
  check('the valid fence is a card with an SVG drawing', good !== undefined, cards)
  check('the broken fence is a card in error that says why (the parser\'s words, no stack, no « undefined »)', bad !== undefined && bad.text.length > 20 && !/undefined|\[object|\bat \S+ \(/.test(bad.text), bad)
  const flipped = await read(`(() => { const c = document.querySelector('.dsh-mermaid:not([data-dsh-mermaid-state="error"])'); if (!c) return null; const b = Array.from(c.querySelectorAll('button')).find((x) => /^(code|diagram|diagramme)$/i.test((x.innerText || '').trim())); if (!b) return { button: false }; const before = (b.innerText || '').trim(); b.click(); return { button: true, before } })()`)
  check('the card has a Code / Diagram switch', flipped !== null && flipped !== undefined && flipped.button === true, flipped)
  if (flipped && flipped.button) {
    await sleep(600)
    const after = await read(`(() => { const c = document.querySelector('.dsh-mermaid:not([data-dsh-mermaid-state="error"])'); const b = c && Array.from(c.querySelectorAll('button')).find((x) => /^(code|diagram|diagramme)$/i.test((x.innerText || '').trim())); return b ? (b.innerText || '').trim() : null })()`)
    check('pressing it changes the label (the other view is offered)', typeof after === 'string' && after !== flipped.before, { before: flipped.before, after })
  }

  console.log('Reference chips')
  const chips = await read(`Array.from(document.querySelectorAll('.kyb-refs-chip')).map((c) => ({ text: (c.innerText || '').replace(/\\s+/g, ' ').trim(), href: c.getAttribute('href') || null }))`)
  check('the sentence with two links gets one chip (the chips sit at the end of the block)', Array.isArray(chips) && chips.length >= 1, chips)
  const hidden = await read(`Array.from(document.querySelectorAll('[data-kyb-replaced]')).length`)
  check('the original links are hidden behind the chip', typeof hidden === 'number' && hidden >= 2, hidden)
  if (Array.isArray(chips) && chips.length > 0) {
    await g.press('.kyb-refs-chip')
    await sleep(700)
    const card = await read(`(() => { const c = document.querySelector('.kyb-refs-card'); return c ? { text: (c.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 400), links: Array.from(c.querySelectorAll('a')).map((a) => a.getAttribute('href')) } : null })()`)
    check('pressing the chip opens a card with the host and the address of each link (the card is the way to open them)', card !== null && /example\.com/.test(card.text) && /docs\.example\.org/.test(card.text) && card.links.includes('https://example.com/one') && card.links.includes('https://docs.example.org/two'), card)
    await g.key('Escape', 'Escape', 27)
  }

  console.log('Activity log')
  const opened = await openSettings(g.page, { tries: 2 })
  if (opened) {
    const went = await goToSettingsPage(g.page, /^activity log$/i, { settleMs: 1500 })
    // the Settings dialog only: the sidebar behind it carries the chat's title, which is made from the answer
    const log = await read(`(() => { const d = Array.from(document.querySelectorAll('[role="dialog"]')).find((x) => /activity log/i.test(x.innerText || '')); return d ? d.innerText : '' })()`)
    check('the Activity log page opens from Settings', went === true && /activity log/i.test(String(log)), String(log).slice(0, 200))
    check('it lists the model call just made (a row with a model family or a token count)', /model|tokens|GLM|glm/i.test(String(log)), String(log).slice(0, 300))
    check('it holds metadata only: nothing of the answer\'s body (the diagram source, the links) is on the page', !/Choice|example\.org|example\.com|flowchart/.test(String(log)), null)
    // The page says « no message text », yet the session's title is kept and shown, and a title is made from the first message and then from the answer: said, not judged (UJ-44).
    if (String(log).includes(MARKER) || String(log).includes(READY)) console.log('  NOTE the log shows the words of the question and of the answer as the session title (UJ-44)')
    await g.key('Escape', 'Escape', 27)
  } else {
    check('Settings can be opened to read the Activity log', false, 'the Settings dialog did not open')
  }

  console.log('Database viewer')
  const kyberDir = join(process.env.KB_E2E_HOME_A, '.dsh', 'kybers', 'zz-j19-12')
  try {
    mkdirSync(kyberDir, { recursive: true })
    const db = new DatabaseSync(join(kyberDir, 'donnees.sqlite'))
    db.exec("CREATE TABLE clients (id INTEGER PRIMARY KEY, nom TEXT NOT NULL, ville TEXT); CREATE TABLE commandes (id INTEGER PRIMARY KEY, client_id INTEGER REFERENCES clients(id), total REAL); INSERT INTO clients (nom, ville) VALUES ('Alice', 'Lyon'), ('Bob', 'Nice'), ('Chloé', 'Lille'); INSERT INTO commandes (client_id, total) VALUES (1, 12.5), (1, 30), (2, 8)")
    db.close()
    const get = (path) => mine('GET', path)
    const bases = await get('/dsh-db-viewer/bases')
    const mineBase = bases && Array.isArray(bases.bases) ? bases.bases.find((b) => b.id === 'zz-j19-12') : undefined
    check('the database is listed with its tables and their row counts', mineBase !== undefined && mineBase.tables.some((t) => t.nom === 'clients' && t.compte === 3) && mineBase.tables.some((t) => t.nom === 'commandes' && t.compte === 3), bases)
    const schema = await get('/dsh-db-viewer/schema?base=zz-j19-12')
    check('the schema has the columns and the foreign key (commandes to clients)', schema && Array.isArray(schema.relations) && schema.relations.some((r) => r.parent === 'clients' && r.enfant === 'commandes'), schema)
    const rows = await get('/dsh-db-viewer/rows?base=zz-j19-12&table=clients&limit=2')
    check('the rows route returns the first rows asked for', rows && Array.isArray(rows.lignes) && rows.lignes.length === 2 && rows.compte === 3, rows)
    const q = await get('/dsh-db-viewer/query?base=zz-j19-12&sql=' + encodeURIComponent('SELECT c.nom, SUM(o.total) AS t FROM clients c JOIN commandes o ON o.client_id = c.id GROUP BY c.nom ORDER BY c.nom'))
    check('a SELECT with a join and a group answers', q && Array.isArray(q.lignes) && q.lignes.length === 2 && JSON.stringify(q.lignes).includes('42.5'), q)
    const refusals = [
      ['a write', "DELETE FROM clients", 'read-only'],
      ['two statements', 'SELECT 1; SELECT 2', 'one-statement'],
      ['an empty query', '', 'empty-query'],
    ]
    for (const [what, sql, code] of refusals) {
      const r = await get('/dsh-db-viewer/query?base=zz-j19-12&sql=' + encodeURIComponent(sql))
      check(`${what} is refused with the code « ${code} »`, r && r.code === code, r)
    }
    const after = await get('/dsh-db-viewer/rows?base=zz-j19-12&table=clients&limit=10')
    check('and nothing was written: the three clients are still there', after && after.compte === 3, after)
    const traversal = await get('/dsh-db-viewer/rows?base=' + encodeURIComponent('../../etc/passwd') + '&table=clients')
    check('a path in place of a database name is refused', traversal && (traversal.code === 'unknown-base' || /erreur|error/i.test(JSON.stringify(traversal))) && !('lignes' in traversal), traversal)

    // the panel: the right sidebar's « Start » list offers Databases (a fresh page, the Bricks panel of the turn above is not in the way)
    await g.reload()
    await read(`(() => { const b = document.querySelector('button[aria-label="Open right sidebar"]'); if (b) b.click() })()`)
    await sleep(1200)
    const opened = await g.pressText('Databases')
    await sleep(2500)
    const panel = String(await g.body())
    check('the Databases tab opens from the right sidebar and names the database', opened === true && /zz-j19-12/.test(panel), panel.slice(-300))
    check('its four views are offered (Diagram, Charts, Data, SQL)', /Diagram/.test(panel) && /Charts/.test(panel) && /Data/.test(panel) && /SQL/.test(panel), panel.slice(-300))
  } finally { rmSync(kyberDir, { recursive: true, force: true }) }

  console.log('Bricks')
  await ctx.script([{ name: 'animer_briques', arguments: { prompt: 'a small red house' } }], 0)
  await ctx.engine({ text: 'J19-12 bricks laid.', prompt: 2, completion: 2 })
  await g.send('J19-12 bricks please')
  await g.until(async () => String(await g.body()).includes('J19-12 bricks laid'), LIMIT, 500)
  await sleep(2000)
  const state = await mine('GET', '/kybernos-bricks/state')
  check('the Bricks route answers after the tool call', state !== null && typeof state === 'object', state)
  check('and holds an order for the session (a model, not an empty store)', state !== null && JSON.stringify(state).length > 40 && !/"error"/.test(JSON.stringify(state)), JSON.stringify(state).slice(0, 200))

  console.log('Conversation flow (queue)')
  await g.reload()
  await ctx.engine({ text: 'J19-12 queue reply.', prompt: 1, completion: 1, delay_ms: 12000 })
  await g.send('J19-12 q-one')
  await sleep(2500)
  await g.send('J19-12 q-two')
  await sleep(800)
  await g.send('J19-12 q-three')
  await sleep(1500)
  const dock = await g.until(() => g.exists('[data-queue-dock] button[aria-expanded]'), 8000)
  check('two messages sent while the turn runs wait in the queue dock', dock === true && /2 queued/i.test(String(await g.text('[data-queue-dock]'))), await g.text('[data-queue-dock]'))
  await g.press('[data-queue-dock] button[aria-expanded]')
  await sleep(800)
  const order = () => read(`Array.from(document.querySelectorAll('[data-queue-dock] li')).map((r) => r.innerText.replace(/\\s+/g, ' ').trim()).join('|')`)
  const handles = await read(`Array.from(document.querySelectorAll('[data-queue-dock] li')).map((r) => !!r.querySelector('[aria-label*="reorder"]'))`)
  check('each queued row has a reorder handle', Array.isArray(handles) && handles.length === 2 && handles.every((x) => x === true), handles)
  const before = await order()
  await read(`(() => { const h = document.querySelectorAll('[data-queue-dock] li')[1].querySelector('[aria-label*="reorder"]'); if (h) h.focus() })()`)
  for (const type of ['keyDown', 'keyUp']) await g.page.send('Input.dispatchKeyEvent', { type, key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, modifiers: 1 })
  await sleep(1500)
  const after = await order()
  check('Alt+Up on the second handle puts that message first', /q-two/.test(String(before).split('|')[0]) && /q-three/.test(String(after).split('|')[0]), { before, after })
  await g.until(async () => (String(await g.body()).match(/J19-12 queue reply\./g) || []).length >= 3, 90000, 1000)
  const text = String(await g.body())
  check('the replies come in the new order (q-three was answered before q-two)', text.lastIndexOf('J19-12 q-three') > -1 && text.lastIndexOf('J19-12 q-three') < text.lastIndexOf('J19-12 q-two'), { three: text.lastIndexOf('J19-12 q-three'), two: text.lastIndexOf('J19-12 q-two') })

  console.log('Media player')
  const cwd = cwdOf(mainCalls(ctx.rows(startedAt))[0])
  if (typeof cwd !== 'string' || cwd === '') check('the chat\'s folder is known (the first request of the turn names it)', false, cwd)
  else {
    // 0.2 s of silence: 8 kHz, mono, 8-bit PCM
    const data = Buffer.alloc(1600, 128)
    const h = Buffer.alloc(44)
    h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(8000, 24); h.writeUInt32LE(8000, 28); h.writeUInt16LE(1, 32); h.writeUInt16LE(8, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40)
    wavPath = join(cwd, 'j19-12-tone.wav')
    writeFileSync(wavPath, Buffer.concat([h, data]))
    // the sidebar may still hold the Bricks / Databases tabs of the sections above: a new tab shows the Start page
    await read(`(() => { const b = document.querySelector('button[aria-label="Open right sidebar"]'); if (b) b.click() })()`)
    await sleep(1200)
    await read(`(() => { const b = document.querySelector('button[aria-label="New tab"]'); if (b) b.click() })()`)
    await sleep(1200)
    const files = await g.pressText('Workspace files')
    await sleep(2000)
    if (files !== true) console.log('    (no « Workspace files » entry; the page ends with: ' + String(await g.body()).replace(/\\s+/g, ' ').slice(-300) + ')')
    const file = await g.pressText('j19-12-tone.wav')
    await sleep(2500)
    const player = await read(`JSON.stringify({ n: document.querySelectorAll('audio[controls]').length, duration: (document.querySelector('audio') || {}).duration, text: Array.from(document.querySelectorAll('audio')).map((a) => a.closest('div') && a.closest('div').parentElement.innerText.replace(/\\s+/g, ' ').slice(0, 120)).join(' ') })`)
    const p = typeof player === 'string' ? JSON.parse(player) : {}
    check('the Files sidebar lists the audio file and opens it', files === true && file === true, { files, file })
    check('it is a real player (an audio element with controls), not « Preview is not available »', p.n === 1 && !/not available/i.test(String(await g.body())), p)
    check('the player has loaded the file (a duration of about 0.2 s)', typeof p.duration === 'number' && p.duration > 0.1 && p.duration < 0.5, p)
    check('the file name, its size and « Open separately » are shown with it', /j19-12-tone\.wav/.test(p.text || '') && /KB|bytes|B\b/.test(p.text || '') && /Open separately/.test(p.text || ''), p)
  }
} finally {
  if (wavPath !== null) rmSync(wavPath, { force: true })
  try { await ctx.engine({ text: "Hello from the replica's stand-in model.", prompt: 1, completion: 1, delay_ms: 0 }) } catch (e) { /* the replica is gone */ }
  try { await g.live.close() } catch (e) { /* closed */ }
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}, ${pass} passed`)
process.exit(fail === 0 ? 0 : 1)
