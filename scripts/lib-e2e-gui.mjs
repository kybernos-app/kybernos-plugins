// Helpers to drive a SANDBOX DSH page the way a person does (real mouse and key events through CDP) and to read what the recording proxy saw.
// Used by the teams end-to-end journeys (scripts/check-teams-e2e.mjs). Refuses the real DSH on :3080.
//   const g = await openGui('127.0.0.1:3098')   // DSH_HOME must be the sandbox's (source scripts/sandbox/env.sh)
import { readFileSync, existsSync } from 'node:fs'
import { openLivePage, waitFor } from './live-page.mjs'
import { cookieDeSession } from './cdp-lib.mjs'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const sameModel = (a, b) => typeof a === 'string' && a.trim().toLowerCase() === String(b).trim().toLowerCase()

/** The model button of the composer, as DSH 0.2.1-rc.2 draws it: `<button aria-label="Select model, current GLM">` with the model's name as its label (the name is in a zero-width span, so no
 *  « leaf with this text » lookup can find it: that is what made selectModel return without choosing anything on rc.2). `current` is null when the label has no « current … ». */
export const MODEL_BUTTON_JS = `(() => { const b = document.querySelector('button[aria-label^="Select model"]'); if (!b) return null; const r = b.getBoundingClientRect(); const m = /current\\s+(.+)$/i.exec(b.getAttribute('aria-label') || ''); return { current: m ? m[1].trim() : null, shown: (b.innerText || '').replace(/\\s+/g, ' ').trim(), x: r.x + r.width / 2, y: r.y + r.height / 2, visible: r.width > 2 && r.height > 2 } })()`

/** Makes sure the composer's model is `name`: reads the model button first (nothing is pressed when it already says so), else opens the menu, opens its « Model » row when the engine has one (rc.2), presses the
 *  line, and reads the button back. Resolves true, or THROWS saying what it could not find: a turn run on whatever model the profile holds sends nothing to the replica, and a journey that goes on after a
 *  silent miss only compares empty lists (the 2026-10-24 run of the two-account journeys was void for that). Takes the page helpers (`until`, `leaf`, `mouse`, `modelButton`) so that a test can play it
 *  without a browser. */
export const selectModelOn = async (g, name = 'GLM') => {
  const fail = (why) => { throw new Error(`selectModel(${JSON.stringify(name)}): ${why}`) }
  const button = async () => { const b = await g.modelButton(); return b && b.err === undefined && b.visible === true ? b : null }
  // 1. what the composer says. A page still drawing its composer gets a moment.
  const seen = await g.until(async () => {
    const b = await button()
    if (b !== null) return { b }
    if ((await g.leaf('Select model')) !== null) return { legacyOpener: true }   // older engines: the button reads « Select model » until a model is chosen
    if ((await g.leaf(name)) !== null) return { legacyChosen: true }              // ... and the model's name afterwards
    return null
  }, 3500)
  if (!seen) fail('the composer has no model button (no « Select model, current … » button, no « Select model », no « ' + name + ' »): no composer on this page?')
  if (seen.legacyChosen === true) return true
  const b = seen.b
  if (b !== undefined && (sameModel(b.current, name) || (b.current === null && sameModel(b.shown, name)))) return true
  // 2. another model is chosen (or none): open the menu.
  const at = b !== undefined ? b : await g.leaf('Select model')
  await g.mouse(at.x, at.y)
  await sleep(450)
  let item = await g.until(() => g.leaf(name), 1200)
  if (!item) {
    const row = await g.leaf('Model')   // rc.2: the menu has a « Model » row that opens the list of models
    if (row) { await g.mouse(row.x, row.y); await sleep(500); item = await g.until(() => g.leaf(name), 2500) }
  }
  if (!item) fail('the model menu is open but has no line « ' + name + ' » (the profile has no such model on its routes: read GET /kybernos-cloud/models)')
  await g.mouse(item.x, item.y)
  await sleep(500)
  // 3. read it back: a click that landed elsewhere must not pass for a choice.
  if (b !== undefined) {
    const now = await g.until(async () => { const x = await button(); return x !== null && sameModel(x.current, name) ? x : null }, 2500)
    if (!now) fail('pressed the line, but the model button still says « ' + ((await button()) || {}).current + ' »')
  }
  return true
}

export const openGui = async (host, opts = {}) => {
  if (/:3080$/.test(host)) throw new Error('refusing to drive the real DSH on :3080')
  const live = await openLivePage({ authority: host, width: opts.width || 1400, height: opts.height || 900 })
  const { page } = live
  const g = { host, page, live }
  g.val = async (js) => { const r = await page.evalJs(js, 9000); return r.err !== undefined ? { err: r.err } : r.val }
  g.until = async (fn, ms = 6000, step = 40) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(step) } }
  g.mouse = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }) }
  g.centre = (sel) => g.val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width === 0 ? null : { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  /** Waits until the element exists AND holds still (menus slide in), then clicks it with a real mouse event. */
  g.press = async (sel, ms = 3000) => {
    let last = null
    const c = await g.until(async () => {
      const r = await g.centre(sel)
      if (r === null || r === undefined || r.err !== undefined) { last = null; return null }
      const still = last !== null && last.x === r.x && last.y === r.y
      last = r
      return still ? r : null
    }, ms)
    if (!c) return false
    await g.mouse(c.x, c.y)
    return true
  }
  /** The leaf element whose own text is exactly `text` (last one on the page wins: a menu item over the label it opened from). */
  g.leaf = async (text, { scroll = false } = {}) => {
    const r = await g.val(`(() => { const own = (e) => Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/[⟦⟧]/g, '').trim(); const want = ${JSON.stringify(text)}; const e = Array.from(document.querySelectorAll('*')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && (e.children.length === 0 ? (e.innerText || '').replace(/[⟦⟧]/g, '').trim() === want : own(e) === want) }).pop(); if (!e) return null; if (${scroll}) e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2; const top = document.elementFromPoint(x, y); return JSON.stringify({ x, y, covered: !(top && (top === e || e.contains(top) || top.contains(e))) }) })()`)
    return typeof r === 'string' ? JSON.parse(r) : null
  }
  /** Presses the element with that own text; a row of a long list is scrolled into view first and must not sit under another element. */
  g.pressText = async (text) => {
    let p = await g.leaf(text, { scroll: true })
    if (!p) return false
    await sleep(250)
    p = await g.leaf(text, { scroll: true })
    if (!p || p.covered) return false
    await g.mouse(p.x, p.y)
    return true
  }
  g.exists = async (sel) => (await g.val(`document.querySelector(${JSON.stringify(sel)}) !== null`)) === true
  g.text = (sel) => g.val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? (e.innerText || '').replace(/\\s+/g, ' ').trim() : null })()`)
  g.body = () => g.val('document.body.innerText')
  g.shot = async (path) => { await page.shot(path) }
  g.key = async (k, code, vk) => { for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk || 0, ...(k === 'Enter' && type === 'keyDown' ? { text: '\r' } : {}) }) }
  g.waitFor = (expr, ms) => waitFor(page, expr, ms)
  g.close = () => live.close()

  g.dismissGetStarted = () => g.val(`(() => { const d = Array.from(document.querySelectorAll('[role="dialog"]')).find((x) => /get started/i.test(x.innerText || '')); if (!d) return false; const c = d.querySelector('button[aria-label="Close"]'); if (c) c.click(); return !!c })()`)
  g.reload = async () => {
    await g.val('window.__kbStale = true')
    await page.send('Page.reload', { ignoreCache: true })
    await g.waitFor(`window.__kbStale === undefined && document.readyState === 'complete' && document.querySelector('[data-kb="workspace-card"]') !== null`, 30000)
    await g.dismissGetStarted()
    await sleep(400)
  }

  // ── the account card and its menu ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  g.menuOpen = () => g.exists('.kbfp-menu')
  g.openMenu = async () => { if (await g.menuOpen()) return true; await g.press('[data-kb="workspace-card"] .kbfp-cardmain'); return !!(await g.until(() => g.menuOpen(), 4000)) }
  g.closeMenu = async () => { if (!(await g.menuOpen())) return; await g.key('Escape', 'Escape', 27); await sleep(150); if (await g.menuOpen()) { await g.press('[data-kb="workspace-card"] .kbfp-cardmain'); await g.until(async () => !(await g.menuOpen()), 3000) } }
  g.spaceRows = (scope = '.kbfp-menu') => g.val(`Array.from(document.querySelectorAll(${JSON.stringify(scope + ' [data-kb="space-row"]')})).map((r) => ({ id: r.getAttribute('data-space'), name: (r.querySelector('.kbfp-wsname') || { innerText: '' }).innerText, sub: (r.querySelector('.kbfp-wssub') || { innerText: '' }).innerText, pct: r.getAttribute('data-percent'), current: r.getAttribute('aria-current') === 'true' }))`)
  /** The rows of every space wherever the layout keeps them: in the menu (up to three), else in the « Switch team » list next to it. */
  g.spaceRowsAny = async () => {
    await g.openMenu()
    const inline = await g.spaceRows('.kbfp-menu')
    if (inline.length > 0) return inline
    if (!(await g.exists('.kbfp-sub [data-kb="space-row"]'))) { await g.press('.kbfp-menu [data-kb="menu-switch"]'); await g.until(() => g.exists('.kbfp-sub [data-kb="space-row"]'), 4000) }
    return g.spaceRows('.kbfp-sub')
  }
  g.card = () => g.val(`(() => { const c = document.querySelector('[data-kb="workspace-card"]'); if (!c) return null; return { text: (c.innerText || '').replace(/\\s+/g, ' ').trim(), switching: !!document.querySelector('[data-kb="workspace-card-switching"]') } })()`)
  g.cardName = () => g.text('[data-kb="workspace-card"] .kbfp-cardname')
  /** Opens the menu and clicks the row of a space (inline list); resolves true when it was pressed. */
  /** Opens the menu (and, from four spaces, the « Switch team » list) so that the row of a space can be pressed; resolves its selector. */
  g.prepareRow = async (id) => {
    await g.openMenu()
    const inline = '.kbfp-menu [data-kb="space-row"][data-space="' + id + '"]'
    if (await g.exists(inline)) return inline
    const sub = '.kbfp-sub [data-kb="space-row"][data-space="' + id + '"]'
    if (!(await g.exists('.kbfp-sub [data-kb="space-row"]'))) { await g.press('.kbfp-menu [data-kb="menu-switch"]'); await g.until(() => g.exists('.kbfp-sub [data-kb="space-row"]'), 4000) }
    return sub
  }
  g.pickSpace = async (id) => g.press(await g.prepareRow(id))
  /** Presses « Create a team » or « Join with an invitation link », wherever the layout keeps it (the menu up to three spaces, the list next to it from four). */
  g.pressSpaceAction = async (kind) => {
    await g.openMenu()
    const sel = '[data-kb="space-' + kind + '"]'
    if (await g.exists('.kbfp-menu ' + sel)) return g.press('.kbfp-menu ' + sel)
    if (!(await g.exists('.kbfp-sub ' + sel))) { await g.press('.kbfp-menu [data-kb="menu-switch"]'); await g.until(() => g.exists('.kbfp-sub ' + sel), 4000) }
    return g.press('.kbfp-sub ' + sel)
  }

  /** Picks a space, waits for the card to stop saying « Switching… » and to carry the label, shuts the menu, lets the new chat settle. */
  g.goTo = async (id, label) => {
    const pressed = await g.pickSpace(id)
    await g.until(async () => { const c = await g.card(); return c && !c.switching && label.test(c.text.slice(0, 60)) }, 15000)
    await sleep(900)
    await g.closeMenu()
    await sleep(1200)
    return pressed
  }

  // ── the composer ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  g.composerPos = () => g.val(`(() => { const e = Array.from(document.querySelectorAll('[contenteditable="true"], textarea')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 100 && r.height > 10 }).pop(); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + 40, y: r.y + r.height / 2 } })()`)
  /** Picks `name` in the composer's model button (already chosen: nothing to do). Resolves true, or THROWS saying what it could not find: a turn run on whatever model the profile holds sends
   *  nothing to the replica, and a journey that goes on after a silent miss only compares empty lists (the 2026-10-24 run of the two-account journeys was void for that). */
  g.modelButton = () => g.val(MODEL_BUTTON_JS)
  g.selectModel = (name = 'GLM') => selectModelOn(g, name)
  /** Types into the composer and presses Enter. Resolves the time the Enter key was sent (ms epoch). */
  g.send = async (message, { enter = true } = {}) => {
    const c = await g.until(() => g.composerPos(), 6000)
    if (!c) throw new Error('no composer on the page')
    await g.mouse(c.x, c.y)
    await sleep(150)
    await page.send('Input.insertText', { text: message })
    if (!enter) return null
    await sleep(120)
    const at = Date.now()
    await g.key('Enter', 'Enter', 13)
    return at
  }
  /** The lean variant for timing runs: the composer's position is known, so nothing is looked up between the keys. Resolves the time Enter went. */
  g.sendFast = async (pos, message) => {
    await g.mouse(pos.x, pos.y)
    await page.send('Input.insertText', { text: message })
    const at = Date.now()
    await g.key('Enter', 'Enter', 13)
    return at
  }
  return g
}

/** Reads the recording proxy's log. `since` is a ms epoch. */
export const readProxy = (file, since = 0) => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []).filter((r) => (r.t0 || 0) >= since)
/** The agent's own model calls (they carry tools); title and classification calls are other chat requests. */
export const mainCalls = (rows) => rows.filter((r) => r.method === 'POST' && r.path === '/v1/chat/completions' && /"tools"\s*:\s*\[\s*\{/.test(r.body || ''))
export const chatCalls = (rows) => rows.filter((r) => r.method === 'POST' && r.path === '/v1/chat/completions')
export const bodyOf = (r) => { try { return JSON.parse(r.body) } catch { return null } }
/** All the text a request sends to the model, flattened (system, user, tool messages). */
export const flatten = (r) => { if (!r) return ''; const b = bodyOf(r); return b && Array.isArray(b.messages) ? b.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n') : (r.body || '') }
/** The folder a request says its chat works in; null when there is no request (`mains[0]` of a turn that sent nothing) or it names none. Never throws. */
export const cwdOf = (r) => { const m = flatten(r).match(/Current working directory:\s*"([^"]+)"/); return m ? m[1] : null }
export const NO_AGENT_REQUEST = 'no agent request reached the replica'
/** `cwdOf` for the detail of a check: when there is no request at all it says so, instead of printing a bare null. Not for comparing (the message is not a folder). */
export const cwdOrWhy = (r) => (r ? cwdOf(r) : NO_AGENT_REQUEST)
/** The agent's model calls the replica ANSWERED with 200 (what a journey needs before any of its billing, memory or folder checks mean anything). */
export const agentOk = (rows) => mainCalls(rows).filter((r) => r.status === 200)
export { cookieDeSession, waitFor }
