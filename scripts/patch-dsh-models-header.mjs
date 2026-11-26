// ── Le siège `settings.models.header` dans le paquet DSH installé ────────────
// La page native Settings → Models n'offre que `provider-card` (dans chaque
// rangée) et `footer` (après les rangées) : aucun siège pour se peindre AVANT
// la rangée `deepseek-official`. Ce script ajoute le troisième siège — la
// déclaration dans la section, son rendu juste avant le <ul> des rangées, et le
// type du contrat — de façon IDEMPOTENTE.
//
// À rejouer après chaque mise à jour de DSH (l'installation npm écrase le
// paquet), puis recharger la page de la GUI.
//
// Usage :
//   node scripts/patch-dsh-models-header.mjs            # applique (idempotent)
//   node scripts/patch-dsh-models-header.mjs --check    # vérifie, ne touche à rien
//   node scripts/patch-dsh-models-header.mjs --revert   # retire le siège
//
// Sortie : 0 = conforme après l'opération, 1 = écart (--check) ou échec.
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { racineDeclaree, resoudreCopie, refuserRacine } from './racine-dsh.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const args = process.argv.slice(2)
const CHECK = args.indexOf('--check') >= 0
const REVERT = args.indexOf('--revert') >= 0

const PKG = '@deepseek-ai/dsh-client-ui-settings-models'
const CLIENT_REL = join('lib', 'client.js')
const TYPES_REL = join('lib', 'types', 'client', 'slot-contract.d.ts')

// ── Où vit l'installation à patcher ─────────────────────────────────────────
// `--dsh <racine>` est OBLIGATOIRE (voir racine-dsh.mjs) : la copie visée est
// DÉCLARÉE par le robot de cycle de vie, jamais retrouvée par une sonde ni par
// un défaut Homebrew — sinon un banc visé par erreur se patcherait en silence.
const racine = racineDeclaree(args)
const resolution = resoudreCopie(racine, PKG)
if (resolution.copie === null) refuserRacine(resolution.motif, 'patch-dsh-models-header.mjs')
const pkg = resolution.copie

// ── Le patch, en trois morceaux ─────────────────────────────────────────────
const RENDER_ANCHOR = `\t\t\t\t\tsavedIdentity === void 0 ? null : (0, react_jsx_runtime.jsx)("p", {
\t\t\t\t\t\tclassName: ModelsSection_module_css_default["savedNotice"],
\t\t\t\t\t\trole: "status",
\t\t\t\t\t\t"aria-live": "polite",
\t\t\t\t\t\tchildren: providerCopy(t("savedProvider"), savedIdentity)
\t\t\t\t\t}),`
const RENDER_ADDED = `\n\t\t\t\t\trenderSlot("settings.models.header", {}),`

const CHILDREN_ANCHOR = `\t\t\t\t\t"settings.models.provider-card": {
\t\t\t\t\t\tkind: "keyed",
\t\t\t\t\t\tscope: "root"
\t\t\t\t\t},`
const CHILDREN_ADDED = `
\t\t\t\t\t"settings.models.header": {
\t\t\t\t\t\tkind: "list",
\t\t\t\t\t\tscope: "root"
\t\t\t\t\t},`

const TYPES_ANCHOR = `        /**
         * Ordered extension area after the provider rows and the add controls.`
const TYPES_ADDED = `        /**
         * Ordered extension area between the section intro/notices and the
         * provider rows — the "before deepseek" seat. Without a registrant the
         * area renders nothing.
         */
        'settings.models.header': {
            kind: 'list';
            scope: 'root';
            owner: ModelsHeaderOwnerProps;
        };
`

/** Les deux marqueurs qui disent « le siège est là » dans le client. */
const clientHasSeat = (src) =>
  src.indexOf('renderSlot("settings.models.header", {})') >= 0 && src.indexOf('"settings.models.header": {') >= 0

const typesHasSeat = (src) => src.indexOf("'settings.models.header': {") >= 0 && src.indexOf('ModelsHeaderOwnerProps') >= 0

const clientPath = join(pkg, CLIENT_REL)
const typesPath = join(pkg, TYPES_REL)
let client = readFileSync(clientPath, 'utf8')
let types = existsSync(typesPath) ? readFileSync(typesPath, 'utf8') : ''

const already = clientHasSeat(client)
const typesOk = typesHasSeat(types)

if (CHECK) {
  const ok = already && typesOk
  console.log((ok ? '✓ ' : '✗ ') + 'le siège settings.models.header est ' + (ok ? 'en place' : 'ABSENT') + ' — ' + pkg)
  if (already !== true) console.log('    · client.js : renderSlot/déclaration manquants')
  if (typesOk !== true) console.log('    · slot-contract.d.ts : type/interface manquants')
  process.exit(ok ? 0 : 1)
}

if (REVERT) {
  if (already !== true) { console.log('✓ rien à retirer — le siège n était pas posé'); process.exit(0) }
  client = client.split(RENDER_ADDED).join('')
  client = client.split(CHILDREN_ADDED).join('')
  types = types.replace(TYPES_ADDED, '')
  writeFileSync(clientPath, client)
  if (types !== '') writeFileSync(typesPath, types)
  console.log('✓ siège retiré — ' + pkg)
  process.exit(0)
}

// ── Application (sauvegarde horodatée avant écriture) ───────────────────────
if (already && typesOk) { console.log('✓ déjà en place — rien à faire (' + pkg + ')'); process.exit(0) }

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupDir = join('/tmp', 'dsh-models-header-backup')
mkdirSync(backupDir, { recursive: true })
copyFileSync(clientPath, join(backupDir, 'client.js.' + stamp))
if (types !== '') copyFileSync(typesPath, join(backupDir, 'slot-contract.d.ts.' + stamp))

if (already !== true) {
  if (client.indexOf(RENDER_ANCHOR) < 0) {
    console.error('✗ ancre de rendu introuvable — le paquet DSH a changé de forme ; adapter ce script.')
    process.exit(1)
  }
  if (client.indexOf(CHILDREN_ANCHOR) < 0) {
    console.error('✗ ancre de déclaration introuvable — le paquet DSH a changé de forme ; adapter ce script.')
    process.exit(1)
  }
  client = client.replace(RENDER_ANCHOR, RENDER_ANCHOR + RENDER_ADDED)
  client = client.replace(CHILDREN_ANCHOR, CHILDREN_ANCHOR + CHILDREN_ADDED)
  writeFileSync(clientPath, client)
}
if (typesOk !== true && types !== '') {
  if (types.indexOf(TYPES_ANCHOR) < 0) {
    console.error('✗ ancre de type introuvable dans slot-contract.d.ts ; le client est patché, le type non.')
    process.exit(1)
  }
  types = types.replace(TYPES_ANCHOR, TYPES_ADDED + TYPES_ANCHOR)
  writeFileSync(typesPath, types)
}
console.log('✓ siège settings.models.header posé — ' + pkg)
console.log('  sauvegarde : ' + backupDir)
console.log('  → recharger la page de la GUI pour voir le bloc « Kybernos Models »')
