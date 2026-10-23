#!/usr/bin/env node
// A function with several parameters is never handed bare to `.map`, `.filter`, `.forEach`…: those call it with (item, index, array), so a second
// or third parameter of its own silently receives the index or the whole array.
//
//   node scripts/test-no-bare-callbacks.mjs
//
// Born from the bug of 2026-10-23: `pickCard(p, i, opts)` took a third parameter `opts` (for the skills of « For your field »), and the Featured grid
// still drew its cards with `list.map(pickCard)`: `opts` was the whole list, every card lost its click, its Details, its star and its Installed state,
// and four tests that read the source had pinned the call. The same trap is why `['1', '2'].map(parseInt)` is wrong.
//
// What is read: our own sources (packages/*, scripts/, services/), not the tests, not a third-party bundle (packages/dsh-*, vendor, a minified line of a library inlined in a client).
// A call `x.map(name)` (also forEach, filter, some, every, find, findIndex, findLast, findLastIndex, flatMap) with a bare name is looked up in the SAME file:
// every definition found (`const name = (a, b) =>`, `function name(a, b)`) must take at most one parameter, or two when the second is an index
// (`i`, `idx`, `index`) which the callback really does receive. A name that is not defined in the file (an import, a method) is not judged.
// The fix is always the same: `x.map((item) => name(item))`.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const METHODS = 'map|forEach|filter|some|every|find|findIndex|findLast|findLastIndex|flatMap'
const INDEX_NAMES = new Set(['i', 'idx', 'index'])
const MINIFIED_LINE = 4000
const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', '.worktrees', '.claude', 'dist', 'build'])

const escapeRe = (s) => s.replace(/[$.*+?^{}()|[\]\\]/g, '\\$&')
/** Splits a parameter list at its top-level commas (defaults and destructuring may hold commas of their own). */
const splitParams = (list) => {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of list) {
    if ('([{'.includes(ch)) depth += 1
    if (')]}'.includes(ch)) depth -= 1
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = '' } else cur += ch
  }
  if (cur.trim() !== '') out.push(cur.trim())
  return out
}
/** The parameter lists of every definition of `name` in `src` (arrow, function expression, declaration). */
const definitionsOf = (src, name) => {
  const n = escapeRe(name)
  const re = new RegExp('(?:const|let|var)\\s+' + n + '\\s*=\\s*(?:async\\s*)?(?:function\\s*\\*?\\s*[\\w$]*\\s*)?\\(([^)]*)\\)\\s*(?:=>|\\{)|function\\s*\\*?\\s*' + n + '\\s*\\(([^)]*)\\)|(?:const|let|var)\\s+' + n + '\\s*=\\s*(?:async\\s*)?([A-Za-z_$][\\w$]*)\\s*=>', 'g')
  const out = []
  for (let m = re.exec(src); m !== null; m = re.exec(src)) out.push(splitParams(m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3])))
  return out
}
const unsafe = (params) => params.length > 2 || (params.length === 2 && !INDEX_NAMES.has(params[1].replace(/\s*=.*$/, ''))) || params.some((p) => p.startsWith('...'))
const lineOf = (src, at) => src.slice(0, at).split('\n').length

/** The problems of one source text: `[{ line, call, why }]`. */
export function bareCallbackProblems (source) {
  const out = []
  // A vendored library inlined in a client (TipTap in the Slides client) is one minified line of tens of thousands of characters, with its own one-letter names: not ours to judge.
  const src = source.split('\n').map((l) => (l.length > MINIFIED_LINE ? '' : l)).join('\n')
  const re = new RegExp('\\.(' + METHODS + ')\\(\\s*([A-Za-z_$][\\w$]*)\\s*[,)]', 'g')
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    const name = m[2]
    const call = '.' + m[1] + '(' + name + ')'
    if (name === 'parseInt' || name === 'parseFloat') { out.push({ line: lineOf(src, m.index), call, why: name + ' takes a second argument (a radix) and would receive the index' }); continue }
    const defs = definitionsOf(src, name)
    if (defs.length === 0 || !defs.every(unsafe)) continue
    out.push({ line: lineOf(src, m.index), call, why: name + '(' + defs[0].join(', ') + ') takes more than the item: write .' + m[1] + '((item) => ' + name + '(item))' })
  }
  return out
}

/** Our own source files (see the header). */
export function ownSources (root = REPO) {
  const files = []
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      if (SKIP_DIRS.has(f)) continue
      const p = join(dir, f)
      const st = statSync(p)
      if (st.isDirectory()) { if (/^dsh-/.test(f) && dirname(p).endsWith('packages')) continue; walk(p) } else if (/\.m?js$/.test(f) && !/^test/.test(f) && !/\.min\./.test(f) && !/\.test\.m?js$/.test(f)) files.push(p)
    }
  }
  for (const top of ['packages', 'scripts', 'services']) { try { walk(join(root, top)) } catch (e) { /* no such folder */ } }
  return files
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  let failed = 0
  const check = (name, ok, detail) => {
    console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '\n      ' + (Array.isArray(detail) ? detail.join('\n      ') : JSON.stringify(detail))))
    if (!ok) failed += 1
  }

  console.log('the checker sees the trap (and only the trap)')
  {
    const bad = (s) => bareCallbackProblems(s).length > 0
    check('a function with an `opts` third parameter handed to map', bad('const card = (p, i, opts) => 1\nlist.map(card)'))
    check('a function with a second parameter that is not an index', bad('const card = (p, opts) => 1\nlist.map(card)') && bad('function card (p, opts = {}) { return 1 }\nrows.forEach(card)'))
    check('a rest parameter', bad('const f = (...all) => 1\nxs.filter(f)'))
    check('parseInt, whose second argument is a radix', bad("['1', '2'].map(parseInt)"))
    check('a bare function with one parameter is fine, and so are an explicit call and an index', !bad('const card = (p) => 1\nlist.map(card)') && !bad('const card = (p, opts) => 1\nlist.map((p, i) => card(p, i))') && !bad('const row = (x, i) => 1\nlist.map(row)') && !bad('const row = async x => 1\nlist.map(row)'))
    check('a name that is not defined in the file (an import, a method) is not judged', !bad('import { card } from "./x"\nlist.map(card)') && !bad('list.map(String)') && !bad('xs.map(Boolean)'))
    check('a minified line of an inlined library is not read', !bad('const l = (a, c) => 1\n' + 'x'.repeat(5000) + ';n.map(l);'))
    check('it reads every method of the family and the right line', bareCallbackProblems('a\nconst f = (x, y) => 1\nxs.flatMap(f)')[0].line === 3 && bad('const f = (x, y, z) => 1\nxs.some(f)') && bad('const f = (x, y, z) => 1\nxs.findLast(f)'))
  }

  console.log('our own sources')
  {
    const files = ownSources()
    check('there are sources to read, and no third-party bundle among them', files.length > 100 && !files.some((f) => /packages\/dsh-/.test(relative(REPO, f))), files.length)
    const found = []
    for (const f of files) {
      let src
      try { src = readFileSync(f, 'utf8') } catch (e) { continue }
      for (const p of bareCallbackProblems(src)) found.push(relative(REPO, f) + ':' + p.line + '  ' + p.call + '  — ' + p.why)
    }
    check('no function with several parameters is handed bare to map / filter / forEach / some / every / find / flatMap', found.length === 0, found.slice(0, 20))
  }
  console.log('\n' + (failed === 0 ? 'all good' : failed + ' check(s) failed'))
  process.exit(failed === 0 ? 0 : 1)
}
