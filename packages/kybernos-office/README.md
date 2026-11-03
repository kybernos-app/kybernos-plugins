# kybernos-office

Edit the Word documents (`.docx`), Excel workbooks (`.xlsx`), Markdown notes (`.md`) and PDFs (`.pdf`) of your Creations in a light editor, without breaking the file.

These are slices 1 and 2 of the Office editors of [`docs/dev/office-editors-open-save-contract-2026-11-03.md`](../../docs/dev/office-editors-open-save-contract-2026-11-03.md).
PowerPoint (`.pptx`) is not built: it has no light editor (the contract keeps it for the full editor, gated by a licence).

## Where to find it

Creations › open a `.docx`, `.xlsx` or `.pdf`: the viewer draws the file itself, read-only, with **Edit** in the editor's own bar (a file with things the light editor would lose asks first); the pencil in the viewer's bar opens the same editor full size. A Markdown file keeps the viewer's own rendered preview, and the pencil opens its editor. Leaving the viewer over unsaved changes asks first.

In a chat, the right-hand tab: click a `.docx`, `.xlsx`, `.pdf` or `.md` in the workspace file list and it opens in a tab of its own, with the same editor (read-only first, **Edit** to change it). DSH keeps that tab mounted while it lives, so what was typed survives a trip to another tab; closing the tab with unsaved changes cannot be intercepted (the engine has no veto) and loses them. Cards in the chat: the model has a tool of its own, `deliver_files`, to hand over the files it made. DSH draws them as cards under the answer (the same cards its own `present` tool gives, which the `minimal` preset does not carry); a click on a card opens it in that right-hand tab, so a document the chat wrote is read and edited where it appeared. The tool's description asks for new files for each request and not for files earlier chats left in the folder. Other files (`.pptx`, `.html`) open in DSH's own preview.

It is off by default (switch it on in the Suite), and its editors are built on the computer, not shipped:

```bash
node packages/kybernos-office/build-editors.mjs        # writes <DSH home>/kybernos/kybernos-office/editors/ (24 MB, never in git)
```

Without them the pencil opens a card saying the editors are not installed. A prebuilt, hash-pinned download is the open item.

## What it does

1. **Looks before it opens.** The host reads the zip and says what the light editor would lose in *this* file: a chart, a comment, a data-validation rule or a macro in a workbook, a macro in a document, are *losses*, and the person chooses first: open read-only, edit anyway, or cancel. Tracked changes and comments in a document are kept but cannot be accepted or refused in the light editor (a notice). Pictures, fields, pivot tables and the like have not been measured: a notice too (`office-guard.mjs`).
2. **Edits in a sandboxed frame.** The editor frame has no access to the app, a cookie, a storage or the internet (iframe `sandbox="allow-scripts"` plus `Content-Security-Policy: sandbox …; connect-src 'self'`). It shows the bytes of the file and hands back the bytes of what was made, through `postMessage` to the DSH page; it never writes.
3. **Saves without overwriting.** The DSH page posts the bytes with the hash the editor read. If the file changed on disk since (Kaby wrote it, or the person elsewhere), the save is refused (409): reload, or save a copy next to the file (`name (edited).docx`). A save is atomic (temp file + rename) and keeps the file's mode.
4. **Undoes.** The bytes before each save are kept in the plugin's own folder (`<DSH home>/kybernos/kybernos-office/snapshots/`, with the very first version kept once as `orig.bin`), never in the person's folder. *Undo last save* puts them back, and asks first if the file changed since that save.
5. **Unchanged means untouched.** Opening, reading and closing never write; Save is off until the editor says something changed.

### Markdown

Two views of the same file, switched in the frame: **Editor** (headings, lists, task lists, tables, links, pictures by address) and **Text** (the Markdown itself). A YAML front matter, a byte-order mark, the line ends (LF or CRLF) and the final newline are kept as they were, and the Editor view says above itself that it rewrites the whole file in its own style (bullets, spacing). What it cannot hold (HTML, footnotes, reference links, formulas) is a *loss* the guard announces first: the person then reads it as text, edits the text (nothing is rewritten, only what is typed is written), or edits in the Editor anyway. `[[wiki]]` links are a notice, not yet measured. A picture with a relative path shows its description only (the frame has no access to the folder).

### PDF

The viewer reads, searches, fills in forms and annotates (highlights, notes, drawings, text); redaction, opening other files, printing and saving a copy by itself are turned off, and read-only turns the annotation and form tools off too. Nothing leaves the frame (no web font, no stamp library from a network), and the PDF engine runs in the frame itself, not in a worker, because a sandboxed frame has no origin to start one from. A *change* is a step of the viewer's own undo history; after a save any later step counts. A password-protected or digitally signed file is a loss (a save would drop it); forms and attachments are notices (not yet measured).

| Editor | Format | Engine | Licence |
|---|---|---|---|
| `sheet` | `.xlsx` | IronCalc 0.9.1 (WebAssembly) | MIT or Apache-2.0 |
| `doc` | `.docx` | eigenpal docx-editor 2.34 | Apache-2.0 |
| `md` | `.md`, `.markdown` | Tiptap 3.32 with its Markdown extension | MIT |
| `pdf` | `.pdf` | EmbedPDF 2.15 (PDFium, WebAssembly) | MIT |

Versions are pinned in `editors/package.json` and locked, with integrity hashes, in `editors/package-lock.json` (`npm ci --ignore-scripts`). The build also writes `manifest.json` with the sha256 of every file; the host serves nothing that is not in it and re-checks the hash before serving.

## Files

| File | What |
|---|---|
| `office-host.mjs` | The disk side: open, bytes, save, undo, serve, stats. Everything injected, tested on a temporary folder. |
| `office-guard.mjs`, `zip-lite.mjs` | The pure side: the zip reader and what each format would lose. |
| `routes.mjs` | The routes `/kybernos-office/*` with the Host fence, the signed-session write guard and the sandboxed `v/<token>/…` route. |
| `index.js` | Host entry (`apply`), routes taken back when the plugin is switched off; registers `deliver_files` and the observer that writes its cards. |
| `deliver.mjs` | The `deliver_files` tool (pure: the DSH services are handed in) and the `deliverables/presented` record it writes after the call's result. |
| `client.js` | The window (bar, cards, frame), full size or embedded in the viewer (`embed`) or in a right-hand tab (`sidebarRightTabs`, `keepMounted`), and its declaration to the core's `window.__KB_EDITORS__`. |
| `editor-src/` | The four frames (`sheet.jsx`, `doc.jsx`, `md.js`, `pdf.js`) and the envelope they speak (`envelope.js`), built by `build.mjs`; the PDF viewer's own distribution is copied beside its frame as it is. |
| `session-guard.mjs`, `lib-session-test.mjs` | Copies of the same files of `kybernos-maquettes` (the terminal's own session guard); keep them identical. |

## Routes

`GET /kybernos-office/status` (which editors are installed), `GET /stats` (use counters per format: opens, saves, copies, undos, conflicts, refusals), `POST /open {path}`, `POST /save?token&base[&mode=copy]` (body = the bytes), `POST /undo {token, force?}`, `GET /v/<token>/__file` and `GET /v/<token>/<editor>/…` (for the sandboxed frame; the token is its key). Every `POST` needs the signed session cookie on top of a same-origin request.

## What is not done

- `.pptx` and the HTML mockups of a chat (a card opens them in DSH's own preview; the mockup editor works from Creations); the full editor (ONLYOFFICE) pack for review and `.pptx`; text edits inside a PDF's body (the light viewer annotates, it does not rewrite the page).
- Markdown tables are re-aligned by the Editor view, and PDF form filling and signature fields have not been measured with real forms.
- The editors' own menus are in English or the editor's own translation; they follow DSH's language only where the editor supports it (`lang=` is passed). They draw light inside their frame whatever the DSH theme is.
- Spreadsheet changes are saved by IronCalc, which rewrites the whole workbook: what it cannot hold is said by the guard before it opens, and Undo keeps the file as it was.

## Tests

`node test-guard.mjs && node test-disk.mjs && node test-host.mjs && node test-write-guard.mjs && node test-client.mjs && node test-editor-src.mjs && node test-deliver.mjs`, then on the sandbox (`scripts/sandbox/setup.sh && start.sh`, build the editors into its home): `node scripts/check-kybernos-office-live.mjs`.
