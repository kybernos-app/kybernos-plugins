# Share as an app: team access to a Tables db through a published web app

Status: **framing (cadrage), 2026-10-31. Nothing is built.** The owner's idea, 2026-10-31: instead of syncing a db to every
member's DSH, publish it as a small web app with sign-in. This page measures what that needs, cuts a first slice on the
e-commerce kit, and lists the five decisions that are his.

It refines the phases of `custom-objects-brainstorm` (kept in the maintainer's memory): phase C "team online-first" is delivered
by the app, without a sync engine. Phase B (one person, several devices) is a different problem and stays untouched.

## 1. The question, and the one-line answer

Members of a team must work on the same Tables db (the e-commerce kit: contacts, products, orders) although the db is a SQLite
file on one computer. **Do not copy the file to every member. Put the db in a small web app with sign-in: members use a browser
(nothing to install), the owner and the owner's agents keep working from DSH on the same db.**

One truth means no conflicts, no outbox and no revoking of a device. The price: the shared db lives on a machine that is
reachable from the internet, so "your data stays on this computer" becomes "on a machine that is yours" (section 3).

## 2. What was measured (2026-10-31)

| Fact | How it was checked |
|---|---|
| Tables is single-owner. `can()` (`core/rights.mjs`) refuses everyone but the owner and the store never calls it; the page's writes are signed `person` (`api.mjs`, `BY`) and it sees every field in clear. | read the code |
| `routes.mjs` guards every data route with DSH's signed session (`session-guard.mjs`); `api.mjs` is pure (no http, no clock but the one injected), so the same door can stand behind another login. | read the code |
| The server has no module for dbs, and `FEATURE_KEYS` (`billing/features.ts`) has no key for apps. It does have a `ComputerProvider` port with a Fly driver (volumes, regions, public URL) and a `Mailer` (SMTP). | read the server |
| The webapp creator runs apps locally (start, stop, logs), ships three templates and three skills. **Publishing is "batch 3" and not built**; the `web` template is a plain `node:http` shell; apps use their own `donnees.sqlite` and the `mini-app-pack` contract, not Tables. | read the bundle |
| `kaby.app` is bought: its name servers are Vercel's (`dig`, 2026-10-31). Whether it is attached to a Vercel project was not seen; it must not be (cadrage of 2026-10-27, section 6). | `dig` |
| **Spike passed**: Hono 4.13.14 + Better-Auth 1.7.14 on `node:sqlite`, with a Tables db behind the session: 16/16 checks on Node 22.23.4 and 26.7.0; idle 108 MB, first request 148 ms; the Tables store and `can()` run outside DSH; a write is signed with the real user id; `backlinks` gives the inverse side of a relation; `can()` refuses a member (`not-owner`). Code in `~/kybernos-archive/spike-hono-better-auth-2026-10-31/`. | executed |
| Better-Auth ships `organization`, `access` and `admin` plugins (members, invitations, roles). **Not exercised** by the spike. | listed the package |
| The e-commerce kit: `contact` (12 fields, only `email` is `personal`), `product`, `orders` (links to `contact` and `product`), `note` (link to `contact`); `contact.company` links to `contact`. No `sensitive` or `secret` field. | read the real db, read only |

Not verified: that `agent/service.mjs` (the interface the agent tools and the page use) is narrow enough to have a second,
remote implementation; that the Tables page can run outside DSH (it is built as a DSH module, see section 5).

## 3. The decision that shapes everything: which copy is the truth

| | Shape | Good | Costly |
|---|---|---|---|
| **A. The db moves into the app** (recommended) | The app's copy is the only truth. DSH (page and agent tools) reads and writes it through the app's API as the owner. A read-only snapshot comes back every 5 minutes. | one truth, no sync, members can write | the Tables service needs a remote implementation; the owner cannot write offline; the data is on a Fly machine |
| B. Publish a copy | The app shows a snapshot; the owner re-publishes. | trivial, local stays truth | members cannot write: it is not sharing |
| C. Run the app on the owner's computer | Same file, tunnel to the internet. | no copy, data really at home | the computer must stay on; exposes the machine; one sleep and the team is locked out |

**Recommendation: A**, on a Fly machine in an EU region, SQLite on a volume (the 2026-10-27 decision: one database per app).
Rules that come with it:

- A db with a `sensitive` or `secret` field is **refused** for sharing, naming the fields: there is no end-to-end encryption
  before phase C (decision 10 of the brainstorm), so those fields cannot be put on a server. `personal` fields go, masked for
  the profiles that may not read them.
- The message becomes "your data lives on a machine that is yours, and you can export it as a SQLite file at any time".
- Members who are removed lose their sessions at once.

## 4. The slice (v1): the e-commerce kit shared with 1 to 5 members

What the person sees:

1. In Tables, **Share as an app** on a db (a paid feature, decision D2).
2. Kaby shows a card: what leaves (tables, rows, files), where it will live (region), what it costs, which fields are
   `personal`. The owner confirms (same approval card as a schema change).
3. The app is created: machine and volume, address `<slug>.kaby.app` (reserved words refused), the db uploaded as a snapshot.
4. The owner invites by e-mail (the server's `Mailer`) or copies a link. The member picks a password and lands in the app.
5. The member sees what their profile allows and edits it. The owner's DSH shows the change (it polls the db fingerprint, as today).
6. Removing the member ends their sessions at once.

**Profiles** are data shipped by the template (the brainstorm's "template ships preset profiles"), in the db catalogue, so DSH
and the app read the same rules. For the e-commerce kit: **Owner** (everything) and **Team member** (read everything; create and
update orders and notes; update contacts but not delete them; products read-only except `stock`; `email` visible). Row rules
(own rows only) are phase D, not here.

**Rights engine**: `can(actor, action, resource)` grows from "owner or nothing" to additive, default-deny profiles with field
visibility (hidden, read-only). It is enforced **in the app server on every route** (lists drop hidden fields, writes are
validated), never in the page. Same pure function as the page and the agent use, with shared test vectors like the rest of `core/`.

## 5. Architecture

- **One Hono app per shared db**: Better-Auth (with its `organization` plugin for members, invitations and role names) in
  `auth.sqlite`; the Tables store and an **actor-aware `api.mjs`** over `db.sqlite`; one process, one volume.
  Hono stays the choice (the spike removed the Better-Auth / `node:sqlite` risk; it did not compare Hono with Nitro or NestJS,
  and the app is written as a plain request-to-response handler so the framework can change).
- **Identity v1**: accounts local to the app, created from an invitation. A "Sign in with Kybernos" provider is a later server
  piece (the server only consumes OIDC today). A `person` field is matched to a member by e-mail.
- **Roles**: Better-Auth holds the role *names*; their *meaning* lives in the db catalogue (one place).
- **Authors**: `created_by` is the Better-Auth user id (the store accepts up to 64 characters; checked in the spike).
- **The owner's agent** acts through an owner-scoped API token, not a cookie; writes keep the approval cards and record who
  acted for whom (`on_behalf_of`).
- **UI**: the Tables page is a DSH module (`window.__ModuleLoader__`, slots, the toolbar of `kybernos-plugin`); running it
  standalone was not tried. v1 therefore uses a **lean web UI generated from the catalogue** by the existing build skill (list,
  detail, board for choice fields), mockup first, real tokens. Extracting the real page is a later option. This is the largest
  unknown of the slice.
- **Hosting** (server repo, its own session): an `apps` module on the existing provider port (it is shaped for Kybernos
  Computers: shapes, image, restricted token, so reuse or a sibling driver is a design call), a router machine, wildcard TLS for
  `*.kaby.app` by DNS-01 (`caddy-dns/vercel`), a plan feature key `apps`.
- **Backups**: RPO of 5 minutes, RTO of 30, weekly restore drill (frozen 2026-10-27). `kybernos-webapp-creator/lib/backup.mjs`
  is a start, but it names `donnees.sqlite`; it must take any db file.
- **Safety defaults**: HTTPS only (`.app` is HSTS-preloaded), `Secure`, `HttpOnly` and `SameSite` cookies, Origin check (the
  spike got 403 on a foreign origin), CSRF middleware on every non-GET route (**not covered by the spike**), rate limit on
  sign-in and invitations, body limit, the `ops` journal as the audit trail, ADR 0012 export and erase extended to app dbs.

## 6. Out of scope for v1

Custom domains, payments, member writes while offline, two-way sync, end-to-end encrypted fields, SSO, row rules, several dbs
in one app, mobile apps, rollback of the generated UI.

## 7. Lots, in order

| Lot | What | Where | Needs |
|---|---|---|---|
| L1 | **Actor-aware door and profiles**: `api.mjs` takes an actor; `can()` gets profiles and field visibility; the e-commerce profiles as template data; rights matrix tests with shared vectors. | plugins | nothing; also useful inside DSH |
| L2 | **App shell**: Hono + Better-Auth + organization + store + door, runnable locally as a webapp-creator template `tables`; invitations by link; the spike's 16 checks plus the rights matrix and "removed member loses the session". | plugins | L1 |
| L3 | **Front**: mockup with real tokens, then the lean UI over the catalogue. | plugins | L2 |
| L4 | **Remote in DSH**: the Tables service against the app's API, owner token, snapshot back, the Share card and its approval. | plugins | L2, and the `service.mjs` width check |
| L5 | **Hosting**: server `apps` module, Fly, `*.kaby.app`, TLS, plan key, backups and restore drill. | server | independent of L1 to L4 until publish |
| L6 | **Launch hardening**: rate limit, CSRF, e-mail invitations, GDPR (export, erase, privacy text), audit view. | both | L2, L5 |

L1 to L3 are local and testable on the real GUI; L5 is the long pole and goes to its own session in the server repo.

**Acceptance on the real thing** (a stranger can follow it): share the e-commerce kit; invite a member by e-mail; the member
signs up, sees orders and edits one; the owner's DSH shows it; the agent adds a note and the member sees it; the member opens
the API by hand and cannot read a hidden field or delete a contact; the owner removes the member and their open tab is refused
at the next request; a restore from the 5-minute backup brings the db back.

## 8. Risks

- Width of the Tables service interface (decides the size of L4).
- The generated UI is a project of its own; a poor UI makes the whole slice feel unfinished.
- The local-first message is diluted for shared dbs; the wording must be exact.
- Cost of an always-on Fly machine per app is not measured; it decides the price and whether apps autostart.
- Better-Auth moves fast: pin the exact version; the organization plugin is untested here.
- `node:sqlite` is still flagged experimental on Node 22 (a warning, no failure); the runtime version is pinned.

## 9. Decisions for the owner

| # | Question | Recommendation |
|---|---|---|
| D1 | Which copy is the truth (section 3) | A: the db moves into the app |
| D2 | Gate | a paid feature key `apps`, separate from team seats |
| D3 | Member identity in v1 | accounts local to the app, from an invitation; Kybernos sign-in later |
| D4 | Front of the first slice | lean generated UI, not the extracted Tables page |
| D5 | Where it runs in v1 | Fly, EU region; the Kybernos Computer as a second target later |
