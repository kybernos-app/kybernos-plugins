# Lead Decisions — AMEND Round 2

Date: 2026-10-28. Re-gate verdict: AMEND (R1-R9).

## R1 — Where B6 reads the gate record

**Decision: B6 reads gates.json beside tasks.json** (the smaller edit, as the re-gate recommends).
B3 stores gates in `gates.json` beside `tasks.json`. B6 reads that file as its fallback path.
B6 does NOT read task.gate from tasks.json on disk. B3 still projects `gate` onto the `list`
answer for B5's UI read path.

## R2 — B5 wire dialect

**Decision: B3's §3.2 table wins verbatim.** B5's consumer table is rewritten to match B3 exactly:
- approve body: `{action:'approve', id, decision:'grant'|'refuse', rev}` (rev required)
- trial-report body: `{action:'trial-report', id}` → `{gate, report}`
- queue list → `{ok, items, cap}`
- queue act body: `{action:'queue act', id, status}` → `{ok, item}`
- toggle refusal string: `'approval required'`

## R3 — B2/B3 activation predicate

**Decision: B3 adopts B2's exports.** `mayActivate` is the single activation predicate. B3 calls
`mayActivate(gateRecord)` instead of reimplementing the logic. `startTrial` and `toStoredGate` are
named in B3's required-export table. B2's `tools/pre-execute` fallback for guard-unavailable is
accepted as the degraded path (B3 refuses with 'write guard unavailable' only when both guard and
pre-execute are unavailable). B3 adds a machine-busy/capacity refusal row.

## R4 — cadrage.md alignment

**Decision: fix cadrage.md directly** (it is shared, not owned by a single batch):
- :207 add `cap` to makeInitiativeQueue return
- B5 write set: add D5 entries (scripts/check-gate-panel-live.mjs + maquette folder)
- :287 remove stale 'accept' note
- B4 handoff: queue list shape `{ok, items, cap}`

## R5 — B6 README ownership

**Decision: add README.md to B6's write set.** The 4-line update is part of the batch.

## R6 — B3 row 14 anchor + history mapping

**Decision: re-anchor to index.js:613-614** and specify that a skipped fire records
`status: 'skipped'` (not 'error') in the history.

## R7 — DoD 5 base deviation

**Decision: ratified.** HEAD~1 is the correct base for a single-commit batch. Documented.

## R8 — cartographie.md translation

**Decision: deferred to merge PR.** Will translate before merge. Re-grep before merge.

## R9 — Micro-drifts

**Decision: fix all five.** (a) retag hook type; (b) fix MODULE_NOT_FOUND label; (c) write the
i18n live command; (d) remove stale pre-D13 note; (e) fix finding-number citations.
