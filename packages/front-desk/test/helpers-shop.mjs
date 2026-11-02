// Shared by the tests that need a whole shop (service + studio) with an injectable clock. Not a test file: the runner only picks
// `*.test.mjs`.

import { parseFiche } from '../core/fiche.mjs';
import { createService } from '../core/service.mjs';
import { scriptedModel } from '../core/scripted.mjs';
import { BASE } from './helpers.mjs';

/** A manual clock: `now` for the service and the server, `tick` moves it. Starts on Monday 2 November 2026, 10:00 UTC. */
export function clock(start = Date.UTC(2026, 10, 2, 10, 0, 0)) {
  const c = { t: start, now: () => c.t, tick(ms = 1000) { c.t += ms; return c.t; } };
  return c;
}

export const stubChecks = async () => [{ name: 'stub', ok: true, failures: [] }];

/**
 * One shop, in memory unless `dir` is given, with the studio already started on the seed (the way bin/front-desk.mjs does it).
 * `seed` overrides the fiche, `guardrails` and `agenda` are shortcuts for its two blocks.
 */
export function makeShop({ seed = {}, guardrails, agenda, handler, model, ports, now, deliver, previewModel, runChecks, dir = null } = {}) {
  const raw = { ...BASE, ...seed, ...(guardrails ? { guardrails } : {}), ...(agenda ? { agenda } : {}) };
  const m = model || scriptedModel(handler || (() => ({ text: 'Hello.' })));
  const { fiche } = parseFiche(raw);
  const svc = createService({ fiche, model: m, dir, ports, now, deliver, previewModel, runChecks: runChecks || stubChecks });
  svc.studio.init(raw);
  return { ...svc, model: m, raw };
}

/** The conversation log of a conversation id (`c_…`). */
export const logOf = (svc, convId) => svc.store.readLog(`conv_${convId.slice(2)}`, 1000);

/** A tool context for calling `actions.execute` directly, the way the runner builds it. */
export const ctxOf = (over = {}) => ({ convId: 'c_aaaaaaaaaaaaaaaaaaaaaaaa', channel: 'site', senderKey: 'visitoraaaaaa', level: 1, lang: 'en', ...over });
