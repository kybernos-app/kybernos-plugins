# Context budget and automatic memory janitor

Date: 2026-10-28
Status: implementation specification for a delegated session

## 1. Objective

Reduce prompt size without asking the user to manage plugins, memory, lessons, or technical settings.

The delegated session implements three workstreams:

1. Remove duplicated memory, lessons, and skill-catalog context from chat history.
2. Expose a task-appropriate tool set at session start instead of every tool on every request.
3. Add an automatic local janitor for account memories and lessons: every five hours, only when something changed, only while memory is enabled.

No engine patch. Use plugin seams only. No new settings page and no new agent-facing tool.

## 2. Measured baseline

Measurements come from the current local session journal (`request/header` and message events), not from pricing-page estimates:

- Current long-session prompt: about 129,000 tokens.
- Four memory snapshots retained in history: about 22,460 tokens.
- One skill-catalog snapshot retained in history: about 6,744 tokens.
- Eighty tool definitions: about 14,521 tokens per request.
- Switching model in the same chat caused 119,187 uncached input tokens on one request; cache then recovered.
- Disabling seventeen unnecessary bundles earlier removed 6,063 tool-definition tokens per request.
- `packages/kybernos-plugin/economie-contexte.mjs` already sets `compaction-basic.thresholdRatio` to `0.5` at boot in every preset. Do not revert it.

Targets, to verify rather than promise:

- Remove 20–25k tokens of repetitive context from a comparable long session.
- Reduce a normal coding session to 35 visible tools or fewer without breaking its work.
- Keep cache hit rate above 85% after the first two requests when model and tool profile stay unchanged.
- Reduce injected memory/lesson text by at least 60% after janitor cleaning when duplicates exist.

## 3. Workstream A — deduplicate prompt context

### Current cause

`systemPrompt.context` is a durable runtime-context snapshot. DSH intentionally stores it as a user-role message in history. Re-evaluating it on later turns can therefore retain several old copies.

Relevant registrations:

- `packages/kybernos-cloud/index.js`: `mountMemoryPrompt`, currently registering `kybernos:memory` and the team-lessons context.
- `packages/kybernos-memory/index.js`: `mountPrompt`, currently registering the local-lessons context.
- The native skill catalog is also a runtime-context contribution; inspect its actual registration before changing it.

### Required behavior

- Stable or slowly changing memory and lessons should appear once, not once per refresh.
- Prefer `systemPrompt.section` for stable content after proving compatibility with:
  - personal and team spaces;
  - memory on/off;
  - the Kybernos proxy memory markers;
  - prompt updates and session restore;
  - removal of old instructions (no stale memory left visible).
- Keep genuinely per-request runtime facts in `systemPrompt.context`.
- If moving a block to `section` is unsafe, use another existing projection/replacement seam and document why. Do not patch the engine.
- Memory selection remains relevance-based. Inject at most 5–8 useful non-pinned memories; retrieve the rest with `memory_search`.
- Pinned sector/profile memories must be scoped by relevance rather than all being injected into unrelated coding sessions. Safety policies remain visible when applicable.
- Reduce the skill catalog to a compact discovery index. Full skill instructions remain available through the existing `skill` mechanism. Use `system-prompt/assemble` or another public seam for the native catalog; do not edit engine files.

### Cache constraint

Prefer a stable prefix. Do not rewrite sections with timestamps or other per-turn noise. A memory edit may invalidate a prompt prefix once; repeated snapshots on every turn are not an acceptable alternative.

## 4. Workstream B — task-appropriate tools at session start

Use the native per-agent tool restriction seam (`ctx.tools.restrict`) rather than disabling bundles. Plugin UI and routes may remain available while unnecessary agent tools are hidden.

### Profiles

Define built-in profiles, with conservative core tools shared by all:

- `code`: filesystem, search, bash, diagnostics, tests, jobs, focused delegation.
- `office`: documents, spreadsheets, knowledge, memory, web retrieval, presentations when installed.
- `automation`: schedules, jobs, local collection/merge tools, relevant connectors.
- `full`: current behavior, used as a safe fallback.

No profile manager UI is required. Select a profile once at session start from the workspace and first task; default conservatively when classification is uncertain. Do not switch profiles in the middle of a session merely to save tokens: tool changes can invalidate the prompt prefix.

Audit scoped registrations: `tools.restrict` constrains inherited global tools and does not replace a scoped capability policy. Measure the final request header, not only the registry.

`deferLoading` may be used only on routes whose prepared call supports the required tool-update semantics. Do not assume Kimi supports it; prove behavior or use start-of-session restriction.

### Recovery

If a task genuinely needs a hidden capability, the agent must say which profile/capability is missing. Widening happens on a later user turn or a new session, not through silent mid-turn tool-set churn.

## 5. Workstream C — automatic memory and lesson janitor

### Trigger

- Run every five hours while the DSH host is running.
- On host start, catch up if the last successful run is older than five hours.
- Run only when the relevant store revision/hash changed since the last successful inspection. No change means no LLM call and no user notification.
- When memory is disabled, skip the janitor entirely: no background LLM processing of personal content.
- One host-level scheduler and one inter-session lock. Never one timer per chat.
- Add small jitter so multiple local jobs do not start together.

The five-hour interval is an internal product default in v1; the user does not need to configure it.

### Cleaning pipeline

#### Pass 1 — deterministic, local, always first

- Normalize whitespace, casing for comparison, markers, and harmless formatting differences.
- Detect exact duplicates and malformed entries.
- Merge usage/evidence counters where the stores support them.
- Preserve canonical provenance and newest/oldest timestamps as appropriate.
- Identify expired ephemeral events according to existing store semantics; do not invent a TTL for durable preferences or policies.
- Produce near-duplicate candidates for pass 2 without calling a model.

#### Pass 2 — semantic, only when candidates exist

- Use the existing study/local model route selected by the codebase; do not add a provider setting.
- Bound batch count, input size, output size, and total model calls per run.
- Merge only high-confidence semantic duplicates of the same kind and scope.
- Never auto-resolve contradictory facts, policies, or lessons. Keep them and record a conflict in the local report.
- Do not send memory content to an external service when a local route is configured. No external publication, email, deletion of remote data, or paid action.

### Retention and safety rules

- Never auto-delete pinned memories, policies, or explicit user preferences.
- Account memories: merge duplicates; archive only stale non-pinned items that are demonstrably superseded or expired.
- Lessons: merge duplicates only within the same kyber and compatible tags; preserve falsifiable wording, confidence, usage, and provenance. Archive stale lessons only when unused and superseded.
- No hard deletion in v1. Write a timestamped backup and an archive before changing a store, then update atomically.
- A failed write leaves the original store untouched. A restore path must be documented and tested.
- Bound each run (for example 200 inspected items and 20 semantic candidates; tune to existing store sizes).
- On error, retry at the next five-hour tick. After three consecutive failures, back off and emit one local notification/report rather than failing every tick.

### Reporting

Append a bounded local JSONL report containing:

- run id, start/end, duration, dirty/clean/skipped status;
- before/after item counts and estimated injected tokens;
- exact and semantic merges, archives, conflicts;
- model route and call count when semantic cleaning ran;
- errors and backup/archive locations.

Notify the user only when something changed or a failure needs attention. A clean skip stays silent. An optional small “last cleaned” status may use the existing Memory page, but no settings or management UI is required.

## 6. Suggested implementation shape

Prefer one host-level owner for scheduling, with cleaning logic kept next to the stores that own the data. `kybernos-maintenance` is a candidate scheduler; `kybernos-cloud` owns account memory and `kybernos-memory` owns lessons. Inspect existing services before choosing cross-bundle calls. Do not read another bundle's private files if a public seam exists.

Avoid a new visible plugin page, new agent tools, or new profile dependencies unless strictly necessary.

## 7. Tests and proof

### Context deduplication

- Memory on/off, personal/team, restored session, and proxy-marker tests remain green.
- Across three turns, only the latest applicable memory/lesson block is model-visible.
- Old or removed instructions are not still visible.
- A/B prompt measurement on the same short task, including cache behavior.

### Tool profiles

- Unit tests for classification, core-tool preservation, fallback, and restriction disposal.
- A real new coding session records at most 35 visible tools in `request/header` and can complete a representative read/edit/test task.
- No mid-session model or tool-profile change during the measurement.

### Janitor

Use temporary fixture stores, never the user's live memory in tests:

- clean store skips; dirty store runs;
- five-hour schedule and boot catch-up;
- memory-off skip;
- one concurrent run only;
- exact and semantic dedupe;
- conflict preservation;
- pinned/policy/preference protection;
- atomic failure leaves original intact;
- backup/archive restore;
- bounded model calls and bounded report;
- retry and circuit breaker.

### Repository gates

- `node scripts/garde-depot.mjs`
- Focused tests during work through `node scripts/run-all-tests.mjs --only <text>`
- Full `node scripts/run-all-tests.mjs` before any merge
- Lifecycle/package tests if bundle composition changes
- No engine edits, personal absolute paths, media, or unrelated cleanup

## 8. Delivery and rollout

1. Implement workstream A with tests and measure it.
2. Implement workstream B with a conservative fallback and measure real visible tools.
3. Implement the janitor in dry-run/fixture form first, then enable deterministic cleaning; enable semantic merging only after its tests pass.
4. Leave the live user stores unchanged until the user explicitly approves the first real cleaning run.
5. Deliver a short report: measured before/after tokens, tools, cache, tests run, skipped checks, and the exact rollback.

Do not merge into `dev` from the delegated session. Do not revert unrelated dirty-tree changes. Do not restart DSH while other sessions are active; request/provide a controlled restart only when validation is complete.
