# B2 — `gate-trial-proof`: supervised trial machine and proof report

Stage: `spec` of the kyber `dev-team`, lot 1 "Kaby proactive", 2026-10-28.
Branch `feature/kaby-proactive-lot1`, worktree `kybernos-plugins-proactive`.
Upstream: `docs/dev/kaby-proactive/cadrage.md` (B2 contract, frozen shapes) and
`docs/dev/kaby-proactive/cartographie.md` (anchors). No implementation is written at this stage.

Write set (the only files this batch may touch):

- `packages/kybernos-plugin/automation-trial.mjs` — NEW
- `packages/kybernos-plugin/test-automation-trial.mjs` — NEW

Explicitly NOT written by this batch: `packages/kybernos-plugin/index.js` (B3),
`client.js` (B5), `automation-tools.mjs` (B4), `automation-gate.mjs` (B1),
`packages/kybernos-pulse/*` (B6). Hard invariant #4 holds by construction.

---

## 1. Goal

Give the certification gate its middle rung: **a supervised, side-effect-free trial of one
automation draft, and the proof report that a human reads before deciding.**

Concretely, one new I/O-free ES module (three pure siblings imported, nothing else) answers four
questions:

1. *May this draft be tried at all, and did a person ask for it?* — a trial state machine
   `requested → running → done | failed` that has **no edge to `approved` or `activated`**.
2. *What did the run actually do?* — a `ProofReport` built from the engine's own journal events
   (tool calls with their read/write class, refusals, errors, external effects, the engine's
   `turn/end` verdict).
3. *Did it pass?* — a strict verdict: a proof passes only when the run completed, nothing reached
   the outside, and **every call that could change something outside the session was refused at
   runtime** (the two clauses of `cadrage.md:93`, read literally — §3.4).
4. *Is the gate record still honest?* — normalization that caps any stored `GateRecord` at the
   highest status its evidence allows, so a corrupted or forged record cannot claim `approved`
   or `activated` without a recorded human approval **and** a passing proof.

Non-goals are in §8. The module never starts a session, never writes a file, never opens a
socket, and never decides that an automation may run.

## 2. Why a pure module

The three existing pieces of evidence-reading code in this repo are all pure and all live beside
each other: `automation-runs.mjs` (what a run did), `session-outcome.mjs` (how a turn ended),
`pulse-core.mjs` `readRun` (how a session stands). They are pure because the host owns the seam
(`sessionPersistence`) and the page only asks. This batch follows that shape exactly:

- **testable without DSH**: every rule is a function of arguments, so the DoD can fail on the
  current code and pass afterwards without a running GUI;
- **single writer**: B3 wires HTTP and the store; if the rules lived there, `index.js` (12.9k
  lines, hot file) would grow a second, untested verdict engine;
- **no import cycle and no boot risk**: nothing runs at import time, no timers, no `fs`, no
  `fetch`.

The trial state carrier (`TrialRun`) is deliberately **not** persisted and **not** part of the
frozen `GateRecord`: an in-flight trial is host memory, and only its finished `ProofReport`
reaches the record (the frozen shape has `trial: ProofReport | null` and no `trialId`). This is
what keeps `GateRecord` unchanged.

## 3. API surface (exact)

All functions are synchronous, total (never throw on hostile input) and return fresh objects.
The module **never reads the clock**: no `Date.now()`, no `new Date()`. The caller passes `at` (an
ISO 8601 string) — a rule the DoD checks with a grep, not a promise. That freeze is also why no
field this module emits may hold a non-ISO string: `updatedAt` is either a valid stored ISO 8601
value or a valid `opts.at`, never `''`, and a record with neither is unusable (§3.5). A missing or
non-ISO `at` never invents a time: `startTrial` and `askApproval` refuse with `'no-timestamp'`,
`applyTrial` keeps the record's own `updatedAt`, and `normalizeGateRecord` returns `null` when
neither the stored value nor `opts.at` is a valid ISO 8601 string. Tests therefore always pass an
explicit `at`, and two runs of the same input give byte-identical output.

Imports allowed, all pure modules of the same package:

| from | what | why |
|---|---|---|
| `./automation-runs.mjs` | `summarizeRun`, `scrub` | the clock, the verdict and the text scrubber of a run |
| `./automation-load.mjs` | `allowedAt` | a trial is a real session and takes a machine slot |
| `./automation-gate.mjs` (B1) | `GATE_STATUSES`, `GATE_APPROVAL_STATES`, `GATE_RECORD_KEYS`, `GATE_FINDINGS_MAX` | one vocabulary: B1 froze those four lists "so B2 normalizes against them" (`gate-static-checks.md:117-120,123`); B1 exports **no** function this module calls |

Nothing else — in particular **no import from `./index.js`** (executed for its side effects, hot
file owned by B3) and **none from `../kybernos-pulse/*`** (another bundle's write set; `readRun` is
read for vocabulary parity only, §7). B1 is a wave-1 batch and lands before this one (cadrage,
delegation order), so the import never points at a missing file.

### 3.1 Constants

```js
export const TRIAL_STATES = Object.freeze(['requested', 'running', 'done', 'failed'])
/** The two values B3 must install on a trial session (frozen here so there is one source). */
export const TRIAL_APPROVALS = 'ask'
export const TRIAL_MASK = 'deny-writes'
/** The reason a masked write call gets, model-facing, English, stable: the proof recognises a refusal by it. */
export const TRIAL_DENY_REASON = 'This is a supervised trial: this call may change something outside this session, so it was refused.'
export const PROOF_TOOL_CALLS_MAX = 20
export const PROOF_ERRORS_MAX = 5
export const PROOF_EFFECTS_MAX = 10
export const PROOF_TEXT_MAX = 420        // = RUN_TEXT_MAX, so a proof and a run summary clip alike
export const GATE_ID_MAX = 120
// Re-exported for the readers of this module; the values come from ./automation-gate.mjs (B1):
//   GATE_STATUSES, GATE_APPROVAL_STATES, GATE_RECORD_KEYS, GATE_FINDINGS_MAX
```

The gate vocabulary is **imported**, not copied: B1 already froze it (`GATE_STATUSES` 8 statuses,
`GATE_APPROVAL_STATES` 4 states, `GATE_RECORD_KEYS` the 8 record keys, `GATE_FINDINGS_MAX` = its
33 codes) precisely so this batch normalizes against one list. Re-exporting them keeps the
surfaces of `automation-trial.mjs` self-sufficient for B3 and B5 without a second definition. Two
unit tests guard the seam: the imported lists equal the cadrage unions, and a change to B1's list
fails here instead of drifting silently.

### 3.2 Signatures

```js
/** 'read' when the call provably cannot change anything outside the session; 'write' otherwise. */
accessOf(name, args) -> 'read' | 'write'

/** Begin a supervised trial. Returns the in-flight state, or a refusal code. */
startTrial({ gate, by, at, sessionId, capacity }) ->
  { ok: true, trial: TrialRun } | { ok: false, code: TrialRefusalCode, error: string }

/** Move the in-flight state on a host signal (no events needed). */
advanceTrial(trial, signal) -> { trial: TrialRun, changed: boolean, code?: string }

/** Build the proof from the run's journal events; advances the trial in the same pass. */
trialFromEvents({ trial, events, at }) -> { trial: TrialRun, proof: ProofReport | null }

/** A proof passes only if the run completed, nothing reached the outside, every write call was
 *  refused at runtime (the literal cadrage.md:93 formula, §3.4 step 7), AND the proof carries the
 *  fingerprint of its own content (§3.4). A proof that only reads clean is a claim, not a pass. */
trialPassed(proof) -> boolean

/** The gate status a finished trial unlocks (never 'approved'/'activated'). The trial is accepted
 *  for symmetry with the caller's own state; only the proof decides. */
gateStatusAfterTrial(trial, proof) -> 'awaiting-approval' | 'trial-done'

/** Attach a proof to a gate record (pure; rev+1 only when something changed). */
applyTrial(gate, { trial, proof, at }) -> GateRecord

/** The human is asked: status 'awaiting-approval', approval.state 'asked'. Only on a passing proof. */
askApproval(gate, { at }) -> { ok: true, gate } | { ok: false, code, error }

/** The human refused: status 'refused', approval.state 'refused'. */
refuseApproval(gate, { at }) -> GateRecord

/** The single activation predicate of the lot. B3 consults it before switching a gated automation
 *  on **and** before letting it run, so one rule covers the switch and the fire (R3). */
mayActivate(gate) -> boolean

/** Stored bytes → a safe ProofReport (null when unusable). */
normalizeProof(raw) -> ProofReport | null

/** Stored bytes → a GateRecord capped at what its evidence allows (null when no usable automationId).
 *  `opts.at` is the caller's own instant: the fallback stamp of a record with none, and the horizon
 *  a dated grant is judged against (§3.5). */
normalizeGateRecord(raw, opts) -> GateRecord | null      // opts: { at }

/** A GateRecord → the plain JSON object B3 writes (exactly the frozen keys, bounded). */
toStoredGate(gate) -> object
```

`TrialRefusalCode` = `'not-supervised' | 'gate-not-ready' | 'already-open' | 'machine-busy' | 'no-timestamp'`.

#### 3.2.1 Complete export list (27 names)

This table is the whole public surface of the module. B3's contract table (`host-gate-and-queue-routes.md` §4) names the
exports it calls, and the two tables agree by construction: every signature quoted there is the one above, and
`mayActivate`, `startTrial` and `toStoredGate` are named in it (R3). No name outside this table is exported, and
`import * as m` yields exactly these 27 keys — a unit test asserts the set equality, so a name added, renamed or dropped
fails there instead of drifting into B3's table.

| # | export | kind | signature or value | consumer |
|---|---|---|---|---|
| 1 | `accessOf` | function | `(name, args) -> 'read' \| 'write'` | `trialFromEvents` (the proof's classifier); B3's trial guard classifies with the host's own write words instead (§7) |
| 2 | `startTrial` | function | `({ gate, by, at, sessionId, capacity }) -> { ok: true, trial } \| { ok: false, code, error }` | B3 (`trial-start`) |
| 3 | `advanceTrial` | function | `(trial, signal) -> { trial, changed, code? }` | B3 (host signals) |
| 4 | `trialFromEvents` | function | `({ trial, events, at }) -> { trial, proof }` | B3 (`trial-report`) |
| 5 | `trialPassed` | function | `(proof) -> boolean` | B3, B5 (read-only) |
| 6 | `gateStatusAfterTrial` | function | `(trial, proof) -> 'awaiting-approval' \| 'trial-done'` | B3 |
| 7 | `applyTrial` | function | `(gate, { trial, proof, at }) -> GateRecord` | B3 |
| 8 | `askApproval` | function | `(gate, { at }) -> { ok: true, gate } \| { ok: false, code, error }` | B3 |
| 9 | `refuseApproval` | function | `(gate, { at }) -> GateRecord` | B3 |
| 10 | `mayActivate` | function | `(gate) -> boolean` | B3 — the only activation predicate |
| 11 | `normalizeProof` | function | `(raw) -> ProofReport \| null` | B3 (what comes off disk) |
| 12 | `normalizeGateRecord` | function | `(raw, { at }) -> GateRecord \| null` | B3 |
| 13 | `toStoredGate` | function | `(gate) -> object` | B3 (the only writer shape) |
| 14 | `TRIAL_STATES` | const | frozen `['requested','running','done','failed']` | B3, B5, tests |
| 15 | `TRIAL_TRANSITIONS` | const | the frozen edge table of §3.3 | B3, tests |
| 16 | `TRIAL_APPROVALS` | const | `'ask'` | B3 (must install it on the trial session) |
| 17 | `TRIAL_MASK` | const | `'deny-writes'` | B3 |
| 18 | `TRIAL_DENY_REASON` | const | the model-facing refusal string of §3.1 | B3 (guard reason), refusal detection |
| 19 | `PROOF_TOOL_CALLS_MAX` | const | `20` | B5 (how many calls it may draw) |
| 20 | `PROOF_ERRORS_MAX` | const | `5` | B5 |
| 21 | `PROOF_EFFECTS_MAX` | const | `10` | B5 |
| 22 | `PROOF_TEXT_MAX` | const | `420` | B5 |
| 23 | `GATE_ID_MAX` | const | `120` | B3, B5 |
| 24 | `GATE_STATUSES` | re-export (B1) | the 8 statuses | B3, B5 |
| 25 | `GATE_APPROVAL_STATES` | re-export (B1) | the 4 approval states | B3, B5 |
| 26 | `GATE_RECORD_KEYS` | re-export (B1) | the 8 keys, in order | B3 (writer), B5 |
| 27 | `GATE_FINDINGS_MAX` | re-export (B1) | `33` | B3, B5 |

There is no default export, no class, no type-level export, and nothing outside this table.

There is deliberately **no** `grantApproval`, `approveGate` or `activateGate`: the module can ask
and it can record a refusal, and that is all (invariant #1). B3 owns the `granted` transition and
the `active: true` flip, and **consults `mayActivate` rather than re-deriving the rule** (R3): this
module is the single source of the activation predicate, B3's own activation refusal is a one-line
adapter over it, and every path that would run a gated automation asks the same question. Likewise
`startTrial` begins the trial and `toStoredGate` is the only writer shape — B3 adopts the three
exports, it does not mirror them (§7).

### 3.3 The state machine

```js
export const TRIAL_TRANSITIONS = Object.freeze({
  requested: ['running', 'failed'],   // failed = the session never started
  running:   ['done', 'failed'],      // done = the turn closed, whatever its verdict
  done:      [],
  failed:    [],                      // a retry is a NEW trial (startTrial), not an edge
})
```

`advanceTrial` signals: `{ type: 'run-started', at, sessionId }`, `{ type: 'run-ended', at }`,
`{ type: 'run-failed', at }` (a signal that is already applied, or an edge that does not exist,
returns `changed: false` and `code: 'illegal-transition'`).

Rules:

- **No state means "allowed to run".** `done` is not a pass; the pass lives in the proof
  (`trialPassed`). A trial whose mask held but whose turn failed is `failed`; a trial whose turn
  completed but in which one write call was **not** refused at runtime is `done` **and** fails the
  proof. Two distinct notions, never conflated.
- `startTrial` refuses (`ok: false`) when
  - `by !== 'person'` → `'not-supervised'` (a model tool call, a cron, a webhook: all refused);
  - `gate.status` is not `'static-passed'` or `'trial-done'` → `'gate-not-ready'`;
  - `gate.trial !== null && gate.trial.outcome.state === 'open'` → `'already-open'`;
  - `capacity` is given and `allowedAt(capacity.level, capacity.maxParallel) === 0` →
    `'machine-busy'` (a trial is a real session and takes a machine slot; `automation-load.mjs`
    owns that rule, this module only asks).
- On success the returned `TrialRun` carries the two constants B3 must apply, not as options a
  caller could overwrite: `approvals: 'ask'`, `mask: 'deny-writes'`, `supervised: true`.
- `trialFromEvents` never moves a trial backwards and never past `done`/`failed`: it computes the
  next state through the same `TRIAL_TRANSITIONS` table, so the two entry points cannot diverge.
  A journal that shows a started turn proves the run started, so the builder applies the
  `run-started` edge first (`requested → running`, `startedAt` from the turn) and only then the
  end edge. Without that, a trial driven by events alone would sit in `requested` with a finished
  proof — validated as a real case while writing this spec.

### 3.4 The proof builder (`trialFromEvents`)

`summarizeRun` gives the clock, the counts and the engine's verdict; a second, bounded pass over
the same events gives what the proof needs and the summary drops: the **full** tool name
(`summarizeRun` truncates it to 40 chars at `automation-runs.mjs:141`, which would cut
`mcp__composio__…` slugs), the **arguments** (needed to judge a Composio `EXECUTE`) and the
approval decision per call. Algorithm:

1. `summary = summarizeRun(events)`; if it is `null` (no `turn/start`) → `{ trial, proof: null }`.
2. Window = the **first turn**: index of the first `turn/start` to the first `turn/end` at or
   after it (same convention as `summarizeRun`, comments at `automation-runs.mjs:10-11`). Later
   turns are the person's; they are ignored, exactly as the run summary ignores them.
3. For every `tool/call` in the window (all of them, even past the output bound): `name` at most
   60 chars, `args` parsed like `automation-runs.mjs:36` (`argsOf` semantics, re-implemented in
   four lines — not exported there), `access = accessOf(name, args)`.
4. For each call, resolve `outcome`:
   - `'refused-as-write'`, for a **write-classified** call only, when there is approval evidence on
     it and the decision was not `'allowed-once'` (engine values: `'rejected' | 'cancelled' |
     'unavailable'`), **or** when its tool result is an error whose scrubbed text contains
     `TRIAL_DENY_REASON` — the runtime refusal D12 installs (B3's `ctx.tools.guard()`) answers the
     call with that reason, so a mask hit is recognised by it;
   - `'ok'` otherwise when the result is not an error;
   - `'error'` when the result is an error without refusal evidence (a refused read call is an
     `'error'`, not a refused write: `access` stays `'read'`).
5. `externalEffects`: **one entry per write-classified call that was not refused at runtime**,
   deduplicated, first `PROOF_EFFECTS_MAX`, each a scrubbed string no longer than 120 chars:
   `write-succeeded:<name>` (`ok`), `write-unverified:<name>` (error, no refusal evidence —
   conservative: the call may have run partially). A refusal is **not** an external effect: it is
   recorded per call as `toolCalls[].outcome: 'refused-as-write'`, so an empty `externalEffects`
   means exactly "nothing reached the outside", as `cadrage.md:94` requires.
6. `errors`: the error tool results and a failed `turn/end` reason, at most `PROOF_ERRORS_MAX`,
   `{ at: <the event's ISO time, or '' when the event carries none>, where: <tool name, 60 chars>,
   message: scrub(text, PROOF_TEXT_MAX) }`. This `at` is a journal time, not the frozen
   `GateRecord.updatedAt`, so the ISO 8601 freeze of §3.5 does not apply to it.
7. `sideEffectFree` = `externalEffects.length === 0` **and** every write-classified call in the
   window has `outcome === 'refused-as-write'` — the two clauses of `cadrage.md:93`, computed over
   **every** call in the window, not only the bounded list. With no write call at all both clauses
   hold vacuously, so a read-only run is side-effect-free.
8. `outcome` = `summary.outcome` (already `{ state, code?, message? }`), message scrubbed.
9. `supervised: true` (constant), `runId = trial.sessionId || 'trial:' + gateId + ':' + <digits of
   requestedAt>` (≤ `GATE_ID_MAX`), `gateId = trial.gateId`, `startedAt`/`endedAt` from `summary`.
10. Next trial state, through `TRIAL_TRANSITIONS` only: if `summary.startedAt !== null` and the
    trial is still `requested`, take the `run-started` edge (`→ running`, `startedAt` set); then,
    from `outcome.state`: `'open'` stays `running`, `'failed'` → `failed`, `'completed'` → `done`.
    A completed run therefore reads `done`, never `requested` (the case that broke the first draft
    of the reference harness).

**Decision — the literal formula (D13).** `cadrage.md:93` comments `sideEffectFree` as
"true iff externalEffects is empty and every write tool was refused", and `cadrage.md:94` adds that
`externalEffects` "must stay empty for the trial to pass". An earlier draft of this spec read the
boolean as `externalEffects.length === 0` while also listing refused attempts in `externalEffects`,
which made every masked trial fail and put the sentence at `cadrage.md:93` in contradiction with
itself. Step 7 above is the literal formula and the one this batch implements: a write attempt that
the mask, the guard or the human refused is not an outside effect — it is the mask doing its job —
so a trial in which **every** write attempt was refused does pass, and that is precisely the trial
the person then decides on. The strictness lives in the second clause: one write call that ran, or
that errored with no refusal evidence, and the proof cannot pass. Reading the panel (B5) and the
route (B3) stay consistent with this without any change on their side: `externalEffects` is non-empty
exactly when `sideEffectFree` is false, so "render a non-empty list in red" and "refuse `approve` on
a dirty trial" keep meaning the same thing. Invariant #3 ("zero external effects to pass") is then
true by construction `toolCalls[].outcome: 'refused-as-write'` still records that the mask itself
held (B5 shows it), and the frozen `ProofReport` gains exactly one field, `proofHash` (below).

**The fingerprint (`proofHash`).** `trialFromEvents` seals the proof it builds with
`proofHash = 'fnv1a:' + <8 hex of FNV-1a over the canonical fields>`, the digest being taken over
`[runId, gateId, startedAt, endedAt, supervised, sideEffectFree, toolCalls, outcome,
externalEffects, errors]` in that order (no dependency, no clock, stable across processes).
`normalizeProof` recomputes it and keeps the field **only** when it matches the content it describes:
a proof edited after the fact loses its fingerprint and reads as unsealed evidence. `trialPassed`
requires the fingerprint, `mayActivate` requires it too, and `normalizeGateRecord` caps a record that
*claims* `approved`/`activated` to `draft` when the fingerprint is missing.

The digest is **tamper-evidence, not authentication**: it is unkeyed, so a forger who reimplements
it can still produce a matching hash for a proof nobody ran. What it rules out (and what the
finding was about) is the cheap edit — flip a status, paste a plausible proof — and it makes every
claim carry a reference to what it claims. The anchor stays the journal: `trial-report` builds the
proof from the run's own events. Keying the digest with the host's machine secret (a real MAC) is a
later hardening step; it is deliberately not here, because this module holds no secret and no I/O.

### 3.5 The gate record ladder

`normalizeGateRecord` (and `applyTrial`/`askApproval`) cap a record at the highest status its
evidence allows:

| rank | status | reached only when |
|---|---|---|
| 0 | `draft` | nothing ran |
| 1 | `static-failed` | `staticChecks.verdict === 'fail'` |
| 2 | `static-passed` | `staticChecks.verdict === 'pass'` |
| 3 | `trial-done` | `trial !== null` (a proof exists, passing or not) |
| 4 | `awaiting-approval` | `trialPassed(record.trial)` — the person's decision is pending, asked or not |
| 5 | `approved` | rank 4 **and** the evidence of an approval: a sealed proof (`proofHash` valid), `approval.state === 'granted'`, an `approval.at` that is not in the future |
| 6 | `activated` | rank 5 **and** the record already claimed `activated` (normalization never invents it) |

Rules:

- `refused` is orthogonal and terminal: kept whenever `approval.state === 'refused'`.
- `status` = the lower of the stored status and the ceiling. A stored `approved`/`activated`
  that an approval's own evidence does not support is **downgraded** (to `awaiting-approval` when a
  passing proof exists but the grant is missing, else `trial-done`, else the static rung, else
  `draft`). This is the anti-forgery rung: a hand-edited record claiming `activated` reads back as
  `draft` whenever it has no sealed proof or no dated grant — the claim itself is what is refused.
- When the stored status is `static-failed`/`static-passed`, the status is **derived** from the
  verdict rather than trusted (`verdict: 'fail'` + `static-passed` → `static-failed`).
- `id` is rebuilt as `'gate:' + automationId`; an `automationId` that is not
  `/^[A-Za-z0-9_.:-]{1,120}$/` makes the whole record unusable → `null` (B3 must never invent one).
- `rev` is floored at 1 and otherwise kept; normalization never raises it (only `applyTrial` and
  `askApproval` do, by exactly 1, and only when the content changed — so B3 can skip a write).
- `updatedAt` is the stored value when it is a valid ISO 8601 string, else a valid `opts.at`; when
  neither is, the record is unusable and normalization returns `null`. It never emits `''` — an empty
  string would sit outside the frozen `updatedAt: string; // ISO 8601` contract — and never invents a
  time. `applyTrial` without a valid `at` leaves the previous `updatedAt` in place.
- `findings` are bounded to B1's `GATE_FINDINGS_MAX` (one finding per code there, so the cap
  never drops a blocker), each `{ code, severity: 'blocker'|'warn'|'info', field?, message }` with
  every string scrubbed; an unknown severity becomes `'info'`. `toStoredGate` emits the keys in
  `GATE_RECORD_KEYS` order and nothing else.
- `toStoredGate(x)` emits exactly the frozen keys (no `undefined`), all strings bounded and
  scrubbed: `normalizeGateRecord(toStoredGate(x))` deep-equals `normalizeGateRecord(x)`.

## 4. Data shapes

`GateRecord`, `ProofReport`, `GateFinding`, `Severity`, `GateStatus` are **frozen by
`cadrage.md:52-98`** and reproduced here unchanged — this batch adds one field to `ProofReport`
only (`proofHash`, §3.4) and none to any other shape.

```ts
interface ProofReport {
  runId: string; gateId: string;
  startedAt: string; endedAt: string | null;
  supervised: true;
  sideEffectFree: boolean;                      // §3.4: nothing realized AND every write call refused
  toolCalls: { toolName: string; access: 'read' | 'write';
               outcome: 'ok' | 'error' | 'refused-as-write' }[];
  outcome: { state: 'completed' | 'failed' | 'open'; code?: string; message?: string };
  externalEffects: string[];                     // 'write-succeeded:|write-unverified:<name>'; a refusal is not an effect
  errors: { at: string; where: string; message: string }[];
  proofHash?: string;                            // 'fnv1a:<8 hex>'; present only when it matches the fields above (§3.4)
}

interface GateRecord {                           // as cadrage.md:74-83
  id: string; automationId: string; status: GateStatus;
  staticChecks: { ranAt: string; verdict: 'pass' | 'fail'; findings: GateFinding[] } | null;
  trial: ProofReport | null;
  approval: { state: 'none' | 'asked' | 'granted' | 'refused'; at: string | null };
  updatedAt: string; rev: number;
}
```

One **internal, not persisted** shape (this batch's own, deliberately outside the frozen set):

```ts
interface TrialRun {
  id: string;                 // 'trial:' + automationId + ':' + <digits of requestedAt>
  gateId: string; automationId: string;
  state: 'requested' | 'running' | 'done' | 'failed';
  requestedAt: string; startedAt: string | null; endedAt: string | null;
  sessionId: string | null;
  supervised: true; approvals: 'ask'; mask: 'deny-writes';
  refusal: { code: string; message: string } | null;
}
```

## 5. Edge cases and failure modes

| # | input | expected |
|---|---|---|
| 1 | `events = []` or no `turn/start` | `proof: null`, trial state unchanged (`requested` stays `requested`) |
| 2 | turn still open | `outcome.state 'open'`, `endedAt null`, trial → `running`, never `done` |
| 3 | a write tool succeeded (`mcp__gmail__send_email`) | `access 'write'`, `outcome 'ok'`, `sideEffectFree false`, effect `write-succeeded:mcp__gmail__send_email` |
| 4 | write refused by approval `'rejected'` | `outcome 'refused-as-write'`, `externalEffects []`, `sideEffectFree true` (every write call was refused), the proof passes |
| 5 | write refused by the mask (`TRIAL_DENY_REASON` in the error text) | same as #4 |
| 6 | write refused with approval `'unavailable'` (no channel) | same as #4 (the engine denied it) |
| 7 | write error with no refusal evidence | `outcome 'error'`, effect `write-unverified:…`, `sideEffectFree false` (conservative: the call may have run) |
| 8 | `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL` with slugs `GMAIL_SEND_EMAIL` + `GMAIL_FETCH_EMAILS` | `write` (one write word is enough) |
| 9 | `mcp__composio__COMPOSIO_SEARCH_TOOLS`, `mcp__notion__list_pages`, `read`, `glob`, `grep`, `web_search` | `read` |
| 10 | `mcp__x__foo` (no known word), unknown built-in, `bash`, `write`, `edit`, `spawn_teammate`, `subagent` | `write` (unknown is never a read) |
| 11 | 300 calls: reads first, then write calls that succeed past the 20-call output bound | lists capped (20/10/5) but `sideEffectFree false`, because the verdict is computed over all 300, not the bounded list |
| 12 | a second `turn/start` later in the journal (the person kept talking) | ignored: first turn only |
| 13 | `startTrial({ by: 'model' \| 'cron' \| 'webhook' \| undefined })` | `{ ok: false, code: 'not-supervised' }`, no trial object |
| 14 | `startTrial` on `status: 'draft'` / `'static-failed'` | `'gate-not-ready'` |
| 15 | `startTrial` while `gate.trial.outcome.state === 'open'` | `'already-open'` |
| 16 | `capacity = { level: 'high' }` | `'machine-busy'` (no session is started) |
| 17 | `advanceTrial(done, { type: 'run-started' })` | `changed: false`, `code: 'illegal-transition'` |
| 18 | stored `{ status: 'activated', approval: { state: 'none' } }` **with no checks and no trial** | reads back `draft` |
| 19 | stored `{ status: 'activated', approval: granted, trial: proof(sideEffectFree false) }` | reads back `trial-done` |
| 20 | stored `{ status: 'approved', approval: granted, trial: passing proof }` | kept `approved`; `mayActivate` true |
| 20b | stored `{ status: 'activated', approval: granted, trial: clean-looking proof typed by hand }` (no `proofHash`) | reads back `draft`; `mayActivate` false; `trialPassed` false |
| 20c | stored `{ status: 'approved', approval: granted at <future> }` on a sealed passing proof | reads back `draft` (a grant cannot be dated after the caller's instant) |
| 20d | a sealed proof whose content was edited afterwards (hash no longer matches) | `proofHash` dropped by `normalizeProof`; record with a claim reads back `draft` |
| 21 | `staticChecks.verdict 'fail'` + stored `static-passed` | derived `static-failed` |
| 22 | `rev: 0`, `rev: '7'`, `rev: 3.5`, no `rev` | `1`, `1`, `1`, `1` (never raised, floored) |
| 23 | hostile text (e-mails, 500-char tokens, control characters, `\u2028`) | scrubbed by `scrub` and clipped; no e-mail, no long token |
| 24 | `null`, `[]`, `'x'`, `{}` as a record | `null` (no usable `automationId`) |
| 25 | `applyTrial` with the same proof twice | second call returns an equal record with the same `rev` (identity means "no write needed") |
| 26 | `toStoredGate` round trip | deep-equals the normalized input |
| 27 | `at` missing, `''`, `'yesterday'` | `startTrial`/`askApproval` refuse `'no-timestamp'`; `applyTrial` keeps the previous `updatedAt`; `normalizeGateRecord` returns `null` when neither the stored `updatedAt` nor `opts.at` is ISO 8601 — no invented time and no `''` |

Failure modes the module must not have: throwing on any of the above, reading the clock, reading a
file, requiring `gate` to be a `GateRecord` instance (it is plain data), or assuming `events` is
sorted (the builder follows array order and looks for the first `turn/start`/`turn/end`, exactly
like `summarizeRun`).

## 6. Security guards

1. **No activation without a human.** The module exports no grant and no activate; `mayActivate`
   is a pure predicate returning `false` unless a **sealed** passing proof is attached (a `runId`
   and a valid `proofHash`, §3.4) **and** `approval.state === 'granted'` with a timestamp.
   `normalizeGateRecord` enforces the same ladder on stored bytes and caps an unsupported
   `approved`/`activated` claim to `draft`, so neither a model nor a hand edit can climb it.
2. **No autonomous external side effect.** `startTrial` refuses any origin that is not a person;
   every `TrialRun` carries `approvals: 'ask'` and `mask: 'deny-writes'` as constants; a proof in
   which a single write-classified call was not refused at runtime cannot pass, and a proof that
   realized an effect cannot pass either (§3.4).
3. **No I/O, no clock, no boot risk.** Only `fs`-free, network-free, timer-free code; nothing runs
   at import. B3 still imports it inside the existing `try/catch` guard (`mountAutomationTools`
   pattern, `index.js:3597`), per "a bundle must never stop DSH from starting".
4. **Bounded output.** Every array and string is capped (`PROOF_TOOL_CALLS_MAX`,
   `PROOF_ERRORS_MAX`, `PROOF_EFFECTS_MAX`, `PROOF_TEXT_MAX`, `GATE_FINDINGS_MAX`,
   `GATE_ID_MAX`); every text passes `scrub` (`automation-runs.mjs:31`) so no e-mail, no long
   token and no control character reaches the record, the route or the page.
5. **No personal data, no paths.** The proof carries tool names, timings and scrubbed error text —
   never an argument value, a file path, a token or a message body.
6. **Language.** Comments, docs, refusal codes and the model-facing `TRIAL_DENY_REASON` are
   English; no French string is added by this batch.

## 7. Contract with the other batches

These are preconditions B3 must honour; the spec states them so the seams cannot drift.

- `trial-start` reaches `startTrial` **only** from a signed-in browser request, passed as
  `by: 'person'`. A model tool call, a cron, a webhook, or a tunnelled (phone) call is refused
  before the module is called, and the module refuses it again (`'not-supervised'`).
- B3 enforces the mask at runtime on the trial session (D12): a `ctx.tools.guard()` registered for
  the trial session denies every write-category call with `TRIAL_DENY_REASON`. The guard classifies
  with the host's own write words (`KB_MCP_WRITE_WORDS` through `kbNameWords`, the table the MCP
  approval gate already uses); this module's `accessOf` is the classifier of the **proof**
  (`toolCalls[].access`), so a name the guard lets through still fails the proof — the second
  opinion is deliberate and fail-safe. When the tools service has no `guard`, the
  `tools/pre-execute` seam (`ctx.on('tools/pre-execute', …)`, the plugin's own hook,
  `{ kind: 'deny', reason }` — the shape already used at `index.js:2895-2904`) is the **accepted
  degraded fallback** (R3), and B3 refuses `write guard unavailable` only when neither seam exists.
  Either way the engine answers the tool call with an error carrying the reason, which §3.4 step 4
  reads as a refusal — that answer is the "refused at runtime" of the formula, so the proof, the
  gate record and B5's panel do not know which seam ran.
- B3 also applies the asking preset (`index.js:3046` pattern, `approvals: 'ask'` minimum), so the
  mask is not the only line of defence.
- B3 records the trial in `task.history` as `{ at, status: 'trial', gateId, sessionId: null }`
  and **without** a session id, so `stableStreak` (`automation-skills.mjs:26`) does not count it
  as a stable run and pulse's `candidates` (`pulse-core.mjs:126`) does not announce it.
- B3 passes `capacity` (`{ level, maxParallel }` from the scheduler's own reading,
  `automation-load.mjs:152`) so a loaded machine refuses a trial instead of stacking sessions.
- B3 is the only writer of `approval.state = 'granted'` and of `active: true`, and the second one
  only when `mayActivate(gate) === true`. Neither call exists in this module. `mayActivate` is also
  the predicate of **every run path** — `toggle`, `run-now`, `consume-fire`, the webhook and the
  scheduler's own fire — so "may it be switched on" and "may it run" are one question with one
  answer, and a change to the rule is made here and nowhere else (R3). B3 holds no second ladder:
  its `kbGateActivationRefusal(record, mayActivate)` takes the predicate as an argument, answers
  `'approval required'` unless it returns `true`, and answers `null` for an absent record. A missing
  `mayActivate` export fails closed — the adapter receives no function and refuses every record — and
  never open.
- B3 starts the trial with `startTrial` — including `by: 'person'` and `capacity` — and adopts the
  three exports the contract names (`startTrial`, `toStoredGate`, `mayActivate`) instead of
  reimplementing their rules.
- B3 persists with `toStoredGate` and reads back with `normalizeGateRecord`; a `null` from
  normalization means "drop the record", never "invent one".
- B5 renders the proof; B6 notifies on `trial-done`/`awaiting-approval`, both read-only on the
  frozen shapes. `pulse-core.mjs:89` `readRun` is read for **parity of vocabulary** only
  (`running|waiting|done|failed`); this module does **not** import across packages — that would
  couple the plugin to the pulse bundle's lifecycle.

## 8. Out of scope

- HTTP, routes, `kbTasksHandle` actions, origin/tunnel fencing → B3.
- The store: file path, atomic rename, mode, locking, `rev` compare-and-set on write → B3.
- Starting the session and sending the prompt (the trial's runner) → B3. This module never
  creates a session; it receives `sessionId` and the journal.
- The static checks and their findings → B1 (`checkDraft`). This module only bounds and stores
  what B1 produced.
- Any UI: panel, findings list, proof rendering, i18n strings → B5.
- Inbox items and banners → B6.
- The `granted` transition, the `active` flip, `run-now`/`toggle` semantics → B3 (and its own
  route test).
- Skill proposals from a passing trial (`automation-skills.mjs`) → not this lot.

## 9. File-by-file change plan

### NEW `packages/kybernos-plugin/automation-trial.mjs` (~340 lines)

Header comment in the house style of `automation-runs.mjs:1-11`: what a trial is, why the rules
are pure, what it deliberately cannot do. It states those absences in prose ("never reads the
clock", "no filesystem") and never spells the forbidden calls literally, so the DoD grep that
proves the absence keeps working on code lines only. Four marked sections, in this order:

1. `// ── What a call may touch ──` — `accessOf`, the two word sets and the built-in tables.
   Bounded: the write words are a copy of the *shape* of `index.js:765`'s set, not an import of
   it (that table is private to the host module and is a hot file owned by B3; a copy here is a
   deliberate second opinion, tested against the samples listed in §5 rows 8-10).
2. `// ── The trial ──` — `TRIAL_STATES`, `TRIAL_TRANSITIONS`, `startTrial`, `advanceTrial`.
3. `// ── The proof ──` — `trialFromEvents`, `trialPassed`, `gateStatusAfterTrial`.
4. `// ── The gate record ──` — `normalizeProof`, `normalizeGateRecord`, `toStoredGate`,
   `applyTrial`, `askApproval`, `refuseApproval`, `mayActivate`.

Read-only anchors this module is written against (no edit to any of them):

- `automation-runs.mjs:31` `scrub`, `:16-21` bounds, `:36-39` `argsOf` semantics, `:83-99`
  `summarizeRun` + first-turn convention, `:141` the 40-char tool-name truncation (why the second
  pass exists), `:174-181` approvals, `:190` outcome.
- `session-outcome.mjs:22` `lastTurnOutcome` — reached through `summarizeRun`, not imported.
- `automation-load.mjs:152` `allowedAt` (the only host rule the state machine asks for).
- `automation-skills.mjs:26` `stableStreak` and `index.js:3397` history writing — to state §7's
  "a trial is not a stable run" constraint.
- `pulse-core.mjs:89` `readRun` — vocabulary parity only.
- `index.js:2730` (the plugin's own `tools/pre-execute` hook) and `:2895-2904` (its `{ kind: 'deny',
  reason }` answer, the fallback's shape), `:3046` (`approvals: 'ask'` enforcement), `:3597`
  (`mountAutomationTools` try/catch pattern) — the seams B3 will use.
- `automation-gate.mjs` (B1) — imported for its four frozen vocabulary lists only
  (`GATE_STATUSES`, `GATE_APPROVAL_STATES`, `GATE_RECORD_KEYS`, `GATE_FINDINGS_MAX`); no function of
  B1 (`checkDraft`, `gateSummary`, `normalizeDraft`) is called here — B3 calls those and hands the
  result to `applyTrial`/`normalizeGateRecord`.

### NEW `packages/kybernos-plugin/test-automation-trial.mjs` (~280 lines)

Same harness as every neighbour: `import assert from 'node:assert/strict'`, a local `ok(label)`
counter printing `✓`, a final `<n> verifications OK`, and `process.exit(0)` at the end
(`test-automation-runs.mjs` is the model). Auto-discovered by `scripts/run-all-tests.mjs`
(`discover()` matches `packages/*/test*.mjs`, runs it with its package as cwd), so nothing has to
be registered anywhere. Cases: §5 rows 1-27, the export-surface equality of §3.2.1 (27 names, exact
set), plus the DoD assertions of the strategy document.

### No other file

`git status --porcelain` after the batch must show exactly these two paths (plus the two docs).
