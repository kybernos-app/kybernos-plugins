#!/usr/bin/env node
// One language policy for every bundle (WP-07, decision D1), checked offline:
//   English is the base of every UI string. French exists only inside French dictionaries (a [fr, en] row, a `fr:` table, the fr
//   argument of a pair helper); a plugin with its own table gives en and fr and falls back to ENGLISH, never to French, for any other
//   language; the README and the package description are English.
//
// Per bundle, in scripts/i18n-french-allow.json:
//   "pending"        the bundle has not been cleaned yet: the test reports what it finds and passes (so the gate tightens as bundles are done);
//   [ "…", … ]       STRICT: no French literal outside a dictionary, an English README and description, a pair helper that falls back to English.
//                    The array lists the exact literals that are allowed to stay (a proper name, a French sample sentence): keep it empty.
//
//   node scripts/test-no-french-literals.mjs            # the gate
//   node scripts/test-no-french-literals.mjs --list kybernos-bricks   # what is left in one bundle (line, text)
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { frenchEverywhere, frenchLinesOfMarkdown, frenchOutsideDictionary, isFrench, isFrenchProse } from './lib-french-literals.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = join(REPO, 'packages')
const ALLOW = JSON.parse(readFileSync(join(REPO, 'scripts', 'i18n-french-allow.json'), 'utf8'))
// bundles in which a French word written without its accent (« indisponible », « Discuter ») counts as French too: the gate tightens bundle by bundle
const UNACCENTED = new Set(Array.isArray(ALLOW.unaccented) ? ALLOW.unaccented : [])
const bundles = readdirSync(PACKAGES).filter((d) => statSync(join(PACKAGES, d)).isDirectory() && existsSync(join(PACKAGES, d, 'package.json'))).sort()

let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)))) } }

/** The code files of a bundle that a person (or the model) can read text from: not tests, not vendored libraries. */
const codeFiles = (dir) => {
  const out = []
  // a bundle built from src/plugin.js ships a generated client.js (with vendored libraries pasted in): the source is what is read
  const built = existsSync(join(dir, 'src', 'plugin.js'))
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      if (e === 'node_modules' || e === 'vendor' || e === 'test' || e === 'tests' || e === 'template' || e === 'template-dsh' || e === 'phone') continue
      const p = join(d, e)
      if (statSync(p).isDirectory()) { walk(p); continue }
      if (!/\.(m?js|cjs)$/.test(e)) continue
      if (/^(test-|check-|rendre-)/.test(e) || /\.test\.m?js$/.test(e)) continue
      if (built && (p === join(dir, 'client.js') || p === join(dir, 'client', 'client.js'))) continue
      out.push(p)
    }
  }
  walk(dir)
  return out.sort()
}

/** Every French literal outside a dictionary in a bundle: [{ file, line, text }]. */
const findings = (bundle) => {
  const dir = join(PACKAGES, bundle)
  const out = []
  for (const f of codeFiles(dir)) {
    for (const o of frenchOutsideDictionary(readFileSync(f, 'utf8'), { unaccented: UNACCENTED.has(bundle) })) out.push({ file: relative(dir, f), line: o.line, text: o.text })
  }
  return out
}

// ── the pair helper: French for French, English for every other language ──────────────────────────
/** The source text of the statement that starts at `startLine` (0-based): up to the next line indented no deeper than it that opens a new statement. */
const statementFrom = (lines, startLine) => {
  const indent = lines[startLine].match(/^\s*/)[0].length
  let end = startLine + 1
  while (end < lines.length) {
    const l = lines[end]
    if (l.trim() === '') { end += 1; continue }
    const ind = l.match(/^\s*/)[0].length
    if (ind <= indent && !/^\s*[)}\].?:,&|+]/.test(l)) break
    end += 1
  }
  return lines.slice(startLine, end).join('\n')
}

/** The `lang` and `kt` statements of a client file, or null when it has no pair helper `kt(fr, en)`. */
const helperSource = (src) => {
  const lines = src.split('\n')
  const ktAt = lines.findIndex((l) => /^\s*const kt = \(fr, en\)\s*=>/.test(l))
  if (ktAt < 0) return null
  const langAt = lines.findIndex((l) => /^\s*const lang = \(\)\s*=>/.test(l))
  const parts = []
  if (langAt >= 0) parts.push(statementFrom(lines, langAt))
  parts.push(statementFrom(lines, ktAt))
  return parts.join('\n')
}

/** Runs the helper in a sandbox for one resolved language; `extra` sets window fields (the translated dictionary). */
const runHelper = (source, resolved, extra = {}) => {
  const win = Object.assign({ __KB_LANG_RESOLVE__: typeof resolved === 'function' ? resolved : () => resolved }, extra)
  const ctx = vm.createContext({ window: win, document: { documentElement: { lang: 'en' } }, localStorage: { getItem: () => null }, console })
  vm.runInContext(source + '\nthis.__kt = kt', ctx)
  return ctx.__kt('FRENCH TEXT', 'ENGLISH TEXT')
}

/** Why a bundle's pair helper is wrong, or null when it holds the policy. */
const helperProblem = (src) => {
  const source = helperSource(src)
  if (source === null) return null
  try {
    const FR = 'FRENCH TEXT'
    const EN = 'ENGLISH TEXT'
    const want = (label, got, ok) => (ok.includes(got) ? null : label + ' gave ' + JSON.stringify(got))
    const problems = [
      want('en', runHelper(source, 'en'), [EN]),
      want('kybernos', runHelper(source, 'kybernos'), [FR]),
      want('fr', runHelper(source, 'fr'), [FR]),
      want('fr-CA', runHelper(source, 'fr-CA'), [FR]),
      ...['es', 'ar', 'zh', 'de'].map((l) => want(l, runHelper(source, l), [EN])),
      want('es with a translated dictionary', runHelper(source, 'es', { __KB_I18N_ACTIVE__: { lang: 'es', dict: { [FR]: 'TEXTO' } } }), [EN, 'TEXTO']),
      want('a resolver that throws', runHelper(source, () => { throw new Error('not ready') }), [EN]),
      want('no resolver at all', runHelper(source, undefined, { __KB_LANG_RESOLVE__: undefined }), [EN]),
    ].filter((p) => p !== null)
    return problems.length === 0 ? null : problems.join('; ')
  } catch (e) {
    return 'the helper cannot be run on its own (' + e.message + '): keep `const lang = () =>` and `const kt = (fr, en) =>` self-contained'
  }
}

const list = process.argv.indexOf('--list')
if (list >= 0) {
  const b = process.argv[list + 1]
  for (const o of findings(b)) console.log(o.file + ':' + o.line + '\t' + JSON.stringify(o.text.slice(0, 140)))
  const readme = join(PACKAGES, b, 'README.md')
  if (existsSync(readme)) for (const o of frenchLinesOfMarkdown(readFileSync(readme, 'utf8'))) console.log('README.md:' + o.line + '\t' + JSON.stringify(o.text))
  process.exit(0)
}


// ── the allow-list itself ─────────────────────────────────────────────────────────────────────────
console.log('the allow-list names every bundle once')
{
  const names = Object.keys(ALLOW.bundles)
  check('every bundle is listed (a new bundle must choose: "pending" or strict)', bundles.every((b) => names.includes(b)), bundles.filter((b) => !names.includes(b)))
  check('no entry names a bundle that is gone', names.every((n) => bundles.includes(n)), names.filter((n) => !bundles.includes(n)))
  check('an entry is "pending" or a list of strings', names.every((n) => ALLOW.bundles[n] === 'pending' || (Array.isArray(ALLOW.bundles[n]) && ALLOW.bundles[n].every((s) => typeof s === 'string'))))
  check('a French twin is only required of a strict bundle', Object.keys(ALLOW.needFrench).filter((n) => n !== '_doc').every((n) => Array.isArray(ALLOW.bundles[n])), Object.keys(ALLOW.needFrench))
}

// ── the scanner itself, on small cases (it must not flag English, identifiers, or a dictionary) ───
console.log('the scanner')
{
  const f = (src) => frenchOutsideDictionary(src).map((o) => o.text)
  check('English and identifiers are not French', f("const a = 'Close'; const b = 'Open the menu'; const c = { title: 'Settings', n: 'x' }; log('don\\'t stop')").length === 0)
  check('a French sentence in code is found', f("h('button', null, 'Aucune maquette pour le moment')").length === 1)
  check('a one-word label of the French lexicon is found', f("const t = 'Fermer'").length === 1)
  check('a pair helper puts the French argument in a dictionary', f("const kt = (fr, en) => en\nh('b', null, kt('Fermer la fenêtre', 'Close the window'))").length === 0)
  check('…but not the English argument position of an unrelated call', f("alert('Fermer la fenêtre')").length === 1)
  check('a [fr, en] row is a dictionary', f("const S = { close: ['Fermer la fenêtre', 'Close the window'] }").length === 0)
  check('a fr table is a dictionary, its neighbour is not', f("const D = { fr: { a: 'Fermer la fenêtre' }, en: { a: 'Close' } }\nconst bad = 'Fermer la fenêtre'").length === 1)
  check('a French literal in a grouping parenthesis of a pair call is in the dictionary', f("const kt = (fr, en) => en\nconst x = kt('' + n + (n > 1 ? ' leçons' : ' leçon'), 'lessons')").length === 0)
  check('a { fr, en } pair is a dictionary', f("const x = { fr: 'Fermer la fenêtre', en: 'Close the window' }").length === 0)
  check('a row of languages [en, fr, es, ar] is a dictionary', f("const T = { skip: ['Skip', 'Passer la fenêtre', 'Omitir', 'تخطي'] }").length === 0)
  check('…but a list of French only is not', f("const T = ['Fermer la fenêtre', 'Ouvrir la porte', 'Annuler l’action']").length === 3)
  check('a helper written (en, fr) puts its French argument in a dictionary', f("const sk = (name, en, fr) => ({ name, en, fr })\nsk('a', 'Close the window', 'Fermer la fenêtre')").length === 0)
  check('French inside a comment or a regex is not a literal', f("// Fermer la fenêtre\n/* Ouvrir la porte */ const r = /é|è/g").length === 0)
  check('a template literal is read, its expressions are code', f('const t = `${a} fichiers sont dans le dossier`').length === 1)
  check('an accent-less French label is found where the bundle asks for it, and only there', frenchOutsideDictionary("h('b', null, 'Discuter'); log('service indisponible, lancement impossible')", { unaccented: true }).length === 2 && frenchOutsideDictionary("h('b', null, 'Discuter'); log('service indisponible, lancement impossible')").length === 0)
  check('an accent-less word inside a pair helper or a [fr, en] row is a dictionary', frenchOutsideDictionary("const kt = (fr, en) => en\nkt('Discuter', 'Chat'); const R = ['aucun', 'none']", { unaccented: true }).length === 0)
  check('English that looks like a French word is not French', frenchOutsideDictionary("log('Export the table'); const a = 'Lecture notes'; const p = 'preset'", { unaccented: true }).length === 0)
  check('a language picker name is not French text', f("const l = 'Français'").length === 0)
  check('a README line of French prose is found, English with a quoted label is not', frenchLinesOfMarkdown('Le panneau affiche les briques de la maquette.\nThe « Briques » panel shows the bricks.\n').length === 1)
}

// ── each bundle ───────────────────────────────────────────────────────────────────────────────────
let strictCount = 0
let pendingCount = 0
for (const b of bundles) {
  const entry = ALLOW.bundles[b]
  if (entry === undefined) continue
  const found = findings(b)
  const pkg = JSON.parse(readFileSync(join(PACKAGES, b, 'package.json'), 'utf8'))
  const readme = existsSync(join(PACKAGES, b, 'README.md')) ? frenchLinesOfMarkdown(readFileSync(join(PACKAGES, b, 'README.md'), 'utf8')) : []
  const descFrench = typeof pkg.description === 'string' && (isFrench(pkg.description) || isFrenchProse(pkg.description))
  const helperProblems = []
  for (const f of codeFiles(join(PACKAGES, b))) {
    if (!/(^|\/)(client|plugin)\.js$/.test(f)) continue
    const p = helperProblem(readFileSync(f, 'utf8'))
    if (p !== null) helperProblems.push(relative(join(PACKAGES, b), f) + ': ' + p)
  }
  if (entry === 'pending') {
    pendingCount += 1
    console.log('  · ' + b + ' (pending): ' + found.length + ' French literal(s), ' + readme.length + ' French README line(s)' + (descFrench ? ', French description' : '') + (helperProblems.length > 0 ? ', helper falls back to French' : '') + (pkg.exports && pkg.exports['./package.json'] === './package.json' ? '' : ', no description on the Built-in plugins page'))
    continue
  }
  strictCount += 1
  console.log(b)
  const allowed = new Set(entry)
  const left = found.filter((o) => !allowed.has(o.text))
  check('no French literal outside a dictionary (client.js, index.js, host modules)', left.length === 0, left.slice(0, 6).map((o) => o.file + ':' + o.line + ' ' + JSON.stringify(o.text.slice(0, 60))))
  check('every allowed exception still exists (no stale entry)', entry.every((s) => found.some((o) => o.text === s)), entry.filter((s) => !found.some((o) => o.text === s)))
  check('README.md is English', readme.length === 0, readme.slice(0, 3).map((o) => o.line + ' ' + JSON.stringify(o.text.slice(0, 50))))
  check('the package description is English and present', typeof pkg.description === 'string' && pkg.description.length > 10 && !descFrench, pkg.description)
  // The Built-in plugins page reads a bundle's description through `require.resolve('<id>/package.json')`: a package that does not
  // export it shows its raw id and no description (measured on a sandbox, 2026-10-16: with the export the description appears).
  check('the package exports ./package.json (the Built-in plugins page reads its description through it)', pkg.exports !== null && typeof pkg.exports === 'object' && pkg.exports['./package.json'] === './package.json', pkg.exports)
  check('the pair helper answers French for French, English for every other language', helperProblems.length === 0, helperProblems)
  const need = ALLOW.needFrench[b]
  if (need !== undefined) {
    const twin = codeFiles(join(PACKAGES, b)).filter((f) => /(^|\/)(client|plugin)\.js$/.test(f)).reduce((n, f) => n + frenchEverywhere(readFileSync(f, 'utf8')).length, 0)
    check('the French twin is there (at least ' + need + ' French dictionary literals in the client)', twin >= need, twin)
  }
}
console.log('\n' + strictCount + ' strict bundle(s), ' + pendingCount + ' pending (the allow-list tightens as bundles are cleaned)')
console.log(pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
