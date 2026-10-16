// The browser half: contract (plugin object, slot ids and priority, seam, strings in both languages, tokens not colours)
// and the pure helpers (the name rule is the host's, paths, the dialog's promise). Runs without DSH and without a browser:
// client.js is evaluated against a stub loader.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { validName as hostValidName } from './multi-device-host.mjs'

let fail = 0
const ok = (name, cond, detail) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  ' + (detail || ''))); if (!cond) fail++ }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')

// ── a stub loader + a React that only builds plain objects ─────────────────────────────────────────────
let captured = null
globalThis.window = { __ModuleLoader__: { load: (m) => { captured = m } }, __KB_LANG_RESOLVE__: () => 'kybernos' }
globalThis.document = { head: { appendChild () {} }, createElement: () => ({ setAttribute () {}, remove () {} }), addEventListener () {}, removeEventListener () {}, body: {} }
globalThis.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: false }) })
const React = {
  createElement: (type, props, ...kids) => ({ type, props, kids }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}], useEffect () {}, useRef: (v) => ({ current: v }),
}
// eslint-disable-next-line no-new-func
new Function(src)()
ok('registers one module with the loader', captured !== null && captured.id === '@local/kybernos-multi-device')
const plugin = captured.factory((name) => (name === 'react' ? React : (() => { throw new Error('no ' + name) })()))
ok('factory returns a plugin object with apply and inject', plugin !== undefined && typeof plugin.apply === 'function' && Array.isArray(plugin.inject) && plugin.inject.includes('slots'))
const T = plugin.__test
const SEAM = Symbol.for('kybernos.multiDevice')

// ── apply: the two slots at priority -1, the seam, the styles ───────────────────────────────────────────
{
  const regs = []
  const styles = []
  const disposers = []
  const ctx = {
    effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return d },
    get: () => undefined,
    slots: { inject: (name, fn) => fn(), register: (meta, comp) => { regs.push({ meta, comp }) } },
  }
  globalThis.document.head.appendChild = (n) => styles.push(n)
  plugin.apply(ctx)
  const hero = regs.find((r) => r.meta.name === 'conversation.hero.workspace.directoryFlow')
  const side = regs.find((r) => r.meta.name === 'sidebar.workspaces.directoryFlow')
  ok('sits in front of the native picker in the empty-chat flow', hero !== undefined && hero.meta.priority === -1)
  ok('sits in front of the native picker in the sidebar flow', side !== undefined && side.meta.priority === -1)
  ok('both slots get the same component', hero !== undefined && side !== undefined && hero.comp === side.comp)
  ok('the seam is published for the core bundle', globalThis[SEAM] !== undefined && globalThis[SEAM].version === 1 && typeof globalThis[SEAM].choose === 'function' && typeof globalThis[SEAM].detailsExtras === 'function')
  ok('the styles are one tagged <style>', styles.length === 1)
  const extras = globalThis[SEAM].detailsExtras({ path: '/x/y' })
  ok('detailsExtras returns an element', extras !== null && typeof extras === 'object' && extras.props.path === '/x/y')
  ok('detailsExtras survives odd input', (() => { try { globalThis[SEAM].detailsExtras(null); globalThis[SEAM].detailsExtras({ path: 5 }); return true } catch (e) { return false } })())
  for (const d of disposers) d()
  ok('disposing removes the seam', globalThis[SEAM] === undefined)
}
ok('apply survives a context without slots', (() => { try { plugin.apply({ effect: (fn) => fn(), get: () => undefined }); return true } catch (e) { return false } })())
ok('apply survives a context whose effect throws', (() => { try { plugin.apply({ effect: () => { throw new Error('boom') }, get: () => undefined, slots: {} }); return true } catch (e) { return false } })())
{
  let seen = null
  const broken = captured.factory(() => { throw new Error('no react') })
  ok('a failing factory returns a disabled plugin, not a throw', broken !== undefined && typeof broken.apply === 'function' && (seen = broken.apply()) === undefined)
}

// ── strings: both languages, same placeholders, all used ────────────────────────────────────────────────
{
  const keys = Object.keys(T.S)
  ok('there are strings', keys.length > 40)
  const holes = (t) => (t.match(/\{\w+\}/g) || []).sort().join()
  const bad = keys.filter((k) => !Array.isArray(T.S[k]) || T.S[k].length !== 2 || T.S[k][0].trim() === '' || T.S[k][1].trim() === '' || holes(T.S[k][0]) !== holes(T.S[k][1]))
  ok('every string has a French and an English side with the same placeholders', bad.length === 0, bad.join(','))
  const used = new Set([...src.matchAll(/\bL\(\s*'([A-Za-z0-9]+)'/g)].map((m) => m[1]))
  ok('no string is used without being defined', [...used].every((k) => keys.includes(k)), [...used].filter((k) => !keys.includes(k)).join(','))
  ok('no string is defined without being used', keys.every((k) => used.has(k)), keys.filter((k) => !used.has(k)).join(','))
  ok('French by default', T.L('create') === 'Créer le workspace')
  window.__KB_LANG_RESOLVE__ = () => 'en'
  ok('English when the language is English', T.L('create') === 'Create workspace')
  window.__KB_LANG_RESOLVE__ = () => 'es'
  ok('any other language gets English, never French', T.L('create') === 'Create workspace')
  window.__KB_LANG_RESOLVE__ = () => { throw new Error('not ready') }
  ok('a language that is not known yet reads English, not French', T.L('create') === 'Create workspace')
  window.__KB_LANG_RESOLVE__ = undefined
  ok('no resolver at all: English', T.L('create') === 'Create workspace')
  window.__KB_LANG_RESOLVE__ = () => 'kybernos'
  ok('placeholders are filled', T.L('noneSub', { path: '~/x' }) === 'Un dossier privé est créé pour vous : ~/x')
}

// ── styles: tokens, not colours ────────────────────────────────────────────────────────────────────────
{
  const noVars = T.CSS.replace(/var\([^()]*(\([^()]*\))?[^()]*\)/g, '')
  const hex = (noVars.match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter((c) => c.toLowerCase() !== '#fff')
  ok('colours come from DSH tokens (only fallbacks inside var() and the switch knob)', hex.length === 0, hex.join(','))
  ok('the prefix is private', /\.kbmd-/.test(T.CSS) && !/[^a-z]\.(kb|kb8|kbm)-/.test(T.CSS))
  ok('motion respects reduced-motion', /prefers-reduced-motion/.test(T.CSS))
}
ok('stable test hooks exist', ['kybernos-multi-device-dialog', 'kybernos-multi-device-name', 'kybernos-multi-device-folder', 'kybernos-multi-device-adv', 'kybernos-multi-device-exec', 'kybernos-multi-device-devices', 'kybernos-multi-device-today'].every((k) => src.includes("'" + k + "'")))
ok('no blocking browser dialog', !/\b(alert|confirm|prompt)\(/.test(src))

// ── the name rule is the host's ────────────────────────────────────────────────────────────────────────
{
  const vector = ['Notes TVA', '  Veille   et idées ', '', '   ', 'a/b', 'a\\b', '../x', 'a:b', 'a*b', '.hidden', 'name.', '..', 'CON', 'nul.txt', 'LPT1', 'x\ny', 'x'.repeat(80), 'x'.repeat(81), 'Ça va très bien', null, 12]
  const diff = vector.filter((v) => JSON.stringify(T.validName(v)) !== JSON.stringify(hostValidName(v)))
  ok('client and host agree on every name', diff.length === 0, JSON.stringify(diff))
  ok('NAME_MAX matches', T.NAME_MAX === 80)
}

// ── paths ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const st = { root: '/home/x/Documents/Kybernos', rootDisplay: '~/Documents/Kybernos' }
  ok('home is recovered from the root and its display form', T.homeOf(st) === '/home/x')
  ok('no home when the host abbreviated nothing', T.homeOf({ root: '/mnt/d/Kybernos', rootDisplay: '/mnt/d/Kybernos' }) === null && T.homeOf(null) === null)
  ok('a private folder is under the root', T.isPrivate('/home/x/Documents/Kybernos/Notes', st) === true && T.isPrivate('/home/x/dev/reviz', st) === false)
  ok('a sibling with the same prefix is not private', T.isPrivate('/home/x/Documents/Kybernos-old/a', st) === false)
  ok('paths under home are shown with ~', T.showPath('/home/x/dev/reviz', st) === '~/dev/reviz' && T.showPath('/mnt/other', st) === '/mnt/other')
  ok('unknown status leaves the path as is', T.showPath('/home/x/dev/reviz', null) === '/home/x/dev/reviz')
}

// ── the dialog's promise ───────────────────────────────────────────────────────────────────────────────
{
  T.store.hosts = []
  let refused = false
  await T.choose().catch(() => { refused = true })
  ok('choose() rejects when nothing can show the dialog (the core falls back to the native picker)', refused)
  T.store.hosts.push('flow-1')
  const p = T.choose()
  ok('a second call shares the pending dialog', T.choose() === p && T.store.open === true)
  T.settle('/home/x/Documents/Kybernos/Notes')
  ok('settle resolves the path and closes', (await p) === '/home/x/Documents/Kybernos/Notes' && T.store.open === false)
  const q = T.choose()
  T.settle(null)
  ok('cancelling resolves null', (await q) === null)
}

process.exit(fail ? 1 : 0)
