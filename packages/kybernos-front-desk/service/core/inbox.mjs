// What the owner does with a conversation: take it over, answer in it, hand it back, mark it read. While a conversation is in
// `human` mode the runner keeps the visitor's messages and does not call the model (see runner.mjs), so the owner is never talking
// over the assistant. `deliver` pushes the owner's words to a visitor who is not on the site (Telegram); the site visitor's page
// reads them with `since`.

const MAX_REPLY = 2000;
const clean = (t) => String(t == null ? '' : t).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();

export function createInbox({ store, now = Date.now, deliver = null }) {
  const log = (convId) => `conv_${convId.slice(2)}`;
  const meta = (convId) => store.getDoc('conversations', convId);
  const save = (m) => store.putDoc('conversations', m.id, m);

  return {
    /** `{ ok, mode }`. The owner can take over or hand back at any time; a hand back tells the visitor nothing by itself. */
    setMode(convId, mode) {
      const m = meta(convId);
      if (!m) return { ok: false, error: 'not_found' };
      if (mode !== 'human' && mode !== 'agent') return { ok: false, error: 'bad_mode' };
      m.mode = mode;
      save(m);
      return { ok: true, mode };
    },

    /** The owner writes to the visitor. Taking over is implied: the assistant stays quiet until it is handed back. */
    async reply(convId, text) {
      const m = meta(convId);
      if (!m) return { ok: false, error: 'not_found' };
      const body = clean(text).slice(0, MAX_REPLY);
      if (!body) return { ok: false, error: 'empty' };
      const joined = m.mode !== 'human';
      m.mode = 'human';
      m.unread = 0;
      m.lastAt = now();
      m.preview = body.slice(0, 80);
      save(m);
      store.appendLog(log(convId), { ts: now(), role: 'owner', text: body, ...(joined ? { first: true } : {}) });
      let delivered = m.channel === 'site';
      if (m.channel !== 'site' && deliver) {
        try { delivered = !!(await deliver(m, body)); } catch { delivered = false; }
      }
      return { ok: true, mode: 'human', delivered };
    },

    markRead(convId) {
      const m = meta(convId);
      if (!m) return { ok: false, error: 'not_found' };
      m.unread = 0;
      save(m);
      return { ok: true };
    },

    /** What a site visitor's page asks for every few seconds: the assistant's and the owner's words after `after`, and the mode. */
    since(convId, after) {
      const m = meta(convId);
      if (!m) return { mode: 'agent', messages: [] };
      const messages = store.readLog(log(convId), 200)
        .filter((e) => (e.role === 'assistant' || e.role === 'owner') && e.ts > after)
        .map((e) => ({ ts: e.ts, role: e.role, text: e.text }));
      return { mode: m.mode || 'agent', messages };
    },

    /** Conversations that need the owner: unread messages in a taken-over conversation. */
    waiting() {
      return store.listDocs('conversations').map((c) => c.value).filter((c) => c.mode === 'human' && (c.unread || 0) > 0).length;
    },
  };
}
