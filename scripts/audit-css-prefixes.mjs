// Which CSS class selectors are defined by more than one bundle (audit A1-04). Read-only.
//
//   node scripts/audit-css-prefixes.mjs            # the collisions, then the identical copies
//   node scripts/audit-css-prefixes.mjs --json     # the same, as JSON
//
// DSH's stylesheet is global: a class a second bundle declares differently restyles the first bundle's page, and which one wins
// depends on which bundle injected its <style> last. A class prefix therefore belongs to ONE bundle. The scan reads the style
// strings of every packages/<bundle>/client.js (and its .css files) as text, like scripts/test-display-rules.mjs: no browser.
//
// What is compared is the whole selector as written (`.kbup-link:hover`, `.kbsu-tabs button[aria-selected="true"]`; an @media around a rule is
// not part of it), with its declarations normalised. Two bundles that declare the same selector:
//   - with different declarations  = a COLLISION (the page of one bundle is drawn with the other one's rules);
//   - with the same declarations   = an identical copy (harmless today; the primitives DSH ships are inlined in three bundles).
// `shared()`, `prefixUsers()` and `keyframesByBundle()` are also what scripts/test-consistency-guards.mjs asserts on.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages')

const RULE = /([^{}]{1,1500})\{([^{}]{1,2400})\}/g

/** Splits a selector list on its top-level commas (a comma inside :is(...) or [...] stays). */
const splitList = (list) => {
  const out = []
  let depth = 0, from = 0, quote = ''
  for (let i = 0; i < list.length; i += 1) {
    const c = list[i]
    if (quote !== '') { if (c === quote) quote = ''; continue }
    if (c === '"' || c === "'") quote = c
    else if (c === '(' || c === '[') depth += 1
    else if (c === ')' || c === ']') depth -= 1
    else if (c === ',' && depth === 0) { out.push(list.slice(from, i)); from = i + 1 }
  }
  out.push(list.slice(from))
  return out
}

/** `a:b;c:d` as a sorted, whitespace-free list: two rules that say the same thing in another order are the same rule. */
const normaliseBody = (body) => body.split(';').map((d) => d.replace(/\s+/g, ' ').trim()).filter((d) => d !== '').sort().join(';')

/** A CSS declaration block, not a JS object literal: every `;`-separated piece is `property: value` with a lower-case dashed property. */
const looksLikeCss = (body) => {
  const pieces = body.split(';').map((d) => d.trim()).filter((d) => d !== '')
  return pieces.length > 0 && pieces.every((d) => /^(--)?[a-z][a-z-]*\s*:/.test(d))
}

const CLASS = /(?:^|[^\w-])\.(-?[A-Za-z_][\w-]*)/g

/** Every class a selector names, outside its attribute brackets and strings. */
export const classesOf = (selector) => {
  const bare = selector.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"|'[^']*'/g, '')
  return [...bare.matchAll(CLASS)].map((m) => m[1])
}

/** The rules of one source text: [{ key, selector, body, line }]. `key` is the selector with its at-rule context. */
export const rulesOf = (text) => {
  // comments out, line breaks kept so that a line number still points at the rule
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
  const out = []
  for (const m of clean.matchAll(RULE)) {
    let sel = m[1].split(/[\n`]/).pop().trim().replace(/^[\s'",+]+/, '').replace(/[\s'",+]+$/, '')
    if (sel === '' || /\$\{|'\s*\+|\+\s*'|\\|=>|;/.test(sel) || sel.startsWith('@')) continue
    if (!looksLikeCss(m[2])) continue
    const line = clean.slice(0, m.index + m[0].indexOf('{')).split('\n').length
    for (const one of splitList(sel)) {
      const s = one.replace(/\s+/g, ' ').trim()
      if (s === '' || classesOf(s).length === 0) continue
      out.push({ selector: s, body: normaliseBody(m[2]), line })
    }
  }
  return out
}

/** The style sources of a bundle folder: client.js and its .css files (not the generated shared-ui.css, not vendored code). */
export const sourceFiles = (bundleDir) => {
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'vendor' || name === 'skills' || name === 'technique' || name === 'tools') continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      // shared-ui.css is the generated, unread input of the primitives (kybernos-plugin/README.md): the live copies are the strings inlined in the clients
      else if (name === 'client.js' || (name.endsWith('.css') && name !== 'shared-ui.css')) files.push(path)
    }
  }
  walk(bundleDir)
  return files
}

/** Map<selector, Map<bundle, Set<body>>> over every bundle of `root` (packages/). The bundle of shared-ui.css is `kybernos-plugin`. */
export const selectorsByBundle = (root = PACKAGES) => {
  const all = new Map()
  for (const bundle of readdirSync(root).sort()) {
    const dir = join(root, bundle)
    if (!statSync(dir).isDirectory()) continue
    for (const file of sourceFiles(dir)) {
      for (const r of rulesOf(readFileSync(file, 'utf8'))) {
        if (!all.has(r.selector)) all.set(r.selector, new Map())
        const per = all.get(r.selector)
        if (!per.has(bundle)) per.set(bundle, new Map())
        const bodies = per.get(bundle)
        if (!bodies.has(r.body)) bodies.set(r.body, relative(root, file) + ':' + r.line)
      }
    }
  }
  return all
}

/** Selectors declared by two or more bundles: { selector, bundles: [{ bundle, at, bodies }], identical }. */
export const shared = (root = PACKAGES) => {
  const found = []
  for (const [selector, per] of selectorsByBundle(root)) {
    if (per.size < 2) continue
    // identical copies: every bundle declares the same set of bodies
    const sets = new Set([...per.values()].map((bodies) => [...bodies.keys()].sort().join(' | ')))
    found.push({
      selector,
      identical: sets.size === 1,
      bundles: [...per].map(([bundle, bodies]) => ({ bundle, at: [...bodies.values()][0], bodies: [...bodies.keys()] })),
    })
  }
  return found.sort((a, b) => a.selector.localeCompare(b.selector))
}

/** The class prefix of a selector's first class: `.kbup-head:hover` is `kbup`. */
export const prefixOf = (selector) => { const c = classesOf(selector)[0]; const i = c.indexOf('-', 1); return i < 0 ? c : c.slice(0, i) }

/** Map<prefix, Map<bundle, number of distinct classes>> over every class of every selector, for the prefixes of our own classes (`kb…`, `k…`).
 *  A prefix used by two bundles is a prefix that does not belong to one: some of them are a bundle restyling another's class on purpose. */
export const prefixUsers = (root = PACKAGES) => {
  const seen = new Map() // prefix -> bundle -> Set(class)
  for (const [selector, per] of selectorsByBundle(root)) {
    for (const bundle of per.keys()) {
      for (const c of classesOf(selector)) {
        const i = c.indexOf('-')
        if (i < 2) continue
        const prefix = c.slice(0, i)
        if (!/^k[a-z0-9]*$/.test(prefix)) continue
        if (!seen.has(prefix)) seen.set(prefix, new Map())
        const per2 = seen.get(prefix)
        if (!per2.has(bundle)) per2.set(bundle, new Set())
        per2.get(bundle).add(c)
      }
    }
  }
  const out = new Map()
  for (const [prefix, per] of seen) out.set(prefix, new Map([...per].map(([b, set]) => [b, set.size])))
  return out
}

/** Map<keyframes name, Map<bundle, normalised body>>: @keyframes are global names as well. */
export const keyframesByBundle = (root = PACKAGES) => {
  const out = new Map()
  for (const bundle of readdirSync(root).sort()) {
    const dir = join(root, bundle)
    if (!statSync(dir).isDirectory()) continue
    for (const file of sourceFiles(dir)) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/@keyframes\s+([A-Za-z_][\w-]*)\s*\{/g)) {
        let depth = 1, i = m.index + m[0].length
        for (; i < text.length && depth > 0; i += 1) { if (text[i] === '{') depth += 1; else if (text[i] === '}') depth -= 1 }
        if (!out.has(m[1])) out.set(m[1], new Map())
        out.get(m[1]).set(bundle, text.slice(m.index + m[0].length, i - 1).replace(/\s+/g, ''))
      }
    }
  }
  return out
}

const isMain = process.argv[1] !== undefined && import.meta.url === new URL('file://' + process.argv[1]).href
if (isMain) {
  const found = shared()
  const collisions = found.filter((f) => !f.identical)
  const copies = found.filter((f) => f.identical)
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ collisions, copies }, null, 2))
  } else {
    console.log(collisions.length + ' collisions (same selector, different declarations in two bundles), ' + copies.length + ' identical copies')
    const byPrefix = new Map()
    for (const f of collisions) {
      const p = prefixOf(f.selector)
      if (!byPrefix.has(p)) byPrefix.set(p, [])
      byPrefix.get(p).push(f)
    }
    for (const [p, list] of [...byPrefix].sort()) {
      console.log('\n.' + p + '-*  ' + [...new Set(list.flatMap((f) => f.bundles.map((b) => b.bundle)))].join(' / '))
      for (const f of list) console.log('  ' + f.selector + '   ' + f.bundles.map((b) => b.at).join('   '))
    }
    if (process.argv.includes('--copies')) {
      console.log('\nidentical copies:')
      for (const f of copies) console.log('  ' + f.selector + '   ' + f.bundles.map((b) => b.bundle).join(', '))
    }
  }
}
