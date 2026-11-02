# Disabling a provider without deleting it

Settings → **AI Provider & Models** → *Providers*: each provider card has a switch.
Off = the provider cannot be called and its models vanish from every picker. On =
everything comes back as it was (key reference, models, overrides).

## Why it is built this way

DSH has no per-provider off switch (measured on DSH 0.2.0-rc.2: no `enabled` or
`disabled` anywhere in `dsh-llm` or `dsh-llm-pi-ai`). What the engine does guarantee:

- a route exists only while its profile sits in `llm-pi-ai.providers`;
- profiles are re-read on every request, so no restart is needed.

So "disable" means *move the profile out of the settings*, "enable" means *put it back*.
That is a hard block with **zero engine patch** (rule 1 of `AGENTS.md`).

## How

| Step | Disable | Enable |
|---|---|---|
| 1 | `POST /kybernos-models/providers/park` saves the user-layer profile on the host | `POST …/take` reads the saved profile |
| 2 | settings `unset providers.<slug>` | settings `set providers.<slug>` |
| 3 | reload | `POST …/forget` drops the saved copy, reload |

The order is the safety property: **the copy is saved before the route is dropped, and
dropped only after the route is back.** A failure at step 2 forgets the copy (disable) or
leaves it parked (enable); a crash between steps leaves the provider active with a hidden
stale copy, never a lost profile. Revision conflicts reload once and retry once.

The saved copy lives in `$DSH_HOME/kybernos-models/providers-parked.json` (mode 0600). It
holds an env-var *name* (`apiKeyEnv`), never a key, but a profile may carry `headers`, so the
list route (`GET …/providers/parked`) returns slugs, model ids and a date only — never the
profile. Every write route requires a strict same-origin check (plugin routes are served
before DSH's own auth).

## What cannot be disabled here

- a provider the **base layer** declares (an `unset` on the user layer would only reveal
  the base copy): the switch is greyed with an explanation;
- `kybernos` (Kybernos Cloud): `kybernos-cloud` rewrites `providers.kybernos` on every sync,
  so it is locked ("disconnect the account to remove it").

## Things worth knowing

- While disabled, the provider is also absent from DSH's native Models page: the route does
  not exist. Kybernos' own Providers tab keeps showing it, greyed, with a *Disabled* badge.
- A session already pinned to one of its models fails with the engine's `NO_ADAPTER` until
  the provider is enabled again: the confirmation dialog says so.
- The host half (`index.js`) loads only at the next DSH start. Until then the client sees the
  routes answer 404 and shows **no switch** (`KBM.parkHost === false`): it never starts a
  disable it cannot finish.

## Recovery by hand

If the parked file is the only place a profile still lives (e.g. the settings write of an
enable was refused and you want it back right now), open
`$DSH_HOME/kybernos-models/providers-parked.json`, copy `providers.<slug>.profile` into
`llm-pi-ai.providers.<slug>` in your settings file, then delete the entry.

## Tests

- `packages/kybernos-models/test-host.mjs` — the four routes on a fake web server;
- `packages/kybernos-models/test-client.mjs` — the client actions run against the **real**
  host routes and a fake settings service (ordering, rollback, stale copies, conflicts,
  locked routes);
- on the real GUI (read-only): swap the client in the served bundle and fake the host routes,
  as described in `live-testing.md`; every write fails before reaching the settings.
