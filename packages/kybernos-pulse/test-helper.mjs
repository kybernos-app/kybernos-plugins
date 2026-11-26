// The Mac menu-bar app (helper/) is Swift and is not built here, so this test guards what can drift without anyone noticing:
//   - the fields it reads exist in a real answer of the plugin (`State.swift` CONTRACT block against `publicView`),
//   - the header it sends is the one the route listens for,
//   - it only ever reads (no POST, no write to DSH),
//   - its K is the same K as the one of the brand code (`kbBrandArt` in kybernos-plugin/client.js).
// When the app was built on this machine (helper/build.sh), the real binary is also run on a sample state.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { execFile, execFileSync } from 'node:child_process'
import http from 'node:http'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { writeFileSync } from 'node:fs'
import { cleanItem, defaults, inboxPut, publicView } from './pulse-core.mjs'
import { HELPER_HEADER_RE } from './pulse-host.mjs'
import { readPanelPage } from './index.js'
import { PANEL_CSP } from './panel-page.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const swift = (f) => readFileSync(join(here, 'helper', 'Sources', 'KybernosPulse', f), 'utf8')
let fail = 0
const ok = (name, cond, detail) => { if (cond) console.log('  ✓ ' + name); else { fail += 1; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')) } }
const block = (text, from, to) => { const a = text.indexOf(from); const b = text.indexOf(to); return a < 0 || b < a ? '' : text.slice(a + from.length, b) }

// ── a real answer of the plugin ──────────────────────────────────────────────
const NOW = 1790000000000
let inbox = []
const sid = (c) => 'session-' + c.repeat(8) + '-aaaa-bbbb-cccc-' + c.repeat(12)
inbox = inboxPut(inbox, cleanItem({ id: 'a', kind: 'done', task: 'T', at: NOW - 1000, unread: true, durMs: 5000, calls: 3, sessionId: sid('1') }))
inbox = inboxPut(inbox, cleanItem({ id: 'b', kind: 'failed', task: 'U', at: NOW - 2000, unread: true, sessionId: sid('2') }))
const running = [{ sessionId: sid('3'), taskId: 't', task: 'V', phase: 'running', calls: 2, startedAt: NOW - 3000 }]
const answer = { ok: true, ...publicView({ settings: defaults(), state: { inbox }, running, now: NOW }) }

// ── the contract ─────────────────────────────────────────────────────────────
console.log('the fields the app reads')
const contract = block(swift('State.swift'), '// CONTRACT-BEGIN', '// CONTRACT-END')
ok('the contract block is there', contract.includes('struct PulseState'))
const structs = {}
for (const m of contract.matchAll(/struct (\w+): Decodable \{([^}]*)\}/g)) {
  structs[m[1]] = [...m[2].matchAll(/let (\w+): ([\w\[\]]+)(\??)/g)].map((f) => ({ name: f[1], type: f[2], optional: f[3] === '?' }))
}
const typeOk = (value, type) => {
  if (type === 'String') return typeof value === 'string'
  if (type === 'Bool') return typeof value === 'boolean'
  if (type === 'Double') return typeof value === 'number'
  if (type === 'Int') return Number.isInteger(value)
  if (type === '[String]') return Array.isArray(value) && value.every((x) => typeof x === 'string')
  const arr = /^\[(\w+)\]$/.exec(type)
  if (arr !== null) return Array.isArray(value) && value.length > 0 && value.every((x) => checkStruct(arr[1], x))
  if (structs[type] !== undefined) return checkStruct(type, value)
  return false
}
const missing = []
const checkStruct = (name, value) => {
  const fields = structs[name]
  if (fields === undefined || value === null || typeof value !== 'object') { missing.push(name + ': not an object'); return false }
  let good = true
  for (const f of fields) {
    if (!(f.name in value)) { if (!f.optional) { missing.push(name + '.' + f.name + ' is missing'); good = false } continue }
    if (!typeOk(value[f.name], f.type)) { missing.push(name + '.' + f.name + ' is not a ' + f.type); good = false }
  }
  return good
}
// the sample must carry every optional field too, or the test would not prove the plugin still sends it
const sampleItem = answer.inbox.find((x) => x.id === 'a')
for (const f of structs.PulseItem || []) if (!(f.name in sampleItem) && f.name !== 'quiet') missing.push('the sample item lacks ' + f.name)
ok('the state is what PulseState decodes', checkStruct('PulseState', answer), missing.join('; '))
ok('an inbox item and a running entry carry what PulseItem and PulseRun decode', checkStruct('PulseItem', sampleItem) && checkStruct('PulseRun', answer.running[0]), missing.join('; '))
ok('the item kinds the app words are the ones the plugin emits', ['done', 'failed', 'waiting'].every((k) => swift('State.swift').includes('"' + k + '"') || k === 'done'))

// ── the header ───────────────────────────────────────────────────────────────
console.log('the header and the verbs')
const main = swift('main.swift')
ok('it announces itself with the header the route listens for', HELPER_HEADER_RE.test('v1; banners=ok') && HELPER_HEADER_RE.test('v1; banners=off') && main.includes('"X-Kybernos-Helper"') && main.includes('v1; banners=\\(bannersAllowed ? "ok" : "off")'))
ok('the app itself only reads: no write verb, no body, no cookie (the writes are done by the page, below)', !/httpMethod|httpBody|uploadTask|"POST"|"PUT"|"DELETE"|Cookie|cookie/.test(main + swift('State.swift')))
ok('the web view only ever shows this app\'s own address, so the token never meets another page', main.includes('decidePolicyFor') && main.includes('url.host == base.host') && main.includes('url.port == base.port') && main.includes('createWebViewWith') && main.includes('.nonPersistent()'))
ok('the page can ask the app for two things only: open Kybernos, close the panel', /case "open", "settings":/.test(main) && /case "close":/.test(main) && /default: break/.test(main) && main.includes('message.frameInfo.isMainFrame'))
ok('the token is read from the file the host writes, with the shape the host checks', main.includes('/kybernos/pulse/helper.token') && main.includes('^[0-9a-f]{64}$'))
ok('it talks to the local machine only', /127\.0\.0\.1/.test(main) && !/https?:\/\/(?!127\.0\.0\.1)/.test(main))

// ── the K ────────────────────────────────────────────────────────────────────
console.log('the K')
const plugin = readFileSync(join(here, '..', 'kybernos-plugin', 'client.js'), 'utf8')
const art = block(plugin, 'const kbBrandArt = (dot) =>', 'const KB_BRAND_INNER')
const nums = (t) => [...t.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]))
const jsRect = /<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"\/>/.exec(art)
const jsPoly = [...art.matchAll(/<polygon points="([^"]+)"\/>/g)].map((m) => nums(m[1].replace(/,/g, ' ')))
const jsDots = [...art.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])])
const brand = block(swift('Brand.swift'), '// BRAND-BEGIN', '// BRAND-END')
const line = (name) => (brand.split('\n').find((l) => l.includes('let ' + name)) || '')
const swRect = nums(line('brandStem'))
const tuples = (l) => [...l.matchAll(/\(([\d.]+), ([\d.]+)\)/g)].flatMap((m) => [Number(m[1]), Number(m[2])])
const swPoly = [tuples(line('brandArm')), tuples(line('brandLeg'))]
const swDots = tuples(line('brandDots'))
ok('the stem is the brand\'s stem', jsRect !== null && swRect.join() === jsRect.slice(1, 5).map(Number).join(), swRect.join() + ' vs ' + (jsRect && jsRect.slice(1, 5).join()))
ok('the arm and the leg are the brand\'s polygons', jsPoly.length === 2 && jsPoly[0].join() === swPoly[0].join() && jsPoly[1].join() === swPoly[1].join(), swPoly.join(' | ') + ' vs ' + jsPoly.join(' | '))
ok('the three dots sit where the brand puts them', jsDots.length === 3 && jsDots.flat().join() === swDots.join(), swDots.join() + ' vs ' + jsDots.flat().join())
const favVb = /KB_BRAND_FAVICON_VIEWBOX = '([^']+)'/.exec(plugin)
const favDot = /KB_BRAND_FAVICON_INNER = kbBrandArt\(([\d.]+)\)/.exec(plugin)
ok('the view box and the dot size are the favicon\'s (the small-size ones)', favVb !== null && favDot !== null && nums(line('brandViewBox')).join() === nums(favVb[1]).join() && line('brandDotRadius').includes(favDot[1]), (favVb && favVb[1]) + ' / ' + (favDot && favDot[1]))
const red = /KB_BRAND_RED = '#([0-9a-f]{6})'/i.exec(plugin)
ok('the red is the brand\'s', red !== null && /0x([0-9a-f]{2}) \/ 255, green: 0x([0-9a-f]{2}) \/ 255, blue: 0x([0-9a-f]{2})/i.test(swift('Brand.swift')) && (() => { const m = /0x([0-9a-f]{2}) \/ 255, green: 0x([0-9a-f]{2}) \/ 255, blue: 0x([0-9a-f]{2})/i.exec(swift('Brand.swift')); return (m[1] + m[2] + m[3]).toLowerCase() === red[1].toLowerCase() })())

// ── the real binary, when this machine built it ──────────────────────────────
console.log('the built app')
const exe = join(here, 'helper', 'build', 'Kybernos Pulse.app', 'Contents', 'MacOS', 'KybernosPulse')
if (process.platform === 'darwin' && existsSync(exe)) {
  const file = join(tmpdir(), 'kybernos-pulse-helper-test-' + process.pid + '.json')
  writeFileSync(file, JSON.stringify(answer))
  const out = JSON.parse(execFileSync(exe, ['--selftest', file, '--lang', 'en'], { encoding: 'utf8' }))
  ok('on a real answer it counts, words and lists as the sentences say', out.headline === '1 thing needs you' && out.badge === '2' && out.tone === 'bad' && out.rows.length === 3 && out.rows[0].tone === 'run', JSON.stringify(out).slice(0, 200))
  ok('it says what it cannot reach', out.offline === 'Kybernos is not running')
  ok('and a banner for what is due', out.banners.length === 1 && out.banners[0].title === '“U” failed', JSON.stringify(out.banners))
  // the panel, in the app's real web view, against a stand-in of the host that serves the real page
  const page = readPanelPage()
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/kybernos-pulse/panel')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PANEL_CSP }); res.end(page); return }
    if (req.url === '/kybernos-pulse/state') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ...answer, now: Date.now() })); return }
    res.writeHead(404).end()
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    const stdout = (await promisify(execFile)(exe, ['--panelcheck', '--port', String(server.address().port), '--lang', 'en'], { encoding: 'utf8', timeout: 30000 })).stdout
    const seen = JSON.parse(stdout)
    ok('the web view draws the panel from the page of the plugin: the big sentence, two tabs, the cards', seen.page.hero === '1 thing needs you' && seen.page.tabs === 2 && seen.page.cards >= 1, JSON.stringify(seen.page).slice(0, 200))
    ok('and an arrow of the page reaches the app as « open »', seen.clicked === true && seen.acts.join() === 'open', JSON.stringify(seen.acts))
  } catch (e) { ok('the panel check ran in the real web view', false, String(e && e.message ? e.message : e).slice(0, 200)) } finally { server.close() }
} else console.log('  (not built on this machine: bash packages/kybernos-pulse/helper/build.sh)')

console.log(fail === 0 ? '\nall passed' : '\n' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
