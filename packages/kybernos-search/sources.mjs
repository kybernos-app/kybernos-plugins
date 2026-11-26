// The searchable things that are NOT chats: skills, lessons, automations, agent teams. Small and read straight from disk at each use
// (cached for a minute by the index). Every read is guarded: a missing or unreadable file is an empty source, never an error.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAX_TEXT = 12000

const read = (file, max = 400000) => {
  try { const s = statSync(file); if (!s.isFile() || s.size > max) return null; return readFileSync(file, 'utf8') } catch (e) { return null }
}
const ls = (dir) => { try { return readdirSync(dir, { withFileTypes: true }) } catch (e) { return [] } }

/** `---` front matter with flat `key: value` lines (what SKILL.md and kyber.yml use for name and description). */
export function frontMatter (text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (m === null) return { meta: {}, body: text }
  const meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (kv !== null) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim()
  }
  return { meta, body: m[2] }
}

const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim()

export function skills (home) {
  const docs = []
  for (const e of ls(join(home, 'skills'))) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const txt = read(join(home, 'skills', e.name, 'SKILL.md'))
    if (txt === null) continue
    const { meta, body } = frontMatter(txt)
    const title = meta.name || e.name
    const t = [meta.description, body].filter(Boolean).join('\n').slice(0, MAX_TEXT)
    docs.push({ scope: 'skill', id: e.name, title, parts: [{ r: 'doc', ts: null, t }], meta: { where: 'skills', sub: oneLine(meta.description || '').slice(0, 140) }, open: { kind: 'page', view: 'skills' }, ts: null })
  }
  return docs
}

export function lessons (home) {
  const docs = []
  for (const e of ls(join(home, 'kybers'))) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const txt = read(join(home, 'kybers', e.name, 'memory', 'lessons.jsonl'))
    if (txt === null) continue
    let n = 0
    for (const line of txt.split('\n')) {
      if (line === '') continue
      let j = null
      try { j = JSON.parse(line) } catch (err) { continue }
      const text = typeof j?.text === 'string' ? j.text : ''
      if (text === '') continue
      const tags = Array.isArray(j.tags) ? j.tags.filter((x) => typeof x === 'string').join(' ') : ''
      const ts = typeof j.ts === 'string' ? Date.parse(j.ts) : NaN
      docs.push({ scope: 'lesson', id: e.name + ':' + n, title: oneLine(text).slice(0, 90), parts: [{ r: 'doc', ts: Number.isFinite(ts) ? ts : null, t: (text + (tags !== '' ? '\n' + tags : '')).slice(0, 4000) }], meta: { where: e.name }, open: null, ts: Number.isFinite(ts) ? ts : null })
      n += 1
    }
  }
  return docs
}

export function automations (home) {
  const txt = read(join(home, 'kybernos', 'tasks.json'))
  if (txt === null) return []
  let arr = null
  try { arr = JSON.parse(txt) } catch (e) { return [] }
  if (!Array.isArray(arr)) return []
  return arr.filter((t) => t !== null && typeof t === 'object' && typeof t.name === 'string').map((t) => ({
    scope: 'automation', id: String(t.id ?? t.name), title: t.name,
    parts: [{ r: 'doc', ts: null, t: String(t.prompt ?? '').slice(0, 4000) }],
    meta: { where: 'automations' }, open: { kind: 'page', view: 'tasks' }, ts: Number.isFinite(Date.parse(t.updatedAt)) ? Date.parse(t.updatedAt) : null
  }))
}

export function teams (home) {
  const docs = []
  for (const e of ls(join(home, 'kybers'))) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const txt = read(join(home, 'kybers', e.name, 'kyber.yml'), 100000)
    if (txt === null) continue
    const name = /^name:\s*["']?(.+?)["']?\s*$/m.exec(txt)?.[1] ?? e.name
    docs.push({ scope: 'team', id: e.name, title: name, parts: [{ r: 'doc', ts: null, t: txt.slice(0, 8000) }], meta: { where: 'agent teams' }, open: { kind: 'page', view: 'kybers' }, ts: null })
  }
  return docs
}

export function allSources (home) {
  return [].concat(skills(home), lessons(home), automations(home), teams(home))
}
