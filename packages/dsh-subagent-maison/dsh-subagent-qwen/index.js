// ═══════════════════════════════════════════════════════
// dsh-subagent-qwen — provider maison de sous-agent DSH pour la CLI
// Qwen Code (Token Plan Alibaba). One-shot `qwen -y -p`. Clé lue à
// l'exécution (DASHSCOPE_API_KEY / QWEN_TOKEN_PLAN_API_KEY), jamais en dur.
// Façade commune : ../fabriquer-provider.mjs.
// ═══════════════════════════════════════════════════════

import { fabriquerProvider } from '../fabriquer-provider.mjs'
import { argv, BASE_URL_DEFAUT } from './argv.js'

export { argv }

export const { name, inject, Config, apply } = fabriquerProvider({
  nomModule: 'subagent-qwen',
  produit: 'Qwen Code',
  defautNom: 'qwen',
  bin: 'qwen',
  argv,
  envCle: ['QWEN_TOKEN_PLAN_API_KEY', 'DASHSCOPE_API_KEY'],
  baseUrlDefaut: BASE_URL_DEFAUT
})
