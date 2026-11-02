// Tests of the skill seeding (seed-skills.mjs), on a temp folder. Pure node, offline.
//   (cd packages/kybernos-theme && node test-seed-skills.mjs)
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedSkills, STATE_FILE } from './seed-skills.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
let failed = 0
let total = 0
const check = (name, ok, detail) => {
  total += 1
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}
const root = mkdtempSync(join(tmpdir(), 'kb-seed-skills-'))
let n = 0
const world = (skills) => {
  n += 1
  const home = join(root, 'home' + n)
  const sourceDir = join(root, 'src' + n)
  for (const [name, text] of Object.entries(skills)) { mkdirSync(join(sourceDir, name), { recursive: true }); writeFileSync(join(sourceDir, name, 'SKILL.md'), text) }
  mkdirSync(home, { recursive: true })
  return { home, sourceDir, skill: (name) => join(home, 'skills', name, 'SKILL.md'), state: () => JSON.parse(readFileSync(join(home, 'kybernos', STATE_FILE), 'utf8')) }
}
const V1 = '---\nname: alpha\ndescription: first\n---\nversion one\n'
const V2 = '---\nname: alpha\ndescription: first\n---\nversion two\n'
const actions = (r) => r.map((x) => x.name + ':' + x.action).join(' ')

console.log('first start')
{
  const w = world({ alpha: V1, beta: V1.replace(/alpha/g, 'beta') })
  const r = seedSkills({ home: w.home, sourceDir: w.sourceDir, names: ['alpha', 'beta'] })
  check('absent skills are created', actions(r) === 'alpha:created beta:created', actions(r))
  check('as <home>/skills/<name>/SKILL.md, byte for byte', readFileSync(w.skill('alpha'), 'utf8') === V1 && readFileSync(w.skill('beta'), 'utf8').includes('beta'))
  check('what was written is remembered (sha-256)', /^[0-9a-f]{64}$/.test(w.state().skills.alpha) && w.state().version === 1)
  check('no .tmp file is left behind', readdirSync(join(w.home, 'skills', 'alpha')).join() === 'SKILL.md' && readdirSync(join(w.home, 'kybernos')).join() === STATE_FILE)
}

console.log('second start (idempotent)')
{
  const w = world({ alpha: V1 })
  seedSkills({ home: w.home, sourceDir: w.sourceDir, names: ['alpha'] })
  const old = new Date(1_600_000_000_000)
  utimesSync(w.skill('alpha'), old, old)
  utimesSync(join(w.home, 'kybernos', STATE_FILE), old, old)
  const r = seedSkills({ home: w.home, sourceDir: w.sourceDir, names: ['alpha'] })
  check('nothing to do: "current"', actions(r) === 'alpha:current')
  check('neither the skill nor the state file is rewritten', statSync(w.skill('alpha')).mtimeMs === old.getTime() && statSync(join(w.home, 'kybernos', STATE_FILE)).mtimeMs === old.getTime())
}

console.log('the plugin ships a new text')
{
  const w = world({ alpha: V1 })
  seedSkills({ home: w.home, sourceDir: w.sourceDir, names: ['alpha'] })
  writeFileSync(join(w.sourceDir, 'alpha', 'SKILL.md'), V2)
  let r = seedSkills({ home: w.home, sourceDir: w.sourceDir, names: ['alpha'] })
  check('a skill the user never touched is refreshed ("updated")', actions(r) === 'alpha:updated' && readFileSync(w.skill('alpha'), 'utf8') === V2)
  check('… and the new text is what is remembered', r.length === 1 && w.state().skills.alpha !== undefined)
  r = seedSkills({ home: w.home, sourceDir: w.sourceDir, names: ['alpha'] })
  check('then it is "current" again', actions(r) === 'alpha:current')
}

console.log('the user changed the skill')
{
  const w = world({ alpha: V1 })
  seedSkills({ home: w.home, sourceDir: w.sourceDir, names: ['alpha'] })
  const mine = '---\nname: alpha\ndescription: tuned by me\n---\nmy words\n'
  writeFileSync(w.skill('alpha'), mine)
  let r = seedSkills({ home: w.home, sourceDir: w.sourceDir, names: ['alpha'] })
  check('an edited skill is left alone ("kept")', actions(r) === 'alpha:kept' && readFileSync(w.skill('alpha'), 'utf8') === mine)
  writeFileSync(join(w.sourceDir, 'alpha', 'SKILL.md'), V2)
  r = seedSkills({ home: w.home, sourceDir: w.sourceDir, names: ['alpha'] })
  check('… also when the plugin ships a new text later', actions(r) === 'alpha:kept' && readFileSync(w.skill('alpha'), 'utf8') === mine)
  writeFileSync(w.skill('alpha'), V2)
  r = seedSkills({ home: w.home, sourceDir: w.sourceDir, names: ['alpha'] })
  check('if the user\'s file happens to equal the shipped text it is simply current (and the next update may refresh it)', actions(r) === 'alpha:current')
}

console.log('a skill of the same name the user wrote before')
{
  const w = world({ alpha: V1 })
  mkdirSync(join(w.home, 'skills', 'alpha'), { recursive: true })
  writeFileSync(w.skill('alpha'), 'theirs')
  let r = seedSkills({ home: w.home, sourceDir: w.sourceDir, names: ['alpha'] })
  check('a file we never wrote is never overwritten', actions(r) === 'alpha:kept' && readFileSync(w.skill('alpha'), 'utf8') === 'theirs' && !existsSync(join(w.home, 'kybernos', STATE_FILE)))
  mkdirSync(join(w.home, 'kybernos'), { recursive: true })
  writeFileSync(join(w.home, 'kybernos', STATE_FILE), '{ broken')
  r = seedSkills({ home: w.home, sourceDir: w.sourceDir, names: ['alpha'] })
  check('a damaged state file means nothing is known to be ours: still "kept"', actions(r) === 'alpha:kept' && readFileSync(w.skill('alpha'), 'utf8') === 'theirs')
}

console.log('disabled by the user')
{
  const w = world({ alpha: V1 })
  mkdirSync(join(w.home, 'skills', 'alpha'), { recursive: true })
  writeFileSync(join(w.home, 'skills', 'alpha', 'SKILL.md.disabled'), V1)
  const r = seedSkills({ home: w.home, sourceDir: w.sourceDir, names: ['alpha'] })
  check('a SKILL.md.disabled means "off": the skill is not brought back', actions(r) === 'alpha:disabled' && !existsSync(w.skill('alpha')))
}

console.log('deleted by the user')
{
  const w = world({ alpha: V1 })
  seedSkills({ home: w.home, sourceDir: w.sourceDir, names: ['alpha'] })
  rmSync(join(w.home, 'skills', 'alpha'), { recursive: true })
  const r = seedSkills({ home: w.home, sourceDir: w.sourceDir, names: ['alpha'] })
  check('a skill folder that was deleted is created again at the next start (documented)', actions(r) === 'alpha:created' && readFileSync(w.skill('alpha'), 'utf8') === V1)
}

console.log('bad input never throws')
{
  const w = world({ alpha: V1, empty: '  \n', })
  const r = seedSkills({ home: w.home, sourceDir: w.sourceDir, names: ['missing', 'empty', '../evil', 'A', '', 'a/b', 'alpha', null, 5] })
  check('missing and empty sources are reported, not installed', r[0].action === 'no-source' && r[1].action === 'no-source' && !existsSync(join(w.home, 'skills', 'missing')) && !existsSync(join(w.home, 'skills', 'empty')), actions(r))
  check('names that are not skill names are refused and nothing leaves the skills folder', r.slice(2, 6).every((x) => x.action === 'invalid-name') && r[6].action === 'created' && r[7].action === 'invalid-name' && r[8].action === 'invalid-name' && !existsSync(join(w.home, 'evil')) && readdirSync(join(w.home, 'skills')).join() === 'alpha', actions(r))
  const file = join(root, 'a-file')
  writeFileSync(file, 'x')
  let threw = null
  let out = null
  try { out = seedSkills({ home: file, sourceDir: w.sourceDir, names: ['alpha'] }) } catch (e) { threw = e }
  check('a home that cannot be written is an "error" entry, not an exception', threw === null && out[0].action === 'error' && typeof out[0].error === 'string' && out.some((x) => x.name === STATE_FILE) === false, JSON.stringify(out))
  threw = null
  try { seedSkills({ home: w.home, sourceDir: join(root, 'no-such-dir'), names: ['alpha'] }) } catch (e) { threw = e }
  check('a source folder that does not exist is fine', threw === null)
  threw = null
  try { seedSkills({ home: w.home, sourceDir: w.sourceDir, names: [] }) } catch (e) { threw = e }
  check('an empty list is fine', threw === null)
}

console.log('the skills this plugin really ships')
{
  const names = readdirSync(join(HERE, 'skills'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
  const w = world({})
  const r = seedSkills({ home: w.home, sourceDir: join(HERE, 'skills'), names })
  check('every folder of skills/ is seeded into a fresh home', names.length >= 2 && r.every((x) => x.action === 'created'), actions(r))
  check('each one lands as <home>/skills/<name>/SKILL.md, identical to the source', names.every((x) => readFileSync(w.skill(x), 'utf8') === readFileSync(join(HERE, 'skills', x, 'SKILL.md'), 'utf8')))
}

rmSync(root, { recursive: true, force: true })
console.log(failed === 0 ? '\nOK — skill seeding (' + total + ' checks)' : '\n' + failed + ' of ' + total + ' check(s) FAILED')
process.exit(failed === 0 ? 0 : 1)
