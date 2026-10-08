# kybernos-terminal

Dresses the shell code fences of the DSH chat as terminal windows: mac traffic-light dots + `~ zsh` title on the left, language badge and the NATIVE buttons (wrap lines, copy) kept on the right. v2 adds a green ▶ run button: on click the fence's command is executed by the host route (user decision: no confirmation dialog) and its output appears in a card under the code.

Which fences: on DSH 0.2 the banner names a language only when DSH can highlight it (`bash`, `sh`, `zsh`, `shell`…), so those are recognised by their label. Any other fence reads "Code block" with no class, so `console` and `shell-session` are recognised by their source instead: a first line that is a `$ ` prompt (a transcript). A transcript runs only its `# kybernos-terminal

 lines, never the output between them. `pwsh` has no such trace and is not dressed.

## How it works

Pure DOM decoration on the stable markers the chat already renders (same contract dsh-mermaid relies on):

- `div.md-code-block` — gets the `kbtrm` class;
- `[data-code-block-banner]` — receives a `.kbtrm-bar` title bar prepended; the native language label is hidden by CSS, nothing is removed;
- the `# kybernos-terminal

Dresses the shell code fences of the DSH chat as terminal windows: mac traffic-light dots + `~ zsh` title on the left, language badge and the NATIVE buttons (wrap lines, copy) kept on the right. v2 adds a green ▶ run button: on click the fence's command is executed by the host route (user decision: no confirmation dialog) and its output appears in a card under the code.

Which fences: on DSH 0.2 the banner names a language only when DSH can highlight it (`bash`, `sh`, `zsh`, `shell`…), so those are recognised by their label. Any other fence reads "Code block" with no class, so `console` and `shell-session` are recognised by their source instead: a first line that is a `$ ` prompt (a transcript). A transcript runs only its `# kybernos-terminal

 lines, never the output between them. `pwsh` has no such trace and is not dressed.

## How it works

Pure DOM decoration on the stable markers the chat already renders (same contract dsh-mermaid relies on):

- `div.md-code-block` — gets the `kbtrm` class;
- `[data-code-block-banner]` — receives a `.kbtrm-bar` title bar prepended; the native language label is hidden by CSS, nothing is removed;
 prompt is a CSS `::before` on the first line of the `<code>` (inline text, so the `<pre>`'s overflow cannot clip it), added only when the source does not already start with one (`kbtrm-prompt`). It is not part of the text, so copy and run never see it.

Styling uses `--dsw-*` tokens only, so light/dark theme switches repaint for free. A debounced `MutationObserver` on `document.documentElement` (never `body` — evaluated from `<head>`) picks up newly streamed messages; disposal removes the style, the bars and the classes.

## Files

- `client/client.js` — the browser half (module-loader factory, guarded by try/catch: an exception degrades to "plugin disabled", it never blocks the GUI boot);
- `index.js` — the host half: `POST /kybernos-terminal/run` and its guards (below);
- `cordis.patch.yml` — profile layer-stack insert;
- `help.json` — the text the Suite shows on the module's page.

## Install (what a machine needs)

1. `packages/kybernos-terminal` present in the repo;
2. `~/.dsh/profiles/web/package.json`: dependency `link:` + bundle listed in `dsh.profile.bundles`;
3. symlink `~/.dsh/profiles/web/node_modules/@local/kybernos-terminal` → the package folder (the profile loader resolves client entries from `node_modules` — a missing symlink silently leaves the plugin unloaded, with no boot error);
4. restart DSH (`relancer_dsh`).

## Deliberate limits

- The route runs exactly what the page sends (same trust level as the agent's own bash) — the user explicitly chose NO confirmation dialog (08/10).
- DSH serves plugin routes before its own login and an `Origin` header is forgeable by any local program, so the route needs DSH's signed browser-session cookie as well as a strict same-origin request (the same check as the automations route of `@local/kybernos`). Without the cookie it answers 401. It fails closed: if the machine secret that signs the cookie cannot be read it answers 503 and runs nothing, where the automations route falls back to the Origin rule. Measured before this guard (2026-10-09): `curl -H 'Origin: http://127.0.0.1:<port>'` with no cookie ran a command.
- The request body is capped at 16 KiB.
- One bounded process per click: single `zsh -c`, 30 s hard timeout (SIGTERM, reported as `timedOut`), output capped at 64 KiB per stream, command capped at 500 chars.
- No streaming: the output card fills when the process ends. A streaming (SSE) version is the possible v3.

## Tests

```bash
node packages/kybernos-terminal/test-host.mjs        # the route: cookie, origin, fail-closed, bounds; CI runs it
python3 packages/kybernos-terminal/test/verify.py    # the client in a real browser, on the DOM DSH 0.2 renders; needs Python Playwright (CI does not run it)
```
