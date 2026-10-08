# `@local/dsh-mermaid`

Renders ` ```mermaid ` fences in DSH chat answers as themed SVG diagrams, with no network call from the plugin.

## What the user sees

- A mermaid fence keeps its block, and a card with the diagram appears under it. The raw source is hidden; a
  `Code` / `Diagramme` button flips between the two. On DSH 0.2 the block's label does not say `mermaid` (it reads
  "Code block", because DSH only names a language it can highlight), so the fence is recognised by its source: a
  first line that is a diagram header (`flowchart TD`, `sequenceDiagram`, `pie`, ...), after any front matter or `%%`
  line.
- A fence that does not parse shows "Diagramme mermaid invalide - <first error line>" in a card with an error
  border, and the source stays visible. Fences in other languages are left alone.
- Colours come from the DSH `--dsw-*` tokens (dark fallback palette if a token is unreadable). The diagram
  is redrawn when the theme changes, without stacking duplicates.
- Assistant markdown is treated as untrusted: mermaid runs with `securityLevel: 'strict'` and HTML labels
  off, so a diagram cannot inject HTML or clickable links.

## Host half

None. `index.js` exports a no-op `apply()`: no route, service or tool. It exists only because the profile
loader composes the package as an ordinary entry.

## Files, settings, environment

At runtime: none read, none written, no setting, no env var. The client adds one `<style data-plugin>` and
sets the page flag `window.__DSH_MERMAID_ACTIVE__` so it installs once per page. At build time only,
`DSH_MERMAID_DEPS` points to a folder that holds `mermaid` and `esbuild`.

## DSH seams and network

- No DSH service: client `inject: []`, empty `dsh.client.inject`, no `remote.*`.
- The markdown renderer exposes no per-language hook (stated in `src/plugin.js`), so the plugin watches the
  DOM instead: a `div.md-code-block` whose banner reads `mermaid`, or whose `<code>` has `language-mermaid`, or
  (DSH 0.2) whose un-highlighted `<pre>` opens with a diagram header, through a `MutationObserver` on `<html>` with
  a 120 ms debounce. A highlighted block (`pre.shiki`) is never taken. This is
  outside the plugin seams and depends on the renderer's DOM. A second observer watches `class`, `style`,
  `data-theme`, `data-dsw-theme` and `data-ds-theme-source` on `<html>` for theme changes.
- Network: none in the plugin code. The mermaid bundle is self-contained (IIFE); its own code was not audited.
- Cleanup goes through `ctx.effect`: cards, style and observers are removed on dispose.

## Vendored library

mermaid 11.14.0 (MIT), bundled by esbuild into `vendor/mermaid.iife.js`, then inlined with `src/plugin.js`
into `client/client.js` (2.9 MB, generated, never edit). Rebuild with `node scripts/build.mjs` once `mermaid`
and `esbuild` resolve from `DSH_MERMAID_DEPS`, this folder or `~/.dsh/profiles/web`. `vendor/NOTICES.md`
lists mermaid and the dependencies bundled with it (KaTeX, DOMPurify, Cytoscape.js and others, with licences). Without `mermaid`/`esbuild` on the machine, `node scripts/build.mjs` reuses the vendored bundle as it is (checked: with an unchanged `src/plugin.js` it reproduces `client/client.js` byte for byte), so a change to the plugin body does not need them.

## Tests

```bash
python3 test/verify.py      # same as `npm test`; needs Python Playwright and its Chromium
```

It loads `test/harness.html` (the DOM DSH 0.2.0-rc.2 really renders: generic "Code block" label, source in
`[data-code-block-content]`; the bench used to copy a DOM labelled `mermaid`, so it passed while the real GUI drew
nothing) and `test/entete.html` (the bundle evaluated in `<head>` with `document.body` still null, as the real GUI
does), then runs 19 checks: valid fence rendered with source hidden but intact, code/diagram toggle, invalid fence,
a highlighted fence and a non-diagram fence untouched, the older flat DOM, theme change without duplicates,
activation from `<head>`, no console error. It writes a screenshot to `/tmp/dsh-mermaid-harness.png`. CI does not
run it (Python, outside the `packages/*/test*.mjs` glob).

```bash
node packages/dsh-mermaid/test-detect.mjs      # no browser: which first lines count as a diagram header; CI runs it
```

## Known limits

- The toggle labels and the error message are French.
- Reading the code (not reproduced): after a render error the source is shown through a CSS class that only
  the toggle button removes, so a later successful redraw (for example once a streamed fence is complete)
  keeps the source visible next to the diagram, and the button label is not resynchronised.
- Only blocks with non-empty source are drawn. Diagram types depend on what mermaid 11.14.0 supports.
- On DSH 0.2 a fence is recognised by its first line, so a diagram that opens with something else (a multi-line
  `%%{init}%%` directive, a header this plugin does not list) is left as plain code.
