# Visual review — plate v1

Looked at the rendered plate (3000 × 2600 at 2×, read 2026-10-20) after each render. It is generated, not committed (media
are not committed in this repository): `README.md` beside this file gives the one command that renders it. What was on the plate:
light and dark, the received card (collapsed and expanded with the report-back line), the proposal card with its
environment summary and its five actions, the send dialog with its counter and its steer warning, and the same cards in a
390 px column.

## Seen and fixed

1. **Two plain bubbles in Light, none in Dark** — an injection mistake while building the plate (the replacement landed
   twice on the first panel). Fixed: one bubble per panel, the "no marker ⇒ old rendering" case is visible in both.
2. **Fake product copy** — a sentence describing the card was written as if it were part of the chat. Now an italic
   annotation in the tertiary colour, so nobody reads it as shipped text.
3. **Received card had the same fill as the panel** — in Dark the card disappeared (layer-1 on layer-1, only a 1f border
   between them). The card now sits on layer-2: in Dark it separates from the bubble (layer-3) and from the panel
   (layer-1); in Light the hairline still does the job.
4. **The mock showed a duplicate "Received message from…" label above the card** — not what the page will draw (the card
   *is* the head of the bubble, and the host's framing line is removed from display). Removed.
5. **The environment summary was grey `bg-layer-2`** — but in DSH Light layer-2 is `#fff`, so it would have shown as an
   invisible block. Now a 5 % tint of the label colour, which reads as an inset in both themes.
6. **First plate render wasted half the image in empty space** — re-rendered at the content's height.

## Left as is (and why)

- The `collapsed` / `expanded` pills and the italic annotations are **annotation-only**: the shipped card has no such
  tag; they exist on the plate so a reviewer can name the two states at a glance.
- The two actions under the card ("Ouvrir la session", "Répondre") use DSH's outline/ghost button grammar; at 0.5 px the
  outline is faint in Light, exactly as it is in DSH's own dialogs. Kept for homogeneity, not for contrast.
- The dialog's resize grip is the native textarea handle; the shipped component uses the same.
- 390 px: the summary folds to one column and the title truncates with an ellipsis — that is the intended narrow layout,
  not a defect. The card's left padding drops to 12 px so the text keeps the width it needs.

Verdict: the two cards read as DSH surfaces in both themes, the hierarchy is header → body → actions, nothing is cut,
and the plate is good enough to build the components on. `cards.css` is the file shipped inside `client.js` (same
classes, same tokens).
