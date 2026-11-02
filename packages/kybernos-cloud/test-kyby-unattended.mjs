// Which turns of Kaby's chat have nobody to answer (kyby-unattended.mjs): an automation's run is told apart by its request id, and the person's next message ends it.
// No network, no DSH.
//   node packages/kybernos-cloud/test-kyby-unattended.mjs
import { readFileSync } from 'node:fs'
import { LIST_TEXT, RUN_PREFIX, TODO_FILE, UNATTENDED_NEVER, createUnattended } from './kyby-unattended.mjs'

let fail = 0
const ok = (name, cond, detail) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(detail))); if (!cond) fail++ }

const KABY = 'session-kaby-0001'
const OTHER = 'session-other-0002'
const run = (id = 'st-abc-1') => ({ role: 'user', source: { kind: 'user', rpcId: RUN_PREFIX + id }, content: [{ type: 'text', text: 'wake' }] })
const person = () => ({ role: 'user', source: { kind: 'user', rpcId: 'rpc-77', clientTimeZone: 'Europe/Paris' }, content: [{ type: 'text', text: 'hello' }] })
const note = () => ({ role: 'user', source: { kind: 'system' }, content: [] })

// No bundle imports another: the two packages agree on the prefix, and this is where a drift shows.
const theirs = /RUN_REQUEST_PREFIX\s*=\s*'([^']+)'/.exec(readFileSync(new URL('../kybernos-plugin/automation-run-guard.mjs', import.meta.url), 'utf8'))
ok('the prefix is the one the automations plugin puts on its requests', theirs !== null && theirs[1] === RUN_PREFIX && /kb-task-/.test(String(run().source.rpcId)), theirs)
ok('a question and a schedule are never offered to an unattended turn', UNATTENDED_NEVER.includes('ask_user_question') && UNATTENDED_NEVER.includes('schedule_create') && UNATTENDED_NEVER.includes('schedule_update'))
ok('the list block is two lines inside its own markers and names the file', LIST_TEXT.split('\n').length === 3 && LIST_TEXT.includes(TODO_FILE) && LIST_TEXT.startsWith('[YOUR LIST]') && LIST_TEXT.endsWith('[/YOUR LIST]'))

{
  const u = createUnattended()
  ok('nothing is a run before a message was claimed', u.isRun(KABY) === false && u.isRun(undefined) === false && u.isRun('') === false)
  u.noteClaim(KABY, 4, run())
  ok('the claim of an automation message marks that session, and no other', u.isRun(KABY) === true && u.isRun(OTHER) === false)
  u.noteClaim(KABY, 4, note())
  ok('another message claimed by the same turn does not end it', u.isRun(KABY) === true)
  u.noteClaim(KABY, 5, person())
  ok('the person\'s message, taken by a later turn, ends it', u.isRun(KABY) === false)
  u.noteClaim(KABY, 6, person())
  ok('and a person\'s message alone marks nothing', u.isRun(KABY) === false)
}

{
  const u = createUnattended()
  u.noteClaim(KABY, 9, run('st-1'))
  u.noteClaim(KABY, 10, run('st-2'))
  ok('a second run starts again from its own turn', u.isRun(KABY) === true)
  u.noteClaim(KABY, 10, person())
  ok('a message in the same turn as the run is not the person coming back', u.isRun(KABY) === true)
  u.noteClaim(KABY, 11, person())
  ok('only a later turn is', u.isRun(KABY) === false)
}

{
  const u = createUnattended()
  u.noteClaim(KABY, undefined, run())
  ok('a run whose turn is unknown ends at the next message that is not an automation\'s', u.isRun(KABY) === true && (u.noteClaim(KABY, undefined, person()), u.isRun(KABY) === false))
}

{
  const u = createUnattended()
  const bad = [[null, 1, run()], [KABY, 1, null], [KABY, 1, undefined], [KABY, 1, 'text'], [KABY, 1, { source: null }], [KABY, 1, { source: { rpcId: 12 } }], [42, 1, run()], ['', 1, run()]]
  let threw = false
  try { for (const [s, t, m] of bad) u.noteClaim(s, t, m) } catch (e) { threw = true }
  ok('a malformed event never throws and marks nothing', threw === false && u.isRun(KABY) === false && u.isRun(42) === false)
}

{
  const u = createUnattended()
  for (let i = 0; i < 260; i += 1) u.noteClaim('session-' + i, 1, run('st-' + i))
  ok('the table is bounded: the oldest sessions are forgotten, the latest kept', u.isRun('session-0') === false && u.isRun('session-259') === true)
}

console.log(fail === 0 ? '\nall good' : '\n' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
