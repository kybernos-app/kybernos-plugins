// The Tools tab's reading and editing of a profile's cordis.patch.yml, as pure functions (no disk, no clock): which rows of the file
// mount a tool, whether it is switched off, and the text of the file once it is switched off or on again.
//
// "Off" is the loader's own entry option, `disabled: true`: the entry is stopped and not started, and nothing is removed (the package
// stays in the profile, the row stays in the file with its config). DSH reloads the file by itself a few seconds after it is written (the
// profile's `hmr` entry watches it), so there is no restart and no engine patch: it is the seam the engine ships. The owner already used
// it by hand (the « light mode » block of the real profile: a patch entry `- id: <row>` + `disabled: true` aimed at a row elsewhere in
// the file), so the state is read the way the loader reads it: the LAST entry of the file that names the row and carries `disabled` wins,
// whether it is the row itself or a patch entry aimed at its id.
//
// This is not a YAML reader. The file is written by DSH, by this tab and by the Workers page in a fixed shape (regular indentation,
// one-line scalars); an entry in any other shape (a flow mapping, `disabled: !!js …`) is named and left alone, never guessed.

const clean = (raw) => {
  let v = String(raw ?? '').replace(/\s+#.*$/, '').trim()
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1)
  return v
}

/**
 * Every `- id: …` entry of the file, wherever it sits (top level, or inside an `insert:` list).
 * @returns {{id:string, start:number, end:number, indent:number, fields:Record<string,string>, at:Record<string,number>}[]}
 *   `fields` = the one-line scalars at the entry's own level (`name`, `disabled`…), `at` = the line of each of those keys.
 */
export function patchEntries (text) {
  const lines = String(text ?? '').split('\n')
  const entries = []
  let cur = null
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/\r$/, '') // a file with Windows line ends reads the same
    if (/^\s*#/.test(l) || l.trim() === '') continue
    const m = /^(\s*)-\s+id:\s*(.+)$/.exec(l)
    if (m) {
      cur = { id: clean(m[2]), start: i, end: i, indent: m[1].length, fields: {}, at: {} }
      entries.push(cur)
      continue
    }
    if (/^\S/.test(l)) { cur = null; continue }
    if (cur === null) continue
    const ind = /^(\s*)/.exec(l)[1].length
    if (ind <= cur.indent) { cur = null; continue }
    cur.end = i
    const kv = /^\s*([A-Za-z_][\w-]*):\s*(.*)$/.exec(l)
    if (kv !== null && ind === cur.indent + 2) { cur.fields[kv[1]] = clean(kv[2]); cur.at[kv[1]] = i }
  }
  return entries
}

/**
 * The rows that mount a tool, as { names, ids, fallbackNames }: a row whose `name:` is one of `names` (or whose id is one of `ids`);
 * `fallbackNames` only count when none of those is in the file. Browser Use is a registry row plus a driver row, and only the driver
 * publishes tools: the driver is what is switched, the registry (which "publishes nothing by itself") stays, as it does in the real profile.
 */
export const rowsOfTool = (entries, tool) => {
  const names = Array.isArray(tool?.names) ? tool.names : []
  const ids = Array.isArray(tool?.ids) ? tool.ids : []
  const fallback = Array.isArray(tool?.fallbackNames) ? tool.fallbackNames : []
  const mounting = entries.filter((e) => e.fields.name !== undefined)
  const main = mounting.filter((e) => names.includes(e.fields.name) || ids.includes(e.id))
  return main.length > 0 ? main : mounting.filter((e) => fallback.includes(e.fields.name))
}

/** What the loader ends up with for a row id: the value of the last entry that names it and carries `disabled` ('false' when none does). */
const effective = (entries, id) => {
  let v = 'false'
  for (const e of entries) if (e.id === id && e.fields.disabled !== undefined) v = e.fields.disabled
  return v
}

/**
 * Is the tool switched off in this file?
 *   rows      : how many rows mount it (0 = nothing this tab can edit)
 *   disabled  : true when at least one of them ends up `disabled: true` (a family with one of its rows off publishes nothing), false when
 *               none does, null when it cannot be told
 *   can       : false when the file cannot be edited safely, and `why` says what stops it: no-row (nothing to edit) · expression
 *               (`disabled` is a `!!js` expression: only its owner knows what it means)
 */
export function switchOf (text, tool) {
  const entries = patchEntries(text)
  const rows = rowsOfTool(entries, tool)
  if (rows.length === 0) return { rows: 0, disabled: null, can: false, why: 'no-row' }
  let off = 0
  for (const r of rows) {
    const v = effective(entries, r.id)
    if (v === 'true') off += 1
    else if (v !== 'false') return { rows: rows.length, disabled: null, can: false, why: 'expression' }
  }
  return { rows: rows.length, disabled: off > 0, can: true, why: null }
}

/**
 * The file once the tool is switched off (`wanted` true) or on (`wanted` false).
 *   on  : every `disabled` line that names one of its rows goes away, in the row and in a patch entry aimed at it (an entry that held
 *         nothing else goes away whole), so the loader falls back to "not disabled" whatever order the lines were in;
 *   off : `disabled: true` is put in the row itself, under its `name:`, unless an earlier line already says `disabled: false` for that
 *         id, in which case that line is turned to `true` (one line, one place).
 * @returns {{ok:true, changed:boolean, after:string, lines:{id:string, line:number, to:string}[]} | {ok:false, error:string}}
 */
export function setSwitch (text, tool, wanted) {
  const before = String(text ?? '')
  const cr = before.includes('\r\n') ? '\r' : '' // the lines we write end the way the file's do
  const state = switchOf(before, tool)
  if (state.can !== true) return { ok: false, error: state.why }
  if (state.disabled === wanted) return { ok: true, changed: false, after: before, lines: [] }
  const entries = patchEntries(before)
  const rows = rowsOfTool(entries, tool)
  const ids = [...new Set(rows.map((r) => r.id))]
  const edits = [] // { from, count, insert: string[] } on the 0-based lines of `before`
  const said = []
  for (const id of ids) {
    const named = entries.filter((e) => e.id === id)
    if (wanted === false) {
      for (const e of named) {
        if (e.fields.disabled === undefined) continue
        const alone = e.fields.name === undefined && Object.keys(e.fields).length === 1 && e.end - e.start === 1
        if (alone) edits.push({ from: e.start, count: 2, insert: [] })
        else edits.push({ from: e.at.disabled, count: 1, insert: [] })
        said.push({ id, line: (alone ? e.start : e.at.disabled) + 1, to: alone ? '(entry removed)' : '(disabled line removed)' })
      }
    } else if (effective(entries, id) === 'false') {
      const last = [...named].reverse().find((e) => e.fields.disabled !== undefined)
      if (last !== undefined) {
        edits.push({ from: last.at.disabled, count: 1, insert: [' '.repeat(last.indent + 2) + 'disabled: true' + cr] })
        said.push({ id, line: last.at.disabled + 1, to: 'disabled: true' })
      } else {
        const row = named.find((e) => e.fields.name !== undefined)
        edits.push({ from: row.at.name + 1, count: 0, insert: [' '.repeat(row.indent + 2) + 'disabled: true' + cr] })
        said.push({ id, line: row.at.name + 2, to: 'disabled: true' })
      }
    }
  }
  // From the last line to the first, so the line numbers of the edits still to apply stay valid.
  const lines = before.split('\n')
  for (const e of edits.sort((a, b) => b.from - a.from)) lines.splice(e.from, e.count, ...e.insert)
  const after = lines.join('\n')
  // Self-check: read back what is about to be written.
  const again = switchOf(after, tool)
  if (again.can !== true || again.rows !== rows.length || again.disabled !== wanted) return { ok: false, error: 'self-check' }
  return { ok: true, changed: after !== before, after, lines: said }
}
