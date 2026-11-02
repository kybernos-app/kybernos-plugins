// Puts the pieces together for one shop. `dir: null` keeps everything in memory (tests, scenarios, a first try).

import path from 'node:path';
import { createStore } from './store.mjs';
import { createGovernor } from './budget.mjs';
import { createActions } from './actions.mjs';
import { createRunner } from './runner.mjs';

export function createService({ fiche, model, dir = null, ports = {}, now = Date.now }) {
  const store = createStore({ dir });
  const getGuardrails = () => fiche.guardrails;
  const governor = createGovernor({ guardrails: getGuardrails, store, now, killFile: dir ? path.join(dir, 'KILL') : null });
  const actions = createActions({ store, guardrails: getGuardrails, ports, now });
  const runner = createRunner({ fiche, getGuardrails, model, store, governor, actions, now });
  return { fiche, store, governor, actions, runner };
}
