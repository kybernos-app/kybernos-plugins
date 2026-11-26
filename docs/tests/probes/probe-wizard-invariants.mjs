#!/usr/bin/env node
// PROBE — Ground 3 of docs/tests/revue-adversariale.md (F-39/F-40): A1-kit-wizard's two frozen invariants are RED on the
// merged tree because they are written FILE-WIDE; the probe states the consumer-aware form they must take (and the code half:
// the marketplace must read the one published seam, never a second raw `window.__KB_THEME_APPLY__`).
//
//   node docs/tests/probes/probe-wizard-invariants.mjs
//
// What it asserts, on packages/kybernos-plugin/client.js as text (the DoD's own method, narrowed to the consumer):
//   (a) the seam is read from `window` in EXACTLY ONE place in the file, and that place is inside the wizard's KB-OB-CORE
//       block — one published seam, every consumer through the helper;
//   (b) no other consumer block (KB-TH-CORE, KB-MARKET-PURE, KB-MARKET-UI) holds a raw read of the seam;
//   (c) inside the wizard's own blocks (KB-OB-CORE + KB-OB-UI) the `pack.kit` family appears ZERO times — the invariant the
//       spec meant, which a second consumer cannot break;
//   (d) what the file-wide counts are today, printed as the evidence that a file-wide invariant cannot survive a second
//       legitimate consumer (do not fail on those: (a)-(c) are the invariant).
//
// Fails today: 2 raw reads file-wide (client.js:26089 and :36961) and the KB-TH-CORE port reads the window itself.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const client = readFileSync(join(here, '..', '..', '..', 'packages', 'kybernos-plugin', 'client.js'), 'utf8')
const themeClient = readFileSync(join(here, '..', '..', '..', 'packages', 'kybernos-theme', 'client.js'), 'utf8')

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const section = (title) => console.log('\n' + title)
const count = (text, token) => { let n = 0; let i = text.indexOf(token); while (i >= 0) { n += 1; i = text.indexOf(token, i + token.length) } return n }
/** The text between two block markers (the markers included). */
const block = (text, begin, end) => {
  const a = text.indexOf(begin)
  const b = text.indexOf(end)
  return a < 0 || b <= a ? null : text.slice(a, b + end.length)
}
const lineOf = (text, index) => text.slice(0, index).split('\n').length
const rawReads = (text) => {
  const out = []
  let i = text.indexOf('__KB_THEME_APPLY__')
  while (i >= 0) { out.push({ index: i, line: lineOf(text, i) }); i = text.indexOf('__KB_THEME_APPLY__', i + 1) }
  return out
}

const CORE = block(client, '// KB-OB-CORE-BEGIN', '// KB-OB-CORE-END')
const UI = block(client, '// KB-OB-UI-BEGIN', '// KB-OB-UI-END')
const TH = block(client, '// KB-TH-CORE-BEGIN', '// KB-TH-CORE-END')
const MP = block(client, '// KB-MARKET-PURE-BEGIN', '// KB-MARKET-PURE-END')
const MU = block(client, '// KB-MARKET-UI-BEGIN', '// KB-MARKET-UI-END')
const coreAt = client.indexOf('// KB-OB-CORE-BEGIN')

section('(a) one published seam: exactly one raw read, inside the wizard\'s own block')
{
  const reads = rawReads(client)
  check('the file holds exactly ONE read of __KB_THEME_APPLY__ (today: two, one of them the marketplace\'s)',
    reads.length === 1, { count: reads.length, lines: reads.map((r) => r.line) })
  check('...and that read sits inside KB-OB-CORE, the block that publishes the seam helper',
    reads.length === 1 && reads[0].index > coreAt && reads[0].index < client.indexOf('// KB-OB-CORE-END'),
    { lines: reads.map((r) => r.line), coreBeginsAt: lineOf(client, coreAt) })
  check('the wizard\'s UI applies the look through the published helper, never a bare window read',
    UI !== null && /kbObThemeSeam\s*\(/.test(UI) && rawReads(UI).length === 0,
    { helperCalls: (UI === null ? 0 : (UI.match(/kbObThemeSeam\s*\(/g) || []).length) })
}

section('(b) no other consumer holds a raw read')
{
  check('KB-TH-CORE (the installer page and the published install seam) reads no raw seam: it goes through the helper',
    TH !== null && rawReads(TH).length === 0, { lines: TH === null ? null : rawReads(TH).map((r) => r.line) })
  const ports = client.slice(client.indexOf('const kbThPorts = () => {'), client.indexOf('const kbThPresence ='))
  check('...its style port (kbThPorts().style) holds no raw read either', ports.length > 0 && rawReads(ports).length === 0,
    { excerpt: ports.slice(0, 240) })
  check('the marketplace blocks hold no raw read at all', MP !== null && MU !== null && rawReads(MP).length === 0 && rawReads(MU).length === 0,
    { pure: MP === null ? null : rawReads(MP).length, ui: MU === null ? null : rawReads(MU).length })
  const published = (themeClient.match(/window\.__KB_THEME_APPLY__\s*=(?!=)/g) || []).length
  check('the theme bundle still publishes the seam once', published === 1, published)
}

section('(c) the narrowed pack.kit invariant: zero in the wizard\'s own blocks')
{
  const family = ['pack.kit', '.kit.teams', '.kit.automations', 'kit.themes']
  const wizard = (CORE === null ? '' : CORE) + (UI === null ? '' : UI)
  const hits = family.map((token) => ({ token, n: count(wizard, token) })).filter((h) => h.n > 0)
  check('KB-OB-CORE + KB-OB-UI contain no pack.kit / .kit.teams / .kit.automations / kit.themes (today: zero — the spec\'s meaning survives)', hits.length === 0, hits)
  check('the wizard still derives its kit from the pack\'s goals (kbObKitOf)', CORE !== null && /const kbObKitOf = \(pack, goalIds/.test(CORE))
}

section('(d) what a FILE-WIDE count says (evidence, not an assertion)')
{
  const family = ['pack.kit', '.kit.teams', '.kit.automations', 'kit.themes']
  const fileWide = family.map((token) => ({ token, n: count(client, token) })).filter((h) => h.n > 0)
  console.log('  · file-wide raw seam reads: ' + rawReads(client).length + ' (lines ' + rawReads(client).map((r) => r.line).join(', ') + ')')
  console.log('  · file-wide pack.kit family: ' + (fileWide.length === 0 ? '0' : JSON.stringify(fileWide)) +
    ' — all of it outside KB-OB (the marketplace\'s legitimate use), which is why a file-wide invariant can only be red on a merged tree')
}

console.log('\n' + (fail === 0 ? 'OK' : 'FAILED') + ' — ground 3, consumer-aware invariants (' + (pass + fail) + ' checks)')
process.exit(fail === 0 ? 0 : 1)
