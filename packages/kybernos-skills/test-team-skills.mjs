#!/usr/bin/env node
/** Team skills, the disk half: what may leave this machine in a proposal, and what may be written when a Team skill is installed.
 *
 *  Pure rules (team-skills.mjs): the version every end must compute the same way (checked against an independent Python
 *  implementation, see docs/dev/team-skills-contract.md), the validation matrix, the secret scan that never returns the secret.
 *  Host (index.js): `packSkill` and `installTeamSkill` on a throw-away HOME, and the two POST routes through `apply()` on a fake
 *  context. Nothing here touches the user's real ~/.dsh or ~/.agents.
 *
 *  Usage: node packages/kybernos-skills/test-team-skills.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { skillVersion, validateTeamSkill, frontmatterOfText, scriptFiles, findSecret, TEAM_SKILL_LIMITS } from './team-skills.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const skillMd = (name, description = 'A test skill', extra = '') => '---\nname: ' + name + '\ndescription: "' + description + '"\n---\n\n# ' + name + '\n' + extra
const files = (name, more = []) => [{ path: 'SKILL.md', content: skillMd(name) }, ...more]

// ── 1. the version ──
{
  const vector = [{ path: 'SKILL.md', content: '---\nname: demo\ndescription: "A demo"\n---\n\n# demo\n' }, { path: 'notes/a.md', content: 'é\n' }]
  // Computed by an independent implementation (Python hashlib) of the contract's canonical listing.
  assert.equal(skillVersion(vector), 'ebeb1967f2fba1a8f440ee917f7a12cd4b1a2089dab2615ea31d319cc63ef4cb')
  ok('the version matches the independent implementation of the contract (path, NUL, byte length, NUL, bytes)')
  assert.equal(skillVersion([...vector].reverse()), skillVersion(vector))
  assert.notEqual(skillVersion([vector[0], { path: 'notes/a.md', content: 'e\n' }]), skillVersion(vector))
  assert.notEqual(skillVersion([{ path: 'a', content: 'bc' }]), skillVersion([{ path: 'ab', content: 'c' }]))
  assert.notEqual(skillVersion([{ path: 'a', content: '1' }, { path: 'b', content: '' }]), skillVersion([{ path: 'a', content: '' }, { path: 'b', content: '1' }]))
  ok('the order of the files does not matter; one changed byte, or a file boundary moved, changes it')
}

// ── 2. the validation matrix ──
{
  const good = validateTeamSkill({ name: 'release-notes', files: files('release-notes', [{ path: 'examples/2026-09.md', content: 'x' }]) })
  assert.equal(good.ok, true)
  assert.equal(good.count, 2)
  assert.equal(good.description, 'A test skill')
  assert.match(good.version, /^[0-9a-f]{64}$/)
  const reason = (skill) => { const r = validateTeamSkill(skill); return r.ok ? 'ok' : r.reason }
  for (const name of ['', 'Release', 'with space', 'a--b', '-a', 'a-', 'x'.repeat(65), 'é', 12, null]) assert.equal(reason({ name, files: files('x') }), 'name', String(name))
  ok('the name follows DSH\'s rule and is at most 64 characters')

  assert.equal(reason({ name: 'a', files: [] }), 'no_skill_md')
  assert.equal(reason({ name: 'a', files: [{ path: 'README.md', content: 'x' }] }), 'no_skill_md')
  assert.equal(reason({ name: 'a', files: Array.from({ length: 51 }, (_, i) => ({ path: 'f' + i + '.md', content: '' })) }), 'too_many_files')
  assert.equal(reason({ name: 'a', files: [{ path: 'SKILL.md', content: skillMd('other') }] }), 'frontmatter')
  assert.equal(reason({ name: 'a', files: [{ path: 'SKILL.md', content: '---\nname: a\n---\n' }] }), 'frontmatter')
  assert.equal(reason({ name: 'a', files: [{ path: 'SKILL.md', content: skillMd('a', 'd'.repeat(1025)) }] }), 'frontmatter')
  assert.equal(reason({ name: 'a', files: [{ path: 'SKILL.md', content: 'no frontmatter' }] }), 'frontmatter')
  ok('a skill needs its SKILL.md, whose frontmatter names it and describes it (1 024 characters at most), and at most 50 files')

  for (const path of ['../x', '/abs', 'a//b', 'a\\b', '.hidden', 'a/.git/x', 'a/../b', '', 'x'.repeat(201), 'a b', 'é.md', 'a/', './a']) {
    assert.equal(reason({ name: 'a', files: [...files('a'), { path, content: 'x' }] }), 'bad_path', JSON.stringify(path))
  }
  assert.equal(reason({ name: 'a', files: [...files('a'), { path: 'SKILL.md', content: skillMd('a') }] }), 'bad_path', 'a path twice')
  assert.equal(reason({ name: 'a', files: [...files('a'), { path: 'x.md', content: 42 }] }), 'bad_path')
  assert.equal(reason({ name: 'a', files: [...files('a'), null] }), 'bad_path')
  assert.equal(reason({ name: 'a', files: [...files('a'), { path: '_ok/a.b-c_d.md', content: 'x' }] }), 'ok')
  ok('a path is relative, ASCII, with no dot segment, no hidden segment, no duplicate')

  assert.deepEqual(validateTeamSkill({ name: 'a', files: [...files('a'), { path: 'img.bin', content: 'a\0b' }] }), { ok: false, reason: 'binary', file: 'img.bin' })
  assert.deepEqual(validateTeamSkill({ name: 'a', files: [...files('a'), { path: 'big.md', content: 'x'.repeat(256 * 1024 + 1) }] }), { ok: false, reason: 'file_too_large', file: 'big.md' })
  assert.equal(reason({ name: 'a', files: [...files('a'), { path: 'big.md', content: 'x'.repeat(256 * 1024) }] }), 'ok', 'exactly the cap is allowed')
  const five = Array.from({ length: 5 }, (_, i) => ({ path: 'p' + i + '.md', content: 'x'.repeat(250 * 1024) }))
  assert.equal(reason({ name: 'a', files: [...files('a'), ...five] }), 'too_large')
  assert.equal(reason({ name: 'a', files: [...files('a'), { path: 'wide.md', content: 'é'.repeat(130 * 1024) }] }), 'file_too_large', 'the cap counts bytes, not characters')
  ok('binary content, a file over 256 KiB (counted in bytes) and a skill over 1 MiB are refused, the caps themselves are allowed')

  assert.equal(TEAM_SKILL_LIMITS.files, 50)
  assert.equal(TEAM_SKILL_LIMITS.totalBytes, 1048576)
}

// ── 3. the secret scan ──
{
  const aws = 'AKIA' + 'ABCDEFGHIJKLMNOP'
  const hits = {
    aws_access_key: aws, github_pat: 'ghp_' + 'a'.repeat(36), slack_token: 'xoxb-' + '1234567890-abc', openai_key: 'sk-' + 'A'.repeat(24),
    anthropic_key: 'sk-ant-' + 'a1_'.repeat(8), private_key_block: '-----BEGIN RSA PRIVATE KEY-----', generic_bearer: 'Authorization: Bearer ' + 'abcdefghijklmnopqrstuvwxyz',
    google_api_key: 'AIza' + 'a'.repeat(35), jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk'
  }
  for (const [kind, text] of Object.entries(hits)) {
    const f = [{ path: 'SKILL.md', content: skillMd('a') }, { path: 'scripts/run.sh', content: 'echo ok\nexport X="' + text + '"\n' }]
    const r = validateTeamSkill({ name: 'a', files: f })
    assert.deepEqual([r.ok, r.reason, r.file, r.line], [false, 'scan_rejected', 'scripts/run.sh', 2], kind)
    assert.equal(JSON.stringify(r).includes(text), false, kind + ': the secret is never returned')
    assert.equal(findSecret(f).kind, kind)
  }
  assert.equal(findSecret(files('a')), null)
  assert.equal(findSecret([{ path: 'x.md', content: 'Bearer token' }]), null, 'the word alone is not a secret')
  ok('each secret pattern of the server is caught with its file and line, and the secret itself is never in the answer')
}

// ── 4. small readers ──
{
  assert.deepEqual(frontmatterOfText('---\nname: a\ndescription: "x \\"q\\" y\\nz"\nwhenToUse: \'it\'\'s\'\nplain: v\n---\nbody: not me'),
    { name: 'a', description: 'x "q" y\nz', whenToUse: "it's", plain: 'v' })
  assert.deepEqual(frontmatterOfText('no frontmatter'), {})
  assert.deepEqual(scriptFiles([{ path: 'SKILL.md', content: '' }, { path: 'a.mjs', content: '' }, { path: 'scripts/x', content: '' }, { path: 'bin/tool', content: '#!/bin/sh\n' }, { path: 'notes.md', content: 'x' }]), ['a.mjs', 'scripts/x', 'bin/tool'])
  ok('the frontmatter is read the way DSH reads it; scripts are spotted by extension, folder or shebang')
}

// ── 5. the host, on a throw-away HOME ──
const home = mkdtempSync(join(tmpdir(), 'kybernos-teamskills-'))
const savedEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, DSH_HOME: process.env.DSH_HOME }
process.env.HOME = home
process.env.USERPROFILE = home
process.env.DSH_HOME = join(home, '.dsh')
const dshSkills = join(home, '.dsh', 'skills')
const agentsSkills = join(home, '.agents', 'skills')
const outside = mkdtempSync(join(tmpdir(), 'kybernos-teamskills-outside-'))
try {
  const mod = await import('./index.js')
  const config = { home }
  const ctx = { get: () => undefined }

  const seedSkill = (root, name, entries) => {
    for (const [rel, content] of Object.entries(entries)) {
      mkdirSync(join(root, name, rel.split('/').slice(0, -1).join('/')), { recursive: true })
      writeFileSync(join(root, name, rel), content)
    }
  }
  seedSkill(dshSkills, 'release-notes', {
    'SKILL.md': skillMd('release-notes', 'Drafts release notes'),
    'style-guide.md': 'Past tense, one line each.\n',
    'examples/2026-09.md': 'é accents travel too\n',
    'scripts/group.mjs': 'export const g = 1\n',
    '.DS_Store': 'junk', '.env': 'TOKEN=should-never-leave',
    'node_modules/dep/index.js': 'x'
  })
  symlinkSync(join(outside), join(dshSkills, 'release-notes', 'link-out'))

  // 5a. pack
  const packed = mod.packSkill({ root: dshSkills, name: 'release-notes', config })
  assert.equal(packed.ok, true, JSON.stringify(packed))
  assert.deepEqual(packed.files.map((f) => f.path), ['SKILL.md', 'examples/2026-09.md', 'scripts/group.mjs', 'style-guide.md'])
  assert.equal(packed.files.find((f) => f.path === 'examples/2026-09.md').content, 'é accents travel too\n')
  assert.equal(packed.description, 'Drafts release notes')
  assert.equal(packed.version, skillVersion(packed.files))
  assert.deepEqual(packed.scripts, ['scripts/group.mjs'])
  assert.equal(packed.count, 4)
  ok('pack returns the text files in a fixed order, without hidden files, node_modules or a symlink, and the version of what it returns')

  const refusal = (r) => [r.ok, r.error, r.reason]
  assert.deepEqual(refusal(mod.packSkill({ root: dshSkills, name: 'Not-A-Name', config })), [false, 'invalid_skill', 'name'])
  assert.deepEqual(refusal(mod.packSkill({ root: dshSkills, name: 'nope', config })), [false, 'skill_not_found', undefined])
  for (const root of [outside, join(home, 'elsewhere'), '', undefined, dshSkills + '/../skills', '/']) assert.equal(mod.packSkill({ root, name: 'release-notes', config }).error, 'root_not_allowed', String(root))
  ok('pack refuses a bad name, a skill that is not there, and any root that is not one of the two writable roots')

  seedSkill(dshSkills, 'off', { 'SKILL.md.disabled': skillMd('off') })
  assert.equal(mod.packSkill({ root: dshSkills, name: 'off', config }).error, 'skill_disabled')
  mkdirSync(join(outside, 'real-skill'), { recursive: true })
  writeFileSync(join(outside, 'real-skill', 'SKILL.md'), skillMd('escaper'))
  symlinkSync(join(outside, 'real-skill'), join(dshSkills, 'escaper'))
  assert.equal(mod.packSkill({ root: dshSkills, name: 'escaper', config }).error, 'root_not_allowed', 'a folder that is a symlink leaving the root is never packed')
  ok('pack refuses a disabled skill and a skill folder that leaves its root through a symlink')

  seedSkill(dshSkills, 'with-image', { 'SKILL.md': skillMd('with-image') })
  writeFileSync(join(dshSkills, 'with-image', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00]))
  assert.deepEqual([mod.packSkill({ root: dshSkills, name: 'with-image', config }).reason, mod.packSkill({ root: dshSkills, name: 'with-image', config }).file], ['binary', 'logo.png'])
  seedSkill(dshSkills, 'latin1', { 'SKILL.md': skillMd('latin1') })
  writeFileSync(join(dshSkills, 'latin1', 'old.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9]))
  assert.equal(mod.packSkill({ root: dshSkills, name: 'latin1', config }).reason, 'binary', 'bytes that are not UTF-8 are not text')
  seedSkill(dshSkills, 'huge', { 'SKILL.md': skillMd('huge'), 'big.md': 'x'.repeat(256 * 1024 + 1) })
  assert.deepEqual([mod.packSkill({ root: dshSkills, name: 'huge', config }).reason, mod.packSkill({ root: dshSkills, name: 'huge', config }).file], ['file_too_large', 'big.md'])
  seedSkill(dshSkills, 'many', { 'SKILL.md': skillMd('many'), ...Object.fromEntries(Array.from({ length: 50 }, (_, i) => ['f' + i + '.md', 'x'])) })
  assert.equal(mod.packSkill({ root: dshSkills, name: 'many', config }).reason, 'too_many_files')
  const secret = 'ghp_' + 'Z'.repeat(36)
  seedSkill(dshSkills, 'leaky', { 'SKILL.md': skillMd('leaky'), 'scripts/deploy.sh': 'echo hi\nTOKEN=' + secret + '\n' })
  const leaky = mod.packSkill({ root: dshSkills, name: 'leaky', config })
  assert.deepEqual([leaky.ok, leaky.error, leaky.reason, leaky.file, leaky.line], [false, 'scan_rejected', 'scan_rejected', 'scripts/deploy.sh', 2])
  assert.equal(JSON.stringify(leaky).includes(secret), false)
  ok('pack names the file that cannot travel (picture, non-UTF-8, too big, too many, secret with its line) and never echoes the secret')

  // 5b. install
  const roundTrip = mod.installTeamSkill({ ctx, root: agentsSkills, name: 'release-notes', version: packed.version, files: packed.files, config })
  const installed = await roundTrip
  assert.equal(installed.ok, true, JSON.stringify(installed))
  assert.equal(installed.files, 4)
  assert.equal(installed.skill.name, 'release-notes')
  assert.equal(installed.skill.description, 'Drafts release notes')
  for (const f of packed.files) assert.equal(readFileSync(join(agentsSkills, 'release-notes', f.path), 'utf8'), f.content, f.path)
  assert.deepEqual(readdirSync(agentsSkills).filter((n) => n.startsWith('.')), [], 'no staging folder is left')
  assert.equal(mod.packSkill({ root: agentsSkills, name: 'release-notes', config }).version, packed.version, 'what was installed packs back to the same version')
  ok('install writes every file byte for byte, leaves no staging folder, and the installed skill packs back to the same version')

  const again = await mod.installTeamSkill({ ctx, root: agentsSkills, name: 'release-notes', version: packed.version, files: packed.files, config })
  assert.deepEqual([again.ok, again.error], [false, 'exists'])
  writeFileSync(join(agentsSkills, 'release-notes', 'style-guide.md'), 'edited by hand\n')
  const kept = await mod.installTeamSkill({ ctx, root: agentsSkills, name: 'release-notes', version: packed.version, files: packed.files, config })
  assert.equal(kept.error, 'exists')
  assert.equal(readFileSync(join(agentsSkills, 'release-notes', 'style-guide.md'), 'utf8'), 'edited by hand\n', 'an existing skill is never overwritten')
  ok('install never overwrites: a skill already there, even edited by hand, is left exactly as it is')

  const before = readdirSync(agentsSkills).sort()
  const tampered = packed.files.map((f) => (f.path === 'SKILL.md' ? { ...f, content: f.content + 'extra\n' } : f))
  assert.equal((await mod.installTeamSkill({ ctx, root: agentsSkills, name: 'tampered', version: packed.version, files: tampered, config })).error, 'invalid_skill', 'a name that is not the skill\'s')
  const sameName = files('tampered-skill')
  const v = skillVersion(sameName)
  assert.equal((await mod.installTeamSkill({ ctx, root: agentsSkills, name: 'tampered-skill', version: v.replace(/.$/, (c) => (c === '0' ? '1' : '0')), files: sameName, config })).error, 'version_mismatch')
  for (const version of [undefined, null, '', 42, 'abc']) assert.equal((await mod.installTeamSkill({ ctx, root: agentsSkills, name: 'tampered-skill', version, files: sameName, config })).error, 'version_mismatch', String(version))
  assert.deepEqual(readdirSync(agentsSkills).sort(), before, 'nothing was written')
  ok('install refuses files that do not hash to the announced version (or no version at all) before writing anything')

  const hostile = [{ path: 'SKILL.md', content: skillMd('hostile') }, { path: '../evil.md', content: 'x' }]
  const h1 = await mod.installTeamSkill({ ctx, root: agentsSkills, name: 'hostile', version: skillVersion(hostile), files: hostile, config })
  assert.deepEqual([h1.ok, h1.error, h1.reason], [false, 'invalid_skill', 'bad_path'])
  assert.equal(existsSync(join(agentsSkills, 'evil.md')), false)
  const withSecret = [{ path: 'SKILL.md', content: skillMd('secretive') }, { path: 'a.md', content: 'key ' + secret }]
  const h2 = await mod.installTeamSkill({ ctx, root: agentsSkills, name: 'secretive', version: skillVersion(withSecret), files: withSecret, config })
  assert.equal(h2.error, 'scan_rejected')
  for (const root of [outside, join(home, '.dsh'), '/']) assert.equal((await mod.installTeamSkill({ ctx, root, name: 'x', version: v, files: files('x'), config })).error, 'root_not_allowed', root)
  assert.deepEqual(readdirSync(agentsSkills).sort(), before)
  ok('install refuses a path that climbs out, a secret, and a root that is not a writable root')

  const def = await mod.installTeamSkill({ ctx, name: 'tampered-skill', version: v, files: sameName, config })
  assert.equal(def.ok, true, JSON.stringify(def))
  assert.equal(existsSync(join(dshSkills, 'tampered-skill', 'SKILL.md')), true)
  ok('without a root, install goes to the DSH skills folder')

  if (process.getuid !== undefined && process.getuid() !== 0) {
    mkdirSync(agentsSkills, { recursive: true })
    chmodSync(agentsSkills, 0o500)
    try {
      const ro = await mod.installTeamSkill({ ctx, root: agentsSkills, name: 'cannot-write', version: skillVersion(files('cannot-write')), files: files('cannot-write'), config })
      assert.deepEqual([ro.ok, ro.error], [false, 'write_failed'])
    } finally { chmodSync(agentsSkills, 0o700) }
    assert.deepEqual(readdirSync(agentsSkills).filter((n) => n.startsWith('.kb-team-')), [])
    ok('a folder that cannot be written is reported as write_failed and leaves nothing behind')
  }

  // 5c. the two POST routes, through apply() on a fake context (the guard comes first, the disk after)
  const routes = {}
  mod.apply({ inject (deps, fn) { fn({ get: (n) => (n === 'webServer' ? { register: (r) => { routes[r.path] = r.handler } } : {}), effect: (f) => f() }) } })
  const PACK = '/kybernos-skills/team/pack'
  const INSTALL = '/kybernos-skills/team/install'
  assert.equal(typeof routes[PACK], 'function')
  assert.equal(typeof routes[INSTALL], 'function')
  const request = (method, headers, body) => ({ method, headers: headers || {}, socket: { localPort: 3080 }, async * [Symbol.asyncIterator] () { if (body !== undefined) yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) } })
  const response = () => { const r = { code: null, body: null, writeHead (c) { r.code = c }, end (s) { try { r.body = JSON.parse(s) } catch (e) { r.body = s } } }; return r }
  const call = async (path, method, headers, body) => { const res = response(); await routes[path](request(method, headers, body), res); return res }
  const here = { origin: 'http://127.0.0.1:3080' }

  for (const path of [PACK, INSTALL]) {
    assert.equal((await call(path, 'GET', here)).code, 405, path + ' GET')
    assert.equal((await call(path, 'POST', {}, { name: 'x' })).code, 403, path + ' without an origin')
    assert.equal((await call(path, 'POST', { origin: 'https://evil.example' }, { name: 'x' })).code, 403, path + ' foreign origin')
  }
  assert.equal(readdirSync(dshSkills).includes('tampered-skill'), true)
  const viaRoute = await call(PACK, 'POST', here, { root: dshSkills, name: 'release-notes' })
  assert.equal(viaRoute.code, 200)
  assert.equal(viaRoute.body.ok, true)
  assert.equal(viaRoute.body.version, packed.version)
  const installRoute = await call(INSTALL, 'POST', here, { root: agentsSkills, name: 'via-route', version: skillVersion(files('via-route')), files: files('via-route') })
  assert.equal(installRoute.body.ok, true, JSON.stringify(installRoute.body))
  assert.equal(existsSync(join(agentsSkills, 'via-route', 'SKILL.md')), true)
  assert.equal((await call(INSTALL, 'POST', here, 'not json')).body.ok, false)
  // a body of about 1 MiB of files passes the route's cap (the default 64 KiB would have refused it)
  const big = [{ path: 'SKILL.md', content: skillMd('big-one') }, ...Array.from({ length: 4 }, (_, i) => ({ path: 'p' + i + '.md', content: 'y'.repeat(240 * 1024) }))]
  const bigRes = await call(INSTALL, 'POST', here, { root: agentsSkills, name: 'big-one', version: skillVersion(big), files: big })
  assert.equal(bigRes.body.ok, true, JSON.stringify(bigRes.body).slice(0, 200))
  const over = [{ path: 'SKILL.md', content: skillMd('too-big') }, { path: 'x.md', content: 'z'.repeat(5 * 1024 * 1024) }]
  const overRes = await call(INSTALL, 'POST', here, { root: agentsSkills, name: 'too-big', version: skillVersion(over), files: over })
  assert.equal(overRes.body.ok, false)
  assert.equal(existsSync(join(agentsSkills, 'too-big')), false)
  ok('both routes: GET is 405, a POST without an origin from this machine is 403, a good POST works, and the install body may reach 4 MiB but no more')

  console.log('\n' + pass + ' verifications OK')
} finally {
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  try { chmodSync(agentsSkills, 0o700) } catch (e) { /* not created */ }
  rmSync(home, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
}
