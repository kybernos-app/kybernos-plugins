# Kybernos homepage V3 (English mockup)

File: `index.html` (one file, inline CSS and vanilla JS, no external request, library, image or web font). `validate.py` is the V3 browser acceptance suite: 115 checks, all passing.

## Why V3
Owner feedback on V2: too much text, no real view of the app, home should convert, details belong on other pages. V3 goes from 12 sections to 6, shows a realistic application interface above the fold, and keeps the owner's own idea as the second section: Kaby learns from your work every day (create automation, new skill, fetch skill, enhance UI), you stay in control, share skills and automations with your team.

Measured at 1440 x 1000: 3,732 px page height, down from 9,130 px in V2 (59% shorter), with 3,714 characters of visible body text. Six sections replace twelve.

## Sections and selectors
| # | Section | Selector | Content |
|---|---|---|---|
| 0 | Header | `#siteHeader`, `#themeBtn`, `#menuBtn`, `#mnav` | Logo, Product `#product`, Kaby learns `#learns`, Use cases `#use-cases`, Team `#teams`, Pricing, Sign in, theme toggle, mobile menu, Install free |
| 1 | Hero + app | `section#top`, `#product` (app), `#runDemo` | Exact H1 (two `.l` spans), 22-word subcopy, Install free, Run the demo, 3-item proof line, simulated app |
| 2 | Kaby learns | `#learns`, `#kaby`, `.sg[data-i]`, `#sgDetail` | Exact H2, one sentence, control statement, 4 suggestion rows + detail panel |
| 3 | Use cases | `#use-cases`, `.uc` x3 | Support, Operations, Sales & marketing, link "Explore all 9 fields" |
| 4 | Team | `#teams`, `#teamWin`, `.flow`, `.inst` | Exact H2, short copy, 3-step flow with arrow icons, Team page preview, truth line |
| 5 | Beta proof + CTA | `#beta`, `#start` | Verbatim quote with attribution, "Ready to delegate your first task?", Install free, Explore enterprise |
| - | Footer | `footer.footer` | Product, Kaby learns, Team, Pricing, Terms, Privacy, (c) 2026 DIGI TECHNOLOGIES, "Product previews use simulated data." |

Skip link `.skip` targets `#main`. No FAQ, comparison, ecosystem, quality spec sheet or pricing figures on the home.

## Hero app (what is rebuilt and from where)
Three panes: sidebar, conversation, review inspector. Stacked on mobile: sidebar becomes a horizontally scrollable strip, the inspector sits under the conversation (real layout, not a shrunken screenshot).
- Sidebar destinations come from the product areas in the plugins client: Chat, Agent Teams, Automations, Skills, Creations, Connectors (static `div.ni`, not buttons).
- Conversation: weekly support recap brief, "Agent team" card with Reader, Writer, Checker and the human approval row.
- Inspector: one-page recap preview, Checker criteria ("4 of 4 criteria"), cost €0.31 against a €5.00 daily cap, approval gate "Approve (simulated)" and "Ask for changes".
- Caption "Interactive product preview · simulated data". Numbers (214 tickets, topic counts) are simulated and labelled as such. Row costs sum to the €0.31 total.

## Interactions (all simulated, nothing leaves the page)
- Run the demo (`#runDemo`): scrolls to the app only if it is off screen, resets rows to Queued, runs Reader, Writer, Checker (about 850 ms each), updates cost bar and criteria, ends on "Needs your approval". With reduced motion or `?motion=off` there are no delays; the page loads already in the finished, waiting state, so the static view is complete.
- Approve (simulated) (`#approveBtn`): badge "Approved (simulated)", "Nothing was sent", Replay (`#replayBtn`) restarts. Ask for changes (`#changesBtn`): Writer revises, Checker re-checks, cost goes to €0.37, a trend line is added to the recap, Draft 2; the button is then hidden.
- Kaby learns: selecting a row shows its detail. Each has a primary action (Add automation, Add skill, Install skill, Review and apply) and Not now. Both only change simulated state and the row tag; Undo restores "Suggested". Detail panels are all in the HTML (only the first visible without JS).
- Team: Skills / Automations tabs (arrow keys, Home, End). Install turns into "Installed" (skill) or "Installed · Paused copy" (automation); Reset restores. Pending rows show "Waiting for review" with no action.
- Theme toggle persists in `localStorage` key `kb-theme`; mobile menu closes on link selection and Escape.

## Source grounding
- Team sharing: `packages/kybernos-skills/client.js` ~896-939 (member proposes, admin approves, everyone installs, own skills stay private; labels Approved, To review, Pending, Installed) and `packages/kybernos-plugin/client.js` ~1988-2039 (Team segment of Automations, "Installing one makes a paused copy that belongs to you", Approved / Mine / To review, Waiting for review). Roles shown are generic (Support lead, Ops manager), no personal names.
- Automations flow: `packages/kybernos-plugin/client.js` ~335-358 (Yours / Discover, "switch it on", automation stays off until what it needs is connected). Hence the suggested automation "Starts paused until you switch it on".
- Brand K geometry, tokens (`#2662c4` light, `#7aaaff` dark), theme and menu patterns are carried over from V2. The light small-text/link/focus variant (`--accent-text`) is `#1e4f9f` for AA on tinted surfaces, while primary buttons remain `#2662c4`.

## Truthfulness choices
- Kaby suggestions are labelled "Illustrative suggestions based on repeated work · simulated data". Copy: "You stay in control. Nothing becomes active without your approval." No silent action, no claim of real data collection.
- Fetch skill = found in the skill catalog, user chooses to install. Enhance UI = user reviews and applies, never silent.
- Only the real beta quote is used, verbatim, with the two supplied attribution lines. No logos, counts, benchmarks, comparisons, "1,000+", "44x", or privacy overclaim. No pricing figures.
- External links: pricing, signin, download, use-cases, enterprise, legal/terms, legal/privacy only (all previously route-checked in V2). Installation requirements are not on the home.

## Removed from the home on purpose (belongs on dedicated pages)
Comparison table, FAQ, ecosystem section, quality/cost spec sheet (routing and cap gauge), how-it-works documentation, multi-quote beta wall, six-tab demo workbench, install requirements. No dead links to unbuilt pages were added: the nav only points to anchors on this page and to the verified routes above.

## Browser validation and visual review

Run from the workspace root: `python3 artifacts/kybernos-home-v2-en/validate.py`.

- 115 of 115 checks pass in installed Google Chrome through native Playwright at 1440 x 1000, 1024 x 768 and 390 x 844.
- The H1 is two lines at desktop and tablet widths. Install CTAs remain above the fold. At 1440 x 1000 the app starts at 402 px and 598 px of it is visible in the first viewport.
- No horizontal page overflow, duplicate ids, unresolved internal anchors, visible em dashes, external runtime requests or browser runtime errors.
- All 27 buttons are covered: demo, revision, approval, replay, all four suggestion Add / Not now / Undo journeys, Team tabs and installs, Reset, theme and mobile menu.
- Keyboard checks cover the skip link, Team Arrow / Home / End keys and mobile Escape / link selection. Theme persistence is verified after reload.
- Native reduced motion, `?motion=off` and no-JavaScript rendering all retain a complete, readable initial product preview.
- The first run caught one AA failure: light small accent text on the warm 14% tint measured 4.35:1. Changing only `--accent-text` to `#1e4f9f` raised that pair to 5.90:1. The final contrast suite passes; the lowest measured pair is 4.94:1.
- Final captures were opened and visually reviewed in light and dark themes, including the approved app, installed paused team automation, Kaby suggestions, tablet, mobile app, mobile menu and full-page layouts.

Captures are written to the workspace `.playwright-mcp/` directory with the `kybernos-home-v3-` prefix. The production site and product repository were not modified.
