// ═══════════════════════════════════════════════════════
// kybernos-hub — client half: two beacons, nothing else.
//
//   1. as soon as it loads → POST {type:'loading'}  (a GUI was served)
//   2. after ALIVE_AFTER_MS with the page visible → POST {type:'alive', bootId}
//
// Together they let the host tell "GUI worked" from "GUI died". Everything is
// wrapped: this file must never be the reason a page fails to load.
// ═══════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-hub',
  factory: () => {
    const NAME = 'kybernos-hub'
    const ROUTE = '/kybernos-hub/beacon'
    const ALIVE_AFTER_MS = 8000

    const envoyer = (corps) => fetch(ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corps),
      keepalive: true
    }).then((r) => r.json()).catch(() => null)

    const apply = (ctx) => {
      try {
        let bootId = null
        let vivant = false
        const annoncer = async () => {
          const r = await envoyer({ type: 'loading' })
          if (r !== null && r.ok === true && typeof r.bootId === 'string') bootId = r.bootId
        }
        const confirmer = async () => {
          if (vivant || bootId === null) return
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          const r = await envoyer({ type: 'alive', bootId })
          if (r !== null && r.ok === true) vivant = true
        }
        ctx.effect(() => {
          annoncer().catch(() => { /* never blocking */ })
          const minuteur = setInterval(() => { confirmer().catch(() => { /* never blocking */ }) }, ALIVE_AFTER_MS)
          return () => { clearInterval(minuteur) }
        }, 'kybernos-hub: boot beacons')
      } catch (e) { /* the hub is optional: swallow */ }
    }

    return { name: NAME, inject: [], apply, __test: { ROUTE, ALIVE_AFTER_MS } }
  }
})
