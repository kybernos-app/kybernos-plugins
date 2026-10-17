// C-01: the stored colour mode is held through the first 2.5 s of a load (theme-hold.mjs). The script is run as it ships against a small fake
// document: the engine's bootstrap sets « light », the theme store then writes « system » and a dark body (the measured flash), and the script
// must put the bootstrap's state back before anything is painted. After 2.5 s, or when the stored mode is « system », it leaves everything alone.
//   node packages/kybernos-theme/test-theme-hold.mjs
import vm from 'node:vm'
import { HOLD_MS, HOLD_SCRIPT, holdRows } from './theme-hold.mjs'

let fail = 0
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : ' — ' + JSON.stringify(detail)))
  if (!cond) fail += 1
}

/** A page: <html> and <body> with attributes, a mutation observer that queues records until `flush()` (the browser runs it before painting), a clock. */
const page = () => {
  const mk = () => ({ attrs: new Map(), getAttribute (k) { return this.attrs.has(k) ? this.attrs.get(k) : null }, hasAttribute (k) { return this.attrs.has(k) }, setAttribute (k, v) { this.touch(k, String(v)) }, removeAttribute (k) { if (this.attrs.delete(k)) queue.push(1) }, touch (k, v) { if (this.attrs.get(k) !== v) { this.attrs.set(k, v); queue.push(1) } } })
  const queue = []
  const html = mk()
  let body = null
  const clock = { now: 1000 }
  let observers = []
  const timers = []
  class MO {
    constructor (fn) { this.fn = fn; this.on = false; observers.push(this) }
    observe (target, opts) { this.on = true; this.opts = opts }
    disconnect () { this.on = false }
  }
  const ctx = { document: { documentElement: html, get body () { return body } }, MutationObserver: MO, Date: { now: () => clock.now }, setTimeout: (fn, ms) => { timers.push({ fn, at: clock.now + ms }) } }
  vm.runInNewContext(HOLD_SCRIPT, ctx)
  return {
    html,
    makeBody () { body = mk(); return body },
    get body () { return body },
    flush () { if (queue.length === 0) return; queue.length = 0; for (const o of observers) if (o.on) o.fn() },
    advance (ms) { clock.now += ms; for (const t of timers) if (t.at <= clock.now && !t.done) { t.done = true; t.fn() } },
    observing: () => observers.some((o) => o.on),
    opts: () => observers[0].opts,
  }
}
// what DSH's inline bootstrap does at the end of <body>: source on <html>, the dark flag on <body>
const bootstrap = (p, preference, dark) => { p.makeBody(); p.html.setAttribute('data-ds-theme-source', preference); if (dark) p.body.setAttribute('data-ds-dark-theme', ''); p.flush() }

// 1. the measured case: light stored, the engine writes « system » and a dark body about 350 ms in
{
  const p = page()
  bootstrap(p, 'light', false)
  p.advance(340)
  p.html.setAttribute('data-ds-theme-source', 'system'); p.body.setAttribute('data-ds-dark-theme', '')
  p.flush()
  ok('the flash is put back before it is painted: source is « light » again and the body is not dark', p.html.getAttribute('data-ds-theme-source') === 'light' && p.body.hasAttribute('data-ds-dark-theme') === false, [p.html.getAttribute('data-ds-theme-source'), p.body.hasAttribute('data-ds-dark-theme')])
  p.html.setAttribute('data-ds-theme-source', 'light'); p.flush()
  ok('the engine\'s own correct write afterwards changes nothing', p.html.getAttribute('data-ds-theme-source') === 'light' && p.body.hasAttribute('data-ds-dark-theme') === false)
}

// 2. dark stored on a light machine: the same, the other way round
{
  const p = page()
  bootstrap(p, 'dark', true)
  p.advance(350)
  p.html.setAttribute('data-ds-theme-source', 'system'); p.body.removeAttribute('data-ds-dark-theme')
  p.flush()
  ok('« dark » stored: it stays dark through the engine\'s « system » moment', p.html.getAttribute('data-ds-theme-source') === 'dark' && p.body.hasAttribute('data-ds-dark-theme') === true)
}

// 3. the stored mode is « system »: nothing to protect, and the observer lets go at once
{
  const p = page()
  bootstrap(p, 'system', true)
  ok('« system » stored: nothing is held and the observer is gone', p.observing() === false)
  p.html.setAttribute('data-ds-theme-source', 'light'); p.flush()
  ok('a later change is left alone', p.html.getAttribute('data-ds-theme-source') === 'light')
}

// 4. after 2.5 s a person's own choice is never fought
{
  const p = page()
  bootstrap(p, 'light', false)
  p.advance(HOLD_MS + 200)
  ok('the observer is gone once the hold is over', p.observing() === false)
  p.html.setAttribute('data-ds-theme-source', 'dark'); p.body.setAttribute('data-ds-dark-theme', ''); p.flush()
  ok('a choice made after the hold stays', p.html.getAttribute('data-ds-theme-source') === 'dark' && p.body.hasAttribute('data-ds-dark-theme') === true)
  // inside the window, a different source is put back (the same case as 1, seen from the other side)
  const late = page()
  bootstrap(late, 'light', false)
  late.html.setAttribute('data-ds-theme-source', 'dark')
  ok('inside the window a different source is put back', (late.flush(), late.html.getAttribute('data-ds-theme-source')) === 'light')
}

// 5. it watches only the two attributes, anywhere under <html>, and the script cannot break a page
{
  const p = page()
  const opts = p.opts()
  ok('only « data-ds-theme-source » and « data-ds-dark-theme » are watched (the body does not exist yet when the script runs)', opts.attributes === true && opts.subtree === true && opts.attributeFilter.join() === 'data-ds-theme-source,data-ds-dark-theme', opts)
  let threw = null
  try { vm.runInNewContext(HOLD_SCRIPT, { document: {}, MutationObserver: undefined, Date, setTimeout }) } catch (e) { threw = e }
  ok('a page without a mutation observer (or a document that is not one) is left alone: the script cannot throw', threw === null)
}

// 6. the row
{
  const rows = holdRows()
  ok('one head row, an inline script with its own id', rows.length === 1 && rows[0].kind === 'html' && rows[0].placement === 'head' && rows[0].html.startsWith('<script id="kbth-hold">') && rows[0].html.endsWith('</script>'))
  ok('nothing in the script can close the element early, and nothing is fetched', !/<\/script/i.test(HOLD_SCRIPT) && !/fetch|XMLHttpRequest|import\(|src=/.test(HOLD_SCRIPT))
}

console.log(fail === 0 ? '\nOK' : '\n' + fail + ' failure(s)')
process.exit(fail === 0 ? 0 : 1)
