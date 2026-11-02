#!/usr/bin/env node
// The agent's command (cli/auto-router.mjs) against the REAL host module over real HTTP, on a temporary home with a fake llm.
//
//   node packages/kybernos-auto/test-cli.mjs
import http from 'node:http'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { monterRoutes } from './index.js'

const ICI = dirname(fileURLToPath(import.meta.url))
let pass = 0
let fail = 0
const check = (name, cond, detail) => { if (cond === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 300))) } }

const home = mkdtempSync(join(tmpdir(), 'kauto-cli-'))
mkdirSync(join(home, 'kybernos'), { recursive: true })
const WL = ['deepseek-official/deepseek-chat', 'openrouter/qwen/qwen-coder', 'ollama-local/llama3']
writeFileSync(join(home, 'kybernos', 'settings.json'), JSON.stringify({ autoRouting: true, autoWhitelist: WL }))
const llm = { stream () { return (async function * () { yield { type: 'finish', reason: { kind: 'stop' } } })() } }
const routes = {}
monterRoutes({ register: (r) => { routes[r.path] = r.handler } }, { home, llm, delaiSondeMs: 500 })
const server = http.createServer((req, res) => { const h = routes[req.url.split('?')[0]]; if (h === undefined) { res.writeHead(404); res.end('no'); return } h(req, res) })
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const HOTE = 'http://127.0.0.1:' + server.address().port
const cli = (args, env = {}) => new Promise((resolve) => execFile('node', [join(ICI, 'cli', 'auto-router.mjs'), ...args], { env: { ...process.env, KB_AUTO_HOST: HOTE, ...env }, timeout: 40000 }, (err, out, errOut) => resolve({ code: err ? err.code : 0, out, errOut })))
const DEMANDE = 'analyse la stratégie de prix'

let r = await cli([DEMANDE])
let j = JSON.parse(r.out)
check('route: the host answers with a verified model and the chain', j.actif === true && j.modele === WL[0] && j.verifie === true && j.candidats.length === 3 && j.sonde === 'fraiche', j)
r = await cli(['--report', WL[0], '--error', '--code', 'AUTH', '--message', 'invalid x-api-key'])
j = JSON.parse(r.out)
check('report an error: classed as a refused key, the breaker opens', r.code === 0 && j.ok === true && j.issue.etat === 'erreur' && j.disjoncteur === 'open' && j.jusqua > Date.now(), j)
r = await cli([DEMANDE, '--no-probe'])
j = JSON.parse(r.out)
check('route again: the failed model is skipped with its reason, the next one is first', j.modele === WL[1] && j.ecartes.some((e) => e.modele === WL[0] && e.raison === 'key') && j.verifie === false && j.sondes === 0, j)
r = await cli(['--exclude', WL[1], DEMANDE])
j = JSON.parse(r.out)
check('--exclude: the model that just failed is not offered, the next one answers', j.modele === WL[2] && j.verifie === true, j)
r = await cli(['--exclude', WL[1] + ',' + WL[2], DEMANDE])
j = JSON.parse(r.out)
check('several exclusions, comma separated', j.modele === null && j.ecartes.filter((e) => e.raison === 'exclu').length === 2, j)
r = await cli(['--report', WL[0], '--ok', '--latency', '1500'])
j = JSON.parse(r.out)
check('report a success: the breaker closes', j.ok === true && j.disjoncteur === 'closed', j)
r = await cli(['--report', WL[0]])
check('--report without --ok or --error is refused with a message', r.code === 1 && /--ok or --error/.test(r.errOut), r.errOut)
r = await cli(['--report'])
check('--report without a model is refused', r.code === 1 && /expected/.test(r.errOut), r.errOut)
r = await cli([DEMANDE], { KB_AUTO_HOST: 'http://127.0.0.1:1' })
j = JSON.parse(r.out)
check('host unreachable: "Auto off", delegate as usual, and it says why', r.code === 0 && j.actif === false && j.sonde === 'hote-injoignable', j)
r = await cli([])
check('no request: no output, no crash', r.code === 0 && r.out === '')
server.close()

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
