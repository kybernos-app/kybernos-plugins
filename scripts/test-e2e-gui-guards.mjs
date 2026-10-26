#!/usr/bin/env node
// The guards of the two-account journeys' harness (scripts/lib-e2e-gui.mjs, scripts/preflight-model.mjs, scripts/e2e-teams-run.sh), on fake pages: no browser, no DSH.
// What they exist for: the 2026-10-24 run was void because no agent request ever reached the replica, and the harness said nothing (selectModel returned without choosing,
// `cwdOf(mains[0])` crashed on an empty list, a journey compared empty lists). Each of those must now be loud.
//
//   node scripts/test-e2e-gui-guards.mjs
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NO_AGENT_REQUEST, agentOk, cwdOf, cwdOrWhy, flatten, selectModelOn } from './lib-e2e-gui.mjs'
import { diagnose, summarise } from './preflight-model.mjs'

const here = dirname(fileURLToPath(import.meta.url))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

/** An OLDER engine's page: the model button reads « Select model » until a model is chosen, then the model's name (as text a lookup can find); the list opens straight from the button. */
const legacyPage = ({ button, lines }) => {
  const st = { button, listOpen: false, pressed: [] }
  return {
    st,
    until: async (fn) => fn(),   // no waiting: the fake page answers at once
    modelButton: async () => null,
    leaf: async (text) => {
      if (text === 'Select model') return st.button === 'Select model' ? { x: 1, y: 1 } : null
      if (st.button === text) return { x: 2, y: 2 }
      if (st.listOpen && lines.includes(text)) return { x: 3, y: lines.indexOf(text) }
      return null
    },
    mouse: async (x, y) => { st.pressed.push([x, y]); if (x === 1) st.listOpen = true; if (x === 3) { st.button = lines[y]; st.listOpen = false } },
  }
}
/** DSH 0.2.1-rc.2's page: `<button aria-label="Select model, current X">`, the name sits in a zero-width span (no text lookup finds it), the menu has a « Model » row that opens the list. */
const rc2Page = ({ current, models, modelRow = true, clickLands = true }) => {
  const st = { current, menu: false, sub: false, pressed: [] }
  return {
    st,
    until: async (fn) => fn(),
    modelButton: async () => ({ current: st.current, shown: st.current, x: 1, y: 1, visible: true }),
    leaf: async (text) => {
      if (text === 'Model') return st.menu && modelRow && !st.sub ? { x: 4, y: 0 } : null
      if ((st.sub || (st.menu && !modelRow)) && models.includes(text)) return { x: 3, y: models.indexOf(text) }
      return null
    },
    mouse: async (x, y) => {
      st.pressed.push([x, y])
      if (x === 1) st.menu = true
      if (x === 4) st.sub = true
      if (x === 3 && clickLands) { st.current = models[y]; st.menu = false; st.sub = false }
    },
  }
}
const caught = async (fn) => { try { await fn(); return null } catch (e) { return String(e && e.message || e) } }

// selectModel on the engine of this machine (rc.2)
{
  const chosen = rc2Page({ current: 'GLM', models: ['GLM'] })
  check('selectModel (rc.2): the button already says GLM: nothing is pressed, true', (await selectModelOn(chosen, 'GLM')) === true && chosen.st.pressed.length === 0)
  check('selectModel (rc.2): the comparison ignores the case', (await selectModelOn(rc2Page({ current: 'Kybernos Glm', models: [] }), 'kybernos glm')) === true)
  const other = rc2Page({ current: 'Other', models: ['Other', 'GLM'] })
  check('selectModel (rc.2): another model is chosen: it opens the menu, the « Model » row, presses the line and reads the button back', (await selectModelOn(other, 'GLM')) === true && other.st.current === 'GLM' && other.st.pressed.length === 3, other.st)
  const direct = rc2Page({ current: 'Other', models: ['Other', 'GLM'], modelRow: false })
  check('selectModel (rc.2): a menu that lists the models straight away is fine too', (await selectModelOn(direct, 'GLM')) === true && direct.st.current === 'GLM', direct.st)
  const noLine = rc2Page({ current: 'Other', models: ['Other'] })
  const m1 = await caught(() => selectModelOn(noLine, 'GLM'))
  check('selectModel (rc.2): no line of that name: it THROWS and names the line', m1 !== null && /no line « GLM »/.test(m1), m1)
  check('and tells where to look', /GET \/kybernos-cloud\/models/.test(m1 || ''), m1)
  const missed = rc2Page({ current: 'Other', models: ['Other', 'GLM'], clickLands: false })
  const m2 = await caught(() => selectModelOn(missed, 'GLM'))
  check('selectModel (rc.2): a press that does not change the button THROWS (it is read back)', m2 !== null && /still says « Other »/.test(m2), m2)
}

// selectModel on an older engine
{
  const chosen = legacyPage({ button: 'GLM', lines: ['GLM'] })
  check('selectModel (older engine): already chosen, it presses nothing and says yes', (await selectModelOn(chosen, 'GLM')) === true && chosen.st.pressed.length === 0)
  const open = legacyPage({ button: 'Select model', lines: ['GLM', 'Other'] })
  check('selectModel (older engine): it opens the list and presses the line', (await selectModelOn(open, 'GLM')) === true && open.st.pressed.length === 2 && open.st.button === 'GLM', open.st)
  const noLine = legacyPage({ button: 'Select model', lines: ['Other'] })
  const m1 = await caught(() => selectModelOn(noLine, 'GLM'))
  check('selectModel (older engine): no line of that name in the list: it THROWS and names the line', m1 !== null && /no line « GLM »/.test(m1), m1)
  const none = legacyPage({ button: 'Some other model', lines: ['GLM'] })
  const m2 = await caught(() => selectModelOn(none, 'GLM'))
  check('selectModel: no model button at all on the page: it THROWS (it used to return true and let the turn run on the profile\'s own model)', m2 !== null && /no model button/.test(m2) && none.st.pressed.length === 0, m2)
  check('selectModel: the name defaults to GLM', (await selectModelOn(legacyPage({ button: 'GLM', lines: [] }))) === true)
}

// flatten / cwdOf
{
  const body = (messages) => ({ method: 'POST', path: '/v1/chat/completions', status: 200, body: JSON.stringify({ messages, tools: [{ type: 'function' }] }) })
  const req = body([{ role: 'system', content: 'Current working directory: "/home/x/Kybernos/E2E Alpha"' }, { role: 'user', content: 'hello' }])
  check('flatten: an undefined request is an empty text, not a crash', flatten(undefined) === '' && flatten(null) === '')
  check('cwdOf: an undefined request has no folder, not a crash (mains[0] of a turn that sent nothing)', cwdOf(undefined) === null && cwdOf(null) === null)
  check('cwdOf still reads the folder of a real request', cwdOf(req) === '/home/x/Kybernos/E2E Alpha', cwdOf(req))
  check('cwdOf: a body that is not JSON, or has no messages, is read as text and gives null', cwdOf({ body: 'not json' }) === null && cwdOf({ body: '{"a":1}' }) === null)
  check('flatten: array content is flattened too', flatten(body([{ role: 'user', content: [{ type: 'text', text: 'abc' }] }])).includes('abc'))
  check('cwdOrWhy: an empty list says « no agent request reached the replica »', cwdOrWhy([][0]) === 'no agent request reached the replica' && cwdOrWhy(undefined) === NO_AGENT_REQUEST)
  check('cwdOrWhy: with a request it is the folder', cwdOrWhy(req) === '/home/x/Kybernos/E2E Alpha')
  check('the message is never mistaken for a folder owner (a check on the folder cannot go green on it)', cwdOf(undefined) === null)
}

// agentOk / preflight summary
{
  const tools = JSON.stringify({ messages: [], tools: [{ type: 'function' }] })
  const rows = [
    { method: 'POST', path: '/v1/chat/completions', status: 200, workspace: 'ws-A', body: tools },
    { method: 'POST', path: '/v1/chat/completions', status: 402, workspace: 'ws-A', body: tools },
    { method: 'POST', path: '/v1/chat/completions', status: 200, workspace: 'ws-A', body: JSON.stringify({ messages: [] }) },   // title call: no tools
    { method: 'GET', path: '/v1/models', status: 200, workspace: null, body: null },
  ]
  check('agentOk: only the agent requests (with tools) that were answered 200', agentOk(rows).length === 1 && agentOk([]).length === 0)
  const s = summarise(rows)
  check('summarise: counts chat, agent and 200 agent requests and who they were billed to', s.chat === 3 && s.agent === 2 && s.agent200 === 1 && s.workspaces.join() === 'ws-A' && s.statuses.join() === '200,402', s)
  check('diagnose: a 200 agent request is a pass', diagnose(s, '', true) === null)
  const dead = summarise([])
  check('diagnose: nothing reached the replica, and the page says the turn failed: it names the cause and the fix', /no credential/.test(diagnose(dead, 'x This turn failed … no credential for provider route "opencode-go" y', true) || '') && /pin-model/.test(diagnose(dead, 'This turn failed here', true) || ''))
  check('diagnose: the model could not be chosen', /could not be chosen.*no line/.test(diagnose(dead, '', 'no line « GLM »') || ''))
  check('diagnose: only side requests reached the replica', /only side requests/.test(diagnose({ chat: 2, agent: 0, agent200: 0, statuses: [], workspaces: [] }, '', true) || ''))
  check('diagnose: agent requests but none answered 200 is an account or plan problem', /none was answered 200.*402/.test(diagnose({ chat: 1, agent: 1, agent200: 0, statuses: [402], workspaces: [] }, '', true) || ''))
  check('diagnose: nothing at all', /no request reached the replica at all/.test(diagnose(dead, '', true) || ''))
}

// the shell script: it pins in `up` and refuses to run the journeys without the preflight
{
  const sh = join(here, 'e2e-teams-run.sh')
  const text = readFileSync(sh, 'utf8')
  check('e2e-teams-run.sh is valid bash', spawnSync('bash', ['-n', sh]).status === 0)
  check('up pins the sandbox default model of BOTH sandboxes, before their first start and again after the connection (scripts/pin-model.mjs)', /pin-model\.mjs" --home/.test(text) && /pin_model "\$SB_A\/home" && bash "\$ROOT\/scripts\/sandbox\/start\.sh"/.test(text) && /pin_model "\$SB_B\/home" && bash "\$ROOT\/scripts\/sandbox\/start\.sh"/.test(text) && (text.match(/pin_model "\$SB_[AB]\/home"/g) || []).length >= 4)
  check('run runs the preflight first and stops when it fails', /preflight-model\.mjs/.test(text) && /refusing to start the journeys/.test(text))
  check('the preflight comes before the journeys in run()', text.indexOf('preflight-model.mjs', text.indexOf('run() {')) > 0 && text.indexOf('preflight-model.mjs', text.indexOf('run() {')) < text.indexOf('check-teams-e2e.mjs'))
}

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
