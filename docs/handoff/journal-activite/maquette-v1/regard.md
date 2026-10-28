# Visual review — plate v1 (2026-10-28)

Looked at the rendered plate (3120 × 3000 at 2×, read with the session model) after **each** render. The PNG is
generated, never committed: `README.md` beside this file gives the one command that renders it.

On the plate: Light and Dark at the Settings width (720 px), the 390 px column, and the Settings rail with the
System fold open on « Journal d’activité ».

## Seen and fixed

1. **The time column was truncated** (« 00:31:… » instead of « 00:31:42 ») — the fixed-layout table was ellipsising
   every cell. Fixed: ellipsis only on *Quoi* and *Détail*; the time and session columns are `nowrap` without
   overflow, and their widths went from 66/76 to 78/86 px.
2. **The 390 px column did not actually hide the Session column** — the rule was a `@media (max-width:520px)`, and a
   Settings volet is ~720 px wide on any desktop viewport, so it never fired. Real product bug, not a plate one:
   the page now takes a `.kblg-narrow` class (plus the media query for a genuinely narrow viewport), and the plate
   shows that case honestly.
3. **Rows wrapped and the columns pumped** (« Recherche web » on two lines, « Titre auto » on two lines, a tall
   retry row): the table had no layout rule, so every cell negotiated. Fixed: `table-layout: fixed`, explicit widths
   for time/family/session/tokens, `nowrap` on the rest.
4. **The nav chevrons read as dots** at 10 px — lifted to 11 px with the tertiary tone.
5. **The Détail column held sentences** (« quota exhausted », « appel non demandé ») — kept, but the data is
   ellipsised at the cell edge now, so a long provider error can never stretch the page.

## Left as is, on purpose

- The empty Détail cells (title, compaction, plain calls) keep their width: a blank column is calmer than a
  table that reflows per row.
- The 390 px column drops Session **and** Détail rather than shrinking them to four characters.
- Dark and Light use the same markup; the small visual difference at the right edge of the Dark panel is the
  capture's border rendering, not a padding difference (both panels are the same `.panel` box).
