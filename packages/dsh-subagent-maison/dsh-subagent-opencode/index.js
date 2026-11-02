// ═══════════════════════════════════════════════════════
// dsh-subagent-opencode — provider maison de sous-agent DSH pour la CLI
// OpenCode. One-shot « CLI qui écrit sur stdout puis sort ».
// Façade commune : ../fabriquer-provider.mjs. Aucun modèle en dur (./argv.js).
// ═══════════════════════════════════════════════════════

import { fabriquerProvider } from '../fabriquer-provider.mjs'
import { argv } from './argv.js'

export { argv }

export const { name, inject, Config, apply } = fabriquerProvider({
  nomModule: 'subagent-opencode',
  produit: 'OpenCode',
  defautNom: 'opencode',
  bin: 'opencode',
  argv
})
