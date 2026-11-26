# B4 `initiative-queue` — executable test strategy

Batch: **B4 `initiative-queue`** of Lot 1 "Kaby proactif" (pillar B). Branch `feature/kaby-proactive-lot1`,
worktree `kybernos-plugins-proactive`. Written **before** the code, in the spec phase.

Contracts: `docs/dev/kaby-proactive/cadrage.md:195-214` (B4) and `:100-118` (the frozen `InitiativeEntry` shape);
`docs/dev/kaby-proactive/specs/initiative-queue.md` (the spec this file tests); `AGENTS.md` rules 1-10.

Write perimeter — four paths only, everything else read-only:

| Path | Kind |
|---|---|
| `packages/kybernos-plugin/initiative-queue.mjs` | NEW |
| `packages/kybernos-plugin/test-initiative-queue.mjs` | NEW |
| `packages/kybernos-plugin/automation-tools.mjs` | EDIT (`PROMPT` `:6-14`, `WHY` `:27-37`, `say` `:38-44`, `toolDefinitions` `:46-127`) |
| the spec and this strategy | docs |

`index.js` (B3), `client.js` (B5), `packages/kybernos-pulse/*` (B6) are **not** touched, so no route, no pixel and no
notification is tested here — the strategy says exactly where each of those is proved instead.

**What this batch cannot prove alone, and says so:** the human gesture ("the person answers an initiative card") lives in
B5 and its route in B3. The journeys below therefore split into *owned* (the module and the agent path, replayable today
once the code exists) and *deferred* (the route and the card, replayed in B3/B5 with the exact commands quoted here).

## Verified anchors (read in the tree on 2026-10-28)

- `suggestions.mjs:13` `clip`, `:16` `hasPersonalData`, `:19-28` `checkSuggestion` (flat in, nested out), `:33`
  `makeLedger`, `:44` `serial`, `:47-58` `add`, `:59-65` `resolve`.
- `automation-tools.mjs:4-5` `CHUNK_NAME`/`CHUNK_ORDER`, `:6-14` `PROMPT`, `:27-37` `WHY`, `:38-44` `say`, `:47`
  `toolDefinitions`, `:95-125` the ledger block, `:126` `return tools`, `:130-134` `mountAutomationTools`.
- `test-suggestions.mjs:1-45` — the test idiom this batch copies (`eq(label, got, want)`, `mkdtempSync`, injected
  `now`/`newId`, mode check at `:24`, damaged file at `:39-41`, `all checks passed`).
- `test-automation-tools.mjs:9` (`const [suggest, home]`), `:28` (`length, 2`), `:31` (exact four names), `:46`
  (exact registered names) — **the reason the new tools are conditional on `deps.initiative`**.
- `scripts/run-all-tests.mjs:29` — `packages/*/test*.mjs` are discovered; `:48-70` a file is judged on its exit code;
  `:108` `--list` prints the relative path, one per line.
- `docs/dev/live-testing.md:8-45` — `cookieDeSession('127.0.0.1:3080')` returns `{ nom, valeur }`; never print the cookie.
- Measured today, read-only: `POST /kybernos/tasks {action:'list'}` with that cookie and `origin: http://127.0.0.1:3080`
  answers `200`, with `ok: true` and a `tasks` array holding 14 task records — the transport the deferred journey reuses.

## Interpretations that shape the tests

1. **The door takes flat input** (`{title, n, span, where, risk, reversibility, nextAction}`), the file holds the nested
   frozen shape. Tests assert *both* ends, so a future refactor cannot quietly move the nesting.
2. **A resolved entry is kept** (`status` changes, `at` does not). The cap counts pending only; the file is bounded by
   `INITIATIVE_MAX` pending + `KEPT_MAX` resolved.
3. **No default for `risk` / `reversibility`**, and `nextAction.kind` is a literal `'draft'` that the tool hard-codes
   (the model has no `kind` parameter). Both are refusal tests, not default tests.
4. **The two tools exist only with `deps.initiative`**, because `test-automation-tools.mjs` is outside this write set and
   asserts the tool count positionally. The strategy therefore *also* asserts that file still passes.
5. **The D13 vocabulary is asserted, never assumed** (`lead-decisions.md:72-77`, findings 5, 6 and 9). Three facts, each one
   turned into an assertion by D2 or D3: the dependency key is **`deps.initiative`, singular**, and it exposes
   **`list(status)`** — the tools forward the status, they never call a zero-argument list; `resolve` accepts exactly
   **`RESOLVE_STATUSES = ['asked', 'added', 'dropped']`**, and `'proposed'` answers `'unknown status'`; and
   **`makeInitiativeQueue` returns exactly `{list, add, resolve, cap}`**, with `cap === INITIATIVE_MAX`. A rename of the key,
   a fifth return key or a widened status list therefore reddens the gate instead of sliding through a review.

e2e: three replayable journeys. Each command runs from the repository root, in real mode (real modules, real `node:fs`, real
0600 file, real mount guard for the first two; the real `/kybernos/tasks` route for the third). Journeys 1 and 2 are
deterministic — no port, no clock, no network, no write outside `$TMPDIR`; journey 3 speaks to the running GUI on
`127.0.0.1:3080` and is replayed by B3, its owner.

1. **Owned — the agent path, through the real mount guard.** A real `mountAutomationTools` on a `ctx` stub with the exact
   `inject` shape the engine gives, a real queue over a temp home, then the tool executed as the engine executes it. Proves
   registration, the flat→nested door, the 0600 write and the rendered sentence in one run:

   ```
   node --input-type=module -e '
   import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
   import { tmpdir } from "node:os"
   import { join } from "node:path"
   import { mountAutomationTools } from "./packages/kybernos-plugin/automation-tools.mjs"
   import { makeInitiativeQueue } from "./packages/kybernos-plugin/initiative-queue.mjs"
   const dir = mkdtempSync(join(tmpdir(), "kb-init-e2e-"))
   const file = join(dir, "kybernos", "initiatives.json")
   const queue = makeInitiativeQueue({ file, now: () => "2026-10-28T00:00:00.000Z", newId: () => "i_e2e01" })
   const registered = []
   const ctx = { inject: (names, fn) => fn(names[0] === "tools" ? { tools: { register: (t) => registered.push(t) } } : { systemPrompt: { context: () => {} } }) }
   const logged = []
   mountAutomationTools(ctx, { tasks: async () => ({ ok: true }), initiative: { add: (raw) => queue.add(raw), list: (s) => queue.list(s), resolve: (id, s) => queue.resolve(id, s) } }, (m) => logged.push(m))
   const rec = registered.find((t) => t.name === "initiative_record")
   const value = await rec.execute({ title: "Reply to first enquiries", n: 14, span: "60 days", where: "Gmail", risk: "low", reversibility: "trivial", summary: "Draft three reply templates" }, {})
   console.log("registered:", registered.map((t) => t.name).join(","))
   console.log("logged:", JSON.stringify(logged))
   console.log("rendered:", rec.output.render({}, value)[0].text)
   console.log("mode:", (statSync(file).mode & 0o777).toString(8))
   console.log(readFileSync(file, "utf8"))
   rmSync(dir, { recursive: true, force: true })
   '
   ```

   Expected (measured on a conforming prototype, 2026-10-28):
   `registered: automation_suggest,automation_home,initiative_record,initiative_list` · `logged: []` (no seam missing) ·
   `rendered: Recorded in the initiative queue: it waits for the person to answer on the Automations page. Nothing ran.` ·
   `mode: 600` · the file exactly `{ "version": 1, "items": [ { id, title, evidence: { n: 14, span: "60 days", where: "Gmail" }, risk: "low", reversibility: "trivial", nextAction: { kind: "draft", summary: "Draft three reply templates" }, status: "proposed", at: "2026-10-28T00:00:00.000Z" } ] }`.

2. **Owned, replayed once B3 creates the file — the store writes the real DSH home path, private and atomic.** The queue must write
   `$DSH_HOME/kybernos/initiatives.json` next to `suggestions.json`, private, atomically:

   ```
   F="${DSH_HOME:-$HOME/.dsh}/kybernos/initiatives.json"; ls -l "$F" && node -e 'const m = require("node:fs").statSync(process.argv[1]).mode & 0o777; console.log(m.toString(8)); if (m !== 0o600) process.exit(1)' "$F" && ls "$(dirname "$F")" | grep -c '\.tmp-' | grep -qx 0
   ```

   Replayed after the first real `initiative_record` in a live chat (B3's `deps.initiative` is what creates the file); it
   fails today because the file and the wiring do not exist. **Deferred to B3's batch**, quoted here so the shape of the
   path is not re-invented there.

3. **Deferred — the human path, on the existing route.** `queue list` then `queue act` then `queue list` again, plus the
   phone fence. Exact commands, to be replayed by B3 before its merge (the transport is already measured, see anchors):

   ```
   node --input-type=module -e '
   import { cookieDeSession } from "./scripts/cdp-lib.mjs"
   const c = cookieDeSession("127.0.0.1:3080")
   if (c === null) { console.error("session secret unreadable"); process.exit(2) }
   const post = (body, extra = {}) => fetch("http://127.0.0.1:3080/kybernos/tasks", { method: "POST", headers: Object.assign({ "content-type": "application/json", origin: "http://127.0.0.1:3080", cookie: c.nom + "=" + c.valeur }, extra), body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
   const first = await post({ action: "queue list" })
   console.log("list", first.status, JSON.stringify(first.body))
   const id = first.body && first.body.ok === true && first.body.items[0] ? first.body.items[0].id : ""
   console.log("act", JSON.stringify(await post({ action: "queue act", id, status: "asked" })))
   console.log("list again", JSON.stringify(await post({ action: "queue list" })))
   console.log("phone", JSON.stringify(await post({ action: "queue act", id, status: "added" }, { "x-kybernos-tunnel": "1" })))
   '
   ```

   Expected once B3 lands: `list 200` with the pending entries; `act` → `{"ok":true,"item":<the same entry, "status":"asked">}`; the
   second `list` no longer shows that entry among the pending ones; `phone` → `403 refused_on_phone`. **This is B3's DoD,
   not this batch's** — B4 guarantees only the semantics (`list`, `resolve`), and the batch report must say the journey was
   not replayed here. Measured on the current tree (2026-10-28, read-only, no write side effect because an unknown action
   changes nothing, `index.js:3476`): `list 200 {"ok":false,"error":"unknown action: queue list"}`, `act` the same shape,
   and `phone` already `403 {"error":"refused_on_phone"}` — the command is replayable and red where it must be.

4. **Not an e2e in this batch:** an initiative that becomes an automation. There is no such path by design (invariant #1):
   `resolve(id,'added')` writes one status, and the automation the person then creates is their own gesture in B5.

vision: no pixel of this batch is read, and here is the measurement behind that sentence. The batch writes no
`client.js` line, no CSS, no route serving a page and no i18n string; the only visible artefact is the **tool result text**
in a chat, drawn by the generic tool-block component that this batch does not touch — a capture of it would prove the
component renders text, not that B4 says the right thing. So the eye is replaced by two deterministic textual pairs, both
produced by e2e journey 1 above and quoted verbatim in the PR:

| Before (any chat today) | After (the same call, once B4 lands) |
|---|---|
| the model has no `initiative_*` tool: `toolDefinitions({tasks, ledger, initiative})` returns four names | `initiative_record` and `initiative_list` are registered, and the success render reads `Recorded in the initiative queue: it waits for the person to answer on the Automations page. Nothing ran.` |
| `$DSH_HOME/kybernos/initiatives.json` does not exist | the file exists, mode `600`, holding one `status: "proposed"` entry with `nextAction.kind: "draft"` |

Read them the way a reviewer reads a diff: the *left* column must be reproducible on the current tree (it is: the four
names and the absent file are what today's code gives), the *right* column must match the spec's verbatim strings
character for character. The card that will one day show an initiative is B5's screen; its captures are read at B5's pass,
with `read_image`, against B5's `client.js` — not here, and not by this batch.

capture: no image is captured by this batch, declared. The repo forbids media in git (`AGENTS.md` rule 4,
`node scripts/garde-depot.mjs` fails on a PNG), so the only captures it can produce are text files under `$TMPDIR`, and
that is exactly what the batch quotes:

```
node packages/kybernos-plugin/test-initiative-queue.mjs > /tmp/kb-b4-unit.txt 2>&1; echo "unit exit=$?"; tail -3 /tmp/kb-b4-unit.txt
node --input-type=module -e '
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mountAutomationTools } from "./packages/kybernos-plugin/automation-tools.mjs"
import { makeInitiativeQueue } from "./packages/kybernos-plugin/initiative-queue.mjs"
const dir = mkdtempSync(join(tmpdir(), "kb-init-e2e-"))
const file = join(dir, "kybernos", "initiatives.json")
const queue = makeInitiativeQueue({ file, now: () => "2026-10-28T00:00:00.000Z", newId: () => "i_e2e01" })
const registered = []
const ctx = { inject: (names, fn) => fn(names[0] === "tools" ? { tools: { register: (t) => registered.push(t) } } : { systemPrompt: { context: () => {} } }) }
const logged = []
mountAutomationTools(ctx, { tasks: async () => ({ ok: true }), initiative: { add: (raw) => queue.add(raw), list: (s) => queue.list(s), resolve: (id, s) => queue.resolve(id, s) } }, (m) => logged.push(m))
const rec = registered.find((t) => t.name === "initiative_record")
const value = await rec.execute({ title: "Reply to first enquiries", n: 14, span: "60 days", where: "Gmail", risk: "low", reversibility: "trivial", summary: "Draft three reply templates" }, {})
console.log("registered:", registered.map((t) => t.name).join(","))
console.log("logged:", JSON.stringify(logged))
console.log("rendered:", rec.output.render({}, value)[0].text)
console.log("mode:", (statSync(file).mode & 0o777).toString(8))
console.log(readFileSync(file, "utf8"))
rmSync(dir, { recursive: true, force: true })
' > /tmp/kb-b4-journey.txt 2>&1; echo "journey exit=$?"; cat /tmp/kb-b4-journey.txt
node scripts/run-all-tests.mjs --only initiative > /tmp/kb-b4-gate.txt 2>&1; echo "gate exit=$?"; cat /tmp/kb-b4-gate.txt
```

The second command is e2e journey 1 **character for character**, redirected to a file: no placeholder and no ellipsis
survives in anything this batch quotes as evidence. The three files are the acceptance evidence attached to the batch
report (paths, not contents: the report quotes the summary lines). If the team later wants the chat block, it is captured
with `scripts/live-page.mjs` (`await live.page.shot('/tmp/kb-b4-chat.png')`) **after** B3 mounts the tools, and read with
`read_image`; it is not a deliverable of B4.

maquette: No visible surface in this batch. There is nothing to mock up at DSH's real CSS: the spec adds no page, no
panel, no card, no badge, no button and no empty state — the initiative cards, the gate panel they sit next to and every
one of their states belong to **B5 `automations-gate-ui`**, the only batch allowed to write `packages/kybernos-plugin/
client.js`. The only person-facing text this batch owns is a tool result string, which is not laid out by us. A mockup
here would invent a surface the campaign assigned elsewhere, and would then be a screen nobody implements.

unit: one new test file, `packages/kybernos-plugin/test-initiative-queue.mjs`, in the `test-suggestions.mjs` idiom
(`eq(label, got, want)`, a `fails` counter, `mkdtempSync(join(tmpdir(), 'kb-init-'))`, injected `now`/`newId`, `rmSync`
at the end, `all checks passed` as the last line, exit 0/1). It joins the gate through `scripts/run-all-tests.mjs:29`
(`packages/*/test*.mjs`) with **no other edit anywhere**; `node scripts/run-all-tests.mjs --only initiative --list` must
print exactly one path. It must hold **at least 39 `ok` lines** — the count is part of DoD D5, so a file that only checks
that the module loads cannot pass. (39 is the floor, not the target: the four blocks below sum to 44.)

**A. The door (`checkInitiative`, pure, no fs) — 12 checks.** A valid flat input is accepted and returns the nested entry
with `nextAction.kind: 'draft'`; a 120-character title is accepted, 121 → `'too long'`; `'  '` → `'empty title'`;
`n: 0`, `n: -3`, `n: NaN`, `n: '14'` → `'no evidence'`; `where: ''` → `'no evidence'`; `risk: 'huge'` → `'unknown risk'`;
`reversibility: 'maybe'` → `'unknown reversibility'`; `nextAction.kind: 'send'` → `'next action must be a draft'`;
`nextAction.summary: '   '` → `'empty next action'`; an address in the title, a phone number in `where`, a `?token=` link in
`summary` → `'personal data'`; a 240-character summary accepted, 241 refused; control characters stripped and an emoji
counted as one character.

**B. The ledger (`makeInitiativeQueue`) — 17 checks.** An empty file lists `[]`; a first `add` stores
`{id, title, evidence, risk, reversibility, nextAction, status: 'proposed', at}` with the injected `at`; the file is mode
`600` and no `.tmp-` file is left; the same title in another case/accent/spacing → `'already queued'`; after
`resolve(id,'dropped')` the pending list is empty and `list('dropped')` holds one; re-adding the dropped title with the
same `n` → `'needs new evidence'`, with a higher `n` accepted as a **new** entry (the dropped one stays); `resolve(id)`
defaults to `'dropped'`; `resolve(id,'proposed')` → `'unknown status'`; `resolve('i_nope')` → `'not found'`; eight pending
accepted, the ninth → `'too many initiatives'` with the file unchanged; `INITIATIVE_MAX === SUGGESTED_MAX` (imported from
`automation-suggest.mjs` in the test, never hard-coded twice); a damaged file reads `[]` and the next write repairs it;
two `add` calls in `Promise.all` both land; `list()` returns copies (mutating one does not change the next read);
`KEPT_MAX` evicts the oldest resolved only, never a pending entry; and the D13 return shape itself —
`Object.keys(queue).sort()` is exactly `['add','cap','list','resolve']`, `queue.cap` is the number
`INITIATIVE_MAX` (not a getter that could drift from it), and `RESOLVE_STATUSES` is exactly
`['asked','added','dropped']` while `resolve(id,'asked')` is accepted (a status outside the three, `'proposed'`
included, is refused).

**C. The two tools (`initiative_record`, `initiative_list`) — 12 checks.** Without `deps.initiative`: still exactly
`['automation_suggest','automation_home']`, and with a ledger the four existing names in their existing order — the
existing file's assertions, repeated here so this batch reddens if it breaks them. With `deps.initiative` (singular —
   D13 finding 5; passing `initiatives` or `queue` instead registers nothing, which D3 asserts) and no ledger:
the four names, initiative tools last. With both: six names. `additionalProperties: false` on both schemas;
`required` is exactly the six fields; **no `kind` property**; the `risk` and `reversibility` enums; the `status` enum of
`initiative_list`. `execute` hands the **flat** raw to `deps.initiative.add` with `nextAction.kind: 'draft'` hard-coded;
`initiative_list` forwards `status` (`undefined` when absent). A `tasks` deps that throws is never called by either tool.
Every render string of both tools, for the success, empty, one-item, n-item, full and refusal cases, equals the spec's
verbatim text, contains `waits for the person` or `nothing waits for the person`, and matches **none** of
`/is running|has run|was started|is active|switched on|will run|was created/`.

**D. Mounting — 3 checks.** `mountAutomationTools` with a real `inject` registers the tools it defines; a seam that throws
is logged, not thrown (two `log` lines); a missing `deps.initiative` still mounts the two automation tools (`G5`).

DoD: six commands, run from the repository root. Each one **was run on the current tree and fails there**; the observed
message is quoted below. None of them passes today, so none is a tautology. A box is ticked only on exit 0.

- [ ] **D1 — the door refuses what it must, and nests what it accepts.**
  ```
  node --input-type=module -e 'const Q = await import("./packages/kybernos-plugin/initiative-queue.mjs"); const assert = (await import("node:assert/strict")).default; const base = { title: "Reply to first enquiries with a template", n: 14, span: "60 days", where: "Gmail", risk: "low", reversibility: "trivial", nextAction: { summary: "Draft three reply templates" } }; const good = Q.checkInitiative(base); assert.equal(good.ok, true, JSON.stringify(good)); assert.deepEqual(good.entry, { title: base.title, evidence: { n: 14, span: "60 days", where: "Gmail" }, risk: "low", reversibility: "trivial", nextAction: { kind: "draft", summary: "Draft three reply templates" } }); assert.equal(Q.checkInitiative({ ...base, title: "  " }).error, "empty title"); assert.equal(Q.checkInitiative({ ...base, title: "x".repeat(121) }).error, "too long"); assert.equal(Q.checkInitiative({ ...base, n: 0 }).error, "no evidence"); assert.equal(Q.checkInitiative({ ...base, where: "" }).error, "no evidence"); assert.equal(Q.checkInitiative({ ...base, risk: "huge" }).error, "unknown risk"); assert.equal(Q.checkInitiative({ ...base, reversibility: "maybe" }).error, "unknown reversibility"); assert.equal(Q.checkInitiative({ ...base, nextAction: { kind: "send", summary: "Send it" } }).error, "next action must be a draft"); assert.equal(Q.checkInitiative({ ...base, nextAction: { summary: "   " } }).error, "empty next action"); assert.equal(Q.checkInitiative({ ...base, title: "Write to claire@example.com" }).error, "personal data"); assert.equal(Q.checkInitiative({ ...base, where: "call +33 6 12 34 56 78" }).error, "personal data"); assert.equal(Q.checkInitiative({ ...base, nextAction: { summary: "https://x.example/a?token=abc" } }).error, "personal data"); assert.equal(Q.checkInitiative({ ...base, title: "a".repeat(120) }).ok, true)'
  ```
- [ ] **D2 — the ledger: its `{list, add, resolve, cap}` shape, the pinned status vocabulary, dedup, evidence-gated comeback, 0600, damaged file, parallel writes.**
  ```
  node --input-type=module -e 'const Q = await import("./packages/kybernos-plugin/initiative-queue.mjs"); const S = await import("./packages/kybernos-plugin/automation-suggest.mjs"); const assert = (await import("node:assert/strict")).default; const { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } = await import("node:fs"); const { tmpdir } = await import("node:os"); const { dirname, join } = await import("node:path"); assert.equal(Q.INITIATIVE_MAX, S.SUGGESTED_MAX); const dir = mkdtempSync(join(tmpdir(), "kb-init-")); const file = join(dir, "kybernos", "initiatives.json"); let n = 0; const q = Q.makeInitiativeQueue({ file, now: () => "2026-10-28T00:00:00.000Z", newId: () => "i_" + (n += 1) }); assert.deepEqual(Object.keys(q).sort(), ["add", "cap", "list", "resolve"]); assert.equal(q.cap, Q.INITIATIVE_MAX); assert.deepEqual(Q.RESOLVE_STATUSES, ["asked", "added", "dropped"]); assert.equal(typeof q.cap, "number"); const entry = (title, extra = {}) => ({ title, n: 3, span: "60 days", where: "Gmail", risk: "low", reversibility: "trivial", nextAction: { summary: "Draft a plan" }, ...extra }); assert.deepEqual(q.list(), []); const a = await q.add(entry("Reply to first enquiries")); assert.equal(a.ok, true, JSON.stringify(a)); assert.deepEqual([a.item.id, a.item.status, a.item.at, a.item.nextAction.kind], ["i_1", "proposed", "2026-10-28T00:00:00.000Z", "draft"]); assert.equal((await q.add(entry("  reply TO first   enquiries "))).error, "already queued"); assert.equal((await q.add(entry("Reply to first enquiries", { n: 9 }))).error, "already queued"); assert.equal((await q.resolve("i_1", "proposed")).error, "unknown status"); assert.equal((await q.resolve("i_nope")).error, "not found"); assert.equal((await q.resolve("i_1", "dropped")).item.status, "dropped"); assert.deepEqual([q.list().length, q.list("dropped").length], [0, 1]); assert.equal((await q.add(entry("Reply to first enquiries", { n: 3 }))).error, "needs new evidence"); assert.equal((await q.add(entry("Reply to first enquiries", { n: 21 }))).ok, true); for (let i = 0; i < 7; i += 1) assert.equal((await q.add(entry("Initiative " + i))).ok, true); assert.equal((await q.add(entry("One more"))).error, "too many initiatives"); assert.equal(q.list().length, 8); assert.equal((statSync(file).mode & 0o777).toString(8), "600"); assert.equal(readdirSync(dirname(file)).filter((x) => x.includes(".tmp-")).length, 0); writeFileSync(file, "{ not json"); assert.deepEqual(q.list(), []); assert.equal((await q.add(entry("After the damage"))).ok, true); const both = await Promise.all([q.add(entry("Parallel A")), q.add(entry("Parallel B"))]); assert.deepEqual([both.every((x) => x.ok === true), q.list().some((i) => i.title === "Parallel A"), q.list().some((i) => i.title === "Parallel B")], [true, true, true]); rmSync(dir, { recursive: true, force: true })'
  ```
- [ ] **D3 — the two tools exist only with the seam, keep the four existing names in place, and hand a flat draft.**
  ```
  node --input-type=module -e 'const A = await import("./packages/kybernos-plugin/automation-tools.mjs"); const assert = (await import("node:assert/strict")).default; const tasks = async () => ({ ok: true, task: { name: "N" } }); const ledger = { add: async () => ({ ok: true, item: { id: "s_1" } }) }; const seen = []; let asked = "unset"; const initiative = { add: async (raw) => { seen.push(raw); return { ok: true, item: { id: "i_1", title: raw.title } } }, list: async (status) => { asked = status; return [] }, resolve: async () => ({ ok: true }) }; assert.deepEqual(A.toolDefinitions({ tasks }).map((t) => t.name), ["automation_suggest", "automation_home"]); assert.deepEqual(A.toolDefinitions({ tasks, initiatives: initiative }).map((t) => t.name), ["automation_suggest", "automation_home"], "deps.initiative is singular"); assert.deepEqual(A.toolDefinitions({ tasks, queue: initiative }).map((t) => t.name), ["automation_suggest", "automation_home"], "no alias key"); assert.deepEqual(A.toolDefinitions({ tasks, ledger }).map((t) => t.name), ["automation_suggest", "automation_home", "memory_suggest", "instructions_suggest"]); assert.deepEqual(A.toolDefinitions({ tasks, initiative }).map((t) => t.name), ["automation_suggest", "automation_home", "initiative_record", "initiative_list"]); const tools = A.toolDefinitions({ tasks, ledger, initiative }); assert.deepEqual(tools.map((t) => t.name), ["automation_suggest", "automation_home", "memory_suggest", "instructions_suggest", "initiative_record", "initiative_list"]); const rec = tools[4]; const lis = tools[5]; assert.deepEqual([rec.parameters.additionalProperties, lis.parameters.additionalProperties], [false, false]); assert.deepEqual(rec.parameters.required, ["title", "n", "where", "risk", "reversibility", "summary"]); assert.equal(Object.keys(rec.parameters.properties).includes("kind"), false); assert.deepEqual(rec.parameters.properties.risk.enum, ["low", "medium", "high"]); assert.deepEqual(rec.parameters.properties.reversibility.enum, ["trivial", "easy", "hard"]); assert.deepEqual(lis.parameters.properties.status.enum, ["proposed", "asked", "added", "dropped"]); await rec.execute({ title: "T", n: 3, span: "", where: "Gmail", risk: "medium", reversibility: "easy", summary: "Draft a plan" }, {}); assert.deepEqual(seen[0], { title: "T", n: 3, span: "", where: "Gmail", risk: "medium", reversibility: "easy", nextAction: { kind: "draft", summary: "Draft a plan" } }); assert.deepEqual(await lis.execute({}, {}), { ok: true, items: [] }); assert.equal(asked, undefined); await lis.execute({ status: "dropped" }, {}); assert.equal(asked, "dropped")'
  ```
- [ ] **D4 — every render says it waits for the person and none claims anything ran.**
  ```
  node --input-type=module -e 'const A = await import("./packages/kybernos-plugin/automation-tools.mjs"); const assert = (await import("node:assert/strict")).default; const initiative = { add: async () => ({ ok: true, item: { id: "i_1" } }), list: async () => [], resolve: async () => ({ ok: true }) }; const tools = A.toolDefinitions({ tasks: async () => ({}), initiative }); const rec = tools.find((t) => t.name === "initiative_record"); const lis = tools.find((t) => t.name === "initiative_list"); const text = (t, v) => t.output.render({}, v)[0].text; assert.equal(text(rec, { ok: true, item: { id: "i_1" } }), "Recorded in the initiative queue: it waits for the person to answer on the Automations page. Nothing ran."); assert.equal(text(rec, { ok: false, error: "already queued" }), "Not done: an initiative with that title already waits."); assert.equal(text(rec, { ok: false, error: "next action must be a draft" }), "Not done: the next action of an initiative is a draft: it prepares text or a plan, it never sends, publishes, deletes or pays."); assert.equal(text(lis, { ok: true, items: [] }), "The initiative queue is empty: nothing waits for the person."); assert.equal(text(lis, { ok: true, items: [{ title: "Reply to first enquiries", risk: "low", reversibility: "trivial" }] }), "Waiting for the person (1): “Reply to first enquiries” (low risk, trivial to undo). Nothing ran."); assert.equal(text(lis, { ok: true, items: [{ title: "A", risk: "low", reversibility: "trivial" }, { title: "B", risk: "high", reversibility: "hard" }] }), "Waiting for the person (2): “A” (low risk, trivial to undo); “B” (high risk, hard to undo). Nothing ran."); const eight = Array.from({ length: 8 }, (x, i) => ({ title: "T" + i, risk: "low", reversibility: "easy" })); assert.equal(/^Waiting for the person \(8, full\): /.test(text(lis, { ok: true, items: eight })), true); for (const [t, v] of [[rec, { ok: true, item: { id: "i_1" } }], [rec, { ok: false, error: "needs new evidence" }], [lis, { ok: true, items: [] }], [lis, { ok: true, items: [{ title: "A", risk: "low", reversibility: "easy" }] }], [lis, { ok: true, items: eight }]]) { const s = text(t, v); assert.equal(/is running|has run|was started|is active|switched on|will run|was created/.test(s), false, s) }'
  ```
- [ ] **D5 — the new file is discovered, holds at least 39 checks, and the two neighbour files stay green.**
  ```
  node scripts/run-all-tests.mjs --only initiative --list | grep -qx 'packages/kybernos-plugin/test-initiative-queue.mjs' && test "$(node packages/kybernos-plugin/test-initiative-queue.mjs | grep -c '^ok  ')" -ge 39 && node packages/kybernos-plugin/test-initiative-queue.mjs | grep -q '^all checks passed$' && node packages/kybernos-plugin/test-automation-tools.mjs | grep -q '^all checks passed$' && node packages/kybernos-plugin/test-suggestions.mjs | grep -q '^all checks passed$'
  ```
- [ ] **D6 — the frozen shape on disk, and the three invariants, proved on the data and the source.**
  ```
  node --input-type=module -e 'const A = await import("./packages/kybernos-plugin/automation-tools.mjs"); const Q = await import("./packages/kybernos-plugin/initiative-queue.mjs"); const assert = (await import("node:assert/strict")).default; const { mkdtempSync, readFileSync, rmSync } = await import("node:fs"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path"); const boom = () => { throw new Error("the tasks route must never be reached by an initiative tool") }; const seen = []; const initiative = { add: async (raw) => { seen.push(raw); return { ok: true, item: { id: "i_1" } } }, list: async () => [{ title: "T", risk: "low", reversibility: "trivial", status: "proposed" }], resolve: async () => ({ ok: true }) }; const tools = A.toolDefinitions({ tasks: boom, initiative }); await tools.find((t) => t.name === "initiative_record").execute({ title: "T", n: 2, where: "Gmail", risk: "low", reversibility: "easy", summary: "Draft" }, {}); await tools.find((t) => t.name === "initiative_list").execute({}, {}); assert.equal(seen.length, 1); const dir = mkdtempSync(join(tmpdir(), "kb-init-shape-")); const file = join(dir, "kybernos", "initiatives.json"); const q = Q.makeInitiativeQueue({ file, now: () => "2026-10-28T00:00:00.000Z", newId: () => "i_1" }); await q.add({ title: "T", n: 2, where: "Gmail", risk: "low", reversibility: "easy", nextAction: { summary: "Draft" } }); const raw = readFileSync(file, "utf8"); const stored = JSON.parse(raw).items[0]; assert.deepEqual(Object.keys(stored).sort(), ["at", "evidence", "id", "nextAction", "reversibility", "risk", "status", "title"]); assert.deepEqual(Object.keys(stored.evidence).sort(), ["n", "span", "where"]); assert.equal(raw.includes("\"active\""), false); rmSync(dir, { recursive: true, force: true }); const src = readFileSync("packages/kybernos-plugin/initiative-queue.mjs", "utf8"); assert.equal(/automation-gate|automation-trial|automation-suggest|automation-tools/.test(src), false, "the queue must not import an automation module"); assert.equal(/node:http|node:child_process|fetch\(/.test(src), false, "the queue must not reach out"); assert.equal(/\.active\b/.test(src), false, "the queue must not touch the activation field"); assert.equal(/renameSync/.test(src) && /0o600/.test(src), true, "atomic, private write"); assert.equal(/suggestions\.mjs/.test(src) && /hasPersonalData/.test(src), true, "one personal-data door")'
  ```

**Each of the six commands was executed on the current tree (`feature/kaby-proactive-lot1`, 2026-10-28) and each fails:**

| DoD | Exit | Observed message |
|---|---|---|
| D1 | 1 | `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<worktree>/packages/kybernos-plugin/initiative-queue.mjs'` |
| D2 | 1 | same `ERR_MODULE_NOT_FOUND` (the module is the first import) |
| D3 | 1 | `AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal: + actual - expected` — actual `['automation_suggest','automation_home']`, expected the four names |
| D4 | 1 | `TypeError: Cannot read properties of undefined (reading 'output')` — `rec` is `undefined`: no `initiative_record` today |
| D5 | 1 | `node scripts/run-all-tests.mjs --only initiative --list` prints **nothing** (0 files discovered), so `grep -qx` fails at once |
| D6 | 1 | `ERR_MODULE_NOT_FOUND` on `initiative-queue.mjs` |

**Conformance was checked, not assumed.** All six commands were run against a throwaway prototype of the spec in `/tmp`
(never in this worktree, deleted after): each one exits 0 there, including D5 with a 39-check file. That pass caught one
real incoherence in the first draft of the spec — the tool handed a nested `evidence: {n, span, where}` while the door read
a flat `n`/`where`. The spec and D3 now fix the flat shape; without the prototype run this strategy would have shipped a DoD
that can never pass.

**Regression gate — green today, therefore *not* a DoD (a red here still blocks the merge).** Measured on the current tree:
`node packages/kybernos-plugin/test-automation-tools.mjs` → `all checks passed`; `node packages/kybernos-plugin/
test-suggestions.mjs` → `all checks passed`; `node scripts/garde-depot.mjs` → 0 error. Before a merge into `dev`:
`node scripts/run-all-tests.mjs` at 0 red, plus `node scripts/test-lifecycle-engine.mjs` and `node scripts/test-paquet.mjs`
(`AGENTS.md`). `dsh-compat.json` is not touched: no compat bump.

**What the batch report must say (short, `AGENTS.md` rule 10):** the four paths, D1-D6 at their exit code, the count of
checks in the new file, the e2e journey 1 output, and the one journey it did **not** replay (journey 3, B3's), with the
reason. Nothing about a screen: this batch has none.
