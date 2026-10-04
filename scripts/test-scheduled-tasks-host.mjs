// Test of the scheduled-tasks core: cron engine, time zones, one-time, store and
// trigger. It imports the KB-TASKS-CORE block of kybernos-plugin/index.js (the host
// plugin runs as a bundle with no relative imports, hence the extraction).
// Usage: node scripts/test-scheduled-tasks-host.mjs   (exit 0 = everything passes)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const src = readFileSync(root + 'packages/kybernos-plugin/index.js', 'utf8')
const m = src.match(/\/\/ KB-TASKS-CORE-BEGIN([\s\S]*?)\/\/ KB-TASKS-CORE-END/)
if (m === null) { console.error('BLOC KB-TASKS-CORE INTROUVABLE dans index.js'); process.exit(1) }
const mod = await import('data:text/javascript,' + encodeURIComponent(m[1] + '\nexport { kbParseTasksText, kbParseCron, kbNextCronAfter, kbComputeNextRun, kbSanitizeTaskInput, kbParseIsoLocal, kbZoneOffsetMinutes, kbMakeTaskStore, kbMakeTrigger }'))

let fails = 0
const eq = (label, got, want) => { const ok = got === want; if (!ok) { fails++; console.log('FAIL', label, '| got', got, '| want', want) } else console.log('ok  ', label) }

/* ── 1. Cron engine ─────────────────────────────────────────────────────── */
const now = Date.UTC(2026, 8, 21, 6, 0, 0) // Monday 21 Sept 2026, 08:00 Paris time
eq('monday strictly after -> next monday', new Date(mod.kbNextCronAfter('0 8 * * 1', now, 'Europe/Paris')).toISOString(), '2026-09-28T06:00:00.000Z')
eq('weekdays at 07:59 local -> today 08:00', new Date(mod.kbNextCronAfter('0 8 * * 1-5', now - 60000, 'Europe/Paris')).toISOString(), '2026-09-21T06:00:00.000Z')
eq('every-15min', new Date(mod.kbNextCronAfter('*/15 * * * *', now, 'Europe/Paris')).toISOString(), '2026-09-21T06:15:00.000Z')
eq('friday 16:00', new Date(mod.kbNextCronAfter('0 16 * * 5', now, 'Europe/Paris')).toISOString(), '2026-09-25T14:00:00.000Z')
eq('dom-or-dow Vixie OR (13th or friday)', new Date(mod.kbNextCronAfter('0 0 13 * 5', now, 'UTC')).toISOString(), '2026-09-25T00:00:00.000Z')
eq('invalid cron -> null', String(mod.kbNextCronAfter('99 99 99 99 99', now, 'UTC')), 'null')
eq('dow 7 wraps to sunday', String(mod.kbParseCron('0 8 * * 7').dow.has(0)), 'true')

/* ── 2. Time zones and clock changes (Europe/Paris 2026) ──────────────────── */
// Bascule printemps : sam 28 mars, 01:00 UTC → 03:00 locale (02:00 inexistante).
const springBefore = Date.UTC(2026, 2, 28, 5, 0) // samedi 05:00Z = 06:00 CET, avant 8h
eq('daily 8am on switch day fires 07:00Z (=08:00 CEST)', new Date(mod.kbNextCronAfter('0 8 * * *', springBefore, 'Europe/Paris')).toISOString(), '2026-03-28T07:00:00.000Z')
const gap = mod.kbNextCronAfter('30 2 * * *', springBefore, 'Europe/Paris')
// Le 28 mars à Paris, le mur 02:30 N'EXISTE PAS (01:59 CET → 03:00 CEST), et le
// 29 mars n'a pas non plus de 02:30 « +2 » : le premier vrai 02:30 est celui du
// 30 mars, désormais en CEST (+2) = 00:30Z. Attendu mesuré, pas deviné.
eq('impossible wall 02:30 skipped to first real occurrence', new Date(gap).toISOString(), '2026-03-30T00:30:00.000Z')
// Bascule automne : dim 25 oct., 01:00 UTC → 02:00 CEST puis 02:00 CET (heure doublée).
const fallBefore = Date.UTC(2026, 9, 25, 0, 0)
eq('doubled 02:30 fires FIRST occurrence only', new Date(mod.kbNextCronAfter('30 2 * * *', fallBefore, 'Europe/Paris')).toISOString(), '2026-10-25T00:30:00.000Z')

/* ── 3. One-time ─────────────────────────────────────────────────────────── */
eq('past once -> null', String(mod.kbComputeNextRun({ active: true, schedule: { mode: 'once', at: '2026-09-20T10:00' } }, now)), 'null')
eq('future once wall Paris (+2 CEST)', new Date(mod.kbComputeNextRun({ active: true, schedule: { mode: 'once', at: '2026-09-25T09:30' } }, now, 'Europe/Paris')).toISOString(), '2026-09-25T07:30:00.000Z')
eq('future once explicit offset +05:00', new Date(mod.kbComputeNextRun({ active: true, schedule: { mode: 'once', at: '2026-09-25T09:30+05:00' } }, now)).toISOString(), '2026-09-25T04:30:00.000Z')
eq('inactive task -> null', String(mod.kbComputeNextRun({ active: false, schedule: { mode: 'cron', cron: '* * * * *' } }, now)), 'null')
eq('bad once date -> null', String(mod.kbComputeNextRun({ active: true, schedule: { mode: 'once', at: 'pas une date' } }, now)), 'null')

/* ── 4. Form validation ────────────────────────────────────────────── */
eq('missing name rejected', String(mod.kbSanitizeTaskInput({ name: '', prompt: 'p' }).error), 'name required')
eq('missing prompt rejected', String(mod.kbSanitizeTaskInput({ name: 'a', prompt: '  ' }).error), 'prompt required')
eq('bad cron rejected', String(mod.kbSanitizeTaskInput({ name: 'a', prompt: 'b', schedule: { mode: 'cron', cron: '99 99 99 99 99' } }).error), 'cron invalide')
eq('bad once date rejected', String(mod.kbSanitizeTaskInput({ name: 'a', prompt: 'b', schedule: { mode: 'once', at: 'x' } }).error), 'date ponctuelle invalide')
const okIn = mod.kbSanitizeTaskInput({ name: ' a ', prompt: ' b ', schedule: { mode: 'cron', cron: '0  8 * * 1-5' } })
eq('valid input normalized', okIn.task.schedule.cron, '0 8 * * 1-5')
eq('runsOn forced local', okIn.task.runsOn, 'local')
eq('approvals defaults ask', okIn.task.approvals, 'ask')
eq('notify filtered', JSON.stringify(mod.kbSanitizeTaskInput({ name: 'a', prompt: 'b', notify: ['push', 'sms'] }).task.notify), '["push"]')

/* ── 5. Store: a file that cannot be trusted is never overwritten ─────────── */
// kbMakeTaskStore / kbMakeTrigger are the code production runs (index.js only gives them the
// real file access and the real session start), driven here with an in-memory file.
const memIo = (initial) => {
  const st = { text: initial, writes: 0, copies: [], failWrite: false, failWriteAfter: Infinity, failRead: false }
  const io = {
    async read() { if (st.failRead === true) throw new Error('EACCES: permission denied, open /secret/path'); return st.text },
    async write(t) { if (st.failWrite === true || st.writes >= st.failWriteAfter) throw new Error('ENOSPC: no space left on device'); st.writes += 1; st.text = t },
    async keepCopy(t) { st.copies.push(t) },
  }
  return { st, io }
}
const failure = async (fn) => { try { await fn(); return null } catch (e) { return e } }
const codeOf = (e) => (e === null ? 'none' : String(e.code))

{ // absent file
  const { st, io } = memIo(null)
  const store = mod.kbMakeTaskStore(io)
  eq('absent file reads as an empty list', JSON.stringify(await store.read()), '[]')
  await store.mutate(async () => {})
  eq('a no-op mutation does not create the file', st.writes, 0)
  await store.mutate(async (t) => { t.push({ id: 'a' }) })
  eq('first create writes once', st.writes, 1)
  eq('written text is the list', JSON.parse(st.text).length, 1)
}
for (const [label, text] of [['truncated JSON', '[{"id":"a","na'], ['object instead of a list', '{"tasks":[]}'], ['empty file', ''], ['trailing comma', '[{"id":"a"},]'], ['plain text', 'oops']]) {
  const { st, io } = memIo(text)
  const store = mod.kbMakeTaskStore(io)
  const err = await failure(() => store.mutate(async (t) => { t.push({ id: 'new' }) }))
  eq('corrupt (' + label + '): mutation refused', codeOf(err), 'tasks-corrupt')
  eq('corrupt (' + label + '): file untouched', st.text, text)
  eq('corrupt (' + label + '): nothing written', st.writes, 0)
  eq('corrupt (' + label + '): a copy is kept', st.copies.length, 1)
  eq('corrupt (' + label + '): a plain read refuses too', codeOf(await failure(() => store.read())), 'tasks-corrupt')
  eq('corrupt (' + label + '): a plain read keeps no extra copy', st.copies.length, 1)
}
{ // BOM is harmless, unreadable is refused with a message that carries no path
  const bom = memIo('\ufeff[{"id":"a"}]')
  eq('BOM-prefixed list is read', (await mod.kbMakeTaskStore(bom.io).read()).length, 1)
  const un = memIo('[]'); un.st.failRead = true
  const err = await failure(() => mod.kbMakeTaskStore(un.io).mutate(async (t) => { t.push({ id: 'x' }) }))
  eq('unreadable file: refused', codeOf(err), 'tasks-unreadable')
  eq('unreadable file: message carries no path', String(err.message).indexOf('/secret') < 0, true)
  eq('unreadable file: nothing written', un.st.writes, 0)
}
{ // unchanged -> no write; failures never poison the queue; a failed write keeps the old file
  const { st, io } = memIo(JSON.stringify([{ id: 'a' }]))
  const store = mod.kbMakeTaskStore(io)
  await store.mutate(async () => {})
  eq('unchanged list is not rewritten', st.writes, 0)
  const boom = await failure(() => store.mutate(async () => { throw new Error('boom') }))
  eq('a throwing callback rejects', String(boom.message), 'boom')
  await store.mutate(async (t) => { t.push({ id: 'b' }) })
  eq('the queue survives a failure', JSON.parse(st.text).length, 2)
  st.failWrite = true
  const before = st.text
  eq('failed write is reported', String((await failure(() => store.mutate(async (t) => { t.push({ id: 'c' }) }))).message).startsWith('ENOSPC'), true)
  eq('failed write leaves the previous file', st.text, before)
}
{ // concurrent mutations are serialized: none is lost
  const { st, io } = memIo(null)
  const store = mod.kbMakeTaskStore(io)
  await Promise.all(Array.from({ length: 25 }, (_, i) => store.mutate(async (t) => { await new Promise((r) => setTimeout(r, 1)); t.push({ id: 'c' + i }) })))
  eq('25 concurrent creates are all kept', JSON.parse(st.text).length, 25)
}

/* ── 6. Trigger: claim, fire, record ──────────────────────────────────────── */
const T0 = Date.UTC(2026, 9, 5, 8, 0, 0)
const dueTask = (o) => Object.assign({ id: 't1', name: 'A', prompt: 'p', schedule: { mode: 'cron', cron: '0 8 * * *', tz: 'UTC' }, active: true, nextRun: new Date(T0 - 1000).toISOString(), history: [] }, o)
const rig = (tasks, over) => {
  const m = memIo(tasks === null ? null : JSON.stringify(tasks))
  const store = mod.kbMakeTaskStore(m.io)
  const fired = []; const errors = []
  const trigger = mod.kbMakeTrigger(Object.assign({ store, now: () => T0, fire: async (t) => { fired.push(t.id); return { sessionId: 's-' + t.id } }, onError: (msg) => errors.push(msg) }, over || {}))
  return { m, store, trigger, fired, errors }
}
{ // the normal path
  const r = rig([dueTask()])
  const a = await r.trigger.tick()
  eq('tick fires the due task', a.fired, 1)
  const saved = JSON.parse(r.m.st.text)[0]
  eq('history holds the fired run', saved.history[0].status + ':' + saved.history[0].sessionId, 'fired:s-t1')
  eq('lastRun is set', saved.lastRun !== undefined && saved.lastRun !== null, true)
  eq('nextRun moved to the next 08:00', saved.nextRun, '2026-10-06T08:00:00.000Z')
  eq('second tick is idle', (await r.trigger.tick()).fired, 0)
  eq('an idle tick writes nothing', r.m.st.writes, 2)
}
{ // a failed bookkeeping write can no longer start the same run again
  const r = rig([dueTask()])
  r.m.st.failWriteAfter = 1 // the claim is written, the record is not
  const a = await r.trigger.tick()
  eq('run started once', a.fired, 1)
  eq('the failed record is reported', r.errors.some((e) => e.startsWith('record:')), true)
  r.m.st.failWriteAfter = Infinity
  eq('no second run after the write failure', (await r.trigger.tick()).fired, 0)
  eq('fire was called once', r.fired.length, 1)
}
{ // nothing fires when the claim cannot be saved; the error is logged once
  const r = rig([dueTask()])
  r.m.st.failWrite = true
  await r.trigger.tick(); await r.trigger.tick(); await r.trigger.tick()
  eq('no fire when the claim fails', r.fired.length, 0)
  eq('same tick error logged once', r.errors.length, 1)
}
{ // a corrupt file: nothing fires, nothing is written, one log line
  const r = rig(null)
  r.m.st.text = '[{"id":"t1","act'
  await r.trigger.tick(); await r.trigger.tick()
  eq('corrupt store: nothing fires', r.fired.length, 0)
  eq('corrupt store: file untouched', r.m.st.text, '[{"id":"t1","act')
  eq('corrupt store: one log line', r.errors.length, 1)
}
{ // a task paused (or deleted) before the claim is not fired; edits made before it are used
  const r = rig([dueTask({ id: 'p' }), dueTask({ id: 'd' }), dueTask({ id: 'e', prompt: 'old' })])
  await r.store.mutate(async (t) => { t[0].active = false; t.splice(1, 1); t[1].prompt = 'new' })
  const seen = []
  const trig = mod.kbMakeTrigger({ store: r.store, now: () => T0, fire: async (t) => { seen.push(t.id + ':' + t.prompt); return { sessionId: 's' } }, onError: () => {} })
  await trig.tick()
  eq('paused and deleted tasks are not fired, the fresh prompt is used', seen.join(','), 'e:new')
}
{ // one-time tasks fire once and switch off
  const r = rig([dueTask({ id: 'o', schedule: { mode: 'once', tz: 'UTC', at: '2026-10-05T07:00' } })])
  await r.trigger.tick(); await r.trigger.tick()
  const saved = JSON.parse(r.m.st.text)[0]
  eq('once task fired once', r.fired.length, 1)
  eq('once task is deactivated', saved.active + ':' + saved.nextRun, 'false:null')
}
{ // a failing fire is recorded and does not spin
  const r = rig([dueTask()], { fire: async () => { throw new Error('session service refused') } })
  const a = await r.trigger.tick()
  const saved = JSON.parse(r.m.st.text)[0]
  eq('failure counted', a.failed, 1)
  eq('failure recorded in the history', saved.history[0].status + ':' + saved.history[0].error, 'error:session service refused')
  eq('nextRun moved on after a failure', saved.nextRun, '2026-10-06T08:00:00.000Z')
}
{ // a session service that never answers does not freeze the scheduler
  const r = rig([dueTask({ id: 'h' }), dueTask({ id: 'k' })], { fireTimeoutMs: 40, fire: async (t) => (t.id === 'h' ? new Promise(() => {}) : { sessionId: 'ok' }) })
  const a = await r.trigger.tick()
  const saved = JSON.parse(r.m.st.text)
  eq('hung fire times out, the next task still runs', a.fired + ':' + a.failed, '1:1')
  eq('timeout is recorded', String(saved[0].history[0].error).startsWith('timed out'), true)
  eq('the scheduler is free again', (await r.trigger.tick()).skipped, undefined)
}
{ // a task deleted while it fires is not brought back; a second tick during a tick is skipped
  const r = rig([dueTask({ id: 'x' })])
  let inner = null
  const trig = mod.kbMakeTrigger({ store: r.store, now: () => T0, fire: async (t) => { inner = await trigger2.tick(); await r.store.mutate(async (all) => { all.splice(0, all.length) }); return { sessionId: 's' } }, onError: () => {} })
  const trigger2 = trig
  await trig.tick()
  eq('overlapping tick is skipped', String(inner.skipped), 'busy')
  eq('task deleted during the fire stays deleted', r.m.st.text, '[]')
}

{ // a task paused or deleted by the time its turn comes (earlier tasks take a while) is not fired
  const r = rig([dueTask({ id: 'a' }), dueTask({ id: 'b', prompt: 'old' }), dueTask({ id: 'c' })])
  const seen = []
  const trig = mod.kbMakeTrigger({ store: r.store, now: () => T0, onError: () => {}, fire: async (t) => {
    seen.push(t.id + ':' + t.prompt)
    if (t.id === 'a') await r.store.mutate(async (all) => { all.find((x) => x.id === 'b').prompt = 'new'; all.find((x) => x.id === 'c').active = false })
    return { sessionId: 's' }
  } })
  await trig.tick()
  eq('paused during the tick: not fired; edited during the tick: new prompt', seen.join(','), 'a:p,b:new')
  const r2 = rig([dueTask({ id: 'a' }), dueTask({ id: 'b' })])
  const seen2 = []
  const trig2 = mod.kbMakeTrigger({ store: r2.store, now: () => T0, onError: () => {}, fire: async (t) => { seen2.push(t.id); if (t.id === 'a') await r2.store.mutate(async (all) => { all.splice(1, 1) }); return { sessionId: 's' } } })
  await trig2.tick()
  eq('deleted during the tick: not fired and not brought back', seen2.join(',') + '|' + JSON.parse(r2.m.st.text).map((x) => x.id).join(','), 'a|a')
}

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURES')
process.exit(fails === 0 ? 0 : 1)
