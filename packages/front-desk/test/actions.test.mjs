import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSvc } from './helpers.mjs';
import { createMemoryCalendar } from '../core/actions.mjs';
import { idFor } from '../core/store.mjs';
import { lookupKey } from '../core/identity.mjs';

const ALL = { leave_message: 'auto', request_callback: 'auto', note_visitor: 'auto', forget_visitor: 'auto', list_slots: 'auto', book_appointment: 'auto', order_status: 'auto' };
const ctx = (over = {}) => ({ convId: 'c_aaaaaaaaaaaaaaaaaaaaaaaa', channel: 'site', senderKey: 'visitorxxxxx', level: 1, lang: 'en', ...over });
const calendar = () => createMemoryCalendar([{ id: 's1', date: '2026-11-10', time: '10:00' }]);

test('the menu shows only what is on, at the visitor\'s level, with its port present', () => {
  const none = makeSvc({ guardrails: { actions: ALL } });
  assert.deepEqual(none.actions.describe({ level: 1 }).map((t) => t.function.name).sort(), ['forget_visitor', 'leave_message', 'note_visitor', 'report_unanswered', 'request_callback']);
  const full = makeSvc({ guardrails: { actions: ALL }, ports: { calendar: calendar(), orders: { lookup: () => null } } });
  assert.ok(full.actions.describe({ level: 1 }).every((t) => t.function.name !== 'order_status'));
  assert.ok(full.actions.describe({ level: 2 }).some((t) => t.function.name === 'order_status'));
  const off = makeSvc({ guardrails: { actions: { leave_message: 'off' } } });
  assert.ok(off.actions.describe({ level: 3 }).every((t) => t.function.name !== 'leave_message'));
  // The internal tool cannot be switched off by a fiche, and it is not in the menu a fiche can configure.
  assert.ok(off.actions.describe({ level: 1 }).some((t) => t.function.name === 'report_unanswered'));
});

test('every tool schema refuses unknown parameters', () => {
  const svc = makeSvc({ guardrails: { actions: ALL }, ports: { calendar: calendar(), orders: { lookup: () => null } } });
  for (const t of svc.actions.describe({ level: 3 })) assert.equal(t.function.parameters.additionalProperties, false, t.function.name);
});

test('a name outside the menu, or a prototype key, is refused', () => {
  const svc = makeSvc({ guardrails: { actions: ALL } });
  for (const name of ['rm_rf', 'constructor', '__proto__', 'toString', '', undefined, 42, 'leave_message ']) {
    assert.equal(svc.actions.execute({ name, args: {}, ctx: ctx() }).ok, false, String(name));
  }
});

test('an action that is off is refused even if the model calls it by name', () => {
  const svc = makeSvc({ guardrails: { actions: { leave_message: 'off' } } });
  const r = svc.actions.execute({ name: 'leave_message', args: { message: 'hi' }, ctx: ctx() });
  assert.deepEqual([r.ok, r.error], [false, 'unknown_action']);
  assert.equal(svc.store.listDocs('messages').length, 0);
});

test('bad parameters are refused before anything runs', () => {
  const svc = makeSvc({ guardrails: { actions: ALL } });
  for (const args of [{}, { message: '' }, { message: 'x'.repeat(501) }, { message: 'x', extra: 1 }, { message: 5 }]) {
    assert.equal(svc.actions.execute({ name: 'leave_message', args, ctx: ctx() }).error, 'bad_params');
  }
  assert.equal(svc.store.listDocs('messages').length, 0);
});

test('the same call in the same conversation runs once; another conversation runs again', () => {
  const svc = makeSvc({ guardrails: { actions: ALL } });
  const call = (c) => svc.actions.execute({ name: 'leave_message', args: { message: 'call me' }, ctx: c });
  call(ctx()); call(ctx()); call(ctx());
  assert.equal(svc.store.listDocs('messages').length, 1);
  call(ctx({ convId: 'c_bbbbbbbbbbbbbbbbbbbbbbbb' }));
  assert.equal(svc.store.listDocs('messages').length, 2);
});

test('approve mode parks the call; approving runs it once, rejecting runs nothing', () => {
  const svc = makeSvc({ guardrails: { actions: { leave_message: 'approve' } } });
  const p = svc.actions.execute({ name: 'leave_message', args: { message: 'hello' }, ctx: ctx() });
  assert.equal(p.pending, true);
  assert.equal(svc.store.listDocs('messages').length, 0);
  assert.equal(svc.actions.decide(p.approvalId, 'approve').ok, true);
  assert.equal(svc.store.listDocs('messages').length, 1);
  assert.equal(svc.actions.decide(p.approvalId, 'approve').error, 'already_decided');
  assert.equal(svc.store.listDocs('messages').length, 1);
  const q = svc.actions.execute({ name: 'leave_message', args: { message: 'other' }, ctx: ctx() });
  assert.equal(svc.actions.decide(q.approvalId, 'reject').status, 'rejected');
  assert.equal(svc.store.listDocs('messages').length, 1);
  assert.equal(svc.actions.decide('a_nope', 'approve').error, 'not_found');
});

test('remembering a fact needs the visitor\'s button; only the same channel key can press it; a bad value is refused', () => {
  const svc = makeSvc({ guardrails: { actions: ALL } });
  const r = svc.actions.execute({ name: 'note_visitor', args: { field: 'email', value: 'a@b.example' }, ctx: ctx() });
  assert.equal(r.result.asked, true);
  assert.equal(svc.actions.visitorOf(ctx()), null, 'nothing is kept before consent');
  assert.equal(svc.actions.consent({ noteId: r.result.noteId, accept: true, ctx: ctx({ senderKey: 'someoneelse' }) }).ok, false);
  assert.equal(svc.actions.consent({ noteId: r.result.noteId, accept: true, ctx: ctx() }).saved, true);
  assert.equal(svc.actions.visitorOf(ctx()).fields.email.value, 'a@b.example');
  const bad = svc.actions.execute({ name: 'note_visitor', args: { field: 'email', value: 'not an email' }, ctx: ctx() });
  assert.equal(bad.result.saved, false);
  const declined = svc.actions.execute({ name: 'note_visitor', args: { field: 'first_name', value: 'Karim' }, ctx: ctx() });
  assert.equal(svc.actions.consent({ noteId: declined.result.noteId, accept: false, ctx: ctx() }).saved, false);
  assert.equal(svc.actions.visitorOf(ctx()).fields.first_name, undefined);
});

test('free text cannot be remembered as a typed field: field names are an enum', () => {
  const svc = makeSvc({ guardrails: { actions: ALL } });
  assert.equal(svc.actions.execute({ name: 'note_visitor', args: { field: 'diary', value: 'secret' }, ctx: ctx() }).error, 'bad_params');
});

test('forgetting erases the record, the conversations and the messages left, and only this visitor\'s', () => {
  const svc = makeSvc({ guardrails: { actions: ALL } });
  const me = ctx();
  const other = ctx({ senderKey: 'visitoryyyyy', convId: 'c_cccccccccccccccccccccccc' });
  for (const c of [me, other]) {
    const n = svc.actions.execute({ name: 'note_visitor', args: { field: 'first_name', value: 'Ann' }, ctx: c });
    svc.actions.consent({ noteId: n.result.noteId, accept: true, ctx: c });
    svc.actions.execute({ name: 'leave_message', args: { message: 'for the shop' }, ctx: c });
    svc.store.putDoc('conversations', c.convId, { id: c.convId, key: idFor(lookupKey(c)) });
    svc.store.appendLog(`conv_${c.convId.slice(2)}`, { role: 'user', text: 'hello' });
  }
  const r = svc.actions.execute({ name: 'forget_visitor', args: {}, ctx: me });
  assert.equal(r.result.erased, true);
  assert.equal(svc.actions.visitorOf(me), null);
  assert.ok(svc.actions.visitorOf(other), 'the other visitor keeps their record');
  assert.equal(svc.store.listDocs('messages').filter((m) => m.value.convId === me.convId).length, 0);
  assert.equal(svc.store.listDocs('messages').filter((m) => m.value.convId === other.convId).length, 1);
  assert.equal(svc.store.readLog('erasures').length, 1);
  assert.deepEqual(svc.store.readLog(`conv_${me.convId.slice(2)}`), []);
  assert.equal(svc.store.readLog(`conv_${other.convId.slice(2)}`).length, 1);
});

test('calendar: a slot is booked once across conversations, a repeated key returns the same booking', () => {
  const cal = calendar();
  const svc = makeSvc({ guardrails: { actions: ALL }, ports: { calendar: cal } });
  const a = svc.actions.execute({ name: 'book_appointment', args: { slotId: 's1', name: 'Ann' }, ctx: ctx() });
  const b = svc.actions.execute({ name: 'book_appointment', args: { slotId: 's1', name: 'Bob' }, ctx: ctx({ convId: 'c_dddddddddddddddddddddddd', senderKey: 'visitorbbbbb' }) });
  assert.equal(a.result.booked, true);
  assert.equal(b.result.booked, false);
  assert.equal(cal.bookings().length, 1);
  assert.deepEqual(svc.actions.execute({ name: 'list_slots', args: { date: '2026-11-10' }, ctx: ctx() }).result.slots, []);
  assert.equal(svc.actions.execute({ name: 'list_slots', args: { date: 'tomorrow' }, ctx: ctx() }).error, 'bad_params');
});

test('order status: refused below level 2; the sender comes from the channel, never from the parameters', () => {
  const seen = [];
  const orders = { lookup: (q) => { seen.push(q); return q.senderKey === '111' ? { status: 'shipped' } : null; } };
  const svc = makeSvc({ guardrails: { actions: ALL }, ports: { orders } });
  assert.equal(svc.actions.execute({ name: 'order_status', args: { orderRef: 'ORD-1' }, ctx: ctx({ level: 1 }) }).ok, false);
  assert.equal(svc.actions.execute({ name: 'order_status', args: { orderRef: 'ORD-1', senderKey: '111' }, ctx: ctx({ level: 2, channel: 'wa', senderKey: '222' }) }).error, 'bad_params');
  const r = svc.actions.execute({ name: 'order_status', args: { orderRef: 'ORD-1' }, ctx: ctx({ level: 2, channel: 'wa', senderKey: '222' }) });
  assert.equal(r.result.found, false);
  assert.deepEqual(seen.map((q) => q.senderKey), ['222']);
});

test('erasure, "ask to remember" and reads always run fresh: a repeat is never answered from an old result', () => {
  const cal = calendar();
  const svc = makeSvc({ guardrails: { actions: ALL }, ports: { calendar: cal } });
  const c = ctx();
  const remember = () => {
    const n = svc.actions.execute({ name: 'note_visitor', args: { field: 'first_name', value: 'Ann' }, ctx: c });
    return svc.actions.consent({ noteId: n.result.noteId, accept: true, ctx: c });
  };
  assert.equal(remember().saved, true);
  svc.actions.execute({ name: 'forget_visitor', args: {}, ctx: c });
  assert.equal(svc.actions.visitorOf(c), null);
  assert.equal(remember().saved, true, 'the same ask a second time gets a new note, not the used one');
  svc.actions.execute({ name: 'forget_visitor', args: {}, ctx: c });
  assert.equal(svc.actions.visitorOf(c), null, 'a second erase really erases');
  const before = svc.actions.execute({ name: 'list_slots', args: { date: '2026-11-10' }, ctx: c }).result.slots.length;
  svc.actions.execute({ name: 'book_appointment', args: { slotId: 's1', name: 'Ann' }, ctx: c });
  const after = svc.actions.execute({ name: 'list_slots', args: { date: '2026-11-10' }, ctx: c }).result.slots.length;
  assert.deepEqual([before, after], [1, 0], 'the list of slots is not stale');
});
