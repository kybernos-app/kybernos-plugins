// ═══════════════════════════════════════════════════════════════════════════
// Tests for kybernos-composio: HOST half.
//
//   node test-host.mjs
//
// Covers the custom-connectors route (K-01 hostile cases, H-09 YAML injection), what
// that route writes to ~/.dsh/.env, ~/.dsh/kybernos/connecteurs.json and
// cordis.patch.yml, and the connections routes. All writes go to a temp HOME;
// the DSH engine of the machine, when there is one, is only read.
// ═══════════════════════════════════════════════════════════════════════════

import { apply, upsertEnvSecret, isBootstrapOnlyName, resolveDshHome, envTextWith, TIMEOUTS, splitArgs } from './index.js'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, symlinkSync, statSync, chmodSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

let echecs = 0
const ok = (label, cond, detail) => {
  if (cond) console.log(`✓ ${label}${detail === undefined ? '' : ` (${detail})`}`)
  else { console.error(`✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`); echecs += 1 }
}

// The real DSH home of the person running the tests. It is only ever READ (to find the
// DSH engine, see below); every write goes to the temp HOME that follows.
const REAL_HOME = homedir()
// A DSH_HOME in the caller's environment would send the writes to a real home.
delete process.env.DSH_HOME
// Fake home so ~/.dsh of the machine is never touched. The module reads homedir() at
// call time, so setting HOME after the import is enough.
const HOME = mkdtempSync(join(tmpdir(), 'kb-composio-test-'))
process.env.HOME = HOME

// ── the DSH engine, when this machine has one (read only) ───────────────────
// DSH's own boot code is the judge of what we write: loadLayeredEnv refuses the .env
// names that only the launching environment may set, and loadOverlayPatches parses
// cordis.patch.yml and "fails loud". Both run on the files our routes produced. CI has
// no engine: those checks are then reported as skipped, and the engine-free checks
// still run.
const engineDirs = () => {
  const found = []
  const root = join(REAL_HOME, '.dsh', 'kybernos', 'moteur')
  try {
    for (const v of readdirSync(root).sort().reverse()) found.push(join(root, v, 'node_modules'))
  } catch (e) { /* no engine here */ }
  found.push('/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules')
  return found.filter((d) => existsSync(join(d, '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')))
}
// NO_DSH_ENGINE=1 plays what CI sees (no engine), to check that path on a machine that has one.
const ENGINE = process.env.NO_DSH_ENGINE === '1' ? null : (engineDirs()[0] || null)
const dshBoot = ENGINE === null ? null : await import(join(ENGINE, '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js'))
const yaml = ENGINE === null ? null : createRequire(join(ENGINE, '@deepseek-ai', 'dsh-app-boot', 'package.json'))('js-yaml')
console.log(ENGINE === null ? '(no DSH engine found: the checks that run DSH\'s own loaders are skipped)' : '(DSH engine used as the judge: ' + ENGINE.replace(REAL_HOME, '~') + ')')
const skipped = (label) => console.log(`- skipped, no DSH engine: ${label}`)

const routes = {}
const ctx = {
  get: (nom) => (nom === 'webServer' ? { register: (r) => { routes[r.path] = r.handler } } : undefined),
  effect: (fn) => fn(),
  inject: (_noms, fn) => fn(),
  logger: { info: () => {} },
}
apply(ctx)

ok('connectors route mounted', typeof routes['/kybernos/composio/connecteurs'] === 'function')

const requete = (headers, corps) => ({
  method: 'POST',
  headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
  socket: { localPort: 3080 },
  url: '/kybernos/composio/connecteurs',
  on: (ev, fn) => {
    if (ev === 'data') fn(JSON.stringify(corps))
    if (ev === 'end') setTimeout(() => fn(), 0)
  },
})
const reponse = () => {
  const r = { code: null, corps: '' }
  r.setHeader = () => {}
  r.writeHead = (c) => { r.code = c }
  r.end = (b) => { r.corps = String(b) }
  return r
}
const jouer = async (headers, corps) => { const res = reponse(); await routes['/kybernos/composio/connecteurs'](requete(headers, corps), res); return res }

// ── K-01: hostile origin ────────────────────────────────────────────────────
{
  const res = await jouer({ origin: 'http://evil.example' }, { nom: 'poc', transport: 'stdio', command: '/usr/bin/touch' })
  ok('K-01: POST connectors with a hostile origin -> 403', res.code === 403, `code=${res.code} ${res.corps.slice(0, 40)}`)
}
{
  const res = await jouer({ origin: 'http://127.0.0.1.evil.example:3080' }, { nom: 'poc', transport: 'stdio', command: '/usr/bin/touch' })
  ok('K-01: an origin that only starts like the real one -> 403', res.code === 403, `code=${res.code}`)
}
// ── K-01: non-JSON Content-Type ─────────────────────────────────────────────
{
  const res = await jouer({ 'content-type': 'text/plain' }, { nom: 'poc', transport: 'stdio', command: '/usr/bin/touch' })
  ok('K-01: POST text/plain -> 415', res.code === 415, `code=${res.code}`)
}
// ── K-01: stdio command outside the system roots ────────────────────────────
{
  const res = await jouer({}, { nom: 'poc', transport: 'stdio', command: '/tmp/definitely-not-system' })
  ok('K-01: a command outside the system roots -> 400', res.code === 400 && res.corps.includes('executable file'), res.corps.slice(0, 70))
}
{
  const res = await jouer({}, { nom: 'poc', transport: 'stdio', command: '/usr/bin/i-do-not-exist' })
  ok('K-01: a command that does not exist -> 400', res.code === 400, `code=${res.code}`)
}
{
  const res = await jouer({}, { nom: 'poc', transport: 'stdio', command: 'relative/path' })
  ok('K-01: a relative command -> 400', res.code === 400, `code=${res.code}`)
}
// ── H-09: YAML injection, multi-line args and env are refused ──────────────
{
  const res = await jouer({}, { nom: 'poc-h09', transport: 'stdio', command: '/usr/bin/touch', args: ['x\n      autoApprove: true'] })
  ok('H-09: args with a line break -> 400 (no YAML injection possible)', res.code === 400 && /line breaks/.test(res.corps), res.corps.slice(0, 80))
}
{
  const res = await jouer({}, { nom: 'poc-h09', transport: 'streamable-http', url: 'https://ex.example/mcp', headers: [{ name: 'X', value: 'v\n  cle: oui' }] })
  ok('H-09: headers with a line break -> 400', res.code === 400, res.corps.slice(0, 60))
}
// ── H-09 (second round): the NAME of a pair is a YAML key, a booby-trapped one -> 400 ──
{
  const res = await jouer({}, { nom: 'poc-h09c', transport: 'stdio', command: '/usr/bin/touch', env: [{ name: 'X: 1\n      autoApprove', value: 'true' }] })
  ok('H-09: multi-line env name (X: 1\\n autoApprove) -> 400', res.code === 400, res.corps.slice(0, 80))
}
{
  const res = await jouer({}, { nom: 'poc-h09c', transport: 'streamable-http', url: 'https://ex.example/mcp', headers: [{ name: 'H\n  cle: x', value: 'v' }] })
  ok('H-09: multi-line header name -> 400', res.code === 400, res.corps.slice(0, 80))
}
{
  const res = await jouer({}, { nom: 'poc-h09c', transport: 'stdio', command: '/usr/bin/touch', env: [{ name: "WITH'QUOTE", value: 'v' }] })
  ok('H-09: env name with a quote -> 400', res.code === 400, res.corps.slice(0, 60))
}
// ── K-01: nothing is written on a refusal (the temp home has no sidecar) ────
{
  let existe = false
  try { readFileSync(join(HOME, '.dsh', 'kybernos', 'connecteurs.json')); existe = true } catch (e) { existe = false }
  ok('K-01: no sidecar written by the refused requests', existe === false)
}
// ── K-01 (arg bounds): count and length are capped ──────────────────────────
{
  const res = await jouer({}, { nom: 'poc-args', transport: 'stdio', command: '/usr/bin/touch', args: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] })
  ok('K-01: 9 args -> 400 (8 at most)', res.code === 400 && res.corps.includes('8 arguments'), res.corps.slice(0, 60))
}
{
  const res = await jouer({}, { nom: 'poc-args', transport: 'stdio', command: '/usr/bin/touch', args: ['x'.repeat(201)] })
  ok('K-01: a 201-character arg -> 400 (200 at most)', res.code === 400 && res.corps.includes('200 characters'), res.corps.slice(0, 60))
}
{
  const res = await jouer({}, { nom: 'poc-args', transport: 'stdio', command: '/usr/bin/touch', args: ['--config', '/legit/path.yml'] })
  ok('K-01: args with a legitimate path pass (bounds on count and length, not content)', res.code !== 400 || res.corps.includes('8 arguments') === false, `code=${res.code}`)
}

// ── K-01: a valid system command passes the validation (legitimate behaviour) ─
{
  const res = await jouer({}, { nom: 'poc', transport: 'stdio', command: '/usr/bin/touch' })
  // Accepted by the validation: here we only check that a real system binary is NOT
  // refused as a command. (The reply is a 500 without a profile folder in the temp home.)
  const refuseCommande = res.code === 400 && res.corps.includes('executable file')
  ok('K-01: /usr/bin/touch passes the command validation', refuseCommande === false, `code=${res.code}`)
  // This case may have WRITTEN the temp home's sidecar: clean up.
  try { rmSync(join(HOME, '.dsh'), { recursive: true, force: true }) } catch (e) { /* nothing */ }
}

// ── secrets: ~/.dsh/.env writes (temp HOME only) ────────────────────────────
// upsertEnvSecret used to pass the secret as the REPLACEMENT STRING of
// String.replace, which expands `$&`, `$1`, `$$`... inside it, and it accepted a
// line break, which defines an arbitrary second variable. Every write below goes
// to the temp HOME; refuse to run if homedir() does not point there.
if (homedir() !== HOME) { console.error(`✗ homedir() is ${homedir()}, not the temp HOME: refusing to write`); process.exit(1) }
const ENV_FILE = join(HOME, '.dsh', '.env')
const lireEnv = () => { try { return readFileSync(ENV_FILE, 'utf8') } catch (e) { return null } }
const poserEnv = (texte) => { mkdirSync(join(HOME, '.dsh'), { recursive: true }); writeFileSync(ENV_FILE, texte, 'utf8') }
// DSH itself creates ~/.dsh; upsertEnvSecret does not (it only writes the file).
const viderDsh = () => { rmSync(join(HOME, '.dsh'), { recursive: true, force: true }); mkdirSync(join(HOME, '.dsh'), { recursive: true }) }
const dangereux = ['a$&b', 'k$1v', 'x$$y', 'p$`q', "r$'s", 'n$<name>m', '$&$1$$$`$\'', 'plain-ck_0123456789']
for (const secret of dangereux) {
  // 1. no line yet: the append path
  viderDsh()
  upsertEnvSecret('MY_KEY', secret)
  ok(`secret ${JSON.stringify(secret)} is written unchanged (new line)`, lireEnv() === `MY_KEY=${secret}\n`)
  // 2. a line already there: the replace path, between two other lines
  poserEnv('BEFORE=1\nMY_KEY=old-value\nAFTER=2\n')
  upsertEnvSecret('MY_KEY', secret)
  ok(`secret ${JSON.stringify(secret)} is written unchanged (existing line), neighbours untouched`, lireEnv() === `BEFORE=1\nMY_KEY=${secret}\nAFTER=2\n`)
}
{
  poserEnv('KEEP=1\n')
  const avant = lireEnv()
  for (const [label, valeur] of [['LF', 'abc\nNODE_OPTIONS=--require /tmp/x'], ['CR', 'abc\rNODE_OPTIONS=x'], ['CRLF', 'abc\r\nX=1'], ['NUL', 'abc\0def'], ['trailing LF', 'abc\n']]) {
    let message = null
    try { upsertEnvSecret('MY_KEY', valeur) } catch (e) { message = String(e.message) }
    ok(`secret with a ${label} is refused`, message !== null && /line breaks/.test(message), String(message))
    ok(`secret with a ${label}: the error never carries the value`, message !== null && message.includes('abc') === false && message.includes('NODE_OPTIONS') === false, String(message))
    ok(`secret with a ${label}: nothing is written`, lireEnv() === avant)
  }
  let nomRefuse = false
  try { upsertEnvSecret('bad name(', 'v') } catch (e) { nomRefuse = true }
  ok('an invalid variable name is refused (it is built into a RegExp)', nomRefuse === true && lireEnv() === avant)
  ok('an empty value is "no value": false, nothing written', upsertEnvSecret('MY_KEY', '') === false && lireEnv() === avant)
  rmSync(join(HOME, '.dsh'), { recursive: true, force: true })
}
// The same through the route: 400 before ANY write, and the value is never echoed.
{
  viderDsh()
  const corps = (secrets) => ({ nom: 'sec-test', transport: 'streamable-http', url: 'https://ex.example/mcp', secrets })
  const res = await jouer({}, corps([{ name: 'GOOD_KEY', value: 'fine' }, { name: 'BAD_KEY', value: 'x\nNODE_OPTIONS=--require /tmp/evil' }]))
  ok('route: a secret with a newline → 400', res.code === 400 && /BAD_KEY/.test(res.corps) && /line breaks/.test(res.corps), `code=${res.code} ${res.corps.slice(0, 90)}`)
  ok('route: the 400 never echoes the value', res.corps.includes('NODE_OPTIONS') === false && res.corps.includes('/tmp/evil') === false)
  ok('route: nothing is written on that 400 (not even the valid secret before it)', lireEnv() === null)
  let sidecar = true
  try { readFileSync(join(HOME, '.dsh', 'kybernos', 'connecteurs.json')) } catch (e) { sidecar = false }
  ok('route: no connector is saved on that 400', sidecar === false)
}
{
  viderDsh()
  mkdirSync(join(HOME, '.dsh', 'profiles', 'web'), { recursive: true }) // so the patch write succeeds and the reply is a 200
  const res = await jouer({}, { nom: 'sec-test', transport: 'streamable-http', url: 'https://ex.example/mcp', secrets: [{ name: 'MY_KEY', value: 'a$&b$1c' }] })
  ok('route: a secret with `$&` and `$1` is accepted', res.code === 200, `code=${res.code} ${res.corps.slice(0, 90)}`)
  ok('route: that secret lands in .env unchanged', lireEnv() === 'MY_KEY=a$&b$1c\n')
  ok('route: the reply never carries the value', res.corps.includes('a$&b$1c') === false)
  rmSync(join(HOME, '.dsh'), { recursive: true, force: true })
}


// ═══ helpers shared by the writer tests below ═══════════════════════════════
const DSH_DIR = join(HOME, '.dsh')
const PATCH_FILE = join(DSH_DIR, 'profiles', 'web', 'cordis.patch.yml')
const SIDECAR_FILE = join(DSH_DIR, 'kybernos', 'connecteurs.json')
const lire = (f) => { try { return readFileSync(f, 'utf8') } catch (e) { return null } }
// A fresh DSH home with the profile folder, like a real install.
// js-yaml is reachable from the profile folder in a real install (node_modules of the
// profile): the temp one gets a symlink to the engine's copy, unless `avecYaml` is false.
const frais = (avecYaml = true) => {
  rmSync(DSH_DIR, { recursive: true, force: true })
  mkdirSync(join(DSH_DIR, 'profiles', 'web'), { recursive: true })
  if (avecYaml === true && ENGINE !== null) {
    mkdirSync(join(DSH_DIR, 'profiles', 'web', 'node_modules'), { recursive: true })
    symlinkSync(join(ENGINE, 'js-yaml'), join(DSH_DIR, 'profiles', 'web', 'node_modules', 'js-yaml'))
  }
}
// What DSH does to the files: restore process.env afterwards, loadLayeredEnv sets variables.
const bootEnv = (lire) => {
  const avant = Object.assign({}, process.env)
  const cwd = mkdtempSync(join(tmpdir(), 'kb-composio-cwd-'))
  try {
    dshBoot.loadLayeredEnv('dsh', cwd, () => {})
    // `lire`: the variables whose value DSH ends up with, handed back in this object
    if (lire !== undefined) for (const k of Object.keys(lire)) lire[k] = process.env[k]
    return null
  } catch (e) { return String(e.message).replace(HOME, '<home>').slice(0, 160) } finally {
    for (const k of Object.keys(process.env)) if (!(k in avant)) delete process.env[k]
    rmSync(cwd, { recursive: true, force: true })
  }
}
const bootPatch = () => {
  try { dshBoot.loadOverlayPatches('dsh', PATCH_FILE); return null } catch (e) { return String(e.message).replace(HOME, '<home>').split('\n')[0].slice(0, 200) }
}
const POST = (corps) => jouer({}, corps)
const DELETE = async (nom) => {
  const res = reponse()
  await routes['/kybernos/composio/connecteurs']({ method: 'DELETE', headers: {}, socket: { localPort: 3080 }, url: '/kybernos/composio/connecteurs?nom=' + nom, on: () => {} }, res)
  return res
}
const GET = async () => {
  const res = reponse()
  await routes['/kybernos/composio/connecteurs']({ method: 'GET', headers: {}, socket: { localPort: 3080 }, url: '/kybernos/composio/connecteurs', on: () => {} }, res)
  return JSON.parse(res.corps)
}
const http = (nom, extra) => Object.assign({ nom, transport: 'streamable-http', url: 'https://mcp.example.test/' + nom }, extra || {})

// ═══ C-01: DSH refuses some .env names at boot; the secrets box must not write them ═══
// DSH_*, HOME, PATH, EDITOR, BROWSER, ENV, XDG_*, DYLD_*, NODE_OPTIONS... make
// loadLayeredEnv throw at the next start: "which only the launching environment may set".
const REFUSED_NAMES = ['DSH_TAVILY_KEY', 'DSH_HOME', 'HOME', 'PATH', 'EDITOR', 'VISUAL', 'BROWSER', 'ENV', 'XDG_DATA_HOME', 'DYLD_INSERT_LIBRARIES', 'BASH_FUNC_FOO', 'NODE_OPTIONS', 'SHELL', 'LD_PRELOAD', 'HTTPS_PROXY', 'GIT_SSH_COMMAND', 'NODE_TLS_REJECT_UNAUTHORIZED']
const FINE_NAMES = ['TAVILY_API_KEY', 'MY_KEY', 'HOMEPAGE_TOKEN', 'MYHOME', 'PATH2', 'DSHX_KEY', 'XDG', 'ENVIRONMENT', 'BROWSER_KEY', '_PRIVATE']
for (const nom of REFUSED_NAMES) {
  frais()
  const res = await POST(http('sec-boot', { secrets: [{ name: nom, value: 'v-123' }] }))
  ok(`C-01: secret ${nom} -> 400`, res.code === 400 && res.corps.includes(nom), `code=${res.code} ${res.corps.slice(0, 80)}`)
  ok(`C-01: secret ${nom}: the 400 never echoes the value`, res.corps.includes('v-123') === false)
  ok(`C-01: secret ${nom}: nothing is written`, lire(join(DSH_DIR, '.env')) === null && lire(SIDECAR_FILE) === null && lire(PATCH_FILE) === null)
  let lance = null
  try { upsertEnvSecret(nom, 'v') } catch (e) { lance = String(e.message) }
  ok(`C-01: upsertEnvSecret refuses ${nom}`, lance !== null && lance.includes('v-123') === false && lire(join(DSH_DIR, '.env')) === null)
  ok(`C-01: isBootstrapOnlyName(${nom})`, isBootstrapOnlyName(nom) === true)
}
for (const nom of FINE_NAMES) ok(`C-01: ${nom} is a name DSH accepts`, isBootstrapOnlyName(nom) === false)
{
  frais()
  const res = await POST(http('sec-empty', { secrets: [{ name: 'PATH', value: '' }, { name: 'TAVILY_API_KEY', value: 'tvly-1' }] }))
  ok('C-01: a refused name with an EMPTY value writes nothing, so it is not refused', res.code === 200, `code=${res.code} ${res.corps.slice(0, 120)}`)
  ok('C-01: ...and the other secret is written', lire(join(DSH_DIR, '.env')) === 'TAVILY_API_KEY=tvly-1\n')
}
if (dshBoot !== null) {
  // DSH's own loader on the .env our route writes: every fine name must boot, every
  // refused one must have been stopped before the write (so the boot stays clean).
  for (const nom of FINE_NAMES.filter((n) => n !== 'XDG')) {
    frais()
    const res = await POST(http('sec-boot', { secrets: [{ name: nom, value: 'v' }] }))
    const err = bootEnv()
    ok(`C-01: with a ${nom} secret (route ${res.code}) DSH can still read its .env`, res.code === 200 && err === null, err === null ? undefined : err)
  }
  for (const nom of REFUSED_NAMES) {
    frais()
    await POST(http('sec-boot', { secrets: [{ name: nom, value: 'v' }] }))
    const err = bootEnv()
    ok(`C-01: after a refused ${nom} secret DSH boots`, err === null, err === null ? undefined : err)
  }
  // The control: DSH really does refuse these names, so the check above proves something.
  writeFileSync(join(DSH_DIR, '.env'), 'HOME=/tmp/x\n', 'utf8')
  ok('C-01 (control): DSH\'s loader does throw on a HOME line', bootEnv() !== null)
  // Parity with the engine's own list, read from its source: any name it refuses that
  // we do not know about fails here, which is the compat gate to update the list.
  const source = readFileSync(join(ENGINE, '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js'), 'utf8')
  const names = [...(/BOOTSTRAP_NAMES = new Set\(\[([\s\S]*?)\]\)/.exec(source) || [, ''])[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
  const prefixes = [...(/BOOTSTRAP_PREFIXES = \[([\s\S]*?)\]/.exec(source) || [, ''])[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
  ok('C-01: the engine list was found in the engine source', names.length > 40 && prefixes.length >= 4, `${names.length} names, ${prefixes.length} prefixes`)
  const unknown = names.filter((n) => isBootstrapOnlyName(n) !== true).concat(prefixes.filter((p) => isBootstrapOnlyName(p + 'X') !== true))
  ok('C-01: every name and prefix the engine refuses is refused here too', unknown.length === 0, unknown.join(', '))
} else skipped('C-01 DSH loadLayeredEnv on the .env our route writes')

// ═══ C-05 / C-02: a form value becomes a safe YAML scalar ════════════════════
// A "$" without a valid $NAME ("pa$$word", "price $5") used to become a bare JS
// expression in the patch (loader ReferenceError/SyntaxError, the connector silently never
// loaded, the route said 200); a value with ' or \ AND a $TOKEN gave an unknown YAML
// escape (DSH fails loud at boot). Values are now JSON string literals.
//
// The patch is read back WITHOUT a YAML library (the scalars are JSON by construction,
// so CI can check them) and evaluated the way the loader does: `with (ctx) { eval(expr) }`.
const lireScalaires = (texte) => {
  const out = {}
  for (const l of texte.split('\n')) {
    const m = /^ {8}("(?:[^"\\]|\\.)*"): (!!js )?("(?:[^"\\]|\\.)*")$/.exec(l)
    if (m !== null) out[JSON.parse(m[1])] = { js: m[2] !== undefined, text: JSON.parse(m[3]) }
  }
  return out
}
const SECRETS_ENV = { TOK: 'S3CRET', K: 'KKK', L: 'LLL', TAVILY_API_KEY: 'tvly' }
const attendu = (v) => v.replace(/\$([A-Z_][A-Z0-9_]*)/g, (m, n) => (SECRETS_ENV[n] !== undefined ? SECRETS_ENV[n] : ''))
const evalLoader = (expr, proc) => new Function('ctx', 'expr', 'with (ctx) { return eval(expr) }')({ process: proc }, expr)
const VALUES = ['Bearer $TAVILY_API_KEY', 'plain-literal', 'abc$def', 'price $5', 'pa$$word', 'Basic dXNlcjpwYXNz$', 'C:\\dir\\file $TOK', 'Bearer $TOK\\', "it's $K", '"quoted" $K', '$K$L', "x\\'; process.exitCode = 7; '$K", 'a $& $\' $` b', 'tab\tinside', 'unicode é 😀 $K', '$', '$$', '${K}', '$k']
for (const valeur of VALUES) {
  frais()
  const res = await POST(http('vals', { headers: [{ name: 'x-h', value: valeur }] }))
  const texte = lire(PATCH_FILE) || ''
  const s = lireScalaires(texte)['x-h']
  const proc = { env: SECRETS_ENV, exitCode: undefined }
  let obtenu = null
  let erreur = null
  try { obtenu = s === undefined ? undefined : (s.js ? evalLoader(s.text, proc) : s.text) } catch (e) { erreur = e.name + ': ' + e.message }
  ok(`C-05: header value ${JSON.stringify(valeur)} is sent as typed ($NAME read from the environment)`, res.code === 200 && erreur === null && obtenu === attendu(valeur) && proc.exitCode === undefined, erreur !== null ? erreur : `route ${res.code}, got ${JSON.stringify(obtenu)}`)
  ok(`C-05: header value ${JSON.stringify(valeur)}: a plain value has no !!js, a token value has one`, s !== undefined && s.js === /\$[A-Z_][A-Z0-9_]*/.test(valeur))
  if (dshBoot !== null) { const err = bootPatch(); ok(`C-05: DSH's patch loader accepts the file for ${JSON.stringify(valeur)}`, err === null, err === null ? undefined : err) }
}
{
  // env values of a stdio connector go through the same renderer
  frais()
  const res = await POST({ nom: 'envvals', transport: 'stdio', command: '/usr/bin/touch', env: [{ name: 'PW', value: 'pa$$word' }, { name: 'TOKEN', value: "it's \\ $TOK" }] })
  const s = lireScalaires(lire(PATCH_FILE) || '')
  ok('C-05: stdio env values: literal $ stays literal, token with quote and backslash is read from the environment', res.code === 200 && s.PW && s.PW.js === false && s.PW.text === 'pa$$word' && s.TOKEN && evalLoader(s.TOKEN.text, { env: SECRETS_ENV }) === "it's \\ S3CRET", `code=${res.code}`)
  if (dshBoot !== null) { const err = bootPatch(); ok('C-05: DSH accepts the stdio connector file', err === null, err === null ? undefined : err) }
}


// ═══ C-02: the generated cordis.patch.yml must always load in DSH ════════════
{
  // duplicate names: YAML refuses a repeated key at boot ("duplicated mapping key")
  for (const [label, corps] of [
    ['two identical header names', http('dup', { headers: [{ name: 'x-api-key', value: 'a' }, { name: 'x-api-key', value: 'b' }] })],
    ['two header names that differ only by case', http('dup', { headers: [{ name: 'X-Api-Key', value: 'a' }, { name: 'x-api-key', value: 'b' }] })],
    ['two identical env names', { nom: 'dup', transport: 'stdio', command: '/usr/bin/touch', env: [{ name: 'TOKEN', value: 'a' }, { name: 'TOKEN', value: 'b' }] }],
  ]) {
    frais()
    const res = await POST(corps)
    ok(`C-02: ${label} -> 400`, res.code === 400 && /used twice/.test(res.corps), `code=${res.code} ${res.corps.slice(0, 90)}`)
    ok(`C-02: ${label}: nothing is written`, lire(PATCH_FILE) === null && lire(SIDECAR_FILE) === null)
  }
  frais()
  const res = await POST({ nom: 'envcase', transport: 'stdio', command: '/usr/bin/touch', env: [{ name: 'Token', value: 'a' }, { name: 'TOKEN', value: 'b' }] })
  ok('C-02: env names are case sensitive (Token and TOKEN are two variables)', res.code === 200, `code=${res.code}`)
  if (dshBoot !== null) ok('C-02: ...and DSH loads that patch', bootPatch() === null)
}
{
  // control characters other than CR, LF and NUL used to reach the YAML as they were
  const hostiles = [['BEL', 'ab\x07cd'], ['ESC (a pasted terminal colour)', 'ab\x1b[31mcd'], ['DEL', 'ab\x7fcd'], ['C1 control U+0080', 'ab\u0080cd'], ['NEL U+0085', 'ab\u0085cd'], ['LINE SEPARATOR U+2028', 'ab cd'], ['a lone surrogate', 'ab\ud800cd'], ['BACKSPACE', 'ab\bcd']]
  for (const [label, valeur] of hostiles) {
    frais()
    const h = await POST(http('ctl', { headers: [{ name: 'x-h', value: valeur }] }))
    ok(`C-02: a header value with ${label} -> 400`, h.code === 400, `code=${h.code}`)
    const e = await POST({ nom: 'ctl', transport: 'stdio', command: '/usr/bin/touch', env: [{ name: 'A', value: valeur }] })
    ok(`C-02: an env value with ${label} -> 400`, e.code === 400, `code=${e.code}`)
    const a = await POST({ nom: 'ctl', transport: 'stdio', command: '/usr/bin/touch', args: ['x' + valeur] })
    ok(`C-02: an arg with ${label} -> 400`, a.code === 400, `code=${a.code}`)
    const w = await POST({ nom: 'ctl', transport: 'stdio', command: '/usr/bin/touch', cwd: '/tmp/x' + valeur })
    ok(`C-02: a cwd with ${label} -> 400`, w.code === 400, `code=${w.code}`)
    ok(`C-02: ${label}: nothing is written`, lire(PATCH_FILE) === null && lire(SIDECAR_FILE) === null)
  }
  frais()
  const res = await POST(http('tabs', { headers: [{ name: 'x-h', value: 'a\tb' }] }))
  ok('C-02: a TAB inside a value is legal and survives', res.code === 200 && lireScalaires(lire(PATCH_FILE) || '')['x-h'].text === 'a\tb', `code=${res.code}`)
  if (dshBoot !== null) ok('C-02: ...and DSH loads that patch', bootPatch() === null)
}
{
  // `$&`, `$'`, `$$` and `` $` `` in a url or an arg: String.replace expanded them when a connector was re-saved
  const url = "https://mcp.example.test/mcp?q=$&x=$$y=$'z=$`w"
  const args = ['--re', '$&', "$'", '$$', '$`']
  for (const [label, corps] of [['url', http('dollar', { url })], ['stdio args', { nom: 'dollar', transport: 'stdio', command: '/usr/bin/touch', args }]]) {
    frais()
    await POST(corps)
    const premier = lire(PATCH_FILE)
    const res = await POST(corps)
    const second = lire(PATCH_FILE)
    ok(`C-02: re-saving a connector whose ${label} holds $& $' $$ leaves the patch identical`, res.code === 200 && premier === second && premier !== null)
    const sc = (await GET()).connecteurs.find((x) => x.nom === 'dollar')
    ok(`C-02: ...and the ${label} is intact in the patch`, label === 'url' ? second.includes(JSON.stringify(sc.url)) : args.every((a) => second.includes('- ' + JSON.stringify(a))))
    if (dshBoot !== null) { const err = bootPatch(); ok(`C-02: ...and DSH loads it (${label})`, err === null, err === null ? undefined : err) }
  }
}
// the whole resulting file is checked with js-yaml before it is written
if (yaml !== null) {
  frais()
  const broken = '- insert:\n    - id: a\n      id: b\n'          // a duplicated key: DSH would not start
  writeFileSync(PATCH_FILE, broken, 'utf8')
  const res = await POST(http('after-broken'))
  ok('C-02: a patch that is already broken is not built upon (409)', res.code === 409 && /not valid YAML/.test(res.corps) && /duplicated mapping key/.test(res.corps), `code=${res.code} ${res.corps.slice(0, 120)}`)
  ok('C-02: ...the file, the sidecar and the .env are untouched', lire(PATCH_FILE) === broken && lire(SIDECAR_FILE) === null && lire(join(DSH_DIR, '.env')) === null)
  const del = await DELETE('after-broken')
  ok('C-02: deleting a connector that has no block changes nothing in a broken patch', del.code === 200 && JSON.parse(del.corps).removed === false && lire(PATCH_FILE) === broken)
  // a delete that leaves the file broken is refused; one that repairs it goes through
  frais()
  await POST(http('mine'))
  const sain = lire(PATCH_FILE)
  writeFileSync(PATCH_FILE, sain + '\n- id: z\n  id: z2\n', 'utf8')
  const keep = lire(PATCH_FILE)
  const d1 = await DELETE('mine')
  ok('C-02: a delete that would leave the patch broken is refused (409), the file is untouched', d1.code === 409 && lire(PATCH_FILE) === keep, `code=${d1.code}`)
  frais()
  await POST(http('mine'))
  writeFileSync(PATCH_FILE, lire(PATCH_FILE).replace("      serverName: \"mine\"\n", "      serverName: \"mine\"\n      serverName: \"mine\"\n"), 'utf8')
  ok('C-02 (control): that hand-broken block really is invalid for DSH', bootPatch() !== null)
  const d2 = await DELETE('mine')
  ok('C-02: deleting the block that breaks the patch repairs it (200)', d2.code === 200 && JSON.parse(d2.corps).removed === true && lire(PATCH_FILE) === null)
  // the reply says whether the check ran
  frais()
  ok('C-02: the reply says the patch was checked', JSON.parse((await POST(http('chk'))).corps).validated === true)
} else skipped('C-02 a broken patch is refused (needs js-yaml)')
{
  frais(false)
  const res = await POST(http('nocheck'))
  // Whether js-yaml can be found from where the host looks (profile folder, DSH home, the plugin, the launcher):
  // on a machine that happens to have one installed globally the reply is true, so the expectation follows.
  const joignable = [join(DSH_DIR, 'profiles', 'web'), DSH_DIR, new URL('.', import.meta.url).pathname, (() => { try { return join(process.argv[1], '..') } catch (e) { return DSH_DIR } })()].some((d) => { try { createRequire(join(d, 'package.json'))('js-yaml'); return true } catch (e) { return false } })
  ok('C-02: without js-yaml the connector is still written, and the reply says it was not checked', res.code === 200 && JSON.parse(res.corps).validated === joignable && lire(PATCH_FILE) !== null, `validated=${JSON.parse(res.corps).validated} reachable=${joignable}`)
}
{
  frais()
  ok('C-02: there is no backup when the patch did not exist yet', (await POST(http('first'))).code === 200 && readdirSync(join(DSH_DIR, 'profiles', 'web')).filter((n) => n.includes('.bak-')).length === 0)
  const avant = lire(PATCH_FILE)
  await POST(http('second'))
  const sauvegardes = readdirSync(join(DSH_DIR, 'profiles', 'web')).filter((n) => n.startsWith('cordis.patch.yml.bak-'))
  ok('C-02: the next write keeps the previous patch as cordis.patch.yml.bak-<time>', sauvegardes.length === 1 && lire(join(DSH_DIR, 'profiles', 'web', sauvegardes[0])) === avant, sauvegardes.join(','))
  for (let i = 0; i < 14; i += 1) await POST(http('c' + String.fromCharCode(97 + i), { url: 'https://mcp.example.test/' + i }))
  const toutes = readdirSync(join(DSH_DIR, 'profiles', 'web'))
  ok('C-02: at most 10 backups are kept', toutes.filter((n) => n.startsWith('cordis.patch.yml.bak-')).length === 10)
  ok('C-02: no temp file is left behind', toutes.filter((n) => n.includes('.tmp-')).length === 0, toutes.join(','))
  ok('C-02: the patch itself is still the 16 connectors', (lire(PATCH_FILE).match(/^# connecteur:/gm) || []).length === 16)
}
{
  // the last connector deleted from a file that holds nothing else: an EMPTY patch makes DSH fail at boot
  frais()
  await POST(http('only'))
  const del = await DELETE('only')
  ok('C-02: deleting the only connector of the patch answers 200', del.code === 200 && JSON.parse(del.corps).removed === true)
  const reste = lire(PATCH_FILE)
  ok('C-02: ...and does not leave an empty or comment-only patch (DSH refuses it at boot)', reste === null, reste === null ? undefined : JSON.stringify(reste.slice(0, 80)))
  ok('C-02: ...its content stays in a backup', readdirSync(join(DSH_DIR, 'profiles', 'web')).some((n) => n.startsWith('cordis.patch.yml.bak-')))
  const rep = await POST(http('again'))
  ok('C-02: a connector can be added again afterwards', rep.code === 200)
  if (dshBoot !== null) ok('C-02: DSH loads that patch', bootPatch() === null)
  // an empty list is replaced by the block, not followed by it
  frais()
  writeFileSync(PATCH_FILE, '# my patch\n[]\n', 'utf8')
  const r2 = await POST(http('after-empty'))
  ok('C-02: a patch that is just `[]` accepts a connector', r2.code === 200 && lire(PATCH_FILE).includes('[]') === false)
  if (dshBoot !== null) ok('C-02: ...and DSH loads it', bootPatch() === null)
}

// ═══ C-03: editing or deleting a connector only touches its own block ═════════
const BLOC_WORKERS = [
  '',
  '# ── Workers · Claude Code, added on 2026-10-05 by the Workers screen (Kybernos)',
  '# Rollback: restore cordis.patch.yml.bak-workers-claude-20261005-101500, then restart DSH.',
  '- insert:',
  "    - id: tool-subagent-claude",
  "      name: '@deepseek-ai/dsh-tool-subagent-cli'",
  '      disabled: true',
  '      config:',
  '        provider: claude',
  '',
].join('\n')
{
  frais()
  await POST(http('tavily'))
  writeFileSync(PATCH_FILE, lire(PATCH_FILE) + BLOC_WORKERS, 'utf8')
  const avant = lire(PATCH_FILE)
  const res = await POST(http('tavily', { url: 'https://mcp.example.test/tavily-v2' }))
  const apres = lire(PATCH_FILE)
  ok('C-03: editing the LAST connector keeps the block another writer appended after it', res.code === 200 && apres.endsWith(BLOC_WORKERS), apres.slice(-160).replace(/\n/g, '|'))
  ok('C-03: ...and the edit did land', apres.includes('tavily-v2') && apres.includes('tavily-v2') && avant.includes('tavily-v2') === false)
  ok('C-03: the disabled tool stays disabled', apres.includes('      disabled: true'))
  await DELETE('tavily')
  const fin = lire(PATCH_FILE)
  ok('C-03: deleting the LAST connector keeps the block appended after it', fin !== null && fin.includes('tool-subagent-claude') && fin.includes('      disabled: true') && fin.includes('connecteur:tavily') === false, String(fin).slice(0, 200).replace(/\n/g, '|'))
  if (dshBoot !== null) { const err = bootPatch(); ok('C-03: DSH loads what is left', err === null, err === null ? undefined : err) }
}
{
  frais()
  await POST(http('aaa'))
  const milieu = '\n# user note\n- id: my-own-plugin\n  disabled: true\n'
  writeFileSync(PATCH_FILE, lire(PATCH_FILE) + milieu, 'utf8')
  await POST(http('bbb'))
  ok('C-03: setup: a hand-added entry sits between two connectors', lire(PATCH_FILE).indexOf('my-own-plugin') > lire(PATCH_FILE).indexOf('connecteur:aaa') && lire(PATCH_FILE).indexOf('my-own-plugin') < lire(PATCH_FILE).indexOf('connecteur:bbb'))
  await DELETE('aaa')
  const a = lire(PATCH_FILE)
  ok('C-03: deleting the first connector keeps the hand-added entry and the second connector', a.includes('my-own-plugin') && a.includes('disabled: true') && a.includes('connecteur:bbb') && a.includes('connecteur:aaa') === false, a.slice(0, 220).replace(/\n/g, '|'))
  await POST(http('bbb', { url: 'https://mcp.example.test/b2' }))
  const b = lire(PATCH_FILE)
  ok('C-03: editing the second connector keeps the hand-added entry too', b.includes('my-own-plugin') && b.includes('/b2'))
  if (dshBoot !== null) { const err = bootPatch(); ok('C-03: DSH loads the result', err === null, err === null ? undefined : err) }
}
{
  // a round trip POST then DELETE used to add one blank line per cycle
  frais()
  await POST(http('keep'))
  writeFileSync(PATCH_FILE, lire(PATCH_FILE) + BLOC_WORKERS, 'utf8')
  const base = lire(PATCH_FILE)
  for (let i = 0; i < 4; i += 1) { await POST(http('cycle')); await DELETE('cycle') }
  ok('C-03: POST then DELETE of a connector leaves the patch byte for byte as it was (4 cycles)', lire(PATCH_FILE) === base, `${lire(PATCH_FILE).length} vs ${base.length} chars`)
  // editing a connector twice with the same data is stable, and the others are not moved
  const twice = lire(PATCH_FILE)
  await POST(http('keep'))
  ok('C-03: saving a connector again with the same data changes nothing', lire(PATCH_FILE) === twice)
}
{
  // blocks written by the previous version (single-quoted scalars) are still read and replaced
  frais()
  const ancien = [
    '# CONNECTEURS PERSONNALISÉS (géré par le formulaire et la skill connecteur-personnalise)',
    '',
    '# connecteur:old',
    '- insert:',
    "  - id: mcp-client-old",
    "    name: '@deepseek-ai/dsh-mcp-client'",
    '    config:',
    "      serverName: 'old'",
    '      transport: streamable-http',
    "      url: 'https://mcp.example.test/old'",
    '      headers:',
    "        'authorization': !!js \"'Bearer ' + (process.env.OLD_KEY || '')\"",
    '      toolCallTimeoutMs: 180000',
    '      failOnStartupError: false',
    '      reconnect:',
    '        enabled: true',
    '        maxAttempts: 10',
    '',
    '# a note that follows',
    '- id: after-old',
    '  disabled: true',
    '',
  ].join('\n')
  writeFileSync(PATCH_FILE, ancien, 'utf8')
  const lu = (await GET()).connecteurs.find((x) => x.nom === 'old')
  ok('C-03: a block of the previous format is listed (single-quoted values read)', lu !== undefined && lu.horsFormulaire === true && lu.url === 'https://mcp.example.test/old' && lu.serverName === 'old' && lu.transport === 'streamable-http', JSON.stringify(lu))
  await POST(http('old', { url: 'https://mcp.example.test/old2' }))
  const apres = lire(PATCH_FILE)
  ok('C-03: replacing it keeps the banner and what follows', apres.startsWith(ancien.split('# connecteur:old')[0]) && apres.endsWith('# a note that follows\n- id: after-old\n  disabled: true\n') && apres.includes('old2') && apres.includes("'old'") === false, apres.slice(-120).replace(/\n/g, '|'))
  if (dshBoot !== null) ok('C-03: DSH loads the result', bootPatch() === null)
}
{
  // a block that is the last thing of the file and has trailing blank lines
  frais()
  await POST(http('last'))
  writeFileSync(PATCH_FILE, lire(PATCH_FILE) + '\n\n\n', 'utf8')
  const res = await DELETE('last')
  ok('C-03: deleting a block followed only by blank lines works', res.code === 200 && (lire(PATCH_FILE) === null || /^\s*$/.test(lire(PATCH_FILE)) === false))
}



// ═══ helpers for the connections routes: a stubbed fetch, never the network ═══
const appels = []
const stubFetch = (handler) => {
  appels.length = 0
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    const o = init || {}
    const rec = { url: u, method: o.method || 'GET', headers: Object.assign({}, o.headers || {}), body: o.body ? String(o.body) : null, signal: o.signal }
    appels.push(rec)
    if (!/^https:\/\/(connect\.composio\.dev|kybernos-proxy-production\.up\.railway\.app)\//.test(u)) throw new Error('STUB: unexpected URL ' + u)
    return handler(rec)
  }
}
const resJson = (obj, status = 200, headers = {}) => {
  const h = Object.assign({ 'content-type': 'application/json' }, headers)
  return { ok: status >= 200 && status < 300, status, headers: { get: (k) => (h[String(k).toLowerCase()] !== undefined ? h[String(k).toLowerCase()] : null) }, text: async () => JSON.stringify(obj), json: async () => obj }
}
const resSse = (obj, status = 200, headers = {}) => {
  const h = Object.assign({ 'content-type': 'text/event-stream' }, headers)
  return { ok: status >= 200 && status < 300, status, headers: { get: (k) => (h[String(k).toLowerCase()] !== undefined ? h[String(k).toLowerCase()] : null) }, text: async () => 'event: message\ndata: ' + JSON.stringify(obj) + '\n\n', json: async () => { throw new Error('not json') } }
}
const rpcInit = () => resJson({ jsonrpc: '2.0', id: 1, result: {} }, 200, { 'mcp-session-id': 'sess-1' })
const rpcTool = (results) => resSse({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: JSON.stringify({ data: { results } }) }] } })
const CONNEXIONS = '/kybernos/composio/connections'
const connexions = async (query) => {
  const res = reponse()
  await routes[CONNEXIONS]({ method: 'GET', headers: {}, socket: { localPort: 3080 }, url: CONNEXIONS + (query || ''), on: () => {} }, res)
  return JSON.parse(res.corps)
}
const methodeMcp = (rec) => { try { return JSON.parse(rec.body).method } catch (e) { return null } }

// ═══ C-04: DSH_HOME moves everything the bundle reads and writes ══════════════
{
  const fakeOs = () => '/home/someone'
  ok('C-04: no DSH_HOME -> <home>/.dsh', resolveDshHome({}, fakeOs) === '/home/someone/.dsh')
  ok('C-04: a blank DSH_HOME is "not set"', resolveDshHome({ DSH_HOME: '   ' }, fakeOs) === '/home/someone/.dsh')
  ok('C-04: DSH_HOME is trimmed', resolveDshHome({ DSH_HOME: '  /srv/dsh  ' }, fakeOs) === '/srv/dsh')
  ok('C-04: DSH_HOME="~" is the home of the OS user', resolveDshHome({ DSH_HOME: '~' }, fakeOs) === '/home/someone')
  ok('C-04: DSH_HOME="~/dsh-data" is expanded', resolveDshHome({ DSH_HOME: '~/dsh-data' }, fakeOs) === '/home/someone/dsh-data')
  ok('C-04: DSH_HOME is normalized', resolveDshHome({ DSH_HOME: '/srv//dsh/../dsh2/' }, fakeOs) === '/srv/dsh2')
  const ALT = mkdtempSync(join(tmpdir(), 'kb-composio-alt-'))
  try {
    frais() // the OS home has a .dsh too: it must stay untouched
    writeFileSync(join(DSH_DIR, '.env'), 'COMPOSIO_API_KEY=ck_from_os_home\n', 'utf8')
    process.env.DSH_HOME = ALT
    mkdirSync(join(ALT, 'profiles', 'web'), { recursive: true })
    const res = await POST(http('moved', { secrets: [{ name: 'MOVED_KEY', value: 'v1' }] }))
    ok('C-04: with DSH_HOME set, a connector is saved (200)', res.code === 200, `code=${res.code} ${res.corps.slice(0, 80)}`)
    ok('C-04: the secret goes to $DSH_HOME/.env', lire(join(ALT, '.env')) === 'MOVED_KEY=v1\n')
    ok('C-04: the sidecar goes to $DSH_HOME/kybernos/connecteurs.json', (lire(join(ALT, 'kybernos', 'connecteurs.json')) || '').includes('"moved"'))
    ok('C-04: the patch goes to $DSH_HOME/profiles/web/cordis.patch.yml', (lire(join(ALT, 'profiles', 'web', 'cordis.patch.yml')) || '').includes('# connecteur:moved'))
    ok('C-04: the OS home .dsh is not touched', lire(join(DSH_DIR, '.env')) === 'COMPOSIO_API_KEY=ck_from_os_home\n' && lire(SIDECAR_FILE) === null && lire(PATCH_FILE) === null)
    ok('C-04: GET lists it from $DSH_HOME', (await GET()).connecteurs.some((c) => c.nom === 'moved'))
    // the fallback key reader looks in $DSH_HOME/.env too
    writeFileSync(join(ALT, '.env'), 'COMPOSIO_API_KEY=ck_from_dsh_home\n', 'utf8')
    stubFetch((r) => (methodeMcp(r) === 'initialize' ? rpcInit() : rpcTool({ gmail: { status: 'active', accounts: [] } })))
    const out = await connexions('?toolkits=gmail')
    const cles = appels.map((a) => a.headers['x-consumer-api-key'])
    ok('C-04: the fallback key reader uses $DSH_HOME/.env (not the OS home one)', out.configured === true && cles.length > 0 && cles.every((k) => k === 'ck_from_dsh_home'), JSON.stringify(cles))
    const del = await DELETE('moved')
    ok('C-04: DELETE works in $DSH_HOME', del.code === 200 && JSON.parse(del.corps).removed === true && lire(join(ALT, 'profiles', 'web', 'cordis.patch.yml')) === null)
  } finally {
    delete process.env.DSH_HOME
    rmSync(ALT, { recursive: true, force: true })
  }
  ok('C-04: with DSH_HOME unset again the OS home is used', resolveDshHome() === join(HOME, '.dsh'))
}


// ═══ C-12: a corrupt connecteurs.json is never silently overwritten ══════════
// (same rule as the slash entries.json, commit 934563b)
{
  const copies = () => readdirSync(join(DSH_DIR, 'kybernos')).filter((n) => n.startsWith('connecteurs.json.corrupt-'))
  frais()
  await POST(http('one'))
  await POST(http('two'))
  const bon = lire(SIDECAR_FILE)
  const abime = bon.slice(0, bon.length - 40)               // truncated JSON: a crash mid-write, a hand edit
  writeFileSync(SIDECAR_FILE, abime, 'utf8')
  const patchAvant = lire(PATCH_FILE)
  const res = await POST(http('three'))
  ok('C-12: POST over a corrupt sidecar is refused (409)', res.code === 409 && /not a valid list/.test(res.corps) && JSON.parse(res.corps).state === 'corrupt', `code=${res.code} ${res.corps.slice(0, 100)}`)
  ok('C-12: ...the corrupt file is left as it is', lire(SIDECAR_FILE) === abime)
  ok('C-12: ...the patch and the .env are untouched too', lire(PATCH_FILE) === patchAvant && lire(join(DSH_DIR, '.env')) === null)
  ok('C-12: ...a copy of the corrupt file is kept', copies().length === 1 && lire(join(DSH_DIR, 'kybernos', copies()[0])) === abime)
  await POST(http('three'))
  ok('C-12: a second attempt reuses the copy (one per content)', copies().length === 1)
  const del = await DELETE('one')
  ok('C-12: DELETE is refused too (409), nothing changes', del.code === 409 && lire(SIDECAR_FILE) === abime && lire(PATCH_FILE) === patchAvant)
  const lu = await GET()
  ok('C-12: GET still lists the blocks of the patch, and says why the sidecar is not used', lu.ok === true && lu.state === 'corrupt' && /not a valid list/.test(lu.error) && lu.connecteurs.map((c) => c.nom).sort().join() === 'one,two' && lu.connecteurs.every((c) => c.horsFormulaire === true), JSON.stringify(lu).slice(0, 160))
  const nbCopies = copies().length
  await GET()
  ok('C-12: a plain read writes no copy', copies().length === nbCopies)
  // the copies are capped
  for (let i = 0; i < 8; i += 1) { writeFileSync(SIDECAR_FILE, abime + ' ' + i, 'utf8'); await POST(http('cap')) }
  ok('C-12: at most 5 copies are kept', copies().length === 5, `${copies().length}`)
  // repaired by hand: it works again
  writeFileSync(SIDECAR_FILE, bon, 'utf8')
  ok('C-12: once the file is repaired a save goes through', (await POST(http('three'))).code === 200)
  // other kinds of "not a list of connectors"
  for (const [label, contenu] of [['an object', '{"nom":"x"}'], ['a list with a string in it', '["x"]'], ['a list with an entry without a name', '[{"transport":"stdio"}]'], ['null', 'null']]) {
    writeFileSync(SIDECAR_FILE, contenu, 'utf8')
    const r = await POST(http('four'))
    ok(`C-12: ${label} is refused, not read as an empty list`, r.code === 409 && lire(SIDECAR_FILE) === contenu, `code=${r.code}`)
  }
  writeFileSync(SIDECAR_FILE, '  \n', 'utf8')
  ok('C-12: a blank file is an empty list', (await POST(http('five'))).code === 200)
  rmSync(SIDECAR_FILE, { force: true })
  mkdirSync(SIDECAR_FILE)                                   // present, cannot be read as a file
  const r = await POST(http('six'))
  ok('C-12: a sidecar that cannot be read is refused too', r.code === 409 && JSON.parse(r.corps).state === 'unreadable' && /EISDIR/.test(r.corps), `code=${r.code} ${r.corps.slice(0, 100)}`)
  ok('C-12: ...and the reply carries no path', r.corps.includes(HOME) === false)
}

// ═══ C-06: files are private, written atomically, and a failure rolls back ═══
const mode = (f) => (statSync(f).mode & 0o777).toString(8)
{
  frais()
  await POST(http('perm', { secrets: [{ name: 'PERM_KEY', value: 'v' }] }))
  ok('C-06: a new .env is created 0600', mode(join(DSH_DIR, '.env')) === '600', mode(join(DSH_DIR, '.env')))
  ok('C-06: a new connecteurs.json is created 0600', mode(SIDECAR_FILE) === '600', mode(SIDECAR_FILE))
  ok('C-06: its folder is created 0700', mode(join(DSH_DIR, 'kybernos')) === '700', mode(join(DSH_DIR, 'kybernos')))
  ok('C-06: a new cordis.patch.yml is created 0600', mode(PATCH_FILE) === '600', mode(PATCH_FILE))
  ok('C-06: no temp file is left in any of the folders', [DSH_DIR, join(DSH_DIR, 'kybernos'), join(DSH_DIR, 'profiles', 'web')].every((d) => readdirSync(d).every((n) => n.includes('.tmp-') === false)))
  // an existing file keeps the mode its owner gave it
  chmodSync(join(DSH_DIR, '.env'), 0o640)
  chmodSync(PATCH_FILE, 0o644)
  await POST(http('perm2', { secrets: [{ name: 'PERM_KEY', value: 'v2' }] }))
  ok('C-06: an existing .env keeps its mode', mode(join(DSH_DIR, '.env')) === '640')
  ok('C-06: an existing patch keeps its mode', mode(PATCH_FILE) === '644')
  // a symlinked patch stays a symlink: the target is replaced
  const cible = join(DSH_DIR, 'real-patch.yml')
  writeFileSync(cible, lire(PATCH_FILE), 'utf8')
  rmSync(PATCH_FILE)
  symlinkSync(cible, PATCH_FILE)
  await POST(http('perm3'))
  ok('C-06: a symlinked patch stays a symlink and its target gets the change', statSync(PATCH_FILE).isFile() && lire(cible).includes('connecteur:perm3') && existsSync(PATCH_FILE) && readdirSync(join(DSH_DIR, 'profiles', 'web')).includes('cordis.patch.yml'))
  // upsertEnvSecret on its own: 0600 for a new file as well
  rmSync(join(DSH_DIR, '.env'))
  upsertEnvSecret('SOLO_KEY', 'v')
  ok('C-06: upsertEnvSecret creates the .env 0600', mode(join(DSH_DIR, '.env')) === '600')
}
{
  // the patch cannot be written (no profile folder): nothing else is left behind, and the reply has no path
  rmSync(DSH_DIR, { recursive: true, force: true })
  mkdirSync(DSH_DIR, { recursive: true })
  const res = await POST(http('half', { headers: [{ name: 'a', value: '$HALF_KEY' }], secrets: [{ name: 'HALF_KEY', value: 'half-secret' }] }))
  ok('C-06: a failed patch write answers 500, and says nothing was changed', res.code === 500 && /nothing was changed/.test(res.corps), `code=${res.code} ${res.corps.slice(0, 120)}`)
  ok('C-06: ...no .env and no sidecar are left, so GET does not list the connector', lire(join(DSH_DIR, '.env')) === null && lire(SIDECAR_FILE) === null && (await GET()).connecteurs.length === 0)
  ok('C-06: ...and the 500 carries no path and no secret', res.corps.includes(HOME) === false && res.corps.includes('half-secret') === false)
}
if (typeof process.getuid === 'function' && process.getuid() !== 0) {
  // the sidecar cannot be written (read-only folder): the patch and the .env written before it are put back
  frais()
  await POST(http('keep', { secrets: [{ name: 'KEEP_KEY', value: 'k1' }] }))
  const patch0 = lire(PATCH_FILE)
  const env0 = lire(join(DSH_DIR, '.env'))
  const side0 = lire(SIDECAR_FILE)
  chmodSync(join(DSH_DIR, 'kybernos'), 0o500)
  try {
    const res = await POST(http('lost', { secrets: [{ name: 'LOST_KEY', value: 'k2' }, { name: 'KEEP_KEY', value: 'k3' }] }))
    ok('C-06: a failed sidecar write answers 500', res.code === 500 && /connectors list/.test(res.corps), `code=${res.code} ${res.corps.slice(0, 120)}`)
    ok('C-06: ...the patch is put back', lire(PATCH_FILE) === patch0)
    ok('C-06: ...the .env is put back (no new secret, the old one unchanged)', lire(join(DSH_DIR, '.env')) === env0)
    ok('C-06: ...the sidecar is unchanged', lire(SIDECAR_FILE) === side0)
    const del = await DELETE('keep')
    ok('C-06: a failed delete puts back the patch and the .env too', del.code === 500 && lire(PATCH_FILE) === patch0 && lire(join(DSH_DIR, '.env')) === env0 && lire(SIDECAR_FILE) === side0, `code=${del.code} ${del.corps.slice(0, 100)}`)
  } finally { chmodSync(join(DSH_DIR, 'kybernos'), 0o700) }
} else console.log('- skipped, running as root: C-06 rollback on a read-only folder')

// ═══ C-07: a secret written to .env is read back by DSH exactly as typed ═════
{
  const CORPUS = [
    ['plain', 'ck_abcDEF123'], ['hash with a space', 'abc #def'], ['hash without a space', 'abc#def'], ['double quotes around', '"abc"'], ['single quotes around', "'abc'"],
    ['inner double quote', 'ab"cd'], ['inner single quote', "ab'cd"], ['backtick', 'ab`cd'], ['leading space', ' lead'], ['trailing space', 'trail '], ['trailing tab', 'trail\t'],
    ['equals signs', 'a=b=c'], ['base64 padding', 'YWJjZA=='], ['starts with a quote only', '"abc'], ['backslash-n text', 'a\\nb'], ['backslash', 'a\\b'], ['dollar brace', 'a${HOME}b'],
    ['unicode', 'clé-éà'], ['BOM prefix', '﻿ck_abc'], ['NBSP at the edge', ' ck_abc'], ['both quote kinds', 'it\'s "x"'], ['a hash and quotes', "a#'b\"c"], ['dollar', '$&$1$$'],
  ]
  for (const [label, valeur] of CORPUS) {
    const texte = envTextWith('KEEP=1\n', 'MY_KEY', valeur)
    const lu = parseEnv(texte)
    ok(`C-07: ${label} is read back exactly by parseEnv (the parser DSH uses)`, lu.MY_KEY === valeur && lu.KEEP === '1' && Object.keys(lu).length === 2, JSON.stringify(texte))
  }
  // a property check: random values from a hostile alphabet are either stored exactly, or refused when no quote kind can hold them
  const alphabet = ['a', 'b', 'Z', '0', ' ', '\t', '#', "'", '"', '`', '\\', 'n', '=', '$', '{', '}', 'é', ' ', '=', '-', '_', '.', '/']
  let seed = 12345
  const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
  let stockes = 0
  let refuses = 0
  let ecarts = []
  for (let i = 0; i < 3000; i += 1) {
    let v = ''
    for (let k = rand(12) + 1; k > 0; k -= 1) v += alphabet[rand(alphabet.length)]
    let texte = null
    try { texte = envTextWith('A=1\nB=two\n', 'MY_KEY', v) } catch (e) { refuses += 1; if (!(v.includes("'") && v.includes('`') && (v.includes('"') || v.includes('\\')))) ecarts.push('refused ' + JSON.stringify(v)); continue }
    stockes += 1
    const lu = parseEnv(texte)
    if (lu.MY_KEY !== v || lu.A !== '1' || lu.B !== 'two') ecarts.push(JSON.stringify(v) + ' -> ' + JSON.stringify(texte))
  }
  ok('C-07: 3000 random hostile values: stored exactly, or refused only when every quote kind is taken', ecarts.length === 0 && stockes > 2000, `${stockes} stored, ${refuses} refused; ${ecarts.slice(0, 2).join(' | ')}`)
  let message = null
  try { envTextWith('', 'MY_KEY', 'a #\'"`') } catch (e) { message = String(e.message) }
  ok('C-07: a value no quote kind can hold is refused, the error does not carry it', message !== null && /every kind of quote/.test(message) && message.includes('a #') === false, String(message))
}
{
  // DSH's own loader reads back what the route wrote
  if (dshBoot !== null) {
    frais()
    const typed = { SEC_HASH: 'abc#def', SEC_QUOTED: '"abc"', SEC_SPACE: 'a b  c', SEC_BS: 'a\\nb', SEC_PLAIN: 'ck_123', SEC_BOTH: 'it\'s "x"', SEC_DOLLAR: 'a$&b$1' }
    const res = await POST(http('roundtrip', { secrets: Object.keys(typed).map((n) => ({ name: n, value: typed[n] })) }))
    const lus = {}
    for (const n of Object.keys(typed)) lus[n] = undefined
    const err = bootEnv(lus)
    ok('C-07: the route accepts them and DSH boots', res.code === 200 && err === null, `code=${res.code} ${err}`)
    for (const n of Object.keys(typed)) ok(`C-07: DSH reads ${n} exactly as typed`, lus[n] === typed[n], `typed ${JSON.stringify(typed[n])}, DSH has ${JSON.stringify(lus[n])}`)
  } else skipped('C-07 DSH loadLayeredEnv reads back the secrets the route wrote')
  // values are trimmed at the route; an all-quote value is a 400
  frais()
  const r1 = await POST(http('trim', { secrets: [{ name: 'TRIM_KEY', value: '  tvly-1 \t' }, { name: 'BLANK_KEY', value: '   ' }] }))
  ok('C-07: a secret typed with edge spaces is stored trimmed', r1.code === 200 && lire(join(DSH_DIR, '.env')) === 'TRIM_KEY=tvly-1\n' && JSON.parse(r1.corps).secretsWritten === 1, `${r1.code} ${JSON.stringify(lire(join(DSH_DIR, '.env')))}`)
  frais()
  const r2 = await POST(http('allq', { secrets: [{ name: 'OK_KEY', value: 'fine' }, { name: 'Q_KEY', value: 'a #\'"`' }] }))
  ok('C-07: a value no quote kind can hold is a 400 before anything is written', r2.code === 400 && /every kind of quote/.test(r2.corps) && lire(join(DSH_DIR, '.env')) === null && lire(SIDECAR_FILE) === null && lire(PATCH_FILE) === null)
  // rotation: every line that defines the name is replaced, `export` included, the other variables stay
  for (const [label, avant] of [['a variable defined twice', 'TAV_KEY=old1\nOTHER=1\nTAV_KEY=old2\n'], ['an `export` line', 'export TAV_KEY=old\nOTHER=1\n'], ['spaces around the equals sign', 'OTHER=1\n  TAV_KEY = old\n'], ['no final newline', 'OTHER=1\nTAV_KEY=old'], ['CRLF line ends', 'OTHER=1\r\nTAV_KEY=old\r\n']]) {
    frais()
    writeFileSync(join(DSH_DIR, '.env'), avant, 'utf8')
    upsertEnvSecret('TAV_KEY', 'NEW value')
    const apres = lire(join(DSH_DIR, '.env'))
    const lu = parseEnv(apres)
    ok(`C-07: rotating a secret with ${label}: DSH sees the new value once, the other variables are intact`, lu.TAV_KEY === 'NEW value' && lu.OTHER === '1' && (apres.match(/TAV_KEY/g) || []).length === 1, JSON.stringify(apres))
  }
  frais()
  writeFileSync(join(DSH_DIR, '.env'), 'A=1\r\nB=2\r\n', 'utf8')
  upsertEnvSecret('NEW_KEY', 'v')
  ok('C-07: a new line follows the line ends of the file (CRLF)', lire(join(DSH_DIR, '.env')) === 'A=1\r\nB=2\r\nNEW_KEY=v\r\n')
}
{
  // DELETE takes the connector's secrets away, unless something else still uses them
  const env = () => lire(join(DSH_DIR, '.env'))
  frais()
  writeFileSync(join(DSH_DIR, '.env'), 'KEEP_ME=1\n', 'utf8')
  await POST(http('alpha', { headers: [{ name: 'authorization', value: 'Bearer $ALPHA_KEY' }], secrets: [{ name: 'ALPHA_KEY', value: 'a1' }, { name: 'SHARED_KEY', value: 's1' }] }))
  await POST(http('beta', { headers: [{ name: 'x-k', value: '$SHARED_KEY' }] }))
  ok('C-07: setup: the sidecar records the NAMES of the secrets written for a connector, never a value', JSON.stringify((await GET()).connecteurs.find((c) => c.nom === 'alpha').secrets) === '["ALPHA_KEY","SHARED_KEY"]' && (lire(SIDECAR_FILE) || '').includes('a1') === false && (lire(SIDECAR_FILE) || '').includes('s1') === false)
  const del = await DELETE('alpha')
  ok('C-07: DELETE removes the secret nothing else uses, keeps the shared one and the others', del.code === 200 && JSON.parse(del.corps).secretsRemoved === 1 && env() === 'KEEP_ME=1\nSHARED_KEY=s1\n', JSON.stringify(env()))
  const del2 = await DELETE('beta')
  ok('C-07: deleting the other user of the shared secret removes nothing (the record belongs to alpha)', del2.code === 200 && JSON.parse(del2.corps).secretsRemoved === 0 && env() === 'KEEP_ME=1\nSHARED_KEY=s1\n')
  // a connector saved before the record (no `secrets` field) keeps its secrets
  frais()
  writeFileSync(join(DSH_DIR, '.env'), 'OLD_KEY=1\n', 'utf8')
  mkdirSync(join(DSH_DIR, 'kybernos'), { recursive: true })
  await POST(http('legacy', { headers: [{ name: 'a', value: '$OLD_KEY' }] }))
  const d3 = await DELETE('legacy')
  ok('C-07: a connector without a record of secrets leaves the .env alone', d3.code === 200 && env() === 'OLD_KEY=1\n')
  // a name another entry of the patch reads is not removed, and neither is the Composio key
  frais()
  await POST(http('gamma', { secrets: [{ name: 'GAMMA_KEY', value: 'g' }, { name: 'COMPOSIO_API_KEY', value: 'ck_x' }] }))
  writeFileSync(PATCH_FILE, lire(PATCH_FILE) + "\n# hand entry\n- id: other\n  config:\n    token: !!js \"process.env.GAMMA_KEY\"\n", 'utf8')
  const d4 = await DELETE('gamma')
  ok('C-07: a secret that a hand-written patch entry still reads is kept, and so is COMPOSIO_API_KEY', d4.code === 200 && JSON.parse(d4.corps).secretsRemoved === 0 && /GAMMA_KEY=g/.test(env()) && /COMPOSIO_API_KEY=ck_x/.test(env()), JSON.stringify(env()))
}


// ═══ C-08 / C-09 / C-10: the connections routes ══════════════════════════════
// Time is shifted by a skew so the caches (120 s, 5 min, 1 h) can expire without waiting.
const horlogeReelle = Date.now.bind(Date)
let decalage = 0
Date.now = () => horlogeReelle() + decalage
const avancer = (ms) => { decalage += ms }
const poserCle = (k) => { mkdirSync(DSH_DIR, { recursive: true }); writeFileSync(join(DSH_DIR, '.env'), 'COMPOSIO_API_KEY=' + k + '\n', 'utf8') }
const course = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r('TIMEOUT'), ms))])
const mcp = () => appels.filter((c) => c.url.includes('connect.composio.dev'))
const versProxy = () => appels.filter((c) => c.url.includes('kybernos-proxy'))
const nbInit = () => mcp().filter((c) => methodeMcp(c) === 'initialize').length
const nbOutils = () => mcp().filter((c) => methodeMcp(c) === 'tools/call').length
const corpsStagnant = () => ({ ok: true, status: 200, headers: { get: () => null }, text: () => new Promise(() => {}) })
const html200 = () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => '<html>captive portal</html>' })
const compte = (id) => ({ status: 'active', accounts: [{ id, status: 'ACTIVE' }] })
const appsProxy = (n) => resJson({ apps: Array.from({ length: n }, (_, i) => ({ slug: 'app' + i })) })
const nomsAppel = (rec) => JSON.parse(rec.body).params.arguments.toolkits.map((x) => x.name)
const proxyOuMcp = (apps, mcpHandler) => (r) => (r.url.includes('kybernos-proxy') ? apps() : mcpHandler(r))

// ── C-09: a stalled body must not hang the request, nor the ones behind it ──
{
  const sauve = TIMEOUTS.mcpMs
  const sauveProxy = TIMEOUTS.proxyMs
  TIMEOUTS.mcpMs = 150
  TIMEOUTS.proxyMs = 150
  try {
    frais(); poserCle('ck_c09a')
    stubFetch((r) => (methodeMcp(r) === 'initialize' ? rpcInit() : corpsStagnant()))      // headers arrive, the body never does
    const a = await course(connexions('?toolkits=gmail'), 3000)
    ok('C-09: a response whose body never arrives is cut by the timeout (the request returns)', a !== 'TIMEOUT' && a.error === 'timeout', a === 'TIMEOUT' ? 'still pending after 3 s' : JSON.stringify({ error: a.error, configured: a.configured }))
    const b = await course(connexions('?toolkits=gmail'), 3000)
    ok('C-09: ...and the next request is not stuck behind it', b !== 'TIMEOUT' && b.error === 'timeout')
    frais(); poserCle('ck_c09b')
    stubFetch(() => corpsStagnant())                                                       // even initialize stalls its body
    const c = await course(connexions('?toolkits=slack'), 3000)
    ok('C-09: a stalled initialize is cut too', c !== 'TIMEOUT' && c.error === 'timeout')
    frais(); poserCle('ck_c09c')
    stubFetch(() => new Promise(() => {}))                                                 // not even the headers, and the stub ignores the abort signal
    const d = await course(connexions('?toolkits=notion'), 3000)
    ok('C-09: a fetch that never settles is cut as well', d !== 'TIMEOUT' && d.error === 'timeout')
    // the scan: the proxy list stalls -> the local catalog stands in; MCP stalls -> a timeout error
    avancer(3 * 3600e3)
    frais(); poserCle('ck_c09d')
    stubFetch((r) => (r.url.includes('kybernos-proxy') ? corpsStagnant() : (methodeMcp(r) === 'initialize' ? rpcInit() : rpcTool({}))))
    const e = await course(connexions(''), 6000)
    ok('C-09: a stalled proxy list falls back to the local catalog instead of hanging the scan', e !== 'TIMEOUT' && e.error === null && e.partial === true && e.scan === true)
    stubFetch((r) => (r.url.includes('kybernos-proxy') ? appsProxy(5) : (methodeMcp(r) === 'initialize' ? rpcInit() : corpsStagnant())))
    avancer(3 * 3600e3)
    const f = await course(connexions(''), 6000)
    ok('C-09: a scan with a stalled MCP body returns with a timeout error', f !== 'TIMEOUT' && f.error === 'timeout' && f.partial === true)
  } finally { TIMEOUTS.mcpMs = sauve; TIMEOUTS.proxyMs = sauveProxy }
}

// ── C-08: a failure is reported as a failure, never as "no connection" ──────
{
  frais(); poserCle('ck_c08_bad')
  avancer(3 * 3600e3)
  stubFetch(proxyOuMcp(() => resJson({ apps: [{ slug: 'gmail' }, { slug: 'slack' }] }), () => resJson({ error: 'unauthorized' }, 401)))
  const a = await connexions('')
  ok('C-08: a scan with a rejected key reports 401, not a clean empty list', a.error === '401' && a.partial === true && a.connections.length === 0 && a.configured === true, JSON.stringify({ error: a.error, partial: a.partial }))
  const avant = mcp().length
  await connexions('')
  ok('C-08: ...and a failed scan is not cached (the next one asks again)', mcp().length > avant)
  const b = await connexions('?toolkits=gmail')
  ok('C-08: the same on the toolkits route: error 401', b.error === '401' && b.configured === true)
}
{
  // one batch fails (429), the others succeed: the answer says so, and is not cached as the whole account
  frais(); poserCle('ck_c08_429')
  avancer(3 * 3600e3)
  let phase = 'rate'
  let n = 0
  stubFetch(proxyOuMcp(() => appsProxy(900), (r) => {
    if (methodeMcp(r) === 'initialize') return rpcInit()
    n += 1
    if (phase === 'rate' && n === 2) return resJson({ error: 'rate' }, 429)
    const results = {}
    for (const nom of nomsAppel(r)) results[nom] = ['app3', 'app450', 'app850'].includes(nom) ? compte('ca_' + nom) : { status: 'initiated', accounts: [] }
    return rpcTool(results)
  }))
  const a = await connexions('')
  ok('C-08: a 429 on one batch is reported (error 429, partial)', a.error === '429' && a.partial === true, JSON.stringify({ error: a.error, partial: a.partial, got: a.connections.map((c) => c.toolkit) }))
  ok('C-08: ...what the earlier batches found is kept', a.connections.map((c) => c.toolkit).join() === 'app3')
  phase = 'ok'
  const avant = nbOutils()
  const b = await connexions('')
  ok('C-08: the partial scan was not cached: the next scan asks again and is complete', nbOutils() > avant && b.error === null && b.partial === false && b.connections.map((c) => c.toolkit).sort().join() === 'app3,app450,app850', JSON.stringify({ error: b.error, got: b.connections.map((c) => c.toolkit) }))
  const apres = nbOutils()
  const c = await connexions('')
  ok('C-08: a complete scan is cached', nbOutils() === apres && c.connections.length === 3 && c.error === null)
}
{
  const cas = [
    ['a tool error (isError)', () => resJson({ jsonrpc: '2.0', id: 2, result: { isError: true, content: [{ type: 'text', text: 'Something broke' }] } }), 'tool-error'],
    ['a tool error that says the key is invalid', () => resJson({ jsonrpc: '2.0', id: 2, result: { isError: true, content: [{ type: 'text', text: 'Unauthorized: invalid API key' }] } }), '401'],
    ['an HTML page with a 200', () => html200(), 'bad-response'],
    ['a JSON-RPC error', () => resJson({ jsonrpc: '2.0', id: 2, error: { code: -32000, message: 'nope' } }), 'rpc-error'],
    ['a text that is not JSON', () => resSse({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'hello' }] } }), 'bad-response'],
    ['a successful:false payload', () => resSse({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: JSON.stringify({ successful: false, error: 'boom', data: {} }) }] } }), 'tool-error'],
    ['a 500', () => resJson({}, 500), '500'],
  ]
  let i = 0
  for (const [label, reponse2, code] of cas) {
    i += 1
    frais(); poserCle('ck_c08_c' + i)
    stubFetch((r) => (methodeMcp(r) === 'initialize' ? rpcInit() : reponse2()))
    const out = await connexions('?toolkits=gmail')
    ok(`C-08: ${label} -> error ${code}, not an empty answer`, out.error === code && out.configured === true, JSON.stringify({ error: out.error }))
  }
  frais(); poserCle('ck_c08_init')
  stubFetch((r) => (methodeMcp(r) === 'initialize' ? html200() : rpcTool({})))
  const out = await connexions('?toolkits=gmail')
  ok('C-08: an initialize answered with HTML -> bad-response', out.error === 'bad-response', JSON.stringify({ error: out.error }))
  ok('C-08: ...and it does not go on to call the tool', nbOutils() === 0)
  // the last good answer is served stale on a failure, then dropped when too old
  frais(); poserCle('ck_c08_stale')
  let marche = true
  stubFetch((r) => (methodeMcp(r) === 'initialize' ? rpcInit() : (marche ? rpcTool({ gmail: compte('ca_old') }) : resJson({}, 500))))
  const bon = await connexions('?toolkits=gmail')
  ok('C-08: setup: a good answer', bon.error === null && bon.connections[0].accounts.length === 1)
  marche = false
  avancer(200 * 1000)
  const vieux = await connexions('?toolkits=gmail')
  ok('C-08: past the TTL, a failure serves the last good answer flagged stale, with the error', vieux.stale === true && vieux.error === '500' && vieux.connections[0].accounts.length === 1, JSON.stringify({ stale: vieux.stale, error: vieux.error }))
  avancer(40 * 60 * 1000)
  const perime = await connexions('?toolkits=gmail')
  ok('C-08: after 30 minutes the stale answer is dropped: empty, not stale, with the error', perime.stale === false && perime.error === '500' && perime.connections.length === 0)
}

// ── C-10: caches and sessions belong to a KEY ───────────────────────────────
{
  frais(); poserCle('ck_A')
  const parCle = (r) => {
    if (methodeMcp(r) === 'initialize') return rpcInit()
    return rpcTool({ gmail: r.headers['x-consumer-api-key'] === 'ck_A' ? compte('ca_A') : { status: '', accounts: [] } })
  }
  stubFetch(parCle)
  const a = await connexions('?toolkits=gmail')
  poserCle('ck_B')
  const b = await connexions('?toolkits=gmail')
  ok('C-10: after the key changes, the answer comes from the new account (not from the cache of the old one)', a.connections[0].accounts.length === 1 && b.connections[0].accounts.length === 0 && b.error === null, `A:${a.connections[0].accounts.length} B:${b.connections[0].accounts.length}`)
  poserCle('ck_A')
  const avant = mcp().length
  const c = await connexions('?toolkits=gmail')
  ok('C-10: switching back to the first key is served from its own cache', c.connections[0].accounts.length === 1 && mcp().length === avant)
  // the scan
  avancer(3 * 3600e3)
  poserCle('ck_SA')
  stubFetch(proxyOuMcp(() => resJson({ apps: [{ slug: 'gmail' }] }), (r) => (methodeMcp(r) === 'initialize' ? rpcInit() : rpcTool({ gmail: r.headers['x-consumer-api-key'] === 'ck_SA' ? compte('ca_SA') : { status: '', accounts: [] } }))))
  const s1 = await connexions('')
  poserCle('ck_SB')
  const s2 = await connexions('')
  ok('C-10: scan: after the key changes, the list comes from the new account', s1.connections.length === 1 && s2.connections.length === 0 && s2.error === null, `A:${s1.connections.length} B:${s2.connections.length}`)
}
{
  // each key has its own MCP session
  frais()
  avancer(3 * 3600e3)
  stubFetch((r) => {
    const cle = r.headers['x-consumer-api-key']
    if (methodeMcp(r) === 'initialize') return rpcInitPour(cle)
    if (r.headers['mcp-session-id'] !== 'sess-' + cle) return resJson({ error: 'wrong session' }, 404)
    return rpcTool({ gmail: compte('ca_' + cle) })
  })
  const rpcInitPour = (cle) => resJson({ jsonrpc: '2.0', id: 1, result: {} }, 200, { 'mcp-session-id': 'sess-' + cle })
  poserCle('ck_S1'); const a = await connexions('?toolkits=gmail')
  poserCle('ck_S2'); const b = await connexions('?toolkits=slack')
  poserCle('ck_S1'); const c = await connexions('?toolkits=notion')
  ok('C-10: the MCP session is kept per key (interleaved keys never send each other\'s session)', a.error === null && b.error === null && c.error === null, JSON.stringify([a.error, b.error, c.error]))
  ok('C-10: ...the first key did not initialize twice', mcp().filter((x) => methodeMcp(x) === 'initialize' && x.headers['x-consumer-api-key'] === 'ck_S1').length === 1)
}
{
  // an expired session (404) is started again, once, in the same request
  frais(); poserCle('ck_exp')
  avancer(3 * 3600e3)
  let init = 0
  let expire = false
  stubFetch((r) => {
    if (methodeMcp(r) === 'initialize') { init += 1; return resJson({ jsonrpc: '2.0', id: 1, result: {} }, 200, { 'mcp-session-id': 'sess-' + init }) }
    if (expire && r.headers['mcp-session-id'] === 'sess-1') return resJson({ error: 'session not found' }, 404)
    return rpcTool({ gmail: compte('ca_exp') })
  })
  await connexions('?toolkits=gmail')
  expire = true
  const out = await connexions('?toolkits=slack')           // another slug: a cache miss
  ok('C-10: after a 404 (expired session) the host initializes again and the request succeeds', out.error === null && init === 2 && out.connections[0].toolkit === 'slack', JSON.stringify({ error: out.error, init }))
  const out2 = await connexions('?toolkits=notion')
  ok('C-10: ...and goes on with the new session', out2.error === null && init === 2)
  // a 404 that persists is reported, not retried forever
  stubFetch((r) => (methodeMcp(r) === 'initialize' ? rpcInit() : resJson({}, 404)))
  const out3 = await connexions('?toolkits=linear')
  ok('C-10: a 404 that persists is reported once retried (error 404)', out3.error === '404' && nbInit() <= 2, JSON.stringify({ error: out3.error, inits: nbInit() }))
}
{
  // a proxy blip: the local fallback stands in briefly, not for an hour
  frais(); poserCle('ck_blip')
  avancer(3 * 3600e3)
  const sauve = TIMEOUTS.slugsFailMs
  TIMEOUTS.slugsFailMs = 120
  try {
    let proxyUp = false
    stubFetch(proxyOuMcp(() => { if (!proxyUp) throw new Error('ECONNRESET'); return appsProxy(1500) }, (r) => (methodeMcp(r) === 'initialize' ? rpcInit() : rpcTool({}))))
    const a = await connexions('')
    ok('C-10: with the proxy down the scan runs on the local catalog and says it is partial', a.error === null && a.partial === true && a.scan === true)
    const premier = versProxy().length
    await connexions('')
    ok('C-10: ...the proxy is not hammered while it is down (short negative cache)', versProxy().length === premier)
    proxyUp = true
    await new Promise((r) => setTimeout(r, 200))
    const b = await connexions('')
    ok('C-10: once the proxy is back (after the short delay) the scan uses the full list and is complete', versProxy().length > premier && b.partial === false && b.error === null, JSON.stringify({ partial: b.partial, probes: versProxy().length - premier }))
    const sondes = nbOutils()
    await connexions('')
    ok('C-10: ...a complete scan is cached (an empty account is a complete answer too)', nbOutils() === sondes)
  } finally { TIMEOUTS.slugsFailMs = sauve }
}


// ═══ C-16: the form's edges ═══════════════════════════════════════════════════
{
  // args: a path with a space, quoted, used to be cut in two
  const sp = (s) => splitArgs(s)
  ok('C-16: splitArgs: plain words', JSON.stringify(sp('--port 3000  --x').args) === '["--port","3000","--x"]')
  ok('C-16: splitArgs: a double-quoted path with a space stays one argument', JSON.stringify(sp('"/Users/me/Jane Doe/server.mjs" --name "My App"').args) === '["/Users/me/Jane Doe/server.mjs","--name","My App"]')
  ok('C-16: splitArgs: single quotes keep everything literal', JSON.stringify(sp("'a b' 'c\\d' \"e'f\"").args) === '["a b","c\\\\d","e\'f"]')
  ok('C-16: splitArgs: \\" and \\\\ are the escapes inside double quotes only', JSON.stringify(sp('"a\\"b" "c\\\\d" e\\f').args) === '["a\\"b","c\\\\d","e\\\\f"]', JSON.stringify(sp('"a\\"b" "c\\\\d" e\\f').args))
  ok('C-16: splitArgs: a quote glued to a word joins them (--name="My App")', JSON.stringify(sp('--name="My App"').args) === '["--name=My App"]')
  ok('C-16: splitArgs: an unclosed quote is an error', sp('"abc def').erreur !== undefined && sp("x 'y").erreur !== undefined)
  ok('C-16: splitArgs: empty and blank lines give no argument', sp('').args.length === 0 && sp('   \t ').args.length === 0 && sp(undefined).args.length === 0)
  frais()
  const typed = '"/Users/me/Jane Doe/server.mjs" --name "My App"'
  const res = await POST({ nom: 'spaced', transport: 'stdio', command: '/usr/bin/touch', args: typed })
  const saved = (await GET()).connecteurs.find((c) => c.nom === 'spaced')
  ok('C-16: an args line with a quoted path with a space is saved as three arguments', res.code === 200 && JSON.stringify(saved.args) === '["/Users/me/Jane Doe/server.mjs","--name","My App"]', `code=${res.code} ${JSON.stringify(saved && saved.args)}`)
  ok('C-16: ...and each one is one list item of the patch', (lire(PATCH_FILE) || '').includes('        - "/Users/me/Jane Doe/server.mjs"\n        - "--name"\n        - "My App"'))
  const bad = await POST({ nom: 'spaced2', transport: 'stdio', command: '/usr/bin/touch', args: '"unclosed' })
  ok('C-16: an unclosed quote in the args line is a 400', bad.code === 400 && /quote/.test(bad.corps))
  const arr = await POST({ nom: 'spaced3', transport: 'stdio', command: '/usr/bin/touch', args: ['/Users/me/Jane Doe/server.mjs', '--x'] })
  ok('C-16: an args ARRAY is used as it is (spaces kept)', arr.code === 200 && JSON.stringify((await GET()).connecteurs.find((c) => c.nom === 'spaced3').args) === '["/Users/me/Jane Doe/server.mjs","--x"]')
  if (dshBoot !== null) ok('C-16: DSH loads that patch', bootPatch() === null)
  // names
  for (const nom of ['composio']) {
    frais()
    const r = await POST(http(nom))
    ok(`C-16: the name ${nom} is reserved (dsh-mcp-client throws "serverName already in use")`, r.code === 400 && /reserved/.test(r.corps) && lire(PATCH_FILE) === null, `code=${r.code} ${r.corps.slice(0, 80)}`)
  }
  frais()
  ok('C-16: a one-letter name is refused (the message always said 2 to 31)', (await POST(http('a'))).code === 400)
  ok('C-16: a two-letter name is fine', (await POST(http('ab'))).code === 200)
  ok('C-16: a 31-character name is fine and 32 is refused', (await POST(http('a'.repeat(31)))).code === 200 && (await POST(http('a'.repeat(32)))).code === 400)
  // a name another entry of the patch already uses
  frais()
  writeFileSync(PATCH_FILE, '- insert:\n    - id: mcp-client-taken\n      name: \'@deepseek-ai/dsh-mcp-client\'\n      config:\n        serverName: taken\n        transport: stdio\n', 'utf8')
  const dupe = await POST(http('taken'))
  ok('C-16: a name that is the id or serverName of another entry is refused (409), nothing written', dupe.code === 409 && /already used/.test(dupe.corps) && lire(SIDECAR_FILE) === null)
  writeFileSync(PATCH_FILE, '- insert:\n    - id: other\n      name: x\n      config:\n        serverName: "elsewhere"\n', 'utf8')
  ok('C-16: a double-quoted serverName elsewhere counts too', (await POST(http('elsewhere'))).code === 409)
  ok('C-16: a similar name does not', (await POST(http('elsewhere2'))).code === 200)
  const again = await POST(http('elsewhere2', { url: 'https://mcp.example.test/v2' }))
  ok('C-16: editing a connector does not collide with its own block', again.code === 200)
  // urls
  frais()
  const u = (url) => POST(http('urls', { url }))
  for (const [label, url] of [['user:password@ in the address', 'https://user:pw@mcp.example.test/mcp'], ['a user without a password', 'https://user@mcp.example.test/mcp'], ['plain http to a remote host', 'http://mcp.example.test/mcp'], ['plain http to a remote IP', 'http://192.168.1.20:3000/mcp'], ['plain http to a look-alike of localhost', 'http://localhost.evil.example/mcp']]) {
    const r = await u(url)
    ok(`C-16: ${label} is refused (400)`, r.code === 400 && r.corps.includes('pw') === false, `code=${r.code} ${r.corps.slice(0, 90)}`)
  }
  for (const url of ['http://localhost:3000/mcp', 'http://127.0.0.1:8080/mcp', 'http://[::1]:8080/mcp', 'http://app.localhost/mcp', 'https://mcp.example.test/mcp#frag']) {
    const r = await u(url)
    ok(`C-16: ${url} is accepted`, r.code === 200, `code=${r.code} ${r.corps.slice(0, 80)}`)
  }
  ok('C-16: a fragment is dropped (it is never sent to a server)', (await GET()).connecteurs.find((c) => c.nom === 'urls').url === 'https://mcp.example.test/mcp')
}

// ═══ C-17: toolkit slugs ═════════════════════════════════════════════════════
{
  frais(); poserCle('ck_c17')
  avancer(3 * 3600e3)
  stubFetch((r) => (methodeMcp(r) === 'initialize' ? rpcInit() : rpcTool({})))
  const lots = () => mcp().filter((c) => methodeMcp(c) === 'tools/call').map((c) => nomsAppel(c))
  const a = await connexions('?toolkits=_1password,_2chat,Gmail')
  ok('C-17: slugs with a leading underscore are probed (they were dropped), and Gmail is lower-cased', a.error === null && JSON.stringify(lots()[0]) === '["_1password","_2chat","gmail"]', JSON.stringify(lots()))
  appels.length = 0
  const b = await connexions('?toolkits=' + encodeURIComponent('Google Calendar,bash(git *),foo/bar'))
  ok('C-17: a list with no valid slug is answered, not turned into a full account scan', b.error === 'invalid-toolkits' && b.configured === true && b.scan !== true && b.connections.length === 0 && appels.length === 0, JSON.stringify({ error: b.error, scan: b.scan, calls: appels.length }))
  const c = await connexions('?toolkits=%20,%20')
  ok('C-17: blanks only are "no valid slug" as well', c.error === 'invalid-toolkits' && appels.length === 0)
  poserCle('ck_c17b')
  stubFetch(proxyOuMcp(() => { throw new Error('down') }, (r) => (methodeMcp(r) === 'initialize' ? rpcInit() : rpcTool({}))))
  const d = await connexions('')
  const sondes = [].concat(...lots())
  ok('C-17: the local fallback list of the scan carries the underscore slugs', d.partial === true && sondes.includes('_1password') && sondes.includes('_21risk') && sondes.includes('_2chat'), sondes.length + ' slugs')
  const e = await connexions('?toolkits=')
  ok('C-17: an EMPTY toolkits parameter is still the account scan', e.scan === true)
  poserCle('ck_c17c')
  const f = await connexions('')
  ok('C-17: no parameter at all is the account scan', f.scan === true)
  // no key: the same answer whatever the list
  rmSync(join(DSH_DIR, '.env'))
  const g = await connexions('?toolkits=' + encodeURIComponent('google calendar'))
  ok('C-17: without a key the answer is still no-credential', g.configured === false && g.error === 'no-credential')
}

// ═══ C-18: the key is read like DSH reads .env ═════════════════════════════════
{
  const cas = [
    ['an export prefix', 'export COMPOSIO_API_KEY=ck_abc123\n'],
    ['an inline comment', 'COMPOSIO_API_KEY=ck_abc123 # work account\n'],
    ['a variable defined twice (the last line wins in DSH)', 'COMPOSIO_API_KEY=ck_first\nOTHER=1\nCOMPOSIO_API_KEY=ck_abc123\n'],
    ['double quotes', 'COMPOSIO_API_KEY="ck_abc123"\n'],
    ['single quotes and a comment', "COMPOSIO_API_KEY='ck_abc123' # c\n"],
    ['CRLF line ends', 'OTHER=1\r\nCOMPOSIO_API_KEY=ck_abc123\r\n'],
    ['spaces around the equals sign', 'COMPOSIO_API_KEY = ck_abc123\n'],
    ['no final newline', 'COMPOSIO_API_KEY=ck_abc123'],
    ['a comment line that mentions the name', '# COMPOSIO_API_KEY=ck_old\nCOMPOSIO_API_KEY=ck_abc123\n'],
  ]
  let i = 0
  for (const [label, texte] of cas) {
    i += 1
    frais()
    writeFileSync(join(DSH_DIR, '.env'), texte, 'utf8')
    avancer(1000)
    stubFetch((r) => (methodeMcp(r) === 'initialize' ? rpcInit() : rpcTool({ gmail: { status: '', accounts: [] } })))
    const out = await connexions('?toolkits=gmail' + 'x'.repeat(i))
    const vu = appels.map((a) => a.headers['x-consumer-api-key'])
    const dsh = parseEnv(texte).COMPOSIO_API_KEY
    ok(`C-18: with ${label} the host sends ${JSON.stringify(dsh)}, the key DSH reads`, out.configured === true && vu.length > 0 && vu.every((k) => k === dsh) && dsh === 'ck_abc123', JSON.stringify({ dsh, vu }))
  }
  frais()
  writeFileSync(join(DSH_DIR, '.env'), 'COMPOSIO_API_KEY=\nOTHER=1\n', 'utf8')
  ok('C-18: an empty key is no key', (await connexions('?toolkits=gmail')).configured === false)
}

// ═══ C-19: request bodies ════════════════════════════════════════════════════
{
  const envoyer = async (morceaux, headers) => {
    const res = reponse()
    await routes['/kybernos/composio/connecteurs']({
      method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), socket: { localPort: 3080 }, url: '/kybernos/composio/connecteurs',
      on: (ev, fn) => { if (ev === 'data') for (const m of morceaux) fn(m); if (ev === 'end') setTimeout(() => fn(), 0) },
    }, res)
    return res
  }
  frais()
  const json = Buffer.from(JSON.stringify(http('accent', { headers: [{ name: 'x-h', value: 'café résumé 日本語 😀' }] })))
  const coupe = json.indexOf(Buffer.from('é')) + 1                 // inside the 2-byte sequence
  const r1 = await envoyer([json.subarray(0, coupe), json.subarray(coupe)])
  ok('C-19: a UTF-8 character split across two chunks is decoded intact', r1.code === 200 && (await GET()).connecteurs.find((c) => c.nom === 'accent').headers[0].value === 'café résumé 日本語 😀', `code=${r1.code}`)
  const octets = Array.from(json).map((b) => Buffer.from([b]))
  const r2 = await envoyer(octets)
  ok('C-19: ...one byte per chunk as well', r2.code === 200)
  const r3 = await envoyer([Buffer.alloc(300000, 0x61)])
  ok('C-19: a body over the limit answers 413, not the generic 400', r3.code === 413 && /too large/.test(r3.corps), `code=${r3.code} ${r3.corps}`)
  const r4 = await envoyer(Array.from({ length: 40 }, () => Buffer.alloc(10000, 0x61)))
  ok('C-19: the limit counts bytes over all the chunks (40 x 10 kB)', r4.code === 413)
  const gros = JSON.stringify(http('limit', { headers: [{ name: 'x-h', value: 'a'.repeat(100000) }] }))
  const r5 = await envoyer([Buffer.from(gros)])
  ok('C-19: a body under 200 kB is read (and judged on its content)', r5.code === 200 || r5.code === 400, `code=${r5.code}`)
  const r6 = await envoyer([Buffer.from('not json')])
  ok('C-19: a body that is not JSON is still a 400', r6.code === 400)
  const r7 = await envoyer(['{"nom":"strs","transport":"streamable-http","url":"https://mcp.example.test/s"}'])
  ok('C-19: string chunks are accepted too', r7.code === 200)
}

// ═══ C-21: the catalog route, errors without paths, apply() that cannot throw ═
{
  const get = async (headers, method) => { const res = reponse(); res.headers = {}; res.writeHead = (c, h) => { res.code = c; res.headers = h || {} }; await routes['/kybernos/composio/catalog']({ method: method || 'GET', headers: headers || {}, url: '/kybernos/composio/catalog', socket: {}, on: () => {} }, res); return res }
  const a = await get()
  ok('catalog route: 200 with an ETag and a JSON array of apps', a.code === 200 && typeof a.headers.etag === 'string' && Array.isArray(JSON.parse(a.corps)) && JSON.parse(a.corps).length > 50, `code=${a.code}`)
  ok('catalog route: the max-age=3600 cache is declared (a corrected catalog reaches browsers within an hour)', /max-age=3600/.test(a.headers['cache-control']))
  const b = await get({ 'if-none-match': a.headers.etag })
  ok('catalog route: If-None-Match gives 304', b.code === 304)
  ok('catalog route: POST is 405', (await get({}, 'POST')).code === 405)
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    // a fresh copy of the module whose catalog.js cannot be read
    const copie = mkdtempSync(join(tmpdir(), 'kb-composio-nocat-'))
    try {
      writeFileSync(join(copie, 'index.js'), readFileSync(new URL('./index.js', import.meta.url), 'utf8'))
      // the library modules index.js imports (everything .mjs that is not a test) travel with it
      for (const f of readdirSync(new URL('.', import.meta.url))) if (/\.mjs$/.test(f) && !/^(test|lib-test)/.test(f)) writeFileSync(join(copie, f), readFileSync(new URL('./' + f, import.meta.url), 'utf8'))
      writeFileSync(join(copie, 'catalog.js'), 'export const CATALOG = [];\n')
      chmodSync(join(copie, 'catalog.js'), 0o000)
      const mod = await import(join(copie, 'index.js') + '?nocat')
      const rt = {}
      mod.apply({ get: (n) => (n === 'webServer' ? { register: (r) => { rt[r.path] = r.handler } } : undefined), effect: (fn) => fn(), inject: (_n, fn) => fn(), logger: { info: () => {} } })
      const res = reponse()
      await rt['/kybernos/composio/catalog']({ method: 'GET', headers: {}, url: '/kybernos/composio/catalog', socket: {}, on: () => {} }, res)
      ok('C-21: an unreadable catalog answers 500 without the absolute path', res.code === 500 && res.corps.includes(copie) === false && res.corps.includes('/') === false && /EACCES/.test(res.corps), `code=${res.code} ${res.corps}`)
    } finally { try { chmodSync(join(copie, 'catalog.js'), 0o600) } catch (e) { /* gone */ } rmSync(copie, { recursive: true, force: true }) }
  }
  // AGENTS.md rule 2: nothing in apply() may throw out of it
  const logs = []
  let jete = null
  try { apply({ get: () => { throw new Error('no such service') }, effect: () => { throw new Error('boom') }, inject: () => { throw new Error('boom') }, logger: { info: (m) => logs.push(m) } }) } catch (e) { jete = e }
  ok('C-21: apply() never throws, whatever the host context does', jete === null, String(jete && jete.message))
  ok('C-21: ...and says why the routes are not there', logs.some((m) => /not mounted/.test(m)))
  let jete2 = null
  try { apply({}) } catch (e) { jete2 = e }
  ok('C-21: apply() with an empty context does not throw either', jete2 === null)
}

rmSync(HOME, { recursive: true, force: true })
console.log(echecs === 0 ? '\nHost: all green.' : `\n✗ ${echecs} failure(s)`)
process.exit(echecs === 0 ? 0 : 1)
