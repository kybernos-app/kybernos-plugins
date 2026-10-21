---
name: plugin-creator
description: Prepares a Kybernos plugin from the conversation, as a draft the person installs from the Plugins page. A plugin made here is plain data, a domain pack that gives the onboarding a new field of work (a name, a tagline, goals, the skills and agent teams that already exist). Asks which field and what the person wants in it, writes the draft folder, and says how to install it. Use when the user wants to create or build a plugin, or to adapt Kybernos to a trade or a way of working that is not in the list.
whenToUse: The user asks for a new plugin, a plugin for their trade or field, or "create with AI" on the Plugins page; or sends back a draft that the Plugins page found faults in.
---

# Plugin creator

You prepare ONE plugin per conversation, for real: a short interview, a draft the person
approves, then a folder written to disk. Never a mock-up, never invented skills. Talk to the
user in their own language. Everything below is written in English because it is read by you.

## What you can make, and what you cannot

A plugin made here is **data**: a JSON file that adds one field of work to the setup wizard
(Education, Health, Real estate… yours would be one more tile). It runs nothing, fetches
nothing, and DSH loads no code for it. That is the whole point: the person can install it
without trusting you, because there is nothing to execute.

You cannot make a plugin that adds a page, a button, a tool or a server route: that needs code,
and code is written by a developer, not by this skill. If the person asks for one, say so in
one sentence, offer the closest thing a pack can do (a field with the right skills, teams and
first questions), and ask whether they want that.

## 1. The interview

Ask at most four short questions, one message each, and skip any the user already answered:

1. **The field.** What trade or way of working is it for? (a name, and one line to describe it)
2. **The goals.** What do they want Kybernos to help with there? Two to five goals, each in a few
   words ("answer clients faster", "keep my stock right"). Each goal will group some skills.
3. **The skills and teams.** Propose from the lists in section 3 only, the ones that fit each goal,
   and ask which to keep. If nothing in the lists fits a goal, say so and keep the goal with a `soon`
   line instead of inventing a skill.
4. **The languages.** English is required. Add French (or another of `fr es ar`) when the user writes
   in it.

Do not ask about colours, icons or ordering: choose them yourself (section 2).

## 2. The draft

Pick a short lower-case name for the plugin, letters, digits and hyphens: `vet-clinic`. The draft
folder is `<DSH home>/kybernos/plugin-drafts/<name>/`, where the DSH home is `$DSH_HOME` (trimmed,
`~` expanded) or `~/.dsh` when that is not set. Show the user the pack in plain words (field, tagline,
goals with their skills) and wait for a clear yes before you write anything.

Four files, no more. Do not add scripts, a `bin`, a `main`, any other `dsh` key, or any file that is not
JSON or YAML: the Plugins page refuses a folder that does.

`package.json`:

```json
{
  "name": "kybernos-plugin-vet-clinic",
  "version": "0.1.0",
  "description": "A field of work for the Kybernos setup wizard: veterinary clinics.",
  "license": "MIT",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

`cordis.patch.yml` (an empty list: this is what tells DSH to load no code):

```yaml
# A data plugin: no entry names a module, so no JavaScript is ever loaded.
[]
```

`plugin.json`:

```json
{
  "contract": 1,
  "id": "local/vet-clinic",
  "kind": "data",
  "version": "0.1.0",
  "name": { "en": "Veterinary clinic", "fr": "Clinique vétérinaire" },
  "description": { "en": "Adds a veterinary clinic field to the setup wizard.", "fr": "Ajoute un domaine clinique vétérinaire à l’assistant de démarrage." },
  "author": { "id": "local", "name": "Me" },
  "license": "MIT",
  "pricing": "free",
  "requires": { "kybernos": ">=0.1.0", "plugins": { "kybernos/core": "^1.0" } },
  "extends": [{ "point": "kybernos/core#domain-pack", "range": "^1.0", "dir": "domains" }]
}
```

`id` is always `local/<name>` (the `local` namespace is the one for a folder made on this computer).
`description` is at most 240 characters. `author.name` is the person's name, or "Me" when they gave none.

`domains/<id>.json`, where `<id>` is the pack's id (`^[a-z][a-z0-9-]{1,23}$`) and the file name is that id
plus `.json`. Known keys only; anything else makes the pack refused:

```json
{
  "v": 1,
  "id": "vet",
  "order": 60,
  "accent": "#1F8A70",
  "icon": "heart",
  "name": { "en": "Veterinary clinic", "fr": "Clinique vétérinaire" },
  "tagline": { "en": "Vets, nurses, receptionists", "fr": "Vétérinaires, auxiliaires, accueil" },
  "keywords": ["veterinaire", "vet", "clinique", "animal", "chien", "chat"],
  "goals": [
    {
      "id": "reminders",
      "name": { "en": "Reminders", "fr": "Rappels" },
      "title": { "en": "Fewer missed appointments", "fr": "Moins de rendez-vous manqués" },
      "desc": { "en": "Drafts a reminder for tomorrow's appointments.", "fr": "Prépare un rappel pour les rendez-vous de demain." },
      "skills": [{ "source": "anthropics/skills", "name": "docx", "d": { "en": "Letters and forms as Word files", "fr": "Courriers et formulaires en Word" } }],
      "teams": [],
      "connectors": ["googlecalendar"],
      "starter": { "en": "Which appointments are tomorrow?", "fr": "Quels sont les rendez-vous de demain ?" }
    }
  ]
}
```

The rules, all checked when the plugin is read:

- `order` is 50 to 98 for a plugin (a lower or higher number is held inside that range). `accent` is `#rrggbb`.
  `icon` is one of `cap heart house scales trend bag mega code wand`. Pick the icon and a calm accent yourself.
- Every text is `{ "en": "…", "fr": "…" }`: `en` required, 160 characters at most, no `<` or `>`. A goal's
  `desc` and a skill's `d` are texts too.
- `keywords`: up to 40 lower-case words without accents, each at most 24 characters. They point a sentence
  such as "I run a vet clinic" to this field. Give 6 to 12, in the languages the user writes.
- `goals`: 1 to 12. Each needs an `id` (`^[a-z][a-z0-9-]{1,23}$`, unique in the pack), `name`, `title`, `desc`, and
  at least one of `skills`, `teams`, `automations`, `soon`. A goal with only `soon` is fine and honest.
- `skills`: up to 8 per goal, each `{ source, name, d }`. `source` is a GitHub `owner/repo`, or `kybernos` for
  the skills Kybernos ships. Use only the pairs of section 3.
- `teams`: up to 3 per goal, ids from section 3. `connectors`: up to 4 app slugs from section 3; they are
  suggestions, the person connects each one themself.
- `soon`: up to 4 texts naming what is planned and not available yet. Use it for anything you cannot back with a
  real skill, so the goal stays truthful.
- You may leave out `home`, `legacyJobs`, `menu`, `mode`, `agents`, `automations`. Do not add `automations`
  unless the user asks for a scheduled task; their `cron` is five fields and their text must say that it drafts
  and never sends.

Never put a URL, a key, a password, a person's name, an address, a price or any number about the person in
the pack. Never write outside the draft folder.

## 3. What exists (use only this)

Skills, as `source` + `name`:

- `anthropics/skills`: docx, pdf, pptx, xlsx, frontend-design, webapp-testing
- `anthropics/knowledge-work-plugins`: brand-voice-enforcement, campaign-plan, code-review, compliance-check,
  content-creation, design-critique, draft-outreach, financial-statements, incident-response, reconciliation,
  review-contract, roadmap-update, seo-audit, sprint-planning, sql-queries, statistical-analysis,
  testing-strategy, ticket-triage, user-research, ux-copy, variance-analysis, write-spec
- `anthropics/claude-for-legal`: flashcards, study-plan
- `kybernos`: case-law-watch, consult-notes, deadline-check, invoice-reminders, listing-writer,
  literature-watch, patient-reminders, property-valuation, quiz-builder, rent-reminders, stock-check

Agent teams: `studencik` (study help), `research-desk` (research and sources), `inbound-closer` (answers and
follows up inbound leads).

Connector slugs: ahrefs, airtable, calendly, canva, docusign, dropbox, facebook, figma, freshdesk, github,
gitlab, gmail, googlecalendar, googledocs, googledrive, googlesheets, gorgias, hubspot, instagram, jira,
klaviyo, linear, linkedin, mailchimp, notion, outlook, pipedrive, quickbooks, shopify, slack, snowflake, stripe,
supabase, whatsapp, zendesk.

A `kybernos` skill is one Kybernos ships for a specific field; use it only for the goal it was made for
(`rent-reminders` for renting, not for a clinic). If a skill or team is not in these lists, it does not exist
for this purpose: do not guess a name.

## 4. Tell the person what happens next

After writing the four files, say, in two or three lines:

1. The draft is saved. Open **Settings › System › Kybernos Suite › Plugins**; the draft is in the **Drafts**
   block of the **Add** menu, with a check of the files.
2. Choosing **Install** hands it to DSH's own plugin manager. Kybernos then shows what it brings and asks
   for their OK before any of its instructions reach their agents.
3. If the page lists a fault, send it back to this conversation and fix it here.

Do not say the plugin is installed: you only prepared it.

## When a draft comes back with faults

The Plugins page can send the faults it found. Read them, change only the file that has the fault, show what
you changed in one line, and write it again. Do not start over, and never create a second draft for the same
plugin.
