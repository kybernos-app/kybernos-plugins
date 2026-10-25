#!/usr/bin/env node
/** The host half of the skill panel: read a skill's real SKILL.md, open it, copy it, delete it, and preview a remote one.
 *
 *  Everything runs on a throw-away home (a DSH home with the user's skills folder, one read-only project folder, and a decoy file
 *  outside both) and a fake DSH registry; the two GitHub hosts of the preview are a stub of `fetch`. Nothing reaches the network,
 *  the user's home or a shell.
 *
 *  Usage: node packages/kybernos-skills/test-skill-routes.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

// The POST routes need the signed session as well as the Origin (L3-17): the Skills page's own request carries both.
sessionSource.secret = () => SESSION_SECRET

const base = mkdtempSync(join(tmpdir(), 'kb-skill-routes-'))
const home = join(base, 'home')
const dsh = join(home, '.dsh')
const userRoot = join(dsh, 'skills')
const projRoot = join(base, 'proj', '.dsh', 'skills')
const outside = join(base, 'outside.txt')
process.env.HOME = home
process.env.DSH_HOME = dsh
mkdirSync(userRoot, { recursive: true })
mkdirSync(projRoot, { recursive: true })
writeFileSync(outside, 'NOT A SKILL FILE')

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const put = (path, text) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text) }
const skillMd = (name, extra) => '---\nname: ' + name + '\ndescription: "About ' + name + '"\n---\n\n# ' + name + '\nUse it when asked.\n' + (extra || '')
put(join(userRoot, 'alpha', 'SKILL.md'), skillMd('alpha'))
put(join(userRoot, 'alpha', 'scripts', 'run.sh'), '#!/bin/sh\necho hi\n')
put(join(userRoot, 'alpha', '.kybernos-team.json'), '{"teamId":"t"}')
put(join(userRoot, 'alpha', '.git', 'HEAD'), 'ref: refs/heads/main')
symlinkSync(outside, join(userRoot, 'alpha', 'leak.txt'))
put(join(userRoot, 'beta-off', 'SKILL.md.disabled'), skillMd('beta-off'))
put(join(projRoot, 'gamma', 'SKILL.md'), skillMd('gamma'))
symlinkSync(join(userRoot, 'alpha'), join(userRoot, 'alias'))

let invalidated = 0
const registry = {
  async snapshot () {
    const skills = []
    for (const [root, source] of [[userRoot, 'user-dsh'], [projRoot, 'project-dsh']]) {
      for (const n of readdirSync(root)) {
        const file = join(root, n, 'SKILL.md')
        if (existsSync(file)) skills.push({ name: n, path: file, source, description: 'd' })
      }
    }
    return { complete: true, skills }
  },
  invalidateCache () { invalidated += 1 }
}
const ctx = { get: (n) => (n === 'skills' ? registry : undefined), effect: (f) => f() }
const config = { home, dsh }

try {
  const mod = await import('./index.js')
  console.log('kybernos-skills — the skill panel, host half')

  // 1. the catalogue says where each skill lives
  const cat = await mod.catalogueOf(ctx, config)
  const alpha = cat.skills.find((s) => s.name === 'alpha')
  assert.equal(alpha.folder, join(userRoot, 'alpha'))
  assert.equal(alpha.file, join(userRoot, 'alpha', 'SKILL.md'))
  assert.equal(cat.skills.find((s) => s.name === 'beta-off').folder, join(userRoot, 'beta-off'))
  assert.equal(cat.skills.find((s) => s.name === 'gamma').writable, false)
  ok('every catalogue entry carries its folder and its file (active, disabled and read-only ones)')

  // 2. read
  const r = await mod.readSkill({ ctx, root: userRoot, name: 'alpha', config })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.text, skillMd('alpha'), 'the whole file, frontmatter included')
  assert.equal(r.folder, join(userRoot, 'alpha'))
  assert.equal(r.active, true)
  assert.ok(r.files >= 3, 'the files of the folder are counted: ' + r.files)
  assert.deepEqual(r.actions, { reveal: true, edit: true, duplicate: true, delete: true })
  ok('read: the real SKILL.md with its frontmatter, the folder, a file count and the four actions')

  const rg = await mod.readSkill({ ctx, root: projRoot, name: 'gamma', config })
  assert.equal(rg.ok, true)
  assert.deepEqual(rg.actions, { reveal: true, edit: true, duplicate: true, delete: false })
  ok('read: a skill of a read-only folder reads fine, and cannot be deleted')

  const rb = await mod.readSkill({ ctx, root: userRoot, name: 'beta-off', config })
  assert.equal(rb.ok, true)
  assert.equal(rb.active, false)
  assert.ok(rb.text.includes('name: beta-off'))
  ok('read: a disabled skill is read from its .disabled marker')

  for (const [args, code] of [
    [{ root: userRoot, name: '../etc' }, 'bad_name'],
    [{ root: userRoot, name: 'Not A Name' }, 'bad_name'],
    [{ root: '', name: 'alpha' }, 'bad_root'],
    [{ root: userRoot, name: 'nope' }, 'not_found'],
    [{ root: '/etc', name: 'alpha' }, 'not_found'],
    [{ root: join(userRoot, '..'), name: 'skills' }, 'not_found']
  ]) {
    const x = await mod.readSkill({ ctx, config, ...args })
    assert.deepEqual([x.ok, x.error], [false, code], JSON.stringify(args))
  }
  ok('read: only what the catalogue lists can be named (a made-up name, a root it does not list, a traversal)')

  const remote = await mod.readSkill({ ctx, root: userRoot, name: 'alpha', config, req: { headers: { host: 'dsh.example.com' } } })
  assert.deepEqual(remote.actions, { reveal: false, edit: false, duplicate: true, delete: true })
  const lan = await mod.readSkill({ ctx, root: userRoot, name: 'alpha', config, req: { headers: { host: '127.0.0.1:3080' } } })
  assert.equal(lan.actions.reveal, true)
  ok('read: a host reached through another address offers nothing that opens a window on its own machine')

  // 3. reveal / edit
  const seen = []
  const opener = async (path, o) => { seen.push([path, o.edit]); return true }
  const rf = await mod.revealSkill({ ctx, root: userRoot, name: 'alpha', target: 'folder', config, opener })
  const re = await mod.revealSkill({ ctx, root: userRoot, name: 'alpha', target: 'file', config, opener })
  assert.deepEqual([rf.ok, re.ok], [true, true])
  assert.deepEqual(seen, [[join(userRoot, 'alpha'), false], [join(userRoot, 'alpha', 'SKILL.md'), true]])
  assert.equal((await mod.revealSkill({ ctx, root: userRoot, name: 'alpha', target: '/etc/passwd', config, opener })).error, 'bad_target')
  assert.equal((await mod.revealSkill({ ctx, root: userRoot, name: 'nope', target: 'folder', config, opener })).error, 'not_found')
  assert.equal((await mod.revealSkill({ ctx, root: userRoot, name: 'alpha', target: 'folder', config, opener, req: { headers: { host: 'dsh.example.com' } } })).error, 'not_local')
  assert.equal((await mod.revealSkill({ ctx, root: userRoot, name: 'alpha', target: 'folder', config, opener: async () => false })).error, 'opener_unavailable')
  assert.equal(seen.length, 2, 'a refused request opens nothing')
  ok('reveal: opens the catalogue\'s own folder or SKILL.md, nothing the caller names, nothing from another address')

  const spawned = []
  const fakeSpawn = (cmd, args) => { spawned.push([cmd, args]); const h = {}; return { once: (e, f) => { h[e] = f; if (e === 'exit') setImmediate(() => f(0)) }, unref () {} } }
  assert.equal(await mod.openLocal('/s/a', { platform: 'darwin', spawnFn: fakeSpawn }), true)
  assert.equal(await mod.openLocal('/s/a/SKILL.md', { platform: 'darwin', edit: true, spawnFn: fakeSpawn }), true)
  assert.equal(await mod.openLocal('/s/a', { platform: 'linux', env: {}, spawnFn: fakeSpawn }), false, 'no display, no opener')
  assert.equal(await mod.openLocal('/s/a', { platform: 'linux', env: { DISPLAY: ':0' }, spawnFn: fakeSpawn }), true)
  assert.equal(await mod.openLocal('/s/a', { platform: 'win32', spawnFn: fakeSpawn }), true)
  assert.deepEqual(spawned, [['open', ['/s/a']], ['open', ['-t', '/s/a/SKILL.md']], ['xdg-open', ['/s/a']], ['explorer', ['/s/a']]])
  ok('reveal: the opener is one command with the path as ONE argument (open, open -t, xdg-open, explorer), never a shell')

  // 4. duplicate
  const before = invalidated
  const d1 = await mod.duplicateSkill({ ctx, root: userRoot, name: 'alpha', config })
  assert.equal(d1.ok, true, JSON.stringify(d1))
  assert.equal(d1.name, 'alpha-copy')
  const copy = join(userRoot, 'alpha-copy')
  assert.ok(readFileSync(join(copy, 'SKILL.md'), 'utf8').includes('name: alpha-copy'), 'the copy carries its own name')
  assert.ok(readFileSync(join(copy, 'SKILL.md'), 'utf8').includes('description: "About alpha"'), 'the rest of the frontmatter is kept')
  assert.ok(readFileSync(join(userRoot, 'alpha', 'SKILL.md'), 'utf8').includes('name: alpha\n'), 'the original is untouched')
  assert.equal(existsSync(join(copy, 'scripts', 'run.sh')), true)
  for (const left of ['.kybernos-team.json', '.git', 'leak.txt']) assert.equal(existsSync(join(copy, left)), false, left + ' stays behind')
  assert.ok(invalidated > before, 'the registry is told')
  ok('duplicate: a real copy under a free name, its frontmatter renamed, links, .git and the Team mark left behind')

  const d2 = await mod.duplicateSkill({ ctx, root: userRoot, name: 'alpha', config })
  assert.equal(d2.name, 'alpha-copy-2')
  const dg = await mod.duplicateSkill({ ctx, root: projRoot, name: 'gamma', config })
  assert.equal(dg.ok, true)
  assert.equal(existsSync(join(userRoot, 'gamma-copy', 'SKILL.md')), true, 'a read-only skill is copied into the user\'s own folder')
  assert.equal(existsSync(join(projRoot, 'gamma-copy')), false)
  const db = await mod.duplicateSkill({ ctx, root: userRoot, name: 'beta-off', config })
  assert.equal(db.ok, true)
  assert.equal(existsSync(join(userRoot, 'beta-off-copy', 'SKILL.md.disabled')), true, 'a disabled skill stays disabled')
  assert.ok(readFileSync(join(userRoot, 'beta-off-copy', 'SKILL.md.disabled'), 'utf8').includes('name: beta-off-copy'))
  assert.equal((await mod.duplicateSkill({ ctx, root: userRoot, name: 'alias', config })).error, 'is_link')
  assert.equal((await mod.duplicateSkill({ ctx, root: userRoot, name: 'ghost', config })).error, 'not_found')
  ok('duplicate: never over an existing folder, from a read-only folder into the user\'s own, a disabled one stays disabled, a link is refused')

  // 5. delete
  assert.equal((await mod.deleteSkill({ ctx, root: projRoot, name: 'gamma', config })).error, 'not_writable')
  assert.equal(existsSync(join(projRoot, 'gamma', 'SKILL.md')), true, 'a read-only skill is still there')
  assert.equal((await mod.deleteSkill({ ctx, root: userRoot, name: 'alias', config })).error, 'is_link')
  assert.equal(existsSync(join(userRoot, 'alpha', 'SKILL.md')), true)
  assert.equal((await mod.deleteSkill({ ctx, root: userRoot, name: 'ghost', config })).error, 'not_found')
  assert.equal((await mod.deleteSkill({ ctx, root: userRoot, name: '../alpha', config })).error, 'bad_name')
  const del = await mod.deleteSkill({ ctx, root: userRoot, name: 'alpha-copy-2', config })
  assert.deepEqual([del.ok, del.deleted], [true, true])
  assert.equal(existsSync(join(userRoot, 'alpha-copy-2')), false)
  assert.equal(existsSync(join(userRoot, 'alpha-copy', 'SKILL.md')), true, 'the other copies are untouched')
  assert.equal(readFileSync(outside, 'utf8'), 'NOT A SKILL FILE', 'nothing outside the skill was touched')
  ok('delete: a writable skill folder goes; a read-only one, a link, an unknown name and a path trick are refused and leave everything in place')

  // 6. the preview of a remote skill
  const tree = { truncated: false, tree: [
    { path: 'README.md', type: 'blob' },
    { path: 'skills/productivity/grill-me/SKILL.md', type: 'blob' },
    { path: '.claude/skills/grill-me/SKILL.md', type: 'blob' },
    { path: 'skills/engineering/tdd/SKILL.md', type: 'blob' },
    { path: 'skills/engineering/tdd', type: 'tree' },
    { path: 'skills/../evil/grill-me/SKILL.md', type: 'blob' },
    { path: 'skills/we ird?/grill-me/SKILL.md', type: 'blob' }
  ] }
  const files = {
    'skills/productivity/grill-me/SKILL.md': '---\nname: grill-me\ndescription: Interview me relentlessly about a plan.\n---\n\n# Grill me\n' + 'x'.repeat(7000),
    '.claude/skills/grill-me/SKILL.md': '---\nname: grill-me\ndescription: the hidden copy\n---\n',
    'skills/engineering/tdd/SKILL.md': '---\nname: some-other-name\ndescription: x\n---\n'
  }
  const asked = []
  let mode = 'ok'
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    asked.push({ url: String(url), headers: init && init.headers })
    const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, body: null, arrayBuffer: async () => Buffer.from(body === undefined ? '' : body) })
    const u = String(url)
    if (mode === 'limit') return reply(403)
    if (mode === 'gone') return reply(404)
    const m = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/git\/trees\/HEAD\?recursive=1$/.exec(u)
    if (m !== null) return reply(200, JSON.stringify(tree))
    const raw = /^https:\/\/raw\.githubusercontent\.com\/mattpocock\/skills\/HEAD\/(.+)$/.exec(u)
    if (raw !== null) { const f = files[decodeURIComponent(raw[1])]; return f === undefined ? reply(404) : reply(200, f) }
    return reply(500)
  }
  try {
    mod.resetDiscoverCache()
    const p = await mod.previewSkill('mattpocock/skills', 'grill-me')
    assert.equal(p.ok, true, JSON.stringify(p))
    assert.equal(p.found, true)
    assert.equal(p.folder, 'skills/productivity/grill-me', 'the visible folder is preferred to the hidden copy')
    assert.equal(p.description, 'Interview me relentlessly about a plan.')
    assert.ok(p.text.startsWith('---\nname: grill-me') && p.truncated === true && p.text.length <= 6000)
    assert.equal(p.url, 'https://github.com/mattpocock/skills/tree/HEAD/skills/productivity/grill-me')
    assert.deepEqual(asked.map((a) => a.url), [
      'https://api.github.com/repos/mattpocock/skills/git/trees/HEAD?recursive=1',
      'https://raw.githubusercontent.com/mattpocock/skills/HEAD/skills/productivity/grill-me/SKILL.md'
    ])
    assert.ok(asked.every((a) => a.headers.authorization === undefined && a.headers.cookie === undefined), 'no credential of any kind')
    ok('preview: the folder is found in the repository\'s own listing, the description and the start of SKILL.md come with it, anonymously')

    const n = asked.length
    await mod.previewSkill('mattpocock/skills', 'grill-me')
    assert.equal(asked.length, n, 'asked again within five minutes: served from memory')
    const other = await mod.previewSkill('mattpocock/skills', 'tdd')
    assert.equal(other.found, false, 'the file\'s frontmatter must name the skill, like the install')
    assert.equal(asked.filter((a) => a.url.includes('/git/trees/')).length, 1, 'one listing per repository')
    ok('preview: one listing per repository, an answer kept five minutes, and a SKILL.md that names another skill is not this one')

    assert.equal((await mod.previewSkill('mattpocock/skills', 'does-not-exist')).found, false)
    assert.equal(asked.some((a) => a.url.includes('evil') || a.url.includes('%3F') || a.url.includes('we%20ird')), false, 'a path that is not plain is never asked for')
    ok('preview: a name the repository does not have is "not found", and an odd path in the listing is never requested')

    mod.resetDiscoverCache()
    mode = 'limit'
    const lim = await mod.previewSkill('mattpocock/skills', 'grill-me')
    assert.deepEqual([lim.ok, lim.error, lim.http], [false, 'github_rate_limited', 403])
    mode = 'gone'
    assert.equal((await mod.previewSkill('mattpocock/skills', 'grill-me')).error, 'repo_not_found')
    mode = 'ok'
    assert.equal((await mod.previewSkill('mattpocock/skills', 'grill-me')).ok, true, 'a failure is not remembered')
    const count = asked.length
    assert.equal((await mod.previewSkill('x', 'grill-me')).error, 'invalid_source')
    assert.equal((await mod.previewSkill('open.feishu.cn', 'grill-me')).error, 'not_github')
    assert.equal((await mod.previewSkill('mattpocock/skills', '../x')).error, 'invalid_name')
    assert.equal(asked.length, count, 'a refused request reaches nobody')
    ok('preview: a limit and a missing repository are named, a failure is never cached, a bad source or name is refused before any request')
  } finally {
    globalThis.fetch = realFetch
  }

  // 7. the routes
  const routes = {}
  mod.apply({ inject (deps, fn) { fn({ get: (n) => (n === 'webServer' ? { register: (r) => { routes[r.path] = r } } : (n === 'skills' ? registry : undefined)), effect: (f) => f() }) } })
  for (const p of ['skill/read', 'skill/reveal', 'skill/duplicate', 'skill/delete', 'preview']) assert.ok(routes['/kybernos-skills/' + p] !== undefined, p + ' is mounted')
  assert.equal(routes['/kybernos-skills/skill-body'], undefined, 'the old GET that handed a skill\'s text to any caller is gone')
  const call = async (path, body, headers) => {
    const res = { code: 0, raw: '', writeHead (c) { this.code = c }, end (s) { this.raw = s } }
    await routes[path].handler({ method: 'POST', url: path, headers: headers || {}, socket: { localPort: 3080 }, async * [Symbol.asyncIterator] () { yield Buffer.from(JSON.stringify(body)) } }, res)
    return { code: res.code, json: JSON.parse(res.raw) }
  }
  for (const p of ['skill/read', 'skill/reveal', 'skill/duplicate', 'skill/delete']) {
    const refused = await call('/kybernos-skills/' + p, { root: userRoot, name: 'alpha-copy', target: 'folder' }, {})
    assert.equal(refused.code, 403, p + ' without an Origin')
  }
  assert.equal(existsSync(join(userRoot, 'alpha-copy', 'SKILL.md')), true, 'a refused delete deleted nothing')
  const viaRoute = await call('/kybernos-skills/skill/read', { root: userRoot, name: 'alpha-copy' }, { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080', cookie: sessionCookie('127.0.0.1:3080') })
  assert.equal(viaRoute.json.ok, true, JSON.stringify(viaRoute))
  assert.equal(viaRoute.json.actions.delete, true)
  ok('routes: the four POSTs need an Origin from this machine, and read answers through the route with its actions')
} finally {
  try {
    for (const n of readdirSync(userRoot)) { const p = join(userRoot, n); if (lstatSync(p).isSymbolicLink()) rmSync(p) }
    rmSync(base, { recursive: true, force: true })
  } catch (e) { /* temp folder */ }
}
console.log('\n' + pass + ' verifications OK')
