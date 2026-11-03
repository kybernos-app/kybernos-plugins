Third-party code bundled in this folder (single-file ES modules for Node, built once with esbuild; do not edit by hand).

- `parse5.mjs`: parse5 7.3.0 (MIT, copyright 2013-2019 Ivan Nikulin) with its dependency entities 6.0.1 (BSD-2-Clause, copyright Felix Boehm).
- `postcss.mjs`: PostCSS 8.5.32 (MIT, copyright Andrey Sitnik) with nanoid 3.3.20 (MIT, copyright Andrey Sitnik), picocolors 1.1.1 (ISC,
  copyright 2021-2024 Oleksii Raspopov, Kostiantyn Denysov, Anton Verinov) and source-map-js 1.2.2 (BSD-3-Clause, copyright 2009-2011 Mozilla Foundation and contributors).

Recipe (a scratch folder, nothing of it is kept):

    npm install parse5@7.3.0 postcss@8.5.32 esbuild
    esbuild node_modules/parse5/dist/index.js --bundle --format=esm --platform=node --minify --legal-comments=none --outfile=parse5.mjs
    esbuild node_modules/postcss/lib/postcss.mjs --bundle --format=esm --platform=node --minify --legal-comments=none \
      --banner:js="import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" --outfile=postcss.mjs

Why: the editor must change one character of a page and leave every other byte alone, so it needs the positions parse5 gives for every element
and the lossless stylesheet round trip of PostCSS. Both licences require the copyright notice and the permission text to travel with the code;
each package's LICENSE file says the same in full.
