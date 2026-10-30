# Integration packs

A **pack** teaches Kaby to work with one outside app (Google Workspace, HubSpot, Airtable, Slack...). It is a folder of plain text:
a manifest, a few skills, a few automations that are installed **paused**, the recipes that start them from the app's side, and
a short statement of what Kaby never does with that app. A pack carries no code of its own, no secret, and no switch that is on.

This page is the format and the install rules. The pure half is built and tested (`packages/kybernos-skills/packs.mjs`,
`test-packs.mjs`); **nothing calls it yet**: no route, no page, no installer on disk. The first real packs (Google, HubSpot, Airtable,
Slack) come after the owner has seen a mockup of where packs are offered.

## What a pack can carry, and what already carries it

| Shape | Carried by | Today |
|---|---|---|
| Kaby reads and writes the app (Connect) | `skills/` and `automations/`, over the person's connected app (Composio connector) | skills: a folder with a `SKILL.md`, as `kybernos-skills` installs them. Automations: entries of `tasks.json` made through the plugin's own create action |
| The app starts an automation (Trigger) | `automations/` with `schedule.mode: "webhook"` and a page of recipe in `triggers/` | the webhook route exists (`/kybernos/hooks`); the secret is made on the person's machine, never shipped |
| Talk to Kaby from the app (Ask) | the server's MCP door, not a pack | see `mcp-kaby-contract.md` |
| Bring the app's data into Contacts / Catalog / Pipeline (Import) | not in format 1 | waits for the Business engines |

What does **not** carry a pack: a *kyber* (`marketplace-kyber.mjs`) is a crew of agents (`name, cat, pitch, agents, version`), with no
skills, automations or connectors; the composer's templates only prefill the box. A pack can recommend a kyber; it does not replace one.

## Layout

```
pack.json                      the manifest (required)
README.md                      what it does, in the person's words (optional)
demo.md                        a walkthrough on sample data (optional; named in the manifest)
skills/<name>/SKILL.md         a skill; any text file next to it, under the rules of a Team skill
automations/<id>.json          one automation (see below)
triggers/<name>.md             how the app starts one: a recipe, a page of text
```

Nothing else is allowed: any other path refuses the pack. Every file is text (no NUL), 256 KiB at most; 120 files and 2 MiB in all.
Paths follow the Team-skills rules (ASCII, no `..`, no hidden segment, no case twin, no Windows device name).

## `pack.json`

| Field | Rule |
|---|---|
| `format` | `1` |
| `id` | `^[a-z0-9]+(-[a-z0-9]+)*$`, 64 at most; also the folder name once installed |
| `name`, `host` | one line, 80 characters at most (`host` optional: the app's name) |
| `version` | `major.minor.patch` |
| `description` | one line, 280 characters at most |
| `needs.connectors` | up to 8 connector slugs (`^[a-z0-9_]{1,40}$`), the apps the person must have connected. A missing one is **said**, it does not block the install |
| `skills`, `automations` | the names / ids of what is in the folders; the lists and the folders must match exactly (12 each at most) |
| `never` | up to 8 one-line statements of what Kaby will not do with this app (160 characters each). **Required as soon as the pack has a skill or an automation**; shown before the install |
| `demo` | `"demo.md"` |

Any other key refuses the pack. One-line fields hold no control character and no `<` or `>`.

## An automation file

```json
{ "name": "Morning brief", "prompt": "Write my morning brief.", "schedule": { "mode": "cron", "cron": "0 8 * * 1-5", "tz": "Europe/Paris" } }
```

Only `name` (120), `prompt` (8 000) and `schedule` (`mode` is `cron` or `webhook`; a cron has its expression; no one-off date). **Any other key
refuses the pack**: not `active`, not `approvals`, not `trigger` (a webhook id and secret), not `assistant` (callable by an outside assistant).
The host still runs its own sanitiser (`kbSanitizeTaskInput`) on the result, which checks the cron.

## What installing does

`planInstall` and `installPack` take what the host says is there (`connected` slugs, the state of each skill, existing automation names):

| Item | Done |
|---|---|
| a skill that is absent | written |
| a skill the person edited, switched off, or that is already the same | left alone (reported `keep`, `disabled`, `current`) |
| an automation | created **paused**, `approvals: "ask"`, not callable. An automation with that name already there is not made twice |
| a connector that is not connected | listed; `ready` is false; the install goes ahead |
| the pack | recorded (`{ id, version, skills, automations }`) **only if nothing failed** |

One failing item does not stop the others. Nothing in a pack runs at install: the person switches each automation on, and each one
asks before it acts. Scripts inside a skill are listed in the plan so the page can warn about them, as for a Team skill.

## Checks a pack goes through

Name and layout, the manifest, the lists against the folders, each skill as a Team skill (frontmatter, size, binary), each automation, and a
secret scan over every file (the Team-skills patterns, linear in the size of the text). The first problem is returned with its reason
and file; nothing is trimmed into shape.

## Not decided

- Where packs are offered (the Skills page, the Automations page, Settings): a mockup first, from real captures.
- Whether a pack can come from anywhere or only from a signed release of this repo. Until then, only packs shipped in the repo.
- Recording and removing an installed pack (`packs.json` next to `seeded-skills.json`) and updating one to a new version.

## Tests

`node packages/kybernos-skills/test-packs.mjs`: the empty pack (valid, installs nothing, recorded), a full pack in order, what is left
alone, 38 refusals each with its reason, and a failure that does not stop the rest.
