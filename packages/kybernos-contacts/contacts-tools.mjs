// kybernos-contacts — the two tools an agent has: `contacts_find` (free) and `contacts_upsert` (the person approves every call).
//
// Built by hand, like the other plugins that cannot import `defineTool`: `tools.register` only needs { name, description, parameters, output, execute }.
// No network, nothing sent: a tool reads and writes the local base through contacts-api.mjs, and a write is journalled with the actor `agent`.
// The approval is the engine's own: `approvalGate` answers the `tools/pre-execute` waterfall with `{ kind: 'ask' }` for `contacts_upsert` only, so the
// person sees what is about to be written and answers each call (a session that never asks refuses it: a write is never silent).
export const FIND = 'contacts_find'
export const UPSERT = 'contacts_upsert'
export const FIND_DEFAULT = 20
export const FIND_MAX = 50

const TEXT = (text) => [{ type: 'text', text }]
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const short = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n - 1) + '…' : String(s === undefined || s === null ? '' : s))
const AGENT = Object.freeze({ actor: 'agent' })

/** A contact the way an agent reads it: no timestamps but the last change, the company by name. */
const compact = (row) => ({
  id: row.id, kind: row.kind, type: row.type, name: row.name, email: row.email,
  company: row.company === undefined || row.company === null ? null : row.company.name,
  company_id: row.company_id, tags: row.tags, fields: row.fields, demo: row.demo === true, archived: row.archived_at !== null && row.archived_at !== undefined, updated_at: row.updated_at,
})
const line = (c) => '#' + c.id + ' ' + c.name + ' (' + (c.type || c.kind) + ')' + (c.email !== '' ? ' ' + c.email : '') + (c.company !== null ? ' — ' + c.company : '') + (c.tags.length > 0 ? ' [' + c.tags.join(', ') + ']' : '')

const fieldsDescription = 'Custom fields by key, e.g. { "city": "Lyon" }. The keys, their kinds and the choices are in the `vocabulary` that contacts_find returns; a key that is not there is refused. A value of null clears the field.'

export function findTool (api) {
  return {
    name: FIND,
    description: 'Looks up contacts (people and companies) in the Contacts page of this computer. Give `q` (matches the name or the email), and/or `kind`, `type` (a key of the vocabulary), `tag`; or `id` to read one contact with its notes. '
      + 'The answer also carries the `vocabulary` of the active theme (the type keys, the custom fields, the usual tags) so a later contacts_upsert writes keys the page can show. Read only.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        q: { type: 'string', description: 'Words of the name or the email.' },
        kind: { type: 'string', enum: ['person', 'company'], description: 'Only people, or only companies.' },
        type: { type: 'string', description: 'A type key from the vocabulary (for example "customer").' },
        tag: { type: 'string', description: 'Only contacts that carry this tag.' },
        id: { type: 'integer', description: 'Read this one contact, with its notes and its company.' },
        limit: { type: 'integer', description: 'At most this many contacts (default ' + FIND_DEFAULT + ', at most ' + FIND_MAX + ').' },
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' }, error: { type: 'string' }, detail: { type: 'string' }, count: { type: 'integer' }, total: { type: 'integer' }, contacts: { type: 'array' }, contact: { type: 'object' }, notes: { type: 'array' }, vocabulary: { type: 'object' } },
        required: ['ok'],
      },
      render: (args, value) => TEXT(value.ok !== true
        ? 'Contacts: ' + String(value.error) + (value.detail === undefined ? '' : ' — ' + String(value.detail))
        : (value.contact !== undefined ? line(value.contact) + (value.notes.length > 0 ? '\n' + value.notes.map((n) => '· ' + n.created_at.slice(0, 10) + ' ' + short(n.body, 160)).join('\n') : '')
          : (value.count === 0 ? 'No contact found.' : value.count + (value.total > value.count ? ' of ' + value.total : '') + ' contact(s):\n' + value.contacts.map(line).join('\n')))),
    },
    async execute (args) {
      const a = plain(args) ? args : {}
      const vocabulary = api.vocabulary()
      if (a.id !== undefined && a.id !== null) {
        const r = api.get(a.id)
        if (!r.ok) return r
        const contact = compact(Object.assign({}, r.contact, { company: r.company }))
        return { ok: true, contact, notes: r.notes.slice(0, 10).map((n) => ({ created_at: n.created_at, actor: n.actor, body: n.body })), vocabulary }
      }
      const limit = Number.isInteger(a.limit) ? Math.min(Math.max(a.limit, 1), FIND_MAX) : FIND_DEFAULT
      const r = api.list({ q: a.q, kind: a.kind, type: a.type, tag: a.tag, limit })
      if (!r.ok) return r
      const contacts = r.rows.map(compact)
      return { ok: true, count: contacts.length, total: r.total, contacts, vocabulary }
    },
  }
}

export function upsertTool (api) {
  return {
    name: UPSERT,
    description: 'Adds a contact to the Contacts page of this computer, or changes one (give `id`). The person is asked before every call and sees what you write. '
      + 'To add: `name` is required (kind defaults to "person"). To change: `id` plus only what changes. `company` names an existing company (or give `company_id`); create the company first with kind "company". '
      + '`note` adds one line to the contact\'s history. Call contacts_find first to see the vocabulary, and to avoid a duplicate: a new contact whose email already exists is refused. Nothing is sent to anyone.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'integer', description: 'Change this contact instead of adding one.' },
        name: { type: 'string', description: 'The name of the person or the company.' },
        kind: { type: 'string', enum: ['person', 'company'], description: 'Default "person". A contact does not change kind later.' },
        type: { type: 'string', description: 'A type key from the vocabulary of contacts_find.' },
        email: { type: 'string', description: 'An email address.' },
        company: { type: 'string', description: 'The name of an existing company this person works for.' },
        company_id: { type: 'integer', description: 'The id of the company; 0 detaches the person from its company.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'The whole list of tags (it replaces the contact\'s tags).' },
        fields: { type: 'object', description: fieldsDescription },
        note: { type: 'string', description: 'One note to add to the contact\'s history.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' }, error: { type: 'string' }, detail: { type: 'string' }, action: { type: 'string' }, contact: { type: 'object' }, note_added: { type: 'boolean' } },
        required: ['ok'],
      },
      render: (args, value) => TEXT(value.ok === true
        ? (value.action === 'created' ? 'Contact added: ' : 'Contact changed: ') + line(value.contact) + (value.note_added === true ? ' (note added)' : '')
        : 'Contact not written: ' + String(value.error) + (value.detail === undefined ? '' : ' — ' + String(value.detail))),
    },
    async execute (args) {
      const a = plain(args) ? args : {}
      const body = {}
      for (const k of ['kind', 'type', 'name', 'email', 'tags', 'fields']) if (a[k] !== undefined && a[k] !== null) body[k] = a[k]
      if (a.company_id !== undefined && a.company_id !== null) body.company_id = a.company_id === 0 ? null : a.company_id
      if (a.company !== undefined && a.company !== null && a.company_id === undefined) {
        const c = api.companyByName(a.company)
        if (!c.ok) return c
        body.company_id = c.company.id
      }
      const changing = a.id !== undefined && a.id !== null
      if (!changing && typeof body.email === 'string' && body.email.trim() !== '') {
        const same = api.byEmail(body.email)
        if (same.ok && same.rows.length > 0) return { ok: false, error: 'duplicate', detail: 'contact #' + same.rows[0].id + ' (' + same.rows[0].name + ') already has this email: change it with id ' + same.rows[0].id }
      }
      const r = changing ? api.update(a.id, body, AGENT) : api.create(body, AGENT)
      if (!r.ok) return r
      const out = { ok: true, action: changing ? 'updated' : 'created', contact: compact(r.contact), note_added: false }
      if (typeof a.note === 'string' && a.note.trim() !== '') {
        const n = api.addNote(r.contact.id, a.note, AGENT)
        if (n.ok) out.note_added = true
        else out.note_error = n.error + (n.detail === undefined ? '' : ': ' + n.detail)
      }
      return out
    },
  }
}

export const tools = (api) => [findTool(api), upsertTool(api)]

/**
 * The `tools/pre-execute` answer for a call: `{ kind: 'ask', reason, displayReason }` for contacts_upsert, nothing (`null`) for anything else, so
 * the next handler decides. The reason says what is about to be written, from the call's own arguments.
 */
export function approvalGate (exec) {
  if (!plain(exec) || exec.name !== UPSERT) return null
  const a = plain(exec.arguments) ? exec.arguments : {}
  const who = typeof a.name === 'string' && a.name.trim() !== '' ? '“' + short(a.name.trim(), 60) + '”' : (a.id !== undefined && a.id !== null ? 'contact #' + short(a.id, 12) : 'a contact')
  const change = a.id !== undefined && a.id !== null
  const note = typeof a.note === 'string' && a.note.trim() !== ''
  const text = ASK[(change ? 'change' : 'add') + (note ? 'Note' : '')]
  const fill = (s) => s.replace('{who}', () => who)
  return { kind: 'ask', reason: fill(text.en), displayReason: { en: fill(text.en), fr: fill(text.fr) } }
}

/** What the person reads before a write, in both languages (`{who}` is the contact the agent names). */
const ASK = {
  add: { en: 'The agent wants to add {who} in Contacts. Nothing is sent to anyone. Allow it?', fr: 'L’agent veut ajouter {who} dans Contacts. Rien n’est envoyé à personne. Autoriser ?' },
  addNote: { en: 'The agent wants to add {who} in Contacts, with a note. Nothing is sent to anyone. Allow it?', fr: 'L’agent veut ajouter {who} dans Contacts, avec une note. Rien n’est envoyé à personne. Autoriser ?' },
  change: { en: 'The agent wants to change {who} in Contacts. Nothing is sent to anyone. Allow it?', fr: 'L’agent veut modifier {who} dans Contacts. Rien n’est envoyé à personne. Autoriser ?' },
  changeNote: { en: 'The agent wants to change {who} in Contacts, with a note. Nothing is sent to anyone. Allow it?', fr: 'L’agent veut modifier {who} dans Contacts, avec une note. Rien n’est envoyé à personne. Autoriser ?' },
}
