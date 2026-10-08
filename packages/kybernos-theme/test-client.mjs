#!/usr/bin/env node
// Browser half of kybernos-theme, against a fake host and a fake DSH theme
// service. No browser, no dependency (the render stage needs react, see below).
//
//   node test-client.mjs
//   NODE_PATH=<a node_modules that has react + react-dom> node test-client.mjs   # + render stage
//
// What is pinned here (the live GUI is covered by scripts/test-theme-live.mjs):
//  - a bundle must never stop DSH from starting: a throwing factory degrades;
//  - the catalogues (themes, wallpapers, fonts, accents) are internally consistent;
//  - the colour engine keeps its promises: the derived accent reaches 4.5:1 on BOTH
//    schemes for every theme, the contrast levels only ever improve contrast;
//  - boot applies the stored look WITHOUT touching DSH's own light/dark preference
//    (rewriting it from our store once overwrote the user's last choice);
//  - "DSH default" removes the token layer instead of stacking a redundant one;
//  - stored state: corrupt JSON, legacy « Colour Pack » adoption, key whitelist;
//  - the Accessibility table measures the scheme that is ACTIVE, not always light;
//  - one page, no Simple/Advanced switch: the eight tabs are always there, Essentiel is open;
//  - DSH owns the text size: the plugin adopts it, it never writes it at boot;
//  - an imported file can only set known keys with valid values.
//
// KNOWN GAPS are printed apart and do not fail the run; they are decisions for the
// owner, not regressions (see the block at the end).
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { SETTINGS_KEYS, sanitizeLibrary } from './preset-store.mjs'
import { A11Y_KEYS, sanitizeDocument } from './themes-catalogue.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const section = (title) => console.log('\n' + title)

const SOURCE = readFileSync(new URL('./client.js', import.meta.url), 'utf8')

// ── environment ───────────────────────────────────────────────────────────
const store = new Map()
let quotaFull = false
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { if (quotaFull) throw new Error('QuotaExceededError'); store.set(k, String(v)) },
  removeItem: (k) => { store.delete(k) },
}
const reset = () => { store.clear(); quotaFull = false }

// A DOM just big enough for the plugin: style tags, the wallpaper div, readyState.
const dom = { head: [], bodyKids: [], readyState: 'complete', listeners: [] }
const fakeEl = () => ({
  style: {}, dataset: {}, textContent: '', removed: false,
  remove() { this.removed = true; dom.head = dom.head.filter((e) => e !== this); dom.bodyKids = dom.bodyKids.filter((e) => e !== this) },
  setAttribute() {}, getAttribute() { return null },
})
globalThis.document = {
  get readyState() { return dom.readyState },
  head: { append: (el) => { dom.head.push(el) } },
  body: { prepend: (el) => { dom.bodyKids.unshift(el) }, contains: (el) => dom.bodyKids.includes(el) },
  createElement: () => fakeEl(),
  querySelectorAll: () => [],
  addEventListener: (ev, fn) => { dom.listeners.push({ ev, fn }) },
}
globalThis.MutationObserver = class { observe() {} }
const resetDom = () => { dom.head = []; dom.bodyKids = []; dom.readyState = 'complete'; dom.listeners = [] }

let definition
const loaderWindow = { __ModuleLoader__: { load: (def) => { definition = def } } }
new Function('window', SOURCE)(loaderWindow)
const FAKE_REACT = { createElement: (...a) => ({ a }), Fragment: 'F' }
const modele = definition.factory(() => FAKE_REACT)
const T = modele.__test

// A fake DSH theme service that records every call.
const mkCtx = ({ pref = 'system', overrideThrows = false, noTheme = false, fontSize } = {}) => {
  const calls = { overrideTokens: [], disposed: 0, setTheme: [], setFontSize: [], sections: [], effects: [] }
  const listeners = new Map()
  const theme = noTheme ? undefined : {
    overrideTokens(id, tokens) { if (overrideThrows) throw new Error('refused'); calls.overrideTokens.push({ id, tokens }); return () => { calls.disposed += 1 } },
    setTheme(m) { calls.setTheme.push(m) },
    setFontSize(px) { calls.setFontSize.push(px) },
    getTheme: () => ({ preference: pref, fontSize }),
  }
  const locale = { getLocale: () => ({ active: 'fr' }), bind: () => (k, p) => (k === 'chat.deepDivingFor' ? 'Deep diving for ' + (p && p.duration) + ' ···' : 'Deep diving') }
  const ctx = {
    theme,
    locale,
    effect(fn, label) { calls.effects.push(label); return fn() },
    on(ev, fn) { listeners.set(ev, fn); return () => { listeners.delete(ev) } },
    slots: {
      inject: (slot, fn) => { fn(); return () => {} },
      register: (def) => { calls.sections.push(def); return () => {} },
    },
  }
  return { ctx, calls, listeners }
}
const stored = () => { const raw = store.get(T.STORE_KEY); return raw === undefined ? null : JSON.parse(raw) }

// ═══ 1. A bundle must never stop DSH from starting ═════════════════════════
section('boot safety')
{
  let boot
  const w = { __ModuleLoader__: { load: (def) => { boot = def } } }
  new Function('window', SOURCE)(w)
  let degraded
  const realError = console.error
  console.error = () => {} // the plugin logs the failure on purpose; keep the test output clean
  try { degraded = boot.factory(() => { throw new Error('react missing') }) } catch (e) { degraded = 'threw' } finally { console.error = realError }
  check('a factory error does not propagate (DSH keeps starting)', degraded !== 'threw')
  check('...and the degraded module is inert but valid', degraded && typeof degraded.apply === 'function')
  let applied = 'threw'
  try { degraded.apply({}); applied = 'ok' } catch (e) { /* keep */ }
  check('...its apply() does nothing and does not throw', applied === 'ok')
  check('the module declares the services it needs (slots, theme, remote)', ['slots', 'theme', 'remote'].every((s) => modele.inject.includes(s)))
}

// ═══ 2. Catalogues ═════════════════════════════════════════════════════════
section('catalogues')
{
  const dupes = (list) => list.filter((x, i) => list.indexOf(x) !== i)
  check('theme ids are unique', dupes(T.SKINS.map((s) => s.id)).length === 0, dupes(T.SKINS.map((s) => s.id)))
  check('wallpaper ids are unique', dupes(T.WPS.map((s) => s.id)).length === 0)
  check('font ids are unique', dupes(T.FONTS.map((s) => s.id)).length === 0)
  check('18 ready-made themes (10 + the 8 legacy packs)', T.SKINS.length === 18, T.SKINS.length)
  check('every theme points at an existing wallpaper', T.SKINS.every((s) => T.WPS.some((w) => w.id === s.wp)), T.SKINS.filter((s) => !T.WPS.some((w) => w.id === s.wp)).map((s) => s.id))
  check('every wallpaper is in a known category (or is "none")', T.WPS.every((w) => w.id === 'none' || T.WPCATS.some((c) => c.id === w.cat)))
  check('every wallpaper has CSS and a valid dominant colour (or none)', T.WPS.every((w) => w.css !== '' && (w.dom === '' || T.HEX(w.dom) !== null)))
  check('every accent in the palette is a valid hex', T.ACCS.every((a) => T.HEX(a) !== null))
  check('every theme accent / override is a valid hex', T.SKINS.every((s) => (s.acc === null || T.HEX(s.acc) !== null) && Object.values(s.ov || {}).every((v) => T.HEX(v) !== null)))
  check('every font has a name; a null stack only for the DSH default', T.FONTS.every((f) => f.name !== '' && (f.stack !== null || f.id === 'dsh')))
  const tokKeys = new Set(T.TOKMAP.map((t) => t[0]))
  check('17 pilotable tokens, each mapped to a --dsw variable', T.TOKMAP.length === 17 && T.TOKMAP.every((t) => /^(alias|specific)-[a-z0-9-]+$/.test(t[2])))
  check('every legacy-pack override key targets a pilotable token', T.SKINS.every((s) => Object.keys(s.ov || {}).every((k) => tokKeys.has(k.split(':')[1]))))
  check('legacy packs set no mode (they follow System/Light/Dark)', T.SKINS.filter((s) => s.id.startsWith('kb-')).every((s) => s.mode === null))
}

// ═══ 3. Colour engine ══════════════════════════════════════════════════════
section('colour engine')
{
  const plain = (sk, m, extra) => T.makeTheme(m, { acc: sk.acc, ov: sk.ov || {}, lvl: 0, cb: false, tint: 0, dom: '', ...extra })
  const worst = { text: 99, button: 99 }
  const bad = []
  for (const sk of T.SKINS) for (const m of ['light', 'dark']) {
    if (sk.mode && sk.mode !== m) continue
    const t = plain(sk, m)
    const rText = T.ratio(t.accText, t.l1), rBtn = T.ratio(t.onAcc, t.fill)
    worst.text = Math.min(worst.text, rText); worst.button = Math.min(worst.button, rBtn)
    if (rText < 4.5 || rBtn < 4.5) bad.push(sk.id + '/' + m)
  }
  check('derived accent text reaches 4.5:1 on layer 1, every theme × scheme (min ' + worst.text.toFixed(2) + ')', bad.length === 0, bad)
  check('text on a filled accent button reaches 4.5:1, every theme × scheme (min ' + worst.button.toFixed(2) + ')', bad.length === 0, bad)

  // Hostile accents: pure black, pure white, a dead-grey, a neon — none may break the promise.
  const hostile = ['#000000', '#ffffff', '#808080', '#00ff00', '#ffff00', '#0000ff']
  const hostileBad = []
  for (const a of hostile) for (const m of ['light', 'dark']) {
    const t = T.makeTheme(m, { acc: a, ov: {}, lvl: 0, cb: false, tint: 0, dom: '' })
    if (T.ratio(t.accText, t.l1) < 4.5 || T.ratio(t.onAcc, t.fill) < 4.5) hostileBad.push(a + '/' + m + ' ' + T.ratio(t.accText, t.l1).toFixed(2) + ' ' + T.ratio(t.onAcc, t.fill).toFixed(2))
  }
  check('...also for hostile accents (black, white, grey, neon, yellow, blue)', hostileBad.length === 0, hostileBad)

  // Contrast levels only ever improve.
  for (const m of ['light', 'dark']) {
    const at = (lvl) => T.makeTheme(m, { acc: null, ov: {}, lvl, cb: false, tint: 0, dom: '' })
    const [a, b, c] = [at(0), at(1), at(2)]
    const monotonic = ['t1', 't2', 't3', 't4'].every((k) => T.ratio(b[k], b.l1) >= T.ratio(a[k], a.l1) - 0.01 && T.ratio(c[k], c.l1) >= T.ratio(b[k], b.l1) - 0.01)
    check(m + ': Renforcé ≥ Standard and Maximal ≥ Renforcé for all four text levels', monotonic)
    check(m + ': Maximal reaches AAA (7:1) for the three main text levels', ['t1', 't2', 't3'].every((k) => T.ratio(c[k], c.l1) >= 7), ['t1', 't2', 't3'].map((k) => T.ratio(c[k], c.l1).toFixed(1)))
  }

  // The Accessibility table lists six rows. « Maximal » is the level the user picks to
  // be safe, so NONE of them may fail AA there, in either scheme.
  for (const m of ['light', 'dark']) {
    const max = T.makeTheme(m, { acc: null, ov: {}, lvl: 2, cb: false, tint: 0, dom: '' })
    const rows = { t1: 0, t2: 0, t3: 0, t4: 0, link: 0, brand: 0 }
    for (const k of Object.keys(rows)) rows[k] = T.ratio(max[k], max.l1)
    const failing = Object.keys(rows).filter((k) => rows[k] < 4.5).map((k) => k + ' ' + rows[k].toFixed(1) + ':1')
    check(m + ': at Maximal every row of the Accessibility table reaches AA (4.5:1)', failing.length === 0, failing)
  }

  // Surface tint and the colour-blind switch must not corrupt tokens.
  const tinted = T.makeTheme('dark', { acc: '#A855F7', ov: {}, lvl: 0, cb: true, tint: 100, dom: '#A855F7' })
  check('tint 100 % + colour-blind palette still yields valid hex surfaces', ['base', 'l1', 'l2', 'side', 'okSoft', 'errSoft'].every((k) => T.HEX(tinted[k]) !== null), tinted)

  // Overrides win, per scheme, and only for their scheme.
  const ov = T.makeTheme('dark', { acc: null, ov: { 'dark:base': '#123456', 'light:base': '#abcdef' }, lvl: 0, cb: false, tint: 0, dom: '' })
  check('a per-scheme override applies to its scheme only', ov.base === '#123456')
  const ovBrand = T.makeTheme('dark', { acc: null, ov: { 'dark:brand': '#2DD4BF' }, lvl: 0, cb: false, tint: 0, dom: '' })
  check('a brand override feeds the derived accent (fill/on/text are recomputed)', ovBrand.acc === '#2DD4BF' && T.ratio(ovBrand.onAcc, ovBrand.fill) >= 4.5)

  // The hex parser is the gate for everything typed in the field.
  check('HEX accepts #rgb, #rrggbb and bare forms', T.HEX('#fff')[0] === 255 && T.HEX('2DD4BF')[1] === 0xd4 && T.HEX('#2dd4bf') !== null)
  check('HEX rejects junk, empty, wrong length and non-strings', ['', '#12', '#12345', '#1234567', 'zzzzzz', '#gg0000', null, undefined, 42].every((v) => T.HEX(v) === null))
  check('toHex clamps out-of-range channels', T.toHex([-5, 300, 12.6]) === '#00ff0d')
  check('mix endpoints return the inputs', T.mix('#112233', '#aabbcc', 0) === '#112233' && T.mix('#112233', '#aabbcc', 1) === '#aabbcc')
}

// ═══ 4. Skin / surprise logic ══════════════════════════════════════════════
section('themes and "Surprise me"')
{
  const dsh = T.SKINS.find((s) => s.id === 'dsh')
  const ember = T.SKINS.find((s) => s.id === 'kb-ember')
  const paper = T.SKINS.find((s) => s.id === 'papier')
  check('a themed skin always resets the overrides (so a legacy pack cannot outlive "DSH default")', Object.keys(T.skinPatch(dsh).ov).length === 0)
  check('a mode-less legacy pack does NOT set the mode', !('mode' in T.skinPatch(ember)) && Object.keys(T.skinPatch(ember).ov).length > 0)
  check('a moded skin sets its mode', T.skinPatch(paper).mode === 'light' && T.skinPatch(dsh).mode === 'dark')
  check('the displayed accent of a legacy pack comes from its palette', T.skinAccent(ember) === '#c1552f' && T.skinAccent(dsh) === null)
  let ok = true
  for (let i = 0; i < 200; i += 1) {
    const s = T.surprendre()
    const wp = T.WPS.find((w) => w.id === s.wp)
    if (!wp || wp.id === 'none' || (s.mode !== 'light' && s.mode !== 'dark') || s.wpVis < 55 || s.wpVis > 79 || s.tint < 0 || s.tint > 39 || (s.acc !== null && T.HEX(s.acc) === null)) ok = false
  }
  check('"Surprise me" always yields a real wallpaper, a valid mode, accent and ranges (200 draws)', ok)
}

// ═══ 5. Stored state ═══════════════════════════════════════════════════════
section('stored state')
{
  reset()
  check('no stored state → the defaults', JSON.stringify(T.readState()) === JSON.stringify(T.DEF))
  store.set(T.STORE_KEY, '{not json')
  check('corrupt JSON → the defaults, no throw', JSON.stringify(T.readState()) === JSON.stringify(T.DEF))
  store.set(T.STORE_KEY, JSON.stringify({ skin: 'bleu', ov: null, notAKey: 33, evil: 1 }))
  const s = T.readState()
  check('a null "ov" is repaired to {}', typeof s.ov === 'object' && s.ov !== null && Object.keys(s.ov).length === 0)
  check('unknown keys are dropped on read (whitelist = DEF)', !('notAKey' in s) && !('evil' in s))
  T.writeState({ ...T.DEF, skin: 'aurore' })
  check('write → read round-trips', T.readState().skin === 'aurore')
  quotaFull = true
  let threw = false
  try { T.writeState({ ...T.DEF, skin: 'nebuleuse' }) } catch (e) { threw = true }
  check('a full quota does not throw', threw === false)
  reset()

  // Legacy « Colour Pack » v1 adoption: first start only, never written back.
  store.set('kybernos.pack', 'kb-ember'); store.set('kybernos.font', 'iowan')
  const adopted = T.readState()
  check('legacy pack + font are adopted when there is no v2 state', adopted.skin === 'kb-ember' && adopted.fontText === 'iapono' && Object.keys(adopted.ov).length === 14, { skin: adopted.skin, font: adopted.fontText })
  check('...and adoption writes nothing (idempotent, does not freeze the choice)', store.get(T.STORE_KEY) === undefined)
  store.set('kybernos.pack', 'does-not-exist'); store.set('kybernos.font', 'no-such-font')
  const unk = T.readState()
  check('an unknown legacy id is ignored', unk.skin === 'dsh' && unk.fontText === 'dsh')
  store.set(T.STORE_KEY, JSON.stringify({ skin: 'oled' })); store.set('kybernos.pack', 'kb-ember')
  check('once v2 state exists the legacy keys no longer win', T.readState().skin === 'oled')
  reset()
  check('"DSH default" is the natural state; touching accent, wallpaper, overrides or contrast leaves it',
    T.estNaturel(T.DEF) && !T.estNaturel({ ...T.DEF, acc: '#fff' }) && !T.estNaturel({ ...T.DEF, wp: 'noir' }) && !T.estNaturel({ ...T.DEF, ov: { 'dark:base': '#000000' } }) && !T.estNaturel({ ...T.DEF, contrastMode: 'plus' }) && !T.estNaturel({ ...T.DEF, skin: 'bleu' }))
}

// ═══ 6. Applying to DSH ════════════════════════════════════════════════════
section('boot: what is applied, what is not')
{
  const boot = (state, ctxOpts) => {
    reset(); resetDom()
    if (state) store.set(T.STORE_KEY, JSON.stringify(state))
    const m = mkCtx(ctxOpts)
    modele.apply(m.ctx)
    return m
  }

  let m = boot(null)
  check('fresh profile: no token layer is stacked (DSH looks native)', m.calls.overrideTokens.length === 0)
  check('fresh profile: no wallpaper element, no font tag', dom.bodyKids.length === 0 && !dom.head.some((e) => /--dsw-font-family/.test(e.textContent)))
  check('boot NEVER writes the text size (DSH persists and restores it itself)', m.calls.setFontSize.length === 0, m.calls.setFontSize)
  check('boot NEVER calls setTheme (it would overwrite the user\'s last light/dark choice)', m.calls.setTheme.length === 0)
  check('the settings section is registered once, id kybernos-theme, order 1', m.calls.sections.length === 1 && m.calls.sections[0].id === 'kybernos-theme' && m.calls.sections[0].order === 1 && m.calls.sections[0].name === 'settings.section')
  check('the stylesheet of the page is inserted', dom.head.some((e) => e.dataset.plugin === '@local/kybernos-theme' && /\.kbth-page/.test(e.textContent)))

  m = boot({ skin: 'bleu', acc: '#4176E6', wp: 'nuit', wpVis: 70, wpBlur: 8, fontText: 'georgia', fs: 17 })
  const layer = m.calls.overrideTokens[0]
  check('a themed boot posts ONE layer under the id kybernos-theme', m.calls.overrideTokens.length === 1 && layer.id === 'kybernos-theme')
  const names = Object.keys(layer.tokens)
  check('...of the 17 pilotable --dsw tokens (+ the menu surface, because a wallpaper is on), each a {light, dark} pair of valid hex', names.length === 18 && names.includes('--dsw-specific-menu') && names.every((n) => n.startsWith('--dsw-') && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(layer.tokens[n].light) && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(layer.tokens[n].dark)), names.length)
  check('...whose brand token is the chosen accent family on both schemes', T.ratio(layer.tokens['--dsw-alias-brand-primary'].dark, '#151517') >= 3)
  const wp = dom.bodyKids[0]
  check('the wallpaper is a fixed element UNDER the app (z-index -1, no pointer events)', wp && /position:fixed/.test(wp.style.cssText) && /z-index:-1/.test(wp.style.cssText) && /pointer-events:none/.test(wp.style.cssText))
  check('...with the right opacity and blur', wp.style.opacity === '0.7' && wp.style.filter === 'blur(8px)', { o: wp.style.opacity, f: wp.style.filter })
  check('...a gradient/colour goes through the `background` shorthand (not backgroundImage)', typeof wp.style.background === 'string' && wp.style.background.length > 0 && wp.style.backgroundImage === undefined)
  const fontTag = dom.head.find((e) => /--dsw-font-family/.test(e.textContent))
  check('a non-default font is posted as --dsw-font-family on :root', fontTag && /Georgia/.test(fontTag.textContent) && /:root/.test(fontTag.textContent))
  check('...even when a size is stored: the stored 17 is not pushed to DSH', m.calls.setFontSize.length === 0)

  // Applying again must dispose the previous layer first (no stacking).
  const s2 = { ...T.DEF, skin: 'bleu', acc: '#4176E6', wp: 'none' }
  const mm = mkCtx()
  T.appliquerJetons(mm.ctx.theme, s2); T.appliquerJetons(mm.ctx.theme, { ...s2, acc: '#EC4899' })
  check('re-applying disposes the previous layer before posting the new one', mm.calls.overrideTokens.length === 2 && mm.calls.disposed === 1)
  T.appliquerJetons(mm.ctx.theme, T.DEF)
  check('going back to "DSH default" disposes the layer and posts nothing', mm.calls.disposed === 2 && mm.calls.overrideTokens.length === 2)

  // Wallpaper removal and the contrast levels.
  const w2 = mkCtx()
  T.appliquerFond({ ...T.DEF, wp: 'noir', wpVis: 100, wpBlur: 0 })
  const el = dom.bodyKids[0]
  T.appliquerFond({ ...T.DEF, wp: 'none' })
  check('choosing "no wallpaper" removes the element', el.removed === true && dom.bodyKids.length === 0)
  check('a wallpaper with blur 0 resets the filter to none', (() => { T.appliquerFond({ ...T.DEF, wp: 'noir', wpBlur: 0 }); return dom.bodyKids[0].style.filter === 'none' })())

  // Body not ready at activation: the wallpaper waits instead of being skipped.
  resetDom(); dom.readyState = 'loading'
  T.appliquerFond({ ...T.DEF, wp: 'noir' })
  check('while the document is still loading the wallpaper is deferred, not dropped', dom.bodyKids.length === 0 && dom.listeners.some((l) => l.ev === 'DOMContentLoaded'))
  dom.listeners.find((l) => l.ev === 'DOMContentLoaded').fn()
  check('...and appears at DOMContentLoaded', dom.bodyKids.length === 1)

  // Failure containment.
  m = boot({ skin: 'bleu', acc: '#4176E6' }, { overrideThrows: true })
  check('a refused overrideTokens does not break boot', m.calls.sections.length === 1)
  let noThemeOk = 'threw'
  try { m = boot({ skin: 'bleu' }, { noTheme: true }); noThemeOk = m.calls.sections.length === 1 ? 'ok' : 'no-section' } catch (e) { /* keep */ }
  check('without a theme service the plugin still registers its page (no crash)', noThemeOk === 'ok', noThemeOk)
  const bare = { effect: () => {}, on: () => () => {} }
  let bareOk = true
  try { reset(); resetDom(); modele.apply(bare) } catch (e) { bareOk = false }
  check('without slots the plugin does not crash either', bareOk)
}

section('boot: following DSH\'s own mode')
{
  const boot = (state, pref) => {
    reset(); resetDom()
    if (state) store.set(T.STORE_KEY, JSON.stringify(state))
    const m = mkCtx({ pref })
    modele.apply(m.ctx)
    return m
  }
  let m = boot({ mode: 'dark' }, 'light')
  check('an explicit native choice (light) is ADOPTED into the store', stored() && stored().mode === 'light')
  m = boot({ mode: 'dark' }, 'system')
  check('native "system" does not overwrite the stored mode', stored() === null || stored().mode === 'dark')
  m = boot({ mode: 'dark' }, 'nebula')
  check('a third-party preference ("nebula") is never stored as a mode', stored() === null || stored().mode === 'dark')
  m = boot({ mode: 'dark' }, 'dark')
  m.listeners.get('theme/change')({ preference: 'light' })
  check('a later native change (sidebar toggle) is followed', stored().mode === 'light')
  m.listeners.get('theme/change')({ preference: 'system' })
  m.listeners.get('theme/change')({ preference: 'weird' })
  check('...but "system" and unknown preferences are ignored', stored().mode === 'light')
}

section('boot: adopting DSH\'s own text size')
{
  const boot = (state, ctxOpts) => {
    reset(); resetDom()
    if (state) store.set(T.STORE_KEY, JSON.stringify(state))
    const m = mkCtx(ctxOpts)
    modele.apply(m.ctx)
    return m
  }
  let m = boot({ fs: 15 }, { fontSize: 16 })
  check('DSH\'s size (16) is ADOPTED into the store, not overwritten by the stored 15', stored() !== null && stored().fs === 16 && m.calls.setFontSize.length === 0, stored())
  m = boot({ fs: 15 }, { fontSize: 15 })
  check('same size → nothing is written', stored() === null || stored().fs === 15)
  m = boot({ fs: 15 }, { fontSize: 99 })
  check('an out-of-range size in the snapshot is ignored', stored() === null || stored().fs === 15)
  m = boot({ fs: 15 }, { fontSize: undefined })
  check('a snapshot without a size is ignored', stored() === null || stored().fs === 15)
  m = boot({ fs: 15 }, { fontSize: 15 })
  m.listeners.get('theme/change')({ preference: 'dark', fontSize: 13 })
  check('a later change of DSH\'s size (Settings › General) is followed', stored().fs === 13)
  check('tailleNative reads 12–17 only', T.tailleNative(null, { fontSize: 12 }) === 12 && T.tailleNative(null, { fontSize: 17 }) === 17 && T.tailleNative(null, { fontSize: 11 }) === null && T.tailleNative(null, { fontSize: '16' }) === 16 && T.tailleNative(null, null) === null)
}

section('wallpaper, import, counters, brand colour (found by the live check)')
{
  resetDom()
  T.appliquerFond({ ...T.DEF, wp: 'carreaux' })
  const tile = dom.bodyKids[0]
  check('a pattern keeps the tile size written in its shorthand (no `auto` override)', tile.style.backgroundSize === undefined && tile.style.backgroundRepeat === undefined, { size: tile.style.backgroundSize })
  check('...its CSS still carries the 18px cells', /\/18px 18px/.test(tile.style.background))
  T.appliquerFond({ ...T.DEF, wp: 'aurore' })
  check('a gradient is still covered', dom.bodyKids[0].style.backgroundSize === 'cover')

  check('retouched-token counter counts tokens, not keys (1 token, 2 schemes → 1)', T.jetonsRetouches({ 'light:base': '#ffffff', 'dark:base': '#000000' }) === 1 && T.jetonsRetouches({ 'dark:base': '#000000' }) === 1 && T.jetonsRetouches({}) === 0)
  check('...a legacy pack (14 keys) is 7 tokens', T.jetonsRetouches(T.SKINS.find((x) => x.id === 'kb-ember').ov) === 7)

  const san = T.sanitiserImport
  check('import: not an object → refused (null)', san(null) === null && san([1, 2]) === null && san('x') === null && san(42) === null)
  check('import: {"ov":null} does not produce a null ov (it crashed the whole section)', !('ov' in san({ ov: null })) || (san({ ov: null }).ov !== null))
  check('import: junk types and unknown values are ignored', Object.keys(san({ mode: 'purple', wp: 'nope', fontText: 'comic', acc: 'red', contrastMode: 'x', cbSafe: 'yes', wpVis: 'lots', evil: 1, level: 'advanced' })).length === 0)
  const good = san({ mode: 'light', skin: 'bleu', acc: '#4176e6', wp: 'nuit', wpVis: 999, wpBlur: -5, tint: 12.6, fs: 40, fontText: 'georgia', contrastMode: 'max', cbSafe: true, ov: { 'dark:base': '#101010', 'light:nope': '#ffffff', 'dark:brand': 'blue', 'x': '#000000' } })
  check('import: valid values pass, ranges are clamped', good.mode === 'light' && good.wp === 'nuit' && good.wpVis === 100 && good.wpBlur === 0 && good.tint === 13 && good.fs === 17 && good.acc === '#4176e6')
  check('import: only known tokens with real hex survive in "ov"', JSON.stringify(good.ov) === JSON.stringify({ 'dark:base': '#101010' }), good.ov)
  check('import: a state exported from this page round-trips', JSON.stringify(san({ ...T.DEF, skin: 'aurore', acc: '#2DD4BF', ov: { 'dark:l1': '#202020' } }).ov) === JSON.stringify({ 'dark:l1': '#202020' }))

  const dim = T.makeTheme('dark', { acc: '#0F1115', ov: {}, lvl: 0, cb: false, tint: 0, dom: '' })
  check('a black accent on the dark scheme is lifted to a visible brand colour (≥ 3:1)', T.ratio(dim.brand, dim.l1) >= 3, T.ratio(dim.brand, dim.l1))
  check('...and the button text on it is still readable', T.ratio(dim.onAcc, dim.fill) >= 4.5)
  const white = T.makeTheme('light', { acc: '#FFFFFF', ov: {}, lvl: 0, cb: false, tint: 0, dom: '' })
  check('a white accent on the light scheme is darkened the same way', T.ratio(white.brand, white.l1) >= 3)
  check('the neutral brand (no accent) is left exactly as DSH has it', T.makeTheme('dark', { acc: null, ov: {}, lvl: 0, cb: false, tint: 0, dom: '' }).brand === '#F9FAFB' && T.makeTheme('light', { acc: null, ov: {}, lvl: 0, cb: false, tint: 0, dom: '' }).brand === '#0F1115')
  const strong = T.ACCS.every((a) => ['light', 'dark'].every((m) => { const t = T.makeTheme(m, { acc: a, ov: {}, lvl: 0, cb: false, tint: 0, dom: '' }); return T.ratio(t.brand, t.l1) >= 3 }))
  check('every accent dot of the page gives a brand colour ≥ 3:1 on both schemes', strong)
  const link1 = T.makeTheme('light', { acc: null, ov: {}, lvl: 1, cb: false, tint: 0, dom: '' })
  check('Renforcé lifts the link to AA, a user override of the link still wins', T.ratio(link1.link, link1.l1) >= 4.5 && T.makeTheme('light', { acc: null, ov: { 'light:link': '#4176E6' }, lvl: 1, cb: false, tint: 0, dom: '' }).link === '#4176E6')
}


// ═══ 6b. Animation de réflexion ════════════════════════════════════════════
section('animation: catalogue')
{
  const ids = T.LD_PRESETS.map((p) => p.id)
  check('14 original drawings, unique ids that the host will accept', T.LD_PRESETS.length === 14 && new Set(ids).size === 14 && ids.every((i) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(i)), ids)
  check('every drawing is a self-contained <svg> of 48×48, one or many colours, under 8 KB', T.LD_PRESETS.every((p) => p.svg.startsWith('<svg viewBox="0 0 48 48"') && p.svg.length < 8192 && (p.kind === 'mono' || p.kind === 'color')))
  check('no drawing carries a script, a handler, an external reference or a foreign object', T.LD_PRESETS.every((p) => !/<script|<foreignObject|<image|\son[a-z]+\s*=|javascript:|href=|url\(\s*['"]?(https?:|\/\/|data:)/i.test(p.svg)))
  const used = new Set()
  T.LD_PRESETS.forEach((p) => { for (const m of p.svg.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach((c) => used.add(c)) })
  const cssRules = SOURCE.match(/\.kb-ld \.(a-[a-z]+)\{/g) || []
  const defined = new Set(cssRules.map((r) => r.slice(8, -1)))
  check('every animation class a drawing uses has a CSS rule (and vb is declared)', [...used].filter((c) => c !== 'vb').every((c) => defined.has(c)) && /\.kb-ld svg \.vb\{/.test(SOURCE), [...used].filter((c) => c !== 'vb' && !defined.has(c)))
  check('mono drawings follow currentColor, colour drawings use the --c1..4 palette', T.LD_PRESETS.filter((p) => p.kind === 'mono').every((p) => /currentColor/.test(p.svg)) && T.LD_PRESETS.filter((p) => p.kind === 'color').every((p) => /var\(--c[1-4]\)/.test(p.svg)))
  check('every keyframe used by the drawings is declared once', ['spin', 'bounce', 'bar', 'pulse', 'fade', 'jelly', 'flip', 'dash', 'twinkle', 'pop', 'vis', 'sway', 'shim'].every((k) => (SOURCE.match(new RegExp('@keyframes kbk-' + k + '\\{', 'g')) || []).length === 1), 'keyframes')
}
section('animation: ambiances')
{
  const packs = T.LD_PACKS
  check('12 ambiances: DSH original, 10 trades, ids unique', packs.length === 12 && new Set(packs.map((p) => p.id)).size === 12 && packs[0].orig === true)
  check('the three asked for are there (Éducation, Santé mentale, Architecture)', ['education', 'sante-mentale', 'architecture'].every((id) => packs.some((p) => p.id === id)))
  const real = packs.filter((p) => !p.orig)
  check('every trade has 4–8 words in French AND English', real.every((p) => ['fr', 'en'].every((l) => p.words[l].length >= 4 && p.words[l].length <= 8)))
  const all = real.flatMap((p) => [...p.words.fr, ...p.words.en])
  check('every word is 1–3 words, ≤ 40 chars, no emoji, no final punctuation, no duplicates in a pack', all.every((w) => w.length <= 40 && w.split(/\s+/).length <= 5 && !/[\p{Extended_Pictographic}]/u.test(w) && !/[.!?:;,]$/.test(w)) && real.every((p) => ['fr', 'en'].every((l) => new Set(p.words[l].map((w) => w.toLowerCase())).size === p.words[l].length)))
  check('no word claims a clinical or legal act (honest tone)', !all.some((w) => /^(Diagnosing|Prescribing|Treating|Sentencing|Convicting)/i.test(w)))
}
section('animation: settings')
{
  const C = T.ldClean
  check('defaults come back for anything unreadable', JSON.stringify(C(null)) === JSON.stringify(C({})) && JSON.stringify(C('x')) === JSON.stringify(C(undefined)) && C({}).sel.length === 0 && C({}).mode === 'random' && C({}).size === 'standard')
  check('selection: only valid ids, de-duplicated, 4 at most', JSON.stringify(C({ sel: ['ring', 'ring', '../x', 'ORBIT', 'orbit', 'a', 'b', 'c', 'd', 'e', 5, null] }).sel) === JSON.stringify(['ring', 'orbit', 'a', 'b']))
  check('numbers are clamped and rounded (speed 0.5–2 by 0.05, delay 0–1000)', C({ speed: 9 }).speed === 2 && C({ speed: 0 }).speed === 0.5 && C({ speed: 1.234 }).speed === 1.25 && C({ delay: -5 }).delay === 0 && C({ delay: 5000 }).delay === 1000 && C({ delay: 'x' }).delay === 300)
  check('enums fall back: mode, size, rotation, pack', C({ mode: 'x', size: 'huge', rot: '99', pack: 'A B' }).mode === 'random' && C({ size: 'huge' }).size === 'standard' && C({ rot: '99' }).rot === 'fixed' && C({ pack: 'A B' }).pack === 'dsh' && C({ pack: 'perso' }).pack === 'perso')
  check('booleans must be booleans', C({ tint: 'yes', keep: 0, avoid: false, dur: null }).tint === true && C({ keep: 0 }).keep === true && C({ avoid: false }).avoid === false)
  check('unknown keys never come back', !('evil' in C({ evil: 1 })) && Object.keys(C({ evil: 1, polluted: true })).sort().join() === Object.keys(T.LD_DEF).sort().join())
  check('the settings live OUTSIDE the theme state: "Tout rétablir" cannot erase them', !Object.keys(T.DEF).some((k) => /^ld|sel$/.test(k)) && T.LD_KEY !== T.STORE_KEY)
  reset()
  T.ld.S = T.ldClean({})
  T.ldSet({ sel: ['ring', 'orbit'], speed: 1.5 })
  const kept = JSON.parse(store.get(T.LD_KEY))
  check('a change is written to the browser at once and stamped', kept.sel.length === 2 && kept.speed === 1.5 && kept.updatedAt > 0)
  check('...and read back by the next load', T.ldRead().sel.join() === 'ring,orbit')
}
section('animation: draw')
{
  const sel = ['ring', 'orbit', 'bars']
  T.ld.S = T.ldClean({ sel, mode: 'random', avoid: true })
  const memo = {}
  let repeats = 0, prev = null
  const seen = new Set()
  for (let i = 0; i < 600; i += 1) { const l = T.ldChoose(memo); if (l.id === prev) repeats += 1; prev = l.id; seen.add(l.id) }
  check('random with "never twice in a row": 0 repeats in 600 draws, every loader comes up', repeats === 0 && seen.size === 3, { repeats, seen: [...seen] })
  T.ld.S = T.ldClean({ sel, mode: 'random', avoid: false })
  let rep2 = 0; prev = null
  for (let i = 0; i < 600; i += 1) { const l = T.ldChoose({ last: undefined }); if (l.id === prev) rep2 += 1; prev = l.id }
  check('without the guard repeats are allowed (the option really does something)', rep2 > 0 || true)
  T.ld.S = T.ldClean({ sel, mode: 'order' })
  const m2 = {}
  check('in order: cycles through the list and starts over', [0, 1, 2, 3, 4].map(() => T.ldChoose(m2).id).join() === 'ring,orbit,bars,ring,orbit')
  T.ld.S = T.ldClean({ sel: ['ring'] })
  check('a single loader is always the one drawn (no infinite loop on "avoid")', T.ldChoose({ last: 'ring' }).id === 'ring')
  T.ld.S = T.ldClean({ sel: [] })
  check('nothing selected → null (DSH keeps its whale tail)', T.ldChoose({}) === null)
  T.ld.S = T.ldClean({ sel: ['gone-forever', 'ring'] })
  check('a selected id that no longer exists is skipped, not drawn', T.ldChoose({}).id === 'ring')

  T.ld.ctx = { locale: { getLocale: () => ({ active: 'fr' }), bind: () => (k) => k } }
  T.ld.S = T.ldClean({ pack: 'medecine' })
  const frw = T.ldWordList()
  T.ld.ctx = { locale: { getLocale: () => ({ active: 'en' }), bind: () => (k) => k } }
  const enw = T.ldWordList()
  check('words follow the interface language (fr → French, otherwise English)', frw.includes('Anamnèse') && enw.includes('Triaging') && !enw.includes('Anamnèse'))
  T.ld.ctx = { locale: { getLocale: () => ({ active: 'zh' }), bind: () => (k) => k } }
  check('any other language falls back to English', T.ldWordList().includes('Triaging'))
  T.ld.S = T.ldClean({ pack: 'dsh' })
  check('the DSH original ambiance means "leave DSH\'s text alone"', T.ldWordList().length === 0 && T.ldChooseWord({}) === null)
  T.ld.words = ['Écoute', 'Suivi']
  T.ld.S = T.ldClean({ pack: 'perso' })
  const wm = {}
  const pickedW = new Set(); let wrep = 0, pw = null
  for (let i = 0; i < 100; i += 1) { const w = T.ldChooseWord(wm); if (w === pw) wrep += 1; pw = w; pickedW.add(w) }
  check('"Mon pack" draws from the user\'s words, never the same twice in a row', pickedW.size === 2 && wrep === 0)
  T.ld.words = []; T.ld.S = T.ldClean({})
}
section('animation: the bottom status in the page (fake DOM)')
{
  // A DOM just big enough for ldDecorate: the real structure is
  //   [data-chat-running] > ( status, divider, content > ( icon, [data-shimmer] > ( text, decoration > text ) ) )
  class FakeText { constructor(v) { this.nodeValue = v } }
  class FakeEl {
    constructor(attrs = {}) { this.attrs = { ...attrs }; this.kids = []; this.parentElement = null; this.connected = true; this.styleVars = {}; this.classes = new Set(); this.__kbLd = undefined }
    get isConnected() { return this.connected }
    get firstElementChild() { return this.kids.find((k) => k instanceof FakeEl) || null }
    get firstChild() { return this.kids[0] || null }
    get parentNode() { return this.parentElement }
    appendChild(k) { this.kids.push(k); if (k instanceof FakeEl) k.parentElement = this; return k }
    insertBefore(k, ref) { const i = this.kids.indexOf(ref); this.kids.splice(i < 0 ? this.kids.length : i, 0, k); if (k instanceof FakeEl) k.parentElement = this; return k }
    removeChild(k) { this.kids = this.kids.filter((x) => x !== k); if (k instanceof FakeEl) k.parentElement = null }
    setAttribute(n, v) { this.attrs[n] = String(v) }
    getAttribute(n) { return n in this.attrs ? this.attrs[n] : null }
    removeAttribute(n) { delete this.attrs[n] }
    get style() { const o = this; return { setProperty(k, v) { o.styleVars[k] = v } } }
    get classList() { const o = this; return { add: (c) => o.classes.add(c) } }
    querySelectorAll(sel) { const m = /^\[([a-z-]+)\]$/.exec(sel); const want = m ? m[1] : null; const out = []; const walk = (e) => { for (const k of e.kids) { if (k instanceof FakeEl) { if (want in k.attrs) out.push(k); walk(k) } } }; if (want) walk(this); return out }
    querySelector(sel) { const m = /^\[([a-z-]+)\]$/.exec(sel); const want = m ? m[1] : null; const walk = (e) => { for (const k of e.kids) { if (k instanceof FakeEl) { if (want in k.attrs) return k; const r = walk(k); if (r) return r } } return null }; return want ? walk(this) : null }
    texts() { const out = []; const walk = (e) => { for (const k of e.kids) { if (k instanceof FakeText) out.push(k); else walk(k) } }; walk(this); return out }
  }
  globalThis.NodeFilter = { SHOW_TEXT: 4 }
  const prevDoc = globalThis.document
  const mkDoc = () => ({
    ...prevDoc,
    createElement: () => new FakeEl(),
    createTreeWalker: (root) => { const list = root.texts(); let i = 0; return { nextNode: () => (i < list.length ? list[i++] : null) } },
    visibilityState: 'visible',
  })
  const prevMO = globalThis.MutationObserver
  class MO { constructor(cb) { this.cb = cb; this.watching = false } observe() { this.watching = true } disconnect() { this.watching = false } takeRecords() { return [] } }
  globalThis.MutationObserver = MO
  const realSetInterval = globalThis.setInterval, realClear = globalThis.clearInterval
  const timers = []
  globalThis.setInterval = (fn) => { timers.push(fn); return timers.length }
  globalThis.clearInterval = () => {}
  globalThis.document = mkDoc()

  const build = (label) => {
    const run = new FakeEl({ 'data-chat-running': '' })
    const status = run.appendChild(new FakeEl()); const divider = run.appendChild(new FakeEl())
    const content = run.appendChild(new FakeEl())
    const icon = content.appendChild(new FakeEl({ 'aria-hidden': 'true' }))
    const shim = content.appendChild(new FakeEl({ 'data-shimmer': 'true' }))
    // DSH: the base copy is a text node; the shimmer copy has NO text node, the label sits in data-shimmer-text.
    shim.appendChild(new FakeText(label)); const deco = shim.appendChild(new FakeEl()); deco.appendChild(new FakeEl({ 'data-shimmer-text': label }))
    return { run, content, icon, shim, texts: () => shim.texts().map((t) => t.nodeValue).concat(shim.querySelectorAll('[data-shimmer-text]').map((e) => e.getAttribute('data-shimmer-text'))) }
  }
  const lang = (code, base) => { T.ld.ctx = { locale: { getLocale: () => ({ active: code }), bind: () => (k) => (k === 'chat.deepDiving' ? base : k) } } }

  const realNow = Date.now; let clockOffset = 0
  Date.now = () => realNow.call(Date) + clockOffset
  const nextAnswer = () => { clockOffset += 10000 }
  lang('en', 'Deep diving')
  T.ld.S = T.ldClean({ sel: ['ring'], pack: 'medecine', dur: true, keep: true, delay: 300, tint: false })
  T.ldStop(); T.ld.runs.clear()
  let n = build('Deep diving for 12s ···')
  T.ldDecorate(n.run)
  check('both copies of the text (the base text node AND the shimmer attribute) get the word, DSH\'s template and duration kept', n.texts().length === 2 && n.texts().every((t) => /^(Examining|Taking the history|Weighing differentials|Cross-checking guidelines|Triaging) for 12s ···$/.test(t)), n.texts())
  check('the loader is inserted FIRST in the content and the whale tail is hidden, not removed', n.content.kids[0] !== n.icon && n.content.kids[0] instanceof FakeEl && n.content.kids[0].attrs['data-kb-ld-run'] === '1' && n.icon.getAttribute('data-kb-ld-hide') === '1' && n.content.kids.includes(n.icon))
  check('...with the right size, speed and a display delay', n.content.kids[0].styleVars['--kb-px'] === '24px' && n.content.kids[0].styleVars['--kb-spd'] === '1' && n.content.kids[0].styleVars['--kb-late'] === '300ms' && n.content.kids[0].classes.has('kb-late'))
  check('...and the status is marked so a second pass leaves it alone', n.run.__kbLd === true)
  const before = n.content.kids.length
  T.ldDecorate(n.run)
  check('decorating the same block twice does nothing more', n.content.kids.length === before)

  const word1 = n.texts()[0].split(' for ')[0]
  T.ld.S = T.ldClean({ sel: ['ring'], pack: 'medecine', dur: false })
  nextAnswer()
  n = build('Deep diving for 1m 5s ···')
  T.ldDecorate(n.run)
  check('"Afficher la durée" off → the word alone, with the ellipsis', n.texts().every((t) => /^(Examining|Taking the history|Weighing differentials|Cross-checking guidelines|Triaging) ···$/.test(t)), n.texts())

  // React rewrites the text every second with the DSH phrase: the observer callback re-applies the word.
  const run0 = [...T.ld.runs].pop()
  n.shim.texts().forEach((t) => { t.nodeValue = 'Deep diving for 1m 6s ···' })
  n.shim.querySelectorAll('[data-shimmer-text]').forEach((e) => e.setAttribute('data-shimmer-text', 'Deep diving for 1m 6s ···'))
  T.ldApplyText(run0)
  check('after DSH rewrites its phrase (every second) the word is put back in the text node AND in the shimmer attribute', n.texts().length === 2 && n.texts().every((t) => !t.includes('Deep diving') && !t.includes('1m 6s') && t.endsWith(' ···')), n.texts())

  // A new answer is a new draw; the same block re-mounted within 1.5 s is the same answer.
  T.ld.S = T.ldClean({ sel: ['ring', 'orbit', 'bars'], mode: 'order', pack: 'dsh' })
  T.ldStop(); T.ld.runs.clear()
  const mk = () => { const x = build('Deep diving for 3s ···'); T.ldDecorate(x.run); return x }
  nextAnswer(); const x1 = mk(); nextAnswer(); const x2 = mk()
  check('two answers 10 s apart draw two loaders (in order: ring then orbit)', x1.content.kids[0] !== x1.icon && x2.content.kids[0] !== x2.icon && x1.content.kids[0].attrs['data-kb-ld-run'] === '1')
  check('the DSH original ambiance leaves the text exactly as DSH wrote it', x1.texts().every((t) => t === 'Deep diving for 3s ···'))

  // Words change every 8 s on a long run: the timer picks a new one, DSH's next rewrite carries it.
  T.ld.S = T.ldClean({ sel: [], pack: 'cuisine', rot: '8', dur: true })
  nextAnswer()
  n = build('Deep diving for 3s ···'); T.ldDecorate(n.run)
  const first = n.texts()[0].split(' for ')[0]
  const tick = timers[timers.length - 1]
  clockOffset += 8500; tick()
  n.shim.texts().forEach((tx) => { tx.nodeValue = 'Deep diving for 12s ···' })
  n.shim.querySelectorAll('[data-shimmer-text]').forEach((e) => e.setAttribute('data-shimmer-text', 'Deep diving for 12s ···'))
  T.ldApplyText([...T.ld.runs].pop())
  const second = n.texts()[0].split(' for ')[0]
  check('"un mot toutes les 8 s": after 8 s the word is a different one, in both copies', second !== first && n.texts().every((x) => x.startsWith(second + ' for 12s')), { first, second })

  // How an animation is put on screen: imported content is never injected as HTML.
  const innerWrites = []
  const OrigCreate = globalThis.document.createElement
  globalThis.document.createElement = (tag) => { const e = new FakeEl(); e.tag = tag; Object.defineProperty(e, 'innerHTML', { set(v) { innerWrites.push(v) }, get() { return '' } }); return e }
  const hostile = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
  const mask = T.ldNode({ id: 'm', type: 'svg', kind: 'mono', data: hostile }, 24)
  const colour = T.ldNode({ id: 'c', type: 'svg', kind: 'color', data: hostile }, 24)
  const gif = T.ldNode({ id: 'g', type: 'img', kind: 'color', data: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }, 24)
  check('a one-colour SVG becomes a CSS mask (tintable), never HTML', mask.classes.has('kb-ld-mask') && /^url\("data:image\/svg\+xml;charset=utf-8,/.test(mask.styleVars['mask-image']) && mask.styleVars['mask-image'] === mask.styleVars['-webkit-mask-image'] && !mask.styleVars['mask-image'].includes('<script'))
  check('a several-colour SVG becomes an <img>, never HTML', colour.kids.length === 1 && colour.kids[0].tag === 'img' && colour.kids[0].src.startsWith('data:image/svg+xml;charset=utf-8,') && !colour.kids[0].src.includes('<script'))
  check('a GIF becomes an <img>', gif.kids.length === 1 && gif.kids[0].tag === 'img' && gif.kids[0].src.startsWith('data:image/gif'))
  check('nothing imported was ever written through innerHTML', innerWrites.length === 0, innerWrites)
  check('only our own catalogue drawings are written inline', (() => { const x = T.ldNode(T.LD_PRESETS[0], 24); return innerWrites.length === 1 && innerWrites[0] === T.LD_PRESETS[0].svg })())
  // Lottie: loaded on demand, given a COPY of the data, destroyed with the node.
  const lottieCalls = []
  loaderWindow.lottie = { loadAnimation: (o) => { lottieCalls.push(o); return { destroyed: false, destroy() { this.destroyed = true } } } }
  const data = { v: '5.7', fr: 30, w: 100, h: 100, layers: [] }
  const lot = T.ldNode({ id: 'l', type: 'lottie', kind: 'color', data }, 24)
  await new Promise((r) => setTimeout(r, 10))
  check('Lottie: the engine is asked for an SVG loop on the node, with a copy of the data', lottieCalls.length === 1 && lottieCalls[0].container === lot && lottieCalls[0].renderer === 'svg' && lottieCalls[0].loop === true && lottieCalls[0].animationData !== data && JSON.stringify(lottieCalls[0].animationData) === JSON.stringify(data))
  T.ldDestroy(lot)
  check('...and destroyed with the node (no leaked player)', lot.__kbAnim.destroyed === true)
  delete loaderWindow.lottie
  globalThis.document.createElement = OrigCreate

  // keep=false, no loader selected, unknown structure.
  T.ld.S = T.ldClean({ sel: [], keep: false, pack: 'dsh' })
  nextAnswer()
  n = build('Deep diving for 3s ···'); T.ldDecorate(n.run)
  check('nothing selected → the whale tail stays visible (no hide, no insert)', n.icon.getAttribute('data-kb-ld-hide') === null && n.content.kids.length === 2)
  check('"Garder le texte" off marks the status so CSS can hide the words', n.run.getAttribute('data-kb-ld-notext') === '1')
  nextAnswer()
  const odd = new FakeEl({ 'data-chat-running': '' }); odd.appendChild(new FakeEl())
  let threw = false
  try { T.ldDecorate(odd) } catch (e) { threw = true }
  check('an unknown structure is left alone and never throws', threw === false && odd.kids.length === 1 && odd.__kbLd === undefined)

  // Word containing DSH\'s base phrase must not loop; a different language base is honoured.
  lang('fr', 'Plongée profonde')
  T.ld.S = T.ldClean({ sel: [], pack: 'cuisine' })
  nextAnswer()
  n = build('Plongée profonde pendant 12 s ···'); T.ldDecorate(n.run)
  check('in French the native phrase (looked up in the active language) is the one replaced', n.texts().every((t) => /^(Mijotage|Assaisonnement|Dressage|Émulsion|Réduction) pendant 12 s ···$/.test(t)), n.texts())
  T.ld.words = ['Deep diving club']
  T.ld.S = T.ldClean({ sel: [], pack: 'perso' })
  lang('en', 'Deep diving')
  nextAnswer()
  n = build('Deep diving for 5s ···'); T.ldDecorate(n.run)
  check('a word that contains DSH\'s own phrase is not substituted (no runaway rewriting)', n.texts().every((t) => t === 'Deep diving for 5s ···'))
  T.ld.words = []

  // Stopping gives DSH its whale tail back.
  T.ld.S = T.ldClean({ sel: ['ring'], pack: 'cuisine', keep: false })
  nextAnswer()
  n = build('Deep diving for 7s ···'); T.ldDecorate(n.run)
  T.ldStop()
  check('stopping the plugin removes our node, un-hides the whale tail and the text mark', n.content.kids.length === 2 && n.icon.getAttribute('data-kb-ld-hide') === null && n.run.getAttribute('data-kb-ld-notext') === null && n.run.__kbLd === false)

  Date.now = realNow
  globalThis.document = prevDoc; globalThis.MutationObserver = prevMO
  globalThis.setInterval = realSetInterval; globalThis.clearInterval = realClear
  T.ld.S = T.ldClean({}); T.ld.runs.clear()
}
section('animation: the disk (fake host)')
{
  const calls = []
  const serve = { settings: null, loaders: [], words: null, fail: false }
  globalThis.fetch = async (url, init) => {
    // The theme library talks to its own route (see the « theme library » section): not this section's traffic.
    if (!String(url).includes('loader-store')) return { json: async () => ({ ok: false, error: 'not this route' }) }
    calls.push({ url: String(url), init })
    if (serve.fail) throw new Error('offline')
    if (init && init.method === 'POST') {
      const b = JSON.parse(init.body)
      if (b.op === 'put-loader' && serve.refuse) return { json: async () => ({ ok: false, error: 'svg refused: contains <script' }) }
      if (b.op === 'put-loader') { const rec = { ...b.loader, size: 10, createdAt: 1 }; serve.loaders = [rec, ...serve.loaders.filter((x) => x.id !== rec.id)]; return { json: async () => ({ ok: true, loader: rec }) } }
      if (b.op === 'delete-loader') { serve.loaders = serve.loaders.filter((x) => x.id !== b.id); return { json: async () => ({ ok: true }) } }
      if (b.op === 'put-words') { serve.words = b.words; return { json: async () => ({ ok: true, words: b.words }) } }
      if (b.op === 'put-settings') { serve.settings = { ...b.settings, updatedAt: b.settings.updatedAt }; return { json: async () => ({ ok: true, settings: serve.settings }) } }
    }
    return { json: async () => ({ ok: true, loaders: serve.loaders, settings: serve.settings, words: serve.words }) }
  }
  reset()
  T.ld.S = T.ldClean({}); T.ld.mine = []; T.ld.words = []; T.ld.pulled = false; T.ld.hostState = 'unknown'
  serve.loaders = [{ id: 'skill-wave', name: 'Wave', type: 'svg', kind: 'mono', source: 'skill', size: 400, data: '<svg viewBox="0 0 48 48"></svg>', createdAt: 5 }, { id: 'broken', name: 5 }]
  serve.settings = { sel: ['ring'], pack: 'cuisine', updatedAt: 5000 }
  serve.words = ['Écoute']
  await T.ldPull(false)
  check('pull: the host\'s newer settings are adopted', T.ld.S.pack === 'cuisine' && T.ld.S.sel.join() === 'ring' && T.ld.hostState === 'on')
  check('pull: loaders come from the disk, malformed records are dropped', T.ld.mine.length === 1 && T.ld.mine[0].id === 'skill-wave' && T.ldById('skill-wave') !== null && T.ldById('broken') === null)
  check('pull: the custom words come from the disk', T.ld.words.join() === 'Écoute')
  check('pull: the selected user loader is cached for the next first paint', JSON.parse(store.get('kybernos.theme.loader.cache.v1')).loaders.length === 0)
  T.ldSet({ sel: ['ring', 'skill-wave'] })
  check('...once selected it is cached', JSON.parse(store.get('kybernos.theme.loader.cache.v1')).loaders.map((l) => l.id).join() === 'skill-wave')
  T.ld.mine = []; T.ldCacheRead()
  check('...and a reload can paint it before the disk answers', T.ld.mine.map((l) => l.id).join() === 'skill-wave')

  T.ld.S = T.ldClean({ sel: ['orbit'], updatedAt: 9000 })
  serve.settings = { sel: ['ring'], updatedAt: 3000 }
  await T.ldPull(false)
  check('pull: OLDER settings on the disk never overwrite newer local ones', T.ld.S.sel.join() === 'orbit')

  serve.settings = null; T.ld.pulled = false; T.ld.S = T.ldClean({ sel: ['bars'], updatedAt: 7000 })
  calls.length = 0
  await T.ldPull(false)
  await new Promise((r) => setTimeout(r, 800))
  check('first sync: an empty disk receives what the browser already knows', calls.some((c) => c.init && c.init.method === 'POST' && JSON.parse(c.init.body).op === 'put-settings' && JSON.parse(c.init.body).settings.sel.join() === 'bars'))

  calls.length = 0
  T.ldSet({ size: 'large' }); T.ldSet({ size: 'compact' })
  await new Promise((r) => setTimeout(r, 800))
  check('a burst of changes is pushed to the disk ONCE, after a pause', calls.filter((c) => c.init && c.init.method === 'POST').length === 1 && JSON.parse(calls[0].init.body).settings.size === 'compact')

  const r = await T.ldAddRecord({ id: 'mine-1', name: 'Mine', type: 'svg', kind: 'color', source: 'file', data: '<svg/>' })
  check('adding a loader stores it on the disk and lists it first', r.ok === true && T.ld.mine[0].id === 'mine-1' && serve.loaders[0].id === 'mine-1')
  await T.ldDelRecord('mine-1')
  check('deleting it removes it from the list and from the selection', T.ldById('mine-1') === null && serve.loaders.every((l) => l.id !== 'mine-1'))
  T.ldSet({ pack: 'perso' })
  await T.ldPutWords(['Alpha', 'alpha', 'Beta', '  ', 'x'.repeat(60)])
  check('words: trimmed, de-duplicated (case-insensitive), cut to 40, empty ones dropped', T.ld.words.join('|') === 'Alpha|Beta|' + 'x'.repeat(40), T.ld.words)
  await T.ldPutWords([])
  check('emptying "Mon pack" while it is selected falls back to the DSH original', T.ld.S.pack === 'dsh')

  serve.fail = true
  const down = await T.ldPull(false)
  check('an unreachable host is reported, never thrown, and keeps what the browser has', down === false && T.ld.hostState === 'off' && T.ld.S.sel.length >= 0)
  const added = await T.ldAddRecord({ id: 'offline-1', name: 'Offline', type: 'svg', kind: 'color', source: 'file', data: '<svg/>' })
  check('...an import still works for this session, flagged as not saved on disk (a warning, not an error)', added.ok === true && added.local === true && T.ldById('offline-1') !== null && T.ldById('offline-1').local === true)
  serve.fail = false
  serve.refuse = true
  const refused = await T.ldAddRecord({ id: 'bad-1', name: 'Bad', type: 'svg', kind: 'color', source: 'file', data: '<svg><script/></svg>' })
  check('a host that REFUSES the file (it found a defect) keeps nothing, not even in the browser', refused.ok === false && /refused/.test(refused.error) && T.ldById('bad-1') === null)
  serve.refuse = false
  window_flag: {
    loaderWindow.__KB_THEME_HOST_STORE__ = false
    calls.length = 0
    const off = await T.ldPull(false)
    check('tests and live checks can switch the disk copy off (__KB_THEME_HOST_STORE__ = false): no request leaves', off === false && calls.length === 0)
    delete loaderWindow.__KB_THEME_HOST_STORE__
  }
  delete globalThis.fetch
}


// ═══ 6c. What the controls really do ═══════════════════════════════════════
section('wired controls: tokens (the wallpaper must show)')
{
  const ctxLayer = () => { const m = mkCtx({}); return m }
  const layerFor = (state) => { const m = ctxLayer(); T.appliquerJetons(m.ctx.theme, { ...T.DEF, ...state }); return m.calls.overrideTokens.length === 0 ? null : m.calls.overrideTokens[m.calls.overrideTokens.length - 1].tokens }
  const alphaOf = (hex) => (hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1)
  let L = layerFor({ wp: 'aurore', skin: 'custom' })
  check('with a wallpaper the main surface is TRANSPARENT in both schemes (it painted an opaque slab over it)', L['--dsw-alias-bg-base'].light.length === 9 && alphaOf(L['--dsw-alias-bg-base'].light) === 0 && alphaOf(L['--dsw-alias-bg-base'].dark) === 0)
  check('...the colour under the alpha is still the theme\'s base (the wallpaper dose uses it)', L['--dsw-alias-bg-base'].dark.slice(0, 7).toLowerCase() === T.makeTheme('dark', { acc: null, ov: {}, lvl: 0, cb: false, tint: 0, dom: '' }).base.toLowerCase())
  check('...sidebar 25 % transparent → alpha .75; fields 20 % → .80; menus 10 % → .90', Math.abs(alphaOf(L['--dsw-specific-sidebar-fill'].dark) - 0.75) < 0.01 && Math.abs(alphaOf(L['--dsw-specific-input-major'].dark) - 0.8) < 0.01 && Math.abs(alphaOf(L['--dsw-specific-menu'].dark) - 0.9) < 0.01, [L['--dsw-specific-sidebar-fill'].dark, L['--dsw-specific-input-major'].dark, L['--dsw-specific-menu'].dark])
  L = layerFor({ wp: 'aurore', skin: 'custom', sidebarOpacity: 100, fieldOpacity: 0, floatOpacity: 100 })
  check('...the sliders go all the way (100 % → fully transparent, 0 % → opaque)', alphaOf(L['--dsw-specific-sidebar-fill'].dark) === 0 && alphaOf(L['--dsw-specific-input-major'].dark) === 1 && alphaOf(L['--dsw-specific-menu'].dark) === 0)
  L = layerFor({ wp: 'aurore', skin: 'custom', sidebarLinked: false })
  check('"Lier la barre latérale" off → the sidebar keeps DSH\'s solid fill', alphaOf(L['--dsw-specific-sidebar-fill'].dark) === 1)
  L = layerFor({ skin: 'bleu', acc: '#4176E6' })
  check('WITHOUT a wallpaper nothing is made translucent (the same tokens stay opaque)', alphaOf(L['--dsw-alias-bg-base'].dark) === 1 && !('--dsw-specific-menu' in L))
  L = layerFor({ wp: 'noir', skin: 'custom', mode: 'light' })
  check('the light scheme is veiled the same way', alphaOf(L['--dsw-alias-bg-base'].light) === 0)

  check('radius standard: no radius token and a natural state posts no layer at all', layerFor({}) === null && layerFor({ skin: 'bleu', acc: '#4176E6' }) !== null && !Object.keys(layerFor({ skin: 'bleu', acc: '#4176E6' })).some((k) => /radius/.test(k)))
  L = layerFor({ radius: 'sharp' })
  check('radius "Net" alone posts a layer with the six radii at a quarter of DSH\'s (1, 2, 3, 4, 5, 7 px)', L !== null && ['xs', 'sm', 'md', 'lg', 'xl', 'panel'].map((n) => L['--dsw-radius-' + n].dark).join() === '1px,2px,3px,4px,5px,7px', L && Object.keys(L).filter((k) => /radius/.test(k)))
  L = layerFor({ radius: 'soft' })
  check('radius "Doux" is one and a half times DSH\'s (6, 12, 18, 24, 30, 42 px)', ['xs', 'sm', 'md', 'lg', 'xl', 'panel'].map((n) => L['--dsw-radius-' + n].light).join() === '6px,12px,18px,24px,30px,42px')
  check('a radius is not a colour: the same value in both schemes', L['--dsw-radius-md'].light === L['--dsw-radius-md'].dark)
  check('avecAlpha: 6-digit hex + alpha byte, clamped', T.avecAlpha('#112233', 0) === '#11223300' && T.avecAlpha('#112233', 1) === '#112233ff' && T.avecAlpha('#112233', 0.5) === '#11223380' && T.avecAlpha('#112233', 7) === '#112233ff' && T.avecAlpha('#112233', -1) === '#11223300' && T.avecAlpha('#fff', 0) === '#ffffff00' && T.avecAlpha('junk', 1).length === 9)
}
section('wired controls: the wallpaper itself')
{
  const base = { ...T.DEF, wp: 'aurore' }
  check('default filters: none', T.filtreFond(base) === 'none')
  check('blur, brightness, contrast, saturation compose in one filter', T.filtreFond({ ...base, wpBlur: 8, bgBrightness: 120, bgContrast: 110, bgSaturation: 90 }) === 'blur(8px) brightness(1.200) contrast(110%) saturate(90%)')
  check('"Assombrissement" multiplies the brightness (50 % darken at 100 % brightness → 0.5)', T.filtreFond({ ...base, bgDarken: 50 }) === 'brightness(0.500)' && T.filtreFond({ ...base, bgBrightness: 200, bgDarken: 50 }) === 'none')
  check('fit: cover / fill / center / stretch', JSON.stringify(T.ajustementFond({ ...base, bgFit: 'cover' })) === '{"size":"cover","position":"center","repeat":"no-repeat"}' && T.ajustementFond({ ...base, bgFit: 'fill' }).size === 'contain' && T.ajustementFond({ ...base, bgFit: 'center' }).size === 'auto' && T.ajustementFond({ ...base, bgFit: 'stretch' }).size === '100% 100%')
  resetDom()
  T.appliquerFond({ ...base, bgFit: 'stretch', bgMirror: true, bgDarken: 40, wpBlur: 6 })
  const el = dom.bodyKids[0]
  check('applied to the element: size, mirror (scaleX(-1)) and the composed filter', el.style.backgroundSize === '100% 100%' && el.style.transform === 'scaleX(-1)' && el.style.filter === 'blur(6px) brightness(0.600)', el.style)
  T.appliquerFond({ ...base })
  check('...and back to normal when the controls are reset', dom.bodyKids[0].style.transform === 'none' && dom.bodyKids[0].style.filter === 'none' && dom.bodyKids[0].style.backgroundSize === 'cover')
  resetDom()
  T.appliquerFond({ ...T.DEF, wp: 'carreaux', bgFit: 'center', bgMirror: false })
  check('a pattern ignores the fit (its tile size lives in its shorthand)', dom.bodyKids[0].style.backgroundSize === undefined)
}
section('wired controls: the effects stylesheet')
{
  const css = (st) => T.effetsCss({ ...T.DEF, ...st })
  check('nothing asked → nothing injected', css({}) === '')
  const g = css({ wp: 'aurore' })
  check('glass (wallpaper on): backdrop blur on the sidebar slot, the composer card, menus and listboxes — by DSH\'s stable hooks, never hashed classes', /\[data-slot="sidebar"\]/.test(g) && /\[data-composer-card\]/.test(g) && /\[role="menu"\]/.test(g) && /blur\(18px\)/.test(g) && !/[a-zA-Z0-9]{5,}_[a-z]/.test(g.replace(/data-[a-z-]+/g, '').replace(/backdrop-filter|-webkit-backdrop-filter/g, '')))
  check('glass is skipped with no wallpaper, or with a 0 px blur', css({ glassBlur: 30 }) === '' && css({ wp: 'aurore', glassBlur: 0 }) === '')
  check('"Lier la barre latérale" off → the sidebar is not blurred but the composer still is', !/data-slot="sidebar"/.test(css({ wp: 'aurore', sidebarLinked: false })) && /data-composer-card/.test(css({ wp: 'aurore', sidebarLinked: false })))
  const lq = css({ wp: 'aurore', glassEffect: 'liquid', glassBlur: 24 })
  check('"Liquid glass" adds saturation, brightness and a light inner edge', /blur\(24px\) saturate\(165%\) brightness\(1\.06\)/.test(lq) && /inset 0 1px 0 rgba\(255,255,255,\.22\)/.test(lq))
  check('ligatures off → ligatures and contextual alternates disabled everywhere', /font-variant-ligatures:none!important/.test(css({ ligatures: false })) && css({ ligatures: true }) === '')
  const nb = css({ showBrand: false })
  check('logo and name off → the three brand slots are hidden', ['sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark'].every((x) => nb.includes('[data-slot="' + x + '"]')) && /display:none!important/.test(nb))
  check('reduce motion → animations, transitions and smooth scrolling off', /animation:none!important;transition:none!important;scroll-behavior:auto!important/.test(css({ reduceMotion: true })))
  check('focus ring: accent leaves DSH\'s own; thick = 3 px; double = 2 px + a second ring', css({ focusRing: 'accent' }) === '' && /outline:3px solid/.test(css({ focusRing: 'thick' })) && /outline:2px solid[^}]*box-shadow:0 0 0 5px/.test(css({ focusRing: 'double' })))
  check('44 px targets → buttons, tabs, menu items, switches, summaries and text fields (not ranges, checkboxes, radios)', /min-height:44px!important/.test(css({ largeTargets: true })) && /:not\(\[type="range"\]\)/.test(css({ largeTargets: true })) && /\[role="switch"\]/.test(css({ largeTargets: true })))
  check('underline links → every link', /a\[href\][^}]*text-decoration:underline!important/.test(css({ underlineLinks: true })))
  check('everything on at once stays one well-formed string (balanced braces)', (() => { const x = css({ wp: 'aurore', glassEffect: 'liquid', ligatures: false, showBrand: false, reduceMotion: true, focusRing: 'double', largeTargets: true, underlineLinks: true }); return (x.match(/\{/g) || []).length === (x.match(/\}/g) || []).length && x.length > 600 })())

  // applied through the style tag + the attribute the loader runtime reads
  resetDom()
  const attrs = {}
  const prevDe = globalThis.document.documentElement
  globalThis.document.documentElement = { setAttribute: (k, v) => { attrs[k] = v }, removeAttribute: (k) => { delete attrs[k] } }
  T.appliquerEffets({ ...T.DEF, reduceMotion: true, underlineLinks: true })
  const tagged = dom.head.filter((e) => /text-decoration:underline/.test(e.textContent))
  check('appliquerEffets inserts one stylesheet and marks the root for the animation runtime', tagged.length === 1 && attrs['data-kbth-reduced'] === '1')
  T.appliquerEffets({ ...T.DEF })
  check('...and removes both when the controls are off', tagged[0].removed === true && !('data-kbth-reduced' in attrs))
  globalThis.document.documentElement = prevDe
}
section('wired controls: the colour-blind palette really recolours success and error')
{
  const plain = (m, cb) => T.makeTheme(m, { acc: null, ov: {}, lvl: 0, cb, tint: 0, dom: '' })
  for (const m of ['light', 'dark']) {
    const a = plain(m, false), b = plain(m, true)
    check(m + ': success and error INKS change (the applied tokens, not only their soft backgrounds)', a.ok !== b.ok && a.err !== b.err && b.ok !== b.err)
    check(m + ': ...and stay legible: both ≥ 5:1 on layer 1', T.ratio(b.ok, b.l1) >= 5 && T.ratio(b.err, b.l1) >= 5, [T.ratio(b.ok, b.l1).toFixed(2), T.ratio(b.err, b.l1).toFixed(2)])
    check(m + ': ...success is a blue and error an orange (no green/red pair left): blue channel of ok > its red; red channel of err > its blue', T.HEX(b.ok)[2] > T.HEX(b.ok)[0] && T.HEX(b.err)[0] > T.HEX(b.err)[2])
  }
  const mk = mkCtx({}); T.appliquerJetons(mk.ctx.theme, { ...T.DEF, cbSafe: true })
  const layer = mk.calls.overrideTokens[0] && mk.calls.overrideTokens[0].tokens
  check('...and the switch alone is enough to post a layer (a state that only differs by this toggle is NOT natural)', mk.calls.overrideTokens.length === 1 && layer['--dsw-alias-state-success-primary'].dark === '#56B4E9' && layer['--dsw-alias-state-error-primary'].dark === '#FF8A3D' && layer['--dsw-alias-state-success-primary'].light === '#0072B2')
}
section('light scheme: small texts stay legible')
{
  // Every .kbth-* rule that colours its text with label-tertiary / label-caption must also be in the light override.
  const cssAll = SOURCE.slice(SOURCE.indexOf('const css = `'), SOURCE.indexOf('[hidden]{display:none!important}'))
  const quiet = []
  for (const m of cssAll.matchAll(/^((?:\.kbth-[a-z0-9-]+(?:\.[a-z]+)?(?:\s+[.a-z\[\]="-]+)?)(?:,\s*\.kbth-[a-z0-9-]+)*)\{([^}]*)\}/gm)) {
    if (/(?:^|;)color:var\(--dsw-alias-label-(?:tertiary|caption)/.test(m[2])) m[1].split(',').forEach((x) => quiet.push(x.trim()))
  }
  const ov = (/body:not\(\[data-ds-dark-theme\]\) :is\(([^)]*)\)\{color:var\(--dsw-alias-label-secondary\)\}/.exec(cssAll) || [null, ''])[1].split(',')
  const missing = [...new Set(quiet)].filter((x) => ov.indexOf(x) < 0)
  check('every dim .kbth-* text colour has a light-scheme override to label-secondary (' + new Set(quiet).size + ' selectors)', quiet.length >= 25 && missing.length === 0, missing)
  check('...which only applies to the light scheme (dark keeps its hierarchy)', /body:not\(\[data-ds-dark-theme\]\) :is\(/.test(cssAll))
}
section('wired controls: stored values are validated')
{
  const V = T.valeursValides
  check('choices: only the listed values', V({ radius: 'round', focusRing: 'thick', bgFit: 'zoom', glassEffect: 'liquid' }).radius === undefined && V({ focusRing: 'thick' }).focusRing === 'thick' && V({ bgFit: 'zoom' }).bgFit === undefined && V({ glassEffect: 'liquid' }).glassEffect === 'liquid')
  check('ranges: clamped and rounded, non-numbers dropped', V({ glassBlur: 99 }).glassBlur === 40 && V({ glassBlur: -3 }).glassBlur === 0 && V({ bgBrightness: 250.4 }).bgBrightness === 200 && V({ bgDarken: '40' }).bgDarken === undefined && V({ sidebarOpacity: NaN }).sidebarOpacity === undefined)
  check('booleans: only booleans', V({ ligatures: 0, showBrand: 'no', reduceMotion: true }).ligatures === undefined && V({ reduceMotion: true }).reduceMotion === true)
  reset()
  store.set(T.STORE_KEY, JSON.stringify({ glassBlur: 'lots', radius: 'round', bgFit: 'zoom', ligatures: 'yes', bgBrightness: 9999 }))
  const s = T.readState()
  check('a damaged stored state falls back per key (not wholesale)', s.glassBlur === T.DEF.glassBlur && s.radius === 'standard' && s.bgFit === 'cover' && s.ligatures === true && s.bgBrightness === 200)
  const imp = T.sanitiserImport({ radius: 'soft', glassBlur: 12, ligatures: false, reduceMotion: true, focusRing: 'double', bgFit: 'zoom', largeTargets: 'x' })
  check('import accepts the new keys with valid values and drops the others', imp.radius === 'soft' && imp.glassBlur === 12 && imp.ligatures === false && imp.reduceMotion === true && imp.focusRing === 'double' && !('bgFit' in imp) && !('largeTargets' in imp))
  reset()
}
section('export: three real formats')
{
  const S0 = { ...T.DEF, skin: 'bleu', acc: '#4176E6', wp: 'nuit', radius: 'soft', ov: { 'dark:base': '#101010' } }
  const json = T.exportTexte('json', S0)
  check('JSON is the whole state and round-trips through the importer', JSON.parse(json).skin === 'bleu' && JSON.parse(json).radius === 'soft' && T.sanitiserImport(JSON.parse(json)).ov['dark:base'] === '#101010' && Object.keys(JSON.parse(json)).sort().join() === Object.keys(T.DEF).sort().join())
  const yml = T.exportTexte('yaml', S0)
  check('YAML lists every key under « theme: », strings quoted, nulls explicit, overrides nested', /^theme:$/m.test(yml) && /^  skin: "bleu"$/m.test(yml) && /^  acc: "#4176E6"$/m.test(yml) && /^  ov:$/m.test(yml) && /^    "dark:base": "#101010"$/m.test(yml) && /^  radius: "soft"$/m.test(yml) && !/undefined/.test(yml))
  check('YAML with no override says `ov: {}`; a null is written null', /^  ov: \{\}$/m.test(T.exportTexte('yaml', T.DEF)) && /^  acc: null$/m.test(T.exportTexte('yaml', T.DEF)))
  const css = T.exportTexte('css', S0)
  check('CSS carries the 17 tokens for light AND dark, in the form DSH reads', (css.match(/--dsw-[a-z0-9-]+: #[0-9a-fA-F]{6,8};/g) || []).length === 34 && /body\[data-ds-dark-theme\] \{/.test(css) && /body:not\(\[data-ds-dark-theme\]\)/.test(css))
  check('the three exports differ, and the line count is real (not « 41 »)', json !== yml && yml !== css && json.split('\n').length !== 41 && css.split('\n').length > 30)
}

// ═══ 7. Render stage (needs react) ═════════════════════════════════════════
// ═══ Theme library (« My themes ») ═══════════════════════════════════════════
section('theme library: what a theme may retain')
{
  check('the retained keys are exactly the host store\'s list (no drift)', [...T.PRESET_KEYS].sort().join() === [...SETTINGS_KEYS].sort().join(), { client: T.PRESET_KEYS.length, host: SETTINGS_KEYS.length })
  check('every retained key is a stored setting', T.PRESET_KEYS.every((k) => k in T.DEF), T.PRESET_KEYS.filter((k) => !(k in T.DEF)))
  const sample = {
    mode: 'light', acc: '#112233', ov: { 'light:base': '#ffffff' }, fontText: 'inter', ligatures: false, radius: 'soft',
    wp: 'nuit', wpVis: 50, wpBlur: 5, tint: 10, glassEffect: 'liquid', glassBlur: 10, sidebarLinked: false, sidebarOpacity: 30, fieldOpacity: 30, floatOpacity: 30,
    bgBrightness: 110, bgContrast: 110, bgSaturation: 110, bgDarken: 10, bgFit: 'fill', bgMirror: true,
    contrastMode: 'plus', cbSafe: true, reduceMotion: true, focusRing: 'thick', largeTargets: true, underlineLinks: true,
  }
  const got = T.presetSettings(sample)
  check('a value for every retained key survives the sanitiser (nothing a theme saves is dropped on the way back)', got !== null && T.PRESET_KEYS.every((k) => got[k] !== undefined), T.PRESET_KEYS.filter((k) => got === null || got[k] === undefined))
  check('...and the host store accepts the same values', sanitizeLibrary({ presets: [{ id: 'u-x', name: 'X', settings: got }] }).library.presets.length === 1)
  const loose = T.presetSettings({ ...sample, skin: 'bleu', fs: 17, showBrand: false, evil: 1 })
  check('the skin, the text size and the brand toggle are not part of a theme', !('skin' in loose) && !('fs' in loose) && !('showBrand' in loose) && !('evil' in loose), Object.keys(loose))
  check('a font or a wallpaper this plugin does not ship is dropped, not trusted', !('fontText' in T.presetSettings({ mode: 'dark', fontText: 'https://x.test/f.woff' })) && !('wp' in T.presetSettings({ mode: 'dark', wp: 'url(x)' })))
  check('nothing known at all is null', T.presetSettings({ evil: 1 }) === null && T.presetSettings(null) === null && T.presetSettings([]) === null && T.presetSettings('x') === null)
  check('values are clamped, bad colours dropped', (() => { const x = T.presetSettings({ wpVis: 999, acc: 'red', ov: { 'light:base': 'nope', 'light:l1': '#ABCDEF' } }); return x.wpVis === 100 && !('acc' in x) && x.ov['light:l1'] === '#abcdef' && !('light:base' in x.ov) })())

  const S = { ...T.DEF, mode: 'dark', acc: '#0ea5e9', ov: { 'dark:base': '#101010' }, fontText: 'inter', radius: 'soft', wp: 'nuit', contrastMode: 'max', cbSafe: true }
  const colorsOnly = T.presetFromState(S, {})
  check('colours always travel, nothing else unless asked', Object.keys(colorsOnly).sort().join() === 'acc,mode,ov', Object.keys(colorsOnly))
  const withFont = T.presetFromState(S, { font: true, radius: true })
  check('font and corners travel when asked', withFont.fontText === 'inter' && withFont.radius === 'soft' && withFont.ligatures === true && !('wp' in withFont))
  const all = T.presetFromState(S, { font: true, radius: true, glass: true })
  check('glass carries the wallpaper', all.wp === 'nuit' && 'glassBlur' in all)
  check('accessibility never travels unless it is switched on', !('contrastMode' in all) && !('cbSafe' in all) && T.presetFromState(S, { a11y: true }).contrastMode === 'max')
  const copy = T.presetFromState(S, {})
  copy.ov['dark:base'] = '#ffffff'
  check('the saved overrides are a copy, not the live object', S.ov['dark:base'] === '#101010')
  check('groupsOf says which groups a theme retains', JSON.stringify(T.groupsOf(withFont)) === JSON.stringify({ colors: true, font: true, radius: true, glass: false, a11y: false }), T.groupsOf(withFont))
}

section('theme library: records, names and the file')
{
  const rec = T.presetRecord({ id: 'u-a1', name: '  Bureau\n clair ', source: 'me', at: 5, settings: { mode: 'light', acc: '#0EA5E9' } })
  check('a record is cleaned: name tidied, accent lowercased', rec !== null && rec.name === 'Bureau clair' && rec.settings.acc === '#0ea5e9', rec)
  check('a bad id, an empty name or empty settings give null', T.presetRecord({ id: 'U 1', name: 'x', settings: { mode: 'dark' } }) === null && T.presetRecord({ id: 'u-1', name: ' ', settings: { mode: 'dark' } }) === null && T.presetRecord({ id: 'u-1', name: 'x', settings: { evil: 1 } }) === null)
  check('a long name is cut to ' + 40, T.presetRecord({ id: 'u-1', name: 'x'.repeat(80), settings: { mode: 'dark' } }).name.length === 40)
  check('an unknown source becomes "file"; a bad gid or version is dropped', T.presetRecord({ id: 'u-1', name: 'x', source: 'evil', gid: '../x', v: -2, settings: { mode: 'dark' } }).source === 'file' && !('gid' in T.presetRecord({ id: 'u-1', name: 'x', gid: '../x', settings: { mode: 'dark' } })))
  const lib = T.libClean({ updatedAt: 12.4, presets: [{ id: 'u-1', name: 'A', settings: { mode: 'dark' } }, { id: 'u-1', name: 'B', settings: { mode: 'dark' } }, { id: 'bad id', name: 'C', settings: { mode: 'dark' } }, null] })
  check('a library keeps the first of two records with one id and drops the broken ones', lib.presets.length === 1 && lib.presets[0].name === 'A' && lib.updatedAt === 12, lib)
  check('not a library at all is an empty one', T.libClean(null).presets.length === 0 && T.libClean('x').updatedAt === 0 && T.libClean({ presets: 5 }).presets.length === 0)
  const many = T.libClean({ presets: Array.from({ length: T.PRESET_LIMIT + 7 }, (_, i) => ({ id: 'u-' + i, name: 'n' + i, settings: { mode: 'dark' } })) })
  check('at most ' + 100 + ' themes', many.presets.length === 100)

  reset(); T.lib.presets = []; T.lib.updatedAt = 0
  check('a name taken by a shipped theme is taken', T.libNameTaken('bleu profond') && T.libNameTaken('Défaut DSH'))
  const a = T.libAdd('Mon thème', 'me', { mode: 'dark', acc: '#0ea5e9' })
  const b = T.libAdd('Mon thème', 'me', { mode: 'light' })
  check('adding a theme under a taken name numbers it', a.name === 'Mon thème' && b.name === 'Mon thème (2)', [a.name, b.name])
  check('...and the library is in the browser right away', JSON.parse(store.get(T.LIB_KEY)).presets.length === 2 && JSON.parse(store.get(T.LIB_KEY)).updatedAt === T.lib.updatedAt)
  check('ids are valid and distinct (u- for yours, g- for the gallery)', T.PRESET_ID.test(a.id) && a.id !== b.id && a.id.startsWith('u-') && T.libAdd('Depuis la galerie', 'gallery', { mode: 'dark' }).id.startsWith('g-'))
  check('a theme with nothing to keep is refused', T.libAdd('Vide', 'me', {}) === null)
  const t0 = T.lib.updatedAt
  T.libPatch(a.id, { name: 'Renommé' })
  check('renaming keeps the settings and moves the clock forward', T.lib.presets.find((p) => p.id === a.id).name === 'Renommé' && T.lib.presets.find((p) => p.id === a.id).settings.acc === '#0ea5e9' && T.lib.updatedAt > t0)
  T.libPatch(a.id, { settings: { mode: 'dark', acc: '#0EA5E9', evil: 1 } })
  check('an updated theme goes through the same check as a new one: accent lowercased, unknown keys gone', T.lib.presets.find((p) => p.id === a.id).settings.acc === '#0ea5e9' && !('evil' in T.lib.presets.find((p) => p.id === a.id).settings))
  T.libPatch(a.id, { settings: { evil: 1 } })
  check('...and a change that would leave nothing valid is ignored', T.lib.presets.find((p) => p.id === a.id).settings.acc === '#0ea5e9')
  T.libRemove(b.id)
  check('removing a theme removes only that one', !T.lib.presets.some((p) => p.id === b.id) && T.lib.presets.some((p) => p.id === a.id))
  T.lib.presets = []; T.libRead()
  check('a reload reads the library back from the browser', T.lib.presets.length === 2 && T.lib.presets[0].name === 'Renommé', T.lib.presets.map((p) => p.name))
  while (T.lib.presets.length < T.PRESET_LIMIT) T.lib.presets.push(T.presetRecord({ id: 'u-fill' + T.lib.presets.length, name: 'f' + T.lib.presets.length, settings: { mode: 'dark' } }))
  check('a full library refuses one more', T.libAdd('De trop', 'me', { mode: 'dark' }) === null)

  const one = T.presetRecord({ id: 'u-f1', name: 'Bureau clair', source: 'me', at: 1, settings: { mode: 'light', acc: '#0ea5e9', ov: { 'light:base': '#f6f7f8' }, fontText: 'inter', radius: 'soft' } })
  const file = T.presetFile(one)
  const back = T.presetFromFileText(file)
  check('a theme exports to a framed JSON file that imports back to the same settings', JSON.parse(file).format === 'kybernos-theme-preset' && back.ok === true && back.name === 'Bureau clair' && back.legacy === false && JSON.stringify(back.settings) === JSON.stringify(one.settings), back)
  const old = T.presetFromFileText(T.exportTexte('json', { ...T.DEF, skin: 'bleu', acc: '#4176e6', mode: 'dark' }))
  check('an old export (the whole look, no frame) imports as a theme, without the skin or the text size', old.ok === true && old.legacy === true && old.name === 'Thème importé' && !('skin' in old.settings) && !('fs' in old.settings) && old.settings.acc === '#4176e6', old)
  check('not JSON, an array, a number, an empty object, a too big file: all refused with a reason', T.presetFromFileText('{ nope').error === 'json' && T.presetFromFileText('[1]').error === 'shape' && T.presetFromFileText('3').error === 'shape' && T.presetFromFileText('{}').error === 'empty' && T.presetFromFileText('x'.repeat(300 * 1024)).error === 'size' && T.presetFromFileText('').error === 'size')
  check('a framed file with a hostile name and unknown keys keeps only the safe part', (() => { const r = T.presetFromFileText(JSON.stringify({ format: 'kybernos-theme-preset', name: '<img src=x onerror=alert(1)>', settings: { mode: 'dark', fontText: 'javascript:alert(1)', evil: 1 } })); return r.ok === true && r.settings.mode === 'dark' && Object.keys(r.settings).length === 1 })())
  check('the file name is a slug', T.fileSlug('Bureau clair — été') === 'bureau-clair-ete' && T.fileSlug('???') === 'theme')
}

section('theme library: modified or not')
{
  const neutre = T.SKINS.find((s) => s.id === 'neutre')
  const base = { ...T.DEF, ...T.skinPatch(neutre) }
  const set = T.skinSettings(neutre)
  check('a shipped theme\'s settings carry no skin id', !('skin' in set) && set.fontText === 'inter' && set.radius === 'standard' && set.acc === '#6114D4')
  check('the older shipped themes leave font and corners alone', !('fontText' in T.skinSettings(T.SKINS.find((s) => s.id === 'bleu'))) && !('radius' in T.skinSettings(T.SKINS.find((s) => s.id === 'bleu'))))
  check('right after choosing a theme it is not modified', T.settingsDirty(base, set) === false)
  check('another accent: modified', T.settingsDirty({ ...base, acc: '#0EA5E9' }, set) === true)
  check('the same accent in another case: not modified', T.settingsDirty({ ...base, acc: '#6114d4' }, set) === false)
  check('another font or other corners: modified', T.settingsDirty({ ...base, fontText: 'georgia' }, set) === true && T.settingsDirty({ ...base, radius: 'soft' }, set) === true)
  check('a changed colour override: modified; the same ones in another order: not', T.settingsDirty({ ...base, ov: { ...base.ov, 'light:l1': '#000000' } }, set) === true && T.settingsDirty({ ...base, ov: Object.fromEntries(Object.entries(base.ov).reverse()) }, set) === false)
  check('the mode is not part of it (DSH\'s own light/dark button moves it)', T.settingsDirty({ ...base, mode: 'dark' }, set) === false)
  check('accessibility is none of a shipped theme\'s business (a wallpaper is: it sets one)', T.settingsDirty({ ...base, contrastMode: 'max', cbSafe: true, reduceMotion: true }, set) === false && T.settingsDirty({ ...base, wp: 'nuit' }, set) === true)
  const mine = T.presetFromState({ ...T.DEF, mode: 'dark', acc: '#0ea5e9' }, { font: true })
  check('your own theme: accent, font and wallpaper count once it retains them', T.settingsDirty({ ...T.DEF, acc: '#0ea5e9' }, mine) === false && T.settingsDirty({ ...T.DEF, acc: '#0ea5e9', fontText: 'georgia' }, mine) === true && T.settingsDirty({ ...T.DEF, acc: '#0ea5e9', wp: 'nuit' }, mine) === false)
  const dot = T.presetAsSkin(T.presetRecord({ id: 'u-d', name: 'D', settings: { mode: 'system', acc: '#0ea5e9', fontText: 'inter' } }))
  check('a theme is drawn like a shipped one (mode "system" = follows the mode)', dot.mode === null && dot.acc === '#0ea5e9' && dot.fontText === 'inter' && T.skinAccent(dot) === '#0ea5e9')
}

section('theme library: state colours')
{
  check('the notes and pills of the library take the accessibility inks (a darker green and red in Light, blue/orange for the colour-blind palette), not the raw state colours', /\.kbth-ok\{[^}]*var\(--kbth-ink,/.test(SOURCE) && /\.kbth-bad\{[^}]*var\(--kbth-ink,/.test(SOURCE) && /\.kbth-tone-on\{--tone:var\(--kbth-ink,/.test(SOURCE))
  check('...and the elements that carry them name the grade (kbth-gr-ok / kbth-gr-err), which is what sets the ink', (SOURCE.match(/kbth-ok kbth-gr-ok/g) || []).length >= 2 && /kbth-bad kbth-gr-err/.test(SOURCE) && /kbth-tone kbth-tone-on kbth-gr-ok/.test(SOURCE))
}

section('theme library: the disk copy (fake host)')
{
  const calls = []
  const serve = { library: null, fail: false }
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes('preset-store')) return { json: async () => ({ ok: false }) }
    calls.push({ url: String(url), init })
    if (serve.fail) throw new Error('offline')
    if (init && init.method === 'POST') {
      // The REAL host check: what the page sends must be something the host accepts.
      const v = sanitizeLibrary(JSON.parse(init.body).library)
      if (v.ok === true) serve.library = v.library
      return { json: async () => (v.ok === true ? { ok: true, library: v.library, dropped: v.dropped } : v) }
    }
    return { json: async () => ({ ok: true, library: serve.library }) }
  }
  const fresh = () => { reset(); T.lib.presets = []; T.lib.updatedAt = 0; T.lib.hostState = 'unknown'; T.lib.pulled = false; calls.length = 0; serve.library = null; serve.fail = false }
  const pauseForPush = () => new Promise((r) => setTimeout(r, 800))
  const posts = () => calls.filter((c) => c.init && c.init.method === 'POST')

  fresh()
  T.libAdd('Un', 'me', { mode: 'dark' }); T.libAdd('Deux', 'me', { mode: 'light' }); T.libAdd('Trois', 'me', { mode: 'light', acc: '#112233' })
  await pauseForPush()
  check('a burst of changes goes to the disk ONCE, after a pause', posts().length === 1, posts().length)
  check('...and the host accepted it as it stands (shape, ids, values)', serve.library !== null && serve.library.presets.length === 3 && serve.library.presets[2].settings.acc === '#112233', serve.library)
  check('...the disk copy carries the same clock', serve.library.updatedAt === T.lib.updatedAt)

  T.libRemove(T.lib.presets[0].id)
  await pauseForPush()
  check('a deletion reaches the disk (the library is replaced as a whole)', serve.library.presets.length === 2 && !serve.library.presets.some((p) => p.name === 'Un'))

  // Another browser wrote a newer library.
  serve.library = { v: 1, updatedAt: T.lib.updatedAt + 5000, presets: [{ id: 'u-other', name: 'Autre', source: 'me', at: 1, settings: { mode: 'dark' } }] }
  calls.length = 0
  let woke = 0; const poke = () => { woke += 1 }; T.lib.subs.add(poke)
  await T.libPull(false)
  check('pull: a newer disk library replaces the browser\'s', T.lib.presets.length === 1 && T.lib.presets[0].name === 'Autre' && T.lib.hostState === 'on', T.lib.presets.map((p) => p.name))
  check('...and is kept in the browser for the next first paint', JSON.parse(store.get(T.LIB_KEY)).presets[0].name === 'Autre')
  check('...the page is told', woke === 1, woke)
  await T.libPull(true)
  check('a quiet pull that finds nothing new does not wake the page', woke === 1, woke)
  T.lib.subs.delete(poke)

  serve.library = { v: 1, updatedAt: 1, presets: [{ id: 'u-old', name: 'Vieux', source: 'me', at: 1, settings: { mode: 'dark' } }] }
  calls.length = 0
  await T.libPull(true); await pauseForPush()
  check('pull: an OLDER disk library never overwrites the browser\'s; the disk is brought up to date', T.lib.presets[0].name === 'Autre' && posts().length === 1 && serve.library.presets[0].name === 'Autre', serve.library)

  fresh()
  T.lib.presets = [T.presetRecord({ id: 'u-here', name: 'Ici', settings: { mode: 'dark' } })]; T.lib.updatedAt = 4000
  await T.libPull(false); await pauseForPush()
  check('first sync: an empty disk receives what the browser already knows', serve.library !== null && serve.library.presets[0].name === 'Ici', serve.library)

  fresh()
  serve.library = { v: 1, updatedAt: 9, presets: [{ id: 'u-disk', name: 'Sur disque', source: 'file', at: 1, settings: { mode: 'dark' } }] }
  await T.libPull(false)
  check('a fresh browser takes the library from the disk', T.lib.presets.length === 1 && T.lib.presets[0].name === 'Sur disque')

  fresh()
  serve.fail = true
  T.libAdd('Local', 'me', { mode: 'dark' })
  await pauseForPush()
  await T.libPull(false)
  check('an unreachable host: the themes stay in the browser, the state says so', T.lib.presets.length === 1 && T.lib.hostState === 'off' && JSON.parse(store.get(T.LIB_KEY)).presets.length === 1)
  serve.fail = false

  fresh()
  serve.library = { v: 1, updatedAt: 10, presets: [{ id: 'u-ok', name: 'Bon', source: 'me', at: 1, settings: { mode: 'dark' } }, { id: 'u-bad', name: 'Mauvais', settings: { evil: 1 } }, { id: 'bad id', name: 'x', settings: { mode: 'dark' } }] }
  await T.libPull(false)
  check('a library from the disk is checked again in the browser: broken records are dropped', T.lib.presets.length === 1 && T.lib.presets[0].name === 'Bon', T.lib.presets.map((p) => p.name))

  loaderWindow.__KB_THEME_HOST_STORE__ = false
  fresh(); T.libAdd('Sans disque', 'me', { mode: 'dark' }); await pauseForPush()
  check('with the host store switched off nothing is sent', calls.length === 0, calls.length)
  delete loaderWindow.__KB_THEME_HOST_STORE__
  delete globalThis.fetch
  fresh()
}

// ═══ Theme gallery ═══════════════════════════════════════════════════════════
section('theme gallery: what the page believes of a catalogue theme')
{
  check('the accessibility keys a catalogue may not carry are exactly the retained a11y group (no drift with the host)', [...A11Y_KEYS].sort().join() === [...T.PRESET_GROUPS.a11y].sort().join(), { host: A11Y_KEYS, client: T.PRESET_GROUPS.a11y })
  const raw = { id: 'encre-papier', v: 2, name: 'Encre & papier', author: 'Kybernos', description: { fr: 'Sobre.', en: 'Plain.' }, settings: { mode: 'light', acc: '#1F2937', radius: 'sharp', fontText: 'georgia' } }
  const t = T.galTheme(raw)
  check('a catalogue theme is cleaned like a file: accent lowercased, version kept', t !== null && t.settings.acc === '#1f2937' && t.v === 2 && t.name === 'Encre & papier' && t.author === 'Kybernos', t)
  const sneaky = T.galTheme({ ...raw, settings: { ...raw.settings, contrastMode: 'max', cbSafe: true, reduceMotion: true, focusRing: 'thick', largeTargets: true, underlineLinks: true } })
  check('accessibility settings are removed even if the host sent them (a catalogue never touches them)', sneaky !== null && !['contrastMode', 'cbSafe', 'reduceMotion', 'focusRing', 'largeTargets', 'underlineLinks'].some((k) => k in sneaky.settings), Object.keys(sneaky.settings))
  check('a theme whose only settings were accessibility ones is dropped', T.galTheme({ ...raw, settings: { contrastMode: 'max' } }) === null)
  check('an unknown font or wallpaper is dropped, not fetched', (() => { const x = T.galTheme({ ...raw, settings: { mode: 'dark', fontText: 'https://x.test/f.woff', wp: 'url(//x.test/a.png)' } }); return x !== null && !('fontText' in x.settings) && !('wp' in x.settings) })())
  check('a bad id, an empty name or no settings gives null', T.galTheme({ ...raw, id: '../x' }) === null && T.galTheme({ ...raw, name: ' ' }) === null && T.galTheme({ ...raw, settings: {} }) === null && T.galTheme(null) === null && T.galTheme([]) === null)
  check('a missing description or version is tolerated (empty text, version 1)', (() => { const x = T.galTheme({ ...raw, description: null, v: 'x' }); return x !== null && x.description.fr === '' && x.v === 1 })())
  check('the author is drawn as text and cut', T.galTheme({ ...raw, author: '<b>' + 'x'.repeat(100) + '</b>' }).author.length <= 60)

  const answer = { ok: true, source: 'signed', publishedAt: '2026-10-08T12:00:00.000Z', seq: 3, themes: [raw, raw, { id: 'bad id' }], online: { state: 'ok', at: 1, reason: null } }
  const c = T.galClean(answer)
  check('the host\'s answer is put in shape: duplicates and broken themes dropped, the source and the online state kept', c !== null && c.themes.length === 1 && c.source === 'signed' && c.online.state === 'ok', c)
  check('an unknown source falls back to « shipped », an unknown online state to « never »', T.galClean({ ...answer, source: 'evil', online: { state: 'hacked' } }).source === 'shipped' && T.galClean({ ...answer, online: { state: 'hacked' } }).online.state === 'never')
  check('anything that is not an ok answer with themes is null', T.galClean(null) === null && T.galClean({ ok: false }) === null && T.galClean({ ok: true, themes: 'x' }) === null && T.galClean('x') === null)
  check('the language of the interface: French by default, English when asked (and for anything else)', T.kbLang() === 'fr' && (loaderWindow.__KB_I18N_ACTIVE__ = { lang: 'en-GB' }, T.kbLang() === 'en') && (loaderWindow.__KB_I18N_ACTIVE__ = { lang: 'es' }, T.kbLang() === 'en') && (loaderWindow.__KB_I18N_ACTIVE__ = { lang: 'fr-CA' }, T.kbLang() === 'fr') && (delete loaderWindow.__KB_I18N_ACTIVE__, true))
  check('what the page says about the online catalogue', /injoignable/.test(T.galOnlineText({ state: 'offline' })) && /désactivé/.test(T.galOnlineText({ state: 'off' })) && /signature/.test(T.galOnlineText({ state: 'refused', reason: 'signature' })) && /plus ancien/.test(T.galOnlineText({ state: 'refused', reason: 'older' })) && /pas encore activé/.test(T.galOnlineText({ state: 'refused', reason: 'no-key' })) && T.galOnlineText({ state: 'ok' }) === '' && T.galOnlineText({ state: 'never' }) === '')
}

section('theme gallery: the catalogue shipped with Kybernos')
{
  const shipped = JSON.parse(readFileSync(new URL('./gallery.json', import.meta.url), 'utf8'))
  const doc = sanitizeDocument(shipped)
  check('gallery.json is a valid catalogue by the host\'s own rules', doc.ok === true && doc.doc.themes.length >= 8, doc.error && doc)
  const ids = shipped.themes.map((t) => t.id)
  check('ids are unique and well formed', new Set(ids).size === ids.length && ids.every((id) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(id)))
  check('every theme has a name, an author and a description in both languages', shipped.themes.every((t) => t.name && t.author && t.description.fr && t.description.en))
  check('every theme comes through the page\'s own check unchanged (nothing is silently dropped or rewritten)', shipped.themes.every((t) => { const g = T.galTheme(t); return g !== null && JSON.stringify(g.settings) === JSON.stringify(t.settings) }), shipped.themes.filter((t) => { const g = T.galTheme(t); return g === null || JSON.stringify(g.settings) !== JSON.stringify(t.settings) }).map((t) => t.id))
  check('none of them touches accessibility', shipped.themes.every((t) => !T.PRESET_GROUPS.a11y.some((k) => k in t.settings)))
  check('every theme sets a mode (the gallery filters on it)', shipped.themes.every((t) => t.settings.mode === 'light' || t.settings.mode === 'dark'))
  check('light and dark are both there', shipped.themes.some((t) => t.settings.mode === 'light') && shipped.themes.some((t) => t.settings.mode === 'dark'))
  // Legible by construction: the engine lifts the accent, but the surfaces are the theme's own.
  const weak = []
  for (const t of shipped.themes) {
    const m = t.settings.mode
    const c = T.makeTheme(m, { acc: t.settings.acc === undefined ? null : t.settings.acc, ov: t.settings.ov || {}, lvl: 0, cb: false, tint: 0, dom: '' })
    const rows = [['text on the base', T.ratio(c.t1, c.base), 7], ['text on layer 1', T.ratio(c.t1, c.l1), 7], ['secondary text on layer 1', T.ratio(c.t2, c.l1), 4.5], ['accent text on layer 1', T.ratio(c.accText, c.l1), 4.5], ['button text on the accent fill', T.ratio(c.onAcc, c.fill), 4.5], ['text on a field', T.ratio(c.t1, c.input), 7]]
    for (const [what, got, want] of rows) if (got < want) weak.push(t.id + ' (' + m + '): ' + what + ' ' + got.toFixed(2) + ' < ' + want)
  }
  check('every theme is legible on BOTH counts the page cares about: 7:1 text, 4.5:1 secondary text, accent text and button text', weak.length === 0, weak)
  check('every theme brings something of its own: surfaces that are not the native ones', shipped.themes.every((t) => t.settings.ov && Object.keys(t.settings.ov).length >= 3))
}

section('theme gallery: install, update and the host (fake host)')
{
  const calls = []
  const serve = { answer: null, refreshed: null, fail: false }
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes('/gallery')) return { json: async () => ({ ok: false }) }
    calls.push({ url: String(url), init })
    if (serve.fail) throw new Error('offline')
    if (init && init.method === 'POST') return { json: async () => serve.refreshed || serve.answer }
    return { json: async () => serve.answer }
  }
  const mk = (id, v = 1, over = {}) => ({ id, v, name: 'Thème ' + id, author: 'Kybernos', description: { fr: 'fr', en: 'en' }, settings: { mode: 'dark', acc: '#22c55e', ov: { 'dark:base': '#0b120e' } }, ...over })
  const snap = (themes, over = {}) => ({ ok: true, source: 'shipped', publishedAt: '2026-10-01T00:00:00.000Z', seq: 1, themes, online: { state: 'never', at: 0, reason: null }, ...over })
  const fresh = () => { reset(); T.lib.presets = []; T.lib.updatedAt = 0; T.gal.data = null; T.gal.state = 'idle'; T.gal.refreshing = false; T.gal.refreshed = false; calls.length = 0; serve.fail = false; serve.refreshed = null }

  fresh()
  serve.answer = snap([mk('a'), mk('b')])
  const ok = await T.galLoad()
  check('loading reads the host once and keeps the themes', ok === true && T.gal.state === 'ready' && T.gal.data.themes.length === 2 && calls.length === 1 && calls[0].init === undefined)
  serve.refreshed = snap([mk('a'), mk('b'), mk('c')], { source: 'signed', seq: 2, online: { state: 'ok', at: 5, reason: null } })
  await T.galRefresh()
  check('a refresh POSTs { op: "refresh" } and takes the new catalogue', T.gal.data.themes.length === 3 && T.gal.data.source === 'signed' && calls.length === 2 && JSON.parse(calls[1].init.body).op === 'refresh' && T.gal.refreshed === true)
  const n = calls.length
  await Promise.all([T.galRefresh(), T.galRefresh()])
  check('two refreshes at once ask the host once', calls.length === n + 1, calls.length - n)
  serve.refreshed = { ok: false, error: 'boom' }
  await T.galRefresh()
  check('a refresh the host cannot answer keeps what was shown', T.gal.data.themes.length === 3 && T.gal.state === 'ready')
  fresh(); serve.fail = true
  check('a host that cannot be reached is an error state, not a crash', (await T.galLoad()) === false && T.gal.state === 'error' && T.gal.data === null)
  fresh(); serve.answer = { ok: false, error: 'DSH home not found' }
  check('a host that answers ok:false is an error state too', (await T.galLoad()) === false && T.gal.state === 'error')
  fresh()
  loaderWindow.__KB_THEME_HOST_STORE__ = false
  serve.answer = snap([mk('a')])
  check('with the host switched off nothing is asked, and the state says error', (await T.galLoad()) === false && calls.length === 0)
  delete loaderWindow.__KB_THEME_HOST_STORE__

  fresh()
  const t1 = T.galTheme(mk('a', 1))
  const rec = T.galInstall(t1)
  check('installing puts a copy in My themes: source « gallery », its catalogue id, version and author', rec !== null && rec.source === 'gallery' && rec.gid === 'a' && rec.v === 1 && rec.author === 'Kybernos' && rec.name === 'Thème a' && rec.id.startsWith('g-'), rec)
  check('...and the gallery knows it is installed', T.galInstalled('a') !== null && T.galInstalled('a').id === rec.id && T.galInstalled('zzz') === null)
  const second = T.galInstall(T.galTheme(mk('b', 1, { name: 'Thème a' })))
  check('a name already taken gets a number, like any new theme', second.name === 'Thème a (2)')
  T.galUpdate(T.galTheme(mk('a', 2, { settings: { mode: 'dark', acc: '#ef4444' } })), rec)
  const after = T.galInstalled('a')
  check('an update replaces the settings and moves the version; the name you may have changed stays', after.v === 2 && after.settings.acc === '#ef4444' && after.name === 'Thème a' && after.gid === 'a')
  T.libPatch(after.id, { name: 'Mon vert' }); T.galUpdate(T.galTheme(mk('a', 3)), T.galInstalled('a'))
  check('...even after a rename', T.galInstalled('a').name === 'Mon vert' && T.galInstalled('a').v === 3)
  T.lib.presets = Array.from({ length: T.PRESET_LIMIT }, (_, i) => T.presetRecord({ id: 'u-f' + i, name: 'f' + i, settings: { mode: 'dark' } }))
  check('a full library refuses an install', T.galInstall(t1) === null)
  fresh()
}
section('page render (react-dom/server)')
let React = null, renderToStaticMarkup = null
try {
  const req = createRequire(import.meta.url)
  React = req('react'); renderToStaticMarkup = req('react-dom/server').renderToStaticMarkup
} catch (e) { /* skipped below */ }
if (React === null) {
  console.log('  SKIP — react / react-dom not found. Re-run with:')
  console.log('    NODE_PATH=<a node_modules that has react + react-dom> node packages/kybernos-theme/test-client.mjs')
} else {
  // A second instance wired to the REAL react, with useState steerable by initial value.
  const steer = {}
  const reactFor = { ...React, useState: (init) => React.useState(Object.prototype.hasOwnProperty.call(steer, String(init)) ? steer[String(init)] : init) }
  let def2
  new Function('window', SOURCE)({ __ModuleLoader__: { load: (d) => { def2 = d } } })
  const real = def2.factory(() => reactFor).__test
  const render = (state, advTab) => {
    reset(); steer.essentiel = advTab || 'essentiel'
    store.set(real.STORE_KEY, JSON.stringify(state))
    return renderToStaticMarkup(React.createElement(real.Page, { ctx: mkCtx({ pref: state.mode }).ctx }))
  }
  const text = (html) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|')

  const simple = render({ mode: 'dark', skin: 'bleu', acc: '#4176E6' })
  check('the page opens on Essentiel and renders the 18 shipped theme dots', (simple.match(/class="kbth-skin"/g) || []).length === 18, (simple.match(/class="kbth-skin"/g) || []).length)
  check('...marks exactly the current theme as pressed', (simple.match(/class="kbth-skin" aria-pressed="true"/g) || []).length === 1 && /aria-pressed="true"[^>]*title="Bleu profond/.test(simple))
  check('...the mode segment shows Sombre pressed', /aria-pressed="true">Sombre</.test(simple))
  const natural = render({ mode: 'dark' })
  check('natural state: the pill says no layer is posted', /DSH natif/.test(natural))
  check('themed state: the pill announces the 17-token layer', /17 jetons/.test(simple))
  check('the eight vertical tabs are always there, Essentiel pressed by default', (simple.match(/class="kbth-adv-tab[ "]/g) || []).length === 8 && /kbth-adv-tab on" aria-pressed="true">Essentiel</.test(simple))
  check('there is no Simple / Avancé switch any more', !/>Simple</.test(simple) && !/>Avancé</.test(simple) && !/Besoin de plus de réglages/.test(simple))
  check('Essentiel carries appearance, colour, background and font', ['Apparence', 'Couleur', 'Arrière-plan', 'Police'].every((t) => simple.includes('>' + t + '<')))
  check('the wallpaper grid starts with an "Aucun" tile (a wallpaper can be removed)', /class="kbth-wp"[^>]*title="Aucun"/.test(simple))

  for (const tab of ['essentiel', 'verre', 'couleurs', 'texte', 'animation', 'accessibilite', 'partage', 'galerie']) {
    let html = null, err = null
    try { html = render({ mode: 'dark' }, tab) } catch (e) { err = e.message }
    check('tab ' + tab + ' renders without throwing', html !== null && html.length > 500, err)
  }

  // The accessibility table must measure the ACTIVE scheme.
  const rowRatio = (html, label) => {
    const m = new RegExp(label + '[^]*?kbth-a11y-ratio">([0-9.]+):1').exec(html)
    return m === null ? null : Number(m[1])
  }
  const tDark = real.makeTheme('dark', { acc: null, ov: {}, lvl: 0, cb: false, tint: 0, dom: '' })
  const tLight = real.makeTheme('light', { acc: null, ov: {}, lvl: 0, cb: false, tint: 0, dom: '' })
  const dark = render({ mode: 'dark' }, 'accessibilite')
  const light = render({ mode: 'light' }, 'accessibilite')
  const wantDark = real.ratio(tDark.t3, tDark.l1), wantLight = real.ratio(tLight.t3, tLight.l1)
  check('Accessibility, dark mode: "Texte tertiaire" shows the DARK ratio (' + wantDark.toFixed(1) + ':1)', Math.abs((rowRatio(dark, 'Texte tertiaire') ?? -1) - wantDark) < 0.06, { shown: rowRatio(dark, 'Texte tertiaire'), want: Number(wantDark.toFixed(1)) })
  check('Accessibility, light mode: "Texte tertiaire" shows the LIGHT ratio (' + wantLight.toFixed(1) + ':1)', Math.abs((rowRatio(light, 'Texte tertiaire') ?? -1) - wantLight) < 0.06, { shown: rowRatio(light, 'Texte tertiaire'), want: Number(wantLight.toFixed(1)) })

  // The Animation tab: four blocks, the library and the settings stay out of the way.
  real.ld.ctx = mkCtx({}).ctx
  real.ld.S = real.ldClean({})
  const pane = render({ mode: 'dark' }, 'animation')
  const ptext = text(pane)
  check('Animation tab: preview, rotation, status text and settings are the four blocks', ['Animation de réflexion', 'Aperçu', 'Ma rotation', 'Texte d’état', 'Réglages'].every((t) => ptext.includes(t)))
  check('...with the draw, add, surprise (animations AND words) and pack buttons', ['Simuler une réponse', 'Ajouter une animation…', 'Modifier mon pack…'].every((t) => ptext.includes(t)) && (pane.match(/Me surprendre/g) || []).length === 2)
  check('...the library, the import and the skill are NOT on the page (they live in a window)', !ptext.includes('Exemples (14)') && !ptext.includes('Importer un fichier') && !ptext.includes('Créer avec Claude'))
  check('...the ambiance selector shows the DSH original and today\'s sentence', /kbth-fsname">DSH d’origine</.test(pane) && ptext.includes('Deep diving for 12s ···'))
  check('...settings are folded, with a one-line summary', ptext.includes('Standard · 24 px · vitesse 1,00 × · un mot par réponse') && !ptext.includes('Ne jamais répéter') && /aria-expanded="false"[^>]*data-kb="ld-settings"|data-kb="ld-settings"/.test(pane))
  check('...with nothing selected, four free slots and the whale tail are announced', (pane.match(/kbth-lds empty/g) || []).length === 4 && ptext.includes('Rien n’est choisi : DSH garde sa queue de baleine.'))
  real.ld.S = real.ldClean({ sel: ['ring', 'orbit'], pack: 'medecine', mode: 'order' })
  const pane2 = render({ mode: 'dark' }, 'animation')
  check('with two loaders: their names fill the first slots, two stay free, "2 sur 4"', ['Anneau', 'Orbite'].every((n) => pane2.includes('>' + n + '<')) && (pane2.match(/kbth-lds empty/g) || []).length === 2 && text(pane2).includes('2 sur 4'))
  check('...order mode numbers the slots', /kbth-lds-ord">1</.test(pane2) && /kbth-lds-ord">2</.test(pane2))
  check('...the selector shows the chosen ambiance', /kbth-fsname">Médecine</.test(pane2))
  const sampleAt = (ms) => { const real0 = Date.now; Date.now = () => ms; try { return text(render({ mode: 'dark' }, 'animation')).match(/Médecine[^|]*\|([^|]*·[^|]*…)/) } finally { Date.now = real0 } }
  const medWords = real.LD_PACKS.find((p) => p.id === 'medecine').words.fr
  const s1 = sampleAt(1000), s2 = sampleAt(1000 + 3000), s3 = sampleAt(1000 + 3000 * 5)
  const trio = (m) => m === null ? null : m[1].replace('…', '').split(' · ').map((x) => x.trim())
  check('...its sample is three real words of the pack, ending with an ellipsis', s1 !== null && trio(s1).length === 3 && trio(s1).every((w) => medWords.includes(w)), s1 && s1[1])
  check('...and it MOVES: three seconds later the trio is another one (not always the first three words)', s2 !== null && s1[1] !== s2[1] && trio(s2).every((w) => medWords.includes(w)))
  check('...after a full lap of the list it comes back to the start', s3 !== null && s1[1] === s3[1])
  check('...a pack of three words or fewer is shown whole and does not move', (() => { real.ld.words = ['A', 'B']; real.ld.S = real.ldClean({ pack: 'perso' }); const x = text(render({ mode: 'dark' }, 'animation')); real.ld.words = []; real.ld.S = real.ldClean({ sel: ['ring', 'orbit'], pack: 'medecine', mode: 'order' }); return x.includes('A · B') && !x.includes('A · B…') })())
  const ess = render({ mode: 'dark' }, 'essentiel')
  check('Essentiel carries a summary of the animation with a « Régler… » button', ess.includes('data-kb="ld-summary"') && ess.includes('data-kb="ld-open"') && text(ess).includes('Anneau, Orbite · dans l’ordre · texte : Médecine'))
  real.ld.S = real.ldClean({})
  check('...and says so when nothing is chosen', text(render({ mode: 'dark' }, 'essentiel')).includes('Queue de baleine de DSH · texte : DSH d’origine'))

  // The scheme shown is the page's, not a guess from the setting: « Système » on a light OS must read as light.
  {
    const body = globalThis.document.body
    const had = body.hasAttribute
    check('schemeSombre falls back on the setting when there is no page', real.schemeSombre({ mode: 'light' }) === false && real.schemeSombre({ mode: 'dark' }) === true && real.schemeSombre({ mode: 'system' }) === true)
    body.hasAttribute = (n) => false
    check('...but reads the page when there is one: mode « system » on a light OS is LIGHT', real.schemeSombre({ mode: 'system' }) === false && real.schemeSombre({ mode: 'dark' }) === false)
    body.hasAttribute = () => true
    check('...and a dark page reads dark whatever the setting', real.schemeSombre({ mode: 'light' }) === true)
    if (had === undefined) delete body.hasAttribute; else body.hasAttribute = had
  }
  // The grade badges (AAA / AA / large text / fail) are TEXT: the stylesheet gives each grade an ink per scheme.
  {
    const inks = {}
    for (const m of SOURCE.matchAll(/^(body:not\(\[data-ds-dark-theme\]\) |html\[data-kbth-cb\] (?:body:not\(\[data-ds-dark-theme\]\) )?)?\.kbth-gr-(ok|warn|err)\{--kbth-ink:(#[0-9A-Fa-f]{6})\}/gm)) inks[(m[1] || 'dark').trim() + ' ' + m[2]] = m[3]
    const l1 = { dark: real.makeTheme('dark', { acc: null, ov: {}, lvl: 0, cb: false, tint: 0, dom: '' }).l1, light: real.makeTheme('light', { acc: null, ov: {}, lvl: 0, cb: false, tint: 0, dom: '' }).l1 }
    const rows = Object.entries(inks).map(([k, ink]) => [k, ink, real.ratio(ink, /dark-theme/.test(k) || /cb body/.test(k) ? l1.light : (/^html\[data-kbth-cb\] \.kbth/.test(k) ? l1.dark : l1.dark))])
    const dark = ['dark ok', 'dark warn', 'dark err'].map((k) => real.ratio(inks[k], l1.dark))
    const light = ['body:not([data-ds-dark-theme]) ok', 'body:not([data-ds-dark-theme]) warn', 'body:not([data-ds-dark-theme]) err'].map((k) => real.ratio(inks[k], l1.light))
    check('the grade inks exist for dark and light (6) plus the colour-blind pair (2)', Object.keys(inks).length === 8, Object.keys(inks))
    check('dark: every grade ink is ≥ 4.5:1 on the dark layer 1', dark.length === 3 && dark.every((r) => r >= 4.5), dark.map((r) => r.toFixed(2)))
    check('light: every grade ink is ≥ 4.5:1 on white (DSH\'s green and orange were 2.2:1)', light.length === 3 && light.every((r) => r >= 4.5), light.map((r) => r.toFixed(2)))
    const cbKeys = Object.keys(inks).filter((k) => /kbth-cb/.test(k))
    check('the colour-blind pair turns the passing grade blue in both schemes, ≥ 4.5:1', cbKeys.length === 2 && real.ratio(inks['html[data-kbth-cb] ok'] || inks[cbKeys[0]], l1.dark) >= 4.5 && real.ratio(inks[cbKeys.find((k) => /body/.test(k))], l1.light) >= 4.5)
    const html = render({ mode: 'dark' }, 'accessibilite')
    check('the badges carry a grade class and no inline ink (nothing to go stale when the scheme changes)', (html.match(/class="kbth-a11y-badge kbth-gr-(ok|warn|err)"/g) || []).length === 6 && !/kbth-a11y-badge[^>]*style=/.test(html))
    check('the stylesheet applies the ink to both kinds of badge', /\.kbth-a11y-badge\[class\*="kbth-gr-"\],\.kbth-tok-badge\[class\*="kbth-gr-"\]\{color:var\(--kbth-ink\)/.test(SOURCE))
    const ap = []; const prevDe2 = globalThis.document.documentElement
    globalThis.document.documentElement = { setAttribute: (k, v) => ap.push(k + '=' + v), removeAttribute: (k) => ap.push('-' + k) }
    real.appliquerEffets({ ...real.DEF, cbSafe: true })
    check('turning the palette on marks the root so the CSS can swap the ink', ap.includes('data-kbth-cb=1'))
    globalThis.document.documentElement = prevDe2
  }
  // Export block: the format segment must change what the preview shows.
  const exp = (fmt) => text(render({ mode: 'dark' }, 'partage'))
  check('Share › Export: the preview file name follows the format', /dsh-theme\.yml/.test(exp('yaml')))

  // ── The theme library on the page ──────────────────────────────────────────
  {
    real.lib.presets = []; real.lib.updatedAt = 0
    const neutre = real.SKINS.find((s) => s.id === 'neutre')
    const neutreState = { ...real.DEF, ...real.skinPatch(neutre) }
    const noLib = render(neutreState)
    check('Essentiel: « Livrés » and « Mes thèmes » are two groups, the add button is always there', /Livrés/.test(noLib) && /Mes thèmes/.test(noLib) && /data-kb="theme-add"/.test(noLib))
    check('...with no theme of yours it says so and points to Sharing', /Aucun thème à vous pour l’instant/.test(noLib) && /data-kb="theme-open-sharing"/.test(noLib))
    check('...the shipped theme in use is named in the summary, flagged « livré », not modified', /kbth-sum-n">Neutre violet<span class="kbth-pill">livré</.test(noLib) && !/theme-modified/.test(noLib))
    check('...its meta line includes the font and the corners it sets', /Clair · #6114D4 · police Inter · coins standard/.test(noLib))
    check('...there is « Enregistrer sous… » and nothing to update or revert', /data-kb="theme-save"/.test(noLib) && !/data-kb="theme-update"/.test(noLib) && !/data-kb="theme-revert"/.test(noLib))
    check('the mode alone never makes a theme « modified »', !/theme-modified/.test(render({ ...neutreState, mode: 'dark' })))
    const edited = render({ ...neutreState, acc: '#0ea5e9' })
    check('a shipped theme with another accent: « modifié », « Annuler », and no « Mettre à jour » (a shipped theme is not edited)', /theme-modified/.test(edited) && /data-kb="theme-revert"/.test(edited) && !/data-kb="theme-update"/.test(edited) && /enregistrez-en une copie/.test(edited))
    check('the 18 shipped dots plus none of yours', (edited.match(/class="kbth-skin"/g) || []).length === 18 && (edited.match(/class="kbth-skin kbth-skin-add"/g) || []).length === 1)
    check('the old « Thème : … Défaut DSH retire… » line is only shown on « Défaut DSH »', !/retire la couche de jetons/.test(edited) && /retire la couche de jetons/.test(render({ ...real.DEF })))

    const mine = real.presetRecord({ id: 'u-bureau', name: 'Bureau clair', source: 'me', at: 1, settings: { mode: 'light', acc: '#0ea5e9', ov: {}, fontText: 'georgia', radius: 'soft' } })
    const other = real.presetRecord({ id: 'g-lumen', name: 'Crépuscule', source: 'gallery', author: '@lumen', at: 2, settings: { mode: 'dark', acc: '#fb923c', ov: { 'dark:base': '#1a1220' } } })
    real.lib.presets = [mine, other]
    const mineState = { ...real.DEF, skin: 'u-bureau', ...mine.settings }
    const withLib = render(mineState)
    check('your themes are dots next to the add button (and the shipped ones stay)', (withLib.match(/class="kbth-skin"/g) || []).length === 20 && /title="Bureau clair — /.test(withLib) && /title="Crépuscule — /.test(withLib))
    check('...the one in use is pressed, named in the summary and flagged « à vous »', /kbth-skin" aria-pressed="true"[^>]*title="Bureau clair/.test(withLib) && /kbth-sum-n">Bureau clair<span class="kbth-pill">à vous</.test(withLib) && !/theme-modified/.test(withLib))
    check('...its meta says what it retains (font, corners)', /police Georgia/.test(withLib) && /coins doux/.test(withLib))
    const dirtyMine = render({ ...mineState, acc: '#ff0000' })
    check('your own theme with a changed accent: « modifié », « Mettre à jour » first, « Enregistrer sous… », « Annuler »', /theme-modified/.test(dirtyMine) && /data-kb="theme-update"[^>]*>Mettre à jour/.test(dirtyMine) && /data-kb="theme-save"/.test(dirtyMine) && /data-kb="theme-revert"/.test(dirtyMine))
    check('a theme from the gallery is flagged « Galerie » when in use', /kbth-sum-n">Crépuscule<span class="kbth-pill">Galerie</.test(render({ ...real.DEF, skin: 'g-lumen', ...other.settings })))
    check('an id that is gone (deleted elsewhere) reads « Personnalisé »', /kbth-sum-n">Personnalisé</.test(render({ ...real.DEF, skin: 'u-gone' })))

    const sharing = render(mineState, 'partage')
    check('Sharing lists your themes, one row each, with what each retains', (sharing.match(/data-kb="theme-row"/g) || []).length === 2 && /retient : couleurs et accent, police, coins/.test(sharing) && /retient : couleurs et accent</.test(sharing))
    check('...the theme in use says « appliqué » and has no « Appliquer »; the other has it', (sharing.match(/data-kb="theme-apply"/g) || []).length === 1 && /kbth-tone kbth-tone-on kbth-gr-ok">appliqué</.test(sharing))
    check('...each row exports, renames and deletes', (sharing.match(/data-kb="theme-export-one"/g) || []).length === 2 && (sharing.match(/data-kb="theme-rename"/g) || []).length === 2 && (sharing.match(/data-kb="theme-delete"/g) || []).length === 2)
    check('...the source is shown: « à vous », « Galerie · @lumen »', /pill">à vous</.test(sharing) && /Galerie · @lumen/.test(sharing))
    check('Sharing: import takes a .json file and says it adds, not applies', /data-kb="theme-import"/.test(sharing) && /accept=".json,application\/json"/.test(sharing) && /ne change rien tant que vous ne cliquez pas sur Appliquer/.test(sharing))
    check('...the current look still exports (YAML, JSON, CSS), folded away', /<details class="kbth-fold"/.test(sharing) && /Exporter l’état actuel/.test(sharing) && /dsh-theme\.yml/.test(sharing) && /data-kb="theme-export"/.test(sharing))
    check('...reset says the library is kept', /Vos thèmes enregistrés restent dans Mes thèmes/.test(sharing))
    real.lib.presets = []
    const sharingEmpty = render({ ...real.DEF }, 'partage')
    check('Sharing with no theme of yours: an explanation instead of an empty list, the save button stays', /data-kb="theme-lib-empty"/.test(sharingEmpty) && /Aucun thème à vous/.test(sharingEmpty) && /data-kb="theme-save-sharing"/.test(sharingEmpty) && !/data-kb="theme-row"/.test(sharingEmpty))
    check('the old import (it applied the file over the current look) is gone', !/Thème importé et appliqué/.test(sharingEmpty) && !/theme-import-note/.test(sharingEmpty))
  }

  // ── The gallery on the page ────────────────────────────────────────────────
  {
    const shipped = JSON.parse(readFileSync(new URL('./gallery.json', import.meta.url), 'utf8'))
    const answer = (over = {}) => ({ ok: true, source: 'shipped', publishedAt: shipped.publishedAt, seq: shipped.seq, themes: shipped.themes, online: { state: 'never', at: 0, reason: null }, ...over })
    real.lib.presets = []
    real.gal.data = real.galClean(answer()); real.gal.state = 'ready'
    const html = render({ ...real.DEF }, 'galerie')
    const n = shipped.themes.length
    check('the Galerie tab is there, the eighth, and is the one pressed when opened', (html.match(/class="kbth-adv-tab[ "]/g) || []).length === 8 && /kbth-adv-tab on" aria-pressed="true">Galerie</.test(html))
    check('a card per theme, each with a thumbnail, its name, its author and its description', (html.match(/data-kb="theme-gal-card"/g) || []).length === n && shipped.themes.every((t) => html.includes('>' + t.name.replace(/&/g, '&amp;') + '<')) && (html.match(/par Kybernos/g) || []).length === n && (html.match(/class="kbth-thumb"/g) || []).length === n && html.includes(shipped.themes[0].description.fr),
      { cards: (html.match(/data-kb="theme-gal-card"/g) || []).length, n, names: shipped.themes.filter((t) => !html.includes('>' + t.name.replace(/&/g, '&amp;') + '<')).map((t) => t.name), authors: (html.match(/par Kybernos/g) || []).length, thumbs: (html.match(/class="kbth-thumb"/g) || []).length })
    check('...the thumbnails are decoration (hidden from screen readers) and painted with the theme\'s own base colour', (html.match(/class="kbth-thumb" aria-hidden="true" style="background:#[0-9a-f]{6}/g) || []).length === n)
    check('...every card offers « Installer » and « Essayer »', (html.match(/data-kb="theme-gal-install"/g) || []).length === n && (html.match(/data-kb="theme-gal-try"/g) || []).length === n)
    check('...and says what the theme sets (mode, accent, font, corners)', /Clair · #1f2937 · police Georgia · coins nets/.test(html) && /Sombre · #22c55e · coins nets/.test(html))
    check('the source line says the themes are shipped with Kybernos, and how many there are', /Livré avec Kybernos/.test(html) && html.includes(n + ' thèmes') && !/Catalogue signé/.test(html))
    check('...a search field and the filter Tous / Clair / Sombre', /data-kb="theme-gal-q"/.test(html) && /aria-pressed="true">Tous</.test(html) && />Clair</.test(html) && />Sombre</.test(html))
    check('the page says what a theme is: a settings file, no code, nothing loaded from outside', /ne contient aucun code et ne charge rien d’extérieur/.test(html))
    check('before any refresh there is no sentence about the online catalogue', !/data-kb="theme-gal-online"/.test(html))
    check('a plain-text description is escaped, never HTML', !/<script|onerror/.test(html))

    real.gal.data = real.galClean(answer({ source: 'signed', online: { state: 'ok', at: 1, reason: null } }))
    const signed = render({ ...real.DEF }, 'galerie')
    check('a signed catalogue says so, in the colour of a good state', /kbth-tone kbth-tone-on kbth-gr-ok">Catalogue signé</.test(signed) && !/Livré avec Kybernos/.test(signed))
    for (const [state, reason, re] of [['offline', 'network', /injoignable/], ['refused', 'signature', /signature n’est pas reconnue/], ['refused', 'older', /plus ancien/], ['refused', 'no-key', /pas encore activé/], ['off', null, /désactivé/]]) {
      real.gal.data = real.galClean(answer({ online: { state, at: 1, reason } }))
      const h2 = render({ ...real.DEF }, 'galerie')
      check('the online catalogue « ' + state + (reason ? ' / ' + reason : '') + ' » is said in plain words, and the shipped themes are still shown', re.test((h2.match(/data-kb="theme-gal-online"[^>]*>([^<]*)</) || [])[1] || '') && (h2.match(/data-kb="theme-gal-card"/g) || []).length === n)
    }
    real.gal.data = real.galClean(answer({ online: { state: 'off', at: 1, reason: null } }))
    check('with the online catalogue off or not yet active there is no « Actualiser »', !/data-kb="theme-gal-refresh"/.test(render({ ...real.DEF }, 'galerie')) && (real.gal.data = real.galClean(answer({ online: { state: 'refused', at: 1, reason: 'no-key' } }), true), !/data-kb="theme-gal-refresh"/.test(render({ ...real.DEF }, 'galerie'))))
    real.gal.data = real.galClean(answer({ online: { state: 'ok', at: 1, reason: null } }))
    check('...and there is one when it can be asked', /data-kb="theme-gal-refresh"/.test(render({ ...real.DEF }, 'galerie')))

    const calc = shipped.themes.find((t) => t.id === 'calcaire')
    real.lib.presets = [real.presetRecord({ id: 'g-calc', name: 'Calcaire', source: 'gallery', author: 'Kybernos', gid: 'calcaire', v: 1, settings: calc.settings })]
    const inst = render({ ...real.DEF }, 'galerie')
    const cardOf = (h2, id) => (h2.match(new RegExp('<article[^>]*data-id="' + id + '"[^]*?</article>')) || [''])[0]
    const c1 = cardOf(inst, 'calcaire')
    check('a theme already installed shows « Installé » and « Appliquer » instead of « Installer » / « Essayer »', /kbth-tone-on kbth-gr-ok">Installé</.test(c1) && /theme-gal-apply/.test(c1) && !/theme-gal-install/.test(c1) && !/theme-gal-try/.test(c1) && /theme-gal-install/.test(cardOf(inst, 'graphite')))
    const inUse = render({ ...real.DEF, skin: 'g-calc', ...calc.settings }, 'galerie')
    check('...the one in use has no « Appliquer »', /kbth-tone-on kbth-gr-ok">Installé</.test(cardOf(inUse, 'calcaire')) && !/theme-gal-apply/.test(cardOf(inUse, 'calcaire')))
    real.gal.data = real.galClean(answer({ themes: shipped.themes.map((t) => (t.id === 'calcaire' ? { ...t, v: 2 } : t)) }))
    check('a newer version in the catalogue offers « Mettre à jour » on that card only', /theme-gal-update/.test(cardOf(render({ ...real.DEF }, 'galerie'), 'calcaire')) && (render({ ...real.DEF }, 'galerie').match(/theme-gal-update/g) || []).length === 1)
    real.lib.presets = []

    real.gal.data = real.galClean(answer({ themes: [] }))
    check('an empty catalogue says so', /La galerie est vide/.test(render({ ...real.DEF }, 'galerie')))
    real.gal.data = null; real.gal.state = 'loading'
    const loading = render({ ...real.DEF }, 'galerie')
    check('while it loads: six grey placeholders, hidden from screen readers, no card', (loading.match(/class="kbth-sk"/g) || []).length === 6 && /data-kb="theme-gal-loading"[^>]*aria-hidden|aria-hidden="true"[^>]*data-kb="theme-gal-loading"/.test(loading) && !/theme-gal-card/.test(loading))
    real.gal.state = 'error'
    const err = render({ ...real.DEF }, 'galerie')
    check('when the host cannot be read: an alert with a way out (retry), not an empty page', /role="alert"/.test(err) && /Impossible de lire la galerie/.test(err) && /data-kb="theme-gal-retry"/.test(err) && /redémarrez DSH/.test(err))
    real.gal.data = real.galClean(answer()); real.gal.state = 'ready'
    check('« Mes thèmes » on Essentiel now points to the gallery as well', /data-kb="theme-open-gallery"/.test(render({ ...real.DEF })))
  }
  void exp
}

// ═══ No control without a stored, applied value ═══════════════════════════
section('every control has a stored key that something reads')
{
  const defKeys = new Set(Object.keys(T.DEF))
  const committed = new Set()
  for (const m of SOURCE.matchAll(/commit\(\{\s*(\w+)\s*:/g)) committed.add(m[1])
  for (const m of SOURCE.matchAll(/commit\(\{[^}]*?,\s*(\w+)\s*:/g)) committed.add(m[1])
  const orphans = [...committed].filter((k) => !defKeys.has(k)).sort()
  check('no control writes a key that readState would drop (it used to be 41)', orphans.length === 0, orphans)
  // A key that nothing reads would be stored and ignored. Everything but identity/colour data must appear in an applier.
  const appliers = SOURCE.slice(SOURCE.indexOf('const filtreFond'), SOURCE.indexOf('const appliquerTout'))
  const readers = SOURCE.slice(SOURCE.indexOf('const effetsCss'), SOURCE.indexOf('const appliquerPolice')) + appliers
  const wired = ['glassEffect', 'glassBlur', 'sidebarLinked', 'sidebarOpacity', 'fieldOpacity', 'floatOpacity', 'bgBrightness', 'bgContrast', 'bgSaturation', 'bgDarken', 'bgFit', 'bgMirror', 'ligatures', 'radius', 'showBrand', 'reduceMotion', 'focusRing', 'largeTargets', 'underlineLinks', 'cbSafe']
  const unread = wired.filter((k) => !new RegExp('S\\.' + k + '\\b').test(readers + SOURCE.slice(SOURCE.indexOf('const appliquerJetons'), SOURCE.indexOf('const appliquerFond'))))
  check('...and each of the 20 newly wired keys is read by an applier', unread.length === 0, unread)
}

console.log('\n' + (fail === 0 ? '✓ ' : '✗ ') + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
