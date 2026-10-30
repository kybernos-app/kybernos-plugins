// The cards the person approves, in both languages: what a call is about to do to the structure (before and after), or which protected fields it touches. Pure.
//
// `cardFor(name, args, objects, dbName)` answers `{ en, fr }`, or null when the call is not one that needs a card or would fail anyway (a call the engine will refuse
// is never put to the person: they get the refusal, not a question). `objects` is the catalog of the db the call means (null when there is none yet).

import { normalizeField } from '../core/index.mjs'
import { findObject, normalizeObject } from '../store/catalog.mjs'
import { WORDS, fieldLine, protectionWord, say, short } from './words.mjs'

const both = (make) => ({ en: make('en'), fr: make('fr') })
const word = (key, lang) => WORDS[key][lang]
const quote = (s) => '“' + short(s, 60) + '”'
const bullets = (lines) => lines.map((l) => '· ' + l).join('\n')

function objectCard (args, dbName) {
  const n = normalizeObject({ key: args.key, label: args.label, title: args.title, fields: args.fields })
  if (!n.ok) return null
  const o = n.object
  return both((lang) => say('addObject', lang) + word('object', lang) + ' ' + quote(o.label) + say('to', lang) + quote(dbName) + say('colon', lang) + '\n'
    + bullets(o.fields.map((f) => fieldLine(f, lang) + (f.key === o.title ? say('titleMark', lang) : ''))))
}

function fieldCard (args, objects) {
  const obj = findObject(objects, args.object)
  const n = normalizeField(args.field)
  if (!obj || !n.ok || obj.fields.some((f) => f.key === n.field.key)) return null
  return both((lang) => say('addField', lang) + fieldLine(n.field, lang) + say('toThe', lang) + word('object', lang) + ' ' + quote(obj.label)
    + say('emptyRows', lang))
}

function relationCard (args, objects) {
  const obj = findObject(objects, args.object)
  const target = findObject(objects, args.to)
  const n = normalizeField({ key: args.key, type: 'relation', label: args.label, to: args.to, many: args.many === true, protection: args.protection, ...(args.inverse === undefined ? {} : { inverse: args.inverse }) })
  if (!obj || !target || !n.ok || obj.fields.some((f) => f.key === n.field.key)) return null
  return both((lang) => {
    const one = word('object', lang)
    return say('link', lang) + one + ' ' + quote(obj.label) + say('toThe', lang) + one + ' ' + quote(target.label) + say('colon', lang) + '\n'
      + bullets([say('newField', lang) + quote(n.field.label) + ' — ' + (n.field.many
        ? say('severalOf', lang) + quote(target.label)
        : say('atMostOne', lang) + quote(target.label))].concat(n.field.inverse === undefined ? [] : [quote(target.label) + ' ' + say('shownAs', lang) + quote(n.field.inverse)]))
  })
}

function updateCard (args, objects) {
  const obj = findObject(objects, args.object)
  const field = obj && obj.fields.find((f) => f.key === args.key)
  if (!field) return null
  const changed = (lang) => {
    const out = []
    if (args.label !== undefined && args.label !== field.label) out.push(say('changeName', lang) + quote(field.label) + ' → ' + quote(args.label))
    if (args.protection !== undefined && args.protection !== field.protection) out.push(say('changeProtection', lang) + protectionWord(field.protection, lang) + ' → ' + protectionWord(args.protection, lang))
    if (args.inverse !== undefined && field.type === 'relation' && args.inverse !== field.inverse) out.push(say('changeInverse', lang) + quote(field.inverse === undefined ? '—' : field.inverse) + ' → ' + quote(args.inverse))
    if (Array.isArray(args.options)) {
      const have = new Set((field.options || []).map((o) => o.key))
      const added = args.options.filter((o) => o && !have.has(o.key)).map((o) => o.label || o.key)
      if (added.length) out.push(say('choicesAdded', lang) + added.join(', '))
    }
    return out
  }
  if (changed('en').length === 0) return null
  return both((lang) => say('changeField', lang) + quote(field.label) + say('ofThe', lang) + word('object', lang) + ' ' + quote(obj.label) + say('colon', lang) + '\n' + bullets(changed(lang)))
}

function dbCard (args) {
  const name = typeof args.name === 'string' ? args.name.trim() : ''
  if (name === '' || name.length > 80) return null
  return both((lang) => say('createDb', lang) + word('db', lang) + ' ' + quote(name) + say('emptyFile', lang))
}

/** The card of a structure call, or null. */
export function cardFor (name, args, objects, dbName) {
  const a = args !== null && typeof args === 'object' && !Array.isArray(args) ? args : {}
  switch (name) {
    case 'db_create': return dbCard(a)
    case 'object_define': return objectCard(a, dbName)
    case 'field_add': return fieldCard(a, objects || [])
    case 'relation_add': return relationCard(a, objects || [])
    case 'field_update': return updateCard(a, objects || [])
    default: return null
  }
}

/** The card of a call that writes or reads protected fields: `fields` are the fields (of one object) it touches, `verb` is 'write' or 'reveal'. */
export function protectedCard (verb, fields, obj) {
  const names = fields.map((f) => quote(f.label)).join(', ')
  const write = verb === 'write'
  return both((lang) => say(write ? 'askWrite' : 'askRead', lang) + names + say('closeOf', lang) + word('object', lang) + ' ' + quote(obj.label) + say(write ? 'allowWrite' : 'allowRead', lang))
}
