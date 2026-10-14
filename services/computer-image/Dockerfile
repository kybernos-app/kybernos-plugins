# The image of a cloud computer (ADR 0052 § 9, in the server repository): the hosted Kybernos image of packages/kybernos-gate/docker
# (DSH, the plugins at a release tag, the gate in front of DSH) with one change, a root entrypoint that makes the volume the
# profile and the workspace live on.
#
#   docker buildx build --platform linux/amd64 -t kybernos-computer-base:<tag> \
#     --build-arg DSH_VER=0.2.1-alpha.2 --build-arg KB_REF=v1.0.0-beta.8 packages/kybernos-gate/docker
#   docker buildx build --platform linux/amd64 -t kybernos-computer:<tag> \
#     --build-arg BASE=kybernos-computer-base:<tag> services/computer-image
#
# Fly runs amd64: build for it (Apple Silicon builds arm64 by default, which Fly cannot run).
#
# What the platform gives the machine (nothing else, and never a connector's credential):
#   KYBERNOS_API, KYBERNOS_COMPUTER_ID, KYBERNOS_COMPUTER_TOKEN   its server, its id, its restricted token
#   KYBERNOS_PUBLIC_HOST                                         its own host name, for DSH's fence and the plugins' guards
#   KYBERNOS_GATE_PASSWORD (or _HASH)                            the gate refuses to start without one
#   KYBERNOS_EGRESS_MODE, KYBERNOS_EGRESS_ALLOW                  the network policy (an egress guard in the image is not built)
# The volume is mounted at /data: the DSH profile (/data/dsh) and the agent's workspace (/data/work) are on it, so that a
# restart, a cold start and a wake keep sessions, memory, skills and automations.
ARG BASE=kybernos-computer-base:latest
FROM ${BASE}

USER root
COPY entrypoint.sh /usr/local/bin/kybernos-computer-entrypoint
RUN chmod 0755 /usr/local/bin/kybernos-computer-entrypoint
ENTRYPOINT ["/usr/local/bin/kybernos-computer-entrypoint"]
CMD []
