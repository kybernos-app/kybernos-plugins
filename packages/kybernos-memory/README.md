# kybernos-memory — Memory & Lessons learned

The **Memory & Lessons learned** feature: the settings page (browser half, `client.js`) and the
lessons (host half, `index.js`). The account memory itself stays in
[`kybernos-cloud`](../kybernos-cloud/README.md) — it needs the account token, lessons do not — and the
page reaches it through that plugin's routes; the account token never leaves the host.

## The page

Settings → **Memory & Lessons** (one of the essentials at the top of the menu, after AI Provider & Models). It opens as **« Memory looks after itself »**: the
defaults below are already on, so the first screen is one line of status and the data, and every switch is folded under one
**Customize** button.

- **The status line** (under the title): what is on and when it last tidied itself, e.g. « Memories and lessons are on · Last tidied
  3 days ago » (or « Tidies itself every week » before the first run). It never reads « Off » while something works: without an
  account the lessons still do (« Lessons are on and stay on this computer · Memories need your account »). The only word « off » on the
  page is what the person switched off themselves (« Memory is off » when both halves are). `selfStatus` in `client.js` is the pure
  function (tested), the line is empty until the status, the switches and the tidy-up state are read, so it never flashes a wrong word.
- **The one step: the account.** With no account the status line carries a **Connect your account** button (it opens the cloud card
  through the `kybernos-cloud:open` window event, the same one the Models page sends) and the Memories tab says why instead of
  drawing a toolbar nobody can use. Nothing else is asked.

- **Memories** (account): list, search by words, filters (Show: all / pinned / sent to the model ·
  Source: auto-capture / agent / you / sync · Added: last minute / hour / today / 7 days), pages of 25,
  50 or 100, add, edit (text, retention, pinned) and forget with an Undo.
- **Lessons learned** (every agent team, local files): list, filters (agent team, used at least once, added),
  pages, edit (text, tags) and delete — a deleted lesson goes to the agent team's `lessons.archive.jsonl`.
- **Team lessons** (Lessons learned → *Team*, on a Team workspace only; locked with the reason otherwise): the lessons an owner or
  admin of the workspace approved, which every agent of the team reads. See « Team lessons » below.
- **Customize**: a classic settings page (breadcrumb + rows like General's) with the two switch groups —
  Memories / Memory system context / Automatic capture / Search by meaning, and Lessons learned /
  Lessons system context — each dependent row locks with the reason when its parent is off. The last
  capture's outcome is shown.
- **Search ranks by relevance, locally** (the default, any plan, nothing leaves the machine): accents,
  case and plurals are ignored, stop words do not count, rare words weigh more than common ones, a prefix
  or fragment matches under an exact word, and a row says « 2 of 3 words » when it lacks some of yours.
  It cannot link words that share no letters ("voiture" / "bagnole") nor French and English: that is
  what search by meaning is for. The ranking is `packages/kybernos-cloud/relevance.mjs` (pure, 3 ms over
  2000 memories).
- **Pick by relevance** (Customize, on by default, local): besides the pinned and the newest memories, the
  prompt also carries the memories that clearly match what the user just asked, even old ones — on a
  640-memory account the one about Docker on this Mac is nine days old and the base selection never sends it.
  The question is the human's latest message of the session (`agent/inbox/claimed`, `source.kind: 'user'`),
  judged by its 12 rarest words that can match something; a memory is picked when it has 2+ of them covering
  a quarter of the question's rarity (or 1 word that is half of it), never less than half of the best match,
  at most 6, within 40 % of the memories budget, and only if the question is selective (not when dozens of
  memories match equally). It costs nothing to the history: the engine appends a new « runtime context »
  snapshot whenever the text changes, so the pick is made once per message, kept while the topic is the
  same, and not changed again for 3 turns. The page's counts and « Sent » chips stay the base selection.
- **Pick by relevance, for the lessons** (Customize → Lessons learned, on by default, local): an agent team holds up to 50
  lessons and the block fits about a third of them, so the base selection (most used, then newest) never sends an old,
  never-used lesson. The same picker as the memories' ranks the lessons of the chat's agent team and `default` against the human's
  latest message (`agent/inbox/claimed`, `source.kind: 'user'`; tags count as text) and sends the clear matches first — at most
  4, within 40 % of the lessons budget, and only if the question is selective (more than 10 qualifying lessons means none
  stands out). It never reads another agent team's lessons, and it costs nothing to the history: the pick is made once per message,
  kept while the topic holds, not changed within 3 turns, and byte-identical across the steps of one message (a lesson
  written mid-turn waits for the next one). The Memory pill's Lessons tab says « Picked for your latest message: 2 lessons »
  (`GET /kybernos-memory/lessons?session=` answers `picked: { count, turn }`).
- **Search by meaning** (memories only, **off until you turn it on**: it sends the text of each memory
  to the Kybernos embedding model). The search field offers *Relevance | Meaning* (the choice is saved per
  browser). Turning the switch on checks, once, what your plan and server allow (one 2-letter embedding,
  never a memory); then « Index my memories » embeds them in batches and the rows show « NN% match ».
  When it cannot be done — switch off, plan too low (the embeddings model needs the Solo plan on the
  dev tier: `model-not-available-plan`), a server without pgvector or that predates the routes, no
  credits — the page shows the relevance matches and says why, with a link to Customize.
- **Tidy up** (Customize → *Clean up now*, the schedule, then a banner on the page): finds near-duplicates among the
  memories and among the lessons, on this machine. Suggestions are groups (« Merge 3 into 1 », « Remove the outdated
  one »): the most complete item stays, or the one you pick, optionally with edited text; pinned memories are never
  removed; lessons only meet inside their own agent team. **A group that is 80 % alike or more is merged by itself**
  (setting *When it finds near-duplicates*: « Merge close matches by itself », the default, or « Ask me first »);
  the weaker ones wait for *Merge*, *Edit the kept one*, *Keep both* (remembered, and takeable back) or *Accept all*.
  Every merge is archived first and can be undone for 30 days (restored memories come back as new memories,
  restored lessons exactly as they were; a lesson Undo refuses when the agent team would pass 50). The kept lesson
  inherits the tags and the uses of the others. A negation (« do not X » vs « X ») or another number (« port 3000 »
  vs « 3080 ») is never « the same fact », whatever the word overlap.
  *Run automatically* (Off / When DSH starts / Daily / Weekly (default) / Every 50 new) starts a run while DSH runs:
  a look, then what the mode allows; a failed run waits an hour. **An agent team that nears its cap is looked at too, whatever
  the schedule says** (see « The cap » below), unless the schedule is Off. *Study model judges the unclear cases* (off by
  default; uses the Study model of Kybernos Settings, which is picked automatically unless you chose one or None, and the
  row says which one): the pairs that look alike but are not duplicates are sent to
  it — their text only, never the whole list — and it answers « same » (with a merged wording), « replaces » (the
  newer one makes the older outdated) or « different »; its answers are only ever suggestions, never merged by
  itself. See *Tidy up* below.
- **Map** (Memories → View *List | Map*): each dot is a memory, close dots mean close meaning, the clusters are named by
  the words that set them apart, and each dot links to its nearest neighbours. It draws a sample of at most 150 (the pinned
  ones, then the ones sent to the model, then the newest) and says so. Look around: hover for the text, click for a card
  with *Open* (the same side sheet as the list), « Light up what matches » dims the rest, drag to move, scroll or the
  buttons to zoom, *Fit* to come back; every dot also works from the keyboard. Rings mark what is sent each turn.
  The page only draws; the positions come from the cloud host (`GET /kybernos-cloud/memory/meaning-map`, same-origin
  guarded), which works them out on this machine from the embedding vectors (`packages/kybernos-cloud/mapproj.mjs`: the first two
  principal components, dots spread so none sits on another, k-means for the clusters, deterministic: the same memories
  give the same picture). It needs **Search by meaning** (Customize): the vectors are the same embeddings, so turning the
  switch on is what lets the text of the memories drawn go to the Kybernos embedding model; with it off, or on a plan
  without the embeddings model, the Map view says so in words and offers Customize or the list. The vectors are kept in a
  private side file next to the cloud state (`kybernos-cloud-memory-vectors.json`: int8 + a scale, keyed by a hash of the
  text, no memory text, at most 800, dropped when the memory goes), filled by the indexing too, so opening the map is usually
  free and an edited memory costs one embedding. No server route is involved. The choice List | Map is kept in the
  browser, but only once a map was really drawn. The lessons have no map: they stay on this machine and drawing
  them would send them to the embedding model.
- **Not drawn as if it existed**: what is not there is said, not faked. The plan gates shown are the ones that are real:
  the embeddings (the server enforces them) and the Team scope (the plugin enforces it, see « Team lessons »); memory itself
  is not limited by plan today.
- The under-composer **Memory pill** lives in `kybernos-sessions` (it needs the chat's journal): it shows
  what the model receives (« 25 of 637 ») and what this chat wrote, with a card that links here.

Everything is same-origin calls to local routes; CSS classes are all `kbmem-`-prefixed (a test pins it).

A lesson is one line of `<kybers>/<kyber>/memory/lessons.jsonl`:
`{ ts, text (≤ 500 chars), tags (≤ 5), uses, lastUsed }`. The file is written by
`~/.dsh/kybers/memory.cjs` (the agent runs it after a contradicted expectation) and by this
bundle. Both follow the same rules, and the suite proves it against the real CLI when it is on
the machine: text cut at 500 chars, tags lower-cased, **50 lessons per agent team**, the least
useful one (fewest `uses`, then oldest) leaves into `lessons.archive.jsonl` — never the one
just written, never destroyed. Differences, on purpose: an identical lesson is stored once,
every rewrite is atomic, and a deletion goes to the archive too.

## What it does

| | |
|---|---|
| **Prompt** | chunk `kybernos:lessons` (order 135, ≤ 2 400 chars **frame included**): the lessons of the agent team the session runs (`~/.dsh/kybers/.active/<sessionId>`) get 70 % of the budget, `default` the rest. Most used first, then newest; a lesson too long for what is left is skipped. Never the lessons of another agent team. The chunk says when lessons were left out. |
| **Tools** | `lesson_write` (text, kyber, tags — validated, deduplicated) and `lesson_search`. A lesson that a search returns counts as used: it is the only use this bundle can see, and the signal the cap relies on (1 lesson in 212 had `uses > 0` before). |
| **Switches** | `lessons` (agents may save and look lessons up), `context` (lessons are injected) and `relevant` (the lessons that match the latest message go first), all on by default, in `kybernos-memory.json` (0600). `lessons = off` injects one line telling agents not to record lessons — a global rule or the `memory.cjs` habit would otherwise go on. A patch with an unknown key or a non-boolean applies nothing. |
| **Routes** | `GET /kybernos-memory/lessons` (limit, offset, kyber, used, added, q), `GET /kybernos-memory/kybers`, `POST …/lessons/add`, `…/lessons/update`, `…/lessons/delete`, `GET …/settings`, `POST …/settings/set`. Same-origin only, one path per route (the web server indexes by path); every POST also needs DSH's signed session cookie (`session-guard.mjs`, `test-write-guard.mjs`). |

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
duplicate; it becomes an *unclear pair* (`unclearPairs`: Jaccard ≥ 0.5, or a clash), which is what the Study model is for.
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
when allowed), store the scan, then in `auto` mode apply the local groups with `score >= 80` that the user did not
keep apart — at most 100 removals per run, in requests of at most 50; a group over 50 stays for the review and the
run counts it as failed. The log says who merged: `auto` or `you`. `last` = `{ at, trigger, total, found, autoGroups,
autoRemoved, brainAsked, brainError }` and the page's « Next: … » comes from `tidyNext`.

**Settings** (`mode` auto|ask, `schedule` off|start|daily|weekly|n50, `brain` bool) live in each host's tidy state
and are written by the page to both (lessons work without the cloud); a patch is all or nothing. The schedule
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
removal, and the answer only ever produces suggestions (`by: 'brain'`) for the review — `pickAuto` never applies one.

Both hosts: `apply` needs `confirm: true`, checks every group against what is stored *now* (a changed or vanished item
makes its group `a_change`, never a guess), writes the archive before the first delete and refuses a request that
removes more than 50 items. `dismiss` remembers a pair the user kept apart (`restore: true` takes it back).
Same-origin guard, POST for everything that writes, and DSH's session cookie on every POST.

## The cap: tidied before it bites

An agent team holds 50 lessons at most; at the 51st the least useful one (fewest uses, then oldest) leaves into
`lessons.archive.jsonl`, and a tidy-up Undo refuses (`kyber_plein`) when it would pass 50. So the tidy-up does not wait for the cap:
**from 40 lessons in one agent team** (`LESSONS_NEAR_COUNT`, per team, not the total) the scheduler's ten-minute look (`tidyTick`)
starts a run with `trigger: 'cap'`, even when the week (or the day) is not over. It then follows the person's settings like any other
run: in « Merge close matches by itself » it merges what is 80 % alike, in « Ask me first » it only proposes (the banner on the page),
and with *Run automatically: Off*, or Lessons switched off, it does nothing. It is not repeated every ten minutes: once when the
fullest team has grown since the last run (`last.peak`, the size of the fullest team after that run), otherwise once a day while a
team stays near the cap. A run that was started this way and merged something is announced on the page like a scheduled one, with its
Undo. The Lessons tab also says, in one note, which team is near, how full it is and what happens at 50 (the archive, never a delete).
What the tidy-up cannot do is invent room: 45 lessons that are all different stay 45, and the 51st still pushes the least useful one
into the archive.

## Team lessons

A personal lesson is a sentence on this machine. A **team lesson** is a sentence an owner or admin of a **Team workspace** approved:
every agent of the workspace reads it, like a house rule. It is a third thing, apart from the personal lessons (local files) and
from the platform's own lessons (server-side, global).

- **Who may use it**: a connected account whose plan starts with `team` and whose active workspace is in its list. The plugin
  decides this (`packages/kybernos-cloud/team-lessons.mjs`, `teamWorkspace`); the server only enforces membership. Anyone else sees the
  Team scope and the two Customize rows locked, with the reason (« Team plan », « Team workspace », « Connect a Kybernos Cloud account »).
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
- **Customize**: *Use your team's lessons* (`team_use`) and *Share lessons with your team* (`team_share`, hides the Propose entries when
  off). Both are kept by the cloud plugin next to the memory switches (`GET /kybernos-cloud/memory/settings`).
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
`lesson_write` and `lesson_search` refuse with one sentence, the human's message is not kept for the relevance pick, the scheduled tidy-up
stays home (and a scan started by hand does not ask the Study model), and the page reports 0 lessons sent. A `tools/pre-execute` hook refuses a call
that names a side door (`memory.cjs`, `lessons.jsonl`, `kybers/<team>/memory`, `kybernos-cloud*.json`, `kybernos-memory*.json`, the pages' loopback routes
`/kybernos-cloud|memory|search/`): it stops the habit and the plain `curl`, not a shell that hides what it touches, and it leaves the `kybers/` folder
alone (the Agent Team matching reads it). The seam is read at every call, so a switch in the middle of a session holds both ways. No
seam (no cloud bundle) or not connected: nothing changes. The page itself (the person's own lessons) keeps working in a team space.

## Tests

```bash
node packages/kybernos-memory/test-memory-host.mjs   # real files in a temp folder, real memory.cjs if present
node packages/kybernos-memory/test-client.mjs        # the page's pure pieces, mounting contract, source guards
node scripts/test-team-memory-cut.mjs                # the canary: no personal memory or lesson in a team space (both bundles)
node packages/kybernos-cloud/test-dedupe.mjs         # near-duplicate detection (pure)
node packages/kybernos-cloud/test-mapproj.mjs        # the map's positions, clusters and names (pure)
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
