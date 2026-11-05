# The trial shop: what Kaby and the Telegram Mini App share

Status: **trial, 2026-11-05**. A walking skeleton of the « shop in the chat » (cadrage: `docs/etudes/2026-11-05-shop-in-chat-central-core.md`). It is deployed on the dev server only
(`kybernos-dev-server` on Fly), in the server repository's branch `feature/shop-poc`, not merged. This page is what the server (module `shoppoc`) and the plugin
(`kybernos-cloud`, tools `shop_list`, `shop_stock`, `shop_define` and `shop_connect`) are both built against.

## What it is

- One shop per **Kaby account**, held **in the server's memory** (lost at each restart; no table). It starts as a demo of three products; the first `shop_define` replaces them with the
  person's own (id, name, price, cost, stock), names the shop and gives it a public address: `https://<name>-<4 hex>.kaby.app` once that address is open (see « The window's own address »), `<server>/shop/<name>-<4 hex>` until then and whenever it cannot be opened. Money goes through **Stripe, test mode only**
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

`POST /v1/computer/shop/connect` `{ "job_id": "<uuid>", "test_account"?: true }`

- Needs a defined shop (`409 shop_not_defined`) and a server with Stripe in test mode (`409 payments_off`). Makes the shop's connected account once, then answers
  `200 { …, url }`: the single-use link where the merchant gives their details at Stripe (Kaby hands it to the person in the chat). When a card can already be charged, no `url`
  and `shop.payable` is true. Stripe's refusal: `502 payments_unavailable` with Stripe's own sentence.
- `test_account: true` (the person asked for a Stripe TEST account made for them, with no page to fill in; the tool `shop_connect` has the same optional argument): the server makes a **Custom**
  connected account from Stripe's published test data (a test person born 1901-01-01, the address that matches in full, the test identity document, a test IBAN, the always-reachable test URL;
  nothing of a real person goes in) and answers with no `url`; `shop.payable` turns true once Stripe has switched `charges_enabled` on (seconds), so Kaby may have to look again with `shop_list`.
  It is made once per shop (asking again makes no second one) and replaces an account that was only started with the link. Only where the server's Stripe key is a TEST key: it cannot run on live money.
  Direct charges work the same on that account. Server test: `test/shoppoc-stripe.test.ts` (the form sent to Stripe), `test/shoppoc-storefront.test.ts` (the route).

### Photos (the person sends them in the chat, Kaby retouches them)

- **The door.** A private photo sent by a person who has a Kaby account (a stranger costs nothing: ignored) is downloaded by the Telegram door (2 MB at most; 10 a minute per person)
  and kept two hours in that person's inbox under a short name, `ph1`, `ph2`, … (6 at most; the oldest goes). Their Kaby is then told, as the person's own message,
  `[The person sent a photo: ph1] <caption>` (or `[The person sent a photo that could not be kept: …]`), so the normal turn applies: consent, pause, limits, the hosted computer.
  `shop_list` names the photos no product has taken yet (`shop.photos_waiting`).
- `POST /v1/computer/shop/photo/raw` `{ job_id, photo: "ph1" }` → `200 { photo, bytes, jpeg_base64 }`; `404 not_found` when the photo is gone (two hours) or the turn is not this computer's.
- `POST /v1/computer/shop/photo/put` `{ job_id, product, jpeg_base64 }` → `200 { products, shop, photo: { product, bytes, width, height } }`, or `200 … several: [names]` with nothing changed when the
  product fits several. The server checks the bytes itself (a JPEG, 100 to 4096 px, 250 KB at most: `400 not_a_photo` / `photo_too_big`) and the shop holds 2.5 MB of photos, the server 64 MB
  (`409 photos_full`). A new photo replaces the product's old one (its `photo` version changes, so the window reloads it).
- **Public**: `GET /v1/shops/<name>/photo/<product>` (the JPEG, `cache` by version, `nosniff`); the window's product list carries `photo` (the version or `null`). The picture answers `cross-origin-resource-policy: cross-origin` (the window at `<name>.kaby.app` shows it from another origin); the page served by the server allows `img-src 'self'` only.

### The window's own address (`<name>-<4 hex>.kaby.app`)

- **One static page for every shop**, put online once as the Vercel project `kaby-site-kb-shops` (the `kb-` prefix is reserved, so no person's page can meet it), and **one address attached per shop** (the same `attachDomain` the sites module uses; DNS and the certificate are the wildcard `*.kaby.app` that already points to Vercel). No project and no deployment per shop, and nothing a person wrote is ever put there.
- The page is the server's own page: it reads the shop from the first label of its address and calls the server (`/v1/shops/<name>`, `/checkout`, `/photo/<product>`). Its CSP (a `vercel.json` header) lets it call and show pictures from the server's address only.
- The server answers that page through a **narrow CORS rule**: the origin `https://<name>.kaby.app` is echoed for `/v1/shops/<name>/…` and for nothing else (not another shop's routes, not any other route, no credentials); `GET, POST` and `content-type` only.
- `shop_define` and `shop_connect` ask for the address and wait up to 8 s; the first one of a server also puts the page online, which can take longer: the answer then carries the server's `/shop/<name>` and the next call (after 30 s) opens the address. Stripe's return addresses and the checkout's `successUrl` follow `shop.url`, so a payment comes back to the address the client started from. **Fallback**: the host does not answer, a domain is refused or taken, or the server has no https address, and the shop simply stays at `<server>/shop/<name>`.
- State: which addresses are open is kept in the server's memory like the shop (a restart asks the host again, which is idempotent); the shops themselves are lost at a deploy, and their attached addresses stay on the project until a clean-up (an orphan address serves a page whose shop answers `404`).
- Tests (server): `test/shoppoc-window.test.ts` (the host against the fake, the origins, the routes, the whole server's headers).

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
- `shop_photo` `{ photos: [{ product, photo, look? }] }` (6 at most) — **asked** (« Put 2 photos you sent on the shop: Colombie, Moulin »): ONE question for the batch, fourth of nothing: define,
  connect and photos fit the turn's three. For each photo it takes the picture at `photo/raw`, retouches it ON the computer (`shop-photo.mjs`, the image library `sharp` of the cloud image, loaded
  when the first photo comes and never at start: upright from its orientation mark, square crop on the subject, the light lifted by what was measured when the photo is dark (never lowered: a white background stays white; at most +80 %) and a touch of colour (`natural`, `bright`, `vivid`),
  sharpened, **every metadata block dropped, so the place of the photo never leaves the computer**, shrunk by quality then by side until it fits 245 KB) and puts it with `photo/put`. It is a
  careful retouch of THEIR picture, not a generated one: the tool description tells Kaby to say so and to suggest a new shot when a photo is poor. One line per photo comes back; a gone photo,
  an unknown product or an unreadable picture do not stop the others; a closed door (no turn, no account, rate limit) or a full shop stops the batch and is said once.
- Only a cloud computer inside a turn can call them; anywhere else they answer in one line that the shop is reached from Kaby's chat on the phone, and send nothing.
- Everything the server says (product names) is data: flattened to one bounded line, no markup (`dataLine`).

## Tests

- Server: `test/shoppoc.test.ts` (initData, the link to an account, the Mini App routes, both Kaby routes with a stubbed turn owner, isolation between people).
- Plugin: `node packages/kybernos-cloud/test-shop-stock.mjs` (the tools, what they refuse before the network, what the server's answers mean, markup in names) and, in
  `test-cloud-host.mjs`, the gate (read passes, change is asked in plain words) and the calls through the host with the computer's token and the turn.
- Photos: server `test/telegram.test.ts` (« a photo »: who is heard, the inbox, the message Kaby gets) and `test/shoppoc-storefront.test.ts` (« photos »: the routes, the limits, the public image, the window);
  plugin `test-shop-stock.mjs` (the batch, every refusal, every server answer), `test-shop-photo.mjs` (the retouch against a stand-in for `sharp`, and against the real `sharp` where the machine has it:
  skipped, and said so, on a Mac without it) and the gate and host checks of `test-cloud-host.mjs`. The real retouch on the cloud image is checked live (the image carries `sharp`).
- Not covered by an automated test: a real model choosing the tool (it needs the cloud computer image to carry this plugin version), and the Mini App in a real Telegram client
  (done by hand on 2026-11-05 on the owner's phone and in Telegram Web).

## What it does not do yet

No persistence across restarts (a restart or a deploy empties every shop and forgets the Stripe account it had made), no per-shop table, no WhatsApp surface, no line from the Mini App in
Kaby's own thread (so Kaby learns of a change made in the Mini App by calling `shop_list`, not by reading the conversation), **photos are a retouch, not a generation** (a poor photo stays poor), they live in the server's memory like the rest (a deploy loses them), WhatsApp photos are not taken, and the Mini App does not show them yet (only the shop window does), no Stripe webhook (a payment is counted when the client comes back to the window), no refund, no shipping, no tax, no application fee, a window in French only.
