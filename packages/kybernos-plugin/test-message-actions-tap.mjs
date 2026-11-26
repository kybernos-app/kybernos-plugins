#!/usr/bin/env node
// The row under the agent's answers shown by a TAP on the phone's Simple preset (client.js, block `kb-msg-actions-tap`): the mode (only in Kaby mode, only when the locked preset
// says `messageActions: 'tap'`), what a tap does and does not do (an answer toggles its row, one row at a time; a link, a button, a selection, a long press, a drag, the open row
// and its card do not; a tap elsewhere hides it; a turn still streaming has no row to show), and the stylesheet (stable hooks only, no hashed class). The block is cut out of
// client.js and run on a small fake DOM. The drawn result (animation, no jump of the text read, 44 px zones) is measured on the real GUI: scripts/check-message-actions-live.mjs.
//
//   node packages/kybernos-plugin/test-message-actions-tap.mjs
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const a = SRC.indexOf('// <kb-msg-actions-tap>')
const b = SRC.indexOf('// </kb-msg-actions-tap>')
if (a < 0 || b < a) { console.log('  ✗ cannot cut the block out of client.js'); process.exit(1) }
const BLOCK = SRC.slice(a, b)

// ── a fake DOM that understands what the block asks: `closest` / `querySelector` of simple selectors, attributes, siblings ──
const simple = (sel, e) => {
  // one compound selector: tag, .class, [attr], [attr="v"] (no combinator)
  const re = /^([a-z0-9]*)((?:\.[\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/i
  const m = re.exec(sel.trim())
  if (m === null) return false
  if (m[1] !== '' && e.tag !== m[1]) return false
  for (const part of m[2].match(/\.[\w-]+|\[[^\]]+\]/g) || []) {
    if (part[0] === '.') { if (!e.cls.includes(part.slice(1))) return false } else {
      const [k, v] = part.slice(1, -1).split('=')
      if (!e.attrs.has(k)) return false
      if (v !== undefined && e.attrs.get(k) !== v.replace(/^"|"$/g, '')) return false
    }
  }
  return true
}
const matches = (list, e) => list.split(',').some((s) => simple(s, e))
const el = (tag, attrs = {}, kids = [], cls = '') => {
  const e = {
    tag, cls: cls.split(' ').filter(Boolean), attrs: new Map(Object.entries(attrs)), kids: [], parent: null, dataset: {},
    getAttribute (k) { return this.attrs.has(k) ? this.attrs.get(k) : null },
    setAttribute (k, v) { this.attrs.set(k, String(v)) },
    removeAttribute (k) { this.attrs.delete(k) },
    closest (sel) { for (let n = this; n !== null; n = n.parent) if (matches(sel, n)) return n; return null },
    contains (x) { for (let n = x; n !== null; n = n.parent) if (n === this) return true; return false },
    get nextElementSibling () { if (this.parent === null) return null; const i = this.parent.kids.indexOf(this); return this.parent.kids[i + 1] || null },
    querySelector (sel) {
      // the only combinator the block uses: `[data-turn-tail] > [data-clock="end"]`
      const parts = sel.split('>').map((x) => x.trim())
      const all = []
      const walk = (n) => { all.push(n); n.kids.forEach(walk) }
      this.kids.forEach(walk)
      return all.find((n) => (parts.length === 1 ? matches(parts[0], n) : matches(parts[1], n) && n.parent !== null && matches(parts[0], n.parent))) || null
    },
    remove () { if (this.parent !== null) this.parent.kids.splice(this.parent.kids.indexOf(this), 1) },
    own: '', innerHTML: '', listeners: [],
    appendChild (n) { n.parent = this; this.kids.push(n); return n },
    addEventListener (type, fn) { this.listeners.push([type, fn]) },
    get textContent () { return this.own + this.kids.map((k) => k.textContent).join('') },
    set textContent (v) { this.own = String(v); this.kids = [] },
    get previousElementSibling () { if (this.parent === null) return null; const i = this.parent.kids.indexOf(this); return i > 0 ? this.parent.kids[i - 1] : null },
    querySelectorAll (sel) { const all = []; const walk = (n) => { all.push(n); n.kids.forEach(walk) }; this.kids.forEach(walk); return all.filter((n) => matches(sel, n)) },
    cloneNode () { const c = el(this.tag, Object.fromEntries(this.attrs), this.kids.map((k) => k.cloneNode()), this.cls.join(' ')); c.own = this.own; return c },
  }
  for (const k of kids) { k.parent = e; e.kids.push(k) }
  return e
}
const turn = (n, { streaming = false } = {}) => {
  const text = el('p', {}, [], 'text')
  const link = el('a', { href: '#' })
  const code = el('div', {}, [el('button', { 'aria-label': 'Copy' })])
  const answer = el('div', { 'data-chat-flow-kind': 'assistant-step', 'data-chat-turn': String(n) }, [el('div', {}, [text, link, code])])
  const copy = el('button', { 'aria-label': 'Copy' })
  const row = el('div', { 'data-clock': 'end' }, [copy])
  const tailRoot = el('div', { 'data-turn-tail': String(n) }, streaming ? [] : [row])
  const tail = el('div', { 'data-chat-flow-kind': 'turn-tail', 'data-chat-turn': String(n) }, [el('div', { 'data-slot': 'conversation.chat.node' }, [tailRoot])])
  return { answer, tail, text, link, code, copy, row }
}
const build = (o = {}) => {
  const t1 = turn(1)
  const t2 = turn(2, { streaming: o.streaming === true })
  // the person's own message: the engine draws its text and, next to it in the same flow row, its own row (the time and the copy icon: `data-clock="start"`)
  const myText = el('p', {}, [], 'text')
  const myLink = el('a', { href: '#' })
  const myCopy = el('button', { 'aria-label': 'Copy' })
  const myRow = el('div', { 'data-clock': 'start' }, [myCopy])
  myText.own = 'Can you explain fractions with a pizza?'
  myRow.own = '10:42'
  const user = el('div', { 'data-chat-flow-kind': 'user', 'data-chat-turn': '2' }, [el('div', {}, [myText, myLink]), myRow])
  const flow = el('div', { 'data-chat-flow': '' }, [t1.answer, t1.tail, user, t2.answer, t2.tail])
  const composer = el('div', { 'data-slot': 'conversation.composer' }, [el('textarea')])
  const pop = el('div', {}, [el('button')], 'kbq-rating-pop')
  const head = el('head')
  const html = el('html', {}, [head, el('body', {}, [flow, composer, pop])])
  html.classList = { contains: (c) => html.cls.includes(c) }
  if (o.kaby !== false) html.cls.push('kb-kaby')
  if (o.simple === true) html.cls.push('kb-simple')
  if (o.mode !== undefined) html.setAttribute('data-kb-mode', o.mode)
  const listeners = []
  const doc = {
    documentElement: html, head,
    createElement: (tag) => el(tag), querySelector: (sel) => (sel === 'style[data-kybernos="kb-actions-tap"]' ? head.kids.find((k) => k.tag === 'style' && k.dataset.kybernos === 'kb-actions-tap') || null : null),
    addEventListener: (type, fn, opts) => listeners.push(['doc', type, fn, opts]), removeEventListener: (type, fn) => { const i = listeners.findIndex((l) => l[0] === 'doc' && l[1] === type && l[2] === fn); if (i >= 0) listeners.splice(i, 1) },
  }
  head.appendChild = (n) => { n.parent = head; head.kids.push(n) }
  let selection = { isCollapsed: true, toString: () => '' }
  const lock = o.lock === undefined ? { v: 1, options: () => ({ messageActions: 'tap' }) } : o.lock
  const media = {
    matches: o.phone !== false,
    addEventListener: (type, fn) => listeners.push(['media', type, fn]),
    removeEventListener: (type, fn) => { const i = listeners.findIndex((l) => l[0] === 'media' && l[1] === type && l[2] === fn); if (i >= 0) listeners.splice(i, 1) },
  }
  const win = {
    __KB_THEME_LOCKED__: lock,
    getSelection: () => selection,
    matchMedia: () => media,
    addEventListener: (type, fn) => listeners.push(['win', type, fn]), removeEventListener: (type, fn) => { const i = listeners.findIndex((l) => l[0] === 'win' && l[1] === type && l[2] === fn); if (i >= 0) listeners.splice(i, 1) },
  }
  let now = 1000
  const FakeDate = { now: () => now }
  const made = new Function('Date', BLOCK + '\nreturn { kbMsgActionsMode, kbMsgActionsTap, kbMsgActionsTail, kbMsgMineText, kbMsgAnswerText, kbMsgQuote, KB_MA_CSS }')(FakeDate)
  const edited = []
  const tap = made.kbMsgActionsTap(doc, win, o.noEdit === true ? undefined : { edit: (t) => { edited.push(t) }, editLabel: () => 'Edit' })
  return { edited, made, tap, doc, win, media, html, t1, t2, user, myText, myLink, myCopy, myRow, composer, pop, listeners, setSelection: (s) => { selection = s }, advance: (ms) => { now += ms } }
}
const press = (w, target, o = {}) => {
  w.tap.down({ clientX: o.x0 === undefined ? 10 : o.x0, clientY: 10 })
  if (o.hold) w.advance(o.hold)
  w.tap.click({ target, clientX: o.x === undefined ? 10 : o.x, clientY: 10 })
}
const shown = (t) => t.tail.getAttribute('data-kb-reveal') === '1'
const mineShown = (w) => w.user.getAttribute('data-kb-reveal') === '1'

console.log('the mode: Simple mode (native app or mobile browser), only when the locked preset asks for it')
{
  let w = build()
  check('Kaby mode (legacy class without data-kb-mode) + `messageActions: tap` = tap', w.made.kbMsgActionsMode(w.doc, w.win) === 'tap')
  w = build({ kaby: false, simple: true })
  check('Simple mode without kb-kaby (html.kb-simple in mobile browser) + `messageActions: tap` = tap', w.made.kbMsgActionsMode(w.doc, w.win) === 'tap')
  w = build({ kaby: false, simple: true, mode: 'simple' })
  check('Simple mode with data-kb-mode="simple" and no kb-kaby = tap', w.made.kbMsgActionsMode(w.doc, w.win) === 'tap')
  w = build({ kaby: false, simple: true, mode: 'simple', phone: false })
  check('Simple chosen on a large desktop keeps the desktop hover (no phone tap mode)', w.made.kbMsgActionsMode(w.doc, w.win) === null)
  w = build({ kaby: false, simple: false, mode: 'complete' })
  check('Complete mode on a desktop (data-kb-mode="complete", no kb-simple): nothing, hover stays', w.made.kbMsgActionsMode(w.doc, w.win) === null)
  w = build({ kaby: true, simple: false, mode: 'complete' })
  check('Complete mode explicitly set (data-kb-mode="complete", no kb-simple) even with kb-kaby: nothing', w.made.kbMsgActionsMode(w.doc, w.win) === null)
  w = build({ kaby: false })
  check('outside Simple / Kaby mode (the full app, a computer): nothing, the hover stays', w.made.kbMsgActionsMode(w.doc, w.win) === null)
  w = build({ lock: undefined, kaby: true }); w.win.__KB_THEME_LOCKED__ = undefined
  check('no locked presets published: nothing', w.made.kbMsgActionsMode(w.doc, w.win) === null)
  w = build({ lock: { v: 1, options: () => ({ touch: true }) } })
  check('a preset without the option: nothing (the row is drawn as in the full app)', w.made.kbMsgActionsMode(w.doc, w.win) === null)
  w = build({ lock: { v: 1, options: () => ({ messageActions: 'hover' }) } })
  check('another word: nothing', w.made.kbMsgActionsMode(w.doc, w.win) === null)
  w = build({ lock: { v: 2, options: () => ({ messageActions: 'tap' }) } })
  check('a seam of another version: nothing', w.made.kbMsgActionsMode(w.doc, w.win) === null)
  w = build({ lock: { v: 1, options: () => { throw new Error('boom') } } })
  check('a seam that throws: nothing, no throw', w.made.kbMsgActionsMode(w.doc, w.win) === null)
}

console.log('apply / start / stop')
{
  const w = build()
  const stop = w.tap.start()
  check('start() marks <html> and adds one stylesheet', w.html.getAttribute('data-kb-msg-actions') === 'tap' && w.doc.querySelector('style[data-kybernos="kb-actions-tap"]') !== null && w.html.kids[0].kids.length === 1)
  w.tap.apply()
  check('applying again does not add a second stylesheet', w.html.kids[0].kids.length === 1)
  check('it listens to taps (click), to the finger going down (pointerdown, capture) and to the locked presets becoming readable', w.listeners.some((l) => l[1] === 'click') && w.listeners.some((l) => l[1] === 'pointerdown' && l[3] && l[3].capture === true) && w.listeners.some((l) => l[0] === 'win' && l[1] === 'kb-locked-presets-ready'))
  press(w, w.t1.text)
  check('a tap on an answer shows its row', shown(w.t1) && w.tap.isOpen() === w.t1.tail)
  stop()
  check('stop() takes the mark, the stylesheet, the open row and the listeners away', w.html.getAttribute('data-kb-msg-actions') === null && w.doc.querySelector('style[data-kybernos="kb-actions-tap"]') === null && !shown(w.t1) && w.listeners.length === 0)
  const w2 = build({ kaby: false, mode: 'complete' })
  w2.tap.start()
  check('in Complete mode (desktop) start() marks nothing and adds no phone tap stylesheet', w2.html.getAttribute('data-kb-msg-actions') === null && w2.doc.querySelector('style[data-kybernos="kb-actions-tap"]') === null)
  press(w2, w2.t1.text)
  check('...and a tap does nothing', !shown(w2.t1))
  press(w2, w2.myText)
  check('...not on the person\'s own message either: its row stays as the engine draws it (the full app, a computer)', w2.user.getAttribute('data-kb-reveal') === null && w2.tap.isOpen() === null)
  const wMob = build({ kaby: false, simple: true, mode: 'simple' })
  wMob.tap.start()
  press(wMob, wMob.t1.text)
  check('in a mobile browser in Simple mode (html.kb-simple without kb-kaby), start() enables tap mode and tapping an answer reveals its row', wMob.html.getAttribute('data-kb-msg-actions') === 'tap' && shown(wMob.t1))
  press(wMob, wMob.myText)
  check('...and tapping the person\'s own message closes the answer row and reveals its own row with Edit', !shown(wMob.t1) && mineShown(wMob) && wMob.myRow.querySelector('[data-kb="msg-edit"]') !== null)
  const wDesk = build({ kaby: false, simple: true, mode: 'simple', phone: false })
  const stopDesk = wDesk.tap.start()
  check('a large desktop in Simple starts without the tap stylesheet', wDesk.html.getAttribute('data-kb-msg-actions') === null && wDesk.doc.querySelector('style[data-kybernos="kb-actions-tap"]') === null)
  wDesk.media.matches = true
  wDesk.listeners.filter((l) => l[0] === 'media' && l[1] === 'change').forEach((l) => l[2]())
  check('becoming a small/touch viewport enables tap mode without a reload', wDesk.html.getAttribute('data-kb-msg-actions') === 'tap')
  wDesk.media.matches = false
  wDesk.listeners.filter((l) => l[0] === 'media' && l[1] === 'change').forEach((l) => l[2]())
  check('returning to a large viewport restores the desktop behavior', wDesk.html.getAttribute('data-kb-msg-actions') === null)
  stopDesk()
  const w3 = build({ lock: undefined }); w3.win.__KB_THEME_LOCKED__ = undefined
  w3.tap.start()
  w3.win.__KB_THEME_LOCKED__ = { v: 1, options: () => ({ messageActions: 'tap' }) }
  w3.listeners.filter((l) => l[1] === 'kb-locked-presets-ready').forEach((l) => l[2]())
  check('the preset published after the bundle started: the event turns it on', w3.html.getAttribute('data-kb-msg-actions') === 'tap')
}

console.log('what a tap does')
{
  const w = build()
  w.tap.start()
  press(w, w.t1.text)
  check('a tap on the answer shows the row of THAT answer only', shown(w.t1) && !shown(w.t2))
  press(w, w.t1.text)
  check('a second tap on it hides it', !shown(w.t1) && w.tap.isOpen() === null)
  press(w, w.t1.text); press(w, w.t2.text)
  check('a tap on another answer: that one opens and the first closes (one row at a time)', shown(w.t2) && !shown(w.t1))
  press(w, w.composer)
  check('a tap elsewhere (the composer) hides it', !shown(w.t2) && w.tap.isOpen() === null)
  press(w, w.t1.text); press(w, w.user)
  check('a tap on the person\'s own message hides the open answer row (and shows its own, see below)', !shown(w.t1) && mineShown(w))
  press(w, w.t1.text); w.tap.click({ target: w.t1.copy })
  check('a tap on a button of the open row does not hide it (the button does its own job)', shown(w.t1))
  w.tap.click({ target: w.pop.kids[0] })
  check('a tap in the rating card (a portal in <body>) does not hide it', shown(w.t1))
  press(w, w.t1.link)
  check('a tap on a link in the answer neither shows nor hides', shown(w.t1))
  press(w, w.t1.text)
  check('(and the row can still be hidden with a tap on the text)', !shown(w.t1))
  press(w, w.t1.link)
  check('a tap on a link with the row hidden does not show it', !shown(w.t1))
  press(w, w.t1.code.kids[0])
  check('a tap on the copy button of a code block does not show it', !shown(w.t1))
}

console.log('the person\'s own message: its row (the time, the copy icon) comes the same way')
{
  const w = build()
  w.tap.start()
  press(w, w.myText)
  check('a tap on the person\'s own message shows its row (the same mark, on its flow row)', mineShown(w) && w.tap.isOpen() === w.user)
  press(w, w.myText)
  check('a second tap on its text hides it', !mineShown(w) && w.tap.isOpen() === null)
  press(w, w.myText); w.tap.click({ target: w.myCopy })
  check('a tap on the copy icon of the open row leaves it open (the icon does its own job)', mineShown(w))
  w.tap.click({ target: w.myRow })
  check('...and so does a tap on the row itself (the time)', mineShown(w))
  press(w, w.myLink)
  check('a tap on a link in the message neither shows nor hides', mineShown(w))
  press(w, w.t1.text)
  check('a tap on an answer: its row opens and the message row closes (one row at a time)', shown(w.t1) && !mineShown(w))
  press(w, w.myText)
  check('...and the other way round', mineShown(w) && !shown(w.t1))
  press(w, w.composer)
  check('a tap elsewhere hides it', !mineShown(w) && w.tap.isOpen() === null)
  w.setSelection({ isCollapsed: false, toString: () => 'some words' })
  press(w, w.myText)
  check('a selection made in the message is not a tap on it', !mineShown(w))
  w.setSelection({ isCollapsed: true, toString: () => '' })
  press(w, w.myText, { hold: 600 })
  check('a long press on it does not toggle either', !mineShown(w))
  const bare = el('div', { 'data-chat-flow-kind': 'user', 'data-chat-turn': '3' }, [el('p', {}, [], 'text')])
  press(w, w.t1.text); press(w, bare.kids[0])
  check('a message with no row (nothing drawn yet): a tap shows nothing and hides the row that was open', bare.getAttribute('data-kb-reveal') === null && !shown(w.t1) && w.tap.isOpen() === null)
  const steer = el('div', { 'data-chat-flow-kind': 'steering', 'data-chat-turn': '4' }, [el('p', {}, [], 'text'), el('div', { 'data-clock': 'start' }, [el('button')])])
  press(w, steer.kids[0])
  check('a steering message (the same bubble) works the same way', steer.getAttribute('data-kb-reveal') === '1' && w.tap.isOpen() === steer)
  w.tap.close()
  check('close() takes the mark off whichever row was open', steer.getAttribute('data-kb-reveal') === null)
  press(w, w.myText)
  w.tap.apply()
  check('applying again keeps the open message row (nothing moved)', mineShown(w))
  w.html.cls.splice(w.html.cls.indexOf('kb-kaby'), 1)
  w.tap.apply()
  check('leaving Kaby mode closes it and takes the mark off the message too', !mineShown(w) && w.tap.isOpen() === null)
}

console.log('item 31: Edit under the person\'s own message, Cite under an answer')
{
  const w = build()
  w.tap.start()
  check('no Edit button before the row is shown', w.myRow.querySelector('[data-kb="msg-edit"]') === null)
  press(w, w.myText)
  const btn = w.myRow.querySelector('[data-kb="msg-edit"]')
  check('a tap on the message adds ONE Edit button to its row, named by the label the page gives', btn !== null && btn.tag === 'button' && btn.getAttribute('aria-label') === 'Edit' && btn.getAttribute('type') === 'button' && btn.kids[0].textContent === 'Edit')
  press(w, w.myText); press(w, w.myText)
  check('showing the row again does not add a second one', w.myRow.kids.filter((k) => k.getAttribute('data-kb') === 'msg-edit').length === 1)
  w.tap.click({ target: btn })
  check('a tap on the Edit button leaves the row alone (the button does its own job)', mineShown(w))
  btn.listeners.find((l) => l[0] === 'click')[1]({})
  check('Edit puts the message text, without the time or the Edit word, back in the composer through the page\'s draft, and closes the row', w.edited.length === 1 && w.edited[0] === 'Can you explain fractions with a pizza?' && !mineShown(w))
  const t = w.made.kbMsgMineText(w.user)
  check('the text of a message leaves out the row of actions', t === 'Can you explain fractions with a pizza?', t)
  check('a message with only a row has no text to put back', w.made.kbMsgMineText(el('div', { 'data-chat-flow-kind': 'user' }, [el('div', { 'data-clock': 'start' }, [el('button')])])) === null && w.made.kbMsgMineText(null) === null)
  press(w, w.t1.text)
  check('the row of an answer gets no Edit button (Cite is its own button, drawn by the slot)', w.t1.row.querySelector('[data-kb="msg-edit"]') === null && w.t1.tail.querySelector('[data-kb="msg-edit"]') === null)
  const w2 = build({ noEdit: true }); w2.tap.start(); press(w2, w2.myText)
  check('without the option nothing is added: the block behaves as before', w2.myRow.querySelector('[data-kb="msg-edit"]') === null && mineShown(w2))
  check('the Edit button is drawn only while the tap mode is on (its rule is under `html[data-kb-msg-actions="tap"]`)', /html\[data-kb-msg-actions="tap"\] \[data-kb="msg-edit"\]\{display:inline-flex/.test(w.made.KB_MA_CSS))
  const q = w.made.kbMsgQuote
  check('a quotation: every line behind « > », a blank one stays « > », and a blank line after for the person to write', q('Line one\n\nLine two') === '> Line one\n>\n> Line two\n\n')
  check('nothing to quote gives nothing', q('') === '' && q('   \n ') === '' && q(null) === '' && q(undefined) === '')
  check('a long text is cut on a space at the cap and ends with an ellipsis', q('aaa bbb ccc ddd', 9) === '> aaa bbb\u2026\n\n' && q('x'.repeat(30), 10) === '> ' + 'x'.repeat(10) + '\u2026\n\n')
  check('trailing spaces and runs of blank lines are tidied', q('a  \n\n\n\nb\u00a0') === '> a\n>\n> b\n\n')
  w.t1.answer.innerText = 'Sure! 3 slices of 8 is 3/8.'
  check('the answer a row belongs to is the last step of its turn that says something', w.made.kbMsgAnswerText(w.t1.tail) === 'Sure! 3 slices of 8 is 3/8.')
  check('an answer with no text gives null (nothing is cited)', w.made.kbMsgAnswerText(w.t2.tail) === null && w.made.kbMsgAnswerText(null) === null)
}

console.log('what a tap must not do')
{
  const w = build()
  w.tap.start()
  w.setSelection({ isCollapsed: false, toString: () => 'some words' })
  press(w, w.t1.text)
  check('with a text selected, a tap on the answer does not toggle', !shown(w.t1))
  w.setSelection({ isCollapsed: true, toString: () => '' })
  w.setSelection({ isCollapsed: false, toString: () => 'some words' })
  w.tap.down({ clientX: 10, clientY: 10 })
  w.setSelection({ isCollapsed: true, toString: () => '' })
  w.tap.click({ target: w.t1.text, clientX: 10, clientY: 10 })
  check('the tap that only ends a selection (it was there when the finger went down) does not toggle', !shown(w.t1))
  press(w, w.t1.text, { hold: 600 })
  check('a long press does not toggle', !shown(w.t1))
  press(w, w.t1.text, { x: 60 })
  check('a drag of the finger (more than 10 px) does not toggle', !shown(w.t1))
  press(w, w.t1.text)
  check('a plain tap still does, after all of that', shown(w.t1))
  w.setSelection({ isCollapsed: false, toString: () => 'words' })
  press(w, w.composer)
  check('a selection is never taken for a tap elsewhere: the open row stays', shown(w.t1))
  w.setSelection({ isCollapsed: true, toString: () => '' })
  const form = el('div', { 'data-kb': 'report-form' })
  const root1 = w.t1.tail.kids[0].kids[0]
  root1.kids.push(form); form.parent = root1
  press(w, w.composer)
  check('a report form being filled is not hidden by a tap elsewhere', shown(w.t1))
  form.remove()
  press(w, w.composer)
  check('(once the form is closed the row hides again)', !shown(w.t1))
}

console.log('a turn that is still streaming')
{
  const w = build({ streaming: true })
  w.tap.start()
  press(w, w.t2.text)
  check('the answer being written has no row yet: a tap shows nothing', !shown(w.t2) && w.tap.isOpen() === null)
  check('...the finder says so: no tail with a row', w.made.kbMsgActionsTail(w.t2.answer) === null && w.made.kbMsgActionsTail(w.t1.answer) === w.t1.tail)
  press(w, w.t1.text)
  press(w, w.t2.text)
  check('a tap on the answer being written hides the row that was open (it is a tap elsewhere)', !shown(w.t1))
  // the answer ends: its row comes into the tail, hidden by the stylesheet, and the next tap shows it
  const tailRoot = w.t2.tail.kids[0].kids[0]
  tailRoot.kids.push(w.t2.row); w.t2.row.parent = tailRoot
  press(w, w.t2.text)
  check('once the answer is finished a tap shows its row', shown(w.t2))
}

console.log('the stylesheet: stable hooks, hidden by default, shown by the mark of the hover, calm')
{
  const css = build().made.KB_MA_CSS
  check('everything is under `html[data-kb-msg-actions="tap"]` (inert without it)', css.split('\n').filter((l) => /\{/.test(l) && !/^@media/.test(l.trim())).every((l) => l.trim().startsWith('html[data-kb-msg-actions="tap"]') || l.trim().startsWith('}') || /^\s*html\[data-kb-msg-actions="tap"\]/.test(l)))
  check('the row is found by the engine\'s data attributes, never by a hashed class', /\[data-turn-tail\]:has\(> \[data-clock="end"\]\)/.test(css) && !/xzv4MW|[A-Za-z0-9]{6}_[a-z]+/.test(css + BLOCK.replace(/\/\/.*$/gm, '')))
  check('hidden by default: no height, no opacity, not reachable (visibility), so a screen reader and a finger cannot hit it', /\[data-turn-tail\]:has\(> \[data-clock="end"\]\)\{max-height:0;overflow:hidden;opacity:0;visibility:hidden/.test(css))
  check('shown by the same mark as the desktop hover (`data-kb-reveal`), by the rating card\'s keep mark (`data-kb-keep`) and by focus', /\[data-kb-reveal\] \[data-turn-tail\]/.test(css) && /\[data-kb-keep\] \[data-turn-tail\]/.test(css) && /turn-tail"\]:focus-within/.test(css))
  check('the row is 44 px: its growth is capped at 72 px so the glide ends with the motion, and the cap is lifted (640 px) for a rated card or an open report form so nothing is cut', /\{max-height:72px;opacity:1;visibility:visible;transform:none\}/.test(css) && /:has\(\.kbq-rating-merci,\[data-kb="report-form"\]\)\{max-height:640px\}/.test(css))
  check('a short fade and a 4 px slide, only for people who did not ask for less motion', /prefers-reduced-motion:no-preference/.test(css) && /transition:max-height 220ms ease-out,opacity 160ms ease-out,transform 160ms ease-out,visibility 0s linear 220ms/.test(css))
  check('hiding waits for the fade (visibility after 220 ms), showing does not wait', /transition-delay:0s/.test(css))
  check('the person\'s own row (`data-clock="start"`) is hidden by default the same way: no height, no opacity, not reachable', /html\[data-kb-msg-actions="tap"\] \[data-clock="start"\]\{max-height:0;overflow:hidden;opacity:0;visibility:hidden;transform:translateY\(-4px\)\}/.test(css))
  check('...and shown by the same mark on its flow row (`data-kb-reveal`) or while a field of the row has focus, with the same 72 px cap', /html\[data-kb-msg-actions="tap"\] \[data-kb-reveal\] \[data-clock="start"\]/.test(css) && /:is\(\[data-chat-flow-kind="user"\],\[data-chat-flow-kind="steering"\]\):focus-within \[data-clock="start"\]\{max-height:72px;opacity:1;visibility:visible;transform:none\}/.test(css))
  check('every rule that names the person\'s row is under `html[data-kb-msg-actions="tap"]` (the full app and the desktop hover keep the engine\'s own rule)', css.split('\n').filter((l) => l.includes('data-clock="start"')).every((l) => l.trim().startsWith('html[data-kb-msg-actions="tap"]')) && css.includes('data-clock="start"'))
  check('the answer\'s row rules did not move: the end row is still hidden by its own rule', /\[data-turn-tail\]:has\(> \[data-clock="end"\]\)\{max-height:0;overflow:hidden/.test(css) && !/\[data-clock="end"\][^{}]*\[data-clock="start"\]/.test(css))
}

console.log('source level')
{
  check('the desktop hover bridge stays out of the way in tap mode (a touch fires mouse events after a tap, which must not show the row first)', /document\.addEventListener\('mouseover', \(ev\) => \{\s*\/\/[^\n]*\n\s*if \(document\.documentElement\.getAttribute\('data-kb-msg-actions'\) === 'tap'\) return/.test(SRC))
 const cite = SRC.slice(SRC.indexOf('const KbMsgCite = '), SRC.indexOf('const KB_QUALITY_DAYS'))
  check('Cite is a real button with a name, takes the selection when the finger goes down, and fills the composer without sending', /h\('button', \{ type: 'button', ref: racine, className: 'kbq-cite', 'data-kb': 'msg-cite', 'aria-label': label/.test(cite) && /onPointerDown: aDown/.test(cite) && /kbPrefillDraft\(q, 0, sid !== '' \? sid : undefined, true\)/.test(cite) && !/submit/.test(cite))
  check('Cite and Edit are 44 px touch zones in the phone row, like the buttons beside them (seen at 406 px: Cite was 36)', /\.kbq-cite\{width:44px;height:44px\}/.test(SRC) && /KB_MA_EDIT \+ '\{display:inline-flex;align-items:center;gap:6px;min-height:44px/.test(SRC))
  check('Cite sits in the row under the answer, next to the rating, behind the same guard', /id: 'kybernos-cite', order: 21/.test(SRC) && /\(function \(\) \{ try \{ return KbMsgCite \}/.test(SRC))
  const en = JSON.parse(readFileSync(new URL('./i18n/en.json', import.meta.url), 'utf8'))
  const fr = JSON.parse(readFileSync(new URL('./i18n/fr.json', import.meta.url), 'utf8'))
  check('Cite and Edit have an English and a French word', en['kbui.msg.cite'] === 'Cite' && en['kbui.msg.edit'] === 'Edit' && fr['kbui.msg.cite'] === 'Citer' && fr['kbui.msg.edit'] === 'Modifier')
  check('the behaviour is started by an effect of the plugin (and stopped with it)', /return kbMsgActionsTap\(document, window, \{ edit: /.test(SRC) && /'kybers: message actions on a tap \(phone\)'/.test(SRC))
  check('the person\'s own message is found by the engine\'s own markers: the flow rows `user` and `steering`, the row `data-clock="start"` (MessageItem.tsx, MessageIconActions.tsx)', /const KB_MA_MINE = '\[data-clock="start"\]'/.test(BLOCK) && /const KB_MA_USER = '\[data-chat-flow-kind="user"\],\[data-chat-flow-kind="steering"\]'/.test(BLOCK))
  check('the block makes no network call, writes no storage, sets no timer', !/\bfetch\(|XMLHttpRequest|sendBeacon|localStorage|setTimeout|setInterval/.test(BLOCK.replace(/\/\/.*$/gm, '')))
  check('the tap decides on the engine\'s own markers: the flow rows `assistant-step` and `turn-tail`, the tail root `data-turn-tail`, the row `data-clock="end"`', /data-chat-flow-kind="assistant-step"/.test(BLOCK) && /data-chat-flow-kind'\) === 'turn-tail'/.test(BLOCK) && /\[data-turn-tail\] > \[data-clock="end"\]/.test(BLOCK))
}

console.log(fail === 0 ? '\n✓ ' + pass + ' passed, 0 failed' : '\n✗ ' + fail + ' failed, ' + pass + ' passed')
process.exit(fail === 0 ? 0 : 1)
