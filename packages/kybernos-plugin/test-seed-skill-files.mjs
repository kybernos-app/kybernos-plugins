// Tests of the companion-file seeding of the core plugin (seed-skill-files.mjs), on a temp folder. Pure node, offline.
//   (cd packages/kybernos-plugin && node test-seed-skill-files.mjs)
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedSkills } from './seed-skills.mjs'
import { FILES_STATE, MAX_FILE_BYTES, listCompanions, seedSkillFiles } from './seed-skill-files.mjs'

let failed = 0
let total = 0
const check = (name, ok, detail) => {
  total += 1
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}
const root = mkdtempSync(join(tmpdir(), 'kb-seed-files-'))
let n = 0
const put = (file, text) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text) }
const SKILL = '---\nname: kit\ndescription: d\nwhenToUse: w\n---\nbody\n'
/** A source folder holding the skill `kit` with the given companion files, and an empty home. */
const world = (files) => {
  n += 1
  const home = join(root, 'home' + n)
  const sourceDir = join(root, 'src' + n)
  put(join(sourceDir, 'kit', 'SKILL.md'), SKILL)
  for (const [rel, text] of Object.entries(files)) put(join(sourceDir, 'kit', ...rel.split('/')), text)
  mkdirSync(home, { recursive: true })
  const seed = () => { seedSkills({ home, sourceDir, names: ['kit'] }); return seedSkillFiles({ home, sourceDir, names: ['kit'] })[0] }
  return { home, sourceDir, seed, at: (rel) => join(home, 'skills', 'kit', ...rel.split('/')), src: (rel) => join(sourceDir, 'kit', ...rel.split('/')), state: () => JSON.parse(readFileSync(join(home, 'kybernos', FILES_STATE), 'utf8')) }
}
const counts = (r) => Object.entries(r.counts || {}).filter(([, v]) => v > 0).map(([k, v]) => k + ':' + v).join(' ')

console.log('first start')
{
  const w = world({ 'scripts/a.mjs': 'one\n', 'examples/blank/model.py': 'two\n', 'README.md': 'three\n' })
  const r = w.seed()
  check('every companion file is created, in its folder', r.action === 'seeded' && counts(r) === 'created:3', JSON.stringify(r))
  check('byte for byte', readFileSync(w.at('scripts/a.mjs'), 'utf8') === 'one\n' && readFileSync(w.at('examples/blank/model.py'), 'utf8') === 'two\n')
  check('what was written is remembered (sha-256)', Object.keys(w.state().files.kit).length === 3 && /^[0-9a-f]{64}$/.test(w.state().files.kit['README.md']))
  check('SKILL.md itself is not part of it', !('SKILL.md' in w.state().files.kit))
  check('no .tmp file is left behind', !existsSync(w.at('scripts/a.mjs.tmp')))
}

console.log('a second start, and a plugin update')
{
  const w = world({ 'scripts/a.mjs': 'one\n', 'old.md': 'gone soon\n' })
  w.seed()
  let r = w.seed()
  check('nothing to do the second time', counts(r) === 'current:2', counts(r))
  writeFileSync(w.src('scripts/a.mjs'), 'one, better\n')
  rmSync(w.src('old.md'))
  put(w.src('new.md'), 'fresh\n')
  r = w.seed()
  check('a file we wrote and that changed in the plugin is refreshed', readFileSync(w.at('scripts/a.mjs'), 'utf8') === 'one, better\n')
  check('a new file is added, a file the plugin dropped is removed', readFileSync(w.at('new.md'), 'utf8') === 'fresh\n' && !existsSync(w.at('old.md')) && counts(r) === 'created:1 updated:1 removed:1', counts(r))
  check('the memory follows', JSON.stringify(Object.keys(w.state().files.kit).sort()) === JSON.stringify(['new.md', 'scripts/a.mjs']))
}

console.log('the person\'s own edits')
{
  const w = world({ 'scripts/a.mjs': 'one\n', 'old.md': 'gone soon\n' })
  w.seed()
  writeFileSync(w.at('scripts/a.mjs'), 'my edit\n')
  writeFileSync(w.at('old.md'), 'my notes\n')
  writeFileSync(w.src('scripts/a.mjs'), 'one, better\n')
  rmSync(w.src('old.md'))
  const r = w.seed()
  check('an edited file is never overwritten', readFileSync(w.at('scripts/a.mjs'), 'utf8') === 'my edit\n')
  check('an edited file the plugin dropped is not deleted', readFileSync(w.at('old.md'), 'utf8') === 'my notes\n')
  check('both are reported as kept / not removed', counts(r) === 'kept:1', counts(r))
  writeFileSync(w.src('scripts/a.mjs'), 'my edit\n')          // the plugin catches up with the person's version
  check('and once identical it is simply current', counts(w.seed()) === 'current:1')
}
{
  const w = world({ 'scripts/a.mjs': 'one\n' })
  seedSkills({ home: w.home, sourceDir: w.sourceDir, names: ['kit'] })
  put(w.at('scripts/a.mjs'), 'there before us\n')
  const r = seedSkillFiles({ home: w.home, sourceDir: w.sourceDir, names: ['kit'] })[0]
  check('a file that was already there and is not ours is kept', readFileSync(w.at('scripts/a.mjs'), 'utf8') === 'there before us\n' && counts(r) === 'kept:1', counts(r))
}

console.log('what is left alone')
{
  const w = world({ 'scripts/a.mjs': 'one\n' })
  seedSkills({ home: w.home, sourceDir: w.sourceDir, names: ['kit'] })
  writeFileSync(join(w.home, 'skills', 'kit', 'SKILL.md.disabled'), '')
  const r = seedSkillFiles({ home: w.home, sourceDir: w.sourceDir, names: ['kit'] })[0]
  check('a skill the person switched off gets nothing', r.action === 'disabled' && !existsSync(w.at('scripts/a.mjs')))
}
{
  const w = world({ 'scripts/a.mjs': 'one\n' })
  const r = seedSkillFiles({ home: w.home, sourceDir: w.sourceDir, names: ['kit'] })[0]
  check('no SKILL.md on disk: no orphan files', r.action === 'no-skill' && !existsSync(w.at('scripts/a.mjs')))
}
{
  const w = world({})
  check('a skill with no companion file has nothing to do', seedSkillFiles({ home: w.home, sourceDir: w.sourceDir, names: ['kit'] })[0].action === 'nothing')
  check('an unknown skill, or a bad name, is reported and does not throw', seedSkillFiles({ home: w.home, sourceDir: w.sourceDir, names: ['ghost', '../x', 'Bad'] }).map((x) => x.action).join() === 'nothing,invalid-name,invalid-name')
}
{
  const w = world({ 'a.txt': 'ok\n', '.hidden': 'x\n', 'bad name.txt': 'x\n', 'sub/.git/config': 'x\n', 'big.bin': 'x'.repeat(MAX_FILE_BYTES + 1) })
  symlinkSync('/etc/hosts', w.src('link.txt'))
  const list = listCompanions(join(w.sourceDir, 'kit'))
  check('hidden names, odd characters, symlinks and oversized files are not copied', list.join() === 'a.txt', list.join())
}

console.log('never throws')
{
  const w = world({ 'scripts/a.mjs': 'one\n' })
  seedSkills({ home: w.home, sourceDir: w.sourceDir, names: ['kit'] })
  mkdirSync(join(w.home, 'skills', 'kit', 'scripts'), { recursive: true })
  chmodSync(join(w.home, 'skills', 'kit', 'scripts'), 0o500)
  let r
  try { r = seedSkillFiles({ home: w.home, sourceDir: w.sourceDir, names: ['kit'] })[0] } catch (e) { r = { action: 'THREW' } }
  chmodSync(join(w.home, 'skills', 'kit', 'scripts'), 0o700)
  check('an unwritable folder is an "error" result, not an exception', r.action === 'error' || process.getuid() === 0, r.action)
}

rmSync(root, { recursive: true, force: true })
console.log(failed === 0 ? `\nall ${total} checks passed` : `\n${failed} of ${total} checks FAILED`)
process.exit(failed === 0 ? 0 : 1)
