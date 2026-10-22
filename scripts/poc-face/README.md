# Face provider proof of concept (spike, not shipped)

Question: which third-party service draws the assistant's face on a call from ONE image, fast enough and well enough?
`poc_face.py` runs one provider at a time on a throw-away LiveKit room and measures what decides it (see its docstring).

## Set up once

```bash
uv venv --python 3.12 /path/to/poc-venv
uv pip install --python /path/to/poc-venv/bin/python livekit-agents==1.8.3 \
  livekit-plugins-anam==1.8.3 livekit-plugins-lemonslice==1.8.3 livekit-plugins-runway==1.8.3 livekit-plugins-liveavatar==1.8.3 numpy
```

The versions are the call worker's own (`livekit-agents 1.8.3`), so a result here holds for `packages/kybernos-call`.
Keys go in `<DSH home>/kybernos/livekit.env` (chmod 600) or the environment; the script never prints them.

| Provider | Variables | Notes |
|---|---|---|
| liveavatar | `LIVEAVATAR_API_KEY`, `LIVEAVATAR_AVATAR_ID` (+ `LIVEAVATAR_SANDBOX=1` for the free test) | catalogue face: the baseline |
| anam | `ANAM_API_KEY` (+ `ANAM_AVATAR_ID` to reuse a face) | `--image` makes the face first (about 2 minutes) |
| lemonslice | `LEMONSLICE_API_KEY` | API needs a paid plan; the image is a session argument |
| runway | `RUNWAYML_API_SECRET`, `RUNWAY_AVATAR_ID` | create the character in the dashboard first |

Plus the line: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.

## Run

```bash
python poc_face.py anam --image portrait.png --out ./out
```

It writes `out/<provider>.json` and three PNGs (idle, two speaking moments). Judge the pictures by eye: the numbers say how fast and
how alive the mouth is, not how good the face looks. Test with three images: a generated illustration, a stylised cartoon, and a
photo of yourself (never someone else's face: the providers' terms and ours forbid it).

Media stays out of git (AGENTS.md rule 4): `out/` is yours to keep elsewhere.
