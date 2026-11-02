// Shared context of the teams end-to-end journeys: the replica client, the two made-up accounts, the two sandbox DSH pages, the recording proxy's log,
// and a tiny check/report recorder. Everything private (paths, accounts) comes from the environment: see scripts/lib-e2e-server.mjs and the header of
// scripts/check-teams-e2e.mjs.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeServer, env, readAccounts } from '../lib-e2e-server.mjs'
import { openGui, readProxy, mainCalls, chatCalls, flatten, cwdOf, bodyOf, sleep } from '../lib-e2e-gui.mjs'

export { sleep, openGui, readProxy, mainCalls, chatCalls, flatten, cwdOf, bodyOf }

export const makeContext = async () => {
  const e = env()
  const server = makeServer(e)
  const acc = readAccounts(e)
  if (!acc.a || !acc.b || !acc.teams) throw new Error('run scripts/e2e-teams-setup.mjs first (accounts.json is empty)')
  const proxyLog = process.env.KB_PROXY_LOG || join(e.dir, 'proxy.jsonl')
  const shots = process.env.KB_E2E_SHOTS || ''
  if (shots) mkdirSync(shots, { recursive: true })
  const ctx = {
    e, server, acc, proxyLog, shots,
    hostA: process.env.KB_E2E_HOST_A || '127.0.0.1:3098',
    hostB: process.env.KB_E2E_HOST_B || '127.0.0.1:3110',
    ids: { t1: acc.teams.t1.id, t2: acc.teams.t2.id },
    rows: (since = 0) => readProxy(proxyLog, since),
    shot: async (g, name) => { if (shots) await g.shot(join(shots, name + '.png')) },
    mark: (label) => fetch(e.web + '/__proxy/mark?label=' + encodeURIComponent(label)),
    engine: (body) => server.control('/__/engine/reply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    script: (toolCalls, delayMs = 0) => fetch(e.web + '/__proxy/script', { method: 'POST', body: JSON.stringify({ tool_calls: toolCalls, delay_ms: delayMs }) }),
    results: [], notes: [],
    /** Points DSH_HOME at the sandbox of account a|b (the signed cookie of a DSH page is derived from that home's secret): call it before opening a page or calling a host route. */
    as: (who) => {
      const home = process.env[who === 'a' ? 'KB_E2E_HOME_A' : 'KB_E2E_HOME_B']
      if (!home) throw new Error(`KB_E2E_HOME_${who.toUpperCase()} (the sandbox HOME of account ${who.toUpperCase()}) is not set`)
      process.env.DSH_HOME = join(home, '.dsh')
      return who === 'a' ? ctx.hostA : ctx.hostB
    },
  }
  /** Which space owns a chat that works in `cwd`, by the rule the plugin applies (« a chat in a team's folder bills that team, every other chat bills Personal »): 't1', 't2', 'P', or null when
   *  there is no folder to read. The teams' folders are `<Documents>/Kybernos/<Team name>` (with « (<id>) » after the name when the name was taken). */
  ctx.ownerOfCwd = (cwd) => {
    if (typeof cwd !== 'string' || cwd === '') return null
    if (/\/Kybernos\/E2E Alpha( \([0-9a-f]{8}\))?(\/|$)/.test(cwd)) return 't1'
    if (/\/Kybernos\/E2E Beta( \([0-9a-f]{8}\))?(\/|$)/.test(cwd)) return 't2'
    return 'P'
  }
  ctx.sessionOf = async (who) => server.signIn(acc[who].email, acc[who].password)
  ctx.personalId = async (who) => {
    const s = await ctx.sessionOf(who)
    const r = await server.call('GET', '/v1/workspaces', { cookie: s.cookie })
    const list = Array.isArray(r.body) ? r.body : r.body.workspaces
    return list.find((w) => w.personal === true).id
  }
  return ctx
}

/** A journey records PASS/FAIL checks with the evidence that backs each one; nothing secret goes in `detail`. */
export const recorder = (ctx, journey) => {
  const rec = { journey, checks: [], notes: [], started: new Date().toISOString() }
  const check = (name, ok, detail) => {
    rec.checks.push({ name, ok: ok === true, detail })
    console.log((ok === true ? '  ✓ ' : '  ✗ ') + name + (ok === true || detail === undefined ? '' : '  → ' + JSON.stringify(detail).slice(0, 400)))
    return ok === true
  }
  const note = (text) => { rec.notes.push(text); console.log('  · ' + text) }
  const finish = () => {
    rec.failed = rec.checks.filter((c) => !c.ok).length
    rec.status = rec.checks.length === 0 ? 'NOT RUN' : rec.failed === 0 ? 'PASS' : 'FAIL'
    try { writeFileSync(join(ctx.e.dir, `result-${journey}.json`), JSON.stringify(rec, null, 2) + '\n') } catch { /* the folder is the caller's */ }
    console.log(`\n${journey}: ${rec.status} (${rec.checks.length - rec.failed}/${rec.checks.length})`)
    return rec
  }
  return { check, note, finish, rec }
}
