import { useEffect, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { SnowIcon, SolanaMark, SunMark } from './Icons'
import { inTelegram } from '../lib/api'
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
  intent?: 'topup' | 'freeze' | 'unfreeze' | 'hello'
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
export function PocketSheet({ open, state, intent, onClose, onChanged, onBusy, onBackup }: PocketSheetProps) {
  const [record, setRecord] = useState<VaultRecord | null | undefined>(undefined)
  const [unlocked, setUnlocked] = useState(isUnlocked())
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [done, setDone] = useState<{ text: string; explorer?: string } | null>(null)
  const [daily, setDaily] = useState('10')
  const [perTx, setPerTx] = useState('5')
  const [backup, setBackup] = useState<string | null>(null)
  const [skipFaucet, setSkipFaucet] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    setDone(null)
    setPrepared(null)
    setBackup(null)
    setUnlocked(isUnlocked())
    if (inTelegram())
      loadRecord()
        .then(setRecord)
        .catch(() => setRecord(null))
    else setRecord(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    const back = window.Telegram?.WebApp?.BackButton
    back?.show()
    back?.onClick(onClose)
    return () => {
      back?.offClick(onClose)
      back?.hide()
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
      await saveRecord(r)
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
      setDone({ text: prepared.summary.join(' · '), explorer: sent.explorer })
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
  const name = firstName()
  // Sunny walks you through every step in its own words.
  const line = !inTelegram()
    ? 'My wallet lives inside Telegram, where you’re verified. Open me from @SunnySolBot to make yours.'
    : record === undefined
      ? 'Looking for your wallet…'
      : record === null
        ? `${intent === 'hello' ? `Hi${name ? ` ${name}` : ''}! I’m Sunny ☀️ ` : ''}Let’s make your wallet together. It’s born right here on your phone and locked with a password only you know.`
        : !unlocked
          ? `Welcome back${name ? `, ${name}` : ''}! Tell me your password so I know it’s you.`
          : prepared
            ? 'Have a look before you sign. I read this on your phone, not on my server.'
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

              {/* 1. Create a self-custodial wallet, OculusVault-style. */}
              {inTelegram() && record === null && (
                <form className="pocket-form" onSubmit={create}>
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder={`Password (${MIN_PASSWORD}+ characters)`}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder="Repeat password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                  <p className="scan-hint">
                    Not even I can open it, so there’s no reset: if you forget the password, the wallet is gone. Network
                    fees are on me.
                  </p>
                  <button
                    className="btn btn--primary"
                    type="submit"
                    disabled={Boolean(busy) || password.length < MIN_PASSWORD}
                  >
                    Make my wallet
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
                    type="password"
                    autoComplete="current-password"
                    placeholder="Your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button className="btn btn--primary" type="submit" disabled={Boolean(busy) || !password}>
                    Unlock
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
                      className={`btn ${wantsFaucet ? 'btn--primary' : 'btn--ice'}`}
                      onClick={getTestUsdc}
                      disabled={Boolean(busy)}
                    >
                      Get 20 test USDC
                    </button>
                  )}

                  {wantsFaucet ? (
                    <button type="button" className="ghost-btn pocket-later" onClick={() => setSkipFaucet(true)}>
                      Skip for now
                    </button>
                  ) : !s.exists ? (
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
                      <b>Never share this.</b> Anyone with it controls your Sunny wallet. You can import it into
                      Phantom.
                      <code>{backup}</code>
                    </p>
                  )}
                </>
              )}

              {busy && (
                <div className="scan-pending" role="status">
                  <span className="chat-typing">
                    <span />
                    <span />
                    <span />
                  </span>
                  {busy}
                </div>
              )}
              {error && <p className="scan-error">{error}</p>}
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
            </div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  )
}
