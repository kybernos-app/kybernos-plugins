#!/usr/bin/env node
// PROBE — Ground 1 of docs/tests/revue-adversariale.md (F-41/F-42): the import path may never touch a record it did not create.
//
//   node docs/tests/probes/probe-import-invariant.mjs
//
// Why it lives here: `scripts/run-all-tests.mjs` collects `scripts/test-*.mjs` and `packages/*/test*.mjs` only, so a probe that
// is red by design does not grow a NEW red in the merge gate. The fix stage moves these assertions into
// `packages/kybernos-theme/test-preset-store.mjs` (the promotion table is in docs/tests/sondes-fix-block.md).
//
// What it asserts (A1-theme-seam-strategy.md:261-267, A1-1 ratified as written):
//   (a) an import whose id is the id of a record the person made (`source:'me'`) leaves that record BYTE FOR BYTE, and answers
//       an id of its own record (or refuses with a reason) — never the person's id;
//   (b) a suffixed-id collision never rewrites a record the import did not name: every record whose id the import did not
//       answer keeps its exact serialisation, catalogue link (`gid`) and version (`v`) included;
//   (c) the import answers its own name, never the name of the record it collided with.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyPreset, createPresetStore, sanitizePreset } from '../../../packages/kybernos-theme/preset-store.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const section = (title) => console.log('\n' + title)
const tmp = () => mkdtempSync(join(tmpdir(), 'kb-probe-import-'))

/** The library as the disk holds it: `byId` is the exact serialisation of each record, so « untouched » means byte for byte. */
const snapshot = (store) => {
  const r = store.read()
  const list = r.ok === true && r.library !== null ? r.library.presets : []
  const byId = new Map()
  for (const p of list) byId.set(p.id, JSON.stringify(p))
  return { byId, count: list.length }
}
const record = (over) => sanitizePreset({
  id: 'u-abc', name: 'Bureau clair', source: 'gallery', at: 1000,
  settings: { mode: 'light', acc: '#0EA5E9' }, ...over,
}).preset

section('(a) an import may never touch a record the person made — whatever id it carries')
{
  // A1-1's literal rule: « the `me` record is never touched (byte for byte) ». "ANY id" is the point: the id a document
  // mints from the name (the slug) AND the ids it can name outright, over several shapes of id.
  const cases = []
  for (const id of ['soigne', 'u-mine', 'x-1', 'a']) {
    cases.push({ label: 'the slug of the name (' + id + ')', id, input: { name: 'Soigne', settings: { acc: '#abcdef' } } })
    cases.push({ label: 'an explicit id equal to it (' + id + ')', id, input: { id, name: 'Soigne', settings: { acc: '#abcdef' } } })
    cases.push({ label: 'an explicit id and another name (' + id + ')', id, input: { id, name: 'Autre', settings: { acc: '#abcdef' } } })
  }
  let untouched = 0
  let isolated = 0
  const evidence = []
  for (const c of cases) {
    const dir = tmp()
    const store = createPresetStore({ dir, now: () => 5000 })
    store.write({ presets: [record({ id: c.id, name: 'Soigne', source: 'me', settings: { acc: '#000001' } })], updatedAt: 100 })
    const before = snapshot(store)
    const answer = applyPreset(store, c.input)
    const after = snapshot(store)
    const byteForByte = after.byId.get(c.id) === before.byId.get(c.id)
    if (byteForByte) untouched += 1
    const own = answer.ok !== true || (answer.id !== c.id && after.count === before.count + 1)
    if (own) isolated += 1
    if (byteForByte === false || own === false) evidence.push({ case: c.label, before: before.byId.get(c.id), after: after.byId.get(c.id), answer })
    rmSync(dir, { recursive: true, force: true })
  }
  const brief = evidence.slice(0, 2)
  check('the person\'s record is untouched, byte for byte, in every case (' + untouched + '/' + cases.length + ')', untouched === cases.length,
    { failing: evidence.length, examples: brief })
  check('the import lands on a record of its own (or refuses) in every case (' + isolated + '/' + cases.length + ')', isolated === cases.length,
    { failing: evidence.length, examples: brief })
  const scrambled = evidence.filter((e) => e.after === undefined || JSON.parse(e.after).source !== 'me' || JSON.parse(e.after).settings.acc !== '#000001')
  check('...and never rewrites its source or its settings', scrambled.length === 0, { failing: scrambled.length, examples: scrambled.slice(0, 2) })
}
section('(b) a suffixed-id collision must never rewrite a record the import did not name')
{
  const dir = tmp()
  const store = createPresetStore({ dir, now: () => 5000 })
  // The reviewer's own probe (F-42): 'u-mine' holds the name, 'soigne-2' is an UNRELATED kept record — the free suffix
  // candidate of an import of « Soigne ».
  store.write({
    presets: [
      record({ id: 'u-mine', name: 'Soigne', source: 'me', settings: { acc: '#000001' } }),
      record({ id: 'soigne-2', name: 'Cabinet', source: 'gallery', gid: 'cab', v: 3, settings: { acc: '#123456' } }),
    ],
    updatedAt: 100,
  })
  const before = snapshot(store)
  const answer = applyPreset(store, { name: 'Soigne', settings: { acc: '#abcdef' } })
  const after = snapshot(store)
  // A record is the import's own only when it carries the import's name, or a suffixed form of it (the idempotent
  // re-import). Any other kept record — a different name — is a stranger, whatever id the import walked into.
  const mine = /^soigne( \(\d+\))?$/i
  const strangers = [...before.byId.keys()].filter((id) => mine.test(String(JSON.parse(before.byId.get(id)).name)) === false)
  const rewritten = strangers.filter((id) => after.byId.get(id) !== before.byId.get(id))
  check('no record of another name is rewritten (a collision never touches a stranger)',
    rewritten.length === 0 && strangers.length === 1,
    { rewritten, strangers, answer, before: [...before.byId], after: [...after.byId] })
  const cabinet = after.byId.has('soigne-2') ? JSON.parse(after.byId.get('soigne-2')) : null
  check('the unrelated record keeps its name, its catalogue link (gid) and its version (v)',
    cabinet !== null && cabinet.name === 'Cabinet' && cabinet.gid === 'cab' && cabinet.v === 3, cabinet)
  check('the import answers its own name, never the name of the record it collided with',
    answer.ok !== true || answer.preset.name !== 'Cabinet', answer)
  check('no two records share an id and none was dropped',
    after.count === before.count + (answer.ok === true && before.byId.has(answer.id) === false ? 1 : 0) &&
    new Set([...after.byId.keys()]).size === after.count, { before: before.count, after: after.count, answer })
  rmSync(dir, { recursive: true, force: true })
}

console.log('\n' + (fail === 0 ? 'OK' : 'FAILED') + ' — ground 1, import invariant (' + (pass + fail) + ' checks)')
process.exit(fail === 0 ? 0 : 1)
