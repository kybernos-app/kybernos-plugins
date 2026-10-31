# Apps and Publish: team access to an app through a hosted web app

Status: **framing (cadrage), version 2, 2026-10-31. Nothing is built.** Version 1 of this page (merged as `8d20b9f3`, titled
"Share as an app") framed one Fly machine per shared db, a "Share" button with a people panel in DSH, and a paid `apps` key.
The owner's directions of the same day replace four things: the vocabulary (Publish, not Share), the hosting unit (one cloud
computer per team space), the gate (the Cloud pot, no `apps` key) and where people are managed (in the hosted app). They also
add the surface that goes with it: **Apps**, which replaces Tables in the menu. The measured facts of version 1 are kept.

**Revision of the same evening (section 12):** for now, Publish does not create a computer. The person chooses one of their own cloud
computers, and a button takes them to their Kybernos server to order another. Sections 5, 7 and 11 are read with that in mind; where
they differ, section 12 wins.

It refines the phases of `custom-objects-brainstorm` (kept in the maintainer's memory): phase C "team online-first" is delivered
by the hosted app, without a sync engine. Phase B (one person, several devices) is a different problem and stays untouched.

## 1. The question, and the one-line answer

Members of a team must work on the same app (the e-commerce kit: contacts, products, orders) although its db is a SQLite file
on one computer. **Do not copy the file to every member. Publish the app: its db moves to a web app with sign-in on a cloud
computer. Members use a browser (nothing to install); the owner and the owner's agents keep working from DSH on the same db.**

One truth means no conflicts, no outbox and no revoking of a device. The price: the db lives on a machine that is reachable from
the internet, so "your data stays on this computer" becomes "on a machine that is yours" (section 4).

## 2. What was measured

| Fact | How it was checked |
|---|---|
| Tables is single-owner. `can()` (`core/rights.mjs`) refuses everyone but the owner and the store never calls it; the page's writes are signed `person` (`api.mjs`, `BY`) and it sees every field in clear. | read the code (10-31) |
| `routes.mjs` guards every data route with DSH's signed session (`session-guard.mjs`); `api.mjs` is pure (no http, no clock but the one injected), so the same door can stand behind another login. | read the code |
| The store has **no archived state and no delete-table or delete-db operation**. | read the code (10-31) |
| The server has no module for dbs. It has a `ComputerProvider` port with a Fly driver (one Fly app, one machine and a 2 GB volume per computer; proxy autostop off, the control plane drives sleep), a `Mailer` (SMTP) and an hourly meter on the workspace's **Cloud pot**: disk 550000 micro-USD a month (`computers_asleep_cost_micro_usd_per_month`) and 9200 micro-USD an hour awake (`computers_awake_cost_micro_usd_per_hour`), provider cost before the plan multiple. Plus Cloud budget is $3, Pro $6, top-up from $10. A used-up pot sends awake computers to sleep and marks them `budget`. `CreateSpec.env` is documented as "API address, id, restricted token" only. | read the server |
| Always awake costs about $0.55 + 730 hours x $0.0092 = **about $7.30 a month** in provider cost, above both included budgets. In the code every computer can sleep; no paid exception exists. | computed from the settings |
| A request to a **suspended** Fly machine wakes it by itself, so the budget gate does not stop a member's request (to verify). A **stopped** machine loses requests: a "paused" page needs a front. | read the driver, not tested |
| The webapp creator runs apps locally (start, stop, logs), ships three templates and three skills. **Publishing is "batch 3" and not built**; the `web` template is a plain `node:http` shell; apps use their own `donnees.sqlite` and the `mini-app-pack` contract, not Tables. | read the bundle |
| `kaby.app` is bought: its name servers are Vercel's (`dig`, 10-31). It must not be attached to a Vercel project (cadrage of 2026-10-27, section 6). | `dig` |
| **Spike passed**: Hono 4.13.14 + Better-Auth 1.7.14 on `node:sqlite`, with a Tables db behind the session: 16/16 checks on Node 22.23.4 and 26.7.0; idle 108 MB, first request 148 ms; the Tables store and `can()` run outside DSH; a write is signed with the real user id; `backlinks` gives the inverse side of a relation; `can()` refuses a member (`not-owner`). Code in `~/kybernos-archive/spike-hono-better-auth-2026-10-31/`. | executed |
| Better-Auth ships `organization`, `access` and `admin` plugins (members, invitations, roles). **Not exercised** by the spike. | listed the package |
| The three kits (`packages/kybernos-plugin/themes/<kit>/db/*.json`): e-commerce 4 tables and 10 views, real estate 5 tables and 14 views, recruitment 5 tables and 13 views (not installed on the maintainer's DSH); each also brings a dashboard, 2 to 4 automations, 2 skills and an agent team. The e-commerce `contact` has 12 fields, only `email` is `personal`; no kit has a `sensitive` or `secret` field. | read the files and the real db, read only |

Not verified: that `agent/service.mjs` (the interface the agent tools and the page use) is narrow enough to have a second,
remote implementation; that the Tables page can run outside DSH (it is a DSH module, 270 KB).

## 3. The surface: Apps

Decided with the owner on 2026-10-31 (a clickable mockup, kept in the maintainer's memory and archive, shows every screen).

**One concept, "an app".** An app is data and its views, plus, when it comes from a template, a dashboard, automations, skills and
an agent team. A template is a ready-made app for a trade (today the three kits). **Publish turns any app into a web app.** There
is no separate "webapps" list, and the word "table" only appears inside an app.

- **Menu**: New chat (without a Kaby picker), Dashboards, Automations, Connectors, Skills, Agent Teams, **Apps**, Creations. The
  Templates page and the Business group go away; Overview joins Dashboards. The menu is fixed, so the kits' menu labels are dropped
  and a kit's name goes in the app's title.
- **Apps page**: one card per app (icon tile, name, one line, counts, state Private or Published, a menu: Open, Ask Kaby, Publish or
  Published, Archive). No schema on the card. Archived apps fold under the cards.
- **One app**: it opens on its first table. Tabs are the tables; **Relations** is the last tab, an extra view that draws how the
  tables link, shown only when the app has more than one table. Header: back, name, Publish, Ask Kaby, and a menu (archived tables,
  Archive app).
- **New app**: describe it to Kaby (a chat ending in an approval card), or start from a template. A template opens a card with two
  options: sample rows, and "also add what comes with it". Three "Simple starts" (blank, contacts and companies, projects and
  tasks) have no trade.
- **No hand editing in Kybernos.** No New row, no cell editing, no Modify view. One **Ask Kaby** button opens a **new chat** with the
  app, the table and the view attached; the change comes back as the usual approval card. Creating, renaming and removing views
  also go through Kaby.
- **Archive and delete** (an app or a table). Archive hides it from the lists and from Kaby and deletes nothing; restore any time.
  Delete is only offered on archived items, asks to retype the name and lists what disappears (tables, rows, links, files), links
  first for a table. **A published app cannot be archived**: "Unpublish first".
- **Creations** keeps the visual outputs (pages, slides). Mini apps backed by data move to Apps and use the same data layer. Before
  building, read what `kybernos-webapp-creator` stores (its own `donnees.sqlite`) and decide whether its three templates and the
  `mini-app-pack` contract become kits or stay apart.

## 4. Which copy is the truth

| | Shape | Good | Costly |
|---|---|---|---|
| **A. The db moves into the hosted app** (recommended, and implied by the owner's Publish direction) | The hosted copy is the only truth. DSH (page and agent tools) reads and writes it through the app's API as the owner. A read-only snapshot comes back every 5 minutes. **Unpublish brings the db back to this computer as it is.** | one truth, no sync, members can write | the Tables service needs a remote implementation; the owner cannot write offline; the data is on a cloud computer |
| B. Publish a copy | The app shows a snapshot; the owner re-publishes. | trivial, local stays truth | members cannot write: it is not sharing |
| C. Run the app on the owner's computer | Same file, tunnel to the internet. | no copy, data really at home | the computer must stay on; exposes the machine |

Rules that come with A:

- An app with a `sensitive` or `secret` field is **refused** for Publish, naming the fields: there is no end-to-end encryption
  before phase C (decision 10 of the brainstorm). `personal` fields go, masked for the profiles that may not read them.
- The message becomes "your data lives on a machine that is yours, and you can export it as a SQLite file at any time".
- Removed members lose their sessions at once.
- An app that is published is not archived and not deleted from DSH.

## 5. Hosting and cost

*Superseded for now by section 12 (a person's own cloud computer, its own sleep and billing). Kept as the design of the dedicated,
always-awake team-space computer, which may come back as a paid option.*

- **One cloud computer per workspace, the team space.** The first Publish creates it (a Kybernos Computer, EU region); every
  further published app joins it at no extra cost and one account opens every app of the team space. Unpublishing the last app
  switches the computer off and billing stops.
- **Always awake** (owner decision): a sleeping team space means members who wait. At about $7.30 a month it exceeds the Plus and Pro
  Cloud budgets: the Publish card says so and offers to add credit. The computer must therefore be exempt from the idle sleep that
  exists for every computer today.
- **Billing** is the Cloud pot, as for any cloud computer. **No `apps` plan key** (version 1's D2 is withdrawn): credit is the gate.
- **Budget used up**: the whole team space goes to Paused (the pill on the cards and in the header says so, with "Add credit").
  Nothing is deleted and the copy stays on the owner's computer. Members see a "paused" page, not an error.
  Two things are to settle: how a member's request is refused while the budget is out (Fly wakes a suspended machine by itself),
  and a front that answers for a stopped machine.
- **DNS and TLS**: `<slug>.kaby.app` (reserved words refused), wildcard TLS by DNS-01 (`caddy-dns/vercel`), a router in front.
- **Backups**: RPO of 5 minutes, RTO of 30, weekly restore drill (frozen 2026-10-27). `kybernos-webapp-creator/lib/backup.mjs` is
  a start, but it names `donnees.sqlite`; it must take any db file.

## 6. The hosted app

- **One process per team space**: Hono + Better-Auth (its `organization` plugin for members, invitations and role names) in
  `auth.sqlite`, the Tables store and an **actor-aware `api.mjs`** over one db file per published app, one volume. Hono stays the
  choice (the spike removed the Better-Auth and `node:sqlite` risk; it did not compare Hono with Nitro or NestJS), and the app is
  written as a plain request-to-response handler so the framework can change.
- **Owner bootstrap**. The spike's "first sign-up is the owner" is a race on a public URL, so it is not used. The computer is
  created with a secret **hash and signing key** in its environment (the provider port needs a `secrets` field: `CreateSpec.env` is
  not meant for it). "Open web app" in DSH mints a **one-time signed link** (valid for minutes) that signs the owner in; a banner
  asks once for a password of their own, then the owner signs in directly. Break-glass is a reset from Kybernos (rotate the secret
  and restart), not a permanent master password. The per-instance secret is stored encrypted like `computers.hooks.secret_ct`.
  Login is rate-limited.
- **People** are managed only in the hosted app, on an owner-only screen: invite by e-mail (the server's `Mailer`) or by link, see
  who is active or invited, resend, remove. DSH has no people panel. One owner at first; several owners later.
- **Profiles** are data shipped by the template, in the db catalogue, so DSH and the app read the same rules. For the e-commerce
  kit: **Owner** (everything, including people) and **Team member**: reads everything, **adds and edits** orders and notes, edits
  contacts without deleting them, reads products (except `stock`, which can be edited), sees `email`. **A member never deletes and
  never changes structure** (fields, tables, views): that stays with the owner, through Kaby. Row rules (own rows only) are
  phase D, not here.
- **Rights engine**: `can(actor, action, resource)` grows from "owner or nothing" to additive, default-deny profiles with field
  visibility (hidden, read-only). It is enforced **in the app server on every route** (lists drop hidden fields, writes are
  validated), never in the page. One pure function for the page, the agent and the app, with shared test vectors.
- **Identity v1**: accounts local to the team space, created from an invitation. "Sign in with Kybernos" is a later server piece
  (the server only consumes OIDC today). A `person` field is matched to a member by e-mail. `created_by` is the Better-Auth user id.
- **The owner's agent** acts through an owner-scoped API token, not a cookie; writes keep the approval cards and record who acted
  for whom (`on_behalf_of`).
- **UI**: a **lean web UI generated from the catalogue** (list, detail, a form to add a row, board for choice fields), mockup first,
  real tokens. The Tables page is a DSH module and was not run standalone. This is the largest unknown of the slice.
- **Safety defaults**: HTTPS only (`.app` is HSTS-preloaded), `Secure`, `HttpOnly` and `SameSite` cookies, Origin check (403 on a
  foreign origin in the spike), CSRF middleware on every non-GET route (**not covered by the spike**), rate limit on sign-in and
  invitations, body limit, the `ops` journal as the audit trail, ADR 0012 export and erase extended to hosted dbs.

## 7. The slice (v1): the e-commerce kit published for 1 to 5 members

1. In **Apps**, **Publish** on the app (header or the card's menu).
2. A card, in the form of an approval card: what leaves (tables, rows, files), where it will live (a new cloud computer, or the
   team space already running), what it costs and from which budget, what happens when the budget runs out, which fields are
   `personal`, what stays here, how the owner gets in. Nothing happens before "Publish".
3. The computer starts (first Publish), the app is created at `<slug>.kaby.app`, the db is uploaded.
4. "Open web app" signs the owner in; a banner asks for a password. The owner invites by e-mail or by link from the app.
5. The member picks a password and lands in the app: they see what their profile allows, add and edit rows with a form.
   The owner's DSH shows the change (it polls the db fingerprint, as today).
6. Removing a member ends their sessions at once. **Unpublish** brings the db back to DSH and, for the last app, switches the
   computer off.

## 8. Out of scope for v1

Custom domains, payments, member writes while offline, two-way sync, end-to-end encrypted fields, SSO, row rules, several owners,
mobile apps, rollback of the generated UI, members creating fields or tables.

## 9. Lots, in order

| Lot | What | Where | Needs |
|---|---|---|---|
| L0 | **Store: archived state and delete-table / delete-db**, with the effect on links and tests. | plugins | nothing |
| L1 | **Apps page**: menu change, cards, one app opening on its first table, Relations as an extra view, Ask Kaby as a new chat with context, templates and Simple starts, archive and delete cards. No hand editing. | plugins | L0 |
| L2 | **Actor-aware door and profiles**: `api.mjs` takes an actor; `can()` gets profiles and field visibility; the e-commerce profiles as template data; rights matrix tests with shared vectors. | plugins | nothing; also useful inside DSH |
| L3 | **App shell**: Hono + Better-Auth + organization + store + door for several app dbs, runnable locally as a webapp-creator template `tables`; owner bootstrap by one-time link; People screen; the spike's 16 checks plus the rights matrix and "removed member loses the session". | plugins | L2 |
| L4 | **Front of the hosted app**: mockup with real tokens, then the lean UI over the catalogue, with the add-row form. | plugins | L3 |
| L5 | **Remote in DSH**: the Tables service against the app's API, owner token, snapshot back, the Publish card, Unpublish brings the db back; archive of a published app refused. | plugins | L3, and the `service.mjs` width check |
| L6 | **Hosting**: server team-space computer on the provider port (`secrets`, no idle sleep, EU), `*.kaby.app` and TLS, billing on the Cloud pot, pause when the budget is out and the front for a stopped machine, backups and the restore drill. | server | independent of L1 to L5 until Publish |
| L7 | **Launch hardening**: rate limit, CSRF, e-mail invitations, GDPR (export, erase, privacy text), audit view. | both | L3, L6 |

L0 and L1 are local, visible and testable on the real GUI, and need no server: they are the natural first delivery. L6 is the long
pole and goes to its own session in the server repo.

**Acceptance on the real thing** (a stranger can follow it): publish the e-commerce app; open the web app from DSH and set a
password; invite a member by e-mail; the member signs up, sees orders and edits one; the owner's DSH shows it; the agent adds a note
and the member sees it; the member opens the API by hand and cannot read a hidden field or delete a contact; the owner removes the
member and their open tab is refused at the next request; the budget is emptied and the member sees the paused page; unpublish
brings the db back; a restore from the 5-minute backup works.

## 10. Risks

- Width of the Tables service interface (decides the size of L5).
- The generated UI is a project of its own; a poor UI makes the whole slice feel unfinished.
- Always awake costs more than the included Cloud budgets: users meet a bill the first time they publish. The card must say it
  before, and the price of the plans may need a second look.
- The budget gate does not stop a request to a suspended machine, and a stopped machine answers nothing.
- Removing hand editing in Kybernos makes a one-cell fix a round trip in a chat; bulk changes gain from it. To watch in use.
- The local-first message is diluted for published apps; the wording must be exact.
- Better-Auth moves fast: pin the exact version; the organization plugin is untested here.
- `node:sqlite` is still flagged experimental on Node 22 (a warning, no failure); the runtime version is pinned.

## 11. Decisions

Taken by the owner on 2026-10-31:

| Decision | Outcome |
|---|---|
| Sharing in DSH | one Publish button; people are managed in the hosted app |
| Where it runs | **revised the same evening (section 12):** one of the person's own cloud computers, chosen at Publish; a button opens their Kybernos server to order another. Before: a new computer, always awake, one per workspace |
| Gate | credit only, no `apps` plan key |
| Kaby | one Ask Kaby button, a new chat with context; no hand editing in Kybernos |
| Archive and delete | archive or delete an app or a table; a published app cannot be archived |
| Menu | Apps replaces Tables and the Business group; templates are ready-made apps; Publish makes any app a web app |
| Six follow-ups | Overview joins Dashboards; kit menu labels dropped; Simple starts kept; one owner first; members add and edit but never delete; Creations keeps visual outputs and data-backed mini apps move to Apps |

Still open:

| # | Question | Recommendation |
|---|---|---|
| D3 | Member identity in v1 | accounts local to the team space, from an invitation; Kybernos sign-in later |
| D4 | Front of the first slice | lean generated UI, not the extracted Tables page |
| D6 | Price of always awake (about $7.30 a month against $3 and $6 included) | **parked by section 12:** the chosen computer's own sleep and billing apply, so the card makes no price or "always on" claim it cannot read from that computer; it returns if a dedicated team-space computer comes back |
| D7 | What `kybernos-webapp-creator` becomes (three templates, `mini-app-pack`, its own `donnees.sqlite`) | read it before L1, then decide: kits on the Tables layer, or a separate path |

## 12. Revision (2026-10-31, evening): Publish onto one of the person's own cloud computers

**Decision (owner).** For now, when the person presses Publish, the only thing they choose is **which of their cloud computers receives
the app**, and one button takes them to their Kybernos server (the console's Computers page) to **order another one**. Publish creates
no computer, shows no price estimate, applies no budget gate of its own and promises no "always on". The owner also accepted that the
hosted app runs **on the same machine as their own DSH**.

A cloud computer here is the one of ADR 0052 of the server repository: a DSH with the Kybernos plugins, a volume at `/data`, the Gate as
the only exposed port, sleeping (suspended with its memory) when idle. The person already orders and manages them on their server.

### What the person sees

- **Publish dialog**: a list of their cloud computers (name, state running or sleeping, region), one picked by default (the only one, or
  the last used); the usual "what leaves, which fields are personal, what stays here" lines; a button "Get another cloud computer" that
  opens the server's Computers page in the browser; Publish. With no computer at all, the dialog says so and shows only that button.
- **Honest wording**: no price, no "always on" unless the computer itself is set always on. For a computer that sleeps: "This computer
  sleeps when idle; your team waits about a second when it wakes." For the shared machine: "This computer also runs your agents. To keep
  them apart, order another computer for your apps."
- **After Publish**: the card and the header say which computer hosts the app. If that computer is deleted, the app shows "its computer is
  gone"; the local copy stays, and Unpublish with the typed-name forget path brings the app back as a local one.
- **Moving** an app from one computer to another is Unpublish then Publish in v1.

### What it changes in the design

| Piece | Before (section 5) | Now |
|---|---|---|
| Computer | created by the first Publish, one per workspace, EU, always awake | one the person already has, chosen at Publish |
| Cost and gate | Cloud pot credit, estimate on the card, pause when the budget is out | whatever that computer already costs; no gate or estimate in the dialog |
| Sleep | exempt from idle sleep | normal sleep; a member's request wakes it (about a second); hosted traffic must count as activity for the idle rule |
| Exposure | its own origin | the Gate stays the only exposed port; the router sends `<slug>.kaby.app` to the hosted app on that computer, which has its own sign-in (members are not Kybernos users) |
| Isolation | a machine of its own | same machine as the owner's DSH: the hosted app runs as another OS user in its own directory and port, never sees the DSH's volume, credentials or the computer's device token, and gets only its own boot key and auth secret |
| Hosting port | `ensureSpace({ workspace })` | `hosts()` lists the person's computers, `describe().orderUrl` is the server page the order button opens, `ensureSpace({ host })` starts the hosted app on the chosen one (built on the DSH side: `docs/dev/apps-hosting-port.md`) |

Kept as they are: the DSH side (mirror, facade, `published` refusals, registry), the hosted app and its bundle API, the router and slug
rules, the per-instance keys and their rotation, the backups with the restore drill and the retention sentence, the write-freeze route,
the mail secrets and the privacy contact. Dropped for now: the dedicated team-space computer, the idle-sleep exemption, the price
estimate, the budget pause and the "paused" page of a space. They return as a paid option if a dedicated always-awake computer comes back.

### Open

- How the hosted app gets onto an existing computer: baked into the computer image, or installed on the first Publish. The server and
  the image owner decide; the plugin only needs `ensureSpace` to answer once the app answers `GET /health`.
- Whether the idle rule can count the hosted app's requests as activity without a change to the computer image.
- ~~A person with several computers who published apps on two of them~~ Decided and built on the DSH side: each space and each app records the
  host id (and the app the last name and region seen), the card and the header say "on <name>", and "its computer is gone" is declared only when
  the app cannot be reached **and** a successful `hosts()` no longer lists the computer (asked at most once a minute; a failed `hosts()`
  proves nothing). Moving an app stays Unpublish then Publish.
- Whether the server wants `hosts()` to count a computer that is being created as `starting` or leave it out of the list until it runs (the
  dialog shows `starting` as « Starting » and Publish onto it waits for `ensureSpace`).
- The real `orderUrl`: the plugin opens whatever `https` address the hosting gives, unchanged; the server decides whether it carries a return
  path or a pre-selected plan.
