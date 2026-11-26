# Hardening guide: running Kybernos yourself

For people who run the open-source Kybernos on their own computer or server (the Community edition, see [`SUPPORT.md`](../SUPPORT.md)). Kybernos runs agents that can read your files,
run commands and use your connected apps: the safe set-up is the one where only you can reach it, and only the things you chose can act.

## 1. Keep it on your own computer

- DSH answers on `127.0.0.1` (this computer only). Start it with `dsh web --port 3080` as the [install guide](install.md) says, and open the address it prints: it carries your sign-in.
- Do not put it behind a port forward, a reverse proxy or a tunnel (ngrok, Cloudflare Tunnel, Tailscale Funnel and the like). Anyone who reaches it can try to use an agent that runs commands on your machine.
- Need it from your phone or from elsewhere? Use the phone link ([`kybernos-mobile`](../packages/kybernos-mobile/README.md)): the computer calls out, nothing is opened. Or use a cloud computer.

## 2. Check your installation

From the next release (it is in the development branch today):

```sh
node scripts/dsh-lifecycle.mjs doctor --security
```

It says, without writing anything and without a network call: who can reach DSH, whether your secret files are readable by other users, whether a key is pasted in your profile, which
permission a new session starts on, and whether a tunnel is running. `--bundle <file>` writes a report with every secret removed; read it before you share it.

## 3. Keys and tokens

- Model keys live in Kybernos' own store, or in `~/.dsh/.env`. Keep that file for yourself: `chmod 600 ~/.dsh/.env`.
- Never paste a key in a chat, an issue, a screenshot or a profile file. If one leaked, change it at the provider first, then in Kybernos.
- The sign-in address (`?token=…`) is a password: do not post it.

## 4. What an agent may do without asking

- A new session can run commands. Whether it asks first depends on the permission preset of the session. Prefer a preset that asks, and check what a new session starts on.
- Connect an app with the narrowest access that does the job, read-only when you can. Read the approval cards: they say what is about to be sent, changed or deleted.
- An automation runs with nobody watching. Give it only access you would accept it using at any hour.

## 5. The local Kaby MCP door

From the next release. It lets an assistant on **this computer** hand Kaby a task. It is off until you turn it on, answers on this computer only, needs a token, and every task it starts
asks before it acts. Do not paste its token in a chat (the assistant reads it from the file). Change the token if you think it leaked.

## 6. Updates and backups

- Install updates: they are signed, an unsigned or older release is refused ([how](dev/suite-updates.md)). Security fixes are free for everyone.
- The updater takes a safety snapshot of your profile first. Keep your own backup of `~/.dsh` too.

## 7. If you think you were compromised

1. Stop DSH.
2. Change your model keys and the tokens of every connected app, and disconnect the apps.
3. Look at the recent sessions for commands you did not expect.
4. Update, then start again on `127.0.0.1` only.

The Community edition has no support line; the Supported install (planned) tells you what to rotate and what to check, and does not investigate your machine. To report a flaw in the
code, use [`SECURITY.md`](../SECURITY.md).
