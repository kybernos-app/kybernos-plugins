#!/usr/bin/env node
/** The composer's microphone popovers close on Escape and on a press outside (T1-8, 2026-10-24).
 *  Before, only their own caret button closed them (the audit's live tour: Escape and a click elsewhere did nothing).
 *  1. `kbvOnDismiss`, cut out of client.js and run on a stand-in document; 2. both popovers use it, with a ref on their wrapper, and the hook keeps its place before the early return.
 *  Usage: node packages/kybernos-plugin/test-voice-dismiss.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')

const at = src.indexOf('const kbvOnDismiss = ')
const end = src.indexOf('const kbvStorage = {', at)
assert.ok(at > 0 && end > at, 'kbvOnDismiss exists')
const kbvOnDismiss = new Function(src.slice(at, end) + '\nreturn kbvOnDismiss')()

// a stand-in document: listeners by type, capture ignored (the test fires them directly)
const makeDoc = () => {
  const l = new Map()
  return {
    addEventListener (type, fn) { l.set(type, (l.get(type) || []).concat([fn])) },
    removeEventListener (type, fn) { l.set(type, (l.get(type) || []).filter((x) => x !== fn)) },
    fire (type, ev) { for (const fn of (l.get(type) || []).slice()) fn(ev) },
    count () { return Array.from(l.values()).reduce((n, a) => n + a.length, 0) },
  }
}
const inside = { id: 'caret' }
const outside = { id: 'page' }
const wrapper = { contains: (n) => n === inside }

{
  const doc = makeDoc()
  let closed = 0
  const off = kbvOnDismiss(doc, () => wrapper, () => { closed += 1 })
  doc.fire('keydown', { key: 'Enter' }); doc.fire('keydown', { key: 'a' })
  assert.equal(closed, 0, 'another key closes nothing')
  doc.fire('keydown', { key: 'Escape' })
  assert.equal(closed, 1, 'Escape closes')
  doc.fire('pointerdown', { target: inside })
  assert.equal(closed, 1, 'a press on the wrapper (the caret that toggles it) is not "outside"')
  doc.fire('pointerdown', { target: outside })
  assert.equal(closed, 2, 'a press elsewhere closes')
  doc.fire('pointerdown', { target: null }); doc.fire('pointerdown', {})
  assert.equal(closed, 2, 'a press with no target is ignored')
  off()
  assert.equal(doc.count(), 0, 'the disposer removes both listeners')
  doc.fire('keydown', { key: 'Escape' }); doc.fire('pointerdown', { target: outside })
  assert.equal(closed, 2, 'and nothing closes any more')
  ok('Escape and a press outside close; a press inside does not; the disposer leaves no listener')
}
{
  const doc = makeDoc()
  let closed = 0
  kbvOnDismiss(doc, () => null, () => { closed += 1 })
  doc.fire('pointerdown', { target: outside })
  assert.equal(closed, 0, 'no wrapper yet (not mounted): a press is not "outside" of nothing')
  ok('before the wrapper is mounted a press closes nothing')
}

// both popovers use it
const chip = src.slice(src.indexOf('const KbVoiceSourceChip = () => {'), src.indexOf('const KbVoiceBar = (props) => {'))
const bar = src.slice(src.indexOf('const KbVoiceBar = (props) => {'), src.indexOf('const KbVoiceBar = (props) => {') + 60000)
for (const [name, body] of [['source chip', chip], ['voice bar', bar]]) {
  assert.match(body, /const wrapRef = React\.useRef\(null\)/, name + ': a ref for the wrapper')
  assert.match(body, /React\.useEffect\(\(\) => \(open === true \? kbvOnDismiss\(document, \(\) => wrapRef\.current, \(\) => setOpen\(false\)\) : undefined\), \[open\]\)/, name + ': listeners only while open')
}
assert.match(chip, /className: 'kbv-chip', 'data-kbr': 'voice-source-chip', ref: wrapRef/, 'the chip puts the ref on its root')
assert.match(bar, /className: 'kbv-wrap', ref: wrapRef/, 'the bar puts the ref on its wrapper')
assert.ok(chip.indexOf('kbvOnDismiss(document') < chip.indexOf('if (kbvSrc.known !== true'), 'the hook of the chip comes before its early return (hooks keep their order)')
ok('both microphone popovers use it, the wrapper carries the ref, and the chip\'s hook stays before its early return')

console.log('\n' + pass + ' checks passed')
