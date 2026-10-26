# Kybernos mobile app (Expo, iOS and Android)

A thin React Native shell: the native module `modules/kybernos-host` (Swift on iOS, Kotlin and a small JNI shim on Android) starts the embedded Node (fogtape build) once per process, the payload (`mobile/payload`) holds the engine and our plugins, and the DSH web interface is shown in a WebView on `127.0.0.1`. Plan and test strategy: `mobile/PLAN.md`.

The repository carries no binaries: the Node framework, the payload and the icon pictures are build inputs, all git-ignored.

```bash
cd mobile/app
npm install                                   # also draws assets/*.png: the Kybernos K (scripts/make-assets.mjs)
npm test && npx tsc --noEmit                  # L1: Jest + typecheck

# build inputs: a payload (mobile/payload/build-payload.mjs) and the Node framework (mobile/ios/fetch-node.sh)
node scripts/stage-native.mjs --payload <payload dir> [--node-xcframework <NodeMobile.xcframework>]

export LANG=en_US.UTF-8
npx expo prebuild --platform ios --no-install && (cd ios && pod install)
cd ios && xcodebuild -workspace Kybernos.xcworkspace -scheme Kybernos -configuration Release -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' -derivedDataPath build/dd ARCHS=arm64 ONLY_ACTIVE_ARCH=YES build

bash ../../tests/sim-ios.sh                   # L4: first launch, self-test automation, warm relaunch
```

**Icon and splash.** `scripts/make-assets.mjs` draws the app icon, the Android adaptive layers (background, foreground, one-colour) and the splash picture from the K's own code: it reads the block `KB-BRAND-CORE` of `packages/kybernos-plugin/client.js` (`scripts/brand-art.mjs`), so the icon cannot drift from the logo. Background `#121217`, the colour of every screen of the app. `app.json` names the same colour for the splash (plugin `expo-splash-screen`). `expo prebuild` copies the pictures into `ios/` and `android/`: after changing them, run `npx expo prebuild --no-install` and rebuild. Test: `node scripts/test-mobile-brand-assets.mjs`.

**First launch.** Native pages before the engine starts, in English or French (the phone's language; `src/i18n.ts`): a splash (the K, `expo-splash-screen`), then once a **welcome** page (`src/WelcomeScreen.tsx`: three rows about the result), then the **agreement** (`src/ConsentScreen.tsx`, neutral about the provider, version `CONSENT_VERSION` in `src/settings.ts`; the engine does not start before it), then a plain **loading** page (`src/LoadingScreen.tsx`: the first-launch percentage, « still starting » after 30 s, a failure in words; the engine's diagnostics, the log and the settings are behind « Details »). These pages never show a scrollbar: their text stops at 115 % of the phone's text size and they step down tier by tier (`src/fit.ts`) until the content fits. The K is `src/BrandMark.tsx` (react-native-svg), guarded against the web client's K by `scripts/test-mobile-brand-assets.mjs`. The model key and the account are then the web wizard's first steps (see `mobile/ACCOUNTS-AND-PURCHASES.md`).

**Licences.** The payload redistributes third-party code, so `mobile/payload/build-payload.mjs` audits every package it ships (`mobile/payload/notices.mjs`: permissive licences only; a package with no licence, `UNLICENSED`, GPL or similar stops the build, and a package that cannot be redistributed is dropped in `DROP_PACKAGE` or its licence is recorded by hand in `OVERRIDES`). It writes `THIRD-PARTY-NOTICES.txt` into the payload; the engine serves it at `/kybernos-mobile/notices` (« The Kybernos app » page, card « Open-source components »). Pass `--node-license <file>` (the Node.js `LICENSE`, with the licences of its bundled components) to include its text; without it the notice carries a link. Our own packages declare Apache-2.0; the name and the K are covered by `TRADEMARK.md`. Test: `node scripts/test-mobile-licences.mjs`.

Android (arm64 only, see `plugins/with-arm64-only.js`):

```bash
bash ../android/fetch-node.sh                 # 108 MB, SHA-256 pinned; once
node scripts/stage-native.mjs --payload <payload dir> --platform android
export JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
npx expo prebuild --platform android --no-install && echo "sdk.dir=$ANDROID_HOME" > android/local.properties
(cd android && ./gradlew assembleRelease)
AVD=<emulator name> bash ../tests/key-android.sh   # M3: key typed in the settings screen, stored in the Keystore, Claude answers, key in no file (spends one small model call)
AVD=<emulator name> bash ../tests/emu-android.sh   # L4: first launch, self-test automation, warm relaunch, and behind a proxy that answers 503 (S6)
ANDROID_SERIAL=<serial> SKIP_INSTALL=1 bash ../tests/emu-android.sh   # the same on a plugged-in phone whose owner confirms each install
```

A release APK is not debuggable, so `adb run-as` cannot read its files: the self-test writes `selftest-result.json` to the app's external files folder (`/sdcard/Android/data/app.kybernos.host/files/`), and the test switches travel as launch-intent extras (`--ei kb_selftest_delay 75 --es kb_deny_spawn 1`). Cleartext HTTP is allowed for 127.0.0.1 only (`plugins/with-loopback-cleartext.js`).

`ARCHS=arm64` matters: the Node framework has no x86_64 simulator slice, and CocoaPods then skips copying it.
A Release build embeds the JavaScript (no Metro needed); use a Debug build and `npx expo start` while editing the screens.
The `ios/` and `android/` folders are generated by `expo prebuild` and never committed.

## Device cloud (BrowserStack)

`mobile/devicecloud/run.mjs` builds a test copy of the app (iOS: an unsigned device build re-signed ad hoc into an IPA, BrowserStack re-signs it; Android: the release APK plus `assets/kb-selftest.json`, aligned and signed with the debug key), uploads it, runs one real-device session (first launch, Home, the automation falling due while the app is in the background, return) and deletes the upload afterwards.

```bash
node mobile/devicecloud/run.mjs --platform ios --dry-run      # builds and signs only: no upload, no BrowserStack key needed
node mobile/devicecloud/run.mjs --platform android            # a real session: spends BrowserStack minutes (BROWSERSTACK_BUDGET_MINUTES caps it)
node mobile/devicecloud/run.mjs --platform ios --model        # also puts ANTHROPIC_API_KEY in the private test copy so the automation ends with a real answer
node mobile/devicecloud/app.mjs devices android               # real devices the plan offers
```

`mobile/.env` holds the keys (see `mobile/env.example`). `--model` needs a throwaway key with a spend limit, revoked afterwards.

## Model key (M3)

The Anthropic key is entered in the app's settings (the gear button, or a `kybernos://settings` link from the web interface; the first launch no longer opens that page by itself), stored in the iOS Keychain / Android Keystore, and handed to the engine as `ANTHROPIC_API_KEY` when it starts: never written to a file. A changed key needs the app closed and reopened. On iOS the Paste button reads the clipboard from code and iOS asks permission for that; press and hold the field and choose Paste always works.

## Links from the web interface

The WebView shows every link to `src/links.ts` (`originWhitelist={['*']}`: react-native-webview otherwise keeps only http(s) and hands the rest to the operating system). The engine's own pages stay in the view, `kybernos://settings` and `kybernos://log` open the app's screens, anything else opens outside the app. The interface tells the app it has its own entry to the settings (`ReactNativeWebView.postMessage`, see `src/webMessage.ts`), and the app then hides its fallback gear button.

## Background (M5)

- **Android**: the settings switch « Keep running in the background » starts a foreground service (`KeepAliveService`, type `specialUse`, with a notification) so the system keeps the engine's process alive; it is off by default and the app restarts it at launch when it is on. `AVD=<emulator> bash mobile/tests/background-android.sh` runs the same automation without and with the service, screen off, deep Doze forced, and reads the process priority (`oom_score_adj`) and when the automation really fired.
- **iOS**: nothing runs while the app is suspended; the switch « Remind me when an automation is due » plans local notifications from the engine's task list (`src/reminders.ts`) when the app leaves the screen and clears them when it returns. The text is generic on purpose.
- **Memory**: the app reports its footprint (`host.memory()`, iOS `phys_footprint`, Android PSS) in the self-test result and label; the device-cloud runner puts it in `result.json`.
