# Webapp Creator — framing: apps with a mini base, published on `*.kaby.si`

Status: **framing (cadrage), 2026-10-27** — Phase 0 closed on the domain (§9.1, `kaby.app` ordered at
Vercel); Phase 1 started: the three skills of §4 are written and seeded into `<DSH home>/skills`. The owner's ask, in his words: a DSH plugin
« Webapp Creator » driven by **very high-level skills for mockups and websites**, that creates an
application **with a database**, hosted on the **Kybernos Computer** « like Manus does », where the
person also gets a **mini base** and a shareable link of the shape `monsite.kaby.si`.

One-line answer: no new engine. One bundle (`kybernos/webapp-creator`) that chains three things that
already exist — agent skills, the SQLite mini-base contract, and the Cloud Computer — behind one
flow, plus the two things that do not exist yet: **publishing a public URL per app** and **shipping
skill folders inside a plugin** (the `kybernos/skills#skill` point, contract 6.2).

## 1. The benchmark: what Manus ships

From Manus's own documentation ([Cloud Infrastructure](https://manus.im/docs/website-builder/cloud-infrastructure),
[Website API](https://open.manus.ai/docs/v2/website), [WebDev billing](https://help.manus.im/en/articles/13885710-how-does-webdev-billing-work)):

| Manus | State for us in v1 |
|---|---|
| Full-stack apps: backend logic, forms, auth | yes — a small server per app (`webapp.json` runtime) |
| Integrated persistent database | yes — the **mini base** (SQLite, already visible in DSH) |
| File storage for uploads | v1: media in the base (data-URL, `mini-app-pack` contract); heavy files out of scope |
| One-command deployment, hosted URL | yes — publish = one skill call, link `slug.kaby.si` |
| Version history per site, publish/rollback | v1: git-like snapshots per publish; rollback in phase 3 |
| Custom domains | phase 3 (needs per-app TLS) |
| Access control, payments, SEO, analytics | out of v1 (access control: link key only) |
| Figma import, GitHub export, mobile app publishing | out of scope |
| WebDev billed per deployed app (usage) | open decision 6 — metering hook reserved in the manifest |

What we have that Manus does not: the data stays in **the person's own mini base**, browsable in the
DSH « Base de données » tab, and the whole build loop is a chat with the person's own agent and models.

## 2. The flow (user story)

1. « Crée une app de prise de rendez-vous pour mon cabinet » → the **brief skill** interviews (2–5
   questions): purpose, audience, pages, entities, look.
2. The **maquette** comes first: a declared-fidelity mockup of the key screens, reviewed visually,
   validated by the person before a line of production code.
3. The **build skill** generates the app (pages + small server) and the **mini base** (schema,
   demo data marked « démo »). The base shows up in the DSH sidebar immediately.
4. Local preview in the chat (panel/iframe), iteration in the conversation (« ajoute un champ
   téléphone »).
5. **Publish**: `webapp-publish` reserves the slug, routes it, checks it — the person gets
   `https://monapp.kaby.si`, copyable, with the mini base still local and editable.

## 3. The four layers

| Layer | What it is | State |
|---|---|---|
| **A. Skills** (the quality layer) | orchestration + mockup + site craft, §4 | 3 skills to author, 7 to reuse |
| **B. Mini base** | `~/.dsh/kybers/<app>/donnees.sqlite` + `pack` manifest + `crm.cjs` hands | **exists** (`mini-app-pack`, `mini-crm-base`, `dsh-db-viewer`) |
| **C. Runtime + link** | small server per app, reverse proxy, `*.kaby.si` | pieces exist, publication does not (§6) |
| **D. Plugin shell** | `kybernos/webapp-creator` bundle: projects page, preview, Publish button, host routes | to build, standard contract |

## 4. The skills layer — « very high level mockups and websites »

The bar is the one already enforced by the repo's delivery rules: a mockup with a **declared fidelity
level**, at **real CSS**, contract-checked, then **visually reviewed image by image**; a site judged
against an anti-slop design standard; and the five-point UI test pass before delivery.

| Skill | Role | State |
|---|---|---|
| `webapp-brief` | interview → `webapp.json` brief (pages, entities, look, slug) | **to author** |
| `webapp-build` | chains maquette → code → mini base → local run, with the gates below | **to author** |
| `webapp-publish` | slug, DNS/TLS/proxy, smoke test on the public URL, publish note | **to author** |
| `html-prototype` | polished, responsive, self-contained HTML mockups/prototypes | exists |
| `frontend-design` + `design-taste-frontend` | distinctive visual design; anti-slop for sites and landing pages | exists |
| `maquette-dsh` | the mockup discipline: three fidelity levels, `check-maquette.mjs` contract, `planche.png` read with `read_image`, `regard.md` | exists (its discipline is reused for sites; DSH tokens only apply to the plugin's own UI) |
| `redesign-existing-projects` | iteration loop: upgrade an existing site to premium quality | exists |
| `mini-app-pack` + `mini-crm-base` | the mini-base contract and its `crm.cjs` hands | exists |
| `webapp-testing` | Playwright pass on the generated app | exists |
| `usecase-recettes-visuelles` | visual-explanation recipes for the marketing pages | exists |

**Quality gates carried by `webapp-build` (non-negotiable):**

1. **Maquette before code** — fidelity declared (`statique` / `simple` / `interactive`), real CSS,
   reviewed as images (`read_image`), faults fixed and re-rendered before build.
2. **Design class routing** — any mockup/design/front-end delegation routes to the design route
   (Claude Code, high effort), per the profile's auto-routing rule; never a text model guessing CSS.
3. **Responsive + dark mode + empty states** — every generated site ships the 480 px breakpoint,
   a dark theme and its empty/error states; screenshots of **each** state are read, not just taken.
4. **The five-point UI pass** — behaviour (each gesture played live, disk writes verified,
   persistence after reload), vision (every state captured *and read*), dark mode, homogeneity against
   the mockup, edge cases (empty screen, double submit, back button).
5. **Data honesty** — demo rows are marked « démo », never invented real-looking data.

## 5. The mini base (existing contract, reused as-is)

`~/.dsh/kybers/<app>/donnees.sqlite` + a `pack` manifest row + `crm.cjs` hands
(`init exec query tables check erd export apercu`). The DSH « Base de données » tab renders it at
once: ERD, auto dashboard, Liste/Cartes/Calendrier views, read-only SQL. The webapp's backend is the
same file: the server reads/writes this SQLite and nothing else. This is the Manus « integrated
database », minus the vendor's cloud.

## 6. The link: `monsite.kaby.si`

**Precedents in the repo.** Each Cloud Computer already has a server-named `origin_host`
(`*.computers.kybernos.app` shape, checked in `packages/kybernos-cloud/index.js`); the mobile PWA
study (`docs/dev/mobile-remote.md`) weighed a wildcard `<sid>.m.kybernos.app` + wildcard certificate
and shipped **one origin first**; `packages/kybernos-gate` is a sign-in + reverse-proxy front;
`docs/dev/hosted-instances.md` documents the TLS-proxy pattern (`--trusted-host`, guarded plugin
routes). DSH itself refuses `--host 0.0.0.0` on purpose — a published app is **not** the DSH UI: it is
a separate small server behind its own proxy.

**Measured (2026-10-27).** `foo.kybernos.app` answers today: the wildcard DNS `*.kybernos.app` already
points at **Vercel** (`x-vercel-error: DEPLOYMENT_NOT_FOUND`), certificate `CN=kybernos.app`. And
`kaby.si` is **NXDOMAIN at the `.si` TLD** (no NS record): unregistered, free to take.

**Options (decision 1):**

| | Shape | Prerequisites | Notes |
|---|---|---|---|
| A | `*.kaby.si` (dedicated domain) | register `kaby.si` (~a few €/yr), wildcard DNS, wildcard TLS (ACME DNS-01) | clean isolation of user content; the industry pattern (`manus.space` ≠ `manus.im`, `vercel.app`, `github.io`) |
| B | `*.apps.kybernos.app` (delegated sub-zone) | wildcard cert for `apps.` only; routing on the apex's Vercel | free and fast, one level of isolation; still inside the apex's cookie and reputation scope |
| C | `*.kybernos.app` directly (`monsite.kybernos.app`) | per-app routing on Vercel + reserved-name list | **not recommended**, see below |
| D | `apps.kybernos.app/<slug>` paths | one cert only | no DNS work; uglier link; fine as a dev fallback |

Why C is refused for **user-generated content**: (1) any cookie scoped `Domain=.kybernos.app` (now or
later) is sent to every published app — a session leak with one careless app; (2) one phishing or
malware page published by a user gets `*.kybernos.app` flagged by Safe Browsing — the marketing site,
`api`, `help`, `skills` and the phone link fall together; (3) the apex's wildcard is Vercel's, so every
app becomes a proxy route on the product's own edge. Product domains and user content get separate
domains for exactly these three reasons.

**Recommendation (updated 2026-10-27, second round).** Measured free at the TLD: `kaby.app`,
`kaby.site`, `kaby.si` (all NXDOMAIN, none registered). The proposal is now **`*.kaby.app`**:

- **`.app` over `.site`** — (1) the product publishes *apps*: `rdv.kaby.app`; (2) `.site` is among the
  most abused TLDs (spam/phishing lists) — a wildcard of user content on it invites Safe Browsing
  false flags; (3) `.app` is **HSTS-preloaded**: the whole TLD is HTTPS-only in every browser, free
  hardening for user content (no plain HTTP ever, no SSL stripping). Caveat: no HTTP at all on the
  domain, even for a dev box — fine for this architecture.
- **Registrar** — Vercel is fine (same account as `kybernos.app`; the DNS-01 wildcard automation
  works with it: `caddy-dns/vercel` exists; check whether the Vercel Pro plan's free-domain offer
  covers `.app`). Cloudflare Registrar is the cheapest renewal (measured 2026-10-27: $8.20 first
  year / $14.20 renew, at-cost) and its DNS API is the smoothest for wildcard certs; Gandi renews
  `.app` at $47.98 — avoid.
- **Setup** — do NOT attach the domain to a Vercel project (that routes the wildcard to the product
  edge); one `*.kaby.app` record to the app proxy + apex to `kybernos.app`; wildcard TLS via ACME
  DNS-01; auto-renew ON.

B as the internal beta fallback if the registration waits; Phase 1 (local build) needs no domain at
all.

**Where the app runs (decision 2).** The ask is « hosted on the Kybernos Computer ». Measured reality:
a computer **suspends** and can refuse with `run_hours_exhausted` (`packages/kybernos-cloud/index.js`,
`COMPUTER_REFUSALS`) — a public site on it goes down with it. Options: (a) keep the computer awake
while an app is published (run-hours cost), (b) a small always-on runner (a VPS/container, the
`hosted-instances.md` pattern), (c) publish only static snapshots + tiny API. This is the one
product decision that shapes the SLA we can honestly advertise.

## 7. What exists vs what must be built

| Piece | State |
|---|---|
| Mini base + viewer + hands | exists (`mini-app-pack`, `mini-crm-base`, `dsh-db-viewer`) |
| Mockup discipline + site craft skills | exists (§4) |
| Cloud Computer: run a turn, wake/sleep, `origin_host` | exists |
| Reverse proxy + sign-in front | exists (`kybernos-gate`), for DSH instances |
| Plugin contract, registry, Plugins page | exists (`docs/dev/plugin-contract.md`, `kybernos-registry`) |
| **Ship skills in a plugin** (`kybernos/skills#skill` 1.0) | **not built** — a pack can only *name* GitHub/shipped skills (`plugin-contract.md` §6.2, `domain-packs.md`). Workaround today: seed the skill files into `<DSH home>/skills`, as `plugin-creator` already does (never over a person-edited file) |
| **Public URL per app** (slug, DNS, TLS, proxy route) | **not built** (§6) |
| Per-app runtime supervision (start/stop/limits) | **not built** |
| Version history / rollback of published apps | **not built** (phase 3) |

## 8. Security and guardrails

- **A published app is internet-facing.** Default v1: **link key** (unguessable path token or a
  password, the gate pattern); « public » is opt-in per app, said in the Publish dialog.
- **One app = one SQLite file**, read/written only by its own server process; no shell, no file
  routes, no second database.
- **Generated code runs by design** — the review gate is the skills' build contract (no `eval`, no
  dynamic `import` of remote code, dependencies pinned and listed in `webapp.json`).
- **Slug rules** (the README's name rule): one label, lower-case, no separator tricks, 32 chars,
  reserved words refused (`www`, `api`, `app`, `kaby`…).
- **Bounds**: request size, rate limit per app, disk quota for the base and media.
- **Sensitive sectors** (the person works in Health and Law): the manifest carries a `data: personal |
  none` flag; `personal` forces the link key and shows a privacy line in the Publish dialog.

## 9. Open decisions for the owner

1. **Domain** — ✅ **decided 2026-10-27: `kaby.app`, ordered at Vercel** (`*.kybernos.app` refused
   for user content, §6). At publish time: one `*.kaby.app` record to the app proxy, the apex to
   `kybernos.app`, wildcard TLS via ACME DNS-01 (`caddy-dns/vercel`), and the domain must NOT be
   attached to a Vercel project.
2. **Where apps run**: keep the Kybernos Computer awake while published (a), always-on runner (b),
   or static+API only (c)? This sets the honest availability promise.
3. **Access**: link key by default (proposal) — agreed?
4. **Skills delivery**: seed into `<DSH home>/skills` today (the `plugin-creator` precedent) or build
   the `kybernos/skills#skill` point first (contract work, benefits every vertical bundle)?
5. **Runtime v1**: one small Node/SQLite server per app (proposal) vs containers per app.
6. **Billing**: publishing included in the plan, or metered like Manus's WebDev (the manifest keeps a
   usage hook either way)?
7. **Versions**: is snapshot-per-publish enough for v1 (rollback in phase 3)?

## 10. Roadmap and gates

**Phase 0 — framing and mockup (this doc).** Gate: the owner answers §9 (1)–(4).

**Phase 1 — build locally.** `webapp-brief` + `webapp-build` + the three new skills; an app with its
mini base runs locally; the base is visible in the sidebar; the §4 gates pass (screenshots read).
Gate: one real app (e.g. appointment booking) built from a one-line brief, iterated twice in chat.

**Phase 2 — publish.** `webapp-publish` + the proxy/DNS/TLS leg + link key; smoke test on the live
URL. Gate: `https://slug.kaby.si` (or `apps.kaby.si/slug`) answers, survives a DSH restart, and a
stranger without the key gets the refusal page.

**Phase 3 — iterate and grow.** Chat edits with version history, rollback, custom domain, per-app
logs page, static-site fast path.

## 11. Success criteria

| Signal | Where measured |
|---|---|
| Brief → live link, under 15 minutes of the person's time | publish timestamps |
| The mini base shows in the « Base de données » tab at creation | the existing viewer |
| Zero DSH boot failures caused by the bundle | the existing bundle-faults gate |
| Every delivered page passes the five-point UI pass with screenshots read | the build log + `regard.md` |
| Published apps refuse an anonymous visitor when the key is on | the live smoke test |
