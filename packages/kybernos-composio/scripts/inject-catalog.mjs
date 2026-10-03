// OBSOLÈTE depuis la tâche task-11 : le catalogue n'est plus injecté dans client.js.
//
// catalog.js reste la source de vérité sur disque ; le half host
// (kybernos-composio/index.js) le sert sur GET /kybernos/composio/catalog avec
// cache mémoire + ETag, et le client le charge à la demande (kbCpCatalog).
// Réinjecter le littéral regonflerait le bundle de 412 Ko pour chaque navigateur :
// ce script refuse désormais de le faire et sert de garde-fou.
//
// Usage: node scripts/inject-catalog.mjs   (n'écrit rien)
import { readFileSync } from 'node:fs';

const dir = new URL('..', import.meta.url).pathname;
const clientSrc = readFileSync(dir + 'client.js', 'utf8');

if (clientSrc.indexOf('const CATALOG = [') >= 0 || clientSrc.indexOf('CATALOG-START') >= 0 || clientSrc.indexOf('KBCP-CATALOG-PLACEHOLDER') >= 0) {
  console.error('ABANDON: client.js contient encore un catalogue inline (ou un marqueur de génération).');
  process.exit(1);
}
if (clientSrc.indexOf("const CATALOG_URL = '/kybernos/composio/catalog'") < 0) {
  console.error('ABANDON: client.js ne charge plus le catalogue depuis la route host.');
  process.exit(1);
}
console.log('OK: catalogue hors bundle (servi par GET /kybernos/composio/catalog).');
