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

## Oct 7, 11:10–12:20 · News and warnings

| Commit | What |
|---|---|
| `7ec08d1` | A news desk: six free sources every 15 minutes, labeled security, opportunity or news, flagged for Solana, deduped across feeds |
| `e4a2889` | Fresh Solana hacks and scams reach people in Telegram, with what to do; `/news`, `/news off`, `/news on`. Nobody gets old news on the first run |
| `092eb7c` | Sunny reads the news in chat: security first, opportunities without hype and always "not financial advice" |
| `c2f47a7` | A "What's happening" card on the home screen |

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
- **Gentle guardrails.** Blocked attempts get a friendly refusal and only a short break, because curious people (and judges) will poke at it.

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
| The x402 SDK pushed the bot close to its 160 MB PM2 limit | Measured at 138 MB in production; limit raised to 240 MB for Sunny's process only | `4515210` |

## How it was tested

- **Program:** 7 LiteSVM tests (`cargo test -p sunny_pocket`).
- **Server:** 8 tests (`pnpm test`).
  - The phone's transaction verifier, including what a compromised server might try.
  - Guardrails, covering attacks and the ordinary questions that must still pass.
- **End to end:** `scripts/e2e-devnet.ts` runs against the live server on devnet as a fresh Telegram user:
  - Wallet and faucet.
  - Open the pocket and top up.
  - Draws inside and over both limits.
  - Freeze, unfreeze and withdraw.
  - Then "what happened in my wallet?".
- **By hand:** each flow walked through in a phone-sized browser, signed in as a real Telegram user (signed `initData`), including red-team prompts against the live model.

## Still to do before Oct 12

- A morning brief, and one-tap revoke of risky approvals.
- First testers.
- The pitch and demo videos, then submission.
