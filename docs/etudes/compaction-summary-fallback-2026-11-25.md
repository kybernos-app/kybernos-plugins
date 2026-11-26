# Compaction: the summary must not be the single point of failure

Date: 2026-11-25. Status: layer 1 shipped in the plugin, layer 2 proposed upstream.

## What happened

Session `46d551e6` (50 turns) died with `MODEL_SWITCH_COMPACTION_FAILED` when switching from
`kimi-code-plan-global/k3.1-pro` to `opencode-go/deepseek-v4.1-flash`. The chain, read back from the session log:

1. Kimi returned `429 exceeded_current_quota_error` at turn 43 and again at turn 45 (5-hour plan quota).
2. At turn 50 the surface was **564 951 tokens**. The destination budget is
   `1 000 000 (window) - 384 000 (reserved output) - 65 536 (headroom) = 550 464`, and the economy ratio 0.5 caps it
   at **500 000**. So the switch required a condensation.
3. `dsh-compaction-basic` sends the summary to **the route that produced the last assistant message**
   (`compactionAnsweredRoute`), not to the destination: that is Kimi, out of quota.
4. `429` -> `compaction/end` in error -> `MODEL_SWITCH_COMPACTION_FAILED`. The error text ("select a model with a
   larger context window") is misleading: no window would have helped, the summarizer had no quota.

The session ran the **`minimal` preset**, whose compaction group mounts **no tool-result pruner**
(`dsh-web-app/presets/minimal.patch.yml` has `compaction-basic` + `command-compact` only; `standard.patch.yml` has the
pruner). So the trigger went straight to a full 565 K summarization call, the one call that cannot fall back.

## Measurement on this machine

Compaction outcomes over all session logs:

| route | compactions | succeeded | note |
|---|---|---|---|
| `zai-coding-cn` | 200 | 98.5 % | |
| `xiaomi-token-plan-ams` | 70 | 100 % | |
| `ollama-cloud` | 373 | 79.9 % | |
| `opencode-go` | 7 | 100 % | 23 x HTTP 413 seen at 118-230 K |
| `kybernos` (retired route) | 838 | 0.1 % | 837 x `413 payload_too_large`, an automation still pointing at it |

Failure classes overall (1506 compactions, 586 ok): 837 payload-too-large on the dead route, 44 context overflow while
summarizing, 31 quota 429, 3 "summary is not smaller than the shadowed range".

Replaying one pruner pass over recent sessions (`node scripts/compaction-prune-mesure.mjs`):

| session | surface | tool share | saving | after | verdict |
|---|---|---|---|---|---|
| 46d551e6 | 564 951 | 86 % | 209 354 | 355 597 | summary avoided |
| 5a051c10 | 728 941 | 64 % | 263 934 | 465 007 | summary avoided |
| 80eeec21 | 193 232 | 55 % | 71 190 | 122 042 | not under pressure |
| a5dfd148 | 372 399 | 3 % | 1 621 | 370 778 | still summarizes |

Two lessons: the pruner removes the whole class where tool dumps dominate (agentic sessions), and it does nothing for
prose-heavy sessions, where only a working summarizer helps.

## Layer 1 (shipped): the tool-result pruner in every preset

`packages/kybernos-plugin/economie-contexte.mjs`, same in-memory boot seam as the threshold ratio:

- `ID_PRUNEUR`, `NOM_PRUNEUR`, `BUDGET_PRUNEUR = { thresholdChars: 4096, headChars: 2048, tailChars: 512 }`;
- `rangerGroupesCompaction(definition)`: finds the group that carries the compaction row, because the pruner must be
  mounted **inside**  the group isolates `compaction` / `toolResultPruner`, and `compaction-basic` reaches the
  pruner through `ctx.get()`, which cannot cross an isolate boundary;
- `poserPruneur(definition, budget)`: mounts the row in every compaction group that has none, and adds
  `toolResultPruner: true` to that group's isolate list. A preset that already ships a pruner keeps its own budget;
- `poserEconomieContexte` now returns `{ rows, presets, ratio, pruneurs, presetsPruneur }`, and `index.js` logs
  `[kybers] compaction pruner: mounted in N preset(s) (...)` at boot.

Why visiting worse than the engine default (8 K chars): the pruner only runs once a trigger qualified, i.e. on a
surface already twice the threshold, where old tool dumps are dead weight. `BUDGET_PRUNEUR` is one line to change.

Tests: `node packages/kybernos-plugin/test-economie-contexte.mjs` (24 checks, including "a preset that already trims
keeps its own budget", "the isolate list admits the pruner service", "a compaction row outside a group is skipped").

Measurement: `node scripts/compaction-prune-mesure.mjs [--sessions N] [--budget 8192,4096,1024] [--ratio 0.5]`.

Rollback: delete the `poserPruneur(...)` call inside `poserEconomieContexte`, restart.

## Layer 2 (proposed, needs the engine): a summary fallback chain

`scripts/dsh-compaction-summary-fallback.patch`, against `@deepseek-ai/dsh-compaction-basic` 0.2.3-alpha.2
(`src/index.ts`). What it changes:

- `summaryCandidates(pinned, agent, answered)` builds an ordered list: an explicit operator pin, then the route that
  last answered (warm prefix), then the latest routed header, then the agent options. Duplicates collapse. **No model
  name appears anywhere**: the candidates are the ones the engine already knew about.
- `summarize()` walks that list and retries on failures that mean "this route produced nothing durable":
  `QUOTA`, `ACCOUNT_QUOTA`, `RATE_LIMIT`, `SERVER`, `TIMEOUT`, `TRANSPORT`, `STREAM_CLOSED`, `EMPTY_RESPONSE`,
  `MALFORMED_RESPONSE`, `CONTEXT_WINDOW_EXCEEDED`, `HTTP_413/429/500/502/503/504`. `AUTH`, `INVALID_*` and
  `MAX_TOKENS` are deliberately excluded: they would fail identically everywhere, or mean a real (truncated) summary.
- A pin is honoured on the first attempt only; fallbacks must not be forced back onto it.

Apply locally (it is overwritten by the next `npm install`, so this is a stopgap until upstream takes it):

```
cd ~/.dsh/kybernos/moteur/<version>/node_modules/@deepseek-ai/dsh-compaction-basic
patch -p1 < /Users/miled/kybernos-projects/kybernos-plugins/scripts/dsh-compaction-summary-fallback.patch
```

Verification plan:

1. replay the failing case: a session whose last answering route has no quota (kill the key, or use a spent plan) and a
   surface above the destination threshold; switch model; the log must show
   `summarization on <route> failed (QUOTA); retrying on <other route>` and the switch must land;
2. happy path unchanged: a normal compaction must still show exactly one summary event on the session's own route;
3. cancel during the first attempt: the turn must abort, not fall through to a second provider.

Upstream summary to send: "When automatic compaction runs for a model switch, the summary goes to the route that
produced the last assistant message. If that route is out of quota or rejects the payload, the switch fails with
MODEL_SWITCH_COMPACTION_FAILED even though another routable model could have written the checkpoint. `summarize()` is
already the sole hook; walking a candidate chain there, retrying only on provider-availability failures, keeps the warm
prefix in the normal case and turns a hard dead end into one extra call."

## Still out of reach without an engine change

- **Stuck pending model selection.** `modelSelection.pending` is an engine projection: after a failed switch, every
  later message replays the same doomed switch. Workaround today: reselect the current model (same provider/model = no
  switch, the pending retires), or start a new session.
- **`summary is not smaller than the shadowed range`** (3 cases): a region-selection problem, not a route problem.
- **HTTP 413 on the chat request itself** (seen on `opencode-go` from ~118 K tokens): the recovery path only reacts to
  `CONTEXT_WINDOW_EXCEEDED`, so the pruner never gets a chance to run. Lowering the threshold ratio for that route is
  the only config-level lever, and it is a per-route `modelPolicies` entry.

## Appendix: the dead `kybernos` route

838 compactions, 837 failing with `413 payload_too_large`, all in sessions that used a provider id `kybernos` that no
longer exists in any profile. Those are the `kyby` automation sessions still running on the retired route; they inflate
every compaction statistic and should be stopped separately (not part of this fix).
