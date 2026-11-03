// Builds the four editor frames with esbuild. Run by packages/kybernos-office/build-editors.mjs from the work folder (where the pinned editors are
// installed): `node src/build.mjs <outdir>`. Writes <outdir>/sheet/{app.js,app.css,wasm_bg.wasm}, <outdir>/doc/{app.js,app.css,harfbuzz.wasm},
// <outdir>/md/{app.js,app.css}, <outdir>/pdf/{app.js,app.css} plus the PDF viewer's own distribution beside it, and the fonts the document editor asks
// for as `../assets/<name>` from its own address in <outdir>/assets/.
import { build } from 'esbuild'
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const out = process.argv[2]
if (!out) { console.error('usage: node src/build.mjs <outdir>'); process.exit(2) }

const common = {
  bundle: true, format: 'esm', minify: true, target: 'es2022', logLevel: 'warning', entryNames: 'app', assetNames: 'fonts/[name]',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.svg': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'file', '.otf': 'file' }
}

const find = (dir, name) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (n === name) return p
    if (statSync(p).isDirectory()) { const f = find(p, name); if (f !== null) return f }
  }
  return null
}

mkdirSync(join(out, 'sheet'), { recursive: true })
await build({ ...common, entryPoints: ['src/sheet.jsx'], outdir: join(out, 'sheet'), alias: { '@ironcalc/wasm': '@ironcalc/wasm-xlsx' } })
copyFileSync('node_modules/@ironcalc/wasm-xlsx/wasm_bg.wasm', join(out, 'sheet', 'wasm_bg.wasm'))

mkdirSync(join(out, 'doc'), { recursive: true })
await build({ ...common, entryPoints: ['src/doc.jsx'], outdir: join(out, 'doc') })
const hb = existsSync('node_modules/@docx-editor.dev') ? find('node_modules/@docx-editor.dev', 'harfbuzz.wasm') : null
if (hb === null) { console.error('harfbuzz.wasm not found in the document editor package'); process.exit(1) }
copyFileSync(hb, join(out, 'doc', 'harfbuzz.wasm'))
cpSync('node_modules/@docx-editor.dev/fonts/assets', join(out, 'assets'), { recursive: true })
if (existsSync('node_modules/@docx-editor.dev/fonts/licenses')) cpSync('node_modules/@docx-editor.dev/fonts/licenses', join(out, 'licenses'), { recursive: true })

mkdirSync(join(out, 'md'), { recursive: true })
await build({ ...common, entryPoints: ['src/md.js'], outdir: join(out, 'md') })

// The PDF viewer loads its engine, its worker and its wasm from its own folder: its distribution is copied as it is (the scripts and the wasm, not the demo
// files and the typings next to them) and only the glue of the frame is bundled, with `./embedpdf.js` left as an import of the page.
const dist = 'node_modules/@embedpdf/snippet/dist'
mkdirSync(join(out, 'pdf'), { recursive: true })
await build({ ...common, entryPoints: ['src/pdf.js'], outdir: join(out, 'pdf'), external: ['./embedpdf.js'] })
const shipped = readdirSync(dist).filter((n) => /^[\w.-]+\.js$/.test(n) || n === 'pdfium.wasm')
if (!shipped.includes('embedpdf.js') || !shipped.includes('pdfium.wasm')) { console.error('the PDF viewer package has no embedpdf.js or pdfium.wasm'); process.exit(1) }
for (const n of shipped) copyFileSync(join(dist, n), join(out, 'pdf', n))
