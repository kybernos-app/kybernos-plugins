// kybernos-call: what the session's assistant is told while a voice call is going on.
//
// A written answer and a spoken one are not the same thing. On the first real call the assistant answered "Paris" and
// then read a menu of kybers and skills it adds under every answer. While a call is live the session's system prompt
// carries this short brief; the rest of the time it carries nothing (the chunk is empty, so no other session changes).

export const CALL_BRIEF = [
  'LIVE VOICE CALL. The user is talking to you on a voice call: what you write is read aloud as soon as you write it.',
  '- Answer only what was asked, in one to three short sentences, in the language the user is speaking. Plain spoken prose: no lists, tables, headings, code, emoji or links.',
  '- Do not add menus of options, suggestions of kybers, agents or skills, or a closing question such as "anything else?". Do not narrate what you are about to do before using a tool.',
  '- Only the FIRST paragraph of each message is spoken. If the answer needs detail, give the gist in that first paragraph and put the detail after a blank line: it stays in the thread and is not read aloud.'
].join('\n')

const sessionIdOf = (context) => {
  try { return context.agent.session.id } catch (e) { return undefined }
}

/** The text injected at each prompt assembly. Synchronous, and it never throws: no live call, no text. */
export const renderCallBrief = (feed, context) => {
  try {
    if (feed === null || feed === undefined || typeof feed.active !== 'function') return ''
    const id = sessionIdOf(context)
    return (typeof id === 'string' && id !== '' && feed.active(id) === true) ? CALL_BRIEF : ''
  } catch (e) { return '' }
}
