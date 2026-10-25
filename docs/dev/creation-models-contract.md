# Creation models: what the server says and what the plugins do with it

Pictures, videos and voices are models of the Kybernos list like any other, but they are not chat models. The person never enters a key:
the Kybernos account pays, and the server holds the provider keys.

## What the server sends

`GET /v1/models` already answers an entry per model with a `kind` (`chat`, `embeddings`). Three kinds are added; every other field keeps its
meaning:

```json
{
  "id": "seedream-5.0",
  "object": "model",
  "owned_by": "kybernos",
  "kind": "image",
  "display_name": "Seedream 5.0",
  "capabilities": ["image_generation"],
  "unit_pricing": { "unit": "image", "usd": "0.14" }
}
```

- `kind`: `image`, `video` or `speech`.
- `unit_pricing.unit`: `image` (one picture), `second` (one second of video), `thousand_characters` (a thousand characters of text to speak).
- `unit_pricing.usd`: the price of ONE unit, a decimal string with at most nine decimal places (as the server's ADR 0003 § 11 writes it: `"0.14"`,
  `"0.015"`), the price the person is billed (not the provider's cost). The plugins keep it as written; the skill adds money in integers
  and rounds up to the millionth of a dollar.
- `display_name` is optional (the id is shown without it); `unit_pricing` is optional (the row then shows no price, it never shows a guess).
- An older server sends none of these entries: the list simply has no creation row.

## What the plugins do with it

- `kybernos-cloud` keeps these entries out of `providers.kybernos.models` (DSH's chat picker lists every model of a route) and offers them in
  `models.creation` of `GET /kybernos-cloud/models`. A malformed price is dropped, an unknown kind is skipped, at most 200 entries are kept.
- `kybernos-models` draws them as read-only rows of the same list (type image / video / audio, output capability lit, price per unit).
- Nothing here generates anything. Calling a creation model (start a job, wait for it, fetch the file) is the next step and needs routes the
  server does not have yet: a job route for videos, which take minutes, and a price held back before the call and settled after, as the chat does.

## Checks

`node packages/kybernos-cloud/test-cloud-host.mjs`, `node packages/kybernos-models/test-client.mjs`, and on a real page
`node scripts/check-models-creation-live.mjs` (sandbox only, the server's answer is faked in the page).
