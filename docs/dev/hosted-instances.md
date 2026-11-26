# Kybernos on a hosted DSH (reverse proxy in front)

A DSH VPS template (Hostinger offers one) or any container platform (Coolify, ...) puts a TLS reverse proxy in front of
`dsh web`. This page says what that changes for the plugins, what was measured, and what is still open.

## What DSH does

- `dsh web` refuses `--host 0.0.0.0` on purpose ("would expose remote code execution to the network"). It listens on
  loopback and the proxy runs on the same machine. In a container, a tiny relay (`socat`) on the exposed port plays that part.
- The public address is declared with `--trusted-host <host[:port]>` (repeatable). DSH's own `/api` fence then accepts it, and
  publishes the list to plugins as `ctx.webRuntime.trustedHosts` (a port-less entry matches the host on any port).

## What the plugins do

DSH serves plugin routes **before** its own authentication, so every bundle guards its routes itself, comparing the request's
`Origin` with the socket's real listening address (`127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>`) and never with the
client-supplied `Host`. Behind a proxy the browser's `Origin` is the public address, so every guarded route answered 403.

Since this change the same guards also accept an authority DSH was told about with `--trusted-host`:

- `kybernos-plugin/trusted-authority.mjs` applies DSH's own matching rule and publishes one predicate on
  `globalThis[Symbol.for('kybernos.trustedAuthority')]` (the core bundle does it at boot; the list is read on every request).
- Each guard adds `|| kbTrusted(u.host)` through one identical helper line. Without the core bundle, or without `--trusted-host`,
  the predicate answers `false` and nothing changes: loopback only.
- `scripts/test-trusted-guards.mjs` fails if a bundle compares an Origin with the loopback list and forgets the predicate.
- The session cookie of the scheduled-tasks route is also looked up under the public authority when it is declared; the cookie
  still has to carry a valid signature from the machine secret.

A foreign page can neither forge nor choose its `Origin`, so accepting the operator-declared authority keeps the model of the
loopback rule. A local program that forges headers was never stopped by an Origin check, here or before.

## What to do on a hosted instance

Use the [Kybernos Gate](../../packages/kybernos-gate/README.md): it is the sign-in page, it proxies to DSH, and it hands the browser
DSH's own cookie, so there is one login. Its README has the server install, the Docker image and the Coolify notes.

1. Start DSH on loopback with the public host: `dsh web --no-open --host 127.0.0.1 --port 3081 --trusted-host dsh.example.com`.
2. Run the gate in front of it (plugin routes answer without the DSH token, so nothing may be exposed without a login).
3. Keep the DSH profile (`~/.dsh`) on a persistent volume if the platform recreates containers.

## DSH's preview notice on a hosted instance

DSH 0.2.0-rc.2 keeps its UI settings in **memory**, not on the host, for a browser whose page address is not loopback
(`dsh-client-ui-settings`: `persistence = ctx.remote.$host.isLoopback ? "host" : "memory"`). Its "Preview Notice" (the
`welcome-notice` entry of the `settings.onboarding` slot) therefore cannot be remembered there: measured with a `.localhost` name,
Continue, reload, and the notice is back, whatever the host setting `ui-settings-general.welcomeNoticeVersion` says.
The core client now shadows that entry (same id, priority -1, renders nothing) when the page is not on loopback. On loopback DSH
remembers the acknowledgement itself and nothing changes. `node scripts/test-hosted-client.mjs` covers the rule.

## Measured (Coolify, DSH 0.2.0-rc.2, container behind a TLS proxy with basic auth)

Before the change, with `Origin: https://<public host>`: `kybernos-auto/state`, `kybernos-hub/state` and
`kybernos-sessions/settings` answered **403**; with `Origin: http://127.0.0.1:<port>` or no Origin they answered 200.

After the change (same instance, DSH started with `--trusted-host <public host>`): the same three routes answer **200** to the public
`Origin`, while `Origin: https://evil.example`, `https://<public host>@evil.example` and a forged `Host` still answer **403**.

The gate was checked on a real isolated `dsh web` (`node scripts/check-gate-live.mjs`): after the password alone, the page, its assets
and `/api` answer like a direct signed-in call, and the same request without the gate's cookie never reaches DSH.

## Open

- Four older routes (`kybernos-memory`, `kybernos-slash`, `kybernos-modeles-locaux`, `kybernos-computers`) still compare the
  Origin with the client-supplied `Host`. They pass behind a proxy that keeps `Host`, but they are the weaker rule and should be
  moved to the socket-address rule in their own change.
- The approved restart (`relancer_dsh`, `scripts/dsh-relance.mjs`) uses `launchctl` or starts a detached `dsh web`; it does not
  know systemd or a container supervisor (the Docker entrypoint leaves a DSH that already answers on its port alone).
- Not yet checked on the real Hostinger template (its DSH version and process manager are not documented); a container behind a
  TLS proxy (`packages/kybernos-gate/docker/`) is the stand-in. That template has its own proxy and sign-in, so the gate is not for it.
- `kybernos-install` starts its own `dsh web` on a free port to verify the boot; on a host where DSH is already running that is
  a second process.
