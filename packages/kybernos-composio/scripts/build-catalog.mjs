// Builds catalog.js from the Kybernos cloud repo: 100 apps (name, categories, description)
// plus the real SVG logos taken from integrations-logos-live.ts.
//
// Normalizations (measured 2026-09-18):
//  1. Size: the source SVGs carry a hard-coded width="128" height="128". Injected into a 42 px
//     container they overflow (cropped corner: Gmail, G Drive, Make). width/height are removed so
//     the viewBox and the CSS size them.
//  2. IDs: most SVGs are already namespaced (kyb-x-<slug>-*), but salesforce/outlook/reddit have
//     short ids (a, b, c...) that COLLIDE between logos on the same page, so gradients resolve to
//     the wrong SVG. Every local id and url(#id) is prefixed with `lgb-<slug>-`.
//  3. Mangled markup (found 2026-10-05): a space moved inside tag names and attribute names, the
//     spaces between attributes were lost, a closing quote was doubled (repairSvg, see
//     svg-check.mjs). The defect is in the cloud repo itself.
//
// The result is then CHECKED (svgProblems): one <svg> root, only known elements, well-formed
// attributes, no reference to an id that does not exist, no relative or remote href. A logo that
// fails is a build error, except the ones listed in UNRECOVERABLE, which are dropped (the page
// then draws the app's initial instead of a broken picture). The catalog is served with
// `cache-control: max-age=3600`, so a corrected catalog reaches a browser up to an hour late.
//
// Usage: KYBERNOS_REPO=<cloud repo checkout> node scripts/build-catalog.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { repairSvg, svgProblems } from './svg-check.mjs';

// Path to a checkout of the Kybernos cloud repo (source of the integrations catalog).
const K = process.env.KYBERNOS_REPO;
if (!K) { console.error('Set KYBERNOS_REPO to the path of the kybernos cloud repo checkout.'); process.exit(1); }
const cat = JSON.parse(readFileSync(`${K}/apps/app/src/components/landing/integrations-catalog.json`, 'utf8'));
const src = readFileSync(`${K}/apps/app/src/components/landing/integrations-logos-live.ts`, 'utf8');

// Logos that cannot be repaired from the source, with the reason. The page falls back to a tile.
const UNRECOVERABLE = {
  airparser: 'the embedded PNG lost every "/", "+" and "=" of its base64 in the cloud repo (and its data: prefix became part of a relative href): the picture cannot be rebuilt',
};

// 1. Parse the LIVE_LOGOS entries (1387)
const logos = {};
const re = /\{ key: '([^']+)', name: '([^']*)', categories: (\[[^\]]*\]), svg: `([\s\S]*?)` \}/g;
let m;
while ((m = re.exec(src)) !== null) logos[m[1]] = m[4];
console.log('source logos:', Object.keys(logos).length);

// 2. Normalize an SVG for reliable inline rendering.
// Defects of the source fixed here (measured 2026-09-18 on integrations-logos-live.ts):
//  a. camelCase tag names cut by a space (<line arGradient>, <feFloo d>, <feGaussianBlu r>...)
//     on 37 logos: broken gradients/masks, a white or partial logo. Present IN kybernos, at the source.
//  b. hard-coded width/height: overflow of the container.
//  c. short, non-namespaced ids (salesforce/outlook/reddit): collisions.
// and, since 2026-10-05, the other mangling that repairSvg handles.
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
  // (a) repair the cut tag names
  for (const [broken, fixed] of BROKEN_TAGS) {
    out = out.split('<' + broken).join('<' + fixed);
  }
  // (a') the rest of the mangling (glued attributes, a space inside a name, a doubled quote)
  out = repairSvg(out);
  // (b) size: the CSS container decides, the viewBox keeps the proportions
  out = out
    .replace(/(<svg[^>]*?)\swidth="[^"]*"/, '$1')
    .replace(/(<svg[^>]*?)\sheight="[^"]*"/, '$1');

  // (c) namespacing of the local ids
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

// 3. Build the catalog
const apps = [];
let withLogo = 0;
const dropped = [];
for (const a of cat.apps) {
  const svg = logos[a.slug];
  let logo = svg ? normalize(svg, a.slug) : null;
  if (logo !== null && UNRECOVERABLE[a.slug] !== undefined) { dropped.push(`${a.slug}: ${UNRECOVERABLE[a.slug]}`); logo = null; }
  if (logo) withLogo++;
  apps.push({ s: a.slug, n: a.name, c: a.categories || [], d: a.description || '', l: logo });
}
console.log('apps:', apps.length, '| with a logo:', withLogo);
for (const d of dropped) console.log('logo dropped (unrecoverable):', d);

// 4. Non-regression checks
const seen = new Map();
const collisions = [];
let hardSized = 0;
let brokenTags = 0;
const defective = [];
for (const a of apps) {
  if (!a.l) continue;
  if (/<svg[^>]*\swidth="/.test(a.l)) hardSized++;
  for (const [broken] of BROKEN_TAGS) if (a.l.includes('<' + broken)) brokenTags++;
  for (const id of [...a.l.matchAll(/id="([^"]+)"/g)].map((x) => x[1])) {
    if (seen.has(id)) collisions.push(`${id} (${seen.get(id)} & ${a.s})`);
    else seen.set(id, a.s);
  }
  const problems = svgProblems(a.l);
  if (problems.length > 0) defective.push(`${a.s}: ${problems.slice(0, 3).join('; ')}`);
}
console.log('SVGs still hard-sized:', hardSized, '(must be 0)');
console.log('cut tags left:', brokenTags, '(must be 0)');
console.log('id collisions left:', collisions.length, '(must be 0)');
console.log('logos with a structural defect (unknown element, dangling url(#id), relative href...):', defective.length, '(must be 0)');
if (collisions.length) console.log(collisions.slice(0, 5).join('\n'));
for (const d of defective.slice(0, 10)) console.log('  ' + d);
if (hardSized || collisions.length || brokenTags || defective.length) { console.error('ABORT: the normalization is incomplete'); process.exit(1); }

const totalBytes = apps.reduce((n, a) => n + (a.l ? a.l.length : 0), 0);
console.log('logos size:', Math.round(totalBytes / 1024), 'KB');

const out = `// Embedded Composio catalog, generated from the Kybernos cloud repo
// (apps/app/src/components/landing/integrations-catalog.json + integrations-logos-live.ts).
// ${apps.length} apps, ${withLogo} real SVG logos (${Math.round(totalBytes / 1024)} KB).
// The Composio MCP exposes NO catalog (resources/list -> -32601, search returns 4-6 tools
// per request): this local list is the only source for the display.
// SVGs are normalized: width/height removed (the container sizes them), ids prefixed
// lgb-<slug>- (collision guard), mangled markup repaired and every logo checked
// (scripts/svg-check.mjs). Regenerate: KYBERNOS_REPO=<checkout> node scripts/build-catalog.mjs
export const CATALOG = ${JSON.stringify(apps)};
`;
writeFileSync(new URL('../catalog.js', import.meta.url).pathname, out);
console.log('catalog.js written');
