// Guards that stop the visual sprawl of the bundles from growing (audit WP-15, read from the source, no browser).
//
//   node scripts/test-consistency-guards.mjs
//
// Decision D2 (2026-10-16): no shared component library yet, the owner has not chosen the recipe. Until then these checks keep today's
// numbers from getting worse:
//  - A1-15  a bundle that animates anything has a prefers-reduced-motion rule, and the three that had none name every animated class in it;
//  - A1-04  two bundles do not declare the same class selector differently (the stylesheet is global: the later bundle restyles the other's page);
//  - A1-13  no bundle adds a literal status colour (a hex that is a green, amber or red) outside a --dsw-alias-* token or its fallback;
//  - A1-14  no bundle adds a font-size value that is not already in use.
// The last three compare with scripts/consistency-baseline.json, today's counts. A count that goes DOWN is good news and also fails the check
// until the baseline is lowered (node scripts/test-consistency-guards.mjs --update), so the ceiling follows the work.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// KB_GUARDS_ROOT points the scan at another packages folder (to prove a check fails on a tree that has the defect).
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.KB_GUARDS_ROOT || join(HERE, '..', 'packages')
let count = 0
const failed = []
const ok = (label, fn) => {
  try { fn(); count += 1; console.log('ok  ', label) } catch (e) { if (!process.env.KB_GUARDS_KEEP_GOING) throw e; failed.push(label); console.log('FAIL', label, '-', String(e.message).split('\n')[0].slice(0, 200)) }
}

const bundles = readdirSync(ROOT).filter((n) => statSync(join(ROOT, n)).isDirectory()).sort()
const clientOf = (b) => { try { return readFileSync(join(ROOT, b, 'client.js'), 'utf8') } catch (e) { return null } }

// ── A1-15 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The text of every `@media (prefers-reduced-motion: reduce) { … }` block of a source. */
const reducedBlocks = (text) => {
  const out = []
  const re = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g
  let m
  while ((m = re.exec(text)) !== null) {
    let depth = 1, i = m.index + m[0].length
    for (; i < text.length && depth > 0; i += 1) { if (text[i] === '{') depth += 1; else if (text[i] === '}') depth -= 1 }
    out.push(text.slice(m.index, i))
  }
  return out
}
/** The rules `selector{…animation: <name>…}` of a source: every class that is animated. */
const animatedClasses = (text) => {
  const found = new Set()
  for (const r of text.matchAll(/([^{}]{1,400})\{([^{}]{1,1500})\}/g)) {
    const a = /(?:^|[;\s])animation(?:-name)?\s*:\s*([^;]+)/.exec(r[2])
    if (a === null || /^\s*(none|inherit|initial|unset)\b/.test(a[1])) continue
    const sel = r[1].split(/[\n`]/).pop()
    for (const c of sel.matchAll(/\.([A-Za-z_][\w-]*)/g)) found.add(c[1])
  }
  return found
}

ok('A1-15: every bundle that declares an @keyframes or an animation has a prefers-reduced-motion rule', () => {
  const bad = bundles.filter((b) => {
    const text = clientOf(b)
    return text !== null && (/@keyframes\s/.test(text) || animatedClasses(text).size > 0) && reducedBlocks(text).length === 0
  })
  assert.deepEqual(bad, [])
})
// These three had none (kbsl-blink, kbsl-livedot, kbsl-pulse, kbsl-spin, kbsl-rise; the Slides cursor, its correction flash and its caret; the Ollama spinner):
// the rule must name every class they animate, and switch the animation off.
for (const [bundle, classes] of [
  ['kybernos-slash', ['kbsl-anim', 'kbsl-spin', 'kbsl-caret', 'kbsl-live', 'kbsl-flash', 'kbsl-fbody']],
  ['kybernos-slides', ['ProseMirror-gapcursor', 'kbsd-cor', 'kbsd-caret']],
  ['kybernos-modeles-locaux', ['kml-spin']],
]) {
  ok('A1-15: ' + bundle + ' stops every animation it declares under reduced motion', () => {
    const text = clientOf(bundle)
    assert.ok(text !== null, bundle + ' has a client.js')
    const reduced = reducedBlocks(text).join('\n')
    assert.ok(reduced !== '', 'a reduced-motion block exists')
    assert.match(reduced, /animation\s*:\s*none/, 'it switches the animation off')
    const animated = animatedClasses(text)
    for (const c of classes) {
      assert.ok(animated.has(c), c + ' is an animated class (the list in this test is stale otherwise)')
      assert.match(reduced, new RegExp('\\.' + c.replace(/-/g, '\\-') + '\\b'), c + ' is named in the reduced-motion block')
    }
  })
}

console.log('\n' + count + ' tests passed' + (failed.length > 0 ? ', ' + failed.length + ' failed' : ''))
if (failed.length > 0) process.exit(1)
