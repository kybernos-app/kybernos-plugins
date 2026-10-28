# Build a theme

> **The path is history.** This file is `docs/dev/sector-bundles.md` because that was the unit's name when
> the campaign opened; the unit it documents is now the **theme**. The rename batch owns any move of the file
> (its two head links must not break twice), so the path stays.

A **theme** is one folder with one `plugin.json` and several `extends` — the shape the strategy states and the
registry already reads: *one folder, one `plugin.json`, several `extends`*
(`docs/etudes/2026-10-27-sector-packs-strategy.md:55-56`). It ships **data only**: JSON, Markdown, and a
`package.json` that asks DSH to load nothing. Four words, used strictly below:

| Word | What it is |
|---|---|
| **theme** | the installable sector unit: one folder, one manifest, five kinds of contribution |
| **style** | the visual layer of a theme: a token overlay (`themes/<id>.json`), never CSS |
| **plugin** | a DSH code module (`packages/…`, a bundle with a patch that names modules) — not what you are writing |
| **kit** | what the first run offers to install: the goals a person ticks, and the templates a theme contributes |

Everything here is checked on a copy of the starter before it is installed anywhere, with one command:

```bash
node scripts/plugin-check.mjs <folder>
```

## Copy the starter, then read the report

The starter is `docs/dev/templates/acme-vet-clinic/`: eight files — five contributions and the three files that
carry them (manifest, package, README) — plus a `broken/` folder of deliberate faults (one per check id) to learn
from. Copy it, rename the manifest, run the
checker:

1. copy the folder and rename it to your own slug (the manifest's `id` must be `<author>/<name>`, and its
   `author.id` must be the namespace of `id`, `packages/kybernos-registry/manifest.mjs:49-63`);
2. change the five `extends[].dir` values only if you rename the folders, and make `requires.plugins` name
   every owner you extend (`packages/kybernos-registry/manifest.mjs:90-93`);
3. run `node scripts/plugin-check.mjs docs/dev/templates/acme-vet-clinic` and read the lines: the check ids
   are stable, the message after each one is the validator's own sentence.

The report is frozen in shape: a header, one `plugin:` line, the checks in their fixed order, the lines that
do not apply, and a summary. This is the starter's own report, byte for byte:

```
plugin-check v1 — docs/dev/templates/acme-vet-clinic
plugin: acme/vet-clinic 1.0.0 (data, 5 points, free)
  PASS  manifest.present    plugin.json found
  PASS  manifest.json       plugin.json is valid JSON
  PASS  manifest.schema     plugin.schema.json, subset interpreter: no fault
  PASS  manifest.rules      ids, reserved namespaces, version, claims: no fault
  PASS  manifest.points     extends 5 points, every one opened, ranges satisfied, requires.plugins covers their owners
  PASS  package.data        no dsh key, no install script, no bin
  PASS  point.domain-pack   domains/vet-clinic.json
  PASS  point.theme         themes/vet-clinic.json
  PASS  point.skill         skills/consult-notes
  PASS  point.team-template teams/clinic-desk.json
  PASS  point.automation-template automations/morning-reminders.json
  PASS  code.scan           no .js in the folder: nothing to declare
  PASS  hygiene             8 files, no media, no personal path
  SKIP  claims.unique       not applicable: a data theme declares no CSS prefix, route or slot
  SKIP  help.card           not a module of the Suite (no help key)
  SKIP  compat.zone         no requires.dsh in a data theme
  SKIP  archive             not built (phase B: signed archive and hashes)
  SKIP  broken/             not declared by extends; not part of the plugin
summary: 13 pass, 0 fail, 5 skip — exit 0
```

Exit `0` means no `FAIL`; exit `1` means at least one; exit `2` is the command line itself (no argument, two
arguments, a path that does not exist, a file). A `PASS` line is a fact about the folder, a `SKIP` line is a
check whose subject does not exist in a data theme and always says why, and a `FAIL` line carries the
validator's message verbatim.

| Check id | What it decides |
|---|---|
| `manifest.present`, `manifest.json` | `plugin.json` is there, and is JSON |
| `manifest.schema` | the shape: `scripts/schema-subset.mjs` reads `plugin.schema.json` |
| `manifest.rules` | what a schema cannot say: ids, reserved namespaces, points, permissions (`manifest.mjs:49-125`) |
| `manifest.points` | every extended point is opened by an owner, and the range accepts its version |
| `package.data` | a data package names nothing DSH would load or run (`registry.mjs:57-75`) |
| `point.<name>` | one line per `extends`, in manifest order: the owner's own validator |
| `code.scan` | the grep-level scan of any `.js` you ship, held to your `permissions` (`scripts/plugin-scan.mjs:57`, `:109`) |
| `claims.unique` | a CSS prefix, a route prefix, a slot id is claimed once |
| `help.card` | a module of the Suite names a help file that exists |
| `compat.zone` | a `requires.dsh` lies inside the zone of `dsh-compat.json` |
| `hygiene` | text only, no media, no personal path (`scripts/garde-depot.mjs:28-42`) |
| `archive` | not built (phase B) |

## Primitives first

The first build-contract rule, and the one that decides whether a theme is a theme or a fork:

> **Primitives first.** A feature is expressed with what exists: a **page** (an existing panel), a
> **dashboard** (a tile preset), a **listing** (cards for entities, list for tracking, calendar for dates —
> one view kind per datum), the **kit** (skills, teams, automations). A need that fits none of them is a
> platform-evolution request, written as such — never a custom screen smuggled into a pack.

That is the build-contract skill `contrat-pack-vertical`, rule 1, and
`docs/etudes/2026-10-27-sector-packs-strategy.md:86-90`. In a theme:

- **page** — you do not ship one. A page is an existing panel; a theme renames menu rows and puts new-chat
  templates first (`home`), nothing more.
- **dashboard** — a tile preset is a dashboards concern, not a theme's: you ship none. The
  `kybernos/dashboards#preset` point is **not built** (see "Not built").
- **listing** — you do not ship one either: the shapes a theme carries are data files, and the app draws
  them. One view kind per datum is the app's rule, not a theme's permission to invent a view.
- **kit** — the only surface a theme really fills: the goals of `domains/<id>.json` and, beside them, the
  templates of `skills/`, `teams/` and `automations/`.

A need that fits none of them → write a platform-evolution request; a custom screen in a theme is refused by
review, not by the tool, because the tool checks data, not intent.

## Custom UI lives in Settings

The second rule: *what the primitives cannot cover becomes a configuration screen: bounded fields, data only,
no journey logic* — the Customizer rule, the back office configures and the primitives display
(`docs/etudes/2026-10-27-sector-packs-strategy.md:91-93`).

A theme therefore ships **no interface at all**: no HTML, no JavaScript (the checker's `code.scan` prints "no
.js in the folder: nothing to declare"), no CSS. What a sector needs configured — its fields, its thresholds,
its wording — belongs to the settings surface of the module that owns it, with bounded fields and data only.
A theme may *propose* values in its JSON; it never draws a control.

## The style layer is a token overlay

**One data hex per sector, no free CSS** (`docs/etudes/2026-10-27-sector-packs-strategy.md:94`, and rule 1 of
the same block at `:102-108`). A style is a bag of known settings, checked in and out: the vocabulary is
`SETTINGS_KEYS` (`packages/kybernos-theme/preset-store.mjs:50`) and the validator is `sanitizePreset`
(`packages/kybernos-theme/preset-store.mjs:99`), which accepts the light shape and **drops every key it does
not know** — a catalogue-style entry (`description`, `license`, `v`) loses that data silently instead of
failing. That is why a theme's style file is exactly three keys:

```json
{
  "id": "vet-clinic",
  "name": "Vet clinic",
  "settings": { "acc": "#7C5CBF", "radius": 10, "mode": "light" }
}
```

- No CSS, no stylesheet, no selector: a style is tokens, and the app composes them.
- No fetched font, no remote image: `fontText` is a token the browser resolves against its own table, and
  nothing in a theme is fetched.
- Accessibility settings (`contrastMode`, `cbSafe`, `reduceMotion`, `focusRing`, `largeTargets`,
  `underlineLinks`) are refused, not trimmed: they are the person's, not a publisher's
  (`packages/kybernos-theme/preset-store.mjs:44`).
- The person keeps the last word: the field's `accent`/`icon` override the preset's accent, and
  "Settings › Style always wins over the pack (the theme is the person's; the pack proposes)"
  (`docs/etudes/2026-10-27-sector-packs-strategy.md:107-110`; the page is titled *Theme* in English).

The word **token overlay** is the build contract's own (`:94`), where "theme" still named the style layer;
this page keeps the new name and the old word apart on purpose.

## Cited or labelled

The fourth rule: **every displayed datum is cited to the theme file or explicitly marked as a proposal**
(`docs/etudes/2026-10-27-sector-packs-strategy.md:95-96`). The two sector accents of this campaign are the
worked example:

| Sector | Accent | Where it comes from | Status |
|---|---|---|---|
| IT recruitment | `#4F5BD5` | `docs/handoff/theme-recrutement-ssii/maquette-v1/maquette.html:23` | cited, and still **PROPOSAL** — the mockup is a design reference, not a decision |
| Medical practice | `#1B7F76` | `docs/handoff/theme-medecin/maquette-v1/maquette.html:23` | cited, and still **PROPOSAL** |

In the starter, the accent `#7C5CBF` is a proposal too: `acme` is a fictional author and every sentence is
sample data (`docs/dev/templates/acme-vet-clinic/README.md`). A real theme replaces every text with the
clinic's own words and cites the file behind each fact; where it cannot cite, it writes "proposal" and says
whose decision it waits on.

## The five frozen interfaces

A theme contributes to five **points** — the extensible slots of the plugin contract
(`docs/dev/plugin-contract.md:263-274`). The table is keyed by the point ids, because that is what
`plugin.json` says and what the checker resolves:

| Point | What you ship | Validator the tool runs |
|---|---|---|
| `kybernos/core#domain-pack` | `domains/<id>.json` — the field, its goals, its kit (menu wording, home order) | `validatePack`, `packages/kybernos-plugin/domain-pack.mjs:79` |
| `kybernos/theme#theme` | `themes/<id>.json` — the style layer: `{ id, name, settings }` | `validateTheme` → `sanitizePreset`, `packages/kybernos-theme/themes-catalogue.mjs:75` and `preset-store.mjs:99` |
| `kybernos/skills#skill` | `skills/<name>/` — one folder per skill, `SKILL.md` inside (a folder point: the folder is kept whole or refused whole) | `validateTeamSkill`, `packages/kybernos-skills/team-skills.mjs:188` |
| `kybernos/core#team-template` | `teams/<id>.json` — roles and stages of an Agent Team | `validateTeamTemplate`, `packages/kybernos-plugin/domain-pack.mjs:283` |
| `kybernos/core#automation-template` | `automations/<id>.json` — steps, guard and a five-field cron | `validateAutomationTemplate`, `packages/kybernos-plugin/domain-pack.mjs:315` |

The six other points of the contract's table are not a theme's business: `kybernos/dashboards#preset` is not
built, the two dashboards source points are for later, and `kybernos/language#pack`,
`kybernos/modeles-locaux#model` belong to their own catalogues.

## One complete `plugin.json`

Five `extends`, one `dir` each, and `requires.plugins` naming **every** owner it extends — the rule a schema
cannot state (`packages/kybernos-registry/manifest.mjs:90-93`). This is the starter's manifest, its `name` and
`description` cut to one language for the page (the file carries `en` and `fr`); exactly as printed here, it is
accepted by the repository's own validator with an outsider's context, and a unit test keeps it that way:

```json
{
  "contract": 1,
  "id": "acme/vet-clinic",
  "kind": "data",
  "version": "1.0.0",
  "name": { "en": "Veterinary clinic" },
  "description": { "en": "A theme for veterinary clinics: two goals, a style, one skill, one team and one morning reminder. Sample data for the fictional author acme." },
  "author": { "id": "acme", "name": "Acme Software" },
  "license": "CC-BY-4.0",
  "pricing": "free",
  "requires": { "kybernos": "^0.1", "plugins": { "kybernos/core": "^1.0", "kybernos/theme": "^1.0", "kybernos/skills": "^1.0" } },
  "extends": [
    { "point": "kybernos/core#domain-pack", "range": "^1.0", "dir": "domains" },
    { "point": "kybernos/theme#theme", "range": "^1.0", "dir": "themes" },
    { "point": "kybernos/skills#skill", "range": "^1.0", "dir": "skills" },
    { "point": "kybernos/core#team-template", "range": "^1.0", "dir": "teams" },
    { "point": "kybernos/core#automation-template", "range": "^1.0", "dir": "automations" }
  ]
}
```

There is no `provides`: a theme contributes, it does not open a point. There is no `dsh` key in its
`package.json` either, and that is the point: a data theme has nothing for DSH to load, so it needs no patch
file, and `dataPackageProblems` accepts a `package.json` with no `dsh` key at all
(`packages/kybernos-registry/registry.mjs:57-75`). The four-file shape the plugin-creator skill shows for a
data plugin carries an **empty** patch instead; both are valid, and the starter shows the smallest true thing.

## The starter, file by file

| File | Why it is there |
|---|---|
| `plugin.json` | the manifest above |
| `package.json` | `name`, `version`, `description`, `license` — no `dsh`, no `scripts`, no `bin` |
| `domains/vet-clinic.json` | two goals, their kit, the menu words, the agents preset |
| `themes/vet-clinic.json` | the style layer: one accent, a radius, a mode |
| `skills/consult-notes/SKILL.md` | one skill that drafts and never sends, and quotes the file it was given |
| `teams/clinic-desk.json` | a three-role team: read, draft, check |
| `automations/morning-reminders.json` | a weekday reminder that prepares drafts and sends nothing |
| `README.md` | the label itself: sample data, fictional author, every sentence a proposal |

## The broken variants

`broken/` holds one folder per check id. Each is a complete theme folder with exactly one seeded fault, and
the checker fails it on exactly that id — a variant is the lesson, the id is the answer:

| Variant (`broken/…`) | Seeded fault | Check id that must fail |
|---|---|---|
| `01-not-json/` | `plugin.json` is not valid JSON | `manifest.json` |
| `02-no-description/` | `description` missing | `manifest.schema` |
| `03-extends-without-requires/` | extends `kybernos/theme#theme`, `requires.plugins` omits it | `manifest.rules` |
| `04-unknown-point/` | extends `kybernos/core#nope` (owner required, point unopened) | `manifest.points` |
| `05-domain-pack-unknown-key/` | `domains/clinic.json` carries a key `validatePack` does not know | `point.domain-pack` |
| `06-theme-bad-accent/` | `themes/x.json` sets `acc: "blue"` | `point.theme` |
| `07-package-loads-code/` | `package.json` gains `scripts.postinstall` | `package.data` |

`docs/dev/templates/acme-vet-clinic/broken/` is not a contribution: the checker names it in one `SKIP` line
(`not declared by extends; not part of the plugin`), never silently, never as a failure.

## Install and preview

Two doors, and a theme needs no third:

- **Local development first.** Install the folder as a `link:` or `file:` dependency with DSH's own plugin
  manager; the registry reads what DSH installed and calls it **Local**, anything DSH fetched **Unlisted**
  (`docs/dev/plugin-contract.md:550`). It reads `<DSH home>/profiles/web/package.json` and
  `node_modules/<name>/plugin.json` (`packages/kybernos-registry/host.mjs:32`), never a folder of its own
  (`docs/dev/plugin-contract.md:603`).
- **Acceptance is the person's.** A theme contributes instruction data — skills, prompts, packs — so the
  registry lists it `needs-consent` until the person has read and accepted it; a style alone is inert data
  and needs none (`docs/dev/plugin-contract.md:552`).
- **Nothing installs un-ticked.** The kit installs the goals the person ticks and nothing else
  (`docs/dev/domain-packs.md:17`), and the automations a theme contributes are created **switched off**: the
  template is a draft, its steps say so, and its guard repeats it.

Then open the wizard, find the field tile marked with the theme's `from`, tick one goal, and check the
theme's own page: the style, the goal, the skill. Do the same in Settings › Theme, and let the person win —
the preset applied by the app is theirs from then on.

## Not built

Said plainly, because a page that overstates is worse than a page that is short:

- **Archives and signatures** — the contract promised `<folder | archive>`; only the folder exists. Phase B
  adds the signed archive, the per-file hashes and the catalogue; the checker prints
  `SKIP archive  not built (phase B: signed archive and hashes)` and the contract's conformance table says the
  same (`docs/dev/plugin-contract.md:484-500`).
- **`kybernos/dashboards#preset`** — no contribution path exists; the row says **not built**
  (`docs/dev/plugin-contract.md:266`) and no theme can target it.
- **The wizard's Kit step for contributed templates** — the route serves a pack's `kit` (its `teams/`,
  `automations/`, `skills/` and `themes/`), and the wizard's kit draws the goals a pack declares; the step
  that installs from `pack.kit` is a platform-evolution request, not a theme's decision.
- **The wizard applying a theme's preset** — the seam is built (`applyPreset`,
  `packages/kybernos-theme/preset-store.mjs:200`, and its browser door), the step that calls it at the Kit
  step belongs to the wizard batch. Until then the style is applied from Settings › Theme.
- **A secret-looking file name** — `scripts/garde-depot.mjs` keeps that rule private (`:12`), so the checker's
  `hygiene` pass sees media, unreadable files, personal paths and mail addresses, not a file named `codes.json`.
  A one-line export in that file would close it; the file is not this batch's to edit.

A green report is **necessary for every level and sufficient for none**
(`docs/dev/plugin-contract.md:500`): it proves a folder is well-formed data, not that its content is good, and
nothing here replaces a person reading the themes and the prompts.
