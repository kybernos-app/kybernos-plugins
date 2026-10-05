# kybernos-atlas

A read-only map of how the things you set up fit together: **projects, kybers,
skills, memory, lessons, automations and apps**. It adds one Settings page,
**Atlas**, with a Help button that explains how to read it.

It only reads. It writes nothing, stores nothing between visits, adds no route
to the host and needs no engine patch.

## What you see

| Part | What it is |
|---|---|
| **Start from** | Pick a project or a kyber (searchable). Everything else is drawn around it. |
| **Map** | Four columns: *Project*, *Kybers & automations*, *Skills & apps*, *Memory & lessons*. Hover a name to light up its lines, click it for details. |
| **List** | The same nodes as a filterable table. The text version of the map. |
| **To check** | Broken references and things that look wrong, each with the reason. Click one to see it on the map. |
| **Help** | The legend: solid lines, dashed lines, crossed-out red names, the words used, and what is not shown. |

Lines: **solid** = written in a file (a kyber lists a skill); **dashed** =
guessed from a name (an app that matches one of a kyber's tools); a
**crossed-out red name** = a reference to something that no longer exists.

### What "To check" lists

Only things that are provably wrong:

- a kyber or project declares a skill that is not among the installed skills;
- a declared skill is inactive;
- two skills share a name in two folders (only one is used);
- an automation whose last run failed.

A skill nobody declares is **not** listed: skills are mostly used by name, on
demand, so that would be noise. Nor is an app that no kyber lists.

## Where the data comes from

All same-origin, all read-only. Each source is read on its own: one that fails is
named in a banner and the rest still draw.

| Source | Route | Gives |
|---|---|---|
| Projects | DSH workspace store + `GET /kybernos/load` (`workspaceUi`) | names, declared skills, sessions per project |
| Kybers | `GET /kybernos/load` | definitions, roles, declared skills, tools |
| Which kyber worked where | `POST /kybernos/project-data` (read-only) | active kybers per session, so kyber ↔ project |
| Skills | `GET /kybernos-skills/skills` | installed skills |
| Lessons | `GET /kybernos-sessions/state` | the 5 newest lessons per kyber, and totals |
| Memory | `GET /kybernos-cloud/memory` | counts only (needs a linked kybernos.app account) |
| Automations | `POST /kybernos/tasks` `{action:'list'}` (read-only) | schedule and last runs |
| Apps | `GET /kybernos/composio/connections`, `GET /kybernos-miniapps/list` | connected apps |

Things worth knowing:

- **Account memory is one node with a count.** It can hold hundreds of facts and
  is not tied to a project or a kyber, so it is never drawn fact by fact.
- **Lessons**: the host only returns the 5 newest per kyber; the kyber's card
  says how many older ones exist.
- **kyber ↔ project is derived** from the kybers that were active in a project's
  40 most recent sessions (the host reads at most 40 per call). There is no field
  that declares it, and it is only recorded when a kyber was activated in a
  session, so many projects show few kybers. The Map opens on the best-connected
  project or kyber for that reason.
- **app ↔ kyber is inferred** from a tool-name match. Nothing declares it.
- The automations list is read through the plugin's own route; the task store also
  holds each task's prompt and, for webhook tasks, a secret. The client copies only
  `id`, `name`, `schedule`, `active` and `history`, and a test checks that nothing
  else reaches the page.
- Reading memory makes the cloud plugin refresh the account, so a re-read costs a
  network round trip.

## Not in this version

A whole-workspace graph view, a timeline, and "open in Skills / Kybers" buttons
(they need a deep-link seam in DSH). The first two were prototyped and dropped to
keep the page easy to read; the third is a follow-up.

## Install and enable

Opt-in: it is not active by default. Enable it from the Suite panel
(*Atlas*, family *Agent teams*). It then appears in Settings, in the same group as
*My workspace*.

## Safety

- Every client entry is guarded: a failure to register the page is logged and
  never stops DSH from starting.
- The page makes no write: the only POSTs are `project-data` and the task *list*,
  and `test-client.mjs` checks that.
- No storage of its own (`localStorage`, cookies, files).

## Tests

```
node packages/kybernos-atlas/test-client.mjs
```

Covers the normalisers (written against route shapes measured on a running DSH),
the graph, every check, the Map columns, the list and picker, the registration
contract, and the "may not do" rules above. The rendering was also checked on a
real DSH page.
