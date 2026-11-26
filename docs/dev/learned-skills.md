# Skills learned from experience

Kaby proposes skills from what the person already did; the person validates; then the skill is used. **Nothing learned is active
before the person says yes**, unless the person's own setting (Settings › Learned skills, **off by default**) lets Kaby act alone above a
confidence line, with hard stops no line lifts, a journal and an undo for every change. This page says what V0 and V1 build, how it is
stored, and what comes next. The design was drawn and agreed as a mockup first (2026-10-21, `~/kybernos-archive/kaby-apprend-2026-10-21.html`; V2: `kaby-apprend-v2-2026-10-21.html`).

## The loop

| Step | V0 | V1 | Later (V2) |
|---|---|---|---|
| Observe | lessons that share a tag (three or more), a stable automation | a chat that says « remember how to do this », a correction of a skill Kaby made | a task repeated across sessions |
| Propose | a **suggestion** in a ledger, never in the skills folder | `skill_propose` and `skill_improve`, agent tools: the agent that did the work writes the text with the person's own model | |
| Validate | Accept, Edit or Discard on the Skills page; the person's own « Create skill » click on an automation is the acceptance | the same, **or** an automatic level in Settings, above a confidence line, with hard stops | the weekly card, promotion to Team |
| Use | the skill is a normal skill once accepted | a use counter (`tools/pre-execute`, `exec.name === "skill"`), an « unused for 30 days » flag | |

A rule-based « Make a skill » (V0) can only make a **checklist of pitfalls** (a lesson is a mistake that was corrected, not a
procedure): the lessons' own words under « Watch out for », plus the standard rules block. Real procedures come from the agent (V1).

## Where things live

All under `<DSH home>` (`$DSH_HOME`, else `~/.dsh`), written by `packages/kybernos-skills/learned.mjs`:

| File | What | Mode |
|---|---|---|
| `kybernos/skills-learned.json` | the ledger: `proposals`, `learned` (name → provenance), `discarded`, `legacyImported` | 0600, atomic, one writer at a time |
| `kybernos/skills-learned.audit.jsonl` | the journal, append-only; each line carries the hash of the line before it | 0600 |
| `kybernos/skills-learned-versions/<name>/<n>.md` | the text as it was accepted or improved (last 10 per skill, 90 days) | 0600 |
| `kybernos/skills-learned-settings.json` | the person's level, line, weekly limit, notice and Law/Health unlock; `breaker` is written by the host only | 0600 |
| `kybernos/skills-learned-sessions.json` | per chat: did it reach the outside world (names only, never arguments); 400 chats, oldest leave first | 0600 |
| `kybernos/skills-learned-notices.json` | V2: when Kaby last spoke, the answers to « you ask this again » (a pattern id, its state, its number, and outside Law and Health three words), the week the card was shown or hidden | 0600 |
| `skills/<name>/SKILL.md` | the accepted skill, a normal skill the person owns | written with `wx`: **never over an existing folder** |

A **proposal is not a skill**: the DSH registry, the « N of N active » count, Duplicate, Delete and the Team pack cannot reach it.
Accept copies it, switched on. Limits: **5 proposals wait** at most, one nobody answers for **30 days** leaves and is kept 30 days
more (Restore), an accepted one can be taken back (Undo) **only while `SKILL.md` is still the text that was written**.

## What a proposal must pass

The same checks as the skills this repository ships, shown on the review panel: a valid name (`^[a-z0-9]+(-[a-z0-9]+)*$`, 40
characters at most, the next free name when taken), a « Use when… » description, a bounded size (8 KB), not a copy of a skill the
person has (word overlap, warning from 60 %), and **no client data** (e-mail, phone or long number, date, listed names). In **Law and
Health** (the field chosen at first run, `kybernos/onboarding.json` › `profil`) client data **blocks Accept** until the text is
changed; elsewhere it is a warning. Every learned skill ends with the standard rules: the user's language, drafts only, nothing
invented, verification is the person's. The lint is rules, so it can miss a name: it reduces the risk, the review stays the person's.

## The journal

`GET /kybernos-skills/learned/journal` answers `{ ok, verified, brokenAt, count, entries }`. `verified` is the hash chain: an edited,
a deleted (in the middle) or a damaged line shows, with the `n` where it breaks. A chain cannot show lines cut off the end. Acts:
`proposed`, `accepted`, `created` (Kaby wrote a skill alone), `improved`, `discarded`, `restored`, `reverted`, `reviewed` (the person
pressed Keep), `expired`, `adopted`, `removed`, `settings` (a change of the level, line, limit or unlock), `paused` (back to « Ask me »
after two undos, or the person pressed Stop), `shared` (the person proposed it to the team); `by` is `you` or `kaby`; `mode` is `approved`, `manual` (the person's click),
`legacy` (made before suggestions existed) or `auto` (Kaby alone, or a housekeeping act such as an expiry). A line Kaby wrote alone
carries its **score and the parts of it**, and they are part of the hash; the lines written before V1 still verify.

## Routes (`/kybernos-skills/learned/…`)

| Route | Does |
|---|---|
| `GET learned` | `{ proposals[] with checks, hits, blocking, text; learned[]; discarded[]; sensitive; rules[]; limits }` |
| `GET learned/journal?limit=` | the journal, newest first, with whether the chain holds |
| `POST learned/from-lessons {lessons:[{text,tags,kyber}]}` | a pitfalls checklist from 1 to 8 lessons: `already_proposed`, `too_many_pending`, `no_lessons` |
| `POST learned/accept {id, description?, body?}` | writes the skill, keeps version 1, journals; `checks_failed` (with the failing checks), `write_failed` |
| `POST learned/edit {id, description?, body?}` | keeps the person's own words on the proposal, answers its new checks |
| `POST learned/discard {id}` · `POST learned/restore {id}` | 30 days of undo |
| `POST learned/undo {name}` | takes an acceptance back (a created skill goes, an improved one returns to the previous version): `edited_since`, `not_undoable` |
| `GET learned/settings` · `POST learned/settings/set {mode?, threshold?, cap?, notify?, privOk?}` | the settings; one bad value refuses the whole patch (`bad_settings`); the automatic levels are `locked_field` in Law/Health until `privOk` |
| `GET learned/session?sessionId=` | what happened to skills in one chat: `suggested[]`, `applied[]`, `used[]` (the chat card and the Summary tab read it) |
| `POST learned/keep {name}` | the person read a change Kaby made alone and leaves it (`reviewed`) |
| `POST learned/stop` | the kill switch: every automatic change of the last 7 days that still stands and was not edited since goes back, the level returns to « Ask me » |

| `GET learned/notice?sessionId=` · `POST learned/notice/answer {id, answer: yes\|later\|never}` | V2: the « you ask for this again » notice for the chat on screen (or `notice: null` and `why`), and the person's answer |
| `GET learned/notice/list` · `POST learned/notice/forget {id}` | V2: what the person answered (and whether the chat index is there: `index`), and « Forget » / « Allow again » |
| `GET learned/week?sessionId=` · `POST learned/week/hide` | V2: the weekly card (or `show: false` and `why`), and « Hide » for the week |
| `POST learned/shared {name}` | V2: the person proposed this learned skill to the team (the Team flow did the sending): journaled once, the hint stops |

`GET learned` also answers `settings`, `week: { used, cap }` and, on every suggestion, `score { total, signals[], risky }`, `stops[]`
and `hard[]` (the stops no line lifts); on every learned skill `chats` (the chats that loaded it), `shared` and `shareReady`. Every POST keeps the same-origin guard of the other routes (`test-origin.mjs` lists all of them). Answers are HTTP 200 with a
snake_case `error`; the page words each one (`he.<code>`, checked by `test-client-strings.mjs`, which also reads `learned.mjs`).

## V1: what Kaby may do on its own

**Settings › Learned skills** (`kybernos-skills-learned`, in the Memory group): three levels, a confidence line, the hard stops, the
limits, the audit trail and a kill switch. Every change is saved at once and journaled (`settings`).

| Level | Kaby may, above the line |
|---|---|
| **Ask me every time** (default, and what every field starts from) | nothing: it suggests, the person accepts |
| **Improve its own skills** | update a skill it made and the person accepted (a paragraph under `## Additions`); new skills still wait |
| **Create and improve** | also create a skill and switch it on |

The line is **70 to 99, 90 by default**; the limit is **1, 3 or 5 automatic changes a week, 3 by default**. The Autonomous preset
of the onboarding never changes any of this (the `agents` preset is not enforced by the engine and has its own screen).

### The score is made by rules

Never by the model grading itself (`learned-score.mjs`):

| Part | Points | What it measures |
|---|---|---|
| evidence | 35 | what it came from: a lesson 11 each; an automation run without a failure 6 each; a chat where the person asked 11 (+11 per verified lesson); for an improvement, 11 per distinct chat the skill was really used in |
| words | 25 / 10 | the person's own words (a lesson, an automation's text) 25; text the agent wrote 10 |
| checks | 15 | every check of the review passes |
| clean | 10 | no client data found |
| copy | 10 | not a copy of a skill the person has |
| record | 5 | the person accepted suggestions and took none of Kaby's own changes back in 30 days |

A text that asks to send, publish, delete, pay or run commands is **capped at 60**. Consequence, on purpose: a skill the agent wrote
in **one** chat scores 61 at most and never reaches the lowest line (70); what is applied alone in practice is an automation that
stayed stable (up to 95) and an improvement of a skill really used in three chats or more. The score measures evidence, not quality.

### Hard stops no line lifts

`your_click` (the person asked by hand: they still read it) · `asks` (the level) · `locked` (Law/Health until unlocked) ·
`needs_create` · `untrusted` (the chat read a web page, an e-mail or someone else's file, **or could not be followed**) · `risky` ·
`client_data` · `checks` · `edited_by_you` (a skill the person wrote or edited: Kaby proposes a diff, never applies it) · `below` ·
`cap`. Team and shipped skills follow the Team flow, not this setting. **Untrusted** is a fact the host records, not something the
agent says (`learned-taint.mjs`): `tools/pre-execute` notes each chat's calls (names only); an unknown tool counts as outside
(fail closed); a shell is local unless its command goes to the network; a chat the host did not see begin counts as outside.

### The agent tools and the prompt chunk

`skill_propose {description, steps, name?}` and `skill_improve {skill, addition, reason?}` are registered with `tools.register`;
`kybernos:learned-skills` (order 138) tells the agent when to call them and what never goes into a skill. The result says whether the
skill was **applied** or **waits** (and why), so the agent never claims a skill is active when it is not. A tool that cannot register
drops only that part (`mountLearned` is guarded part by part).

### Undo, Keep, the breaker and the kill switch

An automatic change shows in a banner on Skills (« Kaby changed N skills on its own »: Keep / Undo), in the chat card, in the
journal (with Undo on the latest one of each skill) and in the menu dot until each is kept or undone. **Two undos of Kaby's own
changes in 7 days** send the level back to « Ask me » (`paused`, and a note on the settings page until a level is chosen again).
**Stop and undo the last 7 days** is the kill switch (two clicks).

## V2: what Kaby notices and tells

Three pieces, none of which writes a skill on its own. All three are switchable in **Settings › Learned skills**, under the V1 cards.

### A task that comes back (`learned-repeat.mjs`)

Rules on the first message of each chat, no model, nothing leaves the computer. The chats come from **Search everywhere's** index
(`kybernos/search/chats.v1.json`) through a read-only seam, `globalThis[Symbol.for('kybernos.chat-index')]` (frozen, `{ version, asks(sinceMs),
refresh() }`, looked up at call time like the learned-skills seam): without that bundle nothing is noticed and the rest keeps working.

- **What counts as alike:** short asks only (a first message of more than 400 characters is a brief); words of 4 letters or more, without the common
  English and French words, numbers, URLs and paths; two asks are alike when they share 3 words and at least 40 % of their words. A **pattern** is at least
  `minRep` (3, 4 or 5) such chats on at least 3 different days within `win` (30, 60 or 90) days. Chats started by an automation, the phone bridge or
  Kaby's own folder are left out. The pattern id is stable while its oldest chat stays in the window.
- **When it speaks:** under a finished answer of the chat that makes the pattern (its newest member, opened in the last 3 days), the composer empty,
  nothing running (`session.running`). At most **once a day**; two « Not now » in a row make it **once a week**; « Never for this one » is remembered
  (and undone in Settings: *Allow again*); an accepted one is quiet for 30 days.
- **What the click does:** « Write it down » **pre-fills the composer** (`inputActions.setDraft`, never `submit`) with « Remember how to do this as a skill
  (use skill_propose), from this conversation ». The person presses Send; the agent writes the proposal with `skill_propose` (V1).
- **Repeats are evidence.** When `skill_propose` is called in the chat that makes the pattern, the host counts the earlier similar chats it verified
  (`repeatInfo`) and the score's « what it came from » gets 11 points for each, up to the 35 it already had: **the most an agent-written skill reaches is
  85**, so with the default line of 90 it still never applies alone; at a line of 83 or less, a repeated skill from a clean chat can. Every hard stop of V1
  applies unchanged (a chat that read the web is never applied alone, whatever the repeats). The proposal carries `from.repeats { n, dates }` and the review
  panel says it.
- **Law and Health:** detection stays on, but no word of a chat is kept (the state file holds a pattern id, a state, a number and dates) and the card names no topic.
- **Measured** on the owner's own machine (read-only, 2,011 chats of the last 60 days, median first message 634 characters: briefs written for agents): 2
  patterns with the rules above, both agent templates or test prompts, none a human repeat; 1 to 2 with short asks only; 6 with a looser 30 % line, one of
  them a false group of 254 chats (hence the line is not lowered). On such a profile the notice would almost never speak. It is made for someone who retypes
  short asks; that profile was not measured.

### The weekly card (`learned-week.mjs`)

On the home of a **blank** chat (dock slot `conversation.input.dock`, `session.blank`), from the ledger and the journal: skills accepted and chats that used a
skill this week (a small per-skill `useLog`, one entry per chat), the skill used most, what waits, what Kaby did alone, skills nobody used for a month
(**Keep** renews, **Switch off** uses the normal switch) and skills ready for the team. Lessons added in the last 7 days come from the memory route
(`/kybernos-memory/lessons?added=7d`) and are left out when it does not answer. Once per ISO week, in the first blank chat that asks (it stays while that chat
is open); **Hide** keeps it away for the week; nothing happened, no card. It follows the settings: `week` on and `notify` not « in chat only ».

### Ready to share

`shareReady` (host): `team` on (and in Law and Health only with `teamPriv`), not proposed yet, read by the person, and used in at least `teamMin` (3, 5 or 8)
chats. It is a hint: a chip « ready to share » on the card, a block in the skill's panel, a row in the weekly card. The button opens the **existing Team sheet** on
that skill (only the text leaves, secret scan, admin approval: unchanged); when the proposal goes through, the client tells `learned/shared`, which journals
`shared` once. Without a team on the account the button says so.

## The skill scout (`scout.mjs`)

Kaby learns from the person's own work; the scout looks at what others have published. Once a week (a visible automation, template « Skill scout » in
Automations › Discover, Mondays 09:00, saved OFF until the person has read it) or on « Scan now » on Skills › Featured, the host asks the public skills index
what fits the person, **filters what it finds in code (never by a model)** and keeps at most five new finds in `<DSH home>/kybernos/skills-scout.json`
(0600, atomic, one writer at a time per home; at most 12 listed, a find leaves after 60 days). **It installs nothing.** A find is drawn on the Featured tab as one
of the picks (« Found for you »); Install goes through the same confirmation as any Discover entry, and a skill that comes from outside never applies itself.

- **What it asks.** Each ticked goal (`kybernos/onboarding.json › goals`) is asked with the **search phrases its domain pack gives it** (`goals[].search`, one or two
  lowercase English words such as `support ticket triage` or `inventory management`; `docs/dev/domain-packs.md`): the first phrase of every goal, then the second ones;
  a goal whose pack gives none is asked with its id as words. The index matches words, not sentences (measured on the real index: « Sort customer requests » finds one
  unrelated skill, « support ticket triage » finds the right ones, and a bare « stock » finds the stock market). The words of the person's own skills are asked **only
  when no goal is ticked** (from six skills up, the words that three to four in ten of their descriptions share): next to goals they were noise (« kyber », « asks »,
  « description »). At most eight questions, ten answers each. The index is thin for some fields (real estate, health, education: little above 1,000 installs): those
  scans find little, and say so.
  The relay of the index rate-limits a burst (HTTP 429, then 403 for a while): a scan is eight questions and a few dozen lookups, never a loop.
- **The filter, in this order** (`filterCandidates`; each refusal is counted by reason in the run record): a skill that is not on GitHub (it cannot be installed), a bad
  name, one already installed, one the person said « Not interested » to (180 days), one already found, fewer than 1,000 installs, **a match that answers no goal and
  only one word of the person's skills** (`weak_match`), then 24 audit lookups shared out between the questions (the goals first, so a broad word cannot use them
  all): **at least one audit and every verdict `pass`**; then the `SKILL.md` itself (12 reads): at most 24 KB, **no secret and no injection pattern** (`textFlags`),
  **not a copy of a skill the person has** (likeness ≥ 0.6). A skill that asks to run commands, delete, send or pay is **flagged, not refused** (`risky`): the card says
  « Can run commands » and the person reads it first. What answers a goal is listed before what only matches the words of their skills.
- **Routes.** `GET scout` (the finds not installed since, the last six runs, whether a scan is under way), `POST scout/run` (a scan in the background, not before ten
  minutes after the last one; a refusal known at once, such as nothing to look for or a scan under ten minutes old, is the answer), `POST scout/dismiss {id}`.
- **The agent tool.** `skill_scout` (no parameters; `learned-tools.mjs`) runs the same scan for the automation and answers with the names and why; the prompt chunk
  tells the agent to call it only when asked or by the schedule.
- **On the screen.** The finds come after the field's skills, as the same cards and rows as the picks, with the audits as pills, `Not interested` (leaves at once) and
  Details (the skill's window, on the same tab). A foot line says when it last scanned, how many are new and how many the filter refused, with **Scan now** and **Make it weekly** (a chat that
  starts the template, through `window.__KB_OPEN__.template('skill-scout')`).
- **Measured.** A first real scan on the sandbox (goals tickets, stock, letters, outreach): 70 answers, most refused by the audit rule (18 of the 70 had a warning),
  which is the filter doing its job, and the single-word matches were noise (« harness », « description »), hence `weak_match` and the filler rule above. Relevance is
  bounded by the index's own search; the finds are proposals, never actions.

## Pictures made on the fly (`cover-maker.mjs`)

A Featured card with no picture (a skill of the field, a find, a pick whose picture cannot be read) gets one made **the way the shipped ones were**
(`docs/dev/skills-featured-covers.md`): the same style sheet and tail, a scene written by `meta-llama/Llama-3.3-70B-Instruct-Turbo` from the skill's name and description (a
plain scene when it does not answer), `FLUX-2-pro` for the picture, `Bria/remove_background` for the cut-out, trimmed to its alpha box. The file is
`<DSH home>/kybernos/skills-featured/<name>.png` with a `.cover.json` that keeps the scene. It costs about 0.035 USD a picture: at most **sixteen a day** (every picture paid for counts, a failed card's too), one at a time,
only with `DEEPINFRA_API_KEY` (the environment, else `<DSH home>/.credentials.yaml`), a failed one is not retried for a quarter of an hour, and the person's switch
(`skills-covers.json › auto`, on by default; « Turn off » on the Featured foot line) stops it. Routes: `GET covers/state?names=`, `POST covers/make {items}`, `POST covers/auto {on}`.
The page asks once per card, looks again every four seconds while pictures are made, and shows the new file; a tile pulses meanwhile. Network: `api.deepinfra.com`, and
`temp.bria.ai` for the cut-out Bria hands back (https only, no redirect, nothing else is fetched).

**The cover must be a floating tile.** A first real run made a library with its walls (85 % of the trimmed picture opaque; the shipped covers are 40 to 55 %). The scene
prompt now asks for ONE compact miniature, and the cut-out is checked: up to three pictures are tried until the opaque part is at most 72 % (at least 12 %), the closest to a
tile is kept, none is written above 80 %. A cut-out call that fails is tried twice on the same picture before a new picture is paid for; a picture call that fails is not
repeated (the card waits). A cut-out that reaches the edge of the picture was cropped by the frame (a desk with its legs cut): it is kept only when no uncropped one comes.
The sidecar `<name>.cover.json` keeps `opaqueShare` and the number of pictures.

**Equal weight on screen.** The pictures differ in shape (aspect 0.98 to 1.75) and weight (39 to 67 % opaque); fitted by their box, the wide heavy ones filled the card and the
others floated in it. The page draws each so that its OPAQUE part covers 0.29 of its frame (what the shipped covers average), within 92 % of the width and 90 % of the height
(`fitCover` in the client reads the opaque part from a 48-pixel copy; measured on the sandbox: 0.28 to 0.30 on 10 covers, one clamped by the height at 0.23).

## The seam for automations

The automations half of Kybernos is another bundle and cannot import this one. `kybernos-skills` publishes a frozen
`globalThis[Symbol.for('kybernos.learned-skills')] = { version: 1, propose(input) }`, read **at call time** by `kybernos-plugin`
(`kbAutoSkillWrite`), the way kybernos-memory reads the space seam. A stable automation (`stableAfter` runs without a failure,
3/5/10/20) is handed over as a **suggestion**; the person's own « Create skill » click passes `acceptNow` (the click is the
acceptance, the journal says `manual`). Without `kybernos-skills` there is no seam, nothing is written and the route says so.
`automation-skills.json` keeps recording which automation made which skill (`state`: `pending` or `made`), so none is proposed twice.

Skills the automations already made the old way are **adopted once** as Learned (kept active, journaled `adopted`, not
undoable). The switch « Suggest skills from stable automations » (the old « Create skills automatically », same key `autoSkill`)
is now **on by default**, since nothing activates without the person.

## What the person sees

- **Skills › Featured**: the first cards (the skills of the person's field with a dot, then the scout's finds) are the picks' own cards and rows; a card with no
  picture gets one made in the same style; the foot line speaks for the scout and the pictures.
- **Skills › Yours**: a banner (« N skills suggested by Kaby », Hide is a per-browser choice) and, above it, the one for what Kaby did
  alone; dashed cards with Review, a chip and an Origin filter (Suggested by Kaby / Learned / Mine), a **Learned** badge with its
  version, « applied by Kaby · not reviewed » and « Not used for N days » (with Switch off), and its provenance on accepted skills, a
  Journal button. Review opens a window over the page (every panel of this screen is a window: nothing is drawn beside the list); each suggestion also carries **Review, Edit, Discard and Accept** on its card (cards view) or its row (list view), so a suggestion can be answered without opening it (Accept locked exactly as in the window; Edit opens the window in edit mode): why, the text (or the paragraph an improvement adds, as a diff), the rules
  block, the **confidence with its parts and why Kaby may not act alone with the person's settings**, the checks,
  Accept / Edit / Discard.
- **The chat**: at the end of the last answer, a card for what Kaby suggested or applied from **this** chat (`conversation.chat.turnTail`,
  last turn only, nothing when there is nothing).
- **The Summary tab**: « Learned in this chat » (`kybernos-summary`), the same facts as rows.
- **Above the composer** (V2): the « you ask for this again » card in a chat that has begun, and the weekly card on a blank chat.
- **The menu**: a dot on the Skills row when something waits, a suggestion or a change Kaby made alone that nobody read
  (`window.__KB_LEARNED__`, published by the Skills bundle: `count`, `subscribe`, `refresh`; polled every 5 minutes and on focus).
- **Memory & Lessons**: **Make a skill** on a lesson next to « Propose to team », a hint when three lessons of the page share a tag,
  and « N skills made from experience » in the status line.
- **Onboarding**: one line under the agents choice (« you approve each one, whatever you choose here »).

## Not built yet

- Comparing the **tools** a chat used (the journals hold them, the chat index skips 99 % of the bytes) or asking the agent to notice: both cost more and
  are less precise; not built.
- **Not measured on a real conversation yet**: the agent tools were played in tests and on the sandbox, not by a model on a real task
  (whether a model calls `skill_propose` well, and how the use counter behaves with the engine's real `skill` tool); nor the V2 « you ask for this again »
  card under a real finished answer (the sandbox has no model, so DSH keeps its session « blank », and the card speaks only once a chat has begun).
- The `agents` preset (careful / balanced / autonomous) is **not enforced** by the engine; the Autonomous preset never activates a
  learned skill, and the automatic levels are a separate setting.

## No engine patch

Host routes, one `globalThis` seam, existing slots. Nothing in `scripts/patches.json` is touched. The old instant write of
`kbAutoSkillWrite` is gone (the dead-code rider of `AGENTS.md`).

## Tests

`node packages/kybernos-skills/test-learned.mjs` (ledger, checks, Accept, Undo, expiry, adoption, the journal chain, the routes and the
seam on a throw-away home), `test-learned-auto.mjs` (settings, score, hard stops, taint, automatic apply, improve, undo, breaker, kill
switch, use counter, tools, mounting, routes), `test-ui.mjs` (banner, cards, panel, journal, filter, settings page, chat card, French),
`test-scout.mjs` (the scout's interests, filter, scan, file and tool text, no network), `test-cover-maker.mjs` (the style sheet kept verbatim, the scene, the three calls on a stub, the PNG trim, the daily limit and the backoff), `test-scout-ui.mjs` and `test-markdown.mjs` (source level),
`test-learned-v2.mjs` (the V2 settings, the detector, the notice and its rate limits, repeats as evidence, ready to share, the weekly card, the routes),
`test-client-strings.mjs` (also reads `learned-settings.mjs`, `learned-score.mjs` and `learned-repeat.mjs`), `test-origin.mjs`; `packages/kybernos-memory/test-client.mjs` (Make a skill, hint, status line); `packages/kybernos-plugin/test-automation-skills.mjs`
and `test-learned-dot.mjs`; the real GUI: `scripts/check-skills-learned-live.mjs` (sandbox only, see `live-testing.md`).
