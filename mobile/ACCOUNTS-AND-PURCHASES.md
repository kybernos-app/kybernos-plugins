# Accounts and purchases in the phone app (plan, 2026-10-26)

Status: **planned, nothing built.** Decision (owner, 2026-10-26): the app creates and signs in Kybernos accounts, shows the Free and Team plans, sells Team with
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
4. Team stays **without any call to action** in this build (no « See plans », no payment page): a Team card with a web payment page is exactly what review refuses (Apple 3.1.1).

### B. In-app purchase for Team (the large part) — second build

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

1. Native StoreKit and Play Billing with our own validation (my pick: the server already owns entitlements, no new vendor in the payment path, a bigger build) or a purchase service such as RevenueCat (faster, but a new subprocessor and a fee).
2. One price everywhere or a higher price in the apps to absorb the commission.
3. Whether the desktop wizard also puts the account first (the mockup only decides the phone app).

## Order and sizes (rough estimates, not commitments)

| Step | What | Rough size | Needs from the owner |
|---|---|---|---|
| A | Account first, free plan, deletion link, own keys, Team without a button | about a week with tests | nothing; consent text legal read |
| B | Server providers, native purchase module, bridge, restore | two to four weeks | store accounts, products, tax and bank forms (C) |
| Review | TestFlight external review, Play internal testing | days of waiting | the submissions |

Test plan for B: StoreKit configuration file and sandbox testers on iOS, license testers on Android, signed-transaction fixtures on the server (unit), a stubbed store in the app's emulator tests,
then one real sandbox purchase on each platform before any submission.
