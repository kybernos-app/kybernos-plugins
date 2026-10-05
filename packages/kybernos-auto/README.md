# `@local/kybernos-auto`

Auto mode: a per-session switch, a whitelist of models and a router that picks one of them for each
delegated request by class (`chat`, `code`, `vision`, `media`, `design`, `agent-task`). The router is **resilient**: it probes
the candidates before it answers, keeps a circuit breaker per model, and hands back an ordered fallback chain (see
`docs/dev/auto-resilience.md`). The session's own model is never changed; only the routing decision is served.

## What the user sees

- **Composer**: an "Auto" row appended to the native model menu (the one with Model and Effort): a
  "This session only" switch, an "N of M models available" pill and a small health table (model, latency,
  errors). While Auto is on, Model and Effort are greyed out and the model chip reads "Auto".
- **Settings**: a section "Auto routing" (order 14) with an "All sessions" switch (legacy global
  breaker: on forces Auto everywhere), the whitelist (`provider/model` chips, max 64), the classifier model
  (placeholder `ollama-local/tev1:0.8b`) and a local health table (latency, errors, cache hit, "warm cache"
  badge). Each model says WHY it is skipped (cause, retry time, last error). It refreshes every 60 s; "Check now" probes the
  whitelist for real.

## Host routes

JSON; the exact-origin guard answers `403` (an absent `Origin` passes). `POST` routes answer `405` otherwise.

| Route | Purpose |
| --- | --- |
| `GET /kybernos-auto/state?sessionId=` | `{global, whitelist, classifier, sessionOn, sante[], total, disponibles, chaud, sondeEnCours, plafond, ttlSondeS, checkedAt, intervalS}`; each `sante` entry: `{modele, etat (jamais\|ok\|degrade\|down), disjoncteur (closed\|open\|half-open), jusqua, cause, consecutive, calls, errors, erreurPct, lastLatencyMs, cacheHitPct, lastError, sonde}` |
| `POST /kybernos-auto/session` | `{sessionId, on}` turns Auto on or off for one session |
| `POST /kybernos-auto/settings` | any of `autoWhitelist` (unique strings, 200 chars max), `autoRouting` (boolean), `autoClassifier` |
| `POST /kybernos-auto/report` | `{modele, latenceMs?, erreur?, code?, message?, inputTokens?, cacheReadTokens?}` outcome of one delegation; an error keeps its reason and feeds the breaker |
| `POST /kybernos-auto/router` | `{demande, sessionId?, exclure?[], sonde?}` returns `{actif, classe, via, modele, verifie, candidats[], chaine[], ecartes[], sondes, sonde, delai, plafond, raison}` |
| `POST /kybernos-auto/probe` | `{models?[]}` probes the whitelist (or the whitelist models named; any other is ignored) for real, ignoring the verdict cache; a run that ended under 5 s ago is not repeated; 503 when the llm service is absent |

## Files, settings, environment

All under `$DSH_HOME/kybernos/` (default `~/.dsh/kybernos/`):

- `settings.json`: keys `autoRouting`, `autoWhitelist`, `autoClassifier`. The file is shared (the core reads
  `pairingToken`, `gatewayBase`, `wsAdminKey`; `kybernos-sessions` writes its own keys): a save here merges into what is on
  disk, writes atomically, keeps the file's permissions, and refuses to overwrite a file that is unreadable or not a JSON
  object (a copy of a corrupt one is kept as `settings.json.corrupt-<time>`, and the route answers 500 with the reason).
- `auto-sessions.json`: `{"<sessionId>": true}`. `auto-health.json`: per model `calls`, `errors`, `probes`,
  `lastLatencyMs`, `cacheInput`, `cacheRead`, and the breaker: `consecutive`, `openUntil`, `openReason`, `lastError`,
  `recent` (the last five errors), `lastOkAt`, `lastProbe`, `updatedAt`. A file written before the breaker existed reads as
  "all closed".
- Env: `DSH_HOME`, `AUTO_ROUTER_OLLAMA` (default `http://127.0.0.1:11434`), `KB_RETRY_PLAFOND` (the chain cap, default 10, the
  same variable the plugin's retry cap uses), `KB_AUTO_DELAI` (probe timeout per model, default 8000 ms).
- Browser: reads `localStorage['dsh.sessions.current']` (session id) and `window.__KB_LANG_RESOLVE__` (from
  `@local/kybernos`; French when absent or not `en`). Writes no browser storage.

## DSH seams and network

- Host: `webServer` (`ctx.get`, else `ctx.inject(['webServer'])`), plus the `llm` service read **at call time** through a getter
  (DSH may publish it after this plugin; with it absent nothing is probed and the answer says so). No `remote.*`.
- Client: `inject: ['slots']`, slot `settings.section`. The composer part has no seam: it finds the model menu
  (`[role="menu"]` containing the text "Effort") and the model chip (a button whose text contains "Default") in
  the DOM, polling every 300 ms. `package.json` declares `@deepseek-ai/dsh-client-ui-conversation`.
- Network: the router calls Ollama (`/api/generate`, 20 s timeout) only when the rules do not match and a
  classifier is set; it sends the first 400 characters of the request. Probes go through DSH's `llm` service: one real call
  with one output token (`ping`) per candidate that has no verdict younger than a minute.

## Routing, as coded

Rules first (media, vision, design, code; mostly French wording), then the classifier, else `chat`. Candidates are whitelist
entries whose id matches a per-class pattern (for example `wan|image|video|tts` for media), else any non-media text model, in
whitelist order. Then, in `resilience.mjs`:

1. **Triage**: models whose breaker is open (or that the caller names in `exclure`) are skipped, each with its reason; at most
   10 are kept (the retry cap).
2. **Probe first**: candidates are probed three at a time, in order, until one answers; a healthy verdict is trusted for 60 s, a
   failed one for 10 s; after 12 s the rest is handed over unprobed (`verifie: false`).
3. **The chain**: the models that answered come first (`verifie: true`), the unprobed ones follow. `modele` is the head,
   `candidats` the whole ordered list; none left means `modele: null` (keep the session model).
4. **The breaker** (per model, fed by probes and by `/report`): a failure retrying cannot fix (`AUTH`, `UNKNOWN_MODEL`,
   `INVALID_REQUEST`, `PI_AI_ERROR`, `CONTEXT_WINDOW_EXCEEDED`) opens it for 10 minutes at once; a silent or flaky one after
   three in a row, for 1 minute doubling up to 10; a rate limit for 1 minute; a model that refused to be a language model for an
   hour; a transport failure does not count against the model. After the pause it is half-open: the next probe decides
   (success closes it, failure reopens it for longer). "Check now" ignores the cache, so a fixed key comes back at once.

The agent's command is `cli/auto-router.mjs` (a thin client of `/router` and `/report`; install it as
`~/.dsh/tools/auto-router.mjs`). `AGENTS.md` tells the agent to call it before a delegation.

## Tests

```bash
node test-host.mjs       # 33 checks: routes on a fake webServer, temp home, no network
node test-resilience.mjs # 70 checks: breaker, triage, probe-first, router, routes with a fake llm; the probe copy matches sessions'
node test-cli.mjs        # 10 checks: cli/auto-router.mjs against the real host module over HTTP
node test-client.mjs     # 13 checks: static greps on client.js (data-kb hooks, tokens, menu wiring); it is not executed
```

`npm test` runs them. The "classifier offline" case does not exercise the Ollama failure: the classifier was cleared earlier in
the same test. `sonde.mjs` holds a verbatim copy of the Study-model health probe (`kybernos-sessions/brain-health.mjs`);
`test-resilience.mjs` fails if the two differ.

## Known limits

- The composer row depends on the native menu's text and structure, and two intervals (300 ms DOM poll,
  5 s state fetch) are never cleared.
- `auto-sessions.json` is only pruned when a session is switched off.
- Nothing in DSH calls `/router` by itself: the agent calls it (through the CLI) because `AGENTS.md` says so, and the delegation
  is made by the caller with the `{provider, model}` override. A delegation that fails is only learned from if the caller
  reports it (`--report`); the probe covers the rest.
- A probe is a real call. A route that answers through a CLI or a subscription (`claude-code`) is probed like any other; what
  that costs there has not been measured.
- The classes and their id patterns are rules read on the model id (no metadata per model), as before.
