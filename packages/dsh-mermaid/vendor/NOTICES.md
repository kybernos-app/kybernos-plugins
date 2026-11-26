# Third-party components

## mermaid

- Version: 11.14.0
- License: MIT, Copyright (c) 2014 - 2022 Knut Sveidqvist
- Source: npm package `mermaid` (ESM bundle `dist/mermaid.core.mjs` via its entry point)
- Use: rendering of the diagrams in ```mermaid fences.
- Derived file: `vendor/mermaid.iife.js`, a minified IIFE bundle produced by
  `scripts/build.mjs` with esbuild (`--format=iife --global-name=__DSH_MERMAID_NS`).
  Rebuildable offline: `node scripts/build.mjs`.

The vendored file is a build artifact: it is never edited by hand.
The MIT license text of mermaid ships with the original npm package.

## Libraries bundled inside mermaid.iife.js

esbuild runs with `legalComments: 'none'`, so the bundle carries no license banners.
The bundle also contains mermaid's own npm dependencies. Copyright lines below are
taken from each npm package's LICENSE file at the version mermaid 11.14.0 declares
(or the version found in the bundle, where noted).

Found in the bundle by their code signatures:

| Library | License | Copyright |
|---|---|---|
| KaTeX 0.16.45 (math rendering) | MIT | (c) 2013-2020 Khan Academy and other contributors |
| DOMPurify 3.4.2 (HTML sanitizing) | MPL-2.0 OR Apache-2.0, used here under Apache-2.0 | 2025-2026 Dr.-Ing. Mario Heiderich, Cure53 |
| Cytoscape.js 3.33.3 | MIT | (c) 2016-2026 The Cytoscape Consortium |
| cytoscape-cose-bilkent | MIT | (c) 2016-2018 The Cytoscape Consortium |
| cytoscape-fcose | MIT | (c) 2018 - present iVis-at-Bilkent |
| dagre-d3-es | MIT | (c) 2013 Chris Pettitt (dagre-d3); (c) 2012-2014 Chris Pettitt (dagre, graphlib); (c) 2022-2024 Thibaut Lassalle, David Newell, Alois Klink, Sidharth Vinod and dagre-es contributors |
| Day.js | MIT | (c) 2018-present iamkun |
| lodash-es | MIT | (c) OpenJS Foundation and other contributors (based on Underscore.js, (c) Jeremy Ashkenas) |
| marked | MIT | (c) 2018+ MarkedJS; (c) 2011-2018 Christopher Jeffrey |
| Rough.js | MIT | (c) 2019 Preet Shihn |
| Langium (via @mermaid-js/parser) | MIT | (c) 2021 TypeFox GmbH |
| Chevrotain (via Langium) | Apache-2.0 | Shahar Soel and contributors |

Declared dependencies of mermaid 11.14.0 that minification makes impossible to
identify one by one (bundled by esbuild, listed here for completeness):

| Library | License | Copyright |
|---|---|---|
| @mermaid-js/parser | MIT | (c) 2023 Yokozuna59 |
| khroma | MIT | (c) 2019-present Fabio Spampinato, Andrew Maney |
| stylis | MIT | (c) 2016-present Sultan Tarimo |
| ts-dedent | MIT | (c) 2018 Tamino Martinius |
| uuid | MIT | (c) 2010-2020 Robert Kieffer and other contributors |
| @braintree/sanitize-url | MIT | (c) 2017 Braintree |
| @iconify/utils | MIT | (c) 2021-PRESENT Vjacheslav Trushkin |
| @upsetjs/venn.js | MIT | (c) 2013 Ben Frederickson; (c) 2021 Samuel Gratzl |
| d3 (modules) | ISC | (c) 2010-2023 Mike Bostock |
| d3-sankey | BSD-3-Clause | (c) 2015 Mike Bostock |

Not listed one by one, to verify at the next rebuild: the transitive dependencies of
Langium and Chevrotain (`vscode-languageserver*`, `vscode-uri`, `chevrotain-allstar`,
`@chevrotain/*`) and the small d3 helpers (`internmap`, `delaunator`,
`robust-predicates`).

## Own contributions

Everything else (DOM hook, `--dsw-*` token theming, cards, error handling) is original
and licensed under Apache-2.0, like the rest of this repository (see `LICENSE` and `NOTICE`
at the repository root).
