# Plan — the < 5-minute shop (arbitrated 2026-10-27, theme layer added)

Third adversarial review (A → Kimi K3.1 Pro → C) plus the owner's theme requirement. The promise:
**« a test storefront, live in < 5 minutes »**; « ready to sell » is a second, honest clock (custom
domain, Stripe KYC, VAT, invoices stay outside the hourglass and are said out loud).

## 1. The 5-minute budget (honest)

| Step | Time | Inside | Outside (announced, never hidden) |
|---|---|---|---|
| Brief | 0:45 | 5 closed questions + name + auto slug | custom domain, DNS |
| Config | 1:15 | `shop.json` validated + live preview | exotic logo (vertical wordmark…) |
| Products | 1:30 | CSV/JSON import ≤ 50 SKU + error report | broken CSV, 300 slow remote images |
| Live | 1:30 | build, cloud deploy, **test purchase** + email | Stripe KYC, live mode, legal pages |

Preflight (before 0:00, timed and displayed): Stripe keys, logo file, product CSV, content.

## 2. The theme layer (owner requirement: visual + responsiveness first)

**A few base layouts × per-field token sets = an endless-looking gallery.** Quality stays high
because layouts are maintained once; the gallery feels curated because each field (mode, food,
craft, beauty, health, tech, home, sport, services, stationery) looks different.

1. **The gallery, by field.** The brief asks the field, then shows **live mini-previews** (each
   theme rendered with its own demo products of the sector): the person picks with their eyes.
   A theme = design tokens (palette derived from one accent, 2–3 typography pairings, spacing
   rhythm, radii) + section compositions (hero, product grid, product page, testimonials, FAQ,
   footer) + sector demo content + favicon set. No free CSS, per the arbitrated rule.
2. **Inspiration mode.** The person gives 1–3 reference URLs; the skill extracts the design DNA
   (palette, type pairing, spacing ratios, hero treatment, card style, motion notes) and derives a
   theme variant **within the bounded system**. Discipline = the mockup "port" rule: the reference
   is a declared source of truth for look and feel; the code is ours. Inspiration, not copying: no
   assets are taken, only measured tokens.
3. **Responsiveness is a disqualifying gate**, not a wish. A theme enters the gallery only after
   the same conformance suite: 3 breakpoints (480 / 768 / 1280) with zero horizontal overflow,
   dark mode, WCAG AA contrast, hostile fixtures (90-char title, missing image, long price, 20
   variants), perf budgets (LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1), and every capture **read**.
4. **Production route**: the design class (Claude Code, high effort) builds each base layout once,
   under the mockup discipline (declared fidelity, images read, `regard.md`), then the visual
   review is repeated per field token set — automatically for fixtures, by eye for the gallery.

## 3. v1 scope (arbitrated)

**In**: storefront (grid, product page, cart) · Stripe Checkout Sessions (server-side) · idempotent
webhooks · products/variants/SKU/orders/lines/clients · reserved stock + expiry · simple shipping ·
transactional emails (confirmation, shipped) · orders back-office (states, partial refunds,
returns/credit notes in v1.1) · theme layer above · media chain (upload, WebP, CDN, favicon) ·
technical SEO (sitemap, Product/Offer, canonicals) · perf budgets · smoke test mandatory.
**Out of v1**: customer accounts/loyalty · multi-currency · VAT OSS + compliant B2B invoicing
(v1.1: numbered invoices/credit notes) · Stripe dispute sync · advanced search/filters · blog ·
subscriptions · multi-language · per-shop free CSS.

## 4. Build lots and gates

0. **Scope + order–payment–delivery–invoice contract + cost model** (this document opens it).
1. **Transactional core** (reserved stock, idempotent webhooks, server-side price recalculation)
   · gate: E2E test purchase + duplicated/out-of-order webhook + last-item race.
2. **Theme layer** (base layouts, per-field tokens, hostile fixtures) · gate: light/dark homogeneity,
   extreme fixtures, WCAG AA.
3. **Media, emails, compliance** · gate: email accepted (SPF/DKIM/DMARC) + 50 dirty products import.
4. **Cloud** (provisioning, secrets outside the repo, domain, restore) · gate: 3 **cold** runs < 5 min
   + rollback + RPO 5 min / RTO 30 min actually tested.
5. **Skills `shop-*` + the clock + proof of value** · gate: 3 timed demos + first live order.

## 5. Owner decisions (defaults accepted 2026-10-27)

Resend for transactional email · single VAT rate validated by the merchant in v1 · invoices/credit
notes in v1.1 · the promise wording stays « test storefront < 5 min ». Open: target cost per shop
per month (mutualised vs dedicated vs a ceiling that refuses a shop).

## 6. The transaction contract (Lot 0 core)

Order states: `panier → réservée → payée → expédiée → livrée`, with `annulée` (reservation
released) and `remboursee` (partial refunds allowed, credit note in v1.1). Payment truth comes from
signed Stripe webhooks (idempotent by event id, amounts and currency checked, out-of-order events
tolerated); prices are ALWAYS recomputed server-side; the last item race is won by reservation +
expiry + one atomic transaction. Delivery v1: one flat rate, one country; tracking number is a
field, not a carrier integration. Invoice: not in v1 (said at checkout where it legally must be).
