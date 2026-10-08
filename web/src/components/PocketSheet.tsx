import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { SnowIcon, SolanaMark, SunMark } from './Icons'
import { inTelegram } from '../lib/api'
import { BOT_LINK, type ShareSpec } from '../lib/share'
import { ShareRow } from './Cards'
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
  onBusy: (busy: boolean) => void
  /** Called when the key backup is shown, which earns the Key Keeper badge. */
  onBackup?: () => void
}

type Prepared = { id: string; message: string; summary: string[]; event: PocketEventKind }

const usd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`

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

// What the password is for, when the sheet was opened to do something specific.
const UNLOCK_FOR: Record<string, string> = {
  freeze: 'Tell me your password and I’ll freeze my pocket right away.',
  unfreeze: 'Tell me your password and I’ll warm my pocket back up.',
  topup: 'Tell me your password and we’ll top up my pocket.',
  feed: 'Tell me your password and that coin is mine! 🪙',
}

export function PocketSheet({ open, state, intent, feedAmount = 5, onClose, onChanged, onBusy, onBackup }: PocketSheetProps) {
  const [record, setRecord] = useState<VaultRecord | null | undefined>(undefined)
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
    setRecord(undefined)
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

  useEffect(() => {
    if (!open) return
    const back = window.Telegram?.WebApp?.BackButton
    back?.show()
    back?.onClick(onClose)
    // Escape closes it too, like the other sheets.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      back?.offClick(onClose)
      back?.hide()
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
    if (!record) return
    void run('Preparing…', async () => {
      setDone(null)
      const p = await preparePocket(a, record.address)
      setPrepared({ ...p, event })
    })
  }

  // Fed a coin on the home screen: the top-up (or, for a new pocket, opening it with that first
  // money, in one signature) is prepared right away, so all that's left is to look and sign.
  const fed = useRef(false)
  useEffect(() => {
    if (open) fed.current = false
  }, [open])
  useEffect(() => {
    if (!open || intent !== 'feed' || fed.current || !unlocked || !record || !state || prepared || busy) return
    if (state.frozen || state.ownerUsdc < feedAmount) return
    fed.current = true
    if (state.exists) prepare({ action: 'topup', amount: feedAmount }, 'topup')
    else prepare({ action: 'open', daily: Number(daily) || 10, perTx: Number(perTx) || 5, amount: feedAmount }, 'opened')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, intent, unlocked, record, state?.exists, state?.ownerUsdc, state?.frozen, prepared, busy])

  // Jump straight to what the home card asked for.
  useEffect(() => {
    if (!open || !unlocked || !record || !state?.exists || !intent || prepared) return
    if (intent === 'freeze' && !state.frozen) prepare({ action: 'freeze' }, 'freeze')
    if (intent === 'unfreeze' && state.frozen) prepare({ action: 'unfreeze' }, 'unfreeze')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, unlocked, record, state?.exists, intent])

  const approve = () => {
    if (!prepared) return
    void run('Signing on this phone…', async () => {
      const sent = await submitPocket(prepared)
      setDone({ text: prepared.summary.map(pastTense).join(' · '), explorer: sent.explorer, event: prepared.event })
      setPrepared(null)
      onChanged(sent.state, prepared.event, sent)
    })
  }

  const getTestUsdc = () =>
    void run('Getting test USDC…', async () => {
      const sent = await pocketFaucet()
      setDone({ text: `Got ${sent.amount} test USDC`, explorer: sent.explorer })
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
  // Sunny walks you through every step in its own words.
  const line = !inTelegram()
    ? 'My wallet lives inside Telegram, where you’re verified. Open me from @SunnySolBot to make yours.'
    : loadError
      ? loadError
      : record === undefined
      ? 'Looking for your wallet…'
      : record === null
        ? `${intent === 'hello' ? `Hi${name ? ` ${name}` : ''}! I’m Sunny ☀️ ` : ''}Let’s make your wallet together. It’s born right here on your phone and locked with a password only you know.`
        : !unlocked
          ? `${name ? `Hi ${name}! ` : ''}${UNLOCK_FOR[intent ?? ''] ?? 'Welcome back! Tell me your password so I know it’s you.'}`
          : prepared
            ? intent === 'feed'
              ? 'Nom! Sign it and the coin is really mine. I read this on your phone, not on my server.'
              : 'Have a look before you sign. I read this on your phone, not on my server.'
            : intent === 'feed' && s?.frozen
              ? 'I’m frozen, so I can’t eat right now ❄ Warm me up first, then feed me.'
              : intent === 'feed' && s && s.ownerUsdc < feedAmount
                ? 'Your wallet needs test USDC before you can feed me. Get some below, and that coin is mine 🪙'
            : !s
              ? 'Your wallet is ready! Let me check it on Solana…'
              : wantsFaucet
                ? 'Your wallet is ready! We’re on devnet, so money here is just for practice. Want 20 test USDC to play with?'
                : !s.exists
                  ? 'If you like, give me a small daily allowance. I can only spend inside these limits, and Solana checks every payment, not me.'
                  : s.frozen
                    ? 'Brrr, I’m frozen ❄ I can’t spend a cent until you warm me up.'
                    : `I have ${usd(s.leftToday)} left today. Top me up, freeze me, or take it all back whenever you like.`

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
                  <strong>Sunny wallet</strong>
                  <small>
                    {record ? `Your wallet ${record.address.slice(0, 4)}…${record.address.slice(-4)} · ` : ''}
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

              {loadError && (
                <button type="button" className="btn btn--primary pocket-open-tg" onClick={reload}>
                  Try again
                </button>
              )}

              {/* Outside Telegram (the web preview), the way in is one tap away. */}
              {!inTelegram() && (
                <a className="btn btn--primary pocket-open-tg" href={BOT_LINK} target="_blank" rel="noreferrer">
                  Open Sunny in Telegram
                </a>
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
                    Not even I can open it, so there’s no reset: if you forget the password, the wallet is gone. Network
                    fees are on me.
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
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* 4. Pocket controls. */}
              {record && unlocked && !prepared && s && (
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
                      <span>{s.exists ? `${usd(s.leftToday)} left today` : 'not open yet'}</span>
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

                  <a className="verify" href={PROGRAM_URL(s.cluster)} target="_blank" rel="noreferrer">
                    <SolanaMark size={13} /> Rules enforced by program 7RhP…4wvy
                  </a>
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
                  {backup && (
                    <p className="pocket-secret">
                      <b>Never share this, and check nobody can see your screen.</b> Anyone with it controls your
                      Sunny wallet. You can import it into Phantom.
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
            </div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  )
}
