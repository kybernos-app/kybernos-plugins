# Known gaps: what the reading says, before any test ran

Written 2026-11-04 from a read of the server (`dev`), the plugins, the phone and desktop repositories, their ADRs and the project notes. **Nothing here was run.** Each entry is a candidate: the case that names it (`known` in `cases.json`) either confirms it as a defect, a missing feature or a decision, or finds it was wrong. A gap that is confirmed goes to the ledger with a severity; a missing feature the product does not promise is an enhancement, not a bug.

The server's local `dev` checkout is behind `origin/dev`, so every server claim below is against `origin/dev` where the reading could tell, and must be rechecked on the build the recette runs against.

## KG-01 Legal pages are not final
The six legal pages carry 16 visible « TO VERIFY BEFORE PUBLICATION » marks (8 French, 8 English: Telnyx and Resend region and retention, owner mailbox retention) and two hidden comments (« capital 20 000 EUR, à revérifier »). The server's `LISEZ-MOI` says no lawyer has reviewed them. Cases J01-04, J20-07, J20-12.

## KG-02 E-mails: few, English only, plain text
The server sends the one-time code, the team invitation, the account-deletion confirmation and owner alerts, all English, plain text, no HTML. Nothing is sent for: welcome, invitation accepted, declined or revoked, member removed, low credit, a computer going to sleep or being deleted, a finished data export. Cases J09-03, J09-11, J09-12.

## KG-03 No change of e-mail address
The `change-email` code type exists and its route is disabled. J05-11.

## KG-04 No way to decline an invitation
There is no decline route; the invitation is accepted, revoked by an admin, or expires after 7 days. J09-12.

## KG-05 A dispute that closes is not handled
`charge.dispute.closed` and the funds-withdrawn and funds-reinstated events are not handled. A won dispute does not restore the revoked credit; the runbook says it is done by hand, with no route. J08-05, J08-06.

## KG-06 A dispute on a subscription payment only writes a log line
Only a top-up dispute revokes credit. On a subscription payment the server logs a warning and changes nothing. J08-05.

## KG-07 A partial refund does nothing
A full refund of a top-up takes back the unspent credit; a partial refund does nothing, and a refund of a subscription payment does nothing by design. J08-04.

## KG-08 Payments that fail at Stripe leave no trace on the server
`checkout.session.async_payment_failed`, `payment_intent.*` and `checkout.session.expired` are not handled. A card refused at checkout sends no event: the person only comes back with `?paid=0`. J06-03, J08-09.

## KG-09 A top-up can be sold to a past-due workspace
Recorded in the server as a test that is expected to fail (`it.fails`, `recette-money-subscriptions.test.ts`). J07-06.

## KG-10 No coupons, no tax credit notes, no test clock in the repository
No coupon or promotion code exists. Credit notes are not handled. The tax figures are not stored (four settings, default 0). Stripe test clocks are not used anywhere; a renewal cannot be rehearsed without one. J06-06, J06-13, J07-01.

## KG-11 No cancel or resume route
Cancel, resume and immediate cancel are done in the Stripe portal; the « Downgrade to Free » button opens the portal. J07-10.

## KG-12 Cached tokens are billed as ordinary input
ADR 0049 slice 2 is not built: only the `price_cache_read_nano` column exists. J10-03.

## KG-13 Provider-busy fallback and a server-side Auto model are not built
Failover exists between deployments of one model (408, 429, 401, 403, 5xx); `provider_busy` does not. Auto Routing lives in the plugin only. Named in the README, not expected by a single case.

## KG-14 Cloud computer: billing is flat, the quote is not, no in-place upgrade
Resize and image upgrade are not built; shape, disk and region are fixed at creation. The hourly meter charges a flat rent plus awake time whatever the shape, while the quote endpoint is shape-aware and always says `charged: false`. A computer whose budget ends is suspended by the hourly pass, up to an hour later. J12-07, J12-08, J12-10, J12-11.

## KG-15 The desktop's refusal table lacks three codes
`COMPUTER_REFUSALS` in `kybernos-cloud` and the `kbnc.cc.err.*` strings do not know `budget_exhausted`, `extra_cap_exhausted` or `plan_required`; the person reads a generic « refused ». J12-01, J12-08.

## KG-16 Pushing work to a computer is partial
The automation outbox (`PUT …/computers/{id}/tasks`) is on `origin/dev` only. Not built: webhook ingress (the URL is minted, nothing answers), file and attachment push, settings and environment push. Telegram turns on a computer are behind a flag that is 0. Skills, lessons and memory are pulled by the computer, not pushed. J13-01, J13-08.

## KG-17 Stale words about model routing
`kybernos-cloud`'s README still says « LiteLLM proxy »; ADR 0057 retired it. The server calls providers directly; Vercel AI Gateway is only an own-key provider in the plugin's catalogue (`AI_GATEWAY_API_KEY`) and Vercel hosts the published `*.kaby.app` pages. J10-07.

## KG-18 Kaby: what is not there yet
Video-face providers all read « soon »; a custom voice is stored but not spoken; the mandate does not reach cloud computers; the server flags for Telegram, WhatsApp, computer turns, the home computer on open and the Kaby MCP server are all 0. J14-04, J14-06.

## KG-19 Phone link: server half and push
The server half (`/v1/remote/*`, the relay, the phone origin) is described as built and not deployed. Push notifications and a native remote app are not built. J04-08, J04-09.

## KG-20 Social sign-in was never run against Apple or Google
Only the stand-in (`REPLICA_SOCIAL=1`). Real providers need the owner's Services ID, key and OAuth client. J03-03, J05-07.

## KG-21 Phone stores: no accounts, Team cannot be an in-app purchase
No Apple or Google store account is set up. A store subscription has no seat quantity, so Team cannot be sold as it is. The Website and Help links and some « upgrade » texts were on the list to sweep before submission. J03-05, J03-07.

## KG-22 Desktop distribution
Installers are not signed or notarised, auto-update is out of scope, and the Windows and Linux installers were built by CI and never run by hand. J02-02, J02-14.

## KG-23 Language is not one setting
The server's web pages follow the browser (French or English only), the legal pages take `?lang=`, e-mails are English, while the app has 11 languages and an AI translation of any other. J18-05.

## KG-24 No welcome credit unless set
`welcome_credit_cents` is 0 by default, so a new Free account gets nothing and the « once per address » rule cannot be seen. J05-08.

## KG-25 Egress was never tested against a hostile process
The nftables policy was played with ordinary processes (W3-06). J12-05.

## KG-26 The replica must be built from `origin/dev`
The local server `dev` is 117 commits behind `origin/dev` (the task outbox, extra budget ADR 0066, LiteLLM retired). Named in the README, not expected by a single case.

## KG-27 The mails Stripe sends are a dashboard setting
Receipt, failed-payment, renewal-reminder and refund mails are not sent by the server and nothing in the repository says they are switched on. J07-02 reads them in the Stripe test dashboard. Named in the README, not expected by a single case.

## KG-28 Generating pictures, video and voice is not built on the server
The cadrage (ADR 0063) is on an unmerged server branch; the catalogue lists the kinds, nothing sells a generation yet. J10-09.

## KG-29 Not built on the automation side
A budget per automation, a certification chip, the « Open » card in the chat, the old Journal Advanced graph. J16-09.

KG-29 update 2026-11-04: a certification badge IS drawn on the Automations page for the states « Awaiting approval », « Checks failed » and « Refused » (`kybernos-plugin/client.js`); only a positive « Certified » chip is missing. A budget per automation and the Open card in the chat are still not built, and nothing promises them in the plugins (the public page `/ai-agent-teams` promises a budget per task: UJ-66).
