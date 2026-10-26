// kybernos-pulse — the page of the Mac menu-bar app. It is the panel of the floating window, drawn by the SAME code: the block of client.js between
// PANEL-CORE-BEGIN and PANEL-CORE-END (pure: no DOM, no ctx, no fetch) is copied into one self-contained page that the host serves, and a small
// script around it polls the state, draws the panel and answers the clicks. The app only shows this page in a web view; nothing is drawn twice.
// Pure: strings in, string out (the host reads the two source files and hands them in).

const BEGIN = '// PANEL-CORE-BEGIN'
const END = '// PANEL-CORE-END'

/** The pure block of client.js, as code. Null when the markers are not there. */
export const extractCore = (clientSource) => {
  const a = String(clientSource).indexOf(BEGIN)
  const b = String(clientSource).indexOf(END)
  if (a < 0 || b < a) return null
  const body = String(clientSource).slice(a + BEGIN.length, b)
  // the rest of the marker line is a comment text, not code
  return body.slice(body.indexOf('\n') + 1)
}

/** The brand mark (the red K) as a data address, from the pure block of the brand code. '' when it is not there: the panel then has no mark. */
export const brandMarkFrom = (pluginSource) => {
  try {
    const m = /\/\/ KB-BRAND-CORE-BEGIN([\s\S]*?)\/\/ KB-BRAND-CORE-END/.exec(String(pluginSource))
    if (m === null) return ''
    const href = new Function(m[1] + '\nreturn kbBrandFaviconHref()')()
    return typeof href === 'string' && /^data:image\/svg\+xml,/.test(href) ? href : ''
  } catch (e) { return '' }
}

/** What the page may do: its own scripts and styles, its own host for the data, images from data addresses. Nothing else. */
export const PANEL_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

// The tokens the panel's styles read, with the values it has in Kybernos: dark first, light when the Mac is light.
const TOKENS_CSS = [
  ':root{color-scheme:dark light}',
  'html,body{height:100%;margin:0}',
  'body{overflow:hidden;-webkit-user-select:none;user-select:none;cursor:default}',
  '@media (prefers-color-scheme:light){:root{',
  '--dsw-alias-bg-base:#ffffff;--dsw-alias-bg-layer-1:#f7f7f8;--dsw-alias-bg-layer-2:#f4f4f5;--dsw-alias-bg-layer-3:#ececee;',
  '--dsw-alias-label-primary:#18181b;--dsw-alias-label-secondary:#3f3f46;--dsw-alias-label-tertiary:#71717a;--dsw-alias-label-primary-foreground:#fafafa;',
  '--dsw-alias-border-l1:rgba(0,0,0,.06);--dsw-alias-border-l2:rgba(0,0,0,.1);--dsw-alias-border-l3:rgba(0,0,0,.16);--dsw-alias-interactive-bg-hover:rgba(0,0,0,.05);',
  '--dsw-alias-button-primary-fill:#18181b;--dsw-alias-state-success-primary:#16a34a;--dsw-alias-state-error-primary:#dc2626;--dsw-alias-state-warn-primary:#d97706}}'
].join('')

// The script around the shared block. __CORE__ and __MARK__ are replaced by the builder. No back quote, no ${ in here: it is plain text.
const BOOT = [
  "(function () {",
  "  'use strict'",
  "  var Q = new URLSearchParams(location.search)",
  "  var LANG = Q.get('lang') === 'fr' ? 'fr' : 'en'",
  "  window.__KB_LANG_RESOLVE__ = function () { return LANG === 'fr' ? 'kybernos' : 'en' }",
  "__CORE__",
  "  var MARK = __MARK__",
  "  var st = { snap: null, down: false, tab: 'inbox', filter: 'todo', last: '' }",
  "  var root = document.getElementById('root')",
  "  var tell = function (m) { try { window.webkit.messageHandlers.pulse.postMessage(m); return true } catch (e) { return false } }",
  "  var token = function () { return typeof window.__PULSE_TOKEN__ === 'string' ? window.__PULSE_TOKEN__ : '' }",
  "  var valid = function (j) { return j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.inbox) && Array.isArray(j.running) && Array.isArray(j.banners) && j.settings !== null && typeof j.settings === 'object' }",
  "  var draw = function (force) {",
  "    var html",
  "    if (st.snap === null) html = offlineHTML(st.down)",
  "    else html = panelHTML({ snap: st.snap, tab: st.tab, filter: st.filter, now: Date.now(), mark: MARK })",
  "    if (force !== true && html === st.last) return",
  "    var body = document.getElementById('kbpu-body')",
  "    var scroll = body !== null ? body.scrollTop : 0",
  "    st.last = html",
  "    root.innerHTML = html",
  "    var again = document.getElementById('kbpu-body')",
  "    if (again !== null) again.scrollTop = scroll",
  "  }",
  "  var refresh = function () {",
  "    return fetch('/kybernos-pulse/state', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null }).then(function (j) {",
  "      if (valid(j)) { st.snap = j; st.down = false } else { st.snap = null; st.down = true }",
  "    }, function () { st.snap = null; st.down = true }).then(function () { draw(false) })",
  "  }",
  "  // A write goes with the app's own token (put in the page by the app, nowhere else): without it the page only reads.",
  "  var post = function (path, body) {",
  "    var t = token()",
  "    if (t === '') return Promise.resolve(false)",
  "    return fetch(path, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-kybernos-helper-token': t }, body: JSON.stringify(body) })",
  "      .then(function (r) { return refresh().then(function () { return r.ok }) }, function () { return false })",
  "  }",
  "  document.addEventListener('click', function (ev) {",
  "    var el = ev.target !== null && typeof ev.target.closest === 'function' ? ev.target.closest('[data-act]') : null",
  "    if (el === null) return",
  "    var act = el.getAttribute('data-act')",
  "    var id = el.getAttribute('data-id')",
  "    var it = id !== null && st.snap !== null ? st.snap.inbox.find(function (x) { return x.id === id }) : undefined",
  "    if (act === 'tab') { st.tab = el.getAttribute('data-v') === 'now' ? 'now' : 'inbox'; draw(true) }",
  "    else if (act === 'filter') { st.filter = el.getAttribute('data-v') === 'results' ? 'results' : 'todo'; draw(true) }",
  "    else if (act === 'open' || act === 'kyb' || act === 'gear') {",
  "      if (act === 'open' && it !== undefined && it.unread === true) void post('/kybernos-pulse/inbox', { action: 'read', id: id })",
  "      if (!tell({ act: act === 'gear' ? 'settings' : 'open' })) window.open('/', '_blank')",
  "    }",
  "    else if (act === 'dismiss' && id !== null) void post('/kybernos-pulse/inbox', { action: 'dismiss', id: id })",
  "    else if (act === 'mute' && it !== undefined) void post('/kybernos-pulse/settings', { mute: it.task })",
  "    else if (act === 'readall') void post('/kybernos-pulse/inbox', { action: 'read-all' })",
  "  })",
  "  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') tell({ act: 'close' }) })",
  "  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') void refresh() })",
  "  window.__pulseRefresh = refresh",
  "  document.getElementById('kbpu-sheet').textContent = PANEL_CSS.join('\\n')",
  "  draw(true)",
  "  void refresh()",
  "  setInterval(refresh, 4000)",
  "})()"
].join('\n')

/** The whole page, or null when there is no block to draw from. */
export const buildPanelPage = ({ core, mark }) => {
  if (typeof core !== 'string' || core === '' || core.indexOf('</script') >= 0) return null
  const script = BOOT.replace('__CORE__', () => core).replace('__MARK__', () => JSON.stringify(typeof mark === 'string' ? mark : ''))
  return '<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>Kybernos</title>' +
    '<style>' + TOKENS_CSS + '</style><style id="kbpu-sheet"></style></head>' +
    '<body class="kbpu-pip kbpu-native" data-kb="pulse-panel-page"><div id="root"></div><script>' + script + '</script></body></html>\n'
}
