import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CoinIcon, EyeIcon, ShieldIcon, SnowIcon, SunMark } from './Icons'
import { inTelegram, walletSession, type WalletSession } from '../lib/api'
import { ConnectWallet } from './ConnectWallet'
import { closeOnBack } from '../lib/back'
import { type ShareSpec } from '../lib/share'
import { ShareRow } from './Cards'
import { Guardrails } from './Guardrails'
import {
  createWallet,
  exportKey,
  holdKey,
  isUnlocked,
  loadRecord,
  MIN_PASSWORD,
  saveRecord,
  unlockWallet,
  type VaultRecord,
  walletProof,
} from '../lib/vault'
import {
  pocketFaucet,
  preparePocket,
  PROGRAM_URL,
  submitPocket,
  type PocketAction,
  type PocketState,
  type Sent,
} from '../lib/pocket'

export type PocketEventKind = 'created' | 'opened' | 'topup' | 'freeze' | 'unfreeze' | 'withdraw' | 'faucet' | 'limits'

type PocketSheetProps = {
  open: boolean
  state: PocketState | null
  /** Optional action to jump to from the care card; 'hello' is the first visit, when Sunny offers a wallet. */
  intent?: 'topup' | 'freeze' | 'unfreeze' | 'hello' | 'feed'
  /** How much the coin fed on the home screen was worth. */
  feedAmount?: number
  onClose: () => void
  onChanged: (state: PocketState | null, event: PocketEventKind, sent?: Sent) => void
  /** Signed in (or out) with their own wallet, outside Telegram: everything reloads for them. */
  onSignedIn?: () => void
  /** No wallet in this browser: try the shared demo pocket instead. */
  onTryDemo?: () => void
  onBusy: (busy: boolean) => void
  /** Called when the key backup is shown, which earns the Key Keeper badge. */
  onBackup?: () => void
}

type Prepared = {
  id: string
  message: string
  summary: string[]
  event: PocketEventKind
  action: PocketAction
  /** When the transaction was made: Solana only accepts it for about a minute. */
  at: number
}

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`

const firstName = () => window.Telegram?.WebApp?.initDataUnsafe?.user?.first_name?.split(' ')[0]

/** Your Sunny wallet (self-custodial, password-locked) and Sunny's pocket money. */
// The wallet asks in the imperative ("Open Sunny’s pocket"); once it's done, Sunny says what happened.
function pastTense(line: string) {
  return line
    .replace(/^Open Sunny’s pocket: /, 'Pocket opened: ')
    .replace(/^Put (\S+) into Sunny’s pocket/, 'Put $1 into my pocket')
    .replace(/^Take (\S+) back to your wallet/, 'Took $1 back to your wallet')
    .replace(/^Change limits to/, 'Limits changed to')
    .replace(/^Freeze Sunny’s pocket.*/, 'Pocket frozen: I can’t spend')
    .replace(/^Unfreeze Sunny’s pocket/, 'Pocket warmed up')
}

// Pocket moments worth sharing, with Sunny's pose and the transaction as proof.
const SHARE_MOMENTS: Record<string, Omit<ShareSpec, 'proof'> | undefined> = {
  topup: {
    kicker: 'Pocket money',
    title: 'I gave my AI some pocket money',
    detail: 'Sunny can only spend inside the limits I set, and Solana checks every payment.',
    tone: 'sol',
    pose: 'yum',
    caption: 'I just gave my AI pet Sunny its pocket money on Solana 🪙 It can’t spend past my limits:',
  },
  opened: {
    kicker: 'Pocket money',
    title: 'I gave my AI its first pocket money',
    detail: 'A daily limit and a per-payment limit, enforced on Solana, not by the AI.',
    tone: 'sol',
    pose: 'yum',
    caption: 'My AI pet Sunny just got its first pocket money on Solana 🪙 Limits enforced on-chain:',
  },
  freeze: {
    kicker: 'Frozen on Solana',
    title: 'I froze my AI’s pocket',
    detail: 'With one tap, Sunny can’t spend a cent until I warm it up. Solana enforces it.',
    tone: 'sol',
    pose: 'frozen',
    caption: 'I just froze my AI pet’s pocket money on Solana ❄ It can’t spend a cent:',
  },
}

// What Sunny says right after something went through: the payoff, up top where it's seen.
const DONE_LINE: Partial<Record<PocketEventKind, string>> = {
  opened: 'Yay, my pocket is open! 🥹 Thank you. Every payment I make still has to pass the guardrails below.',
  topup: 'Nom nom, thank you! ☀️ It’s in my pocket, and the guardrails still hold.',
  faucet: 'Got it: practice money is in your wallet. Next, if you like, give me a small allowance below.',
  freeze: 'Brrr, frozen ❄ I can’t spend a cent until you warm me up.',
  unfreeze: 'Ahh, warm again ☀️ I can spend inside the guardrails again.',
  withdraw: 'Done: the money is back in your wallet. My pocket stays here for whenever you want it.',
  limits: 'New limits set. Solana checks every payment against them.',
}

// What the password is for, when the sheet was opened to do something specific.
const UNLOCK_FOR: Record<string, string> = {
  freeze: 'Tell me your password and I’ll freeze my pocket right away.',
  unfreeze: 'Tell me your password and I’ll warm my pocket back up.',
  topup: 'Tell me your password and we’ll top up my pocket.',
  feed: 'Tell me your password and that coin is mine! 🪙',
}

export function PocketSheet({
  open,
  state,
  intent,
  feedAmount = 5,
  onClose,
  onChanged,
  onBusy,
  onBackup,
  onSignedIn,
  onTryDemo,
}: PocketSheetProps) {
  const [record, setRecord] = useState<VaultRecord | null | undefined>(undefined)
  // Outside Telegram: the wallet you signed in with owns the pocket and signs for it.
  const [external, setExternal] = useState<WalletSession | null>(walletSession())
  const [loadError, setLoadError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [unlocked, setUnlocked] = useState(isUnlocked())
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [done, setDone] = useState<{ text: string; explorer?: string; event?: PocketEventKind } | null>(null)
  const [daily, setDaily] = useState('10')
  const [perTx, setPerTx] = useState('5')
  const [backup, setBackup] = useState<string | null>(null)
  const [skipFaucet, setSkipFaucet] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    setDone(null)
    setPrepared(null)
    setBackup(null)
    // A password typed last time (maybe a wrong one) never waits in the form.
    setPassword('')
    setConfirm('')
    setShowPassword(false)
    setUnlocked(isUnlocked())
    setExternal(walletSession())
    // The wallet already known (same person) stays on screen while it's checked again.
    if (inTelegram()) reload()
    else setRecord(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Loading the wallet failed: say so and offer a retry, never the "make a wallet" form.
  const reload = () => {
    setLoadError(null)
    loadRecord()
      .then(setRecord)
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
  }

  // A wallet session that expired mid-way: back to "Connect your wallet", not a stale address.
  useEffect(() => {
    const signedOut = () => setExternal(null)
    window.addEventListener('sunny:signed-out', signedOut)
    return () => window.removeEventListener('sunny:signed-out', signedOut)
  }, [])

  useEffect(() => {
    if (!open) return
    const offBack = closeOnBack(onClose)
    // Escape closes it too, like the other sheets.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      offBack()
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    onBusy(true)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
      onBusy(false)
    }
  }

  // Ready to act on the pocket: an unlocked Sunny wallet, or your own wallet signed in.
  const owner = record?.address ?? external?.address ?? null
  const ready = Boolean((record && unlocked) || external)

  const signedIn = (address: string) => {
    setExternal(walletSession())
    setError(null)
    setDone({ text: `Signed in with ${address.slice(0, 4)}…${address.slice(-4)}` })
    onSignedIn?.()
  }

  const signOut = () =>
    void import('../lib/wallets').then(async ({ signOut: out }) => {
      await out()
      setExternal(null)
      setDone(null)
      onSignedIn?.()
    })

  const create = (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) return setError('The passwords don’t match.')
    void run('Creating your wallet…', async () => {
      const { record: r, seed } = await createWallet(password)
      const userId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id ?? 0
      await saveRecord(r, walletProof(seed, userId))
      holdKey(seed, r.address)
      setRecord(r)
      setUnlocked(true)
      setPassword('')
      setConfirm('')
      onChanged(state, 'created')
    })
  }

  const unlock = (e: FormEvent) => {
    e.preventDefault()
    if (!record) return
    void run('Unlocking…', async () => {
      const seed = await unlockWallet(record, password)
      holdKey(seed, record.address)
      setUnlocked(true)
      setPassword('')
    })
  }

  const prepare = (a: PocketAction, event: PocketEventKind) => {
    if (!owner) return
    void run('Preparing…', async () => {
      setDone(null)
      const p = await preparePocket(a, owner)
      setPrepared({ ...p, event, action: a, at: Date.now() })
    })
  }

  // Fed a coin on the home screen: the top-up (or, for a new pocket, opening it with that first
  // money, in one signature) is prepared right away, so all that's left is to look and sign.
  const fed = useRef(false)
  useEffect(() => {
    if (open) fed.current = false
  }, [open])
  useEffect(() => {
    if (!open || intent !== 'feed' || fed.current || !ready || !state || prepared || busy) return
    if (state.frozen || state.ownerUsdc < feedAmount) return
    fed.current = true
    if (state.exists) prepare({ action: 'topup', amount: feedAmount }, 'topup')
    else
      prepare({ action: 'open', daily: Number(daily) || 10, perTx: Number(perTx) || 5, amount: feedAmount }, 'opened')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, intent, ready, state?.exists, state?.ownerUsdc, state?.frozen, prepared, busy])

  // Jump straight to what the home card asked for.
  useEffect(() => {
    if (!open || !ready || !state?.exists || !intent || prepared) return
    if (intent === 'freeze' && !state.frozen) prepare({ action: 'freeze' }, 'freeze')
    if (intent === 'unfreeze' && state.frozen) prepare({ action: 'unfreeze' }, 'unfreeze')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ready, state?.exists, intent])

  const approve = () => {
    if (!prepared) return
    void run(external ? 'Check your wallet…' : 'Signing on this phone…', async () => {
      let p = prepared
      // Read for a while? Get a fresh copy (Solana only accepts a transaction for about a
      // minute), and sign it only if it says exactly what was just read.
      if (Date.now() - p.at > 15_000 && owner) {
        const fresh = { ...(await preparePocket(p.action, owner)), event: p.event, action: p.action, at: Date.now() }
        if (fresh.summary.join('\n') !== p.summary.join('\n')) {
          setPrepared(fresh)
          throw new Error('Something changed since you read this. Have another look, then sign.')
        }
        p = fresh
      }
      try {
        const sent = await submitPocket(p, Boolean(external))
        setDone({ text: p.summary.map(pastTense).join(' · '), explorer: sent.explorer, event: p.event })
        setPrepared(null)
        onChanged(sent.state, p.event, sent)
      } catch (err) {
        // The next tap starts from a fresh transaction, never the one that just failed.
        setPrepared({ ...p, at: 0 })
        throw err
      }
    })
  }

  const getTestUsdc = () =>
    void run('Getting test USDC…', async () => {
      const sent = await pocketFaucet()
      setDone({ text: `Got ${sent.amount} test USDC`, explorer: sent.explorer, event: 'faucet' })
      onChanged(sent.state, 'faucet', sent)
    })

  const s = state
  const amountChips = [5, 10, 20]
  // One step at a time: test money first, then the pocket.
  const wantsFaucet = Boolean(s && !s.exists && s.ownerUsdc < 5 && !skipFaucet)
  // Fed a coin without the test USDC to pay it: getting some is the only thing to do first.
  const feedNeedsUsdc = Boolean(intent === 'feed' && s && !s.frozen && s.ownerUsdc < feedAmount)
  // While a password form is showing, its errors and progress appear inside it, by the fields.
  const passwordForm = inTelegram() && (record === null || Boolean(record && !unlocked))
  const name = firstName()
  // Once there's a wallet (a Sunny wallet or your own), the same next steps.
  function walletLine(st: PocketState) {
    return intent === 'feed' && st.frozen
      ? 'I’m frozen, so I can’t eat right now ❄ Warm me up first, then feed me.'
      : intent === 'feed' && st.ownerUsdc < feedAmount
        ? 'Your wallet needs test USDC before you can feed me. Get some below, and that coin is mine ☀️'
        : wantsFaucet
          ? 'Your wallet is ready! We’re on devnet, so money here is just for practice. Want 20 test USDC to play with?'
          : !st.exists
            ? 'If you like, give me a small daily allowance. I can only spend inside these limits, and Solana checks every payment, not me.'
            : st.frozen
              ? 'Brrr, I’m frozen ❄ I can’t spend a cent until you warm me up.'
              : st.vault <= 0
                ? 'My pocket is empty. Top me up whenever you like; I can only ever spend inside the guardrails below.'
                : `${usd(st.vault)} in my pocket, and I can spend up to ${usd(st.leftToday)} of it today. Top me up, freeze me, or take it all back whenever you like.`
  }

  // Sunny walks you through every step in its own words.
  const line =
    !inTelegram() && !external
      ? `${intent === 'hello' ? 'Hi! I’m Sunny ☀️ ' : ''}Connect the wallet you already have (Seed Vault on a Seeker, Phantom, Solflare) and it can own my pocket. Solana keeps me inside its limits.`
      : // Something to sign always leads, whatever else is still loading.
        prepared
        ? intent === 'feed'
          ? `Nom! Sign it and the coin is really mine. I read this on your phone, not on my server.`
          : 'Have a look before you sign. I read this on your phone, not on my server.'
        : loadError
          ? loadError
          : done?.event && DONE_LINE[done.event]
            ? DONE_LINE[done.event]!
            : external
              ? !s
                ? 'You’re in! Let me check your wallet on Solana…'
                : walletLine(s)
              : record === undefined
                ? 'Looking for your wallet…'
                : record === null
                  ? `${intent === 'hello' ? `Hi${name ? ` ${name}` : ''}! I’m Sunny ☀️ ` : ''}Let’s make your Sunny wallet: born on your phone, locked with a password only you know.`
                  : !unlocked
                    ? `${name ? `Hi ${name}! ` : ''}${UNLOCK_FOR[intent ?? ''] ?? 'Welcome back! Tell me your password so I know it’s you.'}`
                    : !s
                      ? 'Your wallet is ready! Let me check it on Solana…'
                      : walletLine(s)

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="chat-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.section
            className="chat-sheet scan-sheet pocket-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Sunny wallet and pocket money"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          >
            <header className="chat-head">
              <span className="chat-grip" aria-hidden="true" />
              <div className="chat-title">
                <SunMark size={22} />
                <div>
                  <strong>{external ? 'Your wallet' : !inTelegram() && !record ? 'Connect your wallet' : 'Sunny wallet'}</strong>
                  <small>
                    {owner
                      ? `${external ? 'Signed in with' : 'Your wallet'} ${owner.slice(0, 4)}…${owner.slice(-4)} · `
                      : ''}
                    Solana {s?.cluster ?? 'devnet'}
                  </small>
                </div>
              </div>
              <button type="button" className="chat-close" onClick={onClose} aria-label="Close">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </button>
            </header>

            <div className="scan-body">
              <div className="chat-msg chat-msg--sunny sheet-says" aria-live="polite">
                <span className="chat-avatar" aria-hidden="true">
                  <SunMark size={18} />
                </span>
                <motion.p
                  key={line}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                >
                  {line}
                </motion.p>
              </div>

              {/* The payoff sits right under Sunny's words, not two screens down. */}
              {done && (
                <p className="pocket-done">
                  ✓ {done.text}
                  {done.explorer && (
                    <a href={done.explorer} target="_blank" rel="noreferrer">
                      View on Solscan
                    </a>
                  )}
                </p>
              )}
              {done?.explorer && SHARE_MOMENTS[done.event ?? ''] && (
                <ShareRow spec={{ ...SHARE_MOMENTS[done.event ?? '']!, proof: done.explorer }} />
              )}

              {loadError && (
                <button type="button" className="btn btn--primary pocket-open-tg" onClick={reload}>
                  Try again
                </button>
              )}

              {/* Outside Telegram (a Seeker, Android, a computer): sign in with the wallet you have. */}
              {!inTelegram() && !external && (
                <>
                  {intent === 'hello' && (
                    <ul className="hello-rows">
                      <li>
                        <ShieldIcon size={16} /> I check tokens, links and Blinks before you sign
                      </li>
                      <li>
                        <EyeIcon size={16} /> I watch any wallet you give me, read-only
                      </li>
                      <li>
                        <CoinIcon size={16} /> I can spend a little pocket money, only inside limits Solana enforces
                      </li>
                    </ul>
                  )}
                  <ConnectWallet onSignedIn={signedIn} onError={setError} onTryWithout={onTryDemo} />
                  {intent === 'hello' && (
                    <button type="button" className="ghost-btn pocket-later" onClick={onClose}>
                      Maybe later
                    </button>
                  )}
                </>
              )}

              {/* First hello: what Sunny does, before it asks for anything. */}
              {inTelegram() && record === null && intent === 'hello' && (
                <ul className="hello-rows">
                  <li>
                    <ShieldIcon size={16} /> I check tokens, links and Blinks before you sign
                  </li>
                  <li>
                    <EyeIcon size={16} /> I watch any wallet you give me, read-only
                  </li>
                  <li>
                    <CoinIcon size={16} /> I can spend a little pocket money, only inside limits Solana enforces
                  </li>
                </ul>
              )}

              {/* 1. Create a self-custodial wallet, OculusVault-style. */}
              {inTelegram() && record === null && (
                <form className="pocket-form" onSubmit={create}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder={`Password (${MIN_PASSWORD}+ characters)`}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="Repeat password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                  <button type="button" className="ghost-btn pocket-show" onClick={() => setShowPassword((v) => !v)}>
                    {showPassword ? 'Hide password' : 'Show password'}
                  </button>
                  {error && (
                    <p className="scan-error" role="alert">
                      {error}
                    </p>
                  )}
                  <p className="scan-hint">
                    No reset, not even by me: forget the password and the wallet is gone. Network fees are on me.
                  </p>
                  <button
                    className="btn btn--primary"
                    type="submit"
                    disabled={Boolean(busy) || password.length < MIN_PASSWORD}
                  >
                    {busy ?? 'Make my wallet'}
                  </button>
                  {intent === 'hello' && (
                    <button type="button" className="ghost-btn pocket-later" onClick={onClose}>
                      Maybe later
                    </button>
                  )}
                </form>
              )}

              {/* 2. Unlock. */}
              {record && !unlocked && (
                <form className="pocket-form" onSubmit={unlock}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button type="button" className="ghost-btn pocket-show" onClick={() => setShowPassword((v) => !v)}>
                    {showPassword ? 'Hide password' : 'Show password'}
                  </button>
                  {error && (
                    <p className="scan-error" role="alert">
                      {error}
                    </p>
                  )}
                  <button className="btn btn--primary" type="submit" disabled={Boolean(busy) || !password}>
                    {busy ?? 'Unlock'}
                  </button>
                </form>
              )}

              {/* 3. Confirm what's being signed, decoded on this device. */}
              {prepared && (
                <div className="pocket-confirm">
                  <h3>You’re about to</h3>
                  <ul>
                    {prepared.summary.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <small>Checked on this phone before signing. Sunny pays the network fee.</small>
                  {/* Opening the pocket sets its guardrails: show them at the moment they're signed. */}
                  {prepared.event === 'opened' && (
                    <Guardrails preview compact perTx={Number(perTx) || 5} daily={Number(daily) || 10} />
                  )}
                  <div className="scan-actions">
                    <button type="button" className="btn btn--primary" onClick={approve} disabled={Boolean(busy)}>
                      Approve & sign
                    </button>
                    <button
                      type="button"
                      className="btn btn--ice"
                      onClick={() => setPrepared(null)}
                      disabled={Boolean(busy)}
                    >
                      {prepared.event === 'opened' ? 'Change limits' : 'Cancel'}
                    </button>
                  </div>
                </div>
              )}

              {/* 4. Pocket controls. */}
              {ready && !prepared && s && (
                <>
                  <div className="pocket-balances">
                    <div>
                      <small>Your wallet</small>
                      <strong>{usd(s.ownerUsdc)}</strong>
                      <span>test USDC</span>
                    </div>
                    <div>
                      <small>In my pocket</small>
                      <strong>{usd(s.vault)}</strong>
                      <span>{s.exists ? `can spend ${usd(s.leftToday)} today` : 'not open yet'}</span>
                    </div>
                  </div>

                  {s.ownerUsdc < 5 && (
                    <button
                      type="button"
                      className={`btn ${wantsFaucet || feedNeedsUsdc ? 'btn--primary' : 'btn--ice'}`}
                      onClick={getTestUsdc}
                      disabled={Boolean(busy)}
                    >
                      Get 20 test USDC
                    </button>
                  )}

                  {wantsFaucet && !feedNeedsUsdc ? (
                    <button type="button" className="ghost-btn pocket-later" onClick={() => setSkipFaucet(true)}>
                      Skip for now
                    </button>
                  ) : feedNeedsUsdc ? null : !s.exists ? (
                    <form
                      className="pocket-form"
                      onSubmit={(e) => {
                        e.preventDefault()
                        // The program refuses this, so it never gets as far as a signature.
                        if (Number(perTx) > Number(daily)) return setError('Per payment can’t be more than per day.')
                        prepare({ action: 'open', daily: Number(daily), perTx: Number(perTx) }, 'opened')
                      }}
                    >
                      <div className="pocket-limits">
                        <label>
                          <span>Per day ($)</span>
                          <input inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} />
                        </label>
                        <label>
                          <span>Per payment ($)</span>
                          <input inputMode="decimal" value={perTx} onChange={(e) => setPerTx(e.target.value)} />
                        </label>
                      </div>
                      <button className="btn btn--primary" type="submit" disabled={Boolean(busy)}>
                        Open my pocket
                      </button>
                    </form>
                  ) : (
                    <div className="pocket-actions-grid">
                      <div className="pocket-topup">
                        <span>Top up</span>
                        {amountChips.map((a) => (
                          <button
                            key={a}
                            type="button"
                            onClick={() => prepare({ action: 'topup', amount: a }, 'topup')}
                            disabled={Boolean(busy) || s.ownerUsdc < a}
                          >
                            {usd(a)}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className={`btn ${s.frozen ? 'btn--primary' : 'btn--ice'}`}
                        onClick={() =>
                          prepare({ action: s.frozen ? 'unfreeze' : 'freeze' }, s.frozen ? 'unfreeze' : 'freeze')
                        }
                        disabled={Boolean(busy)}
                      >
                        <SnowIcon size={16} /> {s.frozen ? 'Warm me up' : 'Freeze me'}
                      </button>
                      <button
                        type="button"
                        className="btn btn--ice"
                        onClick={() => prepare({ action: 'withdraw', amount: s.vault }, 'withdraw')}
                        disabled={Boolean(busy) || s.vault <= 0}
                      >
                        Take it all back
                      </button>
                    </div>
                  )}

                  {s.exists ? (
                    <Guardrails
                      perTx={s.perTxLimit}
                      daily={s.dailyLimit}
                      spentToday={s.spentToday}
                      frozen={s.frozen}
                      programUrl={PROGRAM_URL(s.cluster)}
                    />
                  ) : (
                    !wantsFaucet &&
                    !feedNeedsUsdc && (
                      <Guardrails
                        preview
                        perTx={Number(perTx) || 0}
                        daily={Number(daily) || 0}
                        programUrl={PROGRAM_URL(s.cluster)}
                      />
                    )
                  )}
                  {external && (
                    <button type="button" className="ghost-btn pocket-backup" onClick={signOut}>
                      Sign out of {external.wallet.replace(/^Mobile Wallet Adapter$/, 'this wallet')}
                    </button>
                  )}
                  {record && (
                    <button
                      type="button"
                      className="ghost-btn pocket-backup"
                      onClick={() => {
                        if (!backup) onBackup?.()
                        setBackup((b) => (b ? null : exportKey()))
                      }}
                    >
                      {backup ? 'Hide backup key' : 'Back up my key'}
                    </button>
                  )}
                  {backup && (
                    <p className="pocket-secret">
                      <b>Never share this, and check nobody can see your screen.</b> Anyone with it controls your Sunny
                      wallet. You can import it into Phantom.
                      <code>{backup}</code>
                      <button
                        type="button"
                        className="ghost-btn pocket-copy"
                        onClick={() =>
                          void navigator.clipboard
                            ?.writeText(backup)
                            .then(() => {
                              setCopied(true)
                              window.setTimeout(() => setCopied(false), 2000)
                            })
                            .catch(() => {})
                        }
                      >
                        {copied ? 'Copied ✓' : 'Copy key'}
                      </button>
                    </p>
                  )}
                </>
              )}

              {busy && !passwordForm && (
                <div className="scan-pending" role="status">
                  <span className="chat-typing">
                    <span />
                    <span />
                    <span />
                  </span>
                  {busy}
                </div>
              )}
              {error && !passwordForm && <p className="scan-error">{error}</p>}
            </div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  )
}
