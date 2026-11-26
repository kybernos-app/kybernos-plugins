#!/usr/bin/env node
// A real turn on a small local model, through Ollama itself (not through DSH): the engine is up, the model is installed, and it answers a one-line request in reasonable time.
//
//   node scripts/check-ollama-turn.mjs [model]        default model: tev1:0.8b (881 MB; the 9 GB models are the owner's and are never loaded here)
//
// Loopback only (OLLAMA_HOST is honoured only when it is a loopback address). Nothing is pulled or installed. It does NOT prove that DSH has the model wired in its picker: that is a GUI step (W2-14).
// Exit 0 the model answered, 1 it did not, 3 inconclusive (Ollama is not running, or the model is not installed).
const model = process.argv[2] || 'tev1:0.8b'
const base = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '')
if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(base)) { console.error('refusing: OLLAMA_HOST is not a loopback address'); process.exit(3) }
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

let tags
try { tags = await (await fetch(base + '/api/tags', { signal: AbortSignal.timeout(5000) })).json() } catch (e) { console.error('○ inconclusive: Ollama does not answer on ' + base); process.exit(3) }
if (!Array.isArray(tags.models) || !tags.models.some((m) => m.name === model)) { console.error('○ inconclusive: ' + model + ' is not installed (this check pulls nothing)'); process.exit(3) }
console.log('the local engine and ' + model)
check('Ollama lists the model', true)
const t0 = Date.now()
let r
try { r = await (await fetch(base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: false, messages: [{ role: 'user', content: 'Say hello in one short sentence.' }], options: { num_predict: 40 } }), signal: AbortSignal.timeout(120000) })).json() } catch (e) { r = { error: String(e) } }
const seconds = (Date.now() - t0) / 1000
console.log('  · answered in ' + seconds.toFixed(1) + ' s, ' + (r.eval_count || 0) + ' tokens, done_reason ' + r.done_reason)
check('the turn ends (done) with no error', r.done === true && r.error === undefined, r.error)
check('it produced tokens (a small thinking model may spend them all thinking: that still counts as an answer from the engine)', (r.eval_count || 0) > 0, r.eval_count)
check('in under 60 seconds, model load included', seconds < 60, seconds)
console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}, ${pass} passed`)
process.exit(fail === 0 ? 0 : 1)
