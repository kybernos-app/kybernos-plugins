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
        spaceTitle: 'Équipe',
        wsSwitchTitle: 'Changer d\'équipe',
        wsSwitchSub: 'switch',
        wsPageTitle: 'Équipe',
        wsPersonal: 'Personnel',
        wsPrev: 'Équipe précédente',
        wsNext: 'Équipe suivante',
        wsNew: 'Nouvelle équipe',
        wsNewTitle: 'Créer une équipe',
        wsNewName: 'Nom de l\'équipe',
        wsNewCreate: 'Créer',
        wsNewHosted: 'Créer dans Kybernos',
        wsNewErr: 'Le serveur a refusé de créer l\'équipe.',
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
        wsSettingsTitle: 'Réglages d\'équipe',
        wsOpenHosted: 'Ouvrir dans Kybernos',
        wsClose: 'Fermer',
        spaceSwitch: 'Changer d\'équipe',
        spaceActive: 'Équipe active',
        spaceSetup: 'Réglage de la synchronisation',
        spaceOpen: 'Ouvrir dans Kybernos',
        spaceMark: 'actif',
        spaceUnknown: 'Équipe inconnue — rien n\'a été changé.',
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
        menuPlanCta: 'Mettre à niveau',
        menuWebsite: 'Site web',
        menuHelp: 'Aide',
        menuUpdate: 'Mise à jour disponible',
        menuFeedback: 'Envoyer un retour',
        menuSettingsApp: 'Paramètres',
        menuTeamsSettings: 'Réglages d\'équipe',
        quotaPayment: 'Le dernier paiement de {name} a échoué : les appels IA sont suspendus jusqu\'à son règlement.',
        quotaPaymentAdmin: ' Réglez-le dans Facturation.',
        quotaPaymentMember: ' Demandez à un propriétaire ou à un admin de {name}.',
        quotaUsedUp: '{pct}\u00a0% de votre quota de {window}{cap} est utilisé — il revient {when}.',
        quotaUsedUpTeam: '{pct}\u00a0% du quota de {window} de {name} est utilisé — il revient {when}.',
        quotaNear: '{pct}\u00a0% de votre quota de {window}{cap} est utilisé.',
        quotaNearTeam: '{pct}\u00a0% du quota de {window} de {name} est utilisé.',
        quotaCap: ' (un plafond fixé dans {name})',
        quotaBackMin: 'dans environ {n}\u00a0min',
        quotaBackHours: 'dans environ {n}\u00a0h',
        quotaBackDays: 'dans environ {n}\u00a0jours',
        quotaBackUnknown: 'à mesure que l\'usage ancien sort de cette fenêtre, et il est entier {window} après votre dernier appel',
        quotaMoreSolo: ' Passez à une formule supérieure ou ajoutez des crédits pour continuer maintenant.',
        quotaMoreAdmin: ' Ajoutez des crédits ou relevez le plafond dans Formule et crédits.',
        quotaMoreMember: ' Demandez plus de crédits à un propriétaire ou à un admin de {name}.',
        quotaOpenConsole: 'Ouvrir Formule et crédits',
        quotaClose: 'Fermer',
        quotaWorkspace: 'cette équipe',
        quotaHours: '{n} heures',
        quotaDays: '{n} jours',
        quotaMinutes: '{n} minutes',
        mfaBlockedShort: 'Second facteur requis',
        mfaBlockedLong: '{name} demande un second facteur à ses membres et vous n\'en avez pas : activez-en un dans votre compte Kybernos (Sécurité), puis rechargez.',
        mfaGraceShort: 'Second facteur d\'ici le {date}',
        mfaGraceLong: '{name} demande un second facteur à ses membres : activez-en un dans votre compte Kybernos (Sécurité) avant le {date}, ensuite l\'équipe vous sera fermée.',
        // ── onglet Account : champs profil éditables (comme la webapp) ──
        // ── onglet « Données & confidentialité » (30/09 soir) ──
        dataNavLabel: 'Données & confidentialité',
        dataSub: 'Exportez vos données, gérez l\'appareil connecté ici ou supprimez votre compte.',
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
        accInstructions: 'Instructions personnalisées — comment tous les Kybers vous traitent',
        accInstructionsPh: 'Soyez direct. Phrases courtes…',
        accSave: 'Enregistrer',
        accSaved: 'Enregistré ✓',
        accSub: 'Votre profil, vos préférences et vos instructions. Ils restent sur cet appareil.',
        accAbout: 'À propos de vous',
        accPrefs: 'Préférences',
        accBirthPh: 'Choisir une date',
        accClear: 'Effacer',
        accPrevMonth: 'Mois précédent',
        accNextMonth: 'Mois suivant',
        accMonth: 'Mois',
        accYear: 'Année',
        accTzPh: 'Rechercher une ville, un pays, un fuseau…',
        accTzNone: 'Aucun fuseau trouvé',
        accTzUseAuto: 'Utiliser le fuseau détecté',
        accUnsaved: 'Modifications non enregistrées',
        accDiscard: 'Annuler',
        accRefreshing: 'Actualisation…',
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
        spaceTitle: 'Team',
        wsSwitchTitle: 'Switch team',
        wsSwitchSub: 'switch',
        wsPageTitle: 'Team',
        wsPersonal: 'Personal',
        wsPrev: 'Previous team',
        wsNext: 'Next team',
        wsNew: 'New team',
        wsNewTitle: 'Create a team',
        wsNewName: 'Team name',
        wsNewCreate: 'Create',
        wsNewHosted: 'Create in Kybernos',
        wsNewErr: 'The server refused to create the team.',
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
        wsSettingsTitle: 'Team settings',
        wsOpenHosted: 'Open in Kybernos',
        wsClose: 'Close',
        spaceSwitch: 'Switch team',
        spaceActive: 'Active team',
        spaceSetup: 'Sync settings',
        spaceOpen: 'Open in Kybernos',
        spaceMark: 'active',
        spaceUnknown: 'Unknown team — nothing was changed.',
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
        menuPlanCta: 'Upgrade',
        menuWebsite: 'Website',
        menuHelp: 'Help',
        menuUpdate: 'Update available',
        menuFeedback: 'Send feedback',
        menuSettingsApp: 'Settings',
        menuTeamsSettings: 'Team settings',
        quotaPayment: 'The last payment for {name} failed: AI calls are paused until it is settled.',
        quotaPaymentAdmin: ' Fix it in Billing.',
        quotaPaymentMember: ' Ask an owner or admin of {name}.',
        quotaUsedUp: '{pct}% of your {window} allowance{cap} is used — it comes back {when}.',
        quotaUsedUpTeam: '{pct}% of the {window} allowance of {name} is used — it comes back {when}.',
        quotaNear: '{pct}% of your {window} allowance{cap} is used.',
        quotaNearTeam: '{pct}% of the {window} allowance of {name} is used.',
        quotaCap: ' (a cap set in {name})',
        quotaBackMin: 'in about {n}\u00a0min',
        quotaBackHours: 'in about {n}\u00a0h',
        quotaBackDays: 'in about {n}\u00a0days',
        quotaBackUnknown: 'as older use leaves that window, and is whole again {window} after your last call',
        quotaMoreSolo: ' Upgrade or add credits to go on now.',
        quotaMoreAdmin: ' Add credits or raise the cap in Plan & Credits.',
        quotaMoreMember: ' Ask an owner or admin of {name} for more credits.',
        quotaOpenConsole: 'Open Plan & Credits',
        quotaClose: 'Close',
        quotaWorkspace: 'this team',
        quotaHours: '{n} hours',
        quotaDays: '{n} days',
        quotaMinutes: '{n} minutes',
        mfaBlockedShort: 'Second factor required',
        mfaBlockedLong: '{name} asks its members for a second factor and you have none: set one up in your Kybernos account (Security), then reload.',
        mfaGraceShort: 'Second factor by {date}',
        mfaGraceLong: '{name} asks its members for a second factor: set one up in your Kybernos account (Security) before {date}, after that the team is closed to you.',
        dataNavLabel: 'Data & privacy',
        dataSub: 'Export your data, manage the device signed in here, or delete your account.',
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
        accInstructions: 'Custom instructions — how all Kybers treat you',
        accInstructionsPh: 'Be direct. Short sentences…',
        accSave: 'Save',
        accSaved: 'Saved ✓',
        accSub: 'Your profile, preferences and instructions. They stay on this device.',
        accAbout: 'About you',
        accPrefs: 'Preferences',
        accBirthPh: 'Pick a date',
        accClear: 'Clear',
        accPrevMonth: 'Previous month',
        accNextMonth: 'Next month',
        accMonth: 'Month',
        accYear: 'Year',
        accTzPh: 'Search a city, a country, a time zone…',
        accTzNone: 'No time zone found',
        accTzUseAuto: 'Use detected time zone',
        accUnsaved: 'Unsaved changes',
        accDiscard: 'Discard',
        accRefreshing: 'Refreshing…',
        accLocalNote: 'These fields stay on this device — the webapp profile page keeps them browser-side too: the server does not serve them.',
        themeLight: 'Light',
        themeDark: 'Dark',
      },
    }

    // Publish the bundle vocabulary for the Language page's translation corpus
    // (window.__KB_I18N_PACKS__, read by @local/kybernos-language): each entry
    // carries the French source and the English fallback; the corpus translates
    // the French, and t() serves the result under 'cloud.<key>'. Built once, at
    // factory time, before any settings page can start a translation run.
    try {
      if (typeof window !== 'undefined') {
        const packs = window.__KB_I18N_PACKS__ = window.__KB_I18N_PACKS__ || []
        const keys = {}
        for (const k of Object.keys(DICT.fr)) {
          const fr = DICT.fr[k]
          const en = DICT.en[k]
          if (typeof fr !== 'string' || fr === '') continue
          if (typeof en !== 'string' || en === '') continue
          keys[k] = { fr: fr, en: en }
        }
        packs.push({ id: 'kybernos-cloud', keys: keys })
      }
    } catch (e) { /* publishing must never break the factory */ }

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
/* Full-frame page (slot main): it lives in the content area, not in an overlay.
   Only the profile page uses it now (the local Team page was removed as unreachable). */
.kbp-page{display:flex;flex-direction:column;height:100%;overflow:auto;padding:24px 30px 40px;color:var(--dsw-alias-label-primary,#e9e9ee)}
.kbp-head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
.kbp-title{font-size:22px;font-weight:700;letter-spacing:-.01em;margin:0}
.kbp-sub{display:block;margin-top:3px;font-size:12.5px;color:var(--dsw-alias-label-tertiary,#8a8a93)}
.kbp-back{margin-left:auto;padding:7px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:9px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}
.kbp-back:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14))}
.kbp-card{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22));border-radius:14px;padding:20px 22px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06))}
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
.kbs-note{padding:9px 11px;border-radius:8px;border-left:3px solid var(--dsw-alias-state-warn-primary,#f59e0b);background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.10));font-size:11.5px;line-height:1.5}
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
.kbfp-tile{flex:none;width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-base));font-family:ui-monospace,monospace;font-weight:700;font-size:13px}
.kbfp-cardtxt{flex:1 1 auto;min-width:0;margin-inline-start:2px}
.kbfp-cardname{display:block;font-size:14px;font-weight:600;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbfp-cardsub{display:block;font-size:12px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* The allowance meter under the plan line: a thin bar and the percent used (never tokens or money); amber from 75 %, red when used up. */
.kbfp-use{display:flex;align-items:center;gap:6px;margin-top:4px;min-width:0}
.kbfp-usebar{flex:1 1 auto;min-width:24px;height:4px;border-radius:2px;background:var(--dsw-alias-border-l2);overflow:hidden}
.kbfp-usefill{display:block;height:100%;border-radius:2px;background:var(--dsw-alias-label-secondary)}
.kbfp-usepct{flex:none;min-width:30px;text-align:right;font-size:11px;line-height:1;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary)}
.kbfp-use[data-level="near"] .kbfp-usefill{background:var(--dsw-alias-state-warn-primary)}
.kbfp-use[data-level="full"] .kbfp-usefill{background:var(--dsw-alias-state-error-primary)}
.kbfp-use[data-level="full"] .kbfp-usepct{color:var(--dsw-alias-state-error-primary)}
.kbfp-ico{flex:none;width:36px;height:36px;padding:0;border:none;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;justify-content:center;cursor:pointer}
.kbfp-ico:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.kbfp-bellwrap{display:flex}
/* The bell popover matches the CARD WIDTH (like the menu): the containing
   block is .kbfp-card (the bell wrap is no longer positioned).
   Anchored to the button with a fixed width of 248 px, it overflowed the left
   edge of the window whenever the sidebar is narrow (04/10) and its empty text
   overflowed the frame for lack of inner padding. */
.kbfp-bellpop{left:0;right:0;width:auto;box-sizing:border-box;max-width:100%}
.kbfp-bellpop .kbc-note{margin:0;padding:2px 10px 8px;overflow-wrap:anywhere}
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
.kbqn{position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:90;max-width:min(620px,92vw);box-sizing:border-box;display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));background:var(--dsw-alias-bg-layer-2,#2a2a30);box-shadow:var(--dsw-elevation-panel,0 8px 28px rgba(0,0,0,.35));color:var(--dsw-alias-label-primary,#e9e9ee);font-size:13px;line-height:1.45}
.kbqn-text{flex:1 1 auto;min-width:0}
.kbqn-act{flex:0 0 auto;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));background:transparent;color:inherit;border-radius:10px;padding:5px 10px;font:inherit;cursor:pointer;white-space:nowrap}
.kbqn-act:hover{background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.14))}
.kbqn-x{flex:0 0 auto;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#a0a0aa);font-size:18px;line-height:1;cursor:pointer;padding:0 2px}
.kbfp-mhead{display:flex;align-items:center;gap:12px;width:100%;min-height:40px;box-sizing:border-box;padding:0 10px;border:none;border-radius:10px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.kbfp-mhead:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbfp-mheadtxt{flex:1 1 auto;min-width:0}
.kbfp-mheadname{display:block;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbfp-mheadsub{display:block;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.kbfp-mhead svg{flex:none;color:var(--dsw-alias-label-tertiary)}
.kbfp-tile{position:relative}
.kbfp-tile[data-update=true]::after{content:"";position:absolute;top:-3px;right:-3px;width:10px;height:10px;border-radius:50%;background:#f5a524;border:2px solid var(--dsw-alias-bg-layer-1)}
.kbfp-mtail{flex:none;margin-inline-start:auto;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.kbfp-mplan{margin:4px 0;box-sizing:border-box;padding:2px 10px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover)}
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
/* Account tab of Settings (revamp 04/10): cards, custom fields, calendar
   and time zone picker. All in design-system tokens, nothing hard-coded
   except the avatar palette. */
.kbax{display:flex;flex-direction:column;gap:14px;max-width:720px;position:relative}
/* Page head of the Account and Data & privacy pages. The title (18/600) and the sub-title (13, 6px under it) are NOT styled here: the core plugin's
   single Settings head rule styles every .kb6-title / .kb8-sub inside the dialog. Only the 6px below is ours: these pages stack their cards with a 14px
   gap, and the first card has to sit 20px under the sub-title (as on the pages built with the core plugin's KbacHead). */
.kbpg-head{margin:0 0 6px}
.kbax-card{display:flex;flex-direction:column;gap:14px;padding:18px;border-radius:16px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.kbax-hero{flex-direction:row;align-items:center;gap:18px}
.kbax-avwrap{position:relative;flex:none}
.kbax-avatar{display:flex;align-items:center;justify-content:center;width:76px;height:76px;border-radius:22px;color:#fff;font-family:ui-monospace,monospace;font-weight:700;font-size:26px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
.kbax-avcam{position:absolute;right:-6px;bottom:-6px;display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;border:2px solid var(--dsw-alias-bg-layer-1);background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);cursor:pointer}
.kbax-avcam:hover{transform:scale(1.08)}
.kbax-herotxt{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
.kbax-heroname{display:flex;align-items:center;gap:8px;min-width:0}
.kbax-heroname b{font-size:17px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbax-heromail{font-size:13px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbax-swatches{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}
.kbax-row{display:flex;flex-direction:column;gap:7px}
.kbax-label{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbax-anchor{position:relative;min-width:0}
.kbax-field{display:flex;align-items:center;gap:9px;box-sizing:border-box;width:100%;min-height:38px;padding:0 12px;border-radius:11px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;transition:border-color .12s ease,box-shadow .12s ease}
.kbax-field:hover{border-color:var(--dsw-alias-border-l3)}
.kbax-field:focus-within,.kbax-fieldbtn:focus-visible,.kbax-field.open{outline:none;border-color:var(--dsw-alias-state-business-primary,#6b8cff);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,#6b8cff) 22%,transparent)}
.kbax-input{padding:0 12px}
.kbax-field svg{flex:none;color:var(--dsw-alias-label-tertiary)}
.kbax-fieldbtn{cursor:pointer;text-align:start}
.kbax-fieldbtn.empty .kbax-fieldtxt{color:var(--dsw-alias-label-tertiary)}
.kbax-fieldtxt{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbax-clearx{position:absolute;right:8px;top:50%;transform:translateY(-50%);display:flex;align-items:center;justify-content:center;width:22px;height:22px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.kbax-clearx:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.kbax-bare,.kbax-comboinput{flex:1 1 auto;min-width:0;height:36px;padding:0;border:none;outline:none;background:transparent;color:inherit;font:inherit}
.kbax-bare::placeholder,.kbax-comboinput::placeholder,.kbax-field input::placeholder,.kbax-area::placeholder{color:var(--dsw-alias-label-tertiary)}
.kbax-input{height:38px;font:inherit}
.kbax-inline{display:flex;gap:8px}
.kbax-inline .kbax-field{flex:1 1 auto}
.kbax-area{display:block;height:auto;min-height:104px;padding:10px 12px;resize:vertical;line-height:1.5}
.kbax-count{align-self:flex-end;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.kbax-btn{flex:none;height:38px;padding:0 14px;border-radius:11px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:550;cursor:pointer}
.kbax-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.kbax-btn:disabled{opacity:.5;cursor:default}
.kbax-primary{border-color:transparent;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base)}
.kbax-primary:hover:not(:disabled){background:var(--dsw-alias-label-primary);opacity:.9}
.kbax-link{border:none;background:transparent;padding:2px 4px;color:var(--dsw-alias-link,var(--dsw-alias-label-secondary));font:inherit;font-size:12.5px;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.kbax-link:disabled{opacity:.4;cursor:default;text-decoration:none}
.kbax-below{align-self:flex-start;margin-top:2px}
.kbax-seg{display:inline-flex;gap:3px;padding:3px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);align-self:flex-start;max-width:100%;flex-wrap:wrap}
.kbax-seg button{height:30px;padding:0 14px;border:none;border-radius:9px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer}
.kbax-seg button:hover{color:var(--dsw-alias-label-primary)}
.kbax-seg button.on{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);font-weight:600}
.kbax-savebar{position:sticky;bottom:12px;z-index:5;display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:10px 12px 10px 16px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);box-shadow:0 10px 28px rgba(0,0,0,.35)}
.kbax-savemsg{margin-inline-end:auto;font-size:13px;display:flex;align-items:center;gap:8px}
.kbax-savemsg.dirty::before{content:"";width:8px;height:8px;border-radius:50%;background:#f5a524}
.kbax-savemsg.ok{color:var(--dsw-alias-state-success-primary)}
.kbax-savebar .kbax-btn{height:34px}
.kbax-skel{border-radius:10px;background:var(--dsw-alias-bg-skeleton,rgba(127,127,127,.18));animation:kbax-pulse 1.4s ease-in-out infinite}
.kbax-skel-head{height:76px;border-radius:18px}
.kbax-skel-line{height:12px;width:40%}
.kbax-skel-line.short{width:22%}
.kbax-skel-field{height:38px;border-radius:11px}
@keyframes kbax-pulse{0%,100%{opacity:1}50%{opacity:.5}}
@media (prefers-reduced-motion:reduce){.kbax-skel{animation:none}}
/* Popovers attached to <body>: calendar and time zone list. */
.kbax-pop{z-index:2147483000;box-sizing:border-box;border-radius:16px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);box-shadow:0 18px 44px rgba(0,0,0,.45);color:var(--dsw-alias-label-primary);font-size:13px}
.kbax-cal{width:296px;padding:10px}
.kbax-cal-head{display:flex;align-items:center;gap:6px;margin-bottom:8px}
.kbax-cal-sel{display:flex;flex:1 1 auto;gap:6px;min-width:0}
.kbax-minisel{flex:1 1 auto;min-width:0;height:32px;padding:0 8px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:600;text-transform:capitalize;cursor:pointer}
.kbax-minisel:last-child{flex:0 0 76px}
.kbax-iconbtn{display:flex;align-items:center;justify-content:center;flex:none;width:32px;height:32px;border:none;border-radius:9px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.kbax-iconbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.kbax-iconbtn:disabled{opacity:.3;cursor:default}
.kbax-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
.kbax-cal-wd{display:flex;align-items:center;justify-content:center;height:26px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
.kbax-day{display:flex;align-items:center;justify-content:center;height:34px;border:none;border-radius:10px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.kbax-day.out{color:var(--dsw-alias-label-tertiary);opacity:.55}
.kbax-day:hover:not(:disabled):not(.sel){background:var(--dsw-alias-interactive-bg-hover)}
.kbax-day:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#6b8cff);outline-offset:-2px}
.kbax-day.today{box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l3)}
.kbax-day.sel{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);font-weight:700;opacity:1}
.kbax-day:disabled{opacity:.25;cursor:default}
.kbax-cal-foot{display:flex;justify-content:flex-end;margin-top:6px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l1)}
.kbax-tzpop{padding:6px;max-width:calc(100vw - 16px)}
.kbax-tzlist{max-height:300px;overflow-y:auto;overscroll-behavior:contain}
.kbax-combo .kbax-comboinput{cursor:text}
.kbax-tzbadge{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.kbax-chev{display:flex;flex:none}
.kbax-tzgroup{position:sticky;top:0;z-index:1;padding:8px 10px 4px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2)}
.kbax-tzrow{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:10px;cursor:pointer}
.kbax-tzrow.active{background:var(--dsw-alias-interactive-bg-hover)}
.kbax-tzrow.sel b{color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-primary))}
.kbax-tzico{display:flex;color:var(--dsw-alias-label-tertiary)}
.kbax-tzmain{display:flex;flex-direction:column;min-width:0;flex:1 1 auto;line-height:1.3}
.kbax-tzmain b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbax-tzsub{font-size:11.5px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbax-tzoff{flex:none;font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.kbax-tick{flex:none;color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-primary));font-weight:700}
.kbax-tzempty{padding:14px 10px;text-align:center;color:var(--dsw-alias-label-tertiary)}
@media (max-width:560px){.kbax-hero{flex-direction:column;align-items:flex-start}}
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

    const UpdateIcon = (props) => svgIcon(() => [
      h('circle', { key: 'a', cx: 12, cy: 12, r: 9, stroke: 'currentColor', strokeWidth: 1.75 }),
      h('path', { key: 'b', d: 'M12 7.5v8M8.5 12.5l3.5 3.5 3.5-3.5', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' }),
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
    /** The plan to show for the ACTIVE space. The host reads it from the server (`state.space_plan`); the account's own word
     *  (`user.plan`, « team » as soon as the person is in any team) is only the fallback when that read is not there. `free` is
     *  true for a space with no paid plan: the only case that is offered « Upgrade ». Never the raw lowercase key of an API. */
    // The name a person sees for a workspace: the personal one is « Personal » (the server stores it as « My workspace »), a team keeps its own name. `t` is the
    // translator of the caller (this helper lives outside the component that owns it).
    const nomAffiche = (w, t) => (w !== null && typeof w === 'object' && (w.personal === true || w.name === 'My workspace') ? t('wsPersonal') : (w !== null && typeof w === 'object' && typeof w.name === 'string' ? w.name : ''))
    const planDeEspace = (state, user) => {
      const sp = state !== null && state !== undefined && state.space_plan !== undefined && state.space_plan !== null && typeof state.space_plan === 'object' ? state.space_plan : null
      const cap = (m) => (typeof m === 'string' && m.trim() !== '' ? m.trim().charAt(0).toUpperCase() + m.trim().slice(1) : null)
      if (sp !== null) return { label: cap(sp.label), free: sp.key === 'free' || sp.key === 'none' }
      const brut = user !== null && user !== undefined && typeof user.plan === 'string' ? user.plan.trim() : ''
      return { label: cap(brut), free: brut.toLowerCase() === 'free' }
    }

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
    const kbAccVide = () => ({ name: '', birth: '', location: '', instructions: '', color: '', photo: '', tz: '' })
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

    // <quota-notice-text>
    // DSH answers every refused model call with the same fixed words (« Request quota exhausted »): a window used up, a cap an admin set, a failed payment. This says
    // what stopped the person, when it comes back and how to get more, from the server's facts for the active space. The allowance is always a PERCENTAGE of the window
    // (the server's `used_percent`, relayed by the host as `usage`): never tokens, never dollars. Pure: facts and a translator in, a sentence out.
    // `null` means no fact explains it (the server did not answer, or nothing is used up or close to it): the caller then keeps DSH's own words.
    const quotaFill = (text, values) => String(text).replace(/\{(\w+)\}/g, (m, k) => (values[k] !== undefined ? String(values[k]) : m))
    const quotaWindowLabel = (seconds, t) => {
      const n = Number(seconds)
      if (n === 86400) return quotaFill(t('quotaHours'), { n: 24 })
      if (n > 0 && n % 86400 === 0) return quotaFill(t('quotaDays'), { n: n / 86400 })
      if (n > 0 && n % 3600 === 0) return quotaFill(t('quotaHours'), { n: n / 3600 })
      return quotaFill(t('quotaMinutes'), { n: Math.max(1, Math.round(n / 60)) })
    }
    // From this share of a window on, the notice says so even when nothing is used up yet.
    const QUOTA_NEAR_PERCENT = 75
    // « in about 3 h »: when a window that is used up has room again, from the server's time. Null when the server gave none (or one already past).
    const quotaWhen = (iso, now, t) => {
      const ms = typeof iso === 'string' ? Date.parse(iso) - now : NaN
      if (!(ms > 0)) return null
      const minutes = Math.ceil(ms / 60000)
      if (minutes < 60) return quotaFill(t('quotaBackMin'), { n: minutes })
      const hours = Math.round(minutes / 60)
      return hours < 48 ? quotaFill(t('quotaBackHours'), { n: hours }) : quotaFill(t('quotaBackDays'), { n: Math.round(hours / 24) })
    }
    // The windows the host relayed, each with its percent; anything unreadable is left out.
    const quotaWindows = (info) => (Array.isArray(info.usage) ? info.usage : [])
      .filter((w) => w !== null && typeof w === 'object' && (w.kind === 'member' || w.kind === 'pool') && Number.isFinite(w.window_seconds) && Number.isFinite(w.used_percent))
    // The window that turns calls away now. Calls are refused until EVERY used-up window has room again, so the one to name is the one that opens LAST (the later time the
    // server gave, else the longer window), not the one that frees first; on a tie the person's own before the team's pool. The web app and the console name it the same way.
    const quotaOpensAt = (w) => { const at = typeof w.resets_at === 'string' ? Date.parse(w.resets_at) : NaN; return Number.isFinite(at) ? at : 0 }
    const quotaBlocking = (windows) => windows.filter((w) => w.exhausted === true)
      .sort((a, b) => quotaOpensAt(b) - quotaOpensAt(a) || b.window_seconds - a.window_seconds || (a.kind === b.kind ? 0 : a.kind === 'member' ? -1 : 1))[0] || null
    // The window closest to being used up (the longer one on a tie). Null for an empty list.
    const quotaMostUsed = (windows) => windows.slice().sort((a, b) => b.used_percent - a.used_percent || b.window_seconds - a.window_seconds)[0] || null
    const quotaPaymentText = (name, admin, t) => quotaFill(t('quotaPayment'), { name }) + (admin ? t('quotaPaymentAdmin') : quotaFill(t('quotaPaymentMember'), { name }))
    // One window in a sentence: « 82% of your 24 hours allowance is used. », and for a used-up one « 100% of your 5 hours allowance is used — it comes back in about 3 h. ».
    // A window of the team's pool is named after the team, a cap an admin set says where it was set.
    const quotaWindowSentence = (w, name, t, now) => {
      const team = w.kind === 'pool'
      const window = quotaWindowLabel(w.window_seconds, t)
      const cap = !team && w.scope === 'team' ? quotaFill(t('quotaCap'), { name }) : ''
      if (w.exhausted !== true) return quotaFill(t(team ? 'quotaNearTeam' : 'quotaNear'), { pct: w.used_percent, window, cap, name })
      const when = quotaWhen(w.resets_at, now, t) || quotaFill(t('quotaBackUnknown'), { window })
      return quotaFill(t(team ? 'quotaUsedUpTeam' : 'quotaUsedUp'), { pct: 100, window, cap, name, when })
    }
    const quotaNoticeText = (info, t, now = Date.now()) => {
      if (info === null || info === undefined || typeof info !== 'object' || info.ok !== true) return null
      const ws = info.workspace !== null && typeof info.workspace === 'object' ? info.workspace : {}
      const name = typeof ws.name === 'string' && ws.name !== '' ? ws.name : t('quotaWorkspace')
      const admin = ws.role === 'owner' || ws.role === 'admin'
      const shared = ws.personal !== true
      if (info.payment_blocked === true) return { text: quotaPaymentText(name, admin, t), action: admin }
      const windows = quotaWindows(info)
      const out = quotaBlocking(windows)
      // Nothing used up: a gentle word when one window is close to it, nothing at all otherwise (the failing provider is another one).
      const w = out !== null ? out : quotaMostUsed(windows.filter((x) => x.used_percent >= QUOTA_NEAR_PERCENT))
      if (w === null) return null
      const more = out === null ? '' : (shared ? (admin ? t('quotaMoreAdmin') : quotaFill(t('quotaMoreMember'), { name })) : t('quotaMoreSolo'))
      return { text: quotaWindowSentence(w, name, t, now) + more, action: !shared || admin }
    }
    // The small meter on the card of the active team: the percent of the window that counts, and the sentence behind it (its title). An owner or admin of a team sees the
    // team's pool, a member and a personal space their own; a window that turns calls away is always the one shown, and a blocked payment reads 100%. Null: nothing to show
    // (unlimited, or the server did not answer).
    const quotaMeterOf = (info, t, now = Date.now()) => {
      if (info === null || info === undefined || typeof info !== 'object' || info.ok !== true) return null
      const ws = info.workspace !== null && typeof info.workspace === 'object' ? info.workspace : {}
      const name = typeof ws.name === 'string' && ws.name !== '' ? ws.name : t('quotaWorkspace')
      const admin = ws.role === 'owner' || ws.role === 'admin'
      if (info.payment_blocked === true) return { percent: 100, level: 'full', title: quotaPaymentText(name, admin, t) }
      const windows = quotaWindows(info)
      const poolFirst = ws.personal !== true && admin
      const pool = windows.filter((x) => x.kind === 'pool')
      const own = windows.filter((x) => x.kind === 'member')
      const preferred = poolFirst ? pool : own
      const w = quotaBlocking(windows) || quotaMostUsed(preferred.length > 0 ? preferred : (poolFirst ? own : pool))
      if (w === null) return null
      // Red only while calls are turned away; 100% of an allowance that a top-up balance lifts still lets them through (amber).
      const level = w.exhausted === true ? 'full' : w.used_percent >= QUOTA_NEAR_PERCENT ? 'near' : 'ok'
      return { percent: w.exhausted === true ? 100 : w.used_percent, level, title: quotaWindowSentence(w, name, t, now) }
    }
    // </quota-notice-text>
    // How often the card's meter reads the allowance again while it is on screen (it also reads on focus and after a refusal).
    const QUOTA_METER_REFRESH_MS = 120000

    // <mfa-note-text>
    // A workspace that asks its members for a second factor: inside the grace it says by when, after it the person is turned away (DSH can only say « API key is invalid »
    // to them). `mfa` is what the host read for the active space (`space_plan.mfa`), `fmt` formats a date. Pure.
    const mfaNoteText = (mfa, name, t, fmt) => {
      if (mfa === null || mfa === undefined || typeof mfa !== 'object') return null
      const who = typeof name === 'string' && name !== '' ? name : t('quotaWorkspace')
      if (mfa.state === 'blocked') return { short: t('mfaBlockedShort'), long: quotaFill(t('mfaBlockedLong'), { name: who }) }
      if (mfa.state === 'grace') {
        const date = typeof mfa.ends === 'string' ? fmt(mfa.ends) : null
        if (date === null || date === undefined) return null
        return { short: quotaFill(t('mfaGraceShort'), { date }), long: quotaFill(t('mfaGraceLong'), { name: who, date }) }
      }
      return null
    }
    // </mfa-note-text>

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
          // Active language: the mirror the Language runtime keeps of DSH's shell
          // locale (window.__KB_I18N_ACTIVE__), then the first-paint cache
          // (kybernos.theme.lang), then DSH's own locale service, then the French
          // source. 'kybernos' is the DEFAULT (French), never a choice. Any
          // translated language (es, de, ar…) is served through its pack — see t().
          let act = null
          try {
            const a = (typeof window !== 'undefined') ? window.__KB_I18N_ACTIVE__ : null
            if (a !== null && a !== undefined && a.lang !== null && a.lang !== undefined && String(a.lang) !== '') act = String(a.lang)
          } catch (e) { /* no window (test harness) */ }
          if (act === null || act === 'kybernos') {
            try { const l = localStorage.getItem('kybernos.theme.lang'); if (l !== null && l !== '') act = String(l) } catch (e) { /* storage unavailable */ }
          }
          if (act === null || act === 'kybernos') {
            try {
              if (localeSvc !== undefined && localeSvc !== null && typeof localeSvc.getLocale === 'function') {
                const snap = localeSvc.getLocale()
                if (snap !== null && snap !== undefined) {
                  const raw = snap.active || snap.locale || snap.current || snap.lang || snap.id
                  if (typeof raw === 'string' && raw !== '') act = raw.toLowerCase()
                }
              }
            } catch (e) { /* locale service in flux */ }
          }
          if (act === null || act === '' || act === 'kybernos') return 'fr'
          const base = String(act).split(/[-_]/)[0]
          if (base === 'en') return 'en'
          if (DICT[base] !== undefined || kbPackFor(base) !== null) return base
          // A language we have nothing for: English is the fallback, never French.
          return 'en'
        }
        // The translated pack for a language, read once per language and per page
        // (t() runs hundreds of times per render). The browser's copy is kept in
        // step with the disk store (~/.dsh/kybernos/i18n/<lang>.json) by the
        // always-on runtime in @local/kybernos.
        const packCache = { lang: null, dict: null }
        const kbPackFor = (id) => {
          if (packCache.lang === id && packCache.dict !== null) return packCache.dict
          try {
            const raw = localStorage.getItem('kybernos.i18n.' + id)
            if (raw !== null) {
              const d = JSON.parse(raw)
              if (d !== null && typeof d === 'object' && Object.keys(d).length > 0) {
                packCache.lang = id
                packCache.dict = d
                return d
              }
            }
          } catch (e) { /* storage unavailable */ }
          return null
        }
        // Ids in the shared translation store are namespaced ('cloud.<key>') so the
        // bundle vocabulary never collides with kbt keys or another bundle's.
        const KB_PACK_PREFIX = 'cloud.'
        const t = (key) => {
          const pack = kbPackFor(lang())
          if (pack !== null) {
            const v = pack[KB_PACK_PREFIX + key]
            if (typeof v === 'string' && v !== '') return v
          }
          const en = DICT.en[key]
          if (en !== undefined) return en
          const fr = DICT.fr[key]
          if (fr !== undefined) return fr
          return key
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
          const l = lang()
          return d.toLocaleDateString(l === 'en' ? 'en-GB' : l === 'fr' ? 'fr-FR' : l, { day: '2-digit', month: 'short', year: 'numeric' })
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
          // The terms and privacy addresses of the active server (`/kybernos-cloud/legal`): the new server hosts no /terms or /privacy page.
          const [legal, setLegal] = React.useState(null)
          const [refCopied, setRefCopied] = React.useState(false)

          const refCharge = React.useRef(false)
          React.useEffect(() => {
            if (props.page !== true || view.phase !== 'connected' || refCharge.current === true) return
            refCharge.current = true
            setReferral({ phase: 'loading' })
            callLocal('/referral', 'GET')
              .then((r) => { if (liveRef.current === true) setReferral({ phase: 'ready', data: r }) })
              .catch(() => { if (liveRef.current === true) setReferral({ phase: 'error' }) })
            callLocal('/legal', 'GET')
              .then((r) => { if (liveRef.current === true && r !== null && r.ok === true) setLegal({ terms: r.terms, privacy: r.privacy }) })
              .catch(() => { /* no legal links: the section says so */ })
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
              // The host keeps the pairing through a rate limit, a 5xx, a network drop or a page that is not the server's: try again
              // on the next tick instead of showing an error that the next tick would have cleared.
              if (res.ok === false && (res.error === 'reseau' || res.error === 'trop_de_demandes' || res.error === 'reponse_illisible' || res.error === 'reponse illisible')) {
                const until = view.pairing !== undefined && view.pairing !== null ? Date.parse(view.pairing.expires_at) : NaN
                if (Number.isFinite(until) && until < Date.now()) return settle({ phase: 'error', error: res.error })
                return
              }
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
                      ? h('a', { className: 'kbs-link', href: web + '/account', target: '_blank', rel: 'noreferrer' }, t('refOpen'))
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
                          ? h('div', { className: 'kbc-note' }, h('a', { className: 'kbs-link', href: web + '/workspace-console', target: '_blank', rel: 'noreferrer' }, t('wsOpenHosted')))
                          : null))
              } else {
                section = h('div', { className: 'kbp-card kbp-sec' },
                  h('div', { className: 'kbs-sect' }, t('supTitle')),
                  h('div', { className: 'kbc-note', style: { margin: '10px 0 4px' } }, t('supNote')),
                  // Only what the server publishes (GET /v1/public/legal): a document it does not configure has no row; there is no support page.
                  (legal === null || (legal.terms === null && legal.privacy === null))
                    ? h('div', { className: 'kbc-note' }, t('none'))
                    : h('div', { className: 'kbc-rows' },
                      legal.privacy === null ? null : h(Row, { key: 'privacy', label: t('supPrivacy'), value: legal.privacy.url }),
                      legal.terms === null ? null : h(Row, { key: 'terms', label: t('supTerms'), value: legal.terms.url })),
                  h('div', { className: 'kbc-actions' },
                    legal !== null && legal.terms !== null ? h('a', { className: 'kbs-link', href: legal.terms.url, target: '_blank', rel: 'noreferrer' }, t('supTerms')) : null,
                    legal !== null && legal.privacy !== null ? h('a', { className: 'kbs-link', href: legal.privacy.url, target: '_blank', rel: 'noreferrer' }, t('supPrivacy')) : null))
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
                  h('span', { className: 'kbs-name' }, w ? nomAffiche(w, t) || t('none') : t('none')),
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
            // Never a dialog that silently does nothing: the sentence says it was refused (with the server's code when there is one), and the hosted page stays offered.
            if (res !== null && typeof res.web_url === 'string' && res.web_url !== '') setHosted(res.web_url)
            setErreur(t('wsNewErr') + (res !== null && typeof res.status === 'number' && res.status > 0 ? ' (' + String(res.status) + ')' : ''))
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
        const lireMaj = () => {
          try {
            const m = window.__kbUpdate
            return m !== null && m !== undefined && typeof m === 'object' && typeof m.cible === 'string' && m.cible !== '' ? m : null
          } catch (e) { return null }
        }
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
          const nomEspace = courant !== null && courant.name ? nomAffiche(courant, t) : t('spaceTitle')
          const planInfo = planDeEspace(st, user)
          const plan = planInfo.label !== null ? planInfo.label : t('none')
          // The host reports the active server's web address in every connected state; with none, nothing is opened (never a literal host).
          const web = typeof st.web_url === 'string' && st.web_url !== '' ? st.web_url : ''

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
          // Update available: published by kybernos-maintenance
          // (`window.__kbUpdate` + `kybernos:update` event, null = up to date).
          const majPair = React.useState(() => lireMaj())
          const maj = majPair[0]
          const setMaj = majPair[1]
          React.useEffect(() => {
            const sur = () => setMaj(lireMaj())
            window.addEventListener('kybernos:update', sur)
            return () => window.removeEventListener('kybernos:update', sur)
          }, [])
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
            opts !== undefined && typeof opts.tail === 'string' ? h('span', { className: 'kbfp-mtail' }, opts.tail) : null,
            opts !== undefined && opts.ext === true ? h('span', { className: 'kbfp-mext', 'aria-hidden': 'true' }, h(ExtIcon, { size: 16 })) : null)

          const ouvrirWeb = () => { if (web === '') return; try { window.open(web, '_blank', 'noopener') } catch (e) { /* ouverture impossible */ } }
          const envoyer = (nom) => { try { window.dispatchEvent(new Event('kybernos:menu:' + nom)) } catch (e) { /* Event absent */ } }

          // Blocks separated by a rule: Teams (space, plan, team settings) ·
          // Account · Links, then Log out. An available update goes first.
          // "Security" is no longer in the menu (04/10); the plan moves up under
          // the space selector, just before "Teams settings".
          return h('div', { className: 'kbfp-menu', ref: popRef, role: 'menu', 'aria-label': t('wsPageTitle') },
            maj !== null
              ? h('div', { className: 'kbfp-mitems', 'data-kb': 'menu-block-update' },
                  entree('update', h(UpdateIcon, { size: 18 }), t('menuUpdate'), () => envoyer('update'), { amber: true, tail: (maj.kind === 'moteur' ? 'DSH ' : '') + (typeof maj.version === 'string' ? maj.version : maj.cible) }),
                  h('div', { className: 'kbfp-msep' }))
              : null,
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
              h('div', { className: 'kbfp-mplan' },
                h('div', { className: 'kbfp-mplanline' },
                  h('span', { className: 'kbfp-mplanname' }, plan),
                  // « Upgrade » only where there is something to upgrade from: a paying person, or a Team, is not offered it.
                  planInfo.free === true ? h('button', { type: 'button', className: 'kbfp-mcta', 'data-kb': 'menu-plan-cta', onClick: ouvrirWeb }, t('menuPlanCta')) : null)),
              // "Teams settings" = the former "Workspace settings" (same action).
              entree('space-settings', h(BuildingIcon, { size: 18 }), t('menuTeamsSettings'), props.onSpace)),
            h('div', { className: 'kbfp-msep' }),
            h('div', { className: 'kbfp-mitems', 'data-kb': 'menu-block-account' },
              entree('account', h(UserIcon, { size: 18 }), t('profCompte'), props.onAccount),
              // Referral: opens the matching Settings section.
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
              entree('help', h(HelpIcon, { size: 18 }), t('menuHelp'), () => envoyer('help')),
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
          // Update available: an amber dot on the card tile, the discreet
          // reminder that stays visible with the menu closed (kybernos-maintenance signal).
          const [majDispo, setMajDispo] = React.useState(() => lireMaj() !== null)
          React.useEffect(() => {
            const sur = () => setMajDispo(lireMaj() !== null)
            window.addEventListener('kybernos:update', sur)
            return () => window.removeEventListener('kybernos:update', sur)
          }, [])
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

          // The team console (an iframe of another page) changed the active space through the host: re-read it, so the card and the
          // console never show two different teams.
          React.useEffect(() => {
            const relire = () => { void load() }
            window.addEventListener('kybernos-cloud:space-changed', relire)
            return () => window.removeEventListener('kybernos-cloud:space-changed', relire)
          }, [load])

          // The meter of the card: how much of the allowance is used in the ACTIVE team (a percentage, never tokens or money), read from the host (it asks the
          // server) when the card appears, when the active team changes, when the window comes back into view, every two minutes, and as soon as the quota notice
          // has read a refusal. A failed read keeps the last figure; changing team clears it, so one team's percent is never shown under another's name.
          const [quota, setQuota] = React.useState(null)
          const quotaSpace = phase === 'connected' && typeof state.active_workspace_id === 'string' ? state.active_workspace_id : null
          React.useEffect(() => {
            setQuota(null)
            if (quotaSpace === null) return undefined
            let on = true
            const read = () => {
              callLocal('/quota', 'GET').then((r) => { if (on === true && r !== null && r !== undefined && r.ok === true) setQuota(r) }).catch(() => null)
            }
            read()
            const seen = () => { if (document.visibilityState === 'visible') read() }
            const timer = window.setInterval(read, QUOTA_METER_REFRESH_MS)
            document.addEventListener('visibilitychange', seen)
            window.addEventListener('kybernos-cloud:quota-read', read)
            return () => {
              on = false
              window.clearInterval(timer)
              document.removeEventListener('visibilitychange', seen)
              window.removeEventListener('kybernos-cloud:quota-read', read)
            }
          }, [quotaSpace])

          // La fiche peut être ouverte depuis un autre plugin (page Models) :
          // même événement fenêtre que l'ancien bouton, rien de nouveau.
          React.useEffect(() => {
            const ouvrir = () => setOpen(true)
            window.addEventListener('kybernos-cloud:open', ouvrir)
            return () => window.removeEventListener('kybernos-cloud:open', ouvrir)
          }, [])

          // Another plugin can open the team switcher (same seam as the account card).
          React.useEffect(() => {
            const ouvrirSelecteur = () => setMenuOpen(true)
            window.addEventListener('kybernos-cloud:switch', ouvrirSelecteur)
            return () => window.removeEventListener('kybernos-cloud:switch', ouvrirSelecteur)
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
            const nomEspace = courant !== null && courant.name ? nomAffiche(courant, t) : t('spaceTitle')
            const mfaNote = mfaNoteText(state.space_plan !== undefined && state.space_plan !== null ? state.space_plan.mfa : null, nomEspace, t, fmtDate)
            const planEspace = planDeEspace(state, user).label !== null ? planDeEspace(state, user).label : t('none')
            const meter = quota !== null ? quotaMeterOf(quota, t) : null
            const ouvrirPageEspace = () => {
              // « Réglage de l'espace » (02/10) : l'entrée ouvre la page EMBED
              // qui vivait jusqu'ici dans Paramètres ▸ Mon espace — l'iframe
              // workspace-console (console du gateway LLM), montée en plein
              // cadre dans la zone de contenu par le bundle kybernos-plugin.
              // Le pont marche par contrat : le composant de la page vit dans
              // le plugin, et cette entrée se contente de demander son
              // ouverture — jamais de dupliquer l'iframe ici.
              // Fallback if the plugin has no console bridge (a master older than
              // 02/10): the rich « Mon espace » page of the Kybernos panel. No local
              // page stands behind it any more (it was removed as unreachable): the
              // master bundle is mandatory in the Suite (docs/beta/satellites.json)
              // and sets both bridges unconditionally, so a missing bridge can only
              // mean a stale master.
              const ouvrir = (typeof window !== 'undefined') ? window.__kbOpenWsConsole : null
              if (typeof ouvrir === 'function') {
                try { ouvrir(); return } catch (e) { /* fall back to the rich page */ }
              }
              const ouvrirRiche = (typeof window !== 'undefined') ? window.__kbOpenWorkspace : null
              if (typeof ouvrirRiche === 'function') {
                try { ouvrirRiche() } catch (e) { /* nothing left to try: the click does nothing */ }
              }
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
                'aria-label': meter !== null ? t('wsPageTitle') + ' — ' + meter.title : t('wsPageTitle'), 'aria-haspopup': 'menu',
                'aria-expanded': menuOpen === true ? 'true' : 'false',
                onClick: () => { setNotifOpen(false); setMenuOpen(menuOpen !== true) },
              },
              h('span', { className: 'kbfp-tile', 'aria-hidden': 'true', 'data-update': majDispo === true ? 'true' : undefined }, initiales(nomEspace, '')),
              h('span', { className: 'kbfp-cardtxt' },
                h('span', { className: 'kbfp-cardname' }, nomEspace),
                h('span', { className: 'kbfp-cardsub', title: mfaNote !== null ? mfaNote.long : undefined, 'data-kb': mfaNote !== null ? 'workspace-card-mfa' : undefined }, qui + ' · ' + planEspace + (mfaNote !== null ? ' · ⚠ ' + mfaNote.short : '')),
                meter !== null
                  ? h('span', { className: 'kbfp-use', 'data-kb': 'workspace-card-usage', 'data-level': meter.level, 'data-percent': String(meter.percent), title: meter.title },
                    h('span', { className: 'kbfp-usebar', 'aria-hidden': 'true' }, h('span', { className: 'kbfp-usefill', style: { width: meter.percent + '%' } })),
                    h('span', { className: 'kbfp-usepct' }, meter.percent + '%'))
                  : null)),
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

        // ── The quota notice ──────────────────────────────────────────────────────
        // DSH's own notice says « Request quota exhausted » for every refusal; this one (claimed through the `shell.quota-notice` chain, QUOTA only) asks the host
        // for the facts of the ACTIVE space and says what stopped the person, when it comes back and how to get more. If no fact explains it (the failing provider
        // is another one, the server did not answer) it shows DSH's own message, so nothing is lost.
        const KbQuotaNotice = (props) => {
          const infoPair = React.useState(null)
          const info = infoPair[0]
          const setInfo = infoPair[1]
          React.useEffect(() => {
            let on = true
            callLocal('/quota', 'GET').then((r) => {
              if (on === true) setInfo({ r: r })
              // A refused call changed the allowance: the card's meter reads it again now instead of at its next turn.
              try { window.dispatchEvent(new Event('kybernos-cloud:quota-read')) } catch (e) { /* no window events here */ }
            }).catch(() => { if (on === true) setInfo({ r: null }) })
            return () => { on = false }
          }, [])
          React.useEffect(() => {
            const id = window.setTimeout(() => { try { props.dismiss() } catch (e) { /* already gone */ } }, 15000)
            return () => window.clearTimeout(id)
          }, [])
          const verdict = info !== null ? quotaNoticeText(info.r, t) : null
          const text = verdict !== null ? verdict.text : String(props.message || '')
          const openConsole = () => {
            const wsId = info !== null && info.r !== null && info.r.workspace !== undefined ? info.r.workspace.id : undefined
            // The HOST opens the system browser with the single-use link (the server refuses one that a page-opened tab brings); a host that could not hands the address back.
            callLocal('/console/link', 'POST', typeof wsId === 'string' ? { workspace_id: wsId, open: true } : { open: true }).then((r) => {
              if (r !== null && r !== undefined && r.ok === true && r.opened !== true && typeof r.url === 'string') { try { window.open(r.url, '_blank', 'noopener,noreferrer') } catch (e) { /* ouverture impossible */ } }
            }).catch(() => null)
            try { props.dismiss() } catch (e) { /* already gone */ }
          }
          return h('div', { className: 'kbqn', role: 'alert', 'data-kb': 'quota-notice' },
            h('span', { className: 'kbqn-text' }, text),
            verdict !== null && verdict.action === true ? h('button', { type: 'button', className: 'kbqn-act', 'data-kb': 'quota-notice-open', onClick: openConsole }, t('quotaOpenConsole')) : null,
            h('button', { type: 'button', className: 'kbqn-x', 'aria-label': t('quotaClose'), onClick: () => { try { props.dismiss() } catch (e) { /* already gone */ } } }, '×'))
        }
        ctx.effect(() => slots.inject('shell.quota-notice', () => slots.register(
          { name: 'shell.quota-notice', select: (owner) => (owner !== null && owner !== undefined && owner.code === 'QUOTA' ? owner : null), inject: () => ({}) }, KbQuotaNotice)),
        'kybernos-cloud: notice de quota')

        // ── Onglet « Account » des RÉGLAGES (30/09 soir) ────────────────────
        // Mêmes infos que la page compte du serveur
        // (<web>/account) : identité, formule, teams, espace
        // actif, appareil, session — lues des routes locales, jamais
        // inventées. Le lien « Ouvrir dans Kybernos » pointe la page web.
        // ── Account page pickers (04/10) ────────────────────────────────────────
        // Date of birth: a custom calendar (the native <input type=date> is
        // unreadable in dark theme and forces going back month by month for a
        // birth date). Time zone: a filterable list with autocompletion
        // (city, region, country, abbreviation, offset) instead of a <select> of
        // 420 lines. No network: everything comes from `Intl`.
        const kbPad = (n) => (n < 10 ? '0' : '') + String(n)
        const kbIso = (c) => String(c.y) + '-' + kbPad(c.m) + '-' + kbPad(c.d)
        const kbParseIso = (v) => {
          const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof v === 'string' ? v : '')
          if (m === null) return null
          const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3])
          const dt = new Date(Date.UTC(y, mo - 1, d))
          return (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) ? { y: y, m: mo, d: d } : null
        }
        const kbDaysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()
        const kbDow = (c) => new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCDay()
        const kbToday = () => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() } }
        const kbCmp = (a, b) => (a.y - b.y) || (a.m - b.m) || (a.d - b.d)
        const kbShiftDays = (c, n) => { const dt = new Date(Date.UTC(c.y, c.m - 1, c.d + n)); return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() } }
        const kbShiftMonths = (c, n) => {
          const total = c.y * 12 + (c.m - 1) + n
          const y = Math.floor(total / 12)
          const m = total - y * 12 + 1
          return { y: y, m: m, d: Math.min(c.d, kbDaysIn(y, m)) }
        }
        const kbClamp = (c, min, max) => (kbCmp(c, min) < 0 ? min : (kbCmp(c, max) > 0 ? max : c))

        /** Popover anchored to a trigger: attached to <body> (the Settings page
         *  scrolls and would clip an absolute list), placed as fixed, flipped
         *  upward if there is no room below, repositioned on scroll. */
        const kbUsePopover = (anchorRef, popRef, open, close, dep) => {
          const posPair = React.useState(null)
          const pos = posPair[0]
          const setPos = posPair[1]
          React.useLayoutEffect(() => {
            if (open !== true) { setPos(null); return undefined }
            const place = () => {
              const a = anchorRef.current
              const p = popRef.current
              if (a === null || a === undefined || p === null || p === undefined) return
              const r = a.getBoundingClientRect()
              const ph = p.offsetHeight
              const pw = p.offsetWidth
              const below = window.innerHeight - r.bottom
              const up = below < ph + 12 && r.top > below
              setPos({
                left: Math.max(8, Math.min(r.left, window.innerWidth - pw - 8)),
                top: up ? Math.max(8, r.top - ph - 6) : r.bottom + 6,
                width: r.width,
              })
            }
            place()
            const onDown = (e) => {
              const a = anchorRef.current
              const p = popRef.current
              if ((a !== null && a !== undefined && a.contains(e.target)) || (p !== null && p !== undefined && p.contains(e.target))) return
              close()
            }
            const onScroll = (e) => {
              const p = popRef.current
              if (p !== null && p !== undefined && p.contains(e.target)) return
              place()
            }
            document.addEventListener('mousedown', onDown, true)
            window.addEventListener('resize', place)
            window.addEventListener('scroll', onScroll, true)
            return () => {
              document.removeEventListener('mousedown', onDown, true)
              window.removeEventListener('resize', place)
              window.removeEventListener('scroll', onScroll, true)
            }
          }, [open, dep])
          return pos
        }
        const kbPopStyle = (pos, extra) => Object.assign(
          pos === null ? { position: 'fixed', left: 0, top: 0, visibility: 'hidden' } : { position: 'fixed', left: pos.left + 'px', top: pos.top + 'px' },
          extra === undefined ? {} : extra)

        const CalendarIcon = (props) => svgIcon(() => [
          h('rect', { key: 'a', x: 3.5, y: 5, width: 17, height: 15, rx: 3, stroke: 'currentColor', strokeWidth: 1.7 }),
          h('path', { key: 'b', d: 'M3.5 10h17M8 3v4M16 3v4', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
        ], props)
        const ChevronIcon = (props) => svgIcon(() => [
          h('path', { key: 'a', d: props !== undefined && props.dir === 'left' ? 'M14.5 6l-6 6 6 6' : (props !== undefined && props.dir === 'down' ? 'M6 9.5l6 6 6-6' : 'M9.5 6l6 6-6 6'), stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        ], props)
        const CloseXIcon = (props) => svgIcon(() => [
          h('path', { key: 'a', d: 'M7 7l10 10M17 7L7 17', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' }),
        ], props)
        const PinIcon = (props) => svgIcon(() => [
          h('path', { key: 'a', d: 'M12 21s6.5-5.6 6.5-11a6.5 6.5 0 1 0-13 0C5.5 15.4 12 21 12 21z', stroke: 'currentColor', strokeWidth: 1.7, strokeLinejoin: 'round' }),
          h('circle', { key: 'b', cx: 12, cy: 10, r: 2.4, stroke: 'currentColor', strokeWidth: 1.7 }),
        ], props)
        const ClockIcon = (props) => svgIcon(() => [
          h('circle', { key: 'a', cx: 12, cy: 12, r: 9, stroke: 'currentColor', strokeWidth: 1.7 }),
          h('path', { key: 'b', d: 'M12 7v5l3 2', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        ], props)
        const CameraIcon = (props) => svgIcon(() => [
          h('path', { key: 'a', d: 'M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1.1-1.6A1.5 1.5 0 0 1 10 3.8h4a1.5 1.5 0 0 1 1.2.6L16.3 6h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z', stroke: 'currentColor', strokeWidth: 1.7, strokeLinejoin: 'round' }),
          h('circle', { key: 'b', cx: 12, cy: 12.5, r: 3.2, stroke: 'currentColor', strokeWidth: 1.7 }),
        ], props)

        const KbDatePicker = (props) => {
          const locale = props.locale
          const min = props.min
          const max = props.max
          const value = kbParseIso(props.value)
          const openPair = React.useState(false)
          const open = openPair[0]
          const setOpen = openPair[1]
          const cursorPair = React.useState(() => value !== null ? value : kbClamp({ y: max.y - 30, m: max.m, d: 1 }, min, max))
          const cursor = cursorPair[0]
          const setCursor = cursorPair[1]
          const focusRef = React.useRef(false)
          const anchorRef = React.useRef(null)
          const popRef = React.useRef(null)
          const triggerRef = React.useRef(null)
          const close = () => { setOpen(false); focusRef.current = false }
          const pos = kbUsePopover(anchorRef, popRef, open, close)
          const fmt = React.useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }), [locale])
          const monthNames = React.useMemo(() => {
            const f = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' })
            const out = []
            for (let i = 0; i < 12; i += 1) out.push(f.format(new Date(Date.UTC(2000, i, 1))))
            return out
          }, [locale])
          const weekdays = React.useMemo(() => {
            const f = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
            const out = []
            // 2023-01-02 is a Monday: week starting on Monday.
            for (let i = 0; i < 7; i += 1) out.push(f.format(new Date(Date.UTC(2023, 0, 2 + i))))
            return out
          }, [locale])
          const openIt = () => {
            if (value !== null) setCursor(value)
            focusRef.current = true
            setOpen(true)
          }
          const choose = (c) => {
            if (kbCmp(c, min) < 0 || kbCmp(c, max) > 0) return
            props.onChange(kbIso(c))
            close()
            try { triggerRef.current.focus() } catch (e) { /* trigger unmounted */ }
          }
          const moveTo = (c) => { focusRef.current = true; setCursor(kbClamp(c, min, max)) }
          const peek = (c) => { setCursor(kbClamp(c, min, max)) }
          const onGridKey = (e) => {
            const k = e.key
            let next = null
            if (k === 'ArrowLeft') next = kbShiftDays(cursor, -1)
            else if (k === 'ArrowRight') next = kbShiftDays(cursor, 1)
            else if (k === 'ArrowUp') next = kbShiftDays(cursor, -7)
            else if (k === 'ArrowDown') next = kbShiftDays(cursor, 7)
            else if (k === 'Home') next = kbShiftDays(cursor, -((kbDow(cursor) + 6) % 7))
            else if (k === 'End') next = kbShiftDays(cursor, 6 - ((kbDow(cursor) + 6) % 7))
            else if (k === 'PageUp') next = kbShiftMonths(cursor, e.shiftKey ? -12 : -1)
            else if (k === 'PageDown') next = kbShiftMonths(cursor, e.shiftKey ? 12 : 1)
            else if (k === 'Enter' || k === ' ') { e.preventDefault(); choose(cursor); return }
            else return
            e.preventDefault()
            moveTo(next)
          }
          React.useEffect(() => {
            if (open !== true) return undefined
            const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); try { triggerRef.current.focus() } catch (e2) { /* unmounted */ } } }
            document.addEventListener('keydown', onKey, true)
            return () => document.removeEventListener('keydown', onKey, true)
          }, [open])
          // Focus only follows the keyboard (and opening): arrow keys and the
          // header lists must not steal it from the control in use.
          // It is set AFTER the popover is placed (invisible before: an element
          // with `visibility:hidden` refuses focus).
          React.useEffect(() => {
            if (open !== true || pos === null || focusRef.current !== true || popRef.current === null) return
            const b = popRef.current.querySelector('.kbax-day[tabindex="0"]')
            if (b !== null) { focusRef.current = false; try { b.focus() } catch (e) { /* off screen */ } }
          }, [open, pos === null, cursor.y, cursor.m, cursor.d])

          const today = kbToday()
          const first = { y: cursor.y, m: cursor.m, d: 1 }
          const lead = (kbDow(first) + 6) % 7
          const cells = []
          for (let i = 0; i < 42; i += 1) cells.push(kbShiftDays(first, i - lead))
          const years = []
          for (let y = max.y; y >= min.y; y -= 1) years.push(y)
          const same = (a, b) => b !== null && kbCmp(a, b) === 0
          const label = value !== null ? fmt.format(new Date(Date.UTC(value.y, value.m - 1, value.d))) : null

          const popover = open === true ? ReactDOM.createPortal(h('div', {
            ref: popRef, className: 'kbax-pop kbax-cal', role: 'dialog', 'aria-label': props.label, style: kbPopStyle(pos),
          },
          h('div', { className: 'kbax-cal-head' },
            h('button', {
              type: 'button', className: 'kbax-iconbtn', 'aria-label': props.prevLabel,
              disabled: kbCmp(kbShiftMonths({ y: cursor.y, m: cursor.m, d: 1 }, -1), { y: min.y, m: min.m, d: 1 }) < 0,
              onClick: () => peek(kbShiftMonths(cursor, -1)),
            }, h(ChevronIcon, { size: 16, dir: 'left' })),
            h('span', { className: 'kbax-cal-sel' },
              h('select', {
                className: 'kbax-minisel', 'aria-label': props.monthLabel, value: cursor.m,
                onChange: (e) => peek({ y: cursor.y, m: Number(e.target.value), d: Math.min(cursor.d, kbDaysIn(cursor.y, Number(e.target.value))) }),
              }, monthNames.map((n, i) => h('option', { key: n, value: i + 1 }, n))),
              h('select', {
                className: 'kbax-minisel', 'aria-label': props.yearLabel, value: cursor.y,
                onChange: (e) => peek({ y: Number(e.target.value), m: cursor.m, d: Math.min(cursor.d, kbDaysIn(Number(e.target.value), cursor.m)) }),
              }, years.map((y) => h('option', { key: y, value: y }, y)))),
            h('button', {
              type: 'button', className: 'kbax-iconbtn', 'aria-label': props.nextLabel,
              disabled: kbCmp(kbShiftMonths({ y: cursor.y, m: cursor.m, d: 1 }, 1), { y: max.y, m: max.m, d: 1 }) > 0,
              onClick: () => peek(kbShiftMonths(cursor, 1)),
            }, h(ChevronIcon, { size: 16, dir: 'right' }))),
          h('div', { className: 'kbax-cal-grid', role: 'group', 'aria-label': monthNames[cursor.m - 1] + ' ' + String(cursor.y), onKeyDown: onGridKey },
            weekdays.map((w, i) => h('span', { key: 'w' + i, className: 'kbax-cal-wd', 'aria-hidden': 'true' }, w.replace('.', '').slice(0, 2))),
            cells.map((c) => {
              const out = c.m !== cursor.m
              const disabled = kbCmp(c, min) < 0 || kbCmp(c, max) > 0
              const isCursor = same(c, cursor)
              return h('button', {
                key: kbIso(c), type: 'button',
                tabIndex: isCursor ? 0 : -1, disabled: disabled,
                'aria-pressed': same(c, value) ? 'true' : 'false',
                'aria-current': same(c, today) ? 'date' : undefined,
                className: 'kbax-day' + (out ? ' out' : '') + (same(c, value) ? ' sel' : '') + (same(c, today) ? ' today' : ''),
                onClick: () => choose(c),
              }, String(c.d))
            })),
          h('div', { className: 'kbax-cal-foot' },
            h('button', { type: 'button', className: 'kbax-link', disabled: value === null, onClick: () => { props.onChange(''); close(); try { triggerRef.current.focus() } catch (e) { /* unmounted */ } } }, props.clearLabel))),
          document.body) : null

          return h('div', { className: 'kbax-anchor', ref: anchorRef },
            h('button', {
              type: 'button', ref: triggerRef, className: 'kbax-field kbax-fieldbtn' + (value === null ? ' empty' : ''),
              'aria-haspopup': 'dialog', 'aria-expanded': open === true ? 'true' : 'false',
              onClick: () => { if (open === true) close(); else openIt() },
            },
            h(CalendarIcon, { size: 16 }),
            h('span', { className: 'kbax-fieldtxt' }, label !== null ? label : props.placeholder),
            value !== null ? null : h(ChevronIcon, { size: 14, dir: 'down' })),
            value !== null
              ? h('button', { type: 'button', className: 'kbax-clearx', 'aria-label': props.clearLabel, title: props.clearLabel, onClick: () => props.onChange('') }, h(CloseXIcon, { size: 13 }))
              : null,
            popover)
        }

        // ── Time zones ───────────────────────────────────────────────────────
        // Common countries/cities → time zone: "france" must find Europe/Paris,
        // which the IANA name alone does not allow.
        const KB_TZ_ALIAS = {
          france: 'Europe/Paris', 'royaume uni': 'Europe/London', 'united kingdom': 'Europe/London', uk: 'Europe/London', angleterre: 'Europe/London', england: 'Europe/London',
          allemagne: 'Europe/Berlin', germany: 'Europe/Berlin', espagne: 'Europe/Madrid', spain: 'Europe/Madrid', italie: 'Europe/Rome', italy: 'Europe/Rome',
          portugal: 'Europe/Lisbon', belgique: 'Europe/Brussels', belgium: 'Europe/Brussels', suisse: 'Europe/Zurich', switzerland: 'Europe/Zurich',
          'pays bas': 'Europe/Amsterdam', netherlands: 'Europe/Amsterdam', irlande: 'Europe/Dublin', ireland: 'Europe/Dublin', grece: 'Europe/Athens', greece: 'Europe/Athens',
          turquie: 'Europe/Istanbul', turkey: 'Europe/Istanbul', russie: 'Europe/Moscow', russia: 'Europe/Moscow', pologne: 'Europe/Warsaw', poland: 'Europe/Warsaw',
          maroc: 'Africa/Casablanca', morocco: 'Africa/Casablanca', algerie: 'Africa/Algiers', algeria: 'Africa/Algiers', tunisie: 'Africa/Tunis', tunisia: 'Africa/Tunis',
          egypte: 'Africa/Cairo', egypt: 'Africa/Cairo', senegal: 'Africa/Dakar', 'cote d ivoire': 'Africa/Abidjan', 'ivory coast': 'Africa/Abidjan',
          'afrique du sud': 'Africa/Johannesburg', 'south africa': 'Africa/Johannesburg', nigeria: 'Africa/Lagos', kenya: 'Africa/Nairobi',
          'etats unis': 'America/New_York', usa: 'America/New_York', 'united states': 'America/New_York', canada: 'America/Toronto', bresil: 'America/Sao_Paulo', brazil: 'America/Sao_Paulo',
          mexique: 'America/Mexico_City', mexico: 'America/Mexico_City', argentine: 'America/Argentina/Buenos_Aires', argentina: 'America/Argentina/Buenos_Aires',
          inde: 'Asia/Kolkata', india: 'Asia/Kolkata', chine: 'Asia/Shanghai', china: 'Asia/Shanghai', japon: 'Asia/Tokyo', japan: 'Asia/Tokyo',
          'coree du sud': 'Asia/Seoul', 'south korea': 'Asia/Seoul', 'emirats arabes unis': 'Asia/Dubai', uae: 'Asia/Dubai', 'arabie saoudite': 'Asia/Riyadh', 'saudi arabia': 'Asia/Riyadh',
          israel: 'Asia/Jerusalem', liban: 'Asia/Beirut', lebanon: 'Asia/Beirut', singapour: 'Asia/Singapore', singapore: 'Asia/Singapore', thailande: 'Asia/Bangkok', thailand: 'Asia/Bangkok',
          australie: 'Australia/Sydney', australia: 'Australia/Sydney', 'nouvelle zelande': 'Pacific/Auckland', 'new zealand': 'Pacific/Auckland',
        }
        const kbNorm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[_/'’-]+/g, ' ').replace(/\s+/g, ' ').trim()
        const kbTzState = { list: null, abbr: {}, fmt: {} }
        const kbTzList = () => {
          if (kbTzState.list !== null) return kbTzState.list
          let zones = []
          try { zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [] } catch (e) { zones = [] }
          if (zones.indexOf('UTC') < 0) zones = zones.concat(['UTC'])
          kbTzState.list = zones.map((z) => {
            const parts = z.split('/')
            return {
              z: z,
              city: (parts.length > 1 ? parts.slice(1).join(' / ') : parts[0]).replace(/_/g, ' '),
              region: parts.length > 1 ? parts[0].replace(/_/g, ' ') : '',
              hay: kbNorm(z),
            }
          })
          return kbTzState.list
        }
        /** Offset and local time of a time zone, at instant `now`. */
        const kbTzNow = (z, now) => {
          try {
            if (kbTzState.fmt[z] === undefined) kbTzState.fmt[z] = new Intl.DateTimeFormat('en-US', { timeZone: z, timeZoneName: 'longOffset', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
            const parts = kbTzState.fmt[z].formatToParts(now)
            const get = (type) => { const p = parts.filter((x) => x.type === type)[0]; return p !== undefined ? p.value : '' }
            let off = get('timeZoneName').replace('GMT', 'UTC')
            if (off === 'UTC') off = 'UTC+00:00'
            return { off: off, time: get('hour') + ':' + get('minute') }
          } catch (e) { return { off: '', time: '' } }
        }
        const kbTzAbbr = (z) => {
          if (kbTzState.abbr[z] !== undefined) return kbTzState.abbr[z]
          let a = ''
          try {
            const p = new Intl.DateTimeFormat('en-US', { timeZone: z, timeZoneName: 'short' }).formatToParts(new Date()).filter((x) => x.type === 'timeZoneName')[0]
            a = p !== undefined ? p.value.toLowerCase() : ''
          } catch (e) { a = '' }
          kbTzState.abbr[z] = a
          return a
        }
        /** Filter + ranking: 0 city starts with · 1 word/alias/abbreviation · 2 contains · 3 offset. */
        const kbTzSearch = (query, zones, now) => {
          const q = kbNorm(query)
          if (q === '') return zones.map((e) => ({ e: e, score: 0 }))
          // "+2", "utc-5", "gmt+05:30": we search by offset, not by text.
          const off = /^(?:utc|gmt)?([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(String(query).toLowerCase().replace(/\s+/g, ''))
          if (off !== null) {
            const want = 'UTC' + off[1] + kbPad(Number(off[2])) + ':' + (off[3] !== undefined ? off[3] : '')
            return zones.filter((e) => kbTzNow(e.z, now).off.indexOf(want) === 0).map((e) => ({ e: e, score: 3 })).sort((a, b) => a.e.city.localeCompare(b.e.city))
          }
          const aliasHit = Object.keys(KB_TZ_ALIAS).filter((k) => k.indexOf(q) === 0).map((k) => KB_TZ_ALIAS[k])
          const out = []
          for (const e of zones) {
            const city = kbNorm(e.city)
            let score = -1
            if (aliasHit.indexOf(e.z) >= 0) score = 0
            else if (city.indexOf(q) === 0) score = 0
            else if (e.hay.split(' ').some((w) => w.indexOf(q) === 0)) score = 1
            else if (kbTzAbbr(e.z) === q) score = 1
            else if (e.hay.indexOf(q) >= 0) score = 2
            if (score >= 0) out.push({ e: e, score: score })
          }
          out.sort((a, b) => (a.score - b.score) || a.e.city.localeCompare(b.e.city))
          return out
        }

        const KbTzCombo = (props) => {
          const zones = kbTzList()
          const openPair = React.useState(false)
          const open = openPair[0]
          const setOpen = openPair[1]
          const queryPair = React.useState('')
          const query = queryPair[0]
          const setQuery = queryPair[1]
          const activePair = React.useState(0)
          const active = activePair[0]
          const setActive = activePair[1]
          const anchorRef = React.useRef(null)
          const popRef = React.useRef(null)
          const inputRef = React.useRef(null)
          const listRef = React.useRef(null)
          const close = () => { setOpen(false); setQuery('') }
          const now = React.useMemo(() => new Date(), [open])
          const hits = React.useMemo(() => (open === true ? kbTzSearch(query, zones, now) : []), [open, query])
          // Row 0 = "Automatic (detected)" (value ''), then the time zones.
          const showAuto = kbNorm(query) === '' || kbNorm(props.autoLabel).indexOf(kbNorm(query)) >= 0 || kbNorm(props.detected).indexOf(kbNorm(query)) >= 0
          const rows = (showAuto === true ? [{ auto: true }] : []).concat(hits.slice(0, 400).map((x) => ({ e: x.e })))
          const pos = kbUsePopover(anchorRef, popRef, open, close, rows.length)
          const current = props.value === '' ? null : zones.filter((e) => e.z === props.value)[0] || { z: props.value, city: props.value, region: '', hay: kbNorm(props.value) }
          const pick = (row) => {
            props.onChange(row.auto === true ? '' : row.e.z)
            close()
            try { inputRef.current.blur() } catch (e) { /* unmounted */ }
          }
          React.useEffect(() => { setActive(0) }, [query, open])
          React.useEffect(() => {
            if (open !== true || listRef.current === null) return
            const el = listRef.current.querySelector('[data-active="true"]')
            if (el !== null) el.scrollIntoView({ block: 'nearest' })
          }, [active, open, pos === null])
          const onKey = (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); if (open !== true) setOpen(true); else setActive(Math.min(rows.length - 1, active + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, active - 1)) }
            else if (e.key === 'Home' && open === true) { e.preventDefault(); setActive(0) }
            else if (e.key === 'End' && open === true) { e.preventDefault(); setActive(Math.max(0, rows.length - 1)) }
            else if (e.key === 'Enter') { if (open === true && rows[active] !== undefined) { e.preventDefault(); pick(rows[active]) } }
            else if (e.key === 'Escape') { if (open === true) { e.preventDefault(); e.stopPropagation(); close() } }
            else if (e.key === 'Tab') close()
          }
          const shown = open === true ? query : (current !== null ? current.z.replace(/_/g, ' ') : props.autoLabel + (props.detected !== '' ? ' · ' + props.detected.replace(/_/g, ' ') : ''))
          const cur = current !== null ? kbTzNow(current.z, now) : (props.detected !== '' ? kbTzNow(props.detected, now) : { off: '', time: '' })
          const lastRegion = { v: null }
          const listbox = open === true ? ReactDOM.createPortal(h('div', {
            ref: popRef, className: 'kbax-pop kbax-tzpop', style: kbPopStyle(pos, { width: (anchorRef.current !== null ? anchorRef.current.offsetWidth : 360) + 'px' }),
          },
          h('div', { id: 'kbax-tzlist', ref: listRef, role: 'listbox', className: 'kbax-tzlist', 'aria-label': props.label },
            rows.length === 0 ? h('div', { className: 'kbax-tzempty' }, props.noneLabel) : null,
            rows.map((row, i) => {
              if (row.auto === true) {
                return h('div', {
                  key: 'auto', id: 'kbax-tz-' + i, role: 'option', 'aria-selected': props.value === '' ? 'true' : 'false', 'data-active': i === active ? 'true' : 'false',
                  className: 'kbax-tzrow auto' + (i === active ? ' active' : '') + (props.value === '' ? ' sel' : ''),
                  onMouseEnter: () => setActive(i), onMouseDown: (e) => e.preventDefault(), onClick: () => pick(row),
                }, h('span', { className: 'kbax-tzico' }, h(ClockIcon, { size: 15 })),
                h('span', { className: 'kbax-tzmain' }, h('b', null, props.autoLabel), h('span', { className: 'kbax-tzsub' }, props.detected !== '' ? props.detected.replace(/_/g, ' ') : '')),
                props.value === '' ? h('span', { className: 'kbax-tick' }, '✓') : null)
              }
              const e = row.e
              const n = kbTzNow(e.z, now)
              const head = (kbNorm(query) === '' && e.region !== lastRegion.v) ? (lastRegion.v = e.region, h('div', { key: 'h-' + e.region, className: 'kbax-tzgroup' }, e.region || 'UTC')) : null
              return [head, h('div', {
                key: e.z, id: 'kbax-tz-' + i, role: 'option', 'aria-selected': props.value === e.z ? 'true' : 'false', 'data-active': i === active ? 'true' : 'false',
                className: 'kbax-tzrow' + (i === active ? ' active' : '') + (props.value === e.z ? ' sel' : ''),
                onMouseEnter: () => setActive(i), onMouseDown: (ev) => ev.preventDefault(), onClick: () => pick(row),
              },
              h('span', { className: 'kbax-tzmain' }, h('b', null, e.city), e.region !== '' ? h('span', { className: 'kbax-tzsub' }, e.region) : null),
              h('span', { className: 'kbax-tzoff' }, (n.off !== '' ? n.off : '') + (n.time !== '' ? ' · ' + n.time : '')))]
            }))),
          document.body) : null

          return h('div', { className: 'kbax-anchor', ref: anchorRef },
            h('div', { className: 'kbax-field kbax-combo' + (open === true ? ' open' : '') },
              h(ClockIcon, { size: 16 }),
              h('input', {
                ref: inputRef, type: 'text', className: 'kbax-comboinput', role: 'combobox', autoComplete: 'off', spellCheck: false,
                'aria-label': props.label, 'aria-expanded': open === true ? 'true' : 'false', 'aria-controls': 'kbax-tzlist', 'aria-autocomplete': 'list',
                'aria-activedescendant': open === true && rows[active] !== undefined ? 'kbax-tz-' + active : undefined,
                placeholder: open === true ? props.searchPlaceholder : undefined,
                value: shown,
                onFocus: (e) => { setOpen(true); try { e.target.select() } catch (e2) { /* selection */ } },
                onClick: () => { if (open !== true) setOpen(true) },
                onChange: (e) => { if (open !== true) setOpen(true); setQuery(e.target.value) },
                onKeyDown: onKey,
              }),
              open === true ? null : h('span', { className: 'kbax-tzbadge' }, cur.off !== '' ? cur.off : ''),
              h('span', { className: 'kbax-chev', 'aria-hidden': 'true' }, h(ChevronIcon, { size: 14, dir: 'down' }))),
            props.value !== '' && open !== true
              ? h('button', { type: 'button', className: 'kbax-link kbax-below', onClick: () => props.onChange('') }, props.useAutoLabel + (props.detected !== '' ? ' (' + props.detected.replace(/_/g, ' ') + ')' : ''))
              : null,
            listbox)
        }

        // ── Page head shared by the Account and Data & privacy pages ───────────
        // Same markup as the core plugin's KbacHead (h2.kb6-title + p.kb8-sub): the one Settings
        // head rule of the core plugin gives it the 18/600 title and the 13 sub-title, so these
        // two pages cannot drift from the others. The core plugin lives in another bundle and
        // exposes no component, hence the two class names here.
        const PageHead = (props) => h('div', { className: 'kbpg-head' },
          h('h2', { className: 'kb6-title' }, props.title),
          h('p', { className: 'kb8-sub' }, props.sub))

        // ── Account page ───────────────────────────────────────────────────────
        const AccountSection = () => {
          const vuePair = React.useState({ phase: 'loading' })
          const vue = vuePair[0]
          const setVue = vuePair[1]
          const refreshPair = React.useState(false)
          const refreshing = refreshPair[0]
          const setRefreshing = refreshPair[1]
          const liveRef = React.useRef(true)
          React.useEffect(() => () => { liveRef.current = false }, [])
          // Cache first (the page appears right away), the refresh afterwards
          // in the background: no more "Sign in" screen while the data
          // is read, no more emptied page on every click on Refresh.
          const charger = React.useCallback(async () => {
            let status = null
            try { status = await callLocal('/status', 'GET') } catch (e) { status = null }
            if (liveRef.current !== true) return
            if (status !== null && status.connected === true) {
              const cache = status.state !== undefined && status.state !== null ? status.state : {}
              setVue({ phase: 'connected', state: cache })
              setRefreshing(true)
              try {
                const fresh = await callLocal('/refresh', 'POST')
                if (liveRef.current === true && fresh !== null && fresh.connected === true && fresh.state !== undefined) setVue({ phase: 'connected', state: fresh.state })
              } catch (e) { /* on garde le cache */ }
              if (liveRef.current === true) setRefreshing(false)
              return
            }
            setVue({ phase: status !== null && status.status === 'pending' ? 'pairing' : 'disconnected' })
          }, [])
          React.useEffect(() => { void charger() }, [charger])
          const seDeconnecter = async () => {
            try { await callLocal('/disconnect', 'POST', { confirm: true }) } catch (e) { /* déjà parti */ }
            setVue({ phase: 'loading' })
            void charger()
          }

          // ── Profil éditable local (naissance, localisation, instructions…) ──
          const profilPair = React.useState(kbAccRead)
          const profil = profilPair[0]
          const setProfil = profilPair[1]
          const savedPair = React.useState(kbAccRead)
          const saved = savedPair[0]
          const setSaved = savedPair[1]
          const flashPair = React.useState(false)
          const flash = flashPair[0]
          const setFlash = flashPair[1]
          const detecPair = React.useState('')
          const detec = detecPair[0]
          const setDetec = detecPair[1]
          const fichierRef = React.useRef(null)
          const photoErrPair = React.useState(false)
          const photoErr = photoErrPair[0]
          const setPhotoErr = photoErrPair[1]
          const dirty = JSON.stringify(profil) !== JSON.stringify(saved)
          const maj = (patch) => { setProfil((p) => Object.assign({}, p, patch)); setFlash(false) }
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
                  maj({ photo: c.toDataURL('image/jpeg', 0.85) })
                } catch (e) { setPhotoErr(true) }
              }
              img.src = String(lecteur.result || '')
            }
            lecteur.readAsDataURL(fichier)
          }
          const enregistrer = () => {
            if (dirty !== true) return
            if (kbAccWrite(profil) === true) { setSaved(profil); setFlash(true) }
          }
          const annuler = () => { setProfil(saved); setFlash(false) }
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
                    if (loc !== '') maj({ location: loc })
                    setDetec('')
                  })
                  .catch(() => { setDetec('err') })
              }, () => { setDetec('err') }, { timeout: 8000 })
            } catch (e) { setDetec('err') }
          }
          React.useEffect(() => {
            if (flash !== true) return undefined
            const id = window.setTimeout(() => setFlash(false), 2600)
            return () => window.clearTimeout(id)
          }, [flash])
          let fuseau = ''
          try { fuseau = Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch (e) { fuseau = '' }
          const _l = lang()
          const locale = _l === 'en' ? 'en-GB' : _l === 'fr' ? 'fr-FR' : _l
          const aujourdhui = kbToday()

          // Not signed in: a skeleton while reading (never the "Sign in" button
          // before we know), the button only if we really are not signed in.
          if (vue.phase === 'loading') {
            return h('div', { className: 'kbax', 'data-kb': 'settings-account', 'aria-busy': 'true', 'aria-label': t('loading') },
              h(PageHead, { title: t('profCompte'), sub: t('accSub') }),
              h('div', { className: 'kbax-card' }, h('div', { className: 'kbax-skel kbax-skel-head' })),
              h('div', { className: 'kbax-card' },
                h('div', { className: 'kbax-skel kbax-skel-line short' }), h('div', { className: 'kbax-skel kbax-skel-field' }),
                h('div', { className: 'kbax-skel kbax-skel-line short' }), h('div', { className: 'kbax-skel kbax-skel-field' }),
                h('div', { className: 'kbax-skel kbax-skel-line short' }), h('div', { className: 'kbax-skel kbax-skel-field' })))
          }
          if (vue.phase !== 'connected') {
            return h('div', { className: 'kbax', 'data-kb': 'settings-account' },
              h(PageHead, { title: t('profCompte'), sub: t('accSub') }),
              h('div', { className: 'kbax-card' },
                h('p', { className: 'kbf-hint', style: { margin: 0 } }, vue.phase === 'pairing' ? t('footPairing') : t('footHint')),
                h('button', {
                  type: 'button', className: 'kbf-connect', style: { marginTop: '10px' },
                  onClick: () => { try { window.dispatchEvent(new Event('kybernos-cloud:open')) } catch (e) { /* Event missing */ } },
                }, h(EnterIcon, { size: 15 }), h('span', null, t('footConnect')))))
          }

          const st = vue.state
          const user = st.user !== undefined && st.user !== null ? st.user : {}
          const shownName = displayName(user)
          const qui = shownName.value !== '' ? shownName.value : (user.email || t('none'))
          const plan = planDeEspace(st, user).label !== null ? planDeEspace(st, user).label : t('none')
          const web = typeof st.web_url === 'string' && st.web_url !== '' ? st.web_url : ''
          const couleurAvatar = profil.color !== '' ? profil.color : '#4b4fe0'
          const glyphAvatar = initiales(profil.name !== '' ? profil.name : qui, user.email)
          const stylePhoto = profil.photo !== '' ? { backgroundImage: 'url(' + profil.photo + ')', backgroundSize: 'cover', backgroundPosition: 'center' } : {}
          const SWATCHES = ['#4b4fe0', '#2f6f5e', '#a4553a', '#7a4a86', '#8a6b2f', '#16181c', '#9a6b3f']
          const INSTR_MAX = 2000
          const champ = (label, contenu, hint) => h('div', { className: 'kbax-row' },
            h('span', { className: 'kbax-label' }, label), contenu, hint !== undefined && hint !== null ? hint : null)
          return h('div', {
            className: 'kbax', 'data-kb': 'settings-account',
            onKeyDown: (e) => { if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 's') { e.preventDefault(); enregistrer() } },
          },
          h(PageHead, { title: t('profCompte'), sub: t('accSub') }),
          // ── Identity ──
          h('div', { className: 'kbax-card kbax-hero' },
            h('div', { className: 'kbax-avwrap' },
              h('span', { className: 'kbax-avatar', 'aria-hidden': 'true', style: Object.assign({ background: couleurAvatar }, stylePhoto) }, profil.photo !== '' ? null : glyphAvatar),
              h('input', {
                ref: fichierRef, type: 'file', accept: 'image/*', style: { display: 'none' },
                onChange: (e) => { const f = e.target.files && e.target.files[0]; chargerPhoto(f); e.target.value = '' },
              }),
              h('button', { type: 'button', className: 'kbax-avcam', title: t('accPhotoUp'), 'aria-label': t('accPhotoUp'), onClick: () => { if (fichierRef.current) fichierRef.current.click() } }, h(CameraIcon, { size: 15 }))),
            h('div', { className: 'kbax-herotxt' },
              h('div', { className: 'kbax-heroname' }, h('b', null, qui), h('span', { className: 'kbf-plan', style: { maxWidth: '90px' } }, plan)),
              user.email ? h('span', { className: 'kbax-heromail' }, user.email) : null,
              h('div', { className: 'kbax-swatches', role: 'radiogroup', 'aria-label': t('accAvatar') },
                SWATCHES.map((c) => h('button', {
                  type: 'button', key: c, className: 'kbfp-sw' + (profil.color === c ? ' on' : ''),
                  role: 'radio', 'aria-checked': profil.color === c ? 'true' : 'false', 'aria-label': c, title: c, style: { background: c },
                  onClick: () => maj({ color: profil.color === c ? '' : c }),
                })),
                profil.photo !== '' ? h('button', { type: 'button', className: 'kbax-link', onClick: () => maj({ photo: '' }) }, t('accPhotoDel')) : null,
                photoErr ? h('span', { className: 'kbm-setfield-invalid' }, t('accPhotoErr')) : null))),
          // ── About you ──
          h('div', { className: 'kbax-card' },
            h('div', { className: 'kbs-sect' }, t('accAbout')),
            champ(t('name'), h('input', { type: 'text', className: 'kbax-field kbax-input', value: profil.name, placeholder: t('accNamePh'), onChange: (e) => maj({ name: e.target.value }) })),
            champ(t('accBirth'), h(KbDatePicker, {
              value: profil.birth, onChange: (v) => maj({ birth: v }), locale: locale,
              min: { y: 1900, m: 1, d: 1 }, max: aujourdhui,
              placeholder: t('accBirthPh'), label: t('accBirth'), clearLabel: t('accClear'),
              prevLabel: t('accPrevMonth'), nextLabel: t('accNextMonth'), monthLabel: t('accMonth'), yearLabel: t('accYear'),
            })),
            champ(t('accLocation'), h('div', { className: 'kbax-inline' },
              h('span', { className: 'kbax-field kbax-withicon' },
                h(PinIcon, { size: 16 }),
                h('input', { type: 'text', className: 'kbax-bare', value: profil.location, placeholder: 'Paris, France', onChange: (e) => maj({ location: e.target.value }) })),
              h('button', { type: 'button', className: 'kbax-btn', disabled: detec === 'busy', onClick: detecter }, detec === 'busy' ? t('accDetecting') : t('accDetect'))),
            detec === 'err' ? h('p', { className: 'kbm-setfield-invalid', style: { margin: '4px 0 0' } }, t('accDetectErr')) : null)),
          // ── Preferences ──
          h('div', { className: 'kbax-card' },
            h('div', { className: 'kbs-sect' }, t('accPrefs')),
            champ(t('accTimezone'), h(KbTzCombo, {
              value: profil.tz, onChange: (v) => maj({ tz: v }), detected: fuseau,
              label: t('accTimezone'), autoLabel: t('accAutoTz'), searchPlaceholder: t('accTzPh'), noneLabel: t('accTzNone'), useAutoLabel: t('accTzUseAuto'),
            }))),
          // ── Instructions ──
          h('div', { className: 'kbax-card' },
            h('div', { className: 'kbs-sect' }, t('accInstructions')),
            h('textarea', {
              className: 'kbax-field kbax-area', rows: 5, maxLength: INSTR_MAX, value: profil.instructions, placeholder: t('accInstructionsPh'),
              onChange: (e) => maj({ instructions: e.target.value }),
            }),
            h('div', { className: 'kbax-count' }, String(profil.instructions.length) + ' / ' + String(INSTR_MAX)),
            h('p', { className: 'kbm-setform-unavailable', style: { margin: '2px 0 0' } }, t('accLocalNote'))),
          // ── Account ──
          h('div', { className: 'kbs-actions', style: { marginTop: 0 } },
            h('button', { type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-outline', disabled: refreshing, onClick: () => { void charger() } }, refreshing ? t('accRefreshing') : t('refresh')),
            // The account page of the server (`<web>/account`): profile, password, second factor, sessions, export, deletion.
            web === '' ? null : h('a', {
              className: 'kbm-btn kbm-btn-md kbm-btn-outline', style: { textDecoration: 'none' },
              href: web + '/account', target: '_blank', rel: 'noreferrer',
            }, t('wsOpenHosted')),
            h('button', { type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-outline', style: { color: 'var(--dsw-alias-state-error-primary)' }, onClick: () => { void seDeconnecter() } }, t('disconnect'))),
          // ── Save bar: stuck to the bottom, visible only when there is something to keep ──
          (dirty === true || flash === true)
            ? h('div', { className: 'kbax-savebar', role: 'status' },
                h('span', { className: 'kbax-savemsg' + (dirty === true ? ' dirty' : ' ok') }, dirty === true ? t('accUnsaved') : t('accSaved')),
                dirty === true ? h('button', { type: 'button', className: 'kbax-btn', onClick: annuler }, t('accDiscard')) : null,
                dirty === true ? h('button', { type: 'button', className: 'kbax-btn kbax-primary', onClick: enregistrer }, t('accSave')) : null)
            : null)
        }
        ctx.effect(() => slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'kybernos-account', order: 11, label: t('profCompte') }, AccountSection)),
        'kybernos-cloud: onglet Account des reglages')

        // ── Onglet « Données & confidentialité » (30/09 soir) ───────────────
        // Reprend la section data de la page compte du serveur (<web>/account) :
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
              ? vue.state.web_url : ''
            if (web === '') return
            try { window.open(web + '/account', '_blank', 'noopener') } catch (e) { /* ouverture impossible */ }
          }

          const panneau = (label, ...enfants) => h('div', { className: 'kbp-card' },
            h('div', { className: 'kbs-sect' }, label), ...enfants)

          if (vue.phase !== 'connected') {
            return h('div', { 'data-kb': 'settings-data', style: { display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '720px' } },
              h(PageHead, { title: t('dataNavLabel'), sub: t('dataSub') }),
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
            h(PageHead, { title: t('dataNavLabel'), sub: t('dataSub') }),
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
                (typeof st.web_url === 'string' && st.web_url !== '')
                  ? h('a', {
                    href: st.web_url + '/account',
                    target: '_blank', rel: 'noreferrer', style: { color: 'var(--dsw-alias-link)' },
                  }, t('wsOpenHosted'))
                  : null),
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
