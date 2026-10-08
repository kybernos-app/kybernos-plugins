# Kybernos on a server, in one container: DSH + the Kybernos plugins + the Kybernos Gate (sign-in page) in front.
#
#   docker build -t kybernos --build-arg KB_REF=main .
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
#   KB_REF   branch or tag of the plugins repository to install (default: main)
#   DSH_VER  DSH version; keep it inside the range declared in dsh-compat.json
#
# Runtime environment (see packages/kybernos-gate/README.md for all of them)
#   KYBERNOS_GATE_PASSWORD or KYBERNOS_GATE_PASSWORD_HASH   required: the container refuses to start without one
#   KYBERNOS_GATE_USER                                      default "kybernos"
#   KYBERNOS_PUBLIC_HOST                                    the public host name (e.g. kybernos.example.com), given to
#                                                           `dsh web --trusted-host` so DSH and the plugins accept it
#
# Nothing secret goes in this file. Keep ~/.dsh on a volume: it holds the profile, the settings and the sessions.
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git ripgrep procps python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

USER node
ENV HOME=/home/node \
    NPM_CONFIG_PREFIX=/home/node/.npm-global \
    PATH=/home/node/.npm-global/bin:$PATH
WORKDIR /home/node

ARG DSH_VER=0.2.0-rc.2
RUN npm install -g "@deepseek-ai/dsh@${DSH_VER}" \
      --allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs \
      --no-audit --no-fund \
    && dsh --version

# `dsh plugin install` (run by kybernos-install to install the profile) shells out to pnpm and fails without it
# ("dsh: pnpm was not found; install pnpm and make it available on PATH").
RUN npm install -g pnpm --no-audit --no-fund && pnpm --version

# Start DSH once so it creates ~/.dsh/profiles/web, then stop it (the installer refuses a machine with no profile).
RUN timeout 40 dsh web --no-open --port 0 > /tmp/first-start.log 2>&1 || true; \
    tail -n 5 /tmp/first-start.log; \
    test -d /home/node/.dsh/profiles/web

ARG KB_REF=main
RUN git clone --depth 1 --branch "${KB_REF}" https://github.com/kybernos-app/kybernos-plugins.git /home/node/kybernos-plugins \
    && cd /home/node/kybernos-plugins && git log --oneline -1
RUN cd /home/node/kybernos-plugins && ./kybernos-install

# A volume mounted over ~/.dsh starts empty: the entrypoint seeds it from this copy of the installed profile.
USER root
RUN cp -a /home/node/.dsh /opt/dsh-seed && chown -R node:node /opt/dsh-seed
USER node

ENV DSH_PORT=3081 DSH_WEB_PORT=3081 \
    KYBERNOS_GATE_HOST=0.0.0.0 KYBERNOS_GATE_PORT=3080 KYBERNOS_GATE_UPSTREAM=http://127.0.0.1:3081 \
    KYBERNOS_GATE_TRUST_PROXY=1
EXPOSE 3080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD curl -fsS http://127.0.0.1:3080/__gate/health || exit 1
CMD ["sh", "/home/node/kybernos-plugins/packages/kybernos-gate/docker/entrypoint.sh"]
