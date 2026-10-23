#!/usr/bin/env node
/** The tab « Where it runs » of an automation (client.js): its pure rules, its words, and the order of what it does (never two copies of an automation running).
 *  Usage: node packages/kybernos-plugin/test-where-it-runs.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const cli = readFileSync(join(here, 'client.js'), 'utf8')

// 1. the pure rules, run as they are in the page
const from = cli.indexOf('// <kbwr-core>')
const to = cli.indexOf('// </kbwr-core>')
assert.ok(from > 0 && to > from, 'the rules are where the test looks for them')
const mod = await import('data:text/javascript,' + encodeURIComponent(cli.slice(from, to) + '\nexport { kbwDirty, kbwCount, kbwBlock, kbwPhase, kbwDefaultPick, kbwDefinition }'))
const HOME = '3f2a1c10-0000-4000-8000-000000000001'
const PROS = '3f2a1c10-0000-4000-8000-000000000002'
const linkedTask = (o) => ({ id: 'st-1', name: 'Collecteur', prompt: 'Collect', schedule: { mode: 'cron', cron: '0 3 * * *', tz: 'UTC' }, approvals: 'auto', active: false, updatedAt: '2026-10-23T10:00:00.000Z', cloud: { computerId: HOME, name: 'Home', at: '2026-10-23T10:00:00.000Z', wasActive: true }, ...(o || {}) })

assert.equal(mod.kbwDirty(linkedTask()), false, 'the link and the task share a moment: nothing is edited')
assert.equal(mod.kbwDirty(linkedTask({ updatedAt: '2026-10-23T10:00:00.900Z' })), false, 'under a second of slack')
assert.equal(mod.kbwDirty(linkedTask({ updatedAt: '2026-10-23T10:05:00.000Z' })), true, 'edited after it was sent')
for (const odd of [null, undefined, {}, { id: 'x', updatedAt: 'now' }, linkedTask({ updatedAt: 'never' }), linkedTask({ cloud: { at: 'never' } }), linkedTask({ cloud: null })]) assert.equal(mod.kbwDirty(odd), false, JSON.stringify(odd))
assert.equal(mod.kbwCount([linkedTask(), linkedTask({ id: 'st-2' }), linkedTask({ id: 'st-3', cloud: { computerId: PROS, name: 'P', at: 'x' } }), { id: 'st-4' }, null, 'x'], HOME), 2)
assert.equal(mod.kbwCount(null, HOME), 0)
const computers = [{ id: PROS, name: 'Prospection', isHome: false, state: 'asleep' }, { id: HOME, name: 'Home', isHome: true, state: 'awake' }]
assert.equal(mod.kbwBlock(linkedTask({ approvals: 'auto' }), computers, true), null)
assert.equal(mod.kbwBlock(linkedTask({ approvals: 'ask' }), computers, true), 'ask', 'an automation that asks first cannot go')
assert.equal(mod.kbwBlock(linkedTask({ approvals: undefined }), computers, true), 'ask')
assert.equal(mod.kbwBlock(linkedTask(), computers, false), 'off')
assert.equal(mod.kbwBlock(linkedTask(), [], true), 'none')
assert.equal(mod.kbwBlock(linkedTask({ approvals: 'ask' }), [], false), 'ask', 'the reason that cannot be changed here is said first')
for (const odd of [null, undefined, 'x']) assert.equal(mod.kbwBlock(odd, computers, true), 'none')
assert.equal(mod.kbwPhase(null, true), 'sending')
assert.equal(mod.kbwPhase(null, false), 'pending', 'not listed yet: waiting for the computer')
assert.equal(mod.kbwPhase({ state: 'pending', schedule: null }, false), 'pending')
assert.equal(mod.kbwPhase({ state: 'error', code: 'too_frequent', schedule: null }, false), 'error')
assert.equal(mod.kbwPhase({ state: 'applied', schedule: null }, false), 'checking', 'applied, but the computer has not reported its schedule yet')
assert.equal(mod.kbwPhase({ state: 'applied', schedule: { enabled: true } }, false), 'running')
assert.equal(mod.kbwPhase({ state: 'applied', schedule: { enabled: true } }, true), 'sending', 'while the page is sending, it is sending')
assert.equal(mod.kbwDefaultPick(computers), HOME, 'Home first')
assert.equal(mod.kbwDefaultPick([{ id: PROS, isHome: false }]), PROS)
assert.equal(mod.kbwDefaultPick([]), null)
assert.equal(mod.kbwDefaultPick(null), null)
assert.deepEqual(mod.kbwDefinition(linkedTask({ workspaceHint: 'ws', homeSessionId: 's', notify: ['email'], needs: ['gmail'], id: 'st-1' }), true), { name: 'Collecteur', prompt: 'Collect', schedule: { mode: 'cron', cron: '0 3 * * *', tz: 'UTC' }, active: true, approvals: 'auto', needs: ['gmail'] }, 'six fields, and active is what it was before it was linked')
assert.equal(mod.kbwDefinition(linkedTask(), false).active, false)
assert.equal('needs' in mod.kbwDefinition(linkedTask({ needs: [] }), true), false)
ok('rules: dirty, count, why it cannot go, the phase of what was sent, the default computer, the six fields')

// 2. the words: both languages, no key defined twice anywhere, every key used is defined
const keys = Array.from(cli.matchAll(/^      '([A-Za-z0-9_.\-]+)': \{ kybernos: '((?:[^'\\]|\\.)*)', en: '((?:[^'\\]|\\.)*)' \},?$/gm)).map((m) => m[1])
const seen = new Map()
for (const k of keys) seen.set(k, (seen.get(k) || 0) + 1)
assert.deepEqual(Array.from(seen).filter(([, n]) => n > 1).map(([k]) => k), [], 'a key defined twice: the later one wins and hides the earlier (this is how « kbw.back » hid a button label)')
const mine = Array.from(seen.keys()).filter((k) => k.indexOf('kbwr.') === 0)
assert.ok(mine.length >= 55, 'my keys: ' + mine.length)
const used = new Set(Array.from(cli.matchAll(/'(kbwr\.[A-Za-z0-9_.]+)'/g)).map((m) => m[1]).filter((k) => !k.endsWith('.')))
for (const k of used) assert.ok(seen.has(k), 'used but not defined: ' + k)
for (const code of ['approval_path_missing', 'run_hours_exhausted', 'owner_left', 'budget', 'failed_runs', 'owner_locked', 'computer_deleting', 'too_many_pending', 'rate_limited', 'tasks_unavailable', 'not_allowed', 'no_computer', 'unreachable', 'not_connected', 'invalid_definition', 'too_frequent', 'never_runs', 'expired']) assert.ok(seen.has('kbwr.err.' + code), 'a refusal with no words: ' + code)
for (const reason of ['ask', 'none', 'off']) assert.ok(seen.has('kbwr.block.' + reason), reason)
assert.ok(/'tasks\.tab\.where': \{ kybernos: 'Où ça tourne', en: 'Where it runs' \}/.test(cli))
ok('words: both languages, nothing defined twice, every key used is defined, every refusal has words')

// 3. the order of what the tab does: never two copies of an automation running
const comp = cli.slice(cli.indexOf('const KbWhereTab = '), cli.indexOf('// What a row of the List says about a run'))
const body = (name) => { const i = comp.indexOf('const ' + name + ' = async'); assert.ok(i > 0, name); return comp.slice(i, comp.indexOf('\n  }\n', i)) }
const before = (src, a, b, label) => { const x = src.indexOf(a); const y = src.indexOf(b); assert.ok(x > 0 && y > 0 && x < y, label) }
const publish = body('publish')
before(publish, "props.link({ computerId: to.id", "kbwPost(to.id, [{ op: 'put'", 'publish: the copy here is paused BEFORE the definition is sent')
assert.ok(/if \(r\.ok !== true\) \{ await props\.link\(null\); fail\(r\.error\) \}/.test(publish), 'publish: a refusal brings the copy here back')
const back = body('back')
before(back, "kbwPost(linked.computerId, [{ op: 'delete'", 'await props.link(null)', 'back: taken away from the computer BEFORE the copy here comes back')
assert.ok(/if \(d\.ok !== true && d\.error !== 'no_computer'\) \{ fail\(d\.error\); return finish\(\) \}/.test(back), 'back: if it cannot be taken away, nothing changes')
const move = body('move')
before(move, "kbwPost(to.id, [{ op: 'put'", 'await props.link({ computerId: to.id', 'move: put on the new one, then link')
before(move, 'await props.link({ computerId: to.id', "kbwPost(from.computerId, [{ op: 'delete'", 'move: the old copy is removed last')
assert.ok(/if \(r\.ok !== true\) \{ fail\(r\.error\); return finish\(\) \}/.test(move), 'move: if the new one refuses, the old one stays')
const update = body('update')
before(update, "kbwPost(linked.computerId, [{ op: 'put'", 'props.link({ computerId: linked.computerId', 'update: send, then date the link')
ok('order: pause before sending, take away before bringing back, put on the new before removing from the old')

// 4. the tab is on the page
assert.ok(/h\(KbWhereTab, \{ key: t\.id, task: t, computers: computersPair\[0\]\.list, connected: computersPair\[0\]\.connected === true, tasks: tasks,/.test(cli), 'the tab gets the computers and the tasks')
assert.ok(/action: 'cloud-link', id: t\.id, cloud/.test(cli), 'the link goes through the task store')
assert.ok(/'data-kb': 'tab-where', onClick: \(\) => setTab\('where'\) \}, kbt\('tasks\.tab\.where'\)/.test(cli), 'a tab next to Workflow and Sessions')
assert.ok(/kbt\('kbwr\.runson'\)\.replace\('\{name\}', \(\) => String\(t\.cloud\.name\)\)/.test(cli), 'the header says where it runs')
assert.ok(/fetch\('\/kybernos-cloud\/computers\/publish', \{ method: 'POST', credentials: 'same-origin'/.test(cli), 'publishing goes through the cloud plugin, with the browser session')
assert.ok(!/className: '[^']*\bkbw-/.test(comp) && !/'kbw\.[a-z]/.test(comp), 'the tab uses no class and no string key under the name another page already uses (kbw)')
assert.ok(/\.kbwr-seg\{/.test(cli) && /\.kbwr-opt\{/.test(cli), 'its styles are under kbwr-')
assert.ok(/lastLabel = kbt\(kbwDirty\(t\) === true \? 'kbwr\.row\.cloudDirty' : 'kbwr\.row\.cloud'\)\.replace\('\{name\}', \(\) => String\(t\.cloud\.name\)\); lastCls = kbwDirty\(t\) === true \? 'cloudwarn' : 'cloud' \}\s+else if \(t\.active === false\) \{ lastLabel = kbt\('tasks\.paused'\)/.test(cli), 'in the list, an automation that lives in the cloud is not « Paused »: it says where it is, and when it was changed since')
assert.ok(/'data-kb': 'row-cloud'/.test(cli) && /kbt\('kbwr\.row\.sub'\)/.test(cli), 'the list marks it with a cloud and « Cloud · Home » under the name')
ok('page: a tab, the computers and tasks handed over, the link through the task store, the header, the session on the write')

console.log('\n' + pass + ' checks passed')
