// The owner's workshop: the fiche is edited as a DRAFT, looked at in a preview, and only goes live through a gate. Every published
// state is a numbered, full version, so any of them can be restored; every change is in a journal.
//
//   draft    what Kaby (or the owner, in the page) edits. The live assistant never sees it.
//   publish  needs: no fact left to validate, the capability sheet read, the checks passed on THIS draft. Then the live fiche is
//            replaced in place (the runner, the budget and the pages all read the same object), so no restart is needed.
//   rollback publishes an old version again as a new one.
//
// Two scopes call it: `owner` (the page, a click) may touch everything; `kaby` (a chat) may not touch what costs money or opens a
// door (caps, limits, allowed sites, switching an action to `auto`, marking a fact as validated): those wait for the owner's click.

import crypto from 'node:crypto';
import { parseFiche } from './fiche.mjs';
import { ACTION_NAMES } from './guardrails.mjs';
import { ACTION_INFO, MEMORY_FIELDS } from './actions.mjs';

const RAW_KEYS = ['slug', 'name', 'language', 'brand', 'identity', 'tone', 'knowledge', 'unknown', 'instructions', 'agenda', 'guardrails'];
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const hashOf = (v) => crypto.createHash('sha256').update(canon(v)).digest('hex').slice(0, 16);
const pickRaw = (raw) => Object.fromEntries(RAW_KEYS.filter((k) => raw[k] !== undefined).map((k) => [k, structuredClone(raw[k])]));
const vId = (n) => `v_${String(n).padStart(6, '0')}`;

// Where a plain `set` may write, and what only the owner's click may change.
const SET_PATHS = [/^(name|language|identity|tone|unknown)$/, /^brand\.(color|greeting)$/, /^agenda\.(enabled|days|from|to|slotMinutes|horizonDays|timezone)$/,
  /^guardrails\.actions\.[a-z_]+$/, /^guardrails\.budget\.(dailyCap|visitorDailyCap|currency|inPerMTok|outPerMTok|charsPerToken|timezone)$/,
  /^guardrails\.limits\.[A-Za-z]+$/, /^guardrails\.(allowedOrigins|enabled|retentionMonths)$/];
const OWNER_ONLY_PATH = /^guardrails\.(budget|limits|allowedOrigins|enabled|retentionMonths)\b/;

const setDeep = (obj, path, value) => {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) { if (!o[k] || typeof o[k] !== 'object' || Array.isArray(o[k])) o[k] = {}; o = o[k]; }
  o[keys.at(-1)] = value;
};

/** Applies edit operations to a copy of `raw`. `{ ok, raw }` or `{ ok: false, error, op }`. */
function applyOps(raw, ops, scope) {
  const next = structuredClone(raw);
  if (!Array.isArray(ops) || !ops.length || ops.length > 50) return { ok: false, error: 'bad_ops' };
  for (const op of ops) {
    if (!op || typeof op !== 'object') return { ok: false, error: 'bad_op' };
    const owner = scope === 'owner';
    if (op.op === 'set') {
      if (typeof op.path !== 'string' || !SET_PATHS.some((re) => re.test(op.path))) return { ok: false, error: 'path_not_allowed', op };
      if (!owner && OWNER_ONLY_PATH.test(op.path)) return { ok: false, error: 'owner_only', op };
      if (!owner && /^guardrails\.actions\./.test(op.path) && op.value === 'auto') return { ok: false, error: 'owner_only', op };
      if (/^guardrails\.actions\./.test(op.path) && !ACTION_NAMES.includes(op.path.split('.')[2])) return { ok: false, error: 'unknown_action', op };
      setDeep(next, op.path, op.value);
    } else if (op.op === 'add_fact') {
      if (typeof op.text !== 'string' || !op.text.trim()) return { ok: false, error: 'bad_op', op };
      if (op.validated === true && !owner) return { ok: false, error: 'owner_only', op };
      next.knowledge = [...(next.knowledge || []), { text: op.text, source: typeof op.source === 'string' ? op.source : '', validated: op.validated === true }];
    } else if (op.op === 'set_fact') {
      const k = (next.knowledge || [])[op.index];
      if (!k) return { ok: false, error: 'no_such_fact', op };
      if (op.validated !== undefined && !owner) return { ok: false, error: 'owner_only', op };
      if (typeof op.text === 'string') { k.text = op.text; if (!owner) k.validated = false; }
      if (op.validated !== undefined) k.validated = op.validated === true;
      if (typeof op.source === 'string') k.source = op.source;
    } else if (op.op === 'remove_fact') {
      if (!(next.knowledge || [])[op.index]) return { ok: false, error: 'no_such_fact', op };
      next.knowledge.splice(op.index, 1);
    } else if (op.op === 'add_instruction') {
      if (typeof op.text !== 'string' || !op.text.trim()) return { ok: false, error: 'bad_op', op };
      next.instructions = [...(next.instructions || []), op.text];
    } else if (op.op === 'remove_instruction') {
      if (!(next.instructions || [])[op.index]) return { ok: false, error: 'no_such_instruction', op };
      next.instructions.splice(op.index, 1);
    } else return { ok: false, error: 'unknown_op', op };
  }
  return { ok: true, raw: next };
}

/**
 * What changed between two fiches, as a list a person can read: `{ path, kind, before, after, risk }`. Risk says how careful the
 * owner has to be: `low` (look and wording), `medium` (what the assistant says or may ask), `high` (money, doors, `auto`).
 */
export function diffFiches(a, b) {
  const out = [];
  const push = (path, before, after, risk) => { if (canon(before) !== canon(after)) out.push({ path, kind: before === undefined ? 'add' : after === undefined ? 'remove' : 'set', before, after, risk }); };
  for (const k of ['name', 'language', 'identity', 'tone', 'unknown']) push(k, a[k], b[k], k === 'unknown' ? 'medium' : 'low');
  push('brand.color', a.brand.color, b.brand.color, 'low');
  push('brand.greeting', a.brand.greeting, b.brand.greeting, 'low');
  const keyed = (list) => new Map(list.map((x) => [x.text, x]));
  const ka = keyed(a.knowledge); const kb = keyed(b.knowledge);
  for (const [text, f] of kb) {
    const old = ka.get(text);
    if (!old) out.push({ path: 'fact', kind: 'add', before: undefined, after: f, risk: f.validated ? 'medium' : 'low' });
    else if (old.validated !== f.validated || old.source !== f.source) out.push({ path: 'fact', kind: 'set', before: old, after: f, risk: 'medium' });
  }
  for (const [text, f] of ka) if (!kb.has(text)) out.push({ path: 'fact', kind: 'remove', before: f, after: undefined, risk: 'medium' });
  const ia = new Set(a.instructions); const ib = new Set(b.instructions);
  for (const i of ib) if (!ia.has(i)) out.push({ path: 'instruction', kind: 'add', before: undefined, after: i, risk: 'medium' });
  for (const i of ia) if (!ib.has(i)) out.push({ path: 'instruction', kind: 'remove', before: i, after: undefined, risk: 'medium' });
  for (const k of Object.keys(a.agenda)) push(`agenda.${k}`, a.agenda[k], b.agenda[k], 'medium');
  const ga = a.guardrails; const gb = b.guardrails;
  const rank = { off: 0, approve: 1, auto: 2 };
  for (const n of ACTION_NAMES) {
    const before = ga.actions[n] || 'off'; const after = gb.actions[n] || 'off';
    if (before !== after) out.push({ path: `action.${n}`, kind: 'set', before, after, risk: after === 'auto' ? 'high' : rank[after] > rank[before] ? 'medium' : 'low' });
  }
  for (const [group, keys] of [['budget', ['dailyCapMicro', 'visitorDailyCapMicro', 'inPerToken', 'outPerToken', 'currency', 'timezone', 'charsPerToken']], ['limits', Object.keys(ga.limits)]]) {
    for (const k of keys) {
      const before = ga[group][k]; const after = gb[group][k];
      if (before === after) continue;
      const raised = typeof before === 'number' && typeof after === 'number' && after > before;
      out.push({ path: `${group}.${k}`, kind: 'set', before, after, risk: raised ? 'high' : 'low' });
    }
  }
  for (const o of gb.allowedOrigins) if (!ga.allowedOrigins.includes(o)) out.push({ path: 'allowedOrigin', kind: 'add', before: undefined, after: o, risk: 'high' });
  for (const o of ga.allowedOrigins) if (!gb.allowedOrigins.includes(o)) out.push({ path: 'allowedOrigin', kind: 'remove', before: o, after: undefined, risk: 'low' });
  push('enabled', ga.enabled, gb.enabled, 'medium');
  push('retentionMonths', ga.retentionMonths, gb.retentionMonths, 'medium');
  return out;
}

/** "What the assistant can really do": the facts the owner reads before publishing, as data (the page words them). */
export function capabilitySheet(fiche, { ordersPort = false } = {}) {
  const g = fiche.guardrails;
  const ready = (needs) => (needs === 'calendar' ? fiche.agenda.enabled : needs === 'orders' ? ordersPort : true);
  const sheet = {
    actions: ACTION_NAMES.map((name) => ({ name, mode: g.actions[name] || 'off', minLevel: ACTION_INFO[name].minLevel, needs: ACTION_INFO[name].needs, ready: ready(ACTION_INFO[name].needs) })),
    memoryFields: MEMORY_FIELDS,
    budget: { currency: g.budget.currency, dailyCapMicro: g.budget.dailyCapMicro, visitorDailyCapMicro: g.budget.visitorDailyCapMicro },
    origins: g.allowedOrigins,
    agenda: fiche.agenda,
    enabled: g.enabled,
    retentionMonths: g.retentionMonths,
  };
  return { ...sheet, hash: hashOf(sheet) };
}

export function createStudio({ store, live, makePreview, runChecks, ordersPort = false, now = Date.now }) {
  const state = () => store.getDoc('studio', 'state');
  const putState = (s) => store.putDoc('studio', 'state', s);
  const version = (n) => store.getDoc('studio', vId(n));
  const journal = (entry) => store.appendLog('journal', { ts: now(), ...entry });
  let previewCache = null; // { hash, service }

  /** Replaces the live fiche's content in place: everything that holds a reference to it sees the new one at once. */
  function applyLive(fiche) {
    for (const k of Object.keys(live)) delete live[k];
    Object.assign(live, fiche);
  }
  const parsed = (raw) => parseFiche(raw);

  function publishRaw(raw, { by, summary, kind }) {
    const st = state();
    const n = (st ? st.published : 0) + 1;
    store.putDoc('studio', vId(n), { n, ts: now(), by, summary: String(summary || '').slice(0, 200), raw });
    putState({ ...(st || {}), published: n, draft: null, reviewed: null, checks: null });
    applyLive(parsed(raw).fiche);
    journal({ kind, by, summary, version: n });
    return n;
  }

  /** Called once at start: the stored published version wins; the seed file only starts a shop that has none. */
  function init(seedRaw) {
    const st = state();
    if (st && version(st.published)) { applyLive(parsed(version(st.published).raw).fiche); return { fromStore: true, version: st.published }; }
    if (!seedRaw) throw new Error('studio: no stored fiche and no seed fiche');
    const raw = pickRaw(seedRaw);
    parsed(raw);
    const n = publishRaw(raw, { by: 'operator', summary: 'first version', kind: 'publish' });
    return { fromStore: false, version: n };
  }

  const publishedRaw = () => version(state().published).raw;
  const draftRaw = () => state().draft || publishedRaw();

  function blockers() {
    const st = state();
    const d = draftRaw();
    const f = parsed(d).fiche;
    const out = [];
    if (!st.draft) out.push({ code: 'no_changes' });
    const open = f.knowledge.filter((k) => !k.validated).length;
    if (open) out.push({ code: 'unvalidated_facts', count: open });
    const sheet = capabilitySheet(f, { ordersPort });
    if (!st.reviewed || st.reviewed.hash !== sheet.hash) out.push({ code: 'not_reviewed' });
    if (!st.checks || st.checks.hash !== hashOf(d)) out.push({ code: 'checks_missing' });
    else if (!st.checks.ok) out.push({ code: 'checks_failed' });
    return out;
  }

  const api = {
    init,
    applyLive,

    status() {
      const st = state();
      const pub = version(st.published);
      const d = draftRaw();
      const f = parsed(d).fiche;
      const diff = diffFiches(parsed(pub.raw).fiche, f);
      const sheet = capabilitySheet(f, { ordersPort });
      return {
        published: { n: st.published, ts: pub.ts, by: pub.by, summary: pub.summary },
        dirty: !!st.draft,
        draft: d,
        warnings: parsed(d).warnings,
        diff,
        sheet,
        reviewed: !!(st.reviewed && st.reviewed.hash === sheet.hash),
        checks: st.checks && st.checks.hash === hashOf(d) ? { ok: st.checks.ok, at: st.checks.at, results: st.checks.results } : null,
        blockers: blockers(),
        versions: store.listDocs('studio').filter((x) => /^v_\d{6}$/.test(x.id)).map((x) => ({ n: x.value.n, ts: x.value.ts, by: x.value.by, summary: x.value.summary })).sort((a, b) => b.n - a.n).slice(0, 30),
        journal: store.readLog('journal', 40).reverse(),
      };
    },

    /** Edits the draft. `{ ok, diff, warnings }`; nothing changes when an operation is refused or a new warning appears. */
    applyOps(ops, { scope = 'kaby', by = scope } = {}) {
      const st = state();
      const before = draftRaw();
      const r = applyOps(before, ops, scope);
      if (!r.ok) return r;
      let p;
      try { p = parsed(r.raw); } catch (e) { return { ok: false, error: 'invalid', message: e.message }; }
      if (p.fiche.slug !== live.slug) return { ok: false, error: 'slug_fixed' };
      const had = new Set(parsed(before).warnings);
      const fresh = p.warnings.filter((w) => !had.has(w));
      if (fresh.length) return { ok: false, error: 'above_ceiling', warnings: fresh };
      if (canon(r.raw) === canon(before)) return { ok: true, unchanged: true, diff: [], warnings: p.warnings };
      putState({ ...st, draft: r.raw });
      const diff = diffFiches(parsed(publishedRaw()).fiche, p.fiche);
      journal({ kind: 'draft', by, summary: diffFiches(parsed(before).fiche, p.fiche).map((d) => d.path).slice(0, 8).join(', ') });
      return { ok: true, diff, warnings: p.warnings };
    },

    discard({ by = 'owner' } = {}) {
      const st = state();
      if (!st.draft) return { ok: true, unchanged: true };
      putState({ ...st, draft: null });
      journal({ kind: 'discard', by, summary: 'draft discarded' });
      return { ok: true };
    },

    /** The owner says they read "what the assistant can really do". It holds for this sheet only: any change to it asks again. */
    review({ by = 'owner' } = {}) {
      const st = state();
      const sheet = capabilitySheet(parsed(draftRaw()).fiche, { ordersPort });
      putState({ ...st, reviewed: { hash: sheet.hash, at: now() } });
      journal({ kind: 'review', by, summary: sheet.hash });
      return { ok: true };
    },

    async check({ by = 'owner' } = {}) {
      const d = draftRaw();
      const results = await runChecks(parsed(d).fiche);
      const ok = results.every((r) => r.ok);
      const st = state();
      putState({ ...st, checks: { hash: hashOf(d), ok, at: now(), results } });
      journal({ kind: 'checks', by, summary: ok ? 'passed' : 'failed' });
      return { ok, results };
    },

    publish({ by = 'owner', summary = '' } = {}) {
      const b = blockers();
      if (b.length) return { ok: false, error: 'blocked', blockers: b };
      const n = publishRaw(draftRaw(), { by, summary: summary || 'published', kind: 'publish' });
      return { ok: true, version: n };
    },

    rollback(n, { by = 'owner' } = {}) {
      const v = Number.isInteger(n) ? version(n) : null;
      if (!v) return { ok: false, error: 'not_found' };
      if (n === state().published) return { ok: false, error: 'already_live' };
      const m = publishRaw(v.raw, { by, summary: `restored version ${n}`, kind: 'rollback' });
      return { ok: true, version: m, restored: n };
    },

    draftRaw,
    publishedRaw,
    diff: () => diffFiches(parsed(publishedRaw()).fiche, parsed(draftRaw()).fiche),

    /** A throw-away service built from the DRAFT, in memory, for the preview. Rebuilt when the draft changes. */
    preview() {
      const d = draftRaw();
      const h = hashOf(d);
      if (!previewCache || previewCache.hash !== h) previewCache = { hash: h, service: makePreview(parsed(d).fiche) };
      return previewCache.service;
    },
    resetPreview() { previewCache = null; },
  };
  return api;
}
