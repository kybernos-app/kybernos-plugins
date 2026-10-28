# Gate verdicts — FINAL pass (validateur-spec, fail-closed)

Run: final gate over the seven Phase A specs, 2026-10-28 ~03:35-04:00 (Europe/Paris), worktree
`/Users/miled/kybernos-projects/kybernos-plugins` at HEAD `06d11411` plus the neighbour session's
uncommitted diff. Every `file:line` anchor was checked against the declared baseline `2ac67fb4`
(`git show 2ac67fb4:<path>`), never against the moving worktree. Correction cycles 2/2 spent; A4 is
the NO-GO resubmission. This file is the campaign artifact.

Calibration (stated once): a spec is **AMEND** when a gate check fails *in substance* — an unapplied
bound decision, a false premise that changes what is built or reviewed, or a dishonest baseline
record. Isolated anchor slips (off-by-small, or a post-baseline campaign file cited without its
carve-out) are listed per spec as **re-pin fixes** — the specs themselves require re-pinning at
implementation opening (D1) — and do not flip a verdict on their own; the owner may veto any GO on
the strength of a listed slip.

Gate ground truth (measured this run):
- Anchor passes (mechanical, four independent sweeps over `git show 2ac67fb4:<path>`): **725 distinct
  `file:line` anchors** checked across the seven specs (A1-theme-seam 123, A1-kit-wizard 73,
  A2-pack-format 115, A2-registry-points 76, A3 141, A4 89, A5 108). Anchor tables resolve; the
  per-spec slip lists below are the complete burn-down (16 items, all mechanical).
- `git diff --numstat 2ac67fb4 -- packages/kybernos-theme/` is empty (the bundle is byte-identical to
  the baseline, as A1-theme-seam claims).
- `node scripts/run-all-tests.mjs` → **529 files, 519 green, 10 RED** (186 s, exit 1). The 8 reds the
  specs attribute are confirmed verbatim; **two new neighbour reds appeared after their measurement**:
  `scripts/test-no-legacy-hosts.mjs` and `packages/kybernos-servers/test-host.mjs`. No spec claims
  "all exit 0" / "all tests pass" anywhere (grep-verified): the D8 discipline is held campaign-wide.
- The recruitment accent is exactly as D5 requires: `docs/handoff/theme-recrutement-ssii/maquette-v1/maquette.html:23`
  = `--vb-accent: #4F5BD5;`, allowlist `maquette.json:13-15`, « contenu PROPOSÉ » at `:234-235`. Both
  mockup folders (`theme-medecin`, `theme-recrutement-ssii`) are **tracked at `2ac67fb4`**.
- DoD discrimination: sampled every spec's commands (extracted verbatim from the specs). All fail
  today for the reason each spec quotes (e.g. `applyPreset is not exported`, `pack: unknown key
  "theme"`, `validateTeamTemplate is not a function`, `FAIL: contributions = []`,
  `catalog/themes/cabinet-medical.json: missing`, `D7: window.__KB_THEME_APPLY__ is not published`,
  A5 D7's "eight failures", A2-pack-format D10 at the exact nine-id assertion).
- Previously-flagged anchors re-verified: `appliquerTout` is at `client.js:3954` inside `commit`
  `:3948-3957` at the baseline; `SETTINGS_KEYS` (`preset-store.mjs:43-52`) is exactly 37 keys.
- Six sections `e2e:` `vision:` `capture:` `maquette:` `unit:` `DoD:` present at line start in all
  seven specs (grep `^e2e:` etc.).
- Write perimeters are disjoint (A1-theme-seam = `kybernos-theme/**` + its tests; A1-kit-wizard =
  `client.js` KB-OB blocks + 2 scripts; A2-pack-format = `domain-pack.mjs`, `index.js` route zone +
  the granted `:30`, `onboarding-state.mjs`, `kybernos-plugin/plugin.json`, 2 tests; A2-registry =
  `kybernos-registry/**` + `kybernos-skills/**` + the schema pair; A3 = data files only; A4 = docs +
  2 scripts) and A5 is sequenced last with an enforced precondition gate (its grep of `applyPreset` /
  `THEME_POINT` / `"provides"` exits 1 today, as designed).

---

## docs/tests/A1-theme-seam-strategy.md

verdict: GO
blame: none
raison: All gate checks pass. Baseline `2ac67fb4` declared with measured drift; the previous pass's
three findings are fixed and re-verified at the baseline (the `appliquerTout` correction at
`client.js:3954`, the 37-key `SETTINGS_KEYS` count, the single `{ import }` host entry with a
fake-fetch discriminator D7). D2 applied (I7: light `{ id, name, settings }` minimum, full catalogue
entry accepted as a superset — A4's superseding head note explicitly reconciled); D3 applied
(campaign letters retired; the labels `I6`/`I7` survive deliberately because
`docs/tests/porte-go-verdicts.md:37` cites « A1 I7 » — verified — and they are not I1..I5); D7 applied
in full (A1-1..A1-4 "Settled defaults" + the Kit display note); D8 honest (E5 measures 8 RED with
per-file attribution and states « no command claims all exit 0 without a run behind it »). DoD D1-D9
discriminate (D1/D3/D5/D8/D9 run and fail today for the quoted reasons; D7's fake-fetch fails with
`window.__KB_THEME_APPLY__ is not published`). One residue recorded for the implementer, not
contract-affecting: the `maquette:` parenthetical says A3's mockups « are not committed — no media in
git », which is imprecise — the `docs/handoff/theme-*/maquette-v1/` folders are tracked at the
baseline (the PNG captures are what stay outside git). Anchor pass (123 anchors checked at
`2ac67fb4`): every anchor-table row resolves exactly (incl. the two previously-flagged ones:
`appliquerTout` at `client.js:3954`, `SETTINGS_KEYS` = 37, `session-guard` 29 files/28 in
`packages/`); the residues are non-table text, listed for the mandatory re-pin: (i) the head note's
blanket « every anchor is verified against that commit » needs the carve-out A3 already has — its
four `docs/tests/porte-go-verdicts.md` citations resolve at that file's own commit `0722aea2`
(content verified correct there), not at `2ac67fb4` where the report does not exist; (ii)
correction 12's aside « `:34-40` holds two measured facts » is `:30-33` at the baseline; (iii) « D2
cite them by number » holds for I7 (`porte-go-verdicts.md:37`) but I6 is cited nowhere in the
report; (iv) the head note's worktree pairs/counts are stale (the dirty tree grew again:
`client.js` is +229/−10 not +133/−7, the `__KB__.provide` idiom sits at worktree `:26257-26259`
not `:26242-26244`, and `kybernos-plugin/plugin.json` also moved 1/1); (v) E5's French-literal
line numbers are stale worktree references (the uncommitted diff moves; the count of 3 and the
cause are right, `index.js:11635` still matches). None is a baseline anchor; all are burn-down at
implementation opening.

## docs/tests/A1-kit-wizard-strategy.md

verdict: AMEND
blame: spec-error
raison: Two defect classes remain after cycle 2. (1) **Stale mockup premise, contract-affecting.**
`AMBIGUITY` (line 85) and the `maquette:` section claim the campaign mockups « do not exist on this
machine » and conclude « no external design reference for the Kit line » — falsified by the tree
(`docs/handoff/theme-medecin/maquette-v1/` and `docs/handoff/theme-recrutement-ssii/maquette-v1/` are
tracked at `2ac67fb4`, verified) and by the bound record (`porte-go-verdicts.md:84-86`: the mockups
« deviennent la référence de design du Kit et de l'accent recrutement »). The spec's own measurement
("no `maquette-v1` folder exists under this repo or `kybernos-projects`") is false; A3 and A4
withdrew the same claim in this cycle and A2-registry-points corrected the folder names in C8. Fix:
cite `docs/handoff/theme-*/maquette-v1/` as the Kit line's design reference and close the ambiguity
as resolved. (2) **Bound decisions not applied.** AMBIGUITY lines 77 (Kit display) and 79 (consent)
are ratified by D7 (« affichage Kit → une ligne non interactive sans nom de preset ; consentement →
le thème monte avec kitApply, "Pas maintenant" le saute ») — the spec's chosen readings match D7
exactly, so they must be closed as DECISION like A1-theme-seam's "Settled defaults"; line 81
(verticals) is answered by the owner's 2026-10-27 decision (`sante` + `recrutement`, per
`porte-go-verdicts.md:85-88`) as the spec itself records. Otherwise strong: no letter minted, six
sections at line start, DoD 1-6 discriminate with the exact quoted messages (measured), the frozen
block sha256s re-measured correct (`047a8cf7270fc3d3` / `d230845c9e7f71d2`), D8 honest (8 RED
itemised, « never all exit 0 »). Anchor pass (73 anchors at `2ac67fb4`): **all resolve exactly**,
including every `KB-OB` marker and function pin. Re-pin fix (one wording nit): the colour-literal
guard's « exactly those four, in that order » is wrong on order only — the set is `#ffffff`×3 +
`#121214` but the file order is W,W,B,W (`:36521` is `S.dark ? '#121214' : '#ffffff'`). The
worktree-drift note (`+16/+126/+12`) is stale like all such notes (the tree is now +219 past the
core marker); baseline pins in it are correct.

## docs/tests/A2-pack-format-strategy.md

verdict: GO
blame: none
raison: All gate checks pass. D4 applied in the write-perimeter table (`index.js:30` row marked
**GRANTED**, « it is neither a route nor a guard », with the reviewer check on `sameOriginStrict` /
`writeRefused`); D3 applied (`RETIRED` note, wires named by point id); the route-zone pins re-pinned
against `2ac67fb4` with the full old→new mapping (revision 2), and the false "lent anchors still
land" assurance removed and replaced by the measurement; the automations upper bounds relabelled
`proposal` per build contract 4. DoD D1-D10 all fail today for the quoted reasons (measured: D1 `pack:
unknown key "theme"`, D3/D4/D7/D9 assertion/type errors, D8 the 42/18 thresholds, D10 the exact
nine-id assertion). D8 honest (8 RED measured and attributed, « the number is measured each time,
never quoted », reconciled against the arbitration's 6). One stale decorative aside recorded for the
owner: `maquette:` still says the campaign mockups are « not on this machine » under the wrong
folder names (`vertical-*`) and cross-references A3's absence claim that A3 withdrew in this cycle —
the real folders `docs/handoff/theme-*/maquette-v1/` are tracked at the baseline. The aside does not
affect the batch (« They are not needed here »), so it is not a gate block; burn it down at the
implementation re-pin. Anchor pass (115 anchors at `2ac67fb4`): all 13 `index.js` `:107xx` re-pins
resolve exactly (19 occurrences), and the `:30` import line, `onboarding-state.mjs`, both test files
and the recorded DoD failure table all check out. Re-pin fixes: (i) the blanket « every anchor is
verified against that commit » needs the carve-out for the 8 `docs/tests/porte-go-verdicts.md`
references — that report is committed at `0722aea2`, after the baseline (its content at `:17`,
`:29-33`, `:40-43`, `:46-48` is verified correct there); (ii) `A1-kit-wizard-strategy.md:79` is
blank at the baseline — the mockups-absence AMBIGUITY it cites is at `:84` (baseline) / `:85`
(worktree), and it is the very stale claim this spec should stop citing; (iii) the teams table's « the
shipped teams use 3 » stages count is wrong — 3/3/**4** (`studencik`, `client.js:23355-23358`; the
3-5 roles count is right); (iv) the no-cron exemplar `client.js:7815` is a template that **has** a
cron — the exemplar is `social-video` at `:7851-7852` (the binding cite
`test-automation-templates.mjs:46` is exact); (v) self-ref `:220` is `:219`. The three AMBIGUITY
lines (theme id 40 vs 63, pre-sign-in GET disclosure, exact-set vs widened `test-domain-pack`
assertions) remain the owner's.

## docs/tests/A2-registry-points-strategy.md

verdict: GO
blame: none
raison: All gate checks pass. The falsified "all exit 0" draft claim is explicitly corrected with a
per-command measured table (exit codes and verbatim last lines), the 8 suite reds attributed one by
one in the D8 shape (« Nothing in this document claims the tree is green ») — the honest baseline
record of the campaign. D3 applied (labels renamed to `INT1..INT6`, « not re-minted here »). C8's
re-pins were checked against `2ac67fb4`, including the mockup folder names (corrected to
`docs/handoff/theme-medecin|theme-recrutement-ssii/maquette-v1/`, tracked at the baseline) and the
`webapp-creator-cadrage.md:162` seeding-rule citation. DoD 1-6 discriminate (measured, exact quoted
FAIL lines: `contributions = []`, `files defaults to "json"`, `does not define kybernos/skills#skill`,
`/provides/0/files is not a known key`). Lane declared **A** by adjacency with a falsifier and a
zero-diff proof requirement on `host.mjs:166-170`. Anchor pass (76 anchors at `2ac67fb4`):
**76/76 exact — zero failures, the only fully clean anchor pass of the seven**, including C8's
re-pins, the `webapp-creator-cadrage.md:162` seeding rule (and the three lines that do **not**
carry it), and the schema `$defs` ranges. Three AMBIGUITY lines remain the owner's (lane A
vs B, skill-folder seeding write side, the name of the `files` field).

## docs/tests/A3-vertical-content-strategy.md

verdict: GO
blame: none
raison: All gate checks pass. D5 fully applied: `#4F5BD5` cited from
`docs/handoff/theme-recrutement-ssii/maquette-v1/maquette.html:23` (allowlist `maquette.json:13-15`)
and kept marked **PROPOSAL** in every place it appears; the accent is read from source text, never
from a PNG; the medical mockup corroborates the five shipped goals at `maquette.html:235`. The
previous pass's double-patch trap is fixed (L6: A3 patches none of `test-domain-pack.mjs:257/:290/:322-327`;
the bug would be double-patching A2's widening). D3 applied (points named by id, no letters). DoD
1-5 discriminate (measured, exact quoted messages: `cabinet-medical.json: missing`, `missing from
catalog/themes … seq not bumped`, `no pack file: recrutement.json`). Note recorded: the baseline-honesty
line quotes the arbitration's **6 RED** with its provenance (`porte-go-verdicts.md:77-81`) while four
sibling specs measured **8** the same day and the gate measures **10** now — the count is a moving
neighbour target and D8's rule (« recorded truthfully, never all exit 0 ») is held; the merge gate
re-measures. Two AMBIGUITY lines remain the owner's (where the PROPOSAL label lives, minimal vs
additive kit content); the accent ambiguity is settled by D5. Anchor pass (141 anchors at
`2ac67fb4`): the whole 34-row source ledger resolves exactly. One re-pin fix: `A3:101`'s « the
gallery card (`kybernos-theme/client.js:2060-2067`) » lands on the `4d. THEME GALLERY` comment
banner — the card markup is at `:4642` (`kbth-card`); the paired data-shape cite `:2092-2107` is
correct. Also loose: `A3:96`'s `porte-go-verdicts.md:51-54` is mainly the accent verdict; the
"names these two folders" wording is at `:84-86`. The three porte-go citations are post-baseline
and A3 self-declares them (« added at `0722aea2` … measured on the worktree ») — the pattern the
other specs should copy.

## docs/tests/A4-starter-docs-strategy.md

verdict: AMEND
blame: spec-error
raison: The NO-GO root cause is fixed: the frozen contract is stated once and the head note and body
now agree (sentence 1: table keyed by the five point ids per D3; sentence 2: the light
`{ id, name, settings }` per D2, superset dropped silently by `sanitizePreset` — the exact D2
reasoning; sentence 3: the closed check-id vocabulary), and the mockups premise is corrected (2.3
fact 5). One D8 defect remains: **fact 8's red attribution is falsified by the reds' own failing
lines.** It files `test-consistency-guards`, `test-settings-nav` and `test-help` under « the
neighbour's uncommitted `kybernos-plugin` diff »; their failing checks name the untracked
`kybernos-log` bundle (« kybernos-log 1 (allowed 0) », « kybernos-log has no key in KB_NAV_KEYS » —
verbatim in `A2-registry-points-strategy.md:47,52` and `A5-style-rename-strategy.md:573,572`) and
`test-help` is the pre-existing 11-module docs gap (D8's « 3 unattributed », as A2-registry-points:54
records), not the diff. D8 requires the record to be truthful and the merge message to name the right
owner; fix = adopt the measured attribution table (the one A5 and A2-registry-points quote verbatim).
Otherwise the rebuild is sound: 46 anchor rows at the baseline, DoD D1-D19 discriminate (measured:
D1-D7/D11/D15/D18 all fail today as claimed; missing tools exit 1), `test-en-quotes.mjs` correctly
demoted from DoD (vacuous), interdictions checkable, D8 otherwise honest (8 RED, « A4 never calls
them green »). Anchor pass (89 anchors at `2ac67fb4`): 85 exact (incl. all 46 table rows and the
point table `:263-274` = 10 rows). Re-pin fixes: `scripts/plugin-scan.mjs:15` → `:13`
(`PACKAGES`), `:23-24` → `:21-22` (`sourceFiles`/`join`), `:24` → `:22` (all off by 2); `:266`'s
"not built" is a post-batch target wording, the row identification is exact. Four AMBIGUITY lines
remain the owner's (A2 starter `dsh` key, A3 narrowing `<folder|archive>`, A4 hygiene coverage,
A5 who exports the point objects).

## docs/tests/A5-style-rename-strategy.md

verdict: AMEND
blame: spec-error
raison: Substantively the strongest spec of the lot (previous pass's fixes applied: 37 keys, script
paths corrected — `scripts/check-bundle-faults.mjs`, `scripts/sandbox/{setup,start}.sh` all exist —,
the 8-red table itemised with verbatim failing lines, D5's word-anchored gate with the
`kybernos-themes` signed-kind exclusion, "eight failures" reproduced exactly by D7 today, the D5
count 78 re-measured exact). Two gate checks fail. (1) **D3: the retired letters remain.** The
document re-mints `I1`..`I7` as label names (`:131-190` and eight later references) despite the
campaign-wide retirement; the sibling corrections set the compliant pattern (`A2-registry-points`
renamed its local series to `INT1..INT6` « so it is not re-minted here », `A1-kit-wizard` mints
nothing) and `A4-starter-docs:20-21` asserts « no document of this campaign uses them any more »,
which A5 falsifies. Fix: relabel `I1..I7` (e.g. `R1..R7`) — one mechanical pass, the `A5-1..A5-4`
ids are fine. (2) **D6 not applied.** D6 binds « A5 = lane B (no migration; release-note cleanup) » —
that is exactly AMBIGUITY A5-1's default, yet the file keeps A5-1 open as « the single most important
arbitration in this file » and keeps A5-4's migration alternative live (« the owner should say so out
loud rather than by silence »), with an escalation clause to lane A that D6 forecloses; the file
never cites D6. Fix: convert A5-1 and A5-4 into `DECISION` lines citing `docs/tests/porte-go-verdicts.md`
E.7/D6 (as A2-pack-format did with D4), keeping the veto wording. The defaults themselves respect D6
(no migration; release-note one-shot cleanup; `theme-presets.json` keeps its name), so the fix is
bookkeeping, not design. A5-2 and A5-3 (recommended « oui » in E.8 but not bound) remain the owner's.
Anchor pass (108 anchors): 102 exact — the identity set, the four lists, the perimeter counts
(79 files/348 hits word-anchored, 81/351 raw, 17+20+30+12+2 — all re-measured correct) and D5's
"78 files" all hold. Re-pin fixes: `scripts/build-catalog.mjs:4` → `:3` (the `--check` doc line,
cited twice); `docs/tests/A1-theme-seam-strategy.md:29-53` → `:29-73` (the cited range misses the
`__KB_THEME_APPLY__` answer at `:55-58` and the point block at `:60-73`); its
`porte-go-verdicts.md:40-43` citation is post-baseline like A5 itself (content verified at
`0722aea2`); the worktree count « 350 occurrences » is now 353 and the red-table
`client.js:33803` reference is a stale worktree line (same class as A1-theme-seam's note).

---

## ambiguites

Remaining AMBIGUITY lines, verbatim (settled ones excluded — see the list after):

docs/tests/A2-pack-format-strategy.md:102-104
> AMBIGUITY: **the theme id vocabulary** — the pack regex `/^[a-z0-9][a-z0-9-]{0,40}$/` is *narrower* than the preset store's `ID_RE`
> (`/^[a-z0-9][a-z0-9-]{0,63}$/`, `preset-store.mjs:26`), so a preset whose id is 41-63 characters can never be named by a pack. Widen the pack key to 63, or
> accept that such a preset is unreferenceable. This batch implements 40 (the delegation's brief) and states the consequence.

docs/tests/A2-pack-format-strategy.md:105-106
> AMBIGUITY: **`theme` is served by the pre-sign-in GET** — `GET /kybernos/onboarding` is answered before DSH's own sign-in (`onboarding-state.mjs:51-52`).
> Choosing "public" (interpretation 7) means any local page can read which style preset the person picked. It is a real (small) disclosure decision, not a detail.

docs/tests/A2-pack-format-strategy.md:107-108
> AMBIGUITY: **who fixes `test-domain-pack.mjs:257` and `:290` when A3 adds a pack** — this batch widens both to relative-order/pair assertions (interpretation 11). If the campaign
> prefers the exact-set equality, then A3 needs a one-line exception on a file this batch owns, and the merge order matters.

docs/tests/A2-registry-points-strategy.md:121
> AMBIGUITY: 1 — the lane. A file of the perimeter (`host.mjs`) holds the auth guard, so the rule makes the batch A; the batch plans no diff there, which would make it B. Arbitrate: A with a proof of zero diff in `host.mjs:166-170`, or B on the owner's word?

docs/tests/A2-registry-points-strategy.md:123
> AMBIGUITY: 2 — the seeding of a plugin-shipped skill folder. A2 reads a skill folder as one contribution but writes nothing to `<DSH home>/skills` (INT5), so a vertical pack's skills reach the registry and not the agents. A3 (end-to-end packs) needs the write side. Arbitrate: (i) A2 stays read-only and the write belongs to the owner (`kybernos/skills`) in a later batch; (ii) A2 extends the five `seed-skills.mjs` copies together, in the same PR, with `scripts/test-seed-skills-drift.mjs` untouched — which puts four foreign packages in this batch; (iii) A2 ships the write in `kybernos-skills/index.js` and accepts a second implementation of the "never over a person-edited file" rule that the drift test cannot see. The writer recommends (i).

docs/tests/A2-registry-points-strategy.md:125
> AMBIGUITY: 3 — the name of the new point field. Pinned here as `files` with the enum `["json","folder"]` (INT1), and A4's page and the contract's `provides` row must use the same word. If the owner prefers `contribution` or `shape`, say so now: the DoD commands below are written against `files` and will fail otherwise.

docs/tests/A3-vertical-content-strategy.md:65
> AMBIGUITY: where "explicitly-labelled PROPOSAL" is recorded. Chosen: outside the JSON (sortie + this spec + A4's page), because the frozen pack shape has no free-text key and the validator refuses unknown keys (`domain-pack.mjs:71`). If the human wants the label *inside* the artefact, that is a change to A2's frozen interface (a `provenance`/`status` key), not a change this batch may make.

docs/tests/A3-vertical-content-strategy.md:67
> AMBIGUITY: whether "final kit content" for cabinet medical authorises *new* goals or bundled skills (interpretation 1 (b)). Chosen minimal (interpretation 1 (a)) because the medical mockup already draws exactly the five shipped goals (`docs/handoff/theme-medecin/maquette-v1/maquette.html:235`), so an added medical goal or sentence would be authored, not sourced, and `test-domain-pack.mjs:222-225` punishes an unused skill folder. Arbitrate if the sector owner has content that must land now.

docs/tests/A4-starter-docs-strategy.md:281-285
> AMBIGUITY A2 — **the starter's `package.json`.** Strict reading of the batch's interdiction = no `dsh` key (my
> choice, validated by `registry.mjs:54-72`), which diverges from the four-file draft shape of
> `plugin-creator/SKILL.md:47-67` and from the registry's own fixtures (`test-host.mjs:44-45`). Do we accept the
> divergence (the page explains why a data bundle needs no patch), or does the template copy the skill's shape
> verbatim?

docs/tests/A4-starter-docs-strategy.md:287-290
> AMBIGUITY A3 — **narrowing an owner-approved contract line.** `plugin-contract.md:486` says `<folder | archive>`; I
> plan to narrow it to `<folder>` and label archives "not built (phase B)". Is that edit allowed on a contract whose
> six decisions the owner accepted on 2026-10-21, or must A4 implement archive reading and hashes (which is phase-B
> work and would grow this batch past "docs + a read-only report")?

docs/tests/A4-starter-docs-strategy.md:292-297
> AMBIGUITY A4 — **folder-level hygiene coverage.** `scripts/garde-depot.mjs` keeps `MEDIA` (`:11`) and `SECRET`
> (`:12`) private and exports only `isScanned`/`personalPath`/`personalMails`/`warningsOf` (`:28-35`). My choice: no
> new export — that file is outside the batch — reuse `isScanned` in both directions (a file it will not inspect,
> media or over 4 MB, is a `FAIL hygiene` for a data bundle) and `warningsOf` (personal paths, mail addresses);
> secret-**file-name** detection is then not covered, and the page says so. Alternative: a one-line `export` in
> `scripts/garde-depot.mjs`, which is a file this batch is not given.

docs/tests/A4-starter-docs-strategy.md:299-304
> AMBIGUITY A5 — **who exports the point objects for a static run.** The tool needs `validate` functions without a
> host. My choice: A4 imports the point objects the owner bundles export (`DOMAIN_POINT` pattern,
> `domain-pack.mjs:230`), including A1's theme point, A2-registry's skills point and A2-pack-format's two templates; if
> one is exported only inside a mount function,
> the report says `SKIP point.<id>` and the page states which points are checked offline — A4 never copies a validator,
> and the export belongs to the owner's batch. Who owns that export?

docs/tests/A5-style-rename-strategy.md:252-257
> AMBIGUITY: A5-2 — do the route prefix and the Settings section id rename with the package (I3's
> default: yes), or does only the package move? Default: yes, for the three reasons in I3, with the
> one-reload cost on an already-open tab. The alternative keeps `/kybernos-theme/*` and the section id,
> which is strictly less risk and strictly more confusion — and it makes D5 impossible as written: the
> gate would have to be scoped to paths and ids instead of word-zero, which is a weaker proof. The
> owner may prefer the weak proof to the reload; if so, D5 changes and nothing else does.

docs/tests/A5-style-rename-strategy.md:259-263
> AMBIGUITY: A5-3 — the skins already say « styles » (`client.js:3478-3479`) and the library becomes
> « Mes styles » (I5). Default: do only what the naming decision names, and leave the skins' wording
> for a follow-up. The alternative — renaming the skins to « looks »/« ambiances » in this batch —
> reads better on the page but is vocabulary work that no rename requires, and it moves a surface the
> batch's `interdits` puts out of scope ("no scope beyond the rename"). Product choice, not technical.

### AMBIGUITY lines NOT remaining (settled by bound decisions or by facts — close them in the specs)

- `A1-kit-wizard-strategy.md:77` (Kit display) — settled by **D7** (one non-interactive note line, no preset name).
- `A1-kit-wizard-strategy.md:79` (consent model) — settled by **D7** (rides `kitApply`; « Not now » skips it).
- `A1-kit-wizard-strategy.md:81` (which two verticals) — settled: owner decision 2026-10-27, `sante` + `recrutement` (`porte-go-verdicts.md:85-88`).
- `A1-kit-wizard-strategy.md:85` (mockups absent) — settled by facts: the mockups are tracked at the baseline and become the Kit's design reference (`porte-go-verdicts.md:84-86`); the spec must be corrected (see its verdict).
- `A3-vertical-content-strategy.md:63` (recruitment accent) — settled by **D5** (`#4F5BD5`, cited, PROPOSAL).
- `A4-starter-docs-strategy.md:274` (the five frozen interfaces) — settled by **D3** (table keyed by the five point ids; letters retired).
- `A5-style-rename-strategy.md:239` (A5-1, installed profile) — settled by **D6** (lane B: no migration; release-note cleanup).
- `A5-style-rename-strategy.md:265` (A5-4, on-disk library name) — settled by **D6** (no migration; `theme-presets.json` keeps its name).
