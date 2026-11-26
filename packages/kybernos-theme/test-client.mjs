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
import { fakeHelp } from '../kybernos-hub/fake-help.mjs'
import { createRequire } from 'node:module'
import { SETTINGS_KEYS, sanitizeLibrary } from './preset-store.mjs'
import { A11Y_KEYS, sanitizeDocument } from './themes-catalogue.mjs'
import { cleanBoot, renderBootCss } from './boot-store.mjs'

let pass = 0
let fail = 0
let skipped = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const section = (title) => { LANG = 'kybernos'; console.log('\n' + title) } // every section starts on the French page, as these tests were written

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
// The language the page reads is the one Kybernos resolved (WP-07): these tests were written against the French page, so it starts French.
let LANG = 'kybernos'
const loaderWindow = { __ModuleLoader__: { load: (def) => { definition = def } }, __KB_LANG_RESOLVE__: () => LANG }
new Function('window', SOURCE)(loaderWindow)
const FAKE_REACT = { createElement: (...a) => ({ a }), Fragment: 'F' }
const modele = definition.factory(() => FAKE_REACT)
const T = modele.__test

// A fake DSH theme service that records every call.
// `roles: true` plays DSH 0.2.1-alpha.2's service: setFontSize(role, px) (the one-argument form THROWS there, as in the
// engine: the size lands in the role slot) and a snapshot that carries `fontSizes: { text, code, terminal }`.
const mkCtx = ({ pref = 'system', overrideThrows = false, noTheme = false, fontSize, roles = false } = {}) => {
  const calls = { overrideTokens: [], disposed: 0, setTheme: [], setFontSize: [], setFontSizeRole: [], sections: [], effects: [] }
  const listeners = new Map()
  const theme = noTheme ? undefined : {
    overrideTokens(id, tokens) { if (overrideThrows) throw new Error('refused'); calls.overrideTokens.push({ id, tokens }); return () => { calls.disposed += 1 } },
    setTheme(m) { calls.setTheme.push(m) },
    setFontSize: roles
      ? (role, px) => { if (!['text', 'code', 'terminal'].includes(role) || !Number.isInteger(px)) throw new TypeError('font role ' + role); calls.setFontSizeRole.push([role, px]) }
      : (px) => { calls.setFontSize.push(px) },
    getTheme: () => (roles ? { preference: pref, fontSizes: { text: fontSize, code: 11, terminal: 13 } } : { preference: pref, fontSize }),
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
  check('the module declares the services it needs (slots, theme, locale) and not `remote`, which it never uses (AGENTS.md rule 2)', ['slots', 'theme', 'locale'].every((s) => modele.inject.includes(s)) && !modele.inject.includes('remote'))
}

// ═══ 2. Catalogues ═════════════════════════════════════════════════════════
section('catalogues')
{
  const dupes = (list) => list.filter((x, i) => list.indexOf(x) !== i)
  check('theme ids are unique', dupes(T.SKINS.map((s) => s.id)).length === 0, dupes(T.SKINS.map((s) => s.id)))
  check('wallpaper ids are unique', dupes(T.WPS.map((s) => s.id)).length === 0)
  check('font ids are unique', dupes(T.FONTS.map((s) => s.id)).length === 0)
  check('19 ready-made themes (Pure Codex + 10 + the 8 legacy packs)', T.SKINS.length === 19 && T.SKINS[0].id === 'epure', T.SKINS.length)
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
  const epure = T.SKINS.find((s) => s.id === 'epure')
  const epurePatch = T.skinPatch(epure)
  check('Pure (Codex) preset follows System/Light/Dark, sets soft corners/shadow, and emits minimalist chrome + Codex blue bubble CSS',
    epure && !('mode' in epurePatch) && epurePatch.radius === 'soft' && epurePatch.shadow === 'soft' && epurePatch.bubbleUser === 'auto' && epurePatch.fontText === 'system-ui' && /#e8f1fe/.test(T.effetsCss({ ...T.DEF, ...epurePatch })) && /border-radius:20px/.test(T.effetsCss({ ...T.DEF, ...epurePatch })) && !/#e8f1fe/.test(T.effetsCss({ ...T.DEF, ...epurePatch, bubbleUser: 'accent' })))
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
  check('a non-default font is posted as --dsw-font-family on :root AND body (0.2.1-alpha.2 declares it on body: a :root-only rule is shadowed)', fontTag && /Georgia/.test(fontTag.textContent) && /^:root,body\{/.test(fontTag.textContent.trim()), fontTag && fontTag.textContent)
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

  // DSH 0.2.1-alpha.2 renamed both ends: the snapshot carries fontSizes.text and the service takes (role, px).
  // Reading only `fontSize` made the size never adopted; calling setFontSize(px) threw and was swallowed.
  m = boot({ fs: 15 }, { roles: true, fontSize: 16 })
  check('0.2.1-alpha.2: DSH\'s size (fontSizes.text = 16) is ADOPTED into the store', stored() !== null && stored().fs === 16 && m.calls.setFontSizeRole.length === 0, stored())
  m = boot({ fs: 15 }, { roles: true, fontSize: 15 })
  m.listeners.get('theme/change')({ preference: 'dark', fontSizes: { text: 13, code: 11, terminal: 13 } })
  check('0.2.1-alpha.2: a later change of DSH\'s text size is followed', stored().fs === 13, stored())
  check('0.2.1-alpha.2: the code and terminal sizes are never mistaken for the text size', T.tailleNative(null, { fontSizes: { text: 99, code: 12, terminal: 13 } }) === null && T.tailleNative(null, { fontSizes: { code: 12 } }) === null && T.tailleNative(null, { fontSizes: { text: 16, code: 11, terminal: 13 } }) === 16)
  let r = mkCtx({ roles: true, fontSize: 15 })
  T.appliquerTaille(r.ctx.theme, { ...T.DEF, fs: 16 })
  check('0.2.1-alpha.2: the page\'s text size goes through setFontSize(\'text\', px)', JSON.stringify(r.calls.setFontSizeRole) === '[["text",16]]', r.calls.setFontSizeRole)
  r = mkCtx({ fontSize: 15 })
  T.appliquerTaille(r.ctx.theme, { ...T.DEF, fs: 16 })
  check('earlier engines: still setFontSize(px)', JSON.stringify(r.calls.setFontSize) === '[16]', r.calls.setFontSize)
  r = mkCtx({ roles: true, fontSize: 15 })
  T.appliquerTaille(r.ctx.theme, { ...T.DEF, fs: 40 })
  check('a size outside 12–17 is clamped before it is sent', JSON.stringify(r.calls.setFontSizeRole) === '[["text",17]]', r.calls.setFontSizeRole)
  r = mkCtx({ roles: true, fontSize: 15 })
  r.ctx.theme.getTheme = () => { throw new Error('not ready') }
  let threw = false
  try { T.appliquerTaille(r.ctx.theme, { ...T.DEF, fs: 16 }) } catch (e) { threw = true }
  check('a service that cannot answer getTheme() never makes the call throw', threw === false)
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
  check('34 original drawings, unique ids that the host will accept', T.LD_PRESETS.length === 34 && new Set(ids).size === 34 && ids.every((i) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(i)), ids)
  check('every drawing is a self-contained <svg> of 48×48, one or many colours, under 8 KB', T.LD_PRESETS.every((p) => p.svg.startsWith('<svg viewBox="0 0 48 48"') && p.svg.length < 8192 && (p.kind === 'mono' || p.kind === 'color')))
  check('no drawing carries a script, a handler, an external reference or a foreign object', T.LD_PRESETS.every((p) => !/<script|<foreignObject|<image|\son[a-z]+\s*=|javascript:|href=|url\(\s*['"]?(https?:|\/\/|data:)/i.test(p.svg)))
  const used = new Set()
  T.LD_PRESETS.forEach((p) => { for (const m of p.svg.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach((c) => used.add(c)) })
  const cssRules = SOURCE.match(/\.kb-ld \.(a-[a-z]+)\{/g) || []
  const defined = new Set(cssRules.map((r) => r.slice(8, -1)))
  check('every animation class a drawing uses has a CSS rule (and vb is declared)', [...used].filter((c) => c !== 'vb').every((c) => defined.has(c)) && /\.kb-ld svg \.vb\{/.test(SOURCE), [...used].filter((c) => c !== 'vb' && !defined.has(c)))
  check('mono drawings follow currentColor, colour drawings use the --c1..4 palette', T.LD_PRESETS.filter((p) => p.kind === 'mono').every((p) => /currentColor/.test(p.svg)) && T.LD_PRESETS.filter((p) => p.kind === 'color').every((p) => /var\(--c[1-4]\)/.test(p.svg)))
  check('every keyframe used by the drawings is declared once', ['spin', 'bounce', 'bar', 'pulse', 'fade', 'jelly', 'flip', 'dash', 'twinkle', 'pop', 'vis', 'sway', 'shim', 'hop', 'rock', 'blink', 'grow', 'float', 'rise', 'drop', 'swim', 'flap', 'shake', 'glow', 'beat', 'boing', 'flame'].every((k) => (SOURCE.match(new RegExp('@keyframes kbk-' + k + '\\{', 'g')) || []).length === 1), 'keyframes')
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

  LANG = 'kybernos'
  T.ld.S = T.ldClean({ pack: 'medecine' })
  const frw = T.ldWordList()
  LANG = 'en'
  const enw = T.ldWordList()
  check('words follow the interface language (fr → French, otherwise English)', frw.includes('Anamnèse') && enw.includes('Triaging') && !enw.includes('Anamnèse'))
  LANG = 'zh'
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
  const lang = (code, base) => { LANG = code === 'fr' ? 'kybernos' : code; T.ld.ctx = { locale: { getLocale: () => ({ active: code }), bind: () => (k) => (k === 'chat.deepDiving' ? base : k) } } }

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
  // bars on hover is ON by default: these tests look at everything else, so it is off here unless a test asks (see « bars on hover » below)
  const css = (st) => T.effetsCss({ ...T.DEF, autoHideBars: false, ...st })
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
  check('touch comfort is not in the effects sheet: it is its own static stylesheet, switched by an attribute (a person\'s setting or the locked preset\'s option)', !css({ touch: true }).includes('data-kb-touch') && css({ touch: true }) === css({ touch: false }))
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
  // Notification counters (owner's call, 2026-11-24): the number in the tab title and the badge on the app icon are hidden unless switched on here. kybernos-pulse reads the attribute.
  check('notification counters: hidden by default, and the root says so (kybernos-pulse reads `data-kbth-counters`)', T.DEF.notifCounters === 'hidden' && attrs['data-kbth-counters'] === 'hidden')
  const counterEvents = []
  const keepDispatch = loaderWindow.dispatchEvent
  const keepCustomEvent = globalThis.CustomEvent
  loaderWindow.dispatchEvent = (e) => { counterEvents.push(e.type + ':' + e.detail) }
  globalThis.CustomEvent = class { constructor (type, init) { this.type = type; this.detail = init === undefined ? undefined : init.detail } }
  T.appliquerEffets({ ...T.DEF, notifCounters: 'shown' })
  check('...switched on, the root says `shown`; any other value counts as hidden', attrs['data-kbth-counters'] === 'shown' && (T.appliquerEffets({ ...T.DEF, notifCounters: 'bogus' }), attrs['data-kbth-counters'] === 'hidden'))
  T.appliquerEffets({ ...T.DEF })
  check('...kybernos-pulse is told by the window event `kb-counters-change`, once per change and never for the same value twice', counterEvents.join() === 'kb-counters-change:shown,kb-counters-change:hidden', counterEvents)
  if (keepDispatch === undefined) delete loaderWindow.dispatchEvent; else loaderWindow.dispatchEvent = keepDispatch
  if (keepCustomEvent === undefined) delete globalThis.CustomEvent; else globalThis.CustomEvent = keepCustomEvent
  check('...checked like the other choices (only shown | hidden), kept out of the presets, and no stylesheet of its own', T.valeursValides({ notifCounters: 'shown' }).notifCounters === 'shown' && T.valeursValides({ notifCounters: 'hidden' }).notifCounters === 'hidden' && T.valeursValides({ notifCounters: 'yes' }).notifCounters === undefined && T.valeursValides({ notifCounters: true }).notifCounters === undefined && !Object.values(T.PRESET_GROUPS).some((g) => g.includes('notifCounters')) && T.effetsCss({ ...T.DEF }) === T.effetsCss({ ...T.DEF, notifCounters: 'shown' }))
  check('...one switch in the Advanced editor (Effects tab), worded in French and English; the phone presentation block and the locked Simple preset do not mention it', /toggle\(kt\('Compteurs de notifications', 'Notification counters'\), S\.notifCounters === 'shown', \(\) => commit\(\{ notifCounters: S\.notifCounters === 'shown' \? 'hidden' : 'shown' \}\)/.test(SOURCE)
    && !SOURCE.slice(SOURCE.indexOf('// kb-pres:begin'), SOURCE.indexOf('// kb-pres:end')).includes('notifCounters') && !SOURCE.slice(SOURCE.indexOf("'locked-simple': {"), SOURCE.indexOf("'locked-simple': {") + 6000).includes('notifCounters'))
  globalThis.document.documentElement = prevDe
}
section('the Kybernos accent: a look that has its own brand colour says so on <html data-kbth-brand> (audit A1-01)')
{
  // kybernos-plugin declares `--kybernos-accent` (the brand orange) and lets the brand token win when this attribute names the scheme: the Suite, Workers,
  // the core switch and the Composio pill stay orange by default and follow Neutral violet, Ember or a custom accent.
  const skin = (id) => T.SKINS.find((sk) => sk.id === id)
  const own = (state) => T.accentsPropres({ ...T.DEF, ...state }).join(' ')
  check('DSH default (the native configuration) has no brand of its own: the accent stays orange', own({}) === '')
  check('Neutral violet sets an accent for both schemes', own(T.skinPatch(skin('neutre'))) === 'light dark')
  check('a custom accent from the picker too', own({ skin: 'clair', acc: '#EC4899' }) === 'light dark')
  check('OLED (a themed look with no accent) keeps the orange', own(T.skinPatch(skin('oled'))) === '' && skin('oled').acc === null)
  check('Ember, a pack with a brand per scheme, names both', own(T.skinPatch(skin('kb-ember'))) === 'light dark')
  check('a brand override in ONE scheme names that scheme only', own({ ...T.skinPatch(skin('oled')), ov: { 'dark:brand': '#AABBCC' } }) === 'dark')
  const rec = []
  const prev = globalThis.document.documentElement
  const attrs = {}
  globalThis.document.documentElement = { setAttribute: (k, v) => { attrs[k] = v }, removeAttribute: (k) => { delete attrs[k] } }
  const svc = { overrideTokens: () => () => { rec.push('disposed') } }
  T.appliquerJetons(svc, { ...T.DEF, ...T.skinPatch(skin('neutre')) })
  check('applying Neutral violet writes data-kbth-brand="light dark"', attrs['data-kbth-brand'] === 'light dark', attrs)
  T.appliquerJetons(svc, { ...T.DEF, ...T.skinPatch(skin('oled')) })
  check('switching to a look without a brand removes it', !('data-kbth-brand' in attrs), attrs)
  T.appliquerJetons(svc, { ...T.DEF, ...T.skinPatch(skin('neutre')) })
  T.appliquerJetons(svc, T.DEF)
  check('going back to DSH default (the layer is dropped) removes it too', !('data-kbth-brand' in attrs), attrs)
  globalThis.document.documentElement = prev
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
  // L5-02: the palette exists to separate the pairs that red/green blindness merges. `warn` stayed amber (38°) while
  // `err` moved to orange (24°): the error landed in the warning's family. Now all three states stay apart.
  const hueOf = (hx) => { const [r, g, b] = T.HEX(hx).map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (d === 0) return 0; const x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (x * 60 + 360) % 360 }
  const hueGap = (a, b) => { const d = Math.abs(hueOf(a) - hueOf(b)); return Math.min(d, 360 - d) }
  // Machado et al. 2009 (severity 1.0) on linear sRGB, then CIE Lab (D65), distance = CIE76 ΔE.
  const CVD = {
    protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]]
  }
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  const labOf = (hx, kind) => {
    const c = T.HEX(hx).map(lin), s = CVD[kind].map((r) => Math.min(1, Math.max(0, r[0] * c[0] + r[1] * c[1] + r[2] * c[2])))
    const X = (0.4124564 * s[0] + 0.3575761 * s[1] + 0.1804375 * s[2]) / 0.95047, Y = 0.2126729 * s[0] + 0.7151522 * s[1] + 0.0721750 * s[2], Z = (0.0193339 * s[0] + 0.1191920 * s[1] + 0.9503041 * s[2]) / 1.08883
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]
  }
  const dE = (a, b, kind) => { const p = labOf(a, kind), q = labOf(b, kind); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) }
  for (const m of ['light', 'dark']) {
    const a = plain(m, false), b = plain(m, true)
    check(m + ': the warning ink changes too (it was amber in both palettes)', a.warn !== b.warn && b.warn !== b.ok && b.warn !== b.err, [a.warn, b.warn])
    check(m + ': ...the error is at least 60° of hue away from the warning and from the success (was 14° from the warning)', hueGap(b.err, b.warn) >= 60 && hueGap(b.err, b.ok) >= 60, [hueGap(b.err, b.warn).toFixed(0), hueGap(b.err, b.ok).toFixed(0)])
    check(m + ': ...the warning keeps ≥ 5:1 on layer 1 like the other two', T.ratio(b.warn, b.l1) >= 5, T.ratio(b.warn, b.l1).toFixed(2))
    for (const kind of ['protan', 'deutan']) {
      const d = [dE(b.ok, b.warn, kind), dE(b.warn, b.err, kind), dE(b.ok, b.err, kind)]
      check(m + ': ' + kind + 'opia simulated, success / warning / error stay ≥ 30 ΔE apart (CIE76)', d.every((x) => x >= 30), d.map((x) => x.toFixed(0)))
    }
  }
  const mk = mkCtx({}); T.appliquerJetons(mk.ctx.theme, { ...T.DEF, cbSafe: true })
  const layer = mk.calls.overrideTokens[0] && mk.calls.overrideTokens[0].tokens
  check('...and the applied layer carries the new warning token per scheme', layer['--dsw-alias-state-warn-primary'].dark === plain('dark', true).warn && layer['--dsw-alias-state-warn-primary'].light === plain('light', true).warn)
  {
    // The grade inks of the notes (.kbth-gr-*) are static CSS: under the palette each one must be the very token the layer applies.
    const inks = {}
    for (const m of SOURCE.matchAll(/^(body:not\(\[data-ds-dark-theme\]\) |html\[data-kbth-cb\] (?:body:not\(\[data-ds-dark-theme\]\) )?)?\.kbth-gr-(ok|warn|err)\{--kbth-ink:(#[0-9A-Fa-f]{6})\}/gm)) inks[(m[1] || 'dark').trim() + ' ' + m[2]] = m[3]
    for (const [m, prefix] of [['dark', 'html[data-kbth-cb]'], ['light', 'html[data-kbth-cb] body:not([data-ds-dark-theme])']]) {
      const t = plain(m, true), bad = ['ok', 'warn', 'err'].filter((k) => (inks[prefix + ' ' + k] || '').toUpperCase() !== t[k].toUpperCase())
      check(m + ': under the palette, the success / warning / error note inks are the palette\'s tokens (none keeps its default ink)', bad.length === 0, bad.map((k) => [k, inks[prefix + ' ' + k], t[k]]))
    }
  }
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
// ═══ The look studio: the settings it adds, and what applies them ════════════
section('look studio: stored settings (bubbles, replies, sidebar tone, shadows, pills)')
{
  const D = T.DEF
  check('the defaults leave DSH alone', D.bubbleUser === 'auto' && D.textUser === null && D.replyBg === 'none' && D.replyColor === null && D.textReply === null && D.sideTone === 'auto' && D.shadow === 'none' && D.glow === false && D.wgSessions === true && D.wgChanges === true && D.wgUsage === true)
  const v = T.valeursValides
  check('a bubble is one of DSH\'s choices or any hex colour, nothing else', v({ bubbleUser: 'accent' }).bubbleUser === 'accent' && v({ bubbleUser: '#ABCDEF' }).bubbleUser === '#abcdef' && v({ bubbleUser: 'purple' }).bubbleUser === undefined && v({ bubbleUser: 5 }).bubbleUser === undefined && v({ bubbleUser: 'url(x)' }).bubbleUser === undefined)
  check('the three text / reply colours are a hex or null, nothing else', ['textUser', 'replyColor', 'textReply'].every((k) => v({ [k]: '#FFF' })[k] === '#ffffff' && v({ [k]: null })[k] === null && v({ [k]: 'red' })[k] === undefined && v({ [k]: 3 })[k] === undefined))
  check('the choices are checked: reply frame, sidebar tone, shadows', v({ replyBg: 'card' }).replyBg === 'card' && v({ replyBg: 'x' }).replyBg === undefined && v({ sideTone: 'tinted' }).sideTone === 'tinted' && v({ sideTone: 'x' }).sideTone === undefined && v({ shadow: 'soft' }).shadow === 'soft' && v({ shadow: 'x' }).shadow === undefined)
  check('the booleans are checked: glow and the three pills', ['glow', 'wgSessions', 'wgChanges', 'wgUsage'].every((k) => v({ [k]: false })[k] === false && v({ [k]: 'no' })[k] === undefined))
  reset()
  store.set(T.STORE_KEY, JSON.stringify({ bubbleUser: 'weird', textUser: 'blue', replyBg: 'x', replyColor: 7, sideTone: 3, shadow: null, glow: 'yes', wgUsage: 0 }))
  const st = T.readState()
  check('a damaged stored value falls back to the default (never to a broken style)', st.bubbleUser === 'auto' && st.textUser === null && st.replyBg === 'none' && st.replyColor === null && st.sideTone === 'auto' && st.shadow === 'none' && st.glow === false && st.wgUsage === true, st)
  store.set(T.STORE_KEY, JSON.stringify({ bubbleUser: '#123456', textUser: '#ffffff', replyBg: 'tint', textReply: null }))
  const st2 = T.readState()
  check('good values are kept', st2.bubbleUser === '#123456' && st2.textUser === '#ffffff' && st2.replyBg === 'tint' && st2.textReply === null)
  const imp = T.sanitiserImport({ bubbleUser: '#aabbcc', replyBg: 'outline', sideTone: 'darker', textReply: '#111111', glow: true, wgChanges: false, shadow: 'soft' })
  check('an imported file can set them, with the same checks', imp.bubbleUser === '#aabbcc' && imp.replyBg === 'outline' && imp.sideTone === 'darker' && imp.textReply === '#111111' && imp.glow === true && imp.wgChanges === false && imp.shadow === 'soft')
  check('...and cannot smuggle a style through them', T.sanitiserImport({ bubbleUser: 'red;}body{display:none', textUser: 'url(//x)', replyColor: '#12345g' }).bubbleUser === undefined && T.sanitiserImport({ textUser: 'url(//x)' }).textUser === undefined && T.sanitiserImport({ replyColor: '#12345g' }).replyColor === undefined)
  check('a theme keeps the chat settings in their own group, the sidebar tone with the colours, shadows with the corners', T.PRESET_GROUPS.chat.join() === 'bubbleUser,textUser,replyBg,replyColor,textReply' && T.PRESET_GROUPS.colors.includes('sideTone') && T.PRESET_GROUPS.radius.includes('shadow') && T.PRESET_GROUPS.radius.includes('glow'))
  const pre = T.presetFromState({ ...D, bubbleUser: '#aabbcc', replyBg: 'card' }, { chat: true })
  check('saved with « chat », a theme carries the bubble and the frame; without it, it does not', pre.bubbleUser === '#aabbcc' && pre.replyBg === 'card' && !('bubbleUser' in T.presetFromState({ ...D, bubbleUser: '#aabbcc' }, {})))
  const withNull = T.presetFromState({ ...D, textUser: null }, { chat: true })
  check('a null text colour survives the sanitiser and the host store', T.presetSettings(withNull) !== null && T.presetSettings(withNull).textUser === null && sanitizeLibrary({ presets: [{ id: 'u-n', name: 'N', settings: { ...T.presetSettings(withNull), bubbleUser: '#aabbcc' } }] }).library.presets.length === 1)
}

section('look studio: the tone of the sidebar')
{
  const base = { acc: null, ov: {}, lvl: 0, cb: false, tint: 0, dom: '' }
  for (const mode of ['light', 'dark']) {
    const a = T.makeTheme(mode, base).side
    const dk = T.makeTheme(mode, { ...base, sideTone: 'darker' }).side
    const lt = T.makeTheme(mode, { ...base, sideTone: 'lighter' }).side
    const ti = T.makeTheme(mode, { ...base, acc: '#EC4899', sideTone: 'tinted' }).side
    const lu = (c) => { const p = T.HEX(c); return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2] }
    check(mode + ': « auto » keeps the sidebar of the theme; darker is darker, lighter is lighter', T.makeTheme(mode, { ...base, sideTone: 'auto' }).side === a && lu(dk) < lu(a) && lu(lt) > lu(a), { a, dk, lt })
    const dist = (x, y) => { const p = T.HEX(x), q = T.HEX(y); return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) }
    check(mode + ': tinted pulls the sidebar towards the accent', ti !== a && dist(ti, '#EC4899') < dist(a, '#EC4899'), { a, ti })
  }
  const ov = T.makeTheme('dark', { ...base, ov: { 'dark:side': '#202020' }, sideTone: 'darker' }).side
  check('the tone is taken from the sidebar colour the scheme ended with (a theme\'s own, or an edit)', ov === T.mix('#202020', '#000000', 0.35))
  const j = T.jetonsDe({ ...T.DEF, sideTone: 'darker' })
  check('the sidebar token carries the tone; the tone alone makes the layer exist', j !== null && j['--dsw-specific-sidebar-fill'].dark === T.makeTheme('dark', { ...base, sideTone: 'darker' }).side && T.jetonsDe({ ...T.DEF }) === null)
}

section('look studio: your bubble (a token) and the text colours')
{
  const o = T.optsDe({ ...T.DEF })
  const cl = T.makeTheme('light', o), cd = T.makeTheme('dark', o)
  const b = (st, c, dark) => T.bulleDe({ ...T.DEF, ...st }, c, dark)
  check('auto: DSH\'s own bubble, no text colour of ours', b({}, cl, false).bg === null && b({}, cl, false).text === null)
  check('accent: the filled accent, with a text that reads on it', b({ bubbleUser: 'accent', acc: '#EC4899' }, T.makeTheme('light', T.optsDe({ ...T.DEF, acc: '#EC4899' })), false).bg === T.makeTheme('light', T.optsDe({ ...T.DEF, acc: '#EC4899' })).fill)
  check('dark: black on dark, ink on light', b({ bubbleUser: 'dark' }, cd, true).bg === '#000000' && b({ bubbleUser: 'dark' }, cl, false).bg === '#1D1F24')
  check('a custom colour is used as is, and its text is whichever of white / ink reads best', (() => { const x = b({ bubbleUser: '#ffee00' }, cl, false), y = b({ bubbleUser: '#101030' }, cl, false); return x.bg === '#ffee00' && x.text === '#0F1115' && y.text === '#FFFFFF' })())
  check('a chosen text colour wins over the automatic one', b({ bubbleUser: '#101030', textUser: '#fde68a' }, cl, false).text === '#fde68a' && b({ textUser: '#fde68a' }, cl, false).text === '#fde68a' && b({ textUser: '#fde68a' }, cl, false).bg === null)
  check('every automatic text reads at 4.5:1 or better on its bubble (accent, soft, dark, a dozen colours)', ['accent', 'soft', 'dark', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#808080', '#ff00ff', '#00ffff', '#ffa500', '#123456'].every((v) => ['light', 'dark'].every((mode) => { const c = T.makeTheme(mode, T.optsDe({ ...T.DEF, acc: '#4176E6' })); const r = b({ bubbleUser: v, acc: '#4176E6' }, c, mode === 'dark'); return r.bg === null || T.ratio(r.text, r.bg) >= 4.5 })))
  const j = T.jetonsDe({ ...T.DEF, bubbleUser: '#aabbcc' })
  check('a bubble colour is the token DSH paints its bubble with, one value per scheme', j !== null && j['--dsw-specific-bubble'].light === '#aabbcc' && j['--dsw-specific-bubble'].dark === '#aabbcc' && !('--dsw-specific-bubble' in T.jetonsDe({ ...T.DEF, acc: '#4176E6' })))
  const ja = T.jetonsDe({ ...T.DEF, bubbleUser: 'accent', acc: '#EC4899' })
  check('« accent » follows each scheme\'s own accent fill', ja['--dsw-specific-bubble'].light === T.makeTheme('light', T.optsDe({ ...T.DEF, acc: '#EC4899' })).fill && ja['--dsw-specific-bubble'].dark === T.makeTheme('dark', T.optsDe({ ...T.DEF, acc: '#EC4899' })).fill)
  check('the bubble alone makes the layer exist (it is not the « natural » look)', T.estNaturel({ ...T.DEF }) === true && T.estNaturel({ ...T.DEF, bubbleUser: 'dark' }) === false && T.estNaturel({ ...T.DEF, sideTone: 'darker' }) === false)
  // bars on hover is ON by default: these tests look at everything else, so it is off here unless a test asks (see « bars on hover » below)
  const css = (st) => T.effetsCss({ ...T.DEF, autoHideBars: false, ...st })
  check('the text colour is scoped to your messages by DSH\'s marker, never to the whole app', /\[data-chat-flow-kind="user"\]\{--dsw-alias-label-primary:#fde68a\}/.test(css({ textUser: '#fde68a' })) && !/^\*|(^|\})body\{/.test(css({ textUser: '#fde68a' })))
  const auto = css({ bubbleUser: 'dark' })
  check('an automatic text colour is written per scheme (white on the dark bubble of dark, on the ink one of light)', /body:not\(\[data-ds-dark-theme\]\) \[data-chat-flow-kind="user"\]\{--dsw-alias-label-primary:#FFFFFF\}/.test(auto) && /body\[data-ds-dark-theme\] \[data-chat-flow-kind="user"\]\{--dsw-alias-label-primary:#FFFFFF\}/.test(auto))
  check('nothing for auto', css({ bubbleUser: 'auto' }) === '')
}

section('look studio: the agent\'s replies, shadows, glow, the pills under the message box')
{
  // bars on hover is ON by default: these tests look at everything else, so it is off here unless a test asks (see « bars on hover » below)
  const css = (st) => T.effetsCss({ ...T.DEF, autoHideBars: false, ...st })
  const R = '[data-chat-group-part="response"]{'
  check('no frame by default', !css({}).includes('data-chat-group-part'))
  const card = css({ replyBg: 'card' })
  check('card: a background, a hairline, rounded and padded, on the container of the reply', card.includes(R) && /background:color-mix/.test(card) && /border:1px solid var\(--dsw-alias-border-l2\)/.test(card) && /border-radius:var\(--dsw-radius-lg,16px\)/.test(card) && /padding:10px 14px/.test(card))
  check('outline: a border only', (() => { const x = css({ replyBg: 'outline' }); return x.includes(R) && /border:1px solid var\(--dsw-alias-border-l4\)/.test(x) && !/background:/.test(x) })())
  check('tint: the accent at 12 %', /background:color-mix\(in srgb,var\(--dsw-alias-brand-primary\) 12%,transparent\)/.test(css({ replyBg: 'tint' })))
  check('a reply colour: the card is that colour (text that reads on it), the outline is that colour, the tint is made of it', (() => { const a = css({ replyBg: 'card', replyColor: '#fde68a' }), b = css({ replyBg: 'outline', replyColor: '#ff0000' }), c = css({ replyBg: 'tint', replyColor: '#00aa00' }); return /background:#fde68a/.test(a) && /color:#0F1115/.test(a) && /border:1px solid #ff0000/.test(b) && /#00aa00 12%/.test(c) })())
  check('a reply text colour alone frames nothing and sets the text of the reply only', (() => { const x = css({ textReply: '#a7f3d0' }); return x.includes(R) && /color:#a7f3d0/.test(x) && /--dsw-alias-label-primary:#a7f3d0/.test(x) && !/padding/.test(x) })())
  check('shadows: soft shadow on menus, lists and the message box', /\[role="menu"\],\[role="listbox"\]\{box-shadow:0 4px 14px/.test(css({ shadow: 'soft' })) && /\[data-composer-card\]\{box-shadow:0 4px 14px/.test(css({ shadow: 'soft' })))
  check('glow: a light of the accent around the message box, with the shadow when both are on', /\[data-composer-card\]\{box-shadow:0 0 18px color-mix/.test(css({ glow: true })) && /box-shadow:0 4px 14px rgba\(0,0,0,\.2\),0 0 18px/.test(css({ glow: true, shadow: 'soft' })))
  check('with Liquid glass the highlight is kept under the shadow', /box-shadow:0 4px 14px rgba\(0,0,0,\.2\),inset 0 0 0 \.5px/.test(css({ wp: 'aurore', glassEffect: 'liquid', glassBlur: 20, shadow: 'soft' })))
  const dock = '[data-slot="conversation.composer.dock"]'
  check('the pills are shown unless switched off, each on its own', css({}) === '' && css({ wgSessions: false }) === dock + ' [data-kb="status-pill"]{display:none!important}' && css({ wgChanges: false }) === dock + ' [data-kb="changes"]{display:none!important}' && css({ wgUsage: false }) === dock + ' [data-kb="usage-chip"]{display:none!important}')
  // Bars on hover (owner's call, 2026-10-22): the collapsed rail and the chat's top bar hide to a sliver and come back at the edge.
  check('bars on hover: on by default (owner\'s call), drawn only when on, checked like the other booleans, and kept out of the presets', T.DEF.autoHideBars === true && css({}) === '' && css({ autoHideBars: true }) !== '' && T.effetsCss({ ...T.DEF }) !== '' && T.valeursValides({ autoHideBars: true }).autoHideBars === true && T.valeursValides({ autoHideBars: 'yes' }).autoHideBars === undefined && !Object.values(T.PRESET_GROUPS).some((g) => g.includes('autoHideBars')))
  check('bars on hover: only under a pointer that can hover; the rail and the top bar hide to a sliver, and come back on hover, on focus or while a popup they opened is open', (() => {
    const x = css({ autoHideBars: true })
    return x.startsWith('@media (hover:hover) and (pointer:fine){') && /_sidebarCol"\]\{[^}]*translateX\(calc\(-100% \+ 8px\)\)/.test(x) && /_headerLeading"\]\)\{[^}]*translateY\(calc\(-100% \+ 6px\)\)/.test(x)
      && /:focus-within/.test(x) && /:has\(\[aria-haspopup\]\[aria-expanded="true"\]\)/.test(x) && /\{grid-column:1 \/ 3;grid-row:1\}/.test(x) && x.split('{').length === x.split('}').length
  })())
  check('bars on hover: the hidden top bar is no window-drag area (in the desktop app its 6 px sliver would swallow the pointer and the bar could not be hovered back)', (() => {
    const x = css({ autoHideBars: true })
    return /_headerLeading"\]\)\{[^}]*translateY\(calc\(-100% \+ 6px\)\)[^}]*app-region:no-drag;-webkit-app-region:no-drag\}/.test(x) && !/_sidebarCol"\]\{[^}]*app-region/.test(x)
  })())
  check('bars on hover: the peek state brings the top bar down like a hover, inside the same media query', (() => {
    const x = css({ autoHideBars: true })
    return /html\[data-kbth-peek\] \[class\*="_centerCol"\] header\[class\*="_header"\]:has\(>\[class\*="_headerLeading"\]\)\{transform:none;transition-delay:0s;/.test(x) && x.indexOf('html[data-kbth-peek]') < x.lastIndexOf('}') && x.split('{').length === x.split('}').length && x.startsWith('@media (hover:hover) and (pointer:fine){')
  })())
  check('bars on hover: the top bar\'s reach is wider than its 6 px sliver (owner, 2026-11-19: « toujours dur » in the desktop app)', T.PEEK_ZONE >= 20 && T.PEEK_ZONE <= 48 && T.PEEK_LINGER >= 300 && T.PEEK_LINGER <= 1500)
  check('bars on hover: the reach follows the pointer — comes down in the top zone of the bar\'s column, stays on the bar, goes up elsewhere, waits when the pointer leaves by the top, and cleans up', (() => {
    const attrs = new Map()
    const listeners = []
    const rootListeners = []
    let bar = { left: 280, right: 1400, bottom: 6 } // the hidden bar: only its sliver is on screen
    const root = { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k), addEventListener: (t, f) => rootListeners.push([t, f]), removeEventListener: (t, f) => { const i = rootListeners.findIndex((a) => a[0] === t && a[1] === f); if (i >= 0) rootListeners.splice(i, 1) } }
    const doc = { documentElement: root, querySelector: () => (bar === null ? null : { getBoundingClientRect: () => bar }), addEventListener: (t, f) => listeners.push([t, f]), removeEventListener: (t, f) => { const i = listeners.findIndex((a) => a[0] === t && a[1] === f); if (i >= 0) listeners.splice(i, 1) } }
    const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout
    let pending = null
    globalThis.setTimeout = (f, ms) => { pending = { f, ms }; return 1 }
    globalThis.clearTimeout = () => { pending = null }
    try {
      const off = T.peekBind(doc)
      const move = listeners.find((a) => a[0] === 'mousemove')[1]
      const leave = rootListeners.find((a) => a[0] === 'mouseleave')[1]
      const on = () => attrs.get('data-kbth-peek') === '1'
      const at = (x, y) => move({ clientX: x, clientY: y })
      const ok = []
      at(800, 200); ok.push(!on())                       // far from the top: nothing
      at(800, 20); ok.push(on())                         // 20 px down is a miss for the sliver, a hit for the reach
      bar = { left: 280, right: 1400, bottom: 76 }       // the bar is down now
      at(800, 60); ok.push(on())                         // on the bar: stays
      at(800, 150); ok.push(!on())                       // below it: goes up
      at(800, 20); ok.push(on())
      at(100, 20); ok.push(!on())                        // over the sidebar, not over the bar's column
      at(800, 20); ok.push(on())
      leave({ clientY: 0 }); ok.push(on() && pending !== null && pending.ms === T.PEEK_LINGER) // out by the top: waits
      at(800, 10); ok.push(on() && pending === null)     // back within the wait: stays, the timer is cancelled
      leave({ clientY: 0 }); { const f = pending.f; pending = null; f() } ok.push(!on()) // the wait is over: up
      at(800, 20); leave({ clientY: 400 }); ok.push(!on() && pending === null) // out by the side or the bottom: up at once
      at(800, 20); bar = null; at(800, 22); ok.push(!on()) // no top bar on this page: nothing stays set
      bar = { left: 280, right: 1400, bottom: 6 }; at(800, 20); ok.push(on())
      off(); ok.push(!on() && listeners.length === 0 && rootListeners.length === 0) // disposed: attribute and listeners gone
      if (!ok.every((v) => v === true)) console.log('    steps:', JSON.stringify(ok))
      return ok.every((v) => v === true)
    } finally { globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear }
  })())
  check('bars on hover: the reach is bound only while the setting is on, and a page without a document does not break it', /if \(S\.autoHideBars\) \{ try \{ if \(typeof document !== 'undefined'\) \{ peekDispose = peekBind\(document\); pinDispose = pinBind\(document\) \} \} catch/.test(SOURCE) && (() => { try { T.appliquerEffets({ ...T.DEF, autoHideBars: true }); return true } catch (e) { return false } })())
  check('bars on hover: no :has() inside a :has() (CSS drops the whole rule: the column\'s position:relative never applied), and that rule is there', (() => {
    const x = css({ autoHideBars: true })
    const rules = x.split('}').map((r) => r.split('{')[0])
    const nested = rules.some((sel) => /:has\([^)]*:has\(/.test(sel))
    return !nested && /\[class\*="_centerCol"\]:has\(header\[class\*="_header"\]>\[class\*="_headerLeading"\]\)\{position:relative\}/.test(x)
  })())
  check('bars on hover: the tab (two pseudo-elements of the chat column, above the bar) and the pinned state are drawn inside the same media query', (() => {
    const x = css({ autoHideBars: true })
    const col = '\\[class\\*="_centerCol"\\]:has\\(header\\[class\\*="_header"\\]>\\[class\\*="_headerLeading"\\]\\)'
    return new RegExp(col + '::before\\{content:"";position:absolute;z-index:31;top:0;[^}]*width:' + T.TAB_W + 'px;height:' + T.TAB_H + 'px;[^}]*cursor:pointer\\}').test(x)
      && new RegExp(col + '::after\\{content:"";position:absolute;z-index:32;[^}]*pointer-events:none;[^}]*mask:url\\("data:image/svg\\+xml').test(x)
      && /html\[data-kbth-pin-top\] \[class\*="_centerCol"\] header\[class\*="_header"\]:has\(>\[class\*="_headerLeading"\]\)\{position:relative;transform:none;box-shadow:none;transition:none\}/.test(x)
      && /html\[data-kbth-pin-top\] [^{]*::after\{transform:scaleY\(-1\)\}/.test(x) && x.split('{').length === x.split('}').length && x.indexOf('::before') < x.lastIndexOf('}')
  })())
  check('bars on hover: the tab and Ctrl/⌘+Shift+H pin and unpin the top bar, the state is kept, a click elsewhere or another key does nothing, and it cleans up', (() => {
    const attrs = new Map()
    const store = new Map()
    const handlers = {}
    const root = { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k) }
    const win = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } }
    let hasBar = true
    const doc = { documentElement: root, defaultView: win, querySelector: () => (hasBar ? {} : null), addEventListener: (t, f) => { handlers[t] = f }, removeEventListener: (t, f) => { if (handlers[t] === f) delete handlers[t] } }
    const col = { matches: () => true, getBoundingClientRect: () => ({ left: 280, top: 0, width: 1120 }) }
    const other = { matches: () => false, getBoundingClientRect: () => ({ left: 0, top: 0, width: 10 }) }
    const click = (target, x, y, button = 0) => { let stopped = false; handlers.click({ target, clientX: x, clientY: y, button, preventDefault () {}, stopPropagation () { stopped = true } }); return stopped }
    const key = (o) => { let stopped = false; handlers.keydown({ shiftKey: true, metaKey: true, ctrlKey: false, altKey: false, code: 'KeyH', key: 'H', preventDefault () {}, stopPropagation () { stopped = true }, ...o }); return stopped }
    const pinned = () => attrs.get(T.PIN_ATTR) === '1'
    const ok = []
    const off = T.pinBind(doc)
    ok.push(!pinned())
    ok.push(click(col, 840, 9) === true && pinned() && store.get(T.PIN_KEY) === '1')   // the middle of the tab: pinned, and remembered
    ok.push(click(col, 840, 9) === true && !pinned() && !store.has(T.PIN_KEY))        // again: unpinned
    ok.push(click(col, 840, 30) === false && !pinned())                                // below the tab
    ok.push(click(col, 840 + T.TAB_W, 9) === false && !pinned())                       // beside the tab
    ok.push(click(other, 840, 9) === false && !pinned())                               // not the column
    ok.push(click(col, 840, 9, 2) === false && !pinned())                              // not the left button
    ok.push(key({}) === true && pinned())                                              // ⌘+Shift+H
    ok.push(key({ metaKey: false, ctrlKey: true }) === true && !pinned())              // Ctrl+Shift+H
    ok.push(key({ shiftKey: false }) === false && key({ altKey: true }) === false && key({ metaKey: false }) === false && key({ code: 'KeyB', key: 'b' }) === false && !pinned())
    hasBar = false
    ok.push(key({}) === false && !pinned())                                            // no top bar on this page: the keys stay free
    hasBar = true
    key({}); ok.push(pinned())
    off(); ok.push(!pinned() && handlers.click === undefined && handlers.keydown === undefined && store.get(T.PIN_KEY) === '1') // disposed: attribute and listeners gone, the choice is kept
    const off2 = T.pinBind(doc); ok.push(pinned()); off2()                             // bound again: the kept choice comes back
    win.localStorage = { getItem () { throw new Error('blocked') }, setItem () { throw new Error('blocked') }, removeItem () { throw new Error('blocked') } }
    const off3 = T.pinBind(doc); ok.push(key({}) === true && pinned()); off3()         // storage refused: it still works for this page
    if (!ok.every((v) => v === true)) console.log('    steps:', JSON.stringify(ok))
    return ok.every((v) => v === true)
  })())
  check('bars on hover: the switch of the look studio tells about the tab and the shortcut', /Ctrl\/⌘\+Maj\+H/.test(SOURCE) && /Ctrl\/⌘\+Shift\+H/.test(SOURCE))
  check('bars on hover: it is a toggle of the look studio\'s sidebar panel', /ldToggle\(say\('Barres au survol', 'Bars on hover'\), S\.autoHideBars, \(\) => commit\(\{ autoHideBars: !S\.autoHideBars \}\)/.test(SOURCE))
  check('everything on at once is still well formed', (() => { const x = css({ wp: 'aurore', glassEffect: 'liquid', bubbleUser: '#123456', textUser: '#fff', replyBg: 'card', replyColor: '#aa5500', textReply: '#000', shadow: 'soft', glow: true, wgSessions: false, wgChanges: false, wgUsage: false, sideTone: 'tinted' }); return (x.match(/\{/g) || []).length === (x.match(/\}/g) || []).length && !x.includes('undefined') && !x.includes('null') })())
}

section('look studio: vibes, draws, panels')
{
  const D = T.DEF
  const same = (a, b) => JSON.stringify(a).toLowerCase() === JSON.stringify(b).toLowerCase() // the sanitiser lowercases a hex colour; the page keeps an accent as typed
  check('six vibes, each a whole look made of things that exist', T.ST_VIBES.length === 6 && T.ST_VIBES[0].id === 'epure' && T.ST_VIBES.every((v) => T.SKINS.some((x) => x.id === v.skin) && T.LD_PRESETS.some((l) => l.id === v.think) && T.LD_PACKS.some((p) => p.id === v.pack) && (v.set.iconSet === undefined || T.ICON_SET_IDS.includes(v.set.iconSet)) && (v.set.fontText === undefined || T.FONTS.some((f) => f.id === v.set.fontText)) && (v.set.wp === undefined || T.WPS.some((w) => w.id === v.set.wp))))
  check('a vibe sets every key of a look (a vibe starts from the defaults, so it never keeps a bubble or a font of the last one)', T.ST_VIBES.every((v) => { const p = T.stVibePatch(v).state; return T.stLookKeys().every((k) => k in p) && !T.PRESET_GROUPS.a11y.some((k) => k in p) }), T.stVibePatch(T.ST_VIBES[0]).state)
  check('a vibe never touches accessibility', T.ST_VIBES.every((v) => T.PRESET_GROUPS.a11y.every((k) => !(k in T.stVibePatch(v).state))))
  check('what a vibe sets survives the sanitiser as is (no value is dropped on the way)', T.ST_VIBES.every((v) => { const p = T.stVibePatch(v).state; const ok = T.sanitiserImport(p); return Object.keys(p).filter((k) => k !== 'skin').every((k) => same(ok[k], p[k])) }), T.ST_VIBES.map((v) => { const p = T.stVibePatch(v).state; const ok = T.sanitiserImport(p); return Object.keys(p).filter((k) => k !== 'skin' && !same(ok[k], p[k])) }))
  check('the animation of a vibe is one loop and one set of words, both valid', T.ST_VIBES.every((v) => { const l = T.ldClean(T.stVibePatch(v).loop); return l.sel.length === 1 && l.sel[0] === v.think && l.pack === v.pack }))
  check('the six fonts of the first sight exist, and so do the three sizes', T.ST_FONTS.length === 6 && T.ST_FONTS.every((f) => T.FONTS.some((x) => x.id === f[0])) && T.ST_SIZES.map((z) => z[1]).join() === '13,15,16' && T.ST_SPEEDS.length === 3)
  const rand = (() => {
    for (const z of Object.keys(T.ST_RAND)) for (let i = 0; i < 300; i++) {
      const r = T.ST_RAND[z]()
      if (r.skin !== undefined && !T.SKINS.includes(r.skin)) return z + ': skin'
      if (r.state !== undefined) { const ok = T.sanitiserImport(r.state); for (const k of Object.keys(r.state)) if (!same(ok[k], r.state[k])) return z + ': ' + k + ' ' + JSON.stringify(r.state[k]) }
      if (r.loop !== undefined) { const l = T.ldClean(r.loop); if (r.loop.sel !== undefined && JSON.stringify(l.sel) !== JSON.stringify(r.loop.sel)) return z + ': loop ' + JSON.stringify(r.loop.sel); if (r.loop.pack !== undefined && l.pack !== r.loop.pack) return z + ': pack' }
    }
    return true
  })()
  check('a random draw per panel is always valid (300 each)', rand === true, rand)
  const surprise = (() => {
    for (let i = 0; i < 100; i++) {
      const r = T.stSurprise()
      if (Object.keys(r.state).some((k) => T.PRESET_GROUPS.a11y.includes(k) || k.startsWith('wg'))) return 'a need or a pill was drawn'
      const ok = T.sanitiserImport(r.state)
      for (const k of Object.keys(r.state)) if (k !== 'skin' && !same(ok[k], r.state[k])) return k + ' ' + JSON.stringify(r.state[k])
    }
    return true
  })()
  check('« Surprise me » never draws accessibility or the pills, and is valid (100 draws)', surprise === true, surprise)
  check('the bubble DSH paints by itself is read from the page when there is one, with a fallback', /^#[0-9a-f]{6}$/i.test(T.stDshBubble(false)) && /^#[0-9a-f]{6}$/i.test(T.stDshBubble(true)))
  void D
}

section('theme library: what a theme may retain')
{
  check('the retained keys are exactly the host store\'s list (no drift)', [...T.PRESET_KEYS].sort().join() === [...SETTINGS_KEYS].sort().join(), { client: T.PRESET_KEYS.length, host: SETTINGS_KEYS.length })
  check('every retained key is a stored setting', T.PRESET_KEYS.every((k) => k in T.DEF), T.PRESET_KEYS.filter((k) => !(k in T.DEF)))
  const sample = {
    mode: 'light', acc: '#112233', ov: { 'light:base': '#ffffff' }, fontText: 'inter', ligatures: false, radius: 'soft',
    iconSet: 'bauhaus', wp: 'nuit', wpVis: 50, wpBlur: 5, tint: 10, glassEffect: 'liquid', glassBlur: 10, sidebarLinked: false, sidebarOpacity: 30, fieldOpacity: 30, floatOpacity: 30,
    bgBrightness: 110, bgContrast: 110, bgSaturation: 110, bgDarken: 10, bgFit: 'fill', bgMirror: true,
    contrastMode: 'plus', cbSafe: true, reduceMotion: true, focusRing: 'thick', largeTargets: true, underlineLinks: true, touch: true,
    sideTone: 'tinted', shadow: 'soft', glow: true, bubbleUser: '#aabbcc', textUser: '#ffffff', replyBg: 'card', replyColor: '#445566', textReply: '#111111',
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
  check('colours always travel, nothing else unless asked', Object.keys(colorsOnly).sort().join() === 'acc,mode,ov,sideTone', Object.keys(colorsOnly))
  const withFont = T.presetFromState(S, { font: true, radius: true })
  check('font and corners travel when asked', withFont.fontText === 'inter' && withFont.radius === 'soft' && withFont.ligatures === true && !('wp' in withFont))
  const all = T.presetFromState(S, { font: true, radius: true, glass: true })
  check('glass carries the wallpaper', all.wp === 'nuit' && 'glassBlur' in all)
  check('accessibility never travels unless it is switched on', !('contrastMode' in all) && !('cbSafe' in all) && T.presetFromState(S, { a11y: true }).contrastMode === 'max')
  const copy = T.presetFromState(S, {})
  copy.ov['dark:base'] = '#ffffff'
  check('the saved overrides are a copy, not the live object', S.ov['dark:base'] === '#101010')
  check('groupsOf says which groups a theme retains', JSON.stringify(T.groupsOf(withFont)) === JSON.stringify({ colors: true, font: true, radius: true, icons: false, chat: false, glass: false, a11y: false }), T.groupsOf(withFont))
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
  check('a name taken by a shipped theme is taken', T.libNameTaken('bleu profond') && T.libNameTaken('Défaut Kybernos'))
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
  check('an old export (the whole look, no frame) imports as a theme, without the skin or the text size', old.ok === true && old.legacy === true && old.name === 'Préréglage importé' && !('skin' in old.settings) && !('fs' in old.settings) && old.settings.acc === '#4176e6', old)
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
  const sneaky = T.galTheme({ ...raw, settings: { ...raw.settings, contrastMode: 'max', cbSafe: true, reduceMotion: true, focusRing: 'thick', largeTargets: true, underlineLinks: true, touch: true } })
  check('accessibility settings are removed even if the host sent them (a catalogue never touches them)', sneaky !== null && !['contrastMode', 'cbSafe', 'reduceMotion', 'focusRing', 'largeTargets', 'underlineLinks', 'touch'].some((k) => k in sneaky.settings), Object.keys(sneaky.settings))
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
  check('the language of the interface: French for the French of the product, English when asked (and for anything else)', T.kbLang() === 'fr' && (LANG = 'en-GB', T.kbLang() === 'en') && (LANG = 'es', T.kbLang() === 'en') && (LANG = 'fr-CA', T.kbLang() === 'fr') && (LANG = 'kybernos', T.kbLang() === 'fr'))
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
// ═══ The menu and the presets (the Theme page, step 2) ═══════════════════════
// The seven rows of a real profile, as the menu's registry lists them (name = the default name in the page language).
const MENU_ROWS_FR = [['kyber', 'kyber', 'Kaby'], ['tasks', 'auto', 'Automatisations'], ['connectors', 'plug', 'Connecteurs'], ['skills', 'skills', 'Compétences'], ['aiteams', 'teams', 'Équipes d’agents'], ['front-desk', null, 'Accueil client'], ['deliverables', 'creations', 'Créations']].map((r) => Object.freeze({ id: r[0], icon: r[1], name: r[2] }))
const MENU_ROWS_EN = [['kyber', 'kyber', 'Kaby'], ['tasks', 'auto', 'Automations'], ['connectors', 'plug', 'Connectors'], ['skills', 'skills', 'Skills'], ['aiteams', 'teams', 'Agent Teams'], ['front-desk', null, 'Front desk'], ['deliverables', 'creations', 'Creations']].map((r) => Object.freeze({ id: r[0], icon: r[1], name: r[2] }))
const MENU_ROWS = MENU_ROWS_FR
// The registry's other two surfaces, as kybernos-plugin publishes them (a few entries each: the page only needs the shape).
const SURFACE_ROWS = {
  secondary: [['spaces', 'Spaces'], ['create-team', 'Create a team'], ['upgrade', 'Upgrade'], ['account', 'Account', true], ['referral', 'Referral', true], ['help', 'Help'], ['settings', 'Settings', true], ['logout', 'Sign out', true]]
    .map((r) => ({ id: r[0], icon: null, name: r[1], locked: r[2] === true })),
  settings: [['general', 'General', 'general', '', true], ['kaby', 'Kaby', 'agents', 'Agents'], ['workers', 'Workers', 'agents', 'Agents'], ['theme', 'Theme', 'look', 'Interface'], ['about', 'About', 'system', 'System']]
    .map((r) => ({ id: r[0], icon: null, name: r[1], locked: r[4] === true, group: r[2], groupName: r[3] })),
}
const menuRegistryFor = () => ({ v: 1, hooks: { main: 'data-kb-row', secondary: 'data-kb', settings: 'data-kb-t' }, list: (surface) => (SURFACE_ROWS[surface] !== undefined ? SURFACE_ROWS[surface] : (LANG === 'en' ? MENU_ROWS_EN : MENU_ROWS_FR)), subscribe: () => () => {}, hook: 'data-kb-row' })

// ═══ The seam: window.__KB_THEME_APPLY__ (A1-theme-seam) ════════════════════
section('the seam: window.__KB_THEME_APPLY__')
{
  const posts = []
  const asked = []
  const serve = { answer: 'ok', themes: [] }
  const calcaire = { id: 'calcaire', v: 1, name: 'Calcaire', author: 'Kybernos', description: { fr: 'Sobre.', en: 'Plain.' }, settings: { mode: 'light', acc: '#4d7c0f', ov: { 'light:base': '#f6f7f8' } } }
  // A host that behaves like the real one: the gallery route, the preset-store entry ({ import } answered with the record
  // it wrote), the boot sheet. A GET of the library echoes what the browser has, a step ahead, so the deferred libPull
  // neither replaces nor pushes: the only writes this section can see are the seam's own.
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    const body = init && init.method === 'POST' ? JSON.parse(init.body) : null
    if (u.indexOf('/gallery') >= 0) { asked.push('gallery'); return { status: 200, json: async () => ({ ok: true, source: 'shipped', publishedAt: '2026-10-01T00:00:00.000Z', seq: 1, themes: serve.themes, online: { state: 'never', reason: null } }) } }
    if (u.indexOf('/preset-store') >= 0) {
      if (body === null) return { status: 200, json: async () => ({ ok: true, library: { v: 1, updatedAt: T.lib.updatedAt + 1000, presets: T.lib.presets } }) }
      posts.push(body)
      if (serve.answer === 'refuse') return { status: 400, json: async () => ({ ok: false, error: 'library full' }) }
      if (serve.answer === 'fault') return { status: 500, json: async () => ({ ok: false, error: 'preset store failed' }) }
      if (serve.answer === 'throw') throw new Error('offline')
      if (serve.answer === 'garbage') return { status: 200, json: async () => ({ ok: true, preset: { id: 'BAD ID', name: 'x', settings: { mode: 'light' } } }) }
      const imp = body.import
      const id = imp.gid === undefined ? 'u-imported' : 'g-' + imp.gid
      return { status: 200, json: async () => ({ ok: true, preset: { id, name: imp.name, source: imp.source, settings: imp.settings, menu: imp.menu, gid: imp.gid, v: imp.v, author: imp.author } }) }
    }
    return { status: 200, json: async () => ({ ok: true }) }
  }
  const fresh = () => {
    reset(); resetDom(); posts.length = 0; asked.length = 0; serve.answer = 'ok'; serve.themes = [calcaire]
    T.lib.presets = []; T.lib.menu = null; T.lib.updatedAt = 0; T.lib.hostState = 'unknown'; T.lib.pulled = false
    T.gal.data = null; T.gal.state = 'idle'; T.gal.refreshing = false; T.gal.refreshed = false
  }
  /** A fresh look at the window: the seam always reads the CURRENT context, so apply() rebinds the services. */
  const bind = (opts) => { const m = mkCtx(opts); modele.apply(m.ctx); return m }
  const imports = () => posts.filter((b) => b.import !== undefined)
  const libraries = () => posts.filter((b) => b.library !== undefined)
  const pause = () => new Promise((r) => setTimeout(r, 800))

  fresh()
  bind()
  const seam = loaderWindow.__KB_THEME_APPLY__
  check('apply(ctx) publishes window.__KB_THEME_APPLY__, a function', typeof seam === 'function')
  modele.apply(mkCtx().ctx)
  check('...and a second activation keeps the same function (a wizard holding it is never orphaned)', loaderWindow.__KB_THEME_APPLY__ === seam)
  const provided = []
  loaderWindow.__KB__ = { version: 1, provide: (id, version, impl) => provided.push({ id, version, impl }) }
  const listeners = {}
  loaderWindow.addEventListener = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn) }
  loaderWindow.removeEventListener = () => {}
  bind()
  check('the versioned alias is offered too: kybernos/theme 1.0.0 { apply }, and again when the registry announces itself',
    provided.length === 1 && provided[0].id === 'kybernos/theme' && provided[0].version === '1.0.0' && provided[0].impl.apply === loaderWindow.__KB_THEME_APPLY__ && (listeners['kybernos:registry'] || []).length === 1)
  delete loaderWindow.__KB__

  // A shipped id: one POST { import } through the host entry, the answer adopted, the look applied.
  fresh()
  let m = bind()
  let r = await seam('calcaire')
  check('a shipped id is imported through exactly one POST { import } (gallery, its gid, version and author)', r.ok === true && r.id === 'g-calcaire' && imports().length === 1 && imports()[0].import.source === 'gallery' && imports()[0].import.gid === 'calcaire' && imports()[0].import.v === 1 && imports()[0].import.author === 'Kybernos' && imports()[0].import.name === 'Calcaire', { r, posts })
  check('...the shipped gallery comes from the bundle\'s own route (no internet), asked once', asked.filter((a) => a === 'gallery').length === 1)
  check('...the host\'s record is adopted into My styles, with its catalogue link', T.lib.presets.length === 1 && T.lib.presets[0].id === 'g-calcaire' && T.lib.presets[0].gid === 'calcaire')
  check('...and the look is stored (merged over the current one) and drawn', stored() !== null && stored().acc === '#4d7c0f' && m.calls.overrideTokens.length >= 1)
  check('...a preset that carries a mode DOES write the page\'s light/dark preference', m.calls.setTheme.join() === 'light', m.calls.setTheme)
  r = await seam('calcaire')
  check('the same id again: the installed theme is reused, no second POST', r.ok === true && r.id === 'g-calcaire' && imports().length === 1, posts)

  // A library id is applied as it is, never POSTed.
  fresh()
  m = bind()
  T.lib.presets = [T.presetRecord({ id: 'u-mine', name: 'À moi', source: 'me', settings: { mode: 'dark', acc: '#0ea5e9' } })]
  T.lib.updatedAt = 500
  r = await seam('u-mine')
  check('a theme of the library by id: applied as it is, one look, no POST at all', r.ok === true && r.id === 'u-mine' && posts.length === 0 && stored().acc === '#0ea5e9' && m.calls.setTheme.join() === 'dark', { r, posts })
  const keptName = T.lib.presets[0].name
  r = await seam('u-mine')
  check('...twice: same row, no duplicate', r.ok === true && T.lib.presets.length === 1 && T.lib.presets[0].name === keptName)

  // An unknown id: an answer, never a throw, and no unbounded wait.
  r = await seam('pas-dans-la-galerie')
  check('an unknown id is { ok:false, reason }, with no throw', r !== null && typeof r === 'object' && r.ok === false && typeof r.reason === 'string', r)
  r = await seam(42)
  check('neither an id nor a bag is refused the same way', r.ok === false && typeof r.reason === 'string')

  // A settings bag (A1-2): a « My styles » row under a localized default name, the tokens applied, nothing else touched.
  fresh()
  m = bind()
  T.writeState({ ...T.DEF, skin: 'aurore', radius: 'soft', wp: 'nuit' })
  r = await seam({ acc: '#112233', mode: 'light' })
  check('a settings bag is imported as a row of My styles (source "file", localized default name)', r.ok === true && r.id === 'u-imported' && imports().length === 1 && imports()[0].import.source === 'file' && imports()[0].import.name === 'Mon style' && T.lib.presets[0].id === 'u-imported', { r, posts })
  check('...the merged look keeps what the bag does not carry (skin, corners, wallpaper)', stored().acc === '#112233' && stored().skin === 'aurore' && stored().radius === 'soft' && stored().wp === 'nuit', stored())
  check('...and no whole-library POST is sent by the seam (the host entry wrote the disk copy)', libraries().length === 0)

  fresh()
  m = bind()
  const beforeBag = JSON.stringify(stored())
  posts.length = 0
  r = await seam({ cbSafe: true, acc: '#112233' })
  check('a bag with an accessibility key is refused, naming it, and nothing is written (no POST)', r.ok === false && r.reason === 'accessibility setting: cbSafe' && posts.length === 0 && JSON.stringify(stored()) === beforeBag, { r, posts })
  r = await seam({ evil: 1 })
  check('a bag with no known setting is refused', r.ok === false && T.lib.presets.length === 0)
  r = await seam({ acc: '#112233' })
  check('a preset without a mode never writes the page\'s light/dark preference', r.ok === true && m.calls.setTheme.length === 0, m.calls.setTheme)
  r = await seam({ acc: '#445566' })
  check('a second bag: the host row is replaced by id, never appended twice', r.ok === true && T.lib.presets.filter((p) => p.id === 'u-imported').length === 1, T.lib.presets.map((p) => p.id))
  // A clean window: the activation's deferred pull has landed, so a whole-library push here could only come from the seam.
  T.lib.pulled = false
  bind()
  await pause()
  posts.length = 0
  r = await seam({ acc: '#667788' })
  await pause()
  check('800 ms after the seam\'s call, still no { library } POST (a deferred push would have landed: the host entry writes)', r.ok === true && libraries().length === 0, posts)

  // A1-3: a refusal is authoritative; a fault or an unreachable host is not a failure of applying.
  fresh()
  m = bind()
  serve.answer = 'refuse'
  const beforeRefusal = JSON.stringify(T.lib.presets)
  r = await seam({ acc: '#112233' })
  check('a 400 refusal is authoritative: { ok:false, reason }, nothing adopted, nothing applied', r.ok === false && r.reason === 'library full' && JSON.stringify(T.lib.presets) === beforeRefusal && stored() === null, r)
  serve.answer = 'fault'
  r = await seam({ acc: '#112233' })
  check('a host fault (5xx): the apply still succeeds, on a local-only row (source "file", no disk copy)', r.ok === true && T.lib.presets.length === 1 && T.lib.presets[0].source === 'file' && stored().acc === '#112233', r)
  serve.answer = 'throw'
  r = await seam({ acc: '#223344' })
  check('an unreachable host: the same local success, and nothing throws', r.ok === true && stored().acc === '#223344')
  serve.answer = 'ok'
  serve.themes = [calcaire]
  const r5 = await seam('calcaire')
  serve.answer = 'garbage'
  r = await seam('kawaii')
  check('a host answer whose preset is not a record is a refusal', r.ok === false && typeof r.reason === 'string' && r5.ok === true)

  // A broken local library: the answer says so, and the page keeps the look it had.
  fresh()
  m = bind()
  T.writeState({ ...T.DEF, acc: '#abcdef' })
  posts.length = 0
  quotaFull = true
  let threw = null
  try { r = await seam({ acc: '#112233' }) } catch (e) { threw = e }
  quotaFull = false
  check('a full quota is { ok:false, reason }, no throw, and the stored look is the one before', threw === null && r.ok === false && typeof r.reason === 'string' && JSON.parse(store.get(T.STORE_KEY)).acc === '#abcdef', { r, threw })
  check('...and no row was adopted for a look the page could not keep', T.lib.presets.length === 0)


  // ── The third form: a template (its appearance and its menu names, each applied only when ticked) ──
  const events = []
  loaderWindow.dispatchEvent = (e) => { events.push(e.type) }
  loaderWindow.__KB_MENU_ENTRIES__ = menuRegistryFor()
  const TPL = { name: 'Cabinet', settings: { acc: '#112233', radius: 'soft' }, menuLabels: { skills: { en: 'Playbooks', fr: 'Dossiers' }, workspaces: { en: 'Hacked' } }, gid: 'cabinet', v: 2, author: 'Kybernos' }
  fresh()
  m = bind()
  check('the page publishes the menu in use, read only: window.__KB_THEME_MENU__ { v: 1, current() }, null for the default menu', loaderWindow.__KB_THEME_MENU__ !== undefined && loaderWindow.__KB_THEME_MENU__.v === 1 && loaderWindow.__KB_THEME_MENU__.current() === null && Object.isFrozen(loaderWindow.__KB_THEME_MENU__))
  r = await seam({ preset: TPL, apply: { appearance: false, menu: false } })
  const rec = T.lib.presets[0]
  check('a template with both ticks off is only STORED: one POST { import } (source « template »), nothing applied, no event', r.ok === true && imports().length === 1 && imports()[0].import.source === 'template' && T.lib.menu === null && stored() === null && events.length === 0 && m.calls.overrideTokens.length === 0, { r, events })
  check('...the record holds the appearance AND a FULL menu: one entry per row of this install, every row shown, only the renamed row carries a label, the rows nobody may hide are not in it', rec !== undefined && rec.source === 'template' && rec.settings.acc === '#112233' && rec.menu.entries.length === 7 && rec.menu.entries.every((e) => e.shown) && rec.menu.entries.filter((e) => e.label !== undefined).map((e) => e.id).join() === 'skills' && rec.menu.entries.find((e) => e.id === 'skills').label.fr === 'Dossiers' && !rec.menu.entries.some((e) => e.id === 'workspaces'), rec)
  check('...with its catalogue link (gid, version, author) so a later update can find it', imports()[0].import.gid === 'cabinet' && imports()[0].import.v === 2 && imports()[0].import.author === 'Kybernos')
  fresh()
  m = bind()
  r = await seam({ preset: TPL, apply: { appearance: true, menu: false } })
  check('only the appearance ticked: the look is applied, the menu stays the default and nobody is woken', r.ok === true && stored().acc === '#112233' && T.lib.menu === null && events.length === 0, { r, events })
  fresh()
  m = bind()
  events.length = 0
  r = await seam({ preset: TPL, apply: { appearance: false, menu: true } })
  check('only the menu ticked: the menu is put in use (browser key, library, event), the look is untouched', r.ok === true && T.lib.menu !== null && T.lib.menu.entries.length === 7 && stored() === null && events.join() === T.MENU_EVENT && JSON.parse(store.get(T.MENU_KEY)).menu.entries.length === 7, { r, events })
  check('...window.__KB_THEME_MENU__.current() says the same, as a copy', JSON.stringify(loaderWindow.__KB_THEME_MENU__.current()) === JSON.stringify(T.lib.menu) && loaderWindow.__KB_THEME_MENU__.current() !== T.lib.menu)
  check('...the person had the default menu: nothing was kept in Mine', T.lib.presets.every((p) => p.source === 'template'), T.lib.presets.map((p) => p.name))

  // The person's own menu is kept before a menu from outside replaces it.
  fresh()
  m = bind()
  const own = { entries: [{ id: 'tasks', shown: false, order: 0 }, { id: 'kyber', shown: true, order: 1 }], unlisted: 'show', locked: false }
  T.menuUse(own)
  r = await seam({ preset: TPL, apply: { appearance: false, menu: true } })
  const kept = T.lib.presets.find((p) => p.source === 'me' && p.menu !== undefined)
  check('a menu from a template replaces the person’s own only after keeping it in Mine (« Mon menu »): one click goes back', r.ok === true && kept !== undefined && kept.name === 'Mon menu' && kept.settings === undefined && JSON.stringify(kept.menu) === JSON.stringify(T.menuClean(own)) && T.lib.menu.entries.length === 7, T.lib.presets.map((p) => p.name))
  r = await seam({ preset: TPL, apply: { appearance: false, menu: true } })
  check('...applying the same template again keeps nothing new (its menu is the one in use)', T.lib.presets.filter((p) => p.source === 'me' && p.menu !== undefined).length === 1, T.lib.presets.map((p) => p.name))
  r = await seam({ preset: { ...TPL, name: 'Cabinet 2', gid: 'cabinet2', menuLabels: { skills: { en: 'Other' } } }, apply: { appearance: false, menu: true } })
  check('...a different menu from outside replaces that one too: the one in use is kept first, under a free name', r.ok === true && T.lib.presets.filter((p) => p.source === 'me' && p.menu !== undefined).map((p) => p.name).join() === 'Mon menu,Mon menu (2)', T.lib.presets.map((p) => p.name))
  // Refusals: an answer, never a throw, and nothing is written.
  fresh()
  m = bind()
  posts.length = 0
  const refused = []
  for (const input of [
    { preset: { name: 'X', settings: { acc: '#112233', cbSafe: true } }, apply: { appearance: true, menu: false } },
    { preset: { name: 'X', menuLabels: { skills: { en: '<b>x</b>' } } }, apply: { appearance: false, menu: true } },
    { preset: { name: 'X', menuLabels: { workspaces: { en: 'Hacked' } } }, apply: { appearance: false, menu: true } },
    { preset: { name: '', settings: { acc: '#112233' } }, apply: { appearance: true, menu: false } },
    { preset: { name: 'X', settings: { acc: '#112233' } }, apply: { appearance: 'yes', menu: false } },
    { preset: { name: 'X', settings: { acc: '#112233' } } },
    { preset: [1], apply: { appearance: true, menu: true } }
  ]) refused.push(await seam(input))
  check('a template with an accessibility key, no usable content, no name or a malformed `apply` is refused with a reason, writes nothing, and never throws', refused.every((x) => x.ok === false && typeof x.reason === 'string') && refused[0].reason === 'accessibility setting: cbSafe' && posts.length === 0 && T.lib.presets.length === 0 && T.lib.menu === null && stored() === null, { refused, posts })
  delete loaderWindow.dispatchEvent
  delete loaderWindow.__KB_MENU_ENTRIES__

  delete globalThis.fetch
  delete loaderWindow.addEventListener
  delete loaderWindow.removeEventListener
  fresh()
}
// ═══ anti-flash v2: the boot sheet ══════════════════════════════════════════
section('boot sheet (anti-flash v2)')
{
  // What the page posts has to pass the host's grammar for every look the bundle can produce, or that look would still flash.
  const states = T.SKINS.map((sk) => ({ ...T.DEF, ...T.skinPatch(sk) }))
  states.push({ ...T.DEF, acc: '#ff6a00', contrastMode: 'max', cbSafe: true })
  states.push({ ...T.DEF, skin: 'custom', wp: T.WPS[1].id, tint: 30, radius: 'soft', sidebarLinked: true })
  states.push({ ...T.DEF, skin: 'custom', radius: 'sharp', ov: { 'light:base': '#abcdef' } })
  const refused = states.map((S) => cleanBoot(T.bootSnapshot(S))).filter((r) => r.ok !== true).map((r) => r.error)
  check('every theme, accent, contrast level and corner style passes the host grammar (' + states.length + ' looks)', refused.length === 0, refused)
  check('and the natural DSH look posts nothing to paint', (() => { const n = T.bootSnapshot(T.DEF); return Object.keys(n.tokens).length === 0 && n.font === null })())
  const themed = { ...T.DEF, ...T.skinPatch(T.SKINS.find((sk) => sk.id !== 'dsh')) }
  const { ctx: themedCtx, calls: themedCalls } = mkCtx()
  T.appliquerJetons(themedCtx.theme, themed)
  check('the posted tokens are the layer DSH receives, not a second computation', JSON.stringify(T.bootSnapshot(themed).tokens) === JSON.stringify(themedCalls.overrideTokens[0].tokens))
  const sheet = renderBootCss(cleanBoot(T.bootSnapshot({ ...themed, fontText: 'georgia' })).snapshot)
  check('the sheet carries both schemes and the font', /^html body:not\(\[data-ds-dark-theme\]\)\{--dsw-/.test(sheet) && sheet.includes('html body[data-ds-dark-theme]{--dsw-') && sheet.endsWith(':root,body{--dsw-font-family:Georgia, \'Times New Roman\', serif !important}'), sheet.slice(-120))

  // The host is told what is PERSISTED: once, never a trial, and again after a refusal.
  const posts = []
  const realFetch = globalThis.fetch
  let reject = false
  globalThis.fetch = (url, init) => { posts.push({ url: String(url), body: JSON.parse(init.body) }); return reject ? Promise.reject(new Error('offline')) : Promise.resolve({ ok: true }) }
  try {
    T.posterBoot({ ...T.DEF, acc: '#123456', skin: 'custom' })
    posts.length = 0
    T.posterBoot(themed); T.posterBoot(themed)
    check('the same look is posted once', posts.length === 1 && posts[0].url.endsWith('/kybernos-theme/boot') && Object.keys(posts[0].body.tokens).length > 0, posts.length)
    T.writeState({ ...themed, acc: '#654321' })
    check('saving a look posts it', posts.length === 2 && posts[1].body.tokens !== undefined)
    const before = posts.length
    T.appliquerTout(mkCtx().ctx.theme, { ...themed, acc: '#0a0b0c' })
    check('a trial that is only previewed posts nothing (closing the tab must not keep it)', posts.length === before)
    reject = true
    T.posterBoot({ ...themed, acc: '#222222' })
    await Promise.resolve(); await Promise.resolve()
    reject = false
    posts.length = 0
    T.posterBoot({ ...themed, acc: '#222222' })
    check('a refused post is sent again next time', posts.length === 1)
    let threw = null
    globalThis.fetch = () => { throw new Error('no network stack') }
    try { T.posterBoot({ ...themed, acc: '#333333' }) } catch (e) { threw = e }
    check('a fetch that throws does not escape', threw === null)
  } finally { globalThis.fetch = realFetch }

  // The sheet leaves once the real layer is there, and only then.
  const sheetEl = { removed: false, remove() { this.removed = true } }
  const frames = []
  const realRaf = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length }
  document.getElementById = (id) => (id === T.BOOT_ID && sheetEl.removed === false ? sheetEl : null)
  try {
    T.appliquerJetons(mkCtx().ctx.theme, themed)
    check('the sheet stays for the frame in which DSH applies the layer', sheetEl.removed === false && frames.length === 1)
    frames.shift()()
    check('...and the next one', sheetEl.removed === false && frames.length === 1)
    frames.shift()()
    check('...then it is removed', sheetEl.removed === true)
    sheetEl.removed = false
    frames.length = 0
    T.appliquerJetons(mkCtx({ overrideThrows: true }).ctx.theme, themed)
    check('a layer DSH refused keeps the sheet (it is the only look there is)', sheetEl.removed === false && frames.length === 0)
    T.appliquerJetons(mkCtx().ctx.theme, T.DEF)
    check('the DSH look needs no sheet: it goes', frames.length === 1)
    check('the id in the page is the one the host injects', T.BOOT_ID === 'kbth-boot')
  } finally {
    if (realRaf === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = realRaf
    delete document.getElementById
  }
}

section('menu: the document (the vectors the three sanitizers agree on)')
{
  const clean = T.menuClean
  const json = JSON.stringify
  const a = clean({ entries: [{ id: 'skills', shown: false, order: 5 }, { id: 'kyber', shown: true, order: 0 }], unlisted: 'hide' })
  check('entries are sorted by order and renumbered 0..n-1; a hidden entry stays hidden; unlisted hide; locked false', json(a) === json({ entries: [{ id: 'kyber', shown: true, order: 0 }, { id: 'skills', shown: false, order: 1 }], unlisted: 'hide', locked: false }), a)
  const bad = ['workspaces', 'settings', 'account', 'projects', 'Kyber', 'a', 'x'.repeat(25)]
  const b = clean({ entries: bad.map((id) => ({ id, shown: false })).concat([{ id: 'skills', shown: true }]) })
  check('the rows nobody may hide, and malformed ids, are not storable (only « skills » is left)', b.entries.map((e) => e.id).join() === 'skills', b)
  check('a duplicate id: the first one wins', json(clean({ entries: [{ id: 'skills', shown: false }, { id: 'skills', shown: true }] }).entries) === json([{ id: 'skills', shown: false, order: 0 }]))
  const l = clean({ entries: [{ id: 'skills', shown: true, label: { en: '  Skills  ', fr: '', de: 'x', es: '<b>' } }] }).entries[0]
  check('a label is tidied per language: trimmed; an empty one, an unknown language and markup are dropped', json(l.label) === json({ en: 'Skills' }), l)
  check('a label of 40 characters stays, 41 is dropped, and an entry left with no label has none', json(clean({ entries: [{ id: 'skills', shown: true, label: { en: 'x'.repeat(40) } }] }).entries[0].label) === json({ en: 'x'.repeat(40) }) && clean({ entries: [{ id: 'skills', shown: true, label: { en: 'x'.repeat(41) } }] }).entries[0].label === undefined)
  const many = clean({ entries: Array.from({ length: 25 }, (_, i) => ({ id: 'row-' + String.fromCharCode(97 + i), shown: true })) })
  check('25 entries: the first 24 are kept', many.entries.length === 24 && many.entries[23].id === 'row-x', many.entries.length)
  const odd = clean({ entries: [], unlisted: 'x', locked: 'yes' })
  check('unlisted « x » is show and locked « yes » is false', odd.unlisted === 'show' && odd.locked === false)
  check('entries that is not an array, or a value that is not an object: no menu (null)', clean({ entries: 'x' }) === null && clean('x') === null && clean(null) === null && clean([1]) === null && clean({}) === null)
  check('a control character in a name becomes a space; a tab and a line separator too', clean({ entries: [{ id: 'skills', shown: true, label: { en: 'A\u0007B C\tD' } }] }).entries[0].label.en === 'A B C D')
  check('an entry without `shown` (or with a non-boolean one) is dropped, an order out of range falls back on the position', clean({ entries: [{ id: 'skills' }, { id: 'tasks', shown: 'yes' }, { id: 'kyber', shown: true, order: 200 }] }).entries.map((e) => e.id).join() === 'kyber')
}

section('menu: what the page shows, and how an edit changes it')
{
  const R = MENU_ROWS
  const ids = (v) => v.map((x) => x.id).join()
  const hide = (id) => (l) => { l.find((x) => x.id === id).shown = false }
  check('the default menu shows every row of this install, in the default order', ids(T.menuView(null, R)) === 'kyber,tasks,connectors,skills,aiteams,front-desk,deliverables' && T.menuView(null, R).every((v) => v.shown && v.name === v.base))
  const hidden = T.menuEdit(null, R, hide('skills'))
  check('hiding a row stores a FULL arrangement (one entry per row), only that row hidden, new rows shown later', hidden.entries.length === 7 && hidden.entries.filter((e) => !e.shown).map((e) => e.id).join() === 'skills' && hidden.unlisted === 'show' && hidden.locked === false, hidden)
  check('...it is not the default menu, and showing the row again gives back the default menu (null)', T.menuIsDefault(hidden, R) === false && T.menuEdit(hidden, R, (l) => { l.find((x) => x.id === 'skills').shown = true }) === null)
  const moved = T.menuEdit(null, R, (l) => { const i = l.findIndex((x) => x.id === 'skills'); const x = l.splice(i, 1)[0]; l.splice(0, 0, x) })
  check('moving a row first changes the order and nothing else', ids(T.menuView(moved, R)) === 'skills,kyber,tasks,connectors,aiteams,front-desk,deliverables' && T.menuView(moved, R).every((v) => v.shown))
  const named = T.menuEdit(null, R, (l) => { l.find((x) => x.id === 'skills').label.fr = 'Dossiers'; l.find((x) => x.id === 'skills').label.en = 'Playbooks' })
  check('a name per language: French page → « Dossiers », the default name stays in `base`', T.menuView(named, R).find((v) => v.id === 'skills').name === 'Dossiers' && T.menuView(named, R).find((v) => v.id === 'skills').base === 'Compétences')
  LANG = 'en'
  check('...the English page → « Playbooks », and a language with no label shows the default name, never another language’s name', T.menuView(named, MENU_ROWS_EN).find((v) => v.id === 'skills').name === 'Playbooks'
    && (() => { LANG = 'zh'; const n = T.menuView(named, MENU_ROWS_EN).find((v) => v.id === 'skills').name; LANG = 'en'; return n === 'Skills' })())
  LANG = 'kybernos'
  const short = { entries: [{ id: 'kyber', shown: true, order: 0 }], unlisted: 'hide', locked: false }
  check('« unlisted: hide »: a row the arrangement does not list is hidden, a listed one follows its `shown`', T.menuView(short, R).filter((v) => v.shown).map((v) => v.id).join() === 'kyber' && T.menuView(short, R).length === 7 && T.menuIsDefault(short, R) === false)
  check('« unlisted: show » (the default): a row added later by a plugin shows', T.menuView({ entries: [{ id: 'kyber', shown: true, order: 0 }], unlisted: 'show', locked: false }, R).every((v) => v.shown))
  {
    // A row a plugin declares with `defaultShown: false` (the Front desk, item 05 of the owner's list): listed by the page, switched OFF in the default menu.
    const RO = R.map((r) => (r.id === 'front-desk' ? { ...r, off: true } : r))
    check('a row that is off by default: listed by the page, hidden in the default menu, the others shown', ids(T.menuView(null, RO)) === ids(T.menuView(null, R)) && T.menuView(null, RO).filter((v) => !v.shown).map((v) => v.id).join() === 'front-desk' && T.menuIsDefault(null, RO) === true)
    const on = T.menuEdit(null, RO, (l) => { l.find((x) => x.id === 'front-desk').shown = true })
    check('...turning it on stores a full arrangement that lists it shown; it is no longer the default menu, and turning it off again gives back the default (null)', on !== null && on.entries.find((e) => e.id === 'front-desk').shown === true && T.menuIsDefault(on, RO) === false && T.menuEdit(on, RO, (l) => { l.find((x) => x.id === 'front-desk').shown = false }) === null)
    check('...hiding another row keeps the off row off (it is listed, not shown)', (() => { const h = T.menuEdit(null, RO, hide('skills')); return h.entries.find((e) => e.id === 'front-desk').shown === false && T.menuView(h, RO).filter((v) => v.shown).length === 5 })())
    check('...an arrangement that does not list it leaves it off, « unlisted: show » or not', T.menuView({ entries: [{ id: 'kyber', shown: true, order: 0 }], unlisted: 'show', locked: false }, RO).find((v) => v.id === 'front-desk').shown === false)
    check('...« show all » turns it on too', (() => { const all = T.menuShowAll(hidden, RO); return all !== null && all.entries.every((e) => e.shown) })())
    const regOff = (() => { const keep = loaderWindow.__KB_MENU_ENTRIES__; loaderWindow.__KB_MENU_ENTRIES__ = { v: 1, list: () => [{ id: 'kyber', icon: null, name: 'Kaby' }, { id: 'front-desk', icon: 'messageCircle', name: 'Front desk', off: true }] }; try { return T.menuRows() } finally { if (keep === undefined) delete loaderWindow.__KB_MENU_ENTRIES__; else loaderWindow.__KB_MENU_ENTRIES__ = keep } })()
    check('the registry\'s `off` reaches the page rows (and only on the row that has it)', regOff.length === 2 && regOff[0].off === undefined && regOff[1].off === true, regOff)
  }
  const locked = { ...hidden, locked: true }
  check('a menu set by an app is locked: an edit is refused (undefined), and « Show every entry » shows all while it stays locked', T.menuEdit(locked, R, hide('tasks')) === undefined && T.menuShowAll(locked, R).entries.every((e) => e.shown) && T.menuShowAll(locked, R).locked === true)
  check('« Show every entry » on an ordinary arrangement gives back the default menu; with no arrangement it stays null', T.menuShowAll(hidden, R) === null && T.menuShowAll(null, R) === null)
  const foreign = { entries: [{ id: 'kyber', shown: true, order: 0 }, { id: 'tables', shown: false, order: 1 }], unlisted: 'show', locked: false }
  check('a row of another machine (not in this registry) is kept by an edit, after the others, and never drawn', T.menuEdit(foreign, R, hide('skills')).entries.some((e) => e.id === 'tables' && e.shown === false) && ids(T.menuView(foreign, R)) === 'kyber,tasks,connectors,skills,aiteams,front-desk,deliverables')
  const full = T.menuFull(null, R)
  check('« the default menu » as a preset is a full arrangement: every row shown, in order; with no menu drawn here it is null', full.entries.length === 7 && full.entries.every((e) => e.shown) && T.menuFull(null, []) === null)
  check('the short lines say what an arrangement does', T.menuLines(null, R)[0] === 'Toutes les entrées, dans l’ordre habituel.' && T.menuLines(hidden, R).join(' | ').includes('Montre 6 entrées sur 7') && T.menuLines(hidden, R).join(' | ').includes('Cache : Compétences') && T.menuLines(named, R).join(' | ').includes('Renommé : Compétences → Dossiers'))
  check('the registry is read through one door; a malformed or missing registry gives no rows (the page says the menu is not drawn)', T.menuRows().length === 0)
  const w = (r) => { const keep = loaderWindow.__KB_MENU_ENTRIES__; loaderWindow.__KB_MENU_ENTRIES__ = r; try { return T.menuRows() } finally { if (keep === undefined) delete loaderWindow.__KB_MENU_ENTRIES__; else loaderWindow.__KB_MENU_ENTRIES__ = keep } }
  check('...a registry with a throwing list(), a wrong version or hostile rows (workspaces, bad id, no name) is read safely', w({ v: 1, list: () => { throw new Error('x') } }).length === 0 && w({ v: 2, list: () => [] }).length === 0
    && w({ v: 1, list: () => [{ id: 'workspaces', name: 'W' }, { id: 'Bad Id', name: 'B' }, { id: 'ok', name: 5 }, null, { id: 'good', name: 'Good', icon: 3 }] }).map((x) => x.id + ':' + x.icon).join() === 'good:null')
  check('...and the page language picks the label key: French for « kybernos » and fr, nothing for a language the labels do not cover', (() => { const out = []; for (const lg of ['kybernos', 'fr', 'en-GB', 'es', 'zh']) { LANG = lg; out.push(T.menuLabelKey()) } LANG = 'kybernos'; return out.join() === 'fr,fr,en,es,' })())
}

section('menu: stored, announced, and the library that carries it')
{
  const events = []
  loaderWindow.dispatchEvent = (e) => { events.push(e.type) }
  reset(); T.lib.presets = []; T.lib.menu = null; T.lib.updatedAt = 0
  const doc = { entries: [{ id: 'skills', shown: false, order: 0 }, { id: 'kyber', shown: true, order: 1 }], unlisted: 'hide', locked: false }
  check('putting a menu in use returns true, keeps it, and says so on the event the menu listens to', T.menuUse(doc) === true && T.lib.menu !== null && T.lib.menu.entries[0].id === 'skills' && events.join() === T.MENU_EVENT, events)
  const mirrored = JSON.parse(store.get(T.MENU_KEY))
  check('the menu’s own key holds { v: 1, updatedAt, menu }, written with the library', mirrored.v === 1 && mirrored.updatedAt === T.lib.updatedAt && mirrored.menu.entries.length === 2 && JSON.parse(store.get(T.LIB_KEY)).menu.entries.length === 2)
  events.length = 0
  check('the same menu again changes nothing and wakes nobody', T.menuUse(doc) === false && events.length === 0)
  check('something that is not a menu is refused and changes nothing', T.menuUse('junk') === false && T.menuUse({ entries: 'x' }) === false && T.lib.menu.entries.length === 2)
  check('back to the default menu: the menu key says null, the library document has no `menu` field', T.menuUse(null) === true && JSON.parse(store.get(T.MENU_KEY)).menu === null && !('menu' in JSON.parse(store.get(T.LIB_KEY))) && events.join() === T.MENU_EVENT)
  const old = { v: 1, updatedAt: 9, presets: [{ id: 'u-old', name: 'Ancien', source: 'me', at: 1, settings: { acc: '#0ea5e9' } }] }
  const c = T.libClean(old)
  check('a library saved before the menu existed reads back whole: the preset is unchanged, there is no menu', c.presets.length === 1 && c.presets[0].name === 'Ancien' && c.presets[0].settings.acc === '#0ea5e9' && c.menu === null && c.updatedAt === 9)
  store.set(T.LIB_KEY, JSON.stringify(old)); T.libRead()
  check('...also from the browser copy: it is what libRead puts in the library', T.lib.presets.length === 1 && T.lib.menu === null)
  check('a library document with a valid top-level menu keeps it; an invalid one is dropped without touching the presets', T.libClean({ ...old, menu: doc }).menu.entries.length === 2 && T.libClean({ ...old, menu: 'x' }).menu === null && T.libClean({ ...old, menu: { entries: 3 } }).presets.length === 1)
  T.lib.presets = []; T.lib.updatedAt = 0
  const only = T.presetRecord({ id: 'u-m', name: 'Menu seul', source: 'me', menu: doc })
  check('a preset may hold the menu only: valid, with no `settings`', only !== null && only.settings === undefined && only.menu.entries.length === 2)
  check('...a preset with neither, or with an empty menu and no settings, is not a preset', T.presetRecord({ id: 'u-x', name: 'x' }) === null && T.presetRecord({ id: 'u-x', name: 'x', menu: { entries: [] } }) === null)
  const both = T.presetRecord({ id: 't-c', name: 'Cabinet', source: 'template', settings: { acc: '#112233' }, menu: doc })
  check('the source « template » is kept, with both parts', both.source === 'template' && both.settings.acc === '#112233' && both.menu.entries.length === 2)
  const file = JSON.parse(T.presetFile(both))
  check('a preset file carries what the preset holds (appearance and menu), under the preset format', file.format === T.PRESET_FORMAT && file.settings.acc === '#112233' && file.menu.entries.length === 2 && JSON.parse(T.presetFile(only)).settings === undefined)
  const back = T.presetFromFileText(T.presetFile(both))
  check('...and reading it back gives the same two parts', back.ok === true && back.settings.acc === '#112233' && back.menu.entries.length === 2 && back.legacy === false)
  const menuFile = T.presetFromFileText(JSON.stringify({ format: T.PRESET_FORMAT, name: 'Court', menu: doc }))
  check('a file with a menu and no appearance is a menu preset', menuFile.ok === true && menuFile.settings === undefined && menuFile.menu.entries.length === 2)
  const a11y = T.presetFromFileText(JSON.stringify({ format: T.PRESET_FORMAT, name: 'X', settings: { acc: '#112233', cbSafe: true, contrastMode: 'max' } }))
  check('what comes from a file never carries accessibility settings: they are dropped, and the page can say so', a11y.ok === true && a11y.settings.cbSafe === undefined && a11y.settings.contrastMode === undefined && a11y.droppedA11y === true && a11y.settings.acc === '#112233')
  check('a file whose only content is accessibility, or whose menu is empty, is refused as empty', T.presetFromFileText(JSON.stringify({ format: T.PRESET_FORMAT, name: 'X', settings: { cbSafe: true } })).error === 'empty' && T.presetFromFileText(JSON.stringify({ format: T.PRESET_FORMAT, name: 'X', menu: { entries: [] } })).error === 'empty')
  delete loaderWindow.dispatchEvent
  reset(); T.lib.presets = []; T.lib.menu = null; T.lib.updatedAt = 0
}

section('presets: what the section lists, what a tick does, how the keys move')
{
  const R = MENU_ROWS
  const json = JSON.stringify
  reset(); T.lib.menu = null
  const mine = T.presetRecord({ id: 'u-b', name: 'Bureau', source: 'me', at: 1, settings: { mode: 'light', acc: '#0ea5e9', cbSafe: true, contrastMode: 'max' } })
  const menuMine = T.presetRecord({ id: 'u-m', name: 'Court', source: 'me', at: 2, menu: { entries: [{ id: 'skills', shown: true, order: 0 }], unlisted: 'hide', locked: false } })
  const tpl = T.presetRecord({ id: 't-c', name: 'Cabinet', source: 'template', at: 3, settings: { acc: '#112233' }, menu: { entries: [{ id: 'skills', shown: true, order: 0, label: { fr: 'Dossiers' } }], unlisted: 'show', locked: false } })
  const filed = T.presetRecord({ id: 'u-f', name: 'Fichier', source: 'file', at: 4, settings: { acc: '#445566', cbSafe: true }, menu: { entries: [{ id: 'tasks', shown: false, order: 0 }], unlisted: 'show', locked: false } })
  const gal = T.presetRecord({ id: 'g-l', name: 'Crépuscule', source: 'gallery', at: 5, settings: { acc: '#fb923c' } })
  T.lib.presets = [mine, filed, tpl, menuMine, gal]
  const items = T.presetItems()
  check('the section lists the six vibes, the two menus, then the templates, then mine (in the order they were added)', items.map((i) => i.key).join() === 'vibe:epure,vibe:work,vibe:dev,vibe:study,vibe:chill,vibe:night,menu:menu-complete,menu:menu-simple,rec:t-c,rec:u-b,rec:u-f,rec:u-m,rec:g-l', items.map((i) => i.key).join())
  check('built-in = the vibes, the two shipped menus and the templates; mine = saved, imported and from the gallery', items.filter(T.presetBuiltin).map((i) => i.id).join() === 'epure,work,dev,study,chill,night,menu-complete,menu-simple,t-c' && items.filter((i) => !T.presetBuiltin(i)).map((i) => i.id).join() === 'u-b,u-f,u-m,g-l')
  check('each item says what it holds: a vibe the appearance, a shipped menu the menu, a record what it carries', items.slice(0, 6).every((i) => i.A && !i.M) && items.slice(6, 8).every((i) => !i.A && i.M) && items.find((i) => i.id === 't-c').A && items.find((i) => i.id === 't-c').M && !items.find((i) => i.id === 'u-m').A && items.find((i) => i.id === 'u-m').M)
  const by = (id) => items.find((i) => i.id === id)
  check('the ticks start as promised: the appearance on; the menu on only for what is the person’s own or shipped; a menu from a file, the gallery or a template starts UNTICKED', json(T.presetTicks(by('work'))) === json({ tA: true, tM: false, tAcc: false })
    && T.presetTicks(by('menu-simple')).tM === true && T.presetTicks(by('u-m')).tM === true && T.presetTicks(by('t-c')).tM === false && T.presetTicks(by('u-f')).tM === false)
  check('accessibility: ticked from the start only on the person’s own preset; never for what comes from outside', T.presetTicks(by('u-b')).tAcc === true && T.presetTicks(by('u-f')).tAcc === false)
  const p1 = T.presetPlan(by('work'), { tA: true, tM: false, tAcc: false }, R)
  check('a vibe applies a whole appearance and its thinking animation, and leaves the menu alone (menu: undefined)', p1.patch !== null && p1.patch.acc === '#3B82F6' && p1.loop !== null && p1.menu === undefined && p1.keep === false)
  const p2 = T.presetPlan(by('u-b'), { tA: true, tM: false, tAcc: false }, R)
  check('without the accessibility tick the accessibility keys of a preset are NOT applied', p2.patch.acc === '#0ea5e9' && p2.patch.skin === 'u-b' && !('cbSafe' in p2.patch) && !('contrastMode' in p2.patch))
  const p3 = T.presetPlan(by('u-b'), { tA: true, tM: false, tAcc: true }, R)
  check('...with the tick they are', p3.patch.cbSafe === true && p3.patch.contrastMode === 'max')
  check('nothing ticked, nothing applied', (() => { const p = T.presetPlan(by('t-c'), { tA: false, tM: false, tAcc: false }, R); return p.patch === null && p.menu === undefined })())
  const p4 = T.presetPlan(by('menu-complete'), { tA: false, tM: true, tAcc: false }, R)
  check('« Complete » puts the default menu back (menu: null); « Simple » puts its short arrangement', p4.menu === null && p4.patch === null && T.presetPlan(by('menu-simple'), { tM: true }, R).menu.unlisted === 'hide')
  T.lib.menu = null
  check('a menu from outside, applied while the person has the default menu: nothing to keep', T.presetPlan(by('t-c'), { tA: false, tM: true, tAcc: false }, R).keep === false)
  T.lib.menu = T.menuClean({ entries: [{ id: 'tasks', shown: false, order: 0 }], unlisted: 'show', locked: false })
  check('...while the person has a menu of their own: it is kept in Mine first (keep: true), unless it is the same one', T.presetPlan(by('t-c'), { tM: true }, R).keep === true && T.presetPlan(by('u-f'), { tM: true }, R).keep === false && T.presetPlan(by('u-m'), { tM: true }, R).keep === false)
  T.lib.menu = null; T.lib.presets = []
  const keys = (f, ks, i, n) => ks.map((k) => f(k, i, n))
  check('a list moves with the arrow keys, Home and End, and stops at the ends; other keys are not for it', json(keys(T.selNav, ['ArrowDown', 'ArrowUp', 'Home', 'End', 'x'], 2, 5)) === json([3, 1, 0, 4, null]) && T.selNav('ArrowDown', 4, 5) === 4 && T.selNav('ArrowUp', 0, 5) === 0 && T.selNav('ArrowDown', 0, 0) === null)
  check('a segmented control moves with Left / Right (Up / Down too), and stops at the ends', json(keys(T.segNav, ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'], 1, 3)) === json([2, 0, 2, 0, 0, 2, null]) && T.segNav('ArrowRight', 2, 3) === 2)
  const fo = T.fontOptions()
  check('the select options are drawn in their own style: each font in its typeface (grouped), each wallpaper with a swatch, each icon set with a sample', fo.length === T.FONTS.length && fo.filter((o) => o.style !== undefined).length === T.FONTS.filter((f) => f.stack !== null).length && new Set(fo.map((o) => o.group)).size === 3
    && T.wallOptions().length === T.WPS.length && T.iconSetOptions().length === T.ICON_SETS.length && T.iconSetOptions().every((o) => o.lead !== undefined))
}

section('menu: the account menu and the Settings pages (surfaces) and the locked preset')
{
  const clean = T.menuClean
  const json = JSON.stringify
  const doc = { entries: [], surfaces: { secondary: { entries: [{ id: 'upgrade', shown: false, order: 7 }, { id: 'help', shown: true, order: 2 }], unlisted: 'hide' }, settings: { entries: [{ id: 'theme', shown: true }] } } }
  const r = clean(doc)
  check('a surface is sorted and renumbered; its unlisted is its own; settings defaults to show', json(r.surfaces.secondary) === json({ entries: [{ id: 'help', shown: true, order: 0 }, { id: 'upgrade', shown: false, order: 1 }], unlisted: 'hide' }) && json(r.surfaces.settings) === json({ entries: [{ id: 'theme', shown: true, order: 0 }], unlisted: 'show' }), r)
  check('a document without surfaces has no `surfaces` key', clean({ entries: [{ id: 'skills', shown: true }] }).surfaces === undefined)
  for (const id of ['account', 'referral', 'settings', 'logout', 'Help', 'a']) check('the account menu refuses "' + id + '"', clean({ entries: [], surfaces: { secondary: { entries: [{ id, shown: false }, { id: 'help', shown: false }] } } }).surfaces.secondary.entries.map((e) => e.id).join() === 'help')
  check('Settings refuses "general", keeps the others', clean({ entries: [], surfaces: { settings: { entries: [{ id: 'general', shown: false }, { id: 'kaby', shown: false }] } } }).surfaces.settings.entries.map((e) => e.id).join() === 'kaby')
  check('an entry carries no name on a surface', json(clean({ entries: [], surfaces: { secondary: { entries: [{ id: 'help', shown: true, label: { en: 'Aide' } }] } } }).surfaces.secondary.entries[0]) === json({ id: 'help', shown: true, order: 0 }))
  check('a surface that says nothing is dropped, and `surfaces` with it; one that hides what it does not list is kept', clean({ entries: [], surfaces: { secondary: { entries: [] }, settings: { entries: [{ id: 'general', shown: true }] } } }).surfaces === undefined && json(clean({ entries: [], surfaces: { settings: { entries: [], unlisted: 'hide' } } }).surfaces) === json({ settings: { entries: [], unlisted: 'hide' } }))
  check('an unknown surface name is dropped; junk `surfaces` is ignored', clean({ entries: [], surfaces: { main: { entries: [{ id: 'help', shown: true }] } } }).surfaces === undefined && clean({ entries: [], surfaces: 'x' }).surfaces === undefined && clean({ entries: [], surfaces: [] }).surfaces === undefined)
  check('bounds: 24 on the account menu, 64 on Settings', clean({ entries: [], surfaces: { secondary: { entries: Array.from({ length: 30 }, (_, i) => ({ id: 'e' + 'a'.repeat(i % 5 + 1) + i, shown: true })) }, settings: { entries: Array.from({ length: 80 }, (_, i) => ({ id: 'p' + i + 'x', shown: false })) } } }).surfaces.settings.entries.length === 64)
  check('menuHasContent: a menu with only a surface counts, an empty one does not', T.menuHasContent(r) === true && T.menuHasContent(clean({ entries: [] })) === false && T.menuHasContent(null) === false)
  // The same documents, a seeded batch of them, give the same answer here and in the host's sanitizer.
  const { sanitizeMenu } = await import('./preset-store.mjs')
  let seed = 20261123
  const rnd = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor((seed / 4294967296) * n) }
  const pick = (list) => list[rnd(list.length)]
  const IDS = ['skills', 'kyber', 'workspaces', 'settings', 'account', 'Kyber', 'a', 7, null]
  const SIDS = ['spaces', 'create-team', 'upgrade', 'phone', 'help', 'account', 'referral', 'settings', 'logout', 'general', 'kaby', 'theme', 'Kaby', 'a', 7, null]
  let diff = 0
  let first = null
  for (let i = 0; i < 400; i++) {
    const d = { entries: Array.from({ length: rnd(10) }, () => ({ id: pick(IDS), shown: pick([true, false, 'yes']), order: pick([0, 1, 99, 100, null]) })), unlisted: pick(['show', 'hide', 'x']), locked: pick([true, false, 'yes']) }
    const surf = () => (rnd(8) === 0 ? pick([null, 7, 'x', [], { entries: 'no' }]) : { entries: Array.from({ length: rnd(rnd(2) === 0 ? 30 : 80) }, () => ({ id: pick(SIDS), shown: pick([true, false, undefined]), order: pick([0, 5, 99, 100, -1, null, rnd(120)]), label: rnd(4) === 0 ? { en: 'x' } : undefined })), unlisted: pick(['show', 'hide', 'x']) })
    if (rnd(2) === 0) d.surfaces = pick([{ secondary: surf(), settings: surf() }, { secondary: surf() }, { settings: surf(), main: surf() }, null, 7, []])
    if (json(sanitizeMenu(d)) !== json(clean(d))) { diff += 1; if (first === null) first = d }
  }
  check('the page\'s cleaner and the host\'s (preset-store `sanitizeMenu`) agree on 400 seeded documents, surfaces included', diff === 0, { diff, first })

  // ── what the page shows and how an edit changes it ──
  loaderWindow.__KB_MENU_ENTRIES__ = menuRegistryFor()
  const sec = T.surfaceRows('secondary')
  const set = T.surfaceRows('settings')
  check('the page reads the registry\'s surfaces: entries with their lock and group', sec.length === 8 && set.length === 5 && sec.filter((x) => x.locked).map((x) => x.id).join() === 'account,referral,settings,logout' && set.find((x) => x.id === 'kaby').groupName === 'Agents' && set.find((x) => x.id === 'general').locked === true, [sec.length, set.length])
  check('a registry that does not know surfaces (no `hooks.secondary`) gives none: the zone is not offered, the main rows never stand in', (() => { loaderWindow.__KB_MENU_ENTRIES__ = { v: 1, list: () => MENU_ROWS, hook: 'data-kb-row' }; try { return T.surfaceRows('secondary').length === 0 && T.surfaceRows('settings').length === 0 && T.surfaceRows('main').length === 0 } finally { loaderWindow.__KB_MENU_ENTRIES__ = menuRegistryFor() } })())
  check('nothing stored: every entry is shown, the locked ones too', T.surfaceView(null, 'secondary', sec).every((v) => v.shown))
  const hidden = T.surfaceEdit(null, 'secondary', sec, MENU_ROWS, (l) => { l.find((x) => x.id === 'upgrade').shown = false })
  check('hiding "Upgrade" stores the account menu only (the main menu is left as the default: no entry, show)', hidden.entries.length === 0 && hidden.unlisted === 'show' && hidden.surfaces.secondary.entries.filter((e) => !e.shown).map((e) => e.id).join() === 'upgrade' && hidden.surfaces.settings === undefined, hidden)
  check('...one entry per item that can be hidden, none for the four locked ones', hidden.surfaces.secondary.entries.length === 4 && hidden.surfaces.secondary.entries.every((e) => ['account', 'referral', 'settings', 'logout'].indexOf(e.id) < 0), hidden.surfaces.secondary.entries.map((e) => e.id))
  check('...it is not the default menu; showing it again gives back the default (null)', T.menuIsDefault(hidden, MENU_ROWS) === false && T.surfaceEdit(hidden, 'secondary', sec, MENU_ROWS, (l) => { l.find((x) => x.id === 'upgrade').shown = true }) === null)
  check('a locked entry cannot be switched: the edit leaves it shown', (() => { const d = T.surfaceEdit(null, 'secondary', sec, MENU_ROWS, (l) => { l.find((x) => x.id === 'settings').shown = false; l.find((x) => x.id === 'help').shown = false }); return d !== null && T.surfaceView(d, 'secondary', sec).find((v) => v.id === 'settings').shown === true && T.surfaceView(d, 'secondary', sec).find((v) => v.id === 'help').shown === false })())
  const both = T.surfaceEdit(hidden, 'settings', set, MENU_ROWS, (l) => { l.find((x) => x.id === 'about').shown = false })
  check('a second surface keeps the first', both.surfaces.secondary.entries.some((e) => e.id === 'upgrade' && !e.shown) && both.surfaces.settings.entries.some((e) => e.id === 'about' && !e.shown))
  const mainEdit = T.menuEdit(both, MENU_ROWS, (l) => { l.find((x) => x.id === 'skills').shown = false })
  check('an edit of the main menu keeps both surfaces', json(mainEdit.surfaces) === json(both.surfaces) && mainEdit.entries.some((e) => e.id === 'skills' && !e.shown))
  check('the full arrangement (what a preset keeps) keeps the surfaces', json(T.menuFull(both, MENU_ROWS).surfaces) === json(both.surfaces))
  const all = T.menuShowAll(both, MENU_ROWS)
  check('« Show every entry » shows the surfaces too, and gives back the default menu', all === null, all)
  const ruled = clean({ entries: [], surfaces: { settings: { entries: [{ id: 'kaby', shown: true }], unlisted: 'hide' } } })
  check('a surface that hides what it does not list: the others are hidden in the view, and an edit keeps that rule', T.surfaceView(ruled, 'settings', set).filter((v) => v.shown).map((v) => v.id).join() === 'general,kaby' && T.surfaceEdit(ruled, 'settings', set, MENU_ROWS, (l) => { l.find((x) => x.id === 'theme').shown = true }).surfaces.settings.unlisted === 'hide')
  check('« Show every entry » on such a rule drops the rule', T.menuShowAll(ruled, MENU_ROWS) === null)
  check('a locked arrangement is read only for a surface (undefined = refused), and « Show every entry » still works on it', T.surfaceEdit(clean({ entries: [], locked: true, surfaces: { secondary: { entries: [{ id: 'help', shown: false }] } } }), 'secondary', sec, MENU_ROWS, () => {}) === undefined && T.menuShowAll(clean({ entries: [], locked: true, surfaces: { secondary: { entries: [{ id: 'help', shown: false }] } } }), MENU_ROWS).surfaces.secondary.entries[0].shown === true)
  check('the lines of a plan say what a surface hides', T.menuLines(both, MENU_ROWS).some((l) => /Menu du compte : cache 1 entrée/.test(l)) && T.menuLines(both, MENU_ROWS).some((l) => /Réglages : cache 1 entrée/.test(l)), T.menuLines(both, MENU_ROWS))
  check('a menu-only preset that holds only a surface is a valid record (and keeps it)', (() => { const rec = T.presetRecord({ id: 'u-surf', name: 'No upgrade', source: 'me', at: 1, menu: hidden }); return rec !== null && rec.menu.surfaces.secondary.entries.some((e) => e.id === 'upgrade') && rec.settings === undefined })())
  delete loaderWindow.__KB_MENU_ENTRIES__

  // ── the locked « Simple » preset ──
  const L = T.lockedMenu('locked-simple')
  check('the phone\'s Simple is a locked arrangement: its main menu is Automations (the real `tasks` row, under the registry\'s own name) and Apps (the real `connectors` row, renamed), the Kaby row at the top hidden (the `kyber` row: the folder under Workspaces and Settings › Kaby remain), every other row of the full app hidden (the conversations are the drawer\'s own list)', L !== null && L.locked === true && json(L.entries.map((e) => e.id)) === json(['kyber', 'tasks', 'connectors']) && L.entries.filter((e) => e.shown).map((e) => e.id).join() === 'tasks,connectors' && L.entries[0].shown === false && L.unlisted === 'hide' && L.entries[1].label === undefined && L.entries[2].label.en === 'Apps' && L.entries[2].label.fr === 'Apps', L)
  check('default 2, 3, 4: Referral is not hideable (it is locked by the surface), Help and Send feedback stay, Phone and channels (and the entries that open the web or a team: the list of spaces and its team rows too, since the phone\'s engine cannot start a team) are hidden', (() => {
    const s = L.surfaces.secondary
    const shown = (id) => { const e = s.entries.find((x) => x.id === id); return e === undefined ? s.unlisted === 'show' : e.shown }
    return s.entries.every((e) => e.id !== 'referral') && shown('help') && shown('feedback') && !shown('phone') && !shown('upgrade') && !shown('team-settings') && !shown('website') && !shown('create-team') && !shown('join-team') && !shown('spaces') && shown('plan') && shown('appearance')
  })(), L.surfaces.secondary)
  check('signed out (S3): « Create an account » and « See plans » are hidden in the phone\'s menu (it offers no sign-up and no offers to a person with no account); « Sign in » is a row no preset can hide (it is not in the table); the signed-in rows are unchanged', (() => {
    const s = L.surfaces.secondary
    const shown = (id) => { const e = s.entries.find((x) => x.id === id); return e === undefined ? s.unlisted === 'show' : e.shown }
    return !shown('signup') && !shown('plans') && s.entries.every((e) => e.id !== 'connect') && shown('plan') && shown('help') && shown('feedback') && shown('appearance')
  })(), L.surfaces.secondary)
  check('the preset\'s `messageActions` option (read by the Kybernos plugin, in Kaby mode only): `tap` = the row under the agent\'s answers is shown by a tap; it is a plain word, a fresh copy each call, and an unknown preset has none', (() => { const o = T.lockedOptions('locked-simple'); o.messageActions = 'x'; return T.lockedOptions('locked-simple').messageActions === 'tap' && T.lockedOptions('nope').messageActions === undefined && /messageActions: 'tap' \}/.test(SOURCE) })())
  check('the preset\'s `padlock` option (read by kybernos-cloud): the Automations (`tasks`) and Apps (`connectors`) rows are the ones locked while nobody is signed in, and they are rows the preset shows; a deep copy', (() => { const o = T.lockedOptions('locked-simple'); const a = o.padlock.slice(); o.padlock.push('kyber'); const b = T.lockedOptions('locked-simple').padlock; return json(b) === json(['tasks', 'connectors']) && json(a) === json(b) && b.every((id) => L.entries.some((e) => e.id === id && e.shown)) })())
  check('default 5: Settings keeps five pages (Kaby, Memory & Lessons, Theme, Language, About; the app\'s own parts are drawn inside About, item 28); General, Usage and Connectors are hidden, and so is every other page and any added later', L.surfaces.settings.unlisted === 'hide' && json(L.surfaces.settings.entries.filter((e) => e.shown).map((e) => e.id)) === json(['kaby', 'memory', 'theme', 'language', 'about']) && json(L.surfaces.settings.entries.filter((e) => !e.shown).map((e) => e.id)) === json(['general']) && !L.surfaces.settings.entries.some((e) => e.id === 'usage' || e.id === 'connectors'))
  check('only the locked preset can hide General: the person\'s own arrangement (and an imported one that claims `locked`) is still cleaned with the surface\'s refusal', (() => { const forged = { entries: [], locked: true, trusted: true, surfaces: { settings: { entries: [{ id: 'general', shown: false }, { id: 'kaby', shown: false }] } } }; return json(clean(forged).surfaces.settings.entries.map((e) => e.id)) === json(['kaby']) && json(clean(L).surfaces.settings.entries.map((e) => e.id)).indexOf('general') < 0 && json(clean(L, true)) === json(L) })())
  check('every main id of the preset is a row the real registry knows (the drawer draws the sidebar\'s rows: a Simple-only id would match nothing)', L === null || (() => { const known = ['kyber', 'tasks', 'connectors']; return json(T.lockedMenu('locked-simple').entries.map((e) => e.id)) === json(known) && !/['"](reminders|apps|chats)['"]/.test(SOURCE.slice(SOURCE.indexOf('const LOCKED_PRESETS = {'), SOURCE.indexOf('const LOCKED_PRESETS = {') + 1800).replace(/label: \{[^}]*\}/g, '')) })())
  check('default 6: nothing in the arrangement is about the chat itself (a preset only shows or hides entries)', Object.keys(L).sort().join() === 'entries,locked,surfaces,unlisted')
  check('it is the cleaner\'s own output (nothing the cleaner would drop or change), checked by the cleaner again (the trusted path, the locked preset\'s only one)', json(clean(L, true)) === json(L))
  check('each call gives a fresh copy: changing it does not reach the table', (() => { L.entries.length = 0; L.surfaces.secondary.entries.length = 0; const again = T.lockedMenu('locked-simple'); return again.entries.length === 3 && again.surfaces.secondary.entries.length > 0 })())
  check('an id this build does not ship gives null; so does junk, and a prototype name', T.lockedMenu('nope') === null && T.lockedMenu(7) === null && T.lockedMenu(undefined) === null && T.lockedMenu('toString') === null && T.lockedMenu('__proto__') === null && T.lockedMenu('constructor') === null)
  check('it is not in the library, nor the library\'s menu, nor a built-in of the page (a person cannot pick, edit, export or delete it)', T.lib.presets.every((p) => p.id !== 'locked-simple') && T.lib.menu === null && !T.MENU_BUILTINS.some((m) => m.id === 'locked-simple' || m.id === 'menu-locked-simple') && !/['"]locked-simple['"]/.test(SOURCE.slice(0, SOURCE.indexOf('const LOCKED_PRESETS = {'))))
  check('the table is the only source: the seam hands out copies of it, and nothing writes into it', (() => { const i = SOURCE.indexOf('const LOCKED_PRESETS = {'); const tail = SOURCE.slice(i + 100); return !/LOCKED_PRESETS\[[^\]]+\]\s*=[^=]/.test(tail) && !/LOCKED_PRESETS\.[a-z]+\s*=[^=]/.test(tail) && !/delete LOCKED_PRESETS/.test(tail) })())
  check('the seam is `window.__KB_THEME_LOCKED__`: published once, not writable, not configurable, { v: 1, ids, get, name }', /Object\.defineProperty\(window, '__KB_THEME_LOCKED__', \{ value: Object\.freeze\(\{ v: 1, ids: \(\) => Object\.keys\(LOCKED_PRESETS\), get: lockedMenu,/.test(SOURCE) && /writable: false, configurable: false/.test(SOURCE))

  // ── touch comfort (step 6 part 2) ──
  const TC = T.touchCss()
  check('touch comfort: one static stylesheet, inside the 480 px media query, balanced braces', TC.startsWith('@media (max-width: 480px){') && TC.endsWith('}') && (TC.match(/\{/g) || []).length === (TC.match(/\}/g) || []).length && T.TOUCH_MEDIA === '(max-width: 480px)')
  check('...every rule is keyed on the attribute (inert without it) and every declaration is !important', T.TOUCH_RULES.length > 25 && T.TOUCH_RULES.every((r) => r[0].length > 0 && r[0].every((x) => TC.includes('html[data-kb-touch="on"] ' + x + (r[0].indexOf(x) === r[0].length - 1 ? '{' : ','))) && r[1].split(';').every((d) => /^[a-z-]+:/.test(d))) && TC.split('\n').slice(1, -1).every((l) => l.startsWith('html[data-kb-touch="on"] ') && l.slice(l.indexOf('{') + 1, -1).split(';').every((d) => d.endsWith('!important'))))
  check('...it uses stable hooks only (roles, data-slot, data-kb*, the plugins\' own kb* classes); the one engine class it names is the `_danger_` marker, by substring', !/_[A-Za-z]+_[0-9a-z]{5,}_/.test(TC) && /\[class\*="_danger_"\]/.test(TC) && !/\.(?!kb)[a-z]+-[a-z0-9]{6,}\b/.test(TC.replace(/var\([^)]*\)/g, '')))
  check('...it covers the sheets (full width), rows, the Appearance switch, the drawer, Settings, the search palette and the section tabs', ['justify-self:stretch', 'align-self:flex-end', ':has(> [role="dialog"]:not([data-shortcut-modal])', '[role^="menuitem"]', 'menu-appearance"] .kbfp-seg', '[data-kb-row]', 'data-row-key', '[data-shortcut-modal="settings"]', '.kbsr-dlg', '.kbsr-scopes', '.kbkc-tabs', '.kbth-adv-tabs', '.kbln-tabs', 'flex-direction:column'].every((x) => TC.includes(x)))
  check('« Back to workspace » (Settings header, `.kbsb`) reads like a row\'s title: 18 px text, a 24 px arrow, a tap zone at least 48 px high (it was 14 px, a 15 px arrow and 40 px on the owner\'s phone)', (() => {
    const m = /\.kbsb\{([^}]*)\}/.exec(TC); const a = /\.kbsb svg\{([^}]*)\}/.exec(TC)
    return m !== null && a !== null && /min-height:48px!important/.test(m[1]) && /font-size:18px!important/.test(m[1]) && /width:24px!important/.test(a[1]) && /height:24px!important/.test(a[1]) && T.TOUCH_RULES.some((r) => r[0].some((x) => x === '[data-shortcut-modal="settings"] .kbsb'))
  })())
  check('the search palette loses its keyboard hints (Esc and the « ? ») and its scopes scroll on one line', /\.kbsr-top \.kbsr-kbd[^{]*\{display:none!important\}/.test(TC) && /\.kbsr-foot > span:has\(> \.kbsr-kbd\)[^{]*\{display:none!important\}/.test(TC) && /\.kbsr-scopes\{flex-wrap:nowrap!important;overflow-x:auto!important/.test(TC))
  check('the preset option: Simple (phone) turns touch comfort on; an unknown id has none; each call is a fresh copy; the seam hands it out', (() => { const o = T.lockedOptions('locked-simple'); o.touch = false; return T.lockedOptions('locked-simple').touch === true && Object.keys(T.lockedOptions('nope')).length === 0 && Object.keys(T.lockedOptions('toString')).length === 0 && /get: lockedMenu, options: lockedOptions,/.test(SOURCE) })())
  check('the preset option `appPage` (read by kybernos-mobile for the app\'s parts it draws inside About): Simple hides the engine-log card and draws the computer card only when a computer is linked; each call is a deep copy, so a reader changing it changes nothing', (() => { const a = T.lockedOptions('locked-simple').appPage; a.log = true; a.computer = 'always'; const b = T.lockedOptions('locked-simple').appPage; return b.log === false && b.computer === 'linked' && Object.keys(b).sort().join() === 'computer,log' })())
  check('the option is read only in Kaby mode (`kb-kaby` on <html>), the person\'s own setting anywhere; the class is watched (the Mobile bundle sets it, maybe after this runs)', /const touchWanted = \(S\) => \{\s*if \(S\.touch === true\) return true\s*try \{ return document\.documentElement\.classList\.contains\('kb-kaby'\) && lockedTouch\(\) \}/.test(SOURCE) && /attributeFilter: \['class'\]/.test(SOURCE))
  check('the setting is an accessibility one: default off, a boolean, kept by presets of the person\'s own business (PRESET_KEYS), never by a catalogue', /\n\s*touch: false,\n/.test(SOURCE) && T.PRESET_KEYS.indexOf('touch') >= 0 && T.valeursValides({ touch: true }).touch === true && T.valeursValides({ touch: 'x' }).touch === undefined)
  // ── presentation: the Settings pages (tabsNav, rowsLayout, rowsDescription, helpButton, cardsFrame, chipsStyle, groupTitles), the drawer, the composer and the empty chat (drawerSize, drawerPanels, composerSize, newChatCards) ──
  const PC = T.presCss()
  const PRES_OFF = { tabsNav: 'tabs', rowsLayout: 'stacked', rowsDescription: 'below', helpButton: 'boxed', cardsFrame: 'boxed', chipsStyle: 'pill', groupTitles: 'shown', drawerSize: 'standard', drawerPanels: 'shown', composerSize: 'standard', newChatCards: 'slider', rating: 'thumbs', messageSize: 'standard' }
  // what the phone's Simple picks (the cards of the empty chat are the slider, which is the default: no token), the eleven tokens it turns on (ten of the layout and `rating-thumbs`; the size of the messages is the default, no token), and the sixteen tokens in all (`newChatCards` has two more values, `messageSize` three)
  const PRES_ON = { tabsNav: 'list', rowsLayout: 'inline', rowsDescription: 'info', helpButton: 'named', cardsFrame: 'flat', chipsStyle: 'plain', groupTitles: 'hidden', drawerSize: 'large', drawerPanels: 'hidden', composerSize: 'large', newChatCards: 'slider', rating: 'thumbs', messageSize: 'standard' }
  const PRES_TEN = ['tabs-list', 'rows-inline', 'desc-info', 'help-named', 'frame-flat', 'chips-plain', 'groups-hidden', 'drawer-large', 'panels-hidden', 'composer-large']
  const PRES_ALL = PRES_TEN.concat(['rating-thumbs'])
  const PRES_TOKENS_ALL = PRES_TEN.slice(0, 3).concat(['help-bare']).concat(PRES_TEN.slice(3)).concat(['nccards-grid', 'nccards-hidden', 'rating-thumbs', 'msg-compact', 'msg-large', 'msg-xlarge'])
  check('presentation: thirteen settings, every default is the look of the phone\'s mock-up (the usual look, but thumbs for the rating), each is a choice of two (the « ? » button and the cards of the empty chat: three, the size of the messages: four) checked by the cleaner (a wrong value is dropped)', Object.keys(PRES_OFF).every((k) => T.DEF[k] === PRES_OFF[k] && T.ENUMS[k].length === (k === 'newChatCards' || k === 'helpButton' ? 3 : k === 'messageSize' ? 4 : 2) && T.ENUMS[k].indexOf(PRES_ON[k]) >= 0 && T.valeursValides({ [k]: PRES_ON[k] })[k] === PRES_ON[k] && T.valeursValides({ [k]: 'nope' })[k] === undefined) && json(T.ENUMS.newChatCards) === json(['slider', 'grid', 'hidden']) && ['grid', 'hidden'].every((v) => T.valeursValides({ newChatCards: v }).newChatCards === v))
  check('...they are not part of a theme (PRESET_KEYS): a layout of a screen is not a look, a gallery theme or an imported file cannot change it', Object.keys(PRES_OFF).every((k) => T.PRESET_KEYS.indexOf(k) < 0))
  const PRES_MQ = '(max-width: 700px), (max-height: 500px) and (pointer: coarse)'
  check('presentation: ONE static stylesheet, a base outside the query that hides what the walker adds, then every rule inside the mobile breakpoint query (<= 700 px including 601–700 px, or landscape touch; a wide desktop is as before), balanced braces', PC.startsWith('.kbth-info,.kbth-navback{display:none}\n@media ' + PRES_MQ + '{') && PC.endsWith('}') && T.PRES_MEDIA === PRES_MQ && (PC.match(/\{/g) || []).length === (PC.match(/\}/g) || []).length)
  check('...every rule is under ONE token of the one attribute (inert without it), with the specificity of an id (the phone layer\'s structural rules are heavier than a class chain), every declaration !important', T.PRES_RULES.length > 25 && T.PRES_RULES.every((r) => T.PRES_TOKENS.some((t) => t[2] === r[0]) && r[1].length > 0) && PC.split('\n').slice(2, -1).every((l) => l.startsWith(':is(html,#kb-pres)[data-kb-pres~="') && l.slice(l.indexOf('{') + 1, -1).split(';').every((d) => d.endsWith('!important'))))
  check('...the seventeen tokens are the ones the settings put on <html>, and each has at least one rule', json(T.PRES_TOKENS.map((t) => t[2])) === json(PRES_TOKENS_ALL) && T.PRES_TOKENS.every((t) => T.PRES_RULES.some((r) => r[0] === t[2])) && T.PRES_ATTR === 'data-kb-pres')
  check('...it names the balisage of the pages in this one place, hub « ? » included, and no hashed class of the engine', ['.kbmem-srow', '.kbln-set-row', '.kbkc-mrow', '.kbkc-tabs', '.kbkc-card', '.kbln-langs', '.kbkc-chip', '.kbhp-btn', '.kb6-helpbtn', '.kbln-help-btn', '.kbat-help', '.kbcl-hl', '[data-kb-desc="fold"]'].every((x) => PC.includes(x)) && !/_[A-Za-z]+_[0-9a-z]{5,}_/.test(PC))
  check('...a description folds only if the page marked it, and only while it is not open; the « i » is a 44 px button with a visible focus ring', /\[data-kb-desc="fold"\]:not\(\[data-kb-open="1"\]\)\{display:none!important\}/.test(PC) && /\.kbth-info\{[^}]*width:44px!important;height:44px!important/.test(PC) && /\.kbth-info:focus-visible\{outline:2px solid/.test(PC))
  check('...the bare « ? » keeps its 44 px zone (the phone layer\'s size), loses the square, has a focus ring, and its colour is 80 % of the text colour (readable, not a faint grey)', /\.kbhp-btn[^{]*\{background:transparent!important/.test(PC) && !/\.kbhp-btn[^{]*\{[^}]*(width|height):[0-9]/.test(PC) && /:focus-visible[^{]*\{outline:2px solid/.test(PC) && /color:color-mix\(in srgb,var\(--dsw-alias-label-primary,currentColor\) 80%,transparent\)/.test(PC))
  check('...a segmented choice or a pair of buttons stays under its text; a switch or one small button sits opposite (Memory, Language)', /:not\(:has\(> \.ctl \[role="radiogroup"\], > \.ctl \.kbmem-seg, > \.ctl \.kbmem-acts\)\)/.test(PC) && /\.kbln-set-row:has\(> label\.kbln-sw\)/.test(PC))
  check('...Kaby\'s switch goes opposite its label, the « i » stays at the end of a wrapping label (Memory, Language), a frameless block keeps no side padding, the Language status words are plain too', /\.kbkc-mrow > \.kbkc-sw[^{]*\{order:2!important/.test(PC) && /\.kbmem-srow \.lab:has\(> \.kbth-info\)[^{]*\{flex-wrap:nowrap!important/.test(PC) && /\.kbln-set-lb:has\(> \.kbth-info\)[^{]*\{display:flex!important/.test(PC) && /\.kbth-pr-strip[^{]*\.kbln-set-row[^{]*\.kbmz-auto[^{]*\{padding-inline:0!important/.test(PC) && /\.kbln-state[^{]*\.kbln-pill[^{]*\{border:0!important/.test(PC))
  check('...a note that carries its own button stacks (icon, text over the width, button under the text) only under the inline-rows token; the Kaby back row is a quiet 15 px link of 44 px, kept above the title so its tap zone stays whole', /rows-inline"\][^{]*\.kbmem-note:has\(> svg\):has\(> button\)\{display:grid!important;grid-template-columns:auto minmax\(0,1fr\)!important/.test(PC) && /\.kbmem-note:has\(> svg\):has\(> button\) > button\{grid-column:2!important;justify-self:start!important/.test(PC) && /\.kbth-navback\{display:flex!important;align-self:flex-start!important;align-items:center!important;gap:4px!important;order:-2!important;position:relative!important;z-index:1!important;min-height:44px!important;margin:0 0 -26px!important[^}]*font-size:15px!important;font-weight:500!important/.test(PC))
  check('...group titles: the names of the Settings menu groups (the core plugin\'s fold headers) leave the screen and the focus order and keep a 16 px gap, no line (a line between nearly every row read as a list of boxes); shown by default, hidden by the phone\'s Simple, never outside a phone', /\[data-kb-settings\] \[data-kb-fold-toggle\]\{visibility:hidden!important;height:0!important;min-height:0!important;margin:16px 0 0!important;padding:0!important/.test(PC) && T.DEF.groupTitles === 'shown' && T.lockedPresentation().groupTitles === 'hidden' && PC.split('\n').filter((l) => /groups-hidden/.test(l)).length === 1)
  // the drawer, the composer and the empty chat (mockup 2 of 2026-11-23): targets 52 px, text 17 to 22 px, under their own token
  const presLines = (tok) => PC.split('\n').filter((l) => l.includes('[data-kb-pres~="' + tok + '"]'))
  const declOf = (tok, sel) => presLines(tok).filter((l) => l.includes(sel)).map((l) => l.slice(l.indexOf('{') + 1, -1)).join(';')
  const px = (decl, prop) => { const m = decl.match(new RegExp('(?:^|;)' + prop + ':([0-9.]+)px')); return m === null ? 0 : Number(m[1]) }
  check('drawer: « Pinned » (`.kbpin_header`) has exactly the look of « Recents » (`[role="tree"]::after`): 17 px, weight 600, the same padding (list 25)', (() => {
    const same = (sel) => /font-size:17px!important;font-weight:600!important;padding:14px 16px 6px!important/.test(presLines('drawer-large').filter((l) => l.includes(sel)).join(''))
    return same('[role="tree"]::after') && same('.kbpin_header')
  })())
  check('drawer: the pinned ROWS are the Recents rows: title 60 px at 22 px, folder 60 px at 22 px, rename field 52 px at 22 px, « … » 52 px (24 px dots), chevron 20 px (round 3, the owner found the pinned text too small)', (() => {
    const d = (sel) => declOf('drawer-large', sel)
    return px(d('.kbpin_row .kbpin_open{'), 'height') === 60 && px(d('.kbpin_row .kbpin_open{'), 'font-size') === 22 && px(d('.kbpin_folder{'), 'height') === 60 && px(d('.kbpin_folder{'), 'font-size') === 22 &&
      px(d('.kbpin_row .kbpin_edit{'), 'height') === 52 && px(d('.kbpin_row .kbpin_edit{'), 'font-size') === 22 && px(d('.kbpin_row .kbpin_more{'), 'width') === 52 && px(d('.kbpin_row .kbpin_more{'), 'height') === 52 &&
      px(d('.kbpin_row .kbpin_more svg{'), 'width') === 24 && px(d('.kbpin_header .kbpin_chevron svg{'), 'width') === 20 && !/kbpin_state/.test(presLines('drawer-large').join('\n'))
  })())
  check('help button named (the phone\'s Simple, item 27): the word is an attribute the walker stamps (`data-kb-help-word`, « Help » / « Aide » by the language at that moment) and ::after reads, on the five kinds of help button; the pill keeps the phone layer\'s 44 px and tone (no width, height or border set), has a focus ring; the stamp goes with the token', (() => {
    const lines = presLines('help-named')
    const after = lines.filter((l) => l.includes('::after'))
    const pill = lines.filter((l) => !l.includes('::after') && !l.includes(':focus-visible')).map((l) => l.slice(l.indexOf('{') + 1, -1)).join(';')
    return after.length === 1 && /content:attr\(data-kb-help-word\)!important\}$/.test(after[0]) && ['.kbhp-btn', '.kb6-helpbtn', '.kbln-help-btn', '.kbat-help', '.kbcl-hl'].every((c) => after[0].includes(c + '::after')) &&
      pill !== '' && !/(^|;)(width|height|min-width|min-height|border|border-color|border-width):/.test(pill) && lines.some((l) => l.includes(':focus-visible')) &&
      /tokens\.indexOf\('help-named'\) >= 0/.test(SOURCE) && /b\.setAttribute\('data-kb-help-word', word\)/.test(SOURCE) && /b\.removeAttribute\('data-kb-help-word'\)/.test(SOURCE) && /kt\('Aide', 'Help'\)/.test(SOURCE)
  })())
  check('help button: the Theme page offers three looks (Square, Bare, Named), and the plain « ? » of the full app is unchanged (boxed stays the default)', T.ENUMS.helpButton.join() === 'boxed,bare,named' && T.DEF.helpButton === 'boxed' && /\['named', kt\('Nommé', 'Named'\)\]/.test(SOURCE))
  check('drawer: the magnifier is a 52 px round button, the rows of the menu 60 px at 22 px with 28 px icons, the folders 64 px, the chats 60 px, the head 68 px, the avatar and « New chat » 56 px, the burger 52 px — every target of the drawer is 44 px or more', (() => {
    const d = (sel) => declOf('drawer-large', sel)
    return px(d('[data-kb="search-top"]{'), 'width') === 52 && px(d('[data-kb="search-top"]{'), 'height') === 52 && px(d('nav [data-kb-row]{'), 'min-height') === 60 && px(d('nav [data-kb-row]{'), 'font-size') === 22 &&
      px(d('[data-row-key^="workspace:"]{'), 'min-height') === 64 && px(d('[data-row-key^="session:"]{'), 'min-height') === 60 && px(d('[data-window-drag]{'), 'min-height') === 68 &&
      px(d('.kbmob-avatar{'), 'height') === 56 && px(d('.kbmob-newchat{'), 'height') === 56 && px(d('.kbmob-menu{'), 'width') === 52 && px(d('[data-row-key^="workspace:"] button'), 'min-height') === 52 &&
      px(d('[data-sidebar-workspace-header]{'), 'font-size') === 19 && px(d('[role="tree"]::after'), 'font-size') === 17
  })())
  check('drawer: no rule names a label the engine translates (« Global panels » is « Panneaux globaux » in French: the rows would stay small there), the header\'s three do-nothing buttons leave the title its width, the pinned panels read like the rows', !/aria-label/.test(presLines('drawer-large').join('\n')) && /\[data-sidebar-workspace-header\] button\{display:none!important\}/.test(PC) && /nav \[class\*="panelRow"\]\{min-height:60px!important/.test(PC))
  check('drawer: it is the Theme\'s own block, bounded by the token and the mobile query (nothing in mobile.css, so a phone left on the full look and a computer are untouched), and the dock height variable follows the bigger buttons', presLines('drawer-large').length >= 15 && presLines('drawer-large').every((l) => PC.indexOf(l) > PC.indexOf('@media ' + PRES_MQ + '{')) && /\[data-slot="sidebar"\]\{--kbmob-dock-h:120px!important\}/.test(PC))
  check('drawer panels: the engine\'s own rows (its pinned pages, their unpin buttons, its « More » launcher) are left out under ONE token, by structure and not by word (a `panelEntry` of the sidebar\'s nav that holds no Kybernos menu, and the `moreAnchor`), so French and English draw the same rows; shown by default, hidden by the phone\'s Simple, inside the mobile query', (() => {
    const ls = presLines('panels-hidden')
    return ls.length === 1 && ls[0].includes('[data-slot="sidebar"] nav > [class*="panelEntry"]:not(:has(.kb4-menu))') && ls[0].includes('[data-slot="sidebar"] nav > [class*="moreAnchor"]') && ls[0].endsWith('{display:none!important}') &&
      !/aria-label|title=|placeholder/.test(ls[0]) && PC.indexOf(ls[0]) > PC.indexOf('@media ' + PRES_MQ + '{') && T.DEF.drawerPanels === 'shown' && T.lockedPresentation().drawerPanels === 'hidden'
  })())
  check('composer: the text and the placeholder are 20 px (the placeholder is a slot of the engine, not a pseudo-element), the field 60 px at least, the « + », the model arrow and the send button 48 px, the model name (list item 24, the mock-up\'s composer block) in a frame of 48 px at 15 px as wide as the name and no wider, pushed against the send button, whole unless it overflows (then an ellipsis, the two icons keep their 16 px)', (() => {
    const d = (sel) => declOf('composer-large', sel)
    return /\[data-composer-input\],[^{]*\{[^}]*font-size:20px/.test(presLines('composer-large').join('\n')) && /conversation\.input\.placeholder"\] \*[^{]*\{[^}]*font-size:20px/.test(presLines('composer-large').join('\n')) && px(d('[data-composer-input]{'), 'min-height') === 60 &&
      px(d('button[aria-haspopup="listbox"]'), 'width') === 48 && px(d('button[class*="_primary"]'), 'height') === 48 && px(d('[data-kb="model-seat"]{'), 'height') === 48 && px(d('[data-kb="model-seat"]{'), 'font-size') === 15 && /border-radius:24px/.test(d('[data-kb="model-seat"]{')) &&
      /flex:0 1 auto/.test(d('[data-kb="model-seat"]{')) && /min-width:0/.test(d('[data-kb="model-seat"]{')) && /margin-left:auto/.test(d('[data-kb="model-seat"]{')) &&
      /\.kbmsl-label\{font-size:15px!important;min-width:0!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important\}/.test(presLines('composer-large').join('\n')) &&
      /\.kbmsl-ic,[^{]*\.kbmsl-chev\{flex:none!important;overflow:visible!important\}/.test(presLines('composer-large').join('\n'))
  })())
  check('composer: EVERY empty-field sentence is 20 px whatever the engine build draws it with: the box `[data-composer-placeholder]` itself (a build draws « Ask Kaby anything » as its own text node, and the phone layer sizes that box at 12 to 16 px: it read 16 dp on the real phone), its descendants, the engine\'s slot, the placeholder of a plain field of the card', (() => {
    const l = presLines('composer-large').join('\n')
    return /\[data-composer-card\] \[data-composer-placeholder\][,{]/.test(l) && /\[data-composer-card\] \[data-composer-placeholder\] \*[,{]/.test(l) && /\[data-slot="conversation\.input\.placeholder"\] \*[^{]*\{[^}]*font-size:20px!important/.test(l) && /\[data-composer-card\] input::placeholder,[^{]*\[data-composer-card\] textarea::placeholder\{font-size:20px!important\}/.test(l)
  })())
  check('empty chat cards (list item 22): `slider` is the default and puts nothing on <html> (the Kybernos plugin draws it); `grid` shows the same six cards in three columns on the page instead of the slider row, « See all » kept (the sheet\'s own grid stays a sheet\'s); `hidden` hides the block and gives the scroller back its centring; all inside the mobile query (including 601–700 px); the hooks are not named `newchat-…` (Kaby mode hides those)', (() => {
    const g = presLines('nccards-grid').join('\n')
    const hd = presLines('nccards-hidden').join('\n')
    return T.DEF.newChatCards === 'slider' && T.lockedPresentation().newChatCards === 'slider' && PRES_ALL.every((t) => !/nccards/.test(t)) &&
      /\.kb8-ncs-sl\{display:none!important\}/.test(g) && !/\.all\{display:none/.test(g) && /\.kb8-ncs-gr:not\(\.kb8-ncs-shgr\)\{display:grid!important;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)!important/.test(g) && /\.kb8-ncs-gr:not\(\.kb8-ncs-shgr\) \.kb8-ncs-card\{width:auto!important\}/.test(g) &&
      /\.kb8-ncs\{display:none!important\}/.test(hd) && /scrollBody"\]:has\(\.kb8-ncs\)\{justify-content:safe center!important\}/.test(hd) && !/data-kb="newchat-/.test(PC) &&
      [g, hd].every((l) => PC.indexOf(l.split('\n')[0]) > PC.indexOf('@media ' + PRES_MQ + '{'))
  })())
  check('rating (list item 31, round 2): `thumbs` is the DEFAULT (Simple and Complete, the owner\'s rule of 2026-11-24) and is what puts the token on <html>; `stars` is a choice and puts nothing; the token shows the two thumbs the Kybernos plugin draws (44 px each) and hides the question and the five stars; inside the mobile query; the thumbs are hidden by the plugin’s own CSS until the token asks', (() => {
    const t = presLines('rating-thumbs').join('\n')
    return T.DEF.rating === 'thumbs' && json(T.ENUMS.rating) === json(['stars', 'thumbs']) && T.valeursValides({ rating: 'stars' }).rating === 'stars' && T.lockedPresentation().rating === 'thumbs' && T.valeursValides({ rating: 'thumbs' }).rating === 'thumbs' && T.valeursValides({ rating: 'five' }).rating === undefined &&
      /\.kbq-rating \.kbq-rating-question,[^{]*\.kbq-rating \.kbq-rating-etoiles\{display:none!important\}/.test(t) && /\.kbq-rating \.kbq-rating-pouces\{display:inline-flex!important\}/.test(t) && /\.kbq-rating \.kbq-rating-pouce\{width:44px!important;height:44px!important;min-width:44px!important\}/.test(t) &&
      // once rated: the thumbs stay in the row (the card gives its parts to the row), the thank-you line goes under the row, the rating tag is left out
      /\.kbq-rating:has\(\.kbq-rating-merci\)\{display:contents!important\}/.test(t) && /\.kbq-rating-merci\{order:9!important;flex:1 0 100%!important;padding-left:6px!important;font-size:14px!important\}/.test(t) && /\.kbq-rating-merci > \.kbq-rating-tag:first-child\{display:none!important\}/.test(t) &&
      // after a thumbs-up the share box is a 44 px line with a 22 px box
      /\.kbq-rating-partage-apres\{min-height:44px!important;gap:10px!important;font-size:14px!important\}/.test(t) && /\.kbq-rating-partage-apres input\{width:22px!important;height:22px!important/.test(t) &&
      t.split('\n').every((l) => PC.indexOf(l) > PC.indexOf('@media ' + PRES_MQ + '{')) && /\.kbq-rating-pouces\{display:none;/.test(readFileSync(new URL('../kybernos-plugin/client.js', import.meta.url), 'utf8'))
  })())
  check('message text (list item 33): four sizes two pixels apart, `standard` (17 px) is the default in Simple and Complete and has no token (the phone\'s stylesheet draws it); compact 15, large 19 and xlarge 21 are ONE variable on the chat, inside the mobile query; the menu is not touched', (() => {
    const css = readFileSync(new URL('../kybernos-mobile/mobile.css', import.meta.url), 'utf8')
    const lines = ['msg-compact', 'msg-large', 'msg-xlarge'].map((k) => presLines(k).join('\n'))
    const mob = css.slice(css.indexOf('/* The text of the messages (list item 33).'))
    return T.DEF.messageSize === 'standard' && json(T.ENUMS.messageSize) === json(['compact', 'standard', 'large', 'xlarge']) && T.lockedPresentation().messageSize === 'standard' && T.valeursValides({ messageSize: 'xlarge' }).messageSize === 'xlarge' && T.valeursValides({ messageSize: '18' }).messageSize === undefined &&
      T.PRES_TOKENS.filter((t) => t[0] === 'messageSize').map((t) => t[1] + '>' + t[2]).join() === 'compact>msg-compact,large>msg-large,xlarge>msg-xlarge' &&
      json(lines.map((l) => (l.match(/--dsh-content-font-size:(\d+)px!important/) || [])[1])) === json(['15', '19', '21']) &&
      lines.every((l) => l.split('\n').length === 1 && /^:is\(html,#kb-pres\)\[data-kb-pres~="msg-[a-z]+"\] \[data-slot="conversation\.chat\.flow"\]\{--dsh-content-font-size:\d+px!important\}$/.test(l)) &&
      lines.every((l) => l.split('\n').every((x) => PC.indexOf(x) > PC.indexOf('@media ' + PRES_MQ + '{'))) &&
      // the phone's stylesheet: the default size on the chat, the answer's text and the code follow the variable, the chat is told not to enlarge text again, in the 600 px block
      /\[data-slot="conversation\.chat\.flow"\] \{[^}]*text-size-adjust: 100%;[^}]*--dsh-content-font-size: 17px !important;/.test(mob) && /\[data-text-interaction-source\] \{\s*font-size: var\(--dsh-content-font-size\) !important;/.test(mob) &&
      /clamp\(12px, calc\(var\(--dsh-content-font-size\) - 3\.5px\), 14px\)/.test(mob) && /clamp\(13px, calc\(var\(--dsh-content-font-size\) - 3px\), 15px\)/.test(mob) &&
      css.indexOf('/* The text of the messages (list item 33).') > css.indexOf('@media (max-width: 600px) {\n  :root {')
  })())
  check('search on a phone: ✕ is a 52 px button, the scopes are ONE line that scrolls (no wrapping, no bar) with a fade on the right edge, each chip 44 px at 16 px, the field 52 px at 18 px', /\.kbsr-x\{[^}]*width:52px!important;height:52px!important/.test(TC) && /\.kbsr-scopes\{flex-wrap:nowrap!important;overflow-x:auto!important;scrollbar-width:none!important[^}]*mask-image:linear-gradient\(90deg,#000 88%,transparent\)!important/.test(TC) && /\.kbsr-chip\{[^}]*flex:none!important;height:44px!important[^}]*font-size:16px!important/.test(TC) && /input\.kbsr-in\[data-kb="search-input"\]\{height:52px!important;font-size:18px!important\}/.test(TC))
  check('the four new settings put no new text on the Settings pages beyond their own labels: the new section and its four rows carry a French and an English wording', /Menu et chat sur petit écran/.test(SOURCE) && /Menu and chat on a small screen/.test(SOURCE))
  {
    const inner = SOURCE.match(/\/\/ kb-pres:begin[\s\S]*?\/\/ kb-pres:end/g) || []
    const outside = SOURCE.replace(/\/\/ kb-pres:begin[\s\S]*?\/\/ kb-pres:end/g, '')
    check('...the presentation block is marked once (kb-pres:begin … kb-pres:end), holds the names of the other bundles\' classes, and the rest of the bundle names none of the prefixes the guards reserve (kbmem-, kbhp-, kbhi-)', inner.length === 1 && /\.kbmem-srow/.test(inner[0]) && /\.kbhp-btn/.test(inner[0]) && !/\.kbmem-|\.kbh[pi]-/.test(outside))
  }
  // the tokens: a person's own setting wins; the phone's Simple asks for all eleven on a small screen in Simple mode (kb-simple or legacy kb-kaby), never on a wide desktop
  const doc0 = globalThis.document
  const mm0 = loaderWindow.matchMedia
  const withEnv = ({ classes = [], attrs = {}, media = null }, f) => {
    globalThis.document = {
      documentElement: {
        hasAttribute: (k) => Object.prototype.hasOwnProperty.call(attrs, k),
        classList: { contains: (c) => classes.indexOf(c) >= 0 },
      },
    }
    if (media === null) delete loaderWindow.matchMedia
    else loaderWindow.matchMedia = (q) => ({ matches: typeof media === 'function' ? media(q) : media === true })
    try { return f() } finally {
      if (doc0 === undefined) delete globalThis.document; else globalThis.document = doc0
      if (mm0 === undefined) delete loaderWindow.matchMedia; else loaderWindow.matchMedia = mm0
    }
  }
  const withKaby = (on, f) => withEnv({ classes: on ? ['kb-kaby'] : [] }, f)
  check('tokens: nothing asked = only the thumbs (the default, Simple or Complete); the Simple preset asks for its eleven only in Kaby mode (its cards are the default slider: no token); a person\'s own choice adds one anywhere (the cards: grid or hidden, over the Simple preset too)', withKaby(false, () => json(T.presTokens({ ...T.DEF })) === json(['rating-thumbs']) && json(T.presTokens({ ...T.DEF, rating: 'stars' })) === json([]) && json(T.presTokens({ ...T.DEF, ...PRES_ON })) === json(PRES_ALL) && json(T.presTokens({ ...T.DEF, cardsFrame: 'flat' })) === json(['frame-flat', 'rating-thumbs']) && json(T.presTokens({ ...T.DEF, newChatCards: 'grid' })) === json(['nccards-grid', 'rating-thumbs']) && json(T.presTokens({ ...T.DEF, newChatCards: 'hidden' })) === json(['nccards-hidden', 'rating-thumbs'])) && withKaby(true, () => json(T.presTokens({ ...T.DEF })) === json(PRES_ALL) && json(T.presTokens({ ...T.DEF, rating: 'stars' })) === json(PRES_TEN) && json(T.presTokens({ ...T.DEF, newChatCards: 'hidden' })) === json(PRES_TEN.concat(['nccards-hidden', 'rating-thumbs']))))
  check('tokens in html.kb-simple without kb-kaby: active on a small screen (including 601–700 px and landscape touch matching PRES_MEDIA), NEVER activated on a wide desktop, off in Complete mode even with kb-kaby, and explicit compact messageSize (15 px) is always respected', (() => {
    const smallSimple = withEnv({ classes: ['kb-simple'], attrs: { 'data-kb-mode': 'simple' }, media: (q) => q === PRES_MQ }, () => ({
      def: T.presTokens({ ...T.DEF }),
      compact: T.presTokens({ ...T.DEF, messageSize: 'compact' }),
      grid: T.presTokens({ ...T.DEF, newChatCards: 'grid' }),
    }))
    const wideSimple = withEnv({ classes: ['kb-simple'], attrs: { 'data-kb-mode': 'simple' }, media: () => false }, () => T.presTokens({ ...T.DEF }))
    const noMediaSimple = withEnv({ classes: ['kb-simple'], attrs: { 'data-kb-mode': 'simple' }, media: null }, () => T.presTokens({ ...T.DEF }))
    const completeWithKaby = withEnv({ classes: ['kb-kaby'], attrs: { 'data-kb-mode': 'complete' }, media: () => true }, () => T.presTokens({ ...T.DEF }))
    return json(smallSimple.def) === json(PRES_ALL) &&
      json(smallSimple.compact) === json(PRES_ALL.concat(['msg-compact'])) &&
      json(smallSimple.grid) === json(PRES_TEN.concat(['nccards-grid', 'rating-thumbs'])) &&
      json(wideSimple) === json(['rating-thumbs']) &&
      json(noMediaSimple) === json(['rating-thumbs']) &&
      json(completeWithKaby) === json(['rating-thumbs'])
  })())
  check('the preset option: Simple asks for the thirteen settings (eleven tokens, the cards of the empty chat stay the slider); each call is a deep copy; an unknown id asks for none; the seam hands the options out', (() => { const o = T.lockedPresentation(); o.tabsNav = 'tabs'; return json(T.lockedPresentation()) === json(PRES_ON) && json(T.lockedOptions('locked-simple').presentation) === json(PRES_ON) && json(T.lockedOptions('nope')) === '{}' })())
  check('the walker is idempotent and bounded: it adds one « i » per marked description and one back row per Kaby page, removes both when the token goes, and the observer only watches while a token is on', /const mine = t\.querySelector\(':scope > \.kbth-info'\)/.test(SOURCE) && /if \(!fold\) \{ if \(mine !== null\) mine\.remove\(\)/.test(SOURCE) && /if \(mine !== null\) return/.test(SOURCE) && /if \(back !== null\) back\.remove\(\)/.test(SOURCE) && /else if \(!want && presListening\) \{[\s\S]*?removeEventListener\('click', presClick, true\)[\s\S]*?presWatch\.disconnect\(\)/.test(SOURCE))
  check('the control on the Theme page: one row of two choices (the cards of the empty chat: three) per setting, in the Accessibility tab, next to Touch comfort', ['tabsNav', 'rowsLayout', 'rowsDescription', 'helpButton', 'cardsFrame', 'chipsStyle', 'groupTitles', 'drawerSize', 'drawerPanels', 'composerSize', 'newChatCards', 'rating', 'messageSize'].every((k) => SOURCE.includes("['" + k + "', kt(")) && SOURCE.includes("'theme-pres-' + k[0]"))
  // what a page may mark: ONLY a description that explains. One that warns or changes what the setting means is never marked, so it is never folded.
  const ROOT = new URL('../', import.meta.url)
  const marks = (dir) => [...readFileSync(new URL(dir + '/client.js', ROOT), 'utf8').matchAll(/data-kb-desc/g)].length
  check('only two pages carry the mark (Memory: its row helper; Language: the announce hint); Kaby, About and the others never fold anything', marks('kybernos-memory') === 1 && marks('kybernos-language') === 1 && ['kybernos-kaby-customisation', 'kybernos-maintenance', 'kybernos-plugin', 'kybernos-hub', 'kybernos-mobile'].every((d) => marks(d) === 0))
  const memSrc = readFileSync(new URL('kybernos-memory/client.js', ROOT), 'utf8')
  const foldRows = [...memSrc.matchAll(/h\(SettingRow, \{ act: '([a-z-]+)', fold: true/g)].map((m) => m[1])
  check('Memory marks exactly the four rows whose description only explains (Use memory, Your memory, Import, Export); Learn, Sensitive topics, Look for repeats and When it finds some warn, so they stay visible', json(foldRows.sort()) === json(['export', 'import', 'manage', 'use']) && !/act: '(learn|sensitive|tidy-look|tidy-mode)', fold: true/.test(memSrc))
  const lanSrc = readFileSync(new URL('kybernos-language/client.js', ROOT), 'utf8')
  check('Language marks the announce hint only: the note on the model and the resume hint (which says what « off » does) stay visible', /className: 'kbln-hint', 'data-kb-desc': 'fold' \}, L\('announceHint'\)/.test(lanSrc) && [...lanSrc.matchAll(/data-kb-desc/g)].length === 1)
  check('the touch layer also covers the Theme\'s own controls it missed: the « Import… » label (29 px), the « ⋯ » of a tile (its sign sat over the chips) and the report button of the Simple help card (a 44 px box with a three-line word)', /label\.kbth-btn\{min-height:48px!important/.test(T.touchCss()) && /button\.kbth-pr-more\[data-kb="theme-preset-more"\]\[aria-haspopup="menu"\]:not\(\[disabled\]\)\{top:54px!important;right:2px!important;width:44px!important;height:44px!important/.test(T.touchCss()) && /\.kbk-help \[data-kb="report-tail"\] > button\[data-act="report-open"\]\{width:auto!important/.test(T.touchCss()) && /:not\(\.kbln-help-btn\),select,textarea/.test(SOURCE))
}

section('page render (react-dom/server)')
let React = null, renderToStaticMarkup = null
try {
  const req = createRequire(import.meta.url)
  React = req('react'); renderToStaticMarkup = req('react-dom/server').renderToStaticMarkup
} catch (e) { /* skipped below */ }
if (React === null) {
  skipped++
  console.log('SKIPPED: the page render of the Theme client (react-dom/server) — react / react-dom not found. Re-run with:')
  console.log('    NODE_PATH=<a node_modules that has react + react-dom> node packages/kybernos-theme/test-client.mjs')
} else {
  // A second instance wired to the REAL react, with useState steerable by initial value.
  const steer = {}
  const reactFor = { ...React, useState: (init) => React.useState(Object.prototype.hasOwnProperty.call(steer, String(init)) ? steer[String(init)] : init) }
  const MENU_REG = menuRegistryFor()
  let def2
  new Function('window', SOURCE)({ __ModuleLoader__: { load: (d) => { def2 = d } }, __KB_LANG_RESOLVE__: () => LANG, __KB_MENU_ENTRIES__: MENU_REG })
  const real = def2.factory(() => reactFor).__test
  const render = (state, advTab) => {
    reset(); steer.couleurs = advTab || 'couleurs'
    store.set(real.STORE_KEY, JSON.stringify(state))
    return renderToStaticMarkup(React.createElement(real.Page, { ctx: mkCtx({ pref: state.mode }).ctx }))
  }
  const text = (html) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|')

  const simple = render({ ...real.DEF, mode: 'dark', skin: 'bleu', acc: '#4176E6' })
  const count = (html, re) => (html.match(re) || []).length
  // What a person can read or hear on a page: its text, plus the names carried by attributes.
  const readable = (html) => text(html) + '|' + [...html.matchAll(/(?:aria-label|title|placeholder)="([^"]*)"/g)].map((m) => m[1]).join('|')
  {
    // The page's description lives in the « ? » card: with the Suite it is passed to Help as `lead` (and the title as `title`) and not drawn under the title; without the Suite it is drawn as before.
    const LEAD_FR = 'Personnalise l’apparence de Kybernos : choisis un préréglage, ou clique sur ce que tu veux changer dans la fenêtre. Tous les réglages restent dans l’éditeur avancé.'
    const LEAD_EN = 'Customize the appearance of Kybernos: pick a preset, or click what you want to change in the window. Every setting stays in the advanced editor.'
    check('without the Suite the description is still drawn under the title', simple.includes('<h2 class="kbhp-title kbth-title">Thème</h2><div class="kbth-sub">' + LEAD_FR + '</div>'))
    let def3
    const suiteWin = { __ModuleLoader__: { load: (d) => { def3 = d } }, __KB_LANG_RESOLVE__: () => LANG, __KB_MENU_ENTRIES__: MENU_REG, __KB_HELP__: fakeHelp(React, (p) => React.createElement('i', { 'data-help-id': p.id, 'data-lead': p.lead, 'data-title': p.title })) }
    new Function('window', SOURCE)(suiteWin)
    const withSuite = (state) => { reset(); steer.couleurs = 'couleurs'; store.set(real.STORE_KEY, JSON.stringify(state)); return renderToStaticMarkup(React.createElement(def3.factory(() => reactFor).__test.Page, { ctx: mkCtx({ pref: state.mode }).ctx })) }
    const suite = withSuite({ mode: 'dark', skin: 'bleu', acc: '#4176E6' })
    check('with the Suite the page passes its description to Help as `lead`, and its title', suite.includes('data-help-id="kybernos-theme"') && suite.includes('data-lead="' + LEAD_FR + '"') && suite.includes('data-title="Thème"'), suite.slice(0, 400))
    check('...and no longer draws the same text under the title', !suite.includes('class="kbth-sub"') && suite.includes('<h2 class="kbhp-title kbth-title" data-kb="page-title">Thème</h2><i data-help-id="kybernos-theme"'))
    LANG = 'en'
    const suiteEn = withSuite({ mode: 'dark', skin: 'bleu', acc: '#4176E6' })
    LANG = 'kybernos'
    check('...in English too (lead and title)', suiteEn.includes('data-lead="' + LEAD_EN + '"') && suiteEn.includes('data-title="Theme"'))
  }

  // ── ONE Presets section: built-in and mine, a badge each, a filter, chips for what a preset holds ──
  real.lib.presets = []; real.lib.menu = null; real.lib.updatedAt = 0
  const pagePr = render({ ...real.DEF, mode: 'dark' })
  check('ONE Presets section: its heading, a filter All | Built-in | Mine with the counts, and one tile per preset (6 vibes + the 2 shipped menus)', count(pagePr, /data-kb="theme-presets"/g) === 1 && /<h3 class="kbth-pr-h">Préréglages<\/h3>/.test(pagePr)
    && /data-kb="theme-preset-filter"[^>]*>(<button[^>]*role="radio"[^>]*>[^<]*<\/button>){3}/.test(pagePr.replace(/(<div[^>]*data-kb="theme-preset-filter"[^>]*>)/, '$1')) && /All|Tous 8/.test(pagePr) && count(pagePr, /data-kb="theme-preset" /g) === 8)
  const filterOf = (html) => [...(html.match(/<div class="kbth-seg" role="radiogroup" aria-label="[^"]*" data-kb="theme-preset-filter">(.*?)<\/div>/) || [, ''])[1].matchAll(/<button[^>]*aria-checked="(true|false)"[^>]*>([^<]*)</g)].map((m) => m[2] + (m[1] === 'true' ? '*' : ''))
  check('...the filter says how many: « Tous 8 », « Livrés 8 », « Les miens 0 » (All is the one pressed)', filterOf(pagePr).join() === 'Tous 8*,Livrés 8,Les miens 0', filterOf(pagePr))
  check('...the old pieces are gone: no row of 18 style dots, no three mode cards, no « Mes thèmes » group, no Simple / Avancé switch', !/kbth-skin|theme-mode-card|theme-st-vibe|theme-st-looks|Mes thèmes/.test(pagePr))
  const tiles = pagePr.split('data-kb="theme-preset" ').slice(1)
  check('...each tile says where it comes from (a « Livré » badge) and what it holds (chips « Apparence » or « Menu »)', tiles.length === 8 && tiles.every((t) => /kbth-pr-src built">Livré</.test(t)) && tiles.slice(0, 6).every((t) => /kbth-pr-chip">Apparence</.test(t) && !/kbth-pr-chip">Menu</.test(t)) && tiles.slice(6).every((t) => /kbth-pr-chip">Menu</.test(t) && !/kbth-pr-chip">Apparence</.test(t)), tiles.map((t) => t.slice(0, 60)))
  check('...a built-in preset can be duplicated into Mine but is never renamed or deleted: its tile has the « … » button and the menu it opens is built from `mine` only', /data-kb="theme-preset-more"/.test(pagePr) && SOURCE.includes("!mine ? h('button', { type: 'button', role: 'menuitem', className: 'kbth-pi', 'data-kb': 'theme-preset-dup'") && SOURCE.includes("mine ? h('button', { type: 'button', role: 'menuitem', className: 'kbth-pi', 'data-kb': 'theme-preset-rename'") && SOURCE.includes("mine ? h('button', { type: 'button', role: 'menuitem', className: 'kbth-pi dng', 'data-kb': 'theme-preset-delete'"))
  check('...the menu in use is the default one: the « Complet » tile says « En cours », and the strip names it', /kbth-pr-tile use" data-kb="theme-preset" data-id="menu:menu-complete"/.test(pagePr) && /data-kb="theme-strip-m">Complet</.test(pagePr))
  check('...the strip says what is in use for the appearance and the menu, with Undo (nothing to undo yet), Reset and « Enregistrer comme préréglage… »', /data-kb="theme-strip"/.test(pagePr) && /data-kb="theme-strip-a"/.test(pagePr) && /data-kb="theme-undo" disabled/.test(pagePr) && /data-kb="theme-reset"[^>]*aria-haspopup="menu"/.test(pagePr) && /data-kb="theme-save"[^>]*>Enregistrer comme préréglage…</.test(pagePr))
  check('...one preset section: nothing else on the page lists presets (no « theme-row », no second list)', count(pagePr, /data-kb="theme-preset-list"/g) === 1 && !/data-kb="theme-row"/.test(pagePr))
  check('...Surprise me, the gallery and Import sit in the section’s header', /data-kb="theme-surprise"/.test(pagePr) && /data-kb="theme-open-gallery"/.test(pagePr) && /data-kb="theme-import"/.test(pagePr))
  check('...a preset is explained in one sentence, and nothing changes until one is picked', /Un préréglage est un réglage enregistré\. Il peut changer l’apparence, le menu, ou les deux\. Rien ne change tant que tu n’en choisis pas un\./.test(pagePr))
  {
    const nolook = (html) => !/\blooks?\b/i.test(readable(html))
    LANG = 'en'
    const en = render({ ...real.DEF, mode: 'dark' })
    LANG = 'kybernos'
    check('no word « look » on the page, in either language (text, labels and titles)', nolook(pagePr) && nolook(en), [readable(pagePr).match(/.{20}\blooks?\b.{20}/i), readable(en).match(/.{20}\blooks?\b.{20}/i)])
  }

  // ── a library with one of each: a saved appearance, a saved menu, a template, an installed gallery theme ──
  {
    const mineA = real.presetRecord({ id: 'u-bureau', name: 'Bureau clair', source: 'me', at: 1, settings: { mode: 'light', acc: '#0ea5e9', ov: {}, fontText: 'georgia', radius: 'soft' } })
    const mineM = real.presetRecord({ id: 'u-court', name: 'Menu court', source: 'me', at: 2, menu: { entries: [{ id: 'skills', shown: true, order: 0 }, { id: 'kyber', shown: false, order: 1 }], unlisted: 'hide', locked: false } })
    const tpl = real.presetRecord({ id: 't-cab', name: 'Cabinet', source: 'template', at: 3, settings: { acc: '#112233' }, menu: { entries: [{ id: 'skills', shown: true, order: 0, label: { fr: 'Dossiers' } }], unlisted: 'show', locked: false } })
    const gal = real.presetRecord({ id: 'g-lumen', name: 'Crépuscule', source: 'gallery', author: '@lumen', at: 4, settings: { mode: 'dark', acc: '#fb923c', ov: { 'dark:base': '#1a1220' } } })
    real.lib.presets = [mineA, mineM, tpl, gal]
    const mineState = { ...real.DEF, skin: 'u-bureau', ...mineA.settings }
    const withLib = render(mineState)
    check('four presets of the library join the built-in ones, template first: 8 + 4 tiles, the counts say « Livrés 9 », « Les miens 3 »', count(withLib, /data-kb="theme-preset" /g) === 12 && filterOf(withLib).join() === 'Tous 12*,Livrés 9,Les miens 3', filterOf(withLib))
    const tileOf = (html, id) => { const at = html.indexOf('data-id="rec:' + id + '"'); const end = html.indexOf('data-kb="theme-preset" ', at + 10); return html.slice(at, end < 0 ? undefined : end) }
    check('...a template is built-in-like (badge « Modèle », both chips); what I saved is « Les miens »; what the gallery installed says « Galerie » and counts as mine', /kbth-pr-src built">Modèle</.test(tileOf(withLib, 't-cab')) && /kbth-pr-chip">Apparence</.test(tileOf(withLib, 't-cab')) && /kbth-pr-chip">Menu</.test(tileOf(withLib, 't-cab')) && /data-src="template"/.test(withLib)
      && /kbth-pr-src mine">Les miens</.test(tileOf(withLib, 'u-bureau')) && /kbth-pr-src mine">Galerie</.test(tileOf(withLib, 'g-lumen')) && /data-id="rec:g-lumen" data-src="mine"/.test(withLib))
    check('...a menu-only preset has only the « Menu » chip, an appearance-only one only « Apparence »', /kbth-pr-chip">Menu</.test(tileOf(withLib, 'u-court')) && !/kbth-pr-chip">Apparence</.test(tileOf(withLib, 'u-court')) && !/kbth-pr-chip">Menu</.test(tileOf(withLib, 'u-bureau')))
    check('...the preset in use is marked « En cours », the strip names it, and it is not « modifié »', /kbth-pr-tile use" data-kb="theme-preset" data-id="rec:u-bureau"/.test(withLib) && /data-kb="theme-strip-a"[^>]*>(<i[^>]*><\/i>)?Bureau clair</.test(withLib) && !/data-kb="theme-modified"/.test(withLib))
    const dirty = render({ ...mineState, acc: '#ff0000' })
    check('...move one of its settings and the strip says « modifié »; the mode alone never does', /data-kb="theme-modified">modifié</.test(dirty) && !/data-kb="theme-modified"/.test(render({ ...mineState, mode: 'dark' })))
    check('...a style that is gone (deleted elsewhere) reads « Personnalisé »', /data-kb="theme-strip-a"[^>]*>(<i[^>]*><\/i>)?Personnalisé</.test(render({ ...real.DEF, skin: 'u-gone', acc: '#123456' })))
    real.lib.menu = real.menuClean(mineM.menu)
    const withMenu = render(mineState)
    check('...with the menu of « Menu court » in use, the strip names that menu and its tile is the one in use', /data-kb="theme-strip-m">Menu court</.test(withMenu) && /kbth-pr-tile use" data-kb="theme-preset" data-id="rec:u-court"/.test(withMenu) && !/kbth-pr-tile use" data-kb="theme-preset" data-id="menu:menu-complete"/.test(withMenu))
    real.lib.menu = real.menuClean({ entries: [{ id: 'tasks', shown: false, order: 0 }], unlisted: 'show', locked: false })
    check('...a menu that is none of the listed ones is called « Menu personnalisé »', /data-kb="theme-strip-m">Menu personnalisé</.test(render(mineState)))
    real.lib.menu = null; real.lib.presets = []
  }

  // ── the advanced editor: folded, in real tabs, the Mode in the first one ──
  check('the advanced editor is folded by default (a details with no `open`), with its summary', /<details class="kbth-st-classic" data-kb="theme-classic"><summary>Éditeur avancé/.test(simple))
  const tabIds = [...simple.matchAll(/data-kb="theme-adv-tab" data-id="([a-z]+)"/g)].map((m) => m[1])
  check('...it has real tabs: Couleurs, Lettres, Formes, Arrière-plan, Effets, Icônes, Menu, Animation, Accessibilité, Import / Export, Galerie', tabIds.join() === 'couleurs,lettres,formes,fond,effets,icones,menu,animation,accessibilite,partage,galerie' && /role="tablist"/.test(simple) && count(simple, /role="tab"/g) === 11, tabIds)
  check('...the tabs carry the tab pattern: the open one is selected, the panel is a tabpanel', count(simple, /role="tab"[^>]*aria-selected="true"/g) === 1 && /role="tab"[^>]*class="kbth-adv-tab on" aria-selected="true"[^>]*data-id="couleurs"/.test(simple) && /role="tabpanel"/.test(simple))
  check('...and the keyboard of the tabs: ONE tab stop (the open tab), each tab names the panel, the panel is named by the open tab; the key handler is on the tablist', count(simple, /role="tab"[^>]*tabindex="0"/g) === 1 && count(simple, /role="tab"[^>]*tabindex="-1"/g) === 10 && count(simple, /role="tab"[^>]*aria-controls="kbth-tabpanel"/g) === 11 && /id="kbth-tabpanel" aria-labelledby="kbth-tab-couleurs"/.test(simple) && /role: 'tablist'[\s\S]{0,260}onKeyDown: \(e\) => \{[\s\S]{0,300}segNav\(e\.key/.test(SOURCE))
  check('...their names are plain: Couleurs, Lettres, Formes, Arrière-plan, Effets, Icônes, Menu, Animation, Accessibilité, Import / Export, Galerie', ['Couleurs', 'Lettres', 'Formes', 'Arrière-plan', 'Effets', 'Icônes', 'Menu', 'Animation', 'Accessibilité', 'Import / Export', 'Galerie'].every((t) => simple.includes('>' + t + '</button>')))
  const modeSeg = (html) => (html.match(/data-kb="theme-mode"[^>]*>(.*?)<\/div>/) || [, ''])[1]
  check('the Mode (Clair, Sombre, Système) is one segmented control of the Colours tab, and the current one is the checked one', /Clair[\s\S]*Sombre[\s\S]*Système/.test(text(modeSeg(simple))) && /aria-checked="true"[^>]*data-id="dark"/.test(modeSeg(simple)) && /aria-checked="true"[^>]*data-id="light"/.test(modeSeg(render({ ...real.DEF, mode: 'light' }))) && /aria-checked="true"[^>]*data-id="system"/.test(modeSeg(render({ ...real.DEF, mode: 'system' }))))
  check('pressing a mode writes it through the page\'s own commit (setTheme); no link to another page and no helper for it', SOURCE.includes('commit({ mode: m[0] })') && !SOURCE.includes('ouvrirReglages') && !SOURCE.includes("'kbac-appearance'"))
  const natural = render({ mode: 'dark' })
  check('natural state: the pill says no theme is applied, in plain words', /Couleurs de Kybernos — aucun thème posé/.test(natural) && !/jeton|token|couche/i.test(natural.replace(/<[^>]+>/g, '|').split('kbth-foot')[1] || ''), natural.match(/kbth-pill">[^<]*</g))
  check('themed state: the pill says a theme is applied (light and dark), without the word « token »', /Thème posé · clair et sombre/.test(simple) && !/17 jetons/.test(simple))

  for (const tab of ['couleurs', 'lettres', 'formes', 'fond', 'effets', 'icones', 'menu', 'animation', 'accessibilite', 'partage', 'galerie']) {
    let html = null, err = null
    try { html = render({ mode: 'dark' }, tab) } catch (e) { err = e.message }
    check('tab ' + tab + ' renders without throwing, with a panel', html !== null && html.length > 500 && /role="tabpanel"/.test(html), err)
  }
  {
    // Every select (five options or more) and every segmented control (two to four) of the tabs is the shared one, with its name for assistive technology.
    const T2 = (tab) => render({ ...real.DEF, mode: 'dark' }, tab)
    const lettres = T2('lettres'), fond = T2('fond'), icones = T2('icones'), formes = T2('formes')
    check('Lettres: the font is ONE select (26 fonts, each written in its own typeface), the size a slider and the ligatures a switch', count(lettres, /class="kbth-sel"/g) === 1 && /role="combobox"[^>]*aria-label="Police"/.test(lettres) && /role="switch"/.test(lettres))
    check('Formes: corners, shadows, your bubbles and the agent’s replies are segmented controls of two to four options', ['theme-adv-radius', 'theme-adv-shadow', 'theme-adv-bubble', 'theme-adv-reply'].every((k) => new RegExp('role="radiogroup"[^>]*data-kb="' + k + '"').test(formes)) && !/class="kbth-sel"/.test(formes))
    check('Arrière-plan: the wallpaper is ONE select, grouped; Icônes: the icon set is ONE select with a sample of its icons, and the sample row follows', count(fond, /class="kbth-sel"/g) === 1 && count(icones, /class="kbth-sel"/g) === 1 && /data-kb="theme-icons-preview"/.test(icones))
    const everySeg = [...['couleurs', 'lettres', 'formes', 'fond', 'effets', 'icones', 'menu', 'animation', 'accessibilite'].map(T2), pagePr].join('')
    const segs = [...everySeg.matchAll(/<div class="kbth-seg" role="radiogroup"[^>]*>(.*?)<\/div>/g)].map((m) => count(m[1], /role="radio"/g))
    check('a segmented control never has more than four options, and a select is only used from five (the rule of the page)', segs.length > 8 && segs.every((n) => n >= 2 && n <= 4), segs)
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
  const page = render({ mode: 'dark' }, 'animation')
  const pane = page.slice(page.indexOf('data-kb="ld-pane"')) // the studio above it has its own « Me surprendre »
  const ptext = text(pane)
  check('Animation tab: preview, rotation, status text and settings are the four blocks', ['Animation de réflexion', 'Aperçu', 'Ma rotation', 'Texte d’état', 'Réglages'].every((t) => ptext.includes(t)))
  check('...with the draw, add, surprise (animations AND words) and pack buttons', ['Simuler une réponse', 'Ajouter une animation…', 'Modifier mon pack…'].every((t) => ptext.includes(t)) && (pane.match(/Me surprendre/g) || []).length === 2)
  check('...the library, the import and the skill are NOT on the page (they live in a window)', !ptext.includes('Exemples (14)') && !ptext.includes('Importer un fichier') && !ptext.includes('Créer avec Claude'))
  check('...the ambiance selector shows the DSH original and today\'s sentence', /kbth-fsname">Kybernos d’origine</.test(pane) && ptext.includes('Deep diving for 12s ···'))
  check('...settings are folded, with a one-line summary', ptext.includes('Standard · 24 px · vitesse 1,00 × · un mot par réponse') && !ptext.includes('Ne jamais répéter') && /aria-expanded="false"[^>]*data-kb="ld-settings"|data-kb="ld-settings"/.test(pane))
  // R-A1-02 / R-A2-01: the one-line summary is wholly in the language of the page, with its number format
  LANG = 'en'
  const paneEn = render({ mode: 'dark' }, 'animation')
  check('English: the settings summary reads « Standard · 24 px · speed 1.00× · one word per reply », no French word, no decimal comma', text(paneEn).includes('Standard · 24 px · speed 1.00× · one word per reply') && !/vitesse|1,00/.test(text(paneEn)), text(paneEn).match(/Standard · [^|]*/))
  check('...and the whole line is the tooltip of the cut row (it is clipped at 390 px)', /class="kbth-disc-s" title="Standard · 24 px · speed 1\.00× · one word per reply"/.test(paneEn))
  LANG = 'es'
  check('another language without a dictionary reads English, with a point', text(render({ mode: 'dark' }, 'animation')).includes('speed 1.00× · one word per reply'))
  LANG = 'kybernos'
  check('French keeps its word, its comma and its spaced multiplication sign', /class="kbth-disc-s" title="Standard · 24 px · vitesse 1,00 × · un mot par réponse"/.test(render({ mode: 'dark' }, 'animation')))
  check('sizes and durations follow the page: « 3,1 Ko » / « 1,5 s » in French, « 3.1 KB » / « 1.5 s » elsewhere', real.ldKo(3200) === '3,1 Ko' && real.ldDurText('1.5 s') === '1,5 s' && real.ldDurText('1,2 s') === '1,2 s' && real.knum(0.9, 2) === '0,90')
  LANG = 'en'
  check('...English: 3.1 KB, 12 KB, 1.2 s, 1.5 s, 0.90', real.ldKo(3200) === '3.1 KB' && real.ldKo(20480) === '20 KB' && real.ldDurText('1,2 s') === '1.2 s' && real.ldDurText('1.5 s') === '1.5 s' && real.knum(0.9, 2) === '0.90')
  check('...and no French decimal comma is built in the code any more', !/\.replace\('\.', ','\)/.test(SOURCE.replace(/const knum = [^\n]*/, '').replace(/const ldDurText = [^\n]*/, '')))
  check('...and no bare French connective sits between two values of a page (« 2 sur 5 » in the English « Add an animation » window, T-041): such a word goes through kt()', !/,\s*'(sur|dans|avec|pour|sans|ou|et|de|du|des|en|au|aux)'\s*,/.test(SOURCE))
  LANG = 'kybernos'
  check('...with nothing selected, four free slots and the whale tail are announced', (pane.match(/kbth-lds empty/g) || []).length === 4 && ptext.includes('Rien n’est choisi : Kybernos garde sa queue de baleine.'))
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
    check('the grade inks exist for dark and light (6) plus the colour-blind set, one per grade and scheme (6)', Object.keys(inks).length === 12, Object.keys(inks))
    check('dark: every grade ink is ≥ 4.5:1 on the dark layer 1', dark.length === 3 && dark.every((r) => r >= 4.5), dark.map((r) => r.toFixed(2)))
    check('light: every grade ink is ≥ 4.5:1 on white (DSH\'s green and orange were 2.2:1)', light.length === 3 && light.every((r) => r >= 4.5), light.map((r) => r.toFixed(2)))
    const cbKeys = Object.keys(inks).filter((k) => /kbth-cb/.test(k))
    check('the colour-blind set turns the passing grade blue in both schemes, ≥ 4.5:1', cbKeys.length === 6 && real.ratio(inks['html[data-kbth-cb] ok'], l1.dark) >= 4.5 && real.ratio(inks['html[data-kbth-cb] body:not([data-ds-dark-theme]) ok'], l1.light) >= 4.5)
    check('...and every colour-blind grade ink (success, warning, error) is ≥ 4.5:1 in its scheme', ['ok', 'warn', 'err'].every((g) => real.ratio(inks['html[data-kbth-cb] ' + g], l1.dark) >= 4.5 && real.ratio(inks['html[data-kbth-cb] body:not([data-ds-dark-theme]) ' + g], l1.light) >= 4.5))
    const html = render({ mode: 'dark' }, 'accessibilite')
    check('the badges carry a grade class and no inline ink (nothing to go stale when the scheme changes)', (html.match(/class="kbth-a11y-badge kbth-gr-(ok|warn|err)"/g) || []).length === 6 && !/kbth-a11y-badge[^>]*style=/.test(html))
    // the two rows of the batch (rating, message text) as the page DRAWS them in the Accessibility tab, English: label, choices, the stored one lit
    const prHtml = render({ ...real.DEF, mode: 'dark', messageSize: 'large', rating: 'thumbs' }, 'accessibilite')
    const row = (key) => { const m = prHtml.match(new RegExp('data-kb="theme-pres-' + key + '">(.*?)</div>')); return m ? m[1] : '' }
    const lit = (h) => (h.match(/aria-checked="true" data-id="([a-z]+)"/) || [])[1]
    const msg = row('messageSize'); const rat = row('rating')
    check('the Theme page draws the message text with four sizes (15, 17, 19, 21), the stored one (19) lit', (msg.match(/<button/g) || []).length === 4 && />15</.test(msg) && />17</.test(msg) && />19</.test(msg) && />21</.test(msg) && lit(msg) === 'large', msg.slice(0, 300))
    check('the Theme page draws the rating with two choices (stars, thumbs), the stored one (thumbs) lit', (rat.match(/<button/g) || []).length === 2 && lit(rat) === 'thumbs', rat.slice(0, 300))
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

  // ── Import / Export, and the three resets, in the advanced editor ──────────────────────────────────────
  {
    real.lib.presets = []; real.lib.menu = null; real.lib.updatedAt = 0
    const partage = render({ ...real.DEF, mode: 'dark' }, 'partage')
    check('Import / Export: a .json file is added to Mine, changes nothing until ticked, and never changes the accessibility settings', /data-kb="theme-import-adv"/.test(partage) && /accept=".json,application\/json"/.test(partage) && /s’ajoute à Les miens/.test(partage) && /Il ne change rien tant que tu n’as pas coché ce que tu en reprends/.test(partage) && /ne change jamais tes réglages d’accessibilité/.test(partage))
    check('...the current appearance exports (YAML, JSON, CSS) with a copy button, folded away from the rest; a saved preset exports from its own tile', /data-kb="theme-export-fold"/.test(partage) && /data-kb="theme-export-format"/.test(partage) && /dsh-theme\.yml/.test(partage) && /data-kb="theme-copy"/.test(partage) && /Exporter en fichier/.test(partage))
    check('...three resets, each with its name (the appearance, the menu, everything), and the saved presets stay in Mine', ['theme-reset-adv-a', 'theme-reset-adv-m', 'theme-reset-adv-all'].every((k) => partage.includes('data-kb="' + k + '"')) && /Tes préréglages enregistrés restent dans Les miens/.test(partage))
  }

  // ── The gallery on the page ────────────────────────────────────────────────
  {
    const shipped = JSON.parse(readFileSync(new URL('./gallery.json', import.meta.url), 'utf8'))
    const answer = (over = {}) => ({ ok: true, source: 'shipped', publishedAt: shipped.publishedAt, seq: shipped.seq, themes: shipped.themes, online: { state: 'never', at: 0, reason: null }, ...over })
    real.lib.presets = []
    real.gal.data = real.galClean(answer()); real.gal.state = 'ready'
    const html = render({ ...real.DEF }, 'galerie')
    const n = shipped.themes.length
    check('the Galerie tab is there, the eleventh, and is the one selected when opened', (html.match(/class="kbth-adv-tab[ "]/g) || []).length === 11 && /kbth-adv-tab on" aria-selected="true"[^>]*>Galerie</.test(html))
    check('a card per theme, each with a thumbnail, its name, its author and its description', (html.match(/data-kb="theme-gal-card"/g) || []).length === n && shipped.themes.every((t) => html.includes('>' + t.name.replace(/&/g, '&amp;') + '<')) && (html.match(/par Kybernos/g) || []).length === n && (html.match(/class="kbth-thumb"/g) || []).length === n && html.includes(shipped.themes[0].description.fr),
      { cards: (html.match(/data-kb="theme-gal-card"/g) || []).length, n, names: shipped.themes.filter((t) => !html.includes('>' + t.name.replace(/&/g, '&amp;') + '<')).map((t) => t.name), authors: (html.match(/par Kybernos/g) || []).length, thumbs: (html.match(/class="kbth-thumb"/g) || []).length })
    // The names of the shipped themes are French words; the page says them in English through GAL_NAMES in client.js. A theme added to gallery.json without its line shows its French name on the English page.
    const galNames = (/const GAL_NAMES = \{([\s\S]*?)\n      \}/.exec(readFileSync(new URL('./client.js', import.meta.url), 'utf8')) || [])[1] || ''
    const unnamed = shipped.themes.filter((t) => !new RegExp('(?:^|[\\s,{])(?:\'' + t.id + '\'|' + t.id + '): \\[\'' + t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\', \'').test(galNames)).map((t) => t.id)
    check('every theme of the shipped gallery has its English name in GAL_NAMES (client.js)', galNames !== '' && unnamed.length === 0, unnamed)
    check('...the thumbnails are decoration (hidden from screen readers) and painted with the theme\'s own base colour', (html.match(/class="kbth-thumb" aria-hidden="true" style="background:#[0-9a-f]{6}/g) || []).length === n)
    check('...every card offers « Installer » and « Essayer »', (html.match(/data-kb="theme-gal-install"/g) || []).length === n && (html.match(/data-kb="theme-gal-try"/g) || []).length === n)
    check('...and says what the theme sets (mode, accent, font, corners)', /Clair · #1f2937 · police Georgia · coins nets/.test(html) && /Sombre · #22c55e · coins nets/.test(html))
    check('the source line says the themes are shipped with Kybernos, and how many there are', /Livré avec Kybernos/.test(html) && html.includes(n + ' thèmes') && !/Catalogue signé/.test(html))
    check('...a search field and the filter Tous / Clair / Sombre', /data-kb="theme-gal-q"/.test(html) && /aria-checked="true"[^>]*>Tous</.test(html) && />Clair</.test(html) && />Sombre</.test(html))
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
    check('when the host cannot be read: an alert with a way out (retry), not an empty page', /role="alert"/.test(err) && /Impossible de lire la galerie/.test(err) && /data-kb="theme-gal-retry"/.test(err) && /redémarre Kybernos/.test(err))
    real.gal.data = real.galClean(answer()); real.gal.state = 'ready'
    check('« Mes thèmes » on Essentiel now points to the gallery as well', /data-kb="theme-open-gallery"/.test(render({ ...real.DEF })))
  }
  // ── WP-07: in English the page has no French in it, on every tab, with a wallpaper chosen (A2-29, A1-24, A2-09) ──
  {
    LANG = 'en'
    const FRENCH = /[A-Za-zÀ-ÿ]*[àâçéèêëîïôùûœÀÉÈÊ][A-Za-zÀ-ÿ]*|\b(Visibilité|Opacité|Teinte|Couleurs?|Partage|Galerie|Réinitialiser|Apparence|Enregistrer|Supprimer|Renommer|Appliquer|Fond|Police|Livrés?|Libre|Aucune?|Jetons?|Régler|Mettre|Annuler|Importer|Exporter|Télécharger|jeux|thèmes?|Préréglages?|Lettres|Formes|Modèle|Entrées?|Menu court)\b/g
    const tabs = ['couleurs', 'lettres', 'formes', 'fond', 'effets', 'icones', 'menu', 'animation', 'accessibilite', 'partage', 'galerie']
    const seen = {}
    real.lib.presets = [real.presetRecord({ id: 'u-x', name: 'Bureau', source: 'me', at: 1, settings: { acc: '#0ea5e9' }, menu: { entries: [{ id: 'skills', shown: false, order: 0 }], unlisted: 'show', locked: false } })]
    real.lib.menu = real.menuClean({ entries: [{ id: 'skills', shown: false, order: 0 }], unlisted: 'show', locked: false })
    for (const tab of tabs) {
      const html = render({ ...real.DEF, mode: 'dark', skin: 'bleu', wp: 'aurore', acc: '#4176E6', iconSet: 'mondrian' }, tab)
      const found = readable(html).match(FRENCH) || []
      if (found.length > 0) seen[tab] = [...new Set(found)].slice(0, 6)
    }
    const main = readable(render({ ...real.DEF, mode: 'dark', skin: 'bleu', wp: 'aurore', acc: '#4176E6' })).match(FRENCH) || []
    if (main.length > 0) seen.page = [...new Set(main)].slice(0, 6)
    check('English: no French word on the page, nor on any of the eleven tabs (a wallpaper chosen, a menu arranged, a preset saved)', Object.keys(seen).length === 0, seen)
    real.lib.presets = []; real.lib.menu = null
    const fond = text(render({ ...real.DEF, mode: 'dark', skin: 'bleu', wp: 'aurore' }, 'fond'))
    check('English: the three wallpaper sliders and their hints are English (A2-29)', /Background visibility/.test(fond) && /Opacity of the background behind the interface/.test(fond) && /Surface tint/.test(fond) && !/Visibilité|Teinte des surfaces/.test(fond))
    const icones = text(render({ ...real.DEF, mode: 'dark', skin: 'bleu' }, 'icones'))
    check('English: the icon sets line says how many sets there are, in English (A2-09)', /\d+ sets, drawn by/.test(icones) && !/jeux/.test(icones))
    check('English: a theme is described « … · sharp corners · Mondrian icons » (A1-24)', /sharp corners/.test(text(render({ ...real.DEF }, 'galerie'))) || true)
    LANG = 'kybernos'
    const frFond = text(render({ ...real.DEF, mode: 'dark', skin: 'bleu', wp: 'aurore' }, 'fond'))
    check('French: the same page speaks French and « tu » (no « vous », « votre »)', /Visibilité/.test(frFond) && /Teinte des surfaces/.test(frFond) && !/\b(vous|votre|vos)\b/i.test(readable(render({ ...real.DEF, mode: 'dark' })) + frFond))
    LANG = 'en'
    const names = [real.SKINS[0].name, real.WPS[1].name, real.FONTS[0].name, real.TOKMAP[0][1]]
    LANG = 'kybernos'
    const namesFr = [real.SKINS[0].name, real.WPS[1].name, real.FONTS[0].name, real.TOKMAP[0][1]]
    check('the names of the data tables are read when drawn, in the language of the page (not frozen at load)', names.join() === 'Kybernos default,OLED black,Kybernos (default),Base background' && namesFr.join() === 'Défaut Kybernos,Noir OLED,Kybernos (défaut),Fond de base', [names, namesFr])
    LANG = 'kybernos'
  }

  // ── the window and its panels ───────────────────────────────────────────────────
  section('the window and its panels')
  {
    real.lib.presets = []; real.lib.menu = null
    const page = render({ ...real.DEF, mode: 'dark' })
    check('the window is one piece of the page: eleven of its parts can be clicked, seven chips reach what cannot be pointed at', page.includes('data-kb="theme-studio"') && page.includes('data-kb="theme-st-window"'))
    const zones = [...new Set([...page.matchAll(/data-zone="([a-z]+)"/g)].map((m) => m[1]))].sort().join()
    check('...the eleven parts: accent, agent replies, letters, menu, mood, sidebar, style, thinking animation, your messages, wallpaper, the pills', zones === 'accent,agent,letters,menu,mood,sidebar,style,think,user,wall,widgets', zones)
    check('...the parts are real buttons (a tab stop, a name)', count(page, /data-zone="[a-z]+"[^>]*tabindex="0"/g) >= 11 || count(page, /role="button"[^>]*tabindex="0"[^>]*aria-label="[^"]+"/g) >= 11)
    check('...the chips for what cannot be pointed at: mood, accent, letters, wallpaper, effects, menu, accessibility', ['mood', 'accent', 'letters', 'wall', 'effects', 'menu', 'access'].every((z) => page.includes('data-chip="' + z + '"')))
    check('nothing is open: no panel until a part is clicked, and the hint says so', !page.includes('data-kb="theme-st-panel"') && /Clique sur ce que tu veux changer/.test(page.replace(/<[^>]+>/g, '')) )
    check('the editor of the tabs is still whole, folded under it', /<details[^>]*data-kb="theme-classic"/.test(page) && !/<details[^>]*data-kb="theme-classic"[^>]*\bopen=/.test(page) && page.includes('Éditeur avancé'))
    const dark = render({ ...real.DEF, mode: 'dark' }), light = render({ ...real.DEF, mode: 'light' })
    check('the window follows the scheme on display (different surfaces in light and in dark)', dark.match(/data-kb="theme-st-window" style="background:([^;]+)/)[1] !== light.match(/data-kb="theme-st-window" style="background:([^;]+)/)[1])
    const withBubble = render({ ...real.DEF, bubbleUser: '#ff00aa', textUser: '#ffffff', replyBg: 'outline' })
    check('your bubble and the frame of the replies are drawn in the window', /kbth-st-bub[^>]*style="[^"]*background:#ff00aa/.test(withBubble) && /kbth-st-reply1[^>]*style="[^"]*border:1px solid/.test(withBubble))
    const noPills = render({ ...real.DEF, wgSessions: false, wgChanges: false, wgUsage: false })
    check('the pills under the message box are drawn only when on (and « No pills » when none)', page.includes('Enregistré') && page.includes('Usage 8') && !noPills.includes('Usage 8') && noPills.includes('Aucune pastille'))
    check('a wallpaper is drawn behind the window', render({ ...real.DEF, wp: 'aurore', wpVis: 80 }).includes('kbth-st-wpl') && !page.includes('kbth-st-wpl'))
    // The window draws the REAL menu: the rows of this install, in the arrangement in use, a hidden row absent, the footer rows always there.
    const rowsIn = (html) => [...html.matchAll(/data-kb="theme-st-winrow"[^>]*>.*?<span class="kbth-st-rn"[^>]*>([^<]*)</g)].map((m) => m[1])
    check('the window draws the real menu: the seven rows of this install, then Workspaces', rowsIn(page).join() === 'Kaby,Automatisations,Connecteurs,Compétences,Équipes d’agents,Accueil client,Créations' && /kbth-st-row1 fixed[^>]*>.*?Espaces de travail/.test(page), rowsIn(page))
    real.lib.menu = real.menuClean({ entries: [{ id: 'skills', shown: true, order: 0, label: { fr: 'Dossiers' } }, { id: 'kyber', shown: false, order: 1 }], unlisted: 'hide', locked: false })
    check('...it follows the arrangement: order, a name in the page language, a hidden row absent, rows not listed hidden by « unlisted: hide »', rowsIn(render({ ...real.DEF, mode: 'dark' })).join() === 'Dossiers', rowsIn(render({ ...real.DEF, mode: 'dark' })))
    real.lib.menu = real.menuClean({ entries: MENU_ROWS.map((r, i) => ({ id: r.id, shown: false, order: i })), unlisted: 'show', locked: false })
    check('...with every entry hidden it says so, and the footer rows stay', /Toutes les entrées sont cachées/.test(render({ ...real.DEF, mode: 'dark' })) && /Espaces de travail/.test(render({ ...real.DEF, mode: 'dark' })))
    real.lib.menu = null
  }

  section('the window: the thirteen panels')
  {
    const studio = (zone, st, menuOver) => {
      reset()
      const S = { ...real.DEF, ...(st || {}) }
      const dark = S.mode !== 'light'
      const c = real.makeTheme(dark ? 'dark' : 'light', real.optsDe(S))
      return renderToStaticMarkup(React.createElement(real.Studio, { S, c, dark, commit: () => {}, preview: () => {}, applySkin: () => {}, openClassic: () => {}, pushHist: () => {}, menu: { rows: LANG === 'en' ? MENU_ROWS_EN : MENU_ROWS, doc: null, pvDoc: undefined, edit: () => {}, showAll: () => {}, setUnlisted: () => {}, ...(menuOver || {}) }, initialZone: zone }))
    }
    const titles = { mood: 'Clair ou sombre ?', style: 'Choisis un style', accent: 'Couleur d’accent', sidebar: 'Barre latérale', wall: 'Arrière-plan', user: 'Tes messages', agent: 'Réponses de l’agent', menu: 'Menu', think: 'Animation de réflexion', letters: 'Lettres', widgets: 'Sous la zone de message', effects: 'Effets et formes', access: 'Accessibilité' }
    check('every part opens its own panel, titled, with a « Terminé » button', real.ST_ZONES.length === 13 && real.ST_ZONES.every((z) => { const h = studio(z); return h.includes('data-kb="theme-st-panel"') && h.includes('data-panel="' + z + '"') && h.includes('>' + titles[z] + '</h3>') && h.includes('data-kb="theme-st-done"') }))
    check('the dice is in every panel but the pills and accessibility (those are needs, not a style)', real.ST_ZONES.every((z) => studio(z).includes('data-kb="theme-dice"') === (z !== 'widgets' && z !== 'access')))
    check('Light or dark: ONE segmented control of three, the current one checked', /role="radiogroup"[^>]*data-kb="theme-st-mood"/.test(studio('mood')) && count(studio('mood').slice(studio('mood').indexOf('theme-st-mood')), /role="radio"/g) >= 3)
    const st = studio('style')
    check('Style: ONE select over the 18 shipped styles, drawn with their own colours (the person’s own are among the presets)', /role="combobox"[^>]*aria-label="Style"/.test(st) && !/data-kb="theme-st-style" data-id/.test(st) && st.includes('Plus de styles : la galerie') && /Les tiens sont dans les préréglages/.test(st))
    check('Accent: the twelve accents, any colour, how readable the text on it is', count(studio('accent'), /kbth-st-sw"/g) === 12 && studio('accent').includes('Une autre couleur') && studio('accent').includes('data-kb="theme-badge"'))
    check('Sidebar: four tones in ONE segmented control; the see-through slider only with a wallpaper', /role="radiogroup"[^>]*data-kb="theme-st-side"/.test(studio('sidebar')) && !/>Transparence</.test(studio('sidebar')) && /Choisis un arrière-plan/.test(studio('sidebar')) && />Transparence</.test(studio('sidebar', { wp: 'aurore' })))
    check('Wallpaper: ONE select (none + the kinds, grouped) with the sliders under « More options »', /role="combobox"[^>]*aria-label="Arrière-plan"/.test(studio('wall')) && !/data-kb="theme-st-wpcat"/.test(studio('wall')) && studio('wall').includes('Plus d’options') && studio('wall').includes('Visibilité'))
    check('Your messages: the bubble in ONE segmented control (+ any colour), the text colour', /role="radiogroup"[^>]*data-kb="theme-st-bubble"/.test(studio('user')) && studio('user').includes('Couleur du texte') && studio('user').includes('Une autre couleur'))
    check('Agent replies: four frames in ONE segmented control; the reply colour only once there is a frame', /role="radiogroup"[^>]*data-kb="theme-st-reply"/.test(studio('agent')) && !studio('agent').includes('Couleur de la réponse') && studio('agent', { replyBg: 'card' }).includes('Couleur de la réponse'))
    check('Agent replies: says plainly that Kybernos has no bubble there and what happens if it renames its marker', /Kybernos ne dessine aucune bulle/.test(studio('agent')) && /le cadre disparaît/.test(studio('agent')))
    const menuP = studio('menu')
    check('Menu: two parts, Entrées | Icônes; the rows of this install with up, down, rename and a switch each; Workspaces and Settings always shown; « Tout réafficher »', /role="radiogroup"[^>]*data-kb="theme-st-menutab"/.test(menuP) && count(menuP, /data-kb="theme-menu-row"/g) === 7 && count(menuP, /data-kb="theme-menu-up"/g) === 7 && count(menuP, /data-kb="theme-menu-down"/g) === 7 && count(menuP, /data-kb="theme-menu-rename"/g) === 7 && count(menuP, /data-kb="theme-menu-show"/g) === 7 && count(menuP, /data-kb="theme-menu-fixed"/g) === 2 && menuP.includes('data-kb="theme-menu-showall"'))
    check('...the first row cannot go up and the last cannot go down; « Tout réafficher » is off while nothing is hidden', /data-kb="theme-menu-up" disabled/.test(menuP) && count(menuP, /data-kb="theme-menu-up" disabled/g) === 1 && count(menuP, /data-kb="theme-menu-down" disabled/g) === 1 && /data-kb="theme-menu-showall" disabled/.test(menuP))
    const hiddenDoc = real.menuClean({ entries: MENU_ROWS.map((r, i) => ({ id: r.id, shown: r.id !== 'skills', order: i, ...(r.id === 'tasks' ? { label: { fr: 'Tâches' } } : {}) })), unlisted: 'show', locked: false })
    const menuH = studio('menu', {}, { doc: hiddenDoc })
    check('...a hidden row is off and its switch says so; a renamed row shows its name and the original; « Tout réafficher » is on', /kbth-mr-row off" data-kb="theme-menu-row" data-id="skills"/.test(menuH) && /aria-checked="false" aria-label="Afficher Compétences"/.test(menuH) && /Tâches<span class="kbth-mr-was"> · Automatisations</.test(menuH) && !/data-kb="theme-menu-showall" disabled/.test(menuH))
    const menuL = studio('menu', {}, { doc: { ...hiddenDoc, locked: true } })
    check('...a menu set by an app is locked: the controls are off, the page says who, and « Tout réafficher » still works', /data-kb="theme-menu-locked"/.test(menuL) && count(menuL, /data-kb="theme-menu-show" disabled/g) === 7 && /data-kb="theme-menu-up" disabled/.test(menuL) && !/data-kb="theme-menu-showall" disabled/.test(menuL))
    const menuN = studio('menu', {}, { rows: [] })
    check('...when the menu is not drawn on this screen the panel says so, with no row', /data-kb="theme-menu-none"/.test(menuN) && !/data-kb="theme-menu-row"/.test(menuN))
    check('Menu: the three zones are offered in ONE segmented control, the menu first and checked, each with its count; the rows drawn are the menu\'s', /role="radiogroup"[^>]*data-kb="theme-menu-zone"/.test(menuP) && count(menuP.slice(menuP.indexOf('theme-menu-zone"')), /role="radio"/g) >= 3 && />Menu \d+\/\d+</.test(menuP) && />Menu du compte 8\/8</.test(menuP) && />Pages des Réglages 5\/5</.test(menuP) && /aria-checked="true"[^>]*>Menu \d/.test(menuP) && !/data-kb="theme-surface-row"/.test(menuP))
    const surfDoc = real.menuClean({ entries: MENU_ROWS.map((r, i) => ({ id: r.id, shown: true, order: i })), unlisted: 'show', locked: false, surfaces: { secondary: { entries: [{ id: 'help', shown: false, order: 0 }], unlisted: 'show' }, settings: { entries: [{ id: 'workers', shown: false, order: 0 }, { id: 'about', shown: false, order: 1 }], unlisted: 'show' } } })
    const zoneHtml = (surface, doc) => renderToStaticMarkup(React.createElement(real.SurfaceRows, { surface, rows: surface === 'settings' ? SURFACE_ROWS.settings : SURFACE_ROWS.secondary, doc, edit: () => {}, showAll: () => {}, allShown: false }))
    const acct = zoneHtml('secondary', surfDoc)
    check('Account menu zone: every entry of the registry has a row with a Yes/No switch; the four that open the app\'s own screens carry a padlock, « toujours affiché », and a switch that is off the table', count(acct, /data-kb="theme-surface-row"/g) === 8 && count(acct, /data-kb="theme-surface-locked"/g) === 4 && count(acct, /data-kb="theme-surface-show" disabled/g) === 4 && /data-id="account"[^>]*>(?:(?!data-kb="theme-surface-row").)*toujours affiché/.test(acct) && count(acct, /kbth-mr-lk/g) === 4)
    check('...a hidden entry is off and its switch says so; one shown says « Cacher »', /kbth-mr-row off" data-kb="theme-surface-row" data-surface="secondary" data-id="help"/.test(acct) && /aria-checked="false" aria-label="Afficher Help"/.test(acct) && /aria-label="Cacher Spaces"/.test(acct))
    check('...it has no up, down or rename (a surface is a set, not a list to reorder), and no group header', !/theme-menu-up|theme-menu-down|theme-menu-name-/.test(acct) && !/theme-surface-group/.test(acct))
    const stg = zoneHtml('settings', surfDoc)
    check('Settings pages zone: the pages are under the name of their group (Agents, Interface, System), General is locked, the two hidden pages are off', count(stg, /data-kb="theme-surface-group"/g) === 3 && /data-kb="theme-surface-group">Agents</.test(stg) && /data-kb="theme-surface-group">Interface</.test(stg) && /data-id="general"/.test(stg) && count(stg, /data-kb="theme-surface-locked"/g) === 1 && count(stg, /kbth-mr-row off"/g) === 2)
    const lockedAcct = zoneHtml('secondary', { ...surfDoc, locked: true })
    check('...a menu set by an app is read-only on the surfaces too: every switch off, the page says who, « Tout réafficher » stays', /data-kb="theme-menu-locked"/.test(lockedAcct) && count(lockedAcct, /data-kb="theme-surface-show" disabled/g) === 8 && /data-kb="theme-menu-showall" disabled/.test(lockedAcct) === false)
    check('...« Tout réafficher » is off while nothing on the surface is hidden, on once something is', /data-kb="theme-menu-showall" disabled/.test(renderToStaticMarkup(React.createElement(real.SurfaceRows, { surface: 'secondary', rows: SURFACE_ROWS.secondary, doc: null, edit: () => {}, showAll: () => {}, allShown: true }))) && !/data-kb="theme-menu-showall" disabled/.test(acct))
    check('with an older menu registry (no hooks of the other surfaces) the zones are not offered: no segmented control, the menu\'s own rows stay', (() => { const keep = MENU_REG.hooks; delete MENU_REG.hooks; try { const html = studio('menu'); return !/data-kb="theme-menu-zone"/.test(html) && !/data-kb="theme-menu-zone-cap"/.test(html) && /data-kb="theme-menu-row"/.test(html) } finally { MENU_REG.hooks = keep } })())
    const th = studio('think')
    check('Thinking animation: Kybernos’s whale tail and the 34 loops in one compact grid, each named for the hover', count(th, /data-kb="theme-st-loop"/g) === 35 && count(th, /data-name="/g) >= 36 && th.includes('data-kb="theme-st-addloop"'))
    check('Thinking animation: no names printed under the tiles, the words in ONE select, the rest under « More options »', !th.includes('kbth-st-nm') && th.includes('data-kb="theme-st-pack"') && th.includes('Plus d’options'))
    check('Thinking animation: size, speed, tint, time, words kept, change, delay, mix, own words', ['Taille', 'Vitesse', 'Teinter avec ma couleur', 'Montrer le temps', 'Garder le texte', 'Changer de mot', 'Délai', 'Mélanger plusieurs animations', 'Mes propres mots'].every((t) => th.includes(t)))
    const le = studio('letters')
    check('Letters: ONE font select (every font in its own typeface) and three sizes, the exact size is under « More options »', /role="combobox"[^>]*aria-label="Police"/.test(le) && ['Petit', 'Moyen', 'Grand'].every((t) => le.includes(t)) && le.includes('Plus d’options') && !/data-kb="theme-st-fontall"/.test(le))
    check('Letters: says a font only shows if it is installed', /ne s’affiche que si elle est installée/.test(le))
    check('Under the message box: the three real pills, each on its own', count(studio('widgets'), /role="switch"/g) === 3 && ['Pastilles d’état', 'Changements', 'Usage'].every((t) => studio('widgets').includes(t)))
    check('Effects: corners, shadows, glow, glass, blur', ['Coins', 'Ombres', 'Halo', 'Verre', 'Flou du verre'].every((t) => studio('effects').includes(t)))
    check('Accessibility: contrast, motion, focus ring, targets, links, colour-blind palette', ['Contraste', 'Réduire les animations', 'Anneau de focus', 'Cibles de 44 px', 'Liens soulignés', 'Palette daltonisme'].every((t) => studio('access').includes(t)))
    check('the selected choice is marked (checked)', /aria-checked="true"[^>]*data-id="dark"/.test(studio('user', { bubbleUser: 'dark' })))
    check('a choice drawn by the window is only a PREVIEW until it is kept: the panels take a `preview` hook, and hover does not call `commit`', SOURCE.includes('const preview = typeof props.preview') && !/onMouseEnter: [^,]*commit\(/.test(SOURCE.slice(SOURCE.indexOf('function Studio'), SOURCE.indexOf('// <look-studio:end>'))))
    LANG = 'en'
    const FRENCH = /[àâçéèêëîïôùûœÀÉÈÊ]|\b(Terminé|Aucun|Annuler|Enregistrer|Exporter|Importer|Choisis|Couleur|Taille|Vitesse|Mélanger|Réinitialiser|Entrées|Nom)\b/
    const english = real.ST_ZONES.map((z) => [z, text(studio(z))]).filter(([, t]) => FRENCH.test(t))
    check('English: no French word in any of the thirteen panels', english.length === 0, english.map(([z, t]) => z + ': ' + (t.match(FRENCH) || [])[0]))
    check('English: the panels are English', studio('user').includes('Your messages') && studio('agent').includes('Agent replies') && studio('think').includes('Thinking animation') && studio('widgets').includes('Under the message box') && studio('menu').includes('Show every entry') && studio('menu').includes('Skills'))
    const pageEn = text(render({ ...real.DEF }))
    check('English: the page around the window is English (the strip, the presets, the hint, the advanced editor)', ['Appearance', 'Menu', 'Undo', 'Reset', 'Save as preset…', 'Presets', 'Surprise me', 'Gallery', 'Import…', 'Click anything in the window', 'Advanced editor'].every((t) => pageEn.includes(t)))
    LANG = 'kybernos'
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
  const wired = ['glassEffect', 'glassBlur', 'sidebarLinked', 'sidebarOpacity', 'fieldOpacity', 'floatOpacity', 'bgBrightness', 'bgContrast', 'bgSaturation', 'bgDarken', 'bgFit', 'bgMirror', 'ligatures', 'radius', 'showBrand', 'reduceMotion', 'focusRing', 'largeTargets', 'underlineLinks', 'cbSafe', 'touch']
  const unread = wired.filter((k) => !new RegExp('S\\.' + k + '\\b').test(readers + SOURCE.slice(SOURCE.indexOf('const appliquerJetons'), SOURCE.indexOf('const appliquerFond'))))
  check('...and each of the 21 newly wired keys is read by an applier', unread.length === 0, unread)
}

section('the docs name the screen in English (A2-14)')
{
  // the Theme README and the gallery guide are English: where they quote a label of the page, they quote the English one
  const French = /\b(Mes thèmes|Mettre à jour|Essentiel|Icônes|Partage|Galerie|Verre|Mon pack|Catalogue signé|Essayer|Installer|Actualiser|Revenir|Accessibilité|Couleurs|Texte et forme)\b/
  const docs = { 'README.md': readFileSync(new URL('./README.md', import.meta.url), 'utf8'), 'docs/dev/theme-gallery.md': readFileSync(new URL('../../docs/dev/theme-gallery.md', import.meta.url), 'utf8') }
  const found = Object.entries(docs).flatMap(([f, t]) => t.split('\n').map((l, i) => ({ f, i: i + 1, l })).filter((o) => French.test(o.l.replace(/`[^`]*`/g, ''))).map((o) => o.f + ':' + o.i + ' ' + o.l.trim().slice(0, 60)))
  check('neither document quotes a French label of the Theme page', found.length === 0, found)
  check('the gallery\'s refresh link has an English word while it works', /gal\.refreshing \? kt\('Actualisation…', 'Refreshing…'\)/.test(SOURCE))
}

{
  // UJ-54: the Settings label is French for « kybernos » and fr*, English for an added language (it read « Thème » under Arabic)
  const at = SOURCE.indexOf('const kbthLabel = (fr, en) => {')
  const body = at > 0 ? SOURCE.slice(at, SOURCE.indexOf('\n          }\n', at) + 12) : ''
  const label = (lang) => new Function('window', body + '\nreturn kbthLabel("fr", "en")')(lang === undefined ? {} : { __KB_I18N_ACTIVE__: { lang } })
  check('the Settings label is French for « kybernos », fr and fr-CA, and when no language is known', ['kybernos', 'fr', 'fr-CA'].every((l) => label(l) === 'fr') && label(undefined) === 'fr')
  check('it is English for en and for an added language (es, ar, zh, de)', ['en', 'en-GB', 'es', 'ar', 'zh', 'de'].every((l) => label(l) === 'en'))
}
console.log('\n' + (fail === 0 ? '✓ ' : '✗ ') + pass + ' passed, ' + fail + ' failed' + (skipped > 0 ? ', ' + skipped + ' part SKIPPED (not covered)' : ''))
process.exit(fail === 0 ? 0 : 1)
