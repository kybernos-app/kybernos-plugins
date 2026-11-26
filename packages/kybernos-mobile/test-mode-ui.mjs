// kybernos-mobile, the display mode's browser half: the seam (`window.__KB_MODE__`), the segment of the drawer's foot and the sheet « Display », on a minimal fake DOM.
//   node packages/kybernos-mobile/test-mode-ui.mjs
// What the page does in a real browser (the reload, the sheet on a phone, the resolver on the real user agents) is looked at by scripts/check-mode-switch-live.mjs; this file is the logic.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}
const SOURCE = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), 'client.js'), 'utf8')

// ── a fake DOM with what the sheet uses: a tree, attributes, classes, a few selectors, focus ──
const matches = (e, sel) => sel.split(',').some((one) => {
  const tag = one.trim().match(/^[a-z][a-z0-9]*/)
  if (tag !== null && tag[0] !== e.tag) return false
  const parts = one.trim().match(/(\.[\w-]+|\[[^\]]+\])/g) || []
  return (parts.length > 0 || tag !== null) && parts.every((p) => {
    if (p[0] === '.') return e.className.split(/\s+/).includes(p.slice(1))
    const m = p.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/)
    if (m === null) return false
    return m[2] === undefined ? e.attrs[m[1]] !== undefined : e.attrs[m[1]] === m[2]
  })
})
const makeDoc = () => {
  const listeners = []
  const doc = { activeElement: null, listeners }
  const el = (tag) => {
    const e = {
      tag, attrs: {}, children: [], className: '', id: '', parent: null, disabled: false, tabIndex: 0, type: '', _text: '', handlers: {},
      get textContent () { return e._text + e.children.map((c) => c.textContent).join('') },
      set textContent (v) { e._text = String(v); e.children = [] },
      get firstChild () { return e.children[0] || null },
      get isConnected () { let n = e; while (n.parent !== null) n = n.parent; return n === doc.body },
      setAttribute (k, v) { e.attrs[k] = String(v) },
      getAttribute (k) { return e.attrs[k] === undefined ? null : e.attrs[k] },
      appendChild (c) { c.parent = e; e.children.push(c); return c },
      removeChild (c) { e.children = e.children.filter((x) => x !== c); c.parent = null; return c },
      remove () { if (e.parent !== null) e.parent.removeChild(e) },
      addEventListener (ev, fn) { (e.handlers[ev] = e.handlers[ev] || []).push(fn) },
      click () { if (e.disabled) return; for (const f of e.handlers.click || []) f({ stopPropagation () {}, preventDefault () {}, target: e }) },
      focus () { doc.activeElement = e },
      querySelectorAll (sel) { const out = []; const walk = (n) => { for (const c of n.children) { if (matches(c, sel)) out.push(c); walk(c) } }; walk(e); return out },
      querySelector (sel) { return e.querySelectorAll(sel)[0] || null }
    }
    return e
  }
  doc.createElement = el
  doc.body = el('body')
  doc.addEventListener = (ev, fn) => listeners.push({ ev, fn })
  doc.removeEventListener = (ev, fn) => { const i = listeners.findIndex((l) => l.ev === ev && l.fn === fn); if (i >= 0) listeners.splice(i, 1) }
  doc.key = (key) => { let stopped = false; for (const l of listeners.slice()) if (l.ev === 'keydown') l.fn({ key, stopPropagation () { stopped = true }, preventDefault () {} }); return stopped }
  const attrs = {}; const classes = new Set()
  doc.documentElement = { attrs, classes, setAttribute: (k, v) => { attrs[k] = String(v) }, getAttribute: (k) => (attrs[k] === undefined ? null : attrs[k]), classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) } }
  return doc
}
const makeWin = ({ ua = 'Mozilla/5.0 (Macintosh)', touch = 0, coarse = false, stored = null, host = undefined, fetchImpl } = {}) => {
  const doc = makeDoc()
  const store = new Map()
  if (stored !== null) store.set('kybernos.mode.v1', JSON.stringify(stored))
  const events = []
  const win = {
    document: doc,
    navigator: { userAgent: ua, maxTouchPoints: touch },
    matchMedia: (q) => ({ matches: /pointer: coarse/.test(q) ? coarse : false }),
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)) } },
    CustomEvent: function (type) { this.type = type },
    dispatchEvent: (e) => { events.push(e.type); return true },
    fetch: fetchImpl || ((url, init) => { win.fetched.push({ url, init }); return Promise.resolve({ ok: true }) }),
    fetched: [], events, store
  }
  if (host !== undefined) win.__KB_MODE_HOST__ = host
  return { win, doc }
}

// ── load the real client.js and take its test hooks ──
const loadClient = (lang = 'en') => {
  let def = null
  const doc = makeDoc()
  globalThis.window = { __ModuleLoader__: { load: (d) => { def = d } }, matchMedia: () => ({ matches: false }), __KB_LANG_RESOLVE__: () => lang, navigator: { userAgent: 'x' }, document: doc }
  globalThis.document = doc
  new Function('window', 'document', SOURCE)(globalThis.window, globalThis.document)
  return def.factory().__test
}
const t = loadClient('en')
const winT = globalThis.window // the window `t` was loaded with: the one its `window.__KB_APP__` reads
const tFr = loadClient('fr')
// the timers are ours so that the 1.5 s wait and the 6 s fallback are decided here
const realSetTimeout = globalThis.setTimeout
const timers = []
globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length }
const tick = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() }
const fire = async (ms) => { const due = timers.filter((x) => x.ms === ms); for (const d of due) { timers.splice(timers.indexOf(d), 1); d.fn() } await tick() }

console.log('the hooks are exported')
{
  check('the seam, the segment, the sheet and the resolver are in __test', ['buildModeSeam', 'buildModeSegment', 'buildModeSheet', 'buildModeCommands', 'bootMode', 'modeText', 'shellModeRequest'].every((k) => typeof t[k] === 'function') && t.MODE_PREFS.length === 3)
  check('the three choices, in order', t.MODE_PREFS.join(',') === 'auto,simple,complete')
}

console.log('the seam: state')
{
  const { win } = makeWin()
  t.bootMode(win)
  const seam = t.buildModeSeam(win, { shellMode: () => false, reload: () => {} })
  const s = seam.state()
  check('it reads what the head resolved: a computer with no choice is Complete by default', s.mode === 'complete' && s.pref === 'auto' && s.source === 'default' && s.busy === false, s)
  check('the seam is frozen (a page cannot add a method by mistake)', Object.isFrozen(seam))
  const bare = makeWin({ touch: 5, coarse: true })
  const seam2 = t.buildModeSeam(bare.win, { shellMode: () => false, reload: () => {} })
  check('with no attributes yet it resolves on the spot: a touch device is Simple', seam2.state().mode === 'simple' && seam2.state().source === 'touch', seam2.state())
  check('wouldBe answers for a choice without touching the page', seam.wouldBe('simple').mode === 'simple' && seam.wouldBe('complete').mode === 'complete' && seam.wouldBe('auto').mode === 'complete' && win.document.documentElement.getAttribute('data-kb-mode') === 'complete')
  check('and Auto on a touch phone would be Simple', seam2.wouldBe('auto').mode === 'simple')
}

console.log('the seam: a change of mode')
{
  const { win } = makeWin()
  t.bootMode(win)
  const calls = { shell: [], reload: 0 }
  const seam = t.buildModeSeam(win, { shellMode: (m) => { calls.shell.push(m); return false }, reload: () => { calls.reload += 1 } })
  const heard = []
  const off = seam.subscribe(() => heard.push(seam.state().busy))
  const done = seam.set('simple')
  check('busy at once, and the page\'s copy is kept before anything is awaited', seam.state().busy === true && JSON.parse(win.store.get('kybernos.mode.v1')).pref === 'simple')
  check('a second choice while one is in progress is refused', await seam.set('complete') === false)
  await tick(); await fire(1500)
  check('the host is told, as a same-origin POST with the choice and its moment', win.fetched.length === 1 && win.fetched[0].url === '/kybernos-mobile/mode' && win.fetched[0].init.method === 'POST' && win.fetched[0].init.credentials === 'same-origin' && JSON.parse(win.fetched[0].init.body).pref === 'simple' && JSON.parse(win.fetched[0].init.body).at > 0, win.fetched)
  check('the shell is asked in its own words (Simple)', calls.shell.join() === 'simple', calls.shell)
  check('with no shell the page reloads itself', calls.reload === 1 && await done === true)
  check('listeners and the window event hear the start', heard.length >= 1 && win.events.includes('kb-mode-change'))
  off()
  check('a listener that left is not called any more', (() => { const n = heard.length; seam.set('complete'); return heard.length === n })())
}
{
  const { win } = makeWin({ ua: 'Mozilla/5.0 (Linux; Android 14) KybernosHost/0.1.0 (android) KabyMode/1 KybernosCaps/mode' })
  t.bootMode(win)
  const calls = { shell: [], reload: 0 }
  const seam = t.buildModeSeam(win, { shellMode: (m) => { calls.shell.push(m); return true }, reload: () => { calls.reload += 1 } })
  check('inside the app under the shell\'s Simple, Auto is Simple from the shell', seam.state().mode === 'simple' && seam.state().source === 'shell', seam.state())
  const p = seam.set('complete')
  await tick(); await fire(1500)
  await p
  check('Complete is « advanced » to the shell', calls.shell.join() === 'advanced', calls.shell)
  check('when the shell took it, the page does not reload at once (the shell rebuilds its WebView)', calls.reload === 0)
  await fire(6000)
  check('a shell that does not rebuild is covered: the page reloads after 6 s', calls.reload === 1)
}
{
  const { win } = makeWin({ touch: 5, coarse: true })
  t.bootMode(win)
  const calls = { shell: [], reload: 0 }
  const seam = t.buildModeSeam(win, { shellMode: (m) => { calls.shell.push(m); return false }, reload: () => { calls.reload += 1 } })
  check('a touch device under Auto is Simple', seam.state().mode === 'simple')
  const p = seam.set('simple')
  await tick(); await fire(1500); await p
  check('a choice that leaves the mode as it is does not reload', calls.reload === 0)
  check('it only changes the choice and why (explicit, no longer the touch)', win.document.documentElement.getAttribute('data-kb-mode-pref') === 'simple' && win.document.documentElement.getAttribute('data-kb-mode-source') === 'choice' && seam.state().busy === false, seam.state())
  check('the shell still hears the word (it keeps its own copy)', calls.shell.join() === 'simple')
  check('a word that is not a choice is refused', await seam.set('turbo') === false && await seam.set(undefined) === false && await seam.set('') === false)
  check('the shell\'s old word works as Complete', await (async () => { const q = seam.set('advanced'); await tick(); await fire(1500); await q; return JSON.parse(win.store.get('kybernos.mode.v1')).pref === 'complete' })())
}
{
  // a host that never answers does not hold the switch
  const { win } = makeWin({ fetchImpl: () => new Promise(() => {}) })
  t.bootMode(win)
  let reloaded = 0
  const seam = t.buildModeSeam(win, { shellMode: () => false, reload: () => { reloaded += 1 } })
  const p = seam.set('simple')
  await tick()
  check('with a host that stays silent nothing happens before 1.5 s', reloaded === 0)
  await fire(1500); await p
  check('then the switch goes on (the page\'s copy already keeps the choice)', reloaded === 1)
}
{
  // a window that refuses storage and fetch still answers
  const { win } = makeWin({ fetchImpl: () => { throw new Error('offline') } })
  win.localStorage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  t.bootMode(win)
  let reloaded = 0
  const seam = t.buildModeSeam(win, { shellMode: () => { throw new Error('no shell') }, reload: () => { reloaded += 1 } })
  const p = seam.set('simple')
  await tick(); await fire(1500)
  check('no storage, no fetch, no shell: it still answers and reloads, never throws', await p === true && reloaded === 1)
  check('openSheet is false when nothing opens it, and never throws', seam.openSheet() === false)
}

console.log('the segment (the drawer\'s foot)')
{
  const { win, doc } = makeWin()
  t.bootMode(win)
  const asked = []
  const seam = t.buildModeSeam(win, { shellMode: () => false, reload: () => {} })
  const realSet = seam.set
  const fake = Object.freeze({ ...seam, set: (v) => { asked.push(v); return realSet(v) } })
  const seg = t.buildModeSegment(doc, fake)
  const btns = seg.el.children
  check('a group of three buttons: Auto, Simple, Complete', seg.el.attrs.role === 'group' && btns.length === 3 && btns.map((b) => b.textContent).join('|') === 'Auto|Simple|Complete', btns.map((b) => b.textContent))
  check('stable hooks for tests and checks, never the visible text', seg.el.attrs['data-kb'] === 'mode-segment' && btns.map((b) => b.attrs['data-act']).join() === 'mode-auto,mode-simple,mode-complete')
  check('the choice is the pressed one (Auto at first)', btns.map((b) => b.attrs['aria-pressed']).join() === 'true,false,false')
  check('the group has a name for a screen reader', seg.el.attrs['aria-label'] === 'Display')
  btns[1].click()
  check('a tap asks the seam for that choice', asked.join() === 'simple')
  seg.sync()
  check('while it works the buttons are off and the group says it is busy', btns.every((b) => b.disabled) && seg.el.attrs['aria-busy'] === 'true')
  const fr = t.buildModeSegment(doc, fake)
  check('the words follow the page\'s language', tFr.modeText('complete') === 'Complet' && tFr.modeText('display') === 'Affichage' && fr.el.children[2].textContent === 'Complete')
  win.document.documentElement.setAttribute('data-kb-mode-pref', 'complete')
}

console.log('the sheet « Display »')
{
  const { win, doc } = makeWin()
  t.bootMode(win)
  let reloaded = 0; let themed = 0
  const seam = t.buildModeSeam(win, { shellMode: () => false, reload: () => { reloaded += 1 } })
  const sheet = t.buildModeSheet(doc, win, seam, () => { themed += 1 })
  check('closed at first', sheet.isOpen() === false && doc.body.children.length === 0)
  check('open() draws a dialog in the page', sheet.open() === true && sheet.isOpen() === true && doc.body.querySelector('[role="dialog"]') !== null)
  const dialog = doc.body.querySelector('[role="dialog"]')
  check('it is modal and named by its title', dialog.attrs['aria-modal'] === 'true' && dialog.attrs['aria-labelledby'] === 'kbmob-mode-title' && dialog.querySelector('h2').textContent === 'Display')
  const radios = dialog.querySelectorAll('[role="radio"]')
  check('three radios, the chosen one checked and focused', radios.length === 3 && radios.map((r) => r.attrs['aria-checked']).join() === 'true,false,false' && doc.activeElement === radios[0])
  check('only the checked one is in the tab order', radios.map((r) => r.tabIndex).join() === '0,-1,-1')
  check('Auto says what it means now', dialog.querySelector('[data-kb="mode-now"]') !== null && /Complete/.test(dialog.querySelector('[data-kb="mode-now"]').textContent), dialog.querySelector('[data-kb="mode-now"]') && dialog.querySelector('[data-kb="mode-now"]').textContent)
  check('open() twice does not draw twice', sheet.open() === true && doc.body.querySelectorAll('[role="dialog"]').length === 1)
  check('the note says nothing is lost', /loses nothing/.test(dialog.textContent))
  check('Escape closes it and the key goes no further', doc.key('Escape') === true && sheet.isOpen() === false && doc.body.children.length === 0)
  check('and the listener is gone with it', doc.listeners.filter((l) => l.ev === 'keydown').length === 0)
  sheet.open()
  const d2 = doc.body.querySelector('[role="dialog"]')
  d2.querySelectorAll('[role="radio"]')[0].focus()
  doc.key('ArrowDown')
  check('the arrows move the focus along the radios', doc.activeElement === d2.querySelectorAll('[role="radio"]')[1])
  doc.key('ArrowUp'); doc.key('ArrowUp')
  check('and wrap around', doc.activeElement === d2.querySelectorAll('[role="radio"]')[2])
  d2.querySelectorAll('[role="radio"]')[0].click()
  check('choosing what is already chosen just closes it', sheet.isOpen() === false && reloaded === 0)
  sheet.open()
  const d3 = doc.body.querySelector('[role="dialog"]')
  d3.querySelectorAll('[role="radio"]')[1].click()
  await tick()
  check('choosing another asks the seam, and the sheet shows it is working', win.fetched.length === 1 && d3.querySelectorAll('[role="radio"]').every((r) => r.disabled) && /Reloading/.test(d3.textContent))
  await fire(1500)
  check('and the page reloads (no shell here)', reloaded === 1)
  sheet.close()
  sheet.open()
  doc.body.querySelector('[data-act="mode-theme"]').click()
  check('the Theme link closes the sheet and opens the page', themed === 1 && sheet.isOpen() === false)
  check('the scrim closes it too', (() => { sheet.open(); const scrim = doc.body.querySelector('.kbmob-modescrim'); scrim.click(); return sheet.isOpen() === false })())
}

console.log('the palette commands')
{
  const { win, doc } = makeWin()
  t.bootMode(win)
  const asked = []
  const seam = t.buildModeSeam(win, { shellMode: () => false, reload: () => {} })
  const fake = Object.freeze({ ...seam, set: (v) => { asked.push(v); return Promise.resolve(true) } })
  const sheet = t.buildModeSheet(doc, win, seam, null)
  const cmds = t.buildModeCommands(fake, sheet)
  check('four commands: the sheet, then one per choice', cmds.map((c) => c.id).join() === 'display-open,display-auto,display-simple,display-complete', cmds.map((c) => c.id))
  check('each has a label, keywords that find it by « mode » or « display », a hint and a run', cmds.every((c) => typeof c.label() === 'string' && c.label() !== '' && c.keywords.includes('mode') && c.keywords.includes('display') && typeof c.hint() === 'string' && typeof c.run === 'function'))
  check('the labels read as the sheet does', cmds.map((c) => c.label()).join('|') === 'Display…|Display: Auto|Display: Simple|Display: Complete', cmds.map((c) => c.label()))
  cmds[2].run(); cmds[3].run()
  check('a choice\'s command sets that choice', asked.join() === 'simple,complete', asked)
  cmds[0].run()
  check('the first opens the sheet', sheet.isOpen() === true)
  sheet.close()
  check('the registry is the array the search reads: the layout pushes into it and takes its own out again', /window\.__KB_COMMANDS__ = \[\]/.test(SOURCE) && /registry\.splice\(i, 1\)/.test(SOURCE) && /commands\.forEach\(\(c\) => registry\.push\(c\)\)/.test(SOURCE))
}

console.log('the shell\'s side')
{
  // no door at all: false (the page reloads itself)
  winT.__KB_APP__ = undefined
  check('with no shell door the request is false', t.shellModeRequest('simple') === false)
  const got = []
  winT.__KB_APP__ = { requestMode: (m) => { got.push(m); return true } }
  check('the Kaby bridge\'s door is used when it is there', t.shellModeRequest('advanced') === true && got.join() === 'advanced')
  winT.__KB_APP__ = { requestMode: () => { throw new Error('bridge') } }
  check('a door that throws is a « no »', t.shellModeRequest('simple') === false)
  winT.__KB_APP__ = undefined
}

console.log('the source')
{
  check('the wiring: mounted by the layout\'s effect, the bridge forwards the request, the dock draws the segment', /undo\.push\(mountMode\(\)\)/.test(SOURCE) && /requestMode: \(m\) => bridge\.setMode\(m\)/.test(SOURCE) && /buildModeSegment\(document, modeSeam\)/.test(SOURCE))
  check('the old « Need more? » button goes through the seam first', /seam\.set\('complete'\)/.test(SOURCE))
  check('and the full app\'s « Simple mode » card too', /seam\.set\('simple'\)/.test(SOURCE))
  check('the seam is published as window.__KB_MODE__ and removed with the layout', /window\.__KB_MODE__ = seam/.test(SOURCE) && /delete window\.__KB_MODE__/.test(SOURCE))
  check('no hex colour in the block (the sheet\'s rules arrive from the host, with system fallbacks)', !/#[0-9a-fA-F]{3,8}\b/.test((SOURCE.match(/\/\/ <kb-mode>[\s\S]*?\/\/ <\/kb-mode>/) || [''])[0]))
}

globalThis.setTimeout = realSetTimeout
console.log(failed === 0 ? '\nall passed' : '\n' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
