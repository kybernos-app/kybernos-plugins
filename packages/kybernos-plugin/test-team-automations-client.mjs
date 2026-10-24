#!/usr/bin/env node
/** The Team segment of the Automations page (client.js, the « Team automations » block): the pure rules, every string in both languages, and the screens rendered
 *  from fixtures: the segment, the lock of each word of the relay, the approved / mine / to-review tables with Install / Update / Installed, and the four sheets
 *  (Propose, Review, Install, Update) with every refusal ending on a button that works again.
 *
 *  No browser: the block is cut out of client.js and run against a few lines of React (function components, the hooks the block uses, effects, state, synchronous
 *  re-render), the page's own helpers (the translation table, the schedule words, the « Where it runs » rules, cut out too) and a fake `fetch` that plays the relay
 *  (/kybernos-cloud/team/automations*) and the local half (/kybernos/automation/team-*). With jsdom (KYBERNOS_JSDOM=<path of jsdom/lib/api.js>) the sheet gets a real
 *  `document`: Escape is a real key event, and the CSS is parsed by a real engine. The same screens in a real page: scripts/check-automations-team-live.mjs.
 *
 *  Usage: node packages/kybernos-plugin/test-team-automations-client.mjs   (exit 0 = all pass) */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 500))) }
}
const here = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(process.env.KB_PLUGIN_CLIENT || join(here, 'client.js'), 'utf8')
const between = (a, b) => {
  const i = SRC.indexOf(a)
  const j = SRC.indexOf(b, i + 1)
  if (i < 0 || j <= i) { console.error('block not found: ' + a); process.exit(1) }
  return SRC.slice(i, j)
}
const BLOCK = between('\n    // <kbta-block>\n', '\n    // </kbta-block>\n')
const CORE = between('\n    // <kbta-core>\n', '\n    // </kbta-core>\n')
const TASKS = between('// KB-TASKS-CLIENT-BEGIN', '// KB-TASKS-CLIENT-END')
const WHERE = between('// <kbwr-core>', '// </kbwr-core>')

// ── the translation table of the page: every single-line entry of KB_T ──
const TABLE = {}
for (const line of SRC.split('\n')) {
  const m = /^\s*'([A-Za-z0-9_.]+)':\s*(\{.*\}),?\s*$/.exec(line)
  if (m !== null) { try { TABLE[m[1]] = (0, eval)('(' + m[2] + ')') } catch (e) { /* not a plain entry */ } }
}
let LANG = 'en'
const kbt = (key) => { const e = TABLE[key]; return e === undefined ? key : (e[LANG] !== undefined ? e[LANG] : e.en) }

// ═════════════════════════════════════════════════════════════════════════════════════════
// 1. The pure rules (<kbta-core>), run as they are in the page
// ═════════════════════════════════════════════════════════════════════════════════════════
const coreNames = [...CORE.matchAll(/^\s{4}const (kbta[A-Za-z]+|KBTA_[A-Z_]+) =/gm)].map((x) => x[1])
const core = await import('data:text/javascript,' + encodeURIComponent(CORE + '\nexport { ' + coreNames.join(', ') + ' }'))

console.log('the rules')
check('the key of an automation: accents off, lower case, one « - » for any other run, 64 characters at most', core.kbtaKeyOf('Rapport Éclair — N°1 (été)') === 'rapport-eclair-n-1-ete' && core.kbtaKeyOf('  --Invoice reminder--  ') === 'invoice-reminder' && core.kbtaKeyOf('A'.repeat(80)).length === 64 && core.kbtaKeyOf('x'.repeat(63) + ' y') === 'x'.repeat(63), [core.kbtaKeyOf('x'.repeat(63) + ' y')])
check('...and a name with nothing in it has no key', core.kbtaKeyOf('???') === '' && core.kbtaKeyOf(undefined) === '' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(core.kbtaKeyOf('Weekly client digest')))
check('a schedule is written as the contract writes it: no zone, one space between fields, a webhook has no cron', JSON.stringify(core.kbtaSchedule({ mode: 'cron', cron: ' 0   9 * *  1 ', tz: 'Asia/Kolkata' })) === '{"mode":"cron","cron":"0 9 * * 1"}' && JSON.stringify(core.kbtaSchedule({ mode: 'webhook', cron: 'x', tz: 'UTC' })) === '{"mode":"webhook"}' && core.kbtaSameSchedule({ mode: 'cron', cron: '0 9 * * 1', tz: 'UTC' }, { mode: 'cron', cron: '0  9 * * 1' }) === true && core.kbtaSameSchedule({ mode: 'webhook' }, { mode: 'cron', cron: '0 9 * * 1' }) === false)
check('the apps are names only: unique, sorted, six at most, nothing that is not a slug', JSON.stringify(core.kbtaNeeds(['slack', 'gmail', 'slack', 'Bad Name', 'x', 7, 'a1', 'b2', 'c3', 'd4', 'e5'])) === '["a1","b2","c3","d4","e5","gmail"]')
{
  const r = core.kbtaRow({ id: 12, key: 'k', name: 'N', description: 'D', version: 'a'.repeat(64), status: 'proposed', schedule: { mode: 'cron', cron: '0 9 * * 1' }, needs: ['slack', 'gmail'], proposed_by_name: 'Camille', proposed_at: '2026-10-22T10:00:00Z', review_note: 'no', replaces: 4, superseded_by: null, mine: true, extra: 'x' })
  check('a row of the server (snake_case) and a row of the relay (camelCase) read the same', r.proposedBy === 'Camille' && r.reviewNote === 'no' && r.replaces === 4 && r.mine === true && r.needs.join() === 'gmail,slack' && core.kbtaRow({ proposedName: 'Camille', reviewedName: 'Julien', supersededBy: 9 }).proposedBy === 'Camille' && core.kbtaRow({ proposedName: 'Camille', reviewedName: 'Julien', supersededBy: 9 }).supersededBy === 9 && r.extra === undefined)
  check('a row that is not an object does not throw', core.kbtaRow(null).name === '' && core.kbtaRow('x').needs.length === 0 && core.kbtaRow([]).id === null)
  check('the version has no number in the contract: the first characters of its hash, or « vN » when the row carries one', core.kbtaVer(r) === '#' + 'a'.repeat(7) && core.kbtaVer({ revision: 4, version: 'b'.repeat(64) }) === 'v4' && core.kbtaVer({ revision: 0, version: 'c'.repeat(64) }) === '#' + 'c'.repeat(7) && core.kbtaVer(null) === '')
}
{
  const item = { key: 'weekly-digest', version: 'v4hash' }
  const copies = [{ taskId: 't1', workspaceId: 'W1', key: 'weekly-digest', version: 'v3hash', edited: true }, { taskId: 't2', workspaceId: 'W2', key: 'weekly-digest', version: 'v4hash', edited: false }]
  check('Install: no copy of that key in this workspace', core.kbtaRelation(item, [], 'W1').kind === 'install' && core.kbtaRelation(item, [{ ...copies[0], key: 'other' }], 'W1').kind === 'install' && core.kbtaRelation(item, null, 'W1').kind === 'install')
  check('Update: a copy of another version (edited or not), Installed: the same version', core.kbtaRelation(item, copies.slice(0, 1), 'W1').kind === 'update' && core.kbtaRelation(item, copies.slice(0, 1), 'W1').edited === true && core.kbtaRelation(item, copies.slice(1), 'W2').kind === 'installed')
  check('a copy from another team is not a copy of this one (same key, other workspace)', core.kbtaRelation(item, copies.slice(1), 'W1').kind === 'install' && core.kbtaRelation(item, copies.slice(1), '').kind === 'installed')
  check('the button: Install is the primary one, Installed is off, and nothing is on while the host has not answered', JSON.stringify([core.kbtaRowButton({ kind: 'install' }, true), core.kbtaRowButton({ kind: 'update' }, true), core.kbtaRowButton({ kind: 'installed' }, true), core.kbtaRowButton({ kind: 'install' }, false)]) === '[{"kind":"install","primary":true,"disabled":false},{"kind":"update","primary":false,"disabled":false},{"kind":"installed","primary":false,"disabled":true},{"kind":"install","primary":true,"disabled":true}]')
}
// every word of the relay → the lock it makes
{
  const kind = (answer, space) => core.kbtaLockKind(answer, space === undefined ? null : space)
  const words = { non_connecte: 'signin', 'non connecte': 'signin', not_signed_in: 'signin', plan_required: 'plan', offre_requise: 'plan', aucun_espace: 'personal', workspace_not_found: 'personal', not_on_this_server: 'server', reconnect_required: 'reconnect', network: 'net', forbidden: 'other', invalid_response: 'other', conflict: 'other', something_else: 'other' }
  const bad = Object.entries(words).filter(([w, k]) => kind({ ok: false, error: w }) !== k).map(([w]) => w + ' → ' + kind({ ok: false, error: w }))
  check('every word of the relay makes its lock (signed out, no plan, no team space, no routes on this server, session over, offline, anything else)', bad.length === 0, bad)
  check('signed out is also said by « connected: false »', kind({ ok: false, connected: false, error: 'non connecte' }) === 'signin' && kind({ ok: false, connected: false }) === 'signin')
  check('a list that is not JSON means kybernos-cloud is not loaded: the tab does not exist', kind(null) === 'absent' && kind('<html>') === 'absent' && kind([]) === 'absent' && kind({ ok: false, error: 'absent' }) === 'absent')
  check('a good answer is no lock', kind({ ok: true, automations: [] }) === null)
  check('a personal space has no plan with the feature either: « plan » becomes « personal » when the account says the active space is personal', kind({ ok: false, error: 'plan_required' }, { personal: true }) === 'personal' && kind({ ok: false, error: 'offre_requise' }, { personal: true }) === 'personal' && kind({ ok: false, error: 'plan_required' }, { personal: false }) === 'plan' && kind({ ok: false, error: 'not_on_this_server' }, { personal: true }) === 'server')
  check('a word that is a property of every object is not a word', kind({ ok: false, error: 'constructor' }) === 'other' && kind({ ok: false, error: '__proto__' }) === 'other' && kind({ ok: false, error: 'toString' }) === 'other')
  const st = { ok: true, connected: true, state: { active_workspace_id: 'W1', workspaces: [{ id: 'W0', name: 'Perso', personal: true }, { id: 'W1', name: 'Acme Studio', personal: false }], space_plan: { workspace_id: 'W1', key: 'plus' } } }
  const sp = core.kbtaSpaceOf(st)
  check('the account state names the active space, tells personal from team and gives the plan of THAT space', sp.id === 'W1' && sp.name === 'Acme Studio' && sp.personal === false && sp.plan === 'Plus' && core.kbtaSpaceOf({ ok: true, state: { ...st.state, active_workspace_id: 'W0' } }).personal === true && core.kbtaSpaceOf({ ok: true, state: { ...st.state, space_plan: { workspace_id: 'W0', key: 'team' } } }).plan === '' && core.kbtaSpaceOf(null).id === '' && core.kbtaSpaceOf({ error: 'absent' }).name === '')
  check('the initial of the segment: the first letter of the team, upper case', core.kbtaInitial('acme studio') === 'A' && core.kbtaInitial('  Équipe') === 'É' && core.kbtaInitial('') === '' && core.kbtaInitial(undefined) === '')
}
check('a member has no « To review »; an owner and an admin do', core.kbtaView('review', 'member') === 'approved' && core.kbtaView('review', 'admin') === 'review' && core.kbtaView('review', 'owner') === 'review' && core.kbtaView('mine', 'member') === 'mine' && core.kbtaView('nope', 'admin') === 'approved')
check('search: every word, accents and case ignored, in the name, the description and the author', core.kbtaMatch({ name: 'Rapport Éclair', description: 'Daily', proposedBy: 'Léa', key: 'k' }, 'eclair rapport') === true && core.kbtaMatch({ name: 'Rapport', description: 'Daily', proposedBy: 'Léa', key: 'k' }, 'lea') === true && core.kbtaMatch({ name: 'Rapport', description: 'Daily', proposedBy: null, key: 'k' }, 'weekly') === false && core.kbtaMatch({ name: 'x', description: '', proposedBy: null, key: 'k' }, '   ') === true)

// the diff, computed from what the copy was against what is on offer
{
  const d = core.kbtaLineDiff('Summarise the e-mails.\nPost the digest in #clients.\nNever reply yourself.', 'Summarise the e-mails, grouped by client.\nPost the digest in #clients and mention the owner.\nNever reply yourself.')
  check('the diff names the lines taken out, the lines put in and keeps the line that did not change', JSON.stringify(d.map((l) => l.k)) === '["del","del","add","add","ctx"]' || JSON.stringify(d.map((l) => l.k)) === '["del","add","del","add","ctx"]', d)
  check('a long text keeps two lines of context around each change and says where it cut (before, between, after)', (() => { const a = Array.from({ length: 30 }, (_, i) => 'line ' + i); const b = a.slice(); b[15] = 'changed'; const out = core.kbtaLineDiff(a.join('\n'), b.join('\n')); return out[0].k === 'gap' && out[out.length - 1].k === 'gap' && out.filter((l) => l.k === 'ctx').length === 4 && out.length === 8 })())
  check('...two changes far apart are separated by a cut, two close ones are not', (() => { const a = Array.from({ length: 40 }, (_, i) => 'line ' + i); const b = a.slice(); b[5] = 'x'; b[30] = 'y'; const far = core.kbtaLineDiff(a.join('\n'), b.join('\n')); const c = a.slice(); c[5] = 'x'; c[8] = 'y'; const near = core.kbtaLineDiff(a.join('\n'), c.join('\n')); return far.filter((l) => l.k === 'gap').length === 3 && near.filter((l) => l.k === 'gap').length === 2 })())
  check('two identical texts have nothing to show', core.kbtaLineDiff('a\nb', 'a\nb').length === 1 && core.kbtaLineDiff('a\nb', 'a\nb')[0].k === 'gap' || core.kbtaLineDiff('a\nb', 'a\nb').every((l) => l.k !== 'add' && l.k !== 'del'))
  check('a text too long to compare says so (null), it does not freeze the page', core.kbtaLineDiff('x\n'.repeat(500), 'y') === null)
  const was = { name: 'Weekly digest', prompt: 'A\nB', schedule: { mode: 'cron', cron: '30 8 * * 1-5' }, needs: ['gmail', 'slack'] }
  const same = core.kbtaChanges(was, { ...was, schedule: { mode: 'cron', cron: '30  8 * * 1-5', tz: 'UTC' } })
  check('nothing changed when only the spelling of the schedule did', same.same === true && same.prompt === false && same.when === false)
  const ch = core.kbtaChanges(was, { name: 'Weekly digest v2', prompt: 'A\nB\nC', schedule: { mode: 'cron', cron: '0 9 * * 1' }, needs: ['gmail', 'zendesk'] })
  check('what changed: the name, the time, the apps (added and removed) and the prompt', ch.name && ch.when && ch.needs && ch.prompt && ch.added.join() === 'zendesk' && ch.removed.join() === 'slack' && ch.diff.some((l) => l.k === 'add' && l.t === 'C') && ch.same === false)
  check('...and a base that is not there is a change of everything, not a crash', core.kbtaChanges(null, was).prompt === true && core.kbtaChanges(undefined, null).same === true)
}
check('an update starts on the choice that loses nothing: an edited copy is saved aside, an untouched one is replaced', core.kbtaUpdateStart(true) === 'both' && core.kbtaUpdateStart(false) === 'replace' && core.KBTA_UPDATE_MODES.join() === 'keep,both,replace')
check('the line of a secret is shown with the secret hidden: a word with a digit in it, or a very long one, keeps its first letters', (() => {
  const m = core.kbtaMask('Use the key sk-live-4242424242 to read the invoices in #finance, e-mail user@x.io and follow-up.')
  return m.indexOf('4242') < 0 && m.indexOf('invoices') >= 0 && m.indexOf('#finance') >= 0 && m.indexOf('follow-up') >= 0 && m.indexOf('•') > 0 && core.kbtaMask('x'.repeat(30)).indexOf('xxxxxxxx') < 0 && core.kbtaMask('a'.repeat(200)).length < 170 && core.kbtaMask(undefined) === ''
})())
check('line N of a prompt, 1-based; nothing outside', core.kbtaLineOf('a\nb\nc', 2) === 'b' && core.kbtaLineOf('a\nb', 3) === '' && core.kbtaLineOf('a', 0) === '' && core.kbtaLineOf('a', 1.5) === '' && core.kbtaLineOf(null, 1) === '')
check('where the scan hit: the field and, for the prompt, the line; the match is never in the answer', JSON.stringify(core.kbtaScanHit({ error: 'scan_rejected', field: 'prompt', line: 3 })) === '{"field":"prompt","line":3}' && JSON.stringify(core.kbtaScanHit({ error: 'scan_rejected', field: 'name', line: 3 })) === '{"field":"name","line":null}' && core.kbtaScanHit({ error: 'scan_rejected', field: 'note' }).field === 'note' && core.kbtaScanHit({ error: 'scan_rejected' }).field === 'prompt' && core.kbtaScanHit({ error: 'duplicate' }) === null && core.kbtaScanHit(null) === null)
{
  const body = core.kbtaProposalBody({ key: 'k', name: '  Name  ', prompt: '\n Prompt text \n', schedule: { mode: 'cron', cron: '0 9 * * 1', tz: 'UTC' }, needs: ['slack', 'gmail'], version: 'x', description: 'ignored', secret: 'no' }, '  A description.  ', '  ')
  check('the proposal goes TRIMMED (name, description, prompt), with the description of the field and no zone, no note when empty, nothing the host did not pack', JSON.stringify(body) === '{"key":"k","name":"Name","description":"A description.","prompt":"Prompt text","schedule":{"mode":"cron","cron":"0 9 * * 1"},"needs":["gmail","slack"]}', body)
  check('...with the note when there is one', core.kbtaProposalBody({}, 'd', '  Why not  ').note === 'Why not')
  check('the description counts its TRIMMED length: 1 to 500', core.kbtaDescriptionOk('a') && core.kbtaDescriptionOk('  a  ') && core.kbtaDescriptionOk('a'.repeat(500)) && !core.kbtaDescriptionOk('a'.repeat(501)) && !core.kbtaDescriptionOk('   ') && !core.kbtaDescriptionOk('') && core.kbtaDescriptionOk(' '.repeat(50) + 'a'.repeat(500) + ' '.repeat(50)) && core.kbtaDescriptionLen('  ab ') === 2)
  check('the note is at most 2 000 characters, and is never cut for the person', core.KBTA_LIMITS.note === 2000 && core.kbtaNoteOk('x'.repeat(2000)) && !core.kbtaNoteOk('x'.repeat(2001)) && core.kbtaNoteOk('') && core.kbtaNoteOk(' '.repeat(3000)) && core.kbtaProposalBody({}, 'd', 'x'.repeat(2500)).note.length === 2500)
}
{
  const item = { id: 12, key: 'k', name: 'N', description: 'D', prompt: 'P', schedule: { mode: 'cron', cron: '0 9 * * 1', tz: 'UTC' }, needs: ['bb', 'aa'], version: 'v' }
  const b = core.kbtaInstallBody(item, 'W1', 'bogus', 1)
  check('the install body: the approved definition with its server id and no zone, the workspace, « ask » unless « auto », a real boolean for the switch', JSON.stringify(b) === '{"definition":{"id":12,"key":"k","name":"N","description":"D","prompt":"P","schedule":{"mode":"cron","cron":"0 9 * * 1"},"needs":["aa","bb"],"version":"v"},"workspaceId":"W1","approvals":"ask","turnOn":false}' && core.kbtaInstallBody(item, 'W1', 'auto', true).approvals === 'auto' && core.kbtaInstallBody(item, 'W1', 'auto', true).turnOn === true, b)
  check('an every-minute rhythm is sent only after a yes', 'confirmFrequent' in b === false && core.kbtaInstallBody(item, 'W1', 'ask', false, true).confirmFrequent === true && 'confirmFrequent' in core.kbtaUpdateBody('t1', item, 'both') === false && core.kbtaUpdateBody('t1', item, 'both', true).confirmFrequent === true)
  check('the update body: the copy, the definition, and one of three modes (anything else is « replace »)', core.kbtaUpdateBody('t1', item, 'both').mode === 'both' && core.kbtaUpdateBody('t1', item, 'keep').mode === 'keep' && core.kbtaUpdateBody('t1', item, 'nope').mode === 'replace' && core.kbtaUpdateBody('t1', item, 'both').taskId === 't1' && core.kbtaUpdateBody('t1', item, 'both').definition.id === 12)
  check('the host’s question about a very frequent rhythm is not an error', core.kbtaIsFrequent({ ok: false, error: 'frequent schedule', everyMinutes: 1 }) === true && core.kbtaIsFrequent({ ok: false, error: 'other' }) === false && core.kbtaIsFrequent({ ok: true }) === false && core.kbtaIsFrequent(null) === false)
}
{
  const conn = { ok: true, configured: true, connections: [{ toolkit: 'gmail', accounts: [{ id: 1 }] }, { toolkit: 'slack', accounts: [] }] }
  check('an app is connected when the connectors plugin reports an account for it; not known while nothing was read', core.kbtaConnected(conn, 'gmail') === true && core.kbtaConnected(conn, 'slack') === false && core.kbtaConnected(conn, 'zendesk') === false && core.kbtaConnected(null, 'gmail') === null && core.kbtaConnected({ ok: false }, 'gmail') === null)
  check('the switch « Turn it on » is off while an app is missing AND while it cannot be told', JSON.stringify(core.kbtaTurnOn(['gmail'], conn)) === '{"allowed":true,"missing":[],"known":true}' && core.kbtaTurnOn(['gmail', 'zendesk'], conn).allowed === false && core.kbtaTurnOn(['gmail', 'zendesk'], conn).missing.join() === 'zendesk' && core.kbtaTurnOn(['gmail'], null).allowed === false && core.kbtaTurnOn(['gmail'], null).known === false && core.kbtaTurnOn([], null).allowed === true)
}
check('the apps of a list of rows, once each', core.kbtaSlugsOf([{ needs: ['slack', 'gmail'] }, { needs: ['gmail'] }, null, { needs: 'x' }]).join() === 'gmail,slack')
check('the local automation behind a team item: its own mark first, else the same key', (() => {
  const tasks = [{ id: 'a', name: 'Digest renamed', team: { key: 'weekly-digest' } }, { id: 'b', name: 'Weekly digest' }, { id: 'c', name: 'Suggested one', suggested: true }]
  return core.kbtaTaskForKey(tasks, 'weekly-digest').id === 'a' && core.kbtaTaskForKey(tasks.slice(1), 'weekly-digest').id === 'b' && core.kbtaTaskForKey(tasks, 'suggested-one') === null && core.kbtaTaskForKey(null, 'x') === null
})())

// ═════════════════════════════════════════════════════════════════════════════════════════
// 2. Every string, in both languages
// ═════════════════════════════════════════════════════════════════════════════════════════
console.log('the words')
{
  const used = new Set()
  // The places that use the words: the block, and the few lines of the page that wire it in (the row action, the menu entry, the marks). The table itself is not a use.
  const wired = SRC.split('\n').filter((l) => /\bkbta\./.test(l) && !/^\s*'kbta\.[A-Za-z0-9_.]+':\s*\{/.test(l)).join('\n')
  for (const m of (BLOCK + '\n' + wired).matchAll(/['"](kbta\.[a-z0-9_.]+)['"]/gi)) if (!m[1].endsWith('.')) used.add(m[1])
  for (const m of BLOCK.matchAll(/\bkbt\('(kb[a-z]+\.[A-Za-z0-9_.]+)'\)/g)) used.add(m[1])
  // the keys the block builds from a word
  const built = []
  for (const k of ['plan', 'signin', 'personal', 'server', 'net', 'reconnect', 'other']) built.push('kbta.lock.' + k + '.t', 'kbta.lock.' + k + '.b')
  for (const k of ['approved', 'mine', 'review']) built.push('kbta.empty.' + k + '.t', 'kbta.empty.' + k + '.b')
  for (const i of [1, 2, 3, 4, 5]) built.push('kbta.never.' + i)
  for (const k of ['both', 'when', 'needs']) built.push('kbta.same.' + k)
  for (const k of ['proposed', 'rejected', 'retired', 'approved']) built.push('kbta.st.' + k)
  for (const k of ['name', 'desc', 'note']) built.push('kbta.ck.' + k)
  for (const k of ['key', 'name', 'description', 'prompt', 'schedule', 'needs', 'binary', 'too_large']) built.push('kbta.e.invalid.' + k)
  for (const k of ['block.off', 'block.none', 'block.old', 'block.webhook']) built.push('kbwr.' + k)
  const words = ['admin_required', 'plan_required', 'offre_requise', 'scan_rejected', 'duplicate', 'not_pending', 'not_approved', 'team_full', 'too_many_proposals', 'too_large', 'not_found', 'not_on_this_server', 'reconnect_required', 'network', 'non_connecte', 'aucun_espace', 'workspace_not_found', 'forbidden', 'conflict', 'bad_request', 'invalid_response', 'absent', 'invalid_automation', 'once_not_shareable', 'empty_prompt', 'version_mismatch', 'already_installed', 'invalid_workspace', 'store_unreadable', 'not_edited', 'key_mismatch', 'not_a_team_copy', 'invalid_mode', 'invalid_schedule', 'frequent_schedule', 'other']
  for (const w of words) built.push('kbta.e.' + w)
  const all = [...used, ...built].filter((k) => k !== 'kbta.' && /^kb[a-z]+\.[a-z]/.test(k))
  const missing = [...new Set(all)].filter((k) => TABLE[k] === undefined || typeof TABLE[k].en !== 'string' || TABLE[k].en.trim() === '' || typeof TABLE[k].kybernos !== 'string' || TABLE[k].kybernos.trim() === '')
  check('every key the block uses exists in both languages (' + new Set(all).size + ' keys)', missing.length === 0, missing)
  const mine = Object.keys(TABLE).filter((k) => k.startsWith('kbta.'))
  const dead = mine.filter((k) => !all.includes(k))
  check('...and no key of the block is dead (' + mine.length + ' defined)', dead.length === 0, dead)
  const holes = (s) => (s.match(/\{[a-z]+\}/g) || []).sort().join()
  const drift = mine.filter((k) => holes(TABLE[k].en) !== holes(TABLE[k].kybernos))
  check('French and English hold the same {holes} in every sentence', drift.length === 0, drift)
  const same = mine.filter((k) => TABLE[k].en === TABLE[k].kybernos && !/^kbta\.(p\.desc\.count|p\.note\.count|team|th\.version)$/.test(k))
  check('...and the French is not the English copied', same.length === 0, same)
  const dup = {}
  for (const line of SRC.split('\n')) { const m = /^\s*'(kbta\.[A-Za-z0-9_.]+)':\s*\{/.exec(line); if (m !== null) dup[m[1]] = (dup[m[1]] || 0) + 1 }
  check('no key is defined twice (the second would win in silence)', Object.keys(dup).filter((k) => dup[k] > 1).length === 0)
  check('the English of the mockup is the English of the page', TABLE['kbta.p.sent'] === undefined && TABLE['kbta.sent.t'].en === 'Sent for review' && TABLE['kbta.propose.menu'].en === 'Propose to team…' && TABLE['kbta.i.ask'].en === 'Ask me first' && TABLE['kbta.i.recommended'].en === 'recommended' && TABLE['kbta.lock.server.t'].en === 'Not available on this server' && TABLE['kbta.lock.personal.t'].en === 'Team automations are for team spaces' && TABLE['kbta.r.go.refuse'].en === 'Refuse and send the reason' && TABLE['kbta.u.both'].en === 'Save mine as a separate automation, then update' && TABLE['kbta.search'].en === 'Search the team’s automations…')
  const english = (s) => s.replace(/\{[a-z]+\}/g, '')
  check('no sentence names a person’s path, a colour or a hard-coded app', mine.every((k) => !/\/Users\/|#[0-9a-f]{6}\b/i.test(TABLE[k].en + TABLE[k].kybernos)))
  check('the block draws no text of its own: every child of an element is a call to kbt / kbtaT / kbtaSay, a variable, or a character glyph', !/h\('(?:span|div|button|b|label)'[^\n]*\},\s*'[A-Za-z][a-z]+(?: [a-z]+)+'/.test(BLOCK.replace(/\/\/.*$/gm, '')))
  void english
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// 3. The screens, rendered from fixtures
// ═════════════════════════════════════════════════════════════════════════════════════════
let CURRENT = null
const INFLIGHT = { n: 0 }
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
const flat = (list) => list.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true)
const React = {
  Fragment: 'fragment',
  createElement (type, props, ...children) {
    const p = Object.assign({}, props || {})
    const kids = flat(children)
    if (kids.length === 1) p.children = kids[0]
    else if (kids.length > 1) p.children = kids
    return { $$: true, type, props: p, key: p.key !== undefined && p.key !== null ? String(p.key) : null, kids }
  },
  useState (init) {
    const slot = CURRENT.slot()
    if (slot.state === undefined) {
      const root = CURRENT.root
      slot.state = { v: typeof init === 'function' ? init() : init }
      slot.set = (nv) => { const v = typeof nv === 'function' ? nv(slot.state.v) : nv; if (!Object.is(v, slot.state.v)) { slot.state.v = v; root.pending = true } }
    }
    return [slot.state.v, slot.set]
  },
  useRef (init) { const slot = CURRENT.slot(); if (slot.ref === undefined) slot.ref = { current: init }; return slot.ref },
  useMemo (fn, deps) { const slot = CURRENT.slot(); if (slot.memo === undefined || !same(slot.deps, deps)) { slot.memo = { v: fn() }; slot.deps = deps } return slot.memo.v },
  useCallback (fn, deps) { return React.useMemo(() => fn, deps) },
  useEffect (fn, deps) {
    const slot = CURRENT.slot()
    if (slot.ran !== true || deps === undefined || !same(slot.deps, deps)) CURRENT.root.effects.push({ slot, fn })
    slot.deps = deps
  }
}
const mount = (element) => {
  const root = {
    pending: false, effects: [], instances: new Map(), tree: null,
    render () {
      const seen = new Set()
      const visit = (el, path) => {
        if (el === null || el === undefined || typeof el === 'boolean') return null
        if (typeof el === 'string' || typeof el === 'number') return { text: String(el) }
        if (Array.isArray(el)) return { tag: '#', props: {}, children: flat(el).map((c, i) => visit(c, path + '.' + (c && c.key !== null && c.key !== undefined ? c.key : i))).filter((c) => c !== null) }
        if (typeof el.type === 'function') {
          seen.add(path)
          let inst = root.instances.get(path)
          if (inst === undefined) { inst = { slots: [], i: 0 }; root.instances.set(path, inst) }
          inst.i = 0
          const prev = CURRENT
          CURRENT = { root, slot: () => { const k = inst.i++; if (inst.slots[k] === undefined) inst.slots[k] = {}; return inst.slots[k] } }
          let out
          try { out = el.type(el.props) } finally { CURRENT = prev }
          return visit(out, path + '>')
        }
        const children = flat(el.kids).map((c, i) => visit(c, path + '/' + (c && c.key !== null && c.key !== undefined ? c.key : i))).filter((c) => c !== null)
        return { tag: el.type, props: el.props, children }
      }
      root.effects = []
      root.tree = visit(element, 'r')
      for (const [p, inst] of [...root.instances]) {
        if (seen.has(p)) continue
        for (const s of inst.slots) if (typeof s.cleanup === 'function') { try { s.cleanup() } catch (e) { /* unmount */ } }
        root.instances.delete(p)
      }
      const todo = root.effects
      for (const e of todo) { if (typeof e.slot.cleanup === 'function') { try { e.slot.cleanup() } catch (err) { /* cleanup */ } } }
      for (const e of todo) { e.slot.ran = true; const c = e.fn(); e.slot.cleanup = typeof c === 'function' ? c : undefined }
    },
    async settle () {
      for (let quiet = 0, laps = 0; quiet < 4;) {
        if (++laps > 600) throw new Error('the screen never settles (a state that changes on every render?)')
        let rounds = 0
        while (root.pending === true && rounds++ < 60) { root.pending = false; root.render() }
        await new Promise((r) => setTimeout(r, 3))
        if (root.pending === true || INFLIGHT.n > 0) quiet = 0
        else quiet += 1
      }
    }
  }
  root.render()
  return root
}
const walk = (node, fn) => { if (node === null || node === undefined) return; fn(node); for (const c of node.children || []) walk(c, fn) }
const all = (root, pred) => { const out = []; walk(root.tree !== undefined ? root.tree : root, (n) => { if (n.tag !== undefined && n.tag !== '#' && pred(n)) out.push(n) }); return out }
const textOf = (n) => (n.text !== undefined ? n.text : (n.children || []).map(textOf).join(''))
const kb = (root, name) => all(root, (n) => n.props['data-kb'] === name)
const kbAll = (root, prefix) => all(root, (n) => typeof n.props['data-kb'] === 'string' && n.props['data-kb'].startsWith(prefix))
const page = (root) => textOf(root.tree).replace(/\s+/g, ' ')
const part = (root, name) => { const n = kb(root, name)[0]; return n === undefined ? '' : textOf(n).replace(/\s+/g, ' ').trim() }
const click = async (root, node, label) => {
  if (node === undefined) { check('there is something to click' + (label === undefined ? '' : ' (' + label + ')'), false, new Error('at').stack.split('\n')[2].trim()); return false }
  if (node.props.disabled === true) { check('the button is enabled' + (label === undefined ? '' : ' (' + label + ')'), false, textOf(node)); return false }
  if (typeof node.props.onClick !== 'function') { check('the node is clickable' + (label === undefined ? '' : ' (' + label + ')'), false, node.tag); return false }
  node.props.onClick({ target: node, currentTarget: node, stopPropagation () {}, preventDefault () {}, key: 'Enter' })
  await root.settle()
  return true
}
const type = async (root, node, value) => { node.props.onChange({ target: { value }, currentTarget: { value } }); await root.settle() }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── the page's own helpers, cut out and run ──
let JSDOM = null
try { ({ JSDOM } = await import(process.env.KYBERNOS_JSDOM || 'jsdom')) } catch (e) { JSDOM = null }
const dom = JSDOM === null ? null : new JSDOM('<!doctype html><body></body>', { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true })
const fakeDoc = (() => {
  const ls = []
  return { activeElement: null, addEventListener: (t, f, c) => ls.push([t, f, c]), removeEventListener: (t, f) => { const i = ls.findIndex((x) => x[0] === t && x[1] === f); if (i >= 0) ls.splice(i, 1) }, press: (key) => { const ev = { key, stopPropagation () {}, preventDefault () {}, shiftKey: false }; for (const [t, f] of ls.slice()) if (t === 'keydown') f(ev) }, count: () => ls.length }
})()
const doc = dom !== null ? dom.window.document : fakeDoc
const world = {
  calls: [], events: [], opened: [], relay: null, local: null, status: null, server: null, computers: null, conn: null, delay: 0,
}
const reply = (answer) => {
  if (answer === undefined) return { ok: false, status: 404, json: async () => { throw new Error('not json') } }
  return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(answer)) }
}
const fakeFetch = async (url, opts) => {
  INFLIGHT.n += 1
  try {
    const u = new URL(String(url), 'http://x')
    const method = opts && opts.method ? opts.method : 'GET'
    const body = opts && opts.body ? JSON.parse(opts.body) : null
    world.calls.push({ method, path: u.pathname, query: u.search, body })
    if (world.delay > 0) await sleep(world.delay)
    if (u.pathname.startsWith('/kybernos-cloud/team/automations')) return reply(world.relay(method, u.pathname.slice('/kybernos-cloud/team/automations'.length), new URLSearchParams(u.search), body))
    if (u.pathname.startsWith('/kybernos/automation/')) return reply(world.local(u.pathname.slice('/kybernos/automation/'.length), body))
    if (u.pathname === '/kybernos-cloud/status') return reply(world.status)
    if (u.pathname === '/kybernos-cloud/server') return reply(world.server)
    if (u.pathname === '/kybernos-cloud/computers/publish') return reply(world.publish === undefined ? { ok: true } : world.publish(body))
    return reply(undefined)
  } finally { INFLIGHT.n -= 1 }
}
const timers = new Set()
const ctxSetTimeout = (f, ms) => { const id = setTimeout(() => { timers.delete(id); INFLIGHT.n -= 1; f() }, ms); timers.add(id); INFLIGHT.n += 1; return id }
const ctxClearTimeout = (id) => { if (timers.delete(id)) INFLIGHT.n -= 1; clearTimeout(id) }
const events = []
const sandbox = {
  console, Promise, Date, Math, JSON, Array, Object, String, Number, Set, Map, Intl, URL, RegExp, Error, Symbol, Boolean, isFinite, parseInt, parseFloat,
  fetch: fakeFetch, setTimeout: ctxSetTimeout, clearTimeout: ctxClearTimeout, document: doc,
  window: { dispatchEvent: (e) => { events.push(e); return true } },
  CustomEvent: class { constructor (name, init) { this.type = name; this.detail = init && init.detail } },
  React, kbt: (k) => kbt(k),
  Icon: (name, size) => React.createElement('svg', { 'data-icon': name, width: size }),
  kbPortalDe: (el) => el,
  kbUseConnRev: () => 0,
  kbComposioConnections: () => world.conn,
  kbAppName: (slug) => ({ gmail: 'Gmail', slack: 'Slack', zendesk: 'Zendesk', browser: 'Browser' })[slug] || slug,
  kbBoardLocale: () => 'en',
  kbRunAgo: (ms) => (Date.now() - ms < 86400000 ? '2 hours ago' : 'yesterday'),
  kbWhenOf: () => 'Oct 22 · 10:00',
  kbIn: () => '',
  kbBone: (w, hh, extra) => React.createElement('span', { className: 'kb-sk-bone' + (extra ? ' ' + extra : ''), 'aria-hidden': 'true' }),
  kbSkelWrap: (label, className, children) => React.createElement('div', { className: 'kb-sk ' + className, role: 'status', 'data-kb': 'skeleton', 'aria-label': label }, children),
  kbOpenSettingsPage: (names) => { world.opened.push(names) },
  KbConfirm: (p) => React.createElement('div', { role: 'alertdialog', 'data-kb': 'confirm', title: p.title }, React.createElement('b', null, p.title), React.createElement('p', null, p.body),
    React.createElement('button', { 'data-kb': 'confirm-cancel', onClick: p.onClose }, 'cancel'), React.createElement('button', { 'data-kb': 'confirm-yes', onClick: async () => { await p.onConfirm(); p.onClose() } }, p.confirmLabel)),
  kbwPost: (computerId, ops) => fakeFetch('/kybernos-cloud/computers/publish', { method: 'POST', body: JSON.stringify({ computerId, ops }) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'unreachable' })),
  kbwErrText: (code) => 'cloud:' + String(code),
}
sandbox.h = React.createElement
vm.createContext(sandbox)
vm.runInContext(TASKS, sandbox)
vm.runInContext('const kbScheduleLabel = (t, withHook) => { const p = kbTriggerParts(t, kbt, kbBoardLocale(), kbMachineTz()); return withHook === true && p.hooked === true ? p.label + " + " + kbt("tasks.trigger.webhook") : p.label }', sandbox)
vm.runInContext(BLOCK, sandbox)
const X = vm.runInContext('({ KbTeamAutomations, KbTeamLocked, KbTaSheet, kbtaUseSummary, kbtaSegment, kbtaRowMark, kbtaRowShared, kbtaSay, kbtaCall, kbtaItemOf, kbtaKindOf, kbtaChip })', sandbox)
vm.runInContext('globalThis.__kbta = null', sandbox)

// ── the fixtures: a team of Acme Studio, its approved automations, the local half ──
const H = (c) => c.repeat(64)
const srow = (id, key, name, over) => ({
  id, key, name, description: 'About ' + name, version: H(String(id % 10)), status: 'approved', schedule: { mode: 'cron', cron: '0 9 * * 1' }, needs: ['gmail', 'slack'], prompt_chars: 120,
  proposed_by_name: 'Léa Martin', proposed_at: new Date(Date.now() - 3 * 3600000).toISOString(), reviewed_by_name: 'Julien Petit', reviewed_at: new Date(Date.now() - 2 * 3600000).toISOString(),
  note: null, review_note: null, replaces: null, superseded_by: null, mine: false, revision: id % 5 + 1, ...over,
})
const PROMPT_OLD = 'Summarise the client e-mails of the week.\nPost the digest in #clients.\nNever reply to a client yourself.'
const PROMPT_NEW = 'Summarise the client e-mails of the week, grouped by client.\nPost the digest in #clients and mention the account owner.\nNever reply to a client yourself.'
const fixtures = () => {
  const rows = [
    srow(1, 'weekly-client-digest', 'Weekly client digest', { version: H('4'), revision: 4, schedule: { mode: 'cron', cron: '30 8 * * 1-5' }, proposed_by_name: 'Léa Martin' }),
    srow(2, 'daily-stock-check', 'Daily stock check', { version: H('1'), revision: 1, schedule: { mode: 'cron', cron: '0 8 * * *' }, needs: ['browser'], proposed_by_name: 'Karim Benali' }),
    srow(3, 'morning-ticket-triage', 'Morning ticket triage', { version: H('2'), revision: 2, schedule: { mode: 'cron', cron: '30 8 * * 1-5' }, needs: ['slack', 'zendesk'], proposed_by_name: 'Sofia Rossi' }),
    srow(4, 'monthly-expenses-report', 'Monthly expenses report', { version: H('7'), revision: 1, schedule: { mode: 'cron', cron: '0 9 1 * *' }, needs: ['gmail'], proposed_by_name: 'Camille Roy' }),
    srow(5, 'invoice-reminder', 'Invoice reminder', { version: H('5'), status: 'proposed', mine: true, reviewed_by_name: null, reviewed_at: null, proposed_by_name: 'Sara M.', revision: undefined, proposed_at: new Date(Date.now() - 30 * 3600000).toISOString() }),
    srow(6, 'meeting-prep', 'Meeting prep', { version: H('6'), status: 'rejected', mine: true, review_note: 'The prompt contains a customer’s phone number. Remove it and propose again.', revision: undefined }),
    srow(7, 'weekly-client-digest', 'Weekly client digest', { version: H('8'), status: 'proposed', replaces: 1, schedule: { mode: 'cron', cron: '30 8 * * 1-5' }, proposed_by_name: 'Léa Martin', reviewed_by_name: null, reviewed_at: null, revision: undefined, note: 'Added the account owner.' }),
    srow(8, 'old-newsletter-draft', 'Old newsletter draft', { version: H('9'), status: 'retired', mine: true, revision: undefined }),
    srow(9, 'competitor-watch', 'Competitor watch', { version: H('3'), status: 'proposed', mine: false, proposed_by_name: 'Camille Roy', reviewed_by_name: null, reviewed_at: null, schedule: { mode: 'webhook' }, needs: ['browser'], revision: undefined }),
  ]
  const prompts = { 1: PROMPT_NEW, 2: 'Read the supplier prices.', 3: 'Sort the tickets.', 4: 'Collect receipts.', 5: 'Remind the clients.', 6: 'Prepare my meetings.', 7: PROMPT_NEW + '\nAlso mention the owner.', 8: 'Old.', 9: 'Open the pages.' }
  const w = { rows, prompts, role: 'member', tasks: [], copies: [], lock: null, added: [], reviewed: [], calls: world.calls }
  return w
}
const setWorld = (w) => {
  world.calls.length = 0
  world.events = events
  events.length = 0
  world.opened = []
  world.delay = 0
  world.publish = undefined
  world.fx = w
  const admin = () => w.role === 'admin' || w.role === 'owner'
  const listFor = (view) => (view === 'approved' ? w.rows.filter((r) => r.status === 'approved') : (view === 'proposed' ? w.rows.filter((r) => r.status === 'proposed' && (admin() || r.mine)) : (view === 'mine' ? w.rows.filter((r) => r.mine) : w.rows)))
  world.relay = (method, path, q, body) => {
    if (w.lock !== null) return typeof w.lock === 'function' ? w.lock(method, path, body) : w.lock
    if (path === '') {
      const view = q.get('view') || 'approved'
      if (view === 'proposed' && !admin()) return { ok: false, error: 'admin_required' }
      const rows = listFor(view)
      return { ok: true, connected: true, role: w.role, view, total: rows.length, limit: Number(q.get('limit')), offset: 0, workspaceName: 'Acme Studio', workspaceId: 'W1', counts: { approved: w.rows.filter((r) => r.status === 'approved').length, pending: listFor('proposed').length }, automations: rows.map((r) => ({ ...r, prompt: undefined })) }
    }
    if (path === '/item') {
      const id = Number(q.get('id'))
      const r = w.rows.find((x) => x.id === id)
      if (r === undefined) return { ok: false, error: 'not_found' }
      return { ok: true, automation: { ...r, prompt: w.prompts[id] } }
    }
    if (path === '/check') { w.checks = (w.checks || []).concat([body]); return w.check === undefined ? { ok: true, version: H('c') } : (typeof w.check === 'function' ? w.check(body) : w.check) }
    if (path === '/add') { w.added.push(body); return w.add === undefined ? { ok: true, automation: { ...srow(50, body.key, body.name, { status: admin() ? 'approved' : 'proposed', mine: true }) } } : (typeof w.add === 'function' ? w.add(body) : w.add) }
    if (path === '/review') { w.reviewed.push(body); return w.review === undefined ? { ok: true } : (typeof w.review === 'function' ? w.review(body) : w.review) }
    if (path === '/retire') { w.retired = (w.retired || []).concat([body]); return { ok: true } }
    if (path === '/delete') { w.deleted = (w.deleted || []).concat([body]); return { ok: true } }
    return undefined
  }
  world.local = (path, body) => {
    if (w.hostOld === true) return undefined
    w.localCalls = (w.localCalls || []).concat([[path, body]])
    if (path === 'team-copies') return w.copiesAnswer !== undefined ? w.copiesAnswer : { ok: true, copies: w.copies }
    if (path === 'team-pack') { const t = w.tasks.find((x) => x.id === body.id); if (t === undefined) return { ok: false, error: 'not_found' }; if (w.pack !== undefined) return typeof w.pack === 'function' ? w.pack(t) : w.pack; return { ok: true, proposal: { key: t.team ? t.team.key : core.kbtaKeyOf(t.name), name: t.name, description: 'First sentence of ' + t.name + '.', prompt: t.prompt, schedule: { mode: t.schedule.mode, cron: t.schedule.cron }, needs: t.needs || [], version: H('d') }, team: t.team ? { workspaceId: 'W1', id: 1, key: t.team.key, version: t.team.version, edited: false } : null } }
    if (path === 'team-install') { w.installs = (w.installs || []).concat([body]); return w.install === undefined ? { ok: true, taskId: 'st-new', active: body.turnOn === true, missingApps: [] } : (typeof w.install === 'function' ? w.install(body) : w.install) }
    if (path === 'team-update') { w.updates = (w.updates || []).concat([body]); return w.update === undefined ? { ok: true, taskId: body.taskId, newTaskId: body.mode === 'both' ? 'st-mine' : undefined } : (typeof w.update === 'function' ? w.update(body) : w.update) }
    return undefined
  }
  world.status = w.status !== undefined ? w.status : { ok: true, connected: true, state: { active_workspace_id: 'W1', workspaces: [{ id: 'W0', name: 'Perso', personal: true }, { id: 'W1', name: 'Acme Studio', personal: false }] } }
  world.server = { ok: true, server: { console: 'https://console.example.test/plans' } }
  world.conn = w.conn !== undefined ? w.conn : { ok: true, configured: true, connections: [{ toolkit: 'gmail', accounts: [{ id: 1 }] }, { toolkit: 'slack', accounts: [{ id: 2 }] }] }
  world.computers = w.computers !== undefined ? w.computers : [{ id: '3f2a1c10-0000-4000-8000-000000000001', name: 'Home', isHome: true, state: 'asleep', capabilities: ['ask_approvals'] }]
}
const localTask = (id, name, over) => ({ id, name, prompt: 'Do ' + name + '.\nThen stop.', schedule: { mode: 'cron', cron: '0 9 * * 1', tz: 'Europe/Paris' }, approvals: 'ask', active: true, needs: ['gmail'], history: [], ...over })
const names = ['summary', 'copies']
void names

// The tab, mounted like the page mounts it: the summary hook feeds it.
const summaryFor = async (section) => {
  const h = React.createElement
  const holder = { sum: null }
  const Probe = () => { holder.sum = X.kbtaUseSummary(section); return null }
  const r = mount(h(Probe, null))
  await r.settle()
  return { holder, r }
}
const pageProps = (extra) => Object.assign({ tasks: [], computers: world.computers, connected: true, req: null, onReq () {}, notify (t) { notes.push(t) }, refreshTasks () { refreshed.n += 1 }, link: async (id, cloud) => { links.push([id, cloud]); return linkOk.v }, onOpenYours () { opened.n += 1 } }, extra)
const notes = []
const refreshed = { n: 0 }
const opened = { n: 0 }
const links = []
const linkOk = { v: true }
const mountTeam = async (w, extra) => {
  setWorld(w)
  notes.length = 0; refreshed.n = 0; opened.n = 0; links.length = 0; linkOk.v = true
  const h = React.createElement
  const holder = { props: null }
  const App = () => { const sum = X.kbtaUseSummary('team'); return h(X.KbTeamAutomations, Object.assign({ sum }, pageProps(Object.assign({ tasks: w.tasks }, extra))), null) }
  const root = mount(h(App, null))
  await root.settle()
  void holder
  return root
}
const rowsOf = (root) => kb(root, 'team-row')
const rowNamed = (root, text) => rowsOf(root).find((r) => textOf(r).includes(text))
const btnIn = (node, name) => all(node, (n) => n.props['data-kb'] === name)[0]

console.log('the segment')
{
  const w = fixtures()
  w.role = 'admin'
  setWorld(w)
  const { holder } = await summaryFor('yours')
  const sum = holder.sum
  check('a team space: ready, with the role, the counts, the name and the workspace of the team', sum.phase === 'ready' && sum.role === 'admin' && sum.counts.approved === 4 && sum.counts.pending === 3 && sum.workspaceName === 'Acme Studio' && sum.workspaceId === 'W1', sum)
  check('...and the proposals of the person (for the chip of Yours) are read once the tab is known to exist', sum.mine.length === 3 && sum.mine.every((r) => r.mine === true), sum.mine.map((r) => r.id))
  const seg = X.kbtaSegment(sum, 'yours', () => {})
  const segTree = mount(seg)
  check('the segment: the initial of the team, « Team », and the count of proposals waiting (an admin only)', part(segTree, 'section-team') === 'ATeam3' && kb(segTree, 'team-pending').length === 1, part(segTree, 'section-team'))
  w.role = 'member'
  const m = await summaryFor('yours')
  const memberSeg = mount(X.kbtaSegment(m.holder.sum, 'yours', () => {}))
  check('a member sees no count (the queue is not theirs)', part(memberSeg, 'section-team') === 'ATeam' && kb(memberSeg, 'team-pending').length === 0, part(memberSeg, 'section-team'))
  check('the segment is a tab, selected when the Team is the section', kb(memberSeg, 'section-team')[0].props.role === 'tab' && kb(memberSeg, 'section-team')[0].props['aria-selected'] === 'false' && kb(mount(X.kbtaSegment(m.holder.sum, 'team', () => {})), 'section-team')[0].props['aria-selected'] === 'true')
  w.lock = { ok: false, error: 'plan_required' }
  const l = await summaryFor('yours')
  const lockSeg = mount(X.kbtaSegment(l.holder.sum, 'yours', () => {}))
  check('a plan without the feature: the segment is there, with a lock, and the initial of the team from the account state', l.holder.sum.phase === 'locked' && l.holder.sum.kind === 'plan' && part(lockSeg, 'section-team') === 'ATeam' && all(lockSeg, (n) => n.props['data-icon'] === 'lock').length === 1, [l.holder.sum.kind, part(lockSeg, 'section-team')])
  w.lock = null
  setWorld(w)
  world.relay = () => undefined
  const gone = await summaryFor('yours')
  check('kybernos-cloud not loaded (the routes answer a page): the segment does not exist', gone.holder.sum.phase === 'absent' && X.kbtaSegment(gone.holder.sum, 'yours', () => {}) === null)
}
console.log('the lock of each word of the relay')
{
  const cases = [
    ['non_connecte', 'signin', 'Sign in to see your team’s automations', 'Sign in', 'kybernos-cloud:open'],
    ['non connecte', 'signin', 'Sign in to see your team’s automations', 'Sign in', 'kybernos-cloud:open'],
    ['plan_required', 'plan', 'Team automations come with the Team plan', 'See plans', null],
    ['offre_requise', 'plan', 'Team automations come with the Team plan', 'See plans', null],
    ['aucun_espace', 'personal', 'Team automations are for team spaces', 'Create a team', 'kybernos-cloud:open'],
    ['not_on_this_server', 'server', 'Not available on this server', 'Open the Servers page', null],
    ['reconnect_required', 'reconnect', 'Your Kybernos session has expired', 'Sign in', 'kybernos-cloud:open'],
    ['network', 'net', 'The server could not be reached', 'Try again', null],
    ['forbidden', 'other', 'Team automations are not answering', 'Try again', null],
  ]
  for (const [word, kind, title, cta, event] of cases) {
    const w = fixtures()
    w.lock = { ok: false, error: word }
    if (word === 'non connecte') w.lock = { ok: false, connected: false, error: word }
    const root = await mountTeam(w)
    const lock = kb(root, 'team-locked')[0]
    const text = page(root)
    check(word + ' → the « ' + kind + ' » screen: title, a sentence, and the way out « ' + cta + ' »', lock !== undefined && lock.props['data-lock'] === kind && text.includes(title) && all(lock, (n) => n.tag === 'button' || n.tag === 'a').some((b) => textOf(b) === cta) && kb(root, 'team-table').length === 0 && kb(root, 'team-propose').length === 0, [lock && lock.props['data-lock'], text.slice(0, 160)])
    if (event !== null) {
      events.length = 0
      const b = all(lock, (n) => n.tag === 'button').find((x) => textOf(x) === cta)
      await click(root, b, word)
      check('...and its button asks the account sheet (« ' + event + ' »)', events.length === 1 && events[0].type === event, events.map((e) => e.type))
    }
  }
  const w = fixtures()
  w.lock = { ok: false, error: 'plan_required' }
  let root = await mountTeam(w)
  const plans = kb(root, 'team-lock-plans')[0]
  check('the plan screen links to the page of the plans of the ACTIVE server (the cloud host says where), opened in a new tab', plans !== undefined && plans.tag === 'a' && plans.props.href === 'https://console.example.test/plans' && plans.props.target === '_blank' && plans.props.rel.includes('noopener'), plans && plans.props)
  check('...and says nothing of a plan name it does not know (Team, not Plus)', page(root).includes('On the Team plan, members share the automations the owners approve.') && !page(root).includes('Your plan is'))
  w.status = { ok: true, state: { active_workspace_id: 'W1', workspaces: [{ id: 'W1', name: 'Acme Studio', personal: false }], space_plan: { workspace_id: 'W1', key: 'plus' } } }
  root = await mountTeam(w)
  check('...unless the account state names the plan of THAT space (« Your plan is Plus. »)', page(root).includes('Your plan is Plus. On the Team plan'), page(root).slice(0, 200))
  w.status = { ok: true, state: { active_workspace_id: 'W0', workspaces: [{ id: 'W0', name: 'Perso', personal: true }, { id: 'W1', name: 'Acme Studio', personal: false }] } }
  root = await mountTeam(w)
  check('a personal space gets the answer « plan » from the server, and the screen of a personal space (create a team / join with a link)', kb(root, 'team-locked')[0].props['data-lock'] === 'personal' && kb(root, 'team-lock-create').length === 1 && kb(root, 'team-lock-join').length === 1 && !page(root).includes('Team plan'))
  w.lock = { ok: false, error: 'not_on_this_server' }
  root = await mountTeam(w)
  world.opened.length = 0
  await click(root, kb(root, 'team-lock-servers')[0])
  check('« Open the Servers page » opens Settings on the Servers page', JSON.stringify(world.opened) === '[["kybernos-servers"]]', world.opened)
  w.lock = { ok: false, error: 'network' }
  root = await mountTeam(w)
  w.lock = null
  setWorld(Object.assign(w, { lock: null }))
  await click(root, kb(root, 'team-lock-retry')[0])
  check('« Try again » reads the server again, and the tab comes back when it answers', kb(root, 'team-automations').length === 1 && kb(root, 'team-locked').length === 0, page(root).slice(0, 120))
  LANG = 'kybernos'
  w.lock = { ok: false, error: 'not_on_this_server' }
  root = await mountTeam(w)
  check('in French the lock speaks French (title, sentence, button)', page(root).includes('Indisponible sur ce serveur') && page(root).includes('Ouvrir la page Serveurs') && !/[A-Z][a-z]+ [a-z]+ (the|your|team)/.test(page(root)), page(root).slice(0, 200))
  LANG = 'en'
}

console.log('the tab')
let W
let R
{
  W = fixtures()
  W.role = 'member'
  W.tasks = [localTask('st-1', 'Weekly client digest', { team: { workspaceId: 'W1', id: 1, key: 'weekly-client-digest', version: H('3'), base: { name: 'Weekly client digest', prompt: PROMPT_OLD, schedule: { mode: 'cron', cron: '30 8 * * 1-5' }, needs: ['gmail', 'slack'] } } }), localTask('st-2', 'Monthly expenses report', { team: { workspaceId: 'W1', id: 4, key: 'monthly-expenses-report', version: H('7'), base: {} } }), localTask('st-3', 'Invoice reminder'), localTask('st-4', 'Launch review', { schedule: { mode: 'once', at: '2026-12-15T09:00', tz: 'UTC' } })]
  W.copies = [{ taskId: 'st-1', workspaceId: 'W1', id: 1, key: 'weekly-client-digest', version: H('3'), edited: true, missingApps: [] }, { taskId: 'st-2', workspaceId: 'W1', id: 4, key: 'monthly-expenses-report', version: H('7'), edited: false, missingApps: [] }]
  R = await mountTeam(W)
  const head = page(R)
  check('the head: the team, what the tab is, and who the person is in it', head.includes('Acme Studio') && head.includes('Automations your team has approved. Installing one makes a paused copy that belongs to you.') && part(R, 'team-hint') === 'Shared by the members of Acme Studio.')
  check('a member has Approved and Mine, no To review', kb(R, 'team-filter-approved').length === 1 && kb(R, 'team-filter-mine').length === 1 && kb(R, 'team-filter-review').length === 0)
  check('the pills carry their counts (4 approved, 3 mine)', part(R, 'team-filter-approved') === 'Approved 4' && part(R, 'team-filter-mine') === 'Mine 3', [part(R, 'team-filter-approved'), part(R, 'team-filter-mine')])
  const rows = rowsOf(R)
  check('the approved table lists the four approved automations, nothing else (a proposal or a refusal is not installable)', rows.length === 4 && rows.every((r) => r.props['data-state'] !== undefined) && !page(R).includes('Invoice reminder'), rows.map((r) => r.props['data-key']))
  const digest = rowNamed(R, 'Weekly client digest')
  const stock = rowNamed(R, 'Daily stock check')
  const exp = rowNamed(R, 'Monthly expenses report')
  const triage = rowNamed(R, 'Morning ticket triage')
  check('Update to v4 for a copy of another version, with « you have » its own version', btnIn(digest, 'team-update') !== undefined && textOf(btnIn(digest, 'team-update')) === 'Update to v4' && textOf(digest).includes('v4 · you have #' + 'a'.repeat(0) + H('3').slice(0, 7)), textOf(digest))
  check('Install for a team automation never installed, as the primary button', btnIn(stock, 'team-install') !== undefined && textOf(btnIn(stock, 'team-install')) === 'Install' && btnIn(stock, 'team-install').props.disabled === false && stock.props['data-state'] === 'install')
  check('Installed (and off) for the same version', textOf(btnIn(exp, 'team-installed')) === 'Installed' && btnIn(exp, 'team-installed').props.disabled === true && exp.props['data-state'] === 'installed')
  check('the button says what it acts on (aria-label)', btnIn(stock, 'team-install').props['aria-label'] === 'Install Daily stock check' && btnIn(digest, 'team-update').props['aria-label'] === 'Update Weekly client digest' && btnIn(exp, 'team-installed').props['aria-label'] === 'Installed: Monthly expenses report')
  check('a row says when (in words), what it needs (an app that is not connected says so), the version and the author', textOf(stock).includes('Every day, 08:00') && textOf(triage).includes('Zendesk · not connected') && textOf(triage).includes('Slack') && !textOf(triage).includes('Slack · not connected') && textOf(stock).includes('by Karim Benali') && textOf(digest).includes('Weekdays, 08:30'), textOf(triage))
  check('there is no button to retire for a member', kb(R, 'team-retire').length === 0)
  const before = world.calls.length
  const items = world.calls.slice(0, before).filter((c) => c.path === '/kybernos-cloud/team/automations/item').length
  check('the list asks for metadata only: no prompt is downloaded to draw it', items === 0 && world.calls.some((c) => c.path === '/kybernos-cloud/team/automations' && c.query.includes('view=approved')) && world.calls.some((c) => c.query.includes('view=mine')) && !world.calls.some((c) => c.query.includes('view=proposed')), world.calls.map((c) => c.path + c.query))
  // search
  await type(R, kb(R, 'team-search')[0], 'zend')
  check('search narrows the table (by name, description or author)', rowsOf(R).length === 1 && rowsOf(R)[0].props['data-key'] === 'morning-ticket-triage')
  await type(R, kb(R, 'team-search')[0], 'karim')
  check('...by author', rowsOf(R).length === 1 && rowsOf(R)[0].props['data-key'] === 'daily-stock-check')
  await type(R, kb(R, 'team-search')[0], 'nothing like it')
  check('...and says so when nothing matches (not the « nothing shared yet » of an empty team)', part(R, 'team-empty').includes('No automation matches') && !part(R, 'team-empty').includes('Nothing shared yet') && kb(R, 'team-empty-propose').length === 0, part(R, 'team-empty'))
  await type(R, kb(R, 'team-search')[0], '')
  // mine
  await click(R, kb(R, 'team-filter-mine')[0])
  check('Mine: the statuses of the person’s own proposals, in words', rowsOf(R).length === 3 && part(R, 'team-table').includes('Waiting for review') && part(R, 'team-table').includes('Refused') && part(R, 'team-table').includes('Retired'), part(R, 'team-table'))
  const refused = rowNamed(R, 'Meeting prep')
  check('a refusal shows who refused and why, in the reviewer’s words', textOf(refused).includes('Julien Petit: “The prompt contains a customer’s phone number. Remove it and propose again.”'), textOf(refused))
  check('the actions: Withdraw (waiting), Propose again (refused), nothing for a retired one a member cannot delete', textOf(btnIn(rowNamed(R, 'Invoice reminder'), 'team-withdraw')) === 'Withdraw' && textOf(btnIn(refused, 'team-again')) === 'Propose again' && all(rowNamed(R, 'Old newsletter draft'), (n) => n.tag === 'button').length === 0)
  await click(R, btnIn(rowNamed(R, 'Invoice reminder'), 'team-withdraw'))
  check('Withdraw asks the relay to delete that proposal, says so, and reads the list again', W.deleted !== undefined && W.deleted[0].id === 5 && notes.includes('Proposal withdrawn.') && world.calls.filter((c) => c.path === '/kybernos-cloud/team/automations' && c.query.includes('view=mine')).length >= 2, [W.deleted, notes])
}
console.log('the sheets: Propose')
{
  const open = async (extra, mutate) => {
    const w = fixtures()
    w.tasks = [localTask('st-3', 'Invoice reminder', { prompt: 'Every Monday, look at the invoices.\nSave a draft for each one.\nPost the list in #finance.', needs: ['slack', 'gmail'] }), localTask('st-1', 'Weekly client digest'), localTask('st-4', 'Launch review', { schedule: { mode: 'once', at: '2026-12-15T09:00', tz: 'UTC' } })]
    w.role = extra && extra.role ? extra.role : 'member'
    if (mutate) mutate(w)
    const root = await mountTeam(w, extra && extra.props ? extra.props : {})
    return { w, root }
  }
  let { w, root } = await open()
  await click(root, kb(root, 'team-propose')[0])
  let sheet = kb(root, 'team-sheet')[0]
  check('« Propose one of yours » opens the sheet: title, sub, step 1 with the automations of Yours', sheet !== undefined && sheet.props['data-sheet'] === 'propose' && sheet.props['aria-label'] === 'Propose to Acme Studio' && page(root).includes('Owners and admins review it before anyone can install it.') && page(root).includes('1 · Choose one of your automations') && kb(root, 'tp-pick').length === 3)
  check('a one-time automation cannot be shared: its option is off, with the reason', kb(root, 'tp-pick').find((p) => p.props['data-id'] === 'st-4').props.disabled === true && textOf(kb(root, 'tp-pick').find((p) => p.props['data-id'] === 'st-4')).includes('A one-time automation cannot be shared.'))
  check('nothing is chosen, so nothing is read, nothing is checked, and Send is off', kb(root, 'tp-desc').length === 0 && kb(root, 'team-sheet-go')[0].props.disabled === true && !(w.localCalls || []).some((c) => c[0] === 'team-pack'))
  await click(root, kb(root, 'tp-pick').find((p) => p.props['data-id'] === 'st-3'))
  await sleep(10)
  await root.settle()
  const text = page(root)
  check('choosing one reads it with the host: what the team will see (name, when in every member’s zone, the apps by name only, the whole prompt)', text.includes('2 · What Acme Studio will see') && text.includes('Invoice reminder') && text.includes('Every Monday, 09:00') && text.includes('each member’s own time zone') && text.includes('app names only') && part(root, 'tp-prompt').includes('Post the list in #finance.') && text.includes('Gmail') && text.includes('Slack'), text.slice(0, 600))
  check('the short description is the host’s sentence, in a field the person can change', kb(root, 'tp-desc')[0].props.value === 'First sentence of Invoice reminder.' && part(root, 'tp-desc-count') === '35 / 500', part(root, 'tp-desc-count'))
  check('what never travels is listed (five lines)', text.includes('What never travels') && text.includes('Your keys, tokens and passwords') && text.includes('Webhook addresses and their secrets') && text.includes('Run history and results') && text.includes('Files in your work folder') && text.includes('Your connected accounts — only the app names travel'))
  await sleep(450)
  await root.settle()
  check('the dry run says Checked, with the trimmed definition and the description of the field, nothing else', kb(root, 'tp-check')[0].props['data-state'] === 'ok' && part(root, 'tp-check') === 'CheckedNo key, token or password found in the prompt.' && w.checks.length === 1 && JSON.stringify(Object.keys(w.checks[0])) === '["key","name","description","prompt","schedule","needs"]' && w.checks[0].description === 'First sentence of Invoice reminder.' && w.checks[0].schedule.tz === undefined && w.checks[0].needs.join() === 'gmail,slack', w.checks)
  check('Send is on', kb(root, 'team-sheet-go')[0].props.disabled === false && part(root, 'team-sheet-go') === 'Send for review')
  // description edits
  await type(root, kb(root, 'tp-desc')[0], '   ')
  check('an empty description stops the dry run and says why', kb(root, 'tp-check')[0].props['data-state'] === 'needdesc' && part(root, 'tp-check') === 'Write a short description to continue.' && kb(root, 'team-sheet-go')[0].props.disabled === true)
  await type(root, kb(root, 'tp-desc')[0], 'x'.repeat(501))
  check('501 characters is too many: the count turns red, the dry run says so, Send is off', kb(root, 'tp-check')[0].props['data-state'] === 'toolong' && kb(root, 'tp-desc-count')[0].props.className.includes('over') && kb(root, 'team-sheet-go')[0].props.disabled === true)
  const nChecks = w.checks.length
  await type(root, kb(root, 'tp-desc')[0], '  ' + 'y'.repeat(500) + '  ')
  await sleep(450); await root.settle()
  check('500 characters once trimmed is fine: it is sent trimmed', kb(root, 'tp-check')[0].props['data-state'] === 'ok' && w.checks.length === nChecks + 1 && w.checks[w.checks.length - 1].description === 'y'.repeat(500))
  await type(root, kb(root, 'tp-desc')[0], 'Drafts a reminder for each late invoice.')
  // note
  await type(root, kb(root, 'tp-note')[0], 'n'.repeat(2001))
  check('a note of 2 001 characters is not cut: the count turns red, Send is off and the sheet says why', kb(root, 'tp-check')[0].props['data-state'] === 'notetoolong' && kb(root, 'tp-note')[0].props.value.length === 2001 && kb(root, 'team-sheet-go')[0].props.disabled === true && part(root, 'tp-check').includes('2000'), part(root, 'tp-check'))
  await type(root, kb(root, 'tp-note')[0], 'Why not: it saves an hour a week.')
  await sleep(450); await root.settle()
  check('...and a note of 2 000 or less goes with the dry run (it is scanned too)', kb(root, 'tp-check')[0].props['data-state'] === 'ok' && w.checks[w.checks.length - 1].note === 'Why not: it saves an hour a week.')
  // send
  w.add = { ok: false, error: 'duplicate', id: 7, status: 'proposed' }
  await click(root, kb(root, 'team-sheet-go')[0])
  check('a refusal at the send (duplicate) says so in words and leaves the sheet usable: the button is back, not stuck on « Sending… »', part(root, 'tp-error') === 'This automation is already proposed or approved as it is.' && part(root, 'team-sheet-go') === 'Send for review' && kb(root, 'team-sheet-go')[0].props.disabled === false && kb(root, 'team-sheet-close')[0].props.disabled === false, [part(root, 'tp-error'), part(root, 'team-sheet-go')])
  w.add = { ok: false, error: 'too_many_proposals' }
  await click(root, kb(root, 'team-sheet-go')[0])
  check('...too many proposals too', part(root, 'tp-error') === 'You already have the maximum number of proposals waiting (5).' && kb(root, 'team-sheet-go')[0].props.disabled === false)
  w.add = { ok: false, error: 'network' }
  await click(root, kb(root, 'team-sheet-go')[0])
  check('...and a dropped connection', part(root, 'tp-error') === 'The server cannot be reached. Nothing was changed.' && kb(root, 'team-sheet-go')[0].props.disabled === false)
  w.add = { ok: false, error: 'scan_rejected', field: 'prompt', line: 3 }
  await click(root, kb(root, 'team-sheet-go')[0])
  check('a secret found by the server at the send puts the sheet on the secret screen (nothing was sent)', kb(root, 'tp-check')[0].props['data-state'] === 'found' && kb(root, 'team-sheet-go')[0].props.disabled === true)
  w.add = undefined
  w.check = { ok: true, version: H('c') }
  await click(root, kb(root, 'tp-recheck')[0])
  await sleep(450); await root.settle()
  await click(root, kb(root, 'team-sheet-go')[0])
  const added = w.added[w.added.length - 1]
  check('the send posts the definition (trimmed), the description and the note to the relay’s « add »', added !== undefined && added.key === 'invoice-reminder' && added.name === 'Invoice reminder' && added.description === 'Drafts a reminder for each late invoice.' && added.note === 'Why not: it saves an hour a week.' && added.prompt === 'Every Monday, look at the invoices.\nSave a draft for each one.\nPost the list in #finance.' && added.schedule.mode === 'cron' && added.id === undefined, added)
  check('Sent: what happened, where to find it, and a button that goes there', kb(root, 'team-sent').length === 1 && part(root, 'team-sent').startsWith('Sent for review') && part(root, 'team-sent').includes('The owners and admins of Acme Studio were told. You will find it under Mine, as “Waiting for review”.') && part(root, 'team-sheet-go') === 'See it under Mine' && kb(root, 'team-sheet-cancel').length === 0)
  await click(root, kb(root, 'team-sheet-go')[0])
  check('...which closes the sheet and shows Mine', kb(root, 'team-sheet').length === 0 && kb(root, 'team-table')[0].props['data-view'] === 'mine')
  // the secret screen
  ;({ w, root } = await open({}, (x) => { x.check = { ok: false, error: 'scan_rejected', field: 'prompt', line: 3 } }))
  await click(root, kb(root, 'team-propose')[0])
  await click(root, kb(root, 'tp-pick').find((p) => p.props['data-id'] === 'st-3'))
  await sleep(450); await root.settle()
  const found = kb(root, 'tp-check')[0]
  check('a secret: « Secret found », the line, the line itself with the secret hidden, how to fix it, Send off, and « Check again »', found.props['data-state'] === 'found' && part(root, 'tp-check').includes('Secret found') && part(root, 'tp-check').includes('Line 3 of the prompt looks like an API key, a token or a password.') && part(root, 'tp-check').includes('Remove it from the prompt and connect the app instead, then send again. Nothing was sent.') && part(root, 'tp-excerpt') === 'Post the list in #finance.' && kb(root, 'team-sheet-go')[0].props.disabled === true && kb(root, 'tp-recheck').length === 1, part(root, 'tp-check'))
  w.tasks[0].prompt = 'Remove nothing.\nUse key sk-live-4242424242 to read.\nPost the list in #finance.'
  w.check = { ok: false, error: 'scan_rejected', field: 'prompt', line: 2 }
  await click(root, kb(root, 'tp-recheck')[0])
  await sleep(450); await root.settle()
  check('the excerpt never shows the secret itself', part(root, 'tp-excerpt').includes('Use key') && !part(root, 'tp-excerpt').includes('4242') && part(root, 'tp-excerpt').includes('•'), part(root, 'tp-excerpt'))
  w.check = { ok: false, error: 'scan_rejected', field: 'description' }
  await click(root, kb(root, 'tp-recheck')[0])
  await sleep(450); await root.settle()
  check('a secret in the description is said as such, with the fix above (nothing is excerpted)', part(root, 'tp-check').includes('The short description looks like an API key') && part(root, 'tp-check').includes('Change it above, then send again.') && kb(root, 'tp-excerpt').length === 0)
  w.check = { ok: false, error: 'invalid_automation', reason: 'schedule' }
  await click(root, kb(root, 'tp-recheck')[0])
  await sleep(450); await root.settle()
  check('another refusal of the dry run is said in words, with a retry', kb(root, 'tp-check')[0].props['data-state'] === 'bad' && part(root, 'tp-check').includes('Only a recurring or webhook automation can be shared.') && kb(root, 'tp-recheck').length === 1 && kb(root, 'team-sheet-go')[0].props.disabled === true, part(root, 'tp-check'))
  // the host refuses to pack
  ;({ w, root } = await open({}, (x) => { x.pack = { ok: false, error: 'empty_prompt' } }))
  await click(root, kb(root, 'team-propose')[0])
  await click(root, kb(root, 'tp-pick').find((p) => p.props['data-id'] === 'st-3'))
  check('a host that refuses to pack says why (nothing to share)', part(root, 'tp-bad') === 'This automation has no prompt to share.' && kb(root, 'team-sheet-go')[0].props.disabled === true)
  ;({ w, root } = await open({}, (x) => { x.pack = { ok: false, error: 'invalid_schedule' } }))
  await click(root, kb(root, 'team-propose')[0])
  await click(root, kb(root, 'tp-pick').find((p) => p.props['data-id'] === 'st-3'))
  check('...and a stored rhythm the server would not take', part(root, 'tp-bad').startsWith('Its schedule does not have the shape the server accepts'))
  ;({ w, root } = await open())
  w.localCalls = []
  const oldHost = await open({}, (x) => { x.local = null })
  void oldHost
  // an admin adds, it does not propose
  ;({ w, root } = await open({ role: 'admin' }))
  await click(root, kb(root, 'team-propose')[0])
  check('an owner or an admin ADDS: the title, the sub and the button say it is available right away', kb(root, 'team-sheet')[0].props['aria-label'] === 'Add to Acme Studio' && page(root).includes('As an owner or admin, it is available to every member right away.') && part(root, 'team-sheet-go') === 'Add to the team' && part(root, 'team-propose') === 'Add one of yours')
  await click(root, kb(root, 'tp-pick').find((p) => p.props['data-id'] === 'st-3'))
  await sleep(450); await root.settle()
  await click(root, kb(root, 'team-sheet-go')[0])
  check('...and it says Added, with the way to Approved', part(root, 'team-sent').startsWith('Added to the team') && part(root, 'team-sheet-go') === 'See it under Approved')
  // from a row of Yours
  ;({ w, root } = await open({ props: { req: { taskId: 'st-3', n: 1 } } }))
  await root.settle()
  check('« Propose to team… » on a row of Yours opens the tab with the sheet, on that automation', kb(root, 'team-sheet').length === 1 && kb(root, 'tp-pick').find((p) => p.props['data-id'] === 'st-3').props['aria-checked'] === 'true')
}
const clean = (root, label) => check(label + ': no key shown instead of a sentence, no undefined, no NaN', !/kbta\.|kbwr\.|undefined|NaN|\[object|\{[a-z]+\}/.test(page(root)), page(root).match(/kbta\.[a-z.]+|kbwr\.[a-z.]+|undefined|NaN|\[object[^\]]*\]|\{[a-z]+\}/g))
console.log('the sheets: Review')
{
  const w = fixtures()
  w.role = 'admin'
  let root = await mountTeam(w)
  check('an admin has To review, with the count of proposals waiting (3)', part(root, 'team-filter-review') === 'To review 3' && part(root, 'team-hint') === 'You are an admin: you review what members propose.', part(root, 'team-filter-review'))
  await click(root, kb(root, 'team-filter-review')[0])
  check('the queue: who proposed, what it needs, when, and a Review button; an update says which version it replaces', rowsOf(root).length === 3 && part(root, 'team-table').includes('Proposal') && part(root, 'team-table').includes('From') && part(root, 'team-table').includes('Sent') && textOf(rowNamed(root, 'Weekly client digest')).includes('Update · v4 → #') && textOf(rowNamed(root, 'Competitor watch')).includes('New automation') && kb(root, 'team-review').length === 3, rowsOf(root).map(textOf))
  const upd = rowNamed(root, 'Weekly client digest')
  await click(root, btnIn(upd, 'team-review'))
  await sleep(10); await root.settle()
  check('the Review sheet: the title, who proposed and when and what kind, two tabs (an update has changes)', kb(root, 'team-sheet')[0].props['data-sheet'] === 'review' && kb(root, 'team-sheet')[0].props['aria-label'] === 'Review: Weekly client digest' && page(root).includes('Proposed by Léa Martin · 2 hours ago · Update · v4 → #') && part(root, 'tr-tab-details') === 'Details' && part(root, 'tr-tab-changes') === 'Changes since v4', page(root).slice(0, 300))
  check('Details: when, what it needs, the whole prompt, the note of the author, and the check', page(root).includes('What is proposed') && page(root).includes('Weekdays, 08:30') && part(root, 'tr-prompt').includes('Also mention the owner.') && part(root, 'tr-note') === 'Added the account owner.' && page(root).includes('CheckedNo key, token or password found.'))
  check('the decision starts on Approve, whose hint says who is offered the update', kb(root, 'tr-approve')[0].props['aria-checked'] === 'true' && part(root, 'tr-approve').includes('Members who installed v4 are offered the update.') && part(root, 'team-sheet-go') === 'Approve' && kb(root, 'tr-reason').length === 0)
  check('what members get is said before the decision', page(root).includes('A paused copy that belongs to them. Nothing runs until they turn it on, and they choose where it runs. Members who edited their copy are asked before an update replaces it.'))
  const fetched = world.calls.filter((c) => c.path === '/kybernos-cloud/team/automations/item').map((c) => c.query)
  check('the proposal and the approved version it replaces are both downloaded (the only prompts fetched)', fetched.length === 2 && fetched.includes('?id=7') && fetched.includes('?id=1'), fetched)
  await click(root, kb(root, 'tr-tab-changes')[0])
  check('Changes since v4: the lines taken out and put in, and what stayed the same', kb(root, 'team-diff').length === 1 && all(root, (n) => n.props['data-k'] === 'add').some((n) => textOf(n) === '+ Also mention the owner.') && page(root).includes('When, needs and checks are the same as v4.'), page(root).slice(0, 400))
  await click(root, kb(root, 'tr-refuse')[0])
  check('Refuse asks for a reason, which is REQUIRED: the button is off and says why', kb(root, 'tr-reason').length === 1 && part(root, 'team-sheet-go') === 'Refuse and send the reason' && kb(root, 'team-sheet-go')[0].props.disabled === true && part(root, 'team-sheet-note') === 'Write the reason to be able to refuse.')
  await type(root, kb(root, 'tr-reason')[0], '    ')
  check('a reason of blanks is no reason', kb(root, 'team-sheet-go')[0].props.disabled === true)
  await type(root, kb(root, 'tr-reason')[0], 'x'.repeat(2001))
  check('...and one over 2 000 characters is refused with its reason', kb(root, 'team-sheet-go')[0].props.disabled === true && part(root, 'team-sheet-note').includes('2000'))
  await type(root, kb(root, 'tr-reason')[0], 'The prompt must say which clients.')
  w.review = { ok: false, error: 'admin_required' }
  await click(root, kb(root, 'team-sheet-go')[0])
  check('a refusal of the server never leaves the sheet stuck: it is said in words, and both buttons work again', part(root, 'tr-fail') === 'Only an owner or admin can do that.' && kb(root, 'team-sheet-go')[0].props.disabled === false && part(root, 'team-sheet-go') === 'Refuse and send the reason' && kb(root, 'team-sheet-cancel')[0].props.disabled === false && kb(root, 'team-sheet-close')[0].props.disabled === false && w.reviewed.length === 1)
  w.review = { ok: false, error: 'network' }
  await click(root, kb(root, 'team-sheet-go')[0])
  check('...a dropped connection too', part(root, 'tr-fail') === 'The server cannot be reached. Nothing was changed.' && kb(root, 'team-sheet-go')[0].props.disabled === false)
  w.review = undefined
  await click(root, kb(root, 'team-sheet-go')[0])
  check('the refusal is sent with the reason, as « reject »; the sheet closes, says so, and the lists are read again', JSON.stringify(w.reviewed[w.reviewed.length - 1]) === '{"id":7,"decision":"reject","note":"The prompt must say which clients."}' && kb(root, 'team-sheet').length === 0 && notes[notes.length - 1] === '“Weekly client digest” refused.')
  await click(root, btnIn(rowNamed(root, 'Competitor watch'), 'team-review'))
  await sleep(10); await root.settle()
  check('a new automation has no tabs; Approve says what members can do', kb(root, 'tr-tab-changes').length === 0 && part(root, 'tr-approve').includes('Members can install it.') && page(root).includes('Proposed by Camille Roy') && page(root).includes('New automation') && page(root).includes('External webhook'))
  w.review = { ok: false, error: 'not_pending' }
  await click(root, kb(root, 'team-sheet-go')[0])
  check('another admin was faster: the sheet closes with the sentence, the list is read again', kb(root, 'team-sheet').length === 0 && notes[notes.length - 1] === 'Someone decided before you. The list has been refreshed.')
  w.review = undefined
  await click(root, btnIn(rowNamed(root, 'Competitor watch'), 'team-review'))
  await sleep(10); await root.settle()
  await click(root, kb(root, 'team-sheet-go')[0])
  check('Approve sends « approve » with no note and says so', JSON.stringify(w.reviewed[w.reviewed.length - 1]) === '{"id":9,"decision":"approve"}' && notes[notes.length - 1] === '“Competitor watch” approved.')
  w.rows = w.rows.filter((r) => r.id !== 9)
  await click(root, kb(root, 'team-filter-approved')[0])
  const retireBtn = kb(root, 'team-retire')[0]
  check('an admin has Retire in the approved table; a confirmation names what is retired and who keeps what', retireBtn !== undefined && retireBtn.props.disabled !== true)
  await click(root, retireBtn)
  check('...the confirmation says that members keep their copy', kb(root, 'confirm').length === 1 && kb(root, 'confirm')[0].props.title === 'Retire “Weekly client digest” from the team?' && page(root).includes('Members who installed it keep their copy, nobody else can install it.'))
  await click(root, kb(root, 'confirm-yes')[0])
  check('Retire posts the id to the relay and says so', JSON.stringify(w.retired) === '[{"id":1}]' && notes[notes.length - 1] === '“Weekly client digest” retired from the team.', [w.retired, notes])
  // an unreadable proposal
  const w2 = fixtures(); w2.role = 'admin'
  root = await mountTeam(w2)
  await click(root, kb(root, 'team-filter-review')[0])
  w2.rows = w2.rows.filter((r) => r.id !== 9)
  await click(root, btnIn(rowNamed(root, 'Competitor watch'), 'team-review'))
  await sleep(10); await root.settle()
  check('a proposal that is no longer there: the sheet says so and nothing can be decided', part(root, 'tr-error') === 'This automation no longer exists.' && kb(root, 'team-sheet-go')[0].props.disabled === true)
  await click(root, kb(root, 'team-sheet-cancel')[0])
  check('Cancel closes the sheet', kb(root, 'team-sheet').length === 0)
  // the base of an update that cannot be read
  const w3 = fixtures(); w3.role = 'admin'; w3.rows = w3.rows.map((r) => r.id === 7 ? { ...r, replaces: 77 } : r)
  root = await mountTeam(w3)
  await click(root, kb(root, 'team-filter-review')[0])
  await click(root, btnIn(rowNamed(root, 'Weekly client digest'), 'team-review'))
  await sleep(10); await root.settle()
  check('an update whose approved version cannot be read says the changes are not shown, and can still be decided', kb(root, 'tr-nobase').length === 1 && kb(root, 'tr-tab-changes').length === 0 && kb(root, 'team-sheet-go')[0].props.disabled === false)
  clean(root, 'review')
  LANG = 'kybernos'
  root = await mountTeam(w3)
  await click(root, kb(root, 'team-filter-review')[0])
  await click(root, btnIn(rowNamed(root, 'Weekly client digest'), 'team-review'))
  await sleep(10); await root.settle()
  check('in French: the sheet is French (title, decision, hint)', page(root).includes('Examen : Weekly client digest') && page(root).includes('Approuver') && page(root).includes('Refuser') && page(root).includes('L’auteur voit ta raison'), page(root).slice(0, 200))
  clean(root, 'review (French)')
  LANG = 'en'
}
console.log('the sheets: Install')
{
  const base = () => {
    const w = fixtures()
    w.tasks = []
    w.copies = []
    w.rows = w.rows.map((r) => r.id === 2 ? { ...r, needs: ['gmail'] } : r)
    return w
  }
  let w = base()
  let root = await mountTeam(w)
  const stockRow = () => rowNamed(root, 'Daily stock check')
  await click(root, btnIn(stockRow(), 'team-install'))
  await sleep(10); await root.settle()
  check('Install opens the sheet: the title, who proposed and approved, what it does, what the copy will be', kb(root, 'team-sheet')[0].props['data-sheet'] === 'install' && kb(root, 'team-sheet')[0].props['aria-label'] === 'Install “Daily stock check”' && page(root).includes('v1 · proposed by Karim Benali · approved by Julien Petit') && part(root, 'ti-what') === 'About Daily stock check' && page(root).includes('Every day, 08:00') && page(root).includes('in your time zone (' + vm.runInContext('kbMachineTz()', sandbox) + ')'), page(root).slice(0, 400))
  check('it starts on this computer, on « Ask me first » (recommended), and the copy is not turned on', kb(root, 'ti-where-local')[0].props['aria-pressed'] === 'true' && kb(root, 'ti-ask')[0].props['aria-checked'] === 'true' && part(root, 'ti-ask').includes('recommended') && kb(root, 'ti-allow')[0].props['aria-checked'] === 'false' && kb(root, 'ti-turnon')[0].props['aria-checked'] === 'false' && part(root, 'ti-where-hint') === 'It runs only while DSH is open on this computer.' && part(root, 'team-sheet-go') === 'Install paused copy')
  check('every app is connected: the switch is on offer, with the reason it is off by default', kb(root, 'ti-turnon')[0].props.disabled === false && part(root, 'ti-turnon-hint') === 'Off by default, so you can read the prompt first.' && kb(root, 'ti-missing').length === 0)
  const items = world.calls.filter((c) => c.path === '/kybernos-cloud/team/automations/item')
  check('the definition is downloaded when the sheet opens (and only then)', items.length === 1 && items[0].query === '?id=2', items)
  clean(root, 'install')
  // the cloud computer: what the page\'s own tab allows
  check('the cloud computer is on offer when the tab « Where it runs » would allow it', kb(root, 'ti-where-cloud')[0].props.disabled === false && part(root, 'ti-where-cloud') === 'Cloud computer · Home')
  await click(root, kb(root, 'ti-where-cloud')[0])
  check('...and says how it runs there', kb(root, 'ti-where-cloud')[0].props['aria-pressed'] === 'true' && part(root, 'ti-where-hint') === 'Home is asleep. It wakes for each run, so it works with your laptop closed.')
  await click(root, kb(root, 'ti-allow')[0])
  check('the approval mode is the person’s choice', kb(root, 'ti-allow')[0].props['aria-checked'] === 'true' && kb(root, 'ti-ask')[0].props['aria-checked'] === 'false')
  await click(root, kb(root, 'ti-ask')[0])
  await click(root, kb(root, 'ti-turnon')[0])
  check('the switch turns on, and the button says what it will do', kb(root, 'ti-turnon')[0].props['aria-checked'] === 'true' && part(root, 'team-sheet-go') === 'Install and turn on')
  w.install = { ok: false, error: 'version_mismatch' }
  await click(root, kb(root, 'team-sheet-go')[0])
  check('a refusal of the host (the version does not match what was approved) is said in words, nothing was installed, and the sheet works again', part(root, 'ti-fail') === 'What was downloaded does not match the approved version. Nothing was installed.' && part(root, 'team-sheet-go') === 'Install and turn on' && kb(root, 'team-sheet-go')[0].props.disabled === false && kb(root, 'team-sheet-close')[0].props.disabled === false && links.length === 0)
  w.install = { ok: false, error: 'invalid_automation', reason: 'schedule', field: 'schedule' }
  await click(root, kb(root, 'team-sheet-go')[0])
  check('...an invalid definition names its reason', part(root, 'ti-fail') === 'Only a recurring or webhook automation can be shared.')
  w.install = { ok: false, error: 'store_unreadable' }
  await click(root, kb(root, 'team-sheet-go')[0])
  check('...an unreadable store', part(root, 'ti-fail') === 'Your automations file cannot be read, so nothing was written.')
  const nCopies = world.calls.filter((c) => c.path === 'team-copies').length
  w.install = { ok: false, error: 'already_installed', taskId: 'st-9' }
  await click(root, kb(root, 'team-sheet-go')[0])
  check('...already installed says to use the update, and the list is read again', part(root, 'ti-fail') === 'You already have this automation. Use the update.' && (w.localCalls.filter((c) => c[0] === 'team-copies').length >= 2) && nCopies >= 0)
  w.install = { ok: false, error: 'frequent schedule', everyMinutes: 1 }
  await click(root, kb(root, 'team-sheet-go')[0])
  check('an every-minute rhythm is a QUESTION: the sheet asks, and nothing is confirmed on its own', kb(root, 'ti-frequent').length === 1 && page(root).includes('This schedule runs very often') && page(root).includes('It would run every minute.') && part(root, 'ti-frequent-yes') === 'Install anyway' && w.installs[w.installs.length - 1].confirmFrequent === undefined)
  w.install = undefined
  await click(root, kb(root, 'ti-frequent-yes')[0])
  check('...and the second call carries the yes, on the cloud path only after the person said it', w.installs[w.installs.length - 1].confirmFrequent === true && kb(root, 'team-installed').length === 1)
  const inst = w.installs[w.installs.length - 1]
  check('on the cloud computer the copy is installed PAUSED here (it is turned on over there), with the definition of the team', inst.turnOn === false && inst.approvals === 'ask' && inst.workspaceId === 'W1' && inst.definition.id === 2 && inst.definition.key === 'daily-stock-check' && inst.definition.version === H('1') && inst.definition.prompt === 'Read the supplier prices.' && inst.definition.schedule.tz === undefined, inst)
  check('...it is linked to the computer, then sent with its zone and its switch', links.length === 1 && links[0][0] === 'st-new' && links[0][1].name === 'Home' && (() => { const put = world.calls.filter((c) => c.path === '/kybernos-cloud/computers/publish').pop(); return put !== undefined && put.body.ops[0].op === 'put' && put.body.ops[0].ref === 'st-new' && put.body.ops[0].task.active === true && put.body.ops[0].task.approvals === 'ask' && put.body.ops[0].task.schedule.tz === vm.runInContext('kbMachineTz()', sandbox) && put.body.ops[0].task.schedule.cron === '0 8 * * *' && put.body.ops[0].task.name === 'Daily stock check' })(), [links, world.calls.filter((c) => c.path === '/kybernos-cloud/computers/publish').map((c) => c.body)])
  check('Done: installed, turned on, and where it runs; Open in Yours is the way on', part(root, 'team-installed').startsWith('Installed and turned on') && part(root, 'team-installed').includes('It will run every day, 08:00 on your cloud computer. It is in Yours, marked as a team copy.') && part(root, 'team-sheet-go') === 'Open in Yours' && kb(root, 'team-sheet-cancel').length === 0 && refreshed.n >= 1, part(root, 'team-installed'))
  await click(root, kb(root, 'team-sheet-go')[0])
  check('Open in Yours closes the sheet and goes to Yours', kb(root, 'team-sheet').length === 0 && opened.n === 1)
  // the connections change under the open sheet: the switch was on, an app is gone
  w = base(); root = await mountTeam(w)
  await click(root, btnIn(rowNamed(root, 'Daily stock check'), 'team-install'))
  await sleep(10); await root.settle()
  await click(root, kb(root, 'ti-turnon')[0])
  world.conn = { ok: true, configured: true, connections: [{ toolkit: 'gmail', accounts: [] }] }
  root.render()
  check('an app that stops being connected under the open sheet turns the switch off at once', kb(root, 'ti-turnon')[0].props.disabled === true && kb(root, 'ti-turnon')[0].props['aria-checked'] === 'false' && part(root, 'team-sheet-go') === 'Install paused copy')
  await click(root, kb(root, 'team-sheet-go')[0])
  check('...and the host is not asked to turn it on, whatever the switch said a moment ago', w.installs.length === 1 && w.installs[0].turnOn === false, w.installs)
  // local install, paused
  w = base(); root = await mountTeam(w)
  await click(root, btnIn(rowNamed(root, 'Daily stock check'), 'team-install'))
  await sleep(10); await root.settle()
  await click(root, kb(root, 'team-sheet-go')[0])
  check('a paused local install sends no switch, no cloud, and says it is paused', w.installs.length === 1 && w.installs[0].turnOn === false && links.length === 0 && !world.calls.some((c) => c.path === '/kybernos-cloud/computers/publish') && part(root, 'team-installed').startsWith('Installed, paused') && part(root, 'team-installed').includes('It is in Yours, marked as a team copy. Turn it on when you are ready.'), part(root, 'team-installed'))
  // local install, turned on
  w = base(); root = await mountTeam(w)
  await click(root, btnIn(rowNamed(root, 'Daily stock check'), 'team-install'))
  await sleep(10); await root.settle()
  await click(root, kb(root, 'ti-allow')[0])
  await click(root, kb(root, 'ti-turnon')[0])
  await click(root, kb(root, 'team-sheet-go')[0])
  check('turned on here: the host is asked for it, and the answer decides what the sheet says', w.installs[0].turnOn === true && w.installs[0].approvals === 'auto' && part(root, 'team-installed').startsWith('Installed and turned on') && part(root, 'team-installed').includes('on this computer'))
  // missing apps: the PAGE knows, the host does not
  w = fixtures(); w.tasks = []; w.copies = []
  root = await mountTeam(w)
  await click(root, btnIn(rowNamed(root, 'Morning ticket triage'), 'team-install'))
  await sleep(10); await root.settle()
  check('an app that is not connected: the sheet says which and offers to connect it, and the copy is installed anyway', part(root, 'ti-missing') === 'You can install it now. It stays paused until Zendesk is connected. Connect Zendesk' && textOf(kb(root, 'ti-connect')[0]) === 'Connect Zendesk')
  check('...the switch is OFF and cannot be turned on, with the reason', kb(root, 'ti-turnon')[0].props.disabled === true && kb(root, 'ti-turnon')[0].props['aria-checked'] === 'false' && part(root, 'ti-turnon-hint') === 'Not possible yet: connect Zendesk first.')
  await click(root, kb(root, 'team-sheet-go')[0])
  check('...so the host is never asked to turn it on (turnOn is false)', w.installs.length === 1 && w.installs[0].turnOn === false && part(root, 'team-installed').includes('Turn it on when you are ready (after connecting Zendesk).'), [w.installs, part(root, 'team-installed')])
  w = fixtures(); w.tasks = []; w.copies = []
  root = await mountTeam(w)
  await click(root, btnIn(rowNamed(root, 'Morning ticket triage'), 'team-install'))
  await sleep(10); await root.settle()
  world.opened.length = 0
  await click(root, kb(root, 'ti-connect')[0])
  check('« Connect Zendesk » leaves the sheet and opens the Connectors page', kb(root, 'team-sheet').length === 0 && JSON.stringify(world.opened) === '[["kybernos-composio","connectors"]]', world.opened)
  // unknown connections
  w = fixtures(); w.tasks = []; w.copies = []; w.conn = null
  root = await mountTeam(w)
  await click(root, btnIn(rowNamed(root, 'Daily stock check'), 'team-install'))
  await sleep(10); await root.settle()
  check('when the connected apps cannot be read, nothing is turned on by guess: the switch is off and says so', kb(root, 'ti-turnon')[0].props.disabled === true && part(root, 'ti-turnon-hint').startsWith('Not possible while we cannot tell which apps are connected'))
  // the cloud computer, when the page\'s own tab says no
  const cases = [
    ['a computer that cannot ask before acting, for an automation that asks', (x) => { x.computers = [{ id: '3f2a1c10-0000-4000-8000-000000000001', name: 'Home', isHome: true, state: 'awake', capabilities: [] }] }, 'kbwr.block.old', undefined],
    ['no cloud computer', (x) => { x.computers = [] }, 'kbwr.block.none', undefined],
    ['signed out of the cloud', (x) => {}, 'kbwr.block.off', { connected: false }],
    ['a webhook automation (a cloud computer has no door for it)', (x) => { x.rows = x.rows.map((r) => r.id === 2 ? { ...r, schedule: { mode: 'webhook' } } : r) }, 'kbwr.block.webhook', undefined],
  ]
  for (const [label, mutate, key, props] of cases) {
    w = base(); mutate(w)
    root = await mountTeam(w, props)
    await click(root, btnIn(rowNamed(root, 'Daily stock check'), 'team-install'))
    await sleep(10); await root.settle()
    check('cloud is OFF for ' + label + ', with the page’s own reason', kb(root, 'ti-where-cloud')[0].props.disabled === true && part(root, 'ti-where-hint') === kbt(key) && kb(root, 'ti-where-local')[0].props['aria-pressed'] === 'true', [part(root, 'ti-where-hint'), kbt(key)])
  }
  w = base(); w.computers = [{ id: '3f2a1c10-0000-4000-8000-000000000001', name: 'Home', isHome: true, state: 'awake', capabilities: [] }]
  root = await mountTeam(w)
  await click(root, btnIn(rowNamed(root, 'Daily stock check'), 'team-install'))
  await sleep(10); await root.settle()
  await click(root, kb(root, 'ti-allow')[0])
  check('...and the same computer is on offer once the person chooses « Always allow »', kb(root, 'ti-where-cloud')[0].props.disabled === false)
  // cloud failures
  w = base(); root = await mountTeam(w)
  await click(root, btnIn(rowNamed(root, 'Daily stock check'), 'team-install'))
  await sleep(10); await root.settle()
  await click(root, kb(root, 'ti-where-cloud')[0])
  linkOk.v = false
  await click(root, kb(root, 'team-sheet-go')[0])
  check('the cloud link refused: it is installed here, paused, and the sheet says the cloud part failed (nothing runs twice)', part(root, 'ti-cloud-error') === 'It is installed here, paused, but could not be sent to the cloud computer: ' + kbt('kbwr.err.refused') && part(root, 'team-installed').startsWith('Installed, paused') && !world.calls.some((c) => c.path === '/kybernos-cloud/computers/publish'), [part(root, 'ti-cloud-error'), part(root, 'team-installed'), world.calls.map((c) => c.path), links])
  w = base(); root = await mountTeam(w)
  await click(root, btnIn(rowNamed(root, 'Daily stock check'), 'team-install'))
  await sleep(10); await root.settle()
  await click(root, kb(root, 'ti-where-cloud')[0])
  world.publish = () => ({ ok: false, error: 'too_frequent' })
  await click(root, kb(root, 'team-sheet-go')[0])
  check('the cloud computer refuses the copy: the link is undone (the copy stays here, paused) and the reason is shown', links.length === 2 && links[1][1] === null && part(root, 'ti-cloud-error').includes(kbt('kbwr.err.too_frequent')) && part(root, 'team-installed').startsWith('Installed, paused'), [links, part(root, 'ti-cloud-error'), part(root, 'team-installed')])
  // the host is not there
  w = base(); w.hostOld = true; root = await mountTeam(w)
  check('a DSH that has not loaded the host half: the buttons are off, with the reason, and a note says restart', btnIn(rowNamed(root, 'Daily stock check'), 'team-install').props.disabled === true && part(root, 'team-host-old') === 'This DSH has not loaded the update yet. Restart it to propose or install.')
  // keyboard and focus
  w = base(); root = await mountTeam(w)
  await click(root, btnIn(rowNamed(root, 'Daily stock check'), 'team-install'))
  await sleep(10); await root.settle()
  check('the sheet is a modal dialog with a name', kb(root, 'team-sheet')[0].props.role === 'dialog' && kb(root, 'team-sheet')[0].props['aria-modal'] === 'true' && kb(root, 'team-sheet')[0].props.tabIndex === -1)
  if (dom !== null) doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); else fakeDoc.press('Escape')
  await root.settle()
  check('Escape closes the sheet (a real key event on a real document)', kb(root, 'team-sheet').length === 0)
  await click(root, btnIn(rowNamed(root, 'Daily stock check'), 'team-install'))
  await sleep(10); await root.settle()
  kb(root, 'team-scrim')[0].props.onMouseDown({ target: kb(root, 'team-sheet')[0], currentTarget: kb(root, 'team-scrim')[0] })
  await root.settle()
  check('a press inside the sheet does not close it', kb(root, 'team-sheet').length === 1)
  kb(root, 'team-scrim')[0].props.onMouseDown({ target: kb(root, 'team-scrim')[0], currentTarget: kb(root, 'team-scrim')[0] })
  await root.settle()
  check('a press on the shade closes it', kb(root, 'team-sheet').length === 0)
  // nothing closes it while it is working
  w = base(); root = await mountTeam(w)
  await click(root, btnIn(rowNamed(root, 'Daily stock check'), 'team-install'))
  await sleep(10); await root.settle()
  world.delay = 40
  const pending = click(root, kb(root, 'team-sheet-go')[0])
  await sleep(10)
  root.render()
  check('while it installs the buttons say so and nothing closes the sheet', part(root, 'team-sheet-go') === 'Installing…' && kb(root, 'team-sheet-go')[0].props.disabled === true && kb(root, 'team-sheet-close')[0].props.disabled === true && kb(root, 'team-sheet-cancel')[0].props.disabled === true)
  if (dom !== null) doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); else fakeDoc.press('Escape')
  await pending
  world.delay = 0
  check('...Escape did not close it, and it ended on its done screen', kb(root, 'team-installed').length === 1)
}
console.log('the sheets: Update')
{
  const mk = () => {
    const w = fixtures()
    w.tasks = [localTask('st-1', 'Weekly client digest', { team: { workspaceId: 'W1', id: 1, key: 'weekly-client-digest', version: H('3'), base: { name: 'Weekly client digest', prompt: PROMPT_OLD, schedule: { mode: 'cron', cron: '30 8 * * 1-5' }, needs: ['gmail', 'slack'] } } })]
    w.copies = [{ taskId: 'st-1', workspaceId: 'W1', id: 1, key: 'weekly-client-digest', version: H('3'), edited: true, missingApps: [] }]
    return w
  }
  let w = mk()
  let root = await mountTeam(w)
  await click(root, btnIn(rowNamed(root, 'Weekly client digest'), 'team-update'))
  await sleep(10); await root.settle()
  check('Update opens the sheet: the title, the version the person has, the version on offer, when and by whom', kb(root, 'team-sheet')[0].props['data-sheet'] === 'update' && kb(root, 'team-sheet')[0].props['aria-label'] === 'Update “Weekly client digest”' && page(root).includes('You have #' + H('3').slice(0, 7) + ' · v4 approved 2 hours ago by Julien Petit'), page(root).slice(0, 300))
  check('a copy the person edited says so, before anything else', part(root, 'tu-edited') === 'EditedYou changed your copy of this automation. Updating can replace your changes — choose what happens to them.')
  check('Changes: computed from the copy’s own record of what it was, against what is on offer (lines out, lines in, what stayed)', page(root).includes('Changes since #' + H('3').slice(0, 7)) && all(root, (n) => n.props['data-k'] === 'del').some((n) => textOf(n).startsWith('− Summarise the client e-mails of the week.')) && all(root, (n) => n.props['data-k'] === 'add').some((n) => textOf(n).includes('grouped by client')) && page(root).includes('When, needs and checks are the same as #' + H('3').slice(0, 7) + '.'), page(root).slice(0, 700))
  check('three choices; the one that loses nothing starts selected', kb(root, 'tu-keep').length === 1 && kb(root, 'tu-both').length === 1 && kb(root, 'tu-replace').length === 1 && kb(root, 'tu-both')[0].props['aria-checked'] === 'true' && kb(root, 'tu-replace')[0].props['aria-checked'] === 'false' && part(root, 'team-sheet-go') === 'Save mine and update')
  check('each choice says what happens (« (mine) », the version it moves to, what is lost)', part(root, 'tu-both').includes('Your version stays as “Weekly client digest (mine)”, paused. The team copy moves to v4.') && part(root, 'tu-replace').includes('Your changes are lost. Its schedule, place and permissions stay as you set them.') && part(root, 'tu-keep').includes('Stay on #' + H('3').slice(0, 7) + ' with your changes. You can update later.'))
  clean(root, 'update')
  await click(root, kb(root, 'tu-keep')[0])
  check('the button follows the choice', part(root, 'team-sheet-go') === 'Keep my copy')
  await click(root, kb(root, 'team-sheet-go')[0])
  check('Keep my copy changes nothing: the host is not even asked, the sheet closes and says so', !(w.localCalls || []).some((c) => c[0] === 'team-update') && kb(root, 'team-sheet').length === 0 && notes[notes.length - 1] === 'Your copy of “Weekly client digest” was kept as it is.')
  await click(root, btnIn(rowNamed(root, 'Weekly client digest'), 'team-update'))
  await sleep(10); await root.settle()
  await click(root, kb(root, 'tu-replace')[0])
  check('Replace says the version it replaces with', part(root, 'team-sheet-go') === 'Replace with v4')
  w.update = { ok: false, error: 'invalid_automation', reason: 'prompt' }
  await click(root, kb(root, 'team-sheet-go')[0])
  check('a refusal of the host never leaves the sheet stuck: it is said, the buttons work', part(root, 'tu-fail') === 'The prompt must be 1 to 8,000 characters.' && part(root, 'team-sheet-go') === 'Replace with v4' && kb(root, 'team-sheet-go')[0].props.disabled === false && kb(root, 'team-sheet-close')[0].props.disabled === false)
  w.update = { ok: false, error: 'frequent schedule', everyMinutes: 3 }
  await click(root, kb(root, 'team-sheet-go')[0])
  check('an every-minute rhythm is a question here too; the yes is sent only after it', part(root, 'tu-frequent').includes('It would run every 3 minutes.') && w.updates[w.updates.length - 1].confirmFrequent === undefined)
  w.update = undefined
  await click(root, kb(root, 'tu-frequent-yes')[0])
  const up = w.updates[w.updates.length - 1]
  check('Replace posts the copy, the definition of the team and the mode « replace »; the sheet closes and the tab and Yours are read again', up.taskId === 'st-1' && up.mode === 'replace' && up.confirmFrequent === true && up.definition.id === 1 && up.definition.version === H('4') && up.definition.prompt === PROMPT_NEW && kb(root, 'team-sheet').length === 0 && notes[notes.length - 1] === '“Weekly client digest” is now on v4.' && refreshed.n >= 1, up)
  await click(root, btnIn(rowNamed(root, 'Weekly client digest'), 'team-update'))
  await sleep(10); await root.settle()
  await click(root, kb(root, 'team-sheet-go')[0])
  check('Save mine and update posts the mode « both » and says where the person’s version went', w.updates[w.updates.length - 1].mode === 'both' && notes[notes.length - 1] === '“Weekly client digest” is updated. Your version is saved as “Weekly client digest (mine)”, paused.')
  w.update = { ok: false, error: 'not_edited' }
  await click(root, btnIn(rowNamed(root, 'Weekly client digest'), 'team-update'))
  await sleep(10); await root.settle()
  const before = (w.localCalls || []).filter((c) => c[0] === 'team-copies').length
  await click(root, kb(root, 'team-sheet-go')[0])
  check('the host knows better whether the copy was edited: « not edited » is said, and the list of copies is read again', part(root, 'tu-fail') === 'You have not edited this copy, so there is nothing to keep: just update it.' && (w.localCalls || []).filter((c) => c[0] === 'team-copies').length > before)
  // an untouched copy
  w = mk(); w.copies[0].edited = false
  root = await mountTeam(w)
  await click(root, btnIn(rowNamed(root, 'Weekly client digest'), 'team-update'))
  await sleep(10); await root.settle()
  check('an untouched copy has no choice to make: one sentence, and the button says Update to v4', kb(root, 'tu-edited').length === 0 && kb(root, 'tu-keep').length === 0 && part(root, 'tu-clean') === 'You have not changed your copy, so the update replaces it. Its schedule, place and permissions stay as you set them.' && part(root, 'team-sheet-go') === 'Update to v4')
  await click(root, kb(root, 'team-sheet-go')[0])
  check('...and it asks for « replace » only', w.updates.length === 1 && w.updates[0].mode === 'replace')
  // no record of what the copy was
  w = mk(); w.tasks[0].team.base = null
  root = await mountTeam(w)
  await click(root, btnIn(rowNamed(root, 'Weekly client digest'), 'team-update'))
  await sleep(10); await root.settle()
  check('when the record of what the copy was is gone, the sheet says it cannot show the changes and still updates', part(root, 'tu-nobase') === 'We cannot show what changed: the original of your copy is not available.' && kb(root, 'team-sheet-go')[0].props.disabled === false)
  // the changes that are not the prompt
  w = mk(); w.tasks[0].team.base = { name: 'Weekly digest', prompt: PROMPT_NEW, schedule: { mode: 'cron', cron: '0 9 * * 1' }, needs: ['gmail', 'zendesk'] }
  root = await mountTeam(w)
  await click(root, btnIn(rowNamed(root, 'Weekly client digest'), 'team-update'))
  await sleep(10); await root.settle()
  check('a change of name, of time and of apps is listed in words (and the prompt is the same)', page(root).includes('Name: Weekly digest → Weekly client digest') && page(root).includes('When: Every Monday, 09:00 → Weekdays, 08:30') && page(root).includes('Needs added: Slack') && page(root).includes('Needs removed: Zendesk') && page(root).includes('The prompt is the same as #'), page(root).slice(0, 600))
  // the Mine tab and the marks of Yours
  console.log('Mine, and the marks of Yours')
  w = fixtures(); w.tasks = [localTask('st-3', 'Invoice reminder'), localTask('st-6', 'Meeting prep')]
  w.rows.push(srow(10, 'invoice-reminder', 'Invoice reminder', { version: H('a'), revision: 2, mine: true, status: 'approved' }))
  root = await mountTeam(w)
  await click(root, kb(root, 'team-filter-mine')[0])
  await click(root, btnIn(rowNamed(root, 'Meeting prep'), 'team-again'))
  await sleep(10); await root.settle()
  check('Propose again opens the sheet on the automation of the same key', kb(root, 'team-sheet')[0].props['data-sheet'] === 'propose' && kb(root, 'tp-pick').find((p) => p.props['data-id'] === 'st-6').props['aria-checked'] === 'true')
  await click(root, kb(root, 'team-sheet-cancel')[0])
  w.tasks = [localTask('st-3', 'Invoice reminder')]
  root.render()
  await click(root, btnIn(rowNamed(root, 'Meeting prep'), 'team-again'))
  check('...and when that automation is gone, says so instead of guessing', kb(root, 'tp-gone').length === 1 && part(root, 'tp-gone') === 'The automation “Meeting prep” is no longer in Yours. Pick another one.', [kb(root, 'team-sheet').length, kb(root, 'tp-pick').map((p) => p.props['data-id']), kb(root, 'tp-gone').length])
  await click(root, kb(root, 'team-sheet-cancel')[0])
  const updMine = btnIn(rowsOf(root).find((r) => r.props['data-status'] === 'approved'), 'team-update-mine')
  check('an approved proposal of the person can be updated: Propose an update', updMine !== undefined && textOf(updMine) === 'Propose an update' && part(root, 'team-table').includes('Approved · v2'))
  await click(root, updMine)
  await sleep(10); await root.settle()
  check('...on the same automation, which says it is shared', kb(root, 'tp-pick').find((p) => p.props['data-id'] === 'st-3').props['aria-checked'] === 'true' && page(root).includes('Shared · v2 — send an update'))
  const tasks = [localTask('st-3', 'Invoice reminder'), localTask('st-8', 'Digest', { team: { workspaceId: 'W1', id: 1, key: 'weekly-client-digest', version: H('3'), base: {} } }), localTask('st-9', 'Old thing')]
  const team = { phase: 'ready', mine: [core.kbtaRow(w.rows.find((r) => r.id === 10)), core.kbtaRow(w.rows.find((r) => r.id === 5))], workspaceName: 'Acme Studio' }
  const txt = (e) => (e === null ? '' : textOf(mount(e).tree))
  const chip = (t) => txt(X.kbtaRowShared(t, team))
  check('Yours marks what the person shared (the version) and what waits, and a copy from the team is marked as such, not as shared', chip(tasks[0]) === 'Shared with Acme Studio · v2' && X.kbtaRowMark(tasks[1]) === 'Team copy' && X.kbtaRowShared(tasks[1], team) === null && X.kbtaRowMark(tasks[0]) === '' && X.kbtaRowMark(null) === '' && chip(tasks[2]) === '' && chip(localTask('x', 'Invoice reminder', {})) === 'Shared with Acme Studio · v2')
  const waiting = { ...team, mine: [team.mine[1]] }
  check('...a proposal that waits says so', txt(X.kbtaRowShared(tasks[0], waiting)) === 'Proposed to Acme Studio' && X.kbtaRowShared(tasks[0], { phase: 'locked' }) === null && X.kbtaRowShared(tasks[0], { phase: 'loading' }) === null)
}
console.log('the page is wired to the tab')
{
  const pageFrom = SRC.indexOf('    const ScheduledTasksPage = () => {')
  const pageSrc = SRC.slice(pageFrom, SRC.indexOf('    const KB_MOCK_SKILLS = ', pageFrom))
  const hook = pageSrc.indexOf('const team = kbtaUseSummary(section)')
  const early = pageSrc.indexOf('if (t !== null) {')
  check('the summary is read with the other hooks of the page, before its early return for the page of one automation (a hook after a return breaks the page)', hook > 0 && early > hook)
  check('the segment is drawn after Yours and Discover, and the tab is the body of the page when it is the section', /\.concat\(\[kbtaSegment\(team, section, \(\) => setSection\('team'\)\)\]\)/.test(pageSrc) && /\(section === 'team' \? h\(KbTeamAutomations, \{ sum: team, tasks, computers: computersPair\[0\]\.list, connected: computersPair\[0\]\.connected === true, req: proposeReq/.test(pageSrc))
  check('a row of Yours has « Propose to team… » (an icon with its name, hidden only when the Team routes are absent) and it goes through proposeTask', /\(team\.phase !== 'absent' \? h\('button', \{ type: 'button', className: 'kb-favbtn', 'data-kb': 'action-propose', title: kbt\('kbta\.propose\.menu'\), 'aria-label': kbt\('kbta\.propose\.row'\)[^\n]*proposeTask\(a\.id\)/.test(pageSrc))
  check('the menu of the page of an automation has the same entry', /\.\.\.\(team\.phase !== 'absent' \? \[\{ kb: 'detail-propose', icon: Icon\('users', 14\), label: kbt\('kbta\.propose\.menu'\), run: \(\) => proposeTask\(t\.id\) \}\] : \[\]\)/.test(pageSrc))
  check('proposeTask leaves the page of the automation, goes to the Team section and asks for the sheet', /const proposeTask = \(id\) => \{ setDetail\(null\); setNodeSel\(null\); setSection\('team'\); setProposeReq\(\{ taskId: id, n: Date\.now\(\) \}\) \}/.test(pageSrc))
  check('a request for the sheet that nobody served is dropped when the person leaves the tab, and a server without the routes sends the page back to Yours', /if \(section !== 'team'\) setProposeReq\(null\)/.test(pageSrc) && /if \(section === 'team' && team\.phase === 'absent'\) setSection\('yours'\)/.test(pageSrc))
  check('Yours marks a team copy under its name and what was proposed in its State column', /\+ \(kbtaRowMark\(t\) !== '' \? ' (?:\\u00b7|·) ' \+ kbtaRowMark\(t\) : ''\)/.test(pageSrc) && /kbtaRowShared\(a\._t, team\)/.test(pageSrc))
  check('the cloud link of an installed copy is the page’s own « cloud-link » action', /action: 'cloud-link', id, cloud/.test(pageSrc))
  check('the actions column of a row of Yours has room for six buttons', /\.kba-rowline\{display:grid;grid-template-columns:minmax\(0,1fr\) 176px 40px;/.test(SRC))
  check('nothing outside the block names a Team route or draws a sheet (one block, one place)', (SRC.replace(BLOCK, '').match(/team\/automations|automation\/team-/g) || []).length === 0)
}
console.log('the CSS')
{
  const cssFrom = BLOCK.length > 0 ? SRC.indexOf('kybers: team automations styles') : -1
  const start = SRC.lastIndexOf('styles.insert(`', cssFrom)
  const css = SRC.slice(start + 'styles.insert(`'.length, cssFrom).replace(/`\), '$/, '')
  const classes = new Set([...BLOCK.matchAll(/['"` ](kbta-[a-z0-9-]+)/g)].map((m) => m[1]).filter((c) => !c.endsWith('-')))
  const rules = new Set([...css.matchAll(/\.(kbta-[a-z0-9-]+)/g)].map((m) => m[1]))
  const hooks = new Set(['kbta-desc', 'kbta-desc-hint', 'kbta-note', 'kbta-reason', 'kbta-block', 'kbta-core'])
  const missing = [...classes].filter((c) => !rules.has(c) && !hooks.has(c))
  check('every class the block draws has a rule in the block’s CSS (' + classes.size + ' classes)', missing.length === 0, missing)
  check('the CSS names no colour of its own: the page’s tokens (--dsw-alias-*) and nothing else', !/#[0-9a-fA-F]{3,8}\b/.test(css.replace(/rgba\(0,0,0,[.0-9]+\)/g, '')) && !/\b(?:rgb|hsl)a?\((?!0,0,0)/.test(css), css.match(/#[0-9a-fA-F]{3,8}\b/g))
  check('...and the sheet is a fixed drawer over the page that takes the width of a phone (the engine keeps its own 16 px gutter for every dialog)', /\.kbta-scrim\{[^}]*position:fixed[^}]*z-index:200/.test(css) && /@media \(max-width:700px\)\{\.kbta-sheet\{width:100%/.test(css) && /\.kbta-sheet\{[^}]*width:620px;max-width:100%/.test(css))
  check('a sheet never squeezes the blocks of its body: they keep their height and the body scrolls (a list in a sheet once collapsed to nothing)', /\.kbta-sbody>\*\{flex:none\}/.test(css) && /\.kbta-sbody\{[^}]*overflow-y:auto/.test(css))
  if (dom !== null) {
    const d = new JSDOM('<!doctype html><style id="s"></style><body></body>')
    d.window.document.getElementById('s').textContent = css
    const sheet = d.window.document.styleSheets[0]
    check('a real CSS engine reads every rule of the block (' + sheet.cssRules.length + ' rules, none lost)', sheet.cssRules.length >= 90 && !/\}\s*\}/.test(css.replace(/@(media|container)[^{]*\{[\s\S]*?\}\s*\}/g, '')), sheet.cssRules.length)
  }
}

// ── the end ──
console.log('\n' + (pass + fail) + ' checks, ' + pass + ' passed, ' + fail + ' failed' + (JSDOM === null ? '\nSKIPPED: the checks that need a real document (jsdom is not importable: set KYBERNOS_JSDOM=<path to jsdom/lib/api.js>)' : ''))
process.exit(fail === 0 ? 0 : 1)
