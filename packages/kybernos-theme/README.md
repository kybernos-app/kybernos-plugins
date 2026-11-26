# kybernos-theme

Settings › **Theme**: **presets** (built-in and your own), accent, wallpaper, font, colour tokens, contrast, the **menu** (which entries show, in which
order, under which names), a **gallery** of themes to install, and the **thinking animation** (the loader and the words DSH shows while the agent works).

One page. From the top: the **strip** (what is in use, with Undo, Reset and Save as preset), the ONE **Presets** section, the **window** (a small
Kybernos drawn from what is in use, that you click to change), and, folded under it, the **Advanced editor**, in real tabs.
Every control stores a value (`DEF`) and something reads it: `test-client.mjs` refuses a control whose
key is not in `DEF`, which is how 41 dead ones went unnoticed before. The word « look » is not used on the page: the page says *appearance*.

## Presets

ONE section for everything that can be applied. A preset changes the **appearance**, the **menu**, or both (two chips on its tile say which).

- **Built-in**: the five vibes (Work, Dev, Study, Chill, Night, appearance only), two menus (Complete, Simple: the second keeps two entries and hides the
  rest through the `unlisted` rule), and the templates installed from Settings › Templates (appearance and the menu names of the template).
  A built-in preset cannot be renamed or deleted; *Duplicate to Mine* makes a copy that can.
- **Mine**: what you saved, imported or installed from the gallery. Renamed in place, exported (a `kybernos-theme-preset` file), deleted after a
  confirmation. Up to 100, names up to 40 characters and unique.
- The badge on a tile says where it comes from (Built-in, Template, Mine, Gallery); the filter says *All | Built-in | Mine* with the counts.
- **Hover** a tile and the window previews it (a preview is page state drawn in the window only, never the real interface; leaving it puts nothing back
  because nothing changed). **Click** it and an **Apply sheet** opens with a tick per part: *Appearance*, *Menu*, and *Accessibility* when the preset
  holds those settings. A part that comes from outside (a file, the gallery, a template) starts with the Menu line **unticked** and accessibility
  **never ticked**: nothing from outside changes your menu or your accessibility settings unless you tick it. Applying a menu from outside first
  keeps your current menu in Mine (« My menu »), so one click goes back.
- **Save as preset…** opens a Save sheet with the same ticks (appearance, menu, accessibility off by default), a name, and saves into Mine.
- **Undo** goes back up to 40 steps; a step holds the page's state, the animation store AND the menu. **Reset** puts the defaults back; the Import / Export
  tab has three resets with their own names (the appearance, the menu, everything). Your saved presets stay in Mine in all of them.
- A migration keeps every theme saved before this page: they are the same records, shown in Mine (names and settings are unchanged).

## The window and the quick panels

A 700 px window drawn with the colours, wallpaper, font, icon set, menu and loop of what is in use (the same `makeTheme`, `iconSvg` and loop code as
the real application), with eleven parts to click: the brand → *Style*, the sidebar → *Sidebar*, a menu row or the menu → *Menu*, the sun/moon →
*Light or dark*, the empty chat → *Wallpaper*, your bubble → *Your messages*, the agent's reply → *Agent replies*, the status line →
*Thinking animation*, the title and the message box text → *Letters*, the send button → *Accent color*, the pills under the message
box → *Under the message box*. Chips under the window hold what cannot be pointed at: *Light or dark*, *Accent color*, *Letters*, *Wallpaper*,
*Effects and shape*, *Menu*, *Accessibility*. A click opens a short panel UNDER the window, never over it (what you change must stay in view while you
change it). A click on a choice changes the appearance at once.

- The panels use the SAME controls as the Advanced editor (the main ones only). A **select** is used for 5 options or more, a **segmented control** for 2 to
  4; options are drawn in their own style (fonts in their own typeface, colour dots, corner shapes, icon samples); hovering an option or moving with the
  arrow keys previews it in the window, Enter keeps it, Escape puts the previous one back. The dice (*Surprise me*) and *Done* are kept in every panel.
- The window has **no state of its own** but which panel is open and the preview. A choice is a setting of the page (`S`, through `commit`) or of the
  animation store (`ld`, through `ldSet`); the Advanced editor sees the same state.
- **Vibes** start from the defaults of every key a theme may keep, so no bubble or font of the last one stays. They never touch accessibility.
  **Surprise me** and the dice of a panel draw at random, never accessibility or the pills.
- Added settings (`DEF`): `bubbleUser` (`auto`, `accent`, `soft`, `dark` or any hex), `textUser`, `replyBg` (`none`, `card`, `outline`, `tint`),
  `replyColor`, `textReply`, `sideTone` (`auto`, `darker`, `lighter`, `tinted`), `shadow`, `glow`, `wgSessions`, `wgChanges`, `wgUsage`, `autoHideBars`, `notifCounters`.
  - `notifCounters` (`shown` \| `hidden`, **hidden by default** since 2026-11-24, owner's call; *Advanced editor › Effects › Notification counters*; personal like the pills: never in a theme, a vibe or the dice): the number in
    brackets in the tab title and the badge on the app icon, both drawn by `kybernos-pulse`. The Theme only publishes the value, as `data-kbth-counters="shown|hidden"` on `<html>` (set with the other `data-kbth-*` marks
    by `appliquerEffets`, so it is always there); `kybernos-pulse` reads it and is told of a change by the window event `kb-counters-change` (no DOM observer, so no `ui.dom` permission for pulse). Banners and the floating window are not part of it (Settings › Widget). The locked phone preset does not mention it.
  - `autoHideBars` (*Sidebar* panel, « Bars on hover », ON by default since 2026-10-22, owner's call; personal like the pills: never in a theme, a vibe or the dice): the collapsed
    rail and the top bar of a chat slide out to an 8 px / 6 px sliver and come back when the pointer or the keyboard is in them, or while a popup
    they opened is open (an open section of the rail is `aria-expanded` too, so only a popup trigger counts). Only under a pointer that can hover.
    The three columns of the shell grid are placed by hand while it is on so the chat takes the rail's column back without a reflow; no engine patch.
  - Your bubble is DSH's own token `--dsw-specific-bubble` (declared on `body` and `body[data-ds-dark-theme]`), through the same token layer
    as the sidebar: no hook on the markup. Its text colour is `--dsw-alias-label-primary`, set inside `[data-chat-flow-kind="user"]` only,
    per scheme when it is automatic (white or ink, whichever reads at 4.5:1 on the bubble).
  - DSH draws **no bubble around the agent's replies**; the frame (card, outline, tint, colour, text colour) is ours, on
    `[data-chat-group-part="response"]` (read on a real conversation, 2026-10-22). If DSH renames that marker the frame stops showing and nothing
    else is affected; the page says so in the panel.
  - The pills under the message box are drawn by other modules (`[data-kb="status-pill"]` sessions, `[data-kb="changes"]`, `[data-kb="usage-chip"]` usage, inside
    `[data-slot="conversation.composer.dock"]`): this page only hides them.
  - `sideTone` is taken from the sidebar colour the scheme ended with (a theme's own, or an edit), in `makeTheme`.
- If the window ever fails to draw, `StBoundary` shows a note and opens the Advanced editor: a broken view never leaves a person without a way
  to change the appearance.

## The Advanced editor

Folded by default, in real tabs (`role="tab"`, arrow keys), each showing only its own controls (two columns at page width, one on a phone):

| Tab | What it really does, and how |
|---|---|
| Colors | the 17 pilotable tokens per scheme, accent ramp, the style (the shipped ones are in a select), light or dark |
| Letters | font (one select, 26 fonts in 4 groups, each drawn in its own face), text size, ligatures, logo and name |
| Shapes | radii (`--dsw-radius-*` ×0.25 / ×1 / ×1.5), shadows, glow |
| Background | the wallpaper (one select: none, then the kinds, grouped), and, with one, the glass: DSH's main surface (`--dsw-alias-bg-base`) becomes transparent so the wallpaper shows; sidebar, fields and menus get a chosen transparency (`--dsw-specific-sidebar-fill`, `-input-major`, `-menu`); frosted/liquid blur by `backdrop-filter` on DSH's stable hooks; wallpaper filters, fit and mirror |
| Effects | the CSS-only effects below, the pills, bars on hover |
| Icons | the menu icon sets (below) |
| Menu | the menu panel (below): rows, icons, show/hide, order, names |
| Animation | the thinking animation (below) |
| Accessibility | contrast level, reduce animations, focus ring, 44 px targets, underlined links, **touch comfort** (a phone width, 480 px or less: menus and dialogs as bottom sheets, rows a thumb high, Settings pages a size up, tab strips as a column, the search sheet on one scrolling line of 44 px chips with a 52 px ✕ (no keyboard hints, no « Esc »); one static stylesheet, `data-kb-touch="on"`), colour-blind palette (success/warning/error → blue/bluish green/vermilion, Okabe-Ito) |
| Import / Export | import a preset file (it lands in Mine and changes nothing until ticked), export of what is in use (YAML / JSON / CSS) with Copy and Download, the three resets |
| Gallery | themes to **try** and **install** (shipped with Kybernos, plus a signed online catalogue), search, light/dark filter, updates |

**Hooks for a live test** (`data-kb`, never the translated text): the strip `theme-strip` (`theme-strip-a`, `theme-strip-m`, `theme-modified`, `theme-undo`,
`theme-reset`, `theme-save`); a preset tile `theme-preset` with `data-id` (`vibe:<id>`, `menu:<id>`, `rec:<id>`) and `data-src` (`builtin`, `template`, `mine`);
the window `theme-studio`, `theme-st-window`, its parts `theme-zone` / `data-zone` and its chips `data-chip`; a panel `theme-st-panel` with `data-panel`;
the tabs `theme-adv-tab` with `data-id` (`couleurs lettres formes fond effets icones menu animation accessibilite partage galerie`); the menu rows
`theme-menu-row`, `theme-menu-up`, `theme-menu-down`, `theme-menu-rename`, `theme-menu-show`, `theme-menu-showall`; Import / Export `theme-import-adv`,
`theme-export-fold`, `theme-reset-adv-a|m|all`.

The CSS-only effects (glass, ligatures, brand, reduced motion, focus, targets, links) come from one
pure function, `effetsCss(S)`, inserted as a single `<style>`; it only uses DSH's stable hooks
(`data-slot`, `data-composer-card`, ARIA roles), never its hashed class names.

### Pages on a small screen (presentation)

Thirteen settings decide how the Settings pages (the first seven, under *Accessibility › Pages on a small screen*), the drawer, the empty chat, the rating of an answer and the size of the message text (the last six, under *Menu and chat on a small screen*) are laid out under 600 px (a wider screen is exactly as before). The content never changes
(same labels, texts and order); only how a row, a card, a chip, the « ? », the Kaby tabs, the drawer, the composer and the empty chat's shelf are drawn. Every default is today's look.

| Setting (`settings.*`) | Default → on | What it does |
|---|---|---|
| `tabsNav` | `tabs` → `list` | the Kaby page is a menu of five rows (Identity, Voice, Video calls, Work, Permissions), then one section per page with a quiet « ‹ Kaby » back row (a 15 px link, 44 px high) at its top and the section's name as the title (Language and the Theme editor keep their tabs) |
| `rowsLayout` | `stacked` → `inline` | a switch or one small button sits opposite its label (Memory, Language); a segmented choice or two buttons stay under the text; a note with its own button (Memory's « Not connected ») puts its text over the whole width and the button under it |
| `rowsDescription` | `below` → `info` | a description a page marked `data-kb-desc="fold"` hides behind a small « i » at the end of its label (44 px zone, `aria-expanded`); **a description that warns or changes what the setting means is never marked, so it never folds** (today: Memory's *Use memory*, *Your memory*, *Import*, *Export* and Language's *Announce*; nothing else) |
| `helpButton` | `boxed` → `bare` or `named` | `bare`: the « ? » alone, its 44 px tap zone and a focus ring kept, 80 % of the text colour (9:1 measured). `named` (the phone's Simple, owner's list item 27): the « ? » AND its word, « Help » / « Aide », in one 44 px pill (the mockup's page bar); the word is stamped by the walker as `data-kb-help-word` on each help button and drawn by `::after`, so it follows the language and no help button's markup changed |
| `cardsFrame` | `boxed` → `flat` | cards lose their border, radius and padding, one line tells the next card from the previous; notices and the dashed « always asked » box keep theirs |
| `chipsStyle` | `pill` → `plain` | a status is a word (« Ready » in the success colour) instead of an outlined pill |
| `groupTitles` | `shown` → `hidden` | the group names of the Settings menu (AGENTS, MEMORY & CONTEXT, …: the core plugin's fold headers, small labels that do nothing on a phone) leave the screen (and the focus order); a 16 px gap tells where a group ends, no line |
| `drawerSize` | `standard` → `large` | the drawer and its button for a thumb (mockup 2, 2026-11-23): the magnifier 52 px, the rows of the menu 60 px at 22 px with 28 px icons (the engine's pinned panels too), the Workspaces title 19 px and its folders 64 px, the chats of Recents 60 px, the burger 52 px, the avatar and « New chat » 56 px; no rule names a label the engine translates (« Global panels » is « Panneaux globaux » in French), so it holds in every language |
| `drawerPanels` | `shown` → `hidden` | the drawer draws only the Kybernos rows (Automations, Apps…) and then the Workspaces: the engine's own rows of the same list (its pinned pages such as « Code review » or « Automation tasks », their unpin buttons, its « More » launcher) are left out. By structure, never by word: the engine translates those names, so a rule keyed on one language left the other with extra rows |
| `composerSize` | `standard` → `large` | the composer: text and placeholder 20 px, « + », model arrow and send 48 px, the model name in a framed 48 px chip at 15 px (as wide as the name, against the send button; whole unless it overflows, then an ellipsis — the send button is never pushed out) |
| `newChatCards` | `slider` (default) → `grid` or `hidden` | what the empty chat offers to make, on a phone, in Simple and in the full app (the owner's mock-up of 2026-11-24, list items 22 and 24): `slider` = ONE row of the shelf's own illustrated cards (112 × 84 px, 14 px labels, snap) over the composer with « See all » opening a sheet of every type, and the stack sitting at the bottom over the keyboard; `grid` = the same six cards in three columns on the page instead of the slider, « See all » kept; `hidden` = no card, the engine's own centred empty chat. A tap on a card puts its chip and the start of the message in the composer, keeps the keyboard up and never sends. The Kybernos plugin draws it (`.kb8-ncs`); the default needs no token, `grid` and `hidden` are tokens `nccards-grid` and `nccards-hidden` |
| `rating` | `thumbs` (default) → `stars` | how an answer is rated on a phone (the row under it, list item 31, the owner's rule of 2026-11-24: « thumbs, not stars », in Simple AND Complete): `thumbs` = two thumbs of 44 px in the row, up = a 5 sent at once (a thumb on, then the share box ticked as it was sent, which can be unticked, then « Thanks »), down = a 1 that opens the same sheet as a low star (issue type, comment, Skip / Submit); `stars` = the card « How was this result? » and its five stars, as ever, and what a wide screen always shows. What is stored does not change: the host keeps a note from 1 to 5. The Kybernos plugin draws both groups and the page shows one (token `rating-thumbs`, on by default: the only setting whose default turns a token on); the locked Simple preset asks for `thumbs` too |
| `messageSize` | `standard` (default) → `compact`, `large` or `xlarge` | the size of the text of the messages on a phone (list item 33), four sizes two pixels apart: `compact` 15 px (what the engine drew), `standard` 17 px (the default, Simple and Complete alike: the owner's mock-up), `large` 19 px, `xlarge` 21 px; the code of a block is 12, 13.5, 14 and 14 px and scrolls sideways, inline code 13, 14, 15 and 15 px. These are the sizes that SHOW: the chat says `text-size-adjust: 100%` itself, and the phone layer no longer scales the browser's text (its old 118 % lost to the engine's own `html { text-size-adjust: 100% }`). The default is drawn by the phone's stylesheet (`kybernos-mobile/mobile.css`, the block « The text of the messages » at its end), so it has no token; the others are three tokens on the chat (`--dsh-content-font-size` on `[data-slot="conversation.chat.flow"]`, which the engine's bubble and markdown read). The menu is not touched, and General › Font size no longer moves the messages on a phone |

The phone's Simple preset turns on all but the defaults (ten of the layout, the thumbs and the 17 px text) (`locked-simple` `options.presentation`, only while the app is in Kaby mode); a person's own choice wins anywhere; none is part of a theme
(`PRESET_KEYS`): a layout of a screen is not a look. Mechanism: ONE attribute on `<html>` (`data-kb-pres="tabs-list rows-inline …"`, one token per setting that is on) and ONE static
stylesheet (`presCss()`, `PRES_RULES`) that names the balisage of the pages in one place and takes over the phone layer's rules by specificity (`:is(html,#kb-pres)` counts as an id). That place is the block between the `// kb-pres:begin` and `// kb-pres:end` lines of `client.js`; the guards of the class prefixes (`kbmem-`, `kbhp-`) read the bundle without it, and a Theme test pins that the rest of the bundle names none.
The two things CSS cannot do, the « i » and the menu / page navigation, are added to the DOM by an idempotent walker (`presWalk`) that only runs while a token is on, next to what the page drew,
and puts them back if a render removes them. The touch layer also fixes three small things it used to miss: the « Import… » label (29 px), the « ⋯ » of a preset tile and the report button of the
Simple help card.

## Layout

| File | Half | Role |
|---|---|---|
| `client.js` | browser | the page, the colour engine, the theme library, the thinking-animation runtime |
| `index.js` | host | mounts five routes, puts the boot sheet in the index through `webserver/index-inject`, seeds the two skills |
| `loader-store.mjs` | host | pure `node:fs` store behind `/kybernos-theme/loader-store` |
| `preset-store.mjs` | host | pure `node:fs` store behind `/kybernos-theme/preset-store` (the theme library) |
| `boot-store.mjs` | host | the boot sheet: the token layer and font the browser half last applied, validated, stored under `<dsh home>/kybernos/theme-boot.json` and rendered as `<style id="kbth-boot">` (see below) |
| `themes-catalogue.mjs` | host | pure rules of the gallery's catalogue: shape of a theme, Ed25519 signature, no rollback, shipped vs signed |
| `themes-gallery.mjs` | host | disk and network behind `/kybernos-theme/gallery` (cache, bounded download, origin guards) |
| `gallery.json` | data | the SHIPPED catalogue, built from `catalog/themes/*.json` by `scripts/themes-catalogue.mjs` |
| `themes-pubkey.json` | data | the public key(s) that sign the online catalogue (empty until the maintainer embeds one) |
| `seed-skills.mjs` | host | copies `skills/*/SKILL.md` into `<dsh home>/skills/` without overwriting user edits |
| `skills/loader`, `skills/loading-text` | skills | the two skills (see `skills/README.md`) |
| `vendor/lottie_light.min.js` | host asset | lottie-web 5.12.2 (MIT, see `vendor/NOTICES.md`), served lazily |

Tests (all pure node, CI runs them): `test-client.mjs`, `test-loader-store.mjs`,
`test-preset-store.mjs`, `test-boot-store.mjs`, `test-themes-catalogue.mjs`, `test-themes-gallery.mjs`, `test-seed-skills.mjs`
(and `scripts/test-themes-catalogue.mjs` for the publishing side). `test-client.mjs` renders the page with `react-dom/server` when react is
resolvable (`NODE_PATH=<a node_modules with react + react-dom>`) and skips that stage otherwise.
The page on the real GUI is driven on the sandbox (`scripts/sandbox`), because a click on the mode or the size is written into the profile of the DSH it talks to
(`docs/dev/live-testing.md`). `scripts/check-theme-live.mjs` and `scripts/check-theme-studio-live.mjs` were written for the former two-layer page (Simple / Advanced,
nine tabs, « My themes »): they need rewriting for this one before they can be run.

## First paint (the boot sheet)

The look used to come back only when this bundle's JavaScript activated. On a slow link that is long
after the shell has painted: measured on the sandbox with a link throttled to 250 KB/s, the page showed
DSH's default palette from 4.3 s to 38.5 s before the theme applied. Now the browser half posts what it
**persisted** (the token layer and the font, never a trial being previewed) to `POST /kybernos-theme/boot`;
the host validates it, keeps it in `<dsh home>/kybernos/theme-boot.json`, and adds it to every index render
through DSH's own `webserver/index-inject` seam (the seam DSH's built-in theme bootstrap uses) as a
`<style id="kbth-boot">` right after `<head>`. The browser half removes the sheet two frames after its own
layer is in place, so the sheet can never outvote a later choice.

- What crosses the route ends up inside a `<style>` of every page, so it is never taken as CSS: token names
  must be `--dsw-*`, values are matched against a strict grammar (hex, rgb[a], hsl[a], lengths), the font
  against a stack grammar, and the sheet is built from the validated parts only (`boot-store.mjs`).
- Not in the sheet: the wallpaper (a `div` the browser half adds) and the effects sheet (glass, motion,
  focus ring). They still appear when the bundle activates.
- Without the seam (a DSH that does not emit `webserver/index-inject`) nothing is injected and the page
  behaves as before.

## The Kybernos accent (orange unless the look has its own colour)

The Suite, Workers, the core's switches and the Composio filter pill draw their switches, active tabs, accent buttons and kicker lines with one token,
`--kybernos-accent` (and `--kybernos-on-accent` for the ink and the ON knob), declared once in `kybernos-plugin` (`KB_ACCENT_CSS`): the brand orange by
default, a darker orange on the light schemes (3:1 on white). A look that sets its own brand colour (an accent, or a `<scheme>:brand` override, as Neutral
violet and Ember do) says so by writing `<html data-kbth-brand="light dark">` (the schemes that have one; `accentsPropres` in `client.js`, applied with the
token layer, removed with it): the accent is then the brand token. OLED, Clair and "DSH default" set no brand, so the orange stays.
`scripts/check-accent-live.mjs` measures it in four looks; `scripts/test-display-rules.mjs` pins the declaration and fails when a literal `#ff7a1a` comes back.

## What a preset keeps (the library and the file)

A preset record is `{ id, name, source, at, settings?, menu?, author?, gid?, v? }`: a name, a **source** (`me`, `file`, `gallery`, `template`), and at
least one of two parts. The **appearance** part (`settings`) is grouped so that the person chooses what travels with it: colours, accent and sidebar
tone (always), font, corners and shadows, menu icons, bubbles and replies (the *chat* group), glass and wallpaper, accessibility. Accessibility
is off by default when saving: contrast, the colour-blind palette and big targets are a need of the
person, not a style, so a preset never changes them unless it was saved with them (and never when it comes from outside). The **menu** part is a menu
document (below).

- A preset is **data**, never code. The only values it can carry are the ones `sanitiserImport`
  accepts: known keys, valid types and ranges, and fonts and wallpapers that already ship with this
  plugin. A file cannot load a font, an image or anything else from outside; its name is drawn as text.
  The same check runs when a file is imported, when the browser copy is read, and when the disk copy
  comes back; `preset-store.mjs` checks the shape again on the way in and out (it cannot know the
  fonts and wallpapers without copying their tables, so it leaves the meaning to the browser). Importing **adds** a preset and applies nothing; an
  old export of the whole look (no frame) still imports, as an appearance.
- The file format: `{ "format": "kybernos-theme-preset", "version": 1, "name", "author"?, "settings"?: { … }, "menu"?: { … } }`.
  `PRESET_GROUPS` in `client.js` lists what the appearance may retain; `SETTINGS_KEYS` in `preset-store.mjs`
  must stay equal to it (`test-client.mjs` fails when they drift).
- Library: `<dsh home>/kybernos/theme-presets.json`, `{ v: 1, updatedAt, presets: [...], menu?: <menu document> | null }` (the newer `updatedAt` wins).
  Up to 100 presets, names up to 40 characters and unique (a name taken by a built-in preset counts).

## The menu

The sidebar menu is arranged from this page (Menu tab, or the *Menu* part of the window): the **real** rows of this install, from the registry the
menu publishes (`window.__KB_MENU_ENTRIES__`: `{ v: 1, list(), subscribe(fn), hook: 'data-kb-row' }`, `list()` giving `{ id, icon, name }` in the default
order). Each row can be shown or hidden, moved (drag, or the up/down buttons and the keyboard) and renamed **per language** (`en`, `fr`, `es`, `ar`: a
row is named by the label of the page language only, never by one of another language). *Workspaces*, *Settings* and the account are never hideable and
are not in the registry. *Show every entry* is always there, even when an app locked the arrangement (`locked`).

- **The menu document** (called a MENU DOC): `{ entries: [{ id, shown, order, label? }], unlisted: 'show' | 'hide', locked }`. A listed row is shown or
  hidden by its entry and sits first, by `order`; a row that is not listed keeps its default order after them and is hidden when `unlisted` is `'hide'`.
  At most 24 entries; names 1..40 characters, no `<` or `>`; ids as `/^[a-z][a-z0-9-]{1,23}$/`, never `workspaces`, `projects`, `settings`, `account`.
  **Three copies of the sanitizer agree** (`sanitizeMenu` in `preset-store.mjs`, `menuClean` in `client.js`, `kbMenuPrefsClean` in `kybernos-plugin/client.js`);
  each package's test pins the same vectors.
- **Where it lives**: the menu in use is `localStorage['kybernos.theme.menu.v1']` (`{ v: 1, updatedAt, menu }`, read synchronously by the menu at first
  paint) and, on the disk, the `menu` field of the library file. After every write the page fires `kb-menu-prefs-change` on `window`; the menu also follows
  the `storage` event. An arrangement never writes the appearance (`kybernos.theme.v1`).
- **The menu hides a row by its hook** (`data-kb-row="<id>"` on the row button), never by its translated label.
- **Two more surfaces** (the Menu panel's other zones, a segmented control *Menu | Account menu | Settings pages*): the account menu the avatar opens, and the
  Settings pages. They are the optional `surfaces` of the MENU DOC, `{ secondary?: S, settings?: S }` with `S = { entries: [{ id, shown, order }], unlisted }` (no
  names: only the main menu's rows are renamed; at most 24 and 64 entries). Never hideable, so never stored: on the account menu `account`, `referral`, `settings`,
  `logout` (they open the app's own screens, which the phone reaches no other way); on the Settings pages `general` (the page Settings opens on). The panel draws a
  padlock and « always shown » on them. A document without `surfaces` is the main menu alone, as before; a surface that says nothing is left out. The same three
  sanitizers cover `surfaces`, and the registry gives the entries: `list('secondary')` and `list('settings')` return frozen `{ id, icon: null, name, locked }`
  (settings also `group`, `groupName`), with `hooks: { main: 'data-kb-row', secondary: 'data-kb', settings: 'data-kb-t' }` telling the hook each is hidden by (an
  older registry has no `hooks`: the zones are simply not offered). Hidden by **hook**, never by label, by a style the *kybernos-plugin* bundle owns
  (`#kb-surfaces-css`, painted at once from the stored copy). Only whole Settings pages: what is inside a page has no hook, so it is neither shown nor hidden.
- **Locked presets** (`window.__KB_THEME_LOCKED__ = { v: 1, ids(), get(id), name(id) }`, defined once, frozen, not writable, not configurable): arrangements the
  page ships and a person can neither pick, edit, export nor delete (not in the library, not a built-in tile). `get(id)` is a fresh MENU DOC (`locked: true`) or
  `null`; `kb-locked-presets-ready` is fired on `window` when it appears. Today one: `locked-simple`, the phone's Simple (main rows: Automations (the real `tasks` row, under the registry's own name) and Apps (the real `connectors` row, renamed); the Kaby row at the top is hidden, the « Kaby » folder under Workspaces and Settings › Kaby are the ways in; the
  conversations being the drawer's own list; anything else hidden; the account menu: the owner's defaults; **five Settings pages**: Theme, Language, Memory & lessons, About and Kaby, in that order (the app's own parts, « The Kybernos app », are drawn inside About since item 28), so Usage, Connectors and
  General are hidden. General is hidden by THIS preset only (the lists of surfaces carry a `trustedNever` that only the Kaby-mode reader unlocks: a stored or imported arrangement can never hide it) and only in the phone layout, because
  at a wider width Settings opens on General. The preset also carries `options: { touch: true, presentation: { tabsNav: 'list', rowsLayout: 'inline', rowsDescription: 'info', helpButton: 'named', cardsFrame: 'flat', chipsStyle: 'plain', groupTitles: 'hidden', drawerSize: 'large', drawerPanels: 'hidden', composerSize: 'large', newChatCards: 'slider', rating: 'thumbs', messageSize: 'standard' } (the thirteen presentation settings above, on while Kaby mode is), appPage: { log: false, computer: 'linked' }, padlock: [...], messageActions: 'tap' }` — `touch` is the touch comfort setting above, on while Kaby mode is, without writing the person's own settings; `messageActions: 'tap'` is read by the Kybernos plugin (block `kb-msg-actions-tap`): the row under the agent's answers is hidden until a tap on the answer shows it (a second tap or a tap elsewhere hides it; a link, a button, a selection, a long press or a drag does not toggle; an answer still being written has no row to show yet) and its buttons are 44 px zones; absent or another word = the row is drawn as in the full app (the hover of a computer); `appPage` is read by kybernos-mobile for « The Kybernos app » page of Simple (`log: false` leaves out the engine-log card, `computer: 'linked'` draws the computer card only when a computer is really linked; absent or unreadable = everything is drawn, as in the full app); `window.__KB_THEME_LOCKED__.options(id)` reads them, as a deep copy). The phone's Kaby mode (the `KabyMode`
  token) draws nothing of its own from it any more: the *kybernos-plugin* bundle follows it in that mode for all three surfaces (the real sidebar's rows, the account menu, the
  Settings pages) in place of the person's own arrangement, and the phone's drawer shows the real sidebar. When the preset cannot be read, the plugin filters nothing:
  Simple shows the full app unfiltered.
- **Seams**: `window.__KB_THEME_APPLY__` keeps its two forms (a preset id; a settings bag) and has a third for a template,
  `{ preset: { name, settings?, menuLabels?, gid?, v?, author? }, apply: { appearance, menu } }`: it stores ONE record (`source: 'template'`) and applies only the
  ticked parts; `window.__KB_THEME_MENU__ = { v: 1, current() }` is read-only.

## Menu icons

The sidebar menu can be drawn by a **set** of icons: grey at rest, in the entry's own colour on the open
page, flat fills only (no outline). Twenty-one sets ship, chosen in Settings › Theme › Advanced editor › **Icons**: *Classic* (the application's line icons, the
default), five sober ones (*Flat*, *Duotone*, *Bauhaus*, *Soft gradient*, *Tile*) and fifteen with their own
technique: *Matrix* (dots), *Mondrian* (blocks), *Rings*, *Isometric*, *Kawaii* (two eyes), *Blinds*
(vertical slats), *Facets*, *Long shadow*, *Halftone*, *Bubbles*, *Honeycomb*, *Constellation*, *Two-tone*,
*Stamp* and *Nature*.

- **A visible link with the entry**: every set draws the same eight things, so the icon says what the
  entry is: a cloud (Cloud Computer), a robot head (Kyber), a bar chart (Dashboards), three people (Agent
  Teams), a picture (Creations), a cog (Automations), an open book (Skills), a
  plug (Connectors). A set changes how they are drawn, never what they are. `ICON_PICTO` holds the
  shared silhouettes; a set is either a renderer over them (Kawaii, Blinds, Long shadow, Halftone, Bubbles,
  Two-tone, Stamp), a bitmap (Matrix, Honeycomb) or hand-drawn (the others).
- **Cut-outs are holes**: eyes, the picture's inside, the cog's hub are SVG masks, not white fills, so
  they show whatever is behind the row (light, dark, hover, selected).
- **Where it is stored**: the `iconSet` setting, stored with the appearance; a preset can retain it (its own
  group in the Save sheet), and a shipped theme may carry one (`skinPatch`, and the gallery themes).
- **How**: the drawings are pure code in `client.js`, between the `icon-sets` markers (cut out and run
  as it ships by `test-icon-sets.mjs`). `appliquerIcones` publishes the choice on
  `window.__KB_ICONSETS__` (`current()`, `svg(entry, on, size)`, `sets`) and fires `kb-icons-change`;
  `kybernos-plugin`'s menu reads it at render and keeps its own line icons when there is no
  registry or the set is *Classic*. At rest nothing is coloured: the icons follow the row's text colour.
- **Adding a set**: one drawing per entry (8: `cloud kyber dash teams creations auto skills plug`, the ids of the registry's icons), a
  line in `ICON_SETS` with its French and English name; the tests require every entry at rest and open,
  no stroke, inside the 24 × 24 box, and a look that no other set already has.
- The entry colours are one table (`ICON_HUES`); the *Classic* card is drawn by the application, which
  lends its line icons through `window.__KB_MENU_CLASSIC__`.

## The gallery

**Gallery** lists themes to install. There are two catalogues and one answer: the **shipped** one
(`gallery.json`, it travels inside the signed Suite archive and works offline) and the **online** one
(`themes.catalog.json` + a detached Ed25519 signature, verified by the HOST before the page ever sees it,
cached on disk and verified again on every read). The signed one shows when it is at least as recent as the
shipped one; an older one is refused as a rollback; a refused or unreachable refresh changes nothing and the
page says why. Opening the tab asks the online catalogue once (`themesCatalogueUrl` in
`<dsh home>/kybernos/settings.json`, `""` turns it off); nothing else in this plugin uses the network.

*Try* draws a theme without storing it (closing Settings or reloading gives the stored look back, any change
made during a trial ends it; a theme of the other mode switches DSH's mode for the trial, and reload or closing Settings
switches it back; only killing the tab in the middle can leave the new mode behind); *Install* copies it into Mine (source « gallery », with its catalogue id
and version); an installed copy gets *Update* when the catalogue's version moves. A catalogue theme never
carries accessibility settings. How it is published, signed and tested: `docs/dev/theme-gallery.md`.

## The thinking animation

DSH mounts a block `[data-chat-running]` at the bottom of the chat while the agent works: a 14 px
whale tail, then « Deep diving for 12s ··· » drawn by `TextShimmer`. The block is mounted again
for every answer. The plugin changes it **without touching the engine**:

1. a `MutationObserver` spots each new `[data-chat-running]`;
2. it hides the whale tail (`data-kb-ld-hide`) and inserts the chosen animation first in the block;
3. it replaces DSH's phrase (`chat.deepDiving`, read in the active language through
   `ctx.locale.bind('chat')`) by one word of the chosen ambiance, keeping DSH's own template and
   duration. DSH writes the text twice: a text node, and the `data-shimmer-text` attribute that
   the sweeping highlight paints with CSS `::after`. **Both** are rewritten, and re-written after
   every once-a-second update from React;
4. an unknown structure is left alone; nothing in here can throw into DSH; disabling the plugin
   gives the whale tail back.

A draw happens once per answer: a block that comes back within 1.5 s is the same answer.

### What the user controls

- **Rotation** of up to 4 animations, drawn at random (never the same twice in a row, optional)
  or in order.
- **Animations**: 34 original drawings (`LD_PRESETS`: geometric ones, then plants, objects, animals and
  manga-flavoured ones, all 48×48 SVG animated by the `.kb-ld .a-*` classes of `client.js`), the user's own
  files (SVG, Lottie `.json`, GIF/WebP/PNG, 200 KB max), and files written by the `loader` skill. The
  picker's cards are small (about 105 px wide).
- **Ambiances** (`LD_PACKS`): the DSH original and 11 trades, words in French and English, plus
  « My pack » (the user's own words, or those written by the `loading-text` skill).
- **Settings** (folded): size 14/24/40 px, accent tint, speed, delay before showing, keep the
  words, change the word every 8/15 s, show the duration.

The Lottie drawings and Dribbble pack the feature was designed around are **not** bundled
(they belong to their author); the page tells the user to import their own files.

### Rendering imported files

Imported content is never injected as HTML. An SVG goes through `<img>` (several colours) or a
CSS `mask-image` (a single `currentColor` colour, so it can be tinted: an animated SVG does keep
animating inside a mask); a GIF/WebP/PNG through `<img>`; a Lottie through lottie-web, loaded on
demand from `/kybernos-theme/vendor/lottie.js`. The browser removes scripts, event handlers and
external references before saving; the host **refuses** (never rewrites) anything that still
contains any (see `loader-store.mjs`).

## Where things live

| What | Where |
|---|---|
| theme (look) | `localStorage` `kybernos.theme.v1` |
| Presets (Mine) | `localStorage` `kybernos.theme.presets.v1`, copy on disk `<dsh home>/kybernos/theme-presets.json` (one document, the newer `updatedAt` wins as a whole; its `menu` field is the arrangement in use, mirrored in `kybernos.theme.menu.v1`) |
| the online gallery catalogue | `<dsh home>/kybernos/themes-catalogue/` (the verified document and its signature) |
| thinking-animation settings | `localStorage` `kybernos.theme.loader.v1`, copy on disk `<dsh home>/kybernos/loader-settings.json` |
| the *selected* user animations (first paint) | `localStorage` `kybernos.theme.loader.cache.v1` |
| imported animations | `<dsh home>/kybernos/loaders/<id>.json` |
| animations written by the `loader` skill | `<dsh home>/kybernos/loaders/<slug>.svg` |
| « My pack » words | `<dsh home>/kybernos/loading-text.json` |

`<dsh home>` is `DSH_HOME`, else `~/.dsh`. The browser copy is what paints first; the disk copy is
what survives clearing site data, another browser, or DSH Desktop picking another port. A newer
`updatedAt` wins. Tests and live checks switch the disk off with
`window.__KB_THEME_HOST_STORE__ = false` before the page loads.

The host routes are **not hot-reloaded**: restart `dsh web` after changing `index.js`,
`loader-store.mjs`, `preset-store.mjs` or `themes-gallery.mjs`. A page without them still works (imports stay in the browser until reload).

## Limits worth knowing

- **Terminal / TUI.** This plugin skins the web GUI only. There is no Terminal tab: colour depth, cursor
  and ANSI palette belong to the TUI's own configuration.
- **DSH's hooks.** Glass and the brand toggle rely on `data-slot="sidebar"`, `data-slot="sidebar.brand.*"`,
  `data-composer-card` and ARIA roles. If DSH renames them the effect silently stops (the tokens and
  the wallpaper keep working). The veil makes `--dsw-alias-bg-base` transparent for the whole app:
  one element used it as a *text* colour (the workspace tile in `kybernos-cloud`, fixed); a future DSH
  element doing the same would show up as invisible text. Probe with the colour set to magenta.
- **The wallpaper is not visible inside Settings** (the settings screens use other surfaces); it shows
  behind the chat and the other pages. The « Glass and background » tab has a small preview for that reason.
- **Line height and density** have no lever in DSH (only the font-size delta is exposed), so there are
  no such controls.
- **Words and ambiance names** are French and English; other languages fall back to English.
- **Light scheme** was checked by removing the dark attribute client-side (see
  `docs/dev/live-testing.md`), never by changing the user's stored preference.
- A colour compiler (`lib/` + frozen Catppuccin/Rosé Pine/Selenized palettes) was prepared but never wired in; it was removed as dead code (see git history before this change if it is ever built).
