#!/bin/bash
# M3 on an Android emulator: the model key goes in through the settings screen, lives in the Keystore, and reaches the engine without being written anywhere.
#   S7 fresh install: the first-run key screen shows, the key from mobile/.env is typed into it (adb input; never printed) and saved,
#   S8 relaunch with the self-test and NO key in the launch intent: the automation fires and Claude answers (the key came out of the Keystore),
#   S9 the key is in none of the app's files (needs `adb root`, an emulator image that allows it) and not in logcat.
# Spends one small model call. Use a throwaway key. Needs the APK built (see mobile/app/README.md).
#   AVD=<emulator name> bash mobile/tests/key-android.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
SDK=${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}
export PATH="$PATH:$SDK/platform-tools:$SDK/emulator"
APK=${APK:-mobile/app/android/app/build/outputs/apk/release/app-release.apk}
PKG=app.kybernos.host
R=/sdcard/Android/data/$PKG/files/selftest-result.json
fail=0; say() { printf '%s\n' "$*"; }; bad() { say "FAIL: $*"; fail=1; }
[ -f "$APK" ] || { say "no APK at $APK"; exit 2; }
[ -n "${AVD:-}" ] || { say "set AVD=<emulator name>: this test installs, clears and roots, so it only runs on an emulator"; exit 2; }
export ANDROID_SERIAL=emulator-5554
if ! adb devices | grep -q "^emulator-5554[[:space:]]*device"; then
  (nohup emulator -avd "$AVD" -no-window -no-audio -no-snapshot -gpu swiftshader_indirect >/dev/null 2>&1 &)
  i=0; until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] || [ $i -ge 60 ]; do sleep 5; i=$((i+1)); done
fi
KEY=$(node --input-type=module -e "import { loadEnv } from './mobile/devicecloud/lib.mjs'; loadEnv(); process.stdout.write(process.env.ANTHROPIC_API_KEY ?? '')")
[ -n "$KEY" ] || { say "no ANTHROPIC_API_KEY in mobile/.env"; exit 2; }

# the centre of the view with this testID (React Native exposes it as the resource id), from a UI dump
center() {
  adb shell uiautomator dump /sdcard/kb-ui.xml >/dev/null 2>&1
  adb shell cat /sdcard/kb-ui.xml | python3 -c "
import re,sys
x=sys.stdin.read()
m=re.search(r'resource-id=\"$1\"[^>]*bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"', x) or re.search(r'bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"[^>]*resource-id=\"$1\"', x)
print('%d %d' % ((int(m[1])+int(m[3]))//2, (int(m[2])+int(m[4]))//2) if m else 'none')"
}
waitfor() { local i=0; local c; while :; do c=$(center "$1"); [ "$c" != none ] && { echo "$c"; return; }; i=$((i+1)); [ $i -ge $2 ] && { echo none; return; }; sleep 2; done; }

adb uninstall $PKG >/dev/null 2>&1
adb install -r "$APK" >/dev/null || { say "install failed"; exit 2; }
adb shell am start -n $PKG/.MainActivity >/dev/null
c=$(waitfor key-input 40)
if [ "$c" = none ]; then bad "S7 the first-run key screen never showed"; else
  adb shell input tap $c; sleep 1
  adb shell input text "$KEY"; sleep 1
  adb shell input keyevent KEYCODE_BACK >/dev/null 2>&1; sleep 1   # hides the keyboard so Save is reachable
  s=$(center key-save); adb shell input tap $s; sleep 2
  adb shell uiautomator dump /sdcard/kb-ui.xml >/dev/null 2>&1
  if adb shell cat /sdcard/kb-ui.xml | grep -q "Stored in the secure storage"; then say "S7 first-run screen shown, key typed and stored in the Keystore"; else bad "S7 the screen does not say the key is stored"; fi
fi
adb shell am force-stop $PKG; sleep 2; adb shell rm -f $R
adb shell am start -n $PKG/.MainActivity --ei kb_selftest_delay 75 --es kb_deny_spawn 1 >/dev/null   # no key in the intent
i=0; until adb shell cat $R 2>/dev/null | grep -q '"status"' || [ $i -ge 60 ]; do sleep 3; i=$((i+1)); done
line=$(adb shell cat $R 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin).get('line',''))" 2>/dev/null)
say "S8 $line"
echo "$line" | grep -q 'fired at' || bad "S8 the automation did not fire"
echo "$line" | grep -q 'found [1-9]' || bad "S8 the model did not answer: the key did not reach the engine"

if adb root >/dev/null 2>&1 && sleep 3 && [ "$(adb shell id -u | tr -d '\r')" = 0 ]; then
  hits=$(adb shell "grep -rlF '$KEY' /data/data/$PKG /sdcard/Android/data/$PKG 2>/dev/null" | tr -d '\r')
  n=$(adb shell "find /data/data/$PKG -type f | wc -l" | tr -d '\r')
  [ -z "$hits" ] && say "S9 the key is in none of the $n files of the app" || bad "S9 the key is written in: $hits"
  [ "$(adb logcat -d 2>/dev/null | grep -cF "$KEY")" = 0 ] && say "S9 and not in logcat" || bad "S9 the key is in logcat"
  adb unroot >/dev/null 2>&1
else say "S9 skipped: this emulator image does not allow adb root"; fi
adb shell am force-stop $PKG; unset KEY
[ $fail = 0 ] && say "key-android: PASS" || say "key-android: FAIL"
exit $fail
