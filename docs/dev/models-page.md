# The Models tab (Settings → AI provider and models → Models)

Nothing a model shows today was removed: the name and id (both editable in place), the provider, every
capability, the type, the price in and out, the context, the source and the override count, and the whole details
sheet (Input, Output, Capabilities, Type, Limits, Pricing, Metadata, external scores). What changed is the zone above
the list and the way the table reads.

## What was measured on the real page, and what changed

| Before | Now |
|---|---|
| a 720 px column on a 1500 px screen | up to 1120 px (the core plugin caps every Settings child at 720 px; this page overrides it with a more specific rule) |
| the provider cut off on 10 rows out of 10 (`ant…`) | its own column, icon and whole name; below 860 px it sits on its own line under the id |
| the same *N overrides* pill on 10 rows out of 10 | an amber line in the Source cell, only when there are overrides |
| the same *No match* on every row | unchanged data, but on two lines: provenance, then the override count |
| capability icons in a variable-length list | nine fixed slots (text, vision, audio in, video, image gen, search, tools, S2S, reasoning) plus a `+N` cell for the rest, so a column reads top to bottom |
| 12 stacked bands before the first row | the Cloud card only on the Providers tab; no intro sentence, no *Live data* pill, no Restore / Fetch buttons: one info icon and one ⋯ menu on the tab bar |
| two stray *App ⤓* buttons | gone: `kybernos-miniapps` took `.kbm-root.kbmp` for the Modeleur panel (the two bundles share the `kbm-` prefix) |
| row actions always visible | on hover and focus; always visible on touch screens |

## The filter bar (same grammar as the site's /models and the server console)

Under the tab bar: the search on its own line, then six menus, each with its icon on the trigger and on every option:
**Provider** (logos), **Type** (glyphs), **Capability** (multi-select, each capability in its own colour; the header
icons of the capability slots and this menu are the same filter), **Status**, **Score** (only once scores are known),
**Sort**. Below the bar: « N of M models », *Reset filters* when something is set, and the models.dev status.

- Keyboard: Arrow Up / Down move in an open menu, Escape closes it; the selected option (or the first) takes focus on open.
- Capability stays open while ticking; *All* clears it.
- There is no row of capability pills under the search any more: the Capability menu does it at every width.

## models.dev is read in the background

Opening the Models tab reads, for every model models.dev has not been asked about yet, its entry (host cache, four at a
time, in memory only: nothing is written). The results bar shows the state, not a button: `models.dev · reading a/b`,
`synced 3 min ago`, `unreachable, retrying`. After a failure the next try waits 10 minutes. *Sync all models with
models.dev* in the ⋯ menu stays the explicit action (it also refreshes the two score sites, which are never read by
themselves: Artificial Analysis and BenchLM).

## Breakpoints (container queries on the panel)

- **≥ 860 px**: six columns (model, provider, capability slots, context, source, actions). The header icons of the
  capability slots **filter** (click Vision to keep the models that see images).
- **620–859 px**: the compact capability list column; the provider on its own line under the id.
- **< 620 px**: provider and capability icons on the model's line; the filter menus sit in two columns, the odd one out
  takes the whole line, and a menu opens inside the panel (never past its edge).

The header cells of *Model*, *Provider* and *Context* sort the list (the same sort the *Sort* menu drives).

## The ⋯ menu

Sync all models with models.dev · Restore defaults (asks to confirm first) · Open DSH's native Models page.

## Two things worth knowing

- **Escape**: the panel and the Edit/Add drawer capture it and stop it when they use it, so DSH does not also close
  Settings under an open sheet.
- **Hooks**: `KybernosHero` owns hooks, so it is rendered as a component (`h(KybernosHero, { key: 'kb-hero' })`, the first child of the provider grid), never called
  conditionally from `Panel`: a conditional call changed Panel's hook order on the tab switch (React error #300, caught
  on the real GUI, and shown by the error boundary as "This page could not be displayed").
- **CSS order**: the table's breakpoint rules are qualified with `.kbmp-table` so they win whatever their position in
  the stylesheet array; two earlier orderings silently hid the provider column.

## Tests

- `packages/kybernos-models/test-client.mjs`: the slot helper (`kbMxSlots`) is evaluated for real, the rest is checked
  on the source. `packages/kybernos-miniapps/test-client.mjs`: the Modeleur selector no longer matches this page.
- On the real GUI, read-only (clients swapped into the served bundle): 29 checks: widths, toolbar, columns, no cut-off
  provider names, ten slots on every row, header filters, sort, pagination, hover, the details sheet, the ⋯ menu
  (Restore armed but never confirmed), and the compact and narrow layouts. The filter bar was looked at at 1400 px and
  560 px (icons on the six triggers, the Capability menu with two ticks, the status chip, no horizontal overflow).

## Not done yet

- Nothing known: the native Models page is hidden by default (`KB_NAT_DEFAULT_HIDDEN = true`) and stays one click away.
