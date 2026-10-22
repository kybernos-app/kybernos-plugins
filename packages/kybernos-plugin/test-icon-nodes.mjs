#!/usr/bin/env node
/** The icon picker never shows one glyph over and over (2026-10-23). The nodes of the icons are fetched once; the default glyph used to stand in for every icon the
 *  page does not carry, and a refused answer (the host restarting) left it there until the page was reloaded. Now a refusal is retried, the tile is blank while the
 *  set is on its way, and the default glyph shows only when no set is coming.
 *  Usage: node packages/kybernos-plugin/test-icon-nodes.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const client = readFileSync(process.env.KB_PLUGIN_CLIENT || join(here, 'client.js'), 'utf8')
const between = (a, b) => {
  const i = client.indexOf(a)
  const j = client.indexOf(b, i + 1)
  assert.ok(i >= 0 && j > i, a + ' … ' + b + ' were found')
  return client.slice(i, j)
}
const tick = () => new Promise((r) => setImmediate(r))

const make = (answers) => {
  const timers = []
  const calls = []
  let bumps = 0
  const ctx = {
    Object, Array, Promise, String,
    kbRemoteOk: true,
    kbApiBase: () => '/kybernos',
    kbBumpIcons: () => { bumps += 1 },
    h: (tag, props) => ({ tag, props }),
    Icon: (name) => (name === 'star' || name === 'waypoints' ? { glyph: name } : null),
    KB_DEFAULT_ICON: 'waypoints',
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    fetch: (url) => { calls.push(url); const a = answers.shift(); return a instanceof Error ? Promise.reject(a) : Promise.resolve(a) },
  }
  vm.createContext(ctx)
  vm.runInContext(between('const kbIconCache = {}', '// Menu icon sets (kybernos-theme)') + '\n' + between('let kbCatalogLoaded = false', '// ── Donnees propres a un projet') + '\nthis.dyn = KbDynIcon; this.load = kbLoadIconNodes; this.cache = kbIconCache; this.pending = () => kbIconsPending', ctx)
  return { ctx, timers, calls, bumps: () => bumps }
}
const good = { ok: true, json: () => Promise.resolve({ nodes: { rocket: [['path', { d: 'M0 0' }]] } }) }
const refused = { ok: false, status: 502, json: () => Promise.resolve(null) }
const empty = { ok: true, json: () => Promise.resolve({ nodes: {} }) }

// before the first answer an icon the page does not carry is blank, a built-in one is drawn
{
  const t = make([good])
  assert.equal(t.ctx.pending(), true)
  assert.equal(t.ctx.dyn({ name: 'rocket', size: 20 }).tag, 'span')
  assert.deepEqual(t.ctx.dyn({ name: 'star', size: 20 }), { glyph: 'star' })
  t.ctx.load()
  await tick(); await tick()
  assert.equal(t.ctx.pending(), false)
  assert.equal(t.ctx.dyn({ name: 'rocket', size: 20 }).tag, 'svg')
  assert.equal(t.bumps(), 1)
  ok('blank until the set arrives, then the real glyph; the page is told once')
}

// a refusal, an empty answer and a network error are retried, then the default glyph
{
  const t = make([refused, empty, new Error('offline'), refused, refused])
  t.ctx.load()
  await tick(); await tick()
  assert.equal(t.timers.length, 1)
  assert.equal(t.timers[0].ms, 1500)
  assert.equal(t.ctx.pending(), true)
  assert.equal(t.ctx.dyn({ name: 'rocket', size: 20 }).tag, 'span')
  ok('a refused answer schedules a retry and keeps the tiles blank')
  for (const expected of [4000, 10000, 30000]) {
    t.timers.shift().fn()
    await tick(); await tick()
    assert.equal(t.timers.length, 1)
    assert.equal(t.timers[0].ms, expected)
  }
  t.timers.shift().fn()
  await tick(); await tick()
  assert.equal(t.calls.length, 5)
  assert.equal(t.timers.length, 0, 'no retry after the last one')
  assert.equal(t.ctx.pending(), false)
  assert.deepEqual(t.ctx.dyn({ name: 'rocket', size: 20 }), { glyph: 'waypoints' })
  ok('an empty answer and a network error count too; after the last try the default glyph shows')
}

// a retry that works fills the set
{
  const t = make([refused, good])
  t.ctx.load()
  await tick(); await tick()
  t.timers.shift().fn()
  await tick(); await tick()
  assert.equal(t.ctx.pending(), false)
  assert.equal(t.ctx.dyn({ name: 'rocket', size: 20 }).tag, 'svg')
  ok('a retry that works fills the set')
}

// no host: nothing is coming, the default glyph shows at once
{
  const t = make([])
  t.ctx.kbRemoteOk = false
  t.ctx.load()
  assert.equal(t.ctx.pending(), false)
  assert.deepEqual(t.ctx.dyn({ name: 'rocket', size: 20 }), { glyph: 'waypoints' })
  assert.equal(t.calls.length, 0)
  ok('without a host the default glyph shows at once and nothing is fetched')
}

console.log(pass + ' tests passed')
