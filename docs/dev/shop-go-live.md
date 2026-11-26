# The shop in the chat: from the dev server to production

Status: **prepared 2026-11-05, nothing executed on production; the three owner decisions of 2026-11-06 (fee, countries, terms) are built on the dev server (release v61).** Written after the cart, the database, the payment sweep and the business name were live-checked on the Fly dev server (release v60). Companion of `docs/dev/shop-poc-contract.md` (what the trial does) and of the server's `docs/runbooks/sites.md` (how it runs).

## What exists and was seen working (dev server, Stripe TEST mode)

A merchant talks to Kaby on Telegram: the shop is defined (products, prices, cost, stock, photos retouched), the Stripe test account is made without a form, the shop has its own address `<shop>-<4 hex>.kaby.app`, a client fills a cart (several products), pays once on Stripe's page (named after the shop), the order is counted (on the client's return, or by the job `shop-payments` within a minute if the tab was closed), the stock goes down and the merchant gets one line in their chat. Shops, photos, the Stripe account and the orders are kept in the database (migration `0084_trial_shops`), and are in the person's export and gone with their account.

## What production does NOT have today (read 2026-11-05, names of secrets only)

`kybernos-production-server` (Fly, v7) holds the database, the mail key, the auth and backup keys, `PUBLIC_API_URL` and `TRUSTED_ORIGINS`. It holds **none** of: `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` / `TELEGRAM_BOT_USERNAME`, `SITES_DOMAIN` / `SITES_VERCEL_TOKEN` / `SITES_VERCEL_TEAM`, a computers provider (the cloud computers Kaby runs on), an LLM provider. Each of them switches a part of the shop on, so the shop needs the platform's chat door, its pages' host and its cloud computers to exist in production first; it is not a single switch.

## What is safe to ship now

Merging the server branch (`feature/shop-poc`, 20 commits on top of `origin/dev`, one migration) and deploying it changes nothing visible in production: without a Telegram bot the shop module is off, the payment path is built only from a Stripe **test** key (`createShopStripe` is never made with a live key; without a key `shop_connect` answers « This server takes no payment »), the job `shop-payments` is only registered when that path exists, and the migration adds two empty tables with their retention rows and their export/erasure sections. The server's CI has to go through a pull request (about 66 minutes of GitHub time, AGENTS rule 12): one run, once the owner says so.

## What has to be built before a real euro moves

1. **Live mode, Standard accounts only.** Today the whole payment path is test-only. A live path means: allow a live key for the shop's Stripe, refuse `test_account` (Custom accounts made from Stripe's test data must be unreachable with a live key), keep `createAccount` (Standard: the merchant fills their own details on Stripe) and the onboarding link, and show the merchant's own business name (a Standard account's name is theirs: `setBusinessName` is refused and ignored by design).
2. **Stripe Connect activated in LIVE mode for the legal entity** (Stripe's own verification of DIGI TECHNOLOGIES: the owner's, in Stripe's dashboard), the platform's Connect agreement, and the live key as a secret.
3. **A real webhook** (`checkout.session.completed` of connected accounts) next to the sweep: faster, and the sweep stays as the safety net. Needs the Connect endpoint registered in Stripe and its signing secret in the server (the owner's, after `stripe login`).
4. **Terms for merchants and buyers**: *decided 2026-11-06: the merchant is the seller and writes the terms of sale; Kaby reminds them and proposes a draft; the window shows them and asks the client to accept before paying (built).* Still to write, by the owner and a lawyer: the terms between Kybernos and the **merchant** (what Kybernos does and does not do: no refund, no shipping, no tax, keeps 1 %), and the line on the page naming the merchant as the seller (the page says « Boutique en mode essai » today). Not built: a proof of who accepted which version and when.
5. **The platform's side of the shop**: *the fee is decided: 1 % of each sale, as a Stripe application fee (built, test mode).* Still open: what happens to the fee on a refund or a dispute (Stripe lets the platform refund its fee: not wired), what the person sees when Kaby is asked to refund (nothing built; the merchant refunds in their own Stripe dashboard: say so), how the 1 % is invoiced and taxed (accountant).
6. **Production prerequisites listed above** (chat door, pages' host, cloud computers) and the cloud image with the shop tools promoted from the test image to the one new computers start from.

## Order

1. Merge the server branch (pull request, one CI run) and deploy it: invisible.
2. Bring up the chat door, the pages' host and the cloud computers in production (other workstreams, the owner's keys).
3. Build the live path (item 1) and the webhook (item 3); live-check with Stripe's test mode first on the production server, then switch the key.
4. Terms (item 4) written and reviewed before the first real merchant.
5. One real merchant, one real small payment, refunded from their Stripe dashboard.

## Decisions that are the owner's

- Whether the shop goes to production before or after the paid-from-day-one beta of the platform itself (they share the Stripe and Telegram setup).
- ~~The fee on a sale~~ **decided 2026-11-06: 1 % on each sale.** Open: the accounting of that fee and its VAT.
- ~~Which countries the first merchants are in~~ **decided 2026-11-06: every country where Stripe is available.** Built: 20 two-decimal currencies, the Standard account in the merchant's own country (asked by Kaby). Open: Connect in LIVE mode only covers the countries the platform's own Stripe account is allowed to onboard (the owner checks it in the dashboard), the VAT / tax each merchant owes in their country (theirs, not Kybernos's), the zero- and three-decimal currencies (jpy, kwd…), and the words of the window, which are French only.
- ~~Who writes the terms~~ **decided 2026-11-06: the merchant writes them, Kaby reminds them and proposes a version.** Open: the terms between Kybernos and the merchant (item 4).
