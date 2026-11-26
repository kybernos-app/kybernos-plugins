#!/usr/bin/env node
// Which sidebar row is the selected one (audit V-01): kbMenuShown of client.js, cut out and run alone, and the rows of SalesMenu
// checked at source level. No browser.
//
//   node packages/kybernos-plugin/test-menu-active.mjs
//
// Pinned here because the rows used to read only the page the store holds (`s.view`). Opening Kaby's chat leaves the store alone, so
// « Dashboards » stayed bold and coloured while Kaby's chat was on screen and « Kaby » was never marked. The rows now follow the layout's
// selected panel: a page row is selected only while our panel is on screen, and Kaby's row is when the chat on screen is Kaby's.
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const a = SRC.indexOf('// <kb-menu-active>')
const b = SRC.indexOf('// </kb-menu-active>', a)
if (a < 0 || b < a) { console.log('  ✗ cannot cut the menu helper out of client.js'); process.exit(1) }
const { kbMenuShown } = new Function(SRC.slice(a, b) + '\nreturn { kbMenuShown }')()

console.log('a page of ours is on screen: the store says which row')
{
  check('Dashboards is selected on its page', kbMenuShown('kybers', 'dashboards', false) === 'dashboards')
  check('and still is when Kaby\'s pointer is known (a page is not a chat)', kbMenuShown('kybers', 'dashboards', true) === 'dashboards')
  check('no page held by the store: the Agent Teams default is left to the rows', kbMenuShown('kybers', undefined, false) === undefined && kbMenuShown('kybers', null, false) === null)
}

console.log('a chat is on screen: no page row is selected, Kaby\'s row is when the chat is Kaby\'s')
{
  const inChat = kbMenuShown(null, 'dashboards', false)
  check('Dashboards (held by the store since the person left it) is not selected in an ordinary chat', inChat !== 'dashboards')
  check('nor the Agent Teams default', inChat !== undefined && inChat !== null && inChat !== 'gallery' && inChat !== 'kybers')
  check('Kaby\'s chat selects the Kaby row, and not Dashboards', kbMenuShown(null, 'dashboards', true) === 'kyber')
  check('Kaby\'s chat selects it from a clean start too', kbMenuShown(null, undefined, true) === 'kyber')
}

console.log('another panel (the engine\'s own page) is on screen')
{
  const other = kbMenuShown('plugins', 'dashboards', true)
  check('no row of ours is selected, not even Kaby (the chat behind is not on screen)', other !== 'dashboards' && other !== 'kyber')
}

console.log('an engine that gives no panel keeps the old reading')
{
  check('the store\'s page is shown as before', kbMenuShown(undefined, 'skills', false) === 'skills')
}

console.log('the rows read it')
{
  const m = SRC.indexOf('const SalesMenu = ')
  const end = SRC.indexOf("// ── menu maquette : au-dessus des workspaces", m)
  const menu = SRC.slice(m, end)
  check('SalesMenu asks the layout which panel is on screen and which chat', /usePanelInfo/.test(menu) && /isKybySession/.test(menu))
  const raw = menu.replace('kbMenuShown(panelId, s.view, kabyChat)', '')
  check('no row reads the store\'s page directly any more (s.view): only kbMenuShown does', !/\bs\.view\b/.test(raw), raw.match(/.{40}\bs\.view\b.{40}/) && raw.match(/.{40}\bs\.view\b.{40}/)[0])
  check('every row\'s selected state comes from it', (menu.match(/\bshown\b/g) || []).length >= 11)
  check('the Kaby row is told when Kaby\'s chat becomes known (the pointer is read after the first render)', /kb-kyby-session/.test(menu))
}

console.log(pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
