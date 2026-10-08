import { useEffect, useState } from 'react'
import type { Wallet } from '@wallet-standard/base'
import { BOT_LINK } from '../lib/share'

// Outside Telegram (a Seeker, any Android phone, a computer), Sunny signs in with the wallet
// you already have. On Android that's Mobile Wallet Adapter (Seed Vault on a Seeker); on a
// computer, a wallet extension. The wallet code loads only here.

type Option = { wallet: Wallet; label: string; icon: string }

const isAndroid = () => /android/i.test(navigator.userAgent)

export function ConnectWallet({
  onSignedIn,
  onError,
}: {
  onSignedIn: (address: string) => void
  onError: (message: string) => void
}) {
  const [options, setOptions] = useState<Option[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let off: (() => void) | undefined
    let alive = true
    void import('../lib/wallets').then(({ availableWallets, isMobileAdapter, onWalletsChanged }) => {
      const read = () =>
        alive &&
        setOptions(
          availableWallets().map((wallet) => ({
            wallet,
            // On a phone, MWA opens whichever wallet app you use (Seed Vault on a Seeker).
            label: isMobileAdapter(wallet) ? 'Use a wallet on this phone' : wallet.name,
            icon: wallet.icon,
          })),
        )
      read()
      off = onWalletsChanged(read)
    })
    return () => {
      alive = false
      off?.()
    }
  }, [])

  const connect = (o: Option) => {
    setBusy(o.label)
    void import('../lib/wallets')
      .then(({ signIn }) => signIn(o.wallet))
      .then(onSignedIn)
      .catch((err) => onError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(null))
  }

  return (
    <div className="connect-wallet">
      {options === null ? (
        <p className="scan-hint">Looking for wallets…</p>
      ) : options.length ? (
        options.map((o) => (
          <button
            key={o.wallet.name}
            type="button"
            className="btn btn--primary connect-option"
            onClick={() => connect(o)}
            disabled={Boolean(busy)}
          >
            <img src={o.icon} alt="" width={22} height={22} />
            {busy === o.label ? 'Check your wallet…' : o.label}
          </button>
        ))
      ) : (
        <p className="scan-hint">
          {isAndroid()
            ? 'No wallet found. Open me in Chrome with Seed Vault, Phantom or Solflare installed.'
            : 'No wallet found in this browser. On a Seeker or Android phone, open me in Chrome; on a computer, add Phantom or Solflare.'}
        </p>
      )}
      <p className="scan-hint connect-note">
        Signing in costs nothing and moves no money. Your wallet then owns my pocket on devnet, with test money, and
        Solana enforces its guardrails.
      </p>
      <a className="btn btn--ice pocket-open-tg" href={BOT_LINK} target="_blank" rel="noreferrer">
        Or open Sunny in Telegram
      </a>
    </div>
  )
}
