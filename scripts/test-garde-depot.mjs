#!/usr/bin/env node
// The repository guard sees what it must (audit 2026-10-16, A6-12): the READMEs, the tests, the live checks and the biggest bundle were
// blind spots, and a home folder, a mail address and a handle of the owner sat in a public repository. No browser, no git.
//
//   node scripts/test-garde-depot.mjs
//
// The fixtures are assembled from pieces, so this file does not carry a home folder or an address itself (the guard reads the tests too).
import { isScanned, personalMails, personalPath, warningsOf } from './garde-depot.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }
const MB = 1048576
const home = (who, rest = '') => '/Users/' + who + rest
const mail = (local, domain) => local + '@' + domain

console.log('what it reads')
check('the READMEs and the docs', isScanned('packages/x/README.md', 4000) && isScanned('docs/install.md', 4000) && isScanned('README.md', 4000))
check('the tests and the live checks', isScanned('packages/x/test-host.mjs', 4000) && isScanned('scripts/check-help-live.mjs', 4000) && isScanned('services/y/runner.test.mjs', 4000) && isScanned('packages/messaging/test/telegram.test.mjs', 4000))
check('the biggest bundle, in full (client.js is 2.7 MB)', isScanned('packages/kybernos-plugin/client.js', 2.7 * MB))
check('the data, the workflows, the scripts and the extension-less launchers', isScanned('a/b.json', 10) && isScanned('.github/workflows/ci.yml', 10) && isScanned('packages/x/verify.py', 10) && isScanned('kybernos-install', 10) && isScanned('packages/x/Dockerfile', 10))
check('not the vendored or minified code, not a lock file, not media, not a file over the cap', !isScanned('packages/x/vendor/lib.js', 10) && !isScanned('a/b.min.js', 10) && !isScanned('package-lock.json', 10) && !isScanned('a.png', 10) && !isScanned('big.json', 5 * MB))

console.log('what it flags')
check('a home folder of a person, in a README, a test or a comment', personalPath('ln -s ' + home('jane', '/work/x')) && personalPath("home: '" + home('essai') + "'") && personalPath('cd ' + home('alex', '/work')))
check('not the placeholders the repository allows (a « me » or « x » home, Homebrew)', !personalPath(home('me', '/work')) && !personalPath(home('x', '/y')) && !personalPath('/opt/homebrew/bin/node'))
check('a person\'s mail address', personalMails('mail: ' + mail('jane', 'kybernos.dev')).length === 1 && personalMails('write to ' + mail('someone.real', 'gmail.com') + ' or ' + mail('other', 'corp.fr')).length === 2)
const allowed = [mail('noreply', 'kybernos.app'), mail('support', 'kybernos.app'), mail('owner', 'example.test'), mail('name', 'company.com'), mail('you', 'example.com'), mail('git', 'github.com'), mail('12345+x', 'users.noreply.github.com')]
check('not a role, a placeholder, an example domain or a git remote', personalMails(allowed.join(' ')).length === 0, personalMails(allowed.join(' ')))
check('one warning per file and kind, with the count', warningsOf('a/README.md', ['a', home('bob', '/x'), home('bob', '/y'), mail('bob', 'home.org')].join('\n')).join('|') === 'hard-coded personal path (2x): a/README.md|mail address (1x): a/README.md')
check('a clean text earns none', warningsOf('a.md', 'nothing here, see ~/ and <your checkout>').length === 0)

console.log(`\n${pass} ✓  ${fail} ✗`)
process.exit(fail === 0 ? 0 : 1)
