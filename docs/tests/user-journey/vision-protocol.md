# Looking at the screens: how a cheap model collects and a stronger one judges

A cheap model collects pictures and measures; it never decides that something looks right. The decision about a picture is taken by the triage model (Sonnet), or by the owner for taste. This follows `soft-takeoff/README.md` §5 (« Pictures ») and adds what that page does not have: a way to know how much a Haiku walker misses.

## 1. Seeded defects: know the recall before trusting a « no finding »

Before the first vision batch the lead makes a copy of the sandbox profile (never the owner's) and plants ten known defects with `scripts/user-journey-seed-defects.mjs` (to build; it patches the served client with a CSS and a string overlay, nothing in git):

| # | Planted defect | Page |
|---|---|---|
| 1 | a heading clipped by its card (`overflow:hidden` on a 20 px box) | new-chat page |
| 2 | two buttons overlapping by 12 px | Settings page |
| 3 | grey-on-white text at contrast 2.1:1 | Skills |
| 4 | a French string in the English interface | Creations |
| 5 | the text `undefined` in a gauge label | Usage |
| 6 | a 20 px high hit target | account menu |
| 7 | a price cut after the second digit | Plan page |
| 8 | an icon that points the wrong way in right-to-left | Arabic sidebar |
| 9 | a button with no handler | Automations |
| 10 | a horizontal scrollbar at 390 px | phone shell |

Each vision walker gets the planted pages in a normal batch, without being told. **Recall** is the share of the ten it reports. Under 8 of 10, a vision batch cannot say « nothing wrong » about a page: the page goes to the triage model with the pictures. At 8 or more, a walker's « nothing found » on a page counts as `no finding` (never `pass`) and one page in five is still re-read by the triage model.

## 2. What the walker must record (nothing else)

For each screen: the route and title; the pixel width and height of the window; for every heading, card, button and input the measured rectangle (`getBoundingClientRect`); the text exactly as printed; every rectangle that crosses its parent's or the window's right edge; every control under 32 px; every text whose contrast against its background is under 4.5:1 (computed from the style, not guessed from the picture); every string that matches `undefined|NaN|[object|\{\{|%s`; the console errors since the last screen; two pictures (full window, and the area of anything flagged). `scripts/takeoff-walk.mjs` already records most of this in its `look` step.

## 3. The rubric the triage model applies

A picture is read against fixed questions, each answered yes, no or cannot tell, with the rectangle that decides it:

1. Is any text cut, overlapped or running outside its box?
2. Is the primary action of the screen the most prominent thing and reachable without scrolling at the given width?
3. Is any state missing (empty, loading, error, long text, zero, thousands)?
4. Do the words on this screen match the words used for the same thing elsewhere (J21-07)?
5. Is the screen consistent with its sibling page (same header, same spacing, same icon style)?
6. In right-to-left, is everything mirrored that should be, and nothing that should not?
7. Could a person who has never seen the product say what to do next?

Questions 2, 5 and 7 are ergonomics; they give **enhancements**, not bugs, unless the answer is plainly no on a first-run screen.

## 4. Waves of looking

The look matrix (J18-09) is pairwise: 11 languages, 6 themes (default plus the three sector themes plus light and dark of the default), 3 widths (390, 768, 1440) and 8 page types, about 40 combinations in which every pair appears once. The money screens (J06-10) and the phone screens (J03-11, J04-07) are their own sets because they must be seen in every state, not in a sample.

## 5. Limits

- A walker returns at most 60 screens; more is split, so the context does not rot.
- A walker never edits the repository (`repo_clean` as in `tester-brief.md`).
- Pictures stay outside git (`AGENTS.md` rule 4), in the run's evidence folder.
- Taste (is it beautiful) is the owner's. The recette reports measured problems and honest ergonomics questions, never a score.
