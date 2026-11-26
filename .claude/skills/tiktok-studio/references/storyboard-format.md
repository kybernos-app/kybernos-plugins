# storyboard.json

The file `studio.mjs quote` reads. One object, written in the working folder:

```json
{
  "title": "Your AI agent asks before it acts",
  "voice": { "chars": 420 },
  "shots": [
    { "id": 1, "seconds": 5, "motion": "clip",  "line": "Your AI agent just emailed your whole customer list. Did you approve that?", "picture": "Kaby, surprised, in front of a scrolling list of customers" },
    { "id": 2, "seconds": 6, "motion": "clip",  "line": "Most agents run first and ask never.",                                      "picture": "Kaby shakes their head, the board shows « executed » in red" },
    { "id": 4, "seconds": 7, "motion": "still", "line": "Allow. Refuse. Or allow for this task.",                                   "picture": "A capture of the approval screen with its three buttons" }
  ]
}
```

- `title`: free text.
- `voice.chars`: how many characters are spoken in all (the lines added up). Leave `voice` out for a video with no voice-over.
- `shots`: at most 40, in the order they play. Each has:
  - `id`: its own, any number or word. A shot keeps its id when others move, so an instruction like « redo shot 3 » stays true.
  - `seconds`: how long it stays on screen, over 0 and at most 30.
  - `motion`: `clip` is a generated video clip (priced by the second); `still` is a picture moved at editing (zoom, pan: no video model).
    A shot that shows the product's own screen is a `still`.
  - `line` (optional): what is said over it. At about 2.6 words a second, a line must fit its `seconds`.
  - `picture` (optional): what the picture shows, in a sentence. It is what the picture model is asked for.

Every shot costs one picture (the first frame of a clip, or the shot itself). A `clip` shot also costs its `seconds` of video. The quote
does not price the editing: it runs on the person's machine and costs nothing.
