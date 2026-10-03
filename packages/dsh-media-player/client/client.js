// @local/dsh-media-player — bundle client GÉNÉRÉ par scripts/build.mjs (ne pas éditer).
// Source : src/plugin.js. Aucun code tiers : lecteur natif du navigateur.
window.__ModuleLoader__.load({
  id: '@local/dsh-media-player',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    try {
      var React = require('react')
      var plugin = (function (React) {
        // ═══════════════════════════════════════════════════════════════════════════
        // dsh-media-player — corps du plugin (source lisible, encapsulée par
        // scripts/build.mjs dans une fabrique `(React) => { name, inject, apply }`).
        //
        // PROBLÈME RÉSOLU
        // L'aperçu de documents de la barre latérale DSH sait afficher texte, code,
        // markdown, images, PDF, HTML et Office — mais pas le média. `mp3`, `wav`,
        // `mp4`, `webm`… figurent dans UNVIEWABLE_BINARY_EXTENSIONS, donc un .mp3
        // ouvert dans la barre latérale répond « Preview is not available for this
        // file type yet. ».
        //
        // SOLUTION
        // Un renderer d'aperçu supplémentaire, déclaré par le registre PUBLIC du
        // paquet ui-sidebar-documentpreview (aucun patch du paquet amont) :
        //
        //   ctx.documentPreviews.register({ id, extensions, binaryExtensions,
        //                                   priority, title, loading, wrap })
        //   ctx.slots.register({ name: 'sidebar.right.tab.document', key: id,
        //                        locale }, Body)      // Body({ content, resourceAddress, t })
        //
        // `loading: 'bytes-complete'` : le propriétaire de l'onglet lit lui-même le
        // fichier complet (plafonné par maxFileBytes) et remet `content =
        // { kind: 'bytes', data: Uint8Array }`. On en fait une Blob URL et on la
        // donne au <audio>/<video> natif : aucun codec vendoré, le navigateur fait
        // tout, et les formats qu'il ne décode pas tombent dans un message clair au
        // lieu d'un écran vide.
        // ═══════════════════════════════════════════════════════════════════════════

        const NAME = 'dsh-media-player'
        const BODY_ID = '@local/dsh-media-player/media'
        const NS = 'sidebarMediaPlayer'
        const STYLE_ID = 'dsh-media-player-styles'
        const SLOT = 'sidebar.right.tab.document'
        const ADDRESS_PREFIX = 'dsh-resource://file/session/'

        /** Conteneurs audio confiés au décodeur du navigateur. */
        const AUDIO_EXTENSIONS = [
          'mp3',
          'wav',
          'm4a',
          'aac',
          'ogg',
          'oga',
          'opus',
          'flac',
          'aif',
          'aiff',
          'weba',
          'wma'
        ]

        /** Conteneurs vidéo confiés au décodeur du navigateur. */
        const VIDEO_EXTENSIONS = [
          'mp4',
          'm4v',
          'webm',
          'ogv',
          'mov',
          'mkv',
          'avi',
          'wmv',
          '3gp',
          'mpeg',
          'mpg',
          'mts',
          'ts'
        ]

        const EXTENSIONS = [...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS]

        /**
         * Type MIME remis à la Blob. La liste suit ce que les navigateurs décodent
         * réellement : mkv/avi/wmv sont déclarés (le média est reconnu, le sélecteur
         * s'ouvre) même quand Chrome ne sait pas les décoder — c'est le message
         * d'échec du renderer qui le dit, pas une absence de lecteur.
         */
        const MEDIA_TYPES = {
          mp3: 'audio/mpeg',
          wav: 'audio/wav',
          m4a: 'audio/mp4',
          aac: 'audio/aac',
          ogg: 'audio/ogg',
          oga: 'audio/ogg',
          opus: 'audio/ogg',
          flac: 'audio/flac',
          aif: 'audio/aiff',
          aiff: 'audio/aiff',
          weba: 'audio/webm',
          wma: 'audio/x-ms-wma',
          mp4: 'video/mp4',
          m4v: 'video/mp4',
          webm: 'video/webm',
          ogv: 'video/ogg',
          mov: 'video/quicktime',
          mkv: 'video/x-matroska',
          avi: 'video/x-msvideo',
          wmv: 'video/x-ms-wmv',
          '3gp': 'video/3gpp',
          mpeg: 'video/mpeg',
          mpg: 'video/mpeg',
          mts: 'video/mp2t',
          ts: 'video/mp2t'
        }

        const ZH = {
          title: ' média',
          loading: 'Lecture du fichier…',
          unsupported: "Ce fichier n'est pas un média lisible.",
          failed:
            "Le navigateur ne sait pas décoder ce média (codec ou conteneur non pris en charge).",
          openExternal: 'Ouvrir à part',
          audio: 'Lecteur audio',
          video: 'Lecteur vidéo'
        }

        const EN = {
          title: 'Media',
          loading: 'Reading the file…',
          unsupported: 'This file is not a readable media file.',
          failed:
            'This browser cannot decode this media (unsupported codec or container).',
          openExternal: 'Open separately',
          audio: 'Audio player',
          video: 'Video player'
        }

        const CSS = `
        .dsh-media{display:flex;flex-direction:column;gap:10px;padding:12px;
          border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));
          border-radius:12px;background:var(--dsw-alias-bg-layer-2,transparent)}
        .dsh-media-head{display:flex;align-items:center;gap:8px;font-size:12px;
          line-height:18px;color:var(--dsw-alias-label-secondary,currentColor)}
        .dsh-media-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
          font-weight:500;color:var(--dsw-alias-label-primary,currentColor)}
        .dsh-media-size{flex:none;font-variant-numeric:tabular-nums;
          color:var(--dsw-alias-label-tertiary,currentColor)}
        .dsh-media-open{flex:none;margin-left:auto;text-decoration:none;white-space:nowrap;
          color:var(--dsw-alias-link,var(--dsw-alias-brand-primary,currentColor))}
        .dsh-media-open:hover{text-decoration:underline}
        audio.dsh-media-el{display:block;width:100%}
        video.dsh-media-el{display:block;width:100%;max-height:70vh;border-radius:8px;
          background:#000}
        /* Les contrôles natifs <audio>/<video> suivent le thème : DSH marque son
           document en sombre (html[data-ds-theme-source='dark']). Sans cette règle le
           lecteur reste blanc au milieu d'une interface sombre. */
        html[data-ds-theme-source='dark'] .dsh-media-el{color-scheme:dark}
        .dsh-media-status{margin:0;font-size:13px;line-height:20px;
          color:var(--dsw-alias-label-secondary,currentColor)}
        .dsh-media-status[data-state='failed']{color:var(--dsw-alias-state-warn-primary,currentColor)}
        `

        // ── helpers purs (exposés au banc d'essai via plugin.__test) ────────────────

        /** Chemin décodé d'une adresse `dsh-resource://file/session/<id>/<chemin>`. */
        function filePathOf(address) {
          if (typeof address !== 'string' || !address.startsWith(ADDRESS_PREFIX)) return ''
          const rest = address.slice(ADDRESS_PREFIX.length)
          const cut = rest.indexOf('/')
          if (cut < 0) return ''
          const encoded = rest.slice(cut + 1).split('?')[0].split('#')[0]
          try {
            return decodeURIComponent(encoded)
          } catch {
            return encoded
          }
        }

        /** Dernier segment du chemin (nom de fichier), `\` accepté comme séparateur. */
        function fileBaseName(path) {
          const normalized = String(path ?? '').replaceAll('\\', '/')
          return normalized.slice(normalized.lastIndexOf('/') + 1)
        }

        /** Suffixe normalisé (sans point, minuscules) du nom de fichier. */
        function extensionOf(path) {
          const name = fileBaseName(path).toLowerCase()
          const dot = name.lastIndexOf('.')
          return dot < 0 ? '' : name.slice(dot + 1)
        }

        /**
         * Média reconnu pour un chemin : `{ kind: 'audio' | 'video', mime }`, ou rien.
         * @param path - chemin décodé du fichier.
         */
        function mediaFor(path) {
          const extension = extensionOf(path)
          const mime = MEDIA_TYPES[extension]
          if (mime === undefined) return undefined
          return { kind: mime.startsWith('audio/') ? 'audio' : 'video', mime }
        }

        /** Taille lisible par un humain. */
        function humanBytes(bytes) {
          if (!Number.isFinite(bytes) || bytes < 0) return ''
          if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
          if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
          return `${bytes} B`
        }

        // ── renderer ────────────────────────────────────────────────────────────────

        /**
         * Corps d'aperçu : octets complets du fichier → Blob URL → <audio>/<video>.
         * @param props - `content` (octets), `resourceAddress`, `t` (libellés).
         */
        function MediaBody(props) {
          const content = props.content
          const t = props.t
          const path = React.useMemo(
            () => filePathOf(props.resourceAddress),
            [props.resourceAddress]
          )
          const media = React.useMemo(() => mediaFor(path), [path])
          const data =
            content !== undefined && content !== null && content.kind === 'bytes'
              ? content.data
              : undefined
          const [source, setSource] = React.useState(undefined)
          const [failed, setFailed] = React.useState(false)

          React.useEffect(() => {
            if (data === undefined || media === undefined) return undefined
            let url
            try {
              url = URL.createObjectURL(new Blob([data], { type: media.mime }))
            } catch {
              url = undefined
            }
            setFailed(false)
            setSource({ data, media, url })
            return () => {
              if (url !== undefined) URL.revokeObjectURL(url)
              setSource(undefined)
            }
          }, [data, media])

          if (data === undefined || media === undefined) {
            return React.createElement(
              'p',
              { className: 'dsh-media-status', role: 'alert' },
              t('unsupported')
            )
          }
          if (source === undefined || source.data !== data) {
            return React.createElement(
              'p',
              { className: 'dsh-media-status' },
              t('loading')
            )
          }
          if (source.url === undefined) {
            return React.createElement(
              'p',
              { className: 'dsh-media-status', 'data-state': 'failed', role: 'alert' },
              t('failed')
            )
          }

          const name = fileBaseName(path)
          const isAudio = media.kind === 'audio'
          return React.createElement(
            'div',
            { className: 'dsh-media', 'data-dsh-media': media.kind },
            React.createElement(
              'div',
              { className: 'dsh-media-head' },
              React.createElement('span', { className: 'dsh-media-name', title: path }, name),
              React.createElement(
                'span',
                { className: 'dsh-media-size' },
                humanBytes(data.byteLength)
              ),
              React.createElement(
                'a',
                {
                  className: 'dsh-media-open',
                  href: source.url,
                  download: name,
                  target: '_blank',
                  rel: 'noreferrer',
                  title: t('openExternal')
                },
                t('openExternal')
              )
            ),
            React.createElement(isAudio ? 'audio' : 'video', {
              key: source.url,
              className: 'dsh-media-el',
              src: source.url,
              controls: true,
              preload: 'metadata',
              playsInline: true,
              'aria-label': t(isAudio ? 'audio' : 'video'),
              onError: () => {
                setFailed(true)
              }
            }),
            failed
              ? React.createElement(
                  'p',
                  {
                    className: 'dsh-media-status',
                    'data-state': 'failed',
                    role: 'status'
                  },
                  t('failed')
                )
              : null
          )
        }

        // ── plugin ──────────────────────────────────────────────────────────────────

        /** Métadonnées du renderer, séparées de son corps (contrat du registre). */
        function mediaDefinition(t) {
          return {
            id: BODY_ID,
            extensions: EXTENSIONS,
            // Tout le média est binaire : jamais proposé en « texte brut ».
            binaryExtensions: EXTENSIONS,
            priority: 'extension',
            title: () => t('title'),
            loading: 'bytes-complete',
            wrap: false
          }
        }

        /**
         * Enregistre les métadonnées et le corps dès que le registre d'aperçus est là.
         * Le registre est fourni par ui-sidebar-documentpreview ; sur un profil qui ne
         * le monte pas, on ne fait rien plutôt que de casser l'entrée client.
         * @param ctx - contexte du plugin client.
         */
        function apply(ctx) {
          const t = ctx.locale.bind(NS)
          ctx.effect(
            () => ctx.locale.register(NS, { zh: ZH, en: EN }),
            'dsh-media-player: dictionaries'
          )
          ctx.effect(() => {
            const style = document.createElement('style')
            style.id = STYLE_ID
            style.textContent = CSS
            document.head.appendChild(style)
            return () => style.remove()
          }, 'dsh-media-player: styles')

          let active = false
          const activate = (scope) => {
            if (active) return
            let registry
            try {
              registry = scope.documentPreviews
            } catch {
              registry = undefined
            }
            if (registry === undefined || registry === null) return
            active = true
            scope.effect(
              () => registry.register(mediaDefinition(t)),
              'dsh-media-player: metadata'
            )
            scope.effect(
              () =>
                scope.slots.inject(SLOT, () =>
                  scope.slots.register(
                    { name: SLOT, key: BODY_ID, locale: NS },
                    MediaBody
                  )
                ),
              'dsh-media-player: body'
            )
          }

          // 1. le cas courant : le registre est déjà fourni quand on s'applique.
          activate(ctx)
          // 2. cordis natif, si le service devient disponible plus tard.
          if (!active && typeof ctx.inject === 'function') {
            try {
              ctx.inject(['documentPreviews'], (inner) => activate(inner))
            } catch {
              /* on garde le sondage ci-dessous */
            }
          }
          // 3. filet : sondage borné (le registre est fourni à l'apply d'un autre
          //    plugin, pas par le conteneur de services).
          if (!active) {
            let tries = 0
            const timer = setInterval(() => {
              tries += 1
              activate(ctx)
              if (active || tries > 40) clearInterval(timer)
            }, 250)
            ctx.effect(() => () => clearInterval(timer), 'dsh-media-player: probe')
          }
        }

        return {
          name: NAME,
          inject: ['slots', 'locale'],
          apply,
          // Surface de test : le banc d'essai hors GUI vérifie les helpers purs.
          __test: { filePathOf, fileBaseName, extensionOf, mediaFor, humanBytes, BODY_ID, EXTENSIONS }
        }

      })(React)
      exports.name = plugin.name
      exports.inject = plugin.inject
      exports.apply = plugin.apply
      exports.__test = plugin.__test
    } catch (error) {
      // Une exception ici casserait TOUTE l'entrée (« Failed to load plugins »)
      // et laisserait la GUI inutilisable : on dégrade, plugin désactivé.
      console.error('[dsh-media-player] évaluation impossible — plugin désactivé', error)
    }
    return module.exports
  }
})
