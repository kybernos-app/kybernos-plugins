# `@local/kybernos-relance`

Lets the agent **restart DSH without losing work**. The `relancer_dsh` tool asks for the user's approval when other
sessions are running, then starts a detached script that restarts DSH and wakes every session that was running. The
browser half reloads the page once when the host restarts, instead of leaving the interface black until F5.

## What the user sees

- **No other session running:** the restart starts after `delai` seconds, with no prompt.
- **Other sessions running:** DSH's native approval panel opens, naming those sessions. Only *Allow once* cuts
  anything; refusal, cancellation or an unavailable channel leave DSH untouched (fail closed).
- Under the `never` approval policy (full-access preset) no panel can open, so the tool refuses and says so, with the
  hint to switch the session to `workspace-write`.
- After the restart, DSH sends each resumed session a "resume where you stopped" message, and the open page reloads
  itself once.

## Host tool

| Tool | Parameters | Result |
| --- | --- | --- |
| `relancer_dsh` | `motif` (note kept for the resumed session), `delai` (seconds before the cut; default 20, clamped to 5–300) | `{coupe: true, dans_secondes, pid, approbation, sessions_actives, message}`, or `{coupe: false, raison, message}` |

Refusal reasons: `script_absent`, `agent_inconnu`, `sessions_illisibles`, `approbation_indisponible`,
`politique_never`, the approval outcome (`rejected`, `cancelled`, `unavailable`) and `spawn_impossible`.
Running sessions come from `sessionController.list` (the current session and sub-agent children are excluded),
falling back to `node ~/.dsh/tools/dsh-relance.mjs actives --json`. The tool then spawns, detached:
`dsh-relance.mjs relance --avec-autres --session <id> --delay <n> --port <port> [--motif <text>]`.

## Files and settings

- Reads `~/.dsh/tools/dsh-relance.mjs` (the source is `scripts/dsh-relance.mjs` in this repo). Env: `DSH_HOME`;
  `DSH_PORT` only when `webServer` gives no port (default 3080).
- `defineTool` is resolved lazily from `@deepseek-ai/dsh-tools` under `~/.dsh/profiles/web/node_modules`, then two
  Homebrew/global paths; otherwise a literal definition of the same shape is registered.
- Client: `sessionStorage` key `kybernos-relance:dernier-rechargement` (anti-loop timestamp).
- The script, not this bundle, writes `~/.dsh/logs/dsh-relance*.{log,json}` and derives its API cookie from the
  secret in `~/.dsh/.credentials.yaml`.

## DSH seams and network

- Host: `ctx.tools.register` (waits for the `tools` service through `ctx.inject`), plus `ctx.get` of
  `sessionController`, `approval` (`request`, `effectivePolicy`) and `webServer`. No static `@deepseek-ai/*` import.
- Client: `ctx.effect` with an `EventSource` on DSH's own `/plugins/events` channel; `inject: []`. It reloads when more
  than half of the plugin-graph revisions change, at most once per 20 s. A single-plugin rebuild is left to DSH's HMR.
- `remote.*`: none. The bundle's only network use is that same-origin event stream. The script talks to the local
  DSH only (`http://127.0.0.1:<port>`).

## Tests

```bash
node packages/kybernos-relance/test-client.mjs   # fake EventSource/location: baseline, single rebuild, restart, anti-loop
node packages/kybernos-relance/test-host.mjs     # fake script, sessionController and approval; add -v to keep the temp DSH_HOME
```

`test-host.mjs` covers the approval paths, the `never` policy, the CLI fallback, argv passed to the script and the
`defineTool` fallback shape. That last comparison is skipped, and says so, when DSH is not installed on the machine.

## Known limits

- Nothing in this repository copies `dsh-relance.mjs` to `~/.dsh/tools/` (not verified how it gets there); without
  it the tool answers `script_absent`.
- The fallback shape was checked against `dsh-tools` 0.1.7-alpha.1 only (per the source comment).
- The stop/start mechanics of the script on each OS are not verified here.
- The tool description and results are French, as agent-facing text.
