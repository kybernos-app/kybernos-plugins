# Kybernos — the platform story

One self-contained page (one file, one language, no network) that tells how the bricks of Kybernos fit together, and how far
each one is from built. Open `index.html` (double-click). Nothing to install, nothing to run.

## The story it tells

Kybernos is an open source AI agent platform: an **engine with plugins**. It is installed as a desktop app, opened in a browser,
hosted by yourself or carried on a phone, always with the same plugin set. Only the plugins that link to another service are drawn:
coding agents, local models, models, apps through Composio, any MCP server, remote control, voice, Kaby. Next to them, the plugins
that do the work: agent teams, skills, automations, the apps builder and the customer agent (the public assistant of one shop).

An optional **Kybernos Server**, shared or white-label, has two sides. The **admin side** is what a company's IT looks at: the team
console (members and roles, usage and audit trail, shared skills, company sign-in) and the owner's admin page (audit and Journal,
plans, the switches). The **user side** is the account page, the relay and the **cloud computers**: each one is a hosted Kybernos
install, metered by the hour, that takes Kaby's tasks. Below them, one **task queue** that the doors feed: Kaby link (messengers),
Kaby MCP (AI tools), the API (developers, a target) and two more targets, triggers (an event from an app starts a task) and the Kybernos
model (a team that answers as a model), next to the services the engine reaches (the models and the connections). **Outside** are the
providers, the apps, the messengers, the AI tools, the developers and model marketplaces, the customers of a business that runs Kybernos,
the phone and e-mail provider and the app stores.

| Frame | What it holds |
|---|---|
| **Kybernos** (purple) | the four ways to install it, the plugins that link out, the plugins that do the work (the customer agent included) |
| **Kybernos Server** (grey) | admin side (team console, owner page), user side (account, relay, cloud computers, a local install as a target), the task queue, the doors into it, the services the engine reaches |
| **Outside** (dashed) | AI models, apps, messengers, AI tools, developers and model marketplaces, your customers, phone and e-mail provider, app stores |

Kaby is drawn in coral wherever it appears: the assistant, its local door, the bot in the messengers, the door for AI tools.
Purple on a brick means "a Kybernos install" (a cloud computer, or your own as a target).

## Reading and using it

| Control | What it does |
|---|---|
| **Tell the story** | nine steps, one per idea; each lights its bricks and links and dims the rest (`←` `→`, `Esc` closes) |
| Hover a brick or a link | a tooltip, and the bricks it links to stay lit |
| Click a brick, a link or a frame | its sheet: what it is, what is inside, what crosses it, its limits, where it is set, its source |
| **Where** chips, or the eye on a frame | hide or show a frame; the others close up (Shift-click: only this one) |
| **How far** chips | keep built, partly built or not built bricks |
| **When** chips | only with the private overlay (below): keep the bricks of one horizon, Now, Next or Later (Shift-click: only this one) |
| **Focus › Kaby** | light only what belongs to Kaby |
| **Search** (`/`) | a word in a brick's name, description or contents, and in its private notes when the overlay is loaded: the hits are listed under the chips and the first one is brought into view |

A **blue dot** next to a brick's mark says that its sheet has a **Planned** list: small items that are not a brick of their own (a worker picker,
WhatsApp out of beta, a phone number…). The last step, **Where we go next**, lights what is not fully built and what has something planned.

A mark on the corner of each brick says how far it is: ● built, ◐ partly built, ○ not built. A dashed outline means not fully built.
**Built means merged into dev and exercised; it does not mean live in production.** A dashed arrow is a target, not built; a dotted
one is the direct road with your own keys. On a phone the diagram becomes a list of the same bricks, and a sheet opens from the bottom.

## One source

Everything the page says lives once, in the `RAW` object between `/*DATA:START*/` and `/*DATA:END*/` in `index.html`:
`FRAMES` (with their groups, notes and bands), `NODES` (the bricks, with their place in the drawing), `LINKS` and `STORY`. The same data
draws the diagram and the phone list. There is no second file and no second language.

A brick whose title is too long for its box keeps the full title in `t` and is drawn on its own `lines` (the first one bold). `planned` is a list of
`{ id, t, d }`: the small items of the roadmap, each with a stable `id` (the private overlay speaks of it). `tag: 'kaby'` puts a brick in the Kaby focus.

A brick carries its own **status** (`st`: `done`, `half`, `todo`) and **why** (`stNote`); a brick that is not built must say why. The marks,
the counts, the filters and the tooltips all read that one field. `inside` lists what a brick holds, each entry with its own status and
source. A link says what it crosses; one that is not built yet is a `target` and is dashed.

## Keeping it true

- A change in the platform: edit the brick (status, note, limits, `source`) and `RAW.asof`, which names the commits the page was read at.
- A new brick: give it a frame, a group and a place (`x`, `y`, `w`, `h`), a title and a subtitle that fit its box, and a step of the story that tells it.
- A new link: `v` joins a brick above another (`rev` puts the arrow toward the one above), `h` two bricks in a row, `frames` the frames
  themselves, `elbow` runs from a frame's edge (`a` a frame, with `ay`) or from a brick (`a` a brick), along a margin (`side: 'right'`, a `lane` of its own) into a brick.
  The frames are placed by hand (`h` of each frame in `FRAMES`): a second row in a frame means shifting the frames below it.
- A server brick belongs to the admin side (groups `team`, `owner`), the user side (`user`), the queue or the doors, and sits inside its band.
- Every document a brick cites must exist in this repository; the server's own documents are named in words (for example "Server ADR 0052"), not by path.
- A claim that the page relies on carries **evidence**: `evidence: [{ repo, path, has | absent }]` on the brick. `has` is a text the file
  holds; `absent` is a text no file under `path` holds, which is how a "not built" claim is proved. `repo: 'server'` is read at the
  commit `RAW.serverRef` names, in the server repository beside this one (or `KYBERNOS_SERVER_REPO`); where that repository is not there,
  those items are skipped and counted. When someone builds a thing the page calls "not built", its evidence fails and the page is updated.
- `node scripts/test-architecture-map.mjs` checks all of this offline: one file only, no URL, the script parses, English only, the frames and
  their order, the server's two sides and the one queue the three doors feed, bricks inside their frame and band and never on each other,
  text that fits its box, links that can be drawn and no vertical line that crosses a brick, a story that tells every brick, cited documents, evidence, the seven bricks of
  the roadmap, no private word in the public file, and the overlay's behaviour with none, a broken one and a good one. It runs in `node scripts/run-all-tests.mjs`.

## The roadmap, and the private overlay

The roadmap is drawn **into** the schema, not in a separate panel: bricks only where a new place exists (Kybernos model, Triggers, Customer agent, Your
customers, Phone and e-mail provider, App stores, Referral commissions), a **Planned** list and a dot on the existing bricks for the small items, a story
step at the end. The public page says what a thing **is**, in neutral words: no price, no amount, no percentage, no vendor of the roadmap, no commercial
term. `scripts/test-architecture-map.mjs` fails when one of them (a vendor name, a currency, a percentage) enters the file.

The **horizons** (Now / Next / Later), the blockers, the vendor names and the commercial detail live in an optional sibling script, **`roadmap.private.js`**,
which is listed in `.gitignore` and never committed (the folder is on the public repository). The page loads it with an optional `<script src>`; when the
file is not there the tag fails quietly (one 404 in the console) and the page is the public one: no When tag, no When chips. When it is there, the page shows a
**Private view** badge, the When tags in the sheets and tooltips, the When chips, the private notes in a dashed box marked *Private overlay* and a private
paragraph under a story step. The search reads those notes too, so a vendor name typed in the box lands on its brick. **Do not publish that view** (a screenshot included).

The overlay sets `window.KB_PRIVATE = { asof, home, story: { <step id>: text }, nodes: { <brick id>: { when, planned: { <item id>: { when, note } }, notes: [{ t, d }] } } }`
(the header of the file says the same). A brick's horizon is its own `when`, else the earliest of its planned items. A broken or partial overlay is ignored
piece by piece, never fatal. The master copy is kept outside the repository, in `~/kybernos-archive/architecture-roadmap/roadmap.private.js`; to open the page
with it, put it beside `index.html` (a link is enough) and serve or open the folder:

```bash
ln -s ~/kybernos-archive/architecture-roadmap/roadmap.private.js demo/kybernos-architecture/roadmap.private.js
```

Without a server, double-clicking `index.html` also works (a classic script loads over `file://`). When the overlay is present, the test checks it against the
bricks too (every brick and planned item it names exists, every horizon is valid).

## What this is not

It is a reading of this repository's documents and code, and of the server repository's `origin/dev`, not a measure of a running
system. The admin side in particular is read from the server's routes and documents; no running console was opened. It was last looked at
in a browser on 2026-11-23 (wide and phone widths, light and dark, with and without the private overlay). No media, no font, no network: the logo is drawn in the file from the
brand mark's own shapes (repo rule 4).
