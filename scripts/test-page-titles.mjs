#!/usr/bin/env node
// One title for every Settings page, and no page that gets a style of its own for it. Static (the browser halves are read as text, as the neighbours do);
// the real measure, on the screen, is scripts/check-page-titles-live.mjs.
//
//   node scripts/test-page-titles.mjs
//
// How a page gets its title: it calls `pageHead({ id, page, lead, title, className })` (a three-line helper each bundle holds: the Suite's `Title` when it is there, the
// bare heading when not). The Suite draws the heading in the class `.kbhp-title` and the page's « ? » right after its text; the size, weight, colour, line height and
// letter spacing of that class are set ONCE, in the Settings frame of the core plugin (« Gabarit unique », kybernos-plugin/client.js). A page's own class on its title is
// a hook for tests and scripts, never a style: this file fails when one declares a font, a size, a weight or a spacing, when a bundle that registers a Settings page does not
// use pageHead, when a copy of the helper differs from the others, or when the frame's rule lists a title class of its own again.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages')
let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 400)))
  if (!ok) failed += 1
}
const bundles = readdirSync(PACKAGES).filter((b) => { try { readFileSync(join(PACKAGES, b, 'client.js')); return true } catch (e) { return false } })
const src = Object.fromEntries(bundles.map((b) => [b, readFileSync(join(PACKAGES, b, 'client.js'), 'utf8')]))

// The helper, as every bundle holds it (only the indentation may differ).
const CANON = "const pageHead = (props) => { try { if (window.__KB_HELP__ && window.__KB_HELP__.Title) return h(window.__KB_HELP__.Title, props) } catch (e) { /* the bare title below */ } return h(props.as || 'h2', { className: 'kbhp-title' + (props.className ? ' ' + props.className : '') }, props.title, props.after) }"
const helperOf = (s) => { const m = /^[ \t]*(const pageHead = \(props\) =>.*)$/m.exec(s); return m === null ? null : m[1].trim() }

// Bundles that register a page of Settings, and what each does about its title. A page that draws no title of its own (it keeps DSH's) is listed with the reason.
const registers = bundles.filter((b) => /name: 'settings\.section'/.test(src[b]))
const NO_TITLE_OF_ITS_OWN = {}

console.log('the helper')
{
  const holders = bundles.filter((b) => helperOf(src[b]) !== null)
  check('at least twenty bundles draw a title through pageHead', holders.length >= 20, holders.length)
  const odd = holders.filter((b) => helperOf(src[b]) !== CANON)
  check('every copy of the helper is the same text (the bare fallback keeps the page’s class and the shared class)', odd.length === 0, odd)
  check('each bundle defines it once', holders.every((b) => (src[b].match(/const pageHead = \(props\) =>/g) || []).length === 1), holders.filter((b) => (src[b].match(/const pageHead = \(props\) =>/g) || []).length !== 1))
}

console.log('every bundle that registers a Settings page draws its title through it')
{
  const missing = registers.filter((b) => NO_TITLE_OF_ITS_OWN[b] === undefined && !/\bpageHead\(/.test(src[b].replace(/const pageHead = \(props\) =>.*/, '')))
  check(registers.length + ' bundles register a Settings page: each calls pageHead (or is listed with its reason)', registers.length >= 25 && missing.length === 0, missing)
}

console.log('the title has no style of its own')
{
  const FONT = /(^|;)\s*(font|font-size|font-weight|font-family|line-height|letter-spacing)\s*:/
  const offenders = []
  for (const b of bundles) {
    const s = src[b]
    // The hooks the page hands to its title: className: 'x' inside a pageHead({ ... }) call.
    const hooks = new Set()
    for (const m of s.matchAll(/pageHead\(\{[^\n]*?className: '([A-Za-z0-9_-]+)'/g)) hooks.add(m[1])
    for (const hook of hooks) {
      // A rule whose last compound selector is that class (a rule on `.x .child` is the child's, not the title's).
      const re = new RegExp('(?:^|[\\s,>+~\\x27"`])((?:[^{}\\n\\x27"`;,]*?[\\s>+~])?\\.' + hook.replace(/[-]/g, '\\-') + ')(?![\\w-])([^{}\\n\\x27"`;]*)\\{([^{}]*)\\}', 'gm')
      for (const m of s.matchAll(re)) if (FONT.test(m[3])) offenders.push(b + ' .' + hook + ' {' + m[3].slice(0, 80) + '}')
    }
  }
  check('no page declares a font, size, weight, line height or spacing on the class it gives its title', offenders.length === 0, offenders)
  const hubCss = src['kybernos-hub']
  check('the Suite’s Title sets the shared class and the layout, never a size or a weight', !/\.kbhp-title\{[^}]*(font-size|font-weight|letter-spacing|color)/.test(hubCss))
}

console.log('the one rule')
{
  const frame = src['kybernos-plugin']
  const rules = [...frame.matchAll(/\[class\$="_options"\] :is\(([^)]*\.kbhp-title[^)]*)\)\{([^}]*)\}/g)]
  check('the Settings frame has ONE rule for page titles', rules.length === 1, rules.length)
  const list = rules.length === 1 ? rules[0][1] : ''
  check('it covers DSH’s own page titles and the shared class, nothing else (a class a page invents is not in the list)', list === 'h2[class*="_title"],h2[class*="_heading"],.kbhp-title', list)
  check('its size is 18 px, its weight 600, its line height 1.3, its letter spacing -.01em, no margin', rules.length === 1 && /font-size:18px;font-weight:600;line-height:1\.3;letter-spacing:-\.01em;margin:0/.test(rules[0][2]), rules.length === 1 && rules[0][2])
  const others = bundles.filter((b) => b !== 'kybernos-plugin' && /\.kbhp-title\s*\{[^}]*font-size/.test(src[b]))
  check('no other bundle sets a size on the shared class', others.length === 0, others)
  const rows = bundles.filter((b) => /kbhp-row/.test(src[b]))
  check('nobody uses the row that held the button apart from its title (.kbhp-row is gone)', rows.length === 0, rows)
}

console.log(failed === 0 ? '\nOK' : '\n' + failed + ' failure(s)')
process.exit(failed === 0 ? 0 : 1)
