#!/usr/bin/env node
// Case J02-12 of docs/tests/user-journey: the install from source on a clean Debian arm64 (what docs/dev/headless-on-linux-arm64.md measured once by hand).
//
//   node scripts/check-headless-linux.mjs [--keep-log <file outside the repo>]
//
// It takes the COMMITTED tree (`git archive HEAD`, so what the checkout holds is what is installed, never a stray file), starts a throw-away `debian:bookworm-slim` arm64 container
// with Docker, runs scripts/install-linux-arm64.sh in it as root (apt, Node 24 from nodejs.org, the engine and pnpm from npm, the web profile, ./kybernos-install, the headless profile),
// then asks four questions: is Node 24.9 or later there, is the engine the version dsh-compat.json allows, does the headless profile compose, does `dsh web` come up and refuse the
// bare address (401). No model is called and no key is read. The container needs the network (apt, nodejs.org, the npm registry) and is removed at the end.
// Named check-*, not test-*: the unit suite runs every test-* with no argument and this one needs Docker, the network and several minutes.
// Exit 0 all good, 1 a check failed, 3 not run (no Docker daemon, or not an arm64 host).
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The inside of the container: installs, then prints one `RESULT key value` line per fact. */
export const INSIDE = `set -eu
mkdir -p /opt/kybernos-plugins && tar -xf /in/src.tar -C /opt/kybernos-plugins && cd /opt/kybernos-plugins
started=$(date +%s)
if ! bash scripts/install-linux-arm64.sh >/tmp/install.log 2>&1; then tail -n 40 /tmp/install.log; echo "RESULT install failed"; exit 1; fi
echo "RESULT install-seconds $(( $(date +%s) - started ))"
export PATH=/usr/local/lib/nodejs/bin:$HOME/.npm-global/bin:$PATH
echo "RESULT node $(node --version)"
echo "RESULT dsh $(dsh --version | tail -n 1)"
if dsh --profile headless-kyb --dump-config >/dev/null 2>&1; then echo "RESULT headless composes"; else echo "RESULT headless broken"; fi
echo "RESULT bundles $(ls $HOME/.dsh/profiles/web/node_modules/@local 2>/dev/null | wc -l | tr -d ' ')"
dsh web --no-open --port 3099 >/tmp/web.log 2>&1 &
for _ in $(seq 1 90); do grep -q '^dsh web: http' /tmp/web.log && break; sleep 1; done
echo "RESULT web-bare-address $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3099/ || echo none)"
`

/** The `RESULT key value` lines of the container's output, as an object. Pure. */
export function parseResults (text) {
  const out = {}
  for (const line of String(text).split('\n')) {
    const m = /^RESULT (\S+)\s*(.*)$/.exec(line.trim())
    if (m) out[m[1]] = m[2]
  }
  return out
}

/** What is wrong with the facts, as sentences (empty when all is well). `engine` is the version dsh-compat.json allows. Pure. */
export function verdict (facts, engine) {
  const bad = []
  if (facts.install === 'failed' || facts['install-seconds'] === undefined) bad.push('the install script did not finish')
  const v = /^v(\d+)\.(\d+)/.exec(facts.node || '')
  if (!v || Number(v[1]) < 24 || (Number(v[1]) === 24 && Number(v[2]) < 9)) bad.push(`Node ${facts.node || 'missing'} is older than 24.9`)
  if (!(facts.dsh || '').includes(engine)) bad.push(`the engine is « ${facts.dsh || 'missing'} », dsh-compat.json allows ${engine}`)
  if (facts.headless !== 'composes') bad.push('the headless profile does not compose')
  if (!(Number(facts.bundles) >= 40)) bad.push(`only ${facts.bundles || 0} bundles are linked in the web profile`)
  if (facts['web-bare-address'] !== '401') bad.push(`dsh web answered ${facts['web-bare-address'] || 'nothing'} on the bare address, not 401`)
  return bad
}

function main () {
  const argv = process.argv.slice(2)
  const keep = argv.includes('--keep-log') ? argv[argv.indexOf('--keep-log') + 1] : null
  const docker = spawnSync('docker', ['info', '--format', '{{.Architecture}}'], { encoding: 'utf8' })
  if (docker.status !== 0) { console.error('○ not run: no Docker daemon answers (start Docker Desktop)'); process.exit(3) }
  if (!/aarch64|arm64/.test(docker.stdout)) { console.error('○ not run: the Docker host is ' + docker.stdout.trim() + ', not arm64 (an emulated run would not prove the phone userland)'); process.exit(3) }
  const engine = (/"max":\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'dsh-compat.json'), 'utf8')) || [])[1]
  const dir = mkdtempSync(join(tmpdir(), 'kb-headless-linux-'))
  try {
    const tar = spawnSync('git', ['-C', REPO, 'archive', '--format=tar', '-o', join(dir, 'src.tar'), 'HEAD'], { encoding: 'utf8' })
    if (tar.status !== 0) { console.error('git archive failed: ' + tar.stderr); process.exit(1) }
    console.log(`J02-12: installing the committed tree on debian:bookworm-slim (arm64), engine ${engine}; this takes a few minutes`)
    const run = spawnSync('docker', ['run', '--rm', '--platform', 'linux/arm64', '-v', `${dir}:/in:ro`, 'debian:bookworm-slim', 'bash', '-c', INSIDE], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 25 * 60 * 1000 })
    const text = (run.stdout || '') + (run.stderr || '')
    if (keep) writeFileSync(keep, text)
    const facts = parseResults(text)
    const bad = verdict(facts, engine)
    console.log(Object.entries(facts).map(([k, v]) => `  ${k}: ${v}`).join('\n'))
    if (bad.length) { console.log('✗ ' + bad.join('\n✗ ')); if (run.status !== 0) console.log(text.split('\n').slice(-30).join('\n')); process.exitCode = 1 } else console.log(`✓ clean Debian arm64: installed in ${facts['install-seconds']} s, Node ${facts.node}, engine ${engine}, headless composes, ${facts.bundles} bundles, dsh web refuses the bare address`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main()
