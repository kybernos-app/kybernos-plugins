// Kaby's wake-ups (kyby-heartbeat.mjs, kyby-heartbeat-store.mjs, kyby-heartbeat-run.mjs): what is signed, when a wake-up is due, what holds it back, how one starts and ends. No network, no DSH:
// a temporary home and a fake session controller.
//   node packages/kybernos-cloud/test-kyby-heartbeat.mjs
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHOICES, HEARTBEAT_HEAD, IDLE_MS, PRESETS, REQUEST_PREFIX, TRIGGER_TEXT, WAKE_NEVER, describe, dueNow, inForce, inQuiet, nextDueAt, presetOf, readRequest, sign, verify, wakeText } from './kyby-heartbeat.mjs'
import { createHeartbeatStore } from './kyby-heartbeat-store.mjs'
import { createHeartbeat } from './kyby-heartbeat-run.mjs'

let fail = 0
const ok = (name, cond, detail) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(detail))); if (!cond) fail++ }

const SECRET = Buffer.alloc(32, 7)
const OTHER = Buffer.alloc(32, 9)
const at = (h, m = 0, day = 2) => new Date(2026, 10, day, h, m, 0, 0).getTime()
const HOUR = 3600 * 1000
const Q = { quiet: true, quietFrom: '22:00', quietTo: '08:00' }
const fieldsOf = (preset, extra = {}) => ({ ...PRESETS[preset], ...Q, paused: false, ...extra })
const signed = (fields, secret = SECRET, when = at(9)) => sign(fields, secret, when).record

// ── the request, checked ─────────────────────────────────────────────────────────────────────────────
ok('four presets, the off one switches nothing on', Object.keys(PRESETS).join() === 'off,light,regular,steady' && PRESETS.off.on === false && PRESETS.regular.everyHours === 4 && PRESETS.regular.boxMin === 10 && PRESETS.regular.items === 2)
ok('a preset fills the fields and keeps the quiet hours', (() => { const r = readRequest({ preset: 'steady' }, null); return r.ok && r.fields.on === true && r.fields.everyHours === 2 && r.fields.boxMin === 20 && r.fields.items === 3 && r.fields.quiet === true && r.fields.quietFrom === '22:00' })())
ok('an unknown preset, a prototype key, a bad type and a non-object are refused', readRequest({ preset: 'x' }, null).error === 'unknown_preset' && readRequest({ preset: '__proto__' }, null).ok === false && readRequest({ on: 'yes' }, null).error === 'invalid_on' && readRequest('x', null).ok === false && readRequest([], null).ok === false && readRequest(null, null).ok === false)
ok('only the offered choices are accepted', readRequest({ everyHours: 3 }, null).error === 'invalid_everyHours' && readRequest({ boxMin: 7 }, null).error === 'invalid_boxMin' && readRequest({ items: 4 }, null).error === 'invalid_items' && readRequest({ items: 2.5 }, null).ok === false && CHOICES.everyHours.every((n) => readRequest({ everyHours: n }, null).ok))
ok('quiet hours are HH:MM, and never from and to the same minute', readRequest({ quietFrom: '25:00' }, null).error === 'invalid_quietFrom' && readRequest({ quietTo: '8:00' }, null).error === 'invalid_quietTo' && readRequest({ quietFrom: '08:00' }, null).error === 'invalid_quiet' && readRequest({ quiet: false, quietFrom: '08:00' }, null).ok === true)
ok('a request over the current record changes only what it names', (() => { const r = readRequest({ boxMin: 20 }, signed(fieldsOf('regular'))); return r.ok && r.fields.on === true && r.fields.everyHours === 4 && r.fields.boxMin === 20 && r.fields.items === 2 })())
ok('numbers that match no preset are « custom »', presetOf(PRESETS.regular) === 'regular' && presetOf({ ...PRESETS.regular, boxMin: 20 }) === 'custom')

// ── the signature ────────────────────────────────────────────────────────────────────────────────────
ok('nothing can be signed without the machine secret', sign(fieldsOf('regular'), null, at(9)).error === 'cannot_sign' && sign(fieldsOf('regular'), Buffer.alloc(0), at(9)).ok === false)
ok('a signed record verifies with its own secret only', verify(signed(fieldsOf('regular')), SECRET).ok === true && verify(signed(fieldsOf('regular')), OTHER).why === 'altered' && verify(signed(fieldsOf('regular')), null).why === 'no_secret')
ok('one changed field voids it', (() => { const r = signed(fieldsOf('light')); return ['on', 'paused', 'quiet'].every((k) => verify({ ...r, [k]: !r[k] }, SECRET).why === 'altered') && verify({ ...r, everyHours: 2 }, SECRET).why === 'altered' && verify({ ...r, quietTo: '09:00' }, SECRET).why === 'altered' && verify({ ...r, signedAt: '2030-01-01T00:00:00.000Z' }, SECRET).why === 'altered' })())
ok('a record that is not ours is unreadable, never trusted', ['none', null, undefined, 3, [], {}, { v: 2 }, { ...signed(fieldsOf('regular')), v: 0 }, { ...signed(fieldsOf('regular')), on: 'true' }, { ...signed(fieldsOf('regular')), everyHours: 5 }, { ...signed(fieldsOf('regular')), quietFrom: 'x' }, { ...signed(fieldsOf('regular')), sig: 5 }].every((r) => verify(r, SECRET).ok === false))
ok('a signature that is not hex is refused without throwing', verify({ ...signed(fieldsOf('regular')), sig: 'zz' }, SECRET).ok === false)

// ── in force ─────────────────────────────────────────────────────────────────────────────────────────
ok('in force: signed, on, not paused', inForce(signed(fieldsOf('regular')), SECRET).ok === true)
ok('not in force: off, paused, void, none', inForce(signed(fieldsOf('off')), SECRET).why === 'off' && inForce(signed(fieldsOf('regular', { paused: true })), SECRET).why === 'paused' && inForce({ ...signed(fieldsOf('regular')), on: false }, SECRET).why === 'altered' && inForce(null, SECRET).why === 'none')

// ── quiet hours (the machine's local time, a plage may cross midnight) ────────────────────────────────
const regular = signed(fieldsOf('regular'))
ok('22:00 to 08:00 crosses midnight', inQuiet(regular, at(23, 40)) && inQuiet(regular, at(3)) && inQuiet(regular, at(22, 0)) && !inQuiet(regular, at(8, 0)) && !inQuiet(regular, at(12)) && !inQuiet(regular, at(21, 59)))
ok('a plage inside one day, and none when switched off', inQuiet(signed(fieldsOf('regular', { quietFrom: '13:00', quietTo: '14:00' })), at(13, 30)) && !inQuiet(signed(fieldsOf('regular', { quietFrom: '13:00', quietTo: '14:00' })), at(14, 0)) && !inQuiet(signed(fieldsOf('regular', { quiet: false })), at(23)))

// ── when the next wake-up is due ─────────────────────────────────────────────────────────────────────
ok('one interval after the signature when there has been none', nextDueAt(regular, SECRET, {}, at(9)) === at(13))
ok('one interval after the last wake-up', nextDueAt(regular, SECRET, { lastAt: at(10, 30) }, at(11)) === at(14, 30))
ok('a due time inside the quiet hours is pushed to their end, the next morning', nextDueAt(regular, SECRET, { lastAt: at(19) }, at(20)) === at(8, 0, 3) && nextDueAt(regular, SECRET, { lastAt: at(23, 30) }, at(23, 40)) === at(8, 0, 3) && nextDueAt(regular, SECRET, { lastAt: at(1, 0, 3) }, at(2, 0, 3)) === at(8, 0, 3))
ok('no next wake-up when none is in force', nextDueAt(signed(fieldsOf('off')), SECRET, {}, at(9)) === null && nextDueAt(null, SECRET, {}, at(9)) === null)
ok('due once the time has come, not before', dueNow(regular, SECRET, {}, at(13)).due === true && dueNow(regular, SECRET, {}, at(12, 59)).why === 'not_yet')
ok('a late wake-up is due once, however late (a sleeping computer owes nothing in a burst)', dueNow(regular, SECRET, { lastAt: at(9) }, at(13) + 30 * HOUR).due === true && nextDueAt(regular, SECRET, { lastAt: at(13) + 30 * HOUR }, at(13) + 30 * HOUR) > at(13) + 30 * HOUR)
ok('held back: quiet hours, the person\'s last words, a record not in force', dueNow(regular, SECRET, { lastAt: at(0) }, at(23)).why === 'quiet' && dueNow(regular, SECRET, { lastAt: at(1), lastPersonAt: at(14, 0) - IDLE_MS + 60000 }, at(14, 0)).why === 'person_active' && dueNow(regular, SECRET, { lastAt: at(1), lastPersonAt: at(14, 0) - IDLE_MS }, at(14, 0)).due === true && dueNow(signed(fieldsOf('off')), SECRET, {}, at(14)).why === 'off' && dueNow(regular, OTHER, {}, at(14)).why === 'altered')

// ── what Kaby is told ────────────────────────────────────────────────────────────────────────────────
ok('no block without wake-ups in force', wakeText(null, SECRET, false) === '' && wakeText(signed(fieldsOf('off')), SECRET, true) === '' && wakeText(signed(fieldsOf('regular', { paused: true })), SECRET, false) === '' && wakeText(regular, OTHER, false) === '')
ok('the standing block says where the list lives and carries only the rhythm', (() => { const t = wakeText(regular, SECRET, false); return t.startsWith(HEARTBEAT_HEAD) && /every 4 hours/.test(t) && /todo\.md/.test(t) && t.split('\n').length === 3 })())
ok('the wake-up block carries the time box and the number of points, and forbids sending, publishing and paying', (() => { const t = wakeText(signed(fieldsOf('steady')), SECRET, true); return /20 minutes/.test(t) && /3 oldest points/.test(t) && /Never send, publish, pay/.test(t) && /ONE short message/.test(t) })())
ok('the trigger is a note, not an instruction, and the denied tools are the ones nobody can answer or that would schedule', !/do |read |send/i.test(TRIGGER_TEXT) && WAKE_NEVER.includes('ask_user_question') && WAKE_NEVER.includes('schedule_create') && !WAKE_NEVER.includes('memory_write'))
ok('the page sees the record, when the next one is due and how the last one ended, never the signature', (() => { const v = describe(regular, SECRET, { lastAt: at(9), lastOutcome: 'done' }, at(10)); return v.inForce && v.preset === 'regular' && v.nextAt === new Date(at(13)).toISOString() && v.lastAt === new Date(at(9)).toISOString() && v.lastOutcome === 'done' && v.canSign && v.quietNow === false && !('sig' in v) && JSON.stringify(v).indexOf(regular.sig) < 0 })())
ok('a void record shows as off, with the reason', (() => { const v = describe({ ...regular, on: false }, SECRET, {}, at(10)); return v.inForce === false && v.why === 'altered' && v.on === false && v.preset === 'off' && v.nextAt === null })())

// ── the store: files, the Settings request, the state ────────────────────────────────────────────────
const home = mkdtempSync(join(tmpdir(), 'kyby-heartbeat-'))
let clock = at(9)
const store = createHeartbeatStore({ home: () => home, secret: () => SECRET, now: () => clock })
ok('with no file nothing is in force', store.view().inForce === false && store.view().why === 'none' && store.active() === null && store.due().due === false)
ok('the first request signs a record, mode 0600, and starts the clock', (() => { const r = store.set({ preset: 'regular' }); const mode = statSync(store.files.record()).mode & 0o777; return r.ok && r.view.inForce && r.view.nextAt === new Date(at(13)).toISOString() && mode === 0o600 })())
ok('a second request changes only what it names, and signs again', (() => { clock = at(10); const r = store.set({ boxMin: 5 }); return r.ok && r.view.everyHours === 4 && r.view.boxMin === 5 && r.view.preset === 'custom' })())
ok('a bad request writes nothing', (() => { const before = readFileSync(store.files.record(), 'utf8'); const r = store.set({ everyHours: 5 }); return r.ok === false && r.error === 'invalid_everyHours' && readFileSync(store.files.record(), 'utf8') === before })())
ok('a file edited by hand is void, the page says so, nothing starts', (() => { const raw = JSON.parse(readFileSync(store.files.record(), 'utf8')); writeFileSync(store.files.record(), JSON.stringify({ ...raw, everyHours: 2 }) + '\n'); const v = store.view(); const ok1 = v.inForce === false && v.why === 'altered' && store.active() === null; store.set({ preset: 'regular' }); return ok1 && store.view().inForce === true })())
ok('a file that is not JSON is no record', (() => { writeFileSync(store.files.record(), 'nope'); const v = store.view(); store.set({ preset: 'regular' }); return v.inForce === false && v.why === 'none' })())
ok('a store with no secret cannot sign and shows it', (() => { const s = createHeartbeatStore({ home: () => home, secret: () => null, now: () => clock }); const r = s.set({ preset: 'regular' }); return r.ok === false && r.error === 'cannot_sign' && s.view().canSign === false && s.active() === null })())
ok('the state keeps when a wake-up started and how it ended', (() => { store.started(at(13)); const running = store.view().running === true; store.ended('done', { manual: false }); const v = store.view(); return running && v.lastOutcome === 'done' && v.running === false && v.lastAt === new Date(at(13)).toISOString() })())
ok('an outcome that is not a known word is written as an error', (() => { store.ended('<script>'); return store.view().lastOutcome === 'error' })())
ok('a wake-up left « running » by a stopped DSH is settled as interrupted', (() => { store.started(at(14)); store.settleStale(); return store.view().lastOutcome === 'interrupted' })())
ok('the person\'s words are kept, and hold a wake-up back for half an hour', (() => { clock = at(18, 30); store.personSpoke(at(18, 20)); const held = store.due().why; store.personSpoke(at(15)); return held === 'person_active' && store.due().due === true })())
ok('the prompt block follows the record and is not read twice in a second', (() => { clock = at(19); const a = store.text(false); const b = store.text(true); const s2 = createHeartbeatStore({ home: () => mkdtempSync(join(tmpdir(), 'kyby-heartbeat-')), secret: () => SECRET, now: () => clock }); return /every 4 hours/.test(a) && /10 minutes/.test(b) && s2.text(false) === '' })())
ok('the audit says what was signed and what ran, with no signature', (() => { const lines = readFileSync(store.files.audit(), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); return lines.some((l) => l.kind === 'signed') && lines.some((l) => l.kind === 'started') && lines.some((l) => l.kind === 'ended' && l.outcome === 'done') && !/"sig":/.test(JSON.stringify(lines)) })())

// ── the runner: a fake session controller ────────────────────────────────────────────────────────────
const macro = () => new Promise((resolve) => setImmediate(resolve))
const SID = 'session-kaby-chat-1'
function fake (over = {}) {
  const sc = {
    calls: [],
    st: { cursor: 3, active: true, running: false, queue: [], pendingInput: [] },
    async prompt (req) { sc.calls.push(['prompt', req]); if (over.prompt) return over.prompt(req, sc); sc.st.running = true; return { accepted: true } },
    async state () { sc.calls.push(['state']); if (over.state) return over.state(sc); return { ...sc.st } },
    async wait (req, signal) {
      sc.calls.push(['wait', req])
      if (over.wait) return over.wait(req, signal, sc)
      sc.st.running = false
      return { reason: 'idle', state: { ...sc.st }, output: [] }
    },
    async cancel (req) { sc.calls.push(['cancel', req]); sc.st.running = false; return { accepted: true } }
  }
  return sc
}
function rig (scOver, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kyby-heartbeat-run-'))
  // Signed at 09:00, so the first wake-up is due at 13:00; the test then stands at 13:05.
  let now = at(9)
  const st = createHeartbeatStore({ home: () => dir, secret: () => SECRET, now: () => now })
  st.set({ preset: 'regular', ...(opts.request ?? {}) })
  now = at(13, 5)
  const sc = fake(scOver)
  const hb = createHeartbeat({ store: st, controller: () => sc, pointer: () => (opts.pointer === undefined ? SID : opts.pointer), isDesktop: () => opts.desktop !== false, now: () => now, sleep: macro, pollMs: 5, graceMs: 50, settleMs: 200 })
  return { st, sc, hb, setNow: (t) => { now = t }, dir }
}

{
  const r = rig()
  const out = await r.hb.tick()
  ok('a due wake-up sends one note into Kaby\'s own chat, waits for its end and records it', out === 'done' && r.sc.calls.filter((c) => c[0] === 'prompt').length === 1)
  const p = r.sc.calls.find((c) => c[0] === 'prompt')[1]
  ok('the message is the fixed trigger, queued, with the wake-up\'s id', p.sessionId === SID && p.mode === 'queue' && p.content[0].text === TRIGGER_TEXT && p.requestId.startsWith(REQUEST_PREFIX))
  ok('the wait is bounded by the time box (10 minutes)', r.sc.calls.find((c) => c[0] === 'wait')[1].timeoutMs === 10 * 60 * 1000)
  ok('the state says it ended, and nothing is marked running any more', r.st.view().lastOutcome === 'done' && r.hb.runningSession() === null && r.hb.isWake(SID) === false)
  ok('it does not start again at once', (await r.hb.tick()) === 'not_yet')
}
{
  let seenMarked = null
  const r = rig({ prompt: (req, sc) => { seenMarked = r.hb.isWake(SID); sc.st.running = true; return { accepted: true } } })
  await r.hb.tick()
  ok('the wake-up is marked BEFORE its message is queued (the first tool call must find it)', seenMarked === true)
}
{
  const r = rig()
  r.setNow(at(23, 0))
  ok('quiet hours hold a due wake-up back', (await r.hb.tick()) === 'quiet' && r.sc.calls.every((c) => c[0] !== 'prompt'))
}
{
  const r = rig()
  r.st.personSpoke(at(13, 0))
  ok('the person\'s last words, a quarter of an hour ago, hold it back', (await r.hb.tick()) === 'person_active')
}
{
  const r = rig({ state: (sc) => ({ ...sc.st, running: true }) })
  ok('a turn that is running holds it back', (await r.hb.tick()) === 'busy' && r.sc.calls.every((c) => c[0] !== 'prompt'))
}
{
  const r = rig({ state: (sc) => ({ ...sc.st, pendingInput: ['approval'] }) })
  ok('a question that is open holds it back', (await r.hb.tick()) === 'busy')
}
{
  const r = rig({ state: (sc) => ({ ...sc.st, queue: [{ id: 'm1', placement: 'queued', rpcId: 'rpc-person-1', content: 'hello' }] }) })
  ok('a message of the person waiting holds it back', (await r.hb.tick()) === 'busy')
}
{
  const r = rig({}, { pointer: null })
  ok('no chat of Kaby yet: nothing to wake', (await r.hb.tick()) === 'no_chat')
}
{
  const r = rig({}, { desktop: false })
  ok('a cloud computer is not woken by this', (await r.hb.tick()) === 'not_desktop')
}
{
  const r = rig({}, { request: { paused: true } })
  ok('paused, nothing starts, not even by the person\'s click', (await r.hb.tick()) === 'not_in_force' && (await r.hb.start({ manual: true })).error === 'not_in_force')
}
{
  const r = rig({ state: () => { throw new Error('session not found') } })
  ok('a chat that is gone is « no chat », not a crash', (await r.hb.tick()) === 'no_chat')
}
{
  const bare = { prompt: async () => ({ accepted: true }) }
  const dir = mkdtempSync(join(tmpdir(), 'kyby-heartbeat-run-'))
  const st = createHeartbeatStore({ home: () => dir, secret: () => SECRET, now: () => at(13, 5) })
  st.set({ preset: 'regular' })
  const hb = createHeartbeat({ store: st, controller: () => bare, pointer: () => SID, isDesktop: () => true, now: () => at(13, 5), sleep: macro })
  ok('an engine with no state, wait or cancel is refused up front', (await hb.start({ manual: true })).error === 'sessions_unavailable')
}
{
  const r = rig()
  r.setNow(at(10, 0))
  ok('the person\'s click starts one before its time, in the quiet hours too', (await r.hb.start({ manual: true })).ok === true)
  await macro()
  const r2 = rig()
  r2.setNow(at(23, 30))
  const started = await r2.hb.start({ manual: true })
  ok('a click in the quiet hours starts it', started.ok === true && (await started.finished) === 'done')
  const r3 = rig({ state: (sc) => ({ ...sc.st, running: true }) })
  ok('a click never starts one over a running turn', (await r3.hb.start({ manual: true })).error === 'busy')
}
{
  const r = rig({ wait: async (req, signal, sc) => ({ reason: 'input-required', state: { ...sc.st, pendingInput: ['approval'] }, output: [] }) })
  const out = await r.hb.tick()
  ok('a question that opens ends the wake-up: cancelled, « blocked »', out === 'blocked' && r.sc.calls.some((c) => c[0] === 'cancel') && r.st.view().lastOutcome === 'blocked')
}
{
  const r = rig({ wait: async (req, signal, sc) => ({ reason: 'timeout', state: { ...sc.st }, output: [] }) })
  const out = await r.hb.tick()
  ok('the time box ends it: cancelled, « time »', out === 'time' && r.sc.calls.some((c) => c[0] === 'cancel') && r.st.view().lastOutcome === 'time')
}
{
  // The person's message arrives behind the wake-up's turn: the turn is cancelled (the engine keeps the inbox), and the outcome is « person ».
  let calls = 0
  const r = rig({
    state: (sc) => {
      calls += 1
      // 1: the preflight (idle); 2 and 3: the wait for the turn to start; then the person's message appears in the queue.
      return calls <= 3 ? { ...sc.st } : { ...sc.st, queue: [{ id: 'm9', placement: 'queued', rpcId: 'rpc-person-9', content: 'hi' }] }
    },
    wait: (req, signal, sc) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true }) })
  })
  const out = await r.hb.tick()
  ok('the person\'s message waiting behind it cancels the wake-up, and wins', out === 'person' && r.sc.calls.some((c) => c[0] === 'cancel') && r.st.view().lastOutcome === 'person')
}
{
  // Our own queued message does not count as the person's.
  const r = rig({ state: (sc) => ({ ...sc.st, queue: sc.st.running ? [{ id: 'm1', placement: 'queued', rpcId: REQUEST_PREFIX + 'x', content: TRIGGER_TEXT }] : [] }) })
  const out = await r.hb.tick()
  ok('the wake-up\'s own queued message is not taken for the person\'s', out === 'done' && !r.sc.calls.some((c) => c[0] === 'cancel'))
}
{
  // The person's « Stop »: the turn is cancelled, the watch is cut, the wake-up ends as « stopped » (and the turn's end hooks still find it marked).
  const r = rig({ wait: (req, signal, sc) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true }) }) })
  ok('nothing runs: nothing to stop', (await r.hb.stopNow()).error === 'not_running')
  const started = await r.hb.start({ manual: true })
  await macro(); await macro()
  const stopped = await r.hb.stopNow()
  ok('a click stops the running wake-up: the turn is cancelled and the word is « stopped »', stopped.ok === true && (await started.finished) === 'stopped' && r.sc.calls.some((c) => c[0] === 'cancel') && r.st.view().lastOutcome === 'stopped' && r.hb.runningSession() === null)
  ok('a second click finds nothing', (await r.hb.stopNow()).error === 'not_running')
}
{
  // A click before the watch has begun (the grace for the turn to show): the turn that appears is cancelled at once.
  const r = rig({ state: (sc) => ({ ...sc.st, running: false }), wait: async () => { throw new Error('the watch must not begin') } })
  const started = await r.hb.start({ manual: true })
  const stopped = await r.hb.stopNow()
  ok('a click during the start is honoured too', stopped.ok === true && (await started.finished) === 'stopped' && r.sc.calls.some((c) => c[0] === 'cancel'))
}
{
  const r = rig({ prompt: async () => ({ ok: false, error: 'refused' }) })
  ok('a prompt the engine refuses ends as « refused », marked off', (await r.hb.tick()) === 'refused' && r.hb.runningSession() === null)
}
{
  const r = rig({ prompt: async () => { throw new Error('boom') } })
  ok('a throwing engine ends as « error » and never throws out', (await r.hb.tick()) === 'error' && r.st.view().lastOutcome === 'error' && r.hb.runningSession() === null)
}
{
  const r = rig({ wait: async () => { throw new Error('observation ended') } })
  ok('a wait that fails ends as « error »', (await r.hb.tick()) === 'error')
}
{
  const r = rig({ wait: (req, signal, sc) => new Promise((resolve) => setTimeout(() => { sc.st.running = false; resolve({ reason: 'idle', state: { ...sc.st }, output: [] }) }, 40)) })
  const started = await r.hb.start({ manual: true })
  ok('two wake-ups never run at once', (await r.hb.start({ manual: true })).error === 'running' && r.hb.runningSession() === SID)
  await started.finished
  ok('and the next one can start once the first has ended', r.hb.runningSession() === null)
}
{
  const r = rig()
  r.st.started(at(1))
  r.hb.settle()
  ok('a restart settles a wake-up that nothing runs', r.st.view().lastOutcome === 'interrupted')
  const r2 = rig({ wait: (req, signal, sc) => new Promise((resolve) => setTimeout(() => { sc.st.running = false; resolve({ reason: 'idle', state: { ...sc.st }, output: [] }) }, 40)) })
  const s2 = await r2.hb.start({ manual: true })
  r2.hb.settle()
  ok('and leaves one that is running alone', r2.st.view().lastOutcome === 'running')
  await s2.finished
}
{
  const r = rig()
  const s = await r.hb.start({ manual: true })
  r.hb.noteClaim(SID)
  r.hb.noteClaim('another-session-id')
  const afterOurs = r.st.state().lastPersonAt
  r.hb.noteClaim(SID)
  await s.finished
  ok('the first claim after a start is the wake-up\'s own, a later one is the person\'s, another session\'s is nobody\'s', afterOurs === undefined && Number.isFinite(r.st.state().lastPersonAt))
}

rmSync(home, { recursive: true, force: true })
if (fail > 0) { console.log('\n' + fail + ' failed'); process.exit(1) }
console.log('\nall passed')
