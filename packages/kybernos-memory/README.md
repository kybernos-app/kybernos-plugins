# kybernos-memory — Memory & Lessons learned

The **Memory & Lessons learned** feature: the settings page (browser half, `client.js`) and the
lessons (host half, `index.js`). The account memory itself stays in
[`kybernos-cloud`](../kybernos-cloud/README.md) — it needs the account token, lessons do not — and the
page reaches it through that plugin's routes; the account token never leaves the host.

## The page

Settings → **Memory & Lessons** (right after Language). It opens straight on the data; the switches live
one click away.

- **Memories** (account): list, search by words, filters (Show: all / pinned / sent to the model ·
  Source: auto-capture / agent / you / sync · Added: last minute / hour / today / 7 days), pages of 25,
  50 or 100, add, edit (text, retention, pinned) and forget with an Undo.
- **Lessons learned** (every kyber, local files): list, filters (kyber, used at least once, added),
  pages, edit (text, tags) and delete — a deleted lesson goes to the kyber's `lessons.archive.jsonl`.
- **Options**: a classic settings page (breadcrumb + rows like General's) with the two switch groups —
  Memories / Memory system context / Automatic capture / Search by meaning, and Lessons learned /
  Lessons system context — each dependent row locks with the reason when its parent is off. The last
  capture's outcome is shown.
- **Search by meaning** (memories only, **off until you turn it on**: it sends the text of each memory
  to the Kybernos embedding model). The search field offers *Words | Meaning* (the choice is saved per
  browser). Turning the switch on checks, once, what your plan and server allow (one 2-letter embedding,
  never a memory); then « Index my memories » embeds them in batches and the rows show « NN% match ».
  When it cannot be done — switch off, plan too low (the embeddings model needs the Solo plan on the
  dev tier: `model-not-available-plan`), a server without pgvector or that predates the routes, no
  credits — the page shows the word matches and says why, with a link to Options.
- **Not drawn as if it existed**: the Map needs 2-D positions of the vectors, which nothing computes
  yet (the button is disabled and says so), and team lessons are not built (the Team scope and
  « Share lessons with your team » say so). The only plan gate shown is the one the server enforces
  (embeddings); memory itself is not limited by plan today.
- The under-composer **Memory pill** lives in `kybernos-sessions` (it needs the chat's journal): it shows
  what the model receives (« 25 of 637 ») and what this chat wrote, with a card that links here.

Everything is same-origin calls to local routes; CSS classes are all `kbmem-`-prefixed (a test pins it).

A lesson is one line of `<kybers>/<kyber>/memory/lessons.jsonl`:
`{ ts, text (≤ 500 chars), tags (≤ 5), uses, lastUsed }`. The file is written by
`~/.dsh/kybers/memory.cjs` (the agent runs it after a contradicted expectation) and by this
bundle. Both follow the same rules, and the suite proves it against the real CLI when it is on
the machine: text cut at 500 chars, tags lower-cased, **50 lessons per kyber**, the least
useful one (fewest `uses`, then oldest) leaves into `lessons.archive.jsonl` — never the one
just written, never destroyed. Differences, on purpose: an identical lesson is stored once,
every rewrite is atomic, and a deletion goes to the archive too.

## What it does

| | |
|---|---|
| **Prompt** | chunk `kybernos:lessons` (order 135, ≤ 2 400 chars **frame included**): the lessons of the kyber the session runs (`~/.dsh/kybers/.active/<sessionId>`) get 70 % of the budget, `default` the rest. Most used first, then newest; a lesson too long for what is left is skipped. Never the lessons of another kyber. The chunk says when lessons were left out. |
| **Tools** | `lesson_write` (text, kyber, tags — validated, deduplicated) and `lesson_search`. A lesson that a search returns counts as used: it is the only use this bundle can see, and the signal the cap relies on (1 lesson in 212 had `uses > 0` before). |
| **Switches** | `lessons` (agents may save and look lessons up) and `context` (lessons are injected), both on by default, in `kybernos-memory.json` (0600). `lessons = off` injects one line telling agents not to record lessons — a global rule or the `memory.cjs` habit would otherwise go on. A patch with an unknown key or a non-boolean applies nothing. |
| **Routes** | `GET /kybernos-memory/lessons` (limit, offset, kyber, used, added, q), `GET /kybernos-memory/kybers`, `POST …/lessons/add`, `…/lessons/update`, `…/lessons/delete`, `GET …/settings`, `POST …/settings/set`. Same-origin only, one path per route (the web server indexes by path). |

Kyber ids and session ids end up in paths: only plain names pass (`^[A-Za-z0-9][A-Za-z0-9._-]*$`,
no `..`), and a typo never creates a kyber.

## Limits, said plainly

- Search by meaning needs the server half (`GET/PUT/POST /v1/memories…` embeddings, with pgvector on the
  Supabase store) and a plan that includes the embeddings model; until then it falls back to words
  (`search.fallback` says why). It ranks at most 50 memories, newest account scope only.
- The lessons are local to this machine. Sharing with a team is not built yet.
- It only governs this bundle's tools and chunk. An agent can still run `memory.cjs lesson` through
  bash; `lessons = off` asks it not to, it cannot forbid it.
- Concurrent writers (the CLI appends, this bundle rewrites atomically) can lose an append in a
  window of a few milliseconds.

## Tests

```bash
node packages/kybernos-memory/test-memory-host.mjs   # real files in a temp folder, real memory.cjs if present
node packages/kybernos-memory/test-client.mjs        # the page's pure pieces, mounting contract, source guards
node scripts/check-memory-live.mjs --shots /tmp/mem  # the REAL GUI, read-only (needs dsh web restarted once)
```

The page itself (React) was driven end to end in a real browser while it was built — filters, pages,
add / edit / forget / undo, lessons edit / delete, both switch groups, not-connected, revoked session —
over the REAL host modules on temporary files with a fake Kybernos API behind them. That harness is
not in the repo (it needs a React build this repo does not depend on); `check-memory-live.mjs` is the
repo's own, read-only, check against the running GUI.
