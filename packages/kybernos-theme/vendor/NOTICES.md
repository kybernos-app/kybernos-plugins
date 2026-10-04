# Third-party notices: `kybernos-theme/vendor/`

One third-party file lives here. (A frozen copy of Catppuccin, Rosé Pine and Selenized palettes used to be
here for a colour compiler that was never wired in; it was removed as dead code and is recoverable from
git history, with its licenses, if the compiler is ever built.)

## Lottie runtime: `lottie_light.min.js`

| Local file | Upstream source | License | Version |
|---|---|---|---|
| `lottie_light.min.js` | https://cdnjs.cloudflare.com/ajax/libs/bodymovin/5.12.2/lottie_light.min.js (build of https://github.com/airbnb/lottie-web) | MIT | lottie-web 5.12.2, unmodified |

SHA-256: `23cd2c01be3d4da8bb664645d03afaff40879c62dc5f8dfe075ab3aa35c108f3`

It plays the Lottie animations a user imports as thinking loaders. The light build has no
expression engine, so an imported file cannot run code. It is served by the host plugin at
`/kybernos-theme/vendor/lottie.js`; nothing is fetched from a CDN at run time.

License text, as published with lottie-web 5.12.2 (`LICENSE.md`):

```
The MIT License (MIT)

Copyright (c) 2015 Bodymovin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
