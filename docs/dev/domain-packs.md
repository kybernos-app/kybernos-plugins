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
| `mode`, `agents` | the display mode the field starts from (`bureau`, or `code` for Development) and how much its agents may do alone by default: `{ preset: prudent / balanced / auto, why: text }` (the reason is shown under the choice) |
| `goals[]` | `id`, `search`, `name`, `title`, `desc`, `skills`, `teams`, `connectors`, `automations`, `soon`, `starter` |
| `goals[].search` | one or two **search phrases** for the skill scout (`docs/dev/learned-skills.md`): lowercase English words, 2 to 32 characters (`support ticket triage`, `inventory management`), none twice inside a pack. The public index matches words, not sentences, so a title such as « Sort customer requests » finds nothing useful: write what a skill would be called. Checked in `test-domain-pack.mjs`; measured against the real index on 2026-10-23 (some fields have little above 1,000 installs) |
| `goals[].skills` | `{ source, name, d }`. `source` is a GitHub `owner/repo` (installed through `/kybernos-skills/install`, which refuses a pair that does not exist) or `kybernos` for a skill this plugin ships in `domains/skills/<name>/SKILL.md` |
| `goals[].teams` | ids of the Agent Teams of the marketplace (`studencik`, `research-desk`, `inbound-closer`), created through `kybers/create` |
| `goals[].connectors` | slugs of apps of the Connectors catalogue (`packages/kybernos-composio/catalog.js`, at most 4, a test checks each exists): **suggested**, never connected for the person (each needs their own authorisation) |
| `goals[].automations` | `{ id, name, prompt, cron }` (texts per language, five cron fields): created **switched off** through `/kybernos/tasks`, approvals on « ask » |
| `goals[].soon` | names of things planned and not installable yet: listed greyed, never installed |
| `goals[].starter` | a first question, shown in the miniature |

A pack never contains code, a URL to fetch, a key or a number about the person. An automation's prompt says that it drafts and never sends (a test
checks it) and says what it needs when no app is connected.

## What the person sees

One question per screen, each with a button that moves on (and a quiet one for what is optional). After the welcome:

1. **Field**: tiles with the field's icon and colour. One tap chooses it, takes its first two goals, its display mode and its agents preset, and moves on.
2. **Goals**: each row says what it adds.
3. **Model**: unchanged (a Kybernos account, an own key, a model on this computer, the free community models).
4. **About you**: a website, a profile (LinkedIn, Facebook, Instagram…) and a free word, all optional; the button says « Skip this step » until something is typed. A free word that points to another field than « Something else » is offered, never applied on its own. It comes after the model because reading a site will need one.
5. **Agents**: three presets (careful, balanced, autonomous); the field's own is marked, with the pack's reason under the choice. Today the choice is **recorded and written into the person's memory** for the agents to read; the settings that would enforce it are to come. One line under the choice says that Kaby learns from the person's work and proposes skills, and that **the person approves each one, whatever the preset** (`docs/dev/learned-skills.md`: a suggestion waits in a ledger and nothing learned is active before Accept; the Autonomous preset never changes that).
6. **Kit**: the display mode as one row (it follows the field), the kit as one line (« Skills: 5 · Teams: 2 · Automations (off): 1 ») whose list is one tap away.
7. **Plan** (only where there is an account): Team solo or free, the last thing asked. The price and the payment page are the account's own: the wizard shows none and takes no card; « Continue with Team solo » opens the account's upgrade view when the wizard closes.

Beside every step (the plan apart) a **live miniature** of Kybernos shows the result and follows the pointer and the ticks: the page and the miniature take the field's
colour, the menu rows take its words, the first questions, the skills, the suggested team and the automations of the ticked goals appear. The
miniature draws only what is wired (no dashboard tiles until a connected app can feed them). Its « live » line and its caption sit under it, never above. It is hidden under 1000 px.

The kit is the union of the skills, teams and automations of the ticked goals. The same screen as before: everything ticked unless it already exists
(a skill by name, a team by id, an automation by name in any language of the pack), nothing runs by itself.

## What applying a pack does

1. **Skills**: from GitHub through the Skills page route, or, for `source: "kybernos"`, `POST /kybernos/domain/skill` copies the shipped `SKILL.md`
   into `<DSH home>/skills` with the careful seeding of `seed-skills.mjs` (never over a skill the person wrote or edited, never back over one they
   switched off). Only a name some pack lists as bundled is accepted.
2. **Teams**: `kybers/create`, into DSH's own home.
3. **Automations**: `POST /kybernos/tasks {action:"create"}` with `active:false`. Replays create nothing twice (the name is looked up first).
4. **Saved choice**: `profil` (the field id), `goals`, `agents` (the preset) and `about` (what was typed, bounded, kept in this local file; the public GET never carries it, only a strict same-origin request from the page gets it back, so a replay shows it) in `~/.dsh/kybernos/onboarding.json` (the version stays `1`: older files read the new
   field as empty). `POST /kybernos/onboarding {action:"domain"}` records a choice without finishing the wizard (the starter kit opened on its own).
5. **Wording and highlights, read from the saved field**: the menu rows take the pack's labels (only in a language the pack writes), and the
   new-chat page lists the pack's `home` templates first (`kbNcSlider(bootIds, first)`).

### On the pages

The saved field and goals also shape the pages the person opens, with no engine patch. `kybernos-plugin` publishes a read-only seam,
`window.__KB_DOMAIN__` (same idiom as `__KB_SKEL__`, `__KB_CUSTOMIZE__`): `field()`, `label(rowId)`, `skills()`, `connectors()`, `installSkill(name)`,
`openKit()`, `subscribe(fn)`. The bundles that draw the Skills, Connectors and Dashboards pages read it at each draw and redraw on a change; without
it (or with no saved field) they draw exactly what they drew before.

| Page | What the field changes |
|---|---|
| Every page that has a menu row | its **title is the menu's word** (`Deeds and notes`, `Deadlines`, `My firm`, `Legal team`), in a language the pack writes, else the page's own title |
| Creations | the **type tiles** come in the field's order: its `home` templates read as tiles (`doc`→Documents, `sheet`→Spreadsheets, `slides`→Slides, `image`→Images, `video`→Audio & Video, `website`→Websites, `miniapp`→Mini-app), the others keep their order; the Customize panel lists the same order. No new pack key |
| Skills › Featured | a section **For your field · Law** above the categories: every skill of the pack once, the ticked goals' first, each with its goal as a tag. A skill from GitHub goes through the usual install confirmation; one the plugin ships is a plain copy (`installSkill`), shown as installed at once. Drawn as the same cards, or rows, as the picks below (whichever view the tab is on), with Details, Use / Install and the star; no cover and no audit of its own, no install count. Not drawn on a category or a search |
| Connectors › Discover | the same section above « Popular », with the same cards tagged by goal (an app shown there is not repeated below); not drawn on a search or a filter |
| Connectors › Yours | with nothing connected, one line naming the field's apps and a button to Discover |

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
| Page titles, Creations tiles | `kbDomainTitle`, `kbObTileSort` (one subscription in `KybersMain`) | **wired** |
| Skills and Connectors sections | `window.__KB_DOMAIN__` read by `kybernos-skills` and `kybernos-composio` | **wired** |
| Saved choice | `onboarding.json` | **wired** |
| Theme per field | theme presets (`theme-presets.json`, plain data). No public « apply a preset » call was found | next |
| « What do you want to see first » | order of the menu and the home | next |
| Dashboards | `*.miniapp.json` and `presets.mjs`. Sources are internal only; tiles fed by a connected app need a new source kind. Until then a dashboard shows samples marked as such | next |
| Connectors | suggested in the Connectors page (Discover section, Yours line); each needs the person's authorisation | **wired** (suggest only) |
| Page descriptions in the field's words, a nudge on Automations for the switched-off ones the kit made | the page's own sentence | next |
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
- `node packages/kybernos-skills/test-picks.mjs`, `node packages/kybernos-composio/test-connectors-ui.mjs`: the Skills and Connectors sections (source level).
- Live, sandbox only: `node scripts/check-onboarding-live.mjs` (tiles, miniature, sentence, goals, kit with a shipped skill and an automation, the
  saved choice, the menu wording on the real page, and the pages: titles in English and French, the Creations tiles, the Skills and Connectors sections
  with a shipped skill installed and a GitHub one stopped at its confirmation, no field = the pages as before).

## Open decisions

- Which fields ship first (nine here: education, health, real estate, law, finance, commerce, marketing, development, general).
- One field per profile or several at once.
- Packs by other authors: a pack is a **data plugin** of the point `kybernos/core#domain-pack` ([`plugin-contract.md`](plugin-contract.md), phase 2). Built: a package installed with DSH's own
  plugin manager (an npm name, a GitHub address, a tarball or a local directory) that holds a `plugin.json` and a `domains/` folder, and a patch that is an empty list, is read by
  `kybernos-registry`; each file goes through `validatePack`, and once the person has accepted the plugin (a pack carries prompts) its packs join the shipped ones in
  `GET /kybernos/domains` (marked `from`, ordered after ours, an id or a legacy job already taken is refused). A plugin pack cannot bundle skills yet.
- Who writes the content marked soon (teams): us, or the Marketplace community. A signed catalogue (like themes and local models) is the way to
  ship packs without a release; the files stay bundled until then.
- **Reading the site and the profile** (the « Understood » step: facts tagged Instruction or Memory, removable): not built. A public page reads easily; LinkedIn and Facebook often need a login, so a « paste a summary » fallback is planned. Today what was typed is stored and written into the person's memory as typed.
- **Enforcing the agents preset**: only the approval of each automation and the usage alert exist today; the rest of a preset is words the agents read until a Settings › Agent rules page can enforce them.
- **Prices on the plan screen**: none shown (the account's page has the validated ones).
