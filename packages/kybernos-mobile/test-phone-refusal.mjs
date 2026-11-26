#!/usr/bin/env node
/** The phone page and a request the computer refuses for a phone (audit L3-04).
 *
 *  The computer refuses some routes for a phone (settings, credentials, plugins, the server, phones: `refusedOnPhone`) by answering
 *  403 `refused_on_phone`, and its own screen explains those refusals (« 1 demande refusée depuis un téléphone »). The phone only
 *  counted them (`kb.refusals += 1`): a tap on a forbidden surface did nothing the person could see. It now says, in one line apart
 *  from the veil (which is about the connection), « This cannot be done from the phone — do it on the computer. », in French on a
 *  French phone; the line goes away on a tap or by itself.
 *
 *  The page (phone/phone.mjs) runs here for real, in a sandbox with a fake DOM: its module-level code is evaluated as it is (only the
 *  `import` of the end-to-end module is stubbed) and the frames of the computer are handed to its own handler.
 *
 *  Usage: node packages/kybernos-mobile/test-phone-refusal.mjs */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 300))) } }

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(HERE, 'phone', 'phone.mjs'), 'utf8')
const HTML = readFileSync(join(HERE, 'phone', 'index.html'), 'utf8')
const te = new TextEncoder()

/** Loads the page as a browser would, for a phone set to `language`. Gives its handles and the world around it. */
function load (language) {
  const els = new Map()
  const el = () => {
    const listeners = {}
    return {
      hidden: false, textContent: '', dataset: {}, className: '', children: [], contentWindow: {},
      addEventListener (type, fn) { (listeners[type] = listeners[type] || []).push(fn) },
      appendChild (c) { this.children.push(c) },
      click () { for (const fn of listeners.click || []) fn() },
      listeners
    }
  }
  const document = { getElementById: (id) => { if (!els.has(id)) els.set(id, el()); return els.get(id) }, createElement: () => el(), body: { dataset: {} } }
  for (const id of ['veil', 'refusal', 'gate', 'app', 'title', 'sub', 'sas', 'saslabel', 'sasnum', 'locktext', 'actions']) document.getElementById(id)
  document.getElementById('veil').hidden = true
  document.getElementById('refusal').hidden = true
  const timers = []
  const world = {
    window: { addEventListener () {}, location: { origin: 'https://phone.example' } },
    document,
    navigator: { language, userAgent: 'Mozilla/5.0 (Android)' }, // no service worker: main() ends on its "unsupported" screen, which is what we want here
    location: { origin: 'https://phone.example', hash: '', pathname: '/__kb/', protocol: 'https:', host: 'phone.example' },
    history: { replaceState () {} },
    indexedDB: {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms, alive: true }); return timers.length },
    clearTimeout: (id) => { if (typeof id === 'number' && timers[id - 1] !== undefined) timers[id - 1].alive = false }
  }
  const names = Object.keys(world)
  const body = SOURCE.replace(/^import \* as e2e from '[^']+'\n/m, 'const e2e = {}\n') + '\nreturn { onFrameFromComputer, session, kb, show, dropTunnel, STR }\n'
  const handles = new Function(...names, body)(...names.map((n) => world[n]))
  return { ...handles, document, timers, box: document.getElementById('refusal'), veilBox: document.getElementById('veil') }
}
/** What the app's side of the tunnel was given for a request (the page must keep answering the DSH page as before). */
const withPort = (p, id) => { const got = []; p.session.ports.set(id, { postMessage: (m) => got.push(m) }); return got }
const refusedAnswer = (p, id, body, status = 403) => {
  const got = withPort(p, id)
  p.onFrameFromComputer({ t: 'res', id, status, headers: { 'content-type': 'application/json' } }, new Uint8Array(0))
  p.onFrameFromComputer({ t: 'chunk', id }, te.encode(body))
  p.onFrameFromComputer({ t: 'end', id }, new Uint8Array(0))
  return got
}
const REFUSED = JSON.stringify({ ok: false, error: 'refused_on_phone' })

console.log('the page is in place')
check('the document has a line for it, a status region that starts hidden', /<div id="refusal" role="status" hidden><\/div>/.test(HTML) && /#refusal\[hidden\]\s*\{\s*display:\s*none/.test(HTML))
{
  const p = load('en-US')
  check('the page starts without any refusal on screen, on its own screen (the unsupported one: no service worker here)', p.box.hidden === true && p.kb.state === 'error' && p.kb.refusals === 0)
  check('it has strings for both languages', typeof p.STR.refusedPhone === 'string' && p.STR.refusedPhone !== '')
}

console.log('a refused request, as the computer really sends it (403 + { error: "refused_on_phone" })')
{
  const p = load('en-US')
  const got = refusedAnswer(p, 'r1', REFUSED)
  check('English phone: the line appears, and says what to do', p.box.hidden === false && p.box.textContent === 'This cannot be done from the phone — do it on the computer.', [p.box.hidden, p.box.textContent])
  check('...the counter for the debugging page still counts it', p.kb.refusals === 1)
  check('...the DSH page still gets its 403 answer, whole (res, chunk, end)', got.map((m) => m.t).join() === 'res,chunk,end' && got[0].status === 403, got.map((m) => m.t))
  check('...and the veil, which is about the connection, is left alone', p.veilBox.hidden === true && p.veilBox.textContent === '')
  const t = p.timers.filter((x) => x.alive)
  check('...it goes away by itself (one timer, a few seconds)', t.length === 1 && t[0].ms >= 4000 && t[0].ms <= 15000, p.timers.map((x) => [x.ms, x.alive]))
  if (t[0] !== undefined) t[0].fn()
  check('...when the timer ends, the line is gone and empty', p.box.hidden === true && p.box.textContent === '')
}
{
  const p = load('en-US')
  refusedAnswer(p, 'r1', REFUSED)
  p.box.click()
  check('a tap on the line closes it', p.box.hidden === true && p.timers.filter((x) => x.alive).length === 0, [p.box.hidden, p.timers.map((x) => x.alive)])
  refusedAnswer(p, 'r2', REFUSED)
  const first = p.timers.filter((x) => x.alive).length
  refusedAnswer(p, 'r3', REFUSED)
  check('a second refusal while it is up keeps one line and one timer (the clock starts again)', p.box.hidden === false && first === 1 && p.timers.filter((x) => x.alive).length === 1 && p.kb.refusals === 3, p.timers.map((x) => x.alive))
}
{
  const p = load('fr-FR')
  refusedAnswer(p, 'r1', REFUSED)
  check('French phone: the same line in French', p.box.textContent === 'Cette action n\'est pas possible depuis le téléphone — fais-la sur l\'ordinateur.', p.box.textContent)
}
{
  const p = load('es-ES')
  refusedAnswer(p, 'r1', REFUSED)
  check('Spanish phone (no table of ours): English, never French', p.box.textContent === 'This cannot be done from the phone — do it on the computer.', p.box.textContent)
}

console.log('the same frame the page already knew (t: "refused")')
{
  const p = load('en-US')
  p.onFrameFromComputer({ t: 'refused', id: 'x' }, new Uint8Array(0))
  check('a « refused » frame says it too', p.box.hidden === false && /cannot be done from the phone/.test(p.box.textContent) && p.kb.refusals === 1)
}

console.log('what is not a refusal says nothing')
{
  const p = load('en-US')
  refusedAnswer(p, 'a', JSON.stringify({ ok: false, error: 'forbidden' }))
  check('a 403 from DSH itself (another reason): nothing', p.box.hidden === true && p.kb.refusals === 0)
  refusedAnswer(p, 'b', '<html>Forbidden</html>')
  check('a 403 whose body is not JSON: nothing, and no crash', p.box.hidden === true && p.kb.refusals === 0)
  refusedAnswer(p, 'c', REFUSED, 200)
  check('the same words in a 200 answer (a page that quotes them): nothing', p.box.hidden === true && p.kb.refusals === 0)
  refusedAnswer(p, 'd', JSON.stringify({ ok: false, error: 'too_many_requests' }), 429)
  check('another refusal of the computer (429, 413, 503): not this line', p.box.hidden === true)
  // a refusal whose answer is cut by the tunnel going down must not leave a watch behind that a later chunk could trip
  withPort(p, 'e')
  p.onFrameFromComputer({ t: 'res', id: 'e', status: 403, headers: {} }, new Uint8Array(0))
  p.dropTunnel()
  withPort(p, 'e')
  p.onFrameFromComputer({ t: 'chunk', id: 'e' }, te.encode(REFUSED))
  check('after the tunnel dropped, a chunk of an old request shows nothing', p.box.hidden === true && p.kb.refusals === 0)
}

console.log('the line belongs to the DSH page')
{
  const p = load('en-US')
  refusedAnswer(p, 'r1', REFUSED)
  p.show('offline', { title: 't', sub: 's' })
  check('when the page leaves the running view (a connection screen), the line is gone', p.box.hidden === true && p.box.textContent === '' && p.timers.filter((x) => x.alive).length === 0)
}

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
