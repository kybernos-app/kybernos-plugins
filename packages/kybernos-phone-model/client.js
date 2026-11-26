// ═══════════════════════════════════════════════════════════════════════════
// @local/kybernos-phone-model — page half. When the host half is active (the app gave the engine a small model on this phone) the page
//   1. puts the chat of a phone model on the preset the host names (« Light agent » once registered, else « Discussion »: the engine does not tie a model to a preset, the preset
//      is chosen once, before the first turn, so the page asks the host FRESH right before it selects, for a blank chat, the new chat included, and says so when the chat
//      already started with another preset); a BLANK chat the engine hands back already recorded as Discussion (the engine keeps the blank chat of a workspace under the
//      preset its log recorded) is looked at once more and moved to the light agent when the host names it,
//   2. draws one quiet line above the composer for such a chat: « Small model on this phone: simple questions, works offline », the mode of the chat (« can set reminders »
//      or « chat only » and why) and the link to the app's native « Manage models on this phone » screen (`kybernos://models`),
//   3. speaks the app's `local-llm` message (state request out, state in) when the app is there.
// Without the host half's route (`GET /phone-model/state` → 404) it does nothing at all: the interface is exactly as it was.
// No key, no address and no path ever reaches this file.
// ═══════════════════════════════════════════════════════════════════════════
window.__ModuleLoader__.load({
  id: '@local/kybernos-phone-model',
  factory: (require) => {
    try {
      const React = require('react')
      const h = React.createElement

      const PROVIDER = 'phone-local'
      const PRESET = 'discussion'
      const LIGHT = 'light-agent'
      const MESSAGE = 'local-llm'
      const PHASES = ['none', 'downloading', 'verifying', 'loading', 'installed', 'failed']
      const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/

      // The words, French and English (the same as WORDS of phone-model.mjs: test-client.mjs compares them).
      const WORDS = {
        label: { en: 'Small model on this phone: simple questions, works offline', fr: 'Petit modèle sur ce téléphone : questions simples, fonctionne hors ligne' },
        labelLight: { en: 'Small model on this phone: simple questions, reminders and notes, works offline', fr: 'Petit modèle sur ce téléphone : questions simples, rappels et notes, fonctionne hors ligne' },
        manage: { en: 'Manage models on this phone', fr: 'Gérer les modèles de ce téléphone' },
        modeLight: { en: 'can set reminders', fr: 'peut créer des rappels' },
        modeChat: { en: 'chat only (the app does not report tools for this model)', fr: 'discussion seule (l’app ne signale pas d’outils pour ce modèle)' },
        modeChatReady: { en: 'chat only (the light agent was not ready)', fr: 'discussion seule (l’agent léger n’était pas prêt)' },
        modeChatNew: { en: 'chat only (a new chat can set reminders)', fr: 'discussion seule (une nouvelle conversation peut créer des rappels)' },
        discussionOnly: { en: 'The small model only works in Discussion mode.', fr: 'Le petit modèle ne fonctionne qu’en mode Discussion.' },
        presetOnly: { en: 'The small model only works in Light agent or Discussion mode.', fr: 'Le petit modèle ne fonctionne qu’en mode Agent léger ou Discussion.' },
        startNew: { en: 'This chat uses the full agent. Start a new chat for the small model.', fr: 'Cette conversation utilise l’agent complet. Ouvre-en une nouvelle pour le petit modèle.' },
        loading: { en: 'Loading the model on this phone…', fr: 'Chargement du modèle sur ce téléphone…' },
        switchedToCloud: { en: 'This needs a cloud model: switched to {name}.', fr: 'Cela demande un modèle cloud : changé pour {name}.' },
        needsCloud: { en: 'This needs a cloud model: the small model on this phone cannot do it.', fr: 'Cela demande un modèle cloud : le petit modèle de ce téléphone ne peut pas le faire.' },
        // the card of a chat that has nobody to answer: nobody is signed in, no key, and the small model was never installed (the installation was closed before it ended)
        stepTitle: { en: 'One step before you chat', fr: 'Une étape avant de discuter' },
        stepText: { en: 'Get the small model: 1.1 GB, downloaded once over Wi-Fi. After that it works offline.', fr: 'Prends le petit modèle : 1,1 Go, téléchargé une fois en Wi-Fi. Ensuite il marche hors ligne.' },
        stepButton: { en: 'Get the model', fr: 'Prendre le modèle' }
      }
      const lang = () => { try { return String(window.__KB_LANG_RESOLVE__ ? window.__KB_LANG_RESOLVE__() : (document.documentElement.lang || 'en')).split(/[-_]/)[0] } catch (e) { return 'en' } }
      const say = (entry) => (lang() === 'fr' ? entry.fr : entry.en)

      // ── pure ────────────────────────────────────────────────────────────────────────────────────────────────────
      /** The app's `local-llm` state message, reduced to the contract's fields; null for anything else (never throws). */
      const parseAppMessage = (raw) => {
        try {
          let m = raw
          if (typeof raw === 'string') { if (raw.length > 2048) return null; m = JSON.parse(raw) }
          if (m === null || typeof m !== 'object' || Array.isArray(m) || m.kybernos !== MESSAGE || m.version !== 1 || m.event !== 'state') return null
          const s = m.state
          if (s === null || typeof s !== 'object' || Array.isArray(s) || typeof s.supported !== 'boolean') return null
          const mod = s.model !== null && typeof s.model === 'object' && !Array.isArray(s.model) && typeof s.model.id === 'string' && MODEL_ID.test(s.model.id) ? { id: s.model.id, name: String(s.model.name || s.model.id).slice(0, 60) } : null
          return { supported: s.supported, phase: PHASES.indexOf(s.phase) >= 0 ? s.phase : 'none', installed: s.installed === true, model: mod }
        } catch (e) { return null }
      }
      /** Whether the model a chat uses is a model of the phone. The picker's selection reads `{ provider, model }`; either spelling is accepted. */
      const isPhoneModel = (current) => {
        if (current === null || typeof current !== 'object') return false
        return current.provider === PROVIDER || (typeof current.model === 'string' && current.model.indexOf(PROVIDER + '/') === 0)
      }
      /**
       * What to do for a chat whose model is (or is not) the phone's (either of our two presets is « done »). `preset` is what the chat records (`undefined` when it is not known yet), `blank` whether the chat
       * has not started (`undefined` when not known), `tried` what this page already did for the chat: `none`, `applied` (it selected Discussion) or `locked` (the engine
       * refused: the chat already started).
       *   idle → nothing; line → draw the label; select → select Discussion; start-new → the chat started on another preset: say so.
       */
      const nextStep = ({ phone, preset, blank, tried }) => {
        if (phone !== true) return 'idle'
        if (preset === PRESET || preset === LIGHT) return 'line'
        if (blank === false || tried === 'locked') return 'start-new'
        if (preset === undefined) return tried === 'none' ? 'select' : 'line'
        return 'select'
      }
      /**
       * The words after the label on the line: which mode this chat is in and, for chat only, why. Returns the name of a WORDS entry, or null = say nothing yet.
       *   preset  what the chat records; host  what the host names now (LIGHT, PRESET, or null/undefined = it does not know yet); tools  whether the app reports tools for the model;
       *   blank   whether the chat has not started; recheck  what the page did for a BLANK chat recorded on Discussion: `pending` (it is still waiting for the host or for the engine),
       *   `ended` (the wait is over and the chat stays on Discussion) or `locked` (the engine refused: the chat had started).
       * « The light agent was not ready » is said only when the wait really ended; while the host's answer is unknown, or the page is still deciding, the line says nothing about the mode.
       */
      const modeNote = ({ preset, blank, host, tools, recheck }) => {
        if (preset === LIGHT) return 'modeLight'
        if (preset !== PRESET) return null
        const why = tools === true ? 'modeChatReady' : 'modeChat'
        if (blank === true && recheck !== 'locked') return recheck === 'ended' ? why : null
        // a chat that started (or one the engine refused): the page can no longer move it, it can only say what a new chat gets
        if (host === LIGHT) return blank === false || recheck === 'locked' ? 'modeChatNew' : null
        return host === PRESET && blank !== undefined ? why : null
      }
      /** The refusal of `agentPresets.select` for a chat that already started. */
      const isLocked = (result) => {
        try {
          const e = result !== null && typeof result === 'object' && result.ok !== true ? result.error : null
          const text = e === null || e === undefined ? '' : String(e.code || '') + ' ' + String(e.message || '') + ' ' + JSON.stringify(e.details || {})
          return /locked|already started/i.test(text)
        } catch (err) { return false }
      }

      /**
       * The cloud model a chat started by a flow moves to: the host's default model when it is not a phone model, else the first model of the first other provider.
       * `dirs` is the model directories service (its `catalog` holds the host's default), `directory` the chat's own directory (the groups the picker lists).
       * Returns `{ provider, model, name }` or null when there is no model but the phone's.
       */
      const cloudChoice = (dirs, directory) => {
        try {
          let value = null
          try { value = dirs.catalog.store.getSnapshot().value } catch (e) { value = null }
          let groups = []
          try { const g = directory.store.getSnapshot().groups; if (Array.isArray(g)) groups = g } catch (e) { groups = [] }
          if (groups.length === 0 && value !== null && value !== undefined && Array.isArray(value.groups)) groups = value.groups
          const usable = groups.filter((g) => g !== null && typeof g === 'object' && g.id !== PROVIDER && Array.isArray(g.models) && g.models.length > 0)
          const named = (g, m) => ({ provider: g.id, model: m.id, name: typeof m.name === 'string' && m.name !== '' ? m.name : String(m.id) })
          const def = value !== null && value !== undefined && value.default !== null && typeof value.default === 'object' ? value.default : null
          if (def !== null && def.provider !== PROVIDER) {
            for (const g of usable) { if (g.id !== def.provider) continue; const m = g.models.find((x) => x !== null && typeof x === 'object' && x.id === def.model); if (m !== undefined) return named(g, m) }
          }
          for (const g of usable) { const m = g.models.find((x) => x !== null && typeof x === 'object' && typeof x.id === 'string'); if (m !== undefined) return named(g, m) }
        } catch (e) { /* no choice: the chat keeps the phone's model and says why */ }
        return null
      }
      /** Simple mode (the Kybernos app asked for Kaby mode: its user agent ends with `KabyMode/<n>`, see kybernos-mobile). The picker there is the web app's own (the whole Kybernos Models catalogue and the phone's model among it); Simple only adds the product rule below. */
      const SIMPLE_UA = /KybernosHost\/[0-9][0-9A-Za-z.+-]* \((?:ios|android)\) KabyMode\/[1-9][0-9]{0,2}/
      const inSimple = () => { try { return SIMPLE_UA.test(String(window.navigator.userAgent)) } catch (e) { return false } }
      /** How long the page waits, with nothing else able to answer, before it moves a blank chat to the phone's model: the model directory loads in pieces and a signed-in phone's cloud models come a moment after the phone's own. */
      const AUTO_WAIT_MS = 3000
      /**
       * Simple mode: the product rule « the phone's model answers when no other model can ». A BLANK chat that opens on a model nobody can answer with (the engine's default, with no key) is moved to the
       * phone's model, once. `others` is whether another model can answer (`cloudChoice` finds one): `true` = leave the choice to the engine, `null` = not known yet (the directory has not loaded): wait.
       * Never outside Simple (the full app keeps what the engine does), never for a chat that is already on the phone's model, never for one that started (the model was chosen, by the person or by Kaby).
       */
      const wantsPhoneModel = ({ simple, available, installed, modelId, phone, blank, others, done }) => simple === true && available === true && installed === true && typeof modelId === 'string' && MODEL_ID.test(modelId) && phone !== true && blank === true && others === false && done !== true
      /**
       * Simple mode, the signed-out phone: the app can manage the phone's models (`supported`), the small model is NOT on the phone (never installed, or the installation was closed before it ended: `none` or
       * `failed`, never while it downloads or loads) and no other model can answer (`others === false`: nobody signed in, no key; `null` = not known yet): the chat has nobody to answer, so the page draws one card
       * that opens the app's models screen. Never outside Simple, never on a phone that has a model or another way to answer.
       */
      const needsModelStep = ({ simple, app, others }) => simple === true && app !== null && app !== undefined && typeof app === 'object' && app.supported === true && app.installed !== true && (app.phase === 'none' || app.phase === 'failed') && others === false
      /** Whether the model directory has loaded (its catalog holds the groups): until then « no other model » means « not known yet ». */
      const catalogLoaded = (dirs) => { try { const v = dirs.catalog.store.getSnapshot().value; return v !== null && v !== undefined && typeof v === 'object' && Array.isArray(v.groups) } catch (e) { return false } }
      /** How long after a flow opened a chat the page may still move it off the phone's model (after that the model is the person's own choice). */
      const FLOW_WINDOW_MS = 15000
      /** A flow finds its chat within about five seconds; an event that arrives later than this after the flow began belongs to a page that was asleep. */
      const FLOW_START_SLACK_MS = 8000
      /** How often the page asks the host for its state again while the line is on screen (the host polls the app every ten seconds). */
      const HOST_REREAD_MS = 8000
      /** What the page does for a blank chat recorded on Discussion: how long it waits for the host to name the light agent (a whole poll of the host and more), how often it asks, and how long it waits for the engine to record the choice. A test shortens them. */
      const RECHECK = { maxMs: 30000, stepMs: 1500, recordMs: 4000 }

      // ── what the page knows ─────────────────────────────────────────────────────────────────────────────────────
      const store = { available: false, installed: false, tools: false, modelId: '', preset: undefined, app: null, subs: new Set(), flows: new Map() }
      // What a live check reads (`window.__KB_PHONE_MODEL__`, read-only): what the page knows and what the last chat it drew saw. Nothing here is a key, an address or a path.
      const probe = { seen: null, decided: null, auto: null }
      const notify = () => { for (const f of Array.from(store.subs)) { try { f() } catch (e) { /* a listener died */ } } }
      const readHost = async () => {
        try {
          const res = await fetch('/phone-model/state', { cache: 'no-store', credentials: 'same-origin' })
          if (res.status !== 200) { store.available = false; store.tools = false; store.modelId = ''; store.preset = undefined; return notify() }
          const body = await res.json()
          store.available = body !== null && typeof body === 'object' && body.available === true
          store.installed = store.available && body.installed === true
          // the app says its model takes tools (`"tools": true` on its row): the label tells it, and a host that does not name a preset yet (an older one) is read from this flag
          store.tools = store.installed && body.model !== null && typeof body.model === 'object' && body.model.tools === true
          store.modelId = store.installed && body.model !== null && typeof body.model === 'object' && typeof body.model.id === 'string' && MODEL_ID.test(body.model.id) ? body.model.id : ''
          // the preset to select, decided by the host where the registry is known: `light-agent` once registered, `discussion`, or `null` (not ready: ask again)
          store.preset = body.preset === LIGHT || body.preset === PRESET ? body.preset : (body.preset === null ? null : (store.tools === true ? LIGHT : PRESET))
        } catch (e) { store.available = false; store.tools = false; store.modelId = ''; store.preset = undefined }
        notify()
      }
      /**
       * The preset a blank chat on the phone's model gets, read FRESH from the host right before the choice: the page used to read the state once, at load, usually before the host's
       * first poll of the app had finished, so the model looked like one without tools and every chat after got Discussion. While the host says « not ready » (the model takes tools and the
       * preset is being registered, or the first poll is still running) the page asks again for up to three seconds, then takes Discussion.
       */
      const decidePreset = async (maxMs = 3000, stepMs = 500, alive = () => true) => {
        const rounds = Math.max(1, Math.round(maxMs / stepMs))
        for (let i = 0; i < rounds && alive(); i += 1) {
          await readHost()
          if (store.preset === LIGHT || store.preset === PRESET) return store.preset
          await new Promise((resolve) => { setTimeout(resolve, stepMs) })
        }
        return PRESET
      }
      /** Asks the app « tell me the state now » (also tells it that this page speaks the contract). Never throws. */
      const askApp = () => {
        try {
          const w = window.ReactNativeWebView
          if (w !== undefined && w !== null && typeof w.postMessage === 'function') w.postMessage(JSON.stringify({ kybernos: MESSAGE, version: 1, op: 'state' }))
        } catch (e) { /* no app around */ }
      }
      const openManage = () => { try { window.location.assign('kybernos://models') } catch (e) { /* the app handles the link */ } }

      const CSS = [
        // The composer seat the engine draws is transparent at its top edge and fades into the page colour over its first 36 px: a line standing there let the messages scrolling under the
        // composer show through its text (text on text, seen on the phone with the keyboard open). The line carries the page colour itself.
        '.kbpm-line{box-sizing:border-box;display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 10px;margin:0 auto;padding:4px 12px;font-size:12px;line-height:1.4;color:var(--dsw-alias-label-caption,currentColor);background:var(--dsw-alias-bg-base,Canvas);overflow-wrap:anywhere}',
        '.kbpm-line[data-tone="note"]{color:var(--dsw-alias-label-secondary,currentColor)}',
        '.kbpm-manage{position:relative;padding:0;border:0;background:none;font:inherit;color:var(--dsw-alias-state-business-primary,currentColor);text-decoration:underline;cursor:pointer}',
        '.kbpm-manage:after{content:"";position:absolute;inset:-14px -8px}',
        '.kbpm-manage:focus-visible{outline:2px solid var(--dsw-focus-ring-color,currentColor);outline-offset:2px}',
        // the card of a chat with nobody to answer: on the page colour, a rule round it, the button the one thing to press
        '.kbpm-card{box-sizing:border-box;margin:0 auto 6px;max-width:520px;width:calc(100% - 24px);padding:12px 14px;border:1px solid var(--dsw-alias-border-l2,currentColor);border-radius:12px;background:var(--dsw-alias-bg-layer-1,Canvas);color:var(--dsw-alias-label-primary,currentColor)}',
        '.kbpm-card-t{font-size:14px;font-weight:600;line-height:1.35}',
        '.kbpm-card-s{margin:4px 0 10px;font-size:13px;line-height:1.45;color:var(--dsw-alias-label-secondary,currentColor);overflow-wrap:anywhere}',
        '.kbpm-card-b{min-height:44px;padding:0 16px;border:0;border-radius:10px;font:inherit;font-weight:600;cursor:pointer;background:var(--dsw-alias-label-primary,currentColor);color:var(--dsw-alias-bg-base,Canvas)}',
        '.kbpm-card-b:focus-visible{outline:2px solid var(--dsw-focus-ring-color,currentColor);outline-offset:2px}'
      ].join('\n')

      // ── the line above the composer ─────────────────────────────────────────────────────────────────────────────
      // Mounted in `conversation.input.dock`, which the engine draws for the new chat (a blank session) as well as for a started one: the preset must be chosen BEFORE the
      // first turn, and the composer's own dock only exists after it.
      const Line = (props) => {
        const p = props !== null && props !== undefined ? props : {}
        const sessionId = typeof p.sessionId === 'string' ? p.sessionId : (p.session !== null && typeof p.session === 'object' && typeof p.session.id === 'string' ? p.session.id : '')
        const select = typeof p.select === 'function' ? p.select : null
        const modelStore = p.modelStore !== null && p.modelStore !== undefined && typeof p.modelStore.getSnapshot === 'function' ? p.modelStore : null
        const directory = p.directory !== null && p.directory !== undefined && typeof p.directory.select === 'function' ? p.directory : null
        const sessions = p.sessions !== null && p.sessions !== undefined && p.sessions.list !== undefined ? p.sessions : null
        const readSession = () => {
          try {
            const row = sessions === null || sessionId === '' ? undefined : sessions.list.getSnapshot().byId[sessionId]
            if (row === undefined || row === null) return { preset: undefined, blank: undefined }
            const v = row.projectionValues !== undefined && row.projectionValues !== null ? row.projectionValues.agentPreset : undefined
            return { preset: typeof v === 'string' ? v : undefined, blank: typeof row.blank === 'boolean' ? row.blank : undefined }
          } catch (e) { return { preset: undefined, blank: undefined } }
        }
        const [, bump] = React.useReducer((n) => n + 1, 0)
        const [current, setCurrent] = React.useState(() => { try { return modelStore === null ? null : (modelStore.getSnapshot() || {}).current || null } catch (e) { return null } })
        const [row, setRow] = React.useState(readSession)
        const [tried, setTried] = React.useState('none')
        const [flash, setFlash] = React.useState(false)
        const [left, setLeft] = React.useState(null) // what the page did for a chat a flow opened: { kind: 'switched', name } or { kind: 'none' }
        const autoDone = React.useRef('') // the chat the page already moved to the phone's model (Simple mode)
        const appliedFrom = React.useRef(undefined) // the preset the chat recorded when our select succeeded
        const attempts = React.useRef(0)
        React.useEffect(() => { store.subs.add(bump); return () => { store.subs.delete(bump) } }, [])
        React.useEffect(() => {
          if (modelStore === null) return undefined
          const read = () => { try { setCurrent((modelStore.getSnapshot() || {}).current || null) } catch (e) { /* the last reading stays */ } }
          read()
          let off = null
          try { off = modelStore.subscribe(read) } catch (e) { off = null }
          return () => { if (typeof off === 'function') { try { off() } catch (e) { /* gone */ } } }
        }, [modelStore])
        React.useEffect(() => {
          if (sessions === null) return undefined
          const read = () => { const next = readSession(); setRow((old) => (old.preset === next.preset && old.blank === next.blank ? old : next)) }
          read()
          let off = null
          try { off = sessions.list.subscribe(read) } catch (e) { off = null }
          return () => { if (typeof off === 'function') { try { off() } catch (e) { /* gone */ } } }
        }, [sessions, sessionId])
        const preset = row.preset
        const phone = store.available === true && isPhoneModel(current)
        let step = nextStep({ phone, preset, blank: row.blank, tried })
        // Our select went through but the chat has not recorded Discussion yet: wait for the engine's event instead of asking again.
        if (step === 'select' && tried === 'applied' && preset === appliedFrom.current) step = 'wait'
        probe.seen = { props: Object.keys(p).sort(), sessionId, current, preset: preset === undefined ? null : preset, blank: row.blank === undefined ? null : row.blank, phone, step, tried }
        React.useEffect(() => {
          if (step !== 'select' || select === null || sessionId === '') return undefined
          if (attempts.current >= 3) { setTried('locked'); return undefined }
          attempts.current += 1
          let live = true
          const flipped = tried === 'applied'
          // the light agent first when the host says it is registered; if the engine refuses it for any reason but « the chat has started », Discussion (never the full agent in a 4096-token window)
          const choose = async () => {
            const want = await decidePreset()
            probe.decided = want
            let result = await select(sessionId, want)
            if (want === LIGHT && result !== null && typeof result === 'object' && result.ok !== true && !isLocked(result)) { probe.decided = PRESET; result = await select(sessionId, PRESET) }
            return result
          }
          Promise.resolve().then(choose).then((result) => {
            if (!live) return
            if (result !== null && typeof result === 'object' && result.ok === true) {
              appliedFrom.current = preset
              if (flipped) setFlash(true)
              setTried('applied')
            } else setTried(isLocked(result) ? 'locked' : 'applied')
          }).catch(() => { if (live) setTried('applied') })
          return () => { live = false }
        }, [step, sessionId, select, preset])
        React.useEffect(() => {
          if (step !== 'wait') return undefined
          const t = setTimeout(() => setTried('locked'), 3000)
          return () => clearTimeout(t)
        }, [step])
        // A BLANK chat the engine hands back already recorded as Discussion. The engine keeps the blank chat of a workspace and reopens it under the preset its log recorded
        // (`restoreBlank`, `createInWorkspace`): after an earlier test (or an earlier version of this page, or a moment when the host had not finished its first poll of the app) the
        // chat the person opens next is that one, `nextStep` sees a preset and draws the line, and the light agent is never chosen. So a blank chat on Discussion is looked at again
        // with the host's fresh answer and goes to the light agent when the host names it; a chat that has started, or a host that names Discussion, is left alone.
        // The look is not once per chat: it starts again each time the host's ANSWER changes (unknown → light agent, Discussion → light agent…), and when the model is chosen again, so a
        // wait that ended before the host was ready no longer leaves the chat on Discussion for good (the launch page said « chat only » on a phone whose host named the light agent).
        const hostSays = store.preset === LIGHT || store.preset === PRESET ? store.preset : 'unknown'
        const wantsRecheck = phone && preset === PRESET && row.blank === true && select !== null && sessionId !== ''
        const selectRef = React.useRef(select)
        selectRef.current = select
        const recheck = React.useRef({ key: '', phase: 'none' }) // phase: `pending` | `ended` | `locked`, for the chat and the host answer named by key
        const rechecks = React.useRef({ id: '', n: 0 }) // how many times the page asked the engine for the light agent on this chat (a host that flips back and forth cannot loop)
        React.useEffect(() => {
          if (!wantsRecheck) { recheck.current = { key: '', phase: 'none' }; return undefined }
          const key = sessionId + '|' + hostSays
          recheck.current = { key, phase: 'pending' }
          bump()
          let live = true
          let timer = null
          const settle = (phase) => { if (live) { recheck.current = { key, phase }; bump() } }
          // the chat is on a safe preset already, so here the page may wait for a whole poll of the host (ten seconds) and more
          Promise.resolve().then(async () => {
            const want = await decidePreset(RECHECK.maxMs, RECHECK.stepMs, () => live)
            if (!live) return
            probe.decided = want
            if (rechecks.current.id !== sessionId) rechecks.current = { id: sessionId, n: 0 }
            if (want !== LIGHT || rechecks.current.n >= 4) return settle('ended')
            rechecks.current.n += 1
            const result = await selectRef.current(sessionId, LIGHT)
            if (!live) return
            if (result !== null && typeof result === 'object' && result.ok === true) {
              // the engine took it: the chat records the light agent in a moment and the line follows; if that event never comes, the wait ends here
              timer = setTimeout(() => settle('ended'), RECHECK.recordMs)
              return
            }
            probe.decided = PRESET // refused: the chat stays on Discussion, as it was
            settle(isLocked(result) ? 'locked' : 'ended')
          }).catch(() => settle('ended'))
          return () => { live = false; if (timer !== null) clearTimeout(timer) }
        }, [wantsRecheck, sessionId, hostSays])
        // Where the page does not look again (no `select`, no chat id) nothing is pending; otherwise the verdict counts for the host answer it was made on
        const rechecking = recheck.current.key === sessionId + '|' + hostSays ? recheck.current.phase : (wantsRecheck ? 'pending' : 'ended')
        // The words on the line (the mode and, for chat only, why) come from what the host said LAST: read it again while the line is on screen, not only at page load (before the
        // host's first poll of the app the model looked like one without tools, and the line said « the app does not report tools » on a phone whose app does).
        React.useEffect(() => {
          readHost()
          const t = setInterval(readHost, HOST_REREAD_MS)
          return () => clearInterval(t)
        }, [])
        // A chat opened by a flow (« Create » in Automations, a skill, a team) is an agent chat that expects tools: the small model cannot do it and would only SAY it does. The chat
        // inherits the model last chosen, so when that is the phone's, it moves to a cloud model now (once, and only within a few seconds of the flow's start: later the model is the person's own choice).
        const flowAt = store.flows.get(sessionId)
        const wantsCloud = flowAt !== undefined && Date.now() - flowAt < FLOW_WINDOW_MS && row.blank !== false
        React.useEffect(() => {
          if (!wantsCloud || sessionId === '') return undefined
          if (!phone) { if (current !== null) store.flows.delete(sessionId); return undefined } // the chat already runs on another model: nothing to move (and the flow is forgotten)
          store.flows.delete(sessionId)
          const pick = directory === null ? null : cloudChoice(p.dirs, directory)
          if (pick === null) { setLeft({ kind: 'none' }); return undefined }
          Promise.resolve().then(() => directory.select({ provider: pick.provider, model: pick.model })).then((result) => {
            setLeft(result !== null && typeof result === 'object' && result.ok === false ? { kind: 'none' } : { kind: 'switched', name: pick.name })
          }).catch(() => { setLeft({ kind: 'none' }) })
          return undefined
        }, [phone, wantsCloud, sessionId, directory])
        // Simple mode: a blank chat that nothing can answer (no key, nobody signed in) is moved to the phone's model, so that the first message has an answer (wantsPhoneModel says when); the picker stays the person's. Once per chat, after a short wait for the directory.
        const simple = inSimple()
        const catalogOn = directory !== null && p.dirs !== undefined && p.dirs !== null && catalogLoaded(p.dirs)
        let others = null
        try { if (catalogOn) others = cloudChoice(p.dirs, directory) !== null } catch (e) { others = null }
        const autoAsk = { simple, available: store.available, installed: store.installed, modelId: store.modelId, phone: isPhoneModel(current), blank: row.blank, others, done: autoDone.current === sessionId }
        const wantsAuto = sessionId !== '' && directory !== null && wantsPhoneModel(autoAsk)
        // what the directory holds, for a live check: the providers and how many models each lists (names and counts only), and the default model the catalog names
        let held = null
        try {
          const sum = (g) => (Array.isArray(g) ? g.map((x) => ({ id: x && x.id, n: x && Array.isArray(x.models) ? x.models.length : -1 })) : null)
          const cat = p.dirs !== undefined && p.dirs !== null ? p.dirs.catalog.store.getSnapshot().value : null
          const dgr = directory !== null ? directory.store.getSnapshot().groups : null
          held = { catalog: cat !== null && cat !== undefined ? sum(cat.groups) : null, directory: sum(dgr), def: cat !== null && cat !== undefined && cat.default !== null && typeof cat.default === 'object' ? { provider: cat.default.provider, model: cat.default.model } : null }
        } catch (e) { held = null }
        probe.auto = { simple, catalog: catalogOn, others, phone: autoAsk.phone, blank: row.blank === undefined ? null : row.blank, wants: wantsAuto, did: autoDone.current === sessionId, held }
        React.useEffect(() => {
          if (!wantsAuto) return undefined
          const t = setTimeout(() => {
            if (autoDone.current === sessionId) return
            autoDone.current = sessionId
            probe.auto = Object.assign({}, probe.auto, { did: true })
            Promise.resolve().then(() => directory.select({ provider: PROVIDER, model: store.modelId })).catch(() => { /* the chat keeps the model it has */ })
          }, AUTO_WAIT_MS)
          return () => clearTimeout(t)
        }, [wantsAuto, sessionId, directory])
        React.useEffect(() => {
          if (left === null || left.kind !== 'switched') return undefined
          const t = setTimeout(() => setLeft(null), 10000)
          return () => clearTimeout(t)
        }, [left])
        React.useEffect(() => {
          if (!flash) return undefined
          const t = setTimeout(() => setFlash(false), 6000)
          return () => clearTimeout(t)
        }, [flash])
        const mode = modeNote({ preset, blank: row.blank, host: store.preset, tools: store.tools, recheck: rechecking })
        Object.assign(probe.seen, { host: hostSays, recheck: rechecking, mode })
        if (needsModelStep({ simple, app: store.app, others })) {
          return h('div', { className: 'kbpm-card', 'data-kb': 'phone-model-step', role: 'region', 'aria-label': say(WORDS.stepTitle) },
            h('div', { className: 'kbpm-card-t' }, say(WORDS.stepTitle)),
            h('div', { className: 'kbpm-card-s' }, say(WORDS.stepText)),
            h('button', { type: 'button', className: 'kbpm-card-b', 'data-act': 'get-model', onClick: openManage }, say(WORDS.stepButton)))
        }
        if (left !== null) return h('div', { className: 'kbpm-line', 'data-kb': 'phone-model-line', 'data-tone': 'note', role: 'status' }, left.kind === 'switched' ? say(WORDS.switchedToCloud).replace('{name}', left.name) : say(WORDS.needsCloud))
        if (step === 'idle' || step === 'select' || step === 'wait') return null
        if (step === 'start-new') return h('div', { className: 'kbpm-line', 'data-kb': 'phone-model-line', 'data-tone': 'note', role: 'status' }, say(WORDS.startNew))
        return h('div', { className: 'kbpm-line', 'data-kb': 'phone-model-line', role: 'status' },
          h('span', null,
            say(flash ? (store.tools === true ? WORDS.presetOnly : WORDS.discussionOnly) : (store.app !== null && store.app.phase === 'loading' ? WORDS.loading : (preset === LIGHT ? WORDS.labelLight : WORDS.label))),
            // which mode this chat is in and, for chat only, why: a tester has no debugger on a phone
            flash || (store.app !== null && store.app.phase === 'loading') || mode === null ? null : h('span', { className: 'kbpm-mode', 'data-kb': 'phone-model-mode', 'data-mode': preset === LIGHT ? 'light' : 'chat', 'data-tools': store.tools === true ? 'true' : 'false' }, ' · ' + say(WORDS[mode]))),
          store.app !== null && store.app.supported === true
            ? h('button', { type: 'button', className: 'kbpm-manage', 'data-act': 'manage-models', onClick: openManage }, say(WORDS.manage))
            : null)
      }

      return {
        name: 'kybernos-phone-model',
        inject: ['slots'],
        __test: { parseAppMessage, isPhoneModel, nextStep, modeNote, isLocked, cloudChoice, decidePreset, RECHECK, WORDS, CSS, PROVIDER, PRESET, LIGHT, wantsPhoneModel, needsModelStep, catalogLoaded, SIMPLE_UA, AUTO_WAIT_MS },
        apply (ctx) {
          // The page does nothing until the host half says it is active.
          ctx.effect(() => {
            try { Object.defineProperty(window, '__KB_PHONE_MODEL__', { configurable: true, get: () => ({ available: store.available, installed: store.installed, tools: store.tools, preset: store.preset === undefined ? null : store.preset, decided: probe.decided, app: store.app, seen: probe.seen, auto: probe.auto }) }) } catch (e) { /* no window */ }
            return () => { try { delete window.__KB_PHONE_MODEL__ } catch (e) { /* gone */ } }
          }, 'kybernos-phone-model: probe for the live check')
          ctx.effect(() => {
            let alive = true
            const refresh = () => { if (alive) { readHost(); askApp() } }
            refresh()
            const onVisible = () => { try { if (document.visibilityState === 'visible') refresh() } catch (e) { /* no document */ } }
            // The app's message arrives through `window.__KB_APP__.receive`, which the Kaby-mode bundle turns into this cancelable event for messages it does not know.
            const onApp = (ev) => {
              const s = parseAppMessage(ev !== null && ev !== undefined ? ev.detail : null)
              if (s === null) return
              store.app = s
              try { ev.preventDefault() } catch (e) { /* not cancelable */ }
              notify()
            }
            // The core bundle says « this chat was opened by a flow » (`kb-flow-chat`, detail.sessionId): Create, a skill, a team.
            const onFlow = (ev) => {
              try {
                const detail = ev !== null && ev !== undefined && ev.detail !== null && typeof ev.detail === 'object' ? ev.detail : {}
                const sid = detail.sessionId
                // `startedAt`: when the flow began. A flow that found its chat late (a page put to sleep in the middle of the wait) says so, and is not a chat the person just opened by hand.
                if (typeof detail.startedAt === 'number' && Date.now() - detail.startedAt > FLOW_START_SLACK_MS) return
                if (typeof sid === 'string' && sid !== '') { store.flows.set(sid, Date.now()); notify() }
              } catch (e) { /* not an event of ours */ }
            }
            try { document.addEventListener('visibilitychange', onVisible); window.addEventListener('kb-app-message', onApp); window.addEventListener('kb-flow-chat', onFlow) } catch (e) { /* no window */ }
            return () => {
              alive = false
              try { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('kb-app-message', onApp); window.removeEventListener('kb-flow-chat', onFlow) } catch (e) { /* gone */ }
            }
          }, 'kybernos-phone-model: host state and the app message')
          ctx.effect(() => {
            const style = document.createElement('style')
            style.setAttribute('data-plugin', '@local/kybernos-phone-model')
            style.textContent = CSS
            document.head.appendChild(style)
            return () => { try { style.remove() } catch (e) { /* gone */ } }
          }, 'kybernos-phone-model: styles')
          try {
            ctx.inject(['slots', 'sessions', 'modelDirectories', 'remote', 'remote.agentPresets'], (scope) => {
              try {
                const dirs = scope.modelDirectories
                const presets = scope.remote !== undefined && scope.remote !== null ? scope.remote.agentPresets : undefined
                if (dirs === null || dirs === undefined || typeof dirs.directoryFor !== 'function') return
                const select = presets !== undefined && presets !== null && typeof presets.select === 'function' ? (id, preset) => presets.select(id, preset) : null
                scope.effect(() => scope.slots.inject('conversation.input.dock', () => scope.slots.register(
                  { name: 'conversation.input.dock', id: 'kybernos-phone-model', order: 6 },
                  (props) => {
                    try {
                      const p = props !== null && props !== undefined ? props : {}
                      const sessionId = typeof p.sessionId === 'string' ? p.sessionId : (p.session !== null && typeof p.session === 'object' && typeof p.session.id === 'string' ? p.session.id : undefined)
                      const dir = typeof sessionId === 'string' ? dirs.directoryFor(sessionId) : null
                      return h(Line, { ...p, sessionId, select, sessions: scope.sessions, modelStore: dir !== null && dir !== undefined ? dir.store : null, directory: dir, dirs })
                    } catch (e) { return null }
                  })), 'kybernos-phone-model: the line above the composer')
              } catch (e) { /* the composer stays as DSH draws it */ }
            })
          } catch (e) { /* no model directory: nothing to draw */ }
        }
      }
    } catch (error) {
      try { console.warn('[kybernos-phone-model] disabled:', error) } catch (e) { /* no console */ }
      return { apply () {} }
    }
  }
})
