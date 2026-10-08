// ═══════════════════════════════════════════════════════
// dsh-subagent-hermes — provider maison de sous-agent DSH pour la CLI
// Hermes (Nous Research). One-shot `hermes -m <modèle> -z`. Aucun nom de modèle
// en dur : le modèle vient du config/ENV, ou est découvert à l'exécution (un
// modèle `:free` du portail Nous — le défaut du portail est cassé/payant).
// Compte Nous requis (login `hermes model`). Façade : ../fabriquer-provider.mjs.
// ═══════════════════════════════════════════════════════

import { fabriquerProvider } from '../fabriquer-provider.mjs'
import { trouverModeleFree } from '../noyau.mjs'
import { argv } from './argv.js'

export { argv }

export const INFERENCE_DEFAUT = 'https://inference-api.nousresearch.com/v1'

export const { name, inject, Config, apply } = fabriquerProvider({
  nomModule: 'subagent-hermes',
  produit: 'Hermes',
  defautNom: 'hermes',
  bin: 'hermes',
  argv,
  // Découvre un modèle gratuit du portail à l'exécution (jamais en dur).
  resoudreModel: async ({ baseUrl }) => await trouverModeleFree(baseUrl && baseUrl !== '' ? baseUrl : INFERENCE_DEFAUT)
})
