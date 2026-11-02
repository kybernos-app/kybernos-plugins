# Mini-apps → mini web apps: migration audit

2026-11-02, second version (the first one planned a host bridge first and kept the kinds; the owner's answers changed both). Audit only: nothing is changed, nothing was run in the GUI. Based on a read of `dev` at 599b629b.

## 0. Decisions already taken by the owner

- There are **no kinds** (Bricks, Quiz, Cards, Slides…) any more. There is one thing: a **mini web app**, one self-contained HTML page that can be shared, like the 3D model examples (`packages/kybernos-plugin/skills/model-3d`). Bricks or a quiz are examples of mini web apps, not types.
- **Dashboards and Motion are not touched for now.** They keep their renderers and the `.miniapp.json` file.
- **Revision.** One revision mini web app per goal (the Education pack already has goals such as "Pass my exams": a revision plan and cards to replay). Several ways to revise in the same page (cards, quiz, …), and **one score engine inside the page** (mastery per topic, what to see again). The separate score store (`progress.json`, route `art-progress`, scores filed by file name) is dropped.
- **First version has no AI inside the page.** The AI works in DSH beforehand (it writes the questions and cards); the page holds everything and can be shared anywhere with no key and no account. A sign-in or a key for an "AI help" button comes later; a key is never put inside a page (a shared page is readable by everyone).
- Out of scope: the `mini-app-pack` / `mini-crm-base` skills (a SQLite "mini base" for web apps; same word, other thing). A "logo" mini-app was mentioned and not found in the repo (probably a slip).
- Brainstorm stage: nothing is to be built before the owner says go.

## 1. What a mini-app is today

A `*.miniapp.json` file (data) plus one React *renderer* inside the core client picked by `renderer`/`kind` (`KB_MINIAPP_RENDERERS` / `KB_MINIAPP_COMPONENTS`, client.js:20483). Nothing in the file can be opened or shared without DSH.

| Renderer | Lives in | Needs beyond the file | Producer | In scope |
|---|---|---|---|---|
| `quiz`, `cards` | core | score → `POST /kybernos/art-progress` (read by the external `studencik` kyber), replay | skills `quiz-builder`, `flashcards` (not in repo) | yes, together as the revision app (section 5) |
| `slides`, `media`, `score`, `generic` | core, small text players | none | `slides-deck` (not in repo), `score.cjs` (outside repo) | yes (`generic` stays as the fallback) |
| `bricks` | core: **about 1,000 lines**, an inline copy of the Bricks engine (19470–20483) | canvas 2D | skill `artifact-bricks` (not in repo) | yes |
| `places` | core + `kb-places.js` (35 KB) | Leaflet and map tiles from the network | none found | yes |
| `technique` | core + `technique/renderer.js` (26 KB) + vendored three.js | WebGL | none found | yes |
| `motion`, `dashboard` | bundles `kybernos-motion`, `kybernos-dashboards`, through the door `window.__KB_MINIAPP__` | live host data | their own tools and skills | **no, untouched** |

On this machine (`~/.dsh`, `~/dsh`, `~/kybernos-archive`; workspace folders not searched) there are 11 `*.miniapp.json` files, all dashboards. No quiz, cards or bricks file. The product has no users yet, so nothing needs converting.

## 2. The model to follow: the 3D examples

`skills/model-3d` builds ONE `.html` per example from a tested kit (`host.template.html`, `model.json`, checks): the object, its legend and buttons, and an **Export .glb** button inside the page. The agent supplies data and small modules; the engine is tested code. Sharing already exists for such a page:

- the file itself (opens offline in any browser);
- a public link served by the computer, `/kybernos/s/<token>` (HTML shown inside a sandbox, no session, the token is the right; the link dies when the share goes back to Private);
- a server link `/s/:slug` (built in `kybernos-server` dev, **not deployed**; HTML runs on the cookie origin under CSP `sandbox allow-scripts`, an open owner decision);
- a password-sealed page, today for dashboard snapshots only, and it refuses any HTML.

## 3. Target

Every mini-app becomes a page like a 3D example: one `.html`, a small metadata block first in the file (title, summary, kit and version), opened in the same sandboxed iframe, shared with the same Share sheet, installed as a native app by loading the file as it is. Creations shows one family. The built-in players leave the core client.

## 4. Findings

1. **The shelf already promises this.** 8 of the 9 "Mini-app" examples (cost splitter, converter, habit tracker, timer, packing list, tip calculator, text cleaner, poll) are general apps that no renderer's data shape can express. An agent asked for one can only write an `.html`, which Creations files under **HTML**, not **Mini-app** (judged from the requests and the type rules, not run).
2. **The iframe has no link to DSH**: `sandbox="allow-scripts"`, no `postMessage` handler in the core (0 found). So an HTML page keeps no state (no `localStorage` in an opaque origin, on a shared link too), cannot record a score, does not follow the theme or language. A shared page cannot rely on DSH anyway, so the page must work alone. The one thing it needs from outside is a **small storage service** so that it remembers (progress of the revision app): DSH's viewer and the share page both provide it, from the first lot. Nothing else of a "bridge" is needed now.
3. **No metadata for cards.** Previews read the whole `.miniapp.json` (up to 200,000 characters) but only the first **1,200 characters** of any other file (`index.js:8872`). The metadata block must come first in the page.
4. **Bricks exists twice** (core copy and `kybernos-bricks/client.js`, the same helpers, 54 matching lines each). The Bricks "no detached island" test over 9 archetypes belongs in the kit's checks.
5. **Slides and 3D have the same split**: a 24-line `KbSlidesPlay` beside the 374 KB Slides bundle; `technique` beside `model-3d`, which already produces a three.js page.
6. **"App ⤓" serialises the DOM of a panel** by CSS class and has broken twice on class collisions (`scripts/test-miniapps-panels.mjs`). A page is already the file to install.
7. **Producer skills are outside the repo** (`quiz-builder`, `flashcards`, `slides-deck`, `artifact-bricks`); the migration must ship its own seeded skills.
8. **The current score store is not tied to a goal.** `art-progress` files each score under the artifact's file name (`progress.json` in the DSH home: best score, percentage, entries); the Education pack's goals have no link to it, and the external `studencik` kyber reads it. Decision: drop it, the revision app owns its score engine and its progress.
9. **Two policies for HTML on the server**: server links accept HTML (cookie origin, sandbox), snapshots refuse it. Sharing mini web apps from the server needs one answer (section 6).

## 5. Plan

| Lot | Content | Size |
|---|---|---|
| L0 | The page contract (one file, metadata block first, self-contained, theme and language set when built); the small storage service in DSH's viewer and in the share page; Creations, shelf and chat card read the block; one "mini web app" family; tests | M |
| L1 | New-chat "Mini-app" makes a page; one seeded skill `mini-app-builder` with a small shared kit (tokens, controls) so free-form pages look alike | M |
| L2 | Bricks as a kit (engine from the bundle, the island test as a check); **delete the core copy** | S |
| L3 | The **revision app**: for a goal, cards and quiz in one page, one tested score engine (mastery per topic, what to see again), content written beforehand by the agent from the person's material; no AI inside. Then slides / media / score | L |
| L4 | `places`, `technique` (merged with `model-3d` output) | M |
| L5 | "App ⤓" loads the page; drop the DOM path for creations | S |
| L6 | Delete the built-in players and their tests | S |

## 6. What the end state deletes (line spans, not measured by deleting)

About 1,500 lines of the core client (19046–20483 plus the technique player), `kb-places.js`, `technique/renderer.js` (and the vendored three.js if `model-3d` covers it), the creation path of `kybernos-miniapps/client.js`, the score store (`/kybernos/art-progress`, index.js:11678–11721, `progress.json`, the `kbProgress*` helpers in the client) and the renderer parts of the test and check files, with the few tests that mention the store. **Kept** while Dashboards and Motion need them: the door, `KbMiniApp`, the `.miniapp.json` type and its card.

## 7. Decisions for the owner

1. HTML shared from the server: allow it on a separate user-content origin (recommended; the 3D pages have code of their own, so they are not data), or only "viewer + data" like snapshots?
2. The Bricks panel (the chat keeps drawing, clock on the host) and the three panels with "App ⤓" (Bricks, 3D modeller, Slides): keep as they are for now (recommended), or move too?
3. Where the revision progress lives: in the reader's browser through the storage service (recommended for the first version), or on a server for signed-in readers (later, with the AI help and the "teacher sees the class" case).
4. Later, not now: how a shared page reaches an AI. A: none (this version). B: through the owner's computer (the owner's credit pays, needs a per-link limit). C: the reader signs in with a Kybernos account or brings a key (the Kybernos proxy already checks the plan on each request). None of B and C exists for a shared page today.

## 8. Not verified

No GUI check, no test run. Not measured: the CSP of a `srcDoc` frame in the DSH page, the iframe on the phone engine, how the absolute address of a host link is built and who can reach it, the workspace folders for stray `.miniapp.json`, whether `kybernos-atlas` feeds `places`. Skills in `~/.dsh/skills` were listed by name only.
