# Skills learned from experience

Kaby proposes skills from what the person already did; the person validates; then the skill is used. **Nothing learned is active
before the person says yes**, unless the person's own setting (Settings › Learned skills, **off by default**) lets Kaby act alone above a
confidence line, with hard stops no line lifts, a journal and an undo for every change. This page says what V0 and V1 build, how it is
stored, and what comes next. The design was drawn and agreed as a mockup first (2026-10-21, `~/kybernos-archive/kaby-apprend-2026-10-21.html`).

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
after two undos, or the person pressed Stop); `by` is `you` or `kaby`; `mode` is `approved`, `manual` (the person's click),
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

`GET learned` also answers `settings`, `week: { used, cap }` and, on every suggestion, `score { total, signals[], risky }`, `stops[]`
and `hard[]` (the stops no line lifts). Every POST keeps the same-origin guard of the other routes (`test-origin.mjs` lists all twenty). Answers are HTTP 200 with a
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

- **Skills › Yours**: a banner (« N skills suggested by Kaby », Hide is a per-browser choice) and, above it, the one for what Kaby did
  alone; dashed cards with Review, a chip and an Origin filter (Suggested by Kaby / Learned / Mine), a **Learned** badge with its
  version, « applied by Kaby · not reviewed » and « Not used for N days » (with Switch off), and its provenance on accepted skills, a
  Journal button. Review opens a panel beside the list: why, the text (or the paragraph an improvement adds, as a diff), the rules
  block, the **confidence with its parts and why Kaby may not act alone with the person's settings**, the checks,
  Accept / Edit / Discard.
- **The chat**: at the end of the last answer, a card for what Kaby suggested or applied from **this** chat (`conversation.chat.turnTail`,
  last turn only, nothing when there is nothing).
- **The Summary tab**: « Learned in this chat » (`kybernos-summary`), the same facts as rows.
- **The menu**: a dot on the Skills row when something waits, a suggestion or a change Kaby made alone that nobody read
  (`window.__KB_LEARNED__`, published by the Skills bundle: `count`, `subscribe`, `refresh`; polled every 5 minutes and on focus).
- **Memory & Lessons**: **Make a skill** on a lesson next to « Propose to team », a hint when three lessons of the page share a tag,
  and « N skills made from experience » in the status line.
- **Onboarding**: one line under the agents choice (« you approve each one, whatever you choose here »).

## Not built yet

- **V2**: repeated-task detection, the weekly card (the « week » choice of Notify), promotion to the Team flow (after acceptance and
  three uses, never from Law or Health by default).
- **Not measured on a real conversation yet**: the agent tools were played in tests and on the sandbox, not by a model on a real task
  (whether a model calls `skill_propose` well, and how the use counter behaves with the engine's real `skill` tool).
- The `agents` preset (careful / balanced / autonomous) is **not enforced** by the engine; the Autonomous preset never activates a
  learned skill, and the automatic levels are a separate setting.

## No engine patch

Host routes, one `globalThis` seam, existing slots. Nothing in `scripts/patches.json` is touched. The old instant write of
`kbAutoSkillWrite` is gone (the dead-code rider of `AGENTS.md`).

## Tests

`node packages/kybernos-skills/test-learned.mjs` (ledger, checks, Accept, Undo, expiry, adoption, the journal chain, the routes and the
seam on a throw-away home), `test-learned-auto.mjs` (settings, score, hard stops, taint, automatic apply, improve, undo, breaker, kill
switch, use counter, tools, mounting, routes), `test-ui.mjs` (banner, cards, panel, journal, filter, settings page, chat card, French),
`test-client-strings.mjs` (also reads `learned-settings.mjs` and `learned-score.mjs`), `test-origin.mjs`; `packages/kybernos-memory/test-client.mjs` (Make a skill, hint, status line); `packages/kybernos-plugin/test-automation-skills.mjs`
and `test-learned-dot.mjs`; the real GUI: `scripts/check-skills-learned-live.mjs` (sandbox only, see `live-testing.md`).
