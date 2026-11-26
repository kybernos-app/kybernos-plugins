# `@local/kybernos-guard`

Deterministic Pass 1 security guard for DSH tools. Runs locally in the host process with zero LLM calls, < 2 ms latency, linear-time regexes only, and no engine patches.

## What it protects against

1. **Secret leaks (`tools/pre-execute`)**: blocks outbound tools (`web_fetch`, `mcp__*`, `connections_execute`, `browser_*`) and network shell commands (`curl`, `wget`, `scp`, `nc`…) containing API keys, tokens, private keys, or sensitive credential files (`.env`, `~/.ssh/id_*`, `~/.aws/credentials`).
2. **Destructive commands (`tools/pre-execute`)**:
   - **Hard block**: recursive root/home `rm -rf`, disk wipes (`mkfs`, `dd of=/dev/...`, `diskutil eraseDisk`), `curl|sh` / `wget|bash`, fork bombs, `chmod 777 /`, and self-tampering of `kybernos/guard/*`.
   - **Human confirmation (`{ kind: 'ask' }`)**: `git push --force`, `git reset --hard` / `git clean -fd`, SQL `DROP`/`TRUNCATE`, `sudo`, and recursive `rm -rf` inside a workspace.
3. **Protected writes (`tools/pre-execute`)**: blocks file-write tools targeting `~/.ssh`, `/etc`, `/System`, `/usr/bin`, or `kybernos/guard/*`.
4. **Prompt-injection defense (`tools/post-execute`)**: scans untrusted external tool outputs (`web_fetch`, `web_search`, `mcp__*`, `browser_*`) and attaches a structured `additionalContexts` warning when injection markers are detected.

## Host routes

Under `/kybernos-guard/`, behind the Host fence and Origin guard (`POST` also requires DSH's signed session cookie and a 16 KiB body cap):

| Route | Does |
| --- | --- |
| `GET /kybernos-guard/status` | current policy (`enforce` / `audit` / `off`, switches, `allowRules`) and aggregate counters |
| `GET /kybernos-guard/events?limit=100&kind=&action=` | recent sanitised audit events (metadata only — never raw secrets, commands, or content) |
| `POST /kybernos-guard/settings` | updates policy atomically in `$DSH_HOME/kybernos/guard/settings.json` (`0600`) |

## Host seam

Publishes read-only `globalThis[Symbol.for('kybernos.guard')]` (`{ version: 1, evaluatePreExecute, scanSecrets, scanCommand, scanPromptInjection, stats }`) for peer bundles.

## Tests

```bash
cd packages/kybernos-guard && node test-guard.mjs && node test-write-guard.mjs
```
