# automations-gate — the maquette of the gate panel (batch B5)

Text only: no image, no font, no network call, no storage. Five files and one fixture:

| file | what it is |
|---|---|
| `index.html` | the whole scene (row, panel, initiative cards) and the gesture, at DSH's real class names |
| `tokens.css` | the 13 `--dsw-alias-*` values the surface uses, light and dark |
| `gate-records.json` | the fixtures: a frozen GateRecord, a ProofReport, a dirty trial, an InitiativeEntry |
| `verifier.mjs` | the contract; `--sabotage`, `--tokens [--check]`, `--shots <dir>` |
| `cadrage.md` | the six-line header and the source of truth |
| `regard.md` | what the captures actually show, what was fixed, what was left |

```bash
node docs/dev/kaby-proactive/maquettes/automations-gate/verifier.mjs
node docs/dev/kaby-proactive/maquettes/automations-gate/verifier.mjs --sabotage   # must exit 1
node docs/dev/kaby-proactive/maquettes/automations-gate/verifier.mjs --shots /tmp/kb-maquette-gate
```

## What was borrowed, and from where

Every control is a copy of a rule already in `packages/kybernos-plugin/client.js` — no invented control, no `<select>`. The line numbers
are the ones of the batch's checkout; the rule name is the durable handle.

| in the maquette | copied from client.js | rule |
|---|---|---|
| `.kba-btn`, `.kba-btn.pri` | `.kba-btn`, `.kba-btn.pri` | height 32, radius 9, font 12.5, `--dsw-alias-label-primary` fill for `.pri` |
| `.kba-toggle`, `.kba-toggle-knob` | `.kba-toggle` (31993) and `.kba-lcard .kba-toggle` (31943) | 34×20, radius 10, `--dsw-alias-bg-layer-3`, knob `--dsw-alias-bg-layer-1` |
| `.kba-card` | `.kba-card` (31924) | radius 16, border `--dsw-alias-border-l1`, background `--dsw-alias-bg-layer-1` |
| `.kba-rowline`, `.kba-rowbtn`, `.kba-name`, `.kba-last` | the List of the page | `minmax(0,1fr) auto`, `12px 16px`, 13 / 12.5 |
| `.kbcc-badge` | `.kbcc-badge` | 11.5, radius 999, border `--dsw-alias-border-l2` |
| `.kbgate-*` | the batch's own block (client.js, after the suggested card's rules) | the same radii, the same three font sizes, the same 640 px fold |

The values of `tokens.css` are **not** from memory: they are the `--dsw-alias-*` entries of the product's token table
(`packages/kybernos-sessions/dsh-css.js`, `DSH_TOKENS_CSS`), resolved through the `--dsw-static-*` they point at, read on 2026-10-28
(DSH 0.2.1-rc.2). `--tokens --check` compares this file with a running GUI and exits 3 when none answers, 1 on the first drift.

## What was NOT looked at

- **The running Automations page.** No sandbox of this worktree was up and no signed session was available in the session that built this
  folder, so the frame comes from the product's rules rather than from a screenshot: the block is right, the page around it is asserted,
  not traced. `scripts/check-gate-panel-live.mjs` takes that capture on a sandbox (`40-reference-suggested-block.png` and the rest).
- **The Cards view and the cloud case** — declared out of scope in `cadrage.md`.
- **A real assistant's trial.** The proof shown in `gate-records.json` is the frozen shape with values the routes of this batch produce,
  replayed by hand (the file says so in `provenance`); no model was run for it.
- **`--tokens --check` against a live GUI**: it exits 3 here (no signed GUI answered), so the comparison with the running product is
  written and unproven; it is the one line of this folder that a sandbox run must turn green.
- **The screenshots themselves are not committed:** `scripts/garde-depot.mjs` refuses tracked media, so they live under `/tmp`.
