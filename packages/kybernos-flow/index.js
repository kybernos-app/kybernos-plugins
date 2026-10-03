// ═══════════════════════════════════════════════════════════════════════════
// kybernos-flow — moitié hôte : le flux de conversation, SANS patch moteur.
//
// Deux fonctions qui vivaient dans les paquets DSH installés (réécrits sans
// bruit à chaque mise à jour) vivent ici, en plugin :
//   1. auto-continue (`auto-continue.mjs`) — reprise des tours coupés par la
//      limite de tokens de sortie (remplace patch-dsh-auto-continue.mjs) ;
//   2. queue-move (`queue-move.mjs`) — route `/kybernos/queue-move` pour
//      réordonner la file d'attente (remplace patch-dsh-queue-move.mjs) ; la
//      poignée de glisser est dans `client.js`.
//
// La troisième retouche, les droits d'écriture du sous-agent Claude Code
// (`permissionMode`), n'a besoin d'aucun code : c'est un réglage du profil —
// voir docs/handoff/zero-patch-moteur.md.
//
// Aucun import `@deepseek-ai/*` : un plugin lié en `@local/…` ne les résout pas.
// ═══════════════════════════════════════════════════════════════════════════

import { installerAutoContinue } from './auto-continue.mjs'
import { monterRoutes } from './queue-move.mjs'

export const name = 'kybernos-flow'

const dire = (message) => console.log('[kybernos-flow] ' + message)

export function apply (ctx) {
  try {
    installerAutoContinue(ctx)
    dire('auto-continue actif (plafond KYBERNOS_AUTO_CONTINUE_MAX, défaut 3)')
  } catch (erreur) {
    dire('auto-continue non installé : ' + String(erreur?.message ?? erreur))
  }

  const liens = { agents: () => ctx.get('agents'), effect: (fn, etiquette) => ctx.effect(fn, etiquette) }
  const monter = (webServer) => {
    try {
      monterRoutes(webServer, liens)
      dire('route /kybernos/queue-move montée')
    } catch (erreur) {
      dire('route queue-move non montée : ' + String(erreur?.message ?? erreur))
    }
  }
  if (ctx.get('webServer') !== undefined) monter(ctx.get('webServer'))
  else ctx.inject(['webServer'], (hote) => monter(hote.webServer))
}
