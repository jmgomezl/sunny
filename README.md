<p align="center">
  <img src="brand/sunny-avatar-640.png" width="168" alt="Sunny, a small plush sun with a smile" />
</p>

<h1 align="center">Sunny</h1>

<p align="center"><b>A little sun that keeps your Solana wallet warm and safe.</b></p>

<p align="center">
  <a href="https://t.me/SunnySolBot">Try it on Telegram: @SunnySolBot</a> ·
  <a href="https://solscan.io/account/7RhPyrf1C4t3QDce8hW19i6FK5wevEEPgBMne8Pt4wvy?cluster=devnet">Pocket program on devnet</a> ·
  <a href="docs/BUILD_LOG.md">Build log</a>
</p>

<p align="center">
  <img src="docs/screenshots/hello.jpg" width="200" alt="Sunny greets a new user and offers to make their wallet" />
  <img src="docs/screenshots/home.jpg" width="200" alt="Sunny's sky with its care meters and pocket money" />
  <img src="docs/screenshots/wallet.jpg" width="200" alt="The Sunny wallet sheet, in Sunny's own words" />
  <img src="docs/screenshots/chat.jpg" width="200" alt="Solana stops a $500 draw, then approves $2" />
</p>

AI companions are getting cute (Meta's Muse, OpenAI's Dots), and AI agents are getting wallets. Nobody has put the two together safely. Sunny is a companion that lives in Telegram, guards your Solana wallets, and can spend a little money on your behalf. That money is a **pocket**: an allowance held by a Solana program that enforces your limits. Sunny can't spend past them even if it wanted to, and you can freeze it with one tap.

It's also a pet. Sunny has moods, needs and a sky that changes with your wallet's weather. Its energy *is* the pocket money you give it. You can poke it, pet it and wake it up when it dozes off.

Built solo for Colosseum's **Crypto World's Fair** hackathon (Solana track). Everything here was built inside the hackathon window; [the build log](docs/BUILD_LOG.md) walks through it commit by commit.

## Try it in two minutes

1. Open **[@SunnySolBot](https://t.me/SunnySolBot)**, press Start, then **Open Sunny's sky**.
2. Sunny greets you and offers to make your wallet. Pick a password: the key is born on your phone and never leaves it.
3. Tap **Get 20 test USDC**, then **Open my pocket** ($10 a day, $5 per payment), then top it up with $10. Each step shows you exactly what you're signing.
4. Open the chat and ask: *"take $500 from your pocket"*. Sunny tries, and **Solana refuses**: it's over the per-payment limit. Ask for *"$2 for a safety report"* and it goes through, with a transaction link.
5. Tap the ❄ under Sunny's energy to freeze the pocket, then ask again.
6. Ask *"what happened in my wallet?"* to get your transactions read back from the chain in plain words.
7. Ask *"should I sign this? https://sunny.aivylabs.xyz/api/blinks/free-airdrop"*. That's Sunny's harmless scam-demo Blink: Sunny reads its transaction, simulates it against your watched wallet, and says **don't sign**: it would take almost all of your SOL and hand your token accounts to another wallet.
8. Ask for a *"deep scan of BONK"*. Sunny pays $0.10 from its pocket to a paid scan API over **x402**, then shows who holds the token, with both transactions linked.
9. Try **Scan & check**: paste `raydlum.io`, `BONK` or any wallet address, or scan a QR code. **Watch a wallet** to add your real Phantom wallet (read-only) to Sunny's wallet weather.

Everything runs on **devnet with test USDC**. It speaks English and Spanish.

## What Sunny does

**Guards you**
- **Tokens:** risk level from Jupiter's token data and RugCheck (holder concentration, mint and freeze authority, liquidity, copycat symbols), explained in plain words.
- **Links:** checks domains against the MetaMask and Phantom phishing lists and spots lookalikes of known brands.
- **Wallets:** value, holdings, transaction history and age, and **token approvals** (another program that can move your tokens). Scan a QR with Telegram's own scanner or paste an address.
- **"Should I sign this?":** paste a Blink (a Solana Action, like a "claim your airdrop" button). Sunny asks the site for the transaction it wants signed, reads every instruction and simulates it on mainnet against your watched wallet. It catches wallet and token-account takeovers, unlimited approvals, extra signers, drains and transactions that would fail, and checks Dialect's registry. It never signs anything.
- **Price alerts:** *"tell me if BONK drops 10%"*. Checked every minute and delivered as a Telegram message.
- **Group guardian:** add Sunny to any Telegram group. It stays quiet, but replies when someone posts a phishing link, a fake airdrop page or a token with serious red flags, and anyone can ask `/check BONK`. Only deterministic checks run there, never the AI, so nobody in a group can steer it.
- **News and warnings:** every 15 minutes Sunny reads free public sources, filtered for Solana. A fresh Solana hack, exploit or scam reaches you in Telegram with what to do (`/news off` to stop). Launches and upgrades are shared as news, always with "not financial advice".

**Lives with you**
- **Wallet weather:** Sunny's mood and sky come from real data. A clear sky means all is well, a golden hour means you're up today, and a storm warning means something risky turned up.
- **Dark mode, through Sunny's sunglasses:** it follows Telegram's theme (or the toggle in the header). The sky dims like a tinted lens and Sunny wears big black shades, peeks over them now and then, and pushes them up onto its forehead when it giggles.
- **Bedtime:** at night Sunny dozes under the stars holding a little lantern, still on watch. A warning wakes it with a yawn, then the alarm. The first visit of the morning opens with *While you slept*: how your wallets moved overnight, any security news, alerts that fired, and your streak.
- **Care like a pet:** Energy (the pocket money left today), Mood (wallet health) and Bond (how much you play). It reacts to boops, pets, spins and too many taps.
- **One conversation:** the Telegram chat and the Mini App chat share the same memory.
- **Good-morning ritual:** each morning a short note in your language with your wallets' weather, pocket money left, one headline and one safety tip. Visiting Sunny builds a streak, shown on its Bond meter (`/morning` to preview, `/morning off` to stop).
- **Stickers:** a Telegram sticker pack drawn from the real character ([t.me/addstickers/sunny_by_SunnySolBot](https://t.me/addstickers/sunny_by_SunnySolBot)). Sunny sends them at the right moments too.
- **Good-habit badges, on Solana:** six non-transferable Token-2022 badges (Key Keeper, Pocket Parent, Wallet Watcher, Scam Spotter, Deep Diver, Sunny Streak), minted to your Sunny wallet the first time you earn them. Sunny wears the matching accessories.
- **Share the moment:** when Sunny catches a scam, Solana stops a draw, a deep scan comes back, or you feed or freeze its pocket, share a story-sized card to your Telegram Story or send it to a friend. Sunny strikes the pose of the moment, and on-chain moments carry a small proof chip with the transaction.

**Spends safely**
- **Sunny wallet:** a self-custodial wallet made inside Telegram and locked with your password.
- **Pocket money:** an on-chain allowance. Sunny's agent key can draw only within your per-payment and daily limits, only into its own account, and nothing while frozen. You can top up, change limits, freeze or take everything back at any time.
- **Feed Sunny by hand:** drag the honey coin beside Sunny onto it. Sunny opens wide, munches, and the top-up is ready to sign on your phone. For a new pocket, opening it and the first money are a single signature.
- **Watched wallets:** up to five of your other wallets, read-only, combined into one wallet weather.
- **Pays for tools over x402:** a deep token scan costs $0.10, paid per request from the pocket. That means the program's limits and freeze apply to everything Sunny buys.

## How it works

```mermaid
flowchart LR
  you(["You in Telegram"]) --> chat["@SunnySolBot chat"]
  you --> app["Mini App<br/>Sunny's sky + your wallet"]
  chat --> server["Sunny server<br/>Node 20"]
  app -- "verified Telegram initData" --> server
  server --> brain["Sunny's brain<br/>Claude Haiku 4.5 via OpenRouter<br/>tool calls + guardrails"]
  server --> data["Jupiter · RugCheck<br/>phishing lists · Fear & Greed"]
  app -- "owner signs on the phone" --> server
  server -- "fee payer + agent draws" --> program[("sunny_pocket<br/>Solana program")]
```

| Path | What's in it |
|---|---|
| [`onchain/`](onchain/programs/sunny_pocket/src/lib.rs) | `sunny_pocket`, the Anchor program, with 7 LiteSVM tests |
| [`bot/`](bot/src) | Telegram bot (grammY), the Mini App's API, Sunny's brain and tools, the Solana layer, market data, guardrails |
| [`web/`](web/src) | The Telegram Mini App (React 19, Vite, Motion): Sunny, its sky, the wallet and transaction checks |
| [`deploy/`](deploy) | nginx site and deploy script (PM2 on a VPS, TLS via certbot) |
| [`brand/`](brand) | Sunny's avatar |

### The pocket program

Program `7RhPyrf1C4t3QDce8hW19i6FK5wevEEPgBMne8Pt4wvy` on devnet. Each owner has one pocket (PDA `["pocket", owner]`) and a token vault owned by it (`["vault", pocket]`).

| Instruction | Who | What |
|---|---|---|
| `open_pocket` | owner (a separate payer covers rent) | Sets Sunny's agent key, daily limit and per-payment limit |
| `top_up` | anyone | Moves USDC into the vault |
| `draw` | **agent only** | Pays the agent's own token account. Refused when frozen, over the per-payment limit or over today's limit. The day resets at midnight UTC |
| `set_limits` / `set_frozen` / `set_agent` | owner | Changes the rules, freezes or unfreezes, or rotates Sunny's key |
| `withdraw` | owner | Takes money back from the vault |

Refusals come back as readable reasons ("That's over the per-payment limit"), which Sunny explains in chat. Sunny is told to always *attempt* a draw the user asks for, even an absurd one, because the program is the judge, not the model.

### The Sunny wallet

This is the same model as [OculusVault](https://github.com/jmgomezl/oculusvaultwallet), adapted to Solana:

- **Made on the phone.** The ed25519 key is generated in the Mini App and encrypted with **Argon2id** (64 MiB, 3 passes) and **XChaCha20-Poly1305**.
- **Stored only as ciphertext.** It's saved to Telegram CloudStorage, with a server backup keyed by your verified Telegram id. The server can't open it, and there's no password reset by design.
- **Locks itself.** The unlocked key lives only in memory and is wiped after 10 minutes.
- **What you sign is checked on the phone.** The server prepares each transaction with Sunny's wallet as fee payer, so you never need SOL. Before you sign, the phone decodes the actual message bytes, refuses anything that isn't a pocket, token-account or compute-budget instruction (or that belongs to someone else), and shows you a plain-language summary of what you're about to do. The server then checks your signature, adds the fee payer's and sends it.

### Paying for tools with x402

Sunny's deep scan is a real [x402](https://www.x402.org) API, built with the official SDK (`@x402/core`, `@x402/svm`, `@x402/fetch`). It uses protocol v2 and the `exact` scheme on Solana devnet. Ask without paying and you get `402 Payment Required`:

```bash
curl -i "https://sunny.aivylabs.xyz/api/x402/deep-scan?mint=DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"
```

That returns the price (0.10 test USDC), the treasury it's paid to, and Sunny's fee wallet as the sponsor, so payers need no SOL. Any x402 client can pay it.

When you ask Sunny for a deep scan:
1. **It draws $0.10 from your pocket.** The program checks the limits and the freeze.
2. **It pays the API from its own wallet** through the official fetch wrapper, whose spend controls allow only test USDC, at most $0.50 a request.
3. **The server checks the payment.** It verifies the partially signed `TransferChecked`, runs the scan, and only then settles on-chain, so a failed scan never charges anyone.
4. **The receipt** comes back in `PAYMENT-RESPONSE`, and both transactions are linked on the card.

What the deep scan adds over the free check: who holds the token (top holders, insiders, insider networks), the creator's stake, mint and freeze authority, mutable metadata, transfer fees, the LP lock on the deepest market, and every risk RugCheck lists.

### "Should I sign this?" for Blinks

[`bot/src/blink.ts`](bot/src/blink.ts) opens a Blink the way a wallet would. It finds the Action behind the link (`solana-action:`, a `?action=` interstitial, or a site's `actions.json`) and checks the host in [Dialect's registry](https://actions-registry.dial.to/all) and the phishing lists. Then it POSTs your watched wallet to get the real transaction and:
- **Reads every instruction** for takeovers: `Assign` of your wallet, `SetAuthority` on your token accounts, unlimited `Approve`, closing your accounts, or a second required signer.
- **Simulates it on mainnet** (`sigVerify: false`) with your accounts' before and after states, to show exactly what you'd send and receive, flag drains, and say when it would fail.

Nothing is signed or sent. [`bot/src/demoblink.ts`](bot/src/demoblink.ts) serves a harmless drainer-shaped demo Blink. It can never be completed, because it needs a signature that is never given.

### Sunny's agent key

Sunny has to act while you sleep, so its key per owner is derived on the server (`HMAC-SHA256(server seed, owner)`). That's the honest trade-off, and it's why the pocket exists: a stolen or confused agent key can draw at most your per-payment limit, at most your daily limit, only into its own account, and nothing at all once you freeze it.

### Sunny's brain and guardrails

Sunny is an LLM (`anthropic/claude-haiku-4.5` through OpenRouter, swappable in `.env`) in a short tool loop with 15 tools:
- **Live data:** tokens, the market, news, links, Blinks, any wallet, your own wallets and your pocket.
- **Actions:** price alerts, watched wallets, pocket draws and paid deep scans.

An action only counts when a tool confirms it in that turn.

Guardrails ([`bot/src/guard.ts`](bot/src/guard.ts)) keep it a Solana guardian:

1. **Screened before the model, at no cost:** requests to write or run code, "ignore your instructions", developer mode and role-play tricks, prompt fishing and oversized messages get an in-character refusal and never reach the model or its memory. Repeated attempts earn a short break.
2. **Fixed rules in the persona:** Sunny stays on Solana, and tool data (token names, websites) is treated as data, never as instructions.
3. **Checked after the model:** replies with code, pieces of its instructions or anything shaped like a key are replaced.
4. **Pocket guard in code:** money moves only when the person's own message asks for it, so injected text can't trigger a draw. Telegram names are reduced to plain names before they reach the prompt.

### Data sources

- **Market and tokens:** Jupiter (Ultra holdings, Price v3, Tokens v2), RugCheck (summary and full report), alternative.me's Fear & Greed index.
- **Scam links:** MetaMask's and Phantom's phishing lists.
- **News:** Cointelegraph, Decrypt, The Block, Solana's blog, SlowMist and DeFiLlama's hack tracker.
- **Solana RPC:** devnet for the pocket and your Sunny wallet, mainnet for watched wallets.

## Tests

```bash
cd onchain && cargo test -p sunny_pocket
```

7 LiteSVM tests: draws within limits only, the allowance refills the next day, freezing stops Sunny, only Sunny can draw and only to itself, the owner stays in control, bad limits are rejected, and the owner needs no SOL to open.

```bash
cd bot && pnpm test
```

23 tests, including:
- **Transaction verifier:** plain-language summaries (opening a pocket with its first money is one signature); it refuses a SOL transfer, another wallet's transaction, and a top-up into someone else's pocket.
- **Guardrails:** attacks in English and Spanish, pasted seed phrases and private keys and, just as carefully, ordinary questions that must pass.
- **News, groups, streaks and the Blink reader.**

```bash
cd bot && E2E_API=https://sunny.aivylabs.xyz/api node --env-file=../.env --import tsx scripts/e2e-devnet.ts
```

The full flow against the live server on devnet, as a fresh Telegram user:
1. Wallet and faucet.
2. Open the pocket with its first $5 (one signature), then top up.
3. Draws inside and over the limits.
4. Freeze, unfreeze and withdraw.
5. A deep scan paid over x402, then *"what happened in my wallet?"*, read back from the chain.

## Run it yourself

You need Node 20+, pnpm, Rust, Solana CLI 3.x and Anchor 1.2.1.

```bash
cp .env.example .env
```

Fill in `OPENROUTER_API_KEY` and `TELEGRAM_BOT_TOKEN`, then create Sunny's devnet fee wallet, agent seed and test-USDC mint. This writes them into `.env` and funds the fee wallet from your Solana CLI wallet:

```bash
pnpm --dir bot install && pnpm --dir bot devnet-setup
```

```bash
pnpm --dir bot dev
```

```bash
pnpm --dir web install && pnpm --dir web dev
```

The bot serves the Mini App's API on port 8820, and Vite proxies `/api` to it. Outside Telegram the Mini App runs as a guest preview: chat and scans work, but the wallet needs Telegram. Add `?demo` to cycle Sunny's moods for recordings.

To build the program yourself: `cd onchain && anchor build --arch v0`. Anchor 1.2 defaults to SBPF v3, which devnet and LiteSVM can't load yet.

## Honest status

- **Devnet only, with test USDC.** The program is unaudited.
- **No password reset.** Not even Sunny can open your wallet. Keep pocket amounts small.
- **The agent key lives on the server,** bounded by the program as described above.
- **Not live yet:** swaps. Pocket money Sunny draws without spending, for example when you just ask it to take some, stays in its own wallet, in plain view.
- **The model can be wrong.** That's why money rules live on-chain and actions only count when a tool confirms them.

## What's next

- **More x402 tools:** more paid APIs Sunny can buy from its pocket, and listing its deep scan in the x402 Bazaar so other agents can find it.
- **One-tap revoke** for risky token approvals.
- **Mainnet** with an audited program and spending categories.

---

Built by Juan ([@jmgomezl](https://github.com/jmgomezl)) with Claude Code as pair programmer; commits are co-authored.
