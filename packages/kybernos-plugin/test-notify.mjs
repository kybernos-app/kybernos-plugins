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
const mkWin = () => {
  const events = []
  const listeners = {}
  return {
    events, listeners,
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn) },
    dispatchEvent: (e) => { events.push(e); return true },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail } },
  }
}
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
  const n = api.push({ id: 'team:es', kind: 'success', title: 'Español is ready', body: 'Switch to it any time.', action: { label: 'Use it', event: 'kb-lang-use', detail: { lang: 'es' } } })
  check('a note is kept with its time, kind and action', n.kind === 'success' && n.read === false && n.action.event === 'kb-lang-use' && api.list().length === 1 && api.unread() === 1)
  check('it is announced with a toast that carries the action', doc.made.some((el) => el.attrs['data-kb'] === 'notify-toast' && el.attached === true) && doc.made.some((el) => el.className === 'kbn-toast-act' && el.textContent === 'Use it'))
  check('an unknown kind is « info », and an action whose event is not an event name is dropped', api.push({ id: 'b', kind: 'weird', title: 't', action: { label: 'x', event: 'alert(1)' } }).kind === 'info' && api.list().find((x) => x.id === 'b').action === null)
  check('the same id replaces the earlier note (one run, one note)', (() => { api.push({ id: 'team:es', title: 'Español failed', kind: 'error' }); return api.list().filter((x) => x.id === 'team:es').length === 1 && api.list()[0].id === 'team:es' && api.list()[0].title === 'Español failed' })())
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
console.log('the × of the toast, and the bell')
{
  const { api, doc, storage } = make()
  api.push({ id: 'plain', title: 'An automation ran', toast: true })
  const x = doc.made.filter((el) => el.className === 'kbn-toast-x').pop()
  check('the toast carries a ×', x !== undefined)
  if (x !== undefined) x.listeners.click()
  check('the × of the toast takes the note out of the bell too (it used to hide the toast only)', api.list().length === 0 && JSON.parse(storage.m.get('kybernos.notifs.v1')).length === 0)
}

console.log('a muted source (a translation run, the person’s decision of 2026-11-01)')
{
  const { api, doc } = make()
  const before = doc.made.length
  check('a note of a muted source is refused: no bell entry, no toast', api.push({ id: 'lang:zh', title: '中文: 150 texts stay in English.' }) === null && api.list().length === 0 && doc.made.length === before)
  check('the notes of the other sources still go through', api.push({ id: 'auto:1', title: 'An automation ran' }) !== null && api.list().length === 1)
  const raw = JSON.stringify([{ id: 'lang:zh', title: 'old', at: 1, kind: 'warn', read: false, action: null }, { id: 'auto:2', title: 'keep', at: 2, kind: 'info', read: false, action: null }])
  const m = new Map([['kybernos.notifs.v1', raw]])
  const again = kbNotifyStart({ storage: { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) } }, window: mkWin(), document: null, now: () => 1 })
  check('a muted note an older version stored is dropped when the page loads', again.list().map((x) => x.id).join() === 'auto:2')
  check('…and it leaves the storage, so it does not come back on the next load', JSON.parse(m.get('kybernos.notifs.v1')).map((x) => x.id).join() === 'auto:2')

  // The switch of Settings › Language writes the same key: '1' means « announce the end of a run » again.
  const on = make()
  on.storage.setItem('kybernos.notifs.announce', '1')
  const onApi = kbNotifyStart({ storage: on.storage, window: mkWin(), document: null, now: () => 1 })
  check('the switch turns the notes of a run back on', onApi.push({ id: 'lang:zh', title: '中文: 150 texts stay in English.' }) !== null && onApi.list().map((x) => x.id).join() === 'lang:zh')
  const m2 = new Map([['kybernos.notifs.announce', '1'], ['kybernos.notifs.v1', raw]])
  const kept = kbNotifyStart({ storage: { getItem: (k) => (m2.has(k) ? m2.get(k) : null), setItem: (k, v) => { m2.set(k, String(v)) } }, window: mkWin(), document: null, now: () => 1 })
  check('…and it keeps a note a run stored, instead of purging it', kept.list().map((x) => x.id).join() === 'lang:zh,auto:2')
  const back = make()
  back.api.push({ id: 'auto:x', title: 'x', toast: false })
  back.storage.setItem('kybernos.notifs.announce', '1')
  back.api.push({ id: 'lang:zh', title: 'a run said so', toast: false })
  back.storage.removeItem ? back.storage.removeItem('kybernos.notifs.announce') : back.storage.m.delete('kybernos.notifs.announce')
  back.api.purgeQuiet()
  check('switching quiet again takes the run’s notes out of the bell, and only those', back.api.list().map((x) => x.id).join() === 'auto:x')
}

console.log('two tabs share the bell')
{
  const { api, win, storage } = make()
  api.push({ id: 'a', title: 'A', toast: false })
  check('the page listens to the shared key', (win.listeners.storage || []).length === 1)
  const signal = (key) => (win.listeners.storage || []).forEach((fn) => fn({ key, storageArea: storage }))
  signal('another.key')
  check('an event for another key changes nothing', api.list().map((x) => x.id).join() === 'a')
  storage.setItem('kybernos.notifs.v1', '[]') // the other tab pressed ×
  signal('kybernos.notifs.v1')
  check('a note dismissed in another tab leaves this one too', api.list().length === 0)
  api.push({ id: 'c', title: 'C', toast: false })
  check('…and the tab that stays does not write the dismissed note back', JSON.parse(storage.m.get('kybernos.notifs.v1')).map((x) => x.id).join() === 'c')
}

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
