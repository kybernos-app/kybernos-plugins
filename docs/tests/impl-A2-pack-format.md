# A2-pack-format — implementation report

Batch: `A2-pack-format` (*pack format: theme reference, multi-point merge, host routes, onboarding state*).
Spec: `docs/tests/A2-pack-format-strategy.md` (verdict GO, `docs/tests/gate-verdicts-final.md`).
Implementer lane: **B (standard)**.

## Verdict

**pass** — the ten DoD commands are green, the perimeter is the six declared files plus this report, and no red
of the full suite is caused by this batch (measured by reverting the whole batch, see *Attribution*).

Three spec defects are reported below. Items 1 and 3 are text defects that do not block the batch (the measurable
contract was followed); item 2 is a rule I had to choose against the prose, and the owner must confirm it before the
merge message claims the automation shape as frozen.

## ROOT CAUSE (one line)

Not applicable — lane B: no auth, billing, RLS, migration or secret surface is touched; `onboarding-state.mjs` and
`domain-pack.mjs` stay pure, `plugin.json` gains two `provides` entries and no permission, and the only host lines
changed are the route zone and the one import line granted by bound decision D4.

## Files touched

| File | Change |
|---|---|
| `packages/kybernos-plugin/domain-pack.mjs` | the `theme` pack key (key list `:82`, 40-character id `:40`, `null` when absent `:201`); `TOPOLOGIES` `:24`; `validateTeamTemplate` `:283` and `validateAutomationTemplate` `:315` with their helpers; `TEAM_POINT` `:408`, `AUTOMATION_POINT`, `CORE_POINTS` `:413`, `KIT_POINTS` `:422`; `mergePackSets(shipped, contributions, kitContributions)` `:438`; `packsOf(shipped, registry)` `:479` |
| `packages/kybernos-plugin/index.js` | `:30` the single granted import line; the pack seam shrunk to `const domainPacks = () => packsOf(shippedPacks(), registrySeam())` `:10732` and the boot `definePoint` loop `:10733`; the complete echo gains `theme: next.theme` `:10793` |
| `packages/kybernos-plugin/onboarding-state.mjs` | `THEME_RE` `:53`, `theme: null` in `defaultState` `:112`, `theme` in `publicView` `:129`, kept when a client sends none in `complete` `:153` |
| `packages/kybernos-plugin/plugin.json` | two `provides` entries after `domain-pack`: `team-template` `:42`, `automation-template` `:52` (`provides.length === 3`) |
| `packages/kybernos-plugin/test-domain-pack.mjs` | 42 → **52** checks: the theme checks `:139`/`:151`, the two validators `:405`/`:416`/`:439`/`:450`, the kit table `:465`, the merge `:501`/`:517`, `packsOf` `:527`, and the three A3-proof assertions `:279-284` (nine ids in relative order, catch-all last), `:319-320` (nine preset pairs, extras must be one of `PRESETS`), `:352` (sweep over what `loadPacks` returned); the manifest sync generalised to `CORE_POINTS` `:362`; the end-to-end extended with `teams/` and `automations/` `:543` |
| `packages/kybernos-plugin/test-onboarding-state.mjs` | 18 → **20** checks on the `theme` field `:149`, `:155` |
| `docs/tests/impl-A2-pack-format.md` | this report (the delegation's artifact, not a batch file; the six-file perimeter is unchanged) |

## DoD before → after

All ten commands were extracted verbatim from the spec into `/tmp/a2dod/D<n>.sh` and run from the repository root,
before any write (`before`) and after the last write (`after`). Nothing was reformatted: the extracted text is the
spec's.

| # | Before (exit 1, quoted from the run) | After |
|---|---|---|
| D1 | `AssertionError [ERR_ASSERTION]: ["pack: unknown key \"theme\""]` | **exit 0** |
| D2 | `AssertionError: Expected values to be strictly equal` on `validatePack(pack({})).ok === true` (theme unknown) | **exit 0** |
| D3 | `+ undefined / - null` at `fresh.theme` | **exit 0** |
| D4 | `TypeError: m.validateTeamTemplate is not a function` | **exit 0** (see defect 2: it needed a shape decision first) |
| D5 | `TypeError: Cannot read properties of undefined (reading 'teams')` (`clinic.kit`) | **exit 0** |
| D6 | `AssertionError: Expected values to be strictly equal` `false !== true` at `Array.isArray(m.CORE_POINTS)` | **exit 0** |
| D7 | `TypeError: m.packsOf is not a function` | **exit 0** |
| D8 | `42 checks passed` / `18 checks passed` — under the 50 / 20 thresholds | **exit 0** — `52 checks passed` / `20 checks passed` |
| D9 | `AssertionError: the complete answer does not echo theme` | **exit 0** |
| D10 | `AssertionError [ERR_ASSERTION]: listed in the pack's own order, the catch-all last` (`:257`) | **exit 0** |

No DoD command was already green before the batch: none of them was skipped or weakened.

### One intermediate red, kept because it is the evidence for defect 2

After the validators existed, D4 still failed with:

```
AssertionError [ERR_ASSERTION]: ["apps: at least one app","ask: 2 to 4 questions"]
false !== true
```

D4's *accepted* automation fixture carries **no `apps`** and **one `ask` question**, while the spec's shape table and
refusal list require `apps` 1-4 and `ask` 2-4. See *Spec defects* 2.

## Spec defects (measured, for the owner)

1. **The theme id cap is off by one in the prose, and the DoD is right.** The spec says the pack key is
   `/^[a-z0-9][a-z0-9-]{0,40}$/` (interpretations 1 and 3, the final key list) *and* D1/D3 require `'x'.repeat(41)` to be
   refused. Measured: `/^[a-z0-9][a-z0-9-]{0,40}$/.test('x'.repeat(41)) === true` — the stated regex accepts 41
   characters. I implemented the measurable contract: **at most 40 characters** (`{0,39}`,
   `domain-pack.mjs:40`, `onboarding-state.mjs:53`), which is also what the AMBIGUITY line ("40 vs 63") means. The
   63-character consequence of the AMBIGUITY is unchanged: a preset whose id is 41-63 characters can never be named by
   a pack, and that was already the stated consequence of choosing 40.
2. **D4's accepted automation fixture contradicts the frozen shape table.** The fixture has one question and no app;
   the table requires 2-4 questions and 1-4 apps, and the refusal list cites 2-4 as *cited* (not proposal). The DoD is
   the executable gate, so the validator accepts **1-4 questions** and **0-4 apps** (absent `apps` reads `[]`), and
   refuses `ask: []`, more than four questions, fewer than two options, a bad slug and more than four apps. This is
   the one place where the code does not follow the prose; the pin is in the test file (`test-domain-pack.mjs:446`,
   `:447`), which asserts that the DoD's own lean fixture is accepted, so a later reader cannot "re-tighten" it
   without seeing this line. Every other bound follows the spec (steps 2-6 and their two kinds, `ask.o` 2-6, `needs`
   and `guard` non-empty, `tags` non-empty, five-field cron, the no-cron case left to the cadence).
3. **e2e 3 claims a route-payload effect the seam cannot produce.** It says a bad `teams/` file makes "the `rejected`
   list of the route payload grow by one". The route answers `rejected: r.rejected.length`
   (`index.js:10737`), a count of *pack* rejections; a template refused by its point never reaches `mergePackSets`
   (the registry only hands over accepted files, `registry.mjs` `readExtension`), so it is reported in
   `entry.extends[].rejected` instead. Making that count grow would need a new payload field — a route change this
   batch forbids. What is proved instead: the point-level refusal (`test-domain-pack.mjs:580`, quoted below), the good
   templates merging, and the route's tolerance (no 5xx). The *kit* rejections that do reach the payload are the stray
   ones, and those are proved to grow `rejected` (`:517`).

## Anchors: what drifted, and what was verified instead

Spec baseline is `2ac67fb4`; the worktree had moved before this batch opened (`317b2f21` plus the neighbour
batches' uncommitted diff).

- **`index.js` route zone: drifted, re-pinned against the current file.** The spec's pins (`domainPacks` `:10719-10727`,
  boot `definePoint` `:10728`, `GET /kybernos/domains` `:10729-10733`, `/kybernos/domain/skill` `:10737-10752`,
  `/kybernos/onboarding` `:10753-10790`, echo `:10787-10789`) sat **+12 lines** in the worktree: `domainPacks`
  `:10731-10739`, boot `:10740`, GET `:10741-10745`, skill route `:10749-10764` (`listed` `:10757`, refusal `:10758`),
  onboarding `:10765-10802`, `onboardingComplete` `:10797`, echo `:10800`. (Those are the numbers this batch's edits
  were written against; after the seam shrank by four lines the current file has `rejected: r.rejected.length` at
  `:10737`, `onboardingComplete` at `:10790` and the echo at `:10793`, as the *Files touched* table says.) Every edit
  was made against the measured zone, not against the baseline numbers.
- **`index.js:30`: no drift** (verified, as the spec's revision 2 assumed), and it is **one line**: the import now reads
  `packsOf, CORE_POINTS` instead of `mergePackSets, DOMAIN_POINT, DOMAIN_POINT_REF` — the three names removed are dead
  in `index.js` once the seam is `packsOf`.
- **`onboarding-state.mjs` `:92-106` / `:109-121` / `:124-145`: no drift** in the worktree before this batch (measured
  on the file); they moved only because of my own 6-line insertion at `:49-55`.
- **`domain-pack.mjs:71` and `:230-233`: no drift** before the batch (measured); moved by my insertions (`:82` and the
  point block at `:406-427`).
- **`test-domain-pack.mjs:181`, `:255-258`, `:290`, `:322-327`, `:330-339`, `:370-399` and
  `test-onboarding-state.mjs:21-30`, `:125-134`, `:163`: no drift** in the worktree (measured on the file before
  writing); they moved afterwards.
- **`plugin.json:30-41`: no drift**; the two new entries sit after the existing one (`:42`, `:52`).

## Proof that the guards and the route families did not move

- `git diff -- packages/kybernos-plugin/index.js | grep -cE '^[+-].*(sameOriginStrict|writeRefused)'` → **0**.
- route registrations added: `git diff -- packages/kybernos-plugin/index.js | grep -cE '^\+.*webServerSvc\.register'` → **0**.
- hunks in `index.js`: **4** — the granted import (`:30`), the two comment lines above `domainPacks` (`:10729`), the
  seam and the boot loop (`:10731-10740`), the echo (`:10800`). Nothing else in the file.
- `scripts/patches.json`, `dsh-compat.json`, `package.json`: untouched (`git status --short` silent).
- every client factory: unchanged (`client.js` is not in this batch's perimeter, and no file of it was written).

## Perimeter proof

`git diff --name-only` for this batch's own paths:

```
packages/kybernos-plugin/domain-pack.mjs
packages/kybernos-plugin/index.js
packages/kybernos-plugin/onboarding-state.mjs
packages/kybernos-plugin/plugin.json
packages/kybernos-plugin/test-domain-pack.mjs
packages/kybernos-plugin/test-onboarding-state.mjs
```

plus the untracked report `docs/tests/impl-A2-pack-format.md` (`git status --short docs/tests/impl-A2-pack-format.md` →
`??`).

**The tree was not clean at opening, contrary to the delegation's note** (measured at 04:15, before any write): four
modified files (`.claude/skills/ux-bug-hunter/probes.js`, `packages/kybernos-composio/cordis.patch.yml`,
`scripts/check-hit-targets-live.mjs`, `scripts/check-ux-probes.mjs`) and a long untracked list (screenshots,
`campagne-recette-*`, `demo/`, `artifacts/`, `docs/handoff/*`). During this session the neighbour batches' diff
landed too. `git diff --name-only` therefore lists **29 tracked files** at the last measurement (25 mid-session: the
neighbours keep writing), of which **six are mine**; the other twenty-three belong to the batches whose perimeters the
gate itself declares disjoint:

- A1-theme-seam: `packages/kybernos-theme/{client.js,gallery.json,index.js,plugin.json,preset-store.mjs,themes-catalogue.mjs,test-client.mjs,test-preset-store.mjs,test-themes-catalogue.mjs}`, `catalog/themes/_catalogue.json`, `scripts/test-themes-catalogue.mjs`
- A2-registry-points: `packages/kybernos-registry/{manifest.mjs,plugin.schema.json,registry.mjs,test-registry.mjs}`, `docs/dev/schemas/plugin.schema.json`, `packages/kybernos-skills/{index.js,plugin.json}`
- A3-vertical-content: `packages/kybernos-plugin/domains/sante.json`
- pre-existing: `.claude/skills/ux-bug-hunter/probes.js`, `packages/kybernos-composio/cordis.patch.yml`, `scripts/check-hit-targets-live.mjs`, `scripts/check-ux-probes.mjs`

I wrote no line outside the six files above; the only new file under `docs/tests/` is this report (untracked, no tracked file added).

## Attribution of the reds (measured, not claimed)

`node scripts/run-all-tests.mjs`, measured twice on this tree: **529 test files in 203 s: 515 green, 14 RED** (first
run) then **529 files in 195 s: 516 green, 13 RED** (final run, quoted below). The spec's D8 recorded 8 and the gate
measured 10; the tree keeps moving under the neighbour batches' uncommitted diffs — `packages/kybernos-theme/test-icon-sets.mjs`
went green between my two runs without a line of mine — so the number is measured each time, never quoted.

To prove none of the reds is mine, I saved the six files, restored their `HEAD` content (`git show HEAD:<path>`), ran
the red files, then restored my work (md5 `f7e544d137447df1537fd19ad9598672` before and after) and re-ran D1-D10 (all green):

| Red file | Red without this batch? |
|---|---|
| `scripts/test-consistency-guards.mjs` | yes (kybernos-log) |
| `scripts/test-help-mounts.mjs` | yes (kybernos-log `help.json` never mounted) |
| `scripts/test-help.mjs` | yes (kybernos-log) |
| `scripts/test-layout.mjs` | yes (kybernos-log) |
| `scripts/test-no-french-literals.mjs` | yes (kybernos-log) |
| `scripts/test-no-legacy-hosts.mjs` | yes (neighbour work, recorded by the gate) |
| `scripts/test-plugin-scan.mjs` | yes (`kybernos-pulse`, `exec` undeclared) |
| `scripts/test-readmes.mjs` | yes (kybernos-log) |
| `scripts/test-signposts.mjs` | yes (`packages/kybernos-log/help.json` paths) |
| `packages/kybernos-plugin/test-menu-icons.mjs` | yes (the theme bundle's icon-set row `cloudcomputer`) |
| `packages/kybernos-plugin/test-settings-nav.mjs` | yes (kybernos-log, pre-existing) |
| `packages/kybernos-servers/test-host.mjs` | yes (neighbour work, recorded by the gate) |
| `packages/kybernos-theme/test-client.mjs` | yes (A1-theme-seam, uncommitted here) |

The first run also had `packages/kybernos-theme/test-icon-sets.mjs` red, and it was red without my batch too; it is
green in the final run (the neighbour's A1 diff was fixed in between).

**0 red caused by this batch.** The merge message must name those 13 rather than claim a green suite.

Regression gate (measured on this tree, after the batch):

| Command | Result |
|---|---|
| `node scripts/garde-depot.mjs` | 1944 tracked files — **0 error(s), 1 warning(s)**, exit 0. The warning is `docs/tests/gate-verdicts-final.md` (a hard-coded personal path in the campaign artifact, not this batch) |
| `node scripts/test-lifecycle-engine.mjs` | 82 assertions, 0 échec, exit 0 |
| `node scripts/test-paquet.mjs` | 111 assertions, 0 échec(s), exit 0 |
| `node scripts/run-all-tests.mjs --only domain` | 1 file, 1 green, exit 0 |
| `node scripts/run-all-tests.mjs --only onboarding` | 2 files, 2 green, exit 0 |
| `node packages/kybernos-registry/test-skill.mjs` | 7 checks passed, exit 0 |
| `node packages/kybernos-registry/test-registry.mjs` | `REGISTRY OK`, exit 0 |
| `node scripts/test-onboarding.mjs` | `all checks passed`, exit 0 |

## Acceptance evidence (`vision:` and `capture:` are declared not applicable)

The spec replaces the eye with two deterministic citations. Both were produced from a throwaway script outside the
repository (a real temp profile, the real `createRegistry`, the real `packsOf`), not from a mock.

**(1) The served payload.** One plugin `acme/clinic` with `domains/`, `teams/`, `automations/` and one bad team file:

```
1) before consent, served packs = 10 shipped only
2) the contributed pack, served as GET /kybernos/domains sends it:
   { "theme": "clinic-teal",
     "kit": { "teams": [ { "id": "clinic-assist", … , "from": "acme/clinic", "file": "teams/clinic-assist.json" } ],
              "automations": [ { "id": "daily-recall", … , "from": "acme/clinic", "file": "automations/daily-recall.json" } ] } }
3) shipped packs carrying a kit: 0
4) rejections of the route payload: 0 (the bad team file is refused by its point, see below)
   entry.extends[] teams rejected: [{"file":"bad.json","errors":["team: unknown key \"css\"","roles[0].id: not a valid id",
   "roles: at least one role","stages[0].id: not a valid id","stages: at least one stage"]}]
5) a template for a pack that is not offered: [{"file":"acme/other:teams/y.json",
   "errors":["no pack of acme/other is offered: the template would go nowhere"]}]
```

The kit entries are flat and citable (`{ ...value, from, file }`), the shipped packs carry no `kit` key, the theme
travels as one string, and nothing throws on a bad file (no 5xx).

**(2) `onboarding.json` before and after a complete** (the file lives in `<DSH home>/kybernos/onboarding.json`; printed
from the pure module, which is the same object `index.js` writes):

```
1) fresh install:      { "version": 1, "completed": false, …, "theme": null, "about": null }
2) after complete:     { "version": 1, "completed": true, …, "theme": "clinic-teal", "about": null }
3) the POST answer:    {"ok":true,"completed":true,"profil":"clinic","uiMode":null,"model":null,"lang":null,
                        "theme":"clinic-teal","goals":["calls"],"agents":null}
4) GET (publicView):   {…,"agents":null,"theme":"clinic-teal"}
5) an older file (no theme key): completed: true | theme: null
```

## What the Lead should look at

1. **Decide defect 2** (automation shape): keep the DoD's lean fixture (what is implemented) or change D4 and tighten
   the validator to 2-4 questions and 1-4 apps. One line each way; the test pins whichever is chosen.
2. The `docs/dev/domain-packs.md:108` row (“Theme per field … **next**”) is now backed by the host, but that file is
   outside this perimeter: it is the Lead's or A4's edit.
3. The consumer of `pack.kit` stays deferred to A1-kit-wizard as the spec records; the wire is exactly
   `{ themes?, skills?, teams?, automations? }`, authored goals never mutated, and `kit` only appears on packs that
   come from a plugin and only when a kit point carried a contribution.
4. No commit was made (the Lead commits per batch); `master`/`dev` untouched.
