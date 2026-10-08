import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { SunMark } from './Icons'
import { BlinkCardView, LinkCardView, TokenCardView, WalletCardView } from './Cards'
import { inspectInput, type Inspection } from '../lib/home'

export type ScanMode = 'check' | 'link'

type ScanSheetProps = {
  open: boolean
  mode: ScanMode
  /** Something to check right away, e.g. a token tapped in the watchlist. */
  initialInput?: string
  onClose: () => void
  onChecking: () => void
  onResult: (result: Inspection | null) => void
  /** Wallets Sunny already watches. */
  watching: string[]
  onLinkWallet: (address: string) => void
  onUnwatch: (address: string) => void
  onAsk: (question: string) => void
  onWatch: (symbol: string) => void
  /** Whether Sunny's pocket can pay for a $0.10 deep scan right now, and what to do if not. */
  deepScan: 'ready' | 'feed' | 'none'
  onFeed: () => void
}

// Telegram's script defines the scanner everywhere, but it only works inside Telegram itself.
const canScan = () =>
  Boolean(window.Telegram?.WebApp?.initData) && typeof window.Telegram?.WebApp?.showScanQrPopup === 'function'

/** Scan a QR or paste anything (wallet, token, link) and Sunny tells you what it is. */
export function ScanSheet(props: ScanSheetProps) {
  const {
    open,
    mode,
    initialInput,
    watching,
    onClose,
    onChecking,
    onResult,
    onLinkWallet,
    onUnwatch,
    onAsk,
    onWatch,
    deepScan,
    onFeed,
  } = props
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<Inspection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const check = async (value: string) => {
    const input = value.trim()
    if (!input || pending) return
    // Watching needs a wallet address (or a link or QR code that carries one), not a name.
    if (mode === 'link' && !/[1-9A-HJ-NP-Za-km-z]{32,44}/.test(input)) {
      setDraft(input)
      setResult(null)
      setError('That doesn’t look like a wallet address. It’s a long code of letters and numbers, like 9AhK…sbkw.')
      return
    }
    setDraft(input)
    setPending(true)
    setError(null)
    setResult(null)
    onChecking()
    try {
      const r = await inspectInput(input)
      setResult(r)
      // A token pasted where a wallet was asked for isn't a little win for Sunny.
      onResult(mode === 'link' && r.kind === 'token' ? null : r)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      onResult(null)
    } finally {
      setPending(false)
    }
  }

  // Reset when opening, and check right away if something was handed in.
  useEffect(() => {
    if (!open) return
    setResult(null)
    setError(null)
    setDraft(initialInput ?? '')
    if (initialInput) void check(initialInput)
    else if (!canScan()) window.setTimeout(() => inputRef.current?.focus(), 350)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialInput])

  // Telegram's back button and Escape close the sheet.
  useEffect(() => {
    if (!open) return
    const back = window.Telegram?.WebApp?.BackButton
    back?.show()
    back?.onClick(onClose)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      back?.offClick(onClose)
      back?.hide()
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  const scan = () => {
    window.Telegram?.WebApp?.showScanQrPopup?.(
      { text: mode === 'link' ? 'Scan the wallet’s QR code' : 'Scan a wallet, token or link' },
      (data) => {
        void check(data)
        return true
      },
    )
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void check(draft)
  }

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
            className="chat-sheet scan-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={mode === 'link' ? 'Watch a wallet' : 'Scan and check'}
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
                  <strong>{mode === 'link' ? 'Watch a wallet' : 'Scan & check'}</strong>
                  <small>{mode === 'link' ? 'Read-only: I can watch, never spend' : 'Wallets, tokens or links'}</small>
                </div>
              </div>
              <button type="button" className="chat-close" onClick={onClose} aria-label="Close">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </button>
            </header>

            <div className="scan-body">
              {canScan() ? (
                <button type="button" className="scan-qr" onClick={scan} disabled={pending}>
                  <QrIcon />
                  <span>
                    <strong>Scan a QR code</strong>
                    <small>
                      {mode === 'link'
                        ? 'The receive QR in Phantom or any wallet app'
                        : 'From a wallet, a token page or a flyer'}
                    </small>
                  </span>
                </button>
              ) : (
                <p className="scan-hint">Open me in Telegram to scan QR codes. Pasting works everywhere.</p>
              )}

              <form className="chat-input scan-input" onSubmit={onSubmit}>
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.slice(0, 300))}
                  placeholder={mode === 'link' ? 'Paste a wallet address' : 'Paste a wallet, token or link'}
                  aria-label="Address, token or link"
                  enterKeyHint="go"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="submit" disabled={!draft.trim() || pending} aria-label="Check">
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <path
                      d="m5 12.5 4.2 4.2L19 7"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      fill="none"
                    />
                  </svg>
                </button>
              </form>

              {mode === 'check' && !result && !pending && !error && (
                <div className="chat-suggest scan-try">
                  <span>Try</span>
                  {['BONK', 'JUP', 'raydlum.io'].map((t) => (
                    <button key={t} type="button" onClick={() => void check(t)}>
                      {t}
                    </button>
                  ))}
                </div>
              )}

              {pending && (
                <div className="scan-pending" role="status">
                  <span className="chat-typing">
                    <span />
                    <span />
                    <span />
                  </span>
                  Checking on Solana…
                </div>
              )}

              {error && (
                <p className="scan-error" role="alert">
                  {error}
                </p>
              )}

              {result && (
                <motion.div
                  className="scan-result"
                  // Results are read out when they arrive, safe ones included.
                  role="status"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                >
                  {/* Watching needs a wallet: a token's address gets a clear word instead of "Watch it". */}
                  {mode === 'link' && result.kind === 'token' && result.found && (
                    <p className="scan-error">
                      That’s the address of a token ({result.card.symbol}), not a wallet. Paste a wallet address to
                      watch it, or check the token in Scan &amp; check.
                    </p>
                  )}
                  {mode !== 'link' && result.kind === 'token' && result.found && (
                    <>
                      {!result.details.exact_match && (
                        <p className="scan-note">No token is called exactly “{draft}”. This is the closest match.</p>
                      )}
                      {result.details.other_tokens_with_same_symbol > 0 && (
                        <p className="scan-note">
                          {result.details.other_tokens_with_same_symbol} other token
                          {result.details.other_tokens_with_same_symbol > 1 ? 's use' : ' uses'} this name. Always check
                          the address.
                        </p>
                      )}
                      <TokenCardView card={result.card} />
                      <div className="scan-actions">
                        <button type="button" className="btn btn--primary" onClick={() => onWatch(result.card.symbol)}>
                          Watch it
                        </button>
                        <button
                          type="button"
                          className="btn btn--ice"
                          onClick={() => onAsk(`Tell me more about ${result.card.symbol} (${result.card.mint})`)}
                        >
                          Ask Sunny
                        </button>
                      </div>
                      {/* Sunny buys it with pocket money, over x402; the request goes through the chat.
                          Only offered when the pocket can pay; otherwise Sunny asks for a coin first. */}
                      {deepScan === 'ready' && (
                        <button
                          type="button"
                          className="ghost-btn scan-deep"
                          onClick={() => onAsk(`Deep scan ${result.card.symbol} (${result.card.mint})`)}
                        >
                          Deep scan · $0.10 from my pocket
                        </button>
                      )}
                      {deepScan === 'feed' && (
                        <button type="button" className="ghost-btn scan-deep" onClick={onFeed}>
                          Deep scan · feed me $0.10 first 🪙
                        </button>
                      )}
                    </>
                  )}
                  {result.kind === 'token' && !result.found && (
                    <p className="scan-error">I couldn’t find a token called “{result.query}”.</p>
                  )}
                  {result.kind === 'wallet' && (
                    <>
                      <WalletCardView report={result.report} />
                      <div className="scan-actions">
                        {watching.includes(result.report.address) ? (
                          <button
                            type="button"
                            className="btn btn--ice"
                            onClick={() => onUnwatch(result.report.address)}
                          >
                            Stop watching
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn--primary"
                            onClick={() => onLinkWallet(result.report.address)}
                          >
                            Watch this wallet
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn--ice"
                          onClick={() => onAsk(`What do you think of this wallet? ${result.report.address}`)}
                        >
                          Ask Sunny
                        </button>
                      </div>
                    </>
                  )}
                  {result.kind === 'blink' && (
                    <>
                      <BlinkCardView report={result.report} />
                      <div className="scan-actions">
                        <button
                          type="button"
                          className="btn btn--ice"
                          onClick={() => onAsk(`Should I sign this Blink? ${result.report.link}`)}
                        >
                          Ask Sunny
                        </button>
                      </div>
                    </>
                  )}
                  {result.kind === 'link' && (
                    <>
                      <LinkCardView link={result.link} />
                      <div className="scan-actions">
                        <button
                          type="button"
                          className="btn btn--ice"
                          onClick={() => onAsk(`Is this link safe? ${result.link.domain}`)}
                        >
                          Ask Sunny why
                        </button>
                      </div>
                    </>
                  )}
                  {result.kind === 'unknown' && <p className="scan-error">{result.message}</p>}
                </motion.div>
              )}
            </div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  )
}

function QrIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="26"
      height="26"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
    >
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
      <rect x="7.5" y="7.5" width="3.5" height="3.5" rx="0.6" />
      <rect x="13" y="7.5" width="3.5" height="3.5" rx="0.6" />
      <rect x="7.5" y="13" width="3.5" height="3.5" rx="0.6" />
      <path d="M13 13h1.5v1.5M16.5 16.5H15" />
    </svg>
  )
}
