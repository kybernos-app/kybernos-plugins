// Test of the shipped `automation-creator` skill: its frontmatter, and the script it tells the
// agent to run. The script is taken out of SKILL.md (the fenced bash block) and RUN with sh, on a
// temporary DSH_HOME and a different HOME, exactly as an agent would run it.
//   (cd packages/kybernos-plugin && node test-automation-creator.mjs)   exit 0 = everything passes
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SKILL = join(HERE, 'skills', 'automation-creator', 'SKILL.md')
let failed = 0
let total = 0
const check = (name, ok, detail) => {
  total += 1
  console.log((ok ? '  ok  ' : '  FAIL ') + name + (ok || detail === undefined ? '' : '  | ' + detail))
  if (!ok) failed += 1
}

const text = readFileSync(SKILL, 'utf8')

console.log('the file')
{
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)
  check('it has a frontmatter', fm !== null)
  const fields = {}
  for (const line of (fm === null ? '' : fm[1]).split('\n')) { const m = /^([A-Za-z]+):\s*(.*)$/.exec(line); if (m !== null) fields[m[1]] = m[2] }
  check('name is the folder name, a valid skill name', fields.name === 'automation-creator' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.name))
  check('description says what it does and when to use it', typeof fields.description === 'string' && fields.description.length > 80 && /Use when/.test(fields.description))
  check('whenToUse is there', typeof fields.whenToUse === 'string' && fields.whenToUse.length > 20)
  check('it is written in English (no accented letters, it is read by the agent)', /[éèêàùçôîâû]/.test(text) === false)
  check('it never tells the agent to start from an empty list', /start from \[\]|pars de \[\]/i.test(text) === false)
  check('it tells the agent to stop when the task file is damaged', /not valid JSON/.test(text) && /do not repair or replace it/.test(text))
}

const block = /```bash\n(node --input-type=module - [^\n]*<<'JS'\n[\s\S]*?\nJS)\n```/.exec(text)
check('the fenced script is there', block !== null)
if (block === null) { console.log('\n' + failed + ' FAILURES'); process.exit(1) }

const root = mkdtempSync(join(tmpdir(), 'kb-autocreator-'))
let n = 0
// One world: a DSH_HOME, a DIFFERENT home with a decoy .dsh, a spec file, the command.
const world = (spec, tasksText, extraEnv) => {
  n += 1
  const dsh = join(root, 'dsh' + n)
  const decoy = join(root, 'decoy' + n)
  mkdirSync(join(decoy, '.dsh', 'kybernos'), { recursive: true })
  if (tasksText !== undefined) { mkdirSync(join(dsh, 'kybernos'), { recursive: true }); writeFileSync(join(dsh, 'kybernos', 'tasks.json'), tasksText) }
  const specFile = join(root, 'spec' + n + '.json')
  writeFileSync(specFile, typeof spec === 'string' ? spec : JSON.stringify(spec))
  const script = join(root, 'run' + n + '.sh')
  writeFileSync(script, block[1].replace('/tmp/automation-spec.json', specFile))
  const env = Object.assign({}, process.env, { DSH_HOME: dsh, HOME: decoy }, extraEnv || {})
  const file = join(dsh, 'kybernos', 'tasks.json')
  const run = () => spawnSync('sh', [script], { env, encoding: 'utf8' })
  return { dsh, decoy, file, specFile, script, env, run, tasks: () => JSON.parse(readFileSync(file, 'utf8')), decoyTouched: () => readdirSync(join(decoy, '.dsh', 'kybernos')).length > 0 }
}
const out = (r) => { try { return JSON.parse(r.stdout.trim().split('\n').pop()) } catch (e) { return { ok: null, raw: r.stdout + r.stderr } } }
const base = { name: 'Weekly product report', prompt: '1. Collect the changes\n2. Summarise them', schedule: { mode: 'cron', cron: '0 8 * * 1', tz: 'Europe/Paris' } }

console.log('a schedule')
{
  const w = world(base)
  const r = w.run(); const o = out(r)
  check('it saves and says so', r.status === 0 && o.ok === true && typeof o.id === 'string', r.stdout + r.stderr)
  const t = w.tasks()
  check('one task, the one asked for', t.length === 1 && t[0].name === base.name && t[0].prompt === base.prompt && t[0].schedule.cron === '0 8 * * 1' && t[0].schedule.tz === 'Europe/Paris')
  check('it starts active, local, asking first, with the fields the page reads', t[0].active === true && t[0].runsOn === 'local' && t[0].approvals === 'ask' && Array.isArray(t[0].history) && t[0].lastRun === null)
  check('nextRun is left empty: the scheduler adopts it', t[0].nextRun === null)
  check('the id has the shape the host uses', /^st-[0-9a-z]+-[0-9a-f]{6}$/.test(t[0].id))
  check('the file is private (0600)', (statSync(w.file).mode & 0o777) === 0o600)
  check('no temporary file is left behind', readdirSync(join(w.dsh, 'kybernos')).join() === 'tasks.json')
  check('it wrote under DSH_HOME and not under the other HOME', w.decoyTouched() === false)
  check('there is no webhook unless asked', t[0].trigger === undefined && o.hookUrl === null)
}
{
  const w = world(Object.assign({}, base, { schedule: { mode: 'cron', cron: '30 9 * * 1-5' } }))
  const r = w.run()
  check('no zone given: the machine zone', r.status === 0 && w.tasks()[0].schedule.tz === Intl.DateTimeFormat().resolvedOptions().timeZone)
}
{
  const w = world(base, JSON.stringify([{ id: 'old', name: 'kept', extra: { deep: [1, 2] }, history: [{ at: 'x' }] }]))
  w.run()
  const t = w.tasks()
  check('it appends and keeps everything already there, field for field', t.length === 2 && JSON.stringify(t[0]) === JSON.stringify({ id: 'old', name: 'kept', extra: { deep: [1, 2] }, history: [{ at: 'x' }] }))
}
{
  const w = world(base, '﻿[]')
  const r = w.run()
  check('a list with a byte order mark is read, like the scheduler does', r.status === 0 && w.tasks().length === 1)
}
{
  const w = world(base)
  const home = join(root, 'tilde-home' + n); mkdirSync(home)
  const r = spawnSync('sh', [w.script], { env: Object.assign({}, w.env, { DSH_HOME: '~/zz-dsh', HOME: home }), encoding: 'utf8' })
  check('"~/" in DSH_HOME is expanded like DSH does', r.status === 0 && existsSync(join(home, 'zz-dsh', 'kybernos', 'tasks.json')), r.stdout + r.stderr)
  const noEnv = Object.assign({}, w.env, { HOME: join(root, 'plain-home' + n) }); delete noEnv.DSH_HOME
  mkdirSync(noEnv.HOME)
  const r2 = spawnSync('sh', [w.script], { env: noEnv, encoding: 'utf8' })
  check('without DSH_HOME it is <home>/.dsh', r2.status === 0 && existsSync(join(noEnv.HOME, '.dsh', 'kybernos', 'tasks.json')))
}

console.log('one date and webhook')
{
  const w = world({ name: 'Board deck', prompt: '1. Build the deck', schedule: { mode: 'once', at: '2999-12-15T09:00', tz: 'Europe/Paris' }, approvals: 'auto', notify: ['push', 'push', 'sms'] })
  const r = w.run()
  const t = w.tasks()[0]
  check('one-time: date and zone are kept', r.status === 0 && t.schedule.mode === 'once' && t.schedule.at === '2999-12-15T09:00' && t.schedule.cron === undefined)
  check('approvals auto and a clean notify list', t.approvals === 'auto' && JSON.stringify(t.notify) === '["push"]')
}
{
  const w = world({ name: 'Stripe alerts', prompt: '1. Read the event', schedule: { mode: 'webhook' } }, undefined, { DSH_WEB_PORT: '3091' })
  const r = w.run(); const o = out(r)
  const t = w.tasks()[0]
  check('webhook only: no cron, no date', r.status === 0 && t.schedule.mode === 'webhook' && t.schedule.cron === undefined && t.schedule.at === undefined)
  check('it carries a trigger the host recognises (hk_ + 12 hex, 32 hex secret)', t.trigger.type === 'webhook' && /^hk_[0-9a-f]{12}$/.test(t.trigger.hookId) && /^[0-9a-f]{32}$/.test(t.trigger.secret))
  check('it prints the URL in the format the route expects', o.hookUrl === 'http://127.0.0.1:3091/kybernos/hooks?hook=' + t.trigger.hookId + '&secret=' + t.trigger.secret)
  const w2 = world(Object.assign({}, base, { webhook: true }))
  w2.run()
  const t2 = w2.tasks()[0]
  check('webhook: true adds a URL to a schedule and keeps the cron', t2.schedule.mode === 'cron' && t2.trigger.type === 'webhook')
}

console.log('what it refuses (and leaves the file as it was)')
for (const [label, tasksText, code] of [
  ['a truncated task file', '[{"id":"a","na', 4],
  ['a task file that is an object', '{"tasks":[]}', 4],
  ['an empty task file', '', 4],
  ['a task file with a trailing comma', '[{"id":"a"},]', 4],
]) {
  const w = world(base, tasksText)
  const r = w.run(); const o = out(r)
  check(label + ': refused with exit ' + code + ' and a reason that says to tell the user', r.status === code && o.ok === false && /Tell the user/.test(o.error), r.stdout + r.stderr)
  check(label + ': the file is byte for byte what it was', readFileSync(w.file, 'utf8') === tasksText)
}
{
  const w = world(base, '[]')
  chmodSync(w.file, 0o000)
  const r = w.run()
  chmodSync(w.file, 0o600)
  check('an unreadable task file: nothing is written', (r.status === 3 || process.getuid() === 0) && readFileSync(w.file, 'utf8') === '[]')
}
for (const [label, patch] of [
  ['an empty name', { name: '  ' }],
  ['a name over 120 characters', { name: 'x'.repeat(121) }],
  ['an empty prompt', { prompt: '' }],
  ['a prompt over 8000 characters', { prompt: 'x'.repeat(8001) }],
  ['an unknown schedule mode', { schedule: { mode: 'weekly' } }],
  ['a cron with an empty element ("1,")', { schedule: { mode: 'cron', cron: '0 8 * * 1,' } }],
  ['a cron out of range', { schedule: { mode: 'cron', cron: '99 99 * * *' } }],
  ['a cron with letters', { schedule: { mode: 'cron', cron: '5abc * * * *' } }],
  ['a cron with four fields', { schedule: { mode: 'cron', cron: '0 8 * *' } }],
  ['a cron with a step of zero', { schedule: { mode: 'cron', cron: '*/0 * * * *' } }],
  ['an unknown time zone', { schedule: { mode: 'cron', cron: '0 8 * * *', tz: 'Mars/Phobos' } }],
  ['a date that does not exist', { schedule: { mode: 'once', at: '2999-02-31T09:00' } }],
  ['a date in the past', { schedule: { mode: 'once', at: '2001-01-01T09:00' } }],
  ['a date in the wrong format', { schedule: { mode: 'once', at: '15/12/2999 9h' } }],
]) {
  const w = world(Object.assign({}, base, patch))
  const r = w.run(); const o = out(r)
  check(label + ': refused, nothing created', r.status === 2 && o.ok === false && typeof o.error === 'string' && existsSync(w.file) === false, r.stdout + r.stderr)
}
{
  const w = world('{ not json')
  const r = w.run()
  check('a specification that is not JSON is refused', r.status === 2 && out(r).ok === false)
  const w2 = world('[1,2]')
  check('a specification that is not an object is refused', w2.run().status === 2)
  const w3 = world(base); rmSync(w3.specFile)
  check('a missing specification file is refused', w3.run().status === 2 && existsSync(w3.file) === false)
}

console.log('changing an automation that exists (« Edit in chat », V-19)')
const stored = (extra) => Object.assign({ id: 'st-abc-123456', createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z', history: [{ at: '2026-10-12T06:00:00.000Z', sessionId: 's-1', status: 'fired' }], lastRun: '2026-10-12T06:00:00.000Z', nextRun: '2026-10-19T06:00:00.000Z', name: 'Weekly product report', prompt: '1. Collect', schedule: { mode: 'cron', cron: '0 8 * * 1', tz: 'Europe/Paris' }, runsOn: 'local', active: true, approvals: 'ask', notify: [] }, extra || {})
{
  const w = world(Object.assign({}, base, { id: 'st-abc-123456', name: 'Weekly report (edited)', schedule: { mode: 'cron', cron: '30 9 * * 1-5', tz: 'Europe/Paris' }, approvals: 'auto' }), JSON.stringify([stored(), { id: 'other', name: 'other' }]))
  const r = w.run(); const o = out(r)
  const t = w.tasks()
  check('it says it changed an automation, and which', r.status === 0 && o.ok === true && o.edited === true && o.id === 'st-abc-123456', r.stdout + r.stderr)
  check('the automation is replaced where it stands: same id, same place, nothing appended', t.length === 2 && t[0].id === 'st-abc-123456' && t[1].id === 'other')
  check('its name, steps, schedule and approvals are the new ones', t[0].name === 'Weekly report (edited)' && t[0].prompt === base.prompt && t[0].schedule.cron === '30 9 * * 1-5' && t[0].approvals === 'auto')
  check('its creation date, history and last run are kept', t[0].history.length === 1 && t[0].createdAt === '2026-10-01T08:00:00.000Z' && t[0].lastRun === '2026-10-12T06:00:00.000Z' && t[0].id === 'st-abc-123456')
  check('the next run is left empty: the scheduler computes it for the new schedule', t[0].nextRun === null)
  check('it stays on', t[0].active === true)
  check('the other automation is untouched, field for field', JSON.stringify(t[1]) === JSON.stringify({ id: 'other', name: 'other' }))
  check('the file is private and no temporary file is left behind', (statSync(w.file).mode & 0o777) === 0o600 && readdirSync(join(w.dsh, 'kybernos')).join() === 'tasks.json')
}
{
  const w = world(Object.assign({}, base, { id: 'st-abc-123456' }), JSON.stringify([stored({ active: false, trigger: { type: 'webhook', hookId: 'hk_aaaaaaaaaaaa', secret: 's'.repeat(32) } })]))
  const r = w.run()
  const t = w.tasks()[0]
  check('a paused automation stays paused and keeps its webhook (the secret is not printed)', t.active === false && t.trigger.hookId === 'hk_aaaaaaaaaaaa' && out(r).hookUrl === null)
}
{
  const w = world(Object.assign({}, base, { id: 'st-abc-123456', active: false }), JSON.stringify([stored()]))
  w.run()
  check('"active": false pauses it', w.tasks()[0].active === false)
}
{
  const w = world(Object.assign({}, base, { id: 'st-abc-123456', schedule: { mode: 'once', at: '2999-12-15T09:00', tz: 'UTC' } }), JSON.stringify([stored({ active: false, schedule: { mode: 'once', at: '2001-01-01T09:00', tz: 'UTC' } })]))
  w.run()
  check('a one-time automation that already ran and got a new date is on again (it switched itself off when it ran)', w.tasks()[0].active === true && w.tasks()[0].schedule.at === '2999-12-15T09:00')
  const w2 = world(Object.assign({}, base, { id: 'st-abc-123456' }), JSON.stringify([stored({ active: false, history: [] })]))
  w2.run()
  check('...but one the user paused stays paused', w2.tasks()[0].active === false)
}
{
  const before = JSON.stringify([stored()])
  const w = world(Object.assign({}, base, { id: 'st-nope' }), before)
  const r = w.run()
  check('an id that does not exist: nothing is written, and no new automation is made in its place', r.status === 2 && out(r).ok === false && /no automation/.test(out(r).error) && readFileSync(w.file, 'utf8') === before, r.stdout + r.stderr)
}
for (const bad of ['../../etc', 'a b', '', 42, { x: 1 }]) {
  const w = world(Object.assign({}, base, { id: bad }), JSON.stringify([stored()]))
  check('an id that is not an id is refused: ' + JSON.stringify(bad), w.run().status === 2 && JSON.parse(readFileSync(w.file, 'utf8')).length === 1)
}
{
  const w = world(Object.assign({}, base, { id: 'st-abc-123456', schedule: { mode: 'webhook' } }), JSON.stringify([stored()]))
  const r = w.run()
  const t = w.tasks()[0]
  check('turned into a webhook-only automation: it gets the webhook it did not have', r.status === 0 && t.schedule.mode === 'webhook' && t.trigger.type === 'webhook' && /^http:\/\/127\.0\.0\.1:\d+\/kybernos\/hooks\?hook=hk_/.test(out(r).hookUrl))
}

console.log('a schedule that runs more often than every 5 minutes needs the user\'s yes (A5-24)')
for (const [cron, fine] of [['* * * * *', false], ['*/2 * * * *', false], ['*/4 * * * *', false], ['0,3 8 * * *', false], ['59,1 0,23 * * *', false], ['*/5 * * * *', true], ['0 * * * *', true], ['0 8 * * *', true], ['0 8 * * 1', true]]) {
  const w = world(Object.assign({}, base, { schedule: { mode: 'cron', cron } }))
  const r = w.run()
  check('"' + cron + '" ' + (fine ? 'is saved' : 'is refused without a confirmation, and nothing is written'), fine ? r.status === 0 : (r.status === 2 && /confirm/.test(out(r).error) && existsSync(w.file) === false), r.stdout + r.stderr)
}
{
  const w = world(Object.assign({}, base, { schedule: { mode: 'cron', cron: '* * * * *' }, confirmedFrequent: true }))
  const r = w.run()
  check('confirmed by the user ("confirmedFrequent": true): saved, and the flag is not stored', r.status === 0 && w.tasks()[0].schedule.cron === '* * * * *' && w.tasks()[0].confirmedFrequent === undefined)
}
{
  const w = world(Object.assign({}, base, { id: 'st-abc-123456', name: 'Renamed', schedule: { mode: 'cron', cron: '* * * * *', tz: 'Europe/Paris' } }), JSON.stringify([stored({ schedule: { mode: 'cron', cron: '* * * * *', tz: 'Europe/Paris' } })]))
  check('renaming an every-minute automation does not ask again', w.run().status === 0 && w.tasks()[0].name === 'Renamed')
  const w2 = world(Object.assign({}, base, { id: 'st-abc-123456', schedule: { mode: 'cron', cron: '*/2 * * * *', tz: 'Europe/Paris' } }), JSON.stringify([stored()]))
  const r2 = w2.run()
  check('...but making a weekly one run every 2 minutes does', r2.status === 2 && /confirm/.test(out(r2).error) && w2.tasks()[0].schedule.cron === '0 8 * * 1')
}

console.log('one writer at a time: nothing is lost')
{
  const w = world(base, '[]')
  const N = 10
  const runs = await Promise.all(Array.from({ length: N }, (_, i) => new Promise((resolve) => {
    const spec = join(root, 'par' + i + '.json')
    writeFileSync(spec, JSON.stringify(Object.assign({}, base, { name: 'parallel ' + i })))
    const p = spawn('sh', ['-c', block[1].replace('/tmp/automation-spec.json', spec)], { env: w.env })
    let so = ''
    p.stdout.on('data', (d) => { so += d })
    p.on('close', (code) => resolve({ code, so }))
  })))
  const saved = runs.filter((r) => r.code === 0).map((r) => JSON.parse(r.so.trim().split('\n').pop()).id)
  const onDisk = w.tasks().map((t) => t.id)
  check('ten writers at once: every one of them succeeds', saved.length === N, runs.map((r) => r.code).join())
  check('...and every task they reported is in the file, once', saved.every((id) => onDisk.includes(id)) && onDisk.length === N && new Set(onDisk).size === N, saved.length + ' saved, ' + onDisk.length + ' on disk')
  check('nothing but tasks.json is left in the folder (no temporary file, no lock)', readdirSync(join(w.dsh, 'kybernos')).join() === 'tasks.json')
}
{
  // the lock is released after a refusal too
  const w = world(base, '[{"id":"a"')
  w.run()
  check('the lock is released after a refusal', existsSync(w.file + '.lock') === false)
  const w2 = world(Object.assign({}, base, { name: '' }), '[]')
  w2.run()
  check('...and after a refused specification', existsSync(w2.file + '.lock') === false)
}
{
  // a lock left behind by a crash (older than 20 s) is broken
  const w = world(base, '[]')
  mkdirSync(w.file + '.lock')
  const old = new Date(Date.now() - 60000)
  utimesSync(w.file + '.lock', old, old)
  const r = w.run()
  check('a stale lock is broken and the task is saved', r.status === 0 && w.tasks().length === 1 && existsSync(w.file + '.lock') === false, r.stdout + r.stderr)
}
{
  // a fresh lock held by somebody else is respected: it waits, then gives up without writing
  const w = world(base, '[]')
  mkdirSync(w.file + '.lock')
  const t0 = Date.now()
  const r = w.run()
  check('a lock held by another writer: it waits, then gives up with exit 5 and writes nothing', r.status === 5 && out(r).ok === false && /another process/.test(out(r).error) && readFileSync(w.file, 'utf8') === '[]', r.stdout + r.stderr)
  check('...after waiting a few seconds, not forever', Date.now() - t0 >= 2500 && Date.now() - t0 < 10000, String(Date.now() - t0))
  check('...and it leaves the other writer\'s lock alone', existsSync(w.file + '.lock') === true)
  rmSync(w.file + '.lock', { recursive: true })
  check('once the lock is gone, the same run succeeds', w.run().status === 0 && w.tasks().length === 1)
}

rmSync(root, { recursive: true, force: true })
console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILURES') + ' (' + total + ' checks)')
process.exit(failed === 0 ? 0 : 1)
