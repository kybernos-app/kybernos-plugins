# The templates catalogue (the shelf of the new-chat page)

The new-chat page shows, under its types, the **examples** of the type that is lit: a picture, a name, a line and the request each one starts from.
Those examples are **data**: a public catalogue (a public bucket on Fly.io, the Kybernos server as the second source) that the plugin host keeps on disk. Nothing about the person is read, kept or sent.

- Host half: `packages/kybernos-plugin/templates-shelf.mjs` (cache, validation, load cycle), routes in `index.js`.
- Page half: the `KB-NEWCHAT` block of `packages/kybernos-plugin/client.js` (`KbNcShelf`, `KbNcDialog`).
- Tests: `packages/kybernos-plugin/test-templates-shelf.mjs` (host), `test-newchat.mjs` (page), `scripts/check-newchat-live.mjs` (real GUI).

## Three floors, so the page never waits on a network

1. **The copy on disk**, `<DSH home>/kybernos/templates-catalogue/{catalogue.json, shelf/<id>.webp, shelf/large/<id>.webp}`: the last valid answer of the server.
2. **`packages/kybernos-plugin/templates-fallback.json`**: the same catalogue as TEXT, shipped with the plugin, no picture (AGENTS rule 4: no media in git).
   DSH starts and the page works offline from it (AGENTS rule 2).
3. **The type's own drawing** where a card has no picture on disk yet, so a card is never empty.

## Where the files are published

Two sources with the same layout, asked in this order; the first one that has a file wins, a 404 or a silent one falls through to the next.

1. **The public bucket** (Tigris on Fly.io, org `personal`, bucket `kybernos-templates`, public read): `SHELF_PUBLIC_BASE` in `templates-shelf.mjs`, i.e. `https://kybernos-templates.fly.storage.tigris.dev/`. `KYBERNOS_TEMPLATES_BASE` replaces it (a mirror, a test); an empty value leaves the server only.
   It costs nothing at this size (a few MB; Tigris keeps 5 GB free) and nothing runs: no machine, no volume. Built and filled by `scripts/templates-publish.mjs` (below).
2. **The Kybernos server** (`{api}/v1/templates/...`, the address the host already uses: `kbFeedbackCloudState(...).api`, else `KB_FEEDBACK_API_DEFAULT`). Its routes are built but not deployed (deploys are frozen), so today it answers 404.

| Request (relative to the base) | Answer |
| --- | --- |
| `catalogue.json` | the catalogue below, `application/json`, **public: no token, no cookie**, at most 512 KB |
| `shelf/<id>.webp` | the card picture of an example (WebP, at most 300 KB) |
| `shelf/large/<id>.webp` | the larger picture the dialog shows (WebP, at most 900 KB); a type may have none |
| `shelf/video/<id>.mp4` | the sample clip of a video example (H.264 + AAC, at most 8 MB, served with ranges) |

https only (plain http only for a loopback address), redirects are not followed, an answer that takes more than 8 s is a miss.

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
    "video": { "src": "video/video_ad_bottle.mp4", "width": 832, "height": 480, "seconds": 5.3 },   // optional: the sample clip of a video example (the picture is its first frame)
    "made": { "model": "black-forest-labs/FLUX-2-dev", "label": "FLUX.2 dev", "seed": 421, "width": 1280, "height": 800, "steps": 28 }   // optional: how a generated example was made
  }]
}
```

### A generated example keeps its prompt and its model

An example whose picture (later: video, audio, 3D) was generated carries `made`: the model's id as the provider names it, an optional display name (`label`), and the seed, size and steps that were set.
Its `prompt` is **exactly what the model was given**, so the dialog can offer *Use this prompt* (fills the composer with it) and *Remix* (fills the composer with « keep the prompt “…” but change: » and the person says what to change).
The dialog shows « Made with <label> · <width>×<height> · seed <n> » under the prompt. A `made` whose model is not a plain id (`[A-Za-z0-9._/-]`, 80 characters at most) is dropped and the example stays; seed, size and steps outside their range are left out.
### A video example: a request, a sample clip, and the sample's own prompt

A video example's `prompt` is **the request that starts its skill** (« Make a 5-second product ad video from my product photo. Ask me for … »), so the dialog keeps « Use this request » and has no Remix. What the model was given for the sample is `made.prompt` (≤ 700 characters), shown apart as « Prompt of the sample » with the model, size and seed; a Kybernos Motion sample has no model prompt (« How the sample was made · Made with Kybernos Motion · 1280×720 »).
`video` names the clip (`video/<id>.mp4`, nothing else), its size and its length (1 to 60 s). The card and the dialog show the first frame (the example's picture) with a Play button; **only pressing Play asks for the clip**:
the host route `GET /kybernos/templates-video?f=video/<id>.mp4` serves it from `shelf/video/` on disk, else fetches it once (≤ 8 MB, must start with an MP4 `ftyp`) and keeps it. It answers `Range` requests (200, 206, 416), because a player cannot start or seek without them (Safari plays nothing).
The background load never fetches clips; a machine that never presses Play never downloads one. A clip the host cannot get puts the frame back with « This example cannot be played right now. ».

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
- `GET /kybernos/templates-video?f=video/<id>.mp4` → the sample clip, from disk, else fetched once and kept (on a click on Play). `video/mp4`, `accept-ranges: bytes`, `206` for a range, `404` otherwise; same sandbox CSP.

## The load cycle

- First load **20 s after the start** (DSH is not slowed down), then an hourly look at whether the copy is a day old.
- After a miss (404, network, unreadable file) the server is asked again **6 hours** later. A catalogue the server has not published yet is a quiet 404.
- Pictures are loaded in small paced batches; three batches in a row that bring nothing stop the picture loading until the next retry.
- `KYBERNOS_NO_TEMPLATES_LOAD=1` switches the background load off (tests, an offline machine). The routes still answer from disk and from the shipped text.

## What the page shows

- Every type is shown, in one even grid. A type whose bundle this install does not load carries a small tag, « Not enabled »; **Game**, which no bundle makes yet, carries « Soon ». **Audio** has real examples and needs no bundle to look at them, so it carries no tag. Their examples still open and *Use this request* still fills the composer.
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

### A video lot

`video-business-1.json` (8 examples: five clips by `heygen/heygen-video-1`, three by Kybernos Motion). A video plan lists, per example, the `clip` (an `.mp4` in `<from>/clips/`), the `request`, `made` and where the poster comes from (`poster`, a still, else the clip's frame at `posterAt`; `fit: "pad"` keeps the whole frame of a designed scene instead of cropping it to 16:10). `templates-lot.mjs` cuts the poster, copies the clip (`-c copy -movflags +faststart`) and writes `video` and `made`.

- **HeyGen Video 1** (Vercel AI Gateway, key `VERCEL_AI_GATEWAY_API_KEY` in the credentials): text-to-video, image-to-video and reference-to-video in one model, with sound, 9:16 and 16:9. 5 seconds at 480p is about $0.10 (`providerOptions.heygen.resolution: '480p'`; a pixel size such as `832x480` is refused). Used with the AI SDK: `generateVideo({ model: gateway.video('heygen/heygen-video-1'), prompt: { image, text }, duration: 5, aspectRatio, seed, providerOptions: { heygen: { resolution: '480p' } } })`. Its listing says no zero-retention and no training opt-out, so a skill that takes a person's photo should say so.
- **Kybernos Motion** samples are scenes (`docs/dev/templates-lots/motion/*.scene.json`, data, never code) exported by the real panel: `source scripts/sandbox/env.sh && node scripts/motion-export.mjs <scene.json>... --out <dir>` (needs the sandbox instance, which loads the bundle).
- Stills for image-to-video are made like any picture (`theme-photos.mjs`, `video-frames-1.json`, `video-frames-1b.json`).

### Composed films (lot 2: `video-business-2.json`, remade with the new mark as lot 3: `video-business-3.json`)

Eight films of 5 to 20 seconds that replace the eight of lot 1 (new ids: a file already on a machine is never fetched again). A film is not one clip: it is parts, paid for one by one, then cut together.

- **Parts** (`node scripts/video-parts.mjs clip|music|voice|listen`, all written OUTSIDE the repository, in `~/kybernos-archive/templates-catalogue/video-business-2/parts/`): HeyGen shots at **768p** (about $0.03 a second, 832x480 was too soft; the gateway refuses video below a **$10 balance** with a 402, read the balance on `GET https://ai-gateway.vercel.sh/v1/credits`), music by `ACE-Step/acestep-v15-xl-sft` (30 s at least, $0.001 a second), an English voice by `hexgrad/Kokoro-82M` (almost free). The AI SDK lives in `~/kybernos-archive/templates-catalogue/tools/gw` (`KB_GW_DIR`). `listen` sends a file to Whisper: it is the only way to know that a voice says the right words and is not buried under the music (run it on the FINAL mix).
- **A scene that continues starts from the last frame of the shot before it** (`ffmpeg -sseof -0.15 -i shot.mp4 -frames:v 1 last.jpg`, then image-to-video): the property flight (road, door, living room, terrace), the old photograph (black and white, colour blooms, a child waves) and the try-on (coat colour, then leather jacket and blazer) are each ONE continuous gesture.
- **Texts are never asked of the video model**: names, prices, labels, captions and colour dots are drawn over the film.
- **Recipes** (`docs/dev/templates-lots/video-compose/<id>.json`, the edit) feed `node scripts/video-compose.mjs <recipe> --parts <dir> --out <file>`: cross-fades, animated ASS texts (libass, system font Avenir Next), voice over, music ducked under the voice, loudness `-16 LUFS`, a bottom shade so the mark reads on a pale picture, and the mark. A clip must stay under 6 MB (`crf` in the recipe).
- **The mark** (`scripts/kybernos-watermark.py`, small, bottom right, played ONCE): the red K of `kbBrandArt` with its three typing dots and « ybernos » come in whole at 1 s (`watermark.at` in the recipe), the dots bounce, a light crosses the K, then the letters are drawn back into the K, which glides to the corner, lands with a small pulse and stays to the end (the clip is not looped: overlay repeats its last picture). The K is 1.1 % of the longer side (14 px at 720p); drawn in code, no picture file. Release v6 (`video-business-3.json`) holds the same eight films recomposed with it, under ids ending `_r2` (a remade file needs a new id: one already on a machine is never fetched again); the v5 files stay in the bucket, unused.
- Spend of this lot: about $2.9 on the gateway (20 shots incl. retries) plus a few cents on DeepInfra.

### Lot 5 (`video-business-5.json`): the two films of the previews

The try-on and the property film are replaced by the films that had been made as previews, under new ids (`_r3`); the six other films are the lot-4 ones, unchanged.

- **Virtual try-on** (`video_tryon_swap_r3`, 15 s, 9:16): ONE HeyGen shot in a single take in a Paris living room, three looks tried on in turn (camel coat, emerald coat, cognac leather jacket), the three look names and the three spoken lines asked in the prompt, the model's own light music. The recipe only grades it and adds the mark.
- **Property film** (`video_property_flythrough_r3`, 23 s, 16:9): the flight in, then one shot per room chained by last frame, a floor plan that follows the visit and the features legend drawn in code (`scripts/video-overlays.py`), the villa name at the start and the price at the end, ACE-Step music.
- The lot builds on the PUBLIC catalogue like every lot: `node scripts/templates-lot.mjs docs/dev/templates-lots/video-business-5.json --from <dir with the 8 clips and frames/picnic-restored.png> --base <public catalogue.json> --fallback --install`. The old `_r2` try-on and property ids leave the catalogue; their files stay in the bucket, unused.

### A still lot: the 3D examples (`model3d-1.json`)

Nothing is generated for a 3D example: its picture is a **screenshot of the real page** the skill `model-3d` builds from the example of the same name, so the card shows what the product really shows (the grinder is exploded, next to its bill of materials; the engine is cut away, next to its computed figures).
A plan whose cells name a `still` (a JPEG in `<from>/stills/`) is a still lot: the cell carries the `request` that starts the skill and the `entry`, and the example has **no `made`** (so the dialog offers « Use this request » only, no Remix).

1. Build the four pages from the installed skill (`node ~/.dsh/skills/model-3d/scripts/model.mjs new <dir> --from chair|blank|grinder|engine`, then `all <dir>`), outside git, in `<from>/pages/`.
2. `node scripts/model3d-stills.mjs <from>/pages chair:700 stool:700 grinder:800:Explode engine:1000`: one headless Chrome per run, driven over its DevTools socket (Node's own WebSocket, no dependency). It prefers the headless shell Playwright keeps in `~/Library/Caches/ms-playwright` (no display, no profile prompt), else Google Chrome. `<id>:<height>:<button>`: the window height (a page taller than 800 gets a bigger window shrunk to 1280x800), and the button to press before the shot. A virtual-time budget was tried first and hangs when the machine is busy.
3. `node scripts/templates-lot.mjs docs/dev/templates-lots/model3d-1.json --from <from> --base <the public catalogue.json> --install`. **Build on the public catalogue** (`--base`), not on the text shipped with the plugin: that text has no `made` and no `video`, and an `--install` built on it would strip them from every other example of this machine (the script now refuses). `--fallback` rewrites the shipped text as usual.

The four examples (armchair configurator, hand grinder exploded, four-stroke engine, wooden stool) replace the nine pictureless placeholders of the type (box, sphere, vase, ring, can, cone, table, stairs, lounge chair), which showed the type's own drawing for lack of a picture.

### A still lot: the dashboard examples (`dashboard-1.json`)

Eight real dashboards replace the nine placeholders of the type (cash flow, support desk, website analytics...), which named sources the product does not have: a dashboard reads only what the plugin can read (usage, automations, Agent Teams, skills, sessions, and the Tables databases through `db.rows`), never Stripe, a CRM or a helpdesk.

- **The picture is the real page.** `KB_NODE_MODULES=<a node_modules with react, react-dom, esbuild and playwright-core> node scripts/dashboards-stills.mjs <preset id>:auto ... --out <from>/stills` renders the built `client.js` of `@local/kybernos-dashboards` (real React, headless Chromium, the real host logic) on a temp profile and screenshots it at 1280x800 (a taller dashboard is drawn at a smaller scale, like a zoomed-out browser, up to 1200 px; `auto` takes the smallest window that holds the whole page). A `check-*`: CI does not run it. Nothing is generated, so the examples carry no `made` (no Remix), only « Use this request ».
- **No machine's own numbers.** The three business ones (`real-estate-overview`, `ecommerce-overview`, `recruitment-overview`: the dashboards the shipped templates carry) read the SAMPLE rows of those templates through a real Tables service (`scripts/lib-template-world.mjs`); the five others (`usage-tokens`, `usage-overview`, `automations-health`, `automation-flow`, `agent-teams`) read the plugin's fixtures (`packages/kybernos-dashboards/lib-fixtures.mjs`: invented sessions, models and automations).
- **The request starts the skill `dashboard-builder`** and names only what a widget can show; the template ones ask which table holds the data and fall back to the sample rows, said to be a sample.
- Build: `node scripts/templates-lot.mjs docs/dev/templates-lots/dashboard-1.json --from <dir with stills/> --base <the public catalogue.json> --fallback --install` (public base, like every lot).

### The audio lot (`audio-2.json`): a wave player, and two films

Six cards fill the type: **three sounds** played by a wave player (no picture, no video), **two films** that were kept from the first audio lot (guided breathing, bedtime story: a voice and music over a scrolling wave or watercolours, played by the Play button like any clip) and **a card of text**.

- **A sound example** carries `audio: { src: 'audio/<id>.mp3', seconds, peaks, hue }` in the catalogue. The MP3 is served by the same host route as the clips (`/kybernos/templates-video?f=audio/<id>.mp3`, ranges, `audio/mpeg`), asked of the bucket or the server only at the first Play and kept on disk like a clip. `peaks` is the loudness of 96 slices of the sound (0 to 100): the dialog's player draws the wave from them, nothing is decoded in the browser; a click on the wave starts and seeks, the arrows move by 5 seconds. `hue` (0 to 359) is the colour of the wave and of its gradient. The card's picture is the same wave drawn by `scripts/audio-poster.py` (Pillow), already part-way played.
- **A card of text** (`kind: 'prompt'`, a plan cell with `card: "prompt"`): no picture, no `made`, no dialog. `line` is the summary of a ready-made prompt, shown inside the card; `prompt` (at most 700 characters) is the prompt itself, and a click puts it in the composer straight away, as the prompt cards of other products do. Any type may carry some.
- **A cell of the plan** names `audio` (an MP3 in `<from>/audio/`, 1 to 120 s, at most 3 MB), `hue`, `request`, `made`; `scripts/templates-lot.mjs` reads the length, computes the peaks, draws the poster and copies the sound to `shelf/audio/`. A plan may mix audio cells and clip cells (the examples of the type that stay); `templates-publish.mjs` uploads `.mp3` as `audio/mpeg`.
- **The three samples** (the text is written for the sample, the figures invented): a business update in English (ElevenLabs v4, Brian), an audiobook page in Spanish (ElevenLabs v4, Matilda), the summary of an invented API migration guide in Mandarin (Fish Audio S2.1 Pro, default voice). All are AI voices speaking through the AI gateway (`createGateway().speechModel(...)` of the AI SDK; the gateway has no `/v1/audio/speech`), then `silenceremove` + `loudnorm -16 LUFS`, MP3 128 kbit/s mono. Several models were tried for Spanish and Chinese (ElevenLabs v4, Fish Audio, Gemini TTS) and checked by Whisper; the choice among takes of equal accuracy is by ear, and the other takes stay in `~/kybernos-archive/templates-catalogue/audio-2/parts/`. Cost: about 0.1 $.
- **The two films** (`video-compose/audio_ocean_calm_en.json`, `audio_bedtime_fr.json`, shots by `scripts/audio-shots.sh`, stills of the bedtime film by `audio-frames-1.json`): the voice is ElevenLabs v4 (Sarah), music by ACE-Step, captions timed from the Whisper segments, the voice starts at 0.8 s.
- **Own voice**: `node scripts/video-parts.mjs voice <out.mp3> --clone <reference.wav> --lang fr|en` (Chatterbox Multilingual on DeepInfra) makes a line in a person's voice from a 20-second recording; the reference is uploaded as a voice for ONE call and deleted right after (`finally`), and never enters git. Two examples in the maintainer's own voice were made and dropped from the shelf (they would have put a voice on a public site); the type still waits for a skill (`audio-creator`) that asks for the recording and the consent.
- **Check without ears**: `listen` (Whisper) against the script (97 % for the three samples), and the loudness read back from the file. Whether a voice sounds good is for a person to say. A reminder from the build: an `afade` placed at `st=0` silences the rest of the file, the peaks of a sound are read back precisely to catch that.

### Publishing

`node scripts/templates-publish.mjs <release dir> [--env <file>] [--dry-run]` uploads a release to the bucket (AWS Signature V4, no dependency) and reads every file back **without credentials**. The bucket holds the sum of the releases; publish the older lots' releases first, the newest last (the catalogue goes last in each run). `fly storage create -n kybernos-templates -o personal -p -y` made the bucket; its credentials are in `~/kybernos-archive/templates-catalogue/.tigris-create.log` (mode 600, outside git) and are never printed.
A file already on a machine's disk is not fetched again: remaking an example under the same id needs a new id (or the file removed on that machine).

## Not done yet

- The server half: the routes and the publishing script of `kybernos-server` are built but not deployed (deploys are frozen); its check does not know `made` or `video` yet. The shelf does not need it any more (the bucket is the first source).
- The video examples start the skill `video-creator` (`packages/kybernos-plugin/skills/video-creator/SKILL.md`, seeded into `<DSH home>/skills` at plugin start by `KB_SHIPPED_SKILLS`, never over a copy the person edited). It asks for the pictures and details, shows the first frame, reads the account's creation models from `/kybernos-cloud/models` (Kybernos models first, best quality for the price, `heygen/heygen-video-1` recommended) and makes the animated examples for real with the Motion tool. What is still not built: the generation tool and the credits, so for the generated films the skill stops at a `video-brief.md` and says so; and the real profile's account offers no creation model yet (the server is not deployed).
- « Old photo, alive » has its own skill, `photo-alive` (`packages/kybernos-plugin/skills/photo-alive/SKILL.md`, seeded like `video-creator`): the worn print, a light sweep that leaves the restored HD picture, then the clip that starts FROM the restored picture (a video model animates the detail it is given), with the voice, the caption and the label in the person's language. The restoration is an image-edit model (tested: `bfl/flux-kontext-pro`, about $0.04), the clip HeyGen Video 1 at 1080p with `ultraquality` (about $0.10 a second); both are read from `/kybernos-cloud/models`, which lists NO creation model on the account yet, so the skill stops at `photo-alive-brief.md`. The ffmpeg commands of the opening and the join are written in the skill itself (seeding copies only `SKILL.md`) and were run as written. The maintainer's own scripts for the same job: `scripts/video-parts.mjs restore|clip` and the tools kept in `~/kybernos-archive/templates-catalogue/tools/`.
- Real examples for the other types (slides, website, mini-app, game...; 3D has its four and audio its five since 2026-11-01), a skill and a bundle for audio (`audio-creator`, the recording and consent flow), pictures per locale, kits for restaurant / fitness / salon.
- Licences of the model outputs (FLUX.2 klein 9B, HeyGen) are not checked for a public, commercial showcase.
