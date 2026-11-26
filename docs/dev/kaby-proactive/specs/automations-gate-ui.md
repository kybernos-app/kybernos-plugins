# Spec B5 — `automations-gate-ui` (Automations page: gate panel, proof, approval, initiatives)

Batch B5 of `dev-team` Lot 1, spec phase, 2026-10-28. Branch `feature/kaby-proactive-lot1`.
Inputs: `docs/dev/kaby-proactive/cartographie.md` (mapping + anchors) and
`docs/dev/kaby-proactive/cadrage.md` (frozen shapes, hard invariants, batch boundary).
This document is the contract for the implementation delegation. No code at this stage.

**Sole owner of `packages/kybernos-plugin/client.js`.** No other batch writes that file; this
batch writes no other host file. The one UI surface of pillar (A) and (B).

## 1. Goal

Give the Automations page the visible half of the certification gate and of the initiative queue:

1. a **gate panel** on one automation that makes its gate state readable at a glance and offers the
   certification steps in order (`Review` → `Approve`/`Refuse` → `Activate`);
2. the **proof display** of a supervised trial (what was called, what was refused, whether anything
   left the machine);
3. **activation as a two-step human gesture, never a default**: the existing on/off switch can only
   flip an automation on once a human approval is recorded, and the UI can only *ask* for that
   approval — it cannot grant it to itself;
4. **initiative cards**: the bounded queue of Kaby's proposals, each card a draft/ask, none of them
   able to fire anything;
5. **every label translated** through `KB_T` (French twin + English), no hardcoded prose.

The page keeps its three existing views (List, Columns/Calendar, Cards), its three detail tabs
(Workflow · Sessions · Where) and its suggested-automations card unchanged. The gate panel and the
initiative cards are **added** to that frame, not a redesign of it.

## 2. Invariants carried by this batch, and exactly where each is enforced

| # | Invariant | Where this batch enforces it |
|---|---|---|
| 1 | Activation requires explicit human approval | `kbGateToggleIntent(rec, task)` returns `'activate'` **only** when `approval.state === 'granted'` and `status ∈ {approved, activated}`. Every other case returns `'review'`. The switch, the card switch and the detail switch all call that function first. `approve` is only ever sent from a click on `gate-approve`, never on mount, never on a poll, never twice. |
| 2 | An automation never sends, publishes, deletes or pays on its own | Every action of the panel and of a card is a **draft or an ask**: `gate-check`, `trial-start`, `approve`, `queue act` — nothing that reaches the outside world. The panel renders `externalEffects` and marks a non-empty list as a failure of the trial in red; `kbGateCanApprove` returns `false` when `sideEffectFree !== true`. |
| 3 | Trial runs are supervised and side-effect-free | The trial is launched by one explicit button (`gate-trial-start`), disabled while one is running (single-flight), and the panel never claims "side-effect free" before a `ProofReport` exists: `kbProofOf(rec).sideEffectFree` is `null` when `trial === null`. |
| 4 | Write sets are disjoint | Exactly the four entries of § 11, and nothing else: `client.js`, `packages/kybernos-plugin/test-automation-gate-client.mjs`, `scripts/check-gate-panel-live.mjs`, `docs/dev/kaby-proactive/maquettes/automations-gate/` (both script and folder ratified by D5, findings 23). `index.js` is read, never written; `automation-gate.mjs`, `automation-trial.mjs`, `initiative-queue.mjs` are imported by nobody in the client (a browser bundle cannot import a host module) — the client **re-displays** their output and never recomputes a verdict. |

Two consequences worth stating as rules of the file:

- **The client never decides the gate.** It has no cron parser, no timezone check, no prompt scan.
  It copies `staticChecks.verdict` and `status` from the record the host sends. The only local
  derivations are presentation (order, tone, caps, the next step) and the toggle intent. A source
  test asserts this (§ 9).
- **The UI is not the enforcement point, B3 is.** If a host refuses `toggle` with an approval
  reason, the page shows the refusal text in a toast and opens the review panel; it never retries
  and never falls back to a permissive local path.

## 3. API surface consumed (B3's route, `/kybernos/tasks`, same envelope as today)

All calls go through `host.call('kybers/tasks', body)` — the existing page helper — so the signed
session cookie and the origin header are the browser's, and the phone-tunnel fence
(`kbTasksRefused`, `403 refused_on_phone`) applies unchanged. **No new route, no new module, no
`fetch` of our own.** A batch that needs a new route stops here and re-cadrages.

### 3.1 Read: the gate rides on the existing list

```ts
// POST { action: 'list' }  → unchanged, plus ONE optional field per task
interface Task { …; gate?: GateRecord }   // GateRecord is cadrage's frozen shape
```

**The read path is settled by D1, and this batch confirms it works: the list, and only the
list.** B3 attaches `kbGateBoundedRecord(task)` to every task of the existing `{action:'list'}`
answer; the page reads `task.gate` out of the payload it already polls (15 s) and from nowhere else
— no new seam subscribed, no file read, no second `fetch` of our own. Three consequences this batch
asserts rather than assumes:

1. the field really rides the answer the page already requests (a real `list` response is parsed in
   J1, before any badge is read), so no separate "gate fetch" is ever written;
2. a gate written by another tab, a CLI or a chat appears at the next poll with no extra route —
   that is the whole point of D1 over a dedicated seam;
3. `kbGateOf` is fed raw list tasks in the harness, never a hand-built gate object: the fixture of
   the unit case is the shape `list` sends.

- `task.gate` absent → the page shows the panel as `unknown` ("this host does not check
  automations yet") and the switch keeps its current behaviour. Safe, because B3 refuses the flip
  server-side; the UI never pretends to have checked anything.
- `task.gate` present but malformed (`status` not in the frozen union, `approval` not an object,
  `staticChecks` not an object) → `kbGateOf` returns `{ known: false, status: 'unknown' }`. No throw.

### 3.2 Actions

The dialect is **B3's, verbatim** (`host-gate-and-queue-routes.md` § 3.2): this batch consumes that
table and extends nothing. Every answer uses B3's envelope, `{ ok: boolean, … }`, and a refusal is
`{ ok: false, error: '<machine string>' }`.

| action | body | answer |
|---|---|---|
| `list` (existing, one field added) | `{}` | `{ ok: true, tasks }`, each task carrying `gate` |
| `gate-check` | `{ id }` | `{ ok: true, gate }` |
| `trial-start` | `{ id }` | `{ ok: true, gate, runId }` |
| `trial-report` | `{ id }` | `{ ok: true, gate, report }` — `report` is B2's `proof`, `null` before a trial |
| `approve` | `{ id, decision: 'grant' \| 'refuse', rev }` | `{ ok: true, gate }` |
| `queue list` | `{}` | `{ ok: true, items, cap }` |
| `queue act` | `{ id, status: 'asked' \| 'added' \| 'dropped' }` | `{ ok: true, item }` |

`gate` in every answer is B3's bounded projection, never a raw stored record. Pinned details, each of
which a test asserts:

- `approve` carries **three** non-optional fields and the client chooses none of them: `decision` is
  exactly `'grant'` or `'refuse'` (no default, no `auto`, no `'granted'`/`'refused'`, no omission — a
  body without it is a bug the client never produces, through `act('approve', id, { decision, rev })`);
  `rev` is the `rev` of the record the person is looking at, copied from the `gate` of the last
  `list`/`approve` answer and never invented; `id` is the automation.
- B3's refusals this batch branches on, verbatim: `decision must be grant or refuse` and `rev required`
  (a malformed body), `stale` (another tab wrote the record; the answer carries the fresh `gate` and the
  panel re-renders from it instead of re-sending the old revision), `approval required` (a gated
  automation switched on without a granted approval), `a trial is already running`, `no trial to
  report`.
- `approve`'s answer carries the gate only, no `task`: the task is refreshed by the next `list` (D1,
  § 3.1). Nothing is patched locally from an `approve` answer.
- `trial-report` takes **`id` only** and answers `report` (`ProofReport|null`). The poller sends that
  same body every 2 s, so a page reload mid-trial still finds the proof (the running flag is local state
  and is deliberately not persisted). The stop condition reads `report`: polling stops when
  `report !== null && report.outcome.state !== 'open'`, or at the 30-call bound. There is no top-level
  `state` on the wire and the client never expects one.
- `queue list` answers `{ ok: true, items, cap }`, never a bare list: `cap` rides the same envelope so
  the block says "full" without importing B4's module, and `items` is the only name of that array.
- `queue act` carries B4's vocabulary: `status`, one of `asked`, `added`, `dropped`, and answers
  `{ ok: true, item }`. This batch sends `asked` (`initiative-ask`) and `dropped` (`initiative-drop`)
  and never `added`: an initiative becomes `added` only when the person really created the automation in
  a chat (B4's `resolve`), which this batch does not call.
- An unknown action answers `{ ok: false, error: 'unknown action: …' }` (B3's shape). The client maps it
  to `unavailable`, never to a red banner.

### 3.3 Interface request to the sibling batches (blocking integration, not blocking this spec)

- **B3**: `task.gate` on `list` (D1: `kbGateBoundedRecord(task)` attached to every task of the answer);
  the six new actions of § 3.2 in B3's dialect — `approve { id, decision, rev }`,
  `trial-report { id }` → `{ ok, gate, report }`, `queue list` → `{ ok, items, cap }`,
  `queue act { id, status }` → `{ ok, item }`; `toggle active:true` on a gated automation refuses
  unless `approval.state === 'granted'` and answers `{ ok: false, error: 'approval required' }`
  otherwise (the client shows that exact string through `kbGateError`, mapped to
  `tasks.gate.err.approval`).
- **B2**: `ProofReport` as frozen, with `sideEffectFree` computed (never `true` by default) and
  `toolCalls[].outcome` one of `ok|error|refused-as-write`; that object is what `trial-report` returns
  as `report`.
- **B4**: `queue list` bounded to `cap` (≤ 8) and `items` already scrubbed by `hasPersonalData`.
- **B1**: nothing at runtime — the panel displays what B3 stored.

## 4. Data shapes

The three frozen shapes (GateRecord, ProofReport, InitiativeEntry) are used **verbatim** — see
`cadrage.md` § "Shared data shapes". This batch adds only client-side **views**, pure data, no
classes, no functions:

```ts
// kbGateOf(task)
interface GateView {
  known: boolean;             // false when the host sent nothing usable
  status: 'draft'|'static-failed'|'static-passed'|'trial-done'|'awaiting-approval'|'approved'|'refused'|'activated'|'unknown';
  verdict: 'pass'|'fail'|null;
  findings: GateFinding[];    // as sent, unbounded; kbGateFindings bounds them
  trial: ProofReport|null;
  approval: { state: 'none'|'asked'|'granted'|'refused'; at: string|null };
  rev: number|null;           // the record's revision, sent back verbatim in every `approve` body
  updatedAt: string|null;
}

// kbGateSteps(gateView)
interface GateSteps {
  steps: { id: 'review'|'approve'|'activate'; done: boolean; blocked: boolean }[];
  next: 'review'|'approve'|'activate'|null;   // null = nothing to ask (activated, or unknown)
}

// kbGateFindings(gateView)
interface FindingsView { rows: { severity: 'blocker'|'warn'|'info'; code: string; field: string; message: string }[]; hidden: number; blockers: number }

// kbProofOf(gateView)   (KB-AUTORUNS block, it formats durations)
interface ProofView {
  present: boolean;
  sideEffectFree: true|false|null;   // null when there is no trial: never claimed
  startedAt: string|null; endedAt: string|null; durationMs: number|null;
  outcome: { state: 'completed'|'failed'|'open'|null; code: string; message: string };
  toolRows: { toolName: string; access: 'read'|'write'; outcome: 'ok'|'error'|'refused-as-write' }[];
  toolHidden: number; refused: number;
  effects: string[]; effectsHidden: number;
  errors: { at: string; where: string; message: string }[]; errorsHidden: number;
}

// kbInitView(items, cap)
interface InitiativeView {
  cap: number;
  items: { id: string; title: string; evidence: { n: number; span: string; where: string }; risk: 'low'|'medium'|'high'; reversibility: 'trivial'|'easy'|'hard'; nextAction: { kind: string; summary: string }; status: 'proposed'|'asked'|'added'|'dropped'; usable: boolean }[];
  hidden: number;      // items beyond `cap`, counted, not drawn
  skipped: number;     // items with no draft next action: drawn with a warn, never actionable
}
```

Bounds (constants, asserted by the unit test):

```
KB_GATE_FINDINGS_MAX = 20   KB_GATE_MSG_MAX = 160   KB_GATE_TOOLS_MAX = 8
KB_GATE_EFFECTS_MAX  = 5    KB_GATE_ERRORS_MAX = 3  KB_INIT_MAX = 8   KB_INIT_VISIBLE = 3
```

## 5. Pure surface (the only exported behaviour of the client)

Inserted **inside the two existing blocks** — no new `KB-*-BEGIN` block, so `test-automation-board.mjs`
and `test-automation-runs-client.mjs` keep extracting what they extract (their name lists are
explicit, so added consts are compatible).

### KB-AUTOBOARD (`client.js:7132` … `7406`), appended before `// KB-AUTOBOARD-END`

```js
const KB_GATE_STATUSES = ['draft','static-failed','static-passed','trial-done','awaiting-approval','approved','refused','activated']
const KB_GATE_FINDINGS_MAX = 20, KB_GATE_MSG_MAX = 160
const KB_INIT_MAX = 8, KB_INIT_VISIBLE = 3
const kbGateOf = (task) => GateView
const kbGateTone = (status) => 'ok'|'warn'|'bad'|'idle'      // activated/approved → ok; awaiting-approval AND trial-done → warn; static-failed/refused → bad; draft/static-passed/unknown → idle
const kbGateSteps = (rec) => GateSteps
const kbGateCanApprove = (rec) => boolean                     // awaiting-approval + trial present + sideEffectFree === true + not already granted + a numeric rev
const kbGateCanActivate = (rec) => boolean                    // approval granted + status approved
const kbGateCanRefuse = (rec) => boolean                      // known, not activated, not already refused
const kbGateToggleIntent = (rec, task) => 'activate'|'deactivate'|'review'
const kbGateFindings = (rec) => FindingsView
const kbGateBadge = (rec) => ''|'tasks.gate.badge.awaiting'|'tasks.gate.badge.failed'|'tasks.gate.badge.refused'  // the FULL KB_T key, never a suffix: no key is ever built by concatenation
const kbGateError = (message) => 'unknown-action'|'approval'|'not-found'|'signin'|'phone'|'other'
const kbInitView = (items, cap) => InitiativeView
```

Rules the unit test pins (this is where invariant #1 becomes executable):

- `kbGateToggleIntent`: `'activate'` iff `approval.state === 'granted' && (status === 'approved' || status === 'activated')`; `'deactivate'` iff `task.active !== false`; `'review'` otherwise (including `known === false`).
- `kbGateCanApprove`: `false` for every status but `awaiting-approval`; `false` when `trial === null`; `false` when `trial.sideEffectFree !== true`; `false` when `approval.state === 'granted'`.
- `kbGateCanRefuse`: `true` for every known status but `activated` and `refused` — a person can always say no to a draft that failed or awaits a decision, and never "refuses" something already on or already refused.
- `rev`: `kbGateOf` copies it only when it is a finite number and `null` otherwise, and every `approve`
  body is `{ decision, rev }` with the `rev` of the record **currently rendered** (never one captured at
  mount). `kbGateCanApprove` and `kbGateCanRefuse` both return `false` when `rev === null`, so the panel
  never sends a body B3 answers with `rev required`. A `stale` refusal (`kbGateError` maps it to
  `other`, so the toast is `tasks.gate.err.other`) re-renders the panel from the fresh `gate` the answer
  carries and never re-sends the old revision.
- `kbGateSteps().next` is never `'activate'` unless `approval.state === 'granted'`; `null` when
  `status === 'activated'` or `known === false`; `'approve'` for `awaiting-approval`; `'activate'`
  for `approved` with a granted approval; **`'review'` for every other frozen status, `refused`
  included** — a refused record is not a dead end, it goes back through the checks (frozen decision:
  `refused` → `'review'`, and `kbGateCanRefuse` is `false` on it, so the ladder never offers a second
  refusal). `steps[1].blocked` is `true` whenever `approval.state !== 'granted'`.
- `kbGateTone`: `activated` and `approved` → `'ok'`; `awaiting-approval` **and `trial-done`** →
  `'warn'` (a trial finished and a person is expected: the chip warns, it never celebrates);
  `static-failed` and `refused` → `'bad'`; `draft`, `static-passed` and `unknown` → `'idle'`. This is
  the single table: the unit contract repeats it word for word, so `trial-done` cannot drift back to
  `'idle'` on one side only (the tone-drift finding).
- `kbGateBadge` returns the **whole** `KB_T` key, never a suffix: `'tasks.gate.badge.awaiting'` for
  `awaiting-approval`, `'tasks.gate.badge.failed'` for `static-failed`, `'tasks.gate.badge.refused'`
  for `refused`, `''` for the other six statuses. The three keys are enumerated literally in `KB_T`
  (§ 7) and in the badge rule of the unit contract, so a call site writes
  `h('span', {'data-kb-i18n': key}, kbt(key))` with `key = kbGateBadge(rec)` and no `+` to join a
  prefix and a suffix anywhere (a suffix concatenated into a key would violate the
  no-concatenation rule of § 7 on the very line that applies it).
- **`'unknown'` is a view value, never a persisted status.** It belongs to `GateView.status` only:
  it is absent from `KB_GATE_STATUSES` (the frozen union B3 stores), no action body built by this
  batch can carry it, and `kbGateOf` produces it locally when the host sent nothing usable. The
  panel tags it `data-known="false"` (`data-known="true"` for every frozen status), so the live pass
  and the unit harness can tell "this host checks nothing" from "this record is stored as unknown",
  and the guard fails loudly if the string ever reaches an `act(` body or a record write.
- `kbGateFindings`: sorts blocker → warn → info (stable within a severity), caps at 20, truncates `message` to 160 with an ellipsis, strips control characters, keeps `field` as sent (max 60 chars), and counts **blockers over all findings, not only the 20 drawn**.
- `kbGateOf`: never throws on `null`, `[]`, `'x'`, `{gate:null}`, `{gate:{status:'pizza'}}`.
- `kbInitView`: caps at `cap` (default 8) with `hidden` counting the rest, marks `usable: false` when `nextAction.kind !== 'draft'`, counts those in `skipped`, drops items that are not objects or have no `id`.

### KB-AUTORUNS (`client.js:7408` … `7628`), appended before `// KB-AUTORUNS-END`

```js
const KB_GATE_TOOLS_MAX = 8, KB_GATE_EFFECTS_MAX = 5, KB_GATE_ERRORS_MAX = 3
const kbProofOf = (rec) => ProofView
```

- `sideEffectFree` is `null` — never `true` — when `rec.trial === null` or the field is not a boolean.
- `durationMs` comes from `startedAt`/`endedAt` when both parse; `kbRunFmtDur` renders it.
- `refused` counts `outcome === 'refused-as-write'` over **all** calls (not only the 8 drawn).
- `effects` are trimmed to 120 chars each; `effectsHidden`/`errorsHidden`/`toolHidden` add up what was clipped.

## 6. UI surface

### 6.1 Where things sit (no new tab, no redesigned frame)

| Surface | Hook | Anchor |
|---|---|---|
| Gate badge on a List row, next to the state cell | `data-kb="gate-badge"` | row loop, `client.js:23225` area |
| Gate badge on a Cards-view card | `data-kb="gate-badge"` | `KbAutoCards`, `client.js:21169` (badges div) |
| Gate panel in the detail view: one collapsed strip, expanded on demand, **above** the tablist so it is visible on all three tabs | `data-kb="gate-panel"` | inserted between `client.js:23119` and `23120` |
| Initiative cards, section `yours`, right under the suggested card | `data-kb="initiative-block"` | inserted at `client.js:23214`, immediately after `sugEl` |

Collapsed strip shows: the status label (`tasks.gate.st.*` + `tasks.gate.hint.*`), the next step
(`kbGateSteps().next`) as a button, and — when a blocker exists — the count from
`kbGateFindings().blockers`. Expanded shows `kbGateFindings().rows` (with the "n more" line), the
trial button, `kbProofOf()` rendered by `KbProofBlock`, then the decision buttons gated by
`kbGateCanApprove`. The badges of the List and of the Cards call `kbGateBadge(rec)` for the **full**
`KB_T` key (nothing is drawn when it returns `''`) and `kbGateTone(rec)` for the tone class
(`kbgate-badge ok|warn|bad|idle`). `KbInitiativeCards` renders `kbInitView(items, cap)`.
Default expansion: **expanded** when `status ∈ {static-failed, awaiting-approval}`, collapsed
otherwise, and the person's toggle wins for the session (local state, not persisted).

### 6.2 The two-step gesture, concretely

1. `gate-review` ("Review the checks") expands the panel. No call.
2. `gate-check` — offered when `status ∈ {draft, static-failed, static-passed, refused}`, disabled while a
   call is in flight, never offered once a decision is pending (`awaiting-approval`, `approved`,
   `activated`): a verdict must not change under an approval nobody re-took. It is a request to B1
   through B3, never a local computation.
3. `gate-trial-start` (only when `verdict === 'pass'` and no trial running) → `trial-start`, then
   `trial-report { id }` every 2 s, at most 30 calls, stopped when `report !== null &&
   report.outcome.state !== 'open'`, on unmount, and on `document.hidden`.
4. `gate-approve` / `gate-refuse` — enabled only through `kbGateCanApprove` / `kbGateCanRefuse` — send
   `approve` with an explicit `decision` (`'grant'` / `'refuse'`) and the record's `rev`. `gate-refuse`
   goes through the existing `KbConfirm` ("Refuse this automation? It stays off and runs nothing.").
5. The switches (`client.js:23111` detail, `23239` list, `21166` card) call
   `kbGateToggleIntent` **first**. `'review'` → expand the panel + toast `tasks.gate.activate.gated`
   and **no host call**. `'activate'`/`'deactivate'` → the existing `act('toggle', …)`.

Never: an `approve` on mount, a `toggle` from a timer, an auto-expanded approval, an `autoFocus` on
`gate-approve`, a "remember my approval" checkbox.

### 6.3 Initiative cards

Read `queue list` once on mount and after any human act (never faster than 30 s). Draw at most 3
cards, then "show all (n)" up to `cap`; each card: title, evidence line, risk chip, reversibility,
next-action summary, and two buttons — `initiative-ask` (`queue act { id, status: 'asked' }`, then a
prefilled chat through `kbStartChatText`, the same way `editInChat` does it) and `initiative-drop`
(`queue act { id, status: 'dropped' }`, no confirm, like the suggested block's Discard). A card whose
`nextAction.kind !== 'draft'` renders a warn chip and **no button**. Empty queue → one line
(`tasks.init.empty`), never an empty frame. `queue list` answering `unknown action` → the block is
not drawn at all.

### 6.4 Hooks the live pass needs (`data-kb` and `data-*`), fixed by this spec

The live check drives the page by these attributes only (never by visible text, which changes with
the language). A missing hook is a spec violation, not a test detail.

```
[data-kb="gate-panel"]        data-open="true|false"  data-status="draft|static-failed|static-passed|trial-done|awaiting-approval|approved|refused|activated|unknown"  data-known="true|false"
[data-kb="gate-badge"]        data-kb-i18n="tasks.gate.badge.awaiting|tasks.gate.badge.failed|tasks.gate.badge.refused"  data-tone="ok|warn|bad|idle"
[data-kb="gate-step-review"]  [data-kb="gate-step-approve"]  [data-kb="gate-step-activate"]   (the ladder, aria-current on `next`)
[data-kb="gate-review"]       [data-kb="gate-check"]  [data-kb="gate-trial-start"]
[data-kb="gate-approve"]      [data-kb="gate-refuse"]                    (buttons, `disabled` when the guard says no)
[data-kb="gate-finding"]      data-severity="blocker|warn|info"
[data-kb="gate-findings-more"][data-kb="gate-proof"]   data-state="none|running|done"  data-sideeffect="true|false|unknown"
[data-kb="gate-proof-tool"]   data-access="read|write"  data-outcome="ok|error|refused-as-write"
[data-kb="initiative-block"]  [data-kb="initiative-card"] data-id data-usable="true|false"
[data-kb="initiative-ask"]    [data-kb="initiative-drop"]  [data-kb="initiative-more"]
```

`data-status` is the **widened** type, not `<GateStatus>`: nine values — the eight frozen statuses plus
`unknown` — because the hook must still be taggable when no usable record exists. Typing it as the
frozen union would leave the degradation state, the one the live pass has to read, unrepresentable.
`data-known="false"` is written **only** together with `data-status="unknown"`, and `data-known="true"`
for every frozen status: the retag hook that makes the § 5 guard (a host that checks nothing is a view
value, never a stored status) readable to the live pass and to the unit harness. `data-kb-i18n` on a
badge carries one of the three enumerated keys — never a composed `tasks.gate.badge.` prefix.

Every element that carries a translated label also carries `data-kb-i18n="<key>"`, so the live pass
compares `textContent` with `window.__KB_T__[key][lang]` in the language the GUI is already in —
no language switch, no persisted preference.


### 6.5 CSS

New rules `kbgate-*` appended in the page's CSS template right after the suggested-automations
block's rules (`client.js:31350`–`31360`, the dashed card and its own fold), plus the same
`@media (max-width:640px)` fold for the panel and the initiative cards: the sibling block already
folds at 640 px, so the new surfaces fold at the same width — a homogeneity criterion the test
measures, not a taste. Rules:

- **tokens only**: `var(--dsw-alias-border-l1|l2)`, `--dsw-alias-bg-layer-1|2|3`,
  `--dsw-alias-label-primary|secondary|tertiary`, `--dsw-alias-brand-primary`,
  `--dsw-alias-state-success-primary`, `--dsw-alias-state-warn-primary`,
  `--dsw-alias-state-error-primary`, `--dsw-alias-interactive-bg-hover`. No hex, no `rgb(`.
- **geometry borrowed from the host panel template**: radius 16 for the block / 12 for inner rows,
  padding `12px 16px` like `.kba-sugrow`, font sizes 11.5 / 12.5 / 13 like `.kbcc-badge` / `.kba-btn`
  / `.kba-rowbtn`, chips `border-radius:999px` with `1px solid var(--dsw-alias-border-l2)`.
  This is the homogeneity argument, measured in the test strategy, not asserted by eye.

## 7. i18n table (`KB_T`, the `tasks.*` block starting `client.js:88`)

Every visible string of this batch is one of these keys, French twin + English, inserted next to
`'tasks.sug.title'` (`client.js:477`). No literal prose anywhere in the new region. In the list below,
a line that continues with short names keeps the prefix of its first key (`err.approval` on the
`tasks.gate.err.*` line is `tasks.gate.err.approval`).

```
tasks.gate.st.draft / static-failed / static-passed / trial-done / awaiting-approval / approved / refused / activated / unknown   (9)
tasks.gate.hint.static-failed / awaiting-approval / approved / refused / unknown                                                  (5)
tasks.gate.panel.title, tasks.gate.panel.intro, tasks.gate.review, tasks.gate.collapse                                             (4)
tasks.gate.check, tasks.gate.checking, tasks.gate.checked.at, tasks.gate.checked.never                                              (4)
tasks.gate.findings.title, tasks.gate.findings.none, tasks.gate.findings.more, tasks.gate.severity.blocker/warn/info                (6)
tasks.gate.trial.title, tasks.gate.trial.start, tasks.gate.trial.running, tasks.gate.trial.none, tasks.gate.trial.done             (5)
tasks.gate.trial.supervised, tasks.gate.trial.blocked                                                                              (2)
tasks.gate.approve, tasks.gate.refuse, tasks.gate.approve.hint, tasks.gate.refuse.title, tasks.gate.refuse.body                    (5)
tasks.gate.approved.toast, tasks.gate.refused.toast, tasks.gate.activate.gated, tasks.gate.unavailable                             (4)
tasks.gate.badge.awaiting, tasks.gate.badge.failed, tasks.gate.badge.refused                                                       (3)
tasks.gate.err.unknown-action, err.approval, err.not-found, err.signin, err.phone, err.other                                       (6)
tasks.proof.title, tasks.proof.sideeffect.ok/bad/unknown                                                                           (4)
tasks.proof.tools.title, tasks.proof.tools.none, tasks.proof.access.read/write, tasks.proof.outcome.ok/failed/open/refused         (8)
tasks.proof.effects.title, tasks.proof.effects.none, tasks.proof.effects.more, tasks.proof.errors.title, tasks.proof.errors.more   (5)
tasks.proof.refused, tasks.proof.duration                                                                                          (2)
tasks.init.title, tasks.init.intro, tasks.init.empty, tasks.init.unavailable                                                        (4)
tasks.init.evidence, tasks.init.ask, tasks.init.drop, tasks.init.asked, tasks.init.dropped, tasks.init.more, tasks.init.showless   (7)
tasks.init.risk.low/medium/high, tasks.init.rev.trivial/easy/hard, tasks.init.status.proposed/asked/added/dropped                  (10)
tasks.init.notdraft                                                                                                                (1)
```

94 keys. Each is a `{ kybernos: '…', en: '…' }` row on **one line** (the test harness parses the
table line by line). `{n}`, `{when}`, `{d}`, `{span}`, `{where}` are the placeholders; the
`kbt(key).replace('{x}', …)` form is the house style and no key may be built by concatenation. The
three badge keys of § 5 (`tasks.gate.badge.awaiting`, `tasks.gate.badge.failed`,
`tasks.gate.badge.refused`) are the only keys a function hands over whole; no call site prefixes
them. The i18n DoD of `docs/tests/automations-gate-ui-strategy.md` enumerates **all 94** literally,
in the `'key':` row form, and exits 1 on the first one missing (and on an array that no longer holds
94 entries), so the count is asserted by a command, not recited here.

Every label element carries `data-kb-i18n="<key>"` so the live check can compare the rendered text
with the live table (`window.__KB_T__`), in whichever language the GUI is in, without switching the
language (see the test strategy).

## 8. Edge cases and failure modes

| Case | Behaviour |
|---|---|
| Host without the gate (no `task.gate`, `unknown action`) | panel `unknown` + `tasks.gate.unavailable`, no button but `Review` (disabled), switch behaves as today; initiative block not drawn |
| Host refuses (401 / 403 `refused_on_phone` / `approval required`) | toast with the mapped message, panel expanded, nothing retried, no optimistic UI: the state comes back from the next `list` |
| Network drop during `approve` | the button re-enables after the rejection, toast `tasks.gate.err.other`, the record is unchanged until a `list` says otherwise |
| Two tabs open (double instance) | `approve` from tab B changes the record; tab A's next `list` (15 s) shows the new status. No cross-tab lock is invented; no local write |
| Trial starts, page reloaded | the running flag is lost, the panel shows the record (`static-passed`); one `trial-report { id }` on the next expansion finds the proof |
| Trial already running (host side) | `trial-start` answers `{ok:false,error:'a trial is already running'}` → toast `tasks.gate.err.other` and the button stays disabled until the next report |
| 30 findings, 12 tool calls, 9 effects | 20 / 8 / 5 drawn, the rest counted ("n more"), blockers counted over all |
| Task with `history: []` and a `gate` | the panel is independent of runs: it still shows the record |
| A suggestion row (`suggested: true`) | no gate badge, no switch: suggestions are invisible to the gate (they never run); `suggested-add` is the only way in |
| Cloud automation (`task.cloud` set) | no gate badge, no panel actions: the gate is local, and the panel says `tasks.gate.unavailable` (a cloud automation is not gated by this host) |
| `activated` but `task.active === false` (switched off after approval) | badge `''`, panel shows `activated` with the switch off; `kbGateToggleIntent` returns `'activate'` (approval still granted) — switching back on needs no second approval |
| Empty list of automations | unchanged onboarding, and no gate panel (no automation is open); the initiative block still draws above it, because an initiative proposes a *new* automation |
| 480 px width | panel folds: status and next step on one line, findings wrapping, buttons full width, no horizontal overflow |

## 9. Security guards, and the source assertions that keep them

1. **Human approval before activation** — `kbGateToggleIntent` is the only door to `toggle active:true`; assert the region contains no other `active: true` literal bound to a host call.
2. **No autonomous external side effect** — the `<kbgate-ui>` region holds no `fetch(`, no `window.open`, no `navigator.clipboard`, no `setInterval` other than the bounded trial poll; every I/O goes through props callbacks the page passes (`props.call`, `props.refresh`, `props.toast`).
3. **Nothing fires on mount** — the region holds no `useEffect` that calls `props.call`; assert `useEffect` occurrences in the region contain no `'approve'`, `'toggle'`, `'gate-check'` or `'trial-start'`.
4. **No secret in the panel** — the gate panel never reads `task.trigger`, `hookId` or `secret` (the webhook address stays in the Workflow tab's own panel).
5. **Bounded outputs** — the `*_MAX` constants are the only caps; assert `slice(0, KB_GATE_FINDINGS_MAX)` etc. appear, and that no host string is rendered with `dangerouslySetInnerHTML` (the file has none; assert the region adds none).
6. **Text only** — every `findings[].message`, `effects[]`, `errors[].message` and initiative field goes through `h('span', …, value)` — never through a template string that builds markup.
7. **i18n** — no French prose, no English prose inline: the region's only strings are `data-kb` hooks, `className`s, and `kbt('…')` calls. `node scripts/test-no-french-literals.mjs` must stay green (it treats `kybernos-plugin` as an *unaccented* bundle: an accented French literal would fail).

## 10. Explicitly OUT of scope

- The checks themselves (B1), the trial machine and proof building (B2), the routes and the storage
  (B3), the queue ledger and its tools (B4), the pulse notifications (B6).
- Any new host route, any new `webServerSvc.register`, any engine patch.
- A fourth detail tab, a redesign of the workflow canvas, the List/Columns/Calendar/Cards views,
  the suggested-automations card, the Team tab.
- Editing prompts, schedules or approvals from the gate panel (the existing scheduler modal and the
  `approvals` chips keep that job).
- Creating an initiative from the UI, or turning an initiative into an automation anywhere but in a
  chat (the card opens a prefilled chat, nothing more).
- `help.json` (a gate page in the `?` panel belongs to a later doc batch), `shared-ui.css`, any new
  CSS file, any `docs/` file besides this spec and the test strategy.
- Language switching, theme switching, RTL.

## 11. File-by-file change plan

| File | Kind | What changes, with anchors |
|---|---|---|
| `packages/kybernos-plugin/client.js` | edit (exclusive) | (a) **KB_T**: +94 rows inserted after `477  'tasks.sug.title'`; (b) **KB-AUTOBOARD**: the gate/initiative pure functions appended before `7406  // KB-AUTOBOARD-END`; (c) **KB-AUTORUNS**: `kbProofOf` + its caps appended before `7628  // KB-AUTORUNS-END`; (d) **new region** `// <kbgate-ui>` … `// </kbgate-ui>` holding `KbGatePanel`, `KbProofBlock` and `KbInitiativeCards` as module-level components, inserted before `21183  const kbBoardBones = (rows) =>`; (e) **page wiring**: state pairs, `gateAct`/`initAct`, the trial poll, next to `22763  const act = async (action, id, extra)`; (f) **detail view**: badge in the header `23102`–`23119`, panel between `23119` and `23120`, switches at `23111` routed through `kbGateToggleIntent`; (g) **list**: badge in `23225`'s state cell, switch at `23239`; (h) **cards**: badge at `21169`, switch at `21166` (via the `onToggle` prop, now `onSwitch`); (i) **initiatives**: `h(KbInitiativeCards, …)` inserted at `23214`; (j) **CSS**: `kbgate-*` block after `31360` |
| `packages/kybernos-plugin/test-automation-gate-client.mjs` | new | The unit harness: extracts `KB-AUTOBOARD` and `KB-AUTORUNS` (house pattern of `test-automation-runs-client.mjs:11-16`), parses `KB_T` line by line, extracts the `<kbgate-ui>` region, and runs the cases of the test strategy. Joins `scripts/run-all-tests.mjs` automatically (`packages/*/test*.mjs`, cwd = the bundle folder): nothing to register |
| `scripts/check-gate-panel-live.mjs` | new — write set, **ratified by D5** | The replayable live pass, on the pattern of `check-suggested-live.mjs` and `check-automations-board-live.mjs`: sandbox only (exit 3 against `:3080`), real host routes, seeded `tasks.json` restored afterwards, `--shots <dir>`, exit 0/1/3. A live check must live in `scripts/` (116 existing ones do; none lives inside a bundle) and `run-all-tests` does not discover it. Collision-free: no other batch creates that name |
| `docs/dev/kaby-proactive/maquettes/automations-gate/` | new — write set, **ratified by D5** | The interactive maquette (`index.html`, `tokens.css`, `cadrage.md`, `regard.md`, `README.md`, `verifier.mjs`), text only. PNG captures are written outside the repository: `scripts/garde-depot.mjs` refuses tracked media (`MEDIA = /\.(png\|jpe?g\|…)$/`, its pipes escaped for the table cell) |

Those two entries are **part of the write set, not an exception to it**: D5 ratifies both (finding
23), so the batch owns four entries — one host file, one test file, one live check in `scripts/`,
one text-only maquette folder — and the disjointness claim of § 2 is exact rather than "client.js
plus whatever the test needs".

Nothing else. `index.js`, `automation-gate.mjs`, `initiative-queue.mjs`, `automation-runs.mjs`,
`help.json`, `shared-ui.css`, `scripts/i18n-french-allow.json` are read-only for this batch.

## 12. Definition of done

The executable form is `docs/tests/automations-gate-ui-strategy.md`. In one sentence: the unit
harness proves the invariant in code (`'activate'` is unreachable without a recorded approval), the
i18n DoD is a `node -e` command that enumerates the 94 keys literally and exits 1 on the first one
missing, plus a second command run after the French audit that fails when a gate label still renders
English on `View · Automations`, the live pass proves the read path (D1: `task.gate` on the `list`
answer) and the gesture on a real GUI with disk verification and one capture per state (one of them
dark) read with
`read_image`, the maquette proves the visual intent at DSH's real CSS before the code is written, and
`node scripts/run-all-tests.mjs` stays at 0 red.
