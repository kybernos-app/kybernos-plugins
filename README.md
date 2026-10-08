# Kybernos plugins for DSH

Plugins that turn DSH (the DeepSeek harness) into an agent workspace: crew workflows with human approval, models catalog, skills, sessions, cloud memory and more.

> **Status: beta, rebuilt from a clean history (October 2026).** Requires DSH within the range declared in [`dsh-compat.json`](dsh-compat.json). Installation has only been measured on macOS.

## Install

```sh
./kybernos-install --dry   # shows what would change, touches nothing
./kybernos-install         # checks the archive, installs DSH if missing, links the bundles, restores a snapshot if DSH fails to restart
```

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
| [`kybernos-bricks`](packages/kybernos-bricks/README.md) | Brick mockups driven by chat |
| [`kybernos-modeleur`](packages/kybernos-modeleur/README.md) | 2D/3D models driven by chat |
| [`kybernos-miniapps`](packages/kybernos-miniapps/README.md) | "Install as app" for right-sidebar mini-apps |
| [`kybernos-maintenance`](packages/kybernos-maintenance/README.md) | About page: version, compatibility with DSH, update log |
| [`kybernos-relance`](packages/kybernos-relance/README.md) | Approved restart of DSH |
| [`dsh-mermaid`](packages/dsh-mermaid/README.md) | Renders mermaid fences as SVG |
| [`dsh-db-viewer`](packages/dsh-db-viewer/README.md) | SQLite viewer in the right sidebar |
| [`dsh-media-player`](packages/dsh-media-player/README.md) | Audio/video preview |
| [`kybernos-cloud`](packages/kybernos-cloud/README.md) | Pairs DSH with a Kybernos Cloud account and imports the cloud model catalog |
| [`kybernos-changes`](packages/kybernos-changes/README.md) | One chip under the composer: where this chat's work stands (changed, saved, on GitHub, in the project) and what to do next; Simple / Developer view |
| [`kybernos-call`](packages/kybernos-call/README.md) | Voice calls from any chat session: a LiveKit room, a listening worker, the Call / Video buttons of team members |
| [`kybernos-composio`](packages/kybernos-composio/README.md) | Composio integration: MCP connection and app catalog |
| [`kybernos-flow`](packages/kybernos-flow/README.md) | Conversation flow without engine patches: auto-continue, queue-move |
| [`kybernos-language`](packages/kybernos-language/README.md) | Language page: every ISO 639-1 language, Kybernos and DSH screens translated by the configured LLM (progress, pause, resume), right-to-left. Translations are saved on your disk (`~/.dsh/kybernos/i18n/<lang>.json`), the browser keeps a copy |
| [`kybernos-modeles-locaux`](packages/kybernos-modeles-locaux/README.md) | Local models panel: detects the machine, installs an Ollama model |
| [`kybernos-refs`](packages/kybernos-refs/README.md) | Markdown links become compact reference chips |
| [`kybernos-terminal`](packages/kybernos-terminal/README.md) | Shell fences dressed as terminal windows, with a run button |
| [`kybernos-memory`](packages/kybernos-memory/README.md) | Lessons learned: read, written and injected per kyber (compatible with `memory.cjs`), switches, tools |
| [`kybernos-sessions`](packages/kybernos-sessions/README.md) | Session and kyber memory status per folder |
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

## Standalone tool

[`packages/messaging`](packages/messaging) is **not** a DSH bundle: it is a separate daemon bridging DSH and messaging apps (Telegram first). Run it with `npm run daemon` in that folder; its tests are `node --test test/*.test.mjs`.

## Contributing

Read [`AGENTS.md`](AGENTS.md) first. Licence: [Apache-2.0](LICENSE). The "Kybernos" name is covered by the [trademark policy](TRADEMARK.md).
