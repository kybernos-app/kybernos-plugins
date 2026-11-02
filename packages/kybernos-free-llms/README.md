# @local/kybernos-free-llms — « Free LLMs »

Wires **free** language models into DSH, with no account and no API key, through the
free tier of **OpenCode Zen**. Two halves:

- **host (`index.js`)** — a local gateway (`/free-llms/v1/*`) that receives an ordinary
  OpenAI request, **rewrites** it to satisfy the contract of the free tier, forwards it
  to `opencode.ai`, and returns the answer as OpenAI-compatible SSE. The `opencode-free`
  provider points at this gateway.
- **client (`client.js`)** — the « Free LLMs » panel (a dedicated Settings section):
  lists the free models, wires them into DSH, and probes the health of the lock.

## Why a gateway (and not just a provider)

The free tier of OpenCode is locked behind a **strict request contract**: without it, it
answers `403 FreeTierError`. Measured barrier by barrier (2026-10-12, live bisection) —
all four must hold **at the same time**:

| Barrier | Measurement |
|---|---|
| `User-Agent: opencode/<version>` (≥ 1.17) | required (426 below) |
| `x-opencode-session` = `ses_` + 12 hex + 14 base62 | the shape is validated, not the value |
| `stream: true` in the body | `stream:false` → 403 |
| non-empty `tools` array, **real names** `{bash, glob, grep, read}` | `[]` → 403, made-up names → 403, the quartet → 200 |

DSH's `openai-completions` adapter injects neither `tools` nor a per-request session —
hence the gateway, which does exactly that rewrite (`gateway-contract.mjs`) and forwards
the rest **as is**. No engine patch.

## What the bundle NEVER writes

No configuration file on the host: `cordis.patch.yml` only inserts the plugin in the
stack. The `opencode-free` route of the `llm-pi-ai` namespace is written **by the GUI**
(`remote.settings.mutate`), like the native Models page. The only trace on disk is the
activation marker `~/.dsh/kybernos/free-llms.json`.

## The two safeguards (validated design)

1. **Privacy**: Zen's terms say that prompts sent to the free models **may be retained
   for training**. Wiring is **never silent**: the person must tick « I understand… »
   before « Wire ».
2. **No single point of failure**: this is **one provider among others**. Automatic
   activation on first run (`/free-llms/auto-enable`) only fires if the person **has no
   model that already works** (no cloud, no key, no local) **and** has acknowledged
   point 1.

## Accepted fragility

OpenCode hardens this tier regularly (the switch of 17/09). The panel simulates nothing:
if the lock refuses, the probe says so in plain words and shows the code (`free_tier_locked`). A model whose
wire protocol is not served reports `model_protocol_unsupported` (e.g. `jev-1.13-free`,
`muse-spark-*` on 12/10) — that is a property of the model, not a lock that can be
crossed.

## Checks

```bash
node packages/kybernos-free-llms/test-contract.mjs    # 18 tests — contract, profile, activation
node packages/kybernos-free-llms/test-gateway.mjs     # 5 tests  — rewrite + SSE folding
node packages/kybernos-free-llms/poc/poc-pont.mjs     # live PoC: the real pi-ai wire to opencode.ai
```

The PoC (`poc/poc-pont.mjs`) is the end-to-end proof: it sends the **real**
`openai-completions` serialisation of pi-ai (the one DSH uses) to the free tier and gets
real answers. It runs on `127.0.0.1:8848`:

```bash
curl -s localhost:8848/v1/models
curl -s localhost:8848/v1/chat/completions -H 'content-type: application/json' \
  -d '{"model":"mimo-v2.6-flash-free","messages":[{"role":"user","content":"Say hello."}],"max_tokens":50}'
```

## Host routes

| Route | Role |
|---|---|
| `POST /free-llms/v1/chat/completions` | gateway → opencode.ai (rewritten + SSE) |
| `GET /free-llms/v1/models` | live free list (OpenAI `list`) |
| `GET /free-llms/status` | list + activation state (the panel) |
| `GET /free-llms/health?model=` | probes the full contract on one model |
| `POST /free-llms/enable` | wires the route (`acknowledged: true` required) |
| `POST /free-llms/disable` | removes the route (keeps the acknowledgement) |
| `POST /free-llms/auto-enable` | first run, if no custom model + acknowledgement |
