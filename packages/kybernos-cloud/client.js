// ── Kybernos Cloud — entrée de menu + carte profil (half client) ────────────
//
// Un bouton dans la barre du bas de la sidebar (slot `sidebar.footer.action`,
// à côté de Settings) qui ouvre une carte à trois états :
//   1. déconnecté  → « Connecter Kybernos Cloud » (device code flow) ;
//   2. appairage   → code à recopier + ouverture de la page d'activation ;
//   3. connecté    → profil (email, nom, plan, workspaces + nb de kybers,
//                    appareil, état de session) + rafraîchir / reconnecter /
//                    se déconnecter.
//
// Aucun secret ne transite ici : la carte ne parle qu'aux routes locales
// /kybernos-cloud/*, qui seules détiennent le jeton `kys-…` (fichier 0600,
// ~/.dsh/kybernos-cloud.json). Le mot de passe est saisi dans le NAVIGATEUR,
// sur la page servie par Kybernos — jamais ici.
window.__ModuleLoader__.load({
  id: '@local/kybernos-cloud',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    // Même contrat local que kybernos-plugin : insert(css) → disposer.
    const styles = (() => {
      const tags = new Set()
      return {
        insert(css) {
          if (typeof css !== 'string') throw new Error('styles.insert(css) needs a CSS string')
          const tag = document.createElement('style')
          tag.dataset.plugin = '@local/kybernos-cloud'
          tag.textContent = css
          document.head.append(tag)
          tags.add(tag)
          return () => { tags.delete(tag); tag.remove() }
        },
        get count() { return tags.size },
        dispose() { for (const tag of tags) tag.remove(); tags.clear() },
      }
    })()

    const DICT = {
      fr: {
        menu: 'Kybernos Cloud',
        subtitle: 'Connectez DSH à votre compte Kybernos.',
        connect: 'Connecter Kybernos Cloud',
        pairingTitle: 'Appairage en cours',
        pairingBody: 'Ouvrez la page d\'activation et confirmez le code : DSH se connectera tout seul.',
        openPage: 'Ouvrir la page d\'activation',
        copyCode: 'Copier le code',
        copied: 'Code copié',
        cancel: 'Annuler la demande',
        waiting: 'En attente de votre confirmation dans le navigateur…',
        connected: 'Connecté',
        email: 'Email',
        name: 'Nom',
        plan: 'Formule',
        // DSH parle déjà de « Teams » (AI Teams) : même mot ici, pas deux
        // vocabulaires pour la même chose.
        workspaces: 'Teams',
        kybers: 'kybers',
        // ── l'espace : la rangée du pied devient un sélecteur, et sa page ──
        spaceTitle: 'Espace de travail',
        wsSwitchTitle: 'Changer d\'espace',
        wsSwitchSub: 'switch',
        wsPageTitle: 'Mon espace',
        wsPrev: 'Espace précédent',
        wsNext: 'Espace suivant',
        wsNew: 'Nouvel espace',
        wsNewTitle: 'Créer un espace',
        wsNewName: 'Nom de l\'espace',
        wsNewCreate: 'Créer',
        wsNewHosted: 'Créer dans Kybernos',
        wsNewErr: 'La création a été refusée par le serveur.',
        profTitle: 'Profil',
        profCompte: 'Compte',
        profParrain: 'Parrainage',
        profApparence: 'Apparence',
        profSecurite: 'Sécurité',
        profDonnees: 'Données & confidentialité',
        profSupport: 'Support & légal',
        profLogout: 'Se déconnecter',
        refTitle: 'Parrainage',
        refCode: 'Votre code',
        refLink: 'Lien de parrainage',
        refCopy: 'Copier le lien',
        refCopied: 'Copié',
        refOpen: 'Voir dans Kybernos',
        refNone: 'Le parrainage n\'est pas disponible depuis ce poste.',
        appTitle: 'Apparence de DSH',
        appNote: 'Thème, accent et police se règlent dans Réglages ▸ Apparence (plugin Thème Kybernos).',
        appPack: 'Pack actuel',
        appFont: 'Police',
        appNone: 'défaut',
        secTitle: 'Sécurité',
        secNote: 'Cet appareil tient la session ; la déconnexion révoque le jeton côté serveur.',
        supTitle: 'Support & légal',
        supNote: 'Ces pages vivent dans Kybernos :',
        supSupport: 'Support',
        supPrivacy: 'Confidentialité',
        supTerms: 'Conditions',
        mobTitle: 'Télécharger l\'app mobile',
        mobScan: 'Scannez le code pour installer Kybernos sur votre téléphone.',
        mobSoon: 'Aperçu — le vrai lien arrivera avec l\'app.',
        wsSettingsTitle: 'Réglage de l\'espace',
        wsTabPlan: 'Plan',
        wsTabUsage: 'Usage',
        wsTabPeople: 'People',
        wsTabBilling: 'Billing',
        wsTabSync: 'Synchronisation',
        wsPlanLabel: 'FORMULE ACTUELLE',
        wsPlanPrice: '— par mois',
        wsPlanSummary: 'Ce que cet espace porte :',
        wsPlanVisible: 'espaces visibles depuis ce poste',
        wsViewUsage: 'Voir l\'usage',
        wsUsageTitle: 'Ce que ce poste sait de la consommation',
        wsUsageNote: 'Le détail (crédits, appels, plafond de l\'espace) vit dans Kybernos : ici on n\'affiche que ce qui est déjà descendu.',
        wsPeopleTitle: 'Qui travaille dans cet espace',
        wsPeopleNote: 'L\'annuaire et les invitations vivent dans Kybernos — DSH ne les lit pas et n\'en invente aucun.',
        wsBillingTitle: 'Paiement et factures',
        wsBillingNote: 'La facturation vit dans Kybernos : rien n\'est modifiable depuis cet écran.',
        wsOpenHosted: 'Ouvrir dans Kybernos',
        wsClose: 'Fermer',
        wsKybersOne: 'kyber',
        wsKybersMany: 'kybers',
        wsModelsOne: 'modèle',
        wsModelsMany: 'modèles',
        spaceSwitch: 'Changer d\'espace',
        spaceActive: 'Espace actif',
        spaceSetup: 'Réglage de la synchronisation',
        spaceAccount: 'Compte & appareils',
        spaceOpen: 'Ouvrir dans Kybernos',
        spaceMark: 'actif',
        spaceUnknown: 'Espace inconnu — rien n\'a été changé.',
        syncTitle: 'Synchronisation',
        // Fail-closed : tant que le serveur ne sert pas la politique, on le DIT
        // et les interrupteurs restent inertes (un interrupteur qui ne tient
        // rien serait un mensonge).
        syncNotServed: 'La politique de synchronisation n\'est pas encore servie par le serveur : les interrupteurs sont inactifs. Rien ne sort de cet espace en attendant.',
        syncPull: 'Recevoir',
        syncPush: 'Envoyer',
        syncOn: 'Activé',
        syncOff: 'Désactivé',
        syncMemorySpace: 'Mémoire d\'espace',
        syncMemorySpaceHint: 'Le savoir commun de l\'équipe — recevoir le descend, envoyer l\'enrichit.',
        syncMemoryKybers: 'Mémoire des kybers',
        syncMemoryKybersHint: 'Le savoir-faire d\'un rôle : une leçon suit le kyber, jamais le projet.',
        syncSends: 'Envois explicites',
        syncSendsHint: 'Artefacts et chats, un envoi à la fois, après un manifeste.',
        syncDownTitle: 'Ce qui peut descendre',
        syncUpTitle: 'Ce qui peut sortir',
        syncUnknown: 'à lire dès que le serveur sert la politique',
        syncNeverTitle: 'Ne sort jamais',
        syncNeverBody: 'Le contenu des fichiers et des dossiers, les chats en masse, les secrets et les chemins de la machine.',
        models: 'Modèles',
        modelsImport: 'Importer les modèles',
        modelsReimport: 'Réimporter',
        modelsImporting: 'Import…',
        modelsUnavailable: 'Aucun modèle importé',
        modelsNote: 'Modèles Kybernos LiteLLM (glm, deepseek…) importés automatiquement à la connexion, selon ta formule.',
        modelsWarn: 'Import partiel : la route provider n\'a pas pu être écrite dans les réglages — « Réimporter » réessaie.',
        modelsSyncFail: 'Resynchronisation impossible — réessaie.',
        // Chats DSH → webapp (annuaire de sessions, métadonnées seulement)
        chatsTitle: 'Chats DSH',
        chatsNote: 'Pousse la liste de tes sessions DSH (projet et date, jamais le contenu) vers Kybernos — la webapp affiche ensuite « Conversations DSH ».',
        chatsPush: 'Synchroniser les chats',
        chatsPushing: 'Envoi…',
        chatsLast: 'Dernier envoi',
        chatsFail: 'Envoi impossible — réessaie.',
        // Mémoire du compte (fonctionnalité cloud n°2)
        memoTitle: 'Mémoire du compte',
        memoNote: 'Tes souvenirs Kybernos : ils descendent du cloud à chaque tour et remontent quand tu m\'enseignes quelque chose. Rien n\'est écrit hors connexion.',
        memoEmpty: 'Aucun souvenir pour l\'instant. Dis-moi quelque chose de durable (« j\'habite à Paris ») ou ajoute-le ici.',
        memoLoading: 'Lecture des souvenirs…',
        memoFail: 'Souvenirs illisibles — réessaie.',
        memoPinned: 'épinglé',
        memoPin: 'Épingler',
        memoUnpin: 'Détacher',
        memoForget: 'Oublier',
        memoTeach: 'Ajouter un souvenir…',
        memoKindFact: 'fait',
        memoKindPreference: 'préférence',
        memoKindEvent: 'événement',
        memoKindPolicy: 'règle',
        memoAdd: 'Ajouter',
        memoAdded: 'Souvenir enregistré.',
        memoKybers: 'Kybers locaux → kybers cloud',
        memoKybersNote: 'Les leçons d\'un kyber local ne montent que s\'il est relié à un kyber cloud. Sans lien, rien n\'est poussé.',
        memoNoLink: 'non relié',
        memoLessons: 'Pousser les leçons',
        memoLessonsDry: 'Vérifier',
        memoLessonsNote: 'Rien n\'est écrit tant que tu n\'as pas confirmé : la vérification dit ce qui monterait.',
        memoLessonsDone: 'Leçons poussées',
        memoLessonsNone: 'Rien à pousser.',
        memoCapture: 'Dernière capture de fin de tour :',
        memoCaptureNothing: 'rien à retenir',
        memoCaptureUnknown: 'état inconnu',
        device: 'Appareil',
        session: 'Session',
        refresh: 'Rafraîchir',
        reconnect: 'Se reconnecter',
        disconnect: 'Se déconnecter',
        revokedTitle: 'Reconnexion requise',
        revokedBody: 'Cette session a été révoquée depuis Kybernos.',
        errorTitle: 'Connexion impossible',
        retry: 'Réessayer',
        close: 'Fermer',
        none: '—',
        loading: 'Chargement…',
        nameFallback: 'Nom non renseigné chez Kybernos — partie locale de l\'email',
        footHint: 'Connectez-vous pour synchroniser vos sessions et appareils.',
        footConnect: 'Se connecter',
        footProfile: 'Compte Kybernos Cloud — ouvrir la fiche',
        footDevice: 'Appareil appairé',
        footPairing: 'Appairage en cours : confirmez le code dans le navigateur.',
        footPairingAction: 'Voir le code',
        // ── Refonte du pied (30/09, maquette « Menu ouvert ») ──
        notifTitle: 'Notifications',
        notifEmpty: 'Rien de neuf pour l’instant.',
        menuPlanCta: 'Passer à Pro',
        menuWebsite: 'Site web',
        menuHelp: 'Aide',
        menuFeedback: 'Envoyer un retour',
        menuSettingsApp: 'Paramètres',
        menuTeamsSettings: 'Réglages d\'équipe',
        // ── onglet Account : champs profil éditables (comme la webapp) ──
        // ── onglet « Données & confidentialité » (30/09 soir) ──
        dataNavLabel: 'Données & confidentialité',
        dataLabel: 'Vos données',
        dataExportTitle: 'Export complet des données',
        dataExportSub: 'Toutes vos données (profil, conversations, transactions, artefacts) regroupées et envoyées par email sous forme de lien ZIP signé (7 jours).',
        dataExportCta: 'Demander l’export',
        dataExportNote: 'La demande se fait dans Kybernos : DSH ne porte pas de jeton web pour la lancer ici.',
        dataDevicesTitle: 'Sessions et appareils',
        dataDevicesSub: 'Sessions actuellement connectées à votre compte. Déconnectez tout appareil que vous ne reconnaissez pas.',
        dataDevicesCurrent: 'Cet appareil',
        dataDevicesHere: 'Connecté ici',
        dataDevicesRefreshed: 'Rafraîchi le :',
        dataDevicesSignOut: 'Déconnecter',
        dataDevicesSigningOut: 'Déconnexion…',
        dataDevicesConfirm: 'Déconnecter cet appareil ?',
        dataDevicesConfirmBody: 'La session « {device} » sera déconnectée immédiatement. Vous pouvez vous reconnecter à tout moment.',
        dataDevicesKeep: 'Annuler',
        dataDevicesOthers: 'Les autres sessions se gèrent dans Kybernos.',
        dataDeleteTitle: 'Supprimer mon compte',
        dataDeleteSub: 'Vos groupes, Kybers et leur mémoire sont supprimés pour de bon. Vos dépôts personnels ne sont jamais touchés.',
        dataDeleteCta: 'Supprimer le compte',
        dataDeleteNote: 'La suppression demande votre mot de passe : elle se fait dans Kybernos.',
        accAvatar: 'Avatar — initiales & couleur',
        accNamePh: 'Votre nom',
        accProfileTitle: 'Profil',
        accBirth: 'Date de naissance',
        accLocation: 'Localisation',
        accDetect: 'Détecter',
        accDetecting: 'Détection…',
        accDetectErr: 'Détection impossible.',
        accTimezone: 'Fuseau horaire',
        accAuto: 'auto',
        accAutoTz: 'Automatique (détecté)',
        accPhotoUp: 'Importer une photo',
        accPhotoDel: 'Retirer la photo',
        accPhotoErr: 'Image illisible.',
        accLanguage: 'Langue',
        accInstructions: 'Instructions personnalisées — comment tous les Kybers vous traitent',
        accInstructionsPh: 'Soyez direct. Phrases courtes…',
        accSave: 'Enregistrer',
        accSaved: 'Enregistré ✓',
        accLocalNote: 'Ces champs restent sur cet appareil — la page profil de la webapp les garde, elle aussi, côté navigateur : le serveur ne les sert pas.',
        themeLight: 'Clair',
        themeDark: 'Sombre',
      },
      en: {
        menu: 'Kybernos Cloud',
        subtitle: 'Connect DSH to your Kybernos account.',
        connect: 'Connect Kybernos Cloud',
        pairingTitle: 'Pairing in progress',
        pairingBody: 'Open the activation page and confirm the code: DSH will connect on its own.',
        openPage: 'Open activation page',
        copyCode: 'Copy code',
        copied: 'Code copied',
        cancel: 'Cancel request',
        waiting: 'Waiting for your confirmation in the browser…',
        connected: 'Connected',
        email: 'Email',
        name: 'Name',
        plan: 'Plan',
        // DSH parle déjà de « Teams » (AI Teams) : même mot ici, pas deux
        // vocabulaires pour la même chose.
        workspaces: 'Teams',
        kybers: 'kybers',
        spaceTitle: 'Workspace',
        wsSwitchTitle: 'Switch workspace',
        wsSwitchSub: 'switch',
        wsPageTitle: 'My workspace',
        wsPrev: 'Previous workspace',
        wsNext: 'Next workspace',
        wsNew: 'New workspace',
        wsNewTitle: 'Create a workspace',
        wsNewName: 'Workspace name',
        wsNewCreate: 'Create',
        wsNewHosted: 'Create in Kybernos',
        wsNewErr: 'The server refused the creation.',
        profTitle: 'Profile',
        profCompte: 'Account',
        profParrain: 'Referral',
        profApparence: 'Appearance',
        profSecurite: 'Security',
        profDonnees: 'Data & privacy',
        profSupport: 'Support & legal',
        profLogout: 'Log out',
        refTitle: 'Referral',
        refCode: 'Your code',
        refLink: 'Referral link',
        refCopy: 'Copy link',
        refCopied: 'Copied',
        refOpen: 'See in Kybernos',
        refNone: 'Referral is not available from this device.',
        appTitle: 'DSH appearance',
        appNote: 'Theme, accent and font are set in Settings ▸ Appearance (Kybernos Theme plugin).',
        appPack: 'Current pack',
        appFont: 'Font',
        appNone: 'default',
        secTitle: 'Security',
        secNote: 'This device holds the session; logging out revokes the token server-side.',
        supTitle: 'Support & legal',
        supNote: 'These pages live in Kybernos:',
        supSupport: 'Support',
        supPrivacy: 'Privacy',
        supTerms: 'Terms',
        mobTitle: 'Get the mobile app',
        mobScan: 'Scan the code to install Kybernos on your phone.',
        mobSoon: 'Preview — the real link will come with the app.',
        wsSettingsTitle: 'Workspace settings',
        wsTabPlan: 'Plan',
        wsTabUsage: 'Usage',
        wsTabPeople: 'People',
        wsTabBilling: 'Billing',
        wsTabSync: 'Sync',
        wsPlanLabel: 'CURRENT PLAN',
        wsPlanPrice: '— per month',
        wsPlanSummary: 'What this workspace holds:',
        wsPlanVisible: 'workspaces visible from this machine',
        wsViewUsage: 'View usage',
        wsUsageTitle: 'What this machine knows about usage',
        wsUsageNote: 'The detail (credits, calls, workspace cap) lives in Kybernos: only what already came down is shown here.',
        wsPeopleTitle: 'Who works in this workspace',
        wsPeopleNote: 'The directory and the invites live in Kybernos — DSH does not read them, and invents none.',
        wsBillingTitle: 'Payment and invoices',
        wsBillingNote: 'Billing lives in Kybernos: nothing can be changed from this screen.',
        wsOpenHosted: 'Open in Kybernos',
        wsClose: 'Close',
        wsKybersOne: 'kyber',
        wsKybersMany: 'kybers',
        wsModelsOne: 'model',
        wsModelsMany: 'models',
        spaceSwitch: 'Switch workspace',
        spaceActive: 'Active workspace',
        spaceSetup: 'Sync settings',
        spaceAccount: 'Account & devices',
        spaceOpen: 'Open in Kybernos',
        spaceMark: 'active',
        spaceUnknown: 'Unknown workspace — nothing was changed.',
        syncTitle: 'Sync',
        syncNotServed: 'The server does not serve the sync policy yet: the switches are inactive. Nothing leaves this workspace meanwhile.',
        syncPull: 'Receive',
        syncPush: 'Send',
        syncOn: 'On',
        syncOff: 'Off',
        syncMemorySpace: 'Workspace memory',
        syncMemorySpaceHint: 'The team\'s shared knowledge — receiving brings it down, sending enriches it.',
        syncMemoryKybers: 'Kyber memory',
        syncMemoryKybersHint: 'Know-how of a role: a lesson follows the kyber, never the project.',
        syncSends: 'Explicit sends',
        syncSendsHint: 'Artifacts and chats, one send at a time, after a manifest.',
        syncDownTitle: 'What may come down',
        syncUpTitle: 'What may leave',
        syncUnknown: 'readable as soon as the server serves the policy',
        syncNeverTitle: 'Never leaves',
        syncNeverBody: 'File and folder contents, chats in bulk, secrets and machine paths.',
        models: 'Models',
        modelsImport: 'Import models',
        modelsReimport: 'Re-import',
        modelsImporting: 'Importing…',
        modelsUnavailable: 'No models imported',
        modelsNote: 'Kybernos LiteLLM models (glm, deepseek…) imported automatically on connection, according to your plan.',
        modelsWarn: 'Partial import: the provider route could not be written to settings — "Re-import" tries again.',
        modelsSyncFail: 'Re-import failed — try again.',
        // DSH chats → webapp (session directory, metadata only)
        chatsTitle: 'DSH chats',
        chatsNote: 'Pushes the list of your DSH sessions (project and date, never the content) to Kybernos — the webapp then shows "DSH conversations".',
        chatsPush: 'Sync chats',
        chatsPushing: 'Sending…',
        chatsLast: 'Last push',
        chatsFail: 'Push failed — try again.',
        // Account memory (cloud feature #2)
        memoTitle: 'Account memory',
        memoNote: 'Your Kybernos memories: they come down from the cloud on every turn and go back up when you teach me something. Nothing is written while disconnected.',
        memoEmpty: 'No memory yet. Tell me something durable ("I live in Paris") or add it here.',
        memoLoading: 'Reading memories…',
        memoFail: 'Memories unreadable — try again.',
        memoPinned: 'pinned',
        memoPin: 'Pin',
        memoUnpin: 'Unpin',
        memoForget: 'Forget',
        memoTeach: 'Add a memory…',
        memoKindFact: 'fact',
        memoKindPreference: 'preference',
        memoKindEvent: 'event',
        memoKindPolicy: 'policy',
        memoAdd: 'Add',
        memoAdded: 'Memory saved.',
        memoKybers: 'Local kybers → cloud kybers',
        memoKybersNote: 'A local kyber\'s lessons only go up when it is linked to a cloud kyber. Without a link, nothing is pushed.',
        memoNoLink: 'not linked',
        memoLessons: 'Push lessons',
        memoLessonsDry: 'Check',
        memoLessonsNote: 'Nothing is written until you confirm: the check says what would go up.',
        memoLessonsDone: 'Lessons pushed',
        memoLessonsNone: 'Nothing to push.',
        memoCapture: 'Last end-of-turn capture:',
        memoCaptureNothing: 'nothing to keep',
        memoCaptureUnknown: 'unknown state',
        device: 'Device',
        session: 'Session',
        refresh: 'Refresh',
        reconnect: 'Reconnect',
        disconnect: 'Disconnect',
        revokedTitle: 'Reconnection required',
        revokedBody: 'This session was revoked from Kybernos.',
        errorTitle: 'Could not connect',
        retry: 'Retry',
        close: 'Close',
        none: '—',
        loading: 'Loading…',
        nameFallback: 'No name set on Kybernos — showing the email local part',
        footHint: 'Sign in to sync your sessions and devices.',
        footConnect: 'Sign in',
        footProfile: 'Kybernos Cloud account — open details',
        footDevice: 'Paired device',
        footPairing: 'Pairing in progress: confirm the code in your browser.',
        footPairingAction: 'Show code',
        notifTitle: 'Notifications',
        notifEmpty: 'Nothing new so far.',
        menuPlanCta: 'Upgrade to Pro',
        menuWebsite: 'Website',
        menuHelp: 'Help',
        menuFeedback: 'Send feedback',
        menuSettingsApp: 'Settings',
        menuTeamsSettings: 'Teams settings',
        dataNavLabel: 'Data & privacy',
        dataLabel: 'Your data',
        dataExportTitle: 'Full data export',
        dataExportSub: 'All your data (profile, conversations, transactions, artifacts) bundled and emailed as a signed ZIP link (7 days).',
        dataExportCta: 'Request export',
        dataExportNote: 'The request is made in Kybernos: DSH does not carry a web token to run it here.',
        dataDevicesTitle: 'Sessions and devices',
        dataDevicesSub: 'Sessions currently signed in to your account. Sign out any device you do not recognize.',
        dataDevicesCurrent: 'This device',
        dataDevicesHere: 'Signed in here',
        dataDevicesRefreshed: 'Refreshed on:',
        dataDevicesSignOut: 'Sign out',
        dataDevicesSigningOut: 'Signing out…',
        dataDevicesConfirm: 'Sign out this device?',
        dataDevicesConfirmBody: 'Session “{device}” will be signed out immediately. You can sign in again at any time.',
        dataDevicesKeep: 'Cancel',
        dataDevicesOthers: 'Other sessions are managed in Kybernos.',
        dataDeleteTitle: 'Delete my account',
        dataDeleteSub: 'Your groups, Kybers and their memory are removed for good. Your own repos are never touched.',
        dataDeleteCta: 'Delete account',
        dataDeleteNote: 'Deletion asks for your password: it happens in Kybernos.',
        accAvatar: 'Avatar — initials & color',
        accNamePh: 'Your name',
        accProfileTitle: 'Profile',
        accBirth: 'Date of birth',
        accLocation: 'Location',
        accDetect: 'Detect',
        accDetecting: 'Detecting…',
        accDetectErr: 'Could not detect.',
        accTimezone: 'Time zone',
        accAuto: 'auto',
        accAutoTz: 'Automatic (detected)',
        accPhotoUp: 'Upload photo',
        accPhotoDel: 'Remove photo',
        accPhotoErr: 'Unreadable image.',
        accLanguage: 'Language',
        accInstructions: 'Custom instructions — how all Kybers treat you',
        accInstructionsPh: 'Be direct. Short sentences…',
        accSave: 'Save',
        accSaved: 'Saved ✓',
        accLocalNote: 'These fields stay on this device — the webapp profile page keeps them browser-side too: the server does not serve them.',
        themeLight: 'Light',
        themeDark: 'Dark',
      },
    }

    const CLOUD_CSS = `
/* ── La rangée du bas du menu ────────────────────────────────────────────────
   Elle remplace l'ancien bouton-nuage : connecté, elle montre l'identité
   (avatar d'initiales, nom, pastille de formule, appareil appairé) ; déconnecté,
   elle explique et propose « Se connecter ». Le tout ouvre la même fiche. */
.kbf-root{display:flex;flex-direction:column;gap:6px;width:100%;min-width:0;max-width:100%;position:relative}
.kbf-profile{display:flex;align-items:center;gap:8px;width:100%;min-width:0;height:36px;padding:0 9px;border:1px solid transparent;border-radius:10px;background:transparent;color:var(--dsw-alias-label-primary,#e9e9ee);font:inherit;text-align:left;cursor:pointer}
.kbf-profile:hover{border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.35))}
.kbf-profile:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14))}
.kbf-avatar{flex:none;width:23px;height:23px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-family:ui-monospace,monospace;font-size:9.5px;font-weight:600;letter-spacing:.02em;background:var(--dsw-alias-brand-primary,#6a4fd8);color:var(--dsw-alias-label-primary-foreground,#fff)}
.kbf-name{flex:0 1 auto;min-width:0;max-width:62%;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* Le sélecteur d'espace : la rangée du pied montre l'espace ACTIF ; sa page
   (classes kbs-*) porte la liste des espaces puis le réglage de synchronisation.
   ATTENTION : ce bloc vit DANS un template literal — jamais de backtick ici, il
   fermerait la chaîne et la révision ne parserait plus (incident du 24/09). */
/* La rangée workspace (carte + engrenage), au-dessus du menu user conservé. */
.kbf-wsrow{display:flex;align-items:center;gap:4px;width:100%;min-width:0}
.kbf-wscard{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:9px;height:40px;padding:0 9px;border:1px solid transparent;border-radius:10px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.kbf-wscard:hover{border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.35))}
.kbf-wstile{display:inline-flex;align-items:center;justify-content:center;width:23px;height:23px;flex:none;border-radius:8px;background:var(--dsw-alias-label-primary,#e9e9ee);color:var(--dsw-alias-bg-base,#0f0f12);font-family:ui-monospace,monospace;font-size:9.5px;font-weight:600}
.kbf-wsname{display:block;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbf-wssub{display:block;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a93)}
.kbf-wsgear{display:inline-flex;align-items:center;justify-content:center;width:23px;height:23px;flex:none;border:1px solid transparent;border-radius:8px;color:var(--dsw-alias-label-tertiary,#8a8a93);background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a93);cursor:pointer}
/* Rail replié : la maquette passe en colonne (railTight) — la carte ne garde
   que sa tuile, l'engrenage passe dessous, les libellés disparaissent. Sans
   cette variante, la rangée (167 px) débordait d'un rail de 60 px. */
.kbf-tight{flex-direction:column;align-items:center;gap:4px;width:auto;min-width:0;max-width:100%}
.kbf-tight .kbf-wscard,.kbf-tight .kbf-wsgear{flex:0 0 auto;justify-content:center;padding:6px;width:auto;max-width:100%}
.kbf-chevrons{display:flex;align-items:center;gap:2px;color:currentColor;opacity:.7}
.kbf-wsarrow{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;flex:none;padding:0;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a93);font:inherit;font-size:14px;font-weight:600;line-height:1;cursor:pointer}
/* Le swap de la rangée d'espace : PLUS généreux que les petites flèches —
   cible principale du pied, gabarit d'un bouton de barre d'outils. */
.kbf-wsrow .kbf-wsarrow{width:36px;height:40px;border-radius:10px}
.kbf-wsarrow:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#e9e9ee)}
.kbf-wsarrow:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4f7cff);outline-offset:1px}
.kbf-wsarrow:disabled{opacity:.35;cursor:default}
/* Les popovers du pied de sidebar (changement d'espace, app mobile) : ancrés
   AU-DESSUS de leur rangée — .kbf-wsrow et .kbf-idrow portent le
   position:relative, parce que .kbf-root est en display:contents dans la
   grille du pied (plugin Kybernos). Le rideau transparent ferme au clic dehors. */
.kbf-wsrow,.kbf-idrow{position:relative}
.kbf-idrow{display:flex;align-items:center;gap:2px;width:100%;min-width:0}
.kbf-idrow .kbf-profile{flex:1 1 auto;min-width:0}
.kbf-mobbtn{flex:0 0 auto;width:36px;height:36px;border-radius:10px}
.kbf-popscrim{position:static}
.kbf-pop{position:absolute;left:0;bottom:calc(100% + 8px);z-index:61;width:252px;padding:8px;border-radius:13px;background:var(--dsw-alias-bg-layer-2,#191920);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));box-shadow:0 12px 32px rgba(0,0,0,.4);color:var(--dsw-alias-label-primary,#e9e9ee);font-size:13px}
.kbf-poptitle{padding:6px 10px 8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary,#8a8a93)}
/* Le QR factice : dessine une grille deterministe (faux modules + 3 carrés de
   repere) — assez pour une maquette, jamais assez pour tromper un scanner. */
.kbf-qr{display:block;width:150px;height:150px;margin:2px auto 0;background:#fff;border-radius:10px;padding:10px}
.kbf-qrnote{margin:8px 2px 2px;font-size:11.5px;line-height:1.45;color:var(--dsw-alias-label-tertiary,#8a8a93)}
.kbf-popcenter{padding:10px 10px 12px}
/* Separateur vertical entre le bouton profil et les boutons annexes du pied :
    marque que ce sont des gestes DISTINCTS, pas une seule grande rangee. */
.kbf-footsep{flex:0 0 1px;align-self:stretch;margin:8px 6px;width:1px;background:var(--dsw-alias-border-l2,rgba(127,127,127,.3))}
/* Rail replié : le séparateur et le bouton téléphone disparaissent (comme le
   nom et la formule), la ligne se réduit au seul profil. */
[class*="collapsed"] .kbf-footsep,[class*="collapsed"] .kbf-mobbtn{display:none}
.kbf-tight .kbf-wsname,.kbf-tight .kbf-wssub,.kbf-tight .kbf-chevrons{display:none}
.kbf-tightprofil{justify-content:center;width:auto;min-width:0;max-width:100%;padding:3px}
.kbf-tightprofil .kbf-name,.kbf-tightprofil .kbf-plan,.kbf-tightprofil .kbf-dev{display:none}
.kbf-wsgear:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#e9e9ee)}
/* La page PLEIN CADRE (slot main) : elle vit dans la zone de contenu, pas
   dans une surcouche. Mêmes onglets, mêmes contenus que la maquette. */
.kbp-page{display:flex;flex-direction:column;height:100%;overflow:auto;padding:24px 30px 40px;color:var(--dsw-alias-label-primary,#e9e9ee)}
.kbp-head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
.kbp-title{font-size:22px;font-weight:700;letter-spacing:-.01em;margin:0}
.kbp-sub{display:block;margin-top:3px;font-size:12.5px;color:var(--dsw-alias-label-tertiary,#8a8a93)}
.kbp-back{margin-left:auto;padding:7px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:9px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}
.kbp-back:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14))}
.kbp-body{width:100%;max-width:900px;margin-top:4px}
.kbp-card{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22));border-radius:14px;padding:20px 22px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06))}
.kbp-loading{padding:24px;color:var(--dsw-alias-label-tertiary,#8a8a93);font-size:13px}
/* La page profil : menu de sections a gauche (comme dans Kybernos), contenu
   a droite. Le libelle actif porte un fond discret et une barre laterale. */
.kbp-wrap{display:flex;gap:28px;align-items:flex-start;width:100%;max-width:900px;margin-top:18px}
.kbp-nav{display:flex;flex-direction:column;gap:2px;flex:0 0 215px;position:sticky;top:0}
.kbp-navbtn{display:block;width:100%;padding:8px 12px;border:none;border-left:2px solid transparent;border-radius:0 9px 9px 0;background:transparent;color:var(--dsw-alias-label-secondary,#8a8a93);font:inherit;font-size:13.5px;font-weight:500;text-align:left;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbp-navbtn:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#e9e9ee)}
.kbp-navbtn[aria-current="true"]{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14));border-left-color:var(--dsw-alias-brand-primary,#6a4fd8);color:var(--dsw-alias-label-primary,#e9e9ee);font-weight:600}
.kbp-navbtn.kbp-navout{margin-top:10px;color:var(--dsw-alias-state-error-primary,#f25a5a)}
.kbp-navbtn.kbp-navout:hover{background:rgba(242,90,90,.12);color:var(--dsw-alias-state-error-primary,#f25a5a)}
.kbp-sec{flex:1 1 auto;min-width:0}

/* La page : en-tête d'espace, onglets (style de la maquette), contenu. */
.kbt-tabs{display:flex;flex-wrap:wrap;gap:4px;margin:12px 0 16px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));padding-bottom:10px}
.kbt-tab{padding:10px 18px;border:none;border-radius:9px;background:transparent;color:var(--dsw-alias-label-secondary,#8a8a93);font:inherit;font-size:13.5px;font-weight:500;cursor:pointer;white-space:nowrap}
.kbt-tab[aria-selected="true"]{background:var(--dsw-alias-button-primary-fill,#3b82f6);color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:600}
.kbt-plan{display:flex;flex-direction:column;gap:6px;flex:1;min-width:0}
.kbt-label{font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.1em;color:var(--dsw-alias-label-tertiary,#8a8a93)}
.kbt-planline{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.kbt-planname{font-size:28px;font-weight:700;letter-spacing:-.02em}
.kbt-planprice{font-size:15px;color:var(--dsw-alias-label-secondary,#8a8a93)}
.kbt-plansum{font-size:13.5px;line-height:1.5;color:var(--dsw-alias-label-secondary,#8a8a93)}
.kbt-head{display:flex;align-items:flex-end;gap:18px;flex-wrap:wrap}
.kbs-head{display:flex;align-items:flex-start;gap:10px;justify-content:space-between}
.kbs-who{display:flex;align-items:center;gap:9px;min-width:0}
.kbs-who b{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbs-sub{display:block;margin-top:2px;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a8a93)}
.kbs-list{display:flex;flex-direction:column;gap:2px;margin:10px 0 0}
.kbs-item{display:flex;align-items:center;gap:9px;width:100%;padding:8px 9px;border:1px solid transparent;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12.5px;text-align:left;cursor:pointer}
.kbs-item:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14))}
.kbs-item[aria-current="true"]{border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.35));background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14))}
.kbs-item .kbs-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbs-mark{flex:none;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8a8a93)}
.kbs-sep{height:1px;margin:12px 0;background:var(--dsw-alias-border-l2,rgba(127,127,127,.22))}
.kbs-sect{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#8a8a93)}
.kbs-row{display:flex;align-items:flex-start;gap:14px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16))}
.kbs-row-txt{flex:1;min-width:0}
.kbs-row-txt b{display:block;font-size:12.5px;font-weight:600;margin-bottom:2px}
.kbs-row-txt span{display:block;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#8a8a93)}
.kbs-flip{display:inline-flex;gap:4px;flex:none;align-self:center}
.kbs-flip button{min-width:64px;height:24px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,#8a8a93);font:inherit;font-size:11px;cursor:pointer}
.kbs-flip button[aria-pressed="true"]{background:var(--dsw-alias-button-primary-fill,#3b82f6);border-color:var(--dsw-alias-button-primary-fill,#3b82f6);color:var(--dsw-alias-label-primary-foreground,#fff)}
.kbs-flip button:disabled{cursor:default;opacity:.55}
.kbs-note{padding:9px 11px;border-radius:8px;border-left:3px solid var(--dsw-alias-state-warn-primary,#f59e0b);background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.10));font-size:11.5px;line-height:1.5}
.kbs-recap{margin-top:12px;display:flex;flex-direction:column;gap:6px}
.kbs-recap div{font-size:11.5px;color:var(--dsw-alias-label-secondary,#8a8a93)}
.kbs-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.kbs-link{display:inline-flex;align-items:center;gap:6px;padding:7px 11px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;text-decoration:none}
.kbs-link:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14))}
.kbs-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:18px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.18));font-size:10.5px;font-weight:600}
.kbf-plan{flex:none;max-width:58px;padding:2px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14));color:var(--dsw-alias-label-secondary,#8a8a93);font-size:11px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbf-dev{flex:none;margin-left:auto;display:flex;align-items:center;color:var(--dsw-alias-brand-primary,#4176e6)}
.kbf-off{display:flex;flex-direction:column;gap:8px;width:100%;min-width:0}
/* Déconnecté : boutons NATIFS du design system (kbm-btn), le principal
   prend la largeur, l'engrenage des Réglages reste atteignable à droite. */
.kbf-offbtns{display:flex;align-items:center;gap:6px;width:100%}
.kbf-offbtns .kbm-btn-primary{flex:1 1 auto}
.kbf-gear{flex:0 0 auto}
[class*="collapsed"] .kbf-offbtns .kbm-btn span{display:none}
[class*="collapsed"] .kbf-offbtns .kbm-btn{padding:0 10px}
.kbf-hint{margin:0;font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-secondary,#8a8a93)}
.kbf-connect{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;height:34px;border:none;border-radius:10px;background:var(--dsw-alias-brand-primary,#4176e6);color:var(--dsw-alias-label-primary-foreground,#fff);font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.kbf-connect:hover{filter:brightness(1.06)}
/* Rail replié : l'identité se réduit à l'avatar, l'encart à une pastille. */
[class*="collapsed"] .kbf-name,[class*="collapsed"] .kbf-plan,[class*="collapsed"] .kbf-dev,[class*="collapsed"] .kbf-hint{display:none}
[class*="collapsed"] .kbf-profile{justify-content:center;padding:2px}
[class*="collapsed"] .kbf-connect{width:32px;height:32px;padding:0}
[class*="collapsed"] .kbf-connect span{display:none}
.kbc-scrim{position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:24px}
.kbc-card{position:relative;z-index:9999;width:100%;max-width:380px;max-height:82vh;overflow:auto;border-radius:14px;padding:18px 18px 16px;background:var(--dsw-alias-bg-layer-2, #191920);color:var(--dsw-alias-label-primary, #e9e9ee);box-shadow:0 18px 48px rgba(0,0,0,.45);font-size:13px;line-height:1.45}
.kbc-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
.kbc-title{font-weight:700;font-size:14px}
.kbc-x{border:none;background:transparent;color:var(--dsw-alias-label-secondary, #8a8a93);cursor:pointer;font-size:16px;line-height:1;padding:2px 6px;border-radius:6px}
.kbc-x:hover{background:var(--dsw-alias-bg-layer-1, rgba(127,127,127,.14))}
.kbc-body{color:var(--dsw-alias-label-secondary, #8a8a93);margin-bottom:12px}
.kbc-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.kbc-btn-primary,.kbc-btn-ghost{border-radius:9px;padding:8px 12px;font-size:13px;cursor:pointer;border:1px solid transparent}
/* Fond de bouton primaire : PAS la variable --dsw-alias-brand-primary. Dans ce
   theme cet alias est une couleur de TEXTE (composee ~rgb(249,250,251)) : en
   fond, le libelle blanc devenait invisible. Mesure dans le DOM : color
   rgb(255,255,255) sur background rgb(249,250,251) — le CTA Connecter
   Kybernos Cloud etait donc illisible depuis toujours. Bleu fixe (#1f5ae0, contraste 5.8:1 avec le blanc) + blanc. */
.kbc-btn-primary{background:#1f5ae0;color:#fff;font-weight:600;border-color:#1f5ae0}
.kbc-btn-primary:disabled{opacity:.55;cursor:default}
.kbc-btn-ghost{background:transparent;border-color:var(--dsw-alias-label-secondary, #8a8a93);color:var(--dsw-alias-label-primary, #e9e9ee)}
.kbc-btn-ghost:disabled{opacity:.55;cursor:default}
.kbc-code{margin:10px 0 4px;padding:12px;border-radius:10px;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:26px;letter-spacing:.24em;font-weight:700;background:var(--dsw-alias-bg-layer-1, rgba(127,127,127,.14))}
.kbc-rows{display:flex;flex-direction:column;gap:1px;margin-top:10px}
.kbc-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px solid rgba(127,127,127,.18)}
.kbc-row:first-child{border-top:none}
.kbc-k{color:var(--dsw-alias-label-secondary, #8a8a93);flex:0 0 auto}
.kbc-v{text-align:right;word-break:break-word}
.kbc-v-fallback{opacity:.7;font-style:italic}
.kbc-ws{margin-top:8px;display:flex;flex-direction:column;gap:6px}
.kbc-ws-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:9px;background:var(--dsw-alias-bg-layer-1, rgba(127,127,127,.12))}
/* Champs de la section Memoire : meme gabarit que les boutons voisins, pour
   que la carte ne se mette pas a avoir trois hauteurs de controle. */
.kbc-input{flex:1;min-width:0;border-radius:9px;padding:7px 10px;font:inherit;font-size:13px;border:1px solid var(--dsw-alias-label-secondary, #8a8a93);background:transparent;color:var(--dsw-alias-label-primary, #e9e9ee)}
.kbc-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, #4f7cff);outline-offset:1px}
.kbc-input option{color:#111}
.kbc-badge{font-size:11px;padding:1px 7px;border-radius:999px;background:rgba(79,124,255,.18);color:var(--dsw-alias-brand-primary, #4f7cff)}
.kbc-ok{color:#39b46a}
.kbc-warn{color:#e0a33e}
.kbc-err{color:#e56a6a}
.kbc-note{margin-top:10px;font-size:12px;color:var(--dsw-alias-label-secondary, #8a8a93)}
/* ── Refonte du pied (30/09, maquette « Menu ouvert ») ──────────────────────
    Une SEULE carte au bas du menu : tuile d'initiales, nom de l'espace,
    « qui · formule », puis téléphone et cloche. Le clic ouvre le MENU unifié
    (espace, formule, compte, parrainage, apparence, réglages, déconnexion).
    Pas de backtick dans ce bloc : il vit dans un template literal. */
/* Jetons natifs DSH uniquement (30/09 soir) : aucun repli hex — la carte et
   son menu suivent le thème du shell, clair comme sombre, au lieu des
   couleurs de la maquette. */
/* (01/10, retour utilisateur) Plus de trait au-dessus du bouton profil : le
   contour de la carte devient transparent (géométrie conservée, ligne
   disparue). */
.kbfp-card{position:relative;display:flex;align-items:center;gap:2px;width:100%;min-width:0;box-sizing:border-box;padding:8px 8px 8px 10px;border:1px solid transparent;border-radius:14px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit}
.kbfp-cardmain{flex:1 1 auto;display:flex;align-items:center;gap:10px;min-width:0;padding:0;border:none;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;border-radius:8px}
.kbfp-tile{flex:none;width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);font-family:ui-monospace,monospace;font-weight:700;font-size:13px}
.kbfp-cardtxt{flex:1 1 auto;min-width:0;margin-inline-start:2px}
.kbfp-cardname{display:block;font-size:14px;font-weight:600;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbfp-cardsub{display:block;font-size:12px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbfp-ico{flex:none;width:36px;height:36px;padding:0;border:none;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;justify-content:center;cursor:pointer}
.kbfp-ico:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.kbfp-bellwrap{position:relative;display:flex}
/* Le popover de la cloche : ancré À DROITE de son bouton (left:auto) —
   ancré à gauche il débordait de la colonne de sidebar et était rogné
   (30/09 soir). Il tient tout entier dans la largeur de la colonne. */
.kbfp-bellpop{width:230px;left:auto;right:0}
/* Le menu : ancré au-dessus de la carte, gabarit de la maquette (276 px,
   rayon 16, ombre portée haute). Il défile en place si la fenêtre est basse. */
/* Largeur BORNÉE à la colonne du pied (30/09 soir) : un menu de 276 px posé
   dans une sidebar de 256 px était rogné de 20 px à droite — troncature des
   libellés. Il épouse donc la largeur de la carte (left/right 0). */
.kbfp-menu{position:absolute;left:0;right:0;bottom:calc(100% + 10px);z-index:62;width:auto;max-height:calc(100vh - 130px);overflow-y:auto;box-sizing:border-box;padding:8px;border-radius:16px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-panel);color:var(--dsw-alias-label-primary);font-size:13px;animation:kbfp-menu-in .14s ease-out}
/* Le sous-panneau « Changer d'espace » : À CÔTÉ du menu, à droite (gabarit
   maquette) — le menu principal reste ouvert pendant le choix. Il vit en
   PORTAIL fixed sur <body> : la colonne de sidebar défile et ROGNE tout
   enfant absolu qui déborde (mesuré 30/09 soir : 25 px visibles sur 248).
   Les coordonnées sont posées à l'ouverture, depuis le rect du menu. Pas
   de barre de défilement : hauteur naturelle. */
.kbfp-sub{position:fixed;width:248px;box-sizing:border-box;padding:8px;border-radius:16px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-panel);color:var(--dsw-alias-label-primary);font-size:13px;animation:kbfp-menu-in .14s ease-out;z-index:63}
@keyframes kbfp-menu-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.kbfp-menu{animation:none}}
.kbfp-mhead{display:flex;align-items:center;gap:12px;width:100%;min-height:40px;box-sizing:border-box;padding:0 10px;border:none;border-radius:10px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.kbfp-mhead:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbfp-mheadtxt{flex:1 1 auto;min-width:0}
.kbfp-mheadname{display:block;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbfp-mheadsub{display:block;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.kbfp-mhead svg{flex:none;color:var(--dsw-alias-label-tertiary)}
.kbfp-mplan{margin:0 0 4px;box-sizing:border-box;padding:2px 10px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover)}
.kbfp-mplanline{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:40px}
.kbfp-mplanname{font-size:16px;font-weight:600;letter-spacing:-.01em;text-transform:capitalize}
.kbfp-mcta{flex:none;height:28px;padding:0 12px;border:none;border-radius:10px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font:inherit;font-size:12px;font-weight:600;cursor:pointer}
.kbfp-mcta:hover{background:var(--dsw-alias-button-primary-hover)}
.kbfp-msep{height:1px;margin:8px 0;background:var(--dsw-alias-border-l2)}
/* Liste des sessions de la barre latérale : l'ascenseur natif restait affiché en permanence, collé juste au-dessus du menu du bas
   (un « trait » parasite). Il n'apparaît plus qu'au survol de la liste. */
/* Filet dégradé natif au-dessus de la carte utilisateur : retiré (demande 01/10). */
[class*="_footArea"]::before{display:none!important}
[class*="_regionArea"] [class$="_list"]{scrollbar-width:thin;scrollbar-color:transparent transparent}
[class*="_regionArea"] [class$="_list"]:hover{scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent}
.kbfp-mitems{display:flex;flex-direction:column}
.kbfp-mitem{display:flex;align-items:center;gap:12px;width:100%;min-height:40px;box-sizing:border-box;padding:0 10px;border:none;border-radius:10px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;text-align:left;cursor:pointer;text-decoration:none}
.kbfp-mitem:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbfp-mitem > svg{flex:none;color:var(--dsw-alias-label-secondary)}
.kbfp-mlab{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbfp-mext{flex:none;color:var(--dsw-alias-label-tertiary)}
.kbfp-mamber > svg{color:var(--dsw-alias-state-warn-primary)}
.kbfp-mout{color:var(--dsw-alias-state-error-primary)}
.kbfp-mout > svg{color:inherit}
.kbfp-seg{display:flex;gap:2px;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-base)}
.kbfp-seg button{width:28px;height:24px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);display:flex;align-items:center;justify-content:center;cursor:pointer}
.kbfp-seg button.on{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
.kbfp-msub{padding:8px 10px 6px;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
.kbfp-switchbody{display:flex;flex-direction:column}
/* La sélection d'espace, gabarit maquette : ACTIF = carte surélevée (fond
   interactif, coche à droite), les autres des rangées nues ; « Créer un
   espace » porte son + comme les autres icônes du menu. */
.kbfp-wsitem{display:flex;align-items:center;gap:12px;width:100%;box-sizing:border-box;padding:8px 10px;border:none;border-radius:12px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.kbfp-wsitem:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbfp-wsitem.on{background:var(--dsw-alias-interactive-bg-hover)}
.kbfp-wstile{flex:none;width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);font-family:ui-monospace,monospace;font-weight:700;font-size:12px}
.kbfp-wstxt{flex:1 1 auto;min-width:0}
.kbfp-wsname{display:block;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbfp-wssub{display:block;font-size:12.5px;color:var(--dsw-alias-label-tertiary)}
.kbfp-wscheck{flex:none;display:flex;color:var(--dsw-alias-label-primary)}
.kbfp-wsplus{flex:none;width:34px;height:34px;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary)}
/* Rail replié : la carte se réduit à sa tuile, centrée. */
.kbfp-tight2 .kbfp-card{justify-content:center;padding:4px;width:auto}
.kbfp-tight2 .kbfp-cardtxt,.kbfp-tight2 .kbfp-ico{display:none}
[class*="collapsed"] .kbfp-cardtxt,[class*="collapsed"] .kbfp-ico{display:none}
[class*="collapsed"] .kbfp-card{justify-content:center;padding:4px}
/* Placement dans le pied (plugin Kybernos) : TOUT EN BAS — le pied du shell
   est redevenu un empilement simple, la carte est le dernier élément visible
   (l'engrenage natif est masqué, son panneau s'ouvre depuis le menu). */
.kbfp-cardwrap{position:relative;width:100%;min-width:0;display:flex;justify-content:flex-start}
/* Onglet Account des Réglages : les champs du design system (kbm-setfield)
   prennent toute la largeur de la carte — un <select> sans width se rétracte
   à son option la plus courte (mesuré ~130 px) — et le textarea garde sa
   hauteur propre (le gabarit fixe 34 px pour les inputs d'une ligne). */
[data-kb="settings-account"] .kbm-setfield-input{width:100%;box-sizing:border-box}
[data-kb="settings-account"] textarea.kbm-setfield-input{height:auto;min-height:72px;padding:8px 12px;resize:vertical}
/* Avatar (initiales & couleur, comme la webapp) : pastille de Gabarit +
   nuancier DATA (couleurs d'entité, pas des jetons de thème — mêmes
   valeurs que la webapp, IDENTITY_SWATCH_COLORS). */
.kbfp-avat{flex:none;width:48px;height:48px;border-radius:14px;display:flex;align-items:center;justify-content:center;color:#fff;font-family:ui-monospace,monospace;font-weight:700;font-size:16px}
.kbfp-swrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.kbfp-sw{width:26px;height:26px;border:none;border-radius:8px;cursor:pointer;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}
.kbfp-sw:hover{transform:scale(1.08)}
.kbfp-sw.on{box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-2),0 0 0 4px var(--dsw-alias-label-primary)}
`

    /** Téléphone (appareil appairé) — tracé Lucide, comme le reste du pied. */
    const PhoneIcon = (props) => h('svg', {
      width: (props !== undefined && props !== null && typeof props.size === 'number') ? props.size : 15,
      height: (props !== undefined && props !== null && typeof props.size === 'number') ? props.size : 15,
      viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true',
    },
    h('rect', { x: 6, y: 2, width: 12, height: 20, rx: 2.5, stroke: 'currentColor', strokeWidth: 1.7 }),
    h('path', { d: 'M12 18h.01', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' }))

    /** Flèche d'entrée (CTA « Se connecter ») — tracé Lucide `log-in`. */
    const EnterIcon = (props) => h('svg', {
      width: (props !== undefined && props !== null && typeof props.size === 'number') ? props.size : 15,
      height: (props !== undefined && props !== null && typeof props.size === 'number') ? props.size : 15,
      viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true',
    },
    h('path', { d: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    h('path', { d: 'm10 17 5-5-5-5', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    h('path', { d: 'M15 12H3', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }))

    /** Échange d'espace — tracé Lucide `chevrons-up-down`, celui de la maquette. */
    const SwapIcon = (props) => h('svg', {
      width: (props !== undefined && props !== null && typeof props.size === 'number') ? props.size : 15,
      height: (props !== undefined && props !== null && typeof props.size === 'number') ? props.size : 15,
      viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true',
    },
    h('path', { d: 'm7 15 5 5 5-5', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    h('path', { d: 'm7 9 5-5 5 5', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }))

    /** Engrenage (tracé Lucide settings) — maquette : page de l'espace. */
    const GearIcon = (props) => h('svg', {
      width: (props !== undefined && props !== null && typeof props.size === 'number') ? props.size : 15,
      height: (props !== undefined && props !== null && typeof props.size === 'number') ? props.size : 15,
      viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true',
    },
    h('path', { d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    h('circle', { cx: 12, cy: 12, r: 3, stroke: 'currentColor', strokeWidth: 1.8 }))

    /* ── Icônes du menu unifié (refonte 30/09) — tracés Lucide, comme le reste
       du pied : chaque entrée du menu porte son glyphe, l'apparence seule a un
       segment clair/sombre au lieu d'une icône. ── */
    const svgIcon = (paths, props) => h('svg', {
      width: (props !== undefined && props !== null && typeof props.size === 'number') ? props.size : 18,
      height: (props !== undefined && props !== null && typeof props.size === 'number') ? props.size : 18,
      viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true',
    }, paths())

    const BellIcon = (props) => svgIcon(() => [
      h('path', { key: 'b', d: 'M6 9a6 6 0 0 1 12 0c0 5 2 6 2 7H4c0-1 2-2 2-7z', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      h('path', { key: 'c', d: 'M10 20a2 2 0 0 0 4 0', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    ], props)

    const UserIcon = (props) => svgIcon(() => [
      h('circle', { key: 'a', cx: 12, cy: 8, r: 4, stroke: 'currentColor', strokeWidth: 1.75 }),
      h('path', { key: 'b', d: 'M4 21c0-4 3.6-7 8-7s8 3 8 7', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    ], props)

    const GiftMenuIcon = (props) => svgIcon(() => [
      h('rect', { key: 'a', x: 3, y: 8, width: 18, height: 4, rx: 1, stroke: 'currentColor', strokeWidth: 1.75 }),
      h('path', { key: 'b', d: 'M12 8v13M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    ], props)

    const ShieldIcon = (props) => svgIcon(() => [
      h('path', { key: 'a', d: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    ], props)

    const SunMenuIcon = (props) => svgIcon(() => [
      h('circle', { key: 'a', cx: 12, cy: 12, r: 4, stroke: 'currentColor', strokeWidth: 1.75 }),
      h('path', { key: 'b', d: 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' }),
    ], props)

    const MoonMenuIcon = (props) => svgIcon(() => [
      h('path', { key: 'a', d: 'M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    ], props)

    const ExtIcon = (props) => svgIcon(() => [
      h('path', { key: 'a', d: 'M7 17L17 7M8 7h9v9', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    ], props)

    const MsgMenuIcon = (props) => svgIcon(() => [
      h('path', { key: 'a', d: 'M4 5h16v11H9l-5 4z', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    ], props)

    const OutIcon = (props) => svgIcon(() => [
      h('path', { key: 'a', d: 'M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M15 8l4 4-4 4M19 12H9', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    ], props)

    const BuildingIcon = (props) => svgIcon(() => [
      h('path', { key: 'a', d: 'M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M14 10h5a1 1 0 0 1 1 1v10M2 21h20M8 8h2M8 12h2M8 16h2', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    ], props)

    const CheckIcon = (props) => svgIcon(() => [
      h('path', { key: 'a', d: 'M5 12.5l4.5 4.5L19 7', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    ], props)

    const PlusIcon = (props) => svgIcon(() => [
      h('path', { key: 'a', d: 'M12 5v14M5 12h14', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' }),
    ], props)

    const ContrastIcon = (props) => svgIcon(() => [
      h('circle', { key: 'a', cx: 12, cy: 12, r: 9, stroke: 'currentColor', strokeWidth: 1.75 }),
      h('path', { key: 'b', d: 'M12 3v18M12 3a9 9 0 0 1 0 18z', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' }),
    ], props)

    const GlobeIcon = (props) => svgIcon(() => [
      h('circle', { key: 'a', cx: 12, cy: 12, r: 9, stroke: 'currentColor', strokeWidth: 1.75 }),
      h('path', { key: 'b', d: 'M3 12h18M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9z', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' }),
    ], props)

    const HelpIcon = (props) => svgIcon(() => [
      h('circle', { key: 'a', cx: 12, cy: 12, r: 9, stroke: 'currentColor', strokeWidth: 1.75 }),
      h('path', { key: 'b', d: 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5M12 17h.01', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    ], props)

    /** Initiales pour l'avatar : deux lettres au plus, jamais vides. */
    const initiales = (nom, email) => {
      const nomPropre = typeof nom === 'string' ? nom.trim() : ''
      const local = typeof email === 'string' && email.indexOf('@') > 0 ? email.slice(0, email.indexOf('@')) : ''
      const brut = nomPropre !== '' ? nomPropre : local
      const tokens = brut.split(/[\s._-]+/).filter((m) => m !== '')
      if (tokens.length === 0) return '?'
      if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase()
      return (tokens[0].charAt(0) + tokens[1].charAt(0)).toUpperCase()
    }

    /** Base locale des routes du half host (même calcul que kybernos-plugin). */
    const apiBase = () => {
      try { return new URL('kybernos-cloud', document.baseURI).pathname.replace(/\/$/, '') } catch (e) { return '/kybernos-cloud' }
    }

    const callLocal = async (path, method, payload) => {
      const res = await fetch(apiBase() + path, {
        method: method === undefined ? 'GET' : method,
        headers: { 'content-type': 'application/json' },
        body: method === 'POST' ? JSON.stringify(payload === undefined ? {} : payload) : undefined,
      })
      const body = await res.json().catch(() => null)
      if (body === null || typeof body !== 'object') return { ok: false, error: 'reponse illisible' }
      return body
    }

    // ── Profil local (onglet Account des Réglages, 30/09 soir) ─────────────
    // Les champs naissance / localisation / langue / instructions de la page
    // profil de la webapp vivent dans SON navigateur (store local, le serveur
    // ne les sert pas). DSH fait de même côté apparail : localStorage, jamais
    // de réseau. Le jour où une route serveur les rend, seul ceReadWrite
    // change.
    const KB_ACC_KEY = 'kb8.account-profile'
    const kbAccVide = () => ({ name: '', birth: '', location: '', language: '', instructions: '', color: '', photo: '', tz: '' })
    const kbAccRead = () => {
      try {
        const j = JSON.parse(window.localStorage.getItem(KB_ACC_KEY) || 'null')
        if (j !== null && typeof j === 'object') {
          const vide = kbAccVide()
          const lu = {}
          for (const k of Object.keys(vide)) lu[k] = typeof j[k] === 'string' ? j[k] : ''
          return lu
        }
      } catch (e) { /* stockage indisponible : champs vides */ }
      return kbAccVide()
    }
    const kbAccWrite = (valeur) => {
      try { window.localStorage.setItem(KB_ACC_KEY, JSON.stringify(valeur)); return true } catch (e) { return false }
    }

    return {
      // On ne déclare QUE `slots` (seul service indispensable) : `locale` est
      // lu avec `ctx.get()` et garde un repli français, comme dans
      // kybernos-plugin, pour qu'une locale absente ne bloque pas le montage.
      inject: ['slots'],
      apply(ctx) {
        const slots = ctx.get('slots')
        // `layout.selectPanel(key)` ouvre la zone de contenu ; la page doit être
        // enregistrée dans le slot `main` sous la même clé. Lu par ctx.get, comme
        // le fait le plugin Kybernos (aucune injection à déclarer).
        const layoutSvc = ctx.get('layout')
        if (slots === undefined || slots === null) {
          console.error('[kybernos-cloud] service slots indisponible: pas d interface')
          return
        }
        const localeSvc = ctx.get('locale')

        const lang = () => {
          try {
            if (localeSvc === undefined || localeSvc === null || typeof localeSvc.getLocale !== 'function') return 'fr'
            const snap = localeSvc.getLocale()
            if (snap === null || snap === undefined) return 'fr'
            // (01/10) La snapshot du service `locale` porte sa valeur dans
            // `active` (mesuré : kbLocaleRead du plugin la lit ainsi) — les
            // champs ci-dessous n'ont jamais existé et laissaient le bundle
            // en français même quand le shell réglé en anglais.
            const raw = snap.active || snap.locale || snap.current || snap.lang || snap.id
            return typeof raw === 'string' && raw.toLowerCase().indexOf('en') === 0 ? 'en' : 'fr'
          } catch (e) { return 'fr' }
        }
        const t = (key) => {
          const dict = DICT[lang()] || DICT.fr
          if (dict[key] !== undefined) return dict[key]
          return DICT.fr[key] !== undefined ? DICT.fr[key] : key
        }
        // Statut de la capture de fin de tour : la carte affichait l'identifiant
        // interne tel quel (« rien_a_retenir », constat de la campagne visuelle).
        // Les valeurs connues sont nommees, le reste est humanise plutot que
        // rendu en snake_case.
        const memoCaptureLabel = (raw) => {
          const k = (raw === null || raw === undefined) ? '' : String(raw)
          const corps = (k === 'rien_a_retenir' || k === 'nothing_to_keep')
            ? t('memoCaptureNothing')
            : (k === '' ? t('memoCaptureUnknown') : k.replace(/_/g, ' '))
          return t('memoCapture') + ' ' + corps
        }

        const fmtDate = (iso) => {
          if (typeof iso !== 'string' || iso === '') return null
          const d = new Date(iso)
          if (Number.isNaN(d.getTime())) return null
          return d.toLocaleDateString(lang() === 'en' ? 'en-GB' : 'fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
        }

        // Nom affiché. `kybernos_users.name` est vide pour l'instant : AUCUN
        // chemin produit ne l'écrit (l'écran Profils garde le nom en local).
        // Plutôt qu'un « — » muet, on montre la partie locale de l'email —
        // marquée comme un repli (grisée + info-bulle) pour ne pas faire
        // passer un dérivé pour le vrai nom. Dès qu'un nom existe (saisi côté
        // Kybernos, ou rafraîchi par /v1/me), c'est lui qui s'affiche.
        const displayName = (user) => {
          const name = typeof user.name === 'string' ? user.name.trim() : ''
          if (name !== '') return { value: name, fallback: false }
          const email = typeof user.email === 'string' ? user.email.trim() : ''
          const at = email.indexOf('@')
          const local = at > 0 ? email.slice(0, at) : ''
          return local !== ''
            ? { value: local, fallback: true }
            : { value: '', fallback: false }
        }

        const Row = (props) => h('div', { className: 'kbc-row' },
          h('span', { className: 'kbc-k' }, props.label),
          h('span', {
            className: props.fallback === true ? 'kbc-v kbc-v-fallback' : 'kbc-v',
            title: props.hint,
          }, props.value))

        const CloudCard = (props) => {
          const [view, setView] = React.useState({ phase: 'loading' })
          const [copied, setCopied] = React.useState(false)
          const [syncing, setSyncing] = React.useState(false)
          const [chatsBusy, setChatsBusy] = React.useState(false)
          // Mémoire du compte : chargée à part, jamais bloquante pour la carte.
          const [memo, setMemo] = React.useState({ phase: 'idle' })
          const [memoBusy, setMemoBusy] = React.useState(null)
          const [memoNote, setMemoNote] = React.useState(null)
          const [memoReport, setMemoReport] = React.useState(null)
          const [memoDraft, setMemoDraft] = React.useState('')
          const [memoKind, setMemoKind] = React.useState('fact')
          const [memoPinned, setMemoPinned] = React.useState(false)
          const liveRef = React.useRef(true)
          // Page profil : section active du menu (Compte, Parrinage…) et
          // parrainage chargé paresseusement, seulement en mode page.
          const [sect, setSect] = React.useState('compte')
          const [referral, setReferral] = React.useState({ phase: 'idle' })
          const [refCopied, setRefCopied] = React.useState(false)

          const refCharge = React.useRef(false)
          React.useEffect(() => {
            if (props.page !== true || view.phase !== 'connected' || refCharge.current === true) return
            refCharge.current = true
            setReferral({ phase: 'loading' })
            callLocal('/referral', 'GET')
              .then((r) => { if (liveRef.current === true) setReferral({ phase: 'ready', data: r }) })
              .catch(() => { if (liveRef.current === true) setReferral({ phase: 'error' }) })
          }, [props.page, view.phase])

          const memoMap = () => {
            const data = memo.phase === 'ready' ? memo.data : null
            return data !== null && data !== undefined && data.map !== undefined && data.map !== null ? data.map : {}
          }

          React.useEffect(() => () => { liveRef.current = false }, [])

          const settle = (next) => {
            if (liveRef.current !== true) return
            setView(next)
            // La pastille du bouton suit l'etat de la carte sans attendre une
            // fermeture/reouverture (sinon elle resterait verte apres
            // « Se deconnecter »).
            if (typeof props.onConnection === 'function') props.onConnection(next.phase === 'connected')
          }

          const load = React.useCallback(async () => {
            const status = await callLocal('/status', 'GET')
            if (status.connected === true) {
              const fresh = await callLocal('/refresh', 'POST')
              if (fresh.connected === true) return settle({ phase: 'connected', state: fresh.state })
              if (fresh.status === 'revoked') return settle({ phase: 'revoked' })
              // Réseau indisponible : on garde le profil en cache.
              if (status.state !== undefined && status.state !== null) return settle({ phase: 'connected', state: status.state, stale: true })
              return settle({ phase: 'error', error: fresh.error || 'profil_indisponible' })
            }
            if (status.status === 'pending') return settle({ phase: 'pairing', pairing: status.pairing })
            return settle({ phase: 'disconnected' })
          }, [])

          React.useEffect(() => { void load() }, [load])

          // La carte ne se fermait qu'au clic hors d'elle : Echap ne repondait
          // pas (constat de la campagne visuelle). On ecoute la touche tant que
          // la carte est montee.
          React.useEffect(() => {
            const onKey = (ev) => { if (ev.key === 'Escape') props.onClose() }
            window.addEventListener('keydown', onKey)
            return () => window.removeEventListener('keydown', onKey)
          }, [props.onClose])

          // Appairage : on interroge le half host toutes les 2 s jusqu'au claim.
          React.useEffect(() => {
            if (view.phase !== 'pairing') return undefined
            const id = window.setInterval(async () => {
              const res = await callLocal('/poll', 'POST')
              if (res.connected === true) return settle({ phase: 'connected', state: res.state })
              if (res.status === 'pending') return
              if (res.status === 'denied') return settle({ phase: 'disconnected', note: 'denied' })
              if (res.status === 'expired') return settle({ phase: 'disconnected', note: 'expired' })
              settle({ phase: 'error', error: res.error || 'reseau' })
            }, 2000)
            return () => window.clearInterval(id)
          }, [view.phase])

          const connect = async () => {
            setView({ phase: 'loading' })
            const res = await callLocal('/start', 'POST')
            if (res.ok === false) return settle({ phase: 'error', error: res.error || 'demarrage_impossible' })
            if (res.connected === true) return settle({ phase: 'connected', state: res.state })
            settle({ phase: 'pairing', pairing: res.pairing })
          }

          // Ouverture depuis le CTA « Se connecter » du pied : l'appairage
          // démarre tout de suite, UNE seule fois — sans ce verrou, une
          // annulation ramènerait l'état à `disconnected` et relancerait la
          // demande en boucle.
          const autoRef = React.useRef(false)
          React.useEffect(() => {
            if (props.autoStart !== true || autoRef.current === true) return
            if (view.phase !== 'disconnected' && view.phase !== 'revoked') return
            autoRef.current = true
            void connect()
          }, [view.phase])

          const cancel = async () => {
            await callLocal('/disconnect', 'POST', { confirm: true })
            settle({ phase: 'disconnected' })
          }

          const disconnect = async () => {
            setView({ phase: 'loading' })
            await callLocal('/disconnect', 'POST', { confirm: true })
            settle({ phase: 'disconnected' })
          }

          // Catalogue LiteLLM : resynchronisation manuelle (l'import automatique
          // a déjà eu lieu à la connexion — bouton « Réimporter » pour rattraper
          // un catalogue indisponible ou de nouveaux modèles côté Kybernos).
          const resync = async () => {
            setSyncing(true)
            let failure = null
            try {
              const res = await callLocal('/models/sync', 'POST')
              if (res.ok !== true) failure = res.error || 'reseau'
            } catch (e) { failure = 'reseau' }
            await load()
            // Après le reload : un échec du sync s'affiche (le reload efface
            // tout autre état transitoire), un succès repart propre.
            if (failure !== null && liveRef.current === true) {
              setView((prev) => Object.assign({}, prev, { syncError: failure }))
            }
            setSyncing(false)
          }

          const copy = async () => {
            const code = view.pairing !== undefined && view.pairing !== null ? view.pairing.user_code : null
            if (typeof code !== 'string' || code === '') return
            try { await navigator.clipboard.writeText(code); setCopied(true) } catch (e) { /* presse-papier refuse */ }
          }

          // ── Chats DSH → webapp (annuaire de sessions) ─────────────────────
          // Un envoi explicite : la route hôte scanne ~/.dsh/sessions (id,
          // projet, date — jamais le contenu) et pousse vers /v1/dsh/sessions.
          const pushChats = async () => {
            setChatsBusy(true)
            let failure = null
            try {
              const res = await callLocal('/chats/push', 'POST')
              if (res.ok !== true) failure = res.error || 'reseau'
            } catch (e) { failure = 'reseau' }
            await load()
            if (liveRef.current === true) {
              setView((prev) => Object.assign({}, prev, { chatsError: failure }))
            }
            setChatsBusy(false)
          }

          // ── Mémoire du compte (fonctionnalité cloud n°2) ──────────────────
          // La carte ne lit QUE des résumés via les routes locales ; le jeton
          // ne sort jamais du half host. Les souvenirs sont chargés à
          // l'ouverture de la carte (jamais hors connexion).
          const loadMemo = React.useCallback(async () => {
            const res = await callLocal('/memory', 'GET')
            if (liveRef.current !== true) return
            if (res.ok !== true) return setMemo({ phase: 'error', error: res.error || 'reseau' })
            setMemo({ phase: 'ready', data: res })
          }, [])

          React.useEffect(() => {
            if (view.phase !== 'connected') return
            setMemo({ phase: 'loading' })
            void loadMemo()
          }, [view.phase, loadMemo])

          const memoAct = async (path, body, busyKey) => {
            setMemoBusy(busyKey)
            let failure = null
            try {
              const res = await callLocal(path, 'POST', body)
              if (res.ok !== true) failure = res.error || 'refus'
            } catch (e) { failure = 'reseau' }
            await loadMemo()
            if (liveRef.current === true) setMemoNote(failure === null ? null : failure)
            setMemoBusy(null)
          }

          const memoPin = (m) => memoAct('/memory/update', { id: m.id, pinned: m.pinned !== true }, 'pin-' + String(m.id))
          const memoForget = (m) => memoAct('/memory/delete', { id: m.id }, 'del-' + String(m.id))

          const memoAdd = async () => {
            const content = memoDraft.trim()
            if (content === '') return
            setMemoBusy('add')
            let failure = null
            try {
              const res = await callLocal('/memory/add', 'POST', { content, kind: memoKind, scope: 'account', source: 'taught', pinned: memoPinned })
              if (res.ok !== true) failure = res.error || 'refus'
            } catch (e) { failure = 'reseau' }
            if (failure === null) { setMemoDraft(''); setMemoPinned(false) }
            await loadMemo()
            if (liveRef.current === true) setMemoNote(failure === null ? t('memoAdded') : failure)
            setMemoBusy(null)
          }

          // Poussée des leçons : la route est `dryRun` par défaut. On montre
          // d'abord ce qui monterait, on n'écrit qu'au second clic.
          const memoPush = async (dry) => {
            setMemoBusy(dry ? 'dry' : 'push')
            let failure = null
            let report = null
            try {
              const res = await callLocal('/memory/lessons', 'POST', { dryRun: dry })
              if (res.ok !== true) failure = res.error || 'refus'
              else report = res.report
            } catch (e) { failure = 'reseau' }
            await loadMemo()
            if (liveRef.current === true) {
              if (failure !== null) setMemoNote(failure)
              else { setMemoReport(report); setMemoNote(null) }
            }
            setMemoBusy(null)
          }

          const memoLink = (local, cloud) => memoAct('/memory/map', { map: Object.assign({}, memoMap(), { [local]: cloud }) }, 'map-' + local)

          const openPage = () => {
            const url = view.pairing !== undefined && view.pairing !== null ? view.pairing.activation_url : null
            if (typeof url === 'string' && url !== '') window.open(url, '_blank', 'noopener,noreferrer')
          }

          const header = h('div', { className: 'kbc-head' },
            h('span', { className: 'kbc-title' }, t('menu')),
            h('button', { type: 'button', className: 'kbc-x', onClick: props.onClose, 'aria-label': t('close') }, '\u00d7'))

          const body = []

          if (view.phase === 'loading') {
            body.push(h('div', { className: 'kbc-body', key: 'b' }, t('loading')))
          } else if (view.phase === 'disconnected') {
            body.push(h('div', { className: 'kbc-body', key: 'b' }, t('subtitle')))
            if (view.note === 'expired' || view.note === 'denied') {
              body.push(h('div', { className: 'kbc-note kbc-warn', key: 'n' }, t('revokedBody')))
            }
            body.push(h('div', { className: 'kbc-actions', key: 'a' },
              h('button', { type: 'button', className: 'kbc-btn-primary', onClick: connect }, t('connect'))))
          } else if (view.phase === 'pairing') {
            const pairing = view.pairing !== undefined && view.pairing !== null ? view.pairing : {}
            body.push(h('div', { className: 'kbc-body', key: 'b' }, t('pairingBody')))
            body.push(h('div', { className: 'kbc-code', key: 'c' }, pairing.user_code || t('none')))
            if (pairing.expires_at !== undefined && pairing.expires_at !== null) {
              body.push(h(Row, { key: 'e', label: t('session'), value: fmtDate(pairing.expires_at) || t('none') }))
            }
            body.push(h('div', { className: 'kbc-actions', key: 'a' },
              h('button', { type: 'button', className: 'kbc-btn-primary', onClick: openPage }, t('openPage')),
              h('button', { type: 'button', className: 'kbc-btn-ghost', onClick: copy }, copied ? t('copied') : t('copyCode')),
              h('button', { type: 'button', className: 'kbc-btn-ghost', onClick: cancel }, t('cancel'))))
            body.push(h('div', { className: 'kbc-note', key: 'w' }, t('waiting')))
          } else if (view.phase === 'connected') {
            const st = view.state !== undefined && view.state !== null ? view.state : {}
            const user = st.user !== undefined && st.user !== null ? st.user : {}
            const workspaces = Array.isArray(st.workspaces) ? st.workspaces : []
            const shownName = displayName(user)
            body.push(h('div', { className: 'kbc-rows', key: 'r' },
              h(Row, { label: t('email'), value: user.email || t('none') }),
              h(Row, {
                label: t('name'),
                value: shownName.value !== '' ? shownName.value : t('none'),
                fallback: shownName.fallback,
                hint: shownName.fallback ? t('nameFallback') : undefined,
              }),
              h(Row, { label: t('plan'), value: user.plan || t('none') }),
              h(Row, { label: t('device'), value: st.device_label || t('none') }),
              h(Row, { label: t('session'), value: st.expires_at !== undefined && st.expires_at !== null ? fmtDate(st.expires_at) : t('connected') })))
            body.push(h('div', { key: 'wl' },
              h('div', { className: 'kbc-note', style: { marginTop: '12px' } }, t('workspaces')),
              h('div', { className: 'kbc-ws' }, workspaces.length === 0
                ? h('div', { className: 'kbc-note' }, t('none'))
                : workspaces.map((ws, i) => h('div', { className: 'kbc-ws-item', key: String(ws.id || i) },
                  h('span', null, ws.name || t('none')),
                  h('span', { className: 'kbc-badge' }, String(ws.kyber_count === undefined ? 0 : ws.kyber_count) + ' ' + t('kybers')))))))
            if (view.stale === true) body.push(h('div', { className: 'kbc-note kbc-warn', key: 's' }, t('errorTitle')))
            // Catalogue Kybernos LiteLLM importé automatiquement à la connexion :
            // combien de modèles, pour quelle formule, et un bouton pour forcer
            // une resynchronisation. La carte ne lit QUE des résumés — le
            // détail (ids) reste dans la route /kybernos-cloud/models.
            const models = st.models !== undefined && st.models !== null ? st.models : null
            const modelsCount = models !== null && typeof models.count === 'number' ? models.count : 0
            body.push(h('div', { key: 'mdl' },
              h('div', { className: 'kbc-note', style: { marginTop: '12px' } }, t('models')),
              h('div', { className: 'kbc-ws' },
                h('div', { className: 'kbc-ws-item' },
                  h('span', null, modelsCount > 0
                    ? String(modelsCount) + ' · ' + (models.plan || t('none'))
                    : t('modelsUnavailable')),
                  h('button', {
                    type: 'button',
                    className: 'kbc-btn-ghost',
                    onClick: resync,
                    disabled: syncing === true,
                  }, syncing === true ? t('modelsImporting') : (modelsCount > 0 ? t('modelsReimport') : t('modelsImport'))))),
              h('div', { className: 'kbc-note' }, t('modelsNote')),
              models !== null && models.settings !== true
                ? h('div', { className: 'kbc-note kbc-warn' }, t('modelsWarn'))
                : null,
              view.syncError !== undefined && view.syncError !== null
                ? h('div', { className: 'kbc-note kbc-err' }, t('modelsSyncFail'))
                : null))
            // Chats DSH → webapp : un envoi explicite de l'annuaire des
            // sessions (id, projet, date — jamais le contenu des conversations).
            const lastPush = st.chats_last_push !== undefined && st.chats_last_push !== null ? st.chats_last_push : null
            body.push(h('div', { key: 'chats' },
              h('div', { className: 'kbc-note', style: { marginTop: '12px' } }, t('chatsTitle')),
              h('div', { className: 'kbc-ws' },
                h('div', { className: 'kbc-ws-item' },
                  h('span', null, lastPush !== null && lastPush.ok === true
                    ? t('chatsLast') + ' · ' + String(lastPush.pushed === undefined ? 0 : lastPush.pushed)
                    : (lastPush !== null && lastPush.ok === false ? t('chatsFail') : '—')),
                  h('button', {
                    type: 'button',
                    className: 'kbc-btn-ghost',
                    onClick: pushChats,
                    disabled: chatsBusy === true,
                  }, chatsBusy === true ? t('chatsPushing') : t('chatsPush')))),
              h('div', { className: 'kbc-note' }, t('chatsNote')),
              view.chatsError !== undefined && view.chatsError !== null
                ? h('div', { className: 'kbc-note kbc-err' }, t('chatsFail'))
                : null))
            body.push(h('div', { key: 'memo' },
              h('div', { className: 'kbc-note', style: { marginTop: '12px' } }, t('memoTitle')),
              memo.phase === 'loading' || memo.phase === 'idle'
                ? h('div', { className: 'kbc-note' }, t('memoLoading'))
                : memo.phase === 'error'
                  ? h('div', { className: 'kbc-note kbc-err' }, t('memoFail'))
                  : h('div', null,
                    memo.data.account.length === 0
                      ? h('div', { className: 'kbc-note' }, t('memoEmpty'))
                      : h('div', { className: 'kbc-ws' }, memo.data.account.map((m) => h('div', { className: 'kbc-ws-item', key: 'm' + String(m.id) },
                        h('span', null,
                          h('span', { className: 'kbc-badge', style: { marginRight: '6px' } }, t('memoKind' + String(m.kind).charAt(0).toUpperCase() + String(m.kind).slice(1))),
                          m.pinned === true ? h('span', { className: 'kbc-badge', style: { marginRight: '6px' } }, t('memoPinned')) : null,
                          String(m.content)),
                        h('span', null,
                          h('button', { type: 'button', className: 'kbc-btn-ghost', disabled: memoBusy !== null, onClick: () => memoPin(m) },
                            m.pinned === true ? t('memoUnpin') : t('memoPin')),
                          h('button', { type: 'button', className: 'kbc-btn-ghost', disabled: memoBusy !== null, onClick: () => memoForget(m) }, t('memoForget')))))),
                    // Ajouter un souvenir à la main : le même chemin que l'outil
                    // `memory_write`, mais décidé par l'utilisateur.
                    h('div', { className: 'kbc-actions', style: { marginTop: '8px' } },
                      h('input', {
                        type: 'text',
                        className: 'kbc-input',
                        placeholder: t('memoTeach'),
                        value: memoDraft,
                        onChange: (e) => setMemoDraft(e.target.value),
                      }),
                      h('select', {
                        className: 'kbc-input',
                        value: memoKind,
                        onChange: (e) => setMemoKind(e.target.value),
                      }, ['fact', 'preference', 'event', 'policy'].map((k) => h('option', { key: k, value: k }, t('memoKind' + k.charAt(0).toUpperCase() + k.slice(1))))),
                      h('button', { type: 'button', className: 'kbc-btn-ghost', disabled: memoBusy !== null, onClick: () => setMemoPinned(memoPinned !== true) },
                        (memoPinned === true ? '★ ' : '☆ ') + t('memoPin')),
                      h('button', { type: 'button', className: 'kbc-btn-primary', disabled: memoBusy !== null || memoDraft.trim() === '', onClick: memoAdd }, t('memoAdd'))),
                    h('div', { className: 'kbc-note' }, t('memoNote')),
                    // Correspondance kybers locaux ↔ cloud : explicite, jamais
                    // devinée (les identifiants n'ont rien en commun).
                    h('div', { className: 'kbc-note', style: { marginTop: '10px' } }, t('memoKybers')),
                    h('div', { className: 'kbc-ws' }, (memo.data.locals || []).map((local) => h('div', { className: 'kbc-ws-item', key: 'k' + local },
                      h('span', null, local + '  ·  ' + String((memo.data.lessonCounts || {})[local] || 0) + ' leçons'),
                      h('select', {
                        className: 'kbc-input',
                        value: memoMap()[local] !== undefined ? memoMap()[local] : '',
                        disabled: memoBusy !== null,
                        onChange: (e) => memoLink(local, e.target.value),
                      }, [h('option', { key: '', value: '' }, t('memoNoLink'))].concat((memo.data.cloud || []).map((c) => h('option', { key: c.id, value: c.id }, String(c.name) + ' (' + String(c.memoryCount) + ')'))))))),
                    h('div', { className: 'kbc-note' }, t('memoKybersNote')),
                    h('div', { className: 'kbc-actions', style: { marginTop: '8px' } },
                      h('button', { type: 'button', className: 'kbc-btn-ghost', disabled: memoBusy !== null, onClick: () => memoPush(true) }, t('memoLessonsDry')),
                      h('button', { type: 'button', className: 'kbc-btn-ghost', disabled: memoBusy !== null, onClick: () => memoPush(false) }, t('memoLessons'))),
                    h('div', { className: 'kbc-note' }, t('memoLessonsNote')),
                    // La capture de fin de tour est fail-open : sans cet etat
                    // affiche, « rien a retenir » et « indisponible » se
                    // ressembleraient exactement.
                    memo.data.capture !== undefined && memo.data.capture !== null
                      ? h('div', { className: 'kbc-note' }, memoCaptureLabel(memo.data.capture.status))
                      : null,
                    memoNote !== null ? h('div', { className: 'kbc-note' }, String(memoNote)) : null,
                    memoReport !== null
                      ? h('div', { className: 'kbc-note' }, memoReport.filter((r) => r.added > 0 || r.error !== null).length === 0
                        ? t('memoLessonsNone')
                        : memoReport.map((r) => r.local + ' → ' + r.cloud + ' : +' + String(r.added) + ' · ' + String(r.skipped) + ' déjà' + (r.error !== null ? ' · ' + String(r.error) : '')).join(' · '))
                      : null)))
            body.push(h('div', { className: 'kbc-actions', key: 'a' },
              h('button', { type: 'button', className: 'kbc-btn-ghost', onClick: load }, t('refresh')),
              h('button', { type: 'button', className: 'kbc-btn-ghost', onClick: disconnect }, t('disconnect'))))
          } else if (view.phase === 'revoked') {
            body.push(h('div', { className: 'kbc-body kbc-warn', key: 'b' }, t('revokedTitle')))
            body.push(h('div', { className: 'kbc-note', key: 'n' }, t('revokedBody')))
            body.push(h('div', { className: 'kbc-actions', key: 'a' },
              h('button', { type: 'button', className: 'kbc-btn-primary', onClick: connect }, t('reconnect'))))
          } else {
            body.push(h('div', { className: 'kbc-body kbc-err', key: 'b' }, t('errorTitle')))
            body.push(h('div', { className: 'kbc-note', key: 'n' }, String(view.error || '')))
            body.push(h('div', { className: 'kbc-actions', key: 'a' },
              h('button', { type: 'button', className: 'kbc-btn-primary', onClick: load }, t('retry'))))
          }

          // ── Mode PAGE (clic sur le nom dans le pied de sidebar) ──────────
          // Page profil PLEIN CADRE avec le menu de sections de Kybernos :
          // Compte · Parrainage · Apparence · Sécurité · Données &
          // confidentialité · Support & légal, puis Se déconnecter. Chaque
          // section ne rend que ce que ce poste sait VRAIMENT — rien
          // d'inventé, les pages hébergées sont des liens explicites.
          if (props.page === true) {
            const st = view.phase === 'connected' && view.state !== undefined && view.state !== null ? view.state : null
            const pu = st !== null && st.user !== undefined && st.user !== null ? st.user : {}
            const pn = displayName(pu)
            const identite = pn.value !== '' ? pn.value : (pu.email || t('none'))
            const formule = typeof pu.plan === 'string' && pu.plan !== '' ? pu.plan : null
            const web = st !== null && typeof st.web_url === 'string' && st.web_url !== '' ? st.web_url : null

            let contenu = null
            if (view.phase !== 'connected') {
              // Hors connexion, la page garde le menu mais montre la fiche
              // (appairage, connexion) : le parcours reste complet.
              contenu = h('div', { className: 'kbp-card kbp-sec' }, body)
            } else {
              const SECTIONS = [
                { id: 'compte', label: t('profCompte') },
                { id: 'parrainage', label: t('profParrain') },
                { id: 'apparence', label: t('profApparence') },
                { id: 'securite', label: t('profSecurite') },
                { id: 'donnees', label: t('profDonnees') },
                { id: 'support', label: t('profSupport') },
              ]
              const workspaces = Array.isArray(st.workspaces) ? st.workspaces : []
              const models = st.models !== undefined && st.models !== null ? st.models : null
              const modelsCount = models !== null && typeof models.count === 'number' ? models.count : 0
              // Chats DSH → webapp : le même bloc que la fiche modale, rendu
              // dans l’onglet Compte de la page — le clic sur le nom du pied
              // ouvre CETTE page, la modale n’est pas le chemin réel.
              const lastPush = st.chats_last_push !== undefined && st.chats_last_push !== null ? st.chats_last_push : null

              let section = null
              if (sect === 'compte') {
                section = h('div', { className: 'kbp-card kbp-sec' },
                  h('div', { className: 'kbs-sect' }, t('profCompte')),
                  h('div', { className: 'kbc-rows' },
                    h(Row, { label: t('email'), value: pu.email || t('none') }),
                    h(Row, {
                      label: t('name'),
                      value: pn.value !== '' ? pn.value : t('none'),
                      fallback: pn.fallback,
                      hint: pn.fallback ? t('nameFallback') : undefined,
                    }),
                    h(Row, { label: t('plan'), value: pu.plan || t('none') }),
                    h(Row, { label: t('workspaces'), value: String(workspaces.length) })),
                  h('div', { className: 'kbc-note', style: { marginTop: '12px' } }, t('models')),
                  h('div', { className: 'kbc-ws' },
                    h('div', { className: 'kbc-ws-item' },
                      h('span', null, modelsCount > 0 ? String(modelsCount) + ' · ' + (models.plan || t('none')) : t('modelsUnavailable')),
                      h('button', { type: 'button', className: 'kbc-btn-ghost', onClick: resync, disabled: syncing === true },
                        syncing === true ? t('modelsImporting') : (modelsCount > 0 ? t('modelsReimport') : t('modelsImport'))))),
                  h('div', { className: 'kbc-note' }, t('modelsNote')),
                  h('div', { className: 'kbc-note', style: { marginTop: '12px' } }, t('chatsTitle')),
                  h('div', { className: 'kbc-ws' },
                    h('div', { className: 'kbc-ws-item' },
                      h('span', null, lastPush !== null && lastPush.ok === true
                        ? t('chatsLast') + ' · ' + String(lastPush.pushed === undefined ? 0 : lastPush.pushed)
                        : (lastPush !== null && lastPush.ok === false ? t('chatsFail') : '—')),
                      h('button', { type: 'button', className: 'kbc-btn-ghost', onClick: pushChats, disabled: chatsBusy === true },
                        chatsBusy === true ? t('chatsPushing') : t('chatsPush')))),
                  h('div', { className: 'kbc-note' }, t('chatsNote')),
                  view.chatsError !== undefined && view.chatsError !== null
                    ? h('div', { className: 'kbc-note kbc-err' }, t('chatsFail'))
                    : null)
              } else if (sect === 'parrainage') {
                const refOk = referral.phase === 'ready' && referral.data !== null && referral.data.ok === true
                const copier = async () => {
                  const lien = refOk === true && typeof referral.data.share_url === 'string' ? referral.data.share_url : ''
                  if (lien === '') return
                  try { await navigator.clipboard.writeText(lien); setRefCopied(true) } catch (e) { /* presse-papier refuse */ }
                }
                section = h('div', { className: 'kbp-card kbp-sec' },
                  h('div', { className: 'kbs-sect' }, t('refTitle')),
                  referral.phase === 'loading'
                    ? h('div', { className: 'kbc-note' }, t('loading'))
                    : refOk !== true
                      ? h('div', { className: 'kbc-note kbc-warn' }, t('refNone') + (referral.phase === 'ready' && typeof referral.data.motif === 'string' ? ' — ' + referral.data.motif : ''))
                      : h('div', { className: 'kbc-rows' },
                        h(Row, { label: t('refCode'), value: referral.data.code || t('none') }),
                        h(Row, { label: t('refLink'), value: referral.data.share_url || t('none') })),
                  h('div', { className: 'kbc-actions' },
                    refOk === true
                      ? h('button', { type: 'button', className: 'kbc-btn-ghost', onClick: () => { void copier() } }, refCopied === true ? t('refCopied') : t('refCopy'))
                      : null,
                    web !== null
                      ? h('a', { className: 'kbs-link', href: web + '/referral', target: '_blank', rel: 'noreferrer' }, t('refOpen'))
                      : null))
              } else if (sect === 'apparence') {
                let pack = null
                let police = null
                try {
                  const p = localStorage.getItem('kybernos.pack')
                  const f = localStorage.getItem('kybernos.font')
                  if (p !== null && p !== '') pack = p
                  if (f !== null && f !== '') police = f
                } catch (e) { /* localStorage refuse */ }
                section = h('div', { className: 'kbp-card kbp-sec' },
                  h('div', { className: 'kbs-sect' }, t('appTitle')),
                  h('div', { className: 'kbc-note', style: { margin: '10px 0 4px' } }, t('appNote')),
                  h('div', { className: 'kbc-rows' },
                    h(Row, { label: t('appPack'), value: pack !== null ? pack : t('appNone') }),
                    h(Row, { label: t('appFont'), value: police !== null ? police : t('appNone') })))
              } else if (sect === 'securite') {
                section = h('div', { className: 'kbp-card kbp-sec' },
                  h('div', { className: 'kbs-sect' }, t('secTitle')),
                  h('div', { className: 'kbc-note', style: { margin: '10px 0 4px' } }, t('secNote')),
                  h('div', { className: 'kbc-rows' },
                    h(Row, { label: t('device'), value: st.device_label || t('none') }),
                    h(Row, { label: t('session'), value: st.expires_at !== undefined && st.expires_at !== null ? fmtDate(st.expires_at) : t('connected') })),
                  h('div', { className: 'kbc-actions' },
                    h('button', { type: 'button', className: 'kbc-btn-ghost', onClick: load }, t('refresh')),
                    h('button', { type: 'button', className: 'kbc-btn-ghost', onClick: disconnect }, t('disconnect'))))
              } else if (sect === 'donnees') {
                section = h('div', { className: 'kbp-card kbp-sec' },
                  h('div', { className: 'kbs-sect' }, t('memoTitle')),
                  memo.phase === 'loading' || memo.phase === 'idle'
                    ? h('div', { className: 'kbc-note' }, t('memoLoading'))
                    : memo.phase === 'error'
                      ? h('div', { className: 'kbc-note kbc-err' }, t('memoFail'))
                      : h('div', null,
                        memo.data.account.length === 0
                          ? h('div', { className: 'kbc-note' }, t('memoEmpty'))
                          : h('div', { className: 'kbc-ws' }, memo.data.account.map((m) => h('div', { className: 'kbc-ws-item', key: 'm' + String(m.id) },
                            h('span', null,
                              h('span', { className: 'kbc-badge', style: { marginRight: '6px' } }, t('memoKind' + String(m.kind).charAt(0).toUpperCase() + String(m.kind).slice(1))),
                              m.pinned === true ? h('span', { className: 'kbc-badge', style: { marginRight: '6px' } }, t('memoPinned')) : null,
                              String(m.content)),
                            h('span', null,
                              h('button', { type: 'button', className: 'kbc-btn-ghost', disabled: memoBusy !== null, onClick: () => memoPin(m) },
                                m.pinned === true ? t('memoUnpin') : t('memoPin')),
                              h('button', { type: 'button', className: 'kbc-btn-ghost', disabled: memoBusy !== null, onClick: () => memoForget(m) }, t('memoForget')))))),
                        h('div', { className: 'kbc-actions', style: { marginTop: '8px' } },
                          h('input', {
                            type: 'text', className: 'kbc-input', placeholder: t('memoTeach'), value: memoDraft,
                            onChange: (e) => setMemoDraft(e.target.value),
                          }),
                          h('select', {
                            className: 'kbc-input', value: memoKind,
                            onChange: (e) => setMemoKind(e.target.value),
                          }, ['fact', 'preference', 'event', 'policy'].map((k) => h('option', { key: k, value: k }, t('memoKind' + k.charAt(0).toUpperCase() + k.slice(1))))),
                          h('button', { type: 'button', className: 'kbc-btn-primary', disabled: memoBusy !== null || memoDraft.trim() === '', onClick: memoAdd }, t('memoAdd'))),
                        h('div', { className: 'kbc-actions', style: { marginTop: '8px' } },
                          h('button', { type: 'button', className: 'kbc-btn-ghost', disabled: memoBusy !== null, onClick: () => memoPush(true) }, t('memoLessonsDry')),
                          h('button', { type: 'button', className: 'kbc-btn-ghost', disabled: memoBusy !== null, onClick: () => memoPush(false) }, t('memoLessons'))),
                        memoNote !== null ? h('div', { className: 'kbc-note' }, String(memoNote)) : null,
                        web !== null
                          ? h('div', { className: 'kbc-note' }, h('a', { className: 'kbs-link', href: web + '/workspace', target: '_blank', rel: 'noreferrer' }, t('wsOpenHosted')))
                          : null))
              } else {
                section = h('div', { className: 'kbp-card kbp-sec' },
                  h('div', { className: 'kbs-sect' }, t('supTitle')),
                  h('div', { className: 'kbc-note', style: { margin: '10px 0 4px' } }, t('supNote')),
                  web === null
                    ? h('div', { className: 'kbc-note' }, t('none'))
                    : h('div', { className: 'kbc-rows' },
                      h(Row, { label: t('supSupport'), value: web + '/support' }),
                      h(Row, { label: t('supPrivacy'), value: web + '/privacy' }),
                      h(Row, { label: t('supTerms'), value: web + '/terms' })),
                  h('div', { className: 'kbc-actions' },
                    web === null ? null : h('a', { className: 'kbs-link', href: web + '/support', target: '_blank', rel: 'noreferrer' }, t('supSupport'))))
              }

              contenu = h('div', { className: 'kbp-wrap' },
                h('nav', { className: 'kbp-nav', 'aria-label': t('profTitle') },
                  SECTIONS.map((s) => h('button', {
                    type: 'button', key: s.id, className: 'kbp-navbtn',
                    'aria-current': sect === s.id ? 'true' : 'false',
                    onClick: () => setSect(s.id),
                  }, s.label)),
                  h('button', {
                    type: 'button', className: 'kbp-navbtn kbp-navout',
                    onClick: () => { void disconnect() },
                  }, t('profLogout'))),
                section)
            }

            return h('div', { className: 'kbp-page' },
              h('div', { className: 'kbp-head' },
                h('span', {
                  className: 'kbf-avatar', style: { width: '42px', height: '42px', borderRadius: '10px', fontSize: '15px' },
                  'aria-hidden': 'true',
                }, initiales(pn.value, pu.email)),
                h('span', null,
                  h('h2', { className: 'kbp-title' }, identite),
                  h('span', { className: 'kbp-sub' }, t('profTitle') + (formule !== null ? ' · ' + formule : '') + (pu.email !== undefined && pu.email !== null ? ' · ' + pu.email : ''))),
                h('button', { type: 'button', className: 'kbp-back', onClick: props.onClose }, t('wsClose'))),
              contenu)
          }

          return h('div', { className: 'kbc-scrim', onClick: (e) => { if (e.target === e.currentTarget) props.onClose() } },
            h('div', { className: 'kbc-card', role: 'dialog', 'aria-label': t('menu') },
              header,
              h('div', null, body)))
        }

        // ── LE SÉLECTEUR D'ESPACE (rangée du pied) ───────────────────────────
        // La carte ouvre la LISTE (on change d'espace), l'engrenage ouvre la
        // PAGE de l'espace. C'est la maquette : carte + engrenage, au-dessus du
        // menu user qui, lui, ne bouge pas.
        const SwitchPanel = (props) => {
          // Meme regle que la carte du compte : Echap ferme le selecteur.
          React.useEffect(() => {
            const onKey = (ev) => { if (ev.key === 'Escape') props.onClose() }
            window.addEventListener('keydown', onKey)
            return () => window.removeEventListener('keydown', onKey)
          }, [props.onClose])
          // Clic DEHORS : pas de rideau (il volerait l'ancrage du popover),
          // juste un listener document qui referme.
          const popRef = React.useRef(null)
          React.useEffect(() => {
            const dehors = (ev) => {
              const n = popRef.current
              if (n !== null && n !== undefined && n.contains(ev.target) !== true) props.onClose()
            }
            document.addEventListener('mousedown', dehors)
            return () => document.removeEventListener('mousedown', dehors)
          }, [props.onClose])
          const st = props.state !== undefined && props.state !== null ? props.state : {}
          const espaces = Array.isArray(st.workspaces) ? st.workspaces : []
          const actif = typeof st.active_workspace_id === 'string' ? st.active_workspace_id : null
          const [erreur, setErreur] = React.useState('')
          const [busy, setBusy] = React.useState(false)

          const choisir = async (id) => {
            if (busy === true || id === actif) { props.onClose(); return }
            setBusy(true)
            setErreur('')
            let res = null
            try { res = await callLocal('/space/active', 'POST', { workspace_id: id }) } catch (e) { res = null }
            setBusy(false)
            if (res !== null && res.ok === true) { props.onChanged(); props.onClose(); return }
            // Un espace qu'on ne voit pas ne devient pas actif — et on le DIT.
            setErreur(t('spaceUnknown'))
          }

          // `embedded` (menu unifié, 30/09) : la liste vit DANS le menu de la
          // carte — pas de seconde boîte popover, juste le corps. Gabarit de la
          // maquette : l'espace ACTIF est une carte surélevée avec une COCHE,
          // les autres des rangées nues (nom + compte de kybers), et « Créer
          // un espace » ferme la liste.
          if (props.embedded === true) {
            return h('div', { className: 'kbfp-switchbody', ref: popRef },
              espaces.length === 0
                ? h('div', { className: 'kbc-note' }, t('none'))
                : espaces.map((w, i) => {
                  const on = w !== null && w.id === actif
                  return h('button', {
                    type: 'button', key: String((w && w.id) || i),
                    className: 'kbfp-wsitem' + (on === true ? ' on' : ''),
                    role: 'menuitem', 'aria-current': on ? 'true' : 'false', disabled: busy,
                    onClick: () => { void choisir(w && w.id) },
                  },
                  h('span', { className: 'kbfp-wstile', 'aria-hidden': 'true' }, initiales(w && w.name, '')),
                  h('span', { className: 'kbfp-wstxt' },
                    h('span', { className: 'kbfp-wsname' }, (w && w.name) || t('none')),
                    h('span', { className: 'kbfp-wssub' }, on === true
                      ? t('spaceMark')
                      : (w && w.kyber_count !== undefined ? String(w.kyber_count) + ' ' + t('kybers') : ''))),
                  on === true
                    ? h('span', { className: 'kbfp-wscheck', 'aria-hidden': 'true' }, h(CheckIcon, { size: 18 }))
                    : null)
                }),
              h('div', { className: 'kbfp-msep' }),
              h('button', {
                type: 'button', className: 'kbfp-wsitem', role: 'menuitem', onClick: props.onCreate,
              },
              h('span', { className: 'kbfp-wsplus', 'aria-hidden': 'true' }, h(PlusIcon, { size: 18 })),
              h('span', { className: 'kbfp-wstxt' },
                h('span', { className: 'kbfp-wsname' }, t('wsNewTitle')))),
              erreur !== '' ? h('div', { className: 'kbc-note kbc-warn', style: { marginTop: '8px' } }, erreur) : null)
          }

          return h('div', { className: 'kbf-pop', ref: popRef, role: 'menu', 'aria-label': t('wsSwitchTitle') },
              h('div', { className: 'kbf-poptitle' }, t('wsSwitchTitle')),
              h('div', { className: 'kbs-list' }, espaces.length === 0
                ? h('div', { className: 'kbc-note' }, t('none'))
                : espaces.map((w, i) => {
                  const on = w !== null && w.id === actif
                  return h('button', {
                    type: 'button', key: String((w && w.id) || i), className: 'kbs-item',
                    role: 'menuitem', 'aria-current': on ? 'true' : 'false', disabled: busy,
                    onClick: () => { void choisir(w && w.id) },
                  },
                  h('span', { className: 'kbf-avatar', 'aria-hidden': 'true' }, initiales(w && w.name, '')),
                  h('span', { className: 'kbs-name' }, (w && w.name) || t('none')),
                  h('span', { className: 'kbs-mark' }, on
                    ? t('spaceMark')
                    : (w && w.kyber_count !== undefined ? String(w.kyber_count) + ' ' + t('kybers') : '')))
                })),
              h('div', { className: 'kbs-sep' }),
              h('button', {
                type: 'button', className: 'kbs-item', role: 'menuitem', onClick: props.onCreate,
              },
              h('span', { className: 'kbf-wsgear', 'aria-hidden': 'true' }, '+'),
              h('span', { className: 'kbs-name' }, t('wsNewTitle'))),
              erreur !== '' ? h('div', { className: 'kbc-note kbc-warn', style: { marginTop: '8px' } }, erreur) : null)
        }

        // ── LA CRÉATION D'ESPACE (bouton « + » de la rangée) ──────────────────
        // Le serveur hébergé reste maître : la route locale transmet le nom,
        // et si la création n'est pas permise on RENVOIE vers Kybernos au
        // lieu d'inventer un espace local.
        const NewSpacePanel = (props) => {
          React.useEffect(() => {
            const onKey = (ev) => { if (ev.key === 'Escape') props.onClose() }
            window.addEventListener('keydown', onKey)
            return () => window.removeEventListener('keydown', onKey)
          }, [props.onClose])
          const [nom, setNom] = React.useState('')
          const [busy, setBusy] = React.useState(false)
          const [erreur, setErreur] = React.useState('')
          const [hosted, setHosted] = React.useState(null)

          const creer = async () => {
            if (busy === true) return
            const propre = nom.trim().slice(0, 60)
            if (propre === '') return
            setBusy(true)
            setErreur('')
            let res = null
            try { res = await callLocal('/space/create', 'POST', { name: propre }) } catch (e) { res = null }
            setBusy(false)
            if (res !== null && res.ok === true) { props.onCreated(); props.onClose(); return }
            if (res !== null && typeof res.web_url === 'string' && res.web_url !== '') { setHosted(res.web_url); return }
            setErreur(t('wsNewErr'))
          }

          return h('div', { className: 'kbc-scrim', onClick: (e) => { if (e.target === e.currentTarget) props.onClose() } },
            h('div', { className: 'kbc-card', role: 'dialog', 'aria-label': t('wsNewTitle'), style: { maxWidth: '340px' } },
              h('div', { className: 'kbs-head' },
                h('span', { className: 'kbs-who' }, h('b', null, t('wsNewTitle'))),
                h('button', { type: 'button', className: 'kbc-close', onClick: props.onClose, 'aria-label': t('close') }, '✕')),
              h('div', { className: 'kbc-body', style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
                h('input', {
                  type: 'text', className: 'kbc-input', value: nom, autoFocus: true,
                  placeholder: t('wsNewName'), 'aria-label': t('wsNewName'), disabled: busy,
                  onChange: (e) => setNom(e.target.value),
                  onKeyDown: (e) => { if (e.key === 'Enter') { void creer() } },
                }),
                hosted !== null
                  ? h('a', { className: 'kbs-link', href: hosted, target: '_blank', rel: 'noreferrer' }, t('wsNewHosted'))
                  : h('button', { type: 'button', className: 'kbc-btn-primary', disabled: busy || nom.trim() === '', onClick: () => { void creer() } }, t('wsNewCreate')),
                erreur !== '' ? h('div', { className: 'kbc-note kbc-warn' }, erreur) : null)))
        }

        // ── L'APP MOBILE (bouton téléphone du pied) ───────────────────────────
        // Popover ancré au-dessus du pied, avec un QR FICTIF : grille
        // déterministe (jamais deux fois la même pour un scanner, mais stable
        // d'un rendu à l'autre) et trois carrés de repère. Quand l'app existera,
        // le SVG sera remplacé par l'URL réelle — rien d'autre à toucher.
        const MobilePanel = (props) => {
          React.useEffect(() => {
            const onKey = (ev) => { if (ev.key === 'Escape') props.onClose() }
            window.addEventListener('keydown', onKey)
            return () => window.removeEventListener('keydown', onKey)
          }, [props.onClose])
          const popRef = React.useRef(null)
          React.useEffect(() => {
            const dehors = (ev) => {
              const n = popRef.current
              if (n !== null && n !== undefined && n.contains(ev.target) !== true) props.onClose()
            }
            document.addEventListener('mousedown', dehors)
            return () => document.removeEventListener('mousedown', dehors)
          }, [props.onClose])
          // Faux modules : hash simple, déterministe, réparti sur 21×21.
          const modules = []
          for (let y = 0; y < 21; y++) {
            for (let x = 0; x < 21; x++) {
              const finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13)
              if (finder) continue
              const bit = ((x * 73 + y * 149 + ((x * y) % 17)) % 7) < 3
              if (bit === true) modules.push(h('rect', { key: String(x) + '-' + String(y), x: x, y: y, width: 1, height: 1 }))
            }
          }
          const carre = (px, py) => h('g', null,
            h('rect', { x: px, y: py, width: 7, height: 7 }),
            h('rect', { x: px + 1, y: py + 1, width: 5, height: 5, fill: '#fff' }),
            h('rect', { x: px + 2, y: py + 2, width: 3, height: 3 }))
          return h('div', { className: 'kbf-pop kbf-popcenter', ref: popRef, role: 'dialog', 'aria-label': t('mobTitle') },
              h('div', { className: 'kbf-poptitle' }, t('mobTitle')),
              h('svg', {
                className: 'kbf-qr', viewBox: '0 0 21 21', shapeRendering: 'crispEdges',
                'aria-hidden': 'true', role: 'presentation',
              }, h('g', { fill: '#111' }, modules, carre(0, 0), carre(14, 0), carre(0, 14))),
              h('div', { className: 'kbf-qrnote' }, t('mobScan') + ' ' + t('mobSoon')))
        }

        // ── LE MENU UNIFIÉ DE LA CARTE (refonte 30/09, maquette « Menu ouvert »)
        // Ouvert par le clic sur la carte d'espace. Deux vues : le menu
        // principal, puis la liste « Changer d'espace » en place. Chaque entrée
        // rebranche un geste RÉEL : la page profil, la carte de parrainage et
        // le thème vivent dans les autres bundles et sont déclenchés par
        // événements fenêtre ; rien de fictif n'est affiché.
        const UserMenu = (props) => {
          React.useEffect(() => {
            const onKey = (ev) => { if (ev.key === 'Escape') props.onClose() }
            window.addEventListener('keydown', onKey)
            return () => window.removeEventListener('keydown', onKey)
          }, [props.onClose])
          const popRef = React.useRef(null)
          React.useEffect(() => {
            const dehors = (ev) => {
// Le sous-panneau « Changer d'espace » vit en PORTAIL sur
                        // <body> : il n'est PAS un descendant du menu, mais un clic
                        // dedans n'est pas un clic « dehors ». Sans cette clause, le
                        // mousedown fermait le menu AVANT le click — changement et
                        // création d'espace ne partaient jamais (mesuré 30/09 soir).
                        const c = ev.target
                        if (c !== null && typeof c.closest === 'function' && c.closest('.kbfp-menu, .kbfp-sub') !== null) return
                        // Le bouton de la carte BASCULE le menu lui-même (onClick) : s'il ferme ici au
                        // mousedown, le click suivant le rouvre aussitôt — d'où un menu « qui ne se ferme pas ».
                        if (c !== null && typeof c.closest === 'function' && c.closest('.kbfp-cardmain') !== null) return
                        const n = popRef.current
                        if (n !== null && n !== undefined && n.contains(c) !== true) props.onClose()
                        }
            document.addEventListener('mousedown', dehors)
            return () => document.removeEventListener('mousedown', dehors)
          }, [props.onClose])

          const st = props.state !== undefined && props.state !== null ? props.state : {}
          const user = st.user !== undefined && st.user !== null ? st.user : {}
          const espaces = Array.isArray(st.workspaces) ? st.workspaces : []
          const actif = typeof st.active_workspace_id === 'string' ? st.active_workspace_id : null
          const courant = espaces.filter((w) => w !== null && w.id === actif)[0] || espaces[0] || null
          const nomEspace = courant !== null && courant.name ? courant.name : t('spaceTitle')
          const plan = typeof user.plan === 'string' && user.plan.trim() !== '' ? user.plan.trim() : t('none')
          const web = typeof st.web_url === 'string' && st.web_url !== '' ? st.web_url : 'https://kybernos.app'

          const switchPair = React.useState(false)
          const switchOpen = switchPair[0]
          const setSwitchOpen = switchPair[1]
          // Position du sous-panneau : lue sur le RECT du menu à l'ouverture,
          // posée en fixed (portail body) — la colonne de sidebar rogne tout
          // enfant absolu qui déborde de sa largeur.
          const posPair = React.useState(null)
          const subPos = posPair[0]
          const setSubPos = posPair[1]
          React.useEffect(() => {
            if (switchOpen !== true) { setSubPos(null); return undefined }
            const m = popRef.current
            if (m !== null && m !== undefined) {
              const r = m.getBoundingClientRect()
              setSubPos({
                left: Math.max(8, Math.min(r.right + 8, window.innerWidth - 256)),
                top: Math.max(8, r.top),
              })
            }
            return undefined
          }, [switchOpen === true])
          // Schéma ACTIF : attribut publié par le plugin Kybernos, événement
          // fenêtre à chaque changement — le segment suit le thème réel.
          const schemaPair = React.useState(() => {
            try {
              const v = document.documentElement.getAttribute('data-kb-theme')
              return v === 'light' ? 'light' : 'dark'
            } catch (e) { return 'dark' }
          })
          const schema = schemaPair[0]
          const setSchema = schemaPair[1]
          React.useEffect(() => {
            const sur = (ev) => {
              const to = ev !== null && ev !== undefined && ev.detail !== null && ev.detail !== undefined ? ev.detail.to : null
              if (to === 'light' || to === 'dark') setSchema(to)
            }
            window.addEventListener('kybernos:theme', sur)
            return () => window.removeEventListener('kybernos:theme', sur)
          }, [])
          const choisirSchema = (to) => {
            setSchema(to)
            try { window.dispatchEvent(new CustomEvent('kybernos:menu:theme', { detail: { to: to } })) } catch (e) { /* CustomEvent absent */ }
          }

          // ── Fermeture au clic sur une ENTRÉE (correctif 02/10) ──────────────────
          // Le menu ne se fermait que sur un re-clic de la carte ou un clic
          // dehors : choisir une entrée laissait le menu ouvert par-dessus la
          // page qu'on venait d'ouvrir. Quatre entrées n'appelaient jamais
          // `props.onClose()` (Réglage de l'espace, site, aide, retour) — la
          // fermeture se pose donc ICI, une fois pour toutes, plutôt que dans
          // chaque `onClick` où elle s'oublie.
          // Le segment Apparence N'EST PAS une entrée `entree()` : c'est une rangée
          // à part, dont les boutons changent le thème et laissent le menu
          // OUVERT (on veut voir l'effet tout de suite). Il ne passe donc pas
          // par ce helper, et n'est pas concerné par la fermeture ci-dessous.
          // `ouvrirWeb` ouvre un onglet : on ferme AVANT, comme les autres.
          const entree = (cle, icone, label, action, opts) => h('button', {
            type: 'button', role: 'menuitem', 'data-kb': 'menu-' + cle,
            className: 'kbfp-mitem' + (opts !== undefined && opts.danger === true ? ' kbfp-mout' : '') + (opts !== undefined && opts.amber === true ? ' kbfp-mamber' : ''),
            onClick: (ev) => {
              if (typeof action !== 'function') return
              // Fermeture D'ABORD : l'action peut démonter ce menu (navigation,
              // Réglages, déconnexion) — la déclencher ensuite évite d'agir sur
              // un composant déjà démonté.
              try { props.onClose() } catch (e) { /* menu déjà fermé */ }
              action(ev)
            },
          }, icone, h('span', { className: 'kbfp-mlab' }, label),
            opts !== undefined && opts.ext === true ? h('span', { className: 'kbfp-mext', 'aria-hidden': 'true' }, h(ExtIcon, { size: 16 })) : null)

          const ouvrirWeb = () => { try { window.open(web, '_blank', 'noopener') } catch (e) { /* ouverture impossible */ } }
          const envoyer = (nom) => { try { window.dispatchEvent(new Event('kybernos:menu:' + nom)) } catch (e) { /* Event absent */ } }

          // Trois BLOCS séparés par un filet : Teams · Account · Links (+ Log out).
          return h('div', { className: 'kbfp-menu', ref: popRef, role: 'menu', 'aria-label': t('wsPageTitle') },
            h('div', { className: 'kbfp-mitems', 'data-kb': 'menu-block-teams' },
              h('button', {
                type: 'button', className: 'kbfp-mhead', 'data-kb': 'menu-switch',
                'aria-expanded': switchOpen === true ? 'true' : 'false',
                onClick: () => setSwitchOpen(switchOpen !== true),
              },
              h('span', { className: 'kbfp-tile', 'aria-hidden': 'true' }, initiales(nomEspace, '')),
              h('span', { className: 'kbfp-mheadtxt' },
                h('span', { className: 'kbfp-mheadname' }, nomEspace),
                h('span', { className: 'kbfp-mheadsub' }, t('wsSwitchTitle'))),
              h(SwapIcon, { size: 18 })),
              // « Teams settings » = l'ancien « Workspace settings » (même action).
              entree('space-settings', h(BuildingIcon, { size: 18 }), t('menuTeamsSettings'), props.onSpace)),
            h('div', { className: 'kbfp-msep' }),
            h('div', { className: 'kbfp-mitems', 'data-kb': 'menu-block-account' },
              h('div', { className: 'kbfp-mplan' },
                h('div', { className: 'kbfp-mplanline' },
                  h('span', { className: 'kbfp-mplanname' }, plan),
                  h('button', { type: 'button', className: 'kbfp-mcta', 'data-kb': 'menu-plan-cta', onClick: ouvrirWeb }, t('menuPlanCta')))),
              entree('account', h(UserIcon, { size: 18 }), t('profCompte'), props.onAccount),
              // Parrainage / Sécurité : ouvrent la section correspondante des Réglages.
              entree('referral', h(GiftMenuIcon, { size: 18 }), t('profParrain'), () => { if (typeof props.onSection === 'function') props.onSection(t('profParrain')) }, { amber: true }),
              // Apparence : une RANGÉE à segment (pas un bouton) — le choix est immédiat.
              h('div', { className: 'kbfp-mitem', role: 'group', 'aria-label': t('profApparence'), 'data-kb': 'menu-appearance' },
                h(ContrastIcon, { size: 18 }),
                h('span', { className: 'kbfp-mlab' }, t('profApparence')),
                h('span', { className: 'kbfp-seg', role: 'group' },
                  h('button', {
                    type: 'button', 'aria-label': t('themeLight'), 'aria-pressed': schema === 'light' ? 'true' : 'false',
                    className: schema === 'light' ? 'on' : '', onClick: () => choisirSchema('light'),
                  }, h(SunMenuIcon, { size: 15 })),
                  h('button', {
                    type: 'button', 'aria-label': t('themeDark'), 'aria-pressed': schema === 'dark' ? 'true' : 'false',
                    className: schema === 'dark' ? 'on' : '', onClick: () => choisirSchema('dark'),
                  }, h(MoonMenuIcon, { size: 15 })))),
              entree('security', h(ShieldIcon, { size: 18 }), t('profSecurite'), () => { if (typeof props.onSection === 'function') props.onSection(t('profSecurite')) }),
              // Paramètres de l'APP : clic programmatique sur le déclencheur natif (masqué).
              entree('settings', h(GearIcon, { size: 18 }), t('menuSettingsApp'), () => {
                try {
                  const b = document.querySelector('[class*="settingsArea"] button[class*="trigger"]')
                  if (b !== null) b.click()
                } catch (e) { /* declencheur introuvable : rien ne casse */ }
              })),
            h('div', { className: 'kbfp-msep' }),
            h('div', { className: 'kbfp-mitems', 'data-kb': 'menu-block-links' },
              entree('website', h(GlobeIcon, { size: 18 }), t('menuWebsite'), ouvrirWeb, { ext: true }),
              entree('help', h(HelpIcon, { size: 18 }), t('menuHelp'), () => envoyer('help'), { ext: true }),
              entree('feedback', h(MsgMenuIcon, { size: 18 }), t('menuFeedback'), () => envoyer('feedback'))),
            h('div', { className: 'kbfp-msep' }),
            h('div', { className: 'kbfp-mitems' },
              entree('logout', h(OutIcon, { size: 18 }), t('profLogout'), props.onLogout, { danger: true })),
            // La liste des espaces s'ouvre À CÔTÉ du menu, à droite (comme la
            // maquette) : le menu principal RESTE OUVERT — on choisit, la carte
            // du menu se met à jour, le sous-panneau se referme seul.
            switchOpen === true && subPos !== null
              ? ReactDOM.createPortal(h('div', {
                  className: 'kbfp-sub', role: 'menu', 'aria-label': t('wsSwitchTitle'),
                  style: { left: subPos.left + 'px', top: subPos.top + 'px' },
                },
                  h('div', { className: 'kbfp-msub' }, t('wsSwitchTitle')),
                  h(SwitchPanel, {
                    embedded: true,
                    state: st,
                    onClose: () => setSwitchOpen(false),
                    onChanged: props.onChanged,
                    onCreate: props.onCreateSpace,
                  })), document.body)
              : null)
        }

        // ── LA PAGE DE L'ESPACE, PLEIN CADRE (slot main) ─────────────────────
        // Elle ne vit PAS dans une surcouche : `layout.selectPanel('kybernos-cloud-space')`
        // ouvre la zone de contenu, comme les pages du plugin Kybernos. Cinq
        // onglets (Plan, Usage, People, Billing, Synchronisation) ; ce qui n'est
        // pas lisible depuis DSH est NOMMÉ et renvoyé à Kybernos.
        const TABS = ['plan', 'usage', 'people', 'billing', 'sync']

        const SpaceMain = () => {
          const [etat, setEtat] = React.useState(null)
          const [onglet, setOnglet] = React.useState('plan')
          const [erreur, setErreur] = React.useState(false)
          const vivant = React.useRef(true)
          React.useEffect(() => () => { vivant.current = false }, [])
          React.useEffect(() => {
            const lire = async () => {
              let res = null
              try { res = await callLocal('/status', 'GET') } catch (e) { res = null }
              if (vivant.current !== true) return
              if (res !== null && res.connected === true) setEtat(res.state !== undefined && res.state !== null ? res.state : {})
              else setErreur(true)
            }
            void lire()
          }, [])

          const libelle = { plan: t('wsTabPlan'), usage: t('wsTabUsage'), people: t('wsTabPeople'), billing: t('wsTabBilling'), sync: t('wsTabSync') }
          const fermer = () => { try { if (layoutSvc !== undefined && layoutSvc !== null && typeof layoutSvc.selectPanel === 'function') layoutSvc.selectPanel(null) } catch (e) { } }

          if (etat === null) {
            return h('div', { className: 'kbp-page' },
              h('div', { className: 'kbp-head' }, h('h2', { className: 'kbp-title' }, t('spaceTitle'))),
              h('div', { className: 'kbp-loading' }, erreur === true ? t('spaceUnknown') : t('loading')))
          }

          const user = etat.user !== undefined && etat.user !== null ? etat.user : {}
          const espaces = Array.isArray(etat.workspaces) ? etat.workspaces : []
          const actif = typeof etat.active_workspace_id === 'string' ? etat.active_workspace_id : null
          const courant = espaces.filter((w) => w !== null && w.id === actif)[0] || espaces[0] || null
          const nom = courant !== null && courant.name ? courant.name : t('spaceTitle')
          const formule = typeof user.plan === 'string' && user.plan !== '' ? user.plan : t('none')
          const modele = etat.models !== undefined && etat.models !== null ? etat.models : null
          const nbModeles = modele !== null && typeof modele.count === 'number' ? modele.count : 0
          const nbKybers = courant !== null && typeof courant.kyber_count === 'number' ? courant.kyber_count : 0
          const web = typeof etat.web_url === 'string' && etat.web_url !== '' ? etat.web_url : null
          const lienHosted = (chemin, libelleLien) => (web === null ? null : h('a', {
            className: 'kbs-link', href: web + chemin, target: '_blank', rel: 'noreferrer',
          }, libelleLien))

          const flip = (cle) => h('span', { className: 'kbs-flip', role: 'group' },
            h('button', { type: 'button', 'aria-pressed': 'false', disabled: true, key: cle + '-on' }, t('syncOn')),
            h('button', { type: 'button', 'aria-pressed': 'true', disabled: true, key: cle + '-off' }, t('syncOff')))
          const ligneSync = (cle, titre, aide) => h('div', { className: 'kbs-row', key: cle },
            h('span', { className: 'kbs-row-txt' }, h('b', null, titre), h('span', null, aide)), flip(cle))

          const corps = () => {
            if (onglet === 'plan') {
              return h('div', { className: 'kbp-card' },
                h('div', { className: 'kbt-head' },
                  h('span', { className: 'kbt-plan' },
                    h('span', { className: 'kbt-label' }, t('wsPlanLabel')),
                    h('span', { className: 'kbt-planline' },
                      h('span', { className: 'kbt-planname' }, formule),
                      h('span', { className: 'kbt-planprice' }, t('wsPlanPrice'))),
                    h('span', { className: 'kbt-plansum' },
                      t('wsPlanSummary') + ' ' + String(nbKybers) + ' '
                      + (nbKybers === 1 ? t('wsKybersOne') : t('wsKybersMany')) + ', '
                      + String(espaces.length) + ' ' + t('wsPlanVisible') + '.')),
                  h('button', { type: 'button', className: 'kbs-link', onClick: () => setOnglet('usage') }, t('wsViewUsage'))))
            }
            if (onglet === 'usage') {
              return h('div', { className: 'kbp-card' },
                h('div', { className: 'kbs-sect' }, t('wsUsageTitle')),
                h('div', { className: 'kbc-note', style: { margin: '10px 0 4px' } }, t('wsUsageNote')),
                h(Row, { label: t('models'), value: String(nbModeles) + ' ' + (nbModeles === 1 ? t('wsModelsOne') : t('wsModelsMany')) }),
                h(Row, { label: t('kybers'), value: String(nbKybers) + ' ' + (nbKybers === 1 ? t('wsKybersOne') : t('wsKybersMany')) }),
                h(Row, { label: t('plan'), value: formule }))
            }
            if (onglet === 'people') {
              return h('div', { className: 'kbp-card' },
                h('div', { className: 'kbs-sect' }, t('wsPeopleTitle')),
                h('div', { className: 'kbc-note', style: { margin: '10px 0 4px' } }, t('wsPeopleNote')))
            }
            if (onglet === 'billing') {
              return h('div', { className: 'kbp-card' },
                h('div', { className: 'kbs-sect' }, t('wsBillingTitle')),
                h('div', { className: 'kbc-note', style: { margin: '10px 0 4px' } }, t('wsBillingNote')))
            }
            return h('div', { className: 'kbp-card' },
              h('div', { className: 'kbs-sect' }, t('syncTitle')),
              h('div', { className: 'kbs-note', style: { margin: '10px 0 4px' } }, t('syncNotServed')),
              ligneSync('space', t('syncMemorySpace'), t('syncMemorySpaceHint')),
              ligneSync('kybers', t('syncMemoryKybers'), t('syncMemoryKybersHint')),
              ligneSync('sends', t('syncSends'), t('syncSendsHint')),
              h('div', { className: 'kbs-recap' },
                h('div', null, t('syncDownTitle') + ' : ' + t('syncUnknown')),
                h('div', null, t('syncUpTitle') + ' : ' + t('syncUnknown')),
                h('div', null, t('syncNeverTitle') + ' · ' + t('syncNeverBody'))))
          }

          return h('div', { className: 'kbp-page' },
            h('div', { className: 'kbp-head' },
              h('span', { className: 'kbf-avatar', 'aria-hidden': 'true' }, initiales(nom, '')),
              h('span', null,
                h('h2', { className: 'kbp-title' }, nom),
                h('span', { className: 'kbp-sub' }, formule + ' · ' + String(espaces.length) + ' ' + t('workspaces'))),
              h('button', { type: 'button', className: 'kbp-back', onClick: fermer }, t('wsClose'))),
            h('div', { className: 'kbp-body' },
              h('div', { className: 'kbt-tabs', role: 'tablist' }, TABS.map((cle) => h('button', {
                type: 'button', key: cle, role: 'tab', className: 'kbt-tab',
                'aria-selected': onglet === cle ? 'true' : 'false',
                onClick: () => setOnglet(cle),
              }, libelle[cle]))),
              corps(),
              h('div', { className: 'kbs-actions' },
                lienHosted('/workspace', t('wsOpenHosted')),
                h('button', { type: 'button', className: 'kbs-link', onClick: () => { window.dispatchEvent(new Event('kybernos-cloud:open')) } }, t('spaceAccount')))))
        }
        SpaceMain.__testTabs = TABS

        // ── La rangée du bas du menu ─────────────────────────────────────────        // ── La rangée du bas du menu ─────────────────────────────────────────
        // Un seul composant pour les trois états, parce que la rangée CHANGE de
        // forme : connecté elle montre l'identité, sinon elle explique et
        // propose le geste. Le clic ouvre la même fiche complète (appairage,
        // profil, workspaces, catalogue) — aucune logique n'est dupliquée ici.
        const CloudFoot = () => {
          const [open, setOpen] = React.useState(false)
          const [menuOpen, setMenuOpen] = React.useState(false)
          const [notifOpen, setNotifOpen] = React.useState(false)
          const [newOpen, setNewOpen] = React.useState(false)
          const [mobileOpen, setMobileOpen] = React.useState(false)
          // Largeur RÉELLE du créneau : en rail replié la rangée doit changer de
          // forme, sinon elle déborde (mesuré : 167 px dans un rail de 60 px).
          const racineRef = React.useRef(null)
          const [etroit, setEtroit] = React.useState(false)
          // Deux signaux, jamais un seul : la largeur du RAIL (l'ancêtre de
          // sidebar qui porte une largeur explicite) ET le fait que notre
          // contenu déborde ce rail. Mesurer notre propre largeur ne suffit pas
          // — c'est notre contenu qui l'impose (mesuré : 199 px de rangée dans
          // un rail de 60 px, la rangée partait à x = -72).
          React.useEffect(() => {
            const el = racineRef.current
            if (el === null || el === undefined || typeof ResizeObserver === 'undefined') return undefined
            const ancetreRail = () => {
              let e = el.parentElement
              let candidat = null
              while (e !== null && e !== undefined && e !== document.body) {
                const cls = String(e.className === undefined || e.className === null ? '' : e.className)
                const inline = e.getAttribute('style') === null ? '' : e.getAttribute('style')
                // Le rail de DSH se reconnaît à trois choses, jamais une seule :
                // une largeur explicite, un marqueur de repli, ou la zone de pied.
                if (inline.indexOf('width') !== -1 || /collaps/i.test(cls) || /footArea/i.test(cls)) candidat = e
                e = e.parentElement
              }
              return candidat
            }
            const lireRail = () => {
              const rail = ancetreRail()
              const largeurRail = rail !== null ? rail.getBoundingClientRect().width : 0
              const largeurNous = el.getBoundingClientRect().width
              if (largeurRail <= 0) { setEtroit(false); return }
              setEtroit(largeurRail < 140 || largeurNous > largeurRail + 8)
            }
            lireRail()
            // DSH pose sa largeur après coup : on relit une fois la mise en page
            // posée, et on écoute les deux éléments concernés.
            const minuteur = setTimeout(lireRail, 400)
            const ro = new ResizeObserver(lireRail)
            ro.observe(el)
            const rail = ancetreRail()
            if (rail !== null) ro.observe(rail)
            return () => { clearTimeout(minuteur); ro.disconnect() }
          }, [])
          const [autoStart, setAutoStart] = React.useState(false)
          const [phase, setPhase] = React.useState('loading')
          const [state, setState] = React.useState({})
          const liveRef = React.useRef(true)

          React.useEffect(() => () => { liveRef.current = false }, [])

          const load = React.useCallback(async () => {
            let status = null
            try { status = await callLocal('/status', 'GET') } catch (e) { status = null }
            if (liveRef.current !== true) return
            if (status !== null && status.connected === true) {
              setState(status.state !== undefined && status.state !== null ? status.state : {})
              setPhase('connected')
              return
            }
            if (status !== null && status.status === 'pending') { setPhase('pairing'); return }
            setPhase('disconnected')
          }, [])

          // `open` est dans les dépendances : à la fermeture de la fiche on
          // relit l'état local, donc un appairage tout juste terminé apparaît
          // dans la rangée sans recharger la page.
          React.useEffect(() => { void load() }, [load, open])

          // La fiche peut être ouverte depuis un autre plugin (page Models) :
          // même événement fenêtre que l'ancien bouton, rien de nouveau.
          React.useEffect(() => {
            const ouvrir = () => setOpen(true)
            window.addEventListener('kybernos-cloud:open', ouvrir)
            return () => window.removeEventListener('kybernos-cloud:open', ouvrir)
          }, [])

          // Un autre plugin peut ouvrir la page de l'espace (même couture que
          // la fiche compte) ou le sélecteur.
          React.useEffect(() => {
            const ouvrir = () => { try { if (layoutSvc !== undefined && layoutSvc !== null && typeof layoutSvc.selectPanel === 'function') layoutSvc.selectPanel('kybernos-cloud-space') } catch (e) { } }
            const ouvrirSelecteur = () => setMenuOpen(true)
            window.addEventListener('kybernos-cloud:space', ouvrir)
            window.addEventListener('kybernos-cloud:switch', ouvrirSelecteur)
            return () => {
              window.removeEventListener('kybernos-cloud:space', ouvrir)
              window.removeEventListener('kybernos-cloud:switch', ouvrirSelecteur)
            }
          }, [])

          // État publié pour les AUTRES plugins du pied : la cloche des
          // notifications est masquée tant qu'il n'y a pas de compte
          // (`data-kb-cloud="off"`). Tant que la lecture est en cours on ne
          // publie RIEN — masquer la cloche sur un simple retard réseau serait
          // un mensonge.
          React.useEffect(() => {
            try {
              const root = document.documentElement
              if (phase === 'loading') root.removeAttribute('data-kb-cloud')
              else root.setAttribute('data-kb-cloud', phase === 'connected' ? 'on' : 'off')
            } catch (e) { /* document indisponible */ }
          }, [phase])

          const openAndConnect = () => { setAutoStart(true); setOpen(true) }
          const openCard = () => { setAutoStart(false); setOpen(true) }

          const user = state.user !== undefined && state.user !== null ? state.user : {}
          const device = typeof state.device_label === 'string' && state.device_label.trim() !== '' ? state.device_label.trim() : null

          let corps = null
          // L'engrenage natif est masqué (menu unifié) : déconnecté, la carte
          // n'existe pas — ce bouton rend les Réglages atteignables.
          const ouvrirParametresPied = () => {
            try {
              const b = document.querySelector('[class*="settingsArea"] button[class*="trigger"]')
              if (b !== null) b.click()
            } catch (e) { /* declencheur introuvable */ }
          }
          if (phase === 'connected') {
            // ── La CARTE UNIFIÉE (refonte 30/09, maquette « Menu ouvert ») ──
            // Une seule carte : tuile d'initiales, nom de l'espace, « qui ·
            // formule », téléphone et cloche. Le clic ouvre le MENU unifié ;
            // les anciennes rangées (espace, identité) ont fusionné dedans.
            const espaces = Array.isArray(state.workspaces) ? state.workspaces : []
            const actif = typeof state.active_workspace_id === 'string' ? state.active_workspace_id : null
            const courant = espaces.filter((w) => w !== null && w.id === actif)[0] || espaces[0] || null
            const nomEspace = courant !== null && courant.name ? courant.name : t('spaceTitle')
            const planEspace = typeof user.plan === 'string' && user.plan.trim() !== '' ? user.plan.trim() : t('none')
            const ouvrirPageEspace = () => {
              // « Réglage de l'espace » (02/10) : l'entrée ouvre la page EMBED
              // qui vivait jusqu'ici dans Paramètres ▸ Mon espace — l'iframe
              // workspace-console (console du gateway LLM), montée en plein
              // cadre dans la zone de contenu par le bundle kybernos-plugin.
              // Le pont marche par contrat : le composant de la page vit dans
              // le plugin, et cette entrée se contente de demander son
              // ouverture — jamais de dupliquer l'iframe ici.
              // Replis en cascade si le plugin n'expose pas le pont (version
              // plus ancienne, profil sans le bundle) : la page riche « Mon
              // espace » du panneau Kybernos, puis le gabarit local
              // kybernos-cloud-space — on dégrade, on ne casse pas.
              const ouvrir = (typeof window !== 'undefined') ? window.__kbOpenWsConsole : null
              if (typeof ouvrir === 'function') {
                try { ouvrir(); return } catch (e) { /* repli page riche */ }
              }
              const ouvrirRiche = (typeof window !== 'undefined') ? window.__kbOpenWorkspace : null
              if (typeof ouvrirRiche === 'function') {
                try { ouvrirRiche(); return } catch (e) { /* repli page locale */ }
              }
              try { if (layoutSvc !== undefined && layoutSvc !== null && typeof layoutSvc.selectPanel === 'function') layoutSvc.selectPanel('kybernos-cloud-space') } catch (e) { /* layout indisponible */ }
            }
            const shownName = displayName(user)
            const qui = shownName.value !== '' ? shownName.value : (user.email || t('none'))
            // ── Réglages ▸ Compte (demande du 30/09) ────────────────────────
            // « Compte » (et « Sécurité », même cible) du menu principal va
            // DIRECTEMENT dans la section Compte des Réglages : l'ancienne
            // page plein cadre est cachée pour le moment. On passe par le
            // déclencheur natif des Réglages (le même que l'entrée
            // « Paramètres » du menu), puis on clique la cellule « Compte »
            // du nav dès qu'elle est rendue — le panneau se monte en
            // asynchrone. Réglages déjà ouverts : on se borne à sélectionner
            // la cellule (re-cliquer le déclencheur les refermerait).
            // Cellule introuvable après ~2 s : les Réglages restent sur leur
            // section par défaut, jamais d'erreur bloquante.
            const ouvrirReglagesCompte = (libelleCible) => {
              const libelle = typeof libelleCible === 'string' && libelleCible !== '' ? libelleCible : t('profCompte')
              const cliquerCellule = () => {
                try {
                  const cellules = Array.from(document.querySelectorAll('button[class*="navCell"]'))
                  const cible = cellules.find((b) => String((b.textContent || '').trim()) === libelle)
                  if (cible !== undefined && cible !== null) { cible.click(); return true }
                } catch (e) { /* nav pas encore rendu */ }
                return false
              }
              try {
                const nav = document.querySelector('[class*="navList"]')
                const dejaOuvert = nav !== null && nav.offsetParent !== null
                if (dejaOuvert === false) {
                  const b = document.querySelector('[class*="settingsArea"] button[class*="trigger"]')
                  if (b !== null) b.click()
                }
              } catch (e) { /* declencheur introuvable */ }
              let essais = 0
              const tique = () => {
                essais += 1
                if (cliquerCellule() === true) return
                if (essais < 40) window.setTimeout(tique, 50)
              }
              window.setTimeout(tique, 80)
            }
            const clicProfil = () => {
              setMenuOpen(false)
              ouvrirReglagesCompte()
            }
            const clicSection = (libelle) => {
              setMenuOpen(false)
              ouvrirReglagesCompte(libelle)
            }
            const seDeconnecter = async () => {
              setMenuOpen(false)
              try { await callLocal('/disconnect', 'POST', { confirm: true }) } catch (e) { /* déjà parti */ }
              void load()
            }
            corps = h('div', {
              className: 'kbfp-cardwrap ' + (etroit === true ? 'kbfp-tight2' : ''),
              'data-kb': 'workspace-card',
            },
            h('div', { className: 'kbfp-card' },
              h('button', {
                type: 'button', className: 'kbfp-cardmain', title: t('wsPageTitle'),
                'aria-label': t('wsPageTitle'), 'aria-haspopup': 'menu',
                'aria-expanded': menuOpen === true ? 'true' : 'false',
                onClick: () => { setNotifOpen(false); setMenuOpen(menuOpen !== true) },
              },
              h('span', { className: 'kbfp-tile', 'aria-hidden': 'true' }, initiales(nomEspace, '')),
              h('span', { className: 'kbfp-cardtxt' },
                h('span', { className: 'kbfp-cardname' }, nomEspace),
                h('span', { className: 'kbfp-cardsub' }, qui + ' · ' + planEspace))),
              h('button', {
                type: 'button', className: 'kbfp-ico',
                title: t('mobTitle'), 'aria-label': t('mobTitle'),
                'aria-expanded': mobileOpen === true ? 'true' : 'false',
                onClick: () => setMobileOpen(mobileOpen !== true),
              }, h(PhoneIcon, { size: 19 })),
              h('span', { className: 'kbfp-bellwrap' },
                h('button', {
                  type: 'button', className: 'kbfp-ico',
                  title: t('notifTitle'), 'aria-label': t('notifTitle'),
                  'aria-expanded': notifOpen === true ? 'true' : 'false',
                  onClick: () => { setMobileOpen(false); setNotifOpen(notifOpen !== true) },
                }, h(BellIcon, { size: 19 })),
                notifOpen === true
                  ? h('div', { className: 'kbf-pop kbfp-bellpop', role: 'dialog', 'aria-label': t('notifTitle') },
                      h('div', { className: 'kbf-poptitle' }, t('notifTitle')),
                      h('div', { className: 'kbc-note' }, t('notifEmpty')))
                  : null),
              menuOpen === true
                ? h(UserMenu, {
                  state: state,
                  onClose: () => setMenuOpen(false),
                  onChanged: () => { void load() },
                  onCreateSpace: () => {
                    setMenuOpen(false)
                    setNewOpen(true)
                  },
                  onAccount: clicProfil,
                  onSection: clicSection,
                  onSpace: ouvrirPageEspace,
                  onLogout: () => { void seDeconnecter() },
                })
                : null),
            mobileOpen === true
              ? h(MobilePanel, { onClose: () => setMobileOpen(false) })
              : null)
          } else if (phase === 'pairing') {
            corps = h('div', { className: 'kbf-off' },
              h('p', { className: 'kbm-setform-unavailable', style: { margin: '0' } }, t('footPairing')),
              h('div', { className: 'kbf-offbtns' },
                h('button', { type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-primary', onClick: openCard },
                  h(EnterIcon, { size: 15 }), h('span', null, t('footPairingAction'))),
                h('button', {
                  type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-outline kbf-gear',
                  title: t('menuSettingsApp'), 'aria-label': t('menuSettingsApp'), onClick: ouvrirParametresPied,
                }, h(GearIcon, { size: 16 }))))
          } else {
            const hint = phase === 'loading' ? t('loading') : t('footHint')
            corps = h('div', { className: 'kbf-off' },
              h('p', { className: 'kbm-setform-unavailable', style: { margin: '0' } }, hint),
              h('div', { className: 'kbf-offbtns' },
                h('button', { type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-primary', onClick: openAndConnect },
                  h(EnterIcon, { size: 15 }), h('span', null, t('footConnect'))),
                h('button', {
                  type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-outline kbf-gear',
                  title: t('menuSettingsApp'), 'aria-label': t('menuSettingsApp'), onClick: ouvrirParametresPied,
                }, h(GearIcon, { size: 16 }))))
          }

          return h('div', { className: 'kbf-root', ref: racineRef },
            corps,
            newOpen === true
              ? h(NewSpacePanel, {
                onClose: () => setNewOpen(false),
                onCreated: () => { void load() },
              })
              : null,
            open === true
              ? h(CloudCard, {
                onClose: () => { setOpen(false); setAutoStart(false) },
                autoStart: autoStart,
                onConnection: () => { void load() },
              })
              : null)
        }

        ctx.effect(() => styles.insert(CLOUD_CSS), 'kybernos-cloud: styles')
        ctx.effect(() => slots.inject('sidebar.footer.action', () => slots.register(
          { name: 'sidebar.footer.action', id: 'kybernos-cloud', order: 21 }, CloudFoot)),
        'kybernos-cloud: rangee de profil dans le pied de sidebar')
        // La page de l'espace : PLEIN CADRE, dans la zone de contenu. Elle est
        // ouverte par l'engrenage de la rangée d'espace (ou par l'événement
        // `kybernos-cloud:space`), jamais dans une surcouche.
        ctx.effect(() => slots.register(
          { name: 'main', key: 'kybernos-cloud-space' }, SpaceMain),
        'kybernos-cloud: page de l espace en plein cadre')
        // La page PROFIL, plein cadre elle aussi : le clic sur le nom du pied
        // de sidebar l'ouvre (comme dans Kybernos). C'est la fiche CloudCard
        // en gabarit page — aucune seconde implémentation.
        const ProfileMain = () => h(CloudCard, {
          page: true,
          onClose: () => { try { if (layoutSvc !== undefined && layoutSvc !== null && typeof layoutSvc.selectPanel === 'function') layoutSvc.selectPanel(null) } catch (e) { /* layout indisponible */ } },
        })
        ctx.effect(() => slots.register(
          { name: 'main', key: 'kybernos-cloud-profile' }, ProfileMain),
        'kybernos-cloud: page de profil en plein cadre')

        // ── Onglet « Account » des RÉGLAGES (30/09 soir) ────────────────────
        // Mêmes infos que la page profil de la webapp
        // (/profiles?section=profile) : identité, formule, teams, espace
        // actif, appareil, session — lues des routes locales, jamais
        // inventées. Le lien « Ouvrir dans Kybernos » pointe la page web.
        const AccountSection = () => {
          const vuePair = React.useState({ phase: 'loading' })
          const vue = vuePair[0]
          const setVue = vuePair[1]
          const liveRef = React.useRef(true)
          React.useEffect(() => () => { liveRef.current = false }, [])
          const charger = React.useCallback(async () => {
            setVue({ phase: 'loading' })
            let status = null
            try { status = await callLocal('/status', 'GET') } catch (e) { status = null }
            if (liveRef.current !== true) return
            if (status !== null && status.connected === true) {
              let st = status.state !== undefined && status.state !== null ? status.state : {}
              try {
                const fresh = await callLocal('/refresh', 'POST')
                if (fresh !== null && fresh.connected === true && fresh.state !== undefined) st = fresh.state
              } catch (e) { /* on garde le cache */ }
              if (liveRef.current !== true) return
              setVue({ phase: 'connected', state: st })
              return
            }
            setVue({ phase: status !== null && status.status === 'pending' ? 'pairing' : 'disconnected' })
          }, [])
          React.useEffect(() => { void charger() }, [charger])
          const seDeconnecter = async () => {
            try { await callLocal('/disconnect', 'POST', { confirm: true }) } catch (e) { /* déjà parti */ }
            void charger()
          }

          // ── Profil éditable local (naissance, localisation, instructions…) ──
          const profilPair = React.useState(kbAccRead)
          const profil = profilPair[0]
          const setProfil = profilPair[1]
          const sauvePair = React.useState(false)
          const sauve = sauvePair[0]
          const setSauve = sauvePair[1]
          const detecPair = React.useState('')
          const detec = detecPair[0]
          const setDetec = detecPair[1]
          const fichierRef = React.useRef(null)
          const photoErrPair = React.useState(false)
          const photoErr = photoErrPair[0]
          const setPhotoErr = photoErrPair[1]
          // Photo : recadrée carré 256 px, JPEG, gardée en data URI sur l'appareil.
          const chargerPhoto = (fichier) => {
            if (fichier === undefined || fichier === null) return
            setPhotoErr(false)
            const lecteur = new FileReader()
            lecteur.onerror = () => { setPhotoErr(true) }
            lecteur.onload = () => {
              const img = new Image()
              img.onerror = () => { setPhotoErr(true) }
              img.onload = () => {
                try {
                  const c = document.createElement('canvas')
                  c.width = 256; c.height = 256
                  const cote = Math.min(img.width, img.height)
                  c.getContext('2d').drawImage(img, (img.width - cote) / 2, (img.height - cote) / 2, cote, cote, 0, 0, 256, 256)
                  setProfil((p) => Object.assign({}, p, { photo: c.toDataURL('image/jpeg', 0.85) }))
                  setSauve(false)
                } catch (e) { setPhotoErr(true) }
              }
              img.src = String(lecteur.result || '')
            }
            lecteur.readAsDataURL(fichier)
          }
          const champ = (cle) => ({
            value: profil[cle],
            onChange: (e) => { setProfil(Object.assign({}, profil, { [cle]: e.target.value })); setSauve(false) },
          })
          const enregistrer = () => { kbAccWrite(profil); setSauve(true) }
          const detecter = () => {
            if (typeof navigator === 'undefined' || navigator.geolocation === undefined || navigator.geolocation === null) { setDetec('err'); return }
            setDetec('busy')
            try {
              navigator.geolocation.getCurrentPosition((pos) => {
                fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + pos.coords.latitude + '&lon=' + pos.coords.longitude)
                  .then((r) => r.json())
                  .then((j) => {
                    const a = j.address !== undefined && j.address !== null ? j.address : {}
                    const ville = a.city || a.town || a.village || a.county || a.municipality
                    const loc = ville ? ville + ', ' + a.country : (a.country || '')
                    if (loc !== '') { setProfil(Object.assign({}, profil, { location: loc })); setSauve(false) }
                    setDetec('')
                  })
                  .catch(() => { setDetec('err') })
              }, () => { setDetec('err') }, { timeout: 8000 })
            } catch (e) { setDetec('err') }
          }
          let fuseau = ''
          try { fuseau = Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch (e) { fuseau = '' }
          // Ligne d'info : le gabarit NATIF des formulaires Réglages (kbm-setfield)
          const ligne = (k, v, hint) => h('div', { className: 'kbm-setfield' },
            h('div', { className: 'kbm-setfield-head' },
              h('span', { className: 'kbm-setfield-label' }, k),
              h('span', {
                title: hint,
                style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary)', fontStyle: hint !== undefined ? 'italic' : 'normal' },
              }, v)))
          let zones = []
          try { zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [] } catch (e) { zones = [] }
          if (zones.length === 0 && fuseau !== '') zones = [fuseau]
          const champNat = (cle, extras) => Object.assign({
            className: 'kbm-setfield-input',
            value: profil[cle],
            onChange: (e) => { setProfil(Object.assign({}, profil, { [cle]: e.target.value })); setSauve(false) },
          }, extras === undefined ? {} : extras)

          if (vue.phase !== 'connected') {
            const indice = vue.phase === 'pairing' ? t('footPairing') : (vue.phase === 'loading' ? t('loading') : t('footHint'))
            return h('div', { className: 'kbp-card', 'data-kb': 'settings-account', style: { maxWidth: '560px' } },
              h('p', { className: 'kbf-hint' }, indice),
              h('button', {
                type: 'button', className: 'kbf-connect', style: { marginTop: '10px' },
                onClick: () => { try { window.dispatchEvent(new Event('kybernos-cloud:open')) } catch (e) { /* Event absent */ } },
              }, h(EnterIcon, { size: 15 }), h('span', null, t('footConnect'))))
          }

          const st = vue.state
          const user = st.user !== undefined && st.user !== null ? st.user : {}
          const espaces = Array.isArray(st.workspaces) ? st.workspaces : []
          const actif = typeof st.active_workspace_id === 'string' ? st.active_workspace_id : null
          const courant = espaces.filter((w) => w !== null && w.id === actif)[0] || espaces[0] || null
          const shownName = displayName(user)
          const qui = shownName.value !== '' ? shownName.value : (user.email || t('none'))
          const plan = typeof user.plan === 'string' && user.plan.trim() !== '' ? user.plan.trim() : t('none')
          const device = typeof st.device_label === 'string' && st.device_label.trim() !== '' ? st.device_label.trim() : t('none')
          const expire = fmtDate(st.expires_at) !== null ? fmtDate(st.expires_at) : t('none')
          const web = typeof st.web_url === 'string' && st.web_url !== '' ? st.web_url : 'https://kybernos.app'
          const nbKybers = courant !== null && typeof courant.kyber_count === 'number' ? courant.kyber_count : 0

          const couleurAvatar = profil.color !== '' ? profil.color : '#4b4fe0'
          const glyphAvatar = initiales(profil.name !== '' ? profil.name : qui, user.email)
          const stylePhoto = profil.photo !== '' ? { backgroundImage: 'url(' + profil.photo + ')', backgroundSize: 'cover', backgroundPosition: 'center' } : {}
          const SWATCHES = ['#4b4fe0', '#2f6f5e', '#a4553a', '#7a4a86', '#8a6b2f', '#16181c', '#9a6b3f']
          return h('div', { 'data-kb': 'settings-account', style: { display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '720px' } },
            h('div', { className: 'kbp-card' },
              h('div', { className: 'kbs-head' },
                h('span', { className: 'kbs-who' },
                  h('span', {
                    className: 'kbf-avatar', 'aria-hidden': 'true',
                    style: Object.assign({ width: '42px', height: '42px', borderRadius: '10px', fontSize: '15px', background: couleurAvatar }, stylePhoto),
                  }, profil.photo !== '' ? null : glyphAvatar),
                  h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
                    h('b', { style: { fontSize: '16px' } }, qui),
                    user.email ? h('span', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' } }, user.email) : null)),
                h('span', { className: 'kbf-plan', style: { maxWidth: '90px' } }, plan))),
            h('div', { className: 'kbp-card' },
              h('div', { className: 'kbs-sect' }, t('accProfileTitle')),
              h('div', { className: 'kbm-setform' },
                // Avatar : initiales (du nom) + couleur, comme la webapp
                h('div', { className: 'kbm-setfield' },
                  h('div', { className: 'kbm-setfield-head' },
                    h('span', { className: 'kbm-setfield-label' }, t('accAvatar'))),
                  h('div', { className: 'kbfp-swrow' },
                    h('span', { className: 'kbfp-avat', 'aria-hidden': 'true', style: Object.assign({ background: couleurAvatar }, stylePhoto) }, profil.photo !== '' ? null : glyphAvatar),
                    h('span', { className: 'kbfp-swrow', role: 'radiogroup', 'aria-label': t('accAvatar'), style: { marginLeft: '6px' } },
                      SWATCHES.map((c) => h('button', {
                        type: 'button', key: c, className: 'kbfp-sw' + (profil.color === c ? ' on' : ''),
                        role: 'radio', 'aria-checked': profil.color === c ? 'true' : 'false',
                        'aria-label': c, title: c,
                        style: { background: c },
                        onClick: () => { setProfil(Object.assign({}, profil, { color: profil.color === c ? '' : c })); setSauve(false) },
                      })))),
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' } },
                    h('input', {
                      ref: fichierRef, type: 'file', accept: 'image/*', style: { display: 'none' },
                      onChange: (e) => { const f = e.target.files && e.target.files[0]; chargerPhoto(f); e.target.value = '' },
                    }),
                    h('button', { type: 'button', className: 'kbm-btn kbm-btn-sm kbm-btn-outline', onClick: () => { if (fichierRef.current) fichierRef.current.click() } }, t('accPhotoUp')),
                    profil.photo !== '' ? h('button', { type: 'button', className: 'kbm-btn kbm-btn-sm kbm-btn-outline', onClick: () => { setProfil(Object.assign({}, profil, { photo: '' })); setSauve(false) } }, t('accPhotoDel')) : null,
                    photoErr ? h('span', { className: 'kbm-setfield-invalid' }, t('accPhotoErr')) : null)),
                h('div', { className: 'kbm-setfield' },
                  h('div', { className: 'kbm-setfield-head' },
                    h('span', { className: 'kbm-setfield-label' }, t('name'))),
                  h('input', champNat('name', { type: 'text', placeholder: t('accNamePh') }))),
                h('div', { className: 'kbm-setfield' },
                  h('div', { className: 'kbm-setfield-head' },
                    h('span', { className: 'kbm-setfield-label' }, t('accBirth'))),
                  h('input', champNat('birth', { type: 'date' }))),
                h('div', { className: 'kbm-setfield' },
                  h('div', { className: 'kbm-setfield-head' },
                    h('span', { className: 'kbm-setfield-label' }, t('accLocation'))),
                  h('div', { style: { display: 'flex', gap: '6px' } },
                    h('input', champNat('location', { type: 'text', placeholder: 'Paris, France', style: { flex: '1 1 auto' } })),
                    h('button', {
                      type: 'button', className: 'kbm-btn kbm-btn-sm kbm-btn-outline', style: { flex: '0 0 auto' },
                      disabled: detec === 'busy', onClick: detecter,
                    }, detec === 'busy' ? t('accDetecting') : t('accDetect'))),
                  detec === 'err' ? h('p', { className: 'kbm-setfield-invalid' }, t('accDetectErr')) : null),
                h('div', { className: 'kbm-setfield' },
                  h('div', { className: 'kbm-setfield-head' },
                    h('span', { className: 'kbm-setfield-label' }, t('accTimezone'))),
                  h('select', champNat('tz'),
                    h('option', { value: '' }, fuseau !== '' ? t('accAutoTz') + ' · ' + fuseau : t('accAutoTz')),
                    zones.map((z) => h('option', { key: z, value: z }, z)))),
                h('div', { className: 'kbm-setfield' },
                  h('div', { className: 'kbm-setfield-head' },
                    h('span', { className: 'kbm-setfield-label' }, t('accLanguage'))),
                  h('select', champNat('language'),
                    h('option', { value: '' }, '—'),
                    h('option', { value: 'Français' }, 'Français'),
                    h('option', { value: 'English' }, 'English'),
                    h('option', { value: 'العربية' }, 'العربية'))),
                h('div', { className: 'kbm-setfield' },
                  h('div', { className: 'kbm-setfield-head' },
                    h('span', { className: 'kbm-setfield-label' }, t('accInstructions'))),
                  h('textarea', champNat('instructions', { rows: 3, placeholder: t('accInstructionsPh') }))),
                h('div', { className: 'kbm-setform-footer' },
                  h('button', { type: 'button', className: 'kbm-setform-save', onClick: enregistrer }, t('accSave')),
                  sauve === true ? h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-state-success-primary)' } }, t('accSaved')) : null),
                h('p', { className: 'kbm-setform-unavailable', style: { margin: '0' } }, t('accLocalNote')))),
            h('div', { className: 'kbs-actions' },
              h('button', { type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-outline', onClick: () => { void charger() } }, t('refresh')),
              h('a', {
                className: 'kbm-btn kbm-btn-md kbm-btn-outline', style: { textDecoration: 'none' },
                href: web + '/profiles?section=profile', target: '_blank', rel: 'noreferrer',
              }, t('wsOpenHosted')),
              h('button', { type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-outline', style: { color: 'var(--dsw-alias-state-error-primary)' }, onClick: () => { void seDeconnecter() } }, t('disconnect'))))
        }
        ctx.effect(() => slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'kybernos-account', order: 11, label: t('profCompte') }, AccountSection)),
        'kybernos-cloud: onglet Account des reglages')

        // ── Onglet « Données & confidentialité » (30/09 soir) ───────────────
        // Reprend la section data de la webapp (/profiles?section=data) :
        // export complet, sessions & appareils, suppression du compte.
        // Règle d'honnêteté : DSH ne porte pas le jeton web — les gestes qui
        // le réclament (export, suppression, autres sessions) renvoient à
        // Kybernos ; la déconnexion de CET appareil est réelle (route locale).
        // Tout est en jetons natifs DSH (kbm-*, kbp-card).
        const DataSection = () => {
          const vuePair = React.useState({ phase: 'loading' })
          const vue = vuePair[0]
          const setVue = vuePair[1]
          const confirmPair = React.useState(false)
          const confirme = confirmPair[0]
          const setConfirme = confirmPair[1]
          const busyPair = React.useState(false)
          const busy = busyPair[0]
          const setBusy = busyPair[1]
          const liveRef = React.useRef(true)
          React.useEffect(() => () => { liveRef.current = false }, [])
          const charger = React.useCallback(async () => {
            setVue({ phase: 'loading' })
            let status = null
            try { status = await callLocal('/status', 'GET') } catch (e) { status = null }
            if (liveRef.current !== true) return
            if (status !== null && status.connected === true) {
              setVue({ phase: 'connected', state: status.state !== undefined && status.state !== null ? status.state : {} })
              return
            }
            setVue({ phase: 'disconnected' })
          }, [])
          React.useEffect(() => { void charger() }, [charger])
          const seDeconnecter = async () => {
            setBusy(true)
            try { await callLocal('/disconnect', 'POST', { confirm: true }) } catch (e) { /* déjà parti */ }
            if (liveRef.current === true) { setBusy(false); setConfirme(false); void charger() }
          }

          const ouvrirKybernos = () => {
            const web = (vue.phase === 'connected' && typeof vue.state.web_url === 'string' && vue.state.web_url !== '')
              ? vue.state.web_url : 'https://kybernos.app'
            try { window.open(web + '/profiles?section=data', '_blank', 'noopener') } catch (e) { /* ouverture impossible */ }
          }

          const panneau = (label, ...enfants) => h('div', { className: 'kbp-card' },
            h('div', { className: 'kbs-sect' }, label), ...enfants)

          if (vue.phase !== 'connected') {
            return h('div', { 'data-kb': 'settings-data', style: { display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '720px' } },
              panneau(t('dataLabel'),
                h('p', { className: 'kbf-hint', style: { margin: '10px 0 0' } }, vue.phase === 'loading' ? t('loading') : t('footHint')),
                vue.phase === 'disconnected'
                  ? h('button', {
                      type: 'button', className: 'kbf-connect', style: { marginTop: '10px' },
                      onClick: () => { try { window.dispatchEvent(new Event('kybernos-cloud:open')) } catch (e) { /* Event absent */ } },
                    }, h(EnterIcon, { size: 15 }), h('span', null, t('footConnect')))
                  : null))
          }

          const st = vue.state
          const user = st.user !== undefined && st.user !== null ? st.user : {}
          const device = typeof st.device_label === 'string' && st.device_label.trim() !== '' ? st.device_label.trim() : t('none')
          const rafraichi = fmtDate(st.refreshed_at) !== null ? fmtDate(st.refreshed_at) : t('none')

          return h('div', { 'data-kb': 'settings-data', style: { display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '720px' } },
            // ── Export complet ──
            panneau(t('dataExportTitle'),
              h('p', { style: { margin: '10px 0 0', fontSize: '13px', lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)' } }, t('dataExportSub')),
              h('div', { className: 'kbm-setform-footer' },
                h('button', { type: 'button', className: 'kbm-setform-save', onClick: ouvrirKybernos }, t('dataExportCta'))),
              h('p', { className: 'kbm-setform-unavailable', style: { margin: '0' } }, t('dataExportNote'))),
            // ── Sessions & appareils ──
            panneau(t('dataDevicesTitle'),
              h('p', { style: { margin: '10px 0 0', fontSize: '13px', lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)' } }, t('dataDevicesSub')),
              h('div', { className: 'kbm-setfield', style: { marginTop: '6px' } },
                h('div', { className: 'kbm-setfield-head' },
                  h('span', { className: 'kbm-setfield-label' },
                    h('span', {
                      style: {
                        display: 'inline-block', marginRight: '8px', padding: '1px 7px', borderRadius: '6px',
                        background: 'var(--dsw-alias-interactive-bg-active)', color: 'var(--dsw-alias-label-primary)',
                        fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', verticalAlign: 'middle',
                      },
                    }, t('dataDevicesCurrent')),
                    device),
                  h('button', {
                    type: 'button', className: 'kbm-btn kbm-btn-sm kbm-btn-outline',
                    style: { color: 'var(--dsw-alias-state-error-primary)', flex: '0 0 auto' },
                    onClick: () => setConfirme(true),
                  }, t('dataDevicesSignOut'))),
                h('span', { className: 'kbm-setfield-hint' }, t('dataDevicesHere') + ' · ' + t('dataDevicesRefreshed') + ' ' + rafraichi)),
              h('p', { className: 'kbm-setform-unavailable', style: { margin: '0' } },
                t('dataDevicesOthers') + ' ',
                h('a', {
                  href: ((typeof st.web_url === 'string' && st.web_url !== '') ? st.web_url : 'https://kybernos.app') + '/profiles?section=data',
                  target: '_blank', rel: 'noreferrer', style: { color: 'var(--dsw-alias-link)' },
                }, t('wsOpenHosted'))),
            ),
            // ── Suppression du compte ──
            panneau(t('dataDeleteTitle'),
              h('p', { style: { margin: '10px 0 0', fontSize: '13px', lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)' } }, t('dataDeleteSub')),
              h('div', { className: 'kbm-setform-footer' },
                h('button', {
                  type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-outline',
                  style: { color: 'var(--dsw-alias-state-error-primary)', borderColor: 'var(--dsw-alias-state-error-primary)' },
                  onClick: ouvrirKybernos,
                }, t('dataDeleteCta'))),
              h('p', { className: 'kbm-setform-unavailable', style: { margin: '0' } }, t('dataDeleteNote'))),
            // ── Confirmation de déconnexion de CET appareil ──
            confirme === true
              ? h('div', {
                  className: 'kbc-scrim', 'data-kb': 'data-signout-confirm',
                  onClick: (e) => { if (e.target === e.currentTarget) setConfirme(false) },
                },
                h('div', { className: 'kbc-card', role: 'dialog', 'aria-label': t('dataDevicesConfirm'), style: { maxWidth: '420px' } },
                  h('div', { className: 'kbc-title' }, t('dataDevicesConfirm')),
                  h('div', { className: 'kbc-body' },
                    t('dataDevicesConfirmBody').replace('{device}', device)),
                  h('div', { className: 'kbc-actions', style: { justifyContent: 'flex-end' } },
                    h('button', { type: 'button', className: 'kbc-btn-ghost', disabled: busy, onClick: () => setConfirme(false) }, t('dataDevicesKeep')),
                    h('button', {
                      type: 'button', className: 'kbc-btn-primary',
                      style: { background: 'var(--dsw-alias-state-error-primary)', borderColor: 'var(--dsw-alias-state-error-primary)' },
                      disabled: busy, onClick: () => { void seDeconnecter() },
                    }, busy === true ? t('dataDevicesSigningOut') : t('dataDevicesSignOut')))))
              : null)
        }
        ctx.effect(() => slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'kybernos-data', order: 11.5, label: t('dataNavLabel') }, DataSection)),
        'kybernos-cloud: onglet Donnees & confidentialite des reglages')
      },
    }
  },
})
