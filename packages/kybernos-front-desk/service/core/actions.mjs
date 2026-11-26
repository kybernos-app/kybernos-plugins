// The closed menu of things the public assistant can DO. Nothing outside this catalogue exists for it: a tool name the model
// invents is refused here, in code, whatever the model was told. For each action:
//   - it is exposed only when the fiche turned it on (off / approve / auto), the identity level is high enough and, for the ones
//     that need a business system, its port is present;
//   - its parameters are checked against a schema (unknown keys refused) before anything runs;
//   - who it concerns always comes from the CHANNEL (ctx), never from a parameter or from the visitor's words;
//   - a call that creates something outside (a message, a callback, a booking) runs once per conversation (idempotency key), so a
//     retry never books twice; reads, erasure and "ask to remember" always run fresh, so they are never stale or skipped;
//   - `approve` parks the call until the owner decides in the Boîte;
//   - what a call created is written to a `done` list (what the Boîte shows as "what the assistant did") with an Undo for each kind;
//   - `report_unanswered` is the one internal tool: it only records a question the assistant could not answer (never configurable).

import crypto from 'node:crypto';
import { validate } from './schema.mjs';
import { convIdForKey, idFor } from './store.mjs';
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
  report_unanswered: {
    description: 'Record a visitor question you could not answer from the shop facts, so the owner can add the answer. It tells the visitor nothing by itself.',
    minLevel: 1,
    once: true,
    internal: true,
    params: { type: 'object', required: ['question'], properties: { question: { type: 'string', minLength: 1, maxLength: 300 } } },
  },
};

/** What the owner's capability sheet needs to know about each action, without the schemas. */
export const ACTION_INFO = Object.freeze(Object.fromEntries(Object.entries(CATALOGUE).filter(([, d]) => !d.internal).map(([name, d]) => [name, { minLevel: d.minLevel, needs: d.needs || null }])));
export const MEMORY_FIELDS = Object.freeze(Object.keys(FIELDS));

/** The JSON schema a model is shown: the same schema, with unknown keys refused. */
function toJsonSchema(s) {
  if (s.type !== 'object') return s;
  const props = {};
  for (const [k, v] of Object.entries(s.properties || {})) props[k] = toJsonSchema(v);
  return { ...s, properties: props, additionalProperties: false };
}

export function createActions({ store, guardrails, ports = {}, now = Date.now }) {
  const G = () => (typeof guardrails === 'function' ? guardrails() : guardrails);
  // An internal tool is always on and never parks for approval: the fiche cannot configure it.
  const mode = (name) => (CATALOGUE[name] && CATALOGUE[name].internal ? 'auto' : G().actions[name] || 'off');
  const portReady = (needs) => !!ports[needs] && (typeof ports[needs].enabled !== 'function' || ports[needs].enabled());
  const exposed = (name, level) => {
    const def = CATALOGUE[name];
    return !!def && mode(name) !== 'off' && level >= def.minLevel && (!def.needs || portReady(def.needs));
  };
  const audit = (entry) => store.appendLog('events', { ts: now(), ...entry });

  /** What a visitor's record holds, for the contact card and for "My data". */
  const recordByKey = (key) => store.getDoc('visitors', key);
  const visitorOf = (ctx) => recordByKey(idFor(lookupKey(ctx)));

  /**
   * Everything the assistant holds about a visitor: their record, the notes waiting for their consent, their conversation and what hangs from it (messages, callbacks,
   * the done list, unanswered questions, bookings, the calls parked for the owner's approval with their parameters), and the retry memory of those calls.
   * The conversation id comes from the key, so a visitor erased in the very turn that created them (nothing written yet) is erased too.
   */
  function eraseKey(key) {
    const had = store.delDoc('visitors', key);
    let notes = 0;
    for (const { id, value } of store.listDocs('pending_notes')) if (value.key === key) { store.delDoc('pending_notes', id); notes += 1; }
    const convIds = new Set([convIdForKey(key)]);
    for (const { id, value } of store.listDocs('conversations')) if (value.key === key) convIds.add(id);
    let convs = 0;
    for (const id of convIds) {
      store.deleteLog(`conv_${id.slice(2)}`);
      if (store.delDoc('conversations', id)) convs += 1;
      for (const col of ['messages', 'callbacks', 'done', 'unanswered', 'approvals']) {
        for (const m of store.listDocs(col)) {
          const at = col === 'approvals' ? (m.value.ctx && m.value.ctx.convId) : m.value.convId;
          if (at === id) store.delDoc(col, m.id);
        }
      }
      for (const m of store.listDocs('idem')) if (m.value.convId === id) store.delDoc('idem', m.id);
      for (const b of store.listDocs('bookings')) if (b.value.convId === id && ports.calendar && ports.calendar.cancel) ports.calendar.cancel(b.id);
    }
    store.appendLog('erasures', { ts: now(), key, record: had, notes, conversations: convs });
    return { record: had, notes, conversations: convs };
  }

  const runners = {
    leave_message(p, ctx) {
      const id = rid('m');
      store.putDoc('messages', id, { id, ts: now(), convId: ctx.convId, channel: ctx.channel, message: p.message, contact: p.contact || '' });
      return { saved: true, done: { kind: 'message', ref: id, detail: p.message.slice(0, 80) } };
    },
    request_callback(p, ctx) {
      const id = rid('cb');
      store.putDoc('callbacks', id, { id, ts: now(), convId: ctx.convId, channel: ctx.channel, phone: p.phone, when: p.when || '' });
      return { saved: true, done: { kind: 'callback', ref: id, detail: p.when || '' } };
    },
    report_unanswered(p, ctx) {
      const q = p.question.trim();
      const same = store.listDocs('unanswered').some((u) => u.value.convId === ctx.convId && u.value.status === 'open' && u.value.question.toLowerCase() === q.toLowerCase());
      if (!same) { const id = rid('u'); store.putDoc('unanswered', id, { id, ts: now(), convId: ctx.convId, question: q, status: 'open' }); }
      return { recorded: true };
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
      return r && r.ok ? { booked: true, slot: r.slot, done: { kind: 'booking', ref: r.slot.id, detail: `${r.slot.date} ${r.slot.time}` } } : { booked: false, error: (r && r.error) || 'unavailable' };
    },
    order_status(p, ctx) {
      // `senderKey` is the channel's own id for this person: it is never taken from the parameters.
      const r = ports.orders.lookup({ channel: ctx.channel, senderKey: ctx.senderKey, orderRef: p.orderRef });
      return r ? { found: true, status: String(r.status) } : { found: false };
    },
  };

  /** Records what a call created, for the Boîte's "what the assistant did" and its Undo. */
  function logDone(name, ctx, done) {
    const id = rid('d');
    store.putDoc('done', id, { id, ts: now(), convId: ctx.convId, name, status: 'done', ...done });
    return id;
  }

  function run(name, params, ctx, idemKey) {
    const { done, ...result } = runners[name](params, ctx, idemKey);
    if (done) logDone(name, ctx, { ...done, idemKey });
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
      if (once) store.putDoc('idem', idFor(idemKey), { ts: now(), convId: ctx.convId, outcome });
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
      logDone('note_visitor', { convId: n.convId }, { kind: 'note', ref: n.field, key: n.key, detail: n.field });
      audit({ convId: n.convId, name: 'note_visitor', status: 'consented', field: n.field });
      return { ok: true, saved: true };
    },

    /** The owner undoes something the assistant did. Runs once: a second call says so. */
    undo(doneId) {
      const d = store.getDoc('done', doneId);
      if (!d) return { ok: false, error: 'not_found' };
      if (d.status !== 'done') return { ok: false, error: 'already_undone' };
      if (d.kind === 'message') store.delDoc('messages', d.ref);
      else if (d.kind === 'callback') store.delDoc('callbacks', d.ref);
      else if (d.kind === 'booking') { if (!ports.calendar || !ports.calendar.cancel) return { ok: false, error: 'not_undoable' }; ports.calendar.cancel(d.ref); }
      else if (d.kind === 'note') {
        const rec = store.getDoc('visitors', d.key);
        if (rec) { delete rec.fields[d.ref]; if (Object.keys(rec.fields).length) store.putDoc('visitors', d.key, rec); else store.delDoc('visitors', d.key); }
      } else return { ok: false, error: 'not_undoable' };
      // The retry memory of that call goes too, so the same call later is a new one and not a stale "done".
      if (d.idemKey) store.delDoc('idem', idFor(d.idemKey));
      d.status = 'undone'; d.undoneAt = now();
      store.putDoc('done', doneId, d);
      audit({ convId: d.convId, name: d.name, status: 'undone', doneId });
      return { ok: true };
    },

    doneFor: (convId) => store.listDocs('done').map((x) => x.value).filter((x) => x.convId === convId).sort((a, b) => a.ts - b.ts),

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
