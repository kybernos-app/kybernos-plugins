#!/usr/bin/env node
// Step 10 of the teams plan: the end-to-end journeys with two made-up accounts on a LOCAL replica, through two sandbox DSH instances.
//   node scripts/check-teams-e2e.mjs j1 [j2 ...]      (default: every journey that exists)
// Needs the setup done (scripts/e2e-teams-setup.mjs, scripts/e2e-connect.mjs) and the environment of scripts/lib-e2e-server.mjs, plus
//   KB_E2E_HOST_A / KB_E2E_HOST_B   the two sandboxes (default 127.0.0.1:3098 / :3110)
//   KB_PROXY_LOG                    the recording proxy's log (default <KB_E2E_DIR>/proxy.jsonl)
//   KB_E2E_SHOTS                    where screenshots go (outside git)
//   DSH_HOME                        the sandbox's DSH home of the page being driven is chosen per journey from KB_E2E_HOME_A / KB_E2E_HOME_B
import { makeContext } from './e2e-teams/common.mjs'

const wanted = process.argv.slice(2).map((s) => s.toLowerCase())
const all = { j1: './e2e-teams/j1-billing.mjs', j2: './e2e-teams/j2-memory.mjs', j3: './e2e-teams/j3-folders.mjs', j4: './e2e-teams/j4-invitation.mjs', j5: './e2e-teams/j5-usage.mjs', j6: './e2e-teams/j6-roles.mjs', j7: './e2e-teams/j7-shapes.mjs', j8: './e2e-teams/j8-web.mjs' }
const run = wanted.length ? wanted : Object.keys(all)
const ctx = await makeContext()
const out = []
for (const key of run) {
  if (!all[key]) { console.error('unknown journey ' + key); process.exit(2) }
  console.log(`\n══ ${key.toUpperCase()} ══`)
  try { out.push(await (await import(all[key])).run(ctx)) } catch (e) { console.error(key + ' crashed: ' + (e && e.stack || e)); out.push({ journey: key.toUpperCase(), status: 'FAIL', crashed: String(e && e.message || e), checks: [] }) }
}
console.log('\n' + out.map((r) => `${r.journey}: ${r.status}`).join('\n'))
process.exit(out.every((r) => r.status === 'PASS') ? 0 : 1)
