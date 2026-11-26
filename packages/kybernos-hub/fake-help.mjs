// The part of the Suite's help (window.__KB_HELP__) that a page test needs, on the test's own React: a Help of the test's making (it records what the page
// hands it) and a Title that draws like the hub's real one (kybernos-hub `Title`): the heading in the shared class, then the button, in one head.
//   __KB_HELP__: fakeHelp(React, (p) => React.createElement('i', { 'data-help-id': p.id }))
// A page that gets its title through the Suite is drawn the same way here as on the screen, so a test reads the same markup.
export const fakeHelp = (React, Help) => {
  const Title = (p) => React.createElement('div', { className: 'kbhp-head', 'data-kb': 'page-head' },
    React.createElement(typeof p.as === 'string' && p.as !== '' ? p.as : 'h2', { className: 'kbhp-title' + (p.className ? ' ' + p.className : ''), 'data-kb': 'page-title' }, p.title),
    p.id === undefined ? null : React.createElement(Help, p))
  return { Help, Title }
}
