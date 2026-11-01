# The templates catalogue (the shelf of the new-chat page)

The new-chat page shows, under its types, the **examples** of the type that is lit: a picture, a name, a line and the request each one starts from.
Those examples are **data**: a public file of the Kybernos server that the plugin host keeps on disk. Nothing about the person is read, kept or sent.

- Host half: `packages/kybernos-plugin/templates-shelf.mjs` (cache, validation, load cycle), routes in `index.js`.
- Page half: the `KB-NEWCHAT` block of `packages/kybernos-plugin/client.js` (`KbNcShelf`, `KbNcDialog`).
- Tests: `packages/kybernos-plugin/test-templates-shelf.mjs` (host), `test-newchat.mjs` (page), `scripts/check-newchat-live.mjs` (real GUI).

## Three floors, so the page never waits on a network

1. **The copy on disk**, `<DSH home>/kybernos/templates-catalogue/{catalogue.json, shelf/<id>.webp, shelf/large/<id>.webp}`: the last valid answer of the server.
2. **`packages/kybernos-plugin/templates-fallback.json`**: the same catalogue as TEXT, shipped with the plugin, no picture (AGENTS rule 4: no media in git).
   DSH starts and the page works offline from it (AGENTS rule 2).
3. **The type's own drawing** where a card has no picture on disk yet, so a card is never empty.

## What the server publishes (contract for `kybernos-server`)

| Request | Answer |
| --- | --- |
| `GET {api}/v1/templates/catalogue.json` | the catalogue below, `application/json`, **public: no token, no cookie**, at most 512 KB |
| `GET {api}/v1/templates/shelf/<id>.webp` | the card picture of an example (WebP, at most 300 KB) |
| `GET {api}/v1/templates/shelf/large/<id>.webp` | the larger picture the dialog shows (WebP, at most 900 KB); a type may have none |

`{api}` is the address the host already uses for the Kybernos server (`kbFeedbackCloudState(...).api`, else `KB_FEEDBACK_API_DEFAULT`). https only
(plain http only for a loopback address), redirects are not followed, an answer that takes more than 8 s is a miss.

```jsonc
{
  "schema": "kybernos.templates/1",
  "version": 2,                       // integer >= 1, grows with each publication
  "updatedAt": "2026-11-01T00:00:00Z",
  "locale": "en",                     // English only for now
  "imageBase": "shelf/",              // forced to this value by the host
  "groups": ["Documents", "Media", "Apps", "Automate"],
  "types": [{ "id": "doc", "name": "Document", "group": "Documents", "blurb": "A written document: a report, a brief, notes." }],
  "templates": [{
    "id": "doc_quarterly",            // [a-z0-9_-], also the picture's file name
    "type": "doc",                    // one of the type ids above
    "name": "Quarterly report", "tag": "Business", "line": "Two columns, a chart and a pull quote.",
    "meta": "4 pages",                // the « Format » line of the dialog
    "prompt": "Write a 4-page quarterly report …",   // what « Use this request » puts in the composer
    "image": { "src": "doc_quarterly.webp", "width": 720, "height": 450, "alt": "…", "large": "large/doc_quarterly.webp", "largeWidth": 1280, "largeHeight": 800 },
    "kind": "template",               // "template" (needs a kit to be shown) | "start" (always shown)
    "kit": "ecommerce",               // App only: the kit this template creates, by the last segment of its id
    "tables": ["Contacts", "Products"], "links": [[0, 1]], "layout": [[0, 1]],   // App only: the Structure tab
    "inside": [{ "t": "Sample rows", "d": "64 rows, so you see it working." }]    // optional: the dialog's list
    "made": { "model": "black-forest-labs/FLUX-2-dev", "label": "FLUX.2 dev", "seed": 421, "width": 1280, "height": 800, "steps": 28 }   // optional: how a generated example was made
  }]
}
```

### A generated example keeps its prompt and its model

An example whose picture (later: video, audio, 3D) was generated carries `made`: the model's id as the provider names it, an optional display name (`label`), and the seed, size and steps that were set.
Its `prompt` is **exactly what the model was given**, so the dialog can offer *Use this prompt* (fills the composer with it) and *Remix* (fills the composer with « keep the prompt “…” but change: » and the person says what to change).
The dialog shows « Made with <label> · <width>×<height> · seed <n> » under the prompt. A `made` whose model is not a plain id (`[A-Za-z0-9._/-]`, 80 characters at most) is dropped and the example stays; seed, size and steps outside their range are left out.
The raw model answers and the plan that made them stay outside git (`~/kybernos-archive/templates-catalogue/`), like the theme photographs (AGENTS rule 4).

The host checks **everything again as if it came from outside** (`shelfValidate`): a wrong schema or version refuses the whole file; a bad entry is dropped
alone; texts are clipped and stripped of control and line-separator characters; picture names must match `^(?:large/)?[a-z0-9][a-z0-9_-]{0,63}\.webp$`; a
picture must start with the WebP signature. A refused file leaves the previous copy in place.

## The host routes (this machine only)

Read only, no origin guard needed (no write, nothing of the person's).

- `GET /kybernos/templates-catalogue` → `{ ok: true, catalogue }`: the best catalogue there is (disk copy, else the shipped text), each picture marked `ready`
  / `readyLarge` once its file is on disk, and `source: "server" | "bundled"`. `404` when there is none.
- `GET /kybernos/templates-image?f=<name>` → the picture, from disk, else fetched once from the server and kept (the larger pictures are fetched this way, on the
  first click). `404` otherwise. Served `no-store` with a sandbox CSP.

## The load cycle

- First load **20 s after the start** (DSH is not slowed down), then an hourly look at whether the copy is a day old.
- After a miss (404, network, unreadable file) the server is asked again **6 hours** later. A catalogue the server has not published yet is a quiet 404.
- Pictures are loaded in small paced batches; three batches in a row that bring nothing stop the picture loading until the next retry.
- `KYBERNOS_NO_TEMPLATES_LOAD=1` switches the background load off (tests, an offline machine). The routes still answer from disk and from the shipped text.

## What the page shows

- Every type is shown, in one even grid. A type whose bundle this install does not load carries a small tag, « Not enabled »; **Audio** and **Game**, which no bundle makes yet, carry « Soon ». Their examples still open and *Use this request* still fills the composer.
- An example whose `kind` is `template` is shown only when its `kit` is one the Apps seam lists (`window.__KB_TEMPLATES__.list()`); `kind: "start"` is always
  shown. Ideas the product ships no kit for (restaurant, fitness, salon) are therefore never offered dead.
- *Use this request* only fills the composer, like a type does. For an App template, *Use template* creates the app through the Apps seam
  (`__KB_TEMPLATES__.add(kit, { sample: true, kit: true })`), *Open my app* opens it when it is already there, *Adapt with Kaby* fills the composer.

## Making a lot of real examples

A lot is one plan per type, `docs/dev/templates-lots/<lot>.json` (text, in git): the prompt, seed and catalogue entry of each example, the type it fills and the model. The pictures are not in git.

1. `node scripts/theme-photos.mjs <plan> --model <id> --out ~/kybernos-archive/templates-catalogue/<lot>`: one DeepInfra call per example (the raw answers and `cost.json` stay in that folder; `--only a,b` redoes some, `--dry-run` prints the prompts and spends nothing).
2. Look at the contact sheet, change a seed or a prompt in the plan, redo that example only.
3. `node scripts/templates-lot.mjs <plan> [--fallback] [--install]`: WebP cards and large pictures, the catalogue with `made` on each example, checked by the host's own `shelfValidate`, in `<from>/release/`. A plan's examples replace every example of its type; the other types stay.
   `--fallback` also rewrites `templates-fallback.json` (prompts only), `--install` puts the release in this machine's disk copy.
4. The `release/` folder is what the server publishes, byte for byte.

First lot: `images-business-1.json` (9 images, ads, social, branding, real estate, e-commerce, food, learning; `black-forest-labs/FLUX-2-klein-9b` on DeepInfra, about 1.5 cents and 1 second each).

## Not done yet

- Publishing: the routes and the publishing script of `kybernos-server` are built but not deployed (deploys are frozen), so the host gets a 404 and a card shows a picture only where this machine has one on disk (`--install`), else its type's drawing. The server's check does not know `made` yet.
- Real examples for the other types (video, audio, 3D, slides, website, mini-app...), pictures per locale, kits for restaurant / fitness / salon.
- Where the files are served from (the server's data directory, or a dedicated static host): the choice is the owner's.
