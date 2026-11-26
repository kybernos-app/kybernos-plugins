# The task contract, v1

Status: v1, the server batch (lot 2) built 2026-11-22 and open as server pull request #282 (kybernos-app/kybernos-server, not merged, not
deployed; ADR 0062 section 31 is its server-side copy). Nothing in this document is built unless a line says "verified" or "built". Facts
marked verified were read in the server's `origin/dev` (dbe3a9f2) or in this repository's `dev`; lines marked built are in that pull request
and proven by its tests, not by a deployed server. The page `demo/kybernos-architecture/index.html` carries the same
facts as evidence and its test (`scripts/test-architecture-map.mjs`) keeps them true.

## 1. Decision

A **task is a job**. The contract is a *view* over `runner.jobs`, its events and the pending approvals. There is no new `task` table.
Every door (Kaby MCP, Kaby link, the API, the local door) returns the same view through one function, `taskView(job, approvals)`.
The environment interface is the runner protocol that exists (verified), frozen here and checked by one conformance test.

Why not a table: the id that `kaby_do` returns today is `jobs.id` and connected assistants already hold it (verified); the answer
already lives in the thread; approvals and the Journal link key on the job; events cascade with the job. A table would double-write all of it.

## 2. Identity

- `task.id` = `jobs.id` (a uuid, stable across retries).
- An `automation_run` job carries `payload.task_id`, which is the AUTOMATION id (verified). Rename it `automation_id` before anything
  exposes it; readers accept both names for old rows.

## 3. States: one list of seven

Four vocabularies exist today (verified). Jobs: `queued | claimed | done | failed | canceled`. `kaby_ask`: `pending | done | failed`.
An automation run: `preparing | running | waiting_approval | done`. The local door: `running | waiting_approval | waiting_answer | done | failed`.
The server waits 40 s, the local door 45 s.

| Task state | Derived from |
|---|---|
| `pending` | job `queued` |
| `running` | job `claimed`, nothing pending (the old `preparing` folds in) |
| `waiting_approval` | job `claimed` and at least one pending approval |
| `waiting_answer` | job `claimed` and a pending question to the person |
| `done` | job `done` |
| `failed` | job `failed`, with a `reason` (a closed code) |
| `canceled` | job `canceled` |

`stopping: true` while `cancel_requested` is set and the job is not yet acknowledged. Adding a state is a new contract version.

## 4. The view (version 1)

```
task {
  contract_version: 1
  id, state, stopping, created_at, started_at | null, finished_at | null
  source: telegram | whatsapp | mcp | api
  subject: string | null        // opaque end-user reference, at most 128 characters, set by the key's owner
  reason: string | null         // a closed code when failed or canceled
  progress: { steps: n, last: [at most 5 step lines] }
  pending: { approvals: n, question: bool }
  answer: string | null         // read through the thread, only when done
}
```

Clients ignore unknown fields. Fields are only added inside v1.

## 5. Events

`GET .../events?since=<seq>&limit=<n>` returns `{ events: [{ seq, type, at, data }], next_seq }`. Types today (verified): `started`,
`model-call`, `answered`, and `step` (its data is bounded to `tool`, `agent`, `who` 60, `label` 80 and `path` 200 characters).
Clients ignore unknown types. Built: the API shows `started`, `step` and `answered` and never `model-call`; with no `since` it reads from the first
event; `next_seq` is the last event read, shown or not, so a page of hidden events is not read again. Retention is the owner's setting, 30 days by default (verified). There is no SSE and no webhook in v1:
the runner flushes steps every three seconds, so reading with `since` loses nothing.

## 6. Operations

| Operation | Notes |
|---|---|
| create | an `Idempotency-Key`, unique per workspace and creator (verified); the words go into a thread message, never into the job. Built on the API: the header is optional (1 to 200 characters) and scoped to the key (to the person for a session); the same key is the same task and answers `200`, a new one `201`; a replay counts against no ceiling. `subject` (optional, at most 128 characters, no control characters) is the developer's own reference to the end user, stored on the job, shown back, never read by Kaby |
| get | returns the view |
| events | section 5 |
| stop | a cancel that must reach the engine (section 8); it never undoes an external action already done |
| approve, answer | NOT in v1: the person decides in the app only (verified: `decided_via` is `channel` or `app`) |

`kaby_do` stays a long-poll wrapper of create and get, with ONE wait cap on both doors. The API never waits: it answers at once and
the client reads.

## 7. Authority and admission

- One authorization function resolves every credential to a principal: a signed-in session, an OAuth grant (MCP), a `kyk_` key with
  the `tasks` scope, a device.
- `kyk_`: a new `scopes` column (the key decision, ADR 0023 line 71, says it needs no change to stored keys), opt-in at minting,
  mandatory expiry, one workspace (optionally one computer). A key stays refused on every other route.
- One `admit()` in front of `hosted.dispatch` for every door, `automation_run` included (verified: it repeats the checks today):
  the switch, the plan, the in-flight ceilings per user, workspace and key, the budget (models answer `402` when it is empty, verified),
  the per-`subject` cap, and the entrance filter that exists only on MCP today.
- A key task on a computer runs ask-first. A consequential write by a computer principal needs a `job_id` and an approval id that the
  server recorded.
- Built (lot 2). The scope is the `scopes` column of a key (migration 0086; a key without `tasks` is `403 scope_required`, and the refusal is
  an `api_key.refused` event in the security feed). `admit()` (`tasks/admit.ts`) answers in this order: the owner's switch
  `api_tasks_enabled` (off by default: `503 tasks_disabled`), the plan feature `tasks.api` (`403 feature_not_in_plan`), a model, a computer
  (`409 computer_gone` or `computer_unavailable`), the entrance filter (`422 blocked_input`; a suspect text queues on the strictest gate),
  the key's ceilings (`429 key_busy`, `key_daily_cap`, `subject_busy`), the hourly rate (60), then the dispatch asks the budget (`402`).
  Both doors share one queue (`tasks/queue.ts`, five conversation slots), one view (`tasks/view.ts`) and one service (`tasks/service.ts`).
- Why that last line is needed (verified by reading the server's `origin/dev` dbe3a9f2, not exercised): `isComputerPath`
  (`identity/principal.ts`) lets a computer's token `POST /v1/mcp/connections` with no job, and the endpoint (`connections/mcp.ts`)
  checks no approval. The in-chat approval is a rule of the computer's own gate; any process on the machine that can read the token
  (it is in the environment of every node process, and in a file of the same user) can call the connectors directly and skip it.
  The token cannot be replaced (it is needed before any job exists), so the server must hold the rule: a non-read connector call by a
  computer principal is refused unless it names a `job_id` the computer holds and an approval id the server recorded as allowed.
- Built (lot 2), in a narrower form than the line above: while the computer holds an open `agent_turn`, a non-read `connections_execute` with
  its own token needs an `allowed_turn` answer, or spends one `allowed` answer (120 seconds, single use: `consumed_at`, two calls at once
  spend it once), recorded by the server and by the computer's own person; a read passes. The hostile test was written first and 7 of its 10
  cases failed without the fix. Not covered, by design and unchanged: a computer that holds no open turn (an automation's run asks or not by
  its own rules), and a process that reads the token and calls while no turn is open.

## 8. The environment contract (the runner protocol)

An environment (a personal computer, a disposable lane, a self-hosted host) implements, over HTTP: `claim {kinds, limit, lease_seconds}`
returning the job and `next_event_seq`; `context`; `events [{seq, type, data}]`; `heartbeat` returning `{cancel}`; `ack {status:
done | failed | canceled, result | error}` (verified, the server's runner schemas). This contract adds three rules:

1. On `cancel`, the environment stops executing within 5 seconds and takes no other job until it has stopped. Built 2026-11-22 for a
   cloud computer (verified in tests against stand-ins, and played on the real image on 2026-11-22: see `play-stop.mjs` in `docs/dev/computers.md`; not yet on a deployed computer): the runner beats every 5 seconds, reads
   `{ cancel }`, calls the plugin's `POST /kybernos-cloud/turn/stop` (the turn's session and every sub-agent session are cancelled,
   what waits in their queues is removed, the gate refuses every later call), waits up to 5 seconds for DSH to show no open turn,
   then acknowledges. The same applies to a timeout and to a lost lease. Before this the runner acknowledged `canceled` while the
   engine session kept running.
2. Concurrency: one turn at a time per environment, and one pending turn per thread.
3. An environment never holds more authority than its job: a credential that works without a held job can claim and read, nothing more.

A conformance test runs one fixture against any environment and a fake platform: claim, events, approval, stop, ack, and zero model
calls after the stop.

## 9. Versioning and change

`contract_version` is in every view. Additive changes stay in v1 (fields, event types). A new state, a renamed field or a removed field
is v2 and runs beside v1. Migrations stay forward-only: nullable columns (`api_keys.scopes`, `jobs.subject`, the two ledgers' `subject`)
cost nothing (built: `api_keys.scopes` and `jobs.subject`, migrations 0085 and 0086; the ledgers' `subject` is not built); a rename or a drop takes two steps.

## 10. Out of v1

SSE, outbound webhooks, approvals by API, an "agent" object, sub-accounts, white-label, an `Environment` table or class.

## 11. What proves it

0. The hostile test (server batch): with a computer's token and no job, `POST /v1/mcp/connections` for a non-read tool is refused; with a
   job but no recorded approval it is refused; with both it goes through. It is written before the fix and fails first.
   BUILT (server `test/computer-connector-grant.test.ts`, in the narrower form of section 7).
1. One fake computer in the server tests (the 24 files that hand-roll the claim use it) and one "task acceptance" file: create,
   approve in the app, stop, billed zero after the stop. BUILT as `test/helpers/fake-computer.ts` and `test/tasks-api.test.ts` (15 cases:
   create, replay, events, approval, stop before and after the claim, ceilings, billed zero); the 24 older files still hand-roll the claim.
2. The conformance test of section 8, run by every environment. NOT built.
3. One shared fixture that both doors (the server's and the local one) must pass: states, error codes, the wait cap, `contract_version`.
   NOT built (the MCP door and the API door share the code, not yet a fixture the local door also passes).
4. The architecture page: each brick it relies on carries evidence, and its test fails when a "not built" claim stops being true.

## 12. Open points

- Folding `preparing` into `running`: a client no longer sees the difference between "claimed" and "working".
- Settled by lot 2: `subject` is 128 characters with no control characters; an API task runs on the key owner's personal-workspace computer
  (a key is not pinned to another computer in v1, and a team workspace has no task door yet); the server's copy is ADR 0062 section 31.
- Not built in lot 2, and said plainly: the ledger carries no `job_id` for a computer's calls (a task's cost is still the person's rows in the
  task's time window, compared in the database); `subject` is on the job and not on the two ledgers; the ceilings are the owner's two global
  settings, with no per-key override; `waiting_answer` is never produced by the cloud; the conformance test and the shared fixture of
  section 11.
- Proven since (2026-11-22, local container, not deployed): the real engine (DSH 0.2.2-alpha.2) stopped in the middle of a model call, by `services/computer-image/play-stop.mjs`: 12 of 12 on the image with the stop; 9 of 12 on an image built from the commit before it (the call in flight is not closed, the next job starts while the engine is busy, and the cancel is noticed about 40 seconds late instead of 5). Not proven: the lot 1 image on a deployed Fly computer.
- Shipping order: workers' images first (`hosted/kind.ts` changed and is copied by the worker images), then the server (migrations 0085 and
  0086 are additive); the owner's switch stays off until then.
