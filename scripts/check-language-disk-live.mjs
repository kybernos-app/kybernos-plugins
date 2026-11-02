#!/usr/bin/env node
// End-to-end test of the DISK COPY of the translations, on the REAL GUI.
//
//   node scripts/check-language-disk-live.mjs [--worktree | --baseline]
//
//   --worktree   test this checkout's Language client instead of what the shared tree serves
//
// A translation is kept in the browser (localStorage) AND on the user's disk
// (~/.dsh/kybernos/i18n/<lang>.json, host route /kybernos/i18n-store). This checks the
// whole chain in a real browser: translate -> the file appears; a browser with nothing
// gets the language back from the disk and DSH shows it; removing it removes the file;
// a host that is down or has no route (DSH not restarted yet) leaves the browser copy intact
// and says so.
//
// The "disk" is a throw-away folder served by the REAL route code (serveI18nStore) behind
// the page's requests (CDP interception, see fakeDiskRoute): the user's ~/.dsh is neither
// read nor written, so this runs fine before DSH has been restarted with the new route.
// The LLM is stubbed inside the page (⟦text⟧), like check-language-live.mjs.
//
// ⚠ Like that script, it makes DSH persist its language preference (it switches to the
// pseudo-language and puts English back; refuses to start unless DSH is in English).
//
// Exit code: 0 all green, 1 a check failed, 3 inconclusive.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage, waitFor } from './live-page.mjs'
import { createFlow, assertEnglishStored, storedLocale, fakeDiskRoute, LANGUAGE } from './lib-language-flow.mjs'
import { swapBundles, SHARED_TREE } from './lib-bundle-swap.mjs'

const useWorktree = process.argv.slice(2).includes('--worktree')
// --baseline: the opposite, for a sandbox that serves this checkout: serve the SHARED TREE's client instead, to tell a regression of this branch from a failure that was already there.
const baseline = process.argv.slice(2).includes('--baseline')
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const storedBefore = assertEnglishStored()
const home = mkdtempSync(join(tmpdir(), 'kb-disk-live-'))
const live = await openLivePage({ width: 1500, height: 1000, hostStore: true }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const flow = await createFlow(page)
const { val, clickSel, reload, openSettings, restoreEnglish } = flow
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await restoreEnglish(); await live.close(); rmSync(home, { recursive: true, force: true }); process.exit(130) })

const disk = await fakeDiskRoute(page, home)
// After the fake disk: `Fetch.enable` replaces the patterns of an earlier call, so this one lists the store route too.
const swap = useWorktree || baseline ? await swapBundles(page, [{ name: 'kybernos-language' }], { ...(baseline ? { servedRoot: REPO, mineRoot: SHARED_TREE } : {}), extraPatterns: [{ urlPattern: '*/kybernos/i18n-store*', requestStage: 'Request' }] }) : null
await flow.installStub() // reloads the page: the swapped client is what loads
const browserCount = async (id) => Number(await val(`Object.keys(JSON.parse(localStorage.getItem('kybernos.i18n.${id}') || '{}')).length`))
const browserDshCount = async (id) => Number(await val(`Object.keys(JSON.parse(localStorage.getItem('kybernos.i18n.dsh.${id}') || '{}')).length`))
const diskLine = async () => val(`(() => { const e = document.querySelector('[data-disk]'); return e ? JSON.stringify({ state: e.getAttribute('data-disk'), text: e.innerText.replace(/\\s+/g, ' ').trim(), title: e.getAttribute('title') || '' }) : null })()`)
const poll = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(500) } }

try {
  if (swap !== null) {
    const r = swap.report()
    check((baseline ? 'the shared tree’s client (baseline)' : 'the worktree client') + ' is what the page runs (its text replaced the served one)', r.every((x) => x.replaced), r)
    if (!r.every((x) => x.replaced)) throw new Error('the served file differs from the shared tree on disk (uncommitted edits there?): cannot swap')
  }
  // ═══ 1. a disk that is empty ═════════════════════════════════════════════
  console.log('\n── empty disk ──')
  await openSettings(LANGUAGE)
  const line0 = JSON.parse((await poll(diskLine, 8000)) || 'null')
  check('the page says where the translations are kept (disk), with the folder', line0 !== null && line0.state === 'on' && line0.text.includes('Translations saved on this computer') && line0.text.includes(home + '/kybernos/i18n'), line0)
  check('… with a tooltip explaining what this folder is for', line0 !== null && /folder|back up/i.test(line0.title), line0)
  check('the browser did query the host (read-only, no write)', disk.requests.some((r) => r.method === 'GET') && !disk.requests.some((r) => r.method === 'POST'), disk.requests)

  // ═══ 2. translating writes the file ══════════════════════════════════════
  console.log('\n── translating writes the file ──')
  await flow.pseudoLanguage('es')
  const nKb = await browserCount('es')
  const nDsh = await browserDshCount('es')
  check('the translation did produce texts in the browser', nKb > 100 && nDsh > 1000, { nKb, nDsh })
  const arrived = await poll(() => { const p = disk.store.read('es'); return p !== null && Object.keys(p.kb).length === nKb && Object.keys(p.dsh).length === nDsh && p.meta.complete === true }, 25000)
  const pack = disk.store.read('es')
  check('the es.json file appeared on the disk, complete (Kybernos + DSH)', arrived === true || !!arrived, { kb: pack && Object.keys(pack.kb).length, dsh: pack && Object.keys(pack.dsh).length, nKb, nDsh })
  check('… with the native name of the language and the "finished" record', pack !== null && pack.label === 'Español' && pack.meta.complete === true && pack.meta.total > 1000, pack && { label: pack.label, meta: pack.meta })
  check('… the texts are the browser ones (⟦…⟧ from the test stub)', pack !== null && Object.values(pack.kb).every((t) => t.indexOf('⟦') >= 0) && Object.values(pack.dsh).every((t) => t.indexOf('⟦') >= 0))
  const posts = disk.requests.filter((r) => r.method === 'POST')
  check('sent in small chunks during the translation, not for every text', posts.length >= 1 && posts.length < 60, posts.length)
  check('no write refused by the route', posts.every((r) => r.status === 200), posts.filter((r) => r.status !== 200))

  // ═══ 3. a browser with nothing ═══════════════════════════════════════════
  console.log('\n── a new browser gets the language back from the disk ──')
  // DSH remembers "es" (it is the stored preference); the browser's own copy is wiped.
  const postsBefore = disk.requests.filter((r) => r.method === 'POST').length
  await val(`localStorage.clear()`)
  await page.send('Page.reload', {})
  const back = await poll(async () => (await browserCount('es')) === nKb && (await browserDshCount('es')) === nDsh, 40000)
  check('the texts came back from the disk into the browser (Kybernos + DSH)', !!back, { kb: await browserCount('es'), dsh: await browserDshCount('es'), nKb, nDsh })
  check('… with the registry, the native name and the record', (await val(`JSON.parse(localStorage.getItem('kybernos.i18n.langs') || '[]').includes('es') && JSON.parse(localStorage.getItem('kybernos.i18n.labels') || '{}').es === 'Español' && JSON.parse(localStorage.getItem('kybernos.i18n.meta.es') || '{}').complete === true`)) === true)
  const inEs = await waitFor(page, `document.documentElement.lang === 'es'`, 40000)
  await sleep(3500)
  check('DSH, which remembers "es", switches back to the language by itself (a single reload)', inEs !== null && (await val(`document.documentElement.lang`)) === 'es')
  check('… and the interface is really translated (⟦…⟧ texts on screen)', (await val(`(document.body.innerText.match(/⟦/g) || []).length`)) > 5)
  check('nothing was written back to the disk by this browser (it only read)', disk.requests.filter((r) => r.method === 'POST').length === postsBefore, disk.requests.filter((r) => r.method === 'POST').length - postsBefore)
  check('the language is in the DSH selector (Settings › General)', await (async () => {
    await restoreEnglish()
    await openSettings(['General', 'Général'])
    await flow.waitDshLanguageRow()
    await flow.openDshLanguageMenu()
    const opts = await flow.dshLanguageOptions()
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape' })
    return Array.isArray(opts) && opts.some((o) => /Español/.test(o))
  })())
  check('DSH is back on English (nothing left over)', storedLocale() === 'en', storedLocale())

  // ═══ 4. removing ═════════════════════════════════════════════════════════
  console.log('\n── removing a language removes the file ──')
  await openSettings(LANGUAGE)
  await clickSel('[data-lang="es"] [data-act="menu"]'); await sleep(500)
  await clickSel('[data-lang="es"] [data-act="remove"]'); await sleep(600)
  await clickSel('[data-lang="es"] [data-act="confirm-remove"]')
  const gone = await poll(() => disk.store.read('es') === null, 8000)
  check('the file disappeared from the disk', !!gone)
  check('… and the removal is remembered (tombstone) for the other browsers', disk.store.removed().es > 0, disk.store.removed())
  check('… the browser keeps nothing of it', (await browserCount('es')) === 0 && (await val(`!JSON.parse(localStorage.getItem('kybernos.i18n.langs') || '[]').includes('es')`)) === true)
  await reload()
  await sleep(2500)
  check('after a reload, the language does not come back', (await val(`!document.querySelector('[data-lang="es"]')`)) === true && (await browserCount('es')) === 0)
  await openSettings(LANGUAGE)
  check('… and the page does not list it', (await val(`!document.querySelector('[data-lang="es"]')`)) === true)

  // ═══ 5. no disk: the browser copy is untouched, and the page says so ═════
  console.log('\n── no disk (host down, route missing) ──')
  for (const mode of ['absent', 'down']) {
    disk.mode = mode
    await reload()
    await openSettings(LANGUAGE)
    const l = JSON.parse((await poll(async () => { const v = await diskLine(); return v !== null && JSON.parse(v).state === 'off' ? v : null }, 12000)) || 'null')
    check('[' + mode + '] the page says so: "this browser only", with what to do', l !== null && l.state === 'off' && /this browser only/.test(l.text) && /Restart DSH/.test(l.text), l)
    check('[' + mode + '] the Language page stays usable (language list, Add button)', (await val(`!!document.querySelector('[data-lang="en"]') && !!document.querySelector('[data-act="add-language"]')`)) === true)
  }
  disk.mode = 'up'
  await reload()
  await openSettings(LANGUAGE)
  const back2 = JSON.parse((await poll(async () => { const v = await diskLine(); return v !== null && JSON.parse(v).state === 'on' ? v : null }, 12000)) || 'null')
  check('the host comes back: the status goes back to "saved on this computer" after a reload', back2 !== null && back2.state === 'on', back2)
} catch (e) {
  fail += 1
  console.log('  ✗ the test itself stopped: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ⏎ ') : e))
} finally {
  await restoreEnglish()
}

await sleep(1500)
{
  const after = storedLocale()
  check('no leftover: the language STORED by DSH is back to "' + storedBefore + '"', storedBefore === null ? true : after === storedBefore, { before: storedBefore, after })
}
await live.close()
rmSync(home, { recursive: true, force: true })
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
