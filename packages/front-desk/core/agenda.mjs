// A small built-in agenda: free slots computed from the shop's opening hours (the fiche's `agenda` block), bookings kept in the
// store. A slot is a wall-clock date and time of the shop, so there is no time-zone arithmetic beyond knowing what "now" is there.
// It implements the same port as createMemoryCalendar (listSlots, book, bookings) plus `cancel`, which the Boîte's Undo uses.

import { idFor } from './store.mjs';

const pad = (n) => String(n).padStart(2, '0');
const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
// Lower-case and digits only, so the id is also a valid store id.
const slotIdOf = (date, time) => `s${date.replace(/-/g, '')}${time.replace(':', '')}`;
const SLOT_ID = /^s(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/;
// A real calendar day: `Date.parse` rolls "2026-11-31" over to 1 December, which would let one hour be booked under two ids.
const isRealDate = (date) => {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const t = Date.parse(`${date}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === date;
};

export function createStoreCalendar({ store, agenda, now = Date.now }) {
  /** The shop's current date (YYYY-MM-DD) and minute of the day, in the agenda's time zone. */
  function localNow() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: agenda().timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now()));
    const get = (type) => parts.find((p) => p.type === type).value;
    return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
  }
  const dayNumber = (date) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

  /** Every slot the opening hours allow on `date`, past ones and days outside the window excluded. */
  function slotsOn(date) {
    const a = agenda();
    if (!a.enabled || !isRealDate(date)) return [];
    const { date: today, minutes: nowMin } = localNow();
    const ahead = dayNumber(date) - dayNumber(today);
    if (ahead < 0 || ahead > a.horizonDays) return [];
    if (!a.days.includes(new Date(`${date}T00:00:00Z`).getUTCDay())) return [];
    const out = [];
    for (let m = toMin(a.from); m + a.slotMinutes <= toMin(a.to); m += a.slotMinutes) {
      if (ahead === 0 && m <= nowMin) continue;
      out.push({ id: slotIdOf(date, toHhmm(m)), date, time: toHhmm(m) });
    }
    return out;
  }
  const dateOfId = (id) => { const m = SLOT_ID.exec(id); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };

  return {
    enabled: () => agenda().enabled,

    listSlots: (date) => slotsOn(date).filter((s) => !store.getDoc('bookings', s.id)),

    /** Books one still-free slot for `name`. A repeated `key` (a retry) gets the first answer back, never a second booking. */
    book({ slotId, name, key, convId }) {
      const seen = key ? store.getDoc('booking_keys', idFor(key)) : null;
      if (seen) return seen.outcome;
      const date = dateOfId(slotId);
      const slot = date && slotsOn(date).find((s) => s.id === slotId);
      if (!slot) return { ok: false, error: 'no_such_slot' };
      if (store.getDoc('bookings', slot.id)) return { ok: false, error: 'taken' };
      store.putDoc('bookings', slot.id, { id: slot.id, date: slot.date, time: slot.time, name, convId: convId || null, ts: now(), keyId: key ? idFor(key) : null });
      const outcome = { ok: true, slot };
      if (key) store.putDoc('booking_keys', idFor(key), { outcome });
      return outcome;
    },

    /** Frees the slot. The retry memory of that booking goes too (the actions layer keeps its own under the same key), so a repeat is a new try. */
    cancel(slotId) {
      if (typeof slotId !== 'string' || !SLOT_ID.test(slotId)) return false;
      const b = store.getDoc('bookings', slotId);
      if (!b) return false;
      if (b.keyId) { store.delDoc('booking_keys', b.keyId); store.delDoc('idem', b.keyId); }
      return store.delDoc('bookings', slotId);
    },

    bookings: () => store.listDocs('bookings').map((b) => b.value).sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}
