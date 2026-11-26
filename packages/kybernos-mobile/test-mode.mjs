// kybernos-mobile, the display MODE (owner's list items 35, 36, 37): the resolver and its order, the head script, the per-account store and the route.
//   node packages/kybernos-mobile/test-mode.mjs
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import {
  MODE_ATTR, MODE_CLASS, MODE_CSS, MODE_CSS_ID, MODE_EARLY_SCRIPT, MODE_PREF_ATTR, MODE_PREFS, MODE_ROUTE, MODE_SOURCE_ATTR, MODE_STORAGE_KEY, bootMode, cleanDoc, cleanPref, modeRows
} from './mode.mjs'
import { MODE_FILE, NEVER, modePath, parseBody, readMode, writeMode } from './mode-store.mjs'
import { MODE_FS, serveMode } from './index.js'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'
sessionSource.secret = () => SESSION_SECRET

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 400)))
  if (!ok) failed += 1
}
const here = fileURLToPath(new URL('.', import.meta.url))
const CLIENT = readFileSync(join(here, 'client.js'), 'utf8')

// ── a window that stands for the page ──
const APP = 'Mozilla/5.0 (Linux; Android 16) Chrome/130.0 Mobile Safari/537.36 KybernosHost/0.1.0 (android)'
const SHELL_SIMPLE = APP + ' KabyMode/1'
const BROWSER_PHONE = 'Mozilla/5.0 (Linux; Android 16) Chrome/130.0 Mobile Safari/537.36'
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36'
const fakeWindow = ({ ua, touch = false, points = touch ? 5 : 0, stored, throwStorage = false, width = 390, host }) => {
  const classes = new Set()
  const attrs = new Map()
  return {
    navigator: { userAgent: ua, maxTouchPoints: points },
    innerWidth: width,
    __KB_MODE_HOST__: host,
    matchMedia: (q) => ({ matches: q === '(pointer: coarse)' ? touch : false }),
    localStorage: { getItem: (k) => { if (throwStorage) throw new Error('blocked'); return k === MODE_STORAGE_KEY && stored !== undefined ? stored : null } },
    document: { documentElement: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) }, setAttribute: (k, v) => attrs.set(k, String(v)), getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null) } },
    classes, attrs
  }
}
const run = (o) => { const w = fakeWindow(o); const r = bootMode(w); return { r, w } }
const pref = (p) => JSON.stringify({ v: 1, pref: p, at: 1 })

console.log('what a person can choose')
{
  check('three choices, Auto first', MODE_PREFS.join() === 'auto,simple,complete')
  check('the shell\'s word for Complete is accepted, anything else is not a choice', cleanPref('advanced') === 'complete' && cleanPref(' Simple ') === 'simple' && cleanPref('AUTO') === 'auto' && cleanPref('kaby') === null && cleanPref(3) === null && cleanPref(null) === null)
  check('a stored document is {v, pref, at}; a bad one is nothing', JSON.stringify(cleanDoc({ pref: 'simple', at: 12.9, extra: 1 })) === '{"v":1,"pref":"simple","at":12}' && cleanDoc({ pref: 'x' }) === null && cleanDoc([]) === null && cleanDoc(null) === null && cleanDoc({ pref: 'auto', at: -3 }).at === 0 && cleanDoc({ pref: 'auto', at: 1e99 }).at === 0)
}

console.log('the order: an explicit choice, the shell\'s word, a touch device, Complete')
{
  const cases = [
    // [name, options, expected mode, expected source]
    ['nothing chosen, a computer: Complete', { ua: DESKTOP }, 'complete', 'default'],
    ['nothing chosen, a computer with a touch screen but a mouse as the main pointer: still Complete', { ua: DESKTOP, points: 10, touch: false }, 'complete', 'default'],
    ['nothing chosen, a touch phone in a browser: Simple', { ua: BROWSER_PHONE, touch: true }, 'simple', 'touch'],
    ['a narrow window on a computer is NOT a phone: Complete (the width is never read)', { ua: DESKTOP, width: 380 }, 'complete', 'default'],
    ['a touch screen with no touch points reported is not touch', { ua: BROWSER_PHONE, touch: true, points: 0 }, 'complete', 'default'],
    ['inside the app, the shell says Simple (KabyMode): Simple', { ua: SHELL_SIMPLE, touch: true }, 'simple', 'shell'],
    ['inside the app, the shell says nothing (an app used before the switch): Complete, even on a touch phone', { ua: APP, touch: true }, 'complete', 'shell'],
    ['Simple chosen on a computer: Simple', { ua: DESKTOP, stored: pref('simple') }, 'simple', 'choice'],
    ['Complete chosen on a touch phone: Complete', { ua: BROWSER_PHONE, touch: true, stored: pref('complete') }, 'complete', 'choice'],
    ['Complete chosen inside the app whose shell says Simple: Complete', { ua: SHELL_SIMPLE, touch: true, stored: pref('complete') }, 'complete', 'choice'],
    ['Simple chosen inside the app whose shell says nothing: Simple', { ua: APP, touch: true, stored: pref('simple') }, 'simple', 'choice'],
    ['Auto chosen is the same as nothing chosen: touch phone', { ua: BROWSER_PHONE, touch: true, stored: pref('auto') }, 'simple', 'touch'],
    ['« advanced » stored by an older shell reads as Complete', { ua: SHELL_SIMPLE, stored: JSON.stringify({ v: 1, pref: 'advanced', at: 1 }) }, 'complete', 'choice'],
    ['a stored value we do not know is Auto', { ua: DESKTOP, stored: JSON.stringify({ v: 1, pref: 'kaby', at: 1 }) }, 'complete', 'default'],
    ['a stored text that is not JSON is Auto', { ua: BROWSER_PHONE, touch: true, stored: '{not json' }, 'simple', 'touch'],
    ['storage that throws is Auto', { ua: BROWSER_PHONE, touch: true, throwStorage: true }, 'simple', 'touch'],
    ['the app\'s token without a platform is not the app (a browser that only carries the words)', { ua: DESKTOP + ' KabyMode/1' }, 'complete', 'default'],
    ['KabyMode/0 is off', { ua: APP + ' KabyMode/0' }, 'complete', 'shell'],
  ]
  for (const [name, o, mode, source] of cases) {
    const { r, w } = run(o)
    check(name, r.mode === mode && r.source === source && w.classes.has(MODE_CLASS) === (mode === 'simple') && w.attrs.get(MODE_ATTR) === mode && w.attrs.get(MODE_SOURCE_ATTR) === source, { r, classes: [...w.classes] })
  }
  // the account's choice the host puts in the head
  const hostCases = [
    ['the account says Simple, the page has no copy (the phone\'s engine changed its port): Simple', { ua: DESKTOP, host: { pref: 'simple', at: 5 } }, 'simple', 'choice'],
    ['the account says Complete, the page copy is older: the account wins', { ua: DESKTOP, stored: JSON.stringify({ v: 1, pref: 'simple', at: 3 }), host: { pref: 'complete', at: 5 } }, 'complete', 'choice'],
    ['the page copy is newer than the account\'s: the page wins (a choice made here a moment ago)', { ua: DESKTOP, stored: JSON.stringify({ v: 1, pref: 'simple', at: 9 }), host: { pref: 'complete', at: 5 } }, 'simple', 'choice'],
    ['the same moment: the account wins', { ua: DESKTOP, stored: JSON.stringify({ v: 1, pref: 'simple', at: 5 }), host: { pref: 'complete', at: 5 } }, 'complete', 'choice'],
    ['the account says Auto and the page copy is older: Auto (touch phone: Simple)', { ua: BROWSER_PHONE, touch: true, stored: JSON.stringify({ v: 1, pref: 'complete', at: 1 }), host: { pref: 'auto', at: 5 } }, 'simple', 'touch'],
    ['a host value that is not an object or has no word is ignored', { ua: DESKTOP, host: 'simple' }, 'complete', 'default'],
    ['a host word we do not know is Auto', { ua: DESKTOP, host: { pref: 'kaby', at: 5 } }, 'complete', 'default'],
  ]
  for (const [name, o, mode, source] of hostCases) { const { r } = run(o); check(name, r.mode === mode && r.source === source, r) }
  const a = run({ ua: DESKTOP, stored: pref('simple') })
  check('the chosen word is written on <html> too (data-kb-mode-pref), so that a page can say « Auto » when it is Auto', a.w.attrs.get(MODE_PREF_ATTR) === 'simple' && run({ ua: DESKTOP }).w.attrs.get(MODE_PREF_ATTR) === 'auto')
  const w = fakeWindow({ ua: DESKTOP, stored: pref('complete') }); w.classes.add(MODE_CLASS); bootMode(w)
  check('resolving again takes the class off when the answer is Complete', !w.classes.has(MODE_CLASS))
  check('a window with no document does not throw and answers Complete', (() => { try { const r = bootMode({}); return r.mode === 'complete' && r.source === 'default' } catch (e) { return false } })())
  check('the resolver never reads the width of the window (a computer is not a mobile preset)', !/innerWidth|clientWidth|outerWidth|screen\./.test(bootMode.toString()) && !/min-width|max-width/.test(bootMode.toString()))
}

console.log('the head script')
{
  check('it is one self-contained call, and nothing in it can close the script tag', /^\(function\(\)\{var bootMode=function/.test(MODE_EARLY_SCRIPT) && !/<\/script|<!--/i.test(MODE_EARLY_SCRIPT))
  const rows = modeRows()
  check('the head rows are the sheet\'s stylesheet, then one script', rows.length === 2 && rows.every((r) => r.kind === 'html' && r.placement === 'head') && rows[0].html === '<style id="' + MODE_CSS_ID + '">' + MODE_CSS + '</style>' && rows[1].html === '<script>' + MODE_EARLY_SCRIPT + '</script>')
  check('the sheet\'s rules carry no colour of their own (page tokens, then system colours) and cannot close the style tag', !/#[0-9a-fA-F]{3,8}\b/.test(MODE_CSS) && !/<\/style/i.test(MODE_CSS) && /\.kbmob-modesheet\{/.test(MODE_CSS) && /@media \(min-width:701px\)/.test(MODE_CSS))
  const given = modeRows({ v: 1, pref: 'simple', at: 12 })[1].html
  check('the account\'s choice goes in the head before the resolver, as a word and a number only', given === '<script>window.__KB_MODE_HOST__={pref:"simple",at:12};' + MODE_EARLY_SCRIPT + '</script>')
  check('nothing chosen yet (at 0), or a document that is not one, adds nothing', modeRows(NEVER)[1].html === rows[1].html && modeRows({ pref: 'x', at: 3 })[1].html === rows[1].html && modeRows(null)[1].html === rows[1].html)
  check('what the file holds is cleaned before it is written into a page: a hostile word never reaches the head', !/evil|alert/.test(modeRows({ v: 1, pref: '</script><script>alert(1)//', at: 3 })[1].html) && !/evil|alert/.test(modeRows({ v: 1, pref: 'simple', at: '1;alert(1)' })[1].html))
  const same = (o) => {
    const w1 = fakeWindow(o)
    const r1 = bootMode(w1)
    const w2 = fakeWindow(o)
    vm.runInNewContext(MODE_EARLY_SCRIPT, { window: w2 })
    return JSON.stringify([r1.mode, [...w1.classes], [...w1.attrs]]) === JSON.stringify([r1.mode, [...w2.classes], [...w2.attrs]])
  }
  const matrix = []
  for (const ua of [DESKTOP, BROWSER_PHONE, APP, SHELL_SIMPLE]) for (const touch of [false, true]) for (const stored of [undefined, pref('auto'), pref('simple'), pref('complete')]) matrix.push({ ua, touch, stored })
  check('the script in the head does exactly what the function does, on every user agent, touch and choice (' + matrix.length + ' cases)', matrix.every(same), matrix.filter((o) => !same(o)).slice(0, 2))
  const MARKED = /\/\/ <kb-mode-boot>\n([\s\S]*?)\n\s*\/\/ <\/kb-mode-boot>/.exec(CLIENT)
  const norm = (t) => t.replace(/\s+/g, ' ').replace(/ ?([{}();,=:?|&<>!+]) ?/g, '$1').trim()
  const fn = bootMode.toString().replace(/^function bootMode/, 'function')
  check('the browser half carries the same resolver for a page that refuses inline scripts (a marked copy in client.js, equal after the blanks)', MARKED !== null && norm(MARKED[1]).indexOf(norm('const bootMode = ' + fn)) === 0, MARKED === null ? 'no <kb-mode-boot> block in client.js' : norm(MARKED[1]).slice(0, 160))
}

console.log('the store: one file in the account\'s DSH folder')
{
  const disk = new Map()
  const fs = { readFile: (p) => { if (!disk.has(p)) throw new Error('ENOENT'); return disk.get(p) }, writeFile: (p, t, m) => { disk.set(p, t); disk.set(p + '#mode', m) }, rename: (a, b) => { disk.set(b, disk.get(a)); disk.delete(a) }, mkdir: () => {} }
  const path = modePath('/home/x/.dsh', (...p) => p.join('/'))
  check('the file is kybernos/mobile-mode.json under the DSH folder', path === '/home/x/.dsh/kybernos/' + MODE_FILE && MODE_FILE === 'mobile-mode.json')
  check('an account that never chose is Auto, at 0', JSON.stringify(readMode(path, fs)) === JSON.stringify(NEVER) && NEVER.pref === 'auto' && NEVER.at === 0)
  const r1 = writeMode(path, { pref: 'simple', at: 100 }, fs)
  check('a choice is written (0600, atomically: temp file then rename) and read back', r1.ok && r1.applied && readMode(path, fs).pref === 'simple' && readMode(path, fs).at === 100 && disk.get(path + '#mode') === undefined && [...disk.keys()].every((k) => !/\.tmp$/.test(k)))
  const r2 = writeMode(path, { pref: 'complete', at: 50 }, fs)
  check('an older choice does not undo a newer one (answers with the one in force)', r2.ok && r2.applied === false && r2.doc.pref === 'simple' && readMode(path, fs).pref === 'simple')
  const r3 = writeMode(path, { pref: 'complete', at: 200 }, fs)
  check('a newer choice replaces it', r3.applied === true && readMode(path, fs).pref === 'complete')
  check('the same moment is accepted (the last write of a tab)', writeMode(path, { pref: 'auto', at: 200 }, fs).applied === true && readMode(path, fs).pref === 'auto')
  check('a body that is not a choice changes nothing', writeMode(path, { pref: 'kaby' }, fs).ok === false && writeMode(path, null, fs).ok === false && writeMode(path, 'simple', fs).ok === false && readMode(path, fs).pref === 'auto')
  check('a missing moment is « now »', writeMode(path, { pref: 'simple' }, fs, () => 999999).doc.at === 999999)
  const bad = new Map([[path, '{"v":1,"pref":"nope"}']])
  check('a damaged file is Auto, never an error', readMode(path, { readFile: (p) => bad.get(p) }).pref === 'auto' && readMode(path, { readFile: () => { throw new Error('x') } }).pref === 'auto')
  check('a disk that refuses the write answers « not saved » and keeps what was there', (() => { const r = writeMode(path, { pref: 'complete', at: 5e12 }, { ...fs, writeFile: () => { throw new Error('EACCES') } }); return r.ok === false && r.error === 'not-saved' })())
  check('a body is at most 1 KB of one JSON object', parseBody('{"pref":"simple"}') !== null && parseBody('[1]') === null && parseBody('x') === null && parseBody('{"pref":"' + 'a'.repeat(1100) + '"}') === null && parseBody(3) === null)
}

console.log('the route')
{
  const disk = new Map()
  const fs = { readFile: (p) => { if (!disk.has(p)) throw new Error('ENOENT'); return disk.get(p) }, writeFile: (p, t) => disk.set(p, t), rename: (a, b) => { disk.set(b, disk.get(a)); disk.delete(a) }, mkdir: () => {} }
  const call = (method, { origin = 'http://127.0.0.1:3080', host = '127.0.0.1:3080', body, cookie = sessionCookie('127.0.0.1:3080'), extra = {} } = {}) => new Promise((resolve) => {
    const req = new EventEmitter()
    req.method = method
    req.headers = { host, ...(origin === null ? {} : { origin }), ...(cookie === null ? {} : { cookie }), ...extra }
    req.socket = { localPort: 3080 }
    const res = { writeHead: (s, h) => { res.status = s; res.headers = h }, end: (t) => resolve({ status: res.status, headers: res.headers, json: t ? JSON.parse(t) : null }) }
    serveMode(req, res, { fs, home: '/h' })
    if (method === 'POST') setImmediate(() => { if (body !== undefined) req.emit('data', body); req.emit('end') })
  })
  check('the route is /kybernos-mobile/mode', MODE_ROUTE === '/kybernos-mobile/mode')
  check('the default fs of the host is the real disk functions', typeof MODE_FS.readFile === 'function' && typeof MODE_FS.rename === 'function')
  const a = await call('GET', { origin: null })
  check('a read with no Origin answers Auto, at 0, no-store', a.status === 200 && a.json.ok === true && a.json.pref === 'auto' && a.json.at === 0 && a.headers['cache-control'] === 'no-store')
  const b = await call('POST', { body: JSON.stringify({ pref: 'simple', at: 10 }) })
  check('a same-origin write stores the choice', b.status === 200 && b.json.ok === true && b.json.applied === true && b.json.pref === 'simple' && JSON.parse(disk.get('/h/kybernos/mobile-mode.json')).pref === 'simple')
  check('and a read gives it back', (await call('GET')).json.pref === 'simple')
  check('a write with no Origin is refused', (await call('POST', { origin: null, body: '{"pref":"complete"}' })).status === 403)
  check('a write from another origin is refused', (await call('POST', { origin: 'https://evil.example', body: '{"pref":"complete"}' })).status === 403)
  // The route is a write of the account: the page's Origin alone is forgeable by any program on the machine, so DSH's signed session is needed too.
  const noCookie = await call('POST', { cookie: null, body: '{"pref":"complete","at":50}' })
  check('a write with the right Origin and no session cookie is refused (401) and stores nothing', noCookie.status === 401 && noCookie.json.ok === false && JSON.parse(disk.get('/h/kybernos/mobile-mode.json')).pref === 'simple')
  check('a cookie signed with another secret is refused (401)', (await call('POST', { cookie: sessionCookie('127.0.0.1:3080', { secret: OTHER_SECRET }), body: '{"pref":"complete","at":50}' })).status === 401)
  check('an expired cookie is refused (401)', (await call('POST', { cookie: sessionCookie('127.0.0.1:3080', { expiresAt: Date.now() - 1000 }), body: '{"pref":"complete","at":50}' })).status === 401)
  check('a cookie of another listener (another port) is refused (401)', (await call('POST', { cookie: sessionCookie('127.0.0.1:9999'), body: '{"pref":"complete","at":50}' })).status === 401)
  check('a write that came through the phone link is refused (403 refused_on_phone)', (await call('POST', { extra: { 'x-kybernos-tunnel': '1' }, body: '{"pref":"complete","at":50}' })).json.error === 'refused_on_phone')
  check('a secret that cannot be read keeps the write closed (503)', await (async () => { const was = sessionSource.secret; sessionSource.secret = () => null; try { return (await call('POST', { body: '{"pref":"complete","at":50}' })).status === 503 } finally { sessionSource.secret = was } })())
  check('none of the refusals changed the stored choice', JSON.parse(disk.get('/h/kybernos/mobile-mode.json')).pref === 'simple')
  check('a read needs no cookie (it is behind the Host fence and the Origin, like the style sheet)', (await call('GET', { cookie: null })).status === 200)
  check('a read from another origin is refused', (await call('GET', { origin: 'https://evil.example' })).status === 403)
  check('a request whose Host is another name is refused (a page that rebinds its own name)', (await call('GET', { host: 'evil.example:3080' })).status === 403)
  check('a body that is not a choice is a 400 and changes nothing', (await call('POST', { body: '{"pref":"kaby"}' })).status === 400 && (await call('GET')).json.pref === 'simple')
  check('a body that is not JSON is a 400', (await call('POST', { body: 'x' })).status === 400)
  check('a body over 1 KB is a 400', (await call('POST', { body: '{"pref":"simple","pad":"' + 'a'.repeat(2000) + '"}' })).status === 400)
  check('another method is a 405', (await call('DELETE')).status === 405)
}

console.log('the pages that wire it')
{
  const INDEX = readFileSync(join(here, 'index.js'), 'utf8')
  check('the host mounts the route on every engine (before the phone-only return) and puts the head row in every index render', /MODE_ROUTE, handler: \(req, res\) => serveMode/.test(INDEX) && INDEX.indexOf('MODE_ROUTE, handler') < INDEX.indexOf('NOTICES_ROUTE, handler') && /table\.push\(\.\.\.modeRows\(readMode\(/.test(INDEX))
  const PKG = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
  check('the bundle still starts DSH on its own (index.js has no import beyond node: and its own files)', /^export const name = 'kybernos-mobile'/m.test(INDEX) && PKG.exports['.'] === './index.js')
}

console.log(failed === 0 ? '\nall passed' : '\n' + failed + ' FAILED')
process.exit(failed === 0 ? 0 : 1)
