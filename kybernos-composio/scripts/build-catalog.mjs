// Génère catalog.js depuis kybernos : 100 apps (nom, catégories, description)
// + logos SVG réels extraits de integrations-logos-live.ts.
//
// Deux normalisations OBLIGATOIRES (mesurées 2026-09-18) :
//  1. Taille : les SVG source portent width="128" height="128" en dur. Injectés
//     dans un conteneur de 42 px, ils débordent (coin rogné : Gmail, G Drive,
//     Make). On retire width/height pour laisser le viewBox + le CSS dimensionner.
//  2. IDs : la plupart des SVG sont déjà namespacés (kyb-x-<slug>-*), mais
//     salesforce/outlook/reddit ont des ids courts (a, b, c…) qui COLLISIONNENT
//     entre logos sur la même page → dégradés résolus vers le mauvais SVG.
//     On préfixe tout id/url(#id) local par `lgb-<slug>-`.
//
// Usage: node scripts/build-catalog.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const K = '/Users/miled/dyad-apps/kybernos';
const cat = JSON.parse(readFileSync(`${K}/apps/app/src/components/landing/integrations-catalog.json`, 'utf8'));
const src = readFileSync(`${K}/apps/app/src/components/landing/integrations-logos-live.ts`, 'utf8');

// 1. Parse les 1387 entrées LIVE_LOGOS
const logos = {};
const re = /\{ key: '([^']+)', name: '([^']*)', categories: (\[[^\]]*\]), svg: `([\s\S]*?)` \}/g;
let m;
while ((m = re.exec(src)) !== null) logos[m[1]] = m[4];
console.log('logos source:', Object.keys(logos).length);

// 2. Normalise un SVG pour un rendu inline fiable.
// Trois défauts source corrigés (mesurés 2026-09-18 sur integrations-logos-live.ts) :
//  a. noms de balises camelCase coupés par un espace (<line arGradient>,
//     <feFloo d>, <feGaussianBlu r>…) sur 37 logos → dégradés/masques cassés,
//     logo blanc ou partiel. Défaut PRÉSENT DANS kybernos à la source.
//  b. width/height en dur → débordement du conteneur.
//  c. ids courts non namespacés (salesforce/outlook/reddit) → collisions.
const BROKEN_TAGS = [
  ['line arGradient', 'linearGradient'],
  ['feFloo d', 'feFlood'],
  ['feBlen d', 'feBlend'],
  ['feBlendi ng', 'feBlending'],
  ['feGaussianBlu r', 'feGaussianBlur'],
  ['feComposit e', 'feComposite'],
  ['feMerg e', 'feMerge'],
  ['feMergeNod e', 'feMergeNode'],
  ['feMorpholog y', 'feMorphology'],
  ['feOffse t', 'feOffset'],
];
function normalize(svg, slug) {
  let out = svg
    .replace(/\sxmlns:\w+="[^"]*"/g, '')
    .replace(/\ssodipodi:\w+="[^"]*"/g, '')
    .replace(/\sinkscape:\w+="[^"]*"/g, '');
  // (a) répare les noms de balises coupés
  for (const [broken, fixed] of BROKEN_TAGS) {
    out = out.split('<' + broken).join('<' + fixed);
  }
  // (b) taille : le conteneur CSS décide, le viewBox préserve les proportions
  out = out
    .replace(/(<svg[^>]*?)\swidth="[^"]*"/, '$1')
    .replace(/(<svg[^>]*?)\sheight="[^"]*"/, '$1');

  // (c) namespacing des ids locaux
  const ids = [...out.matchAll(/id="([^"]+)"/g)].map((x) => x[1]);
  const prefix = `lgb-${slug}-`;
  for (const id of ids) {
    if (id.startsWith(prefix)) continue;
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out
      .replace(new RegExp(`id="${esc}"`, 'g'), `id="${prefix}${id}"`)
      .replace(new RegExp(`url\\(#${esc}\\)`, 'g'), `url(#${prefix}${id})`)
      .replace(new RegExp(`(xlink:href|href)="#${esc}"`, 'g'), `$1="#${prefix}${id}"`);
  }
  return out;
}

// 3. Construit le catalogue
const apps = [];
let withLogo = 0;
for (const a of cat.apps) {
  const svg = logos[a.slug];
  if (svg) withLogo++;
  apps.push({ s: a.slug, n: a.name, c: a.categories || [], d: a.description || '', l: svg ? normalize(svg, a.slug) : null });
}
console.log('apps:', apps.length, '| avec logo:', withLogo);

// 4. Contrôles de non-régression
const seen = new Map();
const collisions = [];
let hardSized = 0;
let brokenTags = 0;
for (const a of apps) {
  if (!a.l) continue;
  if (/<svg[^>]*\swidth="/.test(a.l)) hardSized++;
  for (const [broken] of BROKEN_TAGS) if (a.l.includes('<' + broken)) brokenTags++;
  for (const id of [...a.l.matchAll(/id="([^"]+)"/g)].map((x) => x[1])) {
    if (seen.has(id)) collisions.push(`${id} (${seen.get(id)} & ${a.s})`);
    else seen.set(id, a.s);
  }
}
console.log('SVG encore dimensionnés en dur:', hardSized, '(doit être 0)');
console.log('balises coupées restantes:', brokenTags, '(doit être 0)');
console.log('collisions d\'id restantes:', collisions.length, '(doit être 0)');
if (collisions.length) console.log(collisions.slice(0, 5).join('\n'));
if (hardSized || collisions.length || brokenTags) { console.error('ABANDON: normalisation incomplète'); process.exit(1); }

const totalBytes = apps.reduce((n, a) => n + (a.l ? a.l.length : 0), 0);
console.log('taille logos:', Math.round(totalBytes / 1024), 'KB');

const out = `// Catalogue Composio embarqué — généré depuis kybernos
// (apps/app/src/components/landing/integrations-catalog.json + integrations-logos-live.ts).
// ${apps.length} apps, ${withLogo} logos SVG réels (${Math.round(totalBytes / 1024)} Ko).
// Le MCP Composio n'expose AUCUN catalogue (resources/list → -32601, search renvoie
// 4-6 tools par requête) : cette liste locale est la seule source d'affichage.
// SVG normalisés : width/height retirés (le conteneur dimensionne), ids préfixés
// lgb-<slug>- (anti-collision). Régénérer : node scripts/build-catalog.mjs
export const CATALOG = ${JSON.stringify(apps)};
`;
writeFileSync(new URL('../catalog.js', import.meta.url).pathname, out);
console.log('catalog.js écrit');
