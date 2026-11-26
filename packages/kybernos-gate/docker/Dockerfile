# Kybernos on a server, in one container: DSH + the Kybernos plugins + the Kybernos Gate (sign-in page) in front.
#
#   docker build -t kybernos --build-arg KB_REF=v1.0.0-beta.6 .      (a release tag: see "Build arguments" below)
#   docker run -d -p 127.0.0.1:3080:3080 -v kybernos-data:/home/node/.dsh \
#     -e KYBERNOS_GATE_PASSWORD='a long password' -e KYBERNOS_PUBLIC_HOST=kybernos.example.com kybernos
#
# It reproduces what a user does by hand on a DSH server:
#   1. DSH is installed globally and started once, so its profile exists (scenario A of kybernos-install);
#   2. the plugins repository is cloned and `kybernos-install` grafts the bundles onto that profile;
#   3. at start, `dsh web` listens on 127.0.0.1 only (it refuses --host 0.0.0.0 on purpose: remote code execution)
#      and the gate listens on 3080, asks for the password, and proxies to DSH. Put a TLS reverse proxy in front.
#
# Build arguments
#   KB_REF   what to install from the plugins repository: a release tag (e.g. v1.0.0-beta.6: reproducible) or `main`
#            (the last release; the default; it moves only when a release is cut). Never `dev`, which is the integration
#            branch and changes every day, and never a work branch. The repository is cloned AT BUILD TIME and nothing
#            in the container fetches anything later: restarting it, or redeploying with the build cache, runs the same
#            code. To update, change KB_REF to the new tag and rebuild without the cache (`docker compose build --no-cache`).
#   DSH_VER  DSH version (the engine the maintainer adopted); keep it inside the range declared in dsh-compat.json, and
#            note that KB_REF must be a tag whose own dsh-compat.json lists it, or the installer step refuses it. DSH 0.2.2 needs
#            Node 24.9 or later (`dsh.node` in dsh-compat.json): the base image is node:24-slim. A version with a folder in
#            engine-locks/ is installed from that lock (the same packages as the adopted engine, byte for byte).
#
# Runtime environment (see packages/kybernos-gate/README.md for all of them)
#   KYBERNOS_GATE_PASSWORD or KYBERNOS_GATE_PASSWORD_HASH   required: the container refuses to start without one
#   KYBERNOS_GATE_USER                                      default "kybernos"
#   KYBERNOS_PUBLIC_HOST                                    the public host name (e.g. kybernos.example.com), given to
#                                                           `dsh web --trusted-host` so DSH and the plugins accept it
#
# Nothing secret goes in this file. Keep ~/.dsh on a volume: it holds the profile, the settings and the sessions.
# The agent works in ~/workspace (created at start and offered as the first workspace).
# The plugins of a TEST image come from a folder given as the build context `kbsrc` (see KB_LOCAL below); the stage is empty otherwise.
FROM scratch AS kbsrc

FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git ripgrep procps python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

USER node
ENV HOME=/home/node \
    NPM_CONFIG_PREFIX=/home/node/.npm-global \
    PATH=/home/node/.npm-global/bin:$PATH
WORKDIR /home/node

ARG DSH_VER=0.2.2-rc.1
# A version that has a lock in engine-locks/ (the one the Kybernos installer made for the adopted engine) is installed FROM
# THAT LOCK (with `npm ci` and NO `--allow-scripts`: npm 11, the one of Node 24, refuses that flag for a project install with EALLOWSCRIPTS, and npm 10 only
# warned and ignored it; the installer's own engine tree is made the same way, `npm install` with no flag): `npm install -g` takes the newest package inside each `~` range of DSH's own package.json, and on 2026-11-03
# the cordis packages and pi-ai moved under the same DSH version (33 packages), which broke the first turn of every cloud
# computer built that day. A version with no lock keeps the plain global install.
COPY --chown=node:node engine-locks /tmp/engine-locks
RUN if [ -f "/tmp/engine-locks/${DSH_VER}/package-lock.json" ]; then \
      mkdir -p /home/node/engine /home/node/.npm-global/bin \
      && cp "/tmp/engine-locks/${DSH_VER}/package.json" "/tmp/engine-locks/${DSH_VER}/package-lock.json" /home/node/engine/ \
      && cd /home/node/engine \
      && npm ci --no-audit --no-fund \
      && ln -s /home/node/engine/node_modules/.bin/dsh /home/node/.npm-global/bin/dsh; \
    else \
      npm install -g "@deepseek-ai/dsh@${DSH_VER}" \
        --allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs \
        --no-audit --no-fund; \
    fi \
    && rm -rf /tmp/engine-locks \
    && dsh --version

# `dsh plugin install` (run by kybernos-install to install the profile) shells out to pnpm and fails without it
# ("dsh: pnpm was not found; install pnpm and make it available on PATH").
RUN npm install -g pnpm --no-audit --no-fund && pnpm --version

# Start DSH once so it creates ~/.dsh/profiles/web, then stop it (the installer refuses a machine with no profile).
RUN timeout 40 dsh web --no-open --port 0 > /tmp/first-start.log 2>&1 || true; \
    tail -n 5 /tmp/first-start.log; \
    test -d /home/node/.dsh/profiles/web

# The plugins live in /opt, not in the home folder: DSH's folder picker starts at the home folder, and the agent's own
# workspace (~/workspace, created at start) should not sit next to the plugin sources.
USER root
RUN mkdir -p /opt/kybernos-plugins && chown node:node /opt/kybernos-plugins
USER node
ARG KB_REF=main
# KB_LOCAL=1 takes the plugins from the build context `kbsrc` (a folder made by `git archive <commit> | tar -x -C <folder>`) instead of a release tag:
#   docker buildx build --build-context kbsrc=<folder> --build-arg KB_LOCAL=1 ...
# It is for a TEST image that must not publish anything (a release tag publishes every commit origin lacks). Never for an image that is shipped: a shipped image names its tag.
ARG KB_LOCAL=0
RUN --mount=type=bind,from=kbsrc,target=/kbsrc \
    if [ "${KB_LOCAL}" = "1" ]; then \
      cp -a /kbsrc/. /opt/kybernos-plugins/ && test -f /opt/kybernos-plugins/VERSION && echo "local source: $(cat /opt/kybernos-plugins/VERSION)"; \
    else \
      git clone --depth 1 --branch "${KB_REF}" https://github.com/kybernos-app/kybernos-plugins.git /opt/kybernos-plugins \
      && cd /opt/kybernos-plugins && git log --oneline -1; \
    fi
# A computer never carries the phone-only bundles (`@local/kybernos-no-process` would take the place of the real program launcher and the first boot would roll the install back).
COPY --chown=node:node leave-out-phone-only.mjs /tmp/leave-out-phone-only.mjs
RUN node /tmp/leave-out-phone-only.mjs /opt/kybernos-plugins && rm /tmp/leave-out-phone-only.mjs
RUN cd /opt/kybernos-plugins && ./kybernos-install

# A volume mounted over ~/.dsh starts empty: the entrypoint seeds it from this copy of the installed profile.
USER root
RUN cp -a /home/node/.dsh /opt/dsh-seed && chown -R node:node /opt/dsh-seed
USER node

ENV DSH_PORT=3081 DSH_WEB_PORT=3081 \
    KYBERNOS_GATE_HOST=0.0.0.0 KYBERNOS_GATE_PORT=3080 KYBERNOS_GATE_UPSTREAM=http://127.0.0.1:3081 \
    KYBERNOS_GATE_TRUST_PROXY=1
EXPOSE 3080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD curl -fsS http://127.0.0.1:3080/__gate/health || exit 1
CMD ["sh", "/opt/kybernos-plugins/packages/kybernos-gate/docker/entrypoint.sh"]
