# The trial shop: what Kaby and the Telegram Mini App share

Status: **trial, 2026-11-05**. A walking skeleton of the « shop in the chat » (cadrage: `docs/etudes/2026-11-05-shop-in-chat-central-core.md`). It is deployed on the dev server only
(`kybernos-dev-server` on Fly), in the server repository's branch `feature/shop-poc`, not merged. This page is what the server (module `shoppoc`) and the plugin
(`kybernos-cloud`, tools `shop_list`, `shop_stock`, `shop_define` and `shop_connect`) are both built against.

## What it is

- One shop per **Kaby account**, held **in the server's memory** (lost at each restart; no table). It starts as a demo of three products; the first `shop_define` replaces them with the
  person's own (id, name, price, cost, stock), names the shop and gives it a public address `<server>/shop/<name>-<4 hex>`. Money goes through **Stripe, test mode only**
  (a live key is never used): a Standard connected account for the merchant, a direct charge on it.
- Two doors on the same shop:
  - the **Telegram Mini App** (`GET /poc/shop`, opened by a `web_app` button of the shared bot). The person is the one Telegram's signed `initData` names (HMAC-SHA256 with the bot
    token, at most one hour old) **and** whose Telegram is linked to a Kaby account (`product.channel_identities`); a chat that is not linked gets `403 not_linked`. A stock change
    made there makes the bot write one line in the person's Telegram chat.
  - **Kaby** (a cloud computer inside one of its turns), through two routes below. What Kaby sets is what the Mini App shows at once, and the other way round.
- It exists only where the Telegram door is configured (`404 not_found` elsewhere).

## The server's routes for Kaby (a cloud computer's own token, like `POST /v1/computer/sites`)

Both are `POST`, carry `job_id` (a turn addressed to THIS computer and still running: the server checks it with `turnOwner`, so a turn that ended, another computer's turn or a
session token are all refused), and act for the person the turn runs for. 60 calls a minute per person.

`POST /v1/computer/shop` `{ "job_id": "<uuid>" }` → `200 { "products": [ { "id", "name", "price", "stock" } ] }`

`POST /v1/computer/shop/stock`

```json
{ "job_id": "<uuid>", "product": "colombie", "set": 7 }
```

- `product`: the id (`eth`, `col`, `mil`) or a part of the name, accents and capitals ignored. `set` (0 to 100000) or `delta` (a whole number, negative to remove): exactly one,
  else `400 invalid_change`. The stock never leaves 0 to 100000.
- `200 { "products": [...], "changed": { "name", "before", "after" } }`.
- If several products fit: `200 { "products": [...], "several": ["name", ...] }` and **nothing changes**: Kaby asks which one.
- No such product: `404 not_found`. Not a cloud computer's token: `403 computer_token_required`. Not this computer's turn, or over: `404 not_found`. A minute spent: `429 rate_limited`.

`POST /v1/computer/shop/define`

```json
{ "job_id": "<uuid>", "name": "Atelier Café", "tagline": "Torréfié à Lyon",
  "products": [ { "name": "Colombie Huila 250 g", "price_eur": 15.9, "cost_eur": 8, "stock": 12 } ] }
```

- At least one of `name`, `tagline`, `products` (else `400 nothing_to_define`); the first time `name` is needed (`400 name_required`). A price is 0.50 to 100000 euros (Stripe's
  minimum), a cost 0 to 100000, at most 50 products in a shop (`409 shop_full`). A product whose name the shop already has (accents and capitals ignored) is updated, not doubled.
- `200 { products: [{ id, name, price, stock, cost, margin_pct }], shop: { name, tagline, url, connected, payable }, added: [...], updated: [...] }`. The cost and margin are for Kaby
  and the merchant only. Every other Kaby route answers with the same `products` and `shop`.

`POST /v1/computer/shop/connect` `{ "job_id": "<uuid>" }`

- Needs a defined shop (`409 shop_not_defined`) and a server with Stripe in test mode (`409 payments_off`). Makes the shop's connected account once, then answers
  `200 { …, url }`: the single-use link where the merchant gives their details at Stripe (Kaby hands it to the person in the chat). When a card can already be charged, no `url`
  and `shop.payable` is true. Stripe's refusal: `502 payments_unavailable` with Stripe's own sentence.

### What a client sees (public, no sign-in)

- `GET /shop/<name>`: one page for every shop. `GET /v1/shops/<name>`: name, line, `payable`, products with their price and `available` (never a cost or a stock number).
- `POST /v1/shops/<name>/checkout` `{ product, quantity 1-10 }`: opens Stripe's own payment page for one product, a direct charge on the merchant's account. `409 payments_not_ready`
  until the merchant has finished at Stripe, `409 sold_out`. The client types the card on Stripe's page; this server and Kaby never see it.
- `GET /v1/shops/<name>/orders/<session>`: the client's return from Stripe. Only a session THIS shop started is asked about at Stripe; the first time it is paid, the stock goes down
  by what was bought and the merchant's Telegram chat gets one line. Counted once. (A webhook is the real way, and is not built: nothing is counted if the client never comes back.)
- Each shop has its own minute (120 reads, 20 checkouts). Page headers: `frame-ancestors 'none'`, no cookies.

## The plugin's tools (`packages/kybernos-cloud/shop-stock.mjs`)

- `shop_list` — reads the shop. Passes the turn's gate without a question (it changes nothing).
- `shop_stock` `{ product, set | delta }` — changes one stock. **Asked** like any change in a turn (`TURN_GATE_SAFE_TOOLS` does not list it): the person reads « Set the stock of
  colombie to 7 » and taps. Moving it to the no-question list is a decision for the owner (the gate's audit of 2026-10-20 lists reads only).
- `shop_define` `{ name?, tagline?, products? }` — one call for the whole shop, so ONE question (« Set up the shop "Atelier Café": Colombie 15.9 €, … »). Kaby proposes a price
  from the costs in its own answer first and waits for the person's yes: the tool description says so, and nothing in the server computes a price.
- `shop_connect` — asked (« Ask Stripe for the link… »); gives Kaby the single-use link to hand over. The turn's gate allows three questions a task: define, connect and a stock
  change fit.
- Only a cloud computer inside a turn can call them; anywhere else they answer in one line that the shop is reached from Kaby's chat on the phone, and send nothing.
- Everything the server says (product names) is data: flattened to one bounded line, no markup (`dataLine`).

## Tests

- Server: `test/shoppoc.test.ts` (initData, the link to an account, the Mini App routes, both Kaby routes with a stubbed turn owner, isolation between people).
- Plugin: `node packages/kybernos-cloud/test-shop-stock.mjs` (the tools, what they refuse before the network, what the server's answers mean, markup in names) and, in
  `test-cloud-host.mjs`, the gate (read passes, change is asked in plain words) and the calls through the host with the computer's token and the turn.
- Not covered by an automated test: a real model choosing the tool (it needs the cloud computer image to carry this plugin version), and the Mini App in a real Telegram client
  (done by hand on 2026-11-05 on the owner's phone and in Telegram Web).

## What it does not do yet

No persistence across restarts (a restart or a deploy empties every shop and forgets the Stripe account it had made), no per-shop table, no WhatsApp surface, no line from the Mini App in
Kaby's own thread (so Kaby learns of a change made in the Mini App by calling `shop_list`, not by reading the conversation), **no photos** (the Telegram door ignores them and no image
route exists), no Stripe webhook (a payment is counted when the client comes back to the window), no refund, no shipping, no tax, no application fee, a window in French only.
