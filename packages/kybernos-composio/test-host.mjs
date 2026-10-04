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

import { apply, upsertEnvSecret, isBootstrapOnlyName } from './index.js'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, symlinkSync } from 'node:fs'
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
  ok('K-01: a command outside the system roots -> 400', res.code === 400 && res.corps.includes('system executable'), res.corps.slice(0, 70))
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
  const refuseCommande = res.code === 400 && res.corps.includes('system executable')
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
const bootEnv = () => {
  const avant = Object.assign({}, process.env)
  const cwd = mkdtempSync(join(tmpdir(), 'kb-composio-cwd-'))
  try { dshBoot.loadLayeredEnv('dsh', cwd, () => {}); return null } catch (e) { return String(e.message).replace(HOME, '<home>').slice(0, 160) } finally {
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
  const cassé = '- insert:\n    - id: a\n      id: b\n'          // a duplicated key: DSH would not start
  writeFileSync(PATCH_FILE, cassé, 'utf8')
  const res = await POST(http('after-broken'))
  ok('C-02: a patch that is already broken is not built upon (409)', res.code === 409 && /not valid YAML/.test(res.corps) && /duplicated mapping key/.test(res.corps), `code=${res.code} ${res.corps.slice(0, 120)}`)
  ok('C-02: ...the file, the sidecar and the .env are untouched', lire(PATCH_FILE) === cassé && lire(SIDECAR_FILE) === null && lire(join(DSH_DIR, '.env')) === null)
  const del = await DELETE('after-broken')
  ok('C-02: deleting a connector that has no block changes nothing in a broken patch', del.code === 200 && JSON.parse(del.corps).removed === false && lire(PATCH_FILE) === cassé)
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
  ok('C-02: without js-yaml the connector is still written, and the reply says it was not checked', res.code === 200 && JSON.parse(res.corps).validated === false && lire(PATCH_FILE) !== null)
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


rmSync(HOME, { recursive: true, force: true })
console.log(echecs === 0 ? '\nHost : tout est vert.' : `\n✗ ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
