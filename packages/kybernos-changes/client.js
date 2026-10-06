// kybernos-changes — browser half.
//
// One chip under the composer that says where this chat's work stands and what to do next, in plain words:
// changed → saved → on GitHub → in the project. A switch (Simple / Developer) adds the branch, the gap with
// GitHub and the exact git commands. It replaces the four git pills of @local/kybernos-sessions (local, recap,
// GitHub, review) while it is active, and says the same thing as they do: it reads the SAME facts through
// `window.__KB_SESSIONS_VIEW__` (published by the sessions client) and runs the SAME actions through the routes
// of @local/kybernos-sessions (dry run first, then confirm). Nothing here talks to git or GitHub itself.
//
// Without the sessions seam (an older sessions bundle) or while its state route is silent, this plugin shows
// nothing and does NOT silence the pills: the four pills stay.
//
// Loaded through window.__ModuleLoader__.load. The factory must RETURN a plugin object; on any evaluation error a
// disabled one is returned, so the GUI is preserved.
window.__ModuleLoader__.load({
  id: '@local/kybernos-changes',
  factory (require) {
    try {
      const React = require('react')
      const h = React.createElement

      // ── language: French is the source, English the pair; a translated language is looked up by its French text ──
      const lang = () => {
        try { return String(typeof window.__KB_LANG_RESOLVE__ === 'function' ? window.__KB_LANG_RESOLVE__() : (document.documentElement.lang || 'en')) } catch (e) { return 'en' }
      }
      const kt = (fr, en) => {
        const l = lang()
        if (l === 'kybernos' || l.slice(0, 2) === 'fr') return fr
        if (l === 'en') return en
        try {
          const a = window.__KB_I18N_ACTIVE__
          if (a !== null && a !== undefined && a.dict !== null && typeof a.dict === 'object' && typeof a.dict[fr] === 'string') return a.dict[fr]
        } catch (e) { /* no dictionary: English */ }
        return en
      }
      const fill = (text, p) => (p === undefined ? text : text.replace(/\{(\w+)\}/g, (m, k) => (p[k] !== undefined ? String(p[k]) : m)))
      // [fr, en] pairs, by key. Kept in ONE table so that a test can check both sides of every pair.
      const S = {
        title: ['Suivi des changements', 'Changes'],
        close: ['Fermer', 'Close'],
        chipOk: ['Tout est sauvegardé', 'Everything is saved'],
        chipUnsaved1: ['1 fichier à sauvegarder', '1 file to save'],
        chipUnsavedN: ['{n} fichiers à sauvegarder', '{n} files to save'],
        chipToSend: ['Sauvegardé · pas en ligne', 'Saved · not online'],
        chipNotInProject: ['Sauvegardé · pas dans le projet', 'Saved · not in the project'],
        chipReadyReview: ['Prêt à être relu', 'Ready for review'],
        chipChecks: ['GitHub vérifie votre travail', 'GitHub is checking your work'],
        chipWaiting: ['En attente de relecture', 'Waiting for review'],
        chipChanges: ['Des changements sont demandés', 'Changes were asked'],
        chipCheckFailed: ['Un contrôle a échoué', 'A check failed'],
        chipReadyMerge: ['Validé · prêt à intégrer', 'Approved · ready to merge'],
        chipMerged: ['Intégré au projet', 'In the project'],
        chipFetch: ['GitHub a du nouveau', 'GitHub has news'],
        chipSync: ['À synchroniser', 'Needs syncing'],
        chipConflict: ['Un conflit bloque', 'A conflict blocks'],
        chipElsewhere: ['Rien à sauvegarder ici', 'Nothing to save here'],

        tUnsaved1: ['1 fichier de cette conversation n’est pas sauvegardé', '1 file from this chat is not saved'],
        tUnsavedN: ['{n} fichiers de cette conversation ne sont pas sauvegardés', '{n} files from this chat are not saved'],
        xUnsaved: ['Si l’ordinateur plante, ces changements sont perdus.', 'If the computer crashes, these changes are lost.'],
        xUnsavedShared: [' Le dossier est partagé avec {m} autre(s) conversation(s) : seuls les fichiers de celle-ci seront sauvegardés.', ' The folder is shared with {m} other chat(s): only this chat’s files will be saved.'],
        tToSend: ['Pas encore en ligne', 'Not online yet'],
        xToSend: ['Votre projet a {n} mise(s) à jour que GitHub n’a pas. Les envoyer garde une copie en lieu sûr.', 'Your project has {n} update(s) GitHub does not have. Sending them keeps a safe copy.'],
        xToSendCopy: ['Le projet principal a {n} mise(s) à jour que GitHub n’a pas. Votre copie séparée reste sur votre ordinateur (c’est normal).', 'The main project has {n} update(s) GitHub does not have. Your separate copy stays on your computer (that is normal).'],
        tSync: ['Vous et GitHub avez chacun du nouveau', 'You and GitHub both have news'],
        xSync: ['{n} à envoyer, {m} à récupérer. On récupère d’abord, puis on envoie.', '{n} to send, {m} to fetch. We fetch first, then send.'],
        tNotInProject: ['Sauvegardé, mais pas encore dans le projet', 'Saved, but not in the project yet'],
        xNotInProject: ['Votre copie séparée est en sécurité, mais les autres conversations ne la voient pas encore.', 'Your separate copy is safe, but other chats cannot see it yet.'],
        tReadyReview: ['Prêt à être relu', 'Ready for review'],
        xReadyReview: ['Votre travail est sur votre copie. Demandez à quelqu’un de le relire avant qu’il entre dans le projet.', 'Your work is in your copy. Ask someone to review it before it goes into the project.'],
        tChecks: ['GitHub vérifie votre travail', 'GitHub is checking your work'],
        xChecks: ['Des tests automatiques tournent. Cela prend en général quelques minutes.', 'Automatic tests are running. This usually takes a few minutes.'],
        tWaiting: ['En attente de l’accord d’un collègue', 'Waiting for a teammate’s OK'],
        xWaiting: ['Les contrôles sont passés. Quelqu’un doit maintenant relire votre travail et l’approuver.', 'The checks passed. Someone now has to look at your work and approve it.'],
        tChanges: ['Des changements sont demandés', 'Changes were asked'],
        xChanges: ['Un collègue a laissé des commentaires. Demandez à l’agent de les traiter, puis GitHub revérifie.', 'A teammate left comments. Ask the agent to address them, then GitHub checks again.'],
        tCheckFailed: ['Un contrôle automatique a échoué', 'An automatic check failed'],
        xCheckFailed: ['GitHub a testé votre travail et un test n’est pas passé. Demandez à l’agent de regarder.', 'GitHub tested your work and one test did not pass. Ask the agent to look at it.'],
        tReadyMerge: ['Validé, prêt à être intégré', 'Approved, ready to merge'],
        xReadyMerge: ['Les contrôles passent et un collègue a approuvé. Vous pouvez l’ajouter au projet.', 'The checks pass and a teammate approved. You can add it to the project.'],
        tMerged: ['Votre travail est dans le projet', 'Your work is in the project'],
        xMerged: ['La relecture est finie et GitHub a votre travail. Récupérez la mise à jour pour la voir sur votre ordinateur.', 'The review is done and GitHub has your work. Fetch the update to see it on your computer.'],
        tFetch: ['GitHub a du nouveau', 'GitHub has news'],
        xFetch: ['{n} mise(s) à jour sont arrivées en ligne. Récupérez-les pour rester à jour.', '{n} update(s) arrived online. Fetch them to stay up to date.'],
        tConflict: ['Des fichiers sont en conflit', 'Some files are in conflict'],
        xConflict: ['Quelqu’un a modifié les mêmes lignes. Il faut choisir quelle version garder : demandez à l’agent de vous aider à résoudre.', 'Someone changed the same lines. A version has to be chosen: ask the agent to help you resolve it.'],
        tElsewhere: ['Rien à sauvegarder pour cette conversation', 'Nothing to save for this chat'],
        xElsewhere: ['Le dossier a {n} fichier(s) modifié(s), mais ils viennent d’autres conversations. Le travail de celle-ci est sauvegardé.', 'The folder has {n} changed file(s), but they come from other chats. This chat’s work is saved.'],
        tOk: ['Tout est sauvegardé', 'Everything is saved'],
        xOk: ['Rien à faire pour le moment.', 'Nothing to do right now.'],
        xOkCopy: ['Votre copie est identique au projet : vous pouvez la fermer.', 'Your copy is identical to the project: you can close it.'],

        stepChanged: ['Modifié', 'Changed'],
        stepSaved: ['Sauvegardé', 'Saved'],
        stepOnline: ['Sur GitHub', 'On GitHub'],
        stepProject: ['Dans le projet', 'In the project'],
        stepsAria: ['Étapes du travail', 'Steps of the work'],

        files: ['Fichiers', 'Files'],
        fileMore: ['… et {n} autre(s)', '… and {n} more'],
        otherChat: ['autre conversation', 'other chat'],
        kModified: ['modifié', 'modified'], kNew: ['nouveau', 'new'], kDeleted: ['supprimé', 'deleted'], kRenamed: ['renommé', 'renamed'], kConflict: ['en conflit', 'conflict'],

        aSave: ['Sauvegarder mon travail', 'Save my work'],
        hSave: ['Sauvegarde les fichiers de cette conversation et les envoie sur GitHub. Les fichiers des autres conversations ne sont pas touchés.', 'Saves this chat’s files and sends them to GitHub. Other chats’ files are left alone.'],
        aSaveLocal: ['Sauvegarder sur cet ordinateur seulement', 'Save on this computer only'],
        hSaveLocal: ['Rien n’est envoyé sur Internet.', 'Nothing is sent to the internet.'],
        aAddToProject: ['Ajouter au projet (sur cet ordinateur)', 'Add to the project (on this computer)'],
        hAddToProject: ['Votre copie séparée est combinée à la version principale, sur cet ordinateur.', 'Your separate copy is combined with the main version, on this computer.'],
        aPush: ['Envoyer sur GitHub', 'Send to GitHub'],
        hPush: ['Met une copie en ligne. Rien ne change pour vous.', 'Puts a copy online. Nothing changes for you.'],
        aFetch: ['Récupérer les nouveautés', 'Get the latest'],
        hFetch: ['Votre propre travail n’est pas touché.', 'Your own work is not touched.'],
        aSync: ['Récupérer, puis envoyer', 'Get the latest, then send'],
        hSync: ['Votre travail n’est pas perdu.', 'Your work is not lost.'],
        aAskReview: ['Demander une relecture', 'Ask for a review'],
        hAskReview: ['Ouvre une demande que l’équipe peut lire et valider. Vous pouvez continuer à travailler.', 'Opens a request the team can read and approve. You can keep working.'],
        aMerge: ['Intégrer au projet (sur GitHub)', 'Add to the project (on GitHub)'],
        hMerge: ['Le projet reçoit votre travail. C’est visible de toute l’équipe.', 'The project gets your work. The whole team sees it.'],
        aIsolate: ['Donner à cette conversation sa propre copie', 'Give this chat its own copy'],
        hIsolate: ['Crée une copie séparée sur une nouvelle branche, pour ne plus marcher sur les autres conversations.', 'Creates a separate copy on a new branch, so chats stop stepping on each other.'],
        aCloseCopy: ['Fermer cette copie', 'Close this copy'],
        hCloseCopy: ['La combine avec le projet, puis la supprime. Refusé s’il reste du travail non sauvegardé.', 'Combines it with the project, then removes it. Refused if unsaved work remains.'],

        checking: ['Vérification…', 'Checking…'],
        running: ['En cours…', 'Working…'],
        before: ['Avant de continuer', 'Before going on'],
        commands: ['Commandes exactes', 'Exact commands'],
        msgLabel: ['Décrivez en une ligne ce que vous avez fait (facultatif)', 'Describe in one line what you did (optional)'],
        confirm: ['Confirmer', 'Confirm'],
        confirmRun: ['Confirmer et exécuter', 'Confirm and run'],
        back: ['Retour', 'Back'],
        done: ['Fait ✓', 'Done ✓'],
        failed: ['Impossible pour le moment', 'Not possible right now'],
        openPr: ['Voir la demande sur GitHub ↗', 'See the request on GitHub ↗'],

        view: ['Affichage', 'View'],
        simple: ['Simple', 'Simple'],
        developer: ['Développeur', 'Developer'],
        branch: ['Branche', 'Branch'],
        gap: ['Écart', 'Gap'],
        gapNote: ['(à envoyer · à récupérer)', '(to send · to fetch)'],
        folder: ['Dossier', 'Folder'],
        copy: ['Copie isolée', 'Isolated copy'],
        remote: ['Origine', 'Origin'],
        lastFetch: ['Dernière vérification', 'Last checked'],
        chats: ['Autres conversations', 'Other chats'],
        none: ['aucune', 'none'],
        never: ['jamais', 'never']
      }
      const L = (key, p) => {
        const pair = S[key]
        if (pair === undefined) return String(key)
        return fill(kt(pair[0], pair[1]), p)
      }

      // ── the pure part: what the facts mean ─────────────────────────────────────────────────────────────────
      // `f` comes from window.__KB_SESSIONS_VIEW__.read(): git, unsaved, files, ahead/behind, notMerged, pr,
      // conflicts, isolated, sharedWith and `actions` (by role). The result is a state, not text.
      const classify = (f) => {
        if (f === null || f === undefined || f.git !== true) return null
        const has = (r) => f.actions !== null && f.actions !== undefined && f.actions[r] !== undefined
        const out = (o) => Object.assign({ tone: 'ok', reached: 3, done: false, wait: false, bad: false, primary: null, secondary: [] }, o)
        if (f.conflicts > 0) return out({ key: 'conflict', tone: 'err', reached: 1, bad: true })
        if (f.unsaved > 0) {
          const primary = has('save') ? 'save' : (has('saveLocal') ? 'saveLocal' : null)
          return out({ key: 'unsaved', tone: 'warn', reached: 0, primary, secondary: primary === 'save' && has('saveLocal') ? ['saveLocal'] : [] })
        }
        const pr = f.pr
        if (pr !== null && pr !== undefined && pr.state === 'open') {
          if (pr.checks === 'fail') return out({ key: 'prFail', tone: 'err', reached: 2, bad: true })
          if (pr.review === 'changes_requested') return out({ key: 'prChanges', tone: 'warn', reached: 2, bad: true })
          if (pr.checks === 'running') return out({ key: 'prChecks', tone: 'info', reached: 2, wait: true })
          if (!(pr.checks === 'pass' && pr.review === 'approved')) return out({ key: 'prWaiting', tone: 'info', reached: 2, wait: true })
          return out({ key: 'prReady', tone: 'ok', reached: 2, primary: has('merge') ? 'merge' : null })
        }
        if (pr !== null && pr !== undefined && pr.state === 'merged') return out({ key: 'prMerged', tone: 'ok', reached: 3, done: true, primary: has('fetch') ? 'fetch' : null })
        if (f.ahead > 0 && f.behind > 0) return out({ key: 'sync', tone: 'warn', reached: 1, primary: has('sync') ? 'sync' : null })
        if (f.ahead > 0) return out({ key: 'toSend', tone: 'info', reached: 1, primary: has('push') ? 'push' : null })
        if (f.notMerged > 0) return out({ key: 'notInProject', tone: 'info', reached: 1, primary: has('addToProject') ? 'addToProject' : (has('saveLocal') ? 'saveLocal' : null), secondary: has('askReview') ? ['askReview'] : [] })
        if (has('askReview')) return out({ key: 'readyReview', tone: 'info', reached: 2, primary: 'askReview' })
        if (f.behind > 0) return out({ key: 'toFetch', tone: 'info', reached: 3, done: true, primary: has('fetch') ? 'fetch' : null })
        if (f.folderDirty > 0 && f.sharedWith > 0) return out({ key: 'elsewhere', tone: 'info', reached: 3, done: true, secondary: has('isolate') ? ['isolate'] : [] })
        return out({ key: 'ok', tone: 'ok', reached: 3, done: true, primary: has('closeCopy') ? 'closeCopy' : null })
      }
      // [chip, title, text] per state key — the words are looked up at render, so a language switch shows at once.
      const wording = (m, f) => {
        const n = f.unsaved
        switch (m.key) {
          case 'unsaved': return [n === 1 ? L('chipUnsaved1') : L('chipUnsavedN', { n }), n === 1 ? L('tUnsaved1') : L('tUnsavedN', { n }), L('xUnsaved') + (f.sharedWith > 0 ? L('xUnsavedShared', { m: f.sharedWith }) : '')]
          case 'toSend': return [L('chipToSend'), L('tToSend'), L(f.isolated ? 'xToSendCopy' : 'xToSend', { n: f.ahead })]
          case 'sync': return [L('chipSync'), L('tSync'), L('xSync', { n: f.ahead, m: f.behind })]
          case 'notInProject': return [L('chipNotInProject'), L('tNotInProject'), L('xNotInProject')]
          case 'readyReview': return [L('chipReadyReview'), L('tReadyReview'), L('xReadyReview')]
          case 'prChecks': return [L('chipChecks'), L('tChecks'), L('xChecks')]
          case 'prWaiting': return [L('chipWaiting'), L('tWaiting'), L('xWaiting')]
          case 'prChanges': return [L('chipChanges'), L('tChanges'), L('xChanges')]
          case 'prFail': return [L('chipCheckFailed'), L('tCheckFailed'), L('xCheckFailed')]
          case 'prReady': return [L('chipReadyMerge'), L('tReadyMerge'), L('xReadyMerge')]
          case 'prMerged': return [L('chipMerged'), L('tMerged'), L('xMerged')]
          case 'toFetch': return [L('chipFetch'), L('tFetch'), L('xFetch', { n: f.behind })]
          case 'conflict': return [L('chipConflict'), L('tConflict'), L('xConflict')]
          case 'elsewhere': return [L('chipElsewhere'), L('tElsewhere'), L('xElsewhere', { n: f.folderDirty })]
          default: return [L('chipOk'), L('tOk'), L(f.isolated && f.actions && f.actions.closeCopy ? 'xOkCopy' : 'xOk')]
        }
      }
      // Per role: label key, hint key, and the git word a developer knows it by.
      const ROLES = {
        save: ['aSave', 'hSave', 'commit + push'],
        saveLocal: ['aSaveLocal', 'hSaveLocal', 'commit + merge (local)'],
        addToProject: ['aAddToProject', 'hAddToProject', 'merge'],
        push: ['aPush', 'hPush', 'push'],
        fetch: ['aFetch', 'hFetch', 'fetch'],
        sync: ['aSync', 'hSync', 'fetch + push'],
        askReview: ['aAskReview', 'hAskReview', 'pull request'],
        merge: ['aMerge', 'hMerge', 'merge (GitHub)'],
        isolate: ['aIsolate', 'hIsolate', 'worktree'],
        closeCopy: ['aCloseCopy', 'hCloseCopy', 'merge + remove worktree']
      }
      const KIND_KEY = { modified: 'kModified', new: 'kNew', deleted: 'kDeleted', renamed: 'kRenamed', conflict: 'kConflict' }
      const STEP_KEYS = ['stepChanged', 'stepSaved', 'stepOnline', 'stepProject']
      // The four nodes of the stepper: done / current / waiting / blocked / todo.
      const stepStates = (m) => STEP_KEYS.map((k, i) => {
        if (m.done || i < m.reached) return 'done'
        if (i === m.reached) return m.bad ? 'bad' : (m.wait ? 'wait' : 'now')
        return 'todo'
      })

      // ── styles (prefix kbch-: checked against every other bundle by test-client.mjs) ───────────────────────────
      const CSS = `
.kbch-wrap{position:relative;display:inline-flex;max-width:100%}
.kbch-chip{appearance:none;display:inline-flex;align-items:center;gap:7px;height:24px;max-width:100%;padding:0 10px 0 8px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:24px;background:transparent;color:var(--dsw-alias-label-secondary,#cfd3d6);font:inherit;font-size:12.5px;font-weight:500;line-height:1;cursor:pointer;white-space:nowrap}
.kbch-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.kbch-chip:focus-visible{outline:2px solid var(--kbch-c);outline-offset:1px}
.kbch-chip[aria-expanded="true"]{border-color:var(--dsw-alias-border-l3,rgba(255,255,255,.2));background:var(--dsw-alias-bg-layer-3,#353638);color:var(--dsw-alias-label-primary,#f9fafb)}
.kbch-txt{overflow:hidden;text-overflow:ellipsis}
.kbch-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--kbch-c);box-shadow:0 0 0 3px color-mix(in srgb,var(--kbch-c) 16%,transparent)}
.kbch-ok{--kbch-c:var(--dsw-alias-state-success-primary,#22c55e)}
.kbch-warn{--kbch-c:var(--dsw-alias-state-warn-primary,#f59e0b)}
.kbch-info{--kbch-c:var(--dsw-alias-state-business-primary,#7aaaff)}
.kbch-err{--kbch-c:var(--dsw-alias-state-error-primary,#f25a5a)}
.kbch-card{box-sizing:border-box;position:absolute;left:0;bottom:calc(100% + 10px);z-index:70;width:min(380px,calc(100vw - 24px));max-height:min(560px,calc(100vh - 180px));overflow-y:auto;text-align:left;font-size:14px;padding:12px 18px 14px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:18px;color:var(--dsw-alias-label-primary,#f9fafb);background:linear-gradient(var(--dsw-specific-menu,#1c1c1f),var(--dsw-specific-menu,#1c1c1f)),var(--dsw-alias-bg-base,#151517);box-shadow:0 16px 44px rgba(0,0,0,.42)}
.kbch-hd{display:flex;align-items:center;gap:8px;min-height:30px;font-size:12.5px;color:var(--dsw-alias-label-tertiary,#adb2b8)}
.kbch-hd b{flex:1;font-weight:500}
.kbch-x{width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary,#adb2b8);cursor:pointer;display:grid;place-items:center;padding:0;margin-right:-8px}
.kbch-x:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.kbch-h{margin:8px 0 4px;font-size:18px;font-weight:700;line-height:1.25;text-wrap:balance}
.kbch-p{margin:0;font-size:14px;line-height:1.45;color:var(--dsw-alias-label-secondary,#cfd3d6);text-wrap:pretty}
.kbch-steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:16px 0 4px}
.kbch-stp{position:relative;display:flex;flex-direction:column;align-items:center;gap:5px;font-size:11.5px;text-align:center;color:var(--dsw-alias-label-tertiary,#adb2b8)}
.kbch-stp::before{content:"";position:absolute;top:9px;left:-50%;width:100%;height:2.5px;background:var(--dsw-alias-border-l2,rgba(255,255,255,.12))}
.kbch-stp:first-child::before{display:none}
.kbch-stp i{position:relative;z-index:1;width:20px;height:20px;border-radius:50%;box-sizing:border-box;display:grid;place-items:center;border:2px solid var(--dsw-alias-border-l3,rgba(255,255,255,.2));background:var(--dsw-alias-bg-layer-2,#2c2c2e)}
.kbch-stp.done i{background:var(--dsw-alias-state-success-primary,#22c55e);border-color:var(--dsw-alias-state-success-primary,#22c55e);color:var(--dsw-alias-label-primary-foreground,#0f1115)}
.kbch-stp.done::before{background:var(--dsw-alias-state-success-primary,#22c55e)}
.kbch-stp.now i{border-color:var(--dsw-alias-state-business-primary,#7aaaff)}
.kbch-stp.wait i{border-color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.kbch-stp.bad i{border-color:var(--dsw-alias-state-error-primary,#f25a5a)}
.kbch-stp.now,.kbch-stp.wait,.kbch-stp.bad{color:var(--dsw-alias-label-primary,#f9fafb);font-weight:600}
.kbch-files{margin:12px 0 0;padding:0;list-style:none;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07))}
.kbch-files li{display:flex;gap:8px;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07));font-size:13px}
.kbch-fn{flex:1;min-width:0;overflow-wrap:anywhere}
.kbch-fs{color:var(--dsw-alias-label-tertiary,#adb2b8);font-size:12px;white-space:nowrap}
.kbch-act{margin-top:14px;display:grid;gap:6px}
.kbch-go{width:100%;height:40px;border:0;border-radius:12px;background:var(--dsw-alias-button-primary-fill,#f9fafb);color:var(--dsw-alias-label-primary-foreground,#0f1115);font:inherit;font-size:14.5px;font-weight:600;cursor:pointer;padding:0 14px}
.kbch-go:hover:not(:disabled){filter:brightness(.93)}
.kbch-go:disabled{opacity:.5;cursor:wait}
.kbch-git{font:400 11.5px ui-monospace,Menlo,monospace;opacity:.65;margin-left:6px}
.kbch-why{margin:0;font-size:12.5px;line-height:1.4;text-align:center;color:var(--dsw-alias-label-tertiary,#adb2b8)}
.kbch-row2{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:8px}
.kbch-btn{appearance:none;height:28px;padding:0 11px;border-radius:14px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.2));background:transparent;color:var(--dsw-alias-label-primary,#f9fafb);font:inherit;font-size:12.5px;cursor:pointer}
.kbch-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.kbch-btn.quiet{border-color:transparent;color:var(--dsw-alias-label-tertiary,#adb2b8)}
.kbch-btn.primary{background:var(--dsw-alias-button-primary-fill,#f9fafb);color:var(--dsw-alias-label-primary-foreground,#0f1115);border-color:transparent;font-weight:600}
.kbch-box{margin-top:12px;padding:12px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:12px;background:var(--dsw-alias-bg-layer-1,#232324);display:grid;gap:8px}
.kbch-box label{font-size:12.5px;color:var(--dsw-alias-label-tertiary,#adb2b8)}
.kbch-box input{width:100%;box-sizing:border-box;height:34px;border-radius:10px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.2));background:var(--dsw-alias-bg-base,#151517);color:var(--dsw-alias-label-primary,#f9fafb);padding:0 10px;font:inherit;font-size:13.5px}
.kbch-cmd{display:block;font:11.5px/1.7 ui-monospace,Menlo,monospace;background:var(--dsw-alias-bg-layer-3,#353638);border-radius:6px;padding:1px 8px;color:var(--dsw-alias-label-secondary,#cfd3d6);overflow-wrap:anywhere}
.kbch-err-t{margin:0;font-size:12.5px;line-height:1.45;color:var(--dsw-alias-state-error-primary,#f25a5a);overflow-wrap:anywhere}
.kbch-ok-t{margin:6px 0 0;font-size:12.5px;color:var(--dsw-alias-state-success-primary,#22c55e)}
.kbch-dev{margin-top:12px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07));display:grid;gap:8px}
.kbch-kv{display:grid;grid-template-columns:96px minmax(0,1fr);gap:8px;margin:0;font-size:12.5px;line-height:1.45}
.kbch-kv dt{color:var(--dsw-alias-label-tertiary,#adb2b8)}
.kbch-kv dd{margin:0;overflow-wrap:anywhere}
.kbch-kv code{font:12px ui-monospace,Menlo,monospace}
.kbch-mode{display:flex;align-items:center;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07));font-size:12.5px;color:var(--dsw-alias-label-tertiary,#adb2b8)}
.kbch-mode .sp{flex:1}
.kbch-seg{display:inline-flex;padding:2px;gap:2px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:999px}
.kbch-seg button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#adb2b8);height:24px;padding:0 10px;border-radius:999px;font:inherit;font-size:12px;cursor:pointer}
.kbch-seg button[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-3,#353638);color:var(--dsw-alias-label-primary,#f9fafb);font-weight:600}
.kbch-link{color:var(--dsw-alias-state-business-primary,#7aaaff);font-size:12.5px;text-decoration:none}
.kbch-link:hover{text-decoration:underline}
html[dir="rtl"] .kbch-card{left:auto;right:0;text-align:right}
@media (prefers-reduced-motion:reduce){.kbch-chip{transition:none}}
`
      let cssPlaced = false
      const placeCss = () => {
        if (cssPlaced || typeof document === 'undefined') return
        cssPlaced = true
        try {
          if (document.getElementById('kbch-style') !== null) return
          const el = document.createElement('style')
          el.id = 'kbch-style'
          el.textContent = CSS
          document.head.appendChild(el)
        } catch (e) { /* no DOM */ }
      }

      // ── the preference: Simple or Developer, remembered ───────────────────────────────────────────────────────
      const MODE_KEY = 'kybernos.changes.mode'
      const readMode = () => { try { return localStorage.getItem(MODE_KEY) === 'dev' ? 'dev' : 'simple' } catch (e) { return 'simple' } }
      const writeMode = (m) => { try { localStorage.setItem(MODE_KEY, m) } catch (e) { /* storage unavailable */ } }

      // The pills of @local/kybernos-sessions step aside once this chip is on screen.
      const announce = () => {
        try {
          if (window.__KB_CHANGES_ACTIVE__ !== true) {
            window.__KB_CHANGES_ACTIVE__ = true
            window.dispatchEvent(new Event('kybernos-changes-active'))
          }
        } catch (e) { /* no window */ }
      }
      const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())
      const ago = (iso) => {
        if (typeof iso !== 'string' || iso === '') return L('never')
        try { return new Date(iso).toLocaleString() } catch (e) { return iso }
      }
      const tick = h('svg', { width: 11, height: 11, viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, 'aria-hidden': 'true' }, h('path', { d: 'M2.5 6.5 5 9l4.5-5.5' }))
      const cross = h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': 'true' }, h('path', { d: 'M4 4l8 8M12 4l-8 8' }))

      // ── the component ──────────────────────────────────────────────────────────────────────────────────────────
      function Changes ({ sessionId }) {
        const [facts, setFacts] = React.useState(undefined) // undefined: not read yet · null: unavailable · object
        const [open, setOpen] = React.useState(false)
        const [mode, setMode] = React.useState(readMode)
        const [run, setRun] = React.useState(null) // { role, phase: plan|confirm|running|done|error, plan, error, message }
        const [msg, setMsg] = React.useState('')
        const [, setLangTick] = React.useState(0)
        const [shift, setShift] = React.useState(0) // how far the card is pulled left so that it stays inside the window
        const alive = React.useRef(true)
        const wrap = React.useRef(null)

        const load = React.useCallback(async () => {
          const view = typeof window !== 'undefined' ? window.__KB_SESSIONS_VIEW__ : undefined
          if (view === undefined || view === null || typeof view.read !== 'function') { if (alive.current) setFacts(null); return }
          try {
            const f = await view.read(sessionId)
            if (alive.current) setFacts(f === undefined ? null : f)
          } catch (e) { if (alive.current) setFacts(null) }
        }, [sessionId])
        React.useEffect(() => {
          alive.current = true
          placeCss()
          load()
          const t = setInterval(load, 30000)
          const lg = () => setLangTick((n) => n + 1)
          window.addEventListener('kybernos-lang-change', lg)
          return () => { alive.current = false; clearInterval(t); window.removeEventListener('kybernos-lang-change', lg) }
        }, [load])
        const usable = facts !== undefined && facts !== null
        React.useEffect(() => { if (usable) announce() }, [usable])
        // Escape and a click elsewhere close the card.
        React.useEffect(() => {
          if (!open) return undefined
          // In capture, and only while the card is open: Escape closes the card and nothing else (the chat may stop a reply on it).
          const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
          const away = (e) => { if (wrap.current !== null && !wrap.current.contains(e.target)) setOpen(false) }
          window.addEventListener('keydown', esc, true)
          document.addEventListener('mousedown', away)
          return () => { window.removeEventListener('keydown', esc, true); document.removeEventListener('mousedown', away) }
        }, [open])

        // The card opens above the chip, flush with its left edge: in a narrow window it would run out on the right.
        React.useEffect(() => {
          if (!open) return undefined
          const place = () => {
            if (wrap.current === null) return
            const r = wrap.current.getBoundingClientRect()
            const w = Math.min(380, window.innerWidth - 24)
            const over = r.left + w - (window.innerWidth - 12)
            setShift(over > 0 ? Math.min(over, Math.max(0, r.left - 12)) : 0)
          }
          place()
          window.addEventListener('resize', place)
          return () => window.removeEventListener('resize', place)
        }, [open])

        const m = usable ? classify(facts) : null
        if (!usable || m === null) return null
        const words = wording(m, facts)
        const dev = mode === 'dev'
        const toggle = () => { if (!open) load(); setOpen(!open) }
        const setViewMode = (v) => { setMode(v); writeMode(v) }

        const actionOf = (role) => (facts.actions || {})[role]
        const begin = async (role) => {
          const d = actionOf(role)
          if (d === undefined) return
          setRun({ role, phase: 'plan' })
          try {
            const plan = await post(d.url, Object.assign({}, d.corps, { exec: false }))
            if (plan !== null && typeof plan === 'object' && plan.ok === true) setRun({ role, phase: 'confirm', plan })
            else setRun({ role, phase: 'error', error: String((plan && (plan.erreur || plan.error)) || 'refused') })
          } catch (e) { setRun({ role, phase: 'error', error: String(e && e.message ? e.message : e) }) }
        }
        const confirm = async () => {
          const d = run !== null ? actionOf(run.role) : undefined
          if (d === undefined) return
          const role = run.role
          setRun({ role, phase: 'running', plan: run.plan })
          try {
            const body = Object.assign({}, d.corps, { exec: true })
            if ((role === 'save' || role === 'saveLocal') && msg.trim() !== '') body.message = msg.trim().slice(0, 200)
            const res = await post(d.url, body)
            if (res !== null && typeof res === 'object' && res.ok === true) {
              setRun({ role, phase: 'done', message: String(res.message || '') })
              setMsg('')
              load()
              setTimeout(load, 1500)
              setTimeout(() => { if (alive.current) setRun((r) => (r !== null && r.phase === 'done' ? null : r)) }, 6000)
            } else setRun({ role, phase: 'error', error: String((res && (res.erreur || res.error)) || 'refused') })
          } catch (e) { setRun({ role, phase: 'error', error: String(e && e.message ? e.message : e) }) }
        }
        const roleLabel = (role) => h(React.Fragment, null, L(ROLES[role][0]), dev ? h('span', { className: 'kbch-git' }, ROLES[role][2]) : null)

        // the files
        const files = Array.isArray(facts.files) ? facts.files : []
        const shown = files.slice(0, 8)
        const filesBlock = files.length === 0 ? null : h('ul', { className: 'kbch-files', 'aria-label': L('files'), 'data-kb': 'changes-files' },
          shown.map((f) => h('li', { key: f.path },
            h('span', { className: 'kbch-fn' }, f.path),
            h('span', { className: 'kbch-fs' }, [f.kind !== null && f.kind !== undefined && KIND_KEY[f.kind] !== undefined ? L(KIND_KEY[f.kind]) : null, f.mine === false ? L('otherChat') : null].filter(Boolean).join(' · ')))),
          files.length > shown.length ? h('li', { key: 'more' }, h('span', { className: 'kbch-fs' }, L('fileMore', { n: files.length - shown.length }))) : null)

        // the action area: nothing, the primary button, or the dry-run / confirm / result of the one in progress
        let action = null
        if (run !== null && (run.phase === 'confirm' || run.phase === 'running')) {
          const cmds = run.plan && Array.isArray(run.plan.commandes) ? run.plan.commandes : []
          const wantsMsg = run.role === 'save' || run.role === 'saveLocal'
          action = h('div', { className: 'kbch-box', 'data-kb': 'changes-confirm' },
            h('b', { style: { fontWeight: 600 } }, L('before')),
            wantsMsg ? h('div', { style: { display: 'grid', gap: 6 } }, h('label', { htmlFor: 'kbch-msg' }, L('msgLabel')), h('input', { id: 'kbch-msg', value: msg, maxLength: 200, onChange: (e) => setMsg(e.target.value) })) : null,
            dev && cmds.length > 0 ? h('div', { style: { display: 'grid', gap: 4 } }, h('span', { className: 'kbch-fs' }, L('commands')), cmds.map((c, i) => h('code', { key: i, className: 'kbch-cmd' }, c))) : h('div', { className: 'kbch-fs' }, L(ROLES[run.role][1])),
            h('div', { className: 'kbch-row2', style: { margin: 0, justifyContent: 'flex-start' } },
              h('button', { className: 'kbch-btn primary', type: 'button', 'data-act': 'confirm', disabled: run.phase === 'running', onClick: confirm }, run.phase === 'running' ? L('running') : (dev ? L('confirmRun') : L(ROLES[run.role][0]))),
              h('button', { className: 'kbch-btn quiet', type: 'button', 'data-act': 'back', disabled: run.phase === 'running', onClick: () => setRun(null) }, L('back'))))
        } else if (run !== null && run.phase === 'plan') {
          action = h('p', { className: 'kbch-why', 'data-kb': 'changes-checking' }, L('checking'))
        } else {
          const primary = m.primary
          action = h('div', { className: 'kbch-act' },
            primary !== null ? h('button', { className: 'kbch-go', type: 'button', 'data-act': 'primary', 'data-role': primary, onClick: () => begin(primary) }, roleLabel(primary)) : null,
            primary !== null ? h('p', { className: 'kbch-why' }, L(ROLES[primary][1])) : null,
            run !== null && run.phase === 'error' ? h('p', { className: 'kbch-err-t', role: 'alert', 'data-kb': 'changes-error' }, L('failed') + ' — ' + run.error) : null,
            run !== null && run.phase === 'done' ? h('p', { className: 'kbch-ok-t', role: 'status', 'data-kb': 'changes-done' }, L('done') + (run.message !== '' ? ' ' + run.message : '')) : null)
        }
        const secondary = (run !== null && (run.phase === 'confirm' || run.phase === 'running' || run.phase === 'plan')) ? [] : m.secondary
        const extra = h('div', { className: 'kbch-row2' },
          secondary.map((role) => h('button', { key: role, className: 'kbch-btn quiet', type: 'button', 'data-act': 'secondary', 'data-role': role, title: L(ROLES[role][1]), onClick: () => begin(role) }, roleLabel(role))),
          facts.pr && facts.pr.url ? h('a', { key: 'pr', className: 'kbch-link', href: facts.pr.url, target: '_blank', rel: 'noreferrer' }, L('openPr')) : null)

        const developer = !dev ? null : h('div', { className: 'kbch-dev', 'data-kb': 'changes-dev' },
          h('dl', { className: 'kbch-kv' },
            h('dt', null, L('branch')), h('dd', null, h('code', null, facts.branch || '—'), facts.base && facts.base !== facts.branch ? ' → ' : '', facts.base && facts.base !== facts.branch ? h('code', null, facts.base) : null),
            h('dt', null, L('gap')), h('dd', null, '↑' + facts.ahead + ' ↓' + facts.behind + ' ', h('span', { className: 'kbch-fs' }, L('gapNote'))),
            h('dt', null, L('folder')), h('dd', null, h('code', null, facts.folder || '—')),
            facts.isolated ? h('dt', null, L('copy')) : null, facts.isolated ? h('dd', null, h('code', null, facts.isolatedName)) : null,
            h('dt', null, L('remote')), h('dd', null, facts.remote ? h('code', null, facts.remote) : L('none')),
            h('dt', null, L('lastFetch')), h('dd', null, ago(facts.lastFetch)),
            h('dt', null, L('chats')), h('dd', null, facts.sharedWith > 0 ? String(facts.sharedWith) : L('none'))))

        const states = stepStates(m)
        return h('span', { className: 'kbch-wrap kbch-' + m.tone, ref: wrap, 'data-kb': 'changes', 'data-state': m.key },
          h('button', { className: 'kbch-chip', type: 'button', 'data-kb': 'changes-chip', 'aria-haspopup': 'dialog', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': 'kbch-card', title: words[1], onClick: toggle },
            h('span', { className: 'kbch-dot', 'aria-hidden': 'true' }),
            h('span', { className: 'kbch-txt' }, words[0])),
          open ? h('div', { className: 'kbch-card', id: 'kbch-card', role: 'dialog', 'aria-label': L('title'), 'data-kb': 'changes-card', style: shift > 0 && document.documentElement.dir !== 'rtl' ? { left: -shift } : undefined },
            h('div', { className: 'kbch-hd' }, h('span', { className: 'kbch-dot', 'aria-hidden': 'true' }), h('b', null, L('title')),
              h('button', { className: 'kbch-x', type: 'button', 'aria-label': L('close'), onClick: () => setOpen(false) }, cross)),
            h('h4', { className: 'kbch-h' }, words[1]),
            h('p', { className: 'kbch-p' }, words[2]),
            h('div', { className: 'kbch-steps', role: 'list', 'aria-label': L('stepsAria') },
              STEP_KEYS.map((k, i) => h('div', { key: k, className: 'kbch-stp ' + states[i], role: 'listitem', 'data-step': states[i] }, h('i', null, states[i] === 'done' ? tick : null), L(k)))),
            filesBlock,
            action,
            extra,
            developer,
            h('div', { className: 'kbch-mode' }, h('span', null, L('view')), h('span', { className: 'sp' }),
              h('div', { className: 'kbch-seg', role: 'group', 'aria-label': L('view') },
                h('button', { type: 'button', 'data-act': 'mode-simple', 'aria-pressed': dev ? 'false' : 'true', onClick: () => setViewMode('simple') }, L('simple')),
                h('button', { type: 'button', 'data-act': 'mode-dev', 'aria-pressed': dev ? 'true' : 'false', onClick: () => setViewMode('dev') }, L('developer'))))) : null)
      }

      return {
        name: 'kybernos-changes',
        inject: ['slots'],
        __test: { classify, wording, stepStates, ROLES, S, L, kt, readMode, writeMode, CSS, STEP_KEYS },
        apply (ctx) {
          // Before the sessions pills (order 5): the chip is the first thing on the row.
          ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register(
            { name: 'conversation.composer.dock', id: 'kybernos-changes', order: 4 },
            (props) => { try { return h(Changes, { sessionId: props !== null && props !== undefined ? props.sessionId : undefined }) } catch (e) { return null } }
          )), 'kybernos-changes: chip in the composer dock')
        }
      }
    } catch (error) {
      try { console.error('[kybernos-changes] load failed — plugin disabled, GUI preserved', error) } catch (e) { /* no console */ }
      return { apply () { /* disabled after a load error */ } }
    }
  }
})
