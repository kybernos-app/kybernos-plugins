// A small chat and the Journal document made from it, for the scripts that open a shared Journal page in a browser (check-journal-link-page.mjs, check-journal-link-e2e.mjs).
// One connector call, one permission asked and allowed, one reply: enough to draw every part of the page without a real chat.
import { journalDocument } from '../packages/kybernos-plugin/journal-page.mjs'
import { deriveStory } from '../packages/kybernos-plugin/journal-story.mjs'

const T0 = 1_800_000_000_000
const MIN = 60_000

/** The events of the sample chat; `marker` is a word that is in the chat's first reply, to look for in what reaches a server or a page. */
export const sampleEvents = (marker = 'done') => {
  let seq = 0
  const ev = (type, at, data) => { seq += 1; return { type, seq, time: T0 + at, data } }
  return [
    ev('turn/start', 0, { turn: 1 }),
    ev('user/message', 1, { role: 'user', content: [{ type: 'text', text: 'Send the offer' }], source: { kind: 'user' } }),
    ev('tool/call', MIN, { turn: 1, step: 1, callId: 'g1', name: 'GMAIL_SEND_EMAIL', arguments: '{}' }),
    ev('tool/result', MIN + 500, { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'g1', source: { kind: 'tool', callId: 'g1' }, content: [{ type: 'text', text: 'sent' }] } }),
    ev('approval/asked', 2 * MIN, { id: 'ap1', toolName: 'bash', callId: 'b1', reason: 'delete the folder' }),
    ev('approval/decided', 2 * MIN + 2000, { id: 'ap1', outcome: 'allowed-once' }),
    ev('assistant/message', 3 * MIN, { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: marker }], source: { kind: 'model', provider: 'zai', model: 'glm' } } }),
    ev('turn/end', 3 * MIN + 10, { turn: 1 }),
  ]
}

/** The Journal document of the sample chat. `include` are the switches of the Share sheet (the defaults when none). */
export const sampleJournalDoc = ({ sessionId = 'session-SAMPLECHAT1', include = { approvers: true, timing: true, deliverables: true }, marker } = {}) => {
  const story = deriveStory(sampleEvents(marker), { sessionId, runs: [], costOf: () => null, decisions: {}, seals: {} })
  return journalDocument({ story, include, lang: 'en', logos: {}, made: '2026-11-02' })
}
