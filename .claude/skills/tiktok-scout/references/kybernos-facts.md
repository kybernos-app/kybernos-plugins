# What Kybernos can truthfully say

Every claim in a scenario comes from this page and is listed under `Claims used` with its source. If a fact is not here,
it is not said: ask the person, or leave the product out of that line. Read from the repository on 2026-10-23; when the
product changes, change this page first. Kybernos is **beta**.

## Claims, in plain words

| Say | Source |
|---|---|
| Kybernos is a set of plugins that turns DSH (the DeepSeek harness) into an agent workspace: crews of agents with human approval, a models catalogue, skills, sessions and cloud memory. | `README.md`, first paragraph |
| It is local-first: your sessions, files, memory and keys stay on your computer. A page lists the few requests it makes by itself and how to switch them off. | `docs/privacy.md` |
| The plugin suite is open source (Apache-2.0). | `README.md`, `LICENSE` |
| Installing is one command from the downloaded archive (`./kybernos-install`), then `dsh web`. Needs Node.js 22 or later. | `README.md`, « Install » |
| **Kaby** is your assistant: a real chat with your account's memory, Telegram connected by QR code or link, and a cloud computer it works on. | `packages/kybernos-kyber/README.md` |
| Agent Teams: roles, a crew view, a run journal; a run can be held until a person approves. | `README.md`; `packages/kybernos-plugin/README.md` |
| **Automations**: tasks that run on a schedule (cron), once, or from a webhook, with a board showing what is running and what waits for approval. | `packages/kybernos-plugin/README.md`, « The Automations board » |
| Cloud computers for agents (E2B, you bring your own key). | `README.md`, bundles table |
| Slide decks, motion design (titles, charts, 3D, characters, sound, MP4 export), dashboards, brick mockups and 2D/3D models can all be made by chatting. | `README.md`, bundles table |
| Free language models of OpenCode Zen with no account and no API key. | `README.md`, `kybernos-free-llms` |
| Web search for the agents with or without an API key; local models installable from a panel (Ollama). | `README.md`, `kybernos-websearch`, `kybernos-modeles-locaux` |
| Voice calls from any chat session, to your assistant or a team member. | `packages/kybernos-call/README.md` |
| On a paid plan, a QR code links a phone to your computer, end to end encrypted. | `README.md`, `kybernos-mobile` |
| Search everywhere (⌘K) across chats, skills, memories, automations and agent teams; every ISO 639-1 language for the screens. | `README.md`, `kybernos-search`, `kybernos-language` |

## Demonstrable today (run it once before scripting it)

A screen-proof video needs a task that the person has run and timed. Candidates that the claims above support:

1. An automation that runs on a schedule and leaves its result on a dashboard.
2. A task sent to Kaby from Telegram and done on its cloud computer.
3. A slide deck, a motion clip or a dashboard made from one chat request.
4. An agent that stops and asks for approval before a step that matters.

Until the person has run it: the time, the output and every number are `[MEASURE: …]`.

## Do not say

- A user count, download count, star count, revenue, or a growth claim. There is none to quote.
- Anything about earnings: the reference videos promise money; Kybernos does not.
- A price, a plan's limits, or a date. Ask the person, who owns them.
- Kaby on **WhatsApp or WeChat** as if it worked: both read « Soon » in the product.
- « Fully private », « secure » or « unlimited ». Say exactly what stays on the machine (`docs/privacy.md`) and no more.
- That an agent « replaces » a person, or does a step without approval when it asks for one.
- A comparison that names a competitor.

## Look

The logo is a red K whose stem carries three white dots (the typing dots of a chat); colours `#f2372a` and white
(`docs/dev/brand.md`). The product is called Kybernos; the assistant, Kaby.
