// PoC — pont Free LLMs : le vrai fil openai-completions de pi-ai vers la
// couche gratuite d'OpenCode Zen (sans compte), avec la réécriture minimale
// qui satisfait le contrat des 4 barrières mesuré le 12/10/2026.
const { stream: streamFil } = await import('/Users/miled/.dsh/kybernos/moteur/0.2.1-alpha.2/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js')
import { createServer } from 'node:http'

// ── le contrat gratuit, mesuré barrière par barrière ───────────────────────
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const idCanonique = (prefixe) => {
  const b = Buffer.from(Array.from({ length: 32 }, () => Math.floor(Math.random() * 256)))
  return prefixe + b.subarray(0, 6).toString('hex') + Array.from(b.subarray(6, 20), (x) => B62[x % 62]).join('')
}
const QUARTET = [
  { name: 'bash', description: 'Run a bash command.' },
  { name: 'glob', description: 'Find files by glob pattern.' },
  { name: 'grep', description: 'Search file contents.' },
  { name: 'read', description: 'Read a file.' },
]
// fetch injecté : c'est LE point de branchement — le corps est déjà sérialisé
// par le vrai fil pi-ai, on ne touche qu'aux 4 barrières.
const fetchContrat = async (url, init = {}) => {
  const h = new Headers(init.headers || {})
  h.set('User-Agent', 'opencode/1.18.31')
  h.set('x-opencode-client', 'cli')
  h.set('x-opencode-project', 'default')
  h.set('x-opencode-session', idCanonique('ses_'))
  h.set('x-opencode-request', idCanonique('msg_'))
  h.set('Accept', 'text/event-stream')
  let body = init.body
  if (typeof body === 'string') {
    const p = JSON.parse(body)
    p.stream = true
    if (!Array.isArray(p.tools) || p.tools.length === 0) {
      p.tools = QUARTET.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: { type: 'object', properties: {} } } }))
      if (p.tool_choice === undefined) p.tool_choice = 'none'
    }
    body = JSON.stringify(p)
  }
  return fetch(url, { ...init, headers: h, body })
}

// ── le modèle exactement comme `llm-pi-ai` le construit (modeles-locaux) ───
const modele = {
  id: 'mimo-v2.6-flash-free',
  name: 'mimo-v2.6-flash-free',
  api: 'openai-completions',
  provider: 'opencode-free',
  baseUrl: 'https://opencode.ai/zen/v1',
  contextWindow: 262144,
  maxTokens: 65536,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  compat: { supportsStrictMode: false, supportsStore: false, supportsUsageInStreaming: true },
}

// ── catalogue gratuit live (le /models de la passerelle) ───────────────────
const catalogue = async () => {
  try {
    const r = await fetch('https://opencode.ai/zen/v1/models', { headers: { 'User-Agent': 'opencode/1.18.31' } })
    const d = await r.json()
    return (d.data || []).map((m) => m.id).filter((id) => id.endsWith('-free') || id === 'big-pickle')
  } catch (e) { return [] }
}

// ── 1. transcription réelle DSH → fil pi-ai (buildParams n'est pas exporté,
//       on rejoue donc la conversation à travers le vrai stream() de pi-ai) ─
const consommer = async (flux) => {
  let texte = ''; let pense = ''; let erreur = null
  for await (const ev of flux) {
    if (ev.type === 'text_delta') texte += ev.delta
    else if (ev.type === 'thinking_delta') pense += ev.delta
    else if (ev.type === 'error') { erreur = ev.error; break }
    else if (ev.type === 'done') break
  }
  return { texte, pense, erreur }
}

// ── 2. mini serveur OpenAI-compatible (ce que DSH appellera) ───────────────
const srv = createServer(async (req, res) => {
  if (req.url === '/v1/models') {
    const ids = await catalogue()
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ object: 'list', data: ids.map((id) => ({ id, object: 'model', owned_by: 'opencode-free' })) }))
    return
  }
  if (req.url !== '/v1/chat/completions') { res.writeHead(404); res.end('{}'); return }
  let raw = ''
  for await (const c of req) raw += c
  const corps = JSON.parse(raw || '{}')
  const modeleId = corps.model || modele.id
  const cible = { ...modele, id: modeleId, name: modeleId, cost: modele.cost }
  try {
    // rejoue avec l'id demandé — même fil pi-ai que DSH
    const messages = (corps.messages || []).map((m, i) => ({ id: 'msg' + i, role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user', content: [{ type: 'text', text: String(m.content ?? '') }] }))
    const flux = streamFil(cible, { system: '', messages }, { maxTokens: corps.max_tokens, fetch: fetchContrat, apiKey: 'public' })
    if (corps.stream === true) {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' })
      for await (const ev of flux) {
        if (ev.type === 'text_delta') res.write('data: ' + JSON.stringify({ id: 'poc', object: 'chat.completion.chunk', model: modeleId, choices: [{ index: 0, delta: { content: ev.delta } }] }) + '\n\n')
        else if (ev.type === 'thinking_delta') res.write('data: ' + JSON.stringify({ id: 'poc', object: 'chat.completion.chunk', model: modeleId, choices: [{ index: 0, delta: { reasoning: ev.delta } }] }) + '\n\n')
        else if (ev.type === 'error') { res.write('data: ' + JSON.stringify({ error: JSON.stringify(ev.error) }) + '\n\n'); break }
        else if (ev.type === 'done') break
      }
      res.write('data: [DONE]\n\n'); res.end()
      return
    }
    const { texte, pense, erreur } = await consommer(flux)
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(erreur !== null
      ? { error: JSON.stringify(erreur) }
      : { id: 'poc', object: 'chat.completion', model: modeleId, choices: [{ index: 0, message: { role: 'assistant', content: texte }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, _poc: { thinking: pense } }))
  } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: String(e && e.message ? e.message : e) })) }
})
srv.listen(8848, '127.0.0.1', () => console.log('poc prêt sur http://127.0.0.1:8848/v1/chat/completions'))
