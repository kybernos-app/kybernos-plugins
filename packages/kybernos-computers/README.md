# kybernos-computers — cloud computers for agents (host half, phase 1)

Remote execution backend for DSH: the agent can run code in an **ephemeral cloud
sandbox** (an [E2B](https://e2b.dev) microVM) instead of on the local machine. **BYOK**
model — bring your own key: the person brings their E2B key, the compute is billed to
THEIR E2B account, Kybernos manages no quota.

Phase 1 (host half) + configuration: the **host half** — key store, sandbox lifecycle
(start / exec / write / read / stop), automatic TTL, cap on simultaneous sandboxes — with
an exported **Config** (schemastery: `apiKey` role secret, `apiKeyEnv` credential-ref)
that makes the host serve the settings namespace `kybernos-computers`. The **client half**
gives the key two doors:

- **Settings › Cloud computers**: the page the help, the composer menu and the agent's
  error message point to. An « API key » field (stored through the host route
  `/kybernos-computers/key/set`, never read back: only a « configured or not » badge comes
  out), « Save », « Remove the key ».
- a native configuration card in the engine's **Plugins** page (slot `plugins.item`, modelled
  on « Web search »): the same key, written to the credential store through
  `remote.credentials`. Builds of DSH that no longer draw that slot never show it.

**Phase 4: the EMBEDDED agent (Manus model)** — E2B template `kybernos-dsh`
(Dockerfile in `template-dsh/`: node 22 + dsh + settings wired to the Kybernos proxy,
secret injected through envs) and the `computer_task` tool: a mission goes to a microVM
where `dsh headless` runs with the customer's key — the LLM calls are billed to the
Kybernos account, one round trip, no intermediate stdout. Measured traps: local install +
symlink (the E2B builder's `npm -g` breaks the tree), node ≥ 22 (otherwise headless stays
silent), patch of the default model in the `- id:` format.

**Phase 3: the agent tools** — `computer_start`, `computer_exec`,
`computer_write`, `computer_read`, `computer_stop`, `computer_pause` / `computer_resume` (E2B betaPause freeze: CPU not billed, disk kept), `computer_list`, exposed
to the model (same `tools.register` contract as the memory tools of
kybernos-cloud, render in `output.render`): the agent creates and drives
its own microVMs without touching the machine. Left: the composer selector.

## Security

- The E2B key is a **billing secret**: it lives in the credential store
  (`~/.dsh/.credentials.yaml`, 0600) under the reference
  `E2B_API_KEY` — never in the client, never logged, never returned by
  a route (only a `keyPresent` boolean comes out).
- Every route is same-origin (`guarded: true`), never cross-origin.
- Default cap: **4 simultaneous sandboxes**, default TTL **15 min**
  (max 2 h, deadline adjustable per sandbox). The TTL sweeper stops (kills)
  any sandbox whose deadline has passed, even if the process restarted.
- The `@e2b/sdk` SDK is resolved from the bundle's `node_modules`, then the
  profile's; as a last resort it is **auto-installed** in
  `~/.dsh/kybernos-computers/node_modules` (logged). No dependency
  is loaded until an E2B route is called.

## Local routes (all POST unless noted)

| Route | Role |
|---|---|
| `GET  /kybernos-computers/status` | state: key present, SDK available, number of sandboxes |
| `POST /kybernos-computers/key/set` | sets the E2B key (`{"key":"e2b_…"}`) in the credential |
| `POST /kybernos-computers/key/clear` | removes the key (and stops the local sandboxes) |
| `GET  /kybernos-computers/sandboxes` | sandboxes tracked locally (+ liveness check) |
| `POST /kybernos-computers/sandboxes/start` | starts a sandbox (`label?`, `ttlMs?`) |
| `POST /kybernos-computers/sandboxes/exec` | runs a command (`sandboxId`, `command`, `timeoutMs?`) |
| `POST /kybernos-computers/sandboxes/write` | writes a file (`sandboxId`, `path`, `content`) |
| `GET  /kybernos-computers/sandboxes/read` | reads a file (`?sandboxId=&path=`) |
| `POST /kybernos-computers/sandboxes/stop` | stops a sandbox (`{"sandboxId":…,"confirm":true}`) |

## Target architecture (this plugin is brick 1)

```
chat composer ──► environment selector: Desktop | Cloud | E2B …
agent tools (computer_exec, computer_screenshot …) ──► backend-agnostic contract
backends: desktop (cua-driver, already there) · e2b (this bundle) · modal/blaxel (later)
```

## Tests

```bash
npm test          # test-computers-host.mjs — fake SDK, no real key needed
node --check index.js
```
