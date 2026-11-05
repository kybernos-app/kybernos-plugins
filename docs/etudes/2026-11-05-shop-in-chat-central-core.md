# Shop in the chat: a central core, one link per storefront (cadrage, 2026-11-05)

Status: **cadrage, nothing built.** Owner decision of 2026-11-05: a central core on our server, one
link per storefront, a dedicated machine stays an optional tier. Mockup: the Design canvas « Boutique
dans le chat – app commerçant » (20 boards, interactive, version 8; sources archived in
`~/kybernos-archive/shop-chat-mockup-2026-11-05/`, not in git). All numbers and names in it are
invented.

## 1. What the person gets

On Telegram or WhatsApp, talking to Kaby:

- creates a shop (site + checkout), then manages products, stock and orders;
- gets a message when an order arrives, ships it (with a tracking number), asks for a refund;
- has a mini CRM (customers, their orders, private notes) and a mini ticket manager (an e-mail
  thread per customer question, internal notes, reply, resolve);
- sells three kinds of product: **physical** (stock, shipped), **digital** (a file the buyer downloads
  after paying) and **bookings** (a slot in a calendar, with online payment, payment on the spot or
  free; the calendar is the merchant's own, connected to Kaby);
- opens a **merchant app**: a Telegram Mini App, or on WhatsApp a single-use link that opens the same
  app in the browser. Tabs: Today (| Statistics), Orders (| Bookings), Catalogue (one list, stock
  edited on the row), Clients (| Tickets), Shop. Every list has search, sort and tags. Everything the
  app does can also be said to Kaby, and an « Ask Kaby » button in the app header (and a Help card in
  the Shop tab) sends a request to him.

Shoppers see only the storefront at `<slug>.kaby.app`.

## 2. Decision and why the other options fell

| Option | Verdict |
|---|---|
| Static page + serverless functions | No. The publish contract is static only (no `api/`, no `package.json`): `docs/dev/site-publish-contract.md`. |
| One cloud machine per shop | Not needed. With Stripe Connect every payment event reaches **our** server first (one Connect webhook for all connected accounts), so a per-shop machine adds a cost (about 6.9 USD/month always-on, ADR 0052) without removing the central piece. A sleeping machine cannot serve shoppers or webhooks. |
| **Central core on our server (chosen)** | One multi-tenant module; every row carries a `shop_id`. Cheap per shop, one place to secure, test and bill. |
| Dedicated always-on machine per shop | Optional « custom shop » tier, later. Reuses the dormant design of ADR 0061 and the apps-hosting port. Not part of the first build. |

### 2b. Build the core ourselves, or adopt Medusa or PocketBase?

Asked by the owner on 2026-11-05. Facts below come from hosting pages and third-party articles read
that day, **not from the projects' official documentation**; confirm before relying on them.

| | Medusa v2 | PocketBase | Custom core (chosen) |
|---|---|---|---|
| What it is | A full commerce engine (Node/TypeScript, Postgres, Redis), MIT | A single Go binary with SQLite, auth and an admin UI, MIT | A `shops` module on our server (Postgres, auth and Stripe already there) |
| Fit with « one core for many merchants » | One store per deployment. Several stores or vendors needs a community plugin or custom work; no official multi-vendor feature found | Not multi-tenant; writes are serialised by SQLite; one node, no clustering | Tenant isolation is ours to design and test |
| Weight | Hosting guides ask for about 2 GB RAM per service, plus Postgres and Redis | Light (a 512 MB limit is a normal setting) | Runs inside the server we already operate |
| What it gives us | Cart, orders, inventory, promotions, a Stripe payment provider | A database, auth and an admin UI; no commerce logic | The small commerce part is already written and tested in the commerce template |
| What we still write ourselves | Kaby tools, chat approvals, the merchant app, CRM, tickets, bookings, digital delivery, tenancy | All of the commerce logic, Stripe, and everything on the left | Everything, but nothing is bridged to a second system |

Verdict: **custom for the central core.** The value of this product (Kaby tools, step-up approvals in
chat, the merchant app, CRM and tickets, bookings, digital delivery) is outside what either project
sells, so we would write it anyway, and we would add a second system to operate, secure and keep
isolated per merchant. The commerce part we need in the first version is small, because Stripe
Checkout carries the payment page (cart, payment, receipts).

Where each could still earn a place, later:

- **Medusa**, inside the optional dedicated-machine tier, for a merchant who needs Shopify-level
  catalogue features (variants, discounts, several currencies, shipping rules). That machine would be
  2 GB, not 512 MB. Decide when a real merchant asks, not before.
- **PocketBase**, nowhere in the core. For the dedicated machine the commerce template (Node and
  SQLite, 37 MB idle measured) already does what PocketBase would, without a new dependency.

Guardrail so the choice stays reversible: Kaby's tools and the merchant app talk only to the `shops`
API contract (section 8), never to tables. If we adopt an engine later, the contract stays and its
implementation changes. The signal to reconsider: the backlog fills with variants, discount codes,
tax rules or shipping rates rather than with Kaby features.

Sources read: [Medusa on Railway](https://railway.com/deploy/medusa-headless-commerce),
[Medusa multi-vendor request](https://github.com/medusajs/medusa/discussions/2769),
[Medusa marketplace case study](https://ak-media-www.pages.dev/portfolio/medusa-optician-network/),
[PocketBase limits](https://dev.co/databases/open-source/pocketbase),
[PocketBase hardware](https://shop.zimaspace.com/pages/pocketbase-hardware-requirements).

## 3. Architecture

```
shopper ──> <slug>.kaby.app  (static page, published with site_publish)
                │  public API, CORS limited to that one origin
                ▼
          server: `shops` module  ──> Stripe: Checkout on the merchant's connected account
            ▲        ▲                        │
            │        └── one Connect webhook ◄┘  (each event carries `account` -> shop)
            │
  Kaby tools (person's token)         merchant app (own domain, section 4)
```

- The storefront is a published static page. It reads the catalogue and creates the checkout through
  the core's public API, keyed by a **public shop id**. No secret ever sits in the page.
- Product pages: recommended hybrid. Kaby republishes the static pages when the catalogue changes
  (good for search engines, cheap), while price, availability and stock are always fetched live,
  because the core is the only truth for stock.
- Checkout `success`/`cancel` URLs are built by the core from the shop record, never taken from the
  request. The Checkout Session carries `shop_id` and `order_id` in its metadata.
- Reservation: an order reserves its stock until payment, expiry or cancellation (30 min, as in the
  existing commerce template), a payment event is applied at most once, stock is never negative.
  These invariants already exist and are tested in `packages/kybernos-webapp-creator/templates/commerce`;
  the core ports them to Postgres.
- The platform Stripe key lives on the server only. It never reaches a user's machine.

## 4. Domains and trust boundaries

Storefronts run page code that merchants (or Kaby on their behalf) wrote. They all share the
registrable domain `kaby.app`. Cookies are scoped to a registrable domain, so a storefront could set
or overwrite a cookie for any sibling subdomain.

Rule: **the merchant app never lives under `kaby.app`.** It lives on the `kybernos.app` side (the
mockup shows `app.kybernos.app`; the final name is an open decision). The apex of `kaby.app` stays
what it is today: the shared-link base of `/s/<id>`. Better Auth cookies are `SameSite=Lax`
(ADR 0002); the app session does not depend on a cookie a storefront could reach.

Storefront API: CORS allows exactly `https://<slug>.kaby.app` (plus a custom domain later), rate
limits per shop, no endpoint that returns another shop's data. A custom domain per shop is a later
slice (Vercel domain add), no change to the core.

## 5. Stripe Connect

Checked in Stripe's documentation on 2026-11-05:

- One Connect webhook endpoint receives the events of all connected accounts; each event has an
  `account` field.
- Onboarding goes through account links (single-use, expiring) on the Accounts API; the OAuth flow is
  discouraged for new platforms.
- With a Standard account and a direct charge, the connected account is liable for fraud and
  disputes. With Express it is the platform. An application fee is paid in the platform's currency.
  Direct charges need the `card_payments` capability.

**Not verified, to confirm with Stripe before building:** whether one person can hold several connected
accounts under one platform, and which countries a French platform can onboard. Plan without that
answer: one connected account per person, shared by their shops, shop told apart by metadata.

Proposal: Standard accounts, direct charges, no application fee in the first version (the fee is a
pricing decision). Refunds and disputes can also be handled in the merchant's own Stripe dashboard;
the app says so.

## 6. Data (server, Postgres)

Every table carries `shop_id`; every query is scoped by it; a test per table proves a shop cannot
read another's rows.

- `shops`: owner, slug, name, currency, open/closed, Stripe account id, published site id.
- Catalogue and orders: `products` (price in cents, stock, reserved, active), `orders` and
  `order_lines` (price copied at order time), `payments` (Stripe event ids, unique), `shipments`
  (tracking).
- Product kinds (section 6b): `products.type` is `physical | digital | booking`; digital adds a
  private file and download rules, booking adds `booking_offers`, `bookings` and a calendar link.
- CRM: `customers` (unique by shop and e-mail: name, address, tags), `customer_notes`
  (private to the merchant, editable and deletable by the merchant, each with an id).
- Tags (free text, per shop) on products, customers and tickets; the app suggests the shop's existing
  ones.
- Tickets: `tickets` (customer, optional order, subject, status `open | waiting | done`),
  `ticket_messages` (from customer or shop, body, e-mail message id for threading), `ticket_notes`
  (internal).

Personal data of the merchant's customers: the merchant is the controller, we are the processor. This
needs the DPA and the sub-processor row before any real user, plus export and erasure per customer.

## 6b. Three kinds of product (added the same day, mockup only)

All three share price, photo, tags, on/off and the same order and payment path; they differ after
payment.

**Digital (download).**
- The merchant attaches one file (the mockup says 50 MB at most; not decided). It is stored privately,
  never inside the published page, so it cannot be fetched without a link.
- After the Stripe payment event, the core mails the buyer a **personal link**: valid for a number of
  days and a number of downloads (mockup: 30 days, 5 downloads, set per product). The link is a random
  token, stored hashed, resolved by the core, which streams or redirects to a short-lived signed URL.
- The merchant can resend a link (the old one stops working) and sees sales and download counts. A
  refund disables the link.
- No stock. No address asked at checkout.

**Booking (slot in a calendar).**
- An offer has a duration, a capacity (seats per slot) and a payment mode: **online** (Stripe, at
  booking), **on the spot** (the seat is held, nothing is paid online) or **free**.
- Opening hours are a weekly schedule of slots per offer. A slot is bookable while seats remain and,
  if a calendar is connected, while the merchant is free at that time.
- A seat is held for 30 minutes during an online checkout, exactly like physical stock (same invariants:
  applied at most once, never below zero).
- The merchant's calendar: connected from the Shop tab through the provider's own consent page
  (nothing typed here). Kaby asks for the minimum: read **free/busy**, and **create** the reservation
  events it makes. It never edits or deletes the merchant's other events. Without a calendar, slots
  are offered without checking the agenda, and the app warns about it.
- Cancelling a paid booking is a refund, so it needs the merchant's yes in chat (step-up, section 7).
  A free or on-the-spot booking cancels at once and the customer is told by e-mail.
- Customers appear in the CRM like any buyer; their bookings are listed on their record.

**Statistics** are computed by the core from orders and bookings for two ranges (7 days, 8 weeks):
sales per period against the previous period, orders, average basket, new customers, bookings, sales by
kind, best products. The charts in the mockup are plain bars and a donut with a legend and values
(not color alone).

## 7. The merchant app

- **Telegram:** a Mini App. Sign-in = the signed `initData` that Telegram hands the page, verified on
  the server with the bot secret. No cookie, nothing to type. (No Mini App code exists yet in the
  server's Telegram module.)
- **WhatsApp:** Kaby sends a link that works **once** and for 15 minutes. It is exchanged for a
  session that expires on its own (the mockup says 12 h, to decide), with « close the session » in
  the Shop tab.
- Anything that sends money out or writes to a customer on its own is **asked again in chat**
  (step-up): refunds always; a ticket reply goes out only after the merchant read it. Kaby may draft
  a reply, never sends one unseen.
- **Ask Kaby from the app.** A button in the header opens a sheet with suggestions for the current
  tab and a free text field; the request goes to the person's Kaby, who answers in the chat. How a
  Mini App hands text to the bot (and what the WhatsApp page may do) is **not designed or verified**:
  the likely route is « the app posts to our server, the server injects the message in the person's
  conversation », to confirm.
- **Help.** The Shop tab has a Help card (Ask Kaby). The mockup says Kaby can pass a question he cannot
  answer to the Kaby team; that is a proposal, it needs a support channel and a privacy line, see the
  open decisions.
- Mockup screens: Today (sales with a 7-day line, to-do list, today's bookings, latest orders) and
  Statistics; Orders (search, sort, filters, list with product thumbnails, detail, ship with
  tracking, refund sheet; a digital order shows the download state and « resend the link ») and
  Bookings (week strip, slots with their seats, bookings that open to cancel); Catalogue (**one
  list**: search, sort, tag filters, product images; the stock of a physical product is edited with
  a stepper on its row and saved with one bar, there is no separate Stock page; a digital or booking
  row shows its sales or its duration and seats; tap a row for the product page; add product with a
  type choice); Clients (list with tags; record with tags, **notes collapsed behind « Add a note »,
  each note editable and deletable in place**, orders, bookings, tickets) and Tickets (grouped by
  status, tags, thread, internal notes, draft from Kaby); Shop (address, open/close, Stripe state,
  calendar connection with a consent sheet, Help, access). States covered: empty shop, loading,
  light and dark, Telegram and browser, calendar connected or not.

### 7b. Less on screen (added the same day, mockup v9)

The owner asked for a lighter app: tooltips, hover, smart filters, icons, less text, and not
everything on one page. Same design and same elements, folded:

- **Tips, not paragraphs.** A small « i » next to a title opens a bubble (hover on a computer, tap or
  focus on a phone, and read out by screen readers). A tip explains; it is never the only way to act.
  A phone has no hover, so there it is a tap.
- **Icons for the paired views** in the header (Today / Statistics, Orders / Bookings, Clients /
  Tickets), with a count dot. The bottom tab bar stays.
- **Filters behind one button.** The chip rows are gone. The button opens a list of options with their
  counts, and carries a dot when something needs attention (for example 2 products low on stock). The
  active filter is one removable pill. Typing a word that matches a filter name offers it
  (« Filter: Low stock »).
- **Today = four tiles** (sales with a line, to ship, bookings, tickets) and at most one alert row;
  each opens its page.
- **Client record = three icon tabs** (notes, orders and bookings, tickets) instead of three stacked
  sections; the subtitle carries the purchase count and total.
- **Shop = a list of rows** (Payments, Calendar, Evolutions, Help, Access), each with its state on the
  row and its own page.
- **Catalogue row = one line** (second pass, same day). No « Available » text. A stock chip (box icon,
  the number, a tiny pencil; amber when low, red when out) opens, on a click, `-` `n` `+` and a tick in
  place of the chip. A product that is not a physical one shows an icon and a number instead (sales,
  seats, stock of all colours), with the detail in its tooltip. The on-sale switch becomes an eye
  icon that appears on hover or keyboard focus of the row; a hidden product is dimmed and carries a
  small crossed-eye icon. **On a phone the eye is not shown** (no hover): the switch stays on the
  product page.
- **No Kaby button in the Telegram header**: the person is already in the chat with Kaby, so the Help
  row of the Shop list goes too. The web version (WhatsApp link) keeps one quiet icon, since that
  person is not in the chat. Buttons that send a request to Kaby (new evolution request, add a
  colour) still open the request sheet.
- **Secondary actions are icons with a tooltip**: see the client record (from an order, a booking or a
  ticket), edit tags, add a note, resend a download link, replace a file, see the bookings, manage a
  slot. Actions that cost something or say a lot (ship, refund, cancel, validate a mockup) keep their
  text.
- **Product page.** The media card shows thumbnails and « Add » while there is one media, and the
  move/remove buttons only once there are several. The colours card exists only when the colours
  evolution is live.

Not verified: how this reads on a real Telegram or WhatsApp phone (no hover there); the bubbles were
checked in a desktop browser at phone size only.

## 8. Kaby side (plugin)

Tools call the server's shop API with the person's token; the Home computer holds no platform secret.
Proposed names: `shop_overview`, `product_upsert`, `stock_set`, `order_list`, `order_get`,
`order_ship`, `refund_request` (step-up), `customer_find`, `customer_note_add`, `ticket_list`,
`ticket_get`, `ticket_reply_draft`, `ticket_reply_send` (step-up), `ticket_note_add`,
`ticket_set_status`, `shop_app_link`; for the new kinds `product_upsert` takes a `type`, plus
`booking_offer_set` (duration, seats, payment mode, weekly slots), `booking_list`,
`booking_cancel` (step-up when it was paid), `digital_link_resend`, `calendar_connect_link` and
`stats_get`. A skill carries the manual of the tested tools, as
`docs/dev/skills-vs-plugins.md` asks. Zero new engine patches; a bundle must never stop DSH from
starting (AGENTS rules 1 and 2): every client factory is guarded.

## 8b. The shop evolves from the merchants' requests (added the same day, mockup only)

Owner's wish: when a merchant asks for something the shop cannot do yet (several media on a product
page, colours on a product), Kaby makes the shop evolve. It asks an agent team for the spec, the
mockup, the validation and the tests, with the bricks we already have: automations, agent teams,
skills.

### The ladder: the cheapest answer first

1. **Already possible**: Kaby does it, or shows where.
2. **Configurable**: Kaby sets it up for that shop only (a tag, a custom field, an option, a
   template). Reversible, inside the shop's own space, shown before it is applied (mandate class 1).
3. **Missing capability**: an evolution request. Once shipped it is a capability any shop can switch
   on, so the next merchant who asks gets answer 2.

### What may evolve and what stays frozen

- **Frozen core**: sign-in and sessions, tenant isolation (`shop_id` on every row, the guards),
  Stripe Connect and its webhook, refunds, the order, stock and reservation arithmetic, download
  tokens, data export and deletion. A change here is not forbidden, but it forces a human read of the
  diff itself, not only of the proof pack.
- **Evolvable layer**: product fields, media, how options are shown, storefront blocks, app screens,
  lists and filters, statistics, e-mail wording, the texts of Kaby's tools.
- Kaby's own identity prompt and mandate never evolve (decision of 2026-11-01). This section is only
  about the shop software.
- The path is **computed from the diff by a script** (frozen path globs, any migration, any money or
  stock table touched), never from the agent's word. This is the rule the `dev-team` triage already
  follows: one sensitive file forces the complete path.

| | Several media on a product | Colours on a product |
|---|---|---|
| Needs | a media table (additive), a gallery on the storefront, a strip in the app | options and variants, stock per variant, order lines that name a variant |
| Touches the frozen core | no (a picture is not money) | yes: stock, reservation, order lines |
| Path | complete pipeline; the owner reads the proof pack | complete pipeline; the owner reads the proof pack **and** the diff of the frozen part, after a migration rehearsal on a copy |
| Rollout | flag per shop, requester first | same |
| Rollback | flag off, the pictures stay | flag off, variants hidden, product stock = sum of the variants |

### The pipeline (existing teams, one stage after the other)

| # | Stage | Who | Output and gate |
|---|---|---|---|
| 0 | Intake | the merchant's Kaby, in his chat | rewrites the request as a one-paragraph **need** (not a solution), asks « is that it? », looks for the same request already open (adds a vote). The raw message is data and never reaches a team. Output: a `shop_requests` row |
| 1 | Spec | team `dev-team` (triage, cartographie, cadrage, specification) | a spec with an executable definition of done, the frozen-core verdict, an additive migration, the flag name, the tests by name |
| 2 | Mockup | team `maquette` | a Design canvas on invented data (or the merchant's own catalogue, read-only, for his preview). **Gate 1: the merchant says yes** or asks for a change, three rounds at most |
| 3 | GO | the `dev-team` GO gate | spec and mockup agree, cost under the cap |
| 4 | Build | `dev-team` implementation, own worktree off `dev` | a PR on the server repository (and one on the plugins if the tools change); flag **off** by default; additive migration only |
| 5 | Test | `dev-team` test and adversarial review, then `qa-parcours` on a **staging shop** with invented data | tenant isolation (shop A never sees shop B's new data), a shop without the flag behaves exactly as before, the new flow end to end. Output: the proof pack |
| 6 | Release | the owner | mandate class 3: **one card** in his digest, non-blocking: proof pack, diff verdict, cost. On yes: dev server, then production (a human step, as today); flag on for the requesting shop for N days, then for all |
| 7 | Tell and learn | Kaby, then the `dev-team` memory stage | every merchant who voted is told; an entry in « News » in the app; a use counter on the capability, and one unused for 60 days is flagged for removal (dead-code rider) |

### Who runs it, with what

- The platform's own Kaby (the shop maintainer), on the owner's machine or cloud computer, started by
  an **ordinary automation** « Shop: evolutions » of the same kind as Kaby's wake-up (home session, an
  hour window in the cron, maximum duration, stop when the owner writes, approvals set to Ask). **Each
  wake advances one stage of one request.** The state lives on the request and on the PR, never in a
  chat. One evolution in flight in v1.
- That Kaby is the Team Lead of `kyber-selection` §6: it chains `maquette`, `dev-team` and
  `qa-parcours`, each keeping its own declared workflow. A thin team `shop-evolution` could declare the
  chain; whether a stage may hand over to another team is **not verified**.
- Mandate classes: stages 1 to 5 are reversible in a branch and bounded in cost (classes 1 and 2), so
  no approval per step; stage 6 is class 3 and waits in the digest.
- New pieces: three tools (`shop_capabilities_get`, `shop_request_create` which also votes,
  `shop_request_status`), a tested script `scripts/shop-evolution-gate.mjs` (computes the path, checks
  the proof pack is complete, the flag is off by default, the migration is additive, a tenant-isolation
  test exists) and the skill `shop-evolution` as the manual of that script, as the skills doctrine asks
  (`docs/dev/skills-vs-plugins.md`: nothing without an executable test and a use counter).

### Rules that exist because the shop is shared

- Merchants' words are data. The build team receives the confirmed need and the spec, never the raw
  message, a customer's text, or a ticket.
- No production data in the pipeline: a staging shop with invented data, and a merchant's preview
  reads only his own catalogue.
- Limits per shop (open requests, requests per month). « No » is a valid answer, with the reason
  (law, payment rules). A merchant never sees another merchant's request, only that others voted.
- Additive migrations only (expand now, contract later by hand); the rollback of a capability is its
  flag.
- A cost cap per evolution and per month; over it, the run stops and one card waits.
- Every stage writes an audit line (stage, spec hash, PR), in the style of the mandate audit.

### What the merchant sees

A line in his chat when a stage changes (the mockup is the one that needs him), and in the app
Shop › « Evolutions »: his requests with a timeline, the mockup to approve or change, a button to
withdraw; and « News » for what shipped. Drawn in the mockup (v9): chat boards « The request »,
« The mockup is ready », « Team side: the green light »; app boards « My requests », « A request:
validate or change the mockup », « A request: trials », « Product: photos and videos », « Product:
stock per colour »; and a one-page diagram « The path of a request ».

## 9. Reuse

- Publish: `site_publish` and `POST /v1/sites` as they are. Limits to live with: 3 sites per person
  (`sites_max_per_user`), 2 MiB per file, 4 MiB in all, 50 files.
- Shop logic and its invariants: the commerce template of `kybernos-webapp-creator` (Node and SQLite,
  measured 37 MB idle and 63 MB loaded on a Mac: relevant only to the optional machine tier, not
  measured on Fly).
- Tables / custom objects (`kybernos-db`) are not reused: shop data has money and tenancy rules that
  a generic table builder should not carry.
- Public shop assistant (`kybernos-front-desk`): later, the shop's customer-facing assistant can sit
  on the same core.

## 10. Build order, each slice with its executable gate

1. Server ADR + contract from this document.
2. Core and API without Stripe: tables, reservation, tenant-isolation tests.
3. Stripe test mode: account link, Checkout on the connected account, Connect webhook, idempotency
   and out-of-order tests.
4. Storefront template + publish through `site_publish` + CORS tests.
5. Kaby tools + skill + step-up for refunds.
6. Merchant app: Telegram sign-in, WhatsApp link exchange, the five tabs.
7. CRM and tickets, with inbound e-mail.
8. Digital products: private file storage, personal expiring links, download counter, link disabled
   on refund. Gate: a link works N times then stops, an expired or guessed token returns nothing, a
   file is never reachable without a token.
9. Bookings without a calendar: offers, weekly slots, seats, 30-minute hold, three payment modes,
   cancel (step-up when paid). Gate: concurrent bookings never exceed the seats, an event applied
   twice books once.
10. Calendar connection (one provider first): consent, free/busy read, event create, revoke. Gate: no
    scope beyond free/busy and events created by Kaby; a revoked token closes the slots' calendar
    check and says so.
11. Statistics, computed from the core, with the same numbers as the order and booking lists.
12. Optional: dedicated machine tier.
13. Capabilities registry: a flag per shop and per capability, `shop_capabilities_get`, « News ».
    Gate: a flag off means the old behaviour byte for byte; a flag of one shop never shows in
    another.
14. Request intake: `shop_requests` with votes, the three tools, the merchant's status views. Gate:
    the same request votes instead of duplicating, limits hold, the raw merchant text never reaches a
    team prompt.
15. `scripts/shop-evolution-gate.mjs`, the staging shop seed and the skill `shop-evolution`. Gate:
    the script classes a diff that touches stock as « frozen », one that adds a media table as
    « additive », and refuses a proof pack with a missing test.
16. The automation « Shop: evolutions », the owner's release card, and one dry run on a pilot (several
    media) that changes nothing in production.
17. Optional: a preview mode of the real merchant app on a copy of the merchant's catalogue.

No real money before the DPA and a platform review; slices 3 to 11 run in Stripe test mode.

## 11. Open decisions (the owner's)

1. Domain of the merchant app (`app.kybernos.app` is a placeholder).
2. Enable Stripe Connect on the platform Stripe account; confirm « several accounts per person » and
   the countries with Stripe.
3. Application fee or not (pricing).
4. How customer replies reach the tickets (inbound e-mail routing): provider and address scheme not
   decided.
5. Where product photos are stored (not decided; the 4 MiB site limit rules out putting them in the
   page).
6. Maximum shops per person (3 today, from the sites limit).
7. Length of the WhatsApp web session.
8. DPA and sub-processor row for the merchants' customer data.
9. Calendar providers: which first (Google Calendar and Outlook are the obvious pair; Apple's
   calendar needs another protocol). Not checked with any provider: scopes, review requirements, the
   exact free/busy API.
10. Digital files: where they are stored, the size cap (the mockup says 50 MB), allowed types, and
    who is responsible for the content sold.
11. Tax on digital goods and on services sold to consumers in other countries: **not checked at all**;
    the app must not invent a VAT line before this is looked at.
12. Booking policy: deadline to cancel, no-shows, refund rule. The mockup refunds only after the
    merchant's yes in chat.
13. How the app sends a request to Kaby (section 7) and whether Kaby may forward a question to the
    Kaby team (what data, which channel, consent).
14. Who releases (section 8b): proposal for v1, **every release waits for the owner's yes**. Later, a
    « light » path (additive, no money or stock) could release itself after the early-access week
    with no incident. His call.
15. Fairness and cost of evolutions: who may ask (every plan?), how many open requests, early access
    for the requester, priority by votes, and who pays the model cost (the platform, by default).
16. Where the maintainer Kaby runs and what it may write: opening PRs on the server repository from a
    cloud computer is not done today.

## 12. What was and was not checked

Checked: the publish contract, the commerce template's routes and invariants, the server's domain
usage, Stripe's documentation (section 5), the mockup running locally with its runtime (every flow
clicked: search, sort, tags, notes add/edit/delete, stock on the row, add product of each type,
bookings cancel, calendar connect, Ask Kaby, ship and refund; empty/loading/dark states, both
hosts; no console error). **Not checked:** the published canvas page itself was not opened in a
signed-in browser; Stripe's multi-account and country answers; any calendar provider's rules;
VAT on digital goods and services; how a Mini App can send text to a bot; any behaviour on a real
Telegram or WhatsApp client. The v9 mockup (7b and the evolution screens) was run in one browser tab
at phone size: the evolution flow (compare, ask a change, send, withdraw), media (select, make first,
a video refused as the main photo, remove, count shown in the catalogue), the filter sheet with the
active pill, the client tabs, the shop list; no console error. A static script resolves every value
the markup reads for 23 start screens. **Dark mode and the empty or loading states of the new
screens were checked by that script only, not by eye.** Section 8b rests on the existing teams' declared stages
(`~/.dsh/kybers`, read), the mandate and wake-up notes and `docs/dev/learned-skills.md`; it is a
design, nothing of it was run. Not verified: that an automation can start on an event (v1 polls), that
one team can hand a stage to another, that a stage fits in one wake's maximum duration (stages must
resume from the branch and notes), the real cost of one evolution, and that a cloud computer can open
PRs on the server repository.
