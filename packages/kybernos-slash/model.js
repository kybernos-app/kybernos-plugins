// Cœur commun « slash commands & actions » — sans dépendance, sans DOM, sans eval.
//
// C'est la seule partie que les deux applications doivent partager mot pour mot :
//    1. l'évaluation des conditions entre champs (`compare`, `conditionsHold`) ;
//    2. le calcul des champs visibles et requis (`visibleFields`, `validate`) ;
//    3. la composition du texte final (`render`) ;
//    4. la normalisation des deux modèles existants vers une entrée unique
//       (`normalize`) — kybernos (SlashCommand/MsgAction + SlashField.visibleWhen)
//       et platon (UserPrompt/MessageAction + ContentField.hiddenIf).
//
// Le stockage, le CRUD et l'interface restent à chaque application (ou au plugin
// `kybernos-slash`) ; ce fichier est la sémantique, pas la plomberie.
//
// Usage : import { normalize, visibleFields, validate, render } from './model.js'

export const MODEL_VERSION = 1

/** Opérateurs. `visibleWhen.equals` (kybernos) et `hiddenIf` (platon) s'y ramènent. */
export const OPS = ['=', '!=', '>', '<', '>=', '<=', 'in', 'contains', 'empty', 'notEmpty']

/** Table de correspondance des opérateurs hérités. */
const OP_ALIASES = { eq: '=', neq: '!=', equals: '=', notEquals: '!=', contains: 'contains', in: 'in' }

export const normalizeOp = (op) => OP_ALIASES[op] || op

/** `null`, `undefined`, `''`, `false`, tableau vide → « vide ». 0 n'est pas vide. */
export function isEmpty(v) {
  if (v === null || v === undefined || v === '' || v === false) return true
  return Array.isArray(v) && v.length === 0
}

/** Compare une valeur à une condition. Ne lance jamais : un opérateur inconnu est faux. */
export function compare(left, op, right) {
  const o = normalizeOp(op)
  const num = (x) => (x === '' || x === null || x === undefined ? NaN : Number(x))
  switch (o) {
    case '=':
      if (typeof right === 'boolean') return Boolean(left) === right
      if (typeof left === 'boolean') return left === (right === true || right === 'true')
      return String(left ?? '') === String(right ?? '')
    case '!=': return !compare(left, '=', right)
    case '>': return num(left) > num(right)
    case '<': return num(left) < num(right)
    case '>=': return num(left) >= num(right)
    case '<=': return num(left) <= num(right)
    case 'in': {
      const list = Array.isArray(right) ? right : String(right ?? '').split(',')
      return list.map((x) => String(x).trim()).indexOf(String(left)) >= 0
    }
    case 'contains': {
      if (Array.isArray(left)) return left.map(String).indexOf(String(right)) >= 0
      return String(left ?? '').indexOf(String(right ?? '')) >= 0
    }
    case 'empty': return isEmpty(left)
    case 'notEmpty': return !isEmpty(left)
    default: return false
  }
}

/**
 * Accepte une liste de conditions, ou une condition unique sous sa forme héritée
 * (kybernos `{field, equals}` ou platon `{field, operator, value}`).
 */
export function toConditions(x) {
  if (Array.isArray(x)) return x
  if (x !== null && typeof x === 'object' && x.field !== undefined) {
    const raw = x.op !== undefined ? x.op : (x.operator !== undefined ? x.operator : (x.equals !== undefined ? '=' : '='))
    return [{ field: x.field, op: normalizeOp(raw) || '=', value: x.value !== undefined ? x.value : x.equals }]
  }
  return []
}

/** Toutes les conditions doivent tenir (ET). Une liste vide tient toujours. */
export const conditionsHold = (conds, values) => toConditions(conds).every((c) => compare((values || {})[c.field], c.op, c.value))

/** Un champ est visible si ses `showIf` tiennent et qu'aucun `hideIf` ne tient. */
export function isVisible(field, values) {
  const v = values || {}
  if (conditionsHold(field.showIf !== undefined ? field.showIf : field.visibleWhen, v) === false) return false
  // Une liste de conditions vide « tient » toujours : sans condition, hideIf ne masque rien.
  if (toConditions(field.hideIf).length > 0 && conditionsHold(field.hideIf, v)) return false
  return true
}

/** Requis si `required`, ou si une condition `requireIf` tient ; un champ masqué n'est jamais requis. */
export function isRequired(field, values) {
  if (isVisible(field, values) === false) return false
  return field.required === true || (toConditions(field.requireIf).length > 0 && conditionsHold(field.requireIf, values))
}

/** Champs du formulaire dans l'ordre de déclaration, conditions appliquées. */
export const visibleFields = (entry, values) => (entry.fields || []).filter((f) => isVisible(f, values))

/** Valeurs par défaut des champs visibles (les défauts ne s'appliquent qu'aux champs montrés). */
export function defaultsOf(entry, values) {
  const out = Object.assign({}, values || {})
  // Les défauts peuvent RENDRE VISIBLE un autre champ (format='puces' → bullets).
  // Une seule passe laissait ce champ affiché sans sa valeur par défaut — et s'il
  // était requis, la validation le refusait alors qu'il venait d'apparaître. On
  // itère jusqu'à stabilité (borné : la visibilité ne dépend que des valeurs).
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false
    visibleFields(entry, out).forEach((f) => {
      if (out[f.key] === undefined && f.default !== undefined) {
        out[f.key] = f.default
        changed = true
      }
    })
    if (changed === false) break
  }
  return out
}

/** Validation : renvoie les clés requises vides. `ok: false` bloque la soumission. */
export function validate(entry, values) {
  const invalid = visibleFields(entry, values)
    .filter((f) => isRequired(f, values) && isEmpty((values || {})[f.key]))
    .map((f) => f.key)
  return { ok: invalid.length === 0, invalid }
}

/** Remplace {champ} — et {message} pour une action. Les valeurs vides disparaissent proprement. */
export function render(template, values, extra) {
  const all = Object.assign({}, values || {}, extra || {})
  return String(template || '')
    .replace(/\{(\w+)\}/g, (m, k) => {
      const v = all[k]
      if (v === undefined || v === null || v === '') return ''
      if (typeof v === 'boolean') return v ? 'oui' : 'non'
      return String(v)
    })
    .replace(/[^\S\n]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Le texte d'une entrée sans formulaire : son gabarit, avec le message si c'est une action. */
export const textOf = (entry, message) => render(entry.template, {}, { message: message || '' })

/** Une entrée a un formulaire si elle déclare au moins un champ (règle des deux projets actuels). */
export const hasForm = (entry) => (entry.fields || []).length > 0
export const runOf = (entry) => (entry.run || (hasForm(entry) ? 'form' : 'text'))

// ────────────────────────────────────────────────────────────────────────────
// Normalisation des modèles hérités → entrée unique
// ────────────────────────────────────────────────────────────────────────────

/** kybernos : `{field, equals}` → `[{field, op:'=', value}]`. */
const conditionsFromVisibleWhen = (vw) => (vw && vw.field !== undefined ? [{ field: vw.field, op: '=', value: vw.equals }] : [])

/** platon : `{field, operator:'eq'|'neq'|'contains', value}` = ce qui doit être VRAI pour MONTRER. */
const conditionsFromHiddenIf = (hi) => {
  if (hi === null || hi === undefined || hi.field === undefined) return []
  const op = normalizeOp(hi.operator)
  const inverse = { '=': '!=', '!=': '=', contains: 'contains' }
  // `hiddenIf` décrit quand MASQUER : on garde donc la condition inverse en `showIf`.
  return [{ field: hi.field, op: inverse[op] || '!=', value: hi.value }]
}

/** `{{key}}` (platon) → `{key}`. */
export const normalizeTemplate = (tpl) => String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, '{$1}')

const trimSlashes = (name) => String(name || '').replace(/^\/+/, '')

/**
 * Normalise une entrée héritée d'un des deux projets vers le modèle commun.
 * @param {object} raw    SlashCommand/MsgAction (kybernos) ou UserPrompt/MessageAction (platon)
 * @param {'slash'|'action'} kind
 * @param {object} [opts] { lang } pour choisir le libellé d'un champ i18n
 */
export function normalize(raw, kind, opts) {
  const lang = (opts && opts.lang) || 'fr'
  const src = raw || {}
  // platon met son contenu dans `data` (ligne `content_items` type user_prompt).
  const data = src.data || {}
  const pick = (v) => (v && typeof v === 'object' ? (v[lang] || v.fr || v.en || '') : v)
  const fields = (src.fields || data.fields || []).map((f) => {
    // `showIf` accepte la liste ET la condition unique : `toConditions` ramene
    // les deux formes. Concatenation directe sur un OBJET levait
    // « (f.showIf || []).concat is not a function » et faisait echouer l'entree
    // entiere — or le skill documente la forme `{field, op, value}`.
    const showIf = toConditions(f.showIf).concat(conditionsFromVisibleWhen(f.visibleWhen)).concat(conditionsFromHiddenIf(f.hiddenIf))
    const out = {
      key: f.key || f.name || f.id,
      label: pick(f.label) || f.key || f.name,
      type: f.type || 'text',
      required: f.required === true,
    }
    if (f.default !== undefined) out.default = f.default
    if (f.options !== undefined) {
      out.options = (f.options || []).map((o) => (o !== null && typeof o === 'object' ? { value: o.value !== undefined ? o.value : o.v, label: pick(o.label) || String(o.value !== undefined ? o.value : o.v) } : { value: o, label: String(o) }))
    }
    if (f.placeholder !== undefined) out.placeholder = pick(f.placeholder)
    if (showIf.length > 0) out.showIf = showIf
    if (f.requireIf !== undefined) out.requireIf = f.requireIf
    return out
  })
  const title = src.title !== undefined ? src.title : (data.title !== undefined ? data.title : undefined)
  const label = sourceLabel(src, data, kind, lang)
  return {
    version: MODEL_VERSION,
    id: src.id !== undefined ? String(src.id) : trimSlashes(src.slug || src.cmd || src.name),
    kind: src.kind === 'action' || kind === 'action' ? 'action' : 'slash',
    slug: trimSlashes(src.slug || src.cmd || src.name || data.slug || ''),
    label: label !== undefined && label !== null ? label : (title !== undefined ? pick(title) : ''),
    description: pick(src.description !== undefined ? src.description : data.description) || '',
    icon: src.icon !== undefined && src.icon !== null ? src.icon : (data.icon || ''),
    order: Number.isFinite(src.order) ? src.order : 0,
    active: src.active !== undefined ? src.active !== false : (src.enabled !== undefined ? src.enabled !== false : true),
    hiddenInToolbar: src.hidden_in_toolbar === true,
    // Étape 4 de l'éditeur : le texte va-t-il au curseur, ou part-il tout seul ?
    // `submit` reste réservé au gabarit des données historiques (voir index.js).
    delivery: src.delivery === 'send' ? 'send' : 'insert',
    run: fields.length > 0 ? 'form' : 'text',
    template: normalizeTemplate(src.template !== undefined ? src.template : (src.expansion !== undefined ? src.expansion : (src.prompt !== undefined ? src.prompt : (data.prompt_message !== undefined ? data.prompt_message : '')))),
    fields,
    builtin: src.builtin === true,
  }
}

function sourceLabel(src, data, kind, lang) {
  const pick = (v) => (v && typeof v === 'object' ? (v[lang] || v.fr || v.en || '') : v)
  if (kind === 'action' && src.label !== undefined && typeof src.label !== 'object') return String(src.label).toLowerCase()
  return pick(src.label !== undefined ? src.label : data.label)
}

export default { MODEL_VERSION, OPS, compare, toConditions, conditionsHold, isVisible, isRequired, visibleFields, defaultsOf, validate, render, textOf, hasForm, runOf, normalize, normalizeOp, normalizeTemplate }
