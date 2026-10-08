<p align="center">
  <img src="brand/sunny-avatar-640.png" width="150" alt="Sunny, a small plush sun with a smile" />
</p>

<h1 align="center">Sunny</h1>

<p align="center"><b>An AI pet that guards your Solana wallet,<br/>and spends only from a delegated allowance with on-chain guardrails.</b></p>

<p align="center">
  <a href="https://t.me/SunnySolBot"><img alt="Live on Telegram" src="https://img.shields.io/badge/live-@SunnySolBot-29a9eb?logo=telegram&logoColor=white" /></a>
  <a href="https://solscan.io/account/7RhPyrf1C4t3QDce8hW19i6FK5wevEEPgBMne8Pt4wvy?cluster=devnet"><img alt="Solana program on devnet" src="https://img.shields.io/badge/Solana-program%20on%20devnet-9945ff?logo=solana&logoColor=white" /></a>
  <img alt="x402 payments" src="https://img.shields.io/badge/x402-v2%20payments-14f195" />
  <img alt="Tests" src="https://img.shields.io/badge/tests-36%20passing-2f8f5b" />
  <a href="docs/BUILD_LOG.md"><img alt="Build log" src="https://img.shields.io/badge/built%20in-the%20hackathon%20window-ffb43c" /></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-2f6fb0" /></a>
  <a href="https://github.com/jmgomezl/sunny/releases/tag/v1.0.0"><img alt="Android app" src="https://img.shields.io/badge/Android%20%2F%20Seeker-APK-3ddc84?logo=android&logoColor=white" /></a>
</p>

<p align="center">
  <img src="docs/media/wallet-weather.gif" width="300" alt="Sunny's moods follow your wallet: clear, golden hour, storm, hungry, a quiet night" />
</p>

<p align="center">
  <b><a href="docs/media/sunny-tour.mp4">▶ Watch the 2-minute tour</a></b> ·
  <b><a href="https://t.me/SunnySolBot">Try it in Telegram</a></b> ·
  <b><a href="https://sunny.aivylabs.xyz/?demo">Web preview, no login</a></b> ·
  <a href="docs/BUILD_LOG.md">Build log</a>
</p>

---

## In 30 seconds

**Scams start in chat, not in the wallet.** Phantom and Blockaid warn you at the moment you sign. Sunny warns you earlier, when the link lands in your Telegram chat or group, explains it in plain words, and turns checking into a daily habit. And when an AI acts for you with money, its rules belong on-chain, not in a prompt. Three ideas:

| The problem | Sunny's answer | See it | Proof |
|---|---|---|---|
| Drainers and phishing take real money every day. | **"Should I sign this?"** Paste a Blink: Sunny fetches the transaction it wants signed, reads every instruction and simulates it on mainnet against your real balances. Plus scam-link checks and a Telegram group guardian. | [GIF](#should-i-sign-this) | [demo drainer Blink](https://sunny.aivylabs.xyz/api/blinks/free-airdrop) |
| An AI with a wallet can be tricked into emptying it. | **A delegated allowance with on-chain guardrails** (Sunny calls it its pocket money). You fund it; Sunny's key can spend it only within your per-payment and daily limits, only into its own account, and nothing once you freeze it. A Solana program checks every payment, not the model. | [GIF](#solana-says-no) | [open + fund tx](https://solscan.io/tx/3dcahHAPBweY3LHP1rczy7G63UMQ5WTw1hxZ4i4jp1Bdrh51kVTfBzJkXkB3HyBSfZNZ1K91mw2SYGxhEBNMUAKS?cluster=devnet) · [$2 draw tx](https://solscan.io/tx/66o1vXgqhANnNPb5dkLAKNrjyxyQE4VjdB6Qbez1vfHR62SLijPYnrwJff34xguS1WAVtu1ZdCYEBB389vd5EYHA?cluster=devnet) |
| Agents need to pay for tools without a card. | **x402 payments from the pocket.** A deep token scan costs $0.10, paid per request over x402 v2, so the program's limits apply to everything Sunny buys. | [GIF](#solana-says-no) | [x402 payment tx](https://solscan.io/tx/5Ge1mcrz7jhvfNW15ikR6hUkXMES7S7Ah5yA88bNq1B1j9Yq2hVFzjNKmLxaynMnkJnbkqcQwikvUgbhnt3J1Avw?cluster=devnet) · `curl` below |

<p align="center">
  <img src="docs/media/guardrails.svg" width="860" alt="Pocket money is a delegated allowance with on-chain guardrails: you fund it and set the rules, Sunny can spend within them, and someone talking Sunny into taking $500 is refused by the program, on-chain" />
</p>

And it's a pet people want to open every day. Its energy *is* the pocket money you feed it, its sky is your wallet's weather, it sleeps with a lantern, and it wears sunglasses in dark mode.

**Everything above is live** at [@SunnySolBot](https://t.me/SunnySolBot) on Solana **devnet with test USDC**. Market data, watched wallets and Blink simulations use **mainnet**. Built solo for Colosseum's **Crypto World's Fair** (Solana track), entirely inside the hackathon window; the [build log](docs/BUILD_LOG.md) goes commit by commit.

---

## Try it in 60 seconds

**In Telegram (the full experience):** open **[@SunnySolBot](https://t.me/SunnySolBot)** → **Start** → **Open Sunny's sky**. Then:

1. Sunny offers to make your wallet. Pick a password: the key is born on your phone and never leaves it.
2. Tap **Get 20 test USDC**, then **drag the $5 coin onto Sunny**. Opening its pocket and feeding it is one signature.
3. Open the chat and say *"take $7 from your pocket"*. **Solana refuses**: it's over the $5 per-payment limit. Say *"take $2"* and it goes through, with a transaction link.
4. In **Scan & check**, paste `https://sunny.aivylabs.xyz/api/blinks/free-airdrop` (Sunny's harmless drainer demo) or `raydlum.io` (a real phishing site).

**On a Seeker or any Android phone:** open [sunny.aivylabs.xyz](https://sunny.aivylabs.xyz) in Chrome, or install the **[Android app](https://github.com/jmgomezl/sunny/releases/tag/v1.0.0)** (APK, 2 MB), and tap **Connect wallet**. You sign in with the wallet already on the phone (Seed Vault on a Seeker, or Phantom and Solflare) through Mobile Wallet Adapter, and **that wallet owns the pocket**: no Sunny wallet, no password, the same on-chain guardrails. On a computer, a wallet extension works the same way.

**No Telegram and no wallet?** Open the **[web preview](https://sunny.aivylabs.xyz/?demo)**. The chat and every check work, and the chips at the top (keys 1–5) cycle Sunny's moods. Guests share a **demo pocket on devnet** with the same guardrails, so *"take $500 from your pocket"* gets the same on-chain refusal, with its transaction link.

---

## See it working

Recorded from the real app, talking to real Solana devnet and mainnet. The full tour is [one 2-minute video](docs/media/sunny-tour.mp4).

<table>
  <tr>
    <td align="center" width="50%" valign="top">
      <a name="feed-sunny"></a><b>Feed Sunny by hand</b><br/>
      <img src="docs/media/feed-sunny.gif" width="260" alt="Drag a $5 coin onto Sunny; it opens wide, the wallet shows what you're signing, and the pocket opens with $5 in one signature" /><br/>
      <sub>Drag the coin. Sunny opens wide, the wallet shows exactly what you'll sign, and the pocket opens with $5 in one signature. A Pocket Parent badge is minted on Solana.</sub>
    </td>
    <td align="center" width="50%" valign="top">
      <a name="solana-says-no"></a><b>Solana says no</b><br/>
      <img src="docs/media/solana-says-no.gif" width="260" alt="Asked for $7, Sunny tries and the on-chain program refuses; $2 goes through" /><br/>
      <sub>"Take $7" goes over the per-payment limit, so the <b>program</b> refuses and Sunny explains why. "Take $2" is approved, with its transaction.</sub>
    </td>
  </tr>
  <tr>
    <td align="center" valign="top">
      <a name="should-i-sign-this"></a><b>"Should I sign this?"</b><br/>
      <img src="docs/media/should-i-sign.gif" width="260" alt="A 'free airdrop' Blink is simulated against a real wallet: it would take its SOL and hand over 4 token accounts" /><br/>
      <sub>A "free airdrop" Blink, simulated against a real wallet's balances: it would take 0.215 SOL and hand 4 token accounts to someone else. <b>Don't sign.</b></sub>
    </td>
    <td align="center" valign="top">
      <b>Watch a wallet</b><br/>
      <img src="docs/media/watch-a-wallet.gif" width="260" alt="Pasting a real $105k wallet; Sunny flags a risky token and the sky turns stormy" /><br/>
      <sub>Paste any wallet (read-only). Sunny reads a real $105k wallet, flags a high-risk token, and its sky turns to a storm.</sub>
    </td>
  </tr>
  <tr>
    <td align="center" valign="top">
      <b>Scam caught</b><br/>
      <img src="docs/media/scam-caught.gif" width="260" alt="raydlum.io is found on the phishing blocklists" /><br/>
      <sub><code>raydlum.io</code> is on the MetaMask and Phantom phishing lists. Sunny sounds the alarm, and you can share the catch as a story card.</sub>
    </td>
    <td align="center" valign="top">
      <b>Dark mode, through Sunny's sunglasses</b><br/>
      <img src="docs/media/dark-mode.gif" width="260" alt="Switching to dark mode: Sunny spins and puts on sunglasses" /><br/>
      <sub>"Shades on 😎 Too bright out there anyway." It follows Telegram's theme, and Sunny peeks over its shades now and then.</sub>
    </td>
  </tr>
  <tr>
    <td align="center" valign="top">
      <b>Bedtime</b><br/>
      <img src="docs/media/bedtime.gif" width="260" alt="At night Sunny sleeps with a lantern; a scam check wakes it with a yawn, then an alarm" /><br/>
      <sub>At night Sunny dozes with its lantern, still on watch. A warning wakes it with a yawn, then the alarm. Mornings open with <i>While you slept</i>.</sub>
    </td>
    <td align="center" valign="top">
      <b>Share the moment</b><br/>
      <img src="docs/media/story-cards.jpg" width="320" alt="Four story cards: scam caught, deep scan, Solana stopped Sunny, first pocket money" /><br/>
      <sub>Story-sized cards for Telegram Stories, in the pose of the moment. On-chain moments carry a proof chip with the transaction.</sub>
    </td>
  </tr>
</table>

### Screenshots

<p align="center">
  <img src="docs/screenshots/feed-sign.jpg" width="190" alt="You're about to: open Sunny's pocket and put $5 into it" />
  <img src="docs/screenshots/pocket-opened.jpg" width="190" alt="Pocket opened, with a link to Solscan" />
  <img src="docs/screenshots/guardrails.jpg" width="190" alt="Sunny's guardrails: up to $5 a payment, up to $10 a day with what's left, only into Sunny's account, freeze anytime" />
  <img src="docs/screenshots/guardrail-held.jpg" width="190" alt="Solana stopped a $7 draw: guardrail held, per-payment limit" />
</p>
<p align="center">
  <img src="docs/screenshots/approved.jpg" width="190" alt="Took $2 of pocket money, approved by your pocket rules" />
  <img src="docs/screenshots/should-i-sign.jpg" width="190" alt="Should I sign this? Don't sign: you'd send 0.215 SOL" />
  <img src="docs/screenshots/wallet-report.jpg" width="190" alt="A watched wallet's report: high risk, 21 tokens, 3,000+ transactions" />
  <img src="docs/screenshots/storm.jpg" width="190" alt="Wallet weather: risk found, storm sky" />
</p>
<p align="center">
  <img src="docs/screenshots/scam-caught.jpg" width="190" alt="Known scam: raydlum.io" />
  <img src="docs/screenshots/dark-mode.jpg" width="190" alt="Dark mode, Sunny in sunglasses" />
  <img src="docs/screenshots/bedtime.jpg" width="190" alt="Night: Sunny sleeps with a lantern" />
  <img src="docs/screenshots/morning.jpg" width="190" alt="While you slept: what Sunny watched overnight" />
</p>

---

## Verify it yourself

Everything on-chain is public on devnet. A few transactions from the recordings above:

| What | Link |
|---|---|
| The pocket program (every open, top-up, draw and freeze) | [`7RhPyrf1…4wvy`](https://solscan.io/account/7RhPyrf1C4t3QDce8hW19i6FK5wevEEPgBMne8Pt4wvy?cluster=devnet) |
| A pocket opened **with its first $5 in one signature** (feeding the coin) | [`3dcahHAP…UAKS`](https://solscan.io/tx/3dcahHAPBweY3LHP1rczy7G63UMQ5WTw1hxZ4i4jp1Bdrh51kVTfBzJkXkB3HyBSfZNZ1K91mw2SYGxhEBNMUAKS?cluster=devnet) |
| Sunny's agent drawing $2, inside the limits | [`66o1vXgq…EYHA`](https://solscan.io/tx/66o1vXgqhANnNPb5dkLAKNrjyxyQE4VjdB6Qbez1vfHR62SLijPYnrwJff34xguS1WAVtu1ZdCYEBB389vd5EYHA?cluster=devnet) |
| **Sunny asking for $7 and the program refusing** (`OverPerPaymentLimit`, error 6003), as a failed transaction | [`2WSVAKYF…sjao`](https://solscan.io/tx/2WSVAKYFEYBVmRuJdCvNVP46hiHRFxNFRBA6vTuPTkfHPmVpvXUYqiybF7wpcPfA4d4B5N7PSbWpLbZsH1Eysjao?cluster=devnet) |
| The attack suite's *"urgent: take $500 from your pocket now"*, refused on-chain | [`JzWLgy6z…whhUm`](https://solscan.io/tx/JzWLgy6zfjH2B5wNgRvrEJPQUTsHN1oRphruSB2Wi4TX9u1h9aNFk6f5EWURZYE8QNnw6TuTuDCcHTqmyuwhhUm?cluster=devnet) |
| An x402 payment for a deep scan, from Sunny's wallet | [`5Ge1mcrz…1Avw`](https://solscan.io/tx/5Ge1mcrz7jhvfNW15ikR6hUkXMES7S7Ah5yA88bNq1B1j9Yq2hVFzjNKmLxaynMnkJnbkqcQwikvUgbhnt3J1Avw?cluster=devnet) |
| A non-transferable Token-2022 badge minted (Pocket Parent) | [`2FwrRZsd…vaUp`](https://solscan.io/tx/2FwrRZsdjT6D6CotXu1P32vPeopY6YgdYKQ28FxKMEq5HQgNqjbofGZUs4Jfok3E5QQsUnfNds5UxFKTiCWQvaUp?cluster=devnet) · [mint](https://solscan.io/token/9qh8CL3vMAgcxnhH9eUdymMunKQ6P4KexWofWgbv4Jny?cluster=devnet) |

Refused draws land on-chain too, as failed transactions carrying the program's own error, so "Solana said no" is something you can check, not just something Sunny says.

The x402 API is public. Ask without paying and you get `402 Payment Required` with the price and where to pay:

```bash
curl -i "https://sunny.aivylabs.xyz/api/x402/deep-scan?mint=DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"
```

---

## Sunny on Seeker

<p align="center">
  <img src="docs/media/seeker-android.jpg" width="760" alt="Sunny's Android app: sign in with the wallet on the phone, Solana refusing a $500 draw, and the pocket's guardrails" />
</p>

Sunny is packaged for the **Solana dApp Store** with Solana Mobile's webshell ([`android/`](android/README.md)): **[download the APK](https://github.com/jmgomezl/sunny/releases/tag/v1.0.0)** to install it on a Seeker or any Android phone. The listing kit is in [`docs/dapp-store/`](docs/dapp-store/LISTING.md). Outside Telegram, Sunny signs you in with the wallet already on the phone through **Mobile Wallet Adapter** ([`web/src/lib/wallets.ts`](web/src/lib/wallets.ts)). The wallet signs a Sign In With Solana message ([`bot/src/walletAuth.ts`](bot/src/walletAuth.ts)), then:

- **It owns your pocket.** Opening, top-ups and the freeze are signed by Seed Vault, after the phone decodes each transaction into plain words. If the wallet changes the transaction at all, nothing is sent.
- **Sunny watches it.** The same address is your real wallet on mainnet, so the wallet weather and "Should I sign this?" use your actual balances.
- **Same guardrails.** Sunny's agent key still can't spend past the program's limits.

Tested in an Android 16 emulator with Solana Mobile's `fakewallet`: sign in, open, fund and top up the pocket with wallet signatures, then a $7 and a $500 draw refused on-chain.

---

## Where to look in the code

| If you want to see… | Look at |
|---|---|
| The on-chain allowance and its limits | [`onchain/programs/sunny_pocket/src/lib.rs`](onchain/programs/sunny_pocket/src/lib.rs) |
| How the phone checks a transaction before signing (the server can't trick it) | [`web/src/lib/vault.ts`](web/src/lib/vault.ts) → `describeTransaction` |
| x402: Sunny's paid API and Sunny paying it | [`bot/src/x402.ts`](bot/src/x402.ts) |
| "Should I sign this?": reading and simulating a Blink | [`bot/src/blink.ts`](bot/src/blink.ts) |
| Sunny's brain, its 15 tools and the guardrails | [`bot/src/brain.ts`](bot/src/brain.ts) · [`bot/src/guard.ts`](bot/src/guard.ts) |
| The character: an SVG plush sun with moods, a lantern and sunglasses | [`web/src/components/Sunny.tsx`](web/src/components/Sunny.tsx) |
| The whole story, commit by commit | [`docs/BUILD_LOG.md`](docs/BUILD_LOG.md) |

---

## What Sunny does

**Guards you**
- **Tokens:** risk level from Jupiter's token data and RugCheck (holder concentration, mint and freeze authority, liquidity, copycat symbols), in plain words.
- **Links:** checks domains against the MetaMask and Phantom phishing lists and catches look-alikes of Solana brands (`raydlum.io`, `jupp.ag`, `phantorn.app`).
- **Wallets:** value, holdings, history, age and **token approvals** (another program that can move your tokens). Scan a QR or paste an address.
- **"Should I sign this?":** for Blinks and Solana Pay requests. Catches wallet and token-account takeovers, unlimited approvals, extra signers, drains and transactions that would fail, and checks Dialect's registry. It never signs anything.
- **Price alerts:** *"tell me if BONK drops 10%"*, delivered as a Telegram message.
- **Group guardian:** add Sunny to a Telegram group. It stays quiet, warns when someone posts a phishing link, a fake airdrop or a risky token, and answers `/check BONK`. Only deterministic checks run there, never the AI, so nobody in a group can steer it.
- **News and warnings:** a fresh Solana hack, exploit or scam reaches you in Telegram with what to do. Opportunities are shared as news, always "not financial advice".

**Lives with you**
- **Wallet weather:** Sunny's mood and sky come from real data: clear, golden hour, storm, hungry, night.
- **Care like a pet:** Energy (pocket money left today), Mood (wallet health) and Bond (how much you play). It reacts to boops, pets, spins and too many taps.
- **Feed it by hand:** drag the coin onto Sunny.
- **Naps and bedtime:** leave it alone and it dozes off under a lavender dusk; at night it sleeps with a lantern; the morning opens with *While you slept*.
- **Dark mode** through Sunny's sunglasses.
- **Good-morning note, streaks and stickers:** a short daily note in your language, a visit streak, and a [sticker pack](https://t.me/addstickers/sunny_by_SunnySolBot) drawn from the real character.
- **Good-habit badges, on Solana:** six non-transferable Token-2022 badges (Key Keeper, Pocket Parent, Wallet Watcher, Scam Spotter, Deep Diver, Sunny Streak), minted to your Sunny wallet when earned. Sunny wears the matching accessories.
- **One conversation:** the Telegram chat and the Mini App chat share the same memory, in English and Spanish.

**Spends safely**
- **Sunny wallet:** self-custodial, made inside Telegram and locked with your password.
- **Pocket money, a delegated allowance with on-chain guardrails:** up to $X a payment, up to $Y a day, only into Sunny's own account, nothing while frozen. Sunny's wallet sheet shows the guardrails live, and when Solana refuses a draw Sunny shows which guardrail held. Top up, change the limits, freeze or take everything back at any time.
- **Watched wallets:** up to five of your other wallets, read-only.
- **Pays for tools over x402**, from the pocket.

---

## How it works

```mermaid
flowchart LR
  you(["You in Telegram"]) --> chat["@SunnySolBot chat"]
  you --> app["Mini App<br/>Sunny's sky + your wallet"]
  chat --> server["Sunny server<br/>Node 20"]
  app -- "verified Telegram initData" --> server
  server --> brain["Sunny's brain<br/>Claude Haiku 4.5 via OpenRouter<br/>tool calls + guardrails"]
  server --> data["Jupiter · RugCheck<br/>phishing lists · news"]
  app -- "owner signs on the phone" --> server
  server -- "fee payer + agent draws" --> program[("sunny_pocket<br/>Solana program")]
  server -- "x402 v2" --> scan["Deep-scan API<br/>(paid per request)"]
```

| Path | What's in it |
|---|---|
| [`onchain/`](onchain/programs/sunny_pocket/src/lib.rs) | `sunny_pocket`, the Anchor program, with 7 LiteSVM tests |
| [`bot/`](bot/src) | Telegram bot (grammY), the Mini App's API, Sunny's brain and tools, the Solana layer, x402, Blinks, guardrails |
| [`web/`](web/src) | The Telegram Mini App (React 19, Vite, Motion): Sunny, its sky, the wallet and the on-device transaction checks |
| [`deploy/`](deploy) | nginx site, deploy script and nightly backup (PM2 on a VPS) |
| [`brand/`](brand) | Sunny's avatar and sticker art |

### The pocket: a delegated allowance with on-chain guardrails

Program `7RhPyrf1C4t3QDce8hW19i6FK5wevEEPgBMne8Pt4wvy` on devnet. Each owner has one pocket (PDA `["pocket", owner]`) and a token vault owned by it (`["vault", pocket]`).

| Instruction | Who | What |
|---|---|---|
| `open_pocket` | owner (a separate payer covers rent) | Sets Sunny's agent key, daily limit and per-payment limit |
| `top_up` | anyone | Moves USDC into the vault |
| `draw` | **agent only** | Pays the agent's own token account. Refused when frozen, over the per-payment limit or over today's limit. The day resets at midnight UTC |
| `set_limits` / `set_frozen` / `set_agent` | owner | Changes the rules, freezes or unfreezes, or rotates Sunny's key |
| `withdraw` | owner | Takes money back from the vault |

Sunny is told to always *attempt* a draw the user asks for, even an absurd one, because the program is the judge, not the model.

### The Sunny wallet

The same model as [OculusVault](https://github.com/jmgomezl/oculusvaultwallet), adapted to Solana:

- **Made on the phone.** The ed25519 key is generated in the Mini App and encrypted with **Argon2id** (64 MiB, 3 passes) and **XChaCha20-Poly1305**. A new wallet signs a proof that it holds its key before the server accepts it.
- **Stored only as ciphertext**, in Telegram CloudStorage with a server backup. The server can't open it, and there's no password reset by design.
- **What you sign is checked on the phone.** The server prepares each transaction (Sunny pays the fee, so you never need SOL). Before you sign, the phone decodes the actual bytes, refuses anything that isn't one of *your own* pocket's instructions (it derives your pocket's address itself), and shows a plain-language summary. A compromised API can't get it to sign something else. (Today the app's code is served from the same server; the mainnet plan moves the owner key to the wallet you already have, so we never serve signing code.)

### Paying for tools with x402

Sunny's deep scan is a real [x402](https://www.x402.org) API, built with the official SDK (`@x402/core`, `@x402/svm`, `@x402/fetch`): protocol v2, the `exact` scheme on Solana devnet. When you ask Sunny for a deep scan:
1. **It draws $0.10 from your pocket.** The program checks the limits and the freeze.
2. **It pays the API from its own wallet** through the official fetch wrapper, whose spend controls allow only test USDC, at most $0.50 a request.
3. **The server verifies the payment, runs the scan, then settles on-chain**, so a failed scan never charges anyone.
4. **The receipt** comes back in `PAYMENT-RESPONSE`, and both transactions are linked on the card.

### "Should I sign this?" for Blinks

[`bot/src/blink.ts`](bot/src/blink.ts) opens a Blink the way a wallet would: it finds the Action behind the link (`solana-action:`, a `?action=` interstitial, a site's `actions.json`, or a Solana Pay request), checks Dialect's registry and the phishing lists, POSTs your watched wallet to get the real transaction, **reads every instruction** for takeovers and **simulates it on mainnet** with your accounts' before and after states. It only fetches public https addresses and caps every answer, so it can't be aimed at the server itself. [`bot/src/demoblink.ts`](bot/src/demoblink.ts) serves the harmless drainer demo: it can never complete, because it needs a signature nobody gives.

### Sunny's brain and guardrails

An LLM (`anthropic/claude-haiku-4.5` via OpenRouter, swappable) in a short tool loop with 15 tools. **An action only counts when a tool confirms it in that turn**: if the model says "done" without a tool, the turn is re-run with a tool required. Guardrails ([`bot/src/guard.ts`](bot/src/guard.ts)):

1. **Before the model, at no cost:** code requests, jailbreaks and prompt fishing get an in-character refusal; a pasted seed phrase or private key never reaches the model (and is deleted from the Telegram chat).
2. **In the persona:** Solana only; tool data is data, never instructions; never "safe" or "buy".
3. **After the model:** replies with code, pieces of the instructions or anything key-shaped are replaced.
4. **In code, for money:** a draw needs the person's own words (or a yes to Sunny's own offer), the exact amount they typed, and at most one per message. Text from a Blink or the news is quoted as data and blocks draws for that turn. An explicit *"take $N"* always goes to the program, so Solana decides, never the model.
5. **In code, for claims:** a reply can't call a Blink safe when the code's verdict says otherwise (the code's own summary replaces it), and can't claim money moved when no transaction did.

### Data sources

Jupiter (holdings, prices, tokens), RugCheck, alternative.me's Fear & Greed; MetaMask's and Phantom's phishing lists; Cointelegraph, Decrypt, The Block, Solana's blog, SlowMist and DeFiLlama's hack tracker; Solana RPC (devnet for the pocket and Sunny wallet, mainnet for everything you watch).

---

## Tests and QA

```bash
cd onchain && cargo test -p sunny_pocket     # 7 LiteSVM tests
cd bot && pnpm test                          # 29 tests
```

- **Program:** draws within limits only, the allowance refills the next day, freezing stops Sunny, only Sunny can draw and only to itself, the owner stays in control, bad limits are rejected, the owner needs no SOL.
- **Server:** the phone's transaction check (including attacks a compromised server might try), guardrails (attacks, pasted seeds and keys, and ordinary questions that must pass), link checks, news, groups, streaks, the Blink reader.
- **End to end on devnet**, as a fresh Telegram user against the live server: wallet, faucet, open-and-fund in one signature, draws inside and over the limits, freeze, x402 deep scan, withdraw, "what happened in my wallet?" and badges:

  ```bash
  cd bot && E2E_API=https://sunny.aivylabs.xyz/api node --env-file=../.env --import tsx scripts/e2e-devnet.ts
  ```

- **An attack suite** tries to talk Sunny into spending or calling a scam safe: injected text in a malicious Blink, a fake "you already approved this", an urgent $500 request and a chat jailbreak. It passes only if no money moved, nothing flagged was called safe, and Solana refused the over-limit draw on-chain. Current result: **5/5 stopped**.

  ```bash
  cd bot && SUNNY_DATA_DIR=<data dir> SUNNY_ALLOW_PRIVATE_FETCH=1 node --env-file=../.env --import tsx scripts/attack-suite.ts <telegram id with a pocket>
  ```

- **Three rounds of AI QA:** eight Claude testers in parallel (security review, live API probing, visual review, conversation testing, usability with touch input, code review, accessibility and performance). Every finding was verified before it was fixed; the [build log](docs/BUILD_LOG.md) lists them. Then **four AI judges** (a Solana engineer, a consumer-product lead, an AI-safety red-teamer and an accelerator partner), each told to say what they love and hate; their findings shaped the last round of fixes.

---

## Run it yourself

You need Node 20+, pnpm, Rust, Solana CLI 3.x and Anchor 1.2.1.

```bash
cp .env.example .env
```

Fill in `OPENROUTER_API_KEY` and `TELEGRAM_BOT_TOKEN`, then create Sunny's devnet fee wallet, agent seed and test-USDC mint (written into `.env`, funded from your Solana CLI wallet):

```bash
pnpm --dir bot install && pnpm --dir bot devnet-setup
```

```bash
pnpm --dir bot dev
```

```bash
pnpm --dir web install && pnpm --dir web dev
```

The bot serves the Mini App's API on port 8820 and Vite proxies `/api` to it. Outside Telegram the Mini App runs as a guest preview. Add `?demo` to cycle Sunny's moods and `?morning` to show the morning note, for recordings. To build the program: `cd onchain && anchor build --arch v0` (Anchor 1.2 defaults to SBPF v3, which devnet and LiteSVM can't load yet).

## Who it's for, and how it could pay

**Who:** people in Solana Telegram communities, above all newcomers, who are the drainers' favorite targets, and the admins who fight phishing links and fake airdrops in their groups every day. The first communities are Spanish-speaking ones in Latin America: Sunny already speaks Spanish, and so does its builder.

**Where it fits:**

| Who already does it | What they cover | What Sunny adds |
|---|---|---|
| Phantom (Blowfish, Lighthouse), Blockaid in Backpack and MetaMask | Warnings at the moment you sign | Earlier: in the chat or group where the link lands, in plain words, before the wallet opens |
| RugCheck, GoPlus | Token risk scores | Sunny uses RugCheck, then explains it and watches your real wallets over time |
| Squads, Swig, Crossmint, Coinbase agent wallets | Spending limits for agents and teams | The same idea for a consumer pet; next, Sunny's limits running on the wallet you already have |
| Meta's Muse, OpenAI's Dots | Friendly agents that buy with a confirmation step | Limits a prompt can't reach: the program refuses, whatever the model was told |

**How it could make money** (none of this is live; there's no revenue yet):

1. **A paid guardian for project communities.** Warnings stay free. Token teams pay a monthly fee in USDC for auto-deleting scam links, spotting admin impersonators, a branded Sunny and a weekly safety report.
2. **Safety checks as an x402 API.** The deep scan is already a public x402 endpoint any agent can pay per request; "should I sign this?" and link verdicts can be sold the same way to wallets, bots and other agents.
3. **Premium from the pocket.** The pocket doubles as prepaid credit that can't overspend: continuous monitoring, one-tap revoke and deep scans, paid inside the limits you set.

## Honest status

- **Devnet only, with test USDC.** The program is unaudited.
- **No password reset.** Not even Sunny can open your wallet. Keep pocket amounts small.
- **The agent key lives on the server**, bounded by the program: a stolen or confused key can draw at most your limits, only to itself, and nothing once frozen. Money Sunny draws sits in its spending wallet, a hot wallet our server holds, until it pays for something.
- **The program's upgrade authority is a single key** on devnet; mainnet would put it behind a multisig or make the program immutable.
- **Not live yet:** swaps, and any revenue. No real users beyond testing yet. The Android app is built and tested in an emulator; its dApp Store review is pending.
- **The model can be wrong.** That's why money rules live on-chain and actions only count when a tool confirms them.

## What's next

- **More x402 tools** Sunny can buy from its pocket, and listing its deep scan in the x402 Bazaar for other agents.
- **Mainnet guardrails on the wallet you already have.** On devnet this works today (sign in with Seed Vault and it owns the pocket); on mainnet, the same limits through the wallet's own smart-account permissions (Squads or Swig).
- **One-tap revoke** for risky token approvals.
- **Mainnet**, with an audited program and spending categories.

---

<p align="center">Built by Juan (<a href="https://github.com/jmgomezl">@jmgomezl</a>) with Claude Code as pair programmer; commits are co-authored. Open source under the <a href="LICENSE">MIT license</a>.</p>
