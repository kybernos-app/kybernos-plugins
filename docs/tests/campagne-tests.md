# Campaign test battery — the sector themes (tester's notebook)

- Tree: this checkout (`kybernos-plugins`), HEAD `9c3dfe3d`, **plus the working tree's
  uncommitted `packages/kybernos-plugin/client.js` (+369 lines, the neighbour session's A7 marketplace block)** —
  the live sandbox serves the working tree, so the live journey below runs HEAD + that diff.
- Run: 2026-10-28 06:09–06:41, tester role (`dev-team` kyber). **The tree is shared and moved during the
  battery**: at 06:34 the neighbour session (A7 marketplace) rewrote `packages/kybernos-plugin/client.js` and
  edited `scripts/test-signposts.mjs` + `scripts/test-settings-names.mjs` (a `themes` place, the
  `kybernos-themes-market` nav name). The suite was measured 06:15–06:20 and the live journey 06:10–06:22, on
  the tree as it stood then; both are stamped to that state, not to the 06:34 one.
- Method: every verdict proved BY COMMAND. Nothing called PASS from the code alone.
- Baseline: **no new red vs D8**, never "0 red". D8 = the 12-file red set measured at `3efbdfdb`
  (`docs/tests/gate-verdicts-marche.md`, "Merge-gate discipline"), which supersedes the 8 of
  `docs/tests/A4-starter-docs-strategy.md` fact 8 and the 6 of `docs/tests/porte-go-verdicts.md:77-81`.

## Verdict in one paragraph

The repo suite is **PASS**: 12 red, file for file the D8 list, **no new red**; the eight campaign suites are
green with their totals quoted below. The conformance tool is **PASS** (starter 0 FAIL, every broken variant
refused with the right check id). The live journey is **FAIL (30 checks)**: six of the failures are the
campaign's own data outrunning its own live assertions (Education themed by A8, ten packs after A3, the note
saying "Theme" where the check says "Style"); the rest are a pre-existing cascade that the same check reproduces
at `2ac67fb4` (64 fails), plus one real UI breach the campaign did not cause (the Kit screen scrolls). The
central new wire is **proved live**: the Kit's primary action calls the seam with the pack's own id and the look
really changes.


## 0. The baseline, file for file

`test-consistency-guards`, `test-help-mounts`, `test-help`, `test-layout`, `test-no-french-literals`,
`test-no-legacy-hosts`, `test-plugin-scan`, `test-readmes`, `test-signposts`, `test-menu-icons`,
`test-settings-nav`, `packages/kybernos-servers/test-host` — 12. A file red now that is not in this list is a
NEW red.

## 1. Totals

| # | Command | Result | Exit | Verdict |
|---|---|---|---|---|
| 1 | `node scripts/run-all-tests.mjs` | **530 files · 518 green · 12 RED · 177 s**; the 12 are file-for-file the D8 list | 1 | **PASS (no new red)** |
| 2 | `node packages/kybernos-theme/test-client.mjs` | `450 passed, 0 failed, 1 part SKIPPED (not covered)` | 0 | PASS |
| 3 | `node packages/kybernos-theme/test-preset-store.mjs` | `OK — preset store (74 checks)` | 0 | PASS |
| 4 | `node packages/kybernos-theme/test-themes-catalogue.mjs` | `OK — themes catalogue (72 checks)` | 0 | PASS |
| 5 | `node packages/kybernos-plugin/test-domain-pack.mjs` | `52 checks passed` | 0 | PASS |
| 6 | `node scripts/test-onboarding.mjs` | `all checks passed` (213 `ok` lines) | 0 | PASS |
| 7 | `node scripts/test-themes-catalogue.mjs` | `OK — themes catalogue publishing (30 checks)` | 0 | PASS |
| 8 | `node scripts/test-plugin-check.mjs` | `PLUGIN CHECK — 52 passed, 0 failed` | 0 | PASS |
| 9 | `node packages/kybernos-registry/test-registry.mjs` | `REGISTRY OK` (85 `✓`) | 0 | PASS |
| 10 | live wizard `check-onboarding-live.mjs` (sandbox 3098) | **30 checks FAILED**, 27 screens, 2 Kit screens scroll | 1 | **FAIL** (6 campaign-data drifts, 1 wording ruling, the rest pre-existing) |
| 11 | `node scripts/plugin-check.mjs docs/dev/templates/acme-vet-clinic` | 13 pass, 0 fail, 5 skip | 0 | PASS |
| 12 | `node scripts/plugin-check.mjs …/broken/06-theme-bad-accent` | `FAIL point.theme` — `themes/x.json: invalid value for acc` | 1 | PASS (fails right id) |

The 12 reds are the D8 ones and **the same causes** as recorded:

- the untracked neighbour bundle `kybernos-log`: `test-consistency-guards`, `test-help-mounts`, `test-layout`
  (2 checks), `test-readmes`, `test-signposts`, `test-settings-nav`, and the "every bundle is listed" row of
  `test-no-french-literals`;
- `test-help`: its own pre-existing docs gap (one red row over eleven modules where the message says ten);
- `test-plugin-scan`: `kybernos-pulse` declares no `exec` while `helper/gen-icon.mjs:9` spawns;
- `test-no-legacy-hosts` and `servers/test-host`: the `api.kybernos.app → server.kybernos.app` move (the feedback
  fallback and the E2B template were not moved; 2 checks and 8 failures respectively);
- `test-no-french-literals`: the two pre-existing literals `kybernos-plugin/client.js:33876` and
  `index.js:11628` (the campaign's own note is a `[fr,en,…]` row, allowed);
- `test-menu-icons`: the orphan `projects` icon entry. **Recomputed on the baseline commit's own `client.js`**
  (`git show 3efbdfdb:…`) and it yields the same orphan, so it is not a campaign harm.

No red was "flaky" on the runner's solo re-run (0 flaky). The suite lists 8 kinds of skip, none of them a pass:
the playwright GUI suites (playwright not installed here), the jsdom open-menu pass, the 29 python tests of
`kybernos-call` (livekit-agents absent), and three fake-service substitutions.

## 2. Scenarios

Format: SCENARIO · PATH · STEP · EXPECTED · ACTUAL · VERDICT · EVIDENCE.

### S1 — The theme seam writes the disk library (A1-theme-seam, `applyPreset`)
- **PATH** `packages/kybernos-theme/preset-store.mjs:200` → `applyPreset(store, input)`
- **STEP** one-shot script: `createPresetStore({dir: tmp})`, then `applyPreset({name:'Clinique', settings:{acc:'#1b7f76',mode:'light'}, source:'gallery', gid:'cabinet-medical'})`
- **EXPECTED** `{ok:true, id:'clinique'}` and one record written to `theme-presets.json`
- **ACTUAL** `apply1: true clinique gallery`; `file records: 1 ids: clinique`
- **VERDICT PASS**
- **EVIDENCE** command output above; second import returns the same id (`apply2 idempotent: true clinique same id: true`)

### S2 — The seam: one body means one intention
- **PATH** `preset-store.mjs:255` `handlePresetStore`
- **STEP** POST `{import, library}` together; then each alone
- **EXPECTED** 400 `invalid body` for both; 200 for one
- **ACTUAL** `both keys -> 400 invalid body`; `import only -> 200`; `library only -> 200`
- **VERDICT PASS**
- **EVIDENCE** same command block

### S3 — The seam: a document may not set accessibility
- **PATH** `applyPreset`, `A11Y_KEYS` guard
- **STEP** `applyPreset({name:'Secret', settings:{contrastMode:true}})`
- **EXPECTED** refused, error names the key
- **ACTUAL** `a11y refused: true accessibility setting: contrastMode`
- **VERDICT PASS**
- **EVIDENCE** same command block

### S4 — The published browser door `window.__KB_THEME_APPLY__`
- **PATH** `packages/kybernos-theme/client.js:2265-2281`; live GUI on the sandbox
- **STEP** the live check chains the real seam and presses the Kit's primary action; it then compares the CSS variables before/after
- **EXPECTED** door defined, one call, look changes
- **ACTUAL** `ok the primary action applies the field's preset through the seam, with the id the pack declares`; `ok the look really changed: the store applied the preset the pack names`
- **VERDICT PASS**
- **EVIDENCE** `/tmp/kb-live.txt`; `packages/kybernos-theme/test-client.mjs:1375` (its own section, 450 green)

### S5 — The Kit step announces and applies the field's style (A1-kit-wizard)
- **PATH** `packages/kybernos-plugin/client.js` (`kbObThemeOf`, `kbObThemeSeam`, `kbObThemeApplied`), Kit screen
- **STEP** live wizard: Health field, Kit step, press the primary action
- **EXPECTED** one plain line, no control, the pack's id sent, no error state
- **ACTUAL** the line is there and the id `cabinet-medical` is sent (`ok`), but three checks of the same batch **fail**: the no-style case (Education) and the `theme:null` expectation — Education has a style since A8.
- **VERDICT WARN** (feature works; its own live assertions are stale — see anomaly A1)
- **EVIDENCE** `/tmp/kb-live.txt`: `FAIL a field without a style shows no style line…`, `FAIL …the seam is never called | ["education"]`, `FAIL the complete answer carries the theme field … | {…"theme":"education"…}`

### S6 — A multi-point pack passes the conformance tool, its broken variants fail with the right id
- **PATH** `scripts/plugin-check.mjs`; `docs/dev/templates/acme-vet-clinic/`
- **STEP** run the tool on the starter, then on each `broken/` variant
- **EXPECTED** 0 FAIL on the starter; exactly one FAIL with the expected check id per variant
- **ACTUAL** starter `13 pass, 0 fail, 5 skip — exit 0`; variants: `01 manifest.json`, `02 manifest.schema`,
  `03 manifest.rules`, `04 manifest.points`, `05 point.domain-pack`, `06 point.theme`, `07 package.data`
- **VERDICT PASS**
- **EVIDENCE** command output; `scripts/test-plugin-check.mjs` 52 green

### S7 — The registry opens the points and validates each contribution
- **PATH** `packages/kybernos-registry/registry.mjs`, `packages/kybernos-plugin/domain-pack.mjs`
- **STEP** `node packages/kybernos-registry/test-registry.mjs`; `node packages/kybernos-plugin/test-domain-pack.mjs`
- **EXPECTED** green, per-point validators exercised end to end on a real profile
- **ACTUAL** `REGISTRY OK` (85 ✓); `52 checks passed`, including the end-to-end "a data plugin is offered once the person accepts it"
- **VERDICT PASS**
- **EVIDENCE** outputs above

### S8 — Six sector themes in the field catalogue (A3 + A8)
- **PATH** `packages/kybernos-plugin/domains/{sante,recrutement,immo,com,droit,edu}.json` → `packages/kybernos-theme/gallery.json`
- **STEP** cross-check every pack's `theme` against the gallery and its `accent` against the preset's `settings.acc`
- **EXPECTED** six links resolve, accents equal case-insensitively
- **ACTUAL** `sante #1B7F76 → cabinet-medical #1b7f76`, `recrutement #4F5BD5 → recrutement-ssii`,
  `immo #B4532A → immobilier-locatif`, `com #C25E0A → e-commerce`, `droit #7A2236 → cabinet-avocats`,
  `edu #6C4DF6 → education`; gallery holds 20 presets, 6 of them sector themes; `catalog/themes/_catalogue.json` `seq: 6`
- **VERDICT PASS**
- **EVIDENCE** command output; `test-themes-catalogue` (72) + root (30) green

### S9 — The author kit: page, template, checklist (A4-starter-docs)
- **PATH** `docs/dev/sector-bundles.md` (293 lines, "Build a theme"), template, `plugin-check`
- **STEP** read the page's presence and run the tool on the starter (S6)
- **EXPECTED** the documented five points, a scaffold that passes, seven refused variants
- **ACTUAL** page present; scaffold passes; 7/7 variants refuse with one id each
- **VERDICT PASS**
- **EVIDENCE** `docs/dev/sector-bundles.md:1`; S6 outputs

### S10 — Nothing is switched on by the kit
- **PATH** live wizard, automation rows; template's `automations/morning-reminders.json`
- **STEP** live run: observe the automation created by the kit; the template's automation is an instruction-class template (no `active` field, no runtime)
- **EXPECTED** created off, asking first
- **ACTUAL** `ok the automation was created switched OFF, on its schedule, asking before it acts, and its prompt names a skill that is installed`; the template declares no run state
- **VERDICT PASS**
- **EVIDENCE** `/tmp/kb-live.txt`; `docs/dev/templates/acme-vet-clinic/automations/morning-reminders.json` (no `active`)

### S11 — Only what is ticked is installed
- **PATH** live wizard Kit step
- **STEP** untick `docx`, press "Add 7 selected"
- **EXPECTED** the count follows the ticks, installed rows are marked and not re-ticked
- **ACTUAL** `ok what is installed is marked and not ticked again`; `ok a skill can be unticked` (`Add 7 selected`); `ok the primary button counts what is ticked`
- **VERDICT PASS**
- **EVIDENCE** `/tmp/kb-live.txt`

### S12 — The style rename (A5) is a spec, not a shipment
- **PATH** `docs/tests/A5-style-rename-strategy.md`; the page still says "Theme" (`client.js:5026`)
- **STEP** grep the page label and the menu
- **EXPECTED** no rename in this campaign
- **ACTUAL** label still "Thème/Theme"; the Kit note names "Settings › Theme" (M10 ruling)
- **VERDICT N/A (not shipped)** — no test can pass a rename that was not built
- **EVIDENCE** `packages/kybernos-theme/client.js:5026`; `packages/kybernos-plugin/client.js:35775`

## 3. The live journey, failure by failure (30)

Command: `source scripts/sandbox/env.sh && KB_SHOT_DIR=/tmp/kb-tests-campagne node scripts/check-onboarding-live.mjs`
— sandbox started (`bash scripts/sandbox/start.sh`, port 3098, `up after ~3s`), **exit 1, 30 FAILED**.

**A. The campaign's own data outran its own live assertions (6) — NEW relative to the check, not to the product**

| Check | Why |
|---|---|
| `a field without a style shows no style line on the Kit screen` | the check picks **Education** as the "no style" field; A8 gave Education a theme (`edu.json` `"theme":"education"`) |
| `…and the kit applies no style for it: the seam is never called \| ["education"]` | same cause: the seam is called with `education` |
| `the complete answer carries the theme field — null here, because Education names no style \| {…"theme":"education"…}` | same cause; the body is correct, the expectation is not |
| `a field with a style announces it… \| This field's look is applied with the kit. Settings › Theme keeps the last word.` | the assertion requires `/Style/`, the shipped note says **Theme** — the Lead's M10 ruling (naming a page that does not exist would be a dead signpost) |
| `the field of work is asked, with the nine fields the packs ship as tiles` | A3 added the 10th pack (`recrutement`); the host serves 10 |
| `the host serves the nine packs, none rejected \| {"ok":true,"ids":[10 ids],"rejected":0}` | same: 10 packs, none rejected |

**B. Pre-existing on this sandbox — proved by re-running the pre-campaign check**

`git show 2ac67fb4:scripts/check-onboarding-live.mjs` was run unchanged against the same sandbox
(`/tmp/kb-live-base.txt`): **64 checks FAILED**, and it breaks at the **same first failure**
(`the question can be left for later`), then the same pairing block, the same account block, the same pages
(`the workspaces page is titled… | "Workspaces"`), the same Creations order, the same composer (`a message is sent
from the home box`, both cards) — every one of them fails at HEAD too. The campaign's only
`packages/kybernos-plugin/client.js` hunks are the Kit ones (`git diff 2ac67fb4..HEAD -- …/client.js`), and the
wizard screens those checks exercise are byte-identical, so they are **not the campaign's**. Two honest caveats:
the second run is not a clean A/B (the sandbox kept the skills, teams and tasks the first run installed, and the
early divergence changes the flow: 16 screens against 27), and the 12 screens it never reached are unproven, not
green.

**C. The FIT report — the Kit screen really scrolls, and it is not the style line**

`FIT 27 screens at 1400x813: A starter kit for Education (over 987, wide 0, action 801/813) | A starter kit for
Finance (over 1054, wide 0, action 801/813)` — the dialog's content is ~1000 px taller than its box, no horizontal
overflow. Targeted probe on the same sandbox (`node /tmp/kb-fit-probe.mjs`, screen "A starter kit for
Development"): `{"over":1703,"sh":2516,"ch":813,"vh":813,"vw":1400,"wide":0,"action":801}`. **Development ships
no theme** (only the six sector packs carry one), so no style line is drawn — yet the screen overflows by 1703 px.
The overflow is the Kit list's own length, **not** the campaign's added line; it breaches the "every screen fits
one window" rule (commit `23641f2a`). The pre-campaign run measured no overflow on the Kit screen it reached and
the two runs' kit contents differ (installs already marked there): open, not settled.

## 4. Open anomalies

1. **The live checklist contradicts the shipped data (A1-kit-wizard vs A8).** The "no style" fixture is
   Education, which A8 themed. Three assertions cannot pass as written. The unit suite (`test-onboarding.mjs`)
   was fixed for the same drift (M11), the live check was not. **Owner decision**: repoint the fixture to a pack
   with no theme (`fin`, `mkt`, `dev`), or accept a themed Education and rewrite the three.
2. **"nine packs" twice, now ten.** A3's `recrutement` pack is shipped and served; the live checker still says
   nine. Same family as 1.
3. **"Style" vs "Theme".** The check's own text demands "Style"; the ruling (M10) and the product say "Theme".
   The check must follow the ruling until A5 renames the page.
4. **Twelve D8 reds are unchanged but still ticketed**: `test-help` names eleven modules where it says ten, and
   `test-menu-icons` has an orphan `projects` entry — both pre-existing, neither campaign's.
5. **A7 marketplace code is uncommitted in the working tree** (+369 lines in `packages/kybernos-plugin/client.js`,
   `KB_NAV_KEYS['kybernos-themes-market']`). The live run therefore proves HEAD + a neighbour diff, and that
   diff is inside the file the campaign also edits — the merge must not lose either side.
6. **The catalogue's `author` is "Kybernos" for all six themes** while A8's report labels every non-accent token
   a PROPOSAL (no métier owner ratified the palettes). The accent is cited from the pack (proved, S8); the label
   lives only in the report, never in the shipped entry.
7. **The live checker cannot pass on this sandbox even before the campaign** (64 fails at `2ac67fb4`). The first
   hard stop is the model question: no `Decide later` button is found, pressing `Continue` starts no
   `/kybernos-cloud/start` (`fake.calls` stays `[]`), so the pairing panel, the account block and everything that
   hangs off them fail in a cascade. The failing screens are outside the campaign's diff, but the real cause —
   a stale expectation or a real first-run regression from an earlier wizard commit — must be settled before the
   live journey can be called a gate at all. **Owner decision**: pick one and ticket it.
8. **The Kit screen scrolls** (987 px Education, 1054 px Finance, 1703 px Development measured by probe) — the
   list's own length, not the style line; it breaks the one-window rule and is not the campaign's to fix.

## 5. Captures produced (for the Lead's vision read — not analysed here)

Live run, `/tmp/kb-tests-campagne/` (18 PNG, 1400×813 unless named):

    about.png  agents.png  arabic.png  end-what-we-set-up.png  end-what-we-set-up-390.png
    field-hover-health.png  field-neutral.png  goals.png  installing.png  key-saved.png
    model-question.png  pages-connectors-law.png  pages-creations-law.png  pages-skills-law.png
    plan.png  replay-model-question.png  starter-kit.png  probe-kit-fit.png

Pre-campaign attribution run (same check at `2ac67fb4`), same 17 names under
`/tmp/kb-tests-campagne/base-2ac/`.

Raw outputs: `/tmp/kb-runall.txt` (suite), `/tmp/kb-live.txt` (live journey), `/tmp/kb-live-base.txt`
(pre-campaign live run), `/tmp/kb-fit-probe.mjs` (the fit probe).
