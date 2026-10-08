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

1. Start DSH with the public host: `dsh web --no-open --trusted-host dsh.example.com`.
2. Put authentication on the proxy (HTTP basic auth, SSO, an IP allow-list): plugin routes answer without the DSH token.
3. Keep the DSH profile on a persistent volume if the platform recreates containers.

## Measured (Coolify, DSH 0.2.0-rc.2, container behind a TLS proxy with basic auth)

Before the change, with `Origin: https://<public host>`: `kybernos-auto/state`, `kybernos-hub/state` and
`kybernos-sessions/settings` answered **403**; with `Origin: http://127.0.0.1:<port>` or no Origin they answered 200.
After: see the verification notes of the pull request. On a local DSH started with `--trusted-host`, the declared host (any port)
passes and a stranger, the `trusted@evil` userinfo trick and a forged `Host` are refused.

## Open

- Four older routes (`kybernos-memory`, `kybernos-slash`, `kybernos-modeles-locaux`, `kybernos-computers`) still compare the
  Origin with the client-supplied `Host`. They pass behind a proxy that keeps `Host`, but they are the weaker rule and should be
  moved to the socket-address rule in their own change.
- The approved restart (`relancer_dsh`, `scripts/dsh-relance.mjs`) uses `launchctl` or starts a detached `dsh web`; it does not
  know systemd or a container supervisor.
- Not yet checked on the real Hostinger template (its DSH version and process manager are not documented); the Coolify image in
  `docs/dev/coolify/` is the stand-in.
- `kybernos-install` starts its own `dsh web` on a free port to verify the boot; on a host where DSH is already running that is
  a second process.
