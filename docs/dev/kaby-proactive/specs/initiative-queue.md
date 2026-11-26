# Spec B4 — `initiative-queue`

Batch: **B4 `initiative-queue`** of Lot 1 "Kaby proactif" (pillar **B**, bounded initiative queue).
Branch `feature/kaby-proactive-lot1`, worktree `kybernos-plugins-proactive`.
Contract source: `docs/dev/kaby-proactive/cadrage.md:195-214` (B4), frozen shapes at `:47-118`.
Mapping: `docs/dev/kaby-proactive/cartographie.md:83-103`.
Stage: **spec only** — no code is written from this document by its author; the implementation is a later delegation.

**Sole owner of `packages/kybernos-plugin/automation-tools.mjs`** (invariant #4). This batch writes exactly four paths:

| Path | Kind |
|---|---|
| `packages/kybernos-plugin/initiative-queue.mjs` | NEW |
| `packages/kybernos-plugin/test-initiative-queue.mjs` | NEW |
| `packages/kybernos-plugin/automation-tools.mjs` | EDIT (two tools + `WHY` + `say` + three prompt lines) |
| this document + `docs/tests/initiative-queue-strategy.md` | docs |

`packages/kybernos-plugin/index.js` is **read-only here** (B3 owns it), `client.js` is **read-only here** (B5 owns it),
`packages/kybernos-pulse/*` is **read-only here** (B6 owns it). No new engine patch, no new dependency, no new route.

## Goal

Kaby notices the same need several times (a repeated request, a manual chore it watched, a repeated correction) and must be
able to say so **once**, with what it measured, and park it where the person decides — instead of repeating it in every
answer, or worse, acting on it. The batch delivers:

1. a **bounded queue** of initiatives, on the file pattern the suggestions ledger already uses (`suggestions.mjs:33-66`:
   serial writes, atomic rename, mode 0600, injected `now`/`newId`), with a cap, a dedup on the normalised title, and a
   refusal of personal data at the door;
2. **two agent tools** — `initiative_record` and `initiative_list` — added to `toolDefinitions` of
   `automation-tools.mjs:47`, plus three lines in its prompt chunk (`:6-14`), whose rendered strings say the entry **waits
   for the person** and never claim that anything ran.

What the queue is *not*: it creates no automation, schedules nothing, writes no file outside its own ledger, calls no
route and no model. An initiative is **intent with evidence**, waiting for a human decision (invariant #1 and #2).

## Verified anchors (read in the tree on 2026-10-28, not remembered)

- `suggestions.mjs:16` — `hasPersonalData(text)`: e-mail, phone, `?token=`/`?key=`/`?secret=`/`?password=` link. **Reused
  verbatim** (imported, never copied) so the three doors cannot drift.
- `suggestions.mjs:11` — `LIMITS`; `:13` `clip()` (control-character strip + `Array.from` slice, so an emoji is one
  character); `:19-28` `checkSuggestion` (pure door: `{ ok:true, … }` / `{ ok:false, error }`); `:33` `makeLedger`; `:44`
  `serial`; `:47-58` `add` (dedup on `toLowerCase`, cap, `'too many waiting'`); `:59-65` `resolve` (deletes).
- `automation-tools.mjs:4-5` `CHUNK_NAME`/`CHUNK_ORDER` (139); `:6-14` `PROMPT` (7 lines, `.join('\n')` at `:14`); `:16`
  `TEXT`; `:17` `str`; `:20-25` `sessionOf`; `:27-37` `WHY`; `:38-44` `say` (success chain then `'Not done: ' + WHY[…]`);
  `:47` `toolDefinitions(deps)`; `:95-125` the `deps.ledger` block (the pattern the new block copies); `:126` `return tools`;
  `:130-134` `mountAutomationTools` (two guarded `ctx.inject`: tools, prompt chunk).
- `automation-suggest.mjs:7` — `SUGGESTED_MAX = 8` (the number the queue mirrors, cross-checked in the test, not imported).
- `kybernos-skills/learned.mjs:26` — `LEARNED_LIMITS.maxPending = 5` and `:27-28` `pendingDays`/`discardedDays`: the
  precedent for a cap **and** the precedent this batch deliberately does **not** copy (no expiry, see Interpretation 6).
- `kybernos-memory/lessons-store.mjs:26-30` — `LESSON_MAX_CHARS = 500`, `LESSONS_MAX_COUNT = 50`, archive-never-destroy:
  the precedent for a bounded store that keeps what it resolved.
- `index.js:3592-3594` — `kbSugg()` builds the suggestions ledger lazily at
  `joinPath(dirname(await kbTasksFileOf()), 'suggestions.json')`; `:3597` the single `mountAutomationTools(ctx, { tasks,
  ledger }, log)` call, wrapped in `try/catch`. **This is B3's edit point, quoted here so the seam is unambiguous.**
- `index.js:11482`/`:11487` — the suggestions route reads `(await kbSugg()).list(kind)` and `.resolve(body.id)`: the
  envelope `{ ok, items, cap }` / `{ ok, item }` the queue route will reuse (B3).
- `scripts/run-all-tests.mjs:29` — `packages/*/test*.mjs` are discovered automatically, so `test-initiative-queue.mjs`
  joins the gate with no edit anywhere.
- `test-automation-tools.mjs:9,28,31,46` — **the constraint this batch must not break**: `toolDefinitions(deps)` is
  destructured positionally (`const [suggest, home]`), `length` must be 2 without a ledger, and the registered names must
  be exactly `['automation_suggest','automation_home']`. Therefore the two new tools are **appended last** and are
  **absent** unless `deps.initiative` is passed (see Interpretation 2).

## Public API of `initiative-queue.mjs`

Pure door + one ledger; no route, no network, no import outside `node:*` and `./suggestions.mjs`.

```js
import { hasPersonalData } from './suggestions.mjs'   // never a copy of the regex

export const INITIATIVE_MAX = 8        // pending entries at once (mirrors SUGGESTED_MAX)
export const KEPT_MAX = 24             // resolved entries kept, oldest evicted by array order
export const LIMITS = Object.freeze({ title: 120, span: 40, where: 80, summary: 240 })
export const RISKS = Object.freeze(['low', 'medium', 'high'])
export const REVERSIBILITY = Object.freeze(['trivial', 'easy', 'hard'])
export const STATUSES = Object.freeze(['proposed', 'asked', 'added', 'dropped'])          // the four states of the frozen shape
export const RESOLVE_STATUSES = Object.freeze(['asked', 'added', 'dropped'])             // the only answers resolve() accepts

/** The door: `{ ok: true, entry }` (normalised, no id/status/at) or `{ ok: false, error }`. Pure, no I/O. */
export const checkInitiative = (raw) => …

/** The ledger of one DSH home. `file` is the whole path; `now` and `newId` are injected for the tests. */
export const makeInitiativeQueue = ({ file, now = () => new Date().toISOString(), newId = () => 'i_' + randomBytes(5).toString('hex') }) => ({
  list: (status) => InitiativeEntry[],          // synchronous, like makeLedger.list
  add: (raw) => Promise<{ ok: true, item } | { ok: false, error }>,
  resolve: (id, status = 'dropped') => Promise<{ ok: true, item } | { ok: false, error }>,
  cap: INITIATIVE_MAX,                          // the constant itself: no caller re-declares 8
})
```

### Contract pinned by D13 (no second spelling anywhere)

The lead unified B4 with B2/B3 on 2026-10-28 (`lead-decisions.md:72-77`, findings 5-9). Those five facts are **not
open to interpretation**: a batch that needs another spelling of any of them stops and re-cadrages
(`cadrage.md:47-51`). The strategy asserts every one of them, so a rename turns the gate red.

| # | Pinned fact | Finding |
|---|---|---|
| 1 | The dependency key is **`deps.initiative`, singular**, and it exposes **`list(status)`** — one object, one list function that takes the status (or `undefined`). There is no `deps.initiatives`, no `deps.queue`, and no zero-argument `list` in the tools' call path. | 5 |
| 2 | `resolve(id, status)` accepts `status` in **`RESOLVE_STATUSES` = `{asked, added, dropped}`** only. `proposed` is the creation state and is refused with `'unknown status'`, like any other string outside those three. The same three values are the body of B3's `queue act`. | 6 |
| 3 | **`makeInitiativeQueue` returns exactly `{list, add, resolve, cap}`** — those four keys, no fifth. `cap` is the numeric constant `INITIATIVE_MAX`, exported through the object so a route, a card or a pulse never hard-codes 8. | 9 |
| 4 | The route body is `{action: 'queue act', id, status}` with `status` in `{asked, added, dropped}`; `queue list` takes no `status` in Lot 1 (B3, "Handoff" below). | 6 |
| 5 | `trialFromEvents` and `normalizeGateRecord` keep **B2's signatures**: B4 imports neither and re-declares neither (they are named here only so nobody invents a second vocabulary in this file). | 7-8 |

### `checkInitiative(raw)` — exact rules, exact error codes

Input copied from the tool call (untrusted model output). Every text field goes through the `clip` discipline of
`suggestions.mjs:13` (control characters stripped, `Array.from` slicing) — never a raw `slice()`.

**The input is flat**, exactly what the tool's arguments give — `{ title, n, span, where, risk, reversibility, nextAction }` —
and `add(raw)` takes that same flat raw. The door nests it into `evidence: { n, span, where }` on the way out, which is
exactly what `checkSuggestion` does with its own flat `{ text, n, span, where }` → `{ from: { n, span, where } }`
(`suggestions.mjs:19-28`). One shape at the door, the frozen shape in the file: no caller ever has to know both.

| Field | Rule | Refusal |
|---|---|---|
| `title` | trimmed, ≤ 120 after clipping, not empty | `'empty title'` / `'too long'` |
| `n` | `Math.round`, `1 ≤ n ≤ 100000` (`Number.isFinite` first) | `'no evidence'` |
| `span` | optional, clipped to 40, `''` allowed | — |
| `where` | trimmed, not empty, clipped to 80 | `'no evidence'` |
| `risk` | one of `RISKS` — **no default** | `'unknown risk'` |
| `reversibility` | one of `REVERSIBILITY` — **no default** | `'unknown reversibility'` |
| `nextAction.kind` | absent → `'draft'` is filled in; anything but `'draft'` | `'next action must be a draft'` |
| `nextAction.summary` | trimmed, not empty, clipped to 240 | `'empty next action'` / `'too long'` |
| every text above | `hasPersonalData` → refuse the whole entry | `'personal data'` |

The returned `entry` is exactly the frozen shape without the server-side fields:

```js
{ title, evidence: { n, span, where }, risk, reversibility, nextAction: { kind: 'draft', summary } }
```

`personal data` is checked last, after the shape, so the agent gets the actionable error first and the refusal message is
the one already known (`WHY['personal data']`, `automation-tools.mjs:32`).

### `list(status)`

- `list()` / `list('pending')` → every entry whose status is `proposed` or `asked`, in insertion order.
- `list('proposed' | 'asked' | 'added' | 'dropped')` → exactly that status, insertion order.
- `list('anything else')` → `[]` (never a throw: the caller is a route).
- Returns **copies** (`Object.assign({}, item)`) so a caller cannot mutate the stored entry.
- A missing, empty, unreadable or damaged file reads as `[]` and is repaired by the next write (same as
  `suggestions.mjs:36`, tested at `test-suggestions.mjs:39-41`).

### `add(raw)`

Serial (`serial`, `suggestions.mjs:44`), then, in this order — the order is part of the contract because it decides *which*
error the person and the agent see:

1. `checkInitiative(raw)` → refusal returned unchanged, nothing written.
2. **Dedup on the normalised title** (see below):
   - an entry with status `proposed` or `asked` → `{ ok:false, error:'already queued' }`;
   - an entry with status `added` → `{ ok:false, error:'already added' }`;
   - entries with status `dropped` → allowed **only if** `n` is strictly greater than the highest `n` of the dropped
     ones, else `{ ok:false, error:'needs new evidence' }`.
3. **Cap**: pending count (`proposed` + `asked`) `>= INITIATIVE_MAX` → `{ ok:false, error:'too many initiatives' }`,
   nothing written.
4. Build `{ id: newId(), …entry, status: 'proposed', at: now() }`, append, evict the oldest resolved entries above
   `KEPT_MAX`, write (`mkdirSync` recursive, `<file>.tmp-<pid>`, `writeFileSync(…, { mode: 0o600 })`, `renameSync`), return
   `{ ok: true, item }`.

File envelope, byte-compatible with `suggestions.json`: `{ "version": 1, "items": [ … ] }`, two-space JSON.

### `resolve(id, status = 'dropped')`

Serial; `status` must be one of `RESOLVE_STATUSES`, i.e. exactly `asked`, `added` or `dropped` — **these three and nothing
else, pinned by D13 (finding 6)**. `proposed` is refused (`'unknown status'`): it is the creation state, not an answer, and
letting it back in would make a resolved entry indistinguishable from a fresh one. The status is validated **before** the
id lookup, so the same call always answers `'unknown status'` first whatever the id. An unknown id →
`{ ok:false, error:'not found' }`; a bad status → `{ ok:false, error:'unknown status' }`. The item is **kept** with its
new status and `at` unchanged (no new field: the frozen shape is not widened). `resolve` never touches anything but the
ledger — in particular it can never make an automation runnable (invariant #1).

## Data shape

`InitiativeEntry` is **frozen by the cadrage** (`cadrage.md:100-112`) and reproduced here so no variant is invented:

```ts
interface InitiativeEntry {
  id: string;                                             // 'i_' + 10 hex chars
  title: string;                                          // pattern wording, no personal data, ≤ 120
  evidence: { n: number; span: string; where: string };    // n 1..100000, span ≤ 40, where ≤ 80
  risk: 'low' | 'medium' | 'high';
  reversibility: 'trivial' | 'easy' | 'hard';
  nextAction: { kind: 'draft'; summary: string };          // kind is a literal: no other value exists
  status: 'proposed' | 'asked' | 'added' | 'dropped';
  at: string;                                             // ISO 8601, the creation moment
}
```

No `note` field (the automation proof has one, `automation-suggest.mjs:14`; the initiative shape does not), no `taskId`, no
`resolvedAt`, no `score`. A batch that needs one of them **stops and re-cadrages** (`cadrage.md:47-51`).

## The two agent tools (exact schemas)

Both are pushed **after** `instructions_suggest`, inside `if (deps.initiative !== undefined && deps.initiative !== null &&
typeof deps.initiative.add === 'function')`, so `test-automation-tools.mjs:28,31,46` keeps passing untouched. The key is
`initiative`, **singular** (D13, finding 5) — one object carrying `add`, `list(status)`, `resolve` and `cap`.

| | `initiative_record` | `initiative_list` |
|---|---|---|
| purpose | park one initiative with its evidence | read what waits |
| parameters | object, `additionalProperties: false` | object, `additionalProperties: false` |
| properties | `title` (string, "A pattern, 120 characters at most: what keeps coming back. No names, no addresses, no numbers."), `n` (number, "How many times you saw it (at least 1)."), `span` (string, "Over what period, for example \"60 days\"."), `where` (string, "Where you saw it, for example \"Gmail › Contact form\". No names."), `risk` (string, enum `['low','medium','high']`), `reversibility` (string, enum `['trivial','easy','hard']`), `summary` (string, "One line: what the draft would prepare. It never sends, publishes, deletes or pays.") | `status` (string, enum `['proposed','asked','added','dropped']`, "Optional: only entries in that state. Omit for what still waits.") |
| required | `['title','n','where','risk','reversibility','summary']` | — (none) |
| `execute` | `deps.initiative.add({ title, n, span, where, risk, reversibility, nextAction: { kind: 'draft', summary } })` — flat, see above | `({ ok: true, items: await deps.initiative.list(status || undefined), cap: deps.initiative.cap })`, `items` forced to `[]` when not an array |
| `output.schema` | `{ type: 'object' }` | `{ type: 'object' }` |

The model **cannot name a next-action kind**: `kind` is not a parameter, the tool writes the literal. `risk` and
`reversibility` are enums in the schema *and* validated by the door (a route caller can reach the queue without the schema).

### Render strings, verbatim (they are the contract the strategy asserts)

| Case | Text |
|---|---|
| record, `ok: true` | `Recorded in the initiative queue: it waits for the person to answer on the Automations page. Nothing ran.` |
| list, empty | `The initiative queue is empty: nothing waits for the person.` |
| list, 1 item | `Waiting for the person (1): “Reply to first enquiries” (low risk, trivial to undo). Nothing ran.` |
| list, n items | `Waiting for the person (n): “A” (low risk, trivial to undo); “B” (high risk, hard to undo). Nothing ran.` |
| list, full | prefix becomes `Waiting for the person (8, full): …` when `items.length >= INITIATIVE_MAX` |
| any refusal | `Not done: <WHY[error]>.` (the existing branch, `automation-tools.mjs:44`) |

Titles are clipped to 120 and the list renders at most `INITIATIVE_MAX` titles: the output is bounded whatever the file
holds. No string may contain *is running*, *has run*, *was started*, *is active*, *switched on*, *will run* or
*was created* — the strategy greps exactly that list.

### `WHY` entries added (`automation-tools.mjs:27-37`, before the closing brace)

```js
'empty title': 'the title is empty',
'no evidence': 'an initiative needs what you measured: a count of at least 1 and where you saw it, without names',
'unknown risk': 'risk must be low, medium or high',
'unknown reversibility': 'reversibility must be trivial, easy or hard',
'next action must be a draft': 'the next action of an initiative is a draft: it prepares text or a plan, it never sends, publishes, deletes or pays',
'empty next action': 'say in one line what the draft would prepare',
'already queued': 'an initiative with that title already waits',
'already added': 'the person already added that initiative: nothing to propose again',
'needs new evidence': 'that one was dropped before: bring it back only with a higher count',
'too many initiatives': 'eight initiatives already wait: the person has to answer some first'
```

`'too long'`, `'personal data'` and `'empty'` already exist (`:33-36`) and are reused verbatim, never redefined.

### `say` (`automation-tools.mjs:38-44`) — one new branch, last

The nested ternary keeps `'Bound: …'` as its final fallback (`automation_home` depends on it). The new branches go
**after** `what === 'suggest'` and **before** the fallback:

```js
: what === 'initiative'
  ? 'Recorded in the initiative queue: it waits for the person to answer on the Automations page. Nothing ran.'
: what === 'initiative list'
  ? initiativeListText(value.items)
: 'Bound: …'                       // unchanged
```

`initiativeListText` is a small local function (empty / n items / full, table above). The failure branch and every
existing string stay byte-identical.

## Prompt chunk delta (`automation-tools.mjs:6-14`)

The seven existing lines stay byte-identical (asserted by `test-automation-tools.mjs:40,53`). Three lines are appended
after line 13, before `.join('\n')` at `:14`:

```
When the same need, chore or correction comes back with measured evidence, call initiative_record once: it parks the entry in the initiative queue, where it waits for the person's decision on the Automations page. An initiative never creates, schedules or switches on an automation.
The next action of an initiative is a draft: it prepares text or a plan, it never sends, publishes, deletes or pays.
Call initiative_list to read what still waits. Never say an initiative was added, is active or ran unless the queue says so.
```

Bounded on purpose (3 lines, ~600 characters): this chunk rides in **every** request (`CHUNK_ORDER` 139, so it is one of the
last chunks). No new chunk, no order change — `CHUNK_NAME` and `CHUNK_ORDER` are untouched.

## Handoff — what B3 (`host-gate-and-queue-routes`) must do with this batch

B4 owns the module and the tools; the queue is reachable by a human only through B3. Three obligations, stated so they
cannot be rediscovered differently:

1. **`deps.initiative` at the existing mount** (`index.js:3597`), lazily built exactly like `kbSugg` (`:3592-3594`):

   ```js
   const kbInit = async () => { if (kbInitLedger === null) kbInitLedger = makeInitiativeQueue({ file: joinPath(dirname(await kbTasksFileOf()), 'initiatives.json') }); return kbInitLedger }
   // mountAutomationTools(ctx, { tasks: kbTasksHandle, ledger: {…}, initiative: {
   //   add: (raw) => kbInit().then((q) => q.add(raw)),
   //   list: (status) => kbInit().then((q) => q.list(status)),
   //   resolve: (id, status) => kbInit().then((q) => q.resolve(id, status)),
   //   cap: INITIATIVE_MAX } }, log)
   ```

   The file is `initiatives.json`, in the same directory as `suggestions.json` and `tasks.json`. B4 resolves no path. The
   key handed to `mountAutomationTools` is `initiative`, **singular**, and the object it carries exposes `list(status)`
   (D13, findings 5 and 9): one key, one store, no alias and no `initiatives` plural anywhere in the wiring. The whole
   `{list, add, resolve, cap}` shape survives that wrapper, so `cap` is forwarded too — it is the module constant, so no
   promise is needed and the number is available at mount time.

2. **Route shapes, on the existing `/kybernos/tasks` handler** (same fence `kbTasksRefused`, `index.js:11388`; no new route
   family):

   ```http
   POST /kybernos/tasks        {"action":"queue list"}
     → 200 {"ok":true,"items":[InitiativeEntry…],"cap":8}

   POST /kybernos/tasks        {"action":"queue act","id":"i_1a2b3c4d","status":"asked"}
     → 200 {"ok":true,"item":InitiativeEntry}
     → 200 {"ok":false,"error":"not found" | "unknown status"}
   ```

   Rules B3 inherits: `status` is checked against `RESOLVE_STATUSES` (`asked`, `added`, `dropped`) — `"proposed"` answers
   `unknown status`, never a silent write (D13, finding 6); `queue list` carries no `status` in Lot 1; unauthenticated →
   `401`; a request carrying `x-kybernos-tunnel` → `403 refused_on_phone` (only `{action:'list'}` passes the phone today —
   that allowlist must **not** widen without the route-origin audit, `docs/dev/route-origin-rule.md`); `queue act` records a
   decision and **never** flips a task `active`.

3. **No route call from the tools.** The tools call `deps.initiative` directly (an in-process function, no HTTP, no sign-in),
   so an initiative can be recorded inside an automation run. This is why the queue is a module and not a route.

What B5 and B6 may rely on: `list()` returns full entries (title, evidence, risk, reversibility, nextAction.summary, status,
at) — enough for an initiative card and for a "needs a next action" pulse item; nothing else is exported (`cap` is the one
addition, and it is a number, not a surface).

## Edge cases and failure modes

| Case | Behaviour |
|---|---|
| No file yet | `list()` → `[]`; the first `add` creates `kybernos/` (`mkdirSync` recursive) |
| Damaged JSON | reads as `[]`; the next write repairs it (never a throw: the caller is a route) |
| Two `add` calls at once | `serial` chain: both stored, none lost (asserted) |
| Pending already at 8 | `'too many initiatives'`, file untouched |
| Title differing only by case, accents, spacing or punctuation | dedup hit (`normalise`: NFD, marks stripped, lower-case, non-alphanumerics → space, collapsed) |
| Same title, previous entry `dropped` with `n: 14`, new `n: 14` | `'needs new evidence'` |
| … new `n: 21` | accepted, a new entry is created (the dropped one stays in the file) |
| Same title, previous entry `added` | `'already added'` |
| `n: 0`, `n: -3`, `n: NaN`, `n: "14"` | `'no evidence'` |
| `risk: 'huge'`, `risk` absent | `'unknown risk'` (no silent default: a defaulted risk lies to the person) |
| `nextAction: { kind: 'send', summary: 'Send it' }` from a route caller | `'next action must be a draft'` |
| `title` holding an address, `where` a phone number, `summary` a `?token=` link | `'personal data'` |
| `resolve('i_nope')` | `'not found'` |
| `resolve(id, 'proposed')` | `'unknown status'` |
| 25 resolved entries | the oldest resolved one leaves (array order); pending are never evicted |
| Emoji / 4-byte characters in a title | counted as one character (`Array.from`), never split |

**Known limitation, stated rather than hidden:** `serial` is per process, like `makeLedger`. Two DSH processes writing the
same home could interleave. In practice the route is the only writer, and an in-process queue is what the rest of the
suggestions ledger already assumes; a cross-process lock is out of scope for Lot 1.

## Security guards (each one is a test in the strategy)

| # | Guard | How it is enforced |
|---|---|---|
| G1 | **Adding an initiative never activates an automation** (invariant #1) | `initiative-queue.mjs` imports nothing from `automation-*`, never reads or writes `.active`, knows no route; `resolve(id,'added')` writes one status string. The tools' `execute` accepts a `tasks` deps that throws and never calls it |
| G2 | **Queue drafts and asks, nothing leaves alone** (invariant #2) | `nextAction.kind` is a literal `'draft'`; the tools don't expose a kind; the door refuses any other value; no network, no `child_process`, no model call |
| G3 | **Personal data refused at the door** | `hasPersonalData` imported from `suggestions.mjs:16` — one regex, three doors |
| G4 | **Bounded everything** | 8 pending, 24 resolved, `{120,40,80,240}` characters, render of at most 8 titles, list `status` filtered |
| G5 | **A bundle never stops DSH from starting** | the two tools ride the existing guarded `mountAutomationTools` (`:130-134`); a missing `deps.initiative` drops them and nothing else |
| G6 | **Write set disjoint** (invariant #4) | four paths, listed at the top; `index.js`, `client.js`, `kybernos-pulse/*` untouched; `automation-tools.mjs` is this batch's alone |

## Interpretations (chosen here, because the cadrage leaves the point open)

1. **`resolve` keeps the entry instead of deleting it** — the one deliberate divergence from `makeLedger.resolve`
   (`suggestions.mjs:59-65`). `asked` / `added` / `dropped` are answers the person gave, and B5/B6 must be able to show or
   count them; a deleted item cannot be told from one never proposed. The cap counts **pending** only, so the queue stays
   bounded by `INITIATIVE_MAX` on the axis that matters.
2. **The two tools appear only with `deps.initiative`** — `test-automation-tools.mjs:28,31,46` asserts the tool count and the
   exact name list positionally, and that file is outside this batch's write set. Conditional registration also means a
   host that has not wired the queue yet (B3 after B4, or a profile without `tasks.json`) shows no tool that would fail.
3. **Dedup is on the normalised title, and a dropped one may come back only with a higher `n`.** "Write patterns, not
   people" applies to proposals too: repeating the same claim the person already refused is nagging, so the door asks for
   new evidence — the same standard the automation proof holds (`automation-suggest.mjs:11-16`).
4. **`risk` and `reversibility` have no default.** The entry exists so the person can judge quickly; a defaulted value would
   be an invented judgement about their business. Refusing costs the agent one repair turn, and the error names the
   allowed values.
5. **`evidence.n` must be ≥ 1 and `where` non-empty** — "no proof, no proposal", the batch's whole point. `span` may be
   empty (a repeated chore has no period).
6. **No expiry, unlike `learned.mjs`'s `pendingDays`.** A proposal about the person's work does not go stale in 30 days the
   way a skill proposal does, and the queue is capped anyway. Eviction only applies to resolved entries.
7. **The three prompt lines are appended, never rewritten.** The existing seven are asserted by substring in
   `test-automation-tools.mjs:40,53`; the new lines carry the "waits for the person" and "draft only" rules.

## Out of scope (this batch must not do any of it)

- **Any route, any `kbTasksHandle` action, any `index.js` line.** `queue list` / `queue act` are B3's; this document only
  states their shape.
- **Any UI.** No card, no badge, no page, no i18n string, no `client.js`, no CSS: B5 owns the Automations page, and an
  initiative card is a B5 decision.
- **Any notification.** B6's inbox/banners; the queue emits no event and calls no pulse function.
- **Any gate or activation logic** (B1, B2, B3), and any reading of `tasks.json` — the queue does not know automations exist,
  not even to dedup against their names.
- **Linking an `added` initiative to the automation it produced** (`taskId`), and any status history: the frozen shape has
  neither; widening it is a re-cadrage (`cadrage.md:47-51`).
- **Scoring, ranking, prioritising, ageing or auto-dropping** initiatives; no "top 3" call, no model call.
- **Edits to `suggestions.mjs`** (import only), to `automation-suggest.mjs`, to `learned.mjs`, to `lessons-store.mjs`, to
  `kybernos-memory/*`.
- **A new prompt chunk, a new `CHUNK_ORDER`, a new tool name family** (`initiative_*` lives inside the existing automations
  chunk).

## File-by-file change plan (anchors named, no line invented)

### 1. `packages/kybernos-plugin/initiative-queue.mjs` — NEW, ~120 lines

Header comment (English, ~10 lines) stating: the queue carries intent with evidence; it creates, schedules and activates
nothing; a resolved entry is kept; the file is `kybernos/initiatives.json` written atomically with mode 0600, one writer at
a time. Then, in this order:

| Block | Content |
|---|---|
| imports | `node:fs` (`mkdirSync`, `readFileSync`, `renameSync`, `writeFileSync`), `node:path` `dirname`, `node:crypto` `randomBytes`, `./suggestions.mjs` `hasPersonalData` |
| constants | `INITIATIVE_MAX`, `KEPT_MAX`, `LIMITS`, `RISKS`, `REVERSIBILITY`, `STATUSES`, `RESOLVE_STATUSES` |
| `clip`/`plain`/`normalise` | local helpers (~8 lines); `normalise` = NFD + marks stripped + lower-case + non-alphanumerics → space + collapse |
| `checkInitiative` | the door, per the table above (~35 lines) |
| `valid` | an entry read back from disk (id string, known status, `nextAction.kind === 'draft'`, `evidence.n` number) |
| `makeInitiativeQueue` | `chain`/`read`/`write`/`serial` copied from `suggestions.mjs:34-44` (same 8 lines, same `0o600` + `renameSync`), then `list`/`add`/`resolve` and the returned `cap` constant (~50 lines) |

### 2. `packages/kybernos-plugin/automation-tools.mjs` — EDIT, four zones, everything else byte-identical

| Zone | Anchor | Change |
|---|---|---|
| prompt chunk | `PROMPT` array, lines `:6-14` | append 3 lines before `.join('\n')` (`:14`); lines 7-13 untouched |
| error sentences | `WHY`, `:27-37` | add the 10 entries of the table above, before the closing `}` (`:37`) |
| render branch | `say`, `:38-44` | one `what === 'initiative'` and one `what === 'initiative list'` arm, inserted **before** the `'Bound: …'` fallback (`:43`); add the local `initiativeListText` helper just above `say` |
| tool definitions | `toolDefinitions(deps)`, `:47-127` | update the doc comment at `:46` so the ledger sentence gains "and the initiative queue"; insert the `deps.initiative` block between the end of the ledger block (`:125`) and `return tools` (`:126`) |

**Untouched, on purpose:** `CHUNK_NAME`/`CHUNK_ORDER` (`:4-5`), `TEXT`/`str` (`:16-17`), `sessionOf` (`:20-25`),
`automation_suggest`/`automation_home`/`memory_suggest`/`instructions_suggest` bodies and strings, the failure branch of
`say`, `mountAutomationTools` (`:130-134`). No new import in this file.

### 3. `packages/kybernos-plugin/test-initiative-queue.mjs` — NEW, ~70 lines

Same shape as `test-suggestions.mjs:1-45`: a `fails` counter, an `eq(label, got, want)` helper, `mkdtempSync(join(tmpdir(),
'kb-init-'))`, injected `now`/`newId`, `rmSync` at the end, `process.exit(fails === 0 ? 0 : 1)` and the final
`all checks passed` line (`run-all-tests.mjs` reads the exit code; the DoD greps that line). It carries **both** halves — the
queue (door, cap, dedup, personal data, resolve, file mode, damaged file, parallel writes) and the two tools (presence,
schemas, draft literal, render strings, refusal sentences, a `tasks` deps that throws) — because
`test-automation-tools.mjs` is outside this batch's write set. Detailed list in
`docs/tests/initiative-queue-strategy.md`, `unit:` section.

### 4. Docs

`docs/dev/kaby-proactive/specs/initiative-queue.md` (this file) and `docs/tests/initiative-queue-strategy.md`. English, no
personal path, no media (rule 4), no `/Users/<name>` (`node scripts/garde-depot.mjs`).

## What the implementation must leave to its neighbours (one line each)

- **B3**: `deps.initiative` at `index.js:3597` + `queue list` / `queue act` on `/kybernos/tasks` (shapes above).
- **B5**: reads `list()` through B3's `queue list`; `status` values are the four of the frozen shape.
- **B6**: an entry whose status is `proposed` and whose `nextAction` exists is a candidate "action required" item; the
  queue emits no event of its own, pulse reads the store (B6 decides, this batch only guarantees the data is there).
