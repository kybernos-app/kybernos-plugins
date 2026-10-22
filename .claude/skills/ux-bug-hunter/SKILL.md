---
name: ux-bug-hunter
description: Hunt bugs, unpleasant or unoptimised UX, clutter, missing help and visual inconsistencies on a screen, a plugin or the whole Kybernos GUI (the DSH shell in this repo and the web app), fix the minor ones without asking and bring every large visual change to the owner as a mockup first. Use when asked to audit, polish, declutter, "make it nicer", hunt bugs, check a page before a release, or after building any user-visible screen.
---

# UX and bug hunter

One pass, three outputs: **fixes** (small, made now), **proposals** (visual changes, shown before anything is built) and
**bugs** (broken things, fixed when the cause is clear). The target is a product that is calm, predictable, complete and
helped: nothing jumps, nothing is missing, nothing is said twice, nothing needs explaining that the screen could have explained.

Read `AGENTS.md` first. Two surfaces: the DSH shell and its plugins (`packages/`, this repo) and the web app (the app repo,
`apps/app`). The method is the same; the way to render each is in section 1.

## 0. What you may change alone

**Class A, fix alone and list it afterwards.** All of: it stays on one screen; it does not change the layout's structure,
the navigation, the colours, the brand or what information is shown; it is undone by reverting one small commit; it
changes no data and no behaviour. Typical: sentence case instead of capitals, a few pixels of alignment, a missing label
or tooltip, a missing logo fallback, a repeated word removed, a missing help text, an empty state's sentence, a spacing
value taken from the tokens, a truncated text given its title, a stray control moved to its row's edge.

**Class B, propose first, build nothing.** Anything that changes how a screen looks or is organised: a new layout, moving
a block to another page, removing a section or a feature, a new component pattern, colours, typography, navigation, an
illustration, a new preview, a new empty-state design, anything touching several screens, anything the user would have to
relearn. Show **the measured problems and a mockup with its states** (the `ui-mockup` skill builds one from this repo's own
tokens: never an invented style), give one recommendation, ask which parts to build, then build only what was approved.
A reference screenshot of another product is not a mockup of ours: study first.

**Class C, a bug.** Fix it when the cause is clear and local, with a test that fails without the fix. Otherwise report it
with the steps to reproduce, and do not patch what you do not understand. A fix that visibly changes a screen is class B.

When unsure, it is B. Never put A and B in one commit. Never fix a B "while you are there".

## 1. Look before you judge

1. **List the screens from the source, not from memory**: the Settings cells and their groups (`GROUPES` in
   `packages/kybernos-plugin/client.js`), every slot a bundle registers (`settings.section`, `sidebar.right.pane.tab`,
   `conversation.composer.dock`...), each `packages/*/help.json`, `packages/kybernos-hub/catalog.json`. For the web app, its routes.
2. **Render each one for real.** Code reading is not a verdict, pixels are. DSH: `docs/dev/live-testing.md` and
   `scripts/live-page.mjs` (own headless Chrome, signed-in, nothing of your DSH changes). Anything that clicks something that
   writes goes to the sandbox (`scripts/sandbox/`). Web app: the render harness of the app repo (`e2e/TEST-AUTH.md`).
   Screenshots go in the scratchpad, **never in git** (AGENTS rule 4), and you **look at them** with the Read tool.
3. **Take every state, not just the default**: empty, one item, fifty items, loading, error, a 60-character name, French
   (about 30% longer), Arabic (right to left), dark and light theme, a phone's width (375 px), hover and keyboard focus.
4. **Run the probes** (section 3), then walk the checklist (section 2) with your eyes: the probes find what can be
   measured, not what is ugly.
5. **Classify** every finding A, B or C, fix the A and C you may, mock up the B, report.

## 2. What to hunt

Each line is something the owner has already complained about or that a probe measures. Treat a hit as a suspect until you have seen it.

**Names without a mark.** Every list, card or menu that names an app, provider, model, connector, workspace or skill shows
a logo or icon, and the same size for all of them. Fallback is a generated monogram or a neutral tile, never nothing, and
never the same blank on every row. A list where only some rows have a logo is the bug; a list with none is a question for B.

**Search and pickers that find less than they hold.** The icon picker answers « sport » with one icon where the icon library's
own search shows dozens: it matched the name and a hand-kept keyword list, as an exact substring. Try every search with five
synonyms, a plural, an accent, a French word, a typo and a two-word query, and compare the count with the source of truth.
Results show a count, an empty result offers « clear search », typing never loses focus.

**Capitals and wording.** Titles, section labels, column headers, badges and buttons are in sentence case. No
`text-transform: uppercase` on a label (grep the bundles: each hit is a candidate), no title written in capitals. Acronyms
(API, URL, MCP) stay. One verb per action across the product (Add, not Add here and Create there). Both languages
through `kt(fr, en)`, no French left in the English UI and the reverse (`scripts/audit-i18n-live.mjs`).

**Repetition.** The same thing said twice on one screen: a title and the line under it, `Settings › Settings`, a badge
that restates the line beside it (`MD` next to `MD · 5 KB`), a status that is identical on every row (« Available » ×40
carries nothing: say it only when it differs), the same icon on every row, every row starting with the same word, a
help text that restates the label. Remove the second one.

**A frame that does not move.** Switching menu, tab or page must not move the dialog, the menu, the header or the content
box, change their size, make a scrollbar appear and shift the content, or let something load in and push the rest. The
title of every page starts at the same x and y (first audit: Settings titles sat at x 272, 289, 300 and 330, y 54 to 110). Measure
the landmarks page by page (section 3); for Settings the check is ready: `scripts/check-settings-frame-live.mjs [--worktree]`. Fixes: a fixed or minimum height on the content box, `scrollbar-gutter: stable`, a
skeleton in the real row's own box (`docs/dev/skeleton-screens.md`), reserved room for late content.

**Alignment and rhythm.** Menu entries, icons, labels and rows share one leading edge; icons share one size; a row's
text is centred on its icon; spacing comes from the scale, not from each author; siblings have equal padding. Cards of one
row have their titles at the same height, whether or not one of them has a subtitle.

**Lists, grids and pages.** The order is meaningful and stated (sorted by name, by date, by use), and the same everywhere.
No orphan: a card alone on the last row, above all while a next page still holds more, means the page size is not a
multiple of the column count (size pages by the columns, or do not paginate a list that fits). No pager over a single
page. The pager, the search and the view switch sit on one toolbar line, not on three lines with large gaps between them.
Selection and scroll survive a page change.

**Previews.** Everything that stands for a file, creation, page, theme or skill shows what is inside (a thumbnail, the
first lines, the rendered page), not a generic icon and an extension repeated on every card. When there is nothing to
render, generate something from the content, not an identical placeholder.

**Stray controls.** One primary action per view, in a conventional place: the header's right end, or directly under what it
belongs to, aligned to the row's edge. A button floating in the middle of a row, between a sentence and nothing, is
a bug. Toolbar controls sit together, not scattered.

**Empty states.** An empty list is a place to teach: our own illustration (the new-chat art, not a stock one), one sentence
saying what lives here, and the button that adds the first item or the way to do it. A dashed box with one sentence is a bug.
Tell « nothing yet » from « nothing matches your filter » (offer to clear it) from « it failed » (offer to retry).

**Calm (declutter).** For each screen ask what can go. A few blocks per page; one level, no Simple/Advanced switch; a long
list becomes a searchable select; import, library and editors go in a window; rarely touched settings fold behind a one-line
summary; a page with ten tabs or three rows of controls is too busy: propose grouping (B). Decoration that tells nothing
(an icon on every row, a border around a border, a card inside a card) goes.

**Help.** Every page and plugin has its « ? How it works » (`help.json`: what, steps, where, one good-to-know, in French
and English, without developer words). Icon-only buttons have a name and a tooltip. An empty state and an error say what to do next.
No jargon in text a person reads: no file names, no config keys, no paths (« block of kyber.yml », « skills/ »), no emoji.

**States and feedback.** Loading is bones in the real box, never a bare spinner or a jump. Disabled says why. Success is
acknowledged. A destructive action asks, and can be undone when it can. Errors are readable and never show a stack.
Text that does not fit is cut with an ellipsis and a title, never silently.

**Controls and keyboard.** Click targets of at least 24 px (32 comfortable, 44 on touch). A drawing smaller than that keeps its size and gets an invisible `::before` that reaches 24 px (placed from the padding box: a border takes more off); a bare text link keeps its line's height, the standard exempts it. `scripts/check-hit-targets-live.mjs [--worktree]` measures it. Tab reaches everything in a
sensible order, focus is visible, Escape closes what opened, Enter confirms. The current page is marked in its menu.
Nothing important lives only in a hover. Nothing covered by another layer (`elementFromPoint`). No dead link or button.

**The house.** Colours from the DSH tokens with a fallback, never a hard-coded theme colour; one icon family and one stroke;
the brand as in `docs/dev/brand.md`; both themes legible (text contrast at least 4.5:1: `scripts/audit-contrast-live.mjs` measures
it, section 3); a CSS prefix that no other bundle uses (`scripts/audit-css-prefixes.mjs`). Where the owner has not chosen a
recipe (decision D2 in `scripts/test-consistency-guards.mjs`), propose one as B instead of inventing it.

**Plain bugs.** Console errors and unhandled rejections, 4xx/5xx requests, a count that does not match its list, stale data
after an action, a duplicate entry, a state lost on reload, a broken image, text overflowing its box, something
covered, a page that scrolls sideways, a double submit.

## 3. The probes

`probes.js` in this folder measures most of the above in a rendered page (capitals, rows without a mark, misaligned rows,
repeated title/word/value, constant badges, same icon, unordered list, orphan card with its pager, missing preview, stray
button, bare empty state, jargon, tiny targets, nameless controls, clipped text, broken images, covered controls, layout
shift, JS and HTTP errors) and takes the **frame** of the shell so you can compare pages. It is read-only.
`scripts/check-ux-probes.mjs` proves each detector against a faulty and a clean fixture page: run it after touching `probes.js`.

```js
import { readFileSync } from 'node:fs'
import { openLivePage, openSettings, goToSettingsPage } from './live-page.mjs'
const live = await openLivePage({ width: 1400, height: 900 })
const ev = async (js) => (await live.page.evalJs(js, 15000)).val
const probes = readFileSync('.claude/skills/ux-bug-hunter/probes.js', 'utf8')
await live.page.evalJs(probes)                                   // again after every reload: it lives in the page
// per screen: reach it with a click that only opens something, then
const report = JSON.parse(await ev('JSON.stringify(window.__UXH__.scan())'))     // findings: { kind, level, where, text, detail }
// the frame, page by page:
const frames = []
for (const p of pages) { await goToSettingsPage(live.page, p); frames.push({ label: p, frame: JSON.parse(await ev('JSON.stringify(window.__UXH__.frame())')) }) }
const moved = await ev(`JSON.stringify(window.__UXH__.diffFrames(${JSON.stringify(frames)}))`)   // anything listed jumps
await live.close()
```

**Contrast** is measured apart, by `contrast.js` (same folder; `scripts/check-contrast-probe.mjs` proves it on a faulty and a clean page) through
`scripts/audit-contrast-live.mjs [--only "A|B"] [--json f]`: every Settings page, the hits grouped by pair of colours. `--mode Light|Dark` (sandbox only, the
mode is put back) measures the other theme. It leaves out drawings (`aria-hidden`), disabled controls, text that is animating and text on a gradient, so a
hit is a real one; a class with a hashed prefix belongs to the engine, which is a report, not a fix. Pale text is a bug (class C) when it is ours; a new
ink for a status colour is a colour change, so class B.

`level` is `bug`, `ux` or `check`; `check` means look at it. A probe cannot know a list is meant to have no logos or that a
repeated label is deliberate: you decide, then classify. Read the screenshot of every flagged screen.

## 4. Safety on the real GUI

- On `:3080` you **look**. Press only what opens or moves (menus, tabs, dialogs). Never Save, Install, Delete, Send, Sign out, Use a
  language. Never restart `dsh web`: host code loads on restart, so write « restart needed » instead.
- Anything that changes data or settings runs in the sandbox, and whatever it touched is put back in the same script.
- Never print the session cookie, the token or a secret, in output, a commit or a report.

## 5. Making a class A fix

- The smallest change that removes the problem. Keep both languages (`kt`), tokens instead of colours, hooks (`data-kb`) for tests.
- Add or extend a test that fails without it (a bundle's `test-client.mjs`; the ratchet `scripts/test-consistency-guards.mjs`
  only lets numbers go down). A fix that lowers a baseline updates it in the same commit.
- Render again, compare with the screenshot before, and say what moved.
- One concern per commit, `ux: <what> on <screen>`. Dead-code rider: delete what you can prove dead.
- Gate before pushing: `node scripts/garde-depot.mjs && node scripts/test-lifecycle-engine.mjs && node scripts/test-paquet.mjs`.

## 6. Proposing a class B change

Short study first: what the screen does today, what is measured, what the engine already offers. Then a mockup of **our**
screen with its states (default, empty, long names, narrow), what is removed, one recommendation, and the scope question
for the owner to answer. Spikes stay uncommitted. Nothing is built before the answer.

## 7. Reporting

Result first, a few lines, in the owner's language (AGENTS rule 10): how many fixed alone, how many bugs fixed or open,
how many proposals wait for a decision, the three that matter most, what was checked and what was not (a theme, a width,
a language), and the one decision that is theirs. No tables, no step-by-step recap, no pasted output.

The full list goes in a file outside git (the scratchpad), one entry per finding: where, what is wrong (measured), class,
evidence (screenshot path), status. The owner asks if they want it.

## Never

- No engine patch, no edit of the shared tree, no screenshot or video in git, no `/Users/<name>` path.
- No new design system and no restyling nobody asked for; no « while I am here » class B.
- No « it works » without a render, and no merge of UI work reported as « not verified ».
- No emoji in the interface.
