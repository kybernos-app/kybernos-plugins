// The guard-rail block of a fiche: the part the CODE reads, never the model. Whatever a fiche says, every value is clamped to a hard
// ceiling here, an unknown action is dropped (the menu is closed), and a missing value takes a conservative default.
//
// Money is counted in micro-units of the currency (1 EUR = 1_000_000), as integers, so a sum never drifts.

export const ACTION_NAMES = ['leave_message', 'request_callback', 'note_visitor', 'forget_visitor', 'list_slots', 'book_appointment', 'order_status'];
export const MODES = ['off', 'approve', 'auto'];

/** Ceilings no fiche can raise: raising one is a change of the code, not of a setting. */
export const HARD = Object.freeze({
  dailyCap: 20,
  visitorDailyCap: 2,
  maxInputChars: 2000,
  maxOutputTokens: 1000,
  maxToolSteps: 5,
  maxToolCallsPerStep: 4,
  maxHistoryTurns: 20,
  turnTimeoutMs: 60_000,
  maxConcurrentShop: 20,
  maxConcurrentVisitor: 2,
  maxCallSeconds: 1800,
  perIpPerMin: 120,
  perVisitorPerMin: 60,
  perShopPerMin: 1200,
});

const DEFAULTS = Object.freeze({
  enabled: true,
  actions: { leave_message: 'auto', note_visitor: 'auto', forget_visitor: 'auto' },
  budget: { currency: 'EUR', dailyCap: 2, visitorDailyCap: 0.2, inPerMTok: 1, outPerMTok: 4, charsPerToken: 2, timezone: 'UTC' },
  limits: {
    maxInputChars: 1000, maxOutputTokens: 400, maxToolSteps: 3, maxToolCallsPerStep: 3, maxHistoryTurns: 10, turnTimeoutMs: 30_000,
    maxConcurrentShop: 5, maxConcurrentVisitor: 1, maxCallSeconds: 600, perIpPerMin: 20, perVisitorPerMin: 10, perShopPerMin: 120,
  },
  allowedOrigins: [],
  retentionMonths: 12,
});

const num = (v, def, min, max) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : def;
  return Math.min(max, Math.max(min, n));
};

/** `{ value, warnings }`: `value` is always safe to run with, whatever `raw` held. */
export function normaliseGuardrails(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const warnings = [];
  const actions = {};
  for (const [name, mode] of Object.entries(DEFAULTS.actions)) actions[name] = mode;
  for (const [name, mode] of Object.entries(r.actions && typeof r.actions === 'object' ? r.actions : {})) {
    if (!ACTION_NAMES.includes(name)) { warnings.push(`action "${name}" is not in the menu: ignored`); continue; }
    if (!MODES.includes(mode)) { warnings.push(`action "${name}": mode "${mode}" unknown, kept off`); actions[name] = 'off'; continue; }
    actions[name] = mode;
  }
  const b = r.budget && typeof r.budget === 'object' ? r.budget : {};
  const l = r.limits && typeof r.limits === 'object' ? r.limits : {};
  const D = DEFAULTS;
  const value = {
    enabled: r.enabled !== false,
    actions,
    budget: {
      currency: typeof b.currency === 'string' && /^[A-Z]{3}$/.test(b.currency) ? b.currency : D.budget.currency,
      dailyCapMicro: Math.round(num(b.dailyCap, D.budget.dailyCap, 0, HARD.dailyCap) * 1e6),
      visitorDailyCapMicro: Math.round(num(b.visitorDailyCap, D.budget.visitorDailyCap, 0, HARD.visitorDailyCap) * 1e6),
      // Prices are per million tokens in the currency, which is exactly micro-units per token.
      inPerToken: num(b.inPerMTok, D.budget.inPerMTok, 0.000001, 1000),
      outPerToken: num(b.outPerMTok, D.budget.outPerMTok, 0.000001, 1000),
      charsPerToken: num(b.charsPerToken, D.budget.charsPerToken, 1, 8),
      timezone: typeof b.timezone === 'string' && b.timezone ? b.timezone : D.budget.timezone,
    },
    limits: {
      maxInputChars: Math.floor(num(l.maxInputChars, D.limits.maxInputChars, 1, HARD.maxInputChars)),
      maxOutputTokens: Math.floor(num(l.maxOutputTokens, D.limits.maxOutputTokens, 16, HARD.maxOutputTokens)),
      maxToolSteps: Math.floor(num(l.maxToolSteps, D.limits.maxToolSteps, 0, HARD.maxToolSteps)),
      maxToolCallsPerStep: Math.floor(num(l.maxToolCallsPerStep, D.limits.maxToolCallsPerStep, 1, HARD.maxToolCallsPerStep)),
      maxHistoryTurns: Math.floor(num(l.maxHistoryTurns, D.limits.maxHistoryTurns, 0, HARD.maxHistoryTurns)),
      turnTimeoutMs: Math.floor(num(l.turnTimeoutMs, D.limits.turnTimeoutMs, 1000, HARD.turnTimeoutMs)),
      maxConcurrentShop: Math.floor(num(l.maxConcurrentShop, D.limits.maxConcurrentShop, 1, HARD.maxConcurrentShop)),
      maxConcurrentVisitor: Math.floor(num(l.maxConcurrentVisitor, D.limits.maxConcurrentVisitor, 1, HARD.maxConcurrentVisitor)),
      maxCallSeconds: Math.floor(num(l.maxCallSeconds, D.limits.maxCallSeconds, 10, HARD.maxCallSeconds)),
      perIpPerMin: Math.floor(num(l.perIpPerMin, D.limits.perIpPerMin, 1, HARD.perIpPerMin)),
      perVisitorPerMin: Math.floor(num(l.perVisitorPerMin, D.limits.perVisitorPerMin, 1, HARD.perVisitorPerMin)),
      perShopPerMin: Math.floor(num(l.perShopPerMin, D.limits.perShopPerMin, 1, HARD.perShopPerMin)),
    },
    allowedOrigins: Array.isArray(r.allowedOrigins) ? r.allowedOrigins.filter((o) => typeof o === 'string' && /^https?:\/\/[^/\s]+$/.test(o)) : [],
    retentionMonths: Math.floor(num(r.retentionMonths, D.retentionMonths, 1, 36)),
  };
  for (const key of Object.keys(value.limits)) {
    const asked = l[key];
    if (typeof asked === 'number' && key in HARD && asked > HARD[key]) warnings.push(`limits.${key}: ${asked} is above the ceiling, lowered to ${HARD[key]}`);
  }
  if (typeof b.dailyCap === 'number' && b.dailyCap > HARD.dailyCap) warnings.push(`budget.dailyCap: ${b.dailyCap} is above the ceiling, lowered to ${HARD.dailyCap}`);
  if (typeof b.visitorDailyCap === 'number' && b.visitorDailyCap > HARD.visitorDailyCap) warnings.push(`budget.visitorDailyCap: ${b.visitorDailyCap} is above the ceiling, lowered to ${HARD.visitorDailyCap}`);
  return { value, warnings };
}
