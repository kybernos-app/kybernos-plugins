# Context budget and memory janitor — implementation report

Date: 2026-10-28
Spec: `docs/etudes/2026-10-28-context-budget-and-memory-janitor.md` (binding)
Status: implemented, uncommitted, awaiting review + the user's approval for the first real janitor run.

This session implemented the three workstreams of the spec through plugin seams only. No engine
file was edited, no bundle was switched off, and the dirty tree's unrelated work was left alone.

## 1. Baseline measured on this machine (before)

Read from the live session journal (`request/header` and message events), not from estimates:

| signal | value |
| --- | --- |
| visible tool definitions | **80** |
| tool schema JSON | 58,165 chars ≈ **14,541 tokens** per request |
| skill catalog, model-visible text | 12,263 chars ≈ **3,066 tokens** (68 entries, avg description 156 chars) |
| `kybernos:memory` runtime-context snapshot | 5,946 chars |
| `kybernos:lessons` runtime-context snapshot | 2,145 chars |
| whole runtime-context snapshot (first turn) | 22,604 chars |
| `usage.inputTokens`, first request | 28,338 |

Four memory/lesson snapshots retained in one long history were the duplication the spec measured
(about 22.5k tokens on its reference session; this machine's blocks are smaller: ≈2.0k tokens per
snapshot, so the same mechanism costs ≈2k tokens *per topic change* that survived in history).

## 2. Workstream A — deduplicate prompt context (shipped)

`systemPrompt.context` is a durable runtime-context snapshot: DSH writes it into history as a
user-role message and appends a new copy whenever its text changes. `systemPrompt.section` is part
of the system prompt: evaluated at every assembly, never retained in history, and cacheable while
its text is byte-identical.

- **Memory + team lessons** (`packages/kybernos-cloud/index.js`): a per-agent section installed on
  `agent/created` through `agent.ctx.inject(['systemPrompt'], ...)` (the engine's own pattern), one
  section per block, disposed with the agent. The host-level `kybernos:memory-off` marker stays a
  section. Fallback: when no agent registry/agent context is readable, the historical
  `systemPrompt.context` registration carries the blocks — never both on the same agent.
- **Personal lessons** (`packages/kybernos-memory/index.js`): same seam, same fallback.
- **Selection stays relevance-based** and bounded: non-pinned relevance picks at most **8**
  (`RELEVANCE_TUNING.maxPicked`), the rest through `memory_search`; pinned `policy` memories are
  always visible (safety), while other pinned memories enter only through the relevance pick when a
  question exists. With no question (page counters, first assembly) the historical base selection is
  unchanged. No new TTL.
- **Skill catalog**: public composition seam only — `packages/kybernos-plugin/cordis.patch.yml`
  targets the existing `tool-skill` row with `catalogDescriptionMaxLength: 180`, turning the native
  durable catalog into a compact discovery index. Full instructions still load unchanged through
  the `skill` tool. Reversible by deleting that patch entry.

Measured (fake 3-turn assembly, one change; char/4 tokens):

| block | legacy context (retained snapshots) | section (current text once) | saved |
| --- | --- | --- | --- |
| memory | 2 snapshots, 10,175 chars ≈ 2,544 tok | 5,114 chars ≈ 1,279 tok | −5,061 chars ≈ **−1,265 tok** |
| lessons | 2 snapshots, 4,340 chars ≈ 1,085 tok | 2,168 chars ≈ 542 tok | −2,172 chars ≈ **−543 tok** |
| both, per comparable chat | ≈ 3,629 tok | ≈ 1,821 tok | ≈ **−1,808 tok** |

Skill catalog on this machine: rendered 12,263 → ≈11,412 chars at the 180 cap (≈ −213 tok); it is
future-proofing for catalogs whose descriptions hit the 500-char default (the spec's 6.7k-token
reference case), not a large win here.

Tests: `packages/kybernos-cloud/test-prompt-dedup.mjs` (10 verifications) and
`packages/kybernos-memory/test-prompt-dedup.mjs` (9) prove: no `context` registration left on the
new path; one section per agent installed and disposed; three assemblies byte-identical with one
block; a removed memory/lesson is no longer visible; memory off marker; team space marker and no
personal leak; restore to personal; pinned policy always visible while an unrelated pinned fact is
not injected when a question exists; mixed and fallback paths never duplicate.

## 3. Workstream B — start-of-session tool profiles (shipped)

`packages/kybernos-plugin/tool-profiles.mjs`, mounted from `packages/kybernos-plugin/index.js`.

- Profiles `code`, `office`, `automation` (plus `full` = no restriction), sharing a conservative
  core (`read/write/edit/glob/grep/bash`, jobs, `todo_write`, `ask_user_question`, `present`,
  `skill`, `working_directory`, `subagent`). A profile names hidden tools too; the filter is
  intersected with the tools actually visible, so an unknown name can never make `restrict` throw.
- Native seam: `agent.ctx.get('tools').restrict({ allow })`. Registration is **synchronous and
  scoped** — validated against the real engine: a session created in a code workspace is restricted
  at creation, and the restriction and its one-line profile note are present in the **first**
  assembly; the global surface is untouched and disposing the agent scope restores the full set.
  (`agent.ctx.inject` is deliberately not used for this: its callback runs on a later microtask and
  would miss the first assembly.)
- Chosen **once** at session start: from the workspace at `agent/created`, else from the first
  human message in the same tick — never switched mid-session (no cache-thrashing tool churn).
  `full` when uncertain; resumed/already-requesting sessions are left alone.
- Recovery: a stable `kybernos:tool-profile` section tells the agent its profile and that widening
  happens in a new session, never by inventing tools. Disable with `KYBERNOS_TOOL_PROFILES=full`,
  force a profile with `KYBERNOS_TOOL_PROFILES=code|office|automation`.
- French task words (the user speaks French) live in `task-keywords.json`, next to the module: they
  are classification data, not code or UI text, so the repository's language gate keeps its rule —
  the `tool-profiles.mjs` code holds English words only.
- Safety guard: before trusting the filter, the code compares the global tool count before/after;
  if a `ctx.get()` were ever unscoped, the restriction is undone and the session keeps its full
  surface.

Measured on the real 80-tool universe (schema chars from the live `request/header`):

| profile | visible tools | schema chars | saved per request |
| --- | --- | --- | --- |
| full (before) | 80 | 58,165 ≈ 14,541 tok | — |
| code | **31** | 20,990 | ≈ **−9,294 tok** |
| office | 32 | 24,917 | ≈ −8,312 tok |
| automation | 33 | 25,923 | ≈ −8,061 tok |

Live evidence from the boot log of the running host after the code was loaded:

```
[kybernos] tool profile "code": 31 of 80 tools kept
```

Tests: `packages/kybernos-plugin/test-tool-profiles.mjs` (12 checks) — classification matrix, core
preservation, ≤35 target, unknown-name intersection, single decision, resumed/already-requesting
skip, no-tools fallback, refused filter fallback, global-leak guard, non-human messages ignored.

## 4. Workstream C — five-hour dirty-only janitor (shipped, scan-only by default)

- `packages/kybernos-maintenance/janitor.mjs` (new): ONE host-level scheduler (5 h interval, ~60 s
  tick, boot catch-up, jitter ≤ 5 min, 30 s start grace), one inter-session file lock (PID + age,
  stale reclaim), dirty-only store revisions, bounded report (`report.jsonl`, last 200 lines /
  256 KiB), notices only on change or attention-worthy failure, retry next tick, circuit breaker
  after 3 consecutive failures (24 h + one notice), bounds 200 inspected / 20 semantic candidates /
  4 model calls / 20 removals.
- Mounted once in `packages/kybernos-maintenance/index.js` behind a guarded `ctx.effect`;
  `KYBERNOS_JANITOR=off` does not mount it at all.
- Store seams (published by the owners of the data, one frozen object each):
  `globalThis[Symbol.for('kybernos.janitor.memory')]` in `packages/kybernos-cloud/index.js` and
  `globalThis[Symbol.for('kybernos.janitor.lessons')]` in `packages/kybernos-memory/index.js`, each
  `{ version: 1, enabled(), revision(), scanAndClean({ apply, bounds, backupPath }) }`.
- Pass 1 is deterministic and local (the stores' own `dedupe.mjs` + `pickAuto`; same-kind only; the
  existing archive/Undo path for every removal). Pass 2 runs **only when applying**, only with
  candidates, only when the user had already enabled the store's existing Study-model tidy (no new
  provider setting), bounded; a contradiction (`replaces`, negation/number clash) is counted in
  `conflicts` and both rows are kept. Scan-only is inspect-only: no model call, no store write, no
  backup, no personal content leaving the machine.
- Retention: existing store semantics only (the server's retention for account memories; the
  lessons files' own rules) — no invented TTL, no hard deletions beyond the archive-backed merge.
- Paths (`<DSH home>` = `$DSH_HOME` or `~/.dsh`, override `KYBERNOS_JANITOR_DIR`):
  `kybernos/janitor/state.json`, `report.jsonl`, `notices.jsonl`, `lock`, `backups/` (40 kept).
- **Apply gate**: scan-only unless `KYBERNOS_JANITOR=apply` or `{"apply": true}` in `state.json`.
  This is deliberate: the first real cleaning run of a user's stores is the user's decision.
- Tests: `packages/kybernos-maintenance/test-janitor.mjs` (123 checks, fixture ports only),
  `packages/kybernos-cloud/test-janitor-seam.mjs` (45), `packages/kybernos-memory/test-janitor-seam.mjs`
  (47), and `packages/kybernos-maintenance/test-janitor-seams.mjs` (31: end-to-end over the real seams
  and a fake local account server). No test ever touches `~/.dsh` stores or the real account API.
- Live proof of the gate: the running host (restarted before the seams landed) already mounts the
  phase-1 scheduler in scan-only. `~/.dsh/kybernos/janitor/state.json` shows `apply: false`,
  `appliedOnce: false`, last run `skipped / stores_unavailable` (`no_seam` before the phase-2 code
  is loaded), `report.jsonl` has the run line, and there is no `backups/`, no notice, no lock left
  behind. Nothing was applied and no live store was written.

## 5. Gates run

| gate | result |
| --- | --- |
| `node scripts/garde-depot.mjs` | 0 error, 0 warning |
| `node scripts/test-lifecycle-engine.mjs` | 82 assertions, 0 failure |
| `node scripts/test-paquet.mjs` | 111 assertions, 0 failure |
| `node scripts/run-all-tests.mjs --only kybernos-cloud` | 50 files green |
| `node scripts/run-all-tests.mjs --only kybernos-memory` | 6 files green |
| `node scripts/run-all-tests.mjs --only kybernos-maintenance` | 5 files green |
| `node scripts/run-all-tests.mjs --only kybernos-plugin` | 117 green, 1 RED: `test-settings-nav.mjs` |
| `node scripts/run-all-tests.mjs` (full) | **521 green / 7 red** (the 7 are not this chantier's — see below) |

The seven reds, each checked against a clean `HEAD` worktree:

- `test-consistency-guards.mjs`, `test-help-mounts.mjs`, `test-layout.mjs`, `test-readmes.mjs`,
  `test-no-french-literals.mjs`, `packages/kybernos-plugin/test-settings-nav.mjs`: all GREEN at
  clean `HEAD`, red here because of **unrelated work in the dirty tree** — the untracked
  `packages/kybernos-log` bundle (not declared to the layout/robots/readmes, no help mount, no nav
  key) and French literals in `client.js`/`index.js` from another in-flight workstream. Fixing them
  would edit another chantier's files.
- `test-help.mjs`: RED at clean `HEAD` too (a list of bundles with no help-site article yet); it is a
  pre-existing red, not caused by this work, and is left as found per the "do not fix unrelated
  files" constraint.

The French literal this chantier did introduce (`compte rendu` in `tool-profiles.mjs`) was fixed
before delivery by moving the French task words to `task-keywords.json`.

## 6. Skips

- Live GUI acceptance of the tool profiles: a real new chat is needed; the running host loaded the
  code (boot log line above shows a real session at 31/80) but no new chat was created from this
  session. Nothing was restarted for the test.
- Prompt A/B on a real long chat: not run (it would need a long live session after installation);
  the numbers above come from the real journal baseline and from the deterministic 3-turn assembly
  tests. The cache-hit target (>85 % after two requests) is untouched by design: the section text is
  byte-identical while nothing changes, and the profile is fixed for the session.
- The janitor's semantic pass was exercised against a fake `llm` (the shape is the existing tidy
  brain prompt); it was never run on the real account.
- jsdom/react-dependent UI assertions keep their pre-existing SKIPPED lines in the full suite.

## 7. Known trade-offs / residual risk

- Memory and lessons now live in the system prompt, so they are injected even when a deployment
  suppresses *optional runtime context* (the Kybernos plugins' own switches still apply: memories
  off → off marker, lessons context off → empty, team space → team marker). The former
  `systemPrompt.context` path is kept only as a fail-safe fallback.
- A memory/lesson pick change invalidates the system-prompt prefix once — the spec accepts this; the
  alternative (a retained snapshot per change) is what was removed.
- The section/restriction install on `agent/created` lands on a microtask (`inject`) for the memory
  blocks; the engine awaits serial `agent/created` listeners before the first step, and the fallback
  is the historical context path. The tool restriction is installed synchronously (proven on the
  real engine) so the first request is already restricted.
- The janitor's account-memory seam depends on the account cache being readable; an offline or
  team-space session skips it (status skipped, no model call).

## 8. Exact rollback

```sh
# everything from this chantier (workstreams A + B + C), keeping the tree's unrelated work:
git checkout -- packages/kybernos-cloud/index.js packages/kybernos-memory/index.js \
  packages/kybernos-maintenance/index.js packages/kybernos-maintenance/README.md \
  packages/kybernos-plugin/cordis.patch.yml \
  packages/kybernos-plugin/index.js
rm -f packages/kybernos-cloud/test-prompt-dedup.mjs packages/kybernos-memory/test-prompt-dedup.mjs \
  packages/kybernos-maintenance/janitor.mjs packages/kybernos-maintenance/test-janitor.mjs \
  packages/kybernos-maintenance/test-janitor-seam.mjs \
  packages/kybernos-cloud/test-janitor-seam.mjs packages/kybernos-memory/test-janitor-seam.mjs \
  packages/kybernos-plugin/tool-profiles.mjs packages/kybernos-plugin/test-tool-profiles.mjs
```

Granular rollbacks:

- Tool profiles only: set `KYBERNOS_TOOL_PROFILES=full` (no code change), or delete the
  `mountToolProfiles` call in `packages/kybernos-plugin/index.js` and the two `tool-profiles.mjs`
  files.
- Skill catalog only: delete the `tool-skill` entry from `packages/kybernos-plugin/cordis.patch.yml`
  (the row falls back to its 500-char default).
- Janitor only: delete the `monterJanitor` block/`ctx.effect` in
  `packages/kybernos-maintenance/index.js`, remove `janitor.mjs` and its tests, remove the two
  `publishJanitorSeam` calls and their seam blocks from `kybernos-cloud`/`kybernos-memory`, then
  delete `<DSH home>/kybernos/janitor/` (scan-only wrote no store content).
- An approved cleaning run is undone through the store's own Undo path (Memory page "Undo" /
  lessons tidy undo) — the janitor always writes its backup before writing and reuses the
  archive-backed store paths.

## 9. What is the user's decision now

1. Review/merge this branch (no commit was made; nothing was merged into `dev`).
2. Run the janitor for the first time in scan-only (it is the default), read
   `<DSH home>/kybernos/janitor/report.jsonl`, and only then approve an applying run with
   `KYBERNOS_JANITOR=apply` (or `{"apply": true}` in the janitor state file).
3. A DSH restart is required to load the code in the running GUI; it must be scheduled when no
   other session is working (none was forced here).
