// ═══════════════════════════════════════════════════════════════════════════
// kybernos-flow — host half: the conversation flow, WITHOUT an engine patch.
//
// Two functions that used to live in the installed DSH packages (rewritten
// silently at every update) live here, as a plugin:
//   1. auto-continue (`auto-continue.mjs`) — resumes the turns cut short by the
//      output-token limit (replaces patch-dsh-auto-continue.mjs);
//   2. queue-move (`queue-move.mjs`) — the `/kybernos/queue-move` route that
//      reorders the waiting queue (replaces patch-dsh-queue-move.mjs); the
//      drag handle is in `client.js`.
//
// The third tweak, the write rights of the Claude Code sub-agent
// (`permissionMode`), needs no code: it is a profile setting.
//
// No `@deepseek-ai/*` import: a plugin linked as `@local/…` cannot resolve them.
// ═══════════════════════════════════════════════════════════════════════════

import { installerAutoContinue } from './auto-continue.mjs'
import { monterRoutes } from './queue-move.mjs'

export const name = 'kybernos-flow'

const dire = (message) => console.log('[kybernos-flow] ' + message)

export function apply (ctx) {
  try {
    installerAutoContinue(ctx)
    dire('auto-continue on (cap KYBERNOS_AUTO_CONTINUE_MAX, default 3)')
  } catch (erreur) {
    dire('auto-continue not installed: ' + String(erreur?.message ?? erreur))
  }

  const liens = { agents: () => ctx.get('agents'), effect: (fn, etiquette) => ctx.effect(fn, etiquette) }
  const monter = (webServer) => {
    try {
      monterRoutes(webServer, liens)
      dire('route /kybernos/queue-move mounted')
    } catch (erreur) {
      dire('route queue-move not mounted: ' + String(erreur?.message ?? erreur))
    }
  }
  if (ctx.get('webServer') !== undefined) monter(ctx.get('webServer'))
  else ctx.inject(['webServer'], (hote) => monter(hote.webServer))
}
