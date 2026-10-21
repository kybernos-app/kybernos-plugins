# Skills learned from experience

Kaby proposes skills from what the person already did; the person validates; then the skill is used. **Nothing learned is active
before the person says yes.** This page says what V0 builds, how it is stored, and what comes next. The design was drawn and
agreed as a mockup first (2026-10-21, `~/kybernos-archive/kaby-apprend-2026-10-21.html`).

## The loop

| Step | V0 | Later |
|---|---|---|
| Observe | lessons that share a tag (three or more), a stable automation | a task repeated across sessions (V2), a chat that says « remember how to do this » (V1) |
| Propose | a **suggestion** in a ledger, never in the skills folder | `skill_propose` agent tool, written by the agent that did the work, with the person's own model (V1) |
| Validate | Accept, Edit or Discard on the Skills page; the person's own « Create skill » click on an automation is the acceptance | an automatic level in Settings, above a confidence threshold, with hard stops (V1) |
| Use | the skill is a normal skill once accepted | a use counter on `tools/pre-execute` (`exec.name === "skill"`), an « unused for 30 days » flag (V1) |

No model is used in V0. A rule-based « Make a skill » can only make a **checklist of pitfalls** (a lesson is a mistake that was
corrected, not a procedure): the lessons' own words under « Watch out for », plus the standard rules block. Real procedures come
from V1.

## Where things live

All under `<DSH home>` (`$DSH_HOME`, else `~/.dsh`), written by `packages/kybernos-skills/learned.mjs`:

| File | What | Mode |
|---|---|---|
| `kybernos/skills-learned.json` | the ledger: `proposals`, `learned` (name → provenance), `discarded`, `legacyImported` | 0600, atomic, one writer at a time |
| `kybernos/skills-learned.audit.jsonl` | the journal, append-only; each line carries the hash of the line before it | 0600 |
| `kybernos/skills-learned-versions/<name>/<n>.md` | the text as it was accepted (last 10 per skill, 90 days) | 0600 |
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
`proposed`, `accepted`, `discarded`, `restored`, `reverted`, `expired`, `adopted`, `removed`; `by` is `you` or `kaby`; `mode` is
`approved`, `manual` (the person's click on an automation), `legacy` (made before suggestions existed) or `auto` (a housekeeping
act of Kaby: an expiry).

## Routes (`/kybernos-skills/learned/…`)

| Route | Does |
|---|---|
| `GET learned` | `{ proposals[] with checks, hits, blocking, text; learned[]; discarded[]; sensitive; rules[]; limits }` |
| `GET learned/journal?limit=` | the journal, newest first, with whether the chain holds |
| `POST learned/from-lessons {lessons:[{text,tags,kyber}]}` | a pitfalls checklist from 1 to 8 lessons: `already_proposed`, `too_many_pending`, `no_lessons` |
| `POST learned/accept {id, description?, body?}` | writes the skill, keeps version 1, journals; `checks_failed` (with the failing checks), `write_failed` |
| `POST learned/edit {id, description?, body?}` | keeps the person's own words on the proposal, answers its new checks |
| `POST learned/discard {id}` · `POST learned/restore {id}` | 30 days of undo |
| `POST learned/undo {name}` | takes an acceptance back: `edited_since`, `not_undoable` (a skill that existed before suggestions) |

Every POST keeps the same-origin guard of the other routes (`test-origin.mjs` lists all seventeen). Answers are HTTP 200 with a
snake_case `error`; the page words each one (`he.<code>`, checked by `test-client-strings.mjs`, which also reads `learned.mjs`).

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

- **Skills › Yours**: a banner (« N skills suggested by Kaby », Hide is a per-browser choice), dashed cards with Review, a chip and an
  Origin filter (Suggested by Kaby / Learned / Mine), a **Learned** badge and its provenance on accepted skills, a Journal button.
  Review opens a panel beside the list: why, the text, the rules block, the checks, Accept / Edit / Discard.
- **The menu**: a dot on the Skills row when something waits (`window.__KB_LEARNED__`, published by the Skills bundle: `count`,
  `subscribe`, `refresh`; polled every 5 minutes and on focus).
- **Memory & Lessons**: **Make a skill** on a lesson next to « Propose to team », a hint when three lessons of the page share a tag,
  and « N skills made from experience » in the status line.
- **Onboarding**: one line under the agents choice (« you approve each one, whatever you choose here »).

## Not built yet (the mockup shows them, marked V1 / V2)

- **V1**: `skill_propose` and `skill_improve` agent tools, the in-chat card, « Learned in this chat » in the Summary tab, the use
  counter, the unused flag, and **Settings › Learned skills**: three levels (Ask me every time by default / Improve its own skills /
  Create and improve), a confidence threshold (default 90, a score by rules, never the model grading itself), hard stops no
  threshold can lift (a source that read untrusted content, actions beyond reading and drafting, client data, skills the person
  wrote, Team and shipped skills, a weekly cap), a circuit breaker (two undos in a week), the Law/Health lock, « Stop and undo the
  last 7 days ».
- **V2**: repeated-task detection, the weekly card, promotion to the Team flow (after acceptance and three uses, never from Law or
  Health by default).
- The `agents` preset (careful / balanced / autonomous) is **not enforced** by the engine; the Autonomous preset never activates a
  learned skill, and the automatic levels will be a separate setting.

## No engine patch

Host routes, one `globalThis` seam, existing slots. Nothing in `scripts/patches.json` is touched. The old instant write of
`kbAutoSkillWrite` is gone (the dead-code rider of `AGENTS.md`).

## Tests

`node packages/kybernos-skills/test-learned.mjs` (ledger, checks, Accept, Undo, expiry, adoption, the journal chain, the routes and the
seam on a throw-away home), `test-ui.mjs` (banner, cards, panel, journal, filter, French), `test-client-strings.mjs`,
`test-origin.mjs`; `packages/kybernos-memory/test-client.mjs` (Make a skill, hint, status line); `packages/kybernos-plugin/test-automation-skills.mjs`
and `test-learned-dot.mjs`; the real GUI: `scripts/check-skills-learned-live.mjs` (sandbox only, see `live-testing.md`).
