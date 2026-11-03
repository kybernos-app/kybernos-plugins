#!/usr/bin/env node
/** The Publish button of the Creations (KbPublishDialog, kbSites in client.js; the routes are the Cloud plugin's, site-page.mjs).
 *
 *  The client's store is run as written, with a fake `fetch` that answers like the routes: the button is drawn only where the routes answer, the « Online » mark follows the account's
 *  list, a refusal reaches the person as a sentence of ours, and what the client calls exists in the Cloud plugin's table of routes (a renamed route would leave a dead button).
 *
 *  Usage: node packages/kybernos-plugin/test-publish-button.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')
const cloud = readFileSync(join(here, '..', 'kybernos-cloud', 'index.js'), 'utf8')

const a = src.indexOf('const KB_SITE_NAME_RE')
const b = src.indexOf('const useKbSites')
assert.ok(a > 0 && b > a, 'the store was found')
const makeStore = (fetchImpl) => new Function('fetch', 'kbe', 'Date', src.slice(a, b) + '\nreturn { kbSites, kbIsPage, KB_SITE_NAME_RE }')(fetchImpl, (en) => en, Date)

const json = (status, body) => Promise.resolve({ status, json: () => (body === undefined ? Promise.reject(new Error('not json')) : Promise.resolve(body)) })
const live = (slug, paths) => ({ slug, url: 'https://' + slug + '.kaby.app', title: slug, state: 'live', updated_at: '2026-11-03T10:00:00Z', files: 3, bytes: 10, paths })

// ── what the client calls exists in the Cloud plugin ───────────────────────────
const called = [...src.matchAll(/'(\/kybernos-cloud\/sites[a-z/]*)'/g)].map((m) => m[1])
assert.ok(called.length >= 4, 'the client calls the four routes')
for (const path of new Set(called)) assert.ok(cloud.includes("path: '" + path + "'"), path + ' is a route of the Cloud plugin')
ok('every route the button calls is a route of the Cloud plugin (' + new Set(called).size + ')')
for (const path of ['/kybernos-cloud/sites/plan', '/kybernos-cloud/sites/publish', '/kybernos-cloud/sites/remove']) {
  const row = cloud.split('\n').find((l) => l.includes("path: '" + path + "'"))
  assert.ok(/method: 'POST'/.test(row) && /session: true/.test(row), path + ' is a POST under the signed session')
}
ok('what writes is a POST under the signed session, not only an origin')

// ── where the button is drawn ────────────────────────────────────────────────────
{
  const { kbSites, kbIsPage } = makeStore(() => json(200, { ok: true, connected: true, available: true, sites: [live('menu', ['/w/menu.html'])], count: 1 }))
  assert.equal(kbSites.shown(), false, 'nothing is drawn before the account has answered')
  await kbSites.load(true)
  assert.equal(kbSites.shown(), true)
  assert.equal(kbSites.state().connected, true)
  assert.equal(kbSites.siteOf('/w/menu.html').slug, 'menu', 'the mark follows the file')
  assert.equal(kbSites.siteOf('/w/other.html'), null)
  assert.equal(kbIsPage('Menu.HTML') && kbIsPage('a.htm') && !kbIsPage('a.html.txt') && !kbIsPage('a.md') && !kbIsPage(null), true)
  ok('the button is drawn once the account has answered, and only for .html and .htm files; the « Online » mark follows the file')
}
for (const [label, answer] of [
  ['a route that is not there (the plugin is off): the host answers with no JSON', () => json(404)],
  ['a team\'s own DSH', () => json(403, { ok: false, error: 'personal_only' })],
  ['a server without the feature', () => json(200, { ok: true, connected: true, available: false, sites: [], count: 0 })],
  ['a fetch that fails', () => Promise.reject(new Error('down'))],
]) {
  const { kbSites } = makeStore(answer)
  await kbSites.load(true)
  assert.equal(kbSites.shown(), false, label + ': no button')
}
ok('no button where the routes are not (the plugin is off, a team\'s DSH, a server without the feature, a failed call)')
{
  const { kbSites } = makeStore(() => json(200, { ok: false, error: 'no_answer' }))
  await kbSites.load(true)
  assert.equal(kbSites.shown(), true, 'the server did not answer: the button stays, the marks are unknown')
  const signedOut = makeStore(() => json(200, { ok: true, connected: false, available: true, sites: [], count: 0 }))
  await signedOut.kbSites.load(true)
  assert.equal(signedOut.kbSites.shown(), true)
  assert.equal(signedOut.kbSites.state().connected, false, 'signed out: the button stays, the dialog asks to sign in')
  ok('a server that does not answer, or a signed-out account, keeps the button (the dialog says what is wrong)')
}

// ── the list is asked at most every 30 s, and again after a change ──────────────────
{
  let calls = 0
  const urls = []
  const { kbSites } = makeStore((url, init) => { calls += 1; urls.push([url, init && init.method]); if (/publish$/.test(url)) return json(200, { ok: true, url: 'https://menu.kaby.app', slug: 'menu', updated: false }); return json(200, { ok: true, connected: true, available: true, sites: [], count: 0 }) })
  await kbSites.load(false)
  await kbSites.load(false)
  assert.equal(calls, 1, 'two quick loads are one call')
  const r = await kbSites.publish('/w/menu.html', 'menu')
  assert.equal(r.ok, true)
  await kbSites.load(false)
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.ok(calls >= 3, 'a publication reads the list again')
  const publish = urls.find(([u]) => /publish$/.test(u))
  assert.equal(publish[1], 'POST')
  ok('the list is asked once for quick successive loads, and again after a publication')
}

// ── the sentences ───────────────────────────────────────────────────────────────
{
  const { kbSites } = makeStore(() => json(200, { ok: true, connected: true, available: true, sites: [], count: 0 }))
  const serverCodes = ['slug_taken', 'invalid_slug', 'reserved_slug', 'taken_down', 'too_many_sites', 'too_big', 'invalid_files', 'rate_limited', 'host_error', 'try_again', 'busy', 'building', 'no_answer', 'invalid_path', 'not_found', 'not_on_this_server']
  const seen = new Set()
  for (const code of serverCodes) {
    const text = kbSites.words(code, { max: 3, plan: false })
    assert.ok(typeof text === 'string' && text.length > 20, code + ' has a sentence')
    seen.add(text)
  }
  assert.ok(seen.size >= serverCodes.length - 1, 'each code has its own sentence (not_found and not_on_this_server may share one)')
  assert.ok(/3/.test(kbSites.words('too_many_sites', { max: 3 })), 'the limit says its number')
  assert.ok(/other|autre|another/.test(kbSites.words('slug_taken')), 'a name that is taken says to choose another')
  assert.ok(kbSites.words('something_new').length > 10, 'a code the client does not know still gets a sentence')
  const sp = readFileSync(join(here, '..', 'kybernos-cloud', 'site-page.mjs'), 'utf8')
  for (const code of ['not_connected', 'no_answer', 'building', 'not_on_this_server']) assert.ok(sp.includes("'" + code + "'"), code + ' is a code of the host')
  ok('every code of the server and of the host has a plain sentence of ours (' + serverCodes.length + ')')
}

// ── the name, as the dialog checks it ───────────────────────────────────────────
{
  const { KB_SITE_NAME_RE } = makeStore(() => json(404))
  const good = ['pizzaone', 'pizza-one', 'p1z', 'a'.repeat(32)]
  const bad = ['', 'ab', '-pizza', 'pizza-', 'Pizza', 'pi zza', 'a'.repeat(33), 'piz.za']
  assert.ok(good.every((n) => KB_SITE_NAME_RE.test(n)))
  assert.ok(bad.every((n) => !KB_SITE_NAME_RE.test(n)))
  const site = readFileSync(join(here, '..', 'kybernos-cloud', 'site-publish.mjs'), 'utf8')
  assert.ok(site.includes('/^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/u'), 'the same pattern as the host\'s')
  ok('the name is checked with the same pattern as the host, before anything is sent')
}

// ── where it is drawn in the page ─────────────────────────────────────────────────
{
  assert.ok(/'data-kb': 'art-popup-publish'/.test(src) && /canPublish === true \? h\('button'/.test(src), 'the preview header has the button')
  assert.ok(/item\('publish', 'globe'/.test(src) && /item\('site-down', 'trash'/.test(src) && /item\('site-open'/.test(src) && /item\('site-update'/.test(src), 'the tile menu has the four rows')
  assert.ok(/'data-kb': 'art-online'/.test(src), 'a tile that is online carries the mark')
  assert.ok(/action === 'publish' \|\| action === 'site-down'/.test(src) && /action === 'site-update'/.test(src) && /action === 'site-open'/.test(src), 'the page handles the actions of the menu')
  ok('the preview header, the tile menu, the « Online » mark and the page\'s actions are all in place')
}

console.log('\n' + pass + ' checks passed')
