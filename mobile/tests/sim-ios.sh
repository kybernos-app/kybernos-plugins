#!/bin/bash
# L4: the React Native app on an iOS simulator. A fresh install with processes refused (the phone's rule) and the self-test hook on:
#   S1 first launch: the web page is up within READY_MAX seconds and the self-test automation fires,
#   S4 kill and warm relaunch: the page is up again within WARM_MAX seconds and the data survived.
# Gates (plan section 4, L6): app at most 200 MB, payload at most 70 MB.
#   mobile/tests/sim-ios.sh [simulator name or UDID]            (default: iPhone 18 Pro; the app is built by mobile/app, see its README)
set -uo pipefail
cd "$(dirname "$0")/../app/ios"
SIM=${1:-"iPhone 18 Pro"}
APP=${APP:-build/dd/Build/Products/Release-iphonesimulator/Kybernos.app}
BUNDLE=app.kybernos.host
DELAY=${SELFTEST_DELAY:-75}; READY_MAX=${READY_MAX:-30}; WARM_MAX=${WARM_MAX:-30}
fail=0; say() { printf '%s\n' "$*"; }; bad() { say "FAIL: $*"; fail=1; }
[ -d "$APP" ] || { say "no app at $APP (build it first: xcodebuild ... ARCHS=arm64 ONLY_ACTIVE_ARCH=YES)"; exit 2; }
UDID=$(xcrun simctl list devices available | grep -F "$SIM (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')
[ -n "$UDID" ] || UDID=$SIM
xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1 || { xcrun simctl boot "$UDID" 2>/dev/null; xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1 || { say "cannot boot $SIM"; exit 2; }; }

mb=$(du -sm "$APP" | cut -f1); pk=$(du -sm "$APP/payload.kbpack" | cut -f1)
say "size: app ${mb} MB, payload ${pk} MB"
[ "$mb" -le 200 ] || bad "app is ${mb} MB (max 200)"; [ "$pk" -le 70 ] || bad "payload is ${pk} MB (max 70)"

launch() { SIMCTL_CHILD_KYBERNOS_DENY_SPAWN=1 SIMCTL_CHILD_KB_SELFTEST_TASK_DELAY=$DELAY xcrun simctl launch "$UDID" $BUNDLE >/dev/null; }
data() { xcrun simctl get_app_container "$UDID" $BUNDLE data; }
now() { python3 -c 'import time;print(time.time())'; }
# waits for "$1" to contain "$2" for at most $3 seconds; prints the seconds it took (or -1)
wait_for() { local t0; t0=$(now); while :; do grep -q "$2" "$1" 2>/dev/null && break; local el; el=$(python3 -c "print(round($(now)-$t0,1))"); [ "$(python3 -c "print(1 if $el > $3 else 0)")" = 1 ] && { echo -1; return; }; sleep 1; done; python3 -c "print(round($(now)-$t0,1))"; }

xcrun simctl terminate "$UDID" $BUNDLE 2>/dev/null; xcrun simctl uninstall "$UDID" $BUNDLE 2>/dev/null
xcrun simctl install "$UDID" "$APP" || { say "install failed"; exit 2; }
D=$(data); R="$D/Library/Application Support/Kybernos/selftest-result.json"; LOG="$D/Library/Application Support/Kybernos/node.log"
rm -f "$R"; launch
t=$(wait_for "$R" '"startedAt"' $((READY_MAX + 20)))
say "S1 first launch: page up and self-test started after ${t} s (max ${READY_MAX})"
[ "$t" = -1 ] && bad "S1 the page never came up" || { [ "$(python3 -c "print(1 if $t > $READY_MAX else 0)")" = 1 ] && bad "S1 page took ${t} s (max ${READY_MAX})"; }
t=$(wait_for "$R" '"status":"fired"' $((DELAY + 120)))
say "S1 automation: $(python3 -c "import json;print(json.load(open('$R')).get('line',''))" 2>/dev/null)"
[ "$t" = -1 ] && bad "S1 the automation did not fire"

xcrun simctl terminate "$UDID" $BUNDLE; sleep 2; rm -f "$R"; launch
t=$(wait_for "$R" '"startedAt"' $((WARM_MAX + 20)))
say "S4 warm relaunch: page up after ${t} s (max ${WARM_MAX})"
[ "$t" = -1 ] && bad "S4 the page never came back" || { [ "$(python3 -c "print(1 if $t > $WARM_MAX else 0)")" = 1 ] && bad "S4 page took ${t} s (max ${WARM_MAX})"; }
TASKS="$D/Library/Application Support/Kybernos/data/.dsh/kybernos/tasks.json"
n=$(grep -o '"name": *"selftest"' "$TASKS" 2>/dev/null | wc -l | tr -d ' ')
say "S4 data kept: ${n} selftest task(s) in tasks.json"
[ "$n" -ge 1 ] || bad "S4 the automation was lost across the relaunch"
xcrun simctl terminate "$UDID" $BUNDLE
[ $fail = 0 ] && say "sim-ios: PASS" || say "sim-ios: FAIL"
exit $fail
