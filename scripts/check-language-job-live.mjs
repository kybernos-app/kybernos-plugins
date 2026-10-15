#!/usr/bin/env node
// A translation the HOST runs, in a real GUI: the page hands the run over, the run fails for want of a key (a sandbox has
// none), and the page says so where the person looks — the error on the language, a toast, a note and a dot on the bell —
// once, and not again after a reload.
//
//   source scripts/sandbox/env.sh && node scripts/check-language-job-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh, restarted after a host change: the job route is host code)
// whose profile lists at least one model (a clone of the real one does). Refuses :3080. Nothing presses « Use »: DSH's own
// language is untouched. The success path (a model that answers) is played, with the real host runner and the real page code,
// by packages/kybernos-language/test-client.mjs and packages/kybernos-plugin/test-i18n-job.mjs.
// Exit code 0 / 1 / 3.
import { join } from 'node:path'
import { openLivePage } from './live-page.mjs'
import { createFlow, LANGUAGE, assertEnglishStored } from './lib-language-flow.mjs'

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
const jobState = async () => JSON.parse(await val(`fetch('/kybernos/i18n-job?lang=es', { credentials: 'same-origin' }).then((r) => r.text())`))

try {
  await val(`localStorage.removeItem('kybernos.notifs.v1')`)
  await openSettings(LANGUAGE)
  const has = await val(`!!document.querySelector('[data-lang="es"]')`)
  if (has !== true) await flow.addLanguage('es', null)
  check('the Language page lists Spanish', (await val(`!!document.querySelector('[data-lang="es"]')`)) === true)
  const startable = await val(`(() => { const b = document.querySelector('[data-lang="es"] [data-act="start"]'); return !!b && !b.disabled })()`)
  if (startable !== true) { console.error('○ inconclusive: the page offers no model to translate with (profile without models)'); await live.close(); process.exit(3) }
  const routeThere = (await val(`fetch('/kybernos/i18n-job', { credentials: 'same-origin' }).then((r) => r.status)`)) === 200
  if (!routeThere) { console.error('○ inconclusive: the host has no /kybernos/i18n-job route: restart the sandbox'); await live.close(); process.exit(3) }

  await clickSel('[data-lang="es"] [data-act="start"]')
  const failed = await poll(() => val(`!!document.querySelector('[data-lang="es"] .kbth-err')`), 45000)
  await shot('job-failed')
  check('the run is handed to the host and ends « stopped » on the language, with a cause the person can act on', failed === true)
  const st = await jobState()
  check('the host holds the run: failed, with the cause, and it was announced (acknowledged)', st.ok === true && st.job !== null && st.job.state === 'failed' && /CREDENTIAL|AUTH|NO_ADAPTER|aucun modele|QUOTA|UNREACHABLE|TIMEOUT/i.test(String(st.job.error)) && st.job.acked === true, st)
  check('the in-tab engine did not run: no heartbeat is left behind', (await val(`localStorage.getItem('kybernos.i18n.runstate')`)) === null)
  const kept0 = JSON.parse(await val(`localStorage.getItem('kybernos.notifs.v1') || '[]'`))
  check('the note is in the store the bell reads, as an error with the cause', kept0.some((n) => n.id === 'lang:es' && n.kind === 'error' && /API key|key/i.test(n.body)), kept0)
  check('a toast said it, in front of the person', (await poll(() => val(`!!document.querySelector('[data-kb="notify-toast"]')`), 8000)) === true)
  check('…and reads as a sentence about the language', /stopped/i.test(await val(`(document.querySelector('[data-kb="notify-toast"]') || { innerText: '' }).innerText`)))
  await shot('job-toast')

  await reload()
  await sleep(4000)
  check('after a reload nothing is announced again (the host knows it was seen)', (await val(`!document.querySelector('[data-kb="notify-toast"]')`)) === true)
  const kept = JSON.parse(await val(`localStorage.getItem('kybernos.notifs.v1') || '[]'`))
  check('…and the note is still in the bell, once', kept.filter((n) => n.id === 'lang:es').length === 1, kept.map((n) => n.id))
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + e.message)
} finally {
  // Leave the sandbox as found: the host's run state and the language the check added.
  try { await val(`fetch('/kybernos/i18n-job', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'cancel', lang: 'es' }) }).then(() => 1)`) } catch (e) { /* page gone */ }
  await live.close()
}
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
