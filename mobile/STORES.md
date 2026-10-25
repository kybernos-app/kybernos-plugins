# Store review: where the Kybernos app stands (2026-10-25)

Not a guarantee: only a submission settles it (TestFlight external review is the first real signal, then Play internal testing). This is what the current rules say, read on 2026-10-25, against what the app does today. Re-read the rules before each submission: both stores change them often.

Sources: [Apple App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) (the page was read up to 5.2.5), [Google Play Device and Network Abuse](https://support.google.com/googleplay/android-developer/answer/9888379), [Google Play AI-Generated Content](https://support.google.com/googleplay/android-developer/answer/13985936).

## What is on our side

- **No downloaded native code.** The engine, the plugins and the Node library are all inside the app (the payload is a file of the binary). Google Play bans downloading executable code (dex, JAR, .so) from outside Play, with an explicit exception for code run by an interpreter such as JavaScript. Apple 2.5.2 bans downloading or executing code that introduces or changes the app's features: ours ships in the bundle.
- **No processes launched.** Commands run in an in-process shell (`kybernos-no-process`), inside the app's own sandbox.
- **16 KB page alignment** of the native libraries (Play requires it for recent target levels), arm64 only, `INTERNET` the only permission.
- **Apple allows an interpreter without a JIT.** The embedded V8 runs jitless.

## What can fail, and what to decide (each is a real risk, not a certainty)

| # | Risk | Rule | Proposed answer |
|---|---|---|---|
| 1 | **Plugins the user installs** (Suite › Plugins: from GitHub, npm, a file, or drafted by the AI) are downloaded code that adds features. | Apple 2.5.2 and 4.7 (non-embedded plug-ins must be HTML5/JavaScript, expose no native API, share no data without consent, be indexed with links, respect age rating and in-app purchase). Play: interpreters are exempt, but untrusted loaded code must not violate policy. | **On the store build, install only plugins carried by the app** (or a signed catalogue reviewed by us). No AI-written plugins on iOS. Keep the full registry on desktop. |
| 2 | **An agent that writes and runs code or commands.** | 2.5.2 (code that changes features) | It runs inside the app sandbox, in a virtual shell, and never replaces the app's own code. Say so in the review notes. Medium risk, mostly a question of explanation. |
| 3 | **Prompts and files go to a third-party AI** (Anthropic, with the user's own key). | Apple 5.1.2(i): disclose where personal data is shared with third parties, including AI, and obtain explicit permission. Play: data safety form. | **Consent screen BUILT (2026-10-25)**: shown once before the engine even starts (nothing runs, nothing listens on loopback until « I agree », checked on the emulator and the simulator), names the provider (Anthropic by default), versioned, withdrawable from Settings. Still to do: the privacy policy address (`ConsentScreen` takes it as a prop and shows the link once there is one; `/legal/privacy` on the server still carries five « verify before publication » markers), privacy labels and the data safety form. On iOS the agreement lives in the Keychain, which survives a reinstall (as the key does); Android's goes with the app. |
| 4 | **AI content.** | Apple 1.2 (AI content creation apps: filtering, report, block, contact); Play AI-Generated Content (in-app way to report or flag offensive output, for chatbots; summarising and productivity apps are described as outside it, which an agent app may or may not be). | A **report button on AI answers**, in the app, sending the report to us; terms and a contact address. |
| 5 | **Selling plans inside the app** (« See plans », « Create an account » are in the account menu). | Apple 3.1.1: subscriptions and unlocks must use in-app purchase (3.1.3 lists the few exceptions; outside the US storefront the app may not push users to another payment method). | Decision for the owner: **no purchase flow in the iOS app** (bring your own key, free), or in-app purchase. Do not ship the plans link on iOS by accident. |
| 6 | **Accounts.** If the app lets a person create an account. | Apple 5.1.1(v): deletion from inside the app. | Add account deletion before offering sign-up in the app. |
| 7 | **Foreground service** for background automations on Android (built in M5: type `specialUse`, off by default, a visible notification). | Play: each service needs a declared type and a Play Console declaration; a service that WorkManager could do is refused; `dataSync` is only exempt with Play Asset Delivery. | `specialUse` is declared with its justification text in the manifest and must be declared again in the Play Console (with a short video). It is optional, switched on by the person, and stoppable from the app. Expect scrutiny: the question will be why WorkManager is not enough (an engine that must keep a process alive is not deferrable work). |
| 8 | **Wording and identity.** The first-run dialog still says « DeepSeek Harness 0.2 Preview Notice » (the engine's own text) and the interface says « BETA ». | Apple 4.1 (impersonation) and 2.1 (finished apps) are the nearest rules | **Engine notice hidden in the app (2026-10-25)**: the `kybernos-plugin` client shadows the `welcome-notice` entry also when the user agent is `KybernosHost/<v> (ios\|android)` (control and fix seen on the simulator; it ships with the next payload build). Still to do: the « BETA » badge decision, our own name everywhere, third-party licence notices screen. |
| 9 | **Privacy manifest** (iOS) for « required reason » system APIs that Node and V8 call (file timestamps, disk space, boot time). | Apple privacy manifest requirement | Generate it from a scan of the binary; declare the reasons. |

## Order of work (M6)

1. Decisions 1, 5 and 6 above (they change the product, not the paperwork).
2. ~~Consent screen (3)~~ and ~~notice replacement (8)~~ are built; the report button on AI answers (4) is not (it lives in the web interface, so in a plugin).
3. Privacy manifest (9), data safety form, privacy policy, review notes explaining the engine, the sandbox and where the code lives.
4. TestFlight external review and Play internal testing, in parallel.
