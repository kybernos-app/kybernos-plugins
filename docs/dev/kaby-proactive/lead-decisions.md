# Lead Decisions — AMEND Round 1

Date: 2026-10-28. Gate verdict: AMEND (18 MAJOR, 15 MINOR).

## D1 — Data exposure for B5/B6 (findings 10 + 11)

**Decision: `task.gate` projection on `list`.** B3 attaches `kbGateBoundedRecord(task)` per task to
the existing `{action:'list'}` answer. B5 reads `task.gate` from the list response. B6 reads
`task.gate` from the same list response (not from seams or file fallbacks). This settles findings 10
and 11 at once: no new seams published, no file fallbacks needed. B6's feed becomes:
`(1) run journal events (existing) + (2) task.gate from list + (3) initiative entries from queue act/list`.

## D2 — Vocabulary parity (findings 12 + 13)

**Decision: stem-free tokenizer, subset test only.** GATE_*_WORDS must be a strict subset of
KB_MCP_WRITE_WORDS. Drop 'sent' and 'sending' from GATE_SEND_WORDS; the tokenizer is stem-free.
J1's expected codes are computed from the exact GATE_*_WORDS tables (no inflection assumptions).

## D3 — DoD base (finding 14)

**Decision: diff against merge-base.** Use `git diff $(git merge-base HEAD origin/dev)..HEAD` not
`git diff origin/dev`. Fix the command in the strategy.

## D4 — i18n DoD (finding 15)

**Decision: real executable command.** The i18n check becomes a real `node -e` script that greps
the literal keys in client.js and exits 0 only when all 94 keys are present. Not prose.

## D5 — B5 write-set amendments (finding 23)

**Decision: ratify both.** `scripts/check-gate-panel-live.mjs` is added to B5's write set (live test
helpers live in scripts/ in this repo). The text-only maquette folder under
`docs/dev/kaby-proactive/maquettes/automations-gate/` is added to B5's write set.

## D6 — B6 visible surface verification (finding 17)

**Decision: verifier.mjs + --sabotage.** B6's visible surface gets the same verifier pattern as
B5's maquette, with a red construction (--sabotage) to prove the check is discriminating.

## D7 — B6 before/after capture (finding 18)

**Decision: parameterize DIR, capture from parent commit.** The before-side capture runs from
`$(git rev-parse HEAD~1)` not HEAD. DIR is a parameter of the capture script.

## D8 — cartographie.md language (finding 19)

**Decision: translate to English before merge.** Mark as tracked; translate in the same PR.

## D9 — Scheduler fire path (finding 1)

**Decision: gate tooth at the trigger fire.** B3 adds a gate check inside `kbFireTask` (the trigger's
fire callback): a gated task without `approval.state === 'granted'` does not fire. Plus an edit row
for the trigger path. Plus a bypass test.

## D10 — Active flip (finding 2)

**Decision: gate the active flip in update and cloud-link.** Same guard as toggle: a gated record
whose approval is not granted cannot be set active:true via update or cloud-link.

## D11 — Toggle human-only (finding 3)

**Decision: toggle is human-only for the activation transition.** A gated record with approval not
granted cannot be activated by code. The `HUMAN_ONLY` list gains `'toggle'` for the active:true
direction only (pausing is always allowed).

## D12 — Runtime write refusal (finding 4)

**Decision: B3 forces `tools.guard()` at trial time.** When a trial starts, B3 installs a
`ctx.tools.guard()` that denies write-category tool calls (KB_MCP_WRITE_WORDS match) for the trial
session. Removed when the trial ends. This is the runtime refusal invariant #3 requires.

## D13 — Contract unification (findings 5-9)

**Decision: B4's shapes win.** `deps.initiative` (singular) with `list(status)`. `queue act` body
`{action:'queue act', id, status}` with status ∈ {asked, added, dropped}. `makeInitiativeQueue`
returns `{list, add, resolve, cap}` where `cap` is the constant. `trialFromEvents` and
`normalizeGateRecord` follow B2's signatures exactly.
