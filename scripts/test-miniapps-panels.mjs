#!/usr/bin/env node
// The panels the mini-apps plugin puts its "App" button on are panels of the bundle it names, and of no other.
//
// packages/kybernos-miniapps/client.js carries a list (PANNEAUX): for each exportable panel a selector for its root and one for the head the
// button goes into. A selector is only a CSS class, and CSS classes are shared by every bundle of the page. Measured on the real GUI before this
// test existed: the entry of Slides said `.kbs-root`, which is the root of the SKILLS page (Slides had renamed its own root to `.kbsd-root`, and
// kept `.kbs-head`, a class the Skills, cloud and mini-apps bundles also use). So the button sat on Skills, in every one of its segments, and the
// Slides panel got none. The same family of bug had already hit the Models page (`.kbm-root` is Models' page AND the Modeleur's root).
//
// The check reads every bundle's client as text and compares, for each entry:
//   · the root selector matches an element the OWNER bundle renders (else it points at nothing);
//   · it matches NO element another bundle renders (else the button lands on someone else's page);
//   · the head class is rendered by the owner, and by no other bundle (else it would also style, or be found in, their panels).
// An element "matches" a selector `.a.b:not(.c)` when its class list has a and b and not c.
//
//   node scripts/test-miniapps-panels.mjs
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = join(REPO, 'packages')
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

// Which bundle each panel belongs to. A new panel in the list must be added here: the test says so if it is not.
const OWNER = { briques: 'kybernos-bricks', modeleur: 'kybernos-modeleur', slides: 'kybernos-slides' }

// ── what a selector means ──
/** `{ has: [...classes], not: [...classes] }` of a selector made of classes and `:not(.x)` only; null when it is anything else. */
export const parseSelector = (sel) => {
  const not = [...sel.matchAll(/:not\(\.([A-Za-z0-9_-]+)\)/g)].map((m) => m[1])
  const rest = sel.replace(/:not\(\.[A-Za-z0-9_-]+\)/g, '')
  if (!/^(\.[A-Za-z0-9_-]+)+$/.test(rest)) return null
  return { has: [...rest.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((m) => m[1]), not }
}
export const matches = (sel, classList) => sel.has.every((c) => classList.includes(c)) && sel.not.every((c) => !classList.includes(c))

// ── what a bundle renders ──
/** Every class list a client writes as a literal: `className: '…'`, `className: "…"`, a template literal, or `class="…"` in an HTML string. */
export const classLists = (src) => {
  const out = []
  for (const m of src.matchAll(/className:\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g)) out.push((m[1] ?? m[2] ?? m[3]).split(/\s+/).filter(Boolean))
  for (const m of src.matchAll(/\bclass="([^"]*)"/g)) out.push(m[1].split(/\s+/).filter(Boolean))
  return out
}

const bundles = {}
for (const dir of readdirSync(PACKAGES)) {
  try { bundles[dir] = classLists(readFileSync(join(PACKAGES, dir, 'client.js'), 'utf8')) } catch (e) { /* a bundle without a client */ }
}
const renderedBy = (sel) => Object.entries(bundles).filter(([dir, lists]) => dir !== 'kybernos-miniapps' && lists.some((l) => matches(sel, l))).map(([dir]) => dir)

// ── the list, as written in the source ──
const source = readFileSync(join(PACKAGES, 'kybernos-miniapps', 'client.js'), 'utf8')
const entries = [...source.matchAll(/\{\s*racine:\s*'([^']+)',\s*id:\s*'([^']+)',\s*tete:\s*'([^']+)'/g)].map((m) => ({ racine: m[1], id: m[2], tete: m[3] }))

console.log('the selector parser and matcher')
{
  const s = parseSelector('.kbm-root:not(.kbmp)')
  check('a class with a :not is understood', s !== null && s.has.join() === 'kbm-root' && s.not.join() === 'kbmp')
  check('it matches the plain root and not the page that adds the excluded class', matches(s, ['kbm-root']) && !matches(s, ['kbm-root', 'kbmp']) && !matches(s, ['other']))
  check('a selector that is not only classes is refused (it could not be checked)', parseSelector('div > .a') === null && parseSelector('[class*=x]') === null)
  const lists = classLists(`h('div', { className: 'kbs-root a' }) h("i", { className: "x y" }) h('p', { className: \`z\` + n }) '<div class="k1 k2">'`)
  check('the class lists written as literals are all read', JSON.stringify(lists) === JSON.stringify([['kbs-root', 'a'], ['x', 'y'], ['z'], ['k1', 'k2']]), lists)
}

console.log('the panels of the mini-apps plugin')
check('the list was read: three panels', entries.length === 3 && entries.map((e) => e.id).sort().join() === 'briques,modeleur,slides', entries)
for (const e of entries) {
  const owner = OWNER[e.id]
  check(e.id + ': the panel has a known owner (add it to OWNER in this test)', owner !== undefined)
  const root = parseSelector(e.racine)
  const head = parseSelector(e.tete)
  check(e.id + ': its selectors are plain classes, so they can be checked', root !== null && head !== null, e)
  if (owner === undefined || root === null || head === null) continue
  const rootOwners = renderedBy(root)
  check(e.id + ': the root ' + e.racine + ' is rendered by ' + owner, rootOwners.includes(owner), rootOwners)
  check(e.id + ': …and by no other bundle (else the button lands on its page)', rootOwners.every((d) => d === owner), rootOwners)
  const headOwners = renderedBy(head)
  check(e.id + ': the head ' + e.tete + ' is rendered by ' + owner, headOwners.includes(owner), headOwners)
  check(e.id + ': …and by no other bundle', headOwners.every((d) => d === owner), headOwners)
}

console.log('the pages that must never get the button')
{
  const skills = parseSelector('.kbs-root')
  const models = parseSelector('.kbm-root.kbmp')
  const anyEntryMatches = (cls) => entries.some((e) => matches(parseSelector(e.racine), cls))
  check('the Skills page root matches no panel', !anyEntryMatches(['kbs-root']) && skills !== null)
  check('the AI Provider & Models page root matches no panel', !anyEntryMatches(['kbm-root', 'kbmp']) && models !== null)
  check('the core\'s own Models page (a bare .kbm-root) matches no panel either', !anyEntryMatches(['kbm-root']))
  check('only the Modeleur\'s root (kbm-root kbmo) matches the Modeleur entry', anyEntryMatches(['kbm-root', 'kbmo']))
  check('Slides\' old class names are gone from its bundle (it keeps one prefix, kbsd-)', !/(?<![\w-])kbs-/.test(readFileSync(join(PACKAGES, 'kybernos-slides', 'client.js'), 'utf8').replace(/--kbs-/g, '')))
}

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
