// The security posture of a local install: `node scripts/dsh-lifecycle.mjs doctor --security [--port N] [--json] [--bundle <file>]`.
//
// It is triage input for support, NOT a gate and NOT proof: the code that produces it runs on the machine it describes, so a report can be forged, and
// a gate would refuse a customer on the day they are compromised. It reads files and asks the system who listens on the port; it never writes outside
// the bundle file the person asks for and never makes a network call.
//
// Three layers, so that the judgement is testable without a machine: `collectFacts` reads (fs and run are injected), `judge` decides (pure),
// `buildBundle` writes the support bundle with every secret removed (pure).
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

/** The real machine, for the command line (the tests inject their own). */
export function realIo () {
  return {
    fs: {
      exists: (p) => existsSync(p),
      stat: (p) => { const s = statSync(p); return { mode: s.mode, isFile: s.isFile() } },
      list: (d) => readdirSync(d),
      read: (p) => readFileSync(p, 'utf8')
    },
    // A read-only question to the system; code -1 means the tool is not there.
    run: (argv) => {
      const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: 5000 })
      return r.error ? { code: -1, out: '' } : { code: r.status === null ? -1 : r.status, out: String(r.stdout || '') }
    },
    write: (text) => process.stdout.write(text),
    writeFile: (file, text) => writeFileSync(file, text, { mode: 0o600 })
  }
}

const LOOPBACK_NAMES = new Set(['localhost', '::1'])
export const isLoopback = (address) => LOOPBACK_NAMES.has(address) || /^127\./.test(address)

/** Who listens on `port`, from `lsof -nP -iTCP:<port> -sTCP:LISTEN` (macOS, Linux) or `ss -ltnH` output: `[{ address, port }]`. */
export function parseListeners (text, port) {
  const found = []
  for (const line of String(text || '').split('\n')) {
    const tokens = line.trim().split(/\s+/)
    let local = null
    if (/\(LISTEN\)/.test(line)) local = tokens[tokens.indexOf('(LISTEN)') - 1]
    else if (tokens[0] === 'LISTEN') local = tokens[3]
    const m = typeof local === 'string' ? local.match(/^(\*|\[[^\]]*\]|[^:\s]+):(\d+)$/) : null
    if (m === null || Number(m[2]) !== port) continue
    found.push({ address: m[1] === '*' ? '*' : m[1].replace(/^\[|\]$/g, ''), port })
  }
  return found
}

/** The profile's default permission preset, from the text of its `cordis.patch.yml`; null when it names none. */
export function readDefaultPreset (yaml) {
  const m = String(yaml || '').match(/defaultPreset:\s*['"]?([\w.-]+)/)
  return m === null ? null : m[1]
}

const SECRET_SHAPES = [
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\b(?:kyk|kbd)_[A-Za-z0-9]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/
]
/** How many secret-shaped strings a text holds (the values are never returned). */
export const countSecrets = (text) => SECRET_SHAPES.reduce((n, re) => n + (String(text || '').match(new RegExp(re.source, 'g')) || []).length, 0)

const TUNNEL_PROCESSES = new Set(['ngrok', 'cloudflared', 'frpc', 'bore', 'localtunnel'])
const TUNNEL_SATELLITE = /tunnel|ngrok|cloudflared|frp/i
const UNSAFE_PRESET = /danger|full|never|unrestricted|bypass/i
const SECRET_NAME = /token|secret|credential|\.key$|^servers\.json$/i

/**
 * Reads the machine. `fs`: { exists(p), stat(p) -> { mode, isFile }, list(dir) -> names, read(p) -> text }, `run(argv) -> { code, out }` (code -1: the tool is missing).
 * Returns plain facts: no value of a secret is ever kept, only where it is and how it is protected.
 */
export async function collectFacts ({ fs, run, home, profilDir, port, platform, version, node, arch }) {
  const facts = { platform, arch, node, version, port, listeners: null, listenersSource: null, files: [], configSecrets: [], defaultPreset: null, satellites: [], tunnels: [] }
  if (platform !== 'win32') {
    const lsof = await run(['lsof', '-nP', '-iTCP:' + port, '-sTCP:LISTEN'])
    if (lsof.code !== -1) { facts.listeners = parseListeners(lsof.out, port); facts.listenersSource = 'lsof' } else {
      const ss = await run(['ss', '-ltnH'])
      if (ss.code !== -1) { facts.listeners = parseListeners(ss.out, port); facts.listenersSource = 'ss' }
    }
    const ps = await run(['ps', '-A', '-o', 'comm='])
    if (ps.code !== -1) facts.tunnels = [...new Set(ps.out.split('\n').map((l) => l.trim().split('/').pop()).filter((n) => TUNNEL_PROCESSES.has(n)))]
  }
  // The files that hold a secret: the keys file, and what the Kybernos folder keeps under a name that says so.
  const sensitive = new Set(['.env', join('kybernos', 'servers.json'), join('kybernos', 'door', 'token')])
  for (const dir of ['kybernos', join('kybernos', 'door')]) {
    const abs = join(home, dir)
    if (!fs.exists(abs)) continue
    for (const name of fs.list(abs)) if (SECRET_NAME.test(name)) sensitive.add(join(dir, name))
  }
  for (const rel of [...sensitive].sort()) {
    const abs = join(home, rel)
    if (!fs.exists(abs)) continue
    const st = fs.stat(abs)
    if (st.isFile) facts.files.push({ rel, mode: st.mode & 0o777 })
  }
  // A key pasted into the profile's own configuration is the usual leak: only the count is kept.
  for (const name of ['package.json', 'cordis.patch.yml']) {
    const abs = join(profilDir, name)
    if (!fs.exists(abs)) continue
    const n = countSecrets(fs.read(abs))
    if (n > 0) facts.configSecrets.push({ rel: join('profile', name), count: n })
  }
  const patch = join(profilDir, 'cordis.patch.yml')
  if (fs.exists(patch)) facts.defaultPreset = readDefaultPreset(fs.read(patch))
  const sat = join(home, 'kybernos', 'satellites-actives.json')
  if (fs.exists(sat)) {
    // The file is `{ actives: ['@local/…'], desactives: [...] }` (an older one was a plain array): only the active names count.
    try { const j = JSON.parse(fs.read(sat)); facts.satellites = (Array.isArray(j) ? j : Array.isArray(j && j.actives) ? j.actives : []).filter((s) => typeof s === 'string') } catch (e) { facts.satellites = [] }
  }
  return facts
}

/** The verdict, line by line: `[{ id, status: 'pass' | 'warn' | 'fail' | 'info', title, detail, fix? }]`. Pure. */
export function judge (facts) {
  const lines = []
  const add = (id, status, title, detail, fix) => lines.push({ id, status, title, detail, ...(fix === undefined ? {} : { fix }) })

  if (facts.listeners === null) add('listen', 'info', 'Who can reach DSH', 'Not measured here (neither lsof nor ss is available).')
  else if (facts.listeners.length === 0) add('listen', 'info', 'Who can reach DSH', 'Nothing listens on port ' + facts.port + ' (is DSH running?).')
  else {
    const open = facts.listeners.filter((l) => !isLoopback(l.address))
    if (open.length > 0) add('listen', 'fail', 'Who can reach DSH', 'DSH answers on ' + open.map((l) => l.address + ':' + l.port).join(', ') + ', which other machines can reach.', 'Start DSH on 127.0.0.1 only, and do not put it behind a tunnel or a port forward.')
    else add('listen', 'pass', 'Who can reach DSH', 'DSH answers on this computer only (' + facts.listeners.map((l) => l.address + ':' + l.port).join(', ') + ').')
  }

  if (facts.platform === 'win32') add('secret-files', 'info', 'Secret files', 'File modes are not checked on Windows.')
  else {
    const open = facts.files.filter((f) => (f.mode & 0o077) !== 0)
    if (open.length > 0) add('secret-files', 'fail', 'Secret files', open.length + ' secret file(s) other users of this computer can read: ' + open.map((f) => f.rel + ' (' + f.mode.toString(8) + ')').join(', ') + '.', 'chmod 600 on each of them, then change the secret they hold.')
    else add('secret-files', 'pass', 'Secret files', facts.files.length + ' secret file(s) checked, readable by their owner only.')
  }

  if (facts.configSecrets.length > 0) add('config-secrets', 'fail', 'Keys in the profile', 'A secret-shaped string sits in ' + facts.configSecrets.map((c) => c.rel + ' (' + c.count + ')').join(', ') + '.', 'Save the key in Kybernos (Settings) or in ~/.dsh/.env instead, remove it from the file, and change the key.')
  else add('config-secrets', 'pass', 'Keys in the profile', 'No secret-shaped string in the profile configuration.')

  if (facts.defaultPreset === null) add('permission', 'info', 'Permission of a new session', 'The profile does not set it: the engine\'s own default applies. Check in Settings that a new session asks before it runs a command.')
  else if (UNSAFE_PRESET.test(facts.defaultPreset)) add('permission', 'warn', 'Permission of a new session', 'A new session starts on the preset "' + facts.defaultPreset + '", which can run commands without asking.', 'Use a preset that asks first, unless this computer is disposable.')
  else add('permission', 'pass', 'Permission of a new session', 'A new session starts on the preset "' + facts.defaultPreset + '".')

  const doors = facts.satellites.filter((s) => TUNNEL_SATELLITE.test(s))
  if (facts.tunnels.length > 0 || doors.length > 0) add('outside', 'warn', 'Reach from outside', 'A tunnel may expose this computer: ' + [...facts.tunnels.map((t) => 'process ' + t), ...doors.map((d) => 'plugin ' + d)].join(', ') + '.', 'Turn it off unless you set it up on purpose and protect the address.')
  else if (facts.satellites.some((s) => s.replace(/^@local\//, '') === 'kybernos-door')) add('outside', 'info', 'Reach from outside', 'The local Kaby MCP door is on (this computer only, a token, always asks first). No tunnel found.')
  else add('outside', 'pass', 'Reach from outside', 'No tunnel and no outside door found.')

  add('version', 'info', 'Version', 'Kybernos ' + (facts.version || 'unknown') + ', Node ' + facts.node + ', ' + facts.platform + '/' + facts.arch + '. Not compared with the latest release (no network call).')
  return lines
}

export const summarise = (lines) => ({ pass: lines.filter((l) => l.status === 'pass').length, warn: lines.filter((l) => l.status === 'warn').length, fail: lines.filter((l) => l.status === 'fail').length, info: lines.filter((l) => l.status === 'info').length })

/** Takes the secrets and the personal paths out of a text. */
export function redact (text, { home = '' } = {}) {
  let t = String(text)
  if (home.length > 1) t = t.split(home).join('~')
  t = t.replace(/\/(Users|home)\/[^/\s"'\\]+/g, '/$1/<user>')
  for (const re of SECRET_SHAPES) t = t.replace(new RegExp(re.source, 'g'), '[secret removed]')
  t = t.replace(/(\btoken=)[^&\s"',]+/gi, '$1[removed]')
  t = t.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email removed]')
  t = t.replace(/\b[0-9a-f]{32,}\b/gi, '[hex removed]')
  return t
}

/** The support bundle, as text: the verdict and the facts, with every secret removed. Pure; it carries no value of any secret to begin with. */
export function buildBundle ({ facts, lines, now = new Date(), home = '' }) {
  const bundle = {
    schema: 'kybernos-support-bundle/1',
    generatedAt: now.toISOString(),
    note: 'Made on this computer, no network call. Read it before you send it.',
    summary: summarise(lines),
    checks: lines.map((l) => ({ id: l.id, status: l.status, detail: l.detail })),
    facts: { version: facts.version, node: facts.node, platform: facts.platform, arch: facts.arch, port: facts.port, listeners: facts.listeners, files: facts.files.map((f) => ({ rel: f.rel, mode: f.mode.toString(8) })), configSecrets: facts.configSecrets, defaultPreset: facts.defaultPreset, satellites: facts.satellites, tunnels: facts.tunnels }
  }
  return redact(JSON.stringify(bundle, null, 2), { home }) + '\n'
}

/** The command line: returns the exit code (1 when a check fails). `io`: { fs, run, write(text), writeFile(path, text) }. */
export async function securityDoctorCli ({ args, env, home, profilDir, version, platform, node, arch, io }) {
  const at = (flag) => (args.indexOf(flag) >= 0 ? args[args.indexOf(flag) + 1] : undefined)
  const port = Number(at('--port') || env.KB_PORT || 3080)
  const facts = await collectFacts({ fs: io.fs, run: io.run, home, profilDir, port, platform, version, node, arch })
  const lines = judge(facts)
  const sum = summarise(lines)
  const bundleFile = at('--bundle')
  if (bundleFile !== undefined) io.writeFile(bundleFile, buildBundle({ facts, lines, home }))
  if (args.includes('--json')) io.write(redact(JSON.stringify({ summary: sum, checks: lines }), { home }) + '\n')
  else {
    const mark = { pass: '✓', warn: '!', fail: '✗', info: '·' }
    io.write('\n  Security posture of this installation (triage for support, not a guarantee)\n')
    for (const l of lines) io.write('  ' + mark[l.status] + ' ' + l.title + ': ' + redact(l.detail, { home }) + '\n' + (l.fix === undefined ? '' : '      → ' + l.fix + '\n'))
    io.write('\n  ' + sum.pass + ' ok, ' + sum.warn + ' to look at, ' + sum.fail + ' to fix' + (bundleFile !== undefined ? '. Support bundle written (secrets removed, read it before you send it).' : '. Add --bundle <file> to write a support bundle with every secret removed.') + '\n')
  }
  return sum.fail > 0 ? 1 : 0
}
