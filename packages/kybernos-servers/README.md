# `@local/kybernos-servers`

Add a Kybernos server from its address, switch between servers, rename and remove them. A server is **an address and your account
on it**: you paste the address your administrator gave you, click « Add and sign in », and confirm the code in the browser. The same
way works for Kybernos staging, a server on this computer and a company's own server. Nothing here asks for a licence or a key: the
server decides who may have an account.

Specification: `docs/dev/servers-page-spec.md` (decisions, the server contract, the state machine, the test plan SRV-01…21).
Why it exists and what was found: `docs/dev/servers-page-study-2026-10-19.md`. The open half it works with: `kybernos-cloud`
(`docs/dev/servers.md`).

## What the user sees

Settings › **Servers** (listed in the « Devices & cloud » group):

- the **list**: Kybernos Cloud (« Managed by Kybernos », always there, never removable) and every server added, each with its tags
  (**Active**, **Signed in**) and its actions: **Switch to this server**, **Sign in**, **Details** (the addresses your sign-in goes to,
  and a **Rename** field), **Remove**;
- **Add a server**: paste the address; the server is checked on its own (on paste, Enter or leaving the field, never while typing),
  its name shows, and « Your sign-in and its token will only go to <host> » (the full list of addresses is one click away and open by
  default when one of them is on another host). **Add and sign in** writes the server, switches to it and shows the code to confirm
  in the browser;
- a **banner** while the active server is not Kybernos Cloud, with « Back to Kybernos Cloud » (always available);
- the **Enterprise** card under the list (run Kybernos on your own server; its « Talk to us » button is drawn only when
  `ENTERPRISE_CONTACT` in `client.js` is set, so there is never a dead button);
- « ? How it works » (`help.json`).

Phase 2, **not built and not shown**: « Other ways to sign in » (an access key for the models only, email and password).

## Files and where they live

| File | Role |
|---|---|
| `index.js`, `host.mjs` | host half: routes `/kybernos-servers/{status,check,add,switch,rename,remove}`, every POST same-origin strict |
| `discovery.mjs` | pure: the address typed → `/.well-known/kybernos-server.json` → a profile, in three steps; never throws |
| `registry.mjs` | pure: names, ids, duplicates |
| `client.js` | the Settings page; `__test` exposes the view for the tests |
| `help.json` | the help card (French and English) |

It stores nothing of its own: the registry is `<DSH home>/kybernos/servers.json` (0600; `KYBERNOS_SERVERS_FILE` overrides), each
server's sign-in is the cloud plugin's `kybernos-cloud-<id>.json`. It reaches the cloud plugin through two routes only
(`GET /kybernos-cloud/server`, `POST /kybernos-cloud/server/apply`) and the sign-in through `POST /kybernos-cloud/start` and `/poll`.

## Rules

- **The cloud plugin judges a profile.** After writing one, this plugin asks whether the cloud plugin accepts it and puts the
  file back exactly as it was if not. An unreadable registry is never overwritten.
- **The page's profile is never trusted:** `add` discovers again host side.
- **No duplicate server:** the same address (any spelling) as the built-in server or any entry is refused.
- **Remove forgets the sign-in on this computer** and nothing on the server; removing the active server goes back to Kybernos Cloud first.

## Tests

```bash
for t in packages/kybernos-servers/test-*.mjs; do node $t || exit 1; done
```

`test-discovery.mjs` and `test-registry.mjs` are pure; `test-host.mjs` runs the real handlers against the real cloud half and fake
servers; `test-client.mjs` reads the page and renders it when React is found (`KB_REACT_DIR`), and says so loudly when it is not.
The GUI check is `scripts/check-servers-live.mjs` (a second DSH on its own port, never the owner's).
