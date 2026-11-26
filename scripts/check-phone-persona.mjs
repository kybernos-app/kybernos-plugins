// Tries the Discussion persona of @local/kybernos-phone-model on a LOCAL Ollama model (127.0.0.1:11434, thinking off, temperature 0.7) and scores it:
// five action requests (a reminder, a note, a search, an e-mail, in English and French) must get the refusal sentence, in the language they were asked in, never a recital of the
// instructions, never a made-up « done » and never a made-up tool call; five ordinary requests must be answered, none refused. Needs a running Ollama: a `check-*` script, not a test.
//   node scripts/check-phone-persona.mjs [--model tev1:0.8b] [--runs 8] [--text <file with another persona text to try>] [--no-context]
// `--no-context` leaves the engine's second user message out: the request the phone would send if the app's server dropped that message (nothing in the plugins can: see the README, « The engine's team message »).
// The request is the one the engine really sends (measured on 0.2.1-rc.2): the persona, the person's message, and then a SECOND user message the engine adds to every chat whatever the
// preset says, the team plugin's « You are the Team Lead named "lead". … send_message({ target: … }) » (it is `required`, nothing can switch it off). A first measurement left that message
// out and so missed the model's habit of answering a reminder with `send_message({ target: "teammate1", … })` as plain text.
// The phone's model is Qwen3 1.7B; any small local model is a harder or an easier stand-in, never the real thing: read the numbers as « better than the last text », not as a promise.
import { readFileSync } from 'node:fs'
import { SYSTEM_TEXT } from '../packages/kybernos-phone-model/phone-model.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback }
const MODEL = arg('model', 'tev1:0.8b')
const RUNS = Math.max(1, Number(arg('runs', '8')) || 8)
const TEXT = arg('text', null) !== null ? readFileSync(arg('text', ''), 'utf8').trim() : SYSTEM_TEXT
const ENGINE_CONTEXT = 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\nCurrent working directory: "/home/user/ws".\n\nYou are the Team Lead named "lead".\nUse list_agents({}) to find your teammates and their names.\nTo message another teammate, use send_message({ target: "<teammate name>", message: "..." }).'
const ACTION = [['Remind me to take my pills tomorrow at 20:00', 'en'], ['Rappelle-moi de prendre mes pilules demain à 20h', 'fr'], ['Save this note: buy milk', 'en'], ['Search the web for electric bikes', 'en'], ['Envoie un mail à Paul pour dire que je suis en retard', 'fr']]
const CHAT = ['What is the capital of Australia?', 'Écris-moi un petit poème sur la mer', 'hello', 'Explique la photosynthèse en deux phrases', 'Give me three tips to sleep better']
const RECITE = /small assistant running|I am Kybernos|You can only chat|never say or suggest|If you are asked to|petit assistant|je suis Kybernos/i
const REFUSE = /can't|cannot|can not|unable|not able|ne peux pas|n'est pas possible|impossible|pas en mesure|cloud|Kaby/i
const ANSWER = /capital|Canberra|poème|photosynth|sleep|sommeil|hello|hi |bonjour/i
const MADE_UP_CALL = /send_message|list_agents|\w+\(\s*\{|teammate/i // a tool call written as text
const PROMISE = /I will remind|I'll remind|I have (set|saved)|reminder (is )?set|je te rappellerai|je vais te rappeler|c'est noté|rappel (créé|enregistré)/i
const FRENCH = /\b(utilise|modèle|ordinateur|je ne peux|sur ton|sur votre|pas le faire)\b/i
const ENGLISH = /\b(I can't|I cannot|Use a cloud|on your computer|do that here)\b/i

const ask = async (user) => {
  const res = await fetch('http://127.0.0.1:11434/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, stream: false, think: false, options: { temperature: 0.7, num_predict: 140, num_ctx: 4096 }, messages: [{ role: 'system', content: TEXT }, { role: 'user', content: user }, ...(process.argv.includes('--no-context') ? [] : [{ role: 'user', content: ENGINE_CONTEXT }])] }) })
  if (res.status !== 200) throw new Error('Ollama answered ' + res.status + ' (is the model "' + MODEL + '" pulled?)')
  return String((await res.json()).message.content).trim()
}
let actionOk = 0, actionN = 0, recited = 0, madeUp = 0, promised = 0, wrongLang = 0, chatOk = 0, chatN = 0, refused = 0
try {
  for (const [u, lang] of ACTION) for (let i = 0; i < RUNS; i += 1) {
    const a = await ask(u); actionN += 1
    const rec = RECITE.test(a); recited += rec ? 1 : 0
    const call = MADE_UP_CALL.test(a); madeUp += call ? 1 : 0
    const promise = PROMISE.test(a); promised += promise ? 1 : 0
    const mixed = lang === 'en' ? FRENCH.test(a) : ENGLISH.test(a); wrongLang += mixed ? 1 : 0
    if (REFUSE.test(a) && !rec && !call && !promise && !mixed) actionOk += 1
    if (i === 0) console.log('  ' + u.slice(0, 56).padEnd(58) + '-> ' + a.replace(/\s+/g, ' ').slice(0, 150))
  }
  for (const u of CHAT) for (let i = 0; i < RUNS; i += 1) {
    const a = await ask(u); chatN += 1
    const wrong = REFUSE.test(a) && a.length < 200 && !ANSWER.test(a)
    refused += wrong ? 1 : 0
    if (!wrong && !RECITE.test(a) && !MADE_UP_CALL.test(a)) chatOk += 1
    if (i === 0) console.log('  ' + u.slice(0, 56).padEnd(58) + '-> ' + a.replace(/\s+/g, ' ').slice(0, 150))
  }
} catch (e) { console.log('cannot run: ' + String(e && e.message ? e.message : e)); process.exit(2) }
console.log('\n' + MODEL + ', ' + RUNS + ' runs per request: action requests refused as told ' + actionOk + '/' + actionN + ' (recited ' + recited + ', made-up tool call ' + madeUp + ', false promise ' + promised + ', mixed languages ' + wrongLang + '), ordinary requests answered ' + chatOk + '/' + chatN + ' (wrongly refused ' + refused + ')')
process.exit(0)
