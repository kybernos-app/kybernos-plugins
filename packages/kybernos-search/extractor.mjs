// What a chat journal says, as plain text. Pure: no disk, no clock.
// A journal is JSON lines. The words of a chat are `user/message` (the person, not an injection: `source.kind` is `user` or absent) and
// `assistant/message` (its text blocks); its title is the LAST `session/title`. Tool calls and results are the other 99 % of the bytes
// and are NOT read here (a scope of their own, off, so not built in this version).

export const MAX_MESSAGE_CHARS = 8000
export const MAX_CHAT_CHARS = 300000

const textOf = (content) => {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.filter((b) => b !== null && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
  return ''
}

const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g

/**
 * @param {string} journal the decoded journal (JSON lines)
 * @returns {{ id: string|null, cwd: string, createdAt: number|null, lastAt: number|null, title: string, msgs: Array<[string, number|null, string]> }}
 *   `msgs`: [role ('u' person | 'a' assistant), time (ms), text]
 */
export function extractJournal (journal) {
  const out = { id: null, cwd: '', createdAt: null, lastAt: null, title: '', msgs: [] }
  let chars = 0
  for (const line of String(journal).split('\n')) {
    if (line === '' || line.charCodeAt(0) !== 123) continue
    let e = null
    try { e = JSON.parse(line) } catch (err) { continue }
    if (e === null || typeof e !== 'object') continue
    const d = e.data !== null && typeof e.data === 'object' ? e.data : {}
    const time = typeof e.time === 'number' ? e.time : null
    if (time !== null) out.lastAt = time
    if (e.type === 'session') {
      if (typeof e.id === 'string') out.id = e.id
      if (typeof e.cwd === 'string') out.cwd = e.cwd
      if (typeof e.createdAt === 'number') out.createdAt = e.createdAt
    } else if (e.type === 'session/title') {
      if (typeof d.title === 'string' && d.title.trim() !== '') out.title = d.title.trim()
    } else if (e.type === 'user/message') {
      const kind = d.source !== null && typeof d.source === 'object' ? d.source.kind : null
      if (kind !== null && kind !== undefined && kind !== 'user') continue
      const t = textOf(d.content).replace(REMINDER, '').trim()
      if (t === '' || chars >= MAX_CHAT_CHARS) continue
      const cut = t.slice(0, MAX_MESSAGE_CHARS)
      chars += cut.length
      out.msgs.push(['u', time, cut])
    } else if (e.type === 'assistant/message') {
      const m = d.message !== null && typeof d.message === 'object' ? d.message : {}
      const t = textOf(m.content).trim()
      if (t === '' || chars >= MAX_CHAT_CHARS) continue
      const cut = t.slice(0, MAX_MESSAGE_CHARS)
      chars += cut.length
      out.msgs.push(['a', time, cut])
    }
  }
  return out
}
