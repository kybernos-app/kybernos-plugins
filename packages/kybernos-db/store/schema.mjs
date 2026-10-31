// The SQL of a database file, built from the catalog. Pure: strings in, strings out, nothing is executed here.
//
// A db file holds:
//   meta      the db's id, name and who made it
//   ctl       one switch, `quiet`: the engine sets it to 1 inside its own transaction so that its writes are not journaled twice
//   catalog   one row per version of the structure (objects and fields), never rewritten
//   ops       the journal: every change to a record, one row per operation, in the order they were made
//   views     the saved ways of looking at an object (core/view.mjs), one row per view, edited in place (a revision counts the saves)
//   r_<key>   one table per object, one column per field, plus the record's envelope (id, rev, created/modified/deleted by and at)
//
// Raw SQL is welcome: the triggers below journal what it does (source 'sql') and keep `rev` and the stamps true, whichever connection wrote.
// What it cannot do: change a record's id, or remove a row (a record is deleted by setting `deleted_at`). Its operation gets no id until the engine seals it
// (`ops.id` is NULL until then), so no trigger needs a function that only the engine's connection has.

import { isJsonColumn, sqlType } from './columns.mjs'

export const FORMAT = 1
/** « KYDB »: stored in the file so that a Kybernos db is told apart from any other SQLite file. */
export const APPLICATION_ID = 0x4b594442

export const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
const STAMP_GLOB = "'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'"
const QUIET = "(SELECT v FROM ctl WHERE k = 'quiet') = 0"

export const q = (name) => '"' + String(name).replace(/"/g, '""') + '"'
const lit = (text) => "'" + String(text).replace(/'/g, "''") + "'"

export const tableName = (objectKey) => 'r_' + objectKey

export const BASE_DDL = [
  'CREATE TABLE meta (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL) WITHOUT ROWID',
  'CREATE TABLE ctl (k TEXT PRIMARY KEY NOT NULL, v INTEGER NOT NULL) WITHOUT ROWID',
  "INSERT INTO ctl (k, v) VALUES ('quiet', 0)",
  'CREATE TABLE catalog (version INTEGER PRIMARY KEY, change TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, json TEXT NOT NULL CHECK (json_valid(json)))',
  `CREATE TABLE ops (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT UNIQUE CHECK (id IS NULL OR length(id) = 26),
  kind TEXT NOT NULL CHECK (kind IN ('create', 'update', 'delete', 'restore')),
  object TEXT NOT NULL,
  record TEXT NOT NULL,
  set_json TEXT CHECK (set_json IS NULL OR json_valid(set_json)),
  prev_json TEXT CHECK (prev_json IS NULL OR json_valid(prev_json)),
  actor TEXT NOT NULL,
  at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('engine', 'sql'))
)`,
  'CREATE INDEX ops_record ON ops (object, record)',
  `CREATE TABLE views (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 64),
  object TEXT NOT NULL,
  json TEXT NOT NULL CHECK (json_valid(json)),
  rev INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  modified_by TEXT NOT NULL,
  modified_at TEXT NOT NULL
)`,
  'CREATE INDEX views_object ON views (object)',
]

/** The definition of one field's column, with the checks that keep raw SQL from storing a shape the engine could not read back. */
export function columnSql (field) {
  const c = q(field.key)
  const type = sqlType(field)
  if (field.type === 'checkbox') return `${c} INTEGER NOT NULL DEFAULT 0 CHECK (${c} IN (0, 1))`
  if (isJsonColumn(field)) return `${c} TEXT CHECK (${c} IS NULL OR (typeof(${c}) = 'text' AND json_valid(${c}) AND json_type(${c}) = 'array' AND json_array_length(${c}) > 0))`
  if (type === 'REAL') return `${c} REAL CHECK (${c} IS NULL OR typeof(${c}) IN ('real', 'integer'))`
  let check = `typeof(${c}) = 'text' AND length(${c}) > 0`
  if (field.type === 'date') check += ` AND ${c} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`
  if (field.type === 'relation') check += ` AND length(${c}) = 26`
  return `${c} TEXT CHECK (${c} IS NULL OR (${check}))`
}

export function createTableSql (obj) {
  const stamp = (name) => `${q(name)} TEXT NOT NULL DEFAULT (${NOW_SQL}) CHECK (${q(name)} GLOB ${STAMP_GLOB})`
  const lines = [
    `${q('id')} TEXT PRIMARY KEY NOT NULL CHECK (length(${q('id')}) = 26)`,
    `${q('rev')} INTEGER NOT NULL DEFAULT 1`,
    `${q('created_by')} TEXT NOT NULL DEFAULT 'sql'`,
    stamp('created_at'),
    `${q('modified_by')} TEXT NOT NULL DEFAULT 'sql'`,
    stamp('modified_at'),
    `${q('deleted_by')} TEXT`,
    `${q('deleted_at')} TEXT CHECK (${q('deleted_at')} IS NULL OR ${q('deleted_at')} GLOB ${STAMP_GLOB})`,
    ...obj.fields.map(columnSql),
  ]
  return `CREATE TABLE ${q(tableName(obj.key))} (\n  ${lines.join(',\n  ')}\n)`
}

export const addColumnSql = (obj, field) => `ALTER TABLE ${q(tableName(obj.key))} ADD COLUMN ${columnSql(field)}`

/** The JSON text of a column's value, as an SQL expression over NEW or OLD. */
function jsonOf (field, ref) {
  const c = `${ref}.${q(field.key)}`
  if (field.type === 'checkbox') return `CASE WHEN ${c} THEN 'true' ELSE 'false' END`
  if (isJsonColumn(field)) return `COALESCE(${c}, 'null')`
  return `json_quote(${c})`
}

/** An SQL expression building the JSON object `{ field: value }` of the fields for which `when(field)` is an SQL condition. */
function objectSql (fields, ref, when) {
  const parts = fields.map((f, i) => `SELECT ${i} AS n, ${lit(f.key)} AS k, ${jsonOf(f, ref)} AS v WHERE ${when(f)}`)
  return `(SELECT '{' || COALESCE(group_concat(json_quote(k) || ':' || v, ',' ORDER BY n), '') || '}' FROM (${parts.join(' UNION ALL ')}))`
}

const SUFFIXES = ['ins', 'upd', 'del', 'res', 'id', 'rm', 'ro']
const triggerName = (obj, suffix) => q(`kb_${obj.key}_${suffix}`)

export const dropTriggersSql = (obj) => SUFFIXES.map((s) => `DROP TRIGGER IF EXISTS ${triggerName(obj, s)}`)

/** The triggers of an object's table: they journal and stamp what raw SQL does, and refuse what only the engine may do. */
export function triggersSql (obj) {
  const t = q(tableName(obj.key))
  const cols = obj.fields.map((f) => q(f.key)).join(', ')
  const changed = obj.fields.map((f) => `NEW.${q(f.key)} IS NOT OLD.${q(f.key)}`).join(' OR ')
  const by = (col) => `CASE WHEN NEW.${q(col)} IS NOT OLD.${q(col)} THEN NEW.${q(col)} ELSE 'sql' END`
  const journal = (kind, setSql, prevSql, actorSql, atSql, from) =>
    `INSERT INTO ops (kind, object, record, set_json, prev_json, actor, at, source) SELECT ${lit(kind)}, ${lit(obj.key)}, NEW.${q('id')}, ${setSql}, ${prevSql}, ${actorSql}, ${atSql}, 'sql'${from}`
  const row = ` FROM ${t} AS r WHERE r.${q('id')} = NEW.${q('id')}`
  const out = []

  out.push(`CREATE TRIGGER ${triggerName(obj, 'ins')} AFTER INSERT ON ${t} WHEN ${QUIET}
BEGIN
  ${journal('create', objectSql(obj.fields, 'NEW', (f) => (f.type === 'checkbox' ? `NEW.${q(f.key)} = 1` : `NEW.${q(f.key)} IS NOT NULL`)), 'NULL', `NEW.${q('created_by')}`, `NEW.${q('created_at')}`, '')};
END`)

  if (obj.fields.length > 0) {
    out.push(`CREATE TRIGGER ${triggerName(obj, 'upd')} AFTER UPDATE OF ${cols} ON ${t} WHEN ${QUIET} AND (${changed})
BEGIN
  UPDATE ${t} SET ${q('rev')} = OLD.${q('rev')} + 1, ${q('modified_by')} = ${by('modified_by')}, ${q('modified_at')} = ${NOW_SQL} WHERE ${q('id')} = NEW.${q('id')};
  ${journal('update', objectSql(obj.fields, 'NEW', (f) => `NEW.${q(f.key)} IS NOT OLD.${q(f.key)}`), objectSql(obj.fields, 'OLD', (f) => `NEW.${q(f.key)} IS NOT OLD.${q(f.key)}`), `r.${q('modified_by')}`, `r.${q('modified_at')}`, row)};
END`)

    out.push(`CREATE TRIGGER ${triggerName(obj, 'ro')} BEFORE UPDATE OF ${cols}, ${q('deleted_at')} ON ${t} WHEN ${QUIET} AND (OLD.${q('deleted_at')} IS NOT NULL OR NEW.${q('deleted_at')} IS NOT NULL) AND (${changed})
BEGIN
  SELECT RAISE(ABORT, 'fields cannot change while a record is deleted, nor in the statement that deletes or restores it');
END`)
  }

  out.push(`CREATE TRIGGER ${triggerName(obj, 'del')} AFTER UPDATE OF ${q('deleted_at')} ON ${t} WHEN ${QUIET} AND OLD.${q('deleted_at')} IS NULL AND NEW.${q('deleted_at')} IS NOT NULL
BEGIN
  UPDATE ${t} SET ${q('rev')} = OLD.${q('rev')} + 1, ${q('deleted_by')} = ${by('deleted_by')}, ${q('modified_by')} = ${by('deleted_by')}, ${q('modified_at')} = NEW.${q('deleted_at')} WHERE ${q('id')} = NEW.${q('id')};
  ${journal('delete', 'NULL', 'NULL', `r.${q('deleted_by')}`, `r.${q('deleted_at')}`, row)};
END`)

  out.push(`CREATE TRIGGER ${triggerName(obj, 'res')} AFTER UPDATE OF ${q('deleted_at')} ON ${t} WHEN ${QUIET} AND OLD.${q('deleted_at')} IS NOT NULL AND NEW.${q('deleted_at')} IS NULL
BEGIN
  UPDATE ${t} SET ${q('rev')} = OLD.${q('rev')} + 1, ${q('deleted_by')} = NULL, ${q('modified_by')} = ${by('modified_by')}, ${q('modified_at')} = ${NOW_SQL} WHERE ${q('id')} = NEW.${q('id')};
  ${journal('restore', 'NULL', 'NULL', `r.${q('modified_by')}`, `r.${q('modified_at')}`, row)};
END`)

  out.push(`CREATE TRIGGER ${triggerName(obj, 'id')} BEFORE UPDATE OF ${q('id')} ON ${t}
BEGIN
  SELECT RAISE(ABORT, 'a record id never changes');
END`)

  out.push(`CREATE TRIGGER ${triggerName(obj, 'rm')} BEFORE DELETE ON ${t} WHEN ${QUIET}
BEGIN
  SELECT RAISE(ABORT, 'a record is deleted by setting deleted_at, not by removing the row');
END`)

  return out
}
