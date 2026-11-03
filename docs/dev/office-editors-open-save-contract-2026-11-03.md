> Status 2026-11-03: Proposal, nothing built. Follows [office-stack-free-options-2026-11-02.md](office-stack-free-options-2026-11-02.md) and the spikes run on 2026-11-03. Owner idea behind it: a light editor by default, the ONLYOFFICE pack as an optional, heavier alternative.

# One open/save contract for light and full editors

The content-management plugin edits slides, sheets, documents, PDF and Markdown. A light editor is the default where one exists; the ONLYOFFICE pack is the full editor the person can choose. That only works if swapping them cannot damage a file. This page fixes the rules that make the swap safe, from what the 2026-11-03 spikes measured.

The measurements come from files made by scripts (OfficeCLI, a formula generator, a hand-written Markdown file). No real file of the owner was run through any editor, so every "keeps" below is "keeps on these fixtures".

## What the light editors really do

| Format | Light editor (licence, weight) | Keeps on round trip | Changes | Loses or cannot | Not tested |
|---|---|---|---|---|---|
| Sheet | IronCalc 0.9.1 (MIT or Apache-2.0, 3.4 MB) | 48 of 48 formulas incl. `LET`, values, number formats, styles, merges, frozen panes, column widths, hyperlink, data bar, defined name | nothing seen | **chart, data validation, comments**, tab colour; fails to open a comment link written as an absolute part path (OfficeCLI does, Excel does not) | images, Excel tables, autofilter, pivots, real Excel files |
| Document | eigenpal docx-editor 2.34 (core, react, fonts Apache-2.0; 5.4 MB JS + 0.4 MB layout wasm + fonts on demand) | every package part, tracked changes and comments (stored, not shown), footnote, table, headings, text | `'` written as `&apos;` | **review is Pro**: accept, reject and comment are disabled; print and PDF export are Pro; 23 pages with the packaged fonts, 26 without | images, TOC, fields, headers, equations, real Word files |
| PDF | EmbedPDF 2.15.1 (MIT, 6.5 MB, no external call) | page text, highlight annotation | file re-written (50 KB for a 46 KB source) | cannot rewrite body text; a redaction is irreversible once saved (the secret was gone from text and raw streams) | forms, signature, OCR, encrypted files, pdf.js |
| Markdown | Tiptap 3.32 + Markdown extension (MIT, 0.5 MB) | headings, emphasis, nested, ordered and task lists, quote, fenced code, link, image, rule, hard break | tables re-aligned, `*` `_` `<` escaped, a soft line break becomes a hard one, blank lines | **HTML comments** (and, by design, raw HTML, footnotes, reference links, math); **YAML front matter becomes a heading** unless split off first | raw HTML blocks, footnotes in practice |
| Slides | Own HTML deck with Tiptap text editing (one offline file, 713 KB) | everything, it is its own format | none | no pptx import or export | Safari, Firefox, touch |
| All | ONLYOFFICE pack (reference) | the OOXML structure of a 20-slide deck, notes, master, theme, media, chart values | re-serialised (68 KB to 18 KB), style ids renamed | `LET`; first open 15 s | real PowerPoint, Keynote, Google Slides |

Two lessons run through the table. Every editor re-writes the file it saves, so "open, save" is never free. And each one has a short, known list of what it drops; none of them says so by itself.

## The contract

1. **The file on disk is the truth.** An editor holds a working copy and returns bytes; the host writes the file. No editor owns the only copy.
2. **Unchanged means untouched.** If the person made no edit, save returns the original bytes, not a re-serialisation. (A pack round trip shrank a deck from 68 KB to 18 KB; Tiptap rewrote tables and escapes.) Each adapter exposes `dirty` for this.
3. **Refuse, do not drop.** Before a light editor opens a file, the host runs that adapter's guard (below). If the file holds anything on the adapter's loss list, the person chooses, per file: open in the full editor (default for destructive loss), open read-only in the light editor, or open in the light editor and accept the loss, named in the dialog ("this file has a chart; this editor would remove it"). The choice is never silent and never per format.
4. **One message envelope.** Light and full editors both sit behind the same adapter, so a swap changes the adapter, not the host.
   - Host to editor: `editor:open` (`name`, `format`, `bytes`, `readOnly`), `editor:save` (ask for bytes), `editor:close`.
   - Editor to host: `editor:ready`, `editor:opened` (pages, sheets or slides count, load time), `editor:changed` (sets `dirty`), `editor:saved` (`bytes`), `editor:error` (`code`, `message`).
   - The pack's own names (`document:open-buffer`, `document:opened`, `document:save`) map one to one; light editors that run in the page need no iframe but use the same calls.
5. **Agent and person together.** The adapter keeps the hash of the bytes it opened. When the agent has written the file since, a save is a conflict, not an overwrite: the person picks reload (drop the editor changes), save as a copy, or merge by text. Agent edits address elements by stable id or name, never by position, because a person inserting a slide shifts positions (measured in the loop spike).
6. **Save is atomic and undoable.** Write to a temporary file and rename it; keep the previous bytes as a snapshot until the next agent write or the end of the session, so one click restores the file as it was before the save.
7. **Everything heavy loads on demand, nothing in git.** Fonts, wasm and bundles are fetched with a pinned hash (AGENTS.md rule 4; the core client is already near its size budget). A failed load never blocks DSH from starting (rule 2): the host falls to the other tier, or to a read-only preview, and says so.

## Which editor opens what

Setting: `editors.<format>` = `light` or `full`, default `light` where a light tier exists.

| Format | Light tier | Full tier | Force the full tier when |
|---|---|---|---|
| xlsx | IronCalc | ONLYOFFICE | chart, data validation, comment, image, table, pivot present; file refused by the reader |
| docx | eigenpal | ONLYOFFICE | task is review (accept, reject, comment) or the file has tracked changes or comments to act on |
| pdf | EmbedPDF | ONLYOFFICE (text edits, evaluated, not tested) | the person wants to rewrite body text; encrypted file |
| md | Tiptap, or the raw text view | none needed | the guard finds HTML, footnotes, reference links, math (then raw text view) |
| pptx | none | ONLYOFFICE | always; an HTML deck is a different file type, created as such |
| html deck | own editor | none | never |

## The guard, per format

What `inspect(bytes)` looks for before a light open:

- **xlsx:** parts `xl/charts/*`, `xl/drawings/*`, `xl/comments*`, `xl/threadedComments/*`, `xl/pivotTables/*`, `xl/tables/*`, a `dataValidation` element in any sheet, images in `xl/media/*`.
- **docx:** `w:ins`, `w:del`, `w:moveFrom` and `w:moveTo` (tracked changes), `word/comments.xml`, `w:sdt` (content controls), `w:fldSimple` and complex fields, `word/media/*`, footnote and endnote parts, equations.
- **pdf:** `/Encrypt`, `/AcroForm`, signature fields, an embedded file.
- **md:** comment `<!--`, any HTML tag, `[^x]:` footnotes, `[x]: url` references, `$$` blocks, `[[wiki]]` links. Front matter is not a loss: the editor sets it aside and puts it back.
- **pptx:** always routed to the full tier, so no scan.

The guard errs towards flagging. A false alarm costs a click; a silent loss costs a file.

## The gate that goes with it

The skills-versus-plugins rule applies (`docs/dev/skills-vs-plugins.md`): nothing enters without an executable test and a use counter.

- **Fixtures are generated by script, not stored** (OfficeCLI, a formula generator, a Markdown writer, a small PDF writer), so no binary lands in git.
- **Per adapter, one contract test:** (a) open then save unchanged returns identical bytes; (b) edit one value, save, and an independent reader (OfficeCLI validate, a zip and XML reader, PDFKit or pdf.js) finds every part and value that is not on the loss list; (c) the guard flags every loss-list feature present in the rich fixture (chart, validation and comment in the sheet; tracked changes and comments in the document; the HTML comment in the Markdown); (d) a load that fails falls back instead of throwing; (e) a file changed under the editor yields the conflict, not an overwrite.
- **A use counter per tier and per format:** opens, saves, guard refusals, and fallbacks, so the default can be revisited with numbers.

## Build order

This slots into the steps of the free-options study; it adds a thin host first so each tier arrives behind the same contract.

| Step | Work | Size | Gate |
|---|---|---|---|
| A | Adapter interface, envelope, guard runner, conflict and snapshot rules, with a fake editor | S | contract tests pass on the fake |
| B | Markdown and PDF light adapters (smallest, already measured) | S | contract test per adapter |
| C | Sheet adapter (IronCalc) with the xlsx guard | S to M | rich fixture refused or warned, 48 formulas green |
| D | Document adapter (eigenpal) with the docx guard; review routed to the full tier | S to M | review fixture routed to full |
| E | Full tier through the same adapter (the pack host of step 2 in the study) | M to L | legal gate before default install |
| F | Slides: HTML deck as its own format; pptx in the pack only | M | real PowerPoint and Keynote open of a pack-saved deck |

## Still open, none of it settled by the spikes

- A real PowerPoint, Keynote or Google Slides open of a deck saved by the pack (the owner's own check).
- Ascensio's written answers on the licence terms; this page does not change that gate.
- Real Excel and Word files from the owner through IronCalc and eigenpal; the loss lists above are what the fixtures showed.
- Whether the comment-link failure in IronCalc is worth reporting upstream, and whether OfficeCLI should write relative targets.
- Where the tiers are hosted for a cloud computer: once, shared, not per computer (the pack is 510 MB).
- EmbedPDF interface traps seen by hand: a leftover annotation tool across tabs, and the page shifting when the redaction panel opens.
