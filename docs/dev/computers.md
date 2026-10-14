# The computer image (cloud computers)

A **cloud computer** is a DSH with the Kybernos suite that keeps running when its owner's laptop is off: it fires automations on a
schedule and on a webhook. The server side (the registry, the lifecycle, the meter, the restricted token and the Fly driver) is in the
private server repository (ADR 0052 and its runbook). This page is the contract the **image** keeps: what it is made of, what it is
given, what it listens on, and how it was checked.

## What the image is

`services/computer-image/` is one thin layer on the hosted Kybernos image of
[`packages/kybernos-gate/docker`](../../packages/kybernos-gate/docker/Dockerfile) (DSH, the plugins at a release tag, the gate in front
of DSH):

- the gate listens on **3080** (the one port the platform exposes) and asks for a password; DSH listens on loopback **3081**;
- an entrypoint that runs as root for one reason (the volume is mounted root-owned) and then runs the image's own entrypoint as the
  unprivileged `node` user, with the profile and the workspace on the volume.

```sh
# Fly runs amd64. On Apple Silicon the default is arm64, which Fly cannot run: say the platform.
docker buildx build --platform linux/amd64 -t kybernos-computer-base:<tag> \
  --build-arg DSH_VER=0.2.1-alpha.2 --build-arg KB_REF=v1.0.0-beta.8 packages/kybernos-gate/docker
docker buildx build --platform linux/amd64 -t kybernos-computer:<tag> \
  --build-arg BASE=kybernos-computer-base:<tag> services/computer-image
```

`KB_REF` is a release tag (never `dev`), and `DSH_VER` is inside the range of `dsh-compat.json` (the tag's own file must list it: the
`v1.0.0-beta.6` tag stops at `0.2.0-rc.2`). 563 MB, and the plugins are cloned at build time: nothing in the machine fetches code later.

## What the platform gives it

| Variable | What it is |
|---|---|
| `KYBERNOS_API`, `KYBERNOS_COMPUTER_ID`, `KYBERNOS_COMPUTER_TOKEN` | its server, its id and its **restricted** token (a device token of its owner that the server holds to a short list of routes). Nothing else secret: a connector's credential, a key and the owner's password never enter the machine. |
| `KYBERNOS_PUBLIC_HOST` | its own host name: given to `dsh web --trusted-host`, so that DSH's fence and the plugins' route guards accept the platform's address |
| `KYBERNOS_GATE_PASSWORD` or `_HASH` | the gate refuses to start without one (the entry of a person into the page is the platform's single-use ticket, a later step) |
| `KYBERNOS_EGRESS_MODE`, `KYBERNOS_EGRESS_ALLOW` | the network policy of the computer. **The image has no guard that holds it yet**: Fly offers no control of outbound traffic, so until the guard exists the mode is declared and not held |
| `DSH_HOME`, `KYBERNOS_WORKSPACE` | set by the entrypoint to `/data/dsh` and `/data/work` on the volume, so that sessions, memory, skills and automations survive a restart, a cold start and a wake |

## What it was checked to do

On the real platform (Fly.io, `ams`, `shared-cpu-1x` 2 GB, one 2 GB volume, 2026-10-14; one sample each, direction and not a guarantee),
created and driven by the server's driver (`pnpm computers:live` in the server repository):

| Step | Time |
|---|---|
| create the app, address, volume and machine, image pulled and machine started | 27 to 37 s (first pull of the 563 MB image) |
| from started to the gate answering `/__gate/health` | 0.1 to 7.6 s |
| sign in through the gate, then the suite's own route (`POST /kybernos/tasks`, `list`) answers | 1.7 to 3.2 s |
| suspend / resume | 3.0 to 3.7 s / 0.5 to 0.7 s |
| the route answers again after the wake | 0.1 s |
| an automation made before a suspend is still there after the wake | yes |
| a run due **while asleep** is fired by the computer's own scheduler after the wake | 5.4 s after the wake call (`history[0].status: "fired"`) |

## What a real run costs

Measured on this image (DSH 0.2.1-alpha.2, the suite at `v1.0.0-beta.8`, the `agent-preset` the suite installs, **no desktop or browser
driver**), with GLM-5.3 on the z.ai coding plan, 2026-10-14; the same image run in Docker on a Mac (the tokens are the model's, not the
host's), an automation made through the page and fired with `run-now`, its tokens read from the session's own projection:

| Run | Steps | Model time | Uncached input | Cache read | Output |
|---|---|---|---|---|---|
| « Reply with the single word OK », **first call of the day** | 1 | 5.2 s | **14,779** | 0 | 3 |
| the same, a minute later | 1 | 4.5 to 4.7 s | 59 to 620 | 14,144 to 14,720 | 3 |
| 30 CSV rows in the prompt, total revenue, best region and top product by a script | 2 | 15.4 s | 1,318 | 30,144 | 754 |

The answer of the third run was exactly the gold one. **A trivial run sends about 14.8 k input tokens**: that is the prompt (the
system prompt and the tool definitions), not the task; the study's own full profile sends 47.4 k for the same one-line task.
At z.ai's API list price (1.40 USD in, 4.40 out, 0.26 cache read per million tokens; models.dev) that is about **0.021 USD cold, 0.005
warm, 0.013 for the CSV run**; a 15-minute cron is 2,880 runs a month, 13 to 60 USD a month of model cost at list price depending on
whether the cache is still warm between two runs. The coding plan is a flat fee and lists 0.

## Traps met by the first real runs

- **A run that needs a tool waits for ever on the default permission preset** (`workspace-write`, approval `ask`): the session sat open,
  one tool step done and the second never started, with nobody at the prompt. `approvals: auto` on the automation does not help (it only
  declines to force the asking preset). The image therefore sets `defaultPreset: danger-full-access` (approval `never`): the machine is the
  boundary. An automation that wants a person's OK is the server's approval inbox (a later step), not a prompt.
- **The plugin's automations route does not take a `model`**: a task is fired with the profile's default model (`agent-default-model`),
  so the image's profile decides which model a computer uses.

**Not checked:** a cron over days, the meter against the platform's own, the machine calling its server (`ready`, `heartbeat`,
`schedule`, `runs`: the server must be reachable from Fly), the model route of the platform itself (`KYBERNOS_API` with the
computer's token as the key: the run above used a provider key), and the egress guard.

## Traps met

- **amd64.** An image built on Apple Silicon without `--platform linux/amd64` does not start on Fly.
- **The machine creation call is slow the first time**: Fly answers it once the image is there (more than 20 s for an image it has not
  seen), and its `wait` call is a long poll. A client timeout of 20 s reports an unreachable platform for a machine that was made.
- **A `start` right after a `suspend` can answer 409** (the machine still holds its lease for a moment): ask again a second or two later.
- **The gate's sign-in and the plugins' routes refuse a request with no `Origin`, or with another one**: a client sends
  `Origin: https://<its host>`, exactly the host the machine was told in `KYBERNOS_PUBLIC_HOST`.
- **Name resolution.** A fresh `*.fly.dev` name can be cached as absent by a local resolver for a while: a check goes by address
  (`curl --resolve`).
- **The registry.** `docker login registry.fly.io` takes an organisation token as the password; it lands in the Docker credential
  store: `docker logout registry.fly.io` when the push is done. The repository name is an app of the organisation.
