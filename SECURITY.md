# Security policy

## Report a vulnerability

Use GitHub's private reporting: the **Security** tab of this repository, then **Report a vulnerability**. Do not open a public issue for a vulnerability.

This is **not a support channel**. A report is for a flaw in the code of this repository or of the official Kybernos images. For help with your own installation, see
[`SUPPORT.md`](SUPPORT.md) and the [hardening guide](docs/hardening.md). A report that is not a flaw in our code (a set-up question, a problem in a third-party product) is
closed with a pointer to those pages. A report that an attack is under way is always read, whatever the set-up.

Please include: the version (the `VERSION` file), what you did, what you expected, what happened, and the smallest way to reproduce it. Do not include other people's data or real
secrets. Please test only your own installation, and do not access anyone else's data.

## What happens next

- We aim to acknowledge a report within 3 business days and to tell you the outcome. This is a target, not a guarantee.
- A flaw in our code is fixed in a release **for everyone, free of charge**. We publish an advisory when users need to act, and credit you unless you ask us not to be.
- We ask for coordinated disclosure: please give us up to 90 days before you publish, and we will tell you sooner when a fix is out. We may tell affected users, vendors and
  authorities earlier when the law or an attack in progress requires it.

## Scope

In scope: the code in this repository, the plugin archives and catalogues we sign, and the official images.

Out of scope: a model or a connected app's own flaws (report those to their vendors), social engineering of our staff, denial of service by volume, and requests for hardening
advice (see the [hardening guide](docs/hardening.md)).

## Supported versions

Security fixes go out in the latest release, and nobody pays for them. The Supported install (see [`SUPPORT.md`](SUPPORT.md)) adds help applying a fix, not a different fix.
