# Domain packs: Kybernos set up by field of work and by goal

A **domain pack** is one JSON file per field of work (Education, Health, Real estate, Law…). It does not run anything. It names what
Kybernos already knows how to do (skills, agent teams, menu wording) and groups it under the **goals** a person can tick. The wizard
reads the pack, the person picks a domain and some goals, and the plan is applied through the routes that exist today.

```
pack JSON (data) ──▶ host validates ──▶ GET /kybernos/domains ──▶ wizard: domain, goals, kit ──▶ existing routes
                                                              └──▶ menu overlay (labels) read at boot
```

Design study and mockups: private artifacts of 2026-10-21 (v1 by domain, v2 by goals and by team), archived outside git.

## Why goals, not only a domain

Two people in the same field want different things (a physio who wants fewer missed appointments, a clinic that wants faster
notes). The domain sets the vocabulary and the defaults; **the goals decide what is installed**. Nothing is installed for a goal
that is not ticked.

## What a pack contains

`packages/kybernos-plugin/domains/<id>.json`, checked by `domain-pack.mjs` (known keys only, bounded sizes, plain values; an invalid
file is skipped and logged, it never stops the host).

| Field | Meaning |
|---|---|
| `v` | format version, `1` |
| `id` | `^[a-z][a-z0-9-]{1,23}$`, the file name without `.json` |
| `order` | optional integer 1 to 99 (default 50): the order the fields are listed in, then the id. The catch-all pack is 99 |
| `name`, `tagline` | texts: `{ "en": "…", "fr": "…" }`, `en` required, other languages fall back to `en` |
| `legacyJobs` | ids the old 12-profession step stored (`soft`, `etudes`…): a saved `profil` of that id reads as this domain |
| `menu.labels` | rename our menu rows: `{ "<row id>": text }`. Row ids are those of the sidebar menu: `kyber dashboards aiteams projects deliverables tasks skills connectors documents` |
| `menu.hide` | rows to hide, only from the hideable list (`documents`) |
| `goals[]` | `id`, `name` (short), `title`, `desc`, `skills`, `teams`, `soon`, `starter` |
| `goals[].skills` | `{ source, name, d }`: `source` is `owner/repo`, `name` the skill folder, `d` its one-line description as a text. Installed through `/kybernos-skills/install`, which refuses a pair that does not exist |
| `goals[].teams` | ids of the Agent Teams of the marketplace (`studencik`, `research-desk`, `inbound-closer`), created through `kybers/create` |
| `goals[].soon` | names (texts) of things planned and not installable yet: listed greyed, never installed |
| `goals[].starter` | a first question, kept for the home page (not used by the first wiring) |

A pack never contains code, a URL to fetch, a key or a number about the person.

## What applying a pack does

The wizard's steps become: welcome, **domain**, **goals**, display mode, model, **kit**. The kit is the union of the skills and teams of
the ticked goals, with the same screen as before (everything ticked unless installed, nothing runs by itself).

Switching to another domain later (Settings, Starter kit) follows three rules:

1. **Replaces**: the menu wording and the saved domain and goals. Reversible, nothing is lost.
2. **Adds only**: skills and teams. They are never removed by a switch; what is installed is not ticked again.
3. **Never touches**: sessions, memory, workspaces, anything the person created or changed.

The saved choice is `profil` (the domain id) and `goals` in `~/.dsh/kybernos/onboarding.json` (the version stays `1`: older files
read the new fields as empty). `POST /kybernos/onboarding {action:"domain", profil, goals}` records a choice without finishing the
wizard (used by Settings and by the end of the wizard).

## Seams, and what is wired

| Part of a pack | Seam | First wiring |
|---|---|---|
| Domain, goals, kit | wizard (`KB-OB`), `/kybernos-skills/install`, `kybers/create` | **wired** |
| Menu wording, hidden rows | `SalesMenu` rows of `kybernos-plugin/client.js` (our own component, no engine patch) | **wired** (labels, `documents`) |
| Saved choice | `onboarding.json` | **wired** |
| Theme per domain | theme presets (`theme-presets.json`, plain data). No public "apply a preset" call was found | next |
| Home order ("what do you want to see first") | `KbNewChatCards`, `SalesMenu` order | next |
| Dashboards | `*.miniapp.json` files and `presets.mjs` | next. Sources are internal only; tiles fed by a connected app need a new source kind. Until then a dashboard shows samples marked as such |
| Connectors | suggested in the Connectors page; each needs the person's authorisation | next (suggest only) |
| Automations | the Discover templates (`KB-AUTOTPL`), created OFF | next |
| Per team | see below | next |

## Per team (not wired yet)

Creating an Agent Team should run a short onboarding of its own: purpose and goals, colour and icon, the indicators to watch, the apps it
may read, then a page that says what is inherited from the domain and what is the team's own. The workspace store already holds
the name, icon, colour, description, selected skills (`/kybernos/workspace-skills`) and instructions. Still to create: the team's goals,
its dashboard, the automations suggested for it. Limiting an app to one calendar or folder for a team is not studied: connections belong to
the account.

## Safety

- A pack is data, bounded (12 goals, 8 skills per goal, 160 characters per text), and checked on load; a bad file is skipped.
- The route that serves packs is a GET of public data (`no-store`). The one that records a choice follows the onboarding route's rule
  (strict same origin).
- Nothing is installed without the person ticking it; automations, when they arrive, are created off.
- Health and law should recommend a local model (the way to keep content on the computer), never force it. A `privacy` text in the pack is
  the planned seam; it is not in the first wiring.

## Tests

- `node packages/kybernos-plugin/test-domain-pack.mjs`: format, limits, every skill pair is one the starter kit verified, every team exists
  in the marketplace, every legacy job maps to one domain, the kit of a set of goals.
- `node packages/kybernos-plugin/test-onboarding-state.mjs`: the new fields, an older file still reads as done.
- `node scripts/test-onboarding.mjs`: the wizard's pure core (steps, kit from goals, memory sentence, menu overlay).
- Live, sandbox only: `node scripts/check-onboarding-live.mjs` (domain, goals, kit, the saved choice, the menu wording on the real page).

## Open decisions

- Which domains ship first (nine here: education, health, real estate, law, finance, commerce, marketing, development, general).
- One domain per profile or several at once.
- Who writes the content marked soon: us, or the Marketplace community. A signed catalogue (like themes and local models) is the way
  to ship packs without a release; the files stay bundled until then.
