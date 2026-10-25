# Kybernos mobile app (React Native, iOS and Android): plan and test strategy

Status: written 2026-10-25. M0 and M1 (iOS) and M2 are done and measured (section 3); M2 (Android shell) is done on the emulator; M3 onwards are not started. Measured facts are marked as such; everything else is an estimate or a recommendation.

## 0. Where we are (measured)

- A first Swift host (no Xcode project, no CocoaPods; in git history before the commit that removed it, since the React Native app replaced it) embedded Node 24.22.1 (fogtape build, jitless V8, full ICU, WebAssembly through polywasm) and runs the real DSH 0.2.1-rc.2 engine with our plugins from one 54.5 MB payload (`mobile/payload`, kbpack format, 30,432 files, 329 MB unpacked).
- iOS simulator (iPhone 18 Pro, iOS 27): first-launch unpack about 9 s, web page up in 17 to 28 s, automations fire on time, a real Claude answers through HTTPS, tool calls work with processes refused (in-process `rg`, in-process `bash`, MCP over a loopback door).
- Real iPhone 18 Pro, iOS 27, BrowserStack (three sessions): ad-hoc signed IPA installs (BrowserStack re-signs), unpack about 4 s, page on screen 10.9 to 12.6 s after launch, app suspended 30 to 45 s after Home, a task due during the suspension fires at the second the app returns, a real Claude answer arrives within 5 s of the return.
- Not measured yet: memory on a device, any Android embedded run, background wakes (BGTask, foreground service), App Store review.
- Everything lives on the local branch `feature/mobile-host` (not pushed). The device-cloud runners are in `mobile/devicecloud`.

## 1. Decisions (D1 to D3 settled 2026-10-25, the rest open; recommendation first)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Flavor | **Expo prebuild + development client + Expo Modules API** for the native module. Bare React Native CLI works too; both need CocoaPods on iOS. Expo gives autolinking, Swift and Kotlin module scaffolding and EAS Build later. **Decided 2026-10-25 (owner: "ok pour tes reco").** |
| D2 | Where the app lives | **This public repo, folder `mobile/`** (the host and the shell are open core; paid modules stay in the private repo and join the payload at build time). **Decided 2026-10-25 (owner: "ok pour tes reco").** |
| D3 | Name of the compatibility plugin (`packages/kybernos-no-process`, in-process replacements for subprocess, sandbox and MCP) | `kybernos-no-process` (says what it is for). Renamed to `packages/kybernos-no-process` on 2026-10-25. **Decided 2026-10-25 (owner: "ok pour tes reco").** |
| D4 | Apple Developer Program (99 USD a year) | Not needed until TestFlight. Until then simulator plus BrowserStack (which re-signs). |
| D5 | Google Play developer account (25 USD once) | Not needed until internal testing; sideloaded APK before. |
| D6 | Minimum OS | iOS 16 (current build). Android: to confirm from the fogtape Android build (its minimum API and its 16 KB page-size status). |
| D7 | Model keys in v1 | The user's own key, stored in Keychain / Keystore and injected into the engine environment at start; the Kybernos account route when the server side is ready. Never in a file. |
| D8 | Bundle ids and app name | `app.kybernos.host` and "Kybernos" are placeholders. |
| D9 | BrowserStack plan | The free trial has a few minutes only (the quota is not shown by their API). Real-device runs at scale need a paid plan; LambdaTest refused scripted sessions on its plan. |

## 2. Architecture

```
React Native (TypeScript)                 native module KybernosHost (Swift / Kotlin)
  Boot screen, Settings, Log, Files  <->    NodeRunner (thread, 16 MB stack, node_start)
  WebView -> http://127.0.0.1:<port>        PayloadManager (bootstrap.mjs unpacks once per version)
                                            Supervisor (progress, sign-in address, readiness, health check)
                                            Lifecycle (background task, foreground service on Android)
                                                    |
                                       embedded Node 24 (jitless) -> DSH engine -> our plugins
                                       kybernos-no-process: subprocess, sandbox, rg, just-bash, MCP door
```

- The native module (`mobile/app/modules/kybernos-host`) is a port of the first Swift host; its native surface is thin (`start(port)`, `status()`, `exitCode()`, `logTail(bytes)`, `writeSelfTestResult(text)`) and the state machine `{ starting | unpacking | booting | ready | failed }` is TypeScript (`src/supervisor.ts`), so it is unit-tested without a device.
- `node_start` runs once per process: a stopped Node stays stopped until the app is relaunched (surface it in the UI, never loop).
- iOS: the host already handles the roughly 30 s of background time and the check on return. Android: the engine runs inside the app process (no child process, so the phantom-process limit that hurt the Termux route does not apply); a foreground service with a notification is the way to keep automations running, WorkManager for opportunistic wakes. Both are opt-in settings.
- WebView user agent carries `KybernosHost/<version> (ios|android)`; our plugins use it to show the mobile experience: a plain statement that automations run while the app is open and catch up on return, a pointer to cloud computers for always-on work, and no desktop-only controls.
- The payload is shared by both platforms (JavaScript); the shims differ only where `process.platform` differs (`ios`, `android`). Native node libraries come from fogtape (`ios-arm64`, `android` arm64-v8a).
- Secrets: Keychain / Keystore; injected into the engine environment at start; never written to disk, never logged (the host redacts `token=` in the log viewer; add `sk-ant-` and `sk-` patterns).

## 3. Milestones, each with acceptance tests

**M0, prerequisites (DONE 2026-10-25, about two hours of wall clock).** Needs the owner's approval for the downloads in section 6. Install CocoaPods (Homebrew), create the React Native project under `mobile/app`, check that Gradle can resolve its dependencies again (the Gradle cache was cleaned on 2026-10-25). Accept: `npx expo prebuild` succeeds, an empty app runs in the iOS simulator and in the Android emulator (`android-36` image already installed). Result: CocoaPods 1.17.0 (Homebrew, with its own Ruby 4.0), Expo SDK 58 / React Native 0.88 under `mobile/app`, iOS Release build 1.5 min, Android Release build 6 min 53 s with the Gradle dependencies downloaded again, the empty app runs on the iPhone 18 Pro simulator and on the `socrate_emu` Android 16 (API 36) emulator.

**M1, iOS shell (DONE 2026-10-25 on the simulator; and on a real iPhone 18 Pro iOS 27 through BrowserStack, 2026-10-25: page on screen 12.6 s after launch, app suspended 45 s after Home, the overdue automation fired on return with a 6 s catch-up).** Port NodeHost and Supervisor into an Expo module, Boot screen, WebView, self-test hook behind a build flag. Accept: on the simulator the numbers of section 0 are reproduced (unpack at most 15 s, page at most 30 s), `mobile/tests/sim-ios.sh` is green, Jest suites are green. Result: first launch 11.4 s from launch to the page, warm relaunch 9.1 s, the self-test automation fires, data kept across a kill, app 173 MB with the 55 MB payload, 17 Jest tests and the typecheck green. Traps found: the Node framework has no x86_64 simulator slice, so the build needs `ARCHS=arm64 ONLY_ACTIVE_ARCH=YES` (otherwise CocoaPods silently skips copying it and Swift cannot find `NodeMobile`); the minimum iOS is now 16.4 (React Native 0.88), not 16.0; the same bundle id `app.kybernos.host` as the Swift host, so installing one replaces the other.

**M2, Android shell (DONE 2026-10-25 on the emulator; real Android device through BrowserStack still to run).** Kotlin module, fogtape Android library in `jniLibs/arm64-v8a`, thread with a large stack, same bootstrap and payload. Accept: page up on the emulator and on a BrowserStack real Android device, self-test passes, no crash in `logcat`. Result on the `socrate_emu` emulator (Android 16, arm64): first launch 9.0 s from launch to the page (the payload is copied out of the APK assets first), warm relaunch 6.4 s, the self-test automation fires, the first automation is still listed after a force-stop, `mobile/tests/emu-android.sh` PASS. Release APK 163 MB (arm64 only: libnode.so 95 MB stripped, payload 54 MB). Facts: `libnode.so` exports only the C++ `node::Start`, so a 40 KB JNI shim (`libkybernos_node.so`) starts it on a pthread with a 16 MB stack; it is 16 KB page aligned and needs `libc++_shared.so`; React Native must be built for arm64 only (`reactNativeArchitectures`) or the APK is 208 MB; cleartext HTTP needs a network security config allowing 127.0.0.1; a release APK is not debuggable, so results are read from the app's external files folder. Real phone 24115RA8EG (HyperOS, Android 16, arm64, 4 KB pages, USB install confirmed by its owner): first launch 21.0 s to the page, warm relaunch 20.8 s, the self-test automation fires, data kept (the emulator is 2 to 3 times faster). First BrowserStack Android run (Pixel 9, Android 16) FAILED and found a real bug: a device-cloud phone has a system proxy that answers 503 to loopback requests, React Native's fetch followed it and the boot screen waited for ever while the engine was up. Fixed by a proxy-free OkHttp client installed in `Application.onCreate` (`plugins/with-no-proxy-client.js`; Expo's fetch module builds its client in its own OnCreate, so a module hook is too late), tested by emulator scenario S6 (a stub proxy answering 503). Third BrowserStack run (Pixel 9, Android 16, 2026-10-25, 173 s) CONFIRMED the fix: the page came up (about 19 s after the first look), the self-test created its automation and it fired at 12:17:01, one second after due. That run's background test was void (BrowserStack's Appium 1.22 has no `mobile: queryAppState`, `pressKey` or `activateApp`; the runner now uses the older session endpoints and reports refused controls). Fourth run (same device, corrected runner, 151 s) PASSED: Home really pressed (older `press_keycode` endpoint), the app stayed in the background for about 100 s and the automation due during that time FIRED IN THE BACKGROUND at 12:22:05 (5 s after due, 45 s before the app came back): on a Pixel 9 the embedded engine keeps running for at least two minutes without a foreground service (one sample: Android's freezer and Doze are M5's subject). Page on screen 20.8 s after the first look. Not covered yet: longer background periods on Android (M5), memory, the fogtape Android build's minimum API level.

**M3, settings and keys (2 days).** Keychain / Keystore storage, model provider screen (Anthropic key to start), log viewer, file export (share sheet and Android document provider). Accept: a fresh install configures a key by hand and answers a prompt; key absent from disk and logs (scan).

**M4, mobile experience in the plugins (1 to 2 days).** Detection by user agent, banner and automations copy, safe areas, keyboard. Accept: screenshots on three phone sizes and one tablet, `check-hit-targets` style checks on the live page.

**M5, background (2 to 3 days).** Android foreground service option; iOS local notification when a catch-up run finishes. Accept: device-cloud scenario S2 on both platforms; Android service survives ten minutes in the background.

**M6, release path (a week, mostly waiting).** Signing, TestFlight and Play internal testing, iOS privacy manifest, Play data-safety form, review notes for App Store guidelines 2.5.2 and 4.7 (downloaded plugin code; the last sub-rules of 4.7 were not read), third-party notices (just-bash, undici and the other packages). Accept: a TestFlight build installs from the store on a real phone and passes S1 to S3.

## 4. Test strategy

| Layer | Tool | Proves | Runs where |
|---|---|---|---|
| L1 JS unit | Jest, React Native Testing Library (native module mocked) | state machine of the Boot screen, URL and token handling, redaction, settings logic | every PR, seconds |
| L2 native unit | XCTest (Xcode project from prebuild), JUnit | log tail, status parsing, supervisor transitions against a fake server, key storage | Mac / CI Mac, minutes |
| L3 payload | Node scripts in `mobile/payload` (`test-kbpack.mjs` and `test-boot.mjs` exist) | pack round trip, hostile and truncated archives, unpack, boot of the real engine from the payload with processes refused and a stub model, an automation fired through the real route | Mac, about two minutes (`KB_PAYLOAD_DIR=<payload dir> node mobile/payload/test-boot.mjs`, measured: engine up in 15 s, automation fired and answered in 45 s); not in the default CI (needs the 835 MB engine tree) |
| L4 simulator / emulator | `mobile/tests/sim-ios.sh`, `emu-android.sh` | install, launch, self-test label or result file, background and foreground, kill and relaunch | Mac, minutes |
| L5 real devices | BrowserStack App Automate through `mobile/devicecloud` (plain W3C WebDriver calls, no library) | install after re-signing, startup budget, suspension, catch-up, real model answer, screenshots | on demand and nightly, billed minutes |
| L6 gates | scripts | payload at most 70 MB, app at most 200 MB, unpack at most 15 s and page at most 30 s on a device, memory figure recorded per run | with L4 and L5 |
| L7 security | `garde-depot`, key-pattern scan of builds and logs, licence list, cleartext allowed only for loopback (iOS ATS local networking, Android network security config) | no key or personal path ships | every PR |

Design rules for the tests:
- The self-test hook reports through a result file the app writes (`selftest-result.json` in the app container: readable by `simctl get_app_container` and `adb run-as`) as well as the on-screen label that remote drivers read; no OCR.
- Device scenarios: S1 first launch (unpack and ready budgets), S2 background, suspension and catch-up of a due automation, S3 real model answer (a question whose answer is not in the prompt, found afterwards in the chat), S4 kill and warm relaunch, S5 screenshots (boot, onboarding, home, rotation, keyboard).
- Budget guard in every device run: hard stop at 9.5 minutes, uploaded builds always deleted at the end, a run never starts without the owner-set minute budget in `.env`.
- Cost control: macOS CI minutes are expensive (see the CI minutes work of 2026-10-15); L2 and L4 run on demand or nightly, not per push.

## 5. Keys and `.env`

`mobile/.env` is git-ignored (and so are `.env.*` and `*.env` repo-wide); `mobile/env.example` lists the names. Variables: `ANTHROPIC_API_KEY`, `BROWSERSTACK_USERNAME`, `BROWSERSTACK_ACCESS_KEY`, optional `BROWSERSTACK_BUDGET_MINUTES`. Rules: use a throwaway Anthropic key with a low spend limit; the scripts read the file through `mobile/devicecloud/lib.mjs`, which never prints values; a model key reaches a device only inside an ephemeral test build (Info.plist key of a copy) that is deleted from the device cloud and from disk when the run ends, and the key is revoked afterwards.

## 6. Environment and downloads (each needs the owner's approval before it happens)

Present: Xcode 27.1 with the iOS 27.1 SDK and simulator runtime, Android command-line tools with platforms 34 to 36, build-tools 35 and 36, NDK 28.2, emulator and an `android-36` system image, JDK 17, Node 26, 18 GB of free disk.
Missing: CocoaPods and a Ruby newer than the system 2.6 (Homebrew), Gradle dependencies (re-download after the cache cleanup), the React Native / Expo packages, the fogtape Android build.

| Download | Source | Size (estimate) |
|---|---|---|
| CocoaPods and a recent Ruby | Homebrew | a few hundred MB |
| React Native / Expo project dependencies | npm registry | 0.6 to 1 GB in `node_modules` |
| Pods for the iOS project | CocoaPods CDN, GitHub | 0.5 to 1 GB |
| Gradle dependencies | Maven Central, Google | 2 to 4 GB |
| fogtape Android library `24.22.1-0` | GitHub releases | 113 MB (72 MB lite) |

Disk need for the first full build of both platforms: about 10 GB; free: 18 GB.

## 7. Risks

- Memory: the engine measured 190 to 460 MB resident in the simulator and a WebView plus React Native add to it; the real figure on a device is unknown. Mitigation: record it in every device run, keep the profile lean (the phone profile has 43 bundles), consider the increased-memory-limit entitlement.
- App Store: guideline 2.5.2 (no downloaded code that changes features) against 4.7 (JavaScript plug-ins are allowed under conditions, no native API exposure without permission, no sharing of privacy permissions without consent). Only a submission settles it; TestFlight external review is the first signal.
- Android: the fogtape Android build's page-size support (16 KB), process lifetime under Doze, the foreground-service permission text.
- Engine on a phone: single `node_start` per process; a crash needs a relaunch; MCP servers that wrap programs (language servers, CLIs, browsers) cannot run and must be remote.
- Device-cloud coverage: iOS 27 is offered by BrowserStack and LambdaTest today; free plans may refuse scripted sessions.
- Scope: React Native is a thin shell here (the DSH web UI is the product surface); resist rebuilding screens natively before the web UI proves insufficient.

## 8. Next actions

1. Owner: say go for a BrowserStack Android run of the fixed build (`node mobile/devicecloud/run.mjs --platform android`) and, separately, whether the model key may travel in a test build (`--model`).
2. M2 (Android shell: Kotlin module, fogtape Android library, 113 MB download to authorise), then M3 to M6.
