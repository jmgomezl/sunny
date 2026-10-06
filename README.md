<p align="center">
  <img src="brand/sunny-avatar-640.png" width="180" alt="Sunny, a small plush sun with a smile" />
</p>

<h1 align="center">Sunny</h1>

<p align="center"><b>A little sun that keeps your Solana wallet warm and safe.</b></p>

Meta's Muse and OpenAI's Dots made AI agents cute, but neither of them can hold money. Sunny can: it's a companion that lives in Telegram, watches your tokens, warns you about scams, and pays for its own tools with USDC. It does all this on **pocket money**, a daily allowance enforced by a Solana program that Sunny can't spend past, even if it wanted to.

Your wallet also has weather. When things look good, Sunny's sky is clear. If a token you hold looks risky, a storm rolls in. When the market is quiet, Sunny goes to sleep under the stars.

## What Sunny does

- **Watches and explains.** Builds a watchlist, sends price alerts, and explains moves in plain language. It never invests for you without asking.
- **Guards you.** Runs safety checks on tokens (who holds the supply, whether the mint is locked, honeypots), paying for each report with an x402 micropayment.
- **Spends only its pocket money.** Small swaps and paid API calls come out of a daily allowance held on-chain. Anything above the limit needs your approval in your own wallet, and you can freeze the pocket at any time.
- **Builds good habits.** Gentle check-ins about concentration, backups and suspicious approvals. Sunny gets happier as your wallet gets healthier.

## Repo layout

| Path | What |
|---|---|
| `web/` | Telegram Mini App: Sunny's home, the wallet weather, the watchlist and the pocket money card (Vite + React) |
| `brand/` | Sunny's avatar and brand assets |

Coming next: `bot/` (Telegram bot and the agent) and `programs/` (the pocket-money Solana program).

## Run the Mini App

```bash
pnpm --dir web install
```

```bash
pnpm --dir web dev
```

Built for Colosseum's Crypto World's Fair hackathon (Solana track).
