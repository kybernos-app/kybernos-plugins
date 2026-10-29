# Fix stage — the BLOCK grounds of the adversarial review (2026-10-28)

> Scope: `docs/tests/revue-adversariale.md` BLOCK grounds 1 → 2 → 5 → 3, plus the two WARN one-liners the brief allows
> (F-2 dead symlink guard, F-15 `THEME_RE` off-by-one). Everything else stays ticketed (see "Refused / left on the
> ticket"). Measured on the tree that was handed over; every number below is a command this stage ran.

## Verdict

**PASS on the four grounds and the two one-liners.** The four probes of `docs/tests/sondes-fix-block.md` are green
(46 checks, 0 red, each exits 0), their assertions are promoted into the collected suites named by the notebook's
promotion table, and `node scripts/run-all-tests.mjs` grows **no red** from this diff (532 files, 527 green, 5 red, all
five accounted for below). The campaign diff may be re-submitted to the adversarial review.

| Ground | Verdict | Proof |
|---|---|---|
| 1 — the import path (F-41/F-42, user data) | **FIXED** | `probe-import-invariant` 7/7 ✓, exit 0; promoted into `test-preset-store` |
| 2 — catalogue transport + trust chain (F-1/F-25/F-26, M16) | **FIXED (wired, not cut)** | `probe-catalogue-trust` 14/14 ✓, exit 0; `verifyEntry`/`verifyArchive` have production callers |
| 5 — fixtures prove fixtures (F-27) | **FIXED** | `probe-market-contract` 16/16 ✓, exit 0; the suite now feeds the route's real answer |
| 3 — the two A1-kit-wizard invariants (F-39/F-40) | **FIXED code + spec** | `probe-wizard-invariants` 9/9 ✓, exit 0; narrowed DoD 4 exits 0 |
| WARN F-2 — dead symlink guard | **FIXED** (one line) | `lstatSync`; the stage-suite now proves the refusal fires |
| WARN F-15 — `THEME_RE` off-by-one | **FIXED** (spec) | `A2-pack-format-strategy.md` reads `{0,39}` (40 chars), in its three spots |

## Files touched

| File | Why |
|---|---|
| `packages/kybernos-theme/preset-store.mjs` | G1: the import only ever replaces a record it created |
| `packages/kybernos-theme/test-preset-store.mjs` | G1 promotion: the full invariant, any id, byte for byte |
| `packages/kybernos-plugin/theme-installer.mjs` | G2: bounded transport, level computed by `verifyEntry`, archive verify + staging, F-2 `lstat` |
| `packages/kybernos-plugin/index.js` | G2: the route passes the fetched sources, runs `verifyArchive` on the fetched archive |
| `packages/kybernos-plugin/client.js` | G2 seam install goes through the host-verified archive; G3 style port through the published helper; G5 the two wire shapes |
| `packages/kybernos-plugin/test-theme-installer.mjs` | G2 promotion (trust, call sites, install, transport) + F-2 symlink proof |
| `packages/kybernos-plugin/test-theme-market.mjs` | G5: the baked fixtures replaced by A6's own route answer |
| `scripts/test-onboarding.mjs` | G3 promotion: the consumer-aware seam/`pack.kit` invariant |
| `docs/tests/A1-kit-wizard-strategy.md` | G3: DoD 4 narrowed (consumer-aware) + the `:97` measurement, with the review-narrowing note |
| `docs/tests/A2-pack-format-strategy.md` | F-15: the mis-transcribed theme-id regex |
| `docs/tests/A6-theme-installer-strategy.md` | one word: the GET answer now lists `description` (the field the card reads, F-27) |
| `docs/tests/impl-fix-block.md` | this report |

No new file under `packages/` or `scripts/`: the four probes stay in `docs/tests/probes/` (outside discovery), as the
notebook allows, and the merge gate carries their assertions through the collected suites above.

---

## GROUND 1 — the import path destroys the person's records (F-41/F-42)

**Before** (`node docs/tests/probes/probe-import-invariant.mjs`, exit 1): 6 of 7 red —
`✗ the person's record is untouched, byte for byte, in every case (3/12)`, the suffixed branch rewriting `soigne-2`
(`Cabinet`, dropping `gid`/`v`) and answering the victim's name.

**After** (exit 0, 7/7):

```
✓ the person's record is untouched, byte for byte, in every case (12/12)
✓ the import lands on a record of its own (or refuses) in every case (12/12)
✓ ...and never rewrites its source or its settings
✓ no record of another name is rewritten (a collision never touches a stranger)
✓ the unrelated record keeps its name, its catalogue link (gid) and its version (v)
✓ the import answers its own name, never the name of the record it collided with
✓ no two records share an id and none was dropped
OK — ground 1, import invariant (7 checks)
```

`applyPreset` now names what belongs to the import once: a record is the import's own only when it is **not**
`source:'me'` and carries the import's name (plain or suffixed). A `me` record is never a candidate whatever id the
document names, and a candidate id held by a record of another name is skipped, never rewritten — so the suffixed walk
can no longer land on a stranger, and no record outside the answered id is ever filtered out.

Promotion: `test-preset-store.mjs` replaces the « a different id » narrowing with the 12-case byte-for-byte invariant
and the stranger-at-the-suffix case (78 checks, exit 0).

## GROUND 2 — the trust level is minted by the document, and the verifiers had no caller (F-1/F-25/F-26, M16)

**Before** (`node docs/tests/probes/probe-catalogue-trust.mjs`, exit 1): 8 of 14 red — `level:"official"` copied from
the document, the unsigned entry offered with `refused: []`, `verifyArchive` with **0** call sites, `newest.level`
still read.

**After** (exit 0, 14/14): the document's own claims never survive (`level === 'community'` for an author-only
signature, `'verified'` only with the reviewer's countersignature), a forged author signature is refused with the
verifier's own `signature` code, `verifyArchive` has a production caller, and no level is read from a document.

What was **wired** (M16 — the half is not cut):

1. **Transport.** `theme-installer.mjs` now carries the bounded rules A6:43 names, copied from
   `packages/kybernos-hub/telechargement.mjs` (https only, redirects may not downgrade, a deadline, a cap enforced
   *while* reading): `fetchCatalogueSources(sources)` (document + its sibling `<url>.sig`, in parallel, one deadline for
   all sources) and `fetchArchiveBytes(url)`. `index.js` — the one caller of `handleThemes` — reads the declared sources
   from `<DSH home>/kybernos/themes.json` and passes the bytes as `ports.catalogues` on every GET, and again for
   `refresh`/`install`. A dead source is a `refused` line (`download`/`signature`/`size`), never a 5xx and never a boot
   dependency.
2. **Level computed once.** `catalogueView` builds the author keys from the *signed* document
   (`authors[<owner>].keys`), the reviewer keys from `reviewers`, and calls `verifyEntry` for every newest version
   before offering it. `OFFICIAL_KEYS` ships **empty** (no placeholder key, M4), so a self-pinned source can earn
   `verified` at best. The document's `level`/`trust`/`official` fields are never read again.
3. **Archive verified before the manager.** The click no longer downloads the package in the browser. The client asks
   `POST /kybernos/themes {action:'install', id, version}`; `index.js` resolves the target from the **verified** entry
   (`themeTarget`, so the address is the signed catalogue's, never one the page sent), fetches it under the import bound
   and runs `verifyArchive` (hash + author + reviewer). `handleThemes` refuses a port whose verdict does not name those
   exact bytes, checks the gzip shape, and stages them (atomic, 0600, `.tgz`, pruned) where DSH's manager installs them.
   `kbThImportArchive` is deleted (dead-code rider); the page never hashes, never writes a path and never picks an
   address.

Promotion in `test-theme-installer.mjs` (48 checks, exit 0): the level-is-computed test (self-pinned source, manifest
claims ignored, forged signature refused), the static call-site test (`catalogueView` calls `verifyEntry`, the route
calls `verifyArchive`, no `newest.level`), the install-action test (only bytes the verdict names are staged; a foreign
verdict is `unverified`), and the bounded-transport test (http never requested, oversize `size`, missing signature
`signature`, an archive over `IMPORT_MAX` `size`).

Side effect worth naming: F-36's « the 8 MiB cap is checked only after a full browser download » no longer exists —
the bytes are streamed on the host with the cap applied while reading.

## GROUND 5 — the suites prove fixtures, not the product (F-27)

**Before** (`node docs/tests/probes/probe-market-contract.mjs`, exit 1): 6 of 16 red — every card field but id/version
empty (`""`), zero report rows without a plan and no `added` row with one.

**After** (exit 0, 16/16): a really signed catalogue runs through A6's own route, **its actual GET answer** feeds A7's
own `marketCards`; the real `planTheme` plan runs through A6's own `kbThApply`, wrapped exactly as the published seam
wraps it (`{ ok, id, version, report }`) and fed to `marketReport` through the page's own call convention.

Two shapes were wrong and are fixed at the source:

- `marketCards` read `entry.manifest.{name,description,author,license}`; the route sends **flat** `name` (a
  `{ fr, en }` object), `author`, `licence`, and now also `description` (added to the route's theme entry). The card
  reads those fields; a `manifest` object the route does not emit yields empty fields — asserted, so the old fixture
  shape cannot come back.
- `marketReport` read `result.added/skipped/failed`; the seam nests them under `report`. It now reads `result.report`
  (and still accepts a bare report, so the page's own convention keeps working).

The suite is now a **contract test**: `test-theme-market.mjs` builds its source, catalogue and archives, runs
`handleThemes` (POST `source-add`, then GET), and uses that answer everywhere — cards, levels, the three states
(`no-source`, `empty`, `refused`, each a real answer), both languages, the install gate — and the report half runs the
real `kbThApply` over fake ports (54 verifications, 0 failure). No fixture bakes a shape the route never emits.

## GROUND 3 — the two frozen A1-kit-wizard invariants (F-39/F-40)

**Before** (`node docs/tests/probes/probe-wizard-invariants.mjs`, exit 1): 2 raw reads (`client.js:26089` the
marketplace's, `:36961` the wizard's), the installer page's style port reading the window itself; `pack.kit` file-wide
count 4 (all outside the wizard's blocks).

**After** (exit 0, 9/9): exactly one raw read in the file, inside `KB-OB-CORE`; every other consumer through
`kbObThemeSeam`; zero `pack.kit` family tokens in the wizard's blocks.

Two edits:

- **Code.** `kbThPorts().style` (the installer page) calls `kbObThemeSeam(window)` — the one published helper — instead
  of reading `window.__KB_THEME_APPLY__` itself. No alias, no second door; the file-wide raw read is 1 again.
- **Spec** (`A1-kit-wizard-strategy.md`). DoD 4 is now consumer-aware (one raw reader in the file, inside
  `KB-OB-CORE`; the wizard UI and the installer page through the helper; the `pack.kit` family zero **inside
  `KB-OB-CORE` + `KB-OB-UI`**), with a « review narrowing 2026-10-28 » paragraph saying why a file-wide count cannot
  survive a second legitimate consumer. `:97`'s measurement is narrowed the same way (the marketplace's `plan.kit` is
  named as a second consumer this batch does not own). The rest of DoD 4 stays as it was, and the narrowed command runs
  green verbatim:

```
$ bash <narrowed DoD 4 block, A1-kit-wizard-strategy.md>
ok   wiring: one published seam, and the wizard consumes no pack.kit
exit=0
```

Promotion: `scripts/test-onboarding.mjs` carries the consumer-aware invariant as six collected checks (one raw read in
the file, inside the core; UI and installer port at zero; wizard blocks at zero for the family; `kbObKitOf` still
derives the kit from the goals) — `all checks passed`.

## WARN one-liners

- **F-2.** `folderProblem` uses `lstatSync` (not `statSync`), so `isSymbolicLink()` can actually be true; the stage
  suite now creates a link to a real folder and asserts the refusal (`400`, « the folder is a symbolic link »). What
  stays ticketed is the review's second half: a symlinked *intermediate* component still escapes the literal-segment
  `..` check (a realpath-containment rule is a design change, not a one-liner).
- **F-15.** The spec's theme-id regex was mis-transcribed `{0,40}` (41 chars, which would accept D1's
  `'x'.repeat(41)`); `A2-pack-format-strategy.md` now reads `{0,39}` in its three spots, with the off-by-one note. The
  code already implemented 40 and does not move.

## run-all-tests comparison

`node scripts/run-all-tests.mjs` → **532 test files in 134 s: 528 green, 4 RED** (exit 1, final run).

| | Review baseline (measured, `sondes-fix-block.md`) | This fix |
|---|---|---|
| files | 532 | 532 |
| green | 522 | 528 |
| red | 10 | 4 |

The four reds, each already in the review's own list:

| RED | Status |
|---|---|
| `scripts/test-help.mjs` | in the 10-red baseline (pre-existing docs gap) |
| `scripts/test-no-legacy-hosts.mjs` | in the 10-red baseline (cloud rename dependents) |
| `scripts/test-plugin-scan.mjs` | in the 10-red baseline (`kybernos-pulse → exec`) |
| `packages/kybernos-servers/test-host.mjs` | in the 10-red baseline (same rename, 8 failures) |

**No new red comes from this diff, and none at all on the final tree.** An intermediate run (before the worktree's
`kybernos-log` delta settled) showed one extra red, `scripts/test-no-french-literals`, from that other, uncommitted
work (`client.js` `KB_SS_PAGE_KW`/`KB_SS_FR` rows, `git diff` at `+3189`/`+3239`, absent from `HEAD`); it went green
before the final run, and the log bundle's own six reds (consistency-guards, help-mounts, layout, readmes, signposts,
settings-nav) also cleared — another session's work, not this stage's. The four suites this stage touched are green in
that run (and standalone): `test-preset-store` 78 checks, `test-theme-installer` 48, `test-theme-market` 54,
`test-onboarding` all checks passed.

`node scripts/garde-depot.mjs` → **0 error, 3 warnings**, the same pre-existing personal-path warnings the review
recorded (F-47 + one in an implementer account); this stage adds none.

## Refused / left on the ticket

Not attempted (the brief fixes grounds 1/2/5/3 + the two WARN one-liners; everything else stays ticketed):

- F-4 (guards opt-in), F-5 (weakened assertions), F-6/Ground 4 (the remaining reds), F-7/F-9 (doc anchors), F-8
  (declared `net:` drift), F-10…F-14, F-16…F-22, F-23/F-24, F-28 (the Settings source row — the transport now works, but
  a source still has no GUI field; the route's `source-add` is the door), F-29 (retry affordance), F-30 (listing venue),
  F-31 (`revokedKeys` still not checked), F-32 (record `level` copied from the client), F-33 (`source` semantics), F-34
  (equal-seq replay), F-35, F-36's « newest = last element » (the download half is moot now), F-37, F-38, F-43…F-48.
- The transport reads the signature from the source's sibling `<url>.sig` (a bare base64 body or `{ "signature": … }`);
  that convention is this stage's choice, since no spec pinned how a catalogue pairs its bytes with its signature. It is
  documented in `fetchCatalogueSources` and is the one thing a reviewer should confirm before release.
- The catalogue `seq` floor is still not persisted after a successful fetch (`source.seq` stays null unless something
  wrote it): replay protection exists (`verifyCatalogue` honours a floor) but nothing records the new floor yet — F-34's
  neighbourhood, left ticketed with it.

## Next step

Re-run the adversarial review on this tree (the four probes and the promotions are its yardstick). The four reds left
are the review's own pre-existing list; no red is this diff's, and the worktree's `kybernos-log` delta went green on its
own side.
