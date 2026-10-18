// The team folder and the private folder of a project live under the SAME root: <Documents>/Kybernos. Bundles are installed on their own and import nothing from one another, so
// kybernos-cloud (team-folder.mjs, a team's folder) and kybernos-multi-device (multi-device-host.mjs, a project's private folder) each carry their own « where is Documents » rule.
// This test keeps the two equal: for every platform, home and environment below, both answer the same Documents folder and the same root, and a name that kybernos-multi-device
// accepts as a folder name stays the same name in kybernos-cloud (a team called « Acme » gets the folder a person would have made by hand).
//
//   node scripts/test-team-folder-rule.mjs
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cloud = await import(pathToFileURL(join(root, 'packages', 'kybernos-cloud', 'team-folder.mjs')).href)
const multi = await import(pathToFileURL(join(root, 'packages', 'kybernos-multi-device', 'multi-device-host.mjs')).href)

let failed = 0
const check = (label, ok, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === undefined ? '' : '  -- ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}

const cases = [
  { platform: 'darwin', home: '/h', env: {} },
  { platform: 'win32', home: 'C:\\Users\\x', env: {} },
  { platform: 'linux', home: '/h', env: {}, xdgDocuments: () => '/h/Docs' },
  { platform: 'linux', home: '/h', env: {}, xdgDocuments: () => '/h' },
  { platform: 'linux', home: '/h', env: {}, xdgDocuments: () => '/h/' },
  { platform: 'linux', home: '/h', env: {}, xdgDocuments: () => { throw new Error('no xdg-user-dir') } },
  { platform: 'linux', home: '/h', env: {} },
  { platform: 'darwin', home: '/h', env: { KYBERNOS_DOCUMENTS_DIR: '/data/docs' } },
  { platform: 'darwin', home: '/h', env: { KYBERNOS_DOCUMENTS_DIR: 'relative/docs' } },
  { platform: 'darwin', home: '/h', env: { KYBERNOS_DOCUMENTS_DIR: '' } },
]
for (const c of cases) {
  const label = c.platform + ', env ' + JSON.stringify(c.env) + (c.xdgDocuments === undefined ? '' : ', xdg ' + (() => { try { return c.xdgDocuments() } catch (e) { return 'throws' } })())
  const a = cloud.documentsDir(c)
  const b = multi.documentsDir(c)
  check('Documents: ' + label, a === b, { cloud: a, multi: b })
  check('the root is <Documents>/Kybernos in both: ' + label, cloud.rootOf(a) === multi.rootOf(b) && cloud.rootOf(a) === join(a, 'Kybernos'))
}

// What kybernos-multi-device accepts as a folder name is, in kybernos-cloud, the same name (so a team and a hand-made project folder of one name are the same folder).
for (const name of ['Acme', 'Studio B', 'Nova Labs 2026', 'Équipe Été', 'a.b', 'x'.repeat(multi.NAME_MAX)]) {
  const accepted = multi.validName(name)
  check('a name kybernos-multi-device accepts stays the same in kybernos-cloud: ' + JSON.stringify(name.length > 20 ? name.slice(0, 20) + '…' : name), accepted.ok === true && (name.length > cloud.FOLDER_NAME_MAX || cloud.teamFolderName(name, 'id-1') === accepted.name), { multi: accepted, cloud: cloud.teamFolderName(name, 'id-1') })
}
// What kybernos-multi-device refuses is never a segment kybernos-cloud would produce.
for (const name of ['..', '.', 'a/b', 'a\\b', 'CON', 'a:b', 'name.', '.hidden', '', '   ', 'a\u0000b']) {
  const refused = multi.validName(name)
  const out = cloud.teamFolderName(name, 'id-1')
  check('a name kybernos-multi-device refuses becomes a name it accepts in kybernos-cloud: ' + JSON.stringify(name), refused.ok === false && multi.validName(out).ok === true, { out, refused })
}

console.log('\n' + (failed === 0 ? 'ALL GOOD' : failed + ' failed'))
process.exit(failed === 0 ? 0 : 1)
