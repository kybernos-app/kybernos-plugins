#!/usr/bin/env node
/** A Data creation (json, yaml, csv…) is shown as DATA — a table, a list or named fields — never as the code of the file.
 *
 *  The pure half of that (the loose JSON reader, what a file holds, the one-line summary) is read out of client.js between its
 *  `<kb-data-view:begin>` / `<kb-data-view:end>` markers and run here, with no DOM. The preview the host sends is cut at 1 200
 *  characters, so most of what matters is the reading of JSON that stops in the middle of a value.
 *
 *  Usage: node packages/kybernos-plugin/test-data-view.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const from = src.indexOf('// <kb-data-view:begin>')
const to = src.indexOf('// <kb-data-view:end>')
assert.ok(from > 0 && to > from, 'the markers are in client.js')
// The two strings the pure half asks the dictionary for.
const WORDS = { 'deliv.data.item1': '1 item', 'deliv.data.items': '{n} items', 'deliv.data.field1': '1 field', 'deliv.data.fields': '{n} fields', 'deliv.data.row1': '1 row', 'deliv.data.rows': '{n} rows', 'deliv.data.rowsmore': 'more than {n} rows' }
const kbt = (k) => (WORDS[k] !== undefined ? WORDS[k] : k)
const T = new Function('kbt', src.slice(from, to) + '\nreturn { kbJsonLoose, kbDataInfo, kbDataSummary, kbDataCell }')(kbt)

console.log('kybernos-plugin — Data creations are shown as data')

// 1. JSON: the whole file
{
  const rows = JSON.stringify([{ id: 1, name: 'A', tags: ['x', 'y'], meta: { k: 1 } }, { id: 2, name: 'B', tags: [], meta: {} }])
  const i = T.kbDataInfo(rows, 'orders.json', 50)
  assert.equal(i.shape, 'table')
  assert.deepEqual(i.cols, ['id', 'name', 'tags', 'meta'])
  assert.deepEqual(i.rows, [['1', 'A', '2 items', '1 field'], ['2', 'B', '0 items', '0 fields']], 'a nested value says what it holds, never its braces')
  assert.equal(i.count, 2)
  assert.equal(T.kbDataSummary(i), '2 rows · id, name, tags, meta')
  const rec = T.kbDataInfo('{"name":"x","version":"1.0.0","scripts":{"a":"b"}}', 'package.json')
  assert.deepEqual([rec.shape, rec.count], ['record', 3])
  assert.deepEqual(rec.entries, [['name', 'x'], ['version', '1.0.0'], ['scripts', '1 field']])
  assert.equal(T.kbDataSummary(rec), '3 fields · name, version, scripts')
  const list = T.kbDataInfo('["a","b","c"]', 'x.json')
  assert.deepEqual([list.shape, list.count], ['list', 3])
  ok('a JSON array of objects is a table, an object is its fields, an array of values is a list (nested values are summarised)')
}

// 2. JSON cut by the 1 200-character preview: whole elements are kept, the cut one is dropped
{
  const full = '[{"id":1,"label":"Premier, avec } et \\" guillemets"},{"id":2,"label":"Deuxième"},{"id":3,"label":"Troisième et longue ligne qui est coupée ici'
  const j = T.kbJsonLoose(full)
  assert.equal(j.partial, true)
  assert.deepEqual(j.value.map((r) => r.id), [1, 2], 'the third object was cut: it is not invented')
  assert.equal(j.value[0].label, 'Premier, avec } et " guillemets', 'braces and escaped quotes inside a string do not end an element')
  const i = T.kbDataInfo(full, 'rows.json', 3)
  assert.deepEqual([i.shape, i.partial, i.rows.length], ['table', true, 2])
  assert.equal(T.kbDataSummary(i), 'more than 2 rows · id, label', 'a count read from a cut preview is not stated as the number of rows')

  const obj = '{"commentaire":"Paquets du dépôt","packages":[{"dir":"a"},{"dir":"b"}],"version":1,"description":"un texte qui est coup'
  const o = T.kbJsonLoose(obj)
  assert.equal(o.partial, true)
  assert.equal(o.value.commentaire, 'Paquets du dépôt')
  assert.deepEqual(o.value.packages, [{ dir: 'a' }, { dir: 'b' }])
  assert.equal(o.value.version, 1)
  assert.ok('description' in o.value && o.value.description === undefined, 'the member that was cut is known by its key, with no value')
  const oi = T.kbDataInfo(obj, 'x.json', 4)
  assert.equal(oi.shape, 'record')
  assert.deepEqual(oi.entries.map((e) => e[0]), ['commentaire', 'packages', 'version', 'description'])
  assert.equal(oi.entries[3][1], '…')
  // a number that touches the end of the text may have been cut: it is not read
  const cutNumber = T.kbJsonLoose('{"a":1,"b":123').value
  assert.deepEqual([cutNumber.a, 'b' in cutNumber, cutNumber.b], [1, true, undefined])
  assert.equal(T.kbJsonLoose('not json at all'), null)
  assert.equal(T.kbJsonLoose('   '), null)
  ok('a cut preview keeps what is whole (strings with braces and quotes included) and invents nothing')
}

// 3. delimited text
{
  const csv = 'sku,label,qty,price\nA-1,"Lampe, bureau",12,34.90\nB-7,"Cadre ""Nord""",7,58.50\n'
  const i = T.kbDataInfo(csv, 'stock.csv', 10)
  assert.equal(i.shape, 'table')
  assert.deepEqual(i.cols, ['sku', 'label', 'qty', 'price'])
  assert.deepEqual(i.rows[0], ['A-1', 'Lampe, bureau', '12', '34.90'], 'a quoted cell may hold the delimiter')
  assert.equal(i.rows[1][1], 'Cadre "Nord"', 'a doubled quote is one quote')
  assert.equal(i.count, 2)
  assert.equal(T.kbDataInfo('a;b\n1;2\n', 'x.csv').cols.join(), 'a,b', 'semicolons are detected')
  assert.equal(T.kbDataInfo('a\tb\n1\t2\n', 'x.tsv').cols.join(), 'a,b')
  ok('CSV and TSV become a table: quoted cells, doubled quotes and the semicolon variant')
}

// 4. yaml-like text and the rest
{
  const y = '---\n# a comment\nid: inbound-closer\nspecVersion: 1\ntopology: crew\nmission: "Answer every lead"\nroles:\n  - id: a\n'
  const i = T.kbDataInfo(y, 'kyber.yml', 10)
  assert.equal(i.shape, 'record')
  assert.deepEqual(i.flat.slice(0, 4), [['id', 'inbound-closer'], ['specVersion', '1'], ['topology', 'crew'], ['mission', 'Answer every lead']])
  assert.equal(T.kbDataInfo('0123abcd  file.tar.gz\n', 'file.sha256').shape, 'text', 'one line is not a record')
  assert.equal(T.kbDataInfo('', 'x.json').shape, 'empty')
  assert.equal(T.kbDataInfo('   \n  ', 'x.yaml').shape, 'empty')
  const t = T.kbDataInfo('# generated\n# do not edit\nhello\nworld\n', 'x.lock')
  assert.equal(t.shape, 'text')
  assert.equal(T.kbDataSummary(t), '# generated', 'the one-line summary of plain text is its first line')
  ok('yaml-like text with two or more named fields is a record; one line or comments only stay plain text; empty is empty')
}

// 5. the summary a list row shows is never a bare brace
{
  for (const [text, name] of [['{"a":1,"b":2}', 'a.json'], ['[{"a":1}]', 'b.json'], ['[1,2]', 'c.json'], ['id: x\nname: y\n', 'd.yml'], ['{"a":1,"b":', 'e.json']]) {
    const s = T.kbDataSummary(T.kbDataInfo(text, name, 3))
    assert.ok(s.length > 0 && /^[{[\]}]/.test(s) === false, name + ' → ' + JSON.stringify(s))
  }
  ok('the line under a Data creation in a list says what is in it, not « { » or « [ »')
}

console.log('\n' + pass + ' verifications OK')
