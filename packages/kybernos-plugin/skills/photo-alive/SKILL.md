---
name: photo-alive
description: Brings an old family photograph back to life as a short film. The worn print is shown first, a light sweeps over it and leaves a sharp high-definition restoration, then the people move for real and speak a line in the person's own language. Restores the photo, shows the restored picture for approval before any clip is paid for, animates it, and joins the opening and the clip with ffmpeg. Says plainly when generation is not available yet.
whenToUse: The person wants an old, faded, scratched or blurry photograph (a family photo, a grandparents' portrait, a street scene from the past) brought to life, animated or restored and then animated - typically the "Old photo, alive" example of the new-chat page. Use this skill instead of video-creator for that example; video-creator stays for every other video.
---

# Photo, alive

Speak the person's language in the chat, and make the film in it too: the spoken line, the caption and the label are written in the language the person writes to you, never in English by default. Everything below is written in English because you read it.
You make ONE film per conversation. Ask before you build, show before you spend, and never pretend to have made something you did not make.

The film has three parts, always in this order:

1. **The print**: the old photograph as it is, for about 1.5 seconds, with a small label (place and year).
2. **The restoration**: a light bar sweeps from left to right and leaves behind the same picture in sharp high definition (faces clear, fabric and objects detailed). About 1.5 seconds.
3. **The film**: the restored picture comes to life for 5 seconds (up to 15, in shots of 5): people really move, a voice speaks a short line, the sounds of the place are heard.

The idea that makes it work: the clip starts from the RESTORED picture, never from the worn one. A video model animates detail it is given; from a blurry print it invents blur.

## 1. Ask, in ONE message

- the old photograph (a path in the project: ask for it or have it attached) and, if they know them, the place, the year and who is in it;
- the small story: what happens right after the shutter clicked (children run off, a dog barks, someone calls, a hat goes up). Offer two ideas if they have none;
- the language of the voice (the language they write in, unless they say otherwise).

The photograph must be theirs, a family photograph or one they have the right to use. Say once, in a line, that the picture is sent to the image and video models' provider, which may keep it. Do not go on without a yes.

Write the spoken line yourself: ONE short sentence per shot (4 seconds at most), in their language, in the mouth of someone who is really in the picture (a grandmother calling the children, a fishmonger calling out). When the film has several shots, write the lines first and show them. Ask for a change before anything is generated, not after.

## 2. The models: read them, never guess them

```bash
curl -s "http://127.0.0.1:${DSH_WEB_PORT:-3080}/kybernos-cloud/models"
```

The answer is `{"connected": true|false, "models": {"creation": [{"id", "name", "kind", "unit", "usd"}]}}`. You need ONE model of kind `image` that edits a picture (restoration) and ONE of kind `video` that starts from a picture. Prices come from this answer only: `usd` is the price of one `unit` (an image, a second). Add the two and call it an estimate; a video model at 1080p costs about three times its price at 768p, so say which resolution you counted. Prefer the models Kybernos offers; do not rank models from their names.

- `connected` is false, `creation` is empty, or no model of a kind you need is there: **the film cannot be made yet**. Go to section 6.
- One video model for the whole film: changing model between two shots changes the faces.

## 3. Restore, then ask

Send the old photograph and this request to the image model (adapt the nouns to the photograph; keep the last sentence):

> Restore this old photograph into a sharp, high-definition photograph. Remove the border, the scratches, the dust, the creases and the grain. Make every face clear and natural, with the same expressions and normal-sized features, and sharpen the clothes, the objects, the ground and the background. Keep exactly the same people, the same poses and the same composition. Keep it black and white with a warm sepia tone.

Look at the result before showing it. Compare with the original: the same people (no one added, no one gone), the same poses, no beautified or changed face, no large teeth. If one of these fails, redo it once with the failure named in the request ("keep the lips closed as in the original"). The model may colour the picture: turn it back with ffmpeg, which keeps the look of the period:

```bash
ffmpeg -y -i restored.png -frames:v 1 -update 1 -vf "format=gray,format=rgb24,colorchannelmixer=rr=.95:rg=.4:rb=.1:gr=.78:gg=.34:gb=.08:br=.55:bg=.22:bb=.05" restored-sepia.png
```

**Show the restored picture next to the original and wait for a yes.** It is the cheapest thing to change. Redo at most twice. Do not start the clip before the yes and before they have seen the estimate.

## 4. The clip

Cut the restored picture to 16:9 and make it small enough to be sent with the request (about 200 KB; a bigger picture is refused). Raise `-q:v` (5, 6, 7...) until the file is under 215 KB:

```bash
ffmpeg -y -i restored-sepia.png -frames:v 1 -update 1 -vf "crop='min(iw,ih*16/9)':'min(ih,iw*9/16)',scale=1600:900:flags=lanczos" -q:v 5 first.jpg && wc -c first.jpg
```

Ask the video model for the highest resolution it offers up to 1080p, 5 seconds, 16:9, and its best prompt-quality option. Send `first.jpg` and a prompt written like this (one movement per person, nothing abstract):

> The restored photograph of <the scene>, same people, same framing at first, comes to life as a sharp, clean, high-definition film in black and white with a warm sepia tone. Every fine detail stays crisp. The people really move across the scene: after a heartbeat of holding the pose, <who does what, with real displacement: the children run toward the lake and the dog bounds after them, the father waves his hat and takes a few steps, the grandfather gets up>. Faces keep their exact natural proportions, with gentle closed-lip smiles and small natural teeth, never exaggerated mouths. <Who> calls out in <the person's language>, clearly: '<the line>'. Sound: <the sounds of the place: birds, a breeze, footsteps, a dog barking, a crowd>. No music. No film grain, no flicker, no blur. Camera: locked, with a very slow push-in. No text on screen.

Notes that came from real tests: the model speaks the line written in quotes (any language), so write it exactly; text on screen is never asked of the model (you add it yourself); "No music." keeps the sound clean so yours can be added; a sentence that asks for a big laugh gives oversized teeth, so ask for smiles; people who are told to "move a little" hardly move, so name the displacement.

For a longer film, start the next shot from the LAST frame of the one before, with its own line, so the cut is invisible:

```bash
ffmpeg -y -sseof -0.15 -i shot1.mp4 -frames:v 1 -update 1 -vf "scale=1600:-2" -q:v 5 last.jpg
```

Show a still of the clip (`ffmpeg -ss 2.5 -i clip.mp4 -frames:v 1 -update 1 still.png`) and take the person's instruction ("faster", "the grandfather should stand up"). Redo at most twice.

## 5. The opening and the join (ffmpeg, nothing is paid here)

You need ffmpeg. `ffmpeg -version` tells; without it, give the person the clip alone, say that the opening could not be made, and say how to install it.

Read the clip's size (`ffmpeg -i clip.mp4 2>&1 | grep Stream`, for example 1890x1080) and cut its first picture, which the opening must end on so that the join cannot be seen:

```bash
W=1890; H=1080
ffmpeg -y -i clip.mp4 -frames:v 1 -update 1 hd-first.png
ffmpeg -y -loop 1 -framerate 24 -t 3 -i old.jpg -loop 1 -framerate 24 -t 3 -i hd-first.png \
  -f lavfi -t 3 -i "anoisesrc=d=3:c=pink:a=0.5:r=48000" \
  -filter_complex "[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,format=gbrp[o];[1:v]scale=${W}:${H},setsar=1,format=gbrp[h];[o][h]blend=all_expr='st(0,clip((T-1.5)/1.3,0,1));st(0,ld(0)*ld(0)*(3-2*ld(0)));st(1,-140+(W+280)*ld(0));st(2,clip((ld(1)-X)/4,0,1));st(3,A*(1-ld(2))+B*ld(2));st(3,ld(3)+(255-ld(3))*0.6*exp(-pow(X-ld(1),2)/2888)*gt(ld(0),0)*lt(ld(0),1));ld(3)',scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v];[2:a]highpass=f=1200,lowpass=f=7000,volume=0.8,afade=t=in:st=1.45:d=0.5,afade=t=out:st=2.2:d=0.7,pan=stereo|c0=c0|c1=c0,aresample=48000[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 16 -preset slow -c:a aac -b:a 128k -shortest reveal.mp4
```

`old.jpg` is the person's photograph as it is. The sweep starts at 1.5 s and ends at 2.8 s. Then join the opening and the clip with a quarter-second cross-fade (the picture is the same on both sides) and keep the sound of the clip:

```bash
ffmpeg -y -i reveal.mp4 -i clip.mp4 -filter_complex "[0:v][1:v]xfade=transition=fade:duration=0.25:offset=2.75[v];[0:a]aresample=48000[a0];[1:a]aresample=48000[a1];[a0][a1]acrossfade=d=0.25[a]" -map "[v]" -map "[a]" -c:v libx264 -pix_fmt yuv420p -crf 20 -preset slow -maxrate 4500k -bufsize 9000k -c:a aac -b:a 128k -movflags +faststart film.mp4
```

The two files must have the same size, which they do when `W` and `H` are the clip's. Several shots: join them one after the other the same way (`offset` = length of what comes before minus 0.25).

**The label and the caption**, in the person's language: write `captions.srt` with the label at the top for the first 1.5 seconds (`{\an8}SUMMER 1952`, place and year, from what they told you) and the spoken line at the bottom while it is heard (about 2.7 to 4.7 seconds into the clip; the clip starts 2.75 seconds into the film). Burn it in, then check one picture of each cue:

```bash
ffmpeg -y -i film.mp4 -vf "subtitles=captions.srt:force_style='FontSize=22,Outline=2,Shadow=0,MarginV=34'" -c:v libx264 -pix_fmt yuv420p -crf 20 -preset slow -c:a copy -movflags +faststart film-final.mp4
```

Look at one picture of the print, one of the sweep, one of the first second of the clip and one of the end (`ffmpeg -ss 0.8 -i film-final.mp4 -frames:v 1 -update 1 check.png`): the label is readable, the sweep is smooth, the clip starts exactly on the restored picture. Save the film in the project (`<name>.mp4`) next to the original and the restored picture, and tell the person where they are. A shelf clip is kept under 6 MB; if the film is heavier, raise `-crf` (24, 26).

## 6. When generation is not available

Look at your tools and at section 2. If no image model that edits a picture, or no video model that starts from a picture, is offered by the account, **the film cannot be made yet**. Then:

1. Make what does not need a model: the first-frame crop, the label and caption text, and the opening if the person gave you a restored picture of their own.
2. Write `photo-alive-brief.md` in the project: the photograph's path, place, year and story; the language; the lines; the restoration request of section 3; the clip prompt of section 4 with the movement of each person; the shape and the length; the models the account will need.
3. Say in two lines what is saved and that the film will be produced when generation is wired. Do not run any other tool to generate it, do not use a key you found somewhere, never ask for one.

## Rules

- Never generate, spend or send the photograph before the person said yes to sending it, to the restored picture and to the estimate.
- Prices and model ids come from the models answer only.
- Never ask for, print or store an API key.
- Never add a person, change a face or tidy a story the photograph does not tell: the film shows the photograph's people, moving.
- A photograph of someone else's family needs their yes; if the person is not sure the photograph is theirs to use, stop.
- Remind the person that a film made with AI should be labelled as such when they publish it.
- End every run by saying what is made, what is saved, and what is not done.
