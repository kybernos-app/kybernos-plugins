# `@local/kybernos-usage`

How much your work uses, in two separate columns because the data comes from two separate places:

- **Your Kybernos plan.** The server counts it, as a percentage of rolling windows (for example 5 hours and 30 days) plus a
  credit balance, and never shows money. This plugin only displays what `/kybernos-cloud/quota` and `/kybernos-cloud/status`
  already return. It recomputes nothing. The per-model, per-day and per-member detail of the plan stays in the console
  (`/v1/workspaces/:id/llm/usage`), it is not redone here.
- **Your own keys and local models.** They never pass through the server, so only this computer can count them. Tokens come
  from the session projection `tokenUsage` (uncached input, output, cache read, cache write), are booked by the host and
  priced when drawn with the models.dev index kept by `@local/kybernos-models`.

## What the user sees

- **A chip in the composer dock** (slot `conversation.composer.dock`, id `kybernos-usage-chip`): the busiest plan window in
  percent while the chat runs on a Kybernos model; the session's cost in dollars on a key of one's own; "free" on a local or free
  offer; "price unknown" when the model has no price in the catalogue. Amber from 80 %, red at 100 %, amber when the month's
  budget is exceeded. It shows nothing when it has nothing to say.
- **Its card** (click): context window (the `contextPressure` projection, the same one as the engine's own ring), the plan's
  limits and credits, and for an own key the session's cost split into new input, cache read and output.
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
