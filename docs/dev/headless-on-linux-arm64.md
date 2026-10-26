# DSH, the Kybernos plugins and `dsh headless` on a Debian arm64 (glibc) userland

Measured 2026-10-23 in Linux arm64 containers on an Apple Silicon Mac (Docker Desktop, `--platform linux/arm64`, no emulation). This is the userland a phone
runs under Termux + proot-distro (Debian arm64) or in the Android Linux Terminal VM. It is **not** a test on a phone: see "What this does not prove".

## Result

Everything installs and runs, with no npm or apt failure, as a normal user and as root, from a Debian with no Node at all.

| What | Measured |
|---|---|
| Userland | Debian 12 (bookworm), glibc 2.36, aarch64, Node v22.23.4 (the engine needs 22.19 or later) |
| Engine | `@deepseek-ai/dsh@0.2.1-rc.2` (max of `dsh-compat.json`), 615 npm packages, 53 s; native packages found for linux-arm64: sherpa-onnx, node-addon-require-builtin, ripgrep, node-pty prebuilds |
| Plugins | local `dev` tip 38ea873 (`./kybernos-install`: 10 s, boot check passed, 45 bundles linked in the web profile) |
| Whole script in a clean `debian:bookworm-slim` (apt + Node tarball + engine + pnpm + install + headless profile), as root | 56 s |
| `dsh headless`, plain engine | 25 tools, 0.71 s, peak RSS 242 MB |
| `dsh headless` + `@local/kybernos` + `@local/kybernos-cloud` | 34 tools (25 + 9), 0.73 to 0.88 s, 238 to 249 MB, exit 0, answer on stdout |
| Same, limited to 1 CPU and 1 GiB (`docker update`) | 1.2 to 1.4 s, 215 to 221 MB |
| Second turn with the same `--session-id` | exit 0; the stub saw `system, user x4, assistant:2 (the first OK), user` : the first turn is replayed |
| Tools really execute | `bash` returned `headless-ok`; `grep` ran ripgrep; `automation_home`, `memory_search`, `kaby_journal` answered their normal "no account / empty" replies |
| `dsh web` (full suite, idle) | address printed after 2 s, RSS 358 MB at 2 s, 377 MB peak over 70 s; bare address 401, with the token 303 then cookie 200; plugin routes `/kybernos-maintenance/state` and `/kybernos-sessions/state` answer 200 |
| Disk | engine tree 918 MB, npm cache 285 MB (deletable), plugins checkout 54 MB, `~/.dsh` ~37 MB, Node 117 MB, g++ 102 MB |

The model was a stand-in OpenAI-compatible server (`headless-stub`, in the container) that logs the tools it is offered; no real model was called.

## What went wrong, and what was done about it

- npm / apt: nothing failed. The recipe of `packages/kybernos-gate/docker/Dockerfile` replays as it is.
- Debian's own `nodejs` is 18: the script downloads the Node 22 `linux-arm64` tarball from nodejs.org and checks it against `SHASUMS256.txt` (same host, so a transport check, not a signature).
- `/usr/bin/time` is not in the slim images (apt package `time`); only needed to measure.
- **Found, not fixed:** `@local/kybernos` prints two lines with `console.log` at start (`[kybers] kybernos.calls projection registered ...`, `[kybers] retryPolicy: ceiling ...`,
  `packages/kybernos-plugin/index.js`). Headless writes the answer to stdout, so they land in front of the answer and in front of the first `--json` event: a supervisor
  that parses stdout must skip non-JSON lines, or the plugin should log to stderr.
- The `--session-id` of a first run is only known from its `--json` output (`{"type":"session","sessionId":...}`); an unknown id is an error.
- A boot line `Config not declared (schemastery not found)` from `kybernos-computers` and `defineTool not found` from `kybernos-relance` appear; they are in the web boot log and did not stop anything (not compared with the Mac).

## Commands that worked, in order

```bash
# base: node:22-slim arm64 (or debian:bookworm-slim + Node 22.19+)
apt-get install -y ca-certificates curl git ripgrep procps python3 make g++
npm install -g @deepseek-ai/dsh@0.2.1-rc.2 --allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs --no-audit --no-fund
npm install -g pnpm
timeout 60 dsh web --no-open --port 0        # once, so ~/.dsh/profiles/web exists
cd /opt/kybernos-plugins && ./kybernos-install
dsh headless --help                          # creates ~/.dsh/profiles/headless
# profile headless-kyb = copy of headless + bundles @local/kybernos, @local/kybernos-cloud (package.json, node_modules/@local/* links)
dsh --profile headless-kyb --json "task"     # then --session-id <id> to continue
```

`scripts/install-linux-arm64.sh` does all of it (Node included) and was run once from a clean bookworm container as root.

## Replay on an Android 16 emulator (2026-10-24)

Same kit, run inside an arm64 Android 16 emulator (kernel 6.6, 4 GB, SELinux enforcing): Termux 0.118.3 + proot-distro 5.10.2 + Debian 13 (glibc 2.41). Not a phone: no battery, no vendor SELinux policy, a Mac core.

- `scripts/install-linux-arm64.sh` installs as it is, without a compiler: 247 s (56 s on the Mac container; the engine's `npm install` alone 3 min).
- File-system rules: hard links, symlinks, rename-over, exclusive create all work in the proot-distro guest, so the two engine patches the Android APK of dphmoblie ships for `link(2)` were not needed here.
- `dsh headless`: 8.8 to 9.5 s (0.8 s on the Mac), 248 MB, 34 tools, resume works. A process spawn costs x1.5 in proot, reading 3000 files x3.9.
- `dsh web`: ready in 16.5 s, 347 to 364 MB, plugin routes 200; the onboarding wizard renders in Chrome (paste the token address in the address bar: opened through an Android intent it answers « authentication required »).
- **The `bash` tool is refused** in the default `workspace-write` mode (no bubblewrap, `landlock_create_ruleset` returns ENOSYS under proot). `DSH_PERMISSION_MODE=danger-full-access` works; so does a config-only override (sandbox `danger-full-access` with approval `ask`); a custom mode name breaks the `sandboxPolicy` service. Whether the web UI asks before running is not verified.
- Survival: screen off 4 min, app in the background 4 min and forced Doze 3 min: alive. **45 extra child processes: Android killed `dsh web`** (« Trimming phantom processes », 22 kills); with `settings_enable_monitor_phantom_procs=false` everything survived. `dsh web` idle counts ~8 processes for Android; the limit is 32 per device.

## What this does not prove

- On a real phone: battery and thermal throttling, a vendor ROM's SELinux rules (upstream documents ROMs that forbid links in app data), the Linux Terminal VM's own memory ceiling, storage on a phone; the emulator covers proot's cost, the phantom process killer and Doze only (see above).
- A real phone CPU and RAM: the container shares an M-series core; the 1 CPU / 1 GiB run only shows the engine fits that budget, not how slow a phone is.
- A real model, long sessions, approvals and permission presets beyond `echo`, the reporter or the scheduler (they live in `dsh web`; a headless run ends with its task).
- `node-pty` and the sandbox (`dsh-subprocess-local`) under proot; sherpa-onnx (local speech) was present but not run.
- Network behaviour (mobile data, sleeping radio) and a reverse-proxied or paired phone link.
