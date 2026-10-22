# `@local/kybernos-kaby-customisation` (`packages/kybernos-kaby-customisation`)

**Settings › Kaby**: how the person's assistant looks and sounds. Nothing here changes what Kaby can do, its rules or its memory.

## Where to find it

- **Settings › Kaby.** The same page opens from the portrait above Kaby's chat once the strip uses the seam below (not wired yet).

## What it does, in three blocks (the way Agent Teams draws a member)

1. **Identity.** The name (an alias: the product stays Kaby elsewhere; 24 characters, letters, digits, spaces and apostrophes, no reserved word such
   as Kybernos or Claude), the words that describe the look, and a portrait: **Generate** (the image model of the person's Models, through the core's
   `POST /kybernos/image/generate`, about $0.04) or **Import** (PNG, JPEG or WebP, 4.5 MB, with a « I have the right to use this image » tick).
2. **Voice.** Pills of the voices the app's engines offer (`GET /kybernos/tts/voices`), the person's language first, **Preview**
   (`POST /kybernos/tts/speak`), and **Custom voice · record or upload**: a consent (only its time is kept) and a 10 to 60 s sample, kept on this
   computer. No installed engine speaks a cloned voice yet, so a custom voice is stored and says « not spoken yet ». Not chosen: the voice of Settings › Voice.
3. **Face on video calls.** Its own provider list, in the manner of Settings › Calls › Face, and its own keys: the two can use different accounts.
   Every provider but « No face » is listed as **soon** (`providers.mjs`): a provider becomes available in the same change that teaches the call worker
   to draw its face, and its key field appears then. Today a video call with Kaby is a voice call.

## What it stores and where

`<DSH home>/kybernos/kybernos-kaby-customisation/` (folder 0700, files 0600): `profile.json` (name, look, voice pick, face choice and the records of the
portrait and the custom voice), `portrait.bin` (the picture), `voice-sample.bin` (the sample). No key is stored yet (no provider is available).

## For the other bundles

- **Client seam**: `window.__KB_KABY__ = { profile(), subscribe(fn), refresh(), open() }`. `profile()` is the public profile (name, look, `portrait.url`,
  voice, face) or `null` until it is read; `open()` shows Settings › Kaby.
- **Host seam**: `globalThis[Symbol.for('kybernos.kabyProfile')]()` returns the same public profile, for a host-side reader (Kaby's identity text, the
  call worker's dispatch). No bundle imports another.
- **Routes** (`/kybernos-kaby-customisation/`): `GET profile`, `POST profile` `{ patch }`, `GET portrait`, `POST portrait`, `POST portrait/remove`,
  `POST voice-sample`, `POST voice-sample/remove`. Every route refuses a Host that is not the listener's; every change also needs the page's own origin.

## Not wired yet

The name, portrait and voice are kept and shown on this page; the consumers still use their own: the strip above Kaby's chat, the sidebar row, Kaby's
identity text, the call window and the call worker (its voice and its face). Each is a small change that reads the seam above.

## Tests

`node test-host.mjs` (validation, store, routes, entry) and `node test-client.mjs` (pure parts, the page rendered once, guards on the source).
