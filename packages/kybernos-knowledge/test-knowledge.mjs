#!/usr/bin/env node
// Comprehensive tests for @local/kybernos-knowledge:
//   - 5-format extraction (.md, .txt, .csv, .docx, .pdf)
//   - incremental indexing, security confinement, secret skipping
//   - BM25 search, citations, secret masking, auto-maintained Markdown wiki
//   - Kaby brief, DSH tools (knowledge_search, knowledge_list)
//   - kybernos-front-desk seam & candidate fact export
//   - client.js factory, bilingual kt(), and settings.section slot
//
//   node packages/kybernos-knowledge/test-knowledge.mjs

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync, deflateSync } from 'node:zlib'
import { extractCsv, extractDocx, extractMarkdown, extractPdf, extractText, maskSecrets } from './knowledge-extract.mjs'
import { createKnowledgeStore } from './knowledge-store.mjs'
import { renderBrief } from './knowledge-brief.mjs'
import { buildKnowledgeTools, registerKnowledgeTools, TOOL_LIST, TOOL_SEARCH } from './knowledge-tools.mjs'
import { KNOWLEDGE_SEAM_KEY, publishKnowledgeSeam } from './knowledge-host.mjs'
import { createToolHost as createFrontDeskToolHost } from '../kybernos-front-desk/fd-tools.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
let pass = 0
let fail = 0
const check = (name, cond, detail) => {
  if (cond === true) { pass += 1; console.log('  ✓ ' + name) }
  else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

/** Builds a minimal valid ZIP archive containing a single file (for .docx tests). */
function makeMinimalZip (entryName, contentBuf, compress = true) {
  const nameBuf = Buffer.from(entryName, 'utf8')
  const compBuf = compress ? deflateRawSync(contentBuf) : contentBuf
  const method = compress ? 8 : 0

  const localHeader = Buffer.alloc(30)
  localHeader.writeUInt32LE(0x04034b50, 0)
  localHeader.writeUInt16LE(20, 4)
  localHeader.writeUInt16LE(0, 6)
  localHeader.writeUInt16LE(method, 8)
  localHeader.writeUInt32LE(0, 14) // crc not validated by reader
  localHeader.writeUInt32LE(compBuf.length, 18)
  localHeader.writeUInt32LE(contentBuf.length, 22)
  localHeader.writeUInt16LE(nameBuf.length, 26)
  localHeader.writeUInt16LE(0, 28)

  const cdOffset = localHeader.length + nameBuf.length + compBuf.length
  const cdHeader = Buffer.alloc(46)
  cdHeader.writeUInt32LE(0x02014b50, 0)
  cdHeader.writeUInt16LE(20, 4)
  cdHeader.writeUInt16LE(20, 6)
  cdHeader.writeUInt16LE(0, 8)
  cdHeader.writeUInt16LE(method, 10)
  cdHeader.writeUInt32LE(0, 16)
  cdHeader.writeUInt32LE(compBuf.length, 20)
  cdHeader.writeUInt32LE(contentBuf.length, 24)
  cdHeader.writeUInt16LE(nameBuf.length, 28)
  cdHeader.writeUInt16LE(0, 30)
  cdHeader.writeUInt16LE(0, 32)
  cdHeader.writeUInt32LE(0, 42)

  const cdSize = cdHeader.length + nameBuf.length
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(cdSize, 12)
  eocd.writeUInt32LE(cdOffset, 16)

  return Buffer.concat([localHeader, nameBuf, compBuf, cdHeader, nameBuf, eocd])
}

/** Builds a minimal PDF with one FlateDecode text stream. */
function makeMinimalPdf (textLine) {
  const streamContent = Buffer.from(`BT /F1 12 Tf 72 720 Td (${textLine}) Tj ET`, 'latin1')
  const compressed = deflateSync(streamContent)
  const head = Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`, 'latin1')
  const tail = Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1')
  return Buffer.concat([head, compressed, tail])
}

const root = mkdtempSync(join(tmpdir(), 'kb-knowledge-'))
const docsDir = join(root, 'atelier-docs')
const outsideDir = join(root, 'outside')
const storeDir = join(root, 'store')

try {
  console.log('\n── 5-format extraction & secret masking ──')
  const mdRes = extractMarkdown('# Ceramic Studio\n\n## Shipping\nWe ship across Europe in 48 hours.\n\n## Returns\n30-day free returns on intact stoneware.', 'policy.md')
  check('Markdown extracts title, headings, section breadcrumbs and line locators',
    mdRes.title === 'Ceramic Studio' &&
    mdRes.headings.length === 3 &&
    mdRes.chunks.some((c) => c.section === 'Ceramic Studio > Shipping' && c.locator.startsWith('L')))

  const txtRes = extractText('Opening hours: Tuesday to Saturday from 10:00 to 18:30.\n\nClosed on Sunday and Monday.', 'hours.txt')
  check('Plain text extracts chunks with line range locator',
    txtRes.chunks.length >= 1 && txtRes.chunks[0].text.includes('Tuesday to Saturday') && txtRes.chunks[0].locator.startsWith('L'))

  const csvRes = extractCsv('Product;Price;Material\nVase Lune;65 EUR;Grès émaillé\nBol Aurore;28 EUR;Porcelaine', 'catalogue.csv')
  check('CSV detects semicolon delimiter and formats key-value rows',
    csvRes.headings.includes('Product') && csvRes.chunks[0].text.includes('Vase Lune') && csvRes.chunks[0].text.includes('65 EUR'))

  const docxXml = '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Workshop Guide</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Kiln firing reaches 1260 degrees Celsius for stoneware &amp; glaze.</w:t></w:r></w:p>' +
    '</w:body></w:document>'
  const docxBuf = makeMinimalZip('word/document.xml', Buffer.from(docxXml, 'utf8'), true)
  const docxRes = extractDocx(docxBuf, 'workshop.docx')
  check('DOCX pure-Node ZIP/OOXML extractor reads heading, text, and XML entities',
    docxRes.title === 'Workshop Guide' &&
    docxRes.chunks.some((c) => c.text.includes('1260 degrees Celsius for stoneware & glaze.')))

  const pdfBuf = makeMinimalPdf('Warranty covers structural kiln defects for two years.')
  const pdfRes = extractPdf(pdfBuf, 'warranty.pdf')
  check('PDF pure-Node FlateDecode stream extractor reads text with page locator',
    pdfRes.chunks.length === 1 && pdfRes.chunks[0].locator === 'page 1' &&
    pdfRes.chunks[0].text.includes('structural kiln defects'))

  check('maskSecrets redacts API keys before display',
    !maskSecrets('token sk-proj-abcdefghijklmnop1234567890 here').includes('abcdefghijklmnop'))

  console.log('\n── incremental indexing, security confinement & Markdown wiki ──')
  mkdirSync(join(docsDir, 'guides'), { recursive: true })
  mkdirSync(join(docsDir, 'node_modules', 'pkg'), { recursive: true })
  mkdirSync(outsideDir, { recursive: true })
  writeFileSync(join(docsDir, 'policy.md'), '# Studio Policy\n\n## Shipping\nLivraison suivie en France et Europe sous 48h.\n\n## API\nNever share sk-live-1234567890abcdefghijklmnop.\n', 'utf8')
  writeFileSync(join(docsDir, 'guides', 'hours.txt'), 'Open Tuesday to Saturday 10h-18h30. Workshop visits by appointment.', 'utf8')
  writeFileSync(join(docsDir, 'catalogue.csv'), 'Item,Price,Stock\nVase Lune,65 EUR,12\nTasse Soleil,22 EUR,30\n', 'utf8')
  writeFileSync(join(docsDir, 'workshop.docx'), docxBuf)
  writeFileSync(join(docsDir, 'warranty.pdf'), pdfBuf)
  // Files that MUST be skipped
  writeFileSync(join(docsDir, '.env'), 'SECRET_KEY=topsecret\n', 'utf8')
  writeFileSync(join(docsDir, 'private.pem'), '-----BEGIN PRIVATE KEY-----\n', 'utf8')
  writeFileSync(join(docsDir, 'node_modules', 'pkg', 'README.md'), '# Ignore me', 'utf8')
  writeFileSync(join(outsideDir, 'leak.md'), '# Outside secret document', 'utf8')
  try { symlinkSync(join(outsideDir, 'leak.md'), join(docsDir, 'escape-link.md')) } catch { /* Windows fallback */ }

  const store = createKnowledgeStore({ dir: storeDir })
  const added = store.addCollection({ name: 'Atelier Lune', rootPath: docsDir, includeFrontDesk: true })
  check('addCollection indexes all 5 supported files and skips .env, .pem, node_modules, symlinks',
    added.ok === true && added.stats.added === 5 && added.stats.docCount === 5)

  const wikiIndex = readFileSync(added.collection.wikiPath, 'utf8')
  check('auto-maintained Markdown wiki index.md and per-doc pages are written',
    wikiIndex.includes('# Atelier Lune — Knowledge Wiki') &&
    wikiIndex.includes('policy.md') &&
    wikiIndex.includes('warranty.pdf') &&
    existsSync(join(storeDir, 'wiki', added.collection.id, 'pages')))

  const reindex1 = store.indexCollection(added.collection.id)
  check('incremental re-index skips all 5 unchanged files',
    reindex1.ok === true && reindex1.stats.unchanged === 5 && reindex1.stats.added === 0 && reindex1.stats.updated === 0)

  writeFileSync(join(docsDir, 'guides', 'hours.txt'), 'Open Tuesday to Saturday 09h30-19h00. New ceramic classes on Friday.', 'utf8')
  const reindex2 = store.indexCollection(added.collection.id)
  check('editing one file updates only that file incrementally',
    reindex2.ok === true && reindex2.stats.updated === 1 && reindex2.stats.unchanged === 4)

  console.log('\n── BM25 search, citations, Kaby brief & DSH tools ──')
  const hitFr = store.search({ query: 'livraison europe 48h' })
  check('BM25 search finds accented/FR passage with exact citation',
    hitFr.ok === true && hitFr.results.length >= 1 &&
    hitFr.results[0].relPath === 'policy.md' &&
    hitFr.results[0].citation.includes('[Atelier Lune] policy.md#Studio Policy > Shipping'))

  const hitDocx = store.search({ query: 'kiln firing 1260 stoneware' })
  check('BM25 search finds passage inside .docx file',
    hitDocx.results.length >= 1 && hitDocx.results[0].relPath === 'workshop.docx')

  const hitPdf = store.search({ query: 'structural kiln defects warranty' })
  check('BM25 search finds passage inside FlateDecode .pdf file',
    hitPdf.results.length >= 1 && hitPdf.results[0].relPath === 'warranty.pdf' && hitPdf.results[0].locator === 'page 1')

  const hitSecret = store.search({ query: 'never share' })
  check('search snippets mask secret-looking tokens',
    hitSecret.results.length >= 1 && !hitSecret.results[0].snippet.includes('1234567890abcdefgh'))

  check('renderBrief emits empty string when no collection is indexed',
    renderBrief(() => []) === '' && renderBrief(() => [{ name: 'Empty', docCount: 0 }]) === '')
  const brief = renderBrief(() => store.listCollections())
  check('renderBrief lists indexed collections and [front-desk] tag',
    brief.includes('Atelier Lune') && brief.includes('[front-desk]') && brief.includes('knowledge_search'))

  const registered = []
  const fakeTools = { register: (def) => { registered.push(def); return () => {} } }
  const offTools = await registerKnowledgeTools(fakeTools, store, root)
  check('registerKnowledgeTools registers knowledge_search and knowledge_list',
    registered.length === 2 && registered[0].name === TOOL_SEARCH && registered[1].name === TOOL_LIST)
  const toolSearchRes = await registered[0].execute({ query: 'Vase Lune 65' })
  const toolSearchText = registered[0].output.render({}, toolSearchRes)
  check('knowledge_search tool executes and renders citable Markdown hits',
    toolSearchRes.ok === true && toolSearchRes.results.length >= 1 && toolSearchText.includes('catalogue.csv'))
  const toolListRes = await registered[1].execute({ collection: added.collection.id })
  const toolListText = registered[1].output.render({}, toolListRes)
  check('knowledge_list tool lists documents inside a collection',
    toolListRes.ok === true && toolListRes.documents.length === 5 && toolListText.includes('workshop.docx'))
  offTools()

  console.log('\n── kybernos-front-desk runtime seam & fact export ──')
  const facts = store.exportFrontDeskFacts({ query: 'livraison europe', maxFacts: 5 })
  check('exportFrontDeskFacts outputs unvalidated draft facts with knowledge: source',
    facts.ok === true && facts.facts.length >= 1 &&
    facts.facts[0].validated === false &&
    facts.facts[0].source.startsWith('knowledge:' + added.collection.id + '/'))

  const unpub = publishKnowledgeSeam(store)
  const fdFakeCall = async (method, path) => {
    if (path === '/api/overview') return { ok: true, status: 200, json: { shop: { name: 'Atelier Lune' }, budget: { spentMicro: 0, capMicro: 1_000_000, currency: 'EUR', enabled: true, killed: false }, conversations: [], waiting: 0, unanswered: [] } }
    if (path === '/api/studio') return { ok: true, status: 200, json: { published: { n: 1 }, dirty: false, reviewed: true, checks: null, diff: [], blockers: [], draft: { name: 'Atelier Lune', knowledge: [] } } }
    return { ok: true, status: 200, json: { ok: true } }
  }
  const fdHost = createFrontDeskToolHost({ call: fdFakeCall })
  const fdStatusWithKb = await fdHost.toolOptions().execute({ action: 'status' })
  check('front_desk status surfaces knowledgeSources when knowledge seam is active',
    fdStatusWithKb.ok === true && Array.isArray(fdStatusWithKb.knowledgeSources) &&
    fdStatusWithKb.knowledgeSources.length === 1 && fdStatusWithKb.knowledgeSources[0].name === 'Atelier Lune')
  unpub()
  const fdStatusWithoutKb = await fdHost.toolOptions().execute({ action: 'status' })
  check('front_desk status omits knowledgeSources cleanly when seam is unpublished',
    fdStatusWithoutKb.ok === true && !('knowledgeSources' in fdStatusWithoutKb) && globalThis[KNOWLEDGE_SEAM_KEY] === undefined)

  // Removal cleans up index and wiki
  const rem = store.removeCollection(added.collection.id)
  check('removeCollection deletes collection, index JSON, and wiki folder',
    rem.ok === true && store.listCollections().length === 0 && !existsSync(added.collection.wikiPath))

  console.log('\n── client.js factory, bilingual kt() and slot registration ──')
  const clientCode = readFileSync(join(HERE, 'client.js'), 'utf8')
  let loadedDef = null
  const fakeWindow = {
    __ModuleLoader__: { load: (def) => { loadedDef = def } },
    __KB_LANG_RESOLVE__: () => 'fr'
  }
  const fakeReact = { createElement: (...a) => a, useState: (v) => [v, () => {}], useEffect: () => {}, useCallback: (fn) => fn }
  const fn = new Function('window', 'document', clientCode)
  fn(fakeWindow, { createElement: () => ({ dataset: {}, remove: () => {} }), head: { append: () => {} } })
  const plugin = loadedDef.factory(() => fakeReact)
  check('client.js registers @local/kybernos-knowledge and exports __test',
    loadedDef && loadedDef.id === '@local/kybernos-knowledge' && typeof plugin.apply === 'function' && plugin.inject.join() === 'slots')
  check('client.js kt() returns French in fr and English in en/es',
    plugin.__test.kt('Base', 'Knowledge') === 'Base' &&
    (() => { fakeWindow.__KB_LANG_RESOLVE__ = () => 'en'; return plugin.__test.kt('Base', 'Knowledge') === 'Knowledge' })() &&
    (() => { fakeWindow.__KB_LANG_RESOLVE__ = () => 'es'; return plugin.__test.kt('Base', 'Knowledge') === 'Knowledge' })())
  const mountedSlots = []
  const effects = []
  plugin.apply({
    slots: {
      inject: (name, cb) => { mountedSlots.push(name); cb(); return () => {} },
      register: (meta) => meta
    },
    effect: (run, label) => { effects.push(label); run() }
  })
  check('client.js mounts settings.section slot with labelled effects',
    mountedSlots.includes('settings.section') && effects.every((l) => l.startsWith('kybernos-knowledge: ')))
} finally {
  try { rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
}

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
assert.equal(fail, 0, fail + ' check(s) failed')
process.exit(0)
