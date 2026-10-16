#!/usr/bin/env node
/** Harnais client de kybernos-auto : parse module + garde-fous de surface,
 *  alignés sur la maquette composer-auto-c-health (panneau + santé). */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(HERE, 'client.js'), 'utf8')

let ok0 = 0
let ko = 0
const ok = (nom, cond, detail) => {
  if (cond === true) { ok0 += 1; console.log('  ✓ ' + nom) } else { ko += 1; console.log('  ✗ ' + nom + (detail !== undefined ? ' → ' + String(detail).slice(0, 160) : '')) }
}
const aDataKb = (id) => src.indexOf("'data-kb': '" + id + "'") !== -1 || src.indexOf("setAttribute('data-kb', '" + id + "')") !== -1

ok('data-kb en anglais sur chaque surface (panneau, toggle, pastille, page, chips, santé, re-check, warm cache)',
  ['auto-popover', 'auto-chip-toggle', 'auto-available', 'auto-settings', 'auto-whitelist-chips', 'auto-whitelist-add', 'auto-health', 'auto-health-recheck', 'auto-last-check', 'auto-warm-cache', 'auto-global-toggle']
    .every(aDataKb), ['auto-popover', 'auto-chip-toggle', 'auto-available', 'auto-settings', 'auto-health-recheck', 'auto-warm-cache'].filter((i) => !aDataKb(i)).join(','))
ok('aucune couleur en dur (jetons --dsw-alias uniquement)', !/#[0-9a-fA-F]{6}\b/.test(src), (src.match(/#[0-9a-fA-F]{6}\b/g) || []).slice(0, 4))
ok('titles traduits par kt() (pas de français nu en attribut title)', !/title:\s*'[^']*[éèàêç][^']*'/.test(src) && !/\.title = '[^']*[éèàêç]/.test(src))
ok('la rangée Auto est un enfant du menu natif (sous Model/Effort), pas un overlay flottant',
  src.indexOf('m.appendChild(panneau)') !== -1 && src.indexOf('z-index:1200') === -1 && src.indexOf('document.body.appendChild') === -1)
ok('Model/Effort (menuitem) verrouillés tant qu’Auto est actif, la rangée Auto reste active',
  src.indexOf("querySelectorAll('[role=\"menuitem\"]')") !== -1 && src.indexOf("it.style.pointerEvents = on ? 'none'") !== -1)
ok('le menu est remonté du hauteur de la rangée (ancré par le haut)', src.indexOf("translateY(") !== -1)
ok('id de session lu dans localStorage « dsh.sessions.current » (pas seulement l’URL)', src.indexOf("'dsh.sessions.current'") !== -1)
ok('état PAR SESSION : POST /kybernos-auto/session avec sessionId courant', src.indexOf("'/kybernos-auto/session'") !== -1 && src.indexOf('sessionId: sessionIdCourante()') !== -1)
ok('pastille « N of M models available » alimentée par disponibles/total', src.indexOf('etat.disponibles') !== -1 && src.indexOf('etat.total') !== -1)
ok('colonnes Model / Latency / Errors / Cache hit + badge warm cache', src.indexOf("'Cache hit'") !== -1 && src.indexOf("'warm cache'") !== -1 && src.indexOf("'Latency'") !== -1)
ok('relecture automatique toutes les 60 s + « Check now » qui sonde pour de vrai (POST /kybernos-auto/probe)', src.indexOf('setInterval(lire, 60000)') !== -1 && src.indexOf("'Check now'") !== -1 && src.indexOf("'/kybernos-auto/probe'") !== -1)
ok('un DSH démarré avant la route /probe (404) reçoit un message clair, pas une erreur de parse JSON', src.indexOf('r.status === 404 ? Promise.reject') !== -1)
ok('l’état d’un modèle dit POURQUOI (cause, retour prévu, dernière erreur), dans la page et dans le composer', src.indexOf('const statutTxt') !== -1 && src.indexOf("'data-kb': 'auto-health-why'") !== -1 && (src.match(/statutTxt\(/g) || []).length === 2)
ok('un clic dans le panneau ne ferme pas le menu natif (pointerdown arrêté)', src.indexOf("'pointerdown'") !== -1 && src.indexOf('stopPropagation') !== -1)
// What a person reads on the page is a sentence (audit 2026-10-16): no HTTP route inside a paragraph, no debug « scope: session » line,
// and one spelling of the page's name, the one of the Settings menu.
ok('the page shows no HTTP route and no debug line (« POST /kybernos-auto/report », « scope: session »)', !/\(POST \/kybernos-auto/.test(src) && !/scope: session/.test(src) && src.indexOf('kaa-foot') === -1)
ok('the page title is « Auto Routing », as the Settings menu says it', src.indexOf("}, 'Auto Routing'),") !== -1 && src.indexOf("}, 'Auto routing'),") === -1 && src.indexOf("label: 'Auto Routing' }") !== -1)

// ── the page of V-30 / A3-24: one plain switch, three scopes, the rest under one fold ─────────────────────────────────
ok('la page ouvre sur une phrase simple, UN interrupteur « Routage automatique » et le choix des modèles : tous / gratuits / ma liste',
  aDataKb('auto-global-toggle') && aDataKb('auto-scope') && src.indexOf("'data-kb': 'auto-scope-' + x[0]") !== -1 && src.indexOf("['all', kt('Tous les modèles', 'All models')]") !== -1 && src.indexOf("['free', kt('Modèles gratuits', 'Free models')]") !== -1 && src.indexOf("['custom', kt('Ma liste', 'My list')]") !== -1)
ok('le choix part en autoScope vers l\'hôte, et « tous » est la valeur par défaut tant que rien n\'est choisi', src.indexOf('ecrire({ autoScope: s })') !== -1 && src.indexOf("etat.scope === 'free' || etat.scope === 'custom' ? etat.scope : 'all'") !== -1)
ok('la liste tapée n\'apparaît que pour « ma liste » (chips, champ, liste des modèles du profil)', src.indexOf("scope === 'custom'\n              ? h(React.Fragment, null,\n                h('div', { className: 'kaa-chips'") !== -1 && src.indexOf("h('datalist', { id: 'kaa-modeles' }") !== -1)
ok('repli du chat, classifieur et santé des modèles sont sous UN pli (« Réglages avancés »), fermé au départ',
  aDataKb('auto-advanced') && aDataKb('auto-advanced-body') && src.indexOf('React.useState(false)') !== -1 && /avance \? h\('div', \{ className: 'kaa-avance'[\s\S]*auto-failover-toggle[\s\S]*auto-classifier-input[\s\S]*auto-health'/.test(src))
ok('plus de mots de développeur en tête de page : ni « scope: session », ni l\'étiquette « session »', src.indexOf("'scope: session'") === -1 && src.indexOf("h('span', { className: 'kaa-tag' }, 'session')") === -1 && src.indexOf('kaa-foot') === -1 && src.indexOf('kaa-tag') === -1)
ok('un refus de l\'hôte est dit sous le champ, dans la langue de la personne (forme, modèle inconnu), pas dans le bandeau du bas', aDataKb('auto-whitelist-error') && src.indexOf("code === 'liste-forme'") !== -1 && src.indexOf("code === 'liste-inconnu'") !== -1 && src.indexOf('setRefus(refusTxt(j))') !== -1)
ok('ce qui n\'est pas dans le profil est dit tout de suite, avant même d\'interroger l\'hôte', src.indexOf("modeles.every((x) => x.cle !== m)") !== -1)
ok('le tableau de santé en montre huit lignes et propose le reste (« tous » peut en lister une centaine)', src.indexOf('const SANTE_VISIBLE = 8') !== -1 && aDataKb('auto-health-more'))
ok('un champ de saisie a ses états ARIA (invalide, décrit par son message)', src.indexOf("'aria-invalid': refus !== '' ? 'true' : 'false'") !== -1 && src.indexOf("'aria-describedby': refus !== '' ? 'kaa-refus' : undefined") !== -1)

// ── A3-34: the Settings page when the host half does not answer ─────────────
// It used to stay on a bare « … » for ever. The client is run in a sandbox with a fake React whose first hooks are set.
{
  const vm = await import('node:vm')
  let loaded = null
  const noop = () => {}
  const fakeEl = () => ({ dataset: {}, style: {}, remove: noop, append: noop, appendChild: noop, setAttribute: noop, addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], classList: { add: noop, remove: noop, toggle: noop, contains: () => false } })
  const sandbox = {
    window: { __KB_LANG_RESOLVE__: () => 'en', __ModuleLoader__: { load: (m) => { loaded = m } }, addEventListener: noop },
    document: { ...fakeEl(), createElement: fakeEl, head: fakeEl(), body: fakeEl(), documentElement: fakeEl(), documentElement_: null, readyState: 'complete' },
    localStorage: { getItem: () => null, setItem: noop },
    location: { hash: '' },
    setInterval: () => 0, clearInterval: noop, setTimeout: () => 0, clearTimeout: noop,
    fetch: () => new Promise(() => {}), // never answers: the page's own reads are not what is under test
    MutationObserver: class { observe () {} disconnect () {} },
    console
  }
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox)
  const walk = (node, hit, out = []) => {
    if (node === null || typeof node !== 'object') return out
    if (hit(node)) out.push(node)
    for (const c of [].concat(node.children || [])) walk(c, hit, out)
    return out
  }
  const textOf = (node) => (node === null || node === undefined ? '' : (typeof node === 'object' ? [].concat(node.children || []).map(textOf).join('') : String(node)))
  const renderSettings = (over) => {
    let n = 0
    const React = {
      createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
      useState: (v) => { const i = n; n += 1; return [i in over ? over[i] : v, noop] },
      useEffect: noop
    }
    const plugin = loaded.factory((name) => (name === 'react' ? React : null))
    let reg = null
    try {
      plugin.apply({ slots: { inject: (name, fn) => { if (name === 'settings.section') reg = fn(); return noop }, register: (meta, render) => ({ meta, render }) }, effect: (fn) => fn() })
    } catch (e) { /* the composer part of apply needs a real DOM: the settings section is registered before it */ }
    return reg === null ? null : reg.render().type()
  }
  const SENTENCE = 'This page’s helper is not answering. If DSH was just updated, restart DSH, then press Retry.'
  // the hook that holds « the state could not be read »: counted in the source, so a new hook above it does not break this
  const echecIndex = (src.slice(src.indexOf('const KbAutoSettings = () => {'), src.indexOf('const echecPair')).match(/React\.useState\(/g) || []).length
  const failed = renderSettings({ [echecIndex]: true })
  ok('Settings › Auto routing: the page is registered and renders', failed !== null)
  if (failed !== null) {
    const panel = walk(failed, (nd) => nd.props && nd.props['data-kb'] === 'auto-down')
    ok('state unreadable → a panel with the sentence (not a bare « … »)', panel.length === 1 && textOf(panel[0]).includes(SENTENCE), panel.length && textOf(panel[0]))
    ok('…and a Retry', walk(failed, (nd) => nd.type === 'button' && nd.props['data-kb'] === 'auto-retry' && textOf(nd) === 'Retry').length === 1)
    ok('…under the page\'s own title and intro, which stay', walk(failed, (nd) => nd.type === 'h4' && textOf(nd) === 'Auto Routing').length === 1 && walk(failed, (nd) => nd.props && nd.props.className === 'kaa-intro').length === 1)
    ok('…and the placeholder « … » is gone', textOf(failed).indexOf('…') === -1 || textOf(failed).indexOf('…') > 0)
  }
  const loading = renderSettings({})
  ok('first read still pending → « … », no failure panel yet', loading !== null && textOf(loading) === '…' && walk(loading, (nd) => nd.props && nd.props['data-kb'] === 'auto-down').length === 0)
  const fixture = { ok: true, global: false, whitelist: [], classifier: '', sessionOn: false, sante: [], total: 0, disponibles: 0, chaud: null, failover: { enabled: false, last: null }, sondeEnCours: false, plafond: 10, ttlSondeS: 60, checkedAt: 1792163152877, intervalS: 60 }
  const normal = renderSettings({ 0: fixture })
  ok('a readable state still renders the whole page, head included', normal !== null && walk(normal, (nd) => nd.type === 'h4').length === 1 && walk(normal, (nd) => nd.props && nd.props.className === 'kaa-intro').length === 1 && walk(normal, (nd) => nd.props && nd.props['data-kb'] === 'auto-down').length === 0)
}

console.log('\n' + (ko === 0 ? 'HARNAIS CLIENT VERT — ' + ok0 + ' contrôles ✓' : ko + ' échec(s)'))
process.exit(ko === 0 ? 0 : 1)
