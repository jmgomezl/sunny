import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { SolanaMark, SunMark } from './Icons'
import type { AlertCard, LinkCheck, TokenCard } from '../lib/chat'

export type ChatMessage = {
  id: number
  from: 'sunny' | 'you'
  text: string
  error?: boolean
  cards?: TokenCard[]
  links?: LinkCheck[]
  alerts?: AlertCard[]
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

/** Chat with Sunny without leaving the Mini App; it's the same conversation as the Telegram chat. */
export function ChatSheet({ open, messages, pending, suggestions, sameAsTelegram, onSend, onClose }: ChatSheetProps) {
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Keep the newest message in view.
  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' })
  }, [messages, pending])

  // Telegram's own back button closes the sheet; Escape does too on desktop.
  useEffect(() => {
    if (!open) return
    const back = window.Telegram?.WebApp?.BackButton
    back?.show()
    back?.onClick(onClose)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const focus = window.setTimeout(() => inputRef.current?.focus(), 350)
    return () => {
      back?.offClick(onClose)
      back?.hide()
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
                  <small>{sameAsTelegram ? 'Same chat as Telegram' : 'Web preview'}</small>
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
                    <p>{m.text}</p>
                    {m.links?.map((l) => (
                      <LinkCardView key={l.domain} link={l} />
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
                <div className="chat-msg chat-msg--sunny" aria-label="Sunny is typing">
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

const RISK_LABEL = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' } as const

function formatUsd(n: number) {
  if (n >= 1) return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
  return `$${n.toPrecision(3)}`
}

function compact(n: number) {
  return n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })
}

/** Live token card: price, 24h move and the safety audit, straight from Jupiter. */
function TokenCardView({ card }: { card: TokenCard }) {
  const [iconFailed, setIconFailed] = useState(false)
  const dir = (card.change24h ?? 0) > 0 ? 'up' : (card.change24h ?? 0) < 0 ? 'down' : 'flat'
  return (
    <div className={`token-card token-card--${card.risk}`}>
      <div className="token-card-top">
        {card.icon && !iconFailed ? (
          <img
            src={card.icon}
            alt=""
            width={30}
            height={30}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setIconFailed(true)}
          />
        ) : (
          <span className="token-card-letter">{card.symbol[0]}</span>
        )}
        <div className="token-card-id">
          <strong>
            {card.symbol}
            {card.verified && (
              <span className="token-card-verified" title="Verified on Jupiter">
                ✓
              </span>
            )}
          </strong>
          <small>{card.name}</small>
        </div>
        <div className="token-card-price">
          <strong>{card.price !== null ? formatUsd(card.price) : '—'}</strong>
          {card.change24h !== null && (
            <small className={`delta delta--${dir}`}>
              {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '•'} {Math.abs(card.change24h)}% 24h
            </small>
          )}
        </div>
      </div>
      <div className="token-card-meta">
        <span className={`risk-pill risk-pill--${card.risk}`}>{RISK_LABEL[card.risk]}</span>
        {card.liquidity !== null && <span>Liquidity ${compact(card.liquidity)}</span>}
        {card.holders !== null && <span>{compact(card.holders)} holders</span>}
      </div>
      {card.flags.length > 0 && (
        <ul className="token-card-flags">
          {card.flags.slice(0, 3).map((f) => (
            <li key={f.text} data-level={f.level}>
              {f.text}
            </li>
          ))}
        </ul>
      )}
      <a
        className="token-card-mint"
        href={`https://solscan.io/token/${card.mint}`}
        target="_blank"
        rel="noreferrer"
        title={card.mint}
      >
        <SolanaMark size={11} /> {card.mint.slice(0, 4)}…{card.mint.slice(-4)}
      </a>
    </div>
  )
}

const VERDICT = {
  known_scam: { label: 'Known scam', icon: '⛔' },
  suspicious: { label: 'Suspicious', icon: '⚠️' },
  official: { label: 'Official site', icon: '✅' },
  unknown: { label: 'Not on scam lists', icon: '🔍' },
} as const

/** Verdict on a link the user asked about (phishing lists + impersonation checks). */
function LinkCardView({ link }: { link: LinkCheck }) {
  const v = VERDICT[link.verdict]
  return (
    <div className={`link-card link-card--${link.verdict}`}>
      <div className="link-card-top">
        <span className="link-card-icon" aria-hidden="true">
          {v.icon}
        </span>
        <div>
          <strong>{v.label}</strong>
          <code>{link.domain}</code>
        </div>
      </div>
      <ul>
        {link.reasons.slice(0, 3).map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  )
}

/** Confirmation of a price alert Sunny will watch and message about in Telegram. */
function AlertCardView({ alert }: { alert: AlertCard }) {
  const what =
    alert.percent !== null
      ? `${alert.direction === 'drop' ? 'Drops' : 'Rises'} ${alert.percent}%`
      : `${alert.direction === 'drop' ? 'Falls to' : 'Reaches'} ${formatUsd(alert.triggerPrice)}`
  return (
    <div className="alert-card">
      <span className="alert-card-bell" aria-hidden="true">
        🔔
      </span>
      <div>
        <strong>
          Watching {alert.symbol} · {what}
        </strong>
        <small>
          Now {formatUsd(alert.basePrice)} → alert at {formatUsd(alert.triggerPrice)}. I’ll message you in Telegram.
        </small>
      </div>
    </div>
  )
}
