// The Node library is built for arm64 only (the embedded engine is 95 MB per architecture): build React Native for arm64 too, or the APK carries three unused copies of its libraries.
const { withGradleProperties } = require('expo/config-plugins')

module.exports = (config) =>
  withGradleProperties(config, (c) => {
    c.modResults = c.modResults.filter((p) => !(p.type === 'property' && p.key === 'reactNativeArchitectures'))
    c.modResults.push({ type: 'property', key: 'reactNativeArchitectures', value: 'arm64-v8a' })
    return c
  })
