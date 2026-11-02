#!/bin/sh
# Renders the model route of the computer into its profile, from the environment: the platform's own `/v1` (the computer's token is the
# key, so that the platform meters it as the person's) and the model the computer starts its sessions on. Idempotent: the block between
# the two markers is replaced at every start, so a changed address or model applies at the next boot.
set -eu
f="${DSH_HOME:?}/profiles/web/cordis.patch.yml"
[ -f "$f" ] || exit 0
begin="# kybernos-computer:begin"
end="# kybernos-computer:end"
awk -v b="$begin" -v e="$end" '$0==b{skip=1} !skip{print} $0==e{skip=0}' "$f" > "$f.tmp"

api="${KYBERNOS_API:-}"
api="${api%/}"
model="${KYBERNOS_COMPUTER_MODEL:-auto}"
case "$api" in http://*|https://*) ;; *) api="" ;; esac
case "$model" in *[!A-Za-z0-9._/-]*|"") model="auto" ;; esac

if [ -n "$api" ] && [ -n "${KYBERNOS_COMPUTER_TOKEN:-}" ]; then
  {
    echo "$begin"
    echo "- id: llm-pi-ai"
    echo "  config:"
    echo "    providers:"
    echo "      kybernos:"
    echo "        displayName: Kybernos"
    echo "        api: openai-completions"
    echo "        baseURL: $api/v1"
    echo "        apiKeyEnv: KYBERNOS_COMPUTER_TOKEN"
    echo "        models:"
    echo "          - id: $model"
    echo "            name: $model"
    echo "- id: agent-default-model"
    echo "  name: \"@deepseek-ai/dsh-agent-default-model\""
    echo "  config:"
    echo "    provider: kybernos"
    echo "    model: $model"
    echo "$end"
  } >> "$f.tmp"
  echo "[computer] model route: $api/v1, model $model"
fi
mv "$f.tmp" "$f"
