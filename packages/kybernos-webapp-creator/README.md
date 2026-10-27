# kybernos-webapp-creator

Create small web apps from the chat, each with its own mini SQLite base, and run
them on this computer. Publishing on the person's own domain (`*.kaby.app`) is a
later batch.

This bundle is the **shell**; the three bundled skills are the **brain**:

| Skill | Role |
|---|---|
| `skills/webapp-brief` | a few closed questions → the `webapp.json` brief |
| `skills/webapp-build` | mockup first (read as images), mini base (`mini-app-pack` contract), code, then the five-point UI pass |
| `skills/webapp-publish` | slug, access mode, external smoke test (the next batch) |

At boot the skills are seeded into `<DSH home>/skills/` — **never over a file
that already exists**, so a skill the person edited is theirs.

## The app contract

An app is one folder under `~/.dsh/kybers/<slug>/` (the folder name **is** the
slug):

- `webapp.json` — the brief (name, slug, pages, entities, `acces: cle|public`,
  `donnees: personnel|none`);
- `donnees.sqlite` — the mini base, visible in the Database tab (see the
  `mini-app-pack` skill for the `pack` manifest);
- `server.js` — reads `PORT` from the environment and listens on `127.0.0.1`.
  Nothing else is ever started.
- `logs/server.log` — appended by the runtime; `.runtime.json` holds the live
  state (pid, port) and only ever names a process this runtime started.

## Routes (host half)

| Route | What it does |
|---|---|
| `GET /kybernos-webapp-creator/state` | apps, their status, and the folders with a broken brief |
| `POST /kybernos-webapp-creator/create` | scaffold `<slug>/webapp.json` |
| `POST /kybernos-webapp-creator/start` | start `server.js` on a free port (4400–4499) |
| `POST /kybernos-webapp-creator/stop` | SIGTERM, then SIGKILL after a bounded wait |
| `GET /kybernos-webapp-creator/logs` | the last lines of the app log |

Write routes carry DSH's **signed session cookie** (`session-guard.mjs`, the
shared byte-identical copy) on top of the strict same-origin rule; every route is
behind the host fence (loopback, plus the authorities declared with
`--trusted-host`).

## Permissions

`host.routes:/kybernos-webapp-creator:write`, `fs.read:dsh-home`,
`fs.write:dsh-home`, `exec:node` — the runtime spawns one `node` process per app,
nothing else.

## Not here yet (honest list)

- the **Webapps pane** (the mockup lives in
  `docs/handoff/webapp-creator/maquette-v1/`, awaiting its visual review);
- **publishing** on `*.kaby.app` (batch 3: slug reservation, wildcard TLS,
  proxy, link key);
- version history and rollback (batch 4).

## Tests

`node test-host.mjs` (slugs, discovery, scaffolding, route table, write guard)
and `node test-runtime.mjs` (a real app process: start → serve → stop, crash and
refusal paths). Both are picked up by `scripts/run-all-tests.mjs`.
