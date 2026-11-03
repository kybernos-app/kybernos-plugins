// The editor frames are built on the person's computer (build-editors.mjs), so what CI can check is what makes that build safe and the two halves
// agree: the pins are exact and locked with integrity hashes, the sources import only what is pinned, the envelope the frames speak is the one the page listens to, and the
// manifest the build writes covers every file the host will serve. The built editors themselves are exercised on the sandbox (scripts/check-kybernos-office-live.mjs).
//
//   node packages/kybernos-office/test-editor-src.mjs
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { manifestOf, EDITORS, SHARED } from './build-editors.mjs'
import { replaceDeck } from './editor-src/deck/serialize.js'
import { FRENCH } from './editor-src/deck/i18n.js'
import { createHost } from './office-host.mjs'
import * as fsp from 'node:fs/promises'

let failed = 0
const ok = (label, fn) => { try { fn() ; console.log('  ok   ' + label) } catch (e) { failed += 1; console.log('  FAIL ' + label + ' — ' + (e && e.message)) } }
const okAsync = async (label, fn) => { try { await fn(); console.log('  ok   ' + label) } catch (e) { failed += 1; console.log('  FAIL ' + label + ' — ' + (e && e.message)) } }
const must = (cond, msg) => { if (!cond) throw new Error(msg) }

const here = fileURLToPath(new URL('.', import.meta.url))
const read = (p) => readFileSync(join(here, p), 'utf8')
const DECK_SOURCES = readdirSync(join(here, 'editor-src', 'deck')).filter((f) => f.endsWith('.js')).sort().map((f) => 'deck/' + f)
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
  must(/'--ignore-scripts'/.test(readFileSync(join(here, 'build-editors.mjs'), 'utf8')), 'the build must not run install scripts')
})
ok('the frame sources import only the pinned editors, React and each other; no network address, no eval', () => {
  const allowed = new Set([...Object.keys(pkg.dependencies)])
  for (const f of ['sheet.jsx', 'doc.jsx', 'md.js', 'pdf.js', 'envelope.js', ...DECK_SOURCES]) {
    const src = read('editor-src/' + f)
    for (const m of src.matchAll(/(?:from|import)\s+'([^']+)'/g)) {
      const spec = m[1]
      if (spec.startsWith('./') || spec.startsWith('../')) continue
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
  const deck = read('editor-src/deck/index.js')
  must(/from '\.\.\/envelope\.js'/.test(deck) && /listen\(\{/.test(deck) && /fetchFile\(\)/.test(deck) && /loaded\(f\.hash, READONLY\)/.test(deck), 'the deck frame speaks the same envelope (open, listen, loaded)')
})
ok('each editor exports the bytes in its own format and says dirty only for a change', () => {
  must(/toXlsx\(\)/.test(read('editor-src/sheet.jsx')) && /\.save\(\)/.test(read('editor-src/doc.jsx')), 'export calls')
  must(/dirty\(true\)/.test(read('editor-src/doc.jsx')) && /dirty\(s\.dirty\)/.test(read('editor-src/sheet.jsx')), 'dirty is told')
  must(/canEdit=\{!readOnly\}/.test(read('editor-src/sheet.jsx')) && /'view'/.test(read('editor-src/doc.jsx')), 'read-only is honoured by both')
  // The document editor shows the file's name as its title (it says « Untitled » otherwise); the page puts it in the frame's address.
  must(/title=\{NAME\.replace\(/.test(read('editor-src/doc.jsx')) && /NAME = .*q\.get\('name'\)/.test(read('editor-src/envelope.js')), 'the document editor is titled with the file name')
  must(/getMarkdown\(\)/.test(read('editor-src/md.js')) && /dirty\(value\)/.test(read('editor-src/md.js')) && /saveAsCopy\(\)/.test(read('editor-src/pdf.js')) && /dirty\(value\)/.test(read('editor-src/pdf.js')), 'the Markdown and PDF frames export and tell dirty')
  const deckFrame = read('editor-src/deck/index.js')
  must(/exportBytes: \(\) =>/.test(deckFrame) && /new TextEncoder\(\)\.encode\(text\)/.test(deckFrame) && /dirty\(true\)/.test(deckFrame) && /dirty\(false\)/.test(deckFrame), 'the deck frame exports UTF-8 bytes and tells dirty for a touch only')
  must(/edit: !READONLY/.test(deckFrame) && /if \(!READONLY\) state\.api\.setEditing\(true\)/.test(deckFrame), 'read-only is honoured by the deck frame')
  must(/editable: !READONLY/.test(read('editor-src/md.js')) && /READONLY \? \[\.\.\.NEVER, \.\.\.VIEW_ONLY\]/.test(read('editor-src/pdf.js')), 'read-only is honoured by the Markdown and PDF frames')
})
ok('the PDF viewer is copied as it is (its scripts and its wasm, not its demo files), and its glue imports it from the page', () => {
  const build = read('editor-src/build.mjs')
  must(/external: \['\.\/embedpdf\.js'\]/.test(build) && /n === 'pdfium\.wasm'/.test(build), 'the viewer stays an import of the page and the wasm is copied')
  must(/\^\[\\w\.-\]\+\\\.js\$/.test(build), 'only scripts are copied from its distribution, never the demo PDFs')
  must(/import EmbedPDF from '\.\/embedpdf\.js'/.test(read('editor-src/pdf.js')), 'the frame imports the viewer from its own folder')
  must(/fontFallback: null/.test(read('editor-src/pdf.js')) && /ui: null, signature: null/.test(read('editor-src/pdf.js')), 'no web font is asked for')
})

ok('a deck frame is built twice from one runtime: the frame (an ES module) and the standalone page (one IIFE), in the same folder', () => {
  const build = read('editor-src/build.mjs')
  must(/entryPoints: \['src\/deck\/index\.js'\]/.test(build) && /format: 'iife', entryNames: 'standalone', entryPoints: \['src\/deck\/standalone\.js'\]/.test(build), 'both entries are built')
  must(EDITORS.join() === 'sheet,doc,md,pdf,deck', 'the deck is an editor of the build: ' + EDITORS.join())
  must(/start\(\{/.test(read('editor-src/deck/index.js')) && /start\(\{/.test(read('editor-src/deck/standalone.js')), 'both start the same runtime')
  must(!/from '@tiptap/.test(read('editor-src/deck/runtime.js')), 'the runtime reaches Tiptap only through the module it is handed')
})
ok('every text the deck shows has a French entry', () => {
  const used = new Set()
  for (const f of DECK_SOURCES) {
    if (f === 'deck/i18n.js') continue
    for (const m of read('editor-src/' + f).matchAll(/\bT\('((?:[^'\\]|\\.)*)'/g)) used.add(m[1].replace(/\\'/g, "'").replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))))
  }
  const lacking = [...used].filter((k) => !Object.prototype.hasOwnProperty.call(FRENCH, k))
  must(used.size > 60, 'only ' + used.size + ' texts found')
  must(lacking.length === 0, 'no French for: ' + lacking.slice(0, 8).join(' | '))
  for (const [en, fr] of Object.entries(FRENCH)) must(typeof fr === 'string' && fr !== '', 'the French of « ' + en + ' » is empty')
})
ok('a deck goes back as the same file with only its slides replaced', () => {
  const file = '<!doctype html>\n<html><head><meta name="kybernos-deck" content="1"><style data-kd="theme">:root{--navy:#123}</style></head>\n<body><main id="deck">\n<div class="cell">old</div>\n</main><script data-kd="runtime">const a = "</main>"</script></body></html>\n'
  const out = replaceDeck(file, '<div class="cell">new</div>\n<div class="cell">two</div>')
  must(out === file.replace('<div class="cell">old</div>', '<div class="cell">new</div>\n<div class="cell">two</div>'), 'only the content of main#deck changes: ' + out)
  must(replaceDeck(out, '<div class="cell">new</div>\n<div class="cell">two</div>') === out, 'replacing with the same slides is the identity')
  must(replaceDeck(file, '$&$1$`') .includes('$&$1$`'), 'dollar signs in a slide are text')
  let refused = false
  try { replaceDeck('<html><body><main>none</main></body></html>', 'x') } catch (e) { refused = /not a Kybernos deck/.test(e.message) }
  must(refused, 'a file without main#deck is refused')
})

await okAsync('the manifest the build writes lists every served file, the shared fonts included, with hashes the host then checks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kb-office-build-'))
  for (const [p, c] of [['sheet/app.js', 'js'], ['sheet/app.css', 'css'], ['sheet/wasm_bg.wasm', 'wasm'], ['doc/app.js', 'js2'], ['doc/harfbuzz.wasm', 'hb'], ['md/app.js', 'js3'], ['md/app.css', 'css3'], ['pdf/app.js', 'js4'], ['pdf/embedpdf.js', 'js5'], ['pdf/pdfium.wasm', 'wasm5'], ['deck/app.js', 'js6'], ['deck/app.css', 'css6'], ['deck/standalone.js', 'js7'], ['deck/standalone.css', 'css7'], ['assets/Caladea-Bold.ttf', 'ttf'], ['licenses/OFL.txt', 'not served']]) {
    mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), c)
  }
  const m = manifestOf(dir, EDITORS, 'v1')
  must(SHARED.includes('assets') && m.version === 'v1' && m.editors.join() === 'sheet,doc,md,pdf,deck', 'shape')
  must(Object.keys(m.files).sort().join() === 'assets/Caladea-Bold.ttf,deck/app.css,deck/app.js,deck/standalone.css,deck/standalone.js,doc/app.js,doc/harfbuzz.wasm,md/app.css,md/app.js,pdf/app.js,pdf/embedpdf.js,pdf/pdfium.wasm,sheet/app.css,sheet/app.js,sheet/wasm_bg.wasm', 'files: ' + Object.keys(m.files).join())
  must(m.files['sheet/app.js'].sha256 === createHash('sha256').update('js').digest('hex'), 'hash')
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m))
  const host = createHost({ fs: fsp, home: join(dir, 'home'), editorsDir: dir, now: () => 1e12 })
  const open = (await import('node:fs')).writeFileSync
  void open
  const s = await host.status()
  must(s.installed.sheet === true && s.installed.doc === true && s.installed.md === true && s.installed.pdf === true && s.installed.deck === true, 'all five installed')
  const t = await (async () => { const { docx } = await import('./lib-test-files.mjs'); const p = join(dir, 'a.docx'); writeFileSync(p, docx()); return host.open(p) })()
  must(t.ok === true, 'open: ' + JSON.stringify(t))
  must((await host.serve(t.token, 'assets/Caladea-Bold.ttf')).ok === true, 'a font is served at <token>/assets/…, where the document editor asks for it')
  must((await host.serve(t.token, 'licenses/OFL.txt')).ok === false, 'what is not in the manifest is not served')
  const wasm = await host.serve(t.token, 'pdf/pdfium.wasm')
  must(wasm.ok === true && wasm.type === 'application/wasm', 'the PDF engine is served as wasm')
})

console.log(failed === 0 ? '\nOFFICE EDITOR SOURCES — all ok' : '\nOFFICE EDITOR SOURCES — ' + failed + ' failure(s)')
process.exit(failed === 0 ? 0 : 1)
