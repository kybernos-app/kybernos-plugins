# kybernos-search — Search everywhere

A popup that searches the CONTENT of the chats (not only their titles) and the skills, memories, lessons, creations, automations and
agent teams. The native search of the Workspaces list (a title filter) is not touched.

## What the user sees

- Three ways in: the **⌘K / Ctrl+K** shortcut, the **Search everywhere** row of the menu (kybernos-plugin calls
  `window.__KB_SEARCH__.open()`), and an **icon next to the native search** of the Workspaces header (DSH has no slot there: a DOM
  sweep that matches `[class*="sectionHeader"]` and `[class*="searchButton"]`; if the markup moves the icon is not there and the
  other two remain).
- Scope chips with live counts (Chats, Skills, Memories, Lessons, Creations, Automations, Agent Teams), grouped results with the matching
  passage highlighted, a preview of the matching messages, keyboard first (↑ ↓ ↵ Esc). The scopes are remembered on this computer.
- The first open builds the index of the chats (about ten seconds on 2,000 chats, with a progress line; results appear as they are
  read). After that only the chats whose journal changed are read again.
- Memories (the account's, through `/kybernos-cloud/memory`) and creations (through `/kybernos/state`) are read by the page from routes
  it already uses, so they need an account / the state load and are searched in the page.

## What it reads, and where it keeps it

| Source | Read from | Notes |
|---|---|---|
| Chats | `~/.dsh/sessions/<workspace>/<session>/session.v*.jsonl.zstd` | the person's messages (injected context excluded) and the assistant's text; title = last `session/title`; tool calls and results are NOT read |
| Skills | `~/.dsh/skills/*/SKILL.md` | |
| Lessons | `~/.dsh/kybers/*/memory/lessons.jsonl` | |
| Automations | `~/.dsh/kybernos/tasks.json` | |
| Agent Teams | `~/.dsh/kybers/*/kyber.yml` | |

The extracted text of the chats is kept in `~/.dsh/kybernos/search/chats.v1.json` (mode 0600, a few MB, derived data: delete it and it is
rebuilt). Nothing is sent anywhere and nothing is given to a model. A long token that mixes letters and digits is masked in what a
result shows (it is almost always a key); the chat itself still holds it.

## Host routes

All under `/kybernos-search/`, all behind the host fence (a Host that is not this listener's is refused) and, because the content of the
chats is what a drive-by page would want, `POST` with an Origin from this machine and `application/json`:

`GET status` (counts only) · `POST start` (build or refresh, idempotent, 202) · `POST reindex` (read everything again, 202) ·
`POST query { q, scopes }` (q capped at 200 characters, only known scopes pass).

## Design notes

- No inverted index and no SQLite: the text of 2,100 chats is ~15 M characters (measured), a linear scan answers in 4 to 15 ms, and
  `node:sqlite` is flagged or absent on older Node. Two measured traps: folding a string character by character leaves a rope of one
  node per character (489 MB of heap for 15 M characters; one `replace` gives a flat string, 68 MB), and `zstdDecompressSync` stops at the
  first frame of a journal (the frames are chased by their magic number, like `kybernos-cloud` does).
- Accent- and case-insensitive; every word must be there (in the title or the text); title and phrase count more, newer counts a little.
  French has no stemming: `theme` finds `thème`, a plural may miss.

## Not built in this version

Tool outputs and code as a scope, archived chats, "only this workspace", opening a chat AT the matching message (DSH offers no such
call), opening a memory or a lesson on its own page (there is no verified target: the preview and Copy are offered).

## Tests

`node packages/kybernos-search/test-core.mjs` (extractor, folding, search), `test-host.mjs` (index, incremental refresh, cache, sources,
routes and guards), `test-client.mjs` (contract, pure helpers and, with `KYBERNOS_JSDOM=<path to jsdom/lib/api.js>`, the dialog).
