#!/bin/sh
# Pushes the computer image to a Fly organisation's registry, so that the platform's machines of that organisation can pull it
# (a registry belongs to the organisation: an image pushed under one organisation cannot be pulled by another's machines).
#
#   read -s FLY_API_TOKEN && export FLY_API_TOKEN      # an organisation token of the target organisation, kept out of the history
#   sh services/computer-image/push-image.sh
#
#   FLY_ORG        the target organisation's slug; found from the token when it has only one organisation
#   FLY_IMAGE_APP  the registry app to push under (default: a new `kb-img-<random>`; an existing one is reused)
#   LOCAL_IMAGE    the image to push (default kybernos-computer:p5; build it as in docs/dev/computers.md)
#
# It prints the two values to set on the platform (COMPUTERS_FLY_ORG, COMPUTERS_FLY_IMAGE) and never the token. The docker login is
# removed again when it is done.
set -eu

: "${FLY_API_TOKEN:?set FLY_API_TOKEN (an organisation token of the target organisation)}"
LOCAL_IMAGE="${LOCAL_IMAGE:-kybernos-computer:p5}"
if [ -n "${FLY_IMAGE_APP:-}" ]; then
  APP="$FLY_IMAGE_APP"
else
  suffix=$(od -An -N5 -tx1 /dev/urandom | tr -d "[:space:]")
  APP="kb-img-$suffix"
fi
TAG="${LOCAL_IMAGE#*:}"
REF="registry.fly.io/$APP:$TAG"


case "$FLY_API_TOKEN" in FlyV1*) AUTH="$FLY_API_TOKEN" ;; *) AUTH="Bearer $FLY_API_TOKEN" ;; esac

if [ -z "${FLY_ORG:-}" ]; then
  slugs=$(curl -s -m 20 -X POST https://api.fly.io/graphql -H "Authorization: $AUTH" -H 'content-type: application/json' \
    -d '{"query":"{ organizations { nodes { slug } } }"}' | grep -o '"slug":"[^"]*"' | sed 's/"slug":"//; s/"$//')
  if [ -z "$slugs" ] || [ "$(printf '%s\n' "$slugs" | wc -l | tr -d ' ')" != 1 ]; then
    echo "cannot tell which organisation the token is for: set FLY_ORG to its slug"; exit 1
  fi
  FLY_ORG="$slugs"
fi
echo "organisation: $FLY_ORG"

docker image inspect "$LOCAL_IMAGE" >/dev/null 2>&1 || { echo "the local image $LOCAL_IMAGE does not exist: build it first"; exit 1; }

# The registry app: 201 made, 422 when the name is already taken (reused only if it is ours: the push below says if it is not).
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "https://api.machines.dev/v1/apps" \
  -H "Authorization: $AUTH" -H 'content-type: application/json' \
  -d "{\"app_name\":\"$APP\",\"org_slug\":\"$FLY_ORG\"}")
case "$code" in
  201|200|422) ;;
  401|403) echo "the token was refused with HTTP $code: it must be an organisation token of $FLY_ORG"; exit 1 ;;
  *) echo "creating the registry app answered $code"; exit 1 ;;
esac

trap 'docker logout registry.fly.io >/dev/null 2>&1 || true' EXIT
printf '%s' "$FLY_API_TOKEN" | docker login registry.fly.io -u x --password-stdin >/dev/null
docker tag "$LOCAL_IMAGE" "$REF"
docker push "$REF" | tail -1

echo
echo "pushed. On the platform set:"
echo "  COMPUTERS_FLY_ORG=$FLY_ORG"
echo "  COMPUTERS_FLY_IMAGE=$REF"
echo "  COMPUTERS_FLY_TOKEN=<the same token, pasted by you directly into the platform's settings>"
