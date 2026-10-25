// What differs between an iPhone and an Android phone in a device-cloud session: the Appium capabilities, the app-state numbers, the commands for Home and for coming back, and where the
// app's on-screen self-test and start-up text show up in the page source. Pure functions plus tables, so they are tested without a device (test-platforms.mjs).
const unescapeXml = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, '\n').replace(/&amp;/g, '&')
const WEB_PAGE = /Welcome to Kybernos|Get started|One sentence is enough|Preview Notice/

export const PLATFORMS = {
  ios: {
    label: 'iOS',
    defaultDevice: 'iPhone 18 Pro', defaultOs: '27', appId: 'app.kybernos.host',
    // XCUITest: app states 1 not running, 2 background suspended, 3 background, 4 foreground
    states: { 1: 'not running', 2: 'background, suspended', 3: 'background', 4: 'foreground' },
    capabilities: ({ device, osVersion, appUrl }) => ({ platformName: 'ios', 'appium:deviceName': device, 'appium:platformVersion': osVersion, 'appium:automationName': 'XCUITest', 'appium:app': appUrl, 'appium:autoAcceptAlerts': true }),
    // each control is a list of alternatives, tried in order until one does not answer with an error: { script, args } is Appium's `mobile:` execute, { path, body } a session endpoint
    queryState: (id) => [{ script: 'mobile: queryAppState', args: [{ bundleId: id }] }],
    goHome: () => [{ script: 'mobile: pressButton', args: [{ name: 'home' }] }],
    comeBack: (id) => [{ script: 'mobile: activateApp', args: [{ bundleId: id }] }],
    labelMeansReady: false,
    // the page source lists each native view with a `label`
    bootText: (xml) => { const m = /label="([^"]*(?:First launch|Starting|engine stopped)[^"]*)"/.exec(xml); return m ? unescapeXml(m[1]) : null },
    selfTestText: (xml) => { const m = /label="(selftest:[^"]*)"/.exec(xml); return m ? unescapeXml(m[1]) : null },
    pageUp: (xml) => WEB_PAGE.test(xml),
    // the boot screen's diagnostics block, which starts with a fixed marker
    engineLog: (xml) => { const m = /label="(engine log:[^"]*)"/.exec(xml); return m ? unescapeXml(m[1]) : null },
    // iOS suspends a backgrounded app within a minute: that is part of what the run shows
    expectsSuspension: true,
  },
  android: {
    label: 'Android',
    defaultDevice: 'Google Pixel 9', defaultOs: '15.0', appId: 'app.kybernos.host',
    // UiAutomator2: 0 not installed, 1 not running, 3 running in the background, 4 running in the foreground
    states: { 0: 'not installed', 1: 'not running', 3: 'background', 4: 'foreground' },
    capabilities: ({ device, osVersion, appUrl }) => ({ platformName: 'android', 'appium:deviceName': device, 'appium:platformVersion': osVersion, 'appium:automationName': 'UiAutomator2', 'appium:app': appUrl, 'appium:autoGrantPermissions': true }),
    // BrowserStack's Appium 1.22 knows none of `mobile: queryAppState`, `pressKey`, `activateApp`: the older session endpoints do the same (found on a Pixel 9 run)
    queryState: (id) => [{ path: '/appium/device/app_state', body: { appId: id, bundleId: id } }],
    goHome: () => [{ path: '/appium/device/press_keycode', body: { keycode: 3 } }, { script: 'mobile: shell', args: [{ command: 'input', args: ['keyevent', '3'] }] }],
    comeBack: (id) => [{ path: '/appium/device/activate_app', body: { appId: id, bundleId: id } }, { script: 'mobile: startActivity', args: [{ component: id + '/.MainActivity' }] }],
    // the web page's own text is not in UiAutomator2's page source: the self-test label under it is what shows the page, and the engine behind it, came up
    labelMeansReady: true,
    // the page source lists each native view with `text` and `content-desc`
    bootText: (xml) => { const m = /(?:text|content-desc)="([^"]*(?:First launch|Starting|engine stopped)[^"]*)"/.exec(xml); return m ? unescapeXml(m[1]) : null },
    selfTestText: (xml) => { const m = /(?:text|content-desc)="(selftest:[^"]*)"/.exec(xml); return m ? unescapeXml(m[1]) : null },
    pageUp: (xml) => WEB_PAGE.test(xml),
    engineLog: (xml) => { const m = /(?:text|content-desc)="(engine log:[^"]*)"/.exec(xml); return m ? unescapeXml(m[1]) : null },
    expectsSuspension: false,
  },
}

/** `selftest: due 10:48 UTC | fired at 10:48:15 UTC` -> the due and fired times as minutes and seconds of the day, or null. */
export const parseSelfTestTimes = (line) => {
  const due = /due (\d\d):(\d\d) UTC/.exec(line ?? '')
  const fired = /fired at (\d\d):(\d\d):(\d\d) UTC/.exec(line ?? '')
  return { dueS: due ? +due[1] * 3600 + +due[2] * 60 : null, firedS: fired ? +fired[1] * 3600 + +fired[2] * 60 + +fired[3] : null }
}
