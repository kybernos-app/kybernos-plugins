# Domain packs: Kybernos set up by field of work and by goal

A **domain pack** is one JSON file per field of work (Education, Health, Real estate, Law…). It does not run anything. It names what
Kybernos already knows how to do (skills, agent teams, automations, menu wording, new-chat templates) and groups it under the **goals** a person
can tick. The wizard reads the packs, the person picks a field and some goals, and the plan is applied through the routes that exist today.

```
pack JSON (data) ──▶ host validates ──▶ GET /kybernos/domains ──▶ wizard: field, goals, kit, live miniature ──▶ existing routes
                                                              └──▶ menu wording and home order read at boot
```

Design study and mockups: private artifacts of 2026-10-21 (v1 by field, v2 by goals and by team), archived outside git.

## Why goals, not only a field

Two people in the same field want different things (a physio who wants fewer missed appointments, a clinic that wants faster notes). The field
sets the vocabulary and the defaults; **the goals decide what is installed**. Nothing is installed for a goal that is not ticked.

## What a pack contains

`packages/kybernos-plugin/domains/<id>.json`, checked by `domain-pack.mjs` (known keys only, bounded sizes, plain values; an invalid file is skipped
and logged, it never stops the host).

| Field | Meaning |
|---|---|
| `v`, `id`, `order` | format version `1`; `^[a-z][a-z0-9-]{1,23}$`, the file name without `.json`; a number 1 to 99, the order fields are listed in (the catch-all is 99) |
| `accent`, `icon` | the field's colour (`#rrggbb`) and one of the icons the wizard draws (`cap heart house scales trend bag mega code wand`) |
| `name`, `tagline` | texts `{ "en": "…", "fr": "…" }`: `en` required, another language falls back to `en` |
| `keywords` | lower-case words (no accents) that point a sentence to this field (« kiné en libéral à Lyon » finds health): matched at the start of a word |
| `home` | ids of the new-chat templates this field wants first (`doc sheet slides automation website plugin…`) |
| `legacyJobs` | ids the old 12-profession step stored (`soft`, `etudes`…): a saved `profil` of that id reads as this field |
| `menu.labels`, `menu.hide` | rename our menu rows (`kyber dashboards aiteams projects deliverables tasks skills connectors documents`); hide only `documents` |
| `goals[]` | `id`, `name`, `title`, `desc`, `skills`, `teams`, `automations`, `soon`, `starter` |
| `goals[].skills` | `{ source, name, d }`. `source` is a GitHub `owner/repo` (installed through `/kybernos-skills/install`, which refuses a pair that does not exist) or `kybernos` for a skill this plugin ships in `domains/skills/<name>/SKILL.md` |
| `goals[].teams` | ids of the Agent Teams of the marketplace (`studencik`, `research-desk`, `inbound-closer`), created through `kybers/create` |
| `goals[].automations` | `{ id, name, prompt, cron }` (texts per language, five cron fields): created **switched off** through `/kybernos/tasks`, approvals on « ask » |
| `goals[].soon` | names of things planned and not installable yet: listed greyed, never installed |
| `goals[].starter` | a first question, shown in the miniature |

A pack never contains code, a URL to fetch, a key or a number about the person. An automation's prompt says that it drafts and never sends (a test
checks it) and says what it needs when no app is connected.

## What the person sees

Welcome, **field** (tiles with the field's icon and colour, or a sentence), **goals** (each row says what it adds), display mode, model, **kit**.
Beside every step a **live miniature** of Kybernos shows the result and follows the pointer and the ticks: the page and the miniature take the field's
colour, the menu rows take its words, the first questions, the skills, the suggested team and the automations of the ticked goals appear. The
miniature draws only what is wired (no dashboard tiles until a connected app can feed them). It is hidden under 1000 px.

The kit is the union of the skills, teams and automations of the ticked goals. The same screen as before: everything ticked unless it already exists
(a skill by name, a team by id, an automation by name in any language of the pack), nothing runs by itself.

## What applying a pack does

1. **Skills**: from GitHub through the Skills page route, or, for `source: "kybernos"`, `POST /kybernos/domain/skill` copies the shipped `SKILL.md`
   into `<DSH home>/skills` with the careful seeding of `seed-skills.mjs` (never over a skill the person wrote or edited, never back over one they
   switched off). Only a name some pack lists as bundled is accepted.
2. **Teams**: `kybers/create`, into DSH's own home.
3. **Automations**: `POST /kybernos/tasks {action:"create"}` with `active:false`. Replays create nothing twice (the name is looked up first).
4. **Saved choice**: `profil` (the field id) and `goals` in `~/.dsh/kybernos/onboarding.json` (the version stays `1`: older files read the new
   field as empty). `POST /kybernos/onboarding {action:"domain"}` records a choice without finishing the wizard (Settings, Starter kit).
5. **Wording and highlights, read from the saved field**: the menu rows take the pack's labels (only in a language the pack writes), and the
   new-chat page lists the pack's `home` templates first (`kbNcSlider(bootIds, first)`).

Switching to another field later follows three rules: **replaces** the menu wording, the home order and the saved choice (reversible); **adds
only** skills, teams and automations (never removed by a switch); **never touches** sessions, memory, workspaces or anything the person made.

## Seams, and what is wired

| Part of a pack | Seam | State |
|---|---|---|
| Field, goals, kit, live miniature | wizard (`KB-OB`), `kbObPreviewOf` | **wired** |
| Skills (GitHub and shipped) | `/kybernos-skills/install`, `/kybernos/domain/skill`, `seed-skills.mjs` | **wired** |
| Teams | `kybers/create` | **wired** |
| Automations (off) | `/kybernos/tasks` | **wired** |
| Menu wording, hidden rows | `SalesMenu` rows (our own component, no engine patch) | **wired** |
| Home order | `kbNcSlider(bootIds, first)` in `KbNewChatCards` | **wired** |
| Saved choice | `onboarding.json` | **wired** |
| Theme per field | theme presets (`theme-presets.json`, plain data). No public « apply a preset » call was found | next |
| « What do you want to see first » | order of the menu and the home | next |
| Dashboards | `*.miniapp.json` and `presets.mjs`. Sources are internal only; tiles fed by a connected app need a new source kind. Until then a dashboard shows samples marked as such | next |
| Connectors | suggested in the Connectors page; each needs the person's authorisation | next (suggest only) |
| Per team | see below | next |

## Per team (not wired yet)

Creating an Agent Team should run a short onboarding of its own: purpose and goals, colour and icon, the indicators to watch, the apps it may read,
then a page that says what is inherited from the field and what is the team's own. The workspace store already holds the name, icon, colour,
description, selected skills (`/kybernos/workspace-skills`) and instructions. Still to create: the team's goals, its dashboard, the automations
suggested for it. Limiting an app to one calendar or folder for a team is not studied: connections belong to the account.

## The skills this plugin ships

Eleven skills in `domains/skills/` (quiz-builder, consult-notes, patient-reminders, literature-watch, listing-writer, property-valuation,
rent-reminders, case-law-watch, deadline-check, invoice-reminders, stock-check). Each is a plain `SKILL.md` that says when to use it, works from the
person's own material, never invents a figure or a reference, and drafts without sending. A test checks the frontmatter, that every folder is used by
a pack and that every skill an automation names exists.

## Safety

- A pack is data, bounded (12 goals, 8 skills per goal, 3 automations per goal, 160 characters per text, 900 per prompt), and checked on load; a bad
  file is skipped.
- `GET /kybernos/domains` is public data (`no-store`). The routes that write (`/kybernos/onboarding`, `/kybernos/domain/skill`) need a strict same
  origin; `/kybernos/tasks` also needs the signed session, as before.
- Nothing is installed without the person ticking it. Automations are created off.
- Health and law should recommend a local model (the way to keep content on the computer), never force it. A `privacy` text in the pack is the
  planned seam; it is not wired.

## Tests

- `node packages/kybernos-plugin/test-domain-pack.mjs`: format and limits, the shipped packs, every GitHub skill pair is one the starter kits verified,
  every shipped skill has its `SKILL.md`, every team exists in the marketplace, every automation is complete and drafts only.
- `node packages/kybernos-plugin/test-onboarding-state.mjs`: the saved fields, an older file still reads as done.
- `node scripts/test-onboarding.mjs`: the wizard's pure core (steps, kit, sentence matching, miniature model, cron labels, menu wording).
- `node packages/kybernos-plugin/test-newchat.mjs`: the home order.
- Live, sandbox only: `node scripts/check-onboarding-live.mjs` (tiles, miniature, sentence, goals, kit with a shipped skill and an automation, the
  saved choice, the menu wording on the real page).

## Open decisions

- Which fields ship first (nine here: education, health, real estate, law, finance, commerce, marketing, development, general).
- One field per profile or several at once.
- Who writes the content marked soon (teams): us, or the Marketplace community. A signed catalogue (like themes and local models) is the way to
  ship packs without a release; the files stay bundled until then.
