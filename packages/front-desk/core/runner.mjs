// The public runner: one visitor message in, one reply out. It owns the order of things and none of it is left to the model:
//   1. check the message, 2. work out the identity level from the CHANNEL, 3. reserve the worst-case cost (or refuse),
//   4. call the model with only the tools the menu exposes at that level, 5. run each tool call through the closed menu,
//   6. settle the real cost, always (also on error, on timeout).
// The visitor's text reaches the model fenced as data; the guard-rail block never reaches it at all.

import crypto from 'node:crypto';
import { buildSystemPrompt, wrapVisitor } from './fiche.mjs';
import { identityLevel, lookupKey } from './identity.mjs';
import { idFor } from './store.mjs';
import { costOf, worstCaseMicro } from './budget.mjs';
import { t } from './text.mjs';

const REFUSALS = {
  killed: 'closed', disabled: 'closed', rate_ip: 'limit.rate', rate_visitor: 'limit.rate', rate_shop: 'limit.rate',
  busy_shop: 'busy', busy_visitor: 'busy', day_cap: 'limit.day', visitor_cap: 'limit.visitor',
};
const MAX_REPLY_CHARS = 2000;

export function createRunner({ fiche, getGuardrails, model, store, governor, actions, now = Date.now }) {
  const G = getGuardrails || (() => fiche.guardrails);

  const convIdOf = (ctx) => `c_${idFor(lookupKey(ctx)).slice(2, 26)}`;
  const logName = (convId) => `conv_${convId.slice(2)}`;

  function touchConversation(ctx, preview) {
    const meta = store.getDoc('conversations', ctx.convId) || { id: ctx.convId, key: idFor(lookupKey(ctx)), channel: ctx.channel, level: ctx.level, createdAt: now() };
    meta.lastAt = now();
    meta.level = ctx.level;
    if (preview) meta.preview = preview.slice(0, 80);
    store.putDoc('conversations', ctx.convId, meta);
  }

  return {
    /** `{ ok, reply, pendingConsents, convId }` or `{ ok: false, error, reply }` (the reply is always safe to show). */
    async handleMessage({ channel, senderKey, visitorId, ip, text, lang }) {
      const g = G();
      const L = lang || fiche.language;
      const fail = (error, key) => ({ ok: false, error, reply: t(L, key) });
      const clean = typeof text === 'string' ? text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : '';
      if (!clean) return fail('empty', 'empty');
      if (clean.length > g.limits.maxInputChars) return fail('too_long', 'too_long');

      const level = identityLevel({ channel });
      const ctx = { channel, senderKey, level, lang: L };
      ctx.convId = convIdOf(ctx);
      const log = logName(ctx.convId);

      const memory = {};
      const rec = actions.visitorOf(ctx);
      if (rec) for (const [k, v] of Object.entries(rec.fields)) memory[k] = v.value;
      const system = buildSystemPrompt(fiche, { memory });
      const tools = actions.describe({ level });
      const history = store.readLog(log, g.limits.maxHistoryTurns * 4)
        .filter((e) => e.role === 'user' || e.role === 'assistant').slice(-g.limits.maxHistoryTurns * 2)
        .map((e) => ({ role: e.role, content: e.role === 'user' ? wrapVisitor(e.text) : e.text }));
      const userMsg = { role: 'user', content: wrapVisitor(clean) };

      const inputChars = system.length + JSON.stringify(tools).length + history.reduce((n, m) => n + m.content.length, 0) + userMsg.content.length;
      const estimateMicro = worstCaseMicro({ inputChars, limits: g.limits, budget: g.budget });
      const r = governor.reserve({ visitorId: visitorId || senderKey, ip, estimateMicro });
      if (!r.ok) return fail(r.reason, REFUSALS[r.reason] || 'error');
      const ticket = r.ticket;

      let spent = 0;
      const pendingConsents = [];
      const events = [];
      let reply = '';
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), g.limits.turnTimeoutMs);
        try {
          const messages = [...history, userMsg];
          const steps = g.limits.maxToolSteps;
          for (let step = 0; step <= steps; step += 1) {
            // The last allowed call gets no tools: it can only answer.
            const offered = step < steps ? tools : [];
            const out = await Promise.race([
              model.complete({ system, messages, tools: offered, maxOutputTokens: g.limits.maxOutputTokens, signal: ac.signal }),
              new Promise((_, rej) => { ac.signal.addEventListener('abort', () => rej(new Error('turn timeout')), { once: true }); }),
            ]);
            // No usage from the provider: count what was sent (all of it) and the longest answer allowed, never less.
            const usage = out.usage || { inputTokens: Math.ceil((system.length + JSON.stringify(offered).length + JSON.stringify(messages).length) / g.budget.charsPerToken), outputTokens: g.limits.maxOutputTokens };
            spent += costOf(usage, g.budget);
            if (spent > estimateMicro) throw new Error('turn exceeded its reservation');
            if (!out.toolCalls.length || step >= steps) { reply = out.text; break; }
            messages.push(out.assistant);
            out.toolCalls.forEach((call, i) => {
              let result;
              if (i >= g.limits.maxToolCallsPerStep) result = { ok: false, error: 'too_many_calls' };
              else {
                result = actions.execute({ name: call.name, args: call.args === null ? {} : call.args, ctx });
                events.push({ name: call.name, ok: result.ok, pending: !!result.pending });
                if (result.ok && result.result && result.result.asked) {
                  const value = pendingValue(store, result.result.noteId);
                  const what = `${result.result.field.replace('_', ' ')} (${value})`;
                  pendingConsents.push({ noteId: result.result.noteId, field: result.result.field, value, text: t(L, 'consent.ask', { what }) });
                }
              }
              messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 2000) });
            });
          }
        } finally { clearTimeout(timer); }
      } catch (e) {
        governor.settle(ticket, spent);
        return fail('failed', 'error');
      }
      governor.settle(ticket, spent);

      reply = String(reply || '').trim().slice(0, MAX_REPLY_CHARS);
      if (!reply) reply = events.some((e) => e.pending) ? t(L, 'approval.wait') : t(L, 'error');
      store.appendLog(log, { ts: now(), role: 'user', text: clean });
      for (const ev of events) store.appendLog(log, { ts: now(), type: 'event', ...ev });
      store.appendLog(log, { ts: now(), role: 'assistant', text: reply });
      touchConversation(ctx, clean);
      return { ok: true, reply, pendingConsents, convId: ctx.convId, costMicro: spent };
    },
  };
}

function pendingValue(store, noteId) {
  const n = store.getDoc('pending_notes', noteId);
  return n ? n.value : '';
}

export const newVisitorId = () => crypto.randomBytes(16).toString('hex');
