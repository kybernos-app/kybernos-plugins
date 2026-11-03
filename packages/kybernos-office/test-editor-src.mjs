// The editor frames are built on the person's computer (scripts/build-office-editors.mjs), so what CI can check is what makes that build safe and the two halves
// agree: the pins are exact and locked with integrity hashes, the sources import only what is pinned, the envelope the frames speak is the one the page listens to, and the
// manifest the build writes covers every file the host will serve. The built editors themselves are exercised on the sandbox (scripts/check-kybernos-office-live.mjs).
//
//   node packages/kybernos-office/test-editor-src.mjs
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { manifestOf, EDITORS, SHARED } from '../../scripts/build-office-editors.mjs'
import { createHost } from './office-host.mjs'
import * as fsp from 'node:fs/promises'

let failed = 0
const ok = (label, fn) => { try { fn() ; console.log('  ok   ' + label) } catch (e) { failed += 1; console.log('  FAIL ' + label + ' — ' + (e && e.message)) } }
const okAsync = async (label, fn) => { try { await fn(); console.log('  ok   ' + label) } catch (e) { failed += 1; console.log('  FAIL ' + label + ' — ' + (e && e.message)) } }
const must = (cond, msg) => { if (!cond) throw new Error(msg) }

const here = fileURLToPath(new URL('.', import.meta.url))
const read = (p) => readFileSync(join(here, p), 'utf8')
const pkg = JSON.parse(read('editors/package.json'))
const lock = JSON.parse(read('editors/package-lock.json'))

ok('the editors are pinned to exact versions (no ^, ~, *, latest, ranges)', () => {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  must(Object.keys(deps).length >= 8, 'dependencies are listed')
  for (const [name, v] of Object.entries(deps)) must(/^\d+\.\d+\.\d+$/.test(v), name + '@' + v)
})
ok('the lockfile covers every package with an integrity hash, from the npm registry only', () => {
  const entries = Object.entries(lock.packages).filter(([k]) => k !== '')
  must(entries.length > 50, 'lockfile has ' + entries.length + ' packages')
  for (const [k, e] of entries) {
    must(typeof e.integrity === 'string' && /^sha(512|256)-/.test(e.integrity), k + ' has no integrity hash')
    must(typeof e.resolved === 'string' && e.resolved.startsWith('https://registry.npmjs.org/'), k + ' resolves outside the npm registry: ' + e.resolved)
  }
  for (const name of Object.keys(pkg.dependencies)) must(lock.packages['node_modules/' + name] !== undefined && lock.packages['node_modules/' + name].version === pkg.dependencies[name], name + ' in the lock matches the pin')
})
ok('only esbuild declares an install script (it only checks its binary), and the build runs with --ignore-scripts', () => {
  const needing = Object.entries(lock.packages).filter(([, e]) => e.hasInstallScript === true).map(([k]) => k)
  must(needing.length === 1 && needing[0] === 'node_modules/esbuild', 'install scripts: ' + needing.join(', '))
  must(/'--ignore-scripts'/.test(readFileSync(join(here, '../../scripts/build-office-editors.mjs'), 'utf8')), 'the build must not run install scripts')
})
ok('the frame sources import only the pinned editors, React and each other; no network address, no eval', () => {
  const allowed = new Set([...Object.keys(pkg.dependencies)])
  for (const f of ['sheet.jsx', 'doc.jsx', 'envelope.js']) {
    const src = read('editor-src/' + f)
    for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
      const spec = m[1]
      if (spec.startsWith('./')) continue
      const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
      must(allowed.has(name), f + ' imports ' + spec + ', which is not pinned')
    }
    must(!/https?:\/\//.test(src.replace(/\/\/.*$/gm, '')), f + ' has a network address')
    must(!/\beval\s*\(|new Function\s*\(/.test(src), f + ' evaluates code')
    must(!/localStorage|sessionStorage|document\.cookie/.test(src), f + ' touches storage (the frame is sandboxed without any)')
  }
})
ok('the envelope the frames speak is the one the page listens to', () => {
  const env = read('editor-src/envelope.js')
  const page = read('client.js')
  for (const op of ['loaded', 'dirty', 'exported', 'error']) {
    must(new RegExp("op: '" + op + "'").test(env), 'the frame never says ' + op)
    must(new RegExp("m\\.op === '" + op + "'").test(page), 'the page never hears ' + op)
  }
  for (const op of ['export', 'reload', 'saved']) {
    must(new RegExp("m\\.op === '" + op + "'").test(env), 'the frame never hears ' + op)
    must(new RegExp("op: '" + op + "'").test(page), 'the page never says ' + op)
  }
  must(/e\.source !== window\.parent/.test(env) && /ev\.source !== frame\.contentWindow/.test(page), 'both sides check who sent the message')
  must(/fetch\('\.\.\/__file'\)/.test(env) && /rel === '__file'/.test(read('routes.mjs')), 'the file is read from the route the host serves')
  must(/X-Office-Hash/.test(env) && /X-Office-Hash/.test(read('routes.mjs')), 'the hash header is the same on both sides')
})
ok('each editor exports the bytes in its own format and says dirty only for a change', () => {
  must(/toXlsx\(\)/.test(read('editor-src/sheet.jsx')) && /\.save\(\)/.test(read('editor-src/doc.jsx')), 'export calls')
  must(/dirty\(true\)/.test(read('editor-src/doc.jsx')) && /dirty\(s\.dirty\)/.test(read('editor-src/sheet.jsx')), 'dirty is told')
  must(/canEdit=\{!readOnly\}/.test(read('editor-src/sheet.jsx')) && /'view'/.test(read('editor-src/doc.jsx')), 'read-only is honoured by both')
})

await okAsync('the manifest the build writes lists every served file, the shared fonts included, with hashes the host then checks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kb-office-build-'))
  for (const [p, c] of [['sheet/app.js', 'js'], ['sheet/app.css', 'css'], ['sheet/wasm_bg.wasm', 'wasm'], ['doc/app.js', 'js2'], ['doc/harfbuzz.wasm', 'hb'], ['assets/Caladea-Bold.ttf', 'ttf'], ['licenses/OFL.txt', 'not served']]) {
    mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), c)
  }
  const m = manifestOf(dir, EDITORS, 'v1')
  must(SHARED.includes('assets') && m.version === 'v1' && m.editors.join() === 'sheet,doc', 'shape')
  must(Object.keys(m.files).sort().join() === 'assets/Caladea-Bold.ttf,doc/app.js,doc/harfbuzz.wasm,sheet/app.css,sheet/app.js,sheet/wasm_bg.wasm', 'files: ' + Object.keys(m.files).join())
  must(m.files['sheet/app.js'].sha256 === createHash('sha256').update('js').digest('hex'), 'hash')
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m))
  const host = createHost({ fs: fsp, home: join(dir, 'home'), editorsDir: dir, now: () => 1e12 })
  const open = (await import('node:fs')).writeFileSync
  void open
  const s = await host.status()
  must(s.installed.sheet === true && s.installed.doc === true, 'both installed')
  const t = await (async () => { const { docx } = await import('./lib-test-files.mjs'); const p = join(dir, 'a.docx'); writeFileSync(p, docx()); return host.open(p) })()
  must(t.ok === true, 'open: ' + JSON.stringify(t))
  must((await host.serve(t.token, 'assets/Caladea-Bold.ttf')).ok === true, 'a font is served at <token>/assets/…, where the document editor asks for it')
  must((await host.serve(t.token, 'licenses/OFL.txt')).ok === false, 'what is not in the manifest is not served')
})

console.log(failed === 0 ? '\nOFFICE EDITOR SOURCES — all ok' : '\nOFFICE EDITOR SOURCES — ' + failed + ' failure(s)')
process.exit(failed === 0 ? 0 : 1)
