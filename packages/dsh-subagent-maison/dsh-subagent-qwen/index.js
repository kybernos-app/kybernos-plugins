// ═══════════════════════════════════════════════════════
// dsh-subagent-qwen — provider maison de sous-agent DSH pour la CLI
// Qwen Code. One-shot « CLI qui écrit sur stdout puis sort ».
// Façade commune : ../fabriquer-provider.mjs. Aucun modèle en dur (./argv.js).
// ═══════════════════════════════════════════════════════

import { fabriquerProvider } from '../fabriquer-provider.mjs'
import { argv } from './argv.js'

export { argv }

export const { name, inject, Config, apply } = fabriquerProvider({
  nomModule: 'subagent-qwen',
  produit: 'Qwen Code',
  defautNom: 'qwen',
  bin: 'qwen',
  argv
})
