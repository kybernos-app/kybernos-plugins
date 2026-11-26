# A8-theme-content-six — implementation report

| | |
|---|---|
| Batch | `A8-theme-content-six` (spec `docs/tests/A8-theme-content-six-strategy.md`, verdict GO in `docs/tests/gate-verdicts-marche.md`) |
| Verdict | **pass** |
| Baseline | anchors pinned to `2ac67fb4`; tree at `3efbdfdb` ("themes: implement the four GO batches") |
| Lane | B — data only: four JSON style sources, one generated catalogue, one generated gallery, four one-line pack links |
| Committed | **no** (the Lead commits) |
| Tests touched | none |

## What shipped

Four style halves (the visual layer) plus four one-line `theme` links, so the field catalogue holds
**six** complete themes. A3's `sante -> cabinet-medical` and `recrutement -> recrutement-ssii` are
untouched.

| Sector | Pack (untouched but the link) | New style source | Accent (cited) | mode / font / radius |
|---|---|---|---|---|
| Rental real estate | `domains/immo.json:5` `#B4532A` | `catalog/themes/immobilier-locatif.json` | `#b4532a` | light / inter / standard |
| E-commerce | `domains/com.json:5` `#C25E0A` | `catalog/themes/e-commerce.json` | `#c25e0a` | light / inter / soft |
| Law firm | `domains/droit.json:5` `#7A2236` | `catalog/themes/cabinet-avocats.json` | `#7a2236` | dark / georgia / sharp |
| Education | `domains/edu.json:5` `#6C4DF6` | `catalog/themes/education.json` | `#6c4df6` | light / poppins / soft |

**PROPOSAL** — every non-accent token (`mode`, `fontText`, `radius`, the four `ov` palettes of five
tokens each) is a design choice, not a source; only `acc` is bounded by the pack. The four accents are
**cited** from their own pack's `accent` and **labelled PROPOSAL**, because no métier owner has
ratified those hexes (AMBIGUITY 2 of the spec): each is the pack author's design choice, exactly the
situation A3 recorded for `#4F5BD5`.

`settings` is written in the page's canonical form — `PRESET_KEYS` order
(`mode, acc, ov, fontText, radius`) and lower-case hexes — because `test-client.mjs:1304` compares the
round trip as a JSON string through `toHex` (`client.js:83`). That is what reddened A3's two files and
what DoD 5 now proves green.

## Files touched (perimeter: 10)

| File | Change |
|---|---|
| `catalog/themes/immobilier-locatif.json` | new — 26 lines |
| `catalog/themes/e-commerce.json` | new — 26 lines |
| `catalog/themes/cabinet-avocats.json` | new — 26 lines |
| `catalog/themes/education.json` | new — 26 lines |
| `catalog/themes/_catalogue.json` | `seq 5 -> 6`, `publishedAt` refreshed — written by `build --bump` only |
| `packages/kybernos-theme/gallery.json` | generated: `20 themes, seq 6` — written by the same command |
| `packages/kybernos-plugin/domains/immo.json` | one added line: `"theme": "immobilier-locatif",` |
| `packages/kybernos-plugin/domains/com.json` | one added line: `"theme": "e-commerce",` |
| `packages/kybernos-plugin/domains/droit.json` | one added line: `"theme": "cabinet-avocats",` |
| `packages/kybernos-plugin/domains/edu.json` | one added line: `"theme": "education",` |

`git diff -U0 packages/kybernos-plugin/domains/` is four hunks, each `@@ -4,0 +5 @@` with a single
added line and no deletions — the key sits where A3 put it in `sante.json`/`recrutement.json`
(after `order`, before `accent`).

`git diff --stat` of the generated pair:

```
 catalog/themes/_catalogue.json       |  4 +-
 packages/kybernos-theme/gallery.json | 96 +++++++++++++++++++++++++++++++++++-
 2 files changed, 96 insertions(+), 4 deletions(-)
```

The only removed lines in `gallery.json` are `"publishedAt"` and `"seq"` (the bump) — every other
hunk is an addition, so no shipped theme was rewritten by the rebuild.

This report (`docs/tests/impl-A8-theme-content-six.md`) is outside the ten-file perimeter by nature:
it is the deliverable the delegation asks for, it is documentation, and it changes no product data.

## DoD, before -> after

Run from the repository root on 2026-10-28, first **before any write**, then again after the batch.
The five commands are the spec's own, in their exact heredoc form (a first pass kept them in `/tmp`
files with absolute imports; the results were identical, and the final pass used the spec text
verbatim).

| # | Before (exit 1) | After (exit 0) |
|---|---|---|
| D1 | `catalog/themes/immobilier-locatif.json: missing` (+ the three others) | `ok: 4 sector styles, accent = the pack accent in lower case, every token legal` |
| D2 | `missing from the built catalogue: immobilier-locatif, e-commerce, cabinet-avocats, education` / `seq not bumped (HEAD 5, now 5)` | `ok: 20 themes, seq 6, the six sector themes present` |
| D3 | `immo: theme null (want immobilier-locatif)` … `the catalogue holds 2 themes, six expected: sante->cabinet-medical, recrutement->recrutement-ssii` | `ok: six themes, each named by its own pack, each resolvable in the catalogue` |
| D4 | `immo: keys v,id,order,accent,icon,name,tagline,keywords,home,legacyJobs,menu,agents,goals` then `immo: no theme key` (same for `com`, `droit`, `edu`) | `ok: four packs, one added key each, no content rewritten` |
| D5 | `missing from the shipped gallery: immobilier-locatif, e-commerce, cabinet-avocats, education` | `ok: the four new entries are in the gallery and the page keeps every theme unchanged (20 themes)` |

D5's first leg (`node packages/kybernos-theme/test-client.mjs`) was green before the batch —
`✓ 450 passed, 0 failed, 1 part SKIPPED (not covered)` — and is identically green after it, with the
round-trip check (line 455 of the run) carrying no offender suffix. The check count does not move
because the round trip is one assertion over all themes, as the spec predicted.

`node scripts/themes-catalogue.mjs build --bump` printed:
`shipped catalogue: 20 themes, seq 6 -> packages/kybernos-theme/gallery.json`.

The six sector entries in the shipped gallery, read back from `gallery.json` (seq 6, 20 themes,
20 distinct accents overall — no collision with the other 14 themes):

| id | mode | acc | font | radius | ov |
|---|---|---|---|---|---|
| cabinet-medical | light | `#1b7f76` | inter | standard | 5 |
| recrutement-ssii | dark | `#4f5bd5` | inter | soft | 5 |
| immobilier-locatif | light | `#b4532a` | inter | standard | 5 |
| e-commerce | light | `#c25e0a` | inter | soft | 5 |
| cabinet-avocats | dark | `#7a2236` | georgia | sharp | 5 |
| education | light | `#6c4df6` | poppins | soft | 5 |

## Regression gate (measured, not assumed)

| Command | Result |
|---|---|
| `node packages/kybernos-plugin/test-domain-pack.mjs` | exit 0 — **52 checks passed** (unchanged, as the spec requires) |
| `node scripts/test-themes-catalogue.mjs` | exit 0 — `OK — themes catalogue publishing (30 checks)` (unchanged) |
| `node packages/kybernos-theme/test-themes-gallery.mjs` | exit 0 — `OK — themes gallery (56 checks)` |
| `node scripts/test-onboarding.mjs` | exit 0 — `all checks passed` |
| `node scripts/garde-depot.mjs` | exit 0 — `1979 tracked files — 0 error(s), 1 warning(s)`; the one warning is the pre-existing hard-coded personal path in `docs/tests/gate-verdicts-final.md`, not this batch's |
| `node scripts/run-all-tests.mjs` | exit 1 — **530 test files in 180 s: 518 green, 12 RED** |

The 12 reds are the same twelve the spec attributed file for file, none of them a file of this batch
or of this campaign's perimeter: `test-consistency-guards`, `test-help-mounts`, `test-help`,
`test-layout`, `test-no-french-literals`, `test-no-legacy-hosts`, `test-plugin-scan`, `test-readmes`,
`test-signposts`, `test-menu-icons`, `test-settings-nav`, `test-host`. The suite is **not** claimed
green; the batch adds 0 reds and the merge message must name these 12. (530 files rather than the
spec's 529: a neighbour's new test file appeared during the session, not this batch's.)

## Perimeter proof

`git diff --name-only` (tracked changes) at the end of the batch:

```
.claude/skills/ux-bug-hunter/probes.js          <- not mine
catalog/themes/_catalogue.json                  <- mine (generated)
packages/kybernos-composio/cordis.patch.yml     <- not mine
packages/kybernos-plugin/domains/com.json       <- mine (one line)
packages/kybernos-plugin/domains/droit.json     <- mine (one line)
packages/kybernos-plugin/domains/edu.json       <- mine (one line)
packages/kybernos-plugin/domains/immo.json      <- mine (one line)
packages/kybernos-theme/gallery.json            <- mine (generated)
scripts/check-hit-targets-live.mjs              <- not mine
scripts/check-ux-probes.mjs                     <- not mine
```

Untracked files of this batch: the four `catalog/themes/*.json` sources, plus this report. No test
file, no `client.js`, no `domain-pack.mjs`, no `index.js`, no `preset-store.mjs`, no
`catalog/themes.catalog.json` / `.sig`, no `dsh-compat.json`, no file under a DSH home was written.

**Concurrent drift observed, not mine.** At opening, `git status` showed `docs/dev/domain-packs.md`
and `docs/dev/plugin-contract.md` modified and `scripts/check-ux-probes.mjs` clean; at closing the
two docs are no longer modified and `scripts/check-ux-probes.mjs` is. The four "not mine" lines above
are that neighbours' traffic (the spec warned this tree is written while specs are written). I
touched none of them; a Lead reviewing the commit must select the ten files, not `git add -A`.

## Drifted anchors, re-pinned at implementation time (on disk, HEAD `3efbdfdb`)

Baseline `2ac67fb4` anchors were re-read at opening, as the spec asks. The values below are the ones
that moved; nothing here flips the batch, and no DoD depends on the line number.

| Anchor in the spec | Line now | Note |
|---|---|---|
| `themes-catalogue.mjs:44-62` `sanitizeTheme` | `:45-63` | one line down |
| `preset-store.mjs:92-115` `sanitizePreset`, silent drop `:104` | `:99-122`, drop at `:111` | shift only |
| `client.js:1867` `PRESET_KEYS` | `:1872` | `PRESET_GROUPS` at `:1858-1867` |
| `client.js:1877-1882` `presetSettings` rebuild | `:1881-1887` | shift only |
| `client.js:2092-2107` gallery card / `galTheme` | `:2100-2115` | shift only |
| `domain-pack.mjs:71` allowlist (baseline), `:187` cleaned pack | `:82`, `:201` | post-baseline A2 — "campaign file, post-baseline" |
| `test-domain-pack.mjs:248-250` keyword guard, `:253` colour guard | `:270`, `:276` | post-baseline tolerant assertions |
| `test-client.mjs:1304` round trip | `:1304` | unchanged |
| `client.js:83` `toHex`, `:367` `TOKMAP`, `:416` `FONTS`, `:910` radius | unchanged | — |
| `_catalogue.json` seq | was 5, now 6 | `--bump` |

## Not done here (recorded, never silently skipped)

- **Captures/vision** (`check-theme-live.mjs --only gallery,skins`): **not run**. It drives the real
  GUI and persists native DSH preferences in the profile; the spec makes it conditional on A1's seam
  and on the isolated sandbox, and assigns the item to A1's camera. The e2e/vision items on the four
  new gallery cards and the six swatches therefore stay **open**, owned by A1 — recorded as open, not
  as a pass. No PNG was produced, so `git` saw no media.
- **The `seq` beyond the single bump**, the signature (`catalog/themes.catalog.json`), and the
  canonical-form fix of `sanitizeTheme` (spec AMBIGUITY 3) are the maintainer's / a later batch's.
- **Nothing committed**, per the delegation.
