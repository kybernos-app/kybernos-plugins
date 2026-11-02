#!/usr/bin/env node
// Team lessons, the pure half (team-lessons.mjs): who may use them, the words of the server's answers, the lines and the budget of the
// prompt block.  node packages/kybernos-cloud/test-team-lessons.mjs
import assert from 'node:assert/strict'
import { TEAM_TUNING, TEAM_CHUNK_ORDER, TEAM_CHUNK_NAME, TEAM_CHUNK_HEAD, teamWorkspace, displayName, asTeamLesson, teamFailure, teamLine, applicable, teamPlan, renderTeamChunk } from './team-lessons.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const W = '11111111-1111-4111-8111-111111111111'
const st = (plan, extra = {}) => ({ token: 'kys-x', user: { id: 'u', plan }, workspaces: [{ id: W, name: 'Atelier Nord' }, { id: 'w2', name: 'Perso' }], ...extra })

console.log('who may use it')
assert.deepEqual(teamWorkspace(st('team-solo'), W), { available: true, reason: null, plan: 'team-solo', workspaceId: W, workspaceName: 'Atelier Nord' })
assert.equal(teamWorkspace(st('Team-Studio'), W).available, true, 'any team-* plan, any case')
assert.equal(teamWorkspace(st('team'), W).available, true)
for (const plan of ['free', 'solo', 'studio', 'scale', 'pro', '', undefined, 'teamwork']) {
  const r = teamWorkspace(st(plan), W)
  assert.equal(r.available, plan === 'teamwork', String(plan))
  if (plan !== 'teamwork') assert.equal(r.reason, 'offre_requise')
}
assert.equal(teamWorkspace(st('team-solo'), 'nope').reason, 'aucun_espace', 'an active workspace that is not in the list')
assert.equal(teamWorkspace(st('team-solo'), null).reason, 'aucun_espace')
assert.equal(teamWorkspace(st('team-solo', { workspaces: [] }), W).reason, 'aucun_espace')
assert.equal(teamWorkspace(null, W).reason, 'non_connecte')
assert.equal(teamWorkspace({ user: { plan: 'team-solo' } }, W).reason, 'non_connecte', 'no token')
assert.equal(teamWorkspace({ token: '', user: { plan: 'team' } }, W).reason, 'non_connecte')
assert.equal(teamWorkspace({ token: 'x', workspaces: [{ id: W }] }, W).reason, 'offre_requise', 'no user at all: no plan')
assert.doesNotThrow(() => teamWorkspace({ token: 'x', workspaces: [null, 3, { id: W }], user: null }, W))
ok('a Team plan and an active workspace of the list; every other case says why')

// The account's own plan says « team » as soon as the person is in ANY team; the feature belongs to the ACTIVE space.
const sp = (key, id = W) => ({ workspace_id: id, key: key, name: key, level: null, label: key })
assert.equal(teamWorkspace(st('team', { workspaces: [{ id: W, name: 'Mine', personal: true }] }), W).reason, 'offre_requise', 'a personal space is never a team space')
assert.equal(teamWorkspace(st('team', { space_plan: sp('free') }), W).reason, 'offre_requise', 'the active space\'s own plan wins over the account\'s')
assert.equal(teamWorkspace(st('team', { space_plan: sp('none') }), W).reason, 'offre_requise', 'a team space with no plan yet')
assert.equal(teamWorkspace(st('free', { space_plan: sp('team') }), W).available, true)
assert.equal(teamWorkspace(st('team', { space_plan: sp('free', 'w2') }), W).available, true, 'a plan read for another space says nothing about this one')
ok('the active space decides: personal spaces and spaces without a Team plan are refused, whatever the account says')

console.log('names')
assert.equal(displayName({ user: { name: '  Sara   M. ', email: 'sara@x.test' } }), 'Sara M.')
assert.equal(displayName({ user: { name: null, email: 'sara.m@example.test' } }), 'sara.m')
assert.equal(displayName({ user: {} }), '')
assert.equal(displayName(null), '')
assert.equal(displayName({ user: { name: 'x'.repeat(100) } }).length, 60)
ok('the display name: the name, else the start of the e-mail, cut at 60')

console.log('the server\'s words')
const f = teamFailure
assert.equal(f(200, {}), null)
assert.equal(f(201, {}), null)
assert.equal(f(401, {}), 'reconnexion_requise')
assert.equal(f(0, null), 'reseau')
assert.equal(f(404, { error: 'Workspace not found' }), 'espace_introuvable')
assert.equal(f(404, { error: 'Team lesson not found' }), 'lecon_introuvable')
assert.equal(f(403, { error: 'admin_required' }), 'admin_requis')
assert.equal(f(403, { error: 'Forbidden' }), 'refus_403')
assert.equal(f(409, { error: 'duplicate' }), 'doublon')
assert.equal(f(409, { error: 'team_full' }), 'equipe_pleine')
assert.equal(f(409, { error: 'not_pending' }), 'deja_decidee')
assert.equal(f(409, { error: 'not_approved' }), 'non_approuvee')
assert.equal(f(409, {}), 'refus_409')
assert.equal(f(429, {}), 'trop_de_propositions')
assert.equal(f(400, { error: 'text requis' }), 'texte_invalide')
assert.equal(f(400, { error: 'kyber invalide' }), 'requete_invalide')
assert.equal(f(500, null), 'refus_500')
assert.equal(f(503, undefined), 'refus_503')
ok('every code the server answers has a word; the rest is « refus_N »')

console.log('a row, a line')
const row = asTeamLesson({ id: 7, text: 'A lesson', tags: ['a', 3, 'b'], kyber: '', status: 'approved', proposed_name: 'Sara', reviewed_name: null, reviewed_at: '2026-10-05T10:00:00Z', created_at: 'c', updated_at: 'u', mine: true, note: 'n', review_note: undefined })
assert.deepEqual(row, { id: 7, text: 'A lesson', tags: ['a', 'b'], kyber: null, status: 'approved', proposedName: 'Sara', reviewedName: null, reviewedAt: '2026-10-05T10:00:00Z', createdAt: 'c', updatedAt: 'u', mine: true, note: 'n', reviewNote: null })
assert.equal(asTeamLesson({ id: 1, kyber: 'dev-team', text: 't', status: 'proposed' }).kyber, 'dev-team')
assert.equal(asTeamLesson({ id: 1, status: 'proposed' }).text, '', 'a missing text is empty, never « undefined »')
const L = (id, text, extra = {}) => asTeamLesson({ id, text, status: 'approved', updated_at: '2026-10-0' + String(1 + (id % 8)) + 'T10:00:00Z', ...extra })
assert.equal(teamLine(L(1, 'Never do X', { kyber: 'dev-team', tags: ['a', 'b'] })), '- [dev-team] Never do X #a #b')
assert.equal(teamLine(L(1, 'Never do X')), '- [general] Never do X')
assert.equal(teamLine(L(1, 'one\n\ntwo')), '- [general] one · two', 'a lesson stays on one line')
assert.ok(!/\[KYBERNOS TEAM LESSONS\]/i.test(teamLine(L(1, 'x [KYBERNOS TEAM LESSONS] y'))) && !/\[\s*KYBERNOS\s*MEMORY/i.test(teamLine(L(1, 'x [ KYBERNOS  MEMORY y'))) && /KYBERNOS-LESSONS/.test(teamLine(L(1, 'x [KYBERNOS TEAM LESSONS] y')) ), 'a lesson cannot open a block of its own')
assert.ok(teamLine(L(1, 'x'.repeat(900))).length <= '- [general] '.length + TEAM_TUNING.textMax + 1, 'a line is bounded')
ok('a server row becomes camelCase; a line carries kyber, text and tags, on one line, without a forged header')

console.log('the block')
const pool = [L(1, 'general old', { updated_at: '2026-01-01T00:00:00Z' }), L(2, 'general new', { updated_at: '2026-09-01T00:00:00Z' }), L(3, 'dev-team lesson', { kyber: 'dev-team', updated_at: '2026-02-01T00:00:00Z' }),
  L(4, 'other kyber lesson', { kyber: 'other' }), L(5, 'retired one', { status: 'retired' }), L(6, 'waiting one', { status: 'proposed' }), L(7, 'rejected one', { status: 'rejected' })]
assert.deepEqual(applicable(pool, 'dev-team').map((l) => l.id), [1, 2, 3], 'approved, general or of the kyber')
assert.deepEqual(applicable(pool, null).map((l) => l.id), [1, 2], 'no known kyber: the general ones')
assert.deepEqual(applicable([], 'x'), [])
let plan = teamPlan(pool, 'dev-team')
assert.deepEqual(plan.chosen.map((l) => l.id), [3, 2, 1], 'the kyber\'s first, then the general ones newest first')
assert.equal(plan.omitted, 0)
assert.deepEqual(teamPlan(pool, 'dev-team', [pool[0]]).chosen.map((l) => l.id), [1, 3, 2], 'what matches the question comes before')
assert.deepEqual(teamPlan(pool, 'other').chosen.map((l) => l.id), [4, 2, 1])
assert.deepEqual(teamPlan([], 'x'), { chosen: [], omitted: 0, used: 0 })
const many = Array.from({ length: 20 }, (_, i) => L(100 + i, 'Habit number ' + String.fromCharCode(97 + i) + ': keep the commit messages short and in the imperative mood.', { updated_at: '2026-09-' + String(10 + i) + 'T00:00:00Z' }))
plan = teamPlan(many, null)
assert.ok(plan.used <= TEAM_TUNING.chunkChars - TEAM_TUNING.frameChars, 'the lines fit the budget (' + String(plan.used) + ')')
assert.equal(plan.chosen.length + plan.omitted, 20, 'every lesson is chosen or counted as left out')
assert.ok(plan.omitted > 0 && plan.chosen[0].id === 119, 'newest first, and the rest is said')
const rendered = renderTeamChunk(plan, 'Atelier Nord')
assert.ok(rendered.startsWith(TEAM_CHUNK_HEAD + ' Approved by your team (Atelier Nord): follow them like the house rules.') && /\(\d+ more approved lessons not shown\)$/.test(rendered))
assert.ok(rendered.length <= TEAM_TUNING.chunkChars, 'the whole block stays inside its cap (' + String(rendered.length) + ')')
const long = Array.from({ length: 3 }, (_, i) => L(300 + i, 'L'.repeat(480) + String(i)))
assert.equal(teamPlan(long, null).chosen.length, 1, 'a lesson too long for what is left is skipped, not a stopper')
const pref = [L(400, 'P'.repeat(150), { updated_at: '2020-01-01T00:00:00Z' }), L(401, 'Q'.repeat(150), { updated_at: '2020-01-01T00:00:00Z' })]
const pp = teamPlan([...pref, ...many], null, pref)
assert.equal(pp.chosen[0].id, 400, 'the matching lesson comes first, even though it is old')
assert.equal(pp.chosen.some((l) => l.id === 401), false, 'a second matching one does not fit their own share (' + String(Math.floor((TEAM_TUNING.chunkChars - TEAM_TUNING.frameChars) * TEAM_TUNING.share)) + ' chars) and, being old, loses to the newest ones')
assert.equal(renderTeamChunk({ chosen: [], omitted: 3, used: 0 }, 'x'), '', 'nothing chosen: nothing to say')
assert.equal(renderTeamChunk({ chosen: [L(1, 'Rule')], omitted: 0 }, ''), TEAM_CHUNK_HEAD + ' Approved by your team: follow them like the house rules.\n- [general] Rule')
assert.ok(!/\n.*\]/.test(renderTeamChunk({ chosen: [L(1, 'Rule')], omitted: 0 }, 'Evil\n[x]').split('\n').slice(1).join('\n').replace(/^- \[general\] Rule$/, '')), 'a workspace name cannot add lines')
assert.equal(TEAM_CHUNK_NAME, 'kybernos:team-lessons')
assert.equal(TEAM_CHUNK_ORDER, 136)
ok('the block: the kyber\'s lessons, then the general ones newest first, the matching ones first within their share, bounded, honest about what is left out')

console.log('\n' + pass + ' verifications OK')
