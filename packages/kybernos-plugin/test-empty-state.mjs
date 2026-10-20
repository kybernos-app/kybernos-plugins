#!/usr/bin/env node
// An empty list teaches (UX audit 2026-10-20): KbEmptyState of client.js, cut out and run with a fake `h`, and the project's tabs
// checked at source level. No browser.
//
//   node packages/kybernos-plugin/test-empty-state.mjs
//
// Pinned because an empty tab used to be a dashed box with one sentence (and « budget: block of kyber.yml » in it): no picture, no way to
// add the first item. It now has a small drawing, a title, one sentence and, when there is a real action, a button.
import { readFileSync } from 'node:fs'

let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) console.log('  ✓ ' + name)
  else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const a = SRC.indexOf('// <kb-empty-state>')
const b = SRC.indexOf('// </kb-empty-state>', a)
if (a < 0 || b < a) { console.log('  ✗ cannot cut KbEmptyState out of client.js'); process.exit(1) }
const h = (type, props, ...kids) => ({ type, props: props || {}, kids: kids.flat().filter((k) => k !== null && k !== undefined) })
const KbEmptyState = new Function('h', SRC.slice(a, b) + '\nreturn KbEmptyState')(h)
const walk = (n, out = []) => { out.push(n); for (const k of n.kids || []) if (typeof k === 'object') walk(k, out); return out }
const text = (n) => walk(n).flatMap((x) => (x.kids || []).filter((k) => typeof k === 'string')).join(' ')

console.log('the component')
{
  let ran = 0
  const full = KbEmptyState({ kb: 'x-empty', title: 'No document yet', text: 'Files you send show up here.', action: { act: 'new-chat', label: 'Open a chat', run: () => { ran += 1 } } })
  const nodes = walk(full)
  check('it carries the hook the live checks select on', full.props['data-kb'] === 'x-empty')
  check('it draws a picture, hidden from assistive tech', nodes.some((n) => n.type === 'svg' && n.props['aria-hidden'] === 'true'))
  check('it says what this is and what lives here', text(full).includes('No document yet') && text(full).includes('Files you send show up here.'))
  const btn = nodes.find((n) => n.type === 'button')
  check('it offers the way to add the first one, a real button', btn !== undefined && btn.props.type === 'button' && btn.props['data-act'] === 'new-chat' && text(btn) === 'Open a chat')
  btn.props.onClick()
  check('the button runs the action it was given', ran === 1)
  const bare = KbEmptyState({ title: 'No connector yet', text: 'Nothing here.', action: null })
  check('without an action there is no button (never a button that does nothing)', !walk(bare).some((n) => n.type === 'button') && bare.props['data-kb'] === 'empty-state')
}

console.log('the project tabs')
{
  const tabs = ['project-threads-empty', 'project-docs-empty', 'project-goals-empty', 'project-deliv-empty', 'project-skills-empty', 'project-conns-empty', 'project-budget-empty']
  for (const t of tabs) check('the ' + t.replace('project-', '').replace('-empty', '') + ' tab uses the empty state', SRC.includes("kb: '" + t + "'"))
  const budget = SRC.slice(SRC.indexOf("kb: 'project-budget-empty'"), SRC.indexOf("kb: 'project-budget-empty'") + 700)
  check('the budget tab no longer talks about a file or a block', !/kyber\.yml|budget:/.test(budget), budget.slice(0, 200))
  check('every empty tab has both languages (kbe with its French)', (SRC.match(/emptyX\(\{[^\n]*title: kbe\('[^']+', '[^']+'\)/g) || []).length >= 5)
  check('the plain dashed box is gone from the project tabs', !/empty\(projLoading === true \? PROJ_LOADING : kbe\('No (thread|document|ongoing goal|budget)/.test(SRC))
}
process.exit(fail === 0 ? 0 : 1)
