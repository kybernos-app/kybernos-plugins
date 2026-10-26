#!/usr/bin/env bash
# Puts DSH, the Kybernos plugins and a headless profile on a Debian/Ubuntu arm64 (glibc) userland: the Debian a phone runs under
# Termux + proot-distro, the Android Linux Terminal VM, or any aarch64 server. Run it from a checkout of this repository.
#
#   bash scripts/install-linux-arm64.sh                  everything below
#   bash scripts/install-linux-arm64.sh --no-headless    skip the `headless-kyb` profile (keep the web profile only)
#   bash scripts/install-linux-arm64.sh --with-build-tools  also install python3 make g++ (only if an npm install fails to find a prebuilt native module)
#   bash scripts/install-linux-arm64.sh --no-apt         skip step 1 (a guest with no working apt, or a machine where the packages are already there)
#   bash scripts/install-linux-arm64.sh --dsh 0.2.1-rc.2 force a DSH version (default: the max of dsh-compat.json)
#
# 1. apt packages (git, ripgrep, curl ...; no compiler: the engine's native packages come prebuilt for linux-arm64), as root or through sudo;
# 2. Node 22.19 or later from nodejs.org (Debian's own nodejs is too old), checked against the published SHASUMS256.txt;
# 3. DSH and pnpm in ~/.npm-global (same flags as packages/kybernos-gate/docker/Dockerfile);
# 4. `dsh web` started once so ~/.dsh/profiles/web exists, then `./kybernos-install` grafts the bundles onto it;
# 5. a `headless-kyb` profile (dsh-base + dsh-headless + @local/kybernos + @local/kybernos-cloud): `dsh --profile headless-kyb "task"`.
#
# It refuses bionic (plain Termux) and musl (Alpine): the engine's native packages are published for glibc only. The model is not
# configured here: add a provider to ~/.dsh/profiles/headless-kyb/cordis.patch.yml, or export the key of the default provider.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
want_headless=1
want_apt=1
build_tools=""
dsh_ver=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-headless) want_headless=0 ;;
    --no-apt) want_apt=0 ;;
    --with-build-tools) build_tools="python3 make g++" ;;
    --dsh) shift; dsh_ver="${1:-}" ;;
    *) printf 'usage: %s [--no-headless] [--no-apt] [--with-build-tools] [--dsh <version>]\n' "$0" >&2; exit 2 ;;
  esac
  shift
done
say() { printf '\n== %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$(uname -m)" = "aarch64" ] || die "this script is for aarch64 (arm64); this machine is $(uname -m)"
if ! (ldd --version 2>&1 || true) | grep -qi 'glibc\|gnu libc'; then
  die "no glibc here (Termux without proot, or Alpine). In Termux: pkg install proot-distro && proot-distro install debian && proot-distro login debian, then run this again."
fi
[ -f "$here/kybernos-install" ] || die "run it from a checkout of the plugins repository (kybernos-install not found in $here)"

[ -n "$dsh_ver" ] || dsh_ver="$(sed -n 's/.*"max": *"\([^"]*\)".*/\1/p' "$here/dsh-compat.json" | head -1)"
[ -n "$dsh_ver" ] || die "cannot read the DSH version from dsh-compat.json; pass --dsh <version>"

say "1/5 apt packages"
sudo=""
[ "$(id -u)" = "0" ] || { command -v sudo >/dev/null 2>&1 && sudo="sudo"; }
if [ "$want_apt" = "0" ]; then
  printf '--no-apt: skipped. Needed: curl git ripgrep (check with `command -v`).\n'
elif [ "$(id -u)" = "0" ] || [ -n "$sudo" ]; then
  $sudo apt-get update -qq
  $sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates curl git ripgrep procps tar gzip $build_tools
else
  printf 'not root and no sudo: apt is skipped. Needed: curl git ripgrep (check with `command -v`).\n'
fi

say "2/5 Node"
node_ok() { command -v node >/dev/null 2>&1 && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)'; }
if node_ok; then
  printf 'Node %s already fits (22.19 or later)\n' "$(node --version)"
else
  base="https://nodejs.org/dist/latest-v22.x"
  sums="$(curl -fsSL "$base/SHASUMS256.txt")"
  tarball="$(printf '%s\n' "$sums" | awk '{print $2}' | grep -E '^node-v22\.[0-9]+\.[0-9]+-linux-arm64\.tar\.gz$' | head -1)"
  [ -n "$tarball" ] || die "no linux-arm64 tarball found in $base/SHASUMS256.txt"
  tmp="$(mktemp -d)"
  curl -fsSL "$base/$tarball" -o "$tmp/$tarball"
  expected="$(printf '%s\n' "$sums" | awk -v f="$tarball" '$2==f{print $1}')"
  actual="$(sha256sum "$tmp/$tarball" | awk '{print $1}')"
  [ "$expected" = "$actual" ] || die "checksum mismatch for $tarball (expected $expected, got $actual)"
  node_home="$HOME/.local/node"
  [ "$(id -u)" = "0" ] && node_home="/usr/local/lib/nodejs"
  mkdir -p "$node_home" && tar -xzf "$tmp/$tarball" -C "$node_home" --strip-components=1
  rm -rf "$tmp"
  export PATH="$node_home/bin:$PATH"
  printf 'Node %s in %s (add it to your PATH: export PATH="%s/bin:$PATH")\n' "$(node --version)" "$node_home" "$node_home"
  node_ok || die "Node $(node --version) is older than 22.19"
fi

say "3/5 DSH $dsh_ver and pnpm"
export NPM_CONFIG_PREFIX="$HOME/.npm-global"
export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
npm install -g "@deepseek-ai/dsh@${dsh_ver}" \
  --allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs --no-audit --no-fund
npm install -g pnpm --no-audit --no-fund
dsh --version
printf 'Add to your shell profile: export PATH="%s/bin:$PATH"\n' "$NPM_CONFIG_PREFIX"

say "4/5 web profile and Kybernos bundles"
if [ ! -d "$HOME/.dsh/profiles/web" ]; then
  log="$(mktemp)"
  dsh web --no-open --port 0 >"$log" 2>&1 &
  pid=$!
  for _ in $(seq 1 90); do grep -q '^dsh web: http' "$log" && break; kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true
  [ -d "$HOME/.dsh/profiles/web" ] || { tail -n 20 "$log" >&2; die "dsh web did not create ~/.dsh/profiles/web"; }
  rm -f "$log"
fi
"$here/kybernos-install"

if [ "$want_headless" = "1" ]; then
  say "5/5 headless-kyb profile"
  [ -d "$HOME/.dsh/profiles/headless" ] || dsh headless --help >/dev/null 2>&1 || true
  [ -d "$HOME/.dsh/profiles/headless" ] || die "dsh did not create ~/.dsh/profiles/headless"
  dest="$HOME/.dsh/profiles/headless-kyb"
  rm -rf "$dest" && cp -a "$HOME/.dsh/profiles/headless" "$dest"
  KB_PKG="$dest/package.json" node -e '
    const fs = require("fs"), p = process.env.KB_PKG, d = JSON.parse(fs.readFileSync(p, "utf8"))
    d.name = "dsh-profile-headless-kyb"
    d.dsh.profile.bundles.push("@local/kybernos", "@local/kybernos-cloud")
    fs.writeFileSync(p, JSON.stringify(d, null, 2) + "\n")'
  mkdir -p "$dest/node_modules/@local"
  ln -sfn "$here/packages/kybernos-plugin" "$dest/node_modules/@local/kybernos"
  ln -sfn "$here/packages/kybernos-cloud" "$dest/node_modules/@local/kybernos-cloud"
  dsh --profile headless-kyb --dump-config >/dev/null
  printf 'headless-kyb composes. Run: dsh --profile headless-kyb "your task"\n'
fi

printf '\nDone. Web: dsh web --no-open --port 3080 (prints the address with its token; keep it on 127.0.0.1).\n'
