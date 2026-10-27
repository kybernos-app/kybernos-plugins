# Sector packs: a theme + plugin strategy for sector setups

Status: **strategy proposal, 2026-10-27**. It changes neither `docs/dev/plugin-contract.md`
(draft v0) nor `docs/dev/domain-packs.md`; it reads them as the two halves of one WordPress-like
system and sequences the missing pieces around a single user-visible concept: the **sector pack** (one installable unit per field of work).

> **Naming (2026-10-27, owner decision).** « plugin » is reserved for DSH plugins (code modules
> installed in the engine) and « bundle » for DSH's install unit. The sector unit is a **sector
> pack** (*pack secteur*): one installable unit per field of work, composing a **theme** (token
> overlay), a **domain pack** (the field JSON) and a **kit** (skills, teams, automations).
> Technically it travels in the plugin contract's *data-plugin* format — the format's name is not
> the product's name.

## 1. The question, and the one-line answer

Onboarding asks the field of work and already shapes the UX (menu words, home order, page titles,
kit). What is missing is (a) a **theme system**: nothing makes a sector arrive as a look, and
(b) a **plugin system** other developers can ship sector units through.

The answer is not a new subsystem. A sector arrives as a **data plugin that extends the points
that already exist** (domain pack, theme, skills, team and automation templates, dashboard
presets), plus two small missing seams (apply a theme preset, bundle skills in a plugin) and one
composer in the wizard. WordPress's three objects map cleanly onto ours:

| WordPress | Kybernos today | State |
|---|---|---|
| Theme | `kybernos-theme`: token overlay presets (`mode`, `acc`, `ov`, `fontText`, `radius`… 40+ keys), a personal library (`theme-presets.json`), a gallery, a signed themes catalogue | **built**; per-field preset not applied by the wizard |
| Plugin | `plugin-contract.md`: `plugin.json` ×42, `kybernos/registry` (socle), points `provides`/`extends`, `validatePack` | **built** (contract phases 1–2) |
| Starter content (pages, menus, sample data) | domain packs: goals → skills, teams, automations, menu wording, home order, page tiles | **built** and wired to onboarding |
| Hooks / filters | extension points (data and code), 38 `window.__KB_*__` seams to convert to `__KB__` | first point opened (`kybernos/core#domain-pack`) |
| Plugin directory + reviews | signed multi-source catalogue, trust levels, `plugin-check.mjs` | contract phase 3, **not built** |
| Premium plugins | `commerce.model: key | account`, `worksWithout` mandatory | contract phase 8/5, **not built** |

So the ecosystem does not need inventing: it needs **one composition unit** (section 3), **the
theme seam wired to the field** (section 4), and **the delivery pipe for other authors**
(sections 5–6).

## 2. Why the sector pack is the right unit

Two people in the same sector want the same three things at once: a look, a vocabulary, and the
features their goals imply. Selling or installing those three separately is the mistake. The
bundle is the *product* wrapper (« Kybernos for veterinary clinics ») on top of the *contract*
(the points). WordPress won on the contract; the starter-site packs (Flavor etc.) are what made
it a business.

A bundle is **data only in v1** (`kind: "data"`): sector content is 95 % text and tokens, and the
contract's decision 1 (no third-party code in v1) holds. A custom page or a custom source waits
for phase 4 / declarative sources (contract 6.4).

## 3. The concept

One folder, one `plugin.json`, several `extends` — the registry already reads what plugins
contribute (the domain-pack point opened 2026-10-21):

```json
{
  "contract": 1, "id": "acme/vet-clinic", "kind": "data", "version": "1.0.0",
  "name": { "en": "Veterinary clinic", "fr": "Clinique vétérinaire" },
  "author": { "id": "acme", "name": "Acme Software" },
  "license": "CC-BY-4.0", "pricing": "free",
  "requires": { "kybernos": "^0.1", "plugins": { "kybernos/core": "^1.0", "kybernos/theme": "^1.0" } },
  "extends": [
    { "point": "kybernos/core#domain-pack",        "range": "^1.0", "dir": "domains" },
    { "point": "kybernos/theme#theme",             "range": "^1.0", "dir": "themes" },
    { "point": "kybernos/skills#skill",            "range": "^1.0", "dir": "skills" },
    { "point": "kybernos/core#team-template",      "range": "^1.0", "dir": "teams" },
    { "point": "kybernos/core#automation-template","range": "^1.0", "dir": "automations" },
    { "point": "kybernos/dashboards#preset",       "range": "^1.0", "dir": "dashboards" }
  ]
}
```

What the install does (all existing routes): the pack joins `GET /kybernos/domains` marked
`from: 'acme/vet-clinic'`, the wizard offers the field, the kit installs only what the person
ticks, the theme preset is **proposed** at the Kit step. A bundle that adds nothing new to the
contract is the point: it proves the contract.

### The build contract (skill `contrat-pack-vertical`)

Every pack is built and reviewed under the contract skill of the same name — WordPress's
discipline (templates and hooks, never core edits) made testable:

1. **Primitives first.** A feature is expressed with what exists: a **page** (an existing panel),
   a **dashboard** (a tile preset), a **listing** (cards for entities, list for tracking, calendar
   for dates — one view kind per datum), the **kit** (skills, teams, automations). A need that fits
   none of them is a platform-evolution request, written as such — never a custom screen smuggled
   into a pack.
2. **Custom UI lives in Settings.** What the primitives cannot cover becomes a configuration
   screen: bounded fields, data only, no journey logic. The Customizer rule: the back office
   configures, the primitives display.
3. **A theme is a token overlay** (accent, font, radii) — one data hex per sector, no free CSS.
4. **Cited or labelled.** Every displayed datum is cited to the pack file or explicitly marked
   « proposal » — never invented (the rule that kept the recruitment mockup honest).

## 4. The theme layer (the missing « theme system »)

Three rules, in order of importance:

1. **A theme is a token overlay, never CSS.** `preset-store.mjs` already defines the vocabulary
   (40+ keys, bounded, validated in and out) and the personal library. Third-party themes are the
   same shape — inert data at `kybernos/theme#theme`, shipped through the signed themes catalogue
   whose key list is empty today (contract 6.2). No arbitrary CSS, no fonts fetched from a URL, no
   layout forks: that is what keeps themes safe, testable and composable.
2. **Composition: base theme + sector accent (a child theme, minus the fork).** The field's
   `accent`/`icon` override the preset's accent; the person keeps the last word — Settings › Theme
   always wins over the pack (the theme is the person's; the pack proposes). Onboarding applies
   the preset at the Kit step and shows it in the live miniature before confirming.
3. **One public « apply preset » seam.** This is the single wire the domain-pack doc marks « next »
   (« theme per field: no public apply-a-preset call was found »). It is the wizard reading a
   preset from the pack and calling the same store the Sharing tab uses. Small, and it completes
   the whole onboarding → look story.

## 5. Distribution: from signed catalogue to marketplace

Aligned with contract phases 2→3→5; nothing new to design, only to sequence:

| Stage | Who ships | How it installs | Trust shown |
|---|---|---|---|
| **A — internal** | us | repo folder or a local data plugin (`link:`) | Official / Local development |
| **B — catalogue** | pilot authors | signed archive from a signed multi-source catalogue (`pluginCatalogues`) | Community (warning) / Verified (per version, countersigned) |
| **C — marketplace** | anyone, paid | same, plus `commerce.model: key` (vendor's key) or `account` (ours, phase 5) | same, plus the `worksWithout` line on the card |

The developer funnel, one page of docs and one command: **scaffold → `plugin-check.mjs` → submit
to the official catalogue (review) → listed**. `plugin-check.mjs` is the conformance tool of
contract section 11; its parts (`plugin-manifest.mjs`, `plugin-scan.mjs`, the schema subset)
already exist. A green report is necessary for every level and sufficient for none — the card
says the level, never more.

## 6. Developer experience (why other devs would come)

- **A complete starter**: the `acme/vet-clinic` example as a template repo — `plugin.json`,
  `domains/`, `themes/`, `skills/`, `teams/`, `automations/`, and the broken variants to learn
  the validator. One worked example beats an SDK.
- **No SDK in v1**: a data plugin is JSON and Markdown. The barrier to entry *is* the strategy.
- **Local preview today**: a dev installs their folder as « local development » and their field
  shows up in the wizard tiles (the `from` marking is already wired and tested).
- **The checklist is public**: what a review is (contract 9.2) is written before we ask anyone to
  submit, so « Verified » means something on day one.
- **Namespaces are registered** (`author/name`, reserved `kybernos`/`dsh`/`local`) so two packs
  called `vet` can coexist and nobody squats the trademark.

## 7. What we deliberately do not build

- **No arbitrary CSS/HTML themes** (tokens only) — the safety and upgrade story collapses otherwise.
- **No third-party code plugins in v1** (contract decision 1) — data covers the sector use case;
  code is phase 4 behind a review pipeline.
- **No per-sector fork of the core** — the app stays one codebase; a sector changes data, never
  code. (This is the line between WordPress themes and the old « skins as forks » trap.)
- **No marketplace before the catalogue works** — commerce (phase 5) is last on purpose.
- **One active theme per profile** — no theme-per-chat micro-management.

## 8. Roadmap and gates

**Phase A — compose and prove (internal).**
1. Wire the theme seam: the wizard's Kit step applies the pack's preset through the existing
   preset store (the « apply a preset » call of domain-packs.md).
2. Multi-point data plugins: let a plugin's `themes/`, `skills/`, `teams/`, `automations/` folders
   be read like `domains/` already is (registry folder scan, per-point validators).
3. Ship two verticals end to end — **Health and Law** (their packs are the most complete) — as
   `kybernos/*` bundles: theme preset + pack + kit, on the real wizard.
4. Publish the starter template and the « Build a sector pack » page.
   *Gate:* a fresh profile that picks Health lands on its theme, its menu words and its kit; a
   broken bundle is a line in a list and never stops DSH (existing fault test).

**Phase B — open the door (catalogue).**
1. One catalogue format + `pluginCatalogues` (contract 10), install/update/remove for data.
2. `plugin-check.mjs` published as the dev's one command.
3. One external pilot (the vet-clinic bundle, written by someone who is not us).
   *Gate:* a third-party bundle installs from the catalogue, passes the conformance tool, shows
   Community on its card, and a yanked version stops being offered without breaking installs.

**Phase C — commerce (contract phase 5).** `commerce.model: key` first (vendor's server, no money
through us), marketplace (seller of record) only with counsel.

## 9. Success criteria

| Signal | Where it is measured |
|---|---|
| % of new profiles that pick a field, and keep its theme 7 days later | `onboarding.json` + the theme store |
| Time from scaffold to « listed » for a data bundle (target: under a day) | pilot author feedback |
| Third-party bundles passing `plugin-check` | the conformance report |
| Zero boot failures caused by bundles | the existing bundle-faults gate |
| % of the kit actually used after 30 days (the goals story) | skills/automations state |

## 10. Open questions for the owner

1. Which two verticals ship first (Health + Law is the proposal; the nine packs exist)?
2. How far the theme vocabulary goes: accent and typography today; covers, icon sets, chat bubble
   styling already sit in `SETTINGS_KEYS` — do we advertise all of it to pack authors?
3. One field per profile or several (already open in domain-packs.md).
4. Who reviews external bundles in phase B (capacity decides the pace of « Verified »).
5. Namespace policy for the official catalogue (first-come) — worth a trademark-aware rule.
