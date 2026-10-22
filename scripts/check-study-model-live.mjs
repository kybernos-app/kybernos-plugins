#!/usr/bin/env node
// The Study model row of « Kybernos Settings » in a real GUI (WP-08): « Decision Brain » is gone, the Study model reads
// « Automatic — <model> » by default, with « Choose another… » and « None », and the choice is what the host keeps and
// obeys (closed questions: the word rules first, nothing sent to any model on None).
//
//   source scripts/sandbox/env.sh && node scripts/check-study-model-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh, restarted after a host change: the routes are host code).
// Refuses :3080 (exit 3). It writes ONE setting of the sandbox's own settings.json (`brain`) and puts it back to Automatic at
// the end; it calls no model. What a model answers is played by packages/kybernos-sessions/test-decision-llm.mjs (a stub
// `llm`), and end to end by pointing a sandbox route at a local fake server.
// Exit code 0 / 1 / 3.
import { join } from 'node:path'
import { openLivePage, openSettings, waitFor } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 300))) } }

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a DSH that serves this checkout (a sandbox instance), not the one on :3080. Set KB_HOST, DSH_HOME and HOME.'); process.exit(3) }

const live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (e, ms) => (await page.evalJs(e, ms)).val
const settings = () => val(`fetch('/kybernos-sessions/settings').then((r) => r.json()).then((j) => JSON.stringify(j))`, 8000).then((t) => JSON.parse(t))
const decide = (corps) => val(`fetch('/kybernos-sessions/decision', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(corps))} }).then((r) => r.json()).then((j) => JSON.stringify(j))`, 8000).then((t) => JSON.parse(t))
const row = `document.querySelector('[data-kbr="brain"]')`
// The Study model is a button that opens a searchable list (the harness has dozens of models): choosing is opening it and clicking the item.
const trigger = `document.querySelector('[data-kbr="brain-select"]')`
const choose = async (value) => {
  await val(`(() => { ${trigger}.click() })()`)
  await sleep(300)
  await val(`(() => { const o = [...document.querySelectorAll('.kbr-pick-opt')].find((x) => x.dataset.value === ${JSON.stringify(value)}); if (o) o.click() })()`)
  await sleep(900)
}

try {
  const open = await openSettings(page, { minCells: 3 })
  if (open !== true) { console.error('○ inconclusive: the Settings dialog did not open (is the GUI loaded?)'); process.exit(3) }
  const there = await waitFor(page, `!!document.querySelector('[data-kbr="brain-select"]')`, 15000)
  if (there === null) { console.error('○ inconclusive: Kybernos Settings did not show (does this sandbox serve this checkout?)'); process.exit(3) }
  await waitFor(page, `document.querySelector('[data-kbr="brain-select"]').disabled === false`, 15000)
  // The list as the person sees it: open it, read the items, close it.
  await val(`${trigger}.click()`); await sleep(400)
  const options = JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('.kbr-pick-opt')).map((o) => ({ v: o.dataset.value, t: o.textContent })))`))
  await val(`${trigger}.click()`); await sleep(200)

  console.log('the row')
  const text = await val(`document.body.innerText`)
  check('« Decision Brain » is gone: no row, no select, no word of it on the page', (await val(`!document.querySelector('[data-kbr="decision-brain"]') && !document.querySelector('[data-kbr="decision-brain-select"]')`)) === true && !/Decision Brain|\/v1\/evaluate/i.test(text))
  check('one brain setting, named « Study model »', (await val(`${row}.innerText`)).split('\n')[0].trim() === 'Study model' && (await val(`document.querySelectorAll('[data-kbr="brain"]').length`)) === 1)
  check('the first choice is Automatic (the empty value), the last is None', options.length >= 2 && options[0].v === '' && /^Automatic/.test(options[0].t) && options[options.length - 1].v === 'none' && options[options.length - 1].t === 'None', options.slice(0, 3))
  const outOfLoop = options.filter((o) => o.v !== '' && o.v !== 'none' && !/not configured anymore/.test(o.t))
  check('the configured models (grouped by route, searchable) sit between the two', options.length === 2 + outOfLoop.length + options.filter((o) => /not configured anymore/.test(o.t)).length, { n: outOfLoop.length })
  await val(`${trigger}.click()`); await sleep(300)
  check('the list has a search field, focused on opening, and typing filters it', (await val(`document.activeElement && document.activeElement.type === 'search'`)) === true)
  await val(`document.querySelector('.kbr-pick-in').focus()`)
  await page.send('Input.insertText', { text: 'zzzz-no-such-model' }); await sleep(300)
  check('a search that matches nothing says so, and shows no item', (await val(`document.querySelectorAll('.kbr-pick-opt').length === 0 && /No model matches/.test(document.querySelector('.kbr-pick-none').textContent)`)) === true)
  await val(`${trigger}.click()`); await sleep(200)

  const start = await settings()
  check('the host announces the Study model in force (and no list of decision models)', start.etude !== undefined && typeof start.etude.mode === 'string' && !('modelesDecision' in start) && !('decisionBrain' in start.reglages), start)
  check('by default the setting is empty: Automatic', start.reglages.brain === '' && start.etude.mode !== 'none' && start.etude.mode !== 'choisi', start.reglages)
  const label = options[0].t
  const auto = start.etude.auto
  check('the first choice names the model Automatic uses, or says none is connected', auto !== '' ? label === 'Automatic — ' + auto : /no model is connected yet/.test(label), { label, auto })
  const desc0 = await val(`${row}.innerText`)
  check('the row says what it does, and that a title leaves the machine only when the word rules cannot place it', /word rules/i.test(desc0) && /Automatic/.test(desc0) && !/probabilit/i.test(desc0), desc0)
  // R-V-01: the closed select reads its whole sentence (it was cut at « Automatic — no model is conn… » by a 240 px cap), also with a
  // real model id, and never leaves the row. `need` = the width the same select would take with only that label inside.
  const fit = (labelText) => val(`(() => {
    const sel = document.querySelector('[data-kbr="brain-select"]')
    const cur = sel.querySelector('.kbr-pick-cur')
    const was = cur.textContent
    if (${JSON.stringify(labelText)} !== null) cur.textContent = ${JSON.stringify(labelText)}
    const s = sel.getBoundingClientRect(); const r = sel.closest('[data-kbr="brain"]').getBoundingClientRect()
    const out = { cut: cur.scrollWidth > cur.clientWidth + 1, width: s.width, inside: s.left >= r.left - 1 && s.right <= r.right + 1 }
    cur.textContent = was
    return JSON.stringify(out)
  })()`).then((t) => JSON.parse(t))
  const f1 = await fit(null)
  check('the closed button shows its selected sentence in full (no ellipsis), inside the row', f1.cut === false && f1.inside === true, f1)
  const f2 = await fit('Automatic — openrouter/anthropic/claude-sonnet-4.5')
  check('...and « Automatic — openrouter/anthropic/claude-sonnet-4.5 », inside the row', f2.cut === false && f2.inside === true, f2)
  if (shotDir !== null) { try { await page.shot(join(shotDir, 'study-model-automatic.png')) } catch (e) { /* no screenshot */ } }

  console.log('None')
  await choose('none')
  const none = await settings()
  check('None is kept by the host: the setting is « none », nobody watches', none.reglages.brain === 'none' && none.etude.mode === 'none' && none.etude.actif === false, none)
  check('the select and the words follow', (await val(`document.querySelector('[data-kbr="brain-select"]').dataset.value`)) === 'none' && /None: no model is watched/.test(await val(`${row}.innerText`)))
  const sentence = await decide({ categorie: 'Projet Mars' })
  check('with None, a title the word rules cannot place is sent to no model', sentence.ok === false && sentence.code === 'ETUDE-ABSENTE', sentence)
  const words = await decide({ categorie: 'Nettoyage du repo' })
  check('...and the word rules still pick the icon', words.ok === true && words.motif === 'local' && words.categorie === 'nettoyage', words)
  if (shotDir !== null) { try { await page.shot(join(shotDir, 'study-model-none.png')) } catch (e) { /* no screenshot */ } }

  console.log('Choose another…')
  if (outOfLoop.length > 0) {
    await choose(outOfLoop[0].v)
    const pick = await settings()
    check('a configured model, picked: kept as the person\'s choice', pick.reglages.brain === outOfLoop[0].v && pick.etude.mode === 'choisi' && pick.etude.cle === outOfLoop[0].v, pick)
    check('the words say it is a pick', /^.*Your pick\./s.test(await val(`${row}.innerText`)))
  } else console.log('  (no model configured in this sandbox: the list is not exercised)')

  console.log('back to Automatic')
  await choose('')
  const back = await settings()
  check('Automatic again: the setting is empty', back.reglages.brain === '' && back.etude.mode !== 'none' && back.etude.mode !== 'choisi', back)
  check('...and the select reads Automatic', (await val(`document.querySelector('[data-kbr="brain-select"]').dataset.value`)) === '' && /^Automatic/.test(await val(`document.querySelector('[data-kbr="brain-select"] .kbr-pick-cur').textContent`)))
  const gone = await decide({ state: 'x', questions: { q: { type: 'boolean' } } })
  check('the old free typed question is refused, not sent anywhere', gone.ok === false && gone.code === 'QUESTION-NON-SUPPORTEE', gone)
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + e.message)
} finally {
  // Whatever happened, leave the sandbox on Automatic.
  try { await val(`fetch('/kybernos-sessions/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"brain":""}' }).then((r) => r.status)`, 6000) } catch (e) { /* the sandbox is nobody's */ }
  await live.close()
}
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
