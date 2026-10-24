# The computer image (cloud computers)

A **cloud computer** is a DSH with the Kybernos suite that keeps running when its owner's laptop is off: it fires automations on a
schedule and on a webhook. The server side (the registry, the lifecycle, the meter, the restricted token and the Fly driver) is in the
private server repository (ADR 0052 and its runbook). This page is the contract the **image** keeps: what it is made of, what it is
given, what it listens on, and how it was checked.

## What the image is

`services/computer-image/` is one thin layer on the hosted Kybernos image of
[`packages/kybernos-gate/docker`](../../packages/kybernos-gate/docker/Dockerfile) (DSH, the plugins at a release tag, the gate in front
of DSH):

- the gate listens on **3080** (the one port the platform exposes) and asks for a password; DSH listens on loopback **3081**;
- an entrypoint that runs as root for one reason (the volume is mounted root-owned) and then runs the image's own entrypoint as the
  unprivileged `node` user, with the profile and the workspace on the volume.

```sh
# Fly runs amd64. On Apple Silicon the default is arm64, which Fly cannot run: say the platform.
docker buildx build --platform linux/amd64 -t kybernos-computer-base:<tag> \
  --build-arg DSH_VER=0.2.1-alpha.2 --build-arg KB_REF=v1.0.0-beta.8 packages/kybernos-gate/docker
docker buildx build --platform linux/amd64 -t kybernos-computer:<tag> \
  --build-arg BASE=kybernos-computer-base:<tag> services/computer-image
```

`KB_REF` is a release tag (never `dev`), and `DSH_VER` is inside the range of `dsh-compat.json` (the tag's own file must list it: the
`v1.0.0-beta.6` tag stops at `0.2.0-rc.2`). 563 MB, and the plugins are cloned at build time: nothing in the machine fetches code later.

## What the platform gives it

| Variable | What it is |
|---|---|
| `KYBERNOS_API`, `KYBERNOS_COMPUTER_ID`, `KYBERNOS_COMPUTER_TOKEN` | its server, its id and its **restricted** token (a device token of its owner that the server holds to a short list of routes). Nothing else secret: a connector's credential, a key and the owner's password never enter the machine. |
| `KYBERNOS_PUBLIC_HOST` | its own host name: given to `dsh web --trusted-host`, so that DSH's fence and the plugins' route guards accept the platform's address |
| `KYBERNOS_GATE_PASSWORD` or `_HASH` | the gate refuses to start without one (a person enters the page with the platform's single-use ticket: `GET /__gate/ticket?t=…`, redeemed with the computer's own token; the password stays for a development machine) |
| `KYBERNOS_EGRESS_MODE`, `KYBERNOS_EGRESS_ALLOW` | the network policy of the computer. held **by the machine itself** (`egress.sh`, nftables, for every process in it): `closed` lets out the platform's address only, `list` adds the named hosts, `public` any public address. Fly offers no control of outbound traffic and its kernel has no `owner` match, so the rules are the whole machine's. It fails closed: a policy that cannot be applied stops the start. `KYBERNOS_EGRESS_GUARD=off` is for a development machine and the log says so |
| `KYBERNOS_COMPUTER_MODEL` (optional, default `auto`) | the model the profile asks the platform's route for: `render-profile.sh` writes the `kybernos` provider (`$KYBERNOS_API/v1`, the computer's token as the key) and the default model before DSH starts |
| `DSH_HOME`, `KYBERNOS_WORKSPACE` | set by the entrypoint to `/data/dsh` and `/data/work` on the volume, so that sessions, memory, skills and automations survive a restart, a cold start and a wake |

## Signed in to its owner's account

A computer's page must not open on the first-run wizard: its sign-in tries the built-in server, which the machine's network policy does not let out (« We couldn't reach Kybernos »). The entrypoint therefore (`link-account.mjs`) writes the cloud plugin's connection file (`<DSH home>/kybernos-cloud.json`) with the computer's own restricted token, points the plugin at `KYBERNOS_API` (`KYBERNOS_CLOUD_API`) and marks the wizard done once (`kybernos/onboarding.json`; a replay from the settings stays possible). What the plugin learns afterwards (the name, the plan, the workspaces) is kept across boots. The platform's token list allows the three reads the suite makes for that (`GET /v1/me`, `GET /v1/workspaces`, the plan of its own workspace), and the plugin reads a restricted token's `403 computer_route_not_allowed` as « not on the list », not as a revoked sign-in (a release before this one signs the computer out on it: the platform must be a version that has the reads).

## A computer made ahead of need (the pool)

A computer made for one person costs the person a wait: on dev, 25 to 41 s from the row to the machine saying `ready` (15 to 33 s for the provider to make the app, the
volume and the machine, then 8 to 9.5 s of boot), and the first answer came 52 to 55 s after the message. This half of the image lets the platform make machines **before** anybody
needs one, put them to sleep, and hand one to the next person: the claim is a wake (about a second on Fly) and a few seconds of wiring, not a creation. The platform's half (the
pool, the claim, the routes below) is in the private server repository; nothing here changes a machine that is made the old way.

**A pool slot** is given `KYBERNOS_API`, `KYBERNOS_PUBLIC_HOST`, the egress mode, `KYBERNOS_POOL_SLOT` (its id, not secret) and `KYBERNOS_POOL_TOKEN` (a token that opens the two pool routes
and nothing else), and **no** `KYBERNOS_COMPUTER_ID`, `_TOKEN` or `_MODEL`. `entrypoint.sh` sees a pool token, a slot id and no computer token and runs `pool-hold.sh` as the unprivileged user
before anything else:

| Step | What happens |
|---|---|
| 1 | the machine boots like any other (outbound policy, volume, profile seeded from the image); DSH starts **without** the pool token in its environment, so that nothing it runs can read it |
| 2 | `claimer.mjs` waits for DSH, says `POST /v1/pool/ready` (« booted and unclaimed: put me to sleep when you like »), then polls `POST /v1/pool/claim` every 500 ms. The platform suspends the machine meanwhile (memory kept) |
| 3 | the platform wakes it and has the next poll answer `{claimed: true, computer_id, token, model}`. Every poll is on a connection of its own (a socket open at suspend is dead at wake) and short-timed |
| 4 | the claimer checks the identity against closed alphabets (`computer-identity.mjs`), writes it to `<DSH home>/kybernos/computer-identity.json` (0600, fsynced, atomic), and asks DSH (`POST /kybernos-cloud/computer/claimed`, loopback, same origin, nothing in the request) to put the token in its credential store: the model route (`apiKeyEnv: KYBERNOS_COMPUTER_TOKEN`) resolves it there, so nothing restarts. The file holds the id, the token and the model, **not the address**: that stays the machine's environment (`KYBERNOS_API`), which the agent cannot change |
| 5 | `post-claim.sh`, the steps every computer does, now with the identity read from the volume: the model route rendered into the profile (DSH hot-reloads it, about 2.5 s), the account link, the gate's ticket service, **a wait until DSH says the model route is live** (`GET /kybernos-cloud/computer/route`, read-only), then the reporter and the runner (a turn taken before that finds no model: measured, it ends `empty_answer.ended_turn_end`), then the gate |

A machine made the old way runs `post-claim.sh` directly: same steps, identity in its environment, no DSH up yet. A claimed pool slot that cold-boots finds its identity on the volume
and skips steps 1 to 4. If DSH does not take the token or the route never comes up, DSH is restarted and reads the identity at its start.

What the platform serves, for the server's half to build (the proposal is in the maintainer's notes; this is the contract the image keeps):

| Route (bearer: the pool token) | Answer |
|---|---|
| `POST /v1/pool/ready` `{version}` | 200 when it has recorded that the slot is up and unclaimed |
| `POST /v1/pool/claim` `{}` | 200 `{claimed: false}`, or 200 `{claimed: true, computer_id, token, model}`. A claimed slot is answered **again, with a fresh token (the previous one revoked), until its computer says `ready`** with it: an answer lost on the way is not a lost computer. 401/403/404 once the slot is retired (the claimer then polls every 5 s) |

Rules the image keeps: a slot holds **nothing of a person** before the claim (no token, no id, no model, no account link; the volume is the seeded profile); root never reads or
evaluates the identity (the volume is the agent's to write: `entrypoint.sh` has no `eval`, follows no link it finds there (a dangling `.owned` used to make root create and hand over a
file anywhere), and the identity is read by the unprivileged user); the pool token is stripped from the environment of everything that runs after the claim (`exec env -u
KYBERNOS_POOL_TOKEN`); the identity file is the only place a claimed slot keeps its token, and the plugin honours it **only where `KYBERNOS_POOL_SLOT` is set** (a laptop's plugin ignores
such a file) and never takes the platform's address from it (`packages/kybernos-cloud/computer-identity.mjs`, byte-copied here like `kyby-identity.mjs`). A slot that was claimed (its
account link is on the volume) but lost its identity file does not wait for a second claim: it goes on, and the gate does not start, which is visible.

Checked locally (the real DSH and the suite of image p17 under amd64 emulation on a Mac, a stand-in platform over TLS, nothing left the machine): unclaimed boot to `ready` in 6 to 15 s;
claim to the computer saying `ready` in 3.6 s (about 2.5 s of it the hot reload); a queued turn taken right after, its model call signed with the **claimed** token and its answer acknowledged
(5.6 s from the claim to the acknowledgement with an instant model); a cold restart of a claimed slot reads the volume and calls no pool route; a machine made the old way is unchanged.
**Measured at Fly** (2026-10-20, one slot, `ams`, `1x1g`, image pool1, a throw-away platform behind a tunnel; the server repository's `scripts/computers-pool-live.ts`): the slot booted and said it was up 5.1 s after the machine was created, was put to sleep in 1.7 s; a computer taking it was woken by a 0.70 s resume call, was handed its identity 1.0 s later and said **ready 10.8 s** after it was asked for (against 25 to 41 s for a create and a boot); the model route was live on the machine (asked from inside it). Nine of those seconds were DSH reloading its profile to take the route written at the claim, on a small shared CPU: the route is now rendered at the slot's boot (`render-profile.sh` renders it for a slot with no token, writes the file only when it changes, and `pool-hold.sh` runs it before DSH starts), the slot is made with the model of the day, and the claim's model wins if it changed. That change was checked locally (claim to ready 1.6 s against 3.6 s) and then **at Fly with image pool2 (a second slot): the computer said ready 4.7 s after it was asked for** (resume call 2.4 s, identity 3.6 s after the ask, ready 1.1 s after the resume returned; on the machine, from « claimed » to the reporter's « ready », 1.15 s), the model route live, the woken runner polling 0.9 s after the resume, no timeout in the log. Fly's own calls varied between the two runs (create 33.1 and 36.5 s, sleep 1.7 and 5.4 s, resume 0.7 and 2.4 s). A computer asleep 40 s and woken: its runner polled 1.4 s after the resume call returned and the log holds no timeout (the 12 s stall of dev is the timeout fixed in `runner.mjs`).
**Not checked:** a first answer through the whole chain with a real model at Fly (the live check stops at the computer saying ready and its runner polling).

## What the beat says

`reporter.mjs` beats every 30 s (`KYBERNOS_REPORT_EVERY_MS`) with `{sessions, rss_mb}` and, when the Kybernos plugin can say it, two more keys: `load` and
`running_tasks`. They are the plugin's own reading of the machine (`GET /kybernos/automation-load` on the loopback, asked with `Origin: http://127.0.0.1:<port>` as
the claimer does, 2 s timeout), cut down to numbers and ids:

| Key | What it holds |
|---|---|
| `load` | `level` (`ok`, `busy`, `high`), `pressure` 0 to 100, `cpu_per_core`, `mem_avail_mb` (**MemAvailable**, never MemFree: the page cache makes MemFree read near zero on a healthy machine), `mem_total_mb`, `running`, `waiting`, `allowed` |
| `running_tasks` | up to eight `{task_ref, started_at}`: the automations that have a run going, by their own id |

Nothing is sent when the plugin does not answer, or when its reading is switched off or forced (`KYBERNOS_AUTOMATION_LOAD_GUARD=off`, `_FORCE`): that figure is not
the machine's. An older platform ignores the added keys (its schema strips them). The runs the plugin may start at once follow the machine's memory: one under
1.5 GB, two under 3 GB, three above (`KYBERNOS_AUTOMATION_MAX_PARALLEL` overrides; a first guess, not yet measured on a real computer). No prompt, name or result is in
a beat. The platform's half (one jsonb with a size bound, `load: null` after two minutes) is in the server's spec of 2026-10-23.

## What the person's laptop publishes here

A definition made on the person's laptop reaches the computer through the platform's outbox (the server's spec of 2026-10-23: the definition waits there encrypted, for
seven days at most, and is erased at the acknowledgement). Nothing dials in: the computer fetches it.

1. The platform says in its answers (`ready`, `heartbeat`, `schedule`) how many definitions wait: `pending_tasks`.
2. The reporter fetches them (`GET /v1/computer/tasks/pending`, at most 20), hands each to the plugin on the loopback (`POST /kybernos/tasks/apply`, one op per call: `{op: put | delete, ref, task}`)
   and acknowledges it (`POST /v1/computer/tasks/{op_id}/ack`: `applied`, or `error` with a code). DSH did not answer: nothing is acknowledged, the platform offers it again.
3. The plugin does the work, with its own rules and its own serialized write (`automation-published.mjs`): only six fields of the definition are read (name, prompt, schedule, active,
   approvals, needs), the task gets an id of its own and `published: { ref, at }` where `ref` is the laptop's id. A put for a ref that is there replaces it (the id, the history and the
   creation date are kept); a delete removes only a task with that ref, and removing what is not there is still `applied`. A task made on this computer is never touched.
4. Refusals, as codes the platform stores: `approval_path_missing` (only `auto` can be published: there is no approval prompt on a computer and no path yet to ask a person),
   `too_frequent` (a cron more often than every five minutes), `invalid_task`, `never_runs`, `invalid_op`, `invalid_ref`, `store_unreadable`.
5. The reporter then says the schedule again at once, so that the laptop sees the automation will fire. A published task is reported (schedule rows, runs, running tasks in the beat)
   by the laptop's id, not by its own.

The door is the plugin's `/kybernos/tasks/apply`: the same origin rule as the other task routes, but no signed browser session (the reporter has none); instead a token the reporter
keeps in `<DSH home>/kybernos/apply-token` (32 random bytes in hex, 0600, made at the first apply). A laptop has no such file, so the route refuses everything there. Tests:
`scripts/test-tasks-apply.mjs` (the real plugin), `services/computer-image/reporter-apply.test.mjs` (the reporter against a stand-in platform and DSH).

### What comes back to the laptop

The runs the computer reports ended (`POST /v1/computer/runs`: id, automation, how it started, how it ended, two times) are read back through the cloud plugin
(`GET /kybernos-cloud/computers/runs`, from the platform's `GET …/computers/{id}/runs`) and drawn by the page in three places, all from the same closed list of fields:

- the **Sessions** tab of an automation that runs in the cloud shows « Latest runs, reported by Home » (time, outcome, how it started, how long) and, while the beat says it is
  running (`running_tasks`), a « Running for … » card. The details of a run never leave the computer: this pane has no prompt and no result to show. When the automation also ran
  here before it was sent, a switch keeps the sessions from then one click away;
- the **tab count** and the **List** (Sessions column, success bars) count the cloud runs for such an automation, and the State column says « Home · last run failed » when the
  newest run ended in `error`, `timeout` or `capped`;
- the page asks the platform once per computer that has an automation linked to it, every 30 s (the tab asks for its own automation every 15 s, 60 s after a failure).

Not shown yet: why a run failed (the reporter sends only `run_failed`), the output of a run, and runs of an automation that was made on the computer itself and never published.

### An automation that asks first

The platform's spec of step 6 (the server half, on `feature/computers-task-outbox`'s successor): a published automation set to `ask` can stop before a sensitive action and ask its person.
DSH's own question card has nobody in front of it on a computer, so these runs are never given the asking permission preset; the gate is the cloud plugin's (`automationGate`, a
`tools/pre-execute` hook, next to the one for the turns that come from a messenger). The core plugin tells it which sessions are such runs through `Symbol.for('kybernos.automationRuns')`
(`of`, `wait`), the cloud plugin tells the core it is there through `Symbol.for('kybernos.computerGate')`; either missing, such an automation is refused at the apply door
(`approval_path_missing`) and such a run does not start.

1. A call that only reads (`TURN_GATE_SAFE_TOOLS`) passes. Any other call of the run, or of a sub-agent of the run, is put to the platform (`POST /v1/computer/approvals` with the automation's
   id, the run's id (its session), the kind and what the action will do) **and refused at once** with words that make the model stop: the run does not wait inside, because a person may take
   hours and a machine kept awake for it costs their run hours. The run is marked `waiting_approval` in the task list (so the reporter does not report it as ended; the schedule row says
   `waiting_approval`, reason `approval_pending`), and the question is written on the volume (`<DSH home>/kybernos/approvals.json`, 0600, three days).
2. While a question of the run is open nothing else is asked (two calls of one step, a sub-agent). A refused action is not asked again. A run asks at most three times.
3. The answer is fetched later: the plugin looks at `GET /v1/computer/approvals/decided` every 5 s while a question is open (every two minutes otherwise; the platform wakes a sleeping
   computer for a decision). Under the same lock as a question being put, each answer is matched to its record, the record is marked continued **before** anything is sent (a crash cannot
   make an action run twice), the run goes back to `fired`, and the SAME session is continued with one message: what was allowed (« allow once » passes that very action, kind and text with
   the spaces collapsed, once; « allow for this run » passes the rest of the run) or that it was refused or ran out. The answer is then acknowledged (`POST …/approvals/{id}/ack`); one that
   matches nothing here is acknowledged too.
4. The run is reported once, when it really ends.
5. At `ready` the reporter says `capabilities: ["ask_approvals"]` (the platform lets an `ask` definition through only for a computer that said so). It is the image's own claim: the plugin's
   door checks again, so a plugin older than the reporter refuses it and the laptop is told.

On the laptop the page draws it: « Waiting for your OK » on the Sessions tab of the automation (what it wants to do, three buttons: allow once, allow for this run, refuse; « also sent to
your phone » only when the platform says a message went), « Home · waiting for your OK » in the List, and the Where-it-runs tab offers `ask` only on a computer that can ask. Not built: « always
allow this » (a standing rule per automation, to be kept on the computer, shown and revocable on the laptop), an e-mail digest.
**Played on the real image** (2026-10-24, arm64 container, DSH 0.2.1-rc.2, a stand-in platform on the Mac and a stand-in model; the image built from the checkout with `KB_LOCAL`, nothing published):
`node services/computer-image/play-ask.mjs <image>` (and `DECISION=denied`) does the whole path in about two minutes and checks ten things: ready with `ask_approvals`, the definition applied, the
gate's question (the command, kind shell) put once, the run refused at once and not reported as ended, the schedule row `waiting_approval`, the answer taken, the SAME session continued with what was
decided, the action run once (or not at all when refused: no file), the run reported once. 10/10 for allowed and for denied. Played since on Fly dev with the owner's real tap (a refusal, 2026-10-24: see « Traps met »). Not played: production.
To build the image from the checkout without a release: `git archive <commit> | tar -x -C <folder>`, then `docker buildx build --build-context kbsrc=<folder> --build-arg KB_LOCAL=1 --build-arg DSH_VER=0.2.1-rc.2 -t kybernos-computer-base:<tag> packages/kybernos-gate/docker`
and the computer image as above (`-f services/computer-image/Dockerfile --build-arg BASE=...`, context the repository root).
Tests: `scripts/test-computer-approvals.mjs` (the two real plugins and a stand-in platform), `packages/kybernos-cloud/test-automation-approvals.mjs` (the rules),
`test-computers-publish.mjs`, `test-computers-view.mjs`, `packages/kybernos-plugin/test-where-it-runs.mjs`, `services/computer-image/reporter.test.mjs`.

## What it was checked to do

On the real platform (Fly.io, `ams`, `shared-cpu-1x` 2 GB, one 2 GB volume, 2026-10-14; one sample each, direction and not a guarantee),
created and driven by the server's driver (`pnpm computers:live` in the server repository):

| Step | Time |
|---|---|
| create the app, address, volume and machine, image pulled and machine started | 27 to 37 s (first pull of the 563 MB image) |
| from started to the gate answering `/__gate/health` | 0.1 to 7.6 s |
| sign in through the gate, then the suite's own route (`POST /kybernos/tasks`, `list`) answers | 1.7 to 3.2 s |
| suspend / resume | 3.0 to 3.7 s / 0.5 to 0.7 s |
| the route answers again after the wake | 0.1 s |
| an automation made before a suspend is still there after the wake | yes |
| a run due **while asleep** is fired by the computer's own scheduler after the wake | 5.4 s after the wake call (`history[0].status: "fired"`) |

## What a real run costs

Measured on this image (DSH 0.2.1-alpha.2, the suite at `v1.0.0-beta.8`, the `agent-preset` the suite installs, **no desktop or browser
driver**), with GLM-5.3 on the z.ai coding plan, 2026-10-14; the same image run in Docker on a Mac (the tokens are the model's, not the
host's), an automation made through the page and fired with `run-now`, its tokens read from the session's own projection:

| Run | Steps | Model time | Uncached input | Cache read | Output |
|---|---|---|---|---|---|
| « Reply with the single word OK », **first call of the day** | 1 | 5.2 s | **14,779** | 0 | 3 |
| the same, a minute later | 1 | 4.5 to 4.7 s | 59 to 620 | 14,144 to 14,720 | 3 |
| 30 CSV rows in the prompt, total revenue, best region and top product by a script | 2 | 15.4 s | 1,318 | 30,144 | 754 |

The answer of the third run was exactly the gold one. **A trivial run sends about 14.8 k input tokens**: that is the prompt (the
system prompt and the tool definitions), not the task; the study's own full profile sends 47.4 k for the same one-line task.
At z.ai's API list price (1.40 USD in, 4.40 out, 0.26 cache read per million tokens; models.dev) that is about **0.021 USD cold, 0.005
warm, 0.013 for the CSV run**; a 15-minute cron is 2,880 runs a month, 13 to 60 USD a month of model cost at list price depending on
whether the cache is still warm between two runs. The coding plan is a flat fee and lists 0.

## Traps met by the first real runs

- **A run that needs a tool waits for ever on the default permission preset** (`workspace-write`, approval `ask`): the session sat open,
  one tool step done and the second never started, with nobody at the prompt. `approvals: auto` on the automation does not help (it only
  declines to force the asking preset). The image therefore sets `defaultPreset: danger-full-access` (approval `never`): the machine is the
  boundary. An automation that wants a person's OK is the server's approval inbox (a later step), not a prompt.
- **The plugin's automations route does not take a `model`**: a task is fired with the profile's default model (`agent-default-model`),
  so the image's profile decides which model a computer uses.

## What the play check does, end to end

The server repository's `scripts/computers-play.ts` serves a platform behind a tunnel with the Fly driver and this image, and
`scripts/computers-play-check.ts` does what a person does, in order (2026-10-14, image `p5`, two runs, 79 and 82 s):

| Step | Result |
|---|---|
| create, boot, and `POST /v1/computer/ready` reaches the platform | 37 to 40 s |
| « Open »: the single-use link is accepted by the gate once, refused the second time | yes, 2 cookies |
| an automation made and fired on the computer; its run goes through **the platform's model route** (the computer's token as the key) | run counted, model use read from the ledger: about 0.021 USD for the trivial run |
| the computer reported its automation (`schedule`) and its ended run (`runs`) and beats (`heartbeat`) | yes |
| sleep, wake, delete | 3 s, 3 s, nothing left at the provider |
| the platform's meter against the provider's machine events | within 3 s |

**Not checked:** a cron over days, the egress guard against a hostile process (only that the platform stays reachable and the
machine's DNS survives), and a machine running longer than 5 minutes (see the trial trap below).

## Traps met

- **An answer that arrives just as the idle delay runs out can freeze the run** (real test on Fly dev, 2026-10-24, the owner refusing): the computer woke for its due run at 23:57:03, asked at 23:58:10, was answered at 23:59:03 and was suspended by the idle sweep at 23:59:15 (2 min 12 s after the wake), 12 s after the answer; nothing woke it afterwards (checked for 10 minutes), the task row stayed `waiting_approval` and no run was reported. When the answer comes while the computer sleeps (the first real test: 15 min asleep) `wakeForDecisions` wakes it in under 4 s, so that path is fine. What was done: the plugin now looks every 5 s (was 15 s) and a run that goes on after an answer is counted as running in the load the reporter sends (it was not: its first turn had ended and removed it from the tracker), so the next beat says busy; the platform side was proposed to Recette Serveur (restart the idle delay at the decision, and keep the no-sleep guard for any answer decided in the last ten minutes, taken or not).

- **DSH 0.2.1-rc.2 writes `[]` as the first line of an empty profile's `cordis.patch.yml`.** The block the image appends (permission presets, the model route) made the file invalid YAML ("end of the stream or a document separator is expected") and DSH stopped at every boot ("dsh stopped, restarting in 2 s", for ever, `ready` never sent). The Dockerfile and `render-profile.sh` now drop a lone `[]` line first (found 2026-10-24 by playing the image: no image had been built on rc.2 before).
- **The gate refuses a platform address that is not https unless it is loopback** (`KYBERNOS_GATE_TICKET_URL must be https`): a local run against an http stand-in platform passes a loopback ticket address of its own, or the container exits at once.
- **Size (measured 2026-10-24, rc.2):** 590 MB compressed (what a machine pulls: `docker image inspect` says 587 to 592 MB, the 563 MB written for alpha.2 is the same kind of figure) and 1.82 GB unpacked on disk. Docker Desktop's image list showed 2.55 GB for the arm64 build and 592 MB for the amd64 one: it counts differently from image to image, do not read a size off that list.

- **A trial organisation stops every machine after 5 minutes** (`Trial machine stopping. To run for longer than 5m0s, add a credit
  card`): the machine goes `stopped`, whatever the platform wants. A real test of anything longer needs a card on the organisation.
- **The guard must let ICMPv6 neighbour discovery through.** Fly's network is IPv6 (the resolver is `fdaa::3`): with a drop policy and
  no `icmpv6 type { nd-neighbor-solicit, nd-neighbor-advert, … }` rule, name resolution stops a few minutes after the boot
  (`EAI_AGAIN` for every name) and the reporter never says `ready`. Docker on a Mac is IPv4 only and cannot show it: check on Fly
  (`POST /apps/{app}/machines/{id}/exec` of the Machines API runs a command inside).
- **amd64.** An image built on Apple Silicon without `--platform linux/amd64` does not start on Fly.
- **The machine creation call is slow the first time**: Fly answers it once the image is there (more than 20 s for an image it has not
  seen), and its `wait` call is a long poll. A client timeout of 20 s reports an unreachable platform for a machine that was made.
- **A request in flight when the machine is suspended never comes back, and its timeout only counts the time the machine ran.** Measured on dev (2026-10-20): a message that woke a sleeping
  Home started its turn 18.8 s after it was queued, against 7 to 10 s on an awake one; the machine's own log, 12 s after the wake, says `[runner] POST /v1/runner/claim could not be sent
  (TimeoutError)` and one second later the same for the reporter's heartbeat: the loops were waiting out what was left of a 15 s timeout. The idle poll (`CLAIM_TIMEOUT_MS`, 4 s) and the beat
  (`HEARTBEAT_TIMEOUT_MS`, 6 s) are short, and the call after a failed one goes on a connection of its own (`wake.test.mjs`, real sockets). The price of a short poll timeout: a claim the platform
  processed but whose answer arrives late leaves its job leased to the runner until the lease ends (120 s); an answer takes tens of milliseconds, the timeout is a hundred times that.
- **A `start` right after a `suspend` can answer 409** (the machine still holds its lease for a moment): ask again a second or two later.
- **The gate's sign-in and the plugins' routes refuse a request with no `Origin`, or with another one**: a client sends
  `Origin: https://<its host>`, exactly the host the machine was told in `KYBERNOS_PUBLIC_HOST`.
- **Name resolution.** A fresh `*.fly.dev` name can be cached as absent by a local resolver for a while: a check goes by address
  (`curl --resolve`).
- **The registry.** `docker login registry.fly.io` takes an organisation token as the password; it lands in the Docker credential
  store: `docker logout registry.fly.io` when the push is done. The repository name is an app of the organisation. An image lives in **one organisation's registry**: machines of another organisation cannot pull it. `services/computer-image/push-image.sh` creates the registry app and pushes the local image for an organisation (`FLY_ORG`, `FLY_API_TOKEN` in the environment) and prints the `COMPUTERS_FLY_ORG` / `COMPUTERS_FLY_IMAGE` to set on the platform.
