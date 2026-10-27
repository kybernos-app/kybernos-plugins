// What kybernos-plugins owes the phone app's licences (the app itself, with its payload audit, is in the kybernos-host repository, tests/test-licences.mjs):
//   · every package of this repository declares its licence (Apache-2.0, the repository's);
//   · the engine serves the notices inside the phone app only, and the app's page has the card;
//   · TRADEMARK.md covers apps built from this source.
// Usage: node scripts/test-mobile-licences.mjs   (exit 0 = everything passes)
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const mobile = await import(join(root, 'packages', 'kybernos-mobile', 'index.js'))

let fails = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) { fails++; console.log('FAIL', label, '| got', JSON.stringify(got), '| want', JSON.stringify(want)) } else console.log('ok  ', label)
}
const yes = (label, cond) => eq(label, Boolean(cond), true)

/* 4. our own packages declare their licence */
const own = []
const walk = (d) => { for (const e of readdirSync(d)) { if (e === 'node_modules' || e.startsWith('.')) continue; const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (e === 'package.json') own.push(p) } }
walk(join(root, 'packages'))
const bad = own.filter((f) => { try { return JSON.parse(readFileSync(f, 'utf8')).license !== 'Apache-2.0' } catch (e) { return true } }).map((f) => f.slice(root.length))
eq('every package of this repository declares Apache-2.0', bad, [])

/* 5. the engine serves the notices inside the phone app, and the app's page has the card */
const call = (opts, runtime) => {
  const out = { status: 0, headers: {}, body: '' }
  const res = { writeHead (s, h) { out.status = s; out.headers = h ?? {} }, end (b) { out.body = b ?? '' } }
  mobile.serveNotices({ method: opts.method ?? 'GET', headers: { host: opts.host ?? '127.0.0.1:4000', ...(opts.headers ?? {}) }, socket: { localPort: 4000 } }, res, runtime)
  return out
}
const rt = mkdtempSync(join(tmpdir(), 'kb-rt-'))
try {
  eq('the route is under the plugin\'s prefix', mobile.NOTICES_ROUTE, '/kybernos-mobile/notices')
  eq('no runtime folder: not found', call({}, undefined).status, 404)
  eq('a runtime without the file: not found', call({}, rt).status, 404)
  writeFileSync(join(rt, mobile.NOTICES_FILE), 'Kybernos: open-source components\n')
  const ok = call({}, rt)
  eq('the file is served as plain text', [ok.status, ok.headers['content-type'], ok.body], [200, 'text/plain; charset=utf-8', 'Kybernos: open-source components\n'])
  eq('only a read', call({ method: 'POST' }, rt).status, 405)
  eq('a foreign Host is refused', call({ host: 'evil.example:4000' }, rt).status, 403)
  eq('a foreign Origin is refused', call({ headers: { origin: 'https://evil.example' } }, rt).status, 403)
} finally { rmSync(rt, { recursive: true, force: true }) }
yes('the app page has the open-source card, behind a button', /data-kb': 'mobile-app-notices'/.test(readFileSync(join(root, 'packages', 'kybernos-mobile', 'client.js'), 'utf8')) && /fetch\('\/kybernos-mobile\/notices'\)/.test(readFileSync(join(root, 'packages', 'kybernos-mobile', 'client.js'), 'utf8')))

/* 6. the trademark policy covers apps built from this source */
const tm = readFileSync(join(root, 'TRADEMARK.md'), 'utf8')
yes('TRADEMARK.md says what a published app built from the source may not use', /## Apps built from this source/.test(tm) && /must \*\*not\*\*/.test(tm) && /app\.kybernos\.host/.test(tm))

console.log(fails === 0 ? '\nall good' : '\n' + fails + ' failed')
process.exit(fails === 0 ? 0 : 1)
