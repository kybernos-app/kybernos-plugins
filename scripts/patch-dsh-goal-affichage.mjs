// ── Affichage du Goal : la carte « Continuing goal » et la barre « Ongoing Goal »
//
// Deux surfaces vivent dans les paquets DSH installés, sans aucune couture de
// plugin — une mise à jour de DSH les réécrit sans rien dire :
//
//   1. la carte du fil `TurnTriggerNodeView`
//      (`@deepseek-ai/dsh-client-ui-chat/lib/client.js`) montrait le corps BRUT
//      de la notification : les balises `<goal_round>`, l'objectif entre
//      guillemets, « Round: 7/14 » et six lignes d'instructions anglaises, le
//      tout dans un `<pre>` de 240 px ;
//   2. la barre `GoalBar`
//      (`@deepseek-ai/dsh-client-ui-goal/lib/client.js`) coupait l'objectif à
//      une ligne (`text-overflow:ellipsis` sur un `height:36px` figé).
//
// Ce script repose les deux corrections de façon IDEMPOTENTE : chaque règle
// cherche une ancre (expression régulière tolérante aux espaces) et refuse
// d'écrire si elle ne la trouve pas exactement une fois — une mise à jour de DSH
// doit donner un rouge, jamais un patch appliqué au mauvais endroit.
//
// Usage :
//   node scripts/patch-dsh-goal-affichage.mjs                 # applique
//   node scripts/patch-dsh-goal-affichage.mjs --check         # vérifie, n'écrit rien
//   node scripts/patch-dsh-goal-affichage.mjs --revert        # retire
//   node scripts/patch-dsh-goal-affichage.mjs --dsh <racine>  # une autre installation
//
// Après une pose : recharger la page de la GUI (bundles clients). Sortie :
// 0 = conforme après l'opération, 1 = écart (--check) ou échec.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { racineDeclaree, resoudreCopie, refuserRacine, versionDuMoteur } from './racine-dsh.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const CHECK = args.indexOf('--check') >= 0
const REVERT = args.indexOf('--revert') >= 0
const BACKUP_SUFFIX = '.kybernos-goal.orig'

const racine = racineDeclaree(args)
const cibles = []
for (const pkg of ['@deepseek-ai/dsh-client-ui-chat', '@deepseek-ai/dsh-client-ui-goal']) {
  const resolution = resoudreCopie(racine, pkg)
  if (resolution.copie === null) refuserRacine(resolution.motif, 'patch-dsh-goal-affichage.mjs (' + pkg + ')')
  const fichier = join(resolution.copie, 'lib', 'client.js')
  if (existsSync(fichier) !== true) {
    console.error('✗ patch-dsh-goal-affichage.mjs : ' + fichier + ' est absent — paquet vide ou arbre non installe')
    process.exit(1)
  }
  cibles.push({ pkg, fichier, version: versionDuMoteur(resolution.moteur) })
}

// ── Le CSS de la carte (injecté dans la chaîne CSS du module) ────────────────
const CSS_CARTE = [
  '.oz9t_a_kbGoal{display:flex;flex-direction:column;gap:8px;min-width:0}',
  '.oz9t_a_kbObjWrap{display:flex;flex-direction:column;gap:2px;min-width:0}',
  '.oz9t_a_kbObjLabel{color:var(--dsw-alias-label-caption);font:var(--dsw-font-xxs-12);text-transform:uppercase;letter-spacing:.04em}',
  '.oz9t_a_kbObj{color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);line-height:19px;overflow-wrap:anywhere}',
  '.oz9t_a_kbMeta{display:flex;align-items:center;gap:8px;min-width:0}',
  '.oz9t_a_kbChip{flex:none;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;font:var(--dsw-font-xxs-12);line-height:16px;padding:1px 8px}',
  '.oz9t_a_kbBar{flex:1;min-width:40px;height:4px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);overflow:hidden}',
  '.oz9t_a_kbFill{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary)}',
  '.oz9t_a_kbDetails{border-top:.5px solid var(--dsw-alias-border-l1);padding-top:6px;min-width:0}',
  '.oz9t_a_kbSummary{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);cursor:pointer}',
  '.oz9t_a_kbRaw{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);margin:6px 0 0}',
].join('')

// ── Le parseur et le composant, insérés avant le composant natif ─────────────
const BLOC_CARTE = `		/**
		* kybernos — lire une notification de tour de Goal comme une carte.
		* Rends null dès que le corps n'est pas un \`<goal_round>\` lisible : le
		* rendu natif reprend alors la main, rien n'est perdu en silence.
		*/
		function kyberGoalParts(content) {
			if (Array.isArray(content) === false) return null;
			if (unknownBlocks(content).length > 0) return null;
			let brut = "";
			for (const run of contentRuns(content)) if ("text" in run) brut += run.text;
			if (brut.indexOf("<goal_round") < 0) return null;
			const corps = brut.replace(/<\\/?goal_round[^>]*>/g, "").replace(/\\r/g, "");
			let objectif = null;
			let tour = null;
			const reste = [];
			for (const ligne of corps.split("\\n")) {
				const l = ligne.trim();
				if (objectif === null && /^Objective\\s*:/.test(l)) {
					objectif = l.replace(/^Objective\\s*:\\s*/, "").replace(/^"/, "").replace(/"$/, "").trim();
					continue;
				}
				if (tour === null) {
					const m = l.match(/^Round\\s*:\\s*(\\d+)\\s*\\/\\s*(\\d+)/);
					if (m !== null) {
						tour = {
							fait: Number(m[1]),
							total: Number(m[2])
						};
						continue;
					}
				}
				reste.push(ligne);
			}
			if (objectif === null && tour === null) return null;
			return {
				objectif: objectif,
				tour: tour,
				reste: reste.join("\\n").trim()
			};
		}
		/** La carte d'un tour de Goal : objectif, compteur de tours, instructions repliées. */
		function KyberGoalRoundBody({ parts, t }) {
			const pourcent = parts.tour === null ? 0 : Math.max(0, Math.min(100, Math.round(parts.tour.fait / Math.max(1, parts.tour.total) * 100)));
			const libelleTour = parts.tour === null ? "" : t("message.trigger.goal.round", {
				round: parts.tour.fait,
				total: parts.tour.total
			});
			return (0, react_jsx_runtime.jsxs)("div", {
				className: TurnTriggerNodeView_module_css_default.kbGoal,
				"data-kb-goal": true,
				children: [
					parts.objectif === null ? null : (0, react_jsx_runtime.jsxs)("div", {
						className: TurnTriggerNodeView_module_css_default.kbObjWrap,
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: TurnTriggerNodeView_module_css_default.kbObjLabel,
							children: t("message.trigger.goal.objective")
						}), (0, react_jsx_runtime.jsx)("div", {
							className: TurnTriggerNodeView_module_css_default.kbObj,
							children: parts.objectif
						})]
					}),
					parts.tour === null ? null : (0, react_jsx_runtime.jsxs)("div", {
						className: TurnTriggerNodeView_module_css_default.kbMeta,
						"data-kb-round": true,
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: TurnTriggerNodeView_module_css_default.kbChip,
							children: libelleTour
						}), (0, react_jsx_runtime.jsx)("span", {
							className: TurnTriggerNodeView_module_css_default.kbBar,
							"aria-hidden": true,
							children: (0, react_jsx_runtime.jsx)("span", {
								className: TurnTriggerNodeView_module_css_default.kbFill,
								style: { width: String(pourcent) + "%" }
							})
						})]
					}),
					parts.reste === "" ? null : (0, react_jsx_runtime.jsxs)("details", {
						className: TurnTriggerNodeView_module_css_default.kbDetails,
						children: [(0, react_jsx_runtime.jsx)("summary", {
							className: TurnTriggerNodeView_module_css_default.kbSummary,
							children: t("message.trigger.goal.details")
						}), (0, react_jsx_runtime.jsx)("div", {
							className: TurnTriggerNodeView_module_css_default.kbRaw,
							children: parts.reste
						})]
					})
				]
			});
		}
`

const LOCALES_ZH = `			"message.trigger.goal.objective": "目标",
			"message.trigger.goal.round": "第 {round} 轮 / 共 {total} 轮",
			"message.trigger.goal.details": "发送给代理的说明",
`
const LOCALES_EN = `			"message.trigger.goal.objective": "Objective",
			"message.trigger.goal.round": "Round {round} of {total}",
			"message.trigger.goal.details": "Instructions sent to the agent",
`

// ── Les règles ──────────────────────────────────────────────────────────────
// `ancre` : motif unique, avec une capture du point d'insertion. `marque` : ce
// qui, présent, veut dire « déjà posée ».
const REGLES = [
  {
    id: 'carte — CSS du tour de Goal',
    pkg: '@deepseek-ai/dsh-client-ui-chat',
    marque: '.oz9t_a_kbGoal{',
    ancre: /(@media \(prefers-reduced-motion:reduce\)\{\.oz9t_a_root(?:,\.oz9t_a_header)?\{transition:none\}\})";/,
    poser: (m) => CSS_CARTE + m[1] + '";',
  },
  {
    id: 'carte — classes du tour de Goal',
    pkg: '@deepseek-ai/dsh-client-ui-chat',
    marque: '"kbGoal": "oz9t_a_kbGoal",',
    ancre: /("title": "oz9t_a_title"\n\t\t\};)/,
    poser: (m) => '"kbObj": "oz9t_a_kbObj",\n\t\t\t"kbObjLabel": "oz9t_a_kbObjLabel",\n\t\t\t"kbObjWrap": "oz9t_a_kbObjWrap",\n\t\t\t"kbGoal": "oz9t_a_kbGoal",\n\t\t\t"kbMeta": "oz9t_a_kbMeta",\n\t\t\t"kbChip": "oz9t_a_kbChip",\n\t\t\t"kbBar": "oz9t_a_kbBar",\n\t\t\t"kbFill": "oz9t_a_kbFill",\n\t\t\t"kbDetails": "oz9t_a_kbDetails",\n\t\t\t"kbSummary": "oz9t_a_kbSummary",\n\t\t\t"kbRaw": "oz9t_a_kbRaw",\n\t\t\t' + m[1],
  },
  {
    id: 'carte — parseur et composant',
    pkg: '@deepseek-ai/dsh-client-ui-chat',
    marque: 'function kyberGoalParts(',
    ancre: /(\t\t\/\/#region lib\/types\/client\/chat\/TurnTriggerNodeView\.js\n)/,
    poser: (m) => BLOC_CARTE + m[1],
  },
  {
    id: 'carte — lecture du corps de notification',
    pkg: '@deepseek-ai/dsh-client-ui-chat',
    marque: 'const kyberParts = details.icon === "goal"',
    ancre: /(\t\t\tconst details = turnTriggerDetails\(node\.data\);\n\t\t\tconst TriggerIcon = TRIGGER_ICONS\[details\.icon\];\n)/,
    poser: (m) => m[1] + '\t\t\tconst kyberParts = details.icon === "goal" ? kyberGoalParts(node.data.content) : null;\n',
  },
  {
    id: 'carte — compteur de tours dans l en-tête',
    pkg: '@deepseek-ai/dsh-client-ui-chat',
    marque: '"data-kb-round-chip": true',
    ancre: /(\t\t\t\t\t\tclassName: TurnTriggerNodeView_module_css_default\.title,\n\t\t\t\t\t\t\tchildren: t\(details\.title\)\n\t\t\t\t\t\t\}\),\n)/,
    poser: (m) => m[1] + '\t\t\t\t\t\tkyberParts === null || kyberParts.tour === null ? null : (0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\tclassName: TurnTriggerNodeView_module_css_default.kbChip,\n\t\t\t\t\t\t\t"data-kb-round-chip": true,\n\t\t\t\t\t\t\tchildren: String(kyberParts.tour.fait) + "/" + String(kyberParts.tour.total)\n\t\t\t\t\t\t}),\n',
  },
  {
    id: 'carte — corps du tour de Goal',
    pkg: '@deepseek-ai/dsh-client-ui-chat',
    marque: 'kyberParts === null ?',
    ancre: /(\t\t\t\t\t\}\)\, \(0, react_jsx_runtime\.jsx\)\("div", \{\n\t\t\t\t\t\tclassName: TurnTriggerNodeView_module_css_default\.content,\n\t\t\t\t\t\tchildren: \(0, react_jsx_runtime\.jsx\)\(NoticeBody, \{\n\t\t\t\t\t\t\tcontent: node\.data\.content,\n\t\t\t\t\t\t\tsource: node\.data\.source,\n\t\t\t\t\t\t\tt\n\t\t\t\t\t\t\}\)\n\t\t\t\t\t\}\))/,
    poser: () => '\t\t\t\t\t}), kyberParts === null ? (0, react_jsx_runtime.jsx)("div", {\n\t\t\t\t\t\tclassName: TurnTriggerNodeView_module_css_default.content,\n\t\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)(NoticeBody, {\n\t\t\t\t\t\t\tcontent: node.data.content,\n\t\t\t\t\t\t\tsource: node.data.source,\n\t\t\t\t\t\t\tt\n\t\t\t\t\t\t})\n\t\t\t\t\t}) : (0, react_jsx_runtime.jsx)(KyberGoalRoundBody, {\n\t\t\t\t\t\tparts: kyberParts,\n\t\t\t\t\t\tt\n\t\t\t\t\t})',
  },
  {
    id: 'carte — libellés zh',
    pkg: '@deepseek-ai/dsh-client-ui-chat',
    marque: '"message.trigger.goal.objective": "目标"',
    ancre: /(\t\t\t"message\.trigger\.explanation": "这条通知触发了本轮回复。",\n)/,
    poser: (m) => m[1] + LOCALES_ZH,
  },
  {
    id: 'carte — libellés en',
    pkg: '@deepseek-ai/dsh-client-ui-chat',
    marque: '"message.trigger.goal.objective": "Objective"',
    ancre: /(\t\t\t"message\.trigger\.explanation": "This notification triggered this response\.",\n)/,
    poser: (m) => m[1] + LOCALES_EN,
  },
  {
    id: 'barre — objectif sur deux lignes (CSS)',
    pkg: '@deepseek-ai/dsh-client-ui-goal',
    marque: '-webkit-line-clamp:2',
    // RETIRÉE le 26/09/2026 : migrée en CSS plugin (kybernos-plugin/client.js,
    // `kbGoalBarCss` — surcharge <style> découverte au runtime, survit aux mises
    // à jour de DSH sans re-patch). La règle reste déclarée pour que `--revert`
    // sache retirer une pose ancienne, mais ne se pose plus jamais.
    ancre: /(\.$)/,
    poser: (m) => m[1],
    plusPosee: true,
  },
  {
    id: 'barre — hauteur libre (CSS)',
    pkg: '@deepseek-ai/dsh-client-ui-goal',
    marque: 'min-height:36px;height:auto;',
    ancre: /(--dsw-elevation-stroke-color:var\(--dsw-alias-border-l1\);)((?:[^;}]*;)*?)(height:36px;)(box-shadow:var\(--dsw-elevation-panel\);)/,
    poser: (m) => m[1] + m[2] + 'min-height:36px;height:auto;' + m[4],
    plusPosee: true,
  },
]

let ko = 0
const resultats = []

for (const cible of cibles) {
  let texte = readFileSync(cible.fichier, 'utf8')
  const original = texte
  const miennes = REGLES.filter((r) => r.pkg === cible.pkg)
  // Ce qui était DÉJÀ posé avant toute application en mémoire : c'est ce que
  // `--check` doit mesurer (l'état du disque), pas l'état simulé.
  const dejaPosees = miennes.filter((r) => r.plusPosee !== true && original.indexOf(r.marque) >= 0).length
  const poseables = miennes.filter((r) => r.plusPosee !== true).length
  for (const regle of miennes) {
    const dejaPose = texte.indexOf(regle.marque) >= 0
    if (REVERT !== true && regle.plusPosee === true) {
      resultats.push('  · ' + regle.id + (dejaPose ? ' (encore posée — retirer avec --revert puis relancer)' : ' (retirée — migrée en CSS plugin)'))
      continue
    }
    const m = regle.ancre.exec(texte)
    const trouvees = m === null ? 0 : texte.split(m[0]).length - 1
    if (REVERT === true) {
      if (dejaPose === false) { resultats.push('  · ' + regle.id + ' (déjà absent)'); continue }
      // Retrait : on restaure la sauvegarde en bloc, règle par règle impossible
      // sur un bundle minifié. Le retrait est donc traité après la boucle.
      continue
    }
    if (dejaPose === true) { resultats.push('  · ' + regle.id + ' (déjà posée)'); continue }
    if (m === null) { resultats.push('  ✗ ' + regle.id + ' — ancre introuvable (DSH mis à jour ?)'); ko += 1; continue }
    if (trouvees !== 1) { resultats.push('  ✗ ' + regle.id + ' — ancre ambiguë (' + String(trouvees) + ')'); ko += 1; continue }
    const remplacement = regle.poser(m)
    if (remplacement === m[0] || remplacement.indexOf(regle.marque) < 0) {
      resultats.push('  ✗ ' + regle.id + ' — pose sans marque (« ' + regle.marque + ' » absente du remplacement)')
      ko += 1
      continue
    }
    texte = texte.replace(m[0], remplacement)
    resultats.push('  + ' + regle.id)
  }

  console.log('patch affichage du Goal — ' + cible.pkg + (cible.version === null ? '' : ' (DSH ' + cible.version + ')'))
  console.log('  bundle ' + cible.fichier)
  console.log(resultats.splice(0).join('\n'))

  if (CHECK === true) {
    if (ko > 0) { console.error('✗ patch incomplet : une ancre ne tombe plus (DSH mis à jour ?)'); process.exit(1) }
    if (dejaPosees !== poseables) {
      console.error('✗ patch absent (' + String(dejaPosees) + '/' + String(poseables) + ' règles posées)')
      process.exit(1)
    }
    continue
  }
  if (ko > 0) { console.error('✗ aucune écriture : une ancre a disparu'); process.exit(1) }

  if (REVERT === true) {
    if (existsSync(cible.fichier + BACKUP_SUFFIX) === false) { console.log('  · rien à retirer (pas de sauvegarde)'); continue }
    writeFileSync(cible.fichier, readFileSync(cible.fichier + BACKUP_SUFFIX, 'utf8'), 'utf8')
    console.log('✓ patch retiré — restauré depuis ' + BACKUP_SUFFIX)
    continue
  }

  if (texte === original) {
    console.log('✓ patch déjà conforme')
    continue
  }
  if (existsSync(cible.fichier + BACKUP_SUFFIX) === false) {
    copyFileSync(cible.fichier, cible.fichier + BACKUP_SUFFIX)
    console.log('  sauvegarde : ' + cible.fichier + BACKUP_SUFFIX)
  }
  writeFileSync(cible.fichier, texte, 'utf8')
  // Verdict de syntaxe en mode module : `node --check` seul est un faux vert
  // (mesuré le 23/09/2026 sur Node 26.7.0).
  const syntaxe = spawnSync('node', ['--input-type=module', '--check', '-'], { input: texte, encoding: 'utf8' })
  if (syntaxe.status !== 0) {
    writeFileSync(cible.fichier, original, 'utf8')
    console.error('✗ syntaxe invalide après écriture — fichier restauré')
    console.error(String(syntaxe.stderr || '').split('\n').slice(0, 6).join('\n'))
    process.exit(1)
  }
  console.log('✓ patch appliqué et syntaxe validée')
}
if (CHECK === true) console.log('✓ patch conforme')
process.exit(0)
