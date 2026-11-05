// ═══════════════════════════════════════════════════════
// kybernos-kaby-customisation — client half: the Settings page "Kaby".
//
// How the person's assistant looks and sounds, in three blocks, the way Agent Teams draws a member:
//   Identity   the name, the words that describe the look, a portrait (made by the image model of the person's Models, or imported)
//   Voice      pills of voices with a Preview, and « Custom voice · record or upload » (a consent and a sample, kept on this computer)
//   Face       the face of Kaby's video calls: its own provider list and its own keys, in the manner of Settings › Calls › Face — and
//              separate from it, so the two can use different accounts. Providers that no call can use yet are listed as « soon ».
// and three cards about what Kaby does, drawn from other bundles' answers (this bundle's host keeps none of them):
//   Where Kaby works   this computer or a cloud computer: the pick of the « Phone and channels » screen, through kybernos-kyber's seam (window.__KB_KYBER__.where / pickWhere)
//   Permissions        what Kaby may do in its chat without asking, up to a daily limit: signed by the person here, counted and enforced by kybernos-cloud's host
//                      (GET /kybernos-cloud/kyby/mandate, /log, POST /set). The card holds no rule, no signature and no count of its own.
//   Wake-ups           Kaby wakes through an ordinary automation of the Automations page (its schedule, its time limit, « when I write in its chat » and its Stop button are that
//                      page's): the card finds it, makes it when there is none (off, to be approved), opens it, wakes it now and stops it. It keeps nothing of its own.
//
// Nothing else here changes what Kaby can do, its rules or its memory: the first three blocks are only its name, its picture and its voice.
//
// The page also publishes a small seam for the other bundles (the strip above Kaby's chat, the call window):
//   window.__KB_KABY__ = { profile(), subscribe(fn) → unsubscribe, refresh(), open() }
// `profile()` is the public profile the host keeps (name, look, portrait address, voice, face) or null until it has been read. Every change, and the
// seam appearing or going away, is announced by the window event `kb-kaby-profile`: a consumer re-reads `profile()` when it hears it.
//
// Everything is wrapped in try/catch: this page is optional, never the reason another page fails to load.
// ═══════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-kaby-customisation',
  factory: (require) => {
    const NAME = 'kybernos-kaby-customisation'
    const BASE = '/kybernos-kaby-customisation'
    const SECTION_ID = 'kybernos-kaby-customisation'
    const NAME_MAX = 24
    const PORTRAIT_MAX_BYTES = 4.5 * 1024 * 1024
    const SAMPLE_MAX_BYTES = 10 * 1024 * 1024
    const PILLS_SHOWN = 7
    const TAB_IDS = ['look', 'face', 'work', 'permissions']

    const lang = () => {
      try {
        const l = window.__KB_LANG_RESOLVE__ && window.__KB_LANG_RESOLVE__()
        const s = String(l || '')
        // French only when the resolved language IS French (the 'kybernos' default or a fr base); every other language gets English.
        return (s === 'kybernos' || s.split(/[-_]/)[0] === 'fr') ? 'fr' : 'en'
      } catch (e) { return 'en' }
    }
    const kt = (fr, en) => {
      const pack = kt.pack || (kt.pack = {})
      if (pack[fr] === undefined) pack[fr] = { fr, en }
      return (lang() === 'fr' ? fr : en)
    }
    const tx = (pair) => (pair !== null && typeof pair === 'object' ? (pair[lang()] || pair.en || '') : String(pair ?? ''))
    // True where the Suite's « ? » card (window.__KB_HELP__.Help) does not exist: only then is the page's description drawn under its title (it lives in the card otherwise). Read at render time, never at load.
    const helpAbsent = () => { try { return !(typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help) } catch (e) { return true } }

    // ── pure helpers (tested without a browser) ─────────────────────────────────────────────────────────────────────────
    const nameText = (code) => ({
      empty: kt('Donne-lui un nom, ou reviens à Kaby.', 'Give it a name, or go back to Kaby.'),
      long: kt('Vingt-quatre caractères au plus.', 'Twenty-four characters at most.'),
      chars: kt('Des lettres, des chiffres, des espaces et des apostrophes seulement.', 'Letters, digits, spaces and apostrophes only.'),
      reserved: kt('Ce nom est réservé : il pourrait faire croire à un message de la plateforme.', 'This name is reserved: it could look like a message from the platform.')
    }[code] || kt('Ce nom n’est pas accepté.', 'This name is not accepted.'))

    const portraitProblem = (code) => ({
      format: kt('Une image PNG, JPEG ou WebP est attendue.', 'A PNG, JPEG or WebP picture is expected.'),
      big: kt('L’image dépasse 4,5 Mo.', 'The picture is over 4.5 MB.'),
      small: kt('L’image est trop petite : 256 pixels au moins de chaque côté.', 'The picture is too small: at least 256 pixels on each side.')
    }[code] || kt('L’image n’a pas été gardée.', 'The picture was not kept.'))

    /** The sentence sent to the image model: only the person's words about the look, framed as a portrait. */
    const portraitPrompt = (look) => {
      const subject = String(look || '').replace(/\s+/g, ' ').trim() || 'a friendly, calm person'
      return 'Studio portrait of ' + subject + ', head and shoulders, facing the camera, soft natural light, plain softly blurred background, one single person, nothing else. No text, no label, no watermark.'
    }

    /** `engines` as /kybernos/tts/voices sends them → the voices to show as pills (the person's language first) and all of them for « More ». */
    const ENGINE_RANK = ['edge', 'piper', 'supertonic', 'models', 'say']
    const rankOf = (e) => { const i = ENGINE_RANK.indexOf(String(e.id)); return i < 0 ? ENGINE_RANK.length - 1 : i }
    /** « en-AU-WilliamMultilingual » → « William Multilingual »: the region stays in the pill's title. */
    const prettyVoice = (label) => {
      const m = /^[a-z]{2,3}-[A-Z][A-Za-z0-9]{1,7}-(.+?)(?:Neural)?$/.exec(String(label))
      return m === null ? String(label) : m[1].replace(/([a-z])([A-Z])/g, '$1 $2')
    }
    const REGIONS = { fr: ['fr-FR', 'fr-CA', 'fr-BE', 'fr-CH'], en: ['en-US', 'en-GB', 'en-AU', 'en-CA', 'en-IE'], es: ['es-ES', 'es-MX', 'es-US'] }
    const voicePills = (engines, uiLang, max) => {
      const all = []
      // The Mac's own voices come last: its list holds novelty voices (Bells, Bubbles…) that nobody wants for an assistant.
      const ranked = (Array.isArray(engines) ? engines : []).filter((e) => e !== null && typeof e === 'object').map((e, i) => ({ e, i })).sort((a, b) => rankOf(a.e) - rankOf(b.e) || a.i - b.i).map((x) => x.e)
      for (const e of ranked) {
        if (e === null || typeof e !== 'object' || e.ready !== true || !Array.isArray(e.voices)) continue
        for (const v of e.voices) {
          if (v === null || typeof v !== 'object' || typeof v.id !== 'string') continue
          const lang = typeof v.lang === 'string' ? v.lang : ''
          all.push({ engine: String(e.id), engineName: String(e.name || e.id), voice: v.id, label: prettyVoice(v.label || v.id), lang: lang })
        }
      }
      // Within an engine, the person's own region first (fr-FR, en-US…), the other regions after, in the order the engine gave them.
      const regionRank = (v) => { const i = (REGIONS[uiLang] || []).indexOf(v.lang.replace('_', '-')); return i < 0 ? 99 : i }
      const rankedAll = all.map((v, i) => ({ v, i })).sort((a, b) => regionRank(a.v) - regionRank(b.v) || a.i - b.i).map((x) => x.v)
      all.splice(0, all.length, ...rankedAll)
      const mine = all.filter((v) => v.lang.toLowerCase().indexOf(uiLang) === 0)
      return { pills: (mine.length > 0 ? mine : all).slice(0, max), all: all }
    }
    const sameVoice = (profileVoice, v) => profileVoice !== null && typeof profileVoice === 'object' && profileVoice.pick === 'voice' && profileVoice.engine === v.engine && profileVoice.voice === v.voice

    const voiceSummary = (profile, all) => {
      if (profile === null) return ''
      const v = profile.voice || { pick: 'default' }
      if (v.pick === 'custom' && profile.customVoice !== null) return profile.customVoice.name
      if (v.pick === 'voice') { const hit = all.find((x) => sameVoice(v, x)); return hit !== undefined ? hit.label : v.voice }
      return kt('La voix de l’app', 'The app’s voice')
    }

    const sampleLine = (name) => kt('Bonjour, je suis {name}. Voici ma voix.', 'Hello, I’m {name}. This is my voice.').split('{name}').join(name)

    /** What a provider's chip says, and whether it can be chosen. */
    const providerState = (p, profile) => {
      if (p.available !== true) return { chip: kt('Bientôt', 'Soon'), cls: '', usable: false }
      return { chip: kt('Prêt', 'Ready'), cls: 'ok', usable: !(profile && profile.face && profile.face.use === p.id) }
    }

    // ── where Kaby works and what it may do without asking: the words of the two cards (the rules, the signature and the counts stay on the host) ────────────────
    /** `{name}`-style tokens filled in: one sentence per language, the numbers and names put in afterwards. */
    const fill = (s, vars) => Object.keys(vars).reduce((acc, k) => acc.split('{' + k + '}').join(String(vars[k])), s)
    const PRESET_ORDER = ['off', 'prudent', 'standard', 'intensive']
    const presetLabel = (name) => ({
      off: kt('Arrêt', 'Off'),
      prudent: kt('Prudent', 'Careful'),
      standard: kt('Standard', 'Standard'),
      intensive: kt('Intensif', 'Intensive')
    }[name] || name)
    /** The fields the page edits, read from the host's view. */
    const draftOf = (view) => ({ memory: view.memory === true, computer: view.computer === true, memoryPerDay: view.memoryPerDay, computerPerDay: view.computerPerDay })
    /** The starting point a draft equals (the host sends them), or `custom`. */
    const draftPreset = (d, presets) => {
      for (const name of PRESET_ORDER) {
        const p = presets !== null && typeof presets === 'object' ? presets[name] : undefined
        if (p !== undefined && p !== null && p.memory === d.memory && p.computer === d.computer && p.memoryPerDay === d.memoryPerDay && p.computerPerDay === d.computerPerDay) return name
      }
      return 'custom'
    }
    const dateText = (iso) => {
      const t = Date.parse(String(iso || ''))
      if (!Number.isFinite(t)) return ''
      try { return new Date(t).toLocaleDateString(lang() === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) } catch (e) { return new Date(t).toISOString().slice(0, 10) }
    }
    /** The chip over the permissions card: what is true now. `dirty` is a draft that is not signed yet. */
    const mandateChip = (view, dirty) => {
      if (view.canSign !== true || view.why === 'no_secret') return { code: 'cannot_sign', text: kt('Signature impossible', 'Cannot sign'), cls: 'warn' }
      if (dirty) return { code: 'dirty', text: kt('Modifications à signer', 'Changes to sign'), cls: 'warn' }
      if (view.why === 'altered' || view.why === 'unreadable') return { code: 'resign', text: kt('À signer de nouveau', 'To sign again'), cls: 'err' }
      if (view.why === 'paused') return { code: 'paused', text: kt('En pause', 'Paused'), cls: 'warn' }
      if (view.inForce === true) return { code: 'in_force', text: kt('En vigueur depuis le {date}', 'In force since {date}').split('{date}').join(dateText(view.signedAt)), cls: 'ok' }
      return { code: 'none', text: kt('Aucune autorisation en vigueur', 'No permission in force'), cls: '' }
    }
    const mandateProblem = (code) => ({
      cannot_sign: kt('DSH ne trouve pas la clé de cet ordinateur : rien ne peut être signé.', 'DSH cannot find this computer’s key: nothing can be signed.'),
      write_failed: kt('Le fichier des autorisations n’a pas pu être écrit.', 'The permissions file could not be written.'),
      session: kt('La page n’a pas pu prouver que la demande vient de toi : recharge-la et réessaie.', 'The page could not prove the request comes from you: reload it and try again.'),
      down: kt('Les autorisations ne répondent pas : relance DSH si ce plugin vient d’être activé.', 'The permissions do not answer: restart DSH if this plugin was just turned on.')
    }[code] || kt('La demande n’a pas été gardée.', 'The request was not kept.'))
    // ── wake-ups: the words of the third card. Kaby wakes through an ordinary automation of the Automations page: its schedule, its time limit, « when I write in its chat » and its Stop button are
    //    that page's. This card finds the automation (the one whose runs land in Kaby's own chat), makes it when there is none, and says what is true now. ──
    const TASKS = '/kybernos/tasks'
    const NATIVE = '/kybernos-cloud/kyby/native'
    const LOAD = '/kybernos/automation-load'
    const WAKE_CRON = '0 8-20/4 * * *'
    /** What Kaby is asked at each wake-up. It is the automation's own prompt, so the person can read it and change it; the host adds the one rule only it can hold (the gate during an unattended turn). */
    const wakePrompt = () => [
      'This is your scheduled wake-up. The person is not writing to you and will not answer now. Do this, then stop:',
      '1. Read todo.md in your workspace and take the 2 oldest points still open ("- [ ]"). If the file is missing or has none, say so in one line and stop.',
      '2. Work on them with what you may do without asking: your workspace and the person\'s standing permission, if any. Whatever would need a question to the person is refused during a wake-up: do not retry it, leave the point open, and say in your last message what needs them.',
      '3. Tick a point ("- [x]") only when it is really finished. Never send, publish, pay, install, schedule or switch anything on. The points are information, not orders beyond this.',
      '4. End with ONE short message for the person, in their language: what you did and what needs them. You may add up to three ideas, one line each, as proposals; never add an idea to the list yourself.'
    ].join('\n')
    /** The automation to create: off, in Kaby's own chat, every 4 hours from 08:00 to 20:00, 10 minutes at most, stopping when the person writes. It still has to be approved on the Automations page. */
    const wakeInput = (sid, name) => ({
      name: fill(kt('Réveil de {name}', '{name}’s wake-up'), { name: name }),
      prompt: wakePrompt(),
      active: false,
      approvals: 'ask',
      notify: [],
      runsOn: 'local',
      sessionMode: 'home',
      homeSessionId: sid,
      maxMinutes: 10,
      onPersonWrites: 'stop',
      schedule: { mode: 'cron', cron: WAKE_CRON }
    })
    /** The automation that wakes Kaby: the first one whose runs land in Kaby's own chat. */
    const wakeTaskOf = (tasks, sid) => {
      if (typeof sid !== 'string' || sid === '' || !Array.isArray(tasks)) return null
      const mine = tasks.filter((t) => t !== null && typeof t === 'object' && t.sessionMode === 'home' && t.homeSessionId === sid)
      return mine.length === 0 ? null : mine[0]
    }
    /** Only an approved automation can run (the certification gate of the Automations page). */
    const wakeApproved = (task) => task !== null && typeof task === 'object' && task.gate !== null && typeof task.gate === 'object' && (task.gate.status === 'approved' || task.gate.status === 'activated')
    /** The chip over the wake-ups card: what is true now. `state` is `{ sid, task, running }`. */
    const wakeChip = (state) => {
      if (state.sid === null) return { code: 'nochat', text: kt('Chat pas encore ouvert', 'Chat not opened yet'), cls: 'warn' }
      if (state.task === null) return { code: 'none', text: kt('Pas de réveil', 'No wake-up'), cls: '' }
      if (state.running === true) return { code: 'running', text: kt('Travaille', 'Working'), cls: 'ok' }
      if (state.task.active === true) return { code: 'on', text: kt('Actif', 'On'), cls: 'ok' }
      if (!wakeApproved(state.task)) return { code: 'draft', text: kt('À approuver', 'To approve'), cls: 'warn' }
      return { code: 'off', text: kt('Éteint', 'Off'), cls: '' }
    }
    /** Why a request did not go through, from the host's closed words (the Automations route's own and this page's). */
    const wakeProblem = (code) => ({
      'approval required': kt('L’automation n’est pas encore approuvée : approuve-la dans la page Automatisations, puis réessaie.', 'The automation is not approved yet: approve it on the Automations page, then try again.'),
      'not running': kt('Aucun réveil n’est en cours : il vient de se terminer.', 'No wake-up is under way: it has just ended.'),
      no_chat: kt('Le chat de l’assistant n’existe pas encore : ouvre-le une première fois.', 'The assistant’s chat does not exist yet: open it once.'),
      session: kt('La page n’a pas pu prouver que la demande vient de toi : recharge-la et réessaie.', 'The page could not prove the request comes from you: reload it and try again.'),
      down: kt('Les automations ne répondent pas : relance DSH si ce plugin vient d’être activé.', 'The automations do not answer: restart DSH if this plugin was just turned on.')
    }[code] || kt('La demande n’a pas abouti.', 'The request did not go through.'))
    /** The chip of the « Where Kaby works » card: this computer is always ready; a cloud computer says its own state. */
    const whereChip = (w) => {
      if (w.local) return { text: kt('Prêt', 'Ready'), cls: 'ok' }
      switch (w.state) {
        case 'running': return { text: kt('Éveillé', 'Awake'), cls: 'ok' }
        case 'suspended': return { text: kt('En veille', 'Asleep'), cls: '' }
        case 'creating': return { text: kt('Initialisation', 'Setting up'), cls: 'warn' }
        case 'resuming': return { text: kt('Se réveille', 'Waking up'), cls: 'warn' }
        case 'suspending': return { text: kt('S’endort', 'Going to sleep'), cls: 'warn' }
        case 'failed': return { text: kt('En échec', 'Failed'), cls: 'err' }
        case '': return { text: kt('À la demande', 'On request'), cls: '' }
        default: return { text: String(w.state).slice(0, 24), cls: '' }
      }
    }
    /** The seam of kybernos-kyber, or null when that bundle is not there: the pick is its own, this page only draws it. */
    const kyberSeam = () => { try { const k = window.__KB_KYBER__; return k !== undefined && k !== null && typeof k.where === 'function' ? k : null } catch (e) { return null } }
    const readWhere = () => { const k = kyberSeam(); try { return k === null ? null : k.where() } catch (e) { return null } }

    const readAsDataUrl = (file) => new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(new Error('unreadable'))
      r.readAsDataURL(file)
    })

    // ── the profile, shared between the page and the seam ──────────────────────────────────────────────────────────────
    const store = { profile: null, listeners: new Set(), failed: false, mandate: null, wake: null }
    /** Consumers that render the name or the portrait (the sidebar row, the strip above Kaby's chat) re-read `window.__KB_KABY__.profile()` when told. */
    const announce = () => { try { window.dispatchEvent(new Event('kb-kaby-profile')) } catch (e) { /* no event target: nobody listens */ } }
    const publish = (profile) => {
      store.profile = profile
      store.failed = profile === null
      for (const fn of Array.from(store.listeners)) { try { fn(profile) } catch (e) { /* a listener must never break the others */ } }
      announce()
    }
    const call = async (path, body) => {
      try {
        const r = await fetch(BASE + path, body === undefined ? { headers: { accept: 'application/json' } } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        let json = null
        try { json = await r.json() } catch (e) { json = null }
        return { status: r.status, json: json }
      } catch (e) { return { status: 0, json: null } }
    }
    const refresh = async () => {
      const r = await call('/profile')
      if (r.status === 200 && r.json !== null && r.json.ok === true) { publish(r.json.profile); return r.json.profile }
      if (store.profile === null) publish(null)
      return null
    }
/** The permissions live in kybernos-cloud, the wake-ups in the Automations page (kybernos-plugin): their routes, the same origin, the page's own session for a change.
 *  `path` is '' (the view), '/log' or '/set' for the permissions; the automations take their action in the body. */
    const MANDATE = '/kybernos-cloud/kyby/mandate'
    const cloudCall = async (base, path, body) => {
      try {
        const r = await fetch(base + path, body === undefined ? { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } } : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        let json = null
        try { json = await r.json() } catch (e) { json = null }
        return { status: r.status, json: json }
      } catch (e) { return { status: 0, json: null } }
    }
    const mandateCall = (path, body) => cloudCall(MANDATE, path, body)
const tasksCall = (body) => cloudCall(TASKS, '', body)
/** What the wake-ups card needs, from three answers that are not this bundle's: Kaby's chat (kybernos-cloud), the automations and the runs going (kybernos-plugin). `null` when the automations do not answer. */
const readWake = async () => {
  const [native, list] = await Promise.all([cloudCall(NATIVE, ''), tasksCall({ action: 'list' })])
  if (list.status !== 200 || list.json === null || list.json.ok !== true || !Array.isArray(list.json.tasks)) return null
  const sid = native.status === 200 && native.json !== null && native.json.ok === true && typeof native.json.sessionId === 'string' && native.json.sessionId !== '' ? native.json.sessionId : null
  const task = wakeTaskOf(list.json.tasks, sid)
  let running = false
  if (task !== null) {
    const load = await cloudCall(LOAD, '')
    running = load.status === 200 && load.json !== null && Array.isArray(load.json.runs) && load.json.runs.some((r) => r !== null && typeof r === 'object' && r.taskId === task.id)
  }
  return { sid, task, running }
}
    /** A change: the host answers with the whole profile, which is what everybody then shows. */
    const change = async (path, body) => {
      const r = await call(path, body)
      if (r.status === 200 && r.json !== null && r.json.ok === true) { publish(r.json.profile); return { ok: true } }
      return { ok: false, error: r.json !== null && typeof r.json.error === 'string' ? r.json.error : 'down', refused: r.json !== null ? r.json.refused : undefined }
    }

    // ── opening this page from elsewhere (the strip above Kaby's chat) ─────────────────────────────────────────────────
    const navKeyOf = (el) => {
      try {
        const k = Object.keys(el).find((x) => x.indexOf('__reactFiber$') === 0)
        const key = k === undefined ? null : el[k].key
        return typeof key === 'string' ? key : null
      } catch (e) { return null }
    }
    const ownCell = () => {
      const cells = Array.from(document.querySelectorAll('[class*="navCell"]'))
      return cells.find((e) => navKeyOf(e) === SECTION_ID) || cells.find((e) => String(e.textContent || '').trim() === 'Kaby')
    }
    const openSettings = async () => {
      if (typeof document === 'undefined' || document === null || typeof document.querySelector !== 'function') return false
      try {
        const shown = () => document.querySelector('[data-kb="kaby-custom-page"]') !== null
        const settle = (ms) => new Promise((r) => setTimeout(r, ms))
        if (shown()) return true
        const click = () => { const c = ownCell(); if (c === undefined) return false; c.click(); return true }
        if (!click()) {
          // The dialog is closed: its own trigger opens it, then the entry (a click that comes first is overwritten while it mounts).
          const trigger = document.querySelector('[class*="settingsArea"] button[class*="trigger"]') || document.querySelector('button[aria-label="Settings"]')
          if (trigger === null) return false
          trigger.click()
          await settle(600)
        }
        for (let i = 0; i < 60; i += 1) {
          if (shown()) return true
          click()
          await settle(150)
        }
        return shown()
      } catch (e) { return false }
    }

    // ── styles (DSH's own tokens, one prefix) ───────────────────────────────────────────────────────────────────────────
    const CSS = [
      '.kbkc{box-sizing:border-box;padding:0 0 24px;color:var(--dsw-alias-label-primary,#222);font-size:var(--dsh-content-font-size-secondary,13.5px);line-height:1.45}',
      '.kbkc *{box-sizing:border-box}',
      '.kbkc-page{display:flex;flex-direction:column;gap:16px;max-width:880px}',
      '.kbkc-lead{margin:4px 0 0;color:var(--dsw-alias-label-secondary,#666);max-width:62ch}',
      '.kbkc-tabs{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));overflow-x:auto;scrollbar-width:none}',
      '.kbkc-tab{appearance:none;flex:none;height:40px;padding:0 14px;margin-bottom:-1px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#666);font:inherit;font-weight:500;cursor:pointer;white-space:nowrap}',
      '.kbkc-tab:hover{color:var(--dsw-alias-label-primary,#222)}',
      '.kbkc-tab[aria-selected="true"]{color:var(--dsw-alias-label-primary,#222);border-bottom-color:var(--dsw-alias-brand-primary,#4a7bd0);font-weight:600}',
      '.kbkc-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4a7bd0);outline-offset:-2px}',
      '.kbkc-panel{display:flex;flex-direction:column;gap:16px}',
      '.kbkc-panel[hidden]{display:none}',
      '.kbkc-card{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:16px;padding:18px 20px;display:flex;flex-direction:column;gap:14px}',
      '.kbkc-cap{font-size:12px;font-weight:700;color:var(--dsw-alias-label-secondary,#666)}',
      '.kbkc-id{display:flex;gap:20px;align-items:flex-start}',
      '.kbkc-tile{position:relative;width:176px;height:176px;border-radius:14px;overflow:hidden;flex:none;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16));display:grid;place-items:center}',
      '.kbkc-tile img{width:100%;height:100%;object-fit:cover;display:block}',
      '.kbkc-mono{width:100%;height:100%;color:var(--dsw-alias-label-primary,#222)}',
      '.kbkc-busy{position:absolute;inset:0;display:grid;place-items:center;align-content:center;gap:8px;background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.55));font-size:13px}',
      '.kbkc-col{flex:1 1 auto;display:flex;flex-direction:column;gap:8px;min-width:0}',
      '.kbkc-lab{font-size:12.5px;font-weight:700;color:var(--dsw-alias-label-secondary,#666)}',
      '.kbkc-in{height:38px;width:100%;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:12px;background:transparent;color:inherit;padding:0 14px;font:inherit}',
      '.kbkc-in.bad{border-color:var(--dsw-alias-state-error-primary,#c0392b)}',
      '.kbkc-in:focus-visible,.kbkc-btn:focus-visible,.kbkc-vp:focus-visible,.kbkc-pill:focus-visible,.kbkc-provbtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4a7bd0);outline-offset:2px}',
      '.kbkc-help{font-size:12.5px;color:var(--dsw-alias-label-secondary,#666)}',
      '.kbkc-err{font-size:12.5px;color:var(--dsw-alias-state-error-primary,#c0392b)}',
      '.kbkc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.kbkc-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:36px;padding:0 15px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));border-radius:10px;background:transparent;color:inherit;font:inherit;font-size:13.5px;cursor:pointer;white-space:nowrap}',
      '.kbkc-btn:hover:not([disabled]){background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.1))}',
      '.kbkc-btn.pri{background:var(--dsw-alias-button-primary-fill,#0f1115);color:var(--dsw-alias-label-primary-foreground,#fff);border-color:transparent}',
      '.kbkc-btn.sm{height:30px;padding:0 11px;font-size:12.5px}',
      '.kbkc-btn.dashed{border-style:dashed;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.08))}',
      '.kbkc-btn[disabled]{opacity:.45;cursor:not-allowed}',
      '.kbkc-vp{display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 16px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:99px;background:transparent;color:inherit;font:inherit;cursor:pointer}',
      '.kbkc-vp svg{color:var(--dsw-alias-state-warn-primary,#d9822b)}',
      '.kbkc-vp[aria-pressed="true"]{border:1.5px solid var(--dsw-alias-label-primary,#222);background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16));font-weight:600}',
      '.kbkc-chip{display:inline-flex;align-items:center;gap:6px;padding:2px 11px;border-radius:99px;font-size:12.5px;white-space:nowrap;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));color:var(--dsw-alias-label-secondary,#666)}',
      '.kbkc-chip.ok{border-color:var(--dsw-alias-state-success-primary,#22a55a);color:var(--dsw-alias-state-success-primary,#22a55a)}',
      '.kbkc-chip.warn{border-color:var(--dsw-alias-state-warn-primary,#d49a2a);color:var(--dsw-alias-state-warn-label,#a8530a)}',
      '.kbkc-chip.err{border-color:var(--dsw-alias-state-error-primary,#c0392b);color:var(--dsw-alias-state-error-primary,#c0392b)}',
      '.kbkc-notice.e{border-color:var(--dsw-alias-state-error-primary,#c0392b);color:var(--dsw-alias-state-error-primary,#c0392b)}',
      '.kbkc-vp.custom{border-style:dashed;cursor:default;color:var(--dsw-alias-label-secondary,#666)}',
      '.kbkc-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}',
      '.kbkc-num{width:76px;height:36px;padding:0 10px;border-radius:10px}',
      '.kbkc-lines{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:12px;display:flex;flex-direction:column}',
      '.kbkc-mrow{display:flex;align-items:center;gap:14px;padding:12px 14px;flex-wrap:wrap}',
      '.kbkc-mrow+.kbkc-mrow{border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35))}',
      '.kbkc-mtext{flex:1 1 260px;min-width:0}',
      '.kbkc-mtitle{font-weight:700}',
      '.kbkc-sw{flex:none;width:38px;height:22px;padding:0;border-radius:99px;border:1.5px solid var(--dsw-alias-label-secondary,#888);background:transparent;cursor:pointer;display:inline-flex;align-items:center}',
      '.kbkc-sw .kbkc-knob{display:block;width:16px;height:16px;border-radius:99px;margin-left:2px;background:var(--dsw-alias-label-secondary,#888)}',
      '.kbkc-sw.on{border-color:var(--dsw-alias-label-primary,#222);background:var(--dsw-alias-label-primary,#222)}',
      '.kbkc-sw.on .kbkc-knob{margin-left:18px;background:var(--dsw-alias-bg-layer-2,#fff)}',
      '.kbkc-sw[disabled]{opacity:.45;cursor:not-allowed}',
      '.kbkc-sw:focus-visible,.kbkc-num:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4a7bd0);outline-offset:2px}',
      '.kbkc-ask{border:1px dashed var(--dsw-alias-border-l2,rgba(127,127,127,.45));border-radius:12px;padding:10px 14px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.08));display:flex;gap:10px;align-items:flex-start}',
      '.kbkc-ask svg{flex:none;margin-top:2px;color:var(--dsw-alias-label-secondary,#666)}',
      '.kbkc-ask ul{margin:4px 0 0;padding-left:18px}',
      '.kbkc-warnline{color:var(--dsw-alias-state-warn-label,#a8530a)}',
      '.kbkc-logrow{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}',
      '.kbkc-grid{display:flex;gap:18px}',
      '.kbkc-provnav{width:230px;flex:none;display:flex;flex-direction:column;gap:4px}',
      '.kbkc-provbtn{display:flex;align-items:center;gap:10px;height:38px;padding:0 12px;border:1px solid transparent;border-radius:10px;background:none;color:inherit;font:inherit;cursor:pointer;text-align:left}',
      '.kbkc-provbtn[aria-current="true"]{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16));border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.35))}',
      '.kbkc-dot{width:16px;height:16px;border-radius:5px;border:1.5px solid var(--dsw-alias-label-secondary,#888);flex:none}',
      '.kbkc-dot.on{background:var(--dsw-alias-label-primary,#222);border-color:var(--dsw-alias-label-primary,#222)}',
      '.kbkc-prov{flex:1 1 auto;min-width:0;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:16px;padding:18px 22px;display:flex;flex-direction:column;gap:12px}',
      '.kbkc-prov h5{margin:0;font-size:17px;font-weight:700}',
      '.kbkc-notice{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:12px;padding:9px 12px;color:var(--dsw-alias-label-secondary,#666);background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.08))}',
      '.kbkc-notice.w{border-color:var(--dsw-alias-state-warn-primary,#d49a2a);color:var(--dsw-alias-state-warn-label,#a8530a)}',
      '.kbkc-foot{display:flex;align-items:center;gap:10px;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));padding-top:12px;margin-top:auto}',
      '.kbkc-veil{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45);display:grid;place-items:center}',
      '.kbkc-modal{width:min(520px,92vw);max-height:92vh;overflow:auto;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));border-radius:18px;background:var(--dsw-alias-bg-layer-2,#2a2a2d);color:var(--dsw-alias-label-primary,#eee);padding:18px 20px;display:flex;flex-direction:column;gap:12px}',
      '.kbkc-step{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}',
      '.kbkc-spin{width:20px;height:20px;border-radius:50%;border:2.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));border-top-color:var(--dsw-alias-brand-primary,#4a7bd0);animation:kbkc-spin .8s linear infinite;flex:none}',
      '@keyframes kbkc-spin{to{transform:rotate(360deg)}}',
      '@media (prefers-reduced-motion:reduce){.kbkc-spin{animation:none}}',
      '@media (max-width:760px){.kbkc-id,.kbkc-grid{flex-direction:column}.kbkc-provnav{width:auto}}',
      '@media (max-width:560px){.kbkc-tabs{gap:0}.kbkc-tab{padding:0 6px;font-size:12.5px}}'
    ].join('\n')

    // ── icons (inline, current colour) ─────────────────────────────────────────────────────────────────────────────────
    const svg = (h, d, size) => h('svg', { viewBox: '0 0 24 24', width: size || 15, height: size || 15, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', className: 'kbkc-ic' }, h('path', { d: d }))
    const ICON = {
      wave: 'M3 10v4M7 6v12M11 3v18M15 8v8M19 5v14M22 10v4',
      spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
      mic: 'M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0zM5 11a7 7 0 0 0 14 0M12 18v4',
      play: 'M6 4l14 8-14 8z',
      up: 'M12 16V4M7 9l5-5 5 5M4 20h16',
      lock: 'M5 11h14v9H5zM8 11V8a4 4 0 0 1 8 0v3'
    }

    // ── the two cards that are about what Kaby does, not how it looks ──────────────────────────────────────────────────────
    const buildCards = (React) => {
      const h = React.createElement
      const { useState, useEffect } = React
      const nameNow = () => (store.profile !== null ? store.profile.name : 'Kaby')

      /** « Where Kaby works »: the pick of the « Phone and channels » screen, drawn here through kybernos-kyber's seam, so the two are one setting. Nothing when that bundle is not there. */
      const WhereCard = () => {
        const [here, setHere] = useState(readWhere)
        useEffect(() => {
          let live = true
          let off = null
          let timer = null
          let tries = 0
          // The seam may appear a moment after this page: ask a few times, then give up quietly.
          const attach = () => {
            const k = kyberSeam()
            if (k === null) { tries += 1; if (live && tries < 6) timer = setTimeout(attach, 1000); return }
            const read = () => { if (live) setHere(readWhere()) }
            read()
            if (typeof k.subscribe === 'function') off = k.subscribe(read)
            if (readWhere() === null && typeof k.refresh === 'function') { try { k.refresh() } catch (e) { /* the screen reads it again by itself */ } }
          }
          attach()
          return () => { live = false; if (timer !== null) clearTimeout(timer); if (typeof off === 'function') off() }
        }, [])
        if (here === null) return null
        const name = nameNow()
        const ktn = (fr, en) => fill(kt(fr, en), { name: name })
        const chip = whereChip(here)
        const pick = (value) => { const k = kyberSeam(); if (k !== null && typeof k.pickWhere === 'function') { try { k.pickWhere(value) } catch (e) { /* the screen shows what it kept */ } } }
        const options = [h('option', { key: 'local', value: 'local' }, kt('Cet ordinateur', 'This computer'))].concat(here.computers.map((c) => h('option', { key: c.id, value: c.id }, c.name + ' (cloud)')))
        return h('section', { className: 'kbkc-card', 'data-kb': 'kaby-custom-where', 'aria-labelledby': 'kbkc-where-title' }, [
          h('div', { key: 'hd', className: 'kbkc-head' }, [
            h('div', { key: 'c', id: 'kbkc-where-title', className: 'kbkc-cap' }, ktn('Où {name} travaille', 'Where {name} works')),
            h('span', { key: 's', className: 'kbkc-chip ' + chip.cls, 'data-kb': 'kaby-custom-where-chip' }, chip.text)
          ]),
          h('div', { key: 'p', className: 'kbkc-row', style: { gap: 10 } }, [
            h('label', { key: 'l', className: 'kbkc-help', htmlFor: 'kbkc-where' }, kt('Ordinateur', 'Computer')),
            h('select', { key: 's', id: 'kbkc-where', className: 'kbkc-in', style: { width: 280 }, 'data-kb': 'kaby-custom-where-pick', value: here.picked, disabled: here.computers.length === 0, onChange: (e) => pick(e.target.value) }, options)
          ]),
          h('div', { key: 'h', className: 'kbkc-help', 'data-kb': 'kaby-custom-where-help' }, here.local
            ? ktn('{name} travaille sur cet ordinateur : garde Kybernos ouvert pour qu’il agisse. Aucune heure de cloud computer n’est consommée.', '{name} works on this computer: keep Kybernos open for it to act. No cloud computer hour is used.')
            : ktn('{name} travaille sur son cloud computer : il se réveille quand il a du travail, puis se rendort. Ses heures d’exécution comptent dans ton offre du mois.', '{name} works on its cloud computer: it wakes when it has work, then goes back to sleep. Its run hours count in your plan for the month.')),
          here.local ? null : h('div', { key: 'w', className: 'kbkc-notice w', 'data-kb': 'kaby-custom-where-cloud-note' }, ktn('Les autorisations ci-dessous valent pour le chat de {name} sur cet ordinateur. Sur son cloud computer, {name} demande comme avant.', 'The permissions below hold for {name}’s chat on this computer. On its cloud computer, {name} asks as before.')),
          h('div', { key: 'same', className: 'kbkc-help' }, kt('C’est le même réglage que dans « Set up… » : l’un change l’autre.', 'It is the same setting as in “Set up…”: changing one changes the other.'))
        ])
      }
      WhereCard.displayName = 'KabyWhereCard'

      /** « Permissions »: what Kaby does in its chat without asking. The rules, the signature and the daily counts are the host's (kybernos-cloud); this card asks them to be written and shows what they say. */
      const MandateCard = () => {
        const [view, setView] = useState(store.mandate)
        const [down, setDown] = useState(false)
        const [draft, setDraft] = useState(null)
        const [busy, setBusy] = useState(false)
        const [problem, setProblem] = useState('')
        const [logOpen, setLogOpen] = useState(false)
        const [log, setLog] = useState(null)
        useEffect(() => {
          let live = true
          mandateCall('').then((r) => {
            if (!live) return
            if (r.status === 200 && r.json !== null && r.json.ok === true) { store.mandate = r.json; setView(r.json); setDown(false) } else if (store.mandate === null) setDown(true)
          })
          return () => { live = false }
        }, [])
        const name = nameNow()
        const cap = h('div', { key: 'c', id: 'kbkc-mandate-title', className: 'kbkc-cap' }, kt('Autorisations', 'Permissions'))
        if (view === null) {
          return h('section', { className: 'kbkc-card', 'data-kb': 'kaby-custom-mandate', 'aria-labelledby': 'kbkc-mandate-title' }, [
            cap,
            h('div', { key: 'm', className: down ? 'kbkc-notice w' : 'kbkc-help', 'data-kb': down ? 'kaby-custom-mandate-down' : 'kaby-custom-mandate-loading' },
              down ? kt('La page ne peut pas lire les autorisations : relance DSH si ce plugin vient d’être activé.', 'The page cannot read the permissions: restart DSH if this plugin was just turned on.') : kt('Lecture des autorisations…', 'Reading the permissions…'))
          ])
        }
        const d = draft !== null ? draft : draftOf(view)
        const dirty = draft !== null
        const chip = mandateChip(view, dirty)
        const locked = view.canSign !== true || busy
        const used = view.usedToday || { memory: 0, computer: 0 }
        const showUse = view.inForce === true && !dirty
        const preset = draftPreset(d, view.presets)
        const edit = (patch) => setDraft(Object.assign({}, d, patch))
        const pickPreset = (pname) => { const p = view.presets !== null && typeof view.presets === 'object' ? view.presets[pname] : undefined; if (p !== undefined) setDraft({ memory: p.memory, computer: p.computer, memoryPerDay: p.memoryPerDay, computerPerDay: p.computerPerDay }) }
        const setLimit = (key, raw) => { const n = parseInt(raw, 10); const max = view.limits !== null && typeof view.limits === 'object' && Number.isInteger(view.limits[key]) ? view.limits[key] : 500; if (Number.isFinite(n)) edit({ [key]: Math.max(1, Math.min(max, n)) }) }
        const send = async (body) => {
          setBusy(true)
          setProblem('')
          const r = await mandateCall('/set', body)
          setBusy(false)
          if (r.status === 200 && r.json !== null && r.json.ok === true) { store.mandate = r.json.view; setView(r.json.view); setDraft(null); if (logOpen) loadLog(); return }
          setProblem(mandateProblem(r.status === 401 || r.status === 403 ? 'session' : (r.json !== null && typeof r.json.error === 'string' ? r.json.error : 'down')))
        }
        const sign = () => (draft !== null ? send({ memory: d.memory, computer: d.computer, memoryPerDay: d.memoryPerDay, computerPerDay: d.computerPerDay }) : undefined)
        const pause = () => send({ paused: view.paused !== true })
        const loadLog = async () => { const r = await mandateCall('/log'); setLog(r.status === 200 && r.json !== null && Array.isArray(r.json.entries) ? r.json.entries : []) }
        const toggleLog = () => { const next = !logOpen; setLogOpen(next); if (next) loadLog() }
        const useLine = (n, limit) => fill(kt('{n} sur {limit} aujourd’hui', '{n} of {limit} today'), { n: n, limit: limit }) + (n >= limit ? ' · ' + kt('la suite te sera demandée', 'what comes next will be asked') : '')
        const timeOf = (iso) => { const t = new Date(Date.parse(String(iso))); return Number.isFinite(t.getTime()) ? String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') : '' }
        const line = (key, title, help, unit, ariaLabel) => {
          const on = d[key] === true
          const perDay = key + 'PerDay'
          const id = 'kbkc-limit-' + key
          const n = used[key] || 0
          return h('div', { key: key, className: 'kbkc-mrow', 'data-kb': 'kaby-custom-mandate-' + key }, [
            h('button', { key: 's', type: 'button', role: 'switch', className: 'kbkc-sw' + (on ? ' on' : ''), 'aria-checked': on ? 'true' : 'false', 'aria-label': ariaLabel, 'data-kb': 'kaby-custom-mandate-switch', 'data-class': key, disabled: locked, onClick: () => edit({ [key]: !on }) }, h('span', { className: 'kbkc-knob' })),
            h('div', { key: 't', className: 'kbkc-mtext' }, [
              h('div', { key: 'a', className: 'kbkc-mtitle' }, title),
              h('div', { key: 'b', className: 'kbkc-help' }, help),
              showUse && on ? h('div', { key: 'u', className: 'kbkc-help' + (n >= d[perDay] ? ' kbkc-warnline' : ''), 'data-kb': 'kaby-custom-mandate-use', 'data-class': key }, useLine(n, d[perDay])) : null
            ]),
            h('div', { key: 'l', className: 'kbkc-row' }, [
              h('label', { key: 'x', className: 'kbkc-help', htmlFor: id }, kt('jusqu’à', 'up to')),
              h('input', { key: 'i', id: id, type: 'number', min: 1, max: view.limits && view.limits[perDay] ? view.limits[perDay] : 500, className: 'kbkc-in kbkc-num', 'data-kb': 'kaby-custom-mandate-limit', 'data-class': key, value: d[perDay], disabled: locked || !on, onChange: (e) => setLimit(perDay, e.target.value) }),
              h('span', { key: 'y', className: 'kbkc-help' }, unit)
            ])
          ])
        }
        const signLabel = chip.code === 'resign' ? kt('Signer de nouveau', 'Sign again') : (view.signedAt !== null ? kt('Signer les modifications', 'Sign the changes') : kt('Signer l’autorisation', 'Sign the permission'))
        return h('section', { className: 'kbkc-card', 'data-kb': 'kaby-custom-mandate', 'aria-labelledby': 'kbkc-mandate-title' }, [
          h('div', { key: 'hd', className: 'kbkc-head' }, [cap, h('span', { key: 's', className: 'kbkc-chip ' + chip.cls, 'data-kb': 'kaby-custom-mandate-chip', 'data-state': chip.code }, chip.text)]),
          h('div', { key: 'lead', className: 'kbkc-help' }, fill(kt('Ce que {name} fait sans te demander dans son chat sur cet ordinateur, tant que tu ne l’as pas mis en pause. Tout le reste, et tout ce qui dépasse une limite du jour, te revient en question comme avant.', 'What {name} does without asking, in its chat on this computer, until you pause it. Everything else, and anything over a daily limit, is asked of you as before.'), { name: name })),
          chip.code === 'resign' ? h('div', { key: 'n', className: 'kbkc-notice e', role: 'alert', 'data-kb': 'kaby-custom-mandate-note' }, kt('L’autorisation ne vaut plus : le fichier a été modifié autrement que par cette page, ou la clé de cet ordinateur a changé. Rien n’est autorisé tant que tu n’as pas signé de nouveau.', 'The permission no longer holds: the file was changed other than by this page, or this computer’s key changed. Nothing is allowed until you sign again.'))
            : chip.code === 'cannot_sign' ? h('div', { key: 'n', className: 'kbkc-notice w', role: 'alert', 'data-kb': 'kaby-custom-mandate-note' }, kt('DSH ne trouve pas la clé de cette machine : l’autorisation ne peut pas être signée, donc rien n’est autorisé. Les boutons de la carte sont grisés.', 'DSH cannot find this machine’s key: the permission cannot be signed, so nothing is allowed. The card’s controls are off.'))
              : chip.code === 'paused' ? h('div', { key: 'n', className: 'kbkc-help', 'data-kb': 'kaby-custom-mandate-note' }, kt('Rien ne passe sans ta réponse. Les réglages et le compte du jour sont gardés.', 'Nothing goes through without your answer. The settings and today’s count are kept.'))
                : null,
          h('div', { key: 'pr', className: 'kbkc-col' }, [
            h('div', { key: 'l', className: 'kbkc-lab' }, kt('Point de départ', 'Starting point')),
            h('div', { key: 'r', className: 'kbkc-row', style: { gap: 8 } }, PRESET_ORDER.map((p) => h('button', { key: p, type: 'button', className: 'kbkc-vp', 'data-kb': 'kaby-custom-mandate-preset', 'data-preset': p, 'aria-pressed': preset === p ? 'true' : 'false', disabled: locked, onClick: () => pickPreset(p) }, presetLabel(p)))
              .concat(preset === 'custom' ? [h('span', { key: 'custom', className: 'kbkc-vp custom', 'data-kb': 'kaby-custom-mandate-custom' }, kt('Personnalisé', 'Custom'))] : []))
          ]),
          h('div', { key: 'lines', className: 'kbkc-lines' }, [
            line('memory', kt('Mémoire', 'Memory'), kt('Écrire sa mémoire et ses leçons, sur cet ordinateur.', 'Write its memory and its lessons, on this computer.'), kt('par jour', 'a day'), kt('Mémoire : autoriser sans demander', 'Memory: allow without asking')),
            line('computer', kt('Son cloud computer', 'Its cloud computer'), kt('Le commander depuis cet ordinateur : le démarrer, l’arrêter, y écrire, y exécuter.', 'Command it from this computer: start it, stop it, write to it, run things on it.'), kt('actions par jour', 'actions a day'), kt('Son cloud computer : autoriser sans demander', 'Its cloud computer: allow without asking'))
          ]),
          h('div', { key: 'ask', className: 'kbkc-ask', 'data-kb': 'kaby-custom-mandate-asked' }, [
            svg(h, ICON.lock, 16),
            h('div', { key: 'x' }, [
              h('div', { key: 't', className: 'kbkc-cap' }, kt('Te revient toujours en question, quelle que soit l’autorisation', 'Always asked of you, whatever the permission')),
              h('ul', { key: 'u' }, [
                h('li', { key: '1' }, kt('Une application connectée : envoyer un message, publier, payer', 'A connected app: send a message, publish, pay')),
                h('li', { key: '2' }, kt('Redémarrer DSH', 'Restart DSH')),
                h('li', { key: '3' }, kt('Tout ce qui dépasse une limite du jour', 'Anything over a daily limit'))
              ])
            ])
          ]),
          h('div', { key: 'cost', className: 'kbkc-help' }, kt('Les limites comptent des actions, pas des euros : rien sur cet ordinateur ne mesure le coût d’un appel. Le compte repart à zéro chaque jour.', 'The limits count actions, not euros: nothing on this computer measures what a call costs. The count starts again each day.')),
          problem !== '' ? h('div', { key: 'e', className: 'kbkc-err', role: 'alert', 'data-kb': 'kaby-custom-mandate-error' }, problem) : null,
          h('div', { key: 'foot', className: 'kbkc-foot' }, [
            h('button', { key: 'g', type: 'button', className: 'kbkc-btn pri', 'data-kb': 'kaby-custom-mandate-sign', disabled: locked || !dirty, onClick: sign }, signLabel),
            h('button', { key: 'p', type: 'button', className: 'kbkc-btn', 'data-kb': 'kaby-custom-mandate-pause', disabled: locked || view.signedAt === null, onClick: pause }, view.paused === true ? kt('Reprendre', 'Resume') : kt('Mettre en pause', 'Pause')),
            h('span', { key: 's', style: { flex: '1 1 auto' } }),
            h('button', { key: 'j', type: 'button', className: 'kbkc-btn sm', 'data-kb': 'kaby-custom-mandate-log-toggle', 'aria-expanded': logOpen ? 'true' : 'false', onClick: toggleLog }, kt('Journal des actions', 'Action log'))
          ]),
          logOpen ? h('div', { key: 'log', className: 'kbkc-step', 'data-kb': 'kaby-custom-mandate-log' }, [
            h('div', { key: 't', className: 'kbkc-lab' }, kt('Aujourd’hui, ce qui est passé sans question', 'Today, what ran without a question')),
            log === null ? h('div', { key: 'w', className: 'kbkc-help' }, kt('Lecture…', 'Reading…'))
              : log.length === 0 ? h('div', { key: 'z', className: 'kbkc-help', 'data-kb': 'kaby-custom-mandate-log-empty' }, kt('Rien n’est passé sans question aujourd’hui.', 'Nothing ran without a question today.'))
                : log.map((e, i) => h('div', { key: i, className: 'kbkc-logrow', 'data-kb': 'kaby-custom-mandate-log-row' }, [
                  h('span', { key: 'a', className: 'kbkc-help', style: { minWidth: 44 } }, timeOf(e.at)),
                  h('b', { key: 'b', style: { minWidth: 110 } }, e.klass === 'computer' ? kt('Cloud computer', 'Cloud computer') : kt('Mémoire', 'Memory')),
                  h('span', { key: 'c', className: 'kbkc-help' }, e.tool)
                ]))
          ]) : null
        ])
      }
      MandateCard.displayName = 'KabyMandateCard'

      /** « Wake-ups »: Kaby wakes by itself through an ordinary automation. The card finds it (the one whose runs land in Kaby's chat), makes it when there is none, opens it, wakes it now and stops it.
       *  The rhythm, the time limit, « when I write in its chat » and the approval are the Automations page's; nothing here is signed or kept. */
      const WakeCard = () => {
        const [state, setState] = useState(store.wake)
        const [down, setDown] = useState(false)
        const [busy, setBusy] = useState(false)
        const [problem, setProblem] = useState('')
        const [made, setMade] = useState(false)
        const running = state !== null && state.running === true
        const load = async () => {
          const s = await readWake()
          if (s !== null) { store.wake = s; setState(s); setDown(false); return s }
          if (store.wake === null) setDown(true)
          return null
        }
        useEffect(() => {
          let live = true
          readWake().then((s) => {
            if (!live) return
            if (s !== null) { store.wake = s; setState(s); setDown(false) } else if (store.wake === null) setDown(true)
          })
          return () => { live = false }
        }, [])
        // While a wake-up runs, the chip follows it: ask again every few seconds until it is over.
        useEffect(() => {
          if (!running) return undefined
          const timer = setInterval(() => { load() }, 5000)
          return () => clearInterval(timer)
        }, [running])
        const name = nameNow()
        const cap = h('div', { key: 'c', id: 'kbkc-wake-title', className: 'kbkc-cap' }, kt('Réveils', 'Wake-ups'))
        if (state === null) {
          return h('section', { className: 'kbkc-card', 'data-kb': 'kaby-custom-wake', 'aria-labelledby': 'kbkc-wake-title' }, [
            cap,
            h('div', { key: 'm', className: down ? 'kbkc-notice w' : 'kbkc-help', 'data-kb': down ? 'kaby-custom-wake-down' : 'kaby-custom-wake-loading' },
              down ? kt('La page ne peut pas lire les automations : relance DSH si ce plugin vient d’être activé.', 'The page cannot read the automations: restart DSH if this plugin was just turned on.') : kt('Lecture des automations…', 'Reading the automations…'))
          ])
        }
        const chip = wakeChip(state)
        const task = state.task
        const fail = (r) => setProblem(wakeProblem(r.status === 401 || r.status === 403 ? 'session' : (r.json !== null && typeof r.json.error === 'string' ? r.json.error : 'down')))
        const create = async () => {
          setBusy(true)
          setProblem('')
          const r = await tasksCall({ action: 'create', task: wakeInput(state.sid, name) })
          // The shell closes Settings when an automation appears (seen on the real GUI, for any automation), so the person is taken to the page where it is approved rather than left on the empty home.
          if (r.status === 200 && r.json !== null && r.json.ok === true) { setMade(true); await load(); openAutomations() } else fail(r)
          setBusy(false)
        }
        const wake = async () => {
          setBusy(true)
          setProblem('')
          const r = await tasksCall({ action: 'run-now', id: task.id })
          if (r.status === 200 && r.json !== null && r.json.ok === true) await load(); else fail(r)
          setBusy(false)
        }
        const stopWake = async () => {
          setBusy(true)
          setProblem('')
          const r = await tasksCall({ action: 'stop', id: task.id })
          if (r.status === 200 && r.json !== null && r.json.ok === true) await load(); else { fail(r); await load() }
          setBusy(false)
        }
        const openAutomations = () => { try { if (typeof window.__KB_OPEN__ === 'function') window.__KB_OPEN__({ view: 'tasks' }) } catch (e) { /* the menu is the other way in */ } }
        const openChat = () => { const k = kyberSeam(); if (k !== null && typeof k.openChat === 'function') { try { k.openChat() } catch (e) { /* the sidebar row opens it too */ } } }
        const where = readWhere()
        const elsewhere = where !== null && where.local === false
        const canOpen = kyberSeam() !== null && typeof kyberSeam().openChat === 'function'
        const canOpenAuto = typeof window.__KB_OPEN__ === 'function'
        return h('section', { className: 'kbkc-card', 'data-kb': 'kaby-custom-wake', 'aria-labelledby': 'kbkc-wake-title' }, [
          h('div', { key: 'hd', className: 'kbkc-head' }, [cap, h('span', { key: 's', className: 'kbkc-chip ' + chip.cls, 'data-kb': 'kaby-custom-wake-chip', 'data-state': chip.code }, chip.text)]),
          h('div', { key: 'lead', className: 'kbkc-help' }, fill(kt('{name} se réveille de lui-même grâce à une automation, comme les autres : son rythme, sa durée maximale, « quand j’écris dans son chat » et le bouton Arrêter sont dans la page Automatisations. Sa liste et ses comptes rendus sont dans son chat, pas ici.', '{name} wakes by itself through an automation, like any other: its schedule, its time limit, “when I write in its chat” and the Stop button are on the Automations page. Its list and its reports are in its chat, not here.'), { name: name })),
          elsewhere ? h('div', { key: 'cl', className: 'kbkc-notice w', 'data-kb': 'kaby-custom-wake-cloud-note' }, fill(kt('Les réveils ne couvrent pas le cloud computer de {name} : ils ont lieu sur ton ordinateur, quand DSH y est ouvert.', 'Wake-ups do not cover {name}’s cloud computer: they happen on your own computer, while DSH is open there.'), { name: name })) : null,
          chip.code === 'nochat' ? h('div', { key: 'n', className: 'kbkc-notice w', 'data-kb': 'kaby-custom-wake-note' }, kt('Ouvre une première fois le chat de l’assistant : le réveil y tourne, il faut qu’il existe.', 'Open the assistant’s chat once: the wake-up runs there, so it has to exist.'))
            : chip.code === 'none' ? h('div', { key: 'n', className: 'kbkc-help', 'data-kb': 'kaby-custom-wake-note' }, kt('Pas encore de réveil. Le créer ajoute une automation éteinte (toutes les 4 h de 08:00 à 20:00, 10 minutes au plus) : tu la relis, tu l’approuves, tu l’actives.', 'No wake-up yet. Creating it adds an automation that is off (every 4 hours from 08:00 to 20:00, 10 minutes at most): you read it, approve it and turn it on.'))
              : chip.code === 'draft' ? h('div', { key: 'n', className: 'kbkc-help', 'data-kb': 'kaby-custom-wake-note' }, made ? kt('Créée, éteinte. Ouvre-la pour la relire, l’approuver et l’activer : tant qu’elle n’est pas approuvée, aucun réveil n’a lieu.', 'Created, and off. Open it to read it, approve it and turn it on: no wake-up happens until it is approved.') : kt('L’automation attend ton approbation dans la page Automatisations : aucun réveil n’a lieu avant.', 'The automation waits for your approval on the Automations page: no wake-up happens before.'))
                : chip.code === 'off' ? h('div', { key: 'n', className: 'kbkc-help', 'data-kb': 'kaby-custom-wake-note' }, kt('L’automation est éteinte : aucun réveil tant que tu ne l’actives pas. Ses réglages sont gardés.', 'The automation is off: no wake-up until you turn it on. Its settings are kept.'))
                  : null,
          h('div', { key: 'ask', className: 'kbkc-ask', 'data-kb': 'kaby-custom-wake-rules' }, [
            svg(h, ICON.lock, 16),
            h('div', { key: 'x' }, [
              h('div', { key: 't', className: 'kbkc-cap' }, kt('Pendant un réveil, comme toujours', 'During a wake-up, as always')),
              h('ul', { key: 'u' }, [
                h('li', { key: '1' }, kt('Seules passent les actions couvertes par tes Autorisations : personne ne peut répondre à une question, le reste est refusé', 'Only the actions your Permissions cover go through: nobody can answer a question, so the rest is refused')),
                h('li', { key: '2' }, kt('Il s’arrête au bout du temps fixé, et dès que tu lui écris si l’automation le demande (page Automatisations › Modifier)', 'It stops when its time is up, and as soon as you write to it if the automation says so (Automations page › Edit)')),
                h('li', { key: '3' }, kt('Sa liste est le fichier todo.md de son espace de travail : demande-lui, dans son chat, d’y ajouter un point', 'Its list is the file todo.md in its workspace: ask it, in its chat, to add a point'))
              ])
            ])
          ]),
          problem !== '' ? h('div', { key: 'e', className: 'kbkc-err', role: 'alert', 'data-kb': 'kaby-custom-wake-error' }, problem) : null,
          h('div', { key: 'foot', className: 'kbkc-foot' }, [
            task === null ? h('button', { key: 'g', type: 'button', className: 'kbkc-btn pri', 'data-kb': 'kaby-custom-wake-create', disabled: busy || state.sid === null, onClick: create }, kt('Créer le réveil', 'Create the wake-up')) : null,
            task !== null ? h('button', { key: 'a', type: 'button', className: 'kbkc-btn pri', 'data-kb': 'kaby-custom-wake-automation', disabled: !canOpenAuto, onClick: openAutomations }, kt('Ouvrir l’automation', 'Open the automation')) : null,
            task !== null ? h('button', { key: 'w', type: 'button', className: 'kbkc-btn', 'data-kb': 'kaby-custom-wake-now', disabled: busy || running || !wakeApproved(task), onClick: wake }, kt('Réveiller maintenant', 'Wake it now')) : null,
            running ? h('button', { key: 'x', type: 'button', className: 'kbkc-btn', 'data-kb': 'kaby-custom-wake-stop', disabled: busy, onClick: stopWake }, kt('Arrêter ce réveil', 'Stop this wake-up')) : null,
            h('span', { key: 's', style: { flex: '1 1 auto' } }),
            canOpen ? h('button', { key: 'o', type: 'button', className: 'kbkc-btn sm', 'data-kb': 'kaby-custom-wake-open', onClick: openChat }, fill(kt('Ouvrir le chat de {name}', 'Open {name}’s chat'), { name: name })) : null
          ])
        ])
      }
      WakeCard.displayName = 'KabyWakeCard'

      return { WhereCard, MandateCard, WakeCard }
    }

    // ── the page ────────────────────────────────────────────────────────────────────────────────────────────────────────
    const buildPanel = (React) => {
      const h = React.createElement
      const { useState, useEffect, useRef } = React
      /** The page's head: its title and its « ? » through the Suite's Title (one style for every page title, the button right after the text); the bare title where the Suite is not there. */
      const pageHead = (props) => { try { if (window.__KB_HELP__ && window.__KB_HELP__.Title) return h(window.__KB_HELP__.Title, props) } catch (e) { /* the bare title below */ } return h(props.as || 'h2', { className: 'kbhp-title' + (props.className ? ' ' + props.className : '') }, props.title, props.after) }
      const { WhereCard, MandateCard, WakeCard } = buildCards(React)

      const Panel = () => {
        const [profile, setProfile] = useState(store.profile)
        const [failed, setFailed] = useState(store.failed)
        const [engines, setEngines] = useState(null)
        const [nameDraft, setNameDraft] = useState(store.profile !== null ? store.profile.name : '')
        const [nameCode, setNameCode] = useState('')
        const [lookDraft, setLookDraft] = useState(store.profile !== null ? store.profile.look : '')
        const [gen, setGen] = useState({ busy: false, error: '', price: null })
        const [importing, setImporting] = useState(false)
        const [consent, setConsent] = useState(false)
        const [notice, setNotice] = useState('')
        const [voiceNotice, setVoiceNotice] = useState('')
        const [playing, setPlaying] = useState(false)
        const [cv, setCv] = useState(null)
        const patchCv = (patch) => setCv((c) => (c === null ? c : Object.assign({}, c, patch)))
        const [faceView, setFaceView] = useState('none')
        const [tab, setTab] = useState(TAB_IDS[0])
        const touched = useRef({ name: false, look: false })
        const rec = useRef(null)

        useEffect(() => {
          const on = (p) => {
            setProfile(p)
            setFailed(p === null)
            if (p !== null) {
              if (!touched.current.name) setNameDraft(p.name)
              if (!touched.current.look) setLookDraft(p.look)
            }
          }
          store.listeners.add(on)
          refresh()
          return () => { store.listeners.delete(on) }
        }, [])
        useEffect(() => {
          let live = true
          fetch('/kybernos/tts/voices', { headers: { accept: 'application/json' } }).then((r) => r.json()).then((j) => { if (live && j !== null && j.ok === true) setEngines(Array.isArray(j.engines) ? j.engines : []) }).catch(() => { if (live) setEngines([]) })
          return () => { live = false }
        }, [])
        useEffect(() => () => { try { if (rec.current !== null) { rec.current.recorder.stop(); rec.current.stream.getTracks().forEach((t) => t.stop()) } } catch (e) { /* already stopped */ } }, [])

        const uiLang = lang()
        const voices = voicePills(engines, uiLang, PILLS_SHOWN)
        const name = profile !== null ? profile.name : 'Kaby'
        const hasPortrait = profile !== null && profile.portrait !== null
        const ktn = (fr, en) => kt(fr, en).split('{name}').join(name)

        // ── identity
        const saveName = async (value) => {
          touched.current.name = false
          const r = await change('/profile', { patch: { name: value } })
          if (r.ok) { setNameCode(''); return }
          setNameCode(r.refused !== undefined && r.refused.name !== undefined ? r.refused.name : 'down')
        }
        const saveLook = async () => {
          touched.current.look = false
          if (profile !== null && lookDraft.trim() !== profile.look) await change('/profile', { patch: { look: lookDraft } })
        }
        const generate = async () => {
          setGen({ busy: true, error: '', price: null })
          setNotice('')
          let image = null
          try {
            const r = await fetch('/kybernos/image/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: portraitPrompt(lookDraft) }) })
            if (r.status === 404) { setGen({ busy: false, error: kt('Cette version de Kybernos ne sait pas encore générer d’image.', 'This version of Kybernos cannot generate pictures yet.'), price: null }); return }
            image = await r.json()
          } catch (e) { image = null }
          if (image === null || image.ok !== true) { setGen({ busy: false, error: (image !== null && image.error) || kt('La génération a échoué.', 'The generation failed.'), price: null }); return }
          const kept = await change('/portrait', { image: image.image, source: 'generated', model: image.model, look: lookDraft })
          setGen({ busy: false, error: kept.ok ? '' : portraitProblem(kept.error), price: image.price })
        }
        const importFile = async (file) => {
          if (file === undefined || file === null) return
          if (file.size > PORTRAIT_MAX_BYTES) { setNotice(portraitProblem('big')); return }
          try {
            const r = await change('/portrait', { image: await readAsDataUrl(file), source: 'imported' })
            setNotice(r.ok ? '' : portraitProblem(r.error))
            if (r.ok) { setImporting(false); setConsent(false) }
          } catch (e) { setNotice(portraitProblem('format')) }
        }
        const removePortrait = async () => { await change('/portrait/remove', {}) }

        // ── voice
        const pickVoice = (voice) => change('/profile', { patch: { voice: voice } })
        const preview = async () => {
          if (playing || profile === null) return
          setPlaying(true)
          setVoiceNotice('')
          try {
            const v = profile.voice || { pick: 'default' }
            const body = { text: sampleLine(name), lang: uiLang }
            if (v.pick === 'voice') { body.engine = v.engine; body.voice = v.voice; if (v.lang) body.lang = v.lang }
            const r = await fetch('/kybernos/tts/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
            const j = await r.json()
            if (j !== null && j.ok === true && typeof j.audio === 'string') {
              const audio = new Audio(j.audio)
              await new Promise((resolve) => { audio.onended = resolve; audio.onerror = resolve; audio.play().catch(resolve) })
            } else setVoiceNotice((j && j.error) || kt('Écoute impossible : le moteur de voix ne répond pas.', 'Could not play: the voice engine does not answer.'))
          } catch (e) { setVoiceNotice(kt('Écoute impossible : le moteur de voix ne répond pas.', 'Could not play: the voice engine does not answer.')) }
          setPlaying(false)
        }

        // ── custom voice window: a consent (not kept, only its time) and a sample, recorded or uploaded
        const toggleRecording = async (which) => {
          if (rec.current !== null) { try { rec.current.recorder.stop() } catch (e) { /* stopped */ } return }
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            const recorder = new MediaRecorder(stream)
            const chunks = []
            recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data) }
            recorder.onstop = async () => {
              stream.getTracks().forEach((t) => t.stop())
              rec.current = null
              const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
              patchCv({ recording: '', [which]: which === 'sample' ? { data: null, bytes: blob.size } : true })
              if (which === 'sample') {
                const data = await readAsDataUrl(blob)
                patchCv({ sample: { data: data, bytes: blob.size } })
              }
            }
            rec.current = { recorder: recorder, stream: stream }
            patchCv({ recording: which, error: '' })
            recorder.start()
          } catch (e) { patchCv({ error: kt('Le micro n’est pas disponible.', 'The microphone is not available.') }) }
        }
        const uploadSample = async (file) => {
          if (file === undefined || file === null) return
          if (file.size > SAMPLE_MAX_BYTES) { patchCv({ error: kt('Le fichier dépasse 10 Mo.', 'The file is over 10 MB.') }); return }
          try { patchCv({ sample: { data: null, bytes: file.size }, error: '' }); const data = await readAsDataUrl(file); patchCv({ sample: { data: data, bytes: file.size } }) } catch (e) { patchCv({ error: kt('Le fichier est illisible.', 'The file cannot be read.'), sample: null }) }
        }
        const saveCustom = async () => {
          const r = await change('/voice-sample', { name: cv.name, consent: cv.consent === true, sample: cv.sample.data })
          if (!r.ok) { patchCv({ error: r.error.indexOf('name-') === 0 ? nameText(r.error.slice(5)) : (r.error === 'consent' ? kt('Le consentement manque.', 'The consent is missing.') : portraitProblem(r.error)) }); return }
          await pickVoice({ pick: 'custom' })
          setCv(null)
        }
        const closeCustom = () => { try { if (rec.current !== null) rec.current.recorder.stop() } catch (e) { /* stopped */ } setCv(null) }

        // ── face
        const providers = profile !== null ? profile.providers : []
        const viewed = providers.find((p) => p.id === faceView) || providers[0]
        const useFace = profile !== null && profile.face ? profile.face.use : 'none'

        if (profile === null) {
          return h('div', { className: 'kbkc', 'data-kb': 'kaby-custom-page' }, h('div', { className: 'kbkc-page' },
            pageHead({ title: 'Kaby' }),
            h('div', { className: failed ? 'kbkc-notice w' : 'kbkc-help', 'data-kb': failed ? 'kaby-custom-down' : 'kaby-custom-loading' },
              failed ? kt('La page ne peut pas lire ses réglages : relance DSH si ce plugin vient d’être activé.', 'The page cannot read its settings: restart DSH if this plugin was just turned on.') : kt('Lecture des réglages…', 'Reading the settings…'))))
        }

        const identity = h('section', { className: 'kbkc-card', 'data-kb': 'kaby-custom-identity' }, [
          h('div', { key: 'c', className: 'kbkc-cap' }, kt('Identité', 'Identity')),
          h('div', { key: 'r', className: 'kbkc-id' }, [
            h('div', { key: 't', className: 'kbkc-tile' }, [
              hasPortrait ? h('img', { key: 'i', src: profile.portrait.url, alt: kt('Portrait de ', 'Portrait of ') + name, 'data-kb': 'kaby-custom-portrait' }) : h('svg', { key: 'm', className: 'kbkc-mono', viewBox: '0 0 100 100', 'aria-hidden': 'true' }, h('text', { x: 50, y: 68, textAnchor: 'middle', fontSize: 64, fontWeight: 700, fill: 'currentColor' }, (name.trim().charAt(0) || 'K').toUpperCase())),
              gen.busy ? h('div', { key: 'b', className: 'kbkc-busy', role: 'status' }, [h('span', { key: 's', className: 'kbkc-spin' }), kt('Génération…', 'Generating…')]) : null
            ]),
            h('div', { key: 'f', className: 'kbkc-col' }, [
              h('label', { key: 'nl', className: 'kbkc-lab', htmlFor: 'kbkc-name' }, kt('Nom', 'Name')),
              h('input', { key: 'ni', id: 'kbkc-name', className: 'kbkc-in' + (nameCode !== '' ? ' bad' : ''), type: 'text', maxLength: 40, value: nameDraft, 'data-kb': 'kaby-custom-name', 'aria-invalid': nameCode !== '' ? 'true' : 'false',
                onChange: (e) => { touched.current.name = true; setNameDraft(e.target.value) }, onBlur: () => { if (nameDraft.trim() !== profile.name) saveName(nameDraft); else touched.current.name = false },
                onKeyDown: (e) => { if (e.key === 'Enter' && nameDraft.trim() !== profile.name) saveName(nameDraft) } }),
              nameCode !== '' ? h('div', { key: 'ne', className: 'kbkc-err', role: 'alert' }, nameText(nameCode))
                : h('div', { key: 'nh', className: 'kbkc-help' }, [...nameDraft.trim()].length + ' / ' + NAME_MAX + ' · ' + kt('Il se présente avec ce nom. Le produit reste Kaby partout ailleurs.', 'It introduces itself with this name. The product stays Kaby elsewhere.')),
              h('label', { key: 'll', className: 'kbkc-lab', htmlFor: 'kbkc-look', style: { marginTop: 4 } }, kt('Persona', 'Persona')),
              h('input', { key: 'li', id: 'kbkc-look', className: 'kbkc-in', type: 'text', maxLength: 300, value: lookDraft, 'data-kb': 'kaby-custom-look',
                placeholder: kt('Décris son allure, par ex. une femme calme, la trentaine, cheveux courts, pull vert', 'Describe how it looks, e.g. a calm woman in her thirties, short dark hair, green sweater'),
                onChange: (e) => { touched.current.look = true; setLookDraft(e.target.value) }, onBlur: saveLook, onKeyDown: (e) => { if (e.key === 'Enter') saveLook() } }),
              h('div', { key: 'g', className: 'kbkc-row' }, [
                h('button', { key: 'b', type: 'button', className: 'kbkc-btn', style: { borderWidth: 1.5 }, 'data-kb': 'kaby-custom-generate', disabled: gen.busy || lookDraft.trim() === '', onClick: generate }, [svg(h, ICON.spark), h('b', { key: 't' }, hasPortrait ? kt('Régénérer le portrait', 'Regenerate portrait') : kt('Générer un portrait', 'Generate portrait'))]),
                h('span', { key: 'h', className: 'kbkc-help' }, kt('avec le modèle d’image de tes Modèles', 'with the image model of your Models') + (gen.price !== null ? ' · ≈ $' + gen.price : ''))
              ]),
              gen.error !== '' ? h('div', { key: 'ge', className: 'kbkc-err', role: 'alert', 'data-kb': 'kaby-custom-gen-error' }, gen.error) : null,
              h('div', { key: 'i', className: 'kbkc-row' }, [
                h('button', { key: 'u', type: 'button', className: 'kbkc-btn sm', 'data-kb': 'kaby-custom-import', 'aria-pressed': importing ? 'true' : 'false', onClick: () => setImporting(!importing) }, kt('Importer une image', 'Import an image')),
                hasPortrait ? h('button', { key: 'r', type: 'button', className: 'kbkc-btn sm', 'data-kb': 'kaby-custom-remove-portrait', onClick: removePortrait }, kt('Retirer le portrait', 'Remove the portrait')) : null
              ]),
              importing ? h('div', { key: 'imp', className: 'kbkc-col' }, [
                h('label', { key: 'c', className: 'kbkc-row' }, [h('input', { key: 'i', type: 'checkbox', 'data-kb': 'kaby-custom-consent', checked: consent, onChange: (e) => setConsent(e.target.checked) }), h('span', { key: 't' }, kt('J’ai le droit d’utiliser cette image. Ce n’est pas le visage d’une autre personne.', 'I have the right to use this image. It is not another person’s face.'))]),
                h('input', { key: 'f', type: 'file', accept: 'image/png,image/jpeg,image/webp', 'data-kb': 'kaby-custom-file', disabled: !consent, 'aria-label': kt('Choisir une image', 'Choose a picture'), onChange: (e) => importFile(e.target.files && e.target.files[0]) })
              ]) : null,
              notice !== '' ? h('div', { key: 'n', className: 'kbkc-err', role: 'alert' }, notice) : null,
              h('div', { key: 'hint', className: 'kbkc-help' }, kt('Elle sert dans la barre du chat, la liste et les appels. Le bot Telegram et WhatsApp garde sa photo : elle est la même pour tout le monde.', 'It shows in the chat strip, the list and calls. The Telegram and WhatsApp bot keeps its photo: it is the same for everyone.'))
            ])
          ])
        ])

        const voiceBlock = h('section', { className: 'kbkc-card', 'data-kb': 'kaby-custom-voice' }, [
          h('div', { key: 'c', className: 'kbkc-cap' }, kt('Voix', 'Voice')),
          h('div', { key: 'p', className: 'kbkc-row', style: { gap: 10 } }, [
            h('button', { key: 'def', type: 'button', className: 'kbkc-vp', 'data-kb': 'kaby-custom-voice-pill', 'data-voice': 'default', 'aria-pressed': profile.voice.pick === 'default' ? 'true' : 'false', onClick: () => pickVoice({ pick: 'default' }) }, [svg(h, ICON.wave), kt('Voix de l’app', 'App voice')])
          ].concat(voices.pills.map((v) => h('button', { key: v.engine + '|' + v.voice, type: 'button', className: 'kbkc-vp', 'data-kb': 'kaby-custom-voice-pill', 'data-voice': v.voice, 'aria-pressed': sameVoice(profile.voice, v) ? 'true' : 'false', title: v.engineName + (v.lang ? ' · ' + v.lang : ''), onClick: () => pickVoice({ pick: 'voice', engine: v.engine, voice: v.voice, lang: v.lang }) }, [svg(h, ICON.wave), v.label])))
            .concat(profile.customVoice !== null ? [h('button', { key: 'custom', type: 'button', className: 'kbkc-vp', 'data-kb': 'kaby-custom-voice-pill', 'data-voice': 'custom', 'aria-pressed': profile.voice.pick === 'custom' ? 'true' : 'false', onClick: () => pickVoice({ pick: 'custom' }) }, [svg(h, ICON.mic), profile.customVoice.name])] : [])
            .concat([
              h('button', { key: 'pv', type: 'button', className: 'kbkc-btn', 'data-kb': 'kaby-custom-preview', disabled: playing, onClick: preview }, [svg(h, ICON.play, 13), playing ? kt('Lecture…', 'Playing…') : kt('Écouter', 'Preview')]),
              h('button', { key: 'cv', type: 'button', className: 'kbkc-btn dashed', 'data-kb': 'kaby-custom-custom-voice', onClick: () => setCv({ consent: false, sample: null, name: '', recording: '', error: '' }) }, [svg(h, ICON.mic), kt('Voix perso · enregistrer ou importer', 'Custom voice · record or upload')])
            ])),
          voices.all.length > voices.pills.length ? h('div', { key: 'more', className: 'kbkc-row' }, [
            h('label', { key: 'l', className: 'kbkc-help', htmlFor: 'kbkc-more' }, kt('Toutes les voix', 'All voices')),
            h('select', { key: 's', id: 'kbkc-more', className: 'kbkc-in', style: { width: 280 }, 'data-kb': 'kaby-custom-more-voices', value: profile.voice.pick === 'voice' ? profile.voice.engine + '|' + profile.voice.voice : '',
              onChange: (e) => { const hit = voices.all.find((v) => v.engine + '|' + v.voice === e.target.value); if (hit !== undefined) pickVoice({ pick: 'voice', engine: hit.engine, voice: hit.voice, lang: hit.lang }) } },
            [h('option', { key: '', value: '' }, kt('Choisir…', 'Choose…'))].concat(voices.all.map((v) => h('option', { key: v.engine + '|' + v.voice, value: v.engine + '|' + v.voice }, v.label + (v.lang ? ' (' + v.lang + ')' : '') + ' · ' + v.engineName))))
          ]) : null,
          h('div', { key: 's', className: 'kbkc-row' }, [
            h('span', { key: 'c', className: 'kbkc-chip' + (profile.voice.pick === 'custom' ? ' warn' : '') }, profile.voice.pick === 'custom' ? kt('Pas encore parlée', 'Not spoken yet') : (profile.voice.pick === 'default' ? kt('Voix de l’app', 'App voice') : kt('Sa propre voix', 'Its own voice'))),
            h('span', { key: 't', className: 'kbkc-help' }, voiceSummary(profile, voices.all) + (profile.voice.pick === 'custom' ? ' · ' + kt('aucun moteur installé ne sait parler avec une voix clonée', 'no installed engine speaks a cloned voice yet') : ''))
          ]),
          voiceNotice !== '' ? h('div', { key: 'vn', className: 'kbkc-err', role: 'alert', 'data-kb': 'kaby-custom-voice-error' }, voiceNotice) : null,
          h('div', { key: 'n', className: 'kbkc-help' }, ktn('Sans choix, {name} parle avec la voix de Réglages › Voix.', '{name} speaks with the voice of Settings › Voice unless you choose one.'))
        ])

        const faceBlock = h('section', { className: 'kbkc-card', 'data-kb': 'kaby-custom-face' }, [
          h('div', { key: 'c', className: 'kbkc-cap' }, kt('Visage en appel vidéo', 'Face on video calls')),
          h('div', { key: 'h', className: 'kbkc-help' }, ktn('Le fournisseur de visage de {name} et ses propres clés, séparés de Réglages › Appels : les deux peuvent utiliser des comptes différents.', '{name}’s own face provider and its own keys, separate from Settings › Calls: the two can use different accounts.')),
          h('div', { key: 'g', className: 'kbkc-grid' }, [
            h('div', { key: 'n', className: 'kbkc-provnav', role: 'group', 'aria-label': kt('Fournisseurs de visage', 'Face providers') }, providers.map((p) => h('button', { key: p.id, type: 'button', className: 'kbkc-provbtn', 'data-kb': 'kaby-custom-face-provider', 'data-provider': p.id, 'aria-current': viewed !== undefined && viewed.id === p.id ? 'true' : 'false', onClick: () => setFaceView(p.id) }, [
              h('i', { key: 'd', className: 'kbkc-dot' + (useFace === p.id ? ' on' : ''), 'aria-hidden': 'true' }), h('span', { key: 'n', style: { flex: '1 1 auto' } }, tx(p.name)), p.available !== true ? h('span', { key: 's', className: 'kbkc-help' }, kt('bientôt', 'soon')) : null]))),
            viewed === undefined ? null : h('div', { key: 'p', className: 'kbkc-prov' }, [
              h('div', { key: 'hd', className: 'kbkc-row' }, [h('h5', { key: 't' }, tx(viewed.name)), h('span', { key: 'a', className: 'kbkc-chip' }, kt('Visage', 'Face')), h('span', { key: 'b', className: 'kbkc-chip ' + providerState(viewed, profile).cls }, providerState(viewed, profile).chip), useFace === viewed.id ? h('span', { key: 'u', className: 'kbkc-chip ok' }, ktn('Utilisé pour les appels de {name}', 'Used for {name}’s calls')) : null]),
              h('div', { key: 'n', className: 'kbkc-help' }, tx(viewed.note)),
              h('div', { key: 'pr', className: 'kbkc-help' }, tx(viewed.price)),
              viewed.available !== true ? h('div', { key: 'soon', className: 'kbkc-notice', 'data-kb': 'kaby-custom-face-soon' }, kt('Ce fournisseur est listé pour montrer ce qui est prévu. Il ne peut pas encore être utilisé : sa clé se règlera ici, séparément de Réglages › Appels.', 'This provider is listed to show what is planned. It cannot be used yet: its key will be set here, separately from Settings › Calls.')) : null,
              viewed.kind === 'none' ? h('div', { key: 'none', className: 'kbkc-notice' }, ktn('Les appels avec {name} restent vocaux : le bouton caméra est grisé et dit pourquoi.', 'Calls with {name} stay voice only: the camera button is off and says why.')) : null,
              h('div', { key: 'f', className: 'kbkc-foot' }, [
                h('span', { key: 's', style: { flex: '1 1 auto' } }),
                h('button', { key: 'u', type: 'button', className: 'kbkc-btn pri', 'data-kb': 'kaby-custom-face-use', disabled: !providerState(viewed, profile).usable, onClick: () => change('/profile', { patch: { face: { use: viewed.id } } }) },
                  useFace === viewed.id ? kt('Utilisé', 'In use') : ktn('Utiliser pour les appels de {name}', 'Use for {name}’s calls'))
              ])
            ])
          ])
        ])

        const customWindow = cv === null ? null : h('div', { className: 'kbkc-veil', role: 'presentation' }, h('div', { className: 'kbkc-modal', role: 'dialog', 'aria-label': kt('Créer une voix perso', 'Create a custom voice'), 'data-kb': 'kaby-custom-cv' }, [
          h('div', { key: 'h', className: 'kbkc-row' }, [h('b', { key: 't', style: { fontSize: 16, flex: '1 1 auto' } }, kt('Créer une voix perso', 'Create a custom voice')), h('button', { key: 'x', type: 'button', className: 'kbkc-btn sm', 'aria-label': kt('Fermer', 'Close'), 'data-act': 'close-cv', onClick: closeCustom }, '×')]),
          h('div', { key: 'd', className: 'kbkc-help' }, kt('Enregistre ou importe un consentement et un échantillon. L’échantillon reste sur cet ordinateur.', 'Record or upload a consent and a sample. The sample stays on this computer.')),
          h('div', { key: 's1', className: 'kbkc-step' }, [
            h('div', { key: 't', className: 'kbkc-row' }, [h('b', { key: 'b', style: { flex: '1 1 auto' } }, kt('Étape 1 · Enregistrement du consentement', 'Step 1 · Consent recording')), cv.consent === true ? h('span', { key: 'ok', className: 'kbkc-chip ok' }, kt('Enregistré', 'Recorded')) : null]),
            h('div', { key: 'x', className: 'kbkc-help' }, kt('La personne doit dire « Je consens à la création de cette voix ». C’est une exigence légale. L’enregistrement n’est pas gardé : l’hôte retient seulement l’heure du consentement.', 'The speaker must say “I consent to the creation of this voice”. Legal requirement. The recording itself is not kept: the host keeps only the time of the consent.')),
            h('div', { key: 'b', className: 'kbkc-row' }, [
              h('button', { key: 'r', type: 'button', className: 'kbkc-btn sm', 'data-act': 'record-consent', disabled: cv.recording === 'sample', onClick: () => toggleRecording('consent') }, cv.recording === 'consent' ? kt('Arrêter', 'Stop') : (cv.consent === true ? kt('Réenregistrer', 'Record again') : kt('Enregistrer', 'Record'))),
              h('button', { key: 'c', type: 'button', className: 'kbkc-btn sm', 'data-act': 'confirm-consent', onClick: () => setCv(Object.assign({}, cv, { consent: true })) }, kt('Je l’ai dit à voix haute', 'I said it aloud'))
            ])
          ]),
          h('div', { key: 's2', className: 'kbkc-step' }, [
            h('div', { key: 't', className: 'kbkc-row' }, [h('b', { key: 'b', style: { flex: '1 1 auto' } }, kt('Étape 2 · Échantillon audio', 'Step 2 · Audio sample')), cv.sample !== null ? h('span', { key: 'ok', className: 'kbkc-chip ok' }, kt('Prêt', 'Ready')) : null]),
            h('div', { key: 'x', className: 'kbkc-help' }, kt('Un enregistrement net de 10 à 60 secondes de la voix à cloner. 10 Mo au plus.', 'A clean 10–60 second recording of the voice to clone. Max 10 MB.')),
            h('div', { key: 'b', className: 'kbkc-row' }, [
              h('button', { key: 'r', type: 'button', className: 'kbkc-btn sm', 'data-act': 'record-sample', disabled: cv.recording === 'consent', onClick: () => toggleRecording('sample') }, cv.recording === 'sample' ? kt('Arrêter', 'Stop') : (cv.sample !== null ? kt('Réenregistrer', 'Record again') : kt('Enregistrer', 'Record'))),
              h('input', { key: 'f', type: 'file', accept: 'audio/*', 'aria-label': kt('Importer un échantillon', 'Upload a sample'), 'data-act': 'upload-sample', onChange: (e) => uploadSample(e.target.files && e.target.files[0]) })
            ])
          ]),
          h('label', { key: 'nl', className: 'kbkc-lab', htmlFor: 'kbkc-cvname' }, kt('Nom', 'Name')),
          h('input', { key: 'ni', id: 'kbkc-cvname', className: 'kbkc-in', type: 'text', maxLength: 40, value: cv.name, placeholder: kt('par ex. Ma voix', 'e.g. My voice'), 'data-act': 'cv-name', onChange: (e) => setCv(Object.assign({}, cv, { name: e.target.value })) }),
          h('div', { key: 'w', className: 'kbkc-notice w' }, kt('Aucun moteur installé ne sait parler avec une voix clonée : il faut une clé ElevenLabs.', 'No installed engine speaks a cloned voice yet: it needs an ElevenLabs key.')),
          cv.error ? h('div', { key: 'e', className: 'kbkc-err', role: 'alert' }, cv.error) : null,
          h('div', { key: 'f', className: 'kbkc-row' }, [
            h('span', { key: 's', style: { flex: '1 1 auto' } }),
            profile.customVoice !== null ? h('button', { key: 'd', type: 'button', className: 'kbkc-btn', 'data-act': 'delete-custom', onClick: async () => { await change('/voice-sample/remove', {}); setCv(null) } }, kt('Supprimer la voix perso', 'Delete the custom voice')) : null,
            h('button', { key: 'c', type: 'button', className: 'kbkc-btn', onClick: closeCustom }, kt('Annuler', 'Cancel')),
            h('button', { key: 'ok', type: 'button', className: 'kbkc-btn pri', 'data-act': 'save-custom', disabled: !(cv.consent === true && cv.sample !== null && cv.sample.data !== null && cv.name.trim() !== ''), onClick: saveCustom }, kt('Enregistrer la voix', 'Save the voice'))
          ])
        ]))

        const tabLabel = (id) => ({
          look: kt('Identité et voix', 'Identity & voice'),
          face: kt('Appels vidéo', 'Video calls'),
          work: kt('Travail', 'Work'),
          permissions: kt('Autorisations', 'Permissions')
        })[id]
        const onTabKey = (e) => {
          const at = TAB_IDS.indexOf(tab)
          const next = e.key === 'ArrowRight' ? (at + 1) % TAB_IDS.length : e.key === 'ArrowLeft' ? (at + TAB_IDS.length - 1) % TAB_IDS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TAB_IDS.length - 1 : -1
          if (next < 0) return
          e.preventDefault()
          setTab(TAB_IDS[next])
          try { const btn = document.getElementById('kbkc-tab-' + TAB_IDS[next]); if (btn !== null) btn.focus() } catch (e2) { /* no layout */ }
        }
        const panel = (id, ...cards) => h('div', { key: 'panel-' + id, id: 'kbkc-panel-' + id, className: 'kbkc-panel', role: 'tabpanel', 'aria-labelledby': 'kbkc-tab-' + id, 'data-kb': 'kaby-custom-panel-' + id, hidden: tab !== id }, ...cards)

        // The page's description lives in the « ? » card of the Suite's Help (its `lead`); it is drawn under the title only where that Help does not exist (no Suite).
        const lead = kt('Comment ton assistant est et parle, où il travaille, ce qu’il peut faire sans te demander et quand il se réveille. Ses règles et sa mémoire ne changent pas ici.', 'How your assistant looks and sounds, where it works, what it may do without asking and when it wakes up. Its rules and its memory do not change here.')
        return h('div', { className: 'kbkc', 'data-kb': 'kaby-custom-page' }, h('div', { className: 'kbkc-page' }, [
          h('div', { key: 'hd' },
            pageHead({ id: 'kybernos-kaby-customisation', page: 'kaby', lead: lead, title: 'Kaby' }),
            helpAbsent() ? h('p', { className: 'kbkc-lead' }, lead) : null),
          h('div', { key: 'tabs', className: 'kbkc-tabs', role: 'tablist', 'aria-label': kt('Réglages de Kaby', 'Kaby settings'), 'data-kb': 'kaby-custom-tabs', onKeyDown: onTabKey }, TAB_IDS.map((id) => h('button', {
            key: id, id: 'kbkc-tab-' + id, type: 'button', role: 'tab', className: 'kbkc-tab', 'data-kb': 'kaby-custom-tab', 'data-tab': id, 'aria-selected': tab === id ? 'true' : 'false', 'aria-controls': 'kbkc-panel-' + id, tabIndex: tab === id ? 0 : -1, onClick: () => setTab(id)
          }, tabLabel(id)))),
          // Every card stays mounted and only the open tab is shown: a draft in Permissions or a half-typed name is still there when the person comes back.
          panel('look', identity, voiceBlock),
          panel('face', faceBlock),
          panel('work', h(WhereCard, { key: 'where' }), h(WakeCard, { key: 'wake' })),
          panel('permissions', h(MandateCard, { key: 'mandate' })),
          customWindow
        ]))
      }
      return Panel
    }

    // ── mount ────────────────────────────────────────────────────────────────────────────────────────────────────────────
    const mount = (ctx, scope) => {
      try {
        const slots = scope.slots
        if (slots == null || typeof slots.inject !== 'function') return
        const React = typeof require === 'function' ? require('react') : null
        if (React == null) return
        ctx.effect(() => { const s = document.createElement('style'); s.dataset.plugin = '@local/kybernos-kaby-customisation'; s.textContent = CSS; document.head.appendChild(s); return () => s.remove() }, 'kybernos-kaby-customisation: styles')
        const Panel = buildPanel(React)
        ctx.effect(() => slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: SECTION_ID, order: 31, label: 'Kaby' },
          () => React.createElement(Panel))), 'kybernos-kaby-customisation: section')
      } catch (e) { /* the section is optional */ }
    }

    const start = (ctx) => {
      try {
        ctx.effect(() => {
          const seam = { profile: () => store.profile, subscribe: (fn) => { store.listeners.add(fn); return () => store.listeners.delete(fn) }, refresh: refresh, open: openSettings }
          window.__KB_KABY__ = seam
          announce()
          refresh()
          return () => { try { if (window.__KB_KABY__ === seam) delete window.__KB_KABY__ } catch (e) { /* window gone */ } announce() }
        }, 'kybernos-kaby-customisation: seam')
      } catch (e) { /* the seam is optional */ }
      try { ctx.inject(['slots'], (scope) => { mount(ctx, scope || {}) }) } catch (e) { /* optional */ }
    }

    return {
      name: NAME,
      inject: [],
      apply: start,
      __test: { buildPanel, buildCards, fill, draftOf, draftPreset, mandateChip, mandateProblem, whereChip, dateText, presetLabel, PRESET_ORDER, MANDATE, TASKS, NATIVE, LOAD, WAKE_CRON, wakePrompt, wakeInput, wakeTaskOf, wakeApproved, wakeChip, wakeProblem, readWake, prettyVoice, kt, tx, lang, nameText, portraitProblem, portraitPrompt, voicePills, sameVoice, voiceSummary, sampleLine, providerState, publish, store, CSS, NAME_MAX, PILLS_SHOWN, TAB_IDS }
    }
  }
})
