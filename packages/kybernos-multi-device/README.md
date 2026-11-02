# kybernos-multi-device

Workspaces with or without a folder. A DSH workspace is a directory, so "no folder" cannot mean "no path": this bundle
creates a private folder for the person under `<Documents>/Kybernos/<name>` and hands its path to DSH, which then
registers a workspace as usual. No engine patch, nothing is copied anywhere.

It is a satellite: switch it off in the Suite and Create goes back to DSH's native folder chooser.

## What the user sees

- **One dialog, three entrances.** "No folder" (a private folder is created, shown in the Finder) or "A folder of my
  computer" (the native chooser, the workspace takes the folder's name). It opens from the **Create** button of the
  Workspaces page, from the sidebar **+**, and from the empty-chat workspace picker.
- **Details tab of a workspace.** A *Working folder* card (private folder, or the path; the folder is fixed at creation:
  another folder means another workspace), and a folded **Advanced** block.
- **Advanced.** What exists today for the phone (a live window on the computer, not a copy; every workspace; the computer
  must be on; no queue), then two greyed cards that preview the next versions: *Execution* (this computer, E2B sandbox,
  Kybernos hosted) and *Devices* (which device sees a workspace, and may send). Nothing in them changes anything.

## How it works

| Piece | Where | Notes |
|---|---|---|
| `POST /kybernos-multi-device/private-folder` `{ name }` | `multi-device-host.mjs` | Takes a NAME, never a path. Refuses `/ \ : * ? " < > \|`, control characters, leading or trailing dots, Windows reserved names, more than 80 characters. Creates `<Documents>/Kybernos` then the leaf **without** `recursive`: an existing folder is a 409, never reused. Same-origin strict + Host fence. |
| `GET /kybernos-multi-device/status` | same | `{ root, rootDisplay }`: lets the page tell a private folder from another one. |
| `directoryFlow` slots, priority -1 | `client.js` | `conversation.hero.workspace.directoryFlow` and `sidebar.workspaces.directoryFlow` are `single` slots: a lower number renders first. If this component throws, the slot retires it and DSH's native occupant takes over. |
| `globalThis[Symbol.for('kybernos.multiDevice')]` | `client.js` | `choose()` → a path or `null`; `detailsExtras({ part, path })` → the cards. The core bundle (`kybernos-plugin`) reads it and falls back to its old behaviour when it is absent or fails. |

Documents is `~/Documents`, or the answer of `xdg-user-dir DOCUMENTS` on Linux (ignored when it is `$HOME`). The
environment variable `KYBERNOS_DOCUMENTS_DIR` overrides it (tests, the sandbox).

## What it stores

Nothing of its own in v1. The private folders are ordinary folders in Documents; deleting a workspace in DSH keeps them.

## What it does not do (on purpose)

- Link or unlink a folder after the fact: the engine fixes a conversation's folder at its creation.
- Choose where commands run, or which device sees a workspace: previews only.

## Tests

```bash
cd packages/kybernos-multi-device && for t in test*.mjs; do node "$t" || exit 1; done
node scripts/test-route-hosts.mjs && node scripts/test-trusted-guards.mjs
```
