# Showcase 3D games: what we can build next (study, 2026-11-02)

Status: study, plus one look test per proposal built the same day (section 10). Only EMBER ISLE was then built as a playable game and published (end of section 10). Facts marked *measured* were read or fetched on 2026-11-02. Durations are estimates taken from the playbook's time table, not measured on these games.

## 1. What exists

| Item | State |
|---|---|
| NEON DRIFT (endless neon racer) and NIGHT SHIFT (open-world night driving, third person) | Done. About 2,500 lines of JS each, one offline file of 745-750 KB (three.js r155 inlined, 630 KB of it). Live on `https://arcade-xi-ten.vercel.app` (Vercel project `arcade`): the home and both games answer 200 (*measured*). |
| NEON MINI | Express version of the racer, also on the arcade. |
| `game-starter/`, `PLAYBOOK.md`, `game-brief/DEMANDER-UN-JEU.md` | A skeleton that compiles and plays (render + post, PBR environment, shadows, loop, HUD, procedural audio, signature, Playwright harness); a 10-section playbook measured on 3 games; a copy-paste request form with 3 modes (express ~5 min, standard 30-45 min, product = a session). |
| Where | `~/Documents/Kybernos/Team1`, its own git repo: **one local commit, no remote** (*measured*). Not in this repo. |

What the two examples are not: both are vehicle action games, keyboard first, night/neon palette. No serious game, no strategy, no touch-first game. The new-chat shelf has 9 « Game » cards, all 2D text prompts (platformer, match-3, ...), and the type carries « Soon » because no bundle makes games yet (`docs/dev/templates-catalogue.md`).

## 2. Limits that shape every new game

From the playbook (measured by the author on 3 games):

- one file, offline, no CDN, no asset file (also repo rule 4);
- three.js r155 as a classic script, no addons: bloom, tonemapping and vignette are hand-written passes;
- under 150 draw calls and 40k triangles;
- headless Chrome runs at about 7 fps, so rules are tested by stepping the simulation, never by waiting.

From the Kybernos share link (`kybernos-server/src/modules/shares/public.ts:28`, read): a shared HTML file is served under `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; ...`. Consequences:

- inline script, WebGL, WebAudio and `data:` images work;
- `localStorage` throws (both games already guard it);
- no pointer lock (Night Shift's mouse look would not work), no fullscreen, no Web Worker;
- no network request, so no leaderboard or analytics ping;
- `target="_blank"` needs `allow-popups`, which the policy does not grant: the « Made with Kybernos » link has to open in the same tab there (to verify once served).

The server half is not live: `kybernos-dev-server.fly.dev/s/x` answers 404 (*measured*).

Rule: write every new game sandbox-safe from the start. It then works as a file, on Vercel, and later behind a Kybernos link.

## 3. Three proposals

Each has its own palette (the two existing games are night/neon) and a simulation core made of pure steps, so it can be tested without waiting.

### A. Strategy, wow effect: EMBER ISLE (working title)

Turn-based hex tactics on a floating island diorama at golden hour. 12x12 hexes, you against a scripted opponent, 3 unit types in rock-paper-scissors, capture 3 beacons or take the HQ, about 15 turns. Turn-based on purpose: no dependence on the frame rate (testable at 7 fps) and playable on a phone.

Wow stack, all procedural:

- relief with PBR vertex-coloured tiles; forests and buildings as instanced meshes (one draw call each);
- water shader (fresnel, animated normals, shore foam);
- god-rays and height-fog post passes;
- tilt-shift depth of field for the miniature look;
- day to dusk driven by the turn counter, windows and fires blooming at dusk;
- fog of war as a shader dissolve;
- cinematic camera on the menu and on each resolution; ember and smoke particles.

New against the starter: 3 post passes, water shader, instancing helpers, hex picking, opponent logic. Mode: product. Risk: the highest of the three (post-pass cost on integrated GPUs; the starter already has adaptive quality).

Alternative for a bigger wow later: space 4X on an atmospheric planet (sphere of hexes, harder picking). It would reuse B's planet shader.

### B. Serious game, learning: SLINGSHOT (working title)

Fly a probe from Earth orbit to Mars with real two-body mechanics. Drag to plan a burn; the dotted path bends live, computed by the same integrator that then flies it. Missions: circularise, Hohmann transfer, gravity assist, free. Score = fuel (delta-v). The debrief compares with the optimal delta-v and names the two laws you just used.

Signature moment: the predicted arc bending under the finger, with the planet's atmosphere rim lit by the sun. The learning is checkable: tests compare the integrator with the closed-form Hohmann delta-v, so wrong physics fails (same philosophy as the `model-3d` engine example).

New against the starter: planet and atmosphere shader, fixed-step integrator, touch drag input, debrief screen. Mode: standard. Risk: low. Audience: a teacher shares a link.

### C. Serious game, business: DOCK 9 (working title)

Isometric daylight warehouse. Orders arrive in waves; you set three policies (staffing, restock threshold, priority rule) and tap to dispatch robots during a 5-minute shift, with two disruptions (supplier delay, demand spike). KPIs: on-time rate, cost, stock-outs. The debrief is computed from your run, not scripted: 3 lessons (safety stock against holding cost, the bottleneck, batching) with your own numbers, and a 20 s fast-forward replay with a bottleneck heat-map on the floor.

Reusable on purpose: the scenario (items, flows, KPIs, disruptions) is one data block at the top, so the same engine becomes a restaurant kitchen, a clinic or a call centre. That fits the « generic engine configured by data » framing of the themes, and it is the strongest pitch to a business visitor: « your sector, as a game ».

New against the starter: simulation core (queues, stock), UI-heavy HUD, debrief template. Mode: standard+. Risk: medium, and it sits in the balancing of the numbers, not in the graphics.

## 4. Shared work first: starter v2

Most of the value is common modules. Add them to `game-starter/` once:

1. a touch-first input layer (tap, drag, pinch/orbit) beside the keyboard one;
2. a sandbox-safe signature link and the storage guard;
3. post passes: god rays and tilt-shift, next to the existing bloom and ACES;
4. water and planet shaders, instancing helpers;
5. a data block and a debrief screen template for serious games;
6. a two-language string table (the existing games are French only; shared links travel further).

## 5. Order and size

Estimates from the playbook's table, not measured here. Games are built one after the other (playbook: serial, not parallel).

0. Starter v2: about 1 h.
1. EMBER ISLE (product, one session). First, because it is the riskiest and decides whether the wow lands; its post passes then serve the others.
2. SLINGSHOT (standard, about 45 min, plus the physics checks).
3. DOCK 9 (standard+, about 1 h, plus a balancing pass).

Each ships with functional tests, every capture read by eye, zero console error, fewer than 150 draw calls, an arcade card with its thumbnail, the utm link, and a check of the live URL.

## 6. Sharing

1. The single file: works now.
2. The Vercel arcade: works now, manual `vercel deploy --prod`. The project sits on a personal Vercel team with no custom domain; the home has a « Prochain jeu » placeholder card, and its meta text still says « Deux jeux ».
3. A Kybernos link (`/s/:slug`): blocked until the server half is carried onto the Fly branch and deployed (see the shares memory); constraints in section 2.

Recommendation: publish on the arcade now and keep every game sandbox-safe so step 3 costs nothing later.

## 7. Into the product (later, not now)

The playbook, the starter and the request form are a recipe, which is what the `model-3d` skill is. A skill `game-3d` would seed them with its files (`three.min.js` is 630 KB, under the 1 MiB per-file limit; 200 files at most), the « Game » shelf cards would carry the six-line form below as their prompt, and the « Soon » tag would go. No screenshot or font in git (rule 4): thumbnails follow the templates-lot flow. Decide after two games prove the recipe holds.

## 8. Prompts (six-line form of `DEMANDER-UN-JEU.md`)

**EMBER ISLE**
1. Loop: each turn I pick a unit, move it over hexes, attack or capture a beacon, then the enemy answers.
2. Signature moment: the camera sweeps the island at golden hour while the sun drops and the village windows light up.
3. Camera: isometric orbit, drag to rotate, pinch to zoom.
4. Style: Monument Valley meets Into the Breach, tilt-shift miniature, warm bloom.
5. Controls: tap or click, phone first.
6. Mode: product. Output: arcade + deploy.

**SLINGSHOT**
1. Loop: drag to set a burn, watch the predicted path, fly it, adjust; four missions.
2. Signature moment: the dotted arc bends under the finger while the planet's atmosphere glows.
3. Camera: free orbit around the probe, auto-follow.
4. Style: Interstellar clarity, deep blue-black space, amber sun.
5. Controls: drag and tap, keyboard optional.
6. Mode: standard. Output: arcade + deploy. Fuel is the score; the debrief compares with the optimum.

**DOCK 9**
1. Loop: every few seconds a decision: dispatch a robot, change a policy, absorb a disruption.
2. Signature moment: the end-of-shift replay with a bottleneck heat-map.
3. Camera: isometric, fixed, slight orbit.
4. Style: clean daylight, white and teal, readable like Two Point Hospital.
5. Controls: tap or click, large targets.
6. Mode: standard+. Output: arcade + deploy. The scenario is one data block at the top.

## 9. Open points

- UI language of the new games: French only (as today) or FR/EN.
- `Team1` has no remote: losing the disk loses both games. A private remote or a bundle in the archive folder fixes it (not done).
- The arcade has no `arcade.kybernos.app` subdomain yet.

## 10. Look tests (built 2026-11-02, outside git)

One real three.js scene per proposal, kept in `~/kybernos-archive/showcase-3d-looktests-2026-11-02/` (sources, single-file pages, captures; nothing here is committed, rule 4). Each capture was read by eye.

| Test | State | Own rating |
|---|---|---|
| EMBER ISLE | Look test with a one-turn demo: intro flight, click-to-move and attack, fog of war, FPS overlay (key F), start card, help panel, guided hints, FR/EN, visible reach hexes, forgiving clicks. No rules engine: the red army never moves, nothing is captured. | about 4/5 |
| SLINGSHOT | Orbit raise with a prediction computed by the same integrator that flies the probe; debrief against the closed-form Hohmann delta-v (physics test green, red with a mutant). Mars is decoration. Planet day side soft. | 3/5 render, 4+ idea |
| DOCK 9 | Daylight warehouse with a real deterministic simulation, 3 live policies, KPI bar, computed debrief and heat-map (sim test green, 3 mutants red). No motion polish, no sound. | 3/5 |

Measured on the owner's machine (Apple M4, app browser, 1024x768 at DPR 2): EMBER ISLE about 55 fps. Phones are unmeasured. EMBER ISLE main pass 55 calls and 33.4k triangles (73 and 61.8k with the shadow pass).

Playbook gaps found while building (to fold into starter v2): light values are night values (daylight needs sun about 4.2 and bloom on the max channel); `renderer.info` undercounts without `autoReset = false` and counts the shadow pass, so say which pass the 150-call and 40k budgets apply to; the god-ray pass needs no per-pixel jitter and film grain goes after gamma; tag sky pixels in alpha so geometry occludes rays; `Vector3.project` needs `camera.updateMatrixWorld()`; point size should use `H / (2 tan(fov / 2))`; hex cliffs crack unless shared corner rows are common; the `target="_blank"` signature link is blocked under the share sandbox; a CSS `display:grid` overrides the `hidden` attribute; r155 logs a deprecation warning.

EMBER ISLE was then finished as a first playable game (real rules and a computer opponent, easy and normal levels, help, French and English, one map, no sound) and published on the arcade on 2026-11-02: `https://arcade-xi-ten.vercel.app/games/ember-isle` (card added on the arcade home, thumbnail `assets/thumb-ember.jpg`). Checked live: home and game answer 200, start card, one turn played by real clicks (red phase, then turn 2), 0 console errors, about 54 fps on the owner's M4. Not checked: phones, a full game online, sound (none). SLINGSHOT then got a start card, a « ? » help, a paused flight while the card is open and a phone layout (English only, not published; physics test green, a real drag plan and fire played in the app browser). DOCK 9 then got a start card, a « ? » help that pauses the clock, bubbles kept on screen and a phone framing (English only) and was published on the arcade the same day (`https://arcade-xi-ten.vercel.app/games/dock-9`, card and thumbnail added): a full shift was played to the debrief in the app browser, and the phone layout was read at 375x812.

What the owner's first play showed (and the fix): a page with no explanation is not a game. Every showcase needs a start card, a help panel and step-by-step hints; selected-unit reach must be readable at the default framing and a wrong click must not silently cancel; wide bars must not collide with the signature pill (check 800, 1024, 1366 and a phone). The real app browser refuses `file://`; serve the folder over localhost to play it there.
