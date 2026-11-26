// ── Handing a task to a cloud computer, from a chat on this machine ──────────────────────────────────────────────
//
// The composer's « Cloud Computer » choice works like « E2B » (kybernos-computers): it moves no message, it steers the agent. The choice is kept by the host, a prompt section
// tells the agent where the person wants this work done, and ONE tool, `cloud_computer_task`, hands a mission to that computer: its own DSH runs it with its own tools, through the
// server's hosted-turn route (`POST /v1/kybers/{id}/threads/dispatch` with a `computer_id`, kybernos-server ADR 0052 / 0053), and the answer is read back from the thread.
// The engine gives a plugin no way to take over what is typed in the composer (docs/dev/cloud-computer-run-on.md), so nothing here pretends to.
//
// The server decides everything that is a decision: whether the person may run a turn on that computer, wake it, and pay for it (the plan, the budget, the member's extra budget).
// This file only carries the request, bounds the wait and puts each refusal in words the model can pass on. Pure: the network, the clock and the token are handed in.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KYBER_ID = /^[A-Za-z0-9_-]{4,64}$/

export const MISSION_MAX = 20000
export const ANSWER_MAX = 20000
export const POLL_MS = 3000
export const MAX_WAIT_MS = 120000
const IDENTITY_TTL_MS = 5 * 60 * 1000

/** What a refusal of the server means for the person, in words the model passes on. The code is the server's; an unknown one is said as it came. */
const REFUSALS = {
  extra_cap_exhausted: 'The member\'s extra budget of this workspace is used up for this month: an owner or an admin can allow more.',
  insufficient_quota: 'The budget of this workspace is used up and its credit is empty: top up, or wait for the next period.',
  budget_not_configured: 'This workspace has no plan that pays for hosted turns.',
  payment_past_due: 'The last payment of this workspace failed: hosted turns are paused until it is settled.',
  feature_not_in_plan: 'The plan of this workspace does not include running a task on a cloud computer.',
  model_not_in_plan: 'The plan of this workspace does not include the model this computer would answer with.',
  model_required: 'The server has no model to run this task with: none of the account\'s models could be picked.',
  computer_unavailable: 'That cloud computer cannot take a task right now (it is not yours, or it is being set up or paused).',
  turn_pending: 'The person\'s Kaby conversation already has a task waiting for its answer (sent from here or from a messenger): try again when it has been answered.',
  no_runner: 'No cloud computer is ready to run this.',
  personal_workspace: 'Hosted turns are not offered in a personal workspace.',
  rate_limited: 'Too many tasks were sent in a minute: wait a moment.',
  hosted_busy: 'Too many tasks are already waiting on the cloud: wait for one to finish.',
  queue_full: 'The queue of this workspace is full: wait for some tasks to finish.',
}

/** `{ ok:false, error, hint }` from an answer of the server that is not a success. */
const refusal = (res) => {
  const code = res !== null && res !== undefined && res.body !== null && typeof res.body === 'object' && typeof res.body.error === 'string' && /^[a-z_]{3,60}$/.test(res.body.error) ? res.body.error : 'http_' + String(res === null || res === undefined ? 0 : res.status)
  return { ok: false, error: code, hint: REFUSALS[code] !== undefined ? REFUSALS[code] : 'The server refused this task (' + code + ').' }
}

/**
 * deps: `apiCall(path, { method, token, body, timeoutMs })` → `{ status, body }` (never throws), `token()` → string | null, `target()` → the computer id the person chose (or null),
 * `sleep(ms)`, `now()` → ms, `turnId()` → a fresh id matching `[A-Za-z0-9_-]{8,64}`, `model()` → the model route the task runs with (the server asks for one when Kaby's crew names none), or null.
 */
export function createComputerTurn(deps) {
  let identity = { at: 0, token: '', value: null }

  /** `{ kyber, thread }` of the person's Kaby on the server, the conversation a hosted turn is kept in; null when there is none (signed out, an older server). */
  const thread = async (token) => {
    if (identity.value !== null && identity.token === token && deps.now() - identity.at < IDENTITY_TTL_MS) return identity.value
    const res = await deps.apiCall('/v1/me/kyby', { method: 'GET', token, timeoutMs: 15000 })
    const b = res !== null && res !== undefined && res.status === 200 && res.body !== null && typeof res.body === 'object' ? res.body : null
    if (b === null || typeof b.kyber_id !== 'string' || !KYBER_ID.test(b.kyber_id) || typeof b.thread_id !== 'string' || !UUID.test(b.thread_id)) return null
    identity = { at: deps.now(), token, value: { kyber: b.kyber_id, thread: b.thread_id } }
    return identity.value
  }

  /** Reads what the thread holds after the person's message: the first answer, or null while there is none. */
  const answerAfter = async (token, th, position) => {
    const res = await deps.apiCall('/v1/threads/' + encodeURIComponent(th.thread) + '/messages?after=' + String(position) + '&limit=5', { method: 'GET', token, timeoutMs: 15000 })
    if (res === null || res === undefined || res.status !== 200 || res.body === null || typeof res.body !== 'object' || !Array.isArray(res.body.messages)) return null
    const m = res.body.messages.find((x) => x !== null && typeof x === 'object' && x.role === 'assistant' && typeof x.content === 'string')
    return m === undefined ? null : m.content
  }

  return {
    /** Hands `mission` to the chosen cloud computer and waits, bounded, for its answer. Never throws; every outcome is a plain object the model can read. */
    async run(input) {
      try {
        const token = deps.token()
        if (token === null) return { ok: false, error: 'compte_kybernos_non_connecte', hint: 'The Kybernos account is not connected on this machine.' }
        const mission = input !== null && input !== undefined && typeof input.mission === 'string' ? input.mission.trim() : ''
        if (mission === '') return { ok: false, error: 'mission_vide', hint: 'The mission is empty.' }
        if (mission.length > MISSION_MAX) return { ok: false, error: 'mission_trop_longue', hint: 'The mission is too long: send the essentials, under ' + String(MISSION_MAX) + ' characters.' }
        const computer = deps.target()
        if (typeof computer !== 'string' || !UUID.test(computer)) return { ok: false, error: 'aucun_ordinateur_choisi', hint: 'No cloud computer is chosen: the person picks one in the composer\'s menu.' }
        const picked = typeof deps.model === 'function' ? deps.model() : null
        const model = typeof picked === 'string' && /^[A-Za-z0-9._:/-]{1,100}$/.test(picked) ? picked : null
        const th = await thread(token)
        if (th === null) return { ok: false, error: 'assistant_indisponible', hint: 'This server has no assistant conversation to run the task in (an older server, or none made yet).' }
        const sent = await deps.apiCall('/v1/kybers/' + encodeURIComponent(th.kyber) + '/threads/dispatch', {
          method: 'POST', token, timeoutMs: 30000,
          body: { thread_id: th.thread, message: mission, client_turn_id: deps.turnId(), computer_id: computer, ...(model !== null ? { model } : {}) },
        })
        if (sent === null || sent === undefined || (sent.status !== 202 && sent.status !== 200)) {
          if (sent !== null && sent !== undefined && sent.status === 404) identity = { at: 0, token: '', value: null }
          return refusal(sent)
        }
        const position = sent.body !== null && typeof sent.body === 'object' && sent.body.message !== null && typeof sent.body.message === 'object' && Number.isInteger(sent.body.message.position) ? sent.body.message.position : null
        if (position === null) return { ok: false, error: 'reponse_inattendue', hint: 'The server accepted the task but did not say where its answer will be.' }
        const deadline = deps.now() + MAX_WAIT_MS
        for (;;) {
          await deps.sleep(POLL_MS)
          const answer = await answerAfter(token, th, position)
          if (answer !== null) return { ok: true, answer: answer.slice(0, ANSWER_MAX) }
          if (deps.now() >= deadline) break
        }
        return { ok: false, error: 'toujours_en_cours', pending: true, hint: 'The cloud computer is still working on it: its answer will arrive in the person\'s Kaby conversation when it is done. Say so, and do not send the task again.' }
      } catch (e) {
        return { ok: false, error: 'erreur_interne', hint: 'The task could not be sent.' }
      }
    },
  }
}

/** The cloud computer the person chose, as the file keeps it: `{ computer_id, name }` or null. Anything else on disk reads as no choice. */
export const targetOf = (raw) => {
  if (raw === null || raw === undefined || typeof raw !== 'object' || typeof raw.computer_id !== 'string' || !UUID.test(raw.computer_id)) return null
  const name = typeof raw.name === 'string' ? Array.from(raw.name).map((c) => { const n = c.charCodeAt(0); return n < 32 || n === 0x2028 || n === 0x2029 ? ' ' : c }).join('').replace(/ +/g, ' ').trim().slice(0, 60) : ''
  return { computer_id: raw.computer_id.toLowerCase(), name }
}

/** The prompt section: where the person wants their work done. Empty while no cloud computer is chosen, so a chat that never chose one is unchanged. */
export const renderTargetPrompt = (target) => {
  if (target === null || target === undefined) return ''
  const label = target.name !== '' ? '“' + target.name + '”' : 'their cloud computer'
  return [
    '## Where this work runs: the cloud computer ' + label,
    'The user chose their Kybernos cloud computer in the composer. Hand the work to it with the cloud_computer_task tool',
    '(one complete, self-contained mission: the goal, the context it needs, what to return) instead of doing it on this machine,',
    'unless the user says otherwise or the work only touches files on this machine. Report its answer faithfully.',
    'If the tool says the computer is still working, tell the user the answer will arrive in their Kaby conversation and do not send the task again.',
    'If it says a budget is used up, say so and stop: do not retry or work around it.',
  ].join('\n')
}

/** The tool the model sees. `computer_id` is deliberately not a parameter: the person chose the computer, a model must not pick another (the rule of `kyber_id` for the memory tools). */
export const cloudComputerTaskTool = (turn, textResult) => ({
  name: 'cloud_computer_task',
  description: 'Hands a MISSION to the user\'s Kybernos cloud computer (the one they chose in the composer): its own DSH agent runs it with its own tools and answers. It may wake a sleeping computer and spends the workspace\'s budget like any cloud run. Waits up to about two minutes for the answer; the mission must be complete and self-contained, the computer does not see this chat.',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: { mission: { type: 'string', description: 'The complete mission: the goal, the context the computer needs, and what it must return.' } },
    required: ['mission'],
  },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, answer: { type: 'string' }, pending: { type: 'boolean' }, error: { type: 'string' }, hint: { type: 'string' } }, required: ['ok'] },
    render: (args, value) => textResult(value.ok === true ? String(value.answer) : 'The cloud computer did not answer: ' + String(value.hint !== undefined ? value.hint : value.error)),
  },
  async execute(args) { return await turn.run({ mission: args !== null && args !== undefined ? args.mission : '' }) },
})
