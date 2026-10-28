# Porte-spec final — Lot 1 "Kaby proactive" (gate after AMEND round 2)

Stage `porte-spec` of the kyber `dev-team`, 2026-10-28. Branch `feature/kaby-proactive-lot1`
(worktree `kybernos-plugins-proactive`). Validator: SPEC VALIDATOR, alone. This is the FINAL gate
before implementation GO. Previous gates: `porte-spec.md` (AMEND, 18 MAJOR + 15 MINOR),
`porte-spec-v2.md` (AMEND, R1–R9); repairs decided in `lead-decisions.md` (D1–D13) and
`lead-decisions-r2.md` (R1–R9).

Package re-read in order: both decision files, `cadrage.md`, all six specs, all six strategies.
Every claim below was re-measured on this tree: the row-14 anchor was resolved against
`index.js:613-614`, the `acceptedTask` claim against `automation-suggest.mjs:28-33`, the wire tables
compared word for word, the six markers counted per file, the write sets cross-read in all six
specs, and every `finding N` citation traced to `porte-spec.md`'s 33-row table (the only numbered
findings list in the package).

## Verdict

**AMEND** — the wire dialect (R2), the activation predicate (R3), the tick anchor (R6), the README
ownership (R5) and four of the five R9 micro-drifts are fixed properly and measurably, and B6's
gate feed now matches R1 exactly. What keeps the gate from GO is one live cross-batch
contradiction of the very class the last two gates failed on: **R1 was applied to B6 but never
propagated into B3**, whose spec still hands B6 the `task.gate` list projection and says B6 reads
no gate file — the opposite of what B6's spec now commits to. Plus the R9(e) citation pass, which
renumbered only the B6 pair and left seven citations landing on wrong rows. Both are bounded
one-document edits; no batch needs re-scoping, and everything else in the package is
implementation-ready.

---

## Checklist (the 12 points of the final-gate brief)

| # | Point | Result |
|---|-------|--------|
| 1 | R1: B6 reads `gates.json` beside `tasks.json`; B3 projects `gate` on `list` for B5 only; no B3↔B6 contradiction | **FAIL** — B6 side is exact (`pulse-proactive-notify.md:90, :251-252, :347, :453-454, :513-514`: the store beside `tasks.json` is the feed, `task.gate` is "B5's projection, never a feed (lead decision R1)"). B3 side still says the opposite in three places: `host-gate-and-queue-routes.md:329-330` ("In practice B6 does not read them at all: the feed is `task.gate` from the `list` answer (§5.3, D1)"), `:365` ("The `list` projection — the only gate feed **B5 and B6** get (D1)"), `:371-372` ("B6 merges the same field with the run journal"). B3 §5.2's fallback sentence (:327-328) is R1-aware; the sentence after it negates it. See finding 1 |
| 2 | R2: B5's wire table matches B3 §3.2 verbatim | **PASS** — `automations-gate-ui.md:88-96` matches `host-gate-and-queue-routes.md:129-137` on all five rows: `approve { id, decision: 'grant'\|'refuse', rev }` → `{ ok: true, gate }` with `rev` required (:101-106, refusal `rev required` named at :106); `trial-report { id }` → `{ ok: true, gate, report }` (:93, :113-117); `queue list` → `{ ok: true, items, cap }` (:95, :118-119); `queue act { id, status: 'asked'\|'added'\|'dropped' }` → `{ ok: true, item }` (:96, :120-123); toggle refusal string `'approval required'` (:108, :132-135). The unit contract asserts the body exactly `{ action: 'approve', id, decision, rev }` (`automations-gate-ui-strategy.md:92`). No pre-D13 dialect left (grep for `decision:'granted'`, `op:'ask'`, `{state, trial`, `gate: approval required` = 0 hits) |
| 3 | R3: `mayActivate` the single predicate, B3 calls it; `startTrial`/`toStoredGate` in B3's export table; `pre-execute` fallback accepted; capacity refusal row | **PASS** — `host-gate-and-queue-routes.md:269` names `startTrial`, `mayActivate(gate) -> boolean` and `toStoredGate(gate) -> object`; §4.1 (:280-296) adopts `mayActivate` ("B3 calls it and never re-derives it", one adapter, no ladder, fails closed on a missing export); B2 agrees (`gate-trial-proof.md:179` "B3 — the only activation predicate", `:427-429`). The `tools/pre-execute` fallback is the accepted degraded path in **both** specs (B3 §7.8 :446-456, refusal `write guard unavailable` only when neither seam exists; B2 §7 :459-463, "accepted degraded fallback (R3)"). Capacity refusal row present: `machine busy` in the `trial-start` refusal list (:133), edge 40 (:501), `capacity` handed to `startTrial` (:159-162, §10.1 row 12) |
| 4 | R4 in `cadrage.md`: `cap` in `makeInitiativeQueue` return, D5 entries in B5 write set, no stale `accept` note, `queue list {ok, items, cap}` | **PASS (as scoped to cadrage.md)** — `cadrage.md:207-212` returns `{ list, add, resolve, cap }` with `cap` the `INITIATIVE_MAX` constant and the list answer `{ ok: true, items, cap }`, "never `{ ok, items }` alone"; `:232-238` adds `scripts/check-gate-panel-live.mjs` and `docs/dev/kaby-proactive/maquettes/automations-gate/` to B5's write set ("ratified by D5"); `:305-309` replaces the stale note with a corrected one ("`accept` is not one of them: `acceptedTask` keeps the automation off", verified true at `automation-suggest.mjs:28-33`). Residual of the same decision outside cadrage: B4's Handoff still answers `queue list` without `cap` (finding 3) |
| 5 | R5: `README.md` in B6's write set | **PASS** — `pulse-proactive-notify.md:12-13` ("six files: the five code and test files plus the package's own `README.md`"), invariant row 4 (:486), §11 row (E) (:581 "the four-line update, part of the batch"), :648 ("README (owned by this batch, lead decision R5)"). Minor bookkeeping: `cadrage.md:269-270` still enumerates five files (finding 7) |
| 6 | R6: row 14 anchored to `:613-614`; skipped fire maps to `status: 'skipped'` | **PASS** — `host-gate-and-queue-routes.md:548` (§10.1 row 14) anchors `index.js:613-614`, "re-measured: the `await withTimeout(… fire(…))` line and the `results.push({ id: claim.id, ok: true, res })` below it" — resolved against the source: `index.js:613` is the `withTimeout(… fire(…))` line, `:614` the `results.push`. The history branch is `{ at, sessionId: null, status: 'skipped', error: res.refused }`, "never `status: 'error'` (R6)", repeated at §3.3 row 2 (:176) and edge 31 (:492); the source's `ok:false → status:'error'` mapping at `:628-631` is exactly what the row's own branch supersedes |
| 7 | R9: all five micro-drifts fixed | **FAIL (4 of 5)** — (a) hook type retagged: `automations-gate-ui.md:333, :345-346` (`data-status` is the widened nine-value type, `unknown` included) ✔; (b) `MODULE_NOT_FOUND` label: `automations-gate-ui-strategy.md:119` ("`code: 'MODULE_NOT_FOUND'` … not `ERR_MODULE_NOT_FOUND`") ✔; (c) i18n live command written: `automations-gate-ui-strategy.md:128` is a full chained executable (`audit-i18n-live.mjs` then a `node -e` with red today / green after and its three red branches exercised) ✔; (d) stale pre-D13 note: `gate-trial-proof.md:160-165` now reads "the two tables agree by construction … `mayActivate`, `startTrial` and `toStoredGate` are named in it (R3)" (no `pre-D13` string left) ✔; (e) **finding-number citations — only the B6 pair was renumbered** (with an explicit R9e note at `pulse-proactive-notify-strategy.md:10`); seven citations elsewhere still land on the wrong row of `porte-spec.md` ✘ (finding 2) |
| 8 | Six anchored markers at line start in every strategy | **PASS** — `^e2e:` `^vision:` `^capture:` `^maquette:` `^unit:` `^DoD:` counted per file: all six markers ≥ 1 in all six strategies (B5 15/8/9/11/21/13, B1 6/7/3/5/14/8, B2 1/1/1/1/1/1, B3 6/1/1/1/1/1, B4 1/1/1/1/1/1, B6 1/1/1/1/1/1) |
| 9 | Every DoD discriminating (fails today, passes after) | **PASS** — B3's DoD :240 states "fail on today's code and pass on the branch" with each `grep -c` measured `0` today and a `node -e` slice of the real `kbFireTask` body that cannot pass textually; B5's 13 DoD lines each carry "today exit 1 … after the batch exit 0" (:118-:130, including the 94-key script and the i18n live half); B6's DoD :525 "five discriminating commands — each one FAILS on today's code and PASSES after the batch". B1/B2/B4 strategies untouched since their reds were reproduced in `porte-spec-v2.md` |
| 10 | Write sets disjoint | **PASS** — `index.js` only B3 (`host-gate-and-queue-routes.md:11` "nothing else"; B2 :12-14, B4 :356, B5 :37 all declare it read-only); `client.js` only B5 (its §11 four entries, :37; B4 "client.js is read-only here"; B2's NOT-written list); `automation-tools.mjs` only B4 (`initiative-queue.md:9` "Sole owner … exactly four paths", G6 :356); `kybernos-pulse/*` only B6 (six files, all inside the bundle, :486; B2 :82 "none from `../kybernos-pulse/*`"; B3 §9 :512) |
| 11 | English only (no guillemets) | **PASS** — zero guillemets in `specs/` and `tests/`; prose English throughout. The French strings at `pulse-proactive-notify.md:362-368` are `kt('fr', 'en')` UI message twins for the French GUI (same class as B5's `kybernos:` i18n values), not doc prose. `cartographie.md` remains French under R8's tracked deferral ("translate before merge; re-grep before merge") |
| 12 | No NEW inconsistencies introduced by the repairs | **FAIL (two minor)** — (i) the R1 repair moved B3's storage section and left B6's line anchors `host-gate-and-queue-routes.md:276, :279` (six spots) pointing at §4 prose instead of the storage rows (`:321`, `:324`); (ii) the R4 repair corrected `cadrage.md` and left B3's two deferral sentences (:44-45, :518-520) claiming "cadrage.md:287 still counts `accept` in risk 1 … corrected by the batch that owns that file", now false on both counts (findings 4 and 6) |

---

## Remaining findings (severe first)

| # | Sev | Where | Finding | Fix |
|---|-----|-------|---------|-----|
| 1 | **P1** | `host-gate-and-queue-routes.md:327-330, :365, :371-372` vs `pulse-proactive-notify.md:347, :453-454, :513-514` | **R1 was applied to B6 but not propagated into B3 — a live cross-batch contradiction.** B6 commits to the R1 reading ("the store is the feed, the `list` projection belongs to B5 (R1)", "`task.gate` … is not this bundle's feed"), while B3 still says "In practice B6 does not read them at all: the feed is `task.gate` from the `list` answer (§5.3, D1)" (:330), calls the projection "the only gate feed B5 **and B6** get (D1)" (:365) and has "B6 merges the same field with the run journal" (:372). As written the two waves integrate against different feeds again, and B3's own §5.2 fallback sentence (:327-328) is contradicted by the line right after it | Three edits in B3 §5.2/§5.3: the projection is B5's UI read path (R1); B6 reads `gates.json` beside `tasks.json` (the fallback list B3 already sanctions); drop the "(D1)" authority for B6's feed and the "B6 merges the same field" clause |
| 2 | P2 | `automations-gate-ui.md:37, :244, :250, :258`; `automations-gate-ui-strategy.md:91, :107`; `gate-trial-proof.md:292` | **R9(e) incomplete — seven finding-number citations land on the wrong row of `porte-spec.md`** (the only numbered findings list): `:37` "findings 23" for the D5 ratification (= 22), `:244` "finding 28" for the tone drift (= 27), `:250` "finding 29" for badge concatenation (= 28), `:258` "finding 24" for the `unknown` guard (= 20), strategy `:91` "finding 30" for "`refused` unpinned" (= 21), strategy `:107` "finding 28" for the tone drift (= 27), and B2 `:292` "(D13, finding 22)" for the `sideEffectFree` formula (= 24, and no D-decision covers it: D13 is findings 5-9). The B6 pair was renumbered correctly (16/17/26/29 "of `porte-spec.md`"); these seven still use the shifted or wrong numbers the decision named | One editorial pass: cite `porte-spec.md` numbers or name the D-decision, exactly as the pulse pair now does |
| 3 | P2 | `initiative-queue.md:57, :301-302` vs `host-gate-and-queue-routes.md:136`, `cadrage.md:211-212` | **R4's B4-handoff bullet unapplied.** B4's Handoff still answers `queue list` with `{"ok":true,"items":[InitiativeEntry…]}` (no `cap`), and `:57` says the route reuses the `{ ok, items }` envelope — the exact string the re-gate quoted. B3's table, cadrage and B5's consumer table all pin `{ ok, true, items, cap }` | Add `cap` to the Handoff route shape and to the `:57` envelope sentence (the deps wiring at `:288` already forwards it) |
| 4 | P2 | `pulse-proactive-notify.md:102, :113, :131, :329, :607` | **Anchor drift created by the repair pass**: `host-gate-and-queue-routes.md:276, :279` are cited six times for the `gates.json` envelope and the beside-`tasks.json` path, but those lines are now B3's §4 signature prose; the storage rows are at B3 `:321` (envelope) and `:324` ("Both files sit beside `tasks.json`"). Same class for `initiative-queue.md:283`/`:291` (the sentence is at `:288-289`) | Re-anchor the citations to the current lines (the R6 discipline, applied cross-doc) |
| 5 | P2 | `gate-trial-proof.md:468` vs `host-gate-and-queue-routes.md` (no match) | **R3(c) half-residual**: B2 §7 still preconditions that "B3 records the trial in `task.history` as `{ at, status: 'trial', gateId, sessionId: null }`", but B3's spec contains no such entry (grep `gateId` / `status: 'trial'` = 0 in B3) — the capacity and guard-unavailable lines landed, this one did not. At integration the two specs disagree on one history write | One line in B3 §10.1 row 12 (write the entry at `trial-start`) or drop the precondition from B2 §7 |
| 6 | WARN | `host-gate-and-queue-routes.md:44-45, :518-520` | Stale after the R4 repair: both spots say "`cadrage.md:287` still counts `accept` in risk 1 … corrected by the batch that owns `cadrage.md` / that file, not by this one". The cadrage note is corrected (now `:305-309`) and R4 establishes no batch owns the doc; the `:287` anchor no longer resolves | Delete or rewrite the two sentences ("the cadrage note is corrected in place (R4)") |
| 7 | WARN | `cadrage.md:269-270` | B6's write list enumerates five files while B6's write set is six (`README.md`, R5). The `kybernos-pulse/*` glob covers it and R5 is satisfied at the batch level, but the shared contract doc's enumeration should match | Add `README.md` to the line |

## Confirmed-clean notes (re-measured here, not assumed)

- **Wire dialect unified end to end**: B3 §3.2 = B5 §3.2 = B4's pinned statuses (`asked`/`added`/`dropped`, `resolve(id, status)`, `RESOLVE_STATUSES`); `deps.initiative` singular with `list(status)` in both B3 §3.5 and B4's Handoff; the agent-tool answer is a separate surface and correctly carries `items` alone (`initiative-queue.md:207`).
- **One activation predicate**: `mayActivate` lives in B2 (`gate-trial-proof.md:146, :179`), B3 reaches it through `kbTrialFn('mayActivate')` only, and the DoD greps that adoption (`host-gate-and-queue-routes-strategy.md:247-249`). The run tooth (`kbGateRunRefusalTask`) and the switch-on tooth (`kbGateActivationRefusal`) are one question with one answer (B3 §3.3, §4.1).
- **R6 verified against the source**: `index.js:613-614` exactly matches the row's quoted code; the history loop at `:628-631` maps `ok:false` to `status:'error'` today, which is why the row's `skipped` branch is a real edit and not prose.
- **`acceptedTask` claim verified**: `automation-suggest.mjs:28-33` sets `active: false` — the corrected cadrage note is accurate and `accept` is correctly absent from every activation inventory.
- **B6's R1 stance is exemplary**: feeds bounded (`PROACTIVE_FILE_MAX`), envelope tolerated (`{ version, records }` or bare array), absent-is-normal, a `tasks.json` gate field "ignored whatever it says" (edge 5), and the README contract table corrected (`:590-591`).
- **R9(a)–(d) all landed** with executable evidence, and the i18n live half (:128) now exists as a real chained command with exercised red branches.

## What this gate did not do

No implementation code was written; nothing was fixed here (the gate reports, the batches fix). No
image was produced or read — the package still ships no capture. The live e2e journeys, the audit
and the sandbox passes need a GUI and stay with the batch runs. `cartographie.md`'s translation
stays deferred to the merge PR per R8.

## Order of repair (all bounded, none re-scopes a batch)

1. **Finding 1** — three sentences in B3 §5.2/§5.3 (the only P1; unblocks the B3/B6 waves).
2. **Finding 2** — seven citation numbers (one editorial pass).
3. **Findings 3–7** — `cap` in B4's Handoff, six re-anchored citations, the B2/B3 history line, two
   stale B3 sentences, one cadrage enumeration line.

After these the package is GO-quality as decomposed: waves, ownership, write sets, invariants,
wire contracts and DoD discipline all hold.
