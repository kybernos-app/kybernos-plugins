# `@local/kybernos-workers`

Settings → **Workers**: one row per external coding agent DSH can drive — Claude Code, Codex, Gemini CLI, OpenCode, Qwen
Code, Hermes and ZCode — with a state that is **checked for real**, a way to get the agent running (turn it on, install
it, sign in), and the one delegation policy DSH actually exposes: may the main agent hand it tasks, and may it work in the
background.

## What the user sees

- **One row per agent, the same columns on every row**: logo and name, one line (vendor · what it signs in with), a
  status word, four dots (turned on · installed · signed in · checked), and **one next action**: *Turn on*, *Check*,
  *Install*, *Sign in* or *What to do?* — and, once the agent is ready, the *Allowed* switch. At 640 px or less (measured on
  the page, not the screen) the row stacks.
- **A checklist in the details** (turn on, install the program, sign in, check). The first step not done shows what to do:
  - *Install* shows the **exact command and where it comes from**, asks for a confirmation, then runs it on the host and
    checks again by itself. It is the only thing the page ever runs, and only after the person said yes. A "do it myself"
    way shows the command to copy, the Homebrew line and the vendor's guide.
  - *Sign in* is the person's own job: a command to type in a terminal (Claude Code, Codex, OpenCode, Hermes) or an **API
    key to paste** (Gemini, Qwen). The key goes to DSH's credentials service under `GEMINI_API_KEY` /
    `QWEN_TOKEN_PLAN_API_KEY`, is never shown again, never fetched, never logged.
  - *Permissions*: "the main agent can hand it tasks" and "it can work in the background", applied with *Save*.
- *Check* runs five controls: connection mounted in the profile, package installed, program found on DSH's `PATH`,
  sign-in (reported by the CLI, or an API key found in DSH's environment), and a write test in a throw-away git worktree.
  *Check all* does every mounted one. No model is called, so nothing is spent on the agent's subscription.
- **No restart for a connection or a policy.** DSH reloads `cordis.patch.yml` by itself: measured on DSH 0.2.0-rc.2
  (2026-10-08, sandbox instance) a connection turned on is `active` in the plugin inventory 2 s after the write and the
  `subagent_<worker>` tool appears 3–4 s after a policy is saved; the page says "DSH applies it in a few seconds". A banner
  asks for a restart only for the two things DSH reads once at launch: a stored API key and a program installed in a
  folder that is not on DSH's `PATH`. The status *Restart DSH* means something else: the connection is in the profile but
  its package is not (a package that is missing from the profile cannot load until it is linked).
- **"? How it works"** is the shared help card of the Suite, with a *Try the demo* button that opens the guide of this
  page: what a worker is, a clickable simulation of the whole path (turn on → check → install → sign in → check again →
  allow → delegate), and the usual questions (cost, files, what to do when it will not turn green, where the Terminal is).
  The demo is a simulation: it installs and writes nothing. An older Suite whose card has no action button leaves the page
  with a *Guide and demo* button of its own.

Statuses: Ready, To check, Not turned on, To install, To connect, To confirm (ZCode: its sign-in sits in its own vault and
can never be confirmed here), Restart DSH, Cannot write, Server not found.

## Host routes

| Route | Reply |
| --- | --- |
| `GET /kybernos-workers/state?profile=` | `{ok, profil, profils, patch, patchExiste, workers[]}`, each with `connexion`, `installe`, `activation`, `connect`, `install` (`cmd`, `alt`, `src`, `needs`, `doc`, `possible`), `ligne` (policy line), `dernier` (last check) and `job` (install job) |
| `POST /kybernos-workers/check` `{worker, profile?}` | `{ok, worker, quand, statut, controles[]}`; 409 `busy` while another check or write runs |
| `POST /kybernos-workers/policy` `{worker, expose, background, profile?, dry?}` | `{ok, action: ajout\|modification\|inchange, restart, backup, patch}` |
| `POST /kybernos-workers/activate` `{worker, profile?}` | mounts the connection of a home-made worker (Gemini, OpenCode, Qwen, Hermes): `{ok, already, restart, backup}`; 409 `package-missing` when the profile does not hold the package |
| `POST /kybernos-workers/install` `{worker, command}` | 202 `{ok, started}`; the job runs off the request |
| `GET /kybernos-workers/install?worker=` | `{ok, job: {phase: running\|done\|error, journal[], code, surLePath, raison}}` |

POSTs need `application/json` and an `Origin`/`Referer` on `127.0.0.1`, `localhost` or `[::1]` with the server's own port;
a GET without either header is accepted. Policy refusals: `ligne-existante`, `ligne-modifiee-a-la-main`, `connexion-absente`,
`auto-controle`, `non-supporte`, `patch-missing`, `write-failed`. Install refusals: `command-changed` (the command shown is
not the one the host would run), `busy`, `already-installed`, `missing-tool` (`npm`, `curl` or `bash` is not on the `PATH`),
`unsupported-platform` (only macOS and Linux for now), `not-installable` (ZCode), `install-unavailable`.

Claude Code and Codex are turned on through the main plugin's Tools screen (`/kybernos/tools/apply`, same patch, same
backup); the four home-made connections are turned on here, because the Tools screen does not know them.

## Files, settings, processes

- Reads `~/.dsh/profiles/<profile>/cordis.patch.yml`; profile = request value, else `DSH_PROFILE` if it exists, else `web`.
  Tests that `…/node_modules/<package>` exists for each connection: `@deepseek-ai/dsh-subagent-{claude-code,codex}` for those two,
  the shared `@local/dsh-subagent-maison` for the other four (a line that still carries the old bare name of a hand-made
  setup is judged by its own bare package `dsh-subagent-<cli>`: the package must be the one the line loads), and, for ZCode, that `~/.dsh/mcp/zcode-mcp-server.mjs` exists.
- Writes only on *Save* and *Turn on* (nothing else is ever written): first `cordis.patch.yml.bak-workers-<worker>-<YYYYMMDD-HHMMSS>` (or
  `bak-workers-activate-<worker>-…`), then an atomic rewrite of `cordis.patch.yml` that adds or edits a
  `@deepseek-ai/dsh-tool-subagent` entry (`kybernos-workers-<worker>`; `disabled: true` when not allowed) or adds the
  `- id: subagent-<worker>` line (`name: "@local/dsh-subagent-maison/<worker>"`) that loads the connector. DSH applies it by
  itself. Turning on a connection whose package is not in the profile is refused: DSH would fail to load it. A machine that
  was set up by hand (old bare name `dsh-subagent-<cli>`) reads as already turned on, so no second line is added; it is "installed" only while its own bare link exists.
- Runs `<program> --version`, `claude auth status`, `codex login status`, `opencode auth list`, `hermes status` and
  `git init/add/commit/worktree add` in a temp folder (removed afterwards), with 20–40 s timeouts. The environment is DSH's
  own minus any variable whose name matches KEY, TOKEN, SECRET, PASSWORD, PASSWD, CREDENTIAL, COOKIE or AUTH (so
  `SSH_AUTH_SOCK` too). Gemini and Qwen are not asked anything: the host only tests whether one of their API-key variables
  is non-empty in DSH's environment, and answers a boolean — the value never leaves that function.
- **Install** runs one of six constants through `/bin/sh -c` (`curl -fsSL https://… | bash` for Claude Code, OpenCode and
  Hermes; `npm install -g …` for Codex, Gemini and Qwen), in a temp folder, with the same scrubbed environment, for at most
  15 minutes (SIGTERM, then SIGKILL). The request carries a worker id and the command the page showed; any other command is
  refused. The last 40 lines of output (colours stripped, 240 characters each) are kept in memory for the page to poll. One
  install at a time. When the job ends the host looks for the program on `PATH`: the page says "restart DSH" if it is not
  there yet (DSH reads its `PATH` at start).
- The last check and the last install job per worker are kept in memory only. Env read: `DSH_HOME`, `DSH_PROFILE`, `PATH`,
  `PATHEXT`, and the API-key variables above (presence only).

## DSH seams and network

- Host: `webServer.register({kind: 'exact'})` inside `ctx.effect`; `apply` is wrapped in try/catch so a failure never stops
  DSH. Logic lives in `workers-host.mjs` with injected I/O. No `@deepseek-ai/*` import.
- Client: `ctx.inject(['slots'])`, slot `settings.section` (id `kybernos-workers`, order 30), `require('react')`. The
  credentials service (`remote.credentials`, to store an API key) is asked for on its own and is optional: without it the page
  says under which name to add the key instead of offering a field.
- `remote.*`: none declared by the bundle. Same-origin `fetch` only, to its own routes and the two core routes above. The
  logos are inline SVG symbols (no image file, no request). The vendors' own addresses only appear as text or as links to
  their install guides. Whether `claude auth status` or `codex login status` contacts their vendors is not verified.

## Tests

```bash
node packages/kybernos-workers/test-host.mjs     # 180 checks: patch parsing, policy, activation, check scenarios per CLI, routes, install job, real I/O
node packages/kybernos-workers/test-client.mjs   # 51 checks: row status, dots, sentences, language rule, every worker has its logo, every French text has its English
node scripts/test-workers-gui.mjs                # the real client in Chromium against the real routes; exits 0 "SKIPPED" without playwright + react@18
source scripts/sandbox/env.sh && node scripts/check-workers-live.mjs   # the real DSH GUI of a sandbox instance: the page, the checks, the guide (never installs, never saves)
```

The GUI test needs Playwright and React 18 UMD builds: `KB_BENCH_DEPS=/dir/with/node_modules` (and `KB_CHROMIUM=` for the
browser). It checks, among other things, that the status chips, the dots and the actions line up on every row, that
nothing runs before the confirmation, that the key never appears on the page, and the whole demo.

## Known limits

- "Ready" is not a proof of delegation. ZCode can never reach it: its sign-in sits in its own vault.
- The install button exists on macOS and Linux only; on Windows the page shows the command and the vendor's guide. Three of
  the six installs go through npm and need Node.js.
- Plugin routes are served before DSH's own sign-in, so the install route is guarded like the other write routes of this
  bundle: same-origin only (`Origin`/`Referer` on the server's own address), JSON only, a command that must match a constant.
  It does not check DSH's session cookie. What it can run is limited to the six official commands.
- The per-agent presentation (logo, "vendor · account" line, sign-in wording, why Gemini and Qwen take a key) lives in
  `client.js`. An agent added to the host's `WORKERS` shows up on its own with the terminal glyph and without those words
  until the page gets its entries (`LOGO_OF`, `IDENTITY`, the sign-in sentences) and the logo symbol of its own.
- The four home-made connections ship as one Suite module, **Agent connectors** (`packages/dsh-subagent-maison/`). When that
  module is switched off in the Suite (or an install is broken), *Turn on* says so and writes nothing.
- A saved API key only reaches the provider at the next DSH start (DSH reads its environment at launch); the page says so.
- The patch is read line by line, not with a YAML parser; unknown forms are ignored, and a tool line this module did not
  write (or that was edited by hand) is never rewritten.
- Model, permissions and run duration are not settable: DSH's connection packages expose no key for them.
- One lock for the whole host, across profiles. POSTs from a non-loopback host name (LAN address, proxy) get 403.
- Strings are French by default; English for every other language until the Language page translates them.
