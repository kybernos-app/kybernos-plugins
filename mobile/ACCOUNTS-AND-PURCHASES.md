# Accounts and purchases in the phone app (plan, 2026-10-26)

Status: **in progress.** Owner, 2026-10-26 (latest word, replaces « payments are not activated at this stage »): **social sign-in and payments are launched now, with the target system for every country**, built on the offers contract
(`offers-json-contract-draft.md`, session notes), and the experience is harmonised between the phone app and DSH on the desktop. Built in separate sessions, each on a local branch, nothing deployed, nothing sold until the owner's store
accounts and the regional `channels` say so. Earlier line, kept for the history: payments NOT activated at this stage. Decision (owner, 2026-10-26): the app creates and signs in Kybernos accounts, shows the Free and Team plans, sells Team with
in-app purchase on both stores, and lets a person delete their account from the app. A person can skip all of it and use their own model keys. This reverses
rows 5 and 6 of `STORES.md` (2026-10-25: no purchase flow, no sign-up). The screens are in the private mockup (first launch, screen 6 « Modèles »,
https://claude.ai/artifact/9uPRqPWsM186QwUwXgBKjg).

## Decision of 2026-10-26 (later): what is launched and how

- **The target system, for every country**: the offers JSON (`GET /v1/offers`, session « Serveur : endpoint unique des offres ») says, per platform and storefront country, how a plan may be bought: `store` (StoreKit 2 / Play Billing),
  `web` (the Stripe checkout opened in the system browser, only where the store allows it) or `none`. Server providers `apple` and `google` write the same `subscriptions` rows as Stripe. The app shows names, copy, prices and availability
  only from that JSON.
- **Social sign-in**: Sign in with **Apple and Google** next to address and password (my default, to confirm). Apple 4.8 requires Sign in with Apple as soon as any other third-party login exists in an iOS app. The flows run on the server's
  own pages in the system browser (the device-code activation page DSH and the app already use; Google refuses embedded web views). Deletion for an account with no password needs another way to prove who is asking, and Apple's
  token has to be revoked on deletion.
- **Same experience on the phone and on the desktop, by contract**: one wizard, one wording (outcome-first copy of the mockup), the **account first** step with « Skip, I'll use my own key », the same plan cards read from the offers JSON, the
  same deletion path. **Allowed differences** (the few adjustments): the phone's native splash, welcome and consent pages before the engine starts (it must not start before consent), its loading screen, the text-size fit rule (cap 115 %,
  no scrollbar), and the purchase route (a store sheet on the phone, the Stripe page on the desktop).
- **Sessions** (each on its own branch, results come back here): offers endpoint `local_bd2303a0`; social sign-in on the server; store billing providers on the server; native purchase module in the app. Onboarding, the harmonised
  wizard and the offers client stay in this session.
- **Owner-only, now blocking real tests**: Apple Developer account and App Store Connect products, Paid Applications Agreement, bank and tax forms; Play Console merchant account and products; Apple « Sign in with Apple » Services ID and key,
  Google OAuth client; privacy-policy and terms URLs. Until they exist, everything is built against fixtures, StoreKit test configuration and a mock identity provider.

## What exists today

- **Account creation and sign-in** run on the server's own pages, opened in the system browser with a device code (`kybernos-cloud`); the phone app hides « Create an account »
  and the plan buttons (`STORE_HIDDEN` in `packages/kybernos-mobile/client.js`). The server has no social login (address and password only).
- **Server, deletion**: `POST /v1/me/delete` (password and the phrase `DELETE MY ACCOUNT`, a signed-in *session* only, not a device token), per-module erasure (ADR 0012),
  and a screen for it in the web account page (`/account`). It is refused while the person owns a workspace with other people in it, while a subscription is still charged
  (`active_subscription`) or when they are the platform's last owner.
- **Server, billing**: plans, plan versions, `subscriptions` (columns `source`, `provider_ref`, `interval`, `status`, period, `cancel_at_period_end`), entitlements computed at
  request time from the subscription (ADR 0004). **Stripe is the only payment provider; there is no in-app-purchase code.**
- **First launch today** opens the settings screen « Add your model key / Paste your Anthropic key » and the consent text says « by default Anthropic ». Both go.

## What is sold (the server's catalogue, `catalogue/*.json`)

| Plan | What | Price (USD, the EUR numbers are the same) | Fits in-app purchase? |
|---|---|---|---|
| Free | 1,000 credits a month, the free models or your own key | 0 | n/a |
| **Individual, level Plus** (key `solo`) | access tier 1, always-on computer | 24 a month, or 19 a month billed yearly | **Yes**: an auto-renewing subscription |
| **Individual, level Pro** (key `studio`) | access tier 2, usage ×2.5, always-on computer | 49 a month, or 39 a month billed yearly | **Yes**, same subscription group as Plus (the stores handle the move up and down) |
| Team | per seat, shared workspace, team lessons, skills and automations, tier 2 | 49 a seat a month, or 39 billed yearly; `min_seats` 2 in the catalogue | **Not as it is**: a store subscription has no seat quantity |
| Top-up | a pack of credits, 15 once, valid 12 months, 1 to 10 packs | 15 | Yes, as a consumable (a later step) |

So the individual levels are the natural first thing to sell with in-app purchase: four products (Plus and Pro, monthly and yearly) in one subscription group. Apple and Google are then the seller of record
and collect the tax, which differs from Stripe (price points are chosen per storefront, invoices are the store's). **To check**: the catalogue says Team has two seats at least, while the web wizard's plan screen
says « Team · solo », one seat; one of the two is out of date.

## The offers are iterated: the app never hardcodes them (owner, 2026-10-26)

The offers are being reworked by another session, so the phone app, DSH on the desktop and the web pages read **one JSON built by the server** (names, copy in each language, prices, formulas, where each plan can be bought per
platform and region, store product ids). A change of offer is then one catalogue file and a publish, with no client release. The mockup's cards (Free, Plus, Pro, Team) are only an illustration of the catalogue of 2026-10-26.
The contract draft is in the session notes folder (`offers-json-contract-draft.md`: new `GET /v1/offers`, built from the catalogue, `channels` per platform and region, test vectors); it has to be adopted by the server session before
anything here depends on it. Until then the app shows no paid plan at all, so nothing is hardcoded.

## What to build

### A. Accounts, free plan, own keys (small, no store account needed) — first build

1. First launch: welcome, consent (neutral wording, names who receives the data, legal read), then the web wizard; its model step becomes account first
   (« Create my account », « I already have an account », « Skip, I'll use my own key ») when the user agent says it is the phone app. Desktop keeps its order unless decided.
   The native « Add your model key » page is removed; keys stay in Settings. (`packages/kybernos-plugin`, `mobile/app`.)
2. Un-hide « Create an account » and the sign-in entries in the phone app; the account is created on the server's page in an in-app browser tab.
3. **Deletion from the app**: a « Delete my account » row in the app's Settings that opens the account page's deletion section in an in-app browser tab (Apple accepts a link to the
   web page when it is easy to find and needs no e-mail or phone call; confirm on submission day). After it, the app clears its local sign-in state. The server's `active_subscription`
   answer must say, for a store subscription, that the person cancels it in the App Store or Google Play first (deleting an account does not cancel a store subscription).
4. Team stays **hidden, with no call to action** in this build and in every build until purchases are activated (no Team card, no « See plans », no payment page): a plan that cannot be bought in the app, or whose payment page is on the web, is what review refuses (Apple 3.1.1). The mockup's switch « Gratuit seulement (stores) » is this build.

### B0. Prepared now, nothing switched on (no store account, no code that sells)

- **Contract written down first**: the messages between the web view and the app (`products`, `purchase`, `restore`, `manage`), the product-map shape (store product id → plan version, component, interval) and the product id naming, so the later build does not redesign anything. This section is the start of it.
- **One gate for every paid control**: today a fixed list hides them (`STORE_HIDDEN`). Activation replaces it by the `channels` of the offers JSON for this platform and storefront country (`none`, `web` or `store`), `none` until B1, so switching on is a flag and the Team card, the plan buttons and the wizard's plan screen appear by themselves. Nothing else changes on screen.
- **The server needs nothing for A**: entitlements do not depend on the payment provider and `subscriptions` already carries `source` and `provider_ref`. No server code is written ahead of B1 (it would be dead code).
- **Long-lead owner steps start now** because they take days or weeks and cost nothing (see C): the store developer accounts as an organisation (probably a D-U-N-S number: to check), the paid-apps agreements, bank and tax forms. Products can be created in the consoles as drafts, never published.
- **Decisions to take while waiting**: native or RevenueCat, one price or a higher one in the apps, multi-seat teams (D).

### Payment routes: Stripe does not replace StoreKit and Play Billing, it is a different route

StoreKit 2 and Play Billing are the stores' own payment systems; nothing in them goes through Stripe. Stripe stays our web rail (checkout, invoices, the `source = 'stripe'` subscriptions), and the
server keeps ONE `subscriptions` table whichever rail wrote the row. What each store lets an app do with Stripe, as reported by secondary sources on 2026-10-26 (RevenueCat's app-to-web guide,
Adapty; **rules and commissions are moving with the Apple and Google court cases: re-read Apple's guidelines and Google's payments policy before every submission**):

| | iPhone | Android |
|---|---|---|
| Web checkout opened from the app (the existing Stripe checkout) | **US**: allowed, 0 % commission for now, the court is to set a rate (Apple asked for up to 15 %). **EU** (from 2026-10-01): 15 % (10 % reduced), in-app purchase must be at least as prominent. **Japan, Brazil**: 15 %, in-app purchase offered alongside. **Elsewhere**: generally restricted | **US** (external content links): subscriptions 10 %, fees and reporting from 2026-10-01. **EEA, UK, Japan**: allowed under the matching programs, same fee scale |
| Stripe payment sheet inside the app | Generally not permitted (EU and Japan/Brazil have it at 20 % to 21 %, with conditions) | Allowed in several regions through alternative billing |
| Store billing | Required everywhere the above does not apply | Required elsewhere; user-choice billing in a few countries |

What this means: **in-app purchase cannot be avoided if Plus, Pro or Team are sold to iPhones worldwide**, but Stripe can cover some regions and is a much smaller build (the existing checkout opens in the browser; the commission is
reported to the store, which is new). So the single gate of B0 becomes a three-valued capability per platform and storefront country (StoreKit gives the storefront; Play gives the country): `none` (today, everywhere),
`web` (open the Stripe checkout, only where the store allows it) and `store` (in-app purchase). Switching a region on is a flag, not a redesign.

### B1. Switching payments on — two builds, in this order

**B1a, Stripe link-out where allowed (small)**: a « Subscribe » button in the phone app that opens the existing checkout in the system browser, only for the regions whose capability is `web`; the app asks the server
to confirm entitlements on return; the commission reports to Apple and Google are an owner and accounting step. No new server provider.

**B1b, in-app purchase (large)**

**Server** (`kybernos-server`, `src/modules/billing`): two new providers next to `stripe/`, `apple` and `google`.
- Verify the store's signed transaction (Apple: App Store Server API and signed transactions; Google: Play Developer API with the purchase token), keep a subscription row with
  `source = 'apple' | 'google'` and `provider_ref` = original transaction id or purchase token, so entitlements need no change.
- Receive the stores' notifications (Apple: App Store Server Notifications V2 URL; Google: real-time developer notifications through Pub/Sub) for renewals, expiry, grace, refund, revoke;
  add a reconciliation pass like the Stripe one.
- Bind a purchase to the person: Apple `appAccountToken`, Google `obfuscatedAccountId` (the account must exist first, which the account-first flow guarantees).
- A product map: store product id → plan version, component, interval. A restore endpoint (the app sends its current transactions; the server links them to the account).
- Deletion: `active_subscription` also covers store subscriptions; revoked or refunded purchases end the entitlement.

**App** (`mobile/app`, module `kybernos-host`): StoreKit 2 on iOS and Play Billing on Android, behind one small native interface (`products`, `purchase`, `restore`, `manage`);
the web view asks for a purchase through `postMessage`, the app answers with the result, the server validates. Prices shown are **the store's own localised price strings**, never our
catalogue's. « Restore purchases » and « Manage subscription » (deep link to the store's subscription page) live in Settings.

**Plugins** (`kybernos-cloud`, `kybernos-plugin` wizard plan screen, `kybernos-mobile`): in the phone app the plan card and the wizard's plan screen start a native purchase instead of opening
the web payment page; the hidden controls come back one by one, only when the product exists. Paid credits (« Add credits ») are consumable purchases, a later step.

### C. Only the owner can do (accounts and consoles)

- **Apple**: Apple Developer Program, Paid Applications Agreement, bank and tax forms, a subscription group and the Team product(s) in App Store Connect, the Server Notifications URL, sandbox testers.
  Apple's commission is 30 % (15 % under the Small Business Program, which has to be applied for): decide whether the app's price is higher than the web's.
- **Google**: Play Console merchant account, subscription products and base plans, a Pub/Sub topic and a service account with access to the Play Developer API, license testers.
- A written answer on **Team**: Apple and Google have no per-seat quantity on a subscription, so Team does not fit as it is; sold to organisations it may fall under Apple 3.1.3(c) and stay on the web (or on the
  Stripe link-out where the store allows it). To confirm with App Review, not assumed. Plus and Pro have no such problem.

### D. Open decisions

1. **Native StoreKit and Play Billing with our own validation** (my pick, awaiting the owner) or a purchase service such as RevenueCat. For a handful of products (Team solo, monthly and yearly) the native build is a few weeks and keeps the server the only authority over entitlements, with no new vendor in the payment path, no extra SDK in the app (privacy manifest, data-collection disclosure) and no revenue share. RevenueCat saves roughly one to two weeks and handles the stores' edge cases (grace period, billing retry, refunds, restore, cross-platform), at the price of a new subprocessor to declare (the server has a register), a fee after the free tier (about 1 % of tracked revenue, to check), a vendor between the stores and our entitlements, and our server still has to take its webhooks. The seam in B0 makes the choice reversible.
2. **Which plans are sold from the app, and by which route**: Plus and Pro with in-app purchase (and the Stripe link-out where the store allows it); Team on the Stripe link-out or the web only; top-ups later. Or the lean start: Stripe link-out only, where the stores allow it, and no in-app purchase at all at first. The first is the only way to sell to iPhones worldwide; the second is much less to build.
3. One price everywhere or a higher price in the apps to absorb the commission.
4. Whether the desktop wizard also puts the account first (the mockup only decides the phone app).

## Order and sizes (rough estimates, not commitments)

| Step | What | Rough size | Needs from the owner |
|---|---|---|---|
| A | Account first, free plan, deletion link, own keys, Team without a button | about a week with tests | nothing; consent text legal read |
| B0 | The contract, one gate for paid controls, owner steps started | days of the owner's time, no code that sells | enrolment, agreements, bank and tax forms (C), in parallel with A |
| B1a | Stripe checkout opened from the app where the store allows it, capability per region | days (estimate) | the commission and reporting set up in the store consoles; a read of the current rules |
| B1b | Server providers, native purchase module, bridge, restore; switch on | two to four weeks (estimate) | the consoles ready, products, a decision on D |
| Review | TestFlight external review, Play internal testing | days of waiting | the submissions |

Test plan for B1: StoreKit configuration file and sandbox testers on iOS, license testers on Android, signed-transaction fixtures on the server (unit), a stubbed store in the app's emulator tests,
then one real sandbox purchase on each platform before any submission.
