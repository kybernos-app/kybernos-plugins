// Kaby's mandate: the one standing permission (kyby-identity.mjs, rule 3). The person signs it once in Settings; from then on the tools it lists run in Kaby's own chat
// without a question, inside daily limits, and everything else still asks. Pure and dependency-light: kyby-mandate-store.mjs reads and writes the file, index.js calls decide().
//
// What it covers is only what the native gate asks about today (index.js, NATIVE_ASK_TOOLS), in two classes:
//   memory    memory_write, lesson_write: reversible, on this computer.
//   computer  computer_exec, computer_write, computer_start, computer_stop, computer_pause, computer_resume, computer_task: work on the person's cloud computer, which costs run hours.
// A connected app (connections_execute) and restarting DSH (relancer_dsh) are never in a mandate: they send, publish, pay or change the machine, so they always ask.
// There is no spend limit: nothing on this host measures the cost of one call, so a limit in money would be a promise that cannot be kept. The limits count actions per day.
//
// The record is signed with the machine secret that signs DSH's browser cookie, so a file edited by anything but the Settings route is void, never trusted. That is friction
// against an injected instruction that makes the agent write the file, not a wall: an agent that can read the secret can forge it (the chat is meant to run in a
// workspace-write sandbox, which keeps it out of the file and the secret).
import { createHmac, timingSafeEqual } from 'node:crypto'

export const MANDATE_VERSION = 1
export const MANDATE_HEAD = '[MANDATE]'
export const MANDATE_TAIL = '[/MANDATE]'

/** The tool of ours → the class it belongs to. A tool that is not here is never covered. */
export const TOOL_CLASS = Object.freeze({
  memory_write: 'memory',
  lesson_write: 'memory',
  computer_exec: 'computer',
  computer_write: 'computer',
  computer_start: 'computer',
  computer_stop: 'computer',
  computer_pause: 'computer',
  computer_resume: 'computer',
  computer_task: 'computer'
})

export const LIMIT_MAX = Object.freeze({ memoryPerDay: 500, computerPerDay: 500 })

/** The starting points of the Settings page. `custom` is what a person's own numbers are called. */
export const PRESETS = Object.freeze({
  off: Object.freeze({ memory: false, computer: false, memoryPerDay: 40, computerPerDay: 40 }),
  prudent: Object.freeze({ memory: true, computer: false, memoryPerDay: 40, computerPerDay: 40 }),
  standard: Object.freeze({ memory: true, computer: true, memoryPerDay: 40, computerPerDay: 40 }),
  intensive: Object.freeze({ memory: true, computer: true, memoryPerDay: 100, computerPerDay: 150 })
})

const KEYS = ['v', 'signedAt', 'memory', 'computer', 'memoryPerDay', 'computerPerDay', 'paused']
const isLimit = (n, max) => Number.isInteger(n) && n >= 1 && n <= max

/** The canonical text that is signed: fixed key order, nothing else. */
const canonical = (body) => JSON.stringify(KEYS.map((k) => [k, body[k]]))
const mac = (secret, body) => createHmac('sha256', secret).update('kyby-mandate:' + canonical(body)).digest('hex')

/** The local calendar day the daily limits count in. */
export const dayKey = (nowMs) => {
  const d = new Date(nowMs)
  return String(d.getFullYear()) + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

/** The preset a set of fields equals, or `custom`. */
export const presetOf = (fields) => {
  for (const [name, p] of Object.entries(PRESETS)) {
    if (p.memory === fields.memory && p.computer === fields.computer && p.memoryPerDay === fields.memoryPerDay && p.computerPerDay === fields.computerPerDay) return name
  }
  return 'custom'
}

/**
 * What the person asked for, checked: `{ preset }` and/or any of memory, computer, memoryPerDay, computerPerDay, paused over `base` (the current record, or the `off` preset).
 * @returns { ok: true, fields } or { ok: false, error }
 */
export const readRequest = (raw, base) => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'invalid_request' }
  const from = base !== null && typeof base === 'object' ? base : PRESETS.off
  let fields = { memory: from.memory === true, computer: from.computer === true, memoryPerDay: from.memoryPerDay, computerPerDay: from.computerPerDay, paused: from.paused === true }
  if (!isLimit(fields.memoryPerDay, LIMIT_MAX.memoryPerDay)) fields.memoryPerDay = PRESETS.off.memoryPerDay
  if (!isLimit(fields.computerPerDay, LIMIT_MAX.computerPerDay)) fields.computerPerDay = PRESETS.off.computerPerDay
  if (raw.preset !== undefined) {
    const p = typeof raw.preset === 'string' && Object.prototype.hasOwnProperty.call(PRESETS, raw.preset) ? PRESETS[raw.preset] : null
    if (p === null) return { ok: false, error: 'unknown_preset' }
    fields = { ...fields, memory: p.memory, computer: p.computer, memoryPerDay: p.memoryPerDay, computerPerDay: p.computerPerDay }
  }
  for (const k of ['memory', 'computer', 'paused']) {
    if (raw[k] === undefined) continue
    if (typeof raw[k] !== 'boolean') return { ok: false, error: 'invalid_' + k }
    fields[k] = raw[k]
  }
  for (const k of ['memoryPerDay', 'computerPerDay']) {
    if (raw[k] === undefined) continue
    if (!isLimit(raw[k], LIMIT_MAX[k])) return { ok: false, error: 'invalid_' + k }
    fields[k] = raw[k]
  }
  return { ok: true, fields }
}

/** The record to write: the fields, the day it was signed, and the signature. `secret` is the machine secret; with none, nothing can be signed. */
export const sign = (fields, secret, nowMs) => {
  if (!Buffer.isBuffer(secret) || secret.length === 0) return { ok: false, error: 'cannot_sign' }
  const body = { v: MANDATE_VERSION, signedAt: new Date(nowMs).toISOString(), memory: fields.memory === true, computer: fields.computer === true, memoryPerDay: fields.memoryPerDay, computerPerDay: fields.computerPerDay, paused: fields.paused === true }
  return { ok: true, record: { ...body, sig: mac(secret, body) } }
}

/** `{ ok: true }` when the record is ours, whole and signed with this secret; otherwise why not. Never throws. */
export const verify = (record, secret) => {
  try {
    if (record === null || typeof record !== 'object') return { ok: false, why: 'none' }
    if (record.v !== MANDATE_VERSION || typeof record.sig !== 'string' || typeof record.signedAt !== 'string') return { ok: false, why: 'unreadable' }
    if (typeof record.memory !== 'boolean' || typeof record.computer !== 'boolean' || typeof record.paused !== 'boolean') return { ok: false, why: 'unreadable' }
    if (!isLimit(record.memoryPerDay, LIMIT_MAX.memoryPerDay) || !isLimit(record.computerPerDay, LIMIT_MAX.computerPerDay)) return { ok: false, why: 'unreadable' }
    if (!Buffer.isBuffer(secret) || secret.length === 0) return { ok: false, why: 'no_secret' }
    const want = Buffer.from(mac(secret, record), 'hex')
    const got = Buffer.from(record.sig, 'hex')
    if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, why: 'altered' }
    return { ok: true }
  } catch (e) { return { ok: false, why: 'unreadable' } }
}

/** Is a mandate in force: signed, not paused, and at least one class on. */
export const inForce = (record, secret) => {
  const v = verify(record, secret)
  if (v.ok !== true) return { ok: false, why: v.why }
  if (record.paused === true) return { ok: false, why: 'paused' }
  if (record.memory !== true && record.computer !== true) return { ok: false, why: 'nothing_on' }
  return { ok: true }
}

/** The day's use, counted by the host, not by Kaby: `{ day, memory, computer }`. */
export const emptyUsage = (nowMs) => ({ day: dayKey(nowMs), memory: 0, computer: 0 })
export const usageOf = (usage, nowMs) => {
  const day = dayKey(nowMs)
  if (usage === null || typeof usage !== 'object' || usage.day !== day) return emptyUsage(nowMs)
  return { day, memory: Number.isInteger(usage.memory) && usage.memory > 0 ? usage.memory : 0, computer: Number.isInteger(usage.computer) && usage.computer > 0 ? usage.computer : 0 }
}
export const countUse = (usage, klass, nowMs) => {
  const u = usageOf(usage, nowMs)
  return klass === 'memory' || klass === 'computer' ? { ...u, [klass]: u[klass] + 1 } : u
}

/**
 * May this tool run without a question? `allow` is true only for a tool of a class that is on, with the mandate in force and the day's limit not reached.
 * Anything else is `{ allow: false, why }` and goes the way it went before the mandate existed (the question).
 */
export const decide = (record, secret, usage, toolName, nowMs) => {
  const klass = Object.prototype.hasOwnProperty.call(TOOL_CLASS, toolName) ? TOOL_CLASS[toolName] : null
  if (klass === null) return { allow: false, klass: null, why: 'not_covered' }
  const force = inForce(record, secret)
  if (force.ok !== true) return { allow: false, klass, why: force.why }
  if (record[klass] !== true) return { allow: false, klass, why: 'class_off' }
  const cap = klass === 'memory' ? record.memoryPerDay : record.computerPerDay
  if (usageOf(usage, nowMs)[klass] >= cap) return { allow: false, klass, why: 'limit_reached' }
  return { allow: true, klass, why: 'covered' }
}

/**
 * The block the host writes into Kaby's prompt, or '' when there is no mandate in force. It carries the numbers of the record and nothing the person or the agent typed, and no
 * count of today's use (the text stays the same from one step to the next, so the prompt stays cacheable; the host counts).
 */
export const mandateText = (record, secret) => {
  if (inForce(record, secret).ok !== true) return ''
  const may = []
  if (record.memory === true) may.push('write your memory and your lessons (up to ' + String(record.memoryPerDay) + ' a day)')
  if (record.computer === true) may.push('use your cloud computer (up to ' + String(record.computerPerDay) + ' actions a day)')
  return [
    MANDATE_HEAD,
    'The person signed this standing permission on ' + record.signedAt.slice(0, 10) + '. Without asking, you may: ' + may.join('; ') + '. Everything else, and anything over a limit, goes to the person for an answer first: a tool call that is refused was not covered, so say so and never retry or work around it.',
    MANDATE_TAIL
  ].join('\n')
}

/** What the Settings page shows: the record as read, whether it is in force and why not, today's use. Never the signature. */
export const describe = (record, secret, usage, nowMs) => {
  const force = inForce(record, secret)
  const readable = verify(record, secret)
  const fields = readable.ok === true
    ? { memory: record.memory, computer: record.computer, memoryPerDay: record.memoryPerDay, computerPerDay: record.computerPerDay, paused: record.paused }
    : { ...PRESETS.off, paused: false }
  const used = usageOf(usage, nowMs)
  return {
    inForce: force.ok === true,
    why: force.ok === true ? 'in_force' : force.why,
    canSign: Buffer.isBuffer(secret) && secret.length > 0,
    signedAt: readable.ok === true ? record.signedAt : null,
    preset: presetOf(fields),
    ...fields,
    usedToday: { memory: used.memory, computer: used.computer },
    limits: LIMIT_MAX
  }
}
