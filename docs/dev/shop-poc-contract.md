# The trial shop: what Kaby and the Telegram Mini App share

Status: **trial, 2026-11-05**. A walking skeleton of the « shop in the chat » (cadrage: `docs/etudes/2026-11-05-shop-in-chat-central-core.md`). It is deployed on the dev server only
(`kybernos-dev-server` on Fly), in the server repository's branch `feature/shop-poc`, not merged. This page is what the server (module `shoppoc`) and the plugin
(`kybernos-cloud`, tools `shop_list` and `shop_stock`) are both built against.

## What it is

- One shop per **Kaby account**, three seeded products (id, name, price, stock), held **in the server's memory** (lost at each restart). No money, no storefront, no table.
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

## The plugin's tools (`packages/kybernos-cloud/shop-stock.mjs`)

- `shop_list` — reads the shop. Passes the turn's gate without a question (it changes nothing).
- `shop_stock` `{ product, set | delta }` — changes one stock. **Asked** like any change in a turn (`TURN_GATE_SAFE_TOOLS` does not list it): the person reads « Set the stock of
  colombie to 7 » and taps. Moving it to the no-question list is a decision for the owner (the gate's audit of 2026-10-20 lists reads only).
- Only a cloud computer inside a turn can call them; anywhere else they answer in one line that the shop is reached from Kaby's chat on the phone, and send nothing.
- Everything the server says (product names) is data: flattened to one bounded line, no markup (`dataLine`).

## Tests

- Server: `test/shoppoc.test.ts` (initData, the link to an account, the Mini App routes, both Kaby routes with a stubbed turn owner, isolation between people).
- Plugin: `node packages/kybernos-cloud/test-shop-stock.mjs` (the tools, what they refuse before the network, what the server's answers mean, markup in names) and, in
  `test-cloud-host.mjs`, the gate (read passes, change is asked in plain words) and the calls through the host with the computer's token and the turn.
- Not covered by an automated test: a real model choosing the tool (it needs the cloud computer image to carry this plugin version), and the Mini App in a real Telegram client
  (done by hand on 2026-11-05 on the owner's phone and in Telegram Web).

## What it does not do yet

No persistence across restarts, no per-shop table, no products other than the three, no WhatsApp surface, no line from the Mini App in Kaby's own thread (so Kaby learns of a change
made in the Mini App by calling `shop_list`, not by reading the conversation).
