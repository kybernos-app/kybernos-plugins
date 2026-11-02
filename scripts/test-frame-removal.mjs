// The read-only account frame is gone, and stays gone (WP-24, docs/dev/frame-removal.md).
//
//   node scripts/test-frame-removal.mjs
//
// DSH used to draw an iframe of the server's console in its content zone (Team settings, Account, Referral), answer it through a page-side broker, read
// the account for it through a host relay route and hand it an admin key through a second route. The account menu opens the app in the browser now (the
// console link, ADR 0054 of the server), so none of that has a caller. This test pins the ABSENCE: the routes answer nothing, the page carries no broker,
// the helpers and stand-ins are deleted, and nothing in packages/ or scripts/ names them again.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 300)))
  if (!ok) failed += 1
}
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

const RELAY = '/kybernos-cloud/relay'
const KEY_ROUTE = '/kybernos/ws-console-key'

console.log('the files that served the frame are deleted')
for (const gone of [
  'packages/kybernos-plugin/ws-console-key.mjs', 'packages/kybernos-plugin/test-ws-console-key.mjs',
  'packages/kybernos-plugin/test-console-broker.mjs', 'packages/kybernos-plugin/test-frame-follows-space.mjs',
  'packages/kybernos-cloud/test-relay.mjs',
  'scripts/lib-fake-relay-host.mjs', 'scripts/lib-fake-team-gateway.mjs', 'scripts/check-relay-real.mjs',
]) check(gone + ' is gone', !existsSync(join(ROOT, gone)))

console.log('the host routes answer nothing')
{
  const cloud = await import(pathToFileURL(join(ROOT, 'packages/kybernos-cloud/index.js')).href)
  check('the cloud host mounts no ' + RELAY, cloud.ROUTES.every((r) => r.path !== RELAY), cloud.ROUTES.filter((r) => /relay/.test(r.path)).map((r) => r.path))
  check('and exports none of the relay\'s names', ['relayCheck', 'relayRules', 'RELAY_RULES'].every((n) => cloud[n] === undefined))
  check('the strict origin guard it shared is still exported (the console link, the plans and the payment calls use it)', typeof cloud.sameOriginStrict === 'function')
  const cloudSrc = read('packages/kybernos-cloud/index.js')
  check('the relay\'s allowlist, check and route are not in the cloud host\'s source', !/relayCheck|relayRules|RELAY_RULES|relayRoute|RELAY_ALLOW_/.test(cloudSrc))
  const pluginSrc = read('packages/kybernos-plugin/index.js')
  check('the core host registers no ' + KEY_ROUTE + ' and imports no helper for it', pluginSrc.indexOf(KEY_ROUTE) < 0 && pluginSrc.indexOf('ws-console-key') < 0 && pluginSrc.indexOf('wsConsoleKeyReply') < 0)

  // The strongest proof: every bundle's routes mounted in-process, as the route audit does, hold neither path (DSH answers 404 for a path nobody registered).
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major > 22 || (major === 22 && minor >= 13)) {
    let rows = null
    try { rows = JSON.parse(execFileSync(process.execPath, [join(ROOT, 'scripts/audit-routes.mjs'), '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })).rows } catch (e) { rows = null }
    check('the route audit could mount every bundle\'s routes', Array.isArray(rows) && rows.length > 300, rows === null ? 'no rows' : rows.length)
    if (Array.isArray(rows)) check('and its table of ' + rows.length + ' routes holds neither ' + RELAY + ' nor ' + KEY_ROUTE, rows.every((r) => r.path !== RELAY && r.path !== KEY_ROUTE))
  } else console.log('SKIPPED: the route audit needs Node 22.13 or later (this is ' + process.versions.node + ')')
}

console.log('the page carries no broker, no frame, no bridge')
{
  const GONE_FROM_THE_PAGE = [
    'KbWsConsole', '__kbOpenWsConsole', 'kbOuvrirWsConsole', "'wsconsole'", 'kbwsif', "'data-kb': 'ws-console'", 'ws-open-browser',
    RELAY, KEY_ROUTE, 'wsAdminKey',
    'kbApiReply', 'kbApiReady', 'kbConsoleKey', 'kbConsoleReady', 'kbConsoleTheme', 'kbSwitchSpace', 'kbNewSpace', 'kbOpenBrowser', 'kbBrowserReply', 'kbSpaceReply',
    'frameIdentity', 'kbWsConsole', 'kbWsOrigin', 'kbConsoleUrl', 'kbui.ws.',
    'kybernos-cloud:space-changed', 'kybernos-cloud:server-changed',
  ]
  for (const file of ['packages/kybernos-plugin/client.js', 'packages/kybernos-cloud/client.js']) {
    const src = read(file)
    const still = GONE_FROM_THE_PAGE.filter((t) => src.indexOf(t) >= 0)
    check(file + ' names none of the frame\'s messages, helpers, routes or events', still.length === 0, still)
  }
  const page = read('packages/kybernos-plugin/client.js')
  check('the page asks the cloud plugin for the server\'s web address and nothing else of it', /const kbServer = \{ web: KB_BUILTIN_API \}/.test(page))
  check('no iframe of the server\'s console is created by the core page', !/h\('iframe', \{[^}]*workspace-console/.test(page))
}

console.log('nothing else in packages/ or scripts/ names the removed routes or the bridge')
{
  // Only the files that pin the absence may name them.
  const ALLOWED = new Set(['scripts/test-frame-removal.mjs', 'packages/kybernos-cloud/test-cloud-client.mjs', 'packages/kybernos-cloud/test-cloud-host.mjs'])
  const TOKENS = [RELAY, KEY_ROUTE, '__kbOpenWsConsole', 'kbApiReply', 'kbConsoleKey']
  const hits = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'vendor') continue
      const p = join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.(js|mjs|json)$/.test(e.name)) continue
      const rel = relative(ROOT, p)
      if (ALLOWED.has(rel)) continue
      let text = null
      try { text = readFileSync(p, 'utf8') } catch (err) { continue }
      for (const t of TOKENS) if (text.indexOf(t) >= 0) hits.push(rel + ' names ' + t)
    }
  }
  walk(join(ROOT, 'packages'))
  walk(join(ROOT, 'scripts'))
  check('no shipped file or script names them', hits.length === 0, hits)
}

console.log('the cloud image\'s build-time patch is harmless on a page without the frame')
{
  const dir = mkdtempSync(join(tmpdir(), 'kb-frame-removal-'))
  try {
    const copy = join(dir, 'client.js')
    copyFileSync(join(ROOT, 'packages/kybernos-plugin/client.js'), copy)
    let out = ''
    let code = 0
    try { out = execFileSync(process.execPath, [join(ROOT, 'services/computer-image/patch-console.mjs'), copy], { encoding: 'utf8' }) } catch (e) { code = e.status === null || e.status === undefined ? 1 : e.status }
    check('patch-console.mjs exits 0 and says there is nothing to do', code === 0 && /nothing to do/.test(out), { code, out })
    check('and leaves the page byte for byte as it was', readFileSync(copy, 'utf8') === read('packages/kybernos-plugin/client.js'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

console.log('\n' + (failed === 0 ? 'all checks OK' : failed + ' check(s) failed'))
process.exit(failed === 0 ? 0 : 1)
