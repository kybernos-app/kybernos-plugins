#!/usr/bin/env node
// A translation the HOST runs, in a real GUI: the page hands the run over, the run fails for want of a key (a sandbox has
// none), and the page says so where the person looks — the error on the language, a toast, a note and a dot on the bell —
// once, and not again after a reload.
//
//   source scripts/sandbox/env.sh && node scripts/check-language-job-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh, restarted after a host change: the job route is host code)
// whose profile lists at least one model and holds NO key for it: a fresh sandbox cloned from the maintainer's profile does (its
// providers name key variables the sandbox environment does not set). A sandbox paired with the replica has a route that works, the
// host falls back to it (the page's pick, then `brain`, then the catalog default) and the translation really runs: the check then
// ends inconclusive (3) with that reason, and cancels the run. Refuses :3080. Nothing presses « Use »: DSH's own language is
// untouched. The success path (a model that answers) is played, with the real host runner and the real page code, by
// packages/kybernos-language/test-client.mjs and packages/kybernos-plugin/test-i18n-job.mjs.
// Exit code 0 / 1 / 3.
import { join } from 'node:path'
import { openLivePage } from './live-page.mjs'
import { createFlow, LANGUAGE, assertEnglishStored, TEST_LANG as T } from './lib-language-flow.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a DSH that serves this checkout (a sandbox instance), not the one on :3080. Set KB_HOST, DSH_HOME and HOME.'); process.exit(3) }
assertEnglishStored()

const live = await openLivePage({ width: 1500, height: 1000, hostJob: true, hostStore: true, pseudoOk: false }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const flow = await createFlow(page)
const { val, clickSel, openSettings, reload } = flow
const poll = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(250) } }
const shot = async (name) => { if (shotDir !== null) { try { await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const cancelRun = async () => { try { await val(`fetch('/kybernos/i18n-job', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'cancel', lang: '${T.id}' }) }).then(() => 1)`) } catch (e) { /* page gone */ } }
const jobState = async () => JSON.parse(await val(`fetch('/kybernos/i18n-job?lang=${T.id}', { credentials: 'same-origin' }).then((r) => r.text())`))

try {
  await val(`localStorage.removeItem('kybernos.notifs.v1')`)
  // The note of a translation run is quiet by default (Settings › Language › « Announce when a translation run is done », d9ec57e5): this check is about the note, so it switches it on, as the setting does.
  await val(`localStorage.setItem('kybernos.notifs.announce', '1')`)
  await openSettings(LANGUAGE)
  const has = await val(`!!document.querySelector('[data-lang="${T.id}"]')`)
  if (has !== true) await flow.addLanguage(T.id, null)
  check('the Language page lists ' + T.english, (await val(`!!document.querySelector('[data-lang="${T.id}"]')`)) === true)
  const startable = await val(`(() => { const b = document.querySelector('[data-lang="${T.id}"] [data-act="start"]'); return !!b && !b.disabled })()`)
  if (startable !== true) { console.error('○ inconclusive: the page offers no model to translate with (profile without models)'); await live.close(); process.exit(3) }
  const routeThere = (await val(`fetch('/kybernos/i18n-job', { credentials: 'same-origin' }).then((r) => r.status)`)) === 200
  if (!routeThere) { console.error('○ inconclusive: the host has no /kybernos/i18n-job route: restart the sandbox'); await live.close(); process.exit(3) }

  await clickSel(`[data-lang="${T.id}"] [data-act="start"]`)
  // A stop is a red dot on the row, its words are in the details the chevron opens (since 2026-11-02; `.kbln-err` is now only a pack note or a removal question).
  // A credential failure is immediate: a run still `running` after 25 s is a route that works, not a slow failure.
  const t0 = Date.now()
  const outcome = await (async () => {
    for (;;) {
      if ((await val(`!!document.querySelector('[data-lang="${T.id}"] .kbln-dot.error')`)) === true) return 'failed'
      const st0 = await jobState().catch(() => null)
      if (st0 !== null && st0.job && st0.job.state === 'running' && Date.now() - t0 > 25000) return 'running'
      if (Date.now() - t0 > 45000) return 'none'
      await sleep(500)
    }
  })()
  if (outcome === 'running') {
    console.error('○ inconclusive: the host is really translating (this sandbox has a model route that works, e.g. it is paired with the replica): the failure path needs a sandbox with no key for any model')
    await cancelRun()
    await live.close()
    process.exit(3)
  }
  const failed = outcome === 'failed'
  // The toast lives 12 s: it is read as soon as the dot is there, before anything else.
  const toasted = await poll(() => val(`!!document.querySelector('[data-kb="notify-toast"]')`), 8000)
  const toastText = String(await val(`(document.querySelector('[data-kb="notify-toast"]') || { innerText: '' }).innerText`))
  await shot('job-failed')
  await clickSel(`[data-lang="${T.id}"] [data-act="toggle"]`)
  const cause = await poll(() => val(`(() => { const a = document.querySelector('[data-lang="${T.id}"] [role="alert"]'); return a ? a.innerText.replace(/\\s+/g, ' ').trim() : '' })()`), 8000)
  check('the run is handed to the host and ends « stopped » on the language, with a cause the person can act on', failed && typeof cause === 'string' && cause.length > 10, cause)
  const st = await jobState()
  check('the host holds the run: failed, with the cause, and it was announced (acknowledged)', st.ok === true && st.job !== null && st.job.state === 'failed' && /CREDENTIAL|AUTH|NO_ADAPTER|aucun modele|QUOTA|UNREACHABLE|TIMEOUT/i.test(String(st.job.error)) && st.job.acked === true, st)
  check('the in-tab engine did not run: no heartbeat is left behind', (await val(`localStorage.getItem('kybernos.i18n.runstate')`)) === null)
  const kept0 = JSON.parse(await val(`localStorage.getItem('kybernos.notifs.v1') || '[]'`))
  check('the note is in the store the bell reads, as an error with the cause', kept0.some((n) => n.id === 'lang:' + T.id && n.kind === 'error' && /API key|key/i.test(n.body)), kept0)
  check('a toast said it, in front of the person', toasted === true)
  check('…and reads as a sentence about the language', /stopped/i.test(toastText), toastText)
  await shot('job-toast')

  await reload()
  await sleep(4000)
  check('after a reload nothing is announced again (the host knows it was seen)', (await val(`!document.querySelector('[data-kb="notify-toast"]')`)) === true)
  const kept = JSON.parse(await val(`localStorage.getItem('kybernos.notifs.v1') || '[]'`))
  check('…and the note is still in the bell, once', kept.filter((n) => n.id === 'lang:' + T.id).length === 1, kept.map((n) => n.id))
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + e.message)
} finally {
  // Leave the sandbox as found: the host's run state and the language the check added.
  await cancelRun()
  await live.close()
}
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
