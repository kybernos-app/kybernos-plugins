/**
 * workflow-traducteur.mjs — le traducteur bidirectionnel des workflows kyber.
 *
 * Sens 1 (technique → clair) : DÉTERMINISTE. Les 5 formes sont finies, les
 * phrases sont calculées depuis la déclaration — jamais devinées, jamais un
 * LLM. C'est ce texte que l'utilisateur relit : il doit être exact.
 *
 * Sens 2 (clair → technique) n'est PAS ici : il vit dans l'onglet (un appel
 * LLM propose un kyber.yml), mais sa proposition est toujours re-passée par
 * `traduire()` de ce module et montrée côte à côte avant tout « Appliquer ».
 *
 * Format lu : le sous-ensemble `kyber.yml` du schéma kyber-topology —
 *   topology: pool | pipeline | adversarial | mapreduce | loop
 *   stages:
 *     - { id, roles: [...], inputs: [...], mode: once|forEach|untilConverged,
 *         maxRounds: N, adversarial: true }
 * Pur (aucune API Node ni DOM) : tourne en Node pour les tests et tel quel
 * dans la page pour l'onglet Workflow. Ne jamais importer ici.
 */

const FORMES = ['pool', 'pipeline', 'adversarial', 'mapreduce', 'loop']
const MODES = ['once', 'forEach', 'untilConverged']

/* ── Lecture du sous-ensemble YAML ─────────────────────────────────────────
   Tolérant : items en style bloc (`- id: x` + lignes indentées) ET en style
   débit (`- { id: x, roles: [a, b] }`). Commentaires et lignes vides ignorés.
   Rend { topology, stages: [{id, roles, inputs, mode, maxRounds, adversarial}] }. */
export function lireKyberYml(texte) {
  const lignes = String(texte).split('\n').map((l) => {
    const i = l.indexOf('#')
    return i >= 0 ? l.slice(0, i) : l
  })
  const racine = { stages: [], roles: [] }
  let section = null // 'stages' | 'roles' | autre | null
  let courant = null
  for (const brut of lignes) {
    const ligne = brut.replace(/\s+$/, '')
    const t = ligne.trim()
    if (t === '') continue
    if (!ligne.startsWith(' ') && !ligne.startsWith('-')) {
      // Clé de racine : les fichiers réels portent id, mission (multi-ligne),
      // memory, skills… — seul topology nous intéresse au premier chef.
      const m = t.match(/^([A-Za-z-]+)\s*:\s*(.*)$/)
      if (!m) { section = null; courant = null; continue }
      if (m[1] === 'topology') racine.topology = m[2].trim()
      section = m[2].trim() === '' ? m[1] : null
      courant = null
      continue
    }
    if (section === 'stages' && t.startsWith('- ')) {
      const suite = t.slice(2).trim()
      const nouvelle = suite.startsWith('{') || /^id\s*:/.test(suite)
      if (nouvelle === true) {
        courant = { roles: [], inputs: [], mode: 'once' }
        racine.stages.push(courant)
        if (suite.startsWith('{')) {
          Object.assign(courant, lireDebit(suite))
          courant = null
        } else {
          const m2 = suite.match(/^id\s*:\s*(.*)$/)
          if (m2) affecter(courant, 'id', m2[1])
        }
      }
      // sinon : item d'une liste imbriquée (definitionOfDone…) — ignoré
      continue
    }
    if (section === 'stages' && courant !== null) {
      const m3 = t.match(/^([A-Za-z-]+)\s*:\s*(.*)$/)
      if (m3) affecter(courant, m3[1], m3[2])
      continue
    }
    if (section === 'roles' && t.startsWith('- ')) {
      // Les rôles réels sont des objets (id, kind, needs, prompt) : on ne
      // collecte que leurs identifiants, pour la validation d'existence.
      const m4 = t.slice(2).trim().match(/^id\s*:\s*(.+)$/)
      if (m4) racine.roles.push(m4[1].trim())
      continue
    }
    // Tout le reste (corps de mission, prompts, DoD) : ignoré.
  }
  return racine
}

function affecter(stage, cle, val) {
  if (cle === 'id') stage.id = val
  else if (cle === 'roles') stage.roles = lireListe(val)
  else if (cle === 'inputs') stage.inputs = lireListe(val)
  else if (cle === 'mode') stage.mode = val
  else if (cle === 'maxRounds') stage.maxRounds = parseInt(val, 10)
  else if (cle === 'adversarial') stage.adversarial = val === 'true'
}

function lireListe(val) {
  if (val === '' || val === undefined || val === null) return []
  const corps = val.replace(/^\[/, '').replace(/\]$/, '').trim()
  if (corps === '') return []
  return corps.split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
}

function lireDebit(objet) {
  const corps = objet.replace(/^\{/, '').replace(/\}$/, '')
  const horsListes = []
  let profondeur = 0, tampon = ''
  for (const c of corps) {
    if (c === '[') profondeur += 1
    if (c === ']') profondeur -= 1
    if (c === ',' && profondeur === 0) { horsListes.push(tampon); tampon = '' } else tampon += c
  }
  if (tampon.trim() !== '') horsListes.push(tampon)
  const res = {}
  for (const morceau of horsListes) {
    const m = morceau.trim().match(/^([A-Za-z-]+)\s*:\s*(.*)$/)
    if (m) affecter(res, m[1].trim(), m[2].trim())
  }
  return res
}

/* ── Validation : les règles du schéma, rendues en erreurs lisibles ──────── */
export function valider(topo) {
  const erreurs = [], avertissements = []
  const stages = (topo && topo.stages) || []
  if (!topo || FORMES.indexOf(topo.topology) < 0) {
    erreurs.push('forme inconnue « ' + ((topo && topo.topology) || 'rien') + ' » — attendu : ' + FORMES.join(', '))
  }
  const vus = {}
  for (const st of stages) {
    if (!st.id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(st.id)) erreurs.push('étape sans identifiant kebab-case : ' + JSON.stringify(st.id || ''))
    else if (vus[st.id]) erreurs.push('identifiant en double : ' + st.id)
    vus[st.id] = true
    if (MODES.indexOf(st.mode) < 0) erreurs.push('« ' + st.id + ' » : mode inconnu « ' + st.mode + ' »')
    if (st.mode === 'untilConverged' && !(st.maxRounds >= 1)) erreurs.push('« ' + st.id + ' » : mode untilConverged exige maxRounds ≥ 1')
    if (!st.roles || st.roles.length === 0) erreurs.push('« ' + st.id + ' » : au moins un rôle requis')
    if (topo.roles && topo.roles.length > 0) {
      for (const r of st.roles || []) {
        if (topo.roles.indexOf(r) < 0) erreurs.push('« ' + st.id + ' » : rôle « ' + r + ' » absent des rôles du kyber')
      }
    }
    for (const entree of st.inputs || []) {
      if (entree === st.id) erreurs.push('« ' + st.id + ' » ne peut pas se lire lui-même en entrée')
      else if (!stages.some((s) => s.id === entree)) erreurs.push('« ' + st.id + ' » attend « ' + entree + ' », qui n\'existe pas')
    }
    if (st.adversarial === true) {
      const cible = (st.inputs || [])[0]
      if (!cible) erreurs.push('« ' + st.id + ' » est une réfutation : il faut une étape cible en entrée')
      else {
        const iCible = stages.map((s) => s.id).lastIndexOf(cible)
        const iMoins = stages.indexOf(st)
        if (iCible > iMoins) erreurs.push('« ' + st.id + ' » réfute « ' + cible + ' » mais vient AVANT elle — une réfutation suit toujours sa cible')
      }
    }
    if (st.mode === 'forEach' && (st.roles || []).length > 1) {
      avertissements.push('« ' + st.id + ' » : forEach avec ' + st.roles.length + ' rôles = ' + st.roles.length + ' agents PAR élément')
    }
  }
  if (topo.topology === 'loop' && !stages.some((s) => s.mode === 'untilConverged')) {
    erreurs.push('forme loop : au moins une étape en mode untilConverged (avec maxRounds)')
  }
  return { erreurs, avertissements }
}

/* ── Sens 1 : la table de phrases — calculée, jamais devinée ─────────────── */
const PHRASE_FORME = {
  pool: 'Tous travaillent en même temps sur le même besoin, sans ordre imposé — on garde ce qui revient.',
  pipeline: 'Chaque étape passe le relais à la suivante : l\'ordre est le chemin.',
  adversarial: 'Une étape produit, une autre cherche à la détruire ; une dernière tranche entre les deux.',
  mapreduce: 'On découpe en unités, un travailleur par unité, puis tout est fusionné.',
  loop: 'On recommence jusqu\'à ce que le contrôle valide — c\'est lui qui décide de s\'arrêter, pas le producteur.',
}
const PHRASE_MODE = {
  once: 'une fois',
  forEach: 'un agent PAR élément reçu',
  untilConverged: 'recommencé jusqu\'à validation, {max} tours au plus',
}

export function traduire(topo) {
  const lignes = ['Forme « ' + topo.topology + ' » : ' + (PHRASE_FORME[topo.topology] || '')]
  for (const st of topo.stages || []) {
    let phrase = '« ' + st.id + ' » — ' + (st.roles || []).join(', ')
    if ((st.inputs || []).length > 0) phrase += ' ; reçoit : ' + st.inputs.join(', ')
    if (st.adversarial === true && (st.inputs || [])[0]) {
      phrase = '« ' + st.id + ' » reçoit ce que « ' + st.inputs[0] + ' » a produit et cherche à le détruire — jamais en parallèle de lui'
    }
    let mode = PHRASE_MODE[st.mode] || st.mode
    if (st.mode === 'untilConverged') mode = mode.replace('{max}', String(st.maxRounds || '?'))
    phrase += ' (' + mode + ')'
    lignes.push(phrase)
  }
  return lignes.join('\n')
}

/* Carte d'une seule étape — ce que le clic sur un nœud ReactFlow affiche. */
export function traduireEtape(topo, id) {
  const st = (topo.stages || []).find((s) => s.id === id)
  if (!st) return null
  return traduire({ topology: topo.topology, stages: [st], roles: topo.roles })
}

/* ── Nœuds/edges ReactFlow : layout en couches (plus long chemin) ────────── */
export function versGraphe(topo) {
  const stages = topo.stages || []
  // Colonne = PROFONDEUR de flux (plus long chemin d'entrées) repliée modulo 4 :
  // la sémantique gauche→droite du contrat est gardée, et une chaîne linéaire
  // longue ne s'étale plus en ligne (fitView dézoomerait sous la lisibilité) —
  // chaque colonne empile ses nœuds verticalement, look Crew v2.
  const prof = {}
  const profondeur = (id, vu) => {
    if (prof[id] !== undefined) return prof[id]
    if (vu.indexOf(id) >= 0) return 0
    const st = stages.find((s) => s.id === id)
    const entrees = (st && st.inputs) || []
    const d = entrees.length === 0 ? 0 : 1 + Math.max(...entrees.map((e) => profondeur(e, vu.concat(id))))
    prof[id] = d
    return d
  }
  for (const st of stages) profondeur(st.id, [])
  const MAX_COLONNES = 4
  const rang = {}
  const noeuds = stages.map((st) => {
    const d = prof[st.id]
    const k = d % MAX_COLONNES
    rang[k] = (rang[k] === undefined) ? 0 : rang[k] + 1
    return {
      id: st.id,
      type: 'kbWf',
      data: { label: st.id, roles: st.roles || [], mode: st.mode, adversarial: st.adversarial === true, maxRounds: st.maxRounds },
      position: { x: k * 260, y: rang[k] * 130 },
    }
  })
  const aretes = []
  for (const st of stages) {
    for (const entree of st.inputs || []) aretes.push({ id: entree + '->' + st.id, source: entree, target: st.id, animated: st.adversarial === true })
  }
  return { noeuds, aretes }
}
