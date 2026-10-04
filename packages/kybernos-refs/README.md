# `@local/kybernos-refs`

Turns every markdown link in a chat message into a small grey **reference chip** placed at the end of its
sentence, so long URLs stop breaking the reading flow. Clicking a chip opens a card with the page's host, its
URL and an *Open* link.

The bundle is **browser-only**: the host half (`index.js`) is an empty `apply()` that the bundle manifest requires.

## What the user sees

- Each `http(s)` link in a rendered message is hidden (CSS, `[data-kyb-remplacee]`) and a chip is appended as the
  last element of the enclosing block (`p`, `li`, `h1`–`h5`, `blockquote`, `dd`, `dt`, `td`, `th`).
- The chip label is the second-to-last label of the host: `https://www.llm-stats.com/x` becomes `llm-stats`.
- Hover shows an accent wash and a `↗` arrow. Click opens a card above the chip (below when there is no room),
  clamped to the viewport. `Esc` or a click elsewhere closes it. Ctrl/Cmd/Shift-click follows the link natively.
- The card title is the link text (falls back to the host); the page's real title is not fetched.
- Links inside `pre` / `code`, and links outside `div[class*="_markdown_"]`, are left alone. Whether user messages
  use the same container class as assistant messages: not verified.

## Host, files, settings

- Host routes or tools: none.
- Files, settings, env vars, `localStorage`: none read or written.
- Streaming: a `MutationObserver` on `document.documentElement` re-runs the pass 200 ms after DOM changes. The pass
  is idempotent and keeps each chip last in its block while text streams in.

## DSH seams and network

- Loaded through `window.__ModuleLoader__.load`; the factory returns `{ apply }` with no `inject`, so it uses **no
  DSH service**. It only depends on the DOM: the generated `_markdown_` class fragment and the `--dsw-alias-*` theme
  tokens (each with a fallback colour). On a load error it returns a disabled plugin so the GUI still starts.
- `remote.*`: none declared. No `fetch`, `EventSource` or XHR in the bundle (checked). The only navigation is the
  user clicking *Open*, which uses `target="_blank"` with `rel="noreferrer noopener"`.

## Tests

None in the bundle, and no `scripts/test-*.mjs` covers it. Only a syntax check was run:
`node --check packages/kybernos-refs/client.js`.

## Known limits

- Multi-part public suffixes give a poor label: `https://www.bbc.co.uk/x` is labelled `co`.
- The card's *Open ↗* label is hard-coded French, and `kybernos-language`'s live translation does not reach chat
  messages, so it stays French in every language.
- The observer, the document listeners and the `<style>` tag are not registered with `ctx.effect`, so nothing
  removes them if the bundle is unloaded (hot reload behaviour not verified).
- Planned in the source comments, not built: a chips/links switch in the appearance menu, and page titles fetched by
  the host.
- The source comments point to `docs/handoff/references-epurees/maquette-v3`, which is not in this repository.
