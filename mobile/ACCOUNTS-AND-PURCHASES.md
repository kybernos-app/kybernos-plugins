# Accounts and purchases in the phone app (plan, 2026-10-26)

Status: **planned, nothing built. Payments are NOT activated at this stage (owner, same day): the next steps are prepared, not switched on.** Decision (owner, 2026-10-26): the app creates and signs in Kybernos accounts, shows the Free and Team plans, sells Team with
in-app purchase on both stores, and lets a person delete their account from the app. A person can skip all of it and use their own model keys. This reverses
rows 5 and 6 of `STORES.md` (2026-10-25: no purchase flow, no sign-up). The screens are in the private mockup (first launch, screen 6 « Modèles »,
https://claude.ai/artifact/9uPRqPWsM186QwUwXgBKjg).

## What exists today

- **Account creation and sign-in** run on the server's own pages, opened in the system browser with a device code (`kybernos-cloud`); the phone app hides « Create an account »
  and the plan buttons (`STORE_HIDDEN` in `packages/kybernos-mobile/client.js`). The server has no social login (address and password only).
- **Server, deletion**: `POST /v1/me/delete` (password and the phrase `DELETE MY ACCOUNT`, a signed-in *session* only, not a device token), per-module erasure (ADR 0012),
  and a screen for it in the web account page (`/account`). It is refused while the person owns a workspace with other people in it, while a subscription is still charged
  (`active_subscription`) or when they are the platform's last owner.
- **Server, billing**: plans, plan versions, `subscriptions` (columns `source`, `provider_ref`, `interval`, `status`, period, `cancel_at_period_end`), entitlements computed at
  request time from the subscription (ADR 0004). **Stripe is the only payment provider; there is no in-app-purchase code.**
- **First launch today** opens the settings screen « Add your model key / Paste your Anthropic key » and the consent text says « by default Anthropic ». Both go.

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
- **One gate for every paid control**: today a fixed list hides them (`STORE_HIDDEN`). Activation replaces it by a capability the app announces (« this phone can buy »), false until B1, so switching on is a flag and the Team card, the plan buttons and the wizard's plan screen appear by themselves. Nothing else changes on screen.
- **The server needs nothing for A**: entitlements do not depend on the payment provider and `subscriptions` already carries `source` and `provider_ref`. No server code is written ahead of B1 (it would be dead code).
- **Long-lead owner steps start now** because they take days or weeks and cost nothing (see C): the store developer accounts as an organisation (probably a D-U-N-S number: to check), the paid-apps agreements, bank and tax forms. Products can be created in the consoles as drafts, never published.
- **Decisions to take while waiting**: native or RevenueCat, one price or a higher one in the apps, multi-seat teams (D).

### B1. In-app purchase for Team (the large part) — built and switched on later

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
- A written answer on **multi-seat teams**: Apple has no per-seat quantity on a subscription, so « Team solo » (one seat) can be a fixed product; teams of several people may fall under
  Apple 3.1.3(c) (sold to organisations) and stay on the web. To confirm with App Review, not assumed.

### D. Open decisions

1. **Native StoreKit and Play Billing with our own validation** (my pick, awaiting the owner) or a purchase service such as RevenueCat. For a handful of products (Team solo, monthly and yearly) the native build is a few weeks and keeps the server the only authority over entitlements, with no new vendor in the payment path, no extra SDK in the app (privacy manifest, data-collection disclosure) and no revenue share. RevenueCat saves roughly one to two weeks and handles the stores' edge cases (grace period, billing retry, refunds, restore, cross-platform), at the price of a new subprocessor to declare (the server has a register), a fee after the free tier (about 1 % of tracked revenue, to check), a vendor between the stores and our entitlements, and our server still has to take its webhooks. The seam in B0 makes the choice reversible.
2. One price everywhere or a higher price in the apps to absorb the commission.
3. Whether the desktop wizard also puts the account first (the mockup only decides the phone app).

## Order and sizes (rough estimates, not commitments)

| Step | What | Rough size | Needs from the owner |
|---|---|---|---|
| A | Account first, free plan, deletion link, own keys, Team without a button | about a week with tests | nothing; consent text legal read |
| B0 | The contract, one gate for paid controls, owner steps started | days of the owner's time, no code that sells | enrolment, agreements, bank and tax forms (C), in parallel with A |
| B1 | Server providers, native purchase module, bridge, restore; switch on | two to four weeks (estimate) | the consoles ready, products, a decision on D |
| Review | TestFlight external review, Play internal testing | days of waiting | the submissions |

Test plan for B1: StoreKit configuration file and sandbox testers on iOS, license testers on Android, signed-transaction fixtures on the server (unit), a stubbed store in the app's emulator tests,
then one real sandbox purchase on each platform before any submission.
