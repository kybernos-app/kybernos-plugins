// Puts the pieces together for one shop. `dir: null` keeps everything in memory (tests, scenarios, a first try).
// `fiche` is the LIVE fiche object: publishing a new version replaces its content in place (see studio.mjs), so the runner, the
// budget governor, the actions and the pages all follow without a restart.

import path from 'node:path';
import { createStore } from './store.mjs';
import { createGovernor } from './budget.mjs';
import { createActions } from './actions.mjs';
import { createRunner } from './runner.mjs';
import { createInbox } from './inbox.mjs';
import { createStudio } from './studio.mjs';
import { createStoreCalendar } from './agenda.mjs';

const PREVIEW_CAP_MICRO = 500_000;

/** The default publish gate: the five scenarios, then checks on the draft itself. Loaded on use: scenarios.mjs builds services too. */
async function defaultChecks(fiche) {
  const { runPublishChecks } = await import('./scenarios.mjs');
  return runPublishChecks(fiche);
}

export function createService({ fiche, model, dir = null, ports = {}, now = Date.now, deliver = null, previewModel = model, runChecks = defaultChecks }) {
  const store = createStore({ dir });
  const getGuardrails = () => fiche.guardrails;
  const governor = createGovernor({ guardrails: getGuardrails, store, now, killFile: dir ? path.join(dir, 'KILL') : null });
  // The built-in agenda unless the caller brings its own calendar. It offers nothing until the fiche's agenda is switched on.
  const calendar = ports.calendar || createStoreCalendar({ store, agenda: () => fiche.agenda, now });
  const allPorts = { ...ports, calendar };
  const actions = createActions({ store, guardrails: getGuardrails, ports: allPorts, now });
  const runner = createRunner({ fiche, getGuardrails, model, store, governor, actions, now });
  const inbox = createInbox({ store, now, deliver });

  /** What the Atelier's preview talks to: the DRAFT, in memory, with a small cap of its own, so trying never touches real data or the real ledger. */
  const makePreview = (draftFiche) => {
    const small = { ...draftFiche, guardrails: { ...draftFiche.guardrails, budget: { ...draftFiche.guardrails.budget, dailyCapMicro: Math.min(draftFiche.guardrails.budget.dailyCapMicro, PREVIEW_CAP_MICRO) } } };
    return createService({ fiche: small, model: previewModel, dir: null, ports: ports.orders ? { orders: ports.orders } : {}, now, runChecks });
  };
  const studio = createStudio({ store, live: fiche, makePreview, runChecks, ordersPort: !!ports.orders, now });

  return { fiche, store, governor, actions, runner, inbox, studio, calendar };
}
