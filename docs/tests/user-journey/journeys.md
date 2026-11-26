# The journeys

One section per journey of `cases.json`: who walks it, where it starts, the path, what is broken on purpose, and where the expected values come from. The cases hold the checks; this page holds the story, so a walker can be given one journey and know the shape of the whole. Persona **A** is the desktop account, **B** the second account (the cloud computer or a second desktop), **C** the newcomer on a profile never paired. A journey says « staging » where the deployed test server and Stripe test mode are used and « replica » where the local stand-in is enough.

## J01 Visitor on the public site
**Who** a person who has heard of Kybernos and has no account. **Path** landing → use cases → plugins → integrations → pricing → enterprise form → download → legal hub (six pages) → help center → blog, in English then French, at 390, 768 and 1440 px. **Inject** the release feed blocked (offline fallback), the form with the network cut, every cookie choice. **Oracle** the server catalogue for every figure (never what the page prints), the release tag for versions, the site's own redirect table for old addresses.

## J02 Install and update on a computer
**Who** someone who does not use a terminal (the app), and someone who does (the source). **Path** download → Electron on macOS (then Windows and Linux when a machine exists) → three-step rail → open signed in → repair → diagnostic; separately `kybernos-install` from the archive, `--dry`, a real install, an update, a rollback, safe mode, start at login, headless Linux. **Inject** Node missing, a tampered archive, a start that fails after the write, an engine killed by hand, a full disk. **Oracle** the lifecycle engine's own tests, the byte-for-byte profile before and after a rollback.

## J03 The phone app
**Who** a phone user, iOS first (simulator, then the owner's phone), Android on the emulator. **Path** install → splash → consent (the engine must not start before it) → account first or skip → sign up and in (address, Apple, Google through the stand-in) → first turn → report an answer → delete the account. **Inject** the network cut mid-turn, background and kill, text at 115 %, rotation, three languages, consent version bumped. **Oracle** the offers JSON for every price and plan, the store-hidden table of the mobile repository.

## J04 Phone remote control
**Who** account A and a phone. **Path** Phone and channels → QR or link → pair → the phone runs the computer's own DSH → unpair. **Inject** relay down, computer asleep or restarted, a replayed frame, a revoked phone, a plan that no longer lists `remote`. **Oracle** the recorded proxy traffic (only ciphertext leaves), the plan data.

## J05 Account and onboarding
**Who** persona C, then A. **Path** wizard → account first or skip → sign up with the code from the mailbox → verify → sign in → password reset → two-factor → devices and sessions → device-code pairing → own key or local model → /account. **Inject** wrong code, expired code, six codes in an hour, unverified sign-in, a reset while a desktop is paired. **Oracle** the replica mailbox (`/__/code`, `/__/mail`) and the server's identity tests.

## J06 Subscribe and pay
**Who** A on the staging server. **Path** Free → Plus monthly → Pro (prorated) → yearly → portal → invoices, then the same refused. **Inject** Stripe's test cards (one per refusal), a 3DS challenge passed and failed, tax settings on and off, a tab closed or a network cut at the payment, `?paid=1` typed by hand, the same notification twice. **Oracle** the server catalogue and the Stripe test dashboard. **The owner types the card** on Stripe's page; agents watch before and after.

## J07 Renewal, failure, cancel
**Who** A on a Stripe test clock. **Path** renew → renew with a card that fails → past due (banner, model calls paused, team features kept) → 47 hours → 49 hours → Free → recover with a new card; cancel at period end → the last day → Free; resume; immediate cancel. **Inject** the clock, the card that attaches then fails, a lost notification (the 15-minute reconcile). **Oracle** `past_due_grace_hours` (48 by default), the entitlement rules of ADR 0059.

## J08 Top-up, refund, dispute
**Who** A and a team owner. **Path** buy 10, 100, 2000 dollars → spend across the pots → refund in full, in part, after spending → dispute opened, closed won, closed lost, on a top-up and on a subscription payment. **Inject** amounts out of range, the other currency, a paid amount that differs from price times quantity, a past-due workspace. **Oracle** a hand-computed spending order checked by `audit-consumption.mjs`.

## J09 Team, invite, roles
**Who** A as owner, B as member, a third made-up address as invitee. **Path** Solo → Team (2 seats) → invite by e-mail → accept → roles → team window → shared skills and automations → remove B → B loses everything → leave → transfer → cancel. **Inject** expired, revoked and wrong-address invitations, a mail that fails to send, seats below members. **Oracle** the roles table of the server, the replica mailbox.

## J10 Models and what they cost
**Who** A on Free, Plus and Pro. **Path** pick a model → turn → see cost (chip, footer, Usage, /account) → hit the 5-hour and 7-day limits → credit gone → own key (including Vercel AI Gateway) → local → free models → Auto Routing. **Inject** 402, 429, 403, 502, 503 from the stand-in engine, a wrong key, five fixed token mixes. **Oracle** prices in nano-dollars from the catalogue, recomputed by `audit-consumption.mjs`.

## J11 Connectors (Composio)
**Who** A. **Path** Discover (about 1,601 apps) → Connect a managed-OAuth app → Connect an API-key app → a tool call with approval → hit the connection limit → disconnect. **Inject** a link left for 30 minutes, access revoked at the provider, a throttled call, an empty connector pot. **Oracle** the plan's `max_connections`, 0.0005 dollar of provider cost per action.

## J12 Cloud computer: create, run, bill
**Who** A, B on the computer. **Path** create → boot → open by ticket → run a turn → sleep → wake → run on a schedule → budget runs out → top up → delete. **Inject** Free plan, no consent, over the cap, egress modes, a hostile process, a stopped machine, a full volume. **Oracle** rent 0.55 dollars a month over 720 hours and awake 0.0092 dollars an hour, times the private multiple, one UTC hour at a time; compared with the pot, the gauge, `/computers/usage` and the console.

## J13 Push work to the cloud computer
**Who** A, B. **Path** publish an automation → the computer pulls it → it runs while the desktop is off → the result returns; hand a task from a chat; a skill goes out and a lesson comes back; an approval is answered from the desktop and the phone. **Inject** the computer asleep at the time, budget out, an edit and a deletion after publishing, a task older than 7 days. **Oracle** the computer's own task list and Journal.

## J14 Kaby
**Who** A with every bundle on. **Path** Settings › Kaby → chat → Telegram link → wake-up approved → mandate limits → Suggested by Kaby → Pulse → front desk → outside assistant (MCP) → site publish. **Inject** the server flags at 0 and 1, the mandate limit, Kaby off and on again, Free with no credit, three languages. **Oracle** the mandate classes, the flags in the server's settings.

## J15 Creations: make, edit, share, publish
**Who** A. **Path** ask for each type (Word, Excel, Markdown, PDF, deck, maquette, dashboard, table, app, 3D, motion, bricks) → open → edit by hand while the agent edits → save → reopen → share (snapshot, with a password) → publish to `<name>.kaby.app` → take down. **Inject** a corrupt file, a 50 MB workbook, a wrong password, a taken name. **Oracle** byte comparison before and after an edit; the sealed page holds only ciphertext.

## J16 Automations
**Who** A. **Path** create by chat, on the sheet, as a reminder → schedule → run → approve → fail → retry → publish to a team or the computer. **Inject** time-zone and clock changes, a run missed while asleep, two runs overlapping, no credit. **Oracle** the occurrence calculator's table for every schedule shape.

## J17 Skills and lessons
**Who** A, B. **Path** Featured → install → ask for one in chat → learned skills in three modes → team skill submitted, reviewed, published → pushed to the computer → lesson back. **Inject** a skill with hidden text or an injected instruction, a rejected skill, an edit after approval. **Oracle** the vetting vectors file and the team-skills contract.

## J18 Languages, themes, look
**Who** A, in each language. **Path** switch language (no restart) → add a language by AI translation → themes gallery and studio → sector themes → light and dark → widths. **Inject** right-to-left, long German and Russian words, Chinese and Japanese, zoom 200 %, reduced motion, a job cancelled and a restart in the middle of a translation. **Oracle** the key tables, the contrast computed from styles.

## J19 Resilience and operations
**Who** A. **Path** a bundle broken → safe mode → a full disk → a kill in the middle of a save → a network cut → a clock jump → restart from the product → a 300-turn chat. **Oracle** « DSH still starts » and the byte state of sessions and files.

## J20 Security and privacy
**Who** an attacker and an auditor. **Path** foreign-origin calls to plugin routes → hostile strings in every name → tokens reused → a planted instruction in a page → secrets in evidence → what is sent against what the privacy page lists → export and erasure. **Oracle** the route-origin rule, the subprocessors page, the activity log.

## J21 Same facts on every surface
**Who** nobody; scripts. **Path** prices, limits, plan names, legal links, versions and refusal wording compared across the site, the server, the desktop and the phone. **Oracle** the server catalogue.

## J22 Leaving: delete, export, clean up
**Who** B. **Path** try to delete with a team and a plan (refused) → cancel → delete → confirmation mail → sign-in refused → the same address signs up again → export → remove every test customer, clock, computer and sandbox the recette made.
