import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { SunMark } from './Icons'

export type ChatMessage = { id: number; from: 'sunny' | 'you'; text: string; error?: boolean }

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
                  <p>{m.text}</p>
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
