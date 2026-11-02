import { parseFiche } from '../core/fiche.mjs';
import { createService } from '../core/service.mjs';
import { scriptedModel } from '../core/scripted.mjs';

export const BASE = {
  slug: 'test-shop',
  name: 'Test Shop',
  language: 'en',
  knowledge: [{ text: 'Open every day.', source: 'owner', validated: true }],
};

export function makeSvc({ guardrails = {}, model, handler, ports = {}, now, dir = null, delayMs = 0 } = {}) {
  const m = model || scriptedModel(handler || (() => ({ text: 'Hello.' })), { delayMs });
  const { fiche } = parseFiche({ ...BASE, guardrails });
  return { ...createService({ fiche, model: m, dir, ports, now }), model: m };
}

let n = 0;
export const msg = (text = 'hi', over = {}) => {
  n += 1;
  const id = over.visitorId || `visitor${String(n).padStart(6, '0')}`;
  return { channel: 'site', senderKey: id, visitorId: id, ip: over.ip || `10.1.${n % 250}.${n % 200}`, text, ...over };
};
