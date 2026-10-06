import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Sunny, type Mood } from './components/Sunny'
import { CloudBank, Sky } from './components/Sky'
import {
  BoltIcon,
  ClockIcon,
  EyeIcon,
  PlusIcon,
  ShieldIcon,
  SnowIcon,
  StopIcon,
  SunMark,
  SwapIcon,
} from './components/Icons'
import { ACTIVITY, POCKET_LIMIT, POCKET_PER_TX, SCENES, WATCHLIST, type Activity, type Token } from './data/mock'

const MOODS: { mood: Mood; label: string; glyph: string }[] = [
  { mood: 'happy', label: 'Happy', glyph: '☀' },
  { mood: 'excited', label: 'Excited', glyph: '✦' },
  { mood: 'worried', label: 'Worried', glyph: '☂' },
  { mood: 'hungry', label: 'Hungry', glyph: '◌' },
  { mood: 'sleepy', label: 'Sleepy', glyph: '☾' },
]

const POKE_LINES = ['Hehe, that tickles!', 'Hi hi! ☀', 'I’m watching your wallet, promise.', 'Boop.']

export default function App() {
  const [mood, setMood] = useState<Mood>('happy')
  const [poke, setPoke] = useState<string | null>(null)
  const scene = SCENES[mood]

  useEffect(() => {
    document.documentElement.dataset.weather = scene.weather
  }, [scene.weather])

  useEffect(() => {
    if (!poke) return
    const t = setTimeout(() => setPoke(null), 1800)
    return () => clearTimeout(t)
  }, [poke])

  const line = poke ?? scene.line

  return (
    <div className="app">
      <section className="stage">
        <Sky weather={scene.weather} />

        <header className="topbar">
          <div className="brand">
            <SunMark />
            <span>Sunny</span>
          </div>
          <button className="wallet-pill" type="button">
            <span className="wallet-dot" />
            7xKp…3fQa
          </button>
        </header>

        <div className="mood-tray" role="radiogroup" aria-label="Preview Sunny’s moods">
          {MOODS.map((m) => (
            <button
              key={m.mood}
              type="button"
              role="radio"
              aria-checked={mood === m.mood}
              className="mood-chip"
              data-active={mood === m.mood}
              onClick={() => setMood(m.mood)}
            >
              <span className="mood-glyph">{m.glyph}</span>
              {m.label}
            </button>
          ))}
        </div>

        <div className="bubble-slot">
          <AnimatePresence mode="wait">
            <motion.p
              key={line}
              className="bubble"
              initial={{ opacity: 0, y: 10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 380, damping: 26 }}
            >
              {line}
            </motion.p>
          </AnimatePresence>
        </div>

        <div className="sunny-slot">
          <Sunny
            mood={mood}
            size={212}
            onPoke={() => setPoke(POKE_LINES[Math.floor(Math.random() * POKE_LINES.length)])}
          />
        </div>

        <CloudBank />
      </section>

      <main className="content">
        <ForecastCard mood={mood} />
        <Watchlist tokens={WATCHLIST} />
        <PocketCard left={scene.pocketLeft} />
        <ActivityCard items={ACTIVITY} />
        <p className="footnote">
          Sunny watches and explains. It never invests for you without asking, and it can’t spend past the limits
          you set on Solana.
        </p>
      </main>

      <nav className="dock" aria-label="Quick actions">
        <button type="button" className="dock-btn">
          <ShieldIcon />
          <span>Safety check</span>
        </button>
        <button type="button" className="dock-main">
          <SunMark size={26} />
          <span>Ask Sunny</span>
        </button>
        <button type="button" className="dock-btn">
          <EyeIcon />
          <span>Watch</span>
        </button>
      </nav>
    </div>
  )
}

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

function formatPrice(p: number) {
  if (p >= 1) return usd(p)
  if (p >= 0.01) return `$${p.toFixed(4)}`
  const zeros = Math.floor(-Math.log10(p))
  const digits = Math.round(p * 10 ** (zeros + 3))
  return `$0.0${subscript(zeros)}${digits}`
}

function subscript(n: number) {
  return String(n).replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)])
}

function Delta({ value }: { value: number }) {
  const dir = value > 0.05 ? 'up' : value < -0.05 ? 'down' : 'flat'
  const glyph = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '•'
  return (
    <span className={`delta delta--${dir}`}>
      {glyph} {Math.abs(value).toFixed(1)}%
    </span>
  )
}

function ForecastCard({ mood }: { mood: Mood }) {
  const scene = SCENES[mood]
  const [whole, cents] = usd(scene.value).split('.')
  return (
    <section className="card forecast">
      <div className="card-head">
        <span className="eyebrow">Wallet weather</span>
        <span className="forecast-tag">{scene.forecast}</span>
      </div>
      <div className="forecast-value">
        <span className="big-num">
          {whole}
          <span className="cents">.{cents}</span>
        </span>
        <Delta value={scene.change} />
      </div>
      <Sparkline points={scene.spark} />
      <div className="spark-axis">
        <span>24h ago</span>
        <span>now</span>
      </div>
    </section>
  )
}

function Sparkline({ points }: { points: number[] }) {
  const w = 320
  const h = 74
  // Keep a minimum vertical range so a quiet market draws a calm line, not a jagged one.
  const lo = Math.min(...points)
  const hi = Math.max(...points)
  const mid = (lo + hi) / 2
  const half = Math.max((hi - lo) / 2, mid * 0.12)
  const min = mid - half
  const max = mid + half
  const xy = points.map((p, i) => [
    (i / (points.length - 1)) * w,
    h - 8 - ((p - min) / (max - min)) * (h - 18),
  ])
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const [lx, ly] = xy[xy.length - 1]
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--spark)" stopOpacity="0.32" />
          <stop offset="1" stopColor="var(--spark)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill="url(#spark-fill)" />
      <path d={line} fill="none" stroke="var(--spark)" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="4.5" fill="var(--spark)" className="spark-dot" />
    </svg>
  )
}

function Watchlist({ tokens }: { tokens: Token[] }) {
  return (
    <section className="watch">
      <div className="section-head">
        <h2>Sunny is watching</h2>
        <button type="button" className="ghost-btn">
          <PlusIcon size={16} /> Add
        </button>
      </div>
      <div className="watch-row">
        {tokens.map((t) => (
          <article key={t.symbol} className="token" data-flag={t.flag ? 'true' : undefined}>
            <div className="token-top">
              <span className="token-avatar" style={{ ['--h' as string]: t.hue }}>
                {t.symbol[0]}
              </span>
              {t.flag && <span className="token-flag">⚑ {t.flag}</span>}
            </div>
            <div className="token-symbol">{t.symbol}</div>
            <div className="token-price">{formatPrice(t.price)}</div>
            <Delta value={t.change} />
          </article>
        ))}
      </div>
    </section>
  )
}

function PocketCard({ left }: { left: number }) {
  const pct = Math.max(0, Math.min(1, left / POCKET_LIMIT))
  const r = 38
  const c = 2 * Math.PI * r
  return (
    <section className="card pocket">
      <div className="card-head">
        <span className="eyebrow">Pocket money</span>
        <span className="chain-tag">
          <BoltIcon size={13} /> Enforced on Solana
        </span>
      </div>
      <div className="pocket-body">
        <div className="ring">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r={r} className="ring-track" />
            <motion.circle
              cx="50"
              cy="50"
              r={r}
              className="ring-fill"
              strokeDasharray={c}
              initial={false}
              animate={{ strokeDashoffset: c * (1 - pct) }}
              transition={{ type: 'spring', stiffness: 90, damping: 18 }}
            />
          </svg>
          <div className="ring-label">
            <span className="ring-num">{usd(left)}</span>
            <span className="ring-sub">left today</span>
          </div>
        </div>
        <ul className="rules">
          <li>
            <span className="rule-icon">
              <StopIcon size={15} />
            </span>
            <span>
              <b>{usd(POCKET_LIMIT)}</b> a day, max <b>{usd(POCKET_PER_TX)}</b> per payment
            </span>
          </li>
          <li>
            <span className="rule-icon">
              <ShieldIcon size={15} />
            </span>
            <span>Only Jupiter swaps and x402 APIs</span>
          </li>
          <li>
            <span className="rule-icon">
              <ClockIcon size={15} />
            </span>
            <span>Refills in 6 h 12 min</span>
          </li>
        </ul>
      </div>
      <div className="pocket-actions">
        <button type="button" className="btn btn--honey">
          <PlusIcon size={17} /> Top up
        </button>
        <button type="button" className="btn btn--ice">
          <SnowIcon size={17} /> Freeze
        </button>
      </div>
    </section>
  )
}

const ACTIVITY_ICON: Record<Activity['kind'], typeof ShieldIcon> = {
  x402: ShieldIcon,
  blocked: StopIcon,
  swap: SwapIcon,
  watch: EyeIcon,
}

function ActivityCard({ items }: { items: Activity[] }) {
  return (
    <section className="card activity">
      <div className="card-head">
        <span className="eyebrow">What Sunny did</span>
      </div>
      <ul>
        {items.map((a) => {
          const IconCmp = ACTIVITY_ICON[a.kind]
          return (
            <li key={a.text} className={`activity-item activity-item--${a.kind}`}>
              <span className="activity-icon">
                <IconCmp size={17} />
              </span>
              <span className="activity-text">
                {a.text}
                <small>{a.meta}</small>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
