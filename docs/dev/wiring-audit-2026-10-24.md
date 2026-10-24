# Plugins ⇄ server wiring audit, and DSH 0.2.1-rc.3 (2026-10-24)

Read-only audit. Baselines: plugins `dev` fe0a6ff6 (262 commits ahead of public `origin/dev`), server `origin/dev` 1142be5
(contract: 242 paths, 314 operations). Measured the same day by anonymous GET on `api.kybernos.app` (prod) and
`kybernos-dev-server.fly.dev` (Fly dev). Four independent passes (plugins→server, server→plugins, delivery state, DSH rc.3);
everything not re-checked in code is marked *not verified*. Evidence lines (`file:line`) are in the long reports, see the end.

## 1. Result in numbers

- Plugin side: 67 features that talk to the server → **37 live**, 9 only on an unmerged server branch/PR, 6 missing on the server
  (3 of them paused by decision or legacy), 11 stub/gated ("soon", "not available on this server"), 4 server-side consumers.
  All 22 strings the first regex pass could not match were resolved; none is a typo.
- Server side: of 314 operations, 79 have a plugin consumer, 140 are used by the server's own pages (71 admin), 20 are webhooks/
  bridges/images, 35 are used by the web app or the phone PWAs, **18 have no caller at all** (3 worth wiring, 4 ignorable, 11 are
  the workspace runner operator API with no page). The plugins build 32 paths by concatenation that a literal grep misses.

## 2. Still to wire

### A. The server is ready on `origin/dev`, the plugin does not use it yet

| # | What | Where in the plugins | Why |
|---|---|---|---|
| 1 | `GET /v1/models` says which models the plan allows (`available`, `min_access_tier`, `recommended`, `provider.acceptance`); the plugin keeps four fields and drops the rest | `kybernos-cloud/index.js:1167` (`modelEntry`), Models picker | A Free user is offered models that answer `403 model_not_in_plan`; an `opt_in` provider answers `403 provider_not_accepted` and nothing in `packages/` knows either code (ADR 0048) |
| 2 | `POST /v1/workspaces/{id}/billing/change` and `409 subscription_exists` | Upgrade dialog, `kybernos-cloud/client.js:2633` | Dialog only calls checkout and portal; the server refuses checkout for a workspace that already pays and says the portal cannot change a plan |
| 3 | `PUT /v1/me/telegram/settings` (`home_target` cloud/ask) | Kaby tile, "Phone and channels" | Built on the server (ADR 0053 §13.4), **no caller anywhere** |
| 4 | Composer "Cloud Computer" environment: `POST /v1/kybers/{id}/threads/dispatch` already accepts `computer_id` (`hosted/routes.ts:68`) | `kybernos-computers/client.js:95` still says "not available from a chat" | `docs/dev/cloud-computer-run-on.md:20-30` is stale in the same way |
| 5 | Kyber public link row says "Soon" but `POST /v1/kybers/{id}/publish` and the public page exist | `kybernos-plugin/client.js:2038,2055,12231` | The plugin comment says "no route" (written before) |
| 6 | Marketplace install is a local file write; `POST /v1/marketplace/{slug}/install` is never called | `kybernos-cloud/index.js:3052-3095` | Installs by DSH are never counted; a DSH team cannot be published |
| 7 | `DELETE /v1/artifacts/{id}` and the `409 artifact_limit/storage_full` it is for; `DELETE /v1/dsh/sessions` | `index.js:2034,2131` | Push can hit the ceiling with no way out; deleted chats keep their title on the server |
| 8 | Plan `features` (`team.lessons`, `remote`, `computers`…) and `access_tier` are never read | `cloud/team-lessons.mjs:29` gates on "plan key starts with `team`" | Fragile: the server gates by feature, the plugin by name |
| 9 | `GET /v1/connections/logo` (sanitised SVG proxy), `connectable`/`not_connectable` (#48) | `connections.mjs:110` drops logos on purpose | Reason for dropping logos no longer holds |

Owner-bound (server ready, needs a product decision first): DSH chats as server threads for multi-device (`/v1/threads`,
`/v1/thread-folders`; today only Kaby's thread), a desktop DSH claiming `target: own` jobs (`/v1/runner/claim`).

### B. The plugin is ready, the server route is missing or unmerged

| What | Plugin | Server state |
|---|---|---|
| Cloud automations: tasks outbox, load, runs, ask-first approvals | `computers-publish.mjs:187-253`, `index.js:5023-5073`, `reporter.mjs:303,311` | Only on pushed branch `origin/feature/computers-page-and-outbox` (7612078, **no PR**) and `local/dev-on-fly`. On `origin/dev` they 404, and `computers-publish.mjs:81` reports that 404 as `no_computer` (plugin bug: use `routeAbsent`); the decided-approvals poll 404s every 2 minutes |
| Kaby on WhatsApp | `cloud/kyby.mjs`, Kyber tab | PR #240 (door, draft) + #241 (bridge, draft, Semgrep red). Every Kyber-tab load makes a 404 call on `origin/dev`. Host half restored only in local dev (a1cba09b); public `origin/dev` deleted four routes (53fe1980) |
| Warm pool of computers | `services/computer-image/claimer.mjs` | PR #242, conflicting; migration must become **0062** with a fresh journal `when` (0059-0061 taken; drizzle silently skips an older `when` on the shared dev DB) |
| Phone link for Free/Plus | `kybernos-mobile/README.md:8` claims Free; `kybernos-multi-device/client.js:75` says "paid" | `remote` is in **no** plan on `origin/dev`; only PR #246 adds it. Prod publishes Free = `connections` only |
| Connections `entitled` | `connections.mjs:60,103` | PR #179 not merged |
| Computer webhook ingress `POST /v1/hooks/{id}` | receiver `kybernos-plugin/index.js:11750` | **Nowhere**: the server mints and displays the URL, nothing serves it (ADR 0052 "phase 2") |
| Kaby pairing on prod | `cloud/kyby.mjs` | `/v1/me/kyby*` and `/v1/me/telegram/pairing\|settings` are on `origin/dev`, absent from `main` and `staging` contracts (prod is main 13e3270) |
| Platform prompt | plugin `feat/platform-prompt` 592fd248 | server `feature/platform-prompt`; unmerged on both sides |
| Public links `/v1/shares`, `/v1/chats` | `index.js:2180-2245` | Paused by decision (ADR 0007/0011); client degrades cleanly |
| Team plugins routes | `docs/dev/plugin-contract.md:622` | Nothing built, as documented |

### C. Built, but not live for a user (delivery gaps)

1. **Plugins:** users get suite 0.1.1 (2026-10-19). 153 commits sit on public `origin/dev` unreleased; 156 more exist only in local
   `dev` and the private `backup`. Not on any remote: `feature/quota-limit-strip` 339cf4fa, the Kaby face PoC, tiktok-scout, ux-audit-2.
2. **Prod server is frozen at main 13e3270** (Railway deploys halted 2026-10-22; current status *not verified*). Prod plans are the
   hand-made v1: Free = `connections`; no `remote`, `computers`, `byok`, `hosted_runs` for Free. Phone link, Telegram/WhatsApp
   answers and cloud computers are unreachable for every public plan. Prod discovery says `connections:false` (no Composio key).
3. **What runs the product (Fly dev) is on no remote:** `local/dev-on-fly` (21 commits), 15 local-only server branches; the server
   repo has no private mirror. Safety net is bundles in `~/kybernos-archive` on the same disk.
4. **Cloud automations cannot run for a user:** image `p19` built, not pushed (needs the owner's Fly token); Fly dev runs `p18`,
   which ignores `pending_tasks`. Never played on real Fly/model.
5. **CI red:** #246 and #247 fail gitleaks (`a-long-secret-value`), #241 fails Semgrep (Dockerfile without `USER`), #242 conflicts.
   Plugins push needs one allowlist entry for the fake key in `packages/kybernos-skills/test-scout.mjs:50`.
6. **Two dev servers share one DB** (Railway dev and Fly dev); which one owns Telegram's webhook is *not verified*.
7. **Fixes in no deployment:** `fix/public-answer-fields` (gateway metadata leaks in OpenAI-compatible answers),
   `fix/referral-hero-light`, `feature/remove-telegram-card`.
8. **Compliance on prod while sign-up is open:** 5 "VERIFY BEFORE PUBLICATION" markers in `/legal/privacy`, no mention of cloud
   computers, prod backups failing since ~10-21 (memory, not re-checked), key rotation half-applied.

### D. Dead or stale (dead-code rider)

- Plugins: `kybernos-plugin/gateway-watcher.mjs` (old-stack bridge; inert without a hand-set `pairingToken` + `gatewayBase`);
  the unused `AN = 'Anthropic · via LiteLLM'` label (`client.js:35885`); the Supabase comment at `client.js:34469`; the "Copy the API
  link" string for `/v1/sessions/{id}/export` (never fetched, no such route); the `503 = no pgvector` branch (`index.js:3264`);
  the embedded widget URLs `app.kybernos.ai/widget.js`, `/embed/<slug>` (no server route, web app *not verified*).
- Server: the embedded `/console` + `/workspace-console` document (`EMBEDDED_PAGE`, `parts/embedded-*`), kept only for the cloud
  image built at tag `v1.0.0-beta.8`; rebuild the image first.
- Stale docs: `docs/dev/cloud-computer-run-on.md:13,20-30`, `docs/dev/computers.md:58-71,108-109`, the three READMEs in section B.

## 3. Decisions that are the owner's

Where beta testers live (frozen Railway prod, feature-complete Fly dev, or prod on Fly) · push plugins `dev` and cut 0.1.2 ·
which server branches become PRs and their merge order (#240 → #241 → the computers-outbox PR; #247 → #248; #246 independent;
#242 last, renumbered) · publish the launch-grid catalogue on prod (owner session + 2FA) and put a model on sale · prod
Telegram bot and a dedicated prod WhatsApp number (Baileys vs Cloud API) · counsel items on the legal pages · Composio on prod ·
multi-device threads and desktop-runner (A, owner-bound) · whether to keep Fly dev running (about USD 10-15 a month).

## 4. DSH 0.2.1-rc.3

npm `next` = rc.3 (2026-10-23); `latest` and the machine = rc.2; our `dsh-compat.json` max is rc.2, so the lifecycle gate refuses rc.3.

**What it adds** (6 commits over rc.2): "More" menus (left sidebar, conversation header, right sidebar) with "Browse other
plugins" and "Create your plugin"; New Session reuses the first blank session again (fixes the unsent-draft loss the machine has had
since alpha.2); DeepSeek API-key route follows `api.deepseek.com/models`; new seams (three `*.actions` list slots,
`pluginNavigation.openList()`, `startSession({whenDraftExists})`). No legacy patch is involved; the pin/hide controls of the design
note were removed before shipping.

**Verdict: integrate rc.3, staged. Waiting does not buy anything**: DSH has never published a non-prerelease (37 npm versions,
all suffixed), and nothing announces rc.4. `master` is a different, later train (1533 commits: native i18n for 6 languages,
liveshare, independent forks) and is no reason to hold rc.3 back; independent forks make rollback unsafe once adopted.

Predicted collisions (read from source, **not seen in a running rc.3**): (A) a native "More" row appears next to our menu and its
"Browse other plugins" reopens the Plugins page we hide, so the owner picks between disabling the `entry-customization` bundle row
in `packages/kybernos-plugin/cordis.patch.yml` and registering our own rows; (D) `kybernos-plugin/client.js:30814` no longer finds
the tab buttons, so "fold chat" can leave the chat on a view with no tab; (G) our "open a chat with pre-filled text" flows overwrite
an unsent draft in a reused blank (use `whenDraftExists:'append'` on rc.3+); (C) mobile drawer and tab CSS (`PICKS`,
`mobile.css:147,174`). Privacy: the new analytics (#6600) are mounted only in the desktop profile, so `dsh web` sends nothing and no
new override is needed; add one sentence to `docs/privacy.md` for the `/models` call.

**Order:** fix D and G (they work on rc.2 too) → owner decides A → free disk (sandbox replay needs about 7 GB; the volume read
2.8-6 GiB free; pruning the four oldest engine trees frees about 3 GB) → widen `dsh-compat.json` (`max`, `testees`, `note`) in the
same PR as the lifecycle evidence → sandbox replay (checklist in the DSH report) → `dsh-lifecycle upgrade 0.2.1-rc.3` (stops every
running session; rollback = `dsh-lifecycle rollback`, rc.2 tree stays on disk).

## 5. Not verified

Whether Railway deploys resumed; the exact code on prod/staging/Railway dev; which dev server holds Telegram's webhook; owner switch
values on any server; whether `FEEDBACK_GITHUB_*` are set; reachability of `help.kybernos.app`, `skills.kybernos.app`,
`app.kybernos.ai`; the web app's behaviour (read from branch `feature/web-rewire`, not production); every UI effect of rc.3.

## 6. Detail

Long reports with `file:line` evidence on both sides, the 314-operation appendix and the chain table of 18 features were written
to `~/kybernos-archive/audit-2026-10-24/` (`A-plugins-to-server.md`, `B-server-to-plugins.md`, `C-delivery-state.md`,
`D-dsh-rc3.md`).
