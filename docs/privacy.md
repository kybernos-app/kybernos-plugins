# What leaves your machine

Kybernos is local-first: your sessions, files, memory and keys stay on your computer. This page lists the requests the
plugins make on their own, so you can judge them, and says how to stop them.

A page of DSH with the Kybernos plugins loaded asks **no third party** for anything while it loads: no font, no icon, no
script, no stylesheet (a test, `scripts/test-no-third-party-at-load.mjs`, fails the build if one comes back; the only CDN
names left in the code are two fallbacks for a map and a diagram that are tried when the local copy is missing).

## Asked by itself, and switchable

One setting covers all three: **Settings › About › Check for updates automatically** (on by default, so that a security fix
is announced). Switched off, Kybernos asks none of them by itself: they are asked only when you ask (**Check now** on the About page, the
update entry of the account menu, **Check for updates** in the Kybernos Suite).

| Asked | Host | When | What goes with it |
|---|---|---|---|
| The latest Kybernos version: one text file, `VERSION` of the public repository | `raw.githubusercontent.com` | 15 s after the page opens, then every 6 h and when you return to the tab after 6 h | A plain GET with no body. The server sees your IP address and the usual headers (user agent). Nothing about your work |
| The latest DSH version (`npm view @deepseek-ai/dsh`, run by the npm command line of your machine) | `registry.npmjs.org` | Same moments, and whenever you open the About or Suite page or press **Check now** | The same: a GET with npm's own headers (npm and Node versions, system) |
| The signed catalogue of the Suite: `catalog.release.json` and its signature | `github.com` (release asset) | Same moments, and **Check for updates** in the Suite | A plain GET. The answer is verified against the public key shipped in the plugin before anything in it is believed |

The switch is a file, `~/.dsh/kybernos/update-check.json` (`{ "autoCheck": false }`). Nothing is ever installed by itself: an
update is announced, and applying it is your decision (the robot takes a snapshot first and rolls back on failure).

## Asked when you use a feature

These are requests of the page or the agent you opened, not of a launch. They carry what the feature needs (a search term, a
model name, a key you pasted for that provider) and nothing else.

- **Models page**: the model catalogue (`models.dev`) and, for the scores, public benchmark pages. A provider logo is a file
  shipped with the plugin: it asks nobody. Checking a key you pasted asks that provider.
- **Free models**: `opencode.ai`, for the list of free community models, and the model itself when you chat with one.
- **Local models**: the Ollama library (`ollama.com`) and the Kybernos catalogue of local models (GitHub), when you open the
  page or install a model.
- **Skills**: GitHub (`api.github.com`, `codeload.github.com`) and the Kybernos skills relay (`skills.kybernos.app`), when you
  browse or install a skill.
- **Web search**: the engine you chose, when an agent searches the web.
- **Your Kybernos account** (`api.kybernos.app`): only once you sign in, for what the account gives you.
- **Your model providers**: the provider of the model you chat with, as in any DSH. That is the one request that carries your
  prompts.

DSH itself, and any connector or MCP server you configured, make their own requests: they are outside these plugins.

## Check it yourself

Open the page with your browser's network tab and reload: the only host is your own `127.0.0.1`. For the host side, a tool
such as `lsof -i -a -p <pid of dsh>` shows what the process talks to; at start it is only what you configured (an MCP server of
your profile, for instance).
