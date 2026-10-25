#!/bin/bash
# L4: the React Native app on an Android emulator or device reached by adb. A fresh install with the self-test hook on (launch-intent extras; a release build is not debuggable, so the
# result file lives in the app's external files folder, which `adb shell` reads):
#   S1 first launch: the web page is up within READY_MAX seconds and the self-test automation fires,
#   S4 kill and warm relaunch: the page is up again within WARM_MAX seconds and the first automation is still there (taskCount >= 2).
# Gates (plan section 4, L6): APK at most 200 MB, payload at most 70 MB. Name the emulator with AVD=... (see the device rule below).
#   mobile/tests/emu-android.sh
set -uo pipefail
cd "$(dirname "$0")/../app"
SDK=${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}
export PATH="$PATH:$SDK/platform-tools:$SDK/emulator"
APK=${APK:-android/app/build/outputs/apk/release/app-release.apk}
PKG=app.kybernos.host
R=/sdcard/Android/data/$PKG/files/selftest-result.json
DELAY=${SELFTEST_DELAY:-75}; READY_MAX=${READY_MAX:-30}; WARM_MAX=${WARM_MAX:-30}
fail=0; say() { printf '%s\n' "$*"; }; bad() { say "FAIL: $*"; fail=1; }
[ -f "$APK" ] || { say "no APK at $APK (build it first: cd android && ./gradlew assembleRelease)"; exit 2; }
# Which device: AVD=<name> always uses that emulator (started headless when it is not up) and never a phone that happens to be plugged in; ANDROID_SERIAL=<serial> picks a device on purpose;
# otherwise exactly one attached device is used and several are refused.
if [ -n "${AVD:-}" ]; then
  export ANDROID_SERIAL=emulator-5554
  if ! adb devices | grep -q "^emulator-5554[[:space:]]*device"; then
    (nohup emulator -avd "$AVD" -no-window -no-audio -no-snapshot -gpu swiftshader_indirect >/dev/null 2>&1 &)
    i=0; until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] || [ $i -ge 60 ]; do sleep 5; i=$((i+1)); done
    [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] || { say "the emulator did not boot"; exit 2; }
  fi
elif [ -z "${ANDROID_SERIAL:-}" ]; then
  n=$(adb devices | sed 1d | grep -cw device)
  [ "$n" = 1 ] || { say "$n devices attached: set AVD=<emulator name> or ANDROID_SERIAL=<serial>"; exit 2; }
fi
say "device: $(adb shell getprop ro.product.model | tr -d '\r') (${ANDROID_SERIAL:-the only one attached})"

mb=$(python3 -c "import os;print(round(os.path.getsize('$APK')/1048576))")
pk=$(unzip -l "$APK" | awk '/assets\/payload.kbpack/ {print int($1/1048576)}')
say "size: APK ${mb} MB, payload ${pk} MB"
[ "$mb" -le 200 ] || bad "APK is ${mb} MB (max 200)"; [ "${pk:-0}" -le 70 ] || bad "payload is ${pk} MB (max 70)"

now() { python3 -c 'import time;print(time.time())'; }
launch() { adb shell am start -n $PKG/.MainActivity --ei kb_selftest_delay "$DELAY" --es kb_deny_spawn 1 >/dev/null; }
# seconds until the result file contains "$1" (or -1 after $2 seconds)
wait_for() { local t0; t0=$(now); while :; do adb shell cat $R 2>/dev/null | grep -q "$1" && break; local el; el=$(python3 -c "print(round($(now)-$t0,1))"); [ "$(python3 -c "print(1 if $el > $2 else 0)")" = 1 ] && { echo -1; return; }; sleep 1; done; python3 -c "print(round($(now)-$t0,1))"; }
over() { [ "$(python3 -c "print(1 if $1 > $2 else 0)")" = 1 ]; }

adb uninstall $PKG >/dev/null 2>&1
adb install -r "$APK" >/dev/null || { say "install failed"; exit 2; }
launch
t=$(wait_for '"startedAt"' $((READY_MAX + 20)))
say "S1 first launch: page up and self-test started after ${t} s (max ${READY_MAX})"
if [ "$t" = -1 ]; then bad "S1 the page never came up"; elif over "$t" "$READY_MAX"; then bad "S1 page took ${t} s (max ${READY_MAX})"; fi
t=$(wait_for '"status":"fired"' $((DELAY + 120)))
say "S1 automation: $(adb shell cat $R 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin).get('line',''))" 2>/dev/null)"
[ "$t" = -1 ] && bad "S1 the automation did not fire"

adb shell am force-stop $PKG; sleep 2; adb shell rm -f $R; launch
t=$(wait_for '"startedAt"' $((WARM_MAX + 20)))
say "S4 warm relaunch: page up after ${t} s (max ${WARM_MAX})"
if [ "$t" = -1 ]; then bad "S4 the page never came back"; elif over "$t" "$WARM_MAX"; then bad "S4 page took ${t} s (max ${WARM_MAX})"; fi
t=$(wait_for '"taskCount":[2-9]' 30)
say "S4 data kept: $([ "$t" = -1 ] && echo 'the first automation is gone' || echo 'the first automation is still listed')"
[ "$t" = -1 ] && bad "S4 the automation was lost across the relaunch"
adb shell am force-stop $PKG
[ $fail = 0 ] && say "emu-android: PASS" || say "emu-android: FAIL"
exit $fail
