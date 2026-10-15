#!/usr/bin/env node
// The notification store behind the sidebar bell and its toast (client.js, between the <kb-notify> markers), tested in
// isolation with a fake storage, a fake window and a fake document. No browser.
//
//   node packages/kybernos-plugin/test-notify.mjs
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const SOURCE = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const a = SOURCE.indexOf('// <kb-notify>')
const b = SOURCE.indexOf('// </kb-notify>')
if (a < 0 || b < a) { console.log('  ✗ the <kb-notify> block is missing from client.js'); process.exit(1) }
const { kbNotifyStart } = new Function(SOURCE.slice(a, b) + '\nreturn { kbNotifyStart }')()

const mkStorage = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) } } }
const mkDoc = () => {
  const made = []
  const mk = (tag) => { const el = { tag, children: [], attrs: {}, listeners: {}, textContent: '', className: '', removed: false, setAttribute(k, v) { this.attrs[k] = v }, appendChild(c) { this.children.push(c) }, addEventListener(t, fn) { this.listeners[t] = fn }, remove() { this.removed = true } }; made.push(el); return el }
  return { made, createElement: mk, body: { appendChild(el) { el.attached = true } } }
}
const mkWin = () => { const events = []; return { events, dispatchEvent: (e) => { events.push(e); return true }, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail } } } }
const make = (extra) => {
  const storage = mkStorage(); const win = mkWin(); const doc = mkDoc(); let t = 1000
  const api = kbNotifyStart(Object.assign({ storage, window: win, document: doc, now: () => ++t }, extra || {}))
  return { api, storage, win, doc }
}

console.log('publishing')
{
  const { api, win, doc } = make()
  check('the store is published for the other plugins', typeof win.__KB_NOTIFY__ === 'object' && win.__KB_NOTIFY__ === api)
  check('something that is not a note is refused (no id, no title, not an object)', api.push(null) === null && api.push({ title: 'x' }) === null && api.push({ id: 'a' }) === null && api.list().length === 0)
  const n = api.push({ id: 'lang:es', kind: 'success', title: 'Español is ready', body: 'Switch to it any time.', action: { label: 'Use it', event: 'kb-lang-use', detail: { lang: 'es' } } })
  check('a note is kept with its time, kind and action', n.kind === 'success' && n.read === false && n.action.event === 'kb-lang-use' && api.list().length === 1 && api.unread() === 1)
  check('it is announced with a toast that carries the action', doc.made.some((el) => el.attrs['data-kb'] === 'notify-toast' && el.attached === true) && doc.made.some((el) => el.className === 'kbn-toast-act' && el.textContent === 'Use it'))
  check('an unknown kind is « info », and an action whose event is not an event name is dropped', api.push({ id: 'b', kind: 'weird', title: 't', action: { label: 'x', event: 'alert(1)' } }).kind === 'info' && api.list().find((x) => x.id === 'b').action === null)
  check('the same id replaces the earlier note (one run, one note)', (() => { api.push({ id: 'lang:es', title: 'Español failed', kind: 'error' }); return api.list().filter((x) => x.id === 'lang:es').length === 1 && api.list()[0].id === 'lang:es' && api.list()[0].title === 'Español failed' })())
  check('toast: false keeps it to the bell', (() => { const before = doc.made.length; api.push({ id: 'quiet', title: 'q', toast: false }); return doc.made.length === before })())
  check('the list is bounded', (() => { for (let i = 0; i < 50; i += 1) api.push({ id: 'n' + i, title: 't', toast: false }); return api.list().length === 30 })())
}

console.log('reading, acting, forgetting')
{
  const { api, win, storage } = make()
  api.push({ id: 'a', title: 'A', action: { label: 'Go', event: 'kb-go', detail: { x: 1 } }, toast: false })
  api.push({ id: 'b', title: 'B', toast: false })
  check('opening the bell marks everything read', (() => { api.markRead(); return api.unread() === 0 && api.list().every((x) => x.read === true) })())
  check('acting on a note fires its event with its detail, nothing else', (() => { const ok = api.run(api.list().find((x) => x.id === 'a')); return ok === true && win.events.length === 1 && win.events[0].type === 'kb-go' && win.events[0].detail.x === 1 })())
  check('a note without an action does nothing when run', api.run(api.list().find((x) => x.id === 'b')) === false)
  api.dismiss('a')
  check('dismissing removes one', api.list().map((x) => x.id).join() === 'b')
  check('it survives a reload (same storage, a new store)', (() => { const again = kbNotifyStart({ storage, window: mkWin(), document: null, now: () => 5 }); return again.list().map((x) => x.id).join() === 'b' })())
  api.clear()
  check('clear empties it, and the storage too', api.list().length === 0 && JSON.parse(storage.m.get('kybernos.notifs.v1')).length === 0)
}

console.log('what goes wrong')
{
  const seen = []
  const { api } = make()
  const off = api.subscribe((l) => seen.push(l.length))
  api.subscribe(() => { throw new Error('a bad listener') })
  api.push({ id: 'a', title: 'A', toast: false })
  check('listeners hear about changes, and one that throws does not stop the others', seen.join() === '1')
  off(); api.push({ id: 'b', title: 'B', toast: false })
  check('an unsubscribed listener hears nothing more', seen.join() === '1')
  const broken = kbNotifyStart({ storage: { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }, window: mkWin(), document: null, now: () => 1 })
  check('a storage that throws leaves a working store for this page', broken.push({ id: 'x', title: 'X' }) !== null && broken.list().length === 1)
  const damaged = kbNotifyStart({ storage: { getItem: () => '{ not json', setItem() {} }, window: mkWin(), document: null, now: () => 1 })
  check('a damaged storage reads as empty', damaged.list().length === 0)
  const noDoc = kbNotifyStart({ storage: mkStorage(), window: mkWin(), document: null, now: () => 1 })
  check('without a document the toast is skipped and the bell has the note', noDoc.push({ id: 'x', title: 'X' }) !== null && noDoc.list().length === 1)
}
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
