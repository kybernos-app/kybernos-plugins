// @local/kybernos-skills — client for the full flow (Yours · Discover · Team).
//
// Single mechanism ARB-1: this module injects itself into the 'main.kybernos-skills' slot
// published by the kybernos pivot (batch B4) — no peer export, no require bridge.
//
// Frozen contracts consumed (host: kybernos-skills/index.js):
//   GET  /kybernos-skills/skills            -> { ok, skills[], roots[], complete }
//   GET  /kybernos-skills/status            -> { ok, roots[{path,source,exists}] }
//   GET  /kybernos-skills/index[?view=&page=&perPage=] -> { ok, total, hasMore, skills[] }
//   GET  /kybernos-skills/search[?q=]        -> { ok, count, durationMs, skills[] }
//   GET  /kybernos-skills/curated            -> { ok, owners[{owner,skills[]}], totalSkills }
//   GET  /kybernos-skills/audit[?source=&skill=] -> { ok, audits[{provider,status,summary}] }
//   POST /kybernos-skills/toggle  {root,name,active}
//   POST /kybernos-skills/create  {root,name,description,whenToUse,body,modelInvocable}
//   POST /kybernos-skills/install {source,name,root}
//   POST /kybernos-skills/skill/read {root,name} -> { ok, text, folder, file, files, actions{reveal,edit,duplicate,delete} }   (the panel of Yours)
//   POST /kybernos-skills/skill/reveal {root,name,target:'folder'|'file'} · /skill/duplicate {root,name} · /skill/delete {root,name}
//   GET  /kybernos-skills/preview?source=&name= -> { ok, found, folder, description, text, url }   (the panel of Discover)
//   Team (docs/dev/team-skills-contract.md): GET /kybernos-cloud/team/skills[?view=] · /item?id= · POST …/add · …/review · …/retire · …/delete,
//   and on the disk side POST /kybernos-skills/team/pack {root,name} · /team/install {root,name,version,files,teamId,replace}
//
// Rendering faithful to docs/handoff/skills-ui/maquette.html: Yours/Discover segment, toolbar
// (search, filters, sort, Add), Featured row, grid, pagination, a panel on the right of the list
// for the open skill (Yours: its real SKILL.md and actions; Discover: its own repository, folder and text),
// modals. The style rules are the mockup's, VERBATIM, with two exceptions:
// (1) they are scoped under `.kbs-root`, so that none of them can touch the
// rest of the GUI; (2) the ones whose selector exists identically in the pivot
// (kb8-card, kb8-grid, kb8-tile, kb8-pill, kb8-page…) are dropped — the pivot stays
// owner of its design system.
window.__ModuleLoader__.load({
  id: '@local/kybernos-skills',
  factory(require) {
    try {
      const React = require('react')
      const h = React.createElement
      // createPortal lives in react-dom (a window drawn ahead of the Settings dialog); without it the window is drawn where it is asked for.
      const ReactDOM = (() => { try { return require('react-dom') } catch (e) { return null } })()

      // ── icons: Lucide paths verbatim from maquette.html:223-248 ─────────────
      const PATHS = {
        search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'm21 21-4.34-4.34'],
        sliders: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'],
        sort: ['m3 16 4 4 4-4', 'M7 20V4', 'm21 8-4-4-4 4', 'M17 4v16'],
        plus: ['M5 12h14', 'M12 5v14'],
        chev: ['m6 9 6 6 6-6'],
        chevR: ['m9 6 6 6-6 6'],
        back: ['M19 12H5', 'm12 19-7-7 7-7'],
        pkg: ['M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z', 'M12 22V12', 'm3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7'],
        shield: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z', 'm9 12 2 2 4-4'],
        check: ['M20 6 9 17l-5-5'],
        dl: ['M12 15V3', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5'],
        github: ['M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4', 'M9 18c-4.51 2-5-2-7-2'],
        wand: ['m15 4-1 1', 'm9 9-1 1', 'M4 20l10.5-10.5a2.1 2.1 0 0 0-3-3L1 17l3 3z', 'm14 7 3 3', 'M14.5 3.5 15 3', 'M19 9l.5-.5'],
        info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-4', 'M12 8h.01'],
        star: ['M11.5 2.3a.53.53 0 0 1 .95 0l2.31 4.68a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.01a.53.53 0 0 1-.77-.56l.88-5.14a2.12 2.12 0 0 0-.61-1.88L2.16 9.8a.53.53 0 0 1 .3-.9l5.16-.76a2.12 2.12 0 0 0 1.6-1.16z'],
        folder: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 1 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'],
        code: ['m16 18 6-6-6-6', 'm8 6-6 6 6 6'],
        lock: ['M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'],
        file: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5'],
        alert: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
        refresh: ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'],
        globe: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M2 12h20', 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z']
      }
      const icon = (name, size) => h('svg', {
        key: 'i' + name + size,
        width: size || 16, height: size || 16, viewBox: '0 0 24 24', 'aria-hidden': 'true',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round'
      }, (PATHS[name] || PATHS.pkg).map((d, i) => h('path', { key: i, d })))

      // ── mockup utilities (:252-258) ────────────────────────────────
      const hue = (s) => { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 360; return x }
      const tile = (name, ic, cls) => {
        const u = hue(String(name))
        // `kbs-sm`: the tile of a table ROW. Same visual language as the cards of the other
        // tabs, simply at the scale of a row. Without it, Discover looked like a raw table
        // dropped next to the rest of the interface.
        const taille = cls === 'lg' ? 22 : (cls === 'kbs-sm' ? 15 : 18)
        return h('span', {
          className: 'kb8-tile' + (cls ? ' ' + cls : ''),
          style: { background: 'hsl(' + u + ' 42% 17%)', color: 'hsl(' + u + ' 72% 72%)', border: '1px solid hsl(' + u + ' 40% 26%)' }
        }, icon(ic || 'pkg', taille))
      }
      // The mockup only had small numbers: its format broke beyond a million
      // (“3476k” for 3,476,000). The real index goes past a million from its very first row.
      const nf = (n) => {
        const v = Number(n)
        if (Number.isFinite(v) === false) return '0'
        const court = (x, u) => x.toFixed(1).replace('.0', '').replace('.', isEn() ? '.' : ',') + u
        if (v >= 1e6) return court(v / 1e6, 'M')
        if (v >= 1e3) return court(v / 1e3, 'k')
        return String(v)
      }
      const today = (iso) => { try { return new Date(iso).toLocaleDateString(isEn() ? 'en-GB' : 'fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) } catch (e) { return '' } }
      const STR = {
        // ── skills learned from experience (docs/dev/learned-skills.md) ──
        'ln.cap': { fr: '{n} suggérés par Kaby', en: '{n} suggested by Kaby' },
        'ln.cap.1': { fr: '1 suggéré par Kaby', en: '1 suggested by Kaby' },
        'ln.b.title': { fr: '{n} skills suggérés par Kaby', en: '{n} skills suggested by Kaby' },
        'ln.b.title.1': { fr: '1 skill suggéré par Kaby', en: '1 skill suggested by Kaby' },
        'ln.b.sub': { fr: 'Appris depuis tes leçons et tes automatisations stables. Rien n’est actif avant que tu acceptes. {max} au plus attendent ici ; un skill que tu laisses {days} jours s’en va, et tu peux le ramener pendant {days} jours.', en: 'Learned from your lessons and your stable automations. Nothing is active until you accept. At most {max} wait here; one you leave alone for {days} days goes away, and you can bring it back for another {days} days.' },
        'ln.b.hide': { fr: 'Masquer', en: 'Hide' },
        'ln.b.foot': { fr: 'Accepter copie le skill dans ton dossier de skills, allumé. Il est ensuite à toi : modifie-le, éteins-le ou supprime-le comme les autres.', en: 'Accepting copies the skill to your skills folder, switched on. It is then yours: edit it, switch it off or delete it like any other.' },
        'ln.b.local': { fr: 'Local, aucun contenu envoyé', en: 'Local, nothing sent' },
        'ln.b.inactive': { fr: 'Pas encore actif', en: 'Not active yet' },
        'ln.kind.lessons': { fr: 'Des leçons qui vont ensemble', en: 'Lessons that go together' },
        'ln.kind.lesson': { fr: 'Une leçon que tu as choisie', en: 'A lesson you chose' },
        'ln.kind.auto': { fr: 'Une automatisation stable', en: 'A stable automation' },
        'ln.from.lessons': { fr: '{n} leçons', en: '{n} lessons' },
        'ln.from.lessons.1': { fr: '1 leçon', en: '1 lesson' },
        'ln.from.auto': { fr: 'automatisation « {name} », {n} exécutions', en: 'automation “{name}”, {n} runs' },
        'ln.from.auto.anon': { fr: 'automatisation, {n} exécutions', en: 'automation, {n} runs' },
        'ln.from.auto.none': { fr: 'automatisation', en: 'automation' },
        'ln.review': { fr: 'Relire', en: 'Review' },
        'ln.badge.suggested': { fr: 'Suggéré par Kaby', en: 'Suggested by Kaby' },
        'ln.badge.learned': { fr: 'Appris', en: 'Learned' },
        'ln.card.note': { fr: 'Pas actif. Rien ne change tant que tu n’as pas accepté.', en: 'Not active. Nothing changes until you accept.' },
        'ln.card.from': { fr: 'Appris le {d} · {src}', en: 'Learned {d} · {src}' },
        'ln.f.origin': { fr: 'Origine', en: 'Origin' },
        'ln.f.kaby': { fr: 'Suggérés par Kaby', en: 'Suggested by Kaby' },
        'ln.f.learned': { fr: 'Appris', en: 'Learned' },
        'ln.f.mine': { fr: 'Les miens', en: 'Mine' },
        'ln.p.crumb': { fr: 'Suggéré par Kaby', en: 'Suggested by Kaby' },
        'ln.p.notactive': { fr: 'pas actif', en: 'not active' },
        'ln.p.local': { fr: 'local seulement', en: 'local only' },
        'ln.p.why': { fr: 'Pourquoi Kaby le suggère', en: 'Why Kaby suggests it' },
        'ln.p.why.lessons': { fr: 'Kaby a trouvé {n} de tes leçons qui parlent de la même chose. Ce ne sont pas des doublons, le ménage les garde donc séparées, mais ensemble elles font une liste de contrôle.', en: 'Kaby found {n} of your lessons that are about the same thing. They are not duplicates, so the tidy-up keeps them apart, but together they make a checklist.' },
        'ln.p.why.lesson': { fr: 'Tu as demandé de faire un skill de cette leçon : c’est un rappel de l’erreur déjà faite, pas une méthode.', en: 'You asked for a skill from this lesson: it is a reminder of the mistake already made, not a method.' },
        'ln.p.why.auto': { fr: 'L’automatisation « {name} » a tourné {n} fois de suite sans échec.', en: 'The automation “{name}” ran {n} times in a row without a failure.' },
        'ln.p.when': { fr: 'Quand l’utiliser', en: 'When to use it' },
        'ln.p.does': { fr: 'Ce qu’il fait', en: 'What it does' },
        'ln.p.rules': { fr: 'Ajouté à chaque skill appris', en: 'Added to every learned skill' },
        'ln.p.checks': { fr: 'Contrôles', en: 'Checks' },
        'ln.p.where': { fr: 'Où il vit', en: 'Where it lives' },
        'ln.p.where.t': { fr: 'Sur cet ordinateur, dans ton dossier de skills une fois accepté. Il n’est envoyé nulle part.', en: 'On this computer, in your skills folder once accepted. It is never sent anywhere.' },
        'ln.p.where.s': { fr: 'Sur cet ordinateur seulement, dans ton dossier de skills une fois accepté. Il n’est envoyé nulle part, et le contrôle de confidentialité doit passer.', en: 'On this computer only, in your skills folder once accepted. It is never sent anywhere, and the privacy check must pass.' },
        'ln.p.editnote': { fr: 'Les contrôles se mettent à jour quand tu enregistres.', en: 'The checks update when you save.' },
        'ln.p.fix': { fr: 'Remplacer par des repères', en: 'Replace with placeholders' },
        'ln.a.title': { fr: '{n} skills modifiés par Kaby seul', en: 'Kaby changed {n} skills on its own' },
        'ln.a.title.1': { fr: '1 skill modifié par Kaby seul', en: 'Kaby changed 1 skill on its own' },
        'ln.a.sub': { fr: 'Au-dessus de ton seuil de confiance ({th}). Chaque changement est dans le journal avec la version précédente, et peut être annulé.', en: 'Above your confidence line ({th}). Each change is in the journal with the previous version, and can be undone.' },
        'ln.a.created': { fr: 'créé', en: 'created' },
        'ln.a.improved': { fr: 'amélioré en v{v}', en: 'improved to v{v}' },
        'ln.a.score': { fr: 'Score {s}, appliqué par Kaby seul', en: 'Score {s}, applied by Kaby on its own' },
        'ln.a.active': { fr: 'Actif. Pas encore relu.', en: 'Active. Not reviewed yet.' },
        'ln.a.keep': { fr: 'Garder', en: 'Keep' },
        'ln.a.foot': { fr: 'Garder laisse le skill tel quel. Annuler le reprend : la version précédente revient, et le journal le dit.', en: 'Keep leaves it as it is. Undo takes it back: the previous version returns, and the journal says so.' },
        'ln2.n.text': { fr: 'C’est la {nth} fois que tu demandes quelque chose comme ça{label} ({dates}). Je note comment on fait, en compétence ? Tu la relis d’abord.', en: 'This is the {nth} time you ask for something like this{label} ({dates}). Shall I write down how we do it, as a skill? You read it first.' },
        'ln2.n.yes': { fr: 'Écris-le en compétence', en: 'Write it down' },
        'ln2.n.later': { fr: 'Pas maintenant', en: 'Not now' },
        'ln2.n.never': { fr: 'Jamais pour celle-ci', en: 'Never for this one' },
        'ln2.n.foot': { fr: 'Kaby l’a remarqué en lisant l’index local de tes conversations : aucun modèle, rien ne quitte cet ordinateur. Au plus une fois par jour, jamais pendant que tu écris ni pendant une exécution.', en: 'Kaby noticed by reading the local index of your chats: no model, nothing leaves this computer. At most once a day, never while you type or while something runs.' },
        'ln2.n.foot.priv': { fr: 'Rien de tes conversations n’est gardé, seulement des nombres et des dates.', en: 'Nothing is kept from your chats, only numbers and dates.' },
        'ln2.n.prompt': { fr: 'Retiens comment on fait ça, en compétence (utilise skill_propose), à partir de cette conversation.', en: 'Remember how to do this as a skill (use skill_propose), from this conversation.' },
        'ln2.n.filled': { fr: 'Pré-rempli par Kaby : modifie-le ou efface-le. Rien n’est envoyé avant que tu appuies sur Envoyer.', en: 'Filled in by Kaby: edit it or clear it. Nothing is sent until you press Send.' },
        'ln2.n.later.done': { fr: 'D’accord. Pas avant demain (deux « Pas maintenant » de suite : pas avant la semaine prochaine).', en: 'OK. Not before tomorrow (two “Not now” in a row: not before next week).' },
        'ln2.n.never.done': { fr: 'Compris : plus jamais pour ce genre de demande. Tu peux le défaire dans Réglages › Compétences apprises.', en: 'Understood: never for this kind of ask. You can undo it in Settings › Learned skills.' },
        'ln2.p.why.repeat': { fr: 'Tu as demandé quelque chose comme ça dans {n} conversations ({dates}). Kaby les a comptées dans l’index local de tes conversations : c’est un fait relevé, pas une note qu’il se donne.', en: 'You asked for something like this in {n} chats ({dates}). Kaby counted them in the local index of your chats: this is a fact it read, not a grade it gave itself.' },
        'ln2.w.title': { fr: 'Ce que Kaby a appris cette semaine', en: 'What Kaby learned this week' },
        'ln2.w.sub': { fr: '{from} – {to} · affichée une fois par semaine, et seulement s’il s’est passé quelque chose', en: '{from} – {to} · shown once a week, and only when something happened' },
        'ln2.w.hide': { fr: 'Masquer', en: 'Hide' },
        'ln2.w.hidden': { fr: 'Carte masquée jusqu’à la semaine prochaine. Tu peux la couper pour de bon dans Réglages › Compétences apprises.', en: 'Card hidden until next week. You can switch it off for good in Settings › Learned skills.' },
        'ln2.w.lessons': { fr: 'leçons', en: 'lessons' },
        'ln2.w.accepted': { fr: 'compétences acceptées', en: 'skills accepted' },
        'ln2.w.used': { fr: 'utilisations de compétences ({n} différentes)', en: 'skill uses ({n} different)' },
        'ln2.w.used.d1': { fr: 'utilisations de compétences (1 différente)', en: 'skill uses (1 different)' },
        'ln2.w.used.1': { fr: 'utilisation de compétence', en: 'skill use' },
        'ln2.w.top': { fr: 'est celle que tu utilises le plus : {n} fois.', en: 'is the one you use most: {n} times.' },
        'ln2.w.waiting': { fr: '{n} suggestions attendent ton accord.', en: '{n} suggestions are waiting for your yes.' },
        'ln2.w.waiting.1': { fr: '1 suggestion attend ton accord.', en: '1 suggestion is waiting for your yes.' },
        'ln2.w.auto': { fr: 'Kaby a créé {c} et amélioré {i} seul.', en: 'Kaby created {c} and improved {i} on its own.' },
        'ln2.w.stale': { fr: 'n’a pas servi depuis {d} jours. L’éteindre ?', en: 'has not been used for {d} days. Switch it off?' },
        'ln2.w.ready': { fr: 'est utilisée dans {n} conversations. La proposer à ton équipe ?', en: 'is used in {n} chats. Propose it to your team?' },
        'ln2.w.later': { fr: 'Plus tard', en: 'Later' },
        'ln2.w.propose': { fr: 'Proposer…', en: 'Propose…' },
        'ln2.w.foot': { fr: 'Pour la couper : Réglages › Compétences apprises › Carte hebdomadaire.', en: 'To switch it off: Settings › Learned skills › Weekly card.' },
        'ln2.chip.ready': { fr: 'prête à partager', en: 'ready to share' },
        'ln2.chip.shared': { fr: 'proposée à ton équipe', en: 'proposed to your team' },
        'ln2.s.h': { fr: 'Partager avec ton équipe', en: 'Share with your team' },
        'ln2.s.text': { fr: 'Utilisée dans {n} conversations depuis que tu l’as acceptée. Tu peux la proposer à ton équipe : seul son texte quitte cet ordinateur, un admin l’approuve, et tu peux la retirer.', en: 'Used in {n} chats since you accepted it. You can propose it to your team: only its text leaves this computer, an admin approves it, and you can withdraw it.' },
        'ln2.s.btn': { fr: 'Proposer à ton équipe…', en: 'Propose to your team…' },
        'ln2.s.done': { fr: 'Proposée à ton équipe. Un admin doit l’approuver avant que les autres la voient.', en: 'Proposed to your team. An admin has to approve it before the others see it.' },
        'ln2.s.priv': { fr: 'Reste sur cet ordinateur : le partage avec une équipe est coupé dans ce domaine.', en: 'Stays on this computer: sharing with a team is off in this field.' },
        'ln2.s.noteam': { fr: 'Pas d’équipe sur ce compte : connecte-toi à une équipe pour la proposer.', en: 'No team on this account: sign in to a team to propose it.' },
        'ln.j.act.shared': { fr: 'Proposée à l’équipe', en: 'Proposed to the team' },
        'ln.j.note.kept_unused': { fr: 'gardée alors qu’elle n’avait pas servi depuis un mois', en: 'kept although it had not been used for a month' },
        'he.bad_answer': { fr: 'Cette réponse n’est pas valide.', en: 'That answer is not valid.' },
        'ls2.rep.h': { fr: 'Tâches que tu répètes', en: 'Tasks you repeat' },
        'ls2.rep.sub': { fr: 'Kaby compare le premier message de tes conversations, dans l’index local qui fait marcher Rechercher partout. Aucun modèle, rien ne quitte cet ordinateur, et rien n’est écrit sans ton clic ni ta relecture.', en: 'Kaby compares the first message of your chats, in the local index that powers Search everywhere. No model, nothing leaves this computer, and nothing is written without your click and your review.' },
        'ls2.rep.on': { fr: 'Me prévenir quand je redemande la même chose', en: 'Tell me when I ask for the same thing again' },
        'ls2.rep.from': { fr: 'À partir de', en: 'From' },
        'ls2.rep.within': { fr: 'sur', en: 'within' },
        'ls2.rep.n3': { fr: '3 demandes', en: '3 asks' },
        'ls2.rep.n4': { fr: '4 demandes', en: '4 asks' },
        'ls2.rep.n5': { fr: '5 demandes', en: '5 asks' },
        'ls2.rep.d30': { fr: '30 jours', en: '30 days' },
        'ls2.rep.d60': { fr: '60 jours', en: '60 days' },
        'ls2.rep.d90': { fr: '90 jours', en: '90 days' },
        'ls2.rep.priv': { fr: 'Dans ce domaine Kaby ne garde que des nombres et des dates : aucun mot de tes conversations n’est stocké, et la carte ne nomme aucun sujet.', en: 'In this field Kaby keeps only numbers and dates: no word of your chats is stored, and the card names no topic.' },
        'ls2.rep.noindex': { fr: 'Rechercher partout n’est pas chargé : sans l’index de tes conversations, Kaby ne peut rien remarquer.', en: 'Search everywhere is not loaded: without the index of your chats Kaby cannot notice anything.' },
        'ls2.rep.none': { fr: 'Rien à signaler pour l’instant : Kaby garde ici ce que tu lui as répondu.', en: 'Nothing yet: Kaby keeps here what you answered it.' },
        'ls2.rep.kind': { fr: 'une tâche de ce genre', en: 'a task of this kind' },
        'ls2.rep.chats': { fr: '{n} conversations', en: '{n} chats' },
        'ls2.rep.s.never': { fr: 'Jamais pour celle-ci', en: 'Never for this one' },
        'ls2.rep.s.done': { fr: 'accepté', en: 'accepted' },
        'ls2.rep.s.later': { fr: 'repoussé', en: 'put off' },
        'ls2.rep.forget': { fr: 'Oublier', en: 'Forget' },
        'ls2.rep.allow': { fr: 'Permettre de nouveau', en: 'Allow again' },
        'ls2.w.h': { fr: 'Carte hebdomadaire', en: 'Weekly card' },
        'ls2.w.sub': { fr: 'Une carte sur l’accueil d’une nouvelle conversation, une fois par semaine et seulement s’il s’est passé quelque chose : ce qui a été appris, ce qui a servi, ce que Kaby a fait seul, ce qui n’a pas servi depuis un mois. Elle suit « Me prévenir » dans les limites ci-dessus (conversation, carte hebdo, ou les deux).', en: 'One card on the home of a new chat, once a week and only when something happened: what was learned, what was used, what Kaby did alone, what has not been used for a month. It follows “Tell me” in the limits above (chat, weekly card, or both).' },
        'ls2.w.on': { fr: 'Montrer la carte hebdomadaire', en: 'Show the weekly card' },
        'ls2.t.h': { fr: 'Partage avec l’équipe', en: 'Sharing with the team' },
        'ls2.t.sub': { fr: 'Kaby ne partage jamais rien. Après assez d’usage il peut signaler qu’une compétence est prête à être proposée à ton équipe, par le flux Team existant : seul le texte part, un admin approuve.', en: 'Kaby never shares anything. After enough use it can point out that a skill is ready to propose to your team, with the existing Team flow: only the text leaves, an admin approves.' },
        'ls2.t.on': { fr: 'Signaler les compétences prêtes à partager, après', en: 'Point out skills that are ready to share, after' },
        'ls2.t.n3': { fr: '3 conversations', en: '3 chats' },
        'ls2.t.n5': { fr: '5 conversations', en: '5 chats' },
        'ls2.t.n8': { fr: '8 conversations', en: '8 chats' },
        'ls2.t.lock': { fr: 'Dans ce domaine les compétences restent sur cet ordinateur par défaut.', en: 'In this field skills stay on this computer by default.' },
        'ls2.t.priv': { fr: 'Autoriser quand même le partage depuis ce domaine. Le contrôle de confidentialité doit toujours passer.', en: 'Allow sharing from this field anyway. The privacy check must still pass.' },
        'ln.n.kept': { fr: 'Gardé.', en: 'Kept.' },
        'ln.n.updated': { fr: '« {name} » est maintenant en v{v}. La version précédente est gardée.', en: '“{name}” is now v{v}. The previous version is kept.' },
        'ln.n.reverted': { fr: 'Annulé : « {name} » est revenu à la version précédente.', en: 'Undone: “{name}” is back to the previous version.' },
        'ln.chip.auto': { fr: 'appliqué par Kaby', en: 'applied by Kaby' },
        'ln.chip.auto.new': { fr: 'appliqué par Kaby · pas relu', en: 'applied by Kaby · not reviewed' },
        'ln.chip.ver': { fr: 'v{v}', en: 'v{v}' },
        'ln.chip.untrusted': { fr: 'source extérieure', en: 'outside source' },
        'ln.card.score': { fr: 'score {s}', en: 'score {s}' },
        'ln.stale': { fr: 'Pas utilisé depuis {d} jours.', en: 'Not used for {d} days.' },
        'ln.stale.off': { fr: 'Éteindre', en: 'Switch off' },
        'ln.kind.asked': { fr: 'Tu as demandé à Kaby de s’en souvenir', en: 'You asked Kaby to remember it' },
        'ln.kind.improve': { fr: 'Une amélioration d’un de tes skills', en: 'An improvement to a skill of yours' },
        'ln.badge.improve': { fr: 'Amélioration par Kaby', en: 'Improvement by Kaby' },
        'ln.from.asked': { fr: 'une conversation où tu l’as demandé', en: 'a chat where you asked' },
        'ln.from.improve': { fr: 'une amélioration', en: 'an improvement' },
        'ln.card.imp': { fr: 'Ajoute un paragraphe : {add}', en: 'Adds a paragraph: {add}' },
        'ln.p.why.asked': { fr: 'Tu as demandé à Kaby de retenir comment faire ça, dans une conversation. Kaby a écrit les étapes : relis-les, ce sont ses mots, pas les tiens.', en: 'You asked Kaby to remember how to do this, in a chat. Kaby wrote the steps: read them, they are its words, not yours.' },
        'ln.p.imp.why': { fr: 'Kaby propose d’ajouter un paragraphe à « {name} » (aujourd’hui en v{v}).', en: 'Kaby suggests adding a paragraph to “{name}” (now v{v}).' },
        'ln.p.imp.add': { fr: 'Le paragraphe', en: 'The paragraph' },
        'ln.p.imp.reason': { fr: 'Pourquoi : {r}', en: 'Why: {r}' },
        'ln.p.conf': { fr: 'Confiance', en: 'Confidence' },
        'ln.p.conf.line': { fr: 'ta ligne : {th}', en: 'your line: {th}' },
        'ln.p.with': { fr: 'Avec tes réglages :', en: 'With your settings:' },
        'ln.p.risky': { fr: 'Le texte demande d’envoyer, supprimer, payer ou lancer des commandes : plafonné à 60, il te demande toujours.', en: 'The text asks to send, delete, pay or run commands: capped at 60, it always asks you.' },
        'ln.p.untrusted': { fr: 'La conversation d’où cela vient a lu une page web, un e-mail ou une autre source extérieure (ou n’a pas pu être suivie) : Kaby ne l’applique jamais seul, quel que soit le score.', en: 'The chat this came from read a web page, an e-mail or another outside source (or could not be followed): Kaby never applies it alone, whatever the score.' },
        'ln.sig.evidence': { fr: 'Ce dont cela vient (leçons, exécutions, conversations)', en: 'What it came from (lessons, runs, chats)' },
        'ln.sig.words': { fr: 'Le texte est dans tes propres mots', en: 'The text is in your own words' },
        'ln.sig.checks': { fr: 'Tous les contrôles passent', en: 'Every check passes' },
        'ln.sig.clean': { fr: 'Aucune donnée de client trouvée', en: 'No client data found' },
        'ln.sig.copy': { fr: 'Pas une copie d’un skill que tu as', en: 'Not a copy of a skill you have' },
        'ln.sig.record': { fr: 'Ton historique avec Kaby', en: 'Your track record with Kaby' },
        'ln.stop.none': { fr: 'Kaby l’applique seul.', en: 'Kaby applies it on its own.' },
        'ln.stop.your_click': { fr: 'tu l’as demandé à la main : tu le relis toujours', en: 'you asked for it by hand: you always read it' },
        'ln.stop.asks': { fr: 'ton niveau est « Demande-moi à chaque fois »', en: 'your level is “Ask me every time”' },
        'ln.stop.locked': { fr: 'ce domaine garde les suggestions pour que tu les acceptes', en: 'this field keeps suggestions for you to accept' },
        'ln.stop.needs_create': { fr: 'ton niveau améliore seulement les skills de Kaby', en: 'your level only improves skills Kaby made' },
        'ln.stop.untrusted': { fr: 'la conversation a lu du contenu extérieur : relis-le d’abord', en: 'the chat read outside content: read it first' },
        'ln.stop.risky': { fr: 'le texte demande d’envoyer, supprimer, payer ou lancer des commandes', en: 'the text asks to send, delete, pay or run commands' },
        'ln.stop.client_data': { fr: 'des données de client sont dans le texte', en: 'client data is in the text' },
        'ln.stop.checks': { fr: 'un contrôle ne passe pas', en: 'a check does not pass' },
        'ln.stop.edited_by_you': { fr: 'tu as modifié ce skill : c’est un changement à relire', en: 'you edited this skill: this is a change to read' },
        'ln.stop.below': { fr: 'le score est sous ta ligne', en: 'the score is under your line' },
        'ln.stop.cap': { fr: 'la limite de changements automatiques de la semaine est atteinte', en: 'this week’s limit of automatic changes is reached' },
        'ln.j.act.created': { fr: 'Créé par Kaby', en: 'Created by Kaby' },
        'ln.j.act.improved': { fr: 'Amélioré', en: 'Improved' },
        'ln.j.act.reviewed': { fr: 'Relu', en: 'Reviewed' },
        'ln.j.act.settings': { fr: 'Réglages changés', en: 'Settings changed' },
        'ln.j.act.paused': { fr: 'Retour à « Demande-moi »', en: 'Back to “Ask me”' },
        'ln.j.note.undid_auto': { fr: 'a annulé un changement fait par Kaby seul', en: 'undid a change Kaby made on its own' },
        'ln.j.note.two_undos': { fr: 'deux changements de Kaby annulés en une semaine', en: 'two of Kaby’s changes undone in a week' },
        'ln.j.note.stopped': { fr: 'arrêté par toi : les changements de la semaine ont été annulés', en: 'stopped by you: the week’s changes were undone' },
        'ln.j.score': { fr: 'score {s}', en: 'score {s}' },
        'ln.j.undo': { fr: 'Annuler ce changement', en: 'Undo this change' },
        'ln.j.level': { fr: 'Niveau : {mode} · ligne {th} · {cap} par semaine', en: 'Level: {mode} · line {th} · {cap} a week' },
        'ln.mode.ask': { fr: 'Demande-moi à chaque fois', en: 'Ask me every time' },
        'ln.mode.improve': { fr: 'Améliorer ses propres skills', en: 'Improve its own skills' },
        'ln.mode.auto': { fr: 'Créer et améliorer', en: 'Create and improve' },
        'ln.t.suggest': { fr: 'Kaby suggère un skill : « {name} ».', en: 'Kaby suggests a skill: “{name}”.' },
        'ln.t.improve': { fr: 'Kaby suggère d’améliorer « {name} ».', en: 'Kaby suggests improving “{name}”.' },
        'ln.t.waits': { fr: 'Il attend ton accord. Rien n’est actif.', en: 'It waits for your yes. Nothing is active.' },
        'ln.t.auto': { fr: 'Kaby a écrit « {name} » seul (score {s}). Il est actif, dans le journal, et tu peux l’annuler.', en: 'Kaby wrote “{name}” on its own (score {s}). It is active, in the journal, and you can undo it.' },
        'ln.t.autoimp': { fr: 'Kaby a amélioré « {name} » seul (maintenant en v{v}, score {s}).', en: 'Kaby improved “{name}” on its own (now v{v}, score {s}).' },
        'he.not_improvable': { fr: 'Ce skill n’a pas été fait par Kaby (ou date d’avant les suggestions) : il ne peut pas être amélioré ainsi.', en: 'This skill was not made by Kaby (or dates from before suggestions): it cannot be improved this way.' },
        'he.bad_settings': { fr: 'Ce réglage n’est pas valide.', en: 'That setting is not valid.' },
        'he.locked_field': { fr: 'Dans ce domaine, les niveaux automatiques sont verrouillés : déverrouille-les d’abord.', en: 'In this field the automatic levels are locked: unlock them first.' },
        'ls.nav': { fr: 'Compétences apprises', en: 'Learned skills' },
        'ls.h1': { fr: 'Compétences apprises', en: 'Learned skills' },
        'ls.lead': { fr: 'Kaby suggère des skills à partir de ton travail. Ici tu choisis ce qu’il peut faire seul.', en: 'Kaby suggests skills from your work. Here you choose what it may do on its own.' },
        'ls.breaker': { fr: 'Tu as annulé deux changements de Kaby cette semaine : il est revenu à « Demande-moi à chaque fois ». Choisis de nouveau un niveau quand tu es prêt.', en: 'You undid two of Kaby’s changes this week, so it is back to “Ask me every time”. Choose a level again when you are ready.' },
        'ls.level.h': { fr: 'Que peut faire Kaby tout seul ?', en: 'How much may Kaby do on its own?' },
        'ls.level.sub': { fr: 'Ton choix. Quel que soit le niveau, le journal note chaque changement et chacun peut être annulé.', en: 'Your choice. Whatever the level, the journal records every change and each one can be undone.' },
        'ls.level.ask': { fr: 'Kaby suggère, tu acceptes. Rien n’est actif avant ton clic.', en: 'Kaby suggests, you accept. Nothing is active before your click.' },
        'ls.level.improve': { fr: 'Au-dessus du seuil, Kaby peut mettre à jour un skill qu’il a fait et que tu as accepté. Les nouveaux attendent toujours ton accord.', en: 'Above the line, Kaby may update a skill it made and you accepted. New skills still wait for you.' },
        'ls.level.auto': { fr: 'Au-dessus du seuil, Kaby peut aussi créer un skill et l’allumer. Tu en es averti et tu peux l’annuler.', en: 'Above the line, Kaby may also create a skill and switch it on. You are told, and you can undo it.' },
        'ls.level.default': { fr: 'par défaut', en: 'default' },
        'ls.lock': { fr: 'Dans ce domaine les skills viennent du travail avec des clients : Kaby demande donc toujours.', en: 'In this field skills come from client work, so Kaby always asks.' },
        'ls.unlock': { fr: 'Autoriser quand même dans ce domaine. Le contrôle de confidentialité doit toujours passer, et le texte ne quitte jamais cet ordinateur.', en: 'Allow in this field anyway. The privacy check must still pass, and the text never leaves this computer.' },
        'ls.line.h': { fr: 'Seuil de confiance', en: 'Confidence threshold' },
        'ls.line.sub': { fr: 'Kaby n’agit seul que si le score atteint cette ligne. Le score est calculé par des règles à partir de faits, jamais par le modèle qui se note lui-même : ce dont cela vient, les mots qui sont les tiens, les contrôles passés, aucune donnée de client, pas une copie, ton historique. 100 au plus ; un texte qui demande d’envoyer, supprimer ou payer est plafonné à 60. Un skill écrit dans une seule conversation n’atteint jamais 70.', en: 'Kaby acts alone only when the score reaches this line. The score is worked out by rules from facts, never by the model grading itself: what it came from, how much is your own words, the checks passed, no client data, not a copy, your track record. 100 at most; text that asks to send, delete or pay is capped at 60. A skill written in a single chat never reaches 70.' },
        'ls.line.preview': { fr: 'Aperçu sur ce qui attend maintenant', en: 'Preview on what is waiting now' },
        'ls.line.preview.ask': { fr: 'Aperçu, si tu choisissais « Créer et améliorer »', en: 'Preview, if you chose “Create and improve”' },
        'ls.line.none': { fr: 'Aucune suggestion n’attend.', en: 'No suggestion is waiting.' },
        'ls.line.would': { fr: 'serait appliqué', en: 'would be applied' },
        'ls.line.applies': { fr: 'Kaby l’appliquerait', en: 'Kaby would apply it' },
        'ls.stops.h': { fr: 'Demande toujours, quel que soit le score', en: 'Always asks you, whatever the score' },
        'ls.stops.sub': { fr: 'On ne peut pas les désactiver.', en: 'These cannot be turned off.' },
        'ls.stop.untrusted': { fr: 'La source a touché du contenu non fiable : une page web, un e-mail, un fichier d’autrui. Une compétence écrite à partir de là pourrait porter une consigne qui y a été glissée.', en: 'The source touched untrusted content: a web page, an e-mail, a file from someone else. A skill written from it could carry an instruction planted there.' },
        'ls.stop.risky': { fr: 'La compétence demande d’agir au-delà de lire et rédiger : envoyer, publier, supprimer, payer, lancer des commandes.', en: 'The skill asks the agent to act beyond reading and drafting: send, publish, delete, pay, run commands.' },
        'ls.stop.client': { fr: 'Des données de client sont dans le texte (e-mail, téléphone, long numéro, date, nom).', en: 'Client data is found in the text (e-mail, phone, long number, date, name).' },
        'ls.stop.edited': { fr: 'Une compétence que tu as écrite ou modifiée : Kaby propose un changement que tu lis, il ne l’applique jamais.', en: 'A skill you wrote or edited: Kaby proposes a change you can read, never applies it.' },
        'ls.stop.team': { fr: 'Les compétences d’équipe et livrées suivent le flux Team et les mises à jour, pas ce réglage.', en: 'Team and shipped skills follow the Team flow and the updates, not this setting.' },
        'ls.stop.cap': { fr: 'Plus de {cap} changements automatiques dans la semaine, et deux annulations dans la semaine : Kaby revient à « Demande-moi à chaque fois ».', en: 'More than {cap} automatic changes in a week, and two undos in a week: Kaby goes back to “Ask me every time”.' },
        'ls.limits.h': { fr: 'Limites et avis', en: 'Limits and notices' },
        'ls.cap': { fr: 'Au plus', en: 'At most' },
        'ls.cap.1': { fr: '1 changement automatique par semaine', en: '1 automatic change a week' },
        'ls.cap.3': { fr: '3 changements automatiques par semaine', en: '3 automatic changes a week' },
        'ls.cap.5': { fr: '5 changements automatiques par semaine', en: '5 automatic changes a week' },
        'ls.notify': { fr: 'Me prévenir', en: 'Tell me' },
        'ls.notify.both': { fr: 'dans le chat et dans la carte hebdo', en: 'in the chat and in the weekly card' },
        'ls.notify.chat': { fr: 'dans le chat seulement', en: 'in the chat only' },
        'ls.notify.week': { fr: 'dans la carte hebdo seulement', en: 'in the weekly card only' },
        'ls.audit.h': { fr: 'Journal d’audit', en: 'Audit trail' },
        'ls.audit.sub': { fr: 'Chaque création, amélioration, acceptation, refus et annulation : quand, quoi, qui (Kaby seul ou toi), le score et ses parties, les sessions d’origine, la version. Les versions précédentes sont gardées : Annuler les rétablit.', en: 'Every creation, improvement, acceptance, refusal and undo: when, what, who (Kaby alone or you), the score and its parts, the sessions it came from, the version. Previous versions are kept: Undo restores them.' },
        'ls.audit.open': { fr: 'Ouvrir le journal', en: 'Open the journal' },
        'ls.audit.stop': { fr: 'Arrêter et annuler les 7 derniers jours', en: 'Stop and undo the last 7 days' },
        'ls.audit.sure': { fr: 'Oui, arrêter et annuler', en: 'Yes, stop and undo' },
        'ls.audit.done': { fr: 'Arrêté. {n} changement(s) annulé(s), les versions précédentes sont revenues.', en: 'Stopped. {n} change(s) undone, the previous versions are back.' },
        'ls.saved': { fr: 'Enregistré.', en: 'Saved.' },
        'ls.absent': { fr: 'Ces réglages ne sont pas disponibles : redémarre DSH pour charger la nouvelle version de Skills.', en: 'These settings are not available: restart DSH to load the new version of Skills.' },
        'ln.c.name': { fr: 'Nom valide', en: 'Valid name' },
        'ln.c.use_when': { fr: 'Une description « À utiliser quand… »', en: 'A “Use when…” description' },
        'ln.c.rules': { fr: 'Brouillons seulement, rien d’inventé, la vérification est à toi', en: 'Drafts only, nothing invented, verification is yours' },
        'ln.c.size': { fr: 'Taille bornée ({size} / {max} caractères)', en: 'Bounded size ({size} / {max} characters)' },
        'ln.c.copy': { fr: 'Pas une copie d’un skill que tu as', en: 'Not a copy of a skill you have' },
        'ln.c.copy.warn': { fr: 'Ressemble à « {name} » ({pct} %)', en: 'Looks like “{name}” ({pct} %)' },
        'ln.c.client_data': { fr: 'Aucune donnée de client trouvée', en: 'No client data found' },
        'ln.c.client_data.n': { fr: '{n} données de client à retirer', en: '{n} pieces of client data to remove' },
        'ln.c.client_data.n.1': { fr: '1 donnée de client à retirer', en: '1 piece of client data to remove' },
        'ln.c.client_data.block': { fr: 'dans ce domaine on ne peut pas accepter tant qu’elles y sont', en: 'in this field it cannot be accepted until they are gone' },
        'ln.c.client_data.warn': { fr: 'ne bloque pas ici, mais relis', en: 'not blocking here, but read it' },
        'ln.accept': { fr: 'Accepter', en: 'Accept' },
        'ln.edit': { fr: 'Modifier', en: 'Edit' },
        'ln.discard': { fr: 'Écarter', en: 'Discard' },
        'ln.save': { fr: 'Enregistrer', en: 'Save' },
        'ln.cancel': { fr: 'Annuler', en: 'Cancel' },
        'ln.accept.locked': { fr: 'Accepter est verrouillé : retire d’abord les données de client.', en: 'Accept is locked: remove the client data first.' },
        'ln.accept.note': { fr: 'Rien ne change tant que tu n’as pas accepté.', en: 'Nothing changes until you accept.' },
        'ln.undo': { fr: 'Annuler', en: 'Undo' },
        'ln.n.accepted': { fr: '« {name} » est actif.', en: '“{name}” is active.' },
        'ln.n.undone': { fr: '« {name} » est retiré, la suggestion revient dans la liste.', en: '“{name}” is taken back, the suggestion is in the list again.' },
        'ln.n.discarded': { fr: '« {name} » écarté. Gardé {days} jours : tu peux le ramener.', en: '“{name}” discarded. Kept {days} days, so you can bring it back.' },
        'ln.n.restored': { fr: '« {name} » est revenu dans la liste.', en: '“{name}” is back in the list.' },
        'ln.n.saved': { fr: 'Enregistré. Toujours pas actif.', en: 'Saved. Still not active.' },
        'ln.j.btn': { fr: 'Journal', en: 'Journal' },
        'ln.j.title': { fr: 'Journal de Kaby', en: 'Kaby’s journal' },
        'ln.j.verified': { fr: 'Chaîne vérifiée', en: 'Chain verified' },
        'ln.j.broken': { fr: 'Chaîne rompue à l’entrée {n}', en: 'Chain broken at entry {n}' },
        'ln.j.broken.bad': { fr: 'Chaîne rompue : une ligne n’est pas lisible', en: 'Chain broken: a line is unreadable' },
        'ln.j.entries': { fr: '{n} entrées', en: '{n} entries' },
        'ln.j.entries.1': { fr: '1 entrée', en: '1 entry' },
        'ln.j.empty': { fr: 'Rien pour l’instant. Chaque proposition, acceptation, refus et annulation sera notée ici.', en: 'Nothing yet. Every suggestion, acceptance, refusal and undo will be noted here.' },
        'ln.j.act.proposed': { fr: 'Proposé', en: 'Suggested' },
        'ln.j.act.accepted': { fr: 'Accepté', en: 'Accepted' },
        'ln.j.act.discarded': { fr: 'Écarté', en: 'Discarded' },
        'ln.j.act.restored': { fr: 'Rétabli', en: 'Restored' },
        'ln.j.act.reverted': { fr: 'Annulé', en: 'Undone' },
        'ln.j.act.expired': { fr: 'Expiré', en: 'Expired' },
        'ln.j.act.adopted': { fr: 'Repris', en: 'Adopted' },
        'ln.j.act.removed': { fr: 'Retiré', en: 'Removed' },
        'ln.j.act.other': { fr: 'Autre', en: 'Other' },
        'ln.j.by.you': { fr: 'Toi', en: 'You' },
        'ln.j.by.kaby': { fr: 'Kaby', en: 'Kaby' },
        'ln.j.mode.manual': { fr: 'à ton clic', en: 'at your click' },
        'ln.j.mode.legacy': { fr: 'avant les suggestions', en: 'before suggestions' },
        'ln.j.mode.auto': { fr: 'automatique', en: 'automatic' },
        'ln.j.note.edited_before_accepting': { fr: 'modifié avant d’être accepté', en: 'edited before it was accepted' },
        'ln.j.note.taken_back': { fr: 'skill accepté puis repris', en: 'accepted skill taken back' },
        'ln.j.note.folder_gone': { fr: 'le dossier du skill n’existe plus', en: 'the skill’s folder is gone' },
        'ln.j.from': { fr: 'Vient de : {src}', en: 'Came from: {src}' },
        'ln.j.foot': { fr: 'Fichier en ajout seulement : chaque ligne porte l’empreinte de la précédente, donc une modification ou une suppression au milieu se voit.', en: 'Append-only file: each line carries the hash of the one before, so an edit or a deletion in the middle shows.' },
        'he.checks_failed': { fr: 'Un contrôle ne passe pas : relis la liste, corrige le texte puis réessaie.', en: 'A check does not pass: read the list, fix the text and try again.' },
        'he.no_free_name': { fr: 'Aucun nom libre pour ce skill.', en: 'No free name for this skill.' },
        'he.too_many_pending': { fr: '{max} suggestions attendent déjà : réponds à l’une d’elles d’abord.', en: '{max} suggestions are already waiting: answer one of them first.' },
        'he.already_proposed': { fr: 'Ces leçons ont déjà donné une suggestion.', en: 'These lessons already made a suggestion.' },
        'he.no_lessons': { fr: 'Aucune leçon à transformer.', en: 'No lesson to turn into a skill.' },
        'he.edited_since': { fr: 'Ce skill a été modifié depuis : il est à toi, supprime-le toi-même si tu n’en veux plus.', en: 'This skill was edited since: it is yours, delete it yourself if you no longer want it.' },
        'he.not_undoable': { fr: 'Ce skill existait avant les suggestions : il ne peut pas être repris ici.', en: 'This skill existed before suggestions: it cannot be taken back here.' },
        'err.unreadable': { fr: 'réponse illisible du serveur', en: 'unreadable server response' },
        'err.noroute': { fr: 'indisponible (HTTP {s}) : relance DSH une fois', en: 'unavailable (HTTP {s}): restart DSH once' },
        'err.unexpected': { fr: 'réponse inattendue du serveur', en: 'unexpected server response' },
        'err.unavail': { fr: 'indisponible : relance DSH une fois', en: 'unavailable: restart DSH once' },
        'err.preview': { fr: 'Aperçu impossible.', en: 'Preview failed.' },
        'err.feat': { fr: 'mise en avant impossible', en: 'could not update Featured' },
        'err.index': { fr: 'index indisponible', en: 'index unavailable' },
        'err.noanswer': { fr: 'le serveur ne répond pas : relance DSH une fois', en: 'the server does not answer: restart DSH once' },
        'err.audit': { fr: 'audit indisponible', en: 'audit unavailable' },
        'err.create': { fr: 'création impossible', en: 'creation failed' },
        'err.install': { fr: 'installation impossible', en: 'installation failed' },
        'he.root_not_allowed': { fr: 'Ce dossier n’est pas l’un de tes dossiers de skills modifiables.', en: 'That folder is not one of your writable skills folders.' },
        'he.invalid_name': { fr: 'Nom invalide : minuscules, chiffres et tirets, sans accent.', en: 'Invalid name: lowercase letters, digits and hyphens, no accents.' },
        'he.name_too_long': { fr: 'Nom trop long ({max} caractères au plus).', en: 'Name too long ({max} characters at most).' },
        'he.active_required': { fr: 'L’état à appliquer (actif ou non) est absent.', en: 'The state to apply (on or off) is missing.' },
        'he.skill_not_found': { fr: 'Skill introuvable.', en: 'Skill not found.' },
        'he.skill_ambiguous': { fr: 'Plusieurs dossiers portent ce nom : impossible de choisir.', en: 'Several folders have this name: cannot choose.' },
        'he.double_marker': { fr: 'SKILL.md et SKILL.md.disabled existent tous deux : état ambigu, rien n’a été renommé.', en: 'Both SKILL.md and SKILL.md.disabled exist: the state is ambiguous, nothing was renamed.' },
        'he.path_outside_root': { fr: 'Chemin hors du dossier de skills : refusé.', en: 'Path outside the skills folder: refused.' },
        'he.real_path_outside_root': { fr: 'Le chemin réel sort du dossier de skills : refusé.', en: 'The real path leaves the skills folder: refused.' },
        'he.timeout': { fr: 'Délai dépassé.', en: 'Timed out.' },
        'he.network_unavailable': { fr: 'Réseau indisponible.', en: 'Network unavailable.' },
        'he.index_url_refused': { fr: 'Adresse de l’index refusée : https, ou http sur cette machine ; sans identifiant, sans paramètres.', en: 'Index address refused: https, or http on this machine; no credentials, no parameters.' },
        'he.index_url_env': { fr: 'L’adresse est imposée par la variable KYBERNOS_SKILLS_INDEX_URL : modifie-la là.', en: 'The address is set by the KYBERNOS_SKILLS_INDEX_URL variable: change it there.' },
        'he.index_unavailable': { fr: 'L’index n’a pas répondu (HTTP {http}).', en: 'The index did not answer (HTTP {http}).' },
        'he.query_too_short': { fr: 'Recherche : au moins 2 caractères.', en: 'Search: at least 2 characters.' },
        'he.invalid_source': { fr: 'Source invalide (attendu : propriétaire/dépôt).', en: 'Invalid source (expected owner/repo).' },
        'he.not_github': { fr: 'Source non GitHub ({source}) : cette route n’installe que depuis un dépôt GitHub.', en: 'Not a GitHub source ({source}): this route only installs from a GitHub repository.' },
        'he.github_rate_limited': { fr: 'GitHub limite les lectures anonymes (HTTP {http}) : réessaie plus tard.', en: 'GitHub is limiting anonymous reads (HTTP {http}): try again later.' },
        'he.not_found': { fr: 'Ce skill n\'est plus dans le catalogue : recharge la liste.', en: 'That skill is no longer in the catalogue: reload the list.' },
        'he.not_writable': { fr: 'Ce skill n\'est pas dans l\'un de tes dossiers de skills modifiables : il n\'est pas supprimé.', en: 'That skill is not in one of your writable skills folders: it is not deleted.' },
        'he.not_a_folder': { fr: 'Ce skill n\'est pas un dossier (un simple fichier .md) : cette action ne s\'applique pas.', en: 'That skill is not a folder (a single .md file): this action does not apply.' },
        'he.is_link': { fr: 'Ce dossier est un lien : le registre de DSH ignore les liens, et rien n\'est touché.', en: 'That folder is a link: the DSH registry ignores links, and nothing was touched.' },
        'he.delete_failed': { fr: 'Le dossier n\'a pas pu être supprimé (droits ?).', en: 'The folder could not be deleted (permissions?).' },
        'he.no_copy_name': { fr: 'Il y a déjà trop de copies de ce skill : supprime-en une.', en: 'There are already too many copies of that skill: delete one.' },
        'he.opener_unavailable': { fr: 'Aucun programme pour l\'ouvrir sur cet ordinateur.', en: 'No program to open it with on this computer.' },
        'he.not_local': { fr: 'DSH tourne sur une autre machine : rien ne s\'ouvre ici.', en: 'DSH runs on another machine: nothing opens here.' },
        'he.already_installed': { fr: 'Un skill de ce nom est déjà installé dans ce dossier.', en: 'A skill with this name is already installed in this folder.' },
        'he.repo_not_found': { fr: 'Dépôt introuvable : {source}.', en: 'Repository not found: {source}.' },
        'he.download_failed': { fr: 'Téléchargement impossible (HTTP {http}).', en: 'Download failed (HTTP {http}).' },
        'he.tar_missing': { fr: 'tar est introuvable sur cette machine : extraction impossible.', en: 'tar is not available on this machine: cannot extract.' },
        'he.archive_unreadable': { fr: 'Archive illisible.', en: 'Unreadable archive.' },
        'he.skill_not_in_repo': { fr: 'Skill « {name} » introuvable dans {source}.', en: 'Skill “{name}” not found in {source}.' },
        'he.repo_ambiguous': { fr: '{count} dossiers de {source} portent ce nom.', en: '{count} folders of {source} have this name.' },
        'he.copy_incomplete': { fr: 'Copie incomplète : SKILL.md absent.', en: 'Incomplete copy: SKILL.md is missing.' },
        'he.description_required': { fr: 'Une description est requise.', en: 'A description is required.' },
        'he.description_too_long': { fr: 'Description trop longue ({max} caractères au plus).', en: 'Description too long ({max} characters at most).' },
        'he.exists': { fr: 'Un skill de ce nom existe déjà dans ce dossier.', en: 'A skill with this name already exists in this folder.' },
        'he.write_failed': { fr: 'Écriture impossible dans {dest}.', en: 'Could not write to {dest}.' },
        'he.origin_refused': { fr: 'Origine refusée.', en: 'Origin refused.' },
        'he.request_failed': { fr: 'Requête impossible.', en: 'The request failed.' },
        'he.body_too_large': { fr: 'Requête trop volumineuse.', en: 'The request is too large.' },
        'he.root_missing': { fr: 'Le dossier est absent de la requête.', en: 'The folder is missing from the request.' },
        'he.skill_not_in_registry': { fr: 'Skill introuvable dans le registre.', en: 'Skill not found in the registry.' },
        'notice.featOn': { fr: '« {name} » mis en avant (Featured)', en: '“{name}” added to Featured' },
        'notice.featOff': { fr: '« {name} » retiré de Featured', en: '“{name}” removed from Featured' },
        'notice.off': { fr: '« {name} » désactivé', en: '“{name}” disabled' },
        'notice.on': { fr: '« {name} » activé', en: '“{name}” enabled' },
        'notice.created': { fr: '« {name} » créé et actif', en: '“{name}” created and active' },
        'notice.installed': { fr: '« {name} » installé', en: '“{name}” installed' },
        'notice.files': { fr: ' — {n} fichiers', en: ' — {n} files' },
        'notice.files.1': { fr: ' — 1 fichier', en: ' — 1 file' },
        'copy.ok': { fr: 'Copié : {text} — colle-le dans le composeur', en: 'Copied: {text} — paste it in the composer' },
        'copy.denied': { fr: 'copie refusée par le navigateur', en: 'copy denied by the browser' },
        'copy.unavail': { fr: 'copie indisponible dans ce navigateur', en: 'copy unavailable in this browser' },
        'sort.recent': { fr: 'Récemment modifié', en: 'Recently modified' },
        'sort.recent.sub': { fr: 'date du SKILL.md sur le disque', en: 'SKILL.md date on disk' },
        'sort.name': { fr: 'Nom', en: 'Name' },
        'sort.alpha': { fr: 'ordre alphabétique', en: 'alphabetical order' },
        'sort.installs': { fr: 'Le plus installé', en: 'Most installed' },
        'sort.installs.sub': { fr: 'compteur d\'installations de l\'index', en: 'install count from the index' },
        'sort.by': { fr: 'Trier par', en: 'Sort by' },
        'sort.fallback': { fr: 'Trier', en: 'Sort' },
        'sort.desc': { fr: 'Décroissant', en: 'Descending' },
        'sort.asc': { fr: 'Croissant', en: 'Ascending' },
        'sort.noteYours': { fr: 'Le tri porte sur les skills installés dans ton profil.', en: 'Sorting applies to the skills installed in your profile.' },
        'sort.noteDisc': { fr: 'Le classement vient de l\'API officielle skills.sh — vue « {v} ».', en: 'Ranking comes from the official skills.sh API — “{v}” view.' },
        'view.alltime': { fr: 'les plus installés, depuis toujours', en: 'most installed, all time' },
        'view.trending': { fr: 'la progression récente', en: 'recent growth' },
        'view.hot': { fr: 'la dernière heure, comparée à hier', en: 'last hour, compared to yesterday' },
        'view.curated': { fr: 'le set first-party de skills.sh', en: 'the skills.sh first-party set' },
        'flt.title': { fr: 'Filtres', en: 'Filters' },
        'flt.rankrows': { fr: 'Classement et lignes', en: 'Ranking and rows' },
        'flt.reset': { fr: 'Réinitialiser', en: 'Reset' },
        'flt.view': { fr: 'Vue', en: 'View' },
        'flt.viewPrefix': { fr: 'Vue : ', en: 'View: ' },
        'flt.viewTitle': { fr: 'Vue et nombre de lignes', en: 'View and row count' },
        'flt.rows': { fr: 'Lignes', en: 'Rows' },
        'flt.state': { fr: 'État', en: 'State' },
        'flt.all': { fr: 'Tous', en: 'All' },
        'flt.allf': { fr: 'Toutes', en: 'All' },
        'flt.active': { fr: 'Actifs ({n})', en: 'Active ({n})' },
        'flt.disabled': { fr: 'Désactivés ({n})', en: 'Disabled ({n})' },
        'f.root': { fr: 'Racine', en: 'Root' },
        'src.search': { fr: '{n} résultats affichés sur {total} — API skills.sh, {ms}', en: '{n} results shown of {total} — skills.sh API, {ms}' },
        'src.search.1': { fr: '1 résultat affiché sur {total} — API skills.sh, {ms}', en: '1 result shown of {total} — skills.sh API, {ms}' },
        'src.unknownDur': { fr: 'durée inconnue', en: 'unknown duration' },
        'src.curated': { fr: '{n} skills first-party répartis sur {o} propriétaires — généré le {d}', en: '{n} first-party skills across {o} owners — generated {d}' },
        'src.index': { fr: '{n} skills classés — API officielle skills.sh, vue « {v} »', en: '{n} skills ranked — official skills.sh API, “{v}” view' },
        'src.index.1': { fr: '1 skill classé — API officielle skills.sh, vue « {v} »', en: '1 skill ranked — official skills.sh API, “{v}” view' },
        'add.create': { fr: 'Créer un skill', en: 'Create a skill' },
        'add.install': { fr: 'Installer un skill', en: 'Install a skill' },
        'add.github': { fr: 'Importer depuis GitHub', en: 'Import from GitHub' },
        'add.search': { fr: 'Chercher dans l\'index', en: 'Search the index' },
        'add.manual': { fr: 'Installer à la main (owner/repo)', en: 'Install manually (owner/repo)' },
        'add.top': { fr: 'Voir les plus installés', en: 'See the most installed' },
        'ph.yours': { fr: 'Rechercher un skill…', en: 'Search skills…' },
        'ph.discover': { fr: 'Chercher dans les skills (nom et description)…', en: 'Search skills (name and description)…' },
        'card.disable': { fr: 'Désactiver', en: 'Disable' },
        'card.enable': { fr: 'Activer', en: 'Enable' },
        'card.readonly': { fr: 'lecture seule', en: 'read-only' },
        'feat.remove': { fr: 'Retirer de Featured', en: 'Remove from Featured' },
        'feat.add': { fr: 'Mettre en avant (Featured)', en: 'Add to Featured' },
        'card.nodesc': { fr: '— sans description —', en: '— no description —' },
        'card.active': { fr: 'actif', en: 'active' },
        'card.disabled': { fr: 'désactivé', en: 'disabled' },
        'card.dup': { fr: 'doublon', en: 'duplicate' },
        'card.noedit': { fr: 'non modifiable', en: 'not editable' },
        'mod.on': { fr: 'Modifié le {d}', en: 'Modified {d}' },
        'mod.unknown': { fr: 'date inconnue', en: 'unknown date' },
        'card.copyTitle': { fr: 'Copier l\'invocation à coller dans le composeur', en: 'Copy the invocation to paste in the composer' },
        'cover.alt': { fr: 'Illustration de {name}', en: 'Illustration for {name}' },
        // Featured tab: the picks Kybernos proposes
        'cap.featured': { fr: 'Les choix de Kybernos : chacun s’installe en un clic et montre ce que disent ses audits de sécurité.', en: 'Picked by Kybernos: each one installs in one click and shows what its security audits said.' },
        'ph.featured': { fr: 'Chercher un skill, une tâche, un auteur…', en: 'Search a skill, a task, an author…' },
        'pick.all': { fr: 'Tous', en: 'All' },
        'sort.editorial': { fr: 'Ordre éditorial', en: 'Editorial order' },
        'pcat.Documents': { fr: 'Documents', en: 'Documents' },
        'pcat.Data': { fr: 'Données', en: 'Data' },
        'pcat.Design': { fr: 'Design', en: 'Design' },
        'pcat.Media': { fr: 'Médias', en: 'Media' },
        'pcat.Research': { fr: 'Recherche', en: 'Research' },
        'pcat.Marketing': { fr: 'Marketing', en: 'Marketing' },
        'pcat.Automation': { fr: 'Automatisation', en: 'Automation' },
        'pcat.Build': { fr: 'Construire', en: 'Build' },
        'pick.audited': { fr: 'Audité · {n}', en: 'Audited · {n}' },
        'pick.warn1': { fr: '1 alerte', en: '1 warning' },
        'pick.warnN': { fr: '{n} alertes', en: '{n} warnings' },
        'pick.auditTip': { fr: 'Verdicts des audits skills.sh', en: 'skills.sh audit verdicts' },
        'need.firecrawl': { fr: 'Demande une clé Firecrawl', en: 'Needs a Firecrawl key' },
        'need.tavily': { fr: 'Demande un compte Tavily', en: 'Needs a Tavily account' },
        'need.google': { fr: 'Demande une connexion Google', en: 'Needs a Google sign-in' },
        'pick.installed': { fr: 'Installé', en: 'Installed' },
        'pick.use': { fr: 'Utiliser', en: 'Use' },
        'pick.details': { fr: 'Détails', en: 'Details' },
        'pick.copied': { fr: 'Copié', en: 'Copied' },
        'pick.by': { fr: 'Créé par {who}', en: 'Created by {who}' },
        'pick.count': { fr: '{n} installations', en: '{n} installs' },
        'pick.count.1': { fr: '1 installation', en: '1 install' },
        'pick.try': { fr: 'Essaie', en: 'Try asking' },
        'pick.pinNeedsInstall': { fr: 'Installe ce skill pour l’épingler', en: 'Install this skill to pin it' },
        'pick.bg': { fr: 'Fond des couvertures', en: 'Cover background' },
        'pick.bg.tint': { fr: 'Teinte', en: 'Tint' },
        'pick.bg.plain': { fr: 'Neutre', en: 'Plain' },
        'pick.loading': { fr: 'Chargement des choix…', en: 'Loading the picks…' },
        'pick.none': { fr: 'Aucun skill ne correspond', en: 'No skill matches' },
        'pick.nonehint': { fr: 'Essaie une autre catégorie ou efface la recherche.', en: 'Try another category or clear the search.' },
        'pick.asof': { fr: 'Choix et verdicts d’audit relevés le {d}.', en: 'Picks and audit verdicts read on {d}.' },
        'fld.title': { fr: 'Pour ton domaine · {field}', en: 'For your field · {field}' },
        'fld.sub': { fr: 'Choisis à l’installation : chaque skill s’installe en un clic.', en: 'Picked at setup: each skill installs in one click.' },
        'fld.kit': { fr: 'Starter kit', en: 'Starter kit' },
        'fld.kit.tip': { fr: 'Rouvrir le starter kit : tout ce que propose ton domaine, en une fois', en: 'Reopen the starter kit: everything your field suggests, in one go' },
        'fld.shipped': { fr: 'inclus avec Kybernos', en: 'ships with Kybernos' },
        'fld.installing': { fr: 'Installation…', en: 'Installing…' },
        'pick.back': { fr: 'Retour à Featured', en: 'Back to Featured' },
        'pick.copyPrompt': { fr: 'Copier avec /nom', en: 'Copy with /name' },
        'pick.facts': { fr: 'Le skill', en: 'The skill' },
        'feat.localskill': { fr: 'skill local', en: 'local skill' },
        'row.installed': { fr: 'installé', en: 'installed' },
        'row.offgh': { fr: 'hors GitHub', en: 'off GitHub' },
        'row.community': { fr: 'communauté', en: 'community' },
        'row.already': { fr: 'déjà installé', en: 'already installed' },
        'row.cantInstall': { fr: 'installation impossible', en: 'cannot install' },
        'row.cantInstall.wk': { fr: 'Contenu hébergé hors GitHub', en: 'Content hosted outside GitHub' },
        'row.cantInstall.ng': { fr: 'Source non GitHub', en: 'Non-GitHub source' },
        'pg.prev': { fr: 'Précédent', en: 'Previous' },
        'pg.next': { fr: 'Suivant', en: 'Next' },
        'pg.page': { fr: 'page {p} / {n}', en: 'page {p} / {n}' },
        'pg.rows': { fr: 'lignes {a}–{b} sur {n}', en: 'rows {a}–{b} of {n}' },
        'pg.more': { fr: 'Charger plus', en: 'Load more' },
        'pg.of': { fr: '{a} sur {n}', en: '{a} of {n}' },
        'y.loading': { fr: 'Chargement…', en: 'Loading…' },
        'y.loadfail': { fr: 'Impossible de charger les skills', en: 'Could not load skills' },
        'y.retry': { fr: 'Réessayer', en: 'Retry' },
        'y.none': { fr: 'Aucun skill installé', en: 'No skills installed' },
        'y.nonehint': { fr: 'Crée-en un, ou importe-en un depuis GitHub.', en: 'Create one, or import one from GitHub.' },
        'y.noresult': { fr: 'Aucun résultat', en: 'No results' },
        'y.nofilter': { fr: 'Change de filtre ou de terme.', en: 'Change the filter or search term.' },
        'd.query': { fr: 'Interrogation de l\'index…', en: 'Querying the index…' },
        'd.down': { fr: 'Index indisponible', en: 'Index unavailable' },
        'd.cannot': { fr: 'Impossible de joindre l’index des skills.', en: 'Cannot reach the skills index.' },
        'd.direct': { fr: 'L\'installation directe reste possible par « Importer depuis GitHub ».', en: 'Direct install is still possible via “Import from GitHub”.' },
        'd.hint': { fr: 'C’est souvent passager : réessaie dans un instant. Tes skills installés et l’onglet Team ne sont pas touchés.', en: 'This is often temporary: try again in a moment. Your installed skills and the Team tab are not affected.' },
        'd.retry': { fr: 'Réessayer', en: 'Try again' },
        // The source the Discover index is read from (the relay), and the setting that names another one.
        'src.line': { fr: 'Source', en: 'Source' },
        'src.default': { fr: 'relais Kybernos (par défaut)', en: 'Kybernos relay (default)' },
        'src.custom': { fr: 'adresse personnalisée', en: 'custom address' },
        'src.env': { fr: 'imposée par KYBERNOS_SKILLS_INDEX_URL', en: 'set by KYBERNOS_SKILLS_INDEX_URL' },
        'src.refused': { fr: 'adresse refusée', en: 'address refused' },
        'src.change': { fr: 'Changer', en: 'Change' },
        'src.title': { fr: 'Source de l’index', en: 'Index source' },
        'src.what': { fr: 'Une source est l’endroit où l’onglet Discover lit sa liste de skills publics. Par défaut, c’est le relais Kybernos : une copie en lecture seule de l’index skills.sh, rafraîchie environ toutes les heures, donc sans compte ni clé.', en: 'A source is where the Discover tab reads its list of public skills from. The default is the Kybernos relay: a read-only copy of the skills.sh index, refreshed about every hour, so no account or key is needed.' },
        'src.sub': { fr: 'Aucun identifiant n’est envoyé, et la réponse est bornée en taille.', en: 'No credential is sent, and the answer is capped in size.' },
        'src.field': { fr: 'Adresse du relais', en: 'Relay address' },
        'src.hint': { fr: 'https://… (ou http://localhost… pour un essai sur cette machine). Laisse vide pour le relais Kybernos.', en: 'https://… (or http://localhost… for a test on this machine). Leave empty for the Kybernos relay.' },
        'src.envnote': { fr: 'La variable d’environnement KYBERNOS_SKILLS_INDEX_URL décide de l’adresse : elle prime sur ce réglage. Modifie-la là pour changer de source.', en: 'The KYBERNOS_SKILLS_INDEX_URL environment variable decides the address: it overrides this setting. Change it there to change the source.' },
        'src.reset': { fr: 'Utiliser le relais Kybernos', en: 'Use the Kybernos relay' },
        'src.save': { fr: 'Enregistrer', en: 'Save' },
        'src.saving': { fr: 'Enregistrement…', en: 'Saving…' },
        'src.savedCustom': { fr: 'Source de l’index : {host}', en: 'Index source: {host}' },
        'src.savedDefault': { fr: 'Source de l’index : relais Kybernos', en: 'Index source: Kybernos relay' },
        'err.source': { fr: 'enregistrement impossible', en: 'could not save' },
        // ── Settings page « Skills » (catalogue): the routes that decide where skills come from ──
        'set.nav': { fr: 'Compétences', en: 'Skills' },
        'set.h1': { fr: 'Compétences', en: 'Skills' },
        'set.lead': { fr: 'D’où viennent les skills de ce profil : la source de l’index (Discover) et les dossiers dans lesquels les installations sont écrites.', en: 'Where this profile’s skills come from: the index source (Discover) and the folders installs are written to.' },
        'set.srcH': { fr: 'Source de l’index', en: 'Index source' },
        'set.srcMissing': { fr: 'Les sources des skills ne répondent pas : relance DSH une fois.', en: 'The skill sources do not answer: restart DSH once.' },
        'set.rootsH': { fr: 'Dossiers modifiables', en: 'Writable folders' },
        'set.rootsSub': { fr: 'La création et l’installation de skills s’écrivent uniquement dans ces dossiers.', en: 'Skill creation and installs are written only to these folders.' },
        'set.rootExists': { fr: 'présent', en: 'present' },
        'set.rootMissing': { fr: 'à créer', en: 'will be created' },
        'set.rootWrite': { fr: 'écriture', en: 'write' },
        'set.rootRead': { fr: 'lecture seule', en: 'read-only' },
        'set.rootsMissing': { fr: 'Les dossiers de skills ne répondent pas : relance DSH une fois.', en: 'The skill folders do not answer: restart DSH once.' },
        'set.countsH': { fr: 'Aperçu du profil', en: 'Profile at a glance' },
        'set.installed': { fr: 'skills installés', en: 'skills installed' },
        'set.active': { fr: 'actifs', en: 'active' },
        'set.disabled': { fr: 'désactivés', en: 'disabled' },
        'set.featured': { fr: 'mis en avant', en: 'featured' },
        'th.result': { fr: 'Résultat', en: 'Result' },
        'th.state': { fr: 'État', en: 'State' },
        'd.empty.search': { fr: 'Essaie un autre terme (au moins 2 caractères).', en: 'Try another term (at least 2 characters).' },
        'd.empty.page': { fr: 'Cette page est vide.', en: 'This page is empty.' },
        'btn.install': { fr: 'Installer', en: 'Install' },
        'det.unknownSrc': { fr: 'source inconnue', en: 'unknown source' },
        'det.whatBody': { fr: 'Installer télécharge l\'archive du dépôt {source} depuis GitHub, y trouve le dossier du skill « {name} » (son frontmatter porte name et description), puis le COPIE dans ton dossier de skills ({dest}). Le skill y est actif au prochain tour de tes agents. Aucun lien symbolique : le registre de DSH ignore les liens, un skill lié serait installé sans jamais apparaître. Rien d\'autre n\'est écrit.', en: 'Installing downloads the archive of the {source} repository from GitHub, finds the “{name}” skill folder inside it (its frontmatter carries name and description), then COPIES it into your skills folder ({dest}). The skill is available to your agents on their next turn. No symlinks: the DSH registry ignores links, so a linked skill would be installed without ever showing up. Nothing else is written.' },
        'det.installTip': { fr: 'Télécharge {source} depuis GitHub et copie le skill « {name} » dans ton dossier de skills ({dest}) : disponible pour tes agents au prochain tour.', en: 'Downloads {source} from GitHub and copies the “{name}” skill into your skills folder ({dest}): available to your agents on their next turn.' },
        'det.installHelp': { fr: 'Ce bouton télécharge le dépôt {source} depuis GitHub, y trouve le skill « {name} » puis le copie dans ton dossier de skills ({dest}) — disponible pour tes agents au prochain tour.', en: 'This button downloads the {source} repository from GitHub, finds the “{name}” skill inside it and copies it into your skills folder ({dest}) — available to your agents on their next turn.' },
        'det.row.owner': { fr: 'Publié par', en: 'Published by' },
        'det.row.repo': { fr: 'Dépôt source', en: 'Source repository' },
        'det.row.type': { fr: 'Type de source', en: 'Source type' },
        'det.row.installs': { fr: 'Installations (index)', en: 'Installs (index)' },
        'det.row.page': { fr: 'Page skills.sh', en: 'skills.sh page' },
        'det.rootph': { fr: '<racine>', en: '<root>' },
        'det.local.what': { fr: 'Ce qu\'il fait', en: 'What it does' },
        'det.local.when': { fr: 'Quand l\'utiliser', en: 'When to use it' },
        'det.local.loading': { fr: 'Chargement du contenu réel du skill…', en: 'Loading the skill\'s real contents…' },
        'det.audits': { fr: 'Audits de sécurité — skills.sh', en: 'Security audits — skills.sh' },
        'det.auditLoading': { fr: 'chargement des audits…', en: 'loading audits…' },
        'det.auditNone': { fr: 'aucun audit publié pour ce skill', en: 'no audit published for this skill' },
        'det.audited': { fr: 'audité', en: 'audited' },
        'det.unknown': { fr: 'inconnu', en: 'unknown' },
        'det.root': { fr: 'Dossier', en: 'Folder' },
        'det.modified': { fr: 'Modifié', en: 'Modified' },
        'det.unknownDate': { fr: 'date inconnue', en: 'unknown date' },
        'det.thirdParty': { fr: 'Le contenu vient d\'un dépôt tiers : DSH ne l\'audite pas ; ces verdicts sont ceux publiés par skills.sh.', en: 'The content comes from a third-party repo: DSH does not audit it; these verdicts are the ones published by skills.sh.' },
        'panel.close': { fr: 'Fermer', en: 'Close' },
        'panel.copyPath': { fr: 'Copier le chemin', en: 'Copy the path' },
        'panel.truncated': { fr: 'Fichier long : seul le début est affiché.', en: 'Long file: only the start is shown.' },
        'panel.files': { fr: '{n} fichiers dans le dossier', en: '{n} files in the folder' },
        'panel.files.1': { fr: '1 fichier dans le dossier', en: '1 file in the folder' },
        'act.reveal': { fr: 'Ouvrir le dossier', en: 'Open folder' },
        'act.reveal.tip': { fr: 'Ouvre le dossier du skill sur cet ordinateur', en: 'Opens the skill\'s folder on this computer' },
        'act.edit': { fr: 'Modifier', en: 'Edit' },
        'act.edit.tip': { fr: 'Ouvre SKILL.md dans ton éditeur de texte', en: 'Opens SKILL.md in your text editor' },
        'act.duplicate': { fr: 'Dupliquer', en: 'Duplicate' },
        'act.duplicate.tip': { fr: 'Crée une copie dans ton dossier de skills, sous un nom libre', en: 'Makes a copy in your skills folder, under a free name' },
        'act.delete': { fr: 'Supprimer', en: 'Delete' },
        'act.delete.tip': { fr: 'Supprime le dossier du skill (après confirmation)', en: 'Deletes the skill\'s folder (after you confirm)' },
        'act.readonly': { fr: 'Ce skill est en lecture seule : tu peux l\'ouvrir ou le dupliquer, pas le supprimer.', en: 'This skill is read-only: you can open or duplicate it, not delete it.' },
        'del.title': { fr: 'Supprimer « {name} » ?', en: 'Delete “{name}”?' },
        'del.body': { fr: 'Le dossier {path} et tout ce qu\'il contient sont supprimés pour de bon. Il n\'y a pas de corbeille : cela ne peut pas être annulé.', en: 'The folder {path} and everything in it are deleted for good. There is no trash: this cannot be undone.' },
        'del.deleting': { fr: 'Suppression…', en: 'Deleting…' },
        'notice.deleted': { fr: '« {name} » supprimé.', en: '“{name}” deleted.' },
        'notice.duplicated': { fr: '« {name} » dupliqué : « {copy} » est dans ton dossier de skills.', en: '“{name}” duplicated: “{copy}” is in your skills folder.' },
        'notice.opened': { fr: 'Ouvert sur cet ordinateur.', en: 'Opened on this computer.' },
        'dp.folder': { fr: 'Dossier dans le dépôt', en: 'Folder in the repository' },
        'dp.folderUnknown': { fr: 'trouvé par son frontmatter à l\'installation', en: 'found by its frontmatter when installing' },
        'dp.root': { fr: 'racine du dépôt', en: 'repository root' },
        'dp.loading': { fr: 'Lecture du dépôt sur GitHub…', en: 'Reading the repository on GitHub…' },
        'dp.start': { fr: 'Début de SKILL.md', en: 'Start of SKILL.md' },
        'dp.notfound': { fr: 'Aucun dossier « {name} » dans le dépôt : l\'installation cherche, dans toute l\'archive, le skill dont le frontmatter porte ce nom.', en: 'No “{name}” folder in the repository: the install looks, in the whole archive, for the skill whose frontmatter carries that name.' },
        'dp.nopreview': { fr: 'Aperçu indisponible : {why}', en: 'Preview unavailable: {why}' },
        'dp.viewgh': { fr: 'Voir sur GitHub', en: 'View on GitHub' },
        'ic.title': { fr: 'Installer « {name} » ?', en: 'Install “{name}”?' },
        'ic.repo': { fr: 'Dépôt', en: 'Repository' },
        'ic.folder': { fr: 'Dossier dans l\'archive', en: 'Folder in the archive' },
        'ic.dest': { fr: 'Copié vers', en: 'Copied to' },
        'ic.after': { fr: 'Tu pourras le désactiver ou le supprimer depuis « Yours ».', en: 'You can switch it off or delete it from “Yours”.' },
        'cap.detail': { fr: 'fiche du skill', en: 'skill details' },
        'cap.yours': { fr: 'installés dans ce profil · {a} actifs sur {n}', en: 'installed in this profile · {a} of {n} active' },
        'cap.search': { fr: 'index skills.sh · recherche sur nom et description', en: 'skills.sh index · search by name and description' },
        'cap.rank': { fr: 'index skills.sh · classement par installations', en: 'skills.sh index · ranked by installs' },
        'm.defroot': { fr: 'racine par défaut de l\'hôte', en: 'host default root' },
        'm.willCreate': { fr: '(sera créée)', en: '(will be created)' },
        'm.createSub': { fr: 'Le fichier est la seule source : un dossier et un SKILL.md valide, découverts au prochain rafraîchissement.', en: 'The file is the only source: a folder and a valid SKILL.md, picked up at the next refresh.' },
        'm.name': { fr: 'Nom (minuscules, chiffres, tirets)', en: 'Name (lowercase, digits, hyphens)' },
        'm.nameph': { fr: 'mon-skill', en: 'my-skill' },
        'm.desc': { fr: 'Description — dit à l\'agent QUAND charger ce skill', en: 'Description — tells the agent WHEN to load this skill' },
        'm.when': { fr: 'Quand l\'utiliser (optionnel)', en: 'When to use it (optional)' },
        'm.content': { fr: 'Contenu (optionnel)', en: 'Content (optional)' },
        'm.contentph': { fr: '# Étapes\n\n1. …', en: '# Steps\n\n1. …' },
        'm.quiet': { fr: 'Ne pas l\'annoncer au modèle : il reste invocable par « /{n} », mais ne coûte aucun jeton tant qu\'il n\'est pas chargé.', en: 'Do not announce it to the model: it stays invocable via “/{n}”, but costs no tokens until loaded.' },
        'm.nameWord': { fr: 'nom', en: 'name' },
        'm.cancel': { fr: 'Annuler', en: 'Cancel' },
        'm.creating': { fr: 'Création…', en: 'Creating…' },
        'm.createBtn': { fr: 'Créer le skill', en: 'Create skill' },
        'm.importTitle': { fr: 'Importer un skill depuis GitHub', en: 'Import a skill from GitHub' },
        'm.importSub': { fr: 'Le dépôt public est téléchargé, le dossier du skill est trouvé par son frontmatter, puis copié — jamais lié.', en: 'The public repo is downloaded, the skill folder is found through its frontmatter, then copied — never linked.' },
        'm.repo': { fr: 'Dépôt (owner/repo)', en: 'Repository (owner/repo)' },
        'm.examples': { fr: 'exemples : anthropics/skills · microsoft/playwright-cli · vercel-labs/skills', en: 'examples: anthropics/skills · microsoft/playwright-cli · vercel-labs/skills' },
        'm.skillInRepo': { fr: 'Nom du skill dans ce dépôt', en: 'Skill name in this repo' },
        'm.destRoot': { fr: 'Racine de destination', en: 'Destination root' },
        'm.downloading': { fr: 'Téléchargement…', en: 'Downloading…' },
        // ── Team skills (docs/dev/team-skills-contract.md) ──
        'cap.team': { fr: 'Les skills que ton équipe a approuvés, partagés avec tous les membres de {ws}.', en: 'Skills your team approved, shared with every member of {ws}.' },
        'tm.v.approved': { fr: 'Approuvés', en: 'Approved' },
        'tm.v.mine': { fr: 'Mes propositions', en: 'My proposals' },
        'tm.v.review': { fr: 'À valider', en: 'To review' },
        'tm.v.retired': { fr: 'Retirés', en: 'Retired' },
        'tm.who.member': { fr: '{ws} · tu es membre · un admin valide ce que tu proposes', en: '{ws} · you are a member · an admin approves what you propose' },
        'tm.who.admin': { fr: '{ws} · tu es admin · les membres ne voient pas encore ce qui est à valider', en: '{ws} · you are an admin · members do not see the review queue yet' },
        'tm.search': { fr: 'Chercher dans les skills de l’équipe', en: 'Search team skills' },
        'tm.propose': { fr: 'Proposer un skill', en: 'Propose a skill' },
        'tm.add': { fr: 'Ajouter un skill', en: 'Add a skill' },
        'tm.th.skill': { fr: 'Skill', en: 'Skill' },
        'tm.th.by': { fr: 'Ajouté par', en: 'Added by' },
        'tm.th.version': { fr: 'Version', en: 'Version' },
        'tm.install': { fr: 'Installer', en: 'Install' },
        'tm.update': { fr: 'Mettre à jour', en: 'Update' },
        'tm.installed': { fr: 'Installé', en: 'Installed' },
        'tm.own': { fr: 'Tu as le tien', en: 'You have your own' },
        'tm.edited': { fr: 'modifié ici', en: 'edited here' },
        'tm.newer': { fr: 'plus récent : {v}', en: 'newer: {v}' },
        'tm.withdraw': { fr: 'Retirer ma proposition', en: 'Withdraw' },
        'tm.retire': { fr: 'Retirer de l’équipe', en: 'Retire from the team' },
        'tm.st.proposed': { fr: 'En attente', en: 'Pending' },
        'tm.st.approved': { fr: 'Approuvé', en: 'Approved' },
        'tm.st.rejected': { fr: 'Refusé', en: 'Rejected' },
        'tm.st.retired': { fr: 'Retiré', en: 'Retired' },
        'tm.loading': { fr: 'Chargement des skills de l’équipe…', en: 'Loading the team’s skills…' },
        'tm.empty.approved': { fr: 'Aucun skill approuvé pour l’instant', en: 'No approved skill yet' },
        'tm.empty.approvedHint': { fr: 'Propose-en un : un admin le valide, puis tout le monde peut l’installer.', en: 'Propose one: an admin reviews it, then everyone can install it.' },
        'tm.empty.mine': { fr: 'Tu n’as rien proposé', en: 'You have not proposed anything' },
        'tm.empty.mineHint': { fr: 'Choisis l’un de tes skills et propose-le à l’équipe.', en: 'Pick one of your skills and propose it to the team.' },
        'tm.empty.review': { fr: 'Rien à valider', en: 'Nothing to review' },
        'tm.empty.reviewHint': { fr: 'Les nouvelles propositions apparaissent ici.', en: 'New proposals show up here.' },
        'tm.empty.retired': { fr: 'Rien n’a été retiré', en: 'Nothing has been retired' },
        'tm.empty.retiredHint': { fr: 'Un skill retiré reste dans l’historique, mais plus personne ne peut l’installer.', en: 'A retired skill stays in the history, but nobody can install it any more.' },
        'tm.lock.plan.t': { fr: 'Les skills d’équipe font partie du plan Team', en: 'Team skills are part of the Team plan' },
        'tm.lock.plan.b': { fr: 'Partage des skills avec les personnes avec qui tu travailles : un membre en propose un, un admin l’approuve, tout le monde l’installe. Tes propres skills restent privés dans Yours.', en: 'Share skills with the people you work with: any member proposes one, an admin approves it, everyone installs it. Your own skills stay private in Yours.' },
        'tm.lock.signin.t': { fr: 'Connecte-toi à Kybernos Cloud pour utiliser les skills d’équipe', en: 'Sign in to Kybernos Cloud to use Team skills' },
        'tm.lock.signin.b': { fr: 'Les skills d’équipe vivent dans l’espace de ton équipe. Connecte ton compte depuis le menu du compte, puis reviens ici.', en: 'Team skills live in your team’s workspace. Connect your account from the account menu, then come back.' },
        'tm.lock.space.t': { fr: 'Passe sur un espace d’équipe', en: 'Switch to a team workspace' },
        'tm.lock.space.b': { fr: 'Les skills d’équipe appartiennent à un espace d’équipe. Ton espace actif n’en est pas un.', en: 'Team skills belong to a team workspace. Your active workspace is not one.' },
        'tm.lock.server.t': { fr: 'Indisponible sur ce serveur', en: 'Not available on this server' },
        'tm.lock.server.b': { fr: 'Ce serveur Kybernos ne propose pas les skills d’équipe.', en: 'This Kybernos server does not offer Team skills.' },
        'tm.lock.reconnect.t': { fr: 'Ta session Kybernos a expiré', en: 'Your Kybernos session has expired' },
        'tm.lock.reconnect.b': { fr: 'Reconnecte ton compte, puis rouvre cet onglet.', en: 'Reconnect your account, then reopen this tab.' },
        'tm.lock.net.t': { fr: 'Le serveur de l’équipe est injoignable', en: 'The team server cannot be reached' },
        'tm.lock.net.b': { fr: 'Vérifie ta connexion, puis réessaie.', en: 'Check your connection, then try again.' },
        'tm.lock.other.t': { fr: 'Les skills d’équipe ne répondent pas', en: 'Team skills are not answering' },
        'tm.retry': { fr: 'Réessayer', en: 'Try again' },
        'tm.back': { fr: 'Retour à Yours', en: 'Back to Yours' },
        'tm.seePlan': { fr: 'Voir le plan Team', en: 'See the Team plan' },
        'tm.det.back': { fr: 'Skills d’équipe', en: 'Team skills' },
        'tm.det.approvedBy': { fr: 'Ajouté par {a} le {d}, approuvé par {r}.', en: 'Added by {a} on {d}, approved by {r}.' },
        'tm.det.proposedBy': { fr: 'Proposé par {a} le {d}.', en: 'Proposed by {a} on {d}.' },
        'tm.det.files': { fr: 'Ce qui sera copié', en: 'What gets copied' },
        'tm.det.count': { fr: '{n} fichiers · {size}', en: '{n} files · {size}' },
        'tm.det.count.1': { fr: '1 fichier · {size}', en: '1 file · {size}' },
        'cap.teamLocked': { fr: 'Les skills partagés par ton équipe.', en: 'Skills shared by your team.' },
        'tm.det.entry': { fr: 'entrée', en: 'entry' },
        'tm.det.pick': { fr: 'Choisis un fichier pour le lire.', en: 'Pick a file to read it.' },
        'tm.det.loading': { fr: 'Chargement des fichiers…', en: 'Loading the files…' },
        'tm.det.into': { fr: 'Dans', en: 'Into' },
        'tm.det.checks': { fr: 'Vérifié avant toute écriture', en: 'Checked before anything is written' },
        'tm.det.chk1': { fr: 'Les fichiers donnent la version {v}, celle que ton admin a approuvée', en: 'The files hash to version {v}, the one your admin approved' },
        'tm.det.chk2': { fr: 'Chaque chemin reste dans le dossier du skill', en: 'Every path stays inside the skill folder' },
        'tm.det.chk3': { fr: 'Fichiers texte seulement, aucun secret', en: 'Text files only, no secret' },
        'tm.det.never': { fr: 'Si un skill de ce nom existe déjà à cet endroit, rien n’est écrasé : on te le dit, et tu choisis.', en: 'If a skill with this name already exists there, nothing is overwritten: you are told, and you choose.' },
        'tm.det.updateNote': { fr: 'Cela remplace ta version installée ({old}), car tu ne l’as pas modifiée.', en: 'This replaces your installed version ({old}), because you have not edited it.' },
        'tm.det.editedNote': { fr: 'Tu as modifié ce skill ici : il ne sera pas remplacé. Mets tes changements de côté, puis mets à jour.', en: 'You edited this skill here, so it will not be replaced. Move your changes aside, then update.' },
        'tm.det.ownNote': { fr: 'Tu as déjà un skill de ce nom qui ne vient pas de l’équipe : il ne sera pas touché. Renomme-le ou supprime-le pour installer celui de l’équipe.', en: 'You already have a skill with this name that is not from the team: it will not be touched. Rename or remove it to install the team’s.' },
        'tm.det.installedNote': { fr: 'Cette version est déjà installée.', en: 'This version is already installed.' },
        'tm.det.notApproved': { fr: 'Ce skill n’est pas (ou plus) approuvé : il ne peut pas être installé.', en: 'This skill is not (or no longer) approved: it cannot be installed.' },
        'tm.det.retireAsk': { fr: 'Retirer « {name} » ? Ceux qui l’ont installé gardent leur copie, personne d’autre ne pourra l’installer.', en: 'Retire “{name}”? Members who installed it keep their copy, nobody else can install it.' },
        'tm.det.retireYes': { fr: 'Retirer', en: 'Retire' },
        'tm.script': { fr: 'contient un script', en: 'contains a script' },
        'tm.p.title': { fr: 'Proposer un skill à {ws}', en: 'Propose a skill to {ws}' },
        'tm.p.titleAdmin': { fr: 'Ajouter un skill à {ws}', en: 'Add a skill to {ws}' },
        'tm.p.sub': { fr: 'Un admin le relit avant que quiconque puisse l’installer. Ta copie reste exactement telle quelle.', en: 'An admin reviews it before anyone can install it. Your own copy stays exactly as it is.' },
        'tm.p.subAdmin': { fr: 'En tant qu’admin, ton skill est disponible pour tous les membres tout de suite. Ta copie reste exactement telle quelle.', en: 'As an admin, your skill is available to every member right away. Your own copy stays exactly as it is.' },
        'tm.p.pick': { fr: 'Skill', en: 'Skill' },
        'tm.p.choose': { fr: 'Choisis l’un de tes skills', en: 'Choose one of your skills' },
        'tm.p.none': { fr: 'Aucun de tes skills ne peut être partagé : seuls ceux de tes dossiers (~/.dsh/skills, ~/.agents/skills) peuvent être proposés.', en: 'None of your skills can be shared: only skills of your own folders (~/.dsh/skills, ~/.agents/skills) can be proposed.' },
        'tm.p.packing': { fr: 'Lecture du skill…', en: 'Reading the skill…' },
        'tm.p.send': { fr: 'Ce qui sera envoyé', en: 'What will be sent' },
        'tm.p.checks': { fr: 'Contrôles', en: 'Checks' },
        'tm.p.ck.name': { fr: 'Nom valide', en: 'Name valid' },
        'tm.p.ck.text': { fr: 'Fichiers texte seulement', en: 'Text files only' },
        'tm.p.ck.secret': { fr: 'Aucun secret trouvé', en: 'No secret found' },
        'tm.p.ck.size': { fr: '{n} fichiers sur 50 · {kb} Ko sur 1 Mo', en: '{n} of 50 files · {kb} KB of 1 MB' },
        'tm.p.note': { fr: 'Note pour l’admin (facultatif)', en: 'Note for the admin (optional)' },
        'tm.p.noteAdmin': { fr: 'Note (facultatif)', en: 'Note (optional)' },
        'tm.p.submit': { fr: 'Proposer à l’équipe', en: 'Propose to the team' },
        'tm.p.submitAdmin': { fr: 'Ajouter à l’équipe', en: 'Add to the team' },
        'tm.p.sending': { fr: 'Envoi…', en: 'Sending…' },
        'tm.p.foot': { fr: 'Les mêmes contrôles sont refaits sur le serveur : un skill qui passe ici ne sera pas refusé plus tard pour ces raisons.', en: 'The same checks run again on the server, so a skill that passes here cannot be refused later for these reasons.' },
        'tm.p.bad.secret': { fr: '{file}, ligne {line} : cela ressemble à une clé ou un jeton secret. Retire-le du fichier, puis propose à nouveau. La clé elle-même n’est jamais affichée ni envoyée.', en: '{file}, line {line}: this looks like a secret key or token. Remove it from the file, then propose again. The key itself is never shown or sent.' },
        'tm.p.bad.binary': { fr: '{file} : seuls les fichiers texte peuvent être partagés. Retire-le, ou mentionne-le dans SKILL.md.', en: '{file}: only text files can be shared. Remove it, or mention it in SKILL.md instead.' },
        'tm.p.bad.big': { fr: '{file} dépasse 256 Ko.', en: '{file} is over 256 KB.' },
        'tm.p.bad.many': { fr: 'Plus de 50 fichiers.', en: 'More than 50 files.' },
        'tm.p.bad.total': { fr: 'Plus de 1 Mo au total.', en: 'Over 1 MB in total.' },
        'tm.p.bad.path': { fr: '{file} : ce nom de fichier ne peut pas être partagé (lettres, chiffres, - _ . et / seulement ; pas de nom que Windows ne sait pas écrire, pas deux noms qui ne diffèrent que par la casse, pas un fichier qui est aussi un dossier).', en: '{file}: this file name cannot be shared (letters, digits, - _ . and / only; no name Windows cannot write, no two names that differ only by case, no file that is also a folder).' },
        'tm.p.bad.frontmatter': { fr: 'SKILL.md doit porter le même nom que le dossier et une description.', en: 'SKILL.md needs a name that matches the folder and a description.' },
        'tm.p.bad.description': { fr: 'La description de SKILL.md contient un caractère qui ne peut pas être enregistré.', en: 'The description in SKILL.md holds a character that cannot be stored.' },
        'tm.p.bad.name': { fr: 'Le nom du skill n’est pas valide.', en: 'The skill name is not valid.' },
        'tm.p.bad.nofile': { fr: 'Il manque un fichier SKILL.md.', en: 'There is no SKILL.md.' },
        'tm.p.bad.disabled': { fr: 'Active d’abord le skill.', en: 'Turn the skill on first.' },
        'tm.p.bad.other': { fr: 'Ce skill ne peut pas être partagé ({code}).', en: 'This skill cannot be shared ({code}).' },
        'tm.n.proposed': { fr: 'Proposé à l’équipe. Un admin relira « {name} ».', en: 'Proposed to the team. An admin will review “{name}”.' },
        'tm.n.added': { fr: '« {name} » est maintenant disponible pour l’équipe.', en: '“{name}” is now available to the team.' },
        'tm.n.installed': { fr: '« {name} » installé ({n} fichiers).', en: '“{name}” installed ({n} files).' },
        'tm.n.installed.1': { fr: '« {name} » installé (1 fichier).', en: '“{name}” installed (1 file).' },
        'tm.n.updated': { fr: '« {name} » mis à jour.', en: '“{name}” updated.' },
        'tm.n.approved': { fr: '« {name} » approuvé.', en: '“{name}” approved.' },
        'tm.n.rejected': { fr: '« {name} » refusé.', en: '“{name}” rejected.' },
        'tm.n.retired': { fr: '« {name} » retiré de l’équipe.', en: '“{name}” retired from the team.' },
        'tm.n.withdrawn': { fr: 'Proposition retirée.', en: 'Proposal withdrawn.' },
        'tm.e.admin_required': { fr: 'Seul un admin peut faire cela.', en: 'Only an admin can do that.' },
        'tm.e.duplicate': { fr: 'Ce skill est déjà proposé ou approuvé.', en: 'This skill is already proposed or approved.' },
        'tm.e.team_full': { fr: 'L’équipe a déjà le nombre maximal de skills.', en: 'The team already has the maximum number of skills.' },
        'tm.e.too_many_proposals': { fr: 'Tu as déjà le nombre maximal de propositions en attente.', en: 'You already have the maximum number of proposals waiting.' },
        'tm.e.too_large': { fr: 'Le skill est trop volumineux.', en: 'The skill is too large.' },
        'tm.e.not_pending': { fr: 'Quelqu’un a décidé avant toi. La liste a été rafraîchie.', en: 'Someone decided before you. The list has been refreshed.' },
        'tm.e.not_approved': { fr: 'Ce skill n’est plus approuvé.', en: 'It is not approved any more.' },
        'tm.e.skill_not_found': { fr: 'Ce skill n’existe plus.', en: 'This skill no longer exists.' },
        'tm.e.reconnect_required': { fr: 'Ta session Kybernos a expiré : reconnecte ton compte.', en: 'Your Kybernos session has expired: reconnect your account.' },
        'tm.e.network': { fr: 'Le serveur de l’équipe est injoignable.', en: 'The team server cannot be reached.' },
        'tm.e.workspace_not_found': { fr: 'Cet espace d’équipe n’est plus accessible.', en: 'This team workspace is no longer available.' },
        'tm.e.not_on_this_server': { fr: 'Ce serveur ne propose pas les skills d’équipe.', en: 'This server does not offer Team skills.' },
        'tm.e.forbidden': { fr: 'Le serveur a refusé.', en: 'The server refused.' },
        'tm.e.invalid_response': { fr: 'Réponse inattendue du serveur.', en: 'Unexpected answer from the server.' },
        'tm.e.invalid_skill': { fr: 'Le serveur refuse ce skill ({reason}).', en: 'The server refuses this skill ({reason}).' },
        'tm.e.scan_rejected': { fr: 'Le serveur a trouvé un secret dans {file}.', en: 'The server found a secret in {file}.' },
        'tm.e.exists': { fr: 'Un skill de ce nom est déjà dans ce dossier. Rien n’a été modifié.', en: 'A skill with this name is already in this folder. Nothing was changed.' },
        'tm.e.version_mismatch': { fr: 'Les fichiers ne correspondent pas à la version approuvée. Rien n’a été écrit.', en: 'The files do not match the approved version. Nothing was written.' },
        'tm.e.modified': { fr: 'Tu as modifié ce skill ici : il n’a pas été remplacé.', en: 'You edited this skill here, so it was not replaced.' },
        'tm.e.root_not_allowed': { fr: 'Ce dossier n’est pas l’un de tes dossiers de skills.', en: 'That folder is not one of your skills folders.' },
        'tm.e.write_failed': { fr: 'Impossible d’écrire le skill. Rien n’a été modifié.', en: 'Could not write the skill. Nothing was changed.' },
        'tm.e.conflict': { fr: 'Le serveur ne peut pas faire cela maintenant.', en: 'The server cannot do that right now.' },
        'tm.e.bad_request': { fr: 'Le serveur n’a pas compris la demande.', en: 'The server did not understand the request.' },
        'tm.e.skill_ambiguous': { fr: 'Deux skills portent ce nom dans ce dossier.', en: 'Two skills with this name exist in that folder.' },
        'tm.e.other': { fr: 'Échec ({code}).', en: 'Failed ({code}).' },
        'tm.r.banner': { fr: 'Un skill est une instruction que les agents de tes membres suivront, et il peut venir avec des fichiers. Ouvre les fichiers avant d’approuver. Une approbation ne se modifie pas : refuse avec une note pour demander un changement.', en: 'A skill is an instruction your members’ agents will follow, and it can come with files. Open the files before you approve. An approval cannot be edited: reject with a note to ask for a change.' },
        'tm.r.new': { fr: 'Nouveau', en: 'New' },
        'tm.r.updateOf': { fr: 'Mise à jour', en: 'Update' },
        'tm.r.replaces': { fr: 'Approuver remplace la version que les membres peuvent installer aujourd’hui ({v}). Ceux qui l’ont installée verront « Mettre à jour ».', en: 'Approving replaces the version members can install today ({v}). Members who installed it see “Update”.' },
        'tm.r.by': { fr: 'Proposé par {a} · {d}', en: 'Proposed by {a} · {d}' },
        'tm.r.approve': { fr: 'Approuver', en: 'Approve' },
        'tm.r.reject': { fr: 'Refuser…', en: 'Reject…' },
        'tm.r.rejectNote': { fr: 'Pourquoi ? (le proposeur le verra)', en: 'Why? (the proposer will see it)' },
        'tm.r.rejectYes': { fr: 'Refuser', en: 'Reject' },
        'tm.r.changed': { fr: 'modifié', en: 'changed' },
        'tm.r.fnew': { fr: 'nouveau', en: 'new' },
        'tm.r.removed': { fr: 'supprimé', en: 'removed' },
        'tm.r.scan': { fr: 'Contrôlé par le serveur : aucun secret · {n} fichiers · {kb} Ko', en: 'Checked by the server: no secret · {n} files · {kb} KB' },
        'tm.r.scan.1': { fr: 'Contrôlé par le serveur : aucun secret · 1 fichier · {kb} Ko', en: 'Checked by the server: no secret · 1 file · {kb} KB' },
        'tm.r.tooBig': { fr: 'Trop long pour une comparaison ligne à ligne.', en: 'Too long to compare line by line.' },
        'tm.r.rejectedWith': { fr: 'Refusé : {note}', en: 'Rejected: {note}' },
        'tm.r.noNote': { fr: 'Refusé, sans note.', en: 'Rejected, no note.' },
        // The animated help of the page (window.__KB_HELP__.Intro): what it says, and the words of its little mock.
        'intro.title': { fr: 'Les skills en trois étapes', en: 'Skills in three steps' },
        'intro.caption': { fr: 'Un skill est choisi dans Featured, installé en un clic, puis listé dans Yours.', en: 'A skill is picked in Featured, installed with one click, then listed under Yours.' },
        'intro.s1t': { fr: 'Choisis', en: 'Pick one' },
        'intro.s1b': { fr: 'Featured montre nos choix et ce que disent leurs audits de sécurité. Discover classe les skills publics.', en: 'Featured shows our picks and what their security audits said. Discover ranks the public ones.' },
        'intro.s2t': { fr: 'Installe', en: 'Install it' },
        'intro.s2b': { fr: 'Un clic, puis confirme. Le skill est copié sur cet ordinateur.', en: 'One click, then confirm. The skill is copied to this computer.' },
        'intro.s3t': { fr: 'Laisse tes agents s’en servir', en: 'Let your agents use it' },
        'intro.s3b': { fr: 'Il apparaît dans Yours. Tes agents le chargent quand ta demande lui correspond.', en: 'It is listed under Yours. Your agents load it when your request fits it.' },
        'intro.m.row': { fr: 'Notes de réunion', en: 'Meeting notes' },
        'intro.m.hot': { fr: 'Rapport hebdo', en: 'Weekly report' },
        'intro.m.st1': { fr: 'Featured', en: 'Featured' },
        'intro.m.st2': { fr: 'Installation…', en: 'Installing…' },
        'intro.m.st3': { fr: 'Installé', en: 'Installed' },
        'intro.m.open': { fr: 'Ouvrir', en: 'Open' },
      }
      // Language: what Kybernos resolved. « kybernos » (the French of the product) or fr* is French; every other language, translated
      // or not, and anything unresolved reads English. Read at call time.
      const tlang = () => {
        try {
          const l = String(window.__KB_LANG_RESOLVE__())
          return l === 'kybernos' || l.split(/[-_]/)[0] === 'fr' ? 'fr' : 'en'
        } catch (e) { return 'en' }
      }
      // ── skills learned from experience (docs/dev/learned-skills.md) ──────────────────────────────────────────────────────────────
      // Kaby's suggestions wait on the host, in a ledger and not in the skills folder: nothing is active before Accept. The sidebar dot needs their
      // count whatever page is open, so a light poll starts with the bundle and publishes `window.__KB_LEARNED__` ({ count, subscribe, refresh }),
      // which the menu (kybernos-plugin) and the lessons page (kybernos-memory) read. A host without the route leaves it at 0.
      const kbLearnedStore = { n: 0, subs: new Set() }
      const kbLearnedSet = (n) => {
        if (kbLearnedStore.n === n) return
        kbLearnedStore.n = n
        kbLearnedStore.subs.forEach((f) => { try { f(n) } catch (e) { /* a listener must not break the others */ } })
      }
      // What waits for the person: the suggestions, and the changes Kaby made on its own that are not reviewed yet (Keep or Undo).
      const kbLearnedCount = (j) => j.proposals.length + (Array.isArray(j.learned) ? j.learned.filter((l) => l.auto === true && l.reviewed === false).length : 0)
      const kbLearnedPoll = () => fetch('/kybernos-skills/learned', { headers: { accept: 'application/json' } }).then((r) => r.json())
        .then((j) => { if (j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.proposals)) kbLearnedSet(kbLearnedCount(j)) }).catch(() => null)
      try {
        window.__KB_LEARNED__ = { count: () => kbLearnedStore.n, subscribe: (fn) => { kbLearnedStore.subs.add(fn); return () => { kbLearnedStore.subs.delete(fn) } }, refresh: kbLearnedPoll }
        setTimeout(kbLearnedPoll, 3000)
        setInterval(kbLearnedPoll, 300000)
        window.addEventListener('focus', kbLearnedPoll)
      } catch (e) { /* no window: nothing to publish to */ }
      const PH = { email: '[email]', phone: '[phone]', date: '[date]', name: '[client]' }
      /** A text with the client data the host found (`hits`, offsets into description + newline + body) replaced by placeholders; `base` is where `text` starts. */
      const scrub = (text, hits, base) => {
        let out = ''
        let at = 0
        hits.filter((x) => x.s >= base && x.e <= base + text.length).forEach((x) => { out += text.slice(at, x.s - base) + (PH[x.kind] || '[…]'); at = x.e - base })
        return out + text.slice(at)
      }

      const isEn = () => tlang() === 'en'
      // Text separator, locale-aware: French ' : ', English ': '.
      const sep = () => (isEn() ? ': ' : ' : ')
      // A row can have a « .1 » twin (« 1 file »): it is used when the count {n} is 1.
      const t = (key, vars) => {
        const k = vars !== null && vars !== undefined && vars.n !== undefined && String(vars.n) === '1' && STR[key + '.1'] !== undefined ? key + '.1' : key
        const row = STR[k]
        if (row === null || row === undefined) return key
        const out = tlang() === 'fr' ? row.fr : (row.en !== null && row.en !== undefined ? row.en : row.fr)
        if (vars === null || vars === undefined) return out
        return out.replace(/\{(\w+)\}/g, (m, k2) => (vars[k2] === undefined ? m : String(vars[k2])))
      }
      const PAGE = 6
      // Rows of the Discover ranking per page by default (the user can ask for more in the filters).
      const DISC_PER = 20

      // ── skeleton screens ──────────────────────────────────────────────────────────────────────
      // ONE helper for every list of the GUI, published by the core plugin (window.__KB_SKEL__): bones in the SAME boxes as the
      // real rows (same classes: nothing moves when the data lands), a soft shimmer, a short fade-in for the real rows, and no
      // motion under prefers-reduced-motion. Read at render time and optional: without the core, a list says « Loading… » as before.
      const skel = () => {
        try {
          const k = window.__KB_SKEL__
          return (k !== null && k !== undefined && typeof k.bone === 'function' && typeof k.wrap === 'function') ? k : null
        } catch (e) { return null }
      }
      const bone = (w, hgt, extra, radius) => { const k = skel(); return k === null ? null : k.bone(w, hgt, extra, radius) }
      // The class suffix that fades the i-th real row in (first screenful only).
      const appear = (i) => { const k = skel(); return k !== null && typeof k.appear === 'function' ? k.appear(i) : '' }
      // `kind`: 'cards' (Yours), 'rows' (the ranking), 'team' (the team table). Null when the core's helper is not there.
      const skeletonOf = (kind, n) => {
        const k = skel()
        if (k === null) return null
        const idx = Array.from({ length: n }, (_, i) => i)
        if (kind === 'cards') {
          return k.wrap(t('y.loading'), '', h('div', { className: 'kb8-grid' }, idx.map((i) => h('div', { key: 'sk' + i, className: 'kb8-card static kb-sk-row' },
            h('div', { className: 'kb-row', style: { minHeight: 40, flexWrap: 'nowrap' } },
              bone(38, 38, null, 13),
              h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0, gap: '6px', flex: '1' } }, bone(i % 2 === 0 ? '55%' : '40%', 13), bone('45%', 10)),
              bone(36, 20, 'pill'), bone(26, 26, 'round')),
            h('div', { className: 'desc', style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '9px', height: 61, minHeight: 61 } }, bone('94%', 10), bone('82%', 10), bone('58%', 10)),
            h('div', { className: 'kb8-pills', style: { height: 26, alignItems: 'center' } }, bone(52, 20, 'pill')),
            h('div', { className: 'foot', style: { height: 33, boxSizing: 'border-box' } }, bone(14, 14, 'round'), bone(110, 10), h('span', { className: 'grow' }), bone(72, 22, 'pill'))))))
        }
        if (kind === 'team') {
          return k.wrap(t('tm.loading'), 'kbs-table kbt', [
            h('div', { key: 'hd', className: 'kbt-head' }, h('span', null), h('span', null, t('tm.th.skill')), h('span', null, t('tm.th.by')), h('span', null, t('tm.th.version')), h('span', null)),
            idx.map((i) => h('div', { key: 'r' + i, className: 'kbs-row kb-sk-row' },
              h('span', { className: 'who' }, bone(30, 30, null, 10)),
              h('span', { className: 'kbt-name' }, bone(i % 2 === 0 ? '46%' : '34%', 13), bone('70%', 10)),
              h('span', { className: 'kbt-by' }, bone('60%', 11), bone('40%', 10)),
              h('span', { className: 'badges' }, bone(54, 20, 'pill')),
              h('span', { className: 'kbt-act' }, bone(80, 30, null, 9))))])
        }
        return k.wrap(t('d.query'), 'kbs-table', [
          h('div', { key: 'hd', className: 'kbs-head' },
            h('span', { className: 'rank' }, '#'), h('span', { className: 'who' }, 'Skill'), h('span', { className: 'src' }, 'Source'),
            h('span', { className: 'badges' }, t('th.state')), h('span', { className: 'inst' }, 'Installations')),
          idx.map((i) => h('div', { key: 'r' + i, className: 'kbs-row kb-sk-row' },
            h('span', { className: 'rank' }, bone(18, 10)),
            h('span', { className: 'who' }, bone(30, 30, null, 10), bone(i % 3 === 0 ? '55%' : (i % 3 === 1 ? '40%' : '48%'), 13)),
            h('span', { className: 'src' }, bone('62%', 11)),
            h('span', { className: 'badges' }, bone(50, 20, 'pill')),
            h('span', { className: 'inst' }, bone(36, 11))))])
      }

      const CSS = `
.kbs-root{display:flex;flex-direction:column;flex:1;min-height:0}
/* Third exception to the mockup (see header): the Yours/Discover banner
   was drawn full-frame, with its own margins (22 px) and its own
   scale (46 squares, 43 primary button, 52 core-plugin search). The page is
   already laid out by .kbg-root (30/34 px) and its tabs are 28 px .kb4-tab
   elements: we line up with them — same column, same pill, same scale. */
.kbs-root{gap:16px}
.kbs-root .kbs-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex:0 0 auto}
.kbs-root .kbs-top-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.kbs-root .kbs-h1{margin:0;font-size:20px;line-height:1.3;font-weight:700;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}
.kbs-root .kbs-sub{margin:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);max-width:720px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbs-root .kbs-ctlrow{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;min-height:44px;position:relative}
.kbs-root .kbs-ctlrow .kb-toolbar{margin:0;flex:1 1 0;min-width:0;justify-content:flex-end}
.kbs-root .kbs-ctlrow .kb8-search{flex:0 1 260px}
.kbs-root .kbsub{flex:0 0 auto;display:flex;align-items:center;gap:12px;padding:0;box-sizing:content-box;background:transparent;border:none}
/* Sub-tab capsule identical to .kb7-subtabs (Connections): discreet container, active one as a raised card. */
.kbs-root .kbsub-group{display:inline-flex;align-items:center;gap:2px;padding:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.kbs-root .kbsub button.kb-seg{display:inline-flex;align-items:center;gap:8px;height:34px;border:0;border-radius:999px;padding:0 16px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.kbs-root .kbsub button.kb-seg:hover{color:var(--dsw-alias-label-primary)}
.kbs-root .kbsub button.kb-seg.on{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 3px rgba(20,20,19,.14)}
.kbs-root .kbsub .count{font-family:ui-monospace,monospace;font-size:11px;color:inherit;opacity:.95}
/* A phone (A5-05): four tabs with their counts need 395 px in a 332 px strip, and the strip slid sideways with « Team » out of
   sight and no hint that it was there. Tighter tabs and no counts (they are on the pages) need about 295 px: all four fit. */
@media (max-width:440px){
.kbs-root .kbsub button.kb-seg{padding:0 10px;gap:6px}
.kbs-root .kbsub .count{display:none}
}
.kbs-root .kbsub .kb8-mono{flex:1 1 0;min-width:0;text-align:end;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* The panel body is injected INSIDE .kbg-root, which already carries the page
   margins (30/34/40). It was taking those of .kb8-page (30/28/36): all the
   content was shifted by 28 px relative to the title and the tabs, and the
   useful column lost 56 px. We cancel these inner margins — the plugin's column
   then joins the page's column.
   The same selector also makes .kb8-page NON-scrolling, and that is deliberate.
   Measured on 21 Sep 2026, Resources tab > Skills, 1400x950 window: the
   panel is bounded by .kbg-root (950 px for 2816 px of content), but
   .kbs-root sits between the two WITHOUT constraining the height (its
   flex:1/min-height:0 assumes a flex parent, whereas .kbg-root is a block). The
   max-height:100% of .kb8-page then resolves against .kbs-root, which is as tall as all the
   content: .kb8-page is 2633 px for 2633 px, so it never overflows while
   remaining a scrolling container (overflow-y:auto). Combined with the
   overscroll-behavior:contain that the core plugin then set on .kb8-page, the
   wheel was consumed there and never bubbled up to .kbg-root: the panel did not
   scroll at all (0 px over 4 wheel notches, whereas the neighbouring Composio
   tab, which has no interposed .kb8-page, scrolled 600 px). We
   hand control back to the only real scroller, .kbg-root: gesture restored, rendering
   unchanged.
   Since then, the core plugin no longer sets contain on page bodies (scroll contract
   in kybernos-plugin/client.js): the gesture would therefore work even
   without this rule. It stays, for two reasons: removing a scrolling container
   that serves no purpose, and making the intent explicit where a future
   panel will sit between a page and its host. */
.kbs-root .kb8-page{padding:0;overflow:visible;max-height:none}
.kbs-root .kb8-h2{margin:0;font-size:16px;font-weight:600}
.kbs-root .kb8-mono{font-family:ui-monospace,monospace;font-size:11px;color:var(--dsw-alias-label-caption)}
.kbs-root .kb-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.kbs-root .kb-row.end{justify-content:flex-end}
.kbs-root .kb-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:14px}
.kbs-root .kb8-search{flex:1 1 220px;min-width:0;height:38px;box-sizing:border-box;border-radius:11px;padding:0 12px}
.kbs-root .kb8-search input{font-size:13px}
.kbs-root .kb8-search svg{color:var(--dsw-alias-label-caption);flex:0 0 auto}
.kbs-root .kb-tool{width:38px;height:38px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}
.kbs-root .kb-tool:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.kbs-root .kb-tool.on{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
/* LABELLED controls: same styling as the core plugin's .kb6-tb-filterbtn (38 px, radius 11, l1
   border, layer-1 background). The state — active filter, current sort, current view — is read on the button
   instead of being hidden behind a bare icon, as in the rest of the GUI. */
.kbs-root .kb-tool-lab{display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 14px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap;flex:0 0 auto}
.kbs-root .kb-tool-lab:hover,.kbs-root .kb-tool-lab.on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
.kbs-root .kb-tool-lab .n{min-width:16px;height:16px;padding:0 4px;box-sizing:border-box;border-radius:8px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);font-size:10.5px;font-weight:600;display:inline-flex;align-items:center;justify-content:center}
.kbs-root .kb8-ghost{display:inline-flex;align-items:center;gap:8px;height:38px;background:transparent;color:var(--dsw-alias-label-primary); border:1px solid var(--dsw-alias-border-l2);border-radius:11px;padding:0 15px;font:inherit;font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap}
.kbs-root .kb8-primary{height:38px;padding:0 14px;font-size:13px;border-radius:11px}
.kbs-root .kb8-ghost:hover{background:var(--dsw-alias-interactive-bg-hover)}
/* The filters panel followed the mockup as an INLINE CARD: when open, it pushed the
   list down by 145 px and only closed through its own button. The core plugin puts its
   filters in a popover anchored to the button (.kb6-tb-pop): we follow the same convention, while
   keeping the mockup's three rows (View, Rows, Source / State, Root). */
.kbs-root .kb-filters{position:absolute;right:0;top:calc(100% + 6px);z-index:60;display:flex;flex-direction:column;gap:10px;width:min(560px,calc(100vw - 56px));box-sizing:border-box;padding:10px 12px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:13px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 14px 34px rgba(0,0,0,.3)}
.kbs-root .kb-filters .head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 4px}
.kbs-root .kb-filters .head .t{font-family:ui-monospace,monospace;font-size:10px;color:var(--dsw-alias-label-secondary)}
.kbs-root .kb-filters .head .raz{border:none;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;cursor:pointer;padding:3px 6px;border-radius:7px}
.kbs-root .kb-filters .head .raz:hover{background:var(--dsw-alias-bg-layer-2)}
.kbs-root .kb-filter-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.kbs-root .kb-filter-row .lbl{font-size:12px;color:var(--dsw-alias-label-caption);min-width:74px}
.kbs-root .kb8-chip:not(.on):hover{background:var(--dsw-alias-interactive-bg-hover)}
/* Ranking table: one row per skill, not a card. This is what makes an index of
   9 827 rows browsable — fifty rows on screen, and a fixed pager instead of a
   "Load more" buried under 3 380 px of cards. */
/* Same tokens as the core plugin's .kb8-card: bg-layer-1, border-l1, radius 16 — the table must
   read like the other tabs, not like a raw table dropped next to them. */
.kbs-root .kbs-table{border:1px solid var(--dsw-alias-border-l1);border-radius:16px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.kbs-root .kbs-head,.kbs-root .kbs-row{display:grid;grid-template-columns:44px minmax(200px,1.6fr) minmax(130px,1fr) 150px 100px;align-items:center;gap:14px;padding:8px 18px}
.kbs-root .kbs-head{font-size:11px;font-weight:600;color:var(--dsw-alias-label-caption);border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.kbs-root .kbs-row{border-bottom:1px solid var(--dsw-alias-border-l1);cursor:pointer;transition:background .12s}
.kbs-root .kbs-row:last-child{border-bottom:none}
.kbs-root .kbs-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbs-root .kbs-row.has{box-shadow:inset 2px 0 0 var(--dsw-alias-state-success-primary)}
.kbs-root .kbs-row .rank{font-family:ui-monospace,monospace;font-size:12px;color:var(--dsw-alias-label-caption);text-align:right}
.kbs-root .kbs-row .who{display:flex;align-items:center;gap:11px;min-width:0}
.kbs-root .kbs-row .who .kb8-name{font-size:14px}
.kbs-root .kbs-row .src{overflow:hidden;text-overflow:ellipsis}
.kbs-root .kbs-row .badges{display:flex;gap:6px;flex-wrap:wrap}
.kbs-root .kbs-row .inst{font-family:ui-monospace,monospace;font-size:12.5px;color:var(--dsw-alias-label-secondary);text-align:right}
.kbs-root .kbs-instpill{display:inline-flex;align-items:center;gap:5px}
.kbs-root .kbs-rowinstall{height:28px;padding:0 10px;font-size:12px;gap:5px;border-radius:9px;display:inline-flex;align-items:center}
.kbs-root .kbs-sorthead{border:0;background:transparent;padding:0;margin:0;font:inherit;letter-spacing:inherit;text-transform:inherit;color:inherit;cursor:pointer;text-align:start;display:flex;align-items:center;gap:6px}
.kbs-root .kbs-sorthead.inst{justify-content:flex-end}
.kbs-root .kbs-sorthead:hover,.kbs-root .kbs-sorthead.on{color:var(--dsw-alias-label-primary)}
.kbs-root .kbs-sorthead .arr{font-size:12px}
/* ROW tile: row scale, same styling as .kb8-tile (38px / radius 13). */
.kbs-root .kb8-tile.kbs-sm{width:30px;height:30px;border-radius:10px}
/* A row is ~48 px tall: fifty fit in a tab's screen. */
/* A request in flight is visible, without making the previous page disappear. */
.kbs-root .kbs-table.loading{opacity:.55}
/* Pager: current page, total pages, and jumps. No more button at the bottom of a growing list. */
.kbs-root .kbs-pager{display:flex;align-items:center;justify-content:center;gap:8px;padding:12px 0 2px;flex-wrap:wrap}
.kbs-root .kbs-pager .pg{min-width:38px;height:38px;padding:0 9px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-family:ui-monospace,monospace;font-size:12.5px;cursor:pointer}
.kbs-root .kbs-pager .pg:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbs-root .kbs-pager .pg.on{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-label-primary-foreground);font-weight:600}
.kbs-root .kbs-pager .t{font-family:ui-monospace,monospace;font-size:11.5px;color:var(--dsw-alias-label-caption)}
/* Audit banner: the data that replaces "community, not audited". */
.kbs-root .kbs-audit{display:flex;flex-direction:column;gap:9px}
.kbs-root .kbs-audit .ligne{display:flex;align-items:flex-start;gap:9px;font-size:12.5px;line-height:1.45;color:var(--dsw-alias-label-secondary)}
.kbs-root .kb8-card.static{cursor:default}
.kbs-root .kb8-card.static:hover{transform:none;border-color:var(--dsw-alias-border-l1)}
.kbs-root .kb8-card .desc{font-size:13.5px;line-height:1.5;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;min-height:60px}
.kbs-root .kb8-card .foot{display:flex;align-items:center;gap:11px;font-size:12px;color:var(--dsw-alias-label-caption);border-top:1px solid var(--dsw-alias-border-l1);padding-top:11px}
.kbs-root .kb8-card .foot .grow{flex:1}
.kbs-root .kb8-tile.lg{width:54px;height:54px;border-radius:17px}
.kbs-root .kb8-pill.ok{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent)}
.kbs-root .kb8-pill.warn{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent)}
.kbs-root .kb8-pill.info{color:#9dbaff;background:color-mix(in srgb,#4d7cfe 20%,transparent)}
.kbs-root .kbs-ylist{display:flex;flex-direction:column;gap:8px}
.kbs-root .kbs-yrow{display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);cursor:pointer;min-width:0}
.kbs-root .kbs-yrow:hover{border-color:var(--dsw-alias-border-l2)}
.kbs-root .kbs-yrow.sel{border-color:var(--dsw-alias-brand-primary)}
.kbs-root .kbs-yrow .who{display:flex;flex-direction:column;gap:2px;min-width:0;flex:0 0 230px}
.kbs-root .kbs-yrow .desc{flex:1 1 0;min-width:0;font-size:12.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbs-root .kbs-yrow .when{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.kbs-root .kbs-yrow .acts{flex:none;display:flex;align-items:center;gap:8px}
.kbs-root .kb-sw{width:36px;height:20px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);position:relative;cursor:pointer;border:none;flex:0 0 auto;transition:background .15s}
.kbs-root .kb-sw i{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:transform .15s;display:block}
.kbs-root .kb-sw.on{background:var(--kybernos-accent,var(--dsw-alias-brand-primary,#4d7cfe))}
.kbs-root .kb-sw.on i{transform:translateX(16px);background:#fff}
.kbs-root .kb-back{display:inline-flex;align-items:center;gap:8px;background:none;border:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13.5px;cursor:pointer;padding:0;width:fit-content}
.kbs-root .kb-back:hover{color:var(--dsw-alias-label-primary)}
.kbs-root .kb-detail-head{display:flex;align-items:center;gap:16px}
.kbs-root .kb-detail-head .meta{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
.kbs-root .kb-cols{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:26px;align-items:start}
.kbs-root .kb-panel{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:16px;padding:16px 18px;display:flex;flex-direction:column;gap:12px}
.kbs-root .kb-panel .row{display:flex;align-items:center;gap:12px;font-size:13.5px;color:var(--dsw-alias-label-secondary)}
.kbs-root .kb-panel .row .ic{width:30px;height:30px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);flex:0 0 auto}
.kbs-root .kb-section-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-caption)}
.kbs-root .kb8-tab:hover{color:var(--dsw-alias-label-primary)}
.kbs-root .kb8-tab .n{font-family:ui-monospace,monospace;font-size:11px;color:var(--dsw-alias-label-caption)}
/* Local skill sheet (a Yours card opens it): its own head and rows, reusing the pivot's tokens. */
.kbs-root .kb-local-rows{display:flex;flex-direction:column;gap:10px}
.kbs-root .kb-local-rows .row{display:flex;gap:14px;align-items:baseline;font-size:13.5px;line-height:1.5;color:var(--dsw-alias-label-secondary);border-top:1px solid var(--dsw-alias-border-l1);padding-top:10px}
.kbs-root .kb-local-rows .row>span:first-child{min-width:120px;color:var(--dsw-alias-label-caption);flex:none}
.kbs-root .kb-local-body{margin:0;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px 14px;font-family:ui-monospace,monospace;font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow:auto;max-height:60vh}
/* A card that opens a sheet says so: pointer and hover, instead of the skeleton's static class (cursor:default). */
.kbs-root .kb8-card{cursor:pointer}
.kbs-root .kb8-card:focus-visible{outline:2px solid var(--kybernos-accent,var(--dsw-alias-border-focus,#4d7cfe));outline-offset:2px}
.kbs-root .kb-menu-wrap{position:relative;display:inline-flex}
/* The three popovers of the panel (Create, Sort, Filters) take the exact tokens of the core plugin's
   .kb6-tb-pop: l1 border, radius 13, shadow 0 14px 34px .3. They used to float higher
   and darker than those of the rest of the GUI. */
.kbs-root .kb-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:60;width:320px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:13px;padding:6px;box-shadow:0 14px 34px rgba(0,0,0,.3)}
.kbs-root .kb-menu button{display:flex;align-items:center;gap:12px;width:100%;padding:11px 12px;border:none;background:transparent;border-radius:10px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13.5px;text-align:left;cursor:pointer}
.kbs-root .kb-menu button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbs-root .kb-menu button svg{color:var(--dsw-alias-label-secondary);flex:0 0 auto}
.kbs-root .kb-sortmenu{position:absolute;right:0;top:calc(100% + 6px);z-index:60;width:290px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:13px;padding:6px;box-shadow:0 14px 34px rgba(0,0,0,.3)}
.kbs-root .kb-sort-head{display:flex;align-items:center;padding:9px 12px 7px}
.kbs-root .kb-sort-head .lbl{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);flex:1}
.kbs-root .kb-dir{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:15px;line-height:1;cursor:pointer;padding:4px 6px;border-radius:7px}
.kbs-root .kb-dir:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.kbs-root .kb-sort-opt{display:flex;align-items:flex-start;gap:9px;width:100%;padding:9px 11px;border:none;background:transparent;border-radius:10px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13.5px;text-align:left;cursor:pointer}
.kbs-root .kb-sort-opt:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbs-root .kb-sort-opt .tk{width:14px;color:var(--dsw-alias-label-primary);opacity:0;flex:0 0 auto;margin-top:2px}
.kbs-root .kb-sort-opt.on .tk{opacity:1}
.kbs-root .kb-sort-opt .tx{display:flex;flex-direction:column;gap:2px;min-width:0}
.kbs-root .kb-sort-opt .sub{font-size:11.5px;color:var(--dsw-alias-label-caption)}
.kbs-root .kb-sort-note{display:flex;gap:8px;padding:9px 11px 6px;border-top:1px solid var(--dsw-alias-border-l1);margin-top:4px; font-size:11px;line-height:1.45;color:var(--dsw-alias-label-caption)}
.kbs-root .kb-sort-note svg{flex:0 0 auto;margin-top:1px}
.kbs-root .kb-overlay{position:fixed;inset:0;background:#00000080;display:flex;align-items:center;justify-content:center;z-index:100;padding:24px}
/* The same window over the Settings dialog (it is drawn in the body, ahead of everything the dialog draws; the dialog's own layer takes the pointer from the body). */
.kbs-root.kbs-top .kb-overlay{z-index:2147483000;pointer-events:auto}
.kbs-root .kb-modal{width:580px;max-width:96vw;max-height:88vh;overflow:auto;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:18px;padding:22px;display:flex;flex-direction:column;gap:16px;box-shadow:0 24px 60px rgba(0,0,0,.6)}
.kbs-root .kb-drop{border:1.5px dashed var(--dsw-alias-border-l2);border-radius:14px;padding:36px 20px;display:flex;flex-direction:column;align-items:center;gap:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:center}
.kbs-root .kb-drop:hover{border-color:var(--dsw-alias-label-caption);background:var(--dsw-alias-bg-layer-2)}
.kbs-root .kb-note{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-caption)}
.kbs-root .kb-empty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:56px 24px;background:var(--dsw-alias-bg-layer-1);border:1px dashed var(--dsw-alias-border-l1);border-radius:18px;text-align:center;color:var(--dsw-alias-label-secondary)}
.kbs-root .kb-callout{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-left:3px solid var(--kybernos-accent,var(--dsw-alias-brand-primary,#4d7cfe));border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
/* — additions outside the mockup: only what the real flow requires (forms, notices) — */
.kbs-root .kbs-fields{display:flex;flex-direction:column;gap:13px}
.kbs-root .kbs-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-caption)}
.kbs-root .kbs-input,.kbs-root .kbs-area,.kbs-root .kbs-select{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13.5px;padding:10px 12px}
.kbs-root .kbs-area{min-height:104px;resize:vertical;font-family:ui-monospace,monospace;font-size:12.5px;line-height:1.6}
.kbs-root .kbs-input:focus,.kbs-root .kbs-area:focus,.kbs-root .kbs-select:focus{outline:none;border-color:var(--kybernos-accent,var(--dsw-alias-brand-primary,#4d7cfe))}
/* The browser's own placeholder grey is 2.4:1 on the dark input (the Index source dialog, audit V-23). */
.kbs-root .kbs-input::placeholder,.kbs-root .kbs-area::placeholder{color:var(--dsw-alias-label-tertiary)}
.kbs-root .kbs-check{display:flex;align-items:flex-start;gap:9px;font-size:13px;color:var(--dsw-alias-label-secondary);line-height:1.5}
.kbs-root .kbs-err{font-size:13px;color:var(--dsw-alias-state-error-primary)}
.kbs-root .kbs-actions{display:flex;align-items:center;gap:10px;justify-content:flex-end;flex-wrap:wrap}
.kbs-root .kbs-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:210;display:flex;align-items:center;gap:9px;padding:11px 16px;border-radius:12px;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 14px 34px rgba(0,0,0,.5);font-size:13px;color:var(--dsw-alias-label-primary);max-width:70vw}
.kbs-root .kbs-toast.err{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,transparent)}
.kbs-root .kbs-copy{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-caption);border-radius:999px;padding:3px 9px;font-family:ui-monospace,monospace;font-size:11px;cursor:pointer}
.kbs-root .kbs-copy:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
/* The panel on the right of Yours and Discover: the list stays, the panel sits next to it and follows the scroll. Under 1100 px it goes
   above the list instead, where it is the first thing seen. */
.kbs-root .kbs-split.open{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:20px;align-items:start}
.kbs-root .kbs-list{min-width:0}
.kbs-root .kbs-panel{position:sticky;top:12px;display:flex;flex-direction:column;gap:12px;min-width:0;box-sizing:border-box;padding:16px 18px;border:1px solid var(--dsw-alias-border-l1);border-radius:16px;background:var(--dsw-alias-bg-layer-1);max-height:calc(100vh - 32px);overflow:auto}
.kbs-root .kbs-panel>*{flex:0 0 auto}
.kbs-root .kbs-panel-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.kbs-root .kbs-panel-top .kb-tool{width:30px;height:30px;border-radius:9px;flex:0 0 auto}
.kbs-root .kbs-panel .kb-detail-head .kb8-tile.lg{width:44px;height:44px;border-radius:14px;flex:0 0 auto}
.kbs-root .kbs-panel .kb-local-rows .row{flex-wrap:wrap;gap:6px 14px}
.kbs-root .kbs-panel .kb-local-rows .row>span:first-child{min-width:96px}
.kbs-root .kbs-panel .kb-local-rows .row>span:last-child{min-width:0;flex:1 1 140px}
.kbs-root .kbs-panel .kb-local-body{max-height:300px}
.kbs-root .kbs-panel .kbs-path{display:flex;align-items:flex-start;gap:8px;overflow-wrap:anywhere}
.kbs-root .kbs-panel .kbs-desc{margin:0;font-size:13.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
/* The actions stay in view at the foot of the panel while its content scrolls (the panel's padding is 16px 18px: the bar bleeds to its edges). */
.kbs-root .kbs-panel-acts{position:sticky;bottom:-16px;z-index:1;display:flex;flex-wrap:wrap;gap:8px;margin:auto -18px -16px;padding:12px 18px 16px;background:var(--dsw-alias-bg-layer-1);border-top:1px solid var(--dsw-alias-border-l1)}
.kbs-root .kbs-panel-acts a.kb8-ghost{text-decoration:none}
.kbs-root .kb8-ghost.warn{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}
.kbs-root .kb8-card.sel{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.kbs-root .kbs-row.sel{background:var(--dsw-alias-interactive-bg-hover);box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}
/* With the panel open the ranking is narrower: the repository and the badges columns give way (they are in the panel). */
.kbs-root .kbs-split.open .kbs-head,.kbs-root .kbs-split.open .kbs-row{grid-template-columns:36px minmax(0,1fr) 84px;gap:10px;padding:8px 14px}
.kbs-root .kbs-split.open .kbs-head .src,.kbs-root .kbs-split.open .kbs-head .badges,.kbs-root .kbs-split.open .kbs-row .src,.kbs-root .kbs-split.open .kbs-row .badges{display:none}
@media (max-width:1100px){
  .kbs-root .kbs-split.open{grid-template-columns:minmax(0,1fr)}
  .kbs-root .kbs-split.open .kbs-panel{order:-1;position:static;max-height:none}
}
.kbs-root .kbs-nowrap{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* — Featured: the same rows as the ranking below it (same grid, same height); the cover, when there is one, is the row's tile. */
.kbs-root .kbs-feat{display:flex;flex-direction:column;gap:12px;margin-bottom:20px}
.kbs-root .kbs-row .who .kb8-name{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbs-root .kbs-row.feat .kbs-fdesc{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.kbs-root .kbs-row.feat .rank{display:flex;justify-content:flex-end}
.kbs-root .kb8-tile.kbs-cover{overflow:hidden;padding:0}
.kbs-root .kb8-tile.kbs-cover img{width:100%;height:100%;object-fit:cover;display:block}
.kbs-root .kbs-star-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-caption);cursor:pointer;padding:0;flex:0 0 auto}
.kbs-root .kbs-star-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.kbs-root .kbs-star-btn.on{color:#f7c46c;border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent)}
/* — Where the index is read from — */
.kbs-root .kbs-srcline{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 14px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.kbs-root .kbs-srcline svg{flex:0 0 auto;color:var(--dsw-alias-label-secondary)}
.kbs-root .kbs-srcline .k{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.kbs-root .kbs-srcline .v{font-family:ui-monospace,monospace;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.kbs-root .kbs-srcline .w::before{content:'·';margin-right:8px}
@media (max-width:520px){.kbs-root .kbs-srcline .w::before{display:none}}
.kbs-root .kbs-link{background:none;border:none;padding:3px 6px;border-radius:7px;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}
.kbs-root .kbs-link:hover{background:var(--dsw-alias-bg-layer-2)}
/* — Team skills: the table reuses the one from Discover (same tokens), only the columns change — */
.kbs-root .kbt .kbt-head,.kbs-root .kbt .kbs-row{display:grid;grid-template-columns:44px minmax(200px,1.7fr) minmax(120px,1fr) 210px 150px;align-items:center;gap:14px;padding:8px 18px}
.kbs-root .kbt .kbt-head{font-size:11px;font-weight:600;color:var(--dsw-alias-label-caption);border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.kbs-root .kbt .kbs-row{min-height:56px}
.kbs-root .kbt .badges{display:flex;gap:6px;flex-wrap:wrap}
.kbs-root .kbt-name{display:flex;flex-direction:column;gap:2px;min-width:0}
.kbs-root .kbt-name .n{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbs-root .kbt-name .d{font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbs-root .kbt-by{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.4}
.kbs-root .kbt-by .d{display:block;color:var(--dsw-alias-label-caption)}
.kbs-root .kbt-act{display:flex;justify-content:flex-end;align-items:center;gap:8px;flex-wrap:wrap}
.kbs-root .kbt-btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;font-weight:500;cursor:pointer;white-space:nowrap}
.kbs-root .kbt-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbs-root .kbt-btn.solid{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);border-color:transparent;font-weight:600}
.kbs-root .kbt-btn.solid:hover{opacity:.9}
.kbs-root .kbt-btn.danger{color:var(--dsw-alias-state-error-primary)}
.kbs-root .kbt-btn[disabled]{opacity:.45;cursor:default}
.kbs-root .kbt-subrow{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.kbs-root .kbt-stack{display:flex;flex-direction:column;gap:16px}
.kbs-root .kbt-files{border:1px solid var(--dsw-alias-border-l1);border-radius:13px;overflow:hidden;background:var(--dsw-alias-bg-base)}
.kbs-root .kbt-file{display:grid;grid-template-columns:22px minmax(0,1fr) 70px auto;gap:10px;align-items:center;width:100%;box-sizing:border-box;padding:8px 14px;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;text-align:left;cursor:pointer}
.kbs-root .kbt-file:last-child{border-bottom:0}
.kbs-root .kbt-file:hover,.kbs-root .kbt-file.on{background:var(--dsw-alias-interactive-bg-hover)}
.kbs-root .kbt-file.warn{box-shadow:inset 2px 0 0 var(--dsw-alias-state-warn-primary)}
.kbs-root .kbt-file .p{font-family:ui-monospace,monospace;font-size:12px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbs-root .kbt-file .z{font-family:ui-monospace,monospace;font-size:11.5px;color:var(--dsw-alias-label-caption);text-align:right}
.kbs-root .kbt-code{margin:0;font-family:ui-monospace,monospace;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:13px;padding:12px 14px;white-space:pre-wrap;overflow:auto;max-height:320px;word-break:break-word}
.kbs-root .kbt-code .add{display:block;color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent)}
.kbs-root .kbt-code .del{display:block;color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
.kbs-root .kbt-code .gap{display:block;color:var(--dsw-alias-label-caption)}
.kbs-root .kbt-banner{display:flex;align-items:flex-start;gap:12px;padding:12px 16px;border-radius:13px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-size:13px;color:var(--dsw-alias-label-secondary);line-height:1.5}
.kbs-root .kbt-banner.warn{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,transparent);color:var(--dsw-alias-label-primary)}
.kbs-root .kbt-banner.err{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);color:var(--dsw-alias-label-primary)}
.kbs-root .kbt-banner svg{flex:0 0 auto;margin-top:1px}
.kbs-root .kbt-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:12px}
.kbs-root .kbt-card .head{display:flex;align-items:flex-start;gap:14px}
.kbs-root .kbt-card .grow{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.kbs-root .kbt-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-warn-primary);display:inline-block;flex:0 0 auto}
.kbs-root .kbt-kv{display:grid;grid-template-columns:110px minmax(0,1fr);gap:8px 14px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.kbs-root .kbt-kv .k{color:var(--dsw-alias-label-secondary)}
.kbs-root .kbt-cap{font-size:12px;color:var(--dsw-alias-label-caption);line-height:1.5}
.kbs-root .kbt-sheet{width:660px}
.kbs-root .kb8-primary[disabled]{opacity:.45;cursor:default}
/* Tables that follow the width of THEIR column, not of the window: below 720 px the STATE column steps aside, below 480 the
   source too, so the last column — the one that says how installed a skill is — is never the one that gets cut off. */
.kbs-root .kb8-page{container-type:inline-size}
@container (max-width:720px){
.kbs-root .kbs-head,.kbs-root .kbs-row{grid-template-columns:36px minmax(0,1.6fr) minmax(0,1fr) 108px;gap:10px;padding:8px 12px}
/* The name is what a person installs: in a narrow column it wraps (at the hyphens first) instead of ending with an ellipsis (audit R-A1-03). */
.kbs-root .kbs-row .who .kb8-name{white-space:normal;overflow-wrap:anywhere}
.kbs-root .kbs-head .badges,.kbs-root .kbs-row .badges{display:none}
.kbs-root .kbt .kbt-head,.kbs-root .kbt .kbs-row{grid-template-columns:36px minmax(0,1fr) auto;gap:10px;padding:8px 12px}
.kbs-root .kbt .kbt-head>:nth-child(3),.kbs-root .kbt .kbt-head>:nth-child(4),.kbs-root .kbt .kbs-row .kbt-by,.kbs-root .kbt .kbs-row .badges{display:none}
}
@container (max-width:480px){
.kbs-root .kbs-head,.kbs-root .kbs-row{grid-template-columns:30px minmax(0,1fr) 108px}
.kbs-root .kbs-head .src,.kbs-root .kbs-row .src{display:none}
.kbs-root .kbs-row.feat .kbs-fdesc{display:none}
}
/* — Featured tab: the picks Kybernos proposes. Cover = ONE cut-out per skill (transparent), composed here: a category tint (or the plain
   card surface), the creator and the count on the right of the title, the actions on hover (always on touch) — */
.kbs-root .kbsf-t{--cv-bg:#f4e6d6;--cv-bg2:#ecd5ba}
.kbs-root .kbsf-t[data-cat=Data]{--cv-bg:#dff0e2;--cv-bg2:#c6e4cc}
.kbs-root .kbsf-t[data-cat=Design]{--cv-bg:#ece4f8;--cv-bg2:#dccff2}
.kbs-root .kbsf-t[data-cat=Media]{--cv-bg:#fbe0dc;--cv-bg2:#f6c8c2}
.kbs-root .kbsf-t[data-cat=Research]{--cv-bg:#dde9fa;--cv-bg2:#c4d8f5}
.kbs-root .kbsf-t[data-cat=Marketing]{--cv-bg:#f9f0c8;--cv-bg2:#f2e29a}
.kbs-root .kbsf-t[data-cat=Automation]{--cv-bg:#d7f0ed;--cv-bg2:#b9e3de}
.kbs-root .kbsf-t[data-cat=Build]{--cv-bg:#e4e7f5;--cv-bg2:#cfd4ee}
body[data-ds-dark-theme] .kbs-root .kbsf-t{--cv-bg:#3a2e24;--cv-bg2:#4a3a2c}
body[data-ds-dark-theme] .kbs-root .kbsf-t[data-cat=Data]{--cv-bg:#203629;--cv-bg2:#2a4a37}
body[data-ds-dark-theme] .kbs-root .kbsf-t[data-cat=Design]{--cv-bg:#2d2644;--cv-bg2:#3b3159}
body[data-ds-dark-theme] .kbs-root .kbsf-t[data-cat=Media]{--cv-bg:#402524;--cv-bg2:#55302e}
body[data-ds-dark-theme] .kbs-root .kbsf-t[data-cat=Research]{--cv-bg:#202d45;--cv-bg2:#2a3b5c}
body[data-ds-dark-theme] .kbs-root .kbsf-t[data-cat=Marketing]{--cv-bg:#3a3420;--cv-bg2:#4d4528}
body[data-ds-dark-theme] .kbs-root .kbsf-t[data-cat=Automation]{--cv-bg:#1c3835;--cv-bg2:#264b47}
body[data-ds-dark-theme] .kbs-root .kbsf-t[data-cat=Build]{--cv-bg:#272a43;--cv-bg2:#343a5c}
.kbs-root .kbsf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px;align-items:stretch}
.kbs-root .kbsf-card{container-type:inline-size;position:relative;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;cursor:pointer;transition:transform .16s ease,border-color .16s ease}
.kbs-root .kbsf-card:hover,.kbs-root .kbsf-card.sel{border-color:var(--dsw-alias-brand-primary)}
.kbs-root .kbsf-card:hover{transform:translateY(-3px)}
.kbs-root .kbsf-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.kbs-root .kbsf-pic{position:relative;aspect-ratio:16/9;overflow:hidden;background:linear-gradient(135deg,var(--cv-bg),var(--cv-bg2))}
.kbs-root .kbsf-plain .kbsf-pic{background:var(--dsw-alias-bg-layer-2)}
.kbs-root .kbsf-pic .kbsf-cut{position:absolute;inset:6%;width:88%;height:88%;object-fit:contain;filter:drop-shadow(0 7px 9px rgba(30,18,6,.30))}
.kbs-root .kbsf-pic .kb8-tile{position:absolute;inset-inline-start:50%;top:50%;transform:translate(-50%,-50%);width:64px;height:64px}
.kbs-root .kbsf-tag{position:absolute;inset-block-start:10px;inset-inline-start:10px;font-family:ui-monospace,monospace;font-size:10px;padding:4px 9px;border-radius:999px;background:rgba(255,253,248,.88);color:#26221e}
.kbs-root .kbsf-star{position:absolute;inset-block-start:6px;inset-inline-end:6px;background:rgba(255,253,248,.88);color:#6b625a;border-color:transparent}
.kbs-root .kbsf-star:disabled{opacity:.55;cursor:default}
.kbs-root .kbsf-star.on{color:#c98a00}
.kbs-root .kbsf-star.on svg{fill:currentColor}
.kbs-root .kbsf-body{display:flex;flex-direction:column;gap:8px;padding:14px 16px 16px;flex:1;min-width:0}
.kbs-root .kbsf-trow{display:flex;align-items:flex-start;gap:10px}
.kbs-root .kbsf-title{flex:1;min-width:0;font-size:16px;font-weight:600;line-height:1.25;color:var(--dsw-alias-label-primary)}
.kbs-root .kbsf-side{display:flex;align-items:center;gap:10px;flex:none;font-size:12px;color:var(--dsw-alias-label-secondary);padding-top:2px}
.kbs-root .kbsf-by{display:inline-flex;align-items:center;gap:6px;min-width:0}
.kbs-root .kbsf-by .nm{display:none;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@container (min-width:330px){.kbs-root .kbsf-by .nm{display:inline}}
.kbs-root .kbsf-av{width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;flex:none}
.kbs-root .kbsf-cnt{display:inline-flex;align-items:center;gap:4px;font-family:ui-monospace,monospace;font-size:11.5px}
.kbs-root .kbsf-out{margin:0;font-size:13.5px;line-height:1.4;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.8em}
.kbs-root .kbsf-pills{display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-height:24px}
.kbs-root .kbsf-pill{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;line-height:1;padding:5px 9px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);white-space:nowrap}
.kbs-root .kbsf-pill.ok{color:var(--dsw-alias-state-success-primary,#22c55e)}
.kbs-root .kbsf-pill.warn{color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.kbs-root .kbsf-pill.need{color:var(--dsw-alias-state-business-primary,#5686fe)}
/* Light schemes: label-tertiary is 3.7:1 on white. Inside this page it reads as label-secondary, 5.8:1 (audit A1-05); the dark scheme keeps its hierarchy. */
body:not([data-ds-dark-theme]) .kbs-root{--dsw-alias-label-tertiary:var(--dsw-alias-label-secondary)}
/* label-caption is #adb2b8 (2.1:1) in the light schemes and #81858c (3.5 to 3.8:1) in the dark one. The table heads, ranks, counts, pager, /command buttons,
   card footers and field hints of this page are text a person reads (audit A1-04): inside it the token reads as label-tertiary, which is label-secondary
   (5.8:1) in the light schemes by the rule above and #adb2b8 (6.5:1 and more) in the dark one. */
.kbs-root{--dsw-alias-label-caption:var(--dsw-alias-label-tertiary)}
/* The state inks are the fills (2.1 to 4.2:1 on white): in the light schemes they are pulled toward the text colour (audit A1-11). */
body:not([data-ds-dark-theme]) .kbs-root .kbsf-pill.ok{color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 50%,var(--dsw-alias-label-primary))}
body:not([data-ds-dark-theme]) .kbs-root .kbsf-pill.warn{color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 50%,var(--dsw-alias-label-primary))}
body:not([data-ds-dark-theme]) .kbs-root .kbsf-pill.need{color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#5686fe) 60%,var(--dsw-alias-label-primary))}
/* The state pills of the lists and cards (active, disabled, installed, curated) are the same fills: 2.0:1 on their own tint (audit A1-04). */
body:not([data-ds-dark-theme]) .kbs-root .kb8-pill.ok{color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 50%,var(--dsw-alias-label-primary))}
body:not([data-ds-dark-theme]) .kbs-root .kb8-pill.warn{color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 50%,var(--dsw-alias-label-primary))}
.kbs-root .kbsf-acts{display:flex;align-items:center;gap:8px;margin-top:auto;min-height:32px;transition:opacity .14s ease}
@media (hover:hover){
.kbs-root .kbsf-card .kbsf-acts{opacity:0}
.kbs-root .kbsf-card:hover .kbsf-acts,.kbs-root .kbsf-card:focus-within .kbsf-acts{opacity:1}
}
.kbs-root .kbsf-acts .kb8-primary{height:32px;padding:0 14px;font-size:13px;border-radius:10px;gap:6px}
.kbs-root .kbsf-acts .kb8-ghost{height:32px;padding:0 12px;font-size:13px;gap:6px}
/* — Featured, a pick opened: the page's width, not a side panel — */
.kbs-root .kbsf-detail{container-type:inline-size;display:flex;flex-direction:column;gap:18px}
.kbs-root .kbsf-dback{align-self:flex-start;display:inline-flex;align-items:center;gap:4px}
.kbs-root .kbsf-dhero{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);border:1px solid var(--dsw-alias-border-l1);border-radius:22px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.kbs-root .kbsf-dpic{position:relative;min-height:380px;background:linear-gradient(135deg,var(--cv-bg),var(--cv-bg2))}
.kbs-root .kbsf-plain .kbsf-dpic{background:var(--dsw-alias-bg-layer-2)}
.kbs-root .kbsf-dpic .kbsf-cut{position:absolute;inset:7%;width:86%;height:86%;object-fit:contain;filter:drop-shadow(0 12px 16px rgba(30,18,6,.32))}
.kbs-root .kbsf-dpic .kb8-tile{position:absolute;inset-inline-start:50%;top:50%;transform:translate(-50%,-50%);width:96px;height:96px}
.kbs-root .kbsf-dtx{padding:30px 34px;display:flex;flex-direction:column;gap:14px;justify-content:center;min-width:0}
.kbs-root .kbsf-dtitle{margin:0;font-size:30px;line-height:1.12;font-weight:700;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}
.kbs-root .kbsf-dout{margin:0;font-size:16px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.kbs-root .kbsf-dacts{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:4px}
.kbs-root .kbsf-dacts .kbsf-rstar{position:static}
.kbs-root .kbsf-try{display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:12px 14px;background:var(--dsw-alias-bg-layer-2);margin-top:4px}
.kbs-root .kbsf-trytxt{font-size:14px;color:var(--dsw-alias-label-primary)}
.kbs-root .kbsf-try .kbs-link{align-self:flex-start;display:inline-flex;align-items:center;gap:4px}
.kbs-root .kbsf-dcols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px;align-items:start}
.kbs-root .kbsf-dcard .kbs-desc{margin:0;font-size:14px;line-height:1.55;color:var(--dsw-alias-label-secondary)}
.kbs-root .kbsf-dcard{border:1px solid var(--dsw-alias-border-l1);border-radius:16px;padding:18px 20px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:12px;min-width:0}
@container (max-width:760px){
.kbs-root .kbsf-dhero{grid-template-columns:1fr}
.kbs-root .kbsf-dpic{min-height:240px}
.kbs-root .kbsf-dtx{padding:22px}
.kbs-root .kbsf-dcols{grid-template-columns:1fr}
}
/* — Featured, list view: the same pick as a row — */
.kbs-root .kbsf-list{container-type:inline-size;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:16px;overflow:hidden}
.kbs-root .kbsf-row{display:grid;grid-template-columns:88px minmax(0,1.5fr) minmax(0,1fr) auto;gap:16px;align-items:center;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1);cursor:pointer;background:var(--dsw-alias-bg-layer-1)}
.kbs-root .kbsf-row:first-child{border-top:0}
.kbs-root .kbsf-row:hover,.kbs-root .kbsf-row.sel{background:var(--dsw-alias-bg-layer-2)}
.kbs-root .kbsf-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.kbs-root .kbsf-th{position:relative;width:88px;aspect-ratio:1/1;border-radius:14px;overflow:hidden;background:linear-gradient(135deg,var(--cv-bg),var(--cv-bg2))}
.kbs-root .kbsf-plain .kbsf-th{background:var(--dsw-alias-bg-layer-2)}
.kbs-root .kbsf-th .kbsf-cut{position:absolute;inset:6%;width:88%;height:88%;object-fit:contain;filter:drop-shadow(0 4px 5px rgba(30,18,6,.30))}
.kbs-root .kbsf-th .kb8-tile{position:absolute;inset-inline-start:50%;top:50%;transform:translate(-50%,-50%);width:40px;height:40px}
.kbs-root .kbsf-mn{min-width:0;display:flex;flex-direction:column;gap:3px}
.kbs-root .kbsf-mn .kbsf-out{-webkit-line-clamp:1;min-height:0}
.kbs-root .kbsf-meta{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden}
.kbs-root .kbsf-racts{display:flex;align-items:center;gap:8px;justify-content:flex-end}
.kbs-root .kbsf-racts .kb8-primary{height:32px;padding:0 14px;font-size:13px;border-radius:10px;gap:6px}
.kbs-root .kbsf-racts .kb8-ghost{height:32px;padding:0 12px;font-size:13px;gap:6px}
.kbs-root .kbsf-rstar{position:static;background:transparent;color:var(--dsw-alias-label-secondary)}
.kbs-root .kbsf-rstar:disabled{opacity:.45;cursor:default}
.kbs-root .kbsf-rstar.on{color:#c98a00}
.kbs-root .kbsf-rstar.on svg{fill:currentColor}
@container (max-width:760px){
.kbs-root .kbsf-row{grid-template-columns:72px minmax(0,1fr) auto;gap:12px}
.kbs-root .kbsf-row .kbsf-pills{display:none}
.kbs-root .kbsf-th{width:72px}
}
@container (max-width:520px){
.kbs-root .kbsf-row{grid-template-columns:56px minmax(0,1fr)}
.kbs-root .kbsf-th{width:56px;border-radius:11px}
.kbs-root .kbsf-racts{grid-column:1 / -1;justify-content:flex-start}
.kbs-root .kbsf-meta .kbsf-by .nm{display:none}
}
.kbs-root .kbsf-chips{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:2px 0 14px}
.kbs-root .kbsf-chips .grow{flex:1}
.kbs-root .kbsf-seg{display:inline-flex;align-items:center;gap:4px;padding:3px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);font-size:12px}
.kbs-root .kbsf-seg button{border:0;background:transparent;width:32px;height:28px;padding:0;border-radius:999px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.kbs-root .kbsf-seg button.on{background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 3px rgba(20,20,19,.14)}
.kbs-root .kbsf-seg .sw{display:block;width:16px;height:16px;border-radius:5px}
.kbs-root .kbsf-seg .sw.tint{background:linear-gradient(135deg,#f4e6d6 0%,#c4d8f5 100%)}
.kbs-root .kbsf-seg .sw.plain{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2)}
.kbs-root .kbsf-foot{margin-top:18px;font-size:12px;color:var(--dsw-alias-label-secondary)}
/* « For your field »: the field's colour (--kbsf-fld, set from the pack) is the rail and the dot; everything else is the page's own surfaces and text. */
.kbs-root .kbsf-field{margin:0 0 20px;padding:14px 16px 16px;border:1px solid var(--dsw-alias-border-l1);border-inline-start:3px solid var(--kbsf-fld);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}
.kbs-root .kbsf-fhead{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.kbs-root .kbsf-fdot{width:10px;height:10px;border-radius:50%;background:var(--kbsf-fld);flex:none}
.kbs-root .kbsf-fh{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbs-root .kbsf-fsub{font-size:12px;color:var(--dsw-alias-label-secondary)}
.kbs-root .kbsf-fhead .grow{flex:1}
.kbs-root .kbsf-field .kbsf-t{--cv-bg:color-mix(in srgb,var(--kbsf-fld) 26%,var(--dsw-alias-bg-layer-1));--cv-bg2:color-mix(in srgb,var(--kbsf-fld) 40%,var(--dsw-alias-bg-layer-1))}
.kbs-root .kbsf-field .kbsf-pic{aspect-ratio:auto;height:104px}
.kbs-root .kbsf-field .kbsf-pic .kb8-tile{width:52px;height:52px}
.kbs-root .kbsf-field .kbsf-list{border:0;border-radius:10px}
.kbs-root .kbs-did{color:var(--dsw-alias-state-success-primary)}
.kbs-root .kbsf-tagtx{display:inline-flex;align-items:center;gap:4px}
/* — Settings page « Skills » (catalogue): its own scope (.kbss-page), not .kbs-root, so nothing
   here can reach the Skills panel; the shared input/link/note vocabulary is re-stated here because
   the kbs-* rules above are scoped to .kbs-root — */
.kbss-page{display:flex;flex-direction:column;gap:22px;width:100%;max-width:720px;box-sizing:border-box}
.kbss-page .kbss-h1{margin:0;font-size:18px;font-weight:600;line-height:1.3;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}
.kbss-headrow{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.kbss-page .kbss-lead{margin:6px 0 0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.kbss-page .kbss-card{display:flex;flex-direction:column;gap:12px;padding:16px 18px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}
.kbss-page .kbss-h2{margin:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbss-page .kbss-sub{margin:0;font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.kbss-page .kbss-srcline{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.kbss-page .kbss-srcline svg{flex:0 0 auto;color:var(--dsw-alias-label-secondary)}
.kbss-page .kbss-srcline .k{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.kbss-page .kbss-srcline .v{font-family:ui-monospace,monospace;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.kbss-page .kbss-srcline .w::before{content:'·';margin-right:8px}
@media (max-width:520px){.kbss-page .kbss-srcline .w::before{display:none}}
.kbss-page .kbss-link{background:none;border:none;padding:3px 6px;border-radius:7px;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}
.kbss-page .kbss-link{position:relative}
.kbss-page .kbss-link::before{content:"";position:absolute;inset:-2px 0}
.kbss-page .kbss-link:hover{background:var(--dsw-alias-bg-layer-2)}
.kbss-page .kbss-err{font-size:13px;color:var(--dsw-alias-state-error-primary)}
.kbss-page .kbss-root-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:9px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2);font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.kbss-page .kbss-root-row .p{font-family:ui-monospace,monospace;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1 1 220px}
.kbss-page .kbss-kpis{display:flex;align-items:baseline;gap:18px;flex-wrap:wrap;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.kbss-page .kbss-kpis .n{font-size:17px;font-weight:600;color:var(--dsw-alias-label-primary)}

/* skills learned from experience */
.kbs-root .kbl-banner{border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 38%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-brand-primary) 6%,var(--dsw-alias-bg-layer-1));border-radius:16px;margin:0 0 18px;overflow:hidden}
.kbs-root .kbl-bh{display:flex;align-items:flex-start;gap:12px;padding:15px 18px 11px}
.kbs-root .kbl-bh h3{margin:0;font-size:15px;font-weight:650;color:var(--dsw-alias-label-primary)}
.kbs-root .kbl-bh p{margin:3px 0 0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);max-width:74ch}
.kbs-root .kbl-bh .kbs-link{margin-inline-start:auto;white-space:nowrap}
.kbs-root .kbl-dot{width:9px;height:9px;border-radius:50%;background:var(--dsw-alias-brand-primary);display:inline-block;flex:none;margin-top:6px}
.kbs-root .kbl-chip .kbl-dot{width:7px;height:7px;margin-top:0}
.kbs-root .kbl-brow{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1.4fr) minmax(0,1fr) auto;gap:10px 16px;align-items:center;padding:11px 18px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,var(--dsw-alias-border-l1))}
.kbs-root .kbl-bname{display:flex;flex-direction:column;gap:5px;align-items:flex-start;min-width:0;font-weight:600;font-size:14px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.kbs-root .kbl-bname code{font:12.5px ui-monospace,monospace;font-weight:500}
.kbs-root .kbl-how{font-size:12.5px;line-height:1.45;color:var(--dsw-alias-label-secondary)}
.kbs-root .kbl-acts{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap}
.kbs-root .kbl-bfoot{padding:9px 18px 13px;font-size:12.5px;color:var(--dsw-alias-label-caption);border-top:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,var(--dsw-alias-border-l1))}
.kbs-root .kbl-pend{border-style:dashed;border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-brand-primary) 4%,var(--dsw-alias-bg-layer-1))}
.kbs-root .kbl-sug,.kbs-root .kbl-lrn{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 13%,transparent)}
.kbs-root .kbl-from{font-size:12.5px;color:var(--dsw-alias-label-caption)}
.kbs-root .kbl-chip{display:inline-flex;align-items:center;gap:7px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,var(--dsw-alias-bg-layer-1));border-radius:99px;padding:6px 13px;font:inherit;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary);cursor:pointer}
.kbs-root .kbl-chip.on{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);border-color:var(--dsw-alias-label-primary)}
.kbs-root .kbl-p{margin:0;font-size:13px;line-height:1.55;color:var(--dsw-alias-label-secondary)}
.kbs-root .kbl-prov{margin:6px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.kbs-root .kbl-prov li{font-size:12.5px;line-height:1.45;color:var(--dsw-alias-label-secondary);border-inline-start:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 50%,var(--dsw-alias-border-l1));padding:2px 0 2px 10px;overflow-wrap:anywhere}
.kbs-root .kbl-dim{opacity:.7;max-height:130px;border-style:dashed}
.kbs-root .kbl-flag{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 18%,transparent);color:var(--dsw-alias-state-error-primary);border-radius:4px;padding:0 2px;font-weight:600}
.kbs-root .kbl-checks{display:flex;flex-direction:column;gap:7px}
.kbs-root .kbl-checks div{display:flex;gap:9px;align-items:flex-start;font-size:12.5px;line-height:1.45;color:var(--dsw-alias-label-secondary)}
.kbs-root .kbl-checks .m{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;flex:none;font-size:11px;font-weight:700;margin-top:1px}
.kbs-root .kbl-checks .ok .m{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 16%,transparent);color:var(--dsw-alias-state-success-primary)}
.kbs-root .kbl-checks .warn .m{background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#c98a00) 18%,transparent);color:var(--dsw-alias-state-warning-primary,#c98a00)}
.kbs-root .kbl-checks .bad .m{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 16%,transparent);color:var(--dsw-alias-state-error-primary)}
.kbs-root .kbl-jr{border-top:1px solid var(--dsw-alias-border-l1)}
.kbs-root .kbl-jr>button{width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:flex-start;border:0;background:none;text-align:start;padding:10px 0;font:inherit;color:inherit;cursor:pointer}
.kbs-root .kbl-jt{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.kbs-root .kbl-jt small{display:block;font-size:12px;color:var(--dsw-alias-label-caption)}
.kbs-root .kbl-jb{padding:0 0 12px;display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
@media (max-width:900px){.kbs-root .kbl-brow{grid-template-columns:1fr}.kbs-root .kbl-acts{justify-content:flex-start}}
/* skills learned from experience, V1: the confidence, the diff, the chat card and the settings page (the last two are not inside .kbs-root, so they carry their own vocabulary) */
.kbs-root .kbl-diff{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2);padding:8px 10px;font:12.5px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}
.kbs-root .kbl-diff .ad{color:var(--dsw-alias-state-success-primary);white-space:pre-wrap}
.kbs-root .kbl-conf{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.kbs-root .kbl-sg{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"l v" "b b";gap:4px 10px;align-items:baseline;font-size:12.5px;line-height:1.4;color:var(--dsw-alias-label-secondary)}
.kbs-root .kbl-sg>span:first-child{grid-area:l}
.kbs-root .kbl-sg>.kb8-mono{grid-area:v}
.kbs-root .kbl-sg>.kbl-bar{grid-area:b}
.kbs-root .kbl-jb .kbl-sg{grid-template-areas:"l v"}
.kbs-root .kbl-bar,.kbss-page .kbl-bar{position:relative;display:block;height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);overflow:visible}
.kbs-root .kbl-bar i,.kbss-page .kbl-bar i{display:block;height:100%;border-radius:3px;background:var(--dsw-alias-brand-primary)}
.kbss-page .kbl-bar u{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--dsw-alias-label-primary);text-decoration:none}
.kbss-page .kbl-mono,.kbl-tail .kbl-mono{font-family:ui-monospace,monospace;font-size:11px;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary))}
.kbss-page .kbl-pill,.kbl-tail .kbl-pill{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 9px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.kbss-page .kbl-pill.ok{color:var(--dsw-alias-state-success-primary)}
body:not([data-ds-dark-theme]) .kbss-page .kbl-pill.ok{color:var(--kybernos-ok-ink,#166534)}
.kbss-page .kbl-pill.sug,.kbl-tail .kbl-pill.sug{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,var(--dsw-alias-border-l1))}
.kbss-page .kbl-btn,.kbl-tail .kbl-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap}
.kbss-page .kbl-btn:hover,.kbl-tail .kbl-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbss-page .kbl-btn.pri,.kbl-tail .kbl-btn.pri{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}
.kbss-page .kbl-btn.warn{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,var(--dsw-alias-border-l2))}
.kbss-page .kbl-btn:disabled{opacity:.5;cursor:default}
.kbss-page .kbl-lvs{display:flex;flex-direction:column;gap:8px}
.kbss-page .kbl-lv{display:flex;flex-direction:column;gap:3px;text-align:start;padding:11px 13px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:transparent;font:inherit;color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.5;cursor:pointer}
.kbss-page .kbl-lv b{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbss-page .kbl-lv.on{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,transparent)}
.kbss-page .kbl-lv:disabled{opacity:.55;cursor:default}
.kbss-page .kbl-lock{display:flex;gap:9px;align-items:flex-start;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2);font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.kbss-page .kbl-lock svg{flex:none;margin-top:2px}
.kbss-page .kbl-chk{display:flex;gap:9px;align-items:flex-start;font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.kbss-page .kbl-rng{display:flex;align-items:center;gap:14px}
.kbss-page .kbl-rng input{flex:1;accent-color:var(--dsw-alias-brand-primary)}
.kbss-page .kbl-val{min-width:30px;text-align:end;font-size:20px;font-weight:650;color:var(--dsw-alias-label-primary)}
.kbss-page .kbl-pv{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;overflow:hidden}
.kbss-page .kbl-pr{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(70px,1fr) 28px auto;gap:10px;align-items:center;padding:9px 12px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.kbss-page .kbl-pr+.kbl-pr{border-top:1px solid var(--dsw-alias-border-l1)}
.kbss-page .kbl-pr b{font-weight:500;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbss-page .kbl-stops{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:9px}
.kbss-page .kbl-stops li{display:flex;gap:10px;align-items:flex-start;font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.kbss-page .kbl-stops svg{flex:none;margin-top:2px;color:var(--dsw-alias-label-primary)}
.kbss-page .kbl-fr{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:13px;color:var(--dsw-alias-label-primary)}
.kbss-page .kbl-sel{height:32px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:0 8px;max-width:100%}
.kbl-tail{display:flex;flex-direction:column;gap:8px;margin:10px 0 4px;max-width:640px}
.kbl-tail .kbl-tcard{display:flex;flex-direction:column;gap:7px;padding:12px 14px;border:1px dashed color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,var(--dsw-alias-border-l1));border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 5%,var(--dsw-alias-bg-layer-1))}
.kbl-tail .kbl-tr{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.kbl-tail .kbl-how{font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
@media (max-width:520px){.kbss-page .kbl-pr{grid-template-columns:minmax(0,1fr) 28px}.kbss-page .kbl-pr .kbl-bar{display:none}}
/* skills learned from experience, V2: the two dock cards, the share block, the patterns list */
.kbl-tail.kbl-dk{max-width:none;margin:0;padding:0 16px 10px}
.kbl-dk .kbl-dim2{font-size:12px;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary))}
.kbl-dk .kbl-wk{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 38%,var(--dsw-alias-border-l1));border-radius:16px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 5%,var(--dsw-alias-bg-layer-1))}
.kbl-dk .kbl-wh{display:flex;gap:12px;align-items:flex-start;justify-content:space-between}
.kbl-dk .kbl-wh h3{margin:0;font-size:15px;font-weight:650;color:var(--dsw-alias-label-primary)}
.kbl-dk .kbl-wh p{margin:3px 0 0;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.kbl-dk .kbl-nums{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px}
.kbl-dk .kbl-num{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:12px;padding:9px 12px}
.kbl-dk .kbl-num b{display:block;font-size:20px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
.kbl-dk .kbl-num span{font-size:12px;color:var(--dsw-alias-label-secondary)}
.kbl-dk .kbl-wl{display:flex;flex-direction:column;gap:8px;font-size:13px}
.kbl-dk .kbl-wr{display:flex;gap:10px;align-items:center;flex-wrap:wrap;border-top:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,var(--dsw-alias-border-l1));padding-top:8px}
.kbl-dk .kbl-ws{flex:1;min-width:140px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.kbs-root .kbl-share{display:flex;flex-direction:column;gap:8px}
.kbss-page .kbl-pt{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(70px,auto) minmax(0,1fr) auto;gap:10px;align-items:center;padding:9px 12px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.kbss-page .kbl-pt+.kbl-pt{border-top:1px solid var(--dsw-alias-border-l1)}
.kbss-page .kbl-pt b{font-weight:500;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:520px){.kbss-page .kbl-pt{grid-template-columns:minmax(0,1fr) auto}}
`

      // ── route access ────────────────────────────────────────────────────
      // An unreadable body is not a network outage: we name the HTTP status, because the most
      // frequent case in development is a route that is simply ABSENT (host module not yet
      // reloaded) — and "unreachable" would send us looking for the fault in the wrong place.
      const lire = async (r) => {
        try { return await r.json() } catch (e) {
          return { ok: false, error: r.ok === true ? t('err.unreadable') : t('err.noroute', { s: r.status }) }
        }
      }
      // The DISPLAYED session accompanies every call: it is what sets the PROJECT, hence the project
      // skills the catalogue must show, and the scope to invalidate after a write. Without a
      // session (tab opened outside a session), nothing is added: original behaviour kept.
      let kbSkSid = ''
      const avecSession = (path) => (kbSkSid === '' ? path : path + (path.indexOf('?') === -1 ? '?' : '&') + 'sessionId=' + encodeURIComponent(kbSkSid))
      const corpsSession = (body) => (kbSkSid === '' ? body : Object.assign({}, body === null || body === undefined ? {} : body, { sessionId: kbSkSid }))
      const getJson = (path) => fetch(avecSession(path), { headers: { accept: 'application/json' } }).then(lire)
      const postJson = (path, body) => fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(corpsSession(body))
      }).then(lire)
      // A host answer is a code in `error`, with the facts its sentence needs (`source`, `name`, `http`…): the sentence is the screen's, in the
      // screen's language. A code with no sentence (a host from before this change answers in French) is shown as it came.
      const why = (j, fallback) => {
        const code = (j !== null && j !== undefined && typeof j.error === 'string') ? j.error : ''
        if (code === '') return fallback
        if (STR['he.' + code] === undefined) return code
        const text = t('he.' + code, { source: j.source, name: j.name, http: j.http, count: j.count, max: j.max, dest: j.dest })
        // The relay's own words are added when they say more than the sentence ("index unavailable" under « The index did not answer »
        // was the same thing twice).
        const detail = typeof j.detail === 'string' ? j.detail.trim() : ''
        if (detail === '' || /^(the )?(skills )?index (is )?(un)?available\.?$/i.test(detail)) return text
        return text + ' — ' + detail
      }
      const skillKey = (s) => String(s.root) + '\u0000' + String(s.name)

      function KybernosSkills(props) {
        // Scope of the view: the session the tab represents. Published from the render so that the
        // helpers attach it to every call; the loading effect, however, depends on `sid`.
        const sid = (props !== null && props !== undefined && typeof props.sessionId === 'string') ? props.sessionId : ''
        kbSkSid = sid
        // Featured is the landing tab; a host that has no picks (not restarted yet) sends the screen back to Yours (see `picks` below).
        const [mode, setMode] = React.useState('featured')                       // featured | yours | discover | team
        const [q, setQ] = React.useState({ featured: '', yours: '', discover: '', team: '' })
        const [sort, setSort] = React.useState({ featured: 'editorial', yours: 'recent', discover: 'installs' })
        const [dir, setDir] = React.useState({ featured: -1, yours: -1, discover: -1 })
        // Cards or list, per tab, kept in this browser: Yours is cards by default (as it was), Discover is the ranking table (as it was).
        const [views, setViews] = React.useState(() => {
          try {
            const j = JSON.parse(window.localStorage.getItem('kybernos.skills.views'))
            return { yours: j !== null && j.yours === 'list' ? 'list' : 'cards', discover: j !== null && j.discover === 'cards' ? 'cards' : 'list', featured: j !== null && j.featured === 'list' ? 'list' : 'cards' }
          } catch (e) { return { yours: 'cards', discover: 'list', featured: 'cards' } }
        })
        const setView = (m, v) => setViews((prev) => {
          const next = { ...prev, [m]: v }
          try { window.localStorage.setItem('kybernos.skills.views', JSON.stringify(next)) } catch (e) { /* a convenience only */ }
          return next
        })
        const [page, setPage] = React.useState({ yours: 1 })
        // The index is PAGINATED server-side: `iview` chooses the ranking, `ipage` is 0-indexed like the
        // API, `iper` the page size. This is what replaces the endless "Load more" — at
        // 9 827 skills, we do not scroll: we page, or we search.
        const [iview, setIview] = React.useState('all-time')
        const [ipage, setIpage] = React.useState(0)
        const [iper, setIper] = React.useState(DISC_PER)
        const [showFilters, setShowFilters] = React.useState(false)
        const [sortOpen, setSortOpen] = React.useState(false)
        const [addOpen, setAddOpen] = React.useState(false)
        const [stateFilter, setStateFilter] = React.useState('all')           // all | active | disabled
        const [sourceFilter, setSourceFilter] = React.useState('all')
        const [cat, setCat] = React.useState(null)
        const [catPhase, setCatPhase] = React.useState('loading')
        const [catError, setCatError] = React.useState('')
        const [disc, setDisc] = React.useState(null)
        const [discPhase, setDiscPhase] = React.useState('idle')
        // The last failure of the index: { text, code, http }. `discTick` re-asks (« Try again »); `manualRetry` tells the effect that
        // the user asked, so it does not add its own automatic second attempt on top.
        const [discErr, setDiscErr] = React.useState(null)
        const [discTick, setDiscTick] = React.useState(0)
        const manualRetry = React.useRef(false)
        // The relay the index is read from ({ origin: default | setting | env, host, url, refused, editable }), the window that
        // names another one, and what it is doing.
        const [src, setSrc] = React.useState(null)
        const [srcOpen, setSrcOpen] = React.useState(false)
        const [srcBusy, setSrcBusy] = React.useState(false)
        const [srcErr, setSrcErr] = React.useState('')
        const [audit, setAudit] = React.useState(null)     // security audits of the open skill
        // Curated owners (GET /kybernos-skills/curated), kept to say who PUBLISHES a skill: an index
        // entry carries `source` (owner/repo) but no owner label of its own.
        const [curatedOwners, setCuratedOwners] = React.useState(null)
        const [busy, setBusy] = React.useState({})
        const [errors, setErrors] = React.useState({})
        const [notice, setNotice] = React.useState(null)
        const [roots, setRoots] = React.useState([])
        const [modal, setModal] = React.useState(null)                        // null | create | install
        const [detail, setDetail] = React.useState(null)
        // A card of the Yours tab opens its panel on the right (`local`, the skill); a row of Discover opens `detail` (the index entry).
        // The list stays on screen in both cases: the panel sits next to it.
        const [local, setLocal] = React.useState(null)
        // The skill's REAL SKILL.md, what the host will let the screen do with it (`actions`), its folder: asked of the host when the panel
        // opens (POST /kybernos-skills/skill/read), kept here so that it survives the parent re-rendering.
        const [localRead, setLocalRead] = React.useState({ state: 'idle', data: null, error: '' })
        const localKey = local === null ? '' : skillKey(local)
        React.useEffect(() => {
          if (local === null) { setLocalRead({ state: 'idle', data: null, error: '' }); return undefined }
          let stopped = false
          setLocalRead({ state: 'loading', data: null, error: '' })
          postJson('/kybernos-skills/skill/read', { root: local.root, name: local.name }).then((j) => {
            if (stopped === true || alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && typeof j.text === 'string') setLocalRead({ state: 'ready', data: j, error: '' })
            else setLocalRead({ state: 'error', data: null, error: why(j, t('err.unexpected', { r: 'skill' })) })
          }).catch(() => {
            if (stopped !== true && alive.current === true) setLocalRead({ state: 'error', data: null, error: t('err.unavail', { r: 'skill' }) })
          })
          return () => { stopped = true }
        }, [localKey])
        // What a Discover card knows beyond the index: the folder, description and start of SKILL.md of the skill in ITS repository.
        const [preview, setPreview] = React.useState({ state: 'idle', data: null, error: '' })
        // The two confirmations: install (a Discover entry) and delete (a skill of Yours). Nothing is written before the click inside them.
        const [askInstall, setAskInstall] = React.useState(null)
        const [askDelete, setAskDelete] = React.useState(null)
        // Featured: the highlighted list, controlled by the user. `items` follows the order of the
        // file; an item `found:false` (skill gone from the registry) is skipped at render, not erased.
        const [feat, setFeat] = React.useState({ phase: 'idle', items: [] })
        // The picks Kybernos proposes (GET /kybernos-skills/picks): `absent` = a host that does not have the route, or an empty file.
        const [picks, setPicks] = React.useState({ phase: 'loading', items: [], asOf: '' })
        const [pcat, setPcat] = React.useState('all')                            // all | one of the picks' categories
        // The field of work the person chose (`window.__KB_DOMAIN__`, published by kybernos-plugin): its skills open the Featured tab and its word
        // for this page is the title. Read at each draw; a change of the saved field redraws the page. Absent seam or no field: nothing changes.
        const setDomTick = React.useState(0)[1]
        React.useEffect(() => {
          let stop = null
          try { if (window.__KB_DOMAIN__ && typeof window.__KB_DOMAIN__.subscribe === 'function') stop = window.__KB_DOMAIN__.subscribe(() => setDomTick((n) => n + 1)) } catch (e) { stop = null }
          return () => { try { if (typeof stop === 'function') stop() } catch (e2) { /* gone */ } }
        }, [])
        const [copied, setCopied] = React.useState('')                            // the invocation just copied (`/name`), shown on its button for a moment
        const [shipBusy, setShipBusy] = React.useState({})                        // a shipped skill being installed: name → true
        const [shipDone, setShipDone] = React.useState({})                        // one the route has just installed: shown as installed before the registry has re-read the folder
        // The cover background (the category tint, or the plain card surface), kept in this browser.
        const [coverBg, setCoverBgState] = React.useState(() => {
          try { return window.localStorage.getItem('kybernos.skills.coverbg') === 'plain' ? 'plain' : 'tint' } catch (e) { return 'tint' }
        })
        const setCoverBg = (v) => {
          setCoverBgState(v)
          try { window.localStorage.setItem('kybernos.skills.coverbg', v) } catch (e) { /* a convenience only */ }
        }
        // Team skills: what the account says about the active workspace (its role and counts, or why the tab is locked), the skill
        // that is open, the sub-view, the propose sheet, and a counter that makes the list read again.
        const [tsum, setTsum] = React.useState({ phase: 'loading' })
        const [teamOpen, setTeamOpen] = React.useState(null)
        const [teamView, setTeamView] = React.useState('approved')
        const [teamSheet, setTeamSheet] = React.useState(false)
        const [shareName, setShareName] = React.useState(null)   // the learned skill a hint asks to propose to the team: the sheet opens on it
        const [pendingShare, setPendingShare] = React.useState(null)
        const [teamVer, setTeamVer] = React.useState(0)
        const alive = React.useRef(true)

        React.useEffect(() => () => { alive.current = false }, [])

        // ── skills learned from experience: what Kaby suggests (waiting in a ledger, not active) and what the person accepted ──
        const [learned, setLearned] = React.useState({ phase: 'loading', proposals: [], learned: [], sensitive: false, rules: [], settings: null, week: null, limits: { maxPending: 5, pendingDays: 30, discardedDays: 30 } })
        const [originFilter, setOriginFilter] = React.useState('all')            // all | kaby | learned | mine
        const [review, setReview] = React.useState(null)                          // the suggestion under review: { id, edit, description, body, err }
        const [journalOpen, setJournalOpen] = React.useState(false)
        const [lBusy, setLBusy] = React.useState(false)
        const [lTick, setLTick] = React.useState(0)
        const [bannerOff, setBannerOff] = React.useState(() => { try { return window.localStorage.getItem('kybernos.skills.learned.banner') === 'off' } catch (e) { return false } })
        const loadLearned = React.useCallback(() => getJson('/kybernos-skills/learned').then((j) => {
          if (alive.current !== true) return
          if (j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.proposals)) {
            setLearned({ phase: 'ready', proposals: j.proposals, learned: Array.isArray(j.learned) ? j.learned : [], sensitive: j.sensitive === true, rules: Array.isArray(j.rules) ? j.rules : [], settings: j.settings !== undefined && j.settings !== null ? j.settings : null, week: j.week !== undefined && j.week !== null ? j.week : null, limits: j.limits || { maxPending: 5, pendingDays: 30, discardedDays: 30 } })
            kbLearnedSet(kbLearnedCount(j))
            setLTick((n) => n + 1)
          } else setLearned((p) => ({ ...p, phase: 'absent' }))
        }).catch(() => { if (alive.current === true) setLearned((p) => ({ ...p, phase: 'absent' })) }), [])
        React.useEffect(() => { loadLearned() }, [sid])
        const learnedByName = React.useMemo(() => new Map(learned.learned.map((l) => [l.name, l])), [learned])
        const fromText = (f) => {
          if (f === null || typeof f !== 'object') return ''
          const a = f.automation
          if (a !== undefined && a !== null) return a.name ? t('ln.from.auto', { name: a.name, n: a.runs || 0 }) : ((a.runs || 0) > 0 ? t('ln.from.auto.anon', { n: a.runs }) : t('ln.from.auto.none'))
          if (f.asked === true) return t('ln.from.asked')
          if (f.improve !== undefined && f.improve !== null) return t('ln.from.improve')
          return Array.isArray(f.lessons) ? t('ln.from.lessons', { n: f.lessons.length }) : ''
        }
        // One call to the learned routes: reads the list again on success, says why on a refusal.
        const learnedAct = (path, body, done) => {
          setLBusy(true)
          return postJson('/kybernos-skills/learned/' + path, body).then((j) => {
            if (alive.current !== true) return j
            setLBusy(false)
            if (j !== null && typeof j === 'object' && j.ok === true) { loadLearned(); if (typeof done === 'function') done(j) }
            else {
              const text = why(j, t('err.unexpected', { r: 'learned/' + path }))
              setReview((r) => (r === null ? r : { ...r, err: text }))
              setNotice({ kind: 'err', text })
            }
            return j
          }).catch(() => { if (alive.current === true) { setLBusy(false); setNotice({ kind: 'err', text: t('err.unavail', { r: 'learned/' + path }) }) } })
        }
        const openReview = (p) => { setReview({ id: p.id, edit: false, description: p.description, body: p.body, add: typeof p.add === 'string' ? p.add : '', err: '' }); setLocal(null); setDetail(null); setModal(null); setJournalOpen(false) }
        const acceptLearned = (p) => {
          learnedAct('accept', { id: p.id }, (j) => {
            setReview(null)
            loadCatalogue()
            if (p.kind === 'improve') setNotice({ kind: 'ok', text: t('ln.n.updated', { name: j.name, v: j.ver }), undo: () => learnedAct('undo', { name: j.name }, () => { loadCatalogue(); setNotice({ kind: 'ok', text: t('ln.n.reverted', { name: j.name }) }) }) })
            else setNotice({ kind: 'ok', text: t('ln.n.accepted', { name: j.name }), undo: () => learnedAct('undo', { name: j.name }, () => { loadCatalogue(); setNotice({ kind: 'ok', text: t('ln.n.undone', { name: j.name }) }) }) })
          })
        }
        const discardLearned = (p) => learnedAct('discard', { id: p.id }, (j) => {
          setReview(null)
          setNotice({ kind: 'ok', text: t('ln.n.discarded', { name: j.name, days: learned.limits.discardedDays }), undo: () => learnedAct('restore', { id: p.id }, () => setNotice({ kind: 'ok', text: t('ln.n.restored', { name: j.name }) })) })
        })
        const saveLearned = (p) => learnedAct('edit', { id: p.id, description: review.description, body: review.body, add: review.add }, () => { setReview((r) => (r === null ? r : { ...r, edit: false, err: '' })); setNotice({ kind: 'ok', text: t('ln.n.saved') }) })
        const fixLearned = (p) => {
          const hits = Array.isArray(p.hits) ? p.hits : []
          learnedAct('edit', { id: p.id, description: scrub(p.description, hits, 0), body: scrub(p.body, hits, p.description.length + 1) }, () => setReview((r) => (r === null ? r : { ...r, err: '' })))
        }

        // « Keep »: the person read a change Kaby made on its own and leaves it. « Undo »: the previous version comes back (the host journals both).
        const keepLearned = (name) => learnedAct('keep', { name }, () => setNotice({ kind: 'ok', text: t('ln.n.kept') }))
        const undoLearned = (name) => learnedAct('undo', { name }, (j) => {
          loadCatalogue()
          setNotice({ kind: 'ok', text: t('ln.n.reverted', { name: j.name }) })
        })
        // The chat card and the settings page send the person here with a hint (which suggestion to read, or the journal): read once, then forgotten.
        React.useEffect(() => {
          if (learned.phase !== 'ready') return
          try {
            const wanted = window.sessionStorage.getItem('kybernos.skills.review')
            if (wanted !== null) {
              window.sessionStorage.removeItem('kybernos.skills.review')
              const p = learned.proposals.find((x) => x.id === wanted)
              if (p !== undefined) { setMode('yours'); openReview(p) }
            }
            const share = window.sessionStorage.getItem('kybernos.skills.share')
            if (share !== null) { window.sessionStorage.removeItem('kybernos.skills.share'); setMode('yours'); setPendingShare(share) }
            if (window.sessionStorage.getItem('kybernos.skills.journal') === '1') {
              window.sessionStorage.removeItem('kybernos.skills.journal')
              setMode('yours'); setReview(null); setLocal(null); setDetail(null); setJournalOpen(true)
            }
          } catch (e) { /* no storage: the page opens without the hint */ }
        }, [learned.phase, learned.proposals])

        // « Propose to your team »: the existing Team sheet, opened on that skill. The hint of the weekly card waits for the team summary to answer.
        const openShare = (name) => {
          if (tsum.phase !== 'ready') { setNotice({ kind: 'err', text: t('ln2.s.noteam') }); return }
          setShareName(name); setTeamSheet(true)
        }
        React.useEffect(() => {
          if (pendingShare === null || tsum.phase === 'loading') return
          const name = pendingShare
          setPendingShare(null)
          openShare(name)
        }, [pendingShare, tsum.phase])

        // Closing the three popovers (Filters, Sort, Create/Install) on an outside click and
        // on Escape. Without this, an open menu only closed through its own button: you
        // could click in the list, switch tabs, and leave it open behind. Same
        // mechanics as the pivot's popovers (.kb6-tb-mwrap): a click inside the popover or on
        // its button does not close it, everything else does.
        React.useEffect(() => {
          if (showFilters !== true && sortOpen !== true && addOpen !== true) return undefined
          const ferme = () => { setShowFilters(false); setSortOpen(false); setAddOpen(false) }
          const onDown = (e) => {
            try {
              if (e !== null && e.target !== null && typeof e.target.closest === 'function' && e.target.closest('.kb-menu-wrap') !== null) return
            } catch (e2) { /* exotic target */ }
            ferme()
          }
          const onKey = (e) => { if (e !== null && e.key === 'Escape') ferme() }
          document.addEventListener('mousedown', onDown, true)
          document.addEventListener('keydown', onKey, true)
          return () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey, true) }
        }, [showFilters, sortOpen, addOpen])

        const loadCatalogue = React.useCallback(() => {
          setCatPhase('loading')
          getJson('/kybernos-skills/skills').then((j) => {
            if (alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true) { setCat(j); setCatPhase('ready'); setCatError('') }
            else { setCatPhase('error'); setCatError(why(j, t('err.unexpected', { r: 'skills' }))) }
          }).catch(() => {
            if (alive.current !== true) return
            setCatPhase('error'); setCatError(t('err.unavail', { r: 'skills' }))
          })
        }, [sid])

        const loadFeatured = React.useCallback(() => {
          getJson('/kybernos-skills/featured').then((j) => {
            if (alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.items)) {
              setFeat({ phase: 'ready', items: j.items })
            } else setFeat({ phase: 'error', items: [] })
          }).catch(() => { if (alive.current === true) setFeat({ phase: 'error', items: [] }) })
        }, [sid])

        const loadPicks = React.useCallback(() => {
          getJson('/kybernos-skills/picks').then((j) => {
            if (alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.items) && j.items.length > 0) {
              setPicks({ phase: 'ready', items: j.items, asOf: typeof j.asOf === 'string' ? j.asOf : '' })
            } else setPicks({ phase: 'absent', items: [], asOf: '' })
          }).catch(() => { if (alive.current === true) setPicks({ phase: 'absent', items: [], asOf: '' }) })
        }, [])
        React.useEffect(() => { if (picks.phase === 'absent') setMode((m) => (m === 'featured' ? 'yours' : m)) }, [picks.phase])

        // Star = feature / unfeature. The response carries the up-to-date list: we follow it as is,
        // without reloading — one round trip less, and the displayed order stays the file's.
        // POST on /featured/toggle (and not /featured): the webServer's exact table is indexed
        // by path alone, a GET+POST on the same path throws "duplicate" AT MOUNT (measured).
        const toggleFeatured = (name, reason) => {
          postJson('/kybernos-skills/featured/toggle', { name, why: reason || '' }).then((j) => {
            if (alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.items)) {
              setFeat((m) => ({ ...m, phase: 'ready', items: j.items }))
              setNotice({ kind: 'ok', text: j.featured === true ? t('notice.featOn', { name }) : t('notice.featOff', { name }) })
            } else setNotice({ kind: 'err', text: why(j, t('err.feat')) })
          }).catch(() => {
            if (alive.current === true) setNotice({ kind: 'err', text: t('err.unavail', { r: 'featured' }) })
          })
        }

        // One cheap call tells the tab what to show: the count, a dot when an admin has proposals to review, a lock and the reason, or
        // nothing at all when kybernos-cloud is not loaded (its routes then answer a page, not JSON).
        const loadTeam = React.useCallback(() => {
          fetch('/kybernos-cloud/team/skills?view=approved&limit=1', { headers: { accept: 'application/json' } })
            .then((r) => r.json().then((j) => j, () => null))
            .then((j) => {
              if (alive.current !== true) return
              if (j === null || typeof j !== 'object') { setTsum({ phase: 'absent' }); return }
              if (j.ok === true) setTsum({ phase: 'ready', role: j.role, counts: j.counts !== null && typeof j.counts === 'object' ? j.counts : { approved: 0, pending: 0 }, workspaceName: typeof j.workspaceName === 'string' ? j.workspaceName : '' })
              else setTsum({ phase: 'locked', kind: teamLockOf(typeof j.error === 'string' ? j.error : ''), detail: typeof j.error === 'string' ? j.error : '' })
            })
            .catch(() => { if (alive.current === true) setTsum({ phase: 'absent' }) })
        }, [])

        // The workspace may have changed in the sidebar since the last look: read again whenever the tab is opened.
        React.useEffect(() => { if (mode === 'team') loadTeam() }, [mode])

        // `curatedOwners` is { byRepo: owner/repo → publisher, ids: Set of owner/repo/name }. It used to be keyed by the skill's NAME: the first curated skill of that name gave its publisher to every other skill called the same: 250
        // names are shared by several publishers, and `grill-me` of mattpocock/skills read « published by flutter ».
        const loadCuratedOwners = React.useCallback(() => {
          getJson('/kybernos-skills/curated').then((j) => {
            if (alive.current !== true) return
            const owners = (j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.owners)) ? j.owners : []
            const byRepo = {}
            const ids = new Set()
            for (const o of owners) {
              const owner = o !== null && typeof o === 'object' && typeof o.owner === 'string' ? o.owner : ''
              if (owner === '') continue
              for (const s of (Array.isArray(o.skills) ? o.skills : [])) {
                if (s === null || typeof s !== 'object' || typeof s.source !== 'string' || typeof s.name !== 'string') continue
                if (byRepo[s.source] === undefined) byRepo[s.source] = owner
                ids.add(s.source + '/' + s.name)
              }
            }
            setCuratedOwners({ byRepo, ids })
          }).catch(() => { /* no curated set (route or relay absent): the owner row is simply not shown */ })
        }, [])

        const loadSource = React.useCallback(() => {
          getJson('/kybernos-skills/index-source').then((j) => {
            if (alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && j.source !== null && typeof j.source === 'object') setSrc(j.source)
          }).catch(() => { /* a host from before this setting has no such route: the line is simply not shown */ })
        }, [])

        React.useEffect(() => {
          loadCatalogue()
          loadFeatured()
          loadPicks()
          loadTeam()
          loadSource()
          loadCuratedOwners()
          getJson('/kybernos-skills/status').then((j) => {
            if (alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.roots)) {
              setRoots(j.roots.filter((r) => r !== null && typeof r.path === 'string'))
            }
          }).catch(() => { /* without roots, the modals fall back on the host, which revalidates everything */ })
        }, [loadCatalogue, loadFeatured, loadTeam, loadSource, loadCuratedOwners])

        // One request for the three paginated views, another for the search, one for the curated
        // set. The server announces `total` and `hasMore`: pagination guesses nothing, and that is
        // precisely what was missing when we scraped 571 entries from a page of 9 827 skills.
        const dq = q.discover
        const dneedle = dq.trim()
        const discKind = dneedle.length >= 2 ? 'search' : (iview === 'curated' ? 'curated' : 'index')
        React.useEffect(() => {
          if (mode !== 'discover') return undefined
          let stopped = false
          let retryTimer = null
          const auto = manualRetry.current !== true
          manualRetry.current = false
          setDiscPhase('loading')
          const route = discKind === 'search'
            ? '/kybernos-skills/search?q=' + encodeURIComponent(dneedle) + '&limit=100'
            : (discKind === 'curated'
              ? '/kybernos-skills/curated'
              : '/kybernos-skills/index?view=' + encodeURIComponent(iview) + '&page=' + ipage + '&perPage=' + iper)
          // A relay that answers 502 / 503 / 504, or a network that blinks, is usually back a moment later: the page asks once more
          // by itself before saying anything. A refused address, a 404 or an unreadable answer is not transient, and a second
          // attempt after that one is the user's (« Try again »).
          const transient = (j) => j !== null && typeof j === 'object' && (j.error === 'timeout' || j.error === 'network_unavailable' ||
            (j.error === 'index_unavailable' && [500, 502, 503, 504].indexOf(j.http) >= 0))
          const fail = (j, text) => {
            const code = (j !== null && typeof j === 'object' && typeof j.error === 'string') ? j.error : 'noanswer'
            // A code the page has no sentence for is never the sentence: the page says it cannot reach the index, and keeps the code in a tooltip (audit R-A3-03).
            const worded = code === 'noanswer' || code === '' || STR['he.' + code] !== undefined
            setDiscPhase('error')
            setDiscErr({ text: worded ? text : t('d.cannot'), raw: worded ? undefined : code, code, http: (j !== null && typeof j === 'object') ? j.http : undefined })
          }
          const go = (first) => {
            getJson(route).then((j) => {
              if (stopped === true || alive.current !== true) return
              if (j !== null && typeof j === 'object' && j.ok === true) { setDisc(j); setDiscPhase('ready'); setDiscErr(null); return }
              if (first === true && auto === true && transient(j) === true) { retryTimer = setTimeout(() => go(false), 1500); return }
              fail(j, why(j, t('err.index')))
            }).catch(() => {
              if (stopped === true || alive.current !== true) return
              // This `catch` is the one for OUR route (DSH itself): the index has nothing to do with it, and the state says so.
              if (first === true && auto === true) { retryTimer = setTimeout(() => go(false), 1500); return }
              fail(null, t('err.noanswer'))
            })
          }
          // The debounce only makes sense for typing: the other requests start from a click.
          const timer = setTimeout(() => go(true), discKind === 'search' ? 350 : 0)
          return () => { stopped = true; clearTimeout(timer); if (retryTimer !== null) clearTimeout(retryTimer) }
        }, [mode, dneedle, discKind, iview, ipage, iper, discTick])

        // Any filter change goes back to the first page: otherwise we can end up
        // on an empty page after narrowing a search.
        React.useEffect(() => { setPage((p) => ({ ...p, yours: 1 })) }, [q.yours, stateFilter, sourceFilter, sort.yours, dir.yours])
        React.useEffect(() => { setIpage(0) }, [dneedle, iview, iper])

        // Audits are requested ONLY for the open skill: one request per row would be
        // rude for a fifty-row table.
        React.useEffect(() => {
          if (detail === null) { setAudit(null); return undefined }
          let stopped = false
          setAudit({ phase: 'loading' })
          getJson('/kybernos-skills/audit?source=' + encodeURIComponent(detail.source) + '&skill=' + encodeURIComponent(detail.name)).then((j) => {
            if (stopped === true || alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true) {
              setAudit({ phase: 'ready', audits: Array.isArray(j.audits) ? j.audits : [], note: j.note })
            } else {
              setAudit({ phase: 'error', error: why(j, t('err.audit')) })
            }
          }).catch(() => {
            if (stopped !== true && alive.current === true) setAudit({ phase: 'error', error: t('err.unavail', { r: 'audit' }) })
          })
          return () => { stopped = true }
        }, [detail])

        // The same for the preview: asked only for the open card, only for a GitHub source (the others cannot be read this way), and a
        // card that is closed or replaced drops its answer.
        React.useEffect(() => {
          if (detail === null) { setPreview({ state: 'idle', data: null, error: '' }); return undefined }
          if (detail.installable !== true) { setPreview({ state: 'none', data: null, error: '' }); return undefined }
          let stopped = false
          setPreview({ state: 'loading', data: null, error: '' })
          getJson('/kybernos-skills/preview?source=' + encodeURIComponent(detail.source) + '&name=' + encodeURIComponent(detail.name)).then((j) => {
            if (stopped === true || alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true) setPreview({ state: j.found === true ? 'ready' : 'missing', data: j, error: '' })
            else setPreview({ state: 'error', data: null, error: why(j, t('err.preview')) })
          }).catch(() => {
            if (stopped !== true && alive.current === true) setPreview({ state: 'error', data: null, error: t('err.unavail', { r: 'preview' }) })
          })
          return () => { stopped = true }
        }, [detail === null ? '' : detail.source + '/' + detail.name])

        React.useEffect(() => {
          if (notice === null) return undefined
          const t = setTimeout(() => { if (alive.current === true) setNotice(null) }, typeof notice.undo === 'function' ? 9000 : 4200)
          return () => clearTimeout(t)
        }, [notice])

        const skills = (cat !== null && Array.isArray(cat.skills)) ? cat.skills : []
        const activeCount = skills.filter((s) => s.active === true).length
        const sources = React.useMemo(() => {
          const set = new Set()
          skills.forEach((s) => { if (typeof s.source === 'string' && s.source !== '') set.add(s.source) })
          return Array.from(set).sort()
        }, [skills])

        const filtered = React.useMemo(() => {
          const needle = q.yours.trim().toLowerCase()
          let list = skills
          if (needle !== '') {
            list = list.filter((s) => String(s.name).toLowerCase().includes(needle) ||
              String(s.description || '').toLowerCase().includes(needle) ||
              String(s.whenToUse || '').toLowerCase().includes(needle))
          }
          if (stateFilter === 'active') list = list.filter((s) => s.active === true)
          if (stateFilter === 'disabled') list = list.filter((s) => s.active !== true)
          if (sourceFilter !== 'all') list = list.filter((s) => s.source === sourceFilter)
          if (originFilter === 'kaby') list = []
          if (originFilter === 'learned') list = list.filter((s) => learnedByName.has(s.name))
          if (originFilter === 'mine') list = list.filter((s) => !learnedByName.has(s.name))
          const copy = list.slice()
          const d = dir.yours, k = sort.yours
          copy.sort((a, b) => k === 'name'
            ? d * String(a.name).localeCompare(String(b.name))
            : d * String(a.modifiedAt || '').localeCompare(String(b.modifiedAt || '')))
          return copy
        }, [skills, q.yours, stateFilter, sourceFilter, originFilter, learnedByName, sort.yours, dir.yours])

        // The three response shapes are reduced to ONE list, so the render only has one case.
        //   index   : { skills, total, hasMore, page }
        //   search  : { skills, count, durationMs }
        //   curated : { owners[{owner, skills[]}], totalOwners, totalSkills }
        // The curated set is flattened and marked `official`: the badge finally comes from a first-party SET,
        // and no longer from a flag picked out of a page's HTML.
        const discList = React.useMemo(() => {
          if (disc === null) return []
          if (discKind === 'curated') {
            const owners = Array.isArray(disc.owners) ? disc.owners : []
            const flat = []
            owners.forEach((o) => {
              (Array.isArray(o.skills) ? o.skills : []).forEach((s) => { flat.push({ ...s, official: true, owner: o.owner }) })
            })
            return flat.sort((a, b) => (b.installs || 0) - (a.installs || 0))
          }
          const items = Array.isArray(disc.skills) ? disc.skills : []
          const copy = items.slice()
          if (discKind === 'index') {
            const d = dir.discover, k = sort.discover
            copy.sort((a, b) => k === 'name'
              ? d * String(a.name).localeCompare(String(b.name))
              : d * ((a.installs || 0) - (b.installs || 0)))
          }
          return copy
        }, [disc, discKind, sort.discover, dir.discover])

        // ── ranking pagination ────────────────────────────────────────────────
        // It comes from the SERVER for the three ranked views; the curated set is rendered
        // in one block (100 owners, 6 533 skills) and is paginated locally.
        const discTotal = discKind === 'index'
          ? (disc !== null && Number.isFinite(disc.total) ? disc.total : discList.length)
          : (discKind === 'search'
            ? (disc !== null && Number.isFinite(disc.count) ? disc.count : discList.length)
            : discList.length)
        const discPages = Math.max(1, Math.ceil(discTotal / iper))
        // The DISPLAYED page is the one of the data RECEIVED, never the one we just asked for:
        // during loading, `ipage` advances before the response, and the "#" column would then show
        // the ranks of page 3 above the rows of page 1 — observed for real.
        const discPage = discKind === 'index'
          ? (disc !== null && Number.isFinite(disc.page) ? disc.page : ipage)
          : Math.min(ipage, discPages - 1)
        const discShown = discKind === 'index' ? discList : discList.slice(discPage * iper, discPage * iper + iper)
        const discFrom = discTotal === 0 ? 0 : discPage * iper + 1
        const discTo = discKind === 'index' ? Math.min((discPage + 1) * iper, discTotal) : Math.min(discPage * iper + discShown.length, discTotal)

        // ── actions ───────────────────────────────────────────────────────────
        const toggle = (skill) => {
          if (skill.writable !== true) return
          const k = skillKey(skill)
          if (busy[k] === true) return
          setErrors((m) => { const n = { ...m }; delete n[k]; return n })
          setBusy((m) => ({ ...m, [k]: true }))
          postJson('/kybernos-skills/toggle', { root: skill.root, name: skill.name, active: skill.active !== true }).then((j) => {
            if (alive.current !== true) return
            setBusy((m) => { const n = { ...m }; delete n[k]; return n })
            if (j !== null && typeof j === 'object' && j.ok === true) {
              // ARB-3: "changed" is true or false, both are successes — the displayed
              // state first follows the returned skill, then the list is resynchronized.
              if (j.skill !== null && typeof j.skill === 'object') {
                const ret = j.skill
                setCat((c) => c === null ? c : { ...c, skills: c.skills.map((s) => (s.root === ret.root && s.name === ret.name) ? ret : s) })
              }
              loadCatalogue()
              setNotice({ kind: 'ok', text: skill.active === true ? t('notice.off', { name: skill.name }) : t('notice.on', { name: skill.name }) })
            } else {
              setErrors((m) => ({ ...m, [k]: why(j, t('err.unexpected', { r: 'toggle' })) }))
            }
          }).catch(() => {
            if (alive.current !== true) return
            setBusy((m) => { const n = { ...m }; delete n[k]; return n })
            setErrors((m) => ({ ...m, [k]: t('err.unavail', { r: 'toggle' }) }))
          })
        }

        const copy = (text) => {
          try {
            if (navigator !== undefined && navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
              navigator.clipboard.writeText(text).then(
                () => {
                  if (alive.current !== true) return
                  setNotice({ kind: 'ok', text: t('copy.ok', { text }) })
                  setCopied(text)
                  setTimeout(() => { if (alive.current === true) setCopied((c) => (c === text ? '' : c)) }, 1800)
                },
                () => { if (alive.current === true) setNotice({ kind: 'err', text: t('copy.denied') }) })
              return
            }
          } catch (e) { /* fallback below */ }
          setNotice({ kind: 'err', text: t('copy.unavail') })
        }

        // « Try again » on the index: the same request once more, with no automatic extra attempt.
        const retryDiscover = () => { manualRetry.current = true; setDiscTick((n) => n + 1) }

        // Names another relay (or, with an empty address, puts the Kybernos one back). The host validates with the same rule as the
        // environment variable; what it answers is shown as it is. A new source drops what was shown from the old one.
        const saveSource = (url) => {
          if (srcBusy === true) return
          setSrcBusy(true); setSrcErr('')
          postJson('/kybernos-skills/index-source/set', { url }).then((j) => {
            if (alive.current !== true) return
            setSrcBusy(false)
            if (j !== null && typeof j === 'object' && j.ok === true && j.source !== null && typeof j.source === 'object') {
              setSrc(j.source); setSrcOpen(false)
              setNotice({ kind: 'ok', text: j.source.origin === 'setting' ? t('src.savedCustom', { host: j.source.host }) : t('src.savedDefault') })
              setDisc(null); setDiscErr(null); setIpage(0); manualRetry.current = true; setDiscTick((n) => n + 1)
            } else setSrcErr(why(j, t('err.source')))
          }).catch(() => {
            if (alive.current !== true) return
            setSrcBusy(false); setSrcErr(t('err.unavail', { r: 'index-source' }))
          })
        }

        const count = catPhase === 'ready' ? String(skills.length) : '0'
        const shownYours = filtered.slice(0, page.yours * PAGE)

        // Opening a modal starts from a clean screen: without this, the error of the previous
        // attempt would stay displayed above a still-empty form.
        const openModal = (kind) => {
          setErrors((m) => { const n = { ...m }; delete n.__modal; return n })
          setModal(kind)
        }

        // ── fragments ─────────────────────────────────────────────────────────
        const primary = (label, act, ic, disabled, title) => h('button', {
          type: 'button', className: 'kb8-primary', onClick: act, disabled: disabled === true, title: title
        }, ic ? icon(ic, 15) : null, h('span', null, label))

        const renderSortMenu = () => {
          const isYours = mode === 'yours'
          const k = isYours ? sort.yours : sort.discover
          const opts = isYours
            ? [['recent', t('sort.recent'), t('sort.recent.sub')], ['name', t('sort.name'), t('sort.alpha')]]
            : [['installs', t('sort.installs'), t('sort.installs.sub')], ['name', t('sort.name'), t('sort.alpha')]]
          const d = isYours ? dir.yours : dir.discover
          return h('div', { className: 'kb-sortmenu' },
            h('div', { className: 'kb-sort-head' },
              h('span', { className: 'lbl' }, t('sort.by')),
              h('button', {
                type: 'button', className: 'kb-dir', title: d === -1 ? t('sort.desc') : t('sort.asc'),
                onClick: () => setDir((m) => isYours ? { ...m, yours: -m.yours } : { ...m, discover: -m.discover })
              }, d === -1 ? '↓' : '↑')),
            opts.map((o) => h('button', {
              key: o[0], type: 'button', className: 'kb-sort-opt' + (k === o[0] ? ' on' : ''),
              onClick: () => { setSort((m) => isYours ? { ...m, yours: o[0] } : { ...m, discover: o[0] }); setSortOpen(false) }
            }, h('span', { className: 'tk' }, icon('check', 13)),
               h('span', { className: 'tx' }, h('span', null, o[1]), h('span', { className: 'sub' }, o[2])))),
            h('div', { className: 'kb-sort-note' }, icon('info', 13),
              h('span', null, isYours
                ? t('sort.noteYours')
                : t('sort.noteDisc', { v: iview }))))
        }

        const chip = (label, on, act, key) => h('button', {
          key: key || label, type: 'button', className: 'kb8-chip' + (on ? ' on' : ''), onClick: act
        }, label)

        // VIEWS offered by the official API. "Curated" is not a ranking but the first-party
        // set: it is therefore presented separately, and it marks its entries `official`.
        const VUES = [
          ['all-time', 'All Time', t('view.alltime')],
          ['trending', 'Trending', t('view.trending')],
          ['hot', 'Hot', t('view.hot')],
          ['curated', 'Curated', t('view.curated')]
        ]

        const razoirFiltres = () => {
          if (mode === 'discover') { setIview('all-time'); setIper(DISC_PER) }
          else { setStateFilter('all'); setSourceFilter('all'); setOriginFilter('all') }
        }
        // Number of active filters: the state is read on the button (.kb-tool-lab .n), like the
        // "Filters 1" of the pivot. In Discover the view is written in plain text on the button, so only
        // the rows-per-page setting counts here.
        const filtresActifs = () => mode === 'discover'
          ? (iper === DISC_PER ? 0 : 1)
          : (stateFilter === 'all' ? 0 : 1) + (sourceFilter === 'all' ? 0 : 1) + (originFilter === 'all' ? 0 : 1)
        const vueLabel = () => { const v = VUES.filter((x) => x[0] === iview)[0]; return v !== undefined ? v[1] : 'All Time' }
        const sortLabel = (isYours) => {
          const k = isYours ? sort.yours : sort.discover
          const v = (isYours
            ? [['recent', t('sort.recent')], ['name', t('sort.name')]]
            : [['installs', t('sort.installs')], ['name', t('sort.name')]]).filter((x) => x[0] === k)[0]
          return v !== undefined ? v[1] : t('sort.fallback')
        }

        const renderFilters = () => {
          const tete = h('div', { className: 'head' },
            h('span', { className: 't' }, mode === 'discover' ? t('flt.rankrows') : t('flt.title')),
            h('button', { type: 'button', className: 'raz', onClick: razoirFiltres }, t('flt.reset')))
          if (mode === 'discover') {
            return h('div', { className: 'kb-filters' }, tete,
              h('div', { className: 'kb-filter-row' },
                h('span', { className: 'lbl' }, t('flt.view')),
                VUES.map((v) => chip(v[1] + (v[0] === 'all-time' && discTotal > 0 && discKind === 'index' ? ' (' + discTotal + ')' : ''), iview === v[0], () => setIview(v[0]), v[0]))),
              h('div', { className: 'kb-filter-row' },
                h('span', { className: 'lbl' }, t('flt.rows')),
                [DISC_PER, 50, 100, 250].map((n) => chip(String(n), iper === n, () => setIper(n), 'n' + n))),
              h('div', { className: 'kb-filter-row' },
                h('span', { className: 'lbl' }, 'Source'),
                h('span', { className: 'kb8-mono' }, discKind === 'search'
                  ? t('src.search', { n: discList.length, total: discTotal, ms: (disc !== null && Number.isFinite(disc.durationMs) ? disc.durationMs + ' ms' : t('src.unknownDur')) })
                  : (discKind === 'curated'
                    ? t('src.curated', { n: discTotal, o: (disc !== null && Number.isFinite(disc.totalOwners) ? disc.totalOwners : '?'), d: String(disc !== null && disc.generatedAt ? disc.generatedAt : '').slice(0, 10) })
                    : t('src.index', { n: discTotal, v: iview })))))
          }
          return h('div', { className: 'kb-filters' }, tete,
            h('div', { className: 'kb-filter-row' },
              h('span', { className: 'lbl' }, t('flt.state')),
              chip(t('flt.all'), stateFilter === 'all', () => setStateFilter('all')),
              chip(t('flt.active', { n: activeCount }), stateFilter === 'active', () => setStateFilter('active')),
              chip(t('flt.disabled', { n: skills.length - activeCount }), stateFilter === 'disabled', () => setStateFilter('disabled'))),
            h('div', { className: 'kb-filter-row' },
              h('span', { className: 'lbl' }, t('f.root')),
              chip(t('flt.allf'), sourceFilter === 'all', () => setSourceFilter('all')),
              sources.map((s) => chip(s, sourceFilter === s, () => setSourceFilter(s), s))),
            learned.proposals.length + learned.learned.length > 0 ? h('div', { className: 'kb-filter-row' },
              h('span', { className: 'lbl' }, t('ln.f.origin')),
              chip(t('flt.allf'), originFilter === 'all', () => setOriginFilter('all'), 'org-all'),
              chip(t('ln.f.kaby') + ' · ' + learned.proposals.length, originFilter === 'kaby', () => setOriginFilter('kaby'), 'org-kaby'),
              chip(t('ln.f.learned') + ' · ' + learned.learned.length, originFilter === 'learned', () => setOriginFilter('learned'), 'org-learned'),
              chip(t('ln.f.mine'), originFilter === 'mine', () => setOriginFilter('mine'), 'org-mine')) : null)
        }

        const renderAdd = () => {
          const isYours = mode === 'yours' || mode === 'featured'
          return h('div', { className: 'kb-menu-wrap' },
                h('button', {
                  type: 'button', className: 'kb8-primary',
                  onClick: () => { setAddOpen(!addOpen); setSortOpen(false); setShowFilters(false) }
                }, icon('plus', 16), h('span', null, isYours ? t('add.create') : t('add.install')), icon('chev', 14)),
                addOpen ? h('div', { className: 'kb-menu' },
                  (isYours
                    ? [['wand', t('add.create'), 'create'], ['github', t('add.github'), 'install'], ['search', t('add.search'), 'discover']]
                    : [['plus', t('add.manual'), 'install'], ['search', t('add.top'), 'featured']]
                  ).map((a) => h('button', {
                    key: a[2], type: 'button',
                    onClick: () => {
                      setAddOpen(false)
                      if (a[2] === 'discover') setMode('discover')
                      else if (a[2] === 'featured') { setQ((m) => ({ ...m, discover: '' })); setIview('all-time'); setIpage(0); setMode('discover') }
                      else openModal(a[2])
                    }
                  }, icon(a[0], 17), h('span', null, a[1]))))
                  : null)
        }

        const renderToolbar = () => {
          const isFeat = mode === 'featured'
          const isYours = mode === 'yours' || isFeat
          return h('div', null,
            h('div', { className: 'kb-toolbar' },
              h('div', { className: 'kb8-search' }, icon('search', 14),
                h('input', {
                  placeholder: isFeat ? t('ph.featured') : (isYours ? t('ph.yours') : t('ph.discover')),
                  value: isFeat ? q.featured : (isYours ? q.yours : q.discover),
                  onChange: (e) => { const v = e.target.value; setQ((m) => isFeat ? { ...m, featured: v } : (isYours ? { ...m, yours: v } : { ...m, discover: v })) }
                })),
              isFeat ? null : h('div', { className: 'kb-menu-wrap' },
                h('button', {
                  type: 'button', className: 'kb-tool-lab' + (showFilters ? ' on' : ''), title: isYours ? t('flt.title') : t('flt.viewTitle'),
                  onClick: () => { setShowFilters(!showFilters); setSortOpen(false); setAddOpen(false) }
                }, icon('sliders', 16),
                  h('span', null, isYours ? t('flt.title') : t('flt.viewPrefix') + vueLabel()),
                  filtresActifs() > 0 ? h('span', { className: 'n' }, String(filtresActifs())) : null,
                  icon('chev', 14)),
                showFilters ? renderFilters() : null),
              isFeat ? null : h('div', { className: 'kb-menu-wrap' },
                h('button', { type: 'button', className: 'kb-tool-lab' + (sortOpen ? ' on' : ''), title: t('sort.by'), onClick: () => { setSortOpen(!sortOpen); setAddOpen(false); setShowFilters(false) } }, icon('sort', 16), h('span', null, sortLabel(isYours)), icon('chev', 14)),
                sortOpen ? renderSortMenu() : null)
            ),
            // The filter panel now lives INSIDE the .kb-menu-wrap of its button
            // (anchored popover, .kb6-tb-pop convention of the pivot): no more inline card
            // pushing the list down. The state stays readable on the labelled button.
            null)
        }

        const renderTeamToolbar = () => h('div', { className: 'kb-toolbar' },
          h('div', { className: 'kb8-search' }, icon('search', 14),
            h('input', { placeholder: t('tm.search'), value: q.team, onChange: (e) => { const v = e.target.value; setQ((m) => ({ ...m, team: v })) } })),
          primary(teamRoleAdmin(tsum.role) ? t('tm.add') : t('tm.propose'), () => setTeamSheet(true), 'plus'))

        const renderTeam = () => {
          if (tsum.phase === 'loading') return skeletonOf('team', 5) || h('div', { className: 'kb-empty' }, h('span', { className: 'kb8-mono' }, t('tm.loading')))
          if (tsum.phase !== 'ready') return h(TeamLocked, { kind: tsum.phase === 'locked' ? tsum.kind : 'other', detail: tsum.detail, onRetry: loadTeam, onBack: () => setMode('yours') })
          return h(TeamSkills, {
            sum: tsum, local: skills, roots, needle: q.team, view: teamView, onView: setTeamView, ver: teamVer, openId: teamOpen, onOpen: setTeamOpen,
            notify: setNotice, onChanged: loadCatalogue, onSummary: loadTeam
          })
        }

        const yourCard = (s, i) => {
          const k = skillKey(s)
          const on = s.active === true
          const err = errors[k]
          // The card opens its panel on the right: its inner buttons stop the propagation and keep their own action.
          const pick = () => { setLocal(s); setDetail(null); setModal(null); setReview(null); setJournalOpen(false) }
          return h('div', {
            key: k, className: 'kb8-card' + (local !== null && skillKey(local) === k ? ' sel' : '') + appear(i), role: 'button', tabIndex: 0,
            'aria-label': s.name + ' — ' + t('cap.detail'), 'data-kb': 'skill-card-' + k,
            onClick: pick,
            onKeyDown: (e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick() } }
          },
            h('div', { className: 'kb-row' },
              tile(s.name, 'pkg'),
              // The card says what the skill is and does. Where it lives (its source, its folder) and when it was last changed are in its panel.
              h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0, gap: '2px', flex: '1' } },
                h('span', { className: 'kb8-name' }, s.name)),
              s.writable === true
                ? h('button', {
                    type: 'button', className: 'kb-sw' + (on ? ' on' : ''), title: on ? t('card.disable') : t('card.enable'),
                    disabled: busy[k] === true, onClick: (e) => { e.stopPropagation(); toggle(s) }
                  }, h('i', null))
                : h('span', { className: 'kb8-pill' }, t('card.readonly')),
              h('button', {
                type: 'button', className: 'kbs-star-btn' + (featNames.has(s.name) ? ' on' : ''),
                title: featNames.has(s.name) ? t('feat.remove') : t('feat.add'),
                onClick: (e) => { e.stopPropagation(); toggleFeatured(s.name) }
              }, icon('star', 14))),
            h('div', { className: 'desc' }, s.description !== '' ? s.description : t('card.nodesc')),
            h('div', { className: 'kb8-pills' },
              on ? h('span', { key: 'st', className: 'kb8-pill ok' }, t('card.active')) : h('span', { key: 'st', className: 'kb8-pill warn' }, t('card.disabled')),
              s.collision === true ? h('span', { key: 'co', className: 'kb8-pill warn' }, t('card.dup')) : null,
              s.writable !== true ? h('span', { key: 'ro', className: 'kb8-pill' }, t('card.noedit')) : null,
              learnedByName.has(s.name) ? h('span', { key: 'ln', className: 'kb8-pill kbl-lrn', 'data-kb': 'learned-badge' }, icon('wand', 11), t('ln.badge.learned')) : null,
              learnedByName.has(s.name) && learnedByName.get(s.name).ver > 1 ? h('span', { key: 'lv', className: 'kb8-pill', 'data-kb': 'learned-ver' }, t('ln.chip.ver', { v: learnedByName.get(s.name).ver })) : null,
              learnedByName.has(s.name) && learnedByName.get(s.name).auto === true ? h('span', { key: 'la', className: 'kb8-pill kbl-sug', 'data-kb': 'learned-auto' }, icon('wand', 11), t(learnedByName.get(s.name).reviewed === false ? 'ln.chip.auto.new' : 'ln.chip.auto')) : null,
              learnedByName.has(s.name) && learnedByName.get(s.name).shared === true ? h('span', { key: 'lh', className: 'kb8-pill ok', 'data-kb': 'learned-shared' }, t('ln2.chip.shared')) : null,
              learnedByName.has(s.name) && learnedByName.get(s.name).shareReady === true ? h('span', { key: 'lr', className: 'kb8-pill kbl-sug', 'data-kb': 'learned-ready' }, t('ln2.chip.ready')) : null),
            learnedByName.has(s.name) ? h('div', { className: 'kbl-from', 'data-kb': 'learned-from' }, t('ln.card.from', { d: today(learnedByName.get(s.name).acceptedAt), src: fromText(learnedByName.get(s.name).from) })) : null,
            learnedByName.has(s.name) && learnedByName.get(s.name).unusedDays > 0
              ? h('div', { className: 'kbl-from', 'data-kb': 'learned-stale' }, t('ln.stale', { d: learnedByName.get(s.name).unusedDays }), on ? ' ' : null,
                  on ? h('button', { type: 'button', className: 'kbs-link', 'data-kb': 'learned-stale-off', onClick: (e) => { e.stopPropagation(); toggle(s) } }, t('ln.stale.off')) : null)
              : null,
            h('div', { className: 'foot' },
              h('button', {
                type: 'button', className: 'kbs-copy', title: t('card.copyTitle'),
                onClick: (e) => { e.stopPropagation(); copy('/' + s.name) }
              }, icon('code', 12), '/' + s.name)),
            err ? h('div', { className: 'kbs-err' }, err) : null)
        }

        // A suggestion of Kaby as a card in the grid of Yours: dashed, not active, and one button, Review.
        const pendingCard = (p, i) => h('div', {
          key: 'sg-' + p.id, className: 'kb8-card kbl-pend' + (review !== null && review.id === p.id ? ' sel' : '') + appear(i), role: 'button', tabIndex: 0,
          'aria-label': p.name + ' — ' + t('ln.badge.suggested'), 'data-kb': 'learned-card',
          onClick: () => openReview(p),
          onKeyDown: (e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openReview(p) } }
        },
          h('div', { className: 'kb-row' },
            tile(p.name, 'pkg'),
            h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0, gap: '2px', flex: '1' } },
              h('span', { className: 'kb8-name' }, p.name),
              h('span', { className: 'kb8-parent kbs-nowrap' }, fromText(p.from))),
            h('button', { type: 'button', className: 'kbs-star-btn', title: t('ln.discard'), 'aria-label': t('ln.discard') + ' ' + p.name, disabled: lBusy, onClick: (e) => { e.stopPropagation(); discardLearned(p) } }, '✕')),
          h('div', { className: 'desc' }, p.kind === 'improve' ? t('ln.card.imp', { add: p.add }) : p.description),
          h('div', { className: 'kb8-pills' }, h('span', { key: 'sg', className: 'kb8-pill kbl-sug' }, icon('wand', 11), t(p.kind === 'improve' ? 'ln.badge.improve' : 'ln.badge.suggested')), p.score !== undefined ? h('span', { key: 'sc', className: 'kb8-pill', 'data-kb': 'learned-score' }, t('ln.card.score', { s: p.score.total })) : null, p.source !== null && p.source !== undefined && p.source.tainted !== false && (p.kind === 'asked' || p.kind === 'improve') ? h('span', { key: 'ut', className: 'kb8-pill warn' }, t('ln.chip.untrusted')) : null, learned.sensitive ? h('span', { key: 'lo', className: 'kb8-pill' }, t('ln.p.local')) : null),
          h('div', { className: 'foot' }, h('span', null, t('ln.card.note')), h('span', { className: 'grow' }),
            h('button', { type: 'button', className: 'kb8-primary', 'data-kb': 'learned-review', onClick: (e) => { e.stopPropagation(); openReview(p) } }, t('ln.review'))))
        const pendingShown = () => {
          if ((originFilter !== 'all' && originFilter !== 'kaby') || stateFilter !== 'all' || sourceFilter !== 'all') return []
          const needle = q.yours.trim().toLowerCase()
          return needle === '' ? learned.proposals : learned.proposals.filter((p) => p.name.toLowerCase().includes(needle) || p.description.toLowerCase().includes(needle))
        }
        // The reminder above the list, as the Automations one: what Kaby suggests, where it comes from, and Review. Hide keeps nothing but this browser's choice.
        const learnedBanner = () => {
          const list = learned.proposals
          if (list.length === 0 || bannerOff === true || originFilter !== 'all') return null
          const rows = list.map((p) => h('div', { key: 'br-' + p.id, className: 'kbl-brow' },
            h('div', { className: 'kbl-bname' }, h('code', null, p.name), h('span', { className: 'kb8-pill kbl-sug' }, t('ln.kind.' + (p.kind === 'auto' || p.kind === 'asked' || p.kind === 'improve' ? p.kind : (p.from !== null && typeof p.from === 'object' && Array.isArray(p.from.lessons) && p.from.lessons.length === 1 ? 'lesson' : 'lessons'))))),
            h('div', { className: 'kbl-how' }, fromText(p.from)),
            h('div', { className: 'kbl-how' }, learned.sensitive ? icon('lock', 12) : null, learned.sensitive ? ' ' + t('ln.b.local') : t('ln.b.inactive')),
            h('div', { className: 'kbl-acts' },
              h('button', { type: 'button', className: 'kb8-ghost', title: t('ln.discard'), 'aria-label': t('ln.discard') + ' ' + p.name, disabled: lBusy, onClick: () => discardLearned(p) }, '✕'),
              h('button', { type: 'button', className: 'kb8-primary', 'data-kb': 'learned-banner-review', onClick: () => openReview(p) }, t('ln.review')))))
          return h('section', { className: 'kbl-banner', 'data-kb': 'learned-banner', 'aria-label': t('ln.b.title', { n: list.length }) },
            h('div', { className: 'kbl-bh' }, h('i', { className: 'kbl-dot' }),
              h('div', null, h('h3', null, t('ln.b.title', { n: list.length })), h('p', null, t('ln.b.sub', { max: learned.limits.maxPending, days: learned.limits.pendingDays }))),
              h('button', { type: 'button', className: 'kbs-link', 'data-kb': 'learned-banner-hide', onClick: () => { setBannerOff(true); try { window.localStorage.setItem('kybernos.skills.learned.banner', 'off') } catch (e) { /* a convenience only */ } } }, t('ln.b.hide'))),
            rows, h('div', { className: 'kbl-bfoot' }, t('ln.b.foot')))
        }

        // The changes Kaby made on its own that nobody has read yet: what, why (the score) and the two answers. Shown whatever the filter, until each is kept or undone.
        const autoBanner = () => {
          const list = learned.learned.filter((l) => l.auto === true && l.reviewed === false)
          if (list.length === 0) return null
          const th = learned.settings !== null ? learned.settings.threshold : 90
          const rows = list.map((l) => h('div', { key: 'ab-' + l.name, className: 'kbl-brow' },
            h('div', { className: 'kbl-bname' }, h('code', null, l.name), h('span', { className: 'kb8-pill kbl-sug' }, l.ver > 1 ? t('ln.a.improved', { v: l.ver }) : t('ln.a.created'))),
            h('div', { className: 'kbl-how' }, typeof l.score === 'number' ? t('ln.a.score', { s: l.score }) : fromText(l.from)),
            h('div', { className: 'kbl-how' }, t('ln.a.active')),
            h('div', { className: 'kbl-acts' },
              h('button', { type: 'button', className: 'kb8-ghost', 'data-kb': 'learned-auto-undo', disabled: lBusy, onClick: () => undoLearned(l.name) }, t('ln.undo')),
              h('button', { type: 'button', className: 'kb8-primary', 'data-kb': 'learned-auto-keep', disabled: lBusy, onClick: () => keepLearned(l.name) }, t('ln.a.keep')))))
          return h('section', { className: 'kbl-banner', 'data-kb': 'learned-auto-banner', 'aria-label': t(list.length === 1 ? 'ln.a.title.1' : 'ln.a.title', { n: list.length }) },
            h('div', { className: 'kbl-bh' }, h('i', { className: 'kbl-dot' }),
              h('div', null, h('h3', null, t(list.length === 1 ? 'ln.a.title.1' : 'ln.a.title', { n: list.length })), h('p', null, t('ln.a.sub', { th }))),
              h('button', { type: 'button', className: 'kbs-link', 'data-kb': 'learned-auto-journal', onClick: () => { setReview(null); setLocal(null); setDetail(null); setJournalOpen(true) } }, t('ln.j.btn'))),
            rows, h('div', { className: 'kbl-bfoot' }, t('ln.a.foot')))
        }

        // ── Ranking TABLE ─────────────────────────────────────────────────────
        // CARDS for a ranking of 9 827 rows are what made scrolling endless: six cards per screen,
        // and "Load more" at the bottom of a 3 380 px page.
        // A row is ~34 px tall: fifty fit on screen, and the pager stays fixed.
        // ── Featured: fragments of the highlighted row ────────────────────────
        // The set of featured names (found items only): the star on the Yours cards and on the
        // detail page fills from here, with no duplicated state.
        const featNames = React.useMemo(() => new Set(feat.items.filter((it) => it.found !== false).map((it) => it.name)), [feat])

        // Cover: the folder's image if it exists (as the row's small tile), otherwise the PIVOT TILE (tile(), same look
        // as the cards of the other tabs) — never a visual that falls outside the theme.
        const coverArt = (it) => {
          if (it.cover !== null && it.cover !== undefined && it.cover !== '') {
            return h('span', { className: 'kb8-tile kbs-sm kbs-cover' }, h('img', {
              src: it.cover, alt: t('cover.alt', { name: it.name }), loading: 'lazy',
              onError: (e) => { try { e.target.style.display = 'none' } catch (e2) { /* the dark tile is enough */ } }
            }))
          }
          return tile(it.name, 'pkg', 'kbs-sm')
        }

        // Featured rows are the SAME rows as the ranking below (same columns, same height): a card here and a row there made
        // the page read as two lists. A click opens the skill in Yours: the Discover panel is an INSTALL panel, it has nothing to say
        // about a local skill. The star at the left takes it off the list.
        const featRow = (it, i) => h('div', {
          key: it.name, className: 'kbs-row feat' + appear(i), 'data-kb': 'feat-row', title: it.description !== '' ? it.description : undefined,
          onClick: () => {
            // The skill's own panel when it is in the catalogue; else Yours filtered on the name, as before.
            const own = skills.find((x) => x.name === it.name)
            setMode('yours'); setDetail(null); setModal(null)
            if (own !== undefined) setLocal(own)
            else setQ((m) => ({ ...m, yours: it.name }))
          }
        },
          h('span', { className: 'rank' }, h('button', {
            type: 'button', className: 'kbs-star-btn on', title: t('feat.remove'), 'aria-label': t('feat.remove') + ' — ' + it.name,
            onClick: (e) => { e.stopPropagation(); toggleFeatured(it.name) }
          }, icon('star', 14))),
          h('span', { className: 'who' }, coverArt(it), h('span', { className: 'kb8-name', title: it.name }, it.name),
            h('span', { className: 'kbs-fdesc' }, it.description !== '' ? it.description : t('card.nodesc'))),
          h('span', { className: 'kb8-parent src kbs-nowrap' }, it.source || t('feat.localskill')),
          h('span', { className: 'badges' }, it.active === false ? h('span', { className: 'kb8-pill warn' }, t('card.disabled')) : h('span', { className: 'kb8-pill ok' }, t('card.active'))),
          h('span', { className: 'inst' }, typeof it.modifiedAt === 'string' && Number.isNaN(Date.parse(it.modifiedAt)) === false ? today(it.modifiedAt) : ''))

        const installed = (x) => skills.some((s) => s.name === x.name)

        const ligne = (x, i) => h('div', {
          key: x.source + '/' + x.name,
          className: 'kbs-row' + (installed(x) ? ' has' : '') + (detail !== null && detail.source === x.source && detail.name === x.name ? ' sel' : '') + appear(i),
          onClick: () => { setDetail(x); setLocal(null); setModal(null); setAudit(null) }
        },
          h('span', { className: 'rank' }, String(discFrom + i)),
          // The TILE is what makes a row belong to the same universe as the cards of the
          // other tabs (kb8-tile, kb8-name, kb8-parent, kb8-pill: the pivot's tokens).
          h('span', { className: 'who' }, tile(x.name, 'pkg', 'kbs-sm'), h('span', { className: 'kb8-name', title: x.name }, x.name)),
          h('span', { className: 'kb8-parent src kbs-nowrap' }, x.source),
          h('span', { className: 'badges' },
            x.official === true ? h('span', { key: 'o', className: 'kb8-pill ok' }, 'curated') : null,
            // The state is always said: « Installed » (a check), or the way to install it. Never an empty cell.
            installed(x) ? h('span', { key: 'i', className: 'kb8-pill ok kbs-instpill' }, icon('check', 12), t('row.installed')) : null,
            installed(x) !== true && x.installable === true
              ? h('button', {
                key: 'b', type: 'button', className: 'kb8-ghost kbs-rowinstall', 'data-kb': 'row-install',
                title: t('det.installTip', { source: x.source, name: x.name, dest: installDest }),
                onClick: (e) => { e.stopPropagation(); setAskInstall(x); setErrors((m) => { const n = { ...m }; delete n.__modal; return n }) }
              }, icon('dl', 13), t('btn.install'))
              : null,
            // 15 % of the catalogue is hosted outside GitHub (`well-known`): we SAY so here rather than
            // offering a button that will fail further on.
            x.installable !== true ? h('span', { key: 'w', className: 'kb8-pill warn' }, t('row.offgh')) : null),
          h('span', { className: 'inst' }, nf(x.installs)))

        // A skill of Yours as a row (the list view): the same facts and the same gestures as its card, on one line.
        const yourRow = (s, i) => {
          const k = skillKey(s)
          const on = s.active === true
          const err = errors[k]
          const pick = () => { setLocal(s); setDetail(null); setModal(null); setReview(null); setJournalOpen(false) }
          return h('div', {
            key: k, className: 'kbs-yrow' + (local !== null && skillKey(local) === k ? ' sel' : '') + appear(i), role: 'button', tabIndex: 0,
            'aria-label': s.name + ' — ' + t('cap.detail'), 'data-kb': 'skill-row-' + k,
            onClick: pick,
            onKeyDown: (e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick() } }
          },
            tile(s.name, 'pkg', 'kbs-sm'),
            h('span', { className: 'who' }, h('span', { className: 'kb8-name' }, s.name), h('span', { className: 'kb8-parent kbs-nowrap' }, (s.source || '') + ' · ' + String(s.root || ''))),
            h('span', { className: 'desc', title: s.description !== '' ? s.description : undefined }, s.description !== '' ? s.description : t('card.nodesc')),
            h('span', { className: 'kb8-pills' },
              on ? h('span', { key: 'st', className: 'kb8-pill ok' }, t('card.active')) : h('span', { key: 'st', className: 'kb8-pill warn' }, t('card.disabled')),
              s.collision === true ? h('span', { key: 'co', className: 'kb8-pill warn' }, t('card.dup')) : null,
              s.writable !== true ? h('span', { key: 'ro', className: 'kb8-pill' }, t('card.noedit')) : null,
              learnedByName.has(s.name) ? h('span', { key: 'ln', className: 'kb8-pill kbl-lrn', 'data-kb': 'learned-badge' }, icon('wand', 11), t('ln.badge.learned')) : null),
            h('span', { className: 'when' }, s.modifiedAt !== '' ? today(s.modifiedAt) : ''),
            h('span', { className: 'acts' },
              s.writable === true
                ? h('button', {
                    type: 'button', className: 'kb-sw' + (on ? ' on' : ''), title: on ? t('card.disable') : t('card.enable'),
                    disabled: busy[k] === true, onClick: (e) => { e.stopPropagation(); toggle(s) }
                  }, h('i', null))
                : h('span', { className: 'kb8-pill' }, t('card.readonly')),
              h('button', {
                type: 'button', className: 'kbs-star-btn' + (featNames.has(s.name) ? ' on' : ''),
                title: featNames.has(s.name) ? t('feat.remove') : t('feat.add'),
                onClick: (e) => { e.stopPropagation(); toggleFeatured(s.name) }
              }, icon('star', 14))),
            err ? h('span', { className: 'kbs-err' }, err) : null)
        }

        // A ranking entry as a card (the cards view of Discover): what the row says, in a card. The click opens the same install panel.
        const discCard = (x, i) => h('div', {
          key: x.source + '/' + x.name, role: 'button', tabIndex: 0, 'data-kb': 'disc-card',
          className: 'kb8-card' + (installed(x) ? ' has' : '') + (detail !== null && detail.source === x.source && detail.name === x.name ? ' sel' : '') + appear(i),
          'aria-label': x.name + ' — ' + t('cap.detail'),
          onClick: () => { setDetail(x); setLocal(null); setModal(null); setAudit(null) },
          onKeyDown: (e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetail(x); setLocal(null); setModal(null); setAudit(null) } }
        },
          h('div', { className: 'kb-row' },
            tile(x.name, 'pkg'),
            h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0, gap: '2px', flex: '1' } },
              h('span', { className: 'kb8-name' }, x.name),
              h('span', { className: 'kb8-parent kbs-nowrap' }, x.source))),
          h('div', { className: 'kb8-pills' },
            x.official === true ? h('span', { key: 'o', className: 'kb8-pill ok' }, 'curated') : null,
            installed(x) ? h('span', { key: 'i', className: 'kb8-pill' }, t('row.installed')) : null,
            x.installable !== true ? h('span', { key: 'w', className: 'kb8-pill warn' }, t('row.offgh')) : null),
          h('div', { className: 'foot' }, icon('pkg', 13), h('span', null, nf(x.installs)), h('span', { className: 'grow' }), h('span', { className: 'kb8-mono' }, '#' + String(discFrom + i))))

        // A featured skill as a card: the same click as its row (it opens the skill in Yours).
        const featCard = (it, i) => h('div', {
          key: 'f:' + it.name, role: 'button', tabIndex: 0, className: 'kb8-card feat' + appear(i), 'data-kb': 'feat-card',
          title: it.description !== '' ? it.description : undefined,
          onClick: () => {
            const own = skills.find((x) => x.name === it.name)
            setMode('yours'); setDetail(null); setModal(null)
            if (own !== undefined) setLocal(own)
            else setQ((m) => ({ ...m, yours: it.name }))
          }
        },
          h('div', { className: 'kb-row' },
            coverArt(it),
            h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0, gap: '2px', flex: '1' } },
              h('span', { className: 'kb8-name' }, it.name),
              h('span', { className: 'kb8-parent kbs-nowrap' }, it.source || t('feat.localskill'))),
            h('button', {
              type: 'button', className: 'kbs-star-btn on', title: t('feat.remove'), 'aria-label': t('feat.remove') + ' — ' + it.name,
              onClick: (e) => { e.stopPropagation(); toggleFeatured(it.name) }
            }, icon('star', 14))),
          h('div', { className: 'desc' }, it.description !== '' ? it.description : t('card.nodesc')),
          h('div', { className: 'kb8-pills' }, it.active === false ? h('span', { className: 'kb8-pill warn' }, t('card.disabled')) : h('span', { className: 'kb8-pill ok' }, t('card.active'))))

        // ── Featured tab: the picks Kybernos proposes ─────────────────────────────────────────────────────
        // A pick is data (title, outcome, creator, count, audits, one cut-out) and nothing else: Install goes through the SAME confirmation
        // and the same host route as a Discover entry, Details opens the same panel (real SKILL.md, live audits), Use copies `/name`.
        const frLike = () => { const l = tlang(); return l === 'kybernos' || l.slice(0, 2).toLowerCase() === 'fr' }
        const pickText = (o) => (o !== null && typeof o === 'object' ? (frLike() ? o.fr : o.en) : '')
        const pickAsEntry = (p) => ({ id: p.source + '/' + p.id, source: p.source, name: p.id, installs: p.installs, installable: true, official: false, sourceType: 'github', url: '' })
        const PICK_CATS = ['Documents', 'Data', 'Design', 'Media', 'Research', 'Marketing', 'Automation', 'Build']
        const pickCounts = () => { const c = {}; picks.items.forEach((p) => { c[p.category] = (c[p.category] || 0) + 1 }); return c }
        const pickList = () => {
          let a = picks.items.slice()
          if (pcat !== 'all') a = a.filter((p) => p.category === pcat)
          const needle = q.featured.trim().toLowerCase()
          if (needle !== '') a = a.filter((p) => (pickText(p.title) + ' ' + p.id + ' ' + pickText(p.outcome) + ' ' + t('pcat.' + p.category) + ' ' + p.source).toLowerCase().indexOf(needle) >= 0)
          if (sort.featured === 'installs') a.sort((x, y) => (dir.featured === -1 ? y.installs - x.installs : x.installs - y.installs))
          else if (sort.featured === 'name') a.sort((x, y) => pickText(x.title).localeCompare(pickText(y.title)) * (dir.featured === -1 ? -1 : 1))
          // The user's own pins (the star) come first, whatever the order.
          return a.filter((p) => featNames.has(p.id)).concat(a.filter((p) => !featNames.has(p.id)))
        }
        // The pieces a pick shows, shared by its card and its row.
        const pickCover = (p) => (p.cover !== null && p.cover !== undefined && p.cover !== ''
          ? h('img', { className: 'kbsf-cut', src: p.cover, alt: '', loading: 'lazy', onError: (e) => { try { e.target.style.display = 'none' } catch (e2) { /* the tint is enough */ } } })
          : tile(p.id, 'pkg'))
        const pickBy = (p) => {
          const owner = String(p.source).split('/')[0]
          return h('span', { className: 'kbsf-by', title: t('pick.by', { who: owner }) },
            h('span', { className: 'kbsf-av', style: { background: 'hsl(' + hue(owner) + ' 45% 32%)' }, 'aria-hidden': 'true' }, owner.charAt(0).toUpperCase()),
            h('span', { className: 'nm' }, owner))
        }
        const pickCnt = (p) => {
          if (typeof p.installs !== 'number') return null
          const full = t('pick.count', { n: p.installs.toLocaleString(isEn() ? 'en-US' : 'fr-FR') })
          return h('span', { className: 'kbsf-cnt', title: full, 'aria-label': full }, icon('dl', 13), nf(p.installs))
        }
        const pickPills = (p, isIn) => {
          const warns = p.audits.filter((a) => a[1] !== 'pass').length
          return h('div', { className: 'kbsf-pills' },
            isIn === true ? h('span', { key: 'in', className: 'kbsf-pill ok' }, icon('check', 12), t('pick.installed')) : null,
            p.audits.length === 0 ? null : (warns === 0
              ? h('span', { key: 'au', className: 'kbsf-pill ok', title: t('pick.auditTip') }, icon('shield', 12), t('pick.audited', { n: p.audits.length }))
              : h('span', { key: 'au', className: 'kbsf-pill warn', title: t('pick.auditTip') }, icon('alert', 12), warns === 1 ? t('pick.warn1') : t('pick.warnN', { n: warns }))),
            p.needs !== null && p.needs !== undefined ? h('span', { key: 'nd', className: 'kbsf-pill need' }, icon('info', 12), t('need.' + p.needs)) : null)
        }
        // Install (or Use when it is already there) and Details: the same two gestures in the card and in the row.
        // `opts` (the field's picks): `onInstall` replaces the confirmation (a skill that ships with Kybernos is a plain copy), `busy` greys Install, `noDetails` hides
        // Details when there is nothing to open.
        const pickButtons = (p, x, isIn, openIt, opts) => [
          isIn === true
            ? h('button', { key: 'use', type: 'button', className: 'kb8-ghost' + (copied === '/' + p.id ? ' kbs-did' : ''), 'data-kb': 'pick-use', onClick: (e) => { e.stopPropagation(); copy('/' + p.id) } },
              icon(copied === '/' + p.id ? 'check' : 'code', 14), h('span', null, copied === '/' + p.id ? t('pick.copied') : t('pick.use')))
            : h('button', {
              key: 'ins', type: 'button', className: 'kb8-primary', 'data-kb': 'pick-install', disabled: opts !== undefined && opts.busy === true,
              onClick: (e) => { e.stopPropagation(); if (opts !== undefined && typeof opts.onInstall === 'function') opts.onInstall(); else { setAskInstall(x); setErrors((m) => { const n = { ...m }; delete n.__modal; return n }) } }
            }, icon('dl', 14), h('span', null, opts !== undefined && opts.busy === true ? t('fld.installing') : t('btn.install'))),
          opts !== undefined && opts.noDetails === true ? null : h('button', { key: 'det', type: 'button', className: 'kb8-ghost', 'data-kb': 'pick-details', onClick: (e) => { e.stopPropagation(); openIt() } }, h('span', null, t('pick.details')))
        ]
        const pickStar = (p, isIn, cls) => {
          const pinned = featNames.has(p.id)
          return h('button', {
            type: 'button', className: 'kbs-star-btn ' + cls + (pinned ? ' on' : ''), disabled: isIn !== true,
            title: isIn === true ? (pinned ? t('feat.remove') : t('feat.add')) : t('pick.pinNeedsInstall'),
            'aria-label': (pinned ? t('feat.remove') : t('feat.add')) + ' — ' + pickText(p.title),
            onClick: (e) => { e.stopPropagation(); toggleFeatured(p.id) }
          }, icon('star', 14))
        }
        // `opts` is set for the skills of « For your field »: `isIn`, `openIt`, `kb` (the test hook) and what pickButtons takes. A pick of the field has no
        // category (its tag is the goal it serves) and no install count.
        const pickTag = (p, opts) => (typeof p.tag === 'string'
          ? h('span', { className: 'kbsf-tagtx' + (opts !== undefined && opts.ticked === true ? ' on' : '') }, opts !== undefined && opts.ticked === true ? icon('check', 10) : null, p.tag)
          : t('pcat.' + p.category))
        const pickHint = (p) => (pickText(p.prompt) !== '' ? t('pick.try') + sep() + pickText(p.prompt) : undefined)
        const pickCard = (p, i, opts) => {
          const x = pickAsEntry(p)
          const isIn = opts !== undefined ? opts.isIn : installed(x)
          const openIt = opts !== undefined ? opts.openIt : () => { setDetail(x); setLocal(null); setModal(null); setAudit(null) }
          const title = pickText(p.title)
          return h('article', {
            key: 'pk:' + p.id, role: 'button', tabIndex: 0, 'data-kb': opts !== undefined ? opts.kb : 'pick-card', 'data-skill': p.id,
            className: 'kbsf-card' + (detail !== null && detail.source === p.source && detail.name === p.id ? ' sel' : '') + appear(i),
            title: pickHint(p), 'aria-label': title + ' — ' + t('cap.detail'),
            onClick: openIt,
            onKeyDown: (e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openIt() } }
          },
            h('div', { className: 'kbsf-pic kbsf-t', 'data-cat': p.category },
              pickCover(p),
              h('span', { className: 'kbsf-tag' }, pickTag(p, opts)),
              pickStar(p, isIn, 'kbsf-star')),
            h('div', { className: 'kbsf-body' },
              h('div', { className: 'kbsf-trow' },
                h('div', { className: 'kbsf-title' }, title),
                h('div', { className: 'kbsf-side' }, pickBy(p), pickCnt(p))),
              h('p', { className: 'kbsf-out' }, pickText(p.outcome)),
              pickPills(p, isIn),
              // The actions show on hover and on keyboard focus (always on a touch screen); their place is reserved, so the card does not jump.
              h('div', { className: 'kbsf-acts' }, pickButtons(p, x, isIn, openIt, opts))))
        }
        // The same pick as a row (the list view): a square thumbnail, the title with its outcome and its facts, the verdicts, the actions.
        // Rows are dense and scanned: their actions are always there, not on hover.
        const pickRow = (p, i, opts) => {
          const x = pickAsEntry(p)
          const isIn = opts !== undefined ? opts.isIn : installed(x)
          const openIt = opts !== undefined ? opts.openIt : () => { setDetail(x); setLocal(null); setModal(null); setAudit(null) }
          const title = pickText(p.title)
          return h('div', {
            key: 'pr:' + p.id, role: 'button', tabIndex: 0, 'data-kb': opts !== undefined ? opts.kb : 'pick-row', 'data-skill': p.id,
            className: 'kbsf-row' + (detail !== null && detail.source === p.source && detail.name === p.id ? ' sel' : '') + appear(i),
            title: pickHint(p), 'aria-label': title + ' — ' + t('cap.detail'),
            onClick: openIt,
            onKeyDown: (e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openIt() } }
          },
            h('div', { className: 'kbsf-th kbsf-t', 'data-cat': p.category }, pickCover(p)),
            h('div', { className: 'kbsf-mn' },
              h('div', { className: 'kbsf-title' }, title),
              h('p', { className: 'kbsf-out' }, pickText(p.outcome)),
              h('div', { className: 'kbsf-meta' }, h('span', null, pickTag(p, opts)), pickBy(p), pickCnt(p))),
            pickPills(p, isIn),
            h('div', { className: 'kbsf-racts' }, pickStar(p, isIn, 'kbsf-rstar'), pickButtons(p, x, isIn, openIt, opts)))
        }

        // Pager based on the SERVER `total`. We no longer load "a bit more" at the bottom of a growing list:
        // we go to the wanted page, and the number of pages is known in advance.
        // It sits under the table only: the table shows 20 rows by default, so the bottom is a short scroll away.
        const pagerIndex = () => {
          const first = Math.max(0, Math.min(discPage - 2, Math.max(0, discPages - 5)))
          const around = []
          for (let p = first; p < Math.min(discPages, first + 5); p++) around.push(p)
          return h('div', { className: 'kbs-pager' },
            h('button', {
              type: 'button', className: 'kb8-ghost', disabled: discPage <= 0,
              onClick: () => setIpage(Math.max(0, discPage - 1))
            }, icon('back', 14), ' ' + t('pg.prev')),
            around.map((p) => h('button', {
              key: p, type: 'button', className: 'pg' + (p === discPage ? ' on' : ''), onClick: () => setIpage(p)
            }, String(p + 1))),
            h('span', { className: 'kb8-mono' }, t('pg.page', { p: discPage + 1, n: discPages })),
            h('button', {
              type: 'button', className: 'kb8-ghost', disabled: discPage >= discPages - 1,
              onClick: () => setIpage(Math.min(discPages - 1, discPage + 1))
            }, t('pg.next') + ' ', icon('chevR', 14)),
            h('span', { className: 't' }, t('pg.rows', { a: discFrom, b: discTo, n: discTotal })))
        }

        // Yours stays small (tens of items): "Load more" is enough there, a pager would be noise.
        const pagerYours = (shown, total) => h('div', { className: 'kbs-pager' },
          shown < total
            ? h('button', { type: 'button', className: 'kb8-ghost', onClick: () => setPage((p) => ({ ...p, yours: p.yours + 1 })) }, icon('plus', 15), ' ' + t('pg.more'))
            : null,
          h('span', { className: 't' }, t('pg.of', { a: shown, n: total })))

        const empty = (title, hint) => h('div', { className: 'kb-empty' }, icon('search', 24),
          h('span', { className: 'kb8-name' }, title), h('span', { className: 'kb8-parent' }, hint))

        // ── Featured tab, « For your field »: the skills the saved field puts forward (its goals' skills, those the person ticked first). Same card
        // language as the rest of the page, no cover and no audit (those belong to the curated picks below): what the skill does, the goal it serves,
        // and the one gesture. A skill from GitHub goes through the same confirmation as any install; one that ships with Kybernos is a plain copy.
        const domainSeam = () => { try { const d = window.__KB_DOMAIN__; return d !== null && d !== undefined && typeof d.field === 'function' ? d : null } catch (e) { return null } }
        const pageTitle = () => { try { const d = domainSeam(); const l = d !== null ? d.label('skills') : null; return typeof l === 'string' && l.trim() !== '' ? l : 'Skills' } catch (e) { return 'Skills' } }
        const humanName = (n) => { const w = String(n).replace(/-/g, ' '); return w.charAt(0).toUpperCase() + w.slice(1) }
        const installShipped = (name) => {
          const d = domainSeam()
          if (d === null || typeof d.installSkill !== 'function') return
          setShipBusy((m) => ({ ...m, [name]: true }))
          Promise.resolve(d.installSkill(name)).then((ok) => {
            if (alive.current !== true) return
            setShipBusy((m) => { const n = { ...m }; delete n[name]; return n })
            if (ok === true) { setShipDone((m) => ({ ...m, [name]: true })); loadCatalogue(); setNotice({ kind: 'ok', text: t('notice.installed', { name }) }) } else setNotice({ kind: 'err', text: t('err.unavail', { r: 'install' }) })
          })
        }
        // A skill of the field is drawn as a pick (the card or the row of the Featured tab, whichever view is on): the same family as the picks below it,
        // with a Details button and the same Use / Install. Not a curated pick, it has no cover, no audit and no install count: its tag is the goal it serves.
        const fieldAsPick = (sk) => {
          const curated = picks.items.find((it) => it.source === sk.source && it.id === sk.name)
          if (curated !== undefined) return curated
          const name = humanName(sk.name)
          return { id: sk.name, source: sk.source, category: undefined, tag: sk.goal, title: { fr: name, en: name }, outcome: { fr: sk.d, en: sk.d }, prompt: { fr: '', en: '' }, installs: null, audits: [], cover: null, needs: null }
        }
        const fieldOpts = (sk, p) => {
          const x = { id: sk.source + '/' + sk.name, source: sk.source, name: sk.name, installed: false, installable: true, official: false, sourceType: 'github', url: '' }
          const isIn = skills.some((y) => y.name === sk.name) || shipDone[sk.name] === true
          const own = skills.find((y) => y.name === sk.name)
          const curated = picks.items.some((it) => it.source === sk.source && it.id === sk.name)
          // Details: a curated pick opens its page, an installed skill opens its own panel (in Yours), a skill still on GitHub the install panel of Discover.
          // A skill that ships with Kybernos and is not installed has nothing more to show than the card.
          const noDetails = curated !== true && own === undefined && sk.shipped === true
          const openIt = () => {
            if (curated === true) { setDetail(x); setLocal(null); setModal(null); setAudit(null); return }
            if (own !== undefined) { setMode('yours'); setDetail(null); setModal(null); setReview(null); setJournalOpen(false); setLocal(own); return }
            if (sk.shipped !== true) { setMode('discover'); setDetail(x); setLocal(null); setModal(null); setAudit(null) }
          }
          return {
            kb: 'field-skill', isIn, openIt, noDetails, ticked: sk.ticked === true, busy: shipBusy[sk.name] === true,
            onInstall: () => { if (sk.shipped === true) installShipped(sk.name); else { setAskInstall(x); setErrors((m) => { const n = { ...m }; delete n.__modal; return n }) } },
          }
        }
        const renderFieldSection = () => {
          const d = domainSeam()
          if (d === null || pcat !== 'all' || q.featured.trim() !== '') return null
          let f = null
          let list = []
          try { f = d.field(); list = f === null ? [] : d.skills() } catch (e) { return null }
          if (f === null || list.length === 0) return null
          return h('section', { className: 'kbsf-field', 'data-kb': 'field-section', style: { '--kbsf-fld': f.accent } },
            h('div', { className: 'kbsf-fhead' },
              h('span', { className: 'kbsf-fdot', 'aria-hidden': 'true' }),
              h('div', { className: 'kbsf-ftx' }, h('div', { className: 'kbsf-fh' }, t('fld.title', { field: f.name })), h('div', { className: 'kbsf-fsub' }, t('fld.sub'))),
              h('span', { className: 'grow' }),
              typeof d.openKit === 'function' ? h('button', { type: 'button', className: 'kbs-link', 'data-kb': 'field-kit', title: t('fld.kit.tip'), onClick: () => { try { d.openKit() } catch (e) { /* no wizard */ } } }, t('fld.kit')) : null),
            views.featured === 'list'
              ? h('div', { className: 'kbsf-list' + (coverBg === 'plain' ? ' kbsf-plain' : ''), 'data-kb': 'field-list' }, list.map((sk, i) => pickRow(fieldAsPick(sk), i, fieldOpts(sk))))
              : h('div', { className: 'kbsf-grid' + (coverBg === 'plain' ? ' kbsf-plain' : ''), 'data-kb': 'field-grid' }, list.map((sk, i) => pickCard(fieldAsPick(sk), i, fieldOpts(sk)))))
        }
        const renderFeatured = () => {
          if (picks.phase === 'loading') return skeletonOf('cards', 6) || h('div', { className: 'kb-empty' }, h('span', { className: 'kb8-mono' }, t('pick.loading')))
          const counts = pickCounts()
          const list = pickList()
          return h('div', null,
            renderFieldSection(),
            h('div', { className: 'kbsf-chips' },
              chip(t('pick.all') + ' ' + picks.items.length, pcat === 'all', () => setPcat('all'), 'all'),
              PICK_CATS.filter((c) => counts[c] > 0).map((c) => chip(t('pcat.' + c) + ' ' + counts[c], pcat === c, () => setPcat(c), c)),
              h('span', { className: 'grow' }),
              // Two small swatches rather than words, so the choice stays on the chips' row: a category tint, or the plain card surface.
              h('span', { className: 'kbsf-seg', role: 'group', 'aria-label': t('pick.bg') },
                h('button', { type: 'button', className: coverBg === 'tint' ? 'on' : '', 'aria-pressed': coverBg === 'tint' ? 'true' : 'false', title: t('pick.bg') + sep() + t('pick.bg.tint'), 'aria-label': t('pick.bg') + sep() + t('pick.bg.tint'), 'data-kb': 'pick-bg-tint', onClick: () => setCoverBg('tint') }, h('i', { className: 'sw tint' })),
                h('button', { type: 'button', className: coverBg === 'plain' ? 'on' : '', 'aria-pressed': coverBg === 'plain' ? 'true' : 'false', title: t('pick.bg') + sep() + t('pick.bg.plain'), 'aria-label': t('pick.bg') + sep() + t('pick.bg.plain'), 'data-kb': 'pick-bg-plain', onClick: () => setCoverBg('plain') }, h('i', { className: 'sw plain' })))),
            list.length === 0
              ? empty(t('pick.none'), t('pick.nonehint'))
              : (views.featured === 'list'
                ? h('div', { className: 'kbsf-list' + (coverBg === 'plain' ? ' kbsf-plain' : ''), 'data-kb': 'picks-list' }, list.map(pickRow))
                : h('div', { className: 'kbsf-grid' + (coverBg === 'plain' ? ' kbsf-plain' : ''), 'data-kb': 'picks-grid' }, list.map(pickCard))),
            picks.asOf !== '' ? h('div', { className: 'kbsf-foot' }, t('pick.asof', { d: today(picks.asOf) })) : null)
        }

        const renderYours = () => {
          if (catPhase === 'loading' && cat === null) return skeletonOf('cards', 6) || h('div', { className: 'kb-empty' }, h('span', { className: 'kb8-mono' }, t('y.loading')))
          if (catPhase === 'error') return h('div', { className: 'kb-empty' },
            h('span', { className: 'kb8-name' }, t('y.loadfail')), h('span', { className: 'kb8-parent' }, catError),
            h('button', { type: 'button', className: 'kb8-ghost', onClick: loadCatalogue }, t('y.retry')))
          const pend = pendingShown()
          if (filtered.length === 0 && pend.length === 0) {
            return skills.length === 0 && learned.proposals.length === 0
              ? empty(t('y.none'), t('y.nonehint'))
              : empty(t('y.noresult'), t('y.nofilter'))
          }
          return h('div', null,
            autoBanner(),
            learnedBanner(),
            views.yours === 'list'
              ? h('div', null, pend.length > 0 ? h('div', { className: 'kb8-grid', style: { marginBottom: '14px' } }, pend.map(pendingCard)) : null, h('div', { className: 'kbs-ylist', 'data-kb': 'yours-list' }, shownYours.map(yourRow)))
              : h('div', { className: 'kb8-grid' }, pend.map(pendingCard).concat(shownYours.map(yourCard))),
            pagerYours(shownYours.length, filtered.length))
        }

        // Where the ranking comes from, and the way to change it. The address in use is shown as a host, never as a credential.
        const renderSourceLine = () => {
          if (src === null) return null
          const where = src.origin === 'env' ? t('src.env') : (src.origin === 'setting' ? t('src.custom') : t('src.default'))
          return h('div', { className: 'kbs-srcline', 'data-kb': 'index-source' },
            icon('globe', 14),
            h('span', { className: 'k' }, t('src.line')),
            src.refused === true
              ? h('span', { className: 'kb8-pill warn' }, t('src.refused'))
              : h('span', { className: 'v', title: src.url !== null ? src.url : undefined }, src.host),
            h('span', { className: 'w' }, where),
            h('button', { type: 'button', className: 'kbs-link', 'data-kb': 'index-source-change', onClick: () => { setSrcErr(''); setSrcOpen(true) } }, t('src.change')))
        }

        // ONE list, featured first (UB-12): the featured rows are prepended to the ranking table on
        // page 1 without a search, instead of sitting in a second, separate table above it.
        const featRows = (feat.phase === 'ready' && discKind === 'index' && dneedle === '' && discPage === 0)
          ? feat.items.filter((it) => it.found !== false).map(featRow) : []
        const featCards = (feat.phase === 'ready' && discKind === 'index' && dneedle === '' && discPage === 0)
          ? feat.items.filter((it) => it.found !== false).map((it, i) => featCard(it, i)) : []
        // A column header that orders the page: the same order as the bar's (name, or installs), the same direction. A second click on the
        // column in use flips the direction; a new column starts from its natural one (A to Z, most installed first). Only the index is
        // ordered by the page: a search keeps its relevance and the curated set its install order.
        const sortHead = (label, key, cls) => {
          if (discKind !== 'index') return h('span', { className: cls }, label)
          const on = sort.discover === key
          return h('button', {
            type: 'button', className: cls + ' kbs-sorthead' + (on ? ' on' : ''), 'data-kb': 'sort-' + key,
            'aria-sort': on ? (dir.discover === -1 ? 'descending' : 'ascending') : 'none', title: t('sort.by') + sep() + label,
            onClick: () => {
              if (on) setDir((m) => ({ ...m, discover: -m.discover }))
              else { setSort((m) => ({ ...m, discover: key })); setDir((m) => ({ ...m, discover: key === 'name' ? 1 : -1 })) }
            }
          }, label, on ? h('span', { className: 'arr', 'aria-hidden': 'true' }, dir.discover === -1 ? '↓' : '↑') : null)
        }
        const renderDiscover = () => {
          const sourceLine = renderSourceLine()
          if (discPhase === 'loading' && disc === null) {
            // Bones: the featured list (known already), a pager's worth of space, then rows in the ranking's own grid.
            const bones = skeletonOf('rows', 8)
            return h('div', null, sourceLine,
              bones === null ? h('div', { className: 'kb-empty' }, h('span', { className: 'kb8-mono' }, t('d.query')))
                : h('div', { key: 'sk' }, bones))
          }
          if (discPhase === 'error') {
            // The failure is THIS tab's: Yours and Team do not depend on the index and are untouched. A clear sentence, a way to
            // ask again, and — the address being the user's to change — a way to change it.
            const refused = discErr !== null && discErr.code === 'index_url_refused'
            return h('div', null,
              h('div', { className: 'kb-empty', role: 'alert', 'data-kb': 'disc-error' },
                icon('alert', 24),
                h('span', { className: 'kb8-name' }, t('d.down')),
                h('span', { className: 'kb8-parent', title: discErr !== null ? discErr.raw : undefined }, discErr !== null ? discErr.text : ''),
                refused === true ? null : h('span', { className: 'kb8-parent' }, t('d.hint')),
                h('div', { className: 'kb-row', style: { justifyContent: 'center', marginTop: '4px' } },
                  refused === true ? null : h('button', { type: 'button', className: 'kb8-primary', 'data-kb': 'disc-retry', onClick: retryDiscover }, icon('refresh', 15), h('span', null, t('d.retry'))),
                  src !== null && src.editable !== false
                    ? h('button', { type: 'button', className: refused === true ? 'kb8-primary' : 'kb8-ghost', 'data-kb': 'disc-change-source', onClick: () => { setSrcErr(''); setSrcOpen(true) } }, t('src.change'))
                    : null),
                h('span', { className: 'kb8-parent' }, t('d.direct'))))
          }
          return h('div', null,
            sourceLine,
            views.discover === 'cards'
              ? (discShown.length === 0 && featCards.length === 0
                ? empty(t('y.noresult'), discKind === 'search' ? t('d.empty.search') : t('d.empty.page'))
                : h('div', { className: 'kb8-grid' + (discPhase === 'loading' ? ' loading' : ''), 'data-kb': 'discover-cards' }, featCards.concat(discShown.map(discCard))))
              : h('div', { className: 'kbs-table' + (discPhase === 'loading' ? ' loading' : '') },
              h('div', { className: 'kbs-head' },
                h('span', { className: 'rank' }, '#'),
                sortHead(discKind === 'search' ? t('th.result') : 'SKILL', 'name', 'who'),
                h('span', { className: 'src' }, 'Source'),
                h('span', { className: 'badges' }, t('th.state')),
                sortHead('INSTALLATIONS', 'installs', 'inst')),
              discShown.length === 0
                ? empty(t('y.noresult'), discKind === 'search' ? t('d.empty.search') : t('d.empty.page'))
                : featRows.concat(discShown.map(ligne))),
            discShown.length === 0 ? null : pagerIndex())
        }

        // ── the right-hand panels (the list stays next to them) ───────────────────────────────────────
        // The folder an install writes into: the user's own skills folder when it is among the writable ones the host named, else the first
        // writable one. `roots` are the host's WRITABLE roots (GET status), never the project's read-only ones.
        const installDest = (roots.find((r) => r.source === 'user-dsh') || roots[0] || { path: '~/.dsh/skills' }).path
        const curatedOf = (x) => ({
          owner: curatedOwners !== null ? curatedOwners.byRepo[x.source] : undefined,
          curated: x.official === true || (curatedOwners !== null && curatedOwners.ids.has(x.source + '/' + x.name))
        })

        // One call for the three actions that go through the host; what comes back is announced, and the list is read again.
        const skillAct = (kind, s) => {
          const k = 'act:' + kind + ':' + skillKey(s)
          if (busy[k] === true) return
          setBusy((m) => ({ ...m, [k]: true }))
          const target = kind === 'reveal' ? 'folder' : (kind === 'edit' ? 'file' : undefined)
          const path = kind === 'duplicate' ? '/kybernos-skills/skill/duplicate' : (kind === 'delete' ? '/kybernos-skills/skill/delete' : '/kybernos-skills/skill/reveal')
          const done = () => setBusy((m) => { const n = { ...m }; delete n[k]; return n })
          postJson(path, { root: s.root, name: s.name, target }).then((j) => {
            if (alive.current !== true) return
            done()
            if (j === null || typeof j !== 'object' || j.ok !== true) {
              setAskDelete(null)
              setNotice({ kind: 'err', text: why(j, t('err.unexpected', { r: kind })) })
              return
            }
            if (kind === 'delete') {
              setAskDelete(null); setLocal(null); loadCatalogue()
              setNotice({ kind: 'ok', text: t('notice.deleted', { name: s.name }) })
            } else if (kind === 'duplicate') {
              loadCatalogue()
              if (j.skill !== null && typeof j.skill === 'object') setLocal(j.skill)
              setNotice({ kind: 'ok', text: t('notice.duplicated', { name: s.name, copy: j.name }) })
            } else setNotice({ kind: 'ok', text: t('notice.opened') })
          }).catch(() => {
            if (alive.current !== true) return
            done(); setAskDelete(null)
            setNotice({ kind: 'err', text: t('err.unavail', { r: kind }) })
          })
        }

        // ── Featured: a pick, opened. It uses the width of the page instead of a side panel: the picture and the title as on the card, big, then
        // the facts, the audits and the start of SKILL.md side by side. The data is what the Discover panel already reads (the repository's
        // real SKILL.md, the live audits); only the arrangement is new.
        const renderPickDetail = () => {
          const p = picks.items.find((it) => detail !== null && it.source === detail.source && it.id === detail.name)
          if (p === undefined) return renderFeatured()
          const x = pickAsEntry(p)
          const isIn = installed(x)
          const pv = preview.state === 'ready' && preview.data !== null ? preview.data : null
          const ghUrl = pv !== null && typeof pv.url === 'string' && pv.url !== '' ? pv.url : 'https://github.com/' + p.source
          const c = curatedOf(x)
          const publisher = c.owner !== undefined && c.owner !== '' ? c.owner : String(p.source).split('/')[0]
          const row = (label, value, key) => h('div', { key, className: 'row' }, h('span', null, label), h('span', { className: 'kb8-mono', style: { overflowWrap: 'anywhere' } }, value))
          const folderText = pv !== null ? (pv.folder !== '' ? pv.folder : t('dp.root')) : (preview.state === 'loading' ? t('dp.loading') : t('dp.folderUnknown'))
          let skillText = null
          if (preview.state === 'loading') skillText = h('pre', { className: 'kb-local-body', 'data-kb': 'preview-text' }, t('dp.loading'))
          else if (pv !== null) skillText = h('pre', { className: 'kb-local-body', 'data-kb': 'preview-text' }, pv.text + (pv.truncated === true ? '\n…' : ''))
          else if (preview.state === 'missing') skillText = h('div', { className: 'kb-note', 'data-kb': 'preview-missing' }, icon('info', 14), h('span', null, t('dp.notfound', { name: p.id })))
          else if (preview.state === 'error') skillText = h('div', { className: 'kb-note', 'data-kb': 'preview-error' }, icon('info', 14), h('span', null, t('dp.nopreview', { why: preview.error })))
          const auditLines = audit === null || audit === undefined || audit.phase === 'loading'
            ? h('span', { className: 'kb8-mono' }, t('det.auditLoading'))
            : (audit.phase === 'error'
              ? h('span', { className: 'ligne' }, audit.error)
              : (audit.audits.length === 0
                ? h('span', { className: 'kb8-mono' }, t('det.auditNone'))
                : audit.audits.map((a, i) => h('div', { key: 'a' + i, className: 'ligne' },
                  h('span', { className: 'kb8-pill ' + (a.status === 'pass' ? 'ok' : 'warn') }, a.status === 'pass' ? t('det.audited') : (a.status !== '' ? a.status : t('det.unknown'))),
                  h('span', null, a.provider + (a.summary !== '' ? ' — ' + a.summary : ''))))))
          const title = pickText(p.title)
          return h('article', { className: 'kbsf-detail' + (coverBg === 'plain' ? ' kbsf-plain' : ''), 'data-kb': 'pick-detail', 'aria-label': title },
            h('button', { type: 'button', className: 'kbs-link kbsf-dback', 'data-kb': 'pick-back', onClick: () => setDetail(null) }, icon('back', 14), ' ' + t('pick.back')),
            h('div', { className: 'kbsf-dhero' },
              h('div', { className: 'kbsf-dpic kbsf-t', 'data-cat': p.category },
                pickCover(p),
                h('span', { className: 'kbsf-tag' }, t('pcat.' + p.category))),
              h('div', { className: 'kbsf-dtx' },
                h('h2', { className: 'kbsf-dtitle' }, title),
                h('div', { className: 'kbsf-meta' }, pickBy(p), pickCnt(p), h('span', { className: 'kb8-mono' }, '/' + p.id)),
                h('p', { className: 'kbsf-dout' }, pickText(p.outcome)),
                pickPills(p, isIn),
                h('div', { className: 'kbsf-dacts' },
                  isIn === true
                    ? h('button', { type: 'button', className: 'kb8-primary', 'data-kb': 'pick-use', onClick: () => copy('/' + p.id) }, icon('code', 15), h('span', null, t('pick.use')))
                    : h('button', { type: 'button', className: 'kb8-primary', 'data-kb': 'pick-install', onClick: () => { setAskInstall(x); setErrors((m) => { const n = { ...m }; delete n.__modal; return n }) } }, icon('dl', 15), h('span', null, t('btn.install'))),
                  h('a', { href: ghUrl, target: '_blank', rel: 'noreferrer', className: 'kb8-ghost', 'data-kb': 'act-github' }, icon('github', 15), h('span', null, t('dp.viewgh'))),
                  pickStar(p, isIn, 'kbsf-rstar')),
                h('div', { className: 'kbsf-try' },
                  h('span', { className: 'kb-section-label' }, t('pick.try')),
                  h('span', { className: 'kbsf-trytxt' }, pickText(p.prompt)),
                  h('button', { type: 'button', className: 'kbs-link', 'data-kb': 'pick-copyprompt', onClick: () => copy('/' + p.id + ' ' + pickText(p.prompt)) }, icon('code', 13), ' ' + t('pick.copyPrompt'))))),
            h('div', { className: 'kbsf-dcols' },
              h('section', { className: 'kbsf-dcard' },
                h('span', { className: 'kb-section-label' }, t('pick.facts')),
                pv !== null && pv.description !== '' ? h('p', { className: 'kbs-desc', 'data-kb': 'preview-desc' }, pv.description) : null,
                h('div', { className: 'kb-local-rows' },
                  row(t('det.row.repo'), 'github.com/' + p.source, 'repo'),
                  row(t('dp.folder'), folderText, 'folder'),
                  row(t('det.row.owner'), publisher, 'owner'),
                  row(t('det.row.installs'), nf(p.installs), 'installs'),
                  row(t('det.row.type'), 'github', 'type'))),
              h('section', { className: 'kbsf-dcard kbs-audit' },
                h('span', { className: 'kb8-mono' }, icon('shield', 14), ' ' + t('det.audits')),
                auditLines,
                h('span', { className: 'kb8-mono' }, t('det.thirdParty')))),
            h('section', { className: 'kbsf-dcard' },
              h('span', { className: 'kb-section-label' }, t('dp.start')),
              skillText))
        }

        const renderPanel = () => {
          if (mode === 'yours' && journalOpen === true) return h(JournalPanel, { tick: lTick, onClose: () => setJournalOpen(false), onUndo: (name) => undoLearned(name) })
          if (mode === 'yours' && review !== null) {
            const p = learned.proposals.find((x) => x.id === review.id)
            if (p !== undefined) {
              return h(LearnedPanel, {
                p, st: review, sensitive: learned.sensitive, rules: learned.rules, busy: lBusy, err: review.err, line: learned.settings !== null ? learned.settings.threshold : null,
                onClose: () => setReview(null), onEdit: () => setReview((r) => ({ ...r, edit: true, description: p.description, body: p.body, add: typeof p.add === 'string' ? p.add : '', err: '' })),
                onCancel: () => setReview((r) => ({ ...r, edit: false, err: '' })), onChange: (patch) => setReview((r) => ({ ...r, ...patch })),
                onSave: () => saveLearned(p), onAccept: () => acceptLearned(p), onDiscard: () => discardLearned(p), onFix: () => fixLearned(p)
              })
            }
          }
          if (mode === 'yours' && local !== null) {
            const s = skills.find((x) => skillKey(x) === skillKey(local)) || local
            return h(SkillPanel, {
              s, read: localRead, err: errors[skillKey(s)],
              busyKind: ['reveal', 'edit', 'duplicate', 'delete'].find((kd) => busy['act:' + kd + ':' + skillKey(s)] === true) || '',
              learned: learnedByName.get(s.name) || null, shareLocked: learnedByName.has(s.name) && learned.sensitive === true && learned.settings !== null && learned.settings.teamPriv !== true, onShare: () => openShare(s.name),
              onClose: () => setLocal(null), onAct: (kind) => { if (kind === 'delete') setAskDelete(s); else skillAct(kind, s) }, onCopy: copy
            })
          }
          if (mode === 'discover' && detail !== null) {
            const x = detail
            const c = curatedOf(x)
            return h(DiscoverPanel, {
              x, preview, audit, dest: installDest, crumb: 'Discover', owner: c.owner, curated: c.curated, installed: skills.some((s) => s.name === x.name),
              starred: featNames.has(x.name), onClose: () => setDetail(null),
              onInstall: () => { setAskInstall(x); setErrors((m) => { const n = { ...m }; delete n.__modal; return n }) },
              onStar: () => toggleFeatured(x.name)
            })
          }
          return null
        }

        const renderModal = () => {
          if (srcOpen === true) return h(SourceModal, { source: src, busy: srcBusy, error: srcErr, onClose: () => setSrcOpen(false), onSubmit: saveSource })
          if (teamSheet === true && tsum.phase === 'ready') return h(ProposeSheet, {
            local: skills, ws: tsum.workspaceName || '', admin: teamRoleAdmin(tsum.role), preselect: shareName, onClose: () => { setTeamSheet(false); setShareName(null) },
            onDone: (name) => {
              setTeamSheet(false); setShareName(null); setTeamView(teamRoleAdmin(tsum.role) ? 'approved' : 'mine'); setTeamVer((n) => n + 1); loadTeam()
              postJson('/kybernos-skills/learned/shared', { name }).then(() => loadLearned()).catch(() => null)
              setNotice({ kind: 'ok', text: t(teamRoleAdmin(tsum.role) ? 'tm.n.added' : 'tm.n.proposed', { name }) })
            }
          })
          if (modal === 'create') return h(CreateModal, { roots, busy, onClose: () => setModal(null), onSubmit: (form) => {
            setBusy((m) => ({ ...m, __modal: true }))
            postJson('/kybernos-skills/create', form).then((j) => {
              if (alive.current !== true) return
              setBusy((m) => { const n = { ...m }; delete n.__modal; return n })
              if (j !== null && typeof j === 'object' && j.ok === true) {
                setModal(null); loadCatalogue(); setNotice({ kind: 'ok', text: t('notice.created', { name: form.name }) })
              } else setErrors((m) => ({ ...m, __modal: why(j, t('err.create')) }))
            }).catch(() => {
              if (alive.current !== true) return
              setBusy((m) => { const n = { ...m }; delete n.__modal; return n })
              setErrors((m) => ({ ...m, __modal: t('err.unavail', { r: 'create' }) }))
            })
          }, error: errors.__modal })
          if (askDelete !== null) return h(DeleteConfirm, {
            s: askDelete, files: localRead.state === 'ready' && localRead.data !== null ? localRead.data.files : null,
            busy: busy['act:delete:' + skillKey(askDelete)] === true,
            onClose: () => setAskDelete(null), onConfirm: () => skillAct('delete', askDelete)
          })
          if (askInstall !== null) return h(InstallConfirm, {
            x: askInstall, dest: installDest, folder: preview.state === 'ready' && preview.data !== null ? preview.data.folder : null,
            busy: busy.__modal === true, error: errors.__modal,
            onClose: () => setAskInstall(null),
            onConfirm: () => {
              const x = askInstall
              setBusy((m) => ({ ...m, __modal: true }))
              postJson('/kybernos-skills/install', { source: x.source, name: x.name, root: installDest }).then((j) => {
                if (alive.current !== true) return
                setBusy((m) => { const n = { ...m }; delete n.__modal; return n })
                if (j !== null && typeof j === 'object' && j.ok === true) {
                  // From Featured we stay on Featured: the card turns to « Installed » in place. From Discover the new skill opens in Yours.
                  const fromFeatured = mode === 'featured'
                  setAskInstall(null); if (fromFeatured !== true) setDetail(null); setMode(fromFeatured ? 'featured' : 'yours'); loadCatalogue()
                  if (fromFeatured !== true && j.skill !== null && typeof j.skill === 'object') setLocal(j.skill)
                  setNotice({ kind: 'ok', text: t('notice.installed', { name: x.name }) + (j.files ? t('notice.files', { n: j.files }) : '') })
                } else setErrors((m) => ({ ...m, __modal: why(j, t('err.install')) }))
              }).catch(() => {
                if (alive.current !== true) return
                setBusy((m) => { const n = { ...m }; delete n.__modal; return n })
                setErrors((m) => ({ ...m, __modal: t('err.unavail', { r: 'install' }) }))
              })
            }
          })
          if (modal === 'install') return h(InstallModal, {
            roots, busy, preset: detail,
            onClose: () => setModal(null),
            onSubmit: (form) => {
              setBusy((m) => ({ ...m, __modal: true }))
              postJson('/kybernos-skills/install', form).then((j) => {
                if (alive.current !== true) return
                setBusy((m) => { const n = { ...m }; delete n.__modal; return n })
                if (j !== null && typeof j === 'object' && j.ok === true) {
                  setModal(null); setDetail(null); setMode('yours'); loadCatalogue()
                  setNotice({ kind: 'ok', text: t('notice.installed', { name: form.name }) + (j.files ? t('notice.files', { n: j.files }) : '') })
                } else setErrors((m) => ({ ...m, __modal: why(j, t('err.install')) }))
              }).catch(() => {
                if (alive.current !== true) return
                setBusy((m) => { const n = { ...m }; delete n.__modal; return n })
                setErrors((m) => ({ ...m, __modal: t('err.unavail', { r: 'install' }) }))
              })
            }, error: errors.__modal })
          return null
        }

        const panel = renderPanel()
        const list = h('div', null, mode === 'featured' ? (detail !== null ? renderPickDetail() : renderFeatured()) : (mode === 'yours' ? renderYours() : (mode === 'team' ? renderTeam() : renderDiscover())))
        const body = panel === null
          ? list
          : h('div', { className: 'kbs-split open' }, h('div', { className: 'kbs-list' }, list), panel)

        // (1 Oct) Same header as "Connections": title + subtitle on the left, main action on the right, then a
        // control row (sub-tabs on the left, search / filter / sort on the right).
        const capTxt = mode === 'featured'
          ? t('cap.featured')
          : mode === 'yours'
          ? t('cap.yours', { a: activeCount, n: skills.length }) + (learned.proposals.length > 0 ? ' · ' + t('ln.cap', { n: learned.proposals.length }) : '')
          : (mode === 'team' ? (tsum.phase === 'ready' ? t('cap.team', { ws: tsum.workspaceName || '…' }) : t('cap.teamLocked')) : (discKind === 'search' ? t('cap.search') : t('cap.rank')))
        // The shared bar (search, filter, order, and the primary action as its trailing item) sits in the header row, where Agent
        // Teams, Creations, Automations, Workspaces and Connectors put it. The page receives it as props from kybernos-plugin (a
        // bundle cannot see KbToolbar); mounted alone, it keeps its own controls on the tabs' row, as before.
        const tools = props !== null && props !== undefined && props.toolbar !== null && typeof props.toolbar === 'object' ? props.toolbar : null
        const KbBar = tools !== null && typeof tools.KbToolbar === 'function' ? tools.KbToolbar : null
        const barState = () => {
          if (mode === 'featured') {
            return { query: q.featured, sort: sort.featured, dir: dir.featured === -1 ? 'desc' : 'asc', types: pcat === 'all' ? [] : ['cat:' + pcat], period: 'all', fav: false, viewMode: views.featured }
          }
          if (mode === 'discover') {
            return { query: q.discover, sort: sort.discover === 'name' ? 'name' : (iview === 'all-time' ? 'installs' : iview), dir: dir.discover === -1 ? 'desc' : 'asc', types: iper === DISC_PER ? [] : ['rows:' + iper], period: 'all', fav: false, viewMode: views.discover }
          }
          const types = []
          if (stateFilter !== 'all') types.push('st:' + stateFilter)
          if (sourceFilter !== 'all') types.push('src:' + sourceFilter)
          if (originFilter !== 'all') types.push('org:' + originFilter)
          return { query: q[mode], sort: sort.yours, dir: dir.yours === -1 ? 'desc' : 'asc', types: mode === 'yours' ? types : [], period: 'all', fav: false, viewMode: views.yours }
        }
        // The bar's changes go to the page's own setters. The two filter groups of Yours (state, source) and the rows of Discover are
        // single choices: the one just ticked replaces the previous one of its group.
        const barUpdate = (patch) => {
          if (patch === null || typeof patch !== 'object') return
          if (mode === 'featured') {
            if (patch.query !== undefined) { const v = String(patch.query); setQ((m) => ({ ...m, featured: v })); setDetail(null) }
            if (patch.viewMode !== undefined) { setView('featured', patch.viewMode === 'list' ? 'list' : 'cards'); setDetail(null) }
            if (patch.sort !== undefined) {
              const k2 = ['editorial', 'installs', 'name'].indexOf(patch.sort) >= 0 ? patch.sort : 'editorial'
              // A new order starts from its natural direction: Most installed high to low, Name A to Z.
              setSort((m) => ({ ...m, featured: k2 })); setDir((m) => ({ ...m, featured: k2 === 'name' ? 1 : -1 }))
            }
            if (patch.dir !== undefined) setDir((m) => ({ ...m, featured: patch.dir === 'asc' ? 1 : -1 }))
            if (patch.types !== undefined) {
              const cur = pcat === 'all' ? [] : ['cat:' + pcat]
              const added = patch.types.filter((x2) => cur.indexOf(x2) < 0)
              setPcat(added.length > 0 ? String(added[added.length - 1]).slice(4) : 'all'); setDetail(null)
            }
            return
          }
          if (patch.query !== undefined) { const v = String(patch.query); setQ((m) => ({ ...m, [mode]: v })) }
          if (patch.viewMode !== undefined && (mode === 'yours' || mode === 'discover')) setView(mode, patch.viewMode === 'list' ? 'list' : 'cards')
          if (mode === 'discover') {
            if (patch.sort !== undefined) {
              if (patch.sort === 'name') setSort((m) => ({ ...m, discover: 'name' }))
              else { setSort((m) => ({ ...m, discover: 'installs' })); setIview(patch.sort === 'installs' ? 'all-time' : String(patch.sort)) }
            }
            if (patch.dir !== undefined) setDir((m) => ({ ...m, discover: patch.dir === 'asc' ? 1 : -1 }))
            if (patch.types !== undefined) {
              const cur = iper === DISC_PER ? [] : ['rows:' + iper]
              const added = patch.types.filter((x) => cur.indexOf(x) < 0)
              const pick = added.length > 0 ? String(added[added.length - 1]) : ''
              setIper(/^rows:\d+$/.test(pick) ? Number(pick.slice(5)) : DISC_PER)
            }
            return
          }
          if (patch.sort !== undefined) setSort((m) => ({ ...m, yours: String(patch.sort) }))
          if (patch.dir !== undefined) setDir((m) => ({ ...m, yours: patch.dir === 'asc' ? 1 : -1 }))
          if (patch.types !== undefined && mode === 'yours') {
            const cur = barState().types
            let st = stateFilter
            let so = sourceFilter
            let og = originFilter
            for (const x of cur) if (patch.types.indexOf(x) < 0) { if (String(x).startsWith('st:')) st = 'all'; else if (String(x).startsWith('org:')) og = 'all'; else so = 'all' }
            for (const x of patch.types) {
              if (cur.indexOf(x) >= 0) continue
              if (String(x).startsWith('st:')) st = String(x).slice(3)
              else if (String(x).startsWith('org:')) og = String(x).slice(4)
              else if (String(x).startsWith('src:')) so = String(x).slice(4)
            }
            setStateFilter(st); setSourceFilter(so); setOriginFilter(og)
          }
        }
        const barSorts = () => (mode === 'featured'
          ? [{ id: 'editorial', label: t('sort.editorial') }, { id: 'installs', label: t('sort.installs') }, { id: 'name', label: t('sort.name') }]
          : mode === 'discover'
          ? VUES.map((v) => ({ id: v[0] === 'all-time' ? 'installs' : v[0], label: v[1] })).concat([{ id: 'name', label: t('sort.name') }])
          : [{ id: 'recent', label: t('sort.recent') }, { id: 'name', label: t('sort.name') }])
        const barFacets = () => (mode === 'featured'
          ? { type: { options: PICK_CATS.filter((c) => pickCounts()[c] > 0).map((c) => ({ id: 'cat:' + c, label: t('pcat.' + c), count: pickCounts()[c] })) } }
          : mode === 'discover'
          ? { type: { options: [DISC_PER, 50, 100, 250].map((n) => ({ id: 'rows:' + n, label: t('flt.rows') + ': ' + n })) } }
          : { type: { options: [{ id: 'st:active', label: t('card.active'), count: activeCount }, { id: 'st:disabled', label: t('card.disabled'), count: skills.length - activeCount }]
            .concat(sources.map((s) => ({ id: 'src:' + s, label: s, count: skills.filter((x) => x.source === s).length })))
            .concat(learned.proposals.length > 0 ? [{ id: 'org:kaby', label: t('ln.f.kaby'), count: learned.proposals.length }] : [])
            .concat(learned.learned.length > 0 ? [{ id: 'org:learned', label: t('ln.f.learned'), count: learned.learned.length }] : []) } })
        const teamBarShown = mode === 'team' && tsum.phase === 'ready' && teamOpen === null
        const barShown = KbBar !== null && (mode === 'discover' || (mode === 'featured' && picks.phase === 'ready') || (mode === 'yours' && skills.length > 0) || teamBarShown)
        const teamAction = primary(teamRoleAdmin(tsum.role) ? t('tm.add') : t('tm.propose'), () => setTeamSheet(true), 'plus')
        const journalBtn = mode === 'yours' && learned.phase === 'ready' ? h('button', { type: 'button', className: 'kb8-ghost', 'data-kb': 'learned-journal-btn', 'aria-pressed': journalOpen ? 'true' : 'false', onClick: () => { setJournalOpen((v) => !v); setReview(null); setLocal(null) } }, icon('file', 15), h('span', null, t('ln.j.btn'))) : null
        const headAction = mode === 'team' ? (teamBarShown ? teamAction : null) : (journalBtn === null ? renderAdd() : h(React.Fragment, null, journalBtn, renderAdd()))
        const helpBtn = (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-skills' }) : null)
        // The animated help: opens the first time the page is visited (the hub remembers it was closed), and the card of the button above can bring it back.
        const introNode = (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Intro
          ? h(window.__KB_HELP__.Intro, {
            id: 'kybernos-skills',
            title: t('intro.title'),
            caption: t('intro.caption'),
            steps: [{ t: t('intro.s1t'), b: t('intro.s1b') }, { t: t('intro.s2t'), b: t('intro.s2b') }, { t: t('intro.s3t'), b: t('intro.s3b') }],
            mock: { bar: 'Skills', rows: [t('intro.m.row')], hot: t('intro.m.hot'), states: [t('intro.m.st1'), t('intro.m.st2'), t('intro.m.st3')], actions: [t('btn.install'), t('intro.m.st2'), t('intro.m.open')] }
          })
          : null)
        return h('div', { className: 'kbs-root' },
          KbBar !== null
            ? h('div', { className: 'kb6-headrow' },
              h('div', { className: 'kb6-headcol' },
                h('div', { className: 'kb6-titlerow' }, h('h1', { className: 'kb6-title' }, pageTitle()), helpBtn),
                h('p', { className: 'kb8-sub', title: capTxt }, capTxt)),
              barShown === true
                ? h(KbBar, {
                  state: barState(),
                  onUpdate: barUpdate,
                  searchPlaceholder: mode === 'team' ? t('tm.search') : (mode === 'featured' ? t('ph.featured') : (mode === 'yours' ? t('ph.yours') : t('ph.discover'))),
                  sortOptions: mode === 'team' ? [] : barSorts(),
                  hideSort: mode === 'team',
                  facets: mode === 'team' ? {} : barFacets(),
                  total: mode === 'featured' ? picks.items.length : (mode === 'yours' ? skills.length : (mode === 'discover' ? discTotal : 0)),
                  shown: mode === 'featured' ? pickList().length : (mode === 'yours' ? filtered.length : (mode === 'discover' ? discList.length : 0)),
                  hideView: mode === 'team',
                  views: ['cards', 'list'],
                  showFav: false,
                  trailing: headAction,
                })
                : h('div', { className: 'kb6-headacts' }, headAction))
            : h('div', { className: 'kbs-top' },
              h('div', { className: 'kbs-top-txt' },
                h('div', { className: 'kbhp-row' }, helpBtn),
                h('h2', { className: 'kbs-h1' }, pageTitle()),
                h('p', { className: 'kbs-sub', title: capTxt }, capTxt)),
              mode !== 'team' ? headAction : null),
          introNode,
          h('div', { className: 'kbs-ctlrow' },
            h('nav', { className: 'kbsub' },
              // Same capsule as the "Connections" sub-tabs (Your connections / Discover): one single language.
              h('div', { className: 'kbsub-group', role: 'tablist' },
                picks.phase !== 'absent' ? h('button', { type: 'button', role: 'tab', 'aria-selected': mode === 'featured' ? 'true' : 'false', className: 'kb-seg' + (mode === 'featured' ? ' on' : ''), 'data-kb': 'seg-featured', onClick: () => { setMode('featured'); setDetail(null); setLocal(null) } },
                  'Featured ', h('span', { className: 'count' }, picks.phase === 'ready' ? String(picks.items.length) : '—')) : null,
                h('button', { type: 'button', role: 'tab', 'aria-selected': mode === 'yours' ? 'true' : 'false', className: 'kb-seg' + (mode === 'yours' ? ' on' : ''), onClick: () => { setMode('yours'); setDetail(null); setLocal(null) } },
                  'Yours ', h('span', { className: 'count' }, count)),
                h('button', { type: 'button', role: 'tab', 'aria-selected': mode === 'discover' ? 'true' : 'false', className: 'kb-seg' + (mode === 'discover' ? ' on' : ''), onClick: () => { setMode('discover'); setDetail(null); setLocal(null) } },
                  'Discover ', disc !== null && Array.isArray(disc.skills) ? h('span', { className: 'count' }, String(discTotal)) : null),
                tsum.phase !== 'absent' ? h('button', { type: 'button', role: 'tab', 'aria-selected': mode === 'team' ? 'true' : 'false', className: 'kb-seg' + (mode === 'team' ? ' on' : ''), onClick: () => { setMode('team'); setDetail(null); setLocal(null); setTeamOpen(null) } },
                  'Team ', tsum.phase === 'ready' ? h('span', { className: 'count' }, String((tsum.counts && tsum.counts.approved) || 0)) : (tsum.phase === 'locked' ? icon('lock', 13) : h('span', { className: 'count' }, '—')),
                  tsum.phase === 'ready' && teamRoleAdmin(tsum.role) && tsum.counts && tsum.counts.pending > 0 ? h('span', { className: 'kbt-dot', title: t('tm.v.review') }) : null) : null)),
            mode === 'yours' && learned.proposals.length > 0
              ? h('button', { type: 'button', className: 'kbl-chip' + (originFilter === 'kaby' ? ' on' : ''), 'data-kb': 'learned-chip', 'aria-pressed': originFilter === 'kaby' ? 'true' : 'false', onClick: () => setOriginFilter(originFilter === 'kaby' ? 'all' : 'kaby') }, h('i', { className: 'kbl-dot' }), t('ln.f.kaby') + ' · ' + learned.proposals.length)
              : null,
            KbBar !== null ? null : (mode === 'team' ? (tsum.phase === 'ready' && teamOpen === null ? renderTeamToolbar() : null) : renderToolbar())),
          h('div', { className: 'kb8-page' }, body),
          renderModal(),
          notice !== null ? h('div', { className: 'kbs-toast' + (notice.kind === 'err' ? ' err' : '') },
            icon(notice.kind === 'err' ? 'info' : 'check', 15), h('span', null, notice.text),
            typeof notice.undo === 'function' ? h('button', { type: 'button', className: 'kbs-link', 'data-kb': 'notice-undo', onClick: () => { const u = notice.undo; setNotice(null); u() } }, t('ln.undo')) : null) : null)
      }

      // A suggestion of Kaby, opened on the right: why it was suggested, the text it would write (or the paragraph it would add), its confidence and why Kaby may not act alone,
      // the checks it passed and the three answers (Accept, Edit, Discard). Nothing is active before Accept unless the person's own level and line say so, and then it never
      // reaches this panel. The rules every learned skill ends with are shown, dimmed, under the text.
      function LearnedPanel(props) {
        const p = props.p
        const st = props.st
        const editing = st.edit === true
        const imp = p.kind === 'improve'
        const body = editing ? st.body : p.body
        const description = editing ? st.description : p.description
        const add = editing ? st.add : p.add
        const hits = !editing && Array.isArray(p.hits) ? p.hits : []
        const base = p.description.length + 1
        const mark = (text, from) => {
          const out = []
          let at = 0
          hits.filter((x) => x.s >= from && x.e <= from + String(text).length).forEach((x, i) => {
            out.push(String(text).slice(at, x.s - from), h('mark', { key: 'm' + i, className: 'kbl-flag', title: x.kind }, String(text).slice(x.s - from, x.e - from)))
            at = x.e - from
          })
          out.push(String(text).slice(at))
          return out
        }
        const checkText = (c) => {
          if (c.id === 'name') return t('ln.c.name') + ' · ' + String(c.name)
          if (c.id === 'use_when') return t('ln.c.use_when')
          if (c.id === 'rules') return t('ln.c.rules')
          if (c.id === 'size') return t('ln.c.size', { size: c.size, max: c.max })
          if (c.id === 'copy') return c.s === 'ok' ? t('ln.c.copy') : t('ln.c.copy.warn', { name: c.closest, pct: c.percent })
          return c.count === 0 ? t('ln.c.client_data') : t('ln.c.client_data.n', { n: c.count }) + ' — ' + (props.sensitive ? t('ln.c.client_data.block') : t('ln.c.client_data.warn'))
        }
        const lessons = p.from !== null && typeof p.from === 'object' && Array.isArray(p.from.lessons) ? p.from.lessons : []
        const auto = p.from !== null && typeof p.from === 'object' && p.from.automation !== undefined && p.from.automation !== null ? p.from.automation : null
        const whyText = imp ? t('ln.p.imp.why', { name: p.target, v: p.baseVer }) : (auto !== null ? t('ln.p.why.auto', { name: auto.name || '', n: auto.runs || 0 }) : (p.kind === 'asked' ? (p.from !== null && typeof p.from === 'object' && p.from.repeats !== undefined && p.from.repeats !== null ? t('ln2.p.why.repeat', { n: p.from.repeats.n, dates: p.from.repeats.dates.map((d) => today(d + 'T12:00:00Z')).join(', ') }) : t('ln.p.why.asked')) : (lessons.length > 1 ? t('ln.p.why.lessons', { n: lessons.length }) : t('ln.p.why.lesson'))))
        const busy = props.busy === true
        const score = p.score !== undefined && p.score !== null ? p.score : null
        const stops = Array.isArray(p.stops) ? p.stops : []
        const untrusted = p.source !== null && p.source !== undefined && p.source.tainted !== false
        const title = imp ? p.target + ' · v' + String(p.baseVer) + ' → v' + String(p.baseVer + 1) : p.name
        return h('aside', { className: 'kbs-panel', 'aria-label': title + ' — ' + t('ln.badge.suggested'), 'data-kb': 'learned-panel' },
          h('div', { className: 'kbs-panel-top' },
            h('span', { className: 'kb8-mono kbs-nowrap' }, t('ln.p.crumb') + ' › ' + title),
            h('button', { type: 'button', className: 'kb-tool', 'aria-label': t('panel.close'), title: t('panel.close'), onClick: props.onClose }, '✕')),
          h('div', { className: 'kb-detail-head' },
            tile(imp ? p.target : p.name, 'pkg', 'lg'),
            h('div', { className: 'meta' },
              h('span', { className: 'kb8-h1', style: { fontSize: '19px', overflowWrap: 'anywhere' } }, title),
              h('div', { className: 'kb8-pills' },
                h('span', { key: 'sg', className: 'kb8-pill kbl-sug' }, icon('wand', 11), imp ? t('ln.badge.improve') : t('ln.badge.suggested')),
                h('span', { key: 'na', className: 'kb8-pill' }, t('ln.p.notactive')),
                props.sensitive ? h('span', { key: 'lo', className: 'kb8-pill' }, t('ln.p.local')) : null))),
          h('span', { className: 'kb-section-label' }, t('ln.p.why')),
          h('p', { className: 'kbl-p' }, whyText),
          imp && p.reason ? h('p', { className: 'kbl-p' }, t('ln.p.imp.reason', { r: p.reason })) : null,
          lessons.length > 0 ? h('ul', { className: 'kbl-prov' }, lessons.map((l, i) => h('li', { key: 'l' + i }, String(l.text) + (String(l.text).length >= 140 ? '…' : '')))) : null,
          imp ? null : h('span', { className: 'kb-section-label' }, t('ln.p.when')),
          imp ? null : (editing
            ? h('textarea', { className: 'kbs-area', style: { minHeight: '64px' }, 'aria-label': t('ln.p.when'), value: description, onChange: (e) => props.onChange({ description: e.target.value }) })
            : h('p', { className: 'kbl-p', 'data-kb': 'learned-desc' }, mark(description, 0))),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
            h('span', { className: 'kb-section-label' }, imp ? t('ln.p.imp.add') : t('ln.p.does')),
            hits.length > 0 ? h('button', { type: 'button', className: 'kb8-ghost', 'data-kb': 'learned-fix', disabled: busy, onClick: props.onFix }, t('ln.p.fix')) : null),
          imp
            ? (editing
              ? h('textarea', { className: 'kbs-area', style: { minHeight: '90px' }, 'aria-label': t('ln.p.imp.add'), value: add, onChange: (e) => props.onChange({ add: e.target.value }) })
              : h('div', { className: 'kbl-diff', 'data-kb': 'learned-diff' }, h('div', { className: 'ad' }, '+ ' + add)))
            : (editing
              ? h('textarea', { className: 'kbs-area', style: { minHeight: '220px' }, 'aria-label': t('ln.p.does'), value: body, onChange: (e) => props.onChange({ body: e.target.value }) })
              : h('pre', { className: 'kb-local-body', 'data-kb': 'learned-text' }, mark(body, base))),
          imp ? null : h('span', { className: 'kb-section-label' }, t('ln.p.rules')),
          imp ? null : h('pre', { className: 'kb-local-body kbl-dim' }, props.rules.map((r) => '- ' + r).join('\n')),
          score !== null ? h('div', { className: 'kbl-conf', 'data-kb': 'learned-confidence' },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
              h('span', { className: 'kb-section-label' }, t('ln.p.conf')),
              h('span', { className: 'kb8-pill' }, String(score.total) + ' / 100'),
              props.line !== undefined && props.line !== null ? h('span', { className: 'kb8-pill' }, t('ln.p.conf.line', { th: props.line })) : null),
            h('div', null, score.signals.map((x) => h('div', { key: x.id, className: 'kbl-sg' }, h('span', null, t('ln.sig.' + x.id)), h('div', { className: 'kbl-bar' }, h('i', { style: { width: Math.round(x.v / x.max * 100) + '%' } })), h('span', { className: 'kb8-mono' }, String(x.v))))),
            score.risky === true ? h('p', { className: 'kbl-p' }, icon('alert', 12), ' ' + t('ln.p.risky')) : null,
            untrusted && p.kind !== 'auto' && p.kind !== 'lessons' ? h('p', { className: 'kbl-p' }, icon('alert', 12), ' ' + t('ln.p.untrusted')) : null,
            h('p', { className: 'kbl-p' }, h('b', null, t('ln.p.with') + ' '), stops.length === 0 ? t('ln.stop.none') : stops.slice(0, 3).map((c) => t('ln.stop.' + c)).join(' ; '))) : null,
          h('span', { className: 'kb-section-label' }, t('ln.p.checks')),
          h('div', { className: 'kbl-checks', 'data-kb': 'learned-checks' }, p.checks.map((c) =>
            h('div', { key: c.id, className: c.s }, h('span', { className: 'm' }, c.s === 'ok' ? '✓' : (c.s === 'warn' ? '!' : '✕')), h('span', null, checkText(c))))),
          editing ? h('span', { className: 'kb8-mono' }, t('ln.p.editnote')) : null,
          h('span', { className: 'kb-section-label' }, t('ln.p.where')),
          h('p', { className: 'kbl-p' }, props.sensitive ? t('ln.p.where.s') : t('ln.p.where.t')),
          props.err ? h('div', { className: 'kbs-err', role: 'alert' }, props.err) : null,
          h('div', { className: 'kbs-panel-acts' },
            editing
              ? [h('button', { key: 'sv', type: 'button', className: 'kb8-primary', 'data-kb': 'learned-save', disabled: busy, onClick: props.onSave }, t('ln.save')),
                h('button', { key: 'cn', type: 'button', className: 'kb8-ghost', onClick: props.onCancel }, t('ln.cancel'))]
              : [h('button', { key: 'ac', type: 'button', className: 'kb8-primary', 'data-kb': 'learned-accept', disabled: busy || p.blocking === true, onClick: props.onAccept }, t('ln.accept')),
                h('button', { key: 'ed', type: 'button', className: 'kb8-ghost', 'data-kb': 'learned-edit', disabled: busy, onClick: props.onEdit }, t('ln.edit')),
                h('button', { key: 'di', type: 'button', className: 'kb8-ghost warn', 'data-kb': 'learned-discard', disabled: busy, onClick: props.onDiscard }, t('ln.discard'))]),
          h('span', { className: 'kb8-mono' }, p.blocking === true && !editing ? t('ln.accept.locked') : t('ln.accept.note')))
      }

      // Kaby's journal, opened on the right: every suggestion, acceptance, change Kaby made on its own, refusal, undo and change of settings, newest first, from the
      // append-only file on this computer. A change Kaby made on its own that is still the last one of its skill carries Undo.
      function JournalPanel(props) {
        const [data, setData] = React.useState({ phase: 'loading' })
        const [open, setOpen] = React.useState({})
        React.useEffect(() => {
          let stop = false
          getJson('/kybernos-skills/learned/journal?limit=200').then((j) => {
            if (stop === true) return
            setData(j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.entries) ? { phase: 'ready', ...j } : { phase: 'error', error: why(j, t('err.unexpected', { r: 'learned/journal' })) })
          }).catch(() => { if (stop !== true) setData({ phase: 'error', error: t('err.unavail', { r: 'learned/journal' }) }) })
          return () => { stop = true }
        }, [props.tick])
        const ACTS = ['proposed', 'accepted', 'created', 'improved', 'discarded', 'restored', 'reverted', 'reviewed', 'expired', 'adopted', 'removed', 'settings', 'paused', 'shared']
        const when = (iso) => { try { return new Date(iso).toLocaleString(isEn() ? 'en-GB' : 'fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch (e) { return '' } }
        const src = (f) => {
          if (f === null || typeof f !== 'object') return ''
          if (f.automation !== undefined && f.automation !== null) return f.automation.name ? t('ln.from.auto', { name: f.automation.name, n: f.automation.runs || 0 }) : t('ln.from.auto.anon', { n: f.automation.runs || 0 })
          if (f.asked === true) return t('ln.from.asked')
          return Array.isArray(f.lessons) ? t('ln.from.lessons', { n: f.lessons.length }) : ''
        }
        const ready = data.phase === 'ready'
        const all = ready ? data.entries : []
        const canUndo = (e) => e.by === 'kaby' && e.mode === 'auto' && (e.act === 'created' || e.act === 'improved') && !all.some((x) => x.n > e.n && x.skill === e.skill && ['created', 'accepted', 'improved', 'reverted', 'removed'].indexOf(x.act) >= 0)
        return h('aside', { className: 'kbs-panel', 'aria-label': t('ln.j.title'), 'data-kb': 'learned-journal' },
          h('div', { className: 'kbs-panel-top' },
            h('span', { className: 'kb8-mono kbs-nowrap' }, t('ln.j.title')),
            h('button', { type: 'button', className: 'kb-tool', 'aria-label': t('panel.close'), title: t('panel.close'), onClick: props.onClose }, '✕')),
          ready ? h('div', { className: 'kb8-pills' },
            data.verified === true
              ? h('span', { key: 'v', className: 'kb8-pill ok', 'data-kb': 'journal-verified' }, icon('check', 12), t('ln.j.verified'))
              : h('span', { key: 'v', className: 'kb8-pill warn', 'data-kb': 'journal-broken' }, data.brokenAt > 0 ? t('ln.j.broken', { n: data.brokenAt }) : t('ln.j.broken.bad')),
            h('span', { key: 'n', className: 'kb8-pill' }, t('ln.j.entries', { n: data.count }))) : null,
          data.phase === 'loading' ? h('span', { className: 'kb8-mono' }, t('y.loading')) : null,
          data.phase === 'error' ? h('div', { className: 'kbs-err', role: 'alert' }, data.error) : null,
          ready && all.length === 0 ? h('p', { className: 'kbl-p' }, t('ln.j.empty')) : null,
          ready ? h('div', null, all.map((e) => {
            const o = open[e.n] === true
            const act = t('ln.j.act.' + (ACTS.indexOf(e.act) >= 0 ? e.act : 'other'))
            const settingsLine = e.act === 'settings' && e.from !== null && typeof e.from === 'object' && e.from.settings !== undefined && e.from.settings !== null
              ? t('ln.j.level', { mode: t('ln.mode.' + (['ask', 'improve', 'auto'].indexOf(e.from.settings.mode) >= 0 ? e.from.settings.mode : 'ask')), th: e.from.settings.threshold, cap: e.from.settings.cap }) : ''
            const added = e.from !== null && typeof e.from === 'object' && e.from.improve !== undefined && e.from.improve !== null && typeof e.from.improve.add === 'string' ? e.from.improve.add : ''
            return h('div', { key: 'e' + e.n, className: 'kbl-jr', 'data-kb': 'journal-entry' },
              h('button', { type: 'button', 'aria-expanded': o ? 'true' : 'false', onClick: () => setOpen((m) => ({ ...m, [e.n]: !m[e.n] })) },
                h('span', { className: 'kbl-jt' }, e.skill !== '—' ? h('b', { className: 'kb8-mono' }, e.skill) : null, (e.skill !== '—' ? ' ' : '') + act + (Number.isInteger(e.ver) && (e.act === 'improved' || e.act === 'reverted') ? ' v' + String(e.ver) : ''), h('small', null, when(e.t) + (e.mode !== 'approved' && ['manual', 'legacy', 'auto'].indexOf(e.mode) >= 0 && e.act !== 'settings' ? ' · ' + t('ln.j.mode.' + e.mode) : '') + (typeof e.score === 'number' ? ' · ' + t('ln.j.score', { s: e.score }) : ''))),
                h('span', { className: 'kb8-pill' + (e.by === 'kaby' ? ' warn' : '') }, t('ln.j.by.' + (e.by === 'kaby' ? 'kaby' : 'you')))),
              o ? h('div', { className: 'kbl-jb' },
                settingsLine !== '' ? h('div', null, settingsLine) : null,
                src(e.from) !== '' ? h('div', null, t('ln.j.from', { src: src(e.from) })) : null,
                added !== '' ? h('div', { className: 'kbl-diff' }, h('div', { className: 'ad' }, '+ ' + added)) : null,
                Array.isArray(e.sig) ? h('div', null, e.sig.map((x) => h('div', { key: x[0], className: 'kbl-sg' }, h('span', null, t('ln.sig.' + x[0])), h('span', { className: 'kb8-mono' }, String(x[1]))))) : null,
                typeof e.note === 'string' && STR['ln.j.note.' + e.note] !== undefined ? h('div', null, t('ln.j.note.' + e.note)) : null,
                h('div', { className: 'kb8-mono' }, '#' + String(e.hash).slice(0, 8) + ' ← #' + String(e.prev).slice(0, 8)),
                canUndo(e) ? h('div', null, h('button', { type: 'button', className: 'kb8-ghost', 'data-kb': 'journal-undo', onClick: () => props.onUndo(e.skill) }, t('ln.j.undo'))) : null) : null)
          })) : null,
          h('span', { className: 'kb8-mono' }, t('ln.j.foot')))
      }

      // The two small writers of the chat card and the settings page share this: where a person is sent to read something on the Skills page.
      const kbOpenSkills = (key, value) => {
        try { window.sessionStorage.setItem(key, value) } catch (e) { /* the page opens without the hint */ }
        try { if (typeof window.__KB_OPEN__ === 'function') window.__KB_OPEN__({ view: 'skills' }) } catch (e) { /* the menu is the other way in */ }
      }

      // At the end of the last answer of a chat: what Kaby suggested from THIS chat (waiting for the person), and what it applied on its own. The cards are shown only for the
      // last turn (the slot runs for every answer), found by a light read of the host for this chat only; nothing is stored, and an absent route draws nothing.
      const kbTail = { max: new Map(), subs: new Set() }
      const kbTailSeq = (props) => (props !== null && props !== undefined ? (typeof props.seq === 'number' ? props.seq : (typeof props.turn === 'number' ? props.turn : undefined)) : undefined)
      function LearnedTail(props) {
        const sid = props !== null && props !== undefined && typeof props.sessionId === 'string' ? props.sessionId : ''
        const seq = kbTailSeq(props)
        const [last, setLast] = React.useState(() => typeof seq !== 'number' ? true : (kbTail.max.get(sid) === undefined ? true : kbTail.max.get(sid) === seq))
        const [view, setView] = React.useState(null)
        const [done, setDone] = React.useState({})
        const alive = React.useRef(true)
        React.useEffect(() => () => { alive.current = false }, [])
        React.useEffect(() => {
          if (typeof seq !== 'number' || sid === '') return undefined
          const refresh = () => setLast(kbTail.max.get(sid) === seq)
          kbTail.subs.add(refresh)
          if (seq > (kbTail.max.get(sid) === undefined ? -1 : kbTail.max.get(sid))) { kbTail.max.set(sid, seq); kbTail.subs.forEach((f) => { try { f() } catch (e) { /* a listener must not break the others */ } }) }
          setLast(kbTail.max.get(sid) === seq)
          return () => { kbTail.subs.delete(refresh) }
        }, [sid, seq])
        const read = React.useCallback(() => fetch('/kybernos-skills/learned/session?sessionId=' + encodeURIComponent(sid), { headers: { accept: 'application/json' } }).then((r) => r.json()).then((j) => {
          if (alive.current === true && j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.suggested)) setView(j)
        }).catch(() => null), [sid])
        React.useEffect(() => {
          if (sid === '' || last !== true) return undefined
          read()
          const a = setTimeout(read, 2500)
          const b = setTimeout(read, 9000)
          return () => { clearTimeout(a); clearTimeout(b) }
        }, [sid, last, seq])
        if (view === null || last !== true) return null
        const fresh = (iso) => { const ms = Date.parse(iso); return Number.isFinite(ms) && Date.now() - ms < 30 * 60 * 1000 }
        const sug = view.suggested.filter((s) => done[s.id] !== true && fresh(s.createdAt)).slice(0, 2)
        const applied = view.applied.filter((a) => a.auto === true && a.reviewed === false && done['a:' + a.name] !== true && fresh(a.at)).slice(0, 2)
        if (sug.length === 0 && applied.length === 0) return null
        const act = (path, body, key) => postJson('/kybernos-skills/learned/' + path, body).then(() => { if (alive.current === true) { setDone((m) => ({ ...m, [key]: true })); try { if (window.__KB_LEARNED__ && typeof window.__KB_LEARNED__.refresh === 'function') window.__KB_LEARNED__.refresh() } catch (e) { /* the dot catches up */ } } }).catch(() => null)
        return h('div', { className: 'kbl-tail', 'data-kb': 'learned-tail' },
          sug.map((s) => h('div', { key: 's' + s.id, className: 'kbl-tcard', 'data-kb': 'learned-tail-suggest' },
            h('div', { className: 'kbl-tr' }, h('span', { className: 'kbl-pill sug' }, icon('wand', 11), t('ln.badge.suggested')), h('b', { className: 'kbl-mono' }, s.name)),
            h('div', { className: 'kbl-how' }, (s.kind === 'improve' ? t('ln.t.improve', { name: s.name }) : t('ln.t.suggest', { name: s.name })) + ' ' + t('ln.t.waits')),
            h('div', { className: 'kbl-how' }, s.description),
            h('div', { className: 'kbl-tr' },
              h('button', { type: 'button', className: 'kbl-btn pri', 'data-kb': 'learned-tail-review', onClick: () => kbOpenSkills('kybernos.skills.review', s.id) }, t('ln.review')),
              h('button', { type: 'button', className: 'kbl-btn', 'data-kb': 'learned-tail-discard', onClick: () => act('discard', { id: s.id }, s.id) }, t('ln.discard'))))),
          applied.map((a) => h('div', { key: 'a' + a.name, className: 'kbl-tcard', 'data-kb': 'learned-tail-applied' },
            h('div', { className: 'kbl-tr' }, h('span', { className: 'kbl-pill sug' }, icon('wand', 11), t('ln.chip.auto')), h('b', { className: 'kbl-mono' }, a.name)),
            h('div', { className: 'kbl-how' }, a.ver > 1 ? t('ln.t.autoimp', { name: a.name, v: a.ver, s: a.score }) : t('ln.t.auto', { name: a.name, s: a.score })),
            h('div', { className: 'kbl-tr' },
              h('button', { type: 'button', className: 'kbl-btn', 'data-kb': 'learned-tail-journal', onClick: () => kbOpenSkills('kybernos.skills.journal', '1') }, t('ln.j.btn')),
              h('button', { type: 'button', className: 'kbl-btn', 'data-kb': 'learned-tail-undo', onClick: () => act('undo', { name: a.name }, 'a:' + a.name) }, t('ln.undo'))))))
      }

      // ── what Kaby notices and tells (V2): a task that comes back, and the week ──────────────────────────────────────────────
      // Two cards in the dock above the composer (`conversation.input.dock`), each a small component that asks the host for its own chat and draws nothing when there
      // is nothing to say: the host holds the rules (what counts as « alike », once a day, once a week, the person's settings).
      const kbDockKaby = (sid) => { try { return window.__KB_KYBER__ !== undefined && window.__KB_KYBER__ !== null && typeof window.__KB_KYBER__.isKybySession === 'function' && window.__KB_KYBER__.isKybySession(sid) === true } catch (e) { return false } }
      const kbOrd = (n) => (isEn() ? String(n) + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th') : String(n) + 'e')
      const kbShortDay = (d) => { try { return new Date(d + 'T12:00:00Z').toLocaleDateString(isEn() ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' }) } catch (e) { return String(d) } }
      /** Is the chat in the middle of a turn? The dock entry gets the session's own state (`session.running`, the submissions still waiting); measured on a real dock. */
      const kbBusy = (p) => {
        const s = p !== null && p !== undefined && p.session !== null && typeof p.session === 'object' ? p.session : {}
        const waiting = Array.isArray(s.pendingSubmissions) ? s.pendingSubmissions.length : (Number.isFinite(s.pendingSubmissions) ? s.pendingSubmissions : 0)
        return s.running === true || waiting > 0
      }
      const kbDraftOf = (p) => (p !== null && p !== undefined && p.input !== null && typeof p.input === 'object' && typeof p.input.draft === 'string' ? p.input.draft : '')
      const kbGoSkills = () => { try { if (typeof window.__KB_OPEN__ === 'function') window.__KB_OPEN__({ view: 'skills' }) } catch (e) { /* the menu is the other way in */ } }

      function LearnedNotice (props) {
        const p = props !== null && props !== undefined ? props : {}
        const sid = typeof p.sessionId === 'string' ? p.sessionId : ''
        const blank = p.session !== null && p.session !== undefined && p.session.blank === true
        const draft = kbDraftOf(p)
        const busy = kbBusy(p)
        const [n, setN] = React.useState(null)
        const [msg, setMsg] = React.useState('')
        const [filled, setFilled] = React.useState(false)
        const alive = React.useRef(true)
        React.useEffect(() => () => { alive.current = false }, [])
        React.useEffect(() => { setN(null); setMsg(''); setFilled(false) }, [sid])
        React.useEffect(() => {
          if (sid === '' || blank || busy || kbDockKaby(sid)) return undefined
          let stop = false
          fetch('/kybernos-skills/learned/notice?sessionId=' + encodeURIComponent(sid), { headers: { accept: 'application/json' } }).then((r) => r.json()).then((j) => {
            if (stop === false && alive.current === true && j !== null && typeof j === 'object' && j.ok === true) setN(j.notice !== undefined && j.notice !== null ? j.notice : null)
          }).catch(() => null)
          return () => { stop = true }
        }, [sid, blank, busy])
        if (sid === '' || blank) return null
        if (filled === true) return draft.trim() !== '' ? h('div', { className: 'kbl-tail kbl-dk', 'data-kb': 'learned-notice-filled' }, h('div', { className: 'kbl-how' }, icon('wand', 12), ' ' + t('ln2.n.filled'))) : null
        if (msg !== '') return h('div', { className: 'kbl-tail kbl-dk', 'data-kb': 'learned-notice-done' }, h('div', { className: 'kbl-how' }, msg))
        if (n === null || busy === true || draft.trim() !== '') return null
        const answer = (a) => postJson('/kybernos-skills/learned/notice/answer', { id: n.id, answer: a }).catch(() => null)
        const yes = () => {
          let ok = false
          try { if (p.inputActions !== null && p.inputActions !== undefined && typeof p.inputActions.setDraft === 'function') { p.inputActions.setDraft(t('ln2.n.prompt')); ok = true } } catch (e) { ok = false }
          answer('yes')
          if (ok === true) setFilled(true)
          setN(null)
        }
        const label = typeof n.label === 'string' && n.label !== '' ? (isEn() ? ' (“' + n.label + '”)' : ' (« ' + n.label + ' »)') : ''
        return h('div', { className: 'kbl-tail kbl-dk', 'data-kb': 'learned-notice' },
          h('div', { className: 'kbl-tcard' },
            h('div', { className: 'kbl-tr' }, h('span', { className: 'kbl-pill sug' }, icon('wand', 11), t('ln.badge.suggested'))),
            h('div', { className: 'kbl-how', 'data-kb': 'learned-notice-text' }, t('ln2.n.text', { nth: kbOrd(n.n), label, dates: n.dates.map(kbShortDay).join(', ') })),
            h('div', { className: 'kbl-tr' },
              h('button', { type: 'button', className: 'kbl-btn pri', 'data-kb': 'learned-notice-yes', onClick: yes }, t('ln2.n.yes')),
              h('button', { type: 'button', className: 'kbl-btn', 'data-kb': 'learned-notice-later', onClick: () => { answer('later'); setN(null); setMsg(t('ln2.n.later.done')) } }, t('ln2.n.later')),
              h('button', { type: 'button', className: 'kbl-btn', 'data-kb': 'learned-notice-never', onClick: () => { answer('never'); setN(null); setMsg(t('ln2.n.never.done')) } }, t('ln2.n.never'))),
            h('div', { className: 'kbl-how kbl-dim2' }, (n.label === null ? icon('lock', 12) : null), (n.label === null ? ' ' + t('ln2.n.foot.priv') + ' ' : ''), t('ln2.n.foot'))))
      }

      function LearnedWeek (props) {
        const p = props !== null && props !== undefined ? props : {}
        const sid = typeof p.sessionId === 'string' ? p.sessionId : ''
        const blank = p.session !== null && p.session !== undefined && p.session.blank === true
        const [w, setW] = React.useState(null)
        const [lessons, setLessons] = React.useState(null)
        const [gone, setGone] = React.useState({})
        const [hidden, setHidden] = React.useState(false)
        const alive = React.useRef(true)
        React.useEffect(() => () => { alive.current = false }, [])
        React.useEffect(() => { setW(null); setLessons(null); setGone({}); setHidden(false) }, [sid])
        React.useEffect(() => {
          if (sid === '' || blank !== true || kbDockKaby(sid)) return undefined
          let stop = false
          fetch('/kybernos-skills/learned/week?sessionId=' + encodeURIComponent(sid), { headers: { accept: 'application/json' } }).then((r) => r.json()).then((j) => {
            if (stop === true || alive.current !== true || j === null || typeof j !== 'object' || j.ok !== true) return
            setW(j.show === true ? j : null)
            if (j.show === true) fetch('/kybernos-memory/lessons?added=7d&limit=1', { headers: { accept: 'application/json' } }).then((r) => r.json()).then((m) => { if (stop === false && alive.current === true && m !== null && typeof m === 'object' && m.ok === true && Number.isInteger(m.total)) setLessons(m.total) }).catch(() => null)
          }).catch(() => null)
          return () => { stop = true }
        }, [sid, blank])
        if (sid === '' || blank !== true) return null
        if (hidden === true) return h('div', { className: 'kbl-tail kbl-dk', 'data-kb': 'learned-week-hidden' }, h('div', { className: 'kbl-how' }, t('ln2.w.hidden')))
        if (w === null) return null
        const drop = (k) => setGone((m) => ({ ...m, [k]: true }))
        const row = (k, text, btns) => (gone[k] === true ? null : h('div', { key: k, className: 'kbl-wr', 'data-kb': 'learned-week-row' }, h('span', { className: 'kbl-ws' }, text), btns))
        const post = (path, body) => postJson('/kybernos-skills/' + path, body).catch(() => null)
        const rows = []
        if (w.top !== null) rows.push(row('top', [h('b', { key: 'n', className: 'kbl-mono' }, w.top.name), ' ' + t('ln2.w.top', { n: w.top.uses })], null))
        if (w.waiting > 0) rows.push(row('wait', t(w.waiting === 1 ? 'ln2.w.waiting.1' : 'ln2.w.waiting', { n: w.waiting }), h('button', { type: 'button', className: 'kbl-btn pri', 'data-kb': 'learned-week-review', onClick: kbGoSkills }, t('ln.review'))))
        if (w.auto.created + w.auto.improved > 0) rows.push(row('auto', t('ln2.w.auto', { c: w.auto.created, i: w.auto.improved }), h('button', { type: 'button', className: 'kbl-btn', 'data-kb': 'learned-week-journal', onClick: () => kbOpenSkills('kybernos.skills.journal', '1') }, t('ln.j.btn'))))
        for (const s of w.stale) rows.push(row('stale:' + s.name, [h('b', { key: 'n', className: 'kbl-mono' }, s.name), ' ' + t('ln2.w.stale', { d: s.days })],
          [h('button', { key: 'k', type: 'button', className: 'kbl-btn', 'data-kb': 'learned-week-keep', onClick: () => { post('learned/keep', { name: s.name }); drop('stale:' + s.name) } }, t('ln.a.keep')),
            h('button', { key: 'o', type: 'button', className: 'kbl-btn pri', 'data-kb': 'learned-week-off', onClick: () => { post('toggle', { root: s.root, name: s.name, active: false }); drop('stale:' + s.name); try { if (window.__KB_LEARNED__ && typeof window.__KB_LEARNED__.refresh === 'function') window.__KB_LEARNED__.refresh() } catch (e) { /* the dot catches up */ } } }, t('ln.stale.off'))]))
        for (const r of w.ready) rows.push(row('ready:' + r.name, [h('b', { key: 'n', className: 'kbl-mono' }, r.name), ' ' + t('ln2.w.ready', { n: r.chats })],
          [h('button', { key: 'l', type: 'button', className: 'kbl-btn', 'data-kb': 'learned-week-later', onClick: () => drop('ready:' + r.name) }, t('ln2.w.later')),
            h('button', { key: 'p', type: 'button', className: 'kbl-btn pri', 'data-kb': 'learned-week-share', onClick: () => kbOpenSkills('kybernos.skills.share', r.name) }, t('ln2.w.propose'))]))
        const num = (v, label, key) => h('div', { key, className: 'kbl-num' }, h('b', null, String(v)), h('span', null, label))
        return h('div', { className: 'kbl-tail kbl-dk', 'data-kb': 'learned-week' },
          h('section', { className: 'kbl-wk' },
            h('div', { className: 'kbl-wh' },
              h('div', null, h('h3', null, t('ln2.w.title')), h('p', null, t('ln2.w.sub', { from: kbShortDay(w.from), to: kbShortDay(w.to) }))),
              h('button', { type: 'button', className: 'kbl-btn', 'data-kb': 'learned-week-hide', onClick: () => { post('learned/week/hide', {}); setHidden(true) } }, t('ln2.w.hide'))),
            h('div', { className: 'kbl-nums' }, lessons !== null ? num(lessons, t('ln2.w.lessons'), 'l') : null, num(w.accepted, t('ln2.w.accepted'), 'a'), num(w.used + '×', w.used === 1 ? t('ln2.w.used.1') : (w.usedSkills === 1 ? t('ln2.w.used.d1') : t('ln2.w.used', { n: w.usedSkills })), 'u')),
            rows.filter((x) => x !== null).length > 0 ? h('div', { className: 'kbl-wl' }, rows) : null,
            h('div', { className: 'kbl-how kbl-dim2' }, t('ln2.w.foot'))))
      }

      // Settings › Learned skills: how much Kaby may do on its own with the skills it learns. Three levels (Ask me every time by default), the confidence line with a live preview on
      // what waits now, the hard stops nothing lifts, the limits, the audit trail and the kill switch. Every change is saved at once and written to the journal by the host.
      function LearnedSettingsPage() {
        const [data, setData] = React.useState({ phase: 'loading' })
        const [th, setTh] = React.useState(90)
        const [err, setErr] = React.useState('')
        const [saved, setSaved] = React.useState(false)
        const [sure, setSure] = React.useState(false)
        const [stopped, setStopped] = React.useState(null)
        const alive = React.useRef(true)
        const timer = React.useRef(null)
        React.useEffect(() => () => { alive.current = false; if (timer.current !== null) clearTimeout(timer.current) }, [])
        const load = React.useCallback(() => getJson('/kybernos-skills/learned').then((j) => {
          if (alive.current !== true) return
          if (j !== null && typeof j === 'object' && j.ok === true && j.settings !== undefined && j.settings !== null) { setData({ phase: 'ready', ...j }); setTh(j.settings.threshold); kbLearnedSet(kbLearnedCount(j)) }
          else setData({ phase: 'absent' })
        }).catch(() => { if (alive.current === true) setData({ phase: 'absent' }) }), [])
        React.useEffect(() => { load() }, [])
        const [notices, setNotices] = React.useState(null)
        const loadNotices = React.useCallback(() => getJson('/kybernos-skills/learned/notice/list').then((j) => { if (alive.current === true && j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.patterns)) setNotices(j) }).catch(() => null), [])
        React.useEffect(() => { loadNotices() }, [])
        const forget = (id) => postJson('/kybernos-skills/learned/notice/forget', { id }).then(() => loadNotices()).catch(() => null)
        const save = (patch) => {
          setErr(''); setSaved(false)
          return postJson('/kybernos-skills/learned/settings/set', patch).then((j) => {
            if (alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true) { setSaved(true); load() } else { setErr(why(j, t('err.unexpected', { r: 'learned/settings/set' }))); load() }
          }).catch(() => { if (alive.current === true) setErr(t('err.unavail', { r: 'learned/settings/set' })) })
        }
        const slide = (v) => { setTh(v); if (timer.current !== null) clearTimeout(timer.current); timer.current = setTimeout(() => save({ threshold: v }), 450) }
        if (data.phase === 'loading') return h('div', { className: 'kbss-page', 'data-kb': 'learned-settings' }, h('p', { className: 'kbss-sub' }, t('y.loading')))
        if (data.phase === 'absent') return h('div', { className: 'kbss-page', 'data-kb': 'learned-settings' }, h('h2', { className: 'kbss-h1' }, t('ls.h1')), h('p', { className: 'kbss-err', role: 'alert' }, t('ls.absent')))
        const s = data.settings
        const locked = data.sensitive === true && s.privOk !== true
        const lvl = (id) => h('button', { key: id, type: 'button', className: 'kbl-lv' + (s.mode === id ? ' on' : ''), 'aria-pressed': s.mode === id ? 'true' : 'false', 'data-kb': 'level-' + id, disabled: locked && id !== 'ask', onClick: () => save({ mode: id }) },
          h('b', null, t('ln.mode.' + id), id === 'ask' ? h('span', { className: 'kbl-pill ok' }, t('ls.level.default')) : null), h('span', null, t('ls.level.' + id)))
        // the preview: what each waiting suggestion would do at this line (the hard stops come from the host; the line and the limit are applied here, live)
        const asLevel = s.mode === 'ask' ? 'auto' : s.mode
        let used = data.week !== undefined && data.week !== null ? data.week.used : 0
        const rows = data.proposals.map((p) => {
          let why = null
          if (Array.isArray(p.hard) && p.hard.length > 0) why = p.hard[0]
          else if (p.kind !== 'improve' && asLevel !== 'auto') why = 'needs_create'
          else if (p.score.total < th) why = 'below'
          else if (used >= s.cap) why = 'cap'
          else used += 1
          return { p, why }
        })
        const sel = (id, value, opts, onChange) => h('select', { id, className: 'kbl-sel', value: String(value), onChange: (e) => onChange(e.target.value) }, opts.map((o) => h('option', { key: o[0], value: String(o[0]) }, o[1])))
        const lessThan = (p) => (p.kind === 'improve' ? p.target : p.name)
        return h('div', { className: 'kbss-page', 'data-kb': 'learned-settings' },
          h('div', { className: 'kbss-headrow' },
            h('h2', { className: 'kbss-h1' }, t('ls.h1')),
            (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-skills', page: 'learned' }) : null)),
          h('p', { className: 'kbss-lead' }, t('ls.lead')),
          h('p', { className: 'kbss-sub' }, h('button', { type: 'button', className: 'kbss-link', 'data-kb': 'settings-journal', onClick: () => kbOpenSkills('kybernos.skills.journal', '1') }, t('ls.audit.open'))),
          s.breaker !== null ? h('div', { className: 'kbl-lock', 'data-kb': 'learned-breaker' }, icon('alert', 14), h('span', null, t('ls.breaker'))) : null,
          h('div', { className: 'kbss-card' },
            h('h3', { className: 'kbss-h2' }, t('ls.level.h')),
            h('p', { className: 'kbss-sub' }, t('ls.level.sub')),
            h('div', { className: 'kbl-lvs', 'data-kb': 'learned-levels' }, ['ask', 'improve', 'auto'].map(lvl)),
            data.sensitive === true ? h('div', { className: 'kbl-lock' }, icon('lock', 14), h('span', null, t('ls.lock'))) : null,
            data.sensitive === true ? h('label', { className: 'kbl-chk' }, h('input', { type: 'checkbox', checked: s.privOk === true, 'data-kb': 'learned-unlock', onChange: (e) => save({ privOk: e.target.checked }) }), h('span', null, t('ls.unlock'))) : null),
          h('div', { className: 'kbss-card', 'data-kb': 'learned-line' },
            h('h3', { className: 'kbss-h2' }, t('ls.line.h')),
            h('p', { className: 'kbss-sub' }, t('ls.line.sub')),
            h('div', { className: 'kbl-rng' }, h('input', { type: 'range', min: 70, max: 99, value: th, 'aria-label': t('ls.line.h'), 'data-kb': 'learned-range', onChange: (e) => slide(Number(e.target.value)) }), h('b', { className: 'kbl-val', 'data-kb': 'learned-line-value' }, String(th))),
            h('p', { className: 'kbss-sub' }, h('b', null, s.mode === 'ask' ? t('ls.line.preview.ask') : t('ls.line.preview'))),
            h('div', { className: 'kbl-pv', 'data-kb': 'learned-preview' }, rows.length === 0 ? h('div', { className: 'kbl-pr' }, t('ls.line.none')) : rows.map((r) => h('div', { key: r.p.id, className: 'kbl-pr', 'data-kb': 'preview-row' },
              h('b', { className: 'kbl-mono', title: lessThan(r.p) }, lessThan(r.p)),
              h('span', { className: 'kbl-bar' }, h('i', { style: { width: r.p.score.total + '%' } }), h('u', { style: { left: th + '%' } })),
              h('span', { className: 'kbl-mono' }, String(r.p.score.total)),
              r.why === null ? h('span', { className: 'kbl-pill ok' }, icon('check', 11), s.mode === 'ask' ? t('ls.line.would') : t('ls.line.applies')) : h('span', { className: 'kbl-pill' }, t('ln.stop.' + r.why)))))),
          h('div', { className: 'kbss-card' },
            h('h3', { className: 'kbss-h2' }, t('ls.stops.h')),
            h('p', { className: 'kbss-sub' }, t('ls.stops.sub')),
            h('ul', { className: 'kbl-stops', 'data-kb': 'learned-stops' }, [['alert', t('ls.stop.untrusted')], ['wand', t('ls.stop.risky')], ['lock', t('ls.stop.client')], ['file', t('ls.stop.edited')], ['pkg', t('ls.stop.team')], ['refresh', t('ls.stop.cap', { cap: s.cap })]].map((x, i) => h('li', { key: i }, icon(x[0], 14), h('span', null, x[1]))))),
          h('div', { className: 'kbss-card' },
            h('h3', { className: 'kbss-h2' }, t('ls.limits.h')),
            h('div', { className: 'kbl-fr' }, h('label', { htmlFor: 'kbl-cap' }, t('ls.cap')), sel('kbl-cap', s.cap, [[1, t('ls.cap.1')], [3, t('ls.cap.3')], [5, t('ls.cap.5')]], (v) => save({ cap: Number(v) }))),
            h('div', { className: 'kbl-fr' }, h('label', { htmlFor: 'kbl-notify' }, t('ls.notify')), sel('kbl-notify', s.notify, [['both', t('ls.notify.both')], ['chat', t('ls.notify.chat')], ['week', t('ls.notify.week')]], (v) => save({ notify: v })))),
          h('div', { className: 'kbss-card', 'data-kb': 'learned-repeat-card' },
            h('h3', { className: 'kbss-h2' }, t('ls2.rep.h')),
            h('p', { className: 'kbss-sub' }, t('ls2.rep.sub')),
            h('label', { className: 'kbl-chk' }, h('input', { type: 'checkbox', checked: s.notice === true, 'data-kb': 'learned-notice-on', onChange: (e) => save({ notice: e.target.checked }) }), h('span', null, t('ls2.rep.on'))),
            h('div', { className: 'kbl-fr' },
              h('label', { htmlFor: 'kbl-minrep' }, t('ls2.rep.from')), sel('kbl-minrep', s.minRep, [[3, t('ls2.rep.n3')], [4, t('ls2.rep.n4')], [5, t('ls2.rep.n5')]], (v) => save({ minRep: Number(v) })),
              h('label', { htmlFor: 'kbl-win' }, t('ls2.rep.within')), sel('kbl-win', s.win, [[30, t('ls2.rep.d30')], [60, t('ls2.rep.d60')], [90, t('ls2.rep.d90')]], (v) => save({ win: Number(v) }))),
            data.sensitive === true ? h('div', { className: 'kbl-lock' }, icon('lock', 14), h('span', null, t('ls2.rep.priv'))) : null,
            notices !== null && notices.index === false ? h('div', { className: 'kbl-lock', 'data-kb': 'learned-noindex' }, icon('alert', 14), h('span', null, t('ls2.rep.noindex'))) : null,
            notices !== null ? h('div', { className: 'kbl-pv', 'data-kb': 'learned-patterns' }, notices.patterns.length === 0
              ? h('div', { className: 'kbl-pr' }, t('ls2.rep.none'))
              : notices.patterns.map((x) => h('div', { key: x.id, className: 'kbl-pt', 'data-kb': 'pattern-row' },
                h('b', { className: 'kbl-mono' }, x.label !== null ? x.label : t('ls2.rep.kind')), h('span', null, t('ls2.rep.chats', { n: x.n })), h('span', null, t('ls2.rep.s.' + x.state)),
                h('button', { type: 'button', className: 'kbl-btn', 'data-kb': 'pattern-forget', onClick: () => forget(x.id) }, x.state === 'never' ? t('ls2.rep.allow') : t('ls2.rep.forget'))))) : null),
          h('div', { className: 'kbss-card', 'data-kb': 'learned-week-card' },
            h('h3', { className: 'kbss-h2' }, t('ls2.w.h')),
            h('p', { className: 'kbss-sub' }, t('ls2.w.sub')),
            h('label', { className: 'kbl-chk' }, h('input', { type: 'checkbox', checked: s.week === true, 'data-kb': 'learned-week-on', onChange: (e) => save({ week: e.target.checked }) }), h('span', null, t('ls2.w.on')))),
          h('div', { className: 'kbss-card', 'data-kb': 'learned-team-card' },
            h('h3', { className: 'kbss-h2' }, t('ls2.t.h')),
            h('p', { className: 'kbss-sub' }, t('ls2.t.sub')),
            h('div', { className: 'kbl-fr' },
              h('label', { className: 'kbl-chk' }, h('input', { type: 'checkbox', checked: s.team === true && (data.sensitive !== true || s.teamPriv === true), disabled: data.sensitive === true && s.teamPriv !== true, 'data-kb': 'learned-team-on', onChange: (e) => save({ team: e.target.checked }) }), h('span', null, t('ls2.t.on'))),
              sel('kbl-teammin', s.teamMin, [[3, t('ls2.t.n3')], [5, t('ls2.t.n5')], [8, t('ls2.t.n8')]], (v) => save({ teamMin: Number(v) }))),
            data.sensitive === true ? h('div', { className: 'kbl-lock' }, icon('lock', 14), h('span', null, t('ls2.t.lock'))) : null,
            data.sensitive === true ? h('label', { className: 'kbl-chk' }, h('input', { type: 'checkbox', checked: s.teamPriv === true, 'data-kb': 'learned-team-unlock', onChange: (e) => save({ teamPriv: e.target.checked }) }), h('span', null, t('ls2.t.priv'))) : null),
          h('div', { className: 'kbss-card' },
            h('h3', { className: 'kbss-h2' }, t('ls.audit.h')),
            h('p', { className: 'kbss-sub' }, t('ls.audit.sub')),
            h('div', { className: 'kbl-fr' },
              h('button', { type: 'button', className: 'kbl-btn pri', onClick: () => kbOpenSkills('kybernos.skills.journal', '1') }, t('ls.audit.open')),
              sure === true
                ? h('button', { type: 'button', className: 'kbl-btn warn', 'data-kb': 'learned-stop-yes', onClick: () => { setSure(false); postJson('/kybernos-skills/learned/stop', {}).then((j) => { if (alive.current === true && j !== null && j.ok === true) { setStopped(j.undone); load() } else if (alive.current === true) setErr(why(j, t('err.unexpected', { r: 'learned/stop' }))) }).catch(() => null) } }, t('ls.audit.sure'))
                : h('button', { type: 'button', className: 'kbl-btn warn', 'data-kb': 'learned-stop', onClick: () => setSure(true) }, t('ls.audit.stop'))),
            stopped !== null ? h('p', { className: 'kbss-sub', 'data-kb': 'learned-stopped' }, t('ls.audit.done', { n: stopped })) : null),
          err !== '' ? h('div', { className: 'kbss-err', role: 'alert' }, err) : (saved ? h('p', { className: 'kbss-sub', 'data-kb': 'learned-saved' }, t('ls.saved')) : null))
      }

      // A skill of Yours, opened: the real SKILL.md, where it lives, and what the host will let the screen do with it. The actions are only
      // the ones the host's answer lists (`read.data.actions`): a host that has not been restarted lists none, and none is drawn.
      function SkillPanel(props) {
        const s = props.s
        const r = props.read
        const ready = r.state === 'ready' && r.data !== null
        const acts = ready && r.data.actions !== null && typeof r.data.actions === 'object' ? r.data.actions : {}
        const folder = ready && typeof r.data.folder === 'string' ? r.data.folder : (typeof s.folder === 'string' ? s.folder : '')
        const on = s.active === true
        const busy = props.busyKind !== ''
        const act = (kind, label, tip, cls) => acts[kind] === true
          ? h('button', { key: kind, type: 'button', className: cls, 'data-kb': 'act-' + kind, title: tip, disabled: busy, onClick: () => props.onAct(kind) }, label)
          : null
        return h('aside', { className: 'kbs-panel', 'aria-label': s.name + ' — ' + t('cap.detail'), 'data-kb': 'skill-panel' },
          h('div', { className: 'kbs-panel-top' },
            h('span', { className: 'kb8-mono kbs-nowrap' }, 'Yours › ' + s.name),
            h('button', { type: 'button', className: 'kb-tool', 'aria-label': t('panel.close'), title: t('panel.close'), onClick: props.onClose }, '✕')),
          h('div', { className: 'kb-detail-head' },
            tile(s.name, 'pkg', 'lg'),
            h('div', { className: 'meta' },
              h('span', { className: 'kb8-h1', style: { fontSize: '19px', overflowWrap: 'anywhere' } }, s.name),
              h('div', { className: 'kb8-pills' },
                on ? h('span', { key: 'st', className: 'kb8-pill ok' }, t('card.active')) : h('span', { key: 'st', className: 'kb8-pill warn' }, t('card.disabled')),
                s.collision === true ? h('span', { key: 'co', className: 'kb8-pill warn' }, t('card.dup')) : null,
                s.writable !== true ? h('span', { key: 'ro', className: 'kb8-pill' }, t('card.readonly')) : null))),
          h('div', { className: 'kb-local-rows' },
            h('div', { className: 'row' }, h('span', null, t('det.root')),
              h('span', { className: 'kb8-mono kbs-path', title: folder }, folder !== '' ? folder : String(s.root || ''),
                folder !== '' ? h('button', { type: 'button', className: 'kbs-copy', title: t('panel.copyPath'), onClick: () => props.onCopy(folder) }, icon('code', 12)) : null)),
            h('div', { className: 'row' }, h('span', null, t('det.modified')), h('span', { className: 'kb8-mono' }, s.modifiedAt !== '' ? today(s.modifiedAt) : t('det.unknownDate'))),
            s.description !== '' ? h('div', { className: 'row' }, h('span', null, t('det.local.what')), h('span', null, s.description)) : null,
            s.whenToUse !== undefined && s.whenToUse !== null && String(s.whenToUse).trim() !== ''
              ? h('div', { className: 'row' }, h('span', null, t('det.local.when')), h('span', null, String(s.whenToUse).trim()))
              : null),
          h('span', { className: 'kb-section-label' }, 'SKILL.md'),
          r.state === 'error'
            ? h('div', { className: 'kbs-err', role: 'alert' }, r.error)
            : h('pre', { className: 'kb-local-body', 'data-kb': 'skill-text' }, ready ? r.data.text : t('det.local.loading')),
          ready && r.data.truncated === true ? h('span', { className: 'kb8-mono' }, t('panel.truncated')) : null,
          ready && r.data.files > 0 ? h('span', { className: 'kb8-mono' }, t('panel.files', { n: r.data.files + (r.data.filesMore === true ? '+' : '') })) : null,
          props.learned !== null && props.learned !== undefined && (props.learned.shared === true || props.shareLocked === true || props.learned.shareReady === true)
            ? h('div', { className: 'kbl-share', 'data-kb': 'learned-share' },
              h('span', { className: 'kb-section-label' }, t('ln2.s.h')),
              props.learned.shared === true ? h('p', { className: 'kbl-p' }, icon('check', 12), ' ' + t('ln2.s.done'))
                : (props.shareLocked === true ? h('p', { className: 'kbl-p' }, icon('lock', 12), ' ' + t('ln2.s.priv'))
                  : [h('p', { key: 't', className: 'kbl-p' }, t('ln2.s.text', { n: props.learned.chats })),
                    h('div', { key: 'b' }, h('button', { type: 'button', className: 'kb8-primary', 'data-kb': 'learned-share-btn', onClick: props.onShare }, t('ln2.s.btn')))]))
            : null,
          props.err ? h('div', { className: 'kbs-err' }, props.err) : null,
          h('div', { className: 'kbs-panel-acts' },
            act('reveal', h('span', null, t('act.reveal')), t('act.reveal.tip'), 'kb8-primary'),
            act('edit', h('span', null, t('act.edit')), t('act.edit.tip'), 'kb8-ghost'),
            act('duplicate', h('span', null, t('act.duplicate')), t('act.duplicate.tip'), 'kb8-ghost'),
            act('delete', h('span', null, t('act.delete')), t('act.delete.tip'), 'kb8-ghost warn')),
          ready && s.writable !== true ? h('span', { className: 'kb8-mono' }, t('act.readonly')) : null)
      }

      // A Discover card, opened: its own repository, folder, description and the start of its SKILL.md (read from the repository by the
      // host), who publishes it, its audits, and Install — which asks first.
      function DiscoverPanel(props) {
        const x = props.x
        const p = props.preview
        const pv = p.state === 'ready' && p.data !== null ? p.data : null
        const publisher = props.owner !== undefined && props.owner !== '' ? props.owner : String(x.source || '').split('/')[0]
        const audit = props.audit
        const ghUrl = pv !== null && typeof pv.url === 'string' && pv.url !== '' ? pv.url : 'https://github.com/' + x.source
        const row = (label, value, key) => h('div', { key, className: 'row' }, h('span', null, label), h('span', { className: 'kb8-mono', style: { overflowWrap: 'anywhere' } }, value))
        const folderText = pv !== null ? (pv.folder !== '' ? pv.folder : t('dp.root'))
          : (p.state === 'loading' ? t('dp.loading') : t('dp.folderUnknown'))
        let text = null
        if (p.state === 'loading') text = h('pre', { className: 'kb-local-body', 'data-kb': 'preview-text' }, t('dp.loading'))
        else if (pv !== null) text = h('pre', { className: 'kb-local-body', 'data-kb': 'preview-text' }, pv.text + (pv.truncated === true ? '\n…' : ''))
        else if (p.state === 'missing') text = h('div', { className: 'kb-note', 'data-kb': 'preview-missing' }, icon('info', 14), h('span', null, t('dp.notfound', { name: x.name })))
        else if (p.state === 'error') text = h('div', { className: 'kb-note', 'data-kb': 'preview-error' }, icon('info', 14), h('span', null, t('dp.nopreview', { why: p.error })))
        else if (p.state === 'none') text = h('div', { className: 'kb-note', 'data-kb': 'preview-none' }, icon('info', 14), h('span', null, x.sourceType === 'well-known' ? t('row.cantInstall.wk') : t('row.cantInstall.ng')))
        return h('aside', { className: 'kbs-panel', 'aria-label': x.name + ' — ' + t('cap.detail'), 'data-kb': 'disc-panel' },
          h('div', { className: 'kbs-panel-top' },
            h('span', { className: 'kb8-mono kbs-nowrap' }, (props.crumb || 'Discover') + ' › ' + x.name),
            h('button', { type: 'button', className: 'kb-tool', 'aria-label': t('panel.close'), title: t('panel.close'), onClick: props.onClose }, '✕')),
          h('div', { className: 'kb-detail-head' },
            tile(x.name, 'pkg', 'lg'),
            h('div', { className: 'meta' },
              h('span', { className: 'kb8-h1', style: { fontSize: '19px', overflowWrap: 'anywhere' } }, x.name),
              h('div', { className: 'kb8-pills' },
                props.curated === true ? h('span', { key: 'o', className: 'kb8-pill ok' }, 'curated') : h('span', { key: 'o', className: 'kb8-pill' }, t('row.community')),
                props.installed === true ? h('span', { key: 'i', className: 'kb8-pill' }, t('row.already')) : null))),
          pv !== null && pv.description !== '' ? h('p', { className: 'kbs-desc', 'data-kb': 'preview-desc' }, pv.description) : null,
          h('div', { className: 'kb-local-rows' },
            row(t('det.row.repo'), 'github.com/' + x.source, 'repo'),
            row(t('dp.folder'), folderText, 'folder'),
            row(t('det.row.owner'), publisher, 'owner'),
            row(t('det.row.installs'), nf(x.installs), 'installs'),
            row(t('det.row.type'), x.sourceType !== '' && x.sourceType !== undefined ? String(x.sourceType) : t('det.unknownSrc'), 'type'),
            x.url !== '' && x.url !== undefined && x.url !== null
              ? h('div', { key: 'page', className: 'row' }, h('span', null, t('det.row.page')),
                  h('a', { href: String(x.url), target: '_blank', rel: 'noreferrer', className: 'kb8-mono', style: { overflowWrap: 'anywhere', color: 'var(--dsw-alias-brand-primary,#4f8cff)' } }, String(x.url)))
              : null),
          h('span', { className: 'kb-section-label' }, t('dp.start')),
          text,
          h('div', { className: 'kbs-audit', style: { borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: '11px' } },
            h('span', { className: 'kb8-mono' }, icon('shield', 14), ' ' + t('det.audits')),
            audit === null || audit === undefined || audit.phase === 'loading'
              ? h('span', { className: 'kb8-mono' }, t('det.auditLoading'))
              : (audit.phase === 'error'
                ? h('span', { className: 'ligne' }, audit.error)
                : (audit.audits.length === 0
                  ? h('span', { className: 'kb8-mono' }, t('det.auditNone'))
                  : audit.audits.map((a, i) => h('div', { key: 'a' + i, className: 'ligne' },
                      h('span', { className: 'kb8-pill ' + (a.status === 'pass' ? 'ok' : 'warn') }, a.status === 'pass' ? t('det.audited') : (a.status !== '' ? a.status : t('det.unknown'))),
                      h('span', null, a.provider + (a.summary !== '' ? ' — ' + a.summary : '')))))),
            h('span', { className: 'kb8-mono' }, t('det.thirdParty'))),
          h('div', { className: 'kbs-panel-acts' },
            x.installable === true && props.installed !== true
              ? h('button', {
                  type: 'button', className: 'kb8-primary', 'data-kb': 'act-install',
                  title: t('det.installTip', { source: x.source, name: x.name, dest: props.dest }), onClick: props.onInstall
                }, icon('plus', 15), h('span', null, t('btn.install')))
              : (x.installable === true
                ? h('button', {
                    type: 'button', className: 'kbs-star-btn' + (props.starred ? ' on' : ''),
                    title: props.starred ? t('feat.remove') : t('feat.add'), onClick: props.onStar
                  }, icon('star', 14))
                : h('span', { className: 'kb8-pill warn', title: x.sourceType === 'well-known' ? t('row.cantInstall.wk') : t('row.cantInstall.ng') }, t('row.cantInstall'))),
            x.installable === true
              ? h('a', { href: ghUrl, target: '_blank', rel: 'noreferrer', className: 'kb8-ghost', 'data-kb': 'act-github' }, icon('github', 15), h('span', null, t('dp.viewgh')))
              : null))
      }

      // Escape closes a confirmation, in the capture phase so the page behind never sees it.
      const useEscape = (onClose) => {
        React.useEffect(() => {
          const onKey = (e) => { if (e !== null && e.key === 'Escape') { e.stopPropagation(); onClose() } }
          document.addEventListener('keydown', onKey, true)
          return () => document.removeEventListener('keydown', onKey, true)
        }, [])
      }

      // « Install ? » — before anything is downloaded or written, what the button will do, for THIS skill: its repository, the folder it
      // sits in (when the repository's listing showed it), and the exact folder it will be copied to.
      function InstallConfirm(props) {
        const x = props.x
        useEscape(props.onClose)
        const dest = String(props.dest)
        const sepr = dest.indexOf('\\') >= 0 && dest.indexOf('/') < 0 ? '\\' : '/'
        const target = dest.replace(/[\\/]+$/, '') + sepr + x.name
        const row = (label, value) => h('div', { className: 'row' }, h('span', null, label), h('span', { className: 'kb8-mono', style: { overflowWrap: 'anywhere' } }, value))
        return h('div', { className: 'kb-overlay', onClick: props.onClose },
          h('div', { className: 'kb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('ic.title', { name: x.name }), 'data-kb': 'install-confirm', onClick: (e) => e.stopPropagation() },
            h('div', { className: 'kb-row' }, h('span', { className: 'kb8-h2' }, t('ic.title', { name: x.name })), h('span', { style: { flex: '1' } }),
              h('button', { type: 'button', className: 'kb-tool', 'aria-label': t('m.cancel'), onClick: props.onClose }, '✕')),
            h('p', { className: 'kb8-sub', style: { margin: '0' } }, t('det.whatBody', { source: x.source, name: x.name, dest })),
            h('div', { className: 'kb-local-rows' },
              row(t('ic.repo'), 'github.com/' + x.source),
              row(t('ic.folder'), props.folder !== null && props.folder !== undefined ? (props.folder !== '' ? props.folder : t('dp.root')) : t('dp.folderUnknown')),
              row(t('ic.dest'), target)),
            h('div', { className: 'kb-note' }, icon('info', 14), h('span', null, t('ic.after'))),
            props.error ? h('div', { className: 'kbs-err', role: 'alert' }, props.error) : null,
            h('div', { className: 'kbs-actions' },
              h('button', { type: 'button', className: 'kb8-ghost', 'data-kb': 'install-confirm-no', onClick: props.onClose }, t('m.cancel')),
              h('button', { type: 'button', className: 'kb8-primary', 'data-kb': 'install-confirm-yes', disabled: props.busy === true, onClick: props.onConfirm },
                icon('plus', 15), props.busy === true ? t('m.downloading') : t('btn.install')))))
      }

      // « Delete ? » — a skill's folder is removed for good (no trash): said first, with the folder and how many files go with it.
      function DeleteConfirm(props) {
        const s = props.s
        useEscape(props.onClose)
        return h('div', { className: 'kb-overlay', onClick: props.onClose },
          h('div', { className: 'kb-modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': t('del.title', { name: s.name }), 'data-kb': 'delete-confirm', onClick: (e) => e.stopPropagation() },
            h('div', { className: 'kb-row' }, h('span', { className: 'kb8-h2' }, t('del.title', { name: s.name })), h('span', { style: { flex: '1' } }),
              h('button', { type: 'button', className: 'kb-tool', 'aria-label': t('m.cancel'), onClick: props.onClose }, '✕')),
            h('p', { className: 'kb8-sub', style: { margin: '0' } }, t('del.body', { path: String(s.folder || s.root || '') })),
            typeof props.files === 'number' && props.files > 0 ? h('span', { className: 'kb8-mono' }, t('panel.files', { n: props.files })) : null,
            h('div', { className: 'kbs-actions' },
              h('button', { type: 'button', className: 'kb8-ghost', 'data-kb': 'delete-confirm-no', onClick: props.onClose }, t('m.cancel')),
              h('button', { type: 'button', className: 'kb8-ghost warn', 'data-kb': 'delete-confirm-yes', disabled: props.busy === true, onClick: props.onConfirm },
                props.busy === true ? t('del.deleting') : t('act.delete')))))
      }

      // Create modal: the four fields that make up a valid SKILL.md, nothing more.
      function CreateModal(props) {
        const [name, setName] = React.useState('')
        const [description, setDescription] = React.useState('')
        const [whenToUse, setWhenToUse] = React.useState('')
        const [content, setContent] = React.useState('')
        const [root, setRoot] = React.useState(props.roots.length > 0 ? props.roots[0].path : '')
        const [quiet, setQuiet] = React.useState(false)
        const field = (label, node) => h('div', { className: 'kbs-fields' }, h('span', { className: 'kbs-label' }, label), node)
        // The same rule as the host's (a lowercase kebab name, 64 characters at most), said while typing: the « /name » line only
        // promises a command once the name can be one, and a bad name says why under its field (A3-27).
        const nameRule = name === '' ? null : (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ? (name.length > 64 ? 'name_too_long' : null) : 'invalid_name')
        const select = (value, onChange) => h('select', { className: 'kbs-select', value, onChange: (e) => onChange(e.target.value) },
          props.roots.length === 0
            ? h('option', { value: '' }, t('m.defroot'))
            : props.roots.map((r) => h('option', { key: r.path, value: r.path }, r.path + (r.exists === true ? '' : '  ' + t('m.willCreate')))))
        return h('div', { className: 'kb-overlay', onClick: props.onClose },
          h('div', { className: 'kb-modal', onClick: (e) => e.stopPropagation() },
            h('div', { className: 'kb-row' }, h('span', { className: 'kb8-h2' }, t('add.create')), h('span', { style: { flex: '1' } }),
              h('button', { type: 'button', className: 'kb-tool', onClick: props.onClose }, '✕')),
            h('p', { className: 'kb8-sub', style: { margin: '0' } }, t('m.createSub')),
            field(t('m.name'), h(React.Fragment, null,
              h('input', { className: 'kbs-input', value: name, placeholder: t('m.nameph'), 'aria-invalid': nameRule !== null ? 'true' : 'false', onChange: (e) => setName(e.target.value) }),
              nameRule !== null ? h('div', { className: 'kbs-err', role: 'alert', 'data-kb': 'create-name-error' }, t('he.' + nameRule, { max: 64 })) : null)),
            field(t('m.desc'), h('textarea', { className: 'kbs-area', style: { minHeight: '70px' }, value: description, onChange: (e) => setDescription(e.target.value) })),
            field(t('m.when'), h('input', { className: 'kbs-input', value: whenToUse, onChange: (e) => setWhenToUse(e.target.value) })),
            field(t('m.content'), h('textarea', { className: 'kbs-area', value: content, placeholder: t('m.contentph'), onChange: (e) => setContent(e.target.value) })),
            field(t('f.root'), select(root, setRoot)),
            h('label', { className: 'kbs-check' },
              h('input', { type: 'checkbox', checked: quiet, onChange: (e) => setQuiet(e.target.checked) }),
              h('span', null, t('m.quiet', { n: name !== '' && nameRule === null ? name : t('m.nameWord') }))),
            props.error ? h('div', { className: 'kbs-err' }, props.error) : null,
            h('div', { className: 'kbs-actions' },
              h('button', { type: 'button', className: 'kb8-ghost', onClick: props.onClose }, t('m.cancel')),
              h('button', {
                type: 'button', className: 'kb8-primary', disabled: props.busy.__modal === true || nameRule !== null,
                onClick: () => props.onSubmit({ name, description, whenToUse, body: content, root, modelInvocable: quiet !== true })
              }, icon('wand', 15), props.busy.__modal === true ? t('m.creating') : t('m.createBtn')))))
      }

      // The index source: the relay the Discover tab reads. The address is the user's to name (a company server, a test), with the
      // SAME rule as the KYBERNOS_SKILLS_INDEX_URL variable; when that variable is set it decides and this window only says so.
      function SourceModal(props) {
        const s0 = props.source
        const editable = s0 === null || s0.editable !== false
        const [value, setValue] = React.useState(s0 !== null && s0.origin === 'setting' && typeof s0.url === 'string' ? s0.url : '')
        React.useEffect(() => {
          // R-W2-02: this window sits on the page, outside the Settings dialog; the dialog's own focus handling then never lets Tab reach it
          // (0 of 44 presses reached Close, Cancel or Save). Tab is walked here, inside the window, and wraps like a dialog's does.
          const walkTab = (e) => {
            const box = document.querySelector('[data-kb="index-source-modal"]')
            if (box === null) return
            const list = Array.from(box.querySelectorAll('button,input,select,textarea,[tabindex]')).filter((x) => x.disabled !== true && x.tabIndex >= 0)
            if (list.length === 0) return
            const at = list.indexOf(document.activeElement)
            const to = at < 0 ? (e.shiftKey === true ? list.length - 1 : 0) : (at + (e.shiftKey === true ? -1 : 1) + list.length) % list.length
            e.preventDefault(); e.stopPropagation(); list[to].focus()
          }
          const onKey = (e) => {
            if (e === null) return
            if (e.key === 'Escape') { e.stopPropagation(); props.onClose() } else if (e.key === 'Tab') walkTab(e)
          }
          document.addEventListener('keydown', onKey, true)
          return () => document.removeEventListener('keydown', onKey, true)
        }, [])
        const now = s0 === null ? '' : (s0.refused === true ? t('src.refused') : s0.host) + ' · ' + (s0.origin === 'env' ? t('src.env') : (s0.origin === 'setting' ? t('src.custom') : t('src.default')))
        return h('div', { className: 'kb-overlay', onClick: props.onClose },
          h('div', { className: 'kb-modal', 'data-kb': 'index-source-modal', role: 'dialog', 'aria-label': t('src.title'), onClick: (e) => e.stopPropagation() },
            h('div', { className: 'kb-row' }, h('span', { className: 'kb8-h2' }, t('src.title')), h('span', { style: { flex: '1' } }),
              h('button', { type: 'button', className: 'kb-tool', 'aria-label': t('m.cancel'), onClick: props.onClose }, '✕')),
            h('p', { className: 'kb8-sub', style: { margin: '0' } }, t('src.what') + ' ' + t('src.sub')),
            now !== '' ? h('div', { className: 'kb-note' }, icon('globe', 14), h('span', null, now)) : null,
            editable === true
              ? h('div', { className: 'kbs-fields' },
                  h('span', { className: 'kbs-label' }, t('src.field')),
                  h('input', {
                    className: 'kbs-input', 'data-kb': 'index-source-input', value, spellCheck: false, autoFocus: true,
                    placeholder: s0 !== null && typeof s0.defaultUrl === 'string' ? s0.defaultUrl : 'https://skills.kybernos.app/v1',
                    onChange: (e) => setValue(e.target.value),
                    onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); props.onSubmit(value) } }
                  }),
                  h('span', { className: 'kb8-sub', style: { fontSize: '12px', color: 'var(--dsw-alias-label-caption)' } }, t('src.hint')))
              : h('div', { className: 'kb-callout' }, icon('info', 16), h('span', null, t('src.envnote'))),
            props.error ? h('div', { className: 'kbs-err', role: 'alert' }, props.error) : null,
            h('div', { className: 'kbs-actions' },
              editable === true && s0 !== null && s0.origin === 'setting'
                ? h('button', { type: 'button', className: 'kb8-ghost', 'data-kb': 'index-source-reset', style: { marginRight: 'auto' }, disabled: props.busy === true, onClick: () => props.onSubmit('') }, t('src.reset'))
                : null,
              h('button', { type: 'button', className: 'kb8-ghost', onClick: props.onClose }, t('m.cancel')),
              editable === true
                ? h('button', { type: 'button', className: 'kb8-primary', 'data-kb': 'index-source-save', disabled: props.busy === true, onClick: () => props.onSubmit(value) }, props.busy === true ? t('src.saving') : t('src.save'))
                : null)))
      }

      // Import modal: a GitHub source as owner/repo, prefilled from the open detail page.
      function InstallModal(props) {
        const p = props.preset
        const [source, setSource] = React.useState(p !== null ? String(p.source) : '')
        const [name, setName] = React.useState(p !== null ? String(p.name) : '')
        const [root, setRoot] = React.useState(props.roots.length > 0 ? props.roots[0].path : '')
        const field = (label, node, hint) => h('div', { className: 'kbs-fields' },
          h('span', { className: 'kbs-label' }, label), node,
          hint ? h('span', { className: 'kb8-mono' }, hint) : null)
        return h('div', { className: 'kb-overlay', onClick: props.onClose },
          h('div', { className: 'kb-modal', onClick: (e) => e.stopPropagation() },
            h('div', { className: 'kb-row' }, h('span', { className: 'kb8-h2' }, t('m.importTitle')), h('span', { style: { flex: '1' } }),
              h('button', { type: 'button', className: 'kb-tool', onClick: props.onClose }, '✕')),
            h('p', { className: 'kb8-sub', style: { margin: '0' } }, t('m.importSub')),
            field(t('m.repo'), h('input', { className: 'kbs-input', value: source, placeholder: 'anthropics/skills', onChange: (e) => setSource(e.target.value) }),
              t('m.examples')),
            field(t('m.skillInRepo'), h('input', { className: 'kbs-input', value: name, placeholder: 'skill-creator', onChange: (e) => setName(e.target.value) })),
            // Destination, then the exact effect of the button below — before the click, not after.
            field(t('m.destRoot'), h('select', {
              className: 'kbs-select', value: root, onChange: (e) => setRoot(e.target.value),
              title: t('det.installTip', { source: source.trim() || t('det.rootph'), name: name.trim() || t('det.rootph'), dest: root !== '' ? root : t('m.defroot') })
            },
              props.roots.length === 0
                ? h('option', { value: '' }, t('m.defroot'))
                : props.roots.map((r) => h('option', { key: r.path, value: r.path }, r.path + (r.exists === true ? '' : '  ' + t('m.willCreate')))))),
            h('div', { className: 'kb-note', 'data-kb': 'install-effect' },
              icon('info', 14),
              h('span', null, t('det.installHelp', { source: source.trim() || t('det.rootph'), name: name.trim() || t('det.rootph'), dest: root !== '' ? root : t('m.defroot') }))),
            props.error ? h('div', { className: 'kbs-err' }, props.error) : null,
            h('div', { className: 'kbs-actions' },
              h('button', { type: 'button', className: 'kb8-ghost', onClick: props.onClose }, t('m.cancel')),
              h('button', {
                type: 'button', className: 'kb8-primary', disabled: props.busy.__modal === true,
                title: t('det.installTip', { source: source.trim() || t('det.rootph'), name: name.trim() || t('det.rootph'), dest: root !== '' ? root : t('m.defroot') }),
                onClick: () => props.onSubmit({ source: source.trim(), name: name.trim(), root })
              }, icon('github', 15), props.busy.__modal === true ? t('m.downloading') : t('btn.install')))))
      }

      // ── Team skills ─────────────────────────────────────────────────────────────
      // The Team tab (docs/dev/team-skills-contract.md, the "Skills Team catalogue" mockup). The server half is
      // /kybernos-cloud/team/skills* (kybernos-cloud, the account token and the active workspace); the disk half is
      // /kybernos-skills/team/pack and /team/install. This page carries the files from one to the other, so neither plugin imports
      // the other and no skill content is kept anywhere.
      const TEAM_LOCKS = { non_connecte: 'signin', 'non connecte': 'signin', offre_requise: 'plan', aucun_espace: 'space', not_on_this_server: 'server', reconnect_required: 'reconnect', network: 'net' }
      const teamLockOf = (code) => (TEAM_LOCKS[code] !== undefined ? TEAM_LOCKS[code] : 'other')
      const TEAM_SCRIPT_RE = /\.(?:sh|bash|zsh|fish|py|rb|pl|php|js|mjs|cjs|ts|ps1|bat|cmd)$/i
      // Shown to the reviewer, who must see that a skill comes with something that runs.
      const teamScripts = (files) => files.filter((f) => TEAM_SCRIPT_RE.test(f.path) || /^scripts?\//i.test(f.path) || String(f.content).startsWith('#!')).map((f) => f.path)
      const byteLen = (s) => { try { return new TextEncoder().encode(String(s)).length } catch (e) { return String(s).length } }
      const kbOf = (n) => { const v = n / 1024; return v < 10 ? v.toFixed(1).replace(/\.0$/, '') : String(Math.round(v)) }
      const sizeOf = (n) => (n < 1024 ? String(n) + ' B' : kbOf(n) + ' KB')
      const shortV = (v) => String(v === null || v === undefined ? '' : v).slice(0, 7)
      const teamRoleAdmin = (role) => role === 'owner' || role === 'admin'

      // One word of the server or of the disk half → a sentence. A word nobody planned is still shown, with its code.
      const teamWord = (j) => {
        const code = j !== null && j !== undefined && typeof j === 'object' && typeof j.error === 'string' ? j.error : 'other'
        const key = 'tm.e.' + code
        if (STR[key] !== undefined) return t(key, { reason: j.reason || '?', file: j.file || '?', code })
        return t('tm.e.other', { code })
      }
      const packWord = (j) => {
        const f = j.file || ''
        if (j.error === 'scan_rejected' || j.reason === 'scan_rejected') return t('tm.p.bad.secret', { file: f, line: j.line || '?' })
        if (j.error === 'skill_disabled') return t('tm.p.bad.disabled')
        const by = { binary: 'tm.p.bad.binary', file_too_large: 'tm.p.bad.big', too_many_files: 'tm.p.bad.many', too_large: 'tm.p.bad.total', bad_path: 'tm.p.bad.path', frontmatter: 'tm.p.bad.frontmatter', name: 'tm.p.bad.name', description: 'tm.p.bad.description', no_skill_md: 'tm.p.bad.nofile' }
        if (by[j.reason] !== undefined) return t(by[j.reason], { file: f })
        if (j.error === 'skill_not_found' || j.error === 'root_not_allowed') return teamWord(j)
        return t('tm.p.bad.other', { code: j.reason || j.error || '?' })
      }

      // A small line diff for a reviewer: changed lines with two lines of context. null when a file is too long to compare.
      const lineDiff = (aText, bText) => {
        const a = String(aText).split('\n')
        const b = String(bText).split('\n')
        if (a.length > 1200 || b.length > 1200) return null
        const n = a.length
        const m = b.length
        const dp = []
        for (let i = 0; i <= n; i++) dp.push(new Uint16Array(m + 1))
        for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
        const out = []
        let i = 0
        let j = 0
        while (i < n && j < m) {
          if (a[i] === b[j]) { out.push([' ', a[i]]); i++; j++ } else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(['-', a[i]]); i++ } else { out.push(['+', b[j]]); j++ }
        }
        while (i < n) out.push(['-', a[i++]])
        while (j < m) out.push(['+', b[j++]])
        const keep = out.map(() => false)
        out.forEach((l, k) => { if (l[0] !== ' ') for (let d = -2; d <= 2; d++) if (k + d >= 0 && k + d < out.length) keep[k + d] = true })
        const lines = []
        let gap = false
        out.forEach((l, k) => {
          if (keep[k]) { if (gap && lines.length > 0) lines.push(['@', '…']); lines.push(l); gap = false } else gap = true
        })
        return lines
      }
      const codeBox = (text, diffAgainst) => {
        if (diffAgainst === undefined || diffAgainst === null) return h('pre', { className: 'kbt-code' }, String(text))
        const d = lineDiff(diffAgainst, text)
        if (d === null) return h('div', { className: 'kbt-code' }, t('tm.r.tooBig'))
        return h('pre', { className: 'kbt-code' }, d.map((l, k) => h('span', { key: k, className: l[0] === '+' ? 'add' : (l[0] === '-' ? 'del' : (l[0] === '@' ? 'gap' : null)), style: l[0] === ' ' ? { display: 'block' } : null }, (l[0] === '@' ? '' : l[0] + ' ') + l[1])))
      }
      const banner = (kind, ic, text) => h('div', { className: 'kbt-banner' + (kind === '' ? '' : ' ' + kind) }, icon(ic, 16), h('span', null, text))
      const filesList = (files, sel, onPick, statuses) => h('div', { className: 'kbt-files' }, files.map((f) => {
        const st = statuses !== undefined && statuses !== null ? statuses[f.path] : undefined
        return h('button', {
          key: f.path, type: 'button', className: 'kbt-file' + (sel === f.path ? ' on' : '') + (TEAM_SCRIPT_RE.test(f.path) || /^scripts?\//i.test(f.path) ? ' warn' : ''),
          onClick: () => onPick(f.path)
        }, icon('file', 14), h('span', { className: 'p' }, f.path), h('span', { className: 'z' }, sizeOf(byteLen(f.content))),
        st !== undefined && st !== 'same' ? h('span', { className: 'kb8-pill ' + (st === 'removed' ? '' : 'warn') }, t(st === 'changed' ? 'tm.r.changed' : (st === 'new' ? 'tm.r.fnew' : 'tm.r.removed'))) : (f.path === 'SKILL.md' ? h('span', { className: 'kb8-pill' }, t('tm.det.entry')) : h('span', null)))
      }))

      // Why the Team tab shows nothing to do: not signed in, not on the plan, no team workspace, not on this server…
      // The page of the plans: the console of the ACTIVE server (its « Plan & Credits » page, with its own sign-in in a browser), which
      // the cloud host reports (`/kybernos-cloud/server`): no address is written here. Opened in a new tab: this screen stays where it is.
      function TeamLocked(props) {
        const kind = props.kind
        const planPair = React.useState('')
        const planUrl = planPair[0]
        React.useEffect(() => {
          if (kind !== 'plan') return undefined
          let alive = true
          fetch('/kybernos-cloud/server', { headers: { accept: 'application/json' } }).then((r) => r.json().catch(() => null))
            .then((j) => { if (alive === true && j !== null && j.ok === true && j.server !== null && typeof j.server === 'object' && typeof j.server.console === 'string') planPair[1](j.server.console) })
            .catch(() => { /* no plans link */ })
          return () => { alive = false }
        }, [kind])
        const known = ['plan', 'signin', 'space', 'server', 'reconnect', 'net'].indexOf(kind) >= 0
        const retriable = kind === 'net' || kind === 'other' || kind === 'reconnect'
        return h('div', { className: 'kb-empty' }, icon(kind === 'plan' || kind === 'signin' || kind === 'space' ? 'lock' : 'alert', 24),
          h('span', { className: 'kb8-name' }, t(known ? 'tm.lock.' + kind + '.t' : 'tm.lock.other.t')),
          h('span', { className: 'kb8-parent', style: { maxWidth: '520px' } }, known ? t('tm.lock.' + kind + '.b') : (props.detail || '')),
          h('div', { className: 'kb-row', style: { justifyContent: 'center' } },
            kind === 'plan' && planUrl !== '' ? h('a', { className: 'kb8-primary', href: planUrl, target: '_blank', rel: 'noopener noreferrer', style: { textDecoration: 'none' } }, t('tm.seePlan')) : null,
            retriable ? h('button', { type: 'button', className: 'kb8-ghost', onClick: props.onRetry }, t('tm.retry')) : null,
            h('button', { type: 'button', className: 'kb8-ghost', onClick: props.onBack }, t('tm.back'))))
      }

      // A local skill that can be proposed, from the catalogue: one of the two writable folders, switched on.
      const proposable = (skills) => skills.filter((s) => s.writable === true && s.active === true)

      function ProposeSheet(props) {
        const cands = proposable(props.local)
        const [pick, setPick] = React.useState(() => { const c = typeof props.preselect === 'string' ? cands.filter((s) => s.name === props.preselect)[0] : undefined; return c !== undefined ? skillKey(c) : '' })
        const [pack, setPack] = React.useState({ phase: 'idle' })
        const [note, setNote] = React.useState('')
        const [sending, setSending] = React.useState(false)
        const [err, setErr] = React.useState('')
        const alive = React.useRef(true)
        React.useEffect(() => () => { alive.current = false }, [])
        const chosen = cands.filter((s) => skillKey(s) === pick)[0]
        React.useEffect(() => {
          if (chosen === undefined) { setPack({ phase: 'idle' }); return undefined }
          let stop = false
          setPack({ phase: 'loading' }); setErr('')
          postJson('/kybernos-skills/team/pack', { root: chosen.root, name: chosen.name }).then((j) => {
            if (stop || alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true) setPack({ phase: 'ready', data: j })
            else setPack({ phase: 'bad', text: packWord(j !== null && typeof j === 'object' ? j : {}) })
          }).catch(() => { if (!stop && alive.current === true) setPack({ phase: 'bad', text: t('err.unavail', { r: 'team/pack' }) }) })
          return () => { stop = true }
        }, [pick])
        const submit = () => {
          if (pack.phase !== 'ready' || sending) return
          setSending(true); setErr('')
          postJson('/kybernos-cloud/team/skills/add', { name: pack.data.name, description: pack.data.description, files: pack.data.files, note: note.trim() }).then((j) => {
            if (alive.current !== true) return
            setSending(false)
            if (j !== null && typeof j === 'object' && j.ok === true) props.onDone(pack.data.name)
            else setErr(teamWord(j))
          }).catch(() => { if (alive.current === true) { setSending(false); setErr(t('tm.e.network')) } })
        }
        const d = pack.phase === 'ready' ? pack.data : null
        return h('div', { className: 'kb-overlay', onClick: props.onClose },
          h('div', { className: 'kb-modal kbt-sheet', onClick: (e) => e.stopPropagation() },
            h('div', { className: 'kb-row' }, h('span', { className: 'kb8-h2' }, props.admin ? t('tm.p.titleAdmin', { ws: props.ws }) : t('tm.p.title', { ws: props.ws })), h('span', { style: { flex: '1' } }),
              h('button', { type: 'button', className: 'kb-tool', onClick: props.onClose, 'aria-label': t('m.cancel') }, '✕')),
            h('p', { className: 'kb8-sub', style: { margin: '0' } }, props.admin ? t('tm.p.subAdmin') : t('tm.p.sub')),
            cands.length === 0
              ? banner('', 'info', t('tm.p.none'))
              : h('div', { className: 'kbs-fields' }, h('span', { className: 'kbs-label' }, t('tm.p.pick')),
                h('select', { className: 'kbs-select', value: pick, onChange: (e) => setPick(e.target.value) },
                  h('option', { value: '' }, t('tm.p.choose')),
                  cands.map((s) => h('option', { key: skillKey(s), value: skillKey(s) }, s.name + ' · ' + s.root))),
                chosen !== undefined && chosen.description !== '' ? h('span', { className: 'kbt-cap' }, chosen.description) : null),
            pack.phase === 'loading' ? h('span', { className: 'kb8-mono' }, t('tm.p.packing')) : null,
            pack.phase === 'bad' ? banner('err', 'alert', pack.text) : null,
            d !== null ? h('div', { className: 'kbs-fields' }, h('span', { className: 'kbs-label' }, t('tm.p.send')),
              filesList(d.files, '', () => {}, null)) : null,
            d !== null ? h('div', { className: 'kbt-kv' }, h('span', { className: 'k' }, t('tm.p.checks')),
              h('span', { className: 'kb8-pills' },
                h('span', { className: 'kb8-pill ok' }, t('tm.p.ck.name')),
                h('span', { className: 'kb8-pill ok' }, t('tm.p.ck.text')),
                h('span', { className: 'kb8-pill ok' }, t('tm.p.ck.secret')),
                h('span', { className: 'kb8-pill ok' }, t('tm.p.ck.size', { n: d.count, kb: kbOf(d.bytes) })))) : null,
            d !== null && d.scripts.length > 0 ? banner('warn', 'alert', t('tm.script') + sep() + d.scripts.join(', ')) : null,
            h('div', { className: 'kbs-fields' }, h('span', { className: 'kbs-label' }, props.admin ? t('tm.p.noteAdmin') : t('tm.p.note')),
              h('textarea', { className: 'kbs-area', style: { minHeight: '70px', fontFamily: 'inherit', fontSize: '13px' }, value: note, maxLength: 280, onChange: (e) => setNote(e.target.value) })),
            err !== '' ? h('div', { className: 'kbs-err' }, err) : null,
            h('div', { className: 'kbs-actions' },
              h('button', { type: 'button', className: 'kb8-ghost', onClick: props.onClose }, t('m.cancel')),
              h('button', { type: 'button', className: 'kb8-primary', disabled: pack.phase !== 'ready' || sending, onClick: submit },
                sending ? t('tm.p.sending') : (props.admin ? t('tm.p.submitAdmin') : t('tm.p.submit')))),
            h('span', { className: 'kbt-cap' }, t('tm.p.foot'))))
      }

      // The admin's queue: every proposal with its files (and what changed since the approved version) BEFORE the decision.
      function TeamReviewCard(props) {
        const s = props.skill
        const [st, setSt] = React.useState({ phase: 'loading', files: [], base: null })
        const [sel, setSel] = React.useState('')
        const [rejecting, setRejecting] = React.useState(false)
        const [why2, setWhy2] = React.useState('')
        const [busy, setBusy] = React.useState(false)
        const alive = React.useRef(true)
        React.useEffect(() => () => { alive.current = false }, [])
        React.useEffect(() => {
          let stop = false
          const one = (id) => getJson('/kybernos-cloud/team/skills/item?id=' + encodeURIComponent(id))
          Promise.all([one(s.id), s.replaces !== null && s.replaces !== undefined ? one(s.replaces) : Promise.resolve(null)]).then(([a, b]) => {
            if (stop || alive.current !== true) return
            if (a === null || a.ok !== true || !Array.isArray(a.skill.files)) { setSt({ phase: 'error', files: [], base: null, error: teamWord(a) }); return }
            const files = a.skill.files
            const base = b !== null && b.ok === true && Array.isArray(b.skill.files) ? b.skill.files : null
            setSt({ phase: 'ready', files, base })
            const changed = base === null ? null : files.filter((f) => { const o = base.filter((x) => x.path === f.path)[0]; return o === undefined || o.content !== f.content })[0]
            setSel(changed !== undefined && changed !== null ? changed.path : (files.some((f) => f.path === 'SKILL.md') ? 'SKILL.md' : (files[0] !== undefined ? files[0].path : '')))
          }).catch(() => { if (!stop && alive.current === true) setSt({ phase: 'error', files: [], base: null, error: t('tm.e.network') }) })
          return () => { stop = true }
        }, [s.id])
        const decide = (decision) => {
          if (busy) return
          setBusy(true)
          const payload = { id: s.id, decision }
          if (decision === 'reject' && why2.trim() !== '') payload.note = why2.trim()
          postJson('/kybernos-cloud/team/skills/review', payload).then((j) => {
            if (alive.current !== true) return
            setBusy(false)
            if (j !== null && typeof j === 'object' && j.ok === true) props.onDone({ kind: 'ok', text: t(decision === 'approve' ? 'tm.n.approved' : 'tm.n.rejected', { name: s.name }) })
            else props.onDone({ kind: 'err', text: teamWord(j) }, j !== null && typeof j === 'object' && (j.error === 'not_pending' || j.error === 'skill_not_found'))
          }).catch(() => { if (alive.current === true) { setBusy(false); props.onDone({ kind: 'err', text: t('tm.e.network') }) } })
        }
        const files = st.files
        const statuses = {}
        let shown = files
        if (st.base !== null) {
          files.forEach((f) => { const o = st.base.filter((x) => x.path === f.path)[0]; statuses[f.path] = o === undefined ? 'new' : (o.content === f.content ? 'same' : 'changed') })
          const gone = st.base.filter((o) => !files.some((f) => f.path === o.path))
          gone.forEach((o) => { statuses[o.path] = 'removed' })
          shown = files.concat(gone)
        }
        const cur = shown.filter((f) => f.path === sel)[0]
        const baseOf = cur !== undefined && st.base !== null ? st.base.filter((x) => x.path === cur.path)[0] : undefined
        const scripts = teamScripts(files)
        return h('div', { className: 'kbt-card' },
          h('div', { className: 'head' }, tile(s.name, 'pkg', 'kbs-sm'),
            h('div', { className: 'grow' },
              h('div', { className: 'kb-row', style: { gap: '8px' } },
                h('span', { className: 'kb8-name' }, s.name),
                h('span', { className: 'kb8-pill ' + (s.replaces !== null && s.replaces !== undefined ? 'info' : 'ok') }, s.replaces !== null && s.replaces !== undefined ? t('tm.r.updateOf') : t('tm.r.new')),
                scripts.length > 0 ? h('span', { className: 'kb8-pill warn' }, t('tm.script')) : null,
                h('span', { className: 'kb8-pill' }, shortV(s.version))),
              h('span', { className: 'kb8-parent' }, t('tm.r.by', { a: s.proposedName || '—', d: s.proposedAt ? today(s.proposedAt) : '' }) + (s.note ? ' · “' + s.note + '”' : '')),
              s.replaces !== null && s.replaces !== undefined && st.base !== null ? h('span', { className: 'kbt-cap' }, t('tm.r.replaces', { v: '#' + s.replaces })) : null),
            h('div', { className: 'kbt-act' },
              h('button', { type: 'button', className: 'kbt-btn danger', disabled: busy || st.phase !== 'ready', onClick: () => setRejecting(!rejecting) }, t('tm.r.reject')),
              h('button', { type: 'button', className: 'kbt-btn solid', disabled: busy || st.phase !== 'ready', onClick: () => decide('approve') }, t('tm.r.approve')))),
          rejecting ? h('div', { className: 'kbs-fields' }, h('span', { className: 'kbs-label' }, t('tm.r.rejectNote')),
            h('textarea', { className: 'kbs-area', style: { minHeight: '60px', fontFamily: 'inherit', fontSize: '13px' }, value: why2, maxLength: 280, onChange: (e) => setWhy2(e.target.value) }),
            h('div', { className: 'kbs-actions' },
              h('button', { type: 'button', className: 'kb8-ghost', onClick: () => setRejecting(false) }, t('m.cancel')),
              h('button', { type: 'button', className: 'kbt-btn danger', disabled: busy, onClick: () => decide('reject') }, t('tm.r.rejectYes')))) : null,
          st.phase === 'loading' ? h('span', { className: 'kb8-mono' }, t('tm.det.loading')) : null,
          st.phase === 'error' ? h('div', { className: 'kbs-err' }, st.error) : null,
          st.phase === 'ready' ? h('div', { className: 'kbt-stack' },
            filesList(shown, sel, setSel, st.base !== null ? statuses : null),
            cur === undefined ? null : codeBox(cur.content, statuses[cur.path] === 'changed' && baseOf !== undefined ? baseOf.content : null),
            h('span', { className: 'kbt-cap' }, t('tm.r.scan', { n: files.length, kb: kbOf(s.bytes || files.reduce((a, f) => a + byteLen(f.content), 0)) }))) : null)
      }

      // One skill, opened: its files first (what will be copied), then the install panel.
      function TeamDetail(props) {
        const [st, setSt] = React.useState({ phase: 'loading', skill: null, error: '' })
        const [sel, setSel] = React.useState('')
        const writable = props.roots
        const [root, setRoot] = React.useState(writable.length > 0 ? writable[0].path : '')
        const [asking, setAsking] = React.useState(false)
        const alive = React.useRef(true)
        React.useEffect(() => () => { alive.current = false }, [])
        React.useEffect(() => {
          let stop = false
          setSt({ phase: 'loading', skill: null, error: '' })
          getJson('/kybernos-cloud/team/skills/item?id=' + encodeURIComponent(props.id)).then((j) => {
            if (stop || alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && j.skill !== undefined) {
              setSt({ phase: 'ready', skill: j.skill, error: '' })
              setSel(j.skill.files.some((f) => f.path === 'SKILL.md') ? 'SKILL.md' : (j.skill.files[0] !== undefined ? j.skill.files[0].path : ''))
            } else setSt({ phase: 'error', skill: null, error: teamWord(j) })
          }).catch(() => { if (!stop && alive.current === true) setSt({ phase: 'error', skill: null, error: t('tm.e.network') }) })
          return () => { stop = true }
        }, [props.id, props.tick])
        const back = h('button', { type: 'button', className: 'kb-back', onClick: props.onClose }, icon('back', 15), ' ' + t('tm.det.back'))
        if (st.phase === 'loading') return h('div', null, back, h('div', { className: 'kb-empty' }, h('span', { className: 'kb8-mono' }, t('tm.det.loading'))))
        if (st.phase === 'error') return h('div', null, back, h('div', { className: 'kb-empty' }, h('span', { className: 'kb8-name' }, st.error)))
        const s = st.skill
        const rel = props.relationOf(s)
        const approved = s.status === 'approved'
        const cur = s.files.filter((f) => f.path === sel)[0]
        const scripts = teamScripts(s.files)
        const busy = props.busy['i' + s.id] === true
        const canInstall = approved && rel.kind !== 'own' && rel.kind !== 'installed' && !(rel.kind === 'update' && rel.edited === true)
        const action = () => props.onInstall(s, rel, root)
        const note = !approved ? t('tm.det.notApproved')
          : (rel.kind === 'update' ? (rel.edited === true ? t('tm.det.editedNote') : t('tm.det.updateNote', { old: shortV(rel.local.teamVersion) }))
            : (rel.kind === 'own' ? t('tm.det.ownNote') : (rel.kind === 'installed' ? t('tm.det.installedNote') : t('tm.det.never'))))
        return h('div', null, back,
          h('div', { className: 'kb-detail-head' }, tile(s.name, 'pkg', 'lg'),
            h('div', { className: 'meta' },
              h('div', { className: 'kb-row', style: { gap: '9px' } }, h('span', { className: 'kb8-h1', style: { fontSize: '22px' } }, s.name),
                h('span', { className: 'kb8-pill ' + (approved ? 'ok' : (s.status === 'rejected' ? 'warn' : '')) }, t('tm.st.' + s.status)),
                h('span', { className: 'kb8-pill' }, shortV(s.version)),
                h('span', { className: 'kb8-pill' }, t('tm.det.count', { n: s.fileCount, size: sizeOf(s.bytes) })),
                scripts.length > 0 ? h('span', { className: 'kb8-pill warn' }, t('tm.script')) : null),
              h('span', { className: 'kb8-parent' }, s.description)),
            canInstall ? h('button', { type: 'button', className: 'kb8-primary', disabled: busy, onClick: action }, icon(rel.kind === 'update' ? 'dl' : 'plus', 15), h('span', null, rel.kind === 'update' ? t('tm.update') : t('tm.install'))) : null),
          h('span', { className: 'kb8-parent' }, s.reviewedName ? t('tm.det.approvedBy', { a: s.proposedName || '—', d: today(s.proposedAt || ''), r: s.reviewedName }) : t('tm.det.proposedBy', { a: s.proposedName || '—', d: today(s.proposedAt || '') })),
          h('div', { className: 'kb-cols', style: { marginTop: '16px' } },
            h('div', { className: 'kbt-stack' },
              h('span', { className: 'kb-section-label' }, t('tm.det.files')),
              filesList(s.files, sel, setSel, null),
              cur === undefined ? h('span', { className: 'kb8-mono' }, t('tm.det.pick')) : codeBox(cur.content, null)),
            h('div', { className: 'kb-panel' },
              h('span', { className: 'kb-section-label' }, t('tm.det.into')),
              rel.kind === 'update'
                ? h('span', { className: 'kb8-mono' }, rel.local.root)
                : h('select', { className: 'kbs-select', value: root, onChange: (e) => setRoot(e.target.value) },
                  writable.length === 0 ? h('option', { value: '' }, t('m.defroot')) : writable.map((r) => h('option', { key: r.path, value: r.path }, r.path + (r.exists === true ? '' : '  ' + t('m.willCreate'))))),
              h('span', { className: 'kb-section-label', style: { marginTop: '4px' } }, t('tm.det.checks')),
              h('div', { className: 'row' }, h('span', { className: 'ic' }, icon('shield', 15)), h('span', null, t('tm.det.chk1', { v: shortV(s.version) }))),
              h('div', { className: 'row' }, h('span', { className: 'ic' }, icon('folder', 15)), h('span', null, t('tm.det.chk2'))),
              h('div', { className: 'row' }, h('span', { className: 'ic' }, icon('code', 15)), h('span', null, t('tm.det.chk3'))),
              canInstall ? h('button', { type: 'button', className: 'kb8-primary', disabled: busy, style: { justifyContent: 'center' }, onClick: action }, rel.kind === 'update' ? t('tm.update') : t('tm.install')) : null,
              h('span', { className: 'kbt-cap' }, note),
              props.admin && approved
                ? (asking
                  ? h('div', { className: 'kbs-fields' }, h('span', { className: 'kbt-cap' }, t('tm.det.retireAsk', { name: s.name })),
                    h('div', { className: 'kbs-actions' },
                      h('button', { type: 'button', className: 'kb8-ghost', onClick: () => setAsking(false) }, t('m.cancel')),
                      h('button', { type: 'button', className: 'kbt-btn danger', onClick: () => props.onRetire(s) }, t('tm.det.retireYes'))))
                  : h('button', { type: 'button', className: 'kbt-btn danger', style: { alignSelf: 'flex-start' }, onClick: () => setAsking(true) }, t('tm.retire')))
                : null)))
      }

      // The tab: sub-views, the table, the queue, the opened skill. `sum` is what the parent already knows (role, counts, workspace).
      function TeamSkills(props) {
        const sum = props.sum
        const admin = teamRoleAdmin(sum.role)
        const view = props.view
        const setView = props.onView
        const [list, setList] = React.useState({ phase: 'loading', skills: [], error: '' })
        const [tick, setTick] = React.useState(0)
        const [busy, setBusy] = React.useState({})
        const alive = React.useRef(true)
        React.useEffect(() => () => { alive.current = false }, [])
        const reload = () => { setTick((n) => n + 1); props.onSummary() }
        React.useEffect(() => {
          if (admin !== true && (view === 'proposed' || view === 'retired')) { setView('approved'); return undefined }
          if (admin === true && view === 'mine') { setView('approved'); return undefined }
          let stop = false
          setList((m) => ({ ...m, phase: 'loading' }))
          getJson('/kybernos-cloud/team/skills?view=' + (view === 'retired' ? 'all' : view) + '&limit=200').then((j) => {
            if (stop || alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.skills)) {
              setList({ phase: 'ready', skills: view === 'retired' ? j.skills.filter((s) => s.status === 'retired') : j.skills, error: '' })
            } else setList({ phase: 'error', skills: [], error: teamWord(j) })
          }).catch(() => { if (!stop && alive.current === true) setList({ phase: 'error', skills: [], error: t('tm.e.network') }) })
          return () => { stop = true }
        }, [view, tick, props.ver])

        // What this machine already has under that name: nothing, the team's skill (same or older version, edited or not), or the user's own.
        const relationOf = (s) => {
          const here = props.local.filter((x) => x.name === s.name && x.writable === true)
          if (here.length === 0) return { kind: 'install' }
          const l = here.filter((x) => typeof x.teamVersion === 'string')[0]
          if (l === undefined) return { kind: 'own', local: here[0] }
          if (l.teamVersion === s.version) return { kind: 'installed', local: l }
          return { kind: 'update', local: l, edited: l.teamModified === true }
        }
        const install = async (s, rel, root) => {
          const k = 'i' + s.id
          if (busy[k] === true) return
          setBusy((m) => ({ ...m, [k]: true }))
          try {
            const item = await getJson('/kybernos-cloud/team/skills/item?id=' + encodeURIComponent(s.id))
            if (item === null || item.ok !== true || !Array.isArray(item.skill.files)) { props.notify({ kind: 'err', text: teamWord(item) }); return }
            const update = rel.kind === 'update'
            const res = await postJson('/kybernos-skills/team/install', { root: update ? rel.local.root : root, name: s.name, version: item.skill.version, files: item.skill.files, teamId: s.id, replace: update })
            if (res !== null && res.ok === true) { props.notify({ kind: 'ok', text: update ? t('tm.n.updated', { name: s.name }) : t('tm.n.installed', { name: s.name, n: res.files }) }); props.onChanged() }
            else props.notify({ kind: 'err', text: teamWord(res) })
          } catch (e) { props.notify({ kind: 'err', text: t('tm.e.network') }) } finally {
            if (alive.current === true) setBusy((m) => { const n = { ...m }; delete n[k]; return n })
          }
        }
        const act = async (path, body, okText, after) => {
          try {
            const j = await postJson(path, body)
            if (j !== null && typeof j === 'object' && j.ok === true) { props.notify({ kind: 'ok', text: okText }); if (after) after() } else { props.notify({ kind: 'err', text: teamWord(j) }); if (j !== null && j.error === 'not_pending') reload() }
          } catch (e) { props.notify({ kind: 'err', text: t('tm.e.network') }) }
          reload()
        }
        const retire = (s) => act('/kybernos-cloud/team/skills/retire', { id: s.id }, t('tm.n.retired', { name: s.name }), () => props.onOpen(null))
        const withdraw = (s) => act('/kybernos-cloud/team/skills/delete', { id: s.id }, t('tm.n.withdrawn'))

        if (props.openId !== null) {
          return h(TeamDetail, { id: props.openId, tick, local: props.local, roots: props.roots, admin, busy, relationOf, onInstall: install, onRetire: retire, onClose: () => props.onOpen(null) })
        }

        const counts = sum.counts || { approved: 0, pending: 0 }
        const views = admin ? [['approved', counts.approved], ['proposed', counts.pending], ['retired', null]] : [['approved', counts.approved], ['mine', counts.pending]]
        const names = { approved: 'tm.v.approved', mine: 'tm.v.mine', proposed: 'tm.v.review', retired: 'tm.v.retired' }
        const needle = props.needle.trim().toLowerCase()
        const rows = list.skills.filter((s) => needle === '' || s.name.toLowerCase().includes(needle) || s.description.toLowerCase().includes(needle))
        const emptyKey = { approved: 'approved', mine: 'mine', proposed: 'review', retired: 'retired' }[view]

        const verPills = (s, rel) => {
          const out = []
          if (rel !== null && rel.kind === 'update') {
            out.push(h('span', { key: 'o', className: 'kb8-pill' }, shortV(rel.local.teamVersion)))
            out.push(h('span', { key: 'n', className: 'kb8-pill info' }, t('tm.newer', { v: shortV(s.version) })))
            if (rel.edited === true) out.push(h('span', { key: 'e', className: 'kb8-pill warn' }, t('tm.edited')))
          } else out.push(h('span', { key: 'v', className: 'kb8-pill' }, shortV(s.version)))
          return out
        }
        const rowActions = (s, rel) => {
          if (view === 'mine') {
            if (s.status === 'proposed') return [h('button', { key: 'w', type: 'button', className: 'kbt-btn', onClick: (e) => { e.stopPropagation(); withdraw(s) } }, t('tm.withdraw'))]
            return [h('span', { key: 's', className: 'kb8-pill ' + (s.status === 'approved' ? 'ok' : (s.status === 'rejected' ? 'warn' : '')) }, t('tm.st.' + s.status))]
          }
          if (s.status === 'retired') return [h('span', { key: 's', className: 'kb8-pill' }, t('tm.st.retired'))]
          const bz = busy['i' + s.id] === true
          if (rel.kind === 'installed') return [h('span', { key: 's', className: 'kb8-pill ok' }, t('tm.installed'))]
          if (rel.kind === 'own') return [h('span', { key: 's', className: 'kb8-pill warn', title: t('tm.det.ownNote') }, t('tm.own'))]
          return [h('button', { key: 'i', type: 'button', className: 'kbt-btn solid', disabled: bz || (rel.kind === 'update' && rel.edited === true), title: rel.kind === 'update' && rel.edited === true ? t('tm.det.editedNote') : undefined,
            onClick: (e) => { e.stopPropagation(); install(s, rel, (props.roots[0] || { path: '' }).path) } }, rel.kind === 'update' ? t('tm.update') : t('tm.install'))]
        }
        const row = (s, i) => {
          const rel = view === 'mine' || s.status === 'retired' ? null : relationOf(s)
          return h('div', { key: s.id, className: 'kbs-row' + (rel !== null && (rel.kind === 'installed' || rel.kind === 'update') ? ' has' : '') + appear(i), onClick: () => props.onOpen(s.id) },
            h('span', { className: 'who' }, tile(s.name, 'pkg', 'kbs-sm')),
            h('span', { className: 'kbt-name' }, h('span', { className: 'n' }, s.name),
              h('span', { className: 'd' }, view === 'mine' && s.status === 'rejected' ? (s.reviewNote ? t('tm.r.rejectedWith', { note: s.reviewNote }) : t('tm.r.noNote')) : s.description)),
            h('span', { className: 'kbt-by' }, s.proposedName || '—', h('span', { className: 'd' }, s.proposedAt ? today(s.proposedAt) : '')),
            h('span', { className: 'badges' }, verPills(s, rel)),
            h('span', { className: 'kbt-act' }, rowActions(s, rel)))
        }

        let body
        if (list.phase === 'loading' && list.skills.length === 0) body = skeletonOf('team', 5) || h('div', { className: 'kb-empty' }, h('span', { className: 'kb8-mono' }, t('tm.loading')))
        else if (list.phase === 'error') body = h('div', { className: 'kb-empty' }, h('span', { className: 'kb8-name' }, list.error), h('button', { type: 'button', className: 'kb8-ghost', onClick: reload }, t('tm.retry')))
        else if (view === 'proposed') {
          body = rows.length === 0
            ? h('div', { className: 'kb-empty' }, icon('check', 24), h('span', { className: 'kb8-name' }, t('tm.empty.review')), h('span', { className: 'kb8-parent' }, t('tm.empty.reviewHint')))
            : h('div', { className: 'kbt-stack' }, banner('warn', 'alert', t('tm.r.banner')),
              rows.map((s) => h(TeamReviewCard, { key: s.id, skill: s, onDone: (notice, refresh) => { props.notify(notice); reload(); if (refresh) props.onSummary() } })))
        } else if (rows.length === 0) {
          body = needle !== '' ? h('div', { className: 'kb-empty' }, icon('search', 24), h('span', { className: 'kb8-name' }, t('y.noresult')), h('span', { className: 'kb8-parent' }, t('y.nofilter')))
            : h('div', { className: 'kb-empty' }, icon('pkg', 24), h('span', { className: 'kb8-name' }, t('tm.empty.' + emptyKey)), h('span', { className: 'kb8-parent' }, t('tm.empty.' + emptyKey + 'Hint')))
        } else {
          body = h('div', { className: 'kbs-table kbt' + (list.phase === 'loading' ? ' loading' : '') },
            h('div', { className: 'kbt-head' }, h('span', null), h('span', null, t('tm.th.skill')), h('span', null, t('tm.th.by')), h('span', null, t('tm.th.version')), h('span', null)),
            rows.map(row))
        }

        return h('div', { className: 'kbt-stack' },
          h('div', { className: 'kbt-subrow' },
            h('nav', { className: 'kbsub' }, h('div', { className: 'kbsub-group', role: 'tablist' }, views.map((v) => h('button', {
              key: v[0], type: 'button', role: 'tab', 'aria-selected': view === v[0] ? 'true' : 'false', className: 'kb-seg' + (view === v[0] ? ' on' : ''), onClick: () => setView(v[0])
            }, t(names[v[0]]) + ' ', v[1] === null ? null : h('span', { className: 'count' }, String(v[1])), v[0] === 'proposed' && counts.pending > 0 ? h('span', { className: 'kbt-dot' }) : null)))),
            h('span', { className: 'kb8-mono', style: { flex: 'none', textAlign: 'left' } }, t(admin ? 'tm.who.admin' : 'tm.who.member', { ws: sum.workspaceName || '' }))),
          body)
      }

      // ── Settings page « Skills » (catalogue) ─────────────────────────────────────────────────────
      // Everything here comes from routes the host already serves (index-source, index-source/set,
      // status, skills, featured): the page names where skills come from and where they are written,
      // and changes the relay. Nothing is invented, and a route that is absent is said so.
      function SkillsSettingsPage() {
        const [src, setSrc] = React.useState(null)
        const [srcOpen, setSrcOpen] = React.useState(false)
        const [srcBusy, setSrcBusy] = React.useState(false)
        const [srcErr, setSrcErr] = React.useState('')
        const [roots, setRoots] = React.useState(null)          // null = route not answering
        const [counts, setCounts] = React.useState(null)        // { installed, active, disabled, featured }
        const alive = React.useRef(true)
        React.useEffect(() => () => { alive.current = false }, [])

        React.useEffect(() => {
          getJson('/kybernos-skills/index-source').then((j) => {
            if (alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && j.source !== null && typeof j.source === 'object') setSrc(j.source)
          }).catch(() => { /* a host from before this setting answers nothing: the card says so */ })
          getJson('/kybernos-skills/status').then((j) => {
            if (alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.roots)) {
              setRoots(j.roots.filter((r) => r !== null && typeof r.path === 'string'))
            } else setRoots([])
          }).catch(() => { if (alive.current === true) setRoots([]) })
          // Counts of THIS profile's catalogue (the /skills route answers the same shape as the panel's
          // catalogue); the Featured list is its own route. A failure simply leaves the section out.
          getJson('/kybernos-skills/skills').then((j) => {
            if (alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.skills)) {
              const list = j.skills
              setCounts({
                installed: list.length,
                active: list.filter((s) => s !== null && typeof s === 'object' && s.active === true).length,
                disabled: list.filter((s) => s !== null && typeof s === 'object' && s.active !== true).length,
                featured: null
              })
            }
          }).catch(() => { /* the counts are a bonus, never an error */ })
          getJson('/kybernos-skills/featured').then((j) => {
            if (alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.items)) {
              setCounts((c) => (c === null ? { installed: 0, active: 0, disabled: 0, featured: j.items.length } : Object.assign({}, c, { featured: j.items.length })))
            }
          }).catch(() => { /* same */ })
        }, [])

        // Same write as the Discover tab's source line (POST /index-source/set): the host validates the
        // address with the rule of the KYBERNOS_SKILLS_INDEX_URL variable and answers the new state.
        const saveSource = (url) => {
          if (srcBusy === true) return
          setSrcBusy(true); setSrcErr('')
          postJson('/kybernos-skills/index-source/set', { url }).then((j) => {
            if (alive.current !== true) return
            setSrcBusy(false)
            if (j !== null && typeof j === 'object' && j.ok === true && j.source !== null && typeof j.source === 'object') {
              setSrc(j.source); setSrcOpen(false)
            } else setSrcErr(why(j, t('err.source')))
          }).catch(() => {
            if (alive.current !== true) return
            setSrcBusy(false); setSrcErr(t('err.unavail', { r: 'index-source' }))
          })
        }

        // The window is the panel's own (SourceModal), reused as is, and its rules are scoped to `.kbs-root`, which the Settings page is not:
        // drawn inside the card it was bare text with the browser's grey buttons (audit R-V-04, V-23). It gets a `.kbs-root` of its own
        // (a box-less wrapper), and goes through a portal to the body so it sits above the Settings dialog, as the sidebar page's does.
        const sourceWindow = () => {
          const modal = h('div', { className: 'kbs-root kbs-top', 'data-kb': 'index-source-root', style: { display: 'contents' } },
            h(SourceModal, { source: src, busy: srcBusy, error: srcErr, onClose: () => setSrcOpen(false), onSubmit: saveSource }))
          return ReactDOM !== null && typeof ReactDOM.createPortal === 'function' && typeof document !== 'undefined' && document.body ? ReactDOM.createPortal(modal, document.body) : modal
        }

        // The relay card: the host as a code line (never a credential), where it comes from, and the
        // button that names another one.
        const sourceCard = () => {
          const where = src === null ? '' : (src.origin === 'env' ? t('src.env') : (src.origin === 'setting' ? t('src.custom') : t('src.default')))
          return h('div', { className: 'kbss-card', 'data-kb': 'skills-settings-source' },
            h('h3', { className: 'kbss-h2' }, t('set.srcH')),
            h('p', { className: 'kbss-sub' }, t('src.what')),
            src === null
              ? h('p', { className: 'kbss-sub' }, t('set.srcMissing'))
              : h('div', { className: 'kbss-srcline', 'data-kb': 'index-source' },
                  icon('globe', 14),
                  h('span', { className: 'k' }, t('src.line')),
                  src.refused === true
                    ? h('span', { className: 'kb8-pill warn' }, t('src.refused'))
                    : h('span', { className: 'v', title: src.url !== null ? src.url : undefined }, src.host),
                  h('span', { className: 'w' }, where),
                  h('button', {
                    type: 'button', className: 'kbss-link', 'data-kb': 'index-source-change',
                    disabled: srcBusy === true, onClick: () => { setSrcErr(''); setSrcOpen(true) }
                  }, t('src.change'))),
            srcErr === '' ? null : h('div', { className: 'kbss-err', role: 'alert' }, srcErr),
            srcOpen === true ? sourceWindow() : null)
        }

        // The write policy: the only folders the host writes to (GET /status answers them with
        // their origin and whether they exist on disk). A root the host reports as read-only
        // stays visible with the word "read-only", never with a write it does not have.
        const rootsCard = () => h('div', { className: 'kbss-card', 'data-kb': 'skills-settings-roots' },
          h('h3', { className: 'kbss-h2' }, t('set.rootsH')),
          h('p', { className: 'kbss-sub' }, t('set.rootsSub')),
          roots === null || roots.length === 0
            ? h('p', { className: 'kbss-sub' }, t('set.rootsMissing'))
            : roots.map((r) => h('div', { key: r.path, className: 'kbss-root-row', 'data-kb': 'skills-settings-root' },
                icon('folder', 14),
                h('span', { className: 'p', title: r.path }, r.path),
                h('span', { className: 'kb8-pill' }, r.source),
                h('span', { className: 'kb8-pill' + (r.exists === true ? ' ok' : ' warn') }, r.exists === true ? t('set.rootExists') : t('set.rootMissing')),
                h('span', { className: 'kb8-pill' + (r.writable === false ? ' warn' : ' ok') }, r.writable === false ? t('set.rootRead') : t('set.rootWrite')))))

        const countsCard = () => counts === null
          ? null
          : h('div', { className: 'kbss-card', 'data-kb': 'skills-settings-counts' },
              h('h3', { className: 'kbss-h2' }, t('set.countsH')),
              h('div', { className: 'kbss-kpis' },
                h('span', null, h('span', { className: 'n' }, nf(counts.installed)), ' ', t('set.installed')),
                h('span', null, h('span', { className: 'n' }, nf(counts.active)), ' ', t('set.active')),
                h('span', null, h('span', { className: 'n' }, nf(counts.disabled)), ' ', t('set.disabled')),
                counts.featured === null ? null : h('span', null, h('span', { className: 'n' }, nf(counts.featured)), ' ', t('set.featured'))))

        return h('div', { className: 'kbss-page', 'data-kb': 'kybernos-skills-settings' },
          h('div', { className: 'kbss-headrow' },
            h('h2', { className: 'kbss-h1' }, t('set.h1')),
            (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-skills', page: 'skills' }) : null)),
          h('p', { className: 'kbss-lead' }, t('set.lead')),
          sourceCard(),
          rootsCard(),
          countsCard())
      }

      /** A settings page that fails to render must never take the Settings dialog down with it. */
      class KbSettingsBoundary extends React.Component {
        constructor (props) { super(props); this.state = { failed: false } }
        static getDerivedStateFromError () { return { failed: true } }
        componentDidCatch (e) { try { console.error('[kybernos-skills] settings page crashed:', e) } catch (e2) { /* console gone */ } }
        render () {
          if (this.state.failed !== true) return this.props.children
          return h('div', { className: 'kbss-page', role: 'alert' }, h('p', { className: 'kbss-err' }, t('y.loadfail')))
        }
      }

      // Stylesheet set ONCE, by id, and refreshed on every apply of the
      // module. Before, it lived in a ctx.effect: when the plugin reloaded
      // (patchReload) the previous effect was unmounted, the stylesheet
      // removed — and if the new apply returned early (`slots` service not
      // ready yet), it was never set again. The panel stayed mounted with
      // only the pivot's styles (stacked toolbar, overlapping labels,
      // search at 52 px): the page looked broken without any error being
      // raised. Same mechanism as the pivot: set by id, never removed,
      // content updated if the module's version changed.
      const CSS_ID = 'kb-skills-css'
      const kbStyle = (css) => {
        try {
          if (typeof document === 'undefined' || document === null) return
          let st = document.getElementById(CSS_ID)
          if (st === null) {
            st = document.createElement('style')
            st.id = CSS_ID
            const head = document.head !== null && document.head !== undefined ? document.head : document.documentElement
            if (head === null || head === undefined) return
            head.appendChild(st)
          }
          if (st.textContent !== css) st.textContent = css
        } catch (e) { /* head unavailable */ }
      }

      function apply(ctx) {
        // Styles first: they are needed as soon as the panel is mounted,
        // even if the slot is not available yet.
        kbStyle(CSS)
        const slots = ctx.get('slots')
        if (slots === undefined) {
          console.error('[kybernos-skills] service slots indisponible: pas d interface')
          return
        }
        slots.inject('main.kybernos-skills', () => slots.register(
          { name: 'main.kybernos-skills' },
          KybernosSkills))
        // ── the catalogue's Settings page ──
        // Same seat as the other bundles' settings pages (kybernos-websearch, kybernos-usage, …):
        // settings.section { id, order, label }. The label is a FUNCTION so it follows the current
        // language (models' page does the same); the order sits between the core's Voice (25) and
        // Commands (27). Registered LAST and guarded: a slot that is not there yet is never fatal.
        try {
          slots.inject('settings.section', () => slots.register(
            { name: 'settings.section', id: 'kybernos-skills', order: 26, label: () => t('set.nav') },
            (props) => {
              try { return h(KbSettingsBoundary, props, h(SkillsSettingsPage, props)) } catch (e) { return null }
            }))
        } catch (kbSettingsError) {
          try { console.warn('[kybernos-skills] settings section not mounted', kbSettingsError) } catch (e2) { /* console gone */ }
        }
        // ── Settings › Learned skills: what Kaby may do on its own with the skills it learns (docs/dev/learned-skills.md) ──
        try {
          slots.inject('settings.section', () => slots.register(
            { name: 'settings.section', id: 'kybernos-skills-learned', order: 26.5, label: () => t('ls.nav') },
            (props) => {
              try { return h(KbSettingsBoundary, props, h(LearnedSettingsPage, props)) } catch (e) { return null }
            }))
        } catch (kbLearnedSettingsError) {
          try { console.warn('[kybernos-skills] learned settings section not mounted', kbLearnedSettingsError) } catch (e2) { /* console gone */ }
        }
        // ── above the composer: « you ask for this again » (a chat that has begun) and the weekly card (a blank chat) ──
        try {
          const mountDock = () => {
            slots.inject('conversation.input.dock', () => slots.register({ name: 'conversation.input.dock', id: 'kybernos-skills-learned-notice', order: 22 }, LearnedNotice))
            slots.inject('conversation.input.dock', () => slots.register({ name: 'conversation.input.dock', id: 'kybernos-skills-learned-week', order: 18 }, LearnedWeek))
          }
          if (typeof ctx.effect === 'function') ctx.effect(mountDock, 'kybernos-skills: notice and weekly cards above the composer')
          else mountDock()
        } catch (kbDockError) {
          try { console.warn('[kybernos-skills] dock cards not mounted', kbDockError) } catch (e2) { /* console gone */ }
        }
        // ── at the end of the last answer: what Kaby suggested or applied from THIS chat (the card draws nothing when there is none) ──
        try {
          const mountTail = () => slots.inject('conversation.chat.turnTail', () => slots.register(
            { name: 'conversation.chat.turnTail', id: 'kybernos-skills-learned-tail', order: 62 }, LearnedTail))
          if (typeof ctx.effect === 'function') ctx.effect(mountTail, 'kybernos-skills: learned skills card in the chat')
          else mountTail()
        } catch (kbTailError) {
          try { console.warn('[kybernos-skills] chat card not mounted', kbTailError) } catch (e2) { /* console gone */ }
        }
      }

      return {
        inject: ['slots'],
        apply(ctx) { apply(ctx) }
      }
    } catch (kbBootError) {
      try {
        console.error('[kybernos-skills] chargement impossible — plugin desactive, GUI preservee', kbBootError)
      } catch (e2) { /* console unavailable */ }
      return { apply() { /* plugin disabled after a load error */ } }
    }
  },
})
