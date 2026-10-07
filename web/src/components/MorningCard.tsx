import { motion } from 'motion/react'
import type { Home } from '../lib/home'
import { AlertIcon, CheckIcon, EyeIcon, MoonIcon, ShieldIcon, SunMark } from './Icons'

// Bedtime, part two: the first visit of the morning opens with a short note on what Sunny
// watched overnight: the wallets and how they moved, the security news, any price alert that
// fired, and the streak. Everything comes from the real home data and the last visit.

const VISIT_KEY = 'sunny.visit'
const SEEN_KEY = 'sunny.morning'

/** What the sky looked like at the last visit, saved so the morning can compare. */
export type Visit = { at: string; value: number | null; wallets: number }

export function readVisit(): Visit | null {
  try {
    const v = JSON.parse(localStorage.getItem(VISIT_KEY) ?? 'null') as Visit | null
    return v && typeof v.at === 'string' ? v : null
  } catch {
    return null
  }
}

export function saveVisit(home: Home) {
  try {
    const v: Visit = { at: new Date().toISOString(), value: home.value, wallets: home.wallets.length }
    localStorage.setItem(VISIT_KEY, JSON.stringify(v))
  } catch {
    // Private mode: no morning note, nothing else changes.
  }
}

const today = () => new Date().toDateString()

/**
 * Morning (5 am to 1 pm), the last visit was before 5 am today and at least five hours ago,
 * and the note wasn't already seen today.
 */
export function wantsMorning(last: Visit | null) {
  if (!last) return false
  const now = new Date()
  const dawn = new Date(now)
  dawn.setHours(5, 0, 0, 0)
  const then = Date.parse(last.at)
  let seen = ''
  try {
    seen = localStorage.getItem(SEEN_KEY) ?? ''
  } catch {
    // Without storage it shows once per app start in the morning, which is fine.
  }
  return now.getHours() >= 5 && now.getHours() < 13 && then < dawn.getTime() && Date.now() - then > 5 * 3_600_000 && seen !== today()
}

export function markMorningSeen() {
  try {
    localStorage.setItem(SEEN_KEY, today())
  } catch {
    // Fine: it just won't remember.
  }
}

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n < 10 ? 2 : 0 })
const time = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()

type Row = { icon: 'eye' | 'shield' | 'alert' | 'sun'; text: string; tone?: 'warn' | 'ok' }

function rowsFor(home: Home, last: Visit): Row[] {
  const since = Date.parse(last.at)
  const rows: Row[] = []

  const n = home.wallets.length
  if (home.value !== null) {
    const what = n ? `${n} wallet${n > 1 ? 's' : ''}` : 'Solana'
    const before = last.value !== null && (last.wallets > 0) === n > 0 ? last.value : null
    const move = before ? ((home.value - before) / before) * 100 : null
    const moved = move !== null ? ` (${move >= 0 ? '+' : ''}${move.toFixed(1)}%)` : ''
    rows.push({
      icon: 'eye',
      text: before
        ? `I watched ${what} all night: ${usd(before)} → ${usd(home.value)}${moved}`
        : `I watched ${what} all night: ${usd(home.value)} now`,
    })
  }

  const security = home.news.filter((i) => i.kind === 'security' && Date.parse(i.at) > since)
  rows.push(
    security.length
      ? {
          icon: 'alert',
          tone: 'warn',
          text: `${security.length} security alert${security.length > 1 ? 's' : ''} in the news: “${security[0].title}”`,
        }
      : { icon: 'shield', tone: 'ok', text: 'No hacks or scams in the news overnight' },
  )

  for (const a of home.activity.filter((i) => i.kind === 'alert' && i.text.endsWith('alert fired') && Date.parse(i.at) > since).slice(0, 2)) {
    rows.push({ icon: 'alert', text: `${a.text}: ${a.meta.toLowerCase()}` })
  }

  if (home.streak >= 2) rows.push({ icon: 'sun', text: `Day ${home.streak} of our streak ☀️` })
  return rows
}

const ICONS = {
  eye: <EyeIcon size={16} />,
  shield: <ShieldIcon size={16} />,
  alert: <AlertIcon size={16} />,
  sun: <SunMark size={16} />,
}

export function MorningCard({ home, last, onDone }: { home: Home; last: Visit; onDone: () => void }) {
  const rows = rowsFor(home, last)
  return (
    <motion.section
      className="card morning"
      aria-label="While you slept"
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
    >
      <div className="morning-head">
        <span className="morning-arc" aria-hidden="true">
          <MoonIcon size={16} />
          <span className="morning-arc-line" />
          <SunMark size={18} />
        </span>
        <div>
          <h2>While you slept</h2>
          <small>
            {time(new Date(last.at))} → {time(new Date())}
          </small>
        </div>
      </div>
      <ul className="morning-rows">
        {rows.map((r) => (
          <li key={r.text} data-tone={r.tone}>
            <span className="morning-icon">{ICONS[r.icon]}</span>
            <span>{r.text}</span>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn--primary morning-done" onClick={onDone}>
        <CheckIcon size={16} strokeWidth={2.6} /> Good morning, Sunny!
      </button>
    </motion.section>
  )
}
