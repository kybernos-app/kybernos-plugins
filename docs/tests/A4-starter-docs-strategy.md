# A4-starter-docs — test strategy, written before the code

Batch: **A4-starter-docs** (Phase A, wave 4 of 4: theme seam, registry multi-point scan, two
verticals, then this one). Lane: **B**. Everything below was checked against this repository on
`dev`, 2026-10-27, before a single line of this batch existed.

This batch ships no runtime behaviour: one English page, one copyable template folder, one read-only
report tool and its own test. So "green" here means three falsifiable things, and nothing else:

1. the page's promises are **executable** (its commands run, its JSON example is accepted by the
   repo's own validator, its frozen-interface table names points that exist);
2. the template **teaches the validator** (it passes as shipped, and every broken variant fails with
   exactly one named check);
3. the tool **reports and never repairs** (same checks for our modules and for a stranger's folder,
   the checked folder is byte-identical afterwards).

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

---

## 1. Interpretations, and the one I chose

The request admits several readings on five points. Each one changes either the files touched, the
DoD, or the truth of a binding document, so each is settled here with its reason — and the four that
a human must arbitrate are repeated as `AMBIGUITY:` lines in section 3.

### 1.1 What "the frozen interfaces I1-I5" are

The batch says the page carries "the frozen interfaces I1-I5". **Those five labels appear nowhere in
the repository**: `grep -rn "frozen interface\|I1\b\|I2\b" docs/` returns nothing, and the strategy
document has no such list (checked on every `.md` under `docs/`, 2026-10-27).

Readings:

- **(a) the five data points that exist or land in this wave**, i.e. `kybernos/core#domain-pack`,
  `kybernos/theme#theme`, `kybernos/skills#skill`, `kybernos/core#team-template`,
  `kybernos/core#automation-template` — the five rows of the contract table
  (`docs/dev/plugin-contract.md:265-272`) that a sector bundle can actually target, with
  `kybernos/dashboards#preset` deliberately **out** because it is still not built;
- (b) the five-part *bundle anatomy* of the strategy (`plugin.json` + four folders);
- (c) something the human has in mind that is written down nowhere.

**Chosen: (a).** It is the only reading that can be made deterministic: every row of the page's table
must name a point that some `plugin.json` in `packages/*/plugin.json` declares in `provides[]`, and
that check is a DoD command (D12). Reading (b) is already the page's walkthrough and would make the
label redundant; (c) cannot be specified. The page therefore uses the ids `I1`..`I5` as row keys in
one table, and each row says *what you ship* and *which validator the tool runs*.

### 1.2 The starter's `package.json`: with or without a `dsh` key

`packages/kybernos-registry/skills/plugin-creator/SKILL.md:47-67` (the ceiling this batch must respect)
gives a data plugin four files including a `package.json` that **does** carry
`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`, and the registry's own fixtures do the same
(`packages/kybernos-registry/test-host.mjs:44-45`). The batch's interdiction says the
`plugin.json`/`dsh` declaration point "must not be engaged".

Readings: (a) copy the skill's four-file shape, `dsh.bundle.patch` + an empty `cordis.patch.yml`;
(b) no `dsh` key at all.

**Chosen: (b), no `dsh` key.** `packages/kybernos-registry/registry.mjs:54-72` (`dataPackageProblems`)
tolerates a `package.json` without any `dsh` key, and `:127` only requires a `package.json` to exist;
an empty patch is *allowed*, not required. A template that shows an outsider how to be loaded by DSH
should show the smallest true thing: nothing to load, no patch file to explain. Consequence recorded:
the page must say why there is no `cordis.patch.yml` here, and the divergence from
`plugin-creator`'s draft shape is flagged in section 3 (arbitration A2).

### 1.3 `plugin-check.mjs <folder | archive>`

`docs/dev/plugin-contract.md:486` promises a folder **or an archive**; archives need `tar` reading and
per-file hashes, which the same section lists as phase-B work (`:498`, "archive hygiene and hashes"),
and the batch's objectif says "one report, the same checks". Readings:

- (a) implement archives too — a tar reader, hash comparison, `telechargement.mjs` reuse;
- (b) folder-only in v1, and the contract line narrowed to what exists.

**Chosen: (b).** It keeps the batch at "docs + a read-only report" and keeps the contract honest;
section 11 gains one sentence saying archives are not built, and the report prints
`SKIP archive  not built (phase B: signed archive and hashes)`. DoD D21 asserts the CLI line names
`<folder>` once the tool exists.

### 1.4 Where the point validators come from, at rest

A check on a folder runs **without a host**: no `definePoint`, no mounted bundle. The validators that
exist today are exported as plain data/functions — `packages/kybernos-plugin/domain-pack.mjs:225-231`
(`validateContribution`, `DOMAIN_POINT`, `DOMAIN_POINT_REF`) and
`packages/kybernos-theme/preset-store.mjs:92-115` (`sanitizePreset`) — and the points that A2 opens
will follow the same `{ owner, ownerVersion, name, version, kind, class, validate }` shape the registry
requires (`packages/kybernos-registry/registry.mjs:200-210`).

Readings: (a) the tool re-implements the five validators; (b) it imports whatever the owner bundles
export, and reports `SKIP` when a point has no importable validator.

**Chosen: (b).** Rule "reusing what exists" and the batch's "never write packages/**": duplicating
`validatePack` or `sanitizePreset` would create a second source of truth that drifts the day a limit
changes. The test forbids a copy (unit U9). The point table is built from
`packages/*/plugin.json` `provides[]` (the declaration of record — see
`packages/kybernos-plugin/test-domain-pack.mjs:330-339`) joined with the imported point objects.
This makes A4 depend on A2 exporting its four point objects; if A2 lands them only inside a mount
function, the honest outcome is `SKIP point.<id>` plus a platform-evolution note, never a copy.

### 1.5 How a "named rule" is named

The batch requires each broken variant to fail "with a NAMED rule". Existing validators return English
sentences, not ids (`packages/kybernos-registry/manifest.mjs:53-90` pushes prose into an array;
`test-plugin-manifest.mjs:105-155` matches it with regexes).

**Chosen:** the report has two columns — a **stable check id** owned by the tool, and the **validator's
own message verbatim**. The id is what the fixtures and the docs name (`manifest.rules`,
`point.domain-pack`…), so a variant stays teachable even if a message is reworded, while the message
stays checkable against the existing tests' vocabulary (e.g. `not in requires.plugins`,
`test-plugin-manifest.mjs:141`).

---

## 2. Anchors verified on disk (2026-10-27), and facts measured rather than assumed

Every `file:line` below was opened and read in this repository before it was written here.

| Anchor | What it actually says / does |
|---|---|
| `docs/dev/domain-packs.md:108` | theme row: it says no public apply-a-preset call was found, and its state is `next` |
| `docs/dev/domain-packs.md:158` | "A plugin pack cannot bundle skills yet." |
| `docs/dev/domain-packs.md:1-5` | title + intro paragraph (where the page link goes) |
| `docs/dev/plugin-contract.md:1-4` | title + status paragraph (where the page link goes) |
| `docs/dev/plugin-contract.md:259-260` | claims the registry "scans the folder of installed data plugins, `<DSH home>/kybernos/plugins/<author>/<name>/`" |
| `docs/dev/plugin-contract.md:265-272` | the point table; only `core#domain-pack` is `**opened 2026-10-21**`, every other row says what has to open |
| `docs/dev/plugin-contract.md:477` | repeats the same `<DSH home>/kybernos/plugins/<author>/<name>/` install path |
| `docs/dev/plugin-contract.md:484-500` | section 11, the conformance tool; `:486` is the CLI line `node scripts/plugin-check.mjs <folder \| archive>`; `:488-498` the nine checks and what each reuses; `:500` "necessary for every level and sufficient for none" |
| `docs/dev/plugin-contract.md:550`, `:603` | the **real** read location: `<DSH home>/profiles/web/package.json` + `node_modules/<name>/plugin.json` |
| `packages/kybernos-registry/host.mjs:32` | `profileDir: join(home, 'profiles', 'web')`, `stateFile … kybernos/plugins-state.json`, `draftsDir … kybernos/plugin-drafts` — matches `:550`/`:603`, **not** `:259-260`/`:477` |
| `packages/kybernos-registry/registry.mjs:54-72` | `dataPackageProblems`: any `dsh.*` key, install scripts or `bin` would make DSH load code; `:60-66` allows `dsh.bundle.patch` only if the patch is an empty list |
| `packages/kybernos-registry/registry.mjs:112-133` | `inspectPackage`: a data plugin needs a `plugin.json` **and** a `package.json` |
| `packages/kybernos-registry/registry.mjs:200-210` | `definePoint` contract: `{ owner, ownerVersion, name, version "x.y", kind: "data", class: inert|instruction, validate, max }` |
| `packages/kybernos-registry/registry.mjs:232-250` | `readExtension`: reads only `*.json` files of `extends[].dir`, up to `point.max`; a non-folder is rejected |
| `packages/kybernos-registry/registry.mjs:297-310` | public API of a registry (`definePoint`, `points()`, `preview(id)` …) — none of it can validate an uninstalled folder |
| `packages/kybernos-registry/manifest.mjs:17-20` | `SCHEMA_FILE`, `RESERVED_NAMESPACES = ['kybernos','dsh','local']` |
| `packages/kybernos-registry/manifest.mjs:86-90` | you cannot extend a point of a plugin you do not `requires.plugins` |
| `docs/dev/schemas/plugin.schema.json` | exists (12 KB), a copy of `packages/kybernos-registry/plugin.schema.json`; `test-registry.mjs:350` keeps the two identical. **Read only, never written by A4.** |
| `scripts/plugin-manifest.mjs:1-2` | re-exports the registry bundle's `manifest.mjs` |
| `scripts/test-plugin-manifest.mjs:70-75` | a ready `acme/vet-clinic` fixture: id, `name.en/fr`, `author.id: 'acme'`, `CC-BY-4.0`, `free`, extends `kybernos/core#domain-pack`; `:88` asserts it is accepted; `:90-95` validates the manifests printed in the contract |
| `scripts/test-layout.mjs:46-58` | the declaration points (robot list, `satellites.json`, `package.json` `dsh` field) — they apply to **`packages/` dirs only** |
| `scripts/test-layout.mjs:101-122`, esp. `:112` | the first-party manifest `ctx` (`firstParty`, `dir`, `suiteZone`, `packageJson`, `fileExists`) — the exact recipe "same checks for us" must mirror |
| `scripts/build-catalog.mjs:186`, `:218-222` | the catalogue is derived from `packages/<dir>/plugin.json`; `--check` compares |
| `scripts/plugin-scan.mjs:13`, `:21-38` | `PACKAGES = join(REPO,'packages')`; `sourceFiles(dir)` joins `PACKAGES` → **cannot** scan an arbitrary folder; `:57` `scanText`, `:109` `uncovered` are pure and reusable |
| `scripts/garde-depot.mjs:11-12`, `:20-25`, `:28-35`, `:45-59` | `MEDIA` and `SECRET` regexes are **module-private**; exported: `isScanned`, `personalPath`, `personalMails`, `warningsOf`; runs on `git ls-files`, warns on `/Users/<name>` |
| `packages/kybernos-plugin/domain-pack.mjs:68`, `:225-231` | `validatePack`, `validateContribution`, `DOMAIN_POINT` (with `max: 12`), `DOMAIN_POINT_REF` |
| `packages/kybernos-theme/preset-store.mjs:43-52`, `:63-66`, `:92-115` | the token vocabulary (`acc`, `fontText`, `radius`…), `HEX6`, `sanitizePreset` (`{ id, name, settings }`, unknown keys dropped, ≥1 known setting) |
| `packages/kybernos-registry/skills/plugin-creator/SKILL.md:13-20`, `:47-67`, `:69-85`, `:87-88` | the ceiling: data only, runs nothing, four files, no `scripts`/`bin`/`main`, `local/<name>` id, `description` ≤ 240 characters |
| `docs/etudes/2026-10-27-vertical-bundles-strategy.md:125-127` | the starter's expected anatomy; `:25` still says `plugin-check.mjs … not built`; `:161` puts its publication in phase B |
| `scripts/run-all-tests.mjs:73-77`, `:104-114` | `--only <text>` filters discovered files; discovery is `scripts/test-*.mjs` + `packages/*/test*.mjs` + two `node --test` folders |
| `scripts/test-en-quotes.mjs:10`, `:16-23` | scans **only** `packages/*/client.js` |
| `docs/tests/triage.md:1-3` | the binding triage: `chemin: complet`, three sensitive files |

Measured, not assumed (commands run in this repository on 2026-10-27):

1. **The strategy's own example manifest is invalid.** `docs/etudes/2026-10-27-vertical-bundles-strategy.md:49-65`
   fed to `manifestErrors({}, …)` returns, in order:
   `(root) "description" is required`; and once a `description` is added,
   `extends "kybernos/skills#skill" but "kybernos/skills" is not in requires.plugins` and
   `extends "kybernos/dashboards#preset" but "kybernos/dashboards" is not in requires.plugins`.
   The page must therefore **not** copy that block; it shows the corrected manifest, and the
   contract-phase defect is recorded as a follow-up (section 8, F1).
2. **The two specs contradict themselves on the scan folder.** `plugin-contract.md:259-260`/`:477`
   claim `kybernos/plugins/<author>/<name>`; `:550`/`:603` and `registry.mjs:297-310`+`host.mjs:32`
   say `profiles/web/package.json` + `node_modules/<name>/`. A4 aligns `:259-260`/`:477` on the
   second (or on whatever A2's sortie says the truth now is) — never on the first. D20 measures it.
3. **`test-en-quotes.mjs` cannot fail on documentation.** It reads `packages/*/client.js` only, so
   the batch's dod line "green on the new English docs" is vacuous: that command passes today and
   will still pass with any English page. It is **not** a DoD here (see section 6) and the false
   premise is recorded (section 8, F2).
4. **Nothing in the repo scans `docs/` for `plugin.json`.** `build-catalog.mjs:218`,
   `test-layout.mjs:107` and `plugin-scan.mjs:22` all start from `packages/`. A template under
   `docs/dev/templates/` is therefore invisible to the four declaration points, as the batch
   requires, with no exemption to add (`plugin-scan-exceptions.json` has 3 entries today).
5. **The campaign's mockup folders do not exist on this machine.** The two handoff folders the
   campaign names (`dsh-kybernos/docs/handoff/vertical-medecin/maquette-v1` and
   `…/vertical-recrutement-ssii/maquette-v1`, in the checkout beside this one) are both absent
   (`test -d` fails on each). The local mockup
   convention is real and present under `docs/handoff/<subject>/maquette-v1/` (two subjects:
   `desktop-electron`, `session-msg`), but A4 needs neither (no UI).
6. **`docs/dev` holds 38 `.md` pages**, not the 44 the brief states (56 `.md` under `docs/` in
   total). Nothing in this batch depends on the count; recorded so the page does not repeat it.
7. Baseline of the gates this batch must not disturb: `node scripts/test-layout.mjs` → `LAYOUT — 21
   checks, 0 failure(s)`; `node scripts/build-catalog.mjs --check` → `catalogue up to date (47
   modules)`; `node scripts/garde-depot.mjs` → `1868 tracked files — 0 error(s), 0 warning(s)`.

---

## 3. AMBIGUITY: what a human must settle, not me

AMBIGUITY A1 — **the five frozen interfaces.** `I1`..`I5` are named nowhere in the repository. I read them as the five data points a sector bundle can target (`kybernos/core#domain-pack`, `kybernos/theme#theme`, `kybernos/skills#skill`, `kybernos/core#team-template`, `kybernos/core#automation-template`, with `kybernos/dashboards#preset` excluded because it is not built). Confirm this list, or supply the five and I freeze the page's table on them.

AMBIGUITY A2 — **the starter's `package.json`.** Strict reading of the batch's interdiction = no `dsh` key (my choice, validated by `registry.mjs:54-72`), which diverges from the four-file draft shape of `plugin-creator/SKILL.md:47-67` and from the registry's own fixtures (`test-host.mjs:44-45`). Do we accept the divergence (the page explains why a data bundle needs no patch), or does the template copy the skill's shape verbatim?

AMBIGUITY A3 — **narrowing an owner-approved contract line.** `plugin-contract.md:486` says `<folder | archive>`; I plan to narrow it to `<folder>` and label archives "not built (phase B)". Is that edit allowed on a contract whose six decisions the owner accepted on 2026-10-21, or must A4 implement archive reading and hashes (which is phase-B work and would grow this batch past "docs + a read-only report")?

AMBIGUITY A4 — **folder-level hygiene coverage.** `scripts/garde-depot.mjs` keeps `MEDIA` (`:11`) and `SECRET` (`:12`) private and exports only `isScanned`/`personalPath`/`personalMails`/`warningsOf` (`:28-35`). My choice: no new export (that file is outside the batch), reuse `isScanned` in both directions (a file it will not inspect — media or over 4 MB — is a `FAIL hygiene` for a data bundle) and `warningsOf` (personal paths, mail addresses); secret-**file-name** detection is then not covered, and the page says so. Alternative: a one-line `export` in `scripts/garde-depot.mjs`, which is a file this batch is not given.

AMBIGUITY A5 — **who exports the point objects for a static run.** The tool needs `validate` functions without a host. My choice: A4 imports the point objects the owner bundles export (`DOMAIN_POINT` pattern, `domain-pack.mjs:230`), including A2's four; if A2 exports them only inside a mount function, the report says `SKIP point.<id>` and the page states which points are checked offline — A4 never copies a validator, and an export belongs to A2's batch. Who owns that export?

---

## 4. Acceptance criteria

### A. The page `docs/dev/sector-bundles.md`

- [ ] H1 is "Build a sector bundle" (the file name stays the kebab-case topic name `sector-bundles.md`).
- [ ] One opening paragraph says what a bundle is (one folder, one `plugin.json`, several `extends`) and cites the strategy (`docs/etudes/2026-10-27-vertical-bundles-strategy.md:44-47`) — no invented framing.
- [ ] A section **Primitives first** (page / dashboard / listing, one view kind per datum / kit) with the "fits none of them → platform-evolution request, never a custom screen in a pack" sentence, cited to the build-contract skill `contrat-pack-vertical` and strategy `:74-84`.
- [ ] A section **Custom UI lives in Settings** (bounded fields, data only, no journey logic).
- [ ] A section **A theme is a token overlay** — one hex per sector, no CSS, no fetched font; the vocabulary cited to `packages/kybernos-theme/preset-store.mjs:43-52`, `:92-115`.
- [ ] A section **Cited or labelled** — every displayed datum cites a pack file or is marked "proposal".
- [ ] A table of the frozen interfaces with exactly five rows keyed `I1`..`I5`, each naming a point from `provides[]`, what the author ships, and the validator the tool runs (see AMBIGUITY A1).
- [ ] One complete `plugin.json` example that `manifestErrors` accepts with an outsider ctx (validated by the test, unit U10), and that is **not** the invalid block of `strategy.md:49-65`.
- [ ] The starter walkthrough: copy `docs/dev/templates/acme-vet-clinic/`, rename, run `node scripts/plugin-check.mjs <folder>`, read the report.
- [ ] The broken-variant table (variant → the one check id it breaks), matching this section's broken-variant table exactly.
- [ ] The install/preview loop, told truthfully: a `link:`/`file:` install shows as Local, and the registry reads `<DSH home>/profiles/web/package.json` + `node_modules/<name>/plugin.json` — cited to `plugin-contract.md:550`/`:603`, never to the stale `:477`.
- [ ] A "not built" list, labelled as such: signed catalogue and archives (phase B, `plugin-contract.md:484-500`), `kybernos/dashboards#preset`, and any point A2 did not open.
- [ ] Every `node scripts/…` command in the page names a file that exists (checked by unit U11).
- [ ] Linked from both binding specs at their head: `docs/dev/domain-packs.md:1-5` and `docs/dev/plugin-contract.md:1-4`, relative markdown link, existing style `[`sector-bundles.md`](sector-bundles.md)`.

### B. The starter `docs/dev/templates/acme-vet-clinic/`

- [ ] `plugin.json` is the `acme/vet-clinic` shape of `scripts/test-plugin-manifest.mjs:70-75` extended to the five built points, with `requires.plugins` covering **every** owner it extends (`manifest.mjs:86-90`), a `description`, and no `provides`.
- [ ] `package.json` has `name`, `version`, `description`, `license` and **no** `dsh` key, no `scripts`, no `bin` (see AMBIGUITY A2; reasons from `registry.mjs:54-72`).
- [ ] `domains/vet-clinic.json` passes `validatePack` (`domain-pack.mjs:68`): known keys only, id matching the file name, `en` present, goals within `LIMITS` (`:28`), no connector slug unless it exists in `packages/kybernos-composio/catalog.js`, no team id unless it exists in the marketplace **or** in this plugin's own `teams/`.
- [ ] `themes/vet-clinic.json` passes `sanitizePreset` (`preset-store.mjs:92`): `{ id, name, settings }` with at least one known setting and an `acc` in `#rrggbb`.
- [ ] `skills/<name>/` ships at least one skill in the shape A2's skills point accepts (folder + `SKILL.md`, or the JSON descriptor if A2 chose that) — the shape is **read from A2's sortie, never guessed**; its prompt drafts and never sends, and it cites the person's own material.
- [ ] `teams/<name>.json` and `automations/<name>.json` are one file each, in the shape A2's validators accept; the automation is a draft-only prompt with a five-field `cron`.
- [ ] A `README.md` states, in one line, that this is **sample data for a fictional author (`acme`)** — the "labelled" branch of the fourth build-contract rule — and that a real pack replaces every text and cites its sources.
- [ ] Text, JSON and YAML only: no image, font, PDF, binary; no `/Users/<name>` path (repo rule 4, `garde-depot.mjs:11`, `:20`).
- [ ] The folder is **not** a bundle: no entry in `scripts/lifecycle-packages.json`, `docs/beta/satellites.json`, `packages/kybernos-hub/catalog.json`.

### C. The broken variants `docs/dev/templates/acme-vet-clinic/broken/`

- [ ] One sub-folder per variant, each a **complete** plugin folder (own `plugin.json` + `package.json` + the faulty file) with exactly **one** seeded fault.
- [ ] Each fails `node scripts/plugin-check.mjs <variant>` with exit 1, exactly one `FAIL` line, and the check id listed in this section's table — no cascading second failure.
- [ ] None is picked up by a repo scan, and no `scripts/plugin-scan-exceptions.json` entry is needed.
- [ ] Fixtures are text/JSON only (media and secret-name fixtures are generated in a temp folder by the test, never committed — `garde-depot.mjs:11-12` would refuse them anyway).

### D. The tool `scripts/plugin-check.mjs`

- [ ] Usage: `node scripts/plugin-check.mjs <folder>`; exit `0` = no `FAIL`, `1` = at least one `FAIL`, `2` = usage (no argument, a path that does not exist, a file, two arguments).
- [ ] One report, fixed check order, one summary line, no timestamp, no absolute path beyond the argument as given → two runs are byte-identical (unit U15).
- [ ] Checks, in this order, with these ids: `manifest.present`, `manifest.json`, `manifest.schema`, `manifest.rules`, `manifest.points`, `package.data`, `point.<point-name>` (one per `extends`, in manifest order), `code.scan`, `claims.unique`, `help.card`, `compat.zone`, `hygiene`, `archive`.
- [ ] Each line prints `PASS`/`FAIL`/`SKIP`, the id, then the validator's message **verbatim**; a `manifest.json` failure ends the run after that line.
- [ ] Reuses, imports only, no copy: `manifestErrors`/`setErrors` (`scripts/plugin-manifest.mjs`), `schema-subset` (`scripts/schema-subset.mjs`), `dataPackageProblems` and `readExtension` semantics from `packages/kybernos-registry/registry.mjs`, the point objects (`DOMAIN_POINT` and A2's four), `scanText`/`uncovered` (`scripts/plugin-scan.mjs:57`, `:109`), `isScanned`/`warningsOf` (`scripts/garde-depot.mjs:28-35`).
- [ ] Our own modules are held to the same check with the first-party `ctx` of `scripts/test-layout.mjs:112` — `node scripts/plugin-check.mjs packages/kybernos-theme` exits 0.
- [ ] **It never writes**: the checked folder is byte-identical after a run (test hashes every file before/after).
- [ ] It makes no network call (its own source, scanned by `scanText`, shows no `net` evidence).
- [ ] It reports unknown sub-folders (e.g. the starter's own `broken/`) as `SKIP`, visible, never silently ignored and never a failure.

### E. The two binding specs

- [ ] `domain-packs.md:108` (theme row): no longer `next`; cites the seam batch A1 landed, by an identifier that exists in `packages/kybernos-theme/*.mjs` or `packages/kybernos-plugin/client.js`.
- [ ] `domain-packs.md:158`: "A plugin pack cannot bundle skills yet" is replaced by the `kybernos/skills#skill` point and what A2 landed.
- [ ] `plugin-contract.md:266`, `:269`, `:270`, `:271`, `:272`: the four newly built points say `opened <date>` **only where they actually are**; `:266` (`dashboards#preset`) says `not built` and stays honest.
- [ ] `plugin-contract.md:259-260` and `:477`: aligned on the real read location (`:550`/`:603` or A2's new one), measured by D20.
- [ ] `plugin-contract.md:484-500`: the section points at the real `scripts/plugin-check.mjs`, the CLI line matches the tool, archives labelled "not built", and `:500` keeps "necessary for every level and sufficient for none".
- [ ] Both specs link the new page at their head.

### F. Interdictions, made checkable

- [ ] `docs/`, `scripts/plugin-check.mjs`, `scripts/test-plugin-check.mjs` are the only paths touched — no `packages/**`, no `catalog/**`, no `docs/dev/schemas/plugin.schema.json`.
- [ ] No new bundle declared; catalogue not drifted (`build-catalog.mjs --check`).
- [ ] No media, no personal path, no key, no signed-catalogue material.
- [ ] English prose.

---

## 5. The six mandatory sections

e2e: A4 owns one end-to-end journey, and documents one it must not own.

**E1, the authoring loop** (in `test-plugin-check.mjs`): copy the starter to a `mkdtemp` folder → run the tool → expect exit 0 and the same check ids as in the repo; delete `description` from the copy → exit 1 with `manifest.schema`; restore → exit 0; hash the repository fixture before and after, assert unchanged. **E2, the doc-as-contract loop**: every fenced `node scripts/…` command of the page is executed (or parsed and its target asserted to exist) against the repo, so a page that lies goes red. **E3, the real install journey** — copy the starter into an isolated DSH as a `link:` dependency, open the wizard, see the vet-clinic tile, accept the plugin, check `GET /kybernos/domains` marks the pack `from: "acme/vet-clinic"`, install one ticked goal, uninstall and check nothing is left — is **not** in A4's gate and not in its DoD: it needs a running `dsh` and a profile (`docs/dev/live-testing.md`), the tool ships no runtime, and the journey belongs to the batches that ship the engine behaviour (A2's reader, A3's packs). The commands are written in the page so a reviewer can play it; its result is recorded by whoever plays it, never asserted here.

vision: not applicable, and here is why.

This batch adds no pixel: a Markdown page, JSON/Markdown fixtures, and a terminal report. The repo's UI-proof doctrine (an interface delivery must be captured in every state, light and dark, then read back with `read_image`) has no object here — a Markdown file has no states, and this repository's own app does not render `docs/`. The nearest thing to a visual surface is the report's alignment, which is a text assertion (unit U15/U16), not an image. No screenshot is produced, and none could be: `garde-depot.mjs:11` refuses tracked images, so a capture folder under `docs/dev/templates/` is impossible by rule. If A4 had shipped a settings screen (it does not — see the build contract: a pack configures data, it does not draw), vision evidence would have been mandatory.

capture: not applicable, same reason, plus a measured one.

There is nothing to capture: no page, no panel, no wizard step, no theme miniature is rendered by this batch. The two mockup folders the campaign points at (`vertical-medecin/maquette-v1`, `vertical-recrutement-ssii/maquette-v1`) are **absent from this machine** (verified `test -d`, section 2, fact 5), so even a "capture the reference design" step would have no source. What replaces a capture here is the **report text**: the DoD block below prints the sample report and its summary line, and the reviewer reads that instead of an image.

maquette: not applicable, stated rather than omitted.

A maquette exists to freeze an interface before code; A4 ships no interface, so there is nothing to freeze — the "interface" this batch freezes is data: the five point ids, the check-id vocabulary, the report format. Those are frozen in *text* (the report format and the broken-variant table below, and the spec table above), not in an HTML mockup. The repo's mockup convention (`docs/handoff/<subject>/maquette-v1/` with `README.md`, `cadrage.md`, `index.html`, `contract.mjs`; two subjects today: `desktop-electron`, `session-msg`) is the right tool for A1's theme miniature and A3's packs, not for a docs page. No `docs/handoff/a4-…` folder is created, and none should be.

unit: `scripts/test-plugin-check.mjs`, hermetic (no network, no DSH, no write outside `mkdtemp`),
discovered by `scripts/run-all-tests.mjs:73-77` through the `test-plugin` filter. Cases, all deterministic:

| # | Case | Expected |
|---|---|---|
| U1 | the starter folder | exit 0, 0 `FAIL`, the 12 applicable ids in the fixed order |
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
| U13 | the page's five frozen-interface rows | exactly 5, each id a point declared in some `provides[]` |
| U14 | the four build-contract sections | each heading present, in the page |
| U15 | two consecutive runs on the same folder | byte-identical reports |
| U16 | a folder with an extra directory | `SKIP` line naming it, exit unchanged |
| U17 | point validators | imported, not copied: the tool's source contains no `#rrggbb` test, no pack key list, no cron parser of its own |
| U18 | a point whose validator is not importable | `SKIP point.<id>` with the phase/label, never a `PASS` |

DoD: the commands below, run from the repository root.

Each one is red on the code as it stands today (measured one by one on 2026-10-27: every line
exits non-zero now) and must exit 0 once the batch is complete. A command that already passes today
is not in this list — those are the regression gates of section 6.

```bash
# D1 the page exists
test -f docs/dev/sector-bundles.md

# D2 both binding specs link it at their head
grep -q 'sector-bundles.md' docs/dev/domain-packs.md && grep -q 'sector-bundles.md' docs/dev/plugin-contract.md

# D3 the page carries the four build-contract rules
test -f docs/dev/sector-bundles.md && grep -qi 'primitives first' docs/dev/sector-bundles.md && grep -qi 'custom UI lives in settings' docs/dev/sector-bundles.md && grep -qi 'token overlay' docs/dev/sector-bundles.md && grep -qi 'cited or labelled' docs/dev/sector-bundles.md

# D4 the page carries exactly five frozen-interface rows
test -f docs/dev/sector-bundles.md && test "$(grep -cE '^\| .I[1-5].' docs/dev/sector-bundles.md)" -eq 5

# D5 the starter manifest exists and the folder is text only
test -f docs/dev/templates/acme-vet-clinic/plugin.json
test -d docs/dev/templates/acme-vet-clinic && test -z "$(find docs/dev/templates -type f ! -name '*.json' ! -name '*.md' ! -name '*.yml' ! -name '*.yaml' -print -quit)"

# D6 no personal path in what this batch adds
test -f docs/dev/sector-bundles.md && ! grep -rq '/Users/' docs/dev/templates docs/dev/sector-bundles.md

# D7 the starter is not a bundle (no dsh key in its package.json)
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
test -f docs/dev/templates/acme-vet-clinic/plugin.json && ! grep -q 'acme-vet-clinic' scripts/lifecycle-packages.json docs/beta/satellites.json packages/kybernos-hub/catalog.json && node scripts/test-layout.mjs >/dev/null && node scripts/build-catalog.mjs --check >/dev/null

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

The report format the DoD prints (frozen here, asserted by unit U1/U2/U15), one sample run on the starter:

```
plugin-check v1 — docs/dev/templates/acme-vet-clinic
plugin: acme/vet-clinic 1.0.0 (data, 5 points, free)
  PASS  manifest.present    plugin.json found
  PASS  manifest.json       plugin.json is valid JSON
  PASS  manifest.schema     plugin.schema.json, subset interpreter: no fault
  PASS  manifest.rules      ids, reserved namespaces, version, claims: no fault
  PASS  manifest.points     extends 5 points, ranges satisfied, requires.plugins covers their owners
  PASS  package.data        no dsh key, no install script, no bin
  PASS  point.domain-pack   domains/vet-clinic.json
  PASS  point.theme         themes/vet-clinic.json
  PASS  point.skill         skills/consult-notes
  PASS  point.team-template teams/clinic-desk.json
  PASS  point.automation-template automations/morning-reminders.json
  PASS  code.scan           no .js in the folder: nothing to declare
  PASS  claims.unique       no claim of this kind in a data plugin
  SKIP  help.card           not a module of the Suite (no help key)
  SKIP  compat.zone         no requires.dsh in a data plugin
  PASS  hygiene             18 files, no media, no personal path
  SKIP  archive             not built (phase B: signed archive and hashes)
  SKIP  broken/             not declared by extends; not part of the plugin
summary: 13 pass, 0 fail, 4 skip — exit 0
```

The broken-variant table the page and the test share (each variant fails **only** the id in the right-hand column; this table is the contract):

| Variant (`broken/…`) | Seeded fault | Check id that must fail |
|---|---|---|
| `01-not-json/` | `plugin.json` is not valid JSON | `manifest.json` |
| `02-no-description/` | `description` missing (first fault of the strategy's own example) | `manifest.schema` |
| `03-extends-without-requires/` | extends `kybernos/theme#theme`, `requires.plugins` omits it (`manifest.mjs:86-90`) | `manifest.rules` |
| `04-unknown-point/` | extends `kybernos/core#nope` (owner required, point unopened) | `points.known` |
| `05-domain-pack-unknown-key/` | `domains/clinic.json` carries a key `validatePack` does not know | `point.domain-pack` |
| `06-theme-bad-accent/` | `themes/x.json` sets `acc: "blue"` (`sanitizePreset`, `HEX6`) | `point.theme` |
| `07-package-loads-code/` | `package.json` gains `scripts.postinstall` (or `dsh.bundle.patch` naming a module) | `package.data` |

---

## 6. Regression gates — green today, therefore **not** DoD

Listed so the A4 agent runs them and so nobody mistakes them for proof of this batch. Each passed
before the batch started (section 2, fact 7, for the first two and the guard):

```bash
node scripts/test-layout.mjs                 # LAYOUT — 21 checks, 0 failure(s)
node scripts/build-catalog.mjs --check       # catalogue up to date (47 modules)
node scripts/garde-depot.mjs                 # 1868 tracked files — 0 error(s), 0 warning(s)
node scripts/run-all-tests.mjs --only test-plugin   # test-plugin-manifest, -scan, -exits (and the new one once it exists)
node scripts/test-lifecycle-engine.mjs && node scripts/test-paquet.mjs   # AGENTS.md pre-push line
node scripts/run-all-tests.mjs               # the merge gate: must end 0 red, no known red
```

The batch's dod line "`node scripts/test-en-quotes.mjs` — green on the new English docs" is **not**
reproduced above and is not a DoD: that script reads `packages/*/client.js` only
(`test-en-quotes.mjs:10`, `:16-23`), so it cannot fail on a `.md` file and cannot prove anything about
this batch. The English-docs rule is held by review and by D3/D4 instead.

---

## 7. Out of scope

- **Any runtime behaviour**: no theme seam (A1), no multi-point reader (A2), no vertical pack content
  (A3), no catalogue, no signed archive, no install path. A4 documents and checks what those land; it
  changes none of it.
- **`packages/**`** — including the four point objects this batch imports. If a point object is not
  importable, the answer is `SKIP` + a note (AMBIGUITY A5), never an edit inside a bundle.
- **The schema pair** (`docs/dev/schemas/plugin.schema.json`, `packages/kybernos-registry/plugin.schema.json`):
  read, cited, never written (they belong to A2).
- **`scripts/lifecycle-packages.json`, `docs/beta/satellites.json`, `packages/kybernos-hub/catalog.json`,
  `catalog/**`**: untouched, and D13 proves no drift.
- **`scripts/plugin-scan.mjs`, `scripts/garde-depot.mjs`, `scripts/plugin-scan-exceptions.json`,
  `scripts/plugin-manifest.mjs`**: untouched. Their limits are stated, not repaired (this is what
  AMBIGUITY A4 is about).
- **Archive mode, signatures, catalogue submission, trust levels** (contract phase B/C): labelled
  "not built" in the page and in section 11.
- **The `kybernos/dashboards#preset` point**: it stays "not built"; A4 must not make it look built to
  fill a table.
- **The strategy document** (`docs/etudes/2026-10-27-vertical-bundles-strategy.md`) and
  `docs/tests/triage.md`: not in this batch's file list. Its invalid example (`:49-65`) and its stale
  `plugin-check.mjs … not built` line (`:25`) are recorded as follow-ups, not fixed here.
- **A second template** (a Law or recruitment variant): one worked example beats an SDK; more would be
  content work (A3's domain).
- **Translating the page**: repo rule 6 makes new docs English.

---

## 8. Follow-ups recorded (not silently closed)

- **F1** — `docs/etudes/2026-10-27-vertical-bundles-strategy.md:49-65`: its example manifest is refused
  by the repo's own validator (missing `description`; then `kybernos/skills` and `kybernos/dashboards`
  missing from `requires.plugins`). Fix belongs to the strategy's owner; A4 shows the valid version.
- **F2** — the batch's dod line on `test-en-quotes.mjs` is vacuous (the test reads only
  `packages/*/client.js`). Either the test grows a docs pass, or the line is dropped from the dod
  vocabulary.
- **F3** — `plugin-contract.md:259-260`/`:477` vs `:550`/`:603`: A4 aligns the first pair on the
  second; if A2 moves the read location again, D18 keeps both honest automatically only for the
  literal folder string — a stronger check (reading the doc claim and the code path into one
  assertion) is a candidate for a future docs-lint.
- **F4** — `kybernos/dashboards#preset`: no contribution path exists; the row stays "not built" and the
  page lists it in the not-built section.
- **F5** — the recruitment SSII content (`vertical-recrutement-ssii`) has no mockup on this machine
  (fact 5): its métier read-back cannot happen here, and A4 does not claim it.
- **F6** — signed catalogue publication (contract phase 3/B): the report is "necessary for every
  level and sufficient for none" (`plugin-contract.md:500`); A4 quotes that line instead of inventing
  a badge.
- **F7** — secret-file-name detection in folder mode (AMBIGUITY A4): either one exported constant in
  `scripts/garde-depot.mjs` or a documented gap in the page. Recorded, chosen as "documented gap" here.
