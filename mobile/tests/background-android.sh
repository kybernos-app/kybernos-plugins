#!/bin/bash
# M5 on an Android emulator: what the optional background service changes. The same automation (due DELAY seconds after the app is ready) is run twice, without and with the service:
# the app goes to the home screen, the screen goes off, the phone is forced into deep Doze (unplugged), and the script reads
#   · the process's oom_score_adj: 0 in front, 200 or less while a foreground service holds it, 900 and more once it is a cached process (the first the system kills or freezes),
#   · when the engine says the automation really fired, against when it was due.
# An emulator does not suspend its CPU like a phone in deep sleep, so a late run is not reproduced here; what it does show is the priority the system gives the process.
#   AVD=<emulator name> bash mobile/tests/background-android.sh        (about 9 minutes)
# On a plugged-in phone whose owner agrees (nothing is uninstalled or cleared; the battery state and deep Doze are forced for a few minutes, then put back):
#   PHONE=<adb serial> bash mobile/tests/background-android.sh        (the app is installed by its owner first)
set -uo pipefail
cd "$(dirname "$0")/../.."
SDK=${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}
export PATH="$PATH:$SDK/platform-tools:$SDK/emulator"
APK=${APK:-mobile/app/android/app/build/outputs/apk/release/app-release.apk}
PKG=app.kybernos.host; R=/sdcard/Android/data/$PKG/files/selftest-result.json
DELAY=${DELAY:-150}
fail=0; say() { printf '%s\n' "$*"; }; bad() { say "FAIL: $*"; fail=1; }
[ -f "$APK" ] || { say "no APK at $APK"; exit 2; }
if [ -n "${PHONE:-}" ]; then
  export ANDROID_SERIAL=$PHONE
  adb get-state >/dev/null 2>&1 || { say "no device $PHONE"; exit 2; }
  adb shell pm list packages | grep -q "package:$PKG\$" || { say "install the app on the phone first"; exit 2; }
else
  [ -n "${AVD:-}" ] || { say "set AVD=<emulator name> (this test forces Doze and fakes the battery state), or PHONE=<serial> for a phone whose owner agrees"; exit 2; }
  export ANDROID_SERIAL=emulator-5554
  if ! adb devices | grep -q "^emulator-5554[[:space:]]*device"; then
    (nohup emulator -avd "$AVD" -no-window -no-audio -no-snapshot -gpu swiftshader_indirect >/dev/null 2>&1 &)
    i=0; until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] || [ $i -ge 60 ]; do sleep 5; i=$((i+1)); done
  fi
  adb uninstall $PKG >/dev/null 2>&1; adb install -r "$APK" >/dev/null || { say "install failed"; exit 2; }
fi
# the whole device's memory by process (PSS, MB), split into the app's own process and the WebView's renderer processes (they are not the app's but they are its web page)
memreport() {
  adb shell dumpsys meminfo 2>/dev/null | python3 -c "
import re,sys
t=sys.stdin.read(); a=w=0.0
sec=t.split('Total PSS by process:')[1].split('Total PSS by OOM adjustment:')[0] if 'Total PSS by process:' in t else ''
for m in re.finditer(r'([\d,]+)K: (\S+)', sec):
    k=int(m[1].replace(',',''))/1024
    if m[2].startswith('$PKG') and 'sandboxed' not in m[2]: a+=k
    elif 'sandboxed_process' in m[2] or 'webview' in m[2].lower(): w+=k
print('app process %.0f MB, WebView renderers %.0f MB' % (a, w))"
}
adj() { adb shell "cat /proc/\$(pidof $PKG | cut -d' ' -f1)/oom_score_adj" 2>/dev/null | tr -d '\r'; }
restore() { adb shell dumpsys deviceidle unforce >/dev/null 2>&1; adb shell dumpsys battery reset >/dev/null 2>&1; adb shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1; }
trap restore EXIT

one() { # $1 = 0 or 1 (the service)
  local k=$1 extra=""
  [ "$k" = 1 ] && extra="--es kb_keepalive 1"
  adb shell am force-stop $PKG; sleep 2; [ -z "$(adb shell pidof $PKG | tr -d '\r')" ] || say "note: the app is still running after force-stop"; [ -n "${PHONE:-}" ] || adb shell pm clear $PKG >/dev/null; adb shell rm -f $R
  adb shell am start -n $PKG/.MainActivity --ei kb_selftest_delay $DELAY --es kb_deny_spawn 1 $extra >/dev/null
  local i=0; until adb shell cat $R 2>/dev/null | grep -q startedAt || [ $i -ge 60 ]; do sleep 2; i=$((i+1)); done
  local front; front=$(adj); local mem; mem=$(memreport)
  adb shell input keyevent KEYCODE_HOME; sleep 6
  local home; home=$(adj)
  adb shell input keyevent KEYCODE_SLEEP; adb shell dumpsys battery unplug >/dev/null; adb shell dumpsys deviceidle force-idle >/dev/null
  # wait until the automation is due plus 45 s (it is due at a minute boundary DELAY seconds after the start)
  sleep $((DELAY + 75))
  local idle; idle=$(adj); local deep; deep=$(adb shell dumpsys deviceidle get deep | tr -d '\r')
  local svc; svc=$(adb shell dumpsys activity services $PKG | grep -c "isForeground=true")
  restore; sleep 2
  # React Native's timers pause while the app is not on screen (the engine has its own thread and does not), so the app is brought back before the result is read: the time it shows is the engine's
  adb shell am start -n $PKG/.MainActivity >/dev/null; sleep 3
  # the label is written by React Native's timers, which only run once the app is back on screen: wait for the engine's « fired at » (up to 90 s), not for the file to exist
  i=0; until adb shell cat $R 2>/dev/null | grep -q 'fired at' || [ $i -ge 45 ]; do sleep 2; i=$((i+1)); done
  local line; line=$(adb shell cat $R 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin).get('line',''))" 2>/dev/null)
  say "service=$k: oom_score_adj in front $front, on the home screen $home, screen off in $deep Doze $idle; foreground service records: $svc"
  say "           $line"
  say "           in front: $mem"
  local late; late=$(python3 - "$line" <<'PY'
import re,sys
m=re.search(r'due (\d\d):(\d\d) UTC \| fired at (\d\d):(\d\d):(\d\d)',sys.argv[1])
print(int(m[3])*3600+int(m[4])*60+int(m[5])-(int(m[1])*3600+int(m[2])*60) if m else -1)
PY
)
  say "           fired $late s after it was due"
  echo "$front $home $idle $svc $late"
}

say "device: $(adb shell getprop ro.product.model | tr -d '\r'), automation due $DELAY s after the app is ready, screen off and deep Doze forced"
c=$(one 0 | tee /dev/stderr | tail -1); k=$(one 1 | tee /dev/stderr | tail -1)
read -r f0 h0 i0 s0 l0 <<<"$c"; read -r f1 h1 i1 s1 l1 <<<"$k"
[ "${s1:-0}" -ge 1 ] || bad "the service is not a foreground service in the system's records"
[ "${i1:-999}" -le 250 ] 2>/dev/null || bad "with the service the process is not held at foreground-service priority (adj $i1)"
[ "${l1:--1}" -ge 0 ] && [ "${l1:-999}" -le 90 ] 2>/dev/null || bad "with the service the automation did not fire within 90 s of its due time (${l1:-?} s)"
[ "${s0:-1}" = 0 ] || bad "without the service a foreground service is recorded"
[ $fail = 0 ] && say "background-android: PASS" || say "background-android: FAIL"
exit $fail
