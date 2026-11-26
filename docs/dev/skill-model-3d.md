# The `model-3d` skill

The « 3D model » examples of the new-chat shelf (armchair configurator, hand grinder exploded, four-stroke engine) start this skill. It is the first shipped skill that carries code: scripts, a tested helper library, four working examples and references sit beside its `SKILL.md`.

## Why a skill, not a plugin (decided 2026-11-01)

What was proven is a recipe, not a service: each request makes the agent write a new CAD script, and what keeps it reliable is the tested library (`kbcad.py`), the checks that must be able to fail, and the build-check-fix loop. A plugin tool would have to fix a description language for parts, which two examples cannot justify. The CAD kernel (python, build123d, OpenCascade, several hundred MB) is installed on the person's machine with their yes (`model.mjs setup --yes`, a venv under `<DSH home>/kybernos/3d-tools`), never shipped by us: OpenCascade is LGPL, which only matters if we redistribute it. If the agent keeps missing the same step after a few real uses, that step is promoted to a plugin tool; showing the page inside the product is a platform step (the « app » example kind), not this skill.

## Layout (`packages/kybernos-plugin/skills/model-3d/`)

| Path | What |
|---|---|
| `SKILL.md` | the procedure: which road (shapes / CAD solids / computed behaviour), ask, check the kit, build, the checks decide, look, answer, never |
| `scripts/model.mjs` | the one command: `doctor`, `setup`, `new <dir> --from blank\|chair\|grinder\|engine`, `build`, `check`, `page`, `all` |
| `scripts/kit/` | `kbcad.py` (Kit, `shared_volume`, glb writer), `host.template.html` (the page), `build-page.mjs` |
| `examples/<name>/` | a complete model: CAD script, tests, page module, `model.json` (build steps, checks, what goes in the page) |
| `references/` | page contract, verification recipes, simulation pattern, densities, traps |

`model.json` steps are only `py <script>` or `node <script>` on files of the model's folder; nothing else is ever run from a json.

## Shipping the folder

`seed-skills.mjs` copies `SKILL.md` only, and its six copies must stay identical (`scripts/test-seed-skills-drift.mjs`). The files beside it are copied by `seed-skill-files.mjs`, which lives in this bundle alone: same rule file by file (absent → written; ours and changed upstream → refreshed; the person's edit → kept; dropped upstream and still ours → removed; `SKILL.md.disabled` → nothing), state in `<DSH home>/kybernos/seeded-skill-files.json`. `kbSeedShippedSkills` calls both for every name of `KB_SHIPPED_SKILLS`.

Only plain files with safe names are copied (no symlink, no hidden name, no space), at most 200 files of 1 MiB. The generated outputs (`.glb`, reports, the html page) are never committed: `test-model-3d.mjs` fails if one is left in the folder.

## Tests

- `test-seed-skill-files.mjs`: the copy rules above, offline.
- `test-model-3d.mjs`: the folder is seedable and within the limits of a skill; the command refuses what it must; every example scaffolds; a page builds with no toolchain (the chair); a seeded copy runs `new` and `page` by itself; the engine's simulation tests pass. With the CAD toolchain it also builds the stool, passes its checks, shows that they go red when the legs are made too long, and builds the page (skipped, with a `SKIPPED:` line, without it).
- `examples/grinder/test_grinder.py` (about 2 minutes) and `examples/engine/test_engine.py` need the toolchain and are not in `run-all-tests.mjs`; run them after changing the CAD scripts: `node skills/model-3d/scripts/model.mjs all <dir>` on a `new` copy.

## Not done

- The shelf entries (`docs/dev/templates-lots/model3d-1.json`, four examples with real screenshots, see `docs/dev/templates-catalogue.md`) start the skill with a request in the composer; a « sample kind » that opens the skill without the person pressing send is not built. The camshaft and followers of the engine are not drawn.
- Strength, standards and manufacturability are out of scope and the skill says so.
- The page loads three.js (0.160) from a public CDN: it needs internet.
