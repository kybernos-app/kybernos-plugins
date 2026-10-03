# Kybernos plugins for DSH

Plugins that turn DSH (the DeepSeek harness) into an agent workspace: crew workflows with human approval, models catalog, skills, sessions, cloud memory and more.

> **Status: beta, rebuilt from a clean history (October 2026).** Requires DSH within the range declared in [`dsh-compat.json`](dsh-compat.json). Installation has only been measured on macOS.

## Install

```sh
./kybernos-install --dry   # shows what would change, touches nothing
./kybernos-install         # checks the archive, installs DSH if missing, links the bundles, restores a snapshot if DSH fails to restart
```

## Bundles

Each folder is an independent DSH bundle (`package.json` with a `dsh` block).

| Bundle | What it does |
|---|---|
| `kybernos-plugin` | Core: crew, journal, settings, tools catalog |
| `kybernos-theme` | Theme |
| `kybernos-models` | Models catalog |
| `kybernos-auto` | Auto mode: routes delegations by class |
| `kybernos-computers` | Cloud computers for agents (E2B, bring your own key) |
| `kybernos-slides` | Slide decks driven by chat |
| `kybernos-bricks` | Brick mockups driven by chat |
| `kybernos-modeleur` | 2D/3D models driven by chat |
| `kybernos-miniapps` | "Install as app" for right-sidebar mini-apps |
| `kybernos-maintenance` | Maintenance page: versions, update log |
| `kybernos-relance` | Approved restart of DSH |
| `dsh-mermaid` | Renders mermaid fences as SVG |
| `dsh-db-viewer` | SQLite viewer in the right sidebar |
| `dsh-media-player` | Audio/video preview |
| `messaging` | DSH ↔ messaging bridge (Telegram first) |
| `kybernos-cloud`, `kybernos-composio`, `kybernos-flow`, `kybernos-language`, `kybernos-modeles-locaux`, `kybernos-refs`, `kybernos-sessions`, `kybernos-skills`, `kybernos-slash` | Descriptions to be written |

## Contributing

Read [`AGENTS.md`](AGENTS.md) first. Licence: [Apache-2.0](LICENSE). The "Kybernos" name is covered by the [trademark policy](TRADEMARK.md).
