# `@local/dsh-subagent-maison`

The **Agent connectors** module of the Suite: four DSH subagent providers — OpenCode, Gemini CLI, Qwen Code and Hermes — that let
the main agent hand a task to one of these coding CLIs. It has no page and no switch of its own: the Workers page
(`kybernos-workers`) turns a connector on, installs the program, takes the API key and exposes the agent to the lead.

## What is in it

| Folder / file | What it is |
| --- | --- |
| `dsh-subagent-opencode/`, `-gemini/`, `-qwen/`, `-hermes/` | one provider each: `index.js` (`name`, `inject`, `Config`, `apply`) and `argv.js` (the command line, pure) |
| `fabriquer-provider.mjs` | the factory the four share: the DSH bridge (Provider class, `apply`, run handle) around a CLI that runs once and writes on stdout |
| `noyau.mjs` | the core without DSH: the one-shot run, the task check, the health probe, `:free` model discovery |
| `moteur.mjs` | finds the engine's own modules at run time (see below) |
| `test-*.mjs` | `test-moteur` (fixture engine), `test-noyau`, `test-providers`, `test-integration` (real engine, skipped without one) |

Each provider runs the CLI once, in the delegating session's folder, with the engine's scrubbed environment and the task as an
argument, and returns what it printed. No model name is hard-coded: the model is the CLI's own choice, or a config value, or
(Hermes) a `:free` model found on the portal when none is set. They are started with the options that let them write without
asking (`-y`, `--skip-trust`, `--dangerously-skip-permissions`, depending on the CLI): a worker can create and edit files in the
conversation's folder. Gemini is used with an API key (`GEMINI_API_KEY`), not a Google sign-in; Qwen with `QWEN_TOKEN_PLAN_API_KEY`
or `DASHSCOPE_API_KEY`; both are read from DSH's environment when DSH starts.

## How they are loaded

The package has no `dsh.bundle`: nothing is loaded just because it is installed. The Workers page writes one `- insert:` line
per connector in the profile's `cordis.patch.yml`, with a backup first:

```yaml
- insert:
    - id: subagent-gemini
      name: "@local/dsh-subagent-maison/gemini"
```

`name` is a package **subpath** (`exports` in `package.json`), which DSH's loader resolves like any package name (measured on
DSH 0.2.0-rc.2). The line is picked up by the running DSH within a few seconds. The Suite links the package into the profile
like every other module (`scripts/lifecycle-packages.json`, `docs/beta/satellites.json`); the boot log then carries one
"declares no dsh.bundle" line for it, as it already does for the official `@deepseek-ai/dsh-subagent-codex` and `-claude-code`.

### The engine's modules

A provider needs `@deepseek-ai/dsh-subagent`, `dsh-subprocess`, `dsh-brand` and `schemastery`. A package linked from a checkout
cannot import them in the usual way (Node looks next to the real path, the checkout, where there is no `node_modules`), and
this package ships without one. `moteur.mjs` looks them up from where the engine is, in this order: `KB_MOTEUR` (a folder whose
`node_modules` holds the engine), the running `dsh` (`process.argv[1]`), an official provider of the profile, the profile, this
package. The schema and brand modules are taken from the engine's own `dsh-subagent` first, so the classes are the very ones the
engine uses. When none is found the plugin fails to load with the list of places it looked in.

## Machines that were set up by hand

Before this package, the four providers were linked by hand as bare packages (`dsh-subagent-<cli>` in the profile's
`node_modules`, plus a patch line `name: "dsh-subagent-<cli>"`, plus an untracked `node_modules` of symlinks into one engine
install inside this folder). That setup keeps working — the folders did not move and the lookup above replaces the symlinks —
and the Workers page counts the old name as "turned on" (installed while its own bare link exists) so it never adds a second line (a provider registered twice makes
DSH log "a subagent provider named … is already registered"). To move such a machine to the Suite's way: remove the four old
`subagent-<cli>` lines and the four old links, then turn the connectors on again from the Workers page.

## Tests

```bash
node packages/dsh-subagent-maison/test-moteur.mjs        # 22 checks, fixture engine: the lookup, the factory, start() end to end
node packages/dsh-subagent-maison/test-noyau.mjs         # core: one-shot run, probe, free-model discovery (local HTTP fixture)
node packages/dsh-subagent-maison/test-providers.mjs     # the command lines, pure
node packages/dsh-subagent-maison/test-integration.mjs   # against the REAL engine; "SKIPPED" when none is installed
```

CI has no DSH: the first three run, the fourth skips. Run the fourth on a machine with DSH before changing `fabriquer-provider.mjs`.
