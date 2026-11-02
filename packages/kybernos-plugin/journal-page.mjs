// The chat Journal as ONE page a person can keep or send: a single .html file, nothing to load, nothing to send (the same principles as the dashboard snapshot page, docs/dev/snapshot-sharing.md).
//
//   journalDocument({ story, include, lang, logos, seal, evidence, made })  →  the document: the story cut down to what the person agreed to share
//   journalPageHtml(doc)                                                    →  { html, policy }: the page, with its content policy
//
// The document is built by WHITELIST: a field of the story that is not named here never reaches the page. The page (journal-viewer.js + journal-viewer.css, pinned by hash in its content
// policy) draws the document as text nodes and SVG shapes, never as HTML, loads nothing and sends nothing. What is kept back by default: the person's own words and the replies, who decided,
// the computers, the chat's number. Tool inputs and outputs, local file paths and prompts of the engine are never included.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { decisionKey } from './journal-story.mjs'

const here = (name) => new URL('./' + name, import.meta.url)
const isObj = (v) => v !== null && typeof v === 'object' && Array.isArray(v) === false
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const slice = (v, n) => (typeof v === 'string' && v !== '' ? v.slice(0, n) : null)
const flat = (v, n) => (typeof v === 'string' && v.trim() !== '' ? v.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, n) : null)
const httpUrl = (v) => { try { const u = new URL(v); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href.slice(0, 600) : null } catch (e) { return null } }

const MAX_MOMENTS = 400
const MAX_DELIVERABLES = 60
const MAX_LOGOS = 40
const MAX_LOGO_CHARS = 30000
const MAX_DOC_BYTES = 1500000

/** What the person can put in or keep out; the sheet in the Journal shows exactly these, in this order. */
export const DEFAULT_INCLUDE = Object.freeze({ approvers: true, timing: true, deliverables: true, prompts: false, names: false, computers: false, chatId: false, verify: false })

/** The switches as booleans. « Readers can check the seals » needs what the seal covers: the names, the computers and the chat's number. No decisions, no names, no computers, no check. */
export function resolveInclude (raw) {
  const r = isObj(raw) ? raw : {}
  const out = {}
  for (const k of Object.keys(DEFAULT_INCLUDE)) out[k] = typeof r[k] === 'boolean' ? r[k] : DEFAULT_INCLUDE[k]
  if (out.verify) { out.approvers = true; out.names = true; out.computers = true; out.chatId = true }
  if (!out.approvers) { out.names = false; out.computers = false }
  return out
}

const LABELS = {
  en: {
    pageTitle: 'Chat journal', eyebrow: 'Chat journal', madeWith: 'Made with Kybernos', running: 'Running', byAutomation: 'Started by an automation', byPerson: 'Started by a person', chatId: 'Chat',
    kActive: 'Active time', kWaited: 'Waited for people', kCrews: 'Crews', kHandovers: 'Handovers', kOpen: 'open', kErrors: 'Errors', kRecovered: 'all recovered', kCost: 'Cost', kTokens: 'Tokens', kFree: 'no price known', kDeliverables: 'Deliverables',
    tokens: 'tokens', costTitle: 'Over the chat', costOver: 'Cost over the chat', tokensOver: 'Tokens over the chat', timeTitle: 'Where the time went', timeCrews: 'Crews', timePeople: 'Waiting for people', timeChat: 'The chat itself',
    crewsTitle: 'Crews', crew: 'Crew', members: 'Members', failed: 'failed', finished: 'finished', isRunning: 'is running', connectorsTitle: 'Connected apps', calls: 'calls', errorsN: 'errors',
    storyTitle: 'Story of this chat', moments: 'moments', prev: 'Previous', next: 'Next', page: 'Page', of: 'of', perPage: 'Per page', textHidden: 'Text not included', decisionHidden: 'Who decided is not included.',
    you: 'A person', automation: 'Automation', reply: 'Reply', skill: 'Skill', memory: 'Memory', permissionAsked: 'Permission asked', questionAsked: 'Question asked', delivered: 'Delivered', model: 'Model', objective: 'Objective', actions: 'Actions', files: 'files',
    startsOn: 'starts on', switchedTo: 'switched to', savedNote: 'saved a note', lookedUp: 'looked something up', callFailed: 'call failed', recovered: 'Recovered on a later call',
    commands: 'Commands', edited: 'Files edited', read: 'Files read', web: 'Web lookups', mates: 'Teammates and sub-agents', otherActions: 'Other actions',
    needsPerson: 'Waiting for a person', answered: 'Answered', allowed: 'Allowed', declined: 'Declined', failedState: 'Failed', approver: 'Approver',
    deliverablesTitle: 'Deliverables and links', deliverablesHidden: 'Deliverables and links are not included.', none: 'Nothing yet.',
    sealed: 'Sealed', sealedT: 'Sealed on the computer that made this page: the log and the record of this decision had not changed since. A simple seal, not a qualified electronic signature.',
    sealBroken: 'Seal broken', sealBrokenT: 'The log or the record of this decision changed after it was sealed.', sealElsewhere: 'Sealed elsewhere', sealElsewhereT: 'Sealed with another key: it could not be checked.',
    sealChecking: 'Checking…', sealChecked: 'Checked in this browser', sealCheckedT: 'The signature matches the key in this page and what is shown here.', sealMismatch: 'Does not match', sealMismatchT: 'What is shown here is not what was sealed.', sealUnsupported: 'This browser cannot check it',
    verifyTitle: 'Seals', noSeals: 'No decision of this chat carries a seal.', sealsCheckable: 'Each seal is checked in this browser against the key of the computer that made it.', sealsClaimed: 'decisions were sealed and checked on the author\'s computer when this page was made.',
    sealsOk: 'seals checked in this browser', keyLabel: 'Key', sealNote: 'A simple seal, not a qualified electronic signature. It shows that nothing changed after the decision, as far as the key holder is trusted.',
    containsTitle: 'What this page contains', incApprovers: 'Decisions', incNames: 'Names', incComputers: 'Computers', incTiming: 'Durations and errors', incDeliverables: 'Deliverables and links', incPrompts: 'Messages and replies', incChatId: 'Chat number',
  },
  fr: {
    pageTitle: 'Journal d’un chat', eyebrow: 'Journal d’un chat', madeWith: 'Fait avec Kybernos', running: 'En cours', byAutomation: 'Lancé par une automatisation', byPerson: 'Lancé par une personne', chatId: 'Chat',
    kActive: 'Temps actif', kWaited: 'Attente de personnes', kCrews: 'Équipes', kHandovers: 'Passages à un humain', kOpen: 'en attente', kErrors: 'Erreurs', kRecovered: 'toutes rattrapées', kCost: 'Coût', kTokens: 'Tokens', kFree: 'aucun prix connu', kDeliverables: 'Livrables',
    tokens: 'tokens', costTitle: 'Au fil du chat', costOver: 'Coût au fil du chat', tokensOver: 'Tokens au fil du chat', timeTitle: 'Où est passé le temps', timeCrews: 'Équipes', timePeople: 'Attente de personnes', timeChat: 'Le chat lui-même',
    crewsTitle: 'Équipes', crew: 'Équipe', members: 'Membres', failed: 'en échec', finished: 'terminée', isRunning: 'en cours', connectorsTitle: 'Applications connectées', calls: 'appels', errorsN: 'erreurs',
    storyTitle: 'Histoire de ce chat', moments: 'moments', prev: 'Précédent', next: 'Suivant', page: 'Page', of: 'sur', perPage: 'Par page', textHidden: 'Texte non inclus', decisionHidden: 'Qui a décidé n’est pas inclus.',
    you: 'Une personne', automation: 'Automatisation', reply: 'Réponse', skill: 'Skill', memory: 'Mémoire', permissionAsked: 'Autorisation demandée', questionAsked: 'Question posée', delivered: 'Livré', model: 'Modèle', objective: 'Objectif', actions: 'Actions', files: 'fichiers',
    startsOn: 'démarre sur', switchedTo: 'passe sur', savedNote: 'a enregistré une note', lookedUp: 'a cherché quelque chose', callFailed: 'appel en échec', recovered: 'Rattrapé à un appel suivant',
    commands: 'Commandes', edited: 'Fichiers modifiés', read: 'Fichiers lus', web: 'Recherches web', mates: 'Équipiers et sous-agents', otherActions: 'Autres actions',
    needsPerson: 'En attente d’une personne', answered: 'Répondu', allowed: 'Autorisé', declined: 'Refusé', failedState: 'Échec', approver: 'Validateur',
    deliverablesTitle: 'Livrables et liens', deliverablesHidden: 'Les livrables et les liens ne sont pas inclus.', none: 'Rien pour l’instant.',
    sealed: 'Scellé', sealedT: 'Scellé sur l’ordinateur qui a fait cette page : le journal et la trace de cette décision n’avaient pas changé depuis. Un sceau simple, pas une signature électronique qualifiée.',
    sealBroken: 'Sceau brisé', sealBrokenT: 'Le journal ou la trace de cette décision a changé après son scellé.', sealElsewhere: 'Scellé ailleurs', sealElsewhereT: 'Scellé avec une autre clé : on n’a pas pu le vérifier.',
    sealChecking: 'Vérification…', sealChecked: 'Vérifié dans ce navigateur', sealCheckedT: 'La signature correspond à la clé de cette page et à ce qui est affiché ici.', sealMismatch: 'Ne correspond pas', sealMismatchT: 'Ce qui est affiché ici n’est pas ce qui a été scellé.', sealUnsupported: 'Ce navigateur ne peut pas le vérifier',
    verifyTitle: 'Sceaux', noSeals: 'Aucune décision de ce chat ne porte de sceau.', sealsCheckable: 'Chaque sceau est vérifié dans ce navigateur avec la clé de l’ordinateur qui l’a fait.', sealsClaimed: 'décisions étaient scellées et vérifiées sur l’ordinateur de l’auteur quand cette page a été faite.',
    sealsOk: 'sceaux vérifiés dans ce navigateur', keyLabel: 'Clé', sealNote: 'Un sceau simple, pas une signature électronique qualifiée. Il montre que rien n’a changé après la décision, tant qu’on fait confiance au détenteur de la clé.',
    containsTitle: 'Ce que contient cette page', incApprovers: 'Décisions', incNames: 'Noms', incComputers: 'Ordinateurs', incTiming: 'Durées et erreurs', incDeliverables: 'Livrables et liens', incPrompts: 'Messages et réponses', incChatId: 'Numéro du chat',
  },
}

/** An app's logo (SVG text from the person's connectors catalogue) as a data address the page shows in an `<img>`, or null. In an image an SVG runs no script; the checks are a second wall. */
export function logoUri (svg) {
  if (typeof svg !== 'string') return null
  const t = svg.trim()
  if (t.length < 20 || t.length > MAX_LOGO_CHARS || !/^<svg[\s>]/iu.test(t) || /<script|<foreignObject|<iframe|<!entity|\son[a-z]+\s*=|javascript:/iu.test(t)) return null
  const withNs = /^<svg[^>]*\sxmlns\s*=/iu.test(t) ? t : t.replace(/^<svg/iu, '<svg xmlns="http://www.w3.org/2000/svg"')
  return 'data:image/svg+xml;base64,' + Buffer.from(withNs, 'utf8').toString('base64')
}

/**
 * The document of a shared Journal. `story` is deriveStory's answer; `logos` is `{ connectorId: svgText }` from the browser (only ids the story knows are kept); `seal` is the route's
 * `{ alg, keyId, publicKey }` and `evidence` is `sealEvidence(...)`; `made` is the day the page is made (ISO date). Returns null when there is no story.
 */
export function journalDocument ({ story, include, lang, logos, seal, evidence, made } = {}) {
  if (!isObj(story) || !Array.isArray(story.moments)) return null
  const inc = resolveInclude(include)
  const language = lang === 'fr' ? 'fr' : 'en'
  const chat = isObj(story.chat) ? story.chat : {}
  const stats = isObj(story.stats) ? story.stats : {}
  const calm = (status) => (inc.timing ? status : (status === 'error' ? 'ok' : (status === 'failed' ? 'finished' : status)))
  const keyOfMoment = (m) => (m.source === 'permission' ? (m.approvalId ? decisionKey('permission', m.approvalId) : null) : (m.callId ? decisionKey('question', m.callId) : null))

  const approverOut = (a, key) => {
    const sealState = a.seal === 'valid' || a.seal === 'broken' || a.seal === 'foreign' ? a.seal : null
    const out = { state: inc.timing || a.state !== 'error' ? a.state : 'answered', at: num(a.at), who: inc.names ? slice(a.who, 80) : null, device: inc.computers ? slice(a.device, 80) : null, seal: sealState }
    if (inc.verify && sealState === 'valid' && key !== null && isObj(evidence) && isObj(evidence[key])) out.evidence = { payload: String(evidence[key].payload), sig: String(evidence[key].sig) }
    return out
  }

  const momentOut = (m) => {
    const out = { id: slice(m.id, 24), kind: slice(m.kind, 20), at: num(m.at) }
    if (inc.timing) { out.endAt = num(m.endAt); out.durMs = num(m.durMs) }
    if (m.kind === 'message') { out.automation = m.automation === true; out.text = inc.prompts ? flat(m.text, 600) : null }
    else if (m.kind === 'reply') { out.model = slice(m.model, 80); out.text = inc.prompts ? flat(m.text, 600) : null }
    else if (m.kind === 'crew') { out.crewId = slice(m.crewId, 80); out.status = calm(m.status === 'failed' || m.status === 'running' ? m.status : 'done') }
    else if (m.kind === 'connector' && isObj(m.connector)) { out.connectorId = slice(m.connector.id, 60); out.action = slice(m.connector.action, 80); out.status = m.status === 'error' ? calm('error') : (m.status === 'running' ? 'running' : 'ok'); out.recovered = m.recovered === true }
    else if (m.kind === 'skill') { out.name = slice(m.subject, 80); out.op = slice(m.op, 20) }
    else if (m.kind === 'memory') { out.op = m.op === 'write' ? 'write' : 'read'; out.text = inc.prompts ? flat(m.subject, 200) : null }
    else if (m.kind === 'handover') {
      out.source = m.source === 'permission' ? 'permission' : 'question'
      out.tool = slice(m.tool, 60)
      out.text = inc.prompts ? flat(m.text, 500) : null
      out.options = inc.prompts && Array.isArray(m.options) ? m.options.slice(0, 6).map((o) => flat(o, 80)).filter((o) => o !== null) : []
      out.outcome = inc.timing || m.outcome !== 'error' ? m.outcome : 'answered'
      out.waitMs = inc.timing ? num(m.waitMs) : null
      const key = keyOfMoment(m)
      out.approvers = inc.approvers && Array.isArray(m.approvers) ? m.approvers.slice(0, 4).map((a) => approverOut(a, key)) : []
    } else if (m.kind === 'output') {
      const files = Array.isArray(m.files) ? m.files : []
      out.count = files.length
      out.files = inc.deliverables ? files.slice(0, 12).map((f) => ({ name: slice(isObj(f) ? f.name : null, 120), description: slice(isObj(f) ? f.description : null, 200) })) : []
    } else if (m.kind === 'model') { out.provider = slice(m.provider, 60); out.model = slice(m.model, 80); out.initial = m.initial === true }
    else if (m.kind === 'goal') { out.op = slice(m.op, 20); out.text = inc.prompts ? flat(m.text, 300) : null }
    else if (m.kind === 'work') { out.counts = isObj(m.counts) ? { command: num(m.counts.command) || 0, edit: num(m.counts.edit) || 0, read: num(m.counts.read) || 0, web: num(m.counts.web) || 0, crew: num(m.counts.crew) || 0, other: num(m.counts.other) || 0 } : {}; out.total = num(m.total) || 0; out.failed = inc.timing ? (num(m.failed) || 0) : 0 }
    return out
  }

  const moments = story.moments.slice(-MAX_MOMENTS).map(momentOut)
  const crews = (Array.isArray(story.crews) ? story.crews : []).slice(0, 30).map((c) => ({
    id: slice(c.id, 80), name: slice(c.name, 120), state: calm(c.state === 'failed' || c.state === 'running' ? c.state : 'done'), startedAt: num(c.startedAt), endedAt: num(c.endedAt),
    durMs: inc.timing ? num(c.durMs) : null, tokens: num(c.tokens), costEur: num(c.costEur),
    members: (Array.isArray(c.members) ? c.members : []).slice(0, 12).map((m) => ({ label: slice(m.label, 80), phase: slice(m.phase, 60), model: slice(m.model, 80) })),
  }))
  const connectors = (Array.isArray(story.connectors) ? story.connectors : []).slice(0, 40).map((c) => ({ id: slice(c.id, 60), name: slice(c.name, 60), calls: num(c.calls) || 0, errors: inc.timing ? (num(c.errors) || 0) : 0 }))
  const logoMap = {}
  if (isObj(logos)) {
    let n = 0
    for (const c of connectors) {
      if (c.id === null || n >= MAX_LOGOS) continue
      const uri = logoUri(logos[c.id])
      if (uri !== null) { logoMap[c.id] = uri; n += 1 }
    }
  }
  const deliverables = inc.deliverables ? (Array.isArray(story.deliverables) ? story.deliverables : []).slice(0, MAX_DELIVERABLES).map((d) => {
    if (!isObj(d)) return null
    if (d.kind === 'link') { const u = httpUrl(d.url); return u === null ? null : { kind: 'link', name: slice(d.name, 120), description: slice(d.description, 120), url: u } }
    const name = slice(d.name, 120)
    return name === null ? null : { kind: 'file', name: name, description: slice(d.description, 200) }
  }).filter((d) => d !== null) : []

  const tokens = isObj(stats.tokens) ? stats.tokens : {}
  const doc = {
    kind: 'kybernos-journal', version: 1, made: typeof made === 'string' ? made.slice(0, 10) : null, lang: language, labels: LABELS[language], include: inc,
    title: inc.prompts ? flat(chat.title, 120) : null,
    chat: { id: inc.chatId ? slice(chat.id, 120) : null, startedAt: num(chat.startedAt), endedAt: num(chat.endedAt), running: chat.running === true, messages: num(chat.messages) || 0 },
    trigger: isObj(story.trigger) && story.trigger.kind === 'automation' ? 'automation' : 'chat',
    stats: {
      activeMs: inc.timing ? num(stats.activeMs) : null, waitingMs: inc.timing ? num(stats.waitingMs) : null, crewMs: inc.timing ? num(stats.crewMs) : null,
      moments: num(stats.moments) || 0, errors: inc.timing ? (num(stats.errors) || 0) : 0, openErrors: inc.timing ? (num(stats.openErrors) || 0) : 0,
      handovers: num(stats.handovers) || 0, handoversWaiting: num(stats.handoversWaiting) || 0, tokens: { input: num(tokens.input) || 0, output: num(tokens.output) || 0 },
      costEur: num(stats.costEur), deliverables: inc.deliverables ? (num(stats.deliverables) || 0) : 0,
    },
    series: (Array.isArray(story.series) ? story.series : []).slice(0, 60).map((p) => [num(isObj(p) ? p.tokens : null), num(isObj(p) ? p.costEur : null)]),
    models: (Array.isArray(story.models) ? story.models : []).slice(0, 12).map((m) => ({ provider: slice(m.provider, 60), model: slice(m.model, 80), calls: num(m.calls) || 0, tokens: num(m.tokens) || 0, costEur: num(m.costEur) })),
    connectors: connectors, logos: logoMap, crews: crews, moments: moments, deliverables: deliverables,
    seal: inc.verify && isObj(seal) && typeof seal.publicKey === 'string' ? { alg: 'ed25519', keyId: slice(seal.keyId, 40), publicKey: seal.publicKey.slice(0, 400) } : (isObj(seal) && inc.approvers ? { keyId: slice(seal.keyId, 40) } : null),
  }
  if (Buffer.byteLength(JSON.stringify(doc), 'utf8') > MAX_DOC_BYTES) { doc.moments = doc.moments.slice(-150); doc.logos = {} }
  return doc
}

const sha = (text) => "'sha256-" + createHash('sha256').update(text, 'utf8').digest('base64') + "'"
const escapeText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** JSON that sits in a `<script type="application/json">`: no `<` can end the element or open a comment. */
const inertJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c')

const SEAL_SOURCE = 'vendored-share-seal.mjs'
// The password-seal code of the shared dashboard (a vendored copy, kept equal by scripts/vendor-share.mjs), as plain script: no import or export, no whole-line comment.
const sealSource = () => readFileSync(here(SEAL_SOURCE), 'utf8').split('\n').filter((line) => /^import\s.*from\s+'[^']+'\s*$/u.test(line) === false).map((line) => line.replace(/^export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/u, '')).join('\n')

/** The script of the page, from journal-viewer.js with the seal code where it marks it; refuses text that would end or hide itself in HTML. */
export function viewerScript () {
  const text = readFileSync(here('journal-viewer.js'), 'utf8').replace(/^[ \t]*\/\/ @@SEAL@@[ \t]*$/mu, () => sealSource())
  const lines = []
  let inBlock = false
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (inBlock) { if (t.includes('*/')) inBlock = false; continue }
    if (t.startsWith('//')) continue
    if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; continue }
    lines.push(line)
  }
  const body = lines.join('\n')
  if (/<\/script|<!--/iu.test(body)) throw new Error('the page script holds text that would end or hide itself in HTML')
  if (/^(?:import|export)\b/mu.test(body)) throw new Error('the page script holds a line the page build does not handle')
  return body
}
export const viewerCss = () => readFileSync(here('journal-viewer.css'), 'utf8')

// What the lock screen of a protected link says. The document is not readable yet when it shows, so these words travel with the page itself, in both languages.
export const LOCK_LABELS = {
  en: { title: 'Protected journal', hint: 'Enter the password you were given. It opens this page in your browser; the server never sees it.', password: 'Password', open: 'Open', busy: 'Opening…', wrong: 'Wrong password, or this page was changed.', cannot: 'This protected page cannot be opened.', gone: 'This page could not be loaded', goneHint: 'The link may have been removed, or it has expired.', nope: 'This page cannot be shown.' },
  fr: { title: 'Journal protégé', hint: 'Entre le mot de passe reçu. Il ouvre cette page dans ton navigateur ; le serveur ne le voit jamais.', password: 'Mot de passe', open: 'Ouvrir', busy: 'Ouverture…', wrong: 'Mot de passe incorrect, ou la page a été modifiée.', cannot: 'Cette page protégée ne peut pas être ouverte.', gone: 'Cette page n’a pas pu être chargée', goneHint: 'Le lien a peut-être été supprimé, ou il a expiré.', nope: 'Cette page ne peut pas être affichée.' },
}

// One script, one style sheet, an empty root. `embedded`: the document is inside the page (a file: it opens offline and loads nothing). Otherwise the page is the one a server serves at a
// link, the same bytes for every link: it loads the document (or its password-sealed envelope) from the same site, and the policy allows that one fetch.
function buildPage ({ embedded, doc, docPath }) {
  const script = viewerScript()
  const css = viewerCss()
  const policy = ["default-src 'none'", 'script-src ' + sha(script), 'style-src ' + sha(css), 'img-src data:', 'connect-src ' + (embedded ? "'none'" : "'self'"), "base-uri 'none'", "form-action 'none'"].join('; ')
  const title = embedded && isObj(doc) && typeof doc.title === 'string' && doc.title !== '' ? doc.title : (embedded && isObj(doc) && isObj(doc.labels) && typeof doc.labels.pageTitle === 'string' ? doc.labels.pageTitle : 'Chat journal')
  const html = [
    '<!doctype html>',
    '<html lang="' + (embedded && isObj(doc) && doc.lang === 'fr' ? 'fr' : 'en') + '">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" content="' + escapeText(policy) + '">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    '<meta name="robots" content="noindex, nofollow">',
    '<meta name="color-scheme" content="light dark">',
    '<title>' + escapeText(title) + '</title>',
    '<style>' + css + '</style>',
    '</head>',
    '<body>',
    '<div id="kj-root"' + (!embedded && typeof docPath === 'string' ? ' data-doc="' + escapeText(docPath) + '"' : '') + '></div>',
    embedded ? '<script type="application/json" id="kj-doc">' + inertJson(doc) + '</script>' : '<script type="application/json" id="kj-lock">' + inertJson(LOCK_LABELS) + '</script>',
    '<script>' + script + '</script>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
  return { html: html, policy: policy }
}

/** The page of a Journal as one file: the document inside, nothing to load. The policy allows that script and that style (by hash), images that are data, and nothing else. */
export const journalPageHtml = (doc) => buildPage({ embedded: true, doc: doc })

/** The page a server serves at a link: no document inside, it loads `<this address>.json` (or `docPath`) and asks for the password when that is sealed. Returns { html, policy }. */
export const journalViewerHtml = ({ docPath } = {}) => buildPage({ embedded: false, docPath: docPath })

/** A readable file name for the page: `journal-<day>.html`, or with the chat's number when it is shared. */
export const pageFileName = (doc) => {
  const day = isObj(doc) && typeof doc.made === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(doc.made) ? doc.made : 'page'
  const id = isObj(doc) && isObj(doc.chat) && typeof doc.chat.id === 'string' ? doc.chat.id.replace(/^session-/u, '').replace(/[^A-Za-z0-9]/gu, '').slice(0, 8) : ''
  return 'journal-' + (id !== '' ? id + '-' : '') + day + '.html'
}
