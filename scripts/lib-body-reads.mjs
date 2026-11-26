// Does a host source read a request body with no cap? A text pattern, not a parser (recette 2026-10-25, fix 14: L3-43).
//
// The bug it keeps out: `req.on('data', (d) => { corps += d })` (or `for await (const c of req) raw += c`), a read that grows with whatever is sent. One POST of more
// than 512 MB made it throw `RangeError: Invalid string length` inside the 'data' listener, where nobody catches it, and DSH ended with all its sessions.
//
// What it does: finds the places a request is read, and asks whether the few lines that follow compare a length with a limit.
//   a read site is   <req|request|incoming>.on('data', …)        the event form
//                    for await (… of <req|request|incoming>)      the iterator form
//                    new Response(<req>…), Readable.toWeb(<req>)  the whole body handed to something that buffers it
//                    an import of 'node:stream/consumers'         text(req), json(req), buffer(req) buffer the whole body
//   it is bounded    when, from the read site to the end of the next 10 lines, a length (`.length`, `.byteLength`, or a counter named size, taille, total, len, n, bytes,
//                    octets, lu, recu, count) is compared with `>` or `>=`; the `corps += d` of the bug has no such line;
//   or acknowledged  when a comment `body-cap: <reason>` stands within 3 lines above the site or on it (a read that is bounded some other way, said in words).
//
// What it cannot see (so this is a net for the old mistake, not a proof): a read made through another name than req / request / incoming (a helper that takes `stream`
// or `r`), a comparison that is there but does not stop anything (checked after the whole body is in memory, or against a limit that is too high), a cap enforced by the
// server framework or a proxy in front, `req.pipe(file)` (bounded by the disk, not by this check), a body read through `req.read()` in a loop, code built from strings,
// and any file outside packages/ and services/. The real guarantee is scripts/test-body-caps.mjs, which sends a body past the cap to every route of the bundles it lists.
//
// Pure: `sources` is [{ file, text }]; nothing is read from the disk here.

const SKIP_FILE = [
  /(^|\/)(test[-.][^/]*|[^/]*\.test\.[^/]*|lib-test[^/]*|lib-session-test[^/]*)$/, // tests and their helpers
  /\/test\//, // a folder of tests
  /(^|\/)client[^/]*\.js$/, // browser code: it reads responses, not requests
  /\/vendor\//, /\.min\./, /\/poc\//, // third-party, minified, proofs of concept
]
const IS_HOST_SOURCE = (file) => /^(packages|services)\//.test(file) && /\.(m?js|cjs)$/.test(file) && SKIP_FILE.every((re) => re.test(file) === false)

const REQUEST = '(?:req|request|incoming)'
const SITES = [
  { kind: 'on-data', re: new RegExp('\\b' + REQUEST + "\\.on\\(\\s*['\"]data['\"]") },
  { kind: 'for-await', re: new RegExp('for\\s+await\\s*\\(\\s*(?:const|let|var)\\s+\\w+\\s+of\\s+' + REQUEST + '\\b') },
  { kind: 'whole-body', re: new RegExp('new\\s+Response\\(\\s*' + REQUEST + '\\b|Readable\\.toWeb\\(\\s*' + REQUEST + '\\b') },
  { kind: 'consumers', re: /from\s+['"](?:node:)?stream\/consumers['"]/ },
]
// A length or a counter compared with `>` or `>=`:  raw.length > 200_000 · size > cap · taille >= plafond · chunks.length > MAX
const COMPARISON = /(?:\.length|\.byteLength|\b(?:size|taille|total|len|n|bytes|octets|lu|recu|count|received)\b)\s*>=?\s*[\w.$(]/
const ACK = /body-cap:\s*\S/
const WINDOW = 10

/** @returns {{ file: string, line: number, kind: string, text: string }[]} the read sites that neither compare a length nor say why they need not. */
export function unboundedReads (sources) {
  const found = []
  for (const { file, text } of sources) {
    if (IS_HOST_SOURCE(file) === false) continue
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      for (const site of SITES) {
        if (site.re.test(line) === false) continue
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue // a comment that talks about the pattern
        const after = lines.slice(i, i + 1 + WINDOW).join('\n')
        // The 'consumers' import has no loop of its own: its use is bounded (or not) wherever it is called, which a text pattern cannot follow, so it needs the acknowledgement.
        const bounded = site.kind !== 'consumers' && site.kind !== 'whole-body' && COMPARISON.test(after)
        const said = lines.slice(Math.max(0, i - 3), i + 1).some((l) => ACK.test(l))
        if (bounded === false && said === false) found.push({ file, line: i + 1, kind: site.kind, text: line.trim().slice(0, 140) })
        break
      }
    })
  }
  return found
}

/** The report printed by `audit-routes.mjs --check`: one line per read site. */
export const reportBodyReads = (found) => (found.length === 0
  ? 'request bodies: every read of a request in packages/ and services/ compares a length with a limit (or says why it need not)'
  : 'request bodies: ' + found.length + ' read(s) of a request with no cap (add a cap like readBody(req, cap) in kybernos-search/guard.mjs, or a `body-cap: <reason>` comment):\n' +
    found.map((f) => '  ' + f.file + ':' + f.line + '  [' + f.kind + ']  ' + f.text).join('\n'))
