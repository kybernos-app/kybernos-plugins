// Small helpers shared by this package's tests (not a test itself: the name does not start with "test").
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, symlinkSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'

export function suite() {
  let echecs = 0
  const ok = (label, cond, detail) => {
    if (cond) console.log(`✓ ${label}${detail === undefined ? '' : ` (${detail})`}`)
    else { console.error(`✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`); echecs += 1 }
  }
  const done = (name) => {
    console.log(echecs === 0 ? `\n${name}: all green.` : `\n✗ ${echecs} failure(s)`)
    process.exit(echecs === 0 ? 0 : 1)
  }
  return { ok, done, failures: () => echecs }
}

/** The folder of the js-yaml package that ships with the DSH engine on this machine, or null (CI has none). */
export function engineYamlDir() {
  if (process.env.NO_DSH_ENGINE === '1') return null
  const root = join(homedir(), '.dsh', 'kybernos', 'moteur')
  const dirs = []
  try { for (const v of readdirSync(root).sort().reverse()) dirs.push(join(root, v, 'node_modules')) } catch (e) { /* no engine */ }
  dirs.push('/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules')
  for (const d of dirs) {
    try { return dirname(createRequire(join(d, '@deepseek-ai', 'dsh-app-boot', 'package.json')).resolve('js-yaml/package.json')) } catch (e) { /* next */ }
  }
  return null
}

/** The js-yaml of the DSH engine on this machine, loading `!!js` as DSH does, or null (CI has none). */
export function engineYaml() {
  if (process.env.NO_DSH_ENGINE === '1') return null
  const root = join(homedir(), '.dsh', 'kybernos', 'moteur')
  const dirs = []
  try { for (const v of readdirSync(root).sort().reverse()) dirs.push(join(root, v, 'node_modules')) } catch (e) { /* no engine */ }
  dirs.push('/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules')
  for (const d of dirs) {
    try {
      const lib = createRequire(join(d, '@deepseek-ai', 'dsh-app-boot', 'package.json'))('js-yaml')
      const tag = new lib.Type('tag:yaml.org,2002:js', { kind: 'scalar', resolve: (s) => typeof s === 'string', construct: (s) => ({ __jsExpr: s }) })
      const schema = lib.JSON_SCHEMA.extend(tag)
      return { load: (text) => lib.load(text, { schema: schema }) }
    } catch (e) { /* next */ }
  }
  return null
}

/**
 * A fresh host half in a temp HOME: its own copy of the module state (a unique import query), the routes it
 * registered, and `call(path, { method, body, headers })` that plays a request and returns { code, json, text }.
 * `before(home)` runs before the module starts (to put files where DSH would have them at its start).
 */
export async function startHost({ before } = {}) {
  delete process.env.DSH_HOME
  const home = mkdtempSync(join(tmpdir(), 'kb-composio-host-'))
  process.env.HOME = home
  const dsh = join(home, '.dsh')
  mkdirSync(join(dsh, 'profiles', 'web'), { recursive: true })
  mkdirSync(join(dsh, 'kybernos'), { recursive: true })
  // The parser DSH uses, reachable from the profile folder the way it is on a real machine (the route looks for it there).
  const yamlDir = engineYamlDir()
  if (yamlDir !== null) { mkdirSync(join(dsh, 'profiles', 'web', 'node_modules'), { recursive: true }); symlinkSync(yamlDir, join(dsh, 'profiles', 'web', 'node_modules', 'js-yaml')) }
  if (before !== undefined) await before({ home, dsh, patch: join(dsh, 'profiles', 'web', 'cordis.patch.yml'), env: join(dsh, '.env'), sidecar: join(dsh, 'kybernos', 'connecteurs.json') })
  const mod = await import(new URL('./index.js', import.meta.url).href + '?host=' + Math.random().toString(36).slice(2))
  const routes = {}
  mod.apply({ get: (n) => (n === 'webServer' ? { register: (r) => { routes[r.path] = r.handler } } : undefined), effect: (fn) => fn(), inject: (_n, fn) => fn(), logger: { info: () => {} } })
  const call = async (path, { method = 'GET', body, headers = {}, raw } = {}) => {
    const handler = routes[path.split('?')[0]]
    if (typeof handler !== 'function') throw new Error('no route ' + path)
    const text = raw !== undefined ? raw : (body === undefined ? '' : JSON.stringify(body))
    const req = {
      method, url: path, socket: { localPort: 3080 },
      headers: Object.assign(method === 'GET' || method === 'DELETE' ? {} : { 'content-type': 'application/json' }, headers),
      on: (ev, fn) => { if (ev === 'data' && text.length > 0) fn(Buffer.from(text)); if (ev === 'end') setTimeout(() => fn(), 0) },
    }
    const res = { code: null, body: '', headers: {}, headersSent: false, setHeader() {}, writeHead(c, h) { this.code = c; this.headers = h || {} }, end(b) { this.body = String(b === undefined ? '' : b) } }
    await handler(req, res)
    let json = null
    try { json = JSON.parse(res.body) } catch (e) { json = null }
    return { code: res.code, json: json, text: res.body }
  }
  const files = {
    patch: join(dsh, 'profiles', 'web', 'cordis.patch.yml'), env: join(dsh, '.env'), sidecar: join(dsh, 'kybernos', 'connecteurs.json'),
    read: (f) => (existsSync(files[f]) ? readFileSync(files[f], 'utf8') : null),
    write: (f, t) => { mkdirSync(join(files[f], '..'), { recursive: true }); writeFileSync(files[f], t) },
  }
  return { call, routes, home, dsh, files, mod, stop: () => rmSync(home, { recursive: true, force: true }) }
}

/**
 * A fake streamable-http MCP server on 127.0.0.1 that can misbehave in the ways real ones do.
 * `state.mode`: normal, sse, paged, auth (wants "Bearer good"), oauth, down, html, slow, rpcerr.
 * `state.seen` holds every request it received. Resolves { url, state, close }.
 */
export async function fakeHttpMcp() {
  const state = { mode: 'normal', seen: [] }
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      state.seen.push({ method: req.method, headers: req.headers, body: raw })
      if (state.mode === 'down') { res.writeHead(503); return res.end('unavailable') }
      if (state.mode === 'auth' && req.headers.authorization !== 'Bearer good') { res.writeHead(401); return res.end('no') }
      if (state.mode === 'oauth') { res.writeHead(401, { 'www-authenticate': 'Bearer resource_metadata="https://x.example/.well-known/oauth-protected-resource"' }); return res.end('') }
      if (state.mode === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>captive portal</html>') }
      if (state.mode === 'slow') return // never answers
      if (req.method === 'DELETE') { res.writeHead(200); return res.end('') }
      let msg = null
      try { msg = JSON.parse(raw) } catch (e) { res.writeHead(400); return res.end('bad') }
      if (msg.method === 'notifications/initialized') { res.writeHead(202); return res.end('') }
      const reply = (obj, headers) => {
        if (state.mode === 'sse') { res.writeHead(200, Object.assign({ 'content-type': 'text/event-stream' }, headers || {})); return res.end('event: message\ndata: ' + JSON.stringify(obj) + '\n\n') }
        res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, headers || {}))
        res.end(JSON.stringify(obj))
      }
      if (msg.method === 'initialize') return reply({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'fake-http', version: '9.9' }, capabilities: { tools: {} } } }, { 'mcp-session-id': 'sess-1' })
      if (msg.method === 'tools/list') {
        if (state.mode === 'rpcerr') return reply({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'secret-abc-123 is not allowed' } })
        if (state.mode === 'paged' && !(msg.params && msg.params.cursor)) return reply({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'a' }], nextCursor: 'c2' } })
        if (state.mode === 'paged') return reply({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'b', description: 'second page' }] } })
        return reply({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'search', description: 'Searches' }, { name: 'extract' }, { bad: true }, { name: '' }] } })
      }
      res.writeHead(404); res.end('')
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { url: 'http://127.0.0.1:' + server.address().port + '/mcp', state: state, close: () => server.close() }
}

/** Writes a fake stdio MCP server (a Node script) in `dir` and returns its path. FAKE_MODE: normal, exit, leak, noise, silent. */
export function fakeStdioScript(dir) {
  const file = join(dir, 'fake-mcp.mjs')
  writeFileSync(file, `
import { createInterface } from 'node:readline'
const mode = process.env.FAKE_MODE || 'normal'
if (mode === 'exit') { process.stderr.write('boot failed: missing config\\n'); process.exit(3) }
if (mode === 'leak') process.stderr.write('using key ' + (process.env.MY_API_KEY || 'none') + '\\n')
if (mode === 'noise') console.log('server starting on stdout, which breaks the protocol')
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
const rl = createInterface({ input: process.stdin })
rl.on('line', (l) => {
  if (mode === 'silent' || mode === 'leak') return
  let m; try { m = JSON.parse(l) } catch (e) { return }
  if (m.method === 'initialize') return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'fake-stdio', version: '1.2' }, capabilities: {} } })
  if (m.method === 'tools/list') {
    const names = ['ping', 'cwd:' + process.cwd().split('/').pop(), 'secret_in_env:' + (process.env.SOME_TOKEN !== undefined), 'dsh_in_env:' + (process.env.DSH_HOME !== undefined), 'explicit:' + (process.env.EXPLICIT || '-'), 'path:' + (process.env.PATH !== undefined)]
    return send({ jsonrpc: '2.0', id: m.id, result: { tools: names.map((n) => ({ name: n })) } })
  }
})
`)
  return file
}
