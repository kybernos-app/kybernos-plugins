#!/usr/bin/env node
/** The phone page's two installable apps (study of 2026-10-19): « Kybernos à distance » at /__kb/ and « Kaby » at /__kb/kaby/.
 *
 *  Source-level: the two manifests are two distinct apps of one origin (own `id`, `start_url` and `scope`, the start inside the scope), the two
 *  pages differ only where the app does, nothing is inline or off-origin (the page is the code that holds the keys), the strings exist in both
 *  languages, and the service worker still takes only `/` and lets the whole `/__kb` shell through. The behaviour (offer, paste, Kaby's chat) is
 *  played on the real GUI by `node scripts/check-phone-apps-live.mjs`.
 *
 *  Usage: node packages/kybernos-mobile/test-phone-apps.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), 'phone')
const read = (f) => readFileSync(join(dir, f), 'utf8')
let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

// The icons the server draws (kybernos-server, src/modules/remote/icons.ts): the only PNGs a manifest may name.
const DRAWN = new Set(['/__kb/icon-192.png', '/__kb/icon-512.png', '/__kb/icon-180.png', '/__kb/kaby-192.png', '/__kb/kaby-512.png', '/__kb/kaby-180.png'])

const remote = JSON.parse(read('manifest.webmanifest'))
const kaby = JSON.parse(read('kaby.webmanifest'))

{
  assert.notEqual(remote.id, kaby.id, 'two apps: two ids')
  assert.equal(remote.id, '/__kb/')
  assert.equal(kaby.id, '/__kb/kaby/')
  for (const m of [remote, kaby]) {
    assert.ok(m.start_url.startsWith(m.scope), m.name + ': the start is inside the scope')
    assert.equal(m.display, 'standalone')
    assert.ok(m.name.length > 0 && m.short_name.length > 0 && m.short_name.length <= 12, m.name + ': a short name fits under an icon')
    for (const i of m.icons) {
      assert.ok(i.src.startsWith('/__kb/'), 'an icon of the page\'s own folder: ' + i.src)
      assert.ok(i.src.endsWith('.png') ? DRAWN.has(i.src) : existsSync(join(dir, i.src.replace('/__kb/', ''))), 'the icon exists or is drawn by the server: ' + i.src)
    }
    assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512'), m.name + ': 192 and 512 px')
    assert.ok(m.icons.some((i) => i.purpose === 'maskable'), m.name + ': a maskable icon')
  }
  assert.equal(kaby.scope, '/__kb/kaby/', 'Kaby takes its own folder, not the origin')
  ok('two manifests: two apps of one origin, the start inside the scope, icons present')
}

const index = read('index.html')
const kabyHtml = read('kaby.html')
{
  const a = index.split('\n')
  const b = kabyHtml.split('\n')
  assert.equal(a.length, b.length, 'same number of lines')
  const differ = a.map((l, i) => [l, b[i]]).filter(([x, y]) => x !== y)
  assert.equal(differ.length, 6, 'the pages differ on six lines: manifest, touch icon, title, body, frame title, brand')
  for (const [x, y] of differ) assert.ok(/manifest|apple-touch-icon|<title>|<body|<iframe|class="brand"/u.test(x), 'a line that is the app\'s own: ' + x)
  assert.ok(index.includes('href="/__kb/manifest.webmanifest"') && kabyHtml.includes('href="/__kb/kaby.webmanifest"'))
  assert.ok(index.includes('data-app="remote"') && kabyHtml.includes('data-app="kaby"'))
  ok('the two pages differ only where the app does')
}

for (const [name, html] of [['index.html', index], ['kaby.html', kabyHtml]]) {
  assert.ok(!/<script(?![^>]*\bsrc=)/iu.test(html), name + ': no inline script')
  assert.ok(!/\son[a-z]+\s*=/iu.test(html), name + ': no inline handler')
  const refs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/gu)].map((m) => m[1])
  for (const r of refs) assert.ok(r.startsWith('/__kb/'), name + ': only the page\'s own folder: ' + r)
  for (const id of ['apps', 'steps', 'pasteBox', 'gate', 'actions', 'app']) assert.ok(html.includes('id="' + id + '"'), name + ': #' + id)
}
ok('no inline script, no handler, nothing off-origin, the elements the page script drives')

{
  const src = read('phone.mjs')
  const at = src.indexOf('const STR = {')
  const end = src.indexOf('}[lang]', at)
  assert.ok(at > 0 && end > at, 'the strings are found')
  // the two languages, side by side: STR is `{fr:{…}, en:{…}}[lang]`
  const tables = new Function(src.slice(at, end).replace('const STR = ', 'return ') + '}')()
  assert.deepEqual(Object.keys(tables.fr).sort(), Object.keys(tables.en).sort(), 'French and English have the same keys')
  for (const k of ['installTitle', 'doneTitle', 'iosTitle', 'remoteName', 'kabyName', 'install', 'howTo', 'later', 'copyLink', 'step1', 'step2', 'step3', 'paste', 'pasteSub', 'kabyOfflineTitle', 'kabyOfflineSub', 'revokedPasteSub']) {
    assert.ok(typeof tables.fr[k] === 'string' && tables.fr[k].length > 0, 'fr.' + k)
    assert.ok(typeof tables.en[k] === 'string' && tables.en[k].length > 0, 'en.' + k)
  }
  assert.equal(tables.fr.remoteName, remote.name, 'the French name of the remote is the manifest\'s')
  assert.equal(tables.fr.kabyName, kaby.name)
  ok('the strings: same keys in both languages, the install, paste and Kaby texts present, names match the manifests')
}

{
  const sw = read('sw.js')
  assert.ok(sw.includes("u.pathname.startsWith('/__kb')"), 'the whole /__kb shell passes through the service worker')
  assert.ok(sw.includes("new URL(c.url).pathname.startsWith('/__kb')"), 'a page of the shell, Kaby\'s too, is the phone page the tunnel talks to')
  assert.equal((sw.match(/self\.addEventListener\('fetch'/gu) || []).length, 1, 'one fetch handler: one service worker for both apps')
  ok('one service worker for both apps: /__kb/kaby/ is part of the shell it lets through')
}

{
  const phone = read('phone.mjs')
  // the install offer never runs inside the app, and never off a phone; the pairing secrets never stay in the address bar
  assert.ok(phone.includes('if (standalone || !touch || laterRecently()) return Promise.resolve()'))
  assert.ok(phone.includes("history.replaceState(null, '', location.pathname)"))
  assert.ok(phone.includes('e2e.parsePairingFragment(new URL('), 'a pasted link is read with the same parser as the address bar')
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon/u.test(phone), 'the page still sends nothing to a server of its own (only the relay\'s socket)')
  ok('the offer is for a phone, outside the app; a pasted link goes through the same parser; no request of its own')
}

console.log('\n' + pass + ' passed')
