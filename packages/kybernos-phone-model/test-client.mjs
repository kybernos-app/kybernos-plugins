// Page half of @local/kybernos-phone-model: the real component run on a tiny hooks runtime (no browser, no React), the app's message, the words.
//   node test-client.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WORDS, parseAppMessage as hostParse, PRESET_ID, PROVIDER_ID } from './phone-model.mjs'

let pass = 0
let fail = 0
const ok = (name, cond, detail) => {
  if (cond === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail !== undefined ? ' — ' + detail : '')) }
}
const HERE = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(HERE, 'client.js'), 'utf8')
const tick = () => new Promise((r) => setTimeout(r, 0))

// ── a tiny hooks runtime: one component instance, state, refs, effects with cleanup, re-render on setState ─────────────────────────────────────────────
const makeRuntime = () => {
  let cur = null
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
    useState: (init) => {
      const c = cur; const i = c.i++
      if (!(i in c.state)) c.state[i] = typeof init === 'function' ? init() : init
      return [c.state[i], (v) => { const nv = typeof v === 'function' ? v(c.state[i]) : v; if (nv !== c.state[i]) { c.state[i] = nv; c.dirty = true } }]
    },
    useReducer: (reducer, init) => {
      const c = cur; const i = c.i++
      if (!(i in c.state)) c.state[i] = init
      return [c.state[i], () => { c.state[i] = reducer(c.state[i]); c.dirty = true }]
    },
    useRef: (v) => { const c = cur; const i = c.i++; if (!(i in c.state)) c.state[i] = { current: v }; return c.state[i] },
    useEffect: (fn, deps) => {
      const c = cur; const i = c.i++
      const prev = c.effects[i]
      const changed = prev === undefined || deps === undefined || deps.length !== prev.deps.length || deps.some((d, k) => d !== prev.deps[k])
      if (changed) c.pending.push({ i, fn, deps })
    },
  }
  const mount = (Component, props) => {
    const c = { i: 0, state: {}, effects: {}, pending: [], dirty: false, tree: null, props }
    const render = () => { cur = c; c.i = 0; c.dirty = false; c.tree = Component(c.props); cur = null }
    const flush = async () => {
      for (let round = 0; round < 12; round += 1) {
        render()
        const todo = c.pending.splice(0)
        for (const e of todo) {
          const old = c.effects[e.i]
          if (old !== undefined && typeof old.cleanup === 'function') { try { old.cleanup() } catch (err) { /* gone */ } }
          let cleanup
          try { cleanup = e.fn() } catch (err) { cleanup = undefined }
          c.effects[e.i] = { deps: e.deps, cleanup }
        }
        await tick(); await tick()
        if (!c.dirty && c.pending.length === 0) { render(); return }
      }
    }
    return { flush, set: (p) => { c.props = p }, get tree() { return c.tree }, unmount: () => { for (const e of Object.values(c.effects)) { if (typeof e.cleanup === 'function') { try { e.cleanup() } catch (err) { /* gone */ } } } } }
  }
  return { React, mount }
}
const find = (node, pred) => {
  if (node === null || node === undefined || typeof node !== 'object') return null
  if (pred(node)) return node
  for (const ch of node.children || []) { const hit = find(ch, pred); if (hit !== null) return hit }
  return null
}
const textOf = (node) => (node === null || node === undefined ? '' : typeof node === 'string' ? node : (node.children || []).map(textOf).join(''))

// ── load the file the way DSH does ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const rt = makeRuntime()
const events = new Map()
const doc = { head: { appended: [], appendChild(n) { this.appended.push(n) } }, documentElement: { lang: 'en' }, visibilityState: 'visible', addEventListener: (t, f) => events.set('doc:' + t, f), removeEventListener: (t) => events.delete('doc:' + t), createElement: () => ({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v }, remove() { this.removed = true }, textContent: '' }) }
const posted = []
const navigations = []
let hostBody = { available: true, installed: true, model: { id: 'qwen3-1.7b-q4_k_m', name: 'Qwen3 1.7B' } }
let hostStatus = 200
const win = {
  document: doc,
  addEventListener: (t, f) => events.set('win:' + t, f),
  removeEventListener: (t) => events.delete('win:' + t),
  location: { assign: (u) => navigations.push(u) },
  ReactNativeWebView: { postMessage: (m) => posted.push(m) },
  __KB_LANG_RESOLVE__: () => 'en',
}
let loaded = null
globalThis.window = win
globalThis.document = doc
globalThis.fetch = async (url) => { win.lastFetch = url; return { status: hostStatus, json: async () => hostBody } }
win.__ModuleLoader__ = { load: (m) => { loaded = m } }
new Function('window', 'document', 'fetch', 'console', source)(win, doc, globalThis.fetch, console)
const plugin = loaded.factory((name) => (name === 'react' ? rt.React : (() => { throw new Error('no ' + name) })()))
const T = plugin.__test

console.log('the plugin object and the pure parts')
ok('the factory returns a plugin with apply and the slots service', plugin !== null && typeof plugin.apply === 'function' && plugin.inject.indexOf('slots') >= 0 && plugin.name === 'kybernos-phone-model')
ok('a broken load returns a disabled plugin, never nothing', (() => { const warn = console.warn; console.warn = () => {}; try { const p = loaded.factory(() => { throw new Error('no react') }); return p !== undefined && typeof p.apply === 'function' } finally { console.warn = warn } })())
const good = { kybernos: 'local-llm', version: 1, event: 'state', state: { supported: true, phase: 'installed', installed: true, loaded: false, pct: null, model: { id: 'qwen3-1.7b-q4_k_m', name: 'Qwen3 1.7B', bytes: 1107409472, context: 4096 } } }
const msgs = [good, JSON.stringify(good), { ...good, version: 2 }, { ...good, kybernos: 'other' }, { ...good, event: 'x' }, { ...good, state: null }, { ...good, state: { supported: 'yes' } }, { ...good, state: { ...good.state, phase: 'exploding' } }, { ...good, state: { ...good.state, model: { id: '../x' } } }, null, 3, [], 'not json', 'x'.repeat(3000), { ...good, state: { ...good.state, path: '/data/x', key: 'secret', address: 'http://127.0.0.1:1' } }]
ok('the page and the host read the app\'s message the same way (same shape out, same refusals)', msgs.every((m) => {
  const a = T.parseAppMessage(m); const b = hostParse(m)
  return (a === null) === (b === null) && (a === null || (a.supported === b.supported && a.phase === b.phase && a.installed === b.installed && (a.model === null) === (b.model === null)))
}))
ok('the state keeps no path, address or key even when the app sends them', (() => { const s = T.parseAppMessage(msgs[msgs.length - 1]); return s !== null && !JSON.stringify(s).includes('/data/x') && !JSON.stringify(s).includes('secret') && !JSON.stringify(s).includes('127.0.0.1') })())
ok('an unknown phase reads as « none », a model with a bad id as no model', T.parseAppMessage(msgs[7]).phase === 'none' && T.parseAppMessage(msgs[8]).model === null)
ok('isPhoneModel: either spelling of the selection, nothing else', T.isPhoneModel({ provider: PROVIDER_ID, model: 'x' }) && T.isPhoneModel({ model: PROVIDER_ID + '/x' }) && !T.isPhoneModel({ provider: 'claude', model: 'opus' }) && !T.isPhoneModel(null) && !T.isPhoneModel('phone-local'))
ok('nextStep: idle, select, line, start-new', T.nextStep({ phone: false, preset: 'standard', blank: true, tried: 'none' }) === 'idle' && T.nextStep({ phone: true, preset: 'discussion', blank: false, tried: 'none' }) === 'line' && T.nextStep({ phone: true, preset: 'standard', blank: true, tried: 'none' }) === 'select' && T.nextStep({ phone: true, preset: 'standard', blank: true, tried: 'locked' }) === 'start-new' && T.nextStep({ phone: true, preset: 'standard', blank: false, tried: 'none' }) === 'start-new' && T.nextStep({ phone: true, preset: undefined, blank: undefined, tried: 'none' }) === 'select' && T.nextStep({ phone: true, preset: undefined, blank: undefined, tried: 'applied' }) === 'line')
ok('isLocked reads the engine\'s refusal of a chat that already started', T.isLocked({ ok: false, error: { message: 'This session has already started', details: { reason: 'agent-preset/locked' } } }) && !T.isLocked({ ok: false, error: { message: 'Unknown agent preset' } }) && !T.isLocked({ ok: true }))

console.log('the words (contract test 6)')
for (const key of ['label', 'labelLight', 'manage', 'modeLight', 'modeChat', 'modeChatReady', 'modeChatNew', 'discussionOnly', 'presetOnly', 'startNew', 'loading', 'switchedToCloud', 'needsCloud', 'stepTitle', 'stepText', 'stepButton']) {
  ok(key + ': French and English, none empty', typeof T.WORDS[key].en === 'string' && T.WORDS[key].en.length > 5 && typeof T.WORDS[key].fr === 'string' && T.WORDS[key].fr.length > 5 && T.WORDS[key].en !== T.WORDS[key].fr)
}
ok('the label is the owner\'s wording in both languages, the same on the host side', T.WORDS.label.en === 'Small model on this phone: simple questions, works offline' && T.WORDS.label.fr === 'Petit modèle sur ce téléphone : questions simples, fonctionne hors ligne' && T.WORDS.label.en === WORDS.label.en && T.WORDS.label.fr === WORDS.label.fr && T.WORDS.manage.en === WORDS.manage.en && T.WORDS.manage.fr === WORDS.manage.fr && T.WORDS.startNew.en === WORDS.startNew.en && T.WORDS.startNew.fr === WORDS.startNew.fr)
ok('every line fits a 360 px column in at most two lines at 12 px (about 54 characters a line) and wraps instead of overflowing', ['label', 'labelLight', 'startNew', 'discussionOnly', 'presetOnly', 'loading', 'switchedToCloud', 'needsCloud'].every((k) => T.WORDS[k].fr.length <= 108 && T.WORDS[k].en.length <= 108) && /overflow-wrap:anywhere/.test(T.CSS) && /flex-wrap:wrap/.test(T.CSS))
ok('the styles use the page tokens, no hard-coded colour', !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(T.CSS) && /var\(--dsw-alias-label-caption/.test(T.CSS))
ok('the line has the page colour behind it, so messages scrolling under the composer cannot show through its text', /\.kbpm-line\{[^}]*background:var\(--dsw-alias-bg-base/.test(T.CSS))
ok('the touch target of the link is at least 44 px (the box is grown by 14 px above and below its 16 px text)', /\.kbpm-manage:after\{[^}]*inset:-14px/.test(T.CSS))

console.log('apply: the page does nothing until the host says it is active')
const regs = []
const effects = []
const slots = { inject: (name, make) => { regs.push({ name, make }); return () => regs.pop() }, register: (def, component) => ({ def, component }) }
let currentModel = { provider: PROVIDER_ID, model: PROVIDER_ID + '/qwen3-1.7b-q4_k_m' }
const listeners = new Set()
const modelStore = { getSnapshot: () => ({ current: currentModel }), subscribe: (f) => { listeners.add(f); return () => listeners.delete(f) } }
let groups = [
  { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' }, { id: 'deepseek-v4.1-pro', name: 'DeepSeek V4.1 Pro' }] },
  { id: PROVIDER_ID, name: 'On this phone', models: [{ id: 'qwen3-1.7b-q4_k_m', name: 'Qwen3 1.7B' }] },
]
let catalogDefault = { provider: 'deepseek', model: 'deepseek-v4.1-pro' }
const selectModelCalls = []
let modelSelectResult = { ok: true, value: undefined }
const directory = { store: { getSnapshot: () => ({ current: currentModel, groups }), subscribe: (f) => { listeners.add(f); return () => listeners.delete(f) } }, select: async (sel) => { selectModelCalls.push(sel); return modelSelectResult } }
const dirs = { catalog: { store: { getSnapshot: () => ({ value: { groups, default: catalogDefault } }) } }, directoryFor: (sid) => (sid === 'S1' ? directory : null) }
const selectCalls = []
let selectResult = { ok: true, value: PRESET_ID }
let selectOverride = null
const presets = { select: async (id, preset) => { selectCalls.push([id, preset]); return selectOverride !== null ? selectOverride(preset) : selectResult } }
let sessionRow = { blank: true, projectionValues: { agentPreset: 'standard' } }
const sessionSubs = new Set()
const sessions = { list: { getSnapshot: () => ({ byId: { S1: sessionRow } }), subscribe: (f) => { sessionSubs.add(f); return () => sessionSubs.delete(f) } } }
const scope = { slots, sessions, modelDirectories: dirs, remote: { agentPresets: presets }, effect: (f) => { const off = f(); effects.push(off); return off } }
const ctx = { slots, effect: (f, label) => { const off = f(); effects.push(off); return off }, inject: (names, cb) => cb(scope) }
plugin.apply(ctx)
await tick(); await tick()
ok('it asks the host for the state and tells the app it speaks the contract', win.lastFetch === '/phone-model/state' && posted.length >= 1 && JSON.parse(posted[0]).kybernos === 'local-llm' && JSON.parse(posted[0]).op === 'state' && JSON.parse(posted[0]).version === 1)
ok('it inserts one style and one slot, the input dock the engine draws for a new chat as well as a started one (the composer dock only exists after the first turn)', doc.head.appended.length === 1 && doc.head.appended[0].attrs['data-plugin'] === '@local/kybernos-phone-model' && regs.length === 1 && regs[0].name === 'conversation.input.dock')
const occupant = regs[0].make()
const run = async (preset, blank = true) => {
  sessionRow = { blank, projectionValues: preset === undefined ? {} : { agentPreset: preset } }
  const el = occupant.component({ sessionId: 'S1' })
  const m = rt.mount(el.type, el.props); await m.flush(); return m
}

console.log('a chat on the phone model')
{
  selectCalls.length = 0
  const m = await run('standard')
  ok('a blank chat on the standard preset: Discussion is selected for that chat, once', selectCalls.length === 1 && selectCalls[0][0] === 'S1' && selectCalls[0][1] === PRESET_ID, JSON.stringify(selectCalls))
  m.unmount()
}
{
  selectCalls.length = 0
  const m = await run('discussion')
  const line = find(m.tree, (n) => n.props && n.props['data-kb'] === 'phone-model-line')
  ok('a chat already on Discussion: the label line, no select', selectCalls.length === 0 && line !== null && textOf(line).startsWith(T.WORDS.label.en), textOf(m.tree))
  ok('no link to the app before the app has spoken', find(m.tree, (n) => n.props && n.props['data-act'] === 'manage-models') === null)
  m.unmount()
}
{
  // the app speaks: the label line gets its link
  const claim = events.get('win:kb-app-message')
  const ev = { detail: good, defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
  claim(ev)
  ok('the app\'s state message is claimed (so the shell answers « understood »)', ev.defaultPrevented === true)
  const bad = { detail: { kybernos: 'local-llm', version: 9 }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
  claim(bad)
  ok('a malformed one is not claimed', bad.defaultPrevented === false)
  const m = await run('discussion')
  const link = find(m.tree, (n) => n.props && n.props['data-act'] === 'manage-models')
  ok('the line then carries « Manage models on this phone »', link !== null && textOf(link) === T.WORDS.manage.en)
  link.props.onClick()
  ok('the link goes to kybernos://models, the app\'s own screen', navigations.length === 1 && navigations[0] === 'kybernos://models')
  m.unmount()
  claim({ detail: { ...good, state: { ...good.state, supported: false } }, preventDefault() {} })
  const m2 = await run('discussion')
  ok('when the app says it is not supported here, the link is gone', find(m2.tree, (n) => n.props && n.props['data-act'] === 'manage-models') === null)
  m2.unmount()
  claim({ detail: good, preventDefault() {} })
}
{
  selectCalls.length = 0
  selectResult = { ok: false, error: { message: 'This session has already started', details: { reason: 'agent-preset/locked' } } }
  const m = await run('standard')
  const note = find(m.tree, (n) => n.props && n.props['data-kb'] === 'phone-model-line')
  ok('a chat that already started on another preset: the select is refused and the page says to start a new chat', selectCalls.length === 1 && note !== null && textOf(note) === T.WORDS.startNew.en, textOf(m.tree) + ' / calls ' + selectCalls.length)
  m.unmount()
  selectResult = { ok: true, value: PRESET_ID }
}
{
  selectCalls.length = 0
  const m = await run('minimal', false)
  const note = find(m.tree, (n) => n.props && n.props['data-kb'] === 'phone-model-line')
  ok('a chat that already started on another preset: nothing is asked of the engine, the page says to start a new chat', selectCalls.length === 0 && note !== null && textOf(note) === T.WORDS.startNew.en)
  m.unmount()
}
{
  selectCalls.length = 0
  const m = await run('discussion', false)
  ok('a started chat on Discussion keeps its line (the model of the phone is fine there)', selectCalls.length === 0 && find(m.tree, (n) => n.props && n.props['data-kb'] === 'phone-model-line') !== null)
  m.unmount()
}
{
  selectCalls.length = 0
  currentModel = { provider: 'claude', model: 'claude/opus' }
  const m = await run('standard')
  ok('another model: no select, no line, the interface as it was', selectCalls.length === 0 && m.tree === null)
  m.unmount()
  currentModel = { provider: PROVIDER_ID, model: PROVIDER_ID + '/x' }
}
{
  // a chat a flow opened (Create, a skill, a team) inherits the phone's model: the page moves it to a cloud model, once, and says so
  selectCalls.length = 0; selectModelCalls.length = 0
  events.get('win:kb-flow-chat')({ detail: { sessionId: 'S1' } })
  const m = await run('standard')
  const note = find(m.tree, (n) => n.props && n.props['data-kb'] === 'phone-model-line')
  ok('a chat opened by a flow on the phone\'s model moves to the host\'s default cloud model (not a phone model)', selectModelCalls.length === 1 && selectModelCalls[0].provider === 'deepseek' && selectModelCalls[0].model === 'deepseek-v4.1-pro', JSON.stringify(selectModelCalls))
  ok('and says so in one line, with the model\'s name', note !== null && textOf(note) === T.WORDS.switchedToCloud.en.replace('{name}', 'DeepSeek V4.1 Pro'), textOf(m.tree))
  m.unmount()
  const again = await run('standard')
  ok('the flow is forgotten once it was served: the same chat is not moved a second time', selectModelCalls.length === 1)
  again.unmount()
}
{
  // no default, or the default is the phone's own model: the first model of another provider
  selectModelCalls.length = 0
  const saved = catalogDefault
  catalogDefault = { provider: PROVIDER_ID, model: 'qwen3-1.7b-q4_k_m' }
  events.get('win:kb-flow-chat')({ detail: { sessionId: 'S1' } })
  const m = await run('standard')
  ok('when the default is the phone\'s model, the first model of another provider is taken', selectModelCalls.length === 1 && selectModelCalls[0].provider === 'deepseek' && selectModelCalls[0].model === 'deepseek-v4.1-flash', JSON.stringify(selectModelCalls))
  m.unmount()
  catalogDefault = saved
}
{
  // nothing but the phone's model: the chat stays, and the page says plainly that this needs a cloud model
  selectModelCalls.length = 0
  const saved = groups
  groups = groups.filter((g) => g.id === PROVIDER_ID)
  events.get('win:kb-flow-chat')({ detail: { sessionId: 'S1' } })
  const m = await run('standard')
  const note = find(m.tree, (n) => n.props && n.props['data-kb'] === 'phone-model-line')
  ok('no cloud model at all: no switch, and the line says this needs a cloud model', selectModelCalls.length === 0 && note !== null && textOf(note) === T.WORDS.needsCloud.en, textOf(m.tree))
  m.unmount()
  groups = saved
}
{
  // the engine refuses the switch: the same plain line, never a silent failure
  selectModelCalls.length = 0
  modelSelectResult = { ok: false, error: { code: 'x', message: 'refused' } }
  events.get('win:kb-flow-chat')({ detail: { sessionId: 'S1' } })
  const m = await run('standard')
  const note = find(m.tree, (n) => n.props && n.props['data-kb'] === 'phone-model-line')
  ok('a refused switch ends in the « needs a cloud model » line', selectModelCalls.length === 1 && note !== null && textOf(note) === T.WORDS.needsCloud.en, textOf(m.tree))
  m.unmount()
  modelSelectResult = { ok: true, value: undefined }
}
{
  // a chat the person opened with the phone's model themselves is never moved
  selectModelCalls.length = 0
  const m = await run('standard')
  ok('a chat no flow opened stays on the phone\'s model (only the Discussion preset is selected)', selectModelCalls.length === 0)
  m.unmount()
  // a flow chat that already runs on another model: nothing to move, and the flow is forgotten so a later pick of the phone\'s model is the person\'s
  currentModel = { provider: 'deepseek', model: 'deepseek/deepseek-v4.1-flash' }
  events.get('win:kb-flow-chat')({ detail: { sessionId: 'S1' } })
  const m2 = await run('standard')
  currentModel = { provider: PROVIDER_ID, model: PROVIDER_ID + '/x' }
  const m3 = await run('standard')
  ok('a flow chat already on a cloud model is left alone, and a later pick of the phone\'s model is not undone', selectModelCalls.length === 0)
  m2.unmount(); m3.unmount()
  // a malformed event moves nothing
  events.get('win:kb-flow-chat')({ detail: null }); events.get('win:kb-flow-chat')({}); events.get('win:kb-flow-chat')({ detail: { sessionId: 5 } })
  const m4 = await run('standard')
  ok('a malformed flow event is ignored', selectModelCalls.length === 0)
  m4.unmount()
}
{
  // the app says the model is being loaded: a plain line instead of the label
  const claim = events.get('win:kb-app-message')
  claim({ detail: { ...good, state: { ...good.state, phase: 'loading' } }, preventDefault() {} })
  const m = await run('discussion')
  const line = find(m.tree, (n) => n.props && n.props['data-kb'] === 'phone-model-line')
  ok('while the app loads the model (phase loading) the line says « Loading the model on this phone… »', line !== null && textOf(line).startsWith(T.WORDS.loading.en) && !textOf(line).includes(T.WORDS.label.en), textOf(m.tree))
  m.unmount()
  claim({ detail: good, preventDefault() {} })
  const m2 = await run('discussion')
  ok('and the label comes back once the app says installed', textOf(find(m2.tree, (n) => n.props && n.props['data-kb'] === 'phone-model-line')).startsWith(T.WORDS.label.en))
  m2.unmount()
}
{
  selectCalls.length = 0
  hostStatus = 404
  await events.get('doc:visibilitychange')()
  await tick(); await tick()
  const m = await run('standard')
  ok('the host half is not there (404): nothing is selected and nothing is drawn', selectCalls.length === 0 && m.tree === null)
  m.unmount()
  hostStatus = 200
  await events.get('doc:visibilitychange')()
  await tick(); await tick()
}
{
  const before = posted.length
  doc.visibilityState = 'hidden'
  await events.get('doc:visibilitychange')()
  ok('a hidden page does not ask again', posted.length === before)
  doc.visibilityState = 'visible'
  await events.get('doc:visibilitychange')()
  ok('a page that becomes visible asks the app for the state again', posted.length === before + 1)
}
{
  selectCalls.length = 0
  const old = win.ReactNativeWebView
  win.ReactNativeWebView = undefined
  let threw = false
  try { await events.get('doc:visibilitychange')() } catch (e) { threw = true }
  win.ReactNativeWebView = old
  ok('no app around: nothing is posted and nothing throws', threw === false)
}
console.log('the light agent preset (the app says its model takes tools)')
{
  ok('either of our two presets is « done »: the label line, no select', T.LIGHT === 'light-agent' && T.nextStep({ phone: true, preset: 'light-agent', blank: true, tried: 'none' }) === 'line' && T.nextStep({ phone: true, preset: 'discussion', blank: true, tried: 'none' }) === 'line' && T.nextStep({ phone: true, preset: 'standard', blank: true, tried: 'none' }) === 'select')
  ok('the words of the light line are the host\'s words', T.WORDS.labelLight.en === WORDS.labelLight.en && T.WORDS.labelLight.fr === WORDS.labelLight.fr && T.WORDS.presetOnly.en === WORDS.presetOnly.en && T.WORDS.presetOnly.fr === WORDS.presetOnly.fr)
  const withTools = (on) => { hostBody = { available: true, installed: true, model: { id: 'qwen3-1.7b-q4_k_m', name: 'Qwen3 1.7B', tools: on } } }
  withTools(true)
  await events.get('doc:visibilitychange')()
  await tick(); await tick()
  selectCalls.length = 0
  selectResult = { ok: true, value: 'light-agent' }
  const m = await run('standard')
  ok('a blank chat on the phone model gets the LIGHT agent preset when the app says the model takes tools', selectCalls.length === 1 && selectCalls[0][0] === 'S1' && selectCalls[0][1] === 'light-agent', JSON.stringify(selectCalls))
  m.unmount()
  selectCalls.length = 0
  const m2 = await run('light-agent')
  const line = find(m2.tree, (n) => n.props && n.props['data-kb'] === 'phone-model-line')
  ok('a chat on the light agent preset: its own line (questions, reminders and notes), no select', selectCalls.length === 0 && line !== null && textOf(line).startsWith(T.WORDS.labelLight.en), textOf(m2.tree))
  m2.unmount()
  selectCalls.length = 0
  const m3 = await run('discussion', false)
  ok('a chat that has STARTED on Discussion stays on Discussion (no select, even though the app says the model takes tools)', selectCalls.length === 0 && textOf(find(m3.tree, (n) => n.props && n.props['data-kb'] === 'phone-model-line')).startsWith(T.WORDS.label.en))
  m3.unmount()
  // the first phone test of the light agent went wrong here: the engine hands back the blank chat of the workspace under the preset its log recorded (Discussion, set by an earlier test or
  // an earlier version of this page), `nextStep` saw a preset and drew the line, and the light agent was never chosen
  selectCalls.length = 0
  selectResult = { ok: true, value: 'light-agent' }
  const m3b = await run('discussion', true)
  await tick(); await tick(); await tick()
  ok('a BLANK chat the engine hands back already on Discussion goes to the light agent when the host names it (once)', selectCalls.length === 1 && selectCalls[0][0] === 'S1' && selectCalls[0][1] === 'light-agent', JSON.stringify(selectCalls))
  m3b.unmount()
  ok('the probe says what was decided for it', win.__KB_PHONE_MODEL__.decided === 'light-agent', JSON.stringify(win.__KB_PHONE_MODEL__))
  selectCalls.length = 0
  selectResult = { ok: false, error: { code: 'x', message: 'refused' } }
  const m3c = await run('discussion', true)
  await tick(); await tick(); await tick()
  ok('a refusal leaves the blank chat on Discussion, where it was (no second try, no other preset)', selectCalls.length === 1 && win.__KB_PHONE_MODEL__.decided === 'discussion', JSON.stringify({ selectCalls, decided: win.__KB_PHONE_MODEL__.decided }))
  m3c.unmount()
  selectResult = { ok: true, value: 'light-agent' }
  withTools('yes')
  await events.get('doc:visibilitychange')()
  await tick(); await tick()
  selectCalls.length = 0
  selectResult = { ok: true, value: PRESET_ID }
  const m4 = await run('standard')
  ok('anything but `tools: true` is a model that takes none: Discussion, as before', selectCalls.length === 1 && selectCalls[0][1] === PRESET_ID, JSON.stringify(selectCalls))
  m4.unmount()
  hostBody = { available: true, installed: true, model: { id: 'qwen3-1.7b-q4_k_m', name: 'Qwen3 1.7B' } }
  await events.get('doc:visibilitychange')()
  await tick(); await tick()
}
console.log('the preset is decided from the host, fresh, right before the select (first phone test: the page kept Discussion for good)')
const waitFor = async (cond, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await new Promise((r) => setTimeout(r, 25)) } return cond() }
const withHost = (extra) => ({ available: true, installed: true, model: { id: 'qwen3-1.7b-q4_k_m', name: 'Qwen3 1.7B', tools: true }, ...extra })
{
  // the page read the state at load, when the host had not seen the model's tools yet; the host has registered the light agent since
  hostBody = withHost({ preset: 'discussion', model: { id: 'qwen3-1.7b-q4_k_m', name: 'Qwen3 1.7B', tools: false } })
  await events.get('doc:visibilitychange')(); await tick(); await tick()
  hostBody = withHost({ preset: 'light-agent' })
  selectCalls.length = 0; selectResult = { ok: true, value: 'light-agent' }
  const m = await run('standard')
  ok('a blank chat gets the light agent although the page\'s last reading said « no tools »: it asks the host again before it chooses', await waitFor(() => selectCalls.length === 1) && selectCalls[0][1] === 'light-agent', JSON.stringify(selectCalls))
  m.unmount()
}
{
  // the host says « not ready » (the model takes tools, the preset is being registered): nothing is chosen for good, and it is chosen when ready
  hostBody = withHost({ preset: null })
  selectCalls.length = 0
  const m = await run('standard')
  await new Promise((r) => setTimeout(r, 200))
  ok('while the host says the preset is not ready nothing is selected (Discussion is not taken for good)', selectCalls.length === 0, JSON.stringify(selectCalls))
  hostBody = withHost({ preset: 'light-agent' })
  ok('and once it is ready the light agent is selected', await waitFor(() => selectCalls.length === 1) && selectCalls[0][1] === 'light-agent', JSON.stringify(selectCalls))
  m.unmount()
}
{
  // a host that never gets ready: after three seconds Discussion (a chat must not run on the full agent in 4096 tokens)
  hostBody = withHost({ preset: null })
  selectCalls.length = 0; selectResult = { ok: true, value: PRESET_ID }
  const m = await run('standard')
  ok('a host that stays « not ready » for three seconds: the page takes Discussion', await waitFor(() => selectCalls.length === 1, 5000) && selectCalls[0][1] === PRESET_ID, JSON.stringify(selectCalls))
  m.unmount()
}
{
  // the engine refuses the light agent (not registered, whatever the reason): Discussion, not the full agent; a refusal « the chat has started » is final
  hostBody = withHost({ preset: 'light-agent' })
  selectCalls.length = 0
  selectOverride = (preset) => (preset === 'light-agent' ? { ok: false, error: { code: 'unknown-preset', message: 'no preset light-agent' } } : { ok: true, value: preset })
  const m = await run('standard')
  ok('the light agent refused: the page selects Discussion right after', await waitFor(() => selectCalls.length === 2) && selectCalls[0][1] === 'light-agent' && selectCalls[1][1] === PRESET_ID, JSON.stringify(selectCalls))
  m.unmount()
  selectCalls.length = 0
  selectOverride = () => ({ ok: false, error: { code: 'locked', message: 'the chat already started' } })
  const m2 = await run('standard')
  await waitFor(() => selectCalls.length >= 1)
  await new Promise((r) => setTimeout(r, 100))
  ok('a refusal because the chat has started is final: no second attempt with Discussion', selectCalls.length === 1, JSON.stringify(selectCalls))
  m2.unmount()
  selectOverride = null
}
{
  // the quiet line says which mode the chat is in, and why when it is chat only
  hostBody = withHost({ preset: 'light-agent' })
  await events.get('doc:visibilitychange')(); await tick(); await tick()
  const m = await run('light-agent')
  const tag = find(m.tree, (n) => n.props && n.props['data-kb'] === 'phone-model-mode')
  ok('a chat on the light agent: « can set reminders », data-mode light', tag !== null && tag.props['data-mode'] === 'light' && textOf(tag).includes(T.WORDS.modeLight.en), textOf(m.tree))
  m.unmount()
  hostBody = withHost({ preset: 'discussion' }) // the app reports tools, the host knows the light agent is not registered
  await events.get('doc:visibilitychange')(); await tick(); await tick()
  const m2 = await run('discussion')
  const tag2 = find(m2.tree, (n) => n.props && n.props['data-kb'] === 'phone-model-mode')
  ok('a chat on Discussion while the app reports tools and the host names Discussion: « chat only (the light agent was not ready) »', tag2 !== null && tag2.props['data-mode'] === 'chat' && tag2.props['data-tools'] === 'true' && textOf(tag2).includes(T.WORDS.modeChatReady.en), textOf(m2.tree))
  m2.unmount()
  hostBody = withHost({ preset: 'discussion', model: { id: 'qwen3-1.7b-q4_k_m', name: 'Qwen3 1.7B' } })
  await events.get('doc:visibilitychange')(); await tick(); await tick()
  const m3 = await run('discussion')
  const tag3 = find(m3.tree, (n) => n.props && n.props['data-kb'] === 'phone-model-mode')
  ok('a chat on Discussion when the app reports no tools: « chat only (the app does not report tools for this model) »', tag3 !== null && tag3.props['data-tools'] === 'false' && textOf(tag3).includes(T.WORDS.modeChat.en) && textOf(find(m3.tree, (n) => n.props && n.props['data-kb'] === 'phone-model-line')).startsWith(T.WORDS.label.en), textOf(m3.tree))
  m3.unmount()
  const probed = win.__KB_PHONE_MODEL__
  ok('the read-only probe carries what the page decided, for a live check', probed !== undefined && probed.tools === false && probed.preset === 'discussion' && 'decided' in probed)
}
console.log('the launch note follows the host, and says « not ready » only when the wait is over (second phone test: it said so on a phone whose host named the light agent, and never changed)')
{
  const MODES = ['modeLight', 'modeChat', 'modeChatReady', 'modeChatNew']
  const note = (o) => T.modeNote({ preset: 'discussion', blank: true, host: null, tools: true, recheck: 'pending', ...o })
  ok('modeNote: the light agent is always « can set reminders »', note({ preset: 'light-agent', recheck: 'pending', host: undefined }) === 'modeLight')
  ok('modeNote: a blank Discussion chat says nothing while the page is still deciding, whatever the host said', ['pending'].every((r) => [null, undefined, 'light-agent', 'discussion'].every((h) => [true, false].every((t) => note({ recheck: r, host: h, tools: t }) === null))))
  ok('modeNote: once the wait ended the reason is told: « not ready » when the app reports tools, the missing tools otherwise', note({ recheck: 'ended' }) === 'modeChatReady' && note({ recheck: 'ended', tools: false }) === 'modeChat')
  ok('modeNote: a chat that started says nothing while the host does not know, « a new chat can set reminders » when it names the light agent', note({ blank: false, host: null }) === null && note({ blank: false, host: undefined }) === null && note({ blank: false, host: 'light-agent' }) === 'modeChatNew')
  ok('modeNote: a chat the engine refused (locked) reads as a chat that started', note({ recheck: 'locked', host: 'light-agent' }) === 'modeChatNew' && note({ recheck: 'locked', host: null }) === null)
  ok('modeNote: the host names Discussion for a started chat: the reason, never « not ready » for an unknown answer', note({ blank: false, host: 'discussion' }) === 'modeChatReady' && note({ blank: false, host: 'discussion', tools: false }) === 'modeChat' && note({ blank: undefined, host: 'discussion' }) === null)
  ok('modeNote: every answer is a word of the page or nothing', MODES.every((k) => k in T.WORDS) && [null, undefined, 'light-agent', 'discussion'].every((h) => ['pending', 'ended', 'locked'].every((r) => [true, false, undefined].every((b) => { const n = note({ host: h, recheck: r, blank: b }); return n === null || MODES.includes(n) }))))
  ok('modeChatNew: French and English, none empty, fits two lines of a 360 px column', typeof T.WORDS.modeChatNew.en === 'string' && T.WORDS.modeChatNew.en.length > 5 && T.WORDS.modeChatNew.fr.length > 5 && T.WORDS.modeChatNew.en !== T.WORDS.modeChatNew.fr && T.WORDS.modeChatNew.fr.length + T.WORDS.label.fr.length <= 150 && T.WORDS.modeChatNew.en === WORDS.modeChatNew.en && T.WORDS.modeChatNew.fr === WORDS.modeChatNew.fr)

  // the waits are shortened: the real ones are 30 s and 1.5 s
  const real = { ...T.RECHECK }
  T.RECHECK.maxMs = 600; T.RECHECK.stepMs = 100; T.RECHECK.recordMs = 400
  const modeOf = (m) => find(m.tree, (n) => n.props && n.props['data-kb'] === 'phone-model-mode')
  const lineOf = (m) => find(m.tree, (n) => n.props && n.props['data-kb'] === 'phone-model-line')
  const settleTo = async (m, cond, ms = 4000) => { const t0 = Date.now(); for (;;) { await m.flush(); if (cond()) return true; if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 40)) } }
  const hostNow = async (body) => { hostBody = body; await events.get('doc:visibilitychange')(); await tick(); await tick() }
  const phoneModel = currentModel
  const otherModel = { provider: 'deepseek', model: 'deepseek/deepseek-v4.1-pro' }
  const choose = (model) => { currentModel = model; for (const f of Array.from(listeners)) f() }
  const rowIs = (blank, preset) => { sessionRow = { blank, projectionValues: { agentPreset: preset } }; for (const f of Array.from(sessionSubs)) f() }

  // 1. the launch page: the chat is blank and recorded on Discussion, the host does not know yet; the host names the light agent a moment later
  await hostNow(withHost({ preset: null }))
  selectCalls.length = 0; selectResult = { ok: true, value: 'light-agent' }
  const m = await run('discussion', true)
  ok('the host does not know yet: the label is drawn, the mode is not (no « not ready » while it waits)', lineOf(m) !== null && textOf(lineOf(m)).startsWith(T.WORDS.label.en) && modeOf(m) === null && win.__KB_PHONE_MODEL__.seen.recheck === 'pending' && selectCalls.length === 0, JSON.stringify(win.__KB_PHONE_MODEL__.seen))
  ok('the wait ends and the host still does not know: now, and only now, it says the light agent was not ready', await settleTo(m, () => win.__KB_PHONE_MODEL__.seen.recheck === 'ended') && modeOf(m) !== null && textOf(modeOf(m)).includes(T.WORDS.modeChatReady.en) && selectCalls.length === 0, textOf(m.tree) + ' ' + JSON.stringify(win.__KB_PHONE_MODEL__.seen))
  await hostNow(withHost({ preset: 'light-agent' }))
  ok('the host\'s answer changed to the light agent: the page looks again (it did not, once per chat id) and selects it', await settleTo(m, () => selectCalls.length === 1) && selectCalls[0][0] === 'S1' && selectCalls[0][1] === 'light-agent', JSON.stringify(selectCalls))
  ok('and until the chat records it the note stays silent (« not ready » is gone, not replaced by another word)', modeOf(m) === null && win.__KB_PHONE_MODEL__.seen.recheck === 'pending', textOf(m.tree))
  rowIs(true, 'light-agent')
  ok('the chat records the light agent: « can set reminders »', await settleTo(m, () => modeOf(m) !== null) && modeOf(m).props['data-mode'] === 'light' && textOf(modeOf(m)).includes(T.WORDS.modeLight.en) && textOf(lineOf(m)).startsWith(T.WORDS.labelLight.en), textOf(m.tree))
  m.unmount()

  // 2. a chat that has STARTED is never touched, whatever the host says; it says what a new chat gets
  selectCalls.length = 0
  await hostNow(withHost({ preset: 'light-agent' }))
  const m2 = await run('discussion', false)
  await new Promise((r) => setTimeout(r, 300)); await m2.flush()
  ok('a chat that started on Discussion: no select, even when the host now names the light agent', selectCalls.length === 0)
  ok('and it says so in plain words: « chat only (a new chat can set reminders) », not « not ready »', modeOf(m2) !== null && textOf(modeOf(m2)).includes(T.WORDS.modeChatNew.en) && !textOf(m2.tree).includes(T.WORDS.modeChatReady.en), textOf(m2.tree))
  await hostNow(withHost({ preset: null }))
  await m2.flush()
  ok('a started chat while the host does not know: nothing about the mode (it does not know what a new chat would get)', modeOf(m2) === null && selectCalls.length === 0, textOf(m2.tree))
  m2.unmount()

  // 3. the engine says the chat has started although the list said blank: it reads as a started chat, no second try, no « not ready »
  selectCalls.length = 0
  selectOverride = () => ({ ok: false, error: { code: 'locked', message: 'the chat already started' } })
  await hostNow(withHost({ preset: 'light-agent' }))
  const m3 = await run('discussion', true)
  ok('the engine refuses (the chat had started): one try, and the note says what a new chat gets', await settleTo(m3, () => win.__KB_PHONE_MODEL__.seen.recheck === 'locked') && selectCalls.length === 1 && modeOf(m3) !== null && textOf(modeOf(m3)).includes(T.WORDS.modeChatNew.en), textOf(m3.tree) + JSON.stringify(selectCalls))
  m3.unmount()

  // 4. the engine refuses for another reason: the wait is over, the chat stays on Discussion and says why; choosing the model again looks again
  selectCalls.length = 0
  selectOverride = () => ({ ok: false, error: { code: 'unknown-preset', message: 'no preset light-agent' } })
  const m4 = await run('discussion', true)
  ok('another refusal: one try, the chat stays on Discussion, the note says the light agent was not ready', await settleTo(m4, () => win.__KB_PHONE_MODEL__.seen.recheck === 'ended') && selectCalls.length === 1 && modeOf(m4) !== null && textOf(modeOf(m4)).includes(T.WORDS.modeChatReady.en), textOf(m4.tree) + JSON.stringify(selectCalls))
  await m4.flush(); await new Promise((r) => setTimeout(r, 300)); await m4.flush()
  ok('and it does not ask again by itself (nothing changed)', selectCalls.length === 1, JSON.stringify(selectCalls))
  selectOverride = null; selectResult = { ok: true, value: 'light-agent' }
  choose(otherModel); await m4.flush()
  ok('the person picks another model: the line is gone', lineOf(m4) === null)
  choose(phoneModel)
  ok('and picks the phone model again: the page looks again, the note is silent while it does and the light agent is selected', await settleTo(m4, () => selectCalls.length === 2) && selectCalls[1][1] === 'light-agent' && modeOf(m4) === null, JSON.stringify(selectCalls) + textOf(m4.tree))
  m4.unmount()

  // 5. a host that flips back and forth cannot make the page ask the engine for ever
  selectCalls.length = 0
  selectOverride = () => ({ ok: false, error: { code: 'unknown-preset', message: 'no preset light-agent' } })
  const m5 = await run('discussion', true)
  for (let i = 0; i < 8; i += 1) {
    await hostNow(withHost({ preset: i % 2 === 0 ? 'discussion' : 'light-agent' }))
    await settleTo(m5, () => win.__KB_PHONE_MODEL__.seen.recheck === 'ended', 1500)
  }
  ok('a host that flips eight times: the engine is asked four times at most for this chat', selectCalls.length > 0 && selectCalls.length <= 4, JSON.stringify(selectCalls.length))
  m5.unmount()
  selectOverride = null; selectResult = { ok: true, value: PRESET_ID }
  Object.assign(T.RECHECK, real)
  await hostNow({ available: true, installed: true, model: { id: 'qwen3-1.7b-q4_k_m', name: 'Qwen3 1.7B' } })
  currentModel = phoneModel
  sessionRow = { blank: true, projectionValues: { agentPreset: 'standard' } }
}
console.log('a chat that is not a flow\'s keeps the model the person chose')
{
  hostBody = withHost({ preset: 'discussion', model: { id: 'qwen3-1.7b-q4_k_m', name: 'Qwen3 1.7B' } })
  selectModelCalls.length = 0
  events.get('win:kb-flow-chat')({ detail: { sessionId: 'S1', startedAt: Date.now() - 20000 } })
  const m = await run('discussion')
  ok('a flow event that arrives long after the flow began (a page put to sleep) moves nothing', selectModelCalls.length === 0 && find(m.tree, (n) => n.props && n.props['data-kb'] === 'phone-model-line') !== null && textOf(m.tree).indexOf(T.WORDS.switchedToCloud.en.split('{')[0]) < 0, JSON.stringify(selectModelCalls))
  m.unmount()
  events.get('win:kb-flow-chat')({ detail: { sessionId: 'S1', startedAt: Date.now() } })
  const started = await run('discussion', false)
  ok('a chat that already started is never moved by a flow event', selectModelCalls.length === 0, JSON.stringify(selectModelCalls))
  started.unmount()
  const fresh = await run('standard')
  ok('a recent flow event on a blank chat still moves it (the marker works as before)', await waitFor(() => selectModelCalls.length === 1) && selectModelCalls[0].provider === 'deepseek', JSON.stringify(selectModelCalls))
  fresh.unmount()
  selectModelCalls.length = 0
}
// ── the signed-out phone: one card when nobody can answer and the small model was never installed (S3, card 4b) ──
console.log('\nthe card « One step before you chat »')
{
  const N = T.needsModelStep
  const app = { supported: true, phase: 'none', installed: false, model: null }
  ok('Simple, the app can manage models, the small model is not on the phone, nobody else can answer: the card', N({ simple: true, app, others: false }) === true && N({ simple: true, app: { ...app, phase: 'failed' }, others: false }) === true)
  ok('not outside Simple, not while the answer of the directory is unknown, not when another model can answer (a signed-in phone, a key)', N({ simple: false, app, others: false }) === false && N({ simple: true, app, others: null }) === false && N({ simple: true, app, others: undefined }) === false && N({ simple: true, app, others: true }) === false)
  ok('not when the app cannot manage models here (a store build, a phone too small), when the model is there, or while it downloads, verifies or loads', N({ simple: true, app: { ...app, supported: false }, others: false }) === false && N({ simple: true, app: { ...app, installed: true, phase: 'installed' }, others: false }) === false && ['downloading', 'verifying', 'loading', 'installed'].every((phase) => N({ simple: true, app: { ...app, phase }, others: false }) === false))
  ok('not before the app has said anything', N({ simple: true, app: null, others: false }) === false && N({ simple: true, app: undefined, others: false }) === false)
  ok('the words are the same on the host side, French and English, and short enough for a phone card', T.WORDS.stepTitle.en === WORDS.stepTitle.en && T.WORDS.stepText.fr === WORDS.stepText.fr && T.WORDS.stepButton.fr === 'Prendre le modèle' && T.WORDS.stepButton.en === 'Get the model' && T.WORDS.stepText.fr.length <= 110 && T.WORDS.stepText.en.length <= 110)
  ok('the card\'s styles use the page tokens, a 44 px button, and wrap long words', /\.kbpm-card\{[^}]*var\(--dsw-alias-bg-layer-1/.test(T.CSS) && /\.kbpm-card-b\{[^}]*min-height:44px/.test(T.CSS) && /\.kbpm-card-s\{[^}]*overflow-wrap:anywhere/.test(T.CSS))
  // drawn: a Kaby-mode user agent, an app that says « supported, not installed », a directory that lists only the phone's provider (nothing else can answer)
  const savedNav = win.navigator
  const savedGroups = groups
  const savedBody = hostBody
  win.navigator = { userAgent: 'Mozilla/5.0 KybernosHost/0.1.0 (android) KabyMode/1' }
  groups = [{ id: PROVIDER_ID, name: 'On this phone', models: [] }]
  hostBody = { available: true, installed: false, model: null }
  events.get('win:kb-app-message')({ detail: { ...good, state: { supported: true, phase: 'none', installed: false, loaded: false, pct: null, model: null } }, preventDefault() {} })
  navigations.length = 0
  const m = await run('standard')
  const card = find(m.tree, (n) => n.props && n.props['data-kb'] === 'phone-model-step')
  ok('drawn above the composer: the title, the sentence and the button, in English', card !== null && textOf(card).includes(T.WORDS.stepTitle.en) && textOf(card).includes(T.WORDS.stepText.en) && textOf(card).includes(T.WORDS.stepButton.en), textOf(m.tree))
  ok('and it is the only thing drawn (no « small model on this phone » line for a model that is not there)', find(m.tree, (n) => n.props && n.props['data-kb'] === 'phone-model-line') === null)
  const btn = find(m.tree, (n) => n.props && n.props['data-act'] === 'get-model')
  if (btn !== null) btn.props.onClick()
  ok('the button opens the app\'s models screen (`kybernos://models`)', btn !== null && JSON.stringify(navigations) === '["kybernos://models"]', navigations)
  m.unmount()
  win.__KB_LANG_RESOLVE__ = () => 'fr'
  const mf = await run('standard')
  ok('in French the same card is French', textOf(find(mf.tree, (n) => n.props && n.props['data-kb'] === 'phone-model-step')).includes('Une étape avant de discuter') && textOf(mf.tree).includes('Prendre le modèle'))
  mf.unmount()
  win.__KB_LANG_RESOLVE__ = () => 'en'
  // another model can answer: no card
  groups = [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' }] }, { id: PROVIDER_ID, name: 'On this phone', models: [] }]
  const mo = await run('standard')
  ok('a phone where another model can answer (signed in, or a key of its own) never sees the card', find(mo.tree, (n) => n.props && n.props['data-kb'] === 'phone-model-step') === null)
  mo.unmount()
  // outside Simple (the full app on a phone): no card
  groups = [{ id: PROVIDER_ID, name: 'On this phone', models: [] }]
  win.navigator = { userAgent: 'Mozilla/5.0 KybernosHost/0.1.0 (android)' }
  const mn = await run('standard')
  ok('in the full app (no Kaby-mode token) the card is not drawn', find(mn.tree, (n) => n.props && n.props['data-kb'] === 'phone-model-step') === null)
  mn.unmount()
  win.navigator = savedNav; groups = savedGroups; hostBody = savedBody
  events.get('win:kb-app-message')({ detail: good, preventDefault() {} })
}
{
  for (const off of effects) { try { if (typeof off === 'function') off() } catch (e) { /* gone */ } }
  ok('every effect gives back what it took: the style is removed and the listeners are gone', doc.head.appended[0].removed === true && !events.has('win:kb-app-message') && !events.has('win:kb-flow-chat') && !events.has('doc:visibilitychange'))
}

// ── Simple mode: the phone's model answers when no other model can (the product rule of 2026-11-20) ──
console.log('\nSimple mode: the phone model chosen for a chat nothing else can answer')
{
  const W = T.wantsPhoneModel
  const base = { simple: true, available: true, installed: true, modelId: 'qwen3-1.7b-q4_k_m', phone: false, blank: true, others: false, done: false }
  ok('a blank chat in Simple, the phone model installed, no other model able to answer, not yet moved: it is moved', W(base) === true)
  ok('another model can answer (a signed-in phone, a key): nothing is moved, the engine\'s choice stands', W({ ...base, others: true }) === false)
  ok('the directory has not loaded (not known yet): wait, never guess « no other model »', W({ ...base, others: null }) === false && W({ ...base, others: undefined }) === false)
  ok('outside Simple the picker is there and the choice is the person\'s: nothing is moved', W({ ...base, simple: false }) === false)
  ok('a chat already on the phone\'s model, or one that started (the model was chosen), is left alone', W({ ...base, phone: true }) === false && W({ ...base, blank: false }) === false && W({ ...base, blank: undefined }) === false)
  ok('no phone model to move to (not active, not installed, no usable id): nothing is moved', W({ ...base, available: false }) === false && W({ ...base, installed: false }) === false && W({ ...base, modelId: '' }) === false && W({ ...base, modelId: '../x' }) === false)
  ok('it is done once per chat', W({ ...base, done: true }) === false)
  ok('Simple is the Kybernos app asking for Kaby mode, as kybernos-mobile reads it (the token, the app\'s own agent), and nothing else', T.SIMPLE_UA.test('Mozilla/5.0 KybernosHost/0.1.0 (android) KabyMode/1') && !T.SIMPLE_UA.test('Mozilla/5.0 KybernosHost/0.1.0 (android)') && !T.SIMPLE_UA.test('Mozilla/5.0 KabyMode/1') && !T.SIMPLE_UA.test('Mozilla/5.0 KybernosHost/0.1.0 (android) KabyMode/0'))
  const loaded = (value) => ({ catalog: { store: { getSnapshot: () => ({ value }) } } })
  ok('the directory counts as loaded once its catalog holds the groups', T.catalogLoaded(loaded({ groups: [] })) === true && T.catalogLoaded(loaded(null)) === false && T.catalogLoaded(loaded({})) === false && T.catalogLoaded({}) === false && T.catalogLoaded(null) === false)
  ok('the page waits a few seconds first (the directory loads in pieces) and that wait is short enough to be gone before the person types', T.AUTO_WAIT_MS >= 2000 && T.AUTO_WAIT_MS <= 5000)
  ok('no other model = the cloud choice finds none: a directory that lists only the phone\'s provider', T.cloudChoice({ catalog: { store: { getSnapshot: () => ({ value: { groups: [{ id: 'phone-local', models: [{ id: 'm' }] }], default: { provider: 'phone-local', model: 'm' } } }) } } }, { store: { getSnapshot: () => ({ groups: [{ id: 'phone-local', models: [{ id: 'm' }] }] }) } }) === null)
}

console.log('\n' + (fail === 0 ? 'all ' + pass + ' passed' : pass + ' passed, ' + fail + ' FAILED'))
process.exit(fail === 0 ? 0 : 1)
