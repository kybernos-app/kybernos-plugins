// Builds ONE self-contained html page from a model folder: the host template, the simulation and example modules of the
// folder, the data files and the .glb files, all inlined. Called by `node scripts/model.mjs page <dir>`.
//
// The folder's model.json says what goes in (every path is relative to the folder):
//   page.title, page.lede      text of the page (escaped here)
//   page.crumb, page.note      optional small text above the title / under the dialog (plain text, escaped)
//   page.strings  { hint, export, exported, exportFailed }   the words of the page itself, to write them in the person's language;
//                 `exported` may use {file} and {kb}. Whatever is missing stays English.
//   page.glb      { key: "file.glb" }                 → GLB.key, the base64 of the file; open it with `await loadParts(GLB.key)`
//   page.data     { NAME: "file.json" | "file.json#a.b" }   → const NAME = <that json, or the part of it at a.b>
//   page.sim      "file.mjs"                          a module whose exports the examples use (its `export`s are stripped)
//   page.modules  ["file.js", ...]                    the example modules (their `export`s are stripped)
//   page.examples ["expression", ...]                 one per tab, evaluated inside the page, e.g. "await myExample({ ...env, parts: await loadParts(GLB.main) })"
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const kitDir = new URL('.', import.meta.url)
const strip = (src) => src.replace(/^export\s+/gm, '')
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const STRINGS = { hint: 'Drag to turn · pinch or ctrl-scroll to zoom', export: 'Export .glb', exported: '{file} · {kb} KB · a valid glTF binary.', exportFailed: 'Export failed' }
// JSON inside a <script>: a literal </script> in a value must not close it
const inline = (value) => JSON.stringify(value).replace(/<\//g, '<\\/')

/** The part of `value` at a dotted path ("constants", "a.b"); the value itself for "". */
const at = (value, path) => path.split('.').filter((k) => k !== '').reduce((v, k) => (v === undefined || v === null ? v : v[k]), value)

/** @returns {{ html: string, bytes: number }} */
export function buildPage(dir) {
  const root = resolve(dir)
  const model = JSON.parse(readFileSync(join(root, 'model.json'), 'utf8'))
  const page = model.page
  if (page === null || typeof page !== 'object') throw new Error('model.json has no "page" section')
  if (!Array.isArray(page.examples) || page.examples.length === 0) throw new Error('page.examples is empty: nothing to show')
  const file = (rel) => {
    const p = join(root, rel)
    if (!existsSync(p)) throw new Error(rel + ' is missing (run the build step first?)')
    return p
  }

  let data = ''
  for (const [name, spec] of Object.entries(page.data || {})) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error('data name ' + name + ' must be UPPER_SNAKE_CASE')
    const [rel, path = ''] = String(spec).split('#')
    const value = at(JSON.parse(readFileSync(file(rel), 'utf8')), path)
    if (value === undefined) throw new Error(spec + ' points at nothing')
    data += `const ${name} = ${inline(value)};\n`
  }
  const glb = Object.entries(page.glb || {}).map(([k, rel]) => `${JSON.stringify(k)}: '${readFileSync(file(rel)).toString('base64')}'`)
  const str = { ...STRINGS, ...(page.strings || {}) }
  data += `const GLB = { ${glb.join(', ')} };\nconst STR = ${inline(str)};`

  let html = readFileSync(new URL('host.template.html', kitDir), 'utf8')
  const put = (marker, text) => {
    if (!html.includes(marker)) throw new Error('host template has no marker ' + marker)
    html = html.split(marker).join(text)
  }
  put('/*@@TITLE@@*/', esc(page.title || model.title || 'Model'))
  put('/*@@LEDE@@*/', esc(page.lede || ''))
  put('/*@@HINT@@*/', esc(str.hint))
  put('/*@@EXPORT@@*/', esc(str.export))
  put('/*@@CRUMB@@*/', page.crumb ? `<p class="crumb">${esc(page.crumb)}</p>` : '')
  put('/*@@NOTE@@*/', page.note ? `<p class="note">${esc(page.note)}</p>` : '')
  put('/*@@SIM@@*/', page.sim ? strip(readFileSync(file(page.sim), 'utf8')) : '')
  put('/*@@DATA@@*/', data)
  put('/*@@MODULES@@*/', (page.modules || []).map((rel) => strip(readFileSync(file(rel), 'utf8'))).join('\n'))
  put('/*@@EXAMPLES@@*/', page.examples.join(',\n  '))
  // a page opened from a file or served alone needs the viewport meta (a published Artifact has it already; a second one is harmless)
  html = html.replace('<meta name="claude:viewport-fit-sides"', () => '<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="claude:viewport-fit-sides"')
  if (/\/\*@@[A-Z]+@@\*\//.test(html)) throw new Error('a marker of the host template was left in the page')
  return { html, bytes: Buffer.byteLength(html) }
}
