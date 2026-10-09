import { useEffect, useRef, useState, type FormEvent } from 'react'
import { closeOnBack } from '../lib/back'
import { AnimatePresence, motion } from 'motion/react'
import { SunMark } from './Icons'
import {
  AlertCardView,
  BlinkCardView,
  DeepScanView,
  LinkCardView,
  MyWalletView,
  PocketEventView,
  TokenCardView,
  WalletCardView,
} from './Cards'
import { walletSession } from '../lib/api'
import type { AlertCard, DeepScan, LinkCheck, MyWallet, PocketEvent, TokenCard } from '../lib/chat'
import type { BlinkReport, WalletReport } from '../lib/home'

export type ChatMessage = {
  id: number
  from: 'sunny' | 'you'
  text: string
  error?: boolean
  cards?: TokenCard[]
  links?: LinkCheck[]
  alerts?: AlertCard[]
  pocket?: PocketEvent[]
  mine?: MyWallet | null
  wallets?: WalletReport[]
  scans?: DeepScan[]
  blinks?: BlinkReport[]
  live?: boolean
}

type ChatSheetProps = {
  open: boolean
  messages: ChatMessage[]
  pending: boolean
  suggestions: string[]
  sameAsTelegram: boolean
  onSend: (text: string) => void
  onClose: () => void
}

const MAX_CHARS = 800

/** Sunny's own Telegram link becomes tappable. Nothing else does: a reply may quote a scam's link. */
const linkify = (text: string) =>
  text.split(/(t\.me\/SunnySolBot(?:\?startgroup=guard)?)/g).map((part, i) =>
    i % 2 ? (
      <a key={i} href={`https://${part}`} target="_blank" rel="noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  )

/** Chat with Sunny without leaving the Mini App; it's the same conversation as the Telegram chat. */
export function ChatSheet({ open, messages, pending, suggestions, sameAsTelegram, onSend, onClose }: ChatSheetProps) {
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Keep the newest message in view: your own messages and the typing dots at the bottom, and a
  // new answer from Sunny from its first line (a long one with cards would open at its end).
  useEffect(() => {
    const log = logRef.current
    if (!log) return
    const last = messages.at(-1)
    const el = [...log.querySelectorAll<HTMLElement>('.chat-msg')].at(-1)
    if (!pending && last?.from === 'sunny' && el && el.offsetHeight > log.clientHeight * 0.6) {
      const top = log.scrollTop + el.getBoundingClientRect().top - log.getBoundingClientRect().top - 12
      log.scrollTo({ top, behavior: 'smooth' })
    } else {
      log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' })
    }
  }, [messages, pending])

  // Telegram's own back button closes the sheet; Escape does too on desktop.
  useEffect(() => {
    if (!open) return
    const offBack = closeOnBack(onClose)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const focus = window.setTimeout(() => inputRef.current?.focus(), 350)
    return () => {
      offBack()
      window.removeEventListener('keydown', onKey)
      clearTimeout(focus)
    }
  }, [open, onClose])

  const send = (text: string) => {
    const t = text.trim()
    if (!t || pending) return
    onSend(t)
    setDraft('')
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    send(draft)
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
            className="chat-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Chat with Sunny"
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
                  <strong>Sunny</strong>
                  <small>{sameAsTelegram ? 'I remember our Telegram chat' : walletSession() ? 'Signed in with your wallet' : 'Guest · no sign-in needed'}</small>
                </div>
              </div>
              <button type="button" className="chat-close" onClick={onClose} aria-label="Close chat">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </button>
            </header>

            <div className="chat-log" ref={logRef} aria-live="polite">
              {messages.map((m) => (
                <motion.div
                  key={m.id}
                  className={`chat-msg chat-msg--${m.from}`}
                  data-error={m.error || undefined}
                  initial={{ opacity: 0, y: 10, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                >
                  {m.from === 'sunny' && (
                    <span className="chat-avatar" aria-hidden="true">
                      <SunMark size={18} />
                    </span>
                  )}
                  <div className="chat-body">
                    <p>{m.from === 'sunny' ? linkify(m.text) : m.text}</p>
                    {m.links?.map((l) => (
                      <LinkCardView key={l.domain} link={l} />
                    ))}
                    {m.blinks?.map((b) => (
                      <BlinkCardView key={b.actionUrl} report={b} />
                    ))}
                    {m.scans?.map((s) => (
                      <DeepScanView key={s.paymentTx} scan={s} />
                    ))}
                    {m.mine && <MyWalletView wallet={m.mine} />}
                    {m.wallets?.map((w) => (
                      <WalletCardView key={w.address} report={w} />
                    ))}
                    {m.pocket?.map((e, i) => (
                      <PocketEventView key={i} event={e} />
                    ))}
                    {m.alerts?.map((a) => (
                      <AlertCardView key={`${a.symbol}-${a.triggerPrice}`} alert={a} />
                    ))}
                    {m.cards?.map((c) => (
                      <TokenCardView key={c.mint} card={c} />
                    ))}
                    {m.live && (
                      <span className="chat-live">
                        <span className="chat-live-dot" /> Live from Jupiter
                      </span>
                    )}
                  </div>
                </motion.div>
              ))}
              {pending && (
                <div className="chat-msg chat-msg--sunny" role="status" aria-label="Sunny is typing">
                  <span className="chat-avatar" aria-hidden="true">
                    <SunMark size={18} />
                  </span>
                  <p className="chat-typing">
                    <span />
                    <span />
                    <span />
                  </p>
                </div>
              )}
            </div>

            {suggestions.length > 0 && !pending && (
              <div className="chat-suggest">
                {suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            <form className="chat-input" onSubmit={onSubmit}>
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, MAX_CHARS))}
                placeholder="Ask Sunny anything…"
                aria-label="Message Sunny"
                enterKeyHint="send"
                autoComplete="off"
              />
              <button type="submit" disabled={!draft.trim() || pending} aria-label="Send">
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path
                    d="M12 19V5M5.5 11.5 12 5l6.5 6.5"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </svg>
              </button>
            </form>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  )
}
