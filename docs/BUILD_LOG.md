# Build log

Sunny was built solo for Colosseum's **Crypto World's Fair** hackathon (Sep 14 – Oct 12, 2026). I registered on **Oct 6**, three weeks in, so everything here was built in the last week of the window.

This log follows the git history. Times are local (UTC-5). Commits are small and describe the *why*, so `git log --reverse` reads as the story too.

## Oct 6, afternoon: from Tanda to Sunny

The first idea was **Tanda**: rotating savings circles (tandas, natilleras, juntas) on Solana, with collateral and an on-chain payment reputation. I built a working Anchor prototype in the early afternoon (create, join, contribute, payout, withdraw collateral, cancel). It's not in this repo. It worked, but it's a familiar idea, and it's hard to make people *feel* something about a savings protocol.

The pivot came from two trends meeting. AI companions were suddenly cute and everywhere (Meta's Muse, OpenAI's Dots), and AI agents were getting wallets. Nobody had made a companion that can **safely hold a little money**. That became Sunny: a small sun that guards your wallet and lives on an allowance a Solana program enforces. It's a spending card for AI agents, made lovable.

The design brief, from day one:
- Very beautiful, but its own thing.
- Lovely, but confident.
- Solana's colors only on things that are actually on-chain.

## Oct 6, 17:07–18:36 · Sunny comes alive

| Commit | What |
|---|---|
| `83296d7` | Mini App prototype: a plush SVG sun with moods and "wallet weather" skies |
| `b75299d` | Touch reactions, care meters (energy, mood, bond), Solana accents |
| `c0f80ea` | Realism layer: depth, a jelly body, living rays, light and physics |

## Oct 6, 22:25–23:02 · In Telegram, with real data

| Commit | What |
|---|---|
| `94bf640` | Telegram bot (@SunnySolBot) and Mini App hosting on a VPS at sunny.aivylabs.xyz, with TLS and a PM2 memory limit |
| `a77ebe8` | The bot runs without an AI key and replies in plain text (Telegram doesn't render Markdown) |
| `abf8cd7` | Chat inside the Mini App, sharing one conversation with Telegram. A separate "ask" screen felt like being sent somewhere else |
| `be3e022` | Live Solana data in chat through Jupiter tools. Also fixed a production crash loop (see below) |
| `21e440f` | Scam-link checks (MetaMask and Phantom lists, lookalike domains), price alerts, RugCheck, market mood |

## Oct 6, 23:16–23:35 · Scan anything, and pocket money on-chain

| Commit | What |
|---|---|
| `a268c3e` `a87576a` | Real wallet data, a "scan anything" inspector (Telegram's QR scanner, or paste), an activity log, and a home screen built on real data |
| `ec891f8` | The `sunny_pocket` program and its LiteSVM tests: limits, daily refill, freeze, agent-only draws to itself, owner control |
| `99d5ea5` `1bc0c2e` | Pocket money on the server, and a self-custodial **Sunny wallet** in the Mini App. It reuses the model from my Hedera wallet, OculusVault: Argon2id, XChaCha20-Poly1305, and the key never leaves the phone |

## Oct 7, 00:00–00:32 · First devnet run, then making it feel like Sunny

The first real devnet run failed: a brand-new wallet has 0 SOL and couldn't pay rent for its pocket. Fixing that, plus everything the run surfaced, came next. Then a round of product feedback: the wallet should feel like *part of Sunny*, not a fintech widget bolted on.

| Commit | What |
|---|---|
| `729c154` | A separate payer covers rent, so a new wallet can open a pocket (new test: `owner_needs_no_sol_to_open`) |
| `2119d79` | Readable refusals, one RPC call per pocket read, and an end-to-end devnet script |
| `15481f2` | Telegram CloudStorage made best-effort; Sunny no longer dozes off mid-chat |
| `0a01413` | Sunny always *attempts* the draw you ask for and lets the program judge |
| `38c215d` | "My wallet" needs no address: Sunny reads your history from the chain in plain words |
| `3095774` `f981bd2` | "Watch a wallet" instead of "Link". `/check`, `/pocket` and `/freeze` are live in the bot |
| `968953d` `29c765b` `62d871d` | Sunny makes your wallet *with* you on first open, in its own words. Pocket money became Sunny's **energy** in its care card. A "my wallet" card in chat |
| `647091b` | The e2e test finishes by asking Sunny what happened, and checks the answer against the chain |
| `cc81bed` `3e73b78` | Up to five watched wallets, combined into one wallet weather |
| `d1c40dc` | Guardrails: Sunny stays a Solana guardian (see the README) |

## Oct 7, 10:22–11:07 · A body, an outfit, and x402

| Commit | What |
|---|---|
| `73f8170` | This README and build log |
| `476cdfa` `29666ed` | Sunny gets chubby arms with mitten hands and bean feet, all driven by the existing mood and reaction animations (hands up when worried, hugging itself when frozen, happy kicks) |
| `b757893` `a760006` | A subtle Solana outfit: sneakers with the three-bar logo and a gradient sole, plus sweatbands |
| `41c9b8c` | **x402**: Sunny's deep scan becomes a paid API (x402 v2, `exact` scheme on Solana devnet, official SDK). The server verifies, scans, then settles, so a failed scan never charges anyone. Sunny is also a paying client |
| `a1d0966` | Sunny buys deep scans with its pocket money: draw from the pocket (limits apply), then pay over x402. The e2e test buys one too |
| `ff6975c` | Deep scan card in the chat, and a "Deep scan · $0.10" button in Scan & check |
| `4515210` | More memory headroom for the bot (the SDK added about 25 MB) |

## Oct 7, 11:14 · News and warnings

| Commit | What |
|---|---|
| `7ec08d1` | A news desk: six free sources every 15 minutes, labeled security, opportunity or news, flagged for Solana, deduped across feeds |
| `e4a2889` | Fresh Solana hacks and scams reach people in Telegram, with what to do; `/news`, `/news off`, `/news on`. Nobody gets old news on the first run |
| `092eb7c` | Sunny reads the news in chat: security first, opportunities without hype and always "not financial advice" |
| `c2f47a7` | A "What's happening" card on the home screen |

## Oct 7, 11:31–11:37 · Reaching more people: groups, mornings, sharing

| Commit | What |
|---|---|
| `badfb06` | **Group guardian**: Sunny guards Telegram groups from phishing links, fake airdrops and risky tokens, quietly and without the AI, with `/check` for everyone |
| `2c84e98` `a24e022` | **Good-morning ritual** in English or Spanish, and **visit streaks** on the Bond meter. Only real visits count as activity now |
| `a1d22f2` `d41e088` | **Share cards**: story-sized cards for a caught scam, a stopped draw or a deep scan, shared to Telegram Stories or a chat |

## Oct 7, 15:35–15:56 · Guardian upgrades: Blinks, stickers, badges

| Commit | What |
|---|---|
| `6baa1ee` `5bdf672` `003d973` | **"Should I sign this?"**: Sunny opens Blinks like a wallet, reads every instruction for drainer patterns, and simulates the transaction on mainnet against your watched wallet. It's in Scan & check, chat and groups, and a harmless scam-demo Blink shows it catching a drainer |
| `bb4eac2` | The status pill is tappable (feedback: "Give me a wallet to watch over" didn't do anything) |
| `5ad961f` `a2908b6` | A **Telegram sticker pack** of 12 poses captured from the real character, which Sunny sends at the right moments |
| `ec96f10` `2ccdb05` | **Good-habit badges**: six non-transferable Token-2022 tokens with on-chain metadata, minted on devnet when earned (checked on the server), and accessories Sunny wears |
| `837de62` | Fixed a 10-minute production crash loop the badge libraries caused, and made the deploy check catch crash loops |

## Oct 7, 16:07–16:48 · A QA round with four AI testers

Four Claude subagents tested Sunny in parallel, each from one angle, reporting only (no code changes):
- A security and backend auditor read the server, the on-chain program and the payment flows.
- A live tester sent edge cases to the production API, using test accounts only.
- A visual reviewer screenshotted every screen, mood and theme at phone size.
- A conversation tester ran 59 chats in English and Spanish.

Every finding was checked against the code before fixing.

| Commit | What |
|---|---|
| `567b35f` | **Remote crash:** one malformed account sent to the demo Blink could take the bot down. Fixed and deployed first |
| `b1a06ed` | **The Blink checker could be aimed at the server itself (SSRF).** Now it uses https only, public addresses only (re-checked on every redirect), reads at most 512 KB, and caps the transaction size. A dial.to wrapper can no longer make an unknown Action look verified |
| `b6a08c5` | **The phone's signing check now also verifies accounts, not just amounts.** A compromised server could have described a top-up honestly while sending the money to another pocket. A test reproduces the attack |
| `c6e6a60` | A new Sunny wallet signs a proof that it holds its key, so nobody can claim someone else's address and its test money |
| `0fb5b54` `97104c3` | **Wrong wallet data fixed:** a \$113k wallet read as \$506, a mistyped Token-2022 id, false alert bells, `$WIF`, and home and the wallet card disagreeing on risk |
| `487e160` `e728d00` | **Link checks:** `jupiter.ag` is no longer "official", `t.me`/GitHub pages are no longer trusted blindly, look-alikes like `jupp.ag` are caught, Solana Pay requests get the signing check, and mints can't be watched as wallets |
| `a169d45` `7912e2e` | **The brain:** Sunny never claims an action no tool confirmed. Real safety questions are no longer refused. A pasted seed phrase or private key never reaches the model. Answers are shorter and more honest |
| `a63b38c` | x402: CORS preflight for browser clients, and a 400 (not a 500) for incomplete payments |
| `d5bbe3f` `a006931` `92315c4` | **Mini App polish:** honest loading and error states, token tiles, Telegram colors that follow the sky, password forms, an "Open in Telegram" button for web visitors, contrast and accessibility |

## Oct 7 evening · Three ideas from the QA round

The visual reviewer suggested three ways to make Sunny more lovable. All three were built:

| Commit | What |
|---|---|
| `89028f1` `3331fb3` | **Feed Sunny by hand:** drag a honey coin onto Sunny. It opens wide as the coin comes close, munches, and the top-up is ready to sign. Opening a new pocket and its first money are one transaction, one signature (tested on devnet in the e2e run) |
| `07e8bd5` `2484166` | **Story cards that match the moment:** Sunny's pose is captured from the real character for each moment (alarmed with its shield, detective squint, sheepish blush, munching, frozen), and on-chain moments carry a Solana proof chip with the transaction's short id |
| `07e8bd5` `ffbc41a` `3331fb3` | **Bedtime:** Sunny dozes at night holding a little lantern, wakes to a warning with a yawn first, and the first visit of the morning opens with *While you slept* |

## Oct 7 night · Naps, dark mode, and a final QA round

| Commit | What |
|---|---|
| `c564226` | The sky dims when Sunny dozes off: a cloudy lavender dusk by day, night after dark (never hiding a storm) |
| `d9b605d` | **Dark mode, as the world through Sunny's sunglasses:** dark cards, a sky dimmed like a tinted lens, and Sunny in black shades that it lowers to peek over |

Then four more Claude testers ran in parallel: a code reviewer of everything since the first round, a usability tester walking first-time journeys with touch input, a visual reviewer in both themes, and an accessibility and performance auditor (axe-core, Lighthouse on a throttled phone, idle CPU). The fixes, all verified before landing:

| Commit | What |
|---|---|
| `63bb360` | A status warning could stay on screen for good (a reset timer was cleared by Sunny's next reaction); lines said behind an open sheet now show when it closes; no naps during a storm |
| `a46a954` | A failed wallet load no longer offers to make a new wallet (which could have overwritten Telegram's copy of the key); new wallets save to the server first |
| `4d70b94` | A "no thanks" right after Sunny offered a paid scan can never count as consent |
| `614c33b` `1e5efd2` `496847a` | Honest data: no false "fake site" alarms on names like tenor.com, one risk level for home and the wallet card, badge mints no longer listed as money, real numbers when Solana refuses a draw |
| `4a7b03d` `46aab6d` `ede5bb5` | Performance and accessibility: compressed delivery (first paint on a slow phone ~5.1 s → ~2.5 s), lighter fonts and badge images, wallet crypto loaded on demand, sheets as real dialogs, contrast that passes axe, spoken prices and scan results |

## Oct 8 · The pocket as a delegated allowance, then four AI judges

The pocket was reframed as what it is, a delegated allowance with on-chain guardrails, and drawn that way in the app and in [a diagram](media/guardrails.svg). Then four Claude agents judged the project as a Solana engineer, a consumer-product lead, an AI-safety red-teamer and an accelerator partner, each told to say what they love and hate. The red-teamer found the most serious issue: text inside a malicious Blink talked the model into offering a $4 "deposit" and calling the link verified. Everything below landed the same day:

| Commit | What |
|---|---|
| `459155c` | Refused draws land on-chain as failed transactions with the program's own error, so "Solana said no" can be checked |
| `54de013` | "Should I sign this?" simulates the token accounts a transaction loads through lookup tables (a drainer could have hidden them there) |
| `6ede641` | **Money moves only on the user's own words:** text from Blinks and news is quoted as data and blocks draws that turn; a draw needs the exact amount the user typed, one per message; an explicit "take $N" always goes to the program; a reply can't call a flagged Blink safe or claim money moved without a transaction |
| `eeaf049` `dbeed8c` | A paid scan that fails after the draw is refunded to the pocket; never-used, empty addresses are flagged as possible address poisoning |
| `82014d0` | An attack suite (malicious Blink text, fake prior approval, urgent $500, chat jailbreak): 5 of 5 stopped, the $500 refused on-chain |
| `7815458` | UI fixes from a final visual pass: an honest daily meter, the guardrails shown at the moment they're signed, a clearer first visit ("Sunny wallet" vs "watch any wallet"), refusals that look like refusals |
| `fb7b291` `a650ad1` | Web-preview guests share a demo pocket, so judges without Telegram see Solana refuse a $500 draw too; one tap adds Sunny to a group |

## Oct 8 afternoon · Sunny on Seeker

| Commit | What |
|---|---|
| `a181282` `32840da` | **Sign in with your own wallet outside Telegram** (Seed Vault through Mobile Wallet Adapter, or a desktop extension): a Sign In With Solana message, then that wallet owns the pocket and signs its transactions |
| `5f4bcc7` `44963ce` | Installable web app; the signed-in wallet is watched on mainnet, so the weather and Blink checks use its real balances |
| `08036ae` `44963ce` | **Android app** with Solana Mobile's webshell, tested in an emulator with their fakewallet; fixes for the keyboard covering inputs and the first request after a wallet hand-back |
| `008d88f` | dApp Store listing kit, privacy policy and terms; the APK is on the [v1.0.0 release](https://github.com/jmgomezl/sunny/releases/tag/v1.0.0) |

## Oct 8, 13:54–16:32 · A second review round, Android 1.0.1, live numbers and CI

Another round of parallel AI reviewers (QA, UX, bug hunting and a judge) went over the new wallet sign-in and the Android app, and each finding was checked before it was fixed. Then a review of the repo asked for four things: refunds that survive a restart, an install anyone can reproduce, proof that the tests run, and the pocket's limits stated plainly.

| Commit | What |
|---|---|
| `b052117` | Security fixes: free wallet sign-ins share daily cost ceilings, each signed sign-in works once, odd input is refused instead of crashing, a repeated submit returns the first result |
| `c4d9e78` | Red team round 2: negations ("don't take $5"), hypotheticals and quoted words never move money; saying yes only counts when Sunny really offered |
| `61b9c10` `aa9ffe3` | Blink checks without a watched wallet still name the SOL sent, approvals and authority hand-overs your wallet would sign |
| `756d588` `759f883` | The group guardian speaks Spanish, token names can't advertise scam links, and Sunny answers honestly about custody, urgency and wallets' own warnings |
| `8ecbb59` `d2a5dfc` | UX review: guests get one tap to watch Solana say no, the demo pocket explains only its own rule, refusals are two sentences |
| `4798b4c` `fb8eafc` `6a5080e` | Android QA: Back closes Sunny's sheets, a transaction read more than 15 s ago is prepared again before signing, a wallet that leaves without answering doesn't hang the app; **[v1.0.1](https://github.com/jmgomezl/sunny/releases/tag/v1.0.1)** |
| `6c90914` | README claims made exactly as true as the code: the guarantee is the daily ceiling, and the Seeker build is tested in an emulator |
| `ba424ef` `304d0b6` | **[Live numbers](https://sunny.aivylabs.xyz/stats/)**: groups guarded, checks and catches, and the pocket program's record read straight from Solana |
| `91cc1c9` | The repo review: refunds queued on disk and retried for about two hours, Node and pnpm pinned, devnet checked before any funding, and the warnings kept at the top of the README |
| `d05ea14` → `42a7083` | **[CI on every push](https://github.com/jmgomezl/sunny/actions/workflows/ci.yml)**: 42 server tests, the web build, and the program build with its 7 LiteSVM tests |

## Decisions, and why

- **Money rules live in a program, not in the prompt.** A model can be talked into things; a program can't. Sunny is told to always *try* the draw you ask for, because watching Solana refuse a $500 draw is the whole point.
- **Sunny pays the fees.** The server is the fee payer for every transaction, so a new user never needs SOL to start.
- **Your key stays on your phone. The server holds Sunny's.** The owner key is generated and encrypted on the device, and the server only ever holds ciphertext. Sunny's agent key has to live on the server, because Sunny acts while you sleep. That's exactly what the pocket bounds: per-payment and daily limits, its own account only, and a freeze switch.
- **Check what's signed on the device.** The phone decodes every transaction the server prepares and refuses anything unexpected, so even a compromised server can't trick you into signing a transfer.
- **Two kinds of wallet, named clearly.** Your *Sunny wallet* is yours, self-custodial. *Watched wallets* (up to five) are read-only. "Link wallet" was confusing, so it became "Watch a wallet".
- **Claude Haiku 4.5 through OpenRouter.** It's fast and cheap, and reliable at tool calls. The model is one line in `.env`.
- **x402 with the official SDK, settled in-process.** Sunny's server is the resource server and its own facilitator, so it can verify, run the scan and only then settle. That means a failed scan costs nothing, and it works with our devnet test USDC. Any standard x402 client can pay the same endpoint.
- **Every purchase goes through the pocket.** Before paying an API, Sunny draws the price from your pocket, so the program's limits and freeze cover what it buys, not just what it takes.
- **Warn loudly, suggest softly.** A story is labeled security if the headline *or* its teaser mentions a hack or scam, because missing one is worse than a false alarm. It's only called an opportunity if the headline itself says so, and Sunny always adds that it's news, not advice.
- **No AI in groups.** In a group, anyone can type anything, so Sunny only runs deterministic checks there and stays silent unless it finds a real problem. A group raid can't make it spam: one warning per link per hour, and 20 an hour per group.
- **Only real visits count.** Background work (alerts, the morning note) used to refresh 'last seen'. Now only chatting or opening the Mini App does, so the streak and 'active users' are honest.
- **A harmless drainer for the demo.** Most live Blinks in the registry are dead, and real drainers shouldn't be linked to. Sunny's demo Blink behaves exactly like one in simulation, but needs a signature that is never given, so nobody can lose anything to it.
- **Badges the server earns for you.** Every badge condition is checked on the server (the pocket on-chain, watched wallets, the visit streak, habits it saw), and the tokens are non-transferable, so they mean something.
- **Gentle guardrails.** Blocked attempts get a friendly refusal and only a short break, because curious people (and judges) will poke at it.
- **A refund is a record, not a promise.** If a paid scan fails after the draw, the refund is written to disk first, then retried for about two hours across restarts, and the outcome shows in "What Sunny did".
- **Android through Solana Mobile's webshell.** Mobile Wallet Adapter works inside it, and the app loads the live site, so a fix reaches phones without a new store build.

## Problems I hit, and the fixes

| Problem | Fix | Commit |
|---|---|---|
| Anchor 1.2 builds SBPF v3 by default, which devnet and LiteSVM reject | Always `anchor build --arch v0` | `ec891f8` |
| Production bot in a crash loop: esbuild renamed `AbortSignal`, breaking the OpenAI SDK's checks | `--keep-names`, PM2 restart backoff, and a post-deploy health check | `be3e022` |
| Sunny said it had cancelled an alert without calling the tool | Actions only count when a tool confirms them; a nudge makes the model use the tool | `21e440f` |
| New wallet with 0 SOL couldn't pay pocket rent | A `payer` account, paid by Sunny's fee wallet | `729c154` |
| The program upgrade failed because the program grew by 144 bytes | `solana program extend` before upgrading, and SOL reclaimed from failed buffers | — |
| Refusals showed as "transaction failed" | Anchor error codes parsed from both hex and decimal forms | `2119d79` |
| Public devnet RPC returned 429s | Four reads batched into one `getMultipleAccountsInfo` | `2119d79` |
| Telegram CloudStorage throws outside Telegram and on old clients, which blocked wallet creation | Version check, try/catch and a 2-second timeout; the server backup still holds the ciphertext | `15481f2` |
| Sunny declined a $500 request itself, so nobody saw the program work | The persona sends every request to the program | `0a01413` |
| Devnet's token program no longer logs instruction names | Transactions decoded by Anchor discriminator and parsed SPL instructions | `38c215d` |
| Batched RPC replies arrived out of order and mislabeled transactions | Matched by signature | `38c215d` |
| The model sometimes went silent right after a tool call | It's asked once for its answer | `cc81bed` |
| The Telegram first name went into the system prompt, so anyone could rename themselves "Ignore your rules…" | Names reduced to plain letters before they reach the prompt | `d1c40dc` |
| The x402 client refused to pay in our test USDC: its spend controls only allow known assets | Allow exactly our test-USDC mint, capped at $0.50 a request | `41c9b8c` |
| nginx capped `/api/` bodies at 16 KB, too small for a story card | A dedicated `/api/share` location with room for one image; the rest stays at 16 KB | `a1d22f2` |
| The production bot crash-looped after the badge release: `@solana/spl-token` pulls in native bindings that expect `__filename`, missing in an ESM bundle. The deploy check passed because a crash loop looks 'online' for a moment | The bundle defines `__filename` and `__dirname`; the deploy check now requires 15 s of uptime | `837de62` |
| Most Blinks in Dialect's registry no longer answer, so there was no live drainer to test on | A harmless scam-demo Blink, plus unit tests on hand-built drainer transactions | `6baa1ee` |
| The x402 SDK pushed the bot close to its 160 MB PM2 limit | Measured at 138 MB in production; limit raised to 240 MB for Sunny's process only | `4515210` |
| Back did nothing in the Android app while a sheet was open: Chrome skips history entries added without a tap | The shell asks the page through a small `window.sunnyBack` bridge | `4798b4c` `6a5080e` |
| Signing a minute after reading a transaction failed: its blockhash had expired | A transaction older than 15 s is prepared again, and must still say the same thing | `4798b4c` |
| The stats page answered 403: the deploy skipped every `index.html`, nested ones too | Anchored excludes | `304d0b6` |
| CI: pnpm 12 refuses a frozen install when the lockfile doesn't record the pinned pnpm, and fails on install scripts nobody approved | Lockfiles regenerated; esbuild approved, three optional native add-ons declined | `d05ea14` `8909fed` |

## How it was tested

- **Program:** 7 LiteSVM tests (`cargo test -p sunny_pocket`).
- **CI:** every push runs the server, web and program jobs ([Actions](https://github.com/jmgomezl/sunny/actions/workflows/ci.yml)).
- **Server:** 42 tests (`pnpm test`), including wallet sign-in and the refund queue.
  - The phone's transaction verifier, including what a compromised server might try (wrong wallet, foreign pocket).
  - Guardrails, covering attacks, pasted seeds and keys, and the ordinary questions that must still pass.
  - News, groups, streaks and the Blink reader.
- **End to end:** `scripts/e2e-devnet.ts` runs against the live server on devnet as a fresh Telegram user:
  - Wallet and faucet.
  - Open the pocket and top up.
  - Draws inside and over both limits.
  - Freeze, unfreeze and withdraw.
  - Then "what happened in my wallet?".
- **By hand:** each flow walked through in a phone-sized browser, signed in as a real Telegram user (signed `initData`), including red-team prompts against the live model.
- **QA rounds with AI testers** (Oct 7, above), each finding verified before it was fixed, then **four AI judges** and a second review round (Oct 8).
- **Attack suite:** `scripts/attack-suite.ts` tries 10 ways to talk Sunny into spending or calling a scam safe, including injection hidden in a Blink, negations, hypotheticals, consent smuggling and a drainer with no wallet to simulate against; 10 of 10 stopped.
- **Android:** the APK in an Android 16 emulator with Solana Mobile's fakewallet: sign in, faucet, open and fund the pocket, a draw refused on-chain, Back, slow signing and a wallet that never answers. Not yet on a real Seeker.

## Still to do before Oct 12

- First testers and groups (their numbers show on the [stats page](https://sunny.aivylabs.xyz/stats/)).
- The pitch and demo videos, then submission.
- After the hackathon: one-tap revoke of risky approvals, a real Seeker test, mainnet after an audit.
