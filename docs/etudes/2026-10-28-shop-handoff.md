# Handoff — Webapp Creator / boutique (session 2026-10-28)

Everything below is verified in this session; nothing is aspirational except where marked.

## 1. Where we are

The shop machinery works end to end: brief → `shop.json` → themed storefront → products in a mini
base → cart → a REAL order that reserves stock → payment webhook (idempotent) → exactly one
confirmation email. Three cold runs of three different shops measured the machine chain at
**1.288 s / 1.300 s** against a 4:15 budget. What it is NOT yet: a professional, hosted, legal shop
— that gap is section 3.

## 2. The artefacts

- **Worktree (use this one)**: `/Users/miled/kybernos-projects/kybernos-plugins-webapp`, branch
  `feature/webapp-creator-templates`. The shared tree is for other campaigns — write here.
- **Commits on the branch**: `bb78c69e` stack catalog · `be0e835a` web template CRUD (obj 1) ·
  `e93b6f2c` commerce preset (obj 2) · `d8fd6537` transactional core · `5ac912f4` theme base
  layouts · `2ea84cb9` storefront + shop.json · `da73436f` media chain + emails · `c0aba785`
  cloud core (artifact, secret scan, restore drill) · `93582b01` shop-* skills.
  The POC commit `fae2f08b` + `9a9bed3a` are already on `dev`; the nine above are NOT merged.
- **Plugin bundle**: `packages/kybernos-webapp-creator/` (host routes with signed-session guards,
  runtime, templates statique/web/commerce, 6 shipped skills, 5 test suites ~60 checks green).
- **Skills**: shipped in the bundle AND seeded into `~/.dsh/skills` (active in the chat catalog):
  `webapp-brief/build/publish`, `shop-brief/setup/live`.
- **Docs**: `docs/etudes/2026-10-27-webapp-creator-cadrage.md` (the framing + decisions §12),
  `docs/etudes/2026-10-27-plan-boutique-5min.md` (the plan, adversarially reviewed 3× by Kimi
  K3.1 Pro), theme kit sources in `docs/handoff/boutique-themes/` (2 layouts + palette proof).
- **Demos (still running, nohup)**: :4400 notes webapp · :4401 Atelier Café · :4402 Atelier Papier.
  Stop them: `lsof -ti tcp:4400 -ti tcp:4401 -ti tcp:4402 | xargs kill`.

## 3. The gap to a professional shop (and the 3 steps)

| Now (proven) | A professional shop needs |
|---|---|
| simulated payment via webhook | **real Stripe**: Checkout, signed webhooks, refunds |
| local (ports 44xx) | **hosted**: Fly machine + domain + TLS + always up |
| demo products | real photos, real catalogue, real stock |
| email logged to a file | **Resend** + SPF/DKIM |
| dry order-form rejection | polished cart UX (validation, guidance) |
| no legal pages | **CGV, legal notice, VAT, invoice, withdrawal, RGPD** (FR law) |
| no back office | orders management: shipping, tracking, returns |
| localhost | SEO, performance, a real domain |

1. **Hosted and functional** — needs the owner's **Fly.io token** + **Stripe test keys**: real
   Stripe wired, Fly deploy, `*.kaby.app` serving the shop. Hours, not weeks.
2. **Professional** — FR legal layer, Resend emails, orders back office, cart UX. Days.
3. **The real test** — one shop with real products and photos (gobelets.com or a pilot store).
   Honest note: a client who needs a shop TOMORROW should use Shopify (€39/mo) and migrate later.

## 4. NEXT ITERATION — its own page + a settings page (owner request)

**The page « Webapps »** (right-sidebar pane, mockup validated in
`docs/handoff/webapp-creator/maquette-v1/`): the projects list (name, slug link, state dot,
per-shop counts), Start/Stop, Open, deploy status + the chrono, the theme gallery picker with
live previews, empty state. Build chain: `maquette-dsh` discipline first (fidelity declared,
captures READ), then `client.js` (guarded factory, `ui.slot:sidebar.right.pane.tab`), then the
five-point UI pass.

**The Settings page** (needs its own mockup first): deploy target (exposed computer / Fly / the
person's Cloud Computer) · **Fly token** · **Stripe keys** (secret side, never in files) · email
provider (Resend key) · domain (`kaby.app`) · default sector palette · link-key policy per shop ·
quotas (media size, product count). Settings live in `~/.dsh/kybernos/settings.json` through the
host's filtered keys — a new key needs BOTH sides (host `ecrireReglages`/`lireReglages` + client),
or the client shows « The host did not take this setting ».

Also queued: merge/push of the branch (owner word), the cart form papercut (guide to the empty
fields instead of a dry refusal), and the foundation batch (Hono + Better-Auth + link key) before
ANY public deploy — admin routes are OPEN in POC mode.

## 5. Workshop rules learned this session

- Design work goes to `subagent_claude_code` — but it cannot write outside the shared repo; give it
  paths under `kybernos-plugins`, then rsync into the worktree.
- Headless Chrome follows the SYSTEM appearance and ignores `--force-prefers-color-scheme`: force
  `data-theme` in a copy of the page, and diff the hashes to prove the themes differ.
- Micro-chantiers (< 15 commands) stay in the main thread; delegations are for big autonomous lots.
- Never `git commit --amend` in the shared tree without checking `git branch --show-current` first.
