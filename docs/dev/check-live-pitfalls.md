# check-*-live: six assertions that measured the wrong thing

Measured during the October 2026 acceptance campaign, on a real GUI. Each one failed a healthy
product; each fix is one line in the check, not one line in the product. Read this before writing a
new `check-*-live`: the trap is always the same shape — an assertion about **how** something is
rendered where only **that** it is rendered (or which state it is in) is true.

## 1. Measure the glyph, not its seat

`check-menu-icons` measured `.kb4-isvg` (19×19 px) and required exactly 16. The SVG inside is
16×16. Every icon set read as broken.
**Rule**: when the assertion is about an icon size, select the `<svg>`, not the wrapper that centres it.

## 2. « Can answer » is not « has no key »

`check-websearch` required every engine in the chain to wear « NO KEY ». A DSH that HAS a key
legitimately puts a keyed engine first, and the page says so (« add a key so a keyed engine goes
first »). A paused or switched-off engine is also listed, with its status.
**Rule**: assert the invariant the page promises (short chain, keyless first, not all dead), not the
state of the machine that runs the check.

## 3. An animation shows one frame, not all of them

`check-settings-layout` expected the four labels of the animated mock at once. It types one at a
time (measured: one label on screen, 113 px client = 113 px scroll, so not cut).
**Rule**: a truncation assertion needs `scrollWidth <= clientWidth`; a count of labels needs the
component's own contract, not a guess.

## 4. The open row may be marked with a fill, not a bar

The same check required a **bar** (`boxShadow`) on the active Settings row. The engine marks it with
`.navCell.active` background only and defines no box-shadow anywhere; the measured fill difference is
92 (threshold 24).
**Rule**: when the design can mark a state two ways, accept both, or measure the property the engine
actually sets.

## 5. A fixed-height card is not « not following the text »

`check-menu-density` bounded the account card between 3.6 and 5.2 text heights. At a 17 px content
font the card is 61.1 px — 0.1 px under the lower bound.
**Rule**: a lower bound guards against « too flat », an upper bound against « too tall ». Check which
one the design cares about before tightening both.

## 6. Exit 3 is « I could not measure », not « it failed »

The checks answer with exit 3 when they refuse to disturb a state (a sandbox that already has
servers, no chat session, no model). A runner that folds every non-zero code into `fail` turns
environment gaps into phantom defects — twelve of them in one campaign.
**Rule**: map `0 → pass`, `3 → inconclusive`, anything else → `fail`, and keep the distinction in
the results file.
