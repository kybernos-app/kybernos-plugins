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
  must(registered.length === 1 && registered[0].id === 'office' && typeof registered[0].canEdit === 'function' && typeof registered[0].open === 'function' && typeof registered[0].embeds === 'function' && registered[0].embeds('a.md') === false && registered[0].embeds('a.pdf') === true, 'entry: ' + JSON.stringify(Object.keys(registered[0] || {})))
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
  for (const code of ['network', 'sign-in required', 'origin refused', 'not-found', 'not-a-file', 'not-allowed', 'unsupported-format', 'too-big', 'not-a-zip', 'not-a-docx', 'not-a-xlsx', 'not-a-pdf', 'not-text', 'invalid-output', 'unknown-token', 'nothing-to-undo', 'not-installed']) {
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
// ── Markdown and PDF ─────────────────────────────────────────────────────────────────
ok('the editors also take .pdf and Markdown; the viewer of Creations draws all of them but Markdown, which keeps its own preview', () => {
  must(T.canEdit('a.pdf') && T.canEdit('B.PDF') && T.canEdit('notes.md') && T.canEdit('README.markdown') && T.canEdit('x.MD'), 'good names')
  must(!T.canEdit('a.mdx') && !T.canEdit('a.pdfx') && !T.canEdit('md') && !T.canEdit('a.txt') && !T.canEdit('~$a.pdf'), 'bad names')
  must(T.viewerDraws('a.pdf') === true && T.viewerDraws('a.docx') === true && T.viewerDraws('notes.md') === false && T.viewerDraws('R.MARKDOWN') === false && T.viewerDraws('a.txt') === false, 'the viewer keeps its own Markdown preview')
})
ok('Markdown and PDF losses are named in both languages, and the Editor view of Markdown says what it does to the file', () => {
  const md = [{ code: 'html', level: 'loss', count: 2 }, { code: 'footnote', level: 'loss', count: 1 }, { code: 'wiki-link', level: 'untested', count: 3 }]
  resolved = 'en'
  let n = T.notices(md, 'md')
  must(n.loss.includes('2 HTML tags') && n.loss.includes('1 footnote') && /Text.* view rewrites nothing/.test(n.loss) && n.untested.includes('3 [[wiki]] links') && /rewrites the whole file/.test(n.rewrite), JSON.stringify(n))
  resolved = 'fr'
  n = T.notices(md, 'md')
  must(n.loss.includes('2 balises HTML') && n.loss.includes('1 note de bas de page') && n.untested.includes('3 liens [[wiki]]') && /réécrit tout le fichier/.test(n.rewrite), JSON.stringify(n))
  resolved = 'en'
  must(T.notices(md, 'doc').rewrite === '' && T.notices(md).rewrite === '', 'the other editors say nothing about a rewrite')
  const pdf = T.notices([{ code: 'encrypted', level: 'loss', count: 1 }, { code: 'signature', level: 'loss', count: 2 }, { code: 'form', level: 'untested', count: 1 }, { code: 'attachment', level: 'untested', count: 2 }], 'pdf')
  must(pdf.loss.includes('1 password protection') && pdf.loss.includes('2 digital signatures') && pdf.untested.includes('1 form') && pdf.untested.includes('2 attachments'), JSON.stringify(pdf))
})
await okAsync('a Markdown file with nothing to lose opens in the Editor view and says that the editor rewrites the file; a PDF opens straight away', async () => {
  answers = { 'POST /kybernos-office/open': openAnswer({ format: 'md', editor: 'md', url: `/kybernos-office/v/${TOKEN}/md/index.html` }) }
  T.openFile('/home/x/notes.md', 'notes.md'); await tick(); await tick()
  must(frameOf().getAttribute('src') === `/kybernos-office/v/${TOKEN}/md/index.html?lang=en`, 'src: ' + frameOf().getAttribute('src'))
  must(!one('office-notice').hidden && /rewrites the whole file/.test(one('office-notice').textContent), 'the notice: ' + one('office-notice').textContent)
  closeAll()
  answers = { 'POST /kybernos-office/open': openAnswer({ format: 'pdf', editor: 'pdf', url: `/kybernos-office/v/${TOKEN}/pdf/index.html`, losses: [{ code: 'form', level: 'untested', count: 1 }] }) }
  T.openFile('/home/x/a.pdf', 'a.pdf'); await tick(); await tick()
  must(frameOf().getAttribute('src') === `/kybernos-office/v/${TOKEN}/pdf/index.html?lang=en` && !/rewrites/.test(one('office-notice').textContent) && /1 form/.test(one('office-notice').textContent), 'a PDF: ' + one('office-notice').textContent)
  closeAll()
})
await okAsync('a Markdown file the Editor view would rewrite offers its text first: read-only and « Edit the text » mount the text view, « Edit in the editor anyway » the Editor view with the warning', async () => {
  const blocked = () => openAnswer({ format: 'md', editor: 'md', url: `/kybernos-office/v/${TOKEN}/md/index.html`, block: true, losses: [{ code: 'html', level: 'loss', count: 1 }] })
  const row = () => one('office-gate').kids.find((k) => k.className === 'kyo-row')
  answers = { 'POST /kybernos-office/open': blocked() }
  T.openFile('/home/x/page.md', 'page.md'); await tick(); await tick()
  must(visible('office-gate') && find(body, 'office-frame').length === 0 && /1 HTML tag/.test(one('office-gate').textContent), 'the gate speaks first')
  must(row().kids.length === 4 && /Edit the text/.test(row().kids[1].textContent), 'four choices: ' + row().kids.map((k) => k.textContent).join(' | '))
  row().kids[0].click()
  must(frameOf().getAttribute('src').endsWith('?lang=en&ro=1&mode=text'), 'read-only shows the text, so nothing looks missing: ' + frameOf().getAttribute('src'))
  closeAll()
  answers = { 'POST /kybernos-office/open': blocked() }
  T.openFile('/home/x/page.md', 'page.md'); await tick(); await tick()
  row().kids[1].click()
  must(frameOf().getAttribute('src').endsWith('?lang=en&mode=text') && one('office-notice').hidden, 'editing the text: the text view, no warning needed: ' + frameOf().getAttribute('src'))
  closeAll()
  answers = { 'POST /kybernos-office/open': blocked() }
  T.openFile('/home/x/page.md', 'page.md'); await tick(); await tick()
  row().kids[2].click()
  must(frameOf().getAttribute('src').endsWith('?lang=en') && /1 HTML tag/.test(one('office-notice').textContent) && !one('office-notice').hidden, 'the Editor view anyway keeps the warning on screen: ' + frameOf().getAttribute('src'))
  closeAll()
  answers = { 'POST /kybernos-office/open': blocked() }
  T.openFile('/home/x/page.md', 'page.md'); await tick(); await tick()
  row().kids[3].click()
  must(find(body, 'office-window').length === 0, 'cancel closes')
  // an .xlsx keeps its three choices
  answers = { 'POST /kybernos-office/open': openAnswer({ block: true, losses: [{ code: 'chart', level: 'loss', count: 1 }] }) }
  T.openFile('/home/x/chart.xlsx', 'chart.xlsx'); await tick(); await tick()
  must(row().kids.length === 3, 'the other formats still have three choices')
  closeAll()
})
await okAsync('embedded Markdown with a loss: shown as text, « Edit » asks, and « Edit the text » swaps in the text view without ro', async () => {
  const box = new Node('div')
  body.appendChild(box)
  answers = { 'POST /kybernos-office/open': openAnswer({ format: 'md', editor: 'md', url: `/kybernos-office/v/${TOKEN}/md/index.html`, block: true, losses: [{ code: 'math', level: 'loss', count: 1 }] }) }
  const h = T.embedFile(box, '/home/x/m.md', 'm.md'); await tick(); await tick()
  must(frameOf().getAttribute('src').endsWith('?lang=en&ro=1&mode=text'), 'read-only text first: ' + frameOf().getAttribute('src'))
  emit({ op: 'loaded', hash: HASH, readOnly: true }, frameOf().contentWindow)
  one('office-edit').click()
  const gate = one('office-gate')
  must(/1 formula/.test(gate.textContent) && gate.kids.find((k) => k.className === 'kyo-row').kids.length === 3, 'the gate: ' + gate.textContent)
  gate.kids.find((k) => k.className === 'kyo-row').kids[0].click()
  must(frameOf().getAttribute('src').endsWith('?lang=en&mode=text'), 'the text view, editable: ' + frameOf().getAttribute('src'))
  h.close()
  box.remove()
  answers = { 'POST /kybernos-office/open': openAnswer({ format: 'md', editor: 'md', url: `/kybernos-office/v/${TOKEN}/md/index.html` }) }
  const box2 = new Node('div')
  body.appendChild(box2)
  const h2 = T.embedFile(box2, '/home/x/m.md', 'm.md'); await tick(); await tick()
  must(frameOf().getAttribute('src').endsWith('?lang=en&ro=1'), 'a clean Markdown file is read as the Editor view: ' + frameOf().getAttribute('src'))
  emit({ op: 'loaded', hash: HASH, readOnly: true }, frameOf().contentWindow)
  one('office-edit').click()
  must(!frameOf().getAttribute('src').includes('ro=1') && !frameOf().getAttribute('src').includes('mode=text') && /rewrites the whole file/.test(one('office-notice').textContent), 'Edit: the Editor view, with the notice')
  h2.close()
  box2.remove()
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

await okAsync('embedded in the viewer: it opens read-only with nothing to decide, « Edit » turns the same box into the editor, and the box says if it holds unsaved changes', async () => {
  const box = new Node('div')
  body.appendChild(box)
  answers = { 'POST /kybernos-office/open': openAnswer() }
  const h = T.embedFile(box, '/home/x/budget.xlsx', 'budget.xlsx'); await tick(); await tick()
  must(h !== null && typeof h.close === 'function' && h.dirty() === false, 'a handle with close and dirty')
  must(find(box, 'office-embed').length === 1 && find(body, 'office-window').length === 0, 'drawn inside the box, not as the full-screen window')
  must(find(box, 'office-close').length === 0 && find(box, 'office-title').length === 0, 'no close button and no name: the viewer has both')
  must(T.current() === null, 'it is not the full-screen window')
  must(frameOf().getAttribute('src').endsWith('?lang=en&ro=1') && find(body, 'office-gate').length === 0, 'read-only straight away: ' + frameOf().getAttribute('src'))
  const ro = frameOf()
  emit({ op: 'loaded', hash: HASH, readOnly: true }, ro.contentWindow)
  must(/Read only/.test(one('office-status').textContent) && !one('office-edit').hidden && !one('office-edit').disabled && one('office-save').disabled, 'Edit is offered, Save is not')
  one('office-edit').click()
  const ed = frameOf()
  must(ed !== ro && !ed.getAttribute('src').includes('ro=1') && ro.parent === null, 'the read-only frame is replaced by the editor')
  emit({ op: 'loaded', hash: HASH }, ed.contentWindow)
  must(one('office-edit').hidden && h.dirty() === false, 'Edit goes away once editing')
  emit({ op: 'dirty', value: true }, ed.contentWindow)
  must(h.dirty() === true && !one('office-save').disabled, 'a change is told to the viewer, and Save wakes up')
  h.close()
  must(find(body, 'office-embed').length === 0 && listeners.length === 0, 'closed by the viewer: the box is empty and the listeners are gone')
  box.remove()
  // a file with a certain loss: looking is free, editing asks first
  answers = { 'POST /kybernos-office/open': openAnswer({ block: true, losses: [{ code: 'chart', level: 'loss', count: 1 }] }) }
  const box2 = new Node('div')
  body.appendChild(box2)
  const h2 = T.embedFile(box2, '/home/x/chart.xlsx', 'chart.xlsx'); await tick(); await tick()
  must(find(body, 'office-gate').length === 0 && frameOf().getAttribute('src').includes('ro=1'), 'a file with a loss still opens to look at, with no question')
  one('office-edit').click()
  must(visible('office-gate') && /1 chart/.test(one('office-gate').textContent), 'Edit asks, and says what is lost')
  const row = one('office-gate').kids.find((k) => k.className === 'kyo-row')
  row.kids[1].click()
  must(!visible('office-gate') && frameOf().getAttribute('src').includes('ro=1'), 'Cancel keeps looking')
  one('office-edit').click()
  one('office-gate').kids.find((k) => k.className === 'kyo-row').kids[0].click()
  must(!frameOf().getAttribute('src').includes('ro=1') && /1 chart/.test(one('office-notice').textContent), 'Edit anyway opens the editor and keeps the warning on screen')
  // two embeds and the full-screen window do not get in each other's way; unloading the plugin closes them all
  answers = { 'POST /kybernos-office/open': openAnswer() }
  T.openFile('/home/x/other.xlsx', 'other.xlsx'); await tick(); await tick()
  must(T.current() !== null && find(body, 'office-embed').length === 1, 'the window opens beside an embed')
  closeAll()
  must(find(body, 'office-embed').length === 1, 'closing the window leaves the embed')
  h2.close(); box2.remove()
  // errors: no close button in a box the viewer holds
  answers = { 'POST /kybernos-office/open': { ok: false, error: 'not-found' } }
  const box3 = new Node('div')
  body.appendChild(box3)
  T.embedFile(box3, '/home/x/gone.xlsx', 'gone.xlsx'); await tick(); await tick()
  must(visible('office-error') && find(box3, 'kyo-btn').filter((b) => b.getAttribute('data-kb') === 'office-close').length === 0 && one('office-error').kids.find((k) => k.className === 'kyo-row').kids.length === 0, 'an error card has no close button in a box')
  find(body, 'office-embed').forEach((n) => n.remove()); box3.remove()
  must(T.embedFile(new Node('div'), '/home/x/a.txt', 'a.txt') === null, 'a name no editor takes opens nothing')
})

await okAsync('the right-hand tab: a tab type for the installed suffixes only, kept mounted, taken back with the plugin; its body opens the file the tab reports, read-only', async () => {
  // a minimal React: elements as plain objects, refs and effects kept by call order, run by hand
  let hookAt = 0
  let hooks = []
  const fakeReact = {
    createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }),
    useRef: (v) => { const i = hookAt++; if (hooks[i] === undefined) hooks[i] = { ref: { current: v } }; return hooks[i].ref },
    useEffect: (fn, deps) => { const i = hookAt++; const prev = hooks[i]; const changed = prev === undefined || deps === undefined || deps.length !== prev.deps.length || deps.some((d, k) => d !== prev.deps[k]); hooks[i] = { deps, cleanup: prev ? prev.cleanup : undefined, run: changed ? fn : null, prev } },
  }
  const p2 = definition.factory(() => fakeReact)
  const T2 = p2.__test
  const registered = []
  const bodies = []
  const offs = []
  const tabs = { register: (d) => { registered.push(d); return () => { registered.splice(registered.indexOf(d), 1) } } }
  const slots = { inject: (name, fn) => fn(), register: (def, comp) => { bodies.push({ def, comp }); return () => { bodies.length = 0 } } }
  const scope = { slots, sidebarRightTabs: tabs, effect: (fn) => { offs.push(fn()) } }
  const ctxFor = (extra) => ({ inject: (names, cb) => { ctxFor.names = names; cb(Object.assign({}, scope, extra)) } })

  // 1. only the suffixes whose editor is installed
  answers = { 'GET /kybernos-office/status': { ok: true, installed: { doc: true, sheet: false } } }
  T2.startPane(ctxFor({}))
  await tick(); await tick()
  must(ctxFor.names.join() === 'slots,sidebarRightTabs', 'it asks for the two services and nothing else')
  const def = registered[0]
  must(registered.length === 1 && def.id === T2.PANE_ID && def.kind === T2.PANE_KIND && def.patterns.join() === '*.docx' && def.priority === 'extension', JSON.stringify(registered))
  must(def.keepMounted === true, 'DSH keeps the body mounted through a change of tab: what was typed must survive it')
  must(bodies.length === 1 && bodies[0].def.name === 'sidebar.right.pane.tab' && bodies[0].def.key === T2.PANE_ID, 'the body is keyed by the type id')
  must(def.canOpen('dsh-resource://file/session/s1/a%20b.docx') === true && def.canOpen('dsh-resource://file/absolute/home/a.docx') === false && def.canOpen(7) === false, 'only files of the session\'s workspace')
  must(def.title('dsh-resource://file/session/s1/docs/a%20b.docx') === 'a b.docx' && def.title('dsh-resource://file/session/s1/100%.docx') === '100%.docx', 'the chip says the file name, decoded when it can be')
  offs.splice(0).forEach((f) => { if (typeof f === 'function') f() })
  must(registered.length === 0, 'taken back with the plugin')
  answers = { 'GET /kybernos-office/status': { ok: true, installed: { doc: true, sheet: true } } }
  T2.startPane(ctxFor({})); await tick(); await tick()
  must(registered.length === 1 && registered[0].patterns.join() === '*.docx,*.xlsx', 'both editors installed: both suffixes')
  offs.splice(0).forEach((f) => { if (typeof f === 'function') f() })
  answers = { 'GET /kybernos-office/status': { ok: true, installed: { doc: true, sheet: true, md: true, pdf: true } } }
  T2.startPane(ctxFor({})); await tick(); await tick()
  must(registered.length === 1 && registered[0].patterns.join() === '*.docx,*.xlsx,*.md,*.markdown,*.pdf', 'Markdown and PDF editors installed: their suffixes too: ' + registered[0].patterns.join())
  offs.splice(0).forEach((f) => { if (typeof f === 'function') f() })
  answers = { 'GET /kybernos-office/status': { ok: true, installed: { doc: false, sheet: false, md: false, pdf: true } } }
  T2.startPane(ctxFor({})); await tick(); await tick()
  must(registered.length === 1 && registered[0].patterns.join() === '*.pdf', 'only the PDF editor installed: only .pdf')
  offs.splice(0).forEach((f) => { if (typeof f === 'function') f() })
  answers = { 'GET /kybernos-office/status': { ok: true, installed: { doc: false, sheet: false } } }
  T2.startPane(ctxFor({})); await tick(); await tick()
  must(registered.length === 0, 'no editor installed: DSH keeps its own previews')
  answers = { 'GET /kybernos-office/status': { ok: false, error: 'network' } }
  T2.startPane(ctxFor({})); await tick(); await tick()
  must(registered.length === 0, 'no answer from the host: nothing declared')
  offs.splice(0).forEach((f) => { if (typeof f === 'function') f() })
  let called = 0
  T2.startPane({ inject: () => { called += 1 } }); T2.startPane({})
  must(called === 1, 'an engine without the services is never asked for more; a context without inject is left alone')

  // 2. the body
  const info = (revision) => () => ({ tab: { contentId: 'dsh-resource://file/session/s1/budget.xlsx', navigation: { revision } } })
  const resource = (version) => () => ({ status: 'ready', value: { absolutePath: '/home/x/budget.xlsx', version } })
  const Body = T2.makePaneBody(fakeReact)
  const box = new Node('div')
  body.appendChild(box)
  const render = (props) => { hookAt = 0; const tree = Body(props); const withRef = (n) => (n && n.props && n.props.ref ? n : (n && n.kids ? n.kids.map(withRef).find(Boolean) : null)); const r = withRef(tree); if (r) r.props.ref.current = box; return tree }
  const flush = () => { for (const hk of hooks) if (hk && hk.run) { if (typeof hk.cleanup === 'function') hk.cleanup(); const out = hk.run(); hk.cleanup = out; hk.run = null } }
  const opened = (from) => calls.slice(from).filter((c) => c.url.endsWith('/kybernos-office/open')).length
  answers = { 'POST /kybernos-office/open': openAnswer() }
  const before = calls.length
  let tree = render({ useTabInfo: info(1), useResource: resource('v1') })
  must(tree.props['data-kb'] === 'office-pane', 'the body draws its own pane')
  flush(); await tick(); await tick()
  const opens = calls.slice(before).filter((c) => c.url.endsWith('/kybernos-office/open'))
  must(opens.length === 1 && JSON.parse(opens[0].init.body).path === '/home/x/budget.xlsx', 'it opens the ABSOLUTE path the tab\'s resource reports: ' + JSON.stringify(opens.map((c) => c.init.body)))
  must(find(box, 'office-embed').length === 1 && frameOf().getAttribute('src').includes('ro=1'), 'read-only in the pane\'s box')
  emit({ op: 'loaded', hash: HASH, readOnly: true }, frameOf().contentWindow)
  // drawn again with nothing new: the editor is left alone
  const first = frameOf()
  render({ useTabInfo: info(1), useResource: resource('v1') }); flush(); await tick(); await tick()
  must(opened(before) === 1 && frameOf() === first, 'a redraw with the same file does not open it again')
  // opened again from the file list (revision + 1), nothing typed: the file is shown again, in the same box
  render({ useTabInfo: info(2), useResource: resource('v1') }); flush(); await tick(); await tick()
  must(opened(before) === 2 && find(box, 'office-embed').length === 1, 'opened again from the list: the file is shown again, in the same box')
  // the file changed on disk while shown read-only: shown again
  render({ useTabInfo: info(2), useResource: resource('v2') }); flush(); await tick(); await tick()
  must(opened(before) === 3 && find(box, 'office-embed').length === 1, 'a file changed on disk is shown again while it is only being looked at')
  // Edit, then the file changes on disk (another version, another visit): the editor is left alone, typed or not
  emit({ op: 'loaded', hash: HASH, readOnly: true }, frameOf().contentWindow)
  one('office-edit').click()
  emit({ op: 'loaded', hash: HASH }, frameOf().contentWindow)
  const editing = frameOf()
  render({ useTabInfo: info(3), useResource: resource('v3') }); flush(); await tick(); await tick()
  must(frameOf() === editing && opened(before) === 3, 'while editing, a change on disk or a second visit never reloads (the save says if the file moved)')
  emit({ op: 'dirty', value: true }, frameOf().contentWindow)
  render({ useTabInfo: info(4), useResource: resource('v4') }); flush(); await tick(); await tick()
  must(frameOf() === editing && opened(before) === 3, 'unsaved changes are never thrown away')
  // the path is not known yet: a wait line, nothing opened
  hooks = []; hookAt = 0
  const n0 = calls.length
  tree = render({ useTabInfo: info(1), useResource: () => ({ status: 'none', value: null }) }); flush(); await tick()
  must(tree.kids.some((k) => k && k.props && /kyo-pane-wait/.test(k.props.class || k.props.className || '')) && calls.length === n0, 'no path yet: it waits and asks nothing')
  tree = render({}); flush()
  must(tree.props['data-kb'] === 'office-pane' && calls.length === n0, 'no tab information at all: still a pane, nothing asked')
  closeAll()
  find(body, 'office-embed').forEach((n) => n.remove()); box.remove()
  for (const hk of hooks) if (hk && typeof hk.cleanup === 'function') hk.cleanup()
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
