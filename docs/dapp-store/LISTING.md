# Sunny in the Solana dApp Store

Everything for the listing is in this folder. The app itself is `android/app/build/outputs/apk/release/app-release.apk` (see [android/README.md](../../android/README.md) to rebuild it).

## Listing

| Field | Value |
|---|---|
| App name | Sunny |
| Short description (30 max) | AI pet that guards your wallet |
| Category | Security (or Finance) |
| Package | `xyz.aivylabs.sunny` |
| Version | 1.0.1 (versionCode 2) |
| Website | https://sunny.aivylabs.xyz |
| Privacy policy | https://sunny.aivylabs.xyz/privacy.html |
| License / EULA | https://sunny.aivylabs.xyz/terms.html |
| Copyright | © 2026 Juan Gomez |
| Source | https://github.com/jmgomezl/sunny (MIT) |
| Icon | `icon-512.png` (512×512) |
| Banner | `banner-1200x600.png` |
| Feature graphic | `feature-1200x1200.png` |
| Screenshots | `screenshots/01…05` (1080×1920, portrait) |
| Preview video (optional) | `docs/media/sunny-tour.mp4` |

### Long description

Scams start in chat, not in your wallet. Sunny is a little sun that catches them first.

- **Should I sign this?** Paste any Blink or link. Sunny fetches the transaction it wants signed, reads every instruction and simulates it with your wallet, then tells you in plain words what you'd lose.
- **Watches your wallet.** Sign in with your Seeker's wallet and Sunny watches that wallet, read-only. Its sky is your wallet's weather: clear when all is well, stormy when a risky token shows up.
- **Pocket money with guardrails.** Give Sunny a small allowance and it can pay for tools, like a deep token scan over x402. The limits live in a Solana program, not in the AI: up to $5 a payment, $10 a day, only into Sunny's own account, and a freeze only you control. Talk it into "$500, urgent!" and Solana says no, on-chain.
- **A pet you'll actually open.** It dozes with a lantern at night, says good morning with what happened while you slept, and wears sunglasses in dark mode.

Your keys stay yours: Sunny never asks for your recovery phrase, and your wallet signs every change to the pocket. Sunny's own key can only draw inside your limits. The pocket runs on Solana devnet with test USDC, so you can try it all for free. Also in Telegram as @SunnySolBot. Open source (MIT).

### What's new (1.0.1)

First release: sign in with the wallet on your phone, wallet weather, Blink checks, and pocket money with on-chain guardrails (devnet).

### Notes for the reviewer

- No account needed. Tap **Connect wallet** and approve the sign-in in Seed Vault (or Phantom or Solflare); the message costs nothing and moves no money.
- Then **Get 20 test USDC** (devnet), drag the coin onto Sunny or tap **Open my pocket**, and sign.
- In **Ask Sunny**, say *"take $7 from your pocket"*: the pocket program refuses it on-chain (over the $5 per-payment limit), with a link to the failed transaction.
- In **Scan & check**, paste `https://sunny.aivylabs.xyz/api/blinks/free-airdrop`, a harmless demo drainer Blink, to see a "Don't sign" verdict.

## How to submit

You need: a browser with a Solana wallet extension (Phantom, Solflare or Backpack) holding about **0.2 SOL on mainnet** for fees and storage, and time for the portal's identity check (KYC). **The wallet you publish with must be used for every future update, so pick one you'll keep.**

1. Open the Publisher Portal from [Solana Mobile's publishing guide](https://docs.solanamobile.com/dapp-store/submit-new-app), sign up, fill in your publisher profile and submit KYC.
2. Connect your publisher wallet.
3. **Add a dApp → New dApp**, and fill in the fields above. Upload the icon, banner, feature graphic and the five screenshots from this folder.
4. **New Version**: upload `app-release.apk`, then **Submit**. Approve every signature the portal asks for (they upload the files to Arweave and mint the release NFT); skipping one leaves the submission incomplete.
5. Review takes about 3–5 business days; the result comes by email. If there's no answer after 5 business days, ask in `#dev-answers` on Solana Mobile's Discord.

**Back up the signing key** (`android/.keys/sunny-release.keystore`) and its password (`SOLANA_MOBILE_KEYSTORE_PASSWORD` in `.env`) somewhere safe. Every update must be signed with the same key.
