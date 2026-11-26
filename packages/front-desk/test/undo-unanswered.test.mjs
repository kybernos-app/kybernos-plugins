// What the assistant did and the owner can take back (`undo`, `doneFor`), the internal tool that records a question it could not
// answer (`report_unanswered`), and what erasing a visitor now removes (done and unanswered docs, bookings).

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFiche } from '../core/fiche.mjs';
import { ACTION_NAMES } from '../core/guardrails.mjs';
import { createMemoryCalendar } from '../core/actions.mjs';
import { stepOf } from '../core/scripted.mjs';
import { makeShop, clock, ctxOf, logOf } from './helpers-shop.mjs';
import { BASE, msg } from './helpers.mjs';

const ALL = { leave_message: 'auto', request_callback: 'auto', note_visitor: 'auto', forget_visitor: 'auto', list_slots: 'auto', book_appointment: 'auto' };
const OFF = Object.fromEntries(ACTION_NAMES.map((n) => [n, 'off']));
const AGENDA = { enabled: true, days: [2], from: '09:00', to: '12:00', slotMinutes: 60, horizonDays: 14 };
const call = (s, name, args, ctx = ctxOf()) => s.actions.execute({ name, args, ctx });
const B_CTX = ctxOf({ convId: 'c_bbbbbbbbbbbbbbbbbbbbbbbb', senderKey: 'visitorbbbbbb' });
const NO_SUCH_DONE = `d_${'0'.repeat(16)}`;
const auditOf = (s) => s.store.readLog('events', 1000);

/** The visitor says yes to a remembered fact: returns the `done` doc the consent left. */
function remember(s, ctx, field, value) {
  const n = call(s, 'note_visitor', { field, value }, ctx);
  assert.equal(s.actions.consent({ noteId: n.result.noteId, accept: true, ctx }).saved, true);
  return s.actions.doneFor(ctx.convId).filter((d) => d.kind === 'note' && d.ref === field).at(-1);
}

test('undo of a message removes it, runs once, and lets the same call be made again as a new one', () => {
  const c = clock();
  const s = makeShop({ now: c.now, guardrails: { actions: ALL } });
  call(s, 'leave_message', { message: 'Please call me' });
  const [d] = s.actions.doneFor(ctxOf().convId);
  assert.deepEqual([d.kind, d.name, d.status, d.detail], ['message', 'leave_message', 'done', 'Please call me']);
  assert.equal(s.store.listDocs('messages').length, 1);

  c.tick();
  assert.deepEqual(s.actions.undo(d.id), { ok: true });
  assert.equal(s.store.listDocs('messages').length, 0, 'the message is gone');
  const after = s.store.getDoc('done', d.id);
  assert.deepEqual([after.status, after.undoneAt], ['undone', c.t], 'the line stays, marked undone');
  assert.deepEqual(s.actions.undo(d.id), { ok: false, error: 'already_undone' });
  assert.deepEqual(s.actions.undo(NO_SUCH_DONE), { ok: false, error: 'not_found' });
  assert.ok(auditOf(s).some((e) => e.status === 'undone' && e.doneId === d.id), 'the undo is in the audit trail');

  call(s, 'leave_message', { message: 'Please call me' });
  assert.equal(s.store.listDocs('messages').length, 1, 'the retry memory went with it: the same words are a new message');
  assert.deepEqual(s.actions.doneFor(ctxOf().convId).map((x) => x.status), ['undone', 'done']);
});

test('undo of a callback request removes it', () => {
  const s = makeShop({ guardrails: { actions: ALL } });
  call(s, 'request_callback', { phone: '+33 6 12 34 56 78', when: 'tomorrow' });
  const [d] = s.actions.doneFor(ctxOf().convId);
  assert.deepEqual([d.kind, d.detail], ['callback', 'tomorrow']);
  assert.equal(s.store.listDocs('callbacks').length, 1);
  assert.deepEqual(s.actions.undo(d.id), { ok: true });
  assert.equal(s.store.listDocs('callbacks').length, 0);
  assert.equal(s.actions.undo(d.id).error, 'already_undone');
});

test('undo of a booking frees the slot and the same booking can be made again; a host calendar that cannot cancel says so', () => {
  const c = clock();
  const s = makeShop({ now: c.now, guardrails: { actions: ALL }, agenda: AGENDA });
  const args = { slotId: 's202611030900', name: 'Ann' };
  call(s, 'book_appointment', args);
  const [d] = s.actions.doneFor(ctxOf().convId);
  assert.deepEqual([d.kind, d.ref, d.detail], ['booking', 's202611030900', '2026-11-03 09:00']);
  assert.deepEqual(s.actions.undo(d.id), { ok: true });
  assert.deepEqual(s.calendar.bookings(), []);
  assert.equal(s.calendar.listSlots('2026-11-03').length, 3, 'the slot is free again');
  assert.equal(call(s, 'book_appointment', args).result.booked, true, 'and can be taken again by the same call');
  assert.equal(s.calendar.bookings().length, 1);

  const mine = createMemoryCalendar([{ id: 's1', date: '2026-11-10', time: '10:00' }]); // no `cancel`
  const host = makeShop({ guardrails: { actions: ALL }, ports: { calendar: mine } });
  call(host, 'book_appointment', { slotId: 's1', name: 'Ann' });
  const [hd] = host.actions.doneFor(ctxOf().convId);
  assert.deepEqual(host.actions.undo(hd.id), { ok: false, error: 'not_undoable' });
  assert.equal(host.store.getDoc('done', hd.id).status, 'done', 'a refused undo changes nothing');
  assert.equal(mine.bookings().length, 1);
});

test('undo of a remembered detail forgets that detail only, and the record goes when its last detail goes', () => {
  const c = clock();
  const s = makeShop({ now: c.now, guardrails: { actions: ALL } });
  const ctx = ctxOf();
  const first = remember(s, ctx, 'first_name', 'Ann');
  c.tick();
  const email = remember(s, ctx, 'email', 'ann@shop.example');
  assert.deepEqual(Object.keys(s.actions.visitorOf(ctx).fields).sort(), ['email', 'first_name']);

  assert.deepEqual(s.actions.undo(email.id), { ok: true });
  assert.deepEqual(Object.keys(s.actions.visitorOf(ctx).fields), ['first_name'], 'only the email is forgotten');
  assert.deepEqual(s.actions.undo(first.id), { ok: true });
  assert.equal(s.actions.visitorOf(ctx), null, 'no empty record is left behind');
  assert.equal(s.actions.undo(first.id).error, 'already_undone');

  const declined = call(s, 'note_visitor', { field: 'first_name', value: 'Ann' }, ctx);
  s.actions.consent({ noteId: declined.result.noteId, accept: false, ctx });
  assert.deepEqual(s.actions.doneFor(ctx.convId).filter((d) => d.status === 'done'), [], 'a declined detail is not something the assistant did');
});

test('a done line of a kind nobody can undo is refused', () => {
  const s = makeShop();
  s.store.putDoc('done', 'd_manual', { id: 'd_manual', ts: 1, convId: ctxOf().convId, name: 'x', status: 'done', kind: 'weird', ref: 'r' });
  assert.deepEqual(s.actions.undo('d_manual'), { ok: false, error: 'not_undoable' });
  assert.equal(s.store.getDoc('done', 'd_manual').status, 'done');
});

test('in approve mode nothing is "done" until the owner approves; undoing it makes a repeat ask for a new approval', () => {
  const s = makeShop({ guardrails: { actions: { leave_message: 'approve' } } });
  const p1 = call(s, 'leave_message', { message: 'hello' });
  assert.equal(p1.pending, true);
  assert.deepEqual(s.actions.doneFor(ctxOf().convId), [], 'a parked call has not done anything yet');
  assert.equal(call(s, 'leave_message', { message: 'hello' }).approvalId, p1.approvalId, 'a repeat gets the same pending approval');
  assert.equal(s.actions.decide(p1.approvalId, 'approve').ok, true);
  const [d] = s.actions.doneFor(ctxOf().convId);
  assert.ok(d.idemKey, 'the line remembers which call it came from');
  assert.deepEqual(s.actions.undo(d.id), { ok: true });
  assert.equal(s.store.listDocs('messages').length, 0);
  const p2 = call(s, 'leave_message', { message: 'hello' });
  assert.equal(p2.pending, true);
  assert.notEqual(p2.approvalId, p1.approvalId, 'after the undo the same words need a fresh approval');
});

test('doneFor lists one conversation\'s lines, oldest first, and nothing for an unknown one', () => {
  const c = clock();
  const s = makeShop({ now: c.now, guardrails: { actions: ALL } });
  call(s, 'leave_message', { message: 'one' });
  c.tick();
  call(s, 'leave_message', { message: 'other visitor' }, B_CTX);
  c.tick();
  call(s, 'request_callback', { phone: '+33 6 12 34 56 78' });
  c.tick();
  call(s, 'leave_message', { message: 'three' });
  const mine = s.actions.doneFor(ctxOf().convId);
  assert.deepEqual(mine.map((d) => d.kind), ['message', 'callback', 'message']);
  assert.ok(mine.every((d) => d.convId === ctxOf().convId));
  assert.deepEqual(mine.map((d) => d.ts), [...mine.map((d) => d.ts)].sort((a, b) => a - b));
  assert.deepEqual(s.actions.doneFor(B_CTX.convId).map((d) => d.detail), ['other visitor']);
  assert.deepEqual(s.actions.doneFor('c_cccccccccccccccccccccccc'), []);
});

test('report_unanswered is offered even when every action is off, and a fiche cannot configure or remove it', () => {
  const off = makeShop({ guardrails: { actions: OFF } });
  for (const level of [1, 2, 3]) assert.deepEqual(off.actions.describe({ level }).map((t) => t.function.name), ['report_unanswered'], `level ${level}`);

  const asked = parseFiche({ ...BASE, guardrails: { actions: { ...OFF, report_unanswered: 'off' } } });
  assert.ok(asked.warnings.some((w) => /report_unanswered.*not in the menu/.test(w)), 'the fiche is told it is not configurable');
  const still = makeShop({ guardrails: { actions: { ...OFF, report_unanswered: 'off' } } });
  assert.deepEqual(still.actions.describe({ level: 1 }).map((t) => t.function.name), ['report_unanswered']);
  const approve = makeShop({ guardrails: { actions: { ...OFF, report_unanswered: 'approve' } } });
  const r = call(approve, 'report_unanswered', { question: 'Gift cards?' });
  assert.deepEqual([r.ok, r.pending], [true, undefined], 'it never parks for approval');
  assert.equal(approve.store.listDocs('unanswered').length, 1);
});

test('report_unanswered records the question for the owner, once per conversation, whatever the case or the spacing', () => {
  const c = clock();
  const s = makeShop({ now: c.now, guardrails: { actions: OFF } });
  assert.deepEqual(call(s, 'report_unanswered', { question: 'Do you sell gift cards?' }), { ok: true, result: { recorded: true } });
  const docs = () => s.store.listDocs('unanswered').map((x) => x.value);
  assert.equal(docs().length, 1);
  assert.match(docs()[0].id, /^u_[0-9a-f]{16}$/);
  assert.deepEqual({ ...docs()[0], id: undefined }, { id: undefined, ts: c.t, convId: ctxOf().convId, question: 'Do you sell gift cards?', status: 'open' });

  call(s, 'report_unanswered', { question: 'Do you sell gift cards?' });
  call(s, 'report_unanswered', { question: '  Do you sell gift cards?  ' });
  call(s, 'report_unanswered', { question: 'DO YOU SELL GIFT CARDS?' });
  assert.equal(docs().length, 1, 'the same question again is not a second line');
  call(s, 'report_unanswered', { question: 'Do you ship abroad?' });
  assert.equal(docs().length, 2);
  call(s, 'report_unanswered', { question: 'Do you sell gift cards?' }, B_CTX);
  assert.equal(docs().length, 3, 'another visitor asking the same thing is another line');

  // Once the owner has dealt with it, the same question later is a new one (after the retry memory expired).
  const first = docs().find((d) => d.convId === ctxOf().convId && /gift/.test(d.question));
  s.store.putDoc('unanswered', first.id, { ...first, status: 'answered' });
  call(s, 'report_unanswered', { question: 'Do you sell gift cards?' });
  assert.equal(docs().length, 3, 'within a day the retry memory answers: no new line');
  c.tick(25 * 3600 * 1000);
  call(s, 'report_unanswered', { question: 'Do you sell gift cards?' });
  assert.equal(docs().filter((d) => d.status === 'open' && /gift/.test(d.question) && d.convId === ctxOf().convId).length, 1, 'a day later it is a new open line');
});

test('report_unanswered refuses a bad question and writes nothing', () => {
  const s = makeShop({ guardrails: { actions: OFF } });
  for (const args of [{}, { question: '' }, { question: '   ' }, { question: 'x'.repeat(301) }, { question: 5 }, { question: 'ok', extra: 1 }]) {
    assert.equal(call(s, 'report_unanswered', args).error, 'bad_params', JSON.stringify(args));
  }
  assert.equal(s.store.listDocs('unanswered').length, 0);
});

test('a model that cannot answer reports the question through a normal turn, with every other action off', async () => {
  const s = makeShop({
    guardrails: { actions: OFF },
    handler: ({ messages }) => (stepOf(messages) === 0
      ? { toolCalls: [{ name: 'report_unanswered', args: { question: 'Do you do weddings?' } }] }
      : { text: 'I do not know, I noted your question for the shop.' }),
  });
  const out = await s.runner.handleMessage(msg('Do you do weddings?'));
  assert.equal(out.ok, true);
  assert.deepEqual(s.model.calls[0].tools.map((t) => t.function.name), ['report_unanswered']);
  assert.match(s.model.calls[0].system, /report_unanswered/, 'the prompt tells the model to use it');
  const docs = s.store.listDocs('unanswered').map((x) => x.value);
  assert.deepEqual(docs.map((d) => [d.convId, d.question, d.status]), [[out.convId, 'Do you do weddings?', 'open']]);
});

test('erasing a visitor also removes their done lines, unanswered questions and bookings, and nobody else\'s', async () => {
  const c = clock();
  const s = makeShop({ now: c.now, guardrails: { actions: ALL }, agenda: AGENDA });
  const visitor = async (id) => ctxOf({ convId: (await s.runner.handleMessage(msg('hello', { visitorId: id }))).convId, senderKey: id });
  const A = await visitor('visitoraaaaaaaaaa');
  const B = await visitor('visitorbbbbbbbbbb');
  for (const [ctx, slot] of [[A, 's202611030900'], [B, 's202611031000']]) {
    call(s, 'leave_message', { message: `for the shop from ${ctx.senderKey}` }, ctx);
    call(s, 'request_callback', { phone: '+33 6 12 34 56 78' }, ctx);
    call(s, 'book_appointment', { slotId: slot, name: 'Visitor' }, ctx);
    call(s, 'report_unanswered', { question: `question of ${ctx.senderKey}` }, ctx);
    remember(s, ctx, 'first_name', 'Ann');
  }
  const mineOf = (col, ctx) => s.store.listDocs(col).filter((x) => x.value.convId === ctx.convId).length;
  assert.deepEqual(['messages', 'callbacks', 'done', 'unanswered'].map((col) => mineOf(col, A)), [1, 1, 4, 1]);

  const erased = call(s, 'forget_visitor', {}, A);
  assert.deepEqual([erased.ok, erased.result.erased, erased.result.conversations], [true, true, 1]);
  assert.deepEqual(['messages', 'callbacks', 'done', 'unanswered'].map((col) => mineOf(col, A)), [0, 0, 0, 0], 'everything of A is gone');
  assert.deepEqual(['messages', 'callbacks', 'done', 'unanswered'].map((col) => mineOf(col, B)), [1, 1, 4, 1], 'B keeps everything');
  assert.deepEqual(s.calendar.bookings().map((b) => b.id), ['s202611031000'], 'A\'s appointment is cancelled, B\'s stays');
  assert.deepEqual(s.calendar.listSlots('2026-11-03').map((x) => x.time), ['09:00', '11:00']);
  assert.equal(s.actions.visitorOf(A), null);
  assert.ok(s.actions.visitorOf(B));
  assert.equal(s.store.getDoc('conversations', A.convId), null);
  assert.ok(s.store.getDoc('conversations', B.convId));
  assert.deepEqual(logOf(s, A.convId), []);
  assert.ok(logOf(s, B.convId).length > 0);
  assert.equal(call(s, 'book_appointment', { slotId: 's202611030900', name: 'Visitor' }, A).result.booked, true, 'A can book that hour again: the retry memory went with the booking');
});

test('erasing a visitor never fails on a host calendar that cannot cancel', async () => {
  const mine = createMemoryCalendar([{ id: 's1', date: '2026-11-10', time: '10:00' }]);
  const s = makeShop({ guardrails: { actions: ALL }, ports: { calendar: mine } });
  const out = await s.runner.handleMessage(msg('hello', { visitorId: 'visitoraaaaaaaaaa' }));
  const ctx = ctxOf({ convId: out.convId, senderKey: 'visitoraaaaaaaaaa' });
  call(s, 'book_appointment', { slotId: 's1', name: 'Ann' }, ctx);
  assert.doesNotThrow(() => s.actions.eraseVisitor(ctx));
  assert.equal(s.store.getDoc('conversations', out.convId), null);
});
