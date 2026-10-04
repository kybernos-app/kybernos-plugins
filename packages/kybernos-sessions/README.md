# `@local/kybernos-sessions`

Makes the state of a chat's work visible and safe: what its folder looks like in git and GitHub, isolation of parallel work in
git worktrees, a category icon on every session, and the **Kybernos Settings** block with a model-health alert.

It is part of the **socle** (`socle: true` in `packages/kybernos-hub/catalog.json`): always on.

## What the user sees

- **Pills in the composer dock** (slot `conversation.composer.dock`, id `kybernos-sessions`): `local` (Unsaved / Shared / In
  review / Saved…), `recap` (quick "commit & merge", can the session be closed), `sync` (Up to date / To send / To fetch…), `pr`
  (checks, review, merge through `gh`) and `notes` (memory and lessons this chat wrote). A click opens a card with a plain
  sentence, a dry-run plan, then "Confirm & run".
- **Category icon** before each session title in the list (found through `data-row-key="session:<id>"`). The category is written
  by the naming CLI (`scripts/session-titre.mjs`) or, when absent, guessed from the title by the decision brain.
- **Settings ▸ General ▸ Kybernos Settings** (slot `settings.general.item`, order -30): replay onboarding, *Rename Chat session
  after each recap*, *Study model (brain)*, *Decision Brain*. The bundle also reorders the native Settings navigation into a
  "Kybernos" and a "DSH" group and hides the native Appearance and Font-size rows and the version footer, by position.
- **Model-health alert** when a study model is set: this bundle probes and publishes the verdict (`window.__kybernosHealth` and a `kybernos-health`
  event); `kybernos-models` draws it as a chip on the AI Provider & Models tab bar. "Hide" silences it for 1 h.

## Host routes

Under `/kybernos-sessions/`. Every action route is a **dry run unless the body has `exec: true`**.

| Route | Does |
| --- | --- |
| `GET state?session=<id>&window=<hours>` | `{session:{git, sync, pr, worktrees, etat…}, kybers:[memory]}` |
| `POST isolate` · `reclaim` | create or reuse `<project>/.worktrees/<slug>` on `feature/<slug>`; remove clean ones |
| `POST commit` | add only this chat's files, commit, push (not with `local:true`), merge if in a worktree |
| `POST close-check` · `close` | can the worktree be closed; merge then remove it |
| `POST push` · `fetch` · `sync` · `pr` | `git push` / `fetch` / both; `gh pr create`, or `{action:'merge'}` |
| `GET\|POST settings` · `GET\|POST categories` | the two JSON files below |
| `POST decision` · `GET\|POST brain/health` | classify a request, a category or typed questions · probe every configured model |

## Files, settings, env

- Under `$DSH_HOME` (else `~/.dsh`), read only: `sessions/<project>/<session>/session.v3.jsonl.zstd` (mtime),
  `kybers/<kyber>/memory/{lessons,ledger}.jsonl`, and one key of `.credentials.yaml`.
- Writes `kybernos/settings.json` (`renameAfterRecap`, `brain`, `voiceInput`, `decisionBrain`, `autoRouting`, `autoWhitelist`,
  `autoClassifier`; also read by the core, `kybernos-auto` and the naming CLI) and `kybernos/categories.json`
  (`{sessionId: {cat, titre, ts, auto}}`, 8 categories). In the user's repo: `.worktrees/<slug>/`, a `<slug>.kybernos.json`
  marker and a line in `.git/info/exclude` (local, never committed).
- **Saving settings is a merge, not a replace.** `settings.json` is shared: the core reads `pairingToken`, `gatewayBase` and
  `wsAdminKey` from it and `kybernos-auto` writes its own keys. A save reads what is on disk, overlays the seven keys above and
  keeps every other key as it is; the write is atomic (temp file + rename), keeps the file's permissions (a new file is `0600`)
  and follows a symlinked file. If the file exists but is not a JSON object, or cannot be read, nothing is written: a copy of a
  corrupt file is kept as `settings.json.corrupt-<time>` (at most 5, never two of the same content) and the route answers 500
  with the reason. `kybernos-auto` has the same block (`KB-SETTINGS-FILE-BEGIN … END`); a test keeps the two copies identical.
- Browser `localStorage`: `kybernos.sessions.categories.v1`, `.autocat.v1`, `.commits.v4`, `kb-sante-silence`.
- Env: `DSH_HOME`, `VERCEL_AI_GATEWAY_API_KEY`, `KB_BRAIN_DELAI` (8000 ms), `KB_BRAIN_CONCURRENCE` (4), `KB_BRAIN_TTL` (5 h);
  for `garde.mjs`: `DSH_SESSION_ID`, `KYBERNOS_ISOLATE`.
- CLI tools, not loaded by DSH: `garde.mjs` (agent hook: `--isoler`, `--claim|--release <hot file>`, `--check`,
  `--veille [--install|--uninstall|--etat]`; state in `kybernos/{hot-claims.json,last-good/,veille-bundle.log}`; the permanent
  `--veille` writes a macOS LaunchAgent and puts back the last parsable copy of a hot client file, so never run it while someone
  edits one) and `proof-sync.mjs` (mirrors kyber lessons into `<project>/.kybers/`).

## DSH seams, network

- Host: `webServer` (`ctx.get` or `ctx.inject`), `llm.stream` read lazily. Client: `inject: ['slots']`, the two slots above,
  `ctx.get('remote.settings').describe()` (read-only, `llm-pi-ai` namespace, in try/catch, not in `inject`), DSH's own
  `POST /api/session/list` and `/api/session/page` with the browser cookie, DOM observers. No `remote.*` in `package.json`.
- `git` and `gh` run through `execFile` (15 s / 20 s); push, fetch and PRs go to the repo's `origin`.
- The decision brain posts the session title (or a kyber mission list) to `https://ai-gateway.vercel.sh/v1/evaluate` (model
  `typesafe-ai/jev`); nothing is sent without `VERCEL_AI_GATEWAY_API_KEY` (env, else `.credentials.yaml`) or when `decisionBrain`
  is `none`. The health probe makes one tiny real call per configured model through DSH's `llm`.

## Tests

`node packages/kybernos-sessions/test-reglages.mjs` covers the settings writer (merge, permissions, atomic write, corrupt and
unreadable files, symlink, the HTTP route) and checks that the safe-write block matches the one in `kybernos-auto`.
`node packages/kybernos-sessions/test-origin.mjs` covers the same-origin guard, unit by unit and through every registered route.
Nothing else in this bundle has a test file. `node scripts/test-layout.mjs` checks that the hot-file list of `garde.mjs` points at existing files
and that its LaunchAgent path is right; `node packages/kybernos-sessions/garde.mjs --check` parses every hot client file
(read-only); `node scripts/smoke-gui.mjs --token <token>` calls `/state`, `/settings`, `/categories`, `/brain/health` on a running
`dsh web` (needs `playwright`). The pure functions are exported with injected `run`, `fetchImpl`, `llm`; the settings writer is the only part with a test.

## Known limits

- The `index.js` header and `cordis.patch.yml` still say "read-only / GET only"; nine POST routes run git or gh.
- DSH serves plugin routes before its own auth (core comment; measured on 0.2.0-rc.2). `origineOK` therefore requires an `Origin`
  (or a `Referer`) from this machine on every request that changes state, compared with the socket's real listening address, and
  refuses a foreign origin on reads too; a read without one still passes. It cannot stop a local process that forges an `Origin`:
  only authentication would.
- The health alert is drawn by `kybernos-models` (see `docs/dev/model-health.md`): with that satellite off it never shows.
  Settings reordering assumes 13 native nav buttons.
- The client factory has no top-level try/catch (theme, skills and core do), against `AGENTS.md` rule 2.
- Stale: the header lists an older pill set; comments cite files absent here (`docs/handoff/session-status/`,
  `scripts/build-model-catalog-css.mjs`, `scripts/test-kybernos-sessions-host.mjs`); nothing imports `dsh-css.js`.
