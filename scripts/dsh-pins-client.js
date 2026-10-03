/* kybernos:pins:begin */
/* ── Épingles de la sidebar (kybernos:pins) ──────────────────────────────────
 * La section « Pinned » se rend au-dessus de la liste des Workspaces.
 * Source de vérité : l'hôte (`GET/POST /kybernos/pins`, fichier
 * `~/.dsh/.kyber-pins.json`). Tant que l'hôte n'a pas chargé cette route (DSH
 * démarré avant le patch, plugin désactivé), les bascules vivent dans un miroir
 * localStorage : la fonctionnalité reste utilisable, et le miroir est adopté par
 * l'hôte dès qu'il répond vide (premier démarrage du plugin avec le patch). Dès
 * que l'hôte répond, c'est lui qui tranche et le miroir n'est qu'une copie.
 * Un identifiant qui ne résout plus (session archivée, workspace supprimé) est
 * omis du rendu sans être retiré du fichier : une restauration le fait revivre.
 */
const KYBER_PINS_URL = "/kybernos/pins";
const KYBER_PINS_MIRROR = "dsh.kyber.pins.v1";
// Préférences de NAVIGATEUR (repli de la section, repli des dossiers) : elles
// ne concernent pas l'état partagé et survivent au rechargement.
const KYBER_PINS_UI = "dsh.kyber.pins.v1.ui";
const KYBER_PINS_FIELDS = { workspace: "workspaces", session: "sessions" };
const KYBER_PINS_CSS_TAG = "@local/kybernos/Pins.module.css";
const KYBER_PINS_CSS = ".kbpin_section{display:flex;flex-direction:column;margin-bottom:6px;padding-bottom:6px;border-bottom:0.5px solid var(--dsw-alias-border-l2)}.kbpin_section[data-kbpin-collapsed=true] .kbpin_rows{display:none}.kbpin_header{box-sizing:border-box;display:flex;align-items:center;gap:4px;width:100%;height:28px;padding:0 8px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:6px;cursor:pointer;text-align:left;font-size:13px;line-height:20px;font-family:inherit}.kbpin_header:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}.kbpin_chevron{display:flex;flex:0 0 auto;align-items:center;transition:transform .12s ease}.kbpin_chevron[data-kbpin-replie=true]{transform:rotate(-90deg)}.kbpin_label{flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.kbpin_rows{display:flex;flex-direction:column}.kbpin_rows>*+*{margin-top:2px}.kbpin_group{display:flex;flex-direction:column}.kbpin_group+.kbpin_group{margin-top:4px}.kbpin_rows>.kbpin_group+*{margin-top:6px}.kbpin_threads{display:flex;flex-direction:column}.kbpin_threads>*+*{margin-top:2px}.kbpin_more{width:100%;height:28px;padding:0 12px 0 28px;cursor:pointer;text-align:left;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:8px;font-size:12px;font-family:inherit}.kbpin_more:hover{color:var(--dsw-alias-label-secondary)}.kbpin_row{position:relative;display:flex;flex-direction:column;border-radius:8px}.kbpin_row[data-kbpin-drag=true]{opacity:.45}.kbpin_row[data-kbpin-marker=before]::before,.kbpin_row[data-kbpin-marker=after]::after{content:\"\";position:absolute;left:8px;right:8px;height:2px;border-radius:1px;background:var(--dsw-alias-brand-primary,rgba(80,140,255,.9))}.kbpin_row[data-kbpin-marker=before]::before{top:-1px}.kbpin_row[data-kbpin-marker=after]::after{bottom:-1px}";
/** Repose la feuille dans <head> si elle a disparu.
 *  Un rechargement du bundle peut la retirer pendant que le module — resté en
 *  cache ESM — n'est PAS rejoué : l'injection du haut de bloc ne repassait alors
 *  pas, et la section retombait sur le bouton NATIF du navigateur (chevron collé
 *  au libellé, pastille grise qui ne fait pas la largeur, texte blanc) —
 *  constaté dans la revue vidéo du 23/09/2026. On la repose au montage, et le
 *  composant rend EN PLUS un <style> dans l'arbre : tant que la section se
 *  dessine, elle a ses règles. */
const kyberPinsEnsureCss = () => {
	if (typeof document === "undefined") return;
	if (document.querySelector("style[data-plugin-css=" + JSON.stringify(KYBER_PINS_CSS_TAG) + "]") !== null) return;
	const tag = document.createElement("style");
	tag.dataset.plugin = "@local/kybernos";
	tag.dataset.pluginCss = KYBER_PINS_CSS_TAG;
	tag.textContent = KYBER_PINS_CSS;
	document.head.appendChild(tag);
};
kyberPinsEnsureCss();
/** Un seul état pour toutes les rangées ; `host` dit si l'hôte fait autorité. */
const kyberPinsState = { loaded: false, host: false, error: null, workspaces: [], sessions: [] };
const kyberPinsListeners = new Set();
const kyberPinsEmit = () => {
	for (const listener of [...kyberPinsListeners]) {
		try { listener(); } catch (e) { /* un abonné fautif n'empêche pas les autres de se rafraîchir */ }
	}
};
const kyberPinsIds = (value) => Array.isArray(value) ? value.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 160) : [];
/** Miroir local : il ne sert que quand l'hôte est muet, et l'hôte le remplace. */
const kyberPinsMirrorRead = () => {
	try {
		const raw = localStorage.getItem(KYBER_PINS_MIRROR);
		if (raw === null) return { workspaces: [], sessions: [] };
		const parsed = JSON.parse(raw);
		if (parsed === null || typeof parsed !== "object") return { workspaces: [], sessions: [] };
		return { workspaces: kyberPinsIds(parsed.workspaces), sessions: kyberPinsIds(parsed.sessions) };
	} catch (e) { return { workspaces: [], sessions: [] }; }
};
const kyberPinsMirrorWrite = () => {
	try {
		localStorage.setItem(KYBER_PINS_MIRROR, JSON.stringify({ workspaces: kyberPinsState.workspaces, sessions: kyberPinsState.sessions }));
	} catch (e) { /* navigation privée : l'état reste en mémoire */ }
};
const kyberPinsUiRead = () => {
	try {
		const brut = localStorage.getItem(KYBER_PINS_UI);
		if (brut === null) return { replie: false, vues: {} };
		const parsed = JSON.parse(brut);
		if (parsed === null || typeof parsed !== "object") return { replie: false, vues: {} };
		const vues = {};
		const source = parsed.vues !== null && typeof parsed.vues === "object" ? parsed.vues : {};
		for (const cle of Object.keys(source)) {
			const vue = source[cle];
			if (vue === null || typeof vue !== "object") continue;
			vues[String(cle)] = { ouvert: vue.ouvert !== false, tout: vue.tout === true };
		}
		return { replie: parsed.replie === true, vues: vues };
	} catch (e) { return { replie: false, vues: {} }; }
};
const kyberPinsUiWrite = (changement) => {
	try {
		const actuel = kyberPinsUiRead();
		localStorage.setItem(KYBER_PINS_UI, JSON.stringify(Object.assign({}, actuel, changement)));
	} catch (e) { /* navigation privée : le repli reste en mémoire */ }
};
const kyberPinsSend = (kind, id, pinned) => fetch(KYBER_PINS_URL, {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ kind: kind, id: id, pinned: pinned })
}).then((response) => response.json());
/** Réordonnancement : la liste COMPLÈTE du type part à l'hôte, son état revient. */
const kyberPinsSendOrder = (kind, order) => fetch(KYBER_PINS_URL, {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ kind: kind, order: order })
}).then((response) => response.json()).then((data) => {
	if (data === null || data === undefined || data.ok !== true) {
		throw new Error(data !== null && data !== undefined && typeof data.error === "string" ? data.error : "refus");
	}
	return data;
});
// Noyau pur du réordonnancement (aucun DOM, aucun fetch) : le bloc balisé
// ci-dessous est EXTRAIT tel quel par `scripts/test-pins-client.mjs` — le
// marqueur doit donc rester seul sur sa ligne.
// KB-PINS-CLIENT-CORE-BEGIN
/** Déplace l'élément d'index `de` vers `vers` : liste neuve, bornes respectées. */
const kyberPinsMove = (ids, de, vers) => {
	const total = ids.length;
	if (total < 2 || de < 0 || de >= total) return ids.slice();
	const cible = vers < 0 ? 0 : (vers >= total ? total - 1 : vers);
	if (cible === de) return ids.slice();
	const suivant = ids.slice();
	const [element] = suivant.splice(de, 1);
	suivant.splice(cible, 0, element);
	return suivant;
};
/**
 * Dépose l'élément d'index `de` juste AVANT (`moitie` = "before") ou juste APRÈS
 * ("after") la rangée d'index `cible` — le geste de Workspaces : c'est la moitié
 * survolée qui décide, pas un échange de positions.
 */
const kyberPinsPlace = (ids, de, cible, moitie) => {
	const total = ids.length;
	if (total < 2 || de < 0 || de >= total || cible < 0 || cible >= total || de === cible) return ids.slice();
	const ancre = ids[cible];
	const suivant = ids.slice();
	const [element] = suivant.splice(de, 1);
	const position = suivant.indexOf(ancre);
	if (position < 0) return ids.slice();
	suivant.splice(moitie === "before" ? position : position + 1, 0, element);
	return suivant;
};
// KB-PINS-CLIENT-CORE-END
const kyberPinsReason = (reason) => reason !== null && reason !== undefined && typeof reason.message === "string" ? reason.message : String(reason);
/** Le miroir n'a existé qu'ici : on le pousse une fois, mais seulement si l'hôte est vide. */
const kyberPinsAdopt = () => {
	const sends = [];
	for (const id of kyberPinsState.workspaces) sends.push(kyberPinsSend("workspace", id, true));
	// Les CONVERSATIONS ne sont plus adoptées : depuis 0.1.7 elles appartiennent à
	// DSH (`pinnedSessionIds`), et pousser un miroir d'avant la bascule les
	// épinglerait pour de bon — une migration qu'on ne déclenche pas en silence.
	if (kyberPinsState.sessions.length > 0) console.warn("[kybernos] miroir : épingles de conversation ignorées (elles appartiennent à DSH depuis 0.1.7)");
	return Promise.all(sends).then((results) => {
		const refused = results.filter((data) => data === null || data === undefined || data.ok !== true).length;
		if (refused > 0) console.warn("[kybernos] miroir d'épingles partiellement adopté :", refused, "refus");
	}).catch((reason) => { console.warn("[kybernos] miroir d'épingles non adopté :", kyberPinsReason(reason)); });
};
let kyberPinsPending = null;
/** Lecture unique : le miroir s'affiche tout de suite, l'hôte tranche quand il répond. */
const kyberPinsLoad = () => {
	if (kyberPinsPending !== null) return kyberPinsPending;
	const mirror = kyberPinsMirrorRead();
	kyberPinsState.workspaces = mirror.workspaces;
	kyberPinsState.sessions = mirror.sessions;
	kyberPinsEmit();
	kyberPinsPending = fetch(KYBER_PINS_URL, { headers: { accept: "application/json" } }).then((response) => response.json()).then((data) => {
		const pins = data !== null && data !== undefined && data.ok === true ? data.pins : null;
		kyberPinsState.loaded = true;
		if (pins === null || pins === undefined) {
			kyberPinsState.host = false;
			kyberPinsState.error = "hote indisponible";
			kyberPinsEmit();
			return;
		}
		const hostWorkspaces = kyberPinsIds(pins.workspaces);
		const hostSessions = kyberPinsIds(pins.sessions);
		kyberPinsState.host = true;
		kyberPinsState.error = null;
		const hostEmpty = hostWorkspaces.length === 0 && hostSessions.length === 0;
		const mirrorHas = mirror.workspaces.length > 0 || mirror.sessions.length > 0;
		if (hostEmpty === true && mirrorHas === true) {
			kyberPinsEmit();
			kyberPinsAdopt();
			return;
		}
		kyberPinsState.workspaces = hostWorkspaces;
		kyberPinsState.sessions = hostSessions;
		kyberPinsMirrorWrite();
		kyberPinsEmit();
	}).catch((reason) => {
		kyberPinsState.loaded = true;
		kyberPinsState.host = false;
		kyberPinsState.error = kyberPinsReason(reason);
		kyberPinsEmit();
	});
	return kyberPinsPending;
};
/** Bascule optimiste : l'UI répond tout de suite, l'hôte tranche, un échec revient en arrière. */
const kyberPinsToggle = (kind, id, pinned) => {
	const field = KYBER_PINS_FIELDS[kind];
	const before = kyberPinsState[field];
	if (before.includes(id) === pinned) return Promise.resolve();
	kyberPinsState[field] = pinned ? before.concat([id]) : before.filter((value) => value !== id);
	kyberPinsMirrorWrite();
	kyberPinsEmit();
	// Hôte muet : le miroir fait foi pour l'instant, il n'y a rien à annuler.
	if (kyberPinsState.host !== true) return Promise.resolve();
	return kyberPinsSend(kind, id, pinned).then((data) => {
		if (data === null || data === undefined || data.ok !== true) {
			throw new Error(data !== null && data !== undefined && typeof data.error === "string" ? data.error : "refus");
		}
		kyberPinsState.error = null;
		kyberPinsEmit();
	}).catch((reason) => {
		const message = kyberPinsReason(reason);
		kyberPinsState[field] = before;
		kyberPinsMirrorWrite();
		kyberPinsState.error = message;
		kyberPinsEmit();
		console.warn("[kybernos] épingle non enregistrée :", message);
	});
};
/** Abonnement de la racine du navigateur : une bascule re-rend l'arbre, les rangées relisent l'état. */
function useKyberPins() {
	const [, bump] = (0, react.useState)(0);
	(0, react.useEffect)(() => {
		kyberPinsLoad();
		const listener = () => { bump((value) => value + 1); };
		kyberPinsListeners.add(listener);
		return () => { kyberPinsListeners.delete(listener); };
	}, []);
	return kyberPinsState;
}
/** Épingle 16px : le jeu d'icônes DSH n'en fournit pas, elle est dessinée ici. */
function KyberPinIcon() {
	return (0, react_jsx_runtime.jsx)("svg", {
		width: 16,
		height: 16,
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 1.8,
		strokeLinecap: "round",
		strokeLinejoin: "round",
		"aria-hidden": true,
		children: (0, react_jsx_runtime.jsx)("path", { d: "M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" })
	});
}
/** Ligne de menu « Pin »/« Unpin » ; vide quand la rangée n'a pas de bascule (Ungrouped). */
function pinMenuItems(t, pinned, onTogglePin) {
	if (onTogglePin === void 0) return [];
	return [{
		id: "pin",
		label: pinned ? t("menu.unpin") : t("menu.pin"),
		icon: (0, react_jsx_runtime.jsx)(KyberPinIcon, {})
	}];
}
/**
 * Vue par défaut d'un dossier épinglé : ouvert sur ses threads, replié sur les
 * cinq derniers (même limite que Workspaces).
 */
const VUE_EPINGLE_DEFAUT = { ouvert: true, tout: false };
/**
 * La section « Pinned » : chaque dossier épinglé PORTE SES THREADS — replié sur
 * les cinq derniers, « Show N more sessions » les révèle ici même, et déplier la
 * rangée ne touche pas l'état du même dossier dans Workspaces (vue propre à la
 * section). Viennent ensuite les conversations épinglées qui ne sont pas déjà
 * rendues sous un dossier, pour qu'aucune conversation n'apparaisse deux fois.
 * Elle réutilise les rangées du navigateur — mêmes icônes, même menu, mêmes
 * actions — donc une rangée épinglée reste ouvrable, renommable, forquable et
 * désépinglable.
 */
function PinnedSection({ t, pins, workspaces, list, pinnedSessionIds, useSessionStatus, currentSessionId, archivedSessionIds, home, startSession, onOpen, onFork, onArchive, onRename, onRenameWorkspace, onDeleteWorkspace, renderSlot }) {
	const statuses = useSessionStatus((state) => state);
	// ── Appartenance NATIVE + ordre local ────────────────────────────────────
	// Depuis 0.1.7, DSH tient l'épinglage des CONVERSATIONS
	// (`workspaceRegistry.pinnedSessionIds`, publié à la sidebar) : c'est lui qui
	// dit qui figure dans cette section, notre fichier n'en porte plus que
	// l'ORDRE. Sans ce prop (0.1.6, ou portée qui ne l'expose pas), notre liste
	// reste la seule vérité — jamais de section vide par silence.
	const natifs = Array.isArray(pinnedSessionIds) ? pinnedSessionIds : null;
	// L'ordre est OPTIMISTE : l'UI bouge tout de suite, l'hôte tranche, un refus
	// revient en arrière (même contrat que la bascule d'épingle).
	const [ordre, setOrdre] = (0, react.useState)(null);
	const ordreDe = (kind) => {
		const champ = kind === "session" ? "sessions" : "workspaces";
		const base = ordre === null || Array.isArray(ordre[champ]) !== true ? pins[champ] : ordre[champ];
		if (kind !== "session" || natifs === null) return base;
		// Une épingle native que nous n'avons pas encore ordonnée passe devant
		// (règle de DSH : la nouvelle épingle monte en tête).
		return natifs.filter((id) => base.includes(id) !== true).concat(base.filter((id) => natifs.includes(id)));
	};
	const idsDossiers = ordreDe("workspace");
	const idsSessions = ordreDe("session");
	const enregistrerOrdre = (kind, suivant) => {
		const champ = kind === "session" ? "sessions" : "workspaces";
		const avant = ordre;
		const base = ordre === null ? { workspaces: pins.workspaces, sessions: pins.sessions } : ordre;
		setOrdre(Object.assign({}, base, { [champ]: suivant }));
		if (kyberPinsState.host !== true) return;
		kyberPinsSendOrder(kind, suivant).catch((reason) => {
			setOrdre(avant);
			const message = kyberPinsReason(reason);
			kyberPinsState.error = message;
			kyberPinsEmit();
			console.warn("[kybernos] ordre non enregistré :", message);
		});
	};
	/** Un cran au clavier (Alt+↑/↓) : échange avec la rangée voisine. */
	const deplacer = (kind, ids, de, vers) => {
		const suivant = kyberPinsMove(ids, de, vers);
		if (suivant.join("\u0000") === ids.join("\u0000")) return;
		enregistrerOrdre(kind, suivant);
	};
	/** Dépôt SUR une rangée : `moitie` dit avant ou après elle (geste de DSH). */
	const poser = (kind, ids, de, cible, moitie) => {
		const suivant = kyberPinsPlace(ids, de, cible, moitie);
		if (suivant.join("\u0000") === ids.join("\u0000")) return;
		enregistrerOrdre(kind, suivant);
	};
	// ── Glisser-déposer, calqué sur Workspaces ──────────────────────────────
	// DSH décide de l'insertion par la MOITIÉ de la rangée survolée (`rowHalf` :
	// haut = avant, bas = après) et dessine un trait là où la rangée tombera.
	// La section reprend ce geste — trait d'insertion, pas un échange de places.
	const [glisse, setGlisse] = (0, react.useState)(null);
	const moitieDe = (evenement) => {
		const cadre = evenement.currentTarget.getBoundingClientRect();
		return evenement.clientY < cadre.top + cadre.height / 2 ? "before" : "after";
	};
	// Rangée déplaçable : glisser-déposer, ou Alt+↑/↓ quand la rangée a le focus
	// (la rangée DSH est un bouton, le clavier marche donc sans souris).
	const enveloppe = (kind, ids, index, contenu, cle) => {
		const glissee = glisse !== null && glisse.kind === kind && glisse.index === index;
		const survolee = glisse !== null && glisse.kind === kind && glisse.sur !== null && glisse.sur.index === index;
		return (0, react_jsx_runtime.jsx)("div", {
			className: "kbpin_row",
			"data-kbpin-kind": kind,
			"data-kbpin-drag": glissee === true ? "true" : void 0,
			// Le trait d'insertion : au-dessus ou au-dessous, selon la moitié.
			"data-kbpin-marker": survolee === true ? glisse.sur.moitie : void 0,
			draggable: true,
			onDragStart: (evenement) => {
				evenement.dataTransfer.effectAllowed = "move";
				evenement.dataTransfer.setData("text/plain", kind + ":" + String(index));
				setGlisse({ kind: kind, index: index, sur: null });
			},
			onDragOver: (evenement) => {
				// Une autre famille ne se dépose pas ici : sans `preventDefault`
				// le navigateur refuse le dépôt (dossier ↔ conversation).
				if (glisse === null || glisse.kind !== kind) return;
				evenement.preventDefault();
				evenement.dataTransfer.dropEffect = "move";
				const moitie = moitieDe(evenement);
				setGlisse((actuel) => actuel === null || (actuel.sur !== null && actuel.sur.index === index && actuel.sur.moitie === moitie)
					? actuel
					: Object.assign({}, actuel, { sur: { index: index, moitie: moitie } }));
			},
			onDrop: (evenement) => {
				evenement.preventDefault();
				if (glisse === null || glisse.kind !== kind) { setGlisse(null); return; }
				const moitie = glisse.sur !== null && glisse.sur.index === index ? glisse.sur.moitie : moitieDe(evenement);
				poser(kind, ids, glisse.index, index, moitie);
				setGlisse(null);
			},
			onDragEnd: () => { setGlisse(null); },
			onKeyDown: (evenement) => {
				if (evenement.altKey !== true || (evenement.key !== "ArrowUp" && evenement.key !== "ArrowDown")) return;
				evenement.preventDefault();
				evenement.stopPropagation();
				deplacer(kind, ids, index, evenement.key === "ArrowUp" ? index - 1 : index + 1);
			},
			children: contenu
		}, cle);
	};
	// ── Repli : la section, puis chaque dossier épinglé ─────────────────────
	// Replier la section ou un dossier est une préférence de NAVIGATEUR : elle
	// vit dans `localStorage` (clé `dsh.kyber.pins.v1.ui`) et survit donc au
	// rechargement, comme les rangées de Workspaces.
	const [replie, setReplie] = (0, react.useState)(() => kyberPinsUiRead().replie === true);
	const [vues, setVues] = (0, react.useState)(() => kyberPinsUiRead().vues);
	(0, react.useEffect)(() => { kyberPinsEnsureCss(); return undefined; }, []);
	const basculerReplie = () => {
		const suivant = replie !== true;
		setReplie(suivant);
		kyberPinsUiWrite({ replie: suivant });
	};
	const vueDe = (id) => vues[id] === undefined ? VUE_EPINGLE_DEFAUT : vues[id];
	const reglerVue = (id, changement) => {
		const vue = vues[id] === undefined ? VUE_EPINGLE_DEFAUT : vues[id];
		const suivant = Object.assign({}, vues, { [id]: Object.assign({}, vue, changement) });
		setVues(suivant);
		kyberPinsUiWrite({ vues: suivant });
	};
	const archived = new Set(archivedSessionIds);
	const visible = (id) => {
		const session = list.byId[id];
		// 0.1.7 a ajouté un 4e paramètre `archivedFilter` à `sessionVisible`
		// (union fermée `default|show|only`, `assertNever` sur tout le reste).
		// L'oublier faisait lever « unreachable variant: undefined » et le siège
		// `sidebar.workspaces` entier était déclaré planté — la sidebar perdait
		// Workspaces, ses dossiers et « New Session ». En 0.1.6 le 4e argument
		// n'existe pas et est ignoré : le passer est donc sûr sur les deux.
		return session !== void 0 && sessionVisible(session, currentSessionId, archived, 'default') === true;
	};
	// `deriveFlat` a gagné un paramètre en 0.1.7 : `(list, ids, rowState,
	// statuses)` au lieu de `(list, ids, statuses)`, et `rowState` porte
	// `archivedSessionIds` / `pinnedSessionIds` / `archivedFilter` — ce dernier
	// est une union fermée (`default|show|only`) que `sessionVisible` refuse par
	// `assertNever`. On sonde donc l'ARITÉ plutôt qu'un numéro de version : le
	// même bloc est injecté dans les deux bundles. `pinnedSessionIds` reste vide
	// ici : notre section a son propre ordre, l'épinglage natif 0.1.7 ne doit pas
	// le réordonner en douce.
	const aplatir = (ids) => deriveFlat.length >= 4
		? deriveFlat(list, ids, { archivedSessionIds: archivedSessionIds, pinnedSessionIds: [], archivedFilter: 'default' }, statuses)
		: deriveFlat(list, ids, statuses);
	// `workspaces` arrive DÉJÀ ordonné par le navigateur (récence ou ordre manuel,
	// session courante en tête) : les threads d'un dossier épinglé sont donc dans
	// le même ordre que dans Workspaces, sans re-tri ici.
	const dossiers = idsDossiers.map((id, index) => ({ index: index, workspace: workspaces.find((workspace) => workspace.workspaceId === id) })).filter((entree) => entree.workspace !== void 0).map((entree) => {
		const workspace = entree.workspace;
		const vue = vueDe(workspace.workspaceId);
		const threads = aplatir(workspace.sessionIds.filter((id) => visible(id) === true));
		const replie = collapsedSessionRows(threads);
		return {
			workspace: workspace,
			rang: entree.index,
			vue: vue,
			threads: threads,
			montrees: vue.tout === true ? threads : replie.rows,
			cachees: replie.hiddenCount
		};
	});
	// Déduplication : un thread déjà rendu sous un dossier épinglé ne réapparaît
	// pas dans la liste des conversations épinglées.
	const sousDossier = new Set();
	for (const entree of dossiers) {
		if (entree.vue.ouvert === true) for (const node of entree.montrees) sousDossier.add(node.id);
	}
	// `nodes` est une vue FILTRÉE de `idsSessions` (archivées, déjà rendues sous
	// un dossier) : on garde le rang d'origine, sinon un déplacement viserait la
	// mauvaise position.
	const nodes = aplatir(idsSessions.filter((id) => visible(id) === true && sousDossier.has(id) === false)).map((node) => ({ node: node, rang: idsSessions.indexOf(node.id) }));
	if (dossiers.length === 0 && nodes.length === 0) return null;
	const now = Date.now();
	const rangeeThread = (node) => (0, react_jsx_runtime.jsx)(SessionNodeItem, {
		node: node,
		currentId: currentSessionId,
		now: now,
		t: t,
		pinned: natifs === null ? kyberPinsState.sessions.includes(node.id) : natifs.includes(node.id),
		onOpen: onOpen,
		onRename: onRename,
		onFork: onFork,
		onArchive: onArchive,
		// 0.1.7 : `SessionNodeItem` appelle `renderSlot` DEUX fois (menu + siège
		// `sidebar.workspaces.session.row.action`), et le second appel n'est pas
		// gardé côté DSH. Monter la rangée sans ce prop faisait planter tout le
		// siège `sidebar.workspaces`. On le fait donc suivre depuis le navigateur
		// (absent en 0.1.6, où la rangée ne l'utilise pas).
		renderSlot: renderSlot,
		// 0.1.7 : l'épinglage d'une conversation est NATIF (le siège de menu de
		// DSH le porte) — notre bascule ne servirait qu'à rouvrir un second état.
		onTogglePin: natifs === null ? () => { kyberPinsToggle("session", node.id, kyberPinsState.sessions.includes(node.id) !== true); } : void 0
	}, "pin-t-" + node.id);
	const rangeeDossier = (entree) => (0, react_jsx_runtime.jsxs)("div", {
		className: "kbpin_group",
		children: [
			(0, react_jsx_runtime.jsx)(ProjectRowItem, {
				group: {
					// Même convention que Workspaces (`data-row-key`
					// `workspace:<id>`) : ProjectRowItem n'utilise `group.key`
					// que pour ça, et une sonde peut viser la rangée de la même
					// façon dans les deux sections.
					key: entree.workspace.workspaceId,
					workspaceId: entree.workspace.workspaceId,
					cwd: entree.workspace.path,
					createdAt: Date.parse(entree.workspace.createdAt),
					label: entree.workspace.title,
					sessionCount: entree.workspace.sessionIds.length,
					expanded: entree.vue.ouvert,
					containsCurrent: entree.workspace.sessionIds.includes(currentSessionId),
					sessions: []
				},
				home: home,
				t: t,
				pinned: true,
				onTogglePin: () => { kyberPinsToggle("workspace", entree.workspace.workspaceId, false); },
				onToggle: () => { reglerVue(entree.workspace.workspaceId, { ouvert: entree.vue.ouvert !== true }); },
				onCreate: () => { startSession(entree.workspace.workspaceId); },
				actions: {
					rename: () => { onRenameWorkspace(entree.workspace.workspaceId, entree.workspace.title); },
					delete: () => { onDeleteWorkspace(entree.workspace.workspaceId, entree.workspace.title); }
				}
			}, "pin-ws-" + entree.workspace.workspaceId),
			entree.vue.ouvert === true && entree.montrees.length > 0 && (0, react_jsx_runtime.jsx)("div", {
				className: "kbpin_threads",
				role: "group",
				children: entree.montrees.map(rangeeThread)
			}, "pin-threads-" + entree.workspace.workspaceId),
			entree.vue.ouvert === true && entree.cachees > 0 && (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "kbpin_more",
				"aria-expanded": entree.vue.tout === true,
				onClick: () => { reglerVue(entree.workspace.workspaceId, { tout: entree.vue.tout !== true }); },
				children: entree.vue.tout === true ? t("sessions.collapse") : t("sessions.expand", { n: entree.cachees })
			}, "pin-more-" + entree.workspace.workspaceId)
		]
	}, "pin-ws-" + entree.workspace.workspaceId);
	return (0, react_jsx_runtime.jsxs)("div", {
		className: "kbpin_section",
		"data-kbpin-collapsed": replie === true ? "true" : void 0,
		children: [
			// La feuille rendue DANS l'arbre : elle suit le composant, elle ne peut
			// donc pas manquer alors que la section, elle, existe.
			(0, react_jsx_runtime.jsx)("style", { "data-kbpin-style": "in-tree" }, KYBER_PINS_CSS),
			(0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: "kbpin_header",
				"aria-expanded": replie !== true,
				"aria-label": replie === true ? t("pins.expand") : t("pins.collapse"),
				onClick: basculerReplie,
				children: [
					(0, react_jsx_runtime.jsx)("span", {
						className: "kbpin_chevron",
						"data-kbpin-replie": replie === true ? "true" : void 0,
						children: (0, react_jsx_runtime.jsx)("svg", {
							width: 12,
							height: 12,
							viewBox: "0 0 16 16",
							fill: "none",
							stroke: "currentColor",
							strokeWidth: 1.7,
							strokeLinecap: "round",
							strokeLinejoin: "round",
							"aria-hidden": true,
							children: (0, react_jsx_runtime.jsx)("path", { d: "m4 6 4 4 4-4" })
						})
					}),
					(0, react_jsx_runtime.jsx)("span", { className: "kbpin_label", title: t("pins.reorder"), children: t("section.pinned") })
				]
			}),
			(0, react_jsx_runtime.jsxs)("div", {
				className: "kbpin_rows",
				role: "group",
				"aria-label": t("section.pinned"),
				children: [
					dossiers.map((entree) => enveloppe("workspace", idsDossiers, entree.rang, rangeeDossier(entree), "pin-w-" + entree.workspace.workspaceId)),
					nodes.map((entree) => enveloppe("session", idsSessions, entree.rang, (0, react_jsx_runtime.jsx)(SessionNodeItem, {
						node: entree.node,
						currentId: currentSessionId,
						now: now,
						t: t,
						pinned: true,
						onOpen: onOpen,
						onRename: onRename,
						onFork: onFork,
						onArchive: onArchive,
						// Même raison que dans `rangeeThread` : la rangée DSH appelle
						// `renderSlot` sans garde en 0.1.7.
						renderSlot: renderSlot,
						onTogglePin: natifs === null ? () => { kyberPinsToggle("session", entree.node.id, false); } : void 0
					}, "pin-s-" + entree.node.id)))
				]
			})
		]
	});
}
/* kybernos:pins:end */
