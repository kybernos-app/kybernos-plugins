// index.js (apply) over a fake ctx: what it registers, what it never does, and that a missing service or a throwing ctx cannot stop DSH.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'kb-fd-host-'))
const dsh = join(home, '.dsh')
process.env.DSH_HOME = dsh
const { installSession } = await import('./lib-session-test.mjs')
installSession(dsh)
const { apply, name, SEEDED_SKILLS, literalDefinition, specDefinition } = await import('./index.js')
const { createConfigStore } = await import('./fd-config.mjs')
const { ROUTE } = await import('./fd-routes.mjs')
const { BRIEF } = await import('./fd-brief.mjs')

let failed = 0
const ok = (n, cond, detail) => { console.log((cond ? '  ok   ' : '  FAIL ') + n + (cond || detail === undefined ? '' : '  -- ' + detail)); if (!cond) failed += 1 }
const quiet = async (fn) => { const log = console.log; const lines = []; console.log = (...a) => lines.push(a.join(' ')); try { return { value: await fn(), lines } } finally { console.log = log } }
const until = async (cond, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (cond()) return true; await new Promise((r) => setTimeout(r, 25)) } return cond() }

/** A permissive fake of the context DSH hands a plugin. */
function fakeCtx (over = {}) {
  const rec = { routes: [], removed: [], tools: [], blocks: [], handlers: new Map(), cleanups: [], injected: [] }
  const webServer = { register: (r) => { rec.routes.push(r); return () => rec.removed.push(r.path) } }
  const tools = { register: (t) => { rec.tools.push(t) } }
  const services = { webServer, tools, ...(over.services || {}) }
  const ctx = {
    get: (n) => services[n],
    effect: (fn, label) => { const cleanup = fn(); rec.cleanups.push({ label, cleanup }); return cleanup },
    on: (event, fn) => { rec.handlers.set(event, fn); return () => rec.handlers.delete(event) },
    inject: (names, cb) => { rec.injected.push(names); cb({ get: ctx.get, systemPrompt: { context: (b) => rec.blocks.push(b) }, ...services }) },
    ...(over.ctx || {}),
  }
  return { ctx, rec }
}

ok('the bundle is named for its folder', name === 'kybernos-front-desk' && SEEDED_SKILLS.join() === 'front-desk-fiche')

// ── a normal start ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const { ctx, rec } = fakeCtx()
  const r = await quiet(() => apply(ctx))
  ok('apply returns without throwing and without starting anything', !('threw' in r) && !existsSync(createConfigStore({ home: dsh }).pidFile))
  const toolOk = await until(() => rec.tools.length === 1)
  ok('the front_desk tool is registered once', toolOk && rec.tools[0].name === 'front_desk' && typeof rec.tools[0].execute === 'function' && rec.tools[0].description.length > 100)
  const paths = rec.routes.map((x) => x.path)
  ok('the routes are mounted under the plugin\'s own prefix, and nowhere else', ['state', 'config', 'start', 'stop', 'logs', 'atelier', 'boite', 'preview'].every((p) => paths.includes(`${ROUTE}/${p}`)) && paths.includes(ROUTE + '/api') && paths.every((p) => p.startsWith(ROUTE + '/')))
  ok('a prefix route has no trailing slash: DSH matches `path` or `path/…`, so `/api/` matched nothing (seen on a real DSH)', rec.routes.filter((x) => x.kind === 'prefix').length === 1 && rec.routes.filter((x) => x.kind === 'prefix').every((x) => !x.path.endsWith('/')))
  ok('no route of a visitor (the public chat is served by the service itself, on its own address)', !paths.some((p) => /\/c\/|\/v1\//.test(p)))
  ok('a prompt block is registered, its text empty until a front desk is set up', rec.blocks.length === 1 && rec.blocks[0].name === 'kybernos:front-desk' && rec.blocks[0].text() === '')
  const cfg = createConfigStore({ home: dsh })
  cfg.write({ model: { baseUrl: 'https://api.example.com/v1', name: 'm1', apiKey: 'sk-test-0123456789abcdef' } })
  ok('…and the brief once a model is configured', rec.blocks[0].text() === BRIEF)
  ok('the approval gate sits on tools/pre-execute: another tool goes straight through, a publish with the service stopped too', typeof rec.handlers.get('tools/pre-execute') === 'function' && (await rec.handlers.get('tools/pre-execute')({ name: 'bash', arguments: { action: 'publish' } }, async () => 'NEXT')) === 'NEXT' && (await rec.handlers.get('tools/pre-execute')({ name: 'front_desk', arguments: { action: 'publish' } }, async () => 'NEXT')) === 'NEXT')
  ok('the tool, with the service stopped, says so', (await rec.tools[0].execute({ action: 'status' })).error === 'service_stopped')

  // a route, through the real apply: the guard is on
  const route = rec.routes.find((x) => x.path === ROUTE + '/state')
  const res = { code: 0, body: '', writeHead (c) { this.code = c }, end (b) { this.body = b } }
  await route.handler({ method: 'GET', url: ROUTE + '/state', headers: { host: '127.0.0.1:3080' }, socket: { localPort: 3080 } }, res)
  ok('a request with no DSH session is refused before the route runs', res.code >= 400 && res.code < 500 && !/secrets|modelKey/.test(String(res.body)), res.code)

  // switching the plugin off
  for (const c of rec.cleanups.slice().reverse()) { try { if (typeof c.cleanup === 'function') await c.cleanup() } catch (e) { /* the engine ignores too */ } }
  ok('switching it off takes every route and the gate away', rec.removed.length === rec.routes.length && !rec.handlers.has('tools/pre-execute'), `${rec.removed.length}/${rec.routes.length}`)
  ok('…and its effects are labelled, one per concern', rec.cleanups.every((c) => /^kybernos-front-desk: /.test(c.label)))
}

// ── the skill ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const file = join(dsh, 'skills', 'front-desk-fiche', 'SKILL.md')
  ok('the skill that drives the tool is put where DSH looks for skills', existsSync(file) && /^name: front-desk-fiche/m.test(readFileSync(file, 'utf8')))
}

// ── a context that is not what it should be: DSH must still start ──────────────────────────────────────────────────────────────────────────
{
  const cases = {
    'no ctx at all': () => apply(null),
    'an empty ctx': () => apply({}),
    'get throws': () => apply({ get () { throw new Error('boom') }, inject () {}, effect () {}, on () {} }),
    'inject throws': () => apply({ get: () => undefined, inject () { throw new Error('boom') }, effect () {}, on () {} }),
    'effect throws': () => apply({ get: () => undefined, inject () {}, effect () { throw new Error('boom') }, on () {} }),
    'on throws': () => apply({ get: () => undefined, inject () {}, effect () {}, on () { throw new Error('boom') } }),
    'no services yet (they arrive later)': () => apply({ get: () => undefined, inject () {}, effect () {}, on () {} }),
    'a webServer whose register throws': () => apply(fakeCtx({ services: { webServer: { register () { throw new Error('boom') } } } }).ctx),
    'a tools service whose register throws': () => apply(fakeCtx({ services: { tools: { register () { throw new Error('boom') } } } }).ctx),
  }
  for (const [label, run] of Object.entries(cases)) {
    let threw = null
    try { await quiet(async () => { run(); await new Promise((r) => setTimeout(r, 40)) }) } catch (e) { threw = e }
    ok(`apply never throws: ${label}`, threw === null, threw && threw.message)
  }
  const late = fakeCtx({ services: { webServer: undefined, tools: undefined } })
  let delivered = null
  late.ctx.get = () => undefined
  late.ctx.inject = (names, cb) => { if (names.includes('tools')) delivered = cb; else cb({ systemPrompt: { context () {} } }) }
  await quiet(async () => apply(late.ctx))
  ok('services that arrive later are waited for (inject), not assumed', typeof delivered === 'function')
  const rec2 = { routes: [], tools: [] }
  await quiet(async () => { delivered({ get: (n) => ({ webServer: { register: (r) => { rec2.routes.push(r) } }, tools: { register: (t) => { rec2.tools.push(t) } } })[n] }); await until(() => rec2.tools.length === 1) })
  ok('…and the routes and the tool are there when they do', rec2.routes.length >= 9 && rec2.tools.length === 1)
}

// ── a tool is built even when dsh-tools cannot be imported ──────────────────────────────────────────────────────────────────────────────────
{
  const o = { name: 'x', description: 'd', parameters: { a: { type: 'string' } }, render: () => [], execute: async () => ({}) }
  const lit = literalDefinition(o)
  const spec = specDefinition(o)
  ok('the two fallback shapes carry the name, the parameters and the executor', lit.name === 'x' && lit.parameters.properties.a.type === 'string' && typeof lit.execute === 'function' && spec.parameters.a.type === 'string' && spec.output.schema.type === 'json')
}

// ── nothing leaks ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const { ctx } = fakeCtx()
  const r = await quiet(async () => { apply(ctx); await new Promise((x) => setTimeout(x, 60)) })
  ok('the log lines of a start carry no key and no token', !r.lines.join('\n').match(/sk-test|ownerToken|Bearer/))
  ok('by default nothing starts by itself: the owner starts the service, and the choice is remembered', createConfigStore({ home: dsh }).read().autostart === false)
}
process.exit(failed ? 1 : 0)
