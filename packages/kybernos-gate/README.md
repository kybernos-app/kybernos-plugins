# Kybernos Gate

A sign-in page in front of a hosted DSH. One login (username + password), a signed session, and a reverse
proxy to `dsh web`. After a good password the gate also gives the browser DSH's own session cookie, so
the user signs in **once** and never meets DSH's "authentication required" page.

It is **not** a DSH bundle (no `dsh` block in `package.json`): it is a separate process with no dependency,
like [`messaging`](../messaging). Node 22.19 or later.

## Why it exists

- DSH refuses `dsh web --host 0.0.0.0` on purpose ("it would expose remote code execution to the network"),
  so a hosted DSH listens on loopback and a proxy on the same machine reaches it.
- DSH serves plugin routes **before** its own authentication (measured on 0.2.0-rc.2), and its own sign-in is a launch
  token printed in its log, which changes at every start. A hosted instance needs a real login in front of everything.

```
browser ──https──▶ your TLS proxy ──http──▶ kybernos-gate :3080 ──http──▶ dsh web 127.0.0.1:3081
                                              │ /__gate/login   sign-in page + login
                                              │ /__gate/health  200 "ok", no session needed
                                              └ everything else needs the session cookie, then is proxied (HTTP, SSE, WebSocket)
```

Not for the Hostinger "DeepSeek Harness" VPS template: its proxy and sign-in belong to the template.

## Install on a server

You need a Linux server, a domain name, and a TLS reverse proxy. DSH runs the agent with the permissions of its
user: use a dedicated unprivileged user, never root.

```sh
# 1. Node 22.19+, pnpm and DSH (the DSH version must be inside the range of dsh-compat.json)
npm install -g @deepseek-ai/dsh@0.2.0-rc.2 pnpm

# 2. start DSH once so it creates its profile (~/.dsh), then stop it with Ctrl-C
dsh web --no-open --port 0

# 3. the Kybernos plugins
git clone https://github.com/kybernos-app/kybernos-plugins.git
cd kybernos-plugins && ./kybernos-install

# 4. DSH on loopback, told its public name (the plugins' route guards and DSH's own fence accept it)
dsh web --no-open --host 127.0.0.1 --port 3081 --trusted-host kybernos.example.com

# 5. the gate (in another terminal)
KYBERNOS_GATE_PASSWORD='a long password' KYBERNOS_GATE_TRUST_PROXY=1 \
KYBERNOS_GATE_UPSTREAM=http://127.0.0.1:3081 KYBERNOS_GATE_PORT=3080 \
node packages/kybernos-gate/bin/kybernos-gate.mjs
```

Then put the proxy in front of `127.0.0.1:3080`. With Caddy (TLS, WebSocket and `X-Forwarded-*` come by default):

```
kybernos.example.com {
  reverse_proxy 127.0.0.1:3080
}
```

To keep both running, two systemd units. Put the password in a file only the service user can read.

```ini
# /etc/systemd/system/kybernos-dsh.service
[Service]
User=kybernos
ExecStart=/usr/bin/env dsh web --no-open --host 127.0.0.1 --port 3081 --trusted-host kybernos.example.com
Restart=always

# /etc/systemd/system/kybernos-gate.service
[Service]
User=kybernos
EnvironmentFile=/etc/kybernos/gate.env        # chmod 600, owned by the service user
ExecStart=/usr/bin/node /home/kybernos/kybernos-plugins/packages/kybernos-gate/bin/kybernos-gate.mjs
Restart=always

# /etc/kybernos/gate.env
KYBERNOS_GATE_PASSWORD_HASH=scrypt$...        # make one with: echo 'a long password' | node .../kybernos-gate.mjs hash
KYBERNOS_GATE_UPSTREAM=http://127.0.0.1:3081
KYBERNOS_GATE_TRUST_PROXY=1
```

A hash keeps the clear password off the disk. In a `.env` file, write the verifier between single quotes (it contains `$`).

## Install with Docker

[`docker/Dockerfile`](docker/Dockerfile) builds one image with DSH, the plugins (installed by `kybernos-install`) and the gate.
[`docker/docker-compose.yml`](docker/docker-compose.yml) is the ready-made setup.

```sh
cd packages/kybernos-gate/docker
printf 'KYBERNOS_GATE_PASSWORD=%s\nKYBERNOS_PUBLIC_HOST=kybernos.example.com\n' 'a long password' > .env   # do not commit it
docker compose up -d --build        # the image clones the plugins repository: build argument KB_REF picks the branch or tag
```

The container listens on `127.0.0.1:3080` only: put your TLS proxy in front of it (Caddy, Traefik, nginx, or Coolify's own).
`~/.dsh` is a volume: it holds the profile, the settings and the sessions; an empty volume is seeded from the image.
The container refuses to start without `KYBERNOS_GATE_PASSWORD` or `KYBERNOS_GATE_PASSWORD_HASH`.

Coolify: create a Docker Compose or Dockerfile application from the same files, set the two variables above, expose port 3080
and let Coolify's proxy carry the domain and the TLS certificate. Do **not** also turn on its basic authentication: the gate replaces it.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `KYBERNOS_GATE_PASSWORD` | none | The password (8 characters at least). One of the two password variables is required. |
| `KYBERNOS_GATE_PASSWORD_HASH` | none | A scrypt verifier (`kybernos-gate hash`). Wins over the plain password. |
| `KYBERNOS_GATE_USER` | `kybernos` | The username. |
| `KYBERNOS_GATE_HOST` / `_PORT` | `127.0.0.1` / `3080` | Where the gate listens. The Docker image sets `0.0.0.0`. |
| `KYBERNOS_GATE_UPSTREAM` | `http://127.0.0.1:3081` | Where `dsh web` listens (http only). |
| `KYBERNOS_GATE_TRUST_PROXY` | off | `1` when a proxy you control is in front: the client address is then the **last** `X-Forwarded-For` entry, `X-Forwarded-Proto: https` sets the `Secure` flag, `X-Forwarded-Host` is the public host. Never set it when the gate is reachable without that proxy: a client could then forge its address and dodge the attempt limit. |
| `KYBERNOS_GATE_SESSION_DAYS` | `30` | Session length (1 to 365). |
| `KYBERNOS_GATE_SECRET` | a file | Secret that signs the session cookie (32 characters at least). Without it the gate creates `<DSH_HOME>/kybernos/gate-secret` (mode 600), so sessions survive a restart. |
| `KYBERNOS_GATE_DSH_SIGNIN` | on | `0` to stop the gate from handing over DSH's cookie (you would then meet DSH's own sign-in page). |
| `DSH_HOME` | `~/.dsh` | Where DSH keeps its data; the gate reads DSH's session secret from `<DSH_HOME>/.credentials.yaml`. |

## What it does and does not protect

- **Login:** the password is checked with scrypt in constant time; the username and the password are both always checked, and
  the answer never says which one was wrong. Five failures lock the client for 45 s, each next lock twice as long (15 min at most);
  a flood from many addresses locks everyone for a minute; one guess at a time per client.
- **Session:** a signed cookie (`HttpOnly`, `SameSite=Strict`, `Secure` behind HTTPS), 30 days. The login and logout routes accept
  only a request whose `Origin` is the gate's own public host. The sign-in page carries a strict Content-Security-Policy.
- **Everything else is behind it:** the page, its assets, `/api`, and the plugin routes that DSH serves before its own authentication.
- **Single sign-in:** DSH's cookie is signed with the secret DSH keeps in `<DSH_HOME>/.credentials.yaml`. The gate must run as
  the same user (or be able to read that file), and it only hands the cookie over after a good password.
- **Not covered:** DSH's WebSocket for paired remote devices (its "gateway", off by default) is authenticated by pairing, not by
  this cookie, so it is not reachable through the gate. There is one account and no second factor. The gate speaks plain HTTP:
  terminate TLS in front of it, otherwise the password crosses the network in clear.

## Tests

```sh
cd packages/kybernos-gate && node --test test/*.test.mjs                       # unit + integration against a fake DSH, about a second
node scripts/check-gate-live.mjs --dsh-port 3097 --dsh-home <HOME>/.dsh        # a REAL dsh web (isolated sandbox, never :3080)
```

The live check proves that the real engine accepts the cookie the gate mints (the page, its assets and `/api` answer like a
direct signed-in call), and that without the gate's cookie nothing reaches DSH.
