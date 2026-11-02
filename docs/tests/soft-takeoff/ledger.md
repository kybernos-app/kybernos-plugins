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

## Defects

| Defect | Case | Sev | Symptom (what the person sees) | Cause | Fix (commit) | Attempts | State |
|---|---|---|---|---|---|---|---|
| T-001 | W1-02 | P2 | none for a person: the check went red on a healthy page | The check asked every example card for a type tile, but the text examples (since the 2026-11-02 shelf rework) have an icon and a tag instead; and its video checks ran without the `--pictures` folder that holds the clips, which are media and not in git | `scripts/check-newchat-live.mjs`: tiles counted without text cards, video checks skipped unless `--pictures` is given (uncommitted) | 1 | fixed (8 checks green) |
| T-002 | W1-02 | P2 | none: « on a phone the dialog fits the width and its main button can be reached » returns no dialog | Not the product: a probe in the same sandbox opens the Slides example dialog at 1400 px and at 390 px. The check depends on state left by the video block it now skips (the type is lit before the resize; the probe lights it after) | not found yet | 1 | open |

## Process findings

1. **A script case does not need a model.** A Haiku tester cost 71k to 99k tokens on a trivial case. The runner decides script cases; Haiku is kept for agent cases and a one-in-five cross-check.
2. **The named agent is not available in the session that creates it.** `takeoff-tester` loads at session start.
3. **A failing check is not a failing product.** W1-02 was red for stale assertions and a missing media folder. Triage has to separate test, environment and product before a ticket counts against the product.
4. **Green is not covered.** The suite is green with 27 kinds of skip, among them the rendered cloud client that the Cloud budget work will change. A skip is listed in every run summary and never counts as a pass.
5. **Media are not in git** (`AGENTS.md` rule 4), so every check that plays a clip or a picture needs its folder given explicitly, or it must skip.

State: `open` | `fixed` (case and ring green) | `flaky` | `wontfix` (owner decision, with the workaround) | `escalated` (3 attempts).
