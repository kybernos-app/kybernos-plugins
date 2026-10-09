// Browser half tests: the built bundle runs against a stub window, no browser. `cd packages/kybernos-motion && node test-client.mjs`
import { readFileSync } from 'node:fs'
import { assemble } from './scripts/build.mjs'

let fail = 0
let n = 0
const ok = (name, cond, detail) => {
  n++
  if (cond) return
  fail++
  console.log(`FAIL ${name}${detail === undefined ? '' : ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`)
}

const SEP = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']') // never written as an escape: some tools turn it into a raw character
const src = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
ok('client.js is the current build of the sources', src === assemble())
ok('client.js has no raw line-separator characters', !SEP.test(src))

// ── load the bundle ─────────────────────────────────────────────────────────
let definition = null
const fetchCalls = []
let fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({ ok: false }) })
const win = {
  __ModuleLoader__: { load: (d) => { definition = d } },
  addEventListener () {}, devicePixelRatio: 1,
  matchMedia: () => ({ matches: false }),
}
const els = new Map()
const doc = {
  getElementById: (id) => els.get(id) || null,
  createElement: (tag) => ({ tag, style: {}, setAttribute () {}, appendChild () {}, remove () {}, set textContent (v) { this._t = v }, get textContent () { return this._t } }),
  head: { appendChild: (el) => { els.set(el.id, el) } },
  body: { appendChild () {} },
}
const React = { createElement: (type, props, ...kids) => ({ type, props: props || {}, kids: kids.flat(Infinity) }), useReducer: () => [0, () => {}] }
globalThis.window = win
globalThis.document = doc
globalThis.fetch = (...a) => { fetchCalls.push(a); return fetchImpl(...a) }
new Function('window', 'document', src)(win, doc)
ok('the bundle registers one module', definition && definition.id === '@local/kybernos-motion/client' && typeof definition.factory === 'function')
const plugin = definition.factory((name) => (name === 'react' ? React : (() => { throw new Error('unexpected require ' + name) })()))
ok('the factory returns a plugin object', plugin && typeof plugin.apply === 'function')
ok('it declares the services it needs (slots and the right-sidebar tabs)', Array.isArray(plugin.inject) && plugin.inject.includes('slots') && plugin.inject.includes('sidebarRightTabs'), plugin.inject)
const T = plugin.__test

// ── a failing evaluation degrades instead of throwing ───────────────────────
{
  let def2 = null
  const bad = src.replace('const RUNTIME_SRC =', 'throw new Error("boom"); const RUNTIME_SRC =')
  new Function('window', 'document', bad)({ __ModuleLoader__: { load: (d) => { def2 = d } } }, doc)
  const origErr = console.error
  console.error = () => {}
  const p2 = def2.factory(() => React)
  console.error = origErr
  ok('an exception while evaluating gives a disabled plugin, not a broken page', typeof p2.apply === 'function' && p2.inject.length === 0)
}

// ── parseDoc ────────────────────────────────────────────────────────────────
{
  const good = JSON.stringify({ kind: 'motion', title: 'Mon titre', meta: { rev: 3 }, data: [{ format: { duration: 3 }, layers: [{ type: 'rect' }] }] })
  const p = T.parseDoc(good)
  ok('parseDoc: a motion file gives its scene, title and rev', p.ok && p.title === 'Mon titre' && p.rev === 3 && p.scene.layers.length === 1 && p.scene._n === true, p)
  ok('parseDoc: the payload wrapper is accepted', T.parseDoc(JSON.stringify({ kind: 'motion', data: [{ payload: { layers: [{ type: 'circle' }] } }] })).scene.layers[0].type === 'circle')
  ok('parseDoc: invalid JSON is a message, not a throw', T.parseDoc('{nope').ok === false && typeof T.parseDoc('{nope').message === 'string')
  ok('parseDoc: no scene is a message', T.parseDoc('{"kind":"motion"}').ok === false && T.parseDoc('').ok === false)
  ok('parseDoc: engine problems are carried along', T.parseDoc(JSON.stringify({ kind: 'motion', data: [{ layers: [{ type: 'nope' }] }] })).errors.length === 1)
}

// ── controlsOf ──────────────────────────────────────────────────────────────
{
  const inferred = T.controlsOf({ params: { titre: 'x', accent: '#ff0000', n: 5, flag: true }, controls: [] })
  ok('controlsOf: infers text, colour and number, skips booleans', inferred.map((c) => c.id + ':' + c.type).join() === 'titre:text,accent:color,n:number', inferred)
  const explicit = T.controlsOf({ params: { a: 'x' }, controls: [{ id: 'a', label: 'Nom', type: 'text' }] })
  ok('controlsOf: explicit controls win', explicit.length === 1 && explicit[0].label === 'Nom')
}

// ── small helpers ───────────────────────────────────────────────────────────
ok('fmtT: minutes, seconds and tenths', T.fmtT(3.4) === '0:03.4' && T.fmtT(75.04) === '1:15.0')
ok('slugOf: a safe file stem', T.slugOf('Intro été 1.0!') === 'intro-ete-1-0' && T.slugOf('???') === 'animation')
ok('q: builds a query string, skipping empties', T.q({ a: 'x y', b: '', c: null, d: 2 }) === 'a=x%20y&d=2')

// ── standaloneHTML: a page that plays by itself ─────────────────────────────
{
  const scene = T.parseDoc(JSON.stringify({ kind: 'motion', data: [{ format: { duration: 2 }, params: { t: '</script><b>x' }, layers: [{ type: 'text', text: '{t}' }, { type: 'image', src: 'a.png' }], audio: [{ synth: 'ding' }, { src: 'a.mp3' }] }] })).scene
  const html = T.standaloneHTML({ title: 'A "title" </title><script>alert(1)</script>', scene, images: { 'a.png': 'data:image/png;base64,AAAA' }, sounds: { 'a.mp3': 'data:audio/mpeg;base64,BBBB' } })
  ok('standalone: a complete page', html.startsWith('<!doctype html>') && html.includes('<canvas id="cv">') && html.trim().endsWith('</html>'))
  ok('standalone: the title cannot break out of the page', !html.includes('<script>alert(1)') && html.includes('&lt;/title&gt;'))
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  ok('standalone: two data blocks and one code block, and no script is closed early', scripts.length === 3 && scripts[0][1].includes('application/json') && scripts[1][1].includes('application/json'), scripts.map((s) => s[1]))
  const sceneBack = JSON.parse(scripts[0][2].replace(/\\u003c/g, '<'))
  ok('standalone: the scene survives, text with </script> included', sceneBack.params.t === '</script><b>x' && sceneBack.layers[0].type === 'text')
  const media = JSON.parse(scripts[1][2])
  ok('standalone: the media travel as data URLs', media.images['a.png'].startsWith('data:image/png') && media.sounds['a.mp3'].startsWith('data:audio/mpeg'))
  let syntax = null
  try { new Function(scripts[2][2]) } catch (e) { syntax = e }
  ok('standalone: the code block is valid JavaScript', syntax === null, syntax && String(syntax))
  // the pasted runtime is the real engine: run it and ask it for a frame
  const runtime = scripts[2][2].slice(0, scripts[2][2].indexOf('const SCENE ='))
  const rt = new Function(runtime + '; return { engine, audio, render2d }')()
  const f = rt.engine.evaluate(scene, 1)
  ok('standalone: the embedded runtime evaluates a frame like the bundle does', f.ops.some((o) => o.op === 'text' && o.text === '</script><b>x') && typeof rt.render2d.paint === 'function' && typeof rt.audio.mix === 'function')
  ok('standalone: no raw line separators', !SEP.test(html))
  const sceneWithLS = T.parseDoc(JSON.stringify({ kind: 'motion', data: [{ params: { t: 'a' + String.fromCharCode(0x2028) + 'b' }, layers: [{ type: 'text', text: '{t}' }] }] })).scene
  ok('standalone: a line separator inside the scene is escaped', !SEP.test(T.standaloneHTML({ title: 't', scene: sceneWithLS, images: {}, sounds: {} })))
}

// ── apply(): the tab, the slot, the door ────────────────────────────────────
{
  const effects = []
  const tabs = []
  const slots = []
  const ctx = {
    effect: (fn, label) => { try { effects.push({ label, cleanup: fn() }) } catch (e) { effects.push({ label, error: e }) } },
    get: (k) => (k === 'sidebarRightTabs' ? { register: (t) => { tabs.push(t); return () => {} } } : undefined),
    slots: { inject: (name, f) => { f(); return () => {} }, register: (meta, comp) => { slots.push([meta, comp]); return () => {} } },
  }
  fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({ ok: false }) })
  win.__KB_MINIAPP__ = undefined
  plugin.apply(ctx)
  ok('apply: the styles are injected once, with the plugin marker', els.has('kybernos-motion-styles') && effects.some((e) => e.label.includes('styles')))
  ok('apply: no effect threw', effects.every((e) => !e.error), effects.filter((e) => e.error).map((e) => String(e.error)))
  ok('apply: the sidebar tab type is registered', tabs.length === 1 && tabs[0].kind === 'kybernos-motion' && tabs[0].title() === 'Motion')
  ok('apply: the panel body is registered in the right-pane slot', slots.length === 1 && slots[0][0].name === 'sidebar.right.pane.tab' && slots[0][0].key === 'kybernos-motion' && typeof slots[0][1] === 'function')
  ok('apply: the player waits in the queue when the core has not loaded yet', Array.isArray(win.__KB_MINIAPP_PENDING__) && win.__KB_MINIAPP_PENDING__.some((e) => e[0] === 'motion' && typeof e[1] === 'function'), win.__KB_MINIAPP_PENDING__)
  const registered = []
  win.__KB_MINIAPP__ = { register: (name, Comp) => { registered.push([name, Comp]); return true } }
  plugin.apply(ctx)
  ok('apply: with the core door present the player registers directly', registered.length === 1 && registered[0][0] === 'motion')
  ok('apply: it offers an exporter and an opener to the other bundles', typeof win.__KB_MINIAPP_EXPORTERS__.motion === 'function' && typeof win.__KB_MOTION__.open === 'function')
  for (const e of effects) { try { if (typeof e.cleanup === 'function') e.cleanup() } catch (x) { /* the intervals */ } }
}

// ── the exporter the Mac app install uses ───────────────────────────────────
{
  const root = { querySelector: (sel) => (sel === '[data-kb-path]' ? { getAttribute: () => '/p/artifacts/x.miniapp.json' } : null), getAttribute: () => null }
  fetchCalls.length = 0
  fetchImpl = async (url) => (String(url).includes('/kybernos-motion/scene')
    ? { ok: true, status: 200, json: async () => ({ ok: true, title: 'Mon anim', path: '/p/artifacts/x.miniapp.json', scene: { format: { duration: 2 }, layers: [{ type: 'rect' }] } }) }
    : { ok: false, status: 404, json: async () => ({ ok: false }) })
  const out = await win.__KB_MINIAPP_EXPORTERS__.motion(root)
  ok('exporter: it reads the scene from the host and returns a live page', out && out.titre === 'Mon anim' && out.html.includes('<canvas id="cv">') && fetchCalls[0][0].includes('/kybernos-motion/scene?path=' + encodeURIComponent('/p/artifacts/x.miniapp.json')), fetchCalls.map((c) => c[0]))
  ok('exporter: a root with no scene path gives null (miniapps falls back to the snapshot)', (await win.__KB_MINIAPP_EXPORTERS__.motion({ querySelector: () => null })) === null)
  fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({ ok: false }) })
  ok('exporter: an unreadable scene gives null', (await win.__KB_MINIAPP_EXPORTERS__.motion(root)) === null)
}

// ── standalone with 3D and Lottie ───────────────────────────────────────────
{
  const scene = T.parseDoc(JSON.stringify({ kind: 'motion', data: [{ format: { duration: 2 }, layers: [{ type: 'scene3d', objects: [{ shape: 'model', src: 'hero.glb', clip: 'Run' }, { shape: 'box' }] }, { type: 'lottie', src: 'hero.json' }] }] })).scene
  const html = T.standaloneHTML({ title: 'Hero', scene, images: {}, sounds: {}, lotties: { 'hero.json': '{"fr":30,"op":60,"layers":[]}' }, models: { 'hero.glb': 'data:model/gltf-binary;base64,AAAA' }, libs: { three: 'var KbMotionThree = {}; /* </script> */', lottie: 'var KbMotionLottie = {}; var s = "</SCRIPT>";' } })
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  ok('standalone 3D: the libraries come first, each in its own script, none closed early', scripts.length === 5 && scripts[2][2].includes('KbMotionThree') && scripts[3][2].includes('KbMotionLottie'), scripts.map((x) => x[2].slice(0, 30)))
  ok('standalone 3D: a </script> inside a library is neutralised', !/<\/script>\s*\*\//.test(html) && !html.includes('"</SCRIPT>"'))
  const media = JSON.parse(scripts[1][2])
  ok('standalone 3D: the Lottie file travels as text and the model as a data URL', media.lotties['hero.json'].includes('"fr":30') && media.models['hero.glb'].startsWith('data:model/gltf-binary'))
  let syntax = null
  try { new Function(scripts[4][2]) } catch (e) { syntax = e }
  ok('standalone 3D: the player code is valid JavaScript and builds the external renderers', syntax === null && scripts[4][2].includes('renderExt.createExternal') && scripts[4][2].includes('renderExt.createModelLoader(window.KbMotionThree)'), syntax && String(syntax))
  const runtime = scripts[4][2].slice(0, scripts[4][2].indexOf('const SCENE ='))
  const rt = new Function(runtime + '; return { engine, renderExt }')()
  ok('standalone 3D: the embedded runtime has the 3D and Lottie renderers', typeof rt.renderExt.createExternal === 'function' && rt.engine.needs(scene).three === true)
}

// ── contract on the source ──────────────────────────────────────────────────
const body = readFileSync(new URL('./src/plugin.js', import.meta.url), 'utf8')
for (const hook of ["'motion-panel'", "'motion-player'", "'motion-canvas'", "'motion-timeline'", "'motion-empty'", "'motion-list'", "'motion-hint'"]) ok('hook ' + hook + ' exists', body.includes('data-kb\': ' + hook) || body.includes('"data-kb": ' + hook) || body.includes('\'data-kb\': ' + hook))
for (const act of ['play', 'export', 'export-go', 'download', 'revisions', 'restore', 'list', 'cancel', 'edit']) ok('data-act ' + act + ' exists', body.includes(`'data-act': '${act}'`))
ok('models are loaded through the safe loader only (a data file must not make the browser fetch anything)', !/new (window\.KbMotionThree|THREE)\.GLTFLoader\(/.test(body) && (body.match(/createModelLoader\(/g) || []).length === 2)
ok('buttons are reset at zero specificity, so the component classes win', body.includes(':where(.kbmt-root) button{'))
ok('colours come from DSH tokens with a fallback', body.includes('var(--dsw-alias-bg-layer-1,#fff)') && body.includes('var(--dsw-alias-label-primary,#0f1115)'))
ok('only one style element, removed on cleanup', (body.match(/createElement\('style'\)/g) || []).length === 1 && body.includes('el.remove()'))
ok('user-visible strings go through kt (no bare French titles in attributes)', !/title: '[A-Z][a-zé]+'/.test(body.replace(/title: 'Motion'/g, '')))
ok('every route used is one the host mounts', [...body.matchAll(/api\('(?:GET|POST)', '([a-z]+)/g)].every((m) => ['state', 'scene', 'save', 'open', 'list', 'revisions', 'restore', 'export', 'frame'].includes(m[1])), [...body.matchAll(/api\('(?:GET|POST)', '([a-z]+)/g)].map((m) => m[1]))
const host = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
for (const m of body.matchAll(/api\('(?:GET|POST)', '([a-z]+)/g)) ok(`the host mounts route ${m[1]}`, host.includes(`route('${m[1]}'`))

console.log(`${n - fail}/${n} checks passed`)
process.exit(fail ? 1 : 0)
