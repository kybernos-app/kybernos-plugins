# Install Kybernos

Kybernos is a suite of plugins for DSH (the DeepSeek harness). The installer puts them into your DSH profile, installs DSH
itself if it is missing, and **never changes anything silently**: it checks the archive, takes a snapshot of your profile,
writes, checks that DSH still starts, and puts the snapshot back if it does not.

This page is for a person on their own computer. For a server or a container, see
[Install on a server or with Docker](../README.md#install-on-a-server-or-with-docker).

## What you need

| | |
|---|---|
| A computer | macOS, Linux or Windows |
| Node.js | version 22 or later ([nodejs.org](https://nodejs.org)); check with `node -v` |
| DSH | installed for you when it is missing. The versions this release was played on are listed in [`dsh-compat.json`](../dsh-compat.json) |
| git | only for the "clone" route below |
| A model | not needed to install. The first screens help you connect one (see [The welcome pages](#the-welcome-pages)) |

## 1. Get it

**From a release (no git).** Open the [latest release](https://github.com/kybernos-app/kybernos-plugins/releases/latest) and
download the archive of your system: `kybernos-dsh-<version>-mac.tar.gz`, `-linux.tar.gz` or `-windows.tar.gz`. Extract it in
a **new, empty folder** and open a terminal there:

```sh
mkdir kybernos && tar xzf ~/Downloads/kybernos-dsh-<version>-mac.tar.gz -C kybernos
cd kybernos
```

On Windows (`cmd`): `mkdir kybernos`, then `tar -xzf "%USERPROFILE%\Downloads\kybernos-dsh-<version>-windows.tar.gz" -C kybernos`,
then `cd kybernos`.

**With git** (the development version of the branch you check out):

```sh
git clone https://github.com/kybernos-app/kybernos-plugins.git
cd kybernos-plugins
```

## 2. Install

Always look first. `--dry` shows what would change and touches nothing:

```sh
./kybernos-install --dry
./kybernos-install
```

On Windows the commands are `kybernos-install --dry` and `kybernos-install`.

In this order, the installer: verifies the archive's fingerprints, looks for DSH (and installs it when it is missing), takes
a safety snapshot of your profile, links the plugins, and checks that DSH restarts. If the start fails, the snapshot is put
back and nothing of yours is lost.

## 3. Start it

```sh
dsh web --no-open --port 3080
```

Open <http://127.0.0.1:3080/>. If DSH was already running, restart it first: a restart interrupts running sessions.

## The welcome pages

The first time, Kybernos asks four short questions. Every one can be skipped, and nothing is asked twice.

1. **What do you do?** Your profession, from a list. It tunes the starter kit below and is kept in your memory (with a
   Kybernos account) so the agents talk to you the right way.
2. **Display mode.** *Coding mode* shows code, command output and change details; *Office mode* shows progress and results.
3. **Which models should Kybernos use?** A free Kybernos account (browser sign-in, no key to manage), or your own API key
   (Anthropic, OpenAI, DeepSeek, Google or another provider; the key stays on your computer). A model on this computer or
   free community models, with no account, are one line below.
4. **A starter kit.** Skills and agent teams that fit your profession (a student is offered study planning, flashcards and
   the Studencik team; a finance profile, statements and reconciliation). You tick what you want; nothing runs by itself.

Your answers are stored in `~/.dsh/kybernos/onboarding.json`. To go through them again, or to open the starter kit alone:
**Settings › General › Kybernos Settings › Onboarding › Replay**, or **Starter kit › Open**. A replay always shows the model question,
so it is also where you add an account or a key later.

## Update

Extract the **new** archive in its own folder and run, from there:

```sh
./kybernos-update --dry   # shows the plan, touches nothing
./kybernos-update
```

The same contract as the installation: fingerprints, snapshot, start check, rollback on failure. From inside Kybernos, the
Suite panel can also check for a signed update and apply it with one click
([how it works](dev/suite-updates.md)).

## If something goes wrong

```sh
node scripts/dsh-lifecycle.mjs doctor                                     # what is installed, what is off
node scripts/dsh-lifecycle.mjs safe-mode on                               # only the core, if the page will not load
node scripts/dsh-lifecycle.mjs safe-mode off                              # everything back
node scripts/dsh-lifecycle.mjs satellites --desactiver kybernos-slides   # one plugin off (restart DSH)
node scripts/dsh-lifecycle.mjs satellites --activer kybernos-slides      # back on
node scripts/dsh-lifecycle.mjs rollback                                   # restore the last snapshot
node scripts/dsh-lifecycle.mjs uninstall                                  # unlink the plugins from the profile (the rest is intact)
```

- `node: command not found`, or a version that cannot run the installer: install Node.js 22 or later.
- The page shows « Failed to load plugins »: `safe-mode status` names the plugin that fails and the exact command that
  switches it off.
- Port 3080 is already used: another DSH is running. Stop it, or give `dsh web` another `--port`.

## Let an AI agent do it

[kybernos.app/start.md](https://kybernos.app/start.md) is the same procedure written for an agent: it runs `--dry`, shows you
the output, and waits for your explicit yes before the real install. It never touches your DSH profile itself.
