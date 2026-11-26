#!/usr/bin/env node
// What THIS chat wrote to memory and lessons, read from the session journal: the pure parser behind the
// « Memory » pill's card. No browser, no dependency.
//
//   node packages/kybernos-sessions/test-journal.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const React = { createElement: () => null, useState: (v) => [v, () => {}], useEffect: () => {}, useRef: () => ({ current: null }), useCallback: (f) => f, useMemo: (f) => f(), Fragment: 'fragment' }
let definition = null
globalThis.window = { __ModuleLoader__: { load: (def) => { definition = def } } }
globalThis.document = { createElement: () => ({ style: {} }), head: { append() {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} }
new Function('window', SOURCE)(globalThis.window)
const mod = definition.factory((spec) => { if (spec === 'react') return React; throw new Error('unexpected require ' + spec) })
const parse = mod.__test.memoireDuJournal

const call = (name, args, id, t = '2026-10-04T10:00:00Z') => ({ type: 'tool/call', time: t, data: { name, callId: id, arguments: JSON.stringify(args) } })
const bash = (command, id, t) => call('bash', { command }, id, t)
const result = (id, code) => ({ type: 'tool/result', data: { message: { source: { callId: id } }, output: code === 0 ? 'ok' : '[exit code: ' + code + ']' } })

console.log('journal')
const empty = parse([])
check('an empty journal has nothing, and no lesson tool entry', empty.entrees.length === 0 && empty.souvenirs.length === 0 && empty.lessons.length === 0)
check('a result with no memory call changes nothing', parse([result('x', 0), { type: 'message' }]).souvenirs.length === 0)

const events = [
  call('memory_write', { content: 'prefers dark mode', kind: 'preference', pinned: true }, 'm1'),
  call('memory_write', { content: 'works on macOS', kind: 'fact' }, 'm2'),
  call('lesson_write', { text: 'a GET and a POST on one path collide', kind: undefined, kyber: 'dev-team', tags: ['routes', 'web'] }, 'l1'),
  call('lesson_write', { text: 'no kyber given' }, 'l2'),
  bash('node ~/.dsh/kybers/memory.cjs lesson --kyber audit --text "confirm a finding twice" --tags audit,grep', 'b1'),
  bash('node ~/.dsh/kybers/memory.cjs used --kyber audit --index 3', 'b2'),
  bash('node ~/.dsh/kybers/memory.cjs record --kyber audit --role auditeur --outcome success --note done', 'b3'),
  bash('ls -la', 'b4'),
  call('read_file', { path: '/x' }, 'r1'),
]
const r = parse(events)
check('memory_write calls are listed apart, with kind, text and pin', r.souvenirs.length === 2 && r.souvenirs[0].text === 'prefers dark mode' && r.souvenirs[0].kind === 'preference' && r.souvenirs[0].pinned === true && r.souvenirs[1].pinned === false)
check('they are NOT counted as kyber ledger entries', r.entrees.every((x) => x.type !== 'memory'))
check('lesson_write joins the lessons of this chat, in its kyber, with tags', r.lessons.some((l) => l.kyber === 'dev-team' && l.text === 'a GET and a POST on one path collide' && l.tags.join() === 'routes,web'))
check('lesson_write without a kyber lands in default', r.lessons.some((l) => l.kyber === 'default' && l.text === 'no kyber given'))
check('memory.cjs lesson / used / record are still read as before', r.lessons.some((l) => l.kyber === 'audit' && l.text === 'confirm a finding twice') && r.used.length === 1 && r.used[0].index === '3' && r.records.length === 1 && r.records[0].role === 'auditeur')
check('kybers touched by this chat are collected once each (the card\'s switcher)', JSON.stringify(r.kybers.slice().sort()) === JSON.stringify(['audit', 'default', 'dev-team']), r.kybers)
check('unrelated tools and shell commands are ignored', r.entrees.length === 5 && r.souvenirs.length === 2)

const failed = parse([bash('node ~/.dsh/kybers/memory.cjs lesson --kyber audit --text "lost"', 'f1'), result('f1', 2)])
check('a failed memory.cjs call is kept but not counted as written', failed.entrees.length === 1 && failed.entrees[0].ok === false && failed.lessons.length === 0)
const bad = parse([{ type: 'tool/call', data: { name: 'memory_write', callId: 'z', arguments: '{not json' } }])
check('unreadable arguments do not break the parse', bad.souvenirs.length === 1 && bad.souvenirs[0].text === '')

console.log('\n' + String(pass) + ' verifications, ' + String(fail) + ' failure(s)')
process.exit(fail === 0 ? 0 : 1)
