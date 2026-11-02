// kybernos-db/share: the page that shows a shared dashboard, built as text. ONE page for every snapshot, the same bytes whatever it shows:
//  - the server hosting snapshots serves `viewerHtml()` at the link and the snapshot (or its sealed envelope) beside it as JSON; the page loads it and draws it;
//  - a file the person keeps or sends by hand is `exportFile(...)`: the same page with the snapshot inside it, nothing to load, nothing to send.
// The page is a script, a style sheet and an empty root. Its content policy allows exactly that script and that style (by hash) and, on the server, one fetch of the same site.
// A snapshot is data: it is drawn as text nodes and a few SVG shapes (render.mjs), it never becomes HTML.
//
// The script is assembled from the files of this folder: the chart geometry, the seal, the renderer and the start, with their `import` and `export` stripped (browsers run it as a plain
// script), in one function. A name that two files both declare would silently be the last one's, so `viewerScript()` refuses it.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const here = (name) => new URL('./' + name, import.meta.url)
const read = (name) => readFileSync(here(name), 'utf8')
const PARTS = ['vendor/chart-core.mjs', 'seal.mjs', 'render.mjs', 'boot.mjs']
const NAME = /^(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/

// The lines of a source without its whole-line comments (a line of //, a block of slash-star over one line or several): they are for readers of the source, and a page is no place for them.
function withoutComments (lines) {
  const out = []
  let inBlock = false
  for (const line of lines) {
    const t = line.trim()
    if (inBlock) { if (t.includes('*/')) inBlock = false; continue }
    if (t.startsWith('//')) continue
    if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; continue }
    out.push(line)
  }
  return out
}

/** The script, as one string: the four files in order, inside one function in strict mode. */
export function viewerScript () {
  const seen = new Map()
  const body = PARTS.map((part) => {
    const lines = withoutComments(read(part).split('\n')).filter((line) => !/^import\s.*from\s+'[^']+'\s*$/.test(line)).map((line) => line.replace(/^export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/, ''))
    for (const line of lines) {
      if (/^(?:import|export)\b/.test(line)) throw new Error(part + ': a line the page build does not handle: ' + line.slice(0, 80))
      const m = NAME.exec(line)
      if (m === null) continue
      if (seen.has(m[1])) throw new Error('two files of the page declare "' + m[1] + '": ' + seen.get(m[1]) + ' and ' + part)
      seen.set(m[1], part)
    }
    return '// ── ' + part + '\n' + lines.join('\n')
  }).join('\n')
  if (/<\/script|<!--/i.test(body)) throw new Error('the page script holds text that would end or hide itself in HTML')
  return "(function () {\n'use strict'\n" + body + '\nkvBoot()\n})()\n'
}

const GRID = Array.from({ length: 12 }, (_, i) => '.kv-s' + (i + 1) + '{grid-column:span ' + (i + 1) + '}').join('') + Array.from({ length: 8 }, (_, i) => '.kv-r' + (i + 1) + '{grid-row:span ' + (i + 1) + '}').join('')

/** The style sheet: viewer.css, then the grid spans a widget is given by its size (on a phone the spans are off, see the media query in viewer.css). */
export function viewerCss () {
  const css = read('viewer.css')
  const at = css.indexOf('@media (max-width:760px)')
  if (at < 0) throw new Error('viewer.css has no narrow-screen block')
  return css.slice(0, at) + '@media (min-width:761px){' + GRID + '}\n' + css.slice(at)
}

const sha = (text) => "'sha256-" + createHash('sha256').update(text, 'utf8').digest('base64') + "'"
const escapeText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** JSON that sits in a `<script type="application/json">`: no `<` can end the element or open a comment. */
const inertJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c')

/** The content policy of the page. `fetchOwnSite`: the page loads its snapshot from the site that serves it (the server); a file loads nothing at all. */
export function viewerPolicy ({ script, css, fetchOwnSite }) {
  return ["default-src 'none'", 'script-src ' + sha(script), 'style-src ' + sha(css), "img-src 'none'", 'connect-src ' + (fetchOwnSite ? "'self'" : "'none'"), "base-uri 'none'", "form-action 'none'"].join('; ')
}

/**
 * The page. With nothing given it is the page the server serves (the snapshot is fetched from the same address plus `.json`, or from `docPath`). With `doc` (a snapshot or a sealed
 * envelope) the page carries it. Returns { html, policy }: the server sends the policy as a header too (the `<meta>` is the file's own, and cannot say `frame-ancestors`).
 */
export function viewerHtml ({ doc, docPath, title } = {}) {
  const script = viewerScript()
  const css = viewerCss()
  const embedded = doc !== undefined
  const policy = viewerPolicy({ script, css, fetchOwnSite: !embedded })
  const sealed = embedded && doc !== null && typeof doc === 'object' && doc.sealed === true
  const heading = sealed ? 'Protected dashboard' : (embedded && typeof doc.title === 'string' && doc.title !== '' ? doc.title.slice(0, 120) : title || 'Dashboard')
  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" content="' + escapeText(policy) + '">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    '<meta name="robots" content="noindex, nofollow">',
    '<meta name="color-scheme" content="light dark">',
    '<title>' + escapeText(heading) + '</title>',
    '<style>' + css + '</style>',
    '</head>',
    '<body>',
    '<div id="kv-root"' + (!embedded && docPath !== undefined ? ' data-doc="' + escapeText(docPath) + '"' : '') + '></div>',
    '<noscript><p>This page needs JavaScript to draw the dashboard.</p></noscript>',
    embedded ? '<script type="application/json" id="kv-doc">' + inertJson(doc) + '</script>' : '',
    '<script>' + script + '</script>',
    '</body>',
    '</html>',
    '',
  ].filter((l) => l !== '').join('\n')
  return { html, policy }
}

/** A snapshot (or a sealed envelope) as one file to keep or to send: open it in any browser. */
export const exportFile = (doc, options = {}) => viewerHtml({ doc, ...options }).html
