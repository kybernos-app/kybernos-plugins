# `@local/kybernos-changes`

One chip under the composer that says where this chat's work stands, in plain words, and what to do next:

> **changed → saved → on GitHub → in the project**

A **Simple / Developer** switch in its card adds the branch, the gap with GitHub and the exact git commands. While the
bundle is active it replaces the four git pills of `@local/kybernos-sessions` (local, recap, GitHub, review) — Memory &
Lessons stays — and says the same thing they do, because it reads the **same facts** and runs the **same actions**.
It has no host half of its own (`index.js` is an empty `apply()`).

## What the user sees

- A chip with a coloured dot and a sentence: « 2 files to save », « Saved · not online », « Waiting for review »,
  « Everything is saved »… Green = nothing to do, amber = something is waiting on you, blue = informative, red = blocked.
- Click it: a card with a title and a sentence, a four-step line (changed · saved · on GitHub · in the project) showing
  the current step, the changed files (kind: modified / new / deleted / renamed / conflict, and « other chat » when a file
  belongs to another chat working in the same folder), **one main button** for the next step, and quiet buttons for the
  others (e.g. « Save on this computer only »).
- A button never acts at once. It asks the host for the plan first (a dry run), then shows « Before going on » with a
  one-line message field for a save, and acts only on confirm. A refusal shows the host's reason and offers nothing.
- **Simple** (default) uses no git word on a button. **Developer** adds the git word beside each label (`commit + push`,
  `pull request`, `worktree`…), the exact commands of the plan before « Confirm and run », and the branch, the gap
  (`↑ to send ↓ to fetch`), the folder, the isolated copy, the remote and the last check.
- French and English. French is the source; a translated language is looked up by its French text and falls back to English.
- A folder that is not a git project shows nothing.

## Where the facts and the actions come from

Nothing here talks to git or GitHub.

| What | From |
| --- | --- |
| Facts (unsaved files of this chat, ahead/behind, copy not in the project, review request, conflicts, files with their kind) | `window.__KB_SESSIONS_VIEW__.read(sessionId)`, published by the sessions client (`faitsChangements`), built from the same views as the pills: `vueLocal`, `vueSync`, `vuePr`, and the chat's own journal for « which files are this chat's » |
| Actions, by role: `save`, `saveLocal`, `addToProject`, `push`, `fetch`, `sync`, `askReview`, `merge`, `isolate`, `closeCopy` | the same descriptors `PlanAction` receives (`url`, `body`) → `POST /kybernos-sessions/{commit,push,fetch,sync,pr,isolate,close}`, which keep their own origin guard and dry run |
| Kind of each changed file | `fichiers` in `GET /kybernos-sessions/state` (additive: `git status --porcelain` codes). A DSH that was not restarted since the update sends none: the files are listed without their kind |

If the seam is missing (an older sessions bundle) or the state route is silent, **this bundle shows nothing and the four
pills stay**. The pills only step aside once the chip is on screen (`window.__KB_CHANGES_ACTIVE__` and the
`kybernos-changes-active` event).

## Files and settings

- Browser `localStorage`: `kybernos.changes.mode` (`simple` | `dev`). Nothing is written on the disk or sent anywhere.
- No `remote.*`, no provider, no network except the same-origin routes above.

## DSH seams

- Client `inject: ['slots']`; slot `conversation.composer.dock`, order 4 (the sessions pills are order 5). CSS prefix `kbch-`
  (checked against every other bundle by the test: the prefix is shared by all bundles and a class defined twice is
  styled twice).

## Tests

```bash
node packages/kybernos-changes/test-client.mjs           # the states in priority order, the words in both languages, the contract
node packages/kybernos-sessions/test-changes-facts.mjs   # the facts and the actions the chip reads, kinds of change
node scripts/sandbox-instance.mjs setup && node scripts/sandbox-instance.mjs start    # a second DSH that loads this checkout
KB_HOST=127.0.0.1:3091 DSH_HOME=<sandbox>/.dsh HOME=<sandbox> node scripts/check-changes-live.mjs --shots /tmp/shots
```

`check-changes-live.mjs` needs a DSH that loads the bundle (the user's own `dsh web` does not list it) and refuses to run
against `:3080`. It reads this chat's real state through the real host code, then drives every state of the chip through
the seam; **every POST of the sessions routes is answered by the check itself** (fail-closed), so no git command ever runs.
See `docs/dev/live-testing.md`.

## Known limits

- The chip is as good as the facts of the sessions client: « the files of this chat » comes from the chat's journal, so a
  chat whose journal cannot be read shows the folder's count and no « other chat » tag.
- « Undo these changes » is not offered: it would destroy work and needs its own host route with its own guards.
- Phase 2, not done: move the git code out of `kybernos-sessions` and delete the four pills. Until then, switching the
  bundle off brings them back.
