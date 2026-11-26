# Brand: the K, the wordmark, the tab icon

The Kybernos mark is a **red K whose stem carries three white dots**: the typing dots of a chat. The K is the
logo **and** the favicon, and it is the same artwork as the public site and the app (`apps/app/src/components/brand-mark.tsx`,
decided 2026-10-06; it replaced the bubble pastille of 2026-10-04). In the wordmark the K is the first
letter: `<K>ybernos`.

There is no image file anywhere (AGENTS.md rule 4): the artwork is one function in the code.

## Where it lives

| What | Where |
|---|---|
| Artwork (`kbBrandArt`), metrics, favicon URI, override sanitiser, title rewrite | `packages/kybernos-plugin/client.js`, block `KB-BRAND-CORE-BEGIN … END` (pure: no DOM, no React) |
| React pieces (mark, wordmark, "Powered by", sidebar slots, favicon and title effects) | same file, right after the block |
| The first-run wizard's K | the same `KB_BRAND_VIEWBOX` / `KB_BRAND_INNER`: one K in the product |
| The sign-in page of the gate | `packages/kybernos-gate/core/page.mjs` (`K_ART`, a copy: the gate has no dependency) |
| Tests | `node scripts/test-brand.mjs` runs the block as-is, plus static checks on the wiring |

## Geometry

- `viewBox` `0 0 32.5 36`: a stem 13 wide, an arm and a leg from `x = 13`. The three dots are circles of radius 2.8
  at `cx = 6.5` (the middle of the stem) and `cy = 7.5, 18, 28.5`.
- At tab-icon size the dots would be perforations: the favicon uses radius 3.3 and a padded box `-3 -1 38.5 38`
  (the file `apps/app/public/favicon.svg` of the site).
- Wordmark metrics, as fractions of the font size `f`: the K is `.93 f` high (1.28 × the cap height of Inter, `.727`: at text
  size a K of the cap height, with a thin stem, would be perforated by its dots), `.84 f` wide, stands on the baseline
  (its foot is the bottom of its box: nothing hangs under it), and `.075 f` of air before the `y`. `test-brand.mjs`
  checks these numbers against the viewBox.
- Colours: `#f2372a` and white. Nothing else.

## Where it shows

| Surface | How |
|---|---|
| Sidebar brand row | slots `sidebar.brand.mark` (the K alone) and `sidebar.brand.name` (`ybernos`), both at priority -1 |
| Conversation hero | slot `conversation.hero.brand.mark` (the K alone) |
| Tab icon | every `link[rel~=icon]` is pointed at a data URI of the K, and put back when the plugin is disposed |
| Tab title | `DeepSeek Harness` is replaced by the brand name |
| First-run wizard, About, the gate's sign-in page | the wordmark |

DSH renders the mark slot twice (expanded row and collapsed rail) and the name slot once, in a flex row
with an 8 px gap (measured on DSH 0.2.0-rc.2, `brandIdentity`, 24 px high). So the mark slot holds the
K alone, and the name slot pulls `ybernos` back over the gap (`.075 f` = 1.4 px between the K and the
`y` at 19 px). The K is nudged up by 1.9 px (`KB_SIDEBAR_MARK_NUDGE`) so its foot stands on the text baseline; measured on the
live GUI: the foot is within 0.1 px of the baseline. If a DSH bump changes the row (gap, height, font), re-measure with
`scripts/live-page.mjs` and update `KB_SIDEBAR_*`.

Right-to-left rows put the mark on the right, which would make the letters read backwards, so there the
name slot writes `Kybernos` in full and the K stays a badge.

## Contract for other bundles

`window.__KB_BRAND__` is published by the core bundle. A bundle must treat every member as optional and
fall back to plain text.

| Member | What |
|---|---|
| `Mark({ height })` | the K, `height` in px |
| `Wordmark({ size })` | the full wordmark, `size` = font size in px; always left-to-right |
| `PoweredBy()` | the "Powered by Kybernos" line |
| `getOverride()`, `setOverride(raw)`, `subscribe(fn)` | the Team brand seam, below |
| `faviconHref()` | the favicon data URI |

## Team brand

Besides Kybernos Cloud (below), a Team module (not in this repo) can call `window.__KB_BRAND__.setOverride({ name, logo })`:

- `name`: control characters stripped, trimmed, 40 characters at most;
- `logo`: only `data:image/(png|jpeg|webp|svg+xml);base64,…`, 256 KB at most (an `<img>` cannot run script);
- anything else is dropped; two empty parts mean no override (`null` clears it).

While an override is active the sidebar shows the Team logo and name, with **Powered by Kybernos** under the
name. The override cannot touch that line, nor the tab icon, which stays the Kybernos K. The rules are in
[TRADEMARK.md](../../TRADEMARK.md#team-branding).

### From Kybernos Cloud

The core bundle asks `/kybernos-cloud/status` shortly after start (3 s, never on the boot path), every 10 minutes and
when the tab comes back after that long, and applies the brand of the **active workspace**. The Cloud API contract:

```json
GET /v1/workspaces
{ "workspaces": [ { "id": "…", "name": "…", "plan": "…",
                    "brand": { "name": "Acme AI", "logo": "data:image/png;base64,…" } } ] }
```

- `brand` is optional and only sent for the workspaces entitled to it (the Team plan): **the server decides**, the page
  does not look at the plan.
- `name` and `logo` follow the rules above: anything else is dropped, a malformed brand never reaches the page.
- The cloud bundle stores workspaces as received and `/kybernos-cloud/status` hands them to the page, under
  `state.workspaces` (`{ ok, connected, state: { workspaces, active_workspace_id } }`): no host change was needed.
- A workspace without a brand, a disconnect or a switch to a personal workspace puts the Kybernos brand back. The last
  brand is kept in `localStorage` (`kybernos.brand.team.v1`) so a reload shows it at once; the next answer confirms or
  clears it. A brand set by another module through `setOverride` is never cleared by this: only what the cloud set.
- The sidebar row is fixed at 24 px by DSH and its button clips what overflows, so while a brand is active a rule
  (`html[data-kb-team-brand]`) lets the row grow to fit the second line. Checked on DSH 0.2.0-rc.2.

## Checking it on the real GUI

See [live-testing.md](live-testing.md). The brand row is `[class*="brandIdentity"]`; its children are
`brandMark` and `brandName`.
