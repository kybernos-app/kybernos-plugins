#!/usr/bin/env node
/**
 * Harness for the client half of `kybernos-atlas`.
 *
 *   1. always: the pure model (normalisers written against route shapes measured on a running DSH,
 *      the graph builder, the checks, the Map view columns, the list and picker helpers) with no
 *      browser and no dependency;
 *   2. the registration contract: the entry declares the services it needs, registers one
 *      `settings.section`, and never throws when a service is missing (a bundle must never stop
 *      DSH from starting);
 *   3. what the page may NOT do: no write verb except the two read-only POSTs, no secret copied
 *      from the task store.
 *
 * Usage: node kybernos-atlas/test-client.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (name, condition, detail) => {
  if (condition === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const SOURCE = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
let definition
globalThis.window = { __ModuleLoader__: { load: (def) => { definition = def } } }
new Function('window', SOURCE)(globalThis.window)
const model = definition.factory() // no `require`: the pure part must not need React
const T = model.__test
const NOW = Date.UTC(2026, 9, 5)
const iso = (daysAgo) => new Date(NOW - daysAgo * 86400000).toISOString()

console.log('\n── loader and registration ──')
check('id = @local/kybernos-atlas/client', definition.id === '@local/kybernos-atlas/client')
check('declares slots and uiWorkspace', Array.isArray(model.inject) && model.inject.includes('slots') && model.inject.includes('uiWorkspace'))
{
  let threw = false
  try { model.apply({ get: () => undefined }) } catch (e) { threw = true }
  check('apply without slots: no throw', threw === false)
  threw = false
  try { model.apply({ get () { throw new Error('boom') } }) } catch (e) { threw = true }
  check('apply when a service lookup throws: no throw', threw === false)
  threw = false
  try { model.apply(null) } catch (e) { threw = true }
  check('apply with no context at all: no throw', threw === false)
}

// Real shapes, trimmed. Names are invented.
const rawSkills = { ok: true, skills: [
  { name: 'code-review', root: '/h/.dsh/skills', source: 'user-dsh', rank: 1, writable: true, active: true, description: 'Review a diff.', whenToUse: '', modifiedAt: iso(20), collision: false },
  { name: 'pdf', root: '/h/.dsh/skills', source: 'user-dsh', rank: 1, writable: true, active: true, description: 'PDF files.', whenToUse: '', modifiedAt: iso(44), collision: true },
  { name: 'pdf', root: '/h/.agents/skills', source: 'user-agents', rank: 2, writable: true, active: true, description: 'PDF files.', whenToUse: '', modifiedAt: iso(50), collision: true },
  { name: 'old-skill', root: '/h/.dsh/skills', source: 'user-dsh', rank: 1, writable: true, active: false, description: '', whenToUse: '', modifiedAt: iso(300), collision: false },
  { name: 'never-declared', root: '/h/.dsh/skills', source: 'user-dsh', rank: 1, writable: true, active: true, description: 'Used by name only.', whenToUse: '', modifiedAt: iso(9), collision: false }
], roots: [], complete: true }
const rawLoad = { ok: true, roots: [
  { id: 'installed', label: 'Installed', path: '/h/.dsh/kybers', kybers: [
    { id: 'Reviewer', mission: 'Review changes before they ship. Then report.', roles: [{ id: 'lead', tools: ['GITHUB_LIST_PRS'] }, { id: 'tester', tools: [] }], skillsDeclared: ['code-review', 'brand-voice', 'old-skill'], skills: [], ui: { name: 'Reviewer', color: '#fff', category: 'dev' } },
    { id: 'writer', mission: '', roles: [], skillsDeclared: ['voice-local'], skills: ['voice-local'], ui: null }
  ] },
  { id: 'workspace', label: 'Repo', path: '/r/kybers', kybers: [{ id: 'reviewer', mission: 'dup', roles: [], skillsDeclared: [], skills: [] }] }
], workspaceUi: {
  w1: { name: 'Plugins repo', icon: 'x', color: 'y', skills: ['code-review', 'pitch-deck'] },
  w2: { name: 'Website', icon: null, color: null }
}, catalog: { providers: {} } }
const rawState = { session: null, kybers: [
  { id: 'reviewer', lecons: [{ ts: iso(2), texte: 'Restart dsh after a host change.', tags: ['dsh'] }, { ts: iso(30), texte: 'Prefix every CSS class.', tags: [] }], totalLecons: 12, totalRuns: 7, derniereActivite: iso(1), dernierOutcome: 'ok', membres: [] },
  { id: 'ghost-kyber', lecons: [{ ts: iso(400), texte: 'Old lesson.', tags: [] }], totalLecons: 1, totalRuns: 0, derniereActivite: null, dernierOutcome: null, membres: [] }
] }
const rawMemory = { ok: true, connected: true, account: [{ id: 1, scope: 'account', kyberId: null, kind: 'fact', content: 'secret-ish fact', pinned: true }, { id: 2, scope: 'account', kyberId: null, kind: 'fact', content: 'another', pinned: false }],
  kyber: {}, map: {}, locals: [], cloud: [{ id: 'c1', name: 'Site kyber', glyph: 'x', color: 'y', workspaceId: 'w2', workspaceName: 'Website', memoryCount: 4 }] }
const rawTasks = { ok: true, tasks: [
  { id: 'digest', name: 'Morning digest', prompt: 'PRIVATE PROMPT', schedule: { mode: 'cron', tz: 'UTC', cron: '30 7 * * 1-5' }, active: true, trigger: { type: 'webhook', hookId: 'h', secret: 'TOP-SECRET' },
    history: [{ at: iso(1), sessionId: 's1', status: 'error', error: 'Gmail token expired' }, { at: iso(2), sessionId: 's2', status: 'fired' }] },
  { id: 'backup', name: 'Back up', schedule: { mode: 'at', at: '2026-10-10T03:00:00Z' }, active: true, history: [] }
] }
const rawConn = { ok: true, connections: [{ toolkit: 'github', status: 'active', accounts: [{ id: 'a' }] }, { toolkit: 'gmail', status: 'active', accounts: [{ id: 'b' }] }, { toolkit: 'empty', status: 'x', accounts: [] }] }
const rawMini = { ok: true, items: [{ id: 'Telegram', chemin: '~/Applications/Kybernos/Telegram.app', auto: false }] }

{
  let threw = false
  let m2 = null
  try { m2 = definition.factory(() => { throw new Error('no react here') }) } catch (e) { threw = true }
  check('factory when require(\'react\') throws: no throw, nothing registered', threw === false && m2 !== null)
  let registered = 0
  m2.apply({ get: (n) => (n === 'slots' ? { inject: () => { registered += 1 } } : undefined) })
  check('…and apply registers nothing instead of failing', registered === 0)
}

console.log('\n── normalisers ──')
const skills = T.normSkills(rawSkills)
check('skills: 5 entries kept, fields mapped', skills.length === 5 && skills[0].name === 'code-review' && skills[3].active === false && skills[1].collision === true)
check('skills: garbage input gives []', T.normSkills(null).length === 0 && T.normSkills({ skills: [1, null, {}] }).length === 0)
const load = T.normLoad(rawLoad)
check('load: kybers deduplicated across roots (lower-cased id)', load.kybers.length === 2 && load.kybers[0].id === 'reviewer')
check('load: display name from ui.name, falls back to id', load.kybers[0].name === 'Reviewer' && load.kybers[1].name === 'writer')
check('load: tools collected from every role', load.kybers[0].tools.length === 1 && load.kybers[0].tools[0] === 'GITHUB_LIST_PRS')
check('load: local skill folders kept', load.kybers[1].localSkills[0] === 'voice-local')
check('load: workspace names and skills', load.ui.w1.name === 'Plugins repo' && load.ui.w1.skills.length === 2 && load.ui.w2.skills.length === 0)
const state = T.normState(rawState)
check('state: lessons and totals', state.length === 2 && state[0].total === 12 && state[0].lessons.length === 2 && state[0].lessons[0].text.startsWith('Restart'))
const mem = T.normMemory(rawMemory)
check('memory: account is a COUNT, never one entry per fact', mem.connected && mem.accountCount === 2 && mem.pinned === 1 && mem.cloud.length === 1 && !('account' in mem))
check('memory: not linked → connected false, not a failure', T.normMemory({ ok: false, connected: false, error: 'non connecte' }).connected === false && T.normMemory({ ok: false, connected: false }).failed === '')
check('memory: linked but the read failed → a failure with the reason', T.normMemory({ ok: false, connected: true, error: 'timeout' }).failed === 'timeout')
const tasks = T.normTasks(rawTasks)
check('tasks: schedule object turned into text', tasks[0].schedule.startsWith('Cron 30 7') && tasks[1].schedule.startsWith('Once'))
check('tasks: history newest first', tasks[0].history[0].status === 'error')
check('tasks: the prompt and the webhook secret are NEVER copied', !JSON.stringify(tasks).includes('TOP-SECRET') && !JSON.stringify(tasks).includes('PRIVATE PROMPT'))
const apps = T.normApps(rawConn, rawMini)
check('apps: only toolkits with an account, plus mini apps', apps.length === 3 && apps.some((a) => a.label === 'Telegram') && !apps.some((a) => a.label === 'empty'))
const ws = T.normWorkspaces([{ workspaceId: 'w1', title: '', sessionIds: ['s1', 's2'], createdAt: iso(100) }, { workspaceId: 'w2', title: 'x', sessionIds: [] }], { s1: { updatedAt: NOW - 86400000 }, s2: { updatedAt: NOW - 5 * 86400000 } }, load.ui)
check('workspaces: workspaceUi name wins over the store title', ws.find((w) => w.id === 'w1').name === 'Plugins repo' && ws.find((w) => w.id === 'w2').name === 'Website')
check('workspaces: updatedAt = newest session', ws.find((w) => w.id === 'w1').updatedAt === NOW - 86400000)
check('workspaces: a workspaceUi entry the store does not know is dropped (stale)', !T.normWorkspaces([{ workspaceId: 'w1', title: 'A', sessionIds: [] }], {}, { w1: { name: 'A', skills: [] }, gone: { name: 'Gone', skills: [] } }).some((w) => w.id === 'gone'))
check('workspaces: with no store (not ready), workspaceUi alone still gives projects', T.normWorkspaces([], {}, { w1: { name: 'A', skills: ['x'] } }).length === 1)
check('workspaces: a bare uuid is shortened', T.normWorkspaces([{ workspaceId: '863b38e2-1e81-4681-8fbf-785251e5708f', sessionIds: [] }], {}, {})[0].name === '863b38e2')

console.log('\n── graph ──')
const src = { workspaces: ws, kybers: load.kybers, skills, state, memory: mem, tasks, apps, active: { s1: ['reviewer'], s2: ['reviewer'] } }
const g = T.buildGraph(src, NOW)
const kind = (k) => g.nodes.filter((n) => n.kind === k)
check('projects: one node per workspace', kind('area').length === 2)
check('kybers: definitions + a ledger-only kyber', kind('kyber').length === 3 && g.byId['k:ghost-kyber'].note.includes('No kyber definition'))
check('kyber is tied to the project of its active sessions (derived)', g.adj['k:reviewer'].has('p:w1') && g.byId['k:reviewer'].area === 'p:w1')
check('skills: duplicate names collapse to one node', kind('skill').filter((n) => n.label === 'pdf').length === 1)
check('skill declared by a kyber is linked (declared)', g.adj['k:reviewer'].has('s:code-review') && g.adj['p:w1'].has('s:code-review'))
check('a skill nobody declares is NOT a problem', g.byId['s:never-declared'].problem === null && g.byId['s:never-declared'].deg === 0)
check('a kyber-local skill is valid, not "not installed"', g.byId['k:writer'].problem === null && g.nodes.some((n) => n.id === 's:local:writer:voice-local'))
check('lessons: one node each, linked to their kyber', kind('lesson').length === 3 && g.adj['k:reviewer'].has('l:reviewer:0'))
check('kyber says how many older lessons exist', g.byId['k:reviewer'].olderLessons === 10)
check('memory: ONE account node (not one per fact) and a cloud memory tied to its project', kind('memory').length === 2 && g.byId['m:account'].note.includes('2 facts') && g.adj['m:cloud:c1'].has('p:w2'))
check('automation tied to a project through its runs\' sessions', g.adj['t:digest'].has('p:w1') && g.byId['t:digest'].area === 'p:w1')
check('automation with no run has no project', g.byId['t:backup'].area === 'none' && g.byId['t:backup'].deg === 0)
check('app ↔ kyber is INFERRED from a tool-name match only', g.links.some((l) => l.s === 'a:toolkit:github' && l.t === 'k:reviewer' && l.kind === 'inferred') && !g.adj['a:toolkit:gmail'].size)

console.log('\n── checks (To check) ──')
const probs = Object.fromEntries(g.problems.map((n) => [n.id, n.problem]))
check('missing skill declared by a kyber → error + a ghost', probs['k:reviewer'] && probs['k:reviewer'].sev === 'err' && g.ghosts.some((x) => x.src === 'k:reviewer' && x.label === 'brand-voice'))
check('missing skill declared by a project → error + a ghost', probs['p:w1'] && probs['p:w1'].sev === 'err' && g.ghosts.some((x) => x.src === 'p:w1' && x.label === 'pitch-deck'))
check('same-name skills in two folders → warning', probs['s:pdf'] && probs['s:pdf'].sev === 'warn')
check('inactive but declared skill → warning naming its owner', probs['s:old-skill'] && probs['s:old-skill'].text.includes('Reviewer'))
check('automation whose last run failed → warning with the reason', probs['t:digest'] && probs['t:digest'].text.includes('Gmail token expired'))
check('errors are listed before warnings', g.problems[0].problem.sev === 'err' && g.problems.findIndex((n) => n.problem.sev === 'warn') > g.problems.map((n) => n.problem.sev).lastIndexOf('err'))
const clean = T.buildGraph({ workspaces: [], kybers: [], skills: [], state: [], memory: null, tasks: [], apps: [], active: {} }, NOW)
check('nothing read → an empty graph, no throw, no problem', clean.nodes.length === 0 && clean.problems.length === 0)
check('sources that were not read (null) do not throw', T.buildGraph({ workspaces: null, kybers: null, skills: null, state: null, memory: null, tasks: null, apps: null, active: null }, NOW).nodes.length === 0)

console.log('\n── Map view ──')
check('hub of a skill = the kyber that declares it', T.hubOf(g, g.byId['s:code-review']) === 'k:reviewer')
check('hub of a project/kyber = itself', T.hubOf(g, g.byId['p:w1']) === 'p:w1' && T.hubOf(g, g.byId['k:writer']) === 'k:writer')
check('hub of an orphan = null', T.hubOf(g, g.byId['s:never-declared']) === null)
const set = T.aroundSet(g, 'p:w1')
check('around a project: its kybers and what they use, not other projects', set.has('k:reviewer') && set.has('s:code-review') && set.has('l:reviewer:0') && !set.has('p:w2'))
const am = T.aroundModel(g, 'p:w1', {})
check('four columns, in order', am.cols.map((c) => c.title).join('|') === 'Project|Kybers & automations|Skills & apps|Memory & lessons')
check('around a kyber, the first column is "Projects"', T.aroundModel(g, 'k:reviewer', {}).cols[0].title === 'Projects')
check('ghost pills are placed in the skills group', am.cols[2].groups[0].ghosts.length === 2 || am.cols[2].groups[0].ghosts.some((x) => x.label === 'pitch-deck'))
check('a line is drawn for each link inside the set, plus one per ghost', am.lines.some((l) => l.s === 'k:reviewer' && l.t === 's:code-review') && am.lines.some((l) => l.t.startsWith('ghost:')))
{
  const big = { workspaces: [{ id: 'w', name: 'P', sessionIds: [], skills: [] }], kybers: [{ id: 'k', name: 'K', mission: '', category: '', skillsDeclared: ['s0', 's1', 's2', 's3', 's4', 's5', 's6'], localSkills: [], tools: [], roles: [] }], skills: Array.from({ length: 7 }, (_, i) => ({ name: 's' + i, description: '', root: '', source: '', active: true, collision: false, modifiedAt: null })), state: [], memory: null, tasks: [], apps: [], active: {} }
  const gb = T.buildGraph(big, NOW)
  const g0 = T.aroundModel(gb, 'k:k', {}).cols[2].groups[0]
  check('a long group shows 5 and says how many are hidden', g0.items.length === 5 && g0.hidden === 2 && g0.total === 7)
  check('expanding shows all of them', T.aroundModel(gb, 'k:k', { ['k:k/skill']: true }).cols[2].groups[0].items.length === 7)
}

console.log('\n── list, picker, default focus ──')
check('list: problems first', T.listRows(g, '')[0].problem !== null)
check('list: filter matches name, note or path', T.listRows(g, 'pdf').some((n) => n.label === 'pdf') && T.listRows(g, 'zzzz').length === 0)
const pk = T.pickerItems(g, '')
check('picker: Projects then Kybers, no skills in the default list', pk[0].head === 'Projects' && pk.some((x) => x.head === 'Kybers') && !pk.some((x) => x.label === 'pdf'))
check('picker: a search finds any kind', T.pickerItems(g, 'pdf').some((x) => x.sub === 'Skill'))
{
  const best = g.nodes.filter((n) => n.kind === 'area' || n.kind === 'kyber').reduce((m, n) => (n.deg > m.deg ? n : m))
  check('default focus: the best-connected project or kyber', T.defaultFocus(g) === best.id && best.deg > 0, [T.defaultFocus(g), best.id, best.deg])
}
check('default focus on an empty graph is null', T.defaultFocus(clean) === null)

console.log('\n── dates and text helpers ──')
check('daysSince: ISO string and ms number', T.daysSince(iso(3), NOW) === 3 && T.daysSince(NOW - 86400000, NOW) === 1 && T.daysSince(null, NOW) === null && T.daysSince('nope', NOW) === null)
check('ago wording', T.ago(0) === 'today' && T.ago(1) === 'yesterday' && T.ago(12) === '12 days ago' && T.ago(90) === '3 months ago' && T.ago(null) === 'not recorded')
check('cut adds an ellipsis only when needed', T.cut('short', 10) === 'short' && T.cut('x'.repeat(20), 10).length === 10)
check('firstSentence', T.firstSentence('Roles: lead. Then more.') === 'Roles: lead')

console.log('\n── what the page may not do ──')
const verbs = SOURCE.match(/method:\s*'([A-Z]+)'/g) || []
check('the only explicit non-GET verb is POST', verbs.every((v) => v.includes("'POST'")))
const posts = (SOURCE.match(/postJson\('([^']+)'/g) || []).map((s) => s.replace(/postJson\('/, '').replace(/'$/, ''))
check('POST only to the two read-only routes', posts.sort().join(',') === '/kybernos/project-data,/kybernos/tasks', posts)
check('tasks are only ever listed', /postJson\('\/kybernos\/tasks', \{ action: 'list' \}\)/.test(SOURCE) && !/action:\s*'(create|update|delete|run|toggle|remove|pause)/.test(SOURCE))
check('no storage of its own', !/localStorage|sessionStorage|indexedDB/.test(SOURCE))
check('no personal path in the source', !/\/Users\/(?!me\b|x\b)[A-Za-z0-9._-]+/.test(SOURCE))
check('every class is prefixed kbat-', !/className:\s*'(?!kbat-)/.test(SOURCE))

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
