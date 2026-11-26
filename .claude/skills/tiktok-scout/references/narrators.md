# Narrators: the four options, the default, the test

## The four options

| Narrator | For | Against |
|---|---|---|
| **`human`**: a person on camera | most trust; no « AI » label needed for the face; the strongest for a hot take | someone must film and speak English each time; limits how often you can post |
| **`avatar`**: an original cartoon character | posts every day without filming; anonymous; the reference format with a character works | production work (character, lip-sync); the « AI-generated » label; never copy another creator's character |
| **`kaby`**: the Kybernos assistant as that character | the video's face is the product's face, so every video builds recognition | needs a designed Kaby; the same production work as `avatar` |
| **`voice-screen`**: a voice over the product, no face | cheapest; the proof is on screen; no uncanny face | least personality; weakest for a hot take |

`kaby` is `avatar` with a fixed identity: the scenarios treat them the same and the difference is the character brief
below.

**Recommendation (decided 2026-10-23 by the owner): `kaby`, split layout, with an A/B test against `human`.**
Why a test and not a verdict: the two reference accounts do well with a cartoon character and with a person alike, so the
narrator is not what decides a video; the hook, the structure and the proof are. What a test can show is whether *this*
account holds viewers better with the face or the avatar, at a production cost that is very different. The cheaper arm
wins a tie.

> The older `tiktok-contenu-vertical` skill says « never an avatar or a robot voice ». For the narrator, this skill
> and the owner's choice win. Keep the other half of that rule: **a neural voice, never the system voice** (`say`).

## What each narrator adds to a scenario

Every beat has a `- Narrator:` line. It says what the narrator type does at that moment.

- **kaby / avatar**: the expression (neutral, pointing at the board, thinking, surprised, approving, done) and the
  gesture; nothing the character cannot do (no hands holding the real product). Lip-sync is assumed on the spoken line.
- **human**: the camera note: framing (head and shoulders, eyes on the lens), where to pause (the cut points), what the
  hands do, when to look at the screen. Lines short enough to say in one breath.
- **voice-screen**: the screen choreography instead: what the cursor does, what is zoomed, when the text pops. The tile
  shows the product or the board.

## Kaby's character brief (original; for `kaby`)

Kaby has no canonical face in the repository. If the person has set a Kaby portrait in the app, use **that image** as the
reference so the video's face is the app's face. Otherwise this run's first deliverable is the brief below, for the
person to approve before any production:

- Original character, drawn for Kybernos: not a copy or a look-alike of any creator's character.
- Flat 2D cartoon with a thick outline, shoulders-up in a call tile; one calm background colour.
- Colour: Kybernos red `#f2372a` and white as the accents (the logo's two colours, `docs/dev/brand.md`); the rest neutral.
- Six expressions, each one a beat the scenarios use: *explaining*, *pointing at the board*, *thinking*, *surprised*,
  *approving* (nods before something is allowed to run: it carries the human-approval story), *done*.
- One voice, one neural English voice, kept for every video. Never a system voice, never a real person's voice.
- Name tag in the tile: « Kaby ».

## Human brief (for `human`)

Head and shoulders, eyes on the lens, a plain background, a microphone in shot if there is one. Speak the lines as
written but in your own rhythm: where a line fights your tongue, change the words and re-run `check` so the length
holds. Record in short takes cut at the pauses; the captions are burnt in afterwards. English throughout.

## The A/B test

- Two arms: `kaby` and `human`. `ab next` says which is due; it alternates, so the counts stay level.
- Keep the rest equal: the same three styles in rotation (each arm gets each style at least twice), similar posting
  hour, the same length range. Do not compare an arm in week one with the other in week four if the account is growing.
- Log every posted video (`ab add`), then at day 1 and day 7 type in **completion** and **3-second hold** from TikTok
  Studio (`ab set`); the report adds the public likes and shares.
- Read it with at least **six videos per arm**. Below that the report says « too early »: say it too.
- Judge on completion, 3-second hold and shares, never on views alone (views move with the hook and the hour).
  A gap of a few points on six videos is noise: call it a tie and keep the cheaper arm (`kaby`).

## The label

A synthetic voice or a generated or animated face is AI-generated content for TikTok's rules. Remind the person to set
the label when posting, and to check the platform's current wording: it changes, and posting is theirs.
