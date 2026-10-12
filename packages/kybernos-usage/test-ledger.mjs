// The ledger: deltas, baselines, resets, pruning, summary. Pure, no DSH.
import { emptyLedger, normalise, applyObservation, setBudget, summarize, tokensOf, dayKey, MAX_DAYS, MAX_SESSIONS } from './usage-ledger.mjs'

let fail = 0
const ok = (name, cond, detail) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  ' + (detail || ''))); if (!cond) fail++ }
const U = (u, o, cr, cw = 0) => ({ uncachedInputTokens: u, outputTokens: o, cacheReadTokens: cr, cacheWriteTokens: cw })
const T0 = new Date(2026, 9, 12, 9, 0)
const obs = (usage, extra = {}) => ({ sessionId: 's1', provider: 'deepseek', model: 'deepseek-pro', title: 'Note Team', usage, ...extra })

{ // first sight is a baseline: not dated
  const l = emptyLedger()
  const r = applyObservation(l, obs(U(100, 10, 1000)), T0)
  ok('first sight: ok and changed', r.ok && r.changed && r.baseline === true)
  ok('first sight: goes to before, not to a day', l.before['deepseek/deepseek-pro'].cr === 1000 && Object.keys(l.days).length === 0)
}
{ // deltas land on the day of the observation
  const l = emptyLedger()
  applyObservation(l, obs(U(100, 10, 1000)), T0)
  const r = applyObservation(l, obs(U(150, 30, 1800)), new Date(2026, 9, 12, 10, 0))
  ok('delta computed', r.delta.u === 50 && r.delta.o === 20 && r.delta.cr === 800, JSON.stringify(r.delta))
  ok('delta booked on today', l.days['2026-10-12'].models['deepseek/deepseek-pro'].cr === 800)
  const again = applyObservation(l, obs(U(150, 30, 1800)), new Date(2026, 9, 12, 10, 1))
  ok('same counters again: nothing booked, not changed', again.changed === false && l.days['2026-10-12'].models['deepseek/deepseek-pro'].cr === 800)
}
{ // a counter going down is a new baseline, never a negative
  const l = emptyLedger()
  applyObservation(l, obs(U(100, 10, 1000)), T0)
  applyObservation(l, obs(U(200, 20, 2000)), T0)
  const r = applyObservation(l, obs(U(50, 5, 500)), T0)
  ok('reset: no delta, flagged', r.reset === true && r.delta.u === 0)
  const next = applyObservation(l, obs(U(80, 9, 700)), T0)
  ok('after a reset the new baseline counts', next.delta.u === 30 && next.delta.cr === 200, JSON.stringify(next.delta))
  const day = l.days['2026-10-12'].models['deepseek/deepseek-pro']
  ok('no negative anywhere', day.u >= 0 && day.o >= 0 && day.cr >= 0 && day.cw >= 0)
}
{ // model switch inside one session: the delta goes to the model in use
  const l = emptyLedger()
  applyObservation(l, obs(U(0, 0, 0)), T0)
  applyObservation(l, obs(U(10, 1, 0)), T0)
  const l2 = emptyLedger()
  applyObservation(l2, obs(U(10, 1, 0)), T0)
  applyObservation(l2, obs(U(30, 2, 0), { model: 'deepseek-flash' }), T0)
  ok('delta booked on the model in use', l2.days['2026-10-12'].models['deepseek/deepseek-flash'].u === 20)
}
{ // validation
  const l = emptyLedger()
  ok('refuses a missing session', applyObservation(l, { model: 'x', usage: U(1, 1, 1) }, T0).ok === false)
  ok('refuses a missing model', applyObservation(l, { sessionId: 's', usage: U(1, 1, 1) }, T0).ok === false)
  ok('refuses a non-object', applyObservation(l, null, T0).ok === false)
  const r = applyObservation(l, obs({ uncachedInputTokens: -5, outputTokens: 'x', cacheReadTokens: NaN }), T0)
  ok('garbage counters count as zero', r.ok === true && r.changed === false)
  ok('tokensOf clamps', tokensOf({ uncachedInputTokens: 1e15 }).u === 1e12)
}
{ // normalise never throws
  ok('normalise(null)', normalise(null).version === 1)
  ok('normalise(string)', Object.keys(normalise('x').days).length === 0)
  const n = normalise({ days: { 'bad': { models: {} }, '2026-10-01': { models: { 'a/b': { u: 3, o: -1 } } } }, budget: { usd: -4 } })
  ok('normalise keeps good days, drops bad ones, clamps', n.days['2026-10-01'].models['a/b'].u === 3 && n.days['2026-10-01'].models['a/b'].o === 0 && n.days.bad === undefined && n.budget.usd === null)
}
{ // pruning
  const l = emptyLedger()
  l.days['2020-01-01'] = { models: { 'a/b': { u: 1, o: 0, cr: 0, cw: 0 } } }
  applyObservation(l, obs(U(1, 1, 1)), T0)
  ok('old days are dropped', l.days['2020-01-01'] === undefined)
  const l2 = emptyLedger()
  for (let i = 0; i < MAX_SESSIONS + 5; i++) applyObservation(l2, { sessionId: 's' + i, provider: 'p', model: 'm', usage: U(1, 1, 1) }, new Date(T0.getTime() + i * 1000))
  ok('sessions are capped, oldest first', Object.keys(l2.sessions).length === MAX_SESSIONS && l2.sessions.s0 === undefined && l2.sessions['s' + (MAX_SESSIONS + 4)] !== undefined)
}
{ // budget
  const l = emptyLedger()
  ok('budget set', setBudget(l, { usd: 25, alert: false }).ok && l.budget.usd === 25 && l.budget.alert === false)
  ok('budget 0 means none', setBudget(l, { usd: 0 }).ok && l.budget.usd === null)
  ok('budget refuses negatives and strings', setBudget(l, { usd: -1 }).ok === false && setBudget(l, { usd: '5' }).ok === false)
}
{ // summary
  const l = emptyLedger()
  applyObservation(l, obs(U(100, 10, 1000)), new Date(2026, 9, 10, 9, 0))
  applyObservation(l, obs(U(200, 20, 3000)), new Date(2026, 9, 10, 9, 5))
  applyObservation(l, obs(U(300, 30, 4000)), new Date(2026, 9, 12, 9, 0))
  const s = summarize(l, { days: 7, now: T0 })
  ok('summary: 7 days, oldest first, ends today', s.daily.length === 7 && s.daily[6].day === '2026-10-12' && s.daily[0].day === '2026-10-06')
  ok('summary: totals by model add the days', s.models['deepseek/deepseek-pro'].u === 200 && s.models['deepseek/deepseek-pro'].cr === 3000, JSON.stringify(s.models))
  ok('summary: session listed with its model tokens', s.sessions.length === 1 && s.sessions[0].title === 'Note Team')
  ok('summary: before kept apart', s.before['deepseek/deepseek-pro'].cr === 1000)
  ok('summary: since = first dated day', s.since === '2026-10-10')
  ok('summary clamps the window', summarize(l, { days: 99999, now: T0 }).daily.length === MAX_DAYS)
  ok('dayKey is local', dayKey(new Date(2026, 0, 5, 23, 59)) === '2026-01-05')
}
process.exit(fail ? 1 : 0)
