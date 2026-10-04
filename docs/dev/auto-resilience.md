# Auto routing: probe first, circuit breaker, fallback chain

Three things were asked of Auto: **always probe the models first**, **cap the retries at 10 and capture the errors**, and
**redirect to another model when one does not answer**. The retry cap was already in the plugin
(`kybernos-plugin/retry-policy.mjs`, `KB_RETRY_PLAFOND`, default 10). The rest is `kybernos-auto`'s host, in
`packages/kybernos-auto/resilience.mjs`, with zero engine patches (it uses DSH's `llm` service and its own routes).

## What changed in the answer to a delegation

Before: the first whitelist model of the class that a *lifetime* error ratio had not marked "down" — nobody asked whether it
answers now, a model that once failed was judged for ever, and the caller got one choice with nothing behind it. A routing
call also counted as a call, and so did the report that followed (error rates were diluted).

Now `POST /kybernos-auto/router` answers, for a request of class `code` with `deepseek-chat` refusing its key:

```json
{ "actif": true, "classe": "code", "via": "regle",
  "modele": "openrouter/qwen/qwen-coder", "verifie": true,
  "candidats": ["openrouter/qwen/qwen-coder", "claude-code/claude-sonnet-5-5"],
  "ecartes": [{ "modele": "deepseek-official/deepseek-chat", "raison": "key", "code": "AUTH", "message": "invalid x-api-key" }],
  "sondes": 2, "sonde": "fraiche", "plafond": 10, "raison": "class code → openrouter/qwen/qwen-coder answered a probe (1 skipped)" }
```

`modele` is the first model to try (`null` = keep the session model), `candidats` the ordered fallbacks (never more than the
retry cap), `ecartes` who was skipped and why, `verifie` whether the head answered a probe a moment ago.

## The loop the agent follows

`AGENTS.md` (the agent's rule, in `~/.dsh`) says to call `auto-router.mjs` before every delegation. With the resilient router:

1. `auto-router.mjs "<the sub-task>"` → use `modele` as the workflow's `{provider, model}` override (`null` = no override).
2. The delegation ran: `auto-router.mjs --report <modele> --ok --latency <ms>` (optional, it feeds the page).
3. The delegation failed (no answer, refused, empty): `auto-router.mjs --report <modele> --error --code <CODE> --message "<why>"`,
   then `auto-router.mjs --exclude <modele> "<the same sub-task>"` for the next model. At most 10 attempts.

The command is `packages/kybernos-auto/cli/auto-router.mjs`, a thin client of `/router` and `/report` (it carries no routing
rules of its own: the host is the single source of truth, which also fixes the old drift between the host's copy and the
standalone CLI, which had the `design` class only on one side). If the host does not answer it prints `{"actif":false,…}` and
exits 0: delegate as usual.

## The circuit breaker

One record per model in `auto-health.json`, fed by probes (a real call, one output token) and by reports.

| Outcome | Effect |
|---|---|
| answered | closes the breaker, forgets the streak |
| refused key, model gone, request rejected, context window | opens it at once for 10 min (asking again will not fix it) |
| silent or failing otherwise | counts; the third in a row opens it for 1 min, doubling up to 10 min |
| rate limit, quota | opens it for 1 min, no streak |
| "not a language model" | left alone for an hour |
| transport failure | noted; the breaker is untouched (the network failed, not the model) |

After a pause the breaker is half-open: the next probe is the trial. "Check now" on the Auto page ignores the verdict cache and
probes the whitelist, so a key the user just fixed brings the model back at once instead of after ten minutes.

## Probe cost

One real call with one output token per candidate whose verdict is older than 60 s (a failed verdict is trusted for 10 s).
Routing a request probes at most ten candidates, three at a time, and gives up probing after 12 s (the rest is returned
unprobed, flagged). The probe is the same as the Study-model health check: its code is duplicated in
`kybernos-auto/sonde.mjs` (a verbatim block, enforced by a test) because bundles cannot import each other.

## Not done

- **Subtasks**: DSH has no seam that intercepts a delegation's model, so the caller still writes the override. Moving the retry
  loop into the engine would need one; until then it is the caller's loop above.
- The Models tab chip (`model-health.md`) and this page both say why a model fails, in the same words, but they keep separate
  records (the chip reads the Study-model probe, this page the delegations' and Auto's own probes).

## Tests

`packages/kybernos-auto/test-resilience.mjs` (breaker, triage, probe-first, router, routes with a fake llm), `test-cli.mjs` (the
command against the real host over HTTP), `test-host.mjs`, `test-client.mjs`. On the real GUI, read-only (the page's client
swapped in, the host module served on a temporary home with a fake llm): the status of each model with its reason and retry time,
"Check now" busy state and its effect.
