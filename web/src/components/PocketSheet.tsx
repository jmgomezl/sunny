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
  /** Optional action to jump to, e.g. from the home card's Top up / Freeze buttons. */
  intent?: 'topup' | 'freeze' | 'unfreeze'
  onClose: () => void
  onChanged: (state: PocketState | null, event: PocketEventKind, sent?: Sent) => void
  onBusy: (busy: boolean) => void
}

type Prepared = { id: string; message: string; summary: string[]; event: PocketEventKind }

const usd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`

/** Your Sunny wallet (self-custodial, password-locked) and Sunny's pocket money. */
export function PocketSheet({ open, state, intent, onClose, onChanged, onBusy }: PocketSheetProps) {
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
                  <strong>Pocket money</strong>
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
              {!inTelegram() && (
                <p className="scan-note">
                  Your Sunny wallet lives inside Telegram, where you’re verified. Open me from @SunnySolBot to create
                  it.
                </p>
              )}

              {inTelegram() && record === undefined && <p className="scan-hint">Looking for your wallet…</p>}

              {/* 1. Create a self-custodial wallet, OculusVault-style. */}
              {inTelegram() && record === null && (
                <form className="pocket-form" onSubmit={create}>
                  <h3>Create your Sunny wallet</h3>
                  <ul className="pocket-points">
                    <li>Made on this phone, no app to install</li>
                    <li>Locked with your password; Sunny’s server can’t open it</li>
                    <li>Network fees are on Sunny</li>
                  </ul>
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
                    There’s no reset: if you forget it, this wallet is gone. Keep pocket amounts small.
                  </p>
                  <button
                    className="btn btn--primary"
                    type="submit"
                    disabled={Boolean(busy) || password.length < MIN_PASSWORD}
                  >
                    Create wallet
                  </button>
                </form>
              )}

              {/* 2. Unlock. */}
              {record && !unlocked && (
                <form className="pocket-form" onSubmit={unlock}>
                  <h3>Unlock your wallet</h3>
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
                      <small>In Sunny’s pocket</small>
                      <strong>{usd(s.vault)}</strong>
                      <span>{s.exists ? `${usd(s.leftToday)} left today` : 'not open yet'}</span>
                    </div>
                  </div>

                  {s.ownerUsdc < 5 && (
                    <button type="button" className="btn btn--ice" onClick={getTestUsdc} disabled={Boolean(busy)}>
                      Get 20 test USDC
                    </button>
                  )}

                  {!s.exists ? (
                    <form
                      className="pocket-form"
                      onSubmit={(e) => {
                        e.preventDefault()
                        prepare({ action: 'open', daily: Number(daily), perTx: Number(perTx) }, 'opened')
                      }}
                    >
                      <h3>Give Sunny pocket money</h3>
                      <p className="scan-hint">
                        Sunny can only spend inside these limits. Solana enforces them, not Sunny’s server.
                      </p>
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
                        Open pocket
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
                        <SnowIcon size={16} /> {s.frozen ? 'Unfreeze' : 'Freeze'}
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
                    onClick={() => setBackup((b) => (b ? null : exportKey()))}
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
