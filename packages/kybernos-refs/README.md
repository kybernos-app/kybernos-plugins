# `@local/kybernos-refs`

Turns every markdown link in a chat message into a small grey **reference chip** placed at the end of its
sentence, so long URLs stop breaking the reading flow. Clicking a chip opens a card with the page's host, its
URL and an *Open* link.

The bundle is **browser-only**: the host half (`index.js`) is an empty `apply()` that the bundle manifest requires.

## What the user sees

- Each block (`p`, `li`, `h1`–`h5`, `blockquote`, `dd`, `dt`, `td`, `th`) that holds `http(s)` links gets **one chip**,
  appended as its last element (before a nested list inside an `li`). The original links are hidden (CSS,
  `[data-kyb-replaced]`).
- The chip shows a coloured initial (its hue comes from the site's name, so a site always has the same colour), the first
  source's name and « +N » when the block cites N more distinct addresses. `https://www.llm-stats.com/x` is `llm-stats`,
  `https://www.bbc.co.uk/x` is `bbc`. The same address twice is one source.
- Click opens a card above the chip (below when there is no room), clamped to the viewport, listing every source of the
  block in document order: initial, link text (host when empty), host, `↗`. A row opens the page in a new tab
  (`noreferrer noopener`). `Esc` or a click elsewhere closes the card. Ctrl/Cmd/Shift-click on the chip follows the first
  link natively.
- Links inside `pre` / `code`, and links outside `div[class*="_markdown_"]`, are left alone.
- No site icon is fetched (that would tell a third party which sites you read): the coloured initial stands in for it.

## Why the chips used to move

The first version moved every chip of a block to the end of the block on every pass when it was not the last one. With two
chips in one block each move put the other out of place, so they swapped places forever (32 DOM moves in 1.5 s measured), and
the observer woke itself on its own moves. Now one chip per block, a pass that writes nothing when the block is unchanged
(`place` only moves a group that is not where it belongs), and an observer that ignores mutations made by our own nodes.

## Host, files, settings

- Host routes or tools: none.
- Files, settings, env vars, `localStorage`: none read or written.
- Streaming: a `MutationObserver` on `document.documentElement` re-runs the pass 200 ms after DOM changes that are not ours.
  The pass is idempotent and keeps the chip last in its block while text streams in; a link or a text completed by
  streaming rebuilds the chip (its signature changes), keeping an open card open.

## DSH seams and network

- Loaded through `window.__ModuleLoader__.load`; the factory returns `{ apply }` with no `inject`, so it uses **no
  DSH service**. It only depends on the DOM: the generated `_markdown_` class fragment and the `--dsw-alias-*` theme
  tokens (each with a fallback colour). On a load error it returns a disabled plugin so the GUI still starts.
- `remote.*`: none declared. No `fetch`, `EventSource` or XHR in the bundle (checked). The only navigation is the
  user clicking *Open*, which uses `target="_blank"` with `rel="noreferrer noopener"`.

## Tests

`node packages/kybernos-refs/test-refs.mjs`: the pure helpers (cut out of `client.js`, between `KB-REFS-PURE-BEGIN/END`),
source-level guards, and, when jsdom is importable (`KYBERNOS_JSDOM=<path to jsdom/lib/api.js>`, as in
`kybernos-flow/test-client.mjs`), the DOM behaviour: one chip per block, no write on an unchanged page, no movement over 1.5 s,
streaming text and links, nested lists, open/close. Without jsdom the DOM part is skipped and says so.

## Known limits

- Multi-part public suffixes are handled for the common second levels only (`co`, `com`, `org`, `net`, `gov`, `edu`, `ac`).
- The observer, the document listeners and the `<style>` tag are not registered with `ctx.effect`, so nothing
  removes them if the bundle is unloaded (hot reload behaviour not verified).
- Not built: a chips/links switch in the appearance menu, and page titles fetched by the host.
