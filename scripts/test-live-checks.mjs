#!/usr/bin/env node
// Guards the live checks (scripts/check-*-live.mjs) against two ways of going stale, without a browser:
//
//   node scripts/test-live-checks.mjs
//
// 1. A live check compares the page it opened (KB_HOST: a sandbox, most of the time) with what the host routes of THAT instance
//    return. A literal « http://127.0.0.1:3080 » in a check reads the real DSH instead and the two never agree (the Memory page
//    check failed 7 of 22 assertions on a fresh sandbox for this reason, 2026-10-12). Hosts come from KB_HOST / live.authority.
// 2. check-memory-live.mjs states where the page sits in the Settings nav. That order is owned by GROUPES in
//    packages/kybernos-plugin/client.js (it changed on 2026-10-11 and the check kept the old « right after Language »): the lists the
//    check holds must agree with GROUPES, so the next reordering fails here, in CI, and not on someone's sandbox.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
const words = (list) => list.split(',').map((w) => w.trim().replace(/^'|'$/g, '')).filter((w) => w !== '')

console.log('no live check reads its host routes from a fixed :3080')
{
  const files = readdirSync(join(ROOT, 'scripts')).filter((f) => /^check-.*-live\.mjs$/.test(f))
  check('there are live checks to look at', files.length > 10, files.length)
  const bad = []
  for (const f of files) {
    read('scripts/' + f).split('\n').forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return
      if (/['"`]http:\/\/127\.0\.0\.1:3080/.test(line) || /cookieDeSession\(\s*['"`]127\.0\.0\.1:3080/.test(line)) bad.push(f + ':' + String(i + 1))
    })
  }
  check('none names http://127.0.0.1:3080 or signs a cookie for it (use KB_HOST / live.authority)', bad.length === 0, bad)
}

console.log('the Memory page check follows the Settings nav grouping')
{
  const src = read('scripts/check-memory-live.mjs')
  const above = /const NAV_ABOVE = \[([^\]]*)\]/.exec(src)
  const below = /const NAV_BELOW = \[([^\]]*)\]/.exec(src)
  check('the check declares what sits above and below the page', above !== null && below !== null)
  const groupes = read('packages/kybernos-plugin/client.js')
  const g = /const GROUPES = \[\s*\{ titre: null, mots: \[([^\]]*)\]/.exec(groupes)
  const mots = g === null ? [] : words(g[1])
  check('GROUPES opens with the essentials (no header) and the page is in them', mots.indexOf('memory & lessons') >= 0, mots)
  if (above !== null && below !== null && mots.length > 0) {
    const rank = (label) => mots.indexOf(label.toLowerCase())
    const me = rank('Memory & Lessons')
    const up = words(above[1])
    const down = words(below[1])
    check('every label the check expects above the page is in the section, before it', up.length > 0 && up.every((l) => rank(l) >= 0 && rank(l) < me), up.map((l) => [l, rank(l)]))
    check('every label the check expects below the page is in the section, after it', down.length > 0 && down.every((l) => rank(l) > me), down.map((l) => [l, rank(l)]))
  }
}

console.log('the live-page helper opens the Settings menu\'s Advanced fold for the checks that click a page by its cell')
{
  const lp = read('scripts/live-page.mjs')
  check('openSettings opens the fold unless the check is about the fold (fold: \'keep\')', /if \(opts\.fold !== 'keep'\) await openAdvancedFold\(page\)/.test(lp) && /export async function openAdvancedFold\(page\)/.test(lp))
  check('a menu without the fold (an older core plugin) is not an error', /document\.querySelector\('\[data-kb-fold-toggle\]'\) !== null`, 3000\)\) === null\) return true/.test(lp))
  check('the check of the fold itself keeps it as it finds it', /openSettings\(page, \{ minCells: 3, fold: 'keep' \}\)/.test(read('scripts/check-settings-nav-live.mjs')))
}

console.log('the live-page helper clears the engine\'s first-screen dialog (A3-03)')
{
  // A fresh sandbox opens DSH's « Get started » dialog over every page. DSH 0.2.1-alpha.4 dropped its « Configure later »
  // button: the dialog only has a Close cross, labelled « Close ». The helper's injected script is run here against a stub page.
  const { KEY_DIALOG_SCRIPT } = await import('./live-page.mjs')
  check('the helper exports the script it injects', typeof KEY_DIALOG_SCRIPT === 'string' && KEY_DIALOG_SCRIPT.length > 0)
  // A stub page: the helper asks for the dialog, then for its Close button; `withDialog` says whether the page has one.
  const run = (withDialog) => {
    const clicked = []
    const cross = { click: () => clicked.push('close') }
    const dialog = { querySelector: (sel) => (sel === "button[aria-label='Close']" ? cross : null) }
    let tick = null
    const doc = {
      querySelector: (sel) => (withDialog && sel === "[role=dialog][aria-label='Get started']" ? dialog : null),
      querySelectorAll: () => [],
    }
    new Function('document', 'MutationObserver', KEY_DIALOG_SCRIPT)(doc, class { constructor(cb) { tick = cb } observe() { tick() } })
    return clicked
  }
  const engineNow = run(true)
  check('DSH 0.2.1-alpha.4: the Close cross of the « Get started » dialog is pressed', engineNow.length === 1 && engineNow[0] === 'close', engineNow)
  const none = run(false)
  check('nothing on the page, nothing pressed', none.length === 0, none)
}

console.log('the live checks do not go stale on the things the audit found moving (WP-21)')
{
  const theme = read('scripts/check-theme-live.mjs')
  check('check-theme-live finds the tabs of the Theme page by their name, never by a number (a tab inserted in the middle moved every index)',
    /const TAB = Object\.fromEntries\(TAB_IDS\.map/.test(theme) && !/goTab\(\d/.test(theme) && /icones: \/\^\(ic/.test(theme))
  check('… and does not hold the size of the example catalogue as a constant', !/cards\.length === 14/.test(theme) && /nExamples/.test(theme))
  const queue = read('scripts/check-queue-move.mjs')
  check('check-queue-move is skipped, with the reason, on an engine that retired the patch (and says SKIPPED)', /motifDeRetrait\(entree, version\)/.test(queue) && /SKIPPED: the queue-move engine patch check/.test(queue))
  const faults = read('scripts/check-bundle-faults.mjs')
  check('check-bundle-faults knows the core by its package name, its log tags and its /kybernos/* routes (not by the directory name)',
    /const packageName = /.test(faults) && /const ownTags = /.test(faults) && /seg !== 'kybernos'/.test(faults) && /dirTail\(b\) === 'kybernos-plugin'/.test(faults))
  check('… and judges the routes after waiting for them, not after a fixed delay', /Date\.now\(\) - t0 < 12000/.test(faults))
  const probes = /const PROBES = \[([\s\S]*?)\]\n/.exec(faults)
  check('… with no probe on the dead routes of an older version (/kybernos/state answered 404, so the core\'s own loss was never seen)', probes !== null && !/'\/kybernos\/state'/.test(probes[1]) && /'\/kybernos\/onboarding'/.test(probes[1]))
  const usage = read('scripts/check-usage-live.mjs')
  check('check-usage-live reads the price in the format of the interface language (« 0,04 $ » in French, « $0.04 » otherwise)', /frenchAmounts/.test(usage) && /\\\$\\d\\\.\\d\\d/.test(usage))
  const helpLive = read('scripts/check-help-live.mjs')
  check('check-help-live compares each card with the text its own host serves and says which source that is', /\/kybernos-hub\/suite/.test(helpLive) && /text compared with: /.test(helpLive) && /closest\('button, \[role=button\]'\)/.test(helpLive))
  check('check-icons-live waits for the Suite cards, not for a fixed delay', /waitFor\(page, `document\.querySelectorAll\('\[data-kb="suite-card"\], \[data-kb="suite-row"\]'\)\.length > 0`/.test(read('scripts/check-icons-live.mjs')))
  const footer = read('scripts/check-footer-live.mjs')
  check('check-footer-live waits by event: press waits for its target, the reload waits for the NEW page, a recorded click is waited for', /const until = async/.test(footer) && /window\.__kbStale === undefined/.test(footer) && /\(await openedCount\(\)\) > n/.test(footer))
  check('check-automations-board-live holds the board request until it has looked at the skeleton (no timed hold)', /held\.push\(p\.requestId\)/.test(read('scripts/check-automations-board-live.mjs')) && !/holdMs/.test(read('scripts/check-automations-board-live.mjs')))
  const display = read('scripts/check-display-live.mjs')
  check('check-display-live lists every view it could not measure as SKIPPED, and --strict fails on them', /console\.log\('SKIPPED: ' \+ m\.size/.test(display) && /findings\.length > 0 \|\| missing\.length > 0/.test(display))
  const callTeam = read('scripts/check-call-team-live.mjs')
  check('check-call-team-live clicks the tab that holds the member cards (Roles), not a tab that is gone', /const MEMBERS_TAB = 'Roles'/.test(callTeam) && !/clickText\('Team'\)/.test(callTeam))
  check('the language checks open the test-marks fold before they read or press anything in it', /openPseudoFold/.test(read('scripts/check-language-run-live.mjs')) && /ownTextCount/.test(read('scripts/check-language-live.mjs')))
  check('the Skills checks open Yours first (the page opens on Featured)', /openYours/.test(read('scripts/check-skills-detail-live.mjs')) && /openYours/.test(read('scripts/check-skills-codes-live.mjs')) && /\/\^Team\//.test(read('scripts/check-skills-team-live.mjs')))
}

console.log('a skip is never mistaken for a pass: every test that skips says « SKIPPED: » (A6-16)')
{
  const files = []
  for (const dir of ['scripts', ...readdirSync(join(ROOT, 'packages')).map((d) => 'packages/' + d)]) {
    try { for (const f of readdirSync(join(ROOT, dir))) if (/^test.*\.mjs$/.test(f)) files.push(dir + '/' + f) } catch (e) { /* no such folder */ }
  }
  const vague = []
  for (const f of files) {
    read(f).split('\n').forEach((line, i) => {
      if (/console\.(log|warn|error)\(.*skip/i.test(line) && !/SKIPPED/.test(line)) vague.push(f + ':' + String(i + 1))
    })
  }
  check('no test prints « skipped » without the word SKIPPED in capitals (so a grep for it finds every skip)', vague.length === 0, vague)
  const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')
  check('the CI keeps the output of its test loops and ends with the list of what did not run', /test-output\.log/.test(ci) && /SKIPPED SUMMARY/.test(ci) && /if: always\(\)/.test(ci))
  for (const f of ['scripts/test-suite-gui.mjs', 'scripts/test-workers-gui.mjs', 'packages/kybernos-theme/test-client.mjs', 'packages/kybernos-cloud/test-cloud-client.mjs', 'packages/kybernos-call/test-agent-meta.mjs']) {
    check(f + ' says SKIPPED when it skips', /SKIPPED:/.test(read(f)))
  }
}

console.log('the Featured cover check expects what the host serves, not what is on this disk (A3-05)')
{
  // On a sandbox the host serves a cover for picks that have no file in the sandbox's home (24 drawn, 15 on disk): the check compared the
  // drawn covers with the files on disk and failed there. It expects the covers the picks answer lists (the host's own when it has the route).
  const src = read('scripts/check-skills-featured-live.mjs')
  const m = /const withCover = ([^\n]*)\n/.exec(src)
  check('the number of covers to expect is read from the picks answer the page is shown', m !== null && /shownPicks\.items\.filter/.test(m[1]), m === null ? null : m[1])
  check('...and the answer is the host\'s own when the host serves the route', /const shownPicks = hostHasPicks === true \? hostPicks : picksAnswer/.test(src))
}

console.log('\n' + (failed === 0 ? 'ALL GREEN' : String(failed) + ' FAILED'))
process.exit(failed === 0 ? 0 : 1)
