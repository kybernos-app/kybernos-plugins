// What a task said, read from the events of its DSH session: pure, events in, `{ text, tools, failure }` out.
//
// The answer is the LAST RUN of messages that have words, the ones that follow each other with no tool call between them: a sub-agent that ends after the answer was written sends a notice, and the
// model's one line about it is a second message with words in the same run (measured on the cloud door, 2026-11-20: taking only that line returned an answer that pointed at nothing). A message
// with words, then a tool call, then another message with words, is only the last of them. When there are no words, `failure` is a short code, never a message (a message may carry the person's words
// or a provider's): `model_429`, `model_server`, `model_timeout`, `model_transport`, `model_empty`, `model_error` when the model could not be reached, or the code of the last error event.
export const ANSWER_MAX = 20000

const MODEL_FAILURES = { rate_limit: 'model_429', server: 'model_server', timeout: 'model_timeout', transport: 'model_transport', empty_response: 'model_empty' }
const codeOf = (v) => (typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,60}$/.test(v) ? v.toLowerCase() : '')
const obj = (v) => (v !== null && v !== undefined && typeof v === 'object' ? v : {})

export function answerOf (events) {
  let text = ''
  let tools = 0
  let failure = ''
  let modelFailure = ''
  let run = []
  let brokenByTool = false
  for (const ev of Array.isArray(events) ? events : []) {
    if (ev === null || ev === undefined || typeof ev !== 'object') continue
    if (typeof ev.type === 'string' && ev.type.startsWith('tool/')) { tools += 1; brokenByTool = true }
    if (ev.type === 'llm/retry') {
      modelFailure = MODEL_FAILURES[codeOf(obj(obj(ev.data).failure).code)] || 'model_error'
      continue
    }
    if (typeof ev.type === 'string' && /error|fail|refus/i.test(ev.type)) {
      failure = [codeOf(ev.type.replace(/[\\/]/g, '_')), codeOf(obj(ev.data).code)].filter((x) => x !== '').join('.').slice(0, 80)
    }
    if (ev.type !== 'assistant/message') continue
    const message = obj(obj(ev.data).message)
    if (Array.isArray(message.content) !== true) continue
    modelFailure = ''
    const words = []
    for (const block of message.content) {
      if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') words.push(block.text)
    }
    if (words.join('').trim() !== '') {
      if (brokenByTool === true) { run = []; brokenByTool = false }
      run.push(words.join('\n'))
      text = run.join('\n\n')
    }
    if (message.content.some((block) => block !== null && typeof block === 'object' && typeof block.type === 'string' && /^tool/i.test(block.type))) brokenByTool = true
  }
  if (text === '' && modelFailure !== '') return { text, tools, failure: modelFailure }
  return { text: text.slice(0, ANSWER_MAX), tools, failure: text === '' ? failure : '' }
}
