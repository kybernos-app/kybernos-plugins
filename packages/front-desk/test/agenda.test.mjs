// The built-in agenda: the fiche's `agenda` block (defaults and clamps), the free slots it computes from opening hours in the shop's
// time zone, and the two actions that use it (list_slots, book_appointment). The clock is injected: "now" is Monday 2 Nov 2026, 10:00 UTC.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFiche } from '../core/fiche.mjs';
import { createMemoryCalendar } from '../core/actions.mjs';
import { makeShop, clock, ctxOf } from './helpers-shop.mjs';
import { BASE } from './helpers.mjs';

const ON = { list_slots: 'auto', book_appointment: 'auto' };
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const times = (slots) => slots.map((s) => s.time);
const call = (s, name, args, ctx = ctxOf()) => s.actions.execute({ name, args, ctx });
const toolNames = (s, level = 1) => s.actions.describe({ level }).map((t) => t.function.name);

const agendaOf = (raw) => parseFiche({ ...BASE, agenda: raw }).fiche.agenda;
const DEFAULT_AGENDA = { enabled: false, days: [2, 3, 4, 5, 6], from: '09:00', to: '18:00', slotMinutes: 30, horizonDays: 14, timezone: 'UTC' };

test('the fiche agenda is off by default and every value is clamped to something the agenda can run with', () => {
  assert.deepEqual(agendaOf(undefined), DEFAULT_AGENDA);
  for (const junk of [null, [], 'yes', 42, true]) assert.deepEqual(agendaOf(junk), DEFAULT_AGENDA, `a ${typeof junk} is not an agenda`);

  assert.equal(agendaOf({ enabled: true }).enabled, true);
  for (const nope of ['true', 1, 'yes', {}]) assert.equal(agendaOf({ enabled: nope }).enabled, false, `${JSON.stringify(nope)} does not switch it on`);

  const slot = (v) => agendaOf({ slotMinutes: v }).slotMinutes;
  assert.deepEqual([5, 10, 45.9, 240, 9999, -1].map(slot), [10, 10, 45, 240, 240, 10]);
  assert.deepEqual(['x', NaN, Infinity, null, undefined].map(slot), [30, 30, 30, 30, 30], 'not a finite number: the default');
  const horizon = (v) => agendaOf({ horizonDays: v }).horizonDays;
  assert.deepEqual([0, 1, 14.9, 60, 61, -3].map(horizon), [1, 1, 14, 60, 60, 1]);
  assert.equal(horizon('7'), 14);

  for (const bad of ['8:00', '24:00', '09:60', 'nine', 900, null]) assert.equal(agendaOf({ from: bad }).from, '09:00', `from ${JSON.stringify(bad)}`);
  assert.deepEqual([agendaOf({ from: '07:30', to: '19:45' }).from, agendaOf({ from: '07:30', to: '19:45' }).to], ['07:30', '19:45']);
  assert.equal(agendaOf({ from: '10:00', to: '09:00' }).to, '10:00', 'closing before opening: no hours at all, never a negative range');
  assert.equal(agendaOf({ to: '08:00' }).to, '09:00', 'same against the default opening time');

  assert.deepEqual(agendaOf({ days: [5, 2, 2, 9, -1, 1.5, '3', 0] }).days, [0, 2, 5], 'deduplicated, sorted, only integers 0 to 6');
  assert.deepEqual(agendaOf({ days: [] }).days, [], 'an explicit empty list means closed every day');
  assert.deepEqual(agendaOf({ days: '1' }).days, DEFAULT_AGENDA.days);

  assert.equal(agendaOf({ timezone: 'Europe/Paris' }).timezone, 'Europe/Paris');
  for (const bad of ['Mars/Olympus', '', 123, null]) assert.equal(agendaOf({ timezone: bad }).timezone, 'UTC', `timezone ${JSON.stringify(bad)}`);
});

test('slots follow the days, the opening hours, the slot length and the horizon', () => {
  const c = clock();
  const s = makeShop({ now: c.now, agenda: { enabled: true, days: [2, 4], from: '09:00', to: '11:30', slotMinutes: 45, horizonDays: 14 } });
  const tue = s.calendar.listSlots('2026-11-03');
  assert.deepEqual(times(tue), ['09:00', '09:45', '10:30'], 'a slot has to end by closing time: 11:15 would end at 12:00');
  assert.deepEqual(tue[0], { id: 's202611030900', date: '2026-11-03', time: '09:00' });
  assert.deepEqual(times(s.calendar.listSlots('2026-11-05')), ['09:00', '09:45', '10:30'], 'Thursday is open too');
  assert.deepEqual(s.calendar.listSlots('2026-11-04'), [], 'Wednesday is not an open day');
  assert.deepEqual(s.calendar.listSlots('2026-11-02'), [], 'nor is today, Monday');
  assert.deepEqual(s.calendar.listSlots('2026-10-27'), [], 'a past Tuesday is gone');
  assert.equal(s.calendar.listSlots('2026-11-10').length, 3, 'next week\'s Tuesday is inside the horizon');
  assert.deepEqual(s.calendar.listSlots('2026-11-17'), [], 'the Tuesday 15 days away is beyond the 14-day horizon');

  const near = makeShop({ now: c.now, agenda: { enabled: true, days: EVERY_DAY, from: '09:00', to: '10:00', slotMinutes: 60, horizonDays: 3 } });
  assert.equal(near.calendar.listSlots('2026-11-05').length, 1, 'three days ahead is inside the horizon');
  assert.equal(near.calendar.listSlots('2026-11-06').length, 0, 'four days ahead is outside');
});

test('today only offers what is still ahead, in the shop\'s own time zone', () => {
  const c = clock(); // Monday 10:00 UTC
  const s = makeShop({ now: c.now, agenda: { enabled: true, days: EVERY_DAY, from: '09:00', to: '13:00', slotMinutes: 60, horizonDays: 5 } });
  assert.deepEqual(times(s.calendar.listSlots('2026-11-02')), ['11:00', '12:00'], 'the 10:00 slot starts now: it is no longer offered');
  assert.equal(s.calendar.listSlots('2026-11-03').length, 4, 'tomorrow is complete');
  c.tick(61 * 60_000); // 11:01
  assert.deepEqual(times(s.calendar.listSlots('2026-11-02')), ['12:00']);

  // 23:30 UTC on 2 Nov is 12:30 on 3 Nov in Auckland (UTC+13): "today" there is already the 3rd.
  const late = clock(Date.UTC(2026, 10, 2, 23, 30));
  const hours = { enabled: true, days: EVERY_DAY, from: '09:00', to: '15:00', slotMinutes: 60, horizonDays: 5 };
  const nz = makeShop({ now: late.now, agenda: { ...hours, timezone: 'Pacific/Auckland' } });
  assert.deepEqual(times(nz.calendar.listSlots('2026-11-03')), ['13:00', '14:00']);
  assert.deepEqual(nz.calendar.listSlots('2026-11-02'), [], 'the 2nd is already yesterday in Auckland');
  const utc = makeShop({ now: late.now, agenda: hours });
  assert.deepEqual(times(utc.calendar.listSlots('2026-11-03')), ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00']);
  assert.deepEqual(utc.calendar.listSlots('2026-11-02'), [], 'in UTC it is 23:30: nothing is left today');
});

test('a malformed date offers nothing, and a day that does not exist is not turned into another one', () => {
  const c = clock();
  const s = makeShop({ now: c.now, guardrails: { actions: ON }, agenda: { enabled: true, days: EVERY_DAY, from: '09:00', to: '10:00', slotMinutes: 60, horizonDays: 60 } });
  for (const bad of ['', 'tomorrow', '2026-11-3', '2026-13-01', '2026-11-03T10:00', null, undefined, 20261103]) {
    assert.deepEqual(s.calendar.listSlots(bad), [], String(bad));
  }
  // 31 November is not a day: it must not behave as 1 December (an alias would let one real slot be booked twice).
  assert.deepEqual(s.calendar.listSlots('2026-11-31'), []);
  assert.equal(s.calendar.listSlots('2026-12-01').length, 1);
  const real = call(s, 'book_appointment', { slotId: 's202612010900', name: 'Ann' });
  assert.equal(real.result.booked, true);
  const alias = call(s, 'book_appointment', { slotId: 's202611310900', name: 'Bob' }, ctxOf({ convId: 'c_bbbbbbbbbbbbbbbbbbbbbbbb', senderKey: 'visitorbbbbbb' }));
  assert.deepEqual([alias.result.booked, alias.result.error], [false, 'no_such_slot']);
  assert.deepEqual(s.calendar.bookings().map((b) => [b.id, b.name]), [['s202612010900', 'Ann']], 'one booking for that hour, not two');
});

test('list_slots and book_appointment: a booked slot disappears, nobody can book it twice, a repeat is not a second booking', () => {
  const c = clock();
  const s = makeShop({ now: c.now, guardrails: { actions: ON }, agenda: { enabled: true, days: [2], from: '09:00', to: '12:00', slotMinutes: 60, horizonDays: 14 } });
  const listed = call(s, 'list_slots', { date: '2026-11-03' });
  assert.deepEqual(listed.result.slots.map((x) => x.id), ['s202611030900', 's202611031000', 's202611031100']);

  const a = call(s, 'book_appointment', { slotId: 's202611030900', name: 'Ann' });
  assert.deepEqual([a.ok, a.result.booked, a.result.slot], [true, true, { id: 's202611030900', date: '2026-11-03', time: '09:00' }]);
  assert.deepEqual(call(s, 'list_slots', { date: '2026-11-03' }).result.slots.map((x) => x.time), ['10:00', '11:00'], 'the booked slot is gone from the list');

  call(s, 'book_appointment', { slotId: 's202611030900', name: 'Ann' });
  assert.equal(s.calendar.bookings().length, 1, 'the same call again does not book again');
  const other = ctxOf({ convId: 'c_bbbbbbbbbbbbbbbbbbbbbbbb', senderKey: 'visitorbbbbbb' });
  const taken = call(s, 'book_appointment', { slotId: 's202611030900', name: 'Bob' }, other);
  assert.deepEqual([taken.result.booked, taken.result.error], [false, 'taken'], 'another visitor cannot take it');
  const sameConv = call(s, 'book_appointment', { slotId: 's202611030900', name: 'Ann Two' });
  assert.deepEqual([sameConv.result.booked, sameConv.result.error], [false, 'taken'], 'nor can the same visitor under another name');
  assert.deepEqual(s.calendar.bookings().map((b) => [b.id, b.name, b.convId]), [['s202611030900', 'Ann', ctxOf().convId]]);

  for (const slotId of ['s202611030930', 's202611040900', 's202611010900', 's1', 's202611031200']) {
    const r = call(s, 'book_appointment', { slotId, name: 'Eve' }, other);
    assert.deepEqual([r.result.booked, r.result.error], [false, 'no_such_slot'], `${slotId}: not on the agenda (off the grid, closed day, past, unknown, after closing)`);
  }
  assert.equal(call(s, 'book_appointment', { slotId: 'not a slot!', name: 'Eve' }, other).error, 'bad_params');
  assert.equal(s.calendar.bookings().length, 1);
});

test('cancel frees the slot and forgets the retry memory, so the same booking can be made again', () => {
  const c = clock();
  const s = makeShop({ now: c.now, guardrails: { actions: ON }, agenda: { enabled: true, days: [2], from: '09:00', to: '11:00', slotMinutes: 60, horizonDays: 14 } });
  const args = { slotId: 's202611030900', name: 'Ann' };
  call(s, 'book_appointment', args);
  const booking = s.store.getDoc('bookings', 's202611030900');
  assert.ok(booking.keyId);
  assert.ok(s.store.getDoc('booking_keys', booking.keyId), 'the calendar remembers the key');
  assert.ok(s.store.getDoc('idem', booking.keyId), 'and so does the actions layer, under the same key');

  assert.equal(s.calendar.cancel('s202611030900'), true);
  assert.deepEqual(times(s.calendar.listSlots('2026-11-03')), ['09:00', '10:00'], 'the slot is free again');
  assert.equal(s.store.getDoc('booking_keys', booking.keyId), null);
  assert.equal(s.store.getDoc('idem', booking.keyId), null);
  assert.equal(s.calendar.bookings().length, 0);

  c.tick();
  const again = call(s, 'book_appointment', args);
  assert.equal(again.result.booked, true, 'the very same call is a new try, not a stale answer');
  assert.deepEqual(s.calendar.bookings().map((b) => [b.id, b.ts]), [['s202611030900', c.t]], 'and the slot really is booked again, now');

  assert.equal(s.calendar.cancel('s202611031000'), false, 'nothing booked there');
  for (const junk of ['garbage', '', undefined, null, 42, 's1']) assert.equal(s.calendar.cancel(junk), false, String(junk));
  assert.equal(s.calendar.cancel('s202611030900'), true);
  assert.equal(s.calendar.cancel('s202611030900'), false, 'a second cancel finds nothing');
});

test('calendar.book called twice with one key gives the first answer back and never a second booking', () => {
  const c = clock();
  const s = makeShop({ now: c.now, agenda: { enabled: true, days: [2], from: '09:00', to: '12:00', slotMinutes: 60, horizonDays: 14 } });
  const first = s.calendar.book({ slotId: 's202611030900', name: 'Ann', key: 'k1', convId: 'c_x' });
  const retry = s.calendar.book({ slotId: 's202611031000', name: 'Ann', key: 'k1', convId: 'c_x' });
  assert.deepEqual(retry, first);
  assert.deepEqual(s.calendar.bookings().map((b) => b.id), ['s202611030900']);
});

test('a disabled agenda offers nothing, and its tools are not offered even when the actions are on', () => {
  const c = clock();
  const s = makeShop({ now: c.now, guardrails: { actions: ON }, agenda: { enabled: false, days: [2], from: '09:00', to: '12:00', slotMinutes: 60, horizonDays: 14 } });
  assert.equal(s.calendar.enabled(), false);
  assert.deepEqual(s.calendar.listSlots('2026-11-03'), []);
  const names = toolNames(s);
  assert.ok(!names.includes('list_slots') && !names.includes('book_appointment'), names.join());
  assert.equal(call(s, 'list_slots', { date: '2026-11-03' }).ok, false);
  const refused = call(s, 'book_appointment', { slotId: 's202611030900', name: 'Ann' });
  assert.equal(refused.ok, false);
  assert.deepEqual(s.calendar.bookings(), []);
  assert.equal(s.store.listDocs('done').length, 0);

  // The calendar reads the LIVE fiche: when a publication switches the agenda on, the tools appear without a restart.
  s.fiche.agenda.enabled = true;
  assert.equal(s.calendar.enabled(), true);
  assert.ok(toolNames(s).includes('list_slots') && toolNames(s).includes('book_appointment'));
  assert.equal(call(s, 'book_appointment', { slotId: 's202611030900', name: 'Ann' }).result.booked, true);
  // ...and switching it off again hides the slots, and refuses a booking, even with bookings in the book.
  s.fiche.agenda.enabled = false;
  assert.deepEqual(s.calendar.listSlots('2026-11-03'), []);
  assert.equal(call(s, 'book_appointment', { slotId: 's202611031000', name: 'Bob' }, ctxOf({ convId: 'c_bbbbbbbbbbbbbbbbbbbbbbbb' })).ok, false);
});

test('an action that is switched off stays off with the agenda on, and a calendar brought by the host replaces the built-in one', () => {
  const c = clock();
  const off = makeShop({ now: c.now, guardrails: { actions: { list_slots: 'off', book_appointment: 'auto' } }, agenda: { enabled: true, days: [2], from: '09:00', to: '10:00', slotMinutes: 60, horizonDays: 14 } });
  assert.deepEqual(toolNames(off).filter((n) => /slots|appointment/.test(n)), ['book_appointment']);
  const mine = createMemoryCalendar([{ id: 's1', date: '2026-11-10', time: '10:00' }]);
  const host = makeShop({ now: c.now, guardrails: { actions: ON }, ports: { calendar: mine } });
  assert.equal(host.calendar, mine);
  assert.deepEqual(call(host, 'list_slots', { date: '2026-11-10' }).result.slots, [{ id: 's1', date: '2026-11-10', time: '10:00' }], 'the fiche agenda being off does not hide a host calendar');
});
