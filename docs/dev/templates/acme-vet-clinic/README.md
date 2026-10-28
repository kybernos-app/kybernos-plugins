# acme/vet-clinic — the starter theme

**Sample data for a fictional author (`acme`).** I am not a veterinary clinic, `acme` is not a
company, and every sentence in this folder is a **proposal**, the accent `#7C5CBF` included
(build contract rule 4, "cited or labelled": a real theme replaces every text with the clinic's own
words and cites the file it came from). Nothing here is ever executed or fetched.

A theme is **data**: one folder, one `plugin.json`, several `extends`. The five points it
contributes to are the five frozen interfaces of `docs/dev/sector-bundles.md` ("Build a theme"):

| Folder | Point | One file or folder = |
|---|---|---|
| `domains/` | `kybernos/core#domain-pack` | the field, its goals and its kit |
| `themes/` | `kybernos/theme#theme` | the style layer: `{ id, name, settings }`, tokens only |
| `skills/` | `kybernos/skills#skill` | one skill folder with its `SKILL.md` |
| `teams/` | `kybernos/core#team-template` | one Agent Team the kit can create |
| `automations/` | `kybernos/core#automation-template` | one automation, created switched off |

`package.json` carries no `dsh` key on purpose: a data theme has nothing for DSH to load, so it
needs no patch file. Copy this folder, rename it, run the checker, then read the report:

```bash
node scripts/plugin-check.mjs docs/dev/templates/acme-vet-clinic
```

The `broken/` folders are deliberate faults, one per check id, for learning the validator. They are
not part of the plugin and are never installed.
