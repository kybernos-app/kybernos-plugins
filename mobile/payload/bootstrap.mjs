// The first thing an embedded Node runs in the phone app. The host (Swift or Kotlin) starts Node on this file with --expose-internals and passes its folders by environment:
//   KB_PAYLOAD    the kbpack file shipped in the app            KB_MANIFEST   its payload.json (the sha256 names the unpacked folder)
//   KB_ROOT       a writable folder for the unpacked runtime    KB_HOME       the app's data folder (HOME; DSH_HOME is KB_HOME/.dsh)
//   KB_WORKSPACE  the working directory of the agent (optional) KB_PORT       the port of the web server (default 0: the system picks)
// It unpacks the payload once per version (atomically), seeds the phone profile, installs the shims and hands over to the engine's own launcher.
// Progress goes to KB_ROOT/status.json so the host can show a first-launch screen: { phase, done, total }.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { unpack } from './kbpack.mjs'
import { seedClaudeProvider } from './provider-seed.mjs'

const env = process.env
for (const k of ['KB_PAYLOAD', 'KB_MANIFEST', 'KB_ROOT', 'KB_HOME']) if (!env[k]) { console.error('kybernos bootstrap: ' + k + ' is not set'); process.exit(2) }
const manifest = JSON.parse(readFileSync(env.KB_MANIFEST, 'utf8'))
const version = String(manifest.sha256).slice(0, 16)
const dest = join(env.KB_ROOT, version)
mkdirSync(env.KB_ROOT, { recursive: true })
const status = (o) => { try { writeFileSync(join(env.KB_ROOT, 'status.json'), JSON.stringify({ at: Date.now(), version, ...o })) } catch { /* the host only shows it */ } }

// 1. The data folder and the phone profile. It is called `web`, like the shipped one: several of our plugins look for profiles/web by name. Its node_modules must really live
//    inside the profile folder: the engine finds the packages a profile does not carry (its own core) by the profile's location, and a link elsewhere hides it.
process.env.HOME = env.KB_HOME
const dshHome = join(env.KB_HOME, '.dsh')
process.env.DSH_HOME = dshHome
process.env.KB_RUNTIME = dest // the unpacked runtime: the engine's plugins read THIRD-PARTY-NOTICES.txt from it
const profile = join(dshHome, 'profiles', 'web')
const profileModules = join(profile, 'node_modules')
const marker = join(profile, '.payload')

// 2. unpack once per payload version, atomically: the runtime into KB_ROOT/<version>, the profile's packages into the profile; a half-done unpack is never taken for a finished one
const installed = existsSync(join(dest, '.ready')) && existsSync(marker) && readFileSync(marker, 'utf8') === version && existsSync(profileModules)
if (!installed) {
  status({ phase: 'unpacking', done: 0, total: manifest.files })
  const tmp = dest + '.tmp'
  const modulesNew = profileModules + '.new'
  rmSync(tmp, { recursive: true, force: true }); rmSync(modulesNew, { recursive: true, force: true })
  mkdirSync(profile, { recursive: true })
  let last = 0
  const PM = 'profile/node_modules/'
  await unpack(env.KB_PAYLOAD, tmp, {
    place: (p) => (p.startsWith(PM) ? join(modulesNew, p.slice(PM.length)) : undefined),
    onProgress: (done, total) => { if (done - last >= 500 || done === total) { last = done; status({ phase: 'unpacking', done, total }) } },
  })
  writeFileSync(join(tmp, '.ready'), JSON.stringify({ engine: manifest.engine, sha256: manifest.sha256 }))
  rmSync(dest, { recursive: true, force: true })
  renameSync(tmp, dest)
  rmSync(profileModules, { recursive: true, force: true })
  renameSync(modulesNew, profileModules)
  for (const f of ['package.json', 'cordis.yml']) cpSync(join(dest, 'profile', f), join(profile, f))
  // cordis.patch.yml is the user's layer: seeded once, never overwritten
  if (!existsSync(join(profile, 'cordis.patch.yml'))) cpSync(join(dest, 'profile', 'cordis.patch.yml'), join(profile, 'cordis.patch.yml'))
  writeFileSync(marker, version)
  for (const e of readdirSync(env.KB_ROOT)) if (e !== version && /^[0-9a-f]{16}(\.tmp)?$/.test(e)) rmSync(join(env.KB_ROOT, e), { recursive: true, force: true })
}
// 2b. the app holds a model key (device secure storage, handed over as ANTHROPIC_API_KEY): make sure an empty user layer names the Claude provider
seedClaudeProvider({ patchFile: join(profile, 'cordis.patch.yml'), env })
if (env.KB_WORKSPACE) { mkdirSync(env.KB_WORKSPACE, { recursive: true }); process.chdir(env.KB_WORKSPACE) }

// 3. shims, then the engine's launcher: its arguments are the process arguments after the first two
status({ phase: 'starting' })
await import(pathToFileURL(join(dest, 'shims', 'preload.mjs')).href)
const bin = join(dest, 'engine', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
process.argv = [process.argv[0], bin, '--profile', 'web', '--host', '127.0.0.1', '--port', env.KB_PORT ?? '0', '--no-open']
const { runCli } = await import(pathToFileURL(bin).href)
await runCli()
