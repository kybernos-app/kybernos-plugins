# Vendored code of `@local/kybernos-catalog`

## MapLibre GL JS 5.24.0 — BSD 3-Clause License

- files: `vendor/maplibre-gl.js` (the official UMD build, with the worker inlined) and `vendor/maplibre-gl.css`, both as published, not edited
- licence text: `vendor/MAPLIBRE-LICENSE` (the package's own `LICENSE.txt`: MapLibre contributors, the Mapbox 1.13 code it descends from, glfx.js, d3-color and the other notices it carries)
- source: the npm tarball https://registry.npmjs.org/maplibre-gl/-/maplibre-gl-5.24.0.tgz (published 2026-04-23, the last 5.x release), taken from the official registry only
- tarball integrity (npm): `sha512-ALyFxgtd5R+65UqZ/++lOqwWcC0SNho9c27fYSyLmG7AfnAul2o46F05aDJGPbFU57wos9dgcIySHs0Xe6ia3A==` (sha1 `a8059371cdbeb04a62850ccc22cb37783928a10d`)
- sha256 of the files:
  - `maplibre-gl.js`  `45a9b07a9189ce56054c620a947ccf41e291e58c95e9b61533b740aaa65ee5cb`
  - `maplibre-gl.css` `ab1e70d59ec40465bae7e7030da2f3ccf28133fd502e62bd598eefbadfd7a732`
  - `MAPLIBRE-LICENSE` `ee5fc05a0677eaf69601d2c7db0d9ecd6cc27c3abc1d0733bc9ed34707cf8ef2`
- copyright: (c) 2023 MapLibre contributors; portions (c) 2020 Mapbox

What it is used for: the Map view of the Catalog page (real-estate template). The host half serves the two files at `/kybernos-catalog/vendor/maplibre-gl.js` and `/kybernos-catalog/vendor/maplibre-gl.css`; the page loads them only when the person opens the Map view. The library makes no request of its own: the only host the Map view talks to is `tiles.openfreemap.org` (style, vector tiles, fonts), named in the page's code and in `plugin.json` as `net:tiles.openfreemap.org`.

To update: take a newer tarball from the npm registry, replace the three files, recompute the hashes above, run `node packages/kybernos-catalog/test-vendor.mjs` (it checks the hashes) and look at the Map view in a sandbox.
