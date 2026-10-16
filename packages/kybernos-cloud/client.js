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
        kybers: 'Agent Teams',
        // ── l'espace : la rangée du pied devient un sélecteur, et sa page ──
        spaceTitle: 'Équipe',
        wsSwitchTitle: 'Changer d\'équipe',
        wsPageTitle: 'Équipe',
        wsPersonal: 'Personnel',
        wsNewTitle: 'Créer une équipe',
        wsNewName: 'Nom de l\'équipe',
        wsNewCreate: 'Créer',
        wsNewHosted: 'Créer dans Kybernos',
        wsNewErr: 'Le serveur a refusé de créer l\'équipe.',
        profCompte: 'Compte',
        profParrain: 'Parrainage',
        profApparence: 'Apparence',
        profLogout: 'Se déconnecter',
        mobTitle: 'Télécharger l\'app mobile',
        mobScan: 'Scannez le code pour installer Kybernos sur votre téléphone.',
        mobSoon: 'Aperçu — le vrai lien arrivera avec l\'app.',
        // Help explaining what the phone link really is (asked 13/10): a web app
        // that opens the same interface and talks to this machine through the
        // Kybernos relay, which reads nothing (end to end). Not « direct ».
        mobHelp: 'Kybernos Mobile est une web app : votre téléphone ouvre la même interface que cette application et parle à cette machine par un relais qui ne lit rien (chiffré de bout en bout). Le Mac doit être allumé et connecté à Internet.',
        spaceMark: 'actif',
        spaceUnknown: 'Équipe inconnue — rien n\'a été changé.',
        models: 'Modèles',
        // Chats DSH → webapp (annuaire de sessions, métadonnées seulement)
        // Mémoire du compte (fonctionnalité cloud n°2)
        device: 'Appareil',
        session: 'Session',
        refresh: 'Rafraîchir',
        reconnect: 'Se reconnecter',
        disconnect: 'Se déconnecter',
        revokedTitle: 'Reconnexion requise',
        revokedBody: 'Cette session a été révoquée depuis Kybernos.',
        errorTitle: 'Connexion impossible',
        errNet: 'DSH ne joint pas le serveur Kybernos. Vérifiez la connexion, puis réessayez.',
        errBusy: 'Trop de tentatives en peu de temps. Attendez une minute, puis réessayez.',
        errStart: 'Le serveur Kybernos n\'a pas accepté la demande de connexion. Réessayez dans un instant.',
        errProfile: 'Votre compte n\'a pas pu être lu à l\'instant. Réessayez dans un instant.',
        errUnreadable: 'Le serveur a répondu quelque chose que DSH ne comprend pas. Réessayez ; si cela dure, vérifiez l\'adresse du serveur.',
        pairingExpires: 'Code valable jusqu\'à',
        pairingDenied: 'La connexion a été refusée dans le navigateur. Recommencez si c\'était une erreur.',
        pairingExpired: 'Le code a expiré avant d\'être confirmé. Recommencez.',
        retry: 'Réessayer',
        close: 'Fermer',
        none: '—',
        loading: 'Chargement…',
        footHint: 'Connectez-vous pour synchroniser vos sessions et appareils.',
        footConnect: 'Se connecter',
        footPairing: 'Appairage en cours : confirmez le code dans le navigateur.',
        footPairingAction: 'Voir le code',
        // ── Refonte du pied (30/09, maquette « Menu ouvert ») ──
        notifTitle: 'Notifications',
        notifEmpty: 'Rien de neuf pour l’instant.',
        notifClear: 'Tout effacer',
        notifDismiss: 'Écarter',
        menuPlanCta: 'Mettre à niveau',
        menuWebsite: 'Site web',
        menuHelp: 'Aide',
        menuUpdate: 'Mise à jour disponible',
        menuFeedback: 'Envoyer un retour',
        menuSettingsApp: 'Paramètres',
        menuTeamsSettings: 'Réglages d\'équipe',
        menuRemote: 'Contrôle à distance',
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
        themeLight: 'Clair',
        themeDark: 'Sombre',
        // ── Pied à un seul bouton, menus, fenêtre « Mettre à niveau » ──
        footSignInUp: 'Se connecter / Créer un compte',
        footSyncSub: 'Sync de vos sessions',
        menuSignup: 'Créer un compte',
        accountOpenFail: 'La page de votre compte n\'a pas pu s\'ouvrir. Réessayez dans un instant.',
        accountNeedsVerify: 'Confirmez d\'abord votre adresse e-mail, puis réessayez.',
        upTitle: 'Mettre à niveau',
        upFor: 'Choisissez la formule de',
        upLoading: 'Chargement des formules…',
        upRetry: 'Réessayer',
        upYearly: 'Annuel',
        upMonthly: 'Mensuel',
        upCurrency: 'Devise',
        upPerMonth: '/ mois',
        upPerSeatMonth: '/ place / mois',
        upBilledYearly: 'facturé à l\'année',
        upBilledMonthly: 'facturé au mois',
        upUsage: 'Usage',
        upCredits: 'crédits par 30 jours',
        upCreditsUnit: 'crédits',
        upCurrent: 'Formule actuelle',
        upSubscribe: 'S\'abonner',
        upSeats: 'Places',
        upSeatsLess: 'Retirer une place',
        upSeatsMore: 'Ajouter une place',
        upTotal: 'Total',
        upPerYear: 'par an',
        upPerMonthTotal: 'par mois',
        upCalculating: 'Calcul du prix…',
        upQuoteFail: 'Le prix n\'a pas pu être calculé.',
        upTopup: 'Crédits supplémentaires',
        upTopupSub: 'Paiement unique, valables pendant',
        upMonths: 'mois',
        upBuyCredits: 'Acheter des crédits',
        upTaxExcl: 'Prix hors taxes.',
        upTaxIncl: 'Prix toutes taxes comprises.',
        upOpened: 'La page de paiement est ouverte dans votre navigateur. Revenez ici une fois terminé.',
        upOpenedRefresh: 'J\'ai payé : actualiser ma formule',
        upOpenFallback: 'Ouvrir la page de paiement',
        upErrLoad: 'Les formules n\'ont pas pu être chargées.',
        upErrDisabled: 'Les paiements ne sont pas disponibles sur ce serveur.',
        upErrForbidden: 'Seul un propriétaire ou un administrateur peut changer cette formule. Demandez à un propriétaire de le faire.',
        upErrConflict: 'Cette formule a déjà un abonnement, ou est payée dans une autre devise. Gérez-le depuis le portail de facturation.',
        upErrInvalid: 'Ce choix n\'est pas possible (par exemple moins de places que de membres). Modifiez-le puis réessayez.',
        upErrNotFound: 'Cette formule n\'est pas en vente pour le moment.',
        upErrRate: 'Trop de tentatives. Patientez une minute puis réessayez.',
        upErrRetry: 'Le paiement n\'a pas pu être lancé pour l\'instant. Rien n\'a été débité : réessayez.',
        upErrDown: 'Le serveur ne répond pas. Rien n\'a été débité : réessayez.',
        upPortal: 'Ouvrir le portail de facturation',
        upFeatByok: 'Vos propres clés',
        upFeatConnections: 'Connexions',
        upFeatHostedRuns: 'Exécutions hébergées',
        upFeatComputers: 'Ordinateurs cloud',
        upFeatAlwaysOn: 'Ordinateurs toujours actifs',
        upFeatTeamMembers: 'Membres de l\'équipe',
        upFeatTeamLessons: 'Leçons partagées',
        upFeatTeamSkills: 'Compétences partagées',
        kyNav: 'Kybernos',
        kyTitle: 'Kybernos',
        kySub: 'Ce que Kybernos garde sur cet ordinateur.',
        kyInstrTitle: 'Instructions personnalisées',
        kyInstrPh: 'Soyez direct. Phrases courtes…',
        kyInstrNote: 'Gardées sur cet ordinateur, dans {file} : tous les agents les lisent, dans les nouvelles conversations.',
        kyInstrNone: 'Le fichier des instructions n\'a pas pu être lu sur cet ordinateur.',
        kyInstrErr: 'Pas enregistrées : {why}.',
        kyWhyReserved: 'le texte contient un repère réservé de Kybernos',
        kyWhyDamaged: 'la section Kybernos de AGENTS.md est abîmée : corrigez-la ou supprimez-la à la main',
        kyWhyLong: 'le texte dépasse {max} caractères',
        kyWhyUnreadable: 'le fichier n\'a pas pu être lu',
        kyWhyWrite: 'le fichier n\'a pas pu être écrit',
        kySave: 'Enregistrer',
        kySaving: 'Enregistrement…',
        kySaved: 'Enregistré ✓',
        kyModelsTitle: 'Modèles',
        kyModelsCount: '{n} modèles · formule {plan}',
        kyModelsNone: 'Aucun modèle importé',
        kyLastOn: 'dernier import le {date}',
        kyModelsNote: 'Relit le catalogue de modèles du serveur actif et ajoute ceux que votre formule inclut dans Réglages › Models.',
        kyModelsWarn: 'Import partiel : la route du fournisseur n\'a pas pu être écrite dans les réglages — « Réimporter » réessaie.',
        kyModelsFail: 'Réimport impossible — réessayez.',
        kyImport: 'Importer les modèles',
        kyReimport: 'Réimporter',
        kyImporting: 'Import…',
        kyChatsTitle: 'Chats DSH',
        kyChatsNote: 'Envoie le titre et la date de vos conversations DSH (jamais leur contenu) à votre compte Kybernos, pour qu’elles apparaissent dans la liste « Conversations DSH » de l’application web. Rien n’est envoyé sans votre confirmation.',
        kyChatsSend: 'Envoyer les chats DSH',
        kyChatsAsk: 'Envoyer la liste maintenant ?',
        kyChatsYes: 'Oui, envoyer',
        kyChatsNo: 'Annuler',
        kyAdvanced: 'Avancé',
        kyModelsAuto: 'La liste se met à jour toute seule quand votre formule ou votre serveur change.',
        kyChatsSending: 'Envoi…',
        kyChatsLast: 'Dernier envoi',
        kyChatsFail: 'Envoi impossible — réessayez.',
        kyNeedServer: 'Demande un serveur Kybernos : connectez-vous d\'abord (le bouton en bas de la barre latérale).',
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
        kybers: 'agent teams',
        spaceTitle: 'Team',
        wsSwitchTitle: 'Switch team',
        wsPageTitle: 'Team',
        wsPersonal: 'Personal',
        wsNewTitle: 'Create a team',
        wsNewName: 'Team name',
        wsNewCreate: 'Create',
        wsNewHosted: 'Create in Kybernos',
        wsNewErr: 'The server refused to create the team.',
        profCompte: 'Account',
        profParrain: 'Referral',
        profApparence: 'Appearance',
        profLogout: 'Log out',
        mobTitle: 'Get the mobile app',
        mobScan: 'Scan the code to install Kybernos on your phone.',
        mobSoon: 'Preview — the real link will come with the app.',
        // Help explaining what the phone link really is (asked 13/10): a web app
        // that opens the same interface and talks to this machine through the
        // Kybernos relay, which reads nothing (end to end). Not « direct ».
        mobHelp: 'Kybernos Mobile is a web app: your phone opens the same interface as this application and talks to this machine through a relay that reads nothing (end-to-end encrypted). The Mac must be on and connected to the Internet.',
        spaceMark: 'active',
        spaceUnknown: 'Unknown team — nothing was changed.',
        models: 'Models',
        // DSH chats → webapp (session directory, metadata only)
        // Account memory (cloud feature #2)
        device: 'Device',
        session: 'Session',
        refresh: 'Refresh',
        reconnect: 'Reconnect',
        disconnect: 'Disconnect',
        revokedTitle: 'Reconnection required',
        revokedBody: 'This session was revoked from Kybernos.',
        errorTitle: 'Could not connect',
        errNet: 'DSH cannot reach the Kybernos server. Check the connection, then try again.',
        errBusy: 'Too many attempts in a short time. Wait a minute, then try again.',
        errStart: 'The Kybernos server did not accept the connection request. Try again in a moment.',
        errProfile: 'Your account could not be read just now. Try again in a moment.',
        errUnreadable: 'The server answered something DSH cannot read. Try again; if it keeps happening, check the address of the server.',
        pairingExpires: 'Code valid until',
        pairingDenied: 'The connection was refused in the browser. Start again if it was a mistake.',
        pairingExpired: 'The code expired before it was confirmed. Start again.',
        retry: 'Retry',
        close: 'Close',
        none: '—',
        loading: 'Loading…',
        footHint: 'Sign in to sync your sessions and devices.',
        footConnect: 'Sign in',
        footPairing: 'Pairing in progress: confirm the code in your browser.',
        footPairingAction: 'Show code',
        notifTitle: 'Notifications',
        notifEmpty: 'Nothing new so far.',
        notifClear: 'Clear all',
        notifDismiss: 'Dismiss',
        menuPlanCta: 'Upgrade',
        menuWebsite: 'Website',
        menuHelp: 'Help',
        menuUpdate: 'Update available',
        menuFeedback: 'Send feedback',
        menuSettingsApp: 'Settings',
        menuTeamsSettings: 'Team settings',
        menuRemote: 'Remote control',
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
        themeLight: 'Light',
        themeDark: 'Dark',
        // ── One-button footer, menus, « Upgrade » dialog ──
        footSignInUp: 'Sign in / Sign up',
        footSyncSub: 'Sync your sessions',
        menuSignup: 'Create an account',
        accountOpenFail: 'Your account page could not be opened. Try again in a moment.',
        accountNeedsVerify: 'Confirm your e-mail address first, then try again.',
        upTitle: 'Upgrade',
        upFor: 'Choose the plan for',
        upLoading: 'Loading plans…',
        upRetry: 'Try again',
        upYearly: 'Yearly',
        upMonthly: 'Monthly',
        upCurrency: 'Currency',
        upPerMonth: '/ month',
        upPerSeatMonth: '/ seat / month',
        upBilledYearly: 'billed yearly',
        upBilledMonthly: 'billed monthly',
        upUsage: 'Usage',
        upCredits: 'credits per 30 days',
        upCreditsUnit: 'credits',
        upCurrent: 'Current plan',
        upSubscribe: 'Subscribe',
        upSeats: 'Seats',
        upSeatsLess: 'Remove a seat',
        upSeatsMore: 'Add a seat',
        upTotal: 'Total',
        upPerYear: 'per year',
        upPerMonthTotal: 'per month',
        upCalculating: 'Calculating the price…',
        upQuoteFail: 'The price could not be calculated.',
        upTopup: 'Extra credits',
        upTopupSub: 'Paid once, valid for',
        upMonths: 'months',
        upBuyCredits: 'Buy credits',
        upTaxExcl: 'Prices exclude tax.',
        upTaxIncl: 'Prices include tax.',
        upOpened: 'The payment page is open in your browser. Come back here when you are done.',
        upOpenedRefresh: 'I have paid: refresh my plan',
        upOpenFallback: 'Open the payment page',
        upErrLoad: 'The plans could not be loaded.',
        upErrDisabled: 'Payments are not available on this server.',
        upErrForbidden: 'Only an owner or admin can change this plan. Ask an owner to do it.',
        upErrConflict: 'This plan already has a subscription, or is paid in another currency. Manage it in the billing portal.',
        upErrInvalid: 'That choice is not possible (for example fewer seats than members). Change it and try again.',
        upErrNotFound: 'This plan is not on sale right now.',
        upErrRate: 'Too many attempts. Wait a minute, then try again.',
        upErrRetry: 'The payment could not be started right now. Nothing was charged: try again.',
        upErrDown: 'The server did not answer. Nothing was charged: try again.',
        upPortal: 'Open the billing portal',
        upFeatByok: 'Your own keys',
        upFeatConnections: 'Connections',
        upFeatHostedRuns: 'Hosted runs',
        upFeatComputers: 'Cloud computers',
        upFeatAlwaysOn: 'Always-on computers',
        upFeatTeamMembers: 'Team members',
        upFeatTeamLessons: 'Shared lessons',
        upFeatTeamSkills: 'Shared skills',
        kyNav: 'Kybernos',
        kyTitle: 'Kybernos',
        kySub: 'What Kybernos keeps on this computer.',
        kyInstrTitle: 'Custom instructions',
        kyInstrPh: 'Be direct. Short sentences…',
        kyInstrNote: 'Kept on this computer, in {file}: every agent reads them, in new chats.',
        kyInstrNone: 'The instructions file could not be read on this computer.',
        kyInstrErr: 'Not saved: {why}.',
        kyWhyReserved: 'the text contains a reserved Kybernos marker',
        kyWhyDamaged: 'the Kybernos section of AGENTS.md is damaged: fix or delete it by hand',
        kyWhyLong: 'the text is longer than {max} characters',
        kyWhyUnreadable: 'the file could not be read',
        kyWhyWrite: 'the file could not be written',
        kySave: 'Save',
        kySaving: 'Saving…',
        kySaved: 'Saved ✓',
        kyModelsTitle: 'Models',
        kyModelsCount: '{n} models · plan {plan}',
        kyModelsNone: 'No models imported',
        kyLastOn: 'last import on {date}',
        kyModelsNote: 'Re-reads the active server\'s model catalogue and adds the ones your plan includes to Settings › Models.',
        kyModelsWarn: 'Partial import: the provider route could not be written to settings — "Re-import" tries again.',
        kyModelsFail: 'Re-import failed — try again.',
        kyImport: 'Import models',
        kyReimport: 'Re-import',
        kyImporting: 'Importing…',
        kyChatsTitle: 'DSH chats',
        kyChatsNote: 'Sends the title and date of your DSH chats (never what is said in them) to your Kybernos account, so they appear in the “DSH conversations” list of the web app. Nothing is sent until you confirm.',
        kyChatsSend: 'Send DSH chats',
        kyChatsAsk: 'Send the list now?',
        kyChatsYes: 'Yes, send',
        kyChatsNo: 'Cancel',
        kyAdvanced: 'Advanced',
        kyModelsAuto: 'The list updates by itself when your plan or your server changes.',
        kyChatsSending: 'Sending…',
        kyChatsLast: 'Last send',
        kyChatsFail: 'Send failed — try again.',
        kyNeedServer: 'Needs a Kybernos server: sign in first (the button at the bottom of the sidebar).',
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
/* Light schemes: label-tertiary is 3.7:1 on white. Inside this page it reads as label-secondary, 5.8:1 (audit A1-05); the dark scheme keeps its hierarchy. */
body:not([data-ds-dark-theme]) :is(.kbf-root,.kbfp-menu,.kbfp-sub,.kbf-pop,.kbf-poptitle,.kbl-page){--dsw-alias-label-tertiary:var(--dsw-alias-label-secondary)}
.kbf-avatar{flex:none;width:23px;height:23px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-family:ui-monospace,monospace;font-size:9.5px;font-weight:600;letter-spacing:.02em;background:var(--dsw-alias-brand-primary,#6a4fd8);color:var(--dsw-alias-label-primary-foreground,#fff)}
/* Le sélecteur d'espace : la rangée du pied montre l'espace ACTIF ; sa page
   (classes kbs-*) porte la liste des espaces puis le réglage de synchronisation.
   ATTENTION : ce bloc vit DANS un template literal — jamais de backtick ici, il
   fermerait la chaîne et la révision ne parserait plus (incident du 24/09). */
/* La rangée workspace (carte + engrenage), au-dessus du menu user conservé. */
.kbf-wsrow{display:flex;align-items:center;gap:4px;width:100%;min-width:0}
.kbf-wsgear{display:inline-flex;align-items:center;justify-content:center;width:23px;height:23px;flex:none;border:1px solid transparent;border-radius:8px;color:var(--dsw-alias-label-tertiary,#8a8a93);background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a93);cursor:pointer}
/* Les popovers du pied de sidebar (changement d'espace, app mobile) : ancrés
   AU-DESSUS de leur rangée — .kbf-wsrow et .kbf-idrow portent le
   position:relative, parce que .kbf-root est en display:contents dans la
   grille du pied (plugin Kybernos). Le rideau transparent ferme au clic dehors. */
.kbf-wsrow,.kbf-idrow{position:relative}
.kbf-idrow{display:flex;align-items:center;gap:2px;width:100%;min-width:0}
.kbf-pop{position:absolute;left:0;bottom:calc(100% + 8px);z-index:61;box-sizing:border-box;width:min(252px,100%);padding:8px;border-radius:13px;background:var(--dsw-alias-bg-layer-2,#191920);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));box-shadow:0 12px 32px rgba(0,0,0,.4);color:var(--dsw-alias-label-primary,#e9e9ee);font-size:13px}
.kbf-poptitle{padding:6px 10px 8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary,#8a8a93)}
/* Le QR factice : dessine une grille deterministe (faux modules + 3 carrés de
   repere) — assez pour une maquette, jamais assez pour tromper un scanner. */
.kbf-qr{display:block;width:150px;height:150px;margin:2px auto 0;background:#fff;border-radius:10px;padding:10px}
.kbf-qrnote{margin:8px 2px 2px;font-size:11.5px;line-height:1.45;color:var(--dsw-alias-label-tertiary,#8a8a93)}
.kbf-popcenter{padding:10px 10px 12px}
.kbf-wsgear:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#e9e9ee)}
.kbs-head{display:flex;align-items:flex-start;gap:10px;justify-content:space-between}
.kbs-who{display:flex;align-items:center;gap:9px;min-width:0}
.kbs-who b{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbs-list{display:flex;flex-direction:column;gap:2px;margin:10px 0 0}
.kbs-item{display:flex;align-items:center;gap:9px;width:100%;padding:8px 9px;border:1px solid transparent;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12.5px;text-align:left;cursor:pointer}
.kbs-item:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14))}
.kbs-item[aria-current="true"]{border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.35));background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14))}
.kbs-item .kbs-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbs-mark{flex:none;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8a8a93)}
.kbs-sep{height:1px;margin:12px 0;background:var(--dsw-alias-border-l2,rgba(127,127,127,.22))}
.kbs-link{display:inline-flex;align-items:center;gap:6px;padding:7px 11px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;text-decoration:none}
.kbs-link:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14))}
.kbf-off{display:flex;flex-direction:column;gap:8px;width:100%;min-width:0}
.kbf-maj{display:flex;align-items:center;gap:8px;width:100%;min-width:0;height:34px;padding:0 10px;border:1px solid color-mix(in srgb,#f5a524 40%,var(--dsw-alias-border-l2));border-radius:10px;background:color-mix(in srgb,#f5a524 9%,transparent);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;cursor:pointer;text-align:start}
.kbf-maj:hover{background:color-mix(in srgb,#f5a524 16%,transparent)}
.kbf-maj-dot{flex:none;width:8px;height:8px;border-radius:50%;background:#f5a524}
.kbf-maj-t{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:550}
.kbf-maj-v{flex:none;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-size:11.5px}
[class*="collapsed"] .kbf-maj{justify-content:center;width:32px;height:32px;padding:0}
[class*="collapsed"] .kbf-maj-t,[class*="collapsed"] .kbf-maj-v{display:none}
/* Rail replié : l'identité se réduit à l'avatar, l'encart à une pastille. */
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
.kbfp-ico{position:relative}
.kbfp-belldot{position:absolute;top:7px;inset-inline-end:8px;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-brand-primary)}
.kbfp-belltitle{display:flex;align-items:center;justify-content:space-between;gap:8px}
.kbfp-noteclear{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;font-weight:400;cursor:pointer;padding:0}
.kbfp-noteclear:hover{color:var(--dsw-alias-label-primary)}
.kbfp-notes{list-style:none;margin:0;padding:0 10px 8px;display:flex;flex-direction:column;gap:10px;max-height:min(50vh,320px);overflow:auto}
.kbfp-note{display:flex;flex-direction:column;gap:4px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}
.kbfp-note:first-child{border-top:0;padding-top:0}
.kbfp-note-t{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.kbfp-note[data-kind="error"] .kbfp-note-t{color:var(--dsw-alias-state-error-primary)}
.kbfp-note-b{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.kbfp-note-r{display:flex;align-items:center;gap:8px;margin-top:2px}
.kbfp-note-act{appearance:none;font:inherit;font-size:12px;padding:3px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer}
.kbfp-note-act:hover{border-color:var(--dsw-alias-border-l4)}
.kbfp-note-x{appearance:none;margin-inline-start:auto;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:16px;line-height:1;cursor:pointer;padding:0 2px}
.kbfp-note-x:hover{color:var(--dsw-alias-label-primary)}
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
.kbfp-menu-off{position:fixed;right:auto;bottom:auto;z-index:70}
/* The row's chevron (the profile row and the signed-out button share it): it goes with the text in the collapsed rail. */
.kbfp-chev{flex:none;display:flex;align-items:center;margin-inline-start:6px;color:var(--dsw-alias-label-tertiary)}
.kbfp-cardmain:hover .kbfp-chev{color:var(--dsw-alias-label-secondary)}
.kbfp-tight2 .kbfp-chev,[class*="collapsed"] .kbfp-chev{display:none}
/* A line above the footer for what could not be done (a page that did not open): it goes by itself. */
.kbfp-flash{box-sizing:border-box;width:100%;margin:0 0 6px;padding:8px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.4}
[class*="collapsed"] .kbfp-flash{display:none}
/* The Upgrade dialog: DSH's tokens only, the same surfaces as the menus. */
.kbup-scrim{position:fixed;inset:0;z-index:9998;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.45));backdrop-filter:var(--dsw-mask-blur,none);display:flex;align-items:center;justify-content:center;padding:24px}
.kbup{position:relative;box-sizing:border-box;width:100%;max-width:780px;max-height:min(88vh,760px);overflow:auto;padding:22px 24px 20px;border-radius:18px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-prominent,0 18px 48px rgba(0,0,0,.35));font-size:13px;line-height:1.45;outline:none}
.kbup-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px}
.kbup-title{margin:0;font-size:18px;font-weight:650;letter-spacing:-.01em}
.kbup-sub{margin:2px 0 0;color:var(--dsw-alias-label-secondary)}
.kbup-bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:14px}
.kbup-seg{display:inline-flex;gap:2px;padding:2px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2)}
.kbup-seg button{height:28px;padding:0 12px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}
.kbup-seg button.on{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}
.kbup-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.kbup-plan{display:flex;flex-direction:column;gap:6px;padding:16px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.kbup-plan.cur{border-color:var(--dsw-alias-label-primary)}
.kbup-name{font-size:15px;font-weight:650}
.kbup-price{font-size:24px;font-weight:650;letter-spacing:-.02em}
.kbup-price small{font-size:12px;font-weight:400;letter-spacing:0;color:var(--dsw-alias-label-secondary)}
.kbup-use{font-weight:600}
.kbup-muted{color:var(--dsw-alias-label-secondary);font-size:12px}
.kbup-feats{margin:6px 0 10px;padding:0;list-style:none;display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.kbup-go{margin-top:auto;min-height:36px;padding:0 14px;border:none;border-radius:10px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font:inherit;font-weight:600;cursor:pointer}
.kbup-go:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.kbup-go:disabled{opacity:.55;cursor:default}
.kbup-go-ghost{margin-top:0;background:transparent;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2)}
.kbup-go-ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.kbup-seats{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px}
.kbup-stepper{display:inline-flex;align-items:center;gap:8px}
.kbup-stepper button{width:28px;height:28px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
.kbup-stepper button:disabled{opacity:.4;cursor:default}
.kbup-total{min-height:20px;margin:4px 0 8px}
.kbup-topup{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:14px;padding:12px 14px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2)}
.kbup-topup-txt{display:flex;flex-direction:column;flex:1 1 220px;min-width:0}
.kbup-tax{margin:12px 0 0}
.kbup-banner{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin:0 0 14px;padding:10px 12px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.kbup-banner.err{border-color:var(--dsw-alias-state-error-primary)}
.kbup-banner.ok{border-color:var(--dsw-alias-state-success-primary)}
.kbup-actions{display:inline-flex;flex-wrap:wrap;align-items:center;gap:8px}
.kbup-banner .kbup-go,.kbup-state .kbup-go{margin-top:0}
.kbup-link{color:var(--dsw-alias-label-primary);text-decoration:underline}
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
/* the amber token is a fill: 2.2:1 on white as the gift icon of the menu */
body:not([data-ds-dark-theme]) .kbfp-mamber > svg{color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 50%,var(--dsw-alias-label-primary))}
/* the plain error token is 4.2:1 on the dark menu; mixed 20% toward the text colour it is 5.5:1 there and 6.3:1 on white */
.kbfp-mout{color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 80%,var(--dsw-alias-label-primary))}
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
.kbl-page{display:flex;flex-direction:column;gap:14px;max-width:640px}
.kbl-head{margin:0 0 6px}
.kbl-card{display:flex;flex-direction:column;gap:10px;padding:18px;border-radius:16px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.kbl-sect{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#8a8a93)}
.kbl-area{box-sizing:border-box;width:100%;min-height:120px;padding:10px 12px;border-radius:11px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:1.45;resize:vertical}
.kbl-area:hover{border-color:var(--dsw-alias-border-l3)}
.kbl-area:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4f7cff);outline-offset:1px}
.kbl-area:disabled{opacity:.6}
.kbl-area::placeholder{color:var(--dsw-alias-label-tertiary)}
.kbl-count{align-self:flex-end;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.kbl-line{margin:0;font-size:14px;color:var(--dsw-alias-label-primary)}
.kbl-note{margin:0}
.kbl-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.kbl-advb{display:inline-flex;align-items:center;gap:6px;align-self:flex-start;padding:6px 4px;border:0;background:none;font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.kbl-advb:hover{color:var(--dsw-alias-label-primary)}
.kbl-advb:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4f7cff);outline-offset:2px;border-radius:6px}
.kbl-advc{display:inline-flex;transform:rotate(-90deg);transition:transform .15s}.kbl-advc.open{transform:rotate(0)}
.kbl-adv{display:flex;flex-direction:column;gap:10px}
.kbl-advbody{display:flex;flex-direction:column;gap:14px}
@media (prefers-reduced-motion: reduce){.kbl-advc{transition:none}}
.kbl-ok{font-size:13px;color:var(--dsw-alias-label-secondary)}
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

    const ChevronIcon = (props) => svgIcon(() => [
      h('path', { key: 'a', d: 'M6 9l6 6 6-6', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' }),
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
    // The server's clock minus this page's, taken when the facts arrive (`server_time` is the server's own stamp on them): a window's `resets_at` is the SERVER's
    // time, and a person's clock can be hours off (measured: three hours ahead turned « about 24 h » into « about 21 h »). Zero when unknown.
    const quotaStamp = (facts) => {
      if (facts === null || facts === undefined || typeof facts !== 'object' || typeof facts.server_time !== 'string') return facts
      const at = Date.parse(facts.server_time)
      return Number.isFinite(at) ? Object.assign({}, facts, { skew_ms: at - Date.now() }) : facts
    }
    const quotaSkew = (info) => (info !== null && info !== undefined && typeof info === 'object' && Number.isFinite(info.skew_ms) ? Math.max(-2592000000, Math.min(2592000000, info.skew_ms)) : 0)
    const quotaNoticeText = (info, t, now = Date.now() + quotaSkew(info)) => {
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
    const quotaMeterOf = (info, t, now = Date.now() + quotaSkew(info)) => {
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
        if (slots === undefined || slots === null) {
          console.error('[kybernos-cloud] service slots indisponible: pas d interface')
          return
        }
        const localeSvc = ctx.get('locale')

        // The active language as DSH names it (« en », « zh-CN », « ar »…), or null: the raw value `lang()` reduces to a base.
        const langRaw = () => {
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
          return act
        }
        const lang = () => {
          const act = langRaw()
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
        const fmtDate = (iso) => {
          if (typeof iso !== 'string' || iso === '') return null
          const d = new Date(iso)
          if (Number.isNaN(d.getTime())) return null
          const l = lang()
          return d.toLocaleDateString(l === 'en' ? 'en-GB' : l === 'fr' ? 'fr-FR' : l, { day: '2-digit', month: 'short', year: 'numeric' })
        }
        // The hour a pairing code stops working (a date alone said « Session 10 Oct 2026 », as if the connection lasted until then).
        const fmtTime = (iso) => {
          if (typeof iso !== 'string' || iso === '') return null
          const d = new Date(iso)
          if (Number.isNaN(d.getTime())) return null
          const l = lang()
          return d.toLocaleTimeString(l === 'en' ? 'en-GB' : l === 'fr' ? 'fr-FR' : l, { hour: '2-digit', minute: '2-digit' })
        }
        // What the card says for a failure the host reports with one of its internal codes (French words, kept for the tests and the logs):
        // a sentence the person can act on. A code nobody mapped is shown as it is, after the title, so nothing is hidden from a bug report.
        const errorWords = (code) => {
          const c = String(code === undefined || code === null ? '' : code)
          if (c === 'reseau' || c === 'injoignable' || c === 'reseau_indisponible') return t('errNet')
          if (c === 'trop_de_demandes') return t('errBusy')
          if (c === 'demarrage_impossible') return t('errStart')
          if (c === 'profil_indisponible') return t('errProfile')
          if (c === 'reponse_illisible' || c === 'reponse illisible') return t('errUnreadable')
          return c
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
          const liveRef = React.useRef(true)
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

          const copy = async () => {
            const code = view.pairing !== undefined && view.pairing !== null ? view.pairing.user_code : null
            if (typeof code !== 'string' || code === '') return
            try { await navigator.clipboard.writeText(code); setCopied(true) } catch (e) { /* presse-papier refuse */ }
          }

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
              body.push(h('div', { className: 'kbc-note kbc-warn', key: 'n' }, view.note === 'denied' ? t('pairingDenied') : t('pairingExpired')))
            }
            body.push(h('div', { className: 'kbc-actions', key: 'a' },
              h('button', { type: 'button', className: 'kbc-btn-primary', onClick: connect }, t('connect'))))
          } else if (view.phase === 'pairing') {
            const pairing = view.pairing !== undefined && view.pairing !== null ? view.pairing : {}
            body.push(h('div', { className: 'kbc-body', key: 'b' }, t('pairingBody')))
            body.push(h('div', { className: 'kbc-code', key: 'c' }, pairing.user_code || t('none')))
            if (pairing.expires_at !== undefined && pairing.expires_at !== null) {
              body.push(h(Row, { key: 'e', label: t('pairingExpires'), value: fmtTime(pairing.expires_at) || t('none') }))
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
            // The card is the short answer to « who am I connected as »: the e-mail, the plan, the teams, and the way out. The name, the device, the session and the
            // account's other tools (models, DSH chats, memory) are on the full page (a click on the name in the sidebar footer), not here.
            body.push(h('div', { className: 'kbc-rows', key: 'r' },
              h(Row, { label: t('email'), value: user.email || t('none') }),
              // The plan of the ACTIVE team, as the footer chip says it (the profile's `plan` is the account's word and reads « team » as soon as the person is in
              // any team, next to a chip that says « Solo Studio »): the card said « Plan team » for a personal Solo Studio space right after the pairing.
              h(Row, { label: t('plan'), value: (st.space_plan !== undefined && st.space_plan !== null && typeof st.space_plan.label === 'string' && st.space_plan.label !== '' ? st.space_plan.label : null) || user.plan || t('none') })))
            body.push(h('div', { key: 'wl' },
              h('div', { className: 'kbc-note', style: { marginTop: '12px' } }, t('workspaces')),
              h('div', { className: 'kbc-ws' }, workspaces.length === 0
                ? h('div', { className: 'kbc-note' }, t('none'))
                : workspaces.map((ws, i) => h('div', { className: 'kbc-ws-item', key: String(ws.id || i) },
                  h('span', null, ws.name || t('none')),
                  h('span', { className: 'kbc-badge' }, String(ws.kyber_count === undefined ? 0 : ws.kyber_count) + ' ' + t('kybers')))))))
            if (view.stale === true) body.push(h('div', { className: 'kbc-note kbc-warn', key: 's' }, t('errorTitle')))
            body.push(h('div', { className: 'kbc-actions', key: 'a' },
              h('button', { type: 'button', className: 'kbc-btn-ghost', onClick: disconnect }, t('disconnect'))))
          } else if (view.phase === 'revoked') {
            body.push(h('div', { className: 'kbc-body kbc-warn', key: 'b' }, t('revokedTitle')))
            body.push(h('div', { className: 'kbc-note', key: 'n' }, t('revokedBody')))
            body.push(h('div', { className: 'kbc-actions', key: 'a' },
              h('button', { type: 'button', className: 'kbc-btn-primary', onClick: connect }, t('reconnect'))))
          } else {
            body.push(h('div', { className: 'kbc-body kbc-err', key: 'b' }, t('errorTitle')))
            body.push(h('div', { className: 'kbc-note', key: 'n' }, errorWords(view.error)))
            body.push(h('div', { className: 'kbc-actions', key: 'a' },
              h('button', { type: 'button', className: 'kbc-btn-primary', onClick: load }, t('retry'))))
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
                    // The name is cut with an ellipsis in a narrow list: the title is the only way to read a long one in full.
                    title: (w && nomAffiche(w, t)) || undefined,
                    onClick: () => { void choisir(w && w.id) },
                  },
                  h('span', { className: 'kbfp-wstile', 'aria-hidden': 'true' }, initiales(w && w.name, '')),
                  h('span', { className: 'kbfp-wstxt' },
                    h('span', { className: 'kbfp-wsname' }, (w && nomAffiche(w, t)) || t('none')),
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
                    // The name is cut with an ellipsis in a narrow list: the title is the only way to read a long one in full.
                    title: (w && nomAffiche(w, t)) || undefined,
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
        // Popover ancré au-dessus du pied. Quand le bundle kybernos-mobile est là il publie
        // `window.__KB_MOBILE__.Panel` : le vrai QR d'appairage (ou « inclus dans les offres
        // payantes »), et ce panneau n'est plus qu'un cadre. Sans lui, l'aperçu d'avant : un QR
        // FICTIF, grille déterministe (stable d'un rendu à l'autre) et trois carrés de repère.
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
          // The phone link's own panel, when the bundle that owns it is there. Anything it throws falls back to the preview.
          let Remote = null
          try {
            const seam = window.__KB_MOBILE__
            if (seam !== undefined && seam !== null && typeof seam.Panel === 'function') Remote = seam.Panel
          } catch (e) { Remote = null }
          if (Remote !== null) {
            return h('div', { className: 'kbf-pop kbf-popcenter kbf-popremote', ref: popRef, role: 'dialog', 'aria-label': t('mobTitle'), 'data-kb': 'mobile-panel' },
              h(Remote, { onClose: props.onClose, web: props.web, onManage: props.onManage }))
          }
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
              h('div', { className: 'kbf-qrnote' }, t('mobScan') + ' ' + t('mobSoon')),
              h('div', { className: 'kbf-qrnote', 'data-kb': 'mobile-help' }, t('mobHelp')))
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
        // The product's public pages, from the menus (a tab of the system browser). The help is localised: its folder is the language DSH
        // shows, among those the help is written in, else English.
        const WEBSITE_URL = 'https://kybernos.app'
        // The notification bell of the footer. With nothing to show (its popover would only say « nothing new ») it is hidden, not deleted:
        // set this to true and it is always there; whatever a plugin publishes (window.__KB_NOTIFY__, kybernos-plugin: a translation that
        // finished, say) brings it back by itself while there is something to read.
        const SHOW_BELL = false
        /** The phone link's status (GET kybernos-mobile/remote/status) as the menu needs it: `{ devices }` when the entry is offered, else null. A server that does not offer
         *  the feature (`configured: false`), a plan that does not include it (`entitled: false`), a DSH that cannot (`available: false`) or no account: no entry. */
        const remoteOffer = (j) => {
          if (j === null || j === undefined || typeof j !== 'object' || j.ok !== true) return null
          if (j.available === false || j.configured === false || j.entitled === false || j.connected === false) return null
          return { devices: Array.isArray(j.devices) ? j.devices.length : 0 }
        }
        const HELP_LANGUAGES = ['en', 'fr', 'zh-cn', 'ar']
        const helpUrl = () => {
          let l = ''
          try { l = String(langRaw() || '').toLowerCase().replace(/_/g, '-') } catch (e) { l = '' }
          if (l === '' || l === 'kybernos') l = 'fr' // the product's source language
          if (l === 'zh' || l === 'zh-hans' || l.indexOf('zh-hans-') === 0) l = 'zh-cn'
          if (HELP_LANGUAGES.indexOf(l) < 0) {
            const base = l.split('-')[0]
            l = base !== 'zh' && HELP_LANGUAGES.indexOf(base) >= 0 ? base : 'en'
          }
          return 'https://help.kybernos.app/' + l + '/'
        }
        const openTab = (url) => { try { window.open(url, '_blank', 'noopener,noreferrer') } catch (e) { /* popup refused */ } }
        // DSH's own Settings dialog, opened from our menus. The seam is the core plugin's (`window.__kbOpenDshSettings`: the
        // launcher's own `openSettings`, read from React, with fallbacks). Clicking the sidebar's trigger is not enough any
        // more: the first button of that area is DSH's ACCOUNT launcher, whose click opens its account popover (Settings /
        // Feedback / Sign in), not the dialog. `false` when nothing could be opened.
        const ouvrirReglagesDsh = () => {
          try {
            const seam = window.__kbOpenDshSettings
            if (typeof seam === 'function' && seam() === true) return true
          } catch (e) { /* the seam threw: the plain trigger is next */ }
          try {
            // The fallback trigger of DSH's shell (rendered when no account launcher is registered) opens a dialog, never a menu.
            const b = document.querySelector('[data-slot="sidebar.settings"] button[aria-haspopup="dialog"]') || document.querySelector('[class*="settingsArea"] button[class*="trigger"]')
            if (b !== null && b.getAttribute('aria-haspopup') !== 'menu') { b.click(); return true }
          } catch (e) { /* trigger not found: nothing breaks */ }
          return false
        }
        const envoyer = (nom) => { try { window.dispatchEvent(new Event('kybernos:menu:' + nom)) } catch (e) { /* Event absent */ } }
        // One entry of a menu: the menu is closed FIRST (the action may unmount it: navigation, Settings, sign-out).
        // The Appearance row is not an entry (it leaves the menu open, to show the effect at once).
        const entreeMenu = (fermer) => (cle, icone, label, action, opts) => h('button', {
          type: 'button', role: 'menuitem', 'data-kb': 'menu-' + cle,
          className: 'kbfp-mitem' + (opts !== undefined && opts.danger === true ? ' kbfp-mout' : '') + (opts !== undefined && opts.amber === true ? ' kbfp-mamber' : ''),
          onClick: (ev) => {
            if (typeof action !== 'function') return
            try { fermer() } catch (e) { /* menu déjà fermé */ }
            action(ev)
          },
        }, icone, h('span', { className: 'kbfp-mlab' }, label),
          opts !== undefined && typeof opts.tail === 'string' ? h('span', { className: 'kbfp-mtail' }, opts.tail) : null,
          opts !== undefined && opts.ext === true ? h('span', { className: 'kbfp-mext', 'aria-hidden': 'true' }, h(ExtIcon, { size: 16 })) : null)
        // The light/dark segment of the menus. It follows the scheme the core plugin publishes (attribute + window event) and a
        // choice applies at once, the menu staying open.
        const AppearanceRow = () => {
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
          return h('div', { className: 'kbfp-mitem', role: 'group', 'aria-label': t('profApparence'), 'data-kb': 'menu-appearance' },
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
              }, h(MoonMenuIcon, { size: 15 }))))
        }

        // <menu-keys:begin> the keyboard contract of the two footer menus (test-cloud-client.mjs plays this block on its own)
        /** Where a key moves the focus in a menu of `count` buttons, from button `from` (-1: the focus is not on one): the new index, or -1 when the key moves nothing. */
        const menuTarget = (key, count, from) => {
          if (count < 1) return -1
          if (key === 'ArrowDown') return from < 0 || from >= count - 1 ? 0 : from + 1
          if (key === 'ArrowUp') return from <= 0 ? count - 1 : from - 1
          if (key === 'Home') return 0
          if (key === 'End') return count - 1
          return -1
        }
        // <menu-keys:end>
        const menuButtons = (menu) => Array.from(menu.querySelectorAll('button:not(:disabled)')).filter((b) => b.getClientRects().length > 0)
        /** The focus enters the menu that has just opened, on its first button. */
        const focusFirstItem = (menuRef) => { try { const m = menuRef.current; if (m !== null && m !== undefined) { const items = menuButtons(m); if (items.length > 0) items[0].focus() } } catch (e) { /* the menu is gone */ } }
        /** The focus goes back to the button that opened the menu. */
        const focusTrigger = (ref) => { try { if (ref !== undefined && ref !== null && ref.current !== null && ref.current !== undefined) ref.current.focus() } catch (e) { /* the button is gone */ } }
        /** The keydown handler of a menu element: arrows, Home and End move between its buttons; Tab closes it. (Escape is the window listener of each menu.) A key pressed in the
         *  « Switch team » panel, a React child that is not in this menu's DOM, is not ours. */
        const menuKeyDown = (menuRef, toggleRef, close) => (ev) => {
          const menu = menuRef.current
          if (menu === null || menu === undefined || menu.contains(ev.target) !== true) return
          if (ev.key === 'Tab') { ev.preventDefault(); close(); focusTrigger(toggleRef); return }
          const items = menuButtons(menu)
          const to = menuTarget(ev.key, items.length, items.indexOf(document.activeElement))
          if (to < 0) return
          ev.preventDefault()
          items[to].focus()
        }

        // ── The footer's menu while NO account is connected (or while a pairing waits) ──
        // The row's gear opens it. Same structure as the connected menu: sign in (OUR device-code flow, never DSH's own « Sign
        // in »), appearance, DSH's Settings, links. DSH's Settings are reached from an entry of this menu — never from DSH's
        // account popover, which no longer shows. Drawn `fixed` on <body> (like the team switcher's sub-panel): the collapsed
        // rail is narrower than the menu and the sidebar column clips what overflows it.
        const OffMenu = (props) => {
          const posPair = React.useState(null)
          const pos = posPair[0]
          const setPos = posPair[1]
          const menuRef = React.useRef(null)
          React.useLayoutEffect(() => {
            const row = props.anchorRef.current
            if (row === null || row === undefined) return
            const r = row.getBoundingClientRect()
            const w = Math.max(Math.round(r.width), 248)
            setPos({
              left: Math.max(8, Math.min(Math.round(r.left), window.innerWidth - w - 8)),
              bottom: Math.max(8, Math.round(window.innerHeight - r.top) + 10),
              width: w,
            })
          }, [])
          React.useEffect(() => {
            const onKey = (ev) => { if (ev.key === 'Escape') { props.onClose(); focusTrigger(props.toggleRef) } }
            // The gear toggles the menu itself: closing here at mousedown would let its click reopen the menu at once.
            const dehors = (ev) => {
              const c = ev.target
              if (c !== null && typeof c.closest === 'function' && c.closest('.kbfp-menu') !== null) return
              const gear = props.toggleRef.current
              if (gear !== null && gear !== undefined && c !== null && gear.contains(c) === true) return
              props.onClose()
            }
            window.addEventListener('keydown', onKey)
            document.addEventListener('mousedown', dehors)
            return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', dehors) }
          }, [props.onClose])
          // The menu is drawn once its position is known: the focus enters it then.
          React.useEffect(() => { if (pos !== null) focusFirstItem(menuRef) }, [pos === null])
          if (pos === null) return null
          const entree = entreeMenu(props.onClose)
          return ReactDOM.createPortal(h('div', {
            className: 'kbfp-menu kbfp-menu-off', role: 'menu', 'aria-label': t('menu'), 'data-kb': 'off-menu', ref: menuRef, onKeyDown: menuKeyDown(menuRef, props.toggleRef, props.onClose),
            style: { left: pos.left + 'px', bottom: pos.bottom + 'px', width: pos.width + 'px' },
          },
          h('div', { className: 'kbfp-mitems', 'data-kb': 'menu-block-connect' },
            entree('connect', h(EnterIcon, { size: 18 }), props.pairing === true ? t('footPairingAction') : t('footConnect'), props.onConnect),
            // The server's own sign-up page (the account app), in the system browser.
            props.signupUrl !== undefined && props.signupUrl !== ''
              ? entree('signup', h(UserIcon, { size: 18 }), t('menuSignup'), () => openTab(props.signupUrl.replace(/\/+$/, '') + '/account'), { ext: true })
              : null),
          h('div', { className: 'kbfp-msep' }),
          h('div', { className: 'kbfp-mitems', 'data-kb': 'menu-block-account' },
            h(AppearanceRow, null),
            entree('settings', h(GearIcon, { size: 18 }), t('menuSettingsApp'), ouvrirReglagesDsh)),
          h('div', { className: 'kbfp-msep' }),
          h('div', { className: 'kbfp-mitems', 'data-kb': 'menu-block-links' },
            entree('website', h(GlobeIcon, { size: 18 }), t('menuWebsite'), () => openTab(WEBSITE_URL), { ext: true }),
            entree('help', h(HelpIcon, { size: 18 }), t('menuHelp'), () => openTab(helpUrl()), { ext: true }),
            entree('feedback', h(MsgMenuIcon, { size: 18 }), t('menuFeedback'), () => envoyer('feedback')))), document.body)
        }
        // ── The « Upgrade » dialog: the pricing table and « Subscribe » ──────────────────────────────────────────────────────────
        // The catalogue and the quotes are the server's PUBLIC data, read through the host (`/plans`, `/plans/quote`). « Subscribe » asks the
        // host for the payment page of the ACTIVE workspace (`/billing/checkout`) and the host opens it in the system browser: the device
        // token never reaches this page. The server decides who may buy (owner or admin) and what is possible; its answer comes back as a
        // status and a code, and every state below says what happened and what the person can do about it.
        const UP_FEATURES = {
          byok: 'upFeatByok', connections: 'upFeatConnections', hosted_runs: 'upFeatHostedRuns', computers: 'upFeatComputers',
          'computers.always_on': 'upFeatAlwaysOn', 'team.members': 'upFeatTeamMembers', 'team.lessons': 'upFeatTeamLessons', 'team.skills': 'upFeatTeamSkills',
        }
        const UP_EURO_REGIONS = ['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK']
        const upLocale = () => { const l = lang(); return l === 'en' ? 'en-US' : l === 'fr' ? 'fr-FR' : l }
        const upMoney = (amount, currency) => {
          const n = Number(amount)
          if (!Number.isFinite(n)) return String(amount)
          try {
            return new Intl.NumberFormat(upLocale(), { style: 'currency', currency: currency, minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n)
          } catch (e) { return n.toFixed(2) + ' ' + currency }
        }
        /** The currency to start on: the euro for a French-speaking or euro-zone person when it is sold, else the dollar, else the first. */
        const upDefaultCurrency = (currencies) => {
          if (currencies.length === 0) return null
          let region = ''
          try { const m = /[-_]([A-Za-z]{2})\b/.exec(String(navigator.language || '')); region = m !== null ? m[1].toUpperCase() : '' } catch (e) { region = '' }
          if ((UP_EURO_REGIONS.indexOf(region) >= 0 || lang() === 'fr') && currencies.indexOf('EUR') >= 0) return 'EUR'
          if (currencies.indexOf('USD') >= 0) return 'USD'
          return currencies[0]
        }
        /** What a failed call says, and what can be done: `portal` offers the billing portal, `retry` a new attempt. */
        const upProblem = (status, code) => {
          if (code === 'billing_disabled' || status === 501) return { text: t('upErrDisabled'), portal: false, retry: false }
          if (status === 403) return { text: t('upErrForbidden'), portal: false, retry: false }
          if (status === 409) return { text: t('upErrConflict'), portal: true, retry: false }
          if (status === 404) return { text: t('upErrNotFound'), portal: false, retry: false }
          if (status === 429) return { text: t('upErrRate'), portal: false, retry: true }
          if (status === 422) return { text: t('upErrInvalid'), portal: false, retry: true }
          if (status === 0 || status === undefined || status === null) return { text: t('upErrDown'), portal: false, retry: true }
          return { text: t('upErrRetry'), portal: false, retry: true }
        }
        const UpgradeDialog = (props) => {
          const st = props.state !== undefined && props.state !== null ? props.state : {}
          const spaces = Array.isArray(st.workspaces) ? st.workspaces : []
          const activeId = typeof st.active_workspace_id === 'string' ? st.active_workspace_id : null
          const ws = spaces.filter((w) => w !== null && w.id === activeId)[0] || spaces[0] || null
          const wsId = ws !== null && typeof ws.id === 'string' ? ws.id : null
          const wsName = ws !== null && ws.name ? nomAffiche(ws, t) : ''
          // A team workspace buys seats; a personal one, a level. The account says which; unknown is personal.
          const forTeam = ws !== null && ws.personal === false
          const sp = st.space_plan !== undefined && st.space_plan !== null && typeof st.space_plan === 'object' ? st.space_plan : {}
          const here = (c) => (typeof sp.key === 'string' && sp.key !== '' && sp.key === c.key) || (typeof sp.label === 'string' && sp.label !== '' && sp.label.toLowerCase() === String(c.name).toLowerCase())

          const [cat, setCat] = React.useState({ phase: 'loading' })
          const [currency, setCurrency] = React.useState(null)
          const [billing, setBilling] = React.useState('year')
          const [seats, setSeats] = React.useState(null)
          const [packs, setPacks] = React.useState(1)
          const [quote, setQuote] = React.useState({ phase: 'idle' })
          const [action, setAction] = React.useState({ phase: 'idle' })
          const rootRef = React.useRef(null)
          const liveRef = React.useRef(true)
          React.useEffect(() => () => { liveRef.current = false }, [])

          const loadCatalogue = React.useCallback(() => {
            setCat({ phase: 'loading' })
            callLocal('/plans', 'GET').then((r) => {
              if (liveRef.current !== true) return
              if (r !== null && r !== undefined && r.ok === true && Array.isArray(r.plans)) {
                setCat({ phase: 'ok', plans: r.plans.filter((p) => p !== null && typeof p === 'object' && Array.isArray(p.components)), tax: r.tax_basis })
              } else setCat({ phase: 'error', status: r !== null && r !== undefined ? r.status : 0, code: r !== null && r !== undefined ? r.error : '' })
            }).catch(() => { if (liveRef.current === true) setCat({ phase: 'error', status: 0, code: '' }) })
          }, [])
          React.useEffect(() => { loadCatalogue() }, [loadCatalogue])
          React.useEffect(() => { try { if (rootRef.current !== null) rootRef.current.focus() } catch (e) { /* not focusable */ } }, [])
          React.useEffect(() => {
            const onKey = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); props.onClose() } }
            window.addEventListener('keydown', onKey, true)
            return () => window.removeEventListener('keydown', onKey, true)
          }, [props.onClose])

          const plans = cat.phase === 'ok' ? cat.plans : []
          const ofKind = (k) => plans.filter((p) => p.kind === k)[0] || null
          const main = forTeam ? ofKind('team') : ofKind('individual')
          const topup = ofKind('topup')
          const currencies = main !== null && Array.isArray(main.currencies) ? main.currencies.filter((c) => typeof c === 'string') : []
          const cur = currency !== null && currencies.indexOf(currency) >= 0 ? currency : upDefaultCurrency(currencies)
          const priceFor = (c, iv) => (Array.isArray(c.prices) ? c.prices : []).filter((p) => p !== null && p.currency === cur && (iv === null || p.interval === iv))[0] || null
          const sold = main === null || cur === null ? [] : (Array.isArray(main.intervals) ? main.intervals : []).filter((iv) => main.components.some((c) => priceFor(c, iv) !== null))
          const interval = sold.indexOf(billing) >= 0 ? billing : (sold[0] || null)
          const seatMin = main !== null && Number.isInteger(main.min_seats) && main.min_seats > 0 ? main.min_seats : 1
          const seatMax = main !== null && Number.isInteger(main.max_seats) && main.max_seats >= seatMin ? main.max_seats : 999
          const seatCount = Math.min(seatMax, Math.max(seatMin, seats === null ? seatMin : seats))
          const mainKey = main !== null ? main.key : ''

          // The price of the seats, from the server (graduated by band: never computed here).
          React.useEffect(() => {
            if (forTeam !== true || mainKey === '' || cur === null || interval === null) { setQuote({ phase: 'idle' }); return undefined }
            let on = true
            setQuote({ phase: 'loading' })
            const id = window.setTimeout(() => {
              callLocal('/plans/quote?plan=' + encodeURIComponent(mainKey) + '&currency=' + encodeURIComponent(cur) + '&quantity=' + seatCount + '&interval=' + interval, 'GET')
                .then((r) => { if (on === true) setQuote(r !== null && r !== undefined && r.ok === true && r.quote ? { phase: 'ok', q: r.quote } : { phase: 'error' }) })
                .catch(() => { if (on === true) setQuote({ phase: 'error' }) })
            }, 250)
            return () => { on = false; window.clearTimeout(id) }
          }, [forTeam, mainKey, cur, interval, seatCount])

          const busy = action.phase === 'busy'
          // No payment provider on this server: no button can work, and the dialog has already said so.
          const noPayments = action.phase === 'error' && (action.code === 'billing_disabled' || action.status === 501)
          const buy = (body, key) => {
            if (busy === true || wsId === null || cur === null) return
            setAction({ phase: 'busy', key: key })
            callLocal('/billing/checkout', 'POST', Object.assign({ workspace_id: wsId, currency: cur, open: true }, body)).then((r) => {
              if (liveRef.current !== true) return
              if (r !== null && r !== undefined && r.ok === true) {
                // A host that could not open a browser hands the address back; the person opens it from here.
                setAction({ phase: 'opened', url: r.opened === true || typeof r.url !== 'string' ? '' : r.url })
                return
              }
              setAction({ phase: 'error', key: key, status: r !== null && r !== undefined ? r.status : 0, code: r !== null && r !== undefined ? r.error : '', again: () => buy(body, key) })
            }).catch(() => { if (liveRef.current === true) setAction({ phase: 'error', key: key, status: 0, code: '', again: () => buy(body, key) }) })
          }
          const openPortal = () => {
            if (busy === true || wsId === null) return
            setAction({ phase: 'busy', key: 'portal' })
            callLocal('/billing/portal', 'POST', { workspace_id: wsId, open: true }).then((r) => {
              if (liveRef.current !== true) return
              if (r !== null && r !== undefined && r.ok === true) { setAction({ phase: 'opened', url: r.opened === true || typeof r.url !== 'string' ? '' : r.url }); return }
              setAction({ phase: 'error', key: 'portal', status: r !== null && r !== undefined ? r.status : 0, code: r !== null && r !== undefined ? r.error : '', again: openPortal, fromPortal: true })
            }).catch(() => { if (liveRef.current === true) setAction({ phase: 'error', key: 'portal', status: 0, code: '', again: openPortal, fromPortal: true }) })
          }
          // After paying in the browser: read the account again, and close.
          const refresh = () => {
            callLocal('/refresh', 'POST').catch(() => null).then(() => { try { props.onChanged() } catch (e) { /* gone */ } props.onClose() })
          }

          const feats = (c) => (Array.isArray(c.features) ? c.features : []).filter((k) => typeof k === 'string').slice(0, 8)
          const usageOf = (c) => {
            const d = c.display !== undefined && c.display !== null ? c.display : (main !== null && main.display !== undefined ? main.display : null)
            return d !== null && typeof d.usage_multiple === 'number' && d.usage_multiple > 0 ? d.usage_multiple : null
          }
          const creditsOf = (c) => {
            const a = (Array.isArray(c.allowances) ? c.allowances : []).filter((x) => x !== null && typeof x.member_credits === 'number')
            const month = a.filter((x) => x.window_seconds === 2592000)[0] || a[a.length - 1]
            return month !== undefined ? month.member_credits : null
          }
          const perMonth = (c) => { const p = priceFor(c, interval); return p === null ? null : p }
          const buyButton = (label, body, key, disabled) => h('button', {
            type: 'button', className: 'kbup-go', 'data-kb': 'upgrade-subscribe-' + key, disabled: busy === true || noPayments === true || disabled === true || cur === null || (interval === null && key !== 'topup'),
            onClick: () => buy(body, key),
          }, busy === true && action.key === key ? t('loading') : label)
          const featureList = (c) => h('ul', { className: 'kbup-feats' }, feats(c).map((k) => h('li', { key: k }, '✓ ', UP_FEATURES[k] !== undefined ? t(UP_FEATURES[k]) : k.replace(/[._]/g, ' '))))

          const levelCard = (c) => {
            const p = perMonth(c)
            const mult = usageOf(c)
            const credits = creditsOf(c)
            const current = here(c)
            return h('div', { key: c.key, className: 'kbup-plan' + (current ? ' cur' : ''), 'data-kb': 'upgrade-plan-' + c.key },
              h('div', { className: 'kbup-name' }, c.name),
              h('div', { className: 'kbup-price' }, p !== null ? upMoney(p.amount, cur) : '—', h('small', null, ' ' + t('upPerMonth'))),
              h('div', { className: 'kbup-muted' }, interval === 'year' ? t('upBilledYearly') + (p !== null ? ' · ' + upMoney(Number(p.amount) * 12, cur) + ' ' + t('upPerYear') : '') : t('upBilledMonthly')),
              mult !== null ? h('div', { className: 'kbup-use' }, t('upUsage') + ' ×' + mult) : null,
              credits !== null ? h('div', { className: 'kbup-muted' }, credits.toLocaleString(upLocale()) + ' ' + t('upCredits')) : null,
              featureList(c),
              current
                ? h('button', { type: 'button', className: 'kbup-go', disabled: true }, t('upCurrent'))
                : buyButton(t('upSubscribe'), { plan: main.key, component: c.key, quantity: 1, interval: interval }, c.key, p === null))
          }
          const teamCard = () => {
            const band = main.components[0]
            const unit = band !== undefined ? priceFor(band, interval) : null
            const mult = band !== undefined ? usageOf(band) : null
            const total = quote.phase === 'ok' ? quote.q : null
            const payNote = interval === 'year' ? t('upPerYear') : t('upPerMonthTotal')
            return h('div', { key: 'team', className: 'kbup-plan kbup-team', 'data-kb': 'upgrade-plan-team' },
              h('div', { className: 'kbup-name' }, main.name),
              h('div', { className: 'kbup-price' }, unit !== null ? upMoney(unit.amount, cur) : '—', h('small', null, ' ' + t('upPerSeatMonth'))),
              h('div', { className: 'kbup-muted' }, interval === 'year' ? t('upBilledYearly') : t('upBilledMonthly')),
              mult !== null ? h('div', { className: 'kbup-use' }, t('upUsage') + ' ×' + mult) : null,
              band !== undefined ? featureList(band) : null,
              h('div', { className: 'kbup-seats' },
                h('span', null, t('upSeats')),
                h('span', { className: 'kbup-stepper' },
                  h('button', { type: 'button', 'aria-label': t('upSeatsLess'), 'data-kb': 'upgrade-seats-less', disabled: seatCount <= seatMin, onClick: () => setSeats(seatCount - 1) }, '−'),
                  h('b', { 'data-kb': 'upgrade-seats' }, String(seatCount)),
                  h('button', { type: 'button', 'aria-label': t('upSeatsMore'), 'data-kb': 'upgrade-seats-more', disabled: seatCount >= seatMax, onClick: () => setSeats(seatCount + 1) }, '+'))),
              h('div', { className: 'kbup-total', 'data-kb': 'upgrade-total' },
                quote.phase === 'ok' && total !== null ? h('span', null, t('upTotal') + ' ', h('b', null, upMoney(total.total, cur)), ' ' + payNote)
                  : quote.phase === 'error' ? h('span', { className: 'kbup-muted' }, t('upQuoteFail'))
                    : h('span', { className: 'kbup-muted' }, t('upCalculating'))),
              buyButton(t('upSubscribe'), { plan: main.key, quantity: seatCount, interval: interval }, 'team', quote.phase !== 'ok'))
          }
          const topupCard = () => {
            if (topup === null || topup.pack === undefined || topup.pack === null) return null
            const c = topup.components[0]
            const price = c !== undefined ? priceFor(c, null) : null
            if (price === null) return null
            const maxQ = Number.isInteger(topup.pack.max_qty) && topup.pack.max_qty > 0 ? topup.pack.max_qty : 10
            const n = Math.min(maxQ, Math.max(1, packs))
            return h('div', { className: 'kbup-topup', 'data-kb': 'upgrade-topup' },
              h('div', { className: 'kbup-topup-txt' },
                h('b', null, t('upTopup')),
                h('span', { className: 'kbup-muted' }, Number(topup.pack.grant_credits).toLocaleString(upLocale()) + ' ' + t('upCreditsUnit') + ' · ' + upMoney(price.amount, cur)
                  + (Number.isInteger(topup.pack.expires_months) ? ' · ' + t('upTopupSub') + ' ' + topup.pack.expires_months + ' ' + t('upMonths') : ''))),
              h('span', { className: 'kbup-stepper' },
                h('button', { type: 'button', 'aria-label': t('upSeatsLess'), disabled: n <= 1, onClick: () => setPacks(n - 1) }, '−'),
                h('b', null, String(n)),
                h('button', { type: 'button', 'aria-label': t('upSeatsMore'), disabled: n >= maxQ, onClick: () => setPacks(n + 1) }, '+')),
              h('button', { type: 'button', className: 'kbup-go kbup-go-ghost', 'data-kb': 'upgrade-subscribe-topup', disabled: busy === true || noPayments === true || cur === null, onClick: () => buy({ plan: topup.key, quantity: n, interval: undefined }, 'topup') },
                busy === true && action.key === 'topup' ? t('loading') : t('upBuyCredits')))
          }

          let body = null
          if (cat.phase === 'loading') body = h('p', { className: 'kbup-muted', 'data-kb': 'upgrade-loading' }, t('upLoading'))
          else if (cat.phase === 'error') {
            body = h('div', { className: 'kbup-state', 'data-kb': 'upgrade-load-error', 'data-status': String(cat.status) },
              h('p', null, t('upErrLoad')),
              h('div', { className: 'kbup-actions' }, h('button', { type: 'button', className: 'kbup-go', onClick: loadCatalogue }, t('upRetry'))))
          } else if (main === null) {
            body = h('p', { className: 'kbup-muted', 'data-kb': 'upgrade-none' }, t('upErrNotFound'))
          } else {
            const tax = cat.tax === 'exclusive' ? t('upTaxExcl') : cat.tax === 'inclusive' ? t('upTaxIncl') : ''
            const premium = typeof main.monthly_premium_pct === 'number' && main.monthly_premium_pct > 0 ? Math.round(main.monthly_premium_pct) : null
            body = h(React.Fragment, null,
              h('div', { className: 'kbup-bar' },
                sold.length > 1
                  ? h('span', { className: 'kbup-seg', role: 'group', 'data-kb': 'upgrade-interval' },
                    sold.map((iv) => h('button', { key: iv, type: 'button', className: iv === interval ? 'on' : '', 'aria-pressed': iv === interval ? 'true' : 'false', onClick: () => setBilling(iv) },
                      iv === 'year' ? t('upYearly') : t('upMonthly') + (premium !== null ? ' +' + premium + '%' : ''))))
                  : null,
                currencies.length > 1
                  ? h('span', { className: 'kbup-seg', role: 'group', 'aria-label': t('upCurrency'), 'data-kb': 'upgrade-currency' },
                    currencies.map((c) => h('button', { key: c, type: 'button', className: c === cur ? 'on' : '', 'aria-pressed': c === cur ? 'true' : 'false', onClick: () => setCurrency(c) }, c)))
                  : null),
              h('div', { className: 'kbup-grid' }, forTeam ? teamCard() : main.components.map(levelCard)),
              topupCard(),
              tax !== '' ? h('p', { className: 'kbup-muted kbup-tax' }, tax) : null)
          }

          let banner = null
          if (action.phase === 'opened') {
            banner = h('div', { className: 'kbup-banner ok', role: 'status', 'data-kb': 'upgrade-opened' },
              h('span', null, t('upOpened')),
              h('span', { className: 'kbup-actions' },
                action.url !== '' ? h('a', { className: 'kbup-link', href: action.url, target: '_blank', rel: 'noopener noreferrer' }, t('upOpenFallback')) : null,
                h('button', { type: 'button', className: 'kbup-go', 'data-kb': 'upgrade-refresh', onClick: refresh }, t('upOpenedRefresh'))))
          } else if (action.phase === 'error') {
            const pr = upProblem(action.status, action.code)
            banner = h('div', { className: 'kbup-banner err', role: 'alert', 'data-kb': 'upgrade-error', 'data-status': String(action.status), 'data-code': String(action.code || '') },
              h('span', null, pr.text),
              h('span', { className: 'kbup-actions' },
                pr.portal === true && action.fromPortal !== true ? h('button', { type: 'button', className: 'kbup-go', 'data-kb': 'upgrade-portal', onClick: openPortal }, t('upPortal')) : null,
                pr.retry === true && typeof action.again === 'function' ? h('button', { type: 'button', className: 'kbup-go', 'data-kb': 'upgrade-retry', onClick: action.again }, t('upRetry')) : null))
          }

          return h('div', { className: 'kbup-scrim', 'data-kb': 'upgrade-dialog', onClick: (e) => { if (e.target === e.currentTarget) props.onClose() } },
            h('div', { className: 'kbup', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('upTitle'), tabIndex: -1, ref: rootRef },
              h('div', { className: 'kbup-head' },
                h('div', null,
                  h('h2', { className: 'kbup-title' }, t('upTitle')),
                  wsName !== '' ? h('p', { className: 'kbup-sub' }, t('upFor') + ' ' + wsName) : null),
                h('button', { type: 'button', className: 'kbc-x', 'aria-label': t('close'), 'data-kb': 'upgrade-close', onClick: props.onClose }, '✕')),
              banner,
              body))
        }
        const UserMenu = (props) => {
          React.useEffect(() => {
            const onKey = (ev) => { if (ev.key === 'Escape') { props.onClose(); focusTrigger(props.toggleRef) } }
            window.addEventListener('keydown', onKey)
            return () => window.removeEventListener('keydown', onKey)
          }, [props.onClose])
          const popRef = React.useRef(null)
          React.useEffect(() => { focusFirstItem(popRef) }, [])
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
          // Closing on an ENTRY click lives in `entreeMenu`, once for all, not in each `onClick` where it gets forgotten.
          // The Appearance segment is not an entry: it leaves the menu open.
          const entree = entreeMenu(props.onClose)

          // Blocks separated by a rule: Teams (space, plan, team settings) ·
          // Account · Links, then Log out. An available update goes first.
          // "Security" is no longer in the menu (04/10); the plan moves up under
          // the space selector, just before "Teams settings".
          return h('div', { className: 'kbfp-menu', ref: popRef, role: 'menu', 'aria-label': t('wsPageTitle'), onKeyDown: menuKeyDown(popRef, props.toggleRef, props.onClose) },
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
                  planInfo.free === true ? h('button', { type: 'button', className: 'kbfp-mcta', 'data-kb': 'menu-plan-cta', onClick: () => { try { props.onClose() } catch (e) { /* closed */ } props.onUpgrade() } }, t('menuPlanCta')) : null)),
              // "Teams settings" = the former "Workspace settings" (same action).
              entree('space-settings', h(BuildingIcon, { size: 18 }), t('menuTeamsSettings'), props.onSpace)),
            h('div', { className: 'kbfp-msep' }),
            h('div', { className: 'kbfp-mitems', 'data-kb': 'menu-block-account' },
              // Account and Referral: read-only pages of the server's console, in DSH (no arrow: they stay here).
              entree('account', h(UserIcon, { size: 18 }), t('profCompte'), props.onAccount),
              entree('referral', h(GiftMenuIcon, { size: 18 }), t('profParrain'), props.onReferral, { amber: true }),
              // The phone link (kybernos-mobile): present only when the server offers it and the plan includes it, with the phones already linked.
              props.remote !== null && props.remote !== undefined
                ? entree('remote', h(PhoneIcon, { size: 18 }), t('menuRemote'), props.onRemote, props.remote.devices > 0 ? { tail: String(props.remote.devices) } : undefined)
                : null,
              h(AppearanceRow, null),
              // DSH's own Settings (the app's): through the core plugin's seam, never through the native account popover.
              entree('settings', h(GearIcon, { size: 18 }), t('menuSettingsApp'), ouvrirReglagesDsh)),
            h('div', { className: 'kbfp-msep' }),
            h('div', { className: 'kbfp-mitems', 'data-kb': 'menu-block-links' },
              entree('website', h(GlobeIcon, { size: 18 }), t('menuWebsite'), () => openTab(WEBSITE_URL), { ext: true }),
              entree('help', h(HelpIcon, { size: 18 }), t('menuHelp'), () => openTab(helpUrl()), { ext: true }),
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
          // The notes plugins published for the bell (see the SHOW_BELL comment): read from the shared store, followed while mounted.
          const [notes, setNotes] = React.useState(() => { try { return window.__KB_NOTIFY__.list() } catch (e) { return [] } })
          React.useEffect(() => {
            try { setNotes(window.__KB_NOTIFY__.list()); return window.__KB_NOTIFY__.subscribe((l) => setNotes(l)) } catch (e) { return undefined }
          }, [])
          const [newOpen, setNewOpen] = React.useState(false)
          const [mobileOpen, setMobileOpen] = React.useState(false)
          // Update available: an amber dot on the card tile, the discreet
          // reminder that stays visible with the menu closed (kybernos-maintenance signal).
          const [majInfo, setMajInfo] = React.useState(() => lireMaj())
          const majDispo = majInfo !== null
          React.useEffect(() => {
            const sur = () => setMajInfo(lireMaj())
            window.addEventListener('kybernos:update', sur)
            return () => window.removeEventListener('kybernos:update', sur)
          }, [])
          // Signed out (or pairing) there is no account menu to carry the "Update available" line, and the card of the launch is shown once:
          // this line stays in the footer until the update is applied (or its version is skipped). It opens the same dialog.
          const ouvrirMaj = () => { try { window.dispatchEvent(new Event('kybernos:menu:update')) } catch (e) { /* Event absent */ } }
          const ligneMaj = majInfo === null ? null : h('button', {
            type: 'button', className: 'kbf-maj', 'data-kb': 'foot-update', onClick: ouvrirMaj,
          }, h('span', { className: 'kbf-maj-dot', 'aria-hidden': 'true' }),
            h('span', { className: 'kbf-maj-t' }, t('menuUpdate')),
            h('span', { className: 'kbf-maj-v' }, (majInfo.kind === 'moteur' ? 'DSH ' : '') + (typeof majInfo.version === 'string' ? majInfo.version : majInfo.cible)))
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
          const offRowRef = React.useRef(null)
          const gearRef = React.useRef(null)
          const cardRef = React.useRef(null)
          const [upgradeOpen, setUpgradeOpen] = React.useState(false)
          // The same dialog, for a page that has to say « this needs a paid plan » (the Kaby page): it asks, it does not own the dialog.
          React.useEffect(() => {
            try { window.__KB_UPGRADE__ = { open: () => setUpgradeOpen(true) } } catch (e) { /* no window */ }
            return () => { try { delete window.__KB_UPGRADE__ } catch (e) { /* gone */ } }
          }, [])
          // A one-line notice above the footer (a page that could not be opened): it goes by itself.
          const [flash, setFlash] = React.useState('')
          React.useEffect(() => {
            if (flash === '') return undefined
            const id = window.setTimeout(() => setFlash(''), 7000)
            return () => window.clearTimeout(id)
          }, [flash])
          // The account page of the SERVER, in the system browser: signed in through the single-use console link the host asks for.
          const openAccountPage = (section, workspaceId) => {
            callLocal('/console/link', 'POST', Object.assign({ section: section, open: true }, typeof workspaceId === 'string' ? { workspace_id: workspaceId } : {})).then((r) => {
              if (r !== null && r !== undefined && r.ok === true) {
                // A host that could not open a browser hands the address back.
                if (r.opened !== true && typeof r.url === 'string') { try { window.open(r.url, '_blank', 'noopener,noreferrer') } catch (e) { /* popup refused */ } }
                return
              }
              setFlash(r !== null && r !== undefined && r.error === 'email_not_verified' ? t('accountNeedsVerify') : t('accountOpenFail'))
            }).catch(() => setFlash(t('accountOpenFail')))
          }
          // The server this DSH talks to, signed out too: « Create an account » opens ITS sign-up page.
          const [serverInfo, setServerInfo] = React.useState(null)
          React.useEffect(() => {
            let on = true
            callLocal('/server', 'GET').then((r) => { if (on === true && r !== null && r !== undefined && r.ok === true && r.server !== null && typeof r.server === 'object') setServerInfo(r.server) }).catch(() => null)
            return () => { on = false }
          }, [])
          const [autoStart, setAutoStart] = React.useState(false)
          const [phase, setPhase] = React.useState('loading')
          const [state, setState] = React.useState({})
          // What the phone link says about itself (kybernos-mobile's host route, the same one its panel reads): the menu offers « Remote control »
          // only when the feature is there for this person. Unknown (not read yet, route absent, a refusal) is « not offered », never a dead entry.
          const [remote, setRemote] = React.useState(null)
          React.useEffect(() => {
            if (phase !== 'connected') { setRemote(null); return undefined }
            let on = true
            const url = (() => { try { return new URL('kybernos-mobile/remote/status', document.baseURI).pathname } catch (e) { return '/kybernos-mobile/remote/status' } })()
            const read = () => {
              fetch(url, { credentials: 'same-origin', cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (on === true) setRemote(remoteOffer(j)) }).catch(() => { if (on === true) setRemote(null) })
            }
            read()
            const seen = () => { if (document.visibilityState === 'visible') read() }
            const timer = window.setInterval(read, 60000)
            document.addEventListener('visibilitychange', seen)
            return () => { on = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', seen) }
          }, [phase])
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

          // The host reads the account again by itself (a token revoked from the account page, a removal from a team: index.js `profileRefreshTick`), and the
          // chip followed only when the card was opened or closed: measured, it said « Rita Rich · Solo Studio » for 45 s after the host had signed out. /status
          // is a local read: every 30 s while the window is visible, and when it comes back into view.
          React.useEffect(() => {
            const again = () => { if (document.visibilityState === 'visible') void load() }
            const timer = window.setInterval(again, 30000)
            document.addEventListener('visibilitychange', again)
            window.addEventListener('focus', again)
            return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', again); window.removeEventListener('focus', again) }
          }, [load])

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
              callLocal('/quota', 'GET').then((r) => { if (on === true && r !== null && r !== undefined && r.ok === true) setQuota(quotaStamp(r)) }).catch(() => null)
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

          // The core plugin sends a real click on DSH's own account launcher here (it should not be reachable: its area is hidden, but
          // a shell that renamed its classes would show it): the person lands in OUR menu, connected or not.
          React.useEffect(() => {
            const ouvrirMenu = () => { setNotifOpen(false); setMobileOpen(false); setMenuOpen(true) }
            window.addEventListener('kybernos-cloud:menu', ouvrirMenu)
            return () => window.removeEventListener('kybernos-cloud:menu', ouvrirMenu)
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
            // « Team settings », « Account » and « Referral » open the APP, in the person's browser, signed in (the single-use console link, section `plan` or
            // `overview`, on the active workspace). They used to open a read-only copy of it in DSH's content zone, and every change in that copy sent the person
            // to the browser anyway (ADR 0054, decision of 2026-10-16): the way in now says where the work happens. The embedded console's code is still in the
            // core bundle (its console bridge); nothing in this bundle calls it.
            const ouvrirAppli = (section) => () => {
              setMenuOpen(false)
              openAccountPage(section, actif)
            }
            const shownName = displayName(user)
            const qui = shownName.value !== '' ? shownName.value : (user.email || t('none'))
            // ── Réglages ▸ Compte (demande du 30/09) ────────────────────────
            // « Compte » (et « Sécurité », même cible) du menu principal va
            // DIRECTEMENT dans la section Compte des Réglages : l'ancienne
            // page plein cadre est cachée pour le moment. On ouvre les
            // Réglages de DSH (le même geste que l'entrée
            // « Paramètres » du menu), puis on clique la cellule « Compte »
            // du nav dès qu'elle est rendue — le panneau se monte en
            // asynchrone. Réglages déjà ouverts : on se borne à sélectionner
            // la cellule (re-cliquer le déclencheur les refermerait).
            // Cellule introuvable après ~2 s : les Réglages restent sur leur
            // section par défaut, jamais d'erreur bloquante.
            // The section is named by its label AND, when known, by its id (the React key of its cell: the same in every language).
            const ouvrirReglagesCompte = (libelleCible, cleCible) => {
              const libelle = typeof libelleCible === 'string' ? libelleCible : ''
              const cleDe = (el) => {
                try {
                  const nom = Object.keys(el).find((x) => x.indexOf('__reactFiber$') === 0)
                  const k = nom === undefined ? null : el[nom].key
                  return typeof k === 'string' ? k : null
                } catch (e) { return null }
              }
              const cliquerCellule = () => {
                try {
                  const cellules = Array.from(document.querySelectorAll('button[class*="navCell"]'))
                  const cible = cellules.find((b) => (typeof cleCible === 'string' && cleDe(b) === cleCible) || String((b.textContent || '').trim()) === libelle)
                  if (cible !== undefined && cible !== null) { cible.click(); return true }
                } catch (e) { /* nav pas encore rendu */ }
                return false
              }
              try {
                const nav = document.querySelector('[class*="navList"]')
                const dejaOuvert = nav !== null && nav.offsetParent !== null
                if (dejaOuvert === false) ouvrirReglagesDsh()
              } catch (e) { /* declencheur introuvable */ }
              let essais = 0
              const tique = () => {
                essais += 1
                if (cliquerCellule() === true) return
                if (essais < 40) window.setTimeout(tique, 50)
              }
              window.setTimeout(tique, 80)
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
                type: 'button', className: 'kbfp-cardmain', ref: cardRef, title: t('wsPageTitle'),
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
                  : null),
              h('span', { className: 'kbfp-chev', 'aria-hidden': 'true' }, h(SwapIcon, { size: 18 }))),
              SHOW_BELL === true || notes.length > 0
                ? h('span', { className: 'kbfp-bellwrap' },
                h('button', {
                  type: 'button', className: 'kbfp-ico', 'data-kb': 'bell',
                  title: t('notifTitle') + (notes.some((n) => n.read !== true) ? ' (' + notes.filter((n) => n.read !== true).length + ')' : ''), 'aria-label': t('notifTitle'),
                  'aria-expanded': notifOpen === true ? 'true' : 'false',
                  onClick: () => {
                    setMobileOpen(false)
                    const next = notifOpen !== true
                    setNotifOpen(next)
                    if (next) { try { window.__KB_NOTIFY__.markRead() } catch (e) { /* no store */ } }
                  },
                }, h(BellIcon, { size: 19 }), notes.some((n) => n.read !== true) ? h('i', { className: 'kbfp-belldot', 'data-kb': 'bell-dot', 'aria-hidden': 'true' }) : null),
                notifOpen === true
                  ? h('div', { className: 'kbf-pop kbfp-bellpop', role: 'dialog', 'aria-label': t('notifTitle') },
                      h('div', { className: 'kbf-poptitle kbfp-belltitle' }, t('notifTitle'),
                        notes.length > 0 ? h('button', { type: 'button', className: 'kbfp-noteclear', onClick: () => { try { window.__KB_NOTIFY__.clear() } catch (e) { /* no store */ } } }, t('notifClear')) : null),
                      notes.length === 0
                        ? h('div', { className: 'kbc-note' }, t('notifEmpty'))
                        : h('ul', { className: 'kbfp-notes', 'data-kb': 'notif-list' }, notes.map((n) => h('li', { key: n.id, className: 'kbfp-note', 'data-kind': n.kind },
                          h('div', { className: 'kbfp-note-t' }, n.title),
                          n.body !== '' ? h('div', { className: 'kbfp-note-b' }, n.body) : null,
                          h('div', { className: 'kbfp-note-r' },
                            n.action !== null && n.action !== undefined
                              ? h('button', { type: 'button', className: 'kbfp-note-act', onClick: () => { try { window.__KB_NOTIFY__.run(n); window.__KB_NOTIFY__.dismiss(n.id) } catch (e) { /* no store */ } setNotifOpen(false) } }, n.action.label)
                              : null,
                            h('button', { type: 'button', className: 'kbfp-note-x', 'aria-label': t('notifDismiss'), onClick: () => { try { window.__KB_NOTIFY__.dismiss(n.id) } catch (e) { /* no store */ } } }, '×'))))))
                  : null)
                : null,
              menuOpen === true
                ? h(UserMenu, {
                  state: state,
                  toggleRef: cardRef,
                  onClose: () => setMenuOpen(false),
                  onChanged: () => { void load() },
                  onCreateSpace: () => {
                    setMenuOpen(false)
                    setNewOpen(true)
                  },
                  onAccount: ouvrirAppli('overview'),
                  // The referral card is on the account's overview page.
                  onReferral: ouvrirAppli('overview'),
                  remote: remote,
                  onRemote: () => { setMenuOpen(false); setNotifOpen(false); setMobileOpen(true) },
                  onUpgrade: () => { setMenuOpen(false); setUpgradeOpen(true) },
                  onSpace: ouvrirAppli('plan'),
                  onLogout: () => { void seDeconnecter() },
                })
                : null),
            mobileOpen === true
              ? h(MobilePanel, {
                onClose: () => setMobileOpen(false),
                web: typeof state.web_url === 'string' ? state.web_url : '',
                onManage: () => { setMobileOpen(false); ouvrirReglagesCompte('Remote Control', 'kybernos-mobile') },
              })
              : null)
          } else {
            // Signed out, or a pairing waiting for its confirmation: ONE button, in the place and at the size of the profile row, with
            // the same chevron. It opens OUR menu (sign in = the device-code card, create an account, appearance, DSH's Settings,
            // links) — never DSH's account popover, whose « Sign in » is not our flow.
            const pairing = phase === 'pairing'
            corps = h('div', { className: 'kbf-off' },
              ligneMaj,
              h('div', { className: 'kbfp-cardwrap ' + (etroit === true ? 'kbfp-tight2' : ''), 'data-kb': 'signin-card', ref: offRowRef },
                h('div', { className: 'kbfp-card' },
                  h('button', {
                    type: 'button', className: 'kbfp-cardmain', ref: gearRef, 'data-kb': 'foot-signin',
                    title: pairing ? t('footPairing') : t('footHint'), 'aria-label': pairing ? t('pairingTitle') : t('footSignInUp'),
                    'aria-haspopup': 'menu', 'aria-expanded': menuOpen === true ? 'true' : 'false',
                    onClick: () => setMenuOpen(menuOpen !== true),
                  },
                  h('span', { className: 'kbfp-tile', 'aria-hidden': 'true' }, h(UserIcon, { size: 18 })),
                  h('span', { className: 'kbfp-cardtxt' },
                    h('span', { className: 'kbfp-cardname' }, pairing ? t('pairingTitle') : t('footSignInUp')),
                    h('span', { className: 'kbfp-cardsub' }, pairing ? t('footPairingAction') : (phase === 'loading' ? t('loading') : t('footSyncSub')))),
                  h('span', { className: 'kbfp-chev', 'aria-hidden': 'true' }, h(SwapIcon, { size: 18 }))))),
              menuOpen === true
                ? h(OffMenu, {
                  pairing: pairing,
                  anchorRef: offRowRef,
                  toggleRef: gearRef,
                  signupUrl: (serverInfo !== null && typeof serverInfo.web === 'string' && serverInfo.web !== '' ? serverInfo.web : (serverInfo !== null && typeof serverInfo.api === 'string' ? serverInfo.api : '')),
                  onClose: () => setMenuOpen(false),
                  onConnect: pairing ? openCard : openAndConnect,
                })
                : null)
          }

          return h('div', { className: 'kbf-root', ref: racineRef },
            flash !== '' ? h('div', { className: 'kbfp-flash', role: 'status', 'data-kb': 'foot-flash' }, flash) : null,
            corps,
            upgradeOpen === true
              ? h(UpgradeDialog, { state: state, onClose: () => setUpgradeOpen(false), onChanged: () => { void load() } })
              : null,
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
              if (on === true) setInfo({ r: quotaStamp(r) })
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

        // ── The « Kybernos » section of DSH's Settings ────────────────────────────────────────────────────────────
        // What stays on THIS computer: the custom instructions (a marked section of <DSH home>/AGENTS.md, read by every agent), the re-import of the active
        // server's model catalogue and the send of the DSH chats' directory (project and date, never the content). The account's own pages (profile,
        // security, devices, data, support) are the server's embedded pages, opened from the footer menu: nothing of them is here. The section shows whether
        // the person is connected or not: the instructions need no server, the two other actions say so when signed out.
        const KY_INSTR_MAX = 2000
        const KybernosSection = (props) => {
          // « Advanced » (the two actions for a person who knows what they do) starts folded; a page may start it open (tests, and a link that points at it).
          const [adv, setAdv] = React.useState(props !== null && props !== undefined && props.advanced === true)
          const [ask, setAsk] = React.useState(false)
          const [conn, setConn] = React.useState('loading')
          const [models, setModels] = React.useState(null)
          const [lastPush, setLastPush] = React.useState(null)
          const [text, setText] = React.useState('')
          const [saved, setSaved] = React.useState('')
          const [file, setFile] = React.useState('')
          const [instr, setInstr] = React.useState('loading')
          const [instrErr, setInstrErr] = React.useState('')
          const [flash, setFlash] = React.useState(false)
          const [busy, setBusy] = React.useState('')
          const [fail, setFail] = React.useState({ models: false, chats: false })
          const live = React.useRef(true)
          React.useEffect(() => () => { live.current = false }, [])

          const readStatus = React.useCallback(async () => {
            let st = null
            try { st = await callLocal('/status', 'GET') } catch (e) { st = null }
            if (live.current !== true) return
            if (st !== null && st.connected === true) {
              const s = st.state !== undefined && st.state !== null ? st.state : {}
              setConn('in')
              setModels(s.models !== undefined ? s.models : null)
              setLastPush(s.chats_last_push !== undefined ? s.chats_last_push : null)
            } else {
              setConn('out')
            }
          }, [])
          React.useEffect(() => { void readStatus() }, [readStatus])
          // The page follows the card: a connection made or ended there is seen here without leaving the section.
          React.useEffect(() => {
            const again = () => { void readStatus() }
            window.addEventListener('focus', again)
            window.addEventListener('kybernos-cloud:space-changed', again)
            return () => { window.removeEventListener('focus', again); window.removeEventListener('kybernos-cloud:space-changed', again) }
          }, [readStatus])

          React.useEffect(() => {
            let alive = true
            callLocal('/instructions', 'GET').then((r) => {
              if (alive !== true) return
              if (r !== null && r.ok === true && typeof r.file === 'string' && typeof r.text === 'string') {
                setFile(r.file); setText(r.text); setSaved(r.text); setInstr('ready')
              } else {
                setInstr(r !== null && r.error === 'markers-damaged' ? 'damaged' : 'unavailable')
              }
            }).catch(() => { if (alive === true) setInstr('unavailable') })
            return () => { alive = false }
          }, [])

          const dirty = instr === 'ready' && text !== saved
          const save = async () => {
            if (dirty !== true || busy !== '') return
            setBusy('save'); setInstrErr(''); setFlash(false)
            let r = null
            try { r = await callLocal('/instructions/save', 'POST', { text: text }) } catch (e) { r = null }
            if (live.current !== true) return
            setBusy('')
            if (r !== null && r.ok === true) {
              // The host trims the text: what is kept is what the field then shows.
              const kept = text.replace(/\r\n/g, '\n').trim()
              setText(kept); setSaved(kept); setFlash(true)
            } else {
              setInstrErr(r !== null && typeof r.error === 'string' ? r.error : 'write-failed')
            }
          }
          const instrWhy = (code) => {
            if (code === 'reserved') return t('kyWhyReserved')
            if (code === 'markers-damaged') return t('kyWhyDamaged')
            if (code === 'too-long') return quotaFill(t('kyWhyLong'), { max: KY_INSTR_MAX })
            if (code === 'unreadable') return t('kyWhyUnreadable')
            return t('kyWhyWrite')
          }

          const run = async (which, path) => {
            if (busy !== '' || conn !== 'in') return
            setBusy(which)
            setFail((f) => Object.assign({}, f, { [which]: false }))
            let bad = false
            try {
              const r = await callLocal(path, 'POST')
              bad = r === null || r.ok !== true
            } catch (e) { bad = true }
            await readStatus()
            if (live.current !== true) return
            setFail((f) => Object.assign({}, f, { [which]: bad }))
            setBusy('')
          }

          const count = models !== null && typeof models.count === 'number' ? models.count : 0
          const when = models !== null ? fmtDate(models.imported_at) : null
          const signedOut = conn === 'out'
          const needSignIn = signedOut ? h('p', { className: 'kbm-setform-unavailable kbl-note', 'data-kb': 'ky-signed-out' }, t('kyNeedServer')) : null

          return h('div', { className: 'kbl-page', 'data-kb': 'ky-section' },
            h('div', { className: 'kbl-head' },
              h('h2', { className: 'kb6-title' }, t('kyTitle')),
              h('p', { className: 'kb8-sub' }, t('kySub'))),

            h('div', { className: 'kbl-card', 'data-kb': 'ky-instructions' },
              h('div', { className: 'kbl-sect' }, t('kyInstrTitle')),
              h('textarea', {
                className: 'kbl-area', rows: 6, maxLength: KY_INSTR_MAX, value: text, placeholder: t('kyInstrPh'),
                disabled: instr !== 'ready' || busy === 'save', 'data-kb': 'ky-instr-field',
                onChange: (e) => { setText(e.target.value); setFlash(false) },
              }),
              h('div', { className: 'kbl-count' }, String(text.length) + ' / ' + String(KY_INSTR_MAX)),
              h('p', { className: 'kbm-setform-unavailable kbl-note', 'data-kb': 'ky-instr-note' },
                instr === 'ready' ? quotaFill(t('kyInstrNote'), { file: file })
                  : (instr === 'damaged' ? t('kyWhyDamaged') : (instr === 'loading' ? t('loading') : t('kyInstrNone')))),
              instrErr === '' ? null : h('p', { className: 'kbm-setfield-invalid kbl-note', 'data-kb': 'ky-instr-error' }, quotaFill(t('kyInstrErr'), { why: instrWhy(instrErr) })),
              h('div', { className: 'kbl-actions' },
                h('button', {
                  type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-primary', disabled: dirty !== true || busy === 'save',
                  'data-kb': 'ky-instr-save', onClick: () => { void save() },
                }, busy === 'save' ? t('kySaving') : t('kySave')),
                flash === true ? h('span', { className: 'kbl-ok', 'data-kb': 'ky-instr-saved' }, t('kySaved')) : null)),

            h('div', { className: 'kbl-card', 'data-kb': 'ky-models' },
              h('div', { className: 'kbl-sect' }, t('kyModelsTitle')),
              h('p', { className: 'kbl-line', 'data-kb': 'ky-models-state' },
                count > 0
                  ? quotaFill(t('kyModelsCount'), { n: count, plan: (models !== null && models.plan) || t('none') }) + (when !== null ? ' · ' + quotaFill(t('kyLastOn'), { date: when }) : '')
                  : (signedOut ? '—' : t('kyModelsNone'))),
              // The list keeps itself up to date (the host re-imports at the connection, at a server switch and when the catalogue changes): nothing to press here.
              h('p', { className: 'kbm-setform-unavailable kbl-note', 'data-kb': 'ky-models-auto' }, t('kyModelsAuto')),
              count > 0 && models.settings !== true ? h('p', { className: 'kbm-setfield-invalid kbl-note', 'data-kb': 'ky-models-warn' }, t('kyModelsWarn')) : null,
              needSignIn),

            // The two actions that are for a person who knows what they do (re-reading the catalogue by hand, sending the chat directory) sit under a folded « Advanced ».
            h('div', { className: 'kbl-adv', 'data-kb': 'ky-advanced' },
              h('button', { type: 'button', className: 'kbl-advb', 'aria-expanded': adv ? 'true' : 'false', 'aria-controls': 'ky-adv-body', 'data-kb': 'ky-adv-toggle', onClick: () => { setAdv(!adv); setAsk(false) } },
                h('span', { className: 'kbl-advc' + (adv ? ' open' : '') }, ChevronIcon({ size: 14 })), h('span', null, t('kyAdvanced'))),
              adv ? h('div', { className: 'kbl-advbody', id: 'ky-adv-body' },
                h('div', { className: 'kbl-card', 'data-kb': 'ky-models-adv' },
                  h('div', { className: 'kbl-sect' }, t('kyModelsTitle')),
                  h('p', { className: 'kbm-setform-unavailable kbl-note' }, t('kyModelsNote')),
                  fail.models === true ? h('p', { className: 'kbm-setfield-invalid kbl-note', 'data-kb': 'ky-models-error' }, t('kyModelsFail')) : null,
                  h('div', { className: 'kbl-actions' },
                    h('button', {
                      type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-outline', disabled: conn !== 'in' || busy !== '', 'data-kb': 'ky-models-run',
                      onClick: () => { void run('models', '/models/sync') },
                    }, busy === 'models' ? t('kyImporting') : (count > 0 ? t('kyReimport') : t('kyImport'))))),

                h('div', { className: 'kbl-card', 'data-kb': 'ky-chats' },
                  h('div', { className: 'kbl-sect' }, t('kyChatsTitle')),
                  h('p', { className: 'kbl-line', 'data-kb': 'ky-chats-state' },
                    lastPush !== null && lastPush.ok === true
                      ? t('kyChatsLast') + ' · ' + String(lastPush.pushed === undefined ? 0 : lastPush.pushed) + (fmtDate(lastPush.at) !== null ? ' · ' + fmtDate(lastPush.at) : '')
                      : (lastPush !== null && lastPush.ok === false ? t('kyChatsFail') : '—')),
                  // What is sent, and why, in one sentence; and nothing is sent until the person has said yes to THAT.
                  h('p', { className: 'kbm-setform-unavailable kbl-note', 'data-kb': 'ky-chats-note' }, t('kyChatsNote')),
                  fail.chats === true ? h('p', { className: 'kbm-setfield-invalid kbl-note', 'data-kb': 'ky-chats-error' }, t('kyChatsFail')) : null,
                  needSignIn,
                  ask === true && busy !== 'chats'
                    ? h('div', { className: 'kbl-actions', 'data-kb': 'ky-chats-confirm', role: 'group', 'aria-label': t('kyChatsAsk') },
                      h('span', { className: 'kbl-line' }, t('kyChatsAsk')),
                      h('button', {
                        type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-primary', disabled: conn !== 'in' || busy !== '', 'data-kb': 'ky-chats-yes',
                        onClick: () => { setAsk(false); void run('chats', '/chats/push') },
                      }, t('kyChatsYes')),
                      h('button', { type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-outline', 'data-kb': 'ky-chats-no', onClick: () => setAsk(false) }, t('kyChatsNo')))
                    : h('div', { className: 'kbl-actions' },
                      h('button', {
                        type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-outline', disabled: conn !== 'in' || busy !== '', 'data-kb': 'ky-chats-run',
                        onClick: () => { setAsk(true) },
                      }, busy === 'chats' ? t('kyChatsSending') : t('kyChatsSend'))))) : null))
        }
        ctx.effect(() => slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'kybernos-local', order: 11, label: t('kyNav') }, KybernosSection)),
        'kybernos-cloud: section Kybernos des reglages (ce qui reste sur cet ordinateur)')
      },
    }
  },
})
