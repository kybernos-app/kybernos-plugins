// The old stack is unplugged from DSH: the NEW Kybernos server is the default and the only thing the plugins talk to by default.
//   node scripts/test-no-legacy-hosts.mjs
//
// 1. The built-in profile is the new server, and the two literals that cannot import it (the page's fallback, the feedback fallback) and
//    the E2B template equal BUILTIN_API (the one place to change at go-live: packages/kybernos-cloud/server-profile.mjs).
// 2. No shipped code (packages/, tests, docs and READMEs excluded) names a host of the old stack, except the allowlist below. Every entry says
//    why it is legitimate and how many times it appears: an exception that is no longer needed fails too, so the list cannot rot.
//
// The old stack stays reachable as an explicit opt-in (a documented servers.json entry, docs/dev/servers.md), and its hostnames live there
// and in tests, nowhere else.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUILTIN_API, DEFAULT_PROFILE } from '../packages/kybernos-cloud/server-profile.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

console.log('the built-in server is the new one')
{
  check('BUILTIN_API is an https address and is what the default profile uses', /^https:\/\/[a-z0-9.-]+$/.test(BUILTIN_API) && DEFAULT_PROFILE.api === BUILTIN_API, BUILTIN_API)
  const page = read('packages/kybernos-plugin/client.js').match(/const KB_BUILTIN_API = '([^']*)'/)
  check('the page\'s fallback equals BUILTIN_API (edit KB_BUILTIN_API in packages/kybernos-plugin/client.js)', page !== null && page[1] === BUILTIN_API, page === null ? 'KB_BUILTIN_API not found' : page[1] + ' <> ' + BUILTIN_API)
  const feedback = read('packages/kybernos-plugin/index.js').match(/const KB_FEEDBACK_API_DEFAULT = '([^']*)'/)
  check('the feedback fallback equals BUILTIN_API (edit KB_FEEDBACK_API_DEFAULT in packages/kybernos-plugin/index.js)', feedback !== null && feedback[1] === BUILTIN_API, feedback === null ? 'not found' : feedback[1] + ' <> ' + BUILTIN_API)
  const template = read('packages/kybernos-computers/template-dsh/settings.yaml').match(/^\s*baseURL:\s*(\S+)\s*$/m)
  check('the E2B template points at BUILTIN_API/v1 (edit packages/kybernos-computers/template-dsh/settings.yaml)', template !== null && template[1] === BUILTIN_API + '/v1', template === null ? 'baseURL not found' : template[1] + ' <> ' + BUILTIN_API + '/v1')
  const defaultsInPage = read('packages/kybernos-plugin/client.js').match(/const kbServer = \{[^}]*\}/)
  check('the page starts on that address for api, web and console, with no gateway', defaultsInPage !== null && /api: KB_BUILTIN_API, web: KB_BUILTIN_API, console: KB_BUILTIN_API \+ '\/workspace-console', gateway: ''/.test(defaultsInPage[0]), defaultsInPage === null ? 'not found' : defaultsInPage[0])
}

console.log('no old-stack hostname in shipped code')
{
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) { if (name !== 'node_modules' && name !== 'vendor' && name !== '.git') walk(path); continue }
      files.push(path)
    }
  }
  walk(join(ROOT, 'packages'))
  // What is NOT shipped code: tests and their helpers, documents, third-party data.
  const skipped = (rel) => /(^|\/)(test[^/]*|lib-test[^/]*|lib-proxy-env[^/]*)\.mjs$/.test(rel) || /\.md$/.test(rel) || /provider-catalog\.json$/.test(rel)
  // The hosts of the old stack: its api, its web app and its gateway (any subdomain of the dev domains), and its Composio proxy.
  const PATTERNS = [
    /\bdev2?\.kybernos\.app\b/g,
    /kybernos-proxy[a-z0-9-]*\.up\.railway\.app/g,
    // A URL on the bare product domain: its web app (share links, billing, gateway) lived there. Only the allowlisted ones may stay.
    /https?:\/\/kybernos\.app(?![A-Za-z0-9.-])[^\s'"`)<>]*/g,
    /app\.kybernos\.ai/g,
  ]
  // Each exception: where, what (exact text), how many times, and why it is legitimate. Everything else fails.
  const ALLOWED = [
    { file: 'packages/kybernos-plugin/client.js', text: 'https://kybernos.app', count: 3, why: 'the vendor\'s website (the « site » link of the profile menu, the help links of the account center): a web page the person opens, not a server DSH talks to' },
    { file: 'packages/kybernos-plugin/client.js', text: 'https://kybernos.app/embed/', count: 1, why: 'sample text in a read-only field of the website-widget panel: that feature has no equivalent on the new server, listed for the owner' },
    { file: 'packages/kybernos-plugin/client.js', text: 'app.kybernos.ai', count: 2, why: 'the public widget runtime a customer pastes in their website (not the Kybernos server): who runs it is an open question for the owner' },
    { file: 'packages/kybernos-plugin/widget/widget.js', text: 'app.kybernos.ai', count: 2, why: 'the same widget runtime, served from the same address (its own script and visitor sign-in)' },
  ]
  const found = new Map()
  for (const path of files) {
    const rel = relative(ROOT, path)
    if (skipped(rel)) continue
    let text = null
    try { text = readFileSync(path, 'utf8') } catch (e) { continue }
    if (text.indexOf('\u0000') >= 0) continue
    text.split('\n').forEach((line, i) => {
      for (const re of PATTERNS) {
        re.lastIndex = 0
        let m = re.exec(line)
        while (m !== null) {
          const key = rel + '\u0001' + m[0]
          if (!found.has(key)) found.set(key, [])
          found.get(key).push(i + 1)
          m = re.exec(line)
        }
      }
    })
  }
  const unexpected = []
  for (const [key, lines] of found) {
    const [file, text] = key.split('\u0001')
    const entry = ALLOWED.find((a) => a.file === file && a.text === text)
    if (entry === undefined) unexpected.push(file + ':' + lines.join(',') + '  ' + text)
  }
  check('nothing of the old stack outside the allowlist', unexpected.length === 0, unexpected.join(' | '))
  for (const a of ALLOWED) {
    const lines = found.get(a.file + '\u0001' + a.text) || []
    check('allowed, and still needed: ' + a.text + ' in ' + a.file + ' (' + a.count + ')', lines.length === a.count, 'found ' + lines.length + ' at ' + lines.join(','))
  }
  check('every exception says why', ALLOWED.every((a) => typeof a.why === 'string' && a.why.length > 20))
}

console.log('\n' + (failed === 0 ? 'all checks OK' : failed + ' check(s) failed'))
process.exit(failed === 0 ? 0 : 1)
