// ── The shared SQLite base of the business plugins (Contacts, Catalog, Pipeline) ─────────────────────────────────────────────────
//
// One file per profile, `<DSH home>/kybernos/business/donnees.sqlite` (the shape the DB viewer reads: a `pack` row declares the views).
// The three plugins never import this module: the core publishes a frozen seam, `globalThis[Symbol.for('kybernos.business')]`, and each plugin
// reads it when a question is asked. Absent, a plugin answers `base_missing`.
//
//   - Lazy: the seam is published at boot, the FILE is created by the first question that needs it, never by DSH starting. A folder that cannot
//     be written, a file that cannot be read, a Node without `node:sqlite`: the question answers `{ ok: false, error }`, nothing throws.
//   - One writer per process (node:sqlite is synchronous: a write is `BEGIN IMMEDIATE` … `COMMIT`, a nested write joins the open one). Across
//     processes (`dsh web` and `dsh headless`) WAL and `busy_timeout=3000` do the queueing (measured: two writers, 0 errors, no row lost).
//   - The contract of the small bases (skills mini-app-pack / mini-crm-base): foreign keys, CHECKs on closed lists, never a DROP, idempotent
//     migrations ruled by `PRAGMA user_version`. A base written by a NEWER version is refused (`schema_newer`), never downgraded.
//   - What a type, a field or a stage MEANS is not stored here: the plugins read the definitions from the registry (the contributions of the
//     active theme). A row only keeps the key of its type; an unknown key is shown as a generic row.
//   - Every write leaves one line in `changes` (who: person, agent, theme or seed), in the same transaction as the write.
//
// Pure over its ports (`file`, `sqlite`, `now`, `fs`): `test-business-base.mjs` drives it on a temp folder and with a Node that has no sqlite.
import { createRequire } from 'node:module'
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHomeSync } from './dsh-home.mjs'

export const SEAM = Symbol.for('kybernos.business')
export const SCHEMA_VERSION = 1
export const TABLES = Object.freeze(['contact', 'note', 'item', 'flow_card'])
export const ACTORS = Object.freeze(['person', 'agent', 'theme', 'seed'])
const LIST_MAX = 500
const SEED_MAX = 500
const JSON_MAX = 16 * 1024
const BUSY_MS = 3000

/** Where the file lives, resolved at each use (an isolated DSH_HOME must never reach the real home). */
export const businessFile = () => join(dshHomeSync(), 'kybernos', 'business', 'donnees.sqlite')

// ── what the viewer shows (the `pack` row) ───────────────────────────────────────────────────────────────────────────────────────
const PACK = Object.freeze({
  version: 1,
  nom: 'Kybernos Business',
  entites: [
    { table: 'contact', titre: 'Contacts', champs: ['name', 'type', 'email'], vues: ['liste'] },
    { table: 'item', titre: 'Catalog', champs: ['title', 'status', 'price_text'], vues: ['liste'] },
    { table: 'flow_card', titre: 'Cards', date: 'entered_stage_at', champs: ['title', 'stage', 'value_num'], vues: ['liste', 'calendrier'] },
  ],
})

// ── schema v1 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const SQL_V1 = `
CREATE TABLE IF NOT EXISTS contact (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'company')),
  type TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  email TEXT NOT NULL DEFAULT '' CHECK (length(email) <= 254),
  company_id INTEGER REFERENCES contact(id) ON DELETE SET NULL,
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags) AND json_type(tags) = 'array'),
  fields TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(fields) AND json_type(fields) = 'object'),
  demo INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS note (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  actor TEXT NOT NULL DEFAULT 'person' CHECK (actor IN ('person', 'agent', 'theme', 'seed')),
  demo INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS item (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  subtitle TEXT NOT NULL DEFAULT '' CHECK (length(subtitle) <= 200),
  status TEXT NOT NULL DEFAULT '',
  price_text TEXT NOT NULL DEFAULT '' CHECK (length(price_text) <= 60),
  price_num REAL,
  fields TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(fields) AND json_type(fields) = 'object'),
  demo INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS flow_card (
  id INTEGER PRIMARY KEY,
  flow TEXT NOT NULL,
  stage TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  subtitle TEXT NOT NULL DEFAULT '' CHECK (length(subtitle) <= 200),
  value_num REAL,
  contact_id INTEGER REFERENCES contact(id) ON DELETE SET NULL,
  item_id INTEGER REFERENCES item(id) ON DELETE SET NULL,
  fields TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(fields) AND json_type(fields) = 'object'),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  entered_stage_at TEXT NOT NULL,
  demo INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0, 1)),
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS changes (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('person', 'agent', 'theme', 'seed')),
  tbl TEXT NOT NULL,
  row_id INTEGER,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'move', 'archive', 'restore', 'seed', 'clear-demo', 'export', 'purge')),
  summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 300)
);
CREATE TABLE IF NOT EXISTS pack (id INTEGER PRIMARY KEY, contenu TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS contact_type ON contact(type);
CREATE INDEX IF NOT EXISTS contact_company ON contact(company_id);
CREATE INDEX IF NOT EXISTS note_contact ON note(contact_id);
CREATE INDEX IF NOT EXISTS item_type_status ON item(type, status);
CREATE INDEX IF NOT EXISTS flow_card_stage ON flow_card(flow, stage, position);
CREATE INDEX IF NOT EXISTS flow_card_contact ON flow_card(contact_id);
CREATE INDEX IF NOT EXISTS flow_card_item ON flow_card(item_id);
CREATE INDEX IF NOT EXISTS changes_ts ON changes(ts);
`
/** version → how to reach it from the one before. A new version appends here and bumps SCHEMA_VERSION: nothing is ever dropped. */
const MIGRATIONS = {
  1: (db, nowIso) => {
    db.exec(SQL_V1)
    db.prepare('INSERT INTO pack (contenu) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM pack)').run(JSON.stringify(PACK))
    db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('created_at', ?)").run(nowIso)
    db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('seeded', '[]')").run()
  },
}

// ── refusals: a code the caller can switch on, a sentence for the log ───────────────────────────────────────────────────────────
class Refus extends Error {
  constructor (code, message) { super(message); this.code = code }
}
const bad = (code, message) => { throw new Refus(code, message) }

/** Anything thrown becomes `{ ok: false, error, detail }`: a question never throws into DSH. */
function failure (e) {
  if (e instanceof Refus) return { ok: false, error: e.code, detail: e.message }
  const m = String(e && e.message ? e.message : e)
  if (/database is locked|database table is locked|busy/i.test(m)) return { ok: false, error: 'busy', detail: m.slice(0, 200) }
  if (/FOREIGN KEY/i.test(m)) return { ok: false, error: 'bad_ref', detail: m.slice(0, 200) }
  if (/constraint/i.test(m)) return { ok: false, error: 'constraint', detail: m.slice(0, 200) }
  if (/readonly database|read-only|EROFS/i.test(m)) return { ok: false, error: 'read_only', detail: m.slice(0, 200) }
  if (/unable to open|cannot open|ENOENT|EACCES|EPERM|ENOTDIR|EEXIST|EISDIR/i.test(m)) return { ok: false, error: 'cannot_open', detail: m.slice(0, 200) }
  if (/not a database|malformed|corrupt/i.test(m)) return { ok: false, error: 'not_a_database', detail: m.slice(0, 200) }
  return { ok: false, error: 'failed', detail: m.slice(0, 200) }
}

// ── fields: one checker per column, the same rules for create, update and seed ───────────────────────────────────────────────────
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const TYPE_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/

const text = (name, min, max) => (v) => {
  if (typeof v !== 'string') bad('bad_field', name + ': text expected')
  const t = v.trim()
  if (t.length < min || t.length > max) bad('bad_field', name + ': ' + (min > 0 ? min + ' to ' : 'at most ') + max + ' characters')
  return t
}
const key = (name, required) => (v) => {
  if (typeof v !== 'string') bad('bad_field', name + ': text expected')
  const t = v.trim()
  if (t === '' && required !== true) return ''
  if (!TYPE_RE.test(t)) bad('bad_field', name + ': lower-case letters, digits, "-" or "_", at most 40')
  return t
}
const oneOf = (name, list) => (v) => { if (list.indexOf(v) < 0) bad('bad_field', name + ': one of ' + list.join(', ')); return v }
const number = (name) => (v) => {
  if (v === null) return null
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e12) bad('bad_field', name + ': a finite number or null')
  return v
}
const ref = (name) => (v) => {
  if (v === null) return null
  if (!Number.isInteger(v) || v < 1) bad('bad_field', name + ': a row id or null')
  return v
}
const tags = (name) => (v) => {
  if (!Array.isArray(v) || v.length > 20) bad('bad_field', name + ': a list of at most 20 tags')
  const out = []
  for (const t of v) {
    if (typeof t !== 'string' || t.trim() === '' || t.trim().length > 40) bad('bad_field', name + ': each tag is 1 to 40 characters')
    if (out.indexOf(t.trim()) < 0) out.push(t.trim())
  }
  return out
}
const object = (name) => (v) => {
  if (!isPlain(v)) bad('bad_field', name + ': an object')
  if (JSON.stringify(v).length > JSON_MAX) bad('bad_field', name + ': at most 16 KB')
  return v
}
const position = (name) => (v) => {
  if (!Number.isInteger(v) || v < 0 || v > 1e6) bad('bad_field', name + ': a whole number from 0')
  return v
}

/** Per table: column → { check, def } (def undefined = required). `json` columns are stored as text. `label` names the row in the journal. */
const SPEC = {
  contact: {
    label: 'name', json: ['tags', 'fields'], stamps: true,
    cols: {
      kind: { check: oneOf('kind', ['person', 'company']), def: 'person' },
      type: { check: key('type'), def: '' },
      name: { check: text('name', 1, 200) },
      email: { check: text('email', 0, 254), def: '' },
      company_id: { check: ref('company_id'), def: null },
      tags: { check: tags('tags'), def: [] },
      fields: { check: object('fields'), def: {} },
    },
    filters: { kind: 'kind', type: 'type', company_id: 'company_id' }, search: ['name', 'email'], order: 'name COLLATE NOCASE, id',
  },
  note: {
    label: 'body', json: [], stamps: false,
    cols: {
      contact_id: { check: ref('contact_id') },
      body: { check: text('body', 1, 4000) },
    },
    filters: { contact_id: 'contact_id' }, search: ['body'], order: 'created_at DESC, id DESC',
  },
  item: {
    label: 'title', json: ['fields'], stamps: true,
    cols: {
      type: { check: key('type'), def: '' },
      title: { check: text('title', 1, 200) },
      subtitle: { check: text('subtitle', 0, 200), def: '' },
      status: { check: key('status'), def: '' },
      price_text: { check: text('price_text', 0, 60), def: '' },
      price_num: { check: number('price_num'), def: null },
      fields: { check: object('fields'), def: {} },
    },
    filters: { type: 'type', status: 'status' }, search: ['title', 'subtitle'], order: 'updated_at DESC, id DESC',
  },
  flow_card: {
    label: 'title', json: ['fields'], stamps: false,
    cols: {
      flow: { check: key('flow', true) },
      stage: { check: key('stage', true) },
      title: { check: text('title', 1, 200) },
      subtitle: { check: text('subtitle', 0, 200), def: '' },
      value_num: { check: number('value_num'), def: null },
      contact_id: { check: ref('contact_id'), def: null },
      item_id: { check: ref('item_id'), def: null },
      fields: { check: object('fields'), def: {} },
      position: { check: position('position') },
    },
    filters: { flow: 'flow', stage: 'stage', contact_id: 'contact_id', item_id: 'item_id' }, search: ['title', 'subtitle'], order: 'flow, stage, position, id',
  },
}

const actorOf = (opts) => {
  const a = opts !== null && typeof opts === 'object' && opts.actor !== undefined ? opts.actor : 'person'
  if (ACTORS.indexOf(a) < 0) bad('bad_actor', 'actor: one of ' + ACTORS.join(', '))
  return a
}
const spec = (table) => { if (!Object.prototype.hasOwnProperty.call(SPEC, table)) bad('unknown_table', 'table: one of ' + TABLES.join(', ')); return SPEC[table] }
const idOf = (id) => { if (!Number.isInteger(id) || id < 1) bad('bad_id', 'id: a row id'); return id }

/** A few milliseconds of real waiting, in the one place a busy timeout does not reach (see `enterWal`). */
const pause = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } catch (e) { /* no way to wait here: the next try comes at once */ } }

/**
 * Puts a new file in WAL. SQLite answers `database is locked` at once, whatever `busy_timeout` says, when two connections switch the SAME new file
 * together (measured: DSH and a headless run opening the base at the same moment, under load, one of them failed on its first question). The
 * switch is only needed once, so: look first, and when it is busy, wait a little and look again.
 */
function enterWal (handle) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      if (handle.prepare('PRAGMA journal_mode').get().journal_mode === 'wal') return
      handle.exec('PRAGMA journal_mode = WAL')
      return
    } catch (e) {
      if (!/locked|busy/i.test(String(e && e.message)) || attempt >= 60) throw e
      pause(10 + Math.min(attempt * 5, 90))
    }
  }
}

/** Reads `sqlite` lazily: a Node without `node:sqlite` must not stop the core from loading. */
function loadSqlite () {
  try { return createRequire(import.meta.url)('node:sqlite') } catch (e) { return null }
}

/**
 * The base, over its ports. `file` is a function (resolved at each use) or a path; `sqlite` is `{ DatabaseSync }`, a function giving it, or null
 * (tests); `now` returns epoch milliseconds.
 */
export function createBusinessBase (ports = {}) {
  const fileOf = typeof ports.file === 'function' ? ports.file : (typeof ports.file === 'string' ? () => ports.file : businessFile)
  const lib = () => (ports.sqlite === undefined ? loadSqlite() : (typeof ports.sqlite === 'function' ? ports.sqlite() : ports.sqlite))
  const nowIso = () => new Date(typeof ports.now === 'function' ? ports.now() : Date.now()).toISOString()
  const mkdir = ports.mkdirSync || mkdirSync
  const exists = ports.existsSync || existsSync

  let db = null
  let dbFile = null
  let inTx = false

  const close = () => {
    const d = db
    db = null; dbFile = null; inTx = false
    try { if (d !== null) d.close() } catch (e) { /* already closed */ }
  }

  /** The one connection of this process, opened (and the file created and migrated) on the first question. */
  const open = () => {
    const file = fileOf()
    if (db !== null && (dbFile !== file || !exists(file))) close() // moved or deleted under our feet: reopen, never write into a ghost
    if (db !== null) return db
    const sqlite = lib()
    if (sqlite === null || sqlite === undefined || typeof sqlite.DatabaseSync !== 'function') bad('sqlite_unavailable', 'node:sqlite is not available in this Node')
    mkdir(dirname(file), { recursive: true, mode: 0o700 })
    const handle = new sqlite.DatabaseSync(file)
    try {
      handle.exec('PRAGMA busy_timeout = ' + BUSY_MS)
      enterWal(handle)
      try { chmodSync(file, 0o600) } catch (e) { /* personal data: private to the owner where the platform allows it */ }
      handle.exec('PRAGMA synchronous = NORMAL')
      handle.exec('PRAGMA foreign_keys = ON')
      migrate(handle)
    } catch (e) {
      try { handle.close() } catch (e2) { /* nothing to close */ }
      throw e
    }
    db = handle; dbFile = file
    return db
  }

  const versionOf = (handle) => Number(handle.prepare('PRAGMA user_version').get().user_version)
  function migrate (handle) {
    if (versionOf(handle) > SCHEMA_VERSION) bad('schema_newer', 'this base was written by a newer Kybernos (schema ' + versionOf(handle) + ')')
    if (versionOf(handle) === SCHEMA_VERSION) return
    handle.exec('BEGIN IMMEDIATE')
    try {
      // Re-read inside the lock: another process may have migrated while this one waited.
      let v = versionOf(handle)
      if (v > SCHEMA_VERSION) bad('schema_newer', 'this base was written by a newer Kybernos (schema ' + v + ')')
      for (v += 1; v <= SCHEMA_VERSION; v += 1) {
        MIGRATIONS[v](handle, nowIso())
        handle.exec('PRAGMA user_version = ' + v)
        handle.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(v))
      }
      handle.exec('COMMIT')
    } catch (e) {
      try { handle.exec('ROLLBACK') } catch (e2) { /* the engine already rolled back */ }
      throw e
    }
  }

  /** A write: one `BEGIN IMMEDIATE` … `COMMIT`; a write started inside a write joins it. */
  const write = (fn) => {
    const handle = open()
    if (inTx) return fn(handle)
    handle.exec('BEGIN IMMEDIATE')
    inTx = true
    try {
      const out = fn(handle)
      handle.exec('COMMIT')
      return out
    } catch (e) {
      try { handle.exec('ROLLBACK') } catch (e2) { /* the engine already rolled back */ }
      throw e
    } finally { inTx = false }
  }
  const read = (fn) => fn(open())
  const safe = (fn) => { try { return fn() } catch (e) { return failure(e) } }

  const journal = (handle, actor, tbl, rowId, action, summary) => {
    handle.prepare('INSERT INTO changes (ts, actor, tbl, row_id, action, summary) VALUES (?, ?, ?, ?, ?, ?)')
      .run(nowIso(), actor, tbl, rowId === undefined ? null : rowId, action, String(summary).slice(0, 300))
  }

  // ── rows in and out ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const decode = (table, row) => {
    if (row === undefined || row === null) return null
    const out = { ...row }
    for (const c of SPEC[table].json) out[c] = JSON.parse(out[c])
    if ('demo' in out) out.demo = out.demo === 1
    return out
  }
  const encode = (table, values) => {
    const out = { ...values }
    for (const c of SPEC[table].json) if (c in out) out[c] = JSON.stringify(out[c])
    return out
  }
  /** Checks the keys of `input` against the table: unknown keys are refused, defaults fill a create. */
  const checked = (table, input, creating) => {
    const s = spec(table)
    if (!isPlain(input)) bad('bad_field', 'a row is an object')
    const out = {}
    for (const k of Object.keys(input)) if (!Object.prototype.hasOwnProperty.call(s.cols, k)) bad('unknown_field', table + ': no column "' + k + '"')
    for (const [name, c] of Object.entries(s.cols)) {
      if (Object.prototype.hasOwnProperty.call(input, name)) out[name] = c.check(input[name])
      else if (creating && c.def !== undefined) out[name] = c.def
      else if (creating && name !== 'position') bad('missing_field', table + ': "' + name + '" is required')
    }
    return out
  }
  const rowOf = (handle, table, id) => decode(table, handle.prepare('SELECT * FROM ' + table + ' WHERE id = ?').get(id))

  /** The links a column check cannot see: a person belongs to a company, a company to nothing, a note to a contact. */
  const checkLinks = (handle, table, row, ownId) => {
    if (table === 'contact') {
      if (row.company_id === null || row.company_id === undefined) return
      if (row.kind === 'company') bad('bad_field', 'contact: a company has no company')
      if (ownId !== undefined && row.company_id === ownId) bad('bad_field', 'contact: a contact cannot be its own company')
      const c = handle.prepare('SELECT kind FROM contact WHERE id = ?').get(row.company_id)
      if (c === undefined) bad('bad_ref', 'company_id: no such contact')
      if (c.kind !== 'company') bad('bad_field', 'company_id: that contact is not a company')
    }
  }
  const summaryOf = (table, row) => table + ' "' + String(row[SPEC[table].label]).slice(0, 80) + '"'

  const create = (table, input, opts) => safe(() => {
    const actor = actorOf(opts)
    const s = spec(table)
    const values = checked(table, input, true)
    return write((handle) => {
      checkLinks(handle, table, values)
      const now = nowIso()
      if (table === 'flow_card' && values.position === undefined) {
        values.position = Number(handle.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM flow_card WHERE flow = ? AND stage = ?').get(values.flow, values.stage).p)
      }
      const cols = encode(table, values)
      if (s.stamps) { cols.created_at = now; cols.updated_at = now }
      if (table === 'note') { cols.actor = actor; cols.created_at = now }
      if (table === 'flow_card') cols.entered_stage_at = now
      const names = Object.keys(cols)
      const info = handle.prepare('INSERT INTO ' + table + ' (' + names.join(', ') + ') VALUES (' + names.map(() => '?').join(', ') + ')').run(...names.map((n) => cols[n]))
      const id = Number(info.lastInsertRowid)
      journal(handle, actor, table, id, 'create', summaryOf(table, values))
      return { ok: true, row: rowOf(handle, table, id) }
    })
  })

  const update = (table, id, patch, opts) => safe(() => {
    const actor = actorOf(opts)
    const s = spec(table)
    idOf(id)
    if (table === 'note') bad('not_allowed', 'a note is not edited: write a new one')
    const changes = checked(table, patch, false)
    if (Object.keys(changes).length === 0) bad('missing_field', 'nothing to change')
    return write((handle) => {
      const current = rowOf(handle, table, id)
      if (current === null) bad('not_found', table + ' ' + id + ': no such row')
      const merged = { ...current, ...changes }
      checkLinks(handle, table, merged, id)
      const cols = encode(table, changes)
      let action = 'update'
      if (table === 'flow_card' && changes.stage !== undefined && changes.stage !== current.stage) {
        cols.entered_stage_at = nowIso()
        action = 'move'
        // A card dropped on a column goes to the end of it, unless the caller says where.
        if (changes.position === undefined) cols.position = Number(handle.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM flow_card WHERE flow = ? AND stage = ?').get(merged.flow, merged.stage).p)
      }
      if (s.stamps) cols.updated_at = nowIso()
      const names = Object.keys(cols)
      handle.prepare('UPDATE ' + table + ' SET ' + names.map((n) => n + ' = ?').join(', ') + ' WHERE id = ?').run(...names.map((n) => cols[n]), id)
      journal(handle, actor, table, id, action, action === 'move'
        ? summaryOf(table, merged) + ': ' + current.stage + ' → ' + changes.stage
        : summaryOf(table, merged) + ': ' + Object.keys(changes).join(', '))
      return { ok: true, row: rowOf(handle, table, id) }
    })
  })

  const archiveOrRestore = (table, id, opts, restoring) => safe(() => {
    const actor = actorOf(opts)
    spec(table)
    idOf(id)
    if (table === 'note') bad('not_allowed', 'a note is not archived')
    return write((handle) => {
      const current = rowOf(handle, table, id)
      if (current === null) bad('not_found', table + ' ' + id + ': no such row')
      handle.prepare('UPDATE ' + table + ' SET archived_at = ? WHERE id = ?').run(restoring ? null : nowIso(), id)
      journal(handle, actor, table, id, restoring ? 'restore' : 'archive', summaryOf(table, current))
      return { ok: true, row: rowOf(handle, table, id) }
    })
  })

  const get = (table, id) => safe(() => {
    spec(table); idOf(id)
    return read((handle) => {
      const row = rowOf(handle, table, id)
      return row === null ? { ok: false, error: 'not_found', detail: table + ' ' + id + ': no such row' } : { ok: true, row }
    })
  })

  const like = (q) => '%' + String(q).replace(/[\\%_]/g, (c) => '\\' + c) + '%'
  const list = (table, options = {}) => safe(() => {
    const s = spec(table)
    const where = []
    const args = []
    if (options.includeArchived !== true && table !== 'note') where.push('archived_at IS NULL')
    for (const [name, col] of Object.entries(s.filters)) {
      if (options[name] === undefined || options[name] === null) continue
      if (typeof options[name] !== 'string' && !Number.isInteger(options[name])) bad('bad_field', name + ': text or a whole number')
      where.push(col + ' = ?'); args.push(options[name])
    }
    if (options.demo === true || options.demo === false) { where.push('demo = ?'); args.push(options.demo ? 1 : 0) }
    if (typeof options.q === 'string' && options.q.trim() !== '') {
      where.push('(' + s.search.map((c) => c + " LIKE ? ESCAPE '\\'").join(' OR ') + ')')
      for (let i = 0; i < s.search.length; i += 1) args.push(like(options.q.trim()))
    }
    const limit = Math.min(Math.max(Number.isInteger(options.limit) ? options.limit : 100, 1), LIST_MAX)
    const offset = Math.max(Number.isInteger(options.offset) ? options.offset : 0, 0)
    const clause = where.length > 0 ? ' WHERE ' + where.join(' AND ') : ''
    return read((handle) => ({
      ok: true,
      total: Number(handle.prepare('SELECT COUNT(*) AS n FROM ' + table + clause).get(...args).n),
      rows: handle.prepare('SELECT * FROM ' + table + clause + ' ORDER BY ' + s.order + ' LIMIT ? OFFSET ?').all(...args, limit, offset).map((r) => decode(table, r)),
    }))
  })

  // ── the sample rows of a theme ─────────────────────────────────────────────────────────────────────────────────────────────────
  const seeded = (handle) => { try { const a = JSON.parse(handle.prepare("SELECT value FROM meta WHERE key = 'seeded'").get().value); return Array.isArray(a) ? a : [] } catch (e) { return [] } }

  /**
   * Sample rows, every one marked `demo`. `data` = `{ contacts, items, cards, notes }`; rows may carry a `ref` and point at one another with
   * `company_ref`, `contact_ref`, `item_ref`. The same theme seeds once: a second call answers `skipped`.
   */
  const seed = (data, opts) => safe(() => {
    const actor = actorOf(Object.assign({ actor: 'seed' }, opts))
    const theme = opts !== null && typeof opts === 'object' ? opts.theme : undefined
    if (typeof theme !== 'string' || !/^[a-z0-9][a-z0-9/_-]{0,60}$/.test(theme)) bad('bad_field', 'theme: the id of the theme these rows come from')
    if (!isPlain(data)) bad('bad_field', 'seed: an object { contacts, items, cards, notes }')
    const lists = {}
    for (const k of ['contacts', 'items', 'cards', 'notes']) {
      lists[k] = data[k] === undefined ? [] : data[k]
      if (!Array.isArray(lists[k]) || lists[k].length > SEED_MAX) bad('bad_field', 'seed.' + k + ': a list of at most ' + SEED_MAX + ' rows')
    }
    // Everything is checked before the first insert: a bad row leaves nothing behind.
    const take = (row, refs, table) => {
      if (!isPlain(row)) bad('bad_field', 'a seed row is an object')
      const copy = { ...row }
      const refsOut = {}
      for (const r of refs) { refsOut[r] = copy[r]; delete copy[r] }
      const own = copy.ref; delete copy.ref
      if (own !== undefined && (typeof own !== 'string' || own === '' || own.length > 60)) bad('bad_field', 'ref: a short text')
      return { values: checked(table, copy, true), own, refs: refsOut }
    }
    const people = lists.contacts.map((r) => take(r, ['company_ref'], 'contact'))
    const items = lists.items.map((r) => take(r, [], 'item'))
    const cards = lists.cards.map((r) => take(r, ['contact_ref', 'item_ref'], 'flow_card'))
    const notes = lists.notes.map((r) => { if (!isPlain(r)) bad('bad_field', 'a seed row is an object'); if (typeof r.contact_ref !== 'string') bad('missing_field', 'a seed note needs contact_ref'); return { values: checked('note', { body: r.body, contact_id: 1 }, true), contactRef: r.contact_ref } })
    return write((handle) => {
      if (seeded(handle).indexOf(theme) >= 0) return { ok: true, skipped: true, theme }
      const now = nowIso()
      const ids = { contact: new Map(), item: new Map() }
      const insert = (table, values, extra) => {
        const cols = { ...encode(table, values), ...extra, demo: 1 }
        const names = Object.keys(cols)
        return Number(handle.prepare('INSERT INTO ' + table + ' (' + names.join(', ') + ') VALUES (' + names.map(() => '?').join(', ') + ')').run(...names.map((n) => cols[n])).lastInsertRowid)
      }
      const resolve = (map, r, what) => { if (r === undefined || r === null) return null; if (!map.has(r)) bad('bad_ref', what + ': no row with ref "' + r + '"'); return map.get(r) }
      // companies first, then the people that point at one
      for (const pass of [0, 1]) {
        for (const p of people) {
          if ((p.refs.company_ref === undefined) !== (pass === 0)) continue
          const values = { ...p.values, company_id: resolve(ids.contact, p.refs.company_ref, 'company_ref') }
          checkLinks(handle, 'contact', values)
          const id = insert('contact', values, { created_at: now, updated_at: now })
          if (p.own !== undefined) ids.contact.set(p.own, id)
        }
      }
      for (const it of items) { const id = insert('item', it.values, { created_at: now, updated_at: now }); if (it.own !== undefined) ids.item.set(it.own, id) }
      for (const c of cards) {
        const values = { ...c.values, contact_id: resolve(ids.contact, c.refs.contact_ref, 'contact_ref'), item_id: resolve(ids.item, c.refs.item_ref, 'item_ref') }
        if (values.position === undefined) values.position = Number(handle.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM flow_card WHERE flow = ? AND stage = ?').get(values.flow, values.stage).p)
        insert('flow_card', values, { entered_stage_at: now })
      }
      for (const n of notes) insert('note', { body: n.values.body, contact_id: resolve(ids.contact, n.contactRef, 'contact_ref') }, { actor: 'seed', created_at: now })
      handle.prepare("UPDATE meta SET value = ? WHERE key = 'seeded'").run(JSON.stringify(seeded(handle).concat([theme])))
      const counts = { contacts: people.length, items: items.length, cards: cards.length, notes: notes.length }
      journal(handle, actor, 'meta', undefined, 'seed', theme + ': ' + counts.contacts + ' contacts, ' + counts.items + ' items, ' + counts.cards + ' cards, ' + counts.notes + ' notes')
      return { ok: true, skipped: false, theme, counts }
    })
  })

  /** Removes every sample row (and what hangs on it), and lets the themes seed again. Rows the person made stay. */
  const clearDemo = (opts) => safe(() => {
    const actor = actorOf(opts)
    return write((handle) => {
      const removed = {}
      for (const t of ['note', 'flow_card', 'item', 'contact']) removed[t] = Number(handle.prepare('DELETE FROM ' + t + ' WHERE demo = 1').run().changes)
      handle.prepare("UPDATE meta SET value = '[]' WHERE key = 'seeded'").run()
      journal(handle, actor, 'meta', undefined, 'clear-demo', Object.entries(removed).map(([t, n]) => n + ' ' + t).join(', '))
      return { ok: true, removed }
    })
  })

  /** Everything, as plain data the person can keep (the journal and the markers included). */
  const exportAll = (opts) => safe(() => {
    const actor = actorOf(opts)
    return write((handle) => {
      const tables = {}
      for (const t of TABLES) tables[t] = handle.prepare('SELECT * FROM ' + t + ' ORDER BY id').all().map((r) => decode(t, r))
      tables.changes = handle.prepare('SELECT * FROM changes ORDER BY id').all()
      tables.meta = handle.prepare('SELECT * FROM meta ORDER BY key').all()
      const out = { ok: true, format: 1, schema_version: versionOf(handle), exported_at: nowIso(), tables }
      journal(handle, actor, 'meta', undefined, 'export', 'export of everything')
      return out
    })
  })

  /** Deletes every row of every table (the schema stays), then empties the WAL and the free pages so nothing is left in the file. Needs `{ confirm: true }`. */
  const deleteAll = (opts) => safe(() => {
    const actor = actorOf(opts)
    if (!(opts !== null && typeof opts === 'object' && opts.confirm === true)) bad('confirm_required', 'deleteAll needs { confirm: true }')
    const removed = write((handle) => {
      const out = {}
      for (const t of ['note', 'flow_card', 'item', 'contact', 'changes']) out[t] = Number(handle.prepare('DELETE FROM ' + t).run().changes)
      handle.prepare("UPDATE meta SET value = '[]' WHERE key = 'seeded'").run()
      journal(handle, actor, 'meta', undefined, 'purge', 'every row deleted')
      return out
    })
    const handle = open()
    try { handle.exec('PRAGMA wal_checkpoint(TRUNCATE)'); handle.exec('VACUUM') } catch (e) { /* the rows are gone; the cleanup is best effort */ }
    return { ok: true, removed }
  })

  const counts = () => safe(() => read((handle) => {
    const out = { ok: true, tables: {}, demo: {} }
    for (const t of TABLES) {
      out.tables[t] = Number(handle.prepare('SELECT COUNT(*) AS n FROM ' + t).get().n)
      out.demo[t] = Number(handle.prepare('SELECT COUNT(*) AS n FROM ' + t + ' WHERE demo = 1').get().n)
    }
    out.changes = Number(handle.prepare('SELECT COUNT(*) AS n FROM changes').get().n)
    return out
  }))

  /** Where the base lives and whether it exists: opens nothing, creates nothing. */
  const status = () => safe(() => {
    const file = fileOf()
    return { ok: true, path: file, exists: exists(file), available: (() => { const s = lib(); return s !== null && s !== undefined && typeof s.DatabaseSync === 'function' })(), schema: SCHEMA_VERSION }
  })

  /** Opens (creating and migrating if needed): what a plugin calls when it is about to use the base. */
  const ensureOpen = () => safe(() => { const handle = open(); return { ok: true, path: dbFile, version: versionOf(handle) } })

  return Object.freeze({
    version: 1,
    tables: TABLES,
    file: () => fileOf(),
    status, open: ensureOpen, close,
    list, get, create, update,
    archive: (table, id, opts) => archiveOrRestore(table, id, opts, false),
    restore: (table, id, opts) => archiveOrRestore(table, id, opts, true),
    seed, clearDemo, exportAll, deleteAll, counts,
  })
}

/**
 * The seam of this process: created once, published on `globalThis`, the same object afterwards. Creating it opens nothing and writes
 * nothing; the file appears with the first question a plugin asks. `ports` replace the defaults (a test points it at a temp folder).
 */
export function ensureBusiness (ports) {
  const existing = globalThis[SEAM]
  if (existing !== undefined && existing !== null && existing.version === 1) return existing
  const base = createBusinessBase(ports)
  try { globalThis[SEAM] = base } catch (e) { /* a frozen global: the plugins degrade to base_missing */ }
  return base
}
