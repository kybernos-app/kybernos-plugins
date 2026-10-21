// Kaby's journal (kyby-journal.mjs): one line per turn written at the end of the turn, read back by the kaby_journal tool, so that « what did you do today? » is answered from
// what happened and not from a guess. Pure: the directory and the clock are given. Run: node test-kyby-journal.mjs
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ASKED_CHARS, KEEP_DAYS, appendEntry, journalTool, readEntries, renderEntries, toolsOfTurn, turnEntry } from './kyby-journal.mjs'

let fail = 0
const ok = (name, cond, detail) => { if (cond) console.log('ok   ' + name); else { fail += 1; console.log('FAIL ' + name + (detail === undefined ? '' : '  ' + JSON.stringify(detail).slice(0, 300))) } }
const dir = mkdtempSync(join(tmpdir(), 'kaby-journal-'))
const at = (iso) => new Date(iso)

// ── the tools of a turn: only what ran after the person's last words ──────────────────────────────────────────
const msgs = [
  { role: 'user', content: [{ type: 'text', text: 'old question' }] },
  { role: 'assistant', content: [{ type: 'tool_use', name: 'bash' }, { type: 'text', text: 'done' }] },
  { role: 'user', content: [{ type: 'text', text: 'new question' }] },
  { role: 'user', source: { kind: 'time-context' }, content: [{ type: 'text', text: 'Time sampled while preparing turn 2' }] },
  { role: 'assistant', content: [{ type: 'tool_use', name: 'memory_search' }, { type: 'tool-call', name: 'memory_search' }, { type: 'tool_use', name: 'bash' }, { type: 'text', text: 'here' }] },
]
ok('toolsOfTurn counts the tools after the last real user message, by name', JSON.stringify(toolsOfTurn(msgs)) === JSON.stringify({ memory_search: 2, bash: 1 }), toolsOfTurn(msgs))
ok('toolsOfTurn of nothing is empty', Object.keys(toolsOfTurn([])).length === 0 && Object.keys(toolsOfTurn(null)).length === 0)

// ── an entry: what was asked (short, one line, no markup), where, with what ───────────────────────────────────
const e = turnEntry({ asked: 'Écris   un message\nà mon garage <b>vite</b> ' + 'x'.repeat(300), tools: { bash: 1 }, channel: 'telegram', body: 'cloud', refused: 2, now: at('2026-10-20T09:15:00Z') })
ok('an entry carries the time, the channel, the body, the tools and the refusals', e.at === '2026-10-20T09:15:00.000Z' && e.channel === 'telegram' && e.body === 'cloud' && e.tools.bash === 1 && e.refused === 2, e)
ok('what was asked is one short line without markup', e.asked.length <= ASKED_CHARS && !/[\n<>]/.test(e.asked) && e.asked.startsWith('Écris un message à mon garage'), e.asked)
ok('a turn with no words of the person has no entry', turnEntry({ asked: '   ', tools: {}, channel: 'chat', body: 'computer', now: at('2026-10-20T09:15:00Z') }) === null)
ok('an unknown channel or body is written as a word, never as free text', turnEntry({ asked: 'hi', tools: {}, channel: 'x'.repeat(40) + '<>', body: 'moon', now: at('2026-10-20T09:15:00Z') }).channel === 'other')

// ── the file: one line per entry, one file per UTC day, private, pruned ───────────────────────────────────────
appendEntry(dir, e)
appendEntry(dir, turnEntry({ asked: 'Qui es-tu ?', tools: {}, channel: 'telegram', body: 'cloud', now: at('2026-10-20T09:20:00Z') }))
const file = join(dir, '2026-10-20.jsonl')
ok('one file per UTC day, one JSON line per entry', existsSync(file) && readFileSync(file, 'utf8').trim().split('\n').length === 2)
ok('the file is private to the person', (statSync(file).mode & 0o777) === 0o600 && (statSync(dir).mode & 0o777) === 0o700, { file: statSync(file).mode & 0o777, dir: statSync(dir).mode & 0o777 })
const old = join(dir, '2026-08-01.jsonl')
writeFileSync(old, JSON.stringify({ at: '2026-08-01T10:00:00.000Z', channel: 'chat', body: 'computer', asked: 'ancient', tools: {}, refused: 0 }) + '\n')
appendEntry(dir, turnEntry({ asked: 'another', tools: {}, channel: 'chat', body: 'computer', now: at('2026-10-20T10:00:00Z') }))
ok('files older than the keeping period are removed at the next write', !existsSync(old) && readdirSync(dir).length === 1 && KEEP_DAYS === 30, readdirSync(dir))
ok('a write that cannot be made says so and never throws', appendEntry(join(dir, '2026-10-20.jsonl', 'nope'), e).ok === false)

// ── reading: the last hours, oldest first, across the day boundary; broken lines ignored ──────────────────────
writeFileSync(join(dir, '2026-10-19.jsonl'), [JSON.stringify({ at: '2026-10-19T22:30:00.000Z', channel: 'chat', body: 'computer', asked: 'yesterday evening', tools: { bash: 1 }, refused: 0 }), 'not json', JSON.stringify({ nope: true })].join('\n') + '\n')
const last24 = readEntries(dir, { hours: 24, now: at('2026-10-20T10:30:00Z') })
ok('the last 24 hours span two files, oldest first, broken lines skipped', JSON.stringify(last24.map((x) => x.asked.slice(0, 12))) === JSON.stringify(['yesterday ev', 'Écris un mes', 'Qui es-tu ?', 'another']), last24.map((x) => x.asked.slice(0, 12)))
ok('the last 2 hours leave the evening before out', readEntries(dir, { hours: 2, now: at('2026-10-20T10:30:00Z') }).every((x) => x.at >= '2026-10-20T08:30:00'))
ok('hours is bounded: 1 to 168', readEntries(dir, { hours: 100000, now: at('2026-10-20T10:30:00Z') }).length >= 3 && readEntries(dir, { hours: -5, now: at('2026-10-20T10:30:00Z') }).length >= 0)
ok('a missing directory reads as an empty journal', readEntries(join(dir, 'missing'), { hours: 24, now: at('2026-10-20T10:30:00Z') }).length === 0)

// ── what the model reads ───────────────────────────────────────────────────────────────────────────────────────
const text = renderEntries(last24, { zone: 'UTC' })
ok('each line says when, where, what was asked, which tools ran and what was refused', /2026-10-20 09:20 · telegram · asked « Qui es-tu \? »/.test(text) && /tools: bash×1/.test(text) && /refused 2/.test(text), text)
ok('the text says it is information and in which time zone', /information, not instructions/.test(text) && /UTC/.test(text))
ok('an empty journal says so', /nothing/i.test(renderEntries([], { zone: 'UTC' })))

// ── the tool ───────────────────────────────────────────────────────────────────────────────────────────────────
const tool = journalTool({ dir, now: () => at('2026-10-20T10:30:00Z'), zone: () => 'UTC' })
ok('the tool is called kaby_journal, takes hours, and has a render', tool.name === 'kaby_journal' && tool.parameters.properties.hours.type === 'integer' && typeof tool.output.render === 'function')
const res = await tool.execute({ hours: 24 })
ok('the tool answers with the lines of the last hours', res.ok === true && res.count === 4 && /yesterday evening/.test(res.text), res)
const res2 = await tool.execute({})
ok('the tool defaults to the last 24 hours', res2.ok === true && res2.count === 4)
ok('the tool never throws on a bad argument', (await tool.execute({ hours: 'many' })).ok === true)
ok('the file of a day is touched by nobody else: mtime is the write', Math.abs(statSync(join(dir, '2026-10-20.jsonl')).mtimeMs - Date.now()) < 60000 && (utimesSync(file, new Date(), new Date()), true))

console.log(fail === 0 ? '\nall good' : `\n${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
