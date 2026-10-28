# A2-registry-points — implementation report

**verdict: pass.** Batch implemented under `docs/tests/A2-registry-points-strategy.md` (verdict GO,
`docs/tests/gate-verdicts-final.md`), from the repository root, on the shared worktree.

## ROOT CAUSE (lane A, one line)

The registry knew one contribution shape only — a flat `*.json` file per point — so a pack's skills, which are
folders that must arrive whole, could never reach their owner point; A2 declares `files: "json" | "folder"` in the
point contract (default `"json"`, so the two shipped JSON points do not move) and adds a bounded, link-refusing
folder reader, with no route, no guard, no boot path and no write to disk touched.

## files touched (8, every one inside the batch's perimeter)

| file | what it carries |
|---|---|
| `packages/kybernos-registry/registry.mjs` | `definePoint` keeps `files` (`json`/`folder`, absent = `json`, any other value raises the existing `a point needs …` error); `points()` reports it; `readExtension` dispatches on it; `readFiles` is the old JSON body, unchanged in behaviour; `readFolders` + `readContribution` read one immediate sub-folder per contribution, recursively, under the bounds of INT3; `LIMITS` gains `folderFiles: 50`, `folderBytes: 1 MiB`, `folderDepth: 4`; `FOLDER_NAME` is the family of the JSON filter |
| `packages/kybernos-registry/manifest.mjs` | rule 3, right after the exactly-one-of rule: a data point with `files: "folder"` and a `schema` is a fault; a code point with `files` is a fault |
| `packages/kybernos-registry/plugin.schema.json` | `$defs.provided.properties.files` = `{ "enum": ["json","folder"], "description": … }`, after `validator` |
| `docs/dev/schemas/plugin.schema.json` | the same edit, byte for byte (the person's copy) |
| `packages/kybernos-skills/plugin.json` | one `provides` entry (`skill`, `1.0`, `data`, `instruction`, `validator: builtin`, `files: folder`); `version` 1.0.0, `family`, `entry`, `permissions`, `claims` untouched (INT6) |
| `packages/kybernos-skills/index.js` | `validateSkillContribution` (adapter over `validateTeamSkill`), `SKILL_POINT` (`kybernos/skills`, `1.0.0`, `skill`, `1.0`, `data`, `instruction`, `files: folder`, `max: 32`), the `try/catch` seam reader and `tellSkillPoint()`, told at boot in `apply()` and at each catalogue question |
| `packages/kybernos-registry/test-registry.mjs` | the five pinned cases (journey, folder kept whole, refusals, `files` reporting, the manifest rule) and `manifestErrors` imported for the last one |
| `docs/tests/impl-A2-registry-points.md` | this report |

**Decision taken where the spec asked for one (INT4/DoD 2):** a folder contribution is kept whole or refused
whole. DoD 2 requires a folder holding a link to *not* contribute, and a partial envelope (`files: [...]` minus the
refused file) would lie about "its files kept whole", so a link, a file over `LIMITS.file`, 51 files, more than
1 MiB or a folder deeper than 4 refuses the contribution with what was wrong inside it (up to 6 lines), and the
contribution is named in `rejected`. A non-directory entry at the root of a folder point is named
(`… is not a folder`), as INT4 asks, and a folder name outside `FOLDER_NAME` is named tidily, never echoed raw.

**Dead-code rider:** nothing deleted, and nothing in the perimeter became dead — the JSON path is untouched and
still the default used by the two shipped points (`kybernos/core#domain-pack`, `kybernos/dashboards#preset`), and
the new folder path is exercised by five test cases plus DoD 1–3. No code in the seven files was provably dead.

## DoD before → after (each command run from the repository root; exit codes and last lines are measurements)

| DoD | before | after |
|---|---|---|
| 1 | **exit 1** — `FAIL: contributions = [] / extends = [{"point":"kybernos/skills#skill","contributions":0,"rejected":[]}]` | **exit 0** — `OK: one contribution per folder, its files kept, files: "folder" reported` |
| 2 | **exit 1** — `FAIL: a folder without SKILL.md is not refused with its error list: []` | **exit 0** — `OK: a bad folder is skipped with its errors, a link is refused, a stray file is named, the cap counts folders` |
| 3 | **exit 1** — `FAIL: a point without files defaults to "json": {"id":"kybernos/skills#skill","owner":"kybernos/skills","name":"skill","version":"1.0","kind":"data","class":"instruction","contributions":0}` | **exit 0** — `OK: files defaults to json, folder is kept, a bad value raises` |
| 4 | **exit 1** — `FAIL: the owner manifest with a folder point is refused: /provides/0/files is not a known key` | **exit 0** — `OK: a folder point needs a validator, a schema or a code point is refused, both copies carry files` |
| 5 | **exit 1** — `FAIL: the bundle does not define kybernos/skills#skill through the seam: undefined` | **exit 0** — `OK: declared in plugin.json, told at boot, absent registry tolerated` |
| 6 | **exit 1**, no output — the chain stops at the first `grep -qF`, none of the five titles is in `test-registry.mjs` | **exit 0**; each of the five titles measured present one by one: `✓ one plugin ships five folders: each point reads its own, nothing runs`, `✓ a skill folder is one contribution, its files kept whole`, `✓ a folder point refuses what it cannot trust, with its error list`, `✓ a point says whether its contributions are files or folders`, `✓ a folder contribution cannot be checked by a JSON schema`; suite last line `REGISTRY OK` |
| 7 | **exit 0** (measured: tail `MOTEUR DE CYCLE DE VIE — 82 assertions, 0 échec`, `PAQUETAGE — 111 assertions, 0 échec(s)`; the spec's baseline for the first command was `1922 tracked files — 0 error(s), 0 warning(s)`) | **exit 0** — `1944 tracked files — 0 error(s), 1 warning(s)` / `MOTEUR DE CYCLE DE VIE — 82 assertions, 0 échec` / `PAQUETAGE — 111 assertions, 0 échec(s)`. The single warning is a hard-coded personal path in `docs/tests/gate-verdicts-final.md`, the gate's own document committed after the baseline — outside A2's perimeter, and A2's seven files add neither an error nor a warning |

All six failing DoD failed **before** any line was written, each with the exact last line the spec predicted, so
each one discriminates. Nothing was coded before that capture. The seven DoD were re-run once more after this
report was written: **DoD 1 to 7 → exit 0, zero failures.**

## regression gate (read as regression only, with the baseline written next to it — never "green today")

| command | result measured now | baseline / attribution |
|---|---|---|
| `node scripts/run-all-tests.mjs --only kybernos-registry` | 6 files, **6 green** | green at the baseline, green now |
| `node scripts/run-all-tests.mjs --only test-host` | 33 files, 32 green, **1 RED**: `packages/kybernos-servers/test-host.mjs` | red is a neighbour's, not A2's — proof below |
| `node scripts/run-all-tests.mjs --only test-write-guard` | 27 files, **27 green** | green |
| `node scripts/run-all-tests.mjs --only test-skill` | 4 files, **4 green** | green |
| `node scripts/run-all-tests.mjs --only kybernos-skills/test-index` | 1 file, **green** | green |
| `node scripts/run-all-tests.mjs --only test-seed-skills-drift` | 1 file, **green** (five copies still identical) | green, no sixth copy (INT5) |
| `node scripts/run-all-tests.mjs --only test-plugin-manifest` | 1 file, **green** | green |
| `node scripts/test-plugin-scan.mjs` | **exit 1** — `PLUGIN SCAN — 15 ok, 1 failed` (`kybernos-pulse → exec`) | the same single failure as the baseline, no second |
| `node scripts/build-catalog.mjs --check` | **exit 0** — `✓ catalogue up to date (48 modules)` | green (INT6: no version bump) |
| `node scripts/test-layout.mjs` | **exit 1** — `LAYOUT — 21 checks, 2 failure(s)`, both `kybernos-log` | the same two neighbour failures |
| `node scripts/test-no-french-literals.mjs` | 380 ✓, **2 ✗** — `["kybernos-log"]` and the neighbour's `client.js:33876`/`index.js:11628` | the same neighbours; A2's new strings are English |
| `node scripts/run-all-tests.mjs` | **exit 1** — `529 test files in 224 s: 515 green, 14 RED` | 8 RED at the baseline; **14 now, none of them A2's** (see below) |

**The 14 red, attributed (D8 shape).** The baseline's 8 are still red for the same reasons
(`test-consistency-guards`, `test-help-mounts`, `test-layout`, `test-readmes`, `test-no-french-literals`,
`kybernos-plugin/test-settings-nav`, `test-plugin-scan` → `kybernos-log` and `kybernos-pulse`; `test-help` → the
pre-existing docs gap). Six more appeared between the baseline and this run, all measured outside A2:

- `test-no-legacy-hosts`, `test-signposts`, `kybernos-plugin/test-menu-icons`, `kybernos-servers/test-host` —
  each fails **identically on a pristine `git archive HEAD`** (no A2 file present). For the servers one the cause
  is named: commit `e52c7c72 cloud: the built-in server is https://server.kybernos.app` moved the built-in address
  while `packages/kybernos-servers/test-host.mjs` still asserts `api.kybernos.app` (that test is green on a
  pristine `git archive 2ac67fb4`).
- `kybernos-theme/test-client`, `kybernos-theme/test-icon-sets` — these two reproduce on a pristine `HEAD` archive
  into which **only the neighbour's `packages/kybernos-theme/` and `catalog/themes/`** were copied: no file of this
  batch is present, and they fail on `["cabinet-medical","recrutement-ssii"]` — the two untracked theme files the
  neighbouring A1/A3 chantier is landing right now.

The tree is not green, and this report does not claim it is. A2 adds no ninth-then-tenth red.

## probe of the real adapter (measured, not committed — the registry test keeps stand-ins by design)

A throw-away probe under the OS temp folder took `SKILL_POINT` from the seam (as DoD 5 does), defined it on a real
registry, and pointed it at a profile whose package ships three skill folders:

- told: `{"owner":"kybernos/skills","name":"skill","files":"folder","max":32}`;
- `skills/consultation` (SKILL.md + reference.md) → one contribution, `files: ["SKILL.md","reference.md"]`,
  `version` = the `validateTeamSkill` SHA-256, `description` from the frontmatter;
- `skills/noskillmd` → refused `no_skill_md`; `skills/badfront` (frontmatter `name` ≠ folder) → refused
  `frontmatter: SKILL.md`.

So the folder reader and the owner's real rules meet: the adapter adds no second implementation of the skill rules
(INT2/INT5).

## perimeter proof

`git diff --name-only` (the shared worktree is being written to by neighbour sessions **while** this batch runs;
the seven batch paths are marked `A2`, the rest are concurrent neighbour work — none of them written by this batch,
none of them read by the batch's code):

```
.claude/skills/ux-bug-hunter/probes.js                    (neighbour)
catalog/themes/_catalogue.json                            (neighbour)
docs/dev/schemas/plugin.schema.json                       A2
packages/kybernos-composio/cordis.patch.yml               (neighbour)
packages/kybernos-plugin/domains/sante.json               (neighbour)
packages/kybernos-registry/manifest.mjs                   A2
packages/kybernos-registry/plugin.schema.json             A2
packages/kybernos-registry/registry.mjs                   A2
packages/kybernos-registry/test-registry.mjs              A2
packages/kybernos-skills/index.js                         A2
packages/kybernos-skills/plugin.json                      A2
packages/kybernos-theme/client.js                         (neighbour)
packages/kybernos-theme/gallery.json                      (neighbour)
packages/kybernos-theme/index.js                          (neighbour)
packages/kybernos-theme/plugin.json                        (neighbour)
packages/kybernos-theme/preset-store.mjs                  (neighbour)
packages/kybernos-theme/test-client.mjs                   (neighbour)
packages/kybernos-theme/test-preset-store.mjs             (neighbour)
packages/kybernos-theme/test-themes-catalogue.mjs         (neighbour)
packages/kybernos-theme/themes-catalogue.mjs              (neighbour)
scripts/check-hit-targets-live.mjs                        (neighbour)
scripts/check-ux-probes.mjs                               (neighbour)
scripts/test-themes-catalogue.mjs                         (neighbour)
```

Untracked and new in this batch: `docs/tests/impl-A2-registry-points.md` (this report). Nothing else was created.

**Lane A falsifier, proved:** `git diff --stat packages/kybernos-registry/host.mjs packages/kybernos-registry/client.js`
prints nothing — the origin fence and signed-session guard (`host.mjs:166-170`), the six routes
(`host.mjs:151-158`) and the registry page are untouched. `host.mjs:114` still answers the points, now carrying
`files`, without a route change (C1).

## anchors: what was re-verified, and the one number the batch moved

Re-pinned against the **current** files before the first write (nothing had drifted from the base commit):

- `registry.mjs` — `:20` `LIMITS`, `:39` `readBounded` symbolic-link refusal, `:199-210` the point contract and
  `definePoint`, `:232-253` `readExtension`, `:240` the JSON filter, `:241` the cap wording, `:248` "the check
  itself failed", `:290-295` `warnOnce`, `:300-301` `points()`: all exact.
- `manifest.mjs:84` — the exactly-one-of rule, so the two new rules sit right after it (handoff placement).
- `plugin.schema.json` — `$defs.provided` `:214-230`, its `properties` `:221-229`, `$defs.extension` `:231-240`.
- `team-skills.mjs` — `validateTeamSkill` `:188-228`, `TEAM_SKILL_LIMITS` `:9-16` (the folder bounds are the same
  numbers).
- `packages/kybernos-plugin/index.js` — the seam exemplars measured **in this worktree** at `:10728` (comment),
  `:10730` (the `try/catch` reader), `:10736` (told at each question), `:10740` (told at boot): exactly the values
  the spec's drift note predicted (`2ac67fb4` was `:10718/:10724/:10728`), so nothing had to be re-pinned.
- `packages/kybernos-skills/index.js` — `/install` and its guard untouched; the new block sits above
  `mountWebRoutes`, the boot tell inside `apply()`, the question tell inside the catalogue `GET`.
- `test-registry.mjs` — the fixture `:40-66`, the "nothing is ever run" invariant `:250-265`, the re-telling case
  `:285`, the throwing-validator case `:301` and the schema-pair assertion `:350` were green before and after.

**One number did move, by construction:** `test-registry.mjs` grew by 158 lines, so its last section (the schema
pair) now starts at `:483` instead of `:350`. The content is untouched; the move is this batch's, not a drift.

## out of scope, kept out

No write to `<DSH home>/skills` or `<DSH home>/kybernos/**`, no sixth `seed-skills.mjs` copy (INT5 — the seeding
write stays a platform-evolution request), no new route and no guard touched, no client page or screenshot
(`vision:`/`capture:`/`maquette:` not applicable, as the spec states), no docs prose outside this report,
`kybernos-skills` keeps `version: 1.0.0` (INT6) and the catalogue is fresh.
