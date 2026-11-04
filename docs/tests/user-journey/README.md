# User-journey recette: from the first visit to leaving, on every surface

Prepared and first run 2026-11-04. This folder is the plan, its guard and the ledger of what the runs found (`ledger.md`: findings, passes with a real measure, the unit-suite baseline); the evidence (pictures, logs, verdict files) stays outside git. Nothing was run against the owner's own DSH, a live server, a real Stripe account or a real machine: the money paths ran on the replica's Stripe stand-in, and the steps that need a real card or a real device are the owner's.

It extends the soft-takeoff recette (`docs/tests/soft-takeoff/`, 86 cases, its runner, its ledger and its tester brief) and does not replace it: a case here with `covers` re-uses a soft-takeoff case instead of repeating it. What it adds is what that recette left out: the public site and its legal pages, the phone app, the Electron app, install from source, the phone remote, every payment failure, refund and dispute, the e-mails, the consumption maths of models and cloud computers, pushing work to a computer, Kaby, every kind of creation, automations and skills, 11 languages and the themes, resilience, security and a way out.

| File | What it holds |
|---|---|
| `cases.json` | The matrix: 261 cases in 22 journeys. 110 scripted, 98 agent, 7 vision and 46 owner cases. Each has a priority, a runner, an environment and a status |
| `journeys.md` | The story of each journey: who, path, what is broken on purpose, where the expected value comes from |
| `known-gaps.md` | 29 candidates found by reading, before any test: missing handlers, stale words, features not built. KG-13 (no provider-busy fallback, no server-side Auto), KG-26 (build the replica from `origin/dev`, not the older local `dev`) and KG-27 (the mails Stripe sends are a dashboard setting) are not expected by one case but shape how the run is set up |
| `vision-protocol.md` | How a cheap model collects and measures, how its recall is measured with ten planted defects, the rubric the stronger model applies |
| `ledger.md` | The defect and enhancement ledger, text only, written by the lead session |
| `scripts/test-user-journey-plan.mjs` | Keeps the plan honest (run in the normal suite): ids, runners, scripts that exist, soft-takeoff cases that exist, known gaps that are written down, no agent asked to type a card |

## 1. The rule of the verdict

The verdict rule of `soft-takeoff/README.md` §1 stands: all P0 pass, 90 % of P1 with a written workaround for each failing one, no open P0 or P1 defect, no new red in the unit suite, rollback rehearsed, and the owner signs. Two additions:

- A case in status `gap` passes when the product does **not** promise the missing feature and the gap is in the ledger. It becomes an enhancement, never a defect, unless a screen promises what is not there.
- A `no finding` from a cheap model on a picture is not a `pass` (`vision-protocol.md`).

## 2. Environments, profiles and gates

| `env` | What it is | Money | Who may use it |
|---|---|---|---|
| `none` | Unit tests, static checks | none | scripts |
| `sandbox` | A sandbox DSH with the soft-takeoff freeze (33 bundles on) | none | everyone |
| `full` | The same sandbox with the freeze undone (`soft-takeoff-freeze.mjs --undo`): Kaby, Pulse, the front desk, Telegram bridge, mini-app creators, every bundle on | none | everyone |
| `replica` | The server stand-in with its mailbox, its Stripe stand-in (`/__/stripe` pay, refund, dispute, redeliver, subscription) and a stand-in model; built from `origin/dev` | none | everyone |
| `staging` | The deployed test server with Stripe in test mode and the test mail domain | Stripe test mode only | the owner names the host at go |
| `machine` | A real cloud computer on the test server | Fly and model spend | the owner's go and a spend cap |
| `device` | The iOS simulator, the Android emulator, an installed desktop app, the owner's phone | none | agents on simulators; the owner on his phone |
| `site` | The public website, read only, unauthenticated | none | agents |

**Gates before any step that could cost money** (a script, run first, refusing otherwise): the host is the one the owner named; the checkout session id starts with `cs_test_` and the publishable key with `pk_test_`; no `sk_live` or `pk_live` string is present anywhere in the evidence; every customer, clock, computer and sandbox created carries the tag `recette-<date>` so J22-05 can remove them and sum the cost.

**Ports and profiles.** The runner refuses ports 3080, 8791 and 8792, runs under a sandbox HOME, and never edits the owner's real profile (soft-takeoff §3). The `full` profile is a clone like the others and needs about 3 GB.

## 3. Who types the card

The owner types the test card on Stripe's hosted page; an agent never types a card number, and the guard refuses a case that asks one to. Everything around the page is not the owner's work: the lead prepares the checkout, an agent records the plan, the credits and the banners before and after, and the server-side steps (replayed notifications, forged signatures, test clocks, refunds and disputes through the Stripe test API with `pm_card_*` tokens) are scripts that read the server's private test environment file, which an agent never opens. The cards named in the cases are Stripe's published test cards; check them against Stripe's test-card page on the day.

| Card | Used for |
|---|---|
| 4242 4242 4242 4242 | a payment that succeeds |
| 4000 0027 6000 3184 | 3D Secure required |
| 4000 0000 0000 0002, 9995, 0069, 0127, 0119 | declined, insufficient funds, expired, wrong CVC, processing error |
| 4000 0000 0000 0341 | attaches, then every charge fails (a failed renewal) |
| 4000 0000 0000 0259 | a charge that becomes a dispute |

## 4. Faults put in on purpose

| Family | How it is injected |
|---|---|
| Payment | the cards above; Stripe test clocks; refunds and disputes in the test dashboard or API; `/__/stripe` on the replica |
| Notifications from Stripe | the same event twice, out of order, a bad signature, an old timestamp, the wrong mode or instance, a refund before its payment, a dropped event (the reconcile job) |
| Model provider | `POST /__/engine/fail {match, status, n}` on the replica: 402, 429, 403, 502, 503; a wrong own key |
| Network | the recording proxy of the replica: cut, slow, cut at a precise step |
| Time | the sandbox clock, the Stripe test clock, a time-zone and a daylight-saving jump |
| Machine | Fly stop, a full volume, a hard kill, a hostile process under the egress policy |
| Process | `kill -9` of the engine in the middle of a turn and of a save |
| Disk | a small volume mounted as the sandbox home |
| Data | hostile strings (HTML, script, right-to-left marks, emoji, very long), corrupt and huge files, the hidden-text vectors of `docs/dev/hidden-text-vectors.json` |
| Server flags | each of `computers_enabled`, `telegram_enabled`, `whatsapp_enabled`, `channel_computer_turns_enabled`, `mcp_kaby_enabled`, `welcome_credit_cents`, `free_idle_delete_days`, `past_due_grace_hours` at 0 and at a real value |

## 5. Where the expected value comes from

A test that takes its expectation from the screen proves only that the screen agrees with itself. So: prices, limits and allowances from the server's `catalogue/*.json`; costs from the model prices in nano-dollars (`scripts/audit-consumption.mjs`, to build, recomputes a scenario from the catalogue and compares it with the ledger, the pot, the gauge and every page that shows it); computer charges from the rent and awake rates, hour by hour in UTC; roles from the server's roles table; schedules from the occurrence calculator's own table; wording of refusals from one collection across the three surfaces (J21-07).

## 6. Who judges, and with which model

| Job | Model |
|---|---|
| Run a scripted case, return the exit code and the last lines | Haiku (the `haiku` model of the Agent tool, currently Haiku 5.5) |
| Walk a persona and report what was read and measured | Haiku |
| Read the pictures that decide a visual verdict; triage: real bug, test bug, environment, enhancement; severity | Sonnet 5.5 |
| Fix | Sonnet; Opus after two failed attempts, and for billing, security and cross-repository changes |
| Real money, real stores, a real phone, a legal sign-off, go or no-go | the owner |

The rules of `soft-takeoff/README.md` §5 hold: a script decides when one exists; a verdict without evidence is `unknown`; canaries start every Haiku batch; one agent pass in five is re-read by Sonnet; every agent fail is re-run once before a ticket opens; testers are read-only (`repo_clean`). New here: **one walker per sandbox and per account** for any case that changes state (two walkers on one profile corrupt each other's start); read-only looks may share one. At most six walkers run at once. A trivial scripted case cost a Haiku tester 70,000 to 100,000 tokens in the light wave, so a script run is done by the lead with the soft-takeoff runner, and an agent is used only where the case has no script.

## 7. Bugs and enhancements

Everything goes to `ledger.md`, one row each, with: id, case, kind, severity, where, repro (three lines), evidence (paths outside git), first seen, status.

| Kind | Meaning |
|---|---|
| `bug` | the product does something wrong or says something false |
| `gap` | something the reading found not built; becomes an enhancement unless a screen promises it |
| `enhancement` | works, but a person would be better served (from the ergonomics questions of the rubric) |
| `test-bug` | the case or its script is wrong |
| `env` | the environment misbehaved (a replica session expired, a sandbox swept) |

Severity as in soft-takeoff: **P0** money wrong, data leaking between spaces, cannot start or sign in; **P1** a visible defect in a core flow; **P2** polish.

## 8. The loop, in rounds

```
round → verdict files → triage → ledger → fix (one branch per defect, from dev, in a worktree)
      → retest the failing case and its ring → green: merge into dev; red: attempt +1
```

Three fix attempts per defect, then the owner decides; four rounds per wave, then stop and report (soft-takeoff §6). A fix follows `AGENTS.md`: no new engine patch, the dead-code rider, English in new text, and it leaves a cheap regression test behind, so the case becomes a permanent script. **The duration of a round is said before it starts**, and only suspects are replayed on a fresh sandbox.

Order of the rounds, each needing the one before it green unless marked parallel:

| Round | What | Journeys |
|---|---|---|
| R0 | Gates, the plan guard, soft-takeoff W0, preflight, canaries, the ten planted defects for vision recall | none |
| R1 | Nothing to pay, nobody to sign in (parallel with R2) | J01, J21, J20-02, J20-11, J18-01, J02-05, J02-07 |
| R2 | Account and first run, the Electron app on macOS, the phone app on the simulator | J05, J02, J03 |
| R3 | Money on the replica, every fault | J06-08, J06-10, J07-07, J08-02, J08-03, J08-06, J08-07, J09 |
| R4 | Money on the staging server, the owner paying | J06, J07, J08, J09-01, J09-13 |
| R5 | Models and connectors | J10, J11 |
| R6 | Cloud computer, with the spend cap | J12, J13, J17-05 |
| R7 | The full profile | J14, J15, J16, J17 |
| R8 | The look matrix and the vision passes | J18, the vision cases of every journey |
| R9 | Phone remote and the phone app in depth | J04, J03 rest |
| R10 | Resilience and security | J19, J20 |
| R11 | Leaving, then cleaning up and summing the cost | J22 |
| R12 | Regression: every red replayed, W5-01 to W5-07, the owner's go or no-go | all |

## 9. What the owner must decide or supply

1. The staging host, and the go to use it with Stripe in test mode (the owner said the test server and test cards are available; the name is still needed).
2. A Fly spend cap for R6, and the go to create real computers.
3. Who does the dashboard actions that need a Stripe login (clocks, dispute evidence, refunds): the owner, or scripts with the test key file the server already uses.
4. The meaning of « Vercel models »: this plan reads it as the Vercel AI Gateway provider the person adds with an own key (J10-07, which needs a key from the owner) and Vercel as the host of the published `*.kaby.app` pages; the server itself does not route through Vercel.
5. The server flags on the staging server for the full run (the list in §4), and a non-zero welcome credit so signup can be seen.
6. A Windows machine and a Linux desktop (J02-03, J02-04), his phone (J03-15), and his store accounts if purchases are to be tested for real (J03-07; the plan tests the StoreKit configuration only).
7. A lawyer's reading of the legal texts (J20-12), without which J01-04 stays red.

## 10. Running it

```bash
node scripts/test-user-journey-plan.mjs                          # the plan is coherent
KB_SERVER_DIR=<server checkout> node scripts/test-user-journey-plan.mjs   # also checks the server test files the cases name
node scripts/test-soft-takeoff-plan.mjs                          # the plan this one extends
```

Each case's `how` is the command, the brief or the owner's request. Script commands that start with `(server repo)`, `(website repo)`, `(mobile repo)` or `(desktop repo)` run from that checkout; those that start with `(to build)` do not exist yet and their case is `needs-build`. Evidence (pictures, verdict files, recorded traffic) goes to a private folder outside git, never to the repository.
