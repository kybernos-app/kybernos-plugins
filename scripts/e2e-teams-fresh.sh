#!/usr/bin/env bash
# Gives the e2e harness a clean replica again and pairs both sandboxes with it, so the next journey does not inherit what the last one spent or capped:
# j6 fills a team pool with one big model call of A's and j5 caps both accounts, so a journey that runs after either meets a 402 on its own first message.
#
#   source "$KB_E2E_DIR/env.sh" && bash scripts/e2e-teams-fresh.sh
#
# It reads the ports and the sandbox homes from the environment file the harness wrote (KB_E2E_API, KB_E2E_WEB, KB_E2E_HOME_A/B, KB_E2E_HOST_A/B), then runs `e2e-teams-run.sh replica-reset`
# and `soft-takeoff-repair.sh`. About three minutes. Exit 0 when the harness preflight is green again, 2 on a refusal.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${KB_E2E_DIR:?source \"\$KB_E2E_DIR/env.sh\" first}"
: "${KB_E2E_HOME_A:?source \"\$KB_E2E_DIR/env.sh\" first}"
: "${KB_E2E_HOME_B:?source \"\$KB_E2E_DIR/env.sh\" first}"
: "${KB_E2E_HOST_A:?source \"\$KB_E2E_DIR/env.sh\" first}"
: "${KB_E2E_HOST_B:?source \"\$KB_E2E_DIR/env.sh\" first}"
bash "$HERE/e2e-teams-run.sh" replica-reset
bash "$HERE/soft-takeoff-repair.sh" "${KB_E2E_HOME_A%/home}:${KB_E2E_HOST_A##*:}" "${KB_E2E_HOME_B%/home}:${KB_E2E_HOST_B##*:}"
