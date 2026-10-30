// kybernos-db, host half: what apply() puts on a DSH context (thirteen tools, the approval, the prompt block, the skill) and that it never stops DSH from
// starting. Hermetic: a fake context, a temp DSH home, no network, no DSH.
//
//   node packages/kybernos-db/test-host.mjs
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SECTION_NAME, SECTION_ORDER } from './agent/context.mjs'
import { NAMES } from './agent/tools.mjs'
import { DB_TEMPLATE_POINT } from './template.mjs'
import { SEAM, SEEDED_SKILLS, SKILLS_DIR, apply, dbsDir, dshHome, lazyService, name, publishSeam, tellPoint, tellWhenReady } from './index.js'

let count = 0
const ok = async (label, fn) => { await fn(); count++; console.log('ok  ', label) }
const root = mkdtempSync(join(tmpdir(), 'kb-db-host-'))
let n = 0
const fresh = () => join(root, 'h' + (n++))
const clock = () => { let t = Date.UTC(2026, 9, 30, 9, 0, 0); return () => (t += 1) }
const sequence = () => { let i = 0; return (len) => { i += 1; return Uint8Array.from({ length: len }, (_, k) => (i * 31 + k * 7 + 1) & 255) } }
const options = (home) => ({ home, ports: { now: clock(), random: sequence() }, toolPorts: { today: () => '2026-10-30' } })

/** A context that records what is done to it: the services it has, the handlers, the effects. */
function fakeCtx ({ tools = true, agents = null, systemPrompt = false } = {}) {
  const registered = new Map()
  const handlers = new Map()
  const effects = []
  const sections = []
  const contexts = []
  const pending = []
  const services = {
    tools: tools ? { register: (tool) => { registered.set(tool.name, tool); return () => registered.delete(tool.name) } } : undefined,
    agents: agents === null ? undefined : agents,
  }
  const ctx = {
    registered, handlers, effects, sections, contexts,
    get: (service) => services[service],
    inject: (names, fn) => {
      if (names.includes('tools') && !tools) { pending.push(fn); return { dispose () {} } }
      const scope = { tools: services.tools, systemPrompt: { context: (c) => contexts.push(c), section: (s) => sections.push(s) } }
      fn(scope)
      return { dispose () {} }
    },
    on: (event, fn) => { handlers.set(event, fn); return () => handlers.delete(event) },
    effect: (fn, label) => effects.push({ fn, label }),
    late: () => { services.tools = { register: (tool) => { registered.set(tool.name, tool); return () => registered.delete(tool.name) } }; for (const fn of pending.splice(0)) fn({ get: (s) => services[s], tools: services.tools }) },
  }
  void systemPrompt
  return ctx
}

await ok('the bundle is named, keeps its dbs under the DSH home and ships one skill', () => {
  assert.equal(name, 'kybernos-db')
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = '/tmp/some-home'
  assert.equal(dshHome(), '/tmp/some-home')
  assert.equal(dbsDir(), join('/tmp/some-home', 'kybernos', 'kybernos-db', 'dbs'))
  process.env.DSH_HOME = ''
  assert.ok(dshHome().endsWith('.dsh'))
  if (saved === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = saved
  assert.deepEqual(SEEDED_SKILLS, ['db-builder'])
  assert.ok(existsSync(join(SKILLS_DIR, 'db-builder', 'SKILL.md')))
})

await ok('apply never throws, whatever it is handed', () => {
  for (const bad of [undefined, null, {}, { get: 3 }, { get () { throw new Error('boom') } }]) assert.doesNotThrow(() => apply(bad, options(fresh())), String(bad))
  const half = { get: () => undefined, inject () { throw new Error('inject is broken') }, on () { throw new Error('on is broken') }, effect () { throw new Error('effect is broken') } }
  assert.doesNotThrow(() => apply(half, options(fresh())))
})

await ok('it registers the thirteen tools, the approval, and cleans all of it up', async () => {
  const home = fresh()
  const ctx = fakeCtx()
  apply(ctx, options(home))
  assert.deepEqual([...ctx.registered.keys()], NAMES)
  assert.ok(ctx.handlers.has('tools/pre-execute'))
  assert.equal(ctx.effects.length, 1)
  assert.match(ctx.effects[0].label, /kybernos-db/)
  const made = await ctx.registered.get('db_create').execute({ name: 'Home' })
  assert.equal(made.ok, true)
  assert.ok(existsSync(join(dbsDir(home), made.db.id, 'db.sqlite')), 'the db is a file under the DSH home')
  const cleanup = ctx.effects[0].fn()
  assert.equal(typeof cleanup, 'function')
  cleanup()
  assert.equal(ctx.registered.size, 0, 'the tools are taken off')
  assert.equal(ctx.handlers.size, 0, 'the approval is taken off')
})

await ok('switching the bundle off closes the databases it opened', async () => {
  let closed = 0
  class Spy extends DatabaseSync { close () { closed += 1; return super.close() } }
  const ctx = fakeCtx()
  const opts = options(fresh())
  apply(ctx, { ...opts, ports: { ...opts.ports, sqlite: { DatabaseSync: Spy } } })
  assert.equal((await ctx.registered.get('db_create').execute({ name: 'Home' })).ok, true)
  assert.equal(closed, 0, 'it stays open while the bundle is on')
  ctx.effects[0].fn()()
  assert.ok(closed >= 1, 'the file is released when the bundle goes')
})

await ok('the tools are registered when the tools service appears later', () => {
  const ctx = fakeCtx({ tools: false })
  apply(ctx, options(fresh()))
  assert.equal(ctx.registered.size, 0)
  ctx.late()
  assert.deepEqual([...ctx.registered.keys()], NAMES)
})

await ok('a tools service that refuses a tool does not stop the others, nor DSH', () => {
  const ctx = fakeCtx()
  let seen = 0
  ctx.get = (s) => (s === 'tools' ? { register: () => { seen += 1; if (seen === 3) throw new Error('refused'); return () => {} } } : undefined)
  assert.doesNotThrow(() => apply(ctx, options(fresh())))
  assert.ok(seen <= NAMES.length)
})

await ok('the approval asks for a change of structure and lets everything else through', async () => {
  const home = fresh()
  const ctx = fakeCtx()
  apply(ctx, options(home))
  const gate = ctx.handlers.get('tools/pre-execute')
  const through = { passed: true }
  const next = async () => through
  assert.equal(await gate({ name: 'db_list', arguments: {} }, next), through)
  assert.equal(await gate({ name: 'contacts_upsert', arguments: {} }, next), through)
  const asked = await gate({ name: 'db_create', arguments: { name: 'Home' } }, next)
  assert.equal(asked.kind, 'ask')
  assert.match(asked.displayReason.fr, /^Créer la base de données “Home”/)
  await ctx.registered.get('db_create').execute({ name: 'Home' })
  const def = await gate({ name: 'object_define', arguments: { key: 't', label: 'T', fields: [{ key: 'n', type: 'text', label: 'N' }] } }, next)
  assert.equal(def.kind, 'ask')
  assert.equal(await gate({ name: 'records_list', arguments: { object: 't' } }, next), through)
  assert.equal(await gate(null, next), through, 'a malformed call is the next handler’s business')
})

await ok('a db that cannot be opened is a refusal with its own code, never a throw', async () => {
  const home = fresh()
  const ctx = fakeCtx()
  apply(ctx, { ...options(home), ports: { sqlite: null } })
  const made = await ctx.registered.get('db_create').execute({ name: 'Home' })
  assert.equal(made.ok, false)
  assert.equal(made.error, 'sqlite_unavailable')
  const list = await ctx.registered.get('db_list').execute()
  assert.deepEqual(list, { ok: true, dbs: [], unreadable: [] })
  const gate = ctx.handlers.get('tools/pre-execute')
  assert.equal((await gate({ name: 'db_create', arguments: { name: 'Home' } }, async () => null)).kind, 'ask', 'the person is still asked, then told it cannot be done')
})

await ok('a dbs folder that is a file does not stop apply nor the tools', async () => {
  const home = fresh()
  mkdirSync(join(home, 'kybernos', 'kybernos-db'), { recursive: true })
  writeFileSync(dbsDir(home), 'not a folder')
  const ctx = fakeCtx()
  assert.doesNotThrow(() => apply(ctx, options(home)))
  const list = await ctx.registered.get('db_list').execute()
  assert.equal(list.ok, true)
  assert.deepEqual(list.dbs, [])
  const made = await ctx.registered.get('db_create').execute({ name: 'Home' }).then((r) => r, (e) => ({ ok: false, thrown: String(e && e.message) }))
  assert.equal(made.ok, false, 'a broken folder is never a created db')
})

await ok('the skill is seeded into the DSH home, left alone once the person edited it, and not brought back once switched off', () => {
  const home = fresh()
  apply(fakeCtx(), options(home))
  const file = join(home, 'skills', 'db-builder', 'SKILL.md')
  const shipped = readFileSync(join(SKILLS_DIR, 'db-builder', 'SKILL.md'), 'utf8')
  assert.equal(readFileSync(file, 'utf8'), shipped)
  assert.match(shipped, /^---\nname: db-builder\n/)
  apply(fakeCtx(), options(home))
  assert.equal(readFileSync(file, 'utf8'), shipped)
  writeFileSync(file, shipped + '\nMy own line.\n')
  apply(fakeCtx(), options(home))
  assert.ok(readFileSync(file, 'utf8').endsWith('My own line.\n'), 'a skill the person edited is never overwritten')
  const other = fresh()
  mkdirSync(join(other, 'skills', 'db-builder'), { recursive: true })
  writeFileSync(join(other, 'skills', 'db-builder', 'SKILL.md.disabled'), '')
  apply(fakeCtx(), options(other))
  assert.equal(existsSync(join(other, 'skills', 'db-builder', 'SKILL.md')), false)
})

await ok('the skill names only tools that exist, and covers the three protection rules', () => {
  const text = readFileSync(join(SKILLS_DIR, 'db-builder', 'SKILL.md'), 'utf8')
  const used = [...new Set([...text.matchAll(/`((?:db|object|field|relation|view|records)_[a-z]+)`/g)].map((m) => m[1]))]
  assert.ok(used.length >= 8, 'it teaches the tools')
  for (const tool of used) assert.ok(NAMES.includes(tool), 'the skill names a tool that does not exist: ' + tool)
  for (const tool of NAMES) assert.ok(text.includes('`' + tool + '`'), 'the skill never mentions ' + tool)
  for (const word of ['personal', 'sensitive', 'secret', 'raise', 'never deleted']) assert.ok(text.toLowerCase().includes(word.toLowerCase()), 'the skill says ' + word)
  assert.match(text, /whenToUse:/)
})

await ok('the prompt block is a section for each agent, the same text each time, empty until there is a db', async () => {
  const home = fresh()
  const agentA = { ctx: { inject: (names, fn) => { const scope = { systemPrompt: { section: (s) => agentA.sections.push(s) } }; fn(scope); return { dispose () { agentA.disposed = true } } } }, sections: [] }
  const ctx = fakeCtx({ agents: [agentA] })
  apply(ctx, options(home))
  assert.equal(agentA.sections.length, 1)
  const [section] = agentA.sections
  assert.equal(section.name, SECTION_NAME)
  assert.equal(section.order, SECTION_ORDER)
  assert.equal(section.text(), '', 'nothing to say until there is a db')
  await ctx.registered.get('db_create').execute({ name: 'Home' })
  await ctx.registered.get('object_define').execute({ key: 'task', label: 'Tasks', fields: [{ key: 'name', type: 'text', label: 'Name', required: true }, { key: 'email', type: 'email', label: 'Email', protection: 'personal' }] })
  const first = section.text()
  assert.match(first, /Database “Home”/)
  assert.match(first, /email \(email, personal\)/)
  assert.equal(section.text(), first, 'unchanged while nothing changes')
  await ctx.registered.get('field_add').execute({ object: 'task', field: { key: 'due', type: 'date', label: 'Due' } })
  assert.match(section.text(), /due \(date\)/, 'a new field is in the next prompt')
  // a new agent is caught through the engine’s event, a disposed one lets go
  const agentB = { ctx: { inject: (names, fn) => { fn({ systemPrompt: { section: (s) => agentB.sections.push(s) } }); return { dispose () { agentB.disposed = true } } } }, sections: [] }
  ctx.handlers.get('agent/created')({ agent: agentB })
  assert.equal(agentB.sections.length, 1)
  ctx.handlers.get('agent/disposed')({ agent: agentB })
  assert.equal(agentB.disposed, true)
  ctx.handlers.get('agent/created')({ agent: agentB })
  assert.equal(agentB.sections.length, 2, 'an agent that came back gets a section again')
})

await ok('with no agent registry the block goes into the durable context instead, once', async () => {
  const ctx = fakeCtx()
  apply(ctx, options(fresh()))
  assert.equal(ctx.sections.length, 0)
  assert.equal(ctx.contexts.length, 1)
  assert.equal(ctx.contexts[0].name, SECTION_NAME)
  assert.equal(ctx.contexts[0].text(), '')
  await ctx.registered.get('db_create').execute({ name: 'Shop' })
  assert.match(ctx.contexts[0].text(), /Database “Shop”/)
})

await ok('a section that cannot be installed falls back to the context, and a broken text provider gives nothing', () => {
  const broken = { ctx: { inject () { throw new Error('older engine') } } }
  const ctx = fakeCtx({ agents: [broken] })
  assert.doesNotThrow(() => apply(ctx, options(fresh())))
  assert.equal(ctx.contexts.length, 1, 'the last resort is installed')
  const home = fresh()
  const svcCtx = fakeCtx()
  apply(svcCtx, { ...options(home), ports: { now: 'not a function' } })
  assert.equal(typeof svcCtx.contexts[0].text(), 'string', 'the provider never throws')
})

await ok('the point of the templates is told to the registry, again until it hears, and a missing or broken registry changes nothing', () => {
  const REGISTRY = Symbol.for('kybernos.registry')
  const before = globalThis[REGISTRY]
  try {
    delete globalThis[REGISTRY]
    assert.equal(tellPoint(), false, 'no registry yet')
    const told = []
    const timers = []
    const heard = tellWhenReady({ schedule: (fn) => { timers.push(fn); return { unref () {} } }, delays: [1, 2] })
    assert.equal(heard(), false)
    globalThis[REGISTRY] = { version: 1, definePoint: (p) => told.push(p) }
    timers.shift()()
    assert.equal(heard(), true)
    assert.deepEqual(told, [DB_TEMPLATE_POINT])
    assert.equal(told[0].owner + '#' + told[0].name, 'kybernos/db#template')
    globalThis[REGISTRY] = { version: 1, definePoint () { throw new Error('refused') } }
    assert.equal(tellPoint(), false, 'a registry that throws is not an error')
    globalThis[REGISTRY] = { version: 2, definePoint () {} }
    assert.equal(tellPoint(), false, 'a registry of another version is not spoken to')
  } finally {
    if (before === undefined) delete globalThis[REGISTRY]
    else globalThis[REGISTRY] = before
  }
})

await ok('apply publishes the install seam for the core and takes it off again with the bundle', async () => {
  const before = globalThis[SEAM]
  try {
    delete globalThis[SEAM]
    const home = fresh()
    const ctx = fakeCtx()
    apply(ctx, options(home))
    const seam = globalThis[SEAM]
    assert.equal(seam.version, 1)
    assert.equal(typeof seam.install, 'function')
    assert.ok(Object.isFrozen(seam))
    const bad = seam.install({ template: 'x' })
    assert.equal(bad.ok, false)
    assert.equal(bad.error, 'template')
    const template = { id: 'tiny', name: { en: 'Tiny' }, objects: [{ key: 'thing', label: { en: 'Things' }, fields: [{ key: 'name', type: 'text', label: { en: 'Name' } }] }] }
    const made = seam.install({ template, sample: { rows: { thing: [{ values: { name: 'One' } }] } }, lang: 'en' })
    assert.equal(made.ok, true, JSON.stringify(made))
    assert.equal(made.counts.rows, 1)
    assert.equal(existsSync(join(home, 'kybernos', 'kybernos-db', 'templates.json')), true, 'the marker sits beside the dbs folder')
    assert.equal(seam.install({ template }).skipped, true)
    for (const e of ctx.effects) { const dispose = e.fn(); if (typeof dispose === 'function') dispose() }
    assert.equal(globalThis[SEAM], undefined, 'the seam goes with the bundle')
    const other = publishSeam(lazyService(join(fresh(), 'dbs')))
    const mine = globalThis[SEAM]
    globalThis[SEAM] = { version: 1, install () {} }
    other()
    assert.notEqual(globalThis[SEAM], mine, 'taking it off leaves another bundle’s seam alone')
    assert.equal(typeof globalThis[SEAM].install, 'function')
  } finally {
    if (before === undefined) delete globalThis[SEAM]
    else globalThis[SEAM] = before
  }
})

await ok('the service is made when first asked, not at boot', () => {
  const dir = join(fresh(), 'never-made')
  const get = lazyService(dir)
  assert.equal(existsSync(dir), false)
  const a = get()
  assert.equal(get(), a)
  a.close()
})

console.log('\nkybernos-db host: ' + count + ' checks passed')
