# Servers: which Kybernos server this DSH talks to

DSH talks to one Kybernos server at a time. Today that is Kybernos Cloud, which is the **new Kybernos server**
(`kybernos-server`); the old stack is unplugged (see « The built-in server » and « The old stack »). A company can run its
own, and a paid module (« Select server », a separate plugin in the private repo) will let a user switch. This repo is the open half: it knows how to
**read** which server is active and where its api, web, console and LLM are. It has no screen, no licence and no way to add a
server.

## The profile

```jsonc
{ "id": "acme", "name": "Acme", "api": "https://kb.acme.example",
  "web": "https://kb.acme.example/app",                       // optional, derived from api
  "console": "https://kb.acme.example/app/workspace-console", // optional, derived from web
  "services": { "llm": "https://llm.acme.example", "gateway": null } }
```

- `api` is required: account, workspaces, billing, the Team relay.
- `web` and `console` are optional and default to **the server's own host** (`web` = `api`, `console` = `<web>/workspace-console`): the
  new server serves its account page, the device activation page, the referral landing and the team console itself. There is no
  `api.x → x` convention any more: it pointed a server at a different host (the legacy web app).
- `services.llm`: a URL is the OpenAI-compatible base DSH sends chat to; `null` or absent means the same host as `api` (what
  Kybernos Cloud does today); `false` means **this server has no Kybernos LLM**. That is a normal case: DSH imports no
  « kybernos » models, removes the ones another server left, and the console can hide the LLM pages.
- `services.gateway`: the LLM service's admin gateway, used only by the Team console's key mode. It goes away with the key
  hand-off (the relay replaces it), so a new server never needs one.
- `services.connections`: the address of the server's MCP endpoint for the account's connected apps (`/v1/mcp/connections`, ADR 0008
  of the Kybernos server), or `false`. **Absent means not offered**, unlike `services.llm` where absent means the same host as `api`:
  an older server, or one without Composio (an on-premises one), simply has no connections, and DSH hides the « Kybernos connections »
  mode and registers no tool. It must be on **the same origin as `api`**: the device token goes to that address, so it can never be
  another host than the server that issued it (a profile that says otherwise is refused, and an environment override of `api`
  leaves the registry's endpoint behind).
- https only, http for a loopback address only (a bearer token never crosses a clear network), no credentials, query or fragment
  in a URL. **A field that is present and invalid refuses the whole profile**: a typo must never fall back to another server's
  address. The id `kybernos-cloud` is reserved for the built-in server.

Code: `packages/kybernos-cloud/server-profile.mjs` (pure, `test-server-profile.mjs`).

## The built-in server (and the go-live checklist)

With no registry and no environment override, DSH talks to the built-in server and to nothing else. It is the new server:
`BUILTIN_API` in `server-profile.mjs` is **the one place that names it** (dev today: a Railway-generated address; the production
name is not final). Everything else follows from it: web and console are its own host, chat goes to `<api>/v1/chat/completions`
(`services.llm` null = same host), the connected apps' MCP endpoint is `<api>/v1/mcp/connections`, there is no gateway.

At go-live, change `BUILTIN_API` and run `node scripts/test-no-legacy-hosts.mjs`. It checks the two literals that cannot import it
(the page's fallback in `packages/kybernos-plugin/client.js`, `KB_FEEDBACK_API_DEFAULT` in `packages/kybernos-plugin/index.js`) and
tells you which one to edit; it also fails on any old-stack hostname in shipped code (the allowlist is in the test, with a reason
per entry). If a separate web app exists by then, give the built-in profile a `web` there (the discovery document of the server
publishes it when it is configured).

The sandbox and the tests re-point the built-in server with `KYBERNOS_CLOUD_API=http://localhost:<port>`: its web, console and
connections endpoint move with it.

## The old stack (explicit opt-in)

Nothing of the old stack was deleted; it is simply not the default any more. To use it (to compare, to reproduce a problem), add
this entry to `servers.json` and make it active. It has its own connection file (`kybernos-cloud-kybernos-legacy.json`), so a
token of one stack never reaches the other; the page then follows it (console, web app and gateway), and `POST
/kybernos-cloud/server/apply` swaps the « kybernos » model route. A test reads this very block (`test-server-profile.mjs`).

<!-- legacy-entry -->
```json
{ "active": "kybernos-legacy",
  "servers": [ { "id": "kybernos-legacy", "name": "Kybernos (old stack)",
                 "api": "https://api.dev.kybernos.app",
                 "web": "https://dev.kybernos.app",
                 "console": "https://dev.kybernos.app/workspace-console",
                 "services": { "gateway": "https://api.dev2.kybernos.app" } } ] }
```

The block above is the whole file; with other servers in it, add only the entry and set `active`. The old stack has no connected
apps endpoint (`services.connections` absent = not offered), and plugins that call routes only the new server has (for example the
Team lessons or skills routes) fail there; that is the point of keeping it behind an opt-in.

Three more things the old stack needs on purpose, because none of them is a default any more:

- the gateway watcher (remote widget, remote control: `/gateway/poll`, `/widget/api/reply`, `/telecommande/*`) needs `pairingToken` AND
  `gatewayBase` in `<DSH home>/kybernos/settings.json`; with a token and no `gatewayBase` it stays inactive and sends nothing;
- the Composio plugin's full app list came from the old Composio proxy; it is read now from the signed-in server (page) or from an address in
  `KYBERNOS_COMPOSIO_APPS_URL` (host half; unset = the local 100-app catalogue, and a scan is reported partial);
- public links (`/v1/shares`, `/v1/chats`, links on the old web app's `/s/<slug>`) work only if the active server has those routes.

## An install left by the old stack

A DSH that was connected before the new server became the default has `kybernos-cloud.json` recording `api: <old stack>` and an old token,
and the « kybernos » model route pointing at the old address. At start (before anything can use the token) the cloud host sees that the
connection belongs to ANOTHER server than the active one: it **moves the file aside** as `kybernos-cloud-<host>.json` (0600, kept,
never read for this server), removes the model route and credential that connection imported, and the person is « not connected » and
pairs again. The token never reaches the new server and chat never keeps going to the old address (`test-unplug-host.mjs`). A state with
no `api` (older than the field) is trusted as before.

## The registry

`<DSH home>/kybernos/servers.json` (`KYBERNOS_SERVERS_FILE` overrides): `{ "active": "acme", "servers": [ …profiles… ] }`.
Invalid, duplicate and reserved entries are dropped and listed in `rejected`; a missing or broken file is « no registry ».
Precedence for the active server: `KYBERNOS_CLOUD_API` (tests, developers) → the registry's `active` → built-in Kybernos Cloud.
An `active` that names no valid server falls back to the built-in one **and says so** (`error: "active_unknown"`).

Anyone can edit the file by hand. What the paid module sells is the management of servers (discovery through
`/.well-known/kybernos-server.json`, sign-in, a signed offline licence), not the ability to read a file.

## What switching does

- Each server keeps **its own connection file**: `kybernos-cloud.json` for the built-in one (nobody is signed out by this
  change), `kybernos-cloud-<id>.json` for another. Switching never signs anyone out and one server's token never reaches
  another.
- The « kybernos » model route (`llm-pi-ai.providers.kybernos`) and its credential belong to the server whose catalogue was
  imported last (`<DSH home>/kybernos/server-applied.json`). On a switch the previous server's route is **removed first**, so
  chat never keeps talking to a server the user left; then the new server's catalogue is imported when this DSH is connected to
  it. The catalogue is read where the route points (the profile's LLM service, else the account API).
- The page asks the cloud plugin for the active server each time « Teams settings » opens, and uses its console and web address.

## Routes (kybernos-cloud)

| Route | Answer |
|---|---|
| `GET /kybernos-cloud/server` | `{ ok, server: { id, name, api, web, console, llm, gateway }, source, error?, servers: [{ id, name, api, llm, active, connected }], rejected }`. `connected` = this DSH holds a sign-in for that server (its own connection file); nothing of the token is returned. No secret lives in a profile. |
| `POST /kybernos-cloud/server/apply` | Make DSH follow the registry: clean the previous server's route, mark the new one, import its catalogue if connected. Idempotent. `{ ok, server, cleaned, connected, models?, no_llm?, import_error? }`. Same-origin guarded. |

## The discovery document a company server serves

A user types ONE address; the module reads `GET <address>/.well-known/kybernos-server.json` (200 JSON, no redirect, under 64 KB):

```json
{ "schema": 1, "name": "Acme Corp", "version": "1.4.0", "dsh_min": "0.1.6",
  "api": "https://kb.acme.example", "web": "https://kb.acme.example/app",
  "console": "https://kb.acme.example/app/workspace-console",
  "services": { "llm": "https://llm.acme.example" } }
```

`api` is required, everything else is optional (`web` and `console` are derived, `services.llm` is a URL, absent = same host as the API, or `false` =
no Kybernos LLM; `services.connections` is the connected apps' endpoint on the same host, or `false`, and **absent means not offered**). The addresses inside are where the account's token will go: the user is shown them before anything is added, and the open
half refuses a profile with an insecure or malformed one. A server that cannot publish this file can still be used by writing its profile
into the registry by hand.

The Settings nav lists a page labelled « Servers » / « Serveurs » in the Account group (a one-line entry in `GROUPES`, so the paid module's page
lands where the mockup puts it instead of under « Third Party Plugins »).

## What the paid module does (private repo)

1. Its screen lists the servers (`GET /kybernos-cloud/server`), checks the licence (signed, verified offline, like the
   catalogue's Ed25519 chain), and writes `servers.json` from its host half.
2. It calls `POST /kybernos-cloud/server/apply`, then reloads the page so every screen reads the new server.
3. Connecting to a server is the usual device pairing, against that server's `api`.

DSH also reconciles at boot: if the registry changed while DSH was down, the previous route is cleaned before anything is
imported.

## Still tied to Kybernos Cloud (deliberately)

- The referral page (`KB_REFERRAL_PAGE`) and the feedback address (`KB_FEEDBACK_API_DEFAULT`): they belong to the vendor, not to
  a company's server. Both point at the built-in server (checked by `scripts/test-no-legacy-hosts.mjs`).
- `gateway-watcher.mjs` (`https://kybernos.app` by default, from its own `gatewayBase` setting) and the Composio proxy: they are
  not the account server and this seam does not move them.
- The credential name `KYBERNOS_API_KEY` is global: the model route holds one token at a time. The switch cleans it, so « last
  connect wins » can no longer leave one server's token behind another's address.

## Tests

`node scripts/test-no-legacy-hosts.mjs` (the built-in server is the new one, no old hostname in shipped code, the page's and the
feedback's fallbacks equal `BUILTIN_API`), `node packages/kybernos-cloud/test-server-profile.mjs` (profile and registry rules, the
built-in server, the documented old-stack entry), `node packages/kybernos-cloud/test-server-switch.mjs`
(four fake servers: boot, switch, no LLM, a separate LLM service, leaving for an unconnected server, an unreadable registry; it
fails if the cleanup or the no-LLM rule is removed), `node packages/kybernos-plugin/test-server-client.mjs` (the page's loader,
cut out of `client.js`).
