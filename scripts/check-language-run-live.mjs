#!/usr/bin/env node
// The Language page when a run is interrupted, when a run is invisible, and when test marks
// reached a language — on the REAL GUI.
//
//   node scripts/check-language-run-live.mjs [--shots <dir>] [--worktree] [--user-copy]
//
//   --worktree   test this checkout's plugin client instead of what the shared tree serves
//                (scripts/lib-bundle-swap.mjs: the response of the bundle is rewritten in the test
//                browser, nothing is written anywhere). Use it before merging.
//   --user-copy [id]  start from a COPY of the user's own ~/.dsh/kybernos/i18n/<id>.json instead of
//                building the situation: what the user really has, read-only. `id` is a language of TEST_LANGS
//                (lib-language-flow.mjs), `it` when left out; the maintainer's own file is `--user-copy es`.
//
// What it replays, in order:
//   A  the incident: a language whose texts were all written by a test run (⟦…⟧) — or the user's copy;
//   B  the page no longer takes them for translations (bar of what is really held, banner, no "Use");
//   C  « Translate these texts again » replaces them, while the page says the run lives in the tab and
//      the ring in the sidebar footer follows it from every other page;
//   D  a run cut with the tab is taken over at the next load (stale heartbeat), left alone while the
//      heartbeat is fresh, and left alone when the user switched the automatic resume off.
//
// Nothing here reaches the user's data: the "disk" is a throw-away folder behind the REAL route code
// (CDP interception, fakeDiskRoute), the model is a stub inside the page, DSH's language is never
// changed (nothing presses « Use »). Exit code 0 / 1 / 3.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLivePage, waitFor } from './live-page.mjs'
import { createFlow, assertEnglishStored, storedLocale, fakeDiskRoute, LANGUAGE, TEST_LANG, TEST_LANGS } from './lib-language-flow.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const useWorktree = args.includes('--worktree')
const userCopy = args.includes('--user-copy')
// The language of the run: TEST_LANG (`it`, one DSH does not ship: for one it ships the page leaves DSH's half out on purpose, W5-02 finding 49), or the one a `--user-copy <id>` names.
const copyId = userCopy ? args[args.indexOf('--user-copy') + 1] : undefined
const T = copyId !== undefined && !copyId.startsWith('--') ? TEST_LANGS[copyId] : TEST_LANG
if (T === undefined) { console.error('○ inconclusive: --user-copy ' + copyId + ': not a language of TEST_LANGS (' + Object.keys(TEST_LANGS).join(', ') + ')'); process.exit(3) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const note = (s) => console.log('  · ' + s)

// The model, stubbed in the page. `localStorage.__kb_real_stub = '1'` makes it write plain translations
// ("IT …") instead of the test pseudo-translation of the shared stub; `__kb_pseudo_ok = '0'` turns the
// page's tolerance of ⟦…⟧ off (that is the guard under test).
const REAL_STUB = `(() => {
  const prev = window.fetch.bind(window)
  window.__KB_REAL__ = { calls: 0, delay: 350 }
  window.__KB_I18N_PSEUDO_OK__ = localStorage.getItem('__kb_pseudo_ok') !== '0'
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    if (localStorage.getItem('__kb_real_stub') === '1' && url.indexOf('/kybernos/i18n-translate') >= 0 && init && init.body) {
      window.__KB_REAL__.calls += 1
      await new Promise((r) => setTimeout(r, window.__KB_REAL__.delay))
      if (init.signal && init.signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const body = JSON.parse(init.body)
      const tr = {}
      for (const k of Object.keys(body.batch)) tr[k] = '${T.id.toUpperCase()} ' + body.batch[k]
      return new Response(JSON.stringify({ ok: true, provider: 'test', model: 'real', translations: tr }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return prev(input, init)
  }
})()`

const storedBefore = assertEnglishStored()
const home = mkdtempSync(join(tmpdir(), 'kb-run-live-'))
if (userCopy) {
  const src = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'kybernos', 'i18n', T.id + '.json')
  if (!existsSync(src)) { console.error('○ inconclusive: no ' + src); process.exit(3) }
  mkdirSync(join(home, 'kybernos', 'i18n'), { recursive: true })
  cpSync(src, join(home, 'kybernos', 'i18n', T.id + '.json'))
}
const live = await openLivePage({ width: 1500, height: 1000, hostStore: true }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const flow = await createFlow(page)
const { val, clickSel, openSettings, reload } = flow
const shot = async (name) => { if (shotDir !== null) { try { await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const disk = await fakeDiskRoute(page, home)
let swap = null
if (useWorktree) swap = await swapBundles(page, [{ name: 'kybernos-language' }], { extraPatterns: [{ urlPattern: '*/kybernos/i18n-store*', requestStage: 'Request' }] })
const poll = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(400) } }
const cleanup = async () => { await live.close(); rmSync(home, { recursive: true, force: true }) }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await cleanup(); process.exit(130) })

const marksIn = (key) => val(`(() => { try { const o = JSON.parse(localStorage.getItem(${JSON.stringify(key)}) || '{}'); const v = Object.values(o); return JSON.stringify({ n: v.length, marks: v.filter((t) => typeof t === 'string' && t.charAt(0) === '⟦').length }) } catch (e) { return JSON.stringify({ n: -1, marks: -1 }) } })()`).then((x) => JSON.parse(x))
const rowText = (id) => flow.rowText(id)
// The test marks are a warning dot on the row (its aria-label carries the count); the sentence, the button « Translate these texts again » and the examples are in
// the row's details, opened with the chevron (data-act="toggle"). A real click on the chevron opens them (a button in a closed row does not exist).
const PSEUDO = `[data-lang="${T.id}"] [data-note="pseudo"]`
const pseudoOpen = () => val(`!!document.querySelector(${JSON.stringify(PSEUDO)})`)
const openPseudoFold = async () => {
  if ((await pseudoOpen()) === false) await clickSel(`[data-lang="${T.id}"] [data-act="toggle"]`)
  return poll(() => pseudoOpen(), 5000)
}
const ring = () => val(`(() => { const r = document.querySelector('[data-act="run-ring"]'); return r ? JSON.stringify({ label: r.getAttribute('aria-label'), pct: r.style.getPropertyValue('--p'), shown: r.getBoundingClientRect().width > 0 }) : null })()`).then((x) => (x === null || x === undefined ? null : JSON.parse(x)))
// Leaves Settings with a real click on « Back to workspace »; false when the dialog is still there afterwards.
const backToWorkspace = async () => {
  const pos = await val(`(() => { const b = Array.from(document.querySelectorAll('button,a,[role=button]')).find((e) => /^back to workspace$/i.test((e.innerText || '').trim())); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`)
  if (pos === null || pos === undefined) return false
  const { x, y } = JSON.parse(pos)
  await flow.mouse(x, y)
  await sleep(1500)
  return (await val(`/back to workspace/i.test(document.body.innerText)`)) === false
}

try {
  await flow.installStub() // the shared pseudo stub (⟦text⟧) + the switch that can leave the Language plugin out
  // Registered AFTER it, so that it wraps it: the real-looking stub answers first when it is switched on.
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: REAL_STUB })
  await reload()
  if (useWorktree) {
    const r = swap.report()
    check('the worktree client is what the page runs (its text replaced the served one)', r.every((x) => x.replaced), r)
    if (!r.every((x) => x.replaced)) throw new Error('the served file differs from the shared tree on disk (uncommitted edits there?): cannot swap')
  }

  // ═══ A. the incident ═══════════════════════════════════════════════════════════════
  console.log('\n── A. a language whose texts are test marks ──')
  await val(`localStorage.setItem('__kb_pseudo_ok', '1')`)
  if (!userCopy) {
    await openSettings(LANGUAGE)
    await flow.addLanguage(T.id, null)
    await clickSel(`[data-lang="${T.id}"] [data-act="start"]`)
    const done = await flow.waitReady(T.id, 120000)
    check('the pseudo-translating run finished: every text is a ⟦…⟧ mark', done !== null && (await marksIn('kybernos.i18n.' + T.id)).marks > 100 && (await marksIn('kybernos.i18n.dsh.' + T.id)).marks > 1000, await marksIn('kybernos.i18n.' + T.id))
    // The copy is written a moment after the run ends: 60 s, not 25, for a machine busy with other checks (seen once, 2026-11-04).
    await poll(() => { const p = disk.store.read(T.id); return p !== null && p.meta && p.meta.complete === true }, 60000)
  } else {
    await reload()
    await poll(async () => (await marksIn('kybernos.i18n.dsh.' + T.id)).n > 0, 30000)
    const m = { kb: await marksIn('kybernos.i18n.' + T.id), dsh: await marksIn('kybernos.i18n.dsh.' + T.id), live: await marksIn('kybernos.i18n.live.' + T.id) }
    note('the copy of your file, as the browser holds it: ' + JSON.stringify(m))
    check('the copy came back from the (fake) disk into the browser, with its marks', m.kb.marks + m.dsh.marks + m.live.marks > 100, m)
  }
  const diskBefore = disk.store.read(T.id)
  const marksOnDiskBefore = diskBefore === null ? -1 : [diskBefore.kb, diskBefore.dsh, diskBefore.live].reduce((a, sec) => a + Object.values(sec || {}).filter((t) => typeof t === 'string' && t.charAt(0) === '⟦').length, 0)
  check('the disk copy holds the marks too (that is the incident)', marksOnDiskBefore > 100, marksOnDiskBefore)

  // ═══ B. the page no longer takes them for translations ═════════════════════════════════
  console.log('\n── B. the page counts what is really there ──')
  await val(`localStorage.setItem('__kb_pseudo_ok', '0')`)
  await openSettings(LANGUAGE)
  await sleep(2500)
  await shot('B-marks-detected')
  const rowB = await rowText(T.id)
  note('the stored record of ' + T.id + ' (what the row trusts for its count): ' + JSON.stringify(await val(`(() => { const m = JSON.parse(localStorage.getItem('kybernos.i18n.meta.${T.id}') || '{}'); return { done: m.done, total: m.total, complete: m.complete } })()`)))
  const closedSummary = await val(`(() => { const d = document.querySelector('[data-lang="${T.id}"] .kbln-dot[data-alert="warn"]'); return d && !document.querySelector(${JSON.stringify(PSEUDO)}) ? JSON.stringify({ open: false, text: (d.getAttribute('aria-label') || '').replace(/\\s+/g, ' ') }) : null })()`)
  const folded = closedSummary === null ? null : JSON.parse(closedSummary)
  check('a warning dot on the row says how many texts are to check, and that they are test marks', folded !== null && folded.open === false && /\d[\d,.\s]*\s+texts to check · test marks/.test(folded.text), folded)
  const unfolded = await openPseudoFold()
  const banner = await val(`(() => { const b = document.querySelector(${JSON.stringify(PSEUDO)}); return b ? b.innerText.replace(/\\s+/g, ' ') : null })()`)
  check('opened, the banner says that texts look like test marks, with their number', unfolded === true && typeof banner === 'string' && /\d[\d,.\s]*\s+texts look like test marks/.test(banner), banner)
  check('the language is NOT "Ready" any more', !/Ready/.test(String(rowB)), rowB)
  check('"Use" and "Use anyway" are not offered while marks are there (they would show the brackets)', (await val(`!document.querySelector('[data-lang="${T.id}"] [data-act="use"]') && !document.querySelector('[data-lang="${T.id}"] [data-act="use-now"]')`)) === true)
  // The count is what the language REALLY holds (marks leave it out, T-040). A pack with real texts among its marks (the owner's own copy) shows them on a grey bar; a pack that is
  // only marks holds nothing, so the row reads as one not started: no bar, the button that starts it.
  const heldB = { kb: await marksIn('kybernos.i18n.' + T.id), dsh: await marksIn('kybernos.i18n.dsh.' + T.id) }
  const realB = (heldB.kb.n - heldB.kb.marks) + (heldB.dsh.n - heldB.dsh.marks)
  const barB = (await val(`!!document.querySelector('[data-lang="${T.id}"] .kbln-bar.stale > i')`)) === true
  const countB = String(await val(`(document.querySelector('[data-lang="${T.id}"] .kbln-prog-line') || { innerText: '' }).innerText.replace(/\\s+/g, ' ')`))
  if (realB > 0) check('the progress bar is there, for a language that is not running (grey, with the count of the REAL texts)', barB && new RegExp('^' + realB.toLocaleString('en-US') + ' of [\\d,]+ texts').test(countB), { realB, barB, countB })
  else check('a pack that is only marks holds nothing: no progress bar, and the language can be started', !barB && (await val(`!!document.querySelector('[data-lang="${T.id}"] [data-act="start"]')`)) === true, { barB, row: await rowText(T.id) })
  check('the examples are in the opened banner', /⟦/.test(String(await val(`(document.querySelector('[data-lang="${T.id}"] .kbln-ex') || { innerText: '' }).innerText`))))

  // ═══ C. translating again ══════════════════════════════════════════════════════════
  console.log('\n── C. « Translate these texts again », and the run is visible from everywhere ──')
  await val(`localStorage.setItem('__kb_real_stub', '1')`)
  await val(`window.__KB_REAL__.calls = 0`)
  // « Translate these texts again » sits inside the fold. On a busy machine the fold is still opening when the button's box is read and the click misses it, and the
  // run only starts after the marks have been taken out of the stores: press again until the page says the run lives in this tab, up to three times.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await openPseudoFold()
    await clickSel(`[data-lang="${T.id}"] [data-act="repair"]`)
    if (await poll(() => val(`!!document.querySelector('[data-lang="${T.id}"] [data-note="in-tab"]')`), 20000)) break
  }
  const inTab = await val(`(() => { const b = document.querySelector('[data-lang="${T.id}"] [data-note="in-tab"]'); return b ? b.innerText.replace(/\\s+/g, ' ') : null })()`)
  check('while it runs the page says it lives in this tab, and what to do', typeof inTab === 'string' && /this tab/.test(inTab) && /Do not close the tab/.test(inTab), inTab)
  check('the bar is live (not grey) while it runs', (await val(`!!document.querySelector('[data-lang="${T.id}"] .kbln-bar') && !document.querySelector('[data-lang="${T.id}"] .kbln-bar.stale')`)) === true)
  check('the marks were taken out of the browser stores first (nothing of the old marks is counted)', (await marksIn('kybernos.i18n.dsh.' + T.id)).marks === 0 || (await marksIn('kybernos.i18n.dsh.' + T.id)).n < 1000)
  check('the Settings dialog is closed (we are on the workspace)', await backToWorkspace() === true)
  await sleep(500)
  await shot('C-ring-on-home')
  const r1 = await poll(ring, 8000)
  check('the ring is in the sidebar footer while the settings are closed', r1 !== null && r1.shown === true, r1)
  check('… it names the language and carries the percentage', r1 !== null && r1.label.includes(T.native) && /\d+%/.test(r1.label) && Number(r1.pct) >= 0, r1)
  await sleep(4000)
  const r2 = await ring()
  check('… and it moves with the run', r1 !== null && r2 !== null && Number(r2.pct) >= Number(r1.pct), { first: r1 && r1.pct, later: r2 && r2.pct })
  const calls = Number(await val(`window.__KB_REAL__.calls`))
  check('the model was really asked (the marked texts were retranslated)', calls > 0, calls)
  // Click the ring: it brings us to the Language page.
  if (r2 !== null) {
    await clickSel('[data-act="run-ring"]')
    const onPage = await poll(() => val(`!!document.querySelector('[data-lang="${T.id}"]')`), 25000)
    await shot('C-after-ring-click')
    check('clicking the ring opens Settings on the Language page', onPage === true, onPage === true ? undefined : await val(`JSON.stringify({ dialog: document.querySelectorAll('[role=dialog]').length, kbthPage: !!document.querySelector('.kbln-page'), candidates: Array.from(document.querySelectorAll('button,[role="tab"],a')).filter((b) => /lang/i.test(String(b.innerText || ''))).map((b) => ({ t: String(b.innerText).split('\\n')[0].slice(0, 30), cls: String(b.className).slice(0, 30), page: b.closest('.kbln-page') !== null, gen: b.closest('[data-slot="settings.general.item"]') !== null })) })`))
  }
  const finished = await flow.waitReady(T.id, 180000)
  check('the run finishes: "Ready", with "Use" available again', finished !== null, finished === null ? await rowText(T.id) : undefined)
  await shot('C-ready')
  check('back on the workspace after the run', await backToWorkspace() === true)
  check('the ring is gone once it ended', (await ring()) === null)
  await openSettings(LANGUAGE)
  const kbM = await marksIn('kybernos.i18n.' + T.id); const dshM = await marksIn('kybernos.i18n.dsh.' + T.id)
  check('no mark is left in the browser stores', kbM.marks === 0 && dshM.marks === 0, { kb: kbM, dsh: dshM })
  await poll(() => { const p = disk.store.read(T.id); return p !== null && Object.values(p.dsh || {}).every((t) => String(t).charAt(0) !== '⟦') }, 25000)
  const dk = disk.store.read(T.id)
  const dkMarks = [dk.kb, dk.dsh].reduce((a, sec) => a + Object.values(sec || {}).filter((t) => typeof t === 'string' && t.charAt(0) === '⟦').length, 0)
  check('the disk copy is clean too (the section was REPLACED, not merged back)', dkMarks === 0 && Object.keys(dk.dsh || {}).length === dshM.n && Object.keys(dk.kb || {}).length === kbM.n, { marks: dkMarks, diskDsh: Object.keys(dk.dsh || {}).length, browserDsh: dshM.n })
  check('… and it is recorded complete', dk.meta && dk.meta.complete === true, dk.meta)
  await reload()
  await sleep(4000)
  const afterReload = await marksIn('kybernos.i18n.dsh.' + T.id)
  check('after a reload (disk and browser merged at boot) the marks did not come back', afterReload.marks === 0, afterReload)

  // ═══ D. a run cut with the tab ═══════════════════════════════════════════════════════
  console.log('\n── D. a run cut with the tab ──')
  // Make the language partial again: drop most of the Kybernos texts and the record. The disk copy holds them all (that
  // is its purpose: a browser that lost some gets them back), so for this phase the disk is out of reach.
  disk.mode = 'down'
  const cut = async () => {
    await val(`(() => { const k = 'kybernos.i18n.${T.id}'; const o = JSON.parse(localStorage.getItem(k)); const ks = Object.keys(o); ks.forEach((x, i) => { if (i % 5 !== 0) delete o[x] }); localStorage.setItem(k, JSON.stringify(o)); const m = JSON.parse(localStorage.getItem('kybernos.i18n.meta.${T.id}') || '{}'); m.complete = false; localStorage.setItem('kybernos.i18n.meta.${T.id}', JSON.stringify(m)) })()`)
  }
  await cut()
  note('after the cut, the stored record of ' + T.id + ': ' + JSON.stringify(await val(`(() => { const m = JSON.parse(localStorage.getItem('kybernos.i18n.meta.${T.id}') || '{}'); return { done: m.done, total: m.total, complete: m.complete } })()`)))
  await val(`window.__KB_REAL__.delay = 2500`)
  await openSettings(LANGUAGE)
  await sleep(2000)
  await val(`window.__KB_REAL__.delay = 2500`)
  await clickSel(`[data-lang="${T.id}"] [data-act="start"]`)
  await sleep(3500)
  check('the run is going (it needs to outlast what follows)', (await val(`!!document.querySelector('[data-lang="${T.id}"] [data-note="in-tab"]')`)) === true, await rowText(T.id))
  const heartbeat = await val(`localStorage.getItem('kybernos.i18n.runstate')`)
  check('a live run keeps its heartbeat in the browser', typeof heartbeat === 'string' && heartbeat.includes('"lang":"' + T.id + '"') && /"beat":\d+/.test(heartbeat), heartbeat)
  // (1) another tab is alive: the heartbeat is fresh, a load must not take the run over.
  await val(`(() => { const o = JSON.parse(localStorage.getItem('kybernos.i18n.runstate')); o.beat = Date.now(); localStorage.setItem('kybernos.i18n.runstate', JSON.stringify(o)) })()`)
  await reload()
  await sleep(7500)
  check('… the run it left behind is still recorded (so the check above is not vacuous)', (await val(`localStorage.getItem('kybernos.i18n.runstate')`)) !== null)
  check('a fresh heartbeat (the other tab is alive): a new load does NOT start a second run', (await ring()) === null)
  // (2) the tab was closed: the heartbeat is stale.
  await val(`(() => { const o = JSON.parse(localStorage.getItem('kybernos.i18n.runstate')); o.beat = Date.now() - 60000; localStorage.setItem('kybernos.i18n.runstate', JSON.stringify(o)) })()`)
  await reload()
  const rr = await poll(ring, 20000)
  await shot('D-resumed-on-its-own')
  check('a stale heartbeat (the tab was closed): the next load takes the run over by itself', rr !== null && rr.shown === true, rr)
  // (3) the user switched it off.
  await val(`window.__KB_REAL__.delay = 60`)
  await poll(async () => (await ring()) === null, 120000)
  await cut()
  await val(`localStorage.setItem('kybernos.i18n.autoresume', 'off')`)
  await val(`localStorage.setItem('kybernos.i18n.runstate', JSON.stringify({ lang: ${JSON.stringify(T.id)}, model: null, beat: Date.now() - 60000 }))`)
  await openSettings(LANGUAGE)
  await sleep(6500)
  check('automatic resume switched off: the load leaves the run alone', (await ring()) === null)
  await clickSel(`[data-lang="${T.id}"] [data-act="toggle"]`); await sleep(400)
  const cutBanner = await val(`(() => { const b = document.querySelector('[data-lang="${T.id}"] [data-note="cut"]'); return b ? b.innerText.replace(/\\s+/g, ' ') : null })()`)
  check('… and the page says the translation stopped with the tab, and how to go on', typeof cutBanner === 'string' && /stopped with the tab/.test(cutBanner), cutBanner)
  await clickSel('[data-act="tab-settings"]'); await sleep(400)
  check('the option is in the Settings tab, unticked, and it can be ticked again', (await val(`(() => { const c = document.querySelector('[data-act="autoresume"]'); return !!c && c.checked === false })()`)) === true)
  await val(`document.querySelector('[data-act="autoresume"]').click()`)
  await sleep(500)
  check('… and ticking it again forgets the switch', (await val(`localStorage.getItem('kybernos.i18n.autoresume')`)) === null)
  await clickSel('[data-act="tab-langs"]'); await sleep(400)
  check('no stray language was created by the new keys (only ' + T.id + ', plus the two built-ins)', JSON.stringify(await val(`Array.from(document.querySelectorAll('[data-lang]')).map((e) => e.getAttribute('data-lang')).sort()`)) === JSON.stringify(['en', T.id, 'kybernos'].sort()))
  check('the user’s DSH language was never touched', storedLocale() === storedBefore, storedLocale())
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + e.message)
} finally {
  await cleanup()
}
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
