// ═══════════════════════════════════════════════════════════════════════════
// surfaces — the analysis « what did the new engine version bring that breaks
// our patches, or that takes over what our plugins do? »
//
// WHY THIS FILE EXISTS: on 22/09/2026 the 0.1.6 → 0.1.7 upgrade broke four
// contracts in silence (settings.get, AgentPreset.path, the arity of
// sessionVisible/deriveFlat, renamed icons) and shipped a native conversation
// pin that duplicated ours and a local dictation that overlaps ours. Nobody
// saw it: the doctor only read the disk (patches applied / not applied), never
// the engine's SURFACES.
//
// What this module measures, without writing anything and without starting the engine:
//   · ruptures  — an anchor that our patches or plugins read is gone (or a form
//                 we believed absent has appeared);
//   · doublons  — the engine now carries natively what one of our patches
//                 adds: both coexist in the interface;
//   · natifs    — a native capability is shipped but not mounted: available if
//                 the user wants it.
//
// The sentences it returns are ENGLISH: the About page shows them as they are and
// translates them into French itself (packages/kybernos-maintenance/client.js).
//
// It lives IN the plugin (not in scripts/) because the About page serves it
// live: the plugin has to read on its own, with no cross import. The CLI
// scripts/dsh-lifecycle.mjs imports it, the other way round.
// ═══════════════════════════════════════════════════════════════════════════

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'

// ── the probes: a pattern to look for in a file of the engine ──────────────
// `attendu: 'present'` = our code relies on this form; if it disappears, the
// patch or the plugin falls. `attendu: 'absent'` = we believe the engine does
// not do this (that is what justifies our addition); if it shows up, we are
// duplicating it.
export const SONDES = [
  {
    id: 'queue-cas-hote',
    quoi: 'the session host accepts edit / remove / steer',
    notre: 'queue-move patch',
    ou: ['dsh-api-session-controller/lib/index.js'],
    motif: 'case "(edit|remove|steer)"',
    attendu: 'present'
  },
  {
    id: 'queue-move-absent',
    quoi: 'no native queue move (no "move" case)',
    notre: 'queue-move patch',
    ou: ['dsh-api-session-controller/lib/index.js'],
    motif: 'case "move"',
    attendu: 'absent'
  },
  {
    id: 'sessionVisible-4',
    quoi: 'sessionVisible(session, current, archived, archivedFilter)',
    notre: 'workspace-pins patch',
    ou: ['dsh-client-ui-workspace/lib/client.js'],
    motif: 'function sessionVisible\\(session, current, archived, archivedFilter\\)',
    attendu: 'present'
  },
  {
    id: 'deriveFlat-4',
    quoi: 'deriveFlat(list, sessionIds, rowState, statuses)',
    notre: 'workspace-pins patch',
    ou: ['dsh-client-ui-workspace/lib/client.js'],
    motif: 'function deriveFlat\\(list, sessionIds, rowState, statuses\\)',
    attendu: 'present'
  },
  {
    id: 'pin-natif',
    quoi: 'native conversation pinning (seat + labels)',
    notre: 'workspace-pins patch — OVERLAP',
    ou: ['dsh-client-ui-workspace/lib/client.js'],
    motif: 'menu\\.pinSession',
    attendu: 'present'
  },
  {
    id: 'models-header-absent',
    quoi: 'no native header seat on the Models page',
    notre: 'models-header patch',
    ou: ['dsh-client-ui-settings-models/lib/client.js'],
    motif: 'settings\\.models\\.header',
    attendu: 'absent'
  },
  {
    id: 'models-footer',
    quoi: 'native footer seat on the Models page (fallback possible)',
    notre: 'models-header patch',
    ou: ['dsh-client-ui-settings-models/lib/client.js'],
    motif: 'settings\\.models\\.footer',
    attendu: 'present'
  },
  {
    id: 'model-search-absent',
    quoi: 'no native model search in the picker',
    notre: 'model-search patch',
    ou: ['dsh-client-ui-model-selection/lib/client.js'],
    motif: 'search\\.placeholder|Search models',
    attendu: 'absent'
  },
  {
    id: 'preset-sans-path',
    quoi: 'AgentPreset no longer has a path field (our dshHome can no longer use it)',
    notre: 'kybernos plugin (dshHome)',
    ou: ['dsh-agent-preset/lib/index.js'],
    motif: '\\bpath:',
    attendu: 'absent'
  },
  {
    id: 'settings-describe',
    quoi: 'the settings service is inspected through describe()',
    notre: 'kybernos-models plugin',
    ou: ['dsh-settings/lib/index.js'],
    motif: 'describe',
    attendu: 'present'
  },
  {
    id: 'icones-16-disparues',
    quoi: 'the …16 icons were renamed …Regular',
    notre: 'model-search / queue-move patches',
    ou: ['dsh-client-ui-trajectory/lib/client.js', 'dsh-client-ui-workspace/lib/client.js'],
    motif: 'IconSearchOutline16|IconQueueOutline14',
    attendu: 'absent'
  }
]

// ── the native capabilities shipped, to compare with our own features ──────
// `paquet`: the engine package that carries them. `verdict` says what to do about it.
export const NATIFS = [
  {
    id: 'voix',
    quoi: 'local dictation (SenseVoice ONNX), optional “Voice input” bundle',
    notre: 'our own dictation (/kybernos/voice/* + /kybernos/tts/*)',
    paquet: 'dsh-experimental-voice-input-bundle',
    verdict: 'recoupement'
  },
  {
    id: 'config-editor',
    quoi: 'plugin configuration editing (official seam)',
    notre: 'our hand-written cordis.patch.yml writes',
    paquet: 'dsh-config-editor',
    verdict: 'couture'
  },
  {
    id: 'preset-registry',
    quoi: 'agent preset registry (per-session selection)',
    notre: 'our ~/.dsh/kybers/.active/<session>',
    paquet: 'dsh-agent-preset-registry',
    verdict: 'recoupement'
  },
  {
    id: 'comptes',
    quoi: 'accounts and billing (DeepSeek only)',
    notre: 'kybernos-cloud (multi-provider)',
    paquet: 'dsh-deepseek-account',
    verdict: 'partiel'
  },
  {
    id: 'skill-office',
    quoi: 'Office skills (Word / PPT / Excel)',
    notre: 'kybernos-skills',
    paquet: 'dsh-skill-office',
    verdict: 'complementaire'
  }
]

const lire = (chemin) => { try { return readFileSync(chemin, 'utf8') } catch (e) { return null } }

// Where are the engine's packages? Three shapes circulate in the repository:
//   · `npm root -g`                 → <root>/@deepseek-ai/dsh/node_modules/@deepseek-ai
//   · the @deepseek-ai/dsh package  → <root>/node_modules/@deepseek-ai  (the lifecycle's racineGlobale)
//   · an extracted test bench       → <root>/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
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

// ── the « absent » measure is taken on the CLEAN backup ────────────────────
// Our patches ADD to the engine exactly what some probes try to prove absent
// (`case "move"`, `settings.models.header`, `search.placeholder`). Measuring on
// the live engine would be a permanent false positive: every applied patch
// would cry « the native does it now ». We read the `*.orig` backup that the
// patch leaves next to the file; without a backup we do not conclude — and
// we say so.
function lireVierge (cheminLive) {
  const dossier = dirname(cheminLive)
  const nom = basename(cheminLive)
  try {
    const voisin = readdirSync(dossier).find((f) => f.startsWith(nom + '.') && f.endsWith('.orig'))
    if (voisin !== undefined) return { texte: lire(join(dossier, voisin)), source: voisin }
  } catch (e) { /* unreadable folder */ }
  return { texte: null, source: null }
}

/**
 * Audits the surfaces of the installed engine against our patches and plugins.
 * @param racineMoteur Root of the installed engine (`npm root -g`): the packages
 *   are under `@deepseek-ai/dsh/node_modules/@deepseek-ai/`.
 * @param options.racineVierge Root of a BARE reference engine (test bench):
 *   used to conclude the « absent » probes when the patch leaves no `*.orig`
 *   backup.
 * @returns { sondes, ruptures, aVerifier, doublons, natifs, mesure } — the sentences are English.
 */
export function auditerSurfaces (racineMoteur, options) {
  const base = baseDepuis(racineMoteur)
  const racineVierge = options?.racineVierge || null
  const baseVierge = baseDepuis(racineVierge)
  const sondes = []
  const ruptures = []
  const aVerifier = []
  if (base === null || !existsSync(base)) {
    return { sondes, ruptures: ['The installed engine cannot be found: the surface audit is not possible.'], aVerifier, doublons: [], natifs: [], mesure: { base: base } }
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
          if (nu !== null) { texte = nu; surVierge = true; sourceVierge = 'bare bench ' + baseVierge }
        }
      }
      const m = texte.match(new RegExp(s.motif, 'g'))
      if (m !== null && m.length > 0) { trouve = true; motifs.push(...m.slice(0, 3)) }
    }
    // An absent package is not a rupture: it may have been renamed, and that
    // is exactly what the neighbouring probe is there to say. We only cry on
    // a file that was read and where the expected form is no longer there.
    const ok = s.attendu === 'present' ? trouve : !trouve
    const sur = s.attendu === 'present' ? 'live' : (surVierge ? 'vierge' : 'live')
    sondes.push({ id: s.id, quoi: s.quoi, notre: s.notre, attendu: s.attendu, trouve, lisible, ok, motifs, sur, sourceVierge })
    if (!ok && lisible) {
      if (s.attendu === 'present') {
        ruptures.push(`${s.notre}: “${s.quoi}” is no longer true in the installed engine (${s.ou[0]}).`)
      } else if (surVierge) {
        const mesure = sourceVierge.startsWith('bare bench ') ? 'the ' + sourceVierge : 'the clean backup ' + sourceVierge
        ruptures.push(`OVERLAP — ${s.notre}: the engine now carries “${s.quoi}” (measured on ${mesure}).`)
      } else {
        aVerifier.push(`${s.notre}: “${s.quoi}” found in the live engine, but no clean backup beside it — it may come from our own patch. To be confirmed on a bare 0.1.x.`)
      }
    }
  }
  const natifs = NATIFS.map((n) => ({ ...n, livre: existsSync(join(base, n.paquet)) }))
  const doublons = natifs.filter((n) => n.livre && (n.verdict === 'recoupement' || n.verdict === 'partiel'))
    .map((n) => `${n.notre} overlaps the native “${n.quoi}” (${n.paquet}).`)
  return { sondes, ruptures, aVerifier, doublons, natifs, mesure: { base } }
}
