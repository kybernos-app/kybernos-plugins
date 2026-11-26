// The rules of the text editor (editor-src/text-core.js), with no page: what the file is, that the byte-order mark and the line ends come back, how a CSV file is read and
// written, when it is not a table, and what is said of a JSON text.
//
//   node packages/kybernos-office/test-text-core.mjs
import assert from 'node:assert/strict'
import { TABLE_MAX_CELLS, countText, decode, detectDelimiter, encode, formatJson, jsonStatus, kindOf, parseCsv, serializeCsv, toGrid } from './editor-src/text-core.js'

let pass = 0
const ok = (label, fn) => { fn(); pass += 1; console.log('  ✓ ' + label) }
const bytes = (s) => new TextEncoder().encode(s)

ok('the kind of a file is its name: json, csv, tsv, or plain text for the rest', () => {
  assert.deepEqual(['a.json', 'A.JSON', 'x.csv', 'x.TSV', 'a.txt', 'a.yaml', 'noext', '', null, undefined, 'a.json.txt'].map(kindOf), ['json', 'json', 'csv', 'tsv', 'text', 'text', 'text', 'text', 'text', 'text', 'text'])
})

ok('the byte-order mark and the line ends come back as they were; the frame works in LF', () => {
  for (const raw of ['plain\n', '﻿with bom\r\nsecond\r\n', 'no final newline', '', 'a\n\nb\n', '﻿', 'ünï — ✓ 日本\n']) {
    const seen = decode(bytes(raw))
    assert.ok(!seen.text.includes('\r'), 'LF inside')
    assert.deepEqual(Array.from(encode(seen, seen.text)), Array.from(bytes(raw)), JSON.stringify(raw))
  }
  const crlf = decode(bytes('a\r\nb\r\n'))
  assert.deepEqual([crlf.bom, crlf.eol, crlf.text], ['', '\r\n', 'a\nb\n'])
  assert.deepEqual([decode(bytes('﻿a\n')).bom, decode(bytes('a\n')).eol], ['﻿', '\n'])
})

ok('bytes that are not UTF-8 are not text', () => {
  assert.throws(() => decode(new Uint8Array([0x63, 0x61, 0x66, 0xe9])))
})

ok('the separator of a delimited file: tabs for .tsv, else the one the first lines use most outside quotes, the comma by default', () => {
  assert.equal(detectDelimiter('a,b,c\n1,2,3\n', 'x.csv'), ',')
  assert.equal(detectDelimiter('a;b;c\n1;2;3\n', 'x.csv'), ';')
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3\n', 'x.csv'), '\t')
  assert.equal(detectDelimiter('a|b|c\n', 'x.csv'), '|')
  assert.equal(detectDelimiter('a b c\n', 'x.csv'), ',', 'no separator: the comma')
  assert.equal(detectDelimiter('a,b\n', 'x.tsv'), '\t', 'a .tsv is tabs whatever it holds')
  assert.equal(detectDelimiter('"x, y, z";b;c\n1;2;3\n', 'x.csv'), ';', 'commas inside quotes do not count')
  assert.equal(detectDelimiter('', 'x.csv'), ',')
})

ok('a CSV text is read with quotes, doubled quotes, separators and line ends inside fields', () => {
  assert.deepEqual(parseCsv('a,b\n1,2\n', ',').rows, [['a', 'b'], ['1', '2']])
  assert.deepEqual(parseCsv('"Smith, J",3\n', ',').rows, [['Smith, J', '3']])
  assert.deepEqual(parseCsv('"say ""hi""",x\n', ',').rows, [['say "hi"', 'x']])
  assert.deepEqual(parseCsv('"two\nlines",x\n', ',').rows, [['two\nlines', 'x']])
  assert.deepEqual(parseCsv('a,,c,\n', ',').rows, [['a', '', 'c', '']], 'empty fields, also the last one')
  assert.deepEqual(parseCsv('a,b', ',').rows, [['a', 'b']], 'no final newline')
  assert.deepEqual(parseCsv('a\n\nb\n', ',').rows, [['a'], [''], ['b']], 'a blank line is a row of one empty field')
  assert.deepEqual(parseCsv('', ',').rows, [])
  assert.deepEqual(parseCsv('5" pipe,x\n', ',').rows, [['5" pipe', 'x']], 'a quote in the middle of a field is a character')
  assert.equal(parseCsv('"never closed,x\n', ',').open, true)
  assert.equal(parseCsv('"closed",x\n', ',').open, false)
})

ok('a CSV file read and written again is the same file when it was written the usual way (quotes only where needed)', () => {
  for (const [text, d] of [['a,b\n1,2\n', ','], ['"Smith, J",3\n', ','], ['"say ""hi""",x\n', ','], ['"two\nlines",x\n', ','], ['a;b\n1;"x;y"\n', ';'], ['a\tb\n1\t2\n', '\t'], ['a,b', ','], ['a,,c,\n', ','], ['a\n\nb\n', ','], ['', ',']]) {
    const { rows } = parseCsv(text, d)
    assert.equal(serializeCsv(rows, d, text.endsWith('\n')), text, JSON.stringify(text))
  }
})

ok('a field is quoted only when it holds the separator, a quote or a line end', () => {
  assert.equal(serializeCsv([['a b', 'c,d', 'e"f', 'g\nh', ' x ', '']], ',', true), 'a b,"c,d","e""f","g\nh", x ,\n')
  assert.equal(serializeCsv([['a;b', 'c,d']], ';', false), '"a;b";c,d')
  assert.equal(serializeCsv([], ',', true), '', 'no row, no newline')
})

ok('the table: short rows are padded, and what is not a table is said (an unclosed quote, a cell with a line end, too many cells)', () => {
  const g = toGrid('a,b,c\n1,2\n', ',')
  assert.deepEqual([g.ok, g.width, g.grid], [true, 3, [['a', 'b', 'c'], ['1', '2', '']]])
  assert.deepEqual(toGrid('', ','), { ok: true, grid: [['']], width: 1 })
  assert.deepEqual(toGrid('"open,x\n', ','), { ok: false, why: 'open' })
  assert.deepEqual(toGrid('"two\nlines",x\n', ','), { ok: false, why: 'multiline' })
  const side = Math.ceil(Math.sqrt(TABLE_MAX_CELLS)) + 1
  const big = Array.from({ length: side }, () => new Array(side).fill('x').join(',')).join('\n') + '\n'
  assert.deepEqual(toGrid(big, ','), { ok: false, why: 'big' })
})

ok('a JSON text: valid, empty, or not valid with the line and column of the first mistake', () => {
  assert.deepEqual(jsonStatus('{"a": [1, 2, {"b": null}]}\n'), { ok: true })
  assert.deepEqual(jsonStatus('[]'), { ok: true })
  assert.deepEqual(jsonStatus(' \n'), { ok: false, empty: true })
  const bad = jsonStatus('{\n  "a": 1\n  "b": 2\n}\n')
  assert.equal(bad.ok, false)
  assert.equal(bad.line, 3, 'the mistake is on the third line: ' + JSON.stringify(bad))
  assert.ok(Number.isInteger(bad.col) && bad.col >= 1, 'a column: ' + JSON.stringify(bad))
  assert.equal(typeof bad.message, 'string')
  assert.equal(jsonStatus('{"a": }').ok, false)
  assert.equal(jsonStatus('{"a": 1,}').ok, false, 'a trailing comma')
  assert.equal(jsonStatus("{'a': 1}").ok, false, 'single quotes')
})

ok('formatting writes valid JSON with two-space indents, keeps the final newline, and leaves what is not JSON alone', () => {
  assert.equal(formatJson('{"a":[1,2],"b":{"c":null}}'), '{\n  "a": [\n    1,\n    2\n  ],\n  "b": {\n    "c": null\n  }\n}')
  assert.equal(formatJson('[1,2]\n'), '[\n  1,\n  2\n]\n')
  assert.equal(formatJson('{"a": }'), null)
  assert.equal(formatJson(''), null)
  const once = formatJson('{"a":1,"b":[true,false]}')
  assert.equal(formatJson(once), once, 'formatting twice changes nothing')
})

ok('the numbers of a text: a final newline does not start a line, characters are counted as people count them', () => {
  assert.deepEqual(countText(''), { lines: 0, chars: 0 })
  assert.deepEqual(countText('a'), { lines: 1, chars: 1 })
  assert.deepEqual(countText('a\n'), { lines: 1, chars: 2 })
  assert.deepEqual(countText('a\nb\n'), { lines: 2, chars: 4 })
  assert.deepEqual(countText('\n\n'), { lines: 2, chars: 2 })
  assert.deepEqual(countText('日本😀'), { lines: 1, chars: 3 })
})

console.log('\n' + pass + ' passed')
