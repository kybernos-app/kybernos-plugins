# Porte-spec — Lot 1 "Kaby proactive" (spec-validation gate)

Stage `porte-spec` of the kyber `dev-team`, 2026-10-28. Branch `feature/kaby-proactive-lot1`
(worktree `kybernos-plugins-proactive`). Validator: SPEC VALIDATOR, assisted by three delegated
pair reviewers (B1/B2, B3/B4, B5/B6); every reviewer claim quoted below was re-verified against
the tree before inclusion. Spec phase only: this gate validates the specification package before
any implementation is delegated.

Package reviewed (14 documents): `cartographie.md`, `cadrage.md`, and the six spec/strategy pairs
(`gate-static-checks`, `gate-trial-proof`, `host-gate-and-queue-routes`, `initiative-queue`,
`automations-gate-ui`, `pulse-proactive-notify`). All six strategies were read line-by-line; the
sampled line anchors (`index.js:449,765,3181,3261,3336,3476,3597,11401-11403`,
`client.js:477,7406,7628,21183,22763,23111,23239,31360`, `automation-suggest.mjs:7`,
`automation-runs.mjs:31`, `automation-tools.mjs:47`, `pulse-core.mjs:12,226`) all match exactly.
DoD premises and failure modes were verified **by execution** on the pre-edit tree (Node v26.7.0).

## Verdict

**AMEND** — the batch decomposition, the wave order, the write-set ownership and the four hard
invariants are sound *as stated*, but 18 MAJOR findings must be fixed in the documents before any
implementation starts. The four most severe are **invariant-1 holes in B3's enforcement plan**
(findings 1-4: three existing run paths escape the gate tooth as planned). The rest are five
cross-batch contract contradictions, two B1 word-table contradictions, four non-discriminating or
hand-only test constructions, and one repo-rule violation. Nothing is structural: every item is a
precise edit to a spec; no batch needs to be merged, split or re-scoped (except possibly one
re-cadrage line for finding 3/9).

---

## Checklist

### 1. Six anchored markers per strategy file, sections executable — **PASS with 2 exceptions (findings 16, 31)**

All six strategy files carry `e2e:`, `vision:`, `capture:`, `maquette:`, `unit:`, `DoD:` at line
start (anchored `^` grep: `automations-gate-ui-strategy.md` 74 anchored lines,
`gate-static-checks-strategy.md` 43, `gate-trial-proof-strategy.md` 6,
`host-gate-and-queue-routes-strategy.md` 11, `initiative-queue-strategy.md` 6,
`pulse-proactive-notify-strategy.md` 6; no marker-like text is mis-anchored).

Sections are executable, not prose: every journey is a pastable command with exit-code semantics
(`gate-trial-proof-strategy.md:28-56` replays a real journal with an honest `exit 3` skip;
`host-gate-and-queue-routes-strategy.md:181-205` runs measured DoD commands;
`pulse-proactive-notify-strategy.md:374-430` runs three heredoc Node assertions;
`initiative-queue-strategy.md:209-251` pastes full `node -e` batteries). The "no visible surface"
sections (B1 `gate-static-checks-strategy.md:210-222`, B2 `gate-trial-proof-strategy.md:158`,
B3 `host-gate-and-queue-routes-strategy.md:131`, B4 `initiative-queue-strategy.md:161`) each give a
reason and transfer the obligation (B5 owns the mockup). **Exceptions:** B6's `maquette:` gate is a
hand check with no command (finding 16); one B4 e2e line is a literal ellipsis (finding 31).

### 2. DoD discriminating (would fail on today's code) — **PASS with 2 exceptions (findings 14, 15)**

Every DoD states its today-red behaviour and, where checked, it holds: `'gate-panel'`,
`tasks.gate.st`, `kbGateToggleIntent`/`kbGateCanApprove`, `// <kbgate-ui>` absent from `client.js`
(0); `automation-gate.mjs`, `automation-trial.mjs`, `initiative-queue.mjs` and the four new test
files do not exist; `gate-check`/`trial-start`/`trial-report`/'queue act', the gate imports,
`initiative` in `automation-tools.mjs`, and the pulse gate/queue symbols all absent (0 each).
Measured reds recorded by the strategies were reproduced: B4's D1-D6 failure messages
(`initiative-queue-strategy.md:253-263`), B6's A/B/C texts (`TypeError: core.gateItemFor is not a
function` …), B1's `MODULE_NOT_FOUND` (`gate-static-checks-strategy.md:312-315`); honest labels for
today-green checks (`gate-trial-proof-strategy.md:227`, `host-gate-and-queue-routes-strategy.md:207`).
**Exceptions:** B3's DoD 5 can never pass as written (finding 14) and B5's i18n DoD line is green
today with its real assertion in prose (finding 15).

### 3. Write sets disjoint; the four shared files claimed exactly once — **PASS (with 2 bookkeeping items)**

`packages/kybernos-plugin/index.js` → B3 only (`host-gate-and-queue-routes.md:11`);
`client.js` → B5 only (`automations-gate-ui.md:8-9,37`); `automation-tools.mjs` → B4 only
(`initiative-queue.md:19,328`); `packages/kybernos-pulse/*` → B6 only
(`pulse-proactive-notify.md:11-12`). No cross-writes anywhere: B2 excludes the others explicitly
(`gate-trial-proof.md:12-15`), B4's G6 asserts disjointness (`initiative-queue.md:328`), B6 lists
its "Not touched" set (`pulse-proactive-notify.md:521-525`); grep over the other five specs finds
no write claim on any of the four. Bookkeeping: findings 22 (B5's declared amendments not ratified
in `cadrage.md`) and 23 (B6's deferred README lines).

### 4. Invariants hold everywhere — **FAIL as planned (findings 1-4); statements are correct**

All four invariants are correctly stated in `cadrage.md:25-40` and carried by every batch contract
(see the confirmed-clean notes). But B3's enforcement plan — the batch that "owns" invariant #1 —
leaves three existing run paths uncovered (findings 1-2), does not put the activation flip behind
the human seam (finding 3), and never applies the runtime write-refusal that invariant #3 names
(finding 4). As planned, "activation only after explicit human approval" is not enforced on the
scheduled run path.

### 5. No cross-batch contradiction; shared shapes reused — **FAIL (findings 5-11, 20-21, 27-29)**

The three frozen shapes are respected in substance (B4 reproduces `InitiativeEntry` verbatim and
asserts the exact on-disk keys, `initiative-queue.md:155-172` + D6; B3 §5.1 "cadrage's GateRecord,
unchanged", `host-gate-and-queue-routes.md:198-200`; B5 §4 "used verbatim",
`automations-gate-ui.md:105-107`; B6 "adds no field to them", `pulse-proactive-notify.md:120-123`;
B2's `ProofReport` reproduced unchanged). But the cross-batch **function and wire contracts**
contradict each other in seven places (findings 5-11) and seven smaller alignments are needed.

### 6. Repo rules — **FAIL (finding 18)**

English: `cartographie.md` is French (finding 18); the rest is English (French guillemets as quote
marks, finding 32). Personal paths: none in tracked content (the only `/Users/` strings quote the
rule itself, `cadrage.md:42`, `initiative-queue.md:412`; B6's maquette CSS source `~/.dsh/skills/…`
passes `garde-depot.mjs` but is machine-local — finding 26). Media: PNG names only as `/tmp`
capture outputs outside the repository; `garde-depot.mjs` at 0 error is in several DoDs. Engine
patches: none — plugin seams only, forbidden explicitly (`host-gate-and-queue-routes.md:341`,
`automations-gate-ui.md:367`, `pulse-proactive-notify.md:431`). DSH boot safety: namespace imports
behind guarded accessors (`host-gate-and-queue-routes.md:167-173,301`), B1 dependency-free by
test, B6 degrades to today's behaviour when no feed exists (`pulse-proactive-notify.md:111-116`).

---

## Findings (severe first)

### A. Invariant-1 holes in B3's enforcement plan (fix before B3 implementation)

| # | Where | Finding | Fix |
|---|-------|---------|-----|
| 1 | `host-gate-and-queue-routes.md:33-34,126-129,400` vs `index.js:3085-3091,3578-3584` | **The scheduled run path escapes the gate tooth.** B3 claims "Every existing 'make it run' path (`toggle` on, `run-now`, `consume-fire`, the webhook fire) is **closed**" and "all four proven" — but the 30-s scheduler fires through `kbMakeTrigger({ store: kbTasksStore, fire: (task) => kbFireTask(task), … })` (`index.js:3085-3091`, tick loop `:3578-3584`), and no §10.1 edit row touches it. A gated, unapproved, active automation still runs on schedule. | Add a gate tooth where the trigger fires (or inside `kbFireTask`), a §10.1 edit row and a test row asserting a gated-but-unapproved automation never fires on its schedule. |
| 2 | `host-gate-and-queue-routes.md:130` vs `index.js:448,3275,3312` | **`update` and `cloud-link` can write `active: true` on an unapproved gated automation.** `kbSanitizeTaskInput` defaults `active: r.active !== false` (**true**, `index.js:448`), `update` merges `clean.task` (`:3275`), `cloud-link` bring-back sets `t.active` (`:3312`, declared out of scope at `:345`). B3's update row only demotes the gate — so an edit both resets the gate to `draft` and (re)activates the task, which the ungated scheduler (finding 1) then runs. This defeats the row's own claim that demotion makes "approve an innocent draft, then edit it into a dangerous one" impossible. | Gate the `active` flip in `update` and `cloud-link` exactly like `toggle` (an edit may not raise `active` on a gated automation without `approval.state === 'granted'`); add both to the edge-case table and the bypass tests. |
| 3 | `host-gate-and-queue-routes.md:80,133-136` vs `cadrage.md:72` | **The activation flip is not behind the human seam.** `HUMAN_ONLY = ['trial-start', 'approve', 'queue act']` — `toggle` is absent, yet the frozen status says `activated` is "approved AND switched on by the human action — **never by code alone**". A model-reachable in-process `toggle { active: true }` (any tool holding `deps.tasks` = `kbTasksHandle`) on an `approved` record writes `active: true` + `activated` "by code alone". | Require `human` for the *activation* transition of a gated record (pausing can stay open: "active: false is never gated", :126), or re-cadrage `cadrage.md:72` — one of the two, decided explicitly. |
| 4 | `cadrage.md:31-33` vs `host-gate-and-queue-routes.md:289-292` + `host-gate-and-queue-routes-strategy.md:71-72` | **The trial's read-only mask is never applied at runtime.** Invariant #3: "runs with write tools refused (read-only mask…)". B3 forces only `approvals: 'ask'` + `active: false` and its dirty-trial variant proves **post-hoc detection** (`sideEffectFree: false` after a `send`/`write` call ran); B2's `TRIAL_MASK = 'deny-writes'` is "the two constants B3 must apply" (`gate-trial-proof.md:187-188`) and `TRIAL_DENY_REASON` (:91) presumes a runtime refusal that no spec implements. Detection after the fact ≠ refusal: on this plan the write can already have happened. | Specify who refuses write calls at trial time (e.g. the `kbMcpGate` seam or the run's ask preset denying with `TRIAL_DENY_REASON`), wire it into `trial-start`'s mechanics, and add the strategy assertion that a write call in a trial is *refused at runtime*, not merely recorded. |

### B. Cross-batch contract contradictions (fix before the affected waves)

| # | Where | Finding | Fix |
|---|-------|---------|-----|
| 5 | `host-gate-and-queue-routes.md:152,156` vs `initiative-queue.md:63,178-179,187` | **`deps.initiatives` vs `deps.initiative`: B4's tools can never mount.** B3 wires `initiatives: { add: …, list: () => … }` and says the tools mount "only when `deps.initiatives` carries both functions"; B4's guard is `if (deps.initiative !== undefined …)` and it calls `deps.initiative.add(…)` / `deps.initiative.list(status \|\| undefined)`. Key name mismatch (plural vs singular) and B3's `list: () =>` drops the `status` argument. B4 owns `automation-tools.mjs`, so B3's wiring is the deviation. | B3 adopts `deps.initiative` (singular) with `list: (status) => …`, matching B4's guard and its DoD D3 (`initiative` key). |
| 6 | `host-gate-and-queue-routes.md:115,187` vs `initiative-queue.md:149-152,279-281` | **`queue act` vocabulary and wire body disagree with B4.** B3: body `{ id, act: 'ask' \| 'add' \| 'drop' }`, refusal `unknown act`, `resolve(id, act)`; B4: `resolve(id, status)` with `status ∈ {'asked','added','dropped'}` (the frozen `InitiativeEntry.status` vocabulary, `cadrage.md:109`), refusal `unknown status`, wire shape `{"action":"queue act","id":…,"status":"asked"}`. As written every `queue act` call is refused at the module door. | B3 maps or passes the frozen statuses end-to-end (recommended: adopt B4's `status` wire vocabulary — it is the frozen one), and the route table + required-export table say the same word. |
| 7 | `host-gate-and-queue-routes.md:186` vs `gate-trial-proof.md:122` | **`trialFromEvents` contract contradiction.** B3's table: `trialFromEvents(events, { gateId, runId }) -> ProofReport`; B2 defines `trialFromEvents({ trial, events, at }) -> { trial: TrialRun, proof: ProofReport \| null }` — different argument shape and return. B3's own stop rule (:183-184) would halt at integration. | Correct B3's table to B2's signature and name where `trial` comes from (`startTrial`). |
| 8 | `host-gate-and-queue-routes.md:186` vs `gate-trial-proof.md:147` | **`normalizeGateRecord` second-argument contradiction.** B3: `(raw, statuses)`; B2: `(raw, opts)` with `opts: { at }` (B2 normalizes against B1's exported `GATE_STATUSES` itself). | B3's table becomes `(raw, { at })`. |
| 9 | `host-gate-and-queue-routes.md:187,114` vs `initiative-queue.md:72,83-87,277` + `cadrage.md:207` | **Invented `cap` member and envelope field.** B3 requires `makeInitiativeQueue(…) -> { add, list, resolve, cap }` and answers `{ ok: true, items, cap }`; B4 returns `{ list, add, resolve }` (cap only as exported `INITIATIVE_MAX = 8`) and its route shape is `{"ok":true,"items":[…]}`; `cadrage.md:207` says "add/list/resolve" only. | Either B4 adds `cap` (and says so) or B3 reads `INITIATIVE_MAX` and drops `cap` from the envelope; align `cadrage.md` if the member is added. |
| 10 | `automations-gate-ui.md:50-57,95` + `pulse-proactive-notify.md:101` vs `host-gate-and-queue-routes.md:355-370` | **`task.gate` on `list` is consumed but never produced.** B5's read path: "the gate rides on the existing list… `POST { action: 'list' }` → unchanged, plus ONE optional field per task" (`Task { …; gate?: GateRecord }`), degradation "no `task.gate` → this host does not check"; B6's feed #2 reads `task.gate` from `tasks.json`. B3's 13-row edit table never touches the `list` answer and B3 mentions `task.gate` nowhere (grep 0): the panel would sit permanently on `unknown`, feed #2 is dead. | Add one B3 edit row attaching `kbGateBoundedRecord(...)` per task on `list` (this also settles finding 11's option 2), or declare `list` unchanged and re-point B5/B6 — in both consumer specs. |
| 11 | `pulse-proactive-notify.md:97-101,219-221,527-531` vs `host-gate-and-queue-routes.md:209` / `initiative-queue.md:263,292` | **B6's data feeds are unclaimed and mis-pathed.** (a) The seams `Symbol.for('kybernos.gate-records')`/`'kybernos.initiative-queue'` are assumed "published by the bundles that own the storage"; B3 publishes none and B4 says "nothing else is exported" (`initiative-queue.md:292`). (b) The file fallbacks `<home>/kybernos/automations/gate-records.json` / `…/initiatives.json` contradict the real stores (`gates.json` beside `tasks.json` per B3 §5.2 and `index.js:2616`; `initiatives.json` beside it per `initiative-queue.md:263`) — wrong directory **and** wrong gate file name. (c) B6 §13 hands the decision to B3 and no batch answers. Pillar (C)'s core feed is undetermined in the package. | One decision recorded in B3 (and echoed in B4/B6) — the `task.gate` projection of finding 10 serves B5 and B6 at once — then fix B6's fallback paths to `gates.json`/`initiatives.json` beside `tasks.json`, or drop the file fallback. |

### C. B1 word tables (fix before B1 implementation)

| # | Where | Finding | Fix |
|---|-------|---------|-----|
| 12 | `gate-static-checks.md:133,139` vs `index.js:765-772` | **The word tables cannot satisfy their own parity rule.** `GATE_SEND_WORDS`/`GATE_DELETE_WORDS`/`GATE_PAY_WORDS` must be a "⚠ **subset** of `KB_MCP_WRITE_WORDS` — the parity test enforces it", but `sent` is "listed as its own entry (irregular)" and the engine set contains **neither `sent` nor `sending`** (measured). A spec-compliant implementation fails the mandated parity test. | Drop `sent` from the tables, or replace the subset rule with a pinned lemma rule naming exactly which inflected forms may be added. |
| 13 | `gate-static-checks-strategy.md:45-46` vs `gate-static-checks.md:339-340` | **J1's rationale contradicts the tokenizer.** The expected `codes:["prompt.send.word"]` is explained by "the word `sending` stems to `send`", but the specified tokenizer does no stemming ("lowercase, split on non `[a-z0-9']`") and `sending` is outside the pinned vocabulary (finding 12) — the expected code list is not derivable from the specified tables (the same prompt also contains `Write`/`reply`). | Pin which word of the J1 prompt yields which code against the actual tables, or add the inflection per finding 12 and state the tokenizer stays stem-free. |

### D. Test-strategy discriminating power (fix before the B5/B6 waves)

| # | Where | Finding | Fix |
|---|-------|---------|-----|
| 14 | `host-gate-and-queue-routes-strategy.md:224` vs `:181` | **DoD 5 can never pass as written (measured).** `git diff --name-only origin/dev -- . ':!docs' \| grep -v -E '…' && exit 1 \|\| true` — on this tree the diff against `origin/dev` lists **698** pre-existing non-doc files (the branch diverges from `origin/dev`), so the command exits 1 today *and* after the batch, contradicting "fail on today's code and pass on the branch". | Diff against the branch point instead (`git diff --name-only $(git merge-base HEAD origin/dev) -- …`, or `origin/dev...HEAD`), or filter to the two write-set paths' own changes. |
| 15 | `automations-gate-ui-strategy.md:110` | **The i18n DoD line is green today and its discriminating half is prose.** The executable part (`audit-i18n-live.mjs --french --only "View · Automations"`) is trivially green today (no gate strings ⇒ "0 EN left"); the real assertion — "the check greps that JSON for the French value of each of the 94 keys" — has no command, no expected count, no exit contract. | Write the `node -e` grep as a real command with `process.exit(found === 94 ? 0 : 1)`, and make the line red today. |
| 16 | `pulse-proactive-notify-strategy.md:325-327` | **B6's only visible surface is gated by a hand check** ("verified by hand against its `maquette.json`…") — no command, no exit code, no red construction, while B5's maquette gets `verifier.mjs` + `--sabotage` ("a verifier that cannot go red proves nothing"). | Give the B6 maquette the same verifier + `--sabotage`, or state the exemption explicitly and accept the weaker gate. |
| 17 | `pulse-proactive-notify-strategy.md:228-230,285-293` vs `:243` | **B6's before/after pair has no run that can be red, and its "before" command is wrong.** Both sides only capture; `git worktree add "$BEFORE" "$(git rev-parse HEAD)"` uses `HEAD`, which for the stated late reviewer **is** the batch commit (the pair is void); the before-side capture is a prose comment ("re-run the capture block… with DIR=…") against a block hardcoding `DIR = '/tmp/kbpulse-shots/after'`, against the file's own "pasted as it stands" promise (:4-5). | Capture "before" from the parent commit explicitly, make `DIR` a parameter, and give the pair one assertion that is red on the batched tree (e.g. "before run finds 0 gate/queue cards"). |

### E. Repo rules

| # | Where | Finding | Fix |
|---|-------|---------|-----|
| 18 | `cartographie.md:1-141` | **New doc in French** (AGENTS.md rule 6: "New code, comments and docs in English"), e.g. ":6 Constat global : aucun code « proactif »…", ":12 Arbitrages d'unicité". | Translate to English before merge, or mark it non-tracked and move the anchors into the tracked docs. |

### F. MINOR (one-liners and alignments)

| # | Where | Finding | Fix |
|---|-------|---------|-----|
| 19 | `gate-trial-proof.md:131-157` vs `host-gate-and-queue-routes.md:185-187` | B2's "single predicate B3 **must consult**" (`mayActivate`) and its other exports (`startTrial`, `advanceTrial`, `applyTrial`, `askApproval`, `trialPassed`, `gateStatusAfterTrial`, `toStoredGate`, `normalizeProof`) are unnamed on B3's side (grep 0) — the trial lifecycle between `trial-start` and `trial-report` is unspecified on the consuming side. | Extend B3's required-export table (at least `startTrial`, `mayActivate`, `toStoredGate`) or name the B3-local replacement for each. |
| 20 | `automations-gate-ui.md:114,264` vs `cadrage.md:64-72` | The `unknown` view status: no sentence forbids writing it back into a record, and the hook contract types `data-status="<GateStatus>"` with the frozen union the view escapes (a conforming `unknown` panel trips the hook check). | One guard sentence ("`unknown` is view-only") + retag the hook with the view union. |
| 21 | `automations-gate-ui-strategy.md:84` vs `automations-gate-ui.md:125,230` | The ladder unit pins `next` for 8 of 9 statuses; `refused` is unpinned — a wrong `null` there strands the user. | Add `refused → 'review'` to the unit contract and the spec. |
| 22 | `automations-gate-ui.md:384-385` vs `cadrage.md:225-227` | B5's "write-set amendment #1/#2" (`scripts/check-gate-panel-live.mjs`, maquette folder) extend the write set `cadrage.md` states as `client.js` + one test file. Collision-free but not single-sourced. | Ratify in `cadrage.md` B5, or keep one amendment list there. |
| 23 | `pulse-proactive-notify.md:11-15,523` | `README.md` is outside B5's "only files the implementation may touch" yet §13 lists "four lines to add" for it — the doc update silently drops out. | Add `README.md` to the write set (cadrage grants `kybernos-pulse/*`) or name the follow-up and its owner. |
| 24 | `gate-trial-proof.md:236-244` vs `cadrage.md:93` | B2's strict `sideEffectFree` reading (a refused write attempt still fails the trial) is declared, but `cadrage.md:93`'s frozen comment reads otherwise — two readings of a "frozen" field. | One line in `cadrage.md`: adopt the strict formula ("true iff no write-classified call was made"). |
| 25 | `gate-trial-proof.md:274-275` | `normalizeGateRecord`'s `updatedAt` fallback `''` is outside the frozen shape's own ISO 8601 comment. | Normalize to `opts.at` only, or amend the comment. |
| 26 | `pulse-proactive-notify-strategy.md:309` | The maquette copies `dsh.css` from `~/.dsh/skills/maquette-dsh/…` — machine-local reproducibility dependency (passes `garde-depot.mjs`, which only matches `/Users/<name>`). | Pin the source (skill version or checked-in copy). |
| 27 | `automations-gate-ui.md:172` vs `automations-gate-ui-strategy.md:92` | `kbGateTone('trial-done')` is `idle` in the spec comment and `warn` in the executable unit contract. | Pick one and align both lines. |
| 28 | `automations-gate-ui.md:222` vs `:329` | The badge key `tasks.gate.badge.<suffix>` is concatenated against the spec's own "no key may be built by concatenation" rule (and evades the literal-only guard, strategy :91). | Enumerate the three keys literally, or carve the badge lookup out of the rule and the guard. |
| 29 | `pulse-proactive-notify-strategy.md:350` vs `pulse-proactive-notify.md:257-259` | The "bit for bit" old-signature regression `deepStrictEqual`s a `{ state, running, added }` fixture against a return that now carries `removed` — the non-regression proof reds itself. | Project the fixture to three keys (or add `removed`). |
| 30 | `host-gate-and-queue-routes.md:189-192,126,359-360,400` | Three one-liners: "the six definition fields: `{ name, prompt, schedule, needs, approvals }`" lists five; the seam is `kbGateRunRefusal` at :126/:400 but `kbGateRunRefusalTask` at :359 (the spec demands grep-stable literals, :88); the row-3 anchor "after `:2676`" is off by one (`kbTaskId` at `index.js:2677`). | Fix the count, pick one name, correct the anchor. |
| 31 | `initiative-queue-strategy.md:152` (+ `host-gate-and-queue-routes-strategy.md:74-78`) | The e2e evidence block contains `node --input-type=module -e '…e2e journey 1…'` — a literal ellipsis, not runnable as printed (the file's own standard is pastable commands); B3's J4 is the other prose-heavy spot (its assertions live in the J1 file). | Paste the real J1 command or point at the file that holds it. |
| 32 | `gate-trial-proof.md:3,76,236-241,372,403,447`; `initiative-queue.md:3,292,393,418`; `gate-trial-proof-strategy.md:8,109,177`; `gate-trial-proof.md:76`; `gate-trial-proof-strategy.md:227`; `automations-gate-ui-strategy.md:105-107` | Cosmetic: French guillemets « » as quote marks in English docs; citation drift `gate-static-checks.md:117,120-122` → `:117-118,120,123`; error label `ERR_MODULE_NOT_FOUND` vs measured `MODULE_NOT_FOUND`; "today" used in two senses in adjacent DoD lines (:105 vs :107). | Fix in the English pass. |
| 33 | `cadrage.md:287` | Risk 1 lists `accept` as an `active: true` path; code says "accept is Add (it stays off)" (`automation-suggest.mjs:29-30`) — the note is stale (B3 correctly omits it). | Correct the risk note in `cadrage.md`. |

## Confirmed-clean notes (checked, not assumed)

- **Anchors are exact** across the package (B5's 15 `client.js` anchors, B3's `index.js` anchors,
  B6's pulse anchors, the B1/B2 code anchors); only three cosmetic drifts (findings 30, 32).
- **Frozen shapes are reused, not redefined**, by all six batches (each reproduces them verbatim or
  labels its additions as views/projections); B1↔B2 constants match name-for-name and
  `GATE_STATUSES` equals cadrage's `GateStatus` value-for-value.
- **The `approve` seam is sound**: one writer of `approved`, no activation side effect, `rev`
  optimistic concurrency, human-measured at the route (`host-gate-and-queue-routes.md:267-283`).
- **Bypass inventory is otherwise complete**: `run-now`, `consume-fire`, the webhook fire, `accept`
  (correctly not an activation path), and the phone fence (`index.js:11401`) is not widened anywhere.
- **DoD honesty** was reproduced by execution (B4 D1-D6 reds, B6 A/B/C reds, B1 `MODULE_NOT_FOUND`);
  today-green checks are explicitly labelled non-regression in B2, B3, B4.
- **Bounds/caps exist at every layer** (gate store 200, findings ≤ 40, proof caps, queue 8/24,
  view caps, `INBOX_MAX` 100 / 40-per-pass / `SEEN_MAX` 300 / 1 MiB).
- **DSH boot safety** is designed in every batch that registers or imports (guarded namespace
  accessors, try/catch mounts, fail-open degradation).

## What this gate did not do

No implementation code was written; no bug was fixed (the gate reports, the batches fix); no image
was produced or read (the package ships no capture yet — vision obligations are deferred to the
batch runs). The live e2e journeys, `audit-i18n-live` and the vision captures need a sandbox GUI
and are out of scope for a spec gate.

## Order of repair (suggested)

1. **Findings 1-4** (the invariant-1 teeth: scheduler fire, `update`/`cloud-link` `active`,
   human seam for activation, runtime write-refusal) — they change what B3 and its strategy contain;
   no B3 implementation before these.
2. **Findings 5-11** (contract tables and the `task.gate`/seam decision) — if the Lead prefers the
   seam route over the list projection, that is one re-cadrage line in `cadrage.md` §"Delegation
   order", not a redesign.
3. **Findings 12-13** (B1 word tables) before B1; **14-17** (red-run constructions) before the
   B5/B6 waves; **18** (English pass) any time before merge; **19-33** during the batches they name.

After these repairs the package is implementation-ready as decomposed: waves, ownership, write sets
and invariants all hold.
