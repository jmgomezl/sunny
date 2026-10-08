# Sunny for Android (Solana dApp Store)

Sunny's web app at https://sunny.aivylabs.xyz, wrapped as an Android app with Solana Mobile's
[webshell](https://docs.solanamobile.com/cli/webshell). The shell loads the live site, so web
deploys reach the app without a new build. Outside Telegram, Sunny signs in with the wallet on the
phone through Mobile Wallet Adapter (Seed Vault on a Seeker, or Phantom and Solflare), and that
wallet owns the pocket.

## Build

Needs JDK 17 and the Android SDK. The release key lives in `android/.keys/` (git-ignored) and its
password in `../.env` as `SOLANA_MOBILE_KEYSTORE_PASSWORD`. **Back both up: every update must be
signed with the same key.**

```bash
set -a && . ../.env && set +a
JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools npx solana-mobile@latest webshell build .
```

The signed APK is `app/build/outputs/apk/release/app-release.apk`. Bump `versionCode` in
`app/build.gradle.kts` for each store update.

## Tested

In an Android 16 emulator with Solana Mobile's `fakewallet` (Mobile Wallet Adapter): connect,
sign in, test USDC, open and fund the pocket and top it up (each signed by the wallet), then a $7
draw refused on-chain by the pocket's per-payment limit.
