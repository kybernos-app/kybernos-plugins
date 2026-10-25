// Installs the proxy-free HTTP client factory (modules/kybernos-host/android/.../LoopbackNetwork.kt) as the first thing the application does: Expo's fetch module builds its OkHttp client in its own
// OnCreate, so a module cannot get in front of it, but Application.onCreate runs before any of them.
const { withMainApplication } = require('expo/config-plugins')

const CALL = 'expo.modules.kybernoshost.LoopbackNetwork.install()'

module.exports = (config) =>
  withMainApplication(config, (c) => {
    const src = c.modResults.contents
    if (src.includes(CALL)) return c
    if (!/super\.onCreate\(\)/.test(src)) throw new Error('with-no-proxy-client: no super.onCreate() in MainApplication, cannot place the call')
    c.modResults.contents = src.replace(/super\.onCreate\(\)\n/, 'super.onCreate()\n    ' + CALL + '\n')
    return c
  })
