// kybernos/dashboards#preset — a dashboard a template ships, as data.
//
// A template (a data plugin, `kybernos-themes/real-estate`) names the point in its plugin.json and ships `dashboards/<id>.json`, one file per dashboard:
//   { "id": "overview", "name": "Agency overview", "desc": "What the agency has on, at a glance.",
//     "menu": { "en": "Overview", "fr": "Vue d’ensemble" }, "overview": true,
//     "widgets": [ { "type": "card", "title": "Active listings", "source": { "provider": "catalog.items" }, "metric": { "agg": "count" } } ] }
// The Dashboards plugin lists it in its Presets gallery with the template's name, only while the template is installed; using it gives the person their own copy,
// exactly like a built-in preset. `menu` is the word of the « Overview » row of the Business group (English required); `overview: true` marks the dashboard that
// row opens (at most one per file).
//
// The check is pure and bounded: known keys only, every text and list has a limit, no code and no URL. The widgets are checked by the dashboards' own model
// (`validateDashboard`, then `inspectDashboard`): a widget that would lose a part, or that names a column its source does not have, is refused here, not drawn
// wrong later. The kinds of widget are the ones that read a source of this computer: a note carries free text an agent would read, so it is not allowed.
import { LIMITS as MODEL_LIMITS, PROVIDERS, inspectDashboard, validateDashboard } from './model.mjs'

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/
const LANGS = ['en', 'fr', 'es', 'ar']
const clean = (s) => { for (const ch of s) { const c = ch.charCodeAt(0); if (c < 32 || c === 127 || ch === '<' || ch === '>') return false } return true }

export const OWNER = 'kybernos/dashboards'
export const OWNER_VERSION = '1.0.0'
export const POINT_REF = OWNER + '#preset'
export const LIMITS = Object.freeze({ files: 4, name: 40, desc: MODEL_LIMITS.desc, menu: 24, widgets: 16, minWidgets: 4, bytes: 60000, presets: 12 })
/** The widgets a template may ship: the ones that draw a source. A note (free text) and a flow (nodes with free text) stay the person's. */
export const WIDGETS_ALLOWED = Object.freeze(['card', 'chart', 'table', 'list', 'calendar', 'kanban', 'carousel', 'sankey'])

/** The text of a field, or null (and a message) when it is not 1..max characters of plain text. */
const textOf = (v, where, min, max, errors) => {
  if (typeof v !== 'string' || v.trim().length < min || v.trim().length > max || !clean(v)) { errors.push(where + ': a text of ' + min + ' to ' + max + ' characters, no < >'); return null }
  return v.trim()
}
/** Every string anywhere in the value, depth-first and bounded: a preset reads this computer and nothing else, so no address is accepted in it. */
const strings = (v, out, depth) => {
  if (out.length > 4000 || depth > 8) return out
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out, depth + 1)
  else if (plain(v)) for (const k of Object.keys(v)) { out.push(k); strings(v[k], out, depth + 1) }
  return out
}

/** `{ ok: true, value }` (the preset, its widgets as the model normalises them) or `{ ok: false, errors }`. Never throws. */
export function validateDashboardPreset (raw, fileId) {
  const errors = []
  try {
    if (!plain(raw)) return { ok: false, errors: ['a dashboard preset is a JSON object'] }
    for (const k of Object.keys(raw)) if (['id', 'name', 'desc', 'menu', 'overview', 'widgets'].indexOf(k) < 0) errors.push('unknown key "' + String(k).slice(0, 40) + '"')
    let id = null
    if (typeof raw.id !== 'string' || !ID.test(raw.id)) errors.push('id: lower-case letters, digits, "-" or "_", 1 to 40')
    else id = raw.id
    if (id !== null && typeof fileId === 'string' && fileId !== id) errors.push('id "' + id + '" must be the name of its file (' + fileId + '.json)')
    const name = textOf(raw.name, 'name', 3, LIMITS.name, errors)
    const desc = textOf(raw.desc, 'desc', 10, LIMITS.desc, errors)
    let menu = null
    if (raw.menu !== undefined) {
      if (!plain(raw.menu)) errors.push('menu: an object { en: text, fr?: text }')
      else {
        menu = {}
        for (const k of Object.keys(raw.menu)) {
          if (LANGS.indexOf(k) < 0) { errors.push('menu: unknown language "' + String(k).slice(0, 12) + '"'); continue }
          const t = textOf(raw.menu[k], 'menu.' + k, 1, LIMITS.menu, errors)
          if (t !== null) menu[k] = t
        }
        if (!Object.prototype.hasOwnProperty.call(raw.menu, 'en')) errors.push('menu.en: required')
      }
    }
    if (raw.overview !== undefined && typeof raw.overview !== 'boolean') errors.push('overview: true or false')
    if (!Array.isArray(raw.widgets) || raw.widgets.length < LIMITS.minWidgets || raw.widgets.length > LIMITS.widgets) {
      errors.push('widgets: a list of ' + LIMITS.minWidgets + ' to ' + LIMITS.widgets)
      return { ok: false, errors: errors.slice(0, 20) }
    }
    if (JSON.stringify(raw.widgets).length > LIMITS.bytes) errors.push('widgets: more than ' + Math.round(LIMITS.bytes / 1000) + ' KB')
    raw.widgets.forEach((w, i) => {
      const at = 'widgets[' + i + ']'
      if (!plain(w)) { errors.push(at + ': an object'); return }
      if (WIDGETS_ALLOWED.indexOf(w.type) < 0) errors.push(at + '.type: one of ' + WIDGETS_ALLOWED.join(', '))
      if (w.manual === true) errors.push(at + ': a kanban of a preset reads a source, it is not manual')
      if (typeof w.title !== 'string' || w.title.trim() === '') errors.push(at + '.title: a title')
    })
    for (const s of strings(raw, [], 0)) if (/:\/\/|\bwww\./i.test(s)) { errors.push('no address in a preset: it reads this computer only'); break }
    // the model has the last word: nothing dropped, nothing clamped, nothing it would warn about
    const checked = validateDashboard({ name: name === null ? 'x' : name, desc: desc === null ? '' : desc, widgets: raw.widgets })
    for (const e of checked.errors) errors.push(e)
    if (checked.dashboard.widgets.length !== raw.widgets.length) errors.push('widgets: ' + (raw.widgets.length - checked.dashboard.widgets.length) + ' could not be kept')
    for (const w of inspectDashboard(checked.dashboard)) errors.push(w)
    for (const w of checked.dashboard.widgets) if (w.source !== undefined && PROVIDERS[w.source.provider] === undefined) errors.push('widget "' + w.id + '": unknown source')
    if (errors.length > 0) return { ok: false, errors: errors.slice(0, 20) }
    const value = { id, name, desc, overview: raw.overview === true, widgets: checked.dashboard.widgets }
    if (menu !== null) value.menu = menu
    return { ok: true, value }
  } catch (e) {
    return { ok: false, errors: ['the check itself failed'] }
  }
}

/** What the registry is told (`registry.definePoint`): data, inert. */
export const PRESET_POINT = Object.freeze({ owner: OWNER, ownerVersion: OWNER_VERSION, name: 'preset', version: '1.0', kind: 'data', class: 'inert', validate: validateDashboardPreset, max: LIMITS.files })
