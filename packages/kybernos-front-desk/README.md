# kybernos-front-desk

The DSH side of the **front desk** (« Accueil client »): the public assistant of one shop, which visitors reach on a link, in a widget on the shop's site or on Telegram.
The assistant itself is the standalone service in [`packages/front-desk`](../front-desk) (open source, no DSH needed to run it). This bundle starts and watches it on the
owner's computer, shows its owner pages inside DSH, and gives Kaby a tool to prepare its fiche. A **« Front desk » row** in the Business group of the menu opens the page.

## Using it

1. Switch the plugin on in the Suite, open **Front desk**, and in **Setup** give the assistant a model: an address (any OpenAI-compatible service), a name and a key. The key is the
   assistant's own: it is stored apart (0600), handed to the service as its environment, and never shown to Kaby or to the page again. Press **Start**.
2. In **Atelier** say what the assistant knows about the shop and what it may do (the service's own page, framed), or ask Kaby: she edits a **draft**, runs the checks and asks to
   publish. Nothing changes for visitors before an approval card is accepted. Money, limits, the sites that may show the chat and any action turned to « on its own » stay the owner's:
   the service refuses them for Kaby.
3. In **Setup**, copy the link or the chat bubble for the site. For visitors to reach it, give a **public address** (a domain, or a tunnel to this computer); without one the link only
   works on this computer. A Telegram bot is one more field.
4. In **Inbox** read the conversations, answer yourself, approve what the assistant asks before it does it, undo what it did.

## What it stores, and where

Under `<DSH home>/kybernos/front-desk/`:

| File | What |
|---|---|
| `config.json` | what is not secret: the public address, the model's address and name, the Telegram switch, `autostart` |
| `secrets.json` (0600) | the owner token the plugin and the service share, the model key, the Telegram bot token |
| `fiche.json` | the starter fiche, read once to write version 1 |
| `data/` | the service's own data: versions and journal, conversations, the ledger, the kill file |
| `service.pid`, `service.log` | the running service, and its output (secrets scrubbed when read back) |

`service/` in this folder is a **copy** of `packages/front-desk` (`bin`, `core`, `server`, `channels`), made by `node scripts/sync-front-desk-service.mjs`; `test-service-drift.mjs`
fails when the two differ.

## How it is wired

| File | Role |
|---|---|
| `index.js` | `apply(ctx)`: supervisor, routes, the `front_desk` tool, the prompt block, the approval gate, the seeded skill. Everything guarded: nothing here stops DSH from starting |
| `fd-config.mjs` | the files above; the **hermetic environment** of the service (nothing of the owner's DSH keys reaches it) |
| `fd-supervisor.mjs` | start, stop, **adopt** a service still running from before a DSH restart; port, pid file, log |
| `fd-routes.mjs`, `fd-proxy.mjs` | `/kybernos-front-desk/*`: every route behind the Host fence **and** DSH's signed session (reads too: plugin routes are served before DSH's sign-in); the service's owner pages and API forwarded with the owner token the browser never sees. The visitor's routes are never forwarded |
| `fd-tools.mjs` | the `front_desk` tool (status, draft, check, publish, rollback, discard) and its **approval card** (what changes and what the assistant can then really do). The tool only publishes a call the gate put a card in front of the owner for |
| `fd-brief.mjs`, `skills/front-desk-fiche` | what Kaby is told, once a front desk is set up |
| `client.js` | the page: Setup, Atelier, Inbox |

Switching the plugin off (or quitting DSH) stops the service; `autostart` (set by **Start**, cleared by **Stop**) brings it back at the next DSH start.

## Limits to know

- The service runs on this computer: while DSH is closed, visitors get nothing. Public reachability needs a public address (a tunnel or a domain); the plugin does not make one.
- The model address is named by the owner's configuration, not by the code, so the manifest cannot list that host (the contract has no `net:configured` yet).
- Plugin routes are served before DSH's own sign-in, so they check the session themselves. An agent that can run shell commands could read DSH's session secret and call them: the same
  exposure as every other write route of every bundle.
- Not built yet: voice and phone, WhatsApp, the Computer Cloud subscription gate.

## Tests

```bash
cd packages/kybernos-front-desk && npm test
```

`test-config`, `test-supervisor`, `test-proxy`, `test-routes` (real sockets, every guard), `test-tools` (the card, the one-use grant), `test-host` (`apply` over a fake context that
throws, lacks services…), `test-client` (the page rendered from crafted states, the container on a small hook runtime), `test-service-drift`, and `test-integration`, which runs
the whole chain on a **real service child** in `--dry-run` (no key, no cost): start, pages through the plugin, Kaby's draft, check, publish, rollback, adoption, stop.
