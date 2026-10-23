#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// test-help-mounts — the A-14 / N-02 gate: a bundle that ships a help.json must
// put its help on screen.
//
// Measured on 2026-10-20/21 (audit A-14, then N-02): 18 interface bundles shipped
// a complete `help.json` (4-5 cards) and never mounted `window.__KB_HELP__.Help`,
// so their page had no « ? How it works » button at all — and the defect was
// reproduced by the newest bundle the same day it shipped (N-02). No test caught
// it: the cards were written, shipped and unreachable. This is that test.
//
// Two rules, on `packages/<bundle>/client.js` (the file the GUI serves):
//   1. PRESENCE — a bundle with a `help.json` renders `window.__KB_HELP__.Help`
//      (id = the bundle folder, or the folder plus a `page:` for a bundle that
//      owns several settings pages).
//   2. GATING — the mount sits behind the guard expression
//      `typeof window !== 'undefined' && window.__KB_HELP__ …`, so the factory
//      still evaluates when the help host is absent: a bundle must never stop DSH
//      from starting (AGENTS.md rule 2).
//
// EXEMPT exists for bundles that provably cannot (or must not) host the shared
// pill. Every entry carries the measurement that justifies it — an exemption
// without a reason is not an exemption, it is a hole. A new bundle is never
// exempt: rule 1 catches it.
//
//   node scripts/test-help-mounts.mjs            exit 0 = OK, 1 = offenders
//   node scripts/test-help-mounts.mjs --list     also prints the exemptions
// ═══════════════════════════════════════════════════════════════════════════════

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const packages = join(root, 'packages')

// The guard, whatever the quote style and the spacing.
const GATED = /typeof window !==\s*['"]undefined['"]\s*&&\s*window\.__KB_HELP__/

// Bundles whose help is already on screen without the shared component, or that
// cannot draw it at all. Each line carries its own CHECK, run against the file:
// an exemption is a measured property of the bundle, never a free pass that rots
// (Lead's arbitration, 2026-10-21).
const EXEMPT = new Map([
  ['kybernos-atlas', {
    reason: 'own help on the page: HelpDialog + a “How it works” button (client.js, kbat-help)',
    check: (source) => source.includes('HelpDialog') && source.includes('kbat-help'),
  }],
  ['kybernos-language', {
    reason: 'own help on the page: kbln-help-btn + HelpPanel (client.js, kbln-head-row)',
    check: (source) => source.includes('HelpPanel') && source.includes('kbln-help-btn'),
  }],
  // These three decorate a surface they do NOT own (a chat message's <cite>, the chat queue dock, other bundles' panels):
  // measured 0 role="dialog" and 0 settings.section each, so there is no header of their own to hang a pill on. The checks
  // assert exactly that: the day one of them grows a page or a dialog, the exemption fails and it owes the pill.
  ['kybernos-refs', {
    reason: 'decorates the <cite> of a chat message: no page, no dialog, no header of its own',
    check: (source) => source.includes('cite') && !source.includes('role="dialog"') && !source.includes('settings.section'),
  }],
  ['kybernos-flow', {
    reason: 'decorates the chat queue dock it does not create: no page, no dialog, no header of its own',
    check: (source) => source.includes('dock') && !source.includes('role="dialog"') && !source.includes('settings.section'),
  }],
  ['kybernos-miniapps', {
    reason: 'host/dock: it frames other bundles’ panels and owns no header (their panels carry their own help)',
    check: (source) => !source.includes('role="dialog"') && !source.includes('settings.section'),
  }],
  // No page and no DOM at all: the check is the absence of a mount point, so the day one of them starts drawing, the
  // exemption fails and the bundle owes the pill.
  ['kybernos-registry', {
    reason: 'headless: publishes a JS seam, draws no DOM (its card is shown on the Suite › Plugins page)',
    check: (source) => !source.includes('createElement') && !source.includes('document.body'),
  }],
  ['kybernos-relance', {
    reason: 'headless: watches /plugins/events and reloads the page, draws no DOM',
    check: (source) => !source.includes('createElement') && !source.includes('document.body'),
  }],
])

const list = process.argv.includes('--list')
// Comments mention the component too (and the hub, mobile and plugin pages explain
// it at length): only code lines count, or a comment would pass the presence rule.
const codeOf = (source) => source.split('\n').map((line) => line.replace(/\/\/.*$/, '').trim()).filter((line) => line !== '')

const offenders = []
const noClient = []
const exempted = []
const mounted = []

for (const name of readdirSync(packages).sort()) {
  if (statSync(join(packages, name)).isDirectory() !== true) continue
  if (existsSync(join(packages, name, 'help.json')) !== true) continue
  const client = join(packages, name, 'client.js')
  // A help.json without a client.js is data only (dsh-* helper bundles): the Suite
  // lists the module and its card; there is no page to mount anything in.
  if (existsSync(client) !== true) { noClient.push(name); continue }

  const code = codeOf(readFileSync(client, 'utf8'))
  const uses = code.filter((line) => line.includes('window.__KB_HELP__'))
  // Two accepted forms. React pages render the shared component; a page with no React tree draws the SAME card from
  // GET /kybernos-hub/suite, and says which folder it speaks for (`KB_HELP_ID`). It is gated on the host's presence too.
  const renders = code.some((line) => line.includes('window.__KB_HELP__.Help'))
  const domForm = code.some((line) => line.includes("KB_HELP_ID = '")) && code.some((line) => line.includes("'/kybernos-hub/suite'"))

  if (uses.length === 0) {
    const ex = EXEMPT.get(name)
    if (ex !== undefined) {
      // The reason is checked, not trusted: a bundle whose own help disappears, or that starts drawing a DOM, must come back
      // through rule 1.
      const source2 = readFileSync(client, 'utf8')
      if (ex.check(source2) === true) { exempted.push(name); continue }
      offenders.push(`${name}: exempt as "${ex.reason}" — but that is no longer true (mount the shared help instead)`)
      continue
    }
    offenders.push(`${name}: help.json is shipped, client.js never mounts __KB_HELP__.Help`)
    continue
  }
  if (renders !== true && domForm !== true) {
    offenders.push(`${name}: client.js talks to __KB_HELP__ but renders no help card (${uses[0].slice(0, 90)})`)
    continue
  }
  if (!uses.some((line) => GATED.test(line))) {
    offenders.push(`${name}: the __KB_HELP__ mount is not gated by "typeof window !== 'undefined'"`)
    continue
  }
  const named = code.some((line) => line.includes(`id: '${name}'`)) || (domForm && code.some((line) => line.includes(`KB_HELP_ID = '${name}'`)))
  if (!named) {
    offenders.push(`${name}: the help is mounted without naming "${name}" (id: or KB_HELP_ID) — the card would never be found`)
    continue
  }
  mounted.push(name)
}

if (offenders.length > 0) {
  console.error(`help mounts: ${String(offenders.length)} offender(s)`)
  for (const line of offenders) console.error('  ✗ ' + line)
  console.error('Rule: a bundle with help.json renders window.__KB_HELP__.Help, gated — see scripts/test-help-mounts.mjs')
  process.exit(1)
}

if (list) {
  console.log(`exempt (${String(exempted.length)}), with the reason:`)
  for (const name of exempted) console.log(`  · ${name} — ${EXEMPT.get(name).reason}`)
  if (noClient.length > 0) console.log(`data only, no client.js (${String(noClient.length)}): ${noClient.join(', ')}`)
}

console.log(`help mounts OK — ${String(mounted.length)} bundle(s) mount the help, gated; ${String(exempted.length)} exempt, ${String(noClient.length)} data-only`)
