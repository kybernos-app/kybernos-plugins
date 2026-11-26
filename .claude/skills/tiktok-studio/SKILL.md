---
name: tiktok-studio
description: "Turns a chosen TikTok scenario into a storyboard, then a price quote the person approves before anything is generated. Reads the picture, video and voice models the Kybernos account offers with their prices, and at setup proposes a primary and a backup model per kind for the person to validate. The person never enters an API key. Generation itself is not wired yet: the skill stops at the approved quote."
whenToUse: "The person wants to produce a TikTok video from a scenario (the next step after tiktok-scout), wants to choose or change the image, video or voice models used for it, or asks what a video would cost."
---

# TikTok studio

One run: **check** the models and the saved choice, **set up** the primary and backup models with the person if needed,
**storyboard** the chosen scenario, **quote** it, **hand over**. You draft and you price; you never publish, and you never spend
without a quote the person approved.

Speak the user's language in the chat. The spoken lines of a scenario stay in the language the scenario was written in.

```bash
KIT=~/.dsh/skills/tiktok-studio       # this folder (or .claude/skills/tiktok-studio in the Kybernos repo)
node "$KIT/scripts/studio.mjs" ...    # every command below
```

State (the validated models and their prices) lives in `<DSH home>/kybernos/tiktok-studio/settings.json` (`~/.dsh` by default). There is
no key anywhere: the models belong to the person's Kybernos account, which pays for them.

## 0. Look first

```bash
node "$KIT/scripts/studio.mjs" doctor
```

It says whether DSH answers, whether a Kybernos account is connected and how many creation models are offered. Read its last line:
**generation is not wired yet**. Say so plainly whenever the person expects a finished video; never pretend to generate.

- Exit 2: DSH does not answer on that port. Try `--port <N>` (the port of the DSH you are running in), then say what you tried.
- Exit 3: no Kybernos account is connected. Creation models come with the account: tell the person to connect it in Settings.
- Exit 4: the account is connected but the server offers no picture, video or voice model yet. Say it, and stop after the storyboard.

## 1. Set up the models (first run, and whenever `check` says the choice no longer holds)

```bash
node "$KIT/scripts/studio.mjs" check          # exit 0: the saved choice holds, go to 2
node "$KIT/scripts/studio.mjs" models         # what is offered, by kind, with the price of one unit and an estimate for a usual 30 s video
```

`check` says per kind `ok`, `missing`, `gone` (the model left the offer), `repriced` (its price moved since the person validated it),
`backup-gone` or `backup-repriced`. Anything but `ok` on image or video, and a voice that was chosen and moved, means **ask again**:
say what changed, with the old and the new price.

Then **propose**, do not decide. Read `references/choosing-models.md` for how to pick and how to word it. In one message, for the kinds
that need it (image, video, and voice if the account offers one), give: the proposed **primary**, the proposed **backup**, the price of
one unit of each and what a usual video costs with each. Ask the person to validate or change. When they answer:

```bash
node "$KIT/scripts/studio.mjs" set image <primary-id> <backup-id>
node "$KIT/scripts/studio.mjs" set video <primary-id> <backup-id>
node "$KIT/scripts/studio.mjs" set speech <primary-id> [<backup-id>]     # optional: without it the free local voice is used
```

`set` refuses an id the account does not offer, a model of another kind, and a backup equal to the primary. It saves the price the person
saw, which is what `check` compares against next time. If the account offers a single model of a kind, there is no backup to propose:
say so, and `set` with the primary alone.

**One image model and one video model for a whole video.** They are chosen once, at the storyboard. Changing model between two shots
changes the character's face.

## 2. Storyboard

Take the scenario the person picked (from `tiktok-scout`, or their own idea) and write `storyboard.json` in the working folder, in the format of
`references/storyboard-format.md`: per shot, how long, whether it is a generated clip or a still picture moved at editing, the line spoken, what
the picture shows. Keep the speaking pace honest (about 2.6 words a second) and the whole video to the length the scenario promised. Show the
person the shots in a short list, not the file.

## 3. Quote, then the person's word

```bash
node "$KIT/scripts/studio.mjs" quote storyboard.json
```

It prices one picture per shot, one redo, the seconds of generated clips and the voice, at the **primary** models, and gives a **ceiling**:
what it would cost if everything fell back to the dearer of primary and backup. Give both numbers. The person's answer is not yes or no: it is
often an instruction ("shorter", "drop shot 2", "cheaper"). Change the storyboard, quote again, and say what the change did to the price.
Only an approved quote counts, and only for that storyboard: any later change is quoted again.

If a model fails, retry once, then use the backup **for that kind** and tell the person. If shots already made with the primary would look
different from the ones the backup makes, say so and let them choose: keep the mix, or redo with the backup (quote the redo first).

## 4. Hand over, honestly

Generation is not wired yet. When the quote is approved, keep `storyboard.json` and say exactly that: the storyboard and the approved
quote are saved, and the video will be produced when the server can generate. Do not run any other tool to generate pictures or video with
a key you found somewhere, and never ask for one.

When generation exists, the rest of the flow is: generate with the validated models, edit with ffmpeg (the existing skills
`video-courte-tableau-blanc` and `tiktok-contenu-vertical` hold the editing rules: safe zones, captions, loudness, quality check on the
final file), show the video, take the person's instruction on any shot, and only then send it as a **draft** to the connected TikTok account
for them to publish. Remind them to tick the AI-generated label in TikTok. Never publish.

## Rules

- Prices come from `models` and `check` only. Never state a price you did not read from there, and call an estimate an estimate.
- Never ask for, print or store an API key: there is none to enter.
- Draft only: never publish, send or pay for the person. A quote is not a charge, and nothing is charged by this skill.
- Say what is not done or not verified at the end of every run.
