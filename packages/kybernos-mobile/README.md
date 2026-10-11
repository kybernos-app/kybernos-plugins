# `@local/kybernos-mobile`

Makes the DSH shell usable on a phone. Measured on DSH 0.2.1-alpha.2 at 390 px wide, the shell left a permanent 56 px
rail, pushed the chat to a 100 px sliver as soon as the sidebar was opened, and squeezed Settings to one word per
line. This bundle changes that, **below 700 px only**: nothing above it is touched.

## What the user sees

- The conversation takes the whole screen. A **menu button** sits in the top-left corner.
- The menu button opens the sidebar as a **drawer** over the chat (86 % of the width, 340 px at most). A tap on the
  dimmed chat closes it, and so does picking a session or a page in it.
- The right bar (files, changes, details) is a full-screen layer while it is open.
- **Settings**: the page list becomes a scrolling strip under the search box, and the page uses the full width.
- Dialogs, menus and lists never leave the screen; on a coarse pointer, fields are 16 px (below that iOS zooms in on
  focus and never zooms back) and menu rows are at least 40 px high.

## How it works

| File | Half | Role |
|---|---|---|
| `mobile.css` | data | the whole layout, in one `@media (max-width: 700px)` block; keyed on DSH's stable hooks (`data-slot`, `data-sidebar-collapsed`, `data-rightbar-*`, `data-shell-*`, `role`), never on its hashed class names |
| `index.js` | host | puts `mobile.css` in every index render as `<style id="kbmob-sheet">` through DSH's own `webserver/index-inject` seam (a phone never paints the desktop layout first); serves the same file at `GET /kybernos-mobile/mobile.css` |
| `client.js` | browser | the menu button, the tap on the dimmed chat, the close after a pick; if the sheet is not in the page it links the route above |

- The drawer is open when DSH says its sidebar is **not collapsed**, and it is opened and closed by clicking DSH's
  own toggle (the button whose shortcut is `<modifiers>+B`, without Shift: Alt+Meta+B on a Mac, another pair
  elsewhere; found by the shortcut because the label is translated). If that shortcut was rebound, the first button of
  the sidebar opens the drawer, and DSH's own close button in the drawer closes it. The bundle keeps no state of its own.
- No engine patch, no slot, no service: the seams are `webserver/index-inject` and the DOM.
- Files, settings, `localStorage`: none read or written.

## Limits

- Only DSH's frame is adapted. A plugin's own settings page that fixes its widths (a label column next to a control)
  keeps its desktop layout and can stay narrow; those are fixed in the plugin that owns the page.
- The row actions DSH shows on hover (the "…" menu of a session) are not reworked: they were not measured to be
  missing on touch.
- The selectors are DSH's stable hooks as of 0.2.0-rc.2 and 0.2.1-alpha.2 (rc.2 not played with this bundle); a
  DSH that renames them leaves the page as it was, never broken.

## Tests

`test-host.mjs` (the row, the route, the guards), `test-client.mjs` (the contract, the tap decisions, the stylesheet's
rules), and on the real GUI `scripts/check-mobile-live.mjs` (a 390 px phone emulated in a sandbox DSH).
