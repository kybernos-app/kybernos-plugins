# Servers: which Kybernos server this DSH talks to

DSH talks to one Kybernos server at a time. Today that is Kybernos Cloud. A company can run its own, and a paid module
(« Select server », a separate plugin in the private repo) will let a user switch. This repo is the open half: it knows how to
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

## Which workspace a chat call is billed to

The server bills a call to the workspace named in `x-kybernos-workspace`, else to the person's **personal** workspace. DSH's chat has no way to
name one per call, so the model route the plugin writes (`llm-pi-ai.providers.kybernos`) carries the header of the **active space** as a profile
`header`, and the catalogue is read with the same header: a team's own models (`byok/…`, shared with its members by an owner or admin) are in the
catalogue of that team and in no other. Choosing or creating a space rewrites the route; a refresh re-reads the catalogue (one GET) and rewrites it
only when the models changed. Without this a member's chat used their personal allowance whatever the Cloud card said (measured, `console2` lane of
the production gate).

Two more things serve the quota notice and the Cloud card: `GET /kybernos-cloud/quota` (what stopped the last call: the active space's plan and
payment state and the person's own windows that are used up, no token) and the `space_plan.mfa` field of `/status` (a workspace that asks its
members for a second factor: `grace` with the date, or `blocked`). DSH words every refusal « Request quota exhausted » (a 403 is « API key is
invalid »): the quota notice (claimed through DSH's `shell.quota-notice` chain, `QUOTA` only) and the card carry the reason instead. The notice's
button has the host open the console in the system browser (`POST /kybernos-cloud/console/link` with `open: true`).

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
  a company's server.
- `gateway-watcher.mjs` (`https://kybernos.app` by default, from its own `gatewayBase` setting) and the Composio proxy: they are
  not the account server and this seam does not move them.
- The credential name `KYBERNOS_API_KEY` is global: the model route holds one token at a time. The switch cleans it, so « last
  connect wins » can no longer leave one server's token behind another's address.

## Tests

`node packages/kybernos-cloud/test-server-profile.mjs` (profile and registry rules), `node packages/kybernos-cloud/test-server-switch.mjs`
(four fake servers: boot, switch, no LLM, a separate LLM service, leaving for an unconnected server, an unreadable registry; it
fails if the cleanup or the no-LLM rule is removed), `node packages/kybernos-plugin/test-server-client.mjs` (the page's loader,
cut out of `client.js`).
