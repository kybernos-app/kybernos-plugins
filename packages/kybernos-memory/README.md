# kybernos-memory — Memory & Lessons learned

The **Memory & Lessons learned** feature: the settings page (browser half, `client.js`) and the
lessons (host half, `index.js`). The account memory itself stays in
[`kybernos-cloud`](../kybernos-cloud/README.md) — it needs the account token, lessons do not — and the
page reaches it through that plugin's routes; the account token never leaves the host.

## The page

Settings → **Memory & Lessons** (one of the essentials at the top of the menu, after AI provider and models) opens on one screen of plain rows, in the
rhythm of DSH's General page: **Instructions** (the same text and routes as the Kybernos Cloud page), three switches (**Use memory in chats**, **Learn from
chats**, **Include sensitive topics**), **Look for repeats** with its mode, **Your memory** (Manage), **Import**, **Export**. Everything else is one level down.
The defaults are already on: the first screen is the data, and nothing has to be set up.

- **Manage** lists the notes about the person (name = first sentence, summary = the rest, the date added), searchable by words, 8 at a time and « Show N more »,
  then the lessons grouped by agent team (**Learned by your teams**), a box at the bottom to **tell Kybernos something to remember** (a toast with Undo; a repeat says
  « Already in your memory »), **Recently removed** (every delete, merge and import for 30 days, with Restore) and **Delete all memory…** (a confirmation; final,
  and it empties Recently removed). On a Team workspace a **Your memory / Team** switch appears: the Team tab lists the lessons an owner or admin approved, with the
  proposals queue (see « Team lessons » below). The Claude Code notes wait-list and the suggestions Kaby makes (a dashed block above the list) live here too.
- **A note** has its own page: when it was added, who wrote it, how long it is kept, its text; **Edit** (text, keep for, pinned; for a lesson title, summary, tags),
  **Delete** (Undo for 30 days) and, on a lesson, **Make a skill** (next to « Propose to team »): it hands the lesson to the Skills page
  (`POST /kybernos-skills/learned/from-lessons`) as a **suggestion** — a checklist of pitfalls in the lesson's own words, fixed rules, no model, no cost, active only
  when the person accepts it there. See `docs/dev/learned-skills.md`.
- **Import** gives a prompt to copy into another assistant and takes the answer back: one note per line, numbering stripped, each line checked by the same gate as
  any other note. **Export** downloads a .zip of plain text files (`about-you.txt`, `teams/<team>.txt`), built in the page.
- **Look for repeats** finds near-duplicates among the notes and among the lessons, on this machine, and lists them on a review screen (see *Tidy up* below).
- Switch meaning: *Use memory* = the account notes' and the lessons' « context » switches; *Learn* = the account capture and the lessons; *Sensitive* = the account's
  `sensitive` setting (the capture rules then allow health, beliefs and the like). Not connected: the account half says so (« Connect your account » opens the cloud
  card through the `kybernos-cloud:open` window event) and the lessons keep working.

What the page no longer draws (2026-11-20; the routes and settings keys stay, so the five callers keep working — the Memory pill, search, Atlas, the Skills page and
the Kaby customisation page — and the engine keeps its defaults):

- the **Customize** page and its sixteen settings, the status line and its banners, the Memories / Lessons tabs and their filters and page sizes;
- the **map** (memories placed by meaning): the route `GET /kybernos-cloud/memory/meaning-map`, `mapproj.mjs` and its vector side file are gone.
  A `kybernos-cloud-memory-vectors.json` left next to the cloud state is no longer read; it holds no memory text and can be deleted by hand;
- the rows of **Search by meaning**, **Pick by relevance**, the tidy schedule and the Study model. They keep working with the values they had (the defaults
  otherwise); changing one now goes through the settings routes (`/kybernos-memory/settings/set`, `/kybernos-cloud/memory/settings/set`).

Behind the page, unchanged:

- **Search ranks by relevance, locally** (any plan, nothing leaves the machine): accents, case and plurals are ignored, stop words do not count, rare words weigh more
  than common ones, a prefix or fragment matches under an exact word, and a row says « 2 of 3 words » when it lacks some of yours. It cannot link words that share no
  letters ("voiture" / "bagnole") nor French and English: that is what search by meaning is for. The ranking is `packages/kybernos-cloud/relevance.mjs` (pure, 3 ms over
  2000 memories).
- **Pick by relevance** (on by default, local): besides the pinned and the newest memories, the prompt also carries the memories that clearly match what the user just
  asked, even old ones. The question is the human's latest message of the session (`agent/inbox/claimed`, `source.kind: 'user'`), judged by its 12 rarest words that can
  match something; a memory is picked when it has 2+ of them covering a quarter of the question's rarity (or 1 word that is half of it), never less than half of the best
  match, at most 6, within 40 % of the memories budget, and only if the question is selective. It costs nothing to the history: the engine appends a new « runtime context »
  snapshot whenever the text changes, so the pick is made once per message, kept while the topic is the same, and not changed again for 3 turns.
- **Pick by relevance, for the lessons**: an agent team holds up to 50 lessons and the block cannot hold them all, so the base selection (most used, then newest) never sends
  an old, never-used lesson. The same picker ranks the lessons of the chat's agent team and `default` against the human's latest message (tags count as text) and sends the
  clear matches first — at most 4, within 40 % of the lessons budget, and only if the question is selective. It never reads another agent team's lessons, and it is
  byte-identical across the steps of one message (a lesson written mid-turn waits for the next one). The Memory pill's Lessons tab says « Picked for your latest message:
  2 lessons » (`GET /kybernos-memory/lessons?session=` answers `picked: { count, turn }`).
- **Search by meaning** (memories only, **off until turned on**: it sends the text of each memory to the Kybernos embedding model). The host routes and the `meaning` setting
  stay (search and the Memory pill call them); the page has no row for them any more.
- **Tidy up**: suggestions are groups (« Merge 3 into 1 », « Remove the outdated one »): the most complete item stays, or the one you pick, optionally with edited text; pinned
  memories are never removed; lessons only meet inside their own agent team. The mode is *Merge close matches by itself* or *Ask me first*; the weaker groups wait for *Merge*,
  *Edit the kept one*, *Keep both* (remembered, and takeable back) or *Accept all*. Every merge is archived first and can be undone for 30 days. See *Tidy up* below.
- The under-composer **Memory pill** lives in `kybernos-sessions` (it needs the chat's journal): it shows what the model receives (« 25 of 637 ») and what this chat wrote,
  with a card that links here.

Everything is same-origin calls to local routes; CSS classes are all `kbmem-`-prefixed (a test pins it).

A lesson is one line of `<kybers>/<kyber>/memory/lessons.jsonl`:
`{ ts, text (≤ 500 chars), tags (≤ 5), uses, lastUsed [, from] [, title (≤ 60)] [, summary (≤ 140)] }`. `title` and `summary`
are optional: a line written before they existed has neither, and readers derive them at read time (the first clause and
the first sentence of the text, cut at a word) without ever writing the guess back. Every rewrite keeps the fields it does
not know. The file is written by
`~/.dsh/kybers/memory.cjs` (the agent runs it after a contradicted expectation) and by this
bundle. Both follow the same rules, and the suite proves it against the real CLI when it is on
the machine: text cut at 500 chars, tags lower-cased, **50 lessons per agent team**, the least
useful one (fewest `uses`, then oldest) leaves into `lessons.archive.jsonl` — never the one
just written, never destroyed. Differences, on purpose: an identical lesson is stored once,
every rewrite is atomic, and a deletion goes to the archive too.

## The « Noted » line in the chat (2026-11-20)

When Kaby saves a note during a conversation (the `memory_write` tool, or the end-of-turn capture), one quiet line sits under the **last** answer of that chat:
« Noted: You live in Lyon » with **Open** and **Undo**. It is the `conversation.chat.turnTail` slot (`kybernos-memory-noted`, order 58), the same seam as the
Skills card: it runs for every answer, so the line keeps the highest turn number seen per chat (`seq`, else `turn`) and draws under that turn only, and a note is
claimed by the first turn that sees it, so a later answer does not repeat it. The line asks the host for its own chat (`GET /kybernos-cloud/memory/noted`, a few
times after the answer because the capture writes after it) and draws nothing when the route is absent, the account is signed out, or nothing was noted.

- **Open**: hands the note to the page (`notedOpen`, taken once, 15 s) and opens Settings on this page by its nav cell (the same two anchors as the Memory card of
  the sessions plugin); the page opens straight on the note. If Settings cannot be reached the line says so.
- **Undo**: the page's own delete (`/kybernos-cloud/memory/delete`), so the note goes to « Recently removed » for 30 days. The line becomes « Undone: … » (kept on
  screen though the account no longer holds the note). The note already gone → « Already removed: … »; the server refused or away → « Could not undo just now »
  and the buttons stay.
- Not built here (left for later): the « replaces … kept as history » wording, a switch to hide the line, « Don't remember this chat ».

## What it does

| | |
|---|---|
| **Prompt** | chunk `kybernos:lessons` (order 135, ≤ 2 400 chars **frame included**), an **index** like the skills list: the lessons that clearly match the latest human message (2 to 4, at most 40 % of the budget) are written in full, every other lesson that fits is one line `- <id> <title> : <summary>`, and one line tells the model to read a lesson with `lesson_read` before relying on it. The selection is unchanged: the lessons of the agent teams the session runs (`~/.dsh/kybers/.active/<sessionId>`: the `{ kybers: [...] }` list the agent writes, the older `{ kyber }`, or both; the 4 most recent teams) share 70 % of the budget evenly (a team with no lesson does not count in the split), `default` gets the rest, and what a share leaves unused goes back to the teams in turn. Most used first, then newest. The index lines are as wide as the budget allows (`INDEX_WIDTHS`, the widest at which every lesson fits, else the narrowest): a team of 50 lessons of the measured median length (325 characters) shows 30+ entries where the full texts showed about 6. A short lesson with no title of its own is shown whole. The text depends only on the files and the pick, so it is byte-identical while they stay the same. Never the lessons of an agent team the session does not run. The file goes by `session-<uuid>`, the id as given or the bare uuid: all three are tried. The chunk says how many lessons were left out (`lesson_search` finds them). |
| **Tools** | `lesson_write` (text, kyber, tags, optional title ≤ 60 and summary ≤ 140 — validated, clipped, deduplicated), `lesson_search`, `lesson_read` (1 to 5 ids as the index prints them, the `lesson_forget` form: full text, title and tags; an unknown id is said plainly), `lesson_forget` (one lesson by its id; the engine asks the person first with a card carrying the lesson's words, and the lesson goes to the archive) and `memory_tidy` (below, « memory_tidy »). A lesson that a search or a read returns counts as used: it is the only use this bundle can see, and the signal the cap relies on (1 lesson in 212 had `uses > 0` before). |
| **Switches** | `lessons` (agents may save and look lessons up), `context` (lessons are injected) and `relevant` (the lessons that match the latest message go first), all on by default, in `kybernos-memory.json` (0600). `lessons = off` injects one line telling agents not to record lessons — a global rule or the `memory.cjs` habit would otherwise go on. A patch with an unknown key or a non-boolean applies nothing. |
| **Routes** | `GET /kybernos-memory/lessons` (limit, offset, kyber, used, added, q), `GET /kybernos-memory/kybers`, `POST …/lessons/add`, `…/lessons/update`, `…/lessons/delete`, `GET …/settings`, `POST …/settings/set`. Same-origin only, one path per route (the web server indexes by path); every POST also needs DSH's signed session cookie (`session-guard.mjs`, `test-write-guard.mjs`). |

**One door** (2026-11-20). 148 of the maintainer's 212 lessons had been written by a script outside this bundle, which none of these rules
could see. The closing line of the lessons block now says that `lesson_write` is the only door (never a file or a script), and it is sent
whenever recording is on, also when nothing is injected (context off, or no lesson yet): then the whole block is that one line.

Agent Team ids and session ids end up in paths: only plain names pass (`^[A-Za-z0-9][A-Za-z0-9._-]*$`,
no `..`), and a typo never creates an agent team.

## Limits, said plainly

- Search by meaning needs the server half (`GET/PUT/POST /v1/memories…` embeddings, with pgvector on the
  Supabase store) and a plan that includes the embeddings model; until then it falls back to the local relevance ranking
  (`search.fallback` says why). It ranks at most 50 memories, newest account scope only.
- The personal lessons are local to this machine. What a team shares is a separate list (see « Team lessons »); it needs the
  server half and a Team workspace, and an agent never reads a personal lesson of someone else.
- It only governs this bundle's tools and chunk. An agent can still run `memory.cjs lesson` through
  bash; `lessons = off` asks it not to (and so does the team-space line below), it cannot forbid it.
- Concurrent writers (the CLI appends, this bundle rewrites atomically) can lose an append in a
  window of a few milliseconds.

## Tidy up

Three pure modules, copied into `kybernos-cloud` and `kybernos-memory` (bundles ship one by one and cannot import
each other; the tests fail if a copy drifts): `relevance.mjs` (the words), `dedupe.mjs` (the detector) and `tidy.mjs`
(settings, schedule, what may go without asking, the Study-model question and answer).

**Detection** (`dedupe.mjs`): items whose words (the `relevance.mjs` tokens) overlap almost entirely — Jaccard ≥ 0.8, or
one wholly inside the other (≥ 95 % of the smaller one, Jaccard ≥ 0.6, 4+ words). Groups are stars around a keeper,
never chains. Two things the overlap cannot see are checked on the raw text, because they flip a fact while leaving
the overlap at 100 %: a negation (`not` is a stop word) and a number. A pair that differs on either is not a
duplicate (a number differs when EACH text has one the other lacks; a number only one of them has is a detail, and such a
pair is grouped only around the keeper that holds it, so a merge never drops one). The texts are compared in one canonical
spelling first (`canon`: typographic quotes and dashes, a free-standing `+` as « plus », `&` as « and »); measured on
2026-11-08, two lessons of one team, 0.97 alike, had stayed apart because one wrote `+` and added « delta 0 ». Otherwise a pair that
is not a duplicate; it becomes an *unclear pair* (`unclearPairs`: Jaccard ≥ 0.5, or a clash), which is what the Study model is for.
`score` = the lowest Jaccard of a group's members with its keeper; `AUTO_MIN_SCORE = 80`.

| | Memories (`kybernos-cloud`) | Lessons (`kybernos-memory`) |
|---|---|---|
| Routes | `GET /kybernos-cloud/memory/tidy`, `POST …/tidy/scan`, `…/tidy/apply`, `…/tidy/dismiss`, `…/tidy/undo`, `…/tidy/settings` | the same under `/kybernos-memory/tidy` |
| Compared inside | the memory's kind | the agent team |
| Apply | edit the kept memory if asked, delete the others on the server | merge tags / uses / last use into the kept lesson, delete the others (each also goes to `lessons.archive.jsonl`) |
| Archive (30 days) | the removed rows and the kept one's old text, in `kybernos-cloud-tidy-archive.json` | the removed rows and the kept one's old fields, in `kybernos-memory.tidy-archive.json` |
| Undo | recreates the removed memories (new ids), puts the old text back | puts the rows back as they were; `kyber_plein` if the agent team would pass 50 lessons |
| State | `kybernos-cloud-tidy.json` (scan, kept-apart pairs, log, settings, last run, judged pairs) | `kybernos-memory.tidy.json` (same) |

**A run** (`tidyRun`, from « Clean up now » or the schedule): look (local groups, and the Study model's suggestions
when allowed), store the scan, then in `auto` mode apply (`pickAuto`, through the same apply path as a click: archive first,
one Undo per merge) the groups the user did not keep apart: the local groups with `score >= 80`, and — only if
`AUTO_MAX_BRAIN_MERGES` is raised above its value of 0 (decided 2026-11-20, after his first review: it was 10 since 2026-11-08) —
the Study model's « same » merges that pass `unsafeMerge`. The state is re-read after the model answers, so a setting changed during
the run is kept, and `ask` stops the run before the next request — at most 100 removals per run, in requests of at most 50; a group over 50 stays for the review and the
run counts it as failed. The log says who merged: `auto`, `brain` (the Study model) or `you`. `last` = `{ at, trigger, total, found,
autoGroups, autoRemoved, autoBrain, brainAsked, brainError }` and the page's « Next: … » comes from `tidyNext`.

**Settings** (`mode` auto|ask, `schedule` off|start|daily|weekly|n50, `brain` bool) live in each host's tidy state
and are written by the page to both (lessons work without the cloud); a patch is all or nothing. The memories default to
`{ auto, weekly, brain off }`; the lessons to `{ auto, daily, brain on }` (`LESSONS_TIDY_DEFAULTS`), so the index gets its titles
without anyone opening the page. A settings file keeps what it says; a run writes the settings only once someone set them, so a
default stays a default. The schedule
(`tidyDue`, checked 90 s after start then every 10 minutes while DSH runs): `daily` 24 h, `weekly` 7 days, `start` once
per launch if the last run is over 3 days old, `n50` once 50 more items exist than at the last run; never offline, not
with Memories / Lessons switched off, and a failed attempt is not retried for an hour.

**Study model** (`brain` of Kybernos Settings, read from `~/.dsh/kybernos/settings.json`: a « route/id » is the person's pick,
`none` is no Study model, empty is Automatic — the model `kybernos-sessions` picks and publishes as
`globalThis[Symbol.for('kybernos.studyModel')]`, a function giving « route/id » or `''`; absent, Automatic finds nobody and the
run says `pas_de_modele_detude`; `readStudyChoice` in `tidy.mjs`, shared with `kybernos-cloud`; the view tells the page
`{ model, auto, none, llm }`): asked through
the `llm` service (`purpose: 'kybernos-tidy'`), 12 pairs per question, at most 30 pairs per run, 60 s per question,
the notes handed over as data. Every verdict is cached by pair and text (a pair is asked once; a changed text is asked
again; `different` is remembered), every slip in the answer becomes « unsure », a pinned item is never offered for
removal. A local group of two under the 80 line is asked first, as a pair; its verdict takes the group's id and place. The answer
produces groups `by: 'brain'`: an « outdated » verdict (`replaces`) always waits for a click, and so does a « same » (since 2026-11-20
the model never merges alone; with `AUTO_MAX_BRAIN_MERGES` raised, a « same » would be merged in `auto` mode only when `unsafeMerge` (`tidy.mjs`) finds nothing wrong: a merged text, no pinned item, every number of the originals and no
other, and « not » said at least as often as the most negative original and no more often than all of them together (the checks of a
compaction, `numberSet` / `negationCount` of `dedupe.mjs`). Anything else stays a suggestion).

Both hosts: `apply` needs `confirm: true`, checks every group against what is stored *now* (a changed or vanished item
makes its group `a_change`, never a guess), writes the archive before the first delete and refuses a request that
removes more than 50 items. `dismiss` remembers a pair the user kept apart (`restore: true` takes it back).
Same-origin guard, POST for everything that writes, and DSH's session cookie on every POST.

**Compaction** (lessons only, `compact.mjs`): with the brain on and a Study model in force, a run also asks it about the lessons
with no title (since 2026-11-20 a run is always « titles and summaries only »: the text of a lesson is never rewritten, so a long lesson
that already has a title is not asked; the paragraph below describes the rewrite that `mode: 'auto'` of `compactLessons` can still do,
kept for the day he asks for it), the untitled first, then the longest (`compactOrder`: a new lesson is never starved
by long ones that already have a title), 8 per question and 12 questions per run (about 96 lessons a night, decided 2026-11-08): `{ title, summary, text }`,
text a rewrite of at most 300 characters keeping every fact, number and negation. `checkRewrite` refuses a title over 60, a
summary over 140, a text over 300 (or longer than the original), a number dropped, changed or added, a « not » dropped or added,
and a summary that leaves out the negation of a lesson that has one; a refused lesson is not asked again for 7 days while its text
stays the same. An accepted rewrite is applied like a merge: the old fields go to the tidy archive first, the original wording is
copied into `lessons.archive.jsonl` (`archivedBecause: 'compacted'`), and the log gets an entry (`by: 'brain'`, `kind: 'compact'`, or
`'title'` when only a title and a summary were added) that the existing Undo reverts. In `ask` mode only titles and summaries are
written, never a new text. Without a Study model nothing new is written. The lessons sent are the ones that need it, never the
whole list.

**memory_tidy** (tool, `{}` or `{ dryRun: true }`): runs the lessons tidy-up now (`trigger: 'tool'`, what « Clean up now »
runs) and, beside it, the account memories tidy-up of `kybernos-cloud`, waits for both at most 5 minutes (a lessons run already in
progress is waited for first) and answers in plain words: lessons before and after, merged, compacted, titles written, errors; then
one line for the memories (« Memories: 148 before, 145 after, 3 merged, 2 left as suggestions », « memories: not connected », or
why it did not run). `dryRun` writes nothing and asks no model, for both. A core automation calls it daily at 03:30; the page
announces such a run like a scheduled one. The memories are reached through `globalThis[Symbol.for('kybernos.memoriesTidy')]`, a
function `kybernos-cloud` publishes (`({ dryRun }) => { ok, before, after, merged, suggestions, error }`, counts only: the account
token never leaves that bundle); without it, or without an account, the line says « memories: not connected », which is not an
error. Lessons switched off or a team space: the lessons part refuses, like the other lesson tools, and the memories line still
comes.

## The cap: tidied before it bites

An agent team holds 50 lessons at most; at the 51st the least useful one (fewest uses, then oldest) leaves into
`lessons.archive.jsonl`, and a tidy-up Undo refuses (`kyber_plein`) when it would pass 50. So the tidy-up does not wait for the cap:
**from 40 lessons in one agent team** (`LESSONS_NEAR_COUNT`, per team, not the total) the scheduler's ten-minute look (`tidyTick`)
starts a run with `trigger: 'cap'`, even when the week (or the day) is not over. It then follows the person's settings like any other
run: in « Merge close matches by itself » it merges what is 80 % alike, in « Ask me first » it only proposes (the card on Manage, then the review screen),
and with *Run automatically: Off*, or Lessons switched off, it does nothing. It is not repeated every ten minutes: once when the
fullest team has grown since the last run (`last.peak`, the size of the fullest team after that run), otherwise once a day while a
team stays near the cap. A run that was started this way and merged something is announced on Manage like a scheduled one, with its
Undo (Recently removed). The page does not show the cap itself: a full team simply sends the least useful lesson to the archive, never a delete.
What the tidy-up cannot do is invent room: 45 lessons that are all different stay 45, and the 51st still pushes the least useful one
into the archive.

## Team lessons

A personal lesson is a sentence on this machine. A **team lesson** is a sentence an owner or admin of a **Team workspace** approved:
every agent of the workspace reads it, like a house rule. It is a third thing, apart from the personal lessons (local files) and
from the platform's own lessons (server-side, global).

- **Who may use it**: a connected account whose plan starts with `team` and whose active workspace is in its list. The plugin
  decides this (`packages/kybernos-cloud/team-lessons.mjs`, `teamWorkspace`); the server only enforces membership. Anyone else sees the
  the Team tab locked, with the reason (« Team plan », « Team workspace », « Connect a Kybernos Cloud account »).
- **Propose, approve**: a member proposes a lesson (the *Propose a lesson* button, or *Propose to team* on a personal lesson, which
  fills the sheet). Until an owner or admin decides, nobody else can read it — the proposer sees it under *My proposals*, « Waiting for
  review », and a rejection comes back with its reason. An owner or admin sees a banner with the number waiting and a review queue
  (approve, *Edit, then approve*, or *Reject…* with a reason), can add a lesson directly, and can retire or delete an approved one.
  The proposer can withdraw their own. Decisions are the server's and final; the names shown (« Proposed by Sara M. ») are what the
  client sent and are informational only.
- **What agents read**: an approved lesson goes into the system prompt as the block `[KYBERNOS TEAM LESSONS]`
  (`ctx.inject`, chunk `kybernos:team-lessons`, order 136, right after the personal lessons). It holds the lessons for the agent team of the
  chat and the general ones — never another agent team's — inside about 760 characters, newest first; the ones that match the latest
  message (same picker as the lessons' relevance, within half of that budget) come first. The list is re-read at most every 5 minutes
  and a failed read keeps the last good list (it is tried again a minute later), so a network error never empties the block or stops a turn;
  only a workspace that no longer exists empties it. It is off when *Use your
  team's lessons* is off, when Lessons system context is off, or when the account is not on a Team workspace.
- **Two settings**: *Use your team's lessons* (`team_use`) and *Share lessons with your team* (`team_share`, hides the Propose entries when
  off). Both are kept by the cloud plugin next to the memory switches (`GET /kybernos-cloud/memory/settings`); the page has no row for them any more, so they stay at their defaults (on).
- **The Memory pill** (Sessions) adds « From your team: 3 lessons sent (1 that match your latest message) » to its Lessons tab.
- **The server half**: `GET/POST /v1/workspaces/{id}/lessons[/…]` over the table `kybernos.team_lessons` (a proposal is
  `proposed`, then `approved` or `rejected`; an approved one can be `retired`). The plugin calls them with the account's own key; a
  server that predates them makes the Team tab say it could not load and nothing else.

Tests: `node packages/kybernos-cloud/test-team-lessons.mjs` (the pure half), `node packages/kybernos-cloud/test-cloud-host.mjs`
(sections « team »: routes, cache, prompt block, switches, kyber, relevance), `node packages/kybernos-memory/test-client.mjs`
(the page's pure pieces).

## In a team space the personal lessons are cut

When the active Kybernos space is a team (`team-space.mjs` asks `@local/kybernos-cloud` through `globalThis[Symbol.for('kybernos.space')]`; the
rule and its fail-closed cases are in the cloud README, « Team space: the personal memory is cut »), nothing personal is read or written here:
the `kybernos:lessons` chunk carries one line instead of the lessons (a team space, none can be recorded, « Propose to team » is the door),
`lesson_write`, `lesson_search`, `lesson_read` and `memory_tidy` refuse with one sentence, the human's message is not kept for the relevance pick, the scheduled tidy-up
stays home (and a scan started by hand does not ask the Study model), and the page reports 0 lessons sent. A `tools/pre-execute` hook refuses a call
that names a side door (`memory.cjs`, `lessons.jsonl`, `kybers/<team>/memory`, `kybernos-cloud*.json`, `kybernos-memory*.json`, the pages' loopback routes
`/kybernos-cloud|memory|search/`): it stops the habit and the plain `curl`, not a shell that hides what it touches, and it leaves the `kybers/` folder
alone (the Agent Team matching reads it). The seam is read at every call, so a switch in the middle of a session holds both ways. No
seam (no cloud bundle) or not connected: nothing changes. The page itself (the person's own lessons) keeps working in a team space.

## Tests

```bash
node packages/kybernos-memory/test-memory-host.mjs   # real files in a temp folder, real memory.cjs if present
node packages/kybernos-memory/test-client.mjs        # the page's pure pieces, mounting contract, source guards
node packages/kybernos-memory/test-lessons-index.mjs # titles, the index block, lesson_read, dedupe tolerance, compaction, memory_tidy
node scripts/test-team-memory-cut.mjs                # the canary: no personal memory or lesson in a team space (both bundles)
node packages/kybernos-cloud/test-dedupe.mjs         # near-duplicate detection (pure)
node packages/kybernos-cloud/test-tidy.mjs           # settings, schedule, auto line, Study-model question/answer (fake llm)
node scripts/check-memory-live.mjs --shots /tmp/mem  # a live GUI (KB_HOST: the real one, or a sandbox), read-only
```

On an instance with nothing to list (a fresh sandbox is not connected to Kybernos Cloud and has no lesson) the
live check SKIPs the row and count checks and asserts the empty state instead; it never seeds data.
Its last section loads the page again as a 390 px phone (DSH's mobile layer reads the device at load) and checks that no toolbar
control sits on another one and that every button stays inside the pill that holds it (A3-21).

The page itself (React) was driven end to end in a real browser while it was built — filters, pages,
add / edit / forget / undo, lessons edit / delete, both switch groups, not-connected, revoked session —
over the REAL host modules on temporary files with a fake Kybernos API behind them. That harness is
not in the repo (it needs a React build this repo does not depend on); `check-memory-live.mjs` is the
repo's own, read-only, check against the running GUI.
