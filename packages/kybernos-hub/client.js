// ═══════════════════════════════════════════════════════
// kybernos-hub — client half: a few beacons, nothing else.
//
//   1. as soon as it loads → POST {type:'loading'}  (a GUI was served)
//   2. every TICK_MS it reads the page:
//        · DSH's "Failed to load plugins" screen is up → POST {type:'broken',
//          entries:[the bundles it names]} and stop;
//        · otherwise, after ALIVE_AFTER_MS with the page visible → POST
//          {type:'alive'} and stop.
//
// Why read the page: when a bundle fails to activate, DSH still serves a page and
// this client still runs on it. Measured on a real DSH 0.2.0-rc.2 with a
// sabotaged bundle — a bare "page stayed open" timer reported alive on a broken GUI.
// Everything is wrapped: this file must never be the reason a page fails to load.
// ═══════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-hub',
  factory: () => {
    const NAME = 'kybernos-hub'
    const ROUTE = '/kybernos-hub/beacon'
    const TICK_MS = 2000
    const ALIVE_AFTER_MS = 8000
    const NOM_BUNDLE = /^@[a-z0-9._-]+\/[a-z0-9._-]+$/i

    /**
     * Pure. Reads the text of DSH's failure screen:
     *   "Failed to load plugins\n@local/x\nweb boot: 1 entry did not activate\n@local/x: import failed: …"
     * Returns null when the page is not that screen, else { entrees: [bundle names] }.
     */
    const lireEchec = (texte) => {
      const t = String(texte == null ? '' : texte)
      if (!/Failed to load plugins/i.test(t) && !/entr(y|ies) did not activate/i.test(t)) return null
      const noms = []
      const liste = t.match(/Failed to load plugins\s*\n([\s\S]*?)\n\s*web boot:/i)
      if (liste) for (const l of liste[1].split('\n')) if (NOM_BUNDLE.test(l.trim())) noms.push(l.trim())
      const re = /(@[a-z0-9._-]+\/[a-z0-9._-]+):\s*import failed/gi
      let m
      while ((m = re.exec(t)) !== null) noms.push(m[1])
      return { entrees: [...new Set(noms)].slice(0, 8) }
    }

    const envoyer = (corps) => fetch(ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corps),
      keepalive: true
    }).then((r) => r.json()).catch(() => null)

    const apply = (ctx) => {
      try {
        let bootId = null
        let fini = false
        let ecoule = 0
        const annoncer = async () => {
          const r = await envoyer({ type: 'loading' })
          if (r !== null && r.ok === true && typeof r.bootId === 'string') bootId = r.bootId
        }
        const surveiller = async () => {
          if (fini) return
          ecoule += TICK_MS
          if (bootId === null) return
          const texte = typeof document !== 'undefined' && document.body ? document.body.innerText : ''
          const echec = lireEchec(texte)
          if (echec !== null) {
            const r = await envoyer({ type: 'broken', bootId, entries: echec.entrees })
            if (r !== null && r.ok === true) fini = true
            return
          }
          if (ecoule < ALIVE_AFTER_MS) return
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          const r = await envoyer({ type: 'alive', bootId })
          if (r !== null && r.ok === true) fini = true
        }
        ctx.effect(() => {
          annoncer().catch(() => { /* never blocking */ })
          const minuteur = setInterval(() => { surveiller().catch(() => { /* never blocking */ }) }, TICK_MS)
          return () => { clearInterval(minuteur) }
        }, 'kybernos-hub: boot beacons')
      } catch (e) { /* the hub is optional: swallow */ }
    }

    return { name: NAME, inject: [], apply, __test: { ROUTE, ALIVE_AFTER_MS, TICK_MS, lireEchec } }
  }
})
