# Choosing the primary and the backup models

The person validates; you propose. The only source of what exists and what it costs is `studio.mjs models` (the account's own offer, the
price of ONE unit as billed). Nothing else is evidence of a price.

## How to propose, kind by kind

1. **Read the offer.** `models` lists each kind with the unit price and the cost of a usual 30 s video (5 pictures, 20 s of clips, 450 spoken
   characters). Use that estimate to compare: a model that is cheap per second can still be the dearest video.
2. **The primary** is the model you would use today. Without measured notes on quality (none exist yet: the bake-off is still to run), propose
   the **middle** of the price range of the kind, not the cheapest and not the dearest, and say that it is a starting point the person can
   move. If the person has said what matters (cheap, or the best look), follow that.
3. **The backup** is what takes over when the primary fails. It should sit in the **same price band** (not more than about half again the
   primary), so that a failure does not double the bill; if the only other model is much dearer, say so and let the person decide. It is
   never the same model.
4. **One kind with a single model**: say there is no backup to propose, and set the primary alone.
5. **Voice is optional.** If the account offers a speech model, propose it like the others; the person may keep the free local voice
   instead (then do not `set speech`).

## How to word it

One message, short, in the person's language, one line per kind:

> Pictures: **Seedream 5.0** (≈ $0.14 a picture) as primary, **FLUX 3** (≈ $0.19) as backup.
> Video clips: **Wan 3.0** (≈ $0.40 a second) as primary, **Veo 3.1 Fast** (≈ $0.60) as backup.
> A usual 30 s video comes to about $X with the primaries and at most $Y if everything fell back.
> Validate these, or tell me what to change (cheaper, better looking, another model).

Then `set` what they validated. They may change one kind and accept the others. If they ask for a model that is not offered, say it is not
offered by their account and show what is.

## When the choice stops holding

At the next run `check` may say a model is `gone` or `repriced`. Do not carry on with the old choice: say what changed and propose again
the same way. A `repriced` model the person already accepted is still theirs to confirm, because the price they saw is not the price now.

## What is not decided here

Which models are best for a talking character that must keep one face is measured by a small comparison (the same test scene through each
candidate), not guessed from names or from what vendors say. Until that comparison has run, these notes carry no quality ranking, and you
must not invent one.
