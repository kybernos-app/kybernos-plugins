# A3-vertical-content — implementation report

| | |
|---|---|
| Batch | `A3-vertical-content` (spec `docs/tests/A3-vertical-content-strategy.md`, verdict GO in `docs/tests/gate-verdicts-final.md:160-182`) |
| Lane | B — no auth, billing, RLS, migration or secret surface; every file written is JSON data |
| Verdict | **pass**, with one recorded merge-order precondition (below) |
| Measured at | worktree `317b2f21` + the neighbours' uncommitted diffs, `2026-10-28T04:28+01:00` |
| Written by | implementeur (dev-team kyber) |

## ROOT CAUSE (one line)

Not lane A: the two sector themes did not exist (`catalog/themes/` held 14 generic styles, no sector
one) and no pack named a style preset, so the gallery had no sector card and the wizard could not
propose one — the gap is missing data, not a code defect.

## Merge-order precondition (read before committing)

DoD 3 and DoD 5 are green **only because A2-pack-format's uncommitted diff is in this worktree**
(`packages/kybernos-plugin/domain-pack.mjs:*` — `'theme'` in the pack allowlist, `theme: null|string`
in the cleaned object). At `HEAD` (`317b2f21`) that file has no `'theme'` key: both DoDs are red
there, and both packs (`sante.json` and `recrutement.json`) would be **rejected** with
`pack: unknown key "theme"`. **Commit A3 after A2-pack-format, or in the same commit — never A3
alone.** This is exactly the merge-order red the spec anticipates (`A3-vertical-content-strategy.md:163`,
`:214-215`); it was resolved in the worktree, not patched from A3.

## Files touched (5)

| File | Change |
|---|---|
| `catalog/themes/cabinet-medical.json` | **new** — theme source, id = the pack's theme id, `acc` = `#1B7F76` (`sante.json:6`), light, `inter`, `standard` |
| `catalog/themes/recrutement-ssii.json` | **new** — theme source, `acc` = `#4F5BD5` **cited** from `docs/handoff/theme-recrutement-ssii/maquette-v1/maquette.html:23` and **PROPOSAL** per D5, dark, `inter`, `soft` |
| `packages/kybernos-plugin/domains/recrutement.json` | **new** — pack `recrutement`, `order: 90`, `theme: "recrutement-ssii"`, `accent: "#4F5BD5"`, `icon: "bag"`, 5 goals (sourcing, offres, entretiens, clients, veille), all sentences **PROPOSAL** (build contract 4) |
| `packages/kybernos-plugin/domains/sante.json` | **+1 line** — `"theme": "cabinet-medical"` after `order` (interpretation 1 (a): no new goal, no new sentence) |
| `catalog/themes/_catalogue.json`, `packages/kybernos-theme/gallery.json` | `seq 2 → 3` + `publishedAt`, and the two themes — produced by `node scripts/themes-catalogue.mjs build --bump`, never hand-edited |

Not touched, by design: `packages/kybernos-plugin/domains/skills/` (interpretation 1 (a): its eleven
folders are all referenced already, `test-domain-pack.mjs:222-225` reddens on an unused one),
`domain-pack.mjs`, `client.js`, `index.js`, any test file, any signature file.

Recruitment content is authored from the tracked mockup's proposed block
(`docs/handoff/theme-recrutement-ssii/maquette-v1/maquette.html:234-235`: sourcing, offres,
entretiens, clients, veille; bureau mode; balanced agents with a reason), with its kit counts
respected (2/2/1/1/1 skills, 1 team, one automation per goal, the mockup's own times:
weekday 18:00, Monday 9:00, weekday 17:00, Monday 9:00, Monday 8:00). The design reference does not
authorise a single invented datum: the five goal ids, the skill counts and the schedule narration
come from that block; every label, title, description, prompt and starter is authored and therefore
labelled PROPOSAL in this report and in the spec, never claimed as métier-sourced.

## DoD before → after (each command, verbatim result)

Before = captured before a single line was written; "after" = re-run on the final tree
(`2026-10-28T04:28+01:00`).

**DoD 1 — `node --input-type=module -e "…"` (two sector themes, accent = pack accent)**

- before: `exit=1`
  ```
  catalog/themes/cabinet-medical.json: missing
  packages/kybernos-plugin/domains/recrutement.json: missing
  ```
  (the spec quotes the two messages in the other order; the loop tests the pack file first, so the
  missing *pack* is printed first. Same discriminator, same exit code.)
- after: `exit=0` — `ok: 2 sector themes, accent = pack accent`

**DoD 2 — `node --input-type=module -e "…"` (gallery rebuilt, seq bumped)**

- before: `exit=1`
  ```
  missing from catalog/themes: cabinet-medical, recrutement-ssii
  seq not bumped (HEAD 2, now 2)
  ```
- mid-state, measured between writing the sources and running the build (proof the two halves
  discriminate separately): `exit=1` — `gallery.json is not what the sources build (seq 2 vs 2)` +
  `seq not bumped (HEAD 2, now 2)`
- after `node scripts/themes-catalogue.mjs build --bump` → `shipped catalogue: 16 themes, seq 3`:
  `exit=0` — `ok: 16 themes, seq 3`
- `git diff --stat` on the two writer paths, as the spec requires:
  ```
  catalog/themes/_catalogue.json              |  4 +--
  packages/kybernos-theme/gallery.json        | 50 +++++++++++++++++++++++++++--
  2 files changed, 50 insertions(+), 4 deletions(-)
  ```
  and the generated diff adds exactly two `"id"` lines: `cabinet-medical`, `recrutement-ssii`.

**DoD 3 — `node --input-type=module -e "…"` (real loader, each pack with its theme reference)**

- before: `exit=1`
  ```
  pack not offered: recrutement
  sante: theme undefined (want cabinet-medical)
  ```
- after: `exit=0` — `ok: edu, sante, immo, droit, fin, com, mkt, dev, recrutement, general`
  (note the order: `90` lists recruitment after `dev` and before the catch-all `general` `99`)

**DoD 4 — `node --input-type=module -e "…"` (bilingual everywhere, id/order free)**

- before: `exit=1` — `no pack file: recrutement.json`
- after: `exit=0` — `ok: 10 packs, every text in fr, order 90 free`

**DoD 5 — `grep -q "'theme'" packages/kybernos-plugin/domain-pack.mjs`**

- before: `exit=1`
- after: `exit=0` — **green through A2-pack-format's uncommitted diff**, see the precondition above.

**Gates (green at the baseline, must stay green — none "fixed" here)**

| Gate | Result |
|---|---|
| `node packages/kybernos-plugin/test-domain-pack.mjs` | `exit=0`, **52 checks passed** (was 42 at the gate; A2 added ten) — includes the tenth pack, the accent set, the presets map, the teams, the connectors, the file sweep |
| `node scripts/run-all-tests.mjs --only themes` | `exit=0` — `3 test files in 0 s: 3 green, 0 RED` |
| `node scripts/test-onboarding.mjs` | `exit=0` — `all checks passed` (the field-from-a-sentence corpus, the cron-label gate, the miniature caps and the kit recompute all hold with the tenth pack loaded) |
| `packages/kybernos-registry/test-skill.mjs` | `exit=0` — `7 checks passed`: every skill and connector the new pack names was already listed by the skills document, so nothing outside this perimeter had to change |
| `node scripts/garde-depot.mjs` | `exit=0` — `1944 tracked files — 0 error(s), 1 warning(s)`; the warning names `docs/tests/gate-verdicts-final.md` (a post-baseline campaign file, not mine). My five files carry no `/Users/` path and no media (grep-verified), and no markup `</?[a-z]` |
| `node scripts/test-lifecycle-engine.mjs` | `exit=0` — `82 assertions, 0 échec` |
| `node scripts/test-paquet.mjs` | `exit=0` — `111 assertions, 0 échec(s)` |
| `node scripts/run-all-tests.mjs` | `529 test files in 193 s: 515 green, 14 RED`, none naming an A3 file: `test-consistency-guards`, `test-help-mounts`, `test-help`, `test-layout`, `test-no-french-literals`, `test-no-legacy-hosts`, `test-plugin-scan` (kybernos-pulse), `test-readmes` (kybernos-log), `test-signposts` (kybernos-log), `test-menu-icons`, `test-settings-nav`, `test-servers/test-host`, `test-themes/test-client`, `test-themes/test-icon-sets` — the pre-existing reds of D8 plus the neighbours' in-flight bundles/diffs. **No "all exit 0" is claimed anywhere in this report.** |

## Perimeter proof

`git diff --name-only -- packages/kybernos-plugin/domains catalog/themes packages/kybernos-theme/gallery.json`
(the tracked files I modified):

```
catalog/themes/_catalogue.json
packages/kybernos-plugin/domains/sante.json
packages/kybernos-theme/gallery.json
```

`git status --porcelain` on the same paths (the new files):

```
?? catalog/themes/cabinet-medical.json
?? catalog/themes/recrutement-ssii.json
?? packages/kybernos-plugin/domains/recrutement.json
```

`git status --porcelain -- packages/kybernos-plugin/domains/skills` → empty: the skills folder is
untouched, as interpretation 1 (a) requires.

The repo-wide `git diff --name-only` is **not** an A3 statement in this worktree: the shared tree
carries the neighbours' uncommitted diffs at the time of writing —
`.claude/skills/ux-bug-hunter/probes.js`, `docs/dev/schemas/plugin.schema.json`,
`packages/kybernos-composio/cordis.patch.yml`, `packages/kybernos-plugin/{domain-pack.mjs,index.js,onboarding-state.mjs,plugin.json,test-domain-pack.mjs,test-onboarding-state.mjs}`,
`packages/kybernos-registry/*`, `packages/kybernos-skills/*`, `packages/kybernos-theme/*` (outside
`gallery.json`), `scripts/check-hit-targets-live.mjs`, `scripts/check-ux-probes.mjs`,
`scripts/test-themes-catalogue.mjs` — plus the pre-existing untracked media and campaign folders.
None of them was written or reverted by this batch; the only A3 lines in that whole diff are the
five paths listed above (the two sector themes are the only `+` in `gallery.json`, and the
`_catalogue.json` hunk is `seq`/`publishedAt`).

## Anchors that had drifted, and what was verified instead

The spec pinned every anchor to `2ac67fb4`; the worktree moved, and part of it moved **during** this
batch (the neighbours' diffs grew between my first and last run). Re-verified against the current
files:

| Pinned claim | State now | Verified instead |
|---|---|---|
| `domain-pack.mjs:71` — allowlist without `theme`; cleaned object `:187` | **moved and widened** by A2's uncommitted diff: allowlist at `:79` *with* `'theme'`, cleaned object at `:198` with `theme: raw.theme === undefined ? null : raw.theme` | read the live file; DoD 5 runs the spec's own grep, not the old line; DoD 3 runs the real loader |
| `test-domain-pack.mjs:257` id list, `:290` preset map, `:322-327` file sweep | **already A3-proof** in the worktree (A2's interpretation 11): `:281` "the nine fields of work **keep their order**, the catch-all last", `:315` "only Development starts in code mode"; my tenth pack passes both, and the file sweep no longer hardcodes nine names | ran the suite: 52/52, with `recrutement` loaded |
| `client.js:35753-35762` scorer, `:35759` weight, `:35772-35782` cron label, `:35791-35801` miniature caps, `:35730` sensitive fields | the worktree drift is now larger than the spec's +126: `kbObDomainFromText` `:35952`, `kbObCronLabel` `:35971`, `kbObPreviewOf` `:35990`, `kbObKitOf` `:35931` | read those live blocks and designed the content to them: crons only in the four labelable shapes (`0 18 * * 1-5`, `0 9 * * 1`, `0 17 * * 1-5`, `0 9 * * 1`, `0 8 * * 1`); keywords chosen so no corpus sentence changes winner (verified by `test-onboarding.mjs` green); preview caps hold (1 team, 3 starters, 7 skills, 3 automations) |
| `preset-store.mjs:43-52` `SETTINGS_KEYS`, `:64` `OV_KEY`, `:104` silent drop | unchanged in shape (`packages/kybernos-theme/preset-store.mjs` is modified by A1-theme-seam, `SETTINGS_KEYS` still 37 keys) | DoD 1 asserts the surviving key set explicitly (`mode, acc, fontText, radius, ov`, nothing else) and `sanitizeTheme` accepted both files |
| `themes-catalogue.mjs:25` `THEME_ID_RE`, `:33` `LIMITS`, `:44-62` `sanitizeTheme` | file modified by A1-theme-seam since the baseline; the id/limit/language rules DoD 1 depends on still hold | DoD 1 runs `sanitizeTheme` itself, not a copy of its rules |
| `scripts/themes-catalogue.mjs:43` file-name=id, `:66-70` `--bump` | unchanged | the build ran through that code path (`16 themes, seq 3`) |
| `sante.json:5` accent, `:6` icon, `:70-76` agents, `:78-329` goals | **shifted +1 by this batch's own insert** (`theme` is now `:5`, accent `:6`, icon `:7`): agents `:71-77`, goals `:79`, file 331 lines | stated here so no reviewer reads the old numbers against the new file; DoD 1 compares the theme accent to `accent` by key, not by line |
| `gallery.json` "generated, never hand-edited"; `tests-themes-catalogue.mjs:34-37` | unchanged rule; gallery rebuilt by the CLI | DoD 2 compares the file byte-for-byte to `buildDocument()` |

## Capture (measured, not claimed)

`node scripts/check-theme-live.mjs --only gallery,skins --shots /tmp/a3-shots` (shots outside the
repository, as repo rule 4 and the spec require) — **exit 1**, not 3:

- **gallery section: SKIPPED, with its printed reason** —
  `the gallery is read by the HOST and caches under <DSH_HOME>/kybernos: it needs the isolated
  instance (source scripts/sandbox/env.sh; this run targets 127.0.0.1:3080)`. Recorded as
  **skipped**, never as a pass; the capture item stays **open and A1-owned** (the spec's own
  `capture:` clause, `:90-93`). So the two gallery cards were **not** looked at: no `read_image`
  claim is made about them.
- **skins section: ran**, `11 ✓ 13 ✗`. All 13 failures name built-in themes only (`Deep blue`,
  `Aurora`, `Nebula`, `Amber`, `OLED midnight`, `Ember`, `Stone & Cloud`, `Indigo pulse`,
  `Midnight pulse`, `Olive grove`, `Floral dawn`, `Twilight dream`, `Plum mist`) with
  `wallpaper <div> count 2` / `unexpected wallpaper <div> (1)`; **neither new theme is named**, and
  neither carries a `wp` (wallpaper) setting, so this section cannot fail *because of* them. It is a
  live-UI finding for A1/A5's area, recorded as such, not a pack edit.
- one shot produced: `/tmp/a3-shots/02-skins.png` (outside the repo; git never sees it).

## Out of scope, respected

No line of `client.js`, `domain-pack.mjs`, `index.js`, `onboarding-state.mjs`; no test written or
patched; no `domains/skills/` folder; no dashboard, listing, team template, connector or signing
work; `dsh-compat.json` untouched. The two platform needs the content ran into are already written
in the spec's platform-evolution list (`:236-240`) and are not smuggled in here: a sector's own
Agent Team (`recrutement` carries the `soon` line `Recruitment desk team` / `Équipe Recrutement`,
exactly as `sante.json:137-142` does) and a first-class provenance marker for authored content.
