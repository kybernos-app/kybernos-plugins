# A4-starter-docs — test strategy, written before the code

Batch: **A4-starter-docs** (Phase A, wave 4 of 4: theme seam, registry multi-point scan, two verticals, then this one).
Lane: **B**. **baseline: 2ac67fb4** — every `file:line` below was read with `git show 2ac67fb4:<path>` on 2026-10-28,
and every command in section 5 was run on this tree (HEAD `bd8754be` plus the neighbour session's uncommitted diff,
whose two effects are named where they matter). The strategy document and the six specs were amended after the
baseline; the anchors are the base-commit readings and are re-pinned when this batch opens (D1). Nothing this file
freezes existed when it was written: no page, no template folder, no `scripts/plugin-check.mjs`.

**Naming (owner, 2026-10-28).** The installable sector unit is the **theme**; the visual layer (token overlay,
presets) is the **style**. Code paths keep their old names (`packages/kybernos-theme`, `theme-presets.json`) until
the rename batch A5 lands, so a path below that says "theme" about a token file carries the old word. "Pack"
survives only in code names (`validatePack`, `domain-packs.md`, `plugin.schema.json`) and in quoted text.

**The frozen contract, stated once.** Everything else in this file refers to these three sentences instead of
restating them, and nothing in the batch may contradict them:

1. **The page's frozen-interface table is keyed by point ids** — `kybernos/core#domain-pack`,
   `kybernos/theme#theme`, `kybernos/skills#skill`, `kybernos/core#team-template`,
   `kybernos/core#automation-template`. The five interface letters of the request appear nowhere in the repository
   and the campaign retired them (D3); no document of this campaign uses them any more, this one included.
2. **The starter's style file is the light shape** `{ id, name, settings }` (D2), with exactly those three keys.
   `sanitizePreset` accepts a superset by *dropping* every key it does not know
   (`packages/kybernos-theme/preset-store.mjs:92-115`), so a catalogue-style entry (`description`, `license`, …)
   would lose that data silently instead of failing. The template therefore ships the light shape and says why.
3. **The check ids are the tool's own list** (section 4.D) and the broken-variant table quotes them verbatim; a
   seeded fault that maps to no id is a fault that does not ship. The id vocabulary is closed: `manifest.present`,
   `manifest.json`, `manifest.schema`, `manifest.rules`, `manifest.points`, `package.data`, `point.<point-name>`,
   `code.scan`, `claims.unique`, `help.card`, `compat.zone`, `hygiene`, `archive`.

This batch ships no runtime behaviour: one English page, one copyable template folder, one read-only report tool and
its own test. "Green" here means three falsifiable things, and nothing else:

1. the page's promises are **executable** (its commands run, its JSON example is accepted by the repo's own
   validator, its frozen-interface table names points that exist);
2. the template **teaches the validator** (it passes as shipped, and every broken variant fails with exactly one
   named check);
3. the tool **reports and never repairs** (same checks for our modules and for a stranger's folder, the checked
   folder is byte-identical afterwards).

Files this batch may write (delegation contract):

```
docs/dev/sector-bundles.md
docs/dev/domain-packs.md            (rows + head link only)
docs/dev/plugin-contract.md         (rows, scan wording, conformance section + head link only)
docs/dev/templates/acme-vet-clinic/
scripts/plugin-check.mjs
scripts/test-plugin-check.mjs
```

Files it must **not** write, and reads instead: `packages/**`, `catalog/**`,
`docs/dev/schemas/plugin.schema.json`, `scripts/garde-depot.mjs`, `scripts/plugin-scan.mjs`,
`scripts/lifecycle-packages.json`, `docs/beta/satellites.json`,
`packages/kybernos-hub/catalog.json`, `scripts/plugin-scan-exceptions.json`.

The page keeps the frozen path `docs/dev/sector-bundles.md` although its H1 is "Build a theme": the path is already
linked from two binding specs (section 4.E), and the rename batch A5 owns any move of it. The name is history, recorded once: the file name
says "sector bundles" because that was the unit's name when the campaign opened, and the unit it documents is now the
theme.

---

## 1. Interpretations, and the one I chose

The request admits several readings on five points. Each one changes either the files touched, the DoD, or the truth
of a binding document, so each is settled here with its reason — and the ones a human may still want to arbitrate are
repeated as `AMBIGUITY:` lines in section 3.

### 1.1 What "the five frozen interfaces" are

The batch says the page carries five frozen interfaces under labels the request gives as letters. **Those letters
appear nowhere in the repository** (zero occurrences at `2ac67fb4`), the strategy document holds no five-interface
list, and the phrase itself is another spec's name for a pack's frozen shape — a different object. The campaign
retired the letters in favour of point names (D3, section 2.3, fact 6).

Readings:

- **(a) the five data points a theme can target** — `kybernos/core#domain-pack`, `kybernos/theme#theme`,
  `kybernos/skills#skill`, `kybernos/core#team-template`, `kybernos/core#automation-template` — the five rows of
  the contract table (`docs/dev/plugin-contract.md:263-274`) that a theme can actually contribute to, with
  `kybernos/dashboards#preset` deliberately **out** (`:266`) because it is still not built;
- (b) the five-part *bundle anatomy* of the strategy (`plugin.json` + four folders);
- (c) something the human has in mind that is written down nowhere.

**Chosen: (a).** It is the only reading that can be made deterministic: every row of the page's table must name a
point that some `plugin.json` in `packages/*/plugin.json` declares in `provides[]`, and that check is a DoD command
(D11). Reading (b) is already the page's walkthrough and would make the label redundant; (c) cannot be specified.
The page's table is therefore keyed by the five point ids, one row each, and each row says *what you ship* and
*which validator the tool runs*.

### 1.2 The starter's `package.json`: with or without a `dsh` key

`packages/kybernos-registry/skills/plugin-creator/SKILL.md:47-67` (the ceiling this batch must respect) gives a data
plugin four files including a `package.json` that **does** carry
`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`, and the registry's own fixtures do the same
(`packages/kybernos-registry/test-host.mjs:44-45`). The batch's interdiction says the `plugin.json`/`dsh`
declaration point "must not be engaged".

Readings: (a) copy the skill's four-file shape, `dsh.bundle.patch` + an empty `cordis.patch.yml`;
(b) no `dsh` key at all.

**Chosen: (b), no `dsh` key.** `packages/kybernos-registry/registry.mjs:54-72` (`dataPackageProblems`) tolerates a
`package.json` without any `dsh` key, and `:127` only requires a `package.json` to exist (the empty patch is
*allowed*, `:60-66`, not required). A template that shows an outsider how DSH loads a package should show the
smallest true thing: nothing to load, no patch file to explain. Consequence recorded: the page must say why there is
no `cordis.patch.yml` here, and the divergence from `plugin-creator`'s draft shape is flagged in section 3
(arbitration A2).

### 1.3 `plugin-check.mjs <folder | archive>`

`docs/dev/plugin-contract.md:486` promises a folder **or an archive**; archives need `tar` reading and per-file
hashes, which the same section lists as phase-B work (`:488-498`, "archive hygiene and hashes"), and the batch's
objectif says "one report, the same checks". Readings:

- (a) implement archives too — a tar reader, hash comparison, `telechargement.mjs` reuse;
- (b) folder-only in v1, and the contract line narrowed to what exists.

**Chosen: (b).** It keeps the batch at "docs + a read-only report" and keeps the contract honest; the contract
section gains one sentence saying archives are not built, and the report prints
`SKIP archive  not built (phase B: signed archive and hashes)`. DoD D19 asserts the CLI line names `<folder>` once
the tool exists.

### 1.4 Where the point validators come from, at rest

A check on a folder runs **without a host**: no `definePoint`, no mounted bundle. The validators that exist today are
exported as plain data/functions — `packages/kybernos-plugin/domain-pack.mjs:225-231` (`validateContribution`,
`DOMAIN_POINT`, `DOMAIN_POINT_REF`) and `packages/kybernos-theme/preset-store.mjs:92-115` (`sanitizePreset`) — and
the points A1 and A2 open follow the `{ owner, ownerVersion, name, version, kind, class, validate }` shape the
registry requires (`packages/kybernos-registry/registry.mjs:199-209`; A2-registry adds the `files` field
`folder | json` — read from its sortie, never guessed here).

Readings: (a) the tool re-implements the five validators; (b) it imports whatever the owner bundles export, and
reports `SKIP` when a point has no importable validator.

**Chosen: (b).** Rule "reusing what exists" and the batch's "never write packages/**": duplicating `validatePack` or
`sanitizePreset` would create a second source of truth that drifts the day a limit changes. The test forbids a copy
(unit U17). The point table is built from `packages/*/plugin.json` `provides[]` — the declaration of record, see
`packages/kybernos-plugin/test-domain-pack.mjs:330-339` — joined with the imported point objects. This makes A4
depend on A1 and A2 exporting their point objects; if a point is exported only inside a mount function, the honest
outcome is `SKIP point.<id>` plus a platform-evolution note, never a copy.

### 1.5 How a "named rule" is named

The batch requires each broken variant to fail "with a NAMED rule". Existing validators return English sentences, not
ids (`packages/kybernos-registry/manifest.mjs:53-90` pushes prose into an array; `scripts/test-plugin-manifest.mjs`
matches it with regexes).

**Chosen:** the report has two columns — a **stable check id** owned by the tool, and the **validator's own message
verbatim**. The id is what the fixtures and the docs name (`manifest.rules`, `point.domain-pack`…), so a variant
stays teachable even if a message is reworded, while the message stays checkable against the existing tests'
vocabulary (e.g. `not in requires.plugins`, `manifest.mjs:86-89`).

---

## 2. Anchors verified at the baseline, and facts measured rather than assumed

Every `file:line` below was read at `2ac67fb4` before it was written here. The count is given in section 2.3 so a
reviewer can re-run the same pass; a line that moved between the baseline and the implementation opening is re-pinned
then (D1), never silently kept.

### 2.1 The documents this batch edits or cites

| Anchor | What it actually says / does |
|---|---|
| `docs/etudes/2026-10-27-sector-packs-strategy.md:55-56` | one folder, one `plugin.json`, several `extends` — the sentence the page's opening paragraph cites |
| `docs/etudes/2026-10-27-sector-packs-strategy.md:58-74` | its example manifest block (`acme/vet-clinic`), **invalid as printed** — measured in 2.3, fact 1 |
| `docs/etudes/2026-10-27-sector-packs-strategy.md:81-96` | the build contract: heading `:81`, rule 1 "primitives first" `:86-90`, rule 2 "custom UI lives in Settings" `:91-93`, rule 3 "one data hex per sector, no free CSS" `:94`, rule 4 "cited or labelled" `:95-96` |
| `docs/etudes/2026-10-27-sector-packs-strategy.md:106-110` | composition: the field's accent overrides the preset's, and Settings › Style always wins over the pack (`:107-108`) |
| `docs/etudes/2026-10-27-sector-packs-strategy.md:134-136` | the starter's expected anatomy: `plugin.json`, `domains/`, `themes/`, `skills/`, `teams/`, `automations/`, and the broken variants |
| `docs/etudes/2026-10-27-sector-packs-strategy.md:34` | the WordPress table row: `plugin-check.mjs` is "contract phase 3, **not built**" |
| `docs/etudes/2026-10-27-sector-packs-strategy.md:164` | Phase A step 4: publish the starter template and the "Build a theme" page |
| `docs/etudes/2026-10-27-sector-packs-strategy.md:170` | Phase B: `plugin-check.mjs` published as the developer's one command |
| `docs/dev/domain-packs.md:1-5` | title + intro paragraph (where the page link goes) |
| `docs/dev/domain-packs.md:108` | the "Theme per field" row: `next`, and "no public « apply a preset » call was found" |
| `docs/dev/domain-packs.md:158` | "A plugin pack cannot bundle skills yet." |
| `docs/dev/plugin-contract.md:1-4` | title + status paragraph (where the page link goes) |
| `docs/dev/plugin-contract.md:259-260` | claims the registry "scans the folder … `<DSH home>/kybernos/plugins/<author>/<name>/`" |
| `docs/dev/plugin-contract.md:263-274` | the point table: header `:263`, ten rows `:265-274`; only `core#domain-pack` `:265` is `**opened 2026-10-21**`, `:266` is `dashboards#preset`, `:269-272` are the four this campaign opens |
| `docs/dev/plugin-contract.md:477` | repeats the same `<DSH home>/kybernos/plugins/<author>/<name>/` install path |
| `docs/dev/plugin-contract.md:484-500` | section 11, the conformance tool; `:486` is `node scripts/plugin-check.mjs <folder \| archive>`; `:488-498` the nine-check table; `:500` "necessary for every level and sufficient for none" |
| `docs/dev/plugin-contract.md:550`, `:603` | the **real** read location: `<DSH home>/profiles/web/package.json` + `node_modules/<name>/plugin.json` |
| `docs/handoff/theme-recrutement-ssii/maquette-v1/maquette.html:23` | `--vb-accent: #4F5BD5` — the recruitment accent, and its lint allowlist `maquette.json:13-15` |
| `docs/handoff/theme-medecin/maquette-v1/maquette.html:23` | `--vb-accent: #1B7F76` — the cabinet-medical accent (`maquette.json:13-15`) |
| `docs/tests/triage.md:1-3` | the binding triage: `chemin: complet`, three sensitive files |

### 2.2 The code it reads

| Anchor | What it actually says / does |
|---|---|
| `packages/kybernos-registry/host.mjs:32` | `profileDir: join(home, 'profiles', 'web')`, `stateFile … kybernos/plugins-state.json`, `draftsDir … kybernos/plugin-drafts` — matches `plugin-contract.md:550`/`:603`, **not** `:259-260`/`:477` |
| `packages/kybernos-registry/registry.mjs:54-72` | `dataPackageProblems`: any `dsh.*` key, install script or `bin` would make DSH load code; `:60-66` allows `dsh.bundle.patch` only if the patch is an empty list |
| `packages/kybernos-registry/registry.mjs:112-133` | `inspectPackage`: a data plugin needs a `plugin.json` **and** a `package.json` (`:127` is the second) |
| `packages/kybernos-registry/registry.mjs:199-209` | `definePoint` contract: `{ owner, ownerVersion, name, version "x.y", kind: "data", class: inert\|instruction, validate, max }` |
| `packages/kybernos-registry/registry.mjs:233-253` | `readExtension`: reads only the `*.json` files of `extends[].dir`, up to `point.max`; a non-folder is rejected |
| `packages/kybernos-registry/registry.mjs:297-310` | public API of a registry (`definePoint`, `points()`, `preview(id)` …) — none of it can validate an uninstalled folder |
| `packages/kybernos-registry/manifest.mjs:17-20` | `SCHEMA_FILE`, `RESERVED_NAMESPACES = ['kybernos','dsh','local']` |
| `packages/kybernos-registry/manifest.mjs:86-89` | you cannot extend a point of a plugin you do not `requires.plugins` |
| `packages/kybernos-registry/plugin.schema.json` + `docs/dev/schemas/plugin.schema.json` | the schema pair, kept identical by `packages/kybernos-registry/test-registry.mjs:350`. **Read only, never written by A4.** |
| `scripts/plugin-manifest.mjs:1-2` | re-exports the registry bundle's `manifest.mjs` |
| `scripts/schema-subset.mjs:1-2` | re-exports the registry bundle's `schema-subset.mjs` |
| `scripts/test-plugin-manifest.mjs:70-75` | a ready `acme/vet-clinic` fixture: id, `name.en/fr`, `author.id: 'acme'`, `CC-BY-4.0`, `free`, extends `kybernos/core#domain-pack`; `:88` asserts it is accepted; `:90-95` validates the manifests printed in the contract and requires exactly three |
| `scripts/test-layout.mjs:46-58` | the declaration points (robot list, `satellites.json`, `package.json` `dsh` field) — they apply to **`packages/` dirs only** |
| `scripts/test-layout.mjs:101-122`, esp. `:112` | the first-party manifest `ctx` (`firstParty`, `dir`, `suiteZone`, `packageJson`, `fileExists`) — the exact recipe "same checks for us" mirrors |
| `scripts/build-catalog.mjs:214-222`, `:231` | the catalogue is derived from `packages/<dir>/plugin.json`; `--check` compares |
| `scripts/plugin-scan.mjs:15` | `PACKAGES = join(REPO,'packages')` |
| `scripts/plugin-scan.mjs:23-24` | `sourceFiles(dir)` joins `PACKAGES` → **cannot** scan an arbitrary folder; `:57` `scanText`, `:109` `uncovered` are pure and reusable |
| `scripts/garde-depot.mjs:11-12`, `:20-25`, `:28-35`, `:45-59` | `MEDIA` and `SECRET` regexes are **module-private**; exported: `isScanned`, `personalPath`, `personalMails`, `warningsOf`; runs on `git ls-files`, warns on `/Users/<name>` and on mail addresses |
| `packages/kybernos-plugin/domain-pack.mjs:28`, `:68`, `:225-231` | `LIMITS`, `validatePack`, `validateContribution`, `DOMAIN_POINT` (with `max: 12`), `DOMAIN_POINT_REF` |
| `packages/kybernos-theme/preset-store.mjs:43-52`, `:63`, `:92-115` | the token vocabulary (`acc`, `fontText`, `radius`…), `HEX6`, `sanitizePreset` (light shape, unknown keys dropped, ≥1 known setting) |
| `packages/kybernos-registry/skills/plugin-creator/SKILL.md:13-20`, `:47-67`, `:69-85`, `:87-88` | the ceiling: data only, runs nothing, four files, no `scripts`/`bin`/`main`, `local/<name>` id, `description` ≤ 240 characters |
| `packages/kybernos-registry/test-host.mjs:44-45` | the registry's own fixture package carries `dsh.bundle.patch` + an empty patch file |
| `packages/kybernos-plugin/test-domain-pack.mjs:330-339` | the point a manifest declares is the point the code defines (`provides[]` is the declaration of record) |
| `scripts/run-all-tests.mjs:23-45` | `discover()`: `scripts/test-*.mjs` + `packages/*/test*.mjs` + the two `node --test` folders + the services' `*.test.mjs` |
| `scripts/run-all-tests.mjs:75`, `:104-114` | `--only <text>` filters the discovered files; the flag plumbing |
| `scripts/test-en-quotes.mjs:10`, `:16-23` | scans **only** `packages/*/client.js` |

### 2.3 Measured, not assumed (commands run in this repository on 2026-10-28)

1. **The strategy's own example manifest is invalid.** Lines `:59-73` of
   `docs/etudes/2026-10-27-sector-packs-strategy.md`, fed to `manifestErrors({}, …)`, return
   `(root) "description" is required`; with a `description` added, it returns, in this order,
   `extends "kybernos/skills#skill" but "kybernos/skills" is not in requires.plugins` and
   `extends "kybernos/dashboards#preset" but "kybernos/dashboards" is not in requires.plugins`. The page must
   therefore **not** copy that block; it shows the corrected manifest, and the defect is recorded as a follow-up
   (section 8, F1).
2. **The two specs contradict themselves on the scan folder.** `plugin-contract.md:259-260`/`:477` claim
   `kybernos/plugins/<author>/<name>`; `:550`/`:603` and `registry.mjs:297-310` + `host.mjs:32` say
   `profiles/web/package.json` + `node_modules/<name>/`. A4 aligns `:259-260`/`:477` on the second — never on the
   first. D18 measures it.
3. **`test-en-quotes.mjs` cannot fail on documentation.** It reads `packages/*/client.js` only, so the batch's dod
   line "green on the new English docs" is vacuous: that command passes today and will still pass with any English
   page. It is **not** a DoD here (section 6) and the false premise is recorded (section 8, F2).
4. **Nothing in the repo scans `docs/` for `plugin.json`.** `build-catalog.mjs:218`, `test-layout.mjs:107` and
   `plugin-scan.mjs:24` build their file lists from `packages/` (the lifecycle list, the robot's list, `PACKAGES`),
   never from `docs/`. A template under `docs/dev/templates/` is therefore invisible to
   the four declaration points, as the batch requires, with no exemption to add (`plugin-scan-exceptions.json` holds
   three bundles today).
5. **The mockups exist now, and the previous draft's "absent" premise was false.** Both design references are
   tracked at the baseline: `docs/handoff/theme-medecin/maquette-v1/` (accent `#1B7F76`, `maquette.html:23`) and
   `docs/handoff/theme-recrutement-ssii/maquette-v1/` (accent `#4F5BD5`, `maquette.html:23`, the only hex its lint
   allowlist accepts, `maquette.json:13-15`). The earlier note looked for `vertical-medecin/…` and
   `vertical-recrutement-ssii/…` in a neighbouring checkout — both wrong names, wrong folder. A4 ships no UI and
   needs neither; the correction is recorded because a stale "absent" claim had leaked into the vision and capture
   sections (section 8, F5).
6. **The five interface letters are retired.** They appear nowhere in the repository; the campaign retired them
   (D3) and this file names the five points instead (contract sentence 1).
7. **Page and code counts, corrected.** `docs/dev` holds 37 `.md` pages and `docs/` 57 at `2ac67fb4` (the previous
   draft said 38 and 56). Nothing in this batch depends on the counts; they are recorded so the page does not
   repeat them.
8. **Baseline of the gates this batch must not disturb** (measured 2026-10-28 on HEAD `bd8754be` plus the neighbour
   session's uncommitted diff): `node scripts/build-catalog.mjs --check` → exit 0, `catalogue up to date
   (48 modules)`; `node scripts/garde-depot.mjs` → exit 0, `1923 tracked files — 0 error(s), 0 warning(s)`;
   `node scripts/test-layout.mjs` → **exit 1**, `LAYOUT — 21 checks, 2 failure(s)`, both about the untracked
   `kybernos-log` bundle of the neighbour session; `node scripts/run-all-tests.mjs` → **exit 1, 529 files, 521
   green, 8 RED** (the porte of 2026-10-28 02:10 recorded 6, D8; the neighbour's diff moved it). The 8, attributed:
   `test-layout`, `test-readmes` and `test-help-mounts` (`kybernos-log`), `test-plugin-scan` (`kybernos-pulse`
   declares no `exec` while `helper/gen-icon.mjs:9` spawns), `test-consistency-guards`, `test-help`,
   `test-no-french-literals` and `packages/kybernos-plugin/test-settings-nav` (the neighbour's uncommitted
   `kybernos-plugin` diff). **None of the 8 is this batch's, and A4 cannot turn any of them green**: it writes no
   `packages/**`. The merge gate still demands 0 red (section 6), so those 8 are ticketed or closed by their owner
   before the A4 merge — A4 never calls them green.

Anchors re-verified for this rebuild: the **46 rows** of sections 2.1 and 2.2, each read at `2ac67fb4`, plus the
counts and baselines of 2.3, which were re-run rather than copied. The point table of the contract is `:263-274` and
holds ten rows, not eight: the five this batch freezes are `:265` (`domain-pack`) and `:269-272` (`team-template`,
`automation-template`, `skills`, `theme`), `:266` is the `dashboards#preset` row that stays unbuilt, and `:273-274`
are the two points no theme contributes to.

---

## 3. AMBIGUITY: what a human may still want to settle, not me

AMBIGUITY A1 — **the five frozen interfaces.** The request names them by letters that exist nowhere; the campaign
retired those letters (D3), so I read them as the five data points a theme can target — `kybernos/core#domain-pack`,
`kybernos/theme#theme`, `kybernos/skills#skill`, `kybernos/core#team-template`,
`kybernos/core#automation-template`, with `kybernos/dashboards#preset` excluded because it is not built
(`plugin-contract.md:266`). Confirm this list, or supply the five and I freeze the page's table on them. Nothing else
in this file depends on the answer: the table has five rows whatever they are called.

AMBIGUITY A2 — **the starter's `package.json`.** Strict reading of the batch's interdiction = no `dsh` key (my
choice, validated by `registry.mjs:54-72`), which diverges from the four-file draft shape of
`plugin-creator/SKILL.md:47-67` and from the registry's own fixtures (`test-host.mjs:44-45`). Do we accept the
divergence (the page explains why a data bundle needs no patch), or does the template copy the skill's shape
verbatim?

AMBIGUITY A3 — **narrowing an owner-approved contract line.** `plugin-contract.md:486` says `<folder | archive>`; I
plan to narrow it to `<folder>` and label archives "not built (phase B)". Is that edit allowed on a contract whose
six decisions the owner accepted on 2026-10-21, or must A4 implement archive reading and hashes (which is phase-B
work and would grow this batch past "docs + a read-only report")?

AMBIGUITY A4 — **folder-level hygiene coverage.** `scripts/garde-depot.mjs` keeps `MEDIA` (`:11`) and `SECRET`
(`:12`) private and exports only `isScanned`/`personalPath`/`personalMails`/`warningsOf` (`:28-35`). My choice: no
new export — that file is outside the batch — reuse `isScanned` in both directions (a file it will not inspect,
media or over 4 MB, is a `FAIL hygiene` for a data bundle) and `warningsOf` (personal paths, mail addresses);
secret-**file-name** detection is then not covered, and the page says so. Alternative: a one-line `export` in
`scripts/garde-depot.mjs`, which is a file this batch is not given.

AMBIGUITY A5 — **who exports the point objects for a static run.** The tool needs `validate` functions without a
host. My choice: A4 imports the point objects the owner bundles export (`DOMAIN_POINT` pattern,
`domain-pack.mjs:230`), including A1's theme point, A2-registry's skills point and A2-pack-format's two templates; if
one is exported only inside a mount function,
the report says `SKIP point.<id>` and the page states which points are checked offline — A4 never copies a validator,
and the export belongs to the owner's batch. Who owns that export?

---

## 4. Acceptance criteria

### A. The page `docs/dev/sector-bundles.md`

- [ ] H1 is "Build a theme"; the file path stays `docs/dev/sector-bundles.md` (the frozen path, head note).
- [ ] One opening paragraph says what a theme is (one folder, one `plugin.json`, several `extends`) and cites the
  strategy (`docs/etudes/2026-10-27-sector-packs-strategy.md:55-56`) — no invented framing.
- [ ] A section **Primitives first** (page / dashboard / listing, one view kind per datum / kit) with the "fits none
  of them → platform-evolution request, never a custom screen in a theme" sentence, cited to the build-contract
  skill `contrat-pack-vertical` and strategy `:86-90`.
- [ ] A section **Custom UI lives in Settings** (bounded fields, data only, no journey logic), cited to strategy
  `:91-93`.
- [ ] A section **The style layer is a token overlay** — one data hex per sector, no CSS, no fetched font; the
  vocabulary cited to `packages/kybernos-theme/preset-store.mjs:43-52`, the validator to `:92-115`, the "Settings
  wins over the theme" rule to strategy `:106-110`. The section keeps the word **token overlay** even though the
  build contract's own line (`:94`) still says "a theme is a token overlay": the word "theme" there is the old name
  of the style layer (head note), and the page uses the new one.
- [ ] A section **Cited or labelled** — every displayed datum cites a theme file or is marked "proposal"; the
  sector accents in this campaign are the example (recruitment `#4F5BD5` cited from
  `docs/handoff/theme-recrutement-ssii/maquette-v1/maquette.html:23` and still labelled PROPOSAL, D5; cabinet
  medical `#1B7F76` from `docs/handoff/theme-medecin/maquette-v1/maquette.html:23`).
- [ ] A table of the frozen interfaces with **exactly five rows keyed by these five point ids**:
  `kybernos/core#domain-pack`, `kybernos/theme#theme`, `kybernos/skills#skill`,
  `kybernos/core#team-template`, `kybernos/core#automation-template`; each row names what the author ships and the
  validator the tool runs. No letter anywhere (contract sentence 1).
- [ ] One complete `plugin.json` example that `manifestErrors` accepts with an outsider ctx (validated by unit U10),
  and that is **not** the invalid block of `strategy.md:58-74`.
- [ ] The starter walkthrough: copy `docs/dev/templates/acme-vet-clinic/`, rename, run
  `node scripts/plugin-check.mjs <folder>`, read the report.
- [ ] The broken-variant table (variant → the one check id it breaks), matching section 5's table exactly, ids from
  contract sentence 3.
- [ ] The install/preview loop, told truthfully: a `link:`/`file:` install shows as Local, and the registry reads
  `<DSH home>/profiles/web/package.json` + `node_modules/<name>/plugin.json` — cited to `plugin-contract.md:550`/
  `:603` and `host.mjs:32`, never to the stale `:477`.
- [ ] A "not built" list, labelled as such: signed catalogue and archives (phase B, `plugin-contract.md:484-500`),
  `kybernos/dashboards#preset`, and any point A1/A2 did not open.
- [ ] Every `node scripts/…` command in the page names a file that exists (checked by unit U11).
- [ ] Linked from both binding specs at their head: `docs/dev/domain-packs.md:1-5` and
  `docs/dev/plugin-contract.md:1-4`, relative markdown link, existing style
  ``[`sector-bundles.md`](sector-bundles.md)``.

### B. The starter `docs/dev/templates/acme-vet-clinic/`

- [ ] `plugin.json` is the `acme/vet-clinic` shape of `scripts/test-plugin-manifest.mjs:70-75` extended to the five
  built points, with `requires.plugins` covering **every** owner it extends (`manifest.mjs:86-89`), a `description`,
  and no `provides`.
- [ ] `package.json` has `name`, `version`, `description`, `license` and **no** `dsh` key, no `scripts`, no `bin`
  (AMBIGUITY A2; reasons from `registry.mjs:54-72`).
- [ ] `domains/vet-clinic.json` passes `validatePack` (`domain-pack.mjs:68`): known keys only, id matching the file
  name, `en` present, goals within `LIMITS` (`:28`), no connector slug unless it exists in
  `packages/kybernos-composio/catalog.js`, no team id unless it exists in the marketplace **or** in this plugin's own
  `teams/`.
- [ ] `themes/vet-clinic.json` is the **light shape** (contract sentence 2) and passes `sanitizePreset`
  (`preset-store.mjs:92-115`): `{ "id": "vet-clinic", "name": "Vet clinic", "settings": { "acc": "#7C5CBF",
  "radius": 10, "mode": "light" } }`. No `description`, no `license`, no `v`: `sanitizePreset` would drop them
  silently, which is exactly the trap the head note records. `acc` is a proposal (the starter is sample data).
- [ ] `skills/<name>/` ships at least one skill in the shape A2's `skills#skill` point accepts (folder + `SKILL.md`,
  or the JSON descriptor if A2 chose that; the `files` field of the point decides) — **read from A2's sortie, never
  guessed**; its prompt drafts and never sends, and it cites the person's own material.
- [ ] `teams/<name>.json` and `automations/<name>.json` are one file each, in the shape A2's validators accept
  (`kybernos/core#team-template`, `kybernos/core#automation-template`); the automation is a draft-only prompt with a
  five-field `cron`.
- [ ] A `README.md` states, in one line, that this is **sample data for a fictional author (`acme`)** — the
  "labelled" branch of the fourth build-contract rule — that every sentence is a proposal and that the accent is
  one too, and that a real theme replaces every text and cites its sources.
- [ ] Text, JSON and YAML only: no image, font, PDF, binary; no `/Users/<name>` path (repo rule 4,
  `garde-depot.mjs:11`, `:20-25`). Eight files as shipped (`README.md`, `plugin.json`, `package.json`,
  `domains/vet-clinic.json`, `themes/vet-clinic.json`, `skills/consult-notes/SKILL.md`, `teams/clinic-desk.json`,
  `automations/morning-reminders.json`), the `broken/` variants aside.
- [ ] The folder is **not** a bundle: no entry in `scripts/lifecycle-packages.json`, `docs/beta/satellites.json`,
  `packages/kybernos-hub/catalog.json`.

### C. The broken variants `docs/dev/templates/acme-vet-clinic/broken/`

- [ ] One sub-folder per variant, each a **complete** theme folder (own `plugin.json` + `package.json` + the faulty
  file) with exactly **one** seeded fault.
- [ ] Each fails `node scripts/plugin-check.mjs <variant>` with exit 1, exactly one `FAIL` line, and the check id
  listed in section 5's table — no cascading second failure.
- [ ] None is picked up by a repo scan, and no `scripts/plugin-scan-exceptions.json` entry is needed.
- [ ] Fixtures are text/JSON only (media and secret-name fixtures are generated in a temp folder by the test, never
  committed — `garde-depot.mjs:11-12` would refuse them anyway).

### D. The tool `scripts/plugin-check.mjs`

- [ ] Usage: `node scripts/plugin-check.mjs <folder>`; exit `0` = no `FAIL`, `1` = at least one `FAIL`, `2` = usage
  (no argument, a path that does not exist, a file, two arguments).
- [ ] One report, fixed check order, one summary line, no timestamp, no absolute path beyond the argument as given →
  two runs are byte-identical (unit U15).
- [ ] Checks, in this order, with these ids: `manifest.present`, `manifest.json`, `manifest.schema`,
  `manifest.rules`, `manifest.points`, `package.data`, `point.<point-name>` (one per `extends`, in manifest order),
  `code.scan`, `claims.unique`, `help.card`, `compat.zone`, `hygiene`, `archive`.
- [ ] `manifest.points` is the id that owns "every extended point is opened by an owner": it prints the count, the
  ranges and the `requires.plugins` coverage, and it is the id a variant extending an unopened point breaks. The
  vocabulary is closed (contract sentence 3): a fault with no id in that list is not a variant.
- [ ] Each line prints `PASS`/`FAIL`/`SKIP`, the id, then the validator's message **verbatim**; a `manifest.json`
  failure ends the run after that line. A line whose subject does not exist in a data theme says `SKIP` and why — it
  never prints a vacuous `PASS` (hence `claims.unique` is a `SKIP` here: a data theme declares no CSS prefix, route
  or slot).
- [ ] Reuses, imports only, no copy: `manifestErrors`/`setErrors` (`scripts/plugin-manifest.mjs`), `schema-subset`
  (`scripts/schema-subset.mjs`), `dataPackageProblems` and `readExtension` semantics from
  `packages/kybernos-registry/registry.mjs`, the point objects (`DOMAIN_POINT` and A1/A2's four),
  `scanText`/`uncovered` (`scripts/plugin-scan.mjs:57`, `:109`), `isScanned`/`warningsOf`
  (`scripts/garde-depot.mjs:28-35`).
- [ ] Our own modules are held to the same check with the first-party `ctx` of `scripts/test-layout.mjs:112` —
  `node scripts/plugin-check.mjs packages/kybernos-theme` exits 0.
- [ ] **It never writes**: the checked folder is byte-identical after a run (the test hashes every file
  before/after).
- [ ] It makes no network call (its own source, scanned by `scanText`, shows no `net` evidence).
- [ ] It reports unknown sub-folders (e.g. the starter's own `broken/`) as `SKIP`, naming the folder rather than a
  check id (a folder is not a check), visible, never silently ignored and never a failure.

### E. The two binding specs

- [ ] `domain-packs.md:108` (theme row): no longer `next`; it names the seam A1 landed by the identifier A1 fixed in
  its frozen wire (`applyPreset`, its spec's "seam wire" section) — A4 cites the identifier, it does not invent one,
  and D15 refuses a token that does not exist in `packages/kybernos-theme/*.mjs` or
  `packages/kybernos-plugin/client.js`.
- [ ] `domain-packs.md:158`: "A plugin pack cannot bundle skills yet" is replaced by the `kybernos/skills#skill`
  point and what A2 landed.
- [ ] `plugin-contract.md:269`, `:270`, `:271`, `:272`: the four newly built points say `opened <date>` **only where
  they actually are**; `:266` (`dashboards#preset`) says `not built` and stays honest.
- [ ] `plugin-contract.md:259-260` and `:477`: aligned on the real read location (`:550`/`:603` or A2's new one),
  measured by D18.
- [ ] `plugin-contract.md:484-500`: the section points at the real `scripts/plugin-check.mjs`, the CLI line matches
  the tool, archives labelled "not built", and `:500` keeps "necessary for every level and sufficient for none".
- [ ] Both specs link the new page at their head.

### F. Interdictions, made checkable

- [ ] `docs/`, `scripts/plugin-check.mjs`, `scripts/test-plugin-check.mjs` are the only paths touched — no
  `packages/**`, no `catalog/**`, no `docs/dev/schemas/plugin.schema.json`.
- [ ] No new bundle declared; catalogue not drifted (`build-catalog.mjs --check`).
- [ ] No media, no personal path, no key, no signed-catalogue material.
- [ ] English prose.

---

## 5. The six mandatory sections

e2e: A4 owns one end-to-end journey, and documents one it must not own.

**E1, the authoring loop** (in `test-plugin-check.mjs`): copy the starter to a `mkdtemp` folder → run the tool →
expect exit 0 and the same check ids as in the repo; delete `description` from the copy → exit 1 with
`manifest.schema`; restore → exit 0; hash the repository fixture before and after, assert unchanged. **E2, the
doc-as-contract loop**: every fenced `node scripts/…` command of the page is executed (or parsed and its target
asserted to exist) against the repo, so a page that lies goes red. **E3, the real install journey** — copy the
starter into an isolated DSH as a `link:` dependency, open the wizard, see the vet-clinic tile, accept the plugin,
check `GET /kybernos/domains` marks the theme `from: "acme/vet-clinic"`, install one ticked goal, uninstall and check
nothing is left — is **not** in A4's gate and not in its DoD: it needs a running `dsh` and a profile
(`docs/dev/live-testing.md`), the tool ships no runtime, and the journey belongs to the batches that ship the engine
behaviour (A2's reader, A3's themes). The commands are written in the page so a reviewer can play it; its result is
recorded by whoever plays it, never asserted here.

vision: not applicable, and here is why.

This batch adds no pixel: a Markdown page, JSON/Markdown fixtures, and a terminal report. The repo's UI-proof
doctrine (an interface delivery must be captured in every state, light and dark, then read back with `read_image`)
has no object here — a Markdown file has no states, and this repository's own app does not render `docs/`. The
nearest thing to a visual surface is the report's alignment, which is a text assertion (units U15/U16), not an
image. No screenshot is produced, and none could be committed: `garde-depot.mjs:11` refuses tracked images, so a
capture folder under `docs/dev/templates/` is impossible by rule. The design references do exist — the two tracked
mockups of section 2.3, fact 5 — and they are A3's evidence for its sector accents, not A4's: nothing here renders
them.

capture: not applicable, same reason, stated rather than omitted.

There is nothing to capture: no page, no panel, no wizard step, no theme miniature is rendered by this batch, and the
two tracked mockups (section 2.3, fact 5) are A3's design references, not something A4 renders. A4's deliverable is a
page and a report, and neither is a screen. What replaces a capture
here is the **report text**: the DoD block below prints the sample report and its summary line, and the reviewer
reads that instead of an image.

maquette: not applicable, stated rather than omitted.

A maquette exists to freeze an interface before code; A4 ships no interface, so there is nothing to freeze — the
"interface" this batch freezes is data: the five point ids, the check-id vocabulary, the report format. Those are
frozen in *text* (the report format and the broken-variant table below, and the spec's table above), not in an HTML
mockup. The repo's mockup convention (`docs/handoff/<subject>/maquette-v1/`) is the right tool for A1's theme
miniature and A3's sector accents — both are already tracked there — not for a docs page. No `docs/handoff/a4-…`
folder is created, and none should be.

unit: `scripts/test-plugin-check.mjs`, hermetic (no network, no DSH, no write outside `mkdtemp`),
discovered by `scripts/run-all-tests.mjs:23-45` and reached by the `test-plugin` filter. Cases, all deterministic:

| # | Case | Expected |
|---|---|---|
| U1 | the starter folder | exit 0, 0 `FAIL`, the **13 `PASS` ids** in the fixed order, then the 4 `SKIP` ids and the `broken/` folder line, each with its reason |
| U2 | the report header | names `acme/vet-clinic`, its version, `data`, and the five points |
| U3 | same checks for us: `packages/kybernos-theme` | exit 0, first-party ctx identical to `test-layout.mjs:112` |
| U4 | each committed variant under `broken/` | exit 1, exactly one `FAIL`, id equal to the broken-variant table's expectation |
| U5 | a variant **not** in the expectation table | the test fails (a fixture cannot be added silently) |
| U6 | the checked folder after a run | every file's sha256 identical |
| U7 | `scanText` on the tool's own source | no `net`, no `exec`, no `fsWrite` evidence |
| U8 | usage: no argument / a file / two folders | exit 2, no report |
| U9 | a folder without `plugin.json` | exit 1, `manifest.present`, no stack trace |
| U10 | every ```` ```json ```` block of the page with `"contract": 1` | accepted by `manifestErrors` (mirrors `test-plugin-manifest.mjs:90-95`) |
| U11 | every `node scripts/…` command quoted in the page | its target file exists |
| U12 | the page's link in both specs | present, relative, resolvable |
| U13 | the page's frozen-interface table | exactly 5 rows, each keyed by one of the five point ids, each declared in some `provides[]` |
| U14 | the four build-contract sections | each heading present, in the page |
| U15 | two consecutive runs on the same folder | byte-identical reports |
| U16 | a folder with an extra directory | `SKIP` line naming it, exit unchanged |
| U17 | point validators | imported, not copied: the tool's source contains no `#rrggbb` test, no theme key list, no cron parser of its own |
| U18 | a point whose validator is not importable | `SKIP point.<id>` with the phase/label, never a `PASS` |

DoD: the commands below, run from the repository root.

Every line below is red on the code as it stands today — measured one by one on 2026-10-28: **24 command lines, 23 of
them assertions, all 23 exit 1** (the first line of D9 is its own setup, `set -e; V=…`, and exits 0 by
construction). They must exit 0 once the batch is complete. A command that already passes today is not in this
list — those are the regression gates of section 6.

```bash
# D1 the page exists
test -f docs/dev/sector-bundles.md

# D2 both binding specs link it at their head
grep -q 'sector-bundles.md' docs/dev/domain-packs.md && grep -q 'sector-bundles.md' docs/dev/plugin-contract.md

# D3 the page carries the four build-contract rules
test -f docs/dev/sector-bundles.md && grep -qi 'primitives first' docs/dev/sector-bundles.md && grep -qi 'custom UI lives in settings' docs/dev/sector-bundles.md && grep -qi 'token overlay' docs/dev/sector-bundles.md && grep -qi 'cited or labelled' docs/dev/sector-bundles.md

# D4 the frozen-interface table has exactly five rows, keyed by the five point ids
test -f docs/dev/sector-bundles.md && test "$(grep -cE '^\| .kybernos/(core#domain-pack|theme#theme|skills#skill|core#team-template|core#automation-template).' docs/dev/sector-bundles.md)" -eq 5

# D5 the starter manifest exists and the folder is text only
test -f docs/dev/templates/acme-vet-clinic/plugin.json
test -d docs/dev/templates/acme-vet-clinic && test -z "$(find docs/dev/templates -type f ! -name '*.json' ! -name '*.md' ! -name '*.yml' ! -name '*.yaml' -print -quit)"

# D6 no personal path in what this batch adds
test -f docs/dev/sector-bundles.md && ! grep -rq '/Users/' docs/dev/templates docs/dev/sector-bundles.md

# D7 the starter is not a bundle: no dsh key in its package.json
test -f docs/dev/templates/acme-vet-clinic/package.json && ! grep -q '"dsh"' docs/dev/templates/acme-vet-clinic/package.json

# D8 the starter passes the tool
node scripts/plugin-check.mjs docs/dev/templates/acme-vet-clinic

# D9 every broken variant fails the tool (and at least one exists)
set -e; V=docs/dev/templates/acme-vet-clinic/broken
test -n "$(find "$V" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)"
for d in "$V"/*/; do node scripts/plugin-check.mjs "$d" >/dev/null && exit 1; done

# D10 the same checks run on one of our own modules
node scripts/plugin-check.mjs packages/kybernos-theme

# D11 the five points the page freezes are actually declared (A1/A2 landed)
node -e "const fs=require('fs'),p=require('path');const want=['kybernos/core#domain-pack','kybernos/theme#theme','kybernos/skills#skill','kybernos/core#team-template','kybernos/core#automation-template'];const have=new Set();for(const d of fs.readdirSync('packages')){const f=p.join('packages',d,'plugin.json');if(!fs.existsSync(f))continue;const j=JSON.parse(fs.readFileSync(f));for(const x of j.provides||[])have.add(j.id+'#'+x.name)}process.exit(want.every(w=>have.has(w))?0:1)"

# D12 the tool's own test is green, and proves it never repairs
node scripts/test-plugin-check.mjs

# D13 no bundle declared, no catalogue drift
test -f docs/dev/templates/acme-vet-clinic/plugin.json && ! grep -q 'acme-vet-clinic' scripts/lifecycle-packages.json docs/beta/satellites.json packages/kybernos-hub/catalog.json && node scripts/build-catalog.mjs --check >/dev/null

# D14 no scan exemption was engaged
test -f docs/dev/templates/acme-vet-clinic/plugin.json && ! grep -q 'acme/vet-clinic' scripts/plugin-scan-exceptions.json

# D15 the theme row is no longer "next" and cites a seam that exists in the code
! grep -qE '^\| Theme per field \|.*\| next \|' docs/dev/domain-packs.md
node -e "const fs=require('fs'),path=require('path');const row=(fs.readFileSync('docs/dev/domain-packs.md','utf8').split('\n').find(l=>l.startsWith('| Theme per field'))||'');const files=fs.readdirSync('packages/kybernos-theme').filter(f=>/\.(m?js)$/.test(f)).map(f=>path.join('packages/kybernos-theme',f));files.push('packages/kybernos-plugin/client.js');const code=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');const toks=[...row.matchAll(/\`([A-Za-z_$][A-Za-z0-9_$]{2,})\`/g)].map(m=>m[1]).filter(t=>!/\.(json|m?js)$/.test(t));if(toks.length===0)process.exit(1);process.exit(toks.some(t=>code.includes(t))?0:1)"

# D16 the skills row names the point instead of the old dead end
! grep -q 'A plugin pack cannot bundle skills yet' docs/dev/domain-packs.md && grep -q 'kybernos/skills#skill' docs/dev/domain-packs.md

# D17 the four points that landed say so, with a date; dashboards#preset stays honest
test "$(grep -cE '^\| .kybernos/(theme#theme|skills#skill|core#team-template|core#automation-template). 1\.0 \|.*opened 2026-' docs/dev/plugin-contract.md)" -eq 4
grep -qE '^\| .kybernos/dashboards#preset. 1\.0 \|.*not built' docs/dev/plugin-contract.md

# D18 the scan-folder wording no longer claims a folder the code does not use
node -e "const fs=require('fs');const doc=fs.readFileSync('docs/dev/plugin-contract.md','utf8');const code=['packages/kybernos-registry/host.mjs','packages/kybernos-registry/registry.mjs'].map(f=>fs.readFileSync(f,'utf8')).join(String.fromCharCode(10));process.exit(doc.includes('kybernos/plugins/<author>/<name>')&&!code.includes('kybernos/plugins')?1:0)"

# D19 the conformance section names the real tool and its real CLI
test -f scripts/plugin-check.mjs && grep -q 'node scripts/plugin-check.mjs <folder>' docs/dev/plugin-contract.md
```

The report format the DoD prints (frozen here, asserted by units U1/U2/U15), one sample run on the starter — every
line below is one check, the five `SKIP`s say why, and the summary counts exactly the lines above it:

```
plugin-check v1 — docs/dev/templates/acme-vet-clinic
plugin: acme/vet-clinic 1.0.0 (data, 5 points, free)
  PASS  manifest.present    plugin.json found
  PASS  manifest.json       plugin.json is valid JSON
  PASS  manifest.schema     plugin.schema.json, subset interpreter: no fault
  PASS  manifest.rules      ids, reserved namespaces, version, claims: no fault
  PASS  manifest.points     extends 5 points, every one opened, ranges satisfied, requires.plugins covers their owners
  PASS  package.data        no dsh key, no install script, no bin
  PASS  point.domain-pack   domains/vet-clinic.json
  PASS  point.theme         themes/vet-clinic.json
  PASS  point.skill         skills/consult-notes
  PASS  point.team-template teams/clinic-desk.json
  PASS  point.automation-template automations/morning-reminders.json
  PASS  code.scan           no .js in the folder: nothing to declare
  PASS  hygiene             8 files, no media, no personal path
  SKIP  claims.unique       not applicable: a data theme declares no CSS prefix, route or slot
  SKIP  help.card           not a module of the Suite (no help key)
  SKIP  compat.zone         no requires.dsh in a data theme
  SKIP  archive             not built (phase B: signed archive and hashes)
  SKIP  broken/             not declared by extends; not part of the plugin
summary: 13 pass, 0 fail, 5 skip — exit 0
```

The broken-variant table the page and the test share (each variant fails **only** the id in the right-hand column;
this table is the contract, and every id in it is in the closed vocabulary of the head note):

| Variant (`broken/…`) | Seeded fault | Check id that must fail |
|---|---|---|
| `01-not-json/` | `plugin.json` is not valid JSON | `manifest.json` |
| `02-no-description/` | `description` missing (first fault of the strategy's own example, strategy `:58-74`) | `manifest.schema` |
| `03-extends-without-requires/` | extends `kybernos/theme#theme`, `requires.plugins` omits it (`manifest.mjs:86-89`) | `manifest.rules` |
| `04-unknown-point/` | extends `kybernos/core#nope` (owner required, point unopened) | `manifest.points` |
| `05-domain-pack-unknown-key/` | `domains/clinic.json` carries a key `validatePack` does not know | `point.domain-pack` |
| `06-theme-bad-accent/` | `themes/x.json` sets `acc: "blue"` (`sanitizePreset`, `HEX6`) | `point.theme` |
| `07-package-loads-code/` | `package.json` gains `scripts.postinstall` (or `dsh.bundle.patch` naming a module) | `package.data` |

---

## 6. Regression gates — measured today, therefore not DoD

Listed so the A4 agent runs them and so nobody mistakes them for proof of this batch. Measured on 2026-10-28 on HEAD
`bd8754be` plus the neighbour session's uncommitted diff (section 2.3, fact 8):

```bash
node scripts/build-catalog.mjs --check       # exit 0 today — catalogue up to date (48 modules)
node scripts/garde-depot.mjs                 # exit 0 today — 1923 tracked files, 0 error(s), 0 warning(s)
node scripts/test-layout.mjs                 # RED today — LAYOUT 21 checks, 2 failure(s), both kybernos-log
node scripts/run-all-tests.mjs --only test-plugin   # test-plugin-manifest, -scan, -exits, and this batch's own once it exists
node scripts/test-lifecycle-engine.mjs && node scripts/test-paquet.mjs   # AGENTS.md pre-push line
node scripts/run-all-tests.mjs               # RED today — 529 files, 521 green, 8 RED (all attributed, none ours), exit 1
```

Two of these lines are red **today**, for reasons outside this batch: the untracked `kybernos-log` bundle and the
neighbour's `kybernos-plugin` diff (section 2.3, fact 8). A4 must not claim them fixed, must not "fix" them by
touching `packages/**` (forbidden), and must not make them worse. `test-layout.mjs` is deliberately **not** in the
DoD any more: a batch that writes no `packages/**` cannot turn a neighbour's bundle into a declared one, so a DoD
line that demanded it green would be a promise A4 cannot keep. Its guarantee is carried by D13's catalogue check
instead — the batch adds no bundle, and the catalogue is derived from `packages/*/plugin.json` only.

The merge gate itself does not move: `node scripts/run-all-tests.mjs` must end with 0 red before A4 merges (D8
recorded the same discipline, at 6 red, on 2026-10-28 02:10). The 8 reds above are ticketed or closed by their owner;
A4's sortie says which, and never writes "all tests pass".

The batch's dod line "`node scripts/test-en-quotes.mjs` — green on the new English docs" is **not** reproduced above
and is not a DoD: that script reads `packages/*/client.js` only (`test-en-quotes.mjs:10`, `:16-23`), so it cannot
fail on a `.md` file and cannot prove anything about this batch. The English-docs rule is held by review and by
D3/D4 instead.

---

## 7. Out of scope

- **Any runtime behaviour**: no style seam (A1), no multi-point reader (A2), no vertical theme content (A3), no
  catalogue, no signed archive, no install path. A4 documents and checks what those land; it changes none of it.
- **`packages/**`** — including the five point objects this batch imports. If a point object is not importable, the
  answer is `SKIP` + a note (AMBIGUITY A5), never an edit inside a bundle.
- **The schema pair** (`docs/dev/schemas/plugin.schema.json`, `packages/kybernos-registry/plugin.schema.json`):
  read, cited, never written (they belong to A2).
- **`scripts/lifecycle-packages.json`, `docs/beta/satellites.json`, `packages/kybernos-hub/catalog.json`,
  `catalog/**`**: untouched, and D13 proves no drift.
- **`scripts/plugin-scan.mjs`, `scripts/garde-depot.mjs`, `scripts/plugin-scan-exceptions.json`,
  `scripts/plugin-manifest.mjs`**: untouched. Their limits are stated, not repaired (this is what AMBIGUITY A4 is
  about).
- **Archive mode, signatures, catalogue submission, trust levels** (contract phase B/C): labelled "not built" in the
  page and in section 4.E.
- **The `kybernos/dashboards#preset` point**: it stays "not built"; A4 must not make it look built to fill a table.
- **The strategy document** (`docs/etudes/2026-10-27-sector-packs-strategy.md`) and `docs/tests/triage.md`: not in
  this batch's file list. Its invalid example (`:58-74`) and its stale `plugin-check.mjs … not built` line (`:34`)
  are recorded as follow-ups, not fixed here.
- **The two sector accents** (`#1B7F76`, `#4F5BD5`): A3's data, cited by the page as the worked example of "cited or
  labelled"; A4 creates no theme source.
- **A second template** (a recruitment variant): one worked example beats an SDK; more would be content work (A3's
  domain).
- **Translating the page**: repo rule 6 makes new docs English.

---

## 8. Follow-ups recorded (not silently closed)

- **F1** — `docs/etudes/2026-10-27-sector-packs-strategy.md:58-74`: its example manifest is refused by the repo's
  own validator (missing `description`; then `kybernos/skills` and `kybernos/dashboards` missing from
  `requires.plugins`). Fix belongs to the strategy's owner; A4 shows the valid version, and unit U10 keeps the page
  from copying the broken one.
- **F2** — the batch's dod line on `test-en-quotes.mjs` is vacuous (the test reads only `packages/*/client.js`).
  Either the test grows a docs pass, or the line is dropped from the dod vocabulary.
- **F3** — `plugin-contract.md:259-260`/`:477` vs `:550`/`:603`: A4 aligns the first pair on the second; if A2 moves
  the read location again, D18 keeps both honest automatically only for the literal folder string — a stronger check
  (reading the doc claim and the code path into one assertion) is a candidate for a future docs-lint.
- **F4** — `kybernos/dashboards#preset`: no contribution path exists; the row stays "not built" (`:266`) and the page
  lists it in the not-built section.
- **F5** — the sector mockups: they **exist** (section 2.3, fact 5); the earlier claim that they were absent from
  this machine is withdrawn, so no later spec inherits it. The recruitment accent is A3's, cited at
  `maquette.html:23` and still PROPOSAL (D5).
- **F6** — signed catalogue publication (contract phase 3/B): the report is "necessary for every level and
  sufficient for none" (`plugin-contract.md:500`); A4 quotes that line instead of inventing a badge.
- **F7** — secret-file-name detection in folder mode (AMBIGUITY A4): either one exported constant in
  `scripts/garde-depot.mjs` or a documented gap in the page. Recorded, chosen as "documented gap" here.
- **F8** — the page's path (`sector-bundles.md`) still carries the unit's old name while its H1 says "theme". The
  move belongs to the rename batch A5, together with `packages/kybernos-theme` → `kybernos-style`; A4 keeps the path
  so the two head links do not break twice.
