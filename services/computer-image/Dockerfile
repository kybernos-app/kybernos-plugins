# The image of a cloud computer (ADR 0052 § 9, in the server repository): the hosted Kybernos image of packages/kybernos-gate/docker
# (DSH, the plugins at a release tag, the gate in front of DSH) with what a computer adds: the volume's owner, an outbound policy it
# holds itself, the model route rendered from its environment, the gate opened by the platform's link, and a reporter.
#
# The context is the repository root (the gate's code is taken from the checkout, not from the tag the base was cloned at):
#
#   docker buildx build --platform linux/amd64 -t kybernos-computer-base:<tag> \
#     --build-arg DSH_VER=0.2.1-alpha.2 --build-arg KB_REF=v1.0.0-beta.8 packages/kybernos-gate/docker
#   docker buildx build --platform linux/amd64 -t kybernos-computer:<tag> -f services/computer-image/Dockerfile \
#     --build-arg BASE=kybernos-computer-base:<tag> --build-arg VERSION=<tag> .
#
# Fly runs amd64: build for it (Apple Silicon builds arm64 by default, which Fly cannot run).
#
# What the platform gives the machine (nothing else, and never a connector's credential):
#   KYBERNOS_API, KYBERNOS_COMPUTER_ID, KYBERNOS_COMPUTER_TOKEN   its server, its id and its restricted token
#   KYBERNOS_PUBLIC_HOST                                         its own host name, for DSH's fence and the plugins' guards
#   KYBERNOS_EGRESS_MODE, KYBERNOS_EGRESS_ALLOW                  the outbound policy, held by egress.sh (nftables)
#   KYBERNOS_COMPUTER_MODEL                                      the model it starts its sessions on (default `auto`)
# A machine made AHEAD of need (a pool slot) is given KYBERNOS_API, KYBERNOS_PUBLIC_HOST, the egress mode and KYBERNOS_POOL_TOKEN instead of the three identity variables; its identity
# arrives at the claim and lands on the volume (computer-identity.mjs). Nothing of a person is on it before that.
# The volume is mounted at /data: the DSH profile (/data/dsh) and the agent's workspace (/data/work) are on it, so that a restart, a
# cold start and a wake keep sessions, memory, skills and automations.
ARG BASE=kybernos-computer-base:latest
FROM ${BASE}

USER root
ARG VERSION=dev
ENV KYBERNOS_IMAGE_VERSION=${VERSION}

RUN apt-get update && apt-get install -y --no-install-recommends nftables \
    && rm -rf /var/lib/apt/lists/*

# The gate of THIS checkout: it knows the platform's link (the base's own copy was cloned at a release tag that does not).
COPY packages/kybernos-gate/ /opt/kybernos-plugins/packages/kybernos-gate/

# The cloud plugin of THIS checkout too, the whole folder: its index.js imports sibling files that the release the base was cloned at does not have
# (kyby.mjs, kyby-native.mjs, chat-space.mjs...), so the index alone cannot load ("kybernos-cloud: failed to import", every turn answered "dsh_failed";
# measured on dev with image p13). It fills a computer's account (e-mail) from the server and tells the page it is on a computer. The page bundle
# of kybernos-plugin is patched, not replaced (it differs by hundreds of lines): see patch-console.mjs, which fails the build when its anchors are not found.
COPY packages/kybernos-cloud/ /opt/kybernos-plugins/packages/kybernos-cloud/
COPY services/computer-image/patch-console.mjs /tmp/patch-console.mjs
RUN node /tmp/patch-console.mjs /opt/kybernos-plugins/packages/kybernos-plugin/client.js && rm /tmp/patch-console.mjs

# Nobody is at an unattended computer's approval prompt. DSH's default permission preset asks for a command's approval, so a run that
# needs a tool (a script for an arithmetic, a file write) waits for ever: measured, a one-minute task still open after ten minutes. The
# machine is the boundary (ADR 0052 § 11: assume model-written code is hostile; the VM, not DSH's file jail, is what holds it), so fresh
# sessions start on the preset that never asks. The asking presets stay in the table; an automation that wants a person's OK is the
# approval inbox's job (ADR 0052 § 15), not a prompt nobody sees.
# DSH 0.2.1-rc.2 starts the file with `[]` (an empty list); items appended after it make it invalid YAML and DSH stops at boot. Older engines wrote nothing there: the line goes first.
RUN sed -i '/^\[\]$/d' /opt/dsh-seed/profiles/web/cordis.patch.yml && cat >> /opt/dsh-seed/profiles/web/cordis.patch.yml <<'YAML'
- id: permission
  name: "@deepseek-ai/dsh-permission-presets"
  config:
    presets:
      workspace-write:
        sandbox: workspace-write
        approval: ask
      danger-full-access:
        sandbox: danger-full-access
        approval: never
    defaultPreset: danger-full-access
YAML

COPY services/computer-image/entrypoint.sh /usr/local/bin/kybernos-computer-entrypoint
# post-claim.sh, pool-hold.sh, claimer.mjs, identity.mjs and computer-identity.mjs are the pool's (a computer made ahead of need and handed to a person later: see docs/dev/computers.md).
COPY services/computer-image/egress.sh services/computer-image/render-profile.sh services/computer-image/post-claim.sh services/computer-image/pool-hold.sh services/computer-image/reporter.mjs services/computer-image/runner.mjs services/computer-image/claimer.mjs services/computer-image/identity.mjs services/computer-image/computer-identity.mjs services/computer-image/kyby-identity.mjs services/computer-image/link-account.mjs /usr/local/lib/kybernos-computer/
RUN chmod 0755 /usr/local/bin/kybernos-computer-entrypoint /usr/local/lib/kybernos-computer/egress.sh /usr/local/lib/kybernos-computer/render-profile.sh /usr/local/lib/kybernos-computer/post-claim.sh /usr/local/lib/kybernos-computer/pool-hold.sh
ENTRYPOINT ["/usr/local/bin/kybernos-computer-entrypoint"]
CMD []
