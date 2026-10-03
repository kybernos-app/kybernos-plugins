// ═══════════════════════════════════════════════════════════════════════════
// surfaces — l'analyse « qu'est-ce que la nouvelle version du moteur a apporté
// qui casse nos retouches, ou qui reprend ce que nos plugins font ? »
//
// POURQUOI CE FICHIER EXISTE : le 22/09/2026, la montée 0.1.6 → 0.1.7 a cassé
// quatre contrats en silence (settings.get, AgentPreset.path, l'arité de
// sessionVisible/deriveFlat, des icônes renommées) et a livré en natif un
// épinglage de conversation qui doublonnait le nôtre et une dictée locale qui
// recouvre la nôtre. Personne ne le voyait : le doctor ne lisait que le disque
// (retouches posées / non posées), jamais les SURFACES du moteur.
//
// Ce que ce module mesure, sans rien écrire et sans lancer le moteur :
//   · ruptures  — une ancre que nos retouches ou nos plugins lisent a disparu
//                 (ou une forme qu'on croyait absente est apparue) ;
//   · doublons  — le moteur porte désormais nativement ce qu'une de nos
//                 retouches ajoute : les deux coexistent dans l'interface ;
//   · natifs    — une capacité native est livrée mais pas montée : disponible
//                 si l'utilisateur en veut.
//
// Il vit DANS le plugin (et pas dans scripts/) parce que la page Réglages le
// sert à chaud : le plugin doit se lire seul, sans import croisé. Le CLI
// scripts/native-surfaces.mjs l'importe, dans l'autre sens.
// ═══════════════════════════════════════════════════════════════════════════

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'

// ── les sondes : un motif à chercher dans un fichier du moteur ─────────────
// `attendu: 'present'` = notre code s'appuie sur cette forme ; si elle
// disparaît, la retouche ou le plugin tombe. `attendu: 'absent'` = on croit
// que le moteur ne fait pas ça (c'est ce qui justifie notre ajout) ; si ça
// apparaît, on est en doublon.
export const SONDES = [
  {
    id: 'queue-cas-hote',
    quoi: 'l\'hôte de session accepte edit / remove / steer',
    notre: 'retouche queue-move',
    ou: ['dsh-api-session-controller/lib/index.js'],
    motif: 'case "(edit|remove|steer)"',
    attendu: 'present'
  },
  {
    id: 'queue-move-absent',
    quoi: 'aucun déplacement de file natif (pas de case "move")',
    notre: 'retouche queue-move',
    ou: ['dsh-api-session-controller/lib/index.js'],
    motif: 'case "move"',
    attendu: 'absent'
  },
  {
    id: 'sessionVisible-4',
    quoi: 'sessionVisible(session, current, archived, archivedFilter)',
    notre: 'retouche workspace-pins',
    ou: ['dsh-client-ui-workspace/lib/client.js'],
    motif: 'function sessionVisible\\(session, current, archived, archivedFilter\\)',
    attendu: 'present'
  },
  {
    id: 'deriveFlat-4',
    quoi: 'deriveFlat(list, sessionIds, rowState, statuses)',
    notre: 'retouche workspace-pins',
    ou: ['dsh-client-ui-workspace/lib/client.js'],
    motif: 'function deriveFlat\\(list, sessionIds, rowState, statuses\\)',
    attendu: 'present'
  },
  {
    id: 'pin-natif',
    quoi: 'épinglage de conversation natif (siège + libellés)',
    notre: 'retouche workspace-pins — DOUBLON',
    ou: ['dsh-client-ui-workspace/lib/client.js'],
    motif: 'menu\\.pinSession',
    attendu: 'present'
  },
  {
    id: 'models-header-absent',
    quoi: 'aucun siège natif d\'en-tête sur la page Models',
    notre: 'retouche models-header',
    ou: ['dsh-client-ui-settings-models/lib/client.js'],
    motif: 'settings\\.models\\.header',
    attendu: 'absent'
  },
  {
    id: 'models-footer',
    quoi: 'siège natif footer de la page Models (repli possible)',
    notre: 'retouche models-header',
    ou: ['dsh-client-ui-settings-models/lib/client.js'],
    motif: 'settings\\.models\\.footer',
    attendu: 'present'
  },
  {
    id: 'model-search-absent',
    quoi: 'aucune recherche de modèle native dans le sélecteur',
    notre: 'retouche model-search',
    ou: ['dsh-client-ui-model-selection/lib/client.js'],
    motif: 'search\\.placeholder|Search models',
    attendu: 'absent'
  },
  {
    id: 'preset-sans-path',
    quoi: 'AgentPreset n\'a plus de champ path (notre dshHome ne peut plus s\'en servir)',
    notre: 'plugin kybernos (dshHome)',
    ou: ['dsh-agent-preset/lib/index.js'],
    motif: '\\bpath:',
    attendu: 'absent'
  },
  {
    id: 'settings-describe',
    quoi: 'le service settings s\'inspecte par describe()',
    notre: 'plugin kybernos-models',
    ou: ['dsh-settings/lib/index.js'],
    motif: 'describe',
    attendu: 'present'
  },
  {
    id: 'icones-16-disparues',
    quoi: 'les icônes …16 ont été renommées …Regular',
    notre: 'retouches model-search / queue-move',
    ou: ['dsh-client-ui-trajectory/lib/client.js', 'dsh-client-ui-workspace/lib/client.js'],
    motif: 'IconSearchOutline16|IconQueueOutline14',
    attendu: 'absent'
  }
]

// ── les capacités natives livrées, à comparer à nos propres fonctions ──────
// `paquet` : le paquet du moteur qui les porte. `verdict` dit quoi en faire.
export const NATIFS = [
  {
    id: 'voix',
    quoi: 'dictée locale (SenseVoice ONNX), bundle optionnel « Voice input »',
    notre: 'notre dictée maison (/kybernos/voice/* + /kybernos/tts/*)',
    paquet: 'dsh-experimental-voice-input-bundle',
    verdict: 'recoupement'
  },
  {
    id: 'config-editor',
    quoi: 'édition de la configuration des plugins (couture officielle)',
    notre: 'nos écritures de cordis.patch.yml à la main',
    paquet: 'dsh-config-editor',
    verdict: 'couture'
  },
  {
    id: 'preset-registry',
    quoi: 'registre d\'agent presets (sélection par session)',
    notre: 'notre ~/.dsh/kybers/.active/<session>',
    paquet: 'dsh-agent-preset-registry',
    verdict: 'recoupement'
  },
  {
    id: 'comptes',
    quoi: 'comptes et facturation (DeepSeek seulement)',
    notre: 'kybernos-cloud (multi-fournisseurs)',
    paquet: 'dsh-deepseek-account',
    verdict: 'partiel'
  },
  {
    id: 'skill-office',
    quoi: 'compétences Office (Word / PPT / Excel)',
    notre: 'kybernos-skills',
    paquet: 'dsh-skill-office',
    verdict: 'complementaire'
  }
]

const lire = (chemin) => { try { return readFileSync(chemin, 'utf8') } catch (e) { return null } }

// Où sont les paquets du moteur ? Trois formes circulent dans le dépôt :
//   · `npm root -g`                 → <racine>/@deepseek-ai/dsh/node_modules/@deepseek-ai
//   · le paquet @deepseek-ai/dsh    → <racine>/node_modules/@deepseek-ai  (racineGlobale du cycle de vie)
//   · un banc de test extrait       → <racine>/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
function baseDepuis (racine) {
  if (racine === null || racine === undefined || racine === '') return null
  const candidats = [
    join(racine, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'),
    join(racine, 'node_modules', '@deepseek-ai'),
    join(racine, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'),
    racine
  ]
  return candidats.find((p) => existsSync(p)) || null
}

// ── la mesure « absent » se fait sur la sauvegarde VIERGE ──────────────────
// Nos retouches AJOUTENT au moteur exactement ce que certaines sondes
// cherchent à prouver absent (`case "move"`, `settings.models.header`,
// `search.placeholder`). Mesurer sur le moteur vivant serait donc un faux
// positif permanent : chaque retouche posée crierait « le natif le fait
// maintenant ». On lit la sauvegarde `*.orig` que la retouche laisse à côté
// du fichier ; sans sauvegarde, on ne conclut pas — on le dit.
function lireVierge (cheminLive) {
  const dossier = dirname(cheminLive)
  const nom = basename(cheminLive)
  try {
    const voisin = readdirSync(dossier).find((f) => f.startsWith(nom + '.') && f.endsWith('.orig'))
    if (voisin !== undefined) return { texte: lire(join(dossier, voisin)), source: voisin }
  } catch (e) { /* dossier illisible */ }
  return { texte: null, source: null }
}

/**
 * Audite les surfaces du moteur installé contre nos retouches et nos plugins.
 * @param racineMoteur Racine du moteur installé (`npm root -g`) : les paquets
 *   sont sous `@deepseek-ai/dsh/node_modules/@deepseek-ai/`.
 * @param options.racineVierge Racine d'un moteur NU de référence (banc de
 *   test) : sert à conclure les sondes « absent » quand la retouche ne laisse
 *   pas de sauvegarde `*.orig`.
 * @returns { sondes, ruptures, aVerifier, doublons, natifs, mesure }
 */
export function auditerSurfaces (racineMoteur, options) {
  const base = baseDepuis(racineMoteur)
  const racineVierge = options?.racineVierge || null
  const baseVierge = baseDepuis(racineVierge)
  const sondes = []
  const ruptures = []
  const aVerifier = []
  if (base === null || !existsSync(base)) {
    return { sondes, ruptures: ['Le moteur installé est introuvable : audit des surfaces impossible.'], aVerifier, doublons: [], natifs: [], mesure: { base: base } }
  }
  for (const s of SONDES) {
    const motifs = []
    let trouve = false
    let lisible = false
    let surVierge = false
    let sourceVierge = null
    for (const rel of s.ou) {
      const live = join(base, rel)
      let texte = lire(live)
      if (texte === null) continue
      lisible = true
      if (s.attendu === 'absent') {
        const v = lireVierge(live)
        if (v.texte !== null) { texte = v.texte; surVierge = true; sourceVierge = v.source }
        else if (baseVierge !== null) {
          const nu = lire(join(baseVierge, rel))
          if (nu !== null) { texte = nu; surVierge = true; sourceVierge = 'banc nu ' + baseVierge }
        }
      }
      const m = texte.match(new RegExp(s.motif, 'g'))
      if (m !== null && m.length > 0) { trouve = true; motifs.push(...m.slice(0, 3)) }
    }
    // Un paquet absent n'est pas une rupture : il peut avoir été renommé, et
    // c'est justement ce que la sonde voisine doit dire. On ne crie que sur un
    // fichier lu où la forme attendue n'est plus là.
    const ok = s.attendu === 'present' ? trouve : !trouve
    const sur = s.attendu === 'present' ? 'live' : (surVierge ? 'vierge' : 'live')
    sondes.push({ id: s.id, quoi: s.quoi, notre: s.notre, attendu: s.attendu, trouve, lisible, ok, motifs, sur, sourceVierge })
    if (!ok && lisible) {
      if (s.attendu === 'present') {
        ruptures.push(`${s.notre} : « ${s.quoi} » n'est plus vrai dans le moteur installé (${s.ou[0]}).`)
      } else if (surVierge) {
        ruptures.push(`DOUBLON — ${s.notre} : le moteur porte désormais « ${s.quoi} » (mesuré sur la sauvegarde vierge ${sourceVierge}).`)
      } else {
        aVerifier.push(`${s.notre} : « ${s.quoi} » trouvé dans le moteur vivant, mais aucune sauvegarde vierge à côté — peut venir de notre propre retouche. À confirmer sur un 0.1.x nu.`)
      }
    }
  }
  const natifs = NATIFS.map((n) => ({ ...n, livre: existsSync(join(base, n.paquet)) }))
  const doublons = natifs.filter((n) => n.livre && (n.verdict === 'recoupement' || n.verdict === 'partiel'))
    .map((n) => `${n.notre} recoupe le natif « ${n.quoi} » (${n.paquet}).`)
  return { sondes, ruptures, aVerifier, doublons, natifs, mesure: { base } }
}
