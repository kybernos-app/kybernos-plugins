// forms.mjs — the drawer frame and what goes in a form: one control per field type, the add-a-row drawer, the editor of a row, the owner's first-password drawer. A control answers
// `{ node, get, set, touched, focus, error }`: `get()` the raw value (text, a list, a boolean, the files picked), `set(value)` fills it from a row, `touched()` says whether the
// person changed it, `error(message)` shows or clears the message under it. Reading the values and the calls to the server are not here: the drawers are given a `submit` and answer
// for what it says.
import { h, icon, trapTab, uid } from './dom.mjs'
import * as m from './model.mjs'
import { pill } from './values.mjs'

/** The scrim and the dialog. A `<form>` when `onsubmit` is given, else a `<section>`. */
export function drawerBox ({ label, title, body, footer, actions, onClose, onsubmit, lockScrim = false }) {
  const box = h(onsubmit ? 'form' : 'section', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': label, tabindex: '-1', novalidate: onsubmit !== undefined, onsubmit, onkeydown: (e) => trapTab(box, e) },
    h('div', { class: 'dh' }, h('h2', null, title), actions, h('button', { type: 'button', class: 'btn icon ghost', 'aria-label': 'Close', onclick: onClose }, icon('x'))),
    h('div', { class: 'db' }, body),
    footer ? h('div', { class: 'df' }, footer) : null)
  return [h('div', { class: 'scrim', onclick: lockScrim ? undefined : onClose }), box]
}

/** Several radio-like choices that can also be left empty: ticking one clears the others, ticking it again clears it. */
function optionRow (name, options, { multiple, render, label }) {
  const inputs = []
  const row = h('div', { class: 'chips', role: 'group', 'aria-label': label }, options.map((o) => {
    const input = h('input', { type: 'checkbox', name, value: o.key })
    inputs.push(input)
    if (!multiple) input.addEventListener('change', () => { if (input.checked) for (const other of inputs) if (other !== input) other.checked = false })
    return h('label', { class: 'opt' }, input, render(o))
  }))
  return { row, inputs, picked: () => inputs.filter((i) => i.checked).map((i) => i.value), set: (keys) => { for (const i of inputs) i.checked = keys.includes(i.value) } }
}

const initialsChip = (title) => h('span', { class: 'chip' }, h('i', { 'aria-hidden': 'true' }, m.initials(title)), h('span', null, title))

/** The control for one field of an object. `ctx.targets(objectKey)` lists `{ id, title }` of the rows a link can point at. */
export function control (field, ctx) {
  const id = uid('f')
  const kind = m.controlOf(field)
  const note = h('p', { class: 'err', id: id + '-err', hidden: true })
  const marked = []
  let node
  let get
  let set
  let focusEl
  let ownLabel = false
  let touched = false
  const input = (attrs) => { const el = h('input', { class: 'input', id, 'aria-describedby': id + '-err', ...attrs }); marked.push(el); focusEl = el; return el }

  if (kind === 'textarea') {
    const el = h('textarea', { class: 'input', id, 'aria-describedby': id + '-err' }); marked.push(el); focusEl = el
    node = el; get = () => el.value; set = (v) => { el.value = typeof v === 'string' ? v : '' }
  } else if (kind === 'checkbox') {
    const el = h('input', { type: 'checkbox', id }); focusEl = el
    node = h('label', { class: 'check', for: id }, el, field.label); get = () => el.checked; set = (v) => { el.checked = v === true }; ownLabel = true
  } else if (kind === 'money') {
    const symbol = m.currencySymbol(field.currency)
    const el = input({ type: 'text', inputmode: 'decimal', placeholder: '0.00', autocomplete: 'off' })
    node = h('div', { class: 'money' }, symbol === '' ? null : h('span', { 'aria-hidden': 'true' }, symbol), el); get = () => el.value
    set = (v) => { el.value = typeof v === 'number' ? v.toFixed(field.precision ?? 2) : '' }
  } else if (kind === 'number') {
    const el = input({ type: 'text', inputmode: 'decimal', autocomplete: 'off' }); node = el; get = () => el.value; set = (v) => { el.value = typeof v === 'number' ? String(v) : '' }
  } else if (kind === 'choice') {
    const o = optionRow(id, field.options, { multiple: false, label: field.label, render: (opt) => pill(opt.label, opt.color || 'gray') })
    node = o.row; focusEl = o.inputs[0]; get = () => o.picked()[0] ?? ''; set = (v) => o.set(typeof v === 'string' ? [v] : []); ownLabel = 'group'
  } else if (kind === 'multichoice') {
    const o = optionRow(id, field.options, { multiple: true, label: field.label, render: (opt) => pill(opt.label, opt.color || 'gray') })
    node = o.row; focusEl = o.inputs[0]; get = () => o.picked(); set = (v) => o.set(Array.isArray(v) ? v : []); ownLabel = 'group'
  } else if (kind === 'select' || kind === 'link') {
    const rows = kind === 'select' ? field.options.map((o) => ({ key: o.key, title: o.label })) : ctx.targets(field.to).map((t) => ({ key: t.id, title: t.title }))
    const el = h('select', { class: 'input', id, 'aria-describedby': id + '-err' }, h('option', { value: '' }, kind === 'select' ? 'Choose…' : (rows.length === 0 ? 'Nothing to link to yet' : 'Choose a ' + m.singular(ctx.labelOf(field.to)))), rows.map((r) => h('option', { value: r.key }, r.title)))
    marked.push(el); focusEl = el; node = el; get = () => el.value; set = (v) => { el.value = typeof v === 'string' ? v : '' }
  } else if (kind === 'links') {
    const rows = ctx.targets(field.to)
    // links to rows this list does not offer (a row that cannot be listed) are kept as they are: picking among the others never drops them
    let kept = []
    if (rows.length === 0) { node = h('p', { class: 'dim' }, 'Nothing to link to yet.'); get = () => kept; set = (v) => { kept = Array.isArray(v) ? v : [] } } else {
      const o = optionRow(id, rows.map((r) => ({ key: r.id, title: r.title })), { multiple: true, label: field.label, render: (opt) => initialsChip(opt.title) })
      node = h('div', { class: 'pick' }, o.row); focusEl = o.inputs[0]; get = () => [...o.picked(), ...kept]
      set = (v) => { const list = Array.isArray(v) ? v : []; o.set(list); kept = list.filter((x) => !rows.some((r) => r.id === x)) }
    }
    ownLabel = 'group'
  } else if (kind === 'file') {
    const el = input({ type: 'file', multiple: true, class: undefined })
    node = el; get = () => [...el.files]; set = () => {}
  } else {
    const type = { email: 'email', url: 'url', tel: 'tel', date: 'date' }[kind] ?? 'text'
    const el = input({ type, autocomplete: 'off', maxlength: kind === 'text' ? 500 : undefined }); node = el; get = () => el.value; set = (v) => { el.value = typeof v === 'string' ? v : '' }
  }
  for (const type of ['input', 'change']) node.addEventListener(type, () => { touched = true })

  const labelText = [field.label, field.required && field.type !== 'checkbox' ? h('span', { class: 'req' }, 'Required') : null]
  const top = ownLabel === true ? null : ownLabel === 'group' ? h('span', { class: 'lab' }, labelText) : h('label', { for: id }, labelText)
  return {
    node: h('div', { class: 'fld' }, top, node, note),
    get,
    set,
    touched: () => touched,
    focus: () => { if (focusEl) focusEl.focus() },
    error (message) {
      note.textContent = message || ''
      note.hidden = !message
      for (const el of marked) { if (message) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid') }
    },
  }
}

/**
 * The add-a-row drawer. `submit(raw, fields)` answers `{ ok: true }` (the caller closes the drawer) or `{ ok: false, fields: { <key>: message }, message }`.
 */
export function addDrawer (ctx, object, { submit, close }) {
  const fields = m.formFields(ctx.me, object)
  const parts = fields.map((f) => ({ field: f, ctl: control(f, ctx) }))
  const one = m.singular(object.label)
  const banner = h('p', { class: 'err', role: 'alert', hidden: true })
  const save = h('button', { type: 'submit', class: 'btn primary' }, 'Add ' + one)
  const onsubmit = async (e) => {
    e.preventDefault()
    banner.hidden = true
    for (const p of parts) p.ctl.error('')
    save.disabled = true
    const raw = Object.fromEntries(parts.map((p) => [p.field.key, p.ctl.get()]))
    const r = await submit(raw, fields)
    save.disabled = false
    if (r.ok) return
    let first = null
    for (const p of parts) if (r.fields[p.field.key] !== undefined) { p.ctl.error(r.fields[p.field.key]); first = first ?? p }
    if (r.message && (first === null || r.message !== 'Some fields need a look.')) { banner.textContent = r.message; banner.hidden = false }
    if (first !== null) first.ctl.focus()
  }
  const body = [parts.map((p) => p.ctl.node), banner,
    object.fields.length > fields.length && !m.isOwner(ctx.me) ? h('p', { class: 'note' }, icon('lock'), 'You can fill the fields your role allows.') : null]
  return drawerBox({ label: 'Add ' + one, title: 'Add ' + one, body, footer: [h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'), save], onClose: close, onsubmit })
}

/**
 * The editor of a row in place: a control per field the actor may change, filled from the row, and the Save and Cancel that go in the drawer's footer. It lives as long as the
 * person edits (the drawer is drawn again around the same nodes), so what was typed survives a redraw. `rev` is the revision the edit started from.
 * `raw()` gives what was typed in the controls the person touched; `show(fields, message, reload)` puts the door's answer under the fields.
 */
export function makeEditor (ctx, object, record, fields, { onCancel, onReload }) {
  const parts = fields.map((f) => { const ctl = control(f, ctx); ctl.set(record.values[f.key]); return { field: f, ctl } })
  const text = h('p', null)
  const reload = h('button', { type: 'button', class: 'btn sm', onclick: onReload }, 'Reload this row')
  reload.hidden = true
  const banner = h('div', { class: 'editnote err', role: 'alert' }, text, reload)
  banner.hidden = true
  const save = h('button', { type: 'submit', class: 'btn primary' }, 'Save')
  const cancel = h('button', { type: 'button', class: 'btn', onclick: onCancel }, 'Cancel')
  const editor = {
    parts, banner, footer: [cancel, save], rev: record.rev,
    partOf: (key) => parts.find((p) => p.field.key === key),
    raw: () => Object.fromEntries(parts.filter((p) => p.ctl.touched()).map((p) => [p.field.key, p.ctl.get()])),
    busy (on) { save.disabled = on; cancel.disabled = on },
    clear () { for (const p of parts) p.ctl.error(''); banner.hidden = true; reload.hidden = true },
    show (errors, message, canReload = false) {
      let first = null
      for (const p of parts) if (errors[p.field.key] !== undefined) { p.ctl.error(errors[p.field.key]); first = first ?? p }
      if (message && (first === null || message !== 'Some fields need a look.')) { text.textContent = message; banner.hidden = false; reload.hidden = !canReload }
      if (first !== null) first.ctl.focus(); else if (canReload) reload.focus()
    },
  }
  return editor
}

/** The owner's first password (the link they came in with gave them one nobody knows). `submit(password)` answers `{ ok }` or `{ ok: false, message }`. */
export function passwordDrawer ({ submit, close }) {
  const id = uid('pw')
  const el = h('input', { class: 'input', id, type: 'password', autocomplete: 'new-password', minlength: m.MIN_PASSWORD, maxlength: 128, 'aria-describedby': id + '-err' })
  const note = h('p', { class: 'err', id: id + '-err', role: 'alert', hidden: true })
  const save = h('button', { type: 'submit', class: 'btn primary' }, 'Save password')
  const onsubmit = async (e) => {
    e.preventDefault()
    note.hidden = true
    el.removeAttribute('aria-invalid')
    if (el.value.length < m.MIN_PASSWORD) { note.textContent = 'Use at least ' + m.MIN_PASSWORD + ' characters.'; note.hidden = false; el.setAttribute('aria-invalid', 'true'); el.focus(); return }
    save.disabled = true
    const r = await submit(el.value)
    save.disabled = false
    if (!r.ok) { note.textContent = r.message; note.hidden = false; el.setAttribute('aria-invalid', 'true') }
  }
  const body = [h('div', { class: 'fld' }, h('label', { for: id }, 'New password', h('span', { class: 'req' }, m.MIN_PASSWORD + ' characters or more')), el, note),
    h('p', { class: 'note' }, icon('lock'), 'The link you came in with works once. With a password you can sign in from the sign-in page.')]
  return drawerBox({ label: 'Set a password', title: 'Set a password', body, footer: [h('button', { type: 'button', class: 'btn', onclick: close }, 'Not now'), save], onClose: close, onsubmit })
}
