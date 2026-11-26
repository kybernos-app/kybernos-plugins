# Spec — B3 `host-gate-and-queue-routes`

Host seams of the proactive batch: the gate actions and the initiative-queue actions on the **existing**
`/kybernos/tasks` route, their storage, and the approval seam.

| | |
|---|---|
| Batch id | `host-gate-and-queue-routes` (B3) |
| Branch / worktree | `feature/kaby-proactive-lot1` in the `kybernos-plugins-proactive` worktree |
| Sole owner of | `packages/kybernos-plugin/index.js` (invariant #4) |
| Writes | `packages/kybernos-plugin/index.js`, `packages/kybernos-plugin/test-automation-gate-routes.mjs` (new) — nothing else |
| Reads | `index.js`, `suggestions.mjs`, `automation-tools.mjs`, `automation-published.mjs`, `session-guard.mjs`, `automation-gate.mjs` (B1), `automation-trial.mjs` (B2), `initiative-queue.mjs` (B4), `docs/dev/route-origin-rule.md` |
| Stage | **spec only.** No implementation code in this document's batch. |
| Invariants carried | #1 (the approval/activation seam is *this* batch), #2 (routes record drafts and decisions only), #3 (`trial-start` needs a human request and forces the ask mask), #4 (`index.js` exclusive) |

Line anchors below are from the pre-edit tree (`feature/kaby-proactive-lot1`, `index.js` = 12 898 lines).
Apply edits **from the bottom of the file upwards**, or re-locate by the quoted text: the numbers move as soon
as the first edit lands.

---

## 1. Goal

Give the Automations page (B5) and the agent tools (B4) a **host contract** for the certification gate and the
initiative queue, without a new route, without a new engine seam and without ever letting code — model, cron or
tool — move an automation to *approved* or *running* on its own:

1. `gate-check` runs B1's pure static checks on a stored automation and records the verdict.
2. `trial-start` launches one **supervised** trial run of that automation with the ask mask forced, on a human request only.
3. `trial-report` turns the trial's journal into B2's proof report and moves the gate to *awaiting approval* when the proof is clean.
4. `approve` is the **only** path to `approved`, and only from an authenticated human request.
5. `queue list` / `queue act` expose B4's bounded initiative ledger to the page.
6. Every existing "make it run" path (`toggle` on, `run-now`, `consume-fire`, the webhook fire, and the scheduler's own
   fire through `kbMakeTrigger` -> `kbFireTask`) is **closed** for an automation that carries a gate record which is not
   approved — cadrage risk 1, made impossible rather than documented. The four paths that could *re-activate* an
   automation without that word (`update`, whose sanitizer defaults `active: true`; `cloud-link`, which restores
   `wasActive` **and** which publishes the automation to a computer that runs it; and a code-issued `toggle`) are closed
   by the same tooth (§3.3). And `create` seeds a `draft` record for every NEW automation (§3.3), so "no record is no
   gate" is now the legacy case only: an automation that predates the gate.
7. During a trial the write refusal is enforced at runtime, not judged afterwards only: a write-category tool call made
   from the trial's own session is denied by a `tools.guard()` installed for the trial and removed when it ends — or, when
   the tools service has no `guard`, by the `tools/pre-execute` denial the plugin already uses (§7.8).

**Not in that list: `accept`, and the note is corrected rather than carried.** Add is `acceptedTask`, which keeps the
automation switched off (`automation-suggest.mjs:29-30`), so it is not an activation path and there is nothing to gate
there. `cadrage.md` risk 1 no longer counts it (corrected in R4).

## 2. Where it lives — no new route

Everything rides `POST /kybernos/tasks` (`index.js:11391`) and its single dispatcher `kbTasksHandle`
(`index.js:3181`). That route already carries:

- `sameOriginStrict(req)` — a request with no `Origin` is a 403 (`index.js:11393`);
- `kbTasksRefused(req, true)` — DSH's signed browser-session cookie, 401 when missing/forged/expired (`:11388`, `:11394`);
- the phone fence — `if (phone && body.action !== 'list') return 403 refused_on_phone` (`:11401`);
- a 200 000-byte body cap and a JSON-object shape check (`:11396`, `:11397`).

**No `webServerSvc.register` block is added.** The gate and queue payloads are small objects on the existing
envelope: a body above the existing 200 000-byte cap is a *stop and re-cadrage*, not a new route. A new route would
mean a new row in the origin-rule audit and a new phone decision; the batch refuses that, and this sentence is the
condition under which the tile is reopened.

The one thing this batch does **not** re-decide is the phone allow-list: `{ action: 'list' }` stays the only action a
tunnelled request may make. All six new actions are already covered by `:11401` (they are not `'list'`), and the test
proves it rather than trusting it.

## 3. Exact API surface

### 3.1 The dispatcher gains a second, internal argument

```js
// index.js:3181 — today: const kbTasksHandle = async (body) => { … }
const kbTasksHandle = async (body, opts) => {
  const action = str(body.action)
  // The request's own nature, decided by the ROUTE from the authenticated request — never from the body.
  const human = opts !== null && typeof opts === 'object' && opts.human === true
  …
}
```

- `opts` is **never** read from `body`: a wire body that says `{"human":true}` is inert (tested).
- The route passes it at `index.js:11403`: `await kbTasksHandle(body, { human: true, via: 'http' })` — at that point the
  request has passed origin + cookie + phone, so "a human's browser asked" is a measured fact.
- Every other caller (`automation-tools.mjs:76`, `:91` and B4's tools through `deps.tasks`) passes nothing, so
  `human === false`. That is the tooth that keeps a model out of `approve`, `trial-start` and `queue act`, and out of
  switching on a gated automation.

The human requirement is one pure predicate of the marked block, so it is unit-testable and has a single reading:

```js
// HUMAN_ONLY: the actions whose human requirement does not depend on the body.
const HUMAN_ONLY = ['trial-start', 'approve', 'queue act', 'toggle']
// The activation transition is human-only too, but only in its `active: true` direction: pausing is never a risk, and
// an automation with no gate record keeps today's behaviour (a model may pause and resume it).
const kbHumanOnly = (action, body, human) => {
  if (HUMAN_ONLY.indexOf(action) < 0) return null
  if (action === 'toggle' && (body === null || typeof body !== 'object' || body.active !== true)) return null
  return human === true ? null : 'not a human request'
}
```

Each of those actions calls `kbHumanOnly(action, body, human)` first and returns its refusal as `{ ok: false, error }`;
nothing else in the batch asks for `human`. `toggle` consults it only for the activation direction (`active: true`) **and**
only when the automation carries a gate record — the gate read that the activation tooth needs answers both questions, so
one read serves the pair (§3.3). An ungated automation is judged exactly as today, which is what keeps regression case 22
(§8) true. There is exactly **one** `human: true` in the whole file, on the route's call line (§3.1), and every
in-process caller (`automation-tools.mjs`) reaches the dispatcher with a single argument — which is what makes the seam
auditable by grep as well as by test.

Six new dispatches, written in this exact literal form so the DoD grep is stable:

```js
if (action === 'gate-check') { … }
if (action === 'trial-start') { … }
if (action === 'trial-report') { … }
if (action === 'approve') { … }
if (action === 'queue list') { … }
if (action === 'queue act') { … }
```

Inserted immediately before the last line of the dispatcher, `return { ok: false, error: 'unknown action: ' + String(action) }`
(`index.js:3476`).

### 3.2 Actions — bodies, answers, refusals

Same envelope as every existing action: `{ ok: boolean, … }`, and a refusal is `{ ok: false, error: '<machine string>' }`
(the page shows the string as it is; B5 owns wording). Only two answers carry a `code`, next to `error`, because the
page must branch on them (`stale`, `gate-corrupt`).

| action | body | answer | refusals (`error`) |
|---|---|---|---|
| `list` (existing, one field added) | `{}` | `{ ok: true, tasks }`, each task carrying `gate` (bounded record or `null`) | none new: a corrupt gate store still answers 200 with `gate: null` and `gateStore: 'unreadable'` (§5.3) |
| `gate-check` | `{ id }` | `{ ok: true, gate }` | `id required`, `task not found`, `runs in the cloud`, `gate unavailable`, `gate-corrupt` |
| `trial-start` | `{ id }` | `{ ok: true, gate, runId }` | `not a human request`, `id required`, `task not found`, `suggested: add it first`, `runs in the cloud`, `static checks failed`, `a trial is already running`, `machine busy`, `no timestamp`, `mask unavailable`, `trial needs a live session`, `write guard unavailable`, `trial module unavailable`, `trial unavailable`, `gate-corrupt` |
| `trial-report` | `{ id }` | `{ ok: true, gate, report }` | `id required`, `task not found`, `no trial to report`, `run journal unavailable`, `run unreadable`, `trial module unavailable`, `gate-corrupt` |
| `approve` | `{ id, decision: 'grant' \| 'refuse', rev }` | `{ ok: true, gate }` | `not a human request`, `id required`, `decision must be grant or refuse`, `rev required`, `gate not found`, `stale` (+ `gate`), `approval not possible: <reason>`, `gate-corrupt` |
| `queue list` | `{}` | `{ ok: true, items, cap }` | `queue unavailable`, `queue unreadable` |
| `queue act` | `{ id, status: 'asked' \| 'added' \| 'dropped' }` | `{ ok: true, item }` | `not a human request`, `id required`, `unknown status`, `not found`, `queue unavailable` |

`gate` in every answer is the **bounded projection** (§5.3), never the raw stored record. `report` is the `proof` field of
B2's `trialFromEvents` answer, unchanged.

**B2's refusal codes never reach the wire.** B2 answers a refusal as `{ ok: false, code, error }` with a closed,
machine-readable code — `TrialRefusalCode` for `startTrial`: `not-supervised`, `gate-not-ready`, `already-open`,
`machine-busy`, `no-timestamp`. The pure block maps every code through one function, `kbGateTrialRefusal(code)`, so the
strings the page branches on are B3's and the mapping is unit-tested:

| B2 code | `trial-start` / `approve` answer |
|---|---|
| `not-supervised` | `not a human request` |
| `gate-not-ready` | `static checks failed` |
| `already-open` | `a trial is already running` |
| `machine-busy` | `machine busy` |
| `no-timestamp` | `no timestamp` |
| anything else | `trial unavailable` |

The last row is defensive and deliberate: a code B2 does not know today answers a readable string instead of
`undefined`, and the mapping never echoes B2's internal spelling to the page.

`trial-start` hands B2 the machine's own reading — `capacity: { level, maxParallel }` from `kbLoadCapacity()`
(`index.js:2873-2879`), the reading the scheduler's tick already uses (`automation-load.mjs:152` `allowedAt`) — so a loaded
machine refuses the trial (`machine busy`, B2's `'machine-busy'`) instead of stacking a fifth session; the rule is B2's,
B3 only measures and passes it.

`queue act` carries B4's own vocabulary (`initiative-queue.md`, `resolve(id, status)`): the three statuses a person can give
an entry, `asked`, `added` and `dropped`. `proposed` is refused — it is the creation state — and an unknown string never
reaches the ledger: B3 answers `unknown status` without writing.

`runId` is the trial's session id (`kbFireTask` returns `{ sessionId }`); it is the key `trial-report` reads the journal
with, so no second identifier is invented. `trial-start` also records a history entry `{ at, status: 'trial', gateId, sessionId: null }` in `task.history` — the marker B2's preconditions expect (§7) so `stableStreak` sees the trial as its own kind of run, not a success or a failure.

### 3.3 Existing actions this batch closes (the seam, not new features)

| anchor | action | new behaviour |
|---|---|---|
| `index.js:2978` `kbFireTask` | the fire itself (reached by the scheduler's tick, `run-now`, `consume-fire` and the webhook) | first statement: `const no = await kbGateRunRefusalTask(task)`; when it is not `null` the function returns `{ refused: no }` **before** creating a session or prompting anything. The trial is the single exception, through an internal second argument — `kbFireTask(task, { trial: true })` — set only by `trial-start` (§7.5) and never read from a wire body. |
| `index.js:613-614` the `kbMakeTrigger` tick (re-measured: `const res = await withTimeout(… fire(…))`, then `results.push({ id: claim.id, ok: true, res })`) | a claim whose fire came back refused | `results.push({ id: claim.id, ok: false, skipped: res.refused })` and neither `fired` nor `failed` is incremented: a skipped run is not a failed run, and the next slot is its next chance (the claim already moved `nextRun`). The history write at `index.js:630-633` gains its own branch — `{ at, sessionId: null, status: 'skipped', error: res.refused }` — **not** `status: 'error'`: an `'error'` line breaks `stableStreak` (`automation-skills.mjs:26-38`) for a refusal that is the gate's decision, not the automation's failure, and paints a red row the person cannot act on. `sessionId: null` is what keeps the line out of the stable count while keeping the streak; `lastRun` is left as it is (nothing ran) and `updatedAt` moves with the history write. |
| `index.js:3327` `toggle` | `toggle { id, active: true }` | on an automation that carries a gate record, in this order: `kbHumanOnly('toggle', body, human)` (`not a human request`), then `kbGateActivationRefusal(record, kbTrialFn('mayActivate'))` (`approval required`) before computing the next run. That adapter is one line over B2's `mayActivate` and holds no ladder of its own (§4.1). `active: false` is **never** judged (pausing is not a risk) and an automation with no record keeps today's behaviour. |
| `index.js:3385` `run-now` | `run-now` | `kbGateRunRefusalTask(t)`, right after the existing `suggested` refusal at `:3391`. |
| `index.js:3457` `consume-fire` | `consume-fire` | read the task first (the action currently loops inside the mutation without reading it); refuse when `kbGateRunRefusalTask(task)` is not null. |
| `index.js:12058` hooks fire path | webhook | `kbGateRunRefusalTask(task)` before `kbFireTask`; the webhook answers 403 `approval required` and records nothing. |
| `index.js:3261` `update` | any edit of a gated automation | **demotes** the gate: `status: 'draft'`, `staticChecks: null`, `trial: null`, `approval: { state: 'none', at: null }`, `rev + 1`. The certification covers the definition that was reviewed; an edit voids it (this is what makes "approve an innocent draft, then edit it into a dangerous one" impossible without a new shape field). **And** the active flip is gated as in `toggle`: `kbSanitizeTaskInput` defaults `active: true` (`:448`, `active: r.active !== false`), so an edit body that omits `active` switches an automation on; when the stored task is not active and the merged one would be, on a record `kbGateActivationRefusal` refuses (§4.1 — one rule, not a second one written here), the edit is refused `approval required` and nothing is written. An edit that leaves `active` as it was is always allowed — fixing the draft a `gate-check` just failed must stay possible on an automation that is already running. |
| `index.js:3917` `create` | a brand-new automation | **seeds its gate record at `draft`, `rev: 1`**, before `tasks.json` is touched: `kbGateInsert(records, kbGateStored(kbGateEmptyRecord(id, at)))`. Every new automation therefore carries a record from its first second, and the rules above apply to it immediately. A gate store that is unreadable or full refuses the creation (`gate store unreadable` / `gate store full`): an automation nobody could ever certify is worse than no automation. `suggest`/`accept` and `learn` are unchanged — a suggestion is not yet an automation, and the onboarding recipe is stored switched off (R4's correction stands). |
| `index.js:3917` `cloud-link` | publishing (`cloud: { computerId, name }`) | **publish is an activation too**: `kbGateActivationRefusal(record, mayActivate)` runs before the link is written. A record that may not activate this computer (`static-failed`, `static-passed`, `trial-done`, `awaiting-approval`, `draft`) is refused (`approval required`, nothing written) — a static-failed draft can no longer be made runnable somewhere else. An approved/activated record is published as before. |
| `index.js:3917` `cloud-link` | bringing an automation back (`cloud: null`) | restores `active` from `cloud.wasActive`; on a record `kbGateActivationRefusal` refuses (§4.1) that restore is refused (`approval required`, nothing written, the link stays exactly as it is). Coming back paused is not offered: the person's `toggle` is the only activation path, and a silent `active: false` would hide why. |
| `index.js:4333` `approve` (grant) | the record's proof | the record must carry a proof B2 **sealed** (`proofHash` over its own content, §3.4 of the trial spec): `trialPassed(record.trial)` is re-read through `kbTrialFn('trialPassed')` before the grant is written, so a hand-edited `gates.json` with a clean-looking proof gets `approval not possible: the proof is unverified` instead of an approval the next read would demote to `draft`. |
| `index.js:3351` `delete` | delete of a gated automation | removes the gate record (the store stays bounded by the number of automations) and disposes a trial guard still held for it. A trial still running is left alone in the journal: there is nothing left to report it to. |

**One tooth, five call sites, one predicate.** `kbGateRunRefusalTask(task)` is the only run-path predicate: it reads
`gates.json`, finds the record of `task.id`, and answers `null` (no record), or `gate store unreadable` when the file cannot
be trusted (§5.2), or `'approval required'` unless the record's own evidence allows activation. That last judgement is not
B3's: it is `mayActivate(record)`, B2's single activation predicate, reached through the one-line adapter
`kbGateActivationRefusal(record, kbTrialFn('mayActivate'))` (§4.1). "May this automation run" and "may this automation be switched
on" are therefore one question with one answer, and a change to the ladder lands in `automation-trial.mjs` only. The webhook,
`run-now` and `consume-fire` call it *before* the mutation so they can answer a specific status; `kbFireTask` calls it again
on every fire, which is what closes the scheduler path and any caller added later.

**Activation** (the `activated` status + `active: true`) happens on the person's `toggle { active: true }` of an
`approved` record: the task write lands **first** (the truth is `tasks.json`), then the gate is marked `activated`.
If the second write fails, the gate stays `approved` — still activatable, still honest — and the next toggle repairs it.
No other code path writes `activated`, and the toggle that produces it is human-only for a gated record (§3.1): `update`
and `cloud-link` are refused when they would switch such an automation on, and `kbFireTask` never writes a gate at all.

### 3.4 The dispatcher's answer to a phone

Unchanged. `index.js:11404` still strips webhook secrets from `tasks` on a phone answer; the six new actions never
reach the dispatcher with the marker set.

### 3.5 Agent-tool wiring (the only change outside the dispatcher's own actions)

`index.js:3597` currently passes `{ tasks, ledger }`. B3 adds the queue so B4's two tools record in process, exactly
as `ledger.add` does today:

```js
mountAutomationTools(ctx, {
  tasks: kbTasksHandle,
  ledger: { add: async (kind, raw) => (await kbSugg()).add(kind, raw) },
  initiative: {
    add: async (raw) => (await kbInitiatives()).add(raw),
    list: async (status) => (await kbInitiatives()).list(status),
  },
}, log)
```

Contract with B4: the key is **`initiative`, singular**, and `list` takes a status — B4's own names (`initiative-queue.md`
§"Interfaces": `deps.initiative`, `list(status)`), adopted here rather than mirrored with a second spelling. The two tools
are mounted **only** when `deps.initiative` carries both functions (the `deps.ledger` pattern at `automation-tools.mjs:95`),
and B3 passes that key only when `kbQueueFn('makeInitiativeQueue')` is not `null` — so a missing B4 module drops the two tools
instead of registering two tools that throw on every call, and B4's batch stays installable before or after B3 without
breaking either. The accessors answer promises (the maker needs `await kbTasksFileOf()`), and B4 awaits both — `add` already,
`list` in its `execute` — so a synchronous `list` and this asynchronous one are the same caller-side shape.

`kbInitiatives()` is the lazy maker on the `kbSugg` model (`index.js:3592-3594`):

```js
let kbInitLedger = null
const kbInitiatives = async () => {
  if (kbInitLedger === null) {
    const make = kbQueueFn('makeInitiativeQueue')
    if (make === null) throw new Error('queue unavailable')
    kbInitLedger = make({ file: joinPath(dirname(await kbTasksFileOf()), 'initiatives.json') })
  }
  return kbInitLedger
}
```

### 3.6 Module imports — never a boot failure

Three modules belong to other batches (`automation-gate.mjs` B1, `automation-trial.mjs` B2,
`initiative-queue.mjs` B4). They are imported as **namespace** imports next to `automation-tools.mjs`
(`index.js:28`):

```js
import * as kbGateMod from './automation-gate.mjs'
import * as kbTrialMod from './automation-trial.mjs'
import * as kbQueueMod from './initiative-queue.mjs'
```

and read through tiny guarded accessors (`kbGateFn('checkDraft')`, `kbTrialFn('trialFromEvents')`,
`kbQueueFn('makeInitiativeQueue')`) that return `null` when the export is absent. Reason: a **named** import of an
export that does not exist is a link-time error that takes the whole bundle down (the repo rule is "a module must never
stop DSH from starting"), while a namespace read is just `undefined`. A missing export therefore degrades one action
to `gate unavailable` / `trial module unavailable` / `queue unavailable`, and the rest of DSH (and of the Automations
page) is untouched. This is asserted at source level in the test.

## 4. Cross-batch contracts (required exports)

B3 fails at integration, and stops for a re-cadrage, if a required export is missing or shaped otherwise.

| module | required export | used for |
|---|---|---|
| B1 `automation-gate.mjs` | `checkDraft(draft) -> { verdict: 'pass' \| 'fail', findings: GateFinding[] }`, `GATE_STATUSES` (frozen array, the statuses of cadrage §"Shared data shapes") | `gate-check`; the status vocabulary `kbGateNext` is given (no copy in `index.js`) |
| B2 `automation-trial.mjs` | `startTrial({ gate, by, at, sessionId, capacity }) -> { ok: true, trial: TrialRun } \| { ok: false, code, error }`, `advanceTrial(trial, signal) -> { trial, changed, code? }`, `trialFromEvents({ trial, events, at }) -> { trial: TrialRun, proof: ProofReport \| null }`, `applyTrial(gate, { trial, proof, at }) -> GateRecord`, `askApproval(gate, { at }) -> { ok: true, gate } \| { ok: false, code, error }`, `mayActivate(gate) -> boolean`, `normalizeGateRecord(raw, { at }) -> GateRecord \| null`, `toStoredGate(gate) -> object`, `TRIAL_APPROVALS` (`'ask'`), `TRIAL_DENY_REASON` | `trial-start` (`startTrial`, `TRIAL_APPROVALS`), `trial-report` (the proof, then the gate: `applyTrial` + `askApproval`), the activation predicate and the run tooth (`mayActivate` §4.1), writing (`toStoredGate`) and reading back (`normalizeGateRecord`), the trial write guard's reason (`TRIAL_DENY_REASON`) |
| B4 `initiative-queue.mjs` | `makeInitiativeQueue({ file, now, newId }) -> { list, add, resolve, cap }` with **`list(status)`** and **`resolve(id, status)`**, `status ∈ {'asked','added','dropped'}`, answering `{ ok: true, item }` / `{ ok: false, error }`; `cap` is the frozen `INITIATIVE_MAX` the queue exposes as a constant | `queue list`, `queue act`, `deps.initiative` |

Each signature above is the other batch's, verbatim: `startTrial` takes one object and answers `{ ok, trial | code, error }`;
`trialFromEvents` takes one object `{ trial, events, at }` and answers `{ trial, proof }` (B3 reads `.proof` as the answer's
`report`); `normalizeGateRecord(raw, { at })` is the two-argument form, and `at` is the only way a time enters a stored
record. B3 **adopts B2's surface instead of mirroring it** (R3): `startTrial` begins the trial, `toStoredGate` is the only
writer shape, and `mayActivate` is the only activation predicate (§4.1). `trial-report` composes them in that order: read the
journal, build the proof, `applyTrial`, then `askApproval` when `trialPassed(proof)` holds — B3 writes no status itself. A
required export that is missing is `trial module unavailable` / `queue unavailable`, never a local reimplementation (§9).

### 4.1 The activation predicate is B2's `mayActivate`, and B3 adopts it

`mayActivate(gate) -> boolean` is **the** activation predicate of the lot (R3): true only for a record whose proof passed
**and** whose approval is `granted` with a timestamp. B3 calls it and never re-derives it:

- the pure block owns one adapter, `kbGateActivationRefusal(record, mayActivate)`, answering `null` when there is no record
  (no record = no gate = today's behaviour, regression case 22) and otherwise `'approval required'` unless the injected
  predicate answers `true`. One conditional, no ladder: the rungs live in B2's table (§3.5 of `gate-trial-proof.md`), and
  the second parameter is the **value** `kbTrialFn('mayActivate')` — a function, or `null` when the export is absent, in
  which case the adapter answers `'approval required'` for every record (a partial install fails **closed**, §8 row 42,
  instead of un-gating the store);
- the predicate is a **parameter** and not an import because the block is extracted and run through a `data:` URL with no
  engine context (§11). That is also what makes the delegation testable: the unit cases drive the adapter with a stub
  predicate, then with `null`, and grep the block for a second ladder;
- `kbGateRunRefusalTask(task)` uses the same pair, so "may this automation run" and "may this automation be switched on" are
  one question with one answer (§3.3). A change to the rule — one more rung, a different proof condition — is made in
  `automation-trial.mjs` and nowhere else.

The draft handed to `checkDraft` is exactly what `tasks.json` holds, restricted to its five definition fields:

```js
{ name, prompt, schedule, needs, approvals }   // approvals already normalised to 'ask' | 'auto' by kbSanitizeTaskInput (:449)
```

`runsOn`, `active`, `sessionMode`, `notify` and the workspace hint belong to the host's running state, not to the definition
being certified, so they are not part of the draft.

No `tools` field: an automation stores a prompt, not a tool list; B1's checks must tolerate its absence.

## 5. Data shapes

### 5.1 Gate record — cadrage's `GateRecord`, unchanged

`id = 'gate:' + automationId`, `rev` starts at 1 and increments on **every** write, `updatedAt` is ISO 8601.
B3 adds no field. The statuses are B1's `GATE_STATUSES` — B3 never writes a literal status it did not read from a
transition.

### 5.2 Storage (`<DSH home>/kybernos/`)

| file | envelope | owner |
|---|---|---|
| `gates.json` | `{ "version": 1, "records": GateRecord[] }`, mode 0600, atomic temp+rename, one writer at a time, no write when nothing changed | B3 |
| `initiatives.json` | whatever `initiative-queue.mjs` writes (same ledger conventions: 0600, atomic, serial) | B4 |

**Both files sit beside `tasks.json`, and that is the only path rule.** `gates.json` is
`joinPath(dirname(await kbTasksFileOf()), 'gates.json')` and `initiatives.json` the same directory — so a DSH home moved,
sandboxed or test-temporary carries its gate and its queue with its tasks, and no literal path is written anywhere. B6's
fallback list, if it ever reads files at all, must name those two files in *that* directory (`gates.json` and
`initiatives.json` next to `tasks.json`), never a second location such as the store root or a plugin folder — a reader
pointed one directory off sees an empty agenda and reports it as healthy. B5 reads `task.gate` from the `list` answer (§5.3, D1); B6 reads `gates.json` beside `tasks.json` as its file fallback (R1).

`gates.json` read/parse/validate is a **pure block** in `index.js` (§10.1, row 2) so it is testable without a plugin context;
the fs access is injected, the way `kbMakeTaskStore(io)` (`index.js:488`) takes `io`. Errors mirror the task store's:
`gate-corrupt` (file present, unparsable: the file is left untouched and a private copy `gates.json.corrupt-<ts>` is
kept) and `gate-unreadable`. A gate action on a corrupt store answers
`{ ok: false, code: 'gate-corrupt', error: 'gate store unreadable' }`; a run path answers
`{ ok: false, error: 'gate store unreadable' }` with no `code`.

**Cap:** 200 records. Insertion beyond the cap drops the **oldest `updatedAt` whose status is not `approved` and not
`activated`**; if every record is protected, the write is refused (`gate store full`) rather than dropping an approval.
Dropping an approval record would un-gate an automation silently (no record = no gate, by design for the automations
that never went through the gate), which is exactly the hole invariant #1 forbids.

**Corrupt store, fail-closed, and its repair:** an absent `gates.json` is the normal state of today's product — no
record, no gate, everything runs as before. A **present but unparsable** file makes every run path refuse
(`gate store unreadable`) because B3 cannot know which automations carry an approval. The repair is to move the file
aside (`mv gates.json gates.json.broken`), which the private copy makes harmless. This cost is accepted and documented
rather than guessed away.

### 5.3 Bounded projection — what leaves the host

`kbGateBoundedRecord(record)`:

- `staticChecks.findings` — at most **40**, each `{ code ≤ 60, severity, field ≤ 80, message ≤ 300 }`;
- `trial.toolCalls` — at most **200**; `trial.externalEffects` — at most **20**; `trial.errors` — at most **20**, each
  string ≤ 300;
- `trial.outcome.message` ≤ 300; every other string ≤ 200; a missing optional field stays absent (never `null`
  invented);
- the function is total: an unreadable record projects to a minimal, valid shape rather than throwing.

`queue list` returns B4's `items` capped by B4's own `cap` (the queue's `INITIATIVE_MAX`, mirroring `SUGGESTED_MAX`) and
never a field B4 did not put in `InitiativeEntry`. `cap` is answered next to `items` so the page can say "3 of 8" without
importing a constant.

**The `list` projection — B5's UI gate feed (D1).** `{ action: 'list' }` answers `tasks` with a `gate` field on
**every** task: `kbGateBoundedRecord(record)` when a record exists for it, `null` otherwise — present and `null`, never absent,
so a consumer branches once. The gate store is read **once** per list (one `kbGateRead()`), not once per task, and the
projection is the same bounded one the gate actions answer. A corrupt or unreadable store does not fail the list: every
`gate` is `null` and the answer carries `gateStore: 'unreadable'` (§8, row 25) — the Automations page of a person whose gate
file was damaged keeps working, which is regression case 22 restated. No new seam is published. B5 renders the gate panel from `task.gate`; B6 reads `gates.json` beside `tasks.json` (R1) and merges that record with the run
journal and the queue's own answers.

## 6. Transitions (the whole state machine of this batch)

```
            gate-check (0 blocker)           trial-start (human)
  draft ─────────────────────────► static-passed ──────────────────────────────────┐
    │                                    │  trial.outcome = 'open' (a trial runs)  │
    │ gate-check (≥1 blocker)            │                                         │
    ▼                                    │            trial-report                │
static-failed                        (unchanged)   clean + completed ─────────────┤──► awaiting-approval
                                                   dirty or failed ────────────────┤──► trial-done  (approve refuses)
                                                                                   │
                                       approve{decision:'refuse'} ──► refused     │ approve{decision:'grant'}
                                                                                   ▼
                                                                                approved
                                                                                   │ person's toggle on
                                                                                   ▼
                                                                               activated
  any status ─── update (an edit) ──► draft   (staticChecks/trial/approval cleared, rev+1)
  any status ─── an edit, a cloud return or a code toggle that would switch it ON ──► refused (approval required)
  any status ─── delete the automation ──► record removed
```

Rules the implementation must not lose:

- `approve` accepts only `awaiting-approval`, with `trial.sideEffectFree === true`, `trial.outcome.state === 'completed'`,
  `trial.endedAt !== null`, and `rev` equal to the stored one. Anything else is `approval not possible: <reason>`
  (`already granted`, `no proof report`, `the trial had outside effects`, `the trial did not complete`).
- A dirty trial (`sideEffectFree === false`, or `outcome.state === 'failed'`) stays `trial-done` — and `approve` then
  refuses on it. There is no path from a dirty trial to `approved`.
- `trial-start` on a record already `static-failed`, or with no record at all, is refused (`static checks failed`).
- Two `gate-check` in a row are serialized by the store; the second sees the first's `rev`.
- Nothing outside this machine's gate store decides a status: no `tasks.json` field, no `trial.report` in the body, no
  `approval` in the body. The only inputs are the store, B1's verdict, B2's proof, and a human `approve`.
- **A non-granted record every way it could run.** The same predicate stops the person's toggle, `run-now`, `consume-fire`, the
  webhook and the scheduler's own fire (`kbFireTask`, §3.3). Only `trial-start` fires without it, on the masked copy it builds
  and through the internal `{ trial: true }` argument, and that session's writes are denied at runtime in exchange (§7.8).
- **A non-granted record every way it could be switched on.** `update` (whose body defaults `active: true`), `cloud-link`
  (which restores `wasActive`) and `toggle` are all refused when they flip it on; only an authenticated human `toggle` on an
  `approved` record produces `activated`.

## 7. Security guards

1. **Authentication is untouched.** `sameOriginStrict`, `kbTasksAuthorized`, `kbTasksRefused`, `kbTunnelledWrite` and the
   phone line `:11401` are not edited. Every new action is therefore behind same origin + signed cookie, and refused
   `403 refused_on_phone` on the phone link. No widening of the allow-list without the route-origin audit.
2. **A human request is measured, not declared.** `opts.human` comes from the route, after the cookie check, and never
   from the body; the four human-only actions read it through `kbHumanOnly` (§3.1). `approve`, `trial-start` and `queue act`
   require it unconditionally; `toggle` requires it in its activation direction, and only for an automation that carries a
   gate record. An in-process caller (any agent tool) cannot produce it: `approve` from a tool answers
   `not a human request` and writes nothing.
3. **`approve` is the only way to `approved`**, and `approve` grants nothing else: it does not set `active`, it does not
   fire, it does not schedule. Activation stays the person's separate toggle — a toggle that is human-only for a gated
   record and refused outright while the approval is not granted.
4. **No autonomous external side effect.** The batch adds no outbound call of any kind: no network, no webhook, no
   publish, no delete outside `gates.json`/`initiatives.json`. The only process it can start is the trial the person
   asked for, through the existing `kbFireTask`.
5. **`trial-start` forces the mask.** `approvals: 'ask'` and `active: false` are written on a copy of the stored task,
   after the body is ignored for those fields. If the ask preset cannot be applied (`kbFireTask` throws on
   `permissions service unavailable` / `no permission preset asks for approval`), the answer is `mask unavailable` and
   **no gate record is written** — a trial never starts unmasked, and never leaves a half-written proof.
   The trial's `sideEffectFree` post-condition (B2) is what turns a write tool that did run into a failed trial.
6. **Bounded outputs** (§5.3): a journal with 10 000 tool calls cannot make the route answer a megabyte.
7. **Boot safety**: namespace imports + guarded accessors (§3.6); nothing new is registered on a service; the three
   optional modules can be missing and DSH still starts.
8. **Runtime write refusal during a trial (invariant #3, enforced, not judged).** When `trial-start` fires its masked copy,
   `kbFireTask` installs a monotonic guard as soon as the trial's `sessionId` is known and **before** the first prompt:
   `ctx.get('tools').guard(kbTrialWriteGuard(runId))`. The guard returns a denial string only for a call whose
   `execution.agent.session.id` is the trial's `runId` **and** whose tool name carries a `KB_MCP_WRITE_WORDS` word
   (`kbNameWords`, `:776` — the same tokenizer the MCP filter uses, so the two tables never drift): a write-category call is
   denied by the runtime, the tool body never runs, and the model sees a stable English reason. Every other session of the
   machine is untouched, because the comparison is on identity, not on time. The disposer is kept per automation id and
   called the moment the trial ends (a terminal proof in `trial-report`), before a new trial starts, and when the
   automation is deleted. **The guard is preferred, not required.** `tools.guard()` runs after the extensible
   `tools/pre-execute` waterfall and no later seam can force-allow a call another guard denied, so it is the first choice.
   When `ctx.get('tools').guard` is not a function, B3 falls back to the `tools/pre-execute` seam this plugin already
   registers (`ctx.on('tools/pre-execute', …)`, `index.js:2895-2904`, whose `{ kind: 'deny', reason }` answer is the
   engine's own refusal): while a trial runs, a hook installed at `trial-start` denies a call of the trial's session whose
   name carries a write word, with `TRIAL_DENY_REASON` as the reason, and it is removed with the same disposer discipline.
   That fallback is an **accepted degraded path** (R3), not a refusal: both seams produce the same observable — an error
   carrying `TRIAL_DENY_REASON`, which B2's proof reads as `refused-as-write` — so the proof, the gate record and the page
   are identical either way. `trial-start` refuses `write guard unavailable` **only** when neither seam exists (no `guard`
   function **and** no `ctx.on`), and then starts nothing: a trial that cannot be kept read-only is not a trial. B2's
   `sideEffectFree` post-condition stays the general backstop — a write that slips the vocabulary fails the proof.

## 8. Edge cases and failure modes

| # | case | expected |
|---|---|---|
| 1 | no `Origin` / foreign `Origin` / no cookie / forged / expired / other port | 403 / 403 / 401 / 401 / 401 / 401 — unchanged code path |
| 2 | `x-kybernos-tunnel: 1` with any of the six actions | 403 `refused_on_phone`, nothing written |
| 3 | `x-kybernos-tunnel: 1` with `{action:'list'}` | 200, `tasks` without webhook secrets — unchanged |
| 4 | `{"action":"approve","human":true,…}` from the wire, no `rev` | `rev required`; `human` in the body is ignored |
| 5 | `approve` from an agent tool (in-process, `opts` absent) | `not a human request`, store byte-identical |
| 6 | `approve` with a stale `rev` | `{ ok: false, code: 'stale', error: 'stale', gate }`, store unchanged |
| 7 | `approve` twice with the same `rev` | second is `approval not possible: already granted` |
| 8 | `trial-start` twice before a report | second is `a trial is already running` |
| 9 | `trial-start` with no `sessionController` (headless) | `trial needs a live session`, no record written |
| 10 | `trial-start` while the ask preset is unavailable | `mask unavailable`, no record written, task untouched |
| 11 | `trial-report` while the journal is still open | `ok: true`, `report.outcome.state === 'open'`, status unchanged (the page polls) |
| 12 | `trial-report` on a task that never trialled | `no trial to report` |
| 13 | the journal cannot be read | `run unreadable`; the gate keeps its open trial (a retry is possible) |
| 14 | the journal service is absent (`sessionPersistence` undefined, `index.js:2554`) | `run journal unavailable` |
| 15 | a write tool ran in the trial | `sideEffectFree: false`, status `trial-done`, `approve` → `approval not possible: the trial had outside effects` |
| 16 | edit a gated automation while `awaiting-approval` | gate demoted to `draft`, approval `none`, `rev + 1` |
| 17 | delete a gated automation | record removed; `gates.json` still valid JSON |
| 18 | the person's `toggle on` a gated automation without approval | `approval required`; the same call from an in-process agent tool is `not a human request` (the human check comes first) |
| 19 | the person's `toggle on` a gated automation whose re-check now fails | `approval required` (verdict is `fail`) |
| 20 | `toggle off` anything | allowed, always |
| 21 | `run-now` / `consume-fire` / a webhook on an unapproved gated automation | `approval required`, nothing fired |
| 22 | an automation with **no** gate record (today's whole store) | every path behaves exactly as before — the regression that matters most |
| 23 | `runs in the cloud` task | `gate-check`/`trial-start` refused; `toggle` keeps its existing cloud refusal |
| 24 | `gates.json` absent | reads answer `{ ok: false, error: 'gate not found' }` where a record is needed; nothing created by reading |
| 25 | `gates.json` corrupt | gate actions `{ ok: false, code: 'gate-corrupt' }`; run paths `gate store unreadable`; `list` still answers 200 with every `gate: null` and `gateStore: 'unreadable'`; private copy kept; file untouched |
| 26 | `gates.json` at the cap, all approved | new `gate-check` refused `gate store full`, no record dropped |
| 27 | body > 200 000 bytes / not an object / `null` / an array | 413 / 400 / 400 / 400 — unchanged |
| 28 | unknown action, and each new action with a non-string `id` | `unknown action: …` / `id required` |
| 29 | `gate-check` on a `suggested` automation | allowed: a suggestion is a draft, and checking it is the point |
| 30 | two concurrent `gate-check` | serialized: one record, `rev` incremented twice, no lost update |
| 31 | the scheduler tick reaches a gated automation whose approval is not granted | `kbFireTask` answers `{ refused: 'approval required' }`, zero `create`/`prompt`; the tick records it as `skipped`, not `fired` and not `failed`; its history entry carries `{ at, sessionId: null, status: 'skipped', error: 'approval required' }` — **not** `status: 'error'`, so `stableStreak` neither counts it nor breaks; `lastRun` untouched; `nextRun` was already advanced by the claim, so it is retried at its next slot only |
| 32 | a gated record, stored `active: false`, edited with a body that omits `active` (`kbSanitizeTaskInput` defaults it to true) | `approval required`, nothing written — this is the re-activation hole of finding 2, closed |
| 33 | a gated record already active, edited with `active: true` unchanged | allowed: the gate is demoted to `draft`, the automation keeps running until the person pauses it |
| 34 | `cloud-link { cloud: null }` on a gated record whose approval is not granted, `wasActive: true` | `approval required`, nothing written, the link stays as it is |
| 34b | `cloud-link { cloud: {…} }` (publish) on a `static-failed` draft, or any record `mayActivate` refuses | `approval required`, nothing written, no `cloud` field on the task |
| 34c | `cloud-link { cloud: {…} }` on an `approved`/`activated` record, and the return trip after it | `ok: true`; the copy is paused here, then comes back active |
| 34d | `cloud-link` on an automation with no record (the legacy store) | `ok: true`, unchanged behaviour: no record is no gate |
| 34e | `create` any automation | a `gates.json` record `{ status: 'draft', rev: 1, staticChecks: null, trial: null, approval: { state: 'none', at: null } }` exists before the task does, and `toggle { active: true }` on it answers `approval required` |
| 34f | `create` while `gates.json` is corrupt | `gate store unreadable` (or the machine-readable code), no task written |
| 34g | `approve grant` on an `awaiting-approval` record whose proof was typed by hand (no `proofHash`) | `approval not possible: the proof is unverified`, store byte-identical |
| 35 | a write-category tool call from the trial's own session while the trial runs | denied by the installed guard (`KB_MCP_WRITE_WORDS` match on the name), the tool body never runs |
| 36 | the same call from another session of the machine during the trial | untouched: the guard compares the session id with the trial's `runId` |
| 37 | the trial ends with a terminal proof | the guard's disposer is called (`trial-report`), and the next trial installs a fresh one |
| 38 | neither `tools.guard` nor `tools/pre-execute` is available at `trial-start` (a tools service with no `guard` function **and** no `ctx.on`) | `write guard unavailable`, no gate record, no session started |
| 39 | `toggle {active:true}` from an agent tool on an **ungated** automation | allowed, exactly as today (regression case 22 for the toggle) |
| 40 | `trial-start` while the machine is loaded — `allowedAt(capacity.level, capacity.maxParallel) === 0` on the reading `kbLoadCapacity()` returns | `machine busy` (B2's `'machine-busy'` through `kbGateTrialRefusal`), no session created, no gate record written; the person retries when the machine calms down |
| 41 | `tools.guard` absent but `ctx.on` present | the trial starts on the `pre-execute` fallback: a write call of the trial's session is denied with `TRIAL_DENY_REASON`, B2 reads it as `refused-as-write`, and the proof is the same as with the guard — no refusal, no degradation of the verdict |
| 42 | `mayActivate` missing from B2 (a partial install: the module loads, that export does not) | every activation and run path refuses `approval required` — `kbTrialFn('mayActivate')` answers `null`, the adapter treats a non-function as a refusal, so the tooth fails closed instead of un-gating the store; a trial already running is left exactly as it is |

## 9. Explicitly out of scope

- **Any visible surface**: no `client.js`, no `help.json`, no CSS, no i18n key. B5 renders the gate panel; this batch
  only answers JSON.
- `automation-tools.mjs` and its `toolDefinitions` (B4). B3 supplies `deps.initiative` and nothing else.
- `automation-gate.mjs` (B1), `automation-trial.mjs` (B2), `initiative-queue.mjs` (B4): read-only imports. A needed
  export that is missing is a **stop and re-cadrage**, never a local reimplementation.
- `packages/kybernos-pulse/*` (B6) and the inbox/banner behaviour.
- A new route (`webServerSvc.register`), a new npm dependency, an engine patch (zero new engine patches — plugin seams only).
- Any change to the four auth helpers, to the phone line `:11401`, or to `scripts/test-tunnel-routes.mjs`
  (its table entry for `/kybernos/tasks` is keyed on `{ action: 'list' }` and stays exactly as it is).
- The scheduler's design: no new timer, no automatic trial, no cron. The only change on that path is the tooth inside
  `kbFireTask` and the `skipped` accounting in the existing tick (D9). `trial-report` never relaunches anything.
- `accept`: untouched. Add is `acceptedTask` and keeps the automation switched off (`automation-suggest.mjs:29-30`), so
  there is no activation to gate there; the inventory of closed paths to read is §1 (cadrage risk 1 corrected in R4).
- Cloud publication itself (`automation-published.mjs`, the cloud plugin's routes): untouched. The only edit on this side of
  the link is the re-activation guard on `cloud-link` (§3.3).
- Migrating existing automations into the gate: an automation with no record stays ungated, by design, so the batch
  cannot brick a person's current automations.
- `activated` from anywhere but the person's `toggle`.

## 10. File-by-file change plan

All in `packages/kybernos-plugin/`. §10.1 is the only production file; §10.2 is new.

### 10.1 `index.js`

| # | anchor (pre-edit) | change | ~lines |
|---|---|---|---|
| 1 | after `:28` `import { mountAutomationTools }` | the three namespace imports (§3.6) + the three guarded accessors, right below the imports | +18 |
| 2 | between `:825` `// KB-TASKS-CORE-END` and `:828` `// KB-KYBER-YAML-BEGIN` | new marked **pure** block `// KB-GATE-STORE-BEGIN` … `// KB-GATE-STORE-END`: `kbHumanOnly`, `kbGateIdOf`, `kbGateValidRecord`, `kbGateEmptyRecord`, `kbGateNext`, `kbGateCanApprove`, `kbGateActivationRefusal` (the one-line adapter over an **injected** predicate, §4.1), `kbGateTrialRefusal` (B2 code → wire string, §3.2), `kbGateBoundedRecord`, `kbGateAttach`, `kbGateDemoteAfterEdit`, `kbGateInsert`, `kbGateRemoveOf`, `kbGateParse`, `kbMakeGateStore` (no import, no `fs`, no `Date.now()` inside — `now` injected; extractable by `data:` URL like `KB-TASKS-CORE`, see `test-automation-occurrences.mjs:9-13`) | +190 |
| 3 | after `:2677` `const kbTaskId = …` | `kbGateFileOf()` (next to `kbTasksFileOf`), `kbGateStore = kbMakeGateStore({ read, write, keepCopy })`, `kbGateRead()` reading every record once, `kbGateMutate(fn)`, and the async **`kbGateRunRefusalTask(task)`** (the store-backed half of the tooth, §3.3) — outside the pure block, since it touches the file | +52 |
| 4 | `:3181` `const kbTasksHandle = async (body) => {` | signature + `human` (§3.1) | +3 |
| 5 | `:3183-3185` `if (action === 'list')` | one `kbGateRead()`, then `kbGateAttach(tasks, records)` (§5.3); an unreadable store answers `gate: null` everywhere plus `gateStore: 'unreadable'` | +10 |
| 6 | `:3261` inside `update` | the demotion when `updated !== null`, plus the active-flip guard before the task is written (§3.3) | +10 |
| 7 | `:3926-3962` inside `cloud-link` | refuse BOTH the publish and the return-to-active of a record whose approval is not granted (+4 for the publish half) | +10 |
| 8 | `:3336-3339` inside `toggle` | the human check (`kbHumanOnly('toggle', …)`) and the gate tooth (before `kbComputeNextRun`), plus the activation: after the task write succeeds, mark the gate `activated` when the record was `approved` | +24 |
| 9 | `:3355-3361` inside `delete` | remove the gate record when `removed === true`, and dispose a trial guard still held for that automation | +6 |
| 10 | `:3391` in `run-now` | the gate tooth | +3 |
| 11 | `:3457-3475` `consume-fire` | read the task first, refuse on the gate tooth | +8 |
| 12 | `:3476` before the final `unknown action` return | the six actions (§3.2), in one commented section `// ── The certification gate and the initiative queue (B3) ──`; `trial-start` reads `capacity` from `kbLoadCapacity()`, hands it to `startTrial`, and maps every refusal code through `kbGateTrialRefusal` (§3.2) | +235 |
| 13 | `:2978` start of `kbFireTask` | the internal second argument (`fire`), the tooth (`kbGateRunRefusalTask` → `{ refused }`) before any session is created, and the trial write guard installed right after `sessionId` is resolved and before `sc.prompt` (§7.8) — the `guard` when the tools service has one, the `pre-execute` hook otherwise — its disposer kept in a module-level map keyed by automation id | +32 |
| 14 | `index.js:613-614` in the `kbMakeTrigger` tick (re-measured: the `await withTimeout(… fire(…))` line and the `results.push({ id: claim.id, ok: true, res })` below it) | a refused fire is pushed as `{ id, ok: false, skipped: res.refused }` — neither `fired` nor `failed` — and the history write at `:630-633` gains its own branch so the entry is `{ at, sessionId: null, status: 'skipped', error: res.refused }`, never `status: 'error'` (R6) | +7 |
| 15 | `:3592-3597` suggestions ledger + `mountAutomationTools` | `kbInitiatives()` lazy maker (the `kbSugg` pattern, §3.5) + `initiative` (singular) in the deps object | +14 |
| 16 | `:11403` `const answer = await kbTasksHandle(body)` | `await kbTasksHandle(body, { human: true, via: 'http' })` | 1 |
| 17 | `~:12050-12058` the hooks route's fire | the gate tooth before `kbFireTask`, answering 403 `approval required` | +4 |

Edit order, strictly descending line number so no anchor moves under the cursor:
17 → 16 → 15 → 12 → 11 → 10 → 9 → 8 → 7 → 6 → 5 → 4 → 13 → 3 → 2 → 14 → 1, then `node --check`.

New code and comments in English. No personal path may appear in the file: the gate path is derived from
`kbTasksFileOf()`'s directory, exactly like `tasks.json`'s (both start at `dshHome()`).

### 10.2 `test-automation-gate-routes.mjs` (new)

The executable strategy of `docs/tests/host-gate-and-queue-routes-strategy.md`: the pure-block unit cases, the
route-level refusals, and the full certified journey. Roughly 400 lines, no dependency, exit 0/1, discovered by
`scripts/run-all-tests.mjs` (it matches `packages/*/test*.mjs`).

## 11. Testability seams (why this is testable at all)

- The pure block is **marked**, so a test imports it through a `data:` URL with **no** engine context
  (`KB-TASKS-CORE`, `KB-PINS-CORE`, `KB-FEEDBACK-CORE` are the precedents).
- The route is driven with a fake `ctx` (the `scripts/test-tasks-route.mjs` harness) and, for the real HTTP fences, a
  loopback listener with `lib-session-test.mjs`'s cookie (the `test-write-guard.mjs` harness). Both harnesses exist and
  are green today; no new harness is invented.
- The human seam is testable in-process: call `mod.apply(ctx)` with a `tools` service that records the registered
  tool definitions, execute the tool's `execute(args, exec)` and observe `not a human request`.
- The `list` projection is a pure function of two inputs (`kbGateAttach(tasks, records)`), so it is unit-tested without a
  route; the route test then asserts the same field on the wire.
- The activation adapter takes its predicate as an argument (§4.1), so a unit case drives it with a stub that answers
  `true`, then `false`, then with `null` (the missing-export case); the same case greps the extracted block for the
  ladder's tokens (`staticChecks`, `approval.state`) inside that function and must find none.
- The trial write guard is testable with no engine: the fake `tools` service records the guard function and its disposer,
  and the test calls the recorded function with a fake execution `{ name, agent: { session: { id } } }` — denial for a
  write name in the trial session, `undefined` for a read name and for any other session, and the disposer observed once
  at the end of the trial. The `pre-execute` fallback is testable the same way: a fake `ctx` whose `on` records handlers,
  and the recorded handler called with `(exec, next)`. A third fake with neither seam proves the `write guard unavailable`
  refusal.
- The fire tooth needs neither the scheduler timer nor a session: `kbFireTask` is driven directly with a fake
  `sessionController` that records `create`/`prompt`, and the tick's `skipped` accounting is read from a trigger built on a
  fake store.
- `checkDraft`/`trialFromEvents`/`makeInitiativeQueue` come from other batches: the route test uses their real
  implementations once they land (wave order: B1/B2/B4 before B3), and the source assertion on the namespace imports
  keeps the boot-safety property visible even before they do.

## 12. Risks and rollback

| risk | mitigation in this spec |
|---|---|
| Gate bypass by an existing run path | `kbGateRunRefusalTask` on `toggle`/`run-now`/`consume-fire`/webhook **and inside `kbFireTask`**, which covers the scheduler's own tick; all five proven by a test that fires the real handler or the real function |
| Gate bypass by a re-activation | the same tooth on the `update` active flip (the sanitizer's `active: true` default is the hole), on BOTH `cloud-link` directions (publish included), and on a code-issued `toggle`; `create` seeds a `draft` record so a new automation is gated from birth; `activated` is written only by a human toggle |
| A model reaching `approve` | `opts.human` from the route, absent for tools; tested twice (reverse: the body's `human` is inert) |
| Trial with side effects | mask forced, `mask unavailable` instead of an unmasked start, a `tools.guard` that denies write-category calls of the trial session (the `pre-execute` denial as its accepted fallback, same reason string), `write guard unavailable` only when both seams are absent, `sideEffectFree` post-condition, `approve` refuses a dirty trial |
| A trial started on a loaded machine | `capacity` from `kbLoadCapacity()` handed to `startTrial`; a full machine answers `machine busy` and starts no session |
| Two activation rules drifting apart | `mayActivate` (B2) is the only predicate; B3's `kbGateActivationRefusal` is a one-line adapter fed with it (§4.1), so a rule change lands in `automation-trial.mjs` only — the unit case that stubs the predicate fails if a ladder reappears in `index.js` |
| A guard that denies the whole machine | the guard compares the calling session with the trial's `runId`; every other session is untouched, asserted by the same unit case that proves the denial |
| Origin-rule regression | no line of the auth fence touched, six actions × the four refusals proven |
| Shape drift across waves | the three frozen shapes are read, never extended; every signature in §4 is the other batch's verbatim; a needed change stops the batch |
| Broken install (missing module) | namespace imports + guarded accessors, asserted at source level |
| The page loses its list because the gate file is damaged | `list` answers 200 with `gate: null` and `gateStore: 'unreadable'`, never a 500 |
| Store growth | one record per automation, deleted with it, hard cap 200 with protected statuses |
| Rollback | one file + one new test: `git revert` of the single commit leaves `gates.json`/`initiatives.json` on disk, which the previous code never reads (harmless leftovers). |
