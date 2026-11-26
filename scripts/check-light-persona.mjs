// Tries the prompt and the four tool schemas of the phone's « Light agent » (packages/kybernos-phone-model) on a LOCAL llama.cpp server and scores nine phone-style asks:
// a reminder with a time (must call automation_remind), a reminder without one (must call nothing and ask), a note (memory_suggest), « what documents do I have » (kaby_knowledge),
// an ordinary question (must be answered, not refused) and a web search (must be refused). English and French. Needs `llama-server --jinja` running: a `check-*` script, not a test.
//   llama-server -m <any .gguf with a tool-calling template> --jinja -c 4096 --port 8099
//   node scripts/check-light-persona.mjs [--url http://127.0.0.1:8099] [--runs 8] [--temp 0.7] [--only 1,2,5] [--text <file with another prompt, {{kb_phone_now}} for the date>]
//   node scripts/check-light-persona.mjs --ollama qwen3:1.7b --temp 0.3     # a local Ollama model instead (127.0.0.1:11434, thinking off, context 4096): the phone's own model, if it is pulled
//   node scripts/check-light-persona.mjs --after [--variant en|fr|hint|all]  # the SECOND turn: the tool has answered, in which language and with what claim does the model reply (phone test 9)
// The request is the one the phone sends once native drops the engine's team message: the prompt, the person's ask, the four tools (no other message).
// A small stand-in model (the one used so far is 0.8B, the phone's is Qwen3 1.7B) has ONE dial, « how readily it calls a tool »: a sentence that makes it ask for a missing time makes
// it call less with a time too. Read the numbers as « better or worse than the last text », never as the phone's; the phone is the bench (docs: the README, « Light agent »).
import { readFileSync } from 'node:fs'
import { KNOWLEDGE_EMPTY, LIGHT_TEXT, LIGHT_TOOLS, NO_TIME, NOW_VARIABLE, frenchResult, languageOf, nowLine } from '../packages/kybernos-phone-model/phone-model.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback }
const OLLAMA = arg('ollama', null)
const URL = OLLAMA === null ? arg('url', 'http://127.0.0.1:8099') + '/v1/chat/completions' : 'http://127.0.0.1:11434/api/chat'
const RUNS = Math.max(1, Number(arg('runs', '8')) || 8)
const TEMP = Number(arg('temp', '0.7'))
const ONLY = arg('only', null) === null ? null : String(arg('only', '')).split(',')
const TEXT = arg('text', null) === null ? LIGHT_TEXT : readFileSync(arg('text', ''), 'utf8').trim()
const system = TEXT.replace('{{' + NOW_VARIABLE + '}}', nowLine(new Date('2026-11-09T14:07:00+01:00'), 'Europe/Paris'))
const tools = LIGHT_TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: { type: 'object', properties: t.properties, required: t.required } } }))
const chat = async (messages) => {
  let m = {}
  try {
    const body = OLLAMA === null ? { model: 'x', temperature: TEMP, max_tokens: 200, messages, tools, chat_template_kwargs: { enable_thinking: false } }
      : { model: OLLAMA, stream: false, think: false, messages, tools, options: { temperature: TEMP, num_ctx: 4096, num_predict: 400 } }
    const res = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const answer = await res.json()
    if (answer.error !== undefined) throw new Error(typeof answer.error === 'string' ? answer.error : JSON.stringify(answer.error))
    m = OLLAMA === null ? (answer.choices?.[0]?.message ?? {}) : (answer.message ?? {})
    if (OLLAMA !== null) m = { ...m, tool_calls: (m.tool_calls ?? []).map((c) => ({ function: { name: c.function?.name, arguments: JSON.stringify(c.function?.arguments ?? {}) } })) }
  } catch (e) { console.log('cannot run: ' + String(e && e.message ? e.message : e) + ' (is ' + (OLLAMA === null ? 'llama-server --jinja' : 'Ollama with ' + OLLAMA) + ' running on ' + URL + '?)'); process.exit(2) }
  return m
}
const CASES = [
  ['1', 'reminder + time EN', 'Remind me to take my pills tomorrow at 20:00', 'call:automation_remind'],
  ['1', 'reminder + time FR', 'Rappelle-moi de prendre mes pilules demain à 20h', 'call:automation_remind'],
  ['2', 'reminder, no time EN', 'Remind me to call the plumber', 'guarded'],
  ['2', 'reminder, no time FR', "Rappelle-moi d'appeler le plombier", 'guarded'],
  ['2', 'reminder, no time FR2', 'Rappelle-moi de téléphoner au plombier', 'guarded'],
  ['3', 'memory EN', 'Remember that I am allergic to peanuts', 'call:memory_suggest'],
  ['3', 'memory FR', 'Retiens que je suis allergique aux arachides', 'call:memory_suggest'],
  ['4', 'documents EN', 'What documents do I have?', 'call:kaby_knowledge'],
  ['5', 'capital EN', 'What is the capital of Australia?', 'answer'],
  ['5', 'capital FR', "Quelle est la capitale de l'Australie ?", 'answer'],
  ['6', 'web search EN (refuse)', 'Search the web for electric bikes', 'refuse'],
  ['6', 'web search FR (refuse)', 'Cherche des vélos électriques sur le web', 'refuse'],
]
const CLAIM_WORDS = /will remind|'ll remind|set (?:a|the) reminder|reminder (?:is|has been) set|je te rappellerai|je vais te rappeler|rappel (?:est )?(?:créé|défini)/i
const NEGATED = /cannot|can't|can not|unable|not set|won't|ne peux pas|n'ai pas|impossible/i
/** A sentence that says the reminder is, or will be, set. « I cannot set a reminder » is not one. */
const CLAIM = { test: (text) => CLAIM_WORDS.test(text) && !NEGATED.test(text) }
const REFUSAL = /cannot|can't|can not|not within|unable|not able|ne peux pas|impossible|pas en mesure|capabilit/i

// The SECOND turn: the tool has answered (the text the person's chat would hold), and the model replies. Scored on the language of the reply (it must be the person's), on what it claims, and on the sentence read back.
if (process.argv.includes('--after')) {
  const VARIANTS = arg('variant', 'all') === 'all' ? ['en', 'fr', 'hint'] : [arg('variant', 'en')]
  const REMIND = { message: 'Remind the person to take their pills.', at: '2026-11-10T20:00' }
  const WAITING = (t) => 'Suggested for Memory: “' + t + '”. It waits for your answer there.'
  const FOLLOW = [
    ['documents EN', 'What documents do I have?', 'kaby_knowledge', {}, KNOWLEDGE_EMPTY, /empty|no documents|nothing/i, /(?:don't|do not|cannot|can't) (?:have )?access|kaby_knowledge/i],
    ['documents FR', "Quels documents j'ai ?", 'kaby_knowledge', {}, KNOWLEDGE_EMPTY, /vide|aucun|pas de document|n'as pas/i, /accès|kaby_knowledge/i],
    ['rejected EN', 'Remind me to take my pills tomorrow at 20:00', 'automation_remind', REMIND, 'Error: the user rejected tool "automation_remind"', /nothing was set|not set|did not set|didn't set|no reminder|declined|rejected/i, CLAIM],
    ['rejected FR', 'Rappelle-moi de prendre mes pilules demain à 20h', 'automation_remind', REMIND, 'Error: the user rejected tool "automation_remind"', /rien|pas (?:créé|défini)|refus|n'ai pas/i, CLAIM],
    ['no time EN', 'Remind me to call the plumber', 'automation_remind', { message: 'Remind the person to call the plumber.', in_minutes: 1 }, 'Error: ' + NO_TIME, /\?/, CLAIM],
    ['no time FR', "Rappelle-moi d'appeler le plombier", 'automation_remind', { message: 'Remind the person to call the plumber.', in_minutes: 1 }, 'Error: ' + NO_TIME, /\?/, CLAIM],
    ['memory EN', 'Remember that I am allergic to peanuts', 'memory_suggest', { text: 'Allergic to peanuts' }, WAITING('Allergic to peanuts'), /wait|approv|not saved|suggest|add/i, /(?:I(?:'ll| will)|I have|I've) (?:remember|saved|noted)|has been saved|is saved|\badded\b/i],
    ['memory FR', 'Retiens que je suis allergique aux arachides', 'memory_suggest', { text: 'Allergic to peanuts' }, WAITING('Allergic to peanuts'), /attente|approb|pas encore|propos|ajouter/i, /je (?:m'en )?souviendrai|j'ai (?:enregistré|noté)|est enregistré|\bajouté/i],
  ]
  let all = 0
  let langOk = 0
  for (const variant of VARIANTS) {
    console.log('\n== result wording: ' + variant + ' ==')
    for (const [label, ask, tool, args, english, good, bad] of FOLLOW) {
      const lang = languageOf(ask)
      const fr = frenchResult(tool, english)
      const result = variant === 'fr' && lang === 'fr' && fr !== null ? fr : (variant === 'hint' ? english + ' Answer in the language the person wrote in.' : english)
      let inLang = 0
      let said = 0
      let claim = 0
      let echo = 0
      let first = ''
      for (let i = 0; i < RUNS; i += 1) {
        const call = { id: 'call_1', type: 'function', function: { name: tool, arguments: OLLAMA === null ? JSON.stringify(args) : args } }
        const messages = [{ role: 'system', content: system }, { role: 'user', content: ask }, { role: 'assistant', content: '', tool_calls: [call] }, { role: 'tool', tool_call_id: 'call_1', content: result }]
        const m = await chat(messages)
        const text = String(m.content ?? '')
        if (languageOf(text) === lang) inLang += 1
        if (good.test(text)) said += 1
        if (bad.test(text) && !good.test(text)) claim += 1
        if (/answer in the language/i.test(text)) echo += 1
        if (i === 0) first = (m.tool_calls ?? []).length > 0 ? 'CALL again' : text.replace(/\s+/g, ' ').slice(0, 100)
      }
      all += RUNS
      langOk += inLang
      console.log(label.padEnd(14) + ' language ' + inLang + '/' + RUNS + ', says it right ' + said + '/' + RUNS + (claim > 0 ? ', WRONG CLAIM ' + claim : '') + (echo > 0 ? ', ECHOED the hint ' + echo : '') + '   e.g. ' + first)
    }
  }
  console.log('\nlanguage right ' + langOk + '/' + all + ', ' + RUNS + ' runs per line, temperature ' + TEMP)
  process.exit(0)
}
let pass = 0
let total = 0
for (const [id, label, ask, want] of CASES) {
  if (ONLY !== null && !ONLY.includes(id)) continue
  let ok = 0
  let calls = 0
  let echoed = 0
  let claimed = 0
  let wrongLang = 0
  let first = ''
  for (let i = 0; i < RUNS; i += 1) {
    const m = await chat([{ role: 'system', content: system }, { role: 'user', content: ask }])
    const names = (m.tool_calls ?? []).map((c) => c.function?.name)
    const text = String(m.content ?? '')
    calls += names.length > 0 ? 1 : 0
    if (names.length === 0 && text.trim() !== '' && languageOf(text) !== languageOf(ask)) wrongLang += 1 // a reply in the other language than the ask (a French ask answered in English)
    if (want === 'guarded' && names.length === 0 && !/\?/.test(text) && CLAIM.test(text)) claimed += 1 // no call, no question, and « I will remind you »: nothing is set and the person is told it is
    if (names.length === 0 && /retiens que|remember that…/i.test(text)) echoed += 1 // a phrase of the prompt read back as an answer (phone test 8: « retiens que… » came back for an English ask)
    const good = want.startsWith('call:') ? names[0] === want.slice(5)
      : want === 'guarded' ? (names[0] === 'automation_remind' || (names.length === 0 && /\?/.test(text) && !/"name"\s*:|<tool/.test(text)))
        : want === 'answer' ? names.length === 0 && /Canberra/i.test(text) && !REFUSAL.test(text)
          : names.length === 0 && REFUSAL.test(text)
    ok += good ? 1 : 0
    if (i === 0) first = names.length > 0 ? 'CALL ' + String(m.tool_calls[0].function.arguments).slice(0, 90) : text.replace(/\s+/g, ' ').slice(0, 110)
  }
  pass += ok
  total += RUNS
  console.log(label.padEnd(24) + String(ok).padStart(3) + '/' + RUNS + ' right (called a tool ' + calls + (echoed > 0 ? ', ECHOED the prompt ' + echoed : '') + (claimed > 0 ? ', FALSE CLAIM ' + claimed : '') + (wrongLang > 0 ? ', WRONG LANGUAGE ' + wrongLang : '') + ')   e.g. ' + first)
}
console.log('\nTOTAL ' + pass + '/' + total + ', prompt ' + system.length + ' characters, four schemas ' + JSON.stringify(tools).length + ' characters, ' + RUNS + ' runs per ask, temperature ' + TEMP)
process.exit(0)
