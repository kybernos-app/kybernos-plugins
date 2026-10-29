# Maquette — the certification gate and the initiative cards (batch B5)

travail: creation
fidelite: interactive
dossier: docs/dev/kaby-proactive/maquettes/automations-gate
raison: the gesture to judge is a refusal — a switch on an unapproved automation must open the review and say why, never switch it on.
regions: the gate panel (collapsed strip, ladder, evidence, decision), the list badges and the row switch, the initiative cards, the narrow fold.
hors-champ: the Cards view and the cloud case, because no real cloud computer exists in a sandbox and the Cards grid is a copy of the List's badge, already judged there.

## Source of truth

```
source:
  kind: donnees            # the contents: real frozen shapes, replayed by hand
  files: gate-records.json
  kindFrame: regles        # the frame: the product's own class names and tokens, not a screenshot
  files: ../../../../packages/kybernos-plugin/client.js (the .kba-* rules), packages/kybernos-sessions/dsh-css.js (the --dsw-alias-* values)
  capture: none            # NO screenshot of the running Automations page was available in this session (see README, "what was NOT looked at")
```

`source.kind: capture` was the plan of the test strategy (`40-reference-suggested-block.png` plus a real Automations screenshot at 1400×900).
This session could not open a GUI of this worktree (no sandbox running, no signed session), so the frame is taken from the product's own
stylesheets instead — the geometry is therefore *the same rule*, not a traced picture, and the one thing a capture adds (the real page
around the block) is missing. `regard.md` says exactly what that costs.

## The scene, and the gesture

One page: a list row with its badge and its switch, the panel below it, the initiative cards under it. A status picker (pills) reaches the
seven states of the spec plus the "trial touched the outside" variant.

The gesture is played for real by `kbmStep()` (in `<script id="kbm-model">`, pure):

1. `switch` on a record whose approval is not `granted` → **nothing flips**, the panel opens on the review, a toast says why;
2. `gate-check` → `static-passed`, no approval;
3. `gate-trial-start` → `awaiting-approval` with a clean proof (or `trial-done` with effects);
4. `gate-approve` → `approved`, `granted` — and only now does the switch turn the automation on (`activated`);
5. `gate-refuse` → `refused`, terminal, and the checks are offered again.

## What the verifier proves

`node verifier.mjs` (exit 0 = every line holds; `--sabotage` = one defect per control, must exit 1):

- the switch, over 64 status × approval × active combinations, never activates without a granted approval;
- the whole ladder, and that a dirty trial cannot be approved while a clean one can;
- colours come from `tokens.css` only (no hex, no `rgb()`, no literal colour in the page);
- type on the product ladder (11.5 / 12.5 / 13 / 14 / 18), radii on the product set, grids that can shrink;
- the fold at the sibling card's 640 px, nothing wider than 480, `data-ds-dark-theme` on the dark toggle;
- both language batteries on every label (French and English twins);
- every `data-kb` hook the real page carries;
- the fixture holds the frozen GateRecord / ProofReport / InitiativeEntry keys.

`--tokens` prints the 13 aliases; `--tokens --check` compares them with a running GUI (exit 3 when none answers).
`--shots <dir>` writes the five captures through a throw-away Chrome on `file://`.
