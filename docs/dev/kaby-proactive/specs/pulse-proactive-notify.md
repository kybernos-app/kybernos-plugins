# Spec — `pulse-proactive-notify` (B6)

Batch id: `pulse-proactive-notify`. Pillar (C) of Lot 1 — *Pulse inbox/banners for finished / failed /
action-required, fed by run + gate + queue events*. Sole owner of `packages/kybernos-pulse/*`.

- Branch: `feature/kaby-proactive-lot1`, worktree `kybernos-plugins-proactive`.
- Stage: **spec only**. This document is the contract for the implementation delegation; no code is
  written here.
- Inputs: `docs/dev/kaby-proactive/cartographie.md` (mapping + anchors), `docs/dev/kaby-proactive/cadrage.md`
  (frozen shapes, hard invariants), and the files named in §1.
- Write set (the only files the implementation may touch): `pulse-core.mjs`, `pulse-host.mjs`,
  `index.js`, `client.js`, `test-core.mjs` and `README.md` — all under `packages/kybernos-pulse/`
  (six files: the five code and test files plus the package's own `README.md`, whose four-line
  update is part of the batch — lead decision R5).
  **No new file in the package** (a new file would force a `package.json` export and a lifecycle
  change; `scripts/lifecycle-packages.json` and `scripts/test-paquet.mjs` stay untouched), no
  `plugin.json`, no `help.json` (see §12).

## 1. The code this batch extends (measured anchors)

| File | Anchor | What is there today |
|---|---|---|
| `pulse-core.mjs` | `:12` | `LEVELS = ['need','every','never']` |
| | `:15` | `INBOX_MAX = 100` |
| | `:89` | `readRun(events)` — the journal verdict of one session |
| | `:119` | `if (asked.size > 0) return { phase: 'waiting', … }` |
| | `:126` | `candidates(tasks, nowMs)` — runs worth looking at |
| | `:147` | `const KINDS = ['done','failed','waiting']` + `TONE` at `:148` |
| | `:151` | `cleanItem(raw)` — the only door into the inbox |
| | `:166` | the optional-field loop (`durMs`, `calls`, `tool`, `message`, `code`) |
| | `:173` | `inboxPut` / `inboxRemove` |
| | `:177` | `isQuiet(item, settings)` — only `done`, only by `task` name |
| | `:180` | `wantsBanner(item, settings)` |
| | `:187` | `bannersDue` / `unreadCount` |
| | `:192` | `emptyState()` / `normalizeState(raw)` at `:194` |
| | `:211` | `itemFor(c, run, nowMs)` — how a session becomes an item |
| | `:226` | `watchStep({ tasks, state, readRunOf, now })` — the pass |
| | `:255`–`:257` | end of the pass: `baselined = true`, `seen` pruning, return |
| | `:262` | `publicView({ settings, state, running, now })` |
| | `:276` | `inboxAction(inbox, body)` — read / read-all / dismiss / banner-shown |
| `pulse-host.mjs` | `:14` | `normalizeData` (one file: `{ version, settings, state }`) |
| | `:19` | `createPulse({ read, write, now })` |
| | `:66` | `createWatcher({ pulse, readTasks, readRunOf, now, log })` |
| | `:75` | `const result = await watchStep({ tasks, state, readRunOf, now: now() })` |
| | `:96` | `hostOk` / `originOk` at `:105` |
| | `:155` | `mountRoutes(webServer, pulse, guard, opts)` |
| | `:167` | `GET /kybernos-pulse/state` |
| | `:188`–`:189` | `POST /settings`, `POST /inbox` |
| `index.js` | `:18` | `PASS_MS = 15000` |
| | `:20`–`:21` | `stateFile`, `tasksFile` (`<DSH home>/kybernos/…`) |
| | `:73` | `readTasksFile(home)` — tolerant, `[]` on anything odd |
| | `:78` | `readRunFrom(getPersistence)` — the journal reader |
| | `:92` | `apply(ctx)` — one try/catch, routes inside `mount`'s own try/catch at `:103` |
| | `:96`–`:98` | `createPulse` then `createWatcher` |
| | `:111`–`:118` | the timer (`setTimeout 3000`, then `PASS_MS`) |
| `client.js` | `:30`–`:207` | the `PANEL-CORE` block (pure: shared with the Mac panel page) |
| | `:42`, `:49` | `kt(fr, en)` / `kn(fr, en, vars)` — the only place French may live |
| | `:73` | `itemText(it)` → `{ title, sub }` (asserted verbatim by `test-client.mjs:89-94`) |
| | `:109`, `:115`, `:117` | `panelHTML` → `card(it)` → the `<article class="kbpu-card …">` |
| | `:148`–`:205` | `PANEL_CSS` (DSH tokens only) |
| | `:541` | `__test` (the pure parts, exposed to the tests) |
| `test-core.mjs` | `:4`–`:7` | the import list from `pulse-core.mjs` |
| | `:185` | last line (`pass` checks summary) — new sections go **before** it |

Read-only, never edited here: `packages/kybernos-plugin/automation-runs.mjs` (`scrub` at `:31`,
`summarizeRun` at `:83`, the `outcome` line at `:190`, `approvals` at `:205`), `suggestions.mjs`,
`automation-suggest.mjs` (`SUGGESTED_MAX = 8` at `:7`), `panel-page.mjs`, `helper/`, `session-guard.mjs`.

## 2. Goal (what a person gets)

The Widget (Pulse) already tells the person when a **scheduled run** finished, failed or waits for an
approval. After this batch it also tells them, in the same inbox, the same floating window, the same
Mac panel and the same banners:

1. an automation draft **failed its static checks** (the gate said no) — *failed*;
2. a **supervised trial failed**, or its proof shows an **external effect** — *failed*;
3. a **supervised trial produced its proof report** and passed with no external effect — *done*, with
   the verdict in the card (it **reports**, it never relaunches);
4. the gate **waits for the person's approval**, or was **approved and still has to be switched on** —
   *action required* (never quiet, never auto-approved);
5. an **initiative is ready as a draft** (the queue prepared something, nothing was sent) — *action
   required*.

The mapping uses the three existing kinds and their existing tones: **`done` / `failed` / `waiting`**
(`ok` / `bad` / `ask`). No fourth kind, no new notification channel, no new setting.

## 3. Where the facts come from

Today, one feed: `tasks.json` (which runs exist) + the engine's session journal (how a run stands).
The batch adds **two bounded file reads** — the gate store B3 owns, `gates.json` beside `tasks.json`,
and the initiative ledger B4 owns, `initiatives.json` beside it — and changes nothing about the
journal. `tasks.json` keeps one role here: the display name of an automation.

### 3.1 The two new feeds, one contract each

The gate store and the initiative ledger belong to other batches (B3 writes the gates, B4 the
queue). This bundle **only reads** them, through exactly three doors, per pass:

| # | Source | Shape it may return | Cost |
|---|---|---|---|
| 1 | the engine's session journal (`readRun`, unchanged) | today's verdict | ≤ 20 journal opens, unchanged |
| 2 | `<DSH home>/kybernos/gates.json` — B3's gate store, beside `tasks.json` (`host-gate-and-queue-routes.md:320`, `:323`; lead decision R1) | `{ version, records: GateRecord[] }`, or a bare `GateRecord[]` | one bounded read per pass |
| 3 | `<DSH home>/kybernos/initiatives.json` — B4's ledger, the file the `queue list` action serves | `InitiativeEntry[]` or `{ entries: InitiativeEntry[] }` | one bounded read per pass |

Rules that make this safe:

- **No seam.** The two `globalThis[Symbol.for(...)]` seams of the first draft are **gone**: B3
  publishes no seam and B4 exports nothing else (`host-gate-and-queue-routes.md:209`,
  `initiative-queue.md:292`), so reading them would read a promise nobody keeps. Nothing in this
  bundle touches `globalThis`.
- **No invented path, and no wire answer.** The `kybernos/automations/` folder of the first draft is
  gone: both files sit **beside `tasks.json`**, in the directory `kbTasksFileOf` resolves
  (`index.js:2616`) — the gate store `gates.json` (`host-gate-and-queue-routes.md:320`, `:323`) and
  the queue ledger `initiatives.json` (`initiative-queue.md:283`, `:291`). Pulse reads the **store**,
  not the `{ action: 'list' }` answer: the `gate` field B3 projects onto that answer exists for B5's
  panel (lead decision R1), and a bundle that never calls `list` must not claim to read it.
- **Read at call time, never captured at load.** Same reason as
  `packages/kybernos-memory/team-space.mjs:6-11`: bundles load in any order and the person can
  switch things on in any order.
- **Merge, never pick.** Records from every available door are merged and de-duplicated by
  identity (`automationId` for a gate, `id` for an entry); on a duplicate the highest `rev` wins
  (gate) or the first one seen wins (entry — entries carry no rev).
- **Absent is normal.** No `gates.json`, no ledger ⇒ `{ gates: [], entries: [] }`, one log line at
  most, no error, no item. The feature degrades to exactly today's behaviour.
- **A read that throws is not a failed pass.** Every door is caught on its own, and the journal
  half of the pass runs whatever the two files do.

### 3.1.1 The gate feed on disk (B3's store, in one shape)

B3 writes the gate records to `<DSH home>/kybernos/gates.json`, in the envelope
`{ "version": 1, "records": GateRecord[] }` (`host-gate-and-queue-routes.md:320`), and that file —
not `tasks.json` — is what the pass reads:

```json
{ "version": 1,
  "records": [
    { "id": "gate:a1", "automationId": "a1", "status": "awaiting-approval",
      "staticChecks": { "ranAt": "2026-10-28T00:03:00.000Z", "verdict": "pass", "findings": [] },
      "trial": null, "approval": { "state": "asked", "at": null },
      "updatedAt": "2026-10-28T00:03:00.000Z", "rev": 4 }] }
```

A bare `GateRecord[]` is accepted too, because the reader is tolerant by contract. A missing or
unparsable file is `[]` with one log line, never a throw. A record that is not an object, or that
carries no `automationId`, is skipped. The automation's display name comes from the `tasks.json`
list the pass already reads for its run names (`task.id === record.automationId`); unknown name ⇒
`'Automation'`. The ledger's shape is the frozen `InitiativeEntry[]` of the cadrage, with no wrapper
required.

### 3.2 Shapes — frozen by the cadrage, not redefined here

`GateRecord`, `GateFinding`, `ProofReport` and `InitiativeEntry` are used **exactly as cadrage
§"Shared data shapes" writes them**. This batch adds no field to them and tolerates every field it
does not read. The only extra field it reads is the optional `rev` ordering key, already in the
shape.

## 4. Data shapes this batch owns (the pulse ones)

### 4.1 Inbox item — one additive field

`cleanItem` (`pulse-core.mjs:151`) gains exactly one optional field:

```js
source: 'scheduler' | 'gate' | 'queue'   // default 'scheduler' when absent — every stored item keeps its meaning
```

Everything else keeps its current bound and its current default. The optional-field loop at `:166`
grows the constants used by the new producers, not new free-form fields:

| Field | Producer | Bound |
|---|---|---|
| `id` | `g:<automationId>` (gate), `q:<entryId>` (queue), `r:`/`w:` (scheduler) | 120 (unchanged) |
| `task` | automation name, matched by `automationId` in the `tasks.json` list the pass already reads; the entry `title` for an initiative | 80 (unchanged) |
| `taskId` | `automationId` / `entry.id` | 80 (unchanged) |
| `code` | the stable vocabulary of §4.2 | 60 (unchanged) |
| `message` | one bounded data line (English, like the engine's own `turn/end` message already shown today) | 200 (unchanged) |
| `at` | `Date.parse(record.updatedAt \|\| entry.at)`, clamped to `now` | number (unchanged) |
| `source` | `'gate'` / `'queue'` | 9 chars (new) |

`tone` and `todo` stay **derived from `kind`** (`TONE` at `:148`, `todo: r.kind !== 'done'` at `:158`):
no producer sets them, so a new producer cannot invent a tone.

### 4.2 The code vocabulary (stable, machine-readable, translated by the client)

| `code` | kind | where it comes from |
|---|---|---|
| `gate.static.failed` | `failed` | `staticChecks.verdict === 'fail'` |
| `gate.trial.failed` | `failed` | `trial.outcome.state === 'failed'` |
| `gate.trial.effects` | `failed` | `trial.sideEffectFree === false` |
| `gate.awaiting-approval` | `waiting` | `status === 'awaiting-approval'` |
| `gate.approved` | `waiting` | `status === 'approved'` (approval granted, **activation is still the person's gesture**) |
| `gate.trial.passed` | `done` | `status === 'trial-done'` and `sideEffectFree === true` |
| `gate.activated` | `done` | `status === 'activated'` |
| `queue.draft` | `waiting` | `status === 'proposed'` or `'asked'` |

Nothing else produces an item. `draft`, `static-passed`, `refused` produce **no item**: they are
working states of the Automations page, not news for the inbox.

### 4.3 The gate → item table (first match wins, in this order)

| Test on the `GateRecord` | kind | code | message (bounded, English) |
|---|---|---|---|
| `staticChecks.verdict === 'fail'` | failed | `gate.static.failed` | the first `blocker` finding's `message`, else `n blockers` |
| `trial.outcome.state === 'failed'` | failed | `gate.trial.failed` | `trial.outcome.message \|\| trial.outcome.code` |
| `trial.sideEffectFree === false` | failed | `gate.trial.effects` | `The trial reached something outside: <first externalEffects>` |
| `status === 'awaiting-approval'` | waiting | `gate.awaiting-approval` | `A supervised trial passed; your approval is due` |
| `status === 'approved'` | waiting | `gate.approved` | `Approved; switching it on in Automations is still yours` |
| `status === 'trial-done'` | done | `gate.trial.passed` | `Supervised trial passed, no external effect · N calls` |
| `status === 'activated'` | done | `gate.activated` | `Switched on` |
| anything else | — | — | **no item** |

Order matters and is a decision: a trial that touched the outside is reported as **failed even when
the record also says `awaiting-approval`**. The inbox reports the proof, it never softens it.

### 4.4 The queue → item table

| `InitiativeEntry.status` | kind | code | message |
|---|---|---|---|
| `proposed` | waiting | `queue.draft` | `nextAction.summary` + ` (risk: <risk> · undo: <reversibility>)` |
| `asked` | waiting | `queue.draft` | same |
| `added`, `dropped` | — | — | **no item**, and an existing `q:<id>` is removed |

### 4.5 Watcher state — two new maps, backwards compatible

```js
state = {
  baselined: false,                                     // unchanged
  seen:     { [sessionId]: { phase, at } },             // unchanged
  gates:    { [automationId]: { sig, at } },            // new — { sig: 'waiting|gate.approved', at } bounded 60
  queue:    { [entryId]:      { sig, at } },            // new
  inbox:    [ …item ]                                   // unchanged, still ≤ INBOX_MAX
}
```

- `sig` (not `kind`) is what decides "already announced": `kind + '|' + code`. Without it, a record
  moving `awaiting-approval → approved` (both `waiting`) would keep the stale card.
- `normalizeState` (`:194`) cleans the two maps exactly as it cleans `seen`: key length and charset,
  `sig` bounded, `at` finite, entries over `SEEN_MAX` dropped oldest-first. A file written by the
  previous version loads unchanged (both maps absent ⇒ `{}`), and a file written by this version
  loads in the previous version (unknown keys ignored) — **no migration, no `SETTINGS_VERSION` bump**.
- The file shape stays `{ version, settings, state }` (`pulse-host.mjs:14`) — one extra key at most.

## 5. API surface (exact)

### 5.1 `packages/kybernos-pulse/pulse-core.mjs` — new pure exports

```js
/** Feed names of an inbox item. 'scheduler' when absent (items stored before this batch). */
export const SOURCES = ['scheduler', 'gate', 'queue']

/** The gate store B3 owns, beside tasks.json: Pulse reads this file, never `task.gate`. */
export const GATE_FILE = 'gates.json'

/** Bounds this batch adds. INBOX_MAX (100) is unchanged and still the last word. */
export const GATE_ITEMS_PER_PASS  = 40    // records turned into items per pass
export const QUEUE_ITEMS_PER_PASS = 8     // = SUGGESTED_MAX of automation-suggest.mjs
export const SEEN_MAX             = 300   // ids remembered in state.seen + state.gates + state.queue together
export const PROACTIVE_FILE_MAX   = 1024 * 1024  // a feed file over this (gates.json, the ledger) is not parsed

/** text → the same text with long tokens and mail addresses blanked, one line, bounded (local copy of the idea in automation-runs.mjs scrub; bundles never import each other). */
export const scrubText = (v, max) => string

/** The signal of one GateRecord: null (nothing to say) or { kind, code, message }. Pure, no clock. */
export const gateSignal = (record) => null | { kind: 'done' | 'failed' | 'waiting', code: string, message: string }

/**
 * One inbox item from one GateRecord, or null when the record says nothing the person must act on.
 * `name` is the automation's display name (from tasks.json); 'Automation' when unknown.
 */
export const gateItemFor = (record, now, name) => item | null

/** One inbox item from one InitiativeEntry, or null. `task` is the entry title. */
export const queueItemFor = (entry, now) => item | null

/**
 * The gate/queue half of a pass: folds the records into the state, follows the first-pass rule (§7),
 * returns what moved. Mutates and returns the state it is given (same style as the session loop).
 */
export const proactiveStep = ({ state, gates, entries, now }) => ({ state, added, removed })

/** `{ [automationId]: name }` from the tasks the pass already reads for its run names: a gate
 *  card's title then costs no extra read. Pure. */
export const taskNames = (tasks) => object
```

`watchStep` — **signature-compatible, additive only**:

```js
export const watchStep = async ({ tasks, state, readRunOf, now, gates = [], entries = [] }) => ({
  state, running, added, removed
})
```

- No parameter is renamed, retyped or made required; no return key is renamed. `removed` is a new
  additive key (`[]` for callers that ignore it). Every existing call site —
  `pulse-host.mjs:75` and the whole of `test-core.mjs` — keeps its behaviour bit for bit when
  `gates` / `entries` are absent, and the old-signature regression test compares a **projection**
  of the new return (`{ state, running, added }`) against today's fixture: no stored fixture ever
  carries `removed` (finding 29 of `porte-spec.md`).
- Order inside one pass: sessions first, then gate records, then queue entries. Because `inboxPut`
  prepends, an action-required item ends up at the head of the inbox and therefore survives a full
  `INBOX_MAX` — an intentional choice: the cap may drop a result, not an ask.
- The pass never throws for a bad record: `gateItemFor` / `queueItemFor` return `null`, and
  `proactiveStep` skips it.

`cleanItem`, `inboxPut`, `inboxRemove`, `isQuiet`, `wantsBanner`, `bannersDue`, `unreadCount`,
`publicView`, `inboxAction`, `readRun`, `candidates`, `normalizeSettings`, `applySettings`,
`defaults`, `SETTINGS_VERSION` — **unchanged public behaviour**. `cleanItem` and `normalizeState` are
extended (one field, two maps) but every existing assertion in `test-core.mjs` must still pass
verbatim.

### 5.2 `packages/kybernos-pulse/pulse-host.mjs` — one optional reader

```js
export function createWatcher ({ pulse, readTasks, readRunOf, now = () => Date.now(), log = () => {}, readProactive = null })
```

- `readProactive()` takes no argument: the two paths are derived from the DSH home by `index.js`
  (like `tasksFile`), so the watcher stays a pure driver. It resolves to
  `{ gates: [], entries: [] }` (or `null`, treated as empty). Called **once per tick**, in its own
  `try/catch`; a throw is logged once and the pass still runs the session half (a broken gate store
  or ledger must not stop run notifications).
- `createPulse`, `mountRoutes`, `hostOk`, `originOk`, `helperTokenOk`, `HELPER_TOKEN_HEADER`,
  `HELPER_FRESH_MS`, `HELPER_HEADER_RE` — unchanged.

### 5.3 `packages/kybernos-pulse/index.js` — the real I/O

```js
/** The gate store B3 owns: beside tasks.json (host-gate-and-queue-routes.md:320, :279). */
export const gatesFile = (home) => join(home, 'kybernos', 'gates.json')

/** The initiative ledger B4 owns: beside tasks.json (initiative-queue.md:291). */
export const entriesFile = (home) => join(home, 'kybernos', 'initiatives.json')

/** The gate records, parsed when the file is under PROACTIVE_FILE_MAX: `records` (or the bare array), else []; never a throw. */
export const readGatesFile = (home) => async () => GateRecord[]

/** The ledger, parsed when it is a file under PROACTIVE_FILE_MAX: entries or [], never a throw. */
export const readEntriesFile = (home) => async () => InitiativeEntry[]

export const readProactiveFrom = (home) => async () => ({ gates, entries })
```

`readProactiveFrom` implements §3.1 and nothing else: `gates` from `gatesFile(home)`
(`readGatesFile`), `entries` from `entriesFile(home)` (`readEntriesFile`), each read in its own
`try/catch`, both parses bounded by `PROACTIVE_FILE_MAX`, never throwing. There is **no seam read
and no read of `task.gate`**: the store is the feed, the `list` projection belongs to B5 (R1).
`apply` (`:92`) gains exactly one argument on the `createWatcher` call at `:98`; the timer at
`:111`–`:118`, the route mounting at `:103`–`:110` and the outer `try/catch` at `:94`/`:119` are
untouched.

### 5.4 `packages/kybernos-pulse/client.js` — the cards (inside `PANEL-CORE`, `:30`–`:207`)

One pure table and one branch in `itemText` (`:73`), nothing else:

```js
// The sentence of a code, or null: the card keeps its current wording when the code is unknown.
const CODE_TEXT = {
  'gate.static.failed':      () => kt('Les contrôles statiques ont échoué', 'The static checks failed'),
  'gate.trial.failed':       () => kt('L’essai supervisé a échoué', 'The supervised trial failed'),
  'gate.trial.effects':      () => kt('L’essai a touché quelque chose à l’extérieur', 'The trial reached outside something'),
  'gate.awaiting-approval':  () => kt('Essai réussi : ton accord est attendu', 'Trial passed: your approval is due'),
  'gate.approved':           () => kt('Validée : à toi de la mettre en route', 'Approved: switching it on is yours'),
  'gate.trial.passed':       () => kt('Essai supervisé réussi, sans effet extérieur', 'Supervised trial passed, no external effect'),
  'gate.activated':          () => kt('Mise en route', 'Switched on'),
  'queue.draft':             () => kt('Un brouillon t’attend, rien n’a été envoyé', 'A draft waits for you, nothing was sent')
}
```

`itemText` rules after the change (all inside the block, no DOM, no fetch):

| case | title | sub |
|---|---|---|
| `code === 'queue.draft'` | the entry title, as-is (`it.task`) | `CODE_TEXT` sentence + ` · ` + `it.message` |
| any other known `code` | unchanged (kind-driven) | `CODE_TEXT` sentence, then the existing sub appended when it exists (` · N calls · 2 m 10 s`) |
| no `code`, or a code not in the table | unchanged | unchanged (`it.message \|\| …`) — including the engine's own failure code, exactly as `test-client.mjs:91` asserts |

`panelHTML`'s card (`:117`) gains one attribute, `data-src="<source>"`, so a capture and a DOM probe
can tell the three feeds apart. `PANEL_CSS` (`:148`) may gain at most two rules, both on existing
tokens, e.g. `.kbpu-card[data-src="gate"],.kbpu-card[data-src="queue"]{border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.1))}`.
`__test` (`:541`) gains `CODE_TEXT` and `itemText`. **No new icon, no new tab, no new button, no new
fetch.**

### 5.5 Routes — unchanged, and that is a decision

| Route | Behaviour after the batch |
|---|---|
| `GET  /kybernos-pulse/state` | same fields; `inbox[]` items may carry `source` (additive, the client already spreads) |
| `POST /kybernos-pulse/settings` | **identical** — no new key, `SETTINGS_VERSION` stays `1`, `applySettings` untouched |
| `POST /kybernos-pulse/inbox` | **identical four actions** (`read`, `read-all`, `dismiss`, `banner-shown`); an `approve`/`activate` body is still refused (`inboxAction` returns `null`) |
| `GET  /kybernos-pulse/panel` | same page; it draws the new cards because it is built from the same pure block |
| *new route* | **none.** No route added ⇒ `docs/dev/route-origin-rule.md` needs no edit, the origin audit and the `scripts/plugin-scan` route list stay as they are |

### 5.6 Agent-facing tool schemas

**None.** This batch registers no tool, no prompt chunk, no MCP surface: the inbox is for the person,
not for the model. `initiative record` / `initiative list` belong to B4
(`automation-tools.mjs`), the gate actions to B3 (`/kybernos/tasks`). An empty tool surface is the
invariant, not an omission.

## 6. Settings, levels, mute

`SETTINGS_VERSION = 1`, `LEVELS`, `normalizeSettings`, `applySettings`, `defaults` — untouched. The
new items obey the settings that already exist, because they obey the kinds:

| setting | effect on a gate/queue item |
|---|---|
| `level: 'need'` (default) | `failed` and `waiting` items banner; a `done` item (trial passed, switched on) does not |
| `level: 'every'` | all three kinds banner, once (`bannered` flag, `FRESH_MS` at `client.js:27` still applies) |
| `level: 'never'` | no banner; the inbox still lists everything |
| `banners: false`, `badge: false` | unchanged |
| `muted: [name]` | silences only `done` items whose `task` is that name — so a muted automation's *trial passed* / *switched on* stay silent too. **A `waiting` item is never quiet: `isQuiet` stays `item.kind === 'done' && …`** (`pulse-core.mjs:177`, no edit needed, one regression test required) |

No new setting is added: an action-required item that a toggle could hide would be a lie.

## 7. First-pass baselining (no flood when the person switches the module on)

The rule of `watchStep` (`:230`, `:248`, `:251`) extends to the two new feeds, with the same shape:

- **First pass** (`state.baselined !== true`): a gate or queue record that is already `done` or
  `failed` is **recorded** in `state.gates` / `state.queue` and makes **no item**. An
  **action-required** one (`waiting`) *does* appear — that is why the module is being switched on —
  but with `bannered: true`, so no banner and no surprise sound.
- **Every later pass**: a changed `sig` makes one item; an unchanged `sig` makes none; a resolved
  queue entry removes its `q:` item; a gate record that stops producing a signal removes its `g:`
  item.
- Seed on the first pass: `state.gates` / `state.queue` are filled, so a person who switches the
  module on during a busy week gets at most the asks, never a wall of results.

## 8. Caps and bounds

| Bound | Value | Enforced at |
|---|---|---|
| `INBOX_MAX` | 100 (unchanged) | `inboxPut` (`:173`) |
| `GATE_ITEMS_PER_PASS` | 40 | `proactiveStep` — the rest waits for the next pass (15 s) |
| `QUEUE_ITEMS_PER_PASS` | 8 | `proactiveStep` (mirrors `SUGGESTED_MAX`) |
| `SEEN_MAX` | 300 ids | `normalizeState` + end of `watchStep` |
| item text | `task` 80, `message` 200, `code` 60, `id` 120, `sig` 60 | `cleanItem` / `normalizeState` |
| the gate store | 1 MiB (`PROACTIVE_FILE_MAX`), `GATE_ITEMS_PER_PASS` records turned into items per pass | `readGatesFile` (size checked before parse) / `proactiveStep` |
| the initiative ledger | 1 MiB (`PROACTIVE_FILE_MAX`) | `readEntriesFile` (size checked before parse) |
| ledger entries used | 4 × `QUEUE_ITEMS_PER_PASS` read, `QUEUE_ITEMS_PER_PASS` turned into items per pass | `readProactiveFrom` / `proactiveStep` |
| gate record name lookup | from the `tasks.json` list the pass already reads (no extra I/O) | `taskNames` |

## 9. Edge cases and failure modes

1. **No feed at all** (no `gates.json`, no ledger file) → today's behaviour, no item, no error.
2. **A feed file present, not JSON** (`gates.json` or the ledger) → ignored, one log line, no item,
   the pass still notifies runs.
3. **A feed file over 1 MiB** → not read (bounded), one log line.
4. **Unknown `status`** (a future gate state) → no item, no throw.
5. **Two records for one automation** (a duplicated `automationId` in `gates.json`) → one item,
   highest `rev` wins; the item id is `g:<automationId>`, so the inbox can never hold two. A `gate`
   field on `tasks.json` is ignored whatever it says: it is B5's projection, never a feed (lead
   decision R1), so a `tasks.json` carrying a gate and no `gates.json` yields no item.
6. **`approval.state === 'granted'` but `status === 'awaiting-approval'`** → the `status` is the
   source of truth (documented divergence: the gate owner normalises; Pulse only reads), so the card
   still asks. Fail-closed on the side of asking.
7. **Clock skew** — `updatedAt` in the future → `at` clamped to `now`; unparseable → `null` → record
   skipped (an item with no time cannot be ordered in a hero line).
8. **Inbox already full** — the proactive items are added last, so they sit at the head; the cap drops
   the oldest result, never the newest ask.
9. **A muted automation** whose gate asks for an approval → the item is listed, counted and bannered.
10. **A queue title carrying an e-mail or a long token** → `scrubText` blanks it before `cleanItem`;
    the item still appears (the person sees that *something* waits), never the address. B4 refuses at
    the door; this is the second line of defence.
11. **Entry status bouncing** (`asked → proposed`) → same `sig` → no second item, no duplicate.
12. **A ledger entry that is not an object, or carries no `id`** → skipped in the fold, no throw; the
    rest of the file still lands.
13. **Bundle load order / hot reload** — both doors are read per pass, never captured; the state file
    loads in both directions (old code ignores the new maps).
14. **A very long list** (200 records) → at most `GATE_ITEMS_PER_PASS` items per pass; no timer is
    started inside a pass (the existing single `setInterval` at `index.js:114` stays the only clock).
15. **`now` missing** in `watchStep` → unchanged behaviour (tests always pass it; the host always
    does).
16. **The Mac panel page** (`GET /kybernos-pulse/panel`) → shows the new cards with no change to
    `panel-page.mjs`, because everything it needs is inside the `PANEL-CORE` block. Its CSP and its
    token-gated writes are untouched.

## 10. Security guards (the four hard invariants, as this batch carries them)

| # | Invariant | How this batch honours it (and proves it) |
|---|---|---|
| 1 | **A notification asks, it never approves on the person's behalf** | The only inbox actions are read / read-all / dismiss / banner-shown; no `approve`, no `activate`, no `trial-start` — `inboxAction` returns `null` for them (test), and no client affordance sends them. A `gate.approved` record still yields a **`waiting`** item: the switch-on stays the person's gesture. |
| 2 | **Carry drafts and asks only** | `queue.draft` items carry the entry's `title` + the draft's summary and the words *"nothing was sent"*; nothing in this batch can send, publish, delete or pay (no write path at all — the host half reads `tasks.json`, B3's `gates.json` and B4's ledger, and writes nothing outside its own store). |
| 3 | **Trial-done reports the proof verdict, it does not relaunch** | `gate.trial.passed` / `gate.trial.effects` / `gate.trial.failed` are read from `ProofReport` and rendered; there is no call to `trial-start`, no timer, no session opened. A test asserts the client's only side effect for a card is opening the Automations page and marking it read. |
| 4 | **`kybernos-pulse/*` exclusive** | Six files touched, all inside the bundle (the five code and test files plus its `README.md`); no engine patch, no `@deepseek-ai/*` import, no cross-bundle import (the `scrubText` idea is copied, not imported), no new route, no new tool. |

Additional guards:

- **No new auth surface.** No route added: the Host/Origin fences (`pulse-host.mjs:96`, `:105`) and
  the write guard are exactly as they are; `scripts/audit-routes.mjs` and the route-origin rule see
  no change.
- **No personal data out.** Every field passes `one()` (control characters, whitespace, length) and
  `scrubText` (long tokens, mail addresses) before it reaches the page; the state file keeps names,
  codes and bounded one-liners, never a transcript (same promise as the README's Files section).
- **Bounded outputs.** Every list and every string has a constant in §8; the pass reads at most 20
  journals (unchanged) plus two bounded files (`gates.json`, the ledger).
- **Never stops DSH from starting.** All new I/O sits inside the existing `apply` try/catch
  (`index.js:94`) and inside each reader's own `try/catch`; the client table is inside the module
  factory's try/catch (`client.js:20`) and inside the pure block, so a syntax slip costs the module,
  not the page. `node scripts/check-bundle-faults.mjs` and the lifecycle tests must stay green.
- **Fail-closed on asking.** When in doubt (unknown `status`, divergent `approval.state`), the item is
  either absent or an *ask* — never a silent approval.

## 11. Explicitly OUT of scope

- The **static checks themselves** (B1, `automation-gate.mjs`), the **trial machine and proof report**
  (B2, `automation-trial.mjs`), the **routes/actions** `gate-check` / `trial-start` / `trial-report` /
  `approve` / `queue list` / `queue act` (B3), the **initiative ledger and its agent tools** (B4), the
  **Automations page gate panel and initiative cards** (B5).
- **Any write** to the gate records, the initiative ledger or `tasks.json` — B3 alone writes
  `gates.json`, B4 alone writes the ledger.
- **Reading `task.gate` off `tasks.json`.** That projection exists on B3's `{ action: 'list' }`
  answer for B5's panel (lead decision R1); it is not this bundle's feed, and a `tasks.json` that
  happens to carry a gate record changes nothing here.
- **Any new setting, level, kind, tone, route, tool, slot or notification channel**; no change to
  `plugin.json`, `help.json`, `package.json`, `cordis.patch.yml`, `helper/`.
- **The floating window's browser plumbing** (Document Picture-in-Picture), the Mac app, the badge
  API: reused as they are, not extended.
- **Grouping/filters** ("only gate items", a per-source tab): the inbox keeps its two existing
  filters *To do* / *Results*, which already separate asks from results.
- **Retrying, relaunching, re-running a failed trial** from a card. A card opens the Automations page;
  the gesture happens there, by a human.
- **A README rewrite beyond the four lines §13 names, and any `help.json` change** (`README.md` is
  in the write set, `help.json` is not).
- **Translations beyond the existing fr/en pairs**; no new locale.

## 12. File-by-file change plan

Legend: **E** = edit an existing file, at the anchor named; nothing else is created or moved.

### `packages/kybernos-pulse/pulse-core.mjs` (E) — the whole pure half

| Anchor | Change |
|---|---|
| header comment `:1`–`:9` | one paragraph: the gate store B3 owns and the initiative ledger B4 owns, both read-only, absent is normal |
| `:15` after `INBOX_MAX` | `SOURCES`, `GATE_FILE`, `GATE_ITEMS_PER_PASS`, `QUEUE_ITEMS_PER_PASS`, `SEEN_MAX`, `PROACTIVE_FILE_MAX` (no `*_SEAM`: nothing is read from `globalThis`) |
| after `num`/`obj` (`:23`–`:24`) | `scrubText` (uses `one`) |
| `:147`–`:148` (`KINDS`, `TONE`) | unchanged values; `KINDS` stays the single list the new producers validate against |
| `:151`–`:171` (`cleanItem`) | read + emit `source` (default `'scheduler'`, unknown ⇒ default); nothing else moves |
| after `:218` (`itemFor`) | `taskNames`, `gateSignal`, `gateItemFor`, `queueItemFor`, `proactiveStep` |
| `:226` signature | add `gates = [], entries = []`; body: `let st = …` is already local, add the `proactiveStep` call after the session loop, before `st.baselined = true` (`:255`) |
| `:255`–`:257` | merge `pro.active`/`pro.removed` into the return; prune `state.gates`/`state.queue` with `seen` under `SEEN_MAX` |
| `:194`–`:209` (`normalizeState`) | clean and bound `gates` / `queue` |
| `:262` (`publicView`), `:276` (`inboxAction`) | **no edit** (proves the shape did not drift) |

### `packages/kybernos-pulse/pulse-host.mjs` (E)

| Anchor | Change |
|---|---|
| `:66` | `createWatcher` gains `readProactive = null` |
| `:69`–`:82` (`tick`) | call `readProactive()` in its own `try/catch`; pass its `gates`/`entries` to `watchStep` at `:75` (the tasks list is already there for the names) |
| `:14`, `:19`, `:155`–`:189` | **no edit** (store, routes, fences) |

### `packages/kybernos-pulse/index.js` (E) — the I/O half only

| Anchor | Change |
|---|---|
| `:20`–`:21` | `gatesFile` and `entriesFile` next to `stateFile`/`tasksFile` — both derived from the same home, no literal path |
| after `:90` (`readRunFrom`) | `readGatesFile`, `readEntriesFile`, `readProactiveFrom(home)` — the gate store, then the ledger, each read bounded and caught |
| `:98` | `createWatcher({ …, readProactive: readProactiveFrom(home) })` — the only line `apply` gains |
| `:9`, `:18`, `:102`–`:118`, `:119` | **no edit** (`PASS_MS`, the timer, the mounting, the outer catch) |

### `packages/kybernos-pulse/client.js` (E) — cards only, inside `PANEL-CORE`

| Anchor | Change |
|---|---|
| `:49` after `kn` | `CODE_TEXT` (eight pairs, §5.4) |
| `:73`–`:80` (`itemText`) | the three rules of §5.4; the unknown-code path is byte-identical to today |
| `:117` (the `<article>`) | `data-src="<esc(it.source \|\| 'scheduler')>"` |
| `:148`–`:205` (`PANEL_CSS`) | at most the two token-only rules |
| `:541` (`__test`) | add `CODE_TEXT` |
| everything else | **no edit** — no new icon, tab, button, fetch or timer |

### `packages/kybernos-pulse/test-core.mjs` (E) — new sections before `:185`

Named sections and what each asserts: see the test strategy,
`docs/tests/pulse-proactive-notify-strategy.md` (`unit:` marker). The existing 30-odd assertions are
**not** edited: they are the proof that the pass did not change for scheduler runs.

### `packages/kybernos-pulse/README.md` (E) — the four-line update, part of the batch

Four lines, each at an existing anchor. No new section, no new table row, no screenshot: the batch
amends what is written, it does not restate the file.

| Anchor | Line to write |
|---|---|
| *What it follows* (the paragraph ending "Nothing is guessed from the text of an answer.") | "and, when the gate and the initiative queue are switched on, their events: static checks failed, trial failed, trial passed (with its verdict), approval due, approved and still to switch on, proposal ready as a draft" |
| *Host routes* (the paragraph under the table) | "The gate and the queue add no route: the inbox is the only surface this module serves." |
| *Files* (the sentence "It reads `<DSH home>/kybernos/tasks.json` …") | "It also reads the gate store `<DSH home>/kybernos/gates.json` and `<DSH home>/kybernos/initiatives.json` when they exist, both beside `tasks.json`." |
| *Files* (same sentence, second half) | "It never reads the `gate` field of `tasks.json` (that projection is the Automations page's) and writes nothing but `pulse.json` and `helper.token`." |

`node scripts/test-lifecycle-engine.mjs` and `node scripts/test-paquet.mjs` see no change: the file
already ships, so no `package.json` export and no lifecycle entry is involved.

### Not touched (and why)

`panel-page.mjs`, `session-guard.mjs`, `lib-session-test.mjs`, `plugin.json`, `help.json`,
`package.json`, `cordis.patch.yml`, `helper/`, `test-host.mjs`, `test-client.mjs`, `test-panel.mjs`,
`test-helper.mjs`, `test-write-guard.mjs`, and every file outside `packages/kybernos-pulse/`.

## 13. Handovers and known gaps

**To B3 (`host-gate-and-queue-routes`) — one contract, settled by lead decision R1:**

The gate records live in **`<DSH home>/kybernos/gates.json`**, beside `tasks.json`, in the envelope
`{ "version": 1, "records": GateRecord[] }` (`host-gate-and-queue-routes.md:320`, `:323`, the
directory `kbTasksFileOf` resolves at `index.js:2616`). **Nothing about the gate is stored in
`tasks.json`**: an automation's definition stays a definition, and the gate stays one file with one
writer. B3 still projects `gate` onto its `{ action: 'list' }` answer
(`kbGateBoundedRecord(record)`, `null` when there is no record) — that projection is what **B5's**
panel reads, and it is the only consumer of it. This bundle reads the **store**
(`readGatesFile`), never the projection: no `task.gate` off `tasks.json`, no `list` call, no
`automations/` folder, no second gate file.

Nothing is published on `globalThis`: B3 publishes no seam and this bundle reads none. The path is
derived from the same home as `tasks.json` — the `GATE_FILE` constant in `pulse-core.mjs`, read by
the path helper of `index.js` — so a DSH home that moves, is sandboxed or is temporary carries its gate with its tasks.
Writing `gates.json` stays B3's business alone; Pulse only reads it, bounded by
`PROACTIVE_FILE_MAX`, and a corrupt file degrades to "no gate item" (§9.2).

**To B4:** the ledger is `<DSH home>/kybernos/initiatives.json`, beside `tasks.json` — the path
`initiative-queue.md:283`/`:291` already fixes, and the file the `queue list` action serves. This
bundle reads that file and nothing else of B4's (no export, no seam, no `queue list` call).
`InitiativeEntry.title` and `nextAction.summary` are rendered verbatim (scrubbed and bounded): keep
them pattern-worded, as the frozen shape says, because they cross into the card as they are.

**To B2:** a `ProofReport` with `externalEffects.length > 0` is what makes a failed card; keep
`sideEffectFree` honest — Pulse shows it as-is.

**Known gap (declared, not hidden):** `test-client.mjs` is outside this batch's write set, so the
`CODE_TEXT` / `itemText` mapping is covered by (a) `test-client.mjs` staying green on its 25 existing
assertions, (b) `test-panel.mjs` running the block standalone, (c) the vision captures on the real
panel page, and (d) DoD C of the strategy. If the Lead widens the write set by one file, add these
three lines there:

```js
ok('a gate approval card says the approval is due', T.itemText(item({ kind: 'waiting', code: 'gate.awaiting-approval', source: 'gate' })).sub === 'Trial passed: your approval is due')
ok('a proposal card is titled by the entry and says nothing was sent', T.itemText({ kind: 'waiting', code: 'queue.draft', source: 'queue', task: 'Weekly digest' }).title === 'Weekly digest')
ok('an unknown code keeps the engine\'s own words', T.itemText(item({ kind: 'failed', code: 'NO_CREDENTIAL' })).sub === 'NO_CREDENTIAL')
```

**Second known gap:** `readGatesFile` / `readEntriesFile` live in `index.js`, and `test-host.mjs` is
outside the write set, so the two readers are proved by DoD D of the strategy (a real `gates.json`,
a bare array, a corrupt file, and a `gate` carried by `tasks.json` alone that must yield nothing)
plus the J1-J3 journeys — not by a unit file.

**README (owned by this batch, lead decision R5):** the four lines are written by this batch, at the
anchors §12 names — *What it follows* gains the gate/queue events, *Host routes* gains "the gate and
the queue add no route", *Files* gains the two stores (`gates.json` beside `tasks.json`, and
`initiatives.json`) and the sentence that the `gate` field of `tasks.json` is never read. They are
part of the same commit; there is no follow-up to hand over.

## 14. Definition of done, tests, captures

The executable contract is `docs/tests/pulse-proactive-notify-strategy.md` (six anchored markers:
`e2e:`, `vision:`, `capture:`, `maquette:`, `unit:`, `DoD:`). Summary of the bar:

- `node scripts/run-all-tests.mjs` at **0 red**, with `packages/kybernos-pulse/test-core.mjs` green
  and the other five pulse test files green **unchanged** (they are the regression proof);
- `node scripts/garde-depot.mjs` clean (no media, no personal path — the captures live in `/tmp`);
- `node scripts/test-no-french-literals.mjs` clean for `kybernos-pulse` (its allow-list entry is
  strict, `[]`: every new French string lives inside a `kt`/`kn` pair);
- the five **discriminating** DoD commands (A-D and the maquette verifier), each of which fails on
  today's code, plus the pair assertion that is red on the batched tree (the before/after probe);
- the live pass on a sandbox instance that loads the bundle: three seeded journeys, five captures
  read with `read_image` (day + one dark), and the mockup of section "maquette" of the strategy,
  gated by its own `verifier.mjs --sabotage`.
