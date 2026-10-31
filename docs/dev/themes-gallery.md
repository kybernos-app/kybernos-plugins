# The Templates page

**Words.** The interface says **Templates** (« Modèles » in French) for these sector kits, and keeps **Theme** for the look: the colours
and style of Kybernos (Settings › Theme, `packages/kybernos-theme`). The code keeps its older internal names (`KbThemesView`, `theme-installer.mjs`,
`/kybernos/themes`, the `data-kb="theme-*"` hooks, `themes/<dir>/` folders, `kybernos-themes/<dir>` ids): they are not user-visible, and renaming
them would break the installed records. Any new text the user reads says template, never theme, unless it is about the look.

The page of `kybernos-plugin` that lists, shows and installs templates (`KbThemesView` in `packages/kybernos-plugin/client.js`, host half
`theme-installer.mjs`). Three screens, the plan and the report as dialogs over them. It follows the validated « Business Plugins » mockup.

## What it lists

One card per theme id, from four sources merged (`kbThEntries`): the themes the product ships, the verified catalogue entries, the packages already in
the profile (« Added »), the install records (« Installed »). A card shows a cover, a chip (the field the theme speaks for, else the verification level),
the name, one line, the colour and style, and what it brings (plugins, skills).

- **Shipped themes** are folders `packages/kybernos-plugin/themes/<dir>/` (data only, the shape of `docs/dev/sector-bundles.md`). `themes-shipped.mjs`
  reads them (`readShipped`: name, tagline, accent, the word of the Tables row, the style, `needs` = the plugins a theme requires beyond the
  core's seams, the tables of its database and its sample rows counted table by table, counts and names of skills, teams, automations, connectors). `GET /kybernos/themes` answers them as `shipped`, never with the folder.
  `POST /kybernos/themes { action: 'stage', shipped: '<plugin id>' }` stages one: the host knows the path, the page sends none, the level is `included`.
- **Covers.** A shipped theme carries its picture as `cover.jpg` at the root of its folder, and the « next trades » as `themes/_next/<id>.jpg` listed in
  `themes/_next/next.json` (`[{ "id", "name": { "en", "fr" } }]`, at most 12). This is the one exception to AGENTS rule 4: a JPEG of at most 160 KB,
  invented scenes only (`garde-depot` and `plugin-check` accept exactly that name and size, and check the first bytes). The host serves a picture by id
  (`GET /kybernos/themes/cover?id=<plugin id>` or `?next=<id>`, `themes-shipped.mjs` `coverFile`): the page never names a path. A theme without a
  picture, or a picture that does not load, gets a cover drawn from its id and its colour (`kbThCover`, an SVG).
- **A plugin a theme needs is « Installed »** when its owner has told its points to the registry (`/kybernos-registry/state`): the registry's own test for
  `missing-dependency`.

## The screens

1. **Gallery**: the grid, the next trades, then one line that leads to Settings › Templates (« A template of your own, or from a catalogue? »). The gallery chooses; it no longer adds.
2. **Theme page**: breadcrumb, head (cover, name, line, counts, call to action), the plugins it needs with their status and the words it gives their
   menu rows, what else it adds (skills, agent teams, automations created off, connectors it suggests).
3. **Plan dialog** over the theme page: the plugins, then the kit (each item ticked unless it is already there), the starter goals, one consent, one
   primary action that stays disabled until the consent is ticked. Escape or a click outside closes it.
4. **Report dialog**: added, already there, failed, kept in place, style, field; then « Back to templates » (and « Open <first Business row> » when a
   plugin has declared one).

Hooks for tests: `data-kb` = `theme-grid`, `theme-card` (+ `data-theme`), `theme-back`, `theme-install`, `theme-open`, `theme-remove`, `theme-plan`,
`theme-consent`, `theme-go`, `theme-cancel`, `theme-report`, `theme-back-to-themes`, `theme-folder`, `theme-folder-add`, `theme-plugin-state`.

## Not built yet

Installing the plugins a theme needs together with the theme (the plan lists them and says which are missing; DSH's manager and the Suite switch them on),
and making the theme's database (`db/<id>.json`, with the sample rows of `demo/db-sample.json`) through the Tables seam; when Tables was off it is made after the restart (`applied.db.pending` in the install record).

## Tests

`node packages/kybernos-plugin/test-themes-shipped.mjs` (the reading of the folders, the list, `stage` by id) and, against the sandbox,
`source scripts/sandbox/env.sh && node scripts/check-themes-gallery-live.mjs [--shots <dir>] [--theme <id>] [--no-install]` (gallery, theme page, plan,
install, report, installed card, removal; real mouse, measured).

## Adding a template: Settings › Templates

Adding is a rare, technical gesture, so it lives in Settings (`KbThemesMarket` and `KbTplFolder` in `client.js`, section id `kybernos-themes-market`, the nav title is `templates`).
Two tabs, **From a folder** (the first) and **From a catalogue**, and a button that leads back to the gallery.

- **From a folder.** One path field (`~/…` is read by the host). The path is checked as it is typed: the host's read-only `stage` answers what the folder holds
  (`preview`: name, line, level, the plugins it needs, what it adds) or why it is refused, in plain words (`kbThReasonWords`); nothing is installed before the
  click. The button « Add and see the plan » brings the folder in through DSH's manager (`kbThBringIn`, shared with the gallery), then opens the gallery on the
  template's plan (`kbThPending`). The last three folders are kept as chips (this browser only).
- **From a catalogue.** The catalogue sources (an https address; the key id and public key are folded under « Pin a key (advanced) »), what the catalogues
  offer, and their Install buttons. Unchanged otherwise.

Hooks for tests: `kb-tpl-tab-folder`, `kb-tpl-tab-catalogue`, `kb-tpl-folder-path`, `kb-tpl-preview`, `kb-tpl-refused`, `kb-tpl-add`, `kb-tpl-open-gallery`,
and `theme-add-link` in the gallery. Checks: `scripts/check-themes-install-live.mjs` (the whole flow, sandbox only) and `scripts/check-themes-gallery-live.mjs`.
