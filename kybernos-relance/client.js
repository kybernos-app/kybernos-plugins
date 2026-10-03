// ═══════════════════════════════════════════════════════════════════════════
// kybernos-relance — moitié client : recharger la page au redémarrage de l'hôte.
//
// Problème mesuré le 22/09/2026 (relance de DSH, port 3080) :
//   `dsh-client-modules` donne à chaque ligne du graphe client une révision
//   initiale tirée d'un nonce ALÉATOIRE par processus
//   (`initialRevisionNonce = randomBytes(8).toString("hex")`, lib/index.js:489).
//   Au redémarrage de l'hôte, les 73 lignes changent donc de `rev` :
//   6cc89818a448a1b4-0 → ccef9071360a5eb0-0, mesuré sur /plugins/events.
//   La page vivante reçoit ce graphe, croit chaque plugin reconstruit et
//   recharge tous ses bundles à chaud — l'interface reste NOIRE jusqu'à un F5
//   manuel (le client de DSH ne fait que reconnecter ses flux, jamais
//   `location.reload()`).
//
// Ce plugin écoute le même canal et recharge la page UNE SEULE fois quand la
// quasi-totalité du graphe change, c'est-à-dire un redémarrage. Un rebuild
// unitaire (pnpm run dev:web) ne change qu'une ligne : on laisse le HMR de DSH
// faire son travail, sinon le développement deviendrait un F5 permanent.
// ═══════════════════════════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-relance',
  factory: () => {
    const NAME = 'kybernos-relance'

    /** Part du graphe qui doit changer pour conclure à un redémarrage. */
    const RELOAD_RATIO = 0.5
    /** Garde anti-boucle : jamais deux rechargements rapprochés. */
    const MIN_INTERVAL_MS = 20_000
    /** Mémorisé par onglet (sessionStorage) : survit au rechargement, pas au F5 fermé. */
    const STORAGE_KEY = 'kybernos-relance:dernier-rechargement'

    /** id de plugin → révision, tel que l'hôte le publie. */
    const revisions = (graph) => {
      const rows = graph && Array.isArray(graph.entries) ? graph.entries : []
      const map = new Map()
      for (const row of rows) {
        if (row && typeof row.id === 'string') map.set(row.id, String(row.rev == null ? '' : row.rev))
      }
      return map
    }

    const apply = (ctx) => {
      /** Graphe déjà vu sur CETTE page : `null` tant qu'on n'a rien reçu. */
      let previous = null

      ctx.effect(() => {
        const source = new EventSource('/plugins/events')
        source.addEventListener('message', (event) => {
          try {
            const frame = JSON.parse(event.data)
            if (!frame || frame.type !== 'graph') return
            const next = revisions(frame.graph)
            const before = previous
            previous = next
            // Premier graphe de la page : c'est l'état de référence, rien à faire.
            if (before === null || next.size === 0) return
            let changed = 0
            for (const [id, rev] of next) if (before.get(id) !== rev) changed += 1
            const ratio = changed / Math.max(next.size, before.size || 1)
            if (ratio <= RELOAD_RATIO) return
            const last = Number(sessionStorage.getItem(STORAGE_KEY) || 0)
            if (Date.now() - last < MIN_INTERVAL_MS) return
            sessionStorage.setItem(STORAGE_KEY, String(Date.now()))
            console.info(`[${NAME}] ${String(changed)}/${String(next.size)} révisions ont changé — rechargement de la page`)
            location.reload()
          } catch (error) {
            // Une exception ici ne doit jamais casser la page : on journalise et on continue.
            console.warn(`[${NAME}] trame de graphe ignorée`, error)
          }
        })
        return () => source.close()
      }, 'kybernos-relance: rechargement apres redemarrage de l hote')
    }

    return { name: NAME, inject: [], apply }
  }
})
