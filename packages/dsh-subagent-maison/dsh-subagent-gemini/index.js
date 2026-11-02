// ═══════════════════════════════════════════════════════
// dsh-subagent-gemini — provider maison de sous-agent DSH pour la CLI
// Gemini CLI. One-shot `gemini --skip-trust -y -p`. Auth par CLÉ API
// (GEMINI_API_KEY en env, lue à l'exécution — jamais en dur) : le compte Google
// gratuit est coupé par Google (IneligibleTierError), seule la clé API marche.
// Façade commune : ../fabriquer-provider.mjs.
// ═══════════════════════════════════════════════════════

import { fabriquerProvider } from '../fabriquer-provider.mjs'
import { argv } from './argv.js'

export { argv }

export const { name, inject, Config, apply } = fabriquerProvider({
  nomModule: 'subagent-gemini',
  produit: 'Gemini CLI',
  defautNom: 'gemini',
  bin: 'gemini',
  argv,
  envCle: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  varEnvCle: 'GEMINI_API_KEY'
})
