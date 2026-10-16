#!/usr/bin/env node
// V-37: the headline score of many models in one call (the Score badge, filter and sort of the Models tab). A throw-away home with
// a snapshot written by hand: no network, no scrape.
//
//   node packages/kybernos-models/test-scores-list.mjs
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, browserHeaders } from './lib-session-test.mjs'

sessionSource.secret = () => SESSION_SECRET // the machine secret the write routes check the session cookie against
const home = mkdtempSync(join(tmpdir(), 'kbm-scores-'))
process.env.DSH_HOME = home
const { apply, SCORES_FILE, kbScoreHeadline } = await import('./index.js')

let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 220))) } }

mkdirSync(dirname(SCORES_FILE), { recursive: true })
writeFileSync(SCORES_FILE, JSON.stringify({
  version: 1, at: Date.now(), sources: {},
  aa: {
    'deepseek-v4-pro': { name: 'DeepSeek V4 Pro', intelligenceIndex: 52.34 },
    'qwen3-5-9b': { name: 'Qwen3.5 9B', intelligenceIndex: 32 },
    'no-index': { name: 'No Index Model' },
  },
  benchlm: { 'gpt-mystery': { model: 'GPT Mystery', displayScore: 88.1 } },
  catalogue: {},
}))

const routes = {}
const web = { register: (r) => { routes[r.path] = r.handler } }
apply({ inject: (_names, fn) => fn({ get: (n) => (n === 'webServer' ? web : undefined), effect: (fn2) => fn2() }), get: () => undefined, effect: (fn) => fn() })

const post = async (headers, body) => {
  const text = JSON.stringify(body)
  const req = {
    method: 'POST', url: '/kybernos-models/scores/list', headers: { host: '127.0.0.1:3080', ...headers }, socket: { localPort: 3080 },
    on (ev, cb) { if (ev === 'data') cb(Buffer.from(text)); if (ev === 'end') cb() },
    async *[Symbol.asyncIterator]() { yield Buffer.from(text) },
  }
  const out = { status: 0, body: null }
  await routes['/kybernos-models/scores/list'](req, { writeHead (s) { out.status = s }, end (b) { try { out.body = JSON.parse(String(b)) } catch (e) { out.body = b } } })
  return out
}
const SAME = browserHeaders() // the page's own pair: the right Origin and DSH's signed session cookie

check('the headline is Artificial Analysis\' intelligence index, one decimal', kbScoreHeadline({ aa: { entry: { intelligenceIndex: 52.34 } } }) === 52.3 && kbScoreHeadline({ aa: { entry: { intelligenceIndex: '32' } } }) === 32)
check('no AA entry, or none with an index: no score (BenchLM is another scale and is not mixed in)', kbScoreHeadline({ aa: null, benchlm: { entry: { displayScore: 88 } } }) === null && kbScoreHeadline({ aa: { entry: {} } }) === null && kbScoreHeadline(null) === null && kbScoreHeadline({ aa: { entry: { intelligenceIndex: -1 } } }) === null)

const r = await post(SAME, { models: [
  { key: 'openrouter/deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro (OpenRouter)' },
  { key: 'ollama-local/qwen3.5-9b' },
  { key: 'groq/no-index' },
  { key: 'x/gpt-mystery' },
  { key: 'x/never-heard-of-it' },
  { key: 'broken' }, { key: '/x' }, { key: 'x/' }, null, 7, { name: 'no key' },
] })
check('a known model gets its score, by the same matching rules as the sheet', r.status === 200 && r.body.ok === true && r.body.scores['openrouter/deepseek/deepseek-v4-pro'] === 52.3, r.body)
check('a model whose id differs only in punctuation matches too (qwen3.5-9b → qwen3-5-9b)', r.body.scores['ollama-local/qwen3.5-9b'] === 32, r.body.scores)
check('a model with no index, one only BenchLM knows, an unknown one and junk entries get nothing (never a made-up zero)', Object.keys(r.body.scores).length === 2, r.body.scores)
check('the answer says when the snapshot was read and whether it is old', typeof r.body.at === 'number' && r.body.stale === false)
check('a request that says nothing about where it comes from is refused (403): it is a POST', (await post({}, { models: [] })).status === 403)
check('another origin is refused, even with the real cookie', (await post({ ...SAME, origin: 'https://evil.example' }, { models: [] })).status === 403)
check('the right Origin and no session cookie is refused (401)', (await post({ origin: SAME.origin }, { models: [] })).status === 401)
check('a body without a list of models is a 400, not a crash', (await post(SAME, { nope: 1 })).status === 400)
const big = await post(SAME, { models: Array.from({ length: 2000 }, (x, i) => ({ key: 'openrouter/deepseek/deepseek-v4-pro-' + i })) })
check('a huge list is cut, never refused or slow', big.status === 200)

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
