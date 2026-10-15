#!/usr/bin/env node
// The host-side translation job (i18n-job.mjs), with the model replaced by a fake that fails the way models fail.
//
//   node packages/kybernos-plugin/test-i18n-job.mjs
//
// What is pinned here, because a run costs minutes of model time and real money:
//  - what lands is on the disk as it lands, and the disk (not a counter) says what is done: a run that is killed,
//    paused, failed or resumed neither loses a text nor translates one twice;
//  - a transient failure (rate limit, timeout, garbled answer) is retried with backoff and jitter; a failure waiting
//    cannot fix (no key, no model, quota) stops at once and says why; batches that keep failing stop the run;
//  - a run the host is killed in is picked up again at boot (or waits for a click when the automatic resume is off);
//  - one run at a time, a second start of the same language attaches, a removed language ends its run.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createI18nStore } from './i18n-store.mjs'
import { BREAKER, CONCURRENCY, createJobRunner, hashText, isFatal, isTestMark, planBatches, sanitizeStart, serveJobs, splitWire } from './i18n-job.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const section = (t) => console.log('\n' + t)
const tmp = () => mkdtempSync(join(tmpdir(), 'kb-i18n-job-'))

const items = (n, area = 'core', prefix = 'k') => Array.from({ length: n }, (_, i) => ({ wire: 'kb:' + prefix + i, text: 'Texte ' + prefix + i, area }))
const startBody = (lang, its, over = {}) => ({ op: 'start', lang, langName: 'Español', source: 'fr', route: { provider: 'p', model: 'm' }, items: its, total: its.length, ...over })

/** A fake model: `script(batchKeys, callIndex)` may return 'ok', an error string, or a partial answer. */
const fakeModel = (script) => {
  const calls = []
  const translate = async (args) => {
    const keys = Object.keys(args.batch)
    const n = calls.length
    calls.push({ keys, provider: args.provider, model: args.model, signal: args.signal, hints: args.hints })
    // A model call that is told to stop returns (as the real one does): a never-ending fake must not hang the test.
    const aborted = new Promise((resolve) => { if (args.signal) { if (args.signal.aborted) resolve('p/m : ABORTED — interrompu'); else args.signal.addEventListener('abort', () => resolve('p/m : ABORTED — interrompu'), { once: true }) } })
    const verdict = await Promise.race([script(keys, n, args), aborted])
    if (verdict === 'ok' || verdict === undefined) {
      const translations = {}
      for (const k of keys) translations[k] = 'T(' + args.batch[k] + ')'
      return { ok: true, translations, provider: 'prov', model: 'mod' }
    }
    if (typeof verdict === 'string') return { ok: false, error: verdict }
    return verdict
  }
  return { translate, calls }
}
const make = (over = {}) => {
  const dir = over.dir || tmp()
  const store = createI18nStore({ dir })
  const sleeps = []
  const model = over.model || fakeModel(() => 'ok')
  let t = 1000
  const runner = createJobRunner({ dir, store, translate: model.translate, now: () => { t += 10; return t }, sleep: async (ms) => { sleeps.push(ms) }, random: () => 0.5, ...over.opts })
  return { dir, store, runner, sleeps, model }
}
const stateOf = (r, lang = 'es') => r.runner.status(lang)

try {
  section('the pure parts')
  {
    check('batches hold at most 40 texts and 2 600 characters, in order', (() => {
      const b = planBatches(Array.from({ length: 100 }, (_, i) => ({ wire: 'kb:' + i, text: 'x'.repeat(100) })))
      return b.every((x) => x.length <= 26) && b.flat().length === 100 && b[0][0].wire === 'kb:0'
    })())
    check('a test mark is not a translation', isTestMark('⟦Hola⟧') && !isTestMark('Hola') && !isTestMark('⟦') )
    check('what waiting fixes is not fatal, what the person must fix is', !isFatal('p/m : RATE_LIMIT — slow down') && !isFatal('quota per minute exceeded, retry later') && isFatal('p/m : MISSING_CREDENTIAL — no key') && isFatal('aucun modele disponible') && isFatal('p/m : QUOTA — exhausted'))
    check('a wire id is a Kybernos or DSH key, nothing else', splitWire('kb:menu.title').section === 'kb' && splitWire('dsh:ns::key').id === 'ns::key' && splitWire('live:x') === null && splitWire('kb:') === null && splitWire('nokey') === null)
    check('a start is checked: reserved language, bad item, unknown area, nothing to do', sanitizeStart(startBody('en', items(1))).ok === false && sanitizeStart(startBody('es', [{ wire: 'live:a', text: 'x', area: 'core' }])).ok === false && sanitizeStart(startBody('es', [{ wire: 'kb:a', text: 'x', area: 'zzz' }])).ok === false && sanitizeStart(startBody('es', [])).ok === false)
    const dup = sanitizeStart(startBody('es', [...items(2), { wire: 'kb:k0', text: 'again', area: 'core' }]))
    check('a repeated key is kept once; a route without a provider is dropped', dup.ok === true && dup.spec.items.length === 2 && sanitizeStart({ ...startBody('es', items(1)), route: { model: 'm' } }).spec.route === null)
  }

  section('a run that goes well')
  {
    const x = make()
    const its = [...items(5, 'core', 'c'), ...items(4, 'more', 'm'), ...items(3, 'phrases', 'p')]
    const r = x.runner.start(startBody('es', its, { total: 20 })) // 8 were already held
    check('it starts and says it is running', r.ok === true && r.attached === false && r.job.state === 'running' && r.job.done === 8 && r.job.total === 20)
    await x.runner.idle()
    const st = stateOf(x)
    check('every text is on the disk, as the model wrote it', st.state === 'done' && st.done === 20 && x.store.read('es').kb.c0 === 'T(Texte c0)' && Object.keys(x.store.read('es').kb).length === 12)
    check('it counts the 8 that were held before, per area', st.areas.core.done === 5 + 0 && st.missing === 0, st.areas)
    check('the bilan the page reads is in the store', x.store.read('es').meta.complete === true && x.store.read('es').meta.done === 20 && x.store.read('es').meta.total === 20 && x.store.read('es').meta.essentials === true)
    check('a finished run is announced until acknowledged', st.acked === false && st.outcome === 'done' && typeof st.finishedAt === 'number')
    check('the model that really answered is recorded', st.model === 'prov/mod')
    x.runner.ack('es')
    check('acknowledging stops the announcement', stateOf(x).acked === true)
    const order = x.model.calls.flatMap((c) => c.keys)
    check('core texts go first, then the other areas (the language is usable early)', order.indexOf('kb:c0') < order.indexOf('kb:m0') && order.indexOf('kb:m0') < order.indexOf('kb:p0'))
    rmSync(x.dir, { recursive: true, force: true })
  }
  {
    const x = make({ model: fakeModel(() => 'ok') })
    x.runner.start(startBody('es', items(200)))
    await x.runner.idle()
    const routes = x.model.calls.slice(CONCURRENCY).map((c) => c.provider + '/' + c.model)
    check('after the first answers, the next calls use the route that answered', routes.length > 0 && routes.every((r) => r === 'prov/mod'), routes.slice(0, 3))
    rmSync(x.dir, { recursive: true, force: true })
  }

  section('failures')
  {
    // transient: the 1st and 2nd attempt of every batch hit a rate limit
    const attempts = new Map()
    const x = make({ model: fakeModel((keys) => { const id = keys[0]; attempts.set(id, (attempts.get(id) || 0) + 1); return attempts.get(id) <= 2 ? 'p/m : RATE_LIMIT — slow down' : 'ok' }) })
    x.runner.start(startBody('es', items(10)))
    await x.runner.idle()
    check('a rate limit is retried until it passes, and the run ends done', stateOf(x).state === 'done' && stateOf(x).done === 10)
    check('it waits between attempts: a growing delay, jittered inside ±25 %', x.sleeps.length === 2 && x.sleeps[0] >= 1500 && x.sleeps[0] <= 2500 && x.sleeps[1] >= 4500 && x.sleeps[1] <= 7500, x.sleeps)
    rmSync(x.dir, { recursive: true, force: true })
  }
  {
    const x = make({ model: fakeModel(() => 'p/m : MISSING_CREDENTIAL — no key for this provider') })
    x.runner.start(startBody('es', items(120)))
    await x.runner.idle()
    const st = stateOf(x)
    check('a missing key stops the run at once, with the cause', st.state === 'failed' && /MISSING_CREDENTIAL/.test(st.error) && st.outcome === 'failed' && st.acked === false)
    check('…without a single wait or retry, and without burning the whole queue', x.sleeps.length === 0 && x.model.calls.length <= CONCURRENCY, x.model.calls.length)
    rmSync(x.dir, { recursive: true, force: true })
  }
  {
    const x = make({ model: fakeModel(() => 'p/m : TIMEOUT — pas de reponse en 120 s') })
    x.runner.start(startBody('es', items(400)))
    await x.runner.idle()
    const st = stateOf(x)
    check('batches that keep failing stop the run (the cause is the model or the host, not one batch)', st.state === 'failed' && /TIMEOUT/.test(st.error))
    check('…after their own attempts, and not before three of them in a row', x.model.calls.length >= BREAKER * 4 && x.model.calls.length <= (BREAKER + CONCURRENCY) * 4 + 4, x.model.calls.length)
    rmSync(x.dir, { recursive: true, force: true })
  }
  {
    // a garbled answer once, then fine
    let first = true
    const x = make({ model: fakeModel(() => { if (first) { first = false; return 'p/m : réponse inexploitable (fin : stop)' } return 'ok' }) })
    x.runner.start(startBody('es', items(5)))
    await x.runner.idle()
    check('a truncated or garbled answer is a transient failure: retried, not fatal', stateOf(x).state === 'done')
    rmSync(x.dir, { recursive: true, force: true })
  }
  {
    // the model skips the odd key every time: pass 2 asks again, the run ends partial with the count of what is missing
    const x = make({ model: fakeModel((keys, n, args) => { const translations = {}; for (const k of keys) if (!/[05]$/.test(k)) translations[k] = 'T(' + args.batch[k] + ')'; return { ok: true, translations, provider: 'prov', model: 'mod' } }) })
    x.runner.start(startBody('es', items(20)))
    await x.runner.idle()
    const st = stateOf(x)
    check('texts the model leaves out are asked again once, then counted as missing: partial, not done', st.state === 'partial' && st.missing === 4 && st.done === 16, st)
    check('what it did translate is kept', Object.keys(x.store.read('es').kb).length === 16)
    rmSync(x.dir, { recursive: true, force: true })
  }
  {
    const x = make()
    x.store.write = () => ({ ok: false, error: 'disk full' })
    x.runner.start(startBody('es', items(3)))
    await x.runner.idle()
    check('a disk that refuses the write fails the run with that cause (never "translated" without being kept)', stateOf(x).state === 'failed' && /STORE_WRITE/.test(stateOf(x).error) && stateOf(x).done === 0)
    rmSync(x.dir, { recursive: true, force: true })
  }

  section('pause, resume, kill and restart')
  {
    // the model blocks until released, so the test chooses the moment
    const gates = []
    const model = fakeModel((keys) => new Promise((resolve) => { gates.push(() => resolve('ok')) }))
    const x = make({ model })
    x.runner.start(startBody('es', items(200)))
    await new Promise((r) => setTimeout(r, 20))
    check('three batches are in flight at once', model.calls.length === CONCURRENCY, model.calls.length)
    gates[0]() // one batch lands
    await new Promise((r) => setTimeout(r, 20))
    const p = x.runner.pause('es')
    check('pause answers at once with « pausing »', p.ok === true && p.job.state === 'pausing')
    check('and the calls in flight are told to stop', model.calls.every((c) => c.signal !== undefined) && model.calls.slice(1, 3).every((c) => c.signal.aborted === true))
    for (const g of gates) g()
    await x.runner.idle()
    const st = stateOf(x)
    check('the run ends paused, silently (nobody needs telling what they just asked)', st.state === 'paused' && st.acked === true)
    const kept = Object.keys(x.store.read('es').kb).length
    check('what had landed is on the disk', kept >= 40 && st.done === kept, { kept, done: st.done })
    // resume: a normal model now; nothing already done is asked for again
    const again = fakeModel(() => 'ok')
    const y = make({ dir: x.dir, model: again })
    const r = y.runner.resume('es')
    check('resume goes on from what the disk holds', r.ok === true)
    await y.runner.idle()
    const asked = new Set(again.calls.flatMap((c) => c.keys))
    const had = Object.keys(x.store.read('es').kb)
    check('it ends done, and never asks again for a text it already has', stateOf(y).state === 'done' && stateOf(y).done === 200 && had.length === 200 && asked.size < 200 && asked.size === 200 - kept, { asked: asked.size, kept })
    rmSync(x.dir, { recursive: true, force: true })
  }
  {
    // the host is killed mid-run: the state file says running, nobody is running it
    const dir = tmp()
    const hang = fakeModel(() => new Promise(() => {}))
    const a = make({ dir, model: hang })
    a.runner.start(startBody('es', items(60)))
    await new Promise((r) => setTimeout(r, 20))
    check('(setup) the run is stuck mid-flight, its state says running', stateOf(a).state === 'running')
    // "restart": a new runner on the same folder, as a new process would be
    const ok = fakeModel(() => 'ok')
    const b = make({ dir, model: ok })
    const resumed = b.runner.resumeInterrupted({ auto: true })
    check('at boot, with the automatic resume on, the interrupted run goes on by itself', resumed.length === 1 && resumed[0].lang === 'es' && resumed[0].resumed === true)
    await b.runner.idle()
    check('and finishes', stateOf(b).state === 'done' && stateOf(b).done === 60)
    // and with it off
    const dir2 = tmp()
    const c = make({ dir: dir2, model: hang })
    c.runner.start(startBody('es', items(10)))
    await new Promise((r) => setTimeout(r, 20))
    const quiet = fakeModel(() => 'ok')
    const d = make({ dir: dir2, model: quiet })
    const left = d.runner.resumeInterrupted({ auto: false })
    check('with the automatic resume off it waits, marked paused and interrupted, and costs nothing', left.length === 1 && left[0].resumed === false && stateOf(d).state === 'paused' && stateOf(d).interrupted === true && quiet.calls.length === 0)
    rmSync(dir, { recursive: true, force: true }); rmSync(dir2, { recursive: true, force: true })
  }
  {
    // a pseudo-translation on the disk is not a translation: it is asked again
    const dir = tmp()
    const store = createI18nStore({ dir })
    store.write('es', { kb: { k0: '⟦Texte k0⟧', k1: 'Ya traducido' } })
    const model = fakeModel(() => 'ok')
    const x = make({ dir, model })
    x.runner.start(startBody('es', items(3), { total: 3 }))
    await x.runner.idle()
    const keys = model.calls.flatMap((c) => c.keys)
    check('a test mark counts as missing and is replaced', x.store.read('es').kb.k0 === 'T(Texte k0)' && keys.indexOf('kb:k0') >= 0, keys)
    check('a real translation is left alone, and not even asked for', x.store.read('es').kb.k1 === 'Ya traducido' && keys.indexOf('kb:k1') < 0, keys)
    rmSync(dir, { recursive: true, force: true })
  }

  section('quality: one answer per text, told why it was refused, doubtful ones listed')
{
  // three keys with the same source text: the model is asked once, the answer goes to the three
  const x = make()
  x.runner.start(startBody('es', [
    { wire: 'kb:a', text: 'Enregistrer', area: 'core' }, { wire: 'kb:b', text: 'Enregistrer', area: 'core' },
    { wire: 'dsh:ns::c', text: 'Enregistrer', area: 'more' }, { wire: 'kb:d', text: 'Annuler', area: 'core' },
  ]))
  await x.runner.idle()
  const asked = x.model.calls.flatMap((c) => c.keys)
  check('a text that is the same under several keys is asked once', asked.length === 2 && asked.includes('kb:d'), asked)
  const pack = x.store.read('es')
  check('…and its answer is written under every key (one wording)', pack.kb.a === pack.kb.b && pack.dsh['ns::c'] === pack.kb.a && pack.kb.a === 'T(Enregistrer)', pack)
  check('the run counts the three keys as done', stateOf(x).done === 4 && stateOf(x).state === 'done')
  rmSync(x.dir, { recursive: true, force: true })
}
{
  // the checks refuse key « k1 » in the first call; the second pass asks for it alone, is told why, and the answer is kept
  const seen = []
  const model = fakeModel((keys, n, args) => {
    seen.push({ keys: keys.slice(), hints: Object.assign({}, args.hints) })
    const translations = {}
    const refused = {}
    for (const k of keys) {
      if (k === 'kb:k1' && n === 0) refused[k] = 'placeholder'
      else translations[k] = 'T(' + args.batch[k] + ')'
    }
    return { ok: true, provider: 'prov', model: 'mod', translations, refused, flagged: {} }
  })
  const x = make({ model })
  x.runner.start(startBody('es', items(3)))
  await x.runner.idle()
  check('a text the checks refuse is asked again in the second pass, alone, with the reason', seen.length === 2 && seen[1].keys.join() === 'kb:k1' && seen[1].hints['kb:k1'] === 'placeholder', seen)
  check('…and the corrected answer is kept', stateOf(x).state === 'done' && x.store.read('es').kb.k1 === 'T(Texte k1)')
  rmSync(x.dir, { recursive: true, force: true })
}
{
  // all refused at once: the failure carries the reasons, and the next ATTEMPT (same pass) is told
  let n = 0
  const model = fakeModel((keys, call, args) => {
    n += 1
    if (n === 1) return { ok: false, error: 'p/m : toutes les traductions ont été refusées par les contrôles (balises modifiées)', refused: { 'kb:k0': 'tags', 'kb:k1': 'tags' } }
    return 'ok'
  })
  const x = make({ model })
  x.runner.start(startBody('es', items(2)))
  await x.runner.idle()
  check('a batch refused whole is retried with the reason of each key', model.calls.length >= 2 && model.calls[1].hints['kb:k0'] === 'tags' && model.calls[1].hints['kb:k1'] === 'tags', model.calls.map((c) => c.hints))
  check('…and ends done once the corrected answer is kept', stateOf(x).state === 'done')
  rmSync(x.dir, { recursive: true, force: true })
}
{
  const model = fakeModel((keys, n, args) => ({ ok: true, provider: 'prov', model: 'mod', translations: Object.fromEntries(keys.map((k) => [k, 'T(' + args.batch[k] + ')'])), refused: {}, flagged: { 'kb:k1': 'unchanged' } }))
  const x = make({ model })
  x.runner.start(startBody('es', items(3)))
  await x.runner.idle()
  const st = stateOf(x)
  check('a doubtful text is kept and listed, with its reason', st.state === 'done' && st.flagged.count === 1 && st.flagged.examples[0].wire === 'kb:k1' && st.flagged.examples[0].why === 'unchanged' && x.store.read('es').kb.k1 === 'T(Texte k1)', st.flagged)
  rmSync(x.dir, { recursive: true, force: true })
}

section('a source that changed is found, and only that text is translated again')
{
  const x = make()
  x.runner.start(startBody('es', items(4)))
  await x.runner.idle()
  const pack = x.store.read('es')
  check('the host keeps the hash of the source it translated, for each text', Object.keys(pack.src).length === 4 && pack.src['kb:k0'] === hashText('Texte k0'), pack.src)
  const changed = items(4).map((i, n) => (n === 2 ? { ...i, text: 'Texte k2 — modifié' } : i))
  const s = x.runner.stale('es', changed)
  check('stale names the one whose source changed', s.ok === true && s.stale === 1 && s.wires.join() === 'kb:k2', s)
  check('a text with no recorded hash is not stale (older translations are trusted)', x.runner.stale('es', [{ wire: 'kb:unknown', text: 'x' }]).stale === 0 && x.runner.stale('ar', changed).stale === 0)
  const second = fakeModel(() => 'ok')
  const y = make({ dir: x.dir, model: second })
  y.runner.start({ ...startBody('es', changed), full: true })
  await y.runner.idle()
  check('a full plan translates only the stale one', second.calls.length === 1 && second.calls[0].keys.join() === 'kb:k2', second.calls.map((c) => c.keys))
  check('…and replaces its translation, keeping the others', y.store.read('es').kb.k2 === 'T(Texte k2 — modifié)' && y.store.read('es').kb.k0 === 'T(Texte k0)')
  check('the new hash is recorded', y.runner.stale('es', changed).stale === 0)
  rmSync(x.dir, { recursive: true, force: true })
}

section('a full plan: what the page holds is adopted, and a run with nothing to do is silent')
{
  const x = make()
  const its = items(5).map((i, n) => (n < 3 ? { ...i, have: 'Ya ' + i.text } : i))
  const r = x.runner.start({ ...startBody('es', its), full: true, total: 999, areas: { core: { total: 1, done: 1 } } })
  check('a full plan is its own total (the page\'s numbers are not believed)', r.job.total === 5)
  await x.runner.idle()
  const asked = x.model.calls.flatMap((c) => c.keys)
  check('texts the page holds are not asked from the model', asked.sort().join() === 'kb:k3,kb:k4', asked)
  check('…they are written to the disk as the page had them', x.store.read('es').kb.k0 === 'Ya Texte k0' && x.store.read('es').kb.k3 === 'T(Texte k3)')
  rmSync(x.dir, { recursive: true, force: true })
}
{
  const x = make()
  const full = items(4).map((i) => ({ ...i, have: 'Ya ' + i.text }))
  x.runner.start({ ...startBody('es', full), full: true })
  await x.runner.idle()
  const st = stateOf(x)
  check('everything held and fresh: no model call, « done », nothing to announce', x.model.calls.length === 0 && st.state === 'done' && st.idle === true && st.acked === true && st.done === 4, st)
  rmSync(x.dir, { recursive: true, force: true })
}
{
  // a full plan that has a bad item is refused whole, like a partial one
  const x = make()
  check('an item with a wire that is not a Kybernos or DSH key is refused', x.runner.start({ ...startBody('es', [{ wire: 'live:x', text: 'a', area: 'core' }]), full: true }).ok === false)
  rmSync(x.dir, { recursive: true, force: true })
}

section('one at a time, and the language is the person’s')
  {
    const model = fakeModel(() => new Promise(() => {}))
    const x = make({ model })
    const a = x.runner.start(startBody('es', items(10)))
    const same = x.runner.start(startBody('es', items(10)))
    const other = x.runner.start(startBody('fr-CA', items(10)))
    check('the same language again attaches to its run', same.ok === true && same.attached === true)
    check('another language is refused while one runs (two runs would double the bill)', other.ok === false && other.error === 'busy' && other.lang === 'es')
    check('(setup) the first one started', a.ok === true)
    const c = x.runner.cancel('es')
    await x.runner.idle()
    check('cancel forgets the run (plan and state), whatever the model was doing', c.ok === true && x.runner.status('es') === null && x.runner.status().length === 0)
    rmSync(x.dir, { recursive: true, force: true })
  }
  {
    // the language is removed while its run goes on: the store's tombstone ends the run
    const dir = tmp()
    let n = 0
    const model = fakeModel(async (keys, call) => { if (call === 0) { x.store.remove('es') } return 'ok' })
    const x = make({ dir, model })
    x.runner.start(startBody('es', items(400)))
    await x.runner.idle()
    check('a language removed on purpose ends its run, and the run does not bring it back', x.runner.status('es') === null || x.runner.status('es').state !== 'running', x.runner.status('es'))
    rmSync(dir, { recursive: true, force: true })
  }

  section('what is on the disk is damaged')
  {
    const dir = tmp()
    const x = make({ dir })
    mkdirSync(join(dir, 'jobs'), { recursive: true })
    writeFileSync(join(dir, 'jobs', 'es.state.json'), '{ not json')
    check('a damaged state file is "no job", not a crash', x.runner.status('es') === null && x.runner.status().length === 0 && x.runner.resume('es').ok === false)
    writeFileSync(join(dir, 'jobs', 'es.state.json'), JSON.stringify({ lang: 'es', state: 'running', total: 5, done: 0, areas: {}, startedAt: 1, acked: true }))
    check('a state without its plan cannot be resumed, and says so', x.runner.resume('es').ok === false && x.runner.resume('es').error === 'no such job')
    const r = x.runner.resumeInterrupted({ auto: true })
    await x.runner.idle()
    check('at boot such a run ends failed with a reason instead of staying « running » for ever', r.length === 1 && r[0].resumed === false && x.runner.status('es').state === 'failed' && /could not resume/.test(x.runner.status('es').error), x.runner.status('es'))
    rmSync(dir, { recursive: true, force: true })
  }

  section('the host wires it')
{
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
  check('index.js mounts the route, with the same origin guards as the other i18n routes', /path: '\/kybernos\/i18n-job'[\s\S]{0,200}serveJobs\(req, res, \{[\s\S]{0,200}sameOriginStrict, sameOriginLax/.test(src))
  check('the runner translates with the very function the old route uses (same model order, same placeholder guard)', /translate: \(args\) => i18nTranslate\(args\)/.test(src))
  check('a run left « running » by a process that died is resumed at boot, late and guarded, unless i18nAutoResume is false', /resumeInterrupted\(\{ auto \}\)/.test(src) && /i18nAutoResume !== false/.test(src) && /setTimeout\(\(\) => \{\s*Promise\.resolve\(\)/.test(src))
  const tr = readFileSync(new URL('./i18n-translate.mjs', import.meta.url), 'utf8')
  check('the model call takes the run\'s signal (a pause is not a wait for the timeout)', /req\.signal instanceof AbortSignal/.test(tr))
}

section('the route')
  {
    const dir = tmp()
    const model = fakeModel(() => 'ok')
    const x = make({ dir, model })
    const sent = []
    const io = {
      runner: async () => x.runner, sameOriginStrict: (r) => r.origin !== 'evil', sameOriginLax: (r) => r.origin !== 'evil',
      readJson: async (r) => r.body, query: (r) => new URLSearchParams(r.q || ''), send: (res, status, body) => { sent.push({ status, body }) },
    }
    await serveJobs({ method: 'POST', body: startBody('es', items(5)) }, {}, io)
    check('start answers with the job', sent[0].status === 200 && sent[0].body.job.state === 'running')
    await x.runner.idle()
    await serveJobs({ method: 'GET', q: 'lang=es' }, {}, io)
    check('GET ?lang answers its state', sent[1].body.job.state === 'done')
    await serveJobs({ method: 'GET' }, {}, io)
    check('GET lists them all', sent[2].body.jobs.length === 1)
    await serveJobs({ method: 'POST', body: { op: 'ack', lang: 'es' } }, {}, io)
    check('ack is accepted', sent[3].status === 200 && stateOf(x).acked === true)
    await serveJobs({ method: 'POST', origin: 'evil', body: startBody('es', items(1)) }, {}, io)
    check('a foreign origin cannot start a run', sent[4].status === 403)
    await serveJobs({ method: 'POST', body: { op: 'rm -rf' } }, {}, io)
    check('an unknown op is a 400', sent[5].status === 400)
    await serveJobs({ method: 'POST', body: { op: 'pause', lang: '../etc' } }, {}, io)
    check('a language id that is not one never reaches a file name', sent[6].status === 400)
    await serveJobs({ method: 'DELETE' }, {}, io)
    check('any other verb is a 405', sent[7].status === 405)
    await serveJobs({ method: 'GET' }, {}, { ...io, runner: async () => { throw new Error('boom') } })
    check('a host fault never escapes the route', sent[8].status === 500 && sent[8].body.ok === false)
    await serveJobs({ method: 'POST', body: startBody('es', items(2)) }, {}, { ...io, readJson: async () => { throw new Error('too big') } })
    check('a body over the cap is a 413', sent[9].status === 413)
    const huge = Array.from({ length: 40001 }, (_, i) => ({ wire: 'kb:' + i, text: 'x', area: 'core' }))
    await serveJobs({ method: 'POST', body: startBody('es', huge) }, {}, io)
    check('more texts than a language has is refused', sent[10].status === 400)
    rmSync(dir, { recursive: true, force: true })
  }
} finally { /* temp folders are removed by each section */ }

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
