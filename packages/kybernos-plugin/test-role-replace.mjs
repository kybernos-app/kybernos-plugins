#!/usr/bin/env node
/** A role whose model stopped answering: the alert and the optional automatic replacement of the Roles tab.
 *  Owner, 2026-10-29: « si un rôle échoue il déclare une alerte dans Agent Team; si le user active un toggle "Replace failed models with equivalent
 *  ones", alors le changement est automatique » (no new probe: the role status and model health the tab already has).
 *
 *  The pure part is the `KB-REPLACE` block of client.js, run as it is (ranking, who may be changed without asking, the journal and its undo, the banner);
 *  the wiring is pinned at source level (the bundle is a browser module). The matching measurement on the real GUI is `node scripts/check-roles-live.mjs`.
 *
 *  Usage: node packages/kybernos-plugin/test-role-replace.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(process.env.KB_PLUGIN_CLIENT || join(here, 'client.js'), 'utf8')

const a = src.indexOf('// KB-REPLACE-BEGIN')
const b = src.indexOf('// KB-REPLACE-END')
assert.ok(a > 0 && b > a, 'the KB-REPLACE block exists')
const api = vm.runInNewContext(src.slice(a, b) + '\n;({ KB_REPLACE_ORDER, KB_REPLACE_BAND, KB_REPLACE_COOLDOWN_H, KB_REPLACE_KEEP, KB_REPLACE_WHY, kbReplaceBest, kbReplaceCause, kbReplaceDecide, kbReplaceLogAdd, kbReplaceActive, kbReplaceUndo, kbReplaceSig, kbReplaceBanner, kbReplacePair })')
const J = (v) => JSON.parse(JSON.stringify(v))

// The route kind of the tab is read from the provider's name; a test stand-in with the same four kinds.
const kindOf = (m) => m.kind
const row = (id, provider, kind, priceIn, priceOut) => ({ id, provider, kind, priceIn, priceOut })
// A ranking stand-in: the cheapest first (the tab ranks by its priority; what the block must do is take the first of the list it is given).
const rank = (l) => l.slice().sort((x, y) => ((x.priceIn + x.priceOut) - (y.priceIn + y.priceOut)) || (x.id < y.id ? -1 : 1))
const best = (cands, extra) => api.kbReplaceBest(Object.assign({ cands, declared: 'mimo-v2.6-pro', old: row('mimo-v2.6-pro', 'xiaomi-token-plan-ams', 'plan', 1, 3), kindOf, rank }, extra || {}))

// 1. the routes come in the order the mockup promised: plans, Kybernos, the person's own keys, local
{
  assert.deepEqual(J(api.KB_REPLACE_ORDER), ['plan', 'kybernos', 'key', 'local'])
  const r = best([row('c', 'deepinfra', 'key', 0.1, 0.2), row('b', 'kybernos', 'kybernos', 0.5, 1), row('a', 'opencode-go', 'plan', null, null), row('d', 'ollama', 'local', 0, 0)])
  assert.equal(r.model.id, 'a')
  assert.equal(r.kind, 'plan')
  assert.equal(best([row('b', 'kybernos', 'kybernos', 0.5, 1), row('c', 'deepinfra', 'key', 0.1, 0.2)]).model.id, 'b', 'a Kybernos route beats a cheaper key')
  assert.equal(best([row('c', 'deepinfra', 'key', 0.1, 0.2), row('d', 'ollama', 'local', 0, 0)]).model.id, 'c')
  assert.equal(best([row('d', 'ollama', 'local', 0, 0)]).model.id, 'd')
  ok('plans first, then Kybernos, then own keys, then local: a plan model wins even over a cheaper one elsewhere')
}

// 2. on a route the same model wins when it is there, else the best ranked
{
  const r = best([row('zzz', 'opencode-go', 'plan', 9, 9), row('mimo-v2.6-pro', 'opencode-go', 'plan', 1, 3), row('aaa', 'opencode-go', 'plan', 0.1, 0.1)])
  assert.equal(r.model.id, 'mimo-v2.6-pro')
  assert.equal(r.same, true)
  const r2 = best([row('mimo/mimo-v2.6-pro', 'opencode-go', 'plan', 1, 3), row('aaa', 'opencode-go', 'plan', 0.1, 0.1)])
  assert.equal(r2.model.id, 'mimo/mimo-v2.6-pro', 'the same model under another provider prefix is the same model')
  const r3 = best([row('zzz', 'opencode-go', 'plan', 9, 9), row('aaa', 'opencode-go', 'plan', 0.1, 0.1)])
  assert.equal(r3.model.id, 'aaa')
  assert.equal(r3.same, false)
  ok('on a route the same model is kept when it is there, else the best ranked')
}

// 3. the price band: up to a quarter more than the old model per million tokens, on priced routes; plans and unknown prices always qualify
{
  assert.equal(api.KB_REPLACE_BAND, 1.25)
  const old = row('old', 'deepinfra', 'key', 2, 2) // 4 per million
  const within = row('w', 'kybernos', 'kybernos', 2.5, 2.5) // 5 = exactly +25 %
  const over = row('o', 'kybernos', 'kybernos', 2.6, 2.6) // 5.2
  assert.equal(best([within], { old }).overBand, false, 'exactly a quarter more is inside the band')
  const r = best([over], { old })
  assert.equal(r.model.id, 'o')
  assert.equal(r.overBand, true, 'above the band it is still proposed, and flagged')
  // a route with only over-band models gives way to the next route that has one inside the band, in the usual order
  const r2 = best([over, row('k', 'deepinfra', 'key', 1, 1)], { old })
  assert.equal(r2.model.id, 'k')
  assert.equal(r2.overBand, false)
  assert.equal(best([row('p', 'opencode-go', 'plan', 50, 50)], { old }).overBand, false, 'a plan model has no per-token price and always qualifies')
  assert.equal(best([row('u', 'kybernos', 'kybernos', null, null)], { old }).overBand, false, 'an unknown price is not a reason to refuse')
  assert.equal(best([over], { old: row('old', 'deepinfra', 'key', null, null) }).overBand, false, 'no price for the old model: no band')
  assert.equal(best([over], { old: null }).overBand, false, 'no row for the old model: no band')
  assert.equal(best([row('f', 'kybernos', 'kybernos', 0.1, 0.1)], { old: row('free', 'ollama', 'local', 0, 0) }).overBand, true, 'a free model is replaced by a free one, not by a priced one')
  ok('priced routes stay within a quarter above the old price; plans and unknown prices always qualify; above the band it is only proposed')
}

// 4. nothing to offer
{
  assert.equal(best([]), null)
  assert.equal(api.kbReplaceBest({ cands: undefined, declared: '', old: null, kindOf, rank }), null)
  ok('no equivalent model: null')
}

// 5. the cause of a failure read from the probe note
{
  for (const t of ['HTTP 401 Unauthorized', 'invalid api key', 'Incorrect API key provided', '403 forbidden', 'API key missing', 'key was rejected', 'no api key']) assert.equal(api.kbReplaceCause(t), 'key', t)
  for (const t of ['timeout after 30 s', 'model not found', 'HTTP 500', '', null, undefined, 'catalogue']) assert.equal(api.kbReplaceCause(t), 'other', String(t))
  ok('a refused key is told apart from a model that is down')
}

// 6. who may be changed without asking
{
  const sg = { model: row('a', 'opencode-go', 'plan', null, null), overBand: false }
  const base = { rootId: 'installed', cause: 'other', held: false, suggestion: sg, log: [], id: 'orch', now: Date.parse('2026-10-29T15:00:00Z') }
  assert.deepEqual(J(api.kbReplaceDecide(base)), { auto: true, why: '' })
  assert.equal(api.kbReplaceDecide(Object.assign({}, base, { rootId: 'workspace' })).why, 'workspace', 'a team in the project folder only gets a proposal')
  assert.equal(api.kbReplaceDecide(Object.assign({}, base, { cause: 'key' })).why, 'key', 'a refused key is not replaced: the key comes first')
  assert.equal(api.kbReplaceDecide(Object.assign({}, base, { held: true })).why, 'held', 'what the person undid is not redone')
  assert.equal(api.kbReplaceDecide(Object.assign({}, base, { suggestion: null })).why, 'none')
  assert.equal(api.kbReplaceDecide(Object.assign({}, base, { suggestion: Object.assign({}, sg, { overBand: true }) })).why, 'price')
  const recent = [{ n: 1, id: 'orch', by: 'auto', at: '2026-10-29T10:00:00Z' }] // five hours before: inside the six-hour cool-down
  assert.equal(api.kbReplaceDecide(Object.assign({}, base, { log: recent })).why, 'recent', 'a role that failed again right after an automatic change is not swapped in a loop')
  assert.equal(api.kbReplaceDecide(Object.assign({}, base, { log: [{ n: 1, id: 'orch', by: 'auto', at: '2026-10-29T08:00:00Z' }] })).auto, true, 'seven hours later it may be')
  assert.equal(api.kbReplaceDecide(Object.assign({}, base, { log: [{ n: 1, id: 'orch', by: 'you', at: '2026-10-29T14:59:00Z' }] })).auto, true, 'a change made by hand does not start the cool-down')
  assert.equal(api.kbReplaceDecide(Object.assign({}, base, { log: [{ n: 1, id: 'other-role', by: 'auto', at: '2026-10-29T14:59:00Z' }] })).auto, true, 'the cool-down is per role')
  for (const k of ['workspace', 'key', 'held', 'recent', 'price', 'none']) assert.ok(typeof api.KB_REPLACE_WHY[k] === 'string' && api.KB_REPLACE_WHY[k].length > 10, 'a sentence for ' + k)
  ok('only a role of the person\'s own teams, with a working cause, a close price and no recent swap is changed by itself')
}

// 7. the journal and its undo
{
  const e1 = { n: 1, id: 'orch', name: 'Orchestrateur', from: { provider: 'xiaomi-token-plan-ams', model: 'mimo-v2.6-pro', fallback: 'deepseek-v4.1-flash' }, to: { provider: 'opencode-go', model: 'glm-5.2' }, by: 'auto', at: '2026-10-29T14:32:00Z' }
  const e2 = { n: 2, id: 'liv', name: 'Livreur', from: e1.from, to: e1.to, by: 'you', at: '2026-10-29T14:33:00Z' }
  let log = api.kbReplaceLogAdd([], [e1, e2])
  assert.deepEqual(J(log.map((e) => e.n)), [1, 2])
  log = api.kbReplaceLogAdd(log, [{ n: 3, id: 'x', from: e1.from, to: e1.to, by: 'auto', at: 'z' }])
  assert.deepEqual(J(log.map((e) => e.n)), [3, 1, 2], 'newest first')
  let long = []
  for (let i = 0; i < 45; i += 1) long = api.kbReplaceLogAdd(long, [{ n: i, id: 'r' + i }])
  assert.equal(long.length, api.KB_REPLACE_KEEP, 'the journal is bounded')
  assert.equal(long[0].n, 44)

  const cur = { orch: { provider: 'opencode-go', model: 'glm-5.2' }, liv: { provider: 'xiaomi-token-plan-ams', model: 'mimo-v2.6-pro' } }
  const active = api.kbReplaceActive([e1, e2], (id) => cur[id] || null)
  assert.deepEqual(J(active.map((e) => e.n)), [1], 'a role changed by hand since is no longer listed')
  assert.deepEqual(J(api.kbReplaceActive([Object.assign({}, e1, { undone: true })], (id) => cur[id])), [], 'an undone entry is not listed')
  assert.deepEqual(J(api.kbReplaceActive([e1], () => null)), [], 'a role that is gone is not listed')
  assert.equal(api.kbReplaceActive([Object.assign({}, e1, { to: { provider: 'OpenCode-Go', model: 'GLM-5.2' } })], (id) => cur[id]).length, 1, 'the match ignores case')

  const u = api.kbReplaceUndo([e1, e2], 1, cur.orch)
  assert.deepEqual(J(u.restore), { id: 'orch', provider: 'xiaomi-token-plan-ams', model: 'mimo-v2.6-pro', fallback: 'deepseek-v4.1-flash' }, 'the old model and its old fallback go back')
  assert.equal(api.kbReplaceUndo([e2], 2, cur.liv).restore, null, 'e2 runs on the old model already (changed by hand): nothing to restore')
  assert.equal(u.log.find((e) => e.n === 1).undone, true)
  assert.equal(u.log.find((e) => e.n === 2).undone, undefined, 'only that entry is marked')
  const u2 = api.kbReplaceUndo([e1], 1, { provider: 'deepinfra', model: 'other' })
  assert.equal(u2.restore, null, 'nothing is written back over a model the person picked since')
  assert.equal(u2.log[0].undone, true)
  assert.equal(api.kbReplaceUndo([e1], 99, cur.orch).restore, null, 'an unknown entry restores nothing')
  assert.deepEqual(J(e1), J(Object.assign({}, e1)), 'the entry given is not mutated')
  assert.equal(e1.undone, undefined)
  ok('the journal is newest first and bounded; undo writes the old model back only while the role still runs on the replacement')
}

// 8. the banner
{
  const now = Date.parse('2026-10-29T15:00:00Z')
  const f1 = { id: 'orch', name: 'Orchestrateur', provider: 'xiaomi-token-plan-ams', model: 'mimo-v2.6-pro', why: '' }
  const f2 = { id: 'liv', name: 'Livreur', provider: 'xiaomi-token-plan-ams', model: 'mimo-v2.6-pro', why: 'key' }
  const sig = api.kbReplaceSig([f2, f1])
  assert.equal(sig, api.kbReplaceSig([f1, f2]), 'the signature does not depend on the order')
  assert.notEqual(sig, api.kbReplaceSig([f1]))
  const bn = api.kbReplaceBanner({ failed: [f1, f2], dismissed: '', active: [], movedAfter: 0, now })
  assert.equal(bn.kind, 'fail')
  assert.equal(bn.failed.length, 2)
  assert.deepEqual(J(bn.reasons), ['key'], 'the reasons nothing was changed by itself, once each')
  assert.equal(bn.sig, sig)
  assert.equal(api.kbReplaceBanner({ failed: [f1, f2], dismissed: sig, active: [], movedAfter: 0, now }), null, 'dismissed: the banner is gone until the failures change')
  assert.equal(api.kbReplaceBanner({ failed: [f1], dismissed: sig, active: [], movedAfter: 0, now }).kind, 'fail', 'a different set of failures comes back')
  const e = { n: 1, id: 'orch', by: 'auto', at: '2026-10-29T14:32:00Z', to: {}, from: {} }
  const mv = api.kbReplaceBanner({ failed: [], dismissed: '', active: [e], movedAfter: 0, now })
  assert.equal(mv.kind, 'moved')
  assert.equal(mv.auto, true)
  assert.equal(api.kbReplaceBanner({ failed: [], dismissed: '', active: [Object.assign({}, e, { by: 'you' })], movedAfter: 0, now }).auto, false)
  assert.equal(api.kbReplaceBanner({ failed: [], dismissed: '', active: [e], movedAfter: Date.parse('2026-10-29T14:40:00Z'), now }), null, 'dismissed: only newer changes show')
  assert.equal(api.kbReplaceBanner({ failed: [], dismissed: '', active: [Object.assign({}, e, { at: '2026-10-28T10:00:00Z' })], movedAfter: 0, now }), null, 'a change older than a day no longer shouts')
  assert.equal(api.kbReplaceBanner({ failed: [f1], dismissed: '', active: [e], movedAfter: 0, now }).kind, 'fail', 'a failure outranks the news of a change')
  assert.equal(api.kbReplaceBanner({ failed: [], dismissed: '', active: [], movedAfter: 0, now }), null, 'nothing to say, nothing shown')
  ok('one banner for the team: failures (with why nothing moved), else the last day\'s changes; dismissal is per set of failures')
}

// 9. the wiring, pinned in the source
{
  assert.ok(/Replace failed models with equivalent ones/.test(src), 'the toggle says what the mockup says')
  assert.ok(/kbReplaceBest\(\{/.test(src.slice(b)), 'the review proposal and the automatic change use the same ranking function')
  assert.ok(/kbReplaceDecide\(\{/.test(src.slice(b)), 'the decision to change by itself goes through kbReplaceDecide')
  assert.ok(/kbReplaceBanner\(\{/.test(src.slice(b)), 'the banner is drawn from kbReplaceBanner')
  assert.ok(/rootId: rootId/.test(src.slice(b)) || /rootId === 'workspace'/.test(src), 'the root of the team reaches the decision')
  assert.ok(/autoReplace/.test(src.slice(b)), 'the switch is a preference of the team')
  ok('the tab draws the banner, the toggle and the history from this block')
}

console.log('\n' + pass + ' checks passed')
