# The Themes page

The page of `kybernos-plugin` that lists, shows and installs themes (`KbThemesView` in `packages/kybernos-plugin/client.js`, host half
`theme-installer.mjs`). Three screens, the plan and the report as dialogs over them. It follows the validated « Business Plugins » mockup.

## What it lists

One card per theme id, from four sources merged (`kbThEntries`): the themes the product ships, the verified catalogue entries, the packages already in
the profile (« Added »), the install records (« Installed »). A card shows a cover, a chip (the field the theme speaks for, else the verification level),
the name, one line, the colour and style, and what it brings (plugins, skills).

- **Shipped themes** are folders `packages/kybernos-plugin/themes/<dir>/` (data only, the shape of `docs/dev/sector-bundles.md`). `themes-shipped.mjs`
  reads them (`readShipped`: name, tagline, accent, the words of the three Business rows, the style, `needs` = the plugins a theme requires beyond the
  core's seams, counts and names of skills, teams, automations, connectors). `GET /kybernos/themes` answers them as `shipped`, never with the folder.
  `POST /kybernos/themes { action: 'stage', shipped: '<plugin id>' }` stages one: the host knows the path, the page sends none, the level is `included`.
- **Covers are drawn** (`kbThCover`, an SVG from the id and the colour). No picture file travels: AGENTS rule 4.
- **A plugin a theme needs is « Installed »** when its owner has told its points to the registry (`/kybernos-registry/state`): the registry's own test for
  `missing-dependency`.

## The screens

1. **Gallery**: the grid, then « Add a theme from a folder » (the old folder card, small).
2. **Theme page**: breadcrumb, head (cover, name, line, counts, call to action), the plugins it needs with their status and the words it gives their
   menu rows, what else it adds (skills, agent teams, automations created off, connectors it suggests).
3. **Plan dialog** over the theme page: the plugins, then the kit (each item ticked unless it is already there), the starter goals, one consent, one
   primary action that stays disabled until the consent is ticked. Escape or a click outside closes it.
4. **Report dialog**: added, already there, failed, kept in place, style, field; then « Back to themes » (and « Open <first Business row> » when a
   plugin has declared one).

Hooks for tests: `data-kb` = `theme-grid`, `theme-card` (+ `data-theme`), `theme-back`, `theme-install`, `theme-open`, `theme-remove`, `theme-plan`,
`theme-consent`, `theme-go`, `theme-cancel`, `theme-report`, `theme-back-to-themes`, `theme-folder`, `theme-folder-add`, `theme-plugin-state`.

## Not built yet

Installing the plugins a theme needs together with the theme (the plan lists them and says which are missing; DSH's manager and the Suite switch them on),
and seeding the sample rows (`demo/sample.json`) through the business base.

## Tests

`node packages/kybernos-plugin/test-themes-shipped.mjs` (the reading of the folders, the list, `stage` by id) and, against the sandbox,
`source scripts/sandbox/env.sh && node scripts/check-themes-gallery-live.mjs [--shots <dir>] [--theme <id>] [--no-install]` (gallery, theme page, plan,
install, report, installed card, removal; real mouse, measured).
