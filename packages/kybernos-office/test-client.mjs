// kybernos-office, browser half: its declaration to the core's registry (and the cleanup that takes it back), the window it draws (on a tiny fake DOM, read by
// its `data-kb` hooks), the conversation with the sandboxed editor frame (who is answered, what is forwarded), and the static promises a browser would only
// break late (the iframe never gets allow-same-origin, colours only from DSH tokens, French only in pairs). The real thing is checked on the GUI
// (scripts/check-kybernos-office-live.mjs).
//
//   node packages/kybernos-office/test-client.mjs
import { readFileSync } from 'node:fs'

let failed = 0
const ok = (label, fn) => { try { fn(); console.log('  ok   ' + label) } catch (e) { failed += 1; console.log('  FAIL ' + label + ' — ' + (e && e.message)) } }
const okAsync = async (label, fn) => { try { await fn(); console.log('  ok   ' + label) } catch (e) { failed += 1; console.log('  FAIL ' + label + ' — ' + (e && e.message)) } }
const must = (cond, msg) => { if (!cond) throw new Error(msg) }
const tick = () => new Promise((r) => setTimeout(r, 0))

// ── a tiny DOM: enough for the window to be built, read and clicked ─────────────────────────────────────────────
class Node {
  constructor (tag) { this.tag = tag; this.attrs = new Map(); this.kids = []; this.parent = null; this.handlers = {}; this.className = ''; this.own = '' }
  get hidden () { return this.attrs.has('hidden') }
  set hidden (v) { if (v) this.attrs.set('hidden', ''); else this.attrs.delete('hidden') }
  get disabled () { return this.attrs.has('disabled') }
  set disabled (v) { if (v) this.attrs.set('disabled', ''); else this.attrs.delete('disabled') }
  setAttribute (k, v) { this.attrs.set(k, String(v)) }
  getAttribute (k) { return this.attrs.has(k) ? this.attrs.get(k) : null }
  get textContent () { return this.own + this.kids.map((k) => k.textContent).join('') }
  set textContent (t) { this.kids.forEach((k) => { k.parent = null }); this.kids = []; this.own = String(t) }
  appendChild (n) { if (n.parent) n.remove(); n.parent = this; this.kids.push(n); return n }
  insertBefore (n, ref) { if (n.parent) n.remove(); n.parent = this; const i = this.kids.indexOf(ref); if (i < 0) this.kids.push(n); else this.kids.splice(i, 0, n); return n }
  replaceChildren (...ns) { this.kids.forEach((k) => { k.parent = null }); this.kids = []; this.own = ''; ns.forEach((n) => this.appendChild(n)) }
  remove () { if (this.parent) { this.parent.kids.splice(this.parent.kids.indexOf(this), 1); this.parent = null } }
  addEventListener (type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn) }
  focus () {}
  click () { if (!this.disabled) (this.handlers.click || []).forEach((f) => f({ target: this })) }
}
class Text extends Node { constructor (t) { super('#text'); this.own = String(t) } }
const body = new Node('body')
const head = new Node('head')
const find = (root, hook) => { const out = []; const go = (n) => { if (n.attrs && n.attrs.get('data-kb') === hook) out.push(n); n.kids.forEach(go) }; go(root); return out }
const one = (hook) => { const f = find(body, hook); must(f.length === 1, hook + ' x' + f.length); return f[0] }
const visible = (hook) => { const f = find(body, hook); if (f.length === 0) return false; let n = f[0]; while (n) { if (n.hidden) return false; n = n.parent }; return true }
globalThis.document = {
  createElement: (t) => { const n = new Node(t); if (t === 'iframe') n.contentWindow = { sent: [], postMessage (m, to) { this.sent.push({ m, to }) } }; return n },
  createTextNode: (t) => new Text(t), body, head,
}

// ── window, loader and registry ───────────────────────────────────────────────────────────────────────────────────
let definition = null
let resolved = 'en'
const registered = []
let taken = 0
const listeners = []
globalThis.window = {
  __ModuleLoader__: { load: (def) => { definition = def } },
  __KB_LANG_RESOLVE__: () => resolved,
  __KB_EDITORS__: { register: (e) => { registered.push(e); return () => { taken += 1 } } },
  addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
  removeEventListener: (type, fn) => { const i = listeners.findIndex((l) => l.fn === fn && l.type === type); if (i >= 0) listeners.splice(i, 1) },
}
await import(new URL('./client.js', import.meta.url).href)

const calls = []
let answers = {}
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init })
  const key = (init && init.method ? init.method : 'GET') + ' ' + String(url).split('?')[0]
  const a = answers[key] !== undefined ? answers[key] : { ok: false, error: 'network' }
  return { status: 200, json: async () => (typeof a === 'function' ? a(String(url), init) : a) }
}
const lastCall = (path) => [...calls].reverse().find((c) => c.url.split('?')[0].endsWith(path))

const plugin = definition.factory(() => { throw new Error('no require expected') })
const T = plugin.__test
const HASH = 'a'.repeat(64)
const HASH2 = 'b'.repeat(64)
const TOKEN = '0123456789abcdef0123456789abcdef'
const openAnswer = (over) => Object.assign({ ok: true, token: TOKEN, name: 'budget.xlsx', format: 'xlsx', editor: 'sheet', size: 100, hash: HASH, losses: [], block: false, installed: true, undo: false, url: `/kybernos-office/v/${TOKEN}/sheet/index.html` }, over)
const emit = (data, source) => listeners.filter((l) => l.type === 'message').forEach((l) => l.fn({ source, data: Object.assign({ ky: 'office' }, data) }))
const frameOf = () => one('office-frame')
const closeAll = () => { if (T.current() !== null) { T.current().close() } }

console.log('Kybernos office: the browser half')

// ── registration ───────────────────────────────────────────────────────────────────────────────────────────
await okAsync('the factory returns a plugin, and a broken environment gives a disabled one', async () => {
  must(plugin.name === 'kybernos-office' && typeof plugin.apply === 'function', 'not a plugin')
  const broken = definition.factory(() => { throw new Error('x') })
  must(typeof broken.apply === 'function', 'a factory that fails still returns a plugin')
})
await okAsync('apply declares one editor to the core\'s registry; the cleanup takes it back, closes a window that is open and removes the style', async () => {
  const effects = []
  plugin.apply({ effect: (fn, label) => effects.push({ label, off: fn() }) })
  must(registered.length === 1 && registered[0].id === 'office' && typeof registered[0].canEdit === 'function' && typeof registered[0].open === 'function', 'entry: ' + JSON.stringify(Object.keys(registered[0] || {})))
  answers = { 'POST /kybernos-office/open': openAnswer() }
  registered[0].open('/home/x/budget.xlsx', 'budget.xlsx')
  must(find(body, 'office-window').length === 1 && head.kids.length === 1, 'window and style are there')
  for (const e of effects) if (typeof e.off === 'function') e.off()
  must(taken === 1, 'the entry was not taken back')
  must(find(body, 'office-window').length === 0 && head.kids.length === 0 && listeners.length === 0, 'window, style and listeners must all be gone: ' + listeners.length)
  plugin.apply({ effect: () => {} }) // nothing thrown when the registry never comes
  window.__KB_EDITORS__ = undefined
  plugin.apply({ effect: (fn) => fn() })
  window.__KB_EDITORS__ = { register: (e) => { registered.push(e); return () => { taken += 1 } } }
})

ok('the editors take .docx and .xlsx, in any case, and not a lock file or another format', () => {
  must(T.canEdit('a.docx') && T.canEdit('B.XLSX') && T.canEdit('x.y.Docx'), 'good names')
  must(!T.canEdit('~$a.docx') && !T.canEdit('a.pptx') && !T.canEdit('a.doc') && !T.canEdit('a.xls') && !T.canEdit('docx') && !T.canEdit(null) && !T.canEdit(undefined), 'bad names')
})

// ── the sentences ──────────────────────────────────────────────────────────────────────────────────────────
ok('the notices say what is lost, what is kept as is and what is unverified, in the language', () => {
  const losses = [{ code: 'chart', level: 'loss', count: 2 }, { code: 'comment', level: 'review', count: 1 }, { code: 'image', level: 'untested', count: 3 }]
  resolved = 'en'
  let n = T.notices(losses)
  must(n.loss.includes('2 charts') && n.review.includes('1 comment') && n.untested.includes('3 pictures'), JSON.stringify(n))
  resolved = 'fr'
  n = T.notices(losses)
  must(n.loss.includes('2 graphiques') && n.untested.includes('3 images') && n.review.includes('1 commentaire'), JSON.stringify(n))
  resolved = 'en'
  must(T.notices([]).loss === '' && T.notices(null).review === '' && T.notices([{ nope: 1 }]).untested === '', 'nothing to say')
  must(T.thing({ code: 'something-new', count: 4 }) === '4 something-new', 'an unknown code still prints')
})
ok('every error code a person can reach has its own words, in both languages', () => {
  for (const code of ['network', 'sign-in required', 'origin refused', 'not-found', 'not-a-file', 'not-allowed', 'unsupported-format', 'too-big', 'not-a-zip', 'not-a-docx', 'not-a-xlsx', 'invalid-output', 'unknown-token', 'nothing-to-undo', 'not-installed']) {
    resolved = 'en'; const en = T.errorText({ error: code })
    resolved = 'fr'; const fr = T.errorText({ error: code })
    must(en !== fr && en.length > 8 && fr.length > 8, code)
  }
  resolved = 'en'
  must(T.errorText({ error: 'weird', why: 'the host says so' }) === 'the host says so' && T.errorText({}) === 'That did not work.', 'fallbacks')
})

// ── the window ─────────────────────────────────────────────────────────────────────────────────────────────
await okAsync('open: a bar with the name, the buttons off until something changed, and the editor frame sandboxed without allow-same-origin', async () => {
  answers = { 'POST /kybernos-office/open': openAnswer() }
  T.openFile('/home/x/budget.xlsx', 'budget.xlsx')
  await tick(); await tick()
  must(one('office-title').textContent === 'budget.xlsx', 'title')
  const f = frameOf()
  must(f.getAttribute('sandbox') === 'allow-scripts' && !/allow-same-origin/.test(f.getAttribute('sandbox')), 'sandbox: ' + f.getAttribute('sandbox'))
  must(f.getAttribute('src') === `/kybernos-office/v/${TOKEN}/sheet/index.html?lang=en`, 'src: ' + f.getAttribute('src'))
  must(f.getAttribute('referrerpolicy') === 'no-referrer', 'referrer')
  must(one('office-save').disabled && one('office-copy').disabled && one('office-undo').disabled, 'buttons start off')
  must(JSON.parse(lastCall('/open').init.body).path === '/home/x/budget.xlsx', 'the path asked')
  T.openFile('/other.xlsx', 'other.xlsx')
  must(find(body, 'office-window').length === 1, 'one window at a time')
})
await okAsync('the frame\'s messages: only its own window is heard; "dirty" turns Save on, "loaded" takes the hash it read', async () => {
  const f = frameOf()
  const stranger = { postMessage () {} }
  emit({ op: 'dirty', value: true }, stranger)
  must(one('office-save').disabled, 'a stranger changed nothing')
  emit({ op: 'loaded', hash: HASH2, readOnly: false }, f.contentWindow)
  emit({ op: 'dirty', value: true }, f.contentWindow)
  must(!one('office-save').disabled && !one('office-copy').disabled, 'save on after dirty')
  must(/Unsaved/.test(one('office-status').textContent), 'status: ' + one('office-status').textContent)
  window.postMessage = undefined
  listeners.filter((l) => l.type === 'message').forEach((l) => l.fn({ source: f.contentWindow, data: { op: 'dirty', value: false } }))
  must(!one('office-save').disabled, 'a message without the envelope is ignored')
  listeners.filter((l) => l.type === 'message').forEach((l) => l.fn({ source: f.contentWindow, data: 'text' }))
})
await okAsync('Save: the page asks the frame for the bytes, posts them with the token and the hash it read, then tells the frame it is saved', async () => {
  const f = frameOf()
  answers['POST /kybernos-office/save'] = { ok: true, hash: HASH, size: 3, undo: true }
  one('office-save').click()
  await tick()
  const ask = f.contentWindow.sent.find((s) => s.m.op === 'export')
  must(ask && ask.m.ky === 'office' && typeof ask.m.id === 'number' && ask.to === '*', 'export asked')
  emit({ op: 'exported', id: ask.m.id, bytes: new Uint8Array([1, 2, 3]).buffer }, f.contentWindow)
  await tick(); await tick()
  const post = lastCall('/save')
  must(post && post.init.method === 'POST' && post.url.includes('token=' + TOKEN) && post.url.includes('base=' + HASH2) && !post.url.includes('mode=copy'), 'save call: ' + (post && post.url))
  must(post.init.body.byteLength === 3, 'the bytes were sent')
  must(f.contentWindow.sent.some((s) => s.m.op === 'saved'), 'frame told')
  must(one('office-save').disabled && !one('office-undo').disabled && one('office-status').textContent === 'Saved', 'after the save: ' + one('office-status').textContent)
  emit({ op: 'dirty', value: false }, f.contentWindow)
  must(one('office-status').textContent === 'Saved', 'the frame saying « clean » right after a save does not replace « Saved »: ' + one('office-status').textContent)
})
await okAsync('Save as a copy sends mode=copy and keeps the changes unsaved', async () => {
  const f = frameOf()
  emit({ op: 'dirty', value: true }, f.contentWindow)
  answers['POST /kybernos-office/save'] = { ok: true, copy: true, name: 'budget (edited).xlsx', path: '/home/x/budget (edited).xlsx' }
  one('office-copy').click()
  await tick()
  const ask = [...f.contentWindow.sent].reverse().find((s) => s.m.op === 'export')
  emit({ op: 'exported', id: ask.m.id, bytes: new Uint8Array([9]).buffer }, f.contentWindow)
  await tick(); await tick()
  must(lastCall('/save').url.includes('mode=copy'), 'mode=copy')
  must(/budget \(edited\)\.xlsx/.test(one('office-status').textContent), 'status: ' + one('office-status').textContent)
  must(!one('office-save').disabled, 'the original is still unsaved')
})
await okAsync('a conflict (409) puts a card over the editor, which stays alive underneath; « Keep editing » takes the card away without reloading it', async () => {
  const f = frameOf()
  answers['POST /kybernos-office/save'] = { ok: false, error: 'changed-on-disk' }
  one('office-save').click()
  await tick()
  const ask = [...f.contentWindow.sent].reverse().find((s) => s.m.op === 'export')
  emit({ op: 'exported', id: ask.m.id, bytes: new Uint8Array([4]).buffer }, f.contentWindow)
  await tick(); await tick()
  must(visible('office-conflict'), 'conflict card shown')
  must(f.parent === one('office-layer').parent, 'the frame is still in the page, not moved')
  const buttons = find(one('office-conflict'), undefined)
  const row = one('office-conflict').kids.find((k) => k.className === 'kyo-row')
  must(row.kids.length === 3, 'three choices')
  row.kids[2].click()
  must(!visible('office-conflict') && !one('office-layer').getAttribute('data-kb').includes('x') && one('office-layer').hidden, 'card gone')
  void buttons
})
await okAsync('Reload after a conflict asks the frame to read the file again and drops the unsaved mark', async () => {
  const f = frameOf()
  answers['POST /kybernos-office/save'] = { ok: false, error: 'changed-on-disk' }
  one('office-save').click(); await tick()
  const ask = [...f.contentWindow.sent].reverse().find((s) => s.m.op === 'export')
  emit({ op: 'exported', id: ask.m.id, bytes: new Uint8Array([4]).buffer }, f.contentWindow)
  await tick(); await tick()
  one('office-conflict').kids.find((k) => k.className === 'kyo-row').kids[1].click()
  must(f.contentWindow.sent.some((s) => s.m.op === 'reload') && one('office-save').disabled, 'reloaded')
})
await okAsync('Undo asks the host, then the frame reloads; a refusal « changed since » asks before forcing', async () => {
  const f = frameOf()
  answers['POST /kybernos-office/undo'] = { ok: false, error: 'changed-since' }
  one('office-undo').click(); await tick(); await tick()
  must(visible('office-undo-confirm'), 'confirm card')
  must(JSON.parse(lastCall('/undo').init.body).force === false, 'not forced the first time')
  answers['POST /kybernos-office/undo'] = { ok: true, hash: HASH }
  one('office-undo-confirm').kids.find((k) => k.className === 'kyo-row').kids[0].click()
  await tick(); await tick()
  must(JSON.parse(lastCall('/undo').init.body).force === true, 'forced after the person agreed')
  must(f.contentWindow.sent.filter((s) => s.m.op === 'reload').length >= 2 && one('office-undo').disabled, 'frame told to reload; nothing left to undo')
})
await okAsync('Close with unsaved changes asks first; Esc is caught before the viewer under it sees it', async () => {
  const f = frameOf()
  emit({ op: 'dirty', value: true }, f.contentWindow)
  let stopped = 0
  const esc = listeners.find((l) => l.type === 'keydown')
  must(esc && esc.capture === true, 'Esc is listened to in the capture phase')
  esc.fn({ key: 'Escape', stopPropagation () { stopped += 1 }, stopImmediatePropagation () { stopped += 1 } })
  must(stopped === 2 && visible('office-discard'), 'Esc asks, and stops there')
  one('office-discard').kids.find((k) => k.className === 'kyo-row').kids[0].click()
  must(!one('office-discard').parent.hidden === false || find(body, 'office-window').length === 1, 'Keep editing leaves the window open')
  one('office-close').click()
  one('office-discard').kids.find((k) => k.className === 'kyo-row').kids[1].click()
  must(find(body, 'office-window').length === 0 && listeners.length === 0, 'closed, listeners gone')
})
await okAsync('a file with a certain loss asks before the editor opens: read-only mounts the frame with ro=1, Cancel closes', async () => {
  answers = { 'POST /kybernos-office/open': openAnswer({ block: true, losses: [{ code: 'chart', level: 'loss', count: 1 }] }) }
  T.openFile('/home/x/chart.xlsx', 'chart.xlsx'); await tick(); await tick()
  must(visible('office-gate') && find(body, 'office-frame').length === 0, 'the gate, and no editor yet')
  must(/1 chart/.test(one('office-gate').textContent), 'it says what is lost')
  const row = one('office-gate').kids.find((k) => k.className === 'kyo-row')
  row.kids[0].click()
  must(frameOf().getAttribute('src').endsWith('?lang=en&ro=1') && !visible('office-gate'), 'read-only src: ' + frameOf().getAttribute('src'))
  const f = frameOf()
  emit({ op: 'loaded', hash: HASH, readOnly: true }, f.contentWindow)
  emit({ op: 'dirty', value: true }, f.contentWindow)
  must(one('office-save').disabled && /Read only/.test(one('office-status').textContent), 'a read-only editor never offers Save')
  closeAll()
  T.openFile('/home/x/chart.xlsx', 'chart.xlsx'); await tick(); await tick()
  one('office-gate').kids.find((k) => k.className === 'kyo-row').kids[1].click()
  must(!frameOf().getAttribute('src').includes('ro=1') && /1 chart/.test(one('office-notice').textContent) && !one('office-notice').hidden, 'edit anyway keeps the warning on screen')
  closeAll()
  T.openFile('/home/x/chart.xlsx', 'chart.xlsx'); await tick(); await tick()
  one('office-gate').kids.find((k) => k.className === 'kyo-row').kids[2].click()
  must(find(body, 'office-window').length === 0, 'cancel closes')
})
await okAsync('notices for what is kept or unverified show above the editor with no question asked', async () => {
  answers = { 'POST /kybernos-office/open': openAnswer({ format: 'docx', editor: 'doc', url: `/kybernos-office/v/${TOKEN}/doc/index.html`, losses: [{ code: 'tracked-changes', level: 'review', count: 2 }, { code: 'image', level: 'untested', count: 1 }] }) }
  T.openFile('/home/x/r.docx', 'r.docx'); await tick(); await tick()
  must(frameOf().getAttribute('src').startsWith(`/kybernos-office/v/${TOKEN}/doc/index.html`), 'the frame opened straight away')
  must(!one('office-notice').hidden && /2 tracked changes/.test(one('office-notice').textContent) && /1 picture/.test(one('office-notice').textContent), one('office-notice').textContent)
  closeAll()
})
await okAsync('editors not installed, a refusal from the host, and an address that is not ours each end in a card, never a blank frame', async () => {
  answers = { 'POST /kybernos-office/open': openAnswer({ installed: false }) }
  T.openFile('/home/x/a.xlsx', 'a.xlsx'); await tick(); await tick()
  must(visible('office-not-installed') && find(body, 'office-frame').length === 0 && /build-editors/.test(one('office-not-installed').textContent), 'not installed')
  closeAll()
  answers = { 'POST /kybernos-office/open': { ok: false, error: 'not-found' } }
  T.openFile('/home/x/a.xlsx', 'a.xlsx'); await tick(); await tick()
  must(visible('office-error') && /cannot be found/.test(one('office-error').textContent), 'refused')
  closeAll()
  answers = { 'POST /kybernos-office/open': openAnswer({ url: 'https://evil.example/x' }) }
  T.openFile('/home/x/a.xlsx', 'a.xlsx'); await tick(); await tick()
  must(find(body, 'office-frame').length === 0 && visible('office-not-installed'), 'a frame address outside our own route is never used')
  closeAll()
  T.openFile('/home/x/a.pptx', 'a.pptx')
  must(find(body, 'office-window').length === 0, 'a format that has no editor opens nothing')
})
await okAsync('the window speaks French when the language is French', async () => {
  resolved = 'fr'
  answers = { 'POST /kybernos-office/open': openAnswer() }
  T.openFile('/home/x/a.xlsx', 'a.xlsx'); await tick(); await tick()
  must(one('office-save').textContent === 'Enregistrer' && one('office-close').textContent === 'Fermer' && frameOf().getAttribute('src').endsWith('?lang=fr'), 'french')
  closeAll()
  resolved = 'en'
})

await okAsync('the « ? » of the bar draws the Suite\'s help card for this module, only when the host has the help, and a failed fetch draws nothing', async () => {
  answers = { 'POST /kybernos-office/open': openAnswer() }
  T.openFile('/home/x/a.xlsx', 'a.xlsx'); await tick(); await tick()
  must(find(body, 'office-help').length === 0, 'no button when the host has no help')
  closeAll()
  window.__KB_HELP__ = {}
  answers = { 'POST /kybernos-office/open': openAnswer() }
  T.openFile('/home/x/a.xlsx', 'a.xlsx'); await tick(); await tick()
  one('office-help').click(); await tick(); await tick()
  must(one('office-help-card').hidden, 'no help for this module in the answer: the card stays closed')
  closeAll()
  const pair = (en) => ({ fr: 'fr ' + en, en })
  answers = { 'POST /kybernos-office/open': openAnswer(), 'GET /kybernos-hub/suite': { modules: [{ id: 'kybernos-other', aide: { what: pair('wrong one') } }, { id: 'kybernos-office', titre: 'Office', aide: { what: pair('Edit a Word or Excel file.'), steps: [pair('Open it in Creations.'), pair('Press the pencil.')], where: pair('Creations'), good: pair('Nothing is overwritten.') } }] } }
  T.openFile('/home/x/a.xlsx', 'a.xlsx'); await tick(); await tick()
  must(one('office-help-card').hidden && one('office-help').getAttribute('aria-expanded') === 'false', 'closed at first')
  one('office-help').click(); await tick(); await tick()
  const text = one('office-help-card').textContent
  must(!one('office-help-card').hidden && /Edit a Word or Excel file\./.test(text) && /Press the pencil\./.test(text) && /Where to find it: Creations/.test(text) && /Nothing is overwritten\./.test(text) && !/wrong one/.test(text), text)
  must(one('office-help').getAttribute('aria-expanded') === 'true', 'the button says it is open')
  one('office-help').click()
  must(one('office-help-card').hidden, 'a second click closes it')
  closeAll()
  delete window.__KB_HELP__
})

// ── the promises a browser would break late ─────────────────────────────────────────────────────────────────
ok('static: no allow-same-origin anywhere, colours only from DSH tokens with a fallback, the host asked is our own', () => {
  const src = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
  must(!/allow-same-origin/.test(src.replace(/\/\/.*$/gm, '').replace(/'[^']*allow-same-origin[^']*'/g, '')), 'allow-same-origin must not be granted')
  const css = T.CSS
  const bare = css.replace(/var\(--[a-z0-9-]+,\s*[^)]*\)/g, '').match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || []
  must(bare.filter((c) => c !== '#fff').length === 0, 'hard-coded colours outside a var(): ' + bare.join(','))
  must(!/https?:\/\//.test(src), 'no absolute address in the client')
  must(T.BASE === '/kybernos-office' && T.REGISTRY === '__KB_EDITORS__', 'route and registry names')
})

console.log(failed === 0 ? '\nOFFICE CLIENT — all ok' : '\nOFFICE CLIENT — ' + failed + ' failure(s)')
process.exit(failed === 0 ? 0 : 1)
