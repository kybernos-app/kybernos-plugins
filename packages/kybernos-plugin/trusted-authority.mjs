// ── Trusted authorities: let the route guards accept a hosted instance's public address ──
//
// Every bundle that serves a plugin route guards it itself (DSH serves plugin routes BEFORE its
// own authentication), and each guard compares the request's Origin with the REAL listening
// address of the socket: `127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>`. Behind a reverse
// proxy (a VPS template, Coolify, any TLS front) the browser's Origin is the public address
// instead, so every guarded route answered 403.
//
// DSH solves the same problem for its own `/api` with `--trusted-host <authority...>` (measured on
// 0.2.0-rc.2: `dsh web --help`). The declared authorities, plus the LAN literals DSH derives from
// the bind address, are published to plugins as `ctx.webRuntime.trustedHosts`. This module reuses
// that list instead of inventing a second setting, with the SAME matching rule as DSH's
// `isTrustedAuthority` (dsh-client-connection): an entry with a port matches that exact authority,
// a port-less entry matches the hostname on any port.
//
// The Origin is still never compared with the client-supplied Host header: only an authority the
// operator declared to DSH is accepted, and a foreign page can neither forge nor choose its Origin.
//
// The core bundle publishes one predicate on `globalThis[Symbol.for('kybernos.trustedAuthority')]`;
// the other bundles read it through a one-line helper and fall back to loopback-only when it is
// absent (bundles stay independent: nothing is imported across them).

export const TRUSTED_AUTHORITY_KEY = 'kybernos.trustedAuthority'

const parseAuthority = (value) => {
  if (typeof value !== 'string' || value === '') return undefined
  try { return new URL('http://' + value) } catch (e) { return undefined }
}

/** True when `value` is a bare `host[:port]` (no userinfo, path, query or fragment). */
const isBareAuthority = (u) => u.username === '' && u.password === '' && u.pathname === '/' && u.search === '' && u.hash === ''

/** The port an entry was written with, judged under both special schemes so `:80` and `:443` stay explicit. */
const writtenPort = (entry, entryUrl) => (entryUrl.port !== '' ? entryUrl.port : new URL('https://' + entry).port)

/**
 * Whether `host` (the `host` of a parsed Origin or Referer URL) is one of the declared authorities.
 * @param {string} host
 * @param {readonly string[]} entries
 */
export function isTrustedAuthority (host, entries) {
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined || !isBareAuthority(hostUrl)) return false
  if (!Array.isArray(entries)) return false
  return entries.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined || !isBareAuthority(entryUrl)) return false
    return writtenPort(entry, entryUrl) === ''
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/**
 * The authorities DSH declared for this run. `webRuntime` is provided once the server has bound;
 * `webStartup` carries the explicit `--trusted-host` flags and is the fallback before that.
 * `ctx.get` returns undefined for a service that is not provided (no warning, no throw).
 */
export function readTrustedHosts (ctx) {
  try {
    for (const name of ['webRuntime', 'webStartup']) {
      const service = ctx.get(name)
      if (service !== undefined && service !== null && Array.isArray(service.trustedHosts)) {
        return service.trustedHosts.filter((entry) => typeof entry === 'string')
      }
    }
  } catch (e) { /* service lookup failed: no extra authority */ }
  return []
}

/**
 * Publish the predicate for the other bundles. Reads the list on every call, so a late
 * `webRuntime` is picked up without a restart. Returns the predicate (handy for tests).
 */
export function publishTrustedAuthority (ctx, target = globalThis) {
  const predicate = (host) => isTrustedAuthority(host, readTrustedHosts(ctx))
  try { target[Symbol.for(TRUSTED_AUTHORITY_KEY)] = predicate } catch (e) { /* frozen global: loopback only */ }
  return predicate
}
