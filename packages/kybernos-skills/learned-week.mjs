// The weekly card on the home of a blank chat: what was learned and used this week, what Kaby did alone, what waits for the person, what nobody used for a month,
// and what is ready to propose to the team. Facts from the ledger and the journal, no model.
//
// It shows once a week: the first blank chat of the week that asks for it keeps it while it stays open; the person can hide it for the week. Nothing happened, no card.
// Shown only if the person's settings say so (`week` on, and the notice choice is not « in chat only »).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { LEARNED_LIMITS, at, isSensitive, journalEntries, readSettings, shareReady, skillsDir, unusedFor, withLedger } from './learned.mjs'
import { withState } from './learned-repeat.mjs'

const DAY = 24 * 3600 * 1000

/** `2026-W43`: the ISO week of a moment (UTC). */
export const weekKey = (ms) => {
  const d = new Date(Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth(), new Date(ms).getUTCDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return String(d.getUTCFullYear()) + '-W' + String(Math.ceil(((d - first) / DAY + 1) / 7)).padStart(2, '0')
}

/**
 * The card for the chat on screen: `{ ok, show, week, from, to, accepted, used, usedSkills, top, waiting, auto: { created, improved }, stale: [{ name, root, days }], ready: [{ name, chats }] }`.
 * `show` is false when the settings say no, when the person hid it this week, when another chat already has it, or when nothing happened.
 */
export const weekView = ({ dsh, sessionId, now = Date.now() }) => withLedger(dsh, (ledger) => withState(dsh, async (state) => {
  const sid = String(sessionId === undefined ? '' : sessionId).slice(0, 80)
  const settings = readSettings(dsh)
  const key = weekKey(now)
  const off = (why) => ({ ok: true, show: false, why, week: key })
  if (settings.week !== true || settings.notify === 'chat') return off('off')
  if (sid === '') return off('no_session')
  if (state.week.hidden === key) return off('hidden')
  if (state.week.key === key && state.week.session !== sid) return off('shown_elsewhere')
  const since = now - LEARNED_LIMITS.weekDays * DAY
  const sensitive = isSensitive(dsh)
  const entries = journalEntries(dsh).filter((e) => at(e) >= since)
  const accepted = new Set(entries.filter((e) => e.act === 'accepted' || e.act === 'created').map((e) => e.skill)).size
  const auto = { created: entries.filter((e) => e.by === 'kaby' && e.mode === 'auto' && e.act === 'created').length, improved: entries.filter((e) => e.by === 'kaby' && e.mode === 'auto' && e.act === 'improved').length }
  const names = Object.keys(ledger.learned)
  const weekUses = names.map((n) => ({ name: n, uses: (ledger.learned[n].useLog || []).filter((t) => Date.parse(t) >= since).length })).filter((x) => x.uses > 0).sort((a, b) => b.uses - a.uses || (a.name < b.name ? -1 : 1))
  const used = weekUses.reduce((n, x) => n + x.uses, 0)
  const stale = names.filter((n) => existsSync(join(skillsDir(dsh), n, 'SKILL.md')) && unusedFor(ledger.learned[n], now) > 0).map((n) => ({ name: n, root: skillsDir(dsh), days: unusedFor(ledger.learned[n], now) })).sort((a, b) => b.days - a.days).slice(0, 3)
  const ready = names.filter((n) => shareReady(ledger.learned[n], settings, sensitive)).map((n) => ({ name: n, chats: ledger.learned[n].usedIn.length })).slice(0, 2)
  const waiting = ledger.proposals.length
  const something = accepted > 0 || used > 0 || waiting > 0 || auto.created + auto.improved > 0 || stale.length > 0 || ready.length > 0
  if (!something) return off('quiet')
  state.week = { key, session: sid, hidden: null }
  return { ok: true, show: true, week: key, from: new Date(since).toISOString().slice(0, 10), to: new Date(now - DAY).toISOString().slice(0, 10), accepted, used, usedSkills: weekUses.length, top: weekUses.length > 0 && weekUses[0].uses >= 2 ? weekUses[0] : null, waiting, auto, stale, ready, sensitive }
}))

/** « Hide »: the card stays away until next week. */
export const hideWeek = ({ dsh, now = Date.now() }) => withState(dsh, async (state) => { state.week = { key: state.week.key, session: state.week.session, hidden: weekKey(now) }; return { ok: true, week: weekKey(now) } })
