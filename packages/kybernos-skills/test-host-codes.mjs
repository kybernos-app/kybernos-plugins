#!/usr/bin/env node
/** The host half answers a refusal with a CODE, never a sentence: the screen words it, in the language of the person looking.
 *
 *  Before, the older routes (toggle, create, install, search, audit) wrote French sentences, which an English user read as they were.
 *  This test drives each refusal that needs no network and checks the code and the facts it carries (`source`, `name`…), on a throw-away
 *  home. test-client-strings.mjs checks the other side: every code has a French and an English sentence.
 *
 *  Usage: node packages/kybernos-skills/test-host-codes.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const home = mkdtempSync(join(tmpdir(), 'kybernos-codes-'))
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, DSH_HOME: process.env.DSH_HOME, URL: process.env.KYBERNOS_SKILLS_INDEX_URL }
process.env.HOME = home; process.env.USERPROFILE = home; process.env.DSH_HOME = join(home, '.dsh')
delete process.env.KYBERNOS_SKILLS_INDEX_URL
try {
  const mod = await import('./index.js')
  const root = join(home, '.dsh', 'skills')
  const config = { home }
  const ctx = { get: () => undefined }
  const code = (r) => r.error
  const seed = (name) => { mkdirSync(join(root, name), { recursive: true }); writeFileSync(join(root, name, 'SKILL.md'), '---\nname: ' + name + '\ndescription: "d"\n---\n') }
  seed('present')

  // toggle
  const toggle = (over) => mod.toggleSkill({ ctx, root, name: 'present', active: false, config, ...over })
  assert.equal(code(await toggle({ root: join(home, 'elsewhere') })), 'root_not_allowed')
  assert.equal(code(await toggle({ name: 'Not A Name' })), 'invalid_name')
  assert.equal(code(await toggle({ active: 'yes' })), 'active_required')
  assert.equal(code(await toggle({ name: 'absent' })), 'skill_not_found')
  ok('toggle: a folder that is not ours, a bad name, a missing state and an unknown skill each answer with their code')

  // create
  const create = (over) => mod.createSkill({ ctx, root, name: 'fresh', description: 'd', config, ...over })
  assert.equal(code(await create({ root: join(home, 'elsewhere') })), 'root_not_allowed')
  assert.equal(code(await create({ name: 'Bad Name' })), 'invalid_name')
  assert.equal(code(await create({ description: '  ' })), 'description_required')
  const tooLong = await create({ description: 'x'.repeat(1025) })
  assert.deepEqual([tooLong.error, tooLong.max], ['description_too_long', 1024], 'the limit travels with the code')
  assert.equal(code(await create({ name: 'present' })), 'exists')
  ok('create: folder, name, description (missing, too long, with its limit) and a name already taken')

  // search, audit, install
  assert.equal(code(await mod.searchSkills('a', 5)), 'query_too_short')
  assert.equal(code(await mod.auditSkill('', 'x')), 'invalid_source')
  const install = (over) => mod.installSkill({ ctx, source: 'owner/repo', name: 'fresh', root, config, ...over })
  assert.equal(code(await install({ root: join(home, 'elsewhere') })), 'root_not_allowed')
  const domain = await install({ source: 'open.feishu.cn' })
  assert.deepEqual([domain.error, domain.source], ['not_github', 'open.feishu.cn'], 'the source travels with the code')
  assert.equal(code(await install({ source: 'not a source' })), 'invalid_source')
  assert.equal(code(await install({ name: 'Bad Name' })), 'invalid_name')
  assert.equal(code(await install({ name: 'present' })), 'already_installed')
  ok('search, audit and install: short query, bad source (and a non-GitHub one, with it), bad name, name already installed')

  // an unsafe index address: refused before any request
  process.env.KYBERNOS_SKILLS_INDEX_URL = 'http://example.com/v1'
  mod.resetDiscoverCache()
  assert.equal(code(await mod.indexSkills({ view: 'all-time', page: '0', perPage: '1' })), 'index_url_refused')
  ok('an unsafe index address answers index_url_refused')

  // every answer above is a code: no sentence, no accent
  const src = (await import('node:fs')).readFileSync(new URL('./index.js', import.meta.url), 'utf8')
  assert.equal(/\berror: '[^']*[^a-z0-9_'][^']*'/.test(src.slice(0, src.indexOf('// ── TEAM SKILLS')) + src.slice(src.indexOf('// ── CREATION'))), false, 'an `error:` that is a sentence')
  ok('no `error:` of the older routes is a sentence')
} finally {
  for (const [k, v] of Object.entries({ HOME: saved.HOME, USERPROFILE: saved.USERPROFILE, DSH_HOME: saved.DSH_HOME, KYBERNOS_SKILLS_INDEX_URL: saved.URL })) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  rmSync(home, { recursive: true, force: true })
}
console.log('\n' + pass + ' verifications OK')
