#!/usr/bin/env node
// The « Update available » notice on a CLOUD COMPUTER (owner, 2026-11-21: « the notice says the computer is not up to date, but not how to update it, nor a simple way for someone who is
// not a developer »). On a cloud computer the software is the image: the registry's engine and suite say nothing there, a terminal command has no place, and the update is ONE button that
// asks the platform to move the machine onto the newest version. Also the same notice on any hosted instance: it never hands over a terminal command.
//
// The REAL client.js runs against a tiny DOM and a tiny React stand-in; the dialog is rendered and read.   node test-computer-update.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')

// ── a tiny DOM: elements, classes, attributes, text, the few selectors the dialog uses ───────────────────────────
class El {
  constructor (tag) { this.tag = tag; this.className = ''; this.children = []; this.attrs = {}; this.listeners = {}; this.parent = null; this._text = ''; this.dataset = {}; this.style = {}; this.disabled = false; this.onclick = null }
  get textContent () { return this._text + this.children.map((c) => (c instanceof El ? c.textContent : c.data)).join('') }
  set textContent (v) { this._text = String(v); this.children = [] }
  appendChild (c) { if (c instanceof El) c.parent = this; this.children.push(c); return c }
  remove () { if (this.parent !== null) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null }
  setAttribute (k, v) { this.attrs[k] = String(v) }
  removeAttribute (k) { delete this.attrs[k] }
  addEventListener (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn) }
  focus () {}
  click () { for (const fn of this.listeners.click || []) fn({}); if (typeof this.onclick === 'function') this.onclick({}) }
  classes () { return this.className.split(/\s+/).filter(Boolean) }
  matches (sel) {
    const m = /^([a-z0-9]*)((?:\.[\w-]+)*)(?:\[([\w-]+)="([^"]*)"\])?$/.exec(sel)
    if (m === null) return false
    if (m[1] !== '' && m[1] !== this.tag) return false
    for (const c of m[2].split('.').filter(Boolean)) if (!this.classes().includes(c)) return false
    if (m[3] !== undefined) { const v = m[3].startsWith('data-') ? this.attrs[m[3]] ?? this.dataset[m[3].slice(5)] : this.attrs[m[3]]; if (v !== m[4]) return false }
    return true
  }
  all (sel, out = []) { for (const c of this.children) if (c instanceof El) { if (c.matches(sel)) out.push(c); c.all(sel, out) } return out }
  querySelectorAll (sel) { return this.all(sel) }
  querySelector (sel) { return this.all(sel)[0] || null }
}
const body = new El('body')
const head = new El('head')
const doc = {
  body, head, activeElement: null,
  createElement: (t) => new El(t),
  createTextNode: (data) => ({ data }),
  querySelector: (sel) => body.querySelector(sel) || head.querySelector(sel),
  addEventListener () {}, removeEventListener () {}
}

let lang = 'en'
let definition
const stub = new Proxy({}, { get: (_t, k) => (k === 'Component' || k === 'PureComponent' ? class {} : k === 'useState' ? (v) => [v, () => {}] : k === 'useRef' ? (v) => ({ current: v }) : () => null) })
const win = { __ModuleLoader__: { load: (def) => { definition = def } }, __KB_LANG_RESOLVE__: () => lang, localStorage: { getItem: () => null, setItem: () => {} }, document: doc, dispatchEvent () {}, location: { reload () {} } }
new Function('window', 'document', SOURCE)(win, doc)
const T = definition.factory((nom) => { if (nom === 'react') return stub; throw new Error('no ' + nom) }).__test

const dialogue = (info) => { for (const e of body.querySelectorAll('.kbmu-scrim')) e.remove(); T.updDialog(info); return body.querySelector('.kbmu-scrim') }
const textOf = (el) => el.textContent
const mainButton = (el) => el.querySelector('.kbmu-b.main')

// What the host and the hub answer on a cloud computer today (the screenshot of 2026-11-21): the engine of the image is behind the registry's, the instance is a container.
const ENGINE = { kind: 'moteur', cible: '0.2.2-rc.5', installee: '0.2.2-alpha.2', requis: false, note: 'A newer engine version would re-enable the patches that are not applied.' }
const hosted = () => ({
  ok: true, checkedAt: 1,
  pack: { installee: '0.1.2', latest: '0.1.2', joignable: true, disponible: false, signe: false, applicable: false, heberge: true, git: false },
  moteur: { installee: '0.2.2-alpha.2', latest: '0.2.2-rc.5', cible: '0.2.2-rc.5' },
  pending: { ...ENGINE }
})
const ORD = { ok: true, applicable: true, supported: true, available: true, updating: false, target: 'a40ecd18' }

// ── the merge with the platform's answer ─────────────────────────────────────────────────────────────────────────
{
  const h = hosted()
  assert.equal(T.fusionnerOrdinateur(h, null), h, 'no answer: the host\'s own is untouched')
  assert.equal(T.fusionnerOrdinateur(h, { ok: true, applicable: false }), h, 'not a cloud computer: untouched')
  assert.equal(T.fusionnerOrdinateur(null, ORD), null)
  const a = T.fusionnerOrdinateur(h, ORD)
  assert.deepEqual(a.pending, { kind: 'ordinateur', cible: 'ordinateur-a40ecd18', installee: '', requis: false, note: '' })
  assert.deepEqual(a.ordinateur, { available: true, updating: false, supported: true, error: null })
  assert.equal(a.pack, h.pack, 'the rest of the answer is kept')
  const b = T.fusionnerOrdinateur(h, { ...ORD, available: false })
  assert.equal(b.pending, null, 'the registry\'s engine is never announced on a cloud computer: nothing newer on the platform, nothing to say')
  const c = T.fusionnerOrdinateur(h, { ...ORD, supported: false })
  assert.equal(c.pending, null, 'a platform that cannot move this machine offers nothing')
  const d = T.fusionnerOrdinateur(h, { ok: true, applicable: true, supported: false, available: false, updating: false, error: 'not_connected' })
  assert.equal(d.pending, null); assert.equal(d.ordinateur.error, 'not_connected')
  assert.equal(T.fusionnerOrdinateur(h, { ...ORD, target: null }).pending.cible, 'ordinateur-latest')
  ok('on a cloud computer the platform\'s answer replaces the registry\'s: announced only when a newer version is ready')
}

// ── the way an update is chosen ──────────────────────────────────────────────────────────────────────────────────
{
  assert.equal(T.modeMiseAJour(T.fusionnerOrdinateur(hosted(), ORD)), 'ordinateur')
  assert.equal(T.modeMiseAJour(hosted()), 'heberge', 'a hosted instance with a stale ENGINE is rebuilt too: it used to fall through to « in a terminal, from the repository »')
  const local = hosted(); local.pack.heberge = false; local.pack.git = true
  assert.equal(T.modeMiseAJour(local), 'moteur', 'a laptop keeps its own ways')
  ok('a hosted instance is « rebuilt », a cloud computer is « moved », a laptop is unchanged')
}

// ── the dialog, rendered ─────────────────────────────────────────────────────────────────────────────────────────
for (const [l, words] of [['en', { title: /Update available/, button: 'Update my cloud computer', kept: /files and settings are kept/ }], ['fr', { title: /Mise à jour disponible/, button: 'Mettre à jour mon ordinateur cloud', kept: /fichiers et tes réglages sont gardés/ }]]) {
  lang = l
  const d = dialogue(T.fusionnerOrdinateur(hosted(), ORD))
  const txt = textOf(d)
  assert.match(txt, words.title)
  assert.equal(mainButton(d).textContent, words.button, 'one button, in plain words (' + l + ')')
  assert.equal(mainButton(d).attrs['data-kb'], 'upd-go')
  assert.match(txt, words.kept)
  assert.equal(d.querySelectorAll('.kbmu-cmd').length, 0, 'no command to copy')
  assert.ok(!/terminal|node scripts|dsh-lifecycle|git pull|repository|dépôt|0\.2\.2/.test(txt), 'no terminal, no repository, no engine version: ' + txt)
}
ok('a cloud computer with a newer version ready: one button, what is kept, nothing to type — in both languages')

{
  lang = 'en'
  const d = dialogue(T.fusionnerOrdinateur(hosted(), { ...ORD, available: false }))
  const txt = textOf(d)
  assert.match(txt, /You are up to date/)
  assert.match(txt, /Your cloud computer/)
  assert.equal(d.querySelector('.kbmu-b.main').textContent, 'Close', 'nothing to apply: only « Close »')
  assert.ok(!/rc\.5|alpha|Engine/.test(txt), 'the registry\'s engine is not shown on a cloud computer: ' + txt)
  ok('a cloud computer already on the newest version says « up to date » and does not compare its engine with the registry')
}

{
  // The notice a hosted instance that is NOT a cloud computer got in the screenshot: the terminal command is gone.
  for (const l of ['en', 'fr']) {
    lang = l
    const d = dialogue(hosted())
    const txt = textOf(d)
    assert.equal(d.querySelectorAll('.kbmu-cmd').length, 0, 'no command to copy on a hosted instance')
    assert.ok(!/terminal|node scripts|dsh-lifecycle|git pull/.test(txt), 'no terminal vocabulary: ' + txt)
    assert.match(txt, l === 'en' ? /rebuilt|Redeploy/ : /reconstruit|Redéploie/)
  }
  ok('a hosted instance is told to redeploy it, never to type a command')
}

// ── the click: ask, follow the restart, reload ───────────────────────────────────────────────────────────────────
{
  const mk = () => ({ disabled: false, textContent: '' })
  const answers = (list) => { const calls = []; return { calls, appel: async (url, o) => { calls.push([url, o && o.method || 'GET']); const a = list.shift(); if (a instanceof Error) throw a; return { ok: a.status === undefined || a.status < 300, status: a.status || 200, json: async () => a.body } } } }
  let clock = 0
  const dep = (appel) => ({ appel, pause: async (ms) => { clock += ms }, maintenant: () => clock, recharger: () => { dep.reloaded = true } })

  // happy path: accepted, still moving, the machine goes away, comes back on the new version, the page reloads
  let a = answers([{ body: { ok: true, started: true } }, { body: { ok: true, applicable: true, available: true, updating: true } }, new Error('down'), new Error('down'), { body: { ok: true, applicable: true, available: false, updating: false } }])
  let btn = mk(); let st = mk(); let fini = 0; dep.reloaded = false
  lang = 'en'
  assert.equal(await T.updOrdinateurRun(btn, st, () => { fini += 1 }, dep(a.appel)), true)
  assert.deepEqual(a.calls[0], ['/kybernos-cloud/computer/update/start', 'POST'])
  assert.equal(a.calls.length, 5)
  assert.match(st.textContent, /^✓ Your cloud computer is up to date/)
  assert.equal(fini, 1); assert.equal(dep.reloaded, true, 'the page reloads by itself')
  ok('the click asks the platform, waits through the restart and reloads the page when the machine is back')

  // a refusal is words, the button is given back
  for (const [code, re] of [['up_to_date', /already up to date/], ['update_running', /already running/], ['not_connected', /sign in again/], ['whatever', /could not start/]]) {
    a = answers([{ body: { ok: false, error: code } }]); btn = mk(); st = mk()
    assert.equal(await T.updOrdinateurRun(btn, st, () => {}, dep(a.appel)), false)
    assert.match(st.textContent, re); assert.equal(btn.disabled, false)
    assert.ok(!st.textContent.includes(code), 'a code is never shown')
  }
  a = answers([new Error('network')]); btn = mk(); st = mk()
  assert.equal(await T.updOrdinateurRun(btn, st, () => {}, dep(a.appel)), false); assert.equal(btn.disabled, false)
  ok('a refusal is said in plain words and the button comes back; a code is never shown')

  // the move did not happen: the platform answers, nothing moves, a newer version is still ready
  a = answers([{ body: { ok: true, started: true } }, { body: { ok: true, applicable: true, available: true, updating: false } }]); btn = mk(); st = mk(); dep.reloaded = false
  assert.equal(await T.updOrdinateurRun(btn, st, () => {}, dep(a.appel)), false)
  assert.match(st.textContent, /did not complete and nothing changed/); assert.equal(btn.disabled, false); assert.equal(dep.reloaded, false)
  // gone for ten minutes: the person is told
  clock = 0
  a = answers([{ body: { ok: true, started: true } }, ...Array.from({ length: 300 }, () => new Error('down'))]); btn = mk(); st = mk()
  assert.equal(await T.updOrdinateurRun(btn, st, () => {}, dep(a.appel)), false)
  assert.match(st.textContent, /did not complete/)
  ok('a move that did not happen, or a machine that never comes back, is told and can be tried again')

  // reading the platform's answer
  assert.equal(await T.ordinateurFetch(async () => ({ ok: false })), null)
  assert.equal(await T.ordinateurFetch(async () => { throw new Error('x') }), null)
  assert.equal(await T.ordinateurFetch(async () => ({ ok: true, json: async () => ({ ok: false }) })), null)
  assert.deepEqual(await T.ordinateurFetch(async () => ({ ok: true, json: async () => ORD })), ORD)
  ok('a missing cloud plugin or an unusable answer leaves the notice as the host made it')
}

// ── the wiring ───────────────────────────────────────────────────────────────────────────────────────────────────
{
  assert.ok(/fusionnerOrdinateur\(info, await ordinateurFetch\(\)\)/.test(SOURCE), 'every check asks the cloud plugin')
  assert.ok(/'\/kybernos-cloud\/computer\/update\/start', \{ method: 'POST'/.test(SOURCE), 'the click posts to the cloud plugin, which asks the platform as the person')
  assert.ok(!/kybernos-hub\/engine/.test(SOURCE.slice(SOURCE.indexOf('const updOrdinateurRun'), SOURCE.indexOf('/** The dialog: versions'))), 'the cloud computer\'s button never goes through the engine route')
  ok('the check asks the cloud plugin and the click goes through it')
}

console.log('\n' + pass + ' checks passed')
