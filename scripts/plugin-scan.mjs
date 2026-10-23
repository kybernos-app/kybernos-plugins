// A grep-level scan of what a plugin's code does, set against the permissions its manifest declares (docs/dev/plugin-contract.md, 7 and 11).
//
//   node scripts/plugin-scan.mjs <dir | --all> [--json]     what the scan sees, with the lines, and the permissions it would draft
//
// THE LIMIT, STATED ONCE: this reads text. It catches an honest mistake (a plugin that starts spawning processes and forgot to say so) and
// a naive abuse. It cannot catch obfuscated or dynamically built code, and it does not prove a declared permission is the right size. A
// permission is trusted only after a person has read the code; this scan is the ratchet that stops a declaration from falling behind it.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
export const PACKAGES = join(REPO, 'packages')
const SKIP_DIR = /^(node_modules|vendor|\.git|docs|domains|skills|fixtures?|e2e|test)$/
const TEST_FILE = /^(test|check)[-_.]|\.test\.m?js$|^lib-.*test/
const PAGE_DIR = /(^|\/)(client|src|widget|technique)\//
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/
const RESERVED_HOST = /(^|\.)(example\.(com|org|net)|[a-z0-9-]+\.example|test|invalid|localhost)$/

/** The `.js` and `.mjs` files of a package, split into host half and page half. Tests, vendored code and data folders are left out. */
export function sourceFiles (dir) {
  const root = join(PACKAGES, dir)
  const host = []
  const page = []
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = join(folder, entry.name)
      const rel = relative(root, full)
      if (entry.isDirectory()) { if (!SKIP_DIR.test(entry.name)) walk(full); continue }
      if (!/\.m?js$/.test(entry.name) || TEST_FILE.test(entry.name) || /\.min\.js$/.test(entry.name)) continue
      if (rel.startsWith('scripts' + '/')) continue // build tools of the package, not shipped code
      const isPage = PAGE_DIR.test(rel) || (entry.name.endsWith('.js') && entry.name !== 'index.js')
      ;(isPage ? page : host).push({ rel, path: full })
    }
  }
  walk(root)
  return { host, page }
}

const RULES = {
  exec: /\bchild_process\b|\b(?:execFile|execFileSync|execSync|spawnSync|spawn)\s*\(/,
  net: /\bfetch\s*\(|\bnode:https?\b|\bhttps?\.(?:request|get)\s*\(|new\s+WebSocket\b|\bnet\.connect\s*\(/,
  fsWrite: /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|rename|renameSync|rm|rmSync|unlink|unlinkSync|copyFile|copyFileSync|cp|cpSync|createWriteStream)\s*\(/,
  prompt: /\bsystemPrompt\.(?:context|section)\b/,
  tools: /\b(?:tools\.register|registerTool)\b/,
  routes: /\bwebServer\b/,
  homedir: /\bhomedir\s*\(|process\.env\.(?:HOME|USERPROFILE)\b|\bDSH_HOME\b|\bdshHome\b/
}
const SLOT_NAME = /slots\.register\(\s*\{\s*name:\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`)/g
const SLOT_CONST = /\bconst\s+(SLOT_[A-Z_]+)\s*=\s*(?:'([^']+)'|"([^"]+)")/g
const SLOT_VIA_CONST = /slots\.register\(\s*\{\s*name:\s*(SLOT_[A-Z_]+)/g
const HOST_LITERAL = /https?:\/\/([a-z0-9][a-z0-9.-]*[a-z0-9])(?=[/:'"`?#\s)\]]|$)/gi
const ROUTE_CONST = /\b(?:ROUTE|BASE|PREFIX|ROUTES)\s*=\s*(?:'|"|`)(\/[a-z0-9][a-z0-9/-]*)/g
const ROUTE_PATH = /\bpath:\s*(?:[A-Za-z_.]+\s*\+\s*)?(?:'|"|`)(\/(?:kybernos|free-llms)[a-z0-9-]*)/g

/** Pure. The evidence one package's text gives, by category. `files` = { host: [{ rel, text }], page: [{ rel, text }] }. */
export function scanText (files) {
  const out = { exec: [], net: [], fsWrite: [], prompt: [], tools: [], routes: [], homedir: [], dom: [], hosts: new Set(), routePrefixes: new Set(), slots: new Set(), unresolvedSlots: [], write: 0 }
  for (const f of files.host) {
    const lines = f.text.split('\n')
    lines.forEach((text, i) => {
      for (const [cat, rule] of Object.entries(RULES)) if (rule.test(text) && !/^\s*(\/\/|\*|\/\*)/.test(text)) out[cat].push({ file: f.rel, line: i + 1, text: text.trim().slice(0, 140) })
      if (/\bPOST\b|\bpost\s*\(/.test(text)) out.write += 1
    })
    for (const m of f.text.matchAll(HOST_LITERAL)) {
      const h = m[1].toLowerCase()
      if (!LOOPBACK.test(h) && !RESERVED_HOST.test(h) && h.includes('.')) out.hosts.add(h)
    }
    // Only a file that talks to the web server declares routes: a table of paths the plugin CALLS (dashboards' sources) is not a route.
    if (/\bwebServer\b/.test(f.text)) {
      for (const m of f.text.matchAll(ROUTE_CONST)) out.routePrefixes.add('/' + m[1].split('/')[1])
      for (const m of f.text.matchAll(ROUTE_PATH)) out.routePrefixes.add(m[1])
    }
  }
  for (const f of files.page) {
    const consts = new Map([...f.text.matchAll(SLOT_CONST)].map((m) => [m[1], m[2] ?? m[3]]))
    for (const m of f.text.matchAll(SLOT_NAME)) out.slots.add(m[1] ?? m[2] ?? m[3])
    for (const m of f.text.matchAll(SLOT_VIA_CONST)) { if (consts.has(m[1])) out.slots.add(consts.get(m[1])); else out.unresolvedSlots.push(f.rel + ':' + m[1]) }
    f.text.split('\n').forEach((text, i) => { if (/new\s+MutationObserver\b/.test(text)) out.dom.push({ file: f.rel, line: i + 1, text: text.trim().slice(0, 140) }) })
  }
  return out
}

/** Reads a package from the disk and scans it. */
export function scanPackage (dir) {
  const { host, page } = sourceFiles(dir)
  const read = (list) => list.map((f) => ({ rel: f.rel, text: readFileSync(f.path, 'utf8') }))
  return scanText({ host: read(host), page: read(page) })
}

/** Pure. The permissions a scan would draft: a starting point for a reader, never a verdict. */
export function draftPermissions (scan) {
  const out = []
  for (const s of [...scan.slots].sort()) out.push('ui.slot:' + s)
  if (scan.dom.length > 0) out.push('ui.dom')
  for (const p of [...scan.routePrefixes].sort()) out.push('host.routes:' + p + ':' + (scan.write > 0 ? 'write' : 'read'))
  if (scan.fsWrite.length > 0) out.push('fs.write:dsh-home')
  if (scan.net.length > 0 || scan.hosts.size > 0) for (const h of [...scan.hosts].sort()) out.push('net:' + h)
  if (scan.exec.length > 0) out.push('exec')
  if (scan.prompt.length > 0) out.push('agent.prompt')
  if (scan.tools.length > 0) out.push('agent.tools')
  return out
}

/**
 * Pure. What a scan sees that the declared permissions do not cover, by category. Declaring MORE than the scan sees is fine (a reader
 * knows things a grep does not); declaring less is the fault. Hosts are not compared one by one: a URL in a string is not always a call.
 */
export function uncovered (scan, permissions) {
  const has = (re) => permissions.some((p) => re.test(p))
  const gaps = []
  if (scan.exec.length > 0 && !has(/^exec(:|$)/)) gaps.push('exec: the host code starts processes (' + scan.exec[0].file + ':' + scan.exec[0].line + ')')
  if (scan.net.length > 0 && !has(/^net:/)) gaps.push('net: the host code makes outbound requests (' + scan.net[0].file + ':' + scan.net[0].line + ')')
  if (scan.fsWrite.length > 0 && !has(/^fs\.write:/)) gaps.push('fs.write: the host code writes files (' + scan.fsWrite[0].file + ':' + scan.fsWrite[0].line + ')')
  if (scan.routes.length > 0 && scan.routePrefixes.size > 0 && !has(/^host\.routes:/)) gaps.push('host.routes: the host code serves routes (' + [...scan.routePrefixes].join(', ') + ')')
  // a declared prefix covers a served one when they are the same, or one is a path under the other (/kybernos and /kybernos/queue-move)
  const declaredRoutes = permissions.filter((x) => x.startsWith('host.routes:')).map((x) => x.split(':')[1])
  for (const p of scan.routePrefixes) if (declaredRoutes.length > 0 && !declaredRoutes.some((d) => d === p || d.startsWith(p + '/') || p.startsWith(d + '/'))) gaps.push('host.routes: the prefix ' + p + ' is served but not declared')
  if (scan.prompt.length > 0 && !has(/^agent\.prompt$/)) gaps.push('agent.prompt: the host code adds to the system prompt (' + scan.prompt[0].file + ':' + scan.prompt[0].line + ')')
  if (scan.tools.length > 0 && !has(/^agent\.tools$/)) gaps.push('agent.tools: the host code registers tools (' + scan.tools[0].file + ':' + scan.tools[0].line + ')')
  for (const s of scan.slots) if (!permissions.includes('ui.slot:' + s)) gaps.push('ui.slot:' + s + ': the page code mounts in this slot')
  if (scan.dom.length > 0 && !has(/^ui\.dom$/)) gaps.push('ui.dom: the page code observes the DOM with a MutationObserver (' + scan.dom[0].file + ':' + scan.dom[0].line + ')')
  return gaps
}

/**
 * Pure. The scan without the evidence of files a reader has judged not to be shipped behaviour (a developer script that writes to /tmp, a probe).
 * `exceptions` = [{ file, categories: ['fsWrite'], why }] for one package, kept in scripts/plugin-scan-exceptions.json so that each one is seen in a diff.
 */
export function withoutExceptions (scan, exceptions = []) {
  const out = { ...scan }
  for (const e of exceptions) for (const cat of e.categories) if (Array.isArray(out[cat])) out[cat] = out[cat].filter((x) => x.file !== e.file)
  return out
}

// ── command line ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const all = args.includes('--all')
  const dirs = all ? readdirSync(PACKAGES).filter((d) => existsSync(join(PACKAGES, d, 'package.json')) && statSync(join(PACKAGES, d)).isDirectory()).sort() : args.filter((a) => !a.startsWith('--'))
  if (dirs.length === 0) { console.error('usage: node scripts/plugin-scan.mjs <dir | --all> [--json]'); process.exit(2) }
  const report = dirs.map((dir) => { const s = scanPackage(dir); return { dir, draft: draftPermissions(s), hosts: [...s.hosts].sort(), routePrefixes: [...s.routePrefixes].sort(), slots: [...s.slots].sort(), unresolvedSlots: s.unresolvedSlots, counts: { exec: s.exec.length, net: s.net.length, fsWrite: s.fsWrite.length, routes: s.routes.length, prompt: s.prompt.length, tools: s.tools.length, homedir: s.homedir.length, dom: s.dom.length }, sample: { exec: s.exec.slice(0, 3), net: s.net.slice(0, 3), fsWrite: s.fsWrite.slice(0, 3), prompt: s.prompt.slice(0, 2), tools: s.tools.slice(0, 2), homedir: s.homedir.slice(0, 3) } } })
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2))
  else for (const r of report) console.log(r.dir + '\n  draft: ' + (r.draft.join(' ') || '(nothing seen)') + '\n  counts: ' + JSON.stringify(r.counts))
}
