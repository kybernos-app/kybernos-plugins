// The governor: the one place that decides whether a turn may start, and what it may cost. Every check here is plain code on plain
// counters, so a visitor (or a model) cannot talk their way past it.
//
//   - worst-case cost is RESERVED, synchronously, before the first await of a turn; two turns started at the same instant both
//     see the other's reservation, so the sum of what can be spent never exceeds the cap;
//   - on settle the reservation is replaced by the real usage; on failure it is released (settled with what was really used);
//   - daily caps (shop and per visitor), concurrent turns, rate windows per IP / visitor / shop;
//   - the kill switch is a file (or a flag), checked first and independent of the usage ledger, which only counts.
//
// Money is integer micro-units of the currency (1 EUR = 1_000_000).

import fs from 'node:fs';
import { idFor } from './store.mjs';

/** Tokens a tool result may add to the next call's input (results are short and typed; this is the allowance counted). */
export const TOOL_RESULT_TOKENS = 500;

export function dayKey(ms, timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/** Real cost of one model call, in micro-units (rounded up: never under-count). */
export const costOf = (usage, budget) =>
  Math.ceil((usage.inputTokens || 0) * budget.inPerToken + (usage.outputTokens || 0) * budget.outPerToken);

/**
 * Highest this turn can cost: `maxToolSteps + 1` model calls, each reading everything before it (the input, the previous
 * answers, the tool results) and writing up to `maxOutputTokens`.
 */
export function worstCaseMicro({ inputChars, limits, budget }) {
  const calls = limits.maxToolSteps + 1;
  const base = Math.ceil(inputChars / budget.charsPerToken);
  let inTok = 0;
  for (let k = 0; k < calls; k += 1) inTok += base + k * (limits.maxOutputTokens + TOOL_RESULT_TOKENS);
  const outTok = calls * limits.maxOutputTokens;
  return Math.ceil(inTok * budget.inPerToken + outTok * budget.outPerToken);
}

const WINDOW_MS = 60_000;

export function createGovernor({ guardrails, store, now = Date.now, killFile = null }) {
  const G = () => (typeof guardrails === 'function' ? guardrails() : guardrails);
  let killedFlag = false;
  let ledger = store.getDoc('ledger', 'main') || { day: null, shopSpentMicro: 0, visitors: {} };
  const reservedShop = { micro: 0 };
  const reservedVisitor = new Map();
  const inflightVisitor = new Map();
  let inflightShop = 0;
  const windows = { ip: new Map(), visitor: new Map(), shop: new Map() };
  let nextTicket = 1;

  function rollover() {
    const today = dayKey(now(), G().budget.timezone);
    if (ledger.day !== today) { ledger = { day: today, shopSpentMicro: 0, visitors: {} }; store.putDoc('ledger', 'main', ledger); }
  }

  /** Counts this attempt in a sliding window; false when the limit is already used up. Attempts count even when refused. */
  function allow(map, key, limit) {
    const t = now();
    const arr = (map.get(key) || []).filter((x) => t - x < WINDOW_MS);
    const ok = arr.length < limit;
    arr.push(t);
    map.set(key, arr.length > limit + 1 ? arr.slice(-(limit + 1)) : arr);
    if (map.size > 20000) for (const [k, v] of map) if (!v.length || t - v[v.length - 1] >= WINDOW_MS) map.delete(k);
    return ok;
  }

  const isKilled = () => killedFlag || (killFile !== null && fs.existsSync(killFile));

  return {
    isKilled,

    setKilled(on) {
      killedFlag = !!on;
      if (killFile !== null) {
        if (on) fs.writeFileSync(killFile, `${new Date(now()).toISOString()}\n`, { mode: 0o600 });
        else { try { fs.unlinkSync(killFile); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
      }
    },

    /**
     * Synchronous by design. `{ ok: true, ticket }` or `{ ok: false, reason }` with reason in:
     * killed | disabled | rate_ip | rate_visitor | rate_shop | busy_shop | busy_visitor | day_cap | visitor_cap.
     */
    reserve({ visitorId, ip = 'unknown', estimateMicro }) {
      const g = G();
      if (isKilled()) return { ok: false, reason: 'killed' };
      if (!g.enabled) return { ok: false, reason: 'disabled' };
      rollover();
      const v = idFor(visitorId);
      if (!allow(windows.ip, ip, g.limits.perIpPerMin)) return { ok: false, reason: 'rate_ip' };
      if (!allow(windows.visitor, v, g.limits.perVisitorPerMin)) return { ok: false, reason: 'rate_visitor' };
      if (!allow(windows.shop, 'shop', g.limits.perShopPerMin)) return { ok: false, reason: 'rate_shop' };
      if (inflightShop >= g.limits.maxConcurrentShop) return { ok: false, reason: 'busy_shop' };
      if ((inflightVisitor.get(v) || 0) >= g.limits.maxConcurrentVisitor) return { ok: false, reason: 'busy_visitor' };
      const visitorSpent = ledger.visitors[v] || 0;
      if (ledger.shopSpentMicro + reservedShop.micro + estimateMicro > g.budget.dailyCapMicro) return { ok: false, reason: 'day_cap' };
      if (visitorSpent + (reservedVisitor.get(v) || 0) + estimateMicro > g.budget.visitorDailyCapMicro) return { ok: false, reason: 'visitor_cap' };
      reservedShop.micro += estimateMicro;
      reservedVisitor.set(v, (reservedVisitor.get(v) || 0) + estimateMicro);
      inflightShop += 1;
      inflightVisitor.set(v, (inflightVisitor.get(v) || 0) + 1);
      return { ok: true, ticket: { id: nextTicket++, v, reservedMicro: estimateMicro, settled: false } };
    },

    /** Replaces the reservation by the real cost (0 when nothing reached the model). Safe to call twice: the second is ignored. */
    settle(ticket, actualMicro = 0) {
      if (ticket.settled) return;
      ticket.settled = true;
      rollover();
      reservedShop.micro -= ticket.reservedMicro;
      const rv = (reservedVisitor.get(ticket.v) || 0) - ticket.reservedMicro;
      if (rv > 0) reservedVisitor.set(ticket.v, rv); else reservedVisitor.delete(ticket.v);
      inflightShop -= 1;
      const iv = (inflightVisitor.get(ticket.v) || 1) - 1;
      if (iv > 0) inflightVisitor.set(ticket.v, iv); else inflightVisitor.delete(ticket.v);
      const real = Math.max(0, Math.ceil(actualMicro));
      ledger.shopSpentMicro += real;
      ledger.visitors[ticket.v] = (ledger.visitors[ticket.v] || 0) + real;
      store.putDoc('ledger', 'main', ledger);
    },

    /** What the Boîte shows: today's spend against the caps, and what is running now. */
    snapshot() {
      rollover();
      const g = G();
      return {
        day: ledger.day,
        currency: g.budget.currency,
        spentMicro: ledger.shopSpentMicro,
        reservedMicro: reservedShop.micro,
        capMicro: g.budget.dailyCapMicro,
        inflight: inflightShop,
        killed: isKilled(),
        enabled: g.enabled,
      };
    },
  };
}
