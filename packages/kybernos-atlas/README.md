# kybernos-atlas

A read-only map of how the things you set up fit together: **projects, kybers,
skills, memory, lessons, automations and apps**. It adds one Settings page,
**Atlas**, with a Help button that explains how to read it.

**It reads nothing until you click *Update*.** Opening the page only shows an empty screen with an
*Update* button; the sources below are read when you click it (and again each time you click it again).
The last reading is kept in memory so that moving between Settings pages does not read again; it is
gone when the page reloads, and the header says how long ago it was read.

It only reads. It writes nothing, stores nothing between visits, adds no route
to the host and needs no engine patch.

## What you see

| Part | What it is |
|---|---|
| **Around** | Pick a project or a kyber in *Start from* (searchable). Four columns: *Project*, *Kybers & automations*, *Skills & apps*, *Memory & lessons*. Hover a name to light up its lines, click it for details. |
| **Rings** | The whole workspace: one ring per layer, the workspace in the middle, each project keeping the same wedge on every ring. |
| **Circle** | Every node on one ring, grouped by project. Links cross the middle. |
| **Areas** | One cluster per project. Lines between clusters show what crosses projects. |
| **Links** | A force layout: nodes pulled together by what they reference, loose ends at the edge. |
| **Timeline** | Automation runs of the last 14 days on top, everything else by last change below (square-root scale; things with no date in their own column). |
| **Orbit** | The rings as a 3D stack that turns on its own. Drag to turn it. |
| **List** | The same nodes as a filterable table. The text version of every drawing. |
| **To check** | Broken references and things that look wrong, each with the reason. Click one to see it on the map. |
| **Help** | The legend: solid lines, dashed lines, crossed-out red names, the words used, and what is not shown. |

Lines: **solid** = written in a file (a kyber lists a skill); **dashed** =
guessed from a name (an app that matches one of a kyber's tools); a
**crossed-out red name** = a reference to something that no longer exists.

### In the drawings

Rings, Circle, Areas, Links, Timeline and Orbit share one canvas and one set of controls:
search (it flies to the node), *Names* (every label), *Motion* (idle drift and the Orbit
turning; off when the system asks for reduced motion), *Lessons*, *Fit*, *Full screen*, and zoom
(+ / − buttons, or Ctrl/⌘ + scroll). A legend isolates a project or a kind, and a toggle shows or
hides the dashed (inferred) lines. Shape is the kind, colour is the project, a bigger dot has more
links, a dashed ring marks something in *To check*, and a red cross marks a broken reference.

Lessons are **off by default** in the drawings: a real workspace has dozens (the host returns the
newest few per kyber) and they bury everything else. The *Lessons* button adds them.

### What "To check" lists

Only things that are provably wrong:

- a kyber or project declares a skill that is not among the installed skills;
- a declared skill is inactive;
- two skills share a name in two folders (only one is used);
- an automation whose last run failed.

A skill nobody declares is **not** listed: skills are mostly used by name, on
demand, so that would be noise. Nor is an app that no kyber lists.

## Where the data comes from

All same-origin, all read-only, all read when you click *Update*. Each source is read on its own: one that fails is
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

- **Runs** are only drawn from the last 14 days of each automation's history, and only in the drawings.
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
- Reading memory makes the cloud plugin refresh the account, so an update costs a
  network round trip.

## Opening a node

The details card has an **Open** button when the thing has a page in Kybernos:

| Node | Opens |
|---|---|
| Skill | Skills |
| Kyber (one with a definition) | the kyber's page |
| Project | the project's page |
| Automation | Automations |
| App (a connected toolkit) | Connectors |
| Run | its session |

Memory, lessons, mini apps, a kyber known only by its lessons and the workspace itself have no page of
their own, so they only offer *Copy*. The Settings dialog is closed afterwards so the page is visible.

How: the main plugin exposes `window.__KB_OPEN__(patch)` (in `kybernos-plugin/client.js`), the same
gesture as its sidebar rows (`{ view: 'skills' | 'tasks' | 'connectors' }`, `{ view: 'project', projectId }`,
`{ view: 'teaminfo', detailPath, detailRoot }`). A session is opened through the workspace store's
`openSession`. If the seam is missing the button is simply not shown, and `test-client.mjs` checks that every
patch Atlas sends is one the sidebar sends.

## Layout

The page measures its own width (the Settings dialog keeps its menu, so the screen width says little):
below 760 px it goes to one column, below 460 px the controls stack. Inside DSH's own Settings dialog a
phone-sized window leaves only ~120 px for any page: that is the dialog's layout, not something a page can fix.

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
