// The `create_deck` tool: the model describes a presentation (titles, bullets, numbers, a chart…) and gets a `.deck.html` file in the working folder, which the person reads, plays
// and EDITS in the right-hand panel (the deck editor of this plugin). A `.pptx` written by a script can only be previewed there, never changed; this is the way to make slides
// the person can work on. The file is built by deck-build.mjs from the player the installed deck editor carries; it is handed over with `deliver_files` like any other file.
//
// Pure: the services it needs (`workingDirectory`, `deckAssets`, `io`) are handed in, so the test runs without DSH.
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { MAX_IMAGE_BYTES, MAX_SLIDES, buildDeck, dataUri, imageKind, normalize } from './deck-build.mjs'
import { inspect } from './office-guard.mjs'

export const TOOL = 'create_deck'

export const DESCRIPTION = 'Makes a slide deck (a presentation, a pitch, a report as slides) as a ".deck.html" file that the person can read, play full screen AND EDIT in the right-hand panel: '
  + 'change any text, restyle it, move or add blocks, add, copy, move or delete slides, pick colours, add pictures. Use it for EVERY presentation or slide request, and write a .pptx only when the person '
  + 'asks for PowerPoint itself (a .pptx can only be previewed here, never edited). Describe the content, not the look: each slide has a "layout" and the fields that layout needs; the file is laid out for you. '
  + 'Layouts: cover (title, subtitle?, tagline?), section (title, number?, subtitle?), bullets (title, bullets: up to 8 short sentences), text (title, paragraphs), two-columns (title, left: {heading?, bullets}, right: same), '
  + 'stats (title, stats: 2 to 4 of {value, label}), chart (title, chart: {type: column|bar|line|doughnut, categories, series: [{name, values}]}), table (title, table: {header, rows}), '
  + 'quote (quote, by?), image (title?, image: {path of a png/jpg/gif/webp file in the working folder, caption?}). Every slide takes "notes" (what to say) and an optional "transition" (fade, push, wipe). '
  + 'Good decks: one idea per slide, a sentence as the title (the message, not the topic), 4 or 5 bullets at most, a chart or stats slide for any number worth showing, a cover first and a closing slide last, '
  + 'speaker notes on every slide. Write the text in the person\'s language and set "language" (en or fr). Pick "theme" colours that suit the subject (primary: dark slides and titles; accent: highlights), as #RRGGBB. '
  + 'Paths are relative to the working folder and end with ".deck.html". Then hand the file over with deliver_files, in your last message of the turn.'

/** How many copies of the replaced decks stay next to a deck: the newest ones. */
export const KEEP_BACKUPS = 3

/** A sortable stamp for a copy's name: 20261105-101500-123. */
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '-').replace('Z', '')

/** Copies the deck about to be replaced next to it and trims the old copies. Returns the copy's file name; a trim that fails never fails the write. */
const keepPrevious = async (io, target, bytes) => {
  const name = basename(target) + '.' + stamp() + '.bak'
  await io.writeFile(join(dirname(target), name), bytes)
  try {
    if (typeof io.readdir === 'function' && typeof io.rm === 'function') {
      const mine = (await io.readdir(dirname(target))).filter((n) => n.startsWith(basename(target) + '.') && n.endsWith('.bak')).sort().reverse()
      for (const old of mine.slice(KEEP_BACKUPS)) await io.rm(join(dirname(target), old))
    }
  } catch (e) { /* the copies stay: only the trim failed */ }
  return name
}

const text = (extra) => ({ type: 'string', ...extra })
const list = (items, extra) => ({ type: 'array', items, ...extra })
// DSH's tool schema wants `additionalProperties` said on every object: the slides are lenient (a stray field is ignored), the small objects are strict.
const obj = (properties, extra) => ({ type: 'object', additionalProperties: false, properties, ...extra })

export const PARAMETERS = {
  path: text({ required: true, description: 'Where to write the deck, relative to the working folder, ending in ".deck.html" (e.g. "q3-review/q3-review.deck.html"). A deck already at that path is replaced, and its previous version is kept next to it (a ".bak" file): say so to the person.' }),
  title: text({ required: true, description: 'The title of the deck (shown as the file\'s title).' }),
  language: text({ description: '"en" or "fr": the language of the text (default en).' }),
  theme: obj({ primary: text({}), accent: text({}) }, { description: 'Colours: { primary, accent } as #RRGGBB. Primary colours the dark slides and the titles, accent the highlights.' }),
  slides: list({
    type: 'object',
    additionalProperties: true,
    properties: {
      layout: text({ required: true, description: 'cover, section, bullets, text, two-columns, stats, chart, table, quote or image.' }),
      title: text({ description: 'The slide\'s title: a full sentence stating the message. Required for every layout except quote and image.' }),
      subtitle: text({ description: 'cover and section only.' }),
      tagline: text({ description: 'cover only: a short highlighted line.' }),
      number: text({ description: 'section only: "01", "02"…' }),
      bullets: list(text({}), { description: 'bullets layout: up to 8 short sentences. **bold** works.' }),
      paragraphs: list(text({}), { description: 'text layout: up to 6 paragraphs.' }),
      left: obj({ heading: text({}), bullets: list(text({}), {}) }, { description: 'two-columns layout: { heading?, bullets: [...] }.' }),
      right: obj({ heading: text({}), bullets: list(text({}), {}) }, { description: 'two-columns layout: { heading?, bullets: [...] }.' }),
      stats: list(obj({ value: text({ description: 'The big number or figure, e.g. "4.8 M€" or "+18 %".' }), label: text({ description: 'What it measures.' }) }), { description: 'stats layout: 2 to 4 items.' }),
      chart: obj({
        type: text({ description: 'column, bar, line or doughnut (a doughnut shows shares of the first series).' }),
        categories: list(text({}), { description: 'The labels (2 to 12).' }),
        series: list(obj({ name: text({}), values: list({ type: 'number' }, { description: 'One number per category.' }), color: text({ description: 'Optional #RRGGBB.' }) }), { description: 'Up to 4 series (1 for a doughnut).' }),
        labels: { type: 'boolean', description: 'Show the values on the chart (default true for up to 8 categories).' },
        alt: text({ description: 'One sentence describing the chart for people who cannot see it.' })
      }, { description: 'chart layout.' }),
      table: obj({ header: list(text({}), {}), rows: list(list(text({}), {}), {}) }, { description: 'table layout: up to 10 rows and 6 columns, every cell as text.' }),
      quote: text({ description: 'quote layout: the sentence.' }),
      by: text({ description: 'quote layout: who said it.' }),
      image: obj({ path: text({ description: 'A png, jpg, gif or webp file in the working folder (at most 4 MB).' }), alt: text({}), caption: text({}) }, { description: 'image layout.' }),
      notes: text({ description: 'Speaker notes for this slide.' }),
      transition: text({ description: 'fade (default), push or wipe.' })
    }
  }, { required: true, description: 'The slides, in order (1 to ' + MAX_SLIDES + ').' })
}

const plain = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

/** `target` as a path inside `cwd`, or null: a deck is written, and its pictures are read, in the working folder only. */
export const inside = (cwd, p) => {
  if (typeof p !== 'string' || p.trim() === '' || p.includes('\0') || p.length > 500) return null
  const target = resolve(cwd, p)
  const rel = relative(cwd, target)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) ? target : null
}

/** The tool's definition, in the « spec » form the host turns into `defineTool`. `services()` hands back what is needed at call time (or null while DSH has not started them). */
export function deckTool (services) {
  return {
    options: {
      name: TOOL,
      description: DESCRIPTION,
      parameters: PARAMETERS,
      render: (_args, value) => [{ type: 'text', text: plain(value) ? 'Deck written: ' + value.path + ' (' + value.slides + ' slides). Hand it over with deliver_files.' + (typeof value.previous === 'string' ? ' A deck was already there: its previous version is kept as ' + value.previous + '. Tell the person.' : '') : String(value) }],
      execute: async (args, exec) => {
        const svc = services()
        if (svc === null) throw new Error('create_deck is not ready: DSH has not started the services it needs')
        if (!plain(args)) throw new Error('create_deck needs { path, title, slides }')
        if (!plain(exec) || !plain(exec.agent)) throw new Error('create_deck needs a chat session')
        const cwd = await svc.workingDirectory.ensure(exec.agent, exec.signal)
        if (typeof args.path !== 'string' || !/\.deck\.html$/i.test(args.path)) throw new Error('The path must end with ".deck.html", e.g. "my-talk/my-talk.deck.html".')
        const target = inside(cwd, args.path)
        if (target === null) throw new Error('The deck must be written inside the working folder: use a relative path.')
        const seen = normalize({ title: args.title, language: args.language, theme: args.theme, slides: args.slides })
        if (!seen.ok) throw new Error(seen.error)
        const deck = seen.deck
        // The pictures of `image` slides: read from the working folder, checked, embedded in the file (a deck is one file).
        const pictures = new Map()
        for (const s of deck.slides) {
          if (s.layout !== 'image' || s.image.path === '' || pictures.has(s.image.path)) continue
          const file = inside(cwd, s.image.path)
          const kind = imageKind(s.image.path)
          if (file === null || kind === null) throw new Error('The picture "' + s.image.path + '" must be a png, jpg, gif or webp file inside the working folder.')
          let info
          try { info = await svc.io.stat(file) } catch (e) { throw new Error('The picture "' + s.image.path + '" was not found. Make the file first, then call create_deck.') }
          if (!info.isFile() || info.size > MAX_IMAGE_BYTES) throw new Error('The picture "' + s.image.path + '" is not a file or is larger than ' + MAX_IMAGE_BYTES / 1048576 + ' MB.')
          pictures.set(s.image.path, dataUri(kind, await svc.io.readFile(file)))
        }
        const assets = await svc.deckAssets()
        if (!assets.ok) throw new Error('The deck editor is not installed on this computer, so no deck can be made. Say so, and offer another format.')
        const built = buildDeck(deck, assets, pictures)
        if (!built.ok) throw new Error(built.error)
        // A file already there is replaced only if it is a deck (one this tool made, or one the person kept editing): never a different file that happens to share the name.
        let existing = null
        try { existing = await svc.io.readFile(target) } catch (e) { existing = null }
        if (existing !== null && !inspect('deck', new Uint8Array(existing)).ok) throw new Error(args.path + ' already exists and is not a slide deck: choose another name.')
        await svc.io.mkdir(dirname(target))
        // The deck there may hold what the person edited and saved by hand: it is kept as a copy before it is replaced (the latest KEEP_BACKUPS), and the answer says so.
        let previous
        if (existing !== null && !Buffer.from(existing).equals(Buffer.from(built.html))) previous = await keepPrevious(svc.io, target, existing)
        const tmp = join(dirname(target), '.' + basename(target) + '.' + process.pid + '.tmp')
        await svc.io.writeFile(tmp, built.html)
        await svc.io.rename(tmp, target)
        return { path: args.path, slides: built.slides, bytes: Buffer.byteLength(built.html), ...(previous !== undefined ? { previous: dirname(args.path) === '.' ? previous : dirname(args.path) + '/' + previous } : {}) }
      }
    }
  }
}
