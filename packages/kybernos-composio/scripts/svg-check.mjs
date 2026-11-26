// Structural checks for the logo SVGs of catalog.js. Shared by scripts/build-catalog.mjs (which
// refuses to write a catalog with a defect) and by test-client.mjs (which checks the one on disk).
//
// A logo is injected as raw HTML in the page, so a defect is not a harmless typo: a tag name
// glued to an attribute (`<linearGradientid=...`, found in the cloud repo that feeds the
// catalog) is an unknown element, the gradients it should declare do not exist and the logo
// renders blank or wrong; an `<image href>` that is a relative URL asks the server for a file
// that is not there. These checks need no XML library (none ships in this repo): the SVGs are
// machine generated and flat enough for a tokenizer.

// Elements a logo may use. Anything else, and anything that can run code or load another
// document (script, foreignObject, iframe, animation...), is a defect.
const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'symbol', 'use', 'image', 'filter',
  'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix', 'feDiffuseLighting',
  'feDisplacementMap', 'feDistantLight', 'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR',
  'feGaussianBlur', 'feImage', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight',
  'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence', 'text', 'tspan',
])
const ATTR = /\s+([A-Za-z_:][A-Za-z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/y

/**
 * Every structural defect of one SVG string, as short sentences (empty array: none).
 * Checks: a single well-formed <svg> root; only known elements; attributes written
 * name="value" and separated by a space; balanced tags; every url(#id) and href="#id" points to an
 * id that exists; every href is a fragment or an inline data:image URI (never a relative or
 * remote URL); no repeated id.
 */
export function svgProblems(svg) {
  const problems = []
  const text = String(svg)
  const ids = new Map()
  const refs = []
  const stack = []
  let root = 0
  let pos = 0
  const tag = /<(\/?)([^\s>\/!?][^\s>\/]*)([^>]*)>/g
  let m
  while ((m = tag.exec(text)) !== null) {
    if (text.slice(pos, m.index).trim() !== '' && stack.length === 0) problems.push('text outside the <svg> root')
    pos = m.index + m[0].length
    const closing = m[1] === '/'
    const name = m[2]
    let rest = m[3]
    if (ELEMENTS.has(name) !== true) problems.push('unknown element <' + name + '>')
    if (closing) {
      if (rest.trim() !== '') problems.push('closing tag </' + name + '> with attributes')
      const open = stack.pop()
      if (open !== name) problems.push('</' + name + '> closes ' + (open === undefined ? 'nothing' : '<' + open + '>'))
      continue
    }
    const selfClosed = /\/\s*$/.test(rest)
    if (selfClosed) rest = rest.replace(/\/\s*$/, '')
    // attributes: `name="value"`, each preceded by whitespace (a glued `<tagname=` or `"value"name=` is a defect)
    ATTR.lastIndex = 0
    let at = 0
    let a
    while (at < rest.length) {
      ATTR.lastIndex = at
      a = ATTR.exec(rest)
      if (a === null) break
      at = ATTR.lastIndex
      const value = a[2] !== undefined ? a[2] : a[3]
      if (a[1] === 'id') {
        if (ids.has(value)) problems.push('id "' + value + '" is used twice')
        ids.set(value, true)
      }
      if (a[1] === 'href' || a[1] === 'xlink:href') {
        if (/^#[^\s#]+$/.test(value)) refs.push(value.slice(1))
        else if (/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) !== true) problems.push('<' + name + '> href is not a fragment or an inline image: ' + value.slice(0, 40))
      }
      for (const u of value.matchAll(/url\(\s*#([^)\s]+)\s*\)/g)) refs.push(u[1])
    }
    if (rest.slice(at).trim() !== '') problems.push('<' + name + '> has a malformed attribute near "' + rest.slice(at).trim().slice(0, 30) + '"')
    if (name === 'svg' && stack.length === 0) root += 1
    if (selfClosed !== true) stack.push(name)
  }
  if (text.slice(pos).trim() !== '') problems.push('text after the last tag')
  if (stack.length > 0) problems.push('unclosed <' + stack[stack.length - 1] + '>')
  if (root !== 1) problems.push('expected one <svg> root, found ' + root)
  // url(#id) in a style attribute or a <style> is also a reference: scan the raw text as well
  for (const u of text.matchAll(/url\(\s*#([^)\s]+)\s*\)/g)) refs.push(u[1])
  for (const r of new Set(refs)) if (ids.has(r) !== true) problems.push('reference to a missing id "' + r + '"')
  return Array.from(new Set(problems))
}

/**
 * Repairs the mangling found in the cloud repo that feeds the catalog: a space moved inside a
 * tag name or an attribute name and the spaces between attributes were lost
 * (`<linearGradientid="b"x1="83"x2="83"`, `<feFloodflood -opacity="0"`, `<feBlendi n="..."in2="..."`,
 * `<feGaussianBlurresul t="..."`) and a doubled closing quote on the root (`id="a"" xmlns=...`). Only tags are touched, and only the shapes below; whatever
 * stays wrong is reported by svgProblems and stops the build.
 */
export function repairSvg(svg) {
  const names = Array.from(ELEMENTS).sort((a, b) => b.length - a.length)
  return String(svg).replace(/<([A-Za-z][^<>]*)>/g, (whole, inner) => {
    let s = inner
    // 1. the element name glued to its first attribute, or to the start of one
    const first = /^[^\s/]+/.exec(s)[0]
    if (ELEMENTS.has(first) !== true) {
      const known = names.find((n) => first.startsWith(n))
      if (known !== undefined) {
        const tail = first.slice(known.length)
        const after = s.slice(first.length)
        const next = /^\s+([^\s/]+)/.exec(after)
        if (tail.indexOf('=') >= 0) s = known + ' ' + tail + after
        else if (next !== null && (next[1].charAt(0) === '-' || /^[A-Za-z_:][\w:.-]*="/.test(next[1]))) s = known + ' ' + tail + next[1] + after.slice(next[0].length)
      }
    }
    // 2. a stray quote after a value (`id="a"" xmlns=...`; an empty value `=""` is left alone)
    s = s.replace(/([^=\s])""/g, '$1"')
    // 3. an attribute that starts right after the closing quote of the previous one
    s = s.replace(/"(?=[A-Za-z_:][\w:.-]*=")/g, '" ')
    return s === inner ? whole : '<' + s + '>'
  })
}
