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
  by the naming CLI (`scripts/session-titre.mjs`) or, when absent, guessed from the title. The host asks the **word rules first**
  (`classement-local.mjs`: a cautious keyword classifier on the title, French and English, accents and case ignored, one hit per
  word, a minimum score and a lead over the second category, otherwise nothing) and answers `motif: 'local'` on a clear signal,
  without calling any model. Only when the words say nothing is the **Study model** asked (see below); its answer is kept only if
  it is one of the eight categories (`motif: 'choisi'`), otherwise the row keeps its neutral speech bubble. A row whose title
  changes after an automatic classification is judged again (« Greeting » becomes the real subject).
- **Settings ▸ General ▸ Kybernos Settings** (slot `settings.general.item`, order -30): replay onboarding (its last page is the starter kit: no row of its own), *Name each chat when it ends*,
  *Study model*. The bundle also reorders the native Settings navigation into a
  "Kybernos" and a "DSH" group and hides the native Appearance and Font-size rows and the version footer, by position.
  **Language.** English is the base of every text; the block has a French twin (`Réglages Kybernos`, `Premiers pas`,
  `Nommer chaque conversation à sa fin`, `Modèle d’étude`; the French speaks « tu »). One pair helper
  `kt(fr, en)` says which: French for `window.__KB_LANG_RESOLVE__()` = `kybernos` or an `fr*` tag, **English for every other
  language**, and English when the resolver throws or is absent; a translated language (es, ar…) is looked up by the French text
  in the dictionary the language layer serves. The same helper words the category icons (aria-label and tooltip) and the
  refusals of the settings route (by their `code`, see below). The composer pills are English only.
- **The Study model** is the one brain setting (`brain`). Its select reads **Automatic — <model>** (the default, the empty
  value), *Choose another…* (your configured models) or **None** (`none`). Automatic picks, in this order: the model of the
  connected Kybernos Cloud; else the cheapest connected model that answers (a provider whose key is set and that the last health
  probe did not see failing; « cheap » is read from the model name, the profile carries no price); else the smallest local Ollama
  model (`etude-auto.mjs`). It reports on the other models (the alert below), answers the closed questions (which agent team runs a
  request, which category a chat gets) and judges the unclear cases of the Memory tidy-up. The old *Decision Brain* setting
  (`decisionBrain`, the gateway's evaluation model) is gone: an old page that still posts the key is not refused, the key is
  ignored and leaves `settings.json` at the next write.
- **Model-health alert** while a Study model is in force (Automatic included): this bundle probes and publishes the verdict
  (`window.__kybernosHealth` and a `kybernos-health` event); `kybernos-models` draws it as a chip on the AI provider and models tab
  bar. "Hide" silences it for 1 h. With the Study model on None, nothing is probed; on Automatic the probe watches the models whose
  provider is connected (a key is set), so an unused provider of the profile does not make noise; with a model you picked, it
  watches every model of your list.

## Host routes

Under `/kybernos-sessions/`. Every action route is a **dry run unless the body has `exec: true`**.

| Route | Does |
| --- | --- |
| `GET state?session=<id>&window=<hours>` | `{session:{git, sync, pr, worktrees, etat…}, kybers:[memory]}` |
| `POST isolate` · `reclaim` | create or reuse `<project>/.worktrees/<slug>` on `feature/<slug>`; remove clean ones |
| `POST commit` | add only this chat's files, commit, merge if in a worktree; **sends to GitHub only with `push:true`** (a bare POST stays local; the page's « Save my work » and « Add to project » say it, after the dry run shows the `git push`) |
| `POST close-check` · `close` | can the worktree be closed; merge then remove it |
| `POST push` · `fetch` · `sync` · `pr` | `git push` / `fetch` / both; `gh pr create`, or `{action:'merge'}` |
| `GET\|POST settings` · `GET\|POST categories` | the two JSON files below |
| `POST decision` · `GET\|POST brain/health` | the closed questions (`{categorie}` or `{kybers, demande}`) · probe every configured model |

`close` and `close-check` also take `forceIgnores: true` (accept that closing destroys ignored entries that cannot be regenerated).

### Replies and their codes

Every reply of the git routes (`isolate`, `reclaim`, `commit`, `close-check`, `close`, `push`, `fetch`, `sync`, `pr`) keeps its JSON
shape (`ok`, `erreur` on a refusal, `message` and `note` on success…) and carries a stable **`code`** (kebab-case). The sentences
(`erreur`, `message`, `note`, `raison`) are plain **English**; what git or gh said itself rides apart, untranslated, in **`detail`**
(a number in `count`, a branch in `base`, ignored entries in `entries`). A dry run answers `{ ok: true, dry: true, commandes }` and has
no code. The table of codes and sentences is `GIT_TEXTS` in `index.js`: `sent`, `nothing-to-send`, `not-a-repo`, `no-remote`,
`nothing-to-save`, `already-saved`, `saved-sent`, `saved-local`, `push-refused`, `merge-refused`, `git-refused`, `tree-dirty`,
`ignored-entries`, `copy-created`, `copy-reused`, `pr-opened`, `pr-merged`… (44 in all). A client words the reply from its code, in
its own language, and shows the host's English sentence for a code it does not know: `kybernos-changes` has an [fr, en] sentence for
every code (its test reads `GIT_TEXTS` and fails when the two lists drift). A new code is added in both places.

The settings route refuses with `invalid-brain`, `invalid-voice-input`, `invalid-auto-whitelist` (400), `settings-corrupt`,
`settings-unreadable` or `settings-not-written` (500); the Kybernos Settings block words them itself. `POST categories` refuses with
`empty-session` or `unknown-category`. The plain-text bodies of a wrong method or origin are `POST only`, `GET only`,
`GET or POST only` and `origin refused`; a missing or wrong session answers JSON `{ ok: false, error }` (401 `sign-in required`, 403 `refused_on_phone`).

## Files, settings, env

- Under `$DSH_HOME` (else `~/.dsh`), read only: `sessions/<project>/<session>/session.v3.jsonl.zstd` (mtime) and
  `kybers/<kyber>/memory/{lessons,ledger}.jsonl`.
- Writes `kybernos/settings.json` (`renameAfterRecap`, `brain` — `route/id`, `none` or empty —, `voiceInput`, `autoRouting`,
  `autoWhitelist`, `autoClassifier`; also read by the core, `kybernos-auto`, `kybernos-memory` and the naming CLI) and `kybernos/categories.json`
  (`{sessionId: {cat, titre, ts, auto}}`, 8 categories). In the user's repo: `.worktrees/<slug>/`, a `<slug>.kybernos.json`
  marker and a line in `.git/info/exclude` (local, never committed).
- **Saving settings is a merge, not a replace.** `settings.json` is shared: the core reads `pairingToken`, `gatewayBase` and
  `wsAdminKey` from it and `kybernos-auto` writes its own keys. A save reads what is on disk, overlays the six keys above and
  keeps every other key as it is (the retired `decisionBrain` is the one key it drops); the write is atomic (temp file + rename), keeps the file's permissions (a new file is `0600`)
  and follows a symlinked file. If the file exists but is not a JSON object, or cannot be read, nothing is written: a copy of a
  corrupt file is kept as `settings.json.corrupt-<time>` (at most 5, never two of the same content) and the route answers 500
  with the reason. `kybernos-auto` has the same block (`KB-SETTINGS-FILE-BEGIN … END`); a test keeps the two copies identical.
- Browser `localStorage`: `kybernos.sessions.categories.v1`, `.autocat.v1`, `.commits.v4`, `kb-sante-silence`.
- Env: `DSH_HOME`, `KB_BRAIN_DELAI` (8000 ms), `KB_BRAIN_CONCURRENCE` (4), `KB_BRAIN_TTL` (5 h), `KB_DECISION_DELAI` (8000 ms, one
  closed question);
  for `garde.mjs`: `DSH_SESSION_ID`, `KYBERNOS_ISOLATE`.
- CLI tools, not loaded by DSH: `garde.mjs` (agent hook: `--isoler`, `--claim|--release <hot file>`, `--check`,
  `--veille [--install|--uninstall|--etat]`; state in `kybernos/{hot-claims.json,last-good/,veille-bundle.log}`; the permanent
  `--veille` writes a macOS LaunchAgent and puts back the last parsable copy of a hot client file, so never run it while someone
  edits one) and `proof-sync.mjs` (mirrors agent team lessons into `<project>/.kybers/`).

## DSH seams, network

- Host: `webServer` (`ctx.get` or `ctx.inject`), `llm.stream` read lazily. Client: `inject: ['slots']`, the two slots above,
  `ctx.get('remote.settings').describe()` (read-only, `llm-pi-ai` namespace, in try/catch, not in `inject`), DSH's own
  `POST /api/session/list` and `/api/session/page` with the browser cookie, DOM observers. No `remote.*` in `package.json`.
- `git` and `gh` run through `execFile` (15 s / 20 s); push, fetch and PRs go to the repo's `origin`.
- The closed questions go through DSH's `llm` service, to the Study model, with no tools, an 8 s timeout and one retry on the
  lower-cased model id (as the Memory tidy-up does). What is sent: the chat title (or an agent team mission list and the
  request), quoted as data in the prompt; the answer counts only if it is an id of the closed list. A title is sent only when the
  word rules cannot place it, never when the Study model is `none`, and nowhere beyond the machine when the Study model is local.
  After a failure the model rests 5 minutes; one answer is kept per title. Nothing calls the gateway's evaluation API or reads
  a gateway key any more. The automatic choice reads the `settings` and `credentials` services (only whether a key
  exists, never its value), and the bundle publishes it as `globalThis[Symbol.for('kybernos.studyModel')]` (a function giving
  `route/id` or `''`) for the bundles that cannot import it (Memory). The health probe makes one tiny real call per configured
  model through DSH's `llm`.

## Tests

`node packages/kybernos-sessions/test-reglages.mjs` covers the settings writer (merge, permissions, atomic write, corrupt and
unreadable files, symlink, the HTTP route) and checks that the safe-write block matches the one in `kybernos-auto`.
`node packages/kybernos-sessions/test-origin.mjs` covers the same-origin guard, unit by unit and through every registered route.
`node packages/kybernos-sessions/test-classement-local.mjs` covers the local classifier (real titles, what it refuses to guess,
how words are matched, reachability of every category) and the decision route: the words first, the Study model only when they
say nothing, the caches and the rest after a failure, and that nothing goes through the network.
`node packages/kybernos-sessions/test-decision-llm.mjs` drives the closed-question engine with a stub `llm` (an id of the list or
nothing, the timeout, the retry, the text quoted as data). `node packages/kybernos-sessions/test-etude-auto.mjs` covers the
automatic Study model (the order, what is skipped, reading the host's services, the settings answer, the health switch).
`node packages/kybernos-sessions/test-codes.mjs` drives every git route with a fake git and a fake gh: each reply's code, its English
sentence, the `detail` apart, the plurals, and that the table `GIT_TEXTS` has no dead entry. `node packages/kybernos-sessions/test-language.mjs`
renders the Kybernos Settings block in French, English and a translated language, and checks the pair helper, the words of the
category icons and of the settings refusals, and that the « General » tab is renamed in French only.
`node packages/kybernos-sessions/test-panels-language.mjs` renders the Memory & Lessons card (both tabs, the empty states, the capture status, the
ledger, the singular and plural forms) and the action card (« Confirm & run », « Copy as text », « Details », « Close ») in French, English and a language
with no table of ours, and checks that « Open Memory & Lessons » looks the Settings page up under the same words the memory plugin gives it.
`test-sante.mjs`, `test-dsh-home.mjs`, `test-changes-facts.mjs`, `test-journal.mjs`, `test-prefix.mjs` and `test-wording.mjs`
cover the health bus and the Study model row, `$DSH_HOME`, and small pure parts of the page. `node scripts/test-layout.mjs` checks that the hot-file list of `garde.mjs` points at existing files
and that its LaunchAgent path is right; `node packages/kybernos-sessions/garde.mjs --check` parses every hot client file
(read-only); `node scripts/smoke-gui.mjs --token <token>` calls `/state`, `/settings`, `/categories`, `/brain/health` on a running
`dsh web` (needs `playwright`). The pure functions are exported with injected `run`, `llm`, settings and credentials services.

## Known limits

- DSH serves plugin routes before its own auth (core comment; measured on 0.2.0-rc.2). `origineOK` therefore requires an `Origin`
  (or a `Referer`) from this machine on every request that changes state, compared with the socket's real listening address, and
  refuses a foreign origin on reads too; a read without one still passes. An `Origin` alone is forgeable by any local process, so every POST also needs
  **DSH's signed session cookie** (`session-guard.mjs`, `test-write-guard.mjs`, L3-18): 401 without it, 403 `refused_on_phone` through the phone link. The callers are pages and
  `scripts/dsh-relance.mjs` (which signs its own cookie for `POST categories`). `GET state` is still a read behind the Host fence.
- The health alert is drawn by `kybernos-models` (see `docs/dev/model-health.md`): with that satellite off it never shows.
  Settings reordering assumes 13 native nav buttons.
- The client factory has no top-level try/catch (theme, skills and core do), against `AGENTS.md` rule 2.
- Stale: the header lists an older pill set; comments cite files absent here (`docs/handoff/session-status/`,
  `scripts/test-kybernos-sessions-host.mjs`). `dsh-css.js` is a frozen extract of the DSH controls CSS (its generator is gone, the
  same CSS is inlined in `client.js`); only `scripts/check-dashboards-render.mjs` imports it.
- Much of the code (names, many comments in `client.js`) is still French in places; the texts a person reads are English with a
  French twin where listed above.
