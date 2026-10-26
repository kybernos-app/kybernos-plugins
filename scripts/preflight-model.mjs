#!/usr/bin/env node
// Before the two-account journeys: does an AGENT request (one that carries the `tools` list) really reach the replica, and get a 200, for BOTH accounts?
//
//   source "$KB_E2E_DIR/env.sh" && node scripts/preflight-model.mjs      (scripts/e2e-teams-run.sh runs it in front of `run` and refuses to go on when it exits 1)
//
// Why: the 2026-10-24 run of the journeys was void. The sandbox's default model had no key, so every turn the journeys typed died inside DSH (« no credential for provider route … ») and
// nothing reached the replica: the billing, memory and folder checks compared empty lists, some of them null with null, and read as green or red for no reason. A journey only means something when its turn
// really leaves for the model, so this proves it first, for each sandbox: it picks the model, sends one message in the personal chat and reads the recording proxy.
//
// Needs the environment of scripts/e2e-teams-run.sh: KB_E2E_HOME_A / _B, KB_E2E_HOST_A / _B, KB_PROXY_LOG. Writes <KB_E2E_DIR>/preflight.json (counts and the header of the space, no body). Exit 0 both
// accounts got a 200 agent request, 1 one of them did not (the line says why), 3 not run (environment missing, or a host that is the real DSH).
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { agentOk, chatCalls, cookieDeSession, mainCalls, openGui, readProxy, sleep } from './lib-e2e-gui.mjs'

/** What the proxy saw for one account: counts of the chat requests, of the agent requests, of those answered 200, and who they were billed to. Pure. */
export const summarise = (rows) => {
  const main = mainCalls(rows)
  const ok = agentOk(rows)
  return { chat: chatCalls(rows).length, agent: main.length, agent200: ok.length, statuses: [...new Set(main.map((r) => r.status))].sort(), workspaces: [...new Set(ok.map((r) => (typeof r.workspace === 'string' ? r.workspace : '-')))] }
}

/** Says why an account failed, from what the page showed and what the proxy counted. Pure. */
export const diagnose = (sum, pageText, picked) => {
  if (sum.agent200 > 0) return null
  const failed = /This turn failed.{0,220}/.exec(String(pageText || '').replace(/\s+/g, ' '))
  if (failed) return failed[0] + ' (the turn died inside DSH: the profile\'s default model is not one this sandbox can reach; run scripts/pin-model.mjs)'
  if (picked !== true) return 'the model could not be chosen in the composer: ' + picked
  if (sum.agent > 0) return 'agent requests reached the replica but none was answered 200 (statuses ' + JSON.stringify(sum.statuses) + '): an account or plan problem (the replica must have put both personal spaces on Plus)'
  if (sum.chat > 0) return 'only side requests (title, classification) reached the replica, no agent request with tools'
  return 'no request reached the replica at all (the composer, the route or the model)'
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  const need = (n) => process.env[n] || (() => { console.error('not run: ' + n + ' is not set (source "$KB_E2E_DIR/env.sh")'); process.exit(3) })()
  const proxyLog = need('KB_PROXY_LOG')
  const out = {}
  let red = false
  for (const who of ['A', 'B']) {
    const host = need('KB_E2E_HOST_' + who)
    if (/:3080$/.test(host)) { console.error('not run: ' + who + ' is the real DSH'); process.exit(3) }
    process.env.DSH_HOME = need('KB_E2E_HOME_' + who) + '/.dsh'
    const g = await openGui(host)
    let picked = null
    let text = ''
    let sum = { chat: 0, agent: 0, agent200: 0, statuses: [], workspaces: [] }
    try {
      await g.waitFor(`document.querySelector('[data-kb="workspace-card"]') !== null`, 30000)
      await g.dismissGetStarted()
      await sleep(1500)
      try { picked = await g.selectModel('GLM') } catch (e) { picked = String(e && e.message || e) }
      const t = picked === true ? await g.send('preflight ' + who) : null
      if (t !== null) {
        const end = Date.now() + 40000
        while (Date.now() < end) { sum = summarise(readProxy(proxyLog, t)); if (sum.agent200 > 0) break; await sleep(500) }
        // let the reply finish: the journeys must not start on a chat that is still running
        const ck = cookieDeSession(host)
        const busyEnd = Date.now() + 15000
        while (ck !== null && Date.now() < busyEnd) {
          try { const b = await (await fetch('http://' + host + '/kybernos-cloud/space/busy', { headers: { cookie: ck.nom + '=' + ck.valeur } })).json(); if (b.busy !== true) break } catch { break }
          await sleep(500)
        }
      }
      text = (await g.body()) || ''
    } finally { await g.close() }
    const why = diagnose(sum, text, picked)
    out[who] = { picked: picked === true ? true : 'failed', ...sum, ok: why === null }
    console.log(who + ' | model picked: ' + (picked === true ? 'yes' : 'NO') + ' | chat requests: ' + sum.chat + ' | agent requests: ' + sum.agent + ' | answered 200: ' + sum.agent200 + (why === null ? '' : ' | ' + why))
    if (why !== null) red = true
  }
  try { writeFileSync(join(process.env.KB_E2E_DIR || '.', 'preflight.json'), JSON.stringify(out, null, 2) + '\n') } catch { /* the folder is the caller's */ }
  console.log(red ? 'PREFLIGHT FAILED: no journey may start (their checks would compare empty lists)' : 'preflight ok: an agent request with tools got a 200 for A and for B')
  process.exit(red ? 1 : 0)
}
