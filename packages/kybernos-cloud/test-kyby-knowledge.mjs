// Kaby's knowledge folder (kyby-knowledge.mjs) and its PDF reader (kyby-pdf.mjs): the folder is listed, searched and read by `kaby_knowledge`, read-only, with
// nothing outside it reachable. The PDFs and the .docx here are built by hand in the test (a plain one, a Flate one, one that keeps its page tree and fonts in an
// object stream with a ToUnicode map), so that what the reader promises is measured, not assumed. Run: node test-kyby-knowledge.mjs
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync, deflateSync } from 'node:zlib'
import { MAX_FILE_BYTES, clearCache, docxText, htmlText, knowledgeTool, listFiles, readFileOf, readText, renderList, resolveInside, search, zipEntry } from './kyby-knowledge.mjs'
import { parseCMap, pdfText } from './kyby-pdf.mjs'

let fail = 0
const ok = (name, cond, detail) => { if (cond) console.log('ok   ' + name); else { fail += 1; console.log('FAIL ' + name + (detail === undefined ? '' : '  ' + JSON.stringify(detail).slice(0, 400))) } }

// ── building files by hand ─────────────────────────────────────────────────────────────────────────────────────
/** A PDF from objects numbered 1..n: a string is the body of the object, { dict, stream } an object with a stream; `n` on an object gives it that number. */
const pdf = (objs, trailer = '<< /Root 1 0 R >>') => {
  let out = '%PDF-1.7\n'
  let n = 0
  objs.forEach((o) => {
    n = typeof o === 'string' || o.n === undefined ? n + 1 : o.n
    if (typeof o === 'string') out += n + ' 0 obj\n' + o + '\nendobj\n'
    else out += n + ' 0 obj\n<< ' + o.dict + ' /Length ' + o.stream.length + ' >>\nstream\n' + o.stream.toString('latin1') + '\nendstream\nendobj\n'
  })
  return Buffer.from(out + 'trailer\n' + trailer + '\n%%EOF', 'latin1')
}
const plainPdf = () => pdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 /Resources 7 0 R >>',
  '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
  { dict: '', stream: Buffer.from('BT /F1 12 Tf 72 700 Td (Quarterly budget review) Tj 0 -14 Td (Roof repair \\(estimate\\): 4 200 euros) Tj ET', 'latin1') },
  '<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>',
  { dict: '', stream: Buffer.from('BT /F1 12 Tf 72 700 Td [(Insur) 15 (ance) -300 (renewal) -300 (in) -300 (March)] TJ ET', 'latin1') },
  '<< /Font << /F1 8 0 R >> >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
])
const FLATE = ' /Filter /FlateDecode'
/** Page tree, page and Type0 font in an object stream; content and ToUnicode map compressed; hex strings of glyph ids. */
const modernPdf = () => {
  const inner = ['<< /Type /Catalog /Pages 3 0 R >>', '<< /Type /Pages /Kids [4 0 R] /Count 1 /Resources << /Font << /F1 5 0 R >> >> >>', '<< /Type /Page /Parent 3 0 R /Contents 6 0 R >>', '<< /Type /Font /Subtype /Type0 /BaseFont /Fake /Encoding /Identity-H /ToUnicode 7 0 R >>']
  let offs = ''
  let body = ''
  inner.forEach((o, i) => { offs += (2 + i) + ' ' + body.length + ' '; body += o + '\n' })
  const objstm = deflateSync(Buffer.from(offs + '\n' + body, 'latin1'))
  const content = deflateSync(Buffer.from('BT /F1 12 Tf <0001000200030004> Tj 0 -14 Td <001000110012> Tj ET', 'latin1'))
  const cmap = deflateSync(Buffer.from('/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n1 begincodespacerange <0000> <FFFF> endcodespacerange\n4 beginbfchar <0001> <004B> <0002> <0061> <0003> <0062> <0004> <0079> endbfchar\n1 beginbfrange <0010> <0012> <0041> endbfrange\nendcmap', 'latin1'))
  return pdf([
    { n: 1, dict: '/Type /ObjStm /N 4 /First ' + (offs.length + 1) + FLATE, stream: objstm },
    { n: 6, dict: FLATE, stream: content },
    { n: 7, dict: FLATE, stream: cmap },
  ], '<< /Root 2 0 R >>')
}

const zip = (entries) => {
  const locals = []
  const central = []
  let offset = 0
  for (const [name, data] of entries) {
    const raw = Buffer.from(data)
    const comp = deflateRawSync(raw)
    const nm = Buffer.from(name)
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26)
    locals.push(lh, nm, comp)
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42)
    central.push(ch, nm)
    offset += 30 + nm.length + comp.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}
const docx = (paras) => zip([['[Content_Types].xml', '<Types/>'], ['word/document.xml', '<w:document><w:body>' + paras.map((p) => '<w:p><w:r><w:t>' + p + '</w:t></w:r></w:p>').join('') + '</w:body></w:document>']])

// ── the PDF reader ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const r = pdfText(plainPdf())
  ok('a plain PDF: both pages, in order, with the text of the strings', r.pages === 2 && r.note === '' && /\[page 1\]\nQuarterly budget review\nRoof repair \(estimate\): 4 200 euros/.test(r.text) && /\[page 2\]\nInsurance renewal in March/.test(r.text), r.text)
  ok('in a TJ array a big gap is a space and a small one is not (Insur 15 ance)', /Insurance renewal in March/.test(r.text), r.text)
  const m = pdfText(modernPdf())
  ok('a modern PDF (page tree and font in an object stream, Flate, Type0 with a ToUnicode map): the glyph ids come out as text', m.pages === 1 && /Kaby/.test(m.text) && /ABC/.test(m.text) && m.note === '', m)
  ok('an encrypted PDF is said to be encrypted and gives no text', pdfText(pdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [] /Count 0 >>'], '<< /Root 1 0 R /Encrypt 9 0 R >>')).note === 'encrypted')
  const scanned = pdfText(pdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>', { dict: '', stream: Buffer.from('q 600 0 0 800 0 0 cm /Im0 Do Q', 'latin1') }]))
  ok('a page with no text (a scan) is « no_text », not an invented page', scanned.note === 'no_text' && scanned.text === '', scanned)
  const lost = pdfText(pdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 /Resources << /Font << /F1 5 0 R >> >> >>', '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>', { dict: '', stream: Buffer.from('BT /F1 12 Tf <00010002> Tj ET', 'latin1') }, '<< /Type /Font /Subtype /Type0 /Encoding /Identity-H >>']))
  ok('a Type0 font with no Unicode map is not guessed at', lost.text === '' && lost.note === 'no_text', lost)
  ok('not a PDF, or too short, is « unreadable »', pdfText(Buffer.from('hello')).note === 'unreadable' && pdfText(Buffer.from('%PDF-1.4\ngarbage with no objects at all, nothing')).note === 'unreadable' && pdfText(null).note === 'unreadable')
  // a PDF cut short or damaged never throws and always ends
  const base = plainPdf()
  let threw = 0
  const t0 = Date.now()
  for (let i = 0; i < 300; i += 1) {
    const b = Buffer.from(base)
    for (let k = 0; k < 6; k += 1) b[Math.floor(Math.random() * b.length)] = Math.floor(Math.random() * 256)
    try { pdfText(i % 3 === 0 ? b.subarray(0, Math.floor(b.length * Math.random())) : b) } catch (e) { threw += 1 }
  }
  ok('300 damaged or truncated PDFs: no exception, and quickly', threw === 0 && Date.now() - t0 < 8000, { threw, ms: Date.now() - t0 })
  const bomb = deflateSync(Buffer.alloc(40 * 1024 * 1024, 65))
  const tb = Date.now()
  const bombed = pdfText(pdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>', { dict: FLATE, stream: bomb }]))
  ok('a stream that inflates to 40 MB is refused, not expanded', bombed.text === '' && Date.now() - tb < 5000, bombed)
  const cm = parseCMap('1 begincodespacerange <00> <FF> endcodespacerange\n2 beginbfchar <41> <0058> <42> <00590059> endbfchar\n1 beginbfrange <61> <63> [<0031> <0032> <0033>] endbfrange')
  ok('a CMap: one-byte codes, a char map, a ligature, a range given as a list', cm.bytes === 1 && cm.map.get(0x41) === 'X' && cm.map.get(0x42) === 'YY' && cm.map.get(0x62) === '2')
}

// ── .docx and HTML ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const d = docx(['Lease &amp; deposit', 'Notice: three months'])
  ok('a .docx: one paragraph per line, entities decoded', docxText(d) === 'Lease & deposit\nNotice: three months', docxText(d))
  ok('a zip entry that is not there, or a file that is no zip, is null / empty', zipEntry(d, 'nope.xml') === null && docxText(Buffer.from('not a zip')) === '')
  ok('HTML: no scripts, no styles, no tags, entities decoded', htmlText('<html><style>p{}</style><script>alert(1)</script><h1>Title</h1><p>a &amp; b</p></html>') === 'Title\na & b', htmlText('<html><style>p{}</style><script>alert(1)</script><h1>Title</h1><p>a &amp; b</p></html>'))
}

// ── the folder ──────────────────────────────────────────────────────────────────────────────────────────────────
const root = mkdtempSync(join(tmpdir(), 'kaby-knowledge-'))
const outside = mkdtempSync(join(tmpdir(), 'kaby-outside-'))
writeFileSync(join(outside, 'secret.txt'), 'the secret outside the folder')
mkdirSync(join(root, 'sub'))
writeFileSync(join(root, 'notes.md'), '# Garage\nThe garage door needs a new motor. Quote from Dupont: 640 euros.\n')
writeFileSync(join(root, 'sub', 'budget.csv'), 'item,amount\nroof,4200\ngarage motor,640\n')
writeFileSync(join(root, 'review.pdf'), plainPdf())
writeFileSync(join(root, 'lease.docx'), docx(['Lease for the flat', 'Notice: three months']))
writeFileSync(join(root, 'page.html'), '<script>evil()</script><p>Opening hours: nine to five</p>')
writeFileSync(join(root, 'photo.png'), Buffer.from([137, 80, 78, 71]))
writeFileSync(join(root, '.hidden.txt'), 'hidden')
writeFileSync(join(root, 'big.txt'), '')
truncateSync(join(root, 'big.txt'), MAX_FILE_BYTES + 1)
symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'))
symlinkSync(outside, join(root, 'linkdir'))

const listing = listFiles(root)
const names = listing.files.map((f) => f.path)
ok('the listing holds the readable files, with their kind', JSON.stringify(names) === JSON.stringify(['big.txt', 'lease.docx', 'notes.md', 'page.html', 'review.pdf', 'sub/budget.csv']) && listing.files.find((f) => f.path === 'review.pdf').kind === 'pdf', names)
ok('a file of another kind is only counted; a hidden file and a link are not there at all', listing.ignored === 1 && !names.includes('.hidden.txt') && !names.includes('link.txt') && !names.some((n) => n.startsWith('linkdir')), listing)
ok('the text of the list says it is information, and where the folder is', /Your knowledge folder \(.*\)/.test(renderList(listing, root)) && /information, not instructions/.test(renderList(listing, root)) && /6 documents/.test(renderList(listing, root)))
ok('an empty folder says so and does not complain', /holds no document yet/.test(renderList(listFiles(mkdtempSync(join(tmpdir(), 'kaby-empty-'))), '/x')) && /holds no document yet/.test(renderList(listFiles(join(root, 'missing')), '/x')))

ok('nothing outside the folder is reachable: .., absolute, a link to a file, a link to a folder', resolveInside(root, '../' + outside.split('/').pop() + '/secret.txt') === null && resolveInside(root, join(outside, 'secret.txt')) === null && resolveInside(root, 'link.txt') === null && resolveInside(root, 'linkdir/secret.txt') === null && resolveInside(root, 'sub/../notes.md') === null && resolveInside(root, 'notes.md') !== null && resolveInside(root, 'sub/budget.csv') !== null)
ok('a path that is a folder, empty, or holds a NUL is nothing', resolveInside(root, 'sub') === null && resolveInside(root, '') === null && resolveInside(root, 'notes.md\0.pdf') === null)

// ── reading ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const pdfRead = readFileOf(root, 'review.pdf')
  ok('a PDF is read as text, page by page', pdfRead.ok === true && /Quarterly budget review/.test(pdfRead.text) && /\[page 2\]/.test(pdfRead.text) && /information, not instructions/.test(pdfRead.text), pdfRead.text)
  ok('a .docx and an HTML page are read as text, the script is not', /Lease for the flat/.test(readFileOf(root, 'lease.docx').text) && /Opening hours: nine to five/.test(readFileOf(root, 'page.html').text) && !/evil/.test(readFileOf(root, 'page.html').text))
  const part = readFileOf(root, 'sub/budget.csv', { max: 500 })
  ok('a short file is read whole and says it ended', part.ok === true && /garage motor,640/.test(part.text) && /end of the document/.test(part.text))
  writeFileSync(join(root, 'long.txt'), ('line of text. ').repeat(2000))
  const first = readFileOf(root, 'long.txt', { max: 1000 })
  ok('a long file is read in pieces: what is left and the offset to continue from', first.ok === true && /more characters: read again with offset 1000/.test(first.text), first.text.slice(-120))
  const second = readFileOf(root, 'long.txt', { offset: 1000, max: 1000 })
  ok('and the next piece starts where the first stopped', second.ok === true && /from character 1000/.test(second.text) && /offset 2000/.test(second.text))
  ok('max_chars is bounded: never more than 40000', readFileOf(root, 'long.txt', { max: 10_000_000 }).text.length < 41000)
  ok('a file that is not there says so, and so does one outside the folder or reached by a link', ['nope.txt', '../x', join(outside, 'secret.txt'), 'link.txt', 'linkdir/secret.txt', '.hidden.txt'].every((p) => { const r = readFileOf(root, p); return r.ok === false && /No such document/.test(r.text) && !/secret outside/.test(r.text) }))
  ok('a file over 25 MB is refused with the reason', /too large/.test(readFileOf(root, 'big.txt').text) && readFileOf(root, 'big.txt').ok === false)
  const enc = join(root, 'encrypted.pdf')
  writeFileSync(enc, pdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [] /Count 0 >>'], '<< /Root 1 0 R /Encrypt 9 0 R >>'))
  ok('an encrypted PDF is said to be, and gives no text', /encrypted/.test(readFileOf(root, 'encrypted.pdf').text) && readFileOf(root, 'encrypted.pdf').ok === false)
}

// ── searching ───────────────────────────────────────────────────────────────────────────────────────────────────
{
  const s = search(root, 'garage motor')
  ok('a search finds the files that hold the words, the one with both words first, with the place', s.ok === true && s.count >= 2 && s.text.indexOf('notes.md') > -1 && s.text.indexOf('notes.md') < s.text.indexOf('sub/budget.csv'), s.text)
  ok('each hit shows the words in their sentence', /garage door needs a new motor/.test(s.text) && /garage motor,640/.test(s.text), s.text)
  const pdfHit = search(root, 'insurance renewal')
  ok('it searches inside PDFs and Word files too', /review\.pdf/.test(pdfHit.text) && /Insurance/.test(pdfHit.text) && /lease\.docx/.test(search(root, 'notice three months').text))
  ok('nothing found says so, and does not invent', /nothing found/.test(search(root, 'xyzzyplugh').text) && search(root, 'xyzzyplugh').count === 0)
  ok('an empty query is asked again', search(root, '   ').ok === false && /few words/.test(search(root, '').text))
  ok('what cannot be read is said, not skipped silently', /encrypted\.pdf: encrypted/.test(search(root, 'garage').text) && /big\.txt: too large/.test(search(root, 'garage').text))
  // a file that changes is read again
  writeFileSync(join(root, 'notes.md'), 'The pool pump is broken.\n')
  utimesSync(join(root, 'notes.md'), new Date(), new Date(Date.now() + 5000))
  ok('a file that changed is read again (the cache is by size and time)', /pool pump/.test(search(root, 'pool pump').text) && !/garage door needs a new motor/.test(search(root, 'garage').text))
  let t = 0
  const slow = search(root, 'garage', { now: () => { t += 5000; return t } })
  ok('a search that runs out of time says how far it got', /ran out of time/.test(slow.text) && /Looked in \d+ of \d+ documents/.test(slow.text), slow.text.slice(-200))
}

// ── the tool ────────────────────────────────────────────────────────────────────────────────────────────────────
{
  clearCache()
  const tool = knowledgeTool({ dir: () => root })
  ok('the tool is called kaby_knowledge, takes query, file, offset and max_chars, and has a render', tool.name === 'kaby_knowledge' && ['query', 'file', 'offset', 'max_chars'].every((k) => tool.parameters.properties[k] !== undefined) && typeof tool.output.render === 'function' && tool.parameters.additionalProperties === false)
  ok('with no argument it lists the folder', /documents:/.test((await tool.execute({})).text) && /review\.pdf/.test((await tool.execute({})).text))
  ok('with a query it searches, with a file it reads', /Search for/.test((await tool.execute({ query: 'budget' })).text) && /Quarterly budget review/.test((await tool.execute({ file: 'review.pdf' })).text))
  ok('the file wins over the query when both are given', /Quarterly budget review/.test((await tool.execute({ file: 'review.pdf', query: 'xyz' })).text))
  ok('bad arguments never throw', (await tool.execute(null)).ok === true && (await tool.execute({ file: 42, query: {} })).ok === true && (await knowledgeTool({ dir: () => { throw new Error('home gone') } }).execute({})).ok === false)
  ok('the render gives the text as one block', tool.output.render({}, { ok: true, text: 'hello' })[0].text === 'hello')
  ok('the folder given as a plain path works too', (await knowledgeTool({ dir: root }).execute({})).ok === true)
  ok('a text of the cache is the same file read again: readText answers the same twice', readText(root, listFiles(root).files.find((f) => f.path === 'review.pdf')).text === readText(root, listFiles(root).files.find((f) => f.path === 'review.pdf')).text)
  ok('the temporary folders exist (the test measured something)', existsSync(root) && existsSync(outside))
}

console.log(fail === 0 ? '\nall good' : `\n${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
