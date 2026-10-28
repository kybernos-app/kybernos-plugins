// test-client.mjs — the browser half checked without a browser.
// What can be checked from the source, and is worth checking: the label pairs, the families agreeing with the host,
// the plate's CSS being the bundle's own, the routes the page calls being the ones the host mounts, and the
// drop-proof factory (a bundle must never stop DSH from starting).
// Run: node packages/kybernos-log/test-client.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KINDS, toolKind } from './index.js'

let pass = 0
const fails = []
const ok = (label, cond) => { if (cond) { pass += 1 } else { fails.push(label) } }

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')

// ── the factory never throws into DSH ───────────────────────────────────────────────────────────────────────────
ok('the module loader wrapper is present', src.includes("window.__ModuleLoader__.load({"))
ok('the factory returns a disabled plugin on error', /catch \(error\) \{[\s\S]{0,400}return \{ apply \(\) \{ \/\* disabled after a load error \*\/ \} \}/.test(src))
ok('the page component is guarded at render', src.includes("() => { try { return h(Page) } catch (e) { return null } }"))

// ── families: the page's chips are exactly the host's families ───────────────────────────────────────────────────
const typesMatch = src.match(/const TYPES = \[([^\]]+)\]/)
ok('TYPES is declared', typesMatch !== null)
if (typesMatch !== null) {
  const clientTypes = typesMatch[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean)
  ok('every family of the page exists on the host', clientTypes.every((t) => KINDS.includes(t)))
  ok('every family of the host is on the page', KINDS.every((t) => clientTypes.includes(t)))
  ok('no duplicate family', new Set(clientTypes).size === clientTypes.length)
}

// ── labels: both sides of every pair, and no English copied into the French side ────────────────────────────────
const pairs = Array.from(src.matchAll(/^\s{8}(\w+): \['((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'\]/gm))
ok('the label table is found', pairs.length >= 30)
ok('every pair has a French side', pairs.every((m) => m[2].trim() !== ''))
ok('every pair has an English side', pairs.every((m) => m[3].trim() !== ''))
// The only French/English pairs that may be identical are real cognates: anything else means an untranslated label.
const COGNATES = new Set(['session', 'retries', 'tokens'])
const identical = pairs.filter((m) => m[2] === m[3]).map((m) => m[2].toLowerCase())
ok('a French side is not silently English (identical pairs limited to cognates)', identical.every((k) => COGNATES.has(k)))
ok('labels use the typographic apostrophe', !/'[^']*\b(?:l|d|n|s|qu)'[a-zà-ÿ]/i.test(src.split('const S = {')[1]?.split('}\n')[0] || ''))

// ── routes: the page calls what the host mounts ────────────────────────────────────────────────────────────────
for (const route of ['/kybernos-log/events', '/kybernos-log/stats', '/kybernos-log/stream']) {
  ok('the page calls ' + route, src.includes(route))
}
ok('the live tail is an EventSource on the stream route', /new EventSource\('\/kybernos-log\/stream'\)/.test(src))
ok('the refresh timer is cleared on unmount', /clearInterval\(t\)/.test(src))
ok('the live stream is closed on unmount', /\.close\(\)/.test(src))

// ── the Settings seat ───────────────────────────────────────────────────────────────────────────────────────────
ok('a settings.section is registered', src.includes("'settings.section'"))
const seat = src.match(/\{ name: 'settings\.section', id: 'kybernos-log', order: (\d+), label: \(\) => kt\(/)
ok('the section id is kybernos-log', src.includes("id: 'kybernos-log'"))
ok('the section sits after Usage (32) and before the tail', seat !== null && Number(seat[1]) === 34)
ok('the label is translated on both sides', src.includes("kt('Journal d’activité', 'Activity log')"))

// ── the plate ships the bundle's CSS, exactly ──────────────────────────────────────────────────────────────────
const cssMatch = src.match(/const CSS = `\n([\s\S]*?)\n`\n/)
ok('the bundle declares one CSS block', cssMatch !== null)
if (cssMatch !== null) {
  // A backtick inside the CSS template literal ends the literal and turns the rest into code: `node --check` passes
  // and so do the tests, yet the bundle throws at load time (measured 2026-10-28: plugin disabled, page missing).
  ok('the CSS block carries no stray backtick', !cssMatch[1].includes('`'))
  const plate = readFileSync(join(here, '..', '..', 'docs', 'handoff', 'journal-activite', 'maquette-v1', 'kblg.css'), 'utf8')
  // Comments aside (the plate explains itself at the top), the rules must be the bundle's own, byte for byte.
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').trim()
  ok('kblg.css (the plate) is identical to the bundle’s CSS, comments aside', strip(plate) === strip(cssMatch[1]))
  ok('the CSS uses DSH tokens only (no hard-coded colour without a var)', !/#[0-9a-f]{3,8}\b/i.test(cssMatch[1].replace(/var\([^)]*\)/g, '')))
  ok('a narrow class exists for the Settings volet', cssMatch[1].includes('.kblg-narrow'))
}

// ── the classifier used by the page agrees with the host's ─────────────────────────────────────────────────────
ok('toolKind still routes an MCP tool to the connector family', toolKind('mcp__github__pr') === 'connector')

console.log((fails.length === 0 ? '✓ ' : '✗ ') + pass + ' passed' + (fails.length === 0 ? '' : ', ' + fails.length + ' failed'))
for (const f of fails) console.log('   ✗ ' + f)
process.exit(fails.length === 0 ? 0 : 1)
