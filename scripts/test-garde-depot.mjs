#!/usr/bin/env node
// The repository guard sees what it must (audit 2026-10-16, A6-12): the READMEs, the tests, the live checks and the biggest bundle were
// blind spots, and a home folder, a mail address and a handle of the owner sat in a public repository. No browser, no git.
//
//   node scripts/test-garde-depot.mjs
//
// The fixtures are assembled from pieces, so this file does not carry a home folder or an address itself (the guard reads the tests too).
import { COVER_MAX, PHOTO_MAX, PHOTO_WIDTH_MAX, PHOTOS_PER_THEME, isAllowedCover, isAllowedPhoto, isScanned, isThemeCover, jpegSize, looksLikeJpeg, personalMails, personalPath, warningsOf } from './garde-depot.mjs'

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

console.log('the one picture it accepts: the cover of a shipped theme')
const T = 'packages/kybernos-plugin/themes/'
check('a theme\'s cover and a next trade\'s, small', isAllowedCover(T + 'ecommerce/cover.jpg', 25000) && isAllowedCover(T + 'real-estate/cover.jpg', COVER_MAX) && isAllowedCover(T + '_next/law-firm.jpg', 30000))
check('not one byte over the cap', !isAllowedCover(T + 'ecommerce/cover.jpg', COVER_MAX + 1))
check('not another name, another format or another folder', !isAllowedCover(T + 'ecommerce/photo.jpg', 100) && !isAllowedCover(T + 'ecommerce/cover.png', 100) && !isAllowedCover(T + 'ecommerce/cover.jpeg', 100) && !isAllowedCover('packages/kybernos-plugin/cover.jpg', 100) && !isAllowedCover('docs/themes/ecommerce/cover.jpg', 100) && !isAllowedCover('demo/ref-video/images/a.jpg', 100))
check('not deeper, not up a level, not a hidden or odd name', !isAllowedCover(T + 'ecommerce/skills/cover.jpg', 100) && !isAllowedCover(T + '../cover.jpg', 100) && !isAllowedCover(T + 'Ecommerce/cover.jpg', 100) && !isAllowedCover(T + '_next/a/b.jpg', 100) && !isAllowedCover(T + '_next/.jpg', 100))
check('inside a theme folder a stranger installs: only a root cover.jpg, small', isThemeCover('cover.jpg', 1000) && !isThemeCover('cover.jpg', COVER_MAX + 1) && !isThemeCover('img/cover.jpg', 1000) && !isThemeCover('cover.png', 1000))
check('a JPEG is told by its first bytes, never by its name', looksLikeJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0])) && !looksLikeJpeg(Buffer.from('GIF89a')) && !looksLikeJpeg(Buffer.alloc(0)) && !looksLikeJpeg(Buffer.from([0xff, 0xd8])))

console.log('the second picture it accepts: a sample picture of a shipped theme (a photograph or a portrait)')
check('a sample picture, at demo/photos/<name>.jpg, up to 220 KB', isAllowedPhoto(T + 'real-estate/demo/photos/willow-lane.jpg', 41000) && isAllowedPhoto(T + 'ecommerce/demo/photos/mug-2.jpg', PHOTO_MAX) && PHOTO_MAX === 220 * 1024)
check('not one byte over the cap, at most 24 a theme, at most 1280 px wide', !isAllowedPhoto(T + 'real-estate/demo/photos/willow-lane.jpg', PHOTO_MAX + 1) && PHOTOS_PER_THEME === 24 && PHOTO_WIDTH_MAX === 1280)
check('not another folder, name, format or depth', !isAllowedPhoto(T + 'real-estate/photos/a.jpg', 100) && !isAllowedPhoto(T + 'real-estate/demo/photos/a.png', 100) && !isAllowedPhoto(T + 'real-estate/demo/photos/sub/a.jpg', 100) && !isAllowedPhoto(T + 'real-estate/demo/photos/A.jpg', 100) && !isAllowedPhoto(T + 'real-estate/demo/photos/.a.jpg', 100) && !isAllowedPhoto(T + '_next/demo/photos/a.jpg', 100) && !isAllowedPhoto('docs/demo/photos/a.jpg', 100))
check('a photograph is not a cover and a cover is not a photograph', !isAllowedCover(T + 'real-estate/demo/photos/a.jpg', 100) && !isAllowedPhoto(T + 'real-estate/cover.jpg', 100))
// a JPEG header: SOI, an APP0 segment of 16 bytes, then a start-of-frame segment that says height 800 and width 1280
const jpegOf = (width, height, sof = 0xc0) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, sof, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])
check('the size of a JPEG is read from its first start-of-frame marker (baseline or progressive)', JSON.stringify(jpegSize(jpegOf(1280, 800))) === '{"height":800,"width":1280}' && JSON.stringify(jpegSize(jpegOf(640, 640, 0xc2))) === '{"height":640,"width":640}')
check('not from a table, a PNG, a cut header or nothing', jpegSize(Buffer.from([0xff, 0xd8, 0xff, 0xc4, 0, 4, 0, 0, 0, 0, 0, 0])) === null && jpegSize(Buffer.from('\x89PNG\r\n\x1a\n0000000000')) === null && jpegSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0])) === null && jpegSize(Buffer.alloc(0)) === null)

console.log(`\n${pass} ✓  ${fail} ✗`)
process.exit(fail === 0 ? 0 : 1)
