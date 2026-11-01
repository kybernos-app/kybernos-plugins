#!/usr/bin/env node
// The one command of the model-3d skill. Plain node, no dependency.
//
//   node model.mjs doctor                      is the CAD toolchain there? (exit 0 ready, 3 not ready)
//   node model.mjs setup [--yes]               create the toolchain (a python venv, a few hundred MB); without --yes it only says what it would do
//   node model.mjs new <dir> [--from blank|chair|grinder|engine]   copy a working example into <dir>
//   node model.mjs build <dir>                 run the "build" steps of <dir>/model.json (they write the .glb and the reports)
//   node model.mjs check <dir>                 run the "checks" steps: the tests that decide whether the model is sound
//   node model.mjs page <dir>                  write the one-file html page of <dir> (page.out, default model.html)
//   node model.mjs all <dir>                   build, then check, then page: stops at the first red step
//
// A step of model.json is "py <script> [args]" (the toolchain's python) or "node <script> [args]", the script being a file of <dir>.
// Nothing else is run from a json file.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPage } from './kit/build-page.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
export const SKILL_DIR = resolve(HERE, '..')
export const PACKAGES = ['build123d', 'trimesh', 'numpy', 'rtree', 'fast-simplification']
export const EXAMPLES = ['blank', 'chair', 'grinder', 'engine']
const WIN = process.platform === 'win32'

export const dshHome = () => process.env.DSH_HOME || join(homedir(), '.dsh')
export const venvDir = () => join(dshHome(), 'kybernos', '3d-tools', '.venv')
const venvPython = () => join(venvDir(), WIN ? 'Scripts' : 'bin', WIN ? 'python.exe' : 'python')

/** "Python 3.12.3" → [3, 12]; null when it is not a version line. */
export const parsePyVersion = (text) => { const m = /Python\s+(\d+)\.(\d+)/.exec(String(text)); return m ? [Number(m[1]), Number(m[2])] : null }
export const isNewEnough = (v) => v !== null && (v[0] > 3 || (v[0] === 3 && v[1] >= 11))

/** The python of the toolchain: KB3D_PYTHON (a test or a person who has their own), else the venv `setup` made; null when none. */
export const toolchainPython = () => {
  const own = process.env.KB3D_PYTHON
  if (own && existsSync(own)) return own
  return existsSync(venvPython()) ? venvPython() : null
}

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts })

/** A system python 3.11 or newer, to make the venv from; { cmd, version } or null. */
export const findSystemPython = () => {
  for (const cmd of ['python3.13', 'python3.12', 'python3.11', 'python3', 'python']) {
    const r = run(cmd, ['--version'])
    const v = r.status === 0 ? parsePyVersion(r.stdout + r.stderr) : null
    if (isNewEnough(v)) return { cmd, version: v.join('.') }
  }
  return null
}

/** Prints what is there and what is missing; returns 0 when the CAD toolchain can run, 3 when it cannot. */
export const doctor = (log = console.log) => {
  const py = toolchainPython()
  let ready = false
  if (py === null) {
    log('MISSING  the CAD toolchain is not set up (looked for ' + venvPython() + ')')
  } else {
    const r = run(py, ['-c', 'import build123d, trimesh, numpy, sys; print(sys.version.split()[0], build123d.__version__, trimesh.__version__, numpy.__version__)'])
    if (r.status === 0) {
      const [pv, bv, tv, nv] = r.stdout.trim().split(/\s+/)
      log(`ok       toolchain python ${pv} (${py})`)
      log(`ok       build123d ${bv}, trimesh ${tv}, numpy ${nv}`)
      ready = true
    } else {
      log('MISSING  the python at ' + py + ' cannot import build123d, trimesh and numpy: ' + (r.stderr || '').trim().split('\n').pop())
    }
  }
  if (!ready) {
    const sys = findSystemPython()
    if (sys) log(`         a python ${sys.version} is available (${sys.cmd}): "node model.mjs setup --yes" builds the toolchain from it`)
    else log('         no python 3.11 or newer was found: install one first (macOS: brew install python@3.12), then "node model.mjs setup --yes"')
    log('         pages made of simple shapes (the chair example) need none of this')
  }
  log(`ok       node ${process.versions.node}`)
  return ready ? 0 : 3
}

/** Makes the toolchain. Without `yes` it only says what it would do and returns 2. */
export const setup = ({ yes = false } = {}, log = console.log) => {
  const sys = findSystemPython()
  if (sys === null) { log('no python 3.11 or newer was found: install one first (macOS: brew install python@3.12), then run setup again'); return 1 }
  log(`The toolchain is a python virtual environment at ${venvDir()}, made from python ${sys.version} (${sys.cmd}).`)
  log('It installs: ' + PACKAGES.join(', ') + ' (a CAD kernel and mesh tools: several hundred MB to download, a few minutes).')
  if (!yes) { log('Nothing was done. Ask the person, then run: node model.mjs setup --yes'); return 2 }
  mkdirSync(join(venvDir(), '..'), { recursive: true })
  if (!existsSync(venvPython())) {
    const r = run(sys.cmd, ['-m', 'venv', venvDir()], { stdio: 'inherit' })
    if (r.status !== 0) { log('could not create the virtual environment'); return 1 }
  }
  const r = run(venvPython(), ['-m', 'pip', 'install', '--disable-pip-version-check', ...PACKAGES], { stdio: 'inherit' })
  if (r.status !== 0) { log('pip could not install the packages (network? disk space?): nothing else is changed'); return 1 }
  return doctor(log)
}

/** Copies the example `from` into `dir` (which must be absent or empty); adds kbcad.py when the example has python. @returns the files written */
export const scaffold = (dir, from = 'blank') => {
  if (!EXAMPLES.includes(from)) throw new Error('unknown example "' + from + '": one of ' + EXAMPLES.join(', '))
  const target = resolve(dir)
  if (existsSync(target) && readdirSync(target).length > 0) throw new Error(dir + ' already exists and is not empty')
  mkdirSync(target, { recursive: true })
  cpSync(join(SKILL_DIR, 'examples', from), target, { recursive: true })
  if (readdirSync(target).some((f) => f.endsWith('.py'))) cpSync(join(HERE, 'kit', 'kbcad.py'), join(target, 'kbcad.py'))
  return readdirSync(target).sort()
}

const readModel = (dir) => {
  const file = join(resolve(dir), 'model.json')
  if (!existsSync(file)) throw new Error(file + ' is missing: start from "node model.mjs new <dir>"')
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** Runs the steps of one list ("build" or "checks") of <dir>/model.json, stopping at the first one that fails. @returns the exit code */
export const runSteps = (dir, key, log = console.log) => {
  const root = resolve(dir)
  const steps = readModel(dir)[key]
  if (!Array.isArray(steps)) { log('model.json has no "' + key + '" list'); return key === 'build' ? 0 : 1 }
  for (const step of steps) {
    const [kind, script, ...args] = String(step).trim().split(/\s+/)
    const rel = script === undefined ? '' : relative(root, resolve(root, script))
    if ((kind !== 'py' && kind !== 'node') || rel === '' || rel.startsWith('..') || isAbsolute(rel) || !existsSync(join(root, rel))) {
      log('refused step "' + step + '": a step is "py <script>" or "node <script>", the script being a file of ' + dir); return 1
    }
    let cmd = process.execPath
    if (kind === 'py') {
      cmd = toolchainPython()
      if (cmd === null) { log('the CAD toolchain is not set up: run "node model.mjs doctor"'); return 3 }
    }
    log('▶ ' + step)
    const r = spawnSync(cmd, [rel, ...args], { cwd: root, stdio: 'inherit' })
    if (r.status !== 0) { log('✗ ' + step + ' failed (exit ' + (r.status === null ? 'signal ' + r.signal : r.status) + ')'); return r.status || 1 }
  }
  return 0
}

/** The syntax error of the page's script, or '' when it parses (it cannot tell that the page renders: only a browser can). */
export const pageScriptError = (html) => {
  const m = /<script type="module">([\s\S]*?)<\/script>/.exec(html)
  if (m === null) return 'the page has no module script'
  const tmp = mkdtempSync(join(tmpdir(), 'kb-page-'))
  try {
    writeFileSync(join(tmp, 'page.mjs'), m[1])
    const r = run(process.execPath, ['--check', join(tmp, 'page.mjs')])
    return r.status === 0 ? '' : String(r.stderr || 'syntax error').split('\n').slice(0, 6).join('\n')
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

/** Writes the page of <dir>. @returns the path written */
export const writePage = (dir, log = console.log) => {
  const model = readModel(dir)
  const { html, bytes } = buildPage(dir)
  const bad = pageScriptError(html)
  if (bad !== '') throw new Error('the page script does not parse (a page module has a syntax error):\n' + bad)
  const out = join(resolve(dir), (model.page && model.page.out) || 'model.html')
  writeFileSync(out, html)
  log(`page written: ${out} (${(bytes / 1048576).toFixed(1)} MB, its script parses; only a browser can show that it renders)${bytes > 12 * 1048576 ? ' - over 12 MB: too heavy to publish as an Artifact (16 MB), simplify the meshes' : ''}`)
  return out
}

const main = (argv) => {
  const [cmd, dir] = argv
  const flag = (n) => argv.includes('--' + n)
  const value = (n) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : undefined }
  try {
    if (cmd === 'doctor') return doctor()
    if (cmd === 'setup') return setup({ yes: flag('yes') })
    if (dir === undefined || dir.startsWith('--')) { console.log('usage: node model.mjs doctor | setup [--yes] | new <dir> [--from ' + EXAMPLES.join('|') + '] | build <dir> | check <dir> | page <dir> | all <dir>'); return 1 }
    if (cmd === 'new') {
      const files = scaffold(dir, value('from') || 'blank')
      console.log('created ' + resolve(dir) + ': ' + files.join(', '))
      console.log('next: node ' + fileURLToPath(import.meta.url) + ' all ' + dir)
      return 0
    }
    if (cmd === 'build') return runSteps(dir, 'build')
    if (cmd === 'check') return runSteps(dir, 'checks')
    if (cmd === 'page') { writePage(dir); return 0 }
    if (cmd === 'all') {
      let code = runSteps(dir, 'build')
      if (code === 0) code = runSteps(dir, 'checks')
      if (code === 0) writePage(dir)
      return code
    }
    console.log('unknown command "' + cmd + '"'); return 1
  } catch (e) {
    console.log('error: ' + (e && e.message ? e.message : String(e)))
    return 1
  }
}

// run as a command, not when a test imports it; compared by real path (a home or a temp folder reached through a symlink must still run)
const realOf = (p) => { try { return realpathSync(p) } catch (e) { return p } }
if (process.argv[1] && realOf(process.argv[1]) === realOf(fileURLToPath(import.meta.url))) process.exit(main(process.argv.slice(2)))
