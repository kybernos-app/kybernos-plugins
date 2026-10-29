# Regard — what was actually seen

The captures were taken with `node verifier.mjs --shots /tmp/kb-maquette-gate` (1400×900, then 480×900 for the narrow one) and each was
opened with the session model before anything was written here. What follows is what the images show, not what they were meant to show.

**`maquette-clair.png` (light, draft).**
Seen: the row's badge "À approuver" was drawn while the panel said "Brouillon" — the two disagreed, and the row was announcing a decision
nobody could take. Cause: `.kbgate-badge { display: inline-flex }` beat the user agent's `[hidden]` rule, so `badge.hidden = true` had no
effect. Fixed with one `[hidden] { display: none !important }` line, then re-captured: the badge is gone on the draft, and the panel's
ladder marks "Relire" as the next rung while "Approuver" and "Activée" stay greyed — the two-step gesture is readable at a glance.
Also seen, and kept: the primary "Approuver" is visibly disabled (45 %), which is the point of the panel.

**`maquette-sombre.png` (dark, draft).**
Seen: the same layout, and the off switch had all but disappeared — `--dsw-alias-bg-layer-2` on `--dsw-alias-bg-layer-1` is 1 % of
luminance apart in the dark theme. Fixed by taking the product's own `.kba-toggle` background (`--dsw-alias-bg-layer-3`, client.js:31993)
plus an `--dsw-alias-interactive-bg-hover` hover. Re-captured: the switch reads as a control on both themes.

**`maquette-etroit.png` (480 px).**
Seen: the two button groups go full width, the cards stack to one column, the long finding and the evidence line wrap instead of clipping,
and nothing scrolls sideways (the capture is 480 wide and the header row fits). Left as is.

**`maquette-apres-approbation.png` (after "Approuver" on `awaiting-approval`).**
Seen: the status chip turns green ("Approuvée"), the approval rung is done and the activation rung becomes the next one, the proof says
"Rien n'est sorti de la machine." in green, the two tool rows carry `lecture · ok` and `écriture · refusé à l'écriture`, and "Lancer les
vérifications" has disappeared — a verdict must not change under an approval nobody re-took. Correct as drawn.

**`maquette-refus.png` (after "Refuser").**
Seen: the chip is red ("Refusée"), the hint says it stays off and runs nothing, "Approuver" is disabled, "Refuser" is disabled (a refusal is
terminal) and the checks are offered again. Correct as drawn.

## What was left, and why

- The Cards view and the cloud case: out of scope of the maquette (see `cadrage.md`), and the Cards badge is the List badge on another grid.
- The real page around the block: no GUI of this worktree could be opened in this session, so the frame is the product's rules, not a trace of
  the running page. The live check (`scripts/check-gate-panel-live.mjs`) produces exactly those captures (`40-reference-suggested-block.png`,
  `01`…`08`) on a sandbox, and that is the pass that closes the gap.
- The dark theme was driven by the demo's own toggle (`data-ds-dark-theme` on `<body>`), not by the app's Settings page: the tokens are the
  product's, the switch is the same one `check-flow-dark-live.mjs` presses.
