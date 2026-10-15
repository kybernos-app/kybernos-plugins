#!/usr/bin/env node
// DSH's Settings, opened from outside the sidebar: `kbOpenDshSettings` and the guard on DSH's account launcher
// (<kb-open-settings> of client.js), cut out and run alone against a tiny fake DOM. No browser.
//
//   node packages/kybernos-plugin/test-settings-seam.mjs
//
// Pinned here because a plugin that clicked « the trigger of the settings area » to reach Settings got DSH's ACCOUNT popover
// (Settings / Feedback / Sign in) on DSH >= 0.2.1-alpha.2 instead of the dialog. The page-level proof is
// scripts/check-footer-live.mjs; this file holds the decisions: which route is taken, in which order, and what the guard lets by.
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const a = SRC.indexOf('let kbOpeningSettings = false')
const b = SRC.indexOf('// </kb-open-settings>', a)
if (a < 0 || b < a) { console.log('  ✗ cannot cut the settings seam out of client.js'); process.exit(1) }
const BODY = SRC.slice(a, b)

/** A fresh seam over a fake page. `page` describes it; the returned object exposes what happened. */
const load = (page) => {
  const log = { clicks: [], opened: 0, events: [], listeners: [], veils: 0, removedVeils: 0, windowGlobals: {} }
  const mk = (name, extra = {}) => ({
    name,
    getAttribute: (k) => (extra.attrs && extra.attrs[k]) || null,
    querySelectorAll: () => extra.children || [],
    closest: (sel) => (extra.closest && extra.closest[sel]) || null,
    click() { log.clicks.push(name); if (extra.onClick) extra.onClick() },
    ...extra.props,
  })
  const els = {}
  if (page.fiber !== undefined) {
    // launcher > child; each fiber carries memoizedProps and a `return` chain
    const chain = page.fiber.reduceRight((up, props) => ({ memoizedProps: props, return: up }), null)
    const child = mk('launcher-child', { props: { ['__reactFiber$x']: chain } })
    els['[data-slot="settings.launcher"]'] = mk('launcher', { children: [child], props: { ['__reactFiber$x']: null } })
  } else if (page.launcher === true) {
    els['[data-slot="settings.launcher"]'] = mk('launcher', { children: [] })
  }
  if (page.dialogTrigger === true) els['[data-slot="sidebar.settings"] button[aria-haspopup="dialog"]'] = mk('dialog-trigger')
  if (page.legacyTrigger !== undefined) els['[class*="settingsArea"] button[class*="trigger"]'] = mk('legacy-trigger', { attrs: page.legacyTrigger })
  if (page.popoverTrigger === true) {
    els['[data-slot="settings.launcher"] button'] = mk('popover-trigger', {
      attrs: { 'aria-expanded': 'true' },
      onClick: () => { if (page.menuItem === true) els['[role="menu"] [role="menuitem"]'] = mk('menu-item') },
    })
  }
  if (page.footer === true) els['[data-kb="foot-gear"], [data-kb="workspace-card"]'] = mk('footer')
  const document = {
    querySelector: (sel) => els[sel] || null,
    createElement: () => { log.veils += 1; return { textContent: '', remove() { log.removedVeils += 1 } } },
    head: { appendChild() {} },
    addEventListener: (type, fn, capture) => log.listeners.push({ type, fn, capture }),
    removeEventListener: (type, fn) => { log.listeners = log.listeners.filter((l) => !(l.type === type && l.fn === fn)) },
  }
  const window = {
    setTimeout: (fn) => { fn(); return 0 },
    dispatchEvent: (ev) => { log.events.push(ev.type) },
    ...log.windowGlobals,
  }
  const make = new Function('document', 'window', 'Event', 'Array', 'Object', BODY + '\nreturn { kbOpenDshSettings, kbInstallLauncherGuard }')
  const api = make(document, window, class { constructor(type) { this.type = type } }, Array, Object)
  return { api, log, window, els }
}

console.log('the launcher\'s own `openSettings` is the first choice')
{
  let called = 0
  const { api, log } = load({ fiber: [{ unrelated: true }, { openSettings: () => { called += 1 } }, { actions: { open: () => { called += 100 } }, renderSlot: () => null }] })
  check('it is called (and nothing is clicked)', api.kbOpenDshSettings() === true && called === 1 && log.clicks.length === 0, { called, clicks: log.clicks })
}
{
  let called = 0
  const { api } = load({ fiber: [{ foo: 1 }, { actions: { open: () => { called += 1 } }, renderSlot: () => null }] })
  check('the settings root\'s `actions.open` serves when the launcher component is not found', api.kbOpenDshSettings() === true && called === 1, { called })
}
{
  let called = 0
  const { api } = load({ fiber: [{ actions: { open: () => { called += 1 } } }] })
  check('an `actions.open` without the root\'s `renderSlot` is not taken for it', api.kbOpenDshSettings() === false && called === 0, { called })
}
{
  const { api } = load({ fiber: [{ openSettings: () => { throw new Error('boom') } }], dialogTrigger: true })
  check('an opener that throws falls through to the next route', api.kbOpenDshSettings() === true)
}

console.log('without it: the dialog trigger, then the launcher\'s popover')
{
  const { api, log } = load({ launcher: true, dialogTrigger: true })
  check('the shell\'s dialog trigger (rendered when no launcher is registered) is clicked', api.kbOpenDshSettings() === true && log.clicks[0] === 'dialog-trigger', log.clicks)
}
{
  const { api, log } = load({ launcher: true, popoverTrigger: true, menuItem: true })
  const ok = api.kbOpenDshSettings()
  check('the popover route clicks the launcher, then its first entry', ok === true && log.clicks.join() === 'popover-trigger,menu-item', log.clicks)
  check('the popover is kept invisible and the veil is removed', log.veils === 1 && log.removedVeils === 1, { veils: log.veils, removed: log.removedVeils })
}
{
  const { api, log } = load({ launcher: true, popoverTrigger: true, menuItem: false })
  api.kbOpenDshSettings()
  check('no entry showing up: the popover is closed again and the veil removed', log.clicks.join() === 'popover-trigger,popover-trigger' && log.removedVeils === 1, { clicks: log.clicks, removed: log.removedVeils })
}
{
  const { api, log } = load({ legacyTrigger: {} })
  check('an older engine\'s plain trigger (found by its class) still opens the dialog', api.kbOpenDshSettings() === true && log.clicks[0] === 'legacy-trigger', log.clicks)
}
{
  const { api, log } = load({ legacyTrigger: { 'aria-haspopup': 'menu' } })
  check('a class match that is a MENU button is never clicked as « the settings trigger »', api.kbOpenDshSettings() === false && log.clicks.length === 0, log.clicks)
}
{
  const { api } = load({})
  check('nothing at all: false, no error', api.kbOpenDshSettings() === false)
}

console.log('the guard on DSH\'s account launcher')
{
  const inLauncher = { closest: (sel) => (sel === '[data-slot="settings.launcher"]' ? {} : null) }
  const outside = { closest: () => null }
  const ev = (target, isTrusted) => ({ target, isTrusted, prevented: 0, stopped: 0, preventDefault() { this.prevented += 1 }, stopImmediatePropagation() { this.stopped += 1 } })
  const press = (m, e) => { for (const l of m.log.listeners) if (l.type === 'click') l.fn(e) }

  {
    let called = 0
    const m = load({ fiber: [{ openSettings: () => { called += 1 } }], footer: true })
    const dispose = m.api.kbInstallLauncherGuard()
    check('it listens in the capture phase of the document', m.log.listeners.length === 1 && m.log.listeners[0].capture === true && m.log.listeners[0].type === 'click')
    const e = ev(inLauncher, false)
    press(m, e)
    check('a script\'s click on the launcher opens Settings and never reaches the popover', called === 1 && e.prevented === 1 && e.stopped === 1, { called, e })
    const real = ev(inLauncher, true)
    press(m, real)
    check('a real click lands in OUR menu while the Kybernos footer is there', m.log.events.includes('kybernos-cloud:menu') && real.prevented === 1 && real.stopped === 1 && called === 1, { events: m.log.events })
    const elsewhere = ev(outside, true)
    press(m, elsewhere)
    check('a click anywhere else is left alone', elsewhere.prevented === 0 && elsewhere.stopped === 0)
    dispose()
    check('the disposer removes the listener', m.log.listeners.length === 0)
  }
  {
    const m = load({ fiber: [{ openSettings: () => {} }], footer: false })
    m.api.kbInstallLauncherGuard()
    const real = ev(inLauncher, true)
    press(m, real)
    check('a real click is left to DSH when there is no Kybernos footer', real.prevented === 0 && real.stopped === 0 && m.log.events.length === 0)
  }
  {
    // The popover route clicks the launcher itself: the guard must not loop on its own click.
    const m = load({ launcher: true, popoverTrigger: true, menuItem: true })
    m.api.kbInstallLauncherGuard()
    let reentered = 0
    const trigger = m.els['[data-slot="settings.launcher"] button']
    const realClick = trigger.click
    trigger.click = () => { realClick(); const e = ev(inLauncher, false); press(m, e); if (e.prevented === 1) reentered += 1 }
    m.api.kbOpenDshSettings()
    check('its own click on the launcher passes the guard (no loop)', reentered === 0, { reentered })
  }
}

console.log('\n' + pass + ' passed' + (fail > 0 ? ', ' + fail + ' FAILED' : ''))
process.exit(fail > 0 ? 1 : 0)
