# Brand: the K pastille, the wordmark, the tab icon

The Kybernos mark is a **red pastille holding a white K**, with a small
chat-bubble tail at the bottom-left. The K is the logo **and** the favicon. In the
wordmark the pastille is the first letter: `<pastille>ybernos`.

There is no image file anywhere (AGENTS.md rule 4): the artwork is one SVG string
in the code.

## Where it lives

| What | Where |
|---|---|
| Artwork, metrics, favicon URI, override sanitiser, title rewrite | `packages/kybernos-plugin/client.js`, block `KB-BRAND-CORE-BEGIN … END` (pure: no DOM, no React) |
| React pieces (mark, wordmark, "Powered by", sidebar slots, favicon and title effects) | same file, right after the block |
| Tests | `node scripts/test-brand.mjs` runs the block as-is, plus static checks on the wiring |

## Geometry

- `viewBox` `6 6 49 57`: the body is 41.5 × 49 with 8 units of corner radius; the K is 36 units high
  (`y 14..50`), so it has about 6.5 units of padding.
- Wordmark metrics, as fractions of the font size `f`: the pastille is `.98 f` wide and `1.14 f` high
  and dips `.26 f` below the baseline. That puts the K on the baseline with a height of `.72 f`, the
  cap height. The test checks these three numbers against the viewBox.
- Colours: `#f2372a` and white. Nothing else.

## Where it shows

| Surface | How |
|---|---|
| Sidebar brand row | slots `sidebar.brand.mark` (pastille alone) and `sidebar.brand.name` (`ybernos`), both at priority -1 |
| Conversation hero | slot `conversation.hero.brand.mark` (pastille alone) |
| Tab icon | every `link[rel~=icon]` is pointed at a data URI of the pastille, and put back when the plugin is disposed |
| Tab title | `DeepSeek Harness` is replaced by the brand name |

DSH renders the mark slot twice (expanded row and collapsed rail) and the name slot once, in a flex row
with an 8 px gap (measured on DSH 0.2.0-rc.2, `brandIdentity`, 24 px high). So the mark slot holds the
pastille alone, and the name slot pulls `ybernos` back over the gap (1.5 px between the pastille and the
`y`). The pastille is nudged down 1.1 px so the K stands on the text baseline. If a DSH bump changes the
row (gap, height), re-measure with `scripts/live-page.mjs` and update `KB_SIDEBAR_*`.

Right-to-left rows put the mark on the right, which would make the letters read backwards, so there the
name slot writes `Kybernos` in full and the pastille stays a badge.

## Contract for other bundles

`window.__KB_BRAND__` is published by the core bundle. A bundle must treat every member as optional and
fall back to plain text.

| Member | What |
|---|---|
| `Mark({ height })` | the pastille, `height` in px |
| `Wordmark({ size })` | the full wordmark, `size` = font size in px; always left-to-right |
| `PoweredBy()` | the "Powered by Kybernos" line |
| `getOverride()`, `setOverride(raw)`, `subscribe(fn)` | the Team brand seam, below |
| `faviconHref()` | the favicon data URI |

## Team brand

A Team module (not in this repo) can call `window.__KB_BRAND__.setOverride({ name, logo })`:

- `name`: control characters stripped, trimmed, 40 characters at most;
- `logo`: only `data:image/(png|jpeg|webp|svg+xml);base64,…`, 256 KB at most (an `<img>` cannot run script);
- anything else is dropped; two empty parts mean no override (`null` clears it).

While an override is active the sidebar shows the Team logo and name, with **Powered by Kybernos** under the
name. The override cannot touch that line, nor the tab icon, which stays the Kybernos K. The rules are in
[TRADEMARK.md](../../TRADEMARK.md#team-branding).

## Checking it on the real GUI

See [live-testing.md](live-testing.md). The brand row is `[class*="brandIdentity"]`; its children are
`brandMark` and `brandName`.
