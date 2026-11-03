// The file as it goes back to disk: the original text with only the slides replaced, so the head, the theme, the inline runtime and everything else a deck file
// holds stay exactly as they were (nothing else is parsed and re-written).
const OPEN = /<main\b[^>]*\bid\s*=\s*["']?deck["']?[^>]*>/i

/** `text` with the content of `<main id="deck">` replaced by `slides` (the cells, one per line). Throws when the file has no such block. */
export function replaceDeck (text, slides) {
  const open = OPEN.exec(text)
  if (open === null) throw new Error('This file is not a Kybernos deck.')
  const from = open.index + open[0].length
  const close = /<\/main\s*>/i.exec(text.slice(from))
  if (close === null) throw new Error('This file is not a Kybernos deck.')
  return text.slice(0, from) + '\n' + slides + '\n' + text.slice(from + close.index)
}
