// Office files made on the fly for the tests: nothing here is stored as a fixture file (contract rule 7 of
// docs/dev/office-editors-open-save-contract-2026-11-03.md). A tiny zip writer (stored or deflated parts) and the smallest .docx / .xlsx that
// Word, Excel and the light editors open, with switches for the things the guard looks for (a chart, a comment, tracked changes…).
import { crc32, deflateRawSync } from 'node:zlib'

/** `parts`: `{ 'path/in/zip': string|Buffer }`. Every second part is deflated so both methods get read. */
export const zip = (parts) => {
  const locals = []
  const centrals = []
  let offset = 0
  let i = 0
  for (const [name, data] of Object.entries(parts)) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8')
    const deflated = i % 2 === 1
    const body = deflated ? deflateRawSync(raw) : raw
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(deflated ? 8 : 0, 8)
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, body)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(deflated ? 8 : 0, 10)
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + body.length
    i += 1
  }
  const dir = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(i, 8); end.writeUInt16LE(i, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, dir, end])
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const types = (overrides) => `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${overrides}</Types>`
const rels = (list) => `${XML}<Relationships xmlns="${PKG}">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join('')}</Relationships>`

/** A .docx. `opts`: `{ text, tracked, comment, image, field, control, macro }`. Valid enough for Word and for the light editor to open. */
export const docx = (opts = {}) => {
  const o = opts
  const text = o.text === undefined ? 'Hello from the test' : o.text
  const body = `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
    + (o.tracked ? '<w:p><w:ins w:id="1" w:author="a"><w:r><w:t>added</w:t></w:r></w:ins><w:del w:id="2" w:author="a"><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>' : '')
    + (o.field ? '<w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>' : '')
    + (o.control ? '<w:sdt><w:sdtContent><w:p><w:r><w:t>x</w:t></w:r></w:p></w:sdtContent></w:sdt>' : '')
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const parts = {
    '[Content_Types].xml': types(`<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>`),
    '_rels/.rels': rels([['rId1', OD + '/officeDocument', 'word/document.xml']]),
    'word/_rels/document.xml.rels': rels([['rId1', OD + '/styles', 'styles.xml']]),
    'word/styles.xml': `${XML}<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`,
    'word/document.xml': `${XML}<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`,
  }
  if (o.comment) parts['word/comments.xml'] = `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="a"><w:p><w:r><w:t>note</w:t></w:r></w:p></w:comment></w:comments>`
  if (o.image) parts['word/media/image1.png'] = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  if (o.macro) parts['word/vbaProject.bin'] = Buffer.from([1, 2, 3])
  return zip(parts)
}

/** An .xlsx. `opts`: `{ cell, chart, comment, validation, filter, image, pivot, macro }`. Valid enough for Excel and for the light editor to open. */
export const xlsx = (opts = {}) => {
  const o = opts
  const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const sheet = `${XML}<worksheet xmlns="${S}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${o.cell === undefined ? 'Total' : o.cell}</t></is></c><c r="B1"><v>42</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Double</t></is></c><c r="B2"><f>B1*2</f><v>84</v></c></row></sheetData>`
    + (o.filter ? '<autoFilter ref="A1:B2"/>' : '')
    + (o.validation ? '<dataValidations count="1"><dataValidation type="list" sqref="A1"><formula1>"a,b"</formula1></dataValidation></dataValidations>' : '')
    + '</worksheet>'
  const parts = {
    '[Content_Types].xml': types(`<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`),
    '_rels/.rels': rels([['rId1', OD + '/officeDocument', 'xl/workbook.xml']]),
    'xl/_rels/workbook.xml.rels': rels([['rId1', OD + '/worksheet', 'worksheets/sheet1.xml'], ['rId2', OD + '/styles', 'styles.xml']]),
    'xl/workbook.xml': `${XML}<workbook xmlns="${S}" xmlns:r="${OD}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/styles.xml': `${XML}<styleSheet xmlns="${S}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': sheet,
  }
  if (o.chart) parts['xl/charts/chart1.xml'] = '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>'
  if (o.comment) parts['xl/comments1.xml'] = `<comments xmlns="${S}"/>`
  if (o.image) parts['xl/media/image1.png'] = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  if (o.pivot) parts['xl/pivotTables/pivotTable1.xml'] = `<pivotTableDefinition xmlns="${S}"/>`
  if (o.macro) parts['xl/vbaProject.bin'] = Buffer.from([1, 2, 3])
  return zip(parts)
}

/** A Markdown file. `opts`: `{ text, front, comment, html, footnote, ref, math, wiki, code, crlf }`: the things the guard looks for, and `code` puts them inside a fence (where they are no loss). */
export const md = (opts = {}) => {
  const o = opts
  const lines = []
  if (o.front) lines.push('---', 'title: A note', 'tags: [a, b]', '---', '')
  lines.push('# ' + (o.text === undefined ? 'Notes' : o.text), '', 'Some *prose* with a [link](https://example.com).', '', '- one', '- two', '')
  const extra = []
  if (o.comment) extra.push('<!-- a note for later -->')
  if (o.html) extra.push('<div class="x">raw html</div>')
  if (o.footnote) extra.push('A claim.[^1]', '', '[^1]: The source.')
  if (o.ref) extra.push('See [the docs][d].', '', '[d]: https://example.com/docs')
  if (o.math) extra.push('$$ a^2 + b^2 = c^2 $$')
  if (o.wiki) extra.push('See [[Another page]].')
  if (o.code) lines.push('```html', ...extra, '```', '')
  else lines.push(...extra)
  const text = lines.join('\n') + '\n'
  return Buffer.from(o.crlf ? text.replace(/\n/g, '\r\n') : text, 'utf8')
}

/** A one-page PDF with a text line. `opts`: `{ text, encrypt, signature, form, attachment }`. A real xref table, so readers open it. */
export const pdf = (opts = {}) => {
  const o = opts
  const content = `BT /F1 12 Tf 20 100 Td (${o.text === undefined ? 'Hello PDF' : o.text}) Tj ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R' + (o.form ? ' /AcroForm << /Fields [] >>' : '') + ' >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  if (o.signature) objs.push('<< /Type /Sig /Filter /Adobe.PPKLite /ByteRange [0 10 20 30] /Contents <00> >>')
  if (o.attachment) objs.push('<< /Type /EmbeddedFile /Length 0 >>\nstream\n\nendstream')
  let body = '%PDF-1.4\n'
  const at = []
  objs.forEach((x, i) => { at.push(body.length); body += `${i + 1} 0 obj\n${x}\nendobj\n` })
  const xref = body.length
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + at.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('')
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R${o.encrypt ? ' /Encrypt 9 0 R' : ''} >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}
