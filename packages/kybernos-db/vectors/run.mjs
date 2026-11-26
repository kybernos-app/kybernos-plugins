// Runs the shared JSON cases (fixtures.json + one file per suite) against a core. It reads nothing and imports nothing: the caller hands it the core and the parsed
// JSON, so the very same runner works in Node (test-core.mjs), in a browser page and, in phase B, on the server. The server's own tests will load these files too.
//
//   const report = runVectors(core, { fixtures, suites: { values, fields, filter, sort, query, views, rights, ops } }, { freeze: true })
//   report → { total, failures: [{ suite, name, expected, actual }], digest, perSuite }
//
// `digest` hashes everything every function answered (messages included, not just the pass/fail), so two environments that print the same digest gave the same answers.
// In a case, a string equal to a key of `fixtures.alias` stands for its value, and { "$repeat": [x, n] } is x repeated n times (a text or a list).
// A record is named by the last two characters of its id (« 03 »).

const sortKeys = (x) => (Array.isArray(x) ? x.map(sortKeys) : x !== null && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys(x[k])])) : x)
/** Canonical JSON: keys sorted, so two equal values always give the same text. */
export const canon = (x) => JSON.stringify(sortKeys(x === undefined ? null : x))

/** FNV-1a over the UTF-16 units of a text: 8 hex digits, the same everywhere. */
export const digestOf = (text) => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

const expand = (x, alias) => {
  if (typeof x === 'string') return Object.prototype.hasOwnProperty.call(alias, x) ? alias[x] : x
  if (Array.isArray(x)) return x.map((v) => expand(v, alias))
  if (x !== null && typeof x === 'object') {
    const keys = Object.keys(x)
    if (keys.length === 1 && keys[0] === '$repeat') {
      const [value, times] = x.$repeat
      return typeof value === 'string' ? value.repeat(times) : Array.from({ length: times }, () => expand(value, alias))
    }
    return Object.fromEntries(keys.map((k) => [Object.prototype.hasOwnProperty.call(alias, k) ? alias[k] : k, expand(x[k], alias)]))
  }
  return x
}

const deepFreeze = (x) => {
  if (x !== null && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x)
    for (const k of Object.keys(x)) deepFreeze(x[k])
  }
  return x
}

const fmt = (e) => e.path + ':' + e.code
const short = (r) => r.id.slice(-2)

export function runVectors (core, data, options = {}) {
  const alias = data.fixtures.alias
  const fx = expand(data.fixtures, alias)
  const freeze = options.freeze === true
  if (freeze) deepFreeze(fx)
  const objectOf = (c) => fx.objects[c.object || 'task']
  const recordsOf = (c) => fx.records[c.object || 'task']
  const ctxOf = (c) => ({ today: fx.today, me: fx.me, label: (field, v) => fx.labels[v], ...(c.ctx || {}) })

  const handlers = {
    values: (c) => {
      const raw = core.normalizeValue(c.field, c.input)
      return { actual: raw.ok ? { ok: true, value: raw.value } : { ok: false, code: raw.code }, raw }
    },
    fields: (c) => {
      const raw = core.normalizeField(c.def)
      return { actual: raw.ok ? { ok: true, field: raw.field } : { ok: false, errors: raw.errors.map(fmt) }, raw }
    },
    filter: (c) => {
      const fields = objectOf(c).fields
      if (c.mode === 'check') { const raw = core.checkFilter(c.flt, fields); return { actual: raw.map(fmt), raw } }
      if (c.mode === 'prepare') { const raw = core.prepareFilter(c.flt, fields); return { actual: raw, raw } }
      const ids = recordsOf(c).filter((r) => core.matches(c.flt, r, fields, ctxOf(c))).map(short)
      return { actual: ids, raw: ids }
    },
    sort: (c) => {
      const fields = objectOf(c).fields
      if (c.mode === 'check') { const raw = core.checkSorts(c.sorts, fields); return { actual: raw.map(fmt), raw } }
      if (c.mode === 'prepare') { const raw = core.prepareSorts(c.sorts, fields); return { actual: raw, raw } }
      const ids = core.sortRecords(recordsOf(c), c.sorts, fields, ctxOf(c)).map(short)
      return { actual: ids, raw: ids }
    },
    query: (c) => {
      const ids = core.queryRecords(recordsOf(c), { fields: objectOf(c).fields, q: c.q, flt: c.flt, sorts: c.sorts }, ctxOf(c)).map(short)
      return { actual: ids, raw: ids }
    },
    views: (c) => {
      const obj = objectOf(c)
      if (c.mode === 'check') { const raw = core.checkView(c.view, obj); return { actual: raw.map(fmt), raw } }
      if (c.mode === 'normalize') {
        const raw = core.normalizeView(c.view, obj)
        return { actual: raw.ok ? { ok: true, view: raw.view } : { ok: false, errors: raw.errors.map(fmt) }, raw }
      }
      const fields = c.keep ? obj.fields.filter((f) => c.keep.includes(f.key)) : obj.fields
      const raw = core.repairView(c.view, fields, obj.title)
      return { actual: raw, raw }
    },
    rights: (c) => {
      const raw = core.can(c.actor, c.action, c.resource)
      return { actual: raw, raw }
    },
    ops: (c) => {
      const obj = objectOf(c)
      if (c.mode === 'buildCreate') {
        const raw = core.buildCreate(obj, c.values, c.meta)
        return { actual: raw.ok ? { ok: true, op: raw.op } : { ok: false, errors: raw.errors.map(fmt) }, raw }
      }
      if (c.mode === 'buildUpdate') {
        const raw = core.buildUpdate(obj, recordsOf(c).find((r) => r.id === c.record), c.changes, c.meta)
        return { actual: raw.ok ? { ok: true, op: raw.op } : { ok: false, errors: raw.errors.map(fmt) }, raw }
      }
      let record = c.start || null
      const raw = []
      for (const step of c.steps) {
        const r = core.applyOp(record, step, obj)
        raw.push(r)
        if (r.ok) record = r.record
      }
      return { actual: raw.map((r) => (r.ok ? { ok: true, record: r.record } : { ok: false, code: r.code })), raw }
    },
  }

  const failures = []
  const perSuite = {}
  const answers = []
  let total = 0
  for (const name of Object.keys(handlers)) {
    const suite = data.suites[name]
    perSuite[name] = { total: 0, failed: 0 }
    if (!suite) { failures.push({ suite: name, name: '(suite missing)', expected: 'cases', actual: 'nothing' }); continue }
    for (const original of suite.cases) {
      const c = expand(original, alias)
      if (freeze) deepFreeze(c)
      let result
      try { result = handlers[name](c) } catch (e) { result = { actual: { throws: e.name }, raw: { throws: e.name } } }
      total += 1
      perSuite[name].total += 1
      answers.push(canon(result.raw))
      if (canon(result.actual) !== canon(c.expect)) {
        perSuite[name].failed += 1
        failures.push({ suite: name, name: c.name, expected: c.expect, actual: result.actual })
      }
    }
  }
  return { total, failures, digest: digestOf(answers.join('\n')), perSuite }
}
