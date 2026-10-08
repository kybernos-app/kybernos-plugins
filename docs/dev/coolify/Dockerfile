# Kybernos on a hosted DSH — test image for Coolify (or any Docker host behind a reverse proxy).
#
# It reproduces what a DSH VPS template looks like once a user has run `kybernos-install` on it:
#   1. DSH is installed globally and has been started once, so its profile exists (scenario A of the installer);
#   2. this repository is cloned and `kybernos-install` grafts the bundles onto that profile;
#   3. `dsh web` listens on 127.0.0.1 only (it refuses --host 0.0.0.0 on purpose: remote code execution), and a
#      local socat relay on the exposed port plays the part of the same-host reverse proxy a VPS template has.
#
# Build arguments
#   KB_REF   branch or tag of the plugins repository to install (default: dev)
#   DSH_VER  DSH version; keep it inside the range declared in dsh-compat.json
#
# Runtime environment
#   KB_TRUSTED_HOST  public authority of the instance (e.g. dsh.example.com), forwarded to
#                    `dsh web --trusted-host` so DSH's own browser-trust fence accepts the proxy host.
#   DSH_PORT         loopback port of dsh web (default 3081); the relay listens on 3080
#
# Nothing secret goes in this file: put access control in the platform (HTTP basic auth on the proxy).
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git ripgrep procps python3 make g++ socat \
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

# Start DSH once so it creates ~/.dsh/profiles/web, then stop it (the installer refuses a machine with no profile).
RUN timeout 40 dsh web --no-open --port 0 > /tmp/first-start.log 2>&1 || true; \
    tail -n 5 /tmp/first-start.log; \
    test -d /home/node/.dsh/profiles/web

ARG KB_REF=dev
RUN git clone --depth 1 --branch "${KB_REF}" https://github.com/kybernos-app/kybernos-plugins.git /home/node/kybernos-plugins \
    && cd /home/node/kybernos-plugins && git log --oneline -1
RUN cd /home/node/kybernos-plugins && ./kybernos-install

ENV DSH_PORT=3081 DSH_WEB_PORT=3081
EXPOSE 3080
CMD ["sh", "-c", "socat TCP-LISTEN:3080,fork,reuseaddr TCP:127.0.0.1:${DSH_PORT} & exec dsh web --no-open --host 127.0.0.1 --port ${DSH_PORT} ${KB_TRUSTED_HOST:+--trusted-host ${KB_TRUSTED_HOST}}"]
