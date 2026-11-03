# kybernos-maquettes

The « Maquettes » page: open the HTML screens Kaby drew for you (or you drew) and change them by clicking on the page. Text, colours, sizes, spacing, blocks,
pictures. **The file is patched in place and only what you touch changes**: every other byte of the page stays as it was, so a maquette Kaby wrote can be edited by
hand and by Kaby in turn without either undoing the other.

Optional (a satellite, off by default). Design decision and the other editors it sits beside: `docs/dev/office-editors-open-save-contract-2026-11-03.md`; what it
may hold in the catalogue: `docs/dev/skills-vs-plugins.md` (an executable test, a use counter).

## Using it

1. **Creations › Mockups** (or the « Mockups » row of the menu while Creations is not there). Type the full path of the folder of a maquette (`~/Documents/my-mockup`)
   and click **Add**. The folder must hold at least one `.html` page at its top level; it cannot be your home folder or the whole disk.
2. **Open**. The page appears in a frame; click **Edit** on the page (top right). Click a text to write over it, a block to move, copy, restyle or delete it;
   **Insert** adds one of 15 blocks (headings, cards, buttons, forms, a gallery…) or a picture from your computer. A change waits in the list until **Save**.
3. **Save** writes the file. **Undo** puts the page back as it was before the last save; **Reset** puts the original back (the first state the editor saw).
   Text a script of the page builds itself cannot be changed by hand: the editor offers to write the request for Kaby (it opens a chat with the message written;
   it is never sent for you).

Several pages in the folder show as tabs; links between the pages keep the editor.

## How it holds together

| File | Role |
|---|---|
| `maquette-lib.mjs` | The patch rules, pure (no disk, no clock). The page is parsed with parse5 keeping every node's position in the source, the stylesheet with postcss; a change is a splice at those positions. Text, style, rule, attribute, structure (move, copy, delete, insert), script-literal text. Anything it cannot place exactly is **refused**, never approximated. |
| `maquette-host.mjs` | The disk: the registry of folders, the tokens, numbering a served copy, applying a patch (hash check, snapshot, temp file + rename, rollback), undo, reset, pictures. |
| `routes.mjs` | The routes under `/kybernos-maquettes`; `session-guard.mjs` is the terminal's guard, copied (`test-session-guard.mjs` keeps the copies identical). |
| `editor/ky-edit.js` | The editor, injected by the host into each served page. |
| `client.js` | The DSH page: the folders, the frame, the bridge. |
| `vendor/` | parse5 and postcss as single ES modules, with licences and the rebuild recipe (`NOTICES.md`). |

### Safety

- The page of a maquette is untrusted code. It runs in an `<iframe sandbox>` **without `allow-same-origin`** and the host adds `Content-Security-Policy: sandbox`:
  it has no cookie, no storage, no way into DSH. The address of a page holds an unguessable token (128 random bits, kept in memory, minted by `POST /open`).
- The editor reaches the host only by `postMessage` to the DSH page, which forwards a short allowlist of calls (`hash`, `find`, `apply`, `undo`, `reset`,
  `unupload`, `blocks`, plus `upload` and the pending-changes store) with the session cookie and **its own token**. Only the iframe it opened is answered.
- DSH serves plugin routes before its own login, so every route that writes takes a strict same-origin request **and** the signed session cookie
  (`docs/dev/route-origin-rule.md`); the reads and the file view keep the Host fence.
- Nothing is written outside the folder you registered: the host resolves every name, refuses `..`, absolute paths and links that leave the folder, and refuses a
  file that changed since the editor opened it (`409 stale`) instead of overwriting it.

### What it stores, and where

- The folders you registered: `<DSH home>/kybernos/kybernos-maquettes/folders.json`.
- Snapshots for Undo/Reset: `<DSH home>/kybernos/kybernos-maquettes/snapshots/<id>/` (not in your folder). Undo and Reset refuse if the files changed since the last save
  of the editor (you or Kaby edited them meanwhile), unless Reset is confirmed.
- Pictures you add: `<your folder>/img/` (or next to the page, see `maquette-host.mjs`), named by the hash of their bytes; a picture a saved page no longer uses is removed.
- A use counter (folders added, saves, undos…) next to the registry, for the catalogue rule.

### Limits

- The scripts of a maquette get an in-memory `localStorage`/`sessionStorage` (the sandbox has none): they work, nothing is kept after a reload.
- `fetch()` of a local file from a maquette works (the view answers with `Access-Control-Allow-Origin: *`, behind the token); the network is the page's own business.
- Only the top-level `.html` pages of a folder are edited; deeper pages are served as they are.
- There is no folder picker: the full path is typed.
- A few messages from the host (a refusal's reason) are English in every language.

## Tests

```bash
cd packages/kybernos-maquettes && npm test
```

`test-lib.mjs` (114 checks of the patch rules), `test-disk.mjs` (the disk: tokens, apply, rollback, undo, pictures), `test-host.mjs` (the routes over a real HTTP
listener), `test-write-guard.mjs` (every write refused without the signed session), `test-editor.mjs` (the editor script: no way out but the bridge, the French of every
sentence), `test-client.mjs` (the DSH page, the bridge, the sandbox). The page in a real browser: `node scripts/check-kybernos-maquettes-live.mjs` against the sandbox
(`docs/dev/live-testing.md`).
