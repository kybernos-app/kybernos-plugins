#!/usr/bin/env node
/** The role selectors of « Share this project » say what the server does (recette L2-17, 2026-10-25; decision DL-03, option a).
 *
 *  The selector read « Can view / Can edit » and « Can edit » sent the server's `admin` role: the person invited to « edit a project » became an administrator of
 *  the whole team (approves what is installed for everyone, changes roles, removes members, reads the audit). The server has two roles for a member, so the
 *  selectors now say « Member » and « Administrator », the box starts on « Member », and giving the administrator role asks first, in the dialog, in one sentence.
 *
 *  The dialog is cut out of client.js and rendered on a small React (lib-lite-react-test.mjs) with a fake server behind `fetch`: the labels, what is sent for
 *  each pick, that nothing is sent before the confirmation, and that the project's own « Team » access (local, Can view / Can edit) was left as it was.
 *
 *  Usage: node packages/kybernos-plugin/test-share-roles.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLite } from './lib-lite-react-test.mjs'

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

// ── the dictionary, as the page has it ──
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const entry = (key) => new RegExp("'" + esc(key) + "': \\{ kybernos: '((?:[^'\\\\]|\\\\.)*)', en: '((?:[^'\\\\]|\\\\.)*)' \\}").exec(src)
const text = (key, lang) => { const m = entry(key); assert.ok(m !== null, key + ' is in the dictionary, in both languages'); return m[lang === 'fr' ? 1 : 2].replace(/\\'/g, '\'') }

// ── 1. the words ──
{
  assert.equal(text('kbsd.role.member', 'en'), 'Member')
  assert.equal(text('kbsd.role.admin', 'en'), 'Administrator')
  assert.equal(text('kbsd.role.member', 'fr'), 'Membre')
  assert.equal(text('kbsd.role.admin', 'fr'), 'Administrateur')
  for (const lang of ['en', 'fr']) {
    const s = text('kbsd.admin.confirm', lang)
    assert.ok(s.length > 20 && s.length < 120 && (s.match(/\./g) || []).length === 1 && s.endsWith('.'), lang + ': the confirmation is one short sentence: ' + s)
    assert.ok(text('kbsd.confirm', lang).length > 3)
  }
  assert.match(text('kbsd.admin.confirm', 'en'), /approve/i, 'it says what an administrator does')
  ok('« Member » / « Administrator » and the one sentence of the confirmation exist in English and French')
}

// ── the dialog, cut out and rendered ──
const lite = createLite()
const { React } = lite
const h = React.createElement
const a = src.indexOf('const KB_EMAIL_RE = ')
const b = src.indexOf('\n\n\n    const TeamsHub = () => {')
assert.ok(a > 0 && b > a, 'found the share dialog')

const world = { calls: [], inflight: 0, members: [], lang: 'en' }
const json = (body, status = 200) => ({ status, json: async () => JSON.parse(JSON.stringify(body)) })
const fakeFetch = async (url, opts) => {
  world.inflight += 1
  try {
    await new Promise((r) => setTimeout(r, 1))
    const method = opts && opts.method ? opts.method : 'GET'
    const body = opts && opts.body ? JSON.parse(opts.body) : null
    world.calls.push({ method, url: String(url), body })
    if (url === '/kybernos/share' && method === 'GET') return json({ ok: true, shares: {} })
    if (url === '/kybernos-cloud/status') return json({ connected: true, state: { user: { id: 'u-me', name: 'Ada Lovelace', email: 'ada@example.test' }, workspaces: [{ id: 'w0', name: 'Personal' }, { id: 'w1', name: 'Atelier' }], active_workspace_id: 'w1', web_url: 'https://app.example.test' } })
    if (url === '/kybernos-cloud/members') return json({ ok: true, members: world.members })
    if (url === '/kybernos-cloud/members/invite') {
      if (body.user_id) { const m = world.members.find((x) => x.user_id === body.user_id); if (m) m.role = body.role }
      return json({ ok: true })
    }
    return json({ ok: false, error: 'not stubbed: ' + url }, 404)
  } finally { world.inflight -= 1 }
}
const scope = {
  React, h, fetch: fakeFetch, Icon: (n) => h('i', { 'data-icon': n }), kbPortalDe: (el) => el, kbAncreDe: () => null,
  kbt: (key) => text(key, world.lang), kbe: (s) => s,
  host: { call: async () => ({ ok: false }) }, timerSvc: { timeout: (f, ms) => setTimeout(f, ms) }, kbServer: { web: 'https://app.example.test' },
  window: { innerWidth: 1200, innerHeight: 800, addEventListener () {}, removeEventListener () {}, dispatchEvent () {} },
  document: undefined,
}
const Share = new Function(...Object.keys(scope), src.slice(a, b) + '\nreturn KbShareDialog')(...Object.values(scope))
const q = (root, mark) => lite.find(root.tree, (n) => n.props['data-kb'] === mark)
const one = (root, mark) => { const l = q(root, mark); assert.equal(l.length, 1, mark + ' appears once (found ' + l.length + ')'); return l[0] }
const opts = (sel) => lite.find(sel, (n) => n.tag === 'option').map((o) => [o.props.value, lite.textOf(o)])
const settle = (root) => root.settle(() => world.inflight > 0)
const fresh = async (members) => {
  world.calls = []
  world.lang = 'en'
  world.members = members
  const root = lite.mount(h(Share, { item: { kind: 'workspace', id: 'p1', titre: 'My project', anchor: null }, onClose () {} }))
  await settle(root)
  return root
}
const members = () => [
  { user_id: 'u-o', role: 'owner', name: 'Olga Owner' },
  { user_id: 'u-me', role: 'admin', name: 'Ada Lovelace', email: 'ada@example.test' },
  { user_id: 'u-2', role: 'member', name: 'Bob Martin', email: 'bob@example.test' },
  { user_id: 'u-3', role: 'admin', name: 'Cleo Admin', email: 'cleo@example.test' },
]
const writes = () => world.calls.filter((c) => c.method === 'POST' && c.url === '/kybernos-cloud/members/invite').map((c) => c.body)
const type = async (root, value) => { one(root, 'share-email').props.onChange({ target: { value } }); await settle(root) }
const pick = async (root, mark, value, which = 0) => { q(root, mark)[which].props.onChange({ target: { value } }); await settle(root) }
const press = async (root, mark, which = 0) => { q(root, mark)[which].props.onClick({}); await settle(root) }

// ── 2. the labels ──
{
  const root = await fresh(members())
  const invite = one(root, 'share-invite-role')
  assert.deepEqual(opts(invite), [['member', 'Member'], ['admin', 'Administrator']], 'the invitation box offers Member and Administrator, the lesser first')
  assert.equal(invite.props.value, 'member', 'and starts on Member (a person is made an administrator on purpose)')
  const rows = q(root, 'share-member-role')
  assert.equal(rows.length, 3, 'a selector for each member but the owner (the owner is a word, not a choice)')
  for (const r of rows) assert.deepEqual(opts(r), [['member', 'Member'], ['admin', 'Administrator']])
  assert.deepEqual(rows.map((r) => r.props.value), ['admin', 'member', 'admin'], 'each row shows the role the server gave: an admin reads Administrator')
  const shown = lite.textOf(root.tree)
  assert.ok(!/Can edit/.test(lite.textOf(one(root, 'share-invite')) + lite.textOf(one(root, 'share-members'))), 'no « Can edit » where a person is invited or listed')
  assert.ok(shown.includes('Olga Owner') && shown.includes('Owner'), 'the owner stays a word')
  ok('the invitation box and every member row say Member / Administrator; an administrator of the server reads « Administrator »; the box starts on Member')
}

// ── 3. the project's own access for the team is local, and was left as it was ──
{
  const root = await fresh(members())
  assert.deepEqual(opts(one(root, 'share-team-select')), [['off', 'Off'], ['view', 'Can view'], ['edit', 'Can edit']], 'the « Team » access to this project (saved on this device, badge Local) keeps its own words')
  ok('the local « Team » access of the project keeps Off / Can view / Can edit (it is not a server role)')
}

// ── 4. inviting ──
{
  const root = await fresh(members())
  await type(root, 'new@example.test')
  await press(root, 'share-invite-btn')
  assert.deepEqual(writes(), [{ email: 'new@example.test', role: 'member' }], 'a plain invitation is a member, at once, with nothing to confirm')
  assert.equal(q(root, 'share-admin-confirm').length, 0, 'and no sentence')
  ok('inviting a member sends role member at once')
}
{
  const root = await fresh(members())
  await type(root, 'boss@example.test')
  await pick(root, 'share-invite-role', 'admin')
  assert.equal(one(root, 'share-invite-btn').props.disabled, false, 'the button is ready')
  assert.equal(lite.textOf(one(root, 'share-invite-btn')), 'Invite')
  await press(root, 'share-invite-btn')
  assert.deepEqual(writes(), [], 'inviting an Administrator sends NOTHING on the first press')
  assert.equal(lite.textOf(one(root, 'share-admin-confirm')), text('kbsd.admin.confirm', 'en'), 'the dialog says in one sentence what an administrator can do')
  assert.equal(lite.textOf(one(root, 'share-invite-btn')), 'Confirm', 'and the button becomes « Confirm »')
  await press(root, 'share-invite-btn')
  assert.deepEqual(writes(), [{ email: 'boss@example.test', role: 'admin' }], 'the second press sends the invitation, as admin')
  assert.equal(q(root, 'share-admin-confirm').length, 0, 'the sentence is gone')
  assert.equal(lite.textOf(one(root, 'share-invite-btn')), 'Invite')
  assert.equal(one(root, 'share-email').props.value, '', 'and the box is empty again')
  ok('inviting an Administrator asks first (one sentence, button « Confirm »), then sends role admin')
}
{
  // Enter in the box goes the same way; changing anything cancels the confirmation.
  const root = await fresh(members())
  await type(root, 'boss@example.test')
  await pick(root, 'share-invite-role', 'admin')
  one(root, 'share-email').props.onKeyDown({ key: 'Enter' })
  await settle(root)
  assert.deepEqual(writes(), [], 'Enter does not skip the confirmation')
  assert.equal(q(root, 'share-admin-confirm').length, 1)
  await type(root, 'boss@example.test, other@example.test')
  assert.equal(q(root, 'share-admin-confirm').length, 0, 'editing the addresses withdraws the confirmation: it was for another list')
  await press(root, 'share-invite-btn')
  assert.deepEqual(writes(), [], 'the next press asks again')
  await pick(root, 'share-invite-role', 'member')
  assert.equal(q(root, 'share-admin-confirm').length, 0, 'back to Member withdraws it')
  await press(root, 'share-invite-btn')
  assert.deepEqual(writes(), [{ email: 'boss@example.test', role: 'member' }, { email: 'other@example.test', role: 'member' }], 'and Invite then sends both addresses as members')
  ok('Enter cannot skip the confirmation; editing the addresses or going back to Member withdraws it')
}

// ── 5. changing a member's role ──
{
  const root = await fresh(members())
  await pick(root, 'share-member-role', 'admin', 1)
  assert.deepEqual(writes(), [], 'making a member an Administrator sends nothing at the pick')
  assert.equal(one(root, 'share-admin-confirm').children.length > 0, true, 'the sentence is shown')
  assert.equal(q(root, 'share-member-role')[1].props.value, 'admin', 'the row shows the pick, waiting')
  assert.equal(q(root, 'share-member-admin-confirm').length, 1, 'with a « Confirm » button on that row only')
  await press(root, 'share-member-admin-confirm')
  assert.deepEqual(writes(), [{ user_id: 'u-2', role: 'admin' }], 'the button sends role admin for that member')
  assert.equal(q(root, 'share-admin-confirm').length + q(root, 'share-member-admin-confirm').length, 0, 'and the question is gone')
  ok('making a member an Administrator waits for « Confirm » on the row, then sends role admin')
}
{
  const root = await fresh(members())
  await pick(root, 'share-member-role', 'admin', 1)
  await pick(root, 'share-member-role', 'member', 1)
  assert.equal(q(root, 'share-admin-confirm').length + q(root, 'share-member-admin-confirm').length, 0, 'going back to the role the member has withdraws the question')
  assert.deepEqual(writes(), [], 'and sends nothing')
  await pick(root, 'share-member-role', 'member', 2)
  assert.deepEqual(writes(), [{ user_id: 'u-3', role: 'member' }], 'taking the administrator role away needs no question: it goes at once')
  ok('going back asks and sends nothing; taking the administrator role away goes at once')
}

// ── 6. nothing but « admin » makes an administrator ──
{
  // Whatever a selector holds, only the exact value admin reaches the server as admin.
  const root = await fresh([{ user_id: 'u-me', role: 'admin', name: 'Ada' }, { user_id: 'u-7', role: 'viewer', name: 'Odd Role' }, { user_id: 'u-8', role: 'edit', name: 'Old Value' }])
  assert.deepEqual(q(root, 'share-member-role').map((r) => r.props.value), ['admin', 'member', 'member'], 'a role the page does not know reads as Member, never as Administrator')
  await type(root, 'x@example.test')
  await pick(root, 'share-invite-role', 'edit')
  await press(root, 'share-invite-btn')
  assert.deepEqual(writes(), [{ email: 'x@example.test', role: 'member' }], 'an old value (« edit ») sent to the selector is a member')
  ok('only the exact value « admin » makes an administrator; every other value is a member')
}

// ── 7. French ──
{
  const root = await fresh(members())
  world.lang = 'fr'
  root.update(h(Share, { item: { kind: 'workspace', id: 'p1', titre: 'Mon projet', anchor: null }, onClose () {} }))
  await settle(root)
  assert.deepEqual(opts(one(root, 'share-invite-role')), [['member', 'Membre'], ['admin', 'Administrateur']])
  ok('the same selectors in French: Membre / Administrateur')
}

console.log('\n' + pass + ' checks passed')
