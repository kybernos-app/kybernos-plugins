#!/usr/bin/env node
// The right column shows a tool only in a chat that has something for it.
//
//   node scripts/test-right-tab-gate.mjs
//
// Why: the « Start » page of the right column listed every tool in every chat, and a tab opened once in a chat (Databases, Slides...) came back each time
// that chat was opened, so the column showed tools that had nothing to do with the chat on screen. Each tool now says whether the chat has content for it
// (`has(sessionId)`: true, false, or null when it cannot tell): a tool that answers false loses its tile (a style sheet, no engine patch) and a tab of it
// left in that chat closes itself. One shared registry per page, so six bundles make one poll and one style sheet.
// No browser: the `KB-TABGATE` block is cut out of every bundle and run as it ships, with a stub page, stub React and stub timers.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages')
let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}

// [plugin, the file that carries the block, the file the browser loads when it is built from the first one, the tab kind]
const TOOLS = [
  ['kybernos-slides', 'src/plugin.js', 'client.js', 'kybernos-slides'], ['kybernos-motion', 'src/plugin.js', 'client.js', 'kybernos-motion'],
  ['kybernos-dashboards', 'src/plugin.js', 'client.js', 'kybernos-dashboards'], ['kybernos-modeleur', 'client.js', undefined, 'kybernos-modeleur'],
  ['kybernos-bricks', 'client.js', undefined, 'kybernos-bricks'], ['dsh-db-viewer', 'src/plugin.js', 'client/client.js', 'dsh-db-viewer'],
]
const cut = (text) => { const a = text.indexOf('// KB-TABGATE-BEGIN'); const b = text.indexOf('// KB-TABGATE-END'); return a < 0 || b < a ? null : text.slice(a, b + '// KB-TABGATE-END'.length) }
const flat = (t) => t.split('\n').map((l) => l.trim()).join('\n')

console.log('every tool carries the same gate and wires it')
let canon = null
for (const [plugin, file, built, kind] of TOOLS) {
  const text = readFileSync(join(ROOT, plugin, file), 'utf8')
  const src = cut(text)
  check(plugin + ' carries the gate', src !== null)
  if (src === null) continue
  if (canon === null) canon = flat(src)
  check(plugin + ': the same text as the others', flat(src) === canon)
  check(plugin + ': it declares its own `has` for its own kind', /GATE = kbTabGate\(\{ ctx, kind: KIND, has: async \(sid\) =>/.test(text))
  check(plugin + ': it joins the registry and leaves with the plugin', /ctx\.effect\(\(\) => GATE\.join\(\), '[^']+: right tool gate'\)/.test(text))
  check(plugin + ': its tab body closes itself when the chat has nothing', /GATE !== null\) GATE\.useEmptyClose\(props\)/.test(text))
  check(plugin + ': its kind is the one the tile carries', new RegExp("const KIND = '" + kind + "'").test(text))
  if (built !== undefined) check(plugin + ': the built client holds the same gate (rebuild with scripts/build.mjs)', flat(readFileSync(join(ROOT, plugin, built), 'utf8')).includes(canon))
}

// ── behaviour ───────────────────────────────────────────────────────────────
const block = cut(readFileSync(join(ROOT, 'kybernos-slides', 'src/plugin.js'), 'utf8'))
const settle = () => new Promise((r) => setImmediate(r))
function page () {
  const timers = []
  let tiles = true // is the Start page on screen
  const head = { appendChild (el) { el.parentNode = head }, removeChild (el) { el.parentNode = null } }
  const document = { head, createElement: () => ({ setAttribute () {}, textContent: '', parentNode: null }), querySelector: () => (tiles ? {} : null) }
  const effects = []
  const React = { useEffect: (fn, deps) => { effects.push({ fn, deps }) } }
  const win = { document }
  const sandbox = {
    window: win, React, Promise, Date, Map, Set, Array, JSON,
    setInterval: (f, ms) => { timers.push({ f, ms, kind: 'interval', live: true }); return timers.length },
    clearInterval: (id) => { if (timers[id - 1]) timers[id - 1].live = false },
    setTimeout: (f, ms) => { timers.push({ f, ms, kind: 'timeout', live: true }); return timers.length },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].live = false },
  }
  const make = vm.runInNewContext(block + '\nkbTabGate', sandbox)
  return {
    win, timers, effects, document, make,
    setTiles: (v) => { tiles = v },
    style: () => (win.__KB_TABGATE__ && win.__KB_TABGATE__.style ? win.__KB_TABGATE__.style.textContent : null),
    // the polling interval of the registry: the one whose period is 1200 ms
    poll: async () => { const t = timers.find((x) => x.kind === 'interval' && x.ms === 1200 && x.live); if (t) t.f(); await settle(); await settle() },
  }
}
const ctxOf = (state) => ({ get: (k) => (k === 'uiSession' ? { adapter: { current: { getSnapshot: () => ({ key: state.key }) } } } : undefined) })
const hides = (css, kind) => typeof css === 'string' && css.includes('[data-sidebar-right-guide-entry="' + kind + '"]')

console.log('a tool with nothing in the chat loses its tile, the others keep theirs')
{
  const p = page()
  const state = { key: 'chat-1' }
  const answers = { A: { 'chat-1': false, 'chat-2': true }, B: { 'chat-1': true, 'chat-2': false }, C: { 'chat-1': null, 'chat-2': null } }
  const calls = []
  const joins = ['A', 'B', 'C'].map((k) => {
    const gate = p.make({ ctx: ctxOf(state), kind: k, has: async (sid) => { calls.push(k + '@' + sid); return answers[k][sid] } })
    return gate.join()
  })
  await p.poll()
  check('chat 1: A (empty) is hidden, B (has content) shows', hides(p.style(), 'A') && !hides(p.style(), 'B'), p.style())
  check('chat 1: C (cannot tell) is never hidden', !hides(p.style(), 'C'))
  check('the rule hides the whole cell around the tile, nothing else', /div:has\(> \[data-sidebar-right-guide-entry="A"\]\)\{display:none!important\}/.test(p.style()))
  state.key = 'chat-2'
  await p.poll()
  check('chat 2: the verdicts follow the chat on screen (B hidden now, A back)', hides(p.style(), 'B') && !hides(p.style(), 'A') && !hides(p.style(), 'C'), p.style())
  // a tool whose question throws, or never answers, is not hidden
  const q = page(); const s2 = { key: 'chat-1' }
  q.make({ ctx: ctxOf(s2), kind: 'X', has: async () => { throw new Error('host down') } }).join()
  await q.poll()
  check('a question that fails hides nothing', !hides(q.style(), 'X'), q.style())
  // the Start page is not on screen: no question is asked
  const n0 = calls.length
  p.setTiles(false)
  await p.poll()
  check('with the Start page closed and the chat unchanged, nobody is asked', calls.length === n0, calls.slice(n0))
  // leaving: the last tool to leave takes the style sheet and the poll with it
  joins.forEach((j) => j())
  check('when the last tool leaves, the style sheet and the poll go', p.style() === null && p.timers.filter((t) => t.kind === 'interval' && t.live).length === 0)
}

console.log('a tab left in a chat that has nothing closes itself')
{
  const p = page()
  const state = { key: 'chat-1' }
  let verdict = false
  const gate = p.make({ ctx: ctxOf(state), kind: 'T', has: async () => verdict })
  gate.join()
  let closed = 0
  const props = { sessionId: 'chat-1', useTabInfo: () => ({ tab: { actions: { close: () => { closed += 1 } } } }) }
  gate.useEmptyClose(props)
  const eff = p.effects[p.effects.length - 1]
  const cleanup = eff.fn()
  check('the check is scheduled after the tab has settled (1.5 s) and then repeats (2.5 s)', p.timers.some((t) => t.kind === 'timeout' && t.ms === 1500) && p.timers.some((t) => t.kind === 'interval' && t.ms === 2500))
  // time passes one check at a time: the first one is the 1.5 s timeout, the next ones the 2.5 s interval
  let first = true
  const fire = async () => { const t = first ? p.timers.find((x) => x.live && x.kind === 'timeout' && x.ms === 1500) : p.timers.find((x) => x.live && x.kind === 'interval' && x.ms === 2500); first = false; t.f(); await settle(); await settle() }
  await fire()
  check('one empty answer is not enough (a deck still being written must not lose its tab)', closed === 0, closed)
  verdict = true
  await fire()
  verdict = false
  await fire()
  check('an answer with content resets the count', closed === 0, closed)
  await fire()
  check('two empty answers in a row close the tab, once', closed === 1, closed)
  await fire()
  check('and it does not close it again', closed === 1, closed)
  if (typeof cleanup === 'function') cleanup()
  // cannot tell: never closes
  const r = page(); let c2 = 0
  const g2 = r.make({ ctx: ctxOf({ key: 'chat-1' }), kind: 'U', has: async () => null })
  g2.join()
  g2.useEmptyClose({ sessionId: 'chat-1', useTabInfo: () => ({ tab: { actions: { close: () => { c2 += 1 } } } }) })
  r.effects[r.effects.length - 1].fn()
  for (let i = 0; i < 4; i += 1) { const t = i === 0 ? r.timers.find((x) => x.live && x.ms === 1500) : r.timers.find((x) => x.live && x.ms === 2500 && x.kind === 'interval'); t.f(); await settle(); await settle() }
  check('an answer of « cannot tell » never closes a tab', c2 === 0, c2)
  // a body with no tab hook or no session schedules nothing
  const s = page(); const g3 = s.make({ ctx: ctxOf({ key: 'chat-1' }), kind: 'V', has: async () => false })
  g3.useEmptyClose({ sessionId: 'chat-1' })
  g3.useEmptyClose(undefined)
  const before = s.timers.length
  const e1 = s.effects[0].fn(); const e2 = s.effects[1].fn()
  check('without the engine\'s tab hook or a session, the body schedules nothing', e1 === undefined && e2 === undefined && s.timers.length === before)
}

console.log(failed === 0 ? '\nright-tab-gate: all green' : '\nright-tab-gate: ' + failed + ' failure(s)')
process.exit(failed === 0 ? 0 : 1)
