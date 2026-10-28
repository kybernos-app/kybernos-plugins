# Test strategy — B3 `host-gate-and-queue-routes`

Executable strategy for the batch specified in `docs/dev/kaby-proactive/specs/host-gate-and-queue-routes.md`.
One new file carries it: `packages/kybernos-plugin/test-automation-gate-routes.mjs` (exit 0 = everything passes,
no dependency, no network). The six markers below are grepped anchored (`^marker:`), so each one starts its line.

What this batch changes, in one line, to know what has to be proven: six new actions on `POST /kybernos/tasks`, a gate
store on disk, five existing fire paths closed for a gated automation (the person's `toggle`, `run-now`, `consume-fire`, the
webhook, and the scheduler's own `kbFireTask`), three re-activation paths closed by the same tooth (`update`'s default
`active: true`, `cloud-link`'s `wasActive`, a code-issued toggle), one new field on the existing `list` answer, a
`tools.guard` that denies write-category calls inside a trial session (with the `tools/pre-execute` denial as its accepted
fallback), and B2's `mayActivate` adopted as the only activation predicate instead of being re-derived here.

Harnesses reused, not invented (both are green on this tree today):

- `scripts/test-tasks-route.mjs` — boots the real `index.js` with a fake `ctx`, a temporary `DSH_HOME`, and drives
  the registered route handler with fake request/response objects. This is the shape of the new test.
- `packages/kybernos-plugin/test-write-guard.mjs` + `lib-session-test.mjs` — a real loopback HTTP listener in front
  of the registered handler, and DSH's signed cookie computed from the documented scheme (`sessionCookie`,
  `installSession`), not with the code under test.

---

e2e: J1 — the plain cover: real bundle, real store, real HTTP. Command, from the repo root:

```
node packages/kybernos-plugin/test-automation-gate-routes.mjs
```

What it boots: `process.env.DSH_HOME` = `mkdtempSync(join(tmpdir(), 'kb-gate-routes-'))`, `HOME` + `USERPROFILE`
the same folder, `.credentials.yaml` written by `installSession(dshHome)` (so the route's own
`kbBrowserSessionSecret` at `index.js:11354` reads a real secret), then `await import('./index.js')` and
`mod.apply(ctx)` with a `ctx` whose `webServer.register` records the handlers. The fake `tools` service carries
`guard(fn)`: it records the function, returns a disposer that records its own call, and without it `trial-start`
correctly refuses `write guard unavailable` (asserted in J4 item 3, which also drives the `pre-execute` fallback).
Requests go through a real `http.createServer` on port 0, exactly as `test-write-guard.mjs` does, so
`req.socket.localPort` is real and the cookie authority matches. `setTimeout` is left alone except for the 5 s/30 s task
timers (captured, never run): the scheduler must not tick during a gate test.

e2e: J2 — the fences, six times over. For each of the six actions:

- no `Origin` → **403** `origin refused`;
- foreign `Origin` (`http://evil.example`) → **403**;
- right `Origin`, no cookie → **401** `sign-in required`;
- cookie signed with another secret (`OTHER_SECRET`, `lib-session-test.mjs`) → **401**;
- expired cookie → **401**;
- right `Origin` + real cookie + `x-kybernos-tunnel: 1` → **403** `refused_on_phone`, and
  `JSON.parse(readFileSync(gates.json))` byte-identical before/after;
- right `Origin` + real cookie, no marker → the action's own answer (never 401/403).
  Control, same run: `{action:'list'}` **with** the marker → **200** and no `secret` in any `trigger`.
  That single pair is the origin-rule regression test: `{action:'list'}` is the only thing that passes the phone.

e2e: J3 — the certified journey, one script, one temp home, in this order (every step asserts both the answer and
the disk):

| step | body | expected answer | disk |
|---|---|---|---|
| 1 seed | `{action:'suggest', task:{…}}` | `ok:true, suggested:true, active:false` | `tasks.json` has the task |
| 2 check a dirty draft | `{action:'gate-check', id}` on a draft stored with `approvals:'auto'` and a prompt saying "send the invoice by e-mail" | `ok:true`, `gate.status:'static-failed'`, ≥1 `severity:'blocker'` | `gates.json` has one record, `rev:1` |
| 3 trial on a failed draft | `{action:'trial-start', id}` | `ok:false, error:'static checks failed'` | nothing fired, record unchanged |
| 4 fix the draft | `{action:'update', id, task}` with `active:false` in the task (the record is a suggestion, so off; a body that omitted `active` would be refused — J4 item 2) | `ok:true` | gate demoted to `draft`, `approval.state:'none'`, `rev` + 1 |
| 5 check a clean draft | `{action:'gate-check', id}` | `ok:true`, `static-passed` | `rev` + 1 |
| 5b list carries the gate | `{action:'list'}` | `ok:true`, and `tasks[i].gate.id === 'gate:' + id`, `tasks[i].gate.status === 'static-passed'`, while a task with no record has `gate: null` (present, not absent) | `gates.json` unchanged by the read |
| 5c the load refusal | `kbGateTrialRefusal('machine-busy')` and its four siblings, on the block extracted through the `data:` URL — a route-level `machine busy` cannot be provoked without loading the real machine, so the rule is asserted where it lives (§3.2 of the spec) | `'machine busy'`, `'not a human request'`, `'static checks failed'`, `'a trial is already running'`, `'no timestamp'`, and an unknown code → `'trial unavailable'` | nothing written |
| 6 trial, human | `{action:'trial-start', id, "human":true}` (with cookie; the flag in the **body** must be inert — the route supplies the real one) | `ok:true, runId` | `gate.trial.outcome.state:'open'`, `supervised:true`, `sideEffectFree:false` |
| 7 the human seam | three probes on the same temp home: (a) the same trial body **without** the cookie → 401, nothing written; (c) `kbHumanOnly('approve', {}, false)` from the extracted block → `not a human request`; (d) source check: exactly one `human: true` in `index.js`, on the route line, and no `{ human: true }` in `automation-tools.mjs` | (a) 401; (c) that string; (d) 1 and 0 | `gates.json` unchanged by (a) |
| 8 report | `{action:'trial-report', id}` after the fake worker writes a clean event list into the session journal the fake `sessionPersistence` serves | `ok:true`, `report.sideEffectFree:true` | `status:'awaiting-approval'` |
| 9 approve, no `rev` | `{action:'approve', id, decision:'grant'}` | `rev required` | unchanged |
| 10 approve, stale `rev` | `decision:'grant', rev:1` | `{ok:false, code:'stale'}` | unchanged |
| 11 approve, human | `decision:'grant', rev:<stored>` | `ok:true`, `approval.state:'granted'` | `status:'approved'`, `approval.at` ISO |
| 12 toggle on | `{action:'toggle', id, active:true}` | `ok:true` | `tasks.json` `active:true`, `gates.json` `status:'activated'` |
| 13 toggle off / on again | both | `ok:true` | still `activated`; no new approval needed |

The fake `sessionPersistence` is the one `scripts/test-tasks-route.mjs` already stubs for `summarizeRun`: a
`{ open(id) -> { read() -> { events }, close() } }` serving a hand-written event list. Two variants are fed:

- **clean** — read tools only (`grep`, `read`), one `turn/end` successful → `sideEffectFree:true`, trial passes;
- **dirty** — a `send`/`write` tool call → `sideEffectFree:false`, `externalEffects` non-empty, status stays
  `trial-done`, and step 11 on that record answers `approval not possible: the trial had outside effects`.

e2e: J4 — the bypass suite, on the same run as J3 (one script, one temp home). Every path that could make a
gated-but-unapproved automation run, or make it runnable again, has its own assertion, and the fake `sessionController`
records **zero** `create`/`prompt` calls for all of them:

1. **The fire tooth, five ways.** The person's `toggle {active:true}`; `run-now`; `consume-fire` (after arming
   `pendingFire` by hand in `tasks.json`); the webhook route `POST /kybernos/hooks` (403 `approval required`); and the
   scheduler itself — a `kbTasksTrigger` built on the fake store with a due, gated, unapproved task, `tick()` awaited,
   must report the claim as `skipped` (`fired: 0`, `failed: 0`) after `kbFireTask` answered `{ refused: 'approval required' }`.
   The tick's history write is asserted too, because `'skipped'` versus `'error'` is the whole point (R6): the task ends
   with exactly one new `history` entry carrying `status: 'skipped'`, `sessionId: null` and `error: 'approval required'`,
   `lastRun` unchanged, and `stableStreak(history)` (the real `automation-skills.mjs` export) is the same before and after —
   an `'error'` line would reset it. None of the five starts a session.
2. **The re-activation trio.** `{action:'update', id, task}` with a body that omits `active` (the sanitizer defaults it to
   true — this is the hole) → `approval required` and `tasks.json` byte-identical; `{action:'cloud-link', id, cloud:null}`
   on a record stored with `cloud: {…, wasActive:true}` → `approval required`, the link untouched; `toggle {active:true}`
   called in-process (no `opts`) → `not a human request`, and with a human request but no grant → `approval required`.
3. **The trial write guard, and its accepted fallback.** After the trial of step 6 starts, the fake `tools` service has
   received exactly one `guard()` call. The recorded function answers a denial string for
   `{ name:'gmail_send', agent:{ session:{ id: runId } } }`, `undefined` for `{ name:'gmail_list', … }` in the same
   session, and `undefined` for a write name from another session id. After the terminal `trial-report` of step 8, the
   recorded disposer has been called exactly once, and a second trial (on a fresh record) installs a new guard.
   **Fallback, same run, two more `ctx` objects**: one whose `tools` service has no `guard` but whose `on` records
   handlers — `trial-start` succeeds (no `write guard unavailable`), and the recorded `tools/pre-execute` handler answers
   `{ kind: 'deny', reason: TRIAL_DENY_REASON }` (the constant imported from `automation-trial.mjs`) for a write name of
   the trial's session and `next()` for a read name or another session; one with **neither** seam — `trial-start` answers
   `write guard unavailable` and the fake `sessionController` records zero `create` calls. The three cases together prove
   the rule: a trial needs **one** runtime seam that can deny, and the two seams are interchangeable because the proof
   reads the reason string, not the seam.
4. **The regression.** The same five fire paths and the same trio on an automation with **no** gate record all still work
   exactly as today — including a code-issued `toggle`, which an ungated automation has always accepted (the regression
   that matters most: today's entire `tasks.json` is ungated).

e2e: J5 — the same journeys against a real DSH, not a fake `ctx` (`source scripts/sandbox/env.sh` first; the
sandbox refuses `:3080` and any home that is not under `.kybernos-sandbox`):

```
source scripts/sandbox/env.sh
bash scripts/sandbox/start.sh
cd <repo root>                      # cookieDeSession resolves ./scripts/cdp-lib.mjs against the cwd
cookie=$(node --input-type=module -e 'import { cookieDeSession } from "./scripts/cdp-lib.mjs"; const c = cookieDeSession(process.env.KB_HOST); if (c === null) process.exit(3); process.stdout.write(c.nom + "=" + c.valeur)')
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "http://$KB_HOST/kybernos/tasks" -H "Origin: http://$KB_HOST" -H 'content-type: application/json' -d '{"action":"gate-check","id":"x"}'
curl -sS -X POST "http://$KB_HOST/kybernos/tasks" -H "Origin: http://$KB_HOST" -H "Cookie: $cookie" -H 'content-type: application/json' -d '{"action":"gate-check","id":"x"}'
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "http://$KB_HOST/kybernos/tasks" -H "Origin: http://$KB_HOST" -H "Cookie: $cookie" -H 'x-kybernos-tunnel: 1' -H 'content-type: application/json' -d '{"action":"gate-check","id":"x"}'
```

Expected, in order: `401`, then `{"ok":false,"error":"task not found"}` (proving the action exists and is
authenticated), then `403`. The cookie is never printed to a file and never echoed. `gate-check` on an id that does
not exist is deliberate: no automation is written in the sandbox by this journey.

e2e: J6 — the real page still reads its list after the change:
`source scripts/sandbox/env.sh && node scripts/check-automations-list-live.mjs` → exit 0. It is the existing
Automations-page acceptance check (header alignment, schedules, Edit → chat, 390 px); it drives the page's own
`list` calls through the route this batch edits, so a broken dispatcher shows up here and not only in unit tests.

vision: no pixel may move, and that is proven by comparing captures rather than asserted. Two capture runs of the
Automations page, one on the branch head **before** the batch commits (`A`), one **after** (`B`), same sandbox DSH,
same window size, same profile state:

```
source scripts/sandbox/env.sh && node scripts/check-automations-list-live.mjs --shots /tmp/kb-gate-A
# apply the batch, restart the sandbox plugin, then:
source scripts/sandbox/env.sh && node scripts/check-automations-list-live.mjs --shots /tmp/kb-gate-B
for f in /tmp/kb-gate-A/*.png; do b=/tmp/kb-gate-B/$(basename "$f"); cmp -s "$f" "$b" && echo "same $(basename "$f")" || echo "DIFF $(basename "$f")"; done
```

A is read with `read_image` **and** B is read with `read_image` (the session model reads them — the platform rule is
that no third-party vision model is delegated for these captures), and what is looked at is stated before looking:
the page header, the row grid, the schedule chips, the switches. Expected: every file `same`, and both images show
the same page. A `DIFF` is not a rounding error: it means B3 touched a rendered surface, which the spec forbids
(§9), so the batch stops there. No dark-theme capture is owed: nothing visible is delivered — the UI pass of
`AGENTS.md` is owed by B5, which owns `client.js`.

capture: the capture commands are the two `--shots` runs above plus, for the raw HTTP contract, a text capture of the
answers (not an image):

```
node packages/kybernos-plugin/test-automation-gate-routes.mjs --dump > /tmp/kb-gate-answers.json
```

`--dump` prints every `{ body, status, answer }` the test sent and received, in order, one JSON object per line: it is
the capture of the wire contract, replayable, and it carries no cookie and no webhook secret (the test strips both
before printing). Captures live in `/tmp` and are never committed (repo rule: no media in git).

maquette: No visible surface in this batch. Reason: the batch adds six JSON actions on an existing route and a store
on disk; the only surfaces it can produce are `{ ok, gate | report | items }` objects, and the Automations page that
will render them belongs to B5 (`packages/kybernos-plugin/client.js`, exclusive write set). A mockup here would be a
mockup of B5's panel, drawn without B5's CSS and shipped without B5's i18n — the exact drift the batch split exists to
prevent. A mockup becomes mandatory the day a payload cannot ride `/kybernos/tasks` and forces a page-driven route
(spec §2, "stop and re-cadrage"); that route would then need its states drawn at DSH's real CSS before any code.

unit: the pure block and the source assertions, same file, no browser, no plugin context. The block
`// KB-GATE-STORE-BEGIN … // KB-GATE-STORE-END` is extracted from `index.js` and imported through a `data:` URL
(the `KB-TASKS-CORE` precedent at `test-automation-occurrences.mjs:9-13`), so the cases run against the code the host
runs, not a copy:

- `kbHumanOnly`: exhaustive over the action families — `null` for `list`, `create`, `suggest`, `update`, `run-now`,
  `gate-check`, `queue list` whatever `human` is; `null` for `toggle` with `active:false`, with a missing body, with
  `active:'true'` (a string is not `true`) and with `active:1`; `'not a human request'` for `trial-start`, `approve`,
  `queue act` when `human` is `false`, `undefined`, `'true'` (a string is not a boolean) or `1`; `'not a human request'`
  for `toggle` with `active:true` in the same four non-human cases; `null` for those four only when `human === true` exactly.
- `kbGateIdOf`: `'gate:' + automationId`; a non-string id gives `'gate:'`.
- `kbGateValidRecord`: a cadrage-shaped record passes; each missing/short-typed field fails; an unknown status fails
  when the injected `GATE_STATUSES` does not carry it (the list is injected, never copied into `index.js`).
- `kbGateEmptyRecord`: `status:'draft'`, `rev:1`, `approval.state:'none'`, `staticChecks:null`, `trial:null`.
- `kbGateCanApprove` matrix (the invariant-#1 unit test): `awaiting-approval` + clean + completed + `rev` match →
  `{ok:true}`; every one of these alone → refused with its own reason: `approved` (already granted), `trial-done`
  (no proof report), `sideEffectFree:false` (outside effects), `outcome.state:'failed'`, `outcome.state:'open'`
  (did not complete), `endedAt:null`, missing/shifted `rev`.
- `kbGateActivationRefusal(record, mayActivate)`: `null` for `null` and `undefined` (an ungated automation must keep
  working) and for a record the predicate accepts; `'approval required'` the moment it answers `false`; `null` for
  `undefined`, `null` or a non-function as the predicate **only** when the record is absent — a granted, passing record
  driven with a `null` predicate is `'approval required'`, the fail-closed case of spec §8 row 42. The decisive case uses
  the real module's `mayActivate` imported beside the block: a granted + passing record gives `null`, the same record with
  `approval: { state: 'none', at: null }` gives `'approval required'`, and a stub answering `true` on that refused record
  gives `null` — which proves the adapter holds no rule of its own. Source assertion on the extracted function: its body
  mentions neither `staticChecks` nor `approval` (the ladder is B2's, §4.1 of the spec), calls no `kbTrialFn`, and holds the
  string `'approval required'` exactly once.
- `kbGateTrialRefusal`: the five codes of B2's `TrialRefusalCode` map to `'not a human request'`, `'static checks failed'`,
  `'a trial is already running'`, `'machine busy'`, `'no timestamp'`; an unknown code and `undefined` map to
  `'trial unavailable'`, never `undefined`, and no answer echoes B2's code spelling.
- `kbGateDemoteAfterEdit`: status `draft`, `staticChecks`/`trial` cleared, `approval.state:'none'`, `rev` + 1,
  `updatedAt` set to the injected `now`, the automation id preserved.
- `kbGateInsert` / `kbGateRemoveOf`: replace-by-id (no duplicate `gate:` ids), append, remove by automation id,
  remove of an absent id is a no-op list.
- cap: 200 records, the oldest unprotected `updatedAt` is dropped; a 201st write with all records `approved` returns
  a refusal, and the returned list is the input list (nothing dropped).
- `kbGateBoundedRecord`: 120 findings → 40 returned; a 5 000-character message → ≤ 300; 900 `toolCalls` → 200;
  40 `externalEffects` → 20; the function returns a valid minimal shape for `null`, `{}` and a record with
  `findings: 'x'`.
- `kbGateAttach`: `(tasks, records)` returns tasks with every own field kept and `gate` added; a task with no record gets
  `gate: null` (the key is **present**, so a consumer branches once); a record with a non-granted status projects through
  `kbGateBoundedRecord`, never raw; a corrupt read yields `gate: null` on every task plus `gateStore:'unreadable'`; the
  input array is not mutated.
- `kbGateParse`: `''` and `null` → empty list, `corrupt:false`; `'{"version":1,"records":[…]}` → records;
  `'{'`, `'[]'`, `'{"records":{}}'` → `corrupt:true` and the text is returned untouched.
- `kbMakeGateStore` with a fake `io`: two mutations in a row are serialized (the second sees the first's `rev`);
  a mutation that changes nothing does not call `write`; a corrupt read calls `keepCopy` once and refuses the write.

Source assertions (cheap, and they guard the properties that behaviour cannot reach): `index.js` imports the three
other batches with `import * as` and contains no named import of `checkDraft`/`trialFromEvents`/`makeInitiativeQueue`
(a named import of an absent export is a link-time crash); the six dispatches appear as the exact literal
`action === '<name>'`; the auth helpers (`kbTasksAuthorized`, `kbTasksRefused`, `kbTunnelledWrite`, the
`body.action !== 'list'` phone line) appear unchanged in count and text. Four more, one per finding of this round: the
`HUMAN_ONLY` literal is declared exactly once and carries `'toggle'` next to `'trial-start'`, `'approve'` and `'queue act'`;
the code between `const kbFireTask = async` and `const kbTasksTrigger = kbMakeTrigger(` calls `kbGateRunRefusalTask(` and
`.guard(`, with the tooth **above** the `sessionController` lookup; `initiatives:` appears zero times and `initiative:`
exactly once, in the mount deps (`:3597`); and the old name `kbGateRunRefusal(` — the two-token form the spec used to carry
next to `kbGateRunRefusalTask(` — appears zero times.

The adoption of B2's surface is asserted the same way, because a second ladder or a silently dropped export would not show
up in a green journey: `kbTrialFn('mayActivate')`, `kbTrialFn('startTrial')` and `kbTrialFn('toStoredGate')` each appear at
least once in `index.js`; the extracted block declares `kbGateActivationRefusal` and calls its predicate parameter rather
than reading a status (the unit case above); and the `'skipped'` literal appears in the tick's history branch with a
`sessionId: null` next to it (a skipped fire is never given a session id).

Runner: `node scripts/run-all-tests.mjs` discovers it as `packages/kybernos-plugin/test-automation-gate-routes.mjs`
(the runner's `packages/*/test*.mjs` glob, run from that folder) and it must be green there before the merge into
`dev`. While iterating: `node scripts/run-all-tests.mjs --only automation-gate-routes`.

DoD: the batch is done when these commands, run from the repo root, fail on today's code and pass on the branch.
Baseline measured on the pre-edit tree (2026-10-28, `feature/kaby-proactive-lot1`):

1. The six dispatches, the human table, the two teeth, B2's adopted surface and the `skipped` history branch exist — **today
   exit 1** (measured: each `grep -c` prints `0`, and the `node -e` probe finds no `kbFireTask` slice carrying the tooth):

```
for a in "gate-check" "trial-start" "trial-report" "approve" "queue list" "queue act"; do grep -q "action === '$a'" packages/kybernos-plugin/index.js || exit 1; done
grep -q "const HUMAN_ONLY = \['trial-start', 'approve', 'queue act', 'toggle'\]" packages/kybernos-plugin/index.js || exit 1
grep -q "kbInitiatives()" packages/kybernos-plugin/index.js || exit 1
grep -q "kbTrialFn('mayActivate')" packages/kybernos-plugin/index.js || exit 1
grep -q "kbTrialFn('startTrial')" packages/kybernos-plugin/index.js || exit 1
grep -q "kbTrialFn('toStoredGate')" packages/kybernos-plugin/index.js || exit 1
grep -q "kbGateTrialRefusal(" packages/kybernos-plugin/index.js || exit 1
grep -q "status: 'skipped'" packages/kybernos-plugin/index.js || exit 1
node -e 'const s=require("fs").readFileSync("packages/kybernos-plugin/index.js","utf8");const a=s.indexOf("const kbFireTask = async");const b=s.indexOf("const kbTasksTrigger = kbMakeTrigger(",a);if(a<0||b<0)process.exit(1);const f=s.slice(a,b);const t=f.indexOf("kbGateRunRefusalTask(");const g=f.indexOf(".guard(");const c=f.indexOf("sessionController");process.exit(t<0||g<0||c<0||t>c?1:0)'
```

   The four `kbTrialFn(...)` / `kbGateTrialRefusal(` lines are the adoption of R3 and the `status: 'skipped'` line is R6: on
   today's tree each answers `0` (`grep -c` measured), so none of them can pass before the batch. The last line is the one
   that has no textual shortcut: it slices the real `kbFireTask` body and requires the gate tooth **and** the trial guard to
   be inside it, with the tooth above the `sessionController` lookup (a tooth placed after the session is created would let a
   refused run open a session first).

2. The new test file passes — **today exit 1** (measured: `Cannot find module … MODULE_NOT_FOUND`, exit 1):

```
node packages/kybernos-plugin/test-automation-gate-routes.mjs
```

3. The negative control inside that file proves the refusals were *observed*, not assumed — a vacuous pass is a
   failure here (exit 1 if any line is missing):

```
node packages/kybernos-plugin/test-automation-gate-routes.mjs --prove-refusals
```

It prints one line per refusal it actually saw on the wire — `human-marker: 1 site in index.js, 0 in automation-tools.mjs`,
`phone-gate-check: 403 refused_on_phone`, `phone-list: 200`, `stale-rev: stale`, `mask-missing: mask unavailable`,
`dirty-trial: approval not possible`, `scheduler-fire: skipped`, `scheduler-history: skipped`, `trial-busy: machine busy`,
`trial-guard: denied`, `trial-guard-disposed: 1`, `trial-guard-fallback: pre-execute denied`,
`update-reactivate: approval required`, `cloud-return: approval required`, `toggle-project: not a human request`,
`ungated-run-now: ok` — and exits 1 unless all sixteen were observed. The ones added by the two amendment rounds are the
ones a reader cannot take on faith: the scheduler's own fire **and its `skipped` history line**, the two re-activation
paths, the code-issued toggle, the guard that both denies the trial's write and lets its read through, its `pre-execute`
fallback, and the load refusal. `trial-busy` is read from `kbGateTrialRefusal('machine-busy')` on the extracted block, for
the reason step 5c gives: no test may load the real machine to provoke it.

4. Discovery, and the whole suite, must be green (these also pass today, so they are gates, not the DoD):

```
node scripts/run-all-tests.mjs --only automation-gate-routes     # must report 1 file, 1 green, 0 RED
node scripts/run-all-tests.mjs                                  # 0 red, before the merge into dev
node --check packages/kybernos-plugin/index.js
node scripts/garde-depot.mjs                                    # no media, no personal path
```

Note on 4: `--only` with a filter that matches **nothing** exits 0 (the runner's `red` list is empty, and it exits
`red.length === 0 ? 0 : 1`) — which is why it is not the DoD by itself, and why command 2 is the one that must fail
today. `node --check` alone does not catch a bad ESM link either (the repo's hot-file rule records `node --check`
returning 0 on a file that cannot load), so command 2, which really imports `index.js`, is the load test that counts.

5. Nothing outside the batch moved — measured against the **commit the batch started from**, and the reason it is not
   `origin/dev` is a measurement, not a preference (D3):

```
start=$(git rev-parse HEAD~1); git diff --name-only "$start"..HEAD -- . ':!docs' | grep -v -E '^(packages/kybernos-plugin/index\.js|packages/kybernos-plugin/test-automation-gate-routes\.mjs)$' && exit 1 || true
```

An empty answer is the proof of invariant #4 in this batch (the docs of this spec phase are excluded on purpose).
**Measured on this tree, 2026-10-28**: `git diff --name-only origin/dev -- . ':!docs'` answers **698** files, and so does the
D3 merge-base, `git diff --name-only $(git merge-base HEAD origin/dev)..HEAD -- . ':!docs'` — the merge-base is
`9a014cf1` (2026-10-22) and this branch is **501 commits** past it, so both span the whole lot instead of the batch. Neither
can ever answer empty, and a check that cannot go green is not a check. The batch is one commit on `feature/kaby-proactive-lot1`,
so its starting point is that commit's parent: `HEAD~1` once committed, which is exactly what the command above diffs.
Running it today exits 1 (`scripts/test-help.mjs` is the last commit's file, outside the write set); after the batch commit it
is empty. A batch that lands in more than one commit records its pre-batch tip in a tag and diffs from it — never from
`origin/dev`, never from the merge-base of a branch whose history is ahead of it.
