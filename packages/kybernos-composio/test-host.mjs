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
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
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
const ENGINE = engineDirs()[0] || null
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

ok('route connecteurs montée', typeof routes['/kybernos/composio/connecteurs'] === 'function')

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

// ── K-01 : origine hostile ──────────────────────────────────────────────────
{
  const res = await jouer({ origin: 'http://evil.example' }, { nom: 'poc', transport: 'stdio', command: '/usr/bin/touch' })
  ok('K-01 : POST connecteurs origin hostile → 403', res.code === 403, `code=${res.code} ${res.corps.slice(0, 40)}`)
}
{
  const res = await jouer({ origin: 'http://127.0.0.1.evil.example:3080' }, { nom: 'poc', transport: 'stdio', command: '/usr/bin/touch' })
  ok('K-01 : origin préfixe piégeux → 403', res.code === 403, `code=${res.code}`)
}
// ── K-01 : Content-Type non JSON ────────────────────────────────────────────
{
  const res = await jouer({ 'content-type': 'text/plain' }, { nom: 'poc', transport: 'stdio', command: '/usr/bin/touch' })
  ok('K-01 : POST text/plain → 415', res.code === 415, `code=${res.code}`)
}
// ── K-01 : commande stdio hors racines système ──────────────────────────────
{
  const res = await jouer({}, { nom: 'poc', transport: 'stdio', command: '/tmp/definitivement-pas-systeme' })
  ok('K-01 : command hors racines système → 400', res.code === 400 && res.corps.includes('exécutable système'), res.corps.slice(0, 70))
}
{
  const res = await jouer({}, { nom: 'poc', transport: 'stdio', command: '/usr/bin/je-nexiste-pas' })
  ok('K-01 : command inexistant → 400', res.code === 400, `code=${res.code}`)
}
{
  const res = await jouer({}, { nom: 'poc', transport: 'stdio', command: 'relative/chemin' })
  ok('K-01 : command relative → 400', res.code === 400, `code=${res.code}`)
}
// ── H-09 : injection YAML — args/env multi-lignes refusés ──────────────────
{
  const res = await jouer({}, { nom: 'poc-h09', transport: 'stdio', command: '/usr/bin/touch', args: ['x\n      autoApprove: true'] })
  ok('H-09 : args avec retour ligne → 400 (pas d\'injection YAML possible)', res.code === 400 && /retours ligne/.test(res.corps), res.corps.slice(0, 80))
}
{
  const res = await jouer({}, { nom: 'poc-h09', transport: 'streamable-http', url: 'https://ex.example/mcp', headers: [{ name: 'X', value: 'v\n  cle: oui' }] })
  ok('H-09 : headers avec retour ligne → 400', res.code === 400, res.corps.slice(0, 60))
}
// ── H-09 (reboucle) : le NAME d'une paire est une clé YAML — piégé → 400 ──
{
  const res = await jouer({}, { nom: 'poc-h09c', transport: 'stdio', command: '/usr/bin/touch', env: [{ name: 'X: 1\n      autoApprove', value: 'true' }] })
  ok('H-09 : env name multi-ligne (X: 1\\n autoApprove) → 400', res.code === 400, res.corps.slice(0, 80))
}
{
  const res = await jouer({}, { nom: 'poc-h09c', transport: 'streamable-http', url: 'https://ex.example/mcp', headers: [{ name: 'H\n  cle: x', value: 'v' }] })
  ok('H-09 : header name multi-ligne → 400', res.code === 400, res.corps.slice(0, 80))
}
{
  const res = await jouer({}, { nom: 'poc-h09c', transport: 'stdio', command: '/usr/bin/touch', env: [{ name: "AVEC'QUOTE", value: 'v' }] })
  ok('H-09 : env name avec quote → 400', res.code === 400, res.corps.slice(0, 60))
}
// ── K-01 : aucune écriture sur les refus (sidecar du vrai home intact) ──────
// (les gardes ont toutes refusé avant writeSidecar — on vérifie que le home
// factice ne porte aucun connecteurs.json, preuve qu'aucune écriture n'a eu lieu.)
{
  let existe = false
  try { readFileSync(join(HOME, '.dsh', 'kybernos', 'connecteurs.json')); existe = true } catch (e) { existe = false }
  ok('K-01 : aucun sidecar écrit par les requêtes refusées', existe === false)
}
// ── K-01 (bornes args) : nombre et longueur plafonnés ───────────────────────
{
  const res = await jouer({}, { nom: 'poc-args', transport: 'stdio', command: '/usr/bin/touch', args: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] })
  ok('K-01 : 9 args → 400 (8 max)', res.code === 400 && res.corps.includes('8 arguments'), res.corps.slice(0, 60))
}
{
  const res = await jouer({}, { nom: 'poc-args', transport: 'stdio', command: '/usr/bin/touch', args: ['x'.repeat(201)] })
  ok('K-01 : arg de 201 caractères → 400 (200 max)', res.code === 400 && res.corps.includes('200 caractères'), res.corps.slice(0, 60))
}
{
  const res = await jouer({}, { nom: 'poc-args', transport: 'stdio', command: '/usr/bin/touch', args: ['--config', '/chemin/legitime.yml'] })
  ok('K-01 : args avec chemin légitime passe (borne sur n/longueur, pas le contenu)', res.code !== 400 || res.corps.includes('8 arguments') === false, `code=${res.code}`)
}

// ── K-01 : commande système valide passe la validation (comportement légitime) ─
{
  const res = await jouer({}, { nom: 'poc', transport: 'stdio', command: '/usr/bin/touch' })
  // accepté par la validation (400 attendus ci-dessus) — ici on teste juste
  // que la validation ne refuse PAS un binaire système réel : code ≠ 400-sur-command.
  const refuseCommande = res.code === 400 && res.corps.includes('exécutable système')
  ok('K-01 : /usr/bin/touch passe la validation de commande', refuseCommande === false, `code=${res.code}`)
  // ⚠ ce cas a pu ÉCRIRE le sidecar du home factice — nettoyage :
  try { rmSync(join(HOME, '.dsh'), { recursive: true, force: true }) } catch (e) { /* rien */ }
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
const frais = () => { rmSync(DSH_DIR, { recursive: true, force: true }); mkdirSync(join(DSH_DIR, 'profiles', 'web'), { recursive: true }) }
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

rmSync(HOME, { recursive: true, force: true })
console.log(echecs === 0 ? '\nHost : tout est vert.' : `\n✗ ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
