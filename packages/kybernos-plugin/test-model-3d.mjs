// Tests of the `model-3d` skill: its folder is sound and seedable, its one command works, a seeded copy is self-contained, and (when the CAD toolchain is
// there) the blank example builds, passes its checks and becomes a page. Offline; the CAD part is skipped, and says so, when there is no toolchain.
//   (cd packages/kybernos-plugin && node test-model-3d.mjs)
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedSkills } from './seed-skills.mjs'
import { listCompanions, seedSkillFiles } from './seed-skill-files.mjs'
import { EXAMPLES, isNewEnough, parsePyVersion, runSteps, scaffold, toolchainPython, writePage } from './skills/model-3d/scripts/model.mjs'
import { buildPage } from './skills/model-3d/scripts/kit/build-page.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SKILLS = join(HERE, 'skills')
const SKILL = join(SKILLS, 'model-3d')
let failed = 0
let total = 0
const check = (name, ok, detail) => {
  total += 1
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}
const root = mkdtempSync(join(tmpdir(), 'kb-model3d-'))
const quiet = () => {}
const allFiles = (dir) => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => relative(dir, join(e.parentPath, e.name)).split('\\').join('/')).sort()

console.log('the folder')
{
  const text = readFileSync(join(SKILL, 'SKILL.md'), 'utf8')
  const head = /^---\nname: (model-3d)\ndescription: (.+)\nwhenToUse: (.+)\n---\n/.exec(text)
  check('SKILL.md has its front matter (name, description, whenToUse) and the name is the folder\'s', head !== null)
  check('the description fits what DSH accepts (1 024 characters) and SKILL.md the vetting limit (24 KB)', head !== null && head[2].length <= 1024 && Buffer.byteLength(text) <= 24 * 1024, head ? head[2].length + ' chars, ' + Buffer.byteLength(text) + ' bytes' : '')
  const files = allFiles(SKILL)
  const sized = files.map((f) => ({ f, n: statSync(join(SKILL, f)).size }))
  check('every file is seedable: nothing is silently skipped by the seeder (names, links, size)', JSON.stringify(listCompanions(SKILL).concat(['SKILL.md']).sort()) === JSON.stringify(files), files.filter((f) => f !== 'SKILL.md' && !listCompanions(SKILL).includes(f)).join(', '))
  check('within the limits of a skill folder: at most 50 files, 256 KiB each, 1 MiB in all', files.length <= 50 && sized.every((x) => x.n <= 262144) && sized.reduce((s, x) => s + x.n, 0) <= 1048576, files.length + ' files, ' + sized.reduce((s, x) => s + x.n, 0) + ' bytes')
  check('text only (no NUL byte, no .glb or report left in the folder)', files.every((f) => !/\.glb$|(^|\/)model\.html$|-report\.json$|-checks\.json$|-params\.json$/.test(f) && !readFileSync(join(SKILL, f)).includes(0)), files.filter((f) => /\.glb$|(^|\/)model\.html$|-report\.json$|-checks\.json$|-params\.json$/.test(f)).join(', '))
  check('no personal path or address in it', files.every((f) => !/\/Users\/|@gmail|@yopmail/.test(readFileSync(join(SKILL, f), 'utf8'))))
  const named = [...text.matchAll(/`((?:references|examples|scripts)\/[A-Za-z0-9_./-]+)`/g)].map((m) => m[1].replace(/\/$/, ''))
  check('every file or folder SKILL.md names exists', named.length > 8 && named.every((p) => existsSync(join(SKILL, p))), named.filter((p) => !existsSync(join(SKILL, p))).join(', '))
  const cmds = [...text.matchAll(/model\.mjs"?\s+(doctor|setup|new|build|check|page|all)\b/g)].map((m) => m[1])
  const src = readFileSync(join(SKILL, 'scripts', 'model.mjs'), 'utf8')
  check('every subcommand SKILL.md tells to run is implemented', cmds.length >= 4 && cmds.every((c) => src.includes("cmd === '" + c + "'")), cmds.join())
  check('model-3d is in the list of skills the plugin seeds', /const KB_SHIPPED_SKILLS = \[[^\]]*'model-3d'/.test(readFileSync(join(HERE, 'index.js'), 'utf8')))
  check('the four examples each have a model.json with the keys the command reads', EXAMPLES.every((e) => { const j = JSON.parse(readFileSync(join(SKILL, 'examples', e, 'model.json'), 'utf8')); return Array.isArray(j.build) && Array.isArray(j.checks) && j.page && Array.isArray(j.page.examples) }))
}

console.log('the command')
{
  check('python versions are read', JSON.stringify(parsePyVersion('Python 3.12.3')) === '[3,12]' && parsePyVersion('nope') === null)
  check('3.11 is the floor', isNewEnough([3, 11]) && isNewEnough([3, 13]) && isNewEnough([4, 0]) && !isNewEnough([3, 10]) && !isNewEnough([3, 9]) && !isNewEnough(null))
  const d = join(root, 'refuse')
  mkdirSync(d)
  writeFileSync(join(d, 'ok.mjs'), 'process.stdout.write("")\n')
  writeFileSync(join(d, 'bad.mjs'), 'process.exit(7)\n')
  const model = (build) => writeFileSync(join(d, 'model.json'), JSON.stringify({ build, checks: build }))
  const out = []
  model(['sh -c "echo hi"'])
  check('a step that is not "py" or "node" is refused', runSteps(d, 'build', (t) => out.push(t)) === 1 && /refused step/.test(out.join()))
  model(['node ../../etc/passwd'])
  check('a script outside the folder is refused', runSteps(d, 'build', quiet) === 1)
  model(['node /etc/passwd'])
  check('an absolute script is refused', runSteps(d, 'build', quiet) === 1)
  model(['node missing.mjs'])
  check('a missing script is refused', runSteps(d, 'build', quiet) === 1)
  model(['node ok.mjs', 'node bad.mjs', 'node ok.mjs'])
  const log = []
  check('steps run in order and stop at the first failure, with its exit code', runSteps(d, 'build', (t) => log.push(t)) === 7 && log.filter((l) => l.startsWith('▶')).length === 2, log.join(' | '))
  model(['node ok.mjs'])
  check('a green list returns 0', runSteps(d, 'checks', quiet) === 0)

  for (const e of EXAMPLES) {
    const dir = join(root, 'new-' + e)
    const files = scaffold(dir, e)
    const py = files.some((f) => f.endsWith('.py'))
    check('new --from ' + e + ' copies a working folder' + (py ? ' with kbcad.py next to the scripts' : ''), files.includes('model.json') && files.includes('example.js') && (!py || files.includes('kbcad.py')), files.join())
  }
  let msg = ''
  try { scaffold(join(root, 'new-chair'), 'chair') } catch (e) { msg = e.message }
  check('new refuses a folder that is not empty', /not empty/.test(msg))
  msg = ''
  try { scaffold(join(root, 'x'), 'toaster') } catch (e) { msg = e.message }
  check('new refuses an unknown example', /unknown example/.test(msg))
}

console.log('a page, with no toolchain at all')
{
  const dir = join(root, 'new-chair')
  const file = writePage(dir, quiet)
  const html = readFileSync(file, 'utf8')
  check('the chair becomes one html file with no marker left and the viewport meta', existsSync(file) && !/\/\*@@[A-Z]+@@\*\//.test(html) && html.includes('name="viewport"'))
  check('with its title, its lede and its module, and no picker for a single example', html.includes('<title>Armchair configurator</title>') && html.includes('function chairExample()') && html.includes('const EXAMPLES = [chairExample()]') && html.includes('picker.hidden = EXAMPLES.length < 2'))
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1]
  writeFileSync(join(root, 'page.mjs'), script)
  const r = spawnSync(process.execPath, ['--check', join(root, 'page.mjs')], { encoding: 'utf8' })
  check('the page script parses', r.status === 0, (r.stderr || '').split('\n').slice(0, 3).join(' '))
  const m = JSON.parse(readFileSync(join(dir, 'model.json'), 'utf8'))
  m.page.title = 'A <b>&</b> B'
  writeFileSync(join(dir, 'model.json'), JSON.stringify(m))
  const escaped = buildPage(dir).html
  check('a title is escaped, not injected', escaped.includes('<title>A &lt;b&gt;&amp;&lt;/b&gt; B</title>') && !escaped.includes('<h1>A <b>'))
  m.page.strings = { hint: 'Girar', export: 'Exportar', exported: '{file} · {kb} KB listo', exportFailed: 'Fallo' }
  m.page.data = { NOTE: 'notes.json' }
  writeFileSync(join(dir, 'notes.json'), JSON.stringify({ text: '</script><b>boom</b>' }))
  writeFileSync(join(dir, 'model.json'), JSON.stringify(m))
  const words = buildPage(dir).html
  check('the words of the page can be set (hint, Export, messages)', words.includes('<span class="chip">Girar</span>') && words.includes('id="export" type="button">Exportar</button>') && words.includes('"exported":"{file} · {kb} KB listo"'))
  check('a value holding </script> cannot close the script early', !words.includes('</script><b>boom') && words.includes('<\\/script><b>boom'))
  const withoutStrings = (() => { const m2 = JSON.parse(readFileSync(join(dir, 'model.json'), 'utf8')); delete m2.page.strings; delete m2.page.data; writeFileSync(join(dir, 'model.json'), JSON.stringify(m2)); return buildPage(dir).html })()
  check('without strings the page stays in English', withoutStrings.includes('Drag to turn') && withoutStrings.includes('>Export .glb</button>'))
  const mod = join(dir, 'example.js')
  const good = readFileSync(mod, 'utf8')
  writeFileSync(mod, good + '\nfunction (\n')
  let e3 = ''
  try { writePage(dir, quiet) } catch (e) { e3 = e.message }
  writeFileSync(mod, good)
  check('a page module with a syntax error is refused by "page", with the error', /does not parse/.test(e3), e3.slice(0, 120))
  const m3 = JSON.parse(readFileSync(join(dir, 'model.json'), 'utf8'))
  m3.page.examples = []
  writeFileSync(join(dir, 'model.json'), JSON.stringify(m3))
  let e2 = ''
  try { buildPage(dir) } catch (e) { e2 = e.message }
  check('a page with no example is an error, not an empty page', /nothing to show/.test(e2))
}

console.log('the simulation of the engine example (pure node)')
{
  const r = spawnSync(process.execPath, ['test-engine-sim.mjs'], { cwd: join(SKILL, 'examples', 'engine'), encoding: 'utf8' })
  check('test-engine-sim.mjs passes', r.status === 0 && /checks passed/.test(r.stdout), (r.stdout + r.stderr).split('\n').slice(-3).join(' '))
}

console.log('a seeded copy is self-contained')
{
  const home = join(root, 'home')
  mkdirSync(home)
  const a = seedSkills({ home, sourceDir: SKILLS, names: ['model-3d'] })[0]
  const b = seedSkillFiles({ home, sourceDir: SKILLS, names: ['model-3d'] })[0]
  const want = allFiles(SKILL).length - 1
  check('SKILL.md and every file beside it land in <home>/skills/model-3d', a.action === 'created' && b.action === 'seeded' && b.counts.created === want, JSON.stringify([a, b]))
  const seeded = join(home, 'skills', 'model-3d')
  check('the seeded folder is the shipped folder, file for file', JSON.stringify(allFiles(seeded)) === JSON.stringify(allFiles(SKILL)))
  const r = spawnSync(process.execPath, [join(seeded, 'scripts', 'model.mjs'), 'new', join(root, 'from-seed'), '--from', 'chair'], { encoding: 'utf8', env: { ...process.env, DSH_HOME: home } })
  const r2 = spawnSync(process.execPath, [join(seeded, 'scripts', 'model.mjs'), 'page', join(root, 'from-seed')], { encoding: 'utf8', env: { ...process.env, DSH_HOME: home } })
  check('the command works from the seeded copy: new, then page', r.status === 0 && r2.status === 0 && existsSync(join(root, 'from-seed', 'model.html')), (r.stdout + r.stderr + r2.stdout + r2.stderr).slice(0, 300))
  const r3 = spawnSync(process.execPath, [join(seeded, 'scripts', 'model.mjs'), 'doctor'], { encoding: 'utf8', env: { ...process.env, DSH_HOME: home, KB3D_PYTHON: '' } })
  check('doctor says what is missing and exits 3 when there is no toolchain (or 0 when there is one)', (r3.status === 3 && /MISSING/.test(r3.stdout) && /need none of this/.test(r3.stdout)) || (r3.status === 0 && /build123d/.test(r3.stdout)), r3.stdout.slice(0, 300))
}

console.log('the blank example, with the CAD toolchain')
if (toolchainPython() === null) {
  console.log('SKIPPED: no CAD toolchain (run "node skills/model-3d/scripts/model.mjs setup --yes" to run this part)')
} else {
  const dir = join(root, 'new-blank')
  const t0 = Date.now()
  const code = runSteps(dir, 'build', quiet)
  check('build writes the .glb and the report', code === 0 && existsSync(join(dir, 'model.glb')) && existsSync(join(dir, 'model-report.json')))
  const rep = existsSync(join(dir, 'model-report.json')) ? JSON.parse(readFileSync(join(dir, 'model-report.json'), 'utf8')) : { parts: {}, total_mass_g: 0 }
  check('four parts, every one valid and closed, the mass from the volumes', Object.keys(rep.parts).length === 4 && Object.values(rep.parts).every((p) => p.valid && p.watertight) && Math.abs(rep.total_mass_g - 2244) < 20, String(rep.total_mass_g))
  const checks = spawnSync(toolchainPython(), ['test_model.py'], { cwd: dir, encoding: 'utf8' })
  check('its checks pass (fits, a negative control, masses)', checks.status === 0 && /checks passed/.test(checks.stdout), (checks.stdout + checks.stderr).slice(-300))
  // the checks can fail: push a leg into the seat in the model itself and the check must go red
  const py = readFileSync(join(dir, 'model.py'), 'utf8')
  writeFileSync(join(dir, 'model.py'), py.replace('cyl(LEG_R, 0, LEG_H, x, y)', 'cyl(LEG_R, 0, LEG_H + 20, x, y)'))
  const broken = spawnSync(toolchainPython(), ['test_model.py'], { cwd: dir, encoding: 'utf8' })
  writeFileSync(join(dir, 'model.py'), py)
  check('the same checks go red when the legs are made 20 mm too long (they go through the seat)', broken.status !== 0 && /share/.test(broken.stderr), (broken.stderr || '').slice(-200))
  const file = writePage(dir, quiet)
  check('the page is built and carries the model', existsSync(file) && statSync(file).size > 40000 && readFileSync(file, 'utf8').includes('partsExample'))
  console.log('    (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)')
}

rmSync(root, { recursive: true, force: true })
console.log(failed === 0 ? `\nall ${total} checks passed` : `\n${failed} of ${total} checks FAILED`)
process.exit(failed === 0 ? 0 : 1)
