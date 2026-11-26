# Workers Metaharness — Phase 0 Truth & Safety Gate

**Date:** 2026-11-25  
**DSH engine measured:** `@deepseek-ai/dsh` `0.2.3-alpha.2`  
**Official connectors measured:** `@deepseek-ai/dsh-subagent-{claude-code,codex,acp}` `0.2.3-alpha.2`  
**Zero paid model calls, zero secrets read or printed.**

This document records the empirical measurements and safety fixes required by Phase 0 of the Workers Metaharness study (`artifacts/workers-metaharness-2026-11-25/study.md`) before starting Phase 1 implementation.

---

## 1. Verified Driver Capability Matrix (All 8 Workers)

The authoritative runtime declaration lives in `DRIVER_CAPABILITIES` in `packages/kybernos-workers/workers-host.mjs` and is exposed on every worker row returned by `GET /kybernos-workers/state`. Anything marked `unknown` or `unsupported` blocks multi-account UI promises until proven with two isolated identities.

| Driver | Package / Transport | `multiAccount` | `authIsolation` | `modelSelection` | `modelDiscovery` | `continuation` | Phase 0 Empirical Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `claude-code` | `@deepseek-ai/dsh-subagent-claude-code` (`claude-agent-sdk`) | `unknown` | `profile-dir` (`CLAUDE_CONFIG_DIR`) | `true` | `manual` | `one-shot` | `CLAUDE_CONFIG_DIR=<tmp>` isolated `claude auth status` (`loggedIn: false`, `authMethod: "none"`) from default logged-in `~/.claude`; synthetic `ANTHROPIC_API_KEY` stayed isolated to dir A while dir B remained logged out. Two live macOS Keychain OAuth logins were not executed, so `multiAccount` stays `unknown` until proven. |
| `codex` | `@deepseek-ai/dsh-subagent-codex` (`app-server --stdio`) | `proven` | `profile-dir` (`CODEX_HOME`) | `true` | `manual` | `one-shot` | Two synthetic `CODEX_HOME` directories with distinct `auth.json` files returned `codex login status` exit `0`, while an empty third `CODEX_HOME` returned exit `1` (`Not logged in`), proving zero leakage from `~/.codex`. Official connector accepts `model` and `env`. |
| `gemini` | `@local/dsh-subagent-maison/gemini` (`cli-one-shot`) | `proven` | `credential-ref` | `true` (`-m`) | `manual` | `one-shot` | Per-run `ctx.credentials` resolution via `cleDuRun`; key injected only into child `GEMINI_API_KEY` env, never argv or `cordis.patch.yml`. Verified in `test-integration.mjs` (rotation + boot env override). |
| `antigravity` | `@deepseek-ai/dsh-subagent-acp` (`agy acp`) | `unknown` | `native-single` | `false` | `cli` (`agy models`) | `one-shot` | Official ACP schema (`@deepseek-ai/dsh-subagent-acp/lib/index.js`) has no `model` config key. `XDG_CONFIG_HOME`/`XDG_DATA_HOME` alone did **not** isolate `agy models` (exit `0`); `HOME=<tmp>` did isolate (exit `1`), but full `HOME` override side effects on child tools (`git`, `ssh`) and two-account Google login are unproven. |
| `opencode` | `@local/dsh-subagent-maison/opencode` (`cli-one-shot`) | `unknown` | `native-single` | `true` (`-m`) | `manual` | `one-shot` | Binary not installed on the test host (`ENOENT`); isolation could not be measured locally. |
| `qwen` | `@local/dsh-subagent-maison/qwen` (`cli-one-shot`) | `proven` | `credential-ref` | `true` (`-m`) | `manual` | `one-shot` | Per-run `ctx.credentials` resolution via `cleDuRun`; key injected only into child `OPENAI_API_KEY` env, never argv or `cordis.patch.yml`. Verified in `test-integration.mjs`. |
| `hermes` | `@local/dsh-subagent-maison/hermes` (`cli-one-shot`) | `unsupported` | `native-single` | `true` (`-m`) | `live` (`/models` `:free`) | `one-shot` | `HERMES_HOME=<tmp>` relocated `auth.json` for Codex/xAI OAuth, **but** Qwen OAuth inside `hermes status` still resolved `~/.qwen/oauth_creds.json` under `$HOME`. Incomplete isolation → marked `unsupported`. |
| `zcode` | `@deepseek-ai/dsh-mcp-client` (`mcp-local`) | `unsupported` | `native-single` | `false` | `manual` | `one-shot` | Local MCP server with its own credential vault; outside the subagent dispatcher. |

---

## 2. Proven vs Unproven Agent / Session Scopes (`0.2.3-alpha.2`)

Inspected directly in `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-agent`, `@deepseek-ai/dsh-tool-agent-team`, `@deepseek-ai/dsh-subagent`, and `packages/kybernos-plugin/index.js`:

| Scope | Status | Real Runtime Seam | Enforcement Verdict |
| --- | --- | --- | --- |
| `default` | **Proven** | Always present | Enforceable in Phase 0 / Phase 1 |
| `preset:<id>` | **Proven** | Durable `agent.session.header.agentPreset` (`SessionHeader`, `dsh-session/lib/types/types.d.ts`) | Enforceable in Phase 0 / Phase 1 via `resolveProvenAgentScope()` |
| `automation` / `automation:<id>` | **Proven (plugin-tracked)** | Runtime session tracker (`kbAskSessions` / `header.parentSession` walk, `packages/kybernos-plugin/index.js`) | Enforceable when supplied by the host's explicit automation session tracker |
| `team:<id>` | **Not on `SessionHeader`** | Asynchronous activation file `~/.dsh/kybers/.active/<sessionId>`; absent from `SessionHeader` and `Provider.start(request)` | Do not advertise as enforced until an explicit synchronous session-to-team binding is wired at session/team start |
| `role:<id>` | **Unproven** | Teammates are spawned via `subagent`/`subagent_fork` with a display `name` in the parent's `subagentCatalog`; no durable `roleId` on `SessionHeader`, `Agent`, or `tools/pre-execute` | Defer to Phase 2 with explicit binding at teammate creation |

`resolveProvenAgentScope(agent, options)` in `packages/kybernos-plugin/tool-profiles.mjs` strictly resolves only the proven seams (`automation:<id>` → `automation` → `preset:<id>` → `default`) and never invents team or role identifiers.

---

## 3. Official Connector Hot-Reload Measurement (`cordis.patch.yml`)

Measured live against `@deepseek-ai/cordis`, `@deepseek-ai/dsh-subagent`, and `@deepseek-ai/dsh-subprocess-local` (`0.2.3-alpha.2`) by disposing and re-mounting a provider plugin fork mid-run while a managed child process was running:

- **Already-published runs survive:** `run1Survived: true` (`stopReason: "completed"`, `exit=0`). `dsh-subprocess-local` tracks live processes on the singleton service (`this.live`), not on the provider plugin's Cordis scope, and `SubagentRuntime.registerProvider` explicitly leaves already-returned handles running on provider removal.
- **Transient gap hazard (`gapProviderPresent: false`):** Between `fork1.dispose()` (`subagent/provider-removed`) and `fork2` mounting (`subagent/provider-added`), `dsh-tool-subagent` immediately calls `mounted.disposeTool()`, unmounting `subagent_<worker>` from `ctx.tools`. Any LLM turn assembling its prompt during that gap loses the tool (prefix cache invalidation) and concurrent starts fail with `NO_PROVIDER`.
- **Startup race (`PROVIDER_CHANGED`):** Any delegation in `preflightChildLlmRoute` / `startActivation` startup when the provider reloads fails with `SubagentError(..., "PROVIDER_CHANGED")`.
- **Operational rule for Phase 1+:** Never promise zero-disruption hot-reload on official connectors. Queue or refuse `cordis.patch.yml` rewrites while a delegation startup/turn is in flight, and move multi-account routing to a stable plugin-owned dispatcher in Phase 2.

---

## 4. Phase 0 Safety Fixes & Gates Landed

1. **Credential precedence & `0.2.3-alpha.2` CWD seam fixed (`packages/dsh-subagent-maison/fabriquer-provider.mjs`, `packages/kybernos-workers/index.js`):**
   - `apply()` no longer freezes boot-time `process.env` into `resolved.apiKey`.
   - `cleDuRun()` resolves per run in exact order: explicit `config.apiKey` → live `ctx.credentials` store → launch-time `process.env` fallback.
   - `cleDansEnv()` in `packages/kybernos-workers/index.js` checks `ctx.credentials` before `process.env`, matching `cleDuRun()`.
   - `ProviderMaison.start()` now supports both DSH `0.2.3-alpha.2` (`assertUsableCwd` + `request.cwd`) and legacy `0.2.2` (`resolveChildCwd` + `request.parent.session.header.cwd`), fixing a `resolveChildCwd is not a function` breakage caught by `test-integration.mjs` on `0.2.3-alpha.2`.
2. **Contradictory API-key restart copy removed (`packages/kybernos-workers/client.js`, `README.md`, `scripts/test-workers-gui.mjs`):**
   - Saving an API key no longer triggers the restart banner (`setPending`) and informs the user that it takes effect on the next delegation with no restart.
3. **Legacy Claude Code force-enable gated (`packages/kybernos-plugin/preset-legacy.mjs`, `index.js`, `test-preset-legacy.mjs`):**
   - `activerSubagentClaude()` now yields whenever an explicit user policy exists (`hasExplicitWorkerPolicy` checks `cordis.patch.yml` `disabled: true` on Claude Code and `harness.json` `agentPolicies`).
4. **Official connector `model`/`env` patch contract & scoped locks (`packages/kybernos-workers/workers-host.mjs`, `test-host.mjs`):**
   - `analyserPatch()` parses nested `config.env` maps alongside `config.model`.
   - `calculerConfigConnexion()` pins read/write round-trips for `model` and non-secret `env`, strictly refusing any secret-looking env key (`secret-in-patch-refused`) and refusing `model` on connectors without `modelSelection` (ACP).
   - Replaced the single global `occupe` lock with per-`(profile, worker)` check locks and per-`profile` patch write locks.
5. **Single-pass worker policy composition & execution guard (`packages/kybernos-plugin/tool-profiles.mjs`, `test-tool-profiles.mjs`):**
   - `filterFor()` composes task profiles + `workerPolicy` (`allow`/`deny`) in one single `tools.restrict()` pass without widening non-worker capabilities, and handles revocations on `full` sessions.
   - Pinned default worker visibility by task profile (`code`/`office`/`automation` hide `subagent_<worker>` unless explicitly allowed; `full` keeps them unless revoked).
   - Added `mountWorkerExecutionGuard()` (`tools/pre-execute`) to enforce revocations immediately in already-open or `full` sessions without mutating prompt prefixes.
