// The help of a plugin page, the part the hub draws (window.__KB_HELP__): the link to the article at the foot of the card, and the
// animated help that opens the first time a page is visited. No browser: the component functions are called on a fake React that
// only builds a tree and hands out the state the test seeds.
//   node packages/kybernos-hub/test-help-card.mjs
import { readFileSync } from 'node:fs'
import { charge } from './suite-host.mjs'

const SOURCE = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
let failed = 0
let total = 0
const check = (name, ok, detail) => {
  total += 1
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}

let def
const win = { __ModuleLoader__: { load: (d) => { def = d } }, __KB_LANG_RESOLVE__: () => 'en' }
new Function('window', SOURCE)(win)
const T = def.factory().__test

// A Map-backed localStorage, a throwing one.
const memory = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, removeItem: (k) => { m.delete(k) }, dump: () => Object.fromEntries(m) } }
const broken = () => ({ getItem: () => { throw new Error('SecurityError') }, setItem: () => { throw new Error('QuotaExceededError') }, removeItem: () => { throw new Error('SecurityError') } })

// A fake React: elements are plain objects, useState hands out the values seeded by next() in call order (then the initial value),
// effects and setters are recorded so a test can run one. One fake serves several components: next() starts a fresh render.
const fakeReact = (first = []) => {
  const state = { sets: [], effects: [], seeds: first, call: 0 }
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
    useState: (init) => {
      const i = state.call++
      const value = i < state.seeds.length && state.seeds[i] !== undefined ? state.seeds[i] : (typeof init === 'function' ? init() : init)
      const sets = state.sets
      return [value, (v) => { sets.push([i, v]) }]
    },
    useRef: (v) => ({ current: v }),
    useEffect: (fn, deps) => { state.effects.push({ fn, deps }) },
    useCallback: (f) => f,
  }
  const next = (seeds = []) => { state.seeds = seeds; state.call = 0; state.sets = []; state.effects = [] }
  return { React, state, next }
}
const find = (node, test, out = []) => {
  if (node === null || typeof node !== 'object') return out
  if (test(node)) out.push(node)
  for (const c of node.children || []) find(c, test, out)
  return out
}
const text = (node) => (node === null || node === undefined ? '' : typeof node !== 'object' ? String(node) : (node.children || []).map(text).join(' '))
const attr = (name, value) => (n) => n.props && n.props[name] === value

console.log('the address of an article (adresseAide)')
{
  const A = 'https://help.kybernos.app/{lang}/features/what-is-remote-control/'
  check('{lang} becomes the language of the site: French, English, Arabic, Chinese', T.adresseAide(A, 'kybernos') === 'https://help.kybernos.app/fr/features/what-is-remote-control/' && T.adresseAide(A, 'fr-CA') === 'https://help.kybernos.app/fr/features/what-is-remote-control/' && T.adresseAide(A, 'en') === 'https://help.kybernos.app/en/features/what-is-remote-control/' && T.adresseAide(A, 'ar') === 'https://help.kybernos.app/ar/features/what-is-remote-control/' && T.adresseAide(A, 'zh-CN') === 'https://help.kybernos.app/zh-cn/features/what-is-remote-control/' && T.adresseAide(A, 'zh_Hans') === 'https://help.kybernos.app/zh-cn/features/what-is-remote-control/')
  check('a language the site does not have gets English, never French', T.adresseAide(A, 'es') === 'https://help.kybernos.app/en/features/what-is-remote-control/' && T.adresseAide(A, 'ja') === 'https://help.kybernos.app/en/features/what-is-remote-control/' && T.adresseAide(A, '') === 'https://help.kybernos.app/en/features/what-is-remote-control/')
  check('an address without {lang} comes back as it is', T.adresseAide('https://help.kybernos.app/skills', 'fr') === 'https://help.kybernos.app/skills')
  check('anything that is not an address on the help site is refused, whatever the catalogue says', ['javascript:alert(1)', 'https://evil.example/{lang}/x', 'http://help.kybernos.app/x', 'https://help.kybernos.app.evil.example/x', 'https://help.kybernos.app/x?y=1', 'data:text/html,x', '', null, undefined, 12, {}].every((u) => T.adresseAide(u, 'en') === null))
}

console.log('which edge of the button the card hangs from (coteDeLaCarte)')
{
  const W = 420
  const win = { left: 0, right: 1500 }
  check('a button far from the left edge: the card hangs from its end and runs back toward the page', T.coteDeLaCarte({ left: 1000, right: 1100 }, win, W, false) === 'end')
  check('a button near the left edge of the window: it hangs from its start', T.coteDeLaCarte({ left: 40, right: 140 }, win, W, false) === 'start')
  // The Skills page: the title row starts at x=348, its pill ends at 543, and the sidebar (to 280) clips whatever goes under it.
  check('a button whose card would run under the sidebar that clips it (the page’s own box starts at 280): start, not end', T.coteDeLaCarte({ left: 423, right: 543 }, { left: 280, right: 1500 }, W, false) === 'start')
  check('the same button with room on its left inside the page: end', T.coteDeLaCarte({ left: 900, right: 1020 }, { left: 280, right: 1500 }, W, false) === 'end')
  check('right to left: the card hangs from the end edge (its left side) and runs toward the right', T.coteDeLaCarte({ left: 100, right: 200 }, win, W, true) === 'end' && T.coteDeLaCarte({ left: 1300, right: 1400 }, win, W, true) === 'start')
  check('right to left under a clipping box: start when the end side would leave the box', T.coteDeLaCarte({ left: 1100, right: 1200 }, { left: 0, right: 1300 }, W, true) === 'start')
  check('nothing fits (a narrow box): start, as before', T.coteDeLaCarte({ left: 100, right: 200 }, { left: 90, right: 330 }, W, false) === 'start')
  check('the margin from the window or the box is 16 px, as it was', T.coteDeLaCarte({ left: 400, right: 436 }, win, W, false) === 'end' && T.coteDeLaCarte({ left: 400, right: 435 }, win, W, false) === 'start' && T.coteDeLaCarte({ left: 0, right: 436 }, { left: 0, right: 1500 }, W, false) === 'end')
}

console.log('the card of a page: the link at its foot')
{
  const aide = (extra = {}) => ({ what: { fr: 'Fait une chose.', en: 'Does a thing.' }, steps: [{ fr: 'Un.', en: 'One.' }, { fr: 'Deux.', en: 'Two.' }], where: { fr: 'Ici', en: 'Here', page: true }, ...extra })
  const render = ({ extra = {}, lang = 'en', page, pageCard, replay } = {}) => {
    win.__KB_LANG_RESOLVE__ = () => lang
    const { React } = fakeReact([true, { id: 'kybernos-x', titre: 'Thing', aide: { ...aide(extra), ...(pageCard === undefined ? {} : { pages: { voice: pageCard } }) } }, 'end'])
    const api = T.construireAide(React)
    if (replay !== undefined) replay(api)
    return api.Help({ id: 'kybernos-x', page })
  }
  const link = (tree) => find(tree, attr('data-kb', 'help-link'))
  check('a card with an article shows a link to it, in a new tab, safely', (() => {
    const l = link(render({ extra: { url: 'https://help.kybernos.app/{lang}/features/what-is-remote-control/' } }))
    return l.length === 1 && l[0].type === 'a' && l[0].props.href === 'https://help.kybernos.app/en/features/what-is-remote-control/' && l[0].props.target === '_blank' && /\bnoopener\b/.test(l[0].props.rel) && /\bnoreferrer\b/.test(l[0].props.rel)
  })(), link(render({ extra: { url: 'https://help.kybernos.app/{lang}/features/what-is-remote-control/' } })))
  check('it says what it is, in English and in French, and the address follows the language', (() => {
    const en = link(render({ extra: { url: 'https://help.kybernos.app/{lang}/a/b' } }))[0]
    const fr = link(render({ extra: { url: 'https://help.kybernos.app/{lang}/a/b' }, lang: 'kybernos' }))[0]
    return /Read the article/.test(text(en)) && /Lire l’article/.test(text(fr)) && fr.props.href === 'https://help.kybernos.app/fr/a/b'
  })())
  check('a card without an article shows no link, and nothing else changes', link(render()).length === 0 && find(render(), attr('data-kb', 'help-panel')).length === 1)
  check('an address that is not the help site’s is never drawn (a tampered catalogue)', link(render({ extra: { url: 'javascript:alert(1)' } })).length === 0 && link(render({ extra: { url: 'https://evil.example/{lang}/x' } })).length === 0)
  check('a page card has its own link, not the bundle’s', (() => {
    const l = link(render({ page: 'voice', extra: { url: 'https://help.kybernos.app/{lang}/bundle/one' }, pageCard: { title: { fr: 'Voix', en: 'Voice' }, ...aide({ url: 'https://help.kybernos.app/{lang}/voice/two' }) } }))
    return l.length === 1 && l[0].props.href === 'https://help.kybernos.app/en/voice/two'
  })())
  check('a page card without an article shows none (never the bundle’s article on the wrong page)', link(render({ page: 'voice', extra: { url: 'https://help.kybernos.app/{lang}/bundle/one' }, pageCard: { title: { fr: 'Voix', en: 'Voice' }, ...aide() } })).length === 0)
  check('the card is drawn only open, and the link only inside it', (() => {
    win.__KB_LANG_RESOLVE__ = () => 'en'
    const { React } = fakeReact([false, { id: 'kybernos-x', titre: 'Thing', aide: aide({ url: 'https://help.kybernos.app/{lang}/a/b' }) }, 'end'])
    return find(T.construireAide(React).Help({ id: 'kybernos-x' }), attr('data-kb', 'help-link')).length === 0
  })())
}

console.log('the animated help of a page (Intro)')
{
  const steps = [{ t: 'Pick', b: 'Choose one.' }, { t: 'Install', b: 'One click.' }, { t: 'Use', b: 'Ask for it.' }]
  const mock = { bar: 'Skills', rows: ['Word documents'], hot: 'PDF', states: ['Featured', 'Checking…', 'Installed'], actions: ['Install', 'Checking', 'Use'], done: 'In use' }
  const props = { id: 'kybernos-x', title: 'Skills in three steps', caption: 'A skill is picked, installed, then used.', steps, mock }
  const withStorage = (store, fn) => { const had = win.localStorage; win.localStorage = store; try { return fn() } finally { win.localStorage = had } }
  const KEY = 'kybernos.help.intro.kybernos-x'
  check('the key is per page', T.introKey('kybernos-x') === KEY)
  check('first visit (nothing stored): it opens', T.introOuverte(memory(), KEY) === true)
  check('closed by the person: it stays closed', T.introOuverte(memory({ [KEY]: 'closed' }), KEY) === false)
  check('it was on screen long enough once: it does not come back by itself', T.introOuverte(memory({ [KEY]: 'seen' }), KEY) === false)
  check('another page’s choice does not count', T.introOuverte(memory({ 'kybernos.help.intro.kybernos-y': 'closed' }), KEY) === true)
  check('a storage that throws, or none at all: it opens, nothing breaks', T.introOuverte(broken(), KEY) === true && T.introOuverte(null, KEY) === true && T.introOuverte(undefined, KEY) === true)
  check('a value nobody wrote is not « closed »', T.introOuverte(memory({ [KEY]: 'banana' }), KEY) === true)

  const draw = (seeds, store, p = props) => withStorage(store, () => { const { React, state } = fakeReact(seeds); const api = T.construireAide(React); return { tree: api.Intro(p), state, api } })
  const open = draw([], memory())
  check('opened at the first visit, from the storage', find(open.tree, attr('data-kb', 'help-intro')).length === 1)
  check('one list of steps, numbered, in the page’s own words', (() => { const li = find(open.tree, (n) => n.type === 'li'); return li.length === 3 && /Pick/.test(text(li[0])) && /Ask for it/.test(text(li[2])) })())
  check('the mock is a picture with a caption for the screen reader, and is not read twice', (() => { const m = find(open.tree, attr('role', 'img')); return m.length === 1 && m[0].props['aria-label'] === props.caption })())
  check('the mock carries the words of the page: the bar, the other rows, the hot row, its states, the buttons, the end state', (() => { const t = text(find(open.tree, attr('role', 'img'))[0]); return ['Skills', 'Word documents', 'PDF', 'Featured', 'Checking…', 'Installed', 'Install', 'Checking', 'Use', 'In use'].every((w) => t.includes(w)) })())
  check('the mock says it is an example, so a name in it is never read as a real item of the page (C-05)', (() => {
    const tag = find(open.tree, attr('data-kb', 'help-intro-example'))
    const bar = find(open.tree, (n) => typeof n.props.className === 'string' && n.props.className === 'kbhi-mm-bar')[0]
    return tag.length === 1 && /^(Example|Exemple)$/.test(text(tag[0])) && bar !== undefined && find(bar, attr('data-kb', 'help-intro-example')).length === 1
  })())
  check('the progress bar of the hot row clears the label above it (it was glued to « Installing… »)', (() => {
    const row = /\.kbhi-mm-row\.hot\{([^}]*)\}/.exec(SOURCE)
    const i = /\.kbhi-mm-row\.hot \.kbhi-mm-i\{([^}]*)\}/.exec(SOURCE)
    return row !== null && i !== null && /margin-bottom:\d+px/.test(i[1])
  })())
  check('every step has its own light, in turn (s1, s2, s3)', (() => { const li = find(open.tree, (n) => n.type === 'li'); return li.map((n) => n.props.className).join('|') === 'kbhi-step s1|kbhi-step s2|kbhi-step s3' })())
  check('it can be closed, and says so', (() => { const x = find(open.tree, attr('data-kb', 'help-intro-close')); return x.length === 1 && x[0].type === 'button' && /Close/.test(x[0].props['aria-label']) })())
  check('closing it writes « closed » and hides it', (() => { const store = memory(); const r = draw([], store); withStorage(store, () => find(r.tree, attr('data-kb', 'help-intro-close'))[0].props.onClick()); return store.dump()[KEY] === 'closed' && r.state.sets.some((s) => s[1] === false) })())
  check('closing with a storage that throws still hides it', (() => { const r = draw([], broken()); try { withStorage(broken(), () => find(r.tree, attr('data-kb', 'help-intro-close'))[0].props.onClick()); return r.state.sets.some((s) => s[1] === false) } catch (e) { return false } })())
  check('closed at the start: nothing is drawn', draw([], memory({ [KEY]: 'closed' })).tree === null)
  check('a page that gives other than three steps, or no id, draws nothing (the page is never broken by a bad call)', draw([], memory(), { ...props, steps: [] }).tree === null && draw([], memory(), { ...props, steps: steps.slice(0, 2) }).tree === null && draw([], memory(), { ...props, id: '' }).tree === null && draw([], memory(), { id: 'kybernos-x' }).tree === null)
  check('a mock with only the essentials still draws (no other rows, no end state)', (() => { const t = draw([], memory(), { ...props, mock: { bar: 'Skills', hot: 'PDF', states: ['A', 'B', 'C'], actions: ['x', 'y', 'z'] } }).tree; return t !== null && find(t, attr('role', 'img')).length === 1 })())

  // The timer: once the animation has been on screen for a while, the page is marked as seen, so it does not come back by itself.
  const withTimers = (fn) => { const timers = []; const real = [globalThis.setTimeout, globalThis.clearTimeout]; globalThis.setTimeout = (f, ms) => { timers.push({ f, ms, cleared: false }); return timers.length }; globalThis.clearTimeout = (n) => { if (timers[n - 1]) timers[n - 1].cleared = true }; try { return fn(timers) } finally { [globalThis.setTimeout, globalThis.clearTimeout] = real } }
  const seenEffect = (r) => r.state.effects.filter((e) => Array.isArray(e.deps) && e.deps.length === 1 && e.deps[0] === true)
  check('after being on screen for a while it is marked as seen, once, and the timer is cleaned up', withTimers((timers) => {
    const store = memory(); const r = draw([], store)
    const eff = seenEffect(r)
    let off
    withStorage(store, () => { off = eff[0].fn(); timers[0].f() })
    if (typeof off === 'function') off()
    return eff.length === 1 && timers.length === 1 && timers[0].ms >= 5000 && timers[0].ms <= 12000 && store.dump()[KEY] === 'seen' && timers[0].cleared === true
  }))
  check('a page left before the timer fires is not marked (it was not really seen)', withTimers((timers) => {
    const store = memory(); const r = draw([], store)
    let off
    withStorage(store, () => { off = seenEffect(r)[0].fn() })
    off()
    return store.dump()[KEY] === undefined && timers[0].cleared === true
  }))
  check('« closed » by the person is never overwritten by « seen »', withTimers((timers) => {
    const store = memory({ [KEY]: 'closed' }); const r = draw([true], store)
    withStorage(store, () => { seenEffect(r)[0].fn(); timers[0].f() })
    return store.dump()[KEY] === 'closed'
  }))
  check('closed (state false): no timer at all', withTimers((timers) => { const r = draw([false], memory({ [KEY]: 'closed' })); return r.tree === null && seenEffect(r).length === 0 && timers.length === 0 }))

  console.log('the card brings it back')
  const mod = { id: 'kybernos-x', titre: 'Thing', aide: { what: { fr: 'F', en: 'F' }, steps: [{ fr: 'a', en: 'a' }, { fr: 'b', en: 'b' }], where: { fr: 'x', en: 'x', page: true } } }
  const replayOf = (tree) => find(tree, attr('data-kb', 'help-replay'))
  const hub = () => { const f = fakeReact(); return { ...f, api: T.construireAide(f.React) } }
  check('a page with no animation shows no « watch again » button', (() => { const h = hub(); h.next([true, mod, 'end']); return replayOf(h.api.Help({ id: 'kybernos-x' })).length === 0 })())
  check('a page whose animation is on screen registers it; the card then offers to watch it again, in the page’s language', (() => {
    win.__KB_LANG_RESOLVE__ = () => 'en'
    const h = hub()
    h.next([]); h.api.Intro(props)
    const reg = h.state.effects.find((e) => Array.isArray(e.deps) && e.deps[0] === 'kybernos-x')
    const off = reg.fn()
    h.next([true, mod, 'end'])
    const b = replayOf(h.api.Help({ id: 'kybernos-x' }))
    win.__KB_LANG_RESOLVE__ = () => 'kybernos'
    h.next([true, mod, 'end'])
    const fr = replayOf(h.api.Help({ id: 'kybernos-x' }))
    win.__KB_LANG_RESOLVE__ = () => 'en'
    off()
    h.next([true, mod, 'end'])
    return b.length === 1 && /Watch the animation/.test(text(b[0])) && fr.length === 1 && /Revoir l’animation/.test(text(fr[0])) && replayOf(h.api.Help({ id: 'kybernos-x' })).length === 0
  })())
  check('pressing it opens the animation again (and closes the card)', (() => {
    const h = hub()
    h.next([]); h.api.Intro(props)
    const reg = h.state.effects.find((e) => Array.isArray(e.deps) && e.deps[0] === 'kybernos-x')
    reg.fn()
    const introSets = h.state.sets
    h.next([true, mod, 'end'])
    const b = replayOf(h.api.Help({ id: 'kybernos-x' }))[0]
    const helpSets = h.state.sets
    b.props.onClick()
    return introSets.some((s) => s[1] === true) && helpSets.some((s) => s[1] === false)
  })())
  check('reopening does not erase the choice « closed »: the next visit still starts closed', (() => {
    const store = memory({ [KEY]: 'closed' })
    return withStorage(store, () => { const h = hub(); h.next([false]); h.api.Intro(props); h.state.effects.find((e) => Array.isArray(e.deps) && e.deps[0] === 'kybernos-x').fn(); h.next([true, mod, 'end']); replayOf(h.api.Help({ id: 'kybernos-x' }))[0].props.onClick(); return store.dump()[KEY] === 'closed' })
  })())
}

console.log('a page of DSH itself: the animation on the native Agent presets page')
{
  const FIBER = '__reactFiber$test'
  const node = (attrs = {}) => ({ attrs, inserted: null, getAttribute (n) { return n in this.attrs ? this.attrs[n] : null }, setAttribute (n, v) { this.attrs[n] = v }, insertAdjacentElement (pos, e) { this.inserted = [pos, e]; return e }, insertBefore (e) { this.inserted = ['before-first', e]; return e }, firstChild: null })
  const cell = (key) => Object.assign(node({ 'aria-current': 'true' }), { [FIBER]: { key } })
  // A document that answers the three questions the finder asks, by their selector.
  const docWith = ({ active = null, intro = node(), host = null, section = null, throws = false } = {}) => {
    const made = []
    return { made, querySelector: (sel) => { if (throws) throw new Error('hostile'); return sel === T.NATIVE_SEL.cell ? active : sel === T.NATIVE_SEL.intro ? intro : sel === T.NATIVE_SEL.host ? host : sel === T.NATIVE_SEL.section ? section : null }, createElement: (tag) => { const e = node(); e.tag = tag; made.push(e); return e } }
  }
  const presets = cell('agent-presets')
  check('the page is told by the React key of the open Settings cell, not by its words (it works in every language)', T.nativeKeyOf(presets) === 'agent-presets' && T.nativeKeyOf(node()) === null && T.nativeKeyOf(null) === null)
  const d1 = docWith({ active: presets })
  const got = T.findNativeHost(d1)
  check('on the Agent presets page, a host is made right after its introduction, once', got !== null && got.key === 'agent-presets' && d1.made.length === 1 && d1.made[0].tag === 'div' && d1.made[0].attrs['data-kb'] === 'native-intro-host' && d1.made[0].attrs['data-native'] === 'agent-presets')
  const introNode = d1.querySelector(T.NATIVE_SEL.intro)
  check('…placed after the introduction paragraph, not inside the cards', introNode.inserted !== null && introNode.inserted[0] === 'afterend' && introNode.inserted[1] === got.el)
  const existing = node({ 'data-native': 'agent-presets' })
  const d2 = docWith({ active: presets, host: existing })
  const again = T.findNativeHost(d2)
  check('a second look finds the same host and makes none', again !== null && again.el === existing && d2.made.length === 0)
  check('another page of Settings: nothing', T.findNativeHost(docWith({ active: cell('general') })) === null && T.findNativeHost(docWith({ active: cell('account') })) === null)
  // A-06: the three DSH pages that had no help at all (Models, Appearance, Built-in plugins) get the card of a page of the core
  // bundle, and no animated introduction (none is written for them).
  check('the DSH pages that lack help get their card, and no animation', ['models', 'appearance', 'plugins'].every((key) => { const c = T.nativeContent(key); return c !== null && c.help !== undefined && c.help.id === 'kybernos-plugin' && c.help.page === key && c.intro === undefined }) && T.nativeContent('general') === null)
  check('a DSH page without an introduction paragraph gets the host at the top of its section (Appearance)', (() => { const sec = node(); const d = docWith({ active: cell('appearance'), intro: null, section: sec }); const g = T.findNativeHost(d); return g !== null && g.key === 'appearance' && d.made.length === 1 && sec.inserted !== null && sec.inserted[0] === 'before-first' })())
  check('no open cell, an unreadable key, or no introduction on the page: nothing', T.findNativeHost(docWith({ active: null })) === null && T.findNativeHost(docWith({ active: node() })) === null && T.findNativeHost(docWith({ active: presets, intro: null })) === null)
  check('a page the shell no longer draws like this never throws', T.findNativeHost(docWith({ throws: true })) === null && T.findNativeHost(null) === null && T.findNativeHost(undefined) === null)

  const content = (lang) => { win.__KB_LANG_RESOLVE__ = () => lang; return T.nativeContent('agent-presets') }
  const en = content('en')
  check('the page has its content: the key of its card (a page of the core bundle), three steps, a mock', en !== null && en.help.id === 'kybernos-plugin' && en.help.page === 'presets' && en.intro.id === 'kybernos-plugin-presets' && en.intro.steps.length === 3 && en.intro.mock.states.length === 3 && en.intro.mock.actions.length === 3)
  check('it says what a preset is, and the three things to do: know the modes, create one with the agent, start a task with it', en !== null && /preset/i.test(en.intro.caption) && /modes/i.test(en.intro.steps[0].t) && /Standard/.test(en.intro.steps[0].b) && /agent/i.test(en.intro.steps[1].b) && /task/i.test(en.intro.steps[2].b), en && en.intro.steps)
  check('the mock uses the page’s own mode name', en !== null && /Standard mode/.test(JSON.stringify(en.intro.mock.rows)))
  const fr = content('kybernos')
  check('in French: the same, in French', fr !== null && /trois étapes/.test(fr.intro.title) && /modes/i.test(fr.intro.steps[0].t) && fr.intro.title !== en.intro.title)
  check('a page that is not listed has no content', T.nativeContent('general') === null && T.nativeContent(null) === null)

  // The component: a portal into the host, the shared button and the animation inside.
  const portals = []
  const ReactDOM = { createPortal: (child, el) => { const p = { portal: true, child, el }; portals.push(p); return p } }
  const hubReact = fakeReact()
  const api = T.construireAide(hubReact.React)
  const Natives = T.construireNatifs(hubReact.React, ReactDOM, api)
  const hostEl = node()
  hubReact.next([{ el: hostEl, key: 'agent-presets' }])
  win.__KB_LANG_RESOLVE__ = () => 'en'
  const out = Natives()
  check('with a host, the animation is drawn into it through a portal, with the page’s own « ? How it works » card', out !== null && out.portal === true && out.el === hostEl && find(out.child, (n) => n.type === api.Intro).length === 1 && find(out.child, (n) => n.type === api.Help).length === 1)
  const helpProps = find(out.child, (n) => n.type === api.Help)[0].props
  const introProps = find(out.child, (n) => n.type === api.Intro)[0].props
  check('the button asks for the card « presets » of the core bundle, and the animation is keyed the same way (so the card can bring it back)', helpProps.id === 'kybernos-plugin' && helpProps.page === 'presets' && introProps.id === 'kybernos-plugin-presets')
  hubReact.next([null])
  check('without a host (another page): nothing is drawn', Natives() === null)
  hubReact.next([{ el: hostEl, key: 'general' }])
  check('a host of a page that has no content draws nothing', Natives() === null)
}

console.log('the host shows the shipped card, link included, whatever the signed catalogue says')
{
  // The shipped catalogue as it is, and a copy of it with no link anywhere (what an older release looks like).
  const real = JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url), 'utf8'))
  const strip = (aide) => { const { url, ...rest } = aide; void url; return rest }
  const catalogue = { ...real, modules: real.modules.map((m) => (m.aide === undefined ? m : { ...m, aide: strip(m.aide) })) }
  const shipped = catalogue.modules.find((m) => m.id === 'kybernos-mobile')
  const ARTICLE = 'https://help.kybernos.app/{lang}/features/what-is-remote-control/'
  const ship = { ...catalogue, modules: catalogue.modules.map((m) => (m.id === 'kybernos-mobile' ? { ...m, aide: { ...m.aide, url: ARTICLE } } : m)) }
  const signed = (mut) => ({ ...catalogue, source: 'signe', suite: { version: '9.9.9', plusRecent: false }, modules: catalogue.modules.map(mut) })
  const aideOf = (p) => p.modules.find((m) => m.id === 'kybernos-mobile').aide
  const old = signed((m) => (m.id === 'kybernos-mobile' ? { ...m, aide: { ...shipped.aide, what: { fr: 'Ancien texte.', en: 'An older text.' } } } : m))
  const got = aideOf(charge({ catalogue: ship, brut: null, etatHub: null, effectif: old }))
  check('a signed catalogue written before the links existed: the card is the shipped one, with its link and its text (the help describes the code that runs)', got.url === ARTICLE && got.what.en === shipped.aide.what.en, got)
  const other = signed((m) => (m.id === 'kybernos-mobile' ? { ...m, aide: { ...shipped.aide, url: 'https://help.kybernos.app/{lang}/features/another/' } } : m))
  check('a link in the signed catalogue does not replace the shipped one', aideOf(charge({ catalogue: ship, brut: null, etatHub: null, effectif: other })).url === ARTICLE)
  check('a module with no link anywhere stays without one', aideOf(charge({ catalogue, brut: null, etatHub: null, effectif: old })).url === undefined)
  check('the shipped help alone (no signed catalogue) carries the link as it is', aideOf(charge({ catalogue: ship, brut: null, etatHub: null, effectif: null })).url === ARTICLE)
  check('the catalogue of this checkout ships the links of help.json (Remote Control has its article)', real.modules.find((m) => m.id === 'kybernos-mobile').aide.url === ARTICLE)
}

console.log('the styles')
{
  check('the animation stops under « prefers-reduced-motion » and the end of the story stays on screen', SOURCE.includes("@media (prefers-reduced-motion:reduce){.kbhi-mm *,.kbhi-step{animation:none !important}.kbhi-step{opacity:1}}"))
  check('the mock keeps its left-to-right layout in a right-to-left page (it is a drawing)', /\.kbhi-mm\{[^}]*direction:ltr/.test(SOURCE))
  check('the base style is the end of the story: the last state and the end label show, the others wait for their turn', /\.kbhi-mm-st>\.t3\{opacity:1/.test(SOURCE) && /\.kbhi-mm-done\{[^}]*opacity:1/.test(SOURCE) && /\.kbhi-mm-go,\.kbhi-mm-us\{[^}]*opacity:0/.test(SOURCE))
  // R-A5-03: on a phone the dismiss cross is a 44 px target (it was 26 x 36) and the 9 px decorative mock is left out
  check('on a phone the intro\'s cross is a 44 px target and the drawn mock (9 px text) is not drawn', /@media \(max-width:700px\)\{[^}]*\}\.kbhi-mm\{display:none\}\.kbhi-x\{[^}]*width:44px;height:44px\}/.test(SOURCE))
  // the phone rule only wins if it comes AFTER the base rules it overrides (the first version sat before them and the cross stayed 26 x 36)
  check('the phone rule of the intro comes after the base rules of .kbhi-x, .kbhi-h and .kbhi-mm', (() => { const m = SOURCE.indexOf('@media (max-width:700px){.kbhi{'); return m > SOURCE.indexOf("'.kbhi-x{position:absolute") && m > SOURCE.indexOf("'.kbhi-h{font-size") && m > SOURCE.indexOf("'.kbhi-mm{direction:ltr") && SOURCE.indexOf("'.kbhi-x{position:absolute") > 0 })())
  check('the loop is 12 s, like the Language page’s', /kbhi-k-hot 12s infinite/.test(SOURCE) && /kbhi-k-s3 12s infinite/.test(SOURCE))
  check('the link of the card is drawn as a link (not a second button)', /\.kbhp-link\{/.test(SOURCE) && /\.kbhp-foot\{/.test(SOURCE))
  // A page that styles every button of its own (« .kbwk button », « .kbsl-scope :where(button) », « .kbsu button » set font:inherit) must not
  // resize the pill: its rules come under the wrapper, one class more than any of them (measured: 16 px on Commands, 13.5 px on Workers).
  check('the pill’s rules sit under its wrapper, so a page’s own button rule cannot resize it', /'\.kbhp-wrap \.kbhp-btn\{/.test(SOURCE) && /'\.kbhp-wrap \.kbhp-btn:hover,\.kbhp-wrap \.kbhp-btn\[aria-expanded="true"\]\{/.test(SOURCE) && !/'\.kbhp-btn\{/.test(SOURCE))
}

console.log('\n' + (total - failed) + ' ✓  ' + failed + ' ✗')
process.exit(failed === 0 ? 0 : 1)
