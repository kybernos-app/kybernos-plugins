// kybernos-mobile: the display MODE, in one place (owner's list items 35, 36, 37 of 2026-11-24).
//
// ONE mode with two effects. The mode is Simple or Complete; it drives (1) the navigation preset (the locked « Simple » arrangement of the main menu, the account menu and the Settings
// pages: Kybernos plugin `kbSurfaceDoc`) and (2) the technical view (the agent's thinking, commands and tool calls, folded: `kaby-mode.mjs`, the rows whose `scope` is `mode`).
// Both follow ONE class on <html>, `kb-simple`, and ONE attribute, `data-kb-mode="simple|complete"`.
//
// Three axes that do not depend on one another:
//   layout  the width of the screen (mobile.css and the touch layer: the phone's own frame under 700 px);
//   host    where the page runs: the Kybernos app's WebView (`KybernosHost/<v> (ios|android)`, class `kb-kaby` when it carries `KabyMode/<n>`), the phone's browser, a computer;
//   mode    Simple or Complete: this file.
// The web on a computer is NOT a mobile preset: under Auto it is Complete whatever the width of its window, and nothing here reads the width.
//
// What the person chose is `pref`: `auto` (the default), `simple` or `complete`. It is kept per ACCOUNT, not per device: the DSH folder of the account holds it (`mode-store.mjs`, the route
// `MODE_ROUTE`), and the page keeps a copy in its own storage (`MODE_STORAGE_KEY`) so that the first paint already knows it. The page resolves the mode ONCE per load, in the head, before
// anything is drawn (`MODE_EARLY_SCRIPT`), in this order, and never again while it lives (no re-evaluation when the window is resized; a change of mode reloads the page):
//   1. an explicit choice (`simple` or `complete`);
//   2. inside the Kybernos app, the shell's own word: its user agent carries `KabyMode/<n>` (Simple) or does not (Complete: an app that was used before the switch stays what it was);
//   3. a touch device (a coarse primary pointer and touch points) is Simple;
//   4. otherwise Complete.
//
// The head also carries the account's choice (`window.__KB_MODE_HOST__`, read by the host from the store at every index render): the page's own copy can be empty (the phone's engine changes
// its port, so its origin, at every start) and the first paint must still be right. The newer `at` of the two wins.
//
// `bootMode` below is the ONE resolver. The host puts its text in the head of the page (`MODE_EARLY_SCRIPT`); the browser half carries a marked copy (`<kb-mode-boot>` in client.js) for a page that
// refuses inline scripts, and the tests keep the two texts equal. It must stay one self-contained function: no outside name but the window it is given, and no `<` that could close the script tag.

/** The page's own copy of the person's choice (what the head reads before the first paint). */
export const MODE_STORAGE_KEY = 'kybernos.mode.v1'
/** The host route that keeps the person's choice with the account (GET reads, POST writes). */
export const MODE_ROUTE = '/kybernos-mobile/mode'
/** What a person can choose. */
export const MODE_PREFS = Object.freeze(['auto', 'simple', 'complete'])
/** What the page can be. */
export const MODES = Object.freeze(['simple', 'complete'])
/** The class on <html> while the mode is Simple, and the attributes that say what was resolved and why. */
export const MODE_CLASS = 'kb-simple'
export const MODE_ATTR = 'data-kb-mode'
export const MODE_PREF_ATTR = 'data-kb-mode-pref'
export const MODE_SOURCE_ATTR = 'data-kb-mode-source'
/** Where the answer comes from, in the order of the rules above. */
export const MODE_SOURCES = Object.freeze(['choice', 'shell', 'touch', 'default'])

/** A choice as a word we keep, or null. The shell's word for Complete (« advanced ») is accepted. */
export const cleanPref = (v) => {
  if (typeof v !== 'string') return null
  const w = v.trim().toLowerCase()
  if (w === 'advanced') return 'complete'
  return MODE_PREFS.indexOf(w) >= 0 ? w : null
}

/** The document the store and the page's copy hold: `{ v: 1, pref, at }`, or null for anything else. `at` is the moment of the choice, in ms (a newer one wins when two copies disagree). */
export const cleanDoc = (raw) => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const pref = cleanPref(raw.pref)
  if (pref === null) return null
  const at = typeof raw.at === 'number' && Number.isFinite(raw.at) && raw.at >= 0 && raw.at <= 8.64e15 ? Math.floor(raw.at) : 0
  return { v: 1, pref, at }
}

/**
 * The resolver. `w` is a window (or what stands for it): it reads the page's copy of the choice, the user agent and the pointer, and sets the class and the attributes on <html>. Returns
 * `{ mode, pref, source }` and never throws.
 */
export function bootMode (w) {
  var out = { mode: 'complete', pref: 'auto', source: 'default' }
  try {
    var root = w.document.documentElement
    var ua = String(w.navigator.userAgent || '')
    var doc = null
    try { doc = JSON.parse(w.localStorage.getItem('kybernos.mode.v1') || 'null') } catch (e) { doc = null }
    // the account's choice, put in the head by the host (the page's own storage may be empty: the phone's engine changes its port, so its origin, at every start); the newer of the two wins
    var host = w.__KB_MODE_HOST__
    if (host !== null && typeof host === 'object' && typeof host.pref === 'string' && !(doc !== null && typeof doc === 'object' && typeof doc.pref === 'string' && Number(doc.at) > Number(host.at))) doc = host
    var pref = doc !== null && typeof doc === 'object' && typeof doc.pref === 'string' ? doc.pref.toLowerCase() : 'auto'
    if (pref === 'advanced') pref = 'complete'
    if (pref !== 'simple' && pref !== 'complete') pref = 'auto'
    out.pref = pref
    var app = /KybernosHost\/[0-9][0-9A-Za-z.+-]* \((?:ios|android)\)/.test(ua)
    var shellSimple = /KybernosHost\/[0-9][0-9A-Za-z.+-]* \((?:ios|android)\) KabyMode\/[1-9]/.test(ua)
    var touch = false
    try { touch = w.navigator.maxTouchPoints > 0 && w.matchMedia('(pointer: coarse)').matches === true } catch (e) { touch = false }
    if (pref !== 'auto') { out.mode = pref; out.source = 'choice' } else if (app) { out.mode = shellSimple ? 'simple' : 'complete'; out.source = 'shell' } else if (touch) { out.mode = 'simple'; out.source = 'touch' }
    if (out.mode === 'simple') root.classList.add('kb-simple'); else root.classList.remove('kb-simple')
    root.setAttribute('data-kb-mode', out.mode)
    root.setAttribute('data-kb-mode-pref', out.pref)
    root.setAttribute('data-kb-mode-source', out.source)
  } catch (e) { /* a page with no storage or no document keeps the full app */ }
  return out
}

/**
 * The sheet « Display » (client.js `buildModeSheet`): a bottom sheet on a phone, a dialog elsewhere. Delivered by the host in the head, with the resolver: mobile.css is the phone's alone and is
 * inert above 700 px, and this sheet is drawn at every width. Tokens of the phone look, then DSH's own, then a system colour; no colour of its own.
 */
export const MODE_CSS_ID = 'kbmob-mode'
export const MODE_CSS = [
  '.kbmob-modeback{position:fixed;inset:0;z-index:90;display:flex;align-items:flex-end;justify-content:center;font-family:inherit;}',
  '.kbmob-modescrim{position:absolute;inset:0;background:rgba(0,0,0,.5);}',
  '.kbmob-modesheet{position:relative;box-sizing:border-box;width:100%;max-width:480px;max-height:92vh;overflow:auto;padding:8px 16px calc(16px + var(--kb-sab,env(safe-area-inset-bottom,0px)));border-radius:20px 20px 0 0;background:var(--kbmob-sheet,var(--dsw-alias-bg-layer-2,Canvas));color:var(--kbmob-fg,var(--dsw-alias-label-primary,CanvasText));box-shadow:0 -8px 32px rgba(0,0,0,.35);}',
  '.kbmob-modegrab{width:40px;height:4px;border-radius:2px;margin:4px auto 12px;background:var(--kbmob-card2,var(--dsw-alias-border-l2,GrayText));}',
  '.kbmob-modesheet h2{margin:0 0 8px;padding:0 4px;font-size:20px;line-height:28px;font-weight:600;color:inherit;}',
  '.kbmob-modeopt{display:flex;align-items:center;justify-content:space-between;gap:12px;box-sizing:border-box;width:100%;min-height:64px;margin:0 0 8px;padding:10px 16px;border:1px solid transparent;border-radius:14px;background:var(--kbmob-card,var(--dsw-alias-bg-layer-3,ButtonFace));color:inherit;font:inherit;text-align:start;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
  '.kbmob-modeopt[aria-checked="true"]{border-color:var(--dsw-alias-brand-primary,Highlight);}',
  '.kbmob-modeopt:disabled{opacity:.6;cursor:default;}',
  '.kbmob-modeopt-t{display:flex;flex-direction:column;gap:2px;min-width:0;}',
  '.kbmob-modeopt-t b{font-size:17px;line-height:24px;font-weight:600;}',
  '.kbmob-modeopt-t span{font-size:15px;line-height:20px;opacity:.72;}',
  '.kbmob-modeopt-t .kbmob-modenow{opacity:1;color:var(--dsw-alias-brand-primary,Highlight);font-weight:500;}',
  '.kbmob-modedot{flex:none;width:22px;height:22px;box-sizing:border-box;border-radius:50%;border:2px solid var(--dsw-alias-border-l2,GrayText);}',
  '.kbmob-modeopt[aria-checked="true"] .kbmob-modedot{border:6px solid var(--dsw-alias-brand-primary,Highlight);}',
  '.kbmob-modenote{margin:4px 4px 8px;font-size:15px;line-height:20px;opacity:.72;}',
  '.kbmob-modelink{display:flex;align-items:center;justify-content:space-between;box-sizing:border-box;width:100%;min-height:48px;padding:0 16px;border:0;border-radius:14px;background:transparent;color:inherit;font:inherit;font-size:16px;text-align:start;cursor:pointer;}',
  '@media (min-width:701px){.kbmob-modeback{align-items:center;}.kbmob-modesheet{width:420px;border-radius:16px;padding-bottom:16px;}.kbmob-modegrab{display:none;}}'
].join('\n')

/** The same resolver as the few lines the host puts in the head, so that the first paint is already in the right mode. `<` never closes the tag: the test refuses `</script` and `<!--`. */
export const MODE_EARLY_SCRIPT = '(function(){var bootMode=' + bootMode.toString().replace(/^function bootMode/, 'function') + ';bootMode(window)})()'

/**
 * The head rows for one index render: the sheet's stylesheet, then the resolver. `stored` is the account's choice as the store holds it (`{ v, pref, at }`, or nothing): it goes in the page as `window.__KB_MODE_HOST__`, so that the first
 * paint knows it on any origin. Only the cleaned word and number are written (never text from the file). Never throws.
 */
export function modeRows (stored) {
  try {
    if (/<\/script|<!--/i.test(MODE_EARLY_SCRIPT)) return []
    const doc = cleanDoc(stored)
    const given = doc === null || doc.at === 0 ? '' : 'window.__KB_MODE_HOST__={pref:' + JSON.stringify(doc.pref) + ',at:' + doc.at + '};'
    const rows = [{ kind: 'html', placement: 'head', html: '<script>' + given + MODE_EARLY_SCRIPT + '</script>' }]
    if (!/<\/style/i.test(MODE_CSS)) rows.unshift({ kind: 'html', placement: 'head', html: '<style id="' + MODE_CSS_ID + '">' + MODE_CSS + '</style>' })
    return rows
  } catch (e) { return [] }
}
