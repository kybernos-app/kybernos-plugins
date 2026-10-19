# Kaby on WhatsApp: study (2026-10-19)

Status: study only, nothing built. Owner decisions in § 7. The Render project was inspected read-only (§ 6).

## 1. Short answer

- **Use the official WhatsApp Cloud API with one shared Kybernos number, as a second adapter of the channel door that Telegram already built** (kybernos-server `src/modules/channels/`, ADR 0053). It is a stateless webhook, so it runs on the server we already host (Railway) and needs no always-on socket.
- **Do not host Baileys (the Platon approach) for users.** It breaks WhatsApp's consumer terms, it makes the server hold the full account credentials of each person, and the ban lands on the person's own number.
- **The blocker is Meta's policy, not the code**: general-purpose assistants are refused on the Business Platform (§ 3). Ship it *bounded* first (what ADR 0053 decision 1 already says), behind a kill switch, and let the owner decide about open conversation (§ 7).
- The Render project was meant for the Baileys option. With the Cloud API it is not needed.

## 2. What exists today

| Piece | State |
|---|---|
| Server door (`channels/`, ADR 0053, bot `@kybernos_bot`) | Merged and on dev: sign-up through the bot, hosted turn per message, outbox + `channel-deliver` job, approvals as 3 buttons, computer turns. |
| Kaby pairing (QR / `/start pair_<token>`, computer choice) | kybernos-server#230, **still open** (branch `feature/kyby-pairing`). |
| Kaby strip in DSH (`kybernos-kyber`) | Telegram has a switch; WhatsApp and WeChat are « Soon » chips (`soon('whatsapp', …)` in `client.js`). Turning WhatsApp on is a small client change once the server answers. |
| Channel port | **Specified (ADR 0053 § 13.1: `parse`, `send`, `capabilities`), not extracted.** `service.ts` is 1,013 lines with 28 Telegram references and takes a `TelegramClient` directly; `channel_identities` has `check (channel in ('telegram'))`; the switch is `telegram_enabled`. WhatsApp is the forcing function for the extraction. |
| `packages/messaging` (this repo) | Local DSH ↔ Telegram bridge, outbound long polling, adapter contract (`channels/CONTRACT.md`) that already names WhatsApp as a possible adapter. A different door: it talks to the local DSH, not to Kaby's server thread. |
| Platon (`~/dyad-apps/platon`) | Baileys 7 rc13 server (`server/utils/whatsapp-manager.ts`, 104 KB): QR pairing, auth state encrypted in Supabase, LID/PN reply fix, 3 Render services declared in `render.yaml`. |

What Platon's history says about hosting Baileys centrally (plan files in `.dyad/plans`): session restore crashed on Buffers rebuilt from JSONB (chat 1241), the Render service ran the wrong container (1254), a shared secret set on one side only (1221), 150 s idle timeout on long agent turns (1192), and on Render's free plan the sleep drops every socket (1790). Each one is an operations cost the Cloud API does not have.

## 3. WhatsApp facts that decide the design

Verified against a primary source unless marked.

1. **Policy.** Since 2026-01-15 the Business Solution Terms refuse AI providers whose assistant is the *primary* functionality (a support bot for a business is fine). Meta's own terms page did not render for me: the wording comes from several secondary sources and the owner's earlier reading in ADR 0053. *Read the clause itself before relying on it.*
2. **EU order.** The Commission's interim measures of 2026-06-09 oblige Meta to give third-party general-purpose assistants access again, free, on the pre-October-2025 terms, in the EEA. Reported in force since 2026-07-13; Meta appealed (August) and the appeal does not suspend it (secondary sources: Tech Times, Slaughter and May). One guide says the clause itself also exempts numbers registered in the EEA or Brazil: *unverified*. It is an interim order: do not build a business on it.
3. **Pricing** (Meta's pricing page): billed per delivered message; user-initiated messages are free; every business number has a free tier of 1,000 service messages a month; from 2026-10-01 service messages beyond the tier and utility templates inside the window are charged, with a payment method required by 2026-09-30. The page says those changes **do not apply to AI Providers**, which have their own pricing policy (effective 2026-02-16, updated 2026-05-12): **I could not fetch that policy**, so the cost per Kaby user is unknown until someone reads it.
4. **24-hour window.** Outside it only approved templates can be sent. Kaby can answer and ask for approvals inside the window; a reminder or an automation result that comes later needs a utility template (or goes to Telegram / DSH instead).
5. **Identity.** The sender is a phone number: personal data. Since spring 2026 webhooks also carry a business-scoped user id (BSUID), and for people who adopt a username the phone number may be absent. The identity key must be the BSUID with the number optional (Meta's docs and four vendor guides agree).
6. **Message features** (mostly vendor guides, not Meta's page): up to 3 reply buttons, titles 20 characters, interactive body 1,024; plain text 4,096; reactions; a typing indicator tied to marking the message as read, dropped after 25 s. Formatting is WhatsApp's own (`*bold*`), not Telegram's HTML.
7. **Unofficial clients** (WhatsApp consumer terms, read): no reverse engineering, no automated or bulk messaging, no non-personal use without authorisation, accounts may be suspended. Baileys does all four.

## 4. Options

| | A. Cloud API, shared number | B. A provider (Twilio, 360dialog…) | C. Baileys hosted (Platon, Render) | D. Baileys local, in DSH |
|---|---|---|---|---|
| Meta policy | Applies in full (§ 3.1-3.2) | Same policy, plus a margin | Not on the Business Platform, so the AI clause does not apply; consumer terms broken | Same as C |
| Who bears the ban risk | Kybernos's one number: a sanction cuts every WhatsApp user at once | Same | **Each user's own number** | The user's own number (opt-in) |
| Data | Phone number or BSUID | Same + provider | Server holds device keys able to read **all** of a person's chats; contradicts ADR 0053's « weak credential by construction » | Keys stay on the person's computer |
| Hosting | Webhook on the existing server | Same | Persistent socket per user, always-on (Render Starter and up) | None |
| Fit with Kaby | Same thread, same hosted turn, approvals as buttons | Same | Same, with the risks above | Talks to the local DSH, not to Kaby's server thread |
| Verdict | **Recommended** | Only if Meta onboarding is too heavy | **No** | Optional later, « experimental », a self-chat only |

## 5. Recommended path (A)

1. **Owner decisions first** (§ 7): what Kaby may do on WhatsApp, and the Meta onboarding.
2. **Extract the port**, after #230 merges so the two do not collide: an adapter type with `parse`, `send`, `capabilities` (`max_length`, `buttons`, `typing`, `proactive: within_window`, `identity: bsuid|phone`), `channels_enabled` plus one switch per channel, a migration that widens the `channel` check, Telegram moved behind the port with its tests unchanged. Touches the schema registries listed in the handoff (retention, account data, datalife, tenant world).
3. **WhatsApp adapter**:
   - webhook `GET` (verification challenge) and `POST` with `X-Hub-Signature-256` checked in constant time **before the body is parsed** (same discipline as Telegram's secret header); 404 when off;
   - turn id from the message id (`whatsapp_<wamid>`) for deduplication; answers through the existing outbox;
   - pairing by the deep link `https://wa.me/<number>?text=pair_<token>`, the same semantics as `/start pair_<token>`; the DSH QR already encodes a URL;
   - the consent offer and the approvals as reply buttons (the Allow / Refuse / Allow-for-this-task trio fits the 3-button limit; labels must be ≤ 20 characters);
   - formatting variant of `format.ts` for WhatsApp; 👀 reaction; typing indicator renewed under 25 s;
   - the 24-hour window tracked per identity: no template sending in the first version (answers only, as Telegram T1).
4. **Bounded mode**: outside an allowed list the door only handles Kaby's own tasks (automations, approvals, notices, the person's computer), not an open Q&A. The mode is data (a setting), so the owner can change it without a deploy.
5. **Tests**: a fake Graph API next to `scripts/lib/telegram-fake.ts`, and a `whatsapp-live.ts` in the style of `telegram-live.ts`. No real WhatsApp number needed for the code; a real number is needed for the end-to-end check.
6. **Client**: the WhatsApp chip becomes a switch like Telegram's (server lists the channel in `GET /v1/me/kyby`).

Rough size: the port extraction is the larger part (the service is shared code); the adapter itself is about Telegram's `telegram.ts` (249 lines) plus routes, sentences and tests. No estimate in days: the Meta onboarding is the long lead time and is not ours to speed up.

## 6. The Render project

- What the repo says it is: `render.yaml` in Platon declares `nitro-dev` and `nitro-staging` (free plan, sleep after 15 min) and `nitro-prod` (Starter, always on), all built from `Dockerfile.nitro`, serving only the Baileys API (`/api/whatsapp/*`, `/health`) against 3 Supabase branches. Secrets are listed by name only (`WHATSAPP_SHARED_SECRET`, `WHATSAPP_AUTH_STATE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, …).
- **Inspected 2026-10-19, read-only** (Render API, GET only, key read from the clipboard and never printed; no variable value, no phone number read). The project `prj-d8a6r5e7r5hc73e54c20` is named **Platon** (created 2026-05-25, workspace « Platon Workspace », Frankfurt). It is **not** the three `nitro-*` services of `render.yaml` (chat 1790 was never applied on Render): it has two services, both built from the old *unified* `Dockerfile` (Nginx + Nitro + Temporal worker).

  | Service | Env | Plan | Branch | Last deploy | State |
  |---|---|---|---|---|---|
  | `platon` (`platon-hc3e.onrender.com`) | Production | Starter (always on, about 7 USD a month at Render's list price; invoices not readable through the API) | `main` | 2026-07-03, live | Running: `/health` 200; `/api/whatsapp/health` 401 (the Nitro API answers and wants the shared secret) |
  | `platon-staging` | staging | Free | `staging` | 2026-07-11, live | `/health` did not answer within 70 s (free plan asleep, or broken: not retried) |

- **WhatsApp on that project looks unused.** In the last 7 days of production logs the only line mentioning WhatsApp is my own health probe. No session restore, no message. The service does keep a Temporal worker running that has failed every heartbeat with a DNS error (`record_worker_heartbeat`, Unavailable) for at least a day: noise the repo itself calls deprecated. Variable *names* on production: `TEMPORAL_*` (4), `VITE_NITRO_URL`, `WHATSAPP_SHARED_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NITRO_FRONTEND_ORIGIN`; there is no `WHATSAPP_AUTH_STATE_KEY`, so the auth-state encryption key falls back to the shared secret (documented fallback in `whatsapp-manager.ts`). Staging has the four WhatsApp/Supabase names only.
- **Production service suspended on 2026-10-19 at the owner's request** (`POST /v1/services/<id>/suspend`, answered 202, then read back: `suspended`, by `user`; its public `/health` now answers 503). Reason: no real request in the last 7 days (no agent page, manifest, PDF, chat or WhatsApp call; only my own probes). Nothing deleted, the Starter plan and the variables are kept: **Resume** in the dashboard (or `POST /v1/services/<id>/resume`) brings it back as it was. A suspended service is not billed for compute. Staging (Free) was left alone: it costs nothing. If Platon's Vercel middleware still rewrites crawler and manifest requests to that URL, link previews of agent pages will fail until it is resumed.
- **For Kaby it has no role** (option A is a webhook on the server we already host; option C is dropped). Nothing there was changed. **Do not reuse its `WHATSAPP_SHARED_SECRET`** (plan file `chat-1221` in the untracked `.dyad/` folder of Platon holds a value in clear; the repository is private and the file is not tracked, so low severity, but rotate it if Platon keeps WhatsApp). The pasted Render key is a full-access key: revoke it in Render (Account settings, API keys) when this check is over.

## 7. Decisions that are the owner's

1. **Scope on WhatsApp**: bounded only (recommended), or open conversation for numbers where the EEA order applies, knowing it is interim and under appeal.
2. **Go for Meta onboarding**: a verified business portfolio for DIGI TECHNOLOGIES, a dedicated number never used on WhatsApp, a WABA and a display name, a payment method, a system-user token and the app secret. Long lead time, so it should start before the code.
3. **Sequence**: port extraction after #230 merges (recommended), or on its own branch now.
4. **Baileys**: confirm that hosted Baileys is dropped, and whether option D (local, opt-in, experimental) is wanted at all.

## 8. Not verified

Meta's own text of the AI clause and of the AI Providers pricing policy; the exact EEA / Brazil exemption; the numeric limits of § 3.6 against Meta's reference pages; the monthly Render invoice and the staging service's real health; whether a verified business can obtain a number from the existing company line. Sources: Meta's pricing page and Meta's `business-scoped-user-ids` page (developers.facebook.com), WhatsApp consumer terms (whatsapp.com/legal/terms-of-service), and the secondary articles named above.
