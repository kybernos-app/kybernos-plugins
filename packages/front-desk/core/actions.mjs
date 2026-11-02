// The closed menu of things the public assistant can DO. Nothing outside this catalogue exists for it: a tool name the model
// invents is refused here, in code, whatever the model was told. For each action:
//   - it is exposed only when the fiche turned it on (off / approve / auto), the identity level is high enough and, for the ones
//     that need a business system, its port is present;
//   - its parameters are checked against a schema (unknown keys refused) before anything runs;
//   - who it concerns always comes from the CHANNEL (ctx), never from a parameter or from the visitor's words;
//   - a call that creates something outside (a message, a callback, a booking) runs once per conversation (idempotency key), so a
//     retry never books twice; reads, erasure and "ask to remember" always run fresh, so they are never stale or skipped;
//   - `approve` parks the call until the owner decides in the Boîte.

import crypto from 'node:crypto';
import { validate } from './schema.mjs';
import { idFor } from './store.mjs';
import { lookupKey } from './identity.mjs';

const IDEM_TTL_MS = 24 * 3600 * 1000;
const rid = (p) => `${p}_${crypto.randomBytes(8).toString('hex')}`;
const canonical = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

const FIELDS = {
  first_name: { max: 40, pattern: '^[\\p{L}][\\p{L} \'’-]*$' },
  email: { max: 120, pattern: '^[^\\s@<>]+@[^\\s@<>]+\\.[^\\s@<>]+$' },
  preference: { max: 80, pattern: null },
};

/** The catalogue. `needs` names a port; `minLevel` is the identity level required; `once` = a repeat of the same call is not run again. */
const CATALOGUE = {
  leave_message: {
    description: 'Leave a message for the shop team, to be answered by a person.',
    minLevel: 1,
    once: true,
    params: { type: 'object', required: ['message'], properties: { message: { type: 'string', minLength: 1, maxLength: 500 }, contact: { type: 'string', maxLength: 120 } } },
  },
  request_callback: {
    description: 'Ask the shop to call the visitor back.',
    minLevel: 1,
    once: true,
    params: { type: 'object', required: ['phone'], properties: { phone: { type: 'string', pattern: '^[+0-9 ().-]{6,20}$' }, when: { type: 'string', maxLength: 80 } } },
  },
  note_visitor: {
    description: 'Ask the visitor if one short fact may be remembered for next time (first_name, email or preference). The visitor must accept by a button.',
    minLevel: 1,
    params: { type: 'object', required: ['field', 'value'], properties: { field: { type: 'string', enum: Object.keys(FIELDS) }, value: { type: 'string', minLength: 1, maxLength: 120 } } },
  },
  forget_visitor: {
    description: 'Erase everything remembered about this visitor, when they ask.',
    minLevel: 1,
    params: { type: 'object', properties: {} },
  },
  list_slots: {
    description: 'List the free appointment slots on a day.',
    minLevel: 1,
    needs: 'calendar',
    params: { type: 'object', required: ['date'], properties: { date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } } },
  },
  book_appointment: {
    description: 'Book one of the listed free slots.',
    minLevel: 1,
    once: true,
    needs: 'calendar',
    params: { type: 'object', required: ['slotId', 'name'], properties: { slotId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,40}$' }, name: { type: 'string', minLength: 1, maxLength: 60 } } },
  },
  order_status: {
    description: 'Tell the visitor the state of one of THEIR orders. Only works when the channel itself proves who they are.',
    minLevel: 2,
    needs: 'orders',
    params: { type: 'object', required: ['orderRef'], properties: { orderRef: { type: 'string', pattern: '^[A-Za-z0-9-]{3,30}$' } } },
  },
};

/** The JSON schema a model is shown: the same schema, with unknown keys refused. */
function toJsonSchema(s) {
  if (s.type !== 'object') return s;
  const props = {};
  for (const [k, v] of Object.entries(s.properties || {})) props[k] = toJsonSchema(v);
  return { ...s, properties: props, additionalProperties: false };
}

export function createActions({ store, guardrails, ports = {}, now = Date.now }) {
  const G = () => (typeof guardrails === 'function' ? guardrails() : guardrails);
  const mode = (name) => G().actions[name] || 'off';
  const exposed = (name, level) => {
    const def = CATALOGUE[name];
    return !!def && mode(name) !== 'off' && level >= def.minLevel && (!def.needs || !!ports[def.needs]);
  };
  const audit = (entry) => store.appendLog('events', { ts: now(), ...entry });

  /** What a visitor's record holds, for the contact card and for "My data". */
  const recordByKey = (key) => store.getDoc('visitors', key);
  const visitorOf = (ctx) => recordByKey(idFor(lookupKey(ctx)));

  function eraseKey(key) {
    const had = store.delDoc('visitors', key);
    let notes = 0;
    for (const { id, value } of store.listDocs('pending_notes')) if (value.key === key) { store.delDoc('pending_notes', id); notes += 1; }
    let convs = 0;
    for (const { id, value } of store.listDocs('conversations')) {
      if (value.key !== key) continue;
      store.deleteLog(`conv_${id.slice(2)}`);
      store.delDoc('conversations', id);
      for (const col of ['messages', 'callbacks']) {
        for (const m of store.listDocs(col)) if (m.value.convId === id) store.delDoc(col, m.id);
      }
      convs += 1;
    }
    store.appendLog('erasures', { ts: now(), key, record: had, notes, conversations: convs });
    return { record: had, notes, conversations: convs };
  }

  const runners = {
    leave_message(p, ctx) {
      const id = rid('m');
      store.putDoc('messages', id, { id, ts: now(), convId: ctx.convId, channel: ctx.channel, message: p.message, contact: p.contact || '' });
      return { saved: true };
    },
    request_callback(p, ctx) {
      const id = rid('cb');
      store.putDoc('callbacks', id, { id, ts: now(), convId: ctx.convId, channel: ctx.channel, phone: p.phone, when: p.when || '' });
      return { saved: true };
    },
    note_visitor(p, ctx) {
      const f = FIELDS[p.field];
      if (p.value.length > f.max || (f.pattern && !new RegExp(f.pattern, 'u').test(p.value))) return { saved: false, error: 'bad_value' };
      const id = rid('n');
      store.putDoc('pending_notes', id, { id, key: idFor(lookupKey(ctx)), convId: ctx.convId, field: p.field, value: p.value, ts: now() });
      return { asked: true, noteId: id, field: p.field };
    },
    forget_visitor(_p, ctx) {
      const r = eraseKey(idFor(lookupKey(ctx)));
      return { erased: true, conversations: r.conversations };
    },
    list_slots(p) {
      return { slots: ports.calendar.listSlots(p.date) };
    },
    book_appointment(p, ctx, idemKey) {
      const r = ports.calendar.book({ slotId: p.slotId, name: p.name, key: idemKey, convId: ctx.convId });
      return r && r.ok ? { booked: true, slot: r.slot } : { booked: false, error: (r && r.error) || 'unavailable' };
    },
    order_status(p, ctx) {
      // `senderKey` is the channel's own id for this person: it is never taken from the parameters.
      const r = ports.orders.lookup({ channel: ctx.channel, senderKey: ctx.senderKey, orderRef: p.orderRef });
      return r ? { found: true, status: String(r.status) } : { found: false };
    },
  };

  function run(name, params, ctx, idemKey) {
    const result = runners[name](params, ctx, idemKey);
    audit({ convId: ctx.convId, name, status: 'done', channel: ctx.channel });
    return result;
  }

  return {
    names: Object.keys(CATALOGUE),

    /** The tool list shown to the model for this identity level, in OpenAI function format. */
    describe({ level }) {
      return Object.keys(CATALOGUE).filter((n) => exposed(n, level)).map((n) => ({
        type: 'function',
        function: { name: n, description: CATALOGUE[n].description, parameters: toJsonSchema(CATALOGUE[n].params) },
      }));
    },

    /** `{ ok, result }`, `{ ok: true, pending: true, approvalId }` or `{ ok: false, error }`. Never throws for a bad call. */
    execute({ name, args, ctx }) {
      if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(CATALOGUE, name)) { audit({ convId: ctx.convId, name: String(name).slice(0, 40), status: 'refused:unknown' }); return { ok: false, error: 'unknown_action' }; }
      if (!exposed(name, ctx.level)) { audit({ convId: ctx.convId, name, status: 'refused:not_exposed' }); return { ok: false, error: mode(name) === 'off' ? 'unknown_action' : 'level_needed' }; }
      const v = validate(CATALOGUE[name].params, args === undefined ? {} : args);
      if (!v.ok) { audit({ convId: ctx.convId, name, status: 'refused:params' }); return { ok: false, error: 'bad_params', details: v.errors.slice(0, 3) }; }
      const idemKey = crypto.createHash('sha256').update(`${ctx.convId}|${name}|${canonical(v.value)}`).digest('hex');
      const once = !!CATALOGUE[name].once;
      const seen = once ? store.getDoc('idem', idFor(idemKey)) : null;
      if (seen && now() - seen.ts < IDEM_TTL_MS) return seen.outcome;
      let outcome;
      if (mode(name) === 'approve') {
        const approvalId = rid('a');
        store.putDoc('approvals', approvalId, { id: approvalId, name, params: v.value, ctx, idemKey, status: 'pending', createdAt: now() });
        audit({ convId: ctx.convId, name, status: 'awaiting_approval', approvalId });
        outcome = { ok: true, pending: true, approvalId };
      } else {
        try { outcome = { ok: true, result: run(name, v.value, ctx, idemKey) }; } catch (e) { audit({ convId: ctx.convId, name, status: 'failed' }); return { ok: false, error: 'failed' }; }
      }
      if (once) store.putDoc('idem', idFor(idemKey), { ts: now(), outcome });
      return outcome;
    },

    /** The owner's decision on a parked call (from the Boîte). Runs it only once, only if still pending. */
    decide(approvalId, decision) {
      const a = store.getDoc('approvals', approvalId);
      if (!a) return { ok: false, error: 'not_found' };
      if (a.status !== 'pending') return { ok: false, error: 'already_decided' };
      if (decision === 'reject') { a.status = 'rejected'; a.decidedAt = now(); store.putDoc('approvals', approvalId, a); audit({ convId: a.ctx.convId, name: a.name, status: 'rejected', approvalId }); return { ok: true, status: 'rejected' }; }
      if (decision !== 'approve') return { ok: false, error: 'bad_decision' };
      a.status = 'approved'; a.decidedAt = now();
      store.putDoc('approvals', approvalId, a); // marked first: a crash while running never runs it twice
      try { a.result = run(a.name, a.params, a.ctx, a.idemKey); } catch (e) { a.status = 'failed'; }
      store.putDoc('approvals', approvalId, a);
      return { ok: a.status === 'approved', status: a.status, result: a.result };
    },

    /** The visitor pressed a consent button on a pending note. Only the owner of the note (same channel key) can. */
    consent({ noteId, accept, ctx }) {
      const n = store.getDoc('pending_notes', noteId);
      if (!n || n.key !== idFor(lookupKey(ctx))) return { ok: false, error: 'not_found' };
      store.delDoc('pending_notes', noteId);
      if (!accept) return { ok: true, saved: false };
      const rec = store.getDoc('visitors', n.key) || { createdAt: now(), fields: {} };
      rec.fields[n.field] = { value: n.value, consentAt: now() };
      store.putDoc('visitors', n.key, rec);
      audit({ convId: n.convId, name: 'note_visitor', status: 'consented', field: n.field });
      return { ok: true, saved: true };
    },

    visitorOf,
    recordByKey,
    eraseKey,
    eraseVisitor: (ctx) => eraseKey(idFor(lookupKey(ctx))),
  };
}

/** A calendar in memory, for tests and a first try: free slots, never booked twice, a repeated key returns the same booking. */
export function createMemoryCalendar(slots) {
  const taken = new Map(); // slotId -> { name, key }
  const byKey = new Map();
  return {
    listSlots: (date) => slots.filter((s) => s.date === date && !taken.has(s.id)).map((s) => ({ id: s.id, date: s.date, time: s.time })),
    book({ slotId, name, key }) {
      if (byKey.has(key)) return byKey.get(key);
      const slot = slots.find((s) => s.id === slotId);
      if (!slot) return { ok: false, error: 'no_such_slot' };
      if (taken.has(slotId)) return { ok: false, error: 'taken' };
      taken.set(slotId, { name, key });
      const r = { ok: true, slot: { id: slot.id, date: slot.date, time: slot.time } };
      byKey.set(key, r);
      return r;
    },
    bookings: () => [...taken.entries()].map(([slotId, v]) => ({ slotId, ...v })),
  };
}
