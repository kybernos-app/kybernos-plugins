// ═══════════════════════════════════════════════════════
// dsh-subagent-hermes — provider maison de sous-agent DSH pour la CLI
// Hermes (Nous Research). One-shot prompt ; le mode `hermes serve` (backend
// headless) reste à câbler quand la CLI sera installée (non testé ici).
// Façade commune : ../fabriquer-provider.mjs. Aucun modèle en dur.
// ═══════════════════════════════════════════════════════

import { fabriquerProvider } from '../fabriquer-provider.mjs'
import { argv } from './argv.js'

export { argv }

export const { name, inject, Config, apply } = fabriquerProvider({
  nomModule: 'subagent-hermes',
  produit: 'Hermes',
  defautNom: 'hermes',
  bin: 'hermes',
  argv
})
