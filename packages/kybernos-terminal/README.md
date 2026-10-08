# kybernos-terminal

Dresses the shell code fences (`bash`, `sh`, `zsh`, `shell`, `console`, `powershell`…) of the DSH chat as terminal windows: mac traffic-light dots + `~ zsh` title on the left, language badge and the NATIVE buttons (wrap lines, copy) kept on the right. v2 adds a green ▶ run button: on click the fence's command is executed by the host route (user decision: no confirmation dialog) and its output appears in a card under the code.

## How it works

Pure DOM decoration on the stable markers the chat already renders (same contract dsh-mermaid relies on):

- `div.md-code-block` — gets the `kbtrm` class;
- `[data-code-block-banner]` — receives a `.kbtrm-bar` title bar prepended; the native language label is hidden by CSS, nothing is removed;
- the `$` prompt is a CSS `::before` on the `pre`, added only when the source does not already start with one (`kbtrm-prompt`).

Styling uses `--dsw-*` tokens only, so light/dark theme switches repaint for free. A debounced `MutationObserver` on `document.documentElement` (never `body` — evaluated from `<head>`) picks up newly streamed messages; disposal removes the style, the bars and the classes.

## Files

- `client/client.js` — the whole plugin (module-loader factory, guarded by try/catch: an exception degrades to "plugin disabled", it never blocks the GUI boot);
- `index.js` — no-op host half (the profile loader composes the package as an ordinary entry);
- `cordis.patch.yml` — profile layer-stack insert.

## Install (what a machine needs)

1. `packages/kybernos-terminal` present in the repo;
2. `~/.dsh/profiles/web/package.json`: dependency `link:` + bundle listed in `dsh.profile.bundles`;
3. symlink `~/.dsh/profiles/web/node_modules/@local/kybernet-terminal` → the package folder (the profile loader resolves client entries from `node_modules` — a missing symlink silently leaves the plugin unloaded, with no boot error);
4. restart DSH (`relancer_dsh`).

## Deliberate limits

- The route runs exactly what the page sends, same-origin only (same trust level as the agent's own bash) — the user explicitly chose NO confirmation dialog (08/10).
- One bounded process per click: single `zsh -c`, 30 s hard timeout (SIGTERM, reported as `timedOut`), output capped at 64 KiB per stream, command capped at 500 chars.
- No streaming: the output card fills when the process ends. A streaming (SSE) version is the possible v3.

