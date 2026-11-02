// Tests of the `data-feed` skill: its folder is sound and seedable, its script reads CSV / Excel / JSON the way people really write them, the file it prepares is what the Tables
// tool `records_import` expects, and a sales CSV goes all the way: profile → table → import → a dashboard whose numbers match the file. Offline, hermetic (temp folders only).
//   (cd packages/kybernos-plugin && node test-data-feed.mjs)
import { spawnSync } from 'node:child_process'
import { deflateRawSync } from 'node:zlib'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedSkills } from './seed-skills.mjs'
import { listCompanions, seedSkillFiles } from './seed-skill-files.mjs'
import { parseDelimited, profileColumn, readTable } from './skills/data-feed/scripts/feed.mjs'
import { coerceCell, dateOrderOf, decimalOf } from '../kybernos-db/agent/import.mjs'
import { NAMES, tools } from '../kybernos-db/agent/tools.mjs'
import { makeService } from '../kybernos-db/agent/service.mjs'
import { makeApi } from '../kybernos-db/api.mjs'
import * as M from '../kybernos-dashboards/model.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SKILL = join(HERE, 'skills', 'data-feed')
const FEED = join(SKILL, 'scripts', 'feed.mjs')
let failed = 0
let total = 0
const check = (name, ok, detail) => {
  total += 1
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400)))
  if (!ok) failed += 1
}
const root = mkdtempSync(join(tmpdir(), 'kb-data-feed-'))
const home = join(root, 'dsh')
const files = join(root, 'files')
mkdirSync(files, { recursive: true })
const put = (name, data) => { const f = join(files, name); writeFileSync(f, data); return f }
const feed = (args, env = {}) => {
  const r = spawnSync(process.execPath, [FEED, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, DSH_HOME: home, ...env } })
  let json
  try { json = JSON.parse(r.stdout) } catch (e) { json = { ok: false, error: 'unreadable', detail: r.stdout + r.stderr } }
  return { ...json, code: r.status }
}
const rowsOf = (id) => readFileSync(join(home, 'kybernos', 'imports', id + '.jsonl'), 'utf8').trim().split('\n').slice(1).map((l) => JSON.parse(l))
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ── a zip, an .xlsx ─────────────────────────────────────────────────────────────────────────────────────────
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function zip (entries) {
  const parts = []
  const central = []
  let offset = 0
  for (const [name, data, deflate] of entries) {
    const raw = Buffer.from(data)
    const body = deflate ? deflateRawSync(raw) : raw
    const nameBuf = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(deflate ? 8 : 0, 8)
    local.writeUInt32LE(crc32(raw), 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26)
    parts.push(local, nameBuf, body)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(deflate ? 8 : 0, 10)
    dir.writeUInt32LE(crc32(raw), 16); dir.writeUInt32LE(body.length, 20); dir.writeUInt32LE(raw.length, 24); dir.writeUInt16LE(nameBuf.length, 28); dir.writeUInt32LE(offset, 42)
    central.push(dir, nameBuf)
    offset += 30 + nameBuf.length + body.length
  }
  const dirBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(dirBuf.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, dirBuf, end])
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const colName = (i) => String.fromCharCode(65 + i)
/** sheets: [{ name, rows, hidden? }]; a cell is a string (shared), a number, a boolean, { date: serial }, { inline: text }, { rich: [a, b] } or null. */
function xlsx (sheets, { date1904 = false } = {}) {
  const shared = []
  const sst = (s) => { let i = shared.indexOf(s); if (i < 0) { shared.push(s); i = shared.length - 1 } return i }
  const sheetXml = (rows) => '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + rows.map((cells, r) => '<row r="' + (r + 1) + '">' + cells.map((v, c) => {
    const ref = colName(c) + (r + 1)
    if (v === null || v === undefined) return '<c r="' + ref + '"/>'
    if (typeof v === 'string') return '<c r="' + ref + '" t="s"><v>' + sst(v) + '</v></c>'
    if (typeof v === 'number') return '<c r="' + ref + '"><v>' + v + '</v></c>'
    if (typeof v === 'boolean') return '<c r="' + ref + '" t="b"><v>' + (v ? 1 : 0) + '</v></c>'
    if (v.date !== undefined) return '<c r="' + ref + '" s="' + (v.custom ? 2 : 1) + '"><v>' + v.date + '</v></c>'
    if (v.inline !== undefined) return '<c r="' + ref + '" t="inlineStr"><is><t>' + esc(v.inline) + '</t></is></c>'
    return '<c r="' + ref + '" t="s"><v>' + sst({ rich: v.rich }) + '</v></c>'
  }).join('') + '</row>').join('') + '</sheetData></worksheet>'
  const sheetFiles = sheets.map((s, i) => ['xl/worksheets/sheet' + (i + 1) + '.xml', sheetXml(s.rows), true])
  const sstXml = '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + shared.map((s) => (typeof s === 'string' ? '<si><t xml:space="preserve">' + esc(s) + '</t></si>' : '<si>' + s.rich.map((t) => '<r><rPr><b/></rPr><t>' + esc(t) + '</t></r>').join('') + '<rPh sb="0" eb="1"><t>PHONETIC</t></rPh></si>')).join('') + '</sst>'
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
    ['xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' + (date1904 ? '<workbookPr date1904="1"/>' : '<workbookPr/>') + '<sheets>' + sheets.map((s, i) => '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '"' + (s.hidden ? ' state="hidden"' : '') + ' r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '</Relationships>'],
    ['xl/styles.xml', '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>'],
    ...sheetFiles,
    ['xl/sharedStrings.xml', sstXml, true],
  ])
}
const serial = (y, m, d) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000

// ── the folder ──────────────────────────────────────────────────────────────────────────────────────────────
console.log('the folder')
{
  const text = readFileSync(join(SKILL, 'SKILL.md'), 'utf8')
  const head = /^---\nname: (data-feed)\ndescription: (.+)\nwhenToUse: (.+)\n---\n/.exec(text)
  check('SKILL.md has its front matter (name, description, whenToUse) and the name is the folder\'s', head !== null)
  check('the description fits what DSH accepts (1 024 characters) and SKILL.md the vetting limit (24 KB)', head !== null && head[2].length <= 1024 && Buffer.byteLength(text) <= 24 * 1024)
  const all = readdirSync(SKILL, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name).slice(SKILL.length + 1)).sort()
  check('every file is seedable: nothing is silently skipped by the seeder', eq(listCompanions(SKILL).concat(['SKILL.md']).sort(), all), all)
  check('no personal path or address in it', all.every((f) => !/\/Users\/|@gmail|@yopmail/.test(readFileSync(join(SKILL, f), 'utf8'))))
  const src = readFileSync(FEED, 'utf8')
  const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
  check('the script needs nothing but Node itself', imports.length > 0 && imports.every((i) => i.startsWith('node:')), imports)
  check('data-feed is in the list of skills the plugin seeds', /const KB_SHIPPED_SKILLS = \[[^\]]*'data-feed'/.test(readFileSync(join(HERE, 'index.js'), 'utf8')))
}

console.log('seeded copy')
{
  const seedHome = join(root, 'seed-home')
  mkdirSync(seedHome, { recursive: true })
  const a = seedSkills({ home: seedHome, sourceDir: join(HERE, 'skills'), names: ['data-feed'] })
  const b = seedSkillFiles({ home: seedHome, sourceDir: join(HERE, 'skills'), names: ['data-feed'] })
  check('SKILL.md and the script land under <home>/skills/data-feed', a.every((r) => r.action === 'created') && b.some((r) => r.counts && r.counts.created >= 1) && existsSync(join(seedHome, 'skills', 'data-feed', 'SKILL.md')) && existsSync(join(seedHome, 'skills', 'data-feed', 'scripts', 'feed.mjs')), { a, b })
  const csv = put('seeded.csv', 'a,b\n1,2\n')
  const r = spawnSync(process.execPath, [join(seedHome, 'skills', 'data-feed', 'scripts', 'feed.mjs'), 'parse', csv], { encoding: 'utf8', env: { PATH: process.env.PATH, DSH_HOME: seedHome } })
  const out = JSON.parse(r.stdout)
  check('the seeded copy runs on its own, from the path the skill gives, and writes under DSH_HOME', r.status === 0 && out.ok === true && out.file.startsWith(join(seedHome, 'kybernos', 'imports')) && existsSync(out.file), out)
}

// ── delimited text ──────────────────────────────────────────────────────────────────────────────────────────
console.log('text tables')
{
  check('quotes, doubled quotes and line breaks inside quotes', eq(parseDelimited('a,"b,1","say ""hi""","x\ny"\r\n1,2,3,4\n', ',').map((r) => r.cells), [['a', 'b,1', 'say "hi"', 'x\ny'], ['1', '2', '3', '4']]))
  check('CRLF, a missing final newline and an empty last cell', eq(parseDelimited('a;b\r\n1;\r\n2;3', ';').map((r) => r.cells), [['a', 'b'], ['1', ''], ['2', '3']]))
  const sniff = (text, ext = '.csv') => { const f = put('sniff-' + Math.random().toString(36).slice(2) + ext, text); return readTable(f) }
  check('comma, semicolon, tab and pipe are told apart', [['a,b,c\n1,2,3\n', ','], ['a;b;c\n1,5;2;3\n', ';'], ['a\tb\tc\n1\t2\t3\n', '\t'], ['a|b|c\n1|2|3\n', '|']].every(([t, d]) => sniff(t).delimiter === d))
  check('a decimal comma does not make a comma file out of a semicolon file', sniff('Total;Date\n1,5;05/01/2026\n2,25;06/01/2026\n').delimiter === ';')
  check('the « sep= » line Excel adds is honoured and dropped', eq(sniff('sep=;\na;b\n1;2\n').columns, ['a', 'b']))
  const bom = readTable(put('bom.csv', '﻿Name,Qty\nAda,2\n'))
  check('a BOM is dropped from the first column title', bom.columns[0] === 'Name')
  const latin = readTable(put('latin1.csv', Buffer.from('Nom;Prénom\nMüller;Zoë\n', 'latin1')))
  check('a Windows-1252 file is decoded as such (accents survive)', latin.encoding === 'windows-1252' && latin.columns[1] === 'Prénom' && latin.rows[0].c[0] === 'Müller', latin)
  const odd = readTable(put('odd.csv', 'Name,,Name,Qty\nAda,x,y,1\n\n  ,  ,  ,  \nBob,short\nCy,1,2,3,4,5\n'))
  check('blank and duplicate titles are made unique; empty rows are skipped; short rows are padded; long rows cut', eq(odd.columns, ['Name', 'column 2', 'Name (2)', 'Qty']) && odd.rows.length === 3 && eq(odd.rows[1].c, ['Bob', 'short', null, null]) && eq(odd.rows[2].c, ['Cy', '1', '2', '3']), odd)
  check('a row keeps its number in the file', eq(odd.rows.map((r) => r.r), [2, 5, 6]))
  const under = readTable(put('title.csv', 'Sales report 2026\n\nName,Qty\nAda,2\n'), { headerRow: 3 })
  check('--header-row skips the lines above the real header', eq(under.columns, ['Name', 'Qty']) && under.rows.length === 1)
  check('an empty file is said to be empty', (() => { try { readTable(put('empty.csv', '')); return false } catch (e) { return e.feed === 'empty' } })())
}

// ── JSON ────────────────────────────────────────────────────────────────────────────────────────────────────
console.log('JSON')
{
  const orders = [{ id: 1, total: 12.5, customer: { name: 'Ada', tags: ['a', 'b'] }, paid: true }, { id: 2, total: null, customer: { name: 'Bob' }, extra: 'x' }]
  const t = readTable(put('orders.json', JSON.stringify(orders)))
  check('an array of objects: one column per key, nested keys flattened, scalar lists joined, missing keys empty', eq(t.columns, ['id', 'total', 'customer.name', 'customer.tags', 'paid', 'extra']) && eq(t.rows[0].c, [1, 12.5, 'Ada', 'a; b', true, null]) && eq(t.rows[1].c, [2, null, 'Bob', null, null, 'x']), t)
  check('the list is found under data, items or results; a path names another', readTable(put('wrap.json', JSON.stringify({ meta: {}, data: orders }))).rows.length === 2 && readTable(put('deep.json', JSON.stringify({ a: { b: orders } })), { path: 'a.b' }).rows.length === 2)
  check('two lists and no path: asks for the path', (() => { try { readTable(put('two.json', JSON.stringify({ x: orders, y: orders }))); return false } catch (e) { return e.feed === 'which_array' } })())
  check('JSON lines', readTable(put('lines.jsonl', orders.map((o) => JSON.stringify(o)).join('\n') + '\n')).rows.length === 2)
  check('invalid JSON is said so', (() => { try { readTable(put('bad.json', '{"a":')); return false } catch (e) { return e.feed === 'format' } })())
  check('a JSON file without an extension is recognised', readTable(put('noext', JSON.stringify(orders))).format === 'json')
}

// ── Excel ───────────────────────────────────────────────────────────────────────────────────────────────────
console.log('Excel')
{
  const book = xlsx([
    { name: 'Sales', rows: [['Order', 'Date', 'Amount', 'Paid', 'Note'], ['A-1', { date: serial(2026, 1, 5) }, 1249.5, true, { inline: 'Tom & Jerry' }], ['A-2', { date: serial(2026, 1, 13), custom: true }, 99, false, { rich: ['Bold', ' text'] }], [], ['A-3', { date: serial(2026, 1, 21) + 0.5 }, null, null, null]] },
    { name: 'Hidden', hidden: true, rows: [['x'], ['y']] },
    { name: 'Other', rows: [['k', 'v'], ['one', 1], ['two', 2]] },
  ])
  const t = readTable(put('book.xlsx', book))
  check('the first visible sheet, its sheets listed without the hidden one', t.format === 'xlsx' && t.sheet === 'Sales' && eq(t.sheets, ['Sales', 'Other']), { sheet: t.sheet, sheets: t.sheets })
  check('text, numbers, booleans, inline and rich strings (phonetic text left out), entities', eq(t.rows[0].c, ['A-1', '2026-01-05', 1249.5, true, 'Tom & Jerry']) && t.rows[1].c[4] === 'Bold text' && t.rows[1].c[3] === false, t.rows)
  check('date cells (built-in and custom formats) come out as dates, with the time when there is one', t.rows[1].c[1] === '2026-01-13' && t.rows[2].c[1] === '2026-01-21T12:00:00', t.rows.map((r) => r.c[1]))
  check('an empty row is skipped and the rows keep their sheet numbers', eq(t.rows.map((r) => r.r), [2, 3, 5]))
  check('--sheet takes a name, a name in other case, or a number', readTable(put('book2.xlsx', book), { sheet: 'Other' }).rows.length === 2 && readTable(put('book3.xlsx', book), { sheet: 'other' }).columns[0] === 'k' && readTable(put('book4.xlsx', book), { sheet: '2' }).sheet === 'Other')
  check('an unknown sheet lists the sheets', (() => { try { readTable(put('book5.xlsx', book), { sheet: 'Nope' }); return false } catch (e) { return e.feed === 'unknown_sheet' && /"Sales"/.test(e.message) } })())
  const old = readTable(put('b1904.xlsx', xlsx([{ name: 'S', rows: [['d'], [{ date: 0 }], [{ date: 1462 }]] }], { date1904: true })))
  check('the 1904 date system', eq(old.rows.map((r) => r.c[0]), ['1904-01-01', '1908-01-02']), old.rows)
  check('an old .xls file is refused with what to do', (() => { try { readTable(put('old.xls', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]))); return false } catch (e) { return e.feed === 'xls' } })())
  check('a zip that is not a workbook is refused', (() => { try { readTable(put('other.xlsx', zip([['hello.txt', 'hi']]))); return false } catch (e) { return e.feed === 'format' } })())
  check('a damaged file is refused, not crashed on', (() => { try { readTable(put('cut.xlsx', book.subarray(0, 120))); return false } catch (e) { return typeof e.feed === 'string' } })())
}

// ── the commands ────────────────────────────────────────────────────────────────────────────────────────────
console.log('the commands')
{
  const csv = put('Résumé des ventes (2026).csv', 'Ref,Qty\nA,1\nB,2\n')
  const p = feed(['parse', csv])
  check('parse prints an id made of the file\'s name, writes the file under DSH_HOME, and says what to call next', p.ok === true && /^resume-des-ventes-2026-[0-9a-f]{8}$/.test(p.id) && existsSync(p.file) && /records_import/.test(p.next), p)
  check('the file is a header line then one line per row, private to the user', (() => {
    const lines = readFileSync(p.file, 'utf8').trim().split('\n')
    const head = JSON.parse(lines[0])
    return head.kind === 'kybernos-import' && head.version === 1 && head.id === p.id && head.source === 'Résumé des ventes (2026).csv' && head.rows === 2 && eq(head.columns, ['Ref', 'Qty']) && lines.length === 3 && eq(JSON.parse(lines[2]), { r: 3, c: ['B', '2'] }) && (statSync(p.file).mode & 0o077) === 0 && (statSync(join(home, 'kybernos', 'imports')).mode & 0o077) === 0
  })())
  check('--id names it, and a bad one is refused', feed(['parse', csv, '--id', 'my-sales-1']).id === 'my-sales-1' && feed(['parse', csv, '--id', 'Bad Id']).error === 'invalid')
  check('every refusal is one JSON object and exit code 1', (() => { const r = feed(['parse', join(files, 'nope.csv')]); return r.ok === false && r.error === 'not_found' && r.code === 1 })() && feed([]).error === 'usage' && feed(['frobnicate', csv]).error === 'usage')
  check('an old prepared file is swept, a recent one kept', (() => {
    const dir = join(home, 'kybernos', 'imports')
    const oldFile = join(dir, 'ancient-0000000a.jsonl')
    writeFileSync(oldFile, '{}\n')
    const past = new Date(Date.now() - 20 * 86400000)
    utimesSync(oldFile, past, past)
    const fresh = feed(['parse', csv])
    return fresh.ok && !existsSync(oldFile) && existsSync(p.file)
  })())
  const big = put('big.csv', 'a\n' + Array.from({ length: 50001 }, (_, i) => i).join('\n') + '\n')
  check('more than 50 000 rows is refused with the count', (() => { const r = feed(['parse', big]); return r.error === 'too_many_rows' && /50001/.test(r.detail) })())
}

// ── what a column looks like ────────────────────────────────────────────────────────────────────────────────
console.log('profile')
{
  const col = (name, values) => profileColumn(name, values)
  const likely = (name, values) => col(name, values).likely
  check('numbers, money by its name or its symbol, dates, yes/no, e-mails, phones, urls', likely('Qty', ['1', '2', '30']) === 'number' && likely('Montant', ['1 249,00', '99,00']) === 'money' && likely('X', ['$12.50', '3.00']) === 'money'
    && likely('Day', ['2026-01-05', '2026-02-01']) === 'date' && likely('Paid', ['yes', 'no', 'yes']) === 'checkbox' && likely('Paid', [true, false]) === 'checkbox' && likely('E', ['a@b.co', 'c@d.org']) === 'email'
    && likely('Tel', ['06 12 34 56 78', '+33 6 98 76 54 32']) === 'phone' && likely('Site', ['https://a.example', 'http://b.example/x']) === 'url')
  check('a few repeated values are a choice, with their counts; all-different values are text', (() => { const c = col('Status', ['Paid', 'Paid', 'Paid', 'Open', 'Open', 'Refunded', 'Paid', 'Open']); return c.likely === 'choice' && c.choices[0].value === 'Paid' && c.choices[0].rows === 4 })() && likely('Name', ['Ada', 'Bob', 'Cy', 'Di']) === 'text')
  check('a code with a leading zero is a text, not a number', likely('Zip', ['01234', '02345', '98765']) === 'text')
  check('a column of ids is unique; one with a repeat is not', col('Ref', ['a', 'b']).unique === true && col('Ref', ['a', 'a']).unique === false)
  check('an ambiguous date column says so; one that settles it gives the order', col('D', ['05/01/2026', '06/02/2026']).ambiguous !== undefined && col('D', ['05/01/2026', '13/02/2026']).dateOrder === 'dmy')
  check('an empty column is text with nothing in it', (() => { const c = col('E', [null, null]); return c.likely === 'text' && c.filled === 0 && c.empty === 2 })())
  // the guesses of the script and the rules of the tool are the same rules
  const decimals = [['1,50', '2,25'], ['1.50', '2.25'], ['1,234', '2,500'], ['1,234.50', '9'], ['1.234,50', '9,9'], ['1,234,567']]
  check('the decimal mark the script guesses is the one the tool deduces', decimals.every((cells) => (col('Amount', cells).decimal ?? null) === decimalOf(cells)), decimals.map((c) => [col('Amount', c).decimal ?? null, decimalOf(c)]))
  const orders = [['13/01/2026', '05/01/2026'], ['01/13/2026', '05/01/2026'], ['05/01/2026', '06/02/2026']]
  check('the date order the script guesses is the one the tool deduces', orders.every((cells) => (col('D', cells).dateOrder ?? null) === dateOrderOf(cells)))
  const samples = { number: ['12', '3,5', '1 234,50'], money: ['$12.50', '1 234,50 €'], date: ['2026-01-05', '13/01/2026', '5 Jan 2026', '5 janvier 2026'], checkbox: ['yes', 'Non', 'true', 'oui'], email: ['a@b.co'] }
  check('what the script calls a number or a date, the tool converts', Object.entries(samples).every(([likelyType, cells]) => cells.every((c) => {
    const field = { key: 'x', type: likelyType === 'money' ? 'money' : likelyType, label: 'X', options: [] }
    return coerceCell(field, c, { dateOrder: 'dmy' }).ok === true
  })))
}

// ── the skill and the tool agree ────────────────────────────────────────────────────────────────────────────
console.log('the skill and the Tables tool')
{
  const text = readFileSync(join(SKILL, 'SKILL.md'), 'utf8')
  const used = [...new Set([...text.matchAll(/`((?:db|object|field|relation|view|records)_[a-z]+)`/g)].map((m) => m[1]))]
  check('the skill names only Tables tools that exist, and records_import among them', used.length >= 4 && used.every((n) => NAMES.includes(n)) && used.includes('records_import'), used)
  const service = makeService({ dir: join(root, 'agree') })
  const T = Object.fromEntries(tools(service, { importsDir: join(home, 'kybernos', 'imports') }).map((t) => [t.name, t]))
  const props = Object.keys(T.records_import.parameters.properties)
  const named = [...text.matchAll(/`(dryRun|skipRefused|key|decimal|dateOrder|columns|import)`/g)].map((m) => m[1])
  check('every argument of records_import the skill names is one the tool takes', named.length >= 6 && named.every((a) => props.includes(a)), { named: [...new Set(named)], props })
  check('the call the script prints as « next » is a call the tool accepts', (() => { const p = feed(['parse', put('next.csv', 'a\n1\n')]); return p.next.startsWith('records_import {') && ['object', 'import', 'columns', 'dryRun'].every((k) => p.next.includes(k) && props.includes(k)) })())
  for (const word of ['dryRun', 'unknownChoices', 'refusedRows', 'ignoredColumns', 'preview', 'unchanged']) check('the skill tells the agent to read ' + word, text.includes(word))
}

// ── a sales file, all the way to a dashboard ────────────────────────────────────────────────────────────────
console.log('a sales CSV, all the way')
{
  // a French export, the way a shop's back office writes it: semicolons, decimal commas, dd/mm/yyyy, accents, a thousands space
  const CUSTOMERS = ['Marie Dupont', 'Jean Martin', 'Paul Durand', 'Léa Bernard', 'Hugo Petit', 'Chloé Moreau', 'Lucas Simon', 'Emma Laurent']
  const PRODUCTS = [['Chaise Oslo', 'Mobilier', 89.9], ['Table Lyon', 'Mobilier', 499], ['Lampe Nord', 'Éclairage', 1249], ['Applique Lune', 'Éclairage', 64.5], ['Tapis Atlas', 'Décoration', 230], ['Vase Rivière', 'Décoration', 38.25]]
  const STATUTS = ['Payée', 'Payée', 'Payée', 'En attente', 'Remboursée', 'Annulée']
  const fr = (n) => n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+,)/g, ' ')
  const sales = Array.from({ length: 1200 }, (_, i) => {
    const [product, category, price] = PRODUCTS[(i * 7) % PRODUCTS.length]
    const qty = 1 + (i % 4)
    const d = new Date(Date.UTC(2026, 0, 1 + (i % 150)))
    const day = String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + '/2026'
    const customer = CUSTOMERS[(i * 3) % CUSTOMERS.length]
    return { ref: 'CMD-' + String(1001 + i), day, iso: d.toISOString().slice(0, 10), customer, email: customer.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(' ', '.') + '@example.com', product, category, qty, price, total: Math.round(price * qty * 100) / 100, status: STATUTS[(i * 5) % STATUTS.length], paid: i % 3 !== 0 }
  })
  const csvText = 'Commande;Date;Client;Email;Produit;Catégorie;Quantité;Prix unitaire;Total;Statut;Payé\r\n' + sales.map((s) => [s.ref, s.day, s.customer.includes(' ') ? '"' + s.customer + '"' : s.customer, s.email, s.product, s.category, s.qty, fr(s.price), fr(s.total), s.status, s.paid ? 'oui' : 'non'].join(';')).join('\r\n') + '\r\n'
  const file = put('ventes-2026.csv', Buffer.from(csvText, 'latin1'))

  const prof = feed(['profile', file])
  const by = Object.fromEntries((prof.columns || []).map((c) => [c.name, c]))
  check('profile reads the file (Windows-1252, semicolons) and recognises its columns', prof.ok === true && prof.rows === 1200 && prof.delimiter === ';' && prof.encoding === 'windows-1252'
    && by.Commande.unique === true && by.Date.likely === 'date' && by.Date.dateOrder === 'dmy' && by['Prix unitaire'].decimal === ',' && by.Total.likely === 'money' && by.Total.decimal === ','
    && by.Statut.likely === 'choice' && by['Catégorie'].likely === 'choice' && by.Email.likely === 'email' && by['Payé'].likely === 'checkbox' && by['Quantité'].likely === 'number', prof.columns && prof.columns.map((c) => c.name + ':' + c.likely))

  // the agent designs the table from the profile
  const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  const opts = (c) => c.choices.map((x) => ({ key: slug(x.value), label: x.value }))
  const fields = [
    { key: 'ref', type: 'text', label: 'Order', required: true },
    { key: 'day', type: 'date', label: 'Date' },
    { key: 'customer', type: 'text', label: 'Customer', protection: 'personal' },
    { key: 'email', type: 'email', label: 'Email', protection: 'personal' },
    { key: 'product', type: 'text', label: 'Product' },
    { key: 'category', type: 'choice', label: 'Category', options: opts(by['Catégorie']) },
    { key: 'qty', type: 'number', label: 'Quantity' },
    { key: 'price', type: 'money', label: 'Unit price', currency: 'EUR' },
    { key: 'total', type: 'money', label: 'Total', currency: 'EUR' },
    { key: 'status', type: 'choice', label: 'Status', options: opts(by.Statut) },
    { key: 'paid', type: 'checkbox', label: 'Paid' },
  ]
  const service = makeService({ dir: join(root, 'sales-db') })
  const T = Object.fromEntries(tools(service, { importsDir: join(home, 'kybernos', 'imports') }).map((t) => [t.name, t]))
  const made = await T.db_create.execute({ name: 'Shop' })
  const def = await T.object_define.execute({ key: 'sale', label: 'Sales', title: 'ref', fields })
  check('the table is made from the profile', made.ok === true && def.ok === true, def)

  const parsed = feed(['parse', file])
  const COLUMNS = { Commande: 'ref', Date: 'day', Client: 'customer', Email: 'email', Produit: 'product', 'Catégorie': 'category', 'Quantité': 'qty', 'Prix unitaire': 'price', Total: 'total', Statut: 'status', 'Payé': 'paid' }
  const call = { object: 'sale', import: parsed.id, columns: COLUMNS, decimal: ',', dateOrder: 'dmy', key: 'ref' }
  check('parse prepared 1200 rows', parsed.ok === true && parsed.rows === 1200 && rowsOf(parsed.id).length === 1200)
  const dry = await T.records_import.execute({ ...call, dryRun: true })
  check('the dry run finds every row valid and writes nothing', dry.ok === true && dry.valid === 1200 && dry.refused === 0 && dry.created === 1200 && (await T.records_list.execute({ object: 'sale', limit: 1 })).total === 0, { ...dry, preview: undefined })
  check('its preview shows converted values', dry.preview[0].total === sales[0].total && dry.preview[0].day === sales[0].iso && dry.preview[0].paid === sales[0].paid && typeof dry.preview[0].category === 'string')

  const real = await T.records_import.execute(call)
  check('the import writes 1200 rows', real.ok === true && real.created === 1200 && real.updated === 0 && real.refused === 0, { ...real, preview: undefined })
  const again = await T.records_import.execute(call)
  check('the same file again changes nothing', again.ok === true && again.created === 0 && again.updated === 0 && again.unchanged === 1200, { ...again, preview: undefined })

  // a corrected export: one amount changed, one new order
  const fixed = sales.slice(0, 1200).map((s, i) => (i === 3 ? { ...s, total: 1.5 } : s))
  const extra = { ...sales[0], ref: 'CMD-9999', total: 100, price: 100, qty: 1 }
  const csv2 = csvText.split('\r\n')
  csv2[4] = csv2[4].replace(/;[^;]*;(Payée|En attente|Remboursée|Annulée);(oui|non)$/, ';' + fr(1.5) + ';$1;$2')
  csv2.splice(csv2.length - 1, 0, ['CMD-9999', extra.day, extra.customer.includes(' ') ? '"' + extra.customer + '"' : extra.customer, extra.email, extra.product, extra.category, 1, fr(100), fr(100), 'Payée', 'oui'].join(';'))
  const next = feed(['parse', put('ventes-2026-bis.csv', Buffer.from(csv2.join('\r\n'), 'latin1'))])
  const upd = await T.records_import.execute({ ...call, import: next.id })
  check('a corrected export updates one record and adds the new one', upd.ok === true && upd.created === 1 && upd.updated === 1 && upd.unchanged === 1199, { ...upd, preview: undefined })

  // the dashboard: only existing parts (db.rows source, card, chart, table widgets), nothing of the Dashboards plugin is changed
  const api = makeApi({ service, ports: { today: () => '2026-11-02' } })
  const dbId = api.state().dbs[0].id
  const source = { provider: 'db.rows', params: { db: dbId, object: 'sale' } }
  const spec = {
    id: 'sales', name: 'Sales', desc: 'Revenue of paid orders, and where it comes from.', widgets: [
      { type: 'card', title: 'Revenue, paid orders', source, metric: { agg: 'sum', field: 'total', where: [{ field: 'status_key', op: '=', value: 'payee' }] }, w: 3, h: 2, unit: '€' },
      { type: 'card', title: 'Orders', source, metric: { agg: 'count' }, w: 3, h: 2 },
      { type: 'card', title: 'Refunded', source, metric: { agg: 'sum', field: 'total', where: [{ field: 'status_key', op: '=', value: 'remboursee' }] }, w: 3, h: 2, unit: '€' },
      { type: 'chart', title: 'Revenue by category', kind: 'donut', x: 'category', y: 'total', agg: 'sum', source, w: 5, h: 4 },
      { type: 'chart', title: 'Orders by status', kind: 'bars', x: 'status', agg: 'count', source, w: 4, h: 4 },
      { type: 'table', title: 'Biggest orders', source, columns: [{ field: 'product' }, { field: 'total', format: 'number' }], sort: '-total', limit: 5, w: 6, h: 4 },
    ],
  }
  const valid = M.validateDashboard(spec)
  check('the dashboard is a sound one, with nothing to warn about', valid.ok === true && M.inspectDashboard(valid.dashboard).length === 0, { errors: valid.errors, warnings: valid.dashboard && M.inspectDashboard(valid.dashboard) })
  const NOW = Date.UTC(2026, 10, 2)
  const read = (src) => {
    const route = (path) => { const [p, q] = path.split('?'); const a = Object.fromEntries(new URLSearchParams(q || '')); return p === '/kybernos-db/state' ? api.state() : p === '/kybernos-db/records' ? api.records(a) : null }
    const parts = {}
    for (const req of M.planFor(src, NOW)) parts[req.key] = route(req.path)
    for (const req of M.planNext(src, parts, NOW)) parts[req.key] = route(req.path)
    return M.buildTable(src, parts, NOW)
  }
  const table = read(source)
  const final = sales.map((s, i) => (i === 3 ? { ...s, total: 1.5 } : s)).concat([{ ...extra }])
  const sum = (rows) => Math.round(rows.reduce((a, s) => a + s.total, 0) * 100) / 100
  const w = valid.dashboard.widgets
  check('the table the dashboard reads has every row, without a warning', table.rows.length === 1201 && !table.meta.note, { rows: table.rows.length, note: table.meta.note })
  const rev = M.cardData(table, w[0])
  check('« Revenue, paid orders » equals the sum of the paid orders in the file', Math.abs(rev.value - sum(final.filter((s) => s.status === 'Payée'))) < 0.01, { got: rev.value, want: sum(final.filter((s) => s.status === 'Payée')) })
  check('« Orders » is the number of rows', M.cardData(table, w[1]).value === 1201)
  check('« Refunded » equals the sum of the refunded orders', Math.abs(M.cardData(table, w[2]).value - sum(final.filter((s) => s.status === 'Remboursée'))) < 0.01)
  const donut = M.chartData(table, w[3])
  const byCat = Object.fromEntries(donut.labels.map((l, i) => [l.label, donut.series[0].values[i]]))
  check('« Revenue by category » matches the file, category by category (labels are the accented ones)', ['Mobilier', 'Éclairage', 'Décoration'].every((c) => Math.abs(byCat[c] - sum(final.filter((s) => s.category === c))) < 0.01), byCat)
  const bars = M.chartData(table, w[4])
  check('« Orders by status » counts each status', bars.labels.length === 4 && Math.abs(bars.series[0].values.reduce((a, b) => a + b, 0) - 1201) < 1e-9, { labels: bars.labels })
  const top = M.tableData(table, w[5]) // a table widget lists rows (one per order): a ranking by product is a bars chart with agg sum
  const best = [...final.reduce((m, s) => m.set(s.product, 0), new Map()).keys()]
  check('« Biggest orders » lists real products, biggest first', top.rows.length === 5 && best.includes(top.rows[0][0].v), top.rows.slice(0, 2))
  check('no cell of the table says undefined', table.rows.every((r) => Object.values(r).every((v) => v !== undefined && !String(v).includes('undefined'))))
  const personal = api.state().dbs[0].objects.find((o) => o.key === 'sale').fields.filter((f) => f.protection === 'personal').map((f) => f.key)
  check('the personal columns (name, e-mail) are marked, and masked when the agent reads them back', eq(personal, ['customer', 'email']) && /^••••/.test((await T.records_list.execute({ object: 'sale', limit: 1 })).records[0].values.email))
}

rmSync(root, { recursive: true, force: true })
console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED') + ' (' + total + ' checks)')
process.exit(failed === 0 ? 0 : 1)
