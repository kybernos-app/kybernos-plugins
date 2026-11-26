// What the agent is told about the databases without asking: their names, objects and fields, in a short block of its system prompt. Pure.
//
// The block is the same text from one step to the next while nothing changes (no clock, no counter), so the prompt prefix stays cacheable. With no database
// there is nothing to say: the tools carry their own descriptions, and the `db-builder` skill says how to build one. A block that would be too long is
// cut with a pointer to `db_list`, which always answers in full.

import { protectionWord } from './words.mjs'

export const SECTION_NAME = 'kybernos:db'
export const SECTION_ORDER = 136
export const SECTION_MAX_CHARS = 3000

const fieldText = (f) => {
  let s = f.key + ' (' + f.type
  if (f.type === 'relation') s += ' → ' + f.to + (f.many ? ', many' : '') + (f.inverse === undefined ? '' : ', seen from there as "' + f.inverse + '"')
  if (f.options) s += ': ' + f.options.map((o) => o.key).join('|')
  if (f.required) s += ', required'
  if (f.protection !== 'normal') s += ', ' + protectionWord(f.protection, 'en')
  return s + ')'
}

/** `snapshot` is `service.snapshot()`: `[{ id, name, objects }]`. Returns the text of the block, or '' when there is nothing to say. */
export function renderBlock (snapshot) {
  if (!Array.isArray(snapshot) || snapshot.length === 0) return ''
  const lines = [
    'Databases on this computer (the person’s own tables). Read and write them only with the db_* and records_* tools, never with SQL or files. '
      + 'Protected fields come back masked and secret ones not at all; a change of structure or a write to a protected field is approved by the person.',
  ]
  for (const db of snapshot) {
    lines.push('Database “' + db.name + '” (db ' + db.id + ')' + (db.published === true ? ', published as a web app (add and change rows with records_*; its structure and views cannot change until the person unpublishes it)' : '') + ':')
    if (db.objects.length === 0) lines.push('  no object yet')
    for (const o of db.objects) lines.push('  ' + o.key + ' “' + o.label + '” — ' + o.fields.map(fieldText).join(', '))
  }
  const text = lines.join('\n')
  if (text.length <= SECTION_MAX_CHARS) return text
  return text.slice(0, SECTION_MAX_CHARS - 80).replace(/\n[^\n]*$/, '') + '\n  … more: db_list lists every database, object and field.'
}
