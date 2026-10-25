import assert from 'node:assert/strict'
import { PLATFORMS, parseSelfTestTimes } from './platforms.mjs'

const ios = PLATFORMS.ios; const android = PLATFORMS.android
const iosXml = '<XCUIElementTypeStaticText label="Starting the engine…"/><XCUIElementTypeStaticText label="selftest: due 10:48 UTC | fired at 10:48:15 UTC | answer check: &quot;Canberra&quot; found 1x"/>'
assert.equal(ios.bootText(iosXml), 'Starting the engine…')
assert.equal(ios.selfTestText(iosXml), 'selftest: due 10:48 UTC | fired at 10:48:15 UTC | answer check: "Canberra" found 1x')
assert.equal(ios.selfTestText('<x label="nothing"/>'), null)
assert.equal(ios.pageUp('<x label="Welcome to Kybernos"/>'), true)

const androidXml = '<android.widget.TextView text="First launch: preparing the runtime (500 of 30432 files)" content-desc=""/><android.widget.TextView text="selftest: created, due 10:48 UTC | waiting" content-desc="selftest: created, due 10:48 UTC | waiting"/>'
assert.equal(android.bootText(androidXml), 'First launch: preparing the runtime (500 of 30432 files)')
assert.equal(android.selfTestText(androidXml), 'selftest: created, due 10:48 UTC | waiting')
assert.equal(android.selfTestText('<android.widget.TextView text="hello"/>'), null)
assert.equal(android.pageUp('<android.view.View text="Get started"/>'), true)

assert.equal(ios.engineLog('<x label="engine log: 40 s, status starting, probe none yet&#10;booting"/>'), 'engine log: 40 s, status starting, probe none yet\nbooting')
assert.equal(android.engineLog('<x text="engine log: 7 s, status copying 2/4"/>'), 'engine log: 7 s, status copying 2/4')
assert.equal(android.engineLog('<x text="hello"/>'), null)
assert.deepEqual(ios.queryState('app.x'), [{ script: 'mobile: queryAppState', args: [{ bundleId: 'app.x' }] }])
assert.deepEqual(ios.goHome(), [{ script: 'mobile: pressButton', args: [{ name: 'home' }] }])
assert.equal(android.queryState('app.x')[0].path, '/appium/device/app_state', 'Appium 1.22 has no mobile: queryAppState')
assert.deepEqual(android.goHome()[0], { path: '/appium/device/press_keycode', body: { keycode: 3 } })
assert.equal(android.goHome()[1].script, 'mobile: shell', 'a second way to press Home when the endpoint is refused')
assert.equal(android.comeBack('app.x')[0].path, '/appium/device/activate_app')
assert.equal(android.comeBack('app.x')[1].args[0].component, 'app.x/.MainActivity')
assert.equal(android.labelMeansReady, true); assert.equal(ios.labelMeansReady, false)
assert.equal(ios.capabilities({ device: 'd', osVersion: '27', appUrl: 'bs://1' })['appium:automationName'], 'XCUITest')
assert.equal(android.capabilities({ device: 'd', osVersion: '15.0', appUrl: 'bs://1' })['appium:automationName'], 'UiAutomator2')
assert.equal(ios.expectsSuspension, true); assert.equal(android.expectsSuspension, false)

assert.deepEqual(parseSelfTestTimes('selftest: due 10:48 UTC | fired at 10:48:15 UTC'), { dueS: 10 * 3600 + 48 * 60, firedS: 10 * 3600 + 48 * 60 + 15 })
assert.deepEqual(parseSelfTestTimes('selftest: created, due 10:48 UTC | waiting'), { dueS: 10 * 3600 + 48 * 60, firedS: null })
assert.deepEqual(parseSelfTestTimes(null), { dueS: null, firedS: null })
console.log('devicecloud platforms: page-source parsing, Appium commands and capabilities for iOS and Android: all checks pass')
