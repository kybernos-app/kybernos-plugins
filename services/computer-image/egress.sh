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
# in every mode (the strictest included), the platform's own address and the resolver excepted. The rules are read top to bottom and the first
# match wins, so the order is the policy: the link's own housekeeping (ICMP neighbour discovery and path-MTU errors), the machine's own
# replies (the gate listens on 3080), DNS to the machine's RESOLVER only, the platform's address, then the refusal of the private ranges, then
# (mode list) the allowed names. No rule lets a port through to every address: a port 53 open to anywhere is a way out for anything the
# machine holds, whatever the mode says (recette L3-12, L3-28).
# The resolver is read once, here, as root, before anything of the agent runs (the minute's refresh looks at the names, never at this): Fly's own
# is fdaa::3, which /etc/resolv.conf names. KYBERNOS_RESOLV_CONF and KYBERNOS_EGRESS_RULES_FILE move the two files (tests).
# Fails closed: a policy that cannot be applied stops the machine's start.
set -eu

MODE="${KYBERNOS_EGRESS_MODE:-}"
GUARD="${KYBERNOS_EGRESS_GUARD:-on}"
LISTEN_PORT="${KYBERNOS_GATE_PORT:-3080}"
RESOLV_CONF="${KYBERNOS_RESOLV_CONF:-/etc/resolv.conf}"
RULES_FILE="${KYBERNOS_EGRESS_RULES_FILE:-/tmp/kbguard.nft}"

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
# The addresses the machine asks its names of: the `nameserver` lines of resolv.conf (an address only: a scoped one, `fe80::1%eth0`, or a name is not taken), else Fly's own.
resolvers() {
  r=$(sed -nE 's/^[[:space:]]*nameserver[[:space:]]+([0-9A-Fa-f:.]+)([[:space:]].*)?$/\1/p' "$RESOLV_CONF" 2>/dev/null | sort -u)
  if [ -n "$r" ]; then echo "$r"; else echo "fdaa::3"; fi
}
RESOLVERS=$(resolvers)

# One rule per address: `ip daddr` for v4, `ip6 daddr` for v6.
rules_for() { # host ports
  for a in $(resolve "$1"); do
    case "$a" in
      *:*) echo "    ip6 daddr $a tcp dport { $2 } accept" ;;
      *.*) echo "    ip daddr $a tcp dport { $2 } accept" ;;
    esac
  done
}

# DNS, over UDP and over TCP (a long answer falls back to it), to the resolver and to no other address.
dns_rules() {
  for a in $RESOLVERS; do
    case "$a" in
      *:*) echo "    ip6 daddr $a udp dport 53 accept"; echo "    ip6 daddr $a tcp dport 53 accept" ;;
      *.*) echo "    ip daddr $a udp dport 53 accept"; echo "    ip daddr $a tcp dport 53 accept" ;;
    esac
  done
}

# The private ranges, link-local (the metadata address 169.254.169.254 among them), loopback and the carrier range: a name that answers one of them is never reached.
private_drops() {
  echo "    ip daddr { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 100.64.0.0/10, 127.0.0.0/8 } drop"
  echo "    ip6 daddr { fc00::/7, fe80::/10 } drop"
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
    # Before the refusal of the private ranges: Fly's resolver (fdaa::3) and the platform's own address may be inside them.
    dns_rules
    if [ -n "${KYBERNOS_API:-}" ]; then rules_for "$(host_of "$KYBERNOS_API")" "$(port_of "$KYBERNOS_API")"; fi
    private_drops
    if [ "$MODE" = "list" ] && [ -n "${KYBERNOS_EGRESS_ALLOW:-}" ]; then
      for h in $(printf '%s' "$KYBERNOS_EGRESS_ALLOW" | tr ',' ' '); do rules_for "$h" "80, 443"; done
    fi
    echo "  }"
    echo "}"
  } > "$RULES_FILE"
}

apply() { build && nft -f "$RULES_FILE"; }

apply || { echo "[egress] the policy could not be applied: stopping rather than running without it"; exit 1; }
echo "[egress] mode $MODE held"

# The names' addresses move: look again every minute (the previous rules stay until the new ones load, atomically).
( while true; do sleep 60; apply || echo "[egress] refresh failed: the previous rules stay"; done ) &
