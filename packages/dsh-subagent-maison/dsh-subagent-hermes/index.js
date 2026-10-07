// ═══════════════════════════════════════════════════════
// dsh-subagent-hermes — provider maison de sous-agent DSH pour la CLI
// Hermes (Nous Research). One-shot `hermes -z PROMPT` (hermes-agent 0.21 n'a
// pas de mode `serve`). Façade commune : ../fabriquer-provider.mjs.
// Aucun modèle en dur. Nécessite une auth hermes (`hermes model`).
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
