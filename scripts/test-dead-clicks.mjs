#!/usr/bin/env node
// The dead-click probe (scripts/lib-dead-clicks.mjs) against a page in a real browser where every kind of target is on purpose: the probe must find exactly the
// dead ones and the broken ones, and leave alone what works, what is disabled, what is already selected and what reads as destructive.
//
//   node scripts/test-dead-clicks.mjs
//
// It needs a headless Chrome and nothing else (no DSH, no session: the page is a data: URL). Without Chrome it prints a SKIPPED line and passes, like the other
// tests that need a browser; the pure part (the verdict) is checked either way.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from './cdp-lib.mjs'
import { DESTRUCTIVE, INSTALL_JS, probePage, verdictOf } from './lib-dead-clicks.mjs'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 500)))
  if (!ok) failed += 1
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

console.log('what counts as an effect')
{
  const none = { mut: 0, reqs: 0, nav: 0, clip: 0, dialogs: 0, errs: [] }
  check('nothing at all is dead', verdictOf(none).verdict === 'dead')
  check('a change in the page, a request, a navigation, a copy or a dialog is an effect', ['mut', 'reqs', 'nav', 'clip', 'dialogs'].every((k) => verdictOf({ ...none, [k]: 1 }).verdict === 'ok'))
  check('an uncaught error is broken, even when something else changed', verdictOf({ ...none, mut: 3, errs: ['openIt is not a function'] }).verdict === 'broken' && verdictOf({ ...none, errs: ['x'] }).why === 'x')
  check('a page that was replaced (a reload) is an effect', verdictOf(null).verdict === 'ok')
  check('the deny-list reads « Delete », « Sign out », « Supprimer » and not « Details »', ['Delete', 'Sign out', 'Remove this account', 'Supprimer', 'Déconnecter'].every((l) => DESTRUCTIVE.test(l)) && !['Details', 'Install', 'Create a skill', 'Use'].some((l) => DESTRUCTIVE.test(l)))
}

const CHROMES = [process.env.KB_CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter((p) => typeof p === 'string' && p !== '')
const chromePath = CHROMES.find((p) => existsSync(p))
if (chromePath === undefined) {
  console.log('SKIPPED: no Chrome here — the probe is not played against its fixture page (set KB_CHROME)')
  process.exit(failed === 0 ? 0 : 1)
}

const FIXTURE = `<!doctype html><meta charset="utf-8"><title>fixture</title><style>
  body{font:14px system-ui;margin:16px}
  article{border:1px solid #888;padding:12px;margin:8px 0;width:320px;cursor:pointer}
  .hov{opacity:0} article:hover .hov{opacity:1}
  .row{margin:6px 0}
</style>
<aside><button onclick="document.getElementById('log').append('side')">Menu row outside the scope</button></aside>
<main id="main">
<div id="log"></div>
<div class="row"><button onclick="document.getElementById('log').append('x')">Works</button></div>
<div class="row"><button>Does nothing</button></div>
<article role="button" tabindex="0" data-kb="dead-card"><p>Dead card text</p><button class="hov" onclick="openIt()">Throws</button></article>
<article role="button" tabindex="0" data-kb="good-card" onclick="document.getElementById('log').append('open')"><p>Good card text</p><button onclick="event.stopPropagation();document.getElementById('log').append('i')">Installs</button></article>
<div class="row" style="cursor:pointer;padding:8px" onclick="document.getElementById('log').append('p')">Pointer works</div>
<div class="row" style="cursor:pointer;padding:8px">Pointer dead</div>
<div class="row"><button onclick="fetch('/x', { method: 'POST' }).catch(() => {})">Sends a request</button></div>
<div class="row"><button disabled>Switched off</button></div>
<div class="row"><button role="tab" aria-selected="true">Current tab</button></div>
<div class="row"><button class="seg on">Current segment</button> <button aria-pressed="true">Pressed segment</button> <button class="chip chip-on">Current chip</button> <button class="kb-sw kb-sw-on">A switch with an on class</button></div>
<div class="row"><a href="https://example.com/x">Leaves the app</a></div>
<div class="row"><button>Delete everything</button></div>
<div class="row"><button onclick="window.open('/y')">Opens a tab</button></div>
<div class="row"><button onclick="alert('hi')">Alerts</button></div>
<div class="row"><button role="switch" aria-checked="true">A switch that is on and dead</button></div>
<div class="row"><input type="checkbox"> <input type="text" value="a field"></div>
<div class="row"><span id="clock"></span> <button>Dead beside a clock</button> <button onclick="document.getElementById('log').append('c')">Works beside a clock</button></div>
<div class="row" onmouseenter="document.getElementById('log').append('hover')"><button>Dead with a hover effect</button></div>
<div class="row"><button onmousedown="document.documentElement.setAttribute('data-input-modality', 'pointer' + Date.now())">Dead, but the shell marks the input</button></div>
<div class="row"><button>Dead beside a poll</button> <button onclick="fetch('/other').catch(() => {})">Fetches something new</button></div>
</main>
<script>setInterval(() => { document.getElementById('clock').textContent = String(Date.now()) }, 100); setInterval(() => { fetch('/poll').catch(() => {}) }, 120)</script>`

const freePort = (from) => new Promise((resolve) => {
  const tryPort = (p) => { const s = createServer(); s.once('error', () => tryPort(p + 1)); s.listen(p, '127.0.0.1', () => s.close(() => resolve(p))) }
  tryPort(from)
})
const port = await freePort(9460)
const profile = mkdtempSync(join(tmpdir(), 'kb-deadclick-'))
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check', '--window-size=900,900', 'about:blank'], { stdio: 'ignore' })
let page = null
try {
  let target = null
  for (let i = 0; i < 60 && target === null; i++) {
    await sleep(400)
    try { target = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find((t) => t.type === 'page') || null } catch (e) { /* starting */ }
  }
  if (target === null) { console.log('SKIPPED: Chrome did not start — the probe is not played against its fixture page'); process.exit(failed === 0 ? 0 : 1) }
  page = await connect(target)
  await page.send('Page.enable', {})
  await page.send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(FIXTURE) })
  await sleep(800)

  console.log('a page with every kind of target')
  await page.evalJs(INSTALL_JS, 8000)
  let restored = 0
  const res = await probePage(page, { settleMs: 450, scope: '#main', restore: async () => { restored += 1 } })
  const by = (label) => res.results.find((r) => r.label.startsWith(label))
  const verdict = (label) => { const r = by(label); return r === undefined ? 'not pressed' : r.verdict }
  check('a button with a handler is ok', verdict('Works') === 'ok' && by('Works').why.includes('changed'), res.results.map((r) => r.label + ':' + r.verdict))
  check('a button with no handler is DEAD', verdict('Does nothing') === 'dead')
  check('a card with a role, a tab stop, a hand cursor and no handler is DEAD (the bug of 2026-10-23)', res.results.some((r) => r.dk === 'dead-card' && r.verdict === 'dead'), res.results.map((r) => r.dk + ':' + r.verdict))
  check('the button nested in it that throws is BROKEN, with the error', verdict('Throws') === 'broken' && by('Throws').why.includes('openIt'), by('Throws'))
  check('a card with a handler is ok when pressed on its text, and its nested button is ok on its own', res.results.some((r) => r.dk === 'good-card' && r.verdict === 'ok') && verdict('Installs') === 'ok')
  check('an element that only shows a hand cursor is a target: dead without a handler, ok with one', verdict('Pointer works') === 'ok' && verdict('Pointer dead') === 'dead')
  check('a request alone, a window.open alone and a native dialog alone are effects', verdict('Sends a request') === 'ok' && by('Sends a request').why.includes('request') && verdict('Opens a tab') === 'ok' && verdict('Alerts') === 'ok')
  check('a switch that is on is pressed like any other, and found dead here', verdict('A switch that is on') === 'dead')
  check('next to something that changes by itself (a clock) a dead button is still dead and a working one still ok', verdict('Dead beside a clock') === 'dead' && verdict('Works beside a clock') === 'ok')
  check('a request the page was already making by itself is no effect (dead stays dead), a new one is', verdict('Dead beside a poll') === 'dead' && verdict('Fetches something new') === 'ok')
  check('what the HOVER changes is not the press: a dead button on a row that reacts to the mouse stays dead', verdict('Dead with a hover effect') === 'dead')
  check('the mark the shell puts on <html> for the kind of input (pointer, keyboard) is not an effect of the press', verdict('Dead, but the shell marks') === 'dead')
  check('what is outside the scope is not pressed', by('Menu row') === undefined && !res.skipped.some((s) => s.label.startsWith('Menu row')))
  const why = (label) => (res.skipped.find((s) => s.label.startsWith(label)) || {}).why
  check('disabled, already selected, leaving the app and destructive are skipped, with the reason', why('Switched off') === 'disabled' && why('Current tab') === 'already selected' && why('Leaves the app') === 'leaves the app' && why('Current segment') === 'looks like the current one' && why('Pressed segment') === 'already pressed' && why('Current chip') === 'looks like the current one' && why('A switch with an on class') === undefined && why('Delete everything') === 'reads as destructive', res.skipped)
  check('they were not pressed, and a form field is not a target at all', ['Switched off', 'Current tab', 'Leaves the app', 'Delete everything'].every((l) => by(l) === undefined) && !res.results.concat(res.skipped).some((r) => /checkbox|a field/.test(r.label)))
  check('exactly the dead and the broken ones are reported', res.results.filter((r) => r.verdict !== 'ok').map((r) => r.label).sort().join('|') === ['A switch that is on and dead', 'Dead beside a clock', 'A switch with an on class', 'Dead beside a poll', 'Dead with a hover effect', 'Dead, but the shell marks the input', 'Does nothing', 'Dead card text Throws', 'Pointer dead', 'Throws'].sort().join('|'), res.results.filter((r) => r.verdict !== 'ok').map((r) => r.label))
  check('the page was never reopened: nothing here changes what the page is', res.restores === 0 && restored === 0, res.restores)
} finally {
  try { if (page !== null) { await Promise.race([page.send('Browser.close', {}), sleep(2000)]); page.close() } } catch (e) { /* gone */ }
  try { chrome.kill() } catch (e) { /* gone */ }
  await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch (e) { /* busy */ }
}
console.log('\n' + (failed === 0 ? 'all good' : failed + ' check(s) failed'))
process.exit(failed === 0 ? 0 : 1)
