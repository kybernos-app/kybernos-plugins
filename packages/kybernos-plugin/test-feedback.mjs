// The beta-feedback tool (`kybernos_signaler_retour`), host half: what leaves the machine, what stays, and what the person is told.
// Born from the 2026-10 customer-journey acceptance test run against a local replica of the Kybernos server.
//
//   node packages/kybernos-plugin/test-feedback.mjs
//
// No network (a fake `fetch`), a throw-away DSH home. Each assertion carries the incident it guards.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'kb-feedback-test-'))
process.env.DSH_HOME = home
process.env.DSH_VERSION = '0.2.0-rc.2'
const TOKEN = 'kys_test_token_0000000000000000'
const writeState = (over = {}) => writeFileSync(join(home, 'kybernos-cloud.json'), JSON.stringify({ token: TOKEN, api: 'http://relay.invalid', ...over }))
writeState()

let n = 0
const ok = (name) => { n += 1; console.log('  ✓ ' + name) }

// A fake relay: answers come from a queue; every POST is recorded.
const posts = []
let answers = []
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  posts.push({ url, auth: init.headers.authorization, body })
  const next = answers.length > 0 ? answers.shift() : { status: 201, json: { ok: true, issue: { url: 'https://example.invalid/issues/' + posts.length } } }
  if (next.throws === true) throw new TypeError('fetch failed')
  return { status: next.status, text: async () => JSON.stringify(next.json) }
}
const created = (k) => ({ status: 201, json: { ok: true, issue: { url: 'https://example.invalid/issues/' + k } } })
const reply = (status, error) => ({ status, json: { error } })
const outbox = () => (existsSync(join(home, 'beta-reports')) ? readdirSync(join(home, 'beta-reports')).map((f) => JSON.parse(readFileSync(join(home, 'beta-reports', f), 'utf8'))) : [])
const reset = () => { posts.length = 0; answers = []; try { rmSync(join(home, 'beta-reports'), { recursive: true, force: true }) } catch (e) { /* none */ } }

try {
  console.log('kybernos-plugin — beta feedback tool (host)')
  const mod = await import(pathToFileURL(join(here, 'index.js')).href)
  const send = (a) => mod.kbFeedbackExecute(a)
  const bug = { kind: 'bug', title: 'Send does nothing', body: 'I press send, nothing leaves.' }

  // 1. The client sheet: the maintainers need the DSH and the Kybernos version, not only the OS.
  reset()
  const r1 = await send(bug)
  assert.equal(r1.ok, true, JSON.stringify(r1))
  assert.equal(posts[0].body.client.dsh, '0.2.0-rc.2', 'the DSH version must reach the report')
  assert.ok(typeof posts[0].body.client.os === 'string' && posts[0].body.client.os !== '')
  assert.equal(mod.kbFeedbackSuiteVersion('/x/VERSION', () => '1.0.0-beta.4\n'), '1.0.0-beta.4')
  assert.equal(mod.kbFeedbackSuiteVersion('/x/VERSION', () => 'garbage'), null, 'a value that is not a semver is never invented')
  assert.equal(mod.kbFeedbackSuiteVersion('/x/VERSION', () => { throw new Error('nope') }), null)
  ok('the report carries the DSH version, and the Kybernos version when the archive says it')

  // 2. The same report twice is one issue (an agent that retries, a double click).
  reset()
  const a1 = await send(bug)
  const a2 = await send(Object.assign({}, bug, { title: '  Send does nothing ' }))
  assert.equal(posts.length, 1, 'the second, identical report must not be posted again')
  assert.equal(a2.ok, true)
  assert.equal(a2.deduped, true)
  assert.equal(a2.issue_url, a1.issue_url)
  ok('sending the same report twice opens one issue and says it was already sent')

  // 3. A failed report is resent under its own id when the person sends it again: one record, one issue.
  reset()
  answers = [reply(503, 'github_indisponible')]
  const f1 = await send(bug)
  assert.equal(f1.ok, false)
  assert.equal(f1.error, 'github_indisponible')
  assert.ok(f1.mailto.startsWith('mailto:?subject='))
  const f2 = await send(bug)
  assert.equal(f2.ok, true, JSON.stringify(f2))
  assert.equal(posts[1].body.uuid, posts[0].body.uuid, 'the retry reuses the report id: the relay deduplicates on it')
  assert.deepEqual(outbox().map((o) => o.status), ['envoye'], 'no failed record is left behind')
  ok('after a failure, sending the same report again resends the same record and clears it')

  // 4. The promise « it will be sent again with the next report » is kept: other failed reports leave too.
  reset()
  answers = [reply(502, 'github_indisponible')]
  const old = await send({ kind: 'bug', title: 'First, lost', body: 'This one met a relay error.' })
  assert.equal(old.ok, false)
  const fresh = await send({ kind: 'feature', title: 'Second', body: 'A different report, sent later.' })
  assert.equal(fresh.ok, true)
  assert.deepEqual(posts.map((p) => p.body.title), ['First, lost', 'Second', 'First, lost'], 'the older failed report is posted again after a success')
  assert.equal(posts[2].body.uuid, posts[0].body.uuid)
  assert.deepEqual(outbox().map((o) => o.status).sort(), ['envoye', 'envoye'])
  ok('a failed report leaves by itself with the next successful one')

  // 4b. The relay keeps a failed report's id for `retry_after` seconds: asking sooner says so, without a round trip and without a second issue.
  reset()
  answers = [{ status: 503, json: { error: 'github_indisponible', retry_after: 120 } }]
  const c1 = await send(bug)
  assert.equal(c1.error, 'github_indisponible')
  assert.equal(c1.retry_after, 120)
  const c2 = await send(bug)
  assert.equal(posts.length, 1, 'no new POST while the relay holds the id')
  assert.equal(c2.ok, false)
  assert.equal(c2.error, 'en_cours')
  assert.ok(c2.retry_after > 0 && c2.retry_after <= 120)
  assert.match(mod.kbFeedbackToolText(c2), /wait about \d+ seconds/)
  await send({ kind: 'feature', title: 'Another one', body: 'Different text.' })
  assert.equal(posts.filter((q) => q.body.title === 'Send does nothing').length, 1, 'a report that is cooling down is not flushed either')
  ok('a report the relay still holds is not posted again before it lets go')

  // 5. A refusal that cannot be retried is not retried forever.
  reset()
  answers = [reply(400, 'invalid_title')]
  await send({ kind: 'bug', title: 'Bad', body: 'x' })
  await send({ kind: 'bug', title: 'Good', body: 'y' })
  assert.equal(posts.filter((p) => p.body.title === 'Bad').length, 1, 'a validation refusal stays as it is')
  ok('a report the relay refused for its content is not resent')

  // 6. A revoked or expired device token says « reconnect », not « refus_401 ».
  reset()
  answers = [reply(401, 'unauthorized')]
  const rv = await send(bug)
  assert.equal(rv.ok, false)
  assert.equal(rv.error, 'reconnexion_requise')
  assert.match(mod.kbFeedbackToolText(rv), /reconnect/i)
  assert.equal(mod.kbFeedbackVerdict(403, '{}').error, 'reconnexion_requise')
  ok('a refused token is reported as a session to reconnect')

  // 7. Every failure code the person can meet has a sentence of its own, and none promises what the tool does not do.
  for (const code of ['github_indisponible', 'base_indisponible', 'en_cours', 'trop_de_demandes', 'envoi_indisponible', 'reseau_indisponible', 'non_connecte', 'reconnexion_requise', 'refus_500']) {
    const text = mod.kbFeedbackToolText({ ok: false, error: code, report: { kind: 'bug', title: 't', body: 'b', uuid: 'u' }, mailto: 'mailto:?subject=t', outbox_file: '/x/u.json' })
    assert.ok(text.length > 0)
    assert.ok(/kept|saved/i.test(text), code + ': the person must be told the report is kept')
    assert.ok(text.includes('mailto:?subject=t'), code + ': the mail fallback is offered')
  }
  ok('every failure says what happened, that the report is kept, and offers the mail fallback')

  // 8. A long report is cut LOUDLY.
  reset()
  const long = await send({ kind: 'bug', title: 'T'.repeat(400), body: 'L'.repeat(20000) + ' END' })
  assert.equal(long.ok, true)
  assert.ok(posts[0].body.body.length <= 8000, 'the relay body stays within the limit')
  assert.match(posts[0].body.body.slice(-80), /cut|truncated/i, 'the end of the report says it was cut')
  assert.equal(posts[0].body.title.length, 160)
  assert.equal(long.truncated, true)
  ok('a report longer than the limit is cut with a visible marker, and the answer says so')

  // 9. The raw text of the report is private to the person who wrote it.
  reset()
  const p = await send(bug)
  assert.equal(statSync(p.outbox_file).mode & 0o077, 0, 'the outbox file must not be readable by others')
  assert.equal(statSync(join(home, 'beta-reports')).mode & 0o077, 0, 'nor its folder')
  ok('the local outbox is private (0600 file, 0700 folder)')

  // 10. The skill the « Send feedback » button opens exists in the plugin: a fresh install has no other copy.
  const fresh2 = mkdtempSync(join(tmpdir(), 'kb-feedback-skill-'))
  assert.equal(mod.kbFeedbackEnsureSkill(fresh2), true, 'the plugin must ship skills/signaler-retour/SKILL.md')
  const skill = readFileSync(join(fresh2, 'skills', 'signaler-retour', 'SKILL.md'), 'utf8')
  assert.match(skill, /^---\nname: signaler-retour\n/)
  assert.ok(skill.includes('kybernos_signaler_retour'), 'the skill calls the tool of this plugin')
  assert.ok(!/\/Users\/[a-z]/i.test(skill), 'no personal path')
  ok('the plugin ships the signaler-retour skill that the button opens')

  // 10b. A skill the person wrote under that name is theirs: the plugin never overwrites it (it used to, at every start).
  const mine = mkdtempSync(join(tmpdir(), 'kb-feedback-own-'))
  mkdirSync(join(mine, 'skills', 'signaler-retour'), { recursive: true })
  const own = '---\nname: signaler-retour\ndescription: my own way to report\n---\nMy own instructions, in my words.\n'
  writeFileSync(join(mine, 'skills', 'signaler-retour', 'SKILL.md'), own)
  assert.equal(mod.kbFeedbackEnsureSkill(mine), true, 'the skill is there, the person\'s own')
  assert.equal(readFileSync(join(mine, 'skills', 'signaler-retour', 'SKILL.md'), 'utf8'), own, 'the person\'s own skill is left exactly as it was')
  assert.equal(mod.kbFeedbackEnsureSkill(fresh2), true, 'and a second start on our own copy changes nothing')
  ok('a signaler-retour skill the person wrote or edited is never overwritten')

  // 11. The nominal path still works as before.
  reset()
  const nominal = await send({ kind: 'feature', title: 'Dark mode', body: 'At night.', reporter: 'a@b.test', errors: ['E1'] })
  assert.equal(nominal.ok, true)
  assert.equal(posts[0].auth, 'Bearer ' + TOKEN)
  assert.equal(posts[0].url, 'http://relay.invalid/v1/feedback')
  assert.deepEqual(posts[0].body.evidence.errors, ['E1'])
  assert.match(mod.kbFeedbackToolText(nominal), /example\.invalid\/issues/)
  ok('the nominal send is unchanged')

  // 12. The fallback (mail link, « full report to copy ») goes around the relay, so it masks secrets itself, by the server's rules (R-30).
  {
    const secrets = ['sk-proj-ABCDEFGHIJKLMNOP1234', 'hunter2hunter2', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'AKIAABCDEFGHIJKLMNOP', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop', 'supersecretpw', 'Zm9vYmFyYmF6cXV4']
    const dirty = [
      'It fails when I use token=' + secrets[0] + ' and password: ' + secrets[1] + '.',
      'My key ' + secrets[2] + ' and ' + secrets[3] + ' and jwt ' + secrets[4] + '.',
      'DATABASE_URL=postgres://app:' + secrets[5] + '@db.internal/prod',
      'Authorization: Bearer ' + secrets[6],
      '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----',
      'But "token: expired" and the basic setup are only words.',
    ].join('\n')
    reset()
    answers = [reply(503, 'github_indisponible')]
    const down = await send({ kind: 'bug', title: 'Leak check token=' + secrets[0], body: dirty })
    assert.equal(down.ok, false)
    const shown = mod.kbFeedbackToolText(down)
    const mailBody = decodeURIComponent(String(down.mailto))
    for (const secret of secrets) {
      assert.equal(shown.includes(secret), false, 'the text to copy leaks ' + secret.slice(0, 8))
      assert.equal(mailBody.includes(secret), false, 'the mail link leaks ' + secret.slice(0, 8))
    }
    assert.equal(mailBody.includes('MIIEvQIBADANBgkqhkiG9w0BAQEFAASC'), false, 'a private key block is cut')
    assert.match(shown, /\[REDACTED/, 'the person can see something was masked')
    assert.match(shown, /token: expired/, 'a word about a secret is kept so the report stays readable')
    assert.match(shown, /basic setup/)
    assert.equal(JSON.stringify(posts[0].body).includes(secrets[0]), true, 'the relay request is untouched: the server masks it (one rule, two places)')
    assert.equal(JSON.stringify(outbox()).includes(secrets[0]), true, 'the local copy keeps what the person wrote (0600, on their own machine)')
    ok('the mail link and the text to copy mask secrets like the server does; words about secrets stay; the relay request and the local copy are untouched')

    assert.equal(mod.kbFeedbackMask('sk-proj-ABC​DEFGHIJ12345').includes('ABCDEFGHIJ12345'), false, 'a secret with a zero-width character inside is found')
    assert.equal(mod.kbFeedbackMask(42), '', 'anything that is not text is empty')
    const t0 = Date.now()
    const hostile = ['password: ' + 'x '.repeat(30000), 'a'.repeat(60000), ('token=' + '\\"'.repeat(20000)), 'bearer ' + 'a'.repeat(30000), 'https://' + 'u'.repeat(30000) + ':'].join('\n')
    mod.kbFeedbackMask(hostile)
    assert.ok(Date.now() - t0 < 1500, 'a hostile 150 KB text costs ' + (Date.now() - t0) + ' ms')
    ok('invisible characters do not hide a secret, a non-text is empty, and a hostile text costs milliseconds')
  }

  console.log('\n' + n + ' checks, all green')
} finally {
  globalThis.fetch = realFetch
  try { rmSync(home, { recursive: true, force: true }) } catch (e) { /* busy */ }
}
