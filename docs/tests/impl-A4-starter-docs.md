# A4-starter-docs — implementation report

Batch: `A4-starter-docs` (spec `docs/tests/A4-starter-docs-strategy.md`, rebuilt in one voice under the campaign's
binding readings D2/D3; its gate defect fixed at `56edd341`, treated as validated).
Lane: **B (standard)** — a page, a copyable template folder, a read-only report tool and its own test.
Tree: shared worktree, HEAD `3efbdfdb` when the batch opened.

## Verdict

**pass**, with **two measured spec defects** that no implementation could clear, both recorded below rather than
smoothed over:

1. **`D9` cannot exit 0 as written** — its last command is the `for` loop, so the script's exit status is the failure
   status of the *last* variant, which must fail. The intent is proven green (7/7 variants exit 1, and the same
   assertion with the loop ending on success exits 0; negative control included).
2. **`D11` was already green before the batch opened** (A1/A2 landed at `3efbdfdb`). It is a *precondition* of the
   spec ("the five points … are actually declared (A1/A2 landed)"), it reads `packages/**` — which this batch may
   not write — so it can never discriminate A4's work. The spec's blanket claim "all 23 assertions exit 1" predates
   the commit of the upstream batches.

Everything A4 itself delivers is green: **18 of 19 DoD lines exit 0**, the nineteenth is the defective `D9` whose
intent is measured green, the unit test prints **52 passed, 0 failed**, and the full suite goes from 12 red to
**12 red, none of them this batch's** (attributed below, with the failing line of each).

## ROOT CAUSE

Not applicable — **lane B**. No auth, billing, RLS, migration or secret surface is touched; the batch adds two
read-only scripts, one Markdown page and a folder of sample data, and writes neither `packages/**` nor any runtime.

## Files touched

| Path | Kind | What it carries |
|---|---|---|
| `docs/dev/sector-bundles.md` | **new** | the page, H1 "Build a theme": the four build-contract sections, the five frozen interfaces, one complete `plugin.json`, the starter walkthrough, the broken-variant table, the install loop, the "not built" list |
| `docs/dev/templates/acme-vet-clinic/` | **new, 24 files** | the starter (8 files) and the seven broken variants (16 files): `plugin.json` (`acme/vet-clinic`, five `extends`, `requires.plugins` covering all three owners, no `provides`), `package.json` (no `dsh`, no `scripts`, no `bin`), `domains/vet-clinic.json`, `themes/vet-clinic.json` (light shape), `skills/consult-notes/SKILL.md`, `teams/clinic-desk.json`, `automations/morning-reminders.json`, `README.md`, and `broken/01…07` |
| `docs/dev/domain-packs.md` | edited (head + 2 rows) | head link to the page; the theme row now cites `applyPreset` (no longer "next"); the skills row names `kybernos/skills#skill` (the "cannot bundle skills yet" dead end is gone) |
| `docs/dev/plugin-contract.md` | edited (head, point table, section 11) | head link; the four landed points say `opened 2026-10-28`; `dashboards#preset` says **not built**; the two stale `<DSH home>/kybernos/plugins/<author>/<name>/` claims now read the real location (`profiles/web` + `node_modules/`); section 11 names the real CLI, the real check ids and what is not built |
| `scripts/plugin-check.mjs` | **new** | the read-only checker: one report, 13 check ids, exit 0/1/2 |
| `scripts/test-plugin-check.mjs` | **new** | U1–U18 + E1, hermetic (mkdtemp only) |
| `docs/tests/impl-A4-starter-docs.md` | **new** | this report (the delegation's artifact, outside the batch's write perimeter by design) |

## DoD — before → after

Every line was extracted verbatim from the spec into `/tmp/a4dod/D<n>.sh` and run from the repository root **before
any write** (`/tmp/a4dod/before.log`) and again after the last one (`/tmp/a4dod/after.log`).

| # | Before (exit) | After |
|---|---|---|
| D1 the page exists | 1 (`test -f` on a missing file) | **0** |
| D2 both specs link it | 1 (no `sector-bundles.md` in either) | **0** |
| D3 the four build-contract rules | 1 (page missing) | **0** |
| D4 five rows keyed by the point ids | 1 (page missing) | **0** — 5 rows |
| D5 the starter manifest, text-only folder | 1 (no `plugin.json`) | **0** |
| D6 no personal path | 1 (page missing) | **0** |
| D7 no `dsh` key in its `package.json` | 1 (no file) | **0** |
| D8 the starter passes the tool | 1 — `Cannot find module '…/scripts/plugin-check.mjs'` | **0** — `summary: 13 pass, 0 fail, 5 skip — exit 0` |
| D9 every variant fails, one exists | 1 (`find` on a missing folder) | **1 — defective line, see §1** (intent green: 7/7 variants exit 1) |
| D10 the same checks on `packages/kybernos-theme` | 1 — `Cannot find module '…/plugin-check.mjs'` | **0** — `summary: 8 pass, 0 fail, 4 skip — exit 0` |
| D11 the five points are declared | **0 — already green** (A1/A2 at `3efbdfdb`), see §2 | **0** |
| D12 the tool's own test | 1 — `Cannot find module '…/test-plugin-check.mjs'` | **0** — `PLUGIN CHECK — 52 passed, 0 failed` |
| D13 no bundle declared, no catalogue drift | 1 (`plugin.json` missing, so the line stopped before the catalogue) | **0** — `catalogue up to date (48 modules)` |
| D14 no scan exemption | 1 (`plugin.json` missing) | **0** |
| D15 the theme row cites a seam that exists | 1 — the row still said `| next |` | **0** |
| D16 the skills row names the point | 1 — `A plugin pack cannot bundle skills yet` still there | **0** |
| D17 the four landed points + honest `dashboards#preset` | 1 — `grep -c` = 0, `not built` absent | **0** — 4 rows, `not built` present |
| D18 the scan-folder wording | 1 — the doc carried `kybernos/plugins/<author>/<name>` while the code has no such path | **0** |
| D19 the conformance section names the CLI | 1 — no `plugin-check.mjs` | **0** |

Each red line was red **for the reason it states** before any write (the whole block was run first, one command per
sub-shell); nothing was coded before that capture. The starter's report is byte-identical to the spec's frozen
sample (`diff` on lines 590-610 of the spec: no output).

### 1. `D9` is defective as written (measured, not claimed)

```bash
set -e; V=docs/dev/templates/acme-vet-clinic/broken
test -n "$(find "$V" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)"
for d in "$V"/*/; do node scripts/plugin-check.mjs "$d" >/dev/null && exit 1; done
```

- The `for` loop is the script's **last command**. When the last variant behaves as required, `node` exits 1, the
  `&&` branch does not run (exempt from `set -e`), and the loop's status — hence the script's — is **1**.
- **Measured**: 7/7 variants exit 1 one by one, and the line still exits 1 (`bash -x` shows all seven runs and no
  `exit 1` branch taken). No implementation can make this line green while the requirement holds.
- **The intent, measured**: the same assertion written so the loop ends on success exits 0, and its negative control
  (a passing folder in the list) exits 1:

```bash
set -e; V=docs/dev/templates/acme-vet-clinic/broken
test -n "$(find "$V" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)"
for d in "$V"/*/; do node scripts/plugin-check.mjs "$d" >/dev/null || continue; exit 1; done   # exit 0
```

Plus unit **U4** (each variant: exit 1, exactly one `FAIL`, the expected id) and **U5** (a variant outside the
expectation table fails the test). The one-word fix belongs to the spec's owner (`|| continue` before `exit 1`); the
batch's file list does not include the spec, so it was not edited.

### 2. `D11` was already green, and cannot discriminate this batch

`D11` reads `packages/*/plugin.json` `provides[]` and asks for the five point ids. A1 (theme), A2-pack-format
(two core templates) and A2-registry-points (skills) landed at `3efbdfdb`, so the line exited **0** at 04:51, before
this batch wrote a character. It is the spec's own precondition (`# D11 … (A1/A2 landed)`), it lives entirely outside
A4's perimeter (`packages/**` is forbidden), and it is the **only** line of the nineteen that was green before.
18 of the 19 were red; the spec's paragraph "all 23 exit 1" was measured before the upstream commit and no longer
holds. Nothing in the batch was weakened to accommodate it.

## The tool (`scripts/plugin-check.mjs`) — what it decides

`node scripts/plugin-check.mjs <folder>`; exit 0 = no `FAIL`, 1 = at least one, 2 = the command line (no argument,
two arguments, a missing path, a file). One report, fixed order, no timestamp, no path beyond the argument given.

- **The 13 check ids** (contract sentence 3, closed vocabulary): `manifest.present`, `manifest.json`,
  `manifest.schema`, `manifest.rules`, `manifest.points`, `package.data`, `point.<name>` (one per `extends`, in
  manifest order), `code.scan`, `claims.unique`, `help.card`, `compat.zone`, `hygiene`, `archive`. `PASS`/`FAIL`
  print in check order, the `SKIP` lines follow, each with its reason; an unknown sub-folder is named by a `SKIP`
  line (`broken/`), never as a check and never as a failure.
- **Imports only, no copy** (U17): `manifestErrors` + the schema (`scripts/plugin-manifest.mjs`,
  `scripts/schema-subset.mjs`), `dataPackageProblems`/`readBounded`/`LIMITS` (`packages/kybernos-registry/registry.mjs`),
  `compareVersions`/`satisfies` (`version.mjs`), the owners' own validators (`DOMAIN_POINT`, `THEME_POINT`,
  `TEAM_POINT`, `AUTOMATION_POINT`), `validateTeamSkill` for the folder point, `scanText`/`uncovered`
  (`scripts/plugin-scan.mjs:57`, `:109`), `isScanned`/`warningsOf` (`scripts/garde-depot.mjs:28-42`). Its own source
  has no `#rrggbb` test, no theme key list, no cron parser (U17), and `scanText` on it shows no `net`, `exec` or
  `fsWrite` evidence (U7).
- **Never writes** (U6/U15): every file of the starter hashes to the same sha256 after two runs, and the two reports
  are byte-identical.
- **The same checks for us** (U3): `packages/kybernos-theme` exits 0 with the first-party context of
  `scripts/test-layout.mjs:112` — `contextOf` is exported and the test compares it field by field against the one
  `test-layout` builds (suite zone, package.json, `fileExists`).
- **Honest limits**, printed and documented: `archive` is `SKIP` (phase B), `claims.unique`/`help.card`/`compat.zone`
  are `SKIP` for a data theme, and the hygiene pass does **not** see a secret-looking file name (that rule is
  `garde-depot.mjs`'s private `:12`) — the page's "Not built" section says so.

### The point table, and the one owner that does not export its point

Section 1.4 of the spec assumed all five owners export their point objects. Four do (`DOMAIN_POINT`, `THEME_POINT`,
`TEAM_POINT`, `AUTOMATION_POINT`); **`packages/kybernos-skills/index.js:1705` keeps `SKILL_POINT` module-private**.
The tool therefore imports that owner's exported **rules** (`validateTeamSkill`, `team-skills.mjs:188`) and wraps them
in the four-line shape adapter the owner itself uses (`index.js:1699-1704`) — no second copy, and U17 pins it. The
`SKIP` path exists for a point nobody exports a validator for (U18 injects a table whose theme entry has
`validate: null`): the line reads `SKIP point.theme … its validator is not importable from here: checked when the
plugin is installed`. **This is the one place where the batch resolved an AMBIGUITY (A5) itself**; a one-word export
in `packages/kybernos-skills/index.js` would let the tool import the point object instead, and that file is not this
batch's.

## Unit test (`scripts/test-plugin-check.mjs`) — 52 checks, 0 failed

| Unit | Case | Measured |
|---|---|---|
| U1 | starter: exit 0, 0 FAIL, the 13 PASS ids in the frozen order, then the 4 SKIP ids and `broken/` | green |
| U2 | header: `acme/vet-clinic 1.0.0 (data, 5 points, free)` and the five points | green |
| U3 | `packages/kybernos-theme`: exit 0, first-party ctx identical to `test-layout.mjs:112` | green |
| U4 | each variant: exit 1, exactly one FAIL, the expected id (CLI too) | 7/7 green |
| U5 | a variant not in the expectation table fails the test (both directions) | green |
| U6 | the checked folder is byte-identical after two runs (24 files hashed) | green |
| U7 | `scanText` on the tool's own source: no exec/net/fsWrite | green |
| U8 | usage: no argument, two, a missing path, a file → exit 2, no report | green |
| U9 | a folder without `plugin.json` → exit 1, `manifest.present`, no stack trace | green |
| U10 | every ```json block of the page with `"contract": 1` is accepted by `manifestErrors` | green |
| U11 | every `node scripts/…` command of the page names an existing file | green |
| U12 | the page is linked from both specs, relative and resolvable | green |
| U13 | the frozen-interface table: exactly 5 rows, the five point ids, each declared in a `provides[]` | green |
| U14 | the four build-contract sections are headings of the page | green |
| U15 | two runs (in-process and CLI) print the same bytes, no timestamp | green |
| U16 | an extra directory → a `SKIP` line naming it, exit unchanged | green |
| U17 | the validators are imported, not copied | green |
| U18 | a point whose validator is not importable → `SKIP`, never `PASS` | green |
| E1 | copy the starter to mkdtemp → exit 0 with the same ids; drop `description` → one FAIL `manifest.schema`; restore → exit 0; the repository fixture unchanged | green |

`run-all-tests.mjs --only plugin-check` → `1 test files in 1 s: 1 green, 0 RED` (the file is discovered by
`scripts/run-all-tests.mjs:23-45`).

## Regression gates (measured; never called green where they are red)

| Command | Result now | Baseline / attribution |
|---|---|---|
| `node scripts/build-catalog.mjs --check` | **exit 0** — `✓ catalogue up to date (48 modules)` | green at the baseline |
| `node scripts/garde-depot.mjs` | **exit 0** — `1951 tracked files — 0 error(s), 1 warning(s)`; the warning is `docs/tests/gate-verdicts-final.md` (pre-existing, not this batch) | 1 warning at A2's measurement, same file |
| the guard's rules applied to the batch's own files (`isScanned` + `warningsOf`, 28 files) | **0 problem(s)** — the files are untracked until the Lead commits, so this pass is the honest preview of what `garde-depot.mjs` will see | — |
| `node scripts/test-layout.mjs` | **exit 1** — `LAYOUT — 21 checks, 2 failure(s)`, both `every DSH bundle … — kybernos-log` | red at the baseline, same two |
| `node scripts/run-all-tests.mjs --only plugin` | **123 files in 21 s: 120 green, 3 RED** — `test-plugin-scan` (`kybernos-pulse → exec`), `test-menu-icons`, `test-settings-nav` (`kybernos-log`) | the same three as the baseline; the batch's own test is one of the 120 |
| `node scripts/test-lifecycle-engine.mjs` | **82 assertions, 0 échec** | green |
| `node scripts/test-paquet.mjs` | **111 assertions, 0 échec(s)** | green |
| `node scripts/test-plugin-manifest.mjs` | **79 ok, 0 failed** (the contract still shows exactly three manifests) | green |
| `node scripts/test-signposts.mjs` | **14 ✓ 1 ✗** — the ✗ lines are all `packages/kybernos-log/help.json:8/9/21` | pre-existing neighbour |
| `node scripts/run-all-tests.mjs` | **exit 1 — 530 test files in 177 s: 518 green, 12 RED** | 8 RED at the spec's baseline, 12 now (one more file exists: this batch's test, green; the neighbours' uncommitted state moved the rest) |

**The 12 red, each with its measured cause — none is this batch's.** `test-layout`, `test-consistency-guards`,
`test-readmes`, `test-help-mounts`, `test-settings-nav`, `test-no-french-literals` (the two literals are
`client.js:33876`, `index.js:11628` of `kybernos-log`) → the untracked neighbour bundle `kybernos-log`;
`test-plugin-scan` → `kybernos-pulse → exec (helper/gen-icon.mjs:9)`; `test-signposts` → `kybernos-log/help.json:8/9/21`;
`test-no-legacy-hosts`, `test-menu-icons`, `kybernos-servers/test-host` → pre-existing, attributed by the GO gate and by
A2's report (`e52c7c72` moved the built-in server while `test-host.mjs` still asserts the old host); `test-help` → the
pre-existing docs gap (11 modules, measured). A4 writes no `packages/**` and no file any of them reads. The merge gate
still demands 0 red: those are ticketed or closed by their owner, and this report does not claim a green suite.

## Perimeter proof

`git diff --name-only` (the four pre-existing modifications were in the tree before this session and are not mine):

```
.claude/skills/ux-bug-hunter/probes.js          (pre-existing, neighbour)
docs/dev/domain-packs.md                        A4
docs/dev/plugin-contract.md                     A4
packages/kybernos-composio/cordis.patch.yml     (pre-existing, neighbour)
scripts/check-hit-targets-live.mjs              (pre-existing, neighbour)
scripts/check-ux-probes.mjs                     (pre-existing, neighbour)
```

Untracked and new, all inside the declared perimeter:

```
docs/dev/sector-bundles.md
docs/dev/templates/                             (24 files)
scripts/plugin-check.mjs
scripts/test-plugin-check.mjs
docs/tests/impl-A4-starter-docs.md              (this report)
```

Nothing else was written. `packages/**`, `catalog/**`, `docs/dev/schemas/plugin.schema.json`,
`scripts/lifecycle-packages.json`, `docs/beta/satellites.json`, `packages/kybernos-hub/catalog.json`,
`scripts/plugin-scan-exceptions.json`, `scripts/garde-depot.mjs`, `scripts/plugin-scan.mjs` and the strategy document
are untouched (`git status --porcelain` on each: silent).

## Drifted anchors, and what was verified instead

The spec's baseline is `2ac67fb4`; the tree at opening was `3efbdfdb` (four GO batches committed). Every `file:line`
the page and this report cite was **re-measured on the current files** before it was written; the numbers that moved
from the spec's table are listed here rather than silently kept:

| Spec anchor | Measured at `3efbdfdb` | Consequence |
|---|---|---|
| `preset-store.mjs:43-52` (vocabulary), `:92-115` (`sanitizePreset`) | `SETTINGS_KEYS` **:50-59**, `sanitizePreset` **:99-122**, `A11Y_KEYS` **:44**, `applyPreset` **:200** | the page cites the measured lines |
| `domain-pack.mjs:28` (`LIMITS`), `:68` (`validatePack`), `:225-231` (points) | `LIMITS` **:31**, `validatePack` **:79**, points **:405-410**; `validateTeamTemplate` **:283**, `validateAutomationTemplate` **:315** (A2-pack-format) | the page's frozen-interface table cites `:79`, `:283`, `:315` |
| `themes-catalogue.mjs` had no point | `validateTheme` **:75**, `THEME_POINT` **:89** (A1) | the theme row names them |
| `registry.mjs:54-72` (`dataPackageProblems`) | **:57-75** | cited as `:57-75` |
| `registry.mjs:127` (a data plugin needs a `package.json`) | `inspectPackage` **:115-136** | the tool says "package.json is missing" itself |
| `manifest.mjs:53-90`, `:86-89` | `manifestErrors` **:49-125**, rule 1 **:57-63**, rule 4 **:90-93** | cited as `:49-63` and `:90-93` |
| `plugin-contract.md:259-260`, `:477` | measured **:260**, **:477**; section 11 at **:484-500**, CLI **:486**, "necessary…" **:500**, consent **:552**, read location **:550**/**603** | both stale claims replaced; D18 measures it |
| `plugin-contract.md:263-274` | unchanged (ten rows, `:265` and `:269-272` the five this batch freezes) | the four rows gained `opened 2026-10-28` |
| `domain-packs.md:108`, `:158` | unchanged line numbers (the head link adds 5 lines above them; rows edited in place) | D15/D16 measure them |
| strategy `:164`, `:170` | **:165**, **:171** | the page cites neither by number |
| strategy `:106-110` (composition) | **:107-110** (rule 2), rule 1 **:102-108**, rule 3 **:111-115**, build contract **:81-96** | the page cites `:107-110` |
| `host.mjs:32`, `test-layout.mjs:112`, `plugin-scan.mjs:57`/`:109`, `garde-depot.mjs:11`/`:12`/`:28-35`, `team-skills.mjs:188`, `maquette.html:23` (both) | **no drift** (verified line by line) | cited as-is |

Also verified rather than assumed, because the spec's own premises moved:

- **`docs/dev/sector-bundles.md` and the template did not exist** (D1/D5 red) — re-measured, not taken from the spec.
- **`D4` needs the point id wrapped in backticks.** Its regex is `^\| .kybernos/(…)`, where the `.` consumes the
  backtick, exactly as the contract's own table does it. The page's first cell is `` `kybernos/…` ``; without the
  backtick the five rows never match (measured: count 0). U13 strips the backtick before comparing ids.
- **The wizard does not call the theme seam yet.** `packages/kybernos-plugin/client.js` contains no
  `__KB_THEME_APPLY__`, no `applyTheme` and does not send `theme` in its `complete` POST; A1's spec scopes the wizard
  step to `A1-kit-wizard` ("this batch exposes the door; it shows nothing and opens no step"). The page says exactly
  that, and the `domain-packs.md` row says **seam built**, not "wired".
- **The kit step draws a pack's goals, not the contributed templates.** `kbObKitOf` reads `pack.goals` only; the
  route does serve `pack.kit` (A2-pack-format). The page lists "the Kit step for contributed templates" as not built.
- **`test-en-quotes.mjs` cannot fail on a document** (it reads `packages/*/client.js` only), as the spec's F2 says:
  it is not a DoD line here and was not used as evidence.

## Follow-ups (recorded, not silently closed)

- **F1** — the strategy's example manifest (`docs/etudes/2026-10-27-sector-packs-strategy.md:58-74`) is still invalid
  (missing `description`; then two owners missing from `requires.plugins`). The page shows the accepted manifest
  instead, and U10 keeps any page block honest. The strategy's owner fixes it.
- **F2** — the vacuous `test-en-quotes.mjs` dod line: dropped, as the spec says.
- **F3** — the read-location wording: aligned on `profiles/web` + `node_modules/`; a docs-lint that reads the claim
  and the code path in one assertion is still the stronger check.
- **F4** — `kybernos/dashboards#preset`: the row says **not built**, the page lists it, no theme targets it.
- **F5** — the sector mockups exist and are cited (`maquette.html:23`), both accents still **PROPOSAL**.
- **F6** — the signed catalogue stays phase B; the page quotes "necessary for every level and sufficient for none".
- **F7** — secret-**file-name** detection is the documented gap (`garde-depot.mjs:12` is private); the page says so.
- **F8** — the page keeps the frozen path `sector-bundles.md` although its H1 says "Build a theme"; the rename batch
  A5 owns the move.
- **F9 (new)** — `SKILL_POINT` is module-private in `packages/kybernos-skills/index.js:1705`, so the checker imports
  the owner's rules through a four-line adapter instead of the point object. A one-word `export` would close the gap;
  the file is outside this perimeter.
- **F10 (new)** — `D9` of the spec cannot be green (see §1); the fix is `|| continue` before `exit 1`. The same shell
  shape may sit in other batches' specs; worth a pass over `docs/tests/*-strategy.md` DoD blocks.
- **F11 (new)** — the spec's "24 command lines, 23 assertions, all 23 exit 1" no longer describes the block: `D11`
  is a precondition whose red state depended on A1/A2 not having landed. A DoD line that reads another batch's
  `packages/**` cannot discriminate a docs batch and should be labelled a precondition, not an assertion.

## `vision:`, `capture:`, `maquette:` — not applicable, stated

The batch renders nothing: a Markdown page, JSON/Markdown fixtures and a terminal report. There is no state to
capture in light or dark, no surface to freeze, and `garde-depot.mjs:11` refuses tracked images, so a capture folder
under `docs/dev/templates/` is impossible by rule. The design references (the two tracked mockups) are A3's evidence,
not A4's. What replaces a capture is the **report text**: the starter's report above is the frozen sample, byte for
byte, and `render()` is proven deterministic by U15.

## What the Lead should look at

1. **`D9` (spec defect)**: apply the one-word fix to the spec (`|| continue`), or accept this report's equivalent
   measurement. Everything else is green.
2. **F9**: whether `kybernos-skills` should export `SKILL_POINT`, so the checker imports a point object like the other
   four — a decision for that bundle's owner, not this batch.
3. **The 12 reds** stay the merge gate's business; A4 adds none and cannot turn any green (no `packages/**`).
4. Nothing was committed (the Lead commits); the tree keeps the four pre-existing neighbour modifications.
