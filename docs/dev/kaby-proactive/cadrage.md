# Cadrage Lot 1 — Kaby proactif (final batch decomposition)

Stage `cadrage` of the kyber `dev-team`, 2026-10-28. Branch `feature/kaby-proactive-lot1`
(worktree `kybernos-plugins-proactive`). Spec phase: this document is the contract for the
implementation delegations; no code is written at this stage.

Input: `docs/dev/kaby-proactive/cartographie.md` (mapping, anchored excerpts). The mapping's
six proposed batches are **confirmed as the final decomposition** — their write sets are already
pairwise disjoint, each owns at most one hot surface, and the batch ids are the ones the hard
invariants name. No merge, no split.

## Scope of Lot 1

Three capability pillars:

- **(A) Automation certification gate** — draft → static checks → supervised trial → proof
  report → activation **only** after explicit human approval.
- **(B) Bounded initiative queue** — entries carrying evidence, risk, reversibility, a cap and a
  next action; drafts only, the agent asks before anything leaves.
- **(C) Pulse proactive notifications** — finished / failed / action-required items and banners
  fed by gate and queue events.

## Hard invariants (carried by EVERY batch contract below)

1. **Activation requires explicit human approval.** No code path may set an automation `active`
   (or otherwise make it runnable) without a recorded human approval on its gate record. The
   approval is a state transition a human triggers — never a model, never a cron.
2. **An automation never sends, publishes, deletes or pays on its own.** Everything downstream of
   the gate prepares drafts and asks first; static checks flag any draft whose prompt or tool set
   would break this.
3. **Trial runs are supervised and side-effect-free.** A trial starts only from a human action,
   runs with write tools refused (read-only mask, `approval: 'ask'` at minimum), and its proof
   report must show zero external effects to pass.
4. **Write sets are disjoint.** `packages/kybernos-plugin/index.js` only in
   `host-gate-and-queue-routes`; `packages/kybernos-plugin/client.js` only in
   `automations-gate-ui`; `packages/kybernos-plugin/automation-tools.mjs` only in
   `initiative-queue`; `packages/kybernos-pulse/*` only in `pulse-proactive-notify`.
   *Disambiguation:* "index.js"/"client.js" in the invariants mean the kybernos-plugin ones. The
   pulse bundle's own `index.js` / `client.js` live inside `packages/kybernos-pulse/` and belong
   exclusively to `pulse-proactive-notify`.

Plus the repo rules that bind every batch: English code/comments/docs; no `/Users/<name>` paths or
media in tracked files (`node scripts/garde-depot.mjs`); a bundle must never stop DSH from
starting (guard every route/tool registration with try/catch); zero new engine patches — plugin
seams only (`ctx.inject`, slots, `systemPrompt.context`, `webServerSvc.register`).

## Shared data shapes (frozen contract)

These three shapes are frozen by this cadrage. A batch that needs a change to one of them stops
and re-cadrages; it does not improvise a variant. They are pure data — no functions, no classes.

```ts
// ── Gate record (B1 creates the shape, B2 normalizes/persists, B3 routes it, B5 renders it) ──

type Severity = 'blocker' | 'warn' | 'info';

interface GateFinding {
  code: string;        // stable machine code, e.g. 'schedule.too-frequent'
  severity: Severity;
  field?: string;      // dotted path in the draft, e.g. 'schedule.cron'
  message: string;     // English, one line, no personal data
}

type GateStatus =
  | 'draft'             // created, nothing checked yet
  | 'static-failed'     // static checks ran, ≥ 1 blocker
  | 'static-passed'     // static checks ran, 0 blocker
  | 'trial-done'        // a supervised trial produced a proof report
  | 'awaiting-approval' // proof attached, human decision pending
  | 'approved'          // human granted (recorded with a timestamp)
  | 'refused'           // human refused
  | 'activated';        // approved AND switched on by the human action — never by code alone

interface GateRecord {
  id: string;            // 'gate:' + automationId
  automationId: string;
  status: GateStatus;
  staticChecks: { ranAt: string; verdict: 'pass' | 'fail'; findings: GateFinding[] } | null;
  trial: ProofReport | null;
  approval: { state: 'none' | 'asked' | 'granted' | 'refused'; at: string | null };
  updatedAt: string;     // ISO 8601
  rev: number;           // monotonic, optimistic concurrency on writes
}

// ── Proof report (B2 builds it from run events; B3 serves it; B5 shows it) ──

interface ProofReport {
  runId: string;
  gateId: string;
  startedAt: string;
  endedAt: string | null;
  supervised: true;      // constant: a trial is only launched by a human action
  sideEffectFree: boolean; // true iff externalEffects is empty and every write tool was refused
  toolCalls: { toolName: string; access: 'read' | 'write'; outcome: 'ok' | 'error' | 'refused-as-write' }[];
  outcome: { state: 'completed' | 'failed' | 'open'; code?: string; message?: string };
  externalEffects: string[]; // must stay empty for the trial to pass
  errors: { at: string; where: string; message: string }[];
}

// ── Initiative entry (B4 owns it; B3 serves it; B5 renders it; B6 notifies on it) ──

interface InitiativeEntry {
  id: string;            // 'i_' + short random
  title: string;         // pattern wording — "write patterns, not people" (hasPersonalData refused)
  evidence: { n: number; span: string; where: string }; // what was measured, like automation proofs
  risk: 'low' | 'medium' | 'high';
  reversibility: 'trivial' | 'easy' | 'hard';
  nextAction: { kind: 'draft'; summary: string }; // drafts only: nothing sends, publishes, deletes or pays
  status: 'proposed' | 'asked' | 'added' | 'dropped';
  at: string;            // ISO 8601
}
```

Queue cap: bounded pending entries (keep ≤ 8, mirroring `automation-suggest.mjs`'s
`SUGGESTED_MAX`), dedup on normalized title, and every text field passes the `hasPersonalData`
refusal of `suggestions.mjs` (e-mail, phone, token link). The ledger follows `makeLedger`'s
pattern: serial writes, atomic rename, mode 0600, injected `now`/`newId` for tests.

## Final batches

All paths are repo-relative. "Invariants carried" repeats the four hard invariants as they bind
that batch.

---

### B1 — `gate-static-checks`

- **Goal:** Pure static certification of an automation draft: cron validity and frequency, IANA
  timezone, connector/app needs, permission asks, side-effect words in the prompt and tool set.
  Produces bounded `GateFinding`s and a pass/fail verdict. No I/O, no routes, no UI.
- **Reads:** `packages/kybernos-plugin/index.js` (anchors `kbMcpGate`, `KB_MCP_WRITE_WORDS`,
  `kbIsReadName`, approvals normalisation at :449), `automation-suggest.mjs`,
  `automation-settings.mjs`, `automation-published.mjs`, `automation-skills.mjs`,
  `automation-load.mjs`, `skills/automation-creator/SKILL.md`.
- **Writes:** `packages/kybernos-plugin/automation-gate.mjs` (NEW — check list, verdict, bounded
  findings, `GateRecord`/`GateFinding` shape constants), `packages/kybernos-plugin/test-automation-gate.mjs` (NEW).
- **Exports (contract to the next stage):** a pure `checkDraft(draft) -> { verdict, findings }`
  and the shared shape constants. Must stay dependency-free (no fs, no network) so every later
  batch can import it safely.
- **Tests / DoD:** property-style cases for each check (bad cron, <5-min frequency, unknown tz,
  missing needs, `approvals: 'auto'`, send/delete/pay words in prompt); findings always within the
  bounded shape; `node scripts/run-all-tests.mjs` green.
- **Invariants carried:** #2 is what the checks enforce; #1 (no activation logic exists here at
  all — this batch cannot activate anything); #3 n/a (no trial code); #4 (own files only).

---

### B2 — `gate-trial-proof`

- **Goal:** The supervised trial machine and the proof report: trial state machine (requested →
  running → done/failed), a proof report built from run events (`automation-runs.mjs`
  `summarizeRun` / `session-outcome.mjs` `lastTurnOutcome`), gate-record normalization and
  persistence helpers.
- **Reads:** `automation-runs.mjs`, `session-outcome.mjs`, `automation-load.mjs`,
  `automation-skills.mjs`, `index.js` (read-only, anchors :3046 approvals, :3397 history),
  `packages/kybernos-pulse/pulse-core.mjs` (read-only, `readRun`), `automation-gate.mjs` (B1).
- **Writes:** `packages/kybernos-plugin/automation-trial.mjs` (NEW — state machine, proof report
  from events, gate-record normalization), `packages/kybernos-plugin/test-automation-trial.mjs` (NEW).
- **Exports:** `startTrial`/`trialFromEvents`/`normalizeGateRecord` pure-ish helpers operating on
  event lists and records; no HTTP, no direct store writes (B3 owns I/O wiring).
- **Tests / DoD:** a trial whose events contain a write-tool call yields
  `sideEffectFree: false` and an `externalEffects` entry; a clean run yields the opposite; the
  state machine never reaches `approved`/`activated` on its own; run-green.
- **Invariants carried:** #3 is this batch's core (supervised start, read-only mask,
  zero-external-effects verdict); #1 (state machine has no transition to `activated` without an
  approval event); #2 (proof records refusals of write tools); #4.

---

### B3 — `host-gate-and-queue-routes` — sole owner of `packages/kybernos-plugin/index.js`

- **Goal:** Host seams: gate actions on the tasks route (`gate-check`, `trial-start`,
  `trial-report`, `approve`) and initiative-queue actions (`queue list`, `queue act`) inside
  `kbTasksHandle`, plus the storage wiring for gate records and the initiative ledger.
- **Reads:** `index.js`, `suggestions.mjs`, `automation-tools.mjs`, `automation-published.mjs`,
  `session-guard.mjs`, `automation-gate.mjs` (B1), `initiative-queue.mjs` (B4),
  `docs/dev/route-origin-rule.md`.
- **Writes:** `packages/kybernos-plugin/index.js` ONLY (new `kbTasksHandle` actions, guarded
  storage wiring; a new `webServerSvc.register` route block only if a payload cannot ride the
  existing `/kybernos/tasks` handler, and then under the same `kbTasksRefused` fence and added to
  the route-origin audit), `packages/kybernos-plugin/test-automation-gate-routes.mjs` (NEW).
- **Exports:** the HTTP/tool contract: `{ action: 'gate-check' | 'trial-start' | 'trial-report' | 'approve' | 'queue list' | 'queue act', ... } -> { ok, ... }`,
  same envelope as the existing actions.
- **Tests / DoD:** every new action refuses unauthenticated and tunnelled (phone) calls like the
  rest of `/kybernos/tasks` — the origin rule currently lets only `{ action: 'list' }` pass the
  phone link and that must not widen without an audit; `approve` is the only action that can move
  a record to `approved`, and only a human-triggered request can reach it; registration stays
  inside try/catch (`mountAutomationTools` pattern, "never stop DSH from starting"); run-green.
- **Invariants carried:** #1 (the `approve`/activation seam is enforced here: activation records
  the human approval first); #2 (routes only record drafts and decisions); #3 (`trial-start`
  refuses to start without a human request and forces the read-only mask); #4 (index.js exclusive).

---

### B4 — `initiative-queue` — sole owner of `packages/kybernos-plugin/automation-tools.mjs`

- **Goal:** The bounded initiative queue (B) and its two agent tools: `initiative record`
  (evidence, risk, reversibility, next action — draft-only) and `initiative list`, added to
  `toolDefinitions`. Caps, dedup, personal-data refusal.
- **Reads:** `suggestions.mjs`, `automation-suggest.mjs`, `automation-tools.mjs`,
  `packages/kybernos-skills/learned.mjs` (`maxPending` pattern), `packages/kybernos-memory/index.js`,
  `lessons-store.mjs`, `docs/dev/design-suggested-tasks.md`.
- **Writes:** `packages/kybernos-plugin/initiative-queue.mjs` (NEW — entry shape checks, cap,
  dedup, "next action is a draft" rule, ledger in `makeLedger` style),
  `packages/kybernos-plugin/automation-tools.mjs` (register the two tools + prompt chunk lines),
  `packages/kybernos-plugin/test-initiative-queue.mjs` (NEW).
- **Exports:** `makeInitiativeQueue({ file, now, newId })` returning exactly
  `{ list, add, resolve, cap }` — `cap` is the numeric `INITIATIVE_MAX` constant, exported through
  the object so no route, card or pulse hard-codes 8. The two tool definitions are wired through
  `deps` in the same delegation style as `ledger.add` today. The `list` answer B3 serves and B5
  renders is `{ ok: true, items, cap }`, never `{ ok, items }` alone: `cap` rides on the same
  envelope so the panel and the pulse can say "full" without importing the module.
- **Tests / DoD:** cap rejection ("too many waiting" style), dedup, `hasPersonalData` refusal,
  an entry whose `nextAction.kind !== 'draft'` is refused; tool render strings say "waits for the
  person" and never claim anything ran; run-green.
- **Invariants carried:** #2 (queue only drafts and asks; nothing leaves on its own); #1 (an
  initiative `added` never activates an automation — it only records intent); #3 n/a; #4
  (`automation-tools.mjs` exclusive).

---

### B5 — `automations-gate-ui` — sole owner of `packages/kybernos-plugin/client.js`

- **Goal:** The Automations page gate panel (C-visible parts of A and B): static-check findings on
  the draft, trial/proof display, the activation affordance that is pending human approval, and
  initiative cards. i18n strings for every label.
- **Reads:** `client.js`, `index.js` (read-only), `automation-gate.mjs` (B1),
  `initiative-queue.mjs` (B4), `automation-runs.mjs`, `help.json`, `shared-ui.css`.
- **Writes:** `packages/kybernos-plugin/client.js` ONLY among the shared bundle files (KB-BOARD /
  KB-AUTORUNS blocks, the Automations page component and its i18n table),
  `packages/kybernos-plugin/test-automation-gate-client.mjs` (NEW),
  `scripts/check-gate-panel-live.mjs` (NEW — the replayable live pass of the DoD below, on the
  `check-suggested-live.mjs` pattern: sandbox only, real host routes, seeded `tasks.json` restored,
  `--shots <dir>`, exit 0/1/3; ratified by D5),
  `docs/dev/kaby-proactive/maquettes/automations-gate/` (NEW — the interactive maquette, text only:
  `index.html`, `tokens.css`, `cadrage.md`, `regard.md`, `README.md`, `verifier.mjs`; PNG captures
  stay outside the repository, since `scripts/garde-depot.mjs` refuses tracked media; ratified by
  D5). Those four entries are the whole write set, not an exception list.
- **Exports:** none to code; the contract is UX: activation is a two-step human gesture (review →
  approve/activate), never a default, and the gate state is readable at a glance.
- **Tests / DoD:** pure-block unit tests; then the executable commands of
  `docs/tests/automations-gate-ui-strategy.md`, which are red today and green after the batch:
  `node packages/kybernos-plugin/test-automation-gate-client.mjs` (today `MODULE_NOT_FOUND`, the
  test file does not exist), the 94-key i18n literal script on that file's `DoD:` line (one
  `node -e` over `client.js`, exit contract `process.exit(found === 94 ? 0 : 1)`; today `client.js`
  holds 0 of the 94 keys, so exit 1), and the closing live pass
  `source scripts/sandbox/env.sh && node scripts/check-gate-panel-live.mjs --journey all --shots /tmp/kb-gate-shots/after | tail -1`
  (today exit 1, the check does not exist; after the batch the last line is `all checks passed`).
  That live pass carries the full UI pass from `AGENTS.md` (behaviour with disk verification,
  vision captures of every state read with `read_image`, one dark-theme capture, homogeneity
  against the host panel template, edge cases: empty state, double instance, re-check button); the
  i18n audit comes back clean; run-green.
- **Invariants carried:** #1 (the UI can only *ask* for approval — the flip goes through B3's
  approved seam); #2 (every card action is draft/ask, nothing auto-fires); #3 (trial launch is an
  explicit supervised button); #4 (client.js exclusive).

---

### B6 — `pulse-proactive-notify` — sole owner of `packages/kybernos-pulse/*`

- **Goal:** Pillar (C): inbox items and banners for **finished / failed / action-required**, fed
  by run events (existing `watchStep`/`readRun`) plus gate and queue events (trial finished,
  trial failed, approval required, initiative needs a next action). Maps to the existing kinds
  `done` / `failed` / `waiting`.
- **Reads:** `packages/kybernos-pulse/pulse-core.mjs`, `pulse-host.mjs`, `index.js`, `client.js`,
  `panel-page.mjs`, `README.md` (all `packages/kybernos-pulse/`),
  `packages/kybernos-plugin/automation-runs.mjs`; the frozen GateRecord / ProofReport /
  InitiativeEntry shapes (read-only data).
- **Writes:** `packages/kybernos-pulse/*` ONLY: `pulse-core.mjs`, `pulse-host.mjs`, `index.js`,
  `client.js`, `test-core.mjs`, `README.md` (R5).
- **Exports:** the inbox/banners behaviour consumed by the pulse panel; `watchStep` stays
  signature-compatible (it is the pass other code may already call).
- **Tests / DoD:** gate/queue events produce the right kind and tone (`waiting` = action
  required, never quieted by `muted`); first-pass baselining preserved (switching on never floods
  the inbox); `INBOX_MAX` and level/muted settings respected; run-green.
- **Invariants carried:** #1 (an "action required" item asks; it never approves on the user's
  behalf); #2 (notifications carry drafts and asks only); #3 (trial-done items report the proof
  verdict, they don't relaunch anything); #4 (`kybernos-pulse/*` exclusive).

## Delegation order and dependencies

```
Wave 1 (parallel):  B1 gate-static-checks ──┐
                    B4 initiative-queue ────┤
Wave 2:             B2 gate-trial-proof  <──┘ (needs B1's findings/record shape)
Wave 3:             B3 host-gate-and-queue-routes (needs B1, B2, B4 exports)
Wave 4 (parallel):  B5 automations-gate-ui ──── (needs B1–B4, reads B3's actions)
                    B6 pulse-proactive-notify ── (needs B1/B2/B4 shapes; reads automation-runs.mjs)
```

- B2 may **start** in parallel with B1 against the frozen shapes above, but integrates only after
  B1 lands.
- B3 is the integration point of pillar (A) and (B) and must land before B5 (the UI calls its
  actions).
- B5 and B6 are independent consumers and can run in parallel.
- Final integration gate (owner: the orchestrator or a closing delegation):
  `node scripts/run-all-tests.mjs` at 0 red, `node scripts/garde-depot.mjs`,
  `node scripts/test-lifecycle-engine.mjs`, `node scripts/test-paquet.mjs`, then the live UI pass
  for B5 before merge into `dev`.
- Hot-file discipline between waves: one writer at a time on `index.js` (B3) and `client.js` (B5);
  claim before editing hot files per the global hot-file rule.

## Risks

1. **Gate bypass (severity: high).** Any existing path that flips `active: true` (`toggle`,
   `run-now`, `consume-fire`) could become an activation without approval once the gate exists.
   `accept` is not one of them: `acceptedTask` keeps the automation off
   (`automation-suggest.mjs:29-30`), so it is no longer listed as an activation seam anywhere in
   this lot. Mitigation: B1 keeps a static check "activation without approval record"; B3 adds a
   route test asserting no action reaches `activated` without `approval.state === 'granted'`.
2. **Trial with side effects (high).** If the runner cannot mask write tools, a trial could send
   or delete. Mitigation: B2's proof marks any write call `refused-as-write` and fails the trial
   on `externalEffects`; B3 forces `approvals: 'ask'` and the read-only mask on `trial-start`;
   a test feeds a write call through and asserts the refusal.
3. **Origin-rule regression (high).** New actions on `/kybernos/tasks` must keep the phone-link
   fence (only `{ action: 'list' }` passes). Mitigation: B3 test for tunnelled refusal of every
   new action; no allowlist widening without the route-origin audit.
4. **Shape drift across waves (medium).** Three shapes cross four batches. Mitigation: frozen
   above; a needed change stops the batch and re-cadrages.
5. **Pulse flood (medium).** Gate/queue events could spam the inbox on first switch-on.
   Mitigation: keep `baselined` first-pass behaviour and `INBOX_MAX` in B6.
6. **DSH boot safety (medium).** New registrations in `index.js`, `automation-tools.mjs`, pulse
   host must each sit in try/catch guards (`mountAutomationTools` and `ctx.effect` patterns).
7. **Personal data leakage (medium).** Initiative titles/evidence and proof text are model-written
   from mail-like content. Mitigation: `hasPersonalData`-style refusal at the queue door (B4) and
   bounded scrubbing in the proof (B2), mirroring `automation-runs.mjs` `scrub`.
8. **Hot-file contention (low with waves).** `index.js` (12.9k lines) and `client.js` are shared
   by nature; the disjoint write sets and wave order keep one writer per file at a time.
9. **Test-suite debt (low).** A red file not broken by a batch is still red on the merge:
   `run-all-tests.mjs` must end 0 red in the same session, or the red is ticketed that day and
   named in the merge message.
