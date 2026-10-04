# `@local/kybernos-workers`

Settings → **Workers**: one card per external coding agent DSH can drive (Claude Code, Codex, ZCode; Hermes is shown
as unsupported), with a state that is **checked for real** and the one delegation policy DSH actually exposes:
whether the lead can delegate to the worker, and whether it may run in the background.

## What the user sees

- *Check* runs five controls per worker: connection mounted in the profile, package installed, binary found on DSH's
  `PATH`, sign-in reported by the CLI, and a write test in a throw-away git worktree. *Check all* does every mounted
  one. No model is called, so nothing is spent on the worker's subscription.
- Statuses: Ready, Checked but partly verified, Connection not mounted, Mounted: restart DSH, Not installed, Not
  signed in, Cannot write, MCP server not found, Not supported, Not checked yet.
- *Install the connection* (not mounted yet) and two switches, *Exposed to the lead* and *Background allowed*,
  applied with *Apply to profile*. A banner says when a DSH restart is needed.

## Host routes

| Route | Reply |
| --- | --- |
| `GET /kybernos-workers/state?profile=` | `{ok, profil, profils, patch, patchExiste, workers[]}`, each with `connexion`, `installe`, `ligne` (policy line) and `dernier` (last check) |
| `POST /kybernos-workers/check` `{worker, profile?}` | `{ok, worker, quand, statut, controles[]}`; 409 `busy` while another check or write runs |
| `POST /kybernos-workers/policy` `{worker, expose, background, profile?, dry?}` | `{ok, action: ajout\|modification\|inchange, restart, backup, patch}` |

POSTs need `application/json` and an `Origin`/`Referer` on `127.0.0.1`, `localhost` or `[::1]` with the server's own
port; a GET without either header is accepted. Policy refusals: `ligne-existante`, `ligne-modifiee-a-la-main`,
`connexion-absente`, `auto-controle`, `non-supporte`, `patch-missing`, `write-failed`.

## Files, settings, processes

- Reads `~/.dsh/profiles/<profile>/cordis.patch.yml`; profile = request value, else `DSH_PROFILE` if it exists, else
  `web`. Also tests that `…/node_modules/@deepseek-ai/dsh-subagent-{claude-code,codex}` exist, and for ZCode that
  `~/.dsh/mcp/zcode-mcp-server.mjs` exists.
- Writes only on *Apply*: first `cordis.patch.yml.bak-workers-<worker>-<YYYYMMDD-HHMMSS>`, then an atomic rewrite of
  `cordis.patch.yml` adding or editing a `@deepseek-ai/dsh-tool-subagent` entry (`kybernos-workers-claude-code` or
  `-codex`; `disabled: true` when not exposed). DSH must restart to apply it. *Install* goes through `kybernos-plugin`'s
  `/kybernos/tools/apply`; the active profile comes from its `/kybernos/tools/state`.
- Runs `claude --version`, `claude auth status`, `codex --version`, `codex login status` and `git init/add/commit/
  worktree add` in a temp folder (removed afterwards), with 20–30 s timeouts. The environment is DSH's own minus any
  variable whose name matches KEY, TOKEN, SECRET, PASSWORD, PASSWD, CREDENTIAL, COOKIE or AUTH (so `SSH_AUTH_SOCK` too).
- The last check per profile and worker is kept in memory only. Env read: `DSH_HOME`, `DSH_PROFILE`, `PATH`, `PATHEXT`.

## DSH seams and network

- Host: `webServer.register({kind: 'exact'})` inside `ctx.effect`; `apply` is wrapped in try/catch so a failure never
  stops DSH. Logic lives in `workers-host.mjs` with injected I/O. No `@deepseek-ai/*` import.
- Client: `ctx.inject(['slots'])`, slot `settings.section` (id `kybernos-workers`, order 30), `require('react')`.
- `remote.*`: none. Same-origin `fetch` only, to its own routes and the two core routes above. Whether
  `claude auth status` or `codex login status` contacts their vendors is not verified.

## Tests

```bash
node packages/kybernos-workers/test-host.mjs   # 101 checks: patch parsing, policy, check scenarios, routes, real I/O (needs git on PATH)
node scripts/test-workers-gui.mjs              # real client in Chromium against the real routes; exits 0 "SKIPPED" without playwright + react@18
```

The GUI test was not run for this README. `scripts/smoke-gui.mjs` also hits `/kybernos-workers/state` on a running DSH.

## Known limits

- "Ready" is not a proof of delegation. ZCode can never reach it: its sign-in sits in its own vault, so that control is
  always `inconnu` and the status stays "partly verified".
- Policy writes cover Claude Code and Codex only. The patch is read line by line, not with a YAML parser; unknown forms
  are ignored, and a tool line this module did not write (or that was edited by hand) is never rewritten.
- Model, permissions and run duration are not settable: DSH's connection packages expose no key for them.
- One lock for the whole host, across profiles. POSTs from a non-loopback host name (LAN address, proxy) get 403.
- Strings are French by default; English only when the resolved language is `en`.
