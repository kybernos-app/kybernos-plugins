// ── A plugin never reads an injected service as a PROPERTY of a context that did not inject it ─────────────────────────────────────────────────
//
// In DSH (Cordis) a service is readable as a property (`ctx.webServer`) only on a context that declared it with `inject`. `ctx.get('webServer')` works
// on any context. Our host plugins start with
//
//     const demarrer = (hostCtx) => { … hostCtx.webServer … }
//     if (ctx.get('webServer') !== undefined) demarrer(ctx)        // the service is already there: called with the PLUGIN's own context
//     else ctx.inject(['webServer'], demarrer)                    // later: called with an injected context
//
// and the first branch throws `cannot get property "webServer" without inject`: the plugin's routes are never mounted. Which branch runs depends on
// the order DSH starts the plugins in, so it hid on one runtime and showed on another (measured 2026-10-24 on a Node 18 run: four plugins at once;
// dsh-db-viewer, kybernos-auto, kybernos-maintenance, kybernos-sessions, then kybernos-terminal and kybernos-session-msg, which log and go on).
//
// The rule checked here, for every plugin source: when a NAMED function is both the callback of `ctx.inject([... 'svc' ...], NAME)` and called
// directly (`NAME(` anywhere else), its body must not read `.svc` as a property: it reads `x.get('svc')`, which is valid in both cases. A function
// written inline in the inject call is only ever called with the injected context and may read the property.
//
// The scanner is tested on fixtures first (a scanner that finds nothing would pass for the wrong reason), then run on every tracked plugin source.
//
//   node scripts/test-inject-reads.mjs
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
const ok = (name, cond, detail) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (!cond && detail !== undefined ? ' - ' + JSON.stringify(detail) : '')); if (!cond) failed++ }

// Blanks out comments, strings and template literals (keeps the length and the line breaks) so braces and names inside them cannot confuse the scan.
export function strip (src) {
  const out = src.split('')
  let i = 0
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' ' }
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (c === '/' && n === '/') { let j = i; while (j < src.length && src[j] !== '\n') j++; blank(i, j); i = j; continue }
    if (c === '/' && n === '*') { const j = src.indexOf('*/', i + 2); const e = j < 0 ? src.length : j + 2; blank(i, e); i = e; continue }
    if (c === '\'' || c === '"') { let j = i + 1; while (j < src.length && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++ } blank(i + 1, j); i = j + 1; continue }
    if (c === '`') { let j = i + 1; while (j < src.length && src[j] !== '`') { if (src[j] === '\\') j++; j++ } blank(i + 1, j); i = j + 1; continue }
    i++
  }
  return out.join('')
}

// The body of the function bound to NAME: from its definition to the end of its `{…}` block (or of its line, for an expression-bodied arrow).
function bodyOf (clean, name) {
  const re = new RegExp('(?:const|let|var)\\s+' + name + '\\s*=\\s*(?:async\\s*)?(?:function\\b[^(]*)?\\(([^)]*)\\)\\s*(=>)?\\s*|function\\s+' + name + '\\s*\\(([^)]*)\\)\\s*')
  const m = re.exec(clean)
  if (m === null) return null
  const start = m.index + m[0].length
  if (clean[start] !== '{') { const e = clean.indexOf('\n', start); return { text: clean.slice(start, e < 0 ? clean.length : e), param: (m[1] || m[3] || '').split(',')[0].trim(), at: m.index } }
  let depth = 0
  let j = start
  for (; j < clean.length; j++) { if (clean[j] === '{') depth++; else if (clean[j] === '}') { depth--; if (depth === 0) break } }
  return { text: clean.slice(start, j + 1), param: (m[1] || m[3] || '').split(',')[0].trim(), at: m.index }
}

/** Findings for one source: [{ service, fn, line, read }]. */
export function scan (src) {
  const clean = strip(src)
  const found = []
  const injectRe = /\.inject\(\s*\[([^\]]*)\]\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g
  for (let m = injectRe.exec(clean); m !== null; m = injectRe.exec(clean)) {
    // the names are strings, which `strip` blanked: read them from the original at the same offsets (strip keeps the length)
    const services = [...src.slice(m.index, m.index + m[0].length).matchAll(/['"]([A-Za-z0-9_$-]+)['"]/g)].map((x) => x[1])
    const fn = m[2]
    // called directly somewhere other than here? (`fn(`, not the definition and not this inject call)
    const calls = [...clean.matchAll(new RegExp('(?<![\\w$.])' + fn + '\\s*\\(', 'g'))].filter((c) => !/(?:const|let|var|function)\s+$/.test(clean.slice(Math.max(0, c.index - 12), c.index)))
    if (calls.length === 0) continue
    // the function itself and the local functions it hands its context to (`(c) => demarrerRoutes(c)`), three levels deep. A read counts only when it is
    // on the function's own context PARAMETER (`hostCtx.webServer`): a service name is often an ordinary property name (`state.settings`, `x.tools`) elsewhere.
    const seen = new Set()
    const check = (name, depth) => {
      if (seen.has(name) || depth > 3) return
      seen.add(name)
      const b = bodyOf(clean, name)
      if (b === null || b.param === '') return
      for (const service of services) {
        const read = new RegExp('(?<![\\w$.])' + b.param.replace(/[$]/g, '\\$') + '\\s*\\??\\.\\s*' + service + '\\b(?!\\s*\\()').exec(b.text)
        if (read !== null) found.push({ service, fn: name === fn ? fn : fn + ' -> ' + name, line: clean.slice(0, b.at).split('\n').length, read: read[0] })
      }
      for (const c of b.text.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g)) if (c[2] === b.param) check(c[1], depth + 1)
    }
    check(fn, 0)
  }
  return found
}

// ── 1. The scanner, on fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const BUG = `
export function apply (ctx) {
  const demarrer = (hostCtx) => {
    mount(hostCtx.webServer, { ctx: hostCtx })
  }
  if (ctx.get('webServer') !== undefined) demarrer(ctx)
  else ctx.inject(['webServer'], demarrer)
}`
const BUG_FN = `
export function apply (ctx) {
  function monter (c) { const s = kbFenced(c.webServer); s.register({}) }
  if (ctx.get('webServer') !== undefined) monter(ctx)
  else ctx.inject(['webServer'], monter)
}`
const BUG_EXPR = `
export function apply (ctx) {
  const demarrer = (c) => mount(c.webServer)
  if (ctx.get('webServer') !== undefined) demarrer(ctx)
  else ctx.inject(['webServer'], demarrer)
}`
const BUG_TWO = `
export function apply (ctx) {
  const go = (c) => { start(c.tools, c.webServer) }
  if (ctx.get('webServer') !== undefined) go(ctx)
  else ctx.inject(['tools', 'webServer'], go)
}`
const BUG_INDIRECT = `
export function apply (ctx) {
  const demarrerRoutes = (hostCtx) => {
    try { monterRoutes(kbSuivi(hostCtx !== null ? hostCtx.webServer : undefined), { ctx, hostCtx }) } catch (e) { dir('routes not mounted') }
  }
  const mountsRoutes = (c) => { try { demarrerRoutes(c) } catch (e) { dir('routes not mounted') } }
  if (ctx.get('webServer') !== undefined) mountsRoutes(ctx)
  else ctx.inject(['webServer'], mountsRoutes)
}`
const SAFE_GET = `
export function apply (ctx) {
  const demarrer = (hostCtx) => { mount(hostCtx.get('webServer'), { ctx: hostCtx }) }
  if (ctx.get('webServer') !== undefined) demarrer(ctx)
  else ctx.inject(['webServer'], demarrer)
}`
const SAFE_INLINE = `
export function apply (ctx) {
  if (ctx.get('webServer') !== undefined) mount(ctx.get('webServer'))
  else ctx.inject(['webServer'], (host) => mount(host.webServer))
}`
const SAFE_ONLY_INJECT = `
export function apply (ctx) {
  const demarrer = (c) => { mount(c.webServer) }
  ctx.inject(['webServer'], demarrer)
}`
const SAFE_TEXT = `
export function apply (ctx) {
  const demarrer = (c) => {
    // never read c.webServer here
    console.log('hostCtx.webServer is not read: use get')
    mount(c.get('webServer'))
  }
  if (ctx.get('webServer') !== undefined) demarrer(ctx)
  else ctx.inject(['webServer'], demarrer)
}`
ok('fixture: the direct call then a property read in an arrow body is found', scan(BUG).length === 1 && scan(BUG)[0].service === 'webServer' && scan(BUG)[0].fn === 'demarrer', scan(BUG))
ok('fixture: the same with a function declaration is found', scan(BUG_FN).length === 1 && scan(BUG_FN)[0].fn === 'monter', scan(BUG_FN))
ok('fixture: an expression-bodied arrow is found', scan(BUG_EXPR).length === 1, scan(BUG_EXPR))
ok('fixture: with two injected services only the one read as a property is found', scan(BUG_TWO).length === 2 && scan(BUG_TWO).map((x) => x.service).sort().join() === 'tools,webServer', scan(BUG_TWO))
ok('fixture: a read made by a local function the callback calls is found too (session-msg)', scan(BUG_INDIRECT).length === 1 && scan(BUG_INDIRECT)[0].fn === 'mountsRoutes -> demarrerRoutes', scan(BUG_INDIRECT))
ok('fixture: reading through get(\'webServer\') is fine', scan(SAFE_GET).length === 0, scan(SAFE_GET))
ok('fixture: an inline inject callback may read the property', scan(SAFE_INLINE).length === 0, scan(SAFE_INLINE))
ok('fixture: a named function that is only ever an inject callback may read the property', scan(SAFE_ONLY_INJECT).length === 0, scan(SAFE_ONLY_INJECT))
ok('fixture: comments and strings that mention the property are ignored', scan(SAFE_TEXT).length === 0, scan(SAFE_TEXT))
ok('strip keeps the length and the line breaks', (() => { const s = "a // x\n'b' `c\nd` /* e\nf */ g"; const t = strip(s); return t.length === s.length && t.split('\n').length === s.split('\n').length })())

// ── 2. Every tracked plugin source ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const files = execFileSync('git', ['ls-files', 'packages/*.js', 'packages/*.mjs'], { cwd: root, encoding: 'utf8' }).split('\n').filter((f) => f !== '' && !/(^|\/)(test[^/]*|[^/]*\.test)\.m?js$/.test(f) && !/\/check-/.test(f))
ok('the scan covers the plugin sources (more than 100 files)', files.length > 100, files.length)
let withInject = 0
const violations = []
for (const f of files) {
  const src = readFileSync(join(root, f), 'utf8')
  if (!src.includes('.inject(')) continue
  withInject++
  for (const v of scan(src)) violations.push(f + ':' + v.line + ' ' + v.fn + '() is also called directly but reads .' + v.service + ' as a property (read it with .get(\'' + v.service + '\'))')
}
ok('many plugin sources inject a service (the scan is not vacuous)', withInject >= 25, withInject)
ok('no plugin reads an injected service as a property in a function that is also called directly', violations.length === 0, violations)

console.log(failed === 0 ? '\nall passed' : '\n' + failed + ' FAILED')
process.exit(failed === 0 ? 0 : 1)
