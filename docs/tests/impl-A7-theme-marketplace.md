# impl-A7-theme-marketplace — implementation report

| | |
|---|---|
| Batch | `A7-theme-marketplace` — the Themes **listing** over A6's catalogue route |
| Spec | `docs/tests/A7-theme-marketplace-strategy.md` (revision 3; M1-M9 applied, treated as validated) |
| Lane | **B — standard** (unchanged: no route, no guard, no reader, no write) |
| Verdict | **pass** — D1-D7 exit 0, the suite is 47/47, and **A7 adds no red**: the full suite is back to the twelve pre-existing reds. Two residues to ratify (D8's grep, four table rows) — see "Verdict detail" |
| Measured | 2026-10-28, 06:15-06:40 (Europe/Paris), worktree `/Users/miled/kybernos-projects/kybernos-plugins`, HEAD `e7fd5427` |
| Committed? | **No.** The Lead commits. |

> **The worktree was not clean when I started, and A6 was being implemented in the same tree at the same time.**
> At 06:15 the tree already carried four tracked modifications (`.claude/skills/ux-bug-hunter/probes.js`,
> `packages/kybernos-composio/cordis.patch.yml`, `scripts/check-hit-targets-live.mjs`, `scripts/check-ux-probes.mjs`) and
> ~28 untracked artifacts. **A6's implementation appeared in the tree while I was writing**: `theme-installer.mjs` at 06:21,
> its `client.js` block at 06:23, its route in `index.js` at 06:33, and one more `client.js` write at 06:37 (which invalidated
> one of my edits mid-flight — re-read, re-applied). Every number below says when it was measured, and the reds that are not
> mine are attributed to A6 by file and line.

## Verdict detail

- **The batch is implemented and adds no red**: D1-D7 exit 0, the new suite is 47/47 green, and the two regression commands
  are back to the spec's pre-existing reds (§Regression gate: full suite **12 RED**, plugin subset **2 RED**, exactly the ones
  the spec attributes).
- **D8 cannot go green as written** (spec defect, not an implementation gap): its grep
  `grep -l 'verifyCatalogue' packages/*/*.mjs` counts **every** `.mjs` in the package, and A6's own unit test
  (`packages/kybernos-plugin/test-theme-installer.mjs`, 12 occurrences) legitimately calls the verifier, so the count is 2
  where the spec expects 1. The spec was measured before A6's test existed ("0 modules" at `2ac67fb4`). Excluding test files,
  D8's three substantive assertions all hold (§DoD, D8).
- **Perimeter residue to ratify**: adding a Settings page in this repo mechanically requires **more touch points than the
  spec's M2 grant lists** — `KB_SS_INDEX` + `KB_SS_FR` rows in `client.js`, one name row in `scripts/test-settings-names.mjs`
  and one in `scripts/test-signposts.mjs`. Without them the batch adds **two settled reds** (`test-settings-search.mjs`,
  `test-settings-names.mjs`) plus a third failure inside `test-signposts.mjs` (already red). I added the four entries and
  report them as a **spec gap** (the Lead may veto: each is one line, revertible in seconds, and the price is the named red).
- **Not done, and said so**: the maquette (`docs/handoff/theme-market/maquette-v1/`), the eight vision captures and the e2e
  journey E1-E5. Reasons in "What is not done".

## Files touched

| File | Nature | Lines |
|---|---|---|
| `packages/kybernos-plugin/client.js` | two marked blocks (**pure** `KB-MARKET-PURE-BEGIN/END` 30377-30603, **UI** `KB-MARKET-UI-BEGIN/END` 30605-30741 at 06:40) + the three granted venue rows + two search-index entries | +368 added lines (both blocks and rows), 1 line replaced (`GROUPES` look row) |
| `packages/kybernos-plugin/test-theme-market.mjs` | **new** — the unit layer (the 7 pinned titles + 40 more checks) | 212 lines |
| `packages/kybernos-plugin/README.md` | the two hunks M6 assigns to this batch: the sidebar sentence (`:15-18`) gains the **Themes** page, the Settings sentence (`:23`) gains **Themes** | 2 insertions, 2 deletions |
| `scripts/test-settings-names.mjs` | **out of the declared perimeter** — one row in its `NAV` table (`'kybernos-themes-market': 'Themes'`), required by its own rule "a page added to the menu is added here" | +2 lines (row + comment) |
| `scripts/test-signposts.mjs` | **out of the declared perimeter** — one row in `PLACES` (`themes: ['thèmes', 'temas']`), required by "every page of the menu is in PLACES" | +1 line |

Current lines of the five additions in `client.js`: `KB_NAV_KEYS` row 3031, `KB_SS_INDEX` row 3170 (`KB_SS_FR` twin 3268),
`GROUPES` look row 34875, `ICONES` drawing 34908.

No new bundle, no route, no reader, no catalogue path, no document `kind`, no point, no permission, no `plugin.json` line, no
engine patch, no `dsh-compat.json`, no data file, no `catalog/**`, no media, no `index.js` hunk (A6's route landed there, not
mine — `git diff` shows `packages/kybernos-plugin/index.js` because of **A6's** commit-in-progress).

## The implementation, in the spec's terms

**The pure block** (imported alone by the suite, the `KB-OB-CORE` idiom): `marketCards` (A6's answer → cards, in the answer's
order, manifest words verbatim, `level` copied, `yanked`/`revoked`/`unlisted` and id-less/version-less entries dropped),
`LEVELS`/`LEVEL_LABEL`/`LEVEL_HELP` (Official / Verified / Community / Local development, both languages, unknown level shown
raw), `kitLine` (plural per language, zero omitted, « Adds no kit yet »), `marketState` + `marketLeftOut` + `marketRefusals`
(three distinct states, the verifier's own codes, `null` when a card exists, `null` on a failed read), `marketInstallable`
(`id` + `version` + `archive.sha256`; refused for yanked/revoked), `marketInstall` (one call,
`{ source: 'catalogue', id, version }`, `no-installer`/`refused`/`incomplete`/`installer-failed`, never throws, attaches a
`catch` to A6's async answer), `marketReport` (the plan's style `{ id, acc }`, the kit sentence, added/skipped/failed, an item
without a name dropped). No React, no fetch, no `window`, no hashing — proven by the suite and by D2.

**The UI block**: ONE component `KbThemesMarket` (host shell + `kbtm-*` classes, controls `kbm-btn`), one read of
`fetch('/kybernos/themes', { credentials: 'same-origin', cache: 'no-store' })` on mount and once after a click, `data-level` on
each card, `kb-market-install` disabled when the entry is not installable, when the seam is absent or while a click runs, the
reason as a quiet line, `kb-market-state` with `data-state`, the left-out line with the codes on demand, the report after the
answer (style swatch from `settings.acc`, kit sentence, counts). Registered as `settings.section`
`id: 'kybernos-themes-market'`, `order: 30`, `label: marketSay(['Thèmes', 'Themes'], …)`, inside `try/catch`. A6 draws the block
inside its `Themes` page; the same component is the Settings section (INT1).

## DoD before → after

Run from the tree root, commands copied from the spec (D2's inline script kept byte-for-byte).

| # | Before (06:17) | After (06:35) |
|---|---|---|
| D1 | exit 1 — `FAIL: no KB-MARKET-PURE block (the listing's pure helpers) in packages/kybernos-plugin/client.js` | **exit 0** |
| D2 | exit 1 — `FAIL: no KB-MARKET-PURE block in packages/kybernos-plugin/client.js (the level must be read from the route)` | **exit 0** — `D2 ok` |
| D3 | exit 1 — `FAIL: … registers no settings section 'kybernos-themes-market' (the listing's Settings entrance, M2)` | **exit 0** |
| D4 | exit 1 — `FAIL: the listing does not read A6's GET /kybernos/themes` | **exit 0** — `D4 ok` (A6's `path: '/kybernos/themes'` landed in `index.js` at 06:33; before that, the same command failed on that one count only) |
| D5 | exit 1 — `FAIL: KB_NAV_KEYS has no title for 'kybernos-themes-market'` | **exit 0** — `D5 group ok` |
| D6 | exit 1 — `FAIL: no state block (kb-market-state) in packages/kybernos-plugin/client.js` | **exit 0** |
| D7 | exit 1 — `FAIL: no Install action (kb-market-install) in packages/kybernos-plugin/client.js` | **exit 0** |
| D8 | exit 1 — `FAIL: the signed catalogue is verified in 0 modules (one expected: …/theme-installer.mjs, A6's)` | **exit 1 — SPEC DEFECT**: `FAIL: … verified in 2 modules` (A6's `test-theme-installer.mjs`). Substantive assertions pass: `1` module verifies tests excluded; `packages/kybernos-hub/theme-market.mjs` absent; 0 code files name `/kybernos-hub/themes`; 0 name `kybernos/themes/catalogue.json`. |

The spec's own failure strings matched on the first run, so **no spec-error was returned for D1-D7**.

`packages/kybernos-plugin/test-theme-market.mjs`: **47 verifications, 0 failures**, including the seven titles the DoDs grep
(all present, verified with `grep -qF`).

## Regression gate (measured, never assumed)

Final measurements, 06:37-06:40, after A6's last `client.js` write (06:37) and its route (06:33).

| Command | Spec baseline (`3efbdfdb`) | After this batch (06:40) | Who moved it |
|---|---|---|---|
| `node scripts/run-all-tests.mjs` | 530 files, 518 green, 12 RED | **532 files in 180 s: 520 green, 12 RED, 1 flaky** | the 12 are **exactly the spec's twelve**; +2 files are my suite and A6's, both green; the flaky is A6's `test-kyber-root.mjs` (red in the parallel run, `13 ✓ 0 ✗` alone — A6 brought `home: true` back to 1 between its two writes) |
| `node scripts/run-all-tests.mjs --only kybernos-plugin` | 118 files, 116 green, 2 RED (menu-icons, settings-nav) | **120 files in 21 s: 118 green, 2 RED** — the same two | unchanged (my suite + A6's are the two extra files, both green) |
| `packages/kybernos-plugin/test-settings-nav.mjs` | 44 verifications, 1 failure (`kybernos-log`) | **44 verifications, 1 failure** — the same `kybernos-log` | unchanged |
| `packages/kybernos-plugin/test-settings-icons.mjs` | green | **8 ✓ 0 ✗** (the `themes` drawing is new, no page shares it) | unchanged |
| `packages/kybernos-plugin/test-settings-search.mjs` | green | **82 verifications, 0 failures** — after the two index rows I added | was red (my page without a row), fixed |
| `node scripts/build-catalog.mjs --check` | 0 — `✓ catalogue up to date (48 modules)` | **0** — the same line | unchanged |
| `node scripts/garde-depot.mjs` | 0 — 1984 tracked files, 1 warning | **0** — 1991 tracked files, 0 errors, 1 warning (the same personal path in `docs/tests/gate-verdicts-final.md`) | unchanged |
| `node scripts/test-no-french-literals.mjs` | 2 ✗ | **3 ✗** — the 3rd is **A6's** (`client.js:26446`, « vos sessions, votre mémoire » in its theme copy). A7's own additions: **0 French literals outside a dictionary, 0 « vous » forms** (measured by diffing `frenchOutsideDictionary` / `vousFormsOfSource` between `HEAD:client.js` and the tree) | A6 |
| `node scripts/test-consistency-guards.mjs` | 1 failure (deepStrictEqual, `kybernos-log`) | **the same single failure** (`A1-16 … kybernos-log 1 (allowed 0)`) | unchanged; my `kbtm-*` prefix passes A1-04, A1-13 and A1-14 |
| `node scripts/test-settings-names.mjs` | green | green (**9 ✓ 0 ✗**) after its `NAV` row | was red without the row |
| `node scripts/test-signposts.mjs` | red (1 failure) | red (**14 ✓ 1 ✗**) — the same pre-existing failure; the extra failure my nav key caused is fixed by the `PLACES` row | unchanged |
| `packages/kybernos-plugin/test-menu-icons.mjs` | red (1 failure) | red (**2 failures**) — A6's `row('themes', …)` has no icon-set entry, on top of the pre-existing `projects`/`documents` drift | A6 for the extra one |

**One measured side effect worth knowing**: `test-settings-nav.mjs`'s "the observer also hears the page change (aria-current)"
reads a **fixed 24 000-character window** from `const GROUPES = [`. My first ICONES drawing (188 chars) pushed that observer
from offset 23 802 to 24 001 and reddened the check by **one character**. The shipped drawing is 84 chars
(`<path d="M4 6h16M4 12h6M4 18h6M17 14v8M13 18h8">`), leaving offset 23 897 — margin 67. This is a coupling of the repo's own
test, not of the product; it is recorded so the next ICONES addition does not discover it the hard way.

## Perimeter proof

`git diff --name-only` (06:40), minus the four modifications that predate this batch:

```
packages/kybernos-plugin/README.md            ← mine (M6's two hunks)
packages/kybernos-plugin/client.js            ← mine + A6's hunks (same file, M2)
scripts/test-settings-names.mjs               ← mine, OUT of the declared perimeter (1 row)
scripts/test-signposts.mjs                    ← mine, OUT of the declared perimeter (1 row)
packages/kybernos-plugin/index.js             ← A6's route (not mine: my diff has no index.js hunk)
```

Untracked: `packages/kybernos-plugin/test-theme-market.mjs` (mine), `theme-installer.mjs` + `test-theme-installer.mjs` (A6's).

**The two venue sets, measured on the file as it stands** (`/tmp` script over `git diff -U0`, new-file line numbers):

- A7's marked spans: `KB-MARKET-PURE` 30377-30603, `KB-MARKET-UI` 30605-30741 (at 06:40; A6 wrote `client.js` again at 06:37 and the numbers move). A6's: `KB-TH-CORE` 25836-26036.
- **A6 lines inside an A7 block: 0. A7 lines inside A6's block: 0.**
- A7's three granted rows, each exactly once in the diff: `'kybernos-themes-market': 'themes'` (KB_NAV_KEYS),
  `mots: ['theme', 'themes', 'langue', 'language']` (the look group, 1 line replaced, its old text removed),
  `'themes': '<path d="M4 6h16…` (ICONES). Plus the two search-index rows the gate forced (§Verdict detail).
- A6's lines, untouched by me: `if (s.view === 'themes') return h(KbThemesView, props)`, `row('themes', Icon('layers', 15)…)`, and
  its `Object.defineProperty(kbOpenPage, 'views', …)` rewrite (the only `-` line in the diff I did not write).
- Removed lines in the whole diff: 4 — two are my append artifacts (`['about', …]` and `'about|Version'`, re-emitted because I
  appended after them), one is my `GROUPES` row, one is **A6's** `views` line. I removed nothing of A6's.
- No A7 block sits inside a `KB-OB` block (both precede `KB-OB-CORE`), asserted by the suite.

## Drifted anchors (verified against the current file, not the pin)

| Spec pin (at `2ac67fb4`) | Current file | What I verified instead |
|---|---|---|
| `KB_NAV_KEYS` at `:3005-3016` | `:3021-3032` at 06:20 (my row at `:3031`) | read the block, added the row inside it |
| `GROUPES` at `:33662`, look `mots` at `:33675` | `:33861` / `:33876` at 06:20, `:34875` at 06:40 | read the look row, replaced only its `mots` |
| `ICONES` at `:33696` | `:33895` at 06:20, `:34908` at 06:40 | read the table, added `'themes'` before `'mon espace'` |
| Settings-section idiom at `:29690-29692` | `:29741-29743` (then shifted by A6) | copied its exact shape, `ctx.effect` + `slots.register` |
| `KB_SS_INDEX` at `:3054` (spec's OUT OF SCOPE) | `:3072` (table 3072-3188) | read it; **see the spec/gate conflict** |
| `scripts/test-onboarding.mjs:14-18` extraction idiom | unchanged | reused verbatim in the new suite |
| A6's route "lands first" | A6 landed **during** this batch (route in `index.js` at ~06:40) | D4 re-run after it; my code names the route, never parses a document |

## What is not done, and why

1. **The maquette** (`docs/handoff/theme-market/maquette-v1/`) — the spec puts it *before* the code and makes it *validated by
   the owner against the shipped pages*. It does not exist in the tree (`docs/handoff/theme-market/` absent) and no capture can
   validate it here without that review. I did not draw a mockup nobody asked to validate; it is the one deliverable of the file
   table I am not shipping, and it is called out rather than implied.
2. **The eight vision captures** (V1-V8) and **the e2e journey** (E1-E5) — they need the live GUI (sandbox, signed cookie) and
   A6's page. E1's step "Install from a local catalogue source" also needs the sandbox profile restored afterwards. Reported as
   not played, not as passed.
3. **`node scripts/check-bundle-faults.mjs --only kybernos-plugin --faults throw-apply`** (E3) — not run: the batch's two blocks
   are guarded (`try/catch` around the registration and the CSS insert, `marketInstall` never throws), and the fault gate is a
   live-server pass that belongs with the e2e above.

## What the Lead has to decide

1. **D8's grep** — amend it to `… | grep -v '/test-'` (the verifier's unit test legitimately names `verifyCatalogue`), or accept
   D8 red with this report. This is a spec fix, not a code change.
2. **The four out-of-perimeter lines** (2 search-index rows in `client.js`, 1 `NAV` row, 1 `PLACES` row) — ratify them, or veto
   each and take the red it re-opens (`test-settings-search.mjs`, `test-settings-names.mjs`, `test-signposts.mjs`).
3. **A6's remaining reds are not mine** (measured at 06:40): one of `test-menu-icons.mjs`'s two failures ("`themes` has no
   icon-set entry" — A6's `row('themes', …)`) and the third failure of `test-no-french-literals.mjs`
   (`client.js:26446`, « vos sessions, votre mémoire » in A6's theme copy). A6's `test-kyber-root.mjs` red is **fixed on its
   side** (`home: true` back to 1; the file is green alone, and it was flagged flaky by the parallel run).
4. **Concurrency**: A6 and I wrote `packages/kybernos-plugin/client.js` at the same time (A6 at 06:23, then 06:37; the 06:37
   write invalidated one of my edits mid-flight — re-read and re-applied). Both batches spliced by **anchor**, never by line
   number, and both blocks are intact as of 06:40 (A6's `KB-TH-CORE` 25836-26036, my `KB-MARKET-PURE` 30377-30603 and
   `KB-MARKET-UI` 30605-30741, zero line of one inside the other). Before merging, re-read the two venue sets once more; the line
   numbers in this report will move again.

## Reproduce

```bash
cd /Users/miled/kybernos-projects/kybernos-plugins
node packages/kybernos-plugin/test-theme-market.mjs          # 47 verifications, 0 failure(s)
# the eight DoD blocks are copied verbatim from §DoD of the strategy file (D2's inline script included)
node scripts/run-all-tests.mjs --only kybernos-plugin        # 120 files, 118 green, 2 RED (the two pre-existing)
node scripts/run-all-tests.mjs                               # 532 files, 520 green, 12 RED, 1 flaky (A6's, green alone)
```

