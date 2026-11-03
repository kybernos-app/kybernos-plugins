# Soft takeoff ledger

Text only: no screenshots, no logs, no personal paths (`AGENTS.md` rule 4). Evidence stays in the private output folder of the run. Written by the lead session, never by a tester.

## Light wave 1 (2026-11-03): the process, on the tip of `dev`

13 cases (`--light`), run by `scripts/soft-takeoff-run.mjs` on a sandbox that serves this checkout, plus three Haiku cross-checks. The two in-flight features (Cloud budget and billing, slide creation and editing) have no code in `dev` yet, so their cases ran as a **baseline**: a red on them after their branches land is theirs.

| Case | Result |
|---|---|
| W0-01, 02, 03 | pass (repository guard, lifecycle engine, package gate) |
| W0-08, 09 | canaries behave: the good one passes, the bad one fails |
| W1-16, W1-17 | pass (Slides unit tests; Slides panel in the real GUI, 25 s) |
| W3-01, 02, 11, 12 | pass (computer image, approvals, Cloud plugin unit tests, task link) |
| W1-02 | **red, test side only**: 9 failed checks, 8 fixed (T-001), 1 open (T-002) |
| W0-04 | pass: 628 files, 628 green, 0 red, in 135 s (see the baseline below) |

**Cross-check.** Three Haiku testers (canary good, canary bad, repository guard) returned the same verdicts as the runner: 3 of 3. One disagreement of form: the tester set `repo_clean: false` because the tree already held uncommitted files, so the brief now defines it as « identical before and after ».

**Baseline of the unit suite** (first W0-04 run, 2026-11-03, tip of `dev`): **0 red** of 628 files, 135 s. It is not a proof of 628 green tests: 27 kinds of skip are counted, and the ones that matter for the work in flight are the rendered part of the cloud client (footer chip, team switcher: react and react-dom not found), the Suite and Workers page GUI suites (playwright), the open-menu pass (jsdom) and the 29 Python tests of the call agent (livekit). They need a `node_modules` with react, react-dom, jsdom and playwright-core (`KB_NODE_MODULES`) before W1 and W3 mean what they say.

## Wave W1 (2026-11-03): what a person sees, on the frozen build

Script cases by the runner on two sandboxes (A desktop account, C never paired); Haiku walkthroughs through `scripts/takeoff-walk.mjs`. **The first full pass was read on the wrong build**: five bundles the plan marks on were still disabled by the owner's patch (T-014). The freeze was corrected and the script cases were replayed on it (below); the five Haiku walkthroughs were not replayed.

**Gate (all P0 pass, no open P0/P1): not reached, for two reasons that are not product defects.** The P0 case W1-03 is blocked (no model that can create), and the P0 case W1-08 and the P1 case W1-13 were green only on the retry. No script case is red and no P0/P1 defect is open. Three more cases wait on an owner decision or a resource (W1-11, W1-14, W1-22). One defect is open for the owner (T-011).

| Case | Result (corrected freeze) |
|---|---|
| W1-01 first-run wizard, desktop and the phone app's variant | pass on C (265 s; the phone script alone: 45 ✓) |
| W1-02 new-chat page | pass |
| W1-04 dead clicks | pass (626 s) |
| W1-05 Settings menu, search, titles, help | pass (after T-005, T-009) |
| W1-06 first-visit animations | pass (61 ✓, after T-005) |
| W1-07 Theme page, W1-12 contrast, icons, hit targets | pass |
| W1-08 languages | flaky: red once, green on the retry (18 min, the red log was not kept: the runner now keeps it); the audit of the French literals is green |
| W1-09 phone width | pass (33 ✓; it was 2 ✓ and 16 skips before T-015) |
| W1-10 account menu (A), W1-18 footer signed out (C) | pass, pass |
| W1-13 Skills Featured | flaky: red once, green on the retry (red log not kept) |
| W1-15 freeze live, W1-16, W1-17 (Slides) | pass (the freeze check now also sees an « on » bundle disabled in the patch: 22 ✓) |
| W1-03 creations pages | blocked: needs a creation, and the replica model cannot make one |
| W1-11 Plugins page | blocked: `kybernos-registry` is frozen (owner question 6) |
| W1-14 connectors gate | not applicable here: needs a server line with the public catalogue route (owner question 7) |
| W1-20 newcomer (Haiku) | pass, on the earlier build |
| W1-21, W1-23 (Haiku) | informative, on the earlier build: small controls on a phone (T-013) |
| W1-22 creator (Haiku) | blocked: the stand-in model answers one fixed sentence (process finding 11); one text drift (T-012) |
| W1-24 French speaker (Haiku) | partial, on the earlier build; the question it raised is reproduced by script (T-011) |

## Defects

| Defect | Case | Sev | Symptom (what the person sees) | Cause | Fix (commit) | Attempts | State |
|---|---|---|---|---|---|---|---|
| T-001 | W1-02 | P2 | none for a person: the check went red on a healthy page | The check asked every example card for a type tile, but the text examples (since the 2026-11-02 shelf rework) have an icon and a tag instead; and its video checks ran without the `--pictures` folder that holds the clips, which are media and not in git | `scripts/check-newchat-live.mjs`: tiles counted without text cards, video checks skipped unless `--pictures` is given (uncommitted) | 1 | fixed (8 checks green) |
| T-002 | W1-02 | P2 | none: « on a phone the dialog fits the width and its main button can be reached » returns no dialog | Not the product: a probe in the same sandbox opens the Slides example dialog at 1400 px and at 390 px. The check depends on state left by the video block it now skips (the type is lit before the resize; the probe lights it after) | none needed | 1 | closed: passes in the W1 run, not seen again (order-dependent) |
| T-003 | W1-01 | P2 | none: the check went red on a healthy first run | Four stale assertions: Kaby is optional in the menu now, the Dashboards and Workspaces rows come from other bundles, the type tiles are counted without the Dashboards and Apps tiles | `scripts/check-onboarding-live.mjs` (uncommitted) | 1 | fixed (W1-01 green) |
| T-004 | W1-05 | P2 | none: the Settings navigation check went red on a healthy menu | The Interface and System group rows changed (bundles on or off); the check expected a fixed list | `scripts/check-settings-nav-live.mjs`: those rows tolerant (uncommitted) | 1 | fixed |
| T-005 | W1-06 | P2 | none | The first-visit help check looked for a button whose text is « ? How it works »; since 2026-11-02 it is a bare « ? » labelled « How it works », and two pages (Calls, Atlas) are not in the frozen menu; the Models and Tools assertions described pages before the redesign | `check-help-intro-live.mjs` finds the button by its label, `--frozen` skips pages absent from the menu, the Models and Tools lines follow the pages | this commit | 1 | fixed, test side (61 ✓, 0 ✗ on the frozen build) |
| T-006 | W1-02 | P2 | On a phone, with bundles off, a type tile label could be cut mid-word and its « Not enabled » tag could run out of the tile | The tile grid kept three columns under 480 px with a tag wider than the tile | `packages/kybernos-plugin/client.js`: a container rule under 480 px; new assertion in `check-newchat-live.mjs`, red without the rule and green with it (uncommitted) | 1 | fixed |
| T-007 | W1-12 | P2 | Two controls had a hit area under 24 px: the Tools on/off switch and the « × » that deletes a theme | No minimum size on `.kbt2-sw` and `.kbth-st-x` | `min-height: 24px` on the switch (`kybernos-plugin`), `min-width` and `min-height: 24px` on the theme delete button (`kybernos-theme`) (uncommitted) | 2 | fixed (W1-12 green) |
| T-008 | W1-20 | tool | A Haiku tester saw « Continue » do nothing | Not the product: the shared click helper picked a hidden duplicate of the button and clicked at once. Verified on the page: the button is not covered, the screen does not redraw | `scripts/takeoff-walk.mjs` clicks the visible element on top | 1 | closed |
| T-009 | W1-05 | P2 | Searching the Settings for « families » or « live » on the Activity log, or « install a sector template » on Templates, opened the right page but the label promised was not on it | The index rows were written for an earlier wording of those pages | The three rows now promise what the pages show: « Family », « Live », « From a catalogue » (English and French) | this commit | 1 | fixed (the live search check is green, 15 ✓) |
| T-010 | W1-09 | P2 | none | `check-onboarding-phone-live.mjs` failed at « the wizard opens » and 35 checks went red | My first reading (« the check expects the flow of before the redesign ») was wrong: the case ran it on A, which is signed in, so the wizard never opens. On C it passes whole (45 ✓, 0 ✗, six screens fit 390 × 844) | the phone wizard script moves from W1-09 to W1-01, persona C; persona C is added to the plan | this commit | 1 | closed: wrong persona, not a stale check |
| T-011 | W1-24 | P2 | After choosing Français in the first-run wizard and leaving it with « Passer », the new-chat page is in English, and still is after a reload | Reproduced by script on C (`takeoff-walk`, evidence `repro-t011`). Not specific to « Passer »: the wizard keeps its language to itself and only writes it into `onboarding.json` (`lang: "fr"`); nothing applies it to the app's language (DSH's locale) | not done: a product call, see README § 9 question 12 | 0 | open, owner decision |
| T-012 | W1-22 | P3 | The Agent Teams empty state says « Create one with “New Agent Team” » and the page has a « Create » menu | A text that names a button that is not there (Haiku, one run) | not done | 0 | to confirm |
| T-013 | W1-21, W1-23, W1-24 | P2 | Controls of the first-run wizard are small: EN 61×27, Skip 32×29, Back 59×29 on desktop; on a phone 29 to 31 px high, and the option links 27 px | No minimum size; the hit-target check floor is 24 px | not done: owner question 9 | 0 | open |
| T-014 | all W1 | P1 | none for a person, but every W1 verdict before this line was read on the wrong build: the Summary tab, the Calls page, the create-workspace dialog, the free models and Mermaid were missing from the « frozen » sandbox | `plugins.json` marks five bundles on (`kybernos-summary`, `kybernos-call`, `kybernos-multi-device`, `kybernos-free-llms`, `dsh-mermaid`) that the sandbox profile's `cordis.patch.yml` carries as `disabled: true`: a sandbox is cloned from the owner's profile, where he switched them off on 10-27. The freeze only took the « off » bundles out, and `check-freeze-live` only looks at the off side and at `/state` | `soft-takeoff-freeze.mjs` also takes the `disabled: true` line off a bundle the plan marks on (pure `enableOn`, backup of the patch, `--undo`); applied to A and C | this commit | 1 | fixed; the W1 cases were replayed (see the table) |
| T-015 | W1-09 | P1 | none | `check-phone-width-live.mjs` passed with 2 checks and 16 « did not open »: on a phone, `openSettings` pressed the account chip, which sits in the closed drawer, off screen, and nothing opened; only the first page was ever measured | `live-page.mjs` `openSettings` presses the sidebar's own trigger when the chip opened nothing | this commit | 1 | fixed (33 ✓, 0 ✗) |
| T-016 | W1-08 | P1 | none | The language check expected the Bricks, 3D modeller and Motion panels, the Atlas page and the Computers menu, which are off in the freeze (28 ✗ in the first run; it had not run since the account session expired) | `check-language-creation-live.mjs --frozen` skips a surface whose plugin is off and lists it | this commit | 1 | fixed, test side |
| T-017 | W1-10 | P2 | none | One case asked for two opposite sandboxes: the account menu needs a connected account (A), the signed-out footer needs a never-paired one (C); it came back « blocked » on A and on C | split: W1-10 (A, account menu) and W1-18 (C, footer) | this commit | 1 | fixed, plan side |

## Process findings

1. **A script case does not need a model.** A Haiku tester cost 71k to 99k tokens on a trivial case. The runner decides script cases; Haiku is kept for agent cases and a one-in-five cross-check.
2. **The named agent is not available in the session that creates it.** `takeoff-tester` loads at session start.
3. **A failing check is not a failing product.** W1-02 was red for stale assertions and a missing media folder. Triage has to separate test, environment and product before a ticket counts against the product.
4. **Green is not covered.** The suite is green with 27 kinds of skip, among them the rendered cloud client that the Cloud budget work will change. A skip is listed in every run summary and never counts as a pass.
5. **Media are not in git** (`AGENTS.md` rule 4), so every check that plays a clip or a picture needs its folder given explicitly, or it must skip.
6. **A tester tool is a part of the test.** The first « fail » of W1-20 was the shared click helper (a hidden duplicate button, a click before the page was ready). The walk driver now clicks the visible element on top; a case that fails for a tool reason is closed as `tool`, not counted against the product.
7. **The leftovers sweeper stops sandboxes in the middle of a run** (no client for ten minutes, or older than three hours; a headless viewer does not always count as a client). The runner has `--before`, and a watcher loop restarts a stopped sandbox. The lasting fix is a `sandbox.keep` marker in the sweeper, which is the owner's tool.
8. **`source scripts/sandbox/env.sh` changes `HOME`.** A recipe with `~` after it points into the sandbox. Absolute paths only.
9. **The replica session of an account lasts about two hours, and « connected » stays true after it.** `e2e-connect.mjs --force` (disconnect, pair again) fixes it; the sandbox is restarted afterwards.
10. **A killed live check can leave the sandbox changed.** W1-14 left a stand-in server registry with the model service switched off: every chat then failed with « not signed in » and four creation walkthroughs came back blocked. The cause was found by reading the server profile the plugin uses, not by the symptom. Look at `kybernos/servers.json` and the live-gate files after any timeout.
11. **The stand-in model of the replica answers one fixed sentence.** It proves the model path works, not that anything can be created with it: the creation cases need another model.
12. **Do not edit the repository while a tester runs.** It voids `repo_clean`: two Haiku verdicts were lost to it.
13. **W1-01 and W1-24 need an unpaired sandbox** with `onboarding.json` set to `completed:false`; and the sandbox is a clone of the owner's profile, not a fresh install.
14. **Haiku is good at measuring and at walking, weak at reading what a screen means.** Its « fail » verdicts were findings, not defects: each needs a script or a second look before it counts (T-011, T-012).
15. **A plan that says « on » must be checked as « on ».** The first freeze only removed what the plan marked off; five bundles marked on stayed disabled by the owner's own patch, and nothing noticed for a whole wave (T-014). The freeze now enables them.
16. **« Did not open » and « not run » are not a pass.** The phone-width check printed 2 ✓ and 16 ○ and exited 0 (T-015). A run summary has to show the skips next to the passes, and a case with more skips than checks is read as blocked.
17. **A case that needs two opposite sandboxes is two cases** (T-017): a connected account (A) and a never-paired one (C) cannot share one command.
18. **A chained command hides what comes after its first failure.** W1-05 and W1-08 chain several scripts with `&&`: the later ones had never run before the earlier ones went green (the help check and the i18n audit).

State: `open` | `fixed` (case and ring green) | `closed` (not a product defect, or not seen again) | `to triage` | `to confirm` | `flaky` | `wontfix` (owner decision, with the workaround) | `escalated` (3 attempts).
