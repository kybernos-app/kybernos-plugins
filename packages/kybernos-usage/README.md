# `@local/kybernos-usage`

How much your work uses, in two separate columns because the data comes from two separate places:

- **Your Kybernos plan.** The server counts it, as a percentage of rolling windows (for example 5 hours and 30 days), and never shows money. This plugin only displays what `/kybernos-cloud/quota` and `/kybernos-cloud/status`
  already return. It recomputes nothing. The per-model, per-day and per-member detail of the plan stays in the console
  (`/v1/workspaces/:id/llm/usage`), it is not redone here.
- **Your own keys and local models.** They never pass through the server, so only this computer can count them. Tokens come
  from the session projection `tokenUsage` (uncached input, output, cache read, cache write), are booked by the host and
  priced when drawn with the models.dev index kept by `@local/kybernos-models`.

## What the user sees

- **A chip in the composer dock** (slot `conversation.composer.dock`, id `kybernos-usage-chip`): the busiest plan window in
  percent while the chat runs on a Kybernos model; the session's cost in dollars on a key of one's own; "free" on a local or free
  offer; "price unknown" when the model has no price in the catalogue. On a Kybernos model the chip carries a ring that fills
  with the busiest window: amber from 75 %, red once calls are turned away. On a key of one's own it is amber when the month's
  budget is exceeded. It shows nothing when it has nothing to say.
- **A limit strip under the pills** (same slot, id `kybernos-usage-limit`, last in the row, a line of its own while it shows).
  Only on a Kybernos model, and only when the plan's busiest window is close or used up. From 75 %: one line ("75 % of your 5 h
  window is used. Plus gives you 20 times more.") with a "See the plans" button and a cross; the cross hides it until that window
  has gone back under 75 % (kept in this browser). Used up: a panel that says which window and when it opens again, the next
  level with its price per month and how many times more it allows (read from the plans the account page sells, never written
  here), a way to a key of one's own or a free model (Settings › AI provider and models), and the four windows with their return
  time. A member of a team gets the same facts and is told to ask an admin. At the end of a turn it asks the footer's meter to
  read again (`kybernos-cloud:quota-read`), so neither lags behind the call. No credits wording: whether top-ups lift the short
  windows is the owner's decision (SRV-B1), the strip does not say.
- **Its card** (click): context window (the `contextPressure` projection, the same one as the engine's own ring), the plan's
  limits, and for an own key the session's cost split into new input, cache read and output.
- **Settings › Usage** (slot `settings.section`, id `kybernos-usage`): the plan card, then your own keys by period (today, 7 or
  30 days): cost, tokens, cache share and what the cache saved, cost per day, and where it goes by model or by session. A monthly
  budget (folded, off by default) turns the chip amber and shows a banner; it warns, it never blocks.

## Honest limits

- History starts the first time a session is seen. What a session had already used at that moment is kept apart ("before the
  first measure") and is never put on a day.
- A model's tokens are attributed to the model in use when they were observed. A session that switches model mid-way is split
  correctly from then on, not before.
- Prices are the models.dev ones. A model without a price counts its tokens but not money, and says so; the user's own price
  overrides in Models are not read yet.
- Windows are rolling: the server gives a time to free up only once a window is used up, so there is no permanent countdown.
- The strip cannot change the composer's placeholder (no seam): the "used up" text lives in the panel under the pills.
- "Use my own key or a free model" lands on one page for both: DSH has no seam that picks a model from another bundle.
- The page cannot open itself from the chip yet (no seam to open a Settings section), so the card says where to find it.

## Host routes

Under `/kybernos-usage/`, served before DSH's own authentication, so each one fences the origin.

| Route | Does |
| --- | --- |
| `GET summary?days=N` | the ledger in tokens: days (oldest first), totals by model, sessions, what was used before the first measure, the budget |
| `POST observe` | `{ sessionId, provider, model, title?, usage }`: cumulative counters of one session; the host books the delta |
| `POST budget` | `{ usd: number or null, alert: boolean }` |

`observe` and `budget` need an `Origin` or `Referer` that is the page's own; `summary` refuses a foreign one and tolerates none.

## Files

`$DSH_HOME/kybernos/usage/ledger.json` (`0600`): days, models, sessions, the budget. Tokens and session titles only, never
money, never a key. At most 120 days and 300 sessions are kept.

## Tests

```bash
cd packages/kybernos-usage && node test-ledger.mjs && node test-host.mjs && node test-client.mjs
```

No engine patch. Slots used: `conversation.composer.dock`, `settings.section`.
