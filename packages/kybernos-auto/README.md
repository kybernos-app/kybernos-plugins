# `@local/kybernos-auto`

Auto mode: a per-session switch, a whitelist of models and a router that picks one of them for each
delegated request by class (`chat`, `code`, `vision`, `media`, `agent-task`), with local health counters.
The session's own model is never changed; only the routing decision is served.

## What the user sees

- **Composer**: an "Auto" row appended to the native model menu (the one with Model and Effort): a
  "This session only" switch, an "N of M models available" pill and a small health table (model, latency,
  errors). While Auto is on, Model and Effort are greyed out and the model chip reads "Auto".
- **Settings**: a section "Auto routing" (order 14) with an "All sessions" switch (legacy global
  breaker: on forces Auto everywhere), the whitelist (`provider/model` chips, max 64), the classifier model
  (placeholder `ollama-local/tev1:0.8b`) and a local health table (latency, errors, cache hit, "warm cache"
  badge). It refreshes every 60 s and has "Re-check now".

## Host routes

JSON; the exact-origin guard answers `403` (an absent `Origin` passes). `POST` routes answer `405` otherwise.

| Route | Purpose |
| --- | --- |
| `GET /kybernos-auto/state?sessionId=` | `{global, whitelist, classifier, sessionOn, sante[], total, disponibles, chaud, checkedAt, intervalS}` |
| `POST /kybernos-auto/session` | `{sessionId, on}` turns Auto on or off for one session |
| `POST /kybernos-auto/settings` | any of `autoWhitelist` (unique strings, 200 chars max), `autoRouting` (boolean), `autoClassifier` |
| `POST /kybernos-auto/report` | `{modele, latenceMs?, erreur?, inputTokens?, cacheReadTokens?}` outcome of one delegation |
| `POST /kybernos-auto/router` | `{demande, sessionId?}` returns `{actif, classe, via, modele, candidats, raison}` |

## Files, settings, environment

All under `$DSH_HOME/kybernos/` (default `~/.dsh/kybernos/`):

- `settings.json`: keys `autoRouting`, `autoWhitelist`, `autoClassifier`. The file is shared (the core reads
  `pairingToken`, `gatewayBase`, `wsAdminKey`; `kybernos-sessions` writes its own keys): a save here merges into what is on
  disk, writes atomically, keeps the file's permissions, and refuses to overwrite a file that is unreadable or not a JSON
  object (a copy of a corrupt one is kept as `settings.json.corrupt-<time>`, and the route answers 500 with the reason).
- `auto-sessions.json`: `{"<sessionId>": true}`. `auto-health.json`: per model `calls`, `errors`,
  `lastLatencyMs`, `cacheInput`, `cacheRead`, `updatedAt`.
- Env: `DSH_HOME`, `AUTO_ROUTER_OLLAMA` (default `http://127.0.0.1:11434`).
- Browser: reads `localStorage['dsh.sessions.current']` (session id) and `window.__KB_LANG_RESOLVE__` (from
  `@local/kybernos`; French when absent or not `en`). Writes no browser storage.

## DSH seams and network

- Host: `webServer` only (`ctx.get`, else `ctx.inject(['webServer'])`). No `remote.*`.
- Client: `inject: ['slots']`, slot `settings.section`. The composer part has no seam: it finds the model menu
  (`[role="menu"]` containing the text "Effort") and the model chip (a button whose text contains "Default") in
  the DOM, polling every 300 ms. `package.json` declares `@deepseek-ai/dsh-client-ui-conversation`.
- Network: the router calls Ollama (`/api/generate`, 20 s timeout) only when the rules do not match and a
  classifier is set; it sends the first 400 characters of the request. Nothing else leaves the host.

## Routing, as coded

Three regex rules first (media, vision, code; mostly French wording), then the classifier, else `chat`. Candidates are
whitelist entries whose id matches a per-class pattern (for example `wan|image|video|tts` for media); the first
healthy one wins, in whitelist order. A model is "down" at 25 % errors over 3+ calls and is skipped; none left
means `modele: null` (keep the session model). It is a copy of the CLI `~/.dsh/tools/auto-router.mjs`, which
is not in this repo (not verified). No code in this repo calls `/router` or `/report`: the callers
(workflow, kyber, CLI) are not verified.

## Tests

```bash
node test-host.mjs   # 23 checks: routes on a fake webServer, temp home, no network
node test-client.mjs # 12 checks: static greps on client.js (data-kb hooks, tokens, menu wiring); it is not executed
```

`npm test` runs both; both pass. The "classifier offline" case does not exercise the Ollama failure: the
classifier was cleared earlier in the same test.

## Known limits

- The composer row depends on the native menu's text and structure, and two intervals (300 ms DOM poll,
  5 s state fetch) are never cleared.
- "Degraded" models (5 % errors) are labelled "skipped" in the composer table but the router only skips "down".
- `/router` already counts a call and `/report` counts it again, so error percentages are diluted
  (reading of the code, not measured).
- `auto-sessions.json` is only pruned when a session is switched off.
