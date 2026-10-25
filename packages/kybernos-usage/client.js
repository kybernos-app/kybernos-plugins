// kybernos-usage — browser half.
//
// Two surfaces:
//  - a chip under the composer (slot conversation.composer.dock): how much of the plan's window is used when the
//    chat runs on a Kybernos model, or what this session cost on the person's own key; a click opens a card
//    (context window, plan limits, credits, this session);
//  - a Settings page (slot settings.section): the plan as the server sees it, then the person's own keys and
//    local models priced here, by day, by model and by session.
//
// Where the numbers come from, and why there are two sources:
//  - the PLAN comes from the server through /kybernos-cloud/quota and /kybernos-cloud/status. The server counts the
//    plan as a percentage of rolling windows and never shows money: neither does this plugin for a Kybernos model;
//  - OWN KEYS and LOCAL MODELS never pass through the server, so only this machine can count them: tokens come from
//    the session projection `tokenUsage`, are booked by the host (/kybernos-usage/observe) and priced here with the
//    models.dev index kept by @local/kybernos-models.
//
// No engine patch: it reads projections through the props the dock slot hands to a component (useProjection,
// useSessions), the same way the core's usage probe does. Loaded through window.__ModuleLoader__.load; the factory
// RETURNS a plugin object and, on any error, a disabled one, so the GUI is preserved.
window.__ModuleLoader__.load({
  id: '@local/kybernos-usage',
  factory (require) {
    try {
      const React = require('react')
      const h = React.createElement
      const NB = ' '

      // ── language: French is the source, English the pair; a translated language is looked up by its French text ──
      const lang = () => {
        try { return String(typeof window.__KB_LANG_RESOLVE__ === 'function' ? window.__KB_LANG_RESOLVE__() : (document.documentElement.lang || 'en')) } catch (e) { return 'en' }
      }
      const kt = (fr, en) => {
        const l = lang()
        if (l === 'kybernos' || l.slice(0, 2) === 'fr') return fr
        if (l === 'en') return en
        try {
          const a = window.__KB_I18N_ACTIVE__
          if (a !== null && a !== undefined && a.dict !== null && typeof a.dict === 'object' && typeof a.dict[fr] === 'string') return a.dict[fr]
        } catch (e) { /* no dictionary: English */ }
        return en
      }
      const fill = (text, p) => (p === undefined ? text : text.replace(/\{(\w+)\}/g, (m, k) => (p[k] !== undefined ? String(p[k]) : m)))
      // [fr, en] pairs, by key, in ONE table so that a test can check both sides of every pair.
      const S = {
        title: ['Usage', 'Usage'],
        close: ['Fermer', 'Close'],
        context: ['Fenêtre de contexte', 'Context window'],
        planLimits: ['Limites du plan {name}', '{name} plan limits'],
        planLimitsNoName: ['Limites de ton plan', 'Your plan limits'],
        rolling: ['Fenêtres glissantes : l’usage ancien en sort peu à peu.', 'Rolling windows: older use drops out gradually.'],
        credits: ['Crédits restants', 'Credits left'],
        creditsUnit: ['crédits', 'credits'],
        viaPlan: ['Cette session passe par ton plan : elle compte en pourcentage, pas en dollars.', 'This session runs on your plan: it counts as a percentage, not in dollars.'],
        sessionOwn: ['Cette session · {model}', 'This session · {model}'],
        cacheLine: ['{tokens} tokens, dont {pct} lus dans le cache (environ {saved} évités).', '{tokens} tokens, {pct} of them read from the cache (about {saved} saved).'],
        entryNew: ['Entrée neuve', 'New input'],
        cacheRead: ['Cache lu', 'Cache read'],
        cacheWrite: ['Cache écrit', 'Cache write'],
        output: ['Sortie', 'Output'],
        free: ['Gratuit', 'Free'],
        freeLine: ['{model} tourne {where}. {tokens} tokens, sans frais.', '{model} runs {where}. {tokens} tokens, free of charge.'],
        whereLocal: ['sur cette machine', 'on this machine'],
        whereFree: ['sur une offre gratuite', 'on a free offer'],
        priceUnknown: ['Prix inconnu', 'Price unknown'],
        priceUnknownLine: ['{model} n’a pas de prix dans ton catalogue. Ses {tokens} tokens ne sont pas comptés.', '{model} has no price in your catalogue. Its {tokens} tokens are not counted.'],
        noCostTitle: ['Pas encore de coût', 'No cost yet'],
        noCostLine: ['Le coût apparaît après le premier échange avec une de tes clés.', 'The cost appears after the first exchange with one of your keys.'],
        signIn: ['Connecte un compte Kybernos pour voir les limites de ton plan.', 'Sign in to a Kybernos account to see your plan’s limits.'],
        detailHint: ['Détail : Réglages › Usage', 'Detail: Settings › Usage'],
        window5h: ['Fenêtre glissante de {n} h', 'Rolling {n} h window'],
        windowDays: ['{n} jours', '{n} days'],
        windowDays1: ['{n} jour', '{n} day'],
        windowHours: ['{n} h', '{n} h'],
        teamPool: ['Équipe · {w} (partagé)', 'Team · {w} (shared)'],
        resetsIn: ['se libère dans environ {t}', 'frees up in about {t}'],
        gratis: ['gratuit', 'free'],
        pillPlan: ['Usage du plan : {pct}', 'Plan usage: {pct}'],
        pillOwn: ['Coût de cette session avec ta clé : {cost}', 'This session’s cost on your key: {cost}'],

        pageLead: ['Le serveur compte ton plan Kybernos, en pourcentage. Tes propres clés et tes modèles locaux sont calculés sur cet ordinateur : rien n’est envoyé.', 'The server counts your Kybernos plan, as a percentage. Your own keys and local models are worked out on this computer: nothing is sent.'],
        planSec: ['Ton plan Kybernos', 'Your Kybernos plan'],
        planSecSub: ['vu par le serveur', 'as the server sees it'],
        planSolo: ['Plan {name}', '{name} plan'],
        planConnect: ['Connecte un compte Kybernos pour voir ton plan', 'Sign in to a Kybernos account to see your plan'],
        planConnectLine: ['Les limites, les crédits et l’usage des modèles du plan viennent du serveur. Tes propres clés restent suivies ici, avec ou sans compte.', 'The limits, credits and use of the plan’s models come from the server. Your own keys are still tracked here, with or without an account.'],
        planUnavailable: ['Le serveur ne répond pas. Les chiffres du plan reviendront avec lui.', 'The server is not answering. The plan’s figures will come back with it.'],
        ownSec: ['Tes clés et modèles locaux', 'Your keys and local models'],
        ownSecSub: ['calculé sur cette machine', 'worked out on this machine'],
        pToday: ['Aujourd’hui', 'Today'],
        p7: ['7 jours', '7 days'],
        p30: ['30 jours', '30 days'],
        kCost: ['Coût de tes clés', 'Cost on your keys'],
        kTokens: ['Tokens traités', 'Tokens processed'],
        kCache: ['Lu dans le cache', 'Read from cache'],
        kOver: ['sur {n} jours', 'over {n} days'],
        kToday: ['aujourd’hui', 'today'],
        kKeys: ['clés et modèles locaux', 'keys and local models'],
        kSaved: ['environ {saved} évités', 'about {saved} saved'],
        perDay: ['Coût par jour', 'Cost per day'],
        peak: ['pic à {v}', 'peak {v}'],
        where: ['Où part l’argent', 'Where the money goes'],
        byModel: ['Modèles', 'Models'],
        bySession: ['Sessions', 'Sessions'],
        viaPlanChip: ['via le plan', 'on the plan'],
        unknownChip: ['prix inconnu', 'price unknown'],
        freeChip: ['gratuit', 'free'],
        unknownNote: ['Les tokens des modèles sans prix ne sont pas dans le total. Ajoute leur prix dans Modèles pour les compter.', 'Tokens of models without a price are not in the total. Add their price in Models to count them.'],
        beforeNote: ['{tokens} tokens avaient déjà été utilisés avant la première mesure : ils ne sont pas datés et pas dans ces chiffres.', '{tokens} tokens had already been used before the first measure: they are undated and not in these figures.'],
        sinceNote: ['Mesuré depuis le {day}.', 'Measured since {day}.'],
        emptyTitle: ['Aucun usage de tes clés sur cette période', 'No use of your keys in this period'],
        emptyLine: ['Le coût apparaît après le premier message envoyé avec une de tes clés. Les modèles locaux et gratuits sont comptés à 0 $.', 'The cost appears after the first message sent with one of your keys. Local and free models count as $0.'],
        loading: ['Lecture en cours…', 'Reading…'],
        readFail: ['Impossible de lire le journal d’usage.', 'The usage ledger could not be read.'],
        retry: ['Réessayer', 'Retry'],
        budget: ['Budget mensuel de tes clés', 'Monthly budget for your keys'],
        budgetNone: ['Aucun', 'None'],
        budgetUsed: ['{b} · {pct} utilisé', '{b} · {pct} used'],
        budgetLabel: ['Budget', 'Budget'],
        budgetPerMonth: ['$ par mois', '$ per month'],
        budgetAlert: ['Me prévenir à 80 % du budget', 'Warn me at 80% of the budget'],
        budgetNote: ['Le budget prévient, il ne bloque rien. Il ne concerne pas ton plan Kybernos, qui a ses propres limites.', 'The budget warns, it blocks nothing. It does not concern your Kybernos plan, which has its own limits.'],
        budgetOver: ['Budget du mois dépassé : {spent} sur {b}.', 'Monthly budget exceeded: {spent} of {b}.'],
        budgetNear: ['{pct} du budget du mois est utilisé.', '{pct} of this month’s budget is used.'],
        save: ['Enregistrer', 'Save'],
        saved: ['Enregistré', 'Saved'],
        why: ['Pourquoi deux blocs. Le serveur ne voit que les appels qui passent par lui, et il les compte en pourcentage. Tes clés et tes modèles locaux ne passent pas par lui : seul cet ordinateur peut les chiffrer.', 'Why two blocks. The server only sees calls that go through it, and counts them as a percentage. Your keys and local models do not go through it: only this computer can count them.'],
        pageName: ['Usage', 'Usage'],
        pageFor: ['Il couvre tous les modèles utilisés ici : un modèle du plan Kybernos, une clé à toi ou un modèle local. La console Kybernos garde le détail du plan par membre et par jour.', 'It covers every model you use here: a Kybernos plan model, a key of your own or a local model. The Kybernos console keeps the plan’s detail per member and per day.'],
      }
      const L = (key, p) => { const v = S[key]; return v === undefined ? key : fill(kt(v[0], v[1]), p) }

      // ── pure helpers (exposed in __test) ──────────────────────────────────────────────────────────────────────
      const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
      const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null }
      const decimal = (s) => (lang().slice(0, 2) === 'fr' || lang() === 'kybernos' ? s.replace('.', ',') : s)
      // Money, locale-aware (F23): French writes « 5,64 $ », English writes
      // « $5.64 » — the unit follows the locale, not one fixed layout.
      const fmtMoney = (n) => {
        if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
        const fr = lang().slice(0, 2) === 'fr' || lang() === 'kybernos'
        if (n > 0 && n < 0.01) return fr ? decimal('<0,01') + NB + '$' : '<$0.01'
        const amount = decimal(n.toFixed(2))
        return fr ? amount + NB + '$' : '$' + amount
      }
      const fmtTok = (n) => {
        if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
        if (n >= 1e6) return decimal((Math.round(n / 1e4) / 100).toString()) + NB + 'M'
        if (n >= 1e3) return Math.round(n / 1e3) + NB + 'k'
        return String(Math.round(n))
      }
      const fmtPct = (ratio) => Math.round(ratio * 100) + NB + '%'
      const FREE_PROVIDERS = { 'opencode-free': 'free', ollama: 'local', lmstudio: 'local', llamacpp: 'local', 'llama.cpp': 'local', local: 'local' }
      /** The price (USD per million tokens) out of a /kybernos-models/modelsdev `match`, or null. */
      const priceOf = (match) => {
        if (!isObj(match)) return null
        const i = num(match.costIn); const o = num(match.costOut)
        if (i === null && o === null) return null
        return { in: i === null ? 0 : i, out: o === null ? 0 : o, cr: num(match.cacheRead), cw: num(match.cacheWrite) }
      }
      const costOf = (t, p) => (p === null ? null : (t.u * p.in + t.o * p.out + t.cr * (p.cr === null ? p.in : p.cr) + t.cw * (p.cw === null ? p.in : p.cw)) / 1e6)
      const saved = (t, p) => (p === null || p.cr === null ? 0 : t.cr * Math.max(0, p.in - p.cr) / 1e6)
      const splitKey = (key) => { const i = String(key).indexOf('/'); return i < 0 ? { provider: '', model: String(key) } : { provider: key.slice(0, i), model: key.slice(i + 1) } }
      /** plan: a Kybernos model (counted by the server, in percent) · free: local or free offer · priced · unknown. */
      const kindOf = (key, price) => {
        const { provider } = splitKey(key)
        const p = provider.toLowerCase()
        if (p === 'kybernos') return 'plan'
        if (FREE_PROVIDERS[p] !== undefined) return 'free'
        if (price === null || price === undefined) return 'unknown'
        return price.in === 0 && price.out === 0 ? 'free' : 'priced'
      }
      const tsum = (t) => t.u + t.o + t.cr + t.cw
      const zero = () => ({ u: 0, o: 0, cr: 0, cw: 0 })
      const addTo = (a, b) => { a.u += b.u; a.o += b.o; a.cr += b.cr; a.cw += b.cw; return a }
      /**
       * Prices a /kybernos-usage/summary. `prices` maps "provider/model" to a price or null. Plan tokens are counted
       * but never priced; unknown-price tokens are counted apart so the total never pretends to include them.
       */
      const aggregate = (summary, prices) => {
        const out = { cost: 0, tokens: 0, ownTokens: 0, cacheShare: 0, saved: 0, unknownTokens: 0, rows: [], daily: [], peak: 0 }
        if (!isObj(summary) || !isObj(summary.models)) return out
        let cr = 0; let inp = 0
        for (const key of Object.keys(summary.models)) {
          const t = summary.models[key]
          const price = prices[key] === undefined ? null : prices[key]
          const kind = kindOf(key, price)
          const c = kind === 'priced' ? costOf(t, price) : 0
          out.rows.push({ key, kind, tokens: tsum(t), cost: kind === 'priced' ? c : null, ...splitKey(key) })
          out.tokens += tsum(t)
          if (kind === 'priced') { out.cost += c; out.saved += saved(t, price) }
          if (kind === 'unknown') out.unknownTokens += tsum(t)
          if (kind !== 'plan') { cr += t.cr; inp += t.u + t.cr; out.ownTokens += tsum(t) }
        }
        out.cacheShare = inp > 0 ? cr / inp : 0
        out.rows.sort((a, b) => (b.cost === null ? -1 : b.cost) - (a.cost === null ? -1 : a.cost) || b.tokens - a.tokens)
        for (const d of summary.daily || []) {
          let c = 0
          for (const key of Object.keys(d.models || {})) {
            const price = prices[key] === undefined ? null : prices[key]
            if (kindOf(key, price) === 'priced') c += costOf(d.models[key], price)
          }
          out.daily.push({ day: d.day, cost: c })
          if (c > out.peak) out.peak = c
        }
        return out
      }
      const sessionCost = (models, prices) => {
        let c = 0; let unknown = 0; let tokens = 0
        for (const key of Object.keys(models || {})) {
          const price = prices[key] === undefined ? null : prices[key]
          const kind = kindOf(key, price)
          tokens += tsum(models[key])
          if (kind === 'priced') c += costOf(models[key], price)
          if (kind === 'unknown') unknown += tsum(models[key])
        }
        return { cost: c, unknown, tokens }
      }
      /** A server budget window as a row: label, percent, and when it frees up (only given once it is used up). */
      const windowView = (w, serverNow) => {
        if (!isObj(w)) return null
        const secs = num(w.window_seconds)
        const pct = num(w.used_percent)
        if (secs === null || pct === null) return null
        let label
        if (secs % 86400 === 0) { const d = secs / 86400; label = d === 1 ? L('windowDays1', { n: d }) : L('windowDays', { n: d }) }
        else if (secs % 3600 === 0 && secs <= 6 * 3600) label = L('window5h', { n: secs / 3600 })
        else label = L('windowHours', { n: Math.round(secs / 3600) })
        if (w.kind === 'pool') label = L('teamPool', { w: label })
        let back = null
        if (w.exhausted === true && typeof w.resets_at === 'string') {
          const at = Date.parse(w.resets_at); const now = serverNow !== null && serverNow !== undefined ? Date.parse(serverNow) : Date.now()
          if (Number.isFinite(at) && Number.isFinite(now) && at > now) back = duration(Math.max(1, Math.round((at - now) / 60000)))
        }
        return { label, pct: Math.min(100, Math.max(0, pct)), back, kind: w.kind === 'pool' ? 'pool' : 'member', seconds: secs }
      }
      /** Minutes as a short phrase: « 40 min », « 1 h 40 », « 3 jours ». */
      const duration = (min) => {
        if (min < 60) return min + NB + 'min'
        if (min < 2880) return Math.floor(min / 60) + NB + 'h' + (min % 60 > 0 ? ' ' + String(min % 60).padStart(2, '0') : '')
        return Math.round(min / 1440) + NB + (lang().slice(0, 2) === 'fr' || lang() === 'kybernos' ? 'jours' : 'days')
      }
      const tone = (pct) => (pct >= 100 ? 'err' : (pct >= 80 ? 'warn' : 'ok'))

      // ── data (module scope: one cache for the chip and the page) ─────────────────────────────────────────────
      const getJson = (url) => fetch(url, { headers: { accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      const postJson = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      const priceCache = new Map()
      const loadPrice = (key) => {
        if (priceCache.has(key)) return priceCache.get(key)
        const { provider, model } = splitKey(key)
        const kind = kindOf(key, null)
        const p = (kind === 'plan' || kind === 'free')
          ? Promise.resolve(null)
          : getJson('/kybernos-models/modelsdev?route=' + encodeURIComponent(provider) + '&id=' + encodeURIComponent(model)).then((j) => priceOf(j !== null && isObj(j) ? j.match : null))
        priceCache.set(key, p)
        return p
      }
      const loadPrices = async (keys) => {
        const out = {}
        await Promise.all(keys.map(async (k) => { out[k] = await loadPrice(k) }))
        return out
      }
      const planStore = { at: 0, value: undefined, inflight: null }
      const loadPlan = (force) => {
        if (force !== true && planStore.value !== undefined && Date.now() - planStore.at < 45000) return Promise.resolve(planStore.value)
        if (planStore.inflight !== null) return planStore.inflight
        planStore.inflight = Promise.all([getJson('/kybernos-cloud/quota'), getJson('/kybernos-cloud/status')]).then(([quota, status]) => {
          let v = null
          if (isObj(quota) && quota.ok === true) {
            // The host answers { ok, connected, state: { …, space_plan } } (kybernos-cloud's statusRoute): the plan of the active space lives under `state`. Read at the top of the
            // answer it was never found, and « Credits left » never appeared (recette L2-36). A balance the server did not give is `null` there: no row, not « 0 credits ».
            const st = isObj(status) && isObj(status.state) ? status.state : null
            const sp = st !== null && isObj(st.space_plan) ? st.space_plan : null
            const now = typeof quota.server_time === 'string' ? quota.server_time : null
            v = {
              connected: true,
              name: sp !== null && typeof sp.label === 'string' ? sp.label : null,
              credits: sp !== null && typeof sp.credit_balance_credits === 'number' && Number.isFinite(sp.credit_balance_credits) ? sp.credit_balance_credits : null,
              blocked: quota.payment_blocked === true,
              windows: (Array.isArray(quota.usage) ? quota.usage : []).map((w) => windowView(w, now)).filter((w) => w !== null),
            }
          } else if (isObj(quota) && quota.connected === false) v = { connected: false, windows: [] }
          planStore.value = v; planStore.at = Date.now(); planStore.inflight = null
          return v
        })
        return planStore.inflight
      }
      const summaryStore = { at: 0, value: null, inflight: null }
      const loadSummary = (days, force) => {
        if (days === 31 && force !== true && summaryStore.value !== null && Date.now() - summaryStore.at < 30000) return Promise.resolve(summaryStore.value)
        if (days === 31 && summaryStore.inflight !== null && force !== true) return summaryStore.inflight
        const p = getJson('/kybernos-usage/summary?days=' + days).then((j) => (isObj(j) && j.ok === true ? j : null))
        if (days === 31) { summaryStore.inflight = p; p.then((v) => { summaryStore.value = v; summaryStore.at = Date.now(); summaryStore.inflight = null }) }
        return p
      }

      // ── styles: one <style data-plugin>, tokens with fallbacks, prefix kbus- ─────────────────────────────────
      const CSS = `
.kbus-pill{position:relative;display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.10));border-radius:24px;background:transparent;color:var(--dsw-alias-label-secondary,#cfd3d6);font:inherit;font-size:12.5px;font-weight:500;line-height:1;cursor:pointer;white-space:nowrap}
.kbus-pill:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.kbus-pill:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:1px}
.kbus-pill[aria-expanded="true"]{border-color:var(--dsw-alias-state-business-primary,#4176e6);color:var(--dsw-alias-label-primary,#e8eaec)}
.kbus-pill .kbus-ico{display:inline-flex;color:var(--dsw-alias-label-tertiary,#8a9096)}
.kbus-pill .kbus-n{font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-state-business-primary,#4176e6)}
.kbus-pill.is-muted .kbus-n{color:var(--dsw-alias-label-tertiary,#8a9096);font-weight:500}
.kbus-pill.is-warn .kbus-n{color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.kbus-pill.is-err .kbus-n{color:var(--dsw-alias-state-error-primary,#f87171)}
.kbus-wrap{position:relative;display:inline-flex}
.kbus-pop{position:absolute;bottom:calc(100% + 10px);left:0;z-index:70;width:min(340px,calc(100vw - 48px));max-height:min(560px,calc(100vh - 180px));overflow-y:auto;text-align:left;background:linear-gradient(var(--dsw-specific-menu,#1c1c1f),var(--dsw-specific-menu,#1c1c1f)),var(--dsw-alias-bg-base,#151517);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.10));border-radius:18px;padding:12px 18px;color:var(--dsw-alias-label-primary,#e8eaec);box-shadow:0 16px 44px rgba(0,0,0,.30);font-size:14px}
.kbus-head{display:flex;align-items:center;gap:8px;min-height:32px}
.kbus-name{flex:1;display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-tertiary,#8a9096)}
.kbus-x{width:30px;height:30px;border:0;background:transparent;border-radius:8px;color:var(--dsw-alias-label-tertiary,#8a9096);cursor:pointer;margin-right:-8px;padding:0}
.kbus-x:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.kbus-pop h3{margin:10px 0 4px;font-size:18px;font-weight:700;line-height:1.25}
.kbus-pop p{margin:0;font-size:14px;line-height:1.45;color:var(--dsw-alias-label-secondary,#cfd3d6)}
.kbus-sep{height:1px;background:var(--dsw-alias-border-l1,rgba(255,255,255,.06));margin:12px 0}
.kbus-lim{display:grid;gap:12px;margin:6px 0 0}
.kbus-r{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:13.5px}
.kbus-r .kbus-v{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#cfd3d6);white-space:nowrap}
.kbus-r .kbus-v b{color:var(--dsw-alias-label-primary,#e8eaec);font-weight:600}
.kbus-meter{height:6px;border-radius:3px;background:var(--dsw-alias-border-l2,rgba(255,255,255,.10));overflow:hidden;margin:5px 0 0}
.kbus-meter i{display:block;height:100%;border-radius:3px;background:var(--dsw-alias-state-business-primary,#4176e6)}
.kbus-meter.ok i{background:var(--dsw-alias-state-success-primary,#22c55e)}
.kbus-meter.warn i{background:var(--dsw-alias-state-warn-primary,#f59e0b)}
.kbus-meter.err i{background:var(--dsw-alias-state-error-primary,#f87171)}
.kbus-line{margin:12px 0 0;font-size:12.5px;line-height:1.45;color:var(--dsw-alias-label-tertiary,#8a9096)}
.kbus-hd{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:13px;color:var(--dsw-alias-label-tertiary,#8a9096)}
.kbus-split{display:flex;height:6px;border-radius:3px;overflow:hidden;gap:2px;background:var(--dsw-alias-border-l2,rgba(255,255,255,.10));margin:12px 0 10px}
.kbus-split i{display:block;height:100%}
.kbus-leg{display:grid;gap:6px;margin:0;padding:0;list-style:none}
.kbus-leg li{display:grid;grid-template-columns:10px 1fr auto auto;gap:8px;align-items:center;font-size:13px;color:var(--dsw-alias-label-secondary,#cfd3d6)}
.kbus-leg .d{width:8px;height:8px;border-radius:50%}
.kbus-leg .t{color:var(--dsw-alias-label-tertiary,#8a9096);font-variant-numeric:tabular-nums}
.kbus-leg .c{min-width:52px;text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,#e8eaec)}
.kbus-btn{margin-top:14px;width:100%;height:40px;border:0;border-radius:12px;background:var(--dsw-alias-button-primary-fill,#f9fafb);color:var(--dsw-alias-label-primary-foreground,#0f1115);font:inherit;font-weight:600;cursor:pointer}
.kbus-link{color:var(--dsw-alias-link,#7aaaff);font-size:12.5px;text-decoration:none}
.kbus-link:hover{text-decoration:underline}
@media (max-width:760px){.kbus-pop{position:fixed;left:16px;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));width:auto;max-height:calc(100vh - 120px)}}

.kbus-page{padding:0 0 32px;max-width:860px;color:var(--dsw-alias-label-primary,#e8eaec)}
/* Light schemes: label-tertiary is 3.7:1 on white. Inside this page it reads as label-secondary, 5.8:1 (audit A1-05); the dark scheme keeps its hierarchy. */
body:not([data-ds-dark-theme]) .kbus-page{--dsw-alias-label-tertiary:var(--dsw-alias-label-secondary)}
.kbus-page h2{margin:0;font-size:22px;line-height:1.25;font-weight:700}
.kbus-titlerow{display:flex;align-items:center;flex-wrap:wrap;gap:12px}
.kbus-lead{margin:6px 0 0;color:var(--dsw-alias-label-tertiary,#8a9096);max-width:62ch}
.kbus-sec{margin:26px 0 0}
.kbus-sec>h3{margin:0 0 10px;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;font-size:14px;font-weight:600}
.kbus-sec>h3 small{font-size:12px;font-weight:400;color:var(--dsw-alias-label-tertiary,#8a9096)}
.kbus-card{border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.10));border-radius:14px;background:var(--dsw-alias-bg-layer-2,transparent);padding:14px 16px}
.kbus-card.warn{border-color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.kbus-card.err{border-color:var(--dsw-alias-state-error-primary,#f87171)}
.kbus-card h4{margin:0;font-size:14px;font-weight:600}
.kbus-seg{display:inline-flex;padding:2px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.10));border-radius:10px}
.kbus-seg button{border:0;background:transparent;padding:5px 10px;border-radius:8px;font:inherit;font-size:12.5px;cursor:pointer;color:var(--dsw-alias-label-secondary,#cfd3d6)}
.kbus-seg button[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#e8eaec);font-weight:600}
.kbus-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:14px 0 0}
.kbus-kpi{border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.10));border-radius:14px;background:var(--dsw-alias-bg-layer-2,transparent);padding:12px 14px;min-width:0}
.kbus-kpi .l{font-size:12px;color:var(--dsw-alias-label-tertiary,#8a9096)}
.kbus-kpi .v{margin-top:4px;font-size:24px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.15}
.kbus-kpi .s{margin-top:2px;font-size:12px;color:var(--dsw-alias-label-tertiary,#8a9096)}
.kbus-chart{border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.10));border-radius:14px;background:var(--dsw-alias-bg-layer-2,transparent);padding:14px 14px 10px}
.kbus-bars{height:132px;display:flex;align-items:flex-end;gap:3px;background-image:linear-gradient(var(--dsw-alias-border-l1,rgba(255,255,255,.06)) 1px,transparent 1px);background-size:100% 33.33%}
.kbus-bars .b{flex:1;min-width:2px;border-radius:3px 3px 0 0;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 42%,transparent)}
.kbus-bars .b.today{background:var(--dsw-alias-state-business-primary,#4176e6)}
.kbus-axis{display:flex;justify-content:space-between;margin-top:6px;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a9096);font-variant-numeric:tabular-nums}
.kbus-list{border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.10));border-radius:14px;background:var(--dsw-alias-bg-layer-2,transparent);overflow:hidden}
.kbus-row{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) auto;gap:14px;align-items:center;padding:11px 14px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06))}
.kbus-row:first-child{border-top:0}
.kbus-row .nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbus-row .nm small{display:block;font-size:12px;color:var(--dsw-alias-label-tertiary,#8a9096)}
.kbus-row .sh{height:6px;border-radius:3px;background:var(--dsw-alias-border-l2,rgba(255,255,255,.10));overflow:hidden}
.kbus-row .sh i{display:block;height:100%;background:var(--dsw-alias-state-business-primary,#4176e6)}
.kbus-row .am{min-width:70px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
.kbus-chip{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:10px;font-size:11.5px;font-weight:500;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));color:var(--dsw-alias-label-secondary,#cfd3d6);white-space:nowrap}
.kbus-chip.warn{color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.kbus-chip.free{color:var(--dsw-alias-state-success-primary,#22c55e)}
.kbus-empty{border:1px dashed var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:14px;padding:36px 20px;text-align:center;color:var(--dsw-alias-label-tertiary,#8a9096)}
.kbus-empty b{display:block;margin-bottom:6px;color:var(--dsw-alias-label-primary,#e8eaec);font-size:15px}
.kbus-banner{margin:16px 0 0;padding:11px 14px;border-radius:12px;border:1px solid var(--dsw-alias-state-warn-primary,#f59e0b);display:flex;gap:10px;justify-content:space-between;align-items:center}
.kbus-btn2{height:32px;padding:0 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));background:transparent;font:inherit;font-size:13px;font-weight:500;cursor:pointer;color:inherit}
.kbus-btn2:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.kbus-fold{border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.10));border-radius:14px;background:var(--dsw-alias-bg-layer-2,transparent)}
.kbus-fold summary{list-style:none;cursor:pointer;display:flex;gap:10px;align-items:center;padding:12px 14px;justify-content:space-between}
.kbus-fold summary::-webkit-details-marker{display:none}
.kbus-fold summary span:last-child{color:var(--dsw-alias-label-tertiary,#8a9096);font-size:13px}
.kbus-fold .in{padding:0 14px 14px;display:grid;gap:12px}
.kbus-field{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.kbus-field input[type=number]{width:110px;height:34px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:10px;background:var(--dsw-alias-bg-base,transparent);color:inherit;padding:0 10px;font:inherit}
.kbus-sw{position:relative;width:38px;height:22px;border-radius:11px;border:0;background:var(--dsw-alias-border-l2,rgba(255,255,255,.10));cursor:pointer;padding:0;flex:none}
.kbus-sw::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-secondary,#cfd3d6);transition:transform .15s}
.kbus-sw[aria-checked="true"]{background:var(--dsw-alias-state-business-primary,#4176e6)}
.kbus-sw[aria-checked="true"]::after{transform:translateX(16px);background:#fff}
@media (prefers-reduced-motion:reduce){.kbus-sw::after{transition:none}}
@media (max-width:760px){.kbus-page{padding:0 0 24px}.kbus-kpis{grid-template-columns:minmax(0,1fr)}.kbus-row{grid-template-columns:minmax(0,1fr) auto}.kbus-row .sh{display:none}}
`
      const placeCss = () => {
        if (document.querySelector('style[data-plugin="@local/kybernos-usage"]') !== null) return
        const s = document.createElement('style'); s.setAttribute('data-plugin', '@local/kybernos-usage'); s.textContent = CSS; document.head.appendChild(s)
      }
      const svg = (path, size) => h('svg', { width: size || 15, height: size || 15, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', dangerouslySetInnerHTML: { __html: path } })
      const ICON = {
        coin: '<circle cx="8" cy="8" r="6"/><path d="M9.8 6.2C9.4 5.7 8.8 5.5 8 5.5c-1 0-1.7.5-1.7 1.2 0 1.8 3.6.7 3.6 2.5 0 .7-.8 1.3-1.9 1.3-.8 0-1.5-.3-1.9-.8M8 4v1.5m0 5V12"/>',
        gauge: '<path d="M2.5 11.5a5.5 5.5 0 1 1 11 0"/><path d="M8 11l2.6-3.6"/>',
        x: '<path d="M4 4l8 8M12 4l-8 8"/>',
      }

      // ── shared pieces ────────────────────────────────────────────────────────────────────────────────────────
      const useLangTick = () => {
        const [, set] = React.useState(0)
        React.useEffect(() => {
          const f = () => set((n) => n + 1)
          window.addEventListener('kybernos-lang-change', f)
          return () => window.removeEventListener('kybernos-lang-change', f)
        }, [])
      }
      const LimitRows = ({ windows }) => h('div', { className: 'kbus-lim' }, windows.map((w, i) => h('div', { key: i },
        h('div', { className: 'kbus-r' }, h('span', null, w.label), h('span', { className: 'kbus-v' }, h('b', null, w.pct + NB + '%'), w.back !== null ? ' · ' + L('resetsIn', { t: w.back }) : '')),
        h('div', { className: 'kbus-meter ' + tone(w.pct), 'data-kb': 'kybernos-usage-window' }, h('i', { style: { width: w.pct + '%' } })))))
      const CreditsRow = ({ credits }) => (credits === null ? null : h('div', { className: 'kbus-lim' },
        h('div', { className: 'kbus-r' }, h('span', null, L('credits')), h('span', { className: 'kbus-v' }, h('b', null, Math.round(credits).toLocaleString(lang().slice(0, 2) === 'fr' ? 'fr-FR' : 'en-US')), ' ' + L('creditsUnit')))))

      // ── the chip and its card ────────────────────────────────────────────────────────────────────────────────
      // Every session the store knows (the chat and its sub-agents) is reported to the host, throttled: the host turns
      // the cumulative counters into deltas and books them on the day.
      const SEND_EVERY_MS = 8000
      const sent = new Map() // sessionId → { at, sig }
      const reportAll = (state) => {
        try {
          const byId = state !== null && state !== undefined && isObj(state.byId) ? state.byId : {}
          for (const sid of Object.keys(byId)) {
            const s = byId[sid]; const pv = s !== null && s !== undefined && isObj(s.projectionValues) ? s.projectionValues : null
            if (pv === null || !isObj(pv.tokenUsage) || !isObj(pv.modelSelection) || !isObj(pv.modelSelection.lastUsed)) continue
            reportOne(sid, pv.tokenUsage, pv.modelSelection.lastUsed, typeof s.title === 'string' ? s.title : '')
          }
        } catch (e) { /* the store is not ours to break */ }
      }
      /**
       * What changes in the store when any session's counters move. It decides the re-render AND the report, so it must carry every counter
       * `reportOne` compares (L5-06): it left out `cacheWriteTokens`, so an update where only the cache write advanced was neither drawn nor sent.
       */
      const storeSignature = (st) => {
        let sig = ''
        try { for (const id of Object.keys(st.byId)) { const pv = st.byId[id].projectionValues; if (pv && pv.tokenUsage) { const u = pv.tokenUsage; sig += id.slice(-4) + (u.uncachedInputTokens | 0) + ':' + (u.outputTokens | 0) + ':' + (u.cacheReadTokens | 0) + ':' + (u.cacheWriteTokens | 0) + ';' } } } catch (e) { /* unexpected store */ }
        return sig
      }
      const reportOne = (sid, usage, model, title) => {
        const sig = [usage.uncachedInputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheWriteTokens, model.provider, model.model].join('|')
        const prev = sent.get(sid)
        if (prev !== undefined && prev.sig === sig) return
        const wait = prev === undefined ? 0 : Math.max(0, SEND_EVERY_MS - (Date.now() - prev.at))
        const go = () => {
          sent.set(sid, { at: Date.now(), sig })
          postJson('/kybernos-usage/observe', { sessionId: sid, provider: String(model.provider || ''), model: String(model.model || ''), title, usage })
        }
        if (wait === 0) go()
        else {
          if (prev !== undefined && prev.timer !== undefined) clearTimeout(prev.timer)
          const t = setTimeout(go, wait)
          sent.set(sid, Object.assign({}, prev, { timer: t }))
        }
      }

      function Chip (props) {
        const sessionId = props.sessionId
        const up = typeof props.useProjection === 'function' ? props.useProjection : null
        const latestStore = React.useRef(null)
        const usage = up !== null ? up('tokenUsage') : undefined
        const selection = up !== null ? up('modelSelection') : undefined
        const pressure = up !== null ? up('contextPressure') : undefined
        // Re-render (and report) when any session of the store gets new counters: the sub-agents live there.
        const storeSig = typeof props.useSessions === 'function'
          ? props.useSessions((st) => {
            latestStore.current = st
            return storeSignature(st)
          })
          : ''
        const [open, setOpen] = React.useState(false)
        const [plan, setPlan] = React.useState(undefined) // undefined: not read · null: unavailable · object
        const [price, setPrice] = React.useState(undefined)
        const [month, setMonth] = React.useState(null)
        const wrap = React.useRef(null)
        useLangTick()

        const model = isObj(selection) && isObj(selection.lastUsed) ? selection.lastUsed : null
        const key = model === null ? null : (String(model.provider || '') === '' ? String(model.model || '') : String(model.provider) + '/' + String(model.model))
        const onPlan = key !== null && splitKey(key).provider.toLowerCase() === 'kybernos'

        React.useEffect(() => { placeCss() }, [])
        React.useEffect(() => { reportAll(latestStore.current); if (sessionId !== undefined && isObj(usage) && model !== null) reportOne(sessionId, usage, model, '') }, [storeSig, usage, key])
        React.useEffect(() => {
          let alive = true
          const read = () => loadPlan(false).then((v) => { if (alive) setPlan(v) })
          if (onPlan || open) read()
          const t = (onPlan || open) ? setInterval(read, 90000) : null
          return () => { alive = false; if (t !== null) clearInterval(t) }
        }, [onPlan, open])
        React.useEffect(() => {
          let alive = true
          setPrice(undefined)
          if (key !== null && !onPlan) loadPrice(key).then((p) => { if (alive) setPrice(p) })
          return () => { alive = false }
        }, [key, onPlan])
        React.useEffect(() => {
          if (onPlan || key === null) return undefined
          let alive = true
          loadSummary(31).then(async (s) => {
            if (!alive || s === null) return
            const keys = Object.keys(s.models); const prices = await loadPrices(keys)
            if (!alive) return
            const ym = String(s.period.to).slice(0, 7)
            let spent = 0
            for (const d of s.daily) { if (String(d.day).slice(0, 7) !== ym) continue; for (const k of Object.keys(d.models)) { if (kindOf(k, prices[k]) === 'priced') spent += costOf(d.models[k], prices[k]) } }
            setMonth({ spent, budget: s.budget })
          })
          return () => { alive = false }
        }, [open, key, onPlan])
        React.useEffect(() => {
          if (!open) return undefined
          const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
          const away = (e) => { if (wrap.current !== null && !wrap.current.contains(e.target)) setOpen(false) }
          window.addEventListener('keydown', esc, true)
          document.addEventListener('mousedown', away)
          return () => { window.removeEventListener('keydown', esc, true); document.removeEventListener('mousedown', away) }
        }, [open])

        const tokens = isObj(usage) ? { u: usage.uncachedInputTokens | 0, o: usage.outputTokens | 0, cr: usage.cacheReadTokens | 0, cw: usage.cacheWriteTokens | 0 } : null
        const windows = isObj(plan) ? plan.windows : []
        const worst = windows.length > 0 ? Math.max.apply(null, windows.map((w) => w.pct)) : null
        const kind = key === null ? null : kindOf(key, price === undefined ? null : price)
        const cost = kind === 'priced' && tokens !== null ? costOf(tokens, price) : null
        const overBudget = month !== null && month.budget && month.budget.usd !== null && month.spent >= month.budget.usd

        // What the chip says: the plan's busiest window on a Kybernos model, the session's cost on a key of one's own.
        let label = null; let cls = ''; let aria = ''
        if (onPlan && worst !== null) { label = worst + NB + '%'; cls = worst >= 100 ? 'is-err' : (worst >= 80 ? 'is-warn' : ''); aria = L('pillPlan', { pct: label }) }
        else if (!onPlan && key !== null && tokens !== null) {
          if (kind === 'free') { label = L('gratis'); cls = 'is-muted'; aria = L('free') }
          else if (kind === 'unknown') { label = L('unknownChip'); cls = 'is-muted'; aria = L('priceUnknown') }
          else if (kind === 'priced' && cost !== null) { label = fmtMoney(cost); aria = L('pillOwn', { cost: label }); if (overBudget) cls = 'is-warn' }
        }
        if (label === null) return null

        const card = !open ? null : h('div', { className: 'kbus-pop', role: 'dialog', 'aria-label': L('title'), 'data-kb': 'kybernos-usage-card' },
          h('div', { className: 'kbus-head' },
            h('span', { className: 'kbus-name' }, svg(onPlan ? ICON.gauge : ICON.coin), L('title')),
            h('button', { type: 'button', className: 'kbus-x', 'data-act': 'close', 'aria-label': L('close'), onClick: () => setOpen(false) }, svg(ICON.x, 14))),
          isObj(pressure) && num(pressure.contextWindow) !== null && num(pressure.pressureTokens) !== null && pressure.contextWindow > 0
            ? h('div', { className: 'kbus-lim', style: { marginTop: 12 } }, h('div', null,
              h('div', { className: 'kbus-r' }, h('span', null, L('context')), h('span', { className: 'kbus-v' }, h('b', null, fmtPct(pressure.pressureTokens / pressure.contextWindow)), ' · ' + fmtTok(pressure.pressureTokens) + ' / ' + fmtTok(pressure.contextWindow))),
              h('div', { className: 'kbus-meter' }, h('i', { style: { width: Math.min(100, pressure.pressureTokens / pressure.contextWindow * 100) + '%' } }))))
            : null,
          !onPlan && tokens !== null ? h('div', null, h('div', { className: 'kbus-sep' }), OwnBlock({ key, kind, tokens, price, month })) : null,
          h('div', { className: 'kbus-sep' }),
          plan === undefined ? h('p', { className: 'kbus-line', style: { margin: 0 } }, L('loading'))
            : (plan === null || plan.connected === false) ? h('p', { className: 'kbus-line', style: { margin: 0 } }, plan === null ? L('planUnavailable') : L('signIn'))
              : h('div', null,
                h('div', { className: 'kbus-hd' }, h('span', null, plan.name !== null ? L('planLimits', { name: plan.name }) : L('planLimitsNoName'))),
                h(LimitRows, { windows }),
                h('p', { className: 'kbus-line' }, L('rolling')),
                plan.credits !== null ? h('div', null, h('div', { className: 'kbus-sep' }), h(CreditsRow, { credits: plan.credits })) : null),
          onPlan ? h('p', { className: 'kbus-line' }, L('viaPlan')) : null,
          h('p', { className: 'kbus-line' }, L('detailHint')))

        return h('span', { className: 'kbus-wrap', ref: wrap, 'data-kb': 'usage-chip' },
          h('button', { type: 'button', className: 'kbus-pill ' + cls, 'aria-expanded': open ? 'true' : 'false', 'aria-haspopup': 'dialog', 'data-kb': 'kybernos-usage-pill', 'data-act': 'toggle', title: aria, onClick: () => setOpen(!open) },
            h('span', { className: 'kbus-ico' }, svg(onPlan ? ICON.gauge : ICON.coin)),
            h('span', { className: 'kbus-n' }, label)),
          card)
      }

      /** The «this session, on your own key» block of the card. */
      function OwnBlock ({ key, kind, tokens, price, month }) {
        const { model } = splitKey(key)
        const all = tsum(tokens)
        if (kind === 'free') return h('div', null, h('h3', null, L('free')), h('p', null, L('freeLine', { model, tokens: fmtTok(all), where: FREE_PROVIDERS[splitKey(key).provider.toLowerCase()] === 'free' ? L('whereFree') : L('whereLocal') })))
        if (kind === 'unknown') return h('div', null, h('h3', null, L('priceUnknown')), h('p', null, L('priceUnknownLine', { model, tokens: fmtTok(all) })))
        if (kind !== 'priced') return h('div', null, h('h3', null, L('noCostTitle')), h('p', null, L('noCostLine')))
        const cu = tokens.u * price.in / 1e6; const cc = tokens.cr * (price.cr === null ? price.in : price.cr) / 1e6; const co = tokens.o * price.out / 1e6
        // L5-01: the title counts the tokens written to the cache (`tsum`, `costOf`), so the lines under it must too, or they do not add up to it.
        const cw = tokens.cw * (price.cw === null ? price.in : price.cw) / 1e6
        const wrote = tokens.cw > 0
        const total = costOf(tokens, price)
        const over = month !== null && month.budget && month.budget.usd !== null
        return h('div', null,
          h('div', { className: 'kbus-hd' }, h('span', null, L('sessionOwn', { model }))),
          h('h3', { style: { marginTop: 6 } }, fmtMoney(total)),
          h('p', null, L('cacheLine', { tokens: fmtTok(all), pct: fmtPct(tokens.cr / Math.max(1, tokens.u + tokens.cr + tokens.cw)), saved: fmtMoney(saved(tokens, price)) })),
          h('div', { className: 'kbus-split', 'aria-hidden': 'true' },
            h('i', { style: { flex: Math.max(1, tokens.u), background: 'var(--dsw-static-deepseek-500,#4176e6)' } }),
            h('i', { style: { flex: Math.max(1, tokens.cr), background: 'var(--dsw-static-green-500,#22c55e)' } }),
            wrote ? h('i', { style: { flex: Math.max(1, tokens.cw), background: 'var(--dsw-static-neutral-500,#8a9096)' } }) : null,
            h('i', { style: { flex: Math.max(1, tokens.o * 6), background: 'var(--dsw-static-amber-500,#f59e0b)' } })),
          h('ul', { className: 'kbus-leg' },
            [[L('entryNew'), tokens.u, cu, 'var(--dsw-static-deepseek-500,#4176e6)'], [L('cacheRead'), tokens.cr, cc, 'var(--dsw-static-green-500,#22c55e)']]
              .concat(wrote ? [[L('cacheWrite'), tokens.cw, cw, 'var(--dsw-static-neutral-500,#8a9096)']] : [])
              .concat([[L('output'), tokens.o, co, 'var(--dsw-static-amber-500,#f59e0b)']])
              .map((r, i) => h('li', { key: i }, h('span', { className: 'd', style: { background: r[3] } }), h('span', null, r[0]), h('span', { className: 't' }, fmtTok(r[1])), h('span', { className: 'c' }, fmtMoney(r[2]))))),
          over && month.spent >= month.budget.usd ? h('p', { className: 'kbus-line' }, L('budgetOver', { spent: fmtMoney(month.spent), b: fmtMoney(month.budget.usd) })) : null)
      }

      // ── the Settings page ────────────────────────────────────────────────────────────────────────────────────
      function Page () {
        const [period, setPeriod] = React.useState('7')
        const [tab, setTab] = React.useState('models')
        const [summary, setSummary] = React.useState(undefined) // undefined: loading · null: failed
        const [prices, setPrices] = React.useState({})
        const [plan, setPlan] = React.useState(undefined)
        const [budget, setBudget] = React.useState({ usd: '', alert: true })
        const [budgetOpen, setBudgetOpen] = React.useState(false)
        const [flash, setFlash] = React.useState('')
        useLangTick()
        const days = period === 'today' ? 1 : (period === '7' ? 7 : 30)
        const load = React.useCallback(() => {
          let alive = true
          setSummary(undefined)
          loadSummary(31, true).then(async (s) => {
            if (!alive) return
            if (s === null) { setSummary(null); return }
            const p = await loadPrices(Object.keys(s.models))
            if (!alive) return
            setPrices(p); setSummary(s)
            setBudget({ usd: s.budget && s.budget.usd !== null ? String(s.budget.usd) : '', alert: !(s.budget && s.budget.alert === false) })
          })
          loadPlan(true).then((v) => { if (alive) setPlan(v) })
          return () => { alive = false }
        }, [])
        React.useEffect(() => { placeCss(); return load() }, [load])

        // The 31-day summary is cut down to the chosen period here, so switching periods costs no request.
        const view = React.useMemo(() => {
          if (!isObj(summary)) return null
          const cut = summary.daily.slice(summary.daily.length - days)
          const models = {}
          for (const d of cut) for (const k of Object.keys(d.models)) models[k] = addTo(models[k] === undefined ? zero() : models[k], d.models[k])
          return { summary: Object.assign({}, summary, { daily: cut, models }), agg: aggregate({ daily: cut, models }, prices) }
        }, [summary, prices, days])

        const saveBudget = async () => {
          const usd = budget.usd === '' ? null : Number(budget.usd)
          const r = await postJson('/kybernos-usage/budget', { usd: usd === null || !Number.isFinite(usd) ? null : usd, alert: budget.alert })
          setFlash(r !== null && r.ok === true ? L('saved') : L('readFail'))
          setTimeout(() => setFlash(''), 2500)
        }

        const planCard = () => {
          if (plan === undefined) return h('div', { className: 'kbus-card' }, h('p', { className: 'kbus-line', style: { margin: 0 } }, L('loading')))
          if (plan === null) return h('div', { className: 'kbus-card' }, h('p', { className: 'kbus-line', style: { margin: 0 } }, L('planUnavailable')))
          if (plan.connected === false) return h('div', { className: 'kbus-card' }, h('h4', null, L('planConnect')), h('p', { className: 'kbus-line' }, L('planConnectLine')))
          const worst = plan.windows.length > 0 ? Math.max.apply(null, plan.windows.map((w) => w.pct)) : 0
          return h('div', { className: 'kbus-card ' + (worst >= 100 ? 'err' : (worst >= 80 ? 'warn' : '')), 'data-kb': 'kybernos-usage-plan' },
            h('div', { className: 'kbus-hd' }, h('h4', null, plan.name !== null ? L('planSolo', { name: plan.name }) : L('planSec'))),
            h(LimitRows, { windows: plan.windows }),
            plan.credits !== null ? h('div', null, h('div', { className: 'kbus-sep' }), h(CreditsRow, { credits: plan.credits })) : null,
            h('p', { className: 'kbus-line' }, L('rolling')))
        }

        const own = () => {
          if (summary === undefined) return h('div', { className: 'kbus-card' }, h('p', { className: 'kbus-line', style: { margin: 0 } }, L('loading')))
          if (summary === null) return h('div', { className: 'kbus-banner', role: 'alert' }, h('span', null, L('readFail')), h('button', { type: 'button', className: 'kbus-btn2', 'data-act': 'retry', onClick: () => load() }, L('retry')))
          const a = view.agg
          const empty = a.ownTokens === 0
          if (empty) return h('div', { className: 'kbus-empty', 'data-kb': 'kybernos-usage-empty' }, h('b', null, L('emptyTitle')), L('emptyLine'))
          const today = summary.period.to
          const kpi = h('div', { className: 'kbus-kpis' },
            h('div', { className: 'kbus-kpi' }, h('div', { className: 'l' }, L('kCost')), h('div', { className: 'v' }, fmtMoney(a.cost)), h('div', { className: 's' }, period === 'today' ? L('kToday') : L('kOver', { n: days }))),
            h('div', { className: 'kbus-kpi' }, h('div', { className: 'l' }, L('kTokens')), h('div', { className: 'v' }, fmtTok(a.ownTokens)), h('div', { className: 's' }, L('kKeys'))),
            h('div', { className: 'kbus-kpi' }, h('div', { className: 'l' }, L('kCache')), h('div', { className: 'v' }, fmtPct(a.cacheShare)), h('div', { className: 's' }, L('kSaved', { saved: fmtMoney(a.saved) }))))
          const bars = h('div', { className: 'kbus-sec' },
            h('h3', null, L('perDay'), h('small', null, a.peak > 0 ? L('peak', { v: fmtMoney(a.peak) }) : '')),
            h('div', { className: 'kbus-chart' },
              h('div', { className: 'kbus-bars', role: 'img', 'aria-label': L('perDay') },
                a.daily.map((d, i) => h('span', { key: d.day, className: 'b' + (d.day === today ? ' today' : ''), title: d.day + (lang().slice(0, 2) === 'fr' || lang() === 'kybernos' ? ' : ' : ': ') + fmtMoney(d.cost), style: { height: Math.max(2, a.peak > 0 ? d.cost / a.peak * 100 : 2) + '%' } }))),
              h('div', { className: 'kbus-axis' }, h('span', null, a.daily.length > 0 ? a.daily[0].day.slice(5) : ''), h('span', null, L('pToday')))))
          let rows
          if (tab === 'models') {
            const top = Math.max(1, ...a.rows.map((r) => r.cost === null ? 0 : r.cost))
            rows = a.rows.map((r) => h('div', { className: 'kbus-row', key: r.key },
              h('div', { className: 'nm' }, r.model, h('small', null, fmtTok(r.tokens) + ' tokens · ' + (r.provider || '—'))),
              h('div', { className: 'sh' }, r.kind === 'priced' ? h('i', { style: { width: (r.cost / top * 100) + '%' } }) : null),
              h('div', { className: 'am' }, r.kind === 'priced' ? fmtMoney(r.cost)
                : (r.kind === 'plan' ? h('span', { className: 'kbus-chip' }, L('viaPlanChip'))
                  : (r.kind === 'free' ? h('span', { className: 'kbus-chip free' }, L('freeChip')) : h('span', { className: 'kbus-chip warn' }, L('unknownChip')))))))
          } else {
            const list = (summary.sessions || []).map((s) => ({ s, c: sessionCost(s.models, prices) }))
            const top = Math.max(1, ...list.map((x) => x.c.cost))
            rows = list.map(({ s, c }) => h('div', { className: 'kbus-row', key: s.id },
              h('div', { className: 'nm' }, s.title !== '' ? s.title : s.id.slice(0, 8), h('small', null, fmtTok(c.tokens) + ' tokens')),
              h('div', { className: 'sh' }, h('i', { style: { width: (c.cost / top * 100) + '%' } })),
              h('div', { className: 'am' }, c.cost > 0 ? fmtMoney(c.cost) : h('span', { className: 'kbus-chip' }, c.unknown > 0 ? L('unknownChip') : L('freeChip')))))
          }
          const beforeTokens = Object.keys(summary.before || {}).reduce((n, k) => n + tsum(summary.before[k]), 0)
          return h('div', null, kpi, bars,
            h('div', { className: 'kbus-sec' },
              h('h3', null, L('where'), h('span', { className: 'kbus-seg', role: 'group' },
                [['models', L('byModel')], ['sessions', L('bySession')]].map((x) => h('button', { key: x[0], type: 'button', 'data-act': 'tab-' + x[0], 'aria-pressed': tab === x[0] ? 'true' : 'false', onClick: () => setTab(x[0]) }, x[1])))),
              h('div', { className: 'kbus-list', 'data-kb': 'kybernos-usage-list' }, rows),
              a.unknownTokens > 0 ? h('p', { className: 'kbus-line' }, L('unknownNote')) : null,
              beforeTokens > 0 ? h('p', { className: 'kbus-line' }, L('beforeNote', { tokens: fmtTok(beforeTokens) })) : null,
              summary.since !== null ? h('p', { className: 'kbus-line' }, L('sinceNote', { day: summary.since })) : null))
        }

        // Budget: month to date against the figure the person set.
        const monthSpent = (() => {
          if (!isObj(summary)) return 0
          const ym = String(summary.period.to).slice(0, 7)
          let s = 0
          for (const d of summary.daily) { if (String(d.day).slice(0, 7) !== ym) continue; for (const k of Object.keys(d.models)) { if (kindOf(k, prices[k]) === 'priced') s += costOf(d.models[k], prices[k]) } }
          return s
        })()
        const b = budget.usd === '' ? null : Number(budget.usd)
        const used = b !== null && b > 0 ? monthSpent / b : null
        const budgetBlock = h('details', { className: 'kbus-fold', open: budgetOpen, onToggle: (e) => setBudgetOpen(e.target.open), 'data-kb': 'kybernos-usage-budget' },
          h('summary', null, h('span', null, L('budget')), h('span', null, b === null ? L('budgetNone') : L('budgetUsed', { b: fmtMoney(b), pct: fmtPct(used) }))),
          h('div', { className: 'in' },
            h('div', { className: 'kbus-field' },
              h('label', { htmlFor: 'kbus-budget' }, L('budgetLabel')),
              h('input', { id: 'kbus-budget', type: 'number', min: 0, step: 1, value: budget.usd, onChange: (e) => setBudget(Object.assign({}, budget, { usd: e.target.value })) }),
              h('span', { className: 'kbus-line', style: { margin: 0 } }, L('budgetPerMonth'))),
            h('div', { className: 'kbus-field' },
              h('button', { type: 'button', className: 'kbus-sw', role: 'switch', 'aria-checked': budget.alert ? 'true' : 'false', 'aria-label': L('budgetAlert'), 'data-act': 'alert', onClick: () => setBudget(Object.assign({}, budget, { alert: !budget.alert })) }),
              h('span', null, L('budgetAlert'))),
            h('div', { className: 'kbus-field' },
              h('button', { type: 'button', className: 'kbus-btn2', 'data-act': 'save-budget', onClick: saveBudget }, L('save')),
              flash !== '' ? h('span', { className: 'kbus-line', style: { margin: 0 }, role: 'status' }, flash) : null),
            h('p', { className: 'kbus-line', style: { margin: 0 } }, L('budgetNote'))))

        const overBanner = (b !== null && b > 0 && budget.alert && used >= 1)
          ? h('div', { className: 'kbus-banner', role: 'status' }, h('span', null, L('budgetOver', { spent: fmtMoney(monthSpent), b: fmtMoney(b) })))
          : (b !== null && b > 0 && budget.alert && used >= 0.8 ? h('div', { className: 'kbus-banner', role: 'status' }, h('span', null, L('budgetNear', { pct: fmtPct(used) }))) : null)

        return h('div', { className: 'kbus-page', 'data-kb': 'kybernos-usage-page' },
          h('div', { className: 'kbus-titlerow' },
            h('h2', null, L('pageName')),
            // The Suite's « ? How it works » button, the one form of the help button on every page (its card is help.json).
            typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-usage' }) : null),
          h('p', { className: 'kbus-lead' }, L('pageLead')),
          h('p', { className: 'kbus-lead kbus-for' }, L('pageFor')),
          overBanner,
          h('div', { className: 'kbus-sec' }, h('h3', null, L('planSec'), h('small', null, L('planSecSub'))), planCard()),
          h('div', { className: 'kbus-sec' },
            h('h3', null, L('ownSec'), h('small', null, L('ownSecSub'))),
            h('div', { style: { margin: '0 0 4px' } }, h('span', { className: 'kbus-seg', role: 'group', 'aria-label': L('ownSec') },
              [['today', L('pToday')], ['7', L('p7')], ['30', L('p30')]].map((x) => h('button', { key: x[0], type: 'button', 'data-act': 'period-' + x[0], 'aria-pressed': period === x[0] ? 'true' : 'false', onClick: () => setPeriod(x[0]) }, x[1])))),
            own()),
          h('div', { className: 'kbus-sec' }, budgetBlock),
          h('p', { className: 'kbus-line' }, L('why')))
      }

      return {
        name: 'kybernos-usage',
        inject: ['slots'],
        __test: { S, L, kt, fmtMoney, fmtTok, fmtPct, priceOf, costOf, saved, kindOf, aggregate, sessionCost, windowView, tone, splitKey, FREE_PROVIDERS, CSS, reportOne, storeSignature, OwnBlock, loadPlan, planStore, CreditsRow },
        apply (ctx) {
          // After the sessions pills (order 5) and the changes chip (order 4). The id must NOT be `kybernos-usage`:
          // the core's usage probe already registers that id in this slot.
          ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register(
            { name: 'conversation.composer.dock', id: 'kybernos-usage-chip', order: 6 },
            (props) => { try { return h(Chip, props || {}) } catch (e) { return null } }
          )), 'kybernos-usage: chip in the composer dock')
          ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register(
            { name: 'settings.section', id: 'kybernos-usage', order: 32, label: 'Usage' },
            () => { try { return h(Page) } catch (e) { return null } }
          )), 'kybernos-usage: settings page')
        }
      }
    } catch (error) {
      try { console.error('[kybernos-usage] load failed — plugin disabled, GUI preserved', error) } catch (e) { /* no console */ }
      return { apply () { /* disabled after a load error */ } }
    }
  }
})
