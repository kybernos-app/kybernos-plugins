# Soft takeoff recette: strategy and preparation

Prepared 2026-11-03. **Nothing has been run.** No profile, DSH, server or account was touched; this folder is the plan, not a result.

A soft takeoff opens the product to a small invited audience, with a way back. This recette decides whether to open the door. It is a loop (test, triage, fix, test again) where cheap models do the legwork and deterministic scripts are the judges wherever a script exists.

| File | What it holds |
|---|---|
| `cases.json` | The matrix: 86 cases in six waves, each with a priority, a runner (script, cheap agent or owner), an environment and a status |
| `plugins.json` | The proposed bundle freeze: which of the 56 packages stay on, which go off for the takeoff, and why |
| `tester-brief.md` | The brief and the verdict format for the cheap tester (`.claude/agents/takeoff-tester.md` loads it) |
| `ledger.md` | The defect ledger, text only, written by the lead session |
| `scripts/soft-takeoff-run.mjs` | Runs the script cases and writes one verdict file each: the reference a cheap tester is compared with (`--light` runs the first wave) |
| `scripts/soft-takeoff-canary.mjs` | The two canary fixtures, one that passes and one that fails on purpose |
| `scripts/test-soft-takeoff-plan.mjs`, `scripts/test-soft-takeoff-run.mjs` | Keep the plan and the runner honest (run in the normal suite) |

## 1. The verdict rule

**GO** when, for every wave: all P0 cases pass; at least 90 % of P1 pass and each failing P1 has a written workaround in the ledger; no P0 or P1 defect is open; the unit suite has **no new red** against the baseline taken at the first run (never « zero red »); and the rollback rehearsal W5-04 passed. Otherwise **NO-GO**. The owner signs (W5-07).

P0 = money wrong, data leaking between spaces, cannot start or sign in. P1 = a visible defect in a core flow. P2 = polish.

## 1b. The light wave and the work in flight

`--light` marks 13 cheap cases (the gates, the canaries, and the tests of two features other sessions are building): it validates the process before the heavy waves, not the product. Cases also carry `watch`: **cloud-budget** (the session on Cloud budget and billing: Extra Cloud card, budget message, Cloud Computer in the composer, attachments for a machine) and **slides** (the session on slide creation and editing). Their code is not in `dev` yet, so the first run is a baseline; run those cases again when their branches land and any new red is theirs.

## 2. The order

The owner's order: what is visible first, then models, the cloud computer, billing and team.

| Wave | Focus | Runs on | Cases (ready now) | Exit |
|---|---|---|---|---|
| W0 | Gates and environment | none / replica | 9 (8) | gates green, preflight proves a request reaches the server for both accounts, canaries behave |
| W1 | What a person sees: first run, new chat, every page, Settings, languages, phone, five walkthroughs | sandbox + replica | 23 (21) | all P0 pass, ledger has no P0/P1 |
| W2 | Model consumption: Kybernos model, own key, local, free, failures, credit, several accounts | sandbox + replica | 14 (9) | same |
| W3 | Cloud computer, account B | staging | 13 (6) | same, plus egress played on a real Linux machine |
| W4 | Subscription, billing, team sharing | replica, then staging | 20 (10) | same, plus Stripe test-mode paths |
| W5 | Regression, upgrade and rollback, fresh install, go / no-go | all | 7 (4) | the verdict rule above |

W4's replica journeys do not need W3: they can start as soon as W2 is green. W3 and the staging half of W4 wait for the owner's go on paid resources.

## 3. Environments and the two accounts

| Tier | What it is | Cost | Who may use it |
|---|---|---|---|
| T1 replica | The server replica (`scripts/replica.ts` of the server repo), an embedded database, a stand-in model that bills the tokens it is told to, a mailbox; two sandbox DSH instances (A on 3098, B on 3110) behind a recording proxy. Started by `bash scripts/e2e-teams-run.sh up` | free | everything, first |
| T2 staging | A deployed test server, Stripe **test mode**, and a real Fly Cloud Computer for account B | Fly and model spend | only with the owner's go, **hosts named by the owner at go** |
| T3 production | Unauthenticated acceptance checks (`--deployed`) and the owner's own single purchase | none | agents never sign in on production |

- **Account A** is the desktop: a sandbox DSH with a personal space and two teams. **Account B** is the account whose DSH runs on a Cloud Computer (T2), or a second sandbox on T1 for the cases that do not need a machine (W4-20 first, then W3-08). **Persona C** is the newcomer: a sandbox that was never paired with an account, for the cases that need the first-run wizard (W1-01, W1-24).
- Accounts are made up. On T1 they are generated into `accounts.json` (mode 0600) in a private folder outside git. On T2 they use the test mail domain and Stripe test cards only.
- The runner refuses ports 3080, 8791 and 8792, runs under a sandbox HOME, and needs about 3 GB of disk per sandbox (15 GB were free on 2026-11-03).
- Evidence (screenshots, logs, verdict files) goes to `<private folder>/soft-takeoff/<run>/`, never to git (`AGENTS.md` rule 4).

## 4. The plugin freeze

`plugins.json` is a proposal: **33 on, 20 off, 3 services** (not DSH bundles), of which 14 are judgement calls marked `owner`. Off for the takeoff: Widget (`kybernos-pulse`), Kaby (`kybernos-kyber`, `kybernos-kaby-customisation`), the front desk and Telegram bridge, the three mini-app style creators (mini-apps, Bricks, Webapp creator), and the other bundles that have no live check yet. A bundle comes back one at a time once its own live check is green.

The freeze is applied to **sandbox profiles only**; the owner's real profile is never edited by this recette. Two things to check before it is final: turning Kaby off must not break a bundle that calls it (the boot and bundle-fault checks W0-05 and W5-05 must pass with it off), and `kybernos-computers` is the E2B sandbox with the person's own key, not the Kybernos Cloud Computer (that one lives in `kybernos-cloud`).

## 5. Who tests with which model

| Job | Model | Why |
|---|---|---|
| Run a scripted case, read the exit code, return the verdict | Haiku 5.5 | almost no reasoning |
| Walk a persona through the browser and report what was read and measured | Haiku 5.5 | clicking and reading |
| Triage failures: real bug, test bug or environment; severity; read the images that decide a visual verdict | Sonnet 5.5 | judgement |
| Fix | Sonnet 5.5; Opus after two failed attempts, or for server billing, security and cross-repo changes | |
| Go / no-go, anything with real money or real accounts | the owner | |

A cheap model can be wrong with confidence, so its verdicts are never proof by themselves:

1. **A script decides when one exists.** For a scripted case the tester only reports the exit code and the last lines; it never judges.
2. **Evidence or it is unknown.** Every agent verdict carries what was read (text, route, measured rectangle) and the artefact paths. A pass without evidence is recorded as `unknown`.
3. **Canaries.** Every Haiku batch starts with one known-good and one known-bad fixture (W0-07). A wrong canary voids the batch.
4. **Sampling.** One agent pass in five is re-checked by Sonnet; every agent fail is re-run once (by script, else by a second agent) before a ticket opens.
5. **Testers are read-only.** The lead compares `git status --porcelain` before and after each tester; any change voids the case.
6. **Pictures.** Haiku collects and measures. Images that decide a visual verdict are read by the triage model, as in the campaign of 2026-10-30. Read rectangles, not impressions.

## 6. The loop

```
run a wave → verdict files → triage → ledger row → fix (one branch per defect)
          → retest the failing case + its ring (same area + the W0 gates) → green: close; red: attempt +1
```

- **Caps.** Three fix attempts per defect, then the owner decides. Four rounds per wave, then stop and report.
- **Fixes** follow `AGENTS.md`: zero new engine patches, the dead-code rider, English in new text. A fix merges into `dev` only when its case and its ring are green, and gets a cheap regression test so the case becomes a permanent script.
- **Flaky.** A case that fails once and passes twice on re-run is `flaky` in the ledger and is not counted red (the rule of `run-all-tests.mjs`).
- **Stop rules.** A `STOP` file in the output folder ends a run between two checks (`check-all-live.mjs` already honours it); any run that reaches port 3080 is aborted; each wave has a token cap.
- **Time and cost.** Measured on the light wave: a Haiku tester that reads the brief and `cases.json` spends 70k to 100k tokens on a trivial scripted case (three runs: 71k, 87k, 99k, mostly re-read context), far above the 5k first assumed. So **a script case is run by `scripts/soft-takeoff-run.mjs` and costs no model token**; Haiku runs the 12 agent cases (about 150k each, still an estimate: about 1.8M tokens) and re-does one script case in five as a cross-check (about 10 x 80k). The lead pastes the case into the prompt instead of letting the tester read the matrix. The 116-check battery of 2026-10-30 took about 3 hours, so the 20 ready W1 scripts are roughly half an hour; say the duration before each run and replay only suspects on a fresh sandbox. The matrix has 58 scripted cases and 12 agent cases. The other 16 cases are the owner's.

## 7. Running it, once the go is given

```bash
node scripts/test-soft-takeoff-plan.mjs                  # the plan is coherent
bash scripts/sandbox/setup.sh                            # sandbox profile
node scripts/soft-takeoff-freeze.mjs --profile <sandbox profile>   # apply plugins.json (--dry-run first; --undo puts it back); restart the sandbox
node scripts/check-freeze-live.mjs                       # the frozen sandbox: hub normal, controls answer, every off bundle is 404 (W0-05, W1-15)
KB_E2E_DIR=<private folder> KB_SERVER_DIR=<server checkout> bash scripts/e2e-teams-run.sh up
source "$KB_E2E_DIR/env.sh" && bash scripts/e2e-teams-run.sh preflight
```

Each case's `cmd` in `cases.json` is the command to run; agent cases use `tester-brief.md`.

What the first full W1 run taught (details in `ledger.md`, « Process findings »):

- **Three sandboxes.** A (desktop account, port 3098), B (second account, 3110) and C (3120, never paired: the first-run wizard shows only there, and `kybernos/onboarding.json` must say `completed:false`). Cases that change onboarding state (W1-01, W1-24) run on C only.
- **The owner's leftovers sweeper stops sandboxes.** It stops one that has no client and no log activity for 10 minutes, or that is older than three hours, and a headless viewer does not always count as a client. Run the runner with `--before <command that starts the sandbox again if it is down>` and keep a watcher loop beside the Haiku testers. Not fixed at the source: see § 8 and § 9.
- **`source scripts/sandbox/env.sh` changes `HOME`.** Every path in a recipe is absolute, never `~`.
- **The replica session of an account lasts about two hours** and the DSH keeps saying « connected » after the GUI asks « Sign in again ». `node scripts/e2e-connect.mjs --dsh <host> --account a --force` disconnects and pairs again; restart the sandbox after it.
- **A live check that is killed can leave the sandbox changed** (W1-14 left a stand-in server registry with the model service off: every chat then failed « not signed in »). After a timeout, look for `kybernos/servers.json` and `kybernos-cloud-live-gate*` in the sandbox profile before the next case.
- **The walk driver** for the Haiku cases is `scripts/takeoff-walk.mjs` (steps in a JSON file; prompt in `tester-brief.md`). Do not edit the repository while a tester runs: it voids its `repo_clean`.
- **The sandbox is a clone of the owner's profile**, not a fresh install: his sessions and automations show up in it.

### 7b. Running W2 (models and consumption)

Prepared and run on 2026-11-03 after the owner's go (§ 9, questions 13 to 15; results in `ledger.md`). W2 uses the same three sandboxes as W1 plus the replica.

1. **Disk first.** `df -h /` must show 8 GB free or more (two sandboxes are APFS clones, but a chat and a replica add up). 10 GB were free on 2026-11-03.
2. **Never run the harness's `up` or `down` again** (`scripts/e2e-teams-run.sh`): `up` clones A and B again and recreates the accounts, `down` deletes the sandbox homes. The replica is already up (API 8821, control 8822, recording proxy 8820); `preflight`, `run <journey>` and `replica-reset` (§ 7c) are safe.
3. **Start the sandboxes with the keeper**, not by hand: `bash scripts/soft-takeoff-sandbox-up.sh "$HOME/.kybernos-sandbox/<A root>:3098" "$HOME/.kybernos-sandbox/<B root>:3110"` (it refuses the owner's ports and any folder outside `~/.kybernos-sandbox`, never runs `setup.sh`). The same command is the runner's `--before` and, with `--keep 7200`, the watcher beside a Haiku tester. Tested by `scripts/test-soft-takeoff-sandbox-up.mjs`.
4. **Pair both accounts again** if the replica session is older than two hours: `node scripts/e2e-connect.mjs --dsh <host> --account a --force`, same for `b`, then restart the sandbox.
5. **Order inside W2** (as run on 2026-11-03, about two hours with the fixes): W2-03, W2-07, W2-11, W2-05 (sandbox only, no money, no network; ten minutes) → W2-13 on C → W2-01 (replica, one minute) → **W4-09 (J4) before W2-02**, because J5 needs account B to be a member of T1 and only J4 makes it so → W2-02 (J5 last: it spends the 5-hour allowance, so it cannot be replayed in the same team for five hours) → W2-08 (the replica fails the stand-in provider; five turns, two minutes) → W2-12 (Ollama) → W2-10 (outbound) → W2-06. W2-09 and W2-14 wait (§ 8 item 12, question 16).
6. **Steering the stand-in model** (control port 8822, no sign-in): `POST /__/engine/reply {text, prompt, completion, delay_ms, gap_ms}` sets the answer and the tokens billed per call; `POST /__/engine/fail {match, status, n}` makes the calls whose provider address contains `match` answer `status` (the seed's address is `prov.example.test`), `{match:""}` ends it. Both live in memory: after a restart of the replica they are back to the default (« Hello from the replica's stand-in model. », 1 and 1 tokens). A tester must end every failure it starts.
7. **Pin the model.** The cases that bill need the Kybernos stand-in chosen in the composer (not Auto); a walkthrough tester is told which model to pick in its brief.
8. **Which cases touch the outside:** W2-10 (free search engines, real requests) and W2-12 (the machine's Ollama, loopback, under a second on the 0.8b model). The own-key half of W2-08 (a wrong key sent to a real provider) was not run: nothing plays it without a stand-in provider (§ 8 item 11). All others stay on the machine.
9. **After a killed case** look for `kybernos/servers.json` and `kybernos-cloud-live-gate*` in the sandbox profile (the same trap as W1-14), and for a custom provider named `sheet-test` or `audit-test` left by W2-03.

### 7c. A spent or expired replica (W4 journeys)

The replica keeps its own clock and its own pools: a full pass of the journeys (J5 spends the 5-hour allowance, J6's pool fill spends T3's pool and A's 7-day allowance) leaves it unable to play them again, and the sessions of both accounts last about two hours. The way back, found on 2026-11-03, touches no sandbox:

```bash
export KB_E2E_DIR=<private folder> KB_SERVER_DIR=<server checkout>
bash scripts/e2e-teams-run.sh replica-reset                       # a new replica and proxy: state, accounts, teams, plans, the pending invitation
bash scripts/soft-takeoff-repair.sh "<A root>:3098" "<B root>:3110"   # pairs both sandboxes again (3 tries each), restarts them, pins the model and the `standard` agent preset, runs the preflight
KB_E2E_SKIP_PREFLIGHT=1 bash scripts/e2e-teams-run.sh run j1 j2 j4 j5 j6 j7 j8 j9
```

The preset is pinned because a sandbox is cloned from the owner's profile, whose default preset (`minimal`) has a one-line prompt with none of the plugins' blocks: J2 reads « absent » on it (`KB_E2E_PRESET` overrides). A sandbox set up before this change needs `node scripts/pin-model.mjs --home <sandbox home> --preset standard` once, and a restart.

Order matters: J4 before J5 (B must be a member of T1), J6 fills T3's pool, J9 reads the proxy log and counts every request in its window (a retry from another workspace's DSH is counted). The reset deletes the recording of the old replica: copy `proxy.jsonl` and the `result-J*.json` files to the archive first if they are evidence.

The suites that need a browser or React skip themselves when their dependencies are missing, and a skip is never a pass. To make them run, export before the runner: `NODE_PATH` (a `node_modules` with react and react-dom, for the cloud client), `KB_BENCH_DEPS` (a folder whose `node_modules` holds playwright, react@18 and react-dom@18), `KYBERNOS_JSDOM` (jsdom) and `KB_CHROMIUM` (a browser binary). Paths are the tester's own and never go in git.

## 8. Still to build (not built, on purpose)

1. ~~Freeze applier~~ built: `scripts/soft-takeoff-freeze.mjs` (sandbox profiles only, backs up the profile, `--undo`) and its live check `scripts/check-freeze-live.mjs`. It proves the off bundles answer 404, not yet that their menu entries and Settings pages are gone: that is the walkthrough W1-21.
2. **Canary for the agent cases** (W0-07: a tiny page with a known defect). The script canaries W0-08 and W0-09 exist.
3. **Named tester agent.** `.claude/agents/takeoff-tester.md` is only loaded when a session starts: in the session that wrote it the agent type was « not found », so the light wave used a general-purpose agent on Haiku with the brief. Restart a session to load it.
4. **A `node_modules` for the skipped suites.** The whole-suite run skips 27 kinds of test for want of react, react-dom, jsdom and playwright-core (among them the rendered cloud client: footer chip and team switcher). Provide one and point `KB_NODE_MODULES` at it. Small.
5. **The several-accounts switch (W2-04).** Product work: a platform setting on the server and a refusal path in the cloud and models plugins. I searched the docs, READMEs and server modules on 2026-11-03 and found no such switch. Medium, after the owner decides what it forbids.
6. ~~Local-model turn and failure simulation~~ built 2026-11-03: `scripts/check-ollama-turn.mjs` (W2-12, engine level) and `scripts/check-model-failures-live.mjs` (W2-08), which uses the replica's control port (`/__/engine/fail`), not `fake-kybernos.mjs` (it only fakes cloud account and invitation routes). What is still missing is the DSH side of a local turn (W2-14, question 16).
7. **Staging for W3 and W4.** Hosts, Stripe test-mode wiring (not verified), Fly spend.
8. **A way to keep a sandbox past the sweeper.** A `sandbox.keep` marker (with a maximum age) honoured by the owner's sweeper, `scripts/restes-de-tests.mjs`. Small; it changes the owner's own tool, so it waits for his word.
9. **A model that can create.** The replica's stand-in model answers one fixed sentence, so W1-22 (ask for a skill, a command, a dashboard, a team) and the half of W1-03 that needs a creation cannot run. A cheap real model behind the replica, or a scripted model that writes the files, is needed.
10. **Orchestration.** A workflow that fans the Haiku testers out per wave. Running it needs the owner's explicit opt-in.
11. **A provider stand-in that fails.** The own-key half of W2-08 (429, timeout, out of credit on a key the person owns) has nothing to play against: `check-provider-sheet-live.mjs` starts a loopback fake provider (list, one good key, 404) that could answer 401, 429, 500 and a hang on request. Small, test-only.
12. **A fresh account on the replica.** W2-09 needs a person who has only the welcome credit; the harness creates accounts only in `up`. A `new-account` step in `scripts/e2e-teams-run.sh` (no re-clone) would make it. Small.

## 9. Questions for the owner

Defaults are what I will do unless told otherwise.

1. « Widget » is `kybernos-pulse` and « Kaby » is `kybernos-kyber` plus its customisation. Right? *(default: yes)*
2. Accept the 14 judgement calls in `plugins.json`? The ones that matter: Motion, Slides, Calls, Reference chips. *(default: as marked)*
3. What does the several-accounts switch forbid: (a) two Kybernos accounts in one DSH, (b) two keys for one provider, (c) one account on several devices? *(default: a and b forbidden by an owner switch; c out of scope)*
4. Which staging hosts may the testers sign in to with test accounts, is Stripe test mode already wired there, and is about one Fly computer-day of spend fine? *(no default: W3 and the staging half of W4 wait)*
5. Pictures: Haiku collects and measures, Sonnet reads the decisive images. *(default: yes)*
6. Can people manage plugins in the takeoff? `kybernos-registry` is frozen, so the Plugins page (W1-11) is not there. *(default: frozen, W1-11 blocked)*
7. Which server line does the replica run for the connectors catalogue (W1-14 needs the public catalogue route)? *(no default: W1-14 waits)*
8. Settings still talks about Kaby (Phone and channels, Learned skills) while the Kaby plugins are off. Hide it in the takeoff, or accept? *(default: accept, listed)*
9. On a phone, the new-chat shelf shows 3 columns with 9.5 px labels (fits, small) or 2 columns with 12 px labels (larger, more scrolling); and controls are 27 to 31 px high where a thumb wants 44. What floor do the checks enforce? *(default: floor stays 24 px, the wizard and shelf are listed for you)*
10. May I add the `sandbox.keep` marker to the leftovers sweeper (§ 8, item 8)? *(default: no, I keep the watcher loop)*
11. A real cheap model for the creation cases (§ 8, item 9): which one, and a spending cap? *(no default: W1-22 waits)*
12. When someone picks a language in the first-run wizard (say Français), should the app itself switch to it? Today the wizard only reads in that language and records it (T-011); the app stays in English until the person changes it in Settings › Language. *(default: left as is, listed; a French-speaking newcomer lands in English)*
13. **W2-04, the several-accounts switch.** *(answered 2026-11-03: default taken, the case is dropped from the takeoff)* Build it (a platform setting on the server and a refusal in the cloud and models plugins) or drop the case from the takeoff? And does it also limit the devices of one account? *(default: drop it from the takeoff, keep it in the ledger as a product gap; a and b forbidden by the switch if you build it)*
14. **Free models (W2-06).** *(answered 2026-11-03: default taken)* Is a real free model supposed to answer today, with no account and no key? The script only proves the locked state is told honestly. *(default: not promised; the page is checked, no real turn)*
15. **May W2 touch the outside?** *(answered 2026-11-03: yes to all three, default taken)* The free search engines (W2-10), one wrong key sent to a real provider (W2-08), and the real Ollama on this machine with the 0.8b model only (W2-12). *(default: yes to all three; no key of yours, no paid call)*
16. **Local model in the composer (W2-14).** The only model wired in DSH is your qwen3.5:9b (8.3 GB loaded on this 16 GB machine, which also runs the sandboxes), and the small test model `tev1:0.8b` is not in the signed catalogue so the page cannot wire it. (a) one turn on the 9b in the sandbox, (b) wire the 0.8b by hand in the sandbox's configuration, (c) leave the DSH side of local models to you. *(default: c; the engine itself is checked by W2-12)*
17. **Your default agent preset is « Minimal ».** With it a chat's system prompt is one line and none of the plugins' prompt blocks reach the model: not your personal memories, not an approved team lesson. The memory tools (`memory_search`, `lesson_search`) still answer. Is that what you want for your own chats? *(default: left as is, listed; the recette sandboxes run `standard`, which carries the blocks)*
18. **A lesson the owner approves can take up to 5 minutes to reach a teammate's running team DSH** (`TEAM_TUNING.ttlMs`); a DSH that starts after the approval has it at once. Acceptable, or should opening the team's lessons page, or the approval, refresh it sooner? *(default: acceptable, listed; J2 restarts the member's DSH)*
