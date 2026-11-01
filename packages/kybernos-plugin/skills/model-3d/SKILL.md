---
name: model-3d
description: Builds a small interactive 3D page for an engineered object, checked before it ships - a product viewer with exploded view and bill of materials, a configurator with a live price, a mechanism cut open with numbers that are computed rather than drawn. Parts are real solids from a CAD kernel (or simple shapes for a shop configurator), every fit is tested, mass comes from exact volume times density, and the page exports a real .glb. Says plainly what was checked and what is an assumption.
whenToUse: The person wants a 3D model, a 3D product page, an exploded view, a configurator, a cutaway or a 3D explainer of a machine, a part, an object or a process - typically one of the "3D model" examples of the new-chat page (armchair configurator, hand grinder exploded, four-stroke engine). Not for people, animals, terrain or scanned objects, and not for a flat picture or a video.
---

# 3D model

Speak the person's language in the chat, and write the page's labels in it too. Everything below is written in English because you read it.
You make ONE model per conversation. Ask before you build, check before you claim, and never present as verified something you did not verify.

```bash
KIT="${DSH_HOME:-$HOME/.dsh}/skills/model-3d"      # this folder
node "$KIT/scripts/model.mjs" doctor               # every command below is a subcommand of this one script
```

The work happens in the person's project, in `3d/<slug>/` (a short lowercase name). The result is `3d/<slug>/model.html` (one file, opens in any browser) and `3d/<slug>/model.glb`.

## 1. Which road

Pick one from the request and say it in one line.

| Road | For | Start from | Needs the CAD toolchain |
|---|---|---|---|
| **A. Simple shapes** | a shop configurator: fabric, colour, size, a price that follows | `--from chair` | no |
| **B. CAD solids** | parts that must fit, mass and cost from volume, exploded view, cutaway, step-by-step assembly | `--from blank` (any product) or `--from grinder` (bill of materials + cost by batch) | yes |
| **C. Computed behaviour** | a mechanism or process whose numbers must be right: pressure, flow, load, a cycle | `--from engine` (B plus a simulation with conservation tests) | yes |

If the request is a person, an animal, a landscape, a scanned object or a stylised character: say plainly that this skill makes engineered, measurable objects and stop there. Do not fake it with primitives.

## 2. Ask, in ONE message

- what the object is and what the page must let someone do (turn it, explode it, choose options, see a number change);
- real dimensions and materials if they have them. If not, say you will use plausible sample values and label them as sample on the page;
- for a cost: whether they want an estimate. If yes, the assumptions (rates, stock prices, minutes) are shown on the page, and it is never called a quote.

Offer a default for each question so a short answer is enough. Do not start before you know what the object is and what the page is for.

If the person hands the choices to you (« you choose »), take the defaults without asking again: label every value you chose as **sample** on the page (the legend or the `lede`), and list them as assumptions in your answer.

## 3. Check the kit (roads B and C)

```bash
node "$KIT/scripts/model.mjs" doctor
```

`ok` lines for python, build123d, trimesh: go on. `MISSING`: the CAD toolchain is installed once, in a private python environment under the DSH home (several hundred MB to download, a few minutes). Tell the person that, wait for a yes, then:

```bash
node "$KIT/scripts/model.mjs" setup --yes
```

If doctor says no python 3.11 or newer was found, give the install line it prints and stop. Never install into the system python, never use sudo, never `pip install` anything else. Road A needs none of this.

## 4. Build

```bash
node "$KIT/scripts/model.mjs" new 3d/<slug> --from <blank|chair|grinder|engine>
node "$KIT/scripts/model.mjs" all 3d/<slug>      # build, then check, then the page: run the example UNTOUCHED first, it must be green
```

`new` copies a working example: the CAD script, its tests, the page module and `model.json` (which lists the build steps, the checks and what goes in the page). Then change it, never start from nothing:

- Read the example's header comments, then `references/page-contract.md` (what the page module receives and returns, what `model.json` can say).
- Solids: millimetres, Z up, every part drawn at its assembled pose, one `kit.add(id, shape, material, density, display='Name')` per part. Real densities: `references/materials.md`. A part that is not one solid, or has no density, has no mass: say so.
- Read `references/traps.md` once before the first build of a new model: it saves the hours the first examples cost.
- Keep the structure of the example's tests and grow them with the model. Run `all` after every real change, not at the end.
- Fasteners (screws, pins, dowels) and holes, and an exploded view that must keep every part on the axis of its joint: `references/verification.md`.
- Mesh budget: under about 150 000 triangles in all and 12 MB for the page (a published Artifact stops at 16 MB). Threads, springs and knurling are the usual culprits: `references/traps.md`.

## 5. The checks decide

This is what the skill is for. Nothing is done until `check` is green AND the checks mean something.

1. `kit.check()` (built in): every part is a valid closed solid and its mesh volume equals its exact volume.
2. **What touches must not overlap.** List the pairs that meet (a leg under a seat, a shaft in a hole, a drawer in a body) and test their shared volume. Moving parts: test the poses of the whole travel.
3. **Every check can fail.** For each kind of check add a negative control: move a part on purpose and prove the check catches it. A check that cannot fail proves nothing.
4. **Numbers come from the geometry or from a model with conservation laws**, never typed in. Mass is volume times density. A simulation shares ONE source of truth with the CAD script, and has tests for what must stay true (`references/simulation.md`).
5. **Read the numbers once with a sober eye.** A beech stool of this size weighs about 2 kg; an engine of 123 cm³ at 3 000 rpm does a few kW. If a number surprises you, find out why before you show it.

If a check fails, fix the model, not the check. Never delete or loosen a failing check to get green; if a tolerance really must change, say so in your answer and why. `references/verification.md` has the recipes.

## 6. Look at it

`page` checks that the page's script parses, nothing more: only a browser shows that it renders. Open `3d/<slug>/model.html` yourself if you have a browser tool: the parts show, every button and slider does something, a click on a part selects it, Export reports a size, the browser console is clean, and it still works at phone width. The page loads three.js from a public CDN, so it needs internet. If you cannot look (no browser tool, no network), say so in your answer; never write that you checked what you did not see.

The page's own words (the drag hint, the Export button, its messages) are English unless `page.strings` says otherwise: set them in the person's language (`references/page-contract.md`).

To show it in the chat or publish it as an Artifact, the file is already one self-contained page (check the size note `page` prints).

## 7. The answer

Short, in the person's language, in this order: where the files are; the answer to what they asked (the weight, the count, the price: from the report); what was checked, in numbers (parts, fit checks, negative controls); what is an **assumption** (sample dimensions, rates, simplifications of the physics); what was NOT checked (strength, standards, a phone, how it looks if you could not open it); the one thing they decide next (usually: « give me your real dimensions and I recompute »). Do not paste logs.

## Never

- invent a price, a standard, a tolerance or a specification and show it as fact. Sample values say "sample"; costs say "assumptions, not a quote";
- say "computed" about a number that is typed or drawn, or "verified" about something no check covers;
- claim the model is safe, strong enough, certified or ready to manufacture: this is geometry and arithmetic, not an analysis of strength;
- use a real person's likeness, a logo or a brand's design you were not given;
- edit the files of the skill folder itself: work in `3d/<slug>/`, which is your copy.

## What is in the kit

| File | What it is |
|---|---|
| `scripts/model.mjs` | the one command: `doctor`, `setup`, `new`, `build`, `check`, `page`, `all` |
| `scripts/kit/kbcad.py` | the CAD helper copied next to every model: `Kit` (`add`, `check`, `report`, `write_glb`), `shared_volume`, `mesh_of`, `write_json` |
| `scripts/kit/host.template.html` | the page: scene, legend, controls bar, Export; examples plug into it |
| `examples/blank` | a three-legged stool: the smallest complete model (CAD, tests, parts viewer) |
| `examples/chair` | an armchair configurator from simple shapes (no toolchain) |
| `examples/grinder` | twelve solids with a real thread, a bill of materials and a cost by batch from shown assumptions |
| `examples/engine` | a cutaway engine with a computed cycle, driven by the same module the CAD script reads |
| `references/` | `page-contract.md`, `verification.md`, `simulation.md`, `materials.md`, `traps.md` |
