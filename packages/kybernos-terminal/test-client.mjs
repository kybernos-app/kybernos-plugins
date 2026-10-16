// The terminal's browser half: what the Run button sends and what the output card says (audit A4-17, A4-18).
// The DOM dressing is checked in a real browser (test/verify.py); this is the part that needs no DOM.
//
//   node packages/kybernos-terminal/test-client.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}
const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client', 'client.js'), 'utf8')

let def = null
const window = { __ModuleLoader__: { load: (d) => { def = d } } }
new Function('window', SOURCE)(window)
const mod = def.factory()
const T = mod.__test

console.log('the card')
{
  const c = (r) => T.carteSortie(r)
  check('a clean run says ok, with the output', c({ ok: true, code: 0, stdout: 'hi\n', stderr: '' }).etat === 'ok' && c({ ok: true, code: 0, stdout: 'hi\n', stderr: '' }).texte === 'hi\n')
  check('a run with no output says so', c({ ok: true, code: 0, stdout: '', stderr: '' }).texte === '(no output)')
  check('a failing command: exit code, then its output', c({ ok: true, code: 3, stdout: '', stderr: 'ls: x: No such file' }).texte === 'exit 3\nls: x: No such file' && c({ ok: true, code: 3, stdout: '', stderr: 'e' }).etat === 'err')
  const late = c({ ok: true, code: null, signal: 'SIGTERM', timedOut: true, stdout: '', stderr: '' })
  check('a timeout reads as a timeout, never « exit null »', late.etat === 'err' && late.texte === '— timeout (30 s) —' && !/null/.test(late.texte), late)
  check('...with the output it got before', c({ ok: true, code: null, timedOut: true, stdout: 'a\n', stderr: '' }).texte === '— timeout (30 s) —\na\n')
  const killed = c({ ok: true, code: null, signal: 'SIGKILL', timedOut: false, stdout: '', stderr: '' })
  check('a process killed by a signal says so (no « exit null » either)', killed.texte === 'killed (SIGKILL)' && !/null/.test(killed.texte), killed)
  const cut = c({ ok: true, code: 0, stdout: 'hell', stderr: '', truncated: true })
  check('output the host cut says it was cut', /output cut here/.test(cut.texte) && cut.texte.startsWith('hell'), cut)
  check('a refusal of the host is shown with its reason', c({ ok: false, erreur: 'nope' }).texte === '✗ nope' && c(null).texte === '✗ failed')
}

console.log('what is sent')
{
  const sent = []
  globalThis.fetch = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { json: async () => ({ ok: true, code: 0, stdout: '', stderr: '' }) } }
  await T.lancer('git status', 'session-abc')
  check('the command goes with the session it was clicked in (the host finds its folder)', sent.length === 1 && sent[0].url === '/kybernos-terminal/run' && sent[0].body.commande === 'git status' && sent[0].body.session === 'session-abc', sent)
  check('...and never a path of its own', sent[0].body.cwd === undefined)
  sent.length = 0
  await T.lancer('echo', undefined)
  check('with no session known it sends an empty one (the host then refuses nothing and runs in its default)', sent[0].body.session === '')
}

console.log('the session of the page')
{
  const ctx = (key) => ({ get: (n) => (n === 'uiSession' ? { adapter: { current: { getSnapshot: () => ({ key }) } } } : undefined) })
  check('read from the engine\'s UI session service', T.sessionCourante(ctx('session-xyz')) === 'session-xyz')
  check('a missing or failing service gives \'\', not an exception', T.sessionCourante(undefined) === '' && T.sessionCourante({ get: () => { throw new Error('boom') } }) === '' && T.sessionCourante({ get: () => undefined }) === '')
}

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
