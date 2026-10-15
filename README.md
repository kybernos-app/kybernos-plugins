# Kybernos plugins for DSH

Plugins that turn DSH (the DeepSeek harness) into an agent workspace: crew workflows with human approval, models catalog, skills, sessions, cloud memory and more.

> **Status: beta, rebuilt from a clean history (October 2026).** Requires DSH within the range declared in [`dsh-compat.json`](dsh-compat.json). Installation has been measured on macOS and, inside a Docker image, on Linux.

## Install

Download the archive of your system from the [latest release](https://github.com/kybernos-app/kybernos-plugins/releases/latest)
(or clone this repository), extract it in a new folder, and from there:

```sh
./kybernos-install --dry   # shows what would change, touches nothing
./kybernos-install         # checks the archive, installs DSH if missing, links the bundles, restores a snapshot if DSH fails to restart
dsh web --no-open --port 3080   # then open http://127.0.0.1:3080/
```

Needs Node.js 22 or later. The first run opens a few welcome pages (your profession, display mode, which models to use, a
starter kit of skills and agent teams for your profession); each can be skipped and replayed from Settings.
The full guide (Windows, update, rollback, safe mode, the welcome pages) is [`docs/install.md`](docs/install.md).

## Install on a server or with Docker

On your own computer, `./kybernos-install` above is all you need. To run Kybernos on a **server** other people or your own
devices reach over the internet, put the [Kybernos Gate](packages/kybernos-gate/README.md) in front of DSH: a sign-in page
(username and password, one login) with a reverse proxy. DSH refuses to listen on the network by itself, and it serves plugin
routes before its own authentication, so a hosted instance should never be exposed without it.

**With Docker** (one image: DSH, the plugins and the gate):

```sh
cd packages/kybernos-gate/docker
printf 'KYBERNOS_GATE_PASSWORD=%s\nKYBERNOS_PUBLIC_HOST=kybernos.example.com\n' 'a long password' > .env   # do not commit it
docker compose up -d --build
```

Then put a TLS reverse proxy (Caddy, Traefik, nginx, Coolify) in front of `127.0.0.1:3080`.

The image installs `KB_REF` of this repository (a release tag such as `v1.0.0-beta.6`, or `main` = the last release; never `dev`).
It is cloned when the image is built: to update, change `KB_REF` and rebuild with `docker compose build --no-cache`; a restart
or a cached redeploy keeps the old version. Details: [`packages/kybernos-gate/README.md`](packages/kybernos-gate/README.md#which-version-to-install-and-how-to-update).

**On a Linux server without Docker**: install Node 22.19+, pnpm and DSH, run `./kybernos-install`, start `dsh web` on `127.0.0.1:3081`
with `--trusted-host <your domain>`, then start the gate (`node packages/kybernos-gate/bin/kybernos-gate.mjs`). The step-by-step
commands, the two systemd units, a Caddy example and every setting are in [`packages/kybernos-gate/README.md`](packages/kybernos-gate/README.md);
what a hosted instance changes for the plugins is in [`docs/dev/hosted-instances.md`](docs/dev/hosted-instances.md).

## Bundles

Each folder under [`packages/`](packages) is an independent DSH bundle (`package.json` with a `dsh` block).

| Bundle | What it does |
|---|---|
| [`kybernos-plugin`](packages/kybernos-plugin/README.md) | Core: crew, journal, settings, tools catalog |
| [`kybernos-hub`](packages/kybernos-hub/README.md) | Boot guard and the Kybernos Suite panel: switch, install and update modules |
| [`kybernos-theme`](packages/kybernos-theme/README.md) | Theme |
| [`kybernos-models`](packages/kybernos-models/README.md) | Models catalog |
| [`kybernos-auto`](packages/kybernos-auto/README.md) | Auto mode: routes delegations by class |
| [`kybernos-computers`](packages/kybernos-computers/README.md) | Cloud computers for agents (E2B, bring your own key) |
| [`kybernos-workers`](packages/kybernos-workers/README.md) | Workers screen: verified state, install and exposure of Claude Code, Codex, Gemini, OpenCode, Qwen, Hermes and ZCode, with a guide and a clickable demo |
| [`dsh-subagent-maison`](packages/dsh-subagent-maison/README.md) | Agent connectors: the subagent providers for OpenCode, Gemini CLI, Qwen Code and Hermes (no page: the Workers page turns them on) |
| [`kybernos-slides`](packages/kybernos-slides/README.md) | Slide decks driven by chat |
| [`kybernos-motion`](packages/kybernos-motion/README.md) | Motion design driven by chat: titles, charts, particles, 3D, characters, sound, MP4 export |
| [`kybernos-bricks`](packages/kybernos-bricks/README.md) | Brick mockups driven by chat |
| [`kybernos-modeleur`](packages/kybernos-modeleur/README.md) | 2D/3D models driven by chat |
| [`kybernos-miniapps`](packages/kybernos-miniapps/README.md) | "Install as app" for right-sidebar mini-apps |
| [`kybernos-maintenance`](packages/kybernos-maintenance/README.md) | About page: version, compatibility with DSH, update log |
| [`kybernos-relance`](packages/kybernos-relance/README.md) | Approved restart of DSH |
| [`dsh-mermaid`](packages/dsh-mermaid/README.md) | Renders mermaid fences as SVG |
| [`dsh-db-viewer`](packages/dsh-db-viewer/README.md) | SQLite viewer in the right sidebar |
| [`dsh-media-player`](packages/dsh-media-player/README.md) | Audio/video preview |
| [`kybernos-cloud`](packages/kybernos-cloud/README.md) | Pairs DSH with a Kybernos Cloud account and imports the cloud model catalog |
| [`kybernos-usage`](packages/kybernos-usage/README.md) | Usage and cost: a chip under the composer and a Settings page: how much of your plan's window is used (as the server counts it) and what your own keys and local models cost |
| [`kybernos-dashboards`](packages/kybernos-dashboards/README.md) | Dashboards: a page before Agent Teams, built and changed by chat with the `dashboard-builder` skill (cards, animated charts, calendar, list, kanban, notes, carousel, flow, sankey), your own sources read on this computer, and the dashboard live in the right sidebar |
| [`kybernos-summary`](packages/kybernos-summary/README.md) | Summary: a tab in the chat's right-hand panel with the agents, the task list, the skills and tools used and the files written, read in the browser from what the chat already holds |
| [`kybernos-kyber`](packages/kybernos-kyber/README.md) | Kyby: your assistant's conversation (shared with Telegram), Telegram connected by QR code or link, and the cloud computer it works on |
| [`kybernos-multi-device`](packages/kybernos-multi-device/README.md) | Workspaces with or without a folder: Create offers a private folder in Documents/Kybernos, and Details shows where a workspace works, with a greyed preview of execution and devices |
| [`kybernos-changes`](packages/kybernos-changes/README.md) | One chip under the composer: where this chat's work stands (changed, saved, on GitHub, in the project) and what to do next; Simple / Developer view |
| [`kybernos-call`](packages/kybernos-call/README.md) | Voice calls from any chat session: a LiveKit room, a listening worker, the Call / Video buttons of team members |
| [`kybernos-composio`](packages/kybernos-composio/README.md) | Composio integration: MCP connection and app catalog |
| [`kybernos-flow`](packages/kybernos-flow/README.md) | Conversation flow without engine patches: auto-continue, queue-move |
| [`kybernos-language`](packages/kybernos-language/README.md) | Language page: every ISO 639-1 language, Kybernos and DSH screens translated by the configured LLM (progress, pause, resume), right-to-left. Translations are saved on your disk (`~/.dsh/kybernos/i18n/<lang>.json`), the browser keeps a copy |
| [`kybernos-modeles-locaux`](packages/kybernos-modeles-locaux/README.md) | Local models panel: detects the machine, installs an Ollama model |
| [`kybernos-refs`](packages/kybernos-refs/README.md) | Markdown links become compact reference chips |
| [`kybernos-search`](packages/kybernos-search/README.md) | Search everywhere: the content of the chats, skills, memories, lessons, creations, automations and agent teams (⌘K) |
| [`kybernos-mobile`](packages/kybernos-mobile/README.md) | The phone: DSH usable on a narrow screen (drawer, stacked Settings), and on a paid plan a QR code that links a phone to this computer, end to end encrypted |
| [`kybernos-websearch`](packages/kybernos-websearch/README.md) | Web search for the agents with or without an API key: free engines out of the box, keyed engines when you add one, one fallback chain |
| [`kybernos-terminal`](packages/kybernos-terminal/README.md) | Shell fences dressed as terminal windows, with a run button |
| [`kybernos-memory`](packages/kybernos-memory/README.md) | Lessons learned: read, written and injected per agent team (compatible with `memory.cjs`), switches, tools |
| [`kybernos-sessions`](packages/kybernos-sessions/README.md) | Session and agent team memory status per folder |
| [`kybernos-skills`](packages/kybernos-skills/README.md) | Skills catalog backed by DSH's native skill registry |
| [`kybernos-slash`](packages/kybernos-slash/README.md) | Slash commands and message actions |

`kybernos-install` links **all** of these bundles in one go. Switch any satellite on or off afterwards with `node scripts/dsh-lifecycle.mjs satellites --desactiver <name>` / `--activer <name>`; the socle (`kybernos-plugin`, `-hub`, `-theme`, `-sessions`, `-skills`) is always on.

## Testing

```bash
for t in scripts/test-*.mjs; do node "$t"; done                                   # robot, layout, packaging, safe mode
for t in packages/*/test*.mjs; do (cd "$(dirname "$t")" && node "$(basename "$t")"); done   # every plugin
dsh web --no-open --port 3080 &                                                  # then, with the token it prints:
node scripts/smoke-gui.mjs --token <token>                                       # real GUI: boot, host routes, panels (needs `npm i playwright`)
```

## Standalone tools

Neither is a DSH bundle: each is a separate process, with its own tests (`node --test test/*.test.mjs` in its folder).

- [`packages/messaging`](packages/messaging): a daemon bridging DSH and messaging apps (Telegram first). Run it with `npm run daemon` in that folder.
- [`packages/kybernos-gate`](packages/kybernos-gate): the sign-in gate for a hosted DSH (see [Install on a server or with Docker](#install-on-a-server-or-with-docker)). Run it with `node bin/kybernos-gate.mjs`; it refuses to start without a password.

## Contributing

Read [`AGENTS.md`](AGENTS.md) first. Licence: [Apache-2.0](LICENSE). The "Kybernos" name is covered by the [trademark policy](TRADEMARK.md).
