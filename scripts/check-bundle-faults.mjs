#!/usr/bin/env node
// Bundle fault injection: break ONE bundle at a time in a throw-away copy of the sandbox profile and check what DSH does.
//
//   node scripts/check-bundle-faults.mjs [--only kybernos-atlas,dsh-mermaid] [--faults syntax,throw-apply] [--gui] [--port 3097]
//
// The guarantee under test (AGENTS.md rule 2): a bundle must never stop DSH from starting. For every bundle of packages/ (and each
// of the four dsh-subagent-maison providers) the script injects, in a copy of the tree, one of
//   syntax         a syntax error at the end of the entry file
//   throw-import   a throw when the module is loaded
//   throw-apply    a throw at the start of apply(ctx)
//   missing-dep    an import of a package that is not installed
//   no-main        the entry file is gone
//   bad-package    package.json cut in half (invalid JSON)
//   no-package     package.json is gone
//   tla-hang       a top-level `await` that never resolves        (DSH engine: the web banner is never printed; the GUI is up)
// and, with --gui, one of the browser-side faults (client.js with a syntax error, a throw at load, or missing). Then it starts
// the sandbox DSH and reports: did it start, did every OTHER bundle mount its routes, were the broken bundle's routes the only ones
// lost, does the log say which entry failed, and (--gui) does the page still render.
//
// Known, by design of the engine and not fixable from a bundle: any broken client.js replaces the whole GUI with
// « Failed to load plugins », and a host half that never finishes loading keeps the « dsh web: http… » banner from being printed.
// The script reports both and fails only on what a bundle CAN prevent.
//
// It uses the isolated sandbox only (scripts/sandbox: own HOME and DSH_HOME, never :3080), clones nothing of the user's credentials,
// and it is NOT named test-*.mjs: it starts a real DSH, which a CI runner does not have (see docs/dev/live-testing.md).
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { cookieDeSession } from './cdp-lib.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d }
const ONLY = arg('only', '') ? arg('only').split(',') : null
const HOST_FAULTS = arg('faults', 'syntax,throw-import,throw-apply,missing-dep,no-main,bad-package,no-package,tla-hang').split(',')
const CLIENT_FAULTS = ['c-syntax', 'c-throw', 'c-missing']
const GUI = process.argv.includes('--gui')
const PORT = Number(arg('port', 3097))
const ROOT = resolve(arg('root', join(homedir(), '.kybernos-sandbox', 'bundle-faults')))
const START_MS = Number(arg('start-timeout', 45)) * 1000
if (PORT === 3080) { console.error('refusing: 3080 is the real DSH'); process.exit(3) }

const TREE = join(ROOT, 'tree', 'packages')
const PRISTINE = join(ROOT, 'pristine', 'packages')
const SB = join(ROOT, 'sb')
const DSH_HOME = join(SB, 'home', '.dsh')
const LOG = join(SB, 'faults.log')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── the lab ────────────────────────────────────────────────────────────────
const buildLab = () => {
  mkdirSync(ROOT, { recursive: true })
  rmSync(join(ROOT, 'pristine'), { recursive: true, force: true })
  rmSync(join(ROOT, 'tree'), { recursive: true, force: true })
  mkdirSync(join(ROOT, 'pristine'), { recursive: true })
  cpSync(join(REPO, 'packages'), PRISTINE, { recursive: true })
  cpSync(PRISTINE, TREE, { recursive: true })
  const env = { ...process.env, KB_WORKTREE: join(ROOT, 'tree'), KB_SANDBOX_ROOT: SB, KB_SANDBOX_PORT: String(PORT) }
  execFileSync('bash', [join(REPO, 'scripts', 'sandbox', 'setup.sh')], { env, stdio: ['ignore', 'pipe', 'inherit'] })
  // The maison providers are not @local links: the clone of the user's profile points them at the user's own checkout. Point them at the copy.
  const profile = join(DSH_HOME, 'profiles', 'web', 'node_modules')
  const maison = join(TREE, 'dsh-subagent-maison')
  if (existsSync(maison)) {
    for (const d of readdirSync(maison)) {
      if (!d.startsWith('dsh-subagent-') || !existsSync(join(maison, d, 'package.json'))) continue
      rmSync(join(profile, d), { recursive: true, force: true })
      symlinkSync(join(maison, d), join(profile, d))
    }
  }
}

const listBundles = () => {
  const out = []
  for (const d of readdirSync(PRISTINE)) {
    if (d === 'messaging') continue // a standalone daemon, DSH never loads it
    if (d === 'dsh-subagent-maison') { for (const s of readdirSync(join(PRISTINE, d))) if (existsSync(join(PRISTINE, d, s, 'package.json'))) out.push(d + '/' + s); continue }
    if (existsSync(join(PRISTINE, d, 'package.json'))) out.push(d)
  }
  return out
}
const restore = (b) => { rmSync(join(TREE, b), { recursive: true, force: true }); cpSync(join(PRISTINE, b), join(TREE, b), { recursive: true }) }
const pkgOf = (b) => { try { return JSON.parse(readFileSync(join(PRISTINE, b, 'package.json'), 'utf8')) } catch (e) { return {} } }
const entryOf = (b) => (typeof pkgOf(b).main === 'string' ? pkgOf(b).main : 'index.js')
const clientOf = (b) => {
  const c = pkgOf(b).exports && pkgOf(b).exports['./client']
  if (typeof c === 'string') return c.replace(/^\.\//, '')
  return existsSync(join(PRISTINE, b, 'client.js')) ? 'client.js' : null
}
const APPLY_RE = /export\s+(?:async\s+)?function\s+apply\s*\([^)]*\)\s*\{/

const inject = (b, fault) => {
  const dir = join(TREE, b)
  const entry = join(dir, entryOf(b))
  const src = existsSync(entry) ? readFileSync(entry, 'utf8') : ''
  switch (fault) {
    case 'syntax': writeFileSync(entry, src + '\n}}} // injected syntax error\n'); return true
    case 'throw-import': writeFileSync(entry, "throw new Error('INJECTED import failure')\n" + src); return true
    case 'throw-apply': writeFileSync(entry, APPLY_RE.test(src) ? src.replace(APPLY_RE, (m) => m + "\n  throw new Error('INJECTED apply failure')\n") : src + "\nthrow new Error('INJECTED apply failure')\n"); return true
    case 'missing-dep': writeFileSync(entry, "import 'kybernos-fault-injection-missing-dependency'\n" + src); return true
    case 'no-main': rmSync(entry, { force: true }); return true
    case 'bad-package': { const t = readFileSync(join(dir, 'package.json'), 'utf8'); writeFileSync(join(dir, 'package.json'), t.slice(0, Math.floor(t.length / 2))); return true }
    case 'no-package': rmSync(join(dir, 'package.json'), { force: true }); return true
    case 'tla-hang': writeFileSync(entry, src + '\nawait new Promise(() => {})\n'); return true
    case 'c-syntax': { const c = clientOf(b); if (!c) return false; writeFileSync(join(dir, c), readFileSync(join(dir, c), 'utf8') + '\n}}} // injected\n'); return true }
    case 'c-throw': { const c = clientOf(b); if (!c) return false; writeFileSync(join(dir, c), "throw new Error('INJECTED client failure')\n" + readFileSync(join(dir, c), 'utf8')); return true }
    case 'c-missing': { const c = clientOf(b); if (!c) return false; rmSync(join(dir, c), { force: true }); return true }
    default: throw new Error('unknown fault ' + fault)
  }
}

// ── the DSH under test ─────────────────────────────────────────────────────
let child = null
const startDsh = async () => {
  writeFileSync(LOG, '', { mode: 0o600 })
  const fd = openSync(LOG, 'a', 0o600)
  const t0 = Date.now()
  child = spawn('dsh', ['--profile', 'web', '--host', '127.0.0.1', '--port', String(PORT), '--no-open'], {
    env: { ...process.env, HOME: join(SB, 'home'), DSH_HOME, DSH_WEB_PORT: String(PORT) }, detached: true, stdio: ['ignore', fd, fd]
  })
  closeSync(fd)
  let exited = null
  child.on('exit', (code, signal) => { exited = { code, signal } })
  child.on('error', (e) => { exited = { error: String(e.message) } })
  while (Date.now() - t0 < START_MS) {
    if (exited) return { ready: false, exited, ms: Date.now() - t0 }
    if (/^dsh web: http/m.test(readFileSync(LOG, 'utf8'))) return { ready: true, ms: Date.now() - t0 }
    await sleep(250)
  }
  // The banner is the last thing DSH prints, after every entry loaded: is the server up anyway?
  let answers = false
  try { answers = (await fetch('http://127.0.0.1:' + PORT + '/', { signal: AbortSignal.timeout(2000) })).status > 0 } catch (e) { answers = false }
  return { ready: false, timeout: true, serverAnswers: answers, ms: Date.now() - t0 }
}
const stopDsh = async () => {
  if (!child) return
  const pid = child.pid
  try { process.kill(-pid, 'SIGTERM') } catch (e) { /* gone */ }
  for (let i = 0; i < 24; i++) { try { process.kill(pid, 0) } catch (e) { break } await sleep(250) }
  try { process.kill(-pid, 'SIGKILL') } catch (e) { /* gone */ }
  await sleep(300)
  child = null
}
const readLog = () => { try { return readFileSync(LOG, 'utf8') } catch (e) { return '' } }
const norm = (l) => l.replace(/\/Users\/[^\s'")\]]+/g, '<path>').replace(/\d+/g, '#').trim()
const tagged = (log) => new Set(log.split('\n').filter((l) => /^\[[a-z0-9-]+\] /i.test(l)).map(norm))

// A signed request to a host route (the sandbox's own session cookie, never printed).
const get = async (path) => {
  const session = cookieDeSession('127.0.0.1:' + PORT)
  if (session === null) return 0
  try { return (await fetch('http://127.0.0.1:' + PORT + path, { headers: { cookie: session.nom + '=' + session.valeur }, signal: AbortSignal.timeout(8000) })).status } catch (e) { return 0 }
}
const PROBES = ['/kybernos-cloud/status', '/kybernos-hub/suite', '/kybernos-auto/state', '/kybernos-sessions/state', '/kybernos-skills/catalogue', '/kybernos-memory/state',
  '/kybernos-workers/state', '/kybernos-call/state', '/kybernos-slash/status', '/kybernos-bricks/state', '/kybernos-slides/state', '/kybernos-modeleur/state',
  '/dsh-db-viewer/bases', '/kybernos-miniapps/list', '/kybernos-computers/status', '/kybernos/state', '/kybernos-composio/status', '/kybernos-flow/state']
const probeRoutes = async () => { const o = {}; await Promise.all(PROBES.map(async (p) => { o[p] = await get(p) })); return o }

let livePage = null
const guiText = async () => {
  const { openLivePage } = await import('./live-page.mjs')
  try {
    const live = await openLivePage({ authority: '127.0.0.1:' + PORT })
    await sleep(2500)
    const t = (await live.page.evalJs('document.body.innerText.slice(0, 300)', 5000)).val || ''
    await live.close()
    return { ok: true, text: String(t).replace(/\s+/g, ' ') }
  } catch (e) { return { ok: false, error: String(e.message).slice(0, 160) } }
}

// ── run ────────────────────────────────────────────────────────────────────
const failures = []
const note = (line) => console.log(line)
buildLab()
process.env.DSH_HOME = DSH_HOME // cdp-lib reads the session secret from there (set after the lab is built: setup.sh needs the real HOME)
process.env.HOME = join(SB, 'home')
for (const b of listBundles()) restore(b)

// A first launch writes things once (skills, the AGENTS.md block): warm up, then take the baseline of a quiet launch.
{ const w = await startDsh(); await sleep(1500); await stopDsh(); if (!w.ready) { console.error('the unmodified tree did not start: ' + JSON.stringify(w)); process.exit(2) } }
const base = await startDsh()
if (!base.ready) { console.error('baseline did not start: ' + JSON.stringify(base)); process.exit(2) }
await sleep(2500)
const BASE = tagged(readLog())
const BASE_ROUTES = await probeRoutes()
const baseGui = GUI ? await guiText() : null
await stopDsh()
note(`baseline: started in ${base.ms} ms, ${BASE.size} boot-log lines, ${Object.values(BASE_ROUTES).filter((s) => s === 200).length}/${PROBES.length} probe routes answer 200${baseGui ? ', GUI ' + (baseGui.ok ? 'renders' : 'FAILS: ' + baseGui.error) : ''}`)

const bundles = listBundles().filter((b) => ONLY === null || ONLY.some((o) => b === o || b.startsWith(o)))
for (const b of bundles) {
  for (const f of HOST_FAULTS) {
    restore(b); inject(b, f)
    const s = await startDsh()
    const row = { bundle: b, fault: f, ready: s.ready }
    if (f === 'tla-hang') {
      // Engine behaviour: reported, never a failure of the bundle. What matters: the process is alive and the server answers.
      note(`${b} / ${f}: banner ${s.ready ? 'printed' : 'not printed'}, server ${s.ready || s.serverAnswers ? 'answers' : 'DOES NOT ANSWER'} (${s.ms} ms)`)
      if (!s.ready && s.serverAnswers !== true) failures.push(`${b} / ${f}: DSH does not answer`)
      await stopDsh(); restore(b); continue
    }
    if (!s.ready) { failures.push(`${b} / ${f}: DSH did not start ${JSON.stringify(s.exited || { timeout: true })}`); note(`${b} / ${f}: NOT STARTED ${JSON.stringify(s.exited || 'timeout')}`); await stopDsh(); restore(b); continue }
    await sleep(2500)
    const log = readLog()
    const lost = [...BASE].filter((l) => !tagged(log).has(l))
    const tag = b.split('/').pop().replace(/^(kybernos|dsh)-/, '')
    const lostOther = lost.filter((l) => !((/^\[([a-z0-9-]+)\]/i.exec(l) || [])[1] || '').includes(tag))
    const routes = await probeRoutes()
    const routesLost = Object.entries(BASE_ROUTES).filter(([p, st]) => st === 200 && routes[p] !== 200).map(([p]) => p)
    const named = log.includes(b.split('/').pop()) && /INJECTED|Cannot find|SyntaxError|ERR_|Unexpected|did not activate|failed/i.test(log)
    const gui = GUI ? await guiText() : null
    // Routes of another bundle that vanished because of THIS bundle are a failure; the broken one's own are expected.
    const foreign = routesLost.filter((p) => !p.slice(1).startsWith(b.split('/').pop().replace(/^kybernos-plugin$/, 'kybernos')))
    row.lostOther = lostOther.length; row.routesLost = routesLost.length
    note(`${b} / ${f}: started in ${s.ms} ms, other bundles' boot lines lost ${lostOther.length}, own routes lost ${routesLost.length - foreign.length}, foreign routes lost ${foreign.length}, failure named in the log ${named ? 'yes' : 'NO'}${gui ? ', GUI ' + (gui.ok && !/Failed to load plugins/.test(gui.text) ? 'renders' : 'BROKEN') : ''}`)
    if (lostOther.length > 0) failures.push(`${b} / ${f}: other bundles lost boot lines: ${lostOther.slice(0, 3).join(' | ')}`)
    if (foreign.length > 0) failures.push(`${b} / ${f}: routes of other bundles lost: ${foreign.join(', ')}`)
    if (!named) failures.push(`${b} / ${f}: the failure is not visible in the log`)
    if (gui && (!gui.ok || /Failed to load plugins/.test(gui.text))) failures.push(`${b} / ${f}: a host-half fault broke the GUI`)
    await stopDsh(); restore(b)
  }
  if (GUI && clientOf(b)) {
    restore(b)
    const s = await startDsh()
    if (!s.ready) { failures.push(`${b}: DSH did not start for the client faults`); await stopDsh(); continue }
    await sleep(2000)
    for (const f of CLIENT_FAULTS) {
      restore(b); inject(b, f); await sleep(1200) // the client HMR polls every 500 ms
      const gui = await guiText()
      const broken = !gui.ok || /Failed to load plugins/.test(gui.text)
      note(`${b} / ${f}: GUI ${broken ? 'replaced by the engine\'s « Failed to load plugins » screen (engine behaviour)' : 'still renders'}`)
      restore(b)
    }
    await stopDsh()
  }
}
if (failures.length > 0) { console.log('\nFAILURES (' + failures.length + '):'); for (const f of failures) console.log('  ✗ ' + f); process.exit(1) }
console.log('\nall good: no bundle fault stopped DSH from starting or took another bundle down')
process.exit(0)
