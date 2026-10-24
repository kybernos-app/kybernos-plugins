// ═══════════════════════════════════════════════════════
// kybernos-kaby-customisation — client half: the Settings page "Kaby".
//
// How the person's assistant looks and sounds, in three blocks, the way Agent Teams draws a member:
//   Identity   the name, the words that describe the look, a portrait (made by the image model of the person's Models, or imported)
//   Voice      pills of voices with a Preview, and « Custom voice · record or upload » (a consent and a sample, kept on this computer)
//   Face       the face of Kaby's video calls: its own provider list and its own keys, in the manner of Settings › Calls › Face — and
//              separate from it, so the two can use different accounts. Providers that no call can use yet are listed as « soon ».
//
// Nothing here changes what Kaby can do, its rules or its memory: only its name, its picture and its voice.
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

    const readAsDataUrl = (file) => new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(new Error('unreadable'))
      r.readAsDataURL(file)
    })

    // ── the profile, shared between the page and the seam ──────────────────────────────────────────────────────────────
    const store = { profile: null, listeners: new Set(), failed: false }
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
      '.kbkc-titlerow{display:flex;align-items:center;gap:12px}',
      '.kbkc-titlerow h4{margin:0;font-size:22px;font-weight:700}',
      '.kbkc-lead{margin:4px 0 0;color:var(--dsw-alias-label-secondary,#666);max-width:62ch}',
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
      '@media (max-width:760px){.kbkc-id,.kbkc-grid{flex-direction:column}.kbkc-provnav{width:auto}}'
    ].join('\n')

    // ── icons (inline, current colour) ─────────────────────────────────────────────────────────────────────────────────
    const svg = (h, d, size) => h('svg', { viewBox: '0 0 24 24', width: size || 15, height: size || 15, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', className: 'kbkc-ic' }, h('path', { d: d }))
    const ICON = {
      wave: 'M3 10v4M7 6v12M11 3v18M15 8v8M19 5v14M22 10v4',
      spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
      mic: 'M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0zM5 11a7 7 0 0 0 14 0M12 18v4',
      play: 'M6 4l14 8-14 8z',
      up: 'M12 16V4M7 9l5-5 5 5M4 20h16'
    }

    // ── the page ────────────────────────────────────────────────────────────────────────────────────────────────────────
    const buildPanel = (React) => {
      const h = React.createElement
      const { useState, useEffect, useRef } = React

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
            h('div', { className: 'kbkc-titlerow' }, h('h4', null, 'Kaby')),
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

        return h('div', { className: 'kbkc', 'data-kb': 'kaby-custom-page' }, h('div', { className: 'kbkc-page' }, [
          h('div', { key: 'hd' }, [
            h('div', { key: 't', className: 'kbkc-titlerow' }, [h('h4', { key: 'h' }, 'Kaby'), typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { key: 'help', id: 'kybernos-kaby-customisation', page: 'kaby' }) : null]),
            h('p', { key: 'p', className: 'kbkc-lead' }, kt('Comment ton assistant est et parle. Ce qu’il sait faire, ses règles et sa mémoire ne changent pas ici.', 'How your assistant looks and sounds. What it can do, its rules and its memory do not change here.'))
          ]),
          identity, voiceBlock, faceBlock, customWindow
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
      __test: { buildPanel, prettyVoice, kt, tx, lang, nameText, portraitProblem, portraitPrompt, voicePills, sameVoice, voiceSummary, sampleLine, providerState, publish, store, CSS, NAME_MAX, PILLS_SHOWN }
    }
  }
})
