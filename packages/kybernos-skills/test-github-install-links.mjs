#!/usr/bin/env node
/** A skill installed from GitHub is made of plain files and folders: no link that came with the download is followed or copied.
 *  Before, the copy followed them, so a link to a file of this machine put its content in the installed skill. Throw-away homes and
 *  a throw-away « file of this machine »; the archive is built here and handed over by a stand-in `fetch`, so nothing goes to the
 *  network. A system that does not let this test make links reports it as skipped.
 *
 *  Usage: node packages/kybernos-skills/test-github-install-links.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const base = mkdtempSync(join(tmpdir(), 'kb-github-links-'))
process.env.HOME = join(base, 'os-home')
process.env.USERPROFILE = process.env.HOME
process.env.DSH_HOME = join(base, 'os-home', '.dsh')
delete process.env.KB_MOTEUR
const index = await import('./index.js')

let pass = 0
let failed = 0
const test = async (label, fn) => {
  try {
    await fn()
    pass += 1
    console.log('  ✓ ' + label)
  } catch (e) {
    failed += 1
    console.log('  ✗ ' + label + '\n      ' + String(e?.message ?? e).split('\n').slice(0, 4).join('\n      '))
  }
}
const canLink = (() => {
  try { symlinkSync(base, join(base, 'can-link')); return true } catch (e) { return false }
})()
const withLinks = async (label, fn) => {
  if (!canLink) { console.log('SKIPPED: ' + label + ' — this system does not let the test make links'); return }
  await test(label, fn)
}

// A file and a folder of this machine that no downloaded skill may ever reach.
const SECRET = 'CONTENT-OF-A-FILE-OF-THIS-MACHINE'
const machine = join(base, 'this-machine')
mkdirSync(join(machine, 'a-skill-folder'), { recursive: true })
writeFileSync(join(machine, 'secret.txt'), SECRET + '\n')

const ARCHIVE_URL = 'https://codeload.github.com/owner/repo/tar.gz/HEAD'
let archive = null
globalThis.fetch = async (url) => {
  if (String(url) !== ARCHIVE_URL) throw new Error('unexpected request: ' + url)
  return new Response(archive)
}

const NAME = 'harmless-notes'
const skillMd = `---\nname: ${NAME}\ndescription: demo\n---\nBody\n`
writeFileSync(join(machine, 'a-skill-folder', 'SKILL.md'), skillMd)
const put = (file, content) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content) }
const point = (target, link) => { mkdirSync(dirname(link), { recursive: true }); symlinkSync(target, link) }

let cases = 0
/**
 * What installing `NAME` answers when the repository is what `fill(repo, skill)` makes of it: `skill` is `skills/<NAME>`, which
 * holds a plain SKILL.md unless `fill` is told otherwise (`withSkill: false`).
 */
const install = async (fill, { withSkill = true } = {}) => {
  const dir = join(base, 'case-' + (cases += 1))
  const repo = join(dir, 'src', 'repo-0000000')
  const skill = join(repo, 'skills', NAME)
  mkdirSync(repo, { recursive: true })
  if (withSkill) put(join(skill, 'SKILL.md'), skillMd)
  fill(repo, skill)
  execFileSync('tar', ['-czf', join(dir, 'repo.tar.gz'), '-C', join(dir, 'src'), 'repo-0000000'])
  archive = readFileSync(join(dir, 'repo.tar.gz'))
  const config = { home: join(dir, 'home'), dsh: join(dir, 'dsh'), cwd: dir }
  const root = join(config.dsh, 'skills')
  mkdirSync(root, { recursive: true })
  const result = await index.installSkill({ ctx: { get: () => undefined }, source: 'owner/repo', name: NAME, config })
  return { result, root }
}

/** The install is refused for the link at `files` (a path inside the skill folder), and nothing at all is written. */
const refused = async (fill, ...files) => {
  const { result, root } = await install(fill)
  assert.deepEqual([result.ok, result.error, result.name, result.source], [false, 'repo_has_links', NAME, 'owner/repo'], JSON.stringify(result))
  assert.ok(files.includes(result.file), 'the link is named: ' + result.file)
  assert.deepEqual(readdirSync(root), [], 'nothing is written')
  // Throwing the extracted download away removes its links, never what they point at.
  assert.equal(readFileSync(join(machine, 'secret.txt'), 'utf8'), SECRET + '\n')
  assert.deepEqual(readdirSync(join(machine, 'a-skill-folder')), ['SKILL.md'])
}
const notFound = async (fill, options) => {
  const { result, root } = await install(fill, options)
  assert.deepEqual([result.ok, result.error], [false, 'skill_not_in_repo'], JSON.stringify(result))
  assert.deepEqual(readdirSync(root), [])
}
/** Every path under `folder`, each one checked to be a plain folder or a plain file with one name. */
const plainTree = (folder, rel = '') => readdirSync(join(folder, rel)).sort().flatMap((entry) => {
  const path = rel === '' ? entry : rel + '/' + entry
  const stat = lstatSync(join(folder, path))
  assert.ok(stat.isDirectory() || (stat.isFile() && stat.nlink === 1), 'not a plain file or folder: ' + path)
  return stat.isDirectory() ? [path + '/', ...plainTree(folder, path)] : [path]
})

try {
  console.log('kybernos-skills — a skill installed from GitHub holds no link')

  await withLinks('a link to a file of this machine, in the skill folder', () =>
    refused((repo, skill) => point(join(machine, 'secret.txt'), join(skill, 'notes.txt')), 'notes.txt'))

  await withLinks('the same link deeper in the skill folder', () =>
    refused((repo, skill) => point(join(machine, 'secret.txt'), join(skill, 'references', 'deep', 'notes.txt')), 'references/deep/notes.txt'))

  await withLinks('a link to a folder of this machine', () =>
    refused((repo, skill) => point(machine, join(skill, 'references')), 'references'))

  await withLinks('a relative link that climbs out of the download to a file of this machine', () =>
    refused((repo, skill) => point('../'.repeat(24) + join(machine, 'secret.txt').slice(1), join(skill, 'notes.txt')), 'notes.txt'))

  await withLinks('a relative link that leaves the skill folder for another file of the repository', () =>
    refused((repo, skill) => { put(join(repo, 'shared', 'notes.txt'), 'shared\n'); point('../../shared/notes.txt', join(skill, 'notes.txt')) }, 'notes.txt'))

  await withLinks('a link that stays inside the skill folder is a link too', () =>
    refused((repo, skill) => point('SKILL.md', join(skill, 'copy.md')), 'copy.md'))

  await withLinks('a link that leads nowhere', () =>
    refused((repo, skill) => point('/nowhere/at/all', join(skill, 'notes.txt')), 'notes.txt'))

  await test('a hard link between two files of the skill folder', () =>
    refused((repo, skill) => { put(join(skill, 'a.md'), 'a\n'); linkSync(join(skill, 'a.md'), join(skill, 'b.md')) }, 'a.md', 'b.md'))

  await test('a hard link from the skill folder to a file elsewhere in the repository', () =>
    refused((repo, skill) => { put(join(repo, 'shared.md'), 's\n'); linkSync(join(repo, 'shared.md'), join(skill, 'shared.md')) }, 'shared.md'))

  await withLinks('a skill folder that is itself a link to a folder of this machine is not entered', () =>
    notFound((repo, skill) => point(join(machine, 'a-skill-folder'), skill), { withSkill: false }))

  await withLinks('a skill folder that is itself a link to a folder beside it is not a second skill', async () => {
    const { result, root } = await install((repo, skill) => point('../../skills/' + NAME, join(repo, '.claude', 'skills', NAME)))
    assert.deepEqual([result.ok, result.folder], [true, 'skills/' + NAME], JSON.stringify(result))
    assert.deepEqual(plainTree(join(root, NAME)), ['SKILL.md'])
  })

  await withLinks('a SKILL.md that is a link does not make a skill', () =>
    notFound((repo, skill) => point(join(machine, 'a-skill-folder', 'SKILL.md'), join(skill, 'SKILL.md')), { withSkill: false }))

  await withLinks('a link elsewhere in the repository is left there and does not stop the install', async () => {
    const { result, root } = await install((repo) => { point(join(machine, 'secret.txt'), join(repo, 'CLAUDE.md')); point(machine, join(repo, 'skills', 'other')) })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.deepEqual(readdirSync(root), [NAME])
    assert.deepEqual(plainTree(join(root, NAME)), ['SKILL.md'])
  })

  await test('the installed copy is a real folder of plain files and folders', async () => {
    const { result, root } = await install((repo, skill) => { put(join(skill, 'scripts', 'run.sh'), 'echo ok\n'); mkdirSync(join(skill, 'assets', 'empty'), { recursive: true }) })
    assert.deepEqual([result.ok, result.files], [true, 2], JSON.stringify(result))
    assert.equal(lstatSync(join(root, NAME)).isDirectory(), true)
    assert.deepEqual(plainTree(join(root, NAME)), ['SKILL.md', 'assets/', 'assets/empty/', 'scripts/', 'scripts/run.sh'])
    assert.equal(existsSync(join(root, NAME, 'scripts', 'run.sh')), true)
  })

  await test('the install screen says why, in French and in English', () => {
    const client = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
    assert.match(client, /^\s*'he\.repo_has_links': \{ fr: '[^\n]*\{source\}[^\n]*', en: '[^\n]*\{source\}[^\n]*' \},$/m)
  })
} finally {
  rmSync(base, { recursive: true, force: true })
}

if (failed > 0) {
  console.log(`\n${failed} failed, ${pass} OK`)
  process.exit(1)
}
console.log(`\n${pass} verifications OK`)
process.exit(0)
