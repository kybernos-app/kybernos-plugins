# Porte-spec v2 — Lot 1 "Kaby proactive" (re-gate after AMEND round 1)

Stage `porte-spec` of the kyber `dev-team`, 2026-10-28. Branch `feature/kaby-proactive-lot1`
(worktree `kybernos-plugins-proactive`). Validator: SPEC VALIDATOR, alone this round. Spec phase
only: this gate validates the repaired specification package before any implementation is
delegated. Previous gate: `porte-spec.md` (AMEND, 18 MAJOR + 15 MINOR); repairs decided in
`lead-decisions.md` (D1–D13).

Package re-read line by line: `cartographie.md`, `cadrage.md`, the six spec/strategy pairs
(`gate-static-checks`, `gate-trial-proof`, `host-gate-and-queue-routes`, `initiative-queue`,
`automations-gate-ui`, `pulse-proactive-notify`), `lead-decisions.md`, `porte-spec.md`. Every claim
below was re-measured on this tree (Node v26.7.0), not taken on faith: the write-words subset was
checked entry by entry against `index.js:765`; every cited anchor was re-resolved; the DoD red
baselines were re-run (`grep -c` 0 for the six dispatches, `HUMAN_ONLY`, `kbInitiatives`,
`tasks.gate.*`; the four new modules and four new test files absent); the D3 diff measurements were
reproduced (698 / 698 / 1); the 94-key i18n array was counted (94, no duplicate); the missing-file
error label was measured (`MODULE_NOT_FOUND`, CJS entry resolution).

## Verdict

**AMEND** — round 1's four invariant-1 holes (findings 1–4) are closed properly and measurably, the
word tables, the DoD discipline and the write sets are now sound, and 27 of the 33 findings are
fully fixed. What keeps the gate from GO is the same class as round 1's section B: **three live
cross-batch contract contradictions** — B5 still speaks a pre-D13 wire dialect on four actions
(R2), B6's gate feed reads a field that B3 never writes where B6 reads it (R1, a residual of
findings 10/11 under D1), and B2↔B3 disagree on the trial lifecycle and the activation predicate
(R3). Each is a precise edit to one or two documents; no batch needs to be merged, split or
re-scoped. Until they are fixed, the B5 and B6 waves would integrate against different wires.

---

## Checklist (the 14 points of the re-gate brief)

| # | Point | Result |
|---|-------|--------|
| 1 | D1: `task.gate` on `list`, produced by B3, consumed by B5+B6 | **HALF-FAIL (R1)** — produced by B3 (`host-gate-and-queue-routes.md` §3.2 `list` row, §5.3, §10.1 row 5) ✔; consumed by B5 from the list response ✔; consumed by B6 **from `tasks.json` on disk** (`pulse-proactive-notify.md` §3.1 feed 2, §3.1.1, `gatesOnTasks`) — a field B3 never writes there (B3 stores gates in `gates.json`, §5.2), and B6 §13 even instructs B3 to store the record in `tasks.json`, which B3 §5.2/§5.3 forbids |
| 2 | D2: `GATE_*_WORDS` strict subset, no `sent`/`sending`, stem-free | **PASS** — all 21 table words are members of `KB_MCP_WRITE_WORDS` (`index.js:765`, checked entry by entry); strict (e.g. `write`, `reply` are engine words deliberately not gate words); `sent`/`sending`/`paid`/`deleted` named as excluded (`gate-static-checks.md:147-150`); tokenizer whole-token only; J1 now two-sided (`sending` → no code, `send` → `prompt.send.word` with `{word}='send'`); the unit parity test reads the engine set from `index.js` and is "red on any table holding `sent` or `sending`" |
| 3 | D3: DoD diff base is merge-base, not `origin/dev` | **PASS with a measured deviation (R7)** — `origin/dev` is gone from the DoD; but the strategy measured that the D3 merge-base is equally unusable (`merge-base..HEAD` = 698 non-doc files, the branch is 501 commits past `9a014cf1`; re-measured here: 698 / 698) and diffs `HEAD~1` instead (re-measured: 1 file, `scripts/test-help.mjs` → red today, empty after the batch commit). The letter of D3 is superseded by its goal; ratify the deviation |
| 4 | D4: i18n DoD is a real executable command | **PASS** — `automations-gate-ui-strategy.md:120` is a full `node -e` script: 94 literal keys, exactly-once, both twins on one line, `process.exit(1)` on any miss and on a count ≠ 94; measured red today (`i18n KO: 94 of 94`). The live-half grep at :128 is still prose, but D4 scoped the check to the `client.js` literal grep (R9) |
| 5 | D5: B5 write set includes `scripts/check-gate-panel-live.mjs` + the maquette folder | **PASS in B5** — `automations-gate-ui.md` §11 lists exactly four entries, both additions marked "ratified by D5"; §2/§11 make the disjointness claim exact. Not ratified in `cadrage.md` (R4) |
| 6 | D9: `kbFireTask` gate tooth | **PASS** — first statement `kbGateRunRefusalTask(task)` → `{ refused }` before any session (§3.3 row 1, §10.1 row 13), the `kbMakeTrigger` tick records `skipped` (row 14), edge 31, J4.1 proves five fire paths with zero `create`/`prompt`, and DoD 1's `node -e` slices the real `kbFireTask` body requiring the tooth **above** the `sessionController` lookup. One anchor nit (R6) |
| 7 | D10: active flip gated in `update` and `cloud-link` | **PASS** — §3.3 rows for `:3261` and `:3295` (the sanitizer's `active: true` default at `:448` is named as the hole), edges 32–34, J4.2, `--prove-refusals` lines `update-reactivate` / `cloud-return` |
| 8 | D11: toggle human-only for activation | **PASS** — `HUMAN_ONLY = ['trial-start', 'approve', 'queue act', 'toggle']` with `kbHumanOnly` gating only `body.active === true` and only for a gated record (§3.1); edges 18/20/39; source assertion "the `HUMAN_ONLY` literal is declared exactly once and carries `'toggle'`"; DoD 1 greps the exact literal |
| 9 | D12: runtime write refusal via `ctx.tools.guard()` during trial | **PASS** — §7.8: `ctx.get('tools').guard(kbTrialWriteGuard(runId))` installed after `sessionId` and before `sc.prompt`, denying `KB_MCP_WRITE_WORDS` names of the trial's own session (`kbNameWords`, `:776`), disposed at trial end / delete; `write guard unavailable` refuses the start; B2 §3.4 step 4 recognises the refusal by `TRIAL_DENY_REASON`; edges 35–38, J4.3. One divergence on the guard-unavailable fallback (R3) |
| 10 | D13: contract unification | **HALF-FAIL (R2, R3)** — `deps.initiative` singular + `list(status)` ✔ (B3 §3.5, B4 pinned facts, B4 D3 asserts no alias); `queue act` body `{id, status ∈ asked/added/dropped}` ✔ between B3 and B4; `trialFromEvents`/`normalizeGateRecord` signatures ✔ (B3 §4 = B2 §3.2, `cap` added per D13). But **B5's §3.2/§6.3 tables were never moved to the pinned vocabulary** (four contradictions, R2) and B2↔B3 keep two activation predicates plus an unnamed `startTrial` (R3) |
| 11 | Six anchored markers per strategy | **PASS** — `^e2e:` `^vision:` `^capture:` `^maquette:` `^unit:` `^DoD:` all ≥ 1 per file in all six strategies (counted); no marker-like text mis-anchored |
| 12 | Every DoD discriminating | **PASS** — every DoD now states a today-red and an after-green, and the reds were reproduced here: missing-module reds (B1 `MODULE_NOT_FOUND`, B2's two distinct labels, B4's six measured messages), B3 DoD 1 greps = 0 and its `node -e` slice fails, B3 DoD 5 = 1 file today/empty after, B5's `gate-panel`/`tasks.gate.*` greps = 0 and the 94-key script red, B6's A–C quoted failures and D/E red because the names are absent. Green-today checks are explicitly labelled non-regression (B2, B3 note 4, B4, B6 "what does NOT count") |
| 13 | Write sets disjoint | **PASS** — B1 2 new files; B2 2 new files; B3 `index.js` + 1 test; B4 `automation-tools.mjs` + 2 new + docs; B5 `client.js` + 1 test + `scripts/check-gate-panel-live.mjs` + `docs/dev/kaby-proactive/maquettes/automations-gate/`; B6 the five `kybernos-pulse` files (its maquette lives in `/tmp`, untracked, by design). The four shared files are each claimed exactly once; no cross-write anywhere |
| 14 | English only | **PASS with one tracked deferral (R8)** — 13 of 14 documents are English; the French guillemets of round 1 are gone everywhere; `cartographie.md` is still French under D8's explicit decision ("translate in the same PR", before merge) |

---

## Findings of this round (severe first)

### A. Cross-batch contract contradictions (fix before the affected waves)

| # | Sev | Where | Finding | Fix |
|---|-----|-------|---------|-----|
| R1 | **P1** | `pulse-proactive-notify.md:97-101,127-142,325-326,571-582` + its strategy (J1–J3 seeds) vs `host-gate-and-queue-routes.md:272-285,320-327` | **B6's gate feed reads a field that does not exist where it reads it.** D1 says B6 reads `task.gate` "from the same list response, not from seams or file fallbacks", but the pulse watcher is not an HTTP consumer: B6 reads `task.gate` "on an entry of `tasks.json`" ("zero I/O: the pass already reads that file", `gatesOnTasks(tasks)`) and its §13 handover **commands B3 to keep the gate record in `tasks.json`**. B3 stores gates in `gates.json` and attaches `gate` only in the `list` **answer** (`kbGateAttach` at dispatch time, §5.3), stating "no consumer reads `gates.json` … In practice B6 does not read them at all". B6's own hedge ("if B3 keeps a separate gate store … the amendment here is one constant in `index.js`") contradicts B6's own "no second gate file" rule (DoD D reddens any `gateFile =`). As spec'd, B6's J1–J3 seed a `tasks.json` that B3 will never produce and every gate/queue card is dead in production. | Pick one reading of D1 and write it in both specs: (a) B3's `list` projection is canonical and B6 gets the records via a host-side read of `gates.json` beside `tasks.json` (the fallback B3 §5.2 already sanctions by name) — then B6 §3.1/§3.1.1/§13 and DoD D change from "gate lives on the task" to "gate read from `gates.json`, merged with the list projection"; or (b) B3 writes the projection into `tasks.json` — which B3 must then claim and schedule (a new edit row), at the cost of two stores of one truth. (a) is the smaller edit. Update the B6 strategy seeds accordingly. |
| R2 | **P1** | `automations-gate-ui.md:84-91,100-102,288-291` vs `host-gate-and-queue-routes.md:128-143` + `lead-decisions.md` D13 | **B5 still speaks a pre-D13 wire dialect on four actions** — every one is dead on arrival: (a) `approve` body `decision:'granted'\|'refused'` with no `rev` vs B3 `'grant'\|'refuse'` + `rev required` (`decision must be grant or refuse` / `rev required` refusals; B3's own J3 pins `decision:'grant'`); (b) `trial-report` body `{id, runId?}` and answer `{state, trial, gate}` vs B3 `{id}` → `{ok, gate, report}` (the poller's stop condition reads a top-level `state` B3 never sends); (c) `queue list` answer `{entries, cap}` vs `{items, cap}` (B4's tool and B3's table both say `items`); (d) `queue act` body `{id, op:'ask'\|'drop'}` and answer `{entry}` vs D13's pinned `{id, status ∈ asked/added/dropped}` → `{ok, item}` — B5 §3.2 literally says "takes `op` (not `status`)", contradicting D13 pinned fact 2/4, and B3 would answer `unknown status`. Also the pinned toggle refusal string `'gate: approval required'` vs B3's `approval required`. | Rewrite `automations-gate-ui.md` §3.2 and §6.3 to B3's §3.2 table verbatim (`decision:'grant'\|'refuse'` + `rev` from the record; `trial-report {id}` → `{gate, report}`; `items`/`item`; `status`), and update the unit fixtures (`kbGateError` examples) and the strategy's J3 accordingly. This is finding 5–9's class one wave downstream; D13 named B4 but B5 was never moved. |
| R3 | **P2** | `gate-trial-proof.md:131-165,178,201,442-463` vs `host-gate-and-queue-routes.md:241-251,379-381` | **B2↔B3 trial lifecycle and activation predicate disagree.** (a) B2 calls `mayActivate` "the single predicate B3 must consult" and "the only activation predicate" (its 27-export table, unit case 24, J3 asserts it is "B3 activation predicate"), while B3 defines its own `kbGateActivationRefusal(record)` ("`null` only for `approval.state:'granted'` + `staticChecks.verdict:'pass'`") and never names `mayActivate` — the two rules differ (B2 also requires a passing proof and an `approval.at`). (b) B3's required-export table omits `startTrial` and `toStoredGate`, so the `trial-start` state machine and the writer shape are unnamed on the consuming side; B3's `machine-busy` capacity refusal (B2's `startTrial` code) has no row in B3's answer table or edge table. (c) B2 §7 preconditions B3 never schedules: the `task.history` entry `{status:'trial', gateId, sessionId:null}` and `capacity` passing. (d) Guard-unavailable divergence: B2 §7 offers the `tools/pre-execute` deny as "the equivalent shape when the guard is not available", B3 §7.8 refuses `write guard unavailable` and starts nothing. | Either B3 imports `mayActivate`/`startTrial`/`toStoredGate` (add the three rows to B3 §4 and the `machine-busy` refusal) and drops `kbGateActivationRefusal` in favour of `mayActivate`, or B2's export table loses its "B3 — the only activation predicate" claim and B3's local predicate is named as the replacement (finding 19's second option, applied consistently). One line each for the history entry, `capacity`, and the guard-unavailable behaviour. |

### B. Contract-bookkeeping residuals (fix in the same pass as R1–R3)

| # | Sev | Where | Finding | Fix |
|---|-----|-------|---------|-----|
| R4 | P2 | `cadrage.md:207,225-227,287` | The frozen-contract doc was never aligned with the repairs: `makeInitiativeQueue` "with `add`/`list`/`resolve`" omits `cap` (finding 9's fix explicitly said "align `cadrage.md` if the member is added"; D13 adds it); B5's "Writes:" still says `client.js` ONLY + one test file, with no trace of the two D5 entries (finding 22: "Ratify in `cadrage.md` B5"); risk 1 still lists `accept` among "`active: true`" paths (finding 33 open — `acceptedTask` keeps it off, `automation-suggest.mjs:29-30`, re-measured). B3 §1/§9 defer that correction to "the batch that owns `cadrage.md`" — **no batch owns it** (it is in nobody's write set), so as written the line is corrected by nobody. | Three one-line edits in `cadrage.md` (exports + B5 writes + risk note), or an explicit owner named for the doc. Also align B4's Handoff `queue list` shape (`{"ok":true,"items":[…]}`) with B3's `{ok, items, cap}` envelope. |
| R5 | P2 | `pulse-proactive-notify.md:564,605-609` | Finding 23 is only half-closed: the README update is still outside the write set and its follow-up is addressed to "whoever owns it" — nobody does (B6's write set is the five files; `README.md` belongs to no batch). The doc update silently drops out, which was the original finding. | Name the owner (the closing integration delegation, or B6 with `README.md` added to its write set — cadrage already grants `kybernos-pulse/*`). |
| R6 | P2 | `host-gate-and-queue-routes.md:153,492` (`:598-604`) vs `index.js:613-617,620-635` | New in the D9 repair: row 14's anchor does not contain the code it edits. `results.push({id, ok: true, res})` / `fired += 1` sit at `:613-614`, not `:598-604` (re-measured), and the `skipped` result the row introduces would flow into the history-recording loop at `:620-635`, which maps `ok:false` to `{status:'error', error: undefined}` — turning every refused fire into an `error` history entry, against the row's own "a skipped run is not a failed run". | Re-anchor row 14 to `:613-617` and add the one-line consequence (the history loop must pass `skipped` through, or `results` entries must carry their history mapping); edge 31 should name where `skipped` is recorded. |

### C. Declared deferrals and micro-drifts (non-blocking, track them)

| # | Sev | Where | Finding | Fix |
|---|-----|-------|---------|-----|
| R7 | WARN | `host-gate-and-queue-routes-strategy.md:262-277` | D3's letter (`merge-base`) is superseded by its goal: the strategy measured that `merge-base..HEAD` also spans 698 files (branch 501 commits past `9a014cf1`; re-measured here) and diffs `HEAD~1` (1 file today → red, empty after the batch commit → green). Sound, measured, self-documenting — but it is a deviation from a Lead decision. | Lead ratifies `HEAD~1`-per-batch-commit (or the pre-batch tip tag for multi-commit batches) as the D3 base in `lead-decisions.md`. |
| R8 | WARN | `cartographie.md` | Still French (finding 18), per D8's explicit deferral ("translate in the same PR", before merge). All other documents are English and the guillemets are gone. | Translation in the merge PR, as decided; the merge gate should re-grep for French prose in this file before landing. |
| R9 | WARN | (several) | Micro-drifts left by the repair pass: (a) `automations-gate-ui.md:302` still annotates `data-status="<GateStatus>"` though `unknown` (a view value) can appear — the retag half of finding 20; (b) `automations-gate-ui-strategy.md:119` claims `ERR_MODULE_NOT_FOUND` for `node <missing test file>` — measured `MODULE_NOT_FOUND` (B1's own :346-348 documents this); (c) the i18n live-half at :128 still points at an unwritten "`node -e` over `/tmp/i18n-gate.json`" (D4 scoped the check away from it, but the sentence promises a command); (d) `gate-trial-proof.md:163` says B3's table "quotes the pre-D13 signatures" — stale since the repair moved B3's table to the D13 signatures; (e) finding numbers cited by the repaired docs are shifted by one against `porte-spec.md` from finding 16 onward (e.g. "finding 33" in B6 = finding 29 of the gate; D5's "finding 23" = finding 22) — a reader tracing a citation lands on the wrong row. | One editorial pass; for (e) cite `porte-spec.md` numbers or say "D-decision" instead. |

---

## Disposition of the 33 findings of `porte-spec.md`

Fixed (27): 1 (D9), 2 (D10), 3 (D11), 4 (D12), 5, 6, 7, 8 (D13, B3↔B4), 12, 13 (D2), 14 (D3, with
R7's deviation), 15 (D4), 16 (D6), 17 (D7), 21, 24, 25, 26, 27, 28, 29, 30, 31, 32 (bar R9b/c), plus
9 and 10 at the module/B5 level. Partially fixed (5): 9 (cadrage not aligned — R4), 10/11 (B6 side
re-opens under D1 — R1), 19 (R3), 20 (retag half — R9a), 22 (cadrage ratification — R4). Open by
decision (1): 18 (D8, R8). Still open (1): 33 (`cadrage.md:287`, R4). Not closed on the consuming
side (1): 23 (R5).

## Confirmed-clean notes (checked again, not assumed)

- **Anchors re-resolved exactly**: `index.js:28,448,449,765,778,806,825,828,2677,2978,3181,3261,
  3295,3327,3336,3351,3385,3457,3476,3592,3597,11388-11403,12058`; `automation-suggest.mjs:29-30`;
  `automation-tools.mjs:47,76,91,95,126`; `client.js` block markers `7132/7406/7408/7628`;
  `index.js:2730` (`tools/pre-execute`), `:2616` (`kbTasksFileOf`). The `:2677` anchor fixes round 1's
  off-by-one (finding 30).
- **`GATE_*_WORDS ⊂ KB_MCP_WRITE_WORDS` verified entry by entry**; `GATE_FINDINGS_MAX` 33 equals the
  catalogue count (17 blockers + 11 warns + 5 infos).
- **B4's D13 pin table is enforced by its own DoD** (D2 asserts `['add','cap','list','resolve']` and
  `RESOLVE_STATUSES`; D3 asserts no `initiatives`/`queue` alias).
- **The i18n array holds exactly 94 keys, no duplicate** (counted), matching B5 §7's own count line.
- **DoD reds reproduced**: six dispatches / `HUMAN_ONLY` / `kbInitiatives` / `tasks.gate.*` all grep 0
  today; the four new modules and four new test files absent; `git diff` counts 698 / 698 / 1;
  `scripts/run-all-tests.mjs` supports `--only` and `--list` (the DoD commands are runnable);
  no `maquette` kit in `scripts/` (B5/B6's premise measured true).
- **Write sets remain pairwise disjoint**, the four shared files claimed exactly once, and every DoD
  that could pass today is labelled non-regression.

## What this gate did not do

No implementation code was written; nothing was fixed (the gate reports, the batches fix). No image
was produced or read — the package still ships no capture, and the vision obligations remain with the
batch runs. The live e2e journeys, `audit-i18n-live` and the sandbox passes need a GUI and are out of
scope for a spec gate. The B6 feed question (R1) was not decided for the Lead: both readings are
written out, with the smaller edit recommended.

## Order of repair (suggested)

1. **R2** (B5's wire table) — one document, four tables, no ambiguity: B3's §3.2 wins.
2. **R1** (the D1 reading for B6) — one decision, then B6's §3.1/§5.3/§13 and its strategy seeds.
3. **R3** (B2↔B3 predicates and exports) — pick the import route or the B3-local route, one pass.
4. **R4–R6** (cadrage alignment, README owner, tick anchor) — one-line edits.
5. **R7–R9** (ratifications and editorial) — any time before the waves they name; R8 before merge.

After these the package is implementation-ready as decomposed: waves, ownership, write sets,
invariants and DoD discipline all hold.
