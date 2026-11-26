#!/usr/bin/env node
// The engine's first-screen step (« Get started — Sign in to your DeepSeek account or add an API Key »), replaced by the core.
// The block `<kb-engine-signin-step>` of client.js is cut out and run alone against a fake slot registry and a fake React.
//
//   node packages/kybernos-plugin/test-engine-signin-step.mjs
//
// A3-03, A5-34, A6-01: on a fresh install DSH's own dialog covered the first screen after every load, in the name of a DeepSeek
// account nobody of Kybernos has, over the wizard that had just asked the same question. The page-level proof is the sandbox
// (see the commit): this file holds the decisions: which step it takes, that it paints nothing, that it says it is done, and that
// an engine without the slot does not stop the plugin.
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const a = SRC.indexOf('// <kb-engine-signin-step>')
const b = SRC.indexOf('// </kb-engine-signin-step>', a)
check('the block can be cut out of client.js', a > 0 && b > a)
if (a < 0 || b < a) { console.log(`\n${pass} ✓  ${fail} ✗`); process.exit(1) }
const BODY = SRC.slice(a, b)

/** Runs the block over a fake page; `slotsThrow` makes the registry refuse (an engine without the slot). */
const load = (slotsThrow) => {
  const log = { injected: [], registered: [], effects: [], effectsRun: [] }
  const slots = {
    inject: (slot, factory) => {
      if (slotsThrow) throw new Error('unknown slot')
      log.injected.push(slot)
      return factory()
    },
    register: (options, component) => { log.registered.push({ options, component }); return () => {} },
  }
  const ctx = { effect: (fn, label) => { log.effects.push(label); fn(); log.effectsRun.push(label) } }
  const React = { useEffect: (fn) => { log.mounted = fn } }
  new Function('ctx', 'slots', 'React', BODY)(ctx, slots, React)
  return log
}

console.log('the step that is registered')
{
  const log = load(false)
  const reg = log.registered[0]
  check('one entry is registered in `settings.onboarding`', log.injected.length === 1 && log.injected[0] === 'settings.onboarding' && log.registered.length === 1, log.injected)
  check('it takes the engine\'s own cell: the shipped id `deepseek-official`', reg !== undefined && reg.options.id === 'deepseek-official', reg && reg.options)
  check('at a priority lower than the shipped entry (the lowest renders; the same one is refused)', reg !== undefined && typeof reg.options.priority === 'number' && reg.options.priority < 0, reg && reg.options)
  check('it is registered through ctx.effect, so it goes away with the plugin', log.effectsRun.length === 1)
}

console.log('what it does')
{
  const log = load(false)
  const comp = log.registered[0].component
  let completed = 0
  const painted = comp({ stepId: 'deepseek-official', complete: () => { completed += 1 }, openSection: () => {} })
  check('it paints nothing', painted === null, painted)
  check('and says the step is done once it is mounted, so the shell moves on', typeof log.mounted === 'function' && (log.mounted(), completed === 1), completed)
  const bare = comp({})
  check('without a `complete` (an older shell) it still paints nothing and does not throw', bare === null)
}

console.log('an engine without the slot')
{
  let threw = false
  try { load(true) } catch (e) { threw = true }
  check('does not stop the plugin: the engine keeps its own dialog', threw === false)
}

console.log(`\n${pass} ✓  ${fail} ✗`)
process.exit(fail === 0 ? 0 : 1)
