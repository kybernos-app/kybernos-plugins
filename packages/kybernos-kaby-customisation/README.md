# `@local/kybernos-kaby-customisation` (`packages/kybernos-kaby-customisation`)

**Settings › Kaby**: how the person's assistant looks and sounds, where it works, what it may do without asking, and when it wakes by itself. The first three blocks (identity, voice, face) change nothing about what Kaby can do, its rules or its memory; the last three (where it works, permissions, wake-ups) are about what it does, and are drawn from other bundles' answers (see below).

## Where to find it

- **Settings › Kaby.** The same page opens from the portrait that heads the strip above Kaby's chat.

## Four tabs, so the page is never long

The six blocks below are grouped in four tabs under the title and the lead (`TAB_IDS` in `client.js`): **Identity & voice** (blocks 1 and 2), **Video calls** (block 3),
**Work** (blocks 4 and 6: where Kaby works, wake-ups) and **Permissions** (block 5). The first tab opens by default, arrow keys, Home and End move between tabs (tab role,
`aria-selected`, `aria-controls`). Every card stays mounted and only the open panel is shown (`hidden`), so a draft in Permissions or a half-typed name is still there when the
person comes back. Nothing is stored about the open tab. The live check (`scripts/check-kaby-customisation-live.mjs`) opens the tab each section works in.

## What it does, in six blocks (the first three the way Agent Teams draws a member)

1. **Identity.** The name (an alias: the product stays Kaby elsewhere; 24 characters, letters, digits, spaces and apostrophes, no reserved word such
   as Kybernos or Claude), the words that describe the look, and a portrait: **Generate** (the image model of the person's Models, through the core's
   `POST /kybernos/image/generate`, about $0.04) or **Import** (PNG, JPEG or WebP, 4.5 MB, with a « I have the right to use this image » tick).
2. **Voice.** Pills of the voices the app's engines offer (`GET /kybernos/tts/voices`), the person's language first, **Preview**
   (`POST /kybernos/tts/speak`), and **Custom voice · record or upload**: a consent (only its time is kept) and a 10 to 60 s sample, kept on this
   computer. No installed engine speaks a cloned voice yet, so a custom voice is stored and says « not spoken yet ». Not chosen: the voice of Settings › Voice.
3. **Face on video calls.** Its own provider list, in the manner of Settings › Calls › Face, and its own keys: the two can use different accounts.
   Every provider but « No face » is listed as **soon** (`providers.mjs`): a provider becomes available in the same change that teaches the call worker
   to draw its face, and its key field appears then. Today a video call with Kaby is a voice call.
4. **Where Kaby works** (2026-11-02). A select, « This computer » first, then the account's cloud computers, with a chip (Ready, Asleep, Awake…) and one line on what the pick
   means (this computer: keep Kybernos open, no cloud hour used; a cloud computer: it wakes when it has work and its run hours count in the plan). It is **the same setting as
   « Set up… » on the « Phone and channels » screen**: the card calls `window.__KB_KYBER__.where()`, `pickWhere(value)` and `subscribe(fn)` (kybernos-kyber), so one change shows in both.
   Without that bundle, or before it has read the account, the card is not drawn. With a cloud computer picked, an amber line says the permissions below do not reach it.
5. **Permissions** (2026-11-02). What Kaby may do **in its chat on this computer without asking**: a starting point (Off, Careful, Standard, Intensive), a switch for each class (its
   memory; its cloud computer, commanded from here) with a daily limit of actions and today's use, the list of what is always asked (a connected app, restarting DSH, anything over a
   limit), **Sign**, **Pause / Resume** and the **action log** (what ran today without a question). The card holds no rule, no signature and no count: they are kybernos-cloud's
   (`kyby-mandate.mjs`; the starting points arrive with the view, so there is no copy here). Routes it calls: `GET /kybernos-cloud/kyby/mandate`, `GET …/log`, `POST …/set` (the page's
   own session cookie and origin). Signing sends the four fields and never `paused`, so signing new numbers does not silently resume a paused mandate. States: none in force, changes
   to sign, in force since, paused, to sign again (the file was altered or the key changed), cannot sign (no key on this machine: every control is off). Limits count actions, not euros.

6. **Wake-ups** (2026-11-02). Kaby wakes **by itself through an ordinary automation** of the Automations page: nothing here is signed or kept. The automation runs in Kaby's own chat
   (`sessionMode: 'home'`, `homeSessionId` = Kaby's chat), off until the person approves it (every new automation enters the certification gate), every 4 hours from 08:00 to 20:00,
   10 minutes at most, stopping when the person writes; its prompt is plain text, readable and editable there: take the two oldest open points of `todo.md` (Kaby's list, in its
   workspace), work only with what may be done without asking, tick only what is finished, never send, publish, pay, install, schedule or switch anything on, and end with one short
   message. The card **finds** that automation (the one whose runs land in Kaby's chat), says its state in a chip (no chat yet, no wake-up, to approve, off, on, working), and offers:
   **Create the wake-up** (only when there is none; the shell closes Settings whenever an automation appears, so the card then opens the Automations page, where it is approved), **Open the automation** (`window.__KB_OPEN__({ view: 'tasks' })`: the schedule, the time limit, « when I write in its chat »,
   the approval and the Stop button are that page's), **Wake it now** (`run-now`; off until the automation is approved and while a run is under way), **Stop this wake-up** (only while
   one runs) and **Open Kaby's chat** (through kybernos-kyber's `openChat()`). An amber line says wake-ups do not cover a cloud computer. Routes it calls, all same origin with the page's own
   session: `POST /kybernos/tasks` (`list`, `create`, `run-now`, `stop`), `GET /kybernos-cloud/kyby/native` (Kaby's chat id) and `GET /kybernos/automation-load` (the runs going; the
   card asks again every 5 s while one runs). During a scheduled run kybernos-cloud's host refuses what the permissions above do not cover (nobody can answer a question): the gate is
   `kyby-unattended.mjs`, keyed on the `kb-task-` request id of an automation's turn.

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

## Where what you choose shows up

- **The sidebar row and the strip above Kaby's chat** show the name and the portrait (the client seam above and the window event `kb-kaby-profile`); a click on the
  strip opens this page. The row still opens Kaby's chat.
- **Kaby's identity text** (the native DSH chat on this computer) says the name: « You are Léa (the product is called Kaby), the person's own assistant… », read from the host
  seam at each request, so a new name is heard at the next message. The name is checked again where it enters the prompt (`aliasOf` in kybernos-cloud's
  `kyby-identity.mjs`: letters, digits, spaces and a few marks, 24 characters, never the product's own name).
- **A call from the header of Kaby's own chat** carries the name and the voice chosen here. A voice not chosen is the app's own voice, asked for on purpose (`voice: { app: true }`),
  so the default of Settings › Calls does not take its place; a custom voice no engine speaks yet is the same. Calls from any other chat are unchanged.

## Not wired yet

- **The permissions on a cloud computer.** They govern Kaby's chat on this computer (the native gate); a cloud computer's gate still asks the platform, so Telegram and WhatsApp
  are not covered. They need an account-side record first. The card says so when a cloud computer is picked.

- **The face.** Every face provider but « No face » is listed as soon: the call worker does not draw a face from the portrait yet, and a video call with Kaby uses the face
  of Settings › Calls.
- **The cloud computer.** Kaby on Telegram or WhatsApp runs on a cloud computer whose image carries its own copy of the identity text and does not know the name: it needs the
  name stored on the account (a server field) first.

## Tests

`node test-host.mjs` (validation, store, routes, entry) and `node test-client.mjs` (pure parts, the page and the three cards rendered once with forced state, the requests the buttons send, guards on the source).
