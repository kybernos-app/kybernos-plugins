# `@local/kybernos-no-process`

For the Kybernos phone app (`mobile/app`) only. A phone cannot launch programs next to an app, but the DSH engine's tools do: a shell command, a file search, an MCP server started as a program. This bundle gives the engine in-process versions of those, so the agent works on the phone.

It replaces two engine services through the bundle patch (`cordis.patch.yml`: `subprocess` and `sandbox` are switched off and ours inserted, no engine file is touched):

- `subprocess-inproc`: a command runner where `rg` is a JavaScript search (`rg.mjs`) and the shell is `just-bash` (`just-shell.mjs`, over a filesystem that is read-only outside the workspace) or a small built-in one (`mini-shell.mjs`); `curl` and the other common programs are answered in the process; anything that really needs another program fails with an `EPERM` the model can read.
- `sandbox-inproc`: the engine's confinement, as a wrapper that names what it refuses.
- `inproc-mcp-door`: MCP servers that are programs cannot start; remote ones (HTTP) go through the door unchanged.

**Leave it off on a computer**: it takes the place of the real program launcher, which a computer has and needs. It is off by default in the Suite and the phone app's profile (`mobile/payload/profile-ios/bundles.json`) switches it on.

## Tests

`cd packages/kybernos-no-process && for t in test*.mjs; do node $t; done`. `test-just-shell.mjs` needs the `just-bash` package, which only the phone payload carries (it is not a dependency of this repository): it stops with a clear message without it; the payload boot test (`mobile/payload/test-boot.mjs`) covers the shell end to end.

## Stores

Nothing of its own.
