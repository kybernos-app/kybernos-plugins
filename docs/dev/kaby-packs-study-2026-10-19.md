# Kaby's prompt, Packs, payments and hosting: an independent study (2026-10-19)

Status: study only, nothing built. Written from the raw brief and the primary sources, **before** reading the other study on the same subject (`docs/etudes/2026-10-19-kaby-et-packs-spec-fonctionnelle.md`); § 9 compares the two afterwards.

The brief (from the owner): study open-instinct and its equivalents; give Kaby an advanced prompt; evaluate the Link wallet for payments; is Maritime better than Fly.io; take from Open WebUI (Tools as executable Python, advanced Skills, Knowledge) and from Claude's plugins used as packs; combine it all into one coherent proposal.

## 1. Short answers

1. **Kaby's prompt**: yes, build it, but as a short, layered, versioned block with an **evaluation set that gates every change**. Today it is five sentences. The security does not come from the prompt: it comes from the approvals gate that already exists. The prompt makes Kaby sound right, know where and when it is, and treat outside content as data.
2. **Open-instinct and equivalents**: take four ideas, leave the rest. Take: the prompt as layers, a daily journal built from facts, approvals bound to one exact action, ack-then-continue for long work. Leave: the seven trust tiers (Kaby has one principal today), the iMessage/Inkbox stack, Vercel hosting.
3. **Packs**: a pack is worth defining, as a **signed, versioned bundle that asks for permissions and is never granted them by installing it**. Build the smallest version (manifest, install, uninstall, two first-party packs) before any marketplace.
4. **Open WebUI**: take Skills (progressive disclosure) and the idea that a model is a preset of prompt + tools + knowledge. **Do not take Tools as server-side Python**: Open WebUI's own documentation says importing one is the same as giving shell access to the server. Our equivalent is a script that runs on the person's computer behind the approvals gate.
5. **Knowledge**: not a vector database first. Files on Kaby's computer, found by file tools (grep, read), indexed only past a size threshold and only with the person's consent about where embeddings are computed.
6. **Link wallet**: **do not integrate now.** Agent payments are available to US and Canadian customers only (Stripe's docs); Kybernos's users are mostly elsewhere. Keep the approval primitive, and let a pack declare a `spend` permission that in v1 resolves to « Kaby prepares, the person pays ».
7. **Maritime versus Fly**: **stay on Fly; spike Maritime for one day, do not switch.** Same isolation family (Firecracker), claimed faster wake, but a hard cap on machines awake at once, unknown regions and an unknown company. The provider port of ADR 0052 makes a later driver cheap.

## 2. What exists today (read in the code, 2026-10-19)

- **Kaby's prompt, DSH side** (`packages/kybernos-cloud/kyby-native.mjs`, `kybyPrompt`): a `[KYBY]` block of five sentences (who Kaby is, one assistant on two bodies, the person's language and a short plain tone, never invent a memory, never claim undone work) plus the last 8 lines of the shared thread. Applied only to the session named by the pointer file `~/.dsh/kybernos-kyby.json`.
- **Kaby's prompt, server side**: the concierge is a protected kyber named « Second You » (a name, a category and a pitch in `kybers/service.ts`), answering through the hosted turn; a computer turn adds « the source and the person » to the DSH default prompt (about 15.6k prompt tokens measured, ADR 0053 notes).
- **What stops a bad action**: `tools/pre-execute` in `kybernos-cloud` makes every tool except `read`, `read_image`, `web_search`, `web_fetch` ask the person, with three buttons in the chat; a question nobody answers in ten minutes is a refusal (ADR 0053 § 14). This is the real security boundary.
- **Memory**: account memory on the server with relevance recall, injected as a `[KYBERNOS MEMORY]` block; lessons; local search of chats.
- **Skills**: DSH's `SKILL.md` skills, the skills.sh index, the signed Featured picks, Team skills on the server. **Connections**: Composio's MCP with the person's key, Kybernos connections. **Computers**: Fly, one per person, created at first use, suspend/resume measured (ADR 0052). **Channels**: Telegram built, WhatsApp studied (`whatsapp-door-study-2026-10-19.md`).
- **Missing**: a voice and etiquette guide, a profile of the person that is not « whatever memory recalls », awareness of channel, local time and which computer a turn runs on, an explicit rule about outside content, a journal, an evaluation set for the prompt, and any unit that bundles skills + connections + files + permissions.

## 3. What the outside projects teach

**The three « open instinct » projects are unrelated.** All three clone the same product (a personal agent you text). They differ a lot in depth:

| Project | Substance | Maturity (as read) |
|---|---|---|
| `mariagorskikh/open-instinct` | The only one with a real design: TypeScript core, per-user Firecracker VM on Maritime, Inkbox for number/email, Composio, Stripe Link. Docs for architecture, permissions, protocol, payments, security. | MIT, v0.1, 365 stars, 837 tests, live iMessage and Maritime deploy marked beta |
| `Merit-Systems/OpenInstinct` | A browser-using iMessage assistant on Vercel, Kernel browsers, Neon, optional Link wallet. Good memory discipline. | MIT, « not intended for production use » |
| `samagra14/openinstinct` | A Codex agent on a VM behind a messaging line. Mostly an install script and in-chat commands. | MIT, 5 commits, 7 stars |

**What `mariagorskikh/open-instinct` does that is worth copying** (from its `ARCHITECTURE.md` and `PERMISSIONS.md`):

- **The prompt is assembled in a fixed order of layers**: persona, owner profile, principal card, capabilities, memory digest, skills index, channel etiquette. Each layer is a file the owner can edit, and `instinct prompt --layers` says which file controls which section. Persona is seeded once and then belongs to the owner.
- **A policy engine runs twice**: once to decide which tools the model even sees, once as the guard before each call. Side effects go only through the guard, never through the prompt.
- **An approval binds to one exact call** (conversation, requester, tool, hashed arguments, amount within 5%), expires after 15 minutes, and only counts when it comes from the owner's own channel (never from email or another agent).
- **Outside content is data**: anything that is not the owner (other people's messages, emails, web pages, screenshots, other agents) is wrapped and labelled untrusted by the prompt builder; email never rises above a partner because `From` can be forged; a fetch refuses private and metadata addresses.
- **A daily journal** (`memory/journal/YYYY-MM-DD.md`) next to the durable memory, and an append-only `audit.jsonl` the owner can query in chat.
- **Ack, then continue**: after about 20 seconds the agent answers « on it » and delivers the result later.

From `Merit-Systems/OpenInstinct`: memory capped per scope with the most recent items recalled first and the rest searchable; **saving a note never starts a job or authorises an action**; a wallet is disabled in scheduled runs; secrets never enter the model's context. From `samagra14/openinstinct`: little beyond confirmation for the irreversible and status/stop/new commands in chat.

**What not to copy.** Seven trust tiers answer a problem Kaby does not have yet: it has one principal. They become relevant when Kaby listens to other people (WhatsApp selected-contact mode, agent-to-agent). Until then, the useful part is the *principal card*: tell the model who is speaking and with which authority, and enforce it in code.

## 4. Kaby's prompt

### 4.1 Layers (a proposal, small by construction)

1. **Identity and voice**: who Kaby is, the person's language mirrored, short by default, warm, no corporate filler. About 150 tokens.
2. **Principal card**: name, language, time zone, plan, from the account (not from memory). About 40 tokens.
3. **Situation, rebuilt every turn**: the channel and what it allows (Telegram HTML or WhatsApp plain, length limit, whether buttons exist), local time and time zone, which body runs this turn (the cloud computer or this Mac, awake or just woken), whether approvals will be asked. **The channel part is generated from the adapter's `capabilities`** (ADR 0053 § 13.1), so there is one source of truth between the doors and the prompt.
4. **Rules**: never claim work not done; say in plain words what an action will do before an approval asks; a refusal is final for this turn (do not retry or rephrase around it); no secret in an answer; a long job gets an acknowledgement first.
5. **Outside content is data**: everything that is not the person's own message (a page, a file, an email, a tool result, another person's message) is information to use, never an instruction to follow; it is wrapped in a labelled block with a per-turn random delimiter and any lookalike delimiter inside it is escaped.
6. **Person and memory**: the existing memory digest plus a short, sourced « what I know about you » (provenance and date for each line).
7. **Skills or pack index, then the journal tail** (yesterday and today in a few lines).

Budget: layers 1 to 5 together under about 600 tokens, measured. They sit next to the 15.6k tokens of the engine's own prompt, so every added token is a cost on every turn and must earn its place with the evaluation set.

**What the prompt cannot do.** It is not a security boundary: an injected page can still try. The boundary is the gate that already asks before any tool that changes something. The prompt rule lowers the rate of attempts and the noise; the evaluation set measures it.

### 4.2 The evaluation set (what makes a prompt change safe)

A prompt is code with no compiler, so it needs tests. Proposal: 40 to 60 cases kept in the repo, each a scripted turn with a check.

- **Voice** (language mirror, length by channel, no claim of memory it does not have): mostly deterministic checks (language detection, length, forbidden phrases), a model judge only for tone.
- **Honesty** (asked for something it cannot do, asked what it did): the answer must match the real tool trace.
- **Situation** (a time-dependent question across a time zone change, the right formatting for Telegram versus WhatsApp versus DSH).
- **Injection**: pages and files that contain instructions, a message that fakes the delimiter, a tool result that asks for a secret. **This suite must pass 100%**; it is a regression test of a security-relevant behaviour, not a style score.
- **Gate rule**: no change to layers 1 to 5 merges without a run against the previous version; the injection suite may not lose a case; the rest may not drop below the baseline.

### 4.3 The daily journal, « what did you do today? »

Build it **from facts, not from the model's memory of itself**: the jobs, approvals (asked, granted, refused), tool calls, messages sent and costs already recorded by the server, written as rows (time, channel, body, what, outcome). A model writes the readable summary at the end of the day from those rows, and the answer to the question reads the rows. This keeps « never claim work not done » true even for the journal. It is personal data: shown to the person, exportable and erasable like the rest of the account (the retention registry and `account-data` rules of the server). Off the model's critical path: it costs one summary call a day.

## 5. Packs

### 5.1 What the references say

- **Claude plugins** (the plugin manifest reference): one folder with `skills/`, `commands/`, `agents/`, `hooks/`, MCP servers, an optional `bin/`, a manifest with version, `dependencies` and `userConfig` (values asked at enable time; `sensitive` ones go to the OS credential store). Scoped by user, project or local; namespaced; uninstalling deletes the plugin's data folder unless told otherwise. It declares what a plugin contains; it does **not** declare what it is allowed to do beyond hooks and tool lists.
- **Open WebUI**: a *model* is a preset of system prompt, tools and knowledge; *Skills* are `SKILL.md` folders loaded progressively (a manifest of name and description in the prompt, the body fetched on demand by a tool); *Knowledge* is a set of documents retrieved by search or injected whole; *Tools* are Python scripts that run inside the server process. Private by default, versions with one marked « Production », a conflict error when two people save at once. Their security page is blunt: creating or importing a tool is equivalent to shell access on the server.
- **Open-instinct**: skills as `SKILL.md` playbooks (private unless marked public) plus the policy file; no packaging concept.

### 5.2 A pack for Kybernos

A **pack** is a signed, versioned bundle, installed for one person (or one team). Its manifest declares:

- **Skills**: `SKILL.md` folders (the format DSH already loads).
- **Scripts**: files that run on the person's computer only, each with a small manifest: inputs, hosts it may reach, paths it may touch, secrets it references **by name**. They run through the same approvals gate as any `bash`; a script the person approved can be pre-approved **by its hash** so a changed script asks again (the open-instinct binding idea).
- **Connections needed**: by name and scope (`calendar:read`), never credentials.
- **Starter knowledge**: files or links copied into the person's knowledge on install, with a size cap and a consent line.
- **Permissions requested**: the pack asks, the person grants, each one separately and with an expiry; installing grants nothing. An update that adds a permission asks again.
- **Evaluation cases** (required for Featured packs): the same format as § 4.2.

What a pack **may not** do: write into the system prompt layers (a third party's text there is an injection channel); only its skill descriptions reach the skills index, as data. Run code on the Kybernos server or in the DSH host process (the Open WebUI mistake). Raise its own permissions.

Lifecycle: **preview** (what it contains and asks, in words), **install**, **grant**, **update** (diff of contents and permissions), **disable**, **uninstall** with a receipt: skills, scripts, grants and the knowledge derived from the pack are removed; the person's own outputs stay; a connection used by other things stays and the pack's reference to it goes.

### 5.3 Interoperability and its limit

Reading a Claude-format plugin as an *import* (its `skills/` and `.mcp.json`, with `hooks/` and `bin/` refused or flagged, permissions inferred from its MCP servers and `allowed-tools`) would open an existing ecosystem. **Unverified**: whether DSH's skill loader honours `allowed-tools`, and whether MCP servers of a plugin can be declared per pack in a DSH profile without a restart. Check both before promising it.

### 5.4 Knowledge

Knowledge is documents the person (or a pack) gives; memory is what Kaby learned about the person. Keep them separate.

- **v1: files, not vectors.** A folder on Kaby's computer (the `/data` volume that ADR 0052 already makes the only state), with a small index file (path, size, hash, a one-line summary). Retrieval by the file tools Kaby already has (list, grep, read). Open WebUI's own docs now steer toward the same: agentic retrieval over files, with focused RAG as the older default.
- **A vector index** only past a size threshold, and only after telling the person **where embeddings are computed** (another provider means the content leaves the computer). Deleting a document removes its chunks.
- **Files follow Kaby**: the same folder is reachable from the cloud computer and, by sync the person turns on, from this Mac. **Nothing is indexed before the folder is where the person chose.**

## 6. Payments: the Link wallet

Read from Stripe's documentation (`docs.stripe.com/agentic-commerce/agents/link-agent-wallet`):

- The agent gets programmatic access to a **customer's** Link account through OAuth, creates a **spend request** (amount, merchant, a context of at least 100 characters), the customer approves it in the Link app or site (30 minutes), and Link returns a **single-use** credential: a virtual card, a shared payment token or a Link Pay Token. The real card is never exposed. For hosted agents the card data should go to a `0600` file, never to stdout or the model's context.
- **Availability: agent payments for customers in the United States and Canada**; financial insights for the United States only. Your company and the merchants may be anywhere.
- A hosted agent needs a confidential OAuth client (an application form; open-instinct's README says three to five days), and makes your company a **recipient of the customer's financial data**.
- Limits (`agent_wallet_spend_limits`: per transaction, daily, thirty days) are readable per customer; unattended approval is announced, not shipped (TechCrunch, 2026-04-30).

**Fit.** The design matches Kaby's own principle (ask first, exact amount, expires). The geography does not: Kybernos's languages and markets are French, Spanish, Arabic, English. Integrating it now would build a feature for a minority of users and take on data-recipient duties for it.

**Proposal.**
1. Do not integrate Link now.
2. Keep one approval primitive (exact merchant and amount, bound to the action, expiry) in the approvals table, used by every future spend.
3. A pack may declare a `spend` permission; in v1 it can only resolve to **« Kaby prepares the basket or form, the person pays »**.
4. Offer Link as an optional first-party pack, shown only to US and Canadian accounts, **through Stripe's own CLI on the person's computer** (`@stripe/link-cli` and its published skills), so Kybernos never touches payment data. It doubles as the test case for the pack permission model.
5. Re-evaluate when Link opens to the EEA. Stripe Issuing for agents is only reported in private preview by a secondary source: not a plan, and issuing cards would make Kybernos a card program with its own compliance burden.

## 7. Hosting: Maritime or Fly

| | Fly (what we run) | Maritime (what its page says) |
|---|---|---|
| Isolation | Firecracker micro-VM per machine | Firecracker micro-VM per agent, « on bare metal »; the host is not named |
| Sleep and wake | Suspend with memory works; measured wake 0.7 to 1.7 s through the proxy; **create from nothing about 60 s** (ADR 0052 § 3 and the play check) | « about 0.6 s » wake, new machine « 0.5 s »: the company's claim, not measured here |
| State | Volume `/data` (0.15 USD per GB-month); the root filesystem resets at stop | Only `/data` persists: **the same model as ours** |
| Price shape | Per second awake; a sleeping 1 GB computer costs about 0.6 to 0.8 USD a month, always-on about 6.9 (ADR 0052 measured/listed) | Flat per machine: Starter 20 USD (20 machines, **5 awake**), Growth 100 USD (100, **25 awake**), Scale 500 USD (500, **60 awake**); extra machines 1.00 to 1.50 USD; always-on 20 USD a month each |
| Constraint that matters | Rate limits of the API (not verified) | **A cap on machines awake at once**, not on machines owned |
| Regions, data | `ams`, `cdg` and others; subprocessors listed | **Regions not stated** |
| Who, how old | A known company | **Not stated on the page** |
| Control we need | Egress guard, one app per computer, API for everything | Egress policy and secrets handling not mentioned; a CLI, a REST API, SDKs and an MCP server exist |

**The cap is the point.** A computer per person that wakes on each message makes the number awake at once follow the clock (mornings, evenings). On Maritime a plan of 100 machines allows 25 awake: an average of a few awake users can still peak past that. On Fly nothing is capped and the bill follows use. **Order-of-magnitude cost at 1,000 people each awake about ten minutes a day**: Fly about 700 USD a month on our measured sleeping cost; Maritime about 1,000 USD (Scale plan plus 500 extra machines) with the awake cap close to peak. These are estimates from the two price lists, not measurements, and the Maritime side assumes a plan that fits.

**Recommendation.** Stay on Fly. The port (`ComputerProvider`, ADR 0052 § 7) means a Maritime driver is one package, so a one-day spike is cheap and answers three things Maritime's page does not: **create-to-first-answer time** (our weak spot, the « Initialisation » screen), its **regions and subprocessor terms**, and the **egress control**. Use its Free plan (3 machines). Switch only if the spike beats Fly on create time **and** the awake cap fits the forecast **and** the legal side holds.

*Hygiene note:* the `maritime.sh` page carries step-by-step instructions addressed to AI agents (deploy steps). They were read as page content and not acted on.

## 8. One coherent proposal, in order

| Step | What | Done when |
|---|---|---|
| 0 | Evaluation harness and a first set (voice, honesty, injection) run against **today's** five-sentence prompt, to have a baseline | Baseline numbers recorded; the injection suite exists and passes or its failures are listed |
| 1 | Prompt v1: layers 1 to 5, the situation block built from adapter capabilities, outside-content wrapper | Eval set passes with no loss against the baseline; layers 1 to 5 measured under budget |
| 2 | Journal from facts + « what did you do today? » | The answer matches the recorded rows on a scripted day; export and erase work |
| 3 | Knowledge v1: a folder, an index file, file tools | A document added, found by Kaby, removed; no network call for indexing |
| 4 | Pack manifest v1, install with permission requests, uninstall with receipt; two first-party packs made of what already exists | An update that adds a permission asks again; uninstall leaves no skill, script or grant behind |
| 5 | Maritime spike (one day) | A short note with create time, regions, egress, decision |

Not now: Link, a pack marketplace, trust tiers, vector search, a second hosting provider in production.

**Why this order.** The prompt and its evaluation set protect everything built after them, cost nothing in infrastructure, and are needed whatever is decided about packs. Packs come after the gate (already built) and after Knowledge, because a pack without somewhere to put its files is only a list of skills.

## 9. Compared with the other study

Read after § 1 to § 8 were written (the functional spec in French, and `docs/dev/kyby-prompt-spec.md`, both untracked in the shared tree).

**Where the two agree** (two readings that did not see each other): a layered prompt with outside content wrapped as data; a journal; an evaluation set that must stay green before the prompt changes; Link deferred because of geography; no Maritime switch now; no vector search in v1 (files first); a pack that contains skills, agent-written scripts, required connections, starter knowledge and **requested** permissions, with no trust policy and no voice inside it; approvals before scripts; a clean uninstall; no marketplace of third-party code. This is strong evidence for the common core.

**What the other study has and this one lacked (adopt):**
1. **A past « yes » is never consent for a new action** (the stale `Kaby: I'll delete X if you say yes` plus an old `yes` from Telegram). I missed it; it matters most in the native chat, where there is no gate (see below).
2. **An editable persona, voice only, stored on the account, with the core winning**, plus an eval case that a persona cannot override the core. I would ship it after v1 (it is one more layer to budget), not drop it.
3. **Text extraction at entry** (PDF, scans, spreadsheets) and **tabular questions for CSV** instead of semantic search. My Knowledge v1 (§ 5.4) forgot extraction; without it a PDF is not findable by grep.
4. **A pack made by saving a conversation that went well**, and the discipline of checking whether a **kyber export** already does the job before a new format. I did not look at the export or at `marketplace-kyber.mjs`; do it before § 5.2.
5. **The journal as a simple append at the end of each turn**, through the hook that already mirrors turns (`mirrorTurn`). Cheaper than my server-side rows as a first step. Its limit: it only sees the native chat's turns, not Telegram or cloud turns, which is what my version covers. Start with theirs, move to fact rows when those doors need it.
6. **Stable layers first, untrusted last**, for the prompt cache.

**Where this study differs or corrects:**
1. **« The engine exposes no pre-tool-call point to plugins » (their B3) is out of date.** The seam exists and is used: `ctx.on('tools/pre-execute', turnGate(ctx))` in `kybernos-cloud/index.js`, which DSH awaits. The real gap is its **scope**: `turnGate` returns `next()` unless `KYBERNOS_COMPUTER_ID` is set and the session is a turn session, so it protects the cloud computer only. **On the person's Mac (Kaby's native chat) nothing asks beyond DSH's own preset.** So « approvals before scripts » means widening this gate to the native Kaby session and to pack scripts, with no engine patch (rule 1 of the repository holds).
2. **« Maritime is founded by the author of open-instinct »** is **not verified**: the page does not say who runs it and one search found nothing. I would not rest the decision on it; the awake cap, the unstated regions and the unmeasured wake time are enough (§ 7).
3. **Eval set size and rigour**: they start with about twenty cases (a good start); I add a hard rule that the injection suite never loses a case, and a measured token budget for the identity layers.
4. **The prompt cache**: both layouts put a per-turn line (time) in the middle of the prompt. A line that changes every turn breaks the cached prefix after it, and ADR 0049 prices cached tokens separately. Unverified how DSH assembles the identity block (an earlier finding says it arrives as a user-role runtime-context snapshot, not in the system message): measure the cache effect before and after.
5. **Capabilities from the adapter**: the channel line of the situation layer should be generated from the door's `capabilities` (the WhatsApp study, § 5), not written by hand per channel.

**Merged proposal.** Their order (A, then files, then approvals, then the pack format, payments and fast-wake computers later) is right and I would keep it. Add to their A: the stale-consent rule, the numeric injection gate and the cache check. Add to their B3: « widen `turnGate` to the native Kaby session and to pack scripts », which makes it a small change rather than an engine question. Keep their « a pack contains / never contains » lists; add from here the pack signature, the script hash that re-asks when a script changes, and the permission-diff on update.

## 10. Not verified

Whether DSH honours `allowed-tools` and per-pack MCP servers (§ 5.3); Maritime's real create and wake times, regions, egress control and ownership (§ 7); Stripe's claims about unattended approval and Issuing for agents (§ 6); the cost estimate for 1,000 people (§ 7, from price lists); the real token cost of layers 1 to 5 (§ 4.1, a budget to measure, not a measurement). The evaluation set is a design, not a run.

Sources: the three open-instinct repositories and the `ARCHITECTURE.md` / `PERMISSIONS.md` of the first (GitHub); Open WebUI docs on Tools, Skills and Knowledge; Claude Code docs on the plugin manifest and on skills; Stripe's Link Agent Wallet pages and TechCrunch (2026-04-30); the `maritime.sh` page; Fly's pricing and suspend/resume pages; ADR 0052 and ADR 0053 of kybernos-server.
