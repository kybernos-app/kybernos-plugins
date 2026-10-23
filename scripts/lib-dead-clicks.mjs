// The dead-click probe: press everything a person could press on a page, with a real mouse event, and say what does NOTHING or THROWS.
//
// Born from the bug of 2026-10-23 (the Featured cards of the Skills page had a hand cursor, a role, a tab stop, and no handler at all: the click did nothing,
// and « Details » on them threw `openIt is not a function`). Nothing a test reads from the source sees that; a person finds it by clicking. This does the clicking.
//
//   import { INSTALL_JS, verdictOf, probePage } from './lib-dead-clicks.mjs'
//
// A target is anything that claims to be pressable: a button, a link of the app, an element with a pressable role (button, link, tab, menuitem, option, switch,
// checkbox, radio, treeitem), a tab stop that is not a form control, or the outermost element whose cursor is a hand (a card with an onClick and no role).
// Each is scrolled into view, pressed where nothing nested sits on top of it, and watched for ~0.7 s. The **effects** that count are what a handler can really do:
//   a change in the page (any DOM mutation, but those of nodes that were already moving by themselves before the click are not counted: spinners, clocks),
//   a request (fetch, XHR, beacon), a navigation (location, history, window.open), a copy to the clipboard, a native dialog (alert, confirm, prompt),
//   a reload of the page.
// The verdicts: `ok` (an effect), `dead` (no effect at all), `broken` (an uncaught error, whatever else happened).
// Skipped on purpose: disabled controls, what is already selected / pressed / current (pressing it again may do nothing), form fields (typed into, not pressed),
// links that leave the app, downloads, and what reads as destructive (the deny-list below): the probe is read-only by design and the runner blocks every write.
export const DESTRUCTIVE = /\b(sign ?out|log ?out|delete|remove|disconnect|unlink|uninstall|reset|erase|clear all|revoke|deactivate|quit|empty trash)\b|supprimer|déconnecter|déconnexion|retirer|effacer|désinstaller|réinitialiser|quitter/i

/** Installed in every page before its own scripts (Page.addScriptToEvaluateOnNewDocument), and again by hand in a page that is already open. Idempotent. */
export const INSTALL_JS = `(() => {
  if (window.__DC) return true
  const dc = window.__DC = { mut: 0, reqs: 0, nav: 0, clip: 0, dialogs: 0, errs: [], learn: false, guard: false, scope: '', noisy: new WeakSet(), seen: new Set() }
  new MutationObserver((list) => {
    for (const r of list) {
      if (dc.learn) { dc.noisy.add(r.target); if (r.type === 'characterData' && r.target.parentNode) dc.noisy.add(r.target.parentNode); continue }
      const t = r.target
      // The shell marks <html> with how the last input came (keyboard or pointer): Escape, which this probe uses to close a layer, makes the NEXT mouse press flip it. Not the press's doing.
      if (r.type === 'attributes' && (t === document.documentElement || t === document.body) && /^data-(input|focus|modality|interaction)/.test(r.attributeName || '')) continue
      if (dc.noisy.has(t) || (t.nodeType === 3 && dc.noisy.has(t.parentNode))) continue
      dc.mut += 1
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
  window.addEventListener('error', (e) => { dc.errs.push(String(e && e.message || e).slice(0, 200)) })
  window.addEventListener('unhandledrejection', (e) => { dc.errs.push('unhandled rejection: ' + String(e && e.reason && e.reason.message || e && e.reason || '').slice(0, 160)) })
  // A request is an effect, unless that very request (method and path) was already being made by the page on its own, outside any press (a heartbeat, a beacon, a
  // refresh: the page keeps a list of them while it is idle and while it learns): it says nothing about the click. Only a request the page never makes by itself counts.
  const noteReq = (method, url) => {
    const m = String(method || 'GET').toUpperCase()
    let path = String(url)
    try { path = new URL(String(url), location.href).pathname } catch (e) { /* keep the text */ }
    const k = m + ' ' + path
    if (dc.learn || !dc.guard) { dc.seen.add(k); return }
    if (dc.seen.has(k)) return
    dc.reqs += 1
  }
  const wrap = (obj, name, before) => { const f = obj && obj[name]; if (typeof f !== 'function') return; obj[name] = function () { before.apply(this, arguments); return f.apply(this, arguments) } }
  wrap(window, 'fetch', function (input, init) { noteReq((init && init.method) || (input && input.method) || 'GET', typeof input === 'string' ? input : (input && input.url) || input) })
  if (window.XMLHttpRequest) {
    wrap(XMLHttpRequest.prototype, 'open', function (m, u) { this.__dc = [m, u] })
    wrap(XMLHttpRequest.prototype, 'send', function () { noteReq(this.__dc && this.__dc[0], this.__dc && this.__dc[1]) })
  }
  wrap(navigator, 'sendBeacon', function (u) { noteReq('POST', u) })
  // While a press is being watched nothing goes out on a socket (a chat message, a command): the probe never talks to the server by that road.
  if (window.WebSocket) { const send = WebSocket.prototype.send; WebSocket.prototype.send = function () { if (dc.guard) return undefined; return send.apply(this, arguments) } }
  wrap(history, 'pushState', () => { dc.nav += 1 })
  wrap(history, 'replaceState', () => { dc.nav += 1 })
  window.open = function () { dc.nav += 1; return null }   // never open a tab: the click counts as an effect
  try { if (navigator.clipboard) wrap(navigator.clipboard, 'writeText', () => { dc.clip += 1 }) } catch (e) { /* read-only in this context */ }
  for (const n of ['alert', 'confirm', 'prompt']) window[n] = function () { dc.dialogs += 1; return n === 'confirm' ? false : null }

  const ROLES = ['button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'switch', 'checkbox', 'radio', 'treeitem']
  const NATIVE_FIELD = /^(input|select|textarea)$/i
  const visible = (el) => {
    if (el.getClientRects().length === 0) return false
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || cs.display === 'none') return false
    const r = el.getBoundingClientRect()
    if (r.width < 6 || r.height < 6) return false
    return el.closest('[aria-hidden="true"],[inert]') === null
  }
  const external = (el) => { if (el.tagName !== 'A') return false; const h = el.getAttribute('href') || ''; try { return new URL(h, location.href).origin !== location.origin } catch (e) { return true } }
  const isTarget = (el) => {
    if (el.nodeType !== 1 || NATIVE_FIELD.test(el.tagName) || el.isContentEditable) return false
    const role = el.getAttribute('role')
    if (el.tagName === 'BUTTON' || el.tagName === 'SUMMARY') return true
    if (el.tagName === 'A') return el.hasAttribute('href')
    if (role !== null && ROLES.indexOf(role) >= 0) return true
    const ti = el.getAttribute('tabindex')
    if (ti !== null && ti !== '-1' && el.tagName !== 'A') return true
    const p = el.parentElement
    return getComputedStyle(el).cursor === 'pointer' && (p === null || getComputedStyle(p).cursor !== 'pointer')
  }
  const labelOf = (el) => (el.getAttribute('aria-label') || (el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 60) || el.getAttribute('title') || el.getAttribute('data-kb') || el.tagName.toLowerCase())
  const skipOf = (el, label) => {
    if (el.disabled === true || el.getAttribute('aria-disabled') === 'true') return 'disabled'
    // Pressing the tab, the option or the page that is already the current one may do nothing, rightly. A switch or a toggle that is « on » is pressed all the same: it turns off.
    if (el.getAttribute('aria-selected') === 'true') return 'already selected'
    if (el.getAttribute('aria-current') !== null && el.getAttribute('aria-current') !== 'false') return 'already current'
    // The active segment of a segmented control (cards / list, a filter chip, a swatch): aria-pressed, or the class the app gives the current one.
    if (el.getAttribute('aria-pressed') === 'true') return 'already pressed'
    const cls = String(el.getAttribute('class') || '')
    if (/(^|\\s)(?:[a-z0-9_]+-)*(on|active|selected|current)(\\s|$)/i.test(cls) && el.getAttribute('role') !== 'switch' && !/(^|[\\s_-])(sw|switch|toggle)([\\s_-]|$)/i.test(cls)) return 'looks like the current one'
    if (el.tagName === 'A' && (external(el) || el.hasAttribute('download'))) return 'leaves the app'
    if (el.hasAttribute('data-dc-skip')) return 'marked data-dc-skip'
    if (${DESTRUCTIVE}.test(label)) return 'reads as destructive'
    return ''
  }
  const list = () => {
    const out = []
    const seen = {}
    const root = (dc.scope !== '' && document.querySelector(dc.scope)) || document.body
    const all = root.querySelectorAll('*')
    for (const el of all) {
      if (!isTarget(el) || !visible(el)) continue
      const label = labelOf(el)
      const base = (el.getAttribute('role') || el.tagName.toLowerCase()) + '|' + (el.getAttribute('data-kb') || '') + '|' + label.slice(0, 40)
      seen[base] = (seen[base] || 0) + 1
      out.push({ el, key: base + '|' + seen[base], label, tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '', dk: el.getAttribute('data-kb') || '', cls: String(el.getAttribute('class') || '').slice(0, 60), skip: skipOf(el, label) })
    }
    return out
  }
  window.__DC_API = {
    keys: () => list().map((t) => ({ key: t.key, label: t.label, tag: t.tag, role: t.role, dk: t.dk, cls: t.cls, skip: t.skip })),
    // Scroll one target to the middle and give a point where pressing it presses IT (not a button nested on top of it), or why there is none.
    point: (key) => {
      const t = list().find((x) => x.key === key)
      if (!t) return { gone: true }
      t.el.scrollIntoView({ block: 'center', inline: 'center' })
      const r = t.el.getBoundingClientRect()
      const owner = (hit) => { for (let e = hit; e && e !== document.body; e = e.parentElement) if (isTarget(e)) return e; return null }
      for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75], [0.15, 0.15], [0.85, 0.85], [0.15, 0.85], [0.85, 0.15]]) {
        const x = r.left + fx * r.width
        const y = r.top + fy * r.height
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue
        const hit = document.elementFromPoint(x, y)
        if (hit && t.el.contains(hit) && owner(hit) === t.el) return { x, y }
      }
      return { covered: true }
    },
    learn: (on) => { dc.learn = on === true; return true },
    guard: (on) => { dc.guard = on === true; return true },
    scope: (selector) => { dc.scope = typeof selector === 'string' ? selector : ''; return true },
    peek: () => dc.mut + dc.reqs,
    take: () => { const s = { mut: dc.mut, reqs: dc.reqs, nav: dc.nav, clip: dc.clip, dialogs: dc.dialogs, errs: dc.errs.slice() }; dc.mut = 0; dc.reqs = 0; dc.nav = 0; dc.clip = 0; dc.dialogs = 0; dc.errs.length = 0; return s },
    open: () => document.querySelectorAll('[role="dialog"],[aria-modal="true"],[role="menu"],[role="listbox"],.kb-overlay,.kb-modal').length
  }
  return true
})()`

/** What a press did: `sample` is `take()` of the page (or null: the page itself was replaced, a navigation). */
export function verdictOf (sample) {
  if (sample === null) return { verdict: 'ok', why: 'the page was reloaded' }
  if (sample.errs.length > 0) return { verdict: 'broken', why: sample.errs[0] }
  const effects = []
  if (sample.mut > 0) effects.push('the page changed')
  if (sample.reqs > 0) effects.push('a request')
  if (sample.nav > 0) effects.push('a navigation')
  if (sample.clip > 0) effects.push('a copy')
  if (sample.dialogs > 0) effects.push('a native dialog')
  return effects.length > 0 ? { verdict: 'ok', why: effects.join(', ') } : { verdict: 'dead', why: 'nothing happened' }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mouse = (page, type, x, y) => page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 })

/**
 * Presses every target of the page that is open, one after the other. `page` is a CDP page (evalJs, send). `restore` puts the page back where it started
 * (re-open it): called when a press changed what the page is (a tab, a filter), or left something open that Escape cannot close.
 * Resolves `{ results: [{ key, label, tag, role, dk, verdict, why }], skipped: [{ label, why }], covered: [label], restores }`.
 */
export async function probePage (page, { max = 120, settleMs = 700, scope = '', restore = async () => {}, onResult = () => {} } = {}) {
  const ev = async (js) => (await page.evalJs(js, 15000)).val
  const install = async () => { await ev(INSTALL_JS); await ev('window.__DC_API.scope(' + JSON.stringify(scope) + ')') }
  await install()
  const frame = async () => {
    await ev('window.__DC_API.learn(true)')
    await sleep(1500)
    await ev('window.__DC_API.learn(false)')
    return (await ev('window.__DC_API.keys()')).filter((t) => t.skip === '').length
  }
  let baseline = await frame()
  let layers = await ev('window.__DC_API.open()')   // what is always on screen (a toast area, a shell layer) is not « something the press opened »
  const tested = new Set()
  const results = []
  const skipped = []
  const covered = []
  let restores = 0
  const quiet = async () => {
    for (let i = 0; i < 8; i++) {
      const before = await ev('window.__DC_API.peek()')
      await sleep(180)
      if ((await ev('window.__DC_API.peek()')) === before) return
    }
  }
  const back = async () => { restores += 1; await restore(); await install(); baseline = await frame(); layers = await ev('window.__DC_API.open()') }
  const closeOverlays = async () => {
    for (let i = 0; i < 2 && (await ev('window.__DC_API.open()')) > layers; i++) {
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await sleep(250)
    }
    return (await ev('window.__DC_API.open()')) <= layers
  }
  while (results.length < max) {
    const keys = await ev('window.__DC_API.keys()')
    if (keys === undefined || keys === null) { await back(); continue }
    const next = keys.find((t) => !tested.has(t.key))
    if (next === undefined) break
    tested.add(next.key)
    if (next.skip !== '') { skipped.push({ label: next.label, why: next.skip }); continue }
    const at = await ev('window.__DC_API.point(' + JSON.stringify(next.key) + ')')
    if (at === null || at === undefined || at.gone === true) continue
    if (at.covered === true) { covered.push(next.label); continue }
    // What the SCROLL (lazy pictures that load) and the HOVER (a hover state, a tooltip) change is not the press: bring the target to the middle, put the mouse on it,
    // wait until the page is quiet, and only then count.
    await mouse(page, 'mouseMoved', at.x, at.y)
    await quiet()
    await ev('window.__DC_API.take()')
    await ev('window.__DC_API.guard(true)')
    await mouse(page, 'mousePressed', at.x, at.y)
    await mouse(page, 'mouseReleased', at.x, at.y)
    await sleep(settleMs)
    const sample = await ev('window.__DC_API ? (window.__DC_API.guard(false), window.__DC_API.take()) : null')
    const { verdict, why } = verdictOf(sample === undefined ? null : sample)
    const row = { key: next.key, label: next.label, tag: next.tag, role: next.role, dk: next.dk, cls: next.cls, verdict, why }
    results.push(row)
    onResult(row)
    // Put the page back: close what opened; if the press changed what the page is (a tab, a filter), or left a layer that does not close, open it again.
    const closed = sample === null ? false : await closeOverlays()
    const count = sample === null ? -1 : (await ev('window.__DC_API.keys()')).filter((t) => t.skip === '').length
    if (sample === null || closed === false || Math.abs(count - baseline) > Math.max(4, Math.round(baseline * 0.3))) await back()
  }
  return { results, skipped, covered, restores }
}
