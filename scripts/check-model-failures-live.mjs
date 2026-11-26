#!/usr/bin/env node
// What a person reads when the Kybernos model fails: one bad turn at a time (the provider answers 503, 429, 401, then fails once and recovers), in the real GUI of account A's
// sandbox, against the local replica. The replica's control port makes the stand-in provider fail (POST /__/engine/fail), so no real model, key or money is involved.
//
//   source "$KB_E2E_DIR/env.sh" && node scripts/check-model-failures-live.mjs        (KB_E2E_HOME_A / KB_E2E_HOST_A of the replica harness; no sandbox env: it changes HOME)
//
// A script decides only what is mechanical: something is said within the time limit, the plugin's plain card (« The model isn't answering right now » / « The model is busy »)
// stands above the box with no raw JSON, `undefined`, stack or provider address, the composer is still there, and the next turn answers once the failure ends. The engine's own red row
// keeps the server's raw body (« This turn failed502: {…} »): it is the engine's, there is no engine patch, so it is printed (« SAID ») but not judged. WHETHER the sentence is the right one for the person (what it tells them to do) is not decided here: every sentence is
// printed (« SAID … ») for the owner or a second reader. The failure is always ended, whatever happens.
// Exit 0 all green, 1 a check failed, 3 inconclusive (no replica, no composer).
import { makeContext, openGui, sleep, chatCalls } from './e2e-teams/common.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const LEAK = /undefined|NaN|\[object|\{\s*"|Error:|\bat \S+ \(|prov\.example|ECONN|ETIMEDOUT|stack/i
const ANSWER = 'Stand-in answer, all good.'
const LIMIT = 90000

let ctx
try { ctx = await makeContext() } catch (e) { console.error('○ inconclusive: ' + e.message); process.exit(3) }
const post = (path, body) => ctx.server.control(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const host = ctx.as('a')
let g
try { g = await openGui(host); await sleep(2500); await g.selectModel('GLM') } catch (e) { console.error('○ inconclusive: ' + e.message); process.exit(3) }

const bodyText = async () => String(await g.val(`document.body.innerText`) || '')
let n = 0
/** Sends one message, waits for an answer or a failure sentence, and returns what the page said after it, how long it took and what the server answered. */
const turn = async () => {
  n += 1
  const marker = `W2-08 turn ${n}`
  const since = Date.now()
  await g.send(marker)
  const t0 = Date.now()
  const seen = await g.until(async () => {
    const t = await bodyText()
    const tail = t.slice(t.lastIndexOf(marker) + marker.length)
    return /This turn failed|Something went wrong|could not|unavailable|try again/i.test(tail) || tail.includes(ANSWER) ? tail : null
  }, LIMIT, 500)
  const tail = typeof seen === 'string' ? seen : (await bodyText()).split(`W2-08 turn ${n}`).pop() || ''
  await sleep(1200)
  const said = tail.replace(/\s+/g, ' ').trim().slice(0, 320)
  return { said, answered: said.includes(ANSWER), spoke: typeof seen === 'string', seconds: Math.round((Date.now() - t0) / 1000), statuses: [...new Set(chatCalls(ctx.rows(since)).map((r) => r.status))].sort() }
}
const composerOk = async () => (await g.composerPos()) !== null && (await g.composerPos()) !== undefined

try {
  await post('/__/engine/fail', { match: '' })
  await ctx.engine({ text: ANSWER, prompt: 1, completion: 1 })

  console.log('a turn that works')
  const base = await turn()
  check('the stand-in answers a normal turn', base.answered, base)

  for (const status of [503, 429, 401]) {
    console.log(`\nthe provider answers ${status}`)
    await post('/__/engine/fail', { match: 'prov.example.test', status })
    const r = await turn()
    console.log(`  SAID (${status}, ${r.seconds} s, server statuses ${JSON.stringify(r.statuses)}): ${r.said}`)
    check(`${status}: the person is told something within ${LIMIT / 1000} s`, r.spoke && !r.answered, r)
    const card = await g.val(`(() => { const c = document.querySelector('[data-kb="model-down"]'); return c ? { kind: c.getAttribute('data-kind'), text: c.innerText.replace(/\\s+/g, ' ').trim() } : null })()`)
    console.log(`  CARD (${status}): ${card === null ? 'none' : card.text}`)
    check(`${status}: a plain card stands above the box (${status === 429 ? 'busy' : 'down'})`, card !== null && card.kind === (status === 429 ? 'busy' : 'down'), card)
    check(`${status}: the card has no raw JSON, undefined, stack, status code or provider address`, card !== null && !LEAK.test(card.text) && !/\b(50\d|429|401)\b/.test(card.text), card)
    check(`${status}: the composer is still there`, await composerOk())
    await post('/__/engine/fail', { match: '' })
  }

  console.log('\none failure, then the provider is back')
  await post('/__/engine/fail', { match: 'prov.example.test', status: 503, n: 1 })
  const once = await turn()
  console.log(`  SAID (one 503, ${once.seconds} s, server statuses ${JSON.stringify(once.statuses)}): ${once.said}`)
  check('one failure: the turn ends either with the answer (retried) or with a sentence, never silent', once.spoke, once)

  console.log('\nafter the failure ends')
  await post('/__/engine/fail', { match: '' })
  const back = await turn()
  check('the next turn answers with no reload', back.answered, back)
  check('and the card is gone with the new turn', (await g.val(`!document.querySelector('[data-kb="model-down"]')`)) === true)
} finally {
  try { await post('/__/engine/fail', { match: '' }) } catch (e) { /* the replica is gone */ }
  try { await ctx.engine({ text: "Hello from the replica's stand-in model.", prompt: 1, completion: 1 }) } catch (e) { /* idem */ }
  try { await g.live.close() } catch (e) { /* closed */ }
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}, ${pass} passed`)
process.exit(fail === 0 ? 0 : 1)
