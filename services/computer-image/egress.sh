#!/bin/sh
# The computer's outbound policy, held by the machine itself (ADR 0052 § 11). Fly offers no control of a machine's outbound traffic and its
# kernel has no `owner` match, so the rules are the whole machine's: what leaves is what the person allowed, for every process in it.
#
#   KYBERNOS_EGRESS_MODE   closed (the platform's own address only) | list (plus KYBERNOS_EGRESS_ALLOW) | public (any public address)
#   KYBERNOS_EGRESS_ALLOW  host names, comma separated (mode list)
#   KYBERNOS_API           the platform's address: always reachable (the model, the connections and the reports all go there)
#   KYBERNOS_EGRESS_GUARD  `off` only for a development machine: no policy is applied, and the log says so
#
# Names are resolved to addresses, and again every minute (a name's addresses move). Private ranges and the metadata address are refused
# in every mode, the platform's own address excepted. DNS, the link's own housekeeping (ICMP neighbour discovery and path-MTU errors) and
# the machine's own replies (the gate listens on 3080) always pass.
# Fails closed: a policy that cannot be applied stops the machine's start.
set -eu

MODE="${KYBERNOS_EGRESS_MODE:-}"
GUARD="${KYBERNOS_EGRESS_GUARD:-on}"
LISTEN_PORT="${KYBERNOS_GATE_PORT:-3080}"

if [ -z "$MODE" ]; then echo "[egress] no policy was given: none applied"; exit 0; fi
if [ "$GUARD" = "off" ]; then echo "[egress] KYBERNOS_EGRESS_GUARD=off: mode $MODE is declared and NOT held"; exit 0; fi
case "$MODE" in closed|list|public) ;; *) echo "[egress] unknown mode '$MODE'"; exit 1 ;; esac
command -v nft >/dev/null 2>&1 || { echo "[egress] nft is missing: cannot hold mode $MODE"; exit 1; }

host_of() { printf '%s' "$1" | sed -E 's#^[a-zA-Z]+://##; s#/.*$##; s#:[0-9]+$##; s#^\[##; s#\]$##'; }
port_of() {
  p=$(printf '%s' "$1" | sed -nE 's#^[a-zA-Z]+://[^/:]+:([0-9]+).*#\1#p')
  if [ -n "$p" ]; then echo "$p"; return; fi
  case "$1" in http://*) echo 80 ;; *) echo 443 ;; esac
}
resolve() { getent ahosts "$1" 2>/dev/null | awk '{print $1}' | sort -u; }

# One rule per address: `ip daddr` for v4, `ip6 daddr` for v6.
rules_for() { # host ports
  for a in $(resolve "$1"); do
    case "$a" in
      *:*) echo "    ip6 daddr $a tcp dport { $2 } accept" ;;
      *.*) echo "    ip daddr $a tcp dport { $2 } accept" ;;
    esac
  done
}

build() {
  {
    echo "add table inet kbguard"
    echo "delete table inet kbguard"
    echo "table inet kbguard {"
    echo "  chain out {"
    if [ "$MODE" = "public" ]; then echo "    type filter hook output priority 0; policy accept;"
    else echo "    type filter hook output priority 0; policy drop;"; fi
    echo "    oifname \"lo\" accept"
    # Fly's network is IPv6 (the resolver is fdaa::3): without neighbour discovery the machine loses its resolver minutes after it starts.
    echo "    icmpv6 type { nd-router-solicit, nd-neighbor-solicit, nd-neighbor-advert, packet-too-big, destination-unreachable, time-exceeded } accept"
    echo "    icmp type { destination-unreachable, time-exceeded } accept"
    echo "    tcp sport $LISTEN_PORT accept"
    echo "    udp dport 53 accept"
    echo "    tcp dport 53 accept"
    if [ -n "${KYBERNOS_API:-}" ]; then rules_for "$(host_of "$KYBERNOS_API")" "$(port_of "$KYBERNOS_API")"; fi
    if [ "$MODE" = "list" ] && [ -n "${KYBERNOS_EGRESS_ALLOW:-}" ]; then
      for h in $(printf '%s' "$KYBERNOS_EGRESS_ALLOW" | tr ',' ' '); do rules_for "$h" "80, 443"; done
    fi
    if [ "$MODE" = "public" ]; then
      echo "    ip daddr { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 100.64.0.0/10, 127.0.0.0/8 } drop"
      echo "    ip6 daddr { fc00::/7, fe80::/10 } drop"
    fi
    echo "  }"
    echo "}"
  } > /tmp/kbguard.nft
}

apply() { build && nft -f /tmp/kbguard.nft; }

apply || { echo "[egress] the policy could not be applied: stopping rather than running without it"; exit 1; }
echo "[egress] mode $MODE held"

# The names' addresses move: look again every minute (the previous rules stay until the new ones load, atomically).
( while true; do sleep 60; apply || echo "[egress] refresh failed: the previous rules stay"; done ) &
