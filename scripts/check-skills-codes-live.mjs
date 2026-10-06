// What the Skills screen says when the host half refuses, on the REAL GUI: a code in `error` becomes a sentence in the screen's language.
//
//   node scripts/check-skills-codes-live.mjs
//
// What is real: the DSH page, the Skills panel in the Resources area, the language the GUI is in. What is swapped: the client of
// kybernos-skills (this checkout's, in a throw-away Chrome, scripts/lib-bundle-swap.mjs). What is faked: ONE answer, the catalogue route
// (GET /kybernos-skills/skills), so that the screen has a refusal to word; nothing is written anywhere. The language is NOT changed (that
// would write the user's settings): the check reads which one the GUI is in and expects the sentence of that language. That the two
// languages have the same sentences is test-client-strings.mjs's job.
//
// Exit 0 all good, 1 a check failed, 3 not run (no GUI).
import { openLivePage, waitFor, clickText } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 300))) }
}

const live = await openLivePage().catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const errors = []
try {
  await page.send('Runtime.enable', {})
  page.on('Runtime.exceptionThrown', (p) => errors.push(String((p.exceptionDetails && p.exceptionDetails.exception && p.exceptionDetails.exception.description) || 'exception').slice(0, 200)))

  const fx = { answer: null, calls: 0 }
  page.on('Fetch.requestPaused', (p) => {
    if (p.responseStatusCode !== undefined) return   // the bundle swap's business
    const path = p.request.url.split('?')[0]
    if (!path.endsWith('/kybernos-skills/skills') || fx.answer === null) { page.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {}); return }
    fx.calls += 1
    page.send('Fetch.fulfillRequest', {
      requestId: p.requestId, responseCode: 200,
      responseHeaders: [{ name: 'content-type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify(fx.answer), 'utf8').toString('base64')
    }).catch(() => {})
  })
  const swap = await swapBundles(page, [{ name: 'kybernos-skills' }], { extraPatterns: [{ urlPattern: '*kybernos-skills/skills*', requestStage: 'Request' }] })

  const show = async (answer) => {
    fx.answer = answer
    fx.calls = 0
    await page.send('Page.reload', { ignoreCache: true })
    await sleep(2500)
    await waitFor(page, 'document.body && document.body.innerText.length > 80', 30000)
    await clickText(page, 'Skills')
    await waitFor(page, "!!document.querySelector('.kbs-root')", 20000)
    await sleep(2500)
    return (await page.evalJs("(document.querySelector('.kbs-root') || document.body).innerText")).val || ''
  }

  console.log('Host refusals — this checkout\'s client in the real GUI, one faked answer')
  const first = await show({ ok: false, error: 'index_unavailable', http: 503 })
  check('the client was found in the served bundle and swapped', swap.report().every((r) => r.replaced === true), swap.report())
  check('the faked route was asked for', fx.calls > 0, fx.calls)
  const lang = (await page.evalJs("String(document.documentElement.lang || '').slice(0, 2).toLowerCase()")).val
  const en = lang === 'en'
  console.log('  (the GUI is in ' + (en ? 'English' : 'French') + ')')

  const cases = [
    { name: 'a code with facts', answer: { ok: false, error: 'index_unavailable', http: 503 }, fr: 'Index indisponible (HTTP 503).', en: 'Index unavailable (HTTP 503).' },
    { name: 'a code with the relay\'s own words', answer: { ok: false, error: 'index_unavailable', http: 502, detail: 'relay down' }, fr: 'Index indisponible (HTTP 502). — relay down', en: 'Index unavailable (HTTP 502). — relay down' },
    { name: 'a refused folder', answer: { ok: false, error: 'root_not_allowed' }, fr: 'Ce dossier n’est pas l’un de vos dossiers de skills modifiables.', en: 'That folder is not one of your writable skills folders.' }
  ]
  for (const c of cases) {
    const text = c.name === cases[0].name ? first : await show(c.answer)
    const want = en ? c.en : c.fr
    check(c.name + ': the screen says "' + want + '"', text.includes(want), text.slice(0, 300))
    check(c.name + ': the code itself is not shown', text.includes(c.answer.error) === false, c.answer.error)
  }
  const unknown = await show({ ok: false, error: 'a_word_nobody_planned' })
  check('a code with no sentence is shown as it came, not hidden', unknown.includes('a_word_nobody_planned'), unknown.slice(0, 300))
  const old = await show({ ok: false, error: 'requete impossible' })
  check('an answer in French from a host that was not restarted is shown as it came', old.includes('requete impossible'), old.slice(0, 300))
  const none = await show({ ok: false })
  check('no error at all falls back to the screen\'s own sentence', none.length > 0 && none.includes('undefined') === false, none.slice(0, 300))
  check('no script error was thrown during the run', errors.length === 0, errors)
} finally {
  await live.close()
}
console.log('\n' + pass + ' checks passed' + (failures.length > 0 ? ', ' + failures.length + ' FAILED' : ''))
process.exit(failures.length > 0 ? 1 : 0)
