import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Sunny, type Gesture, type Mood, type Reaction } from './components/Sunny'
import { CloudBank, Sky } from './components/Sky'
import { Particles, burst, type Particle, type ParticleKind } from './components/Particles'
import { ChatSheet, type ChatMessage } from './components/ChatSheet'
import { askSunny, inTelegram } from './lib/chat'
import { haptic, type Haptic } from './lib/haptics'
import {
  AlertIcon,
  CheckIcon,
  ClockIcon,
  ExternalIcon,
  EyeIcon,
  MoonIcon,
  PlusIcon,
  ShieldIcon,
  SnowIcon,
  StopIcon,
  SolanaMark,
  SunMark,
  SwapIcon,
} from './components/Icons'
import {
  ACTIVITY,
  POCKET_LIMIT,
  POCKET_PER_TX,
  POCKET_PROGRAM,
  SCENES,
  WATCHLIST,
  type Activity,
  type Status,
  type Token,
} from './data/mock'

const MOODS: { mood: Mood; label: string }[] = [
  { mood: 'happy', label: 'Happy' },
  { mood: 'excited', label: 'Excited' },
  { mood: 'worried', label: 'Worried' },
  { mood: 'hungry', label: 'Hungry' },
  { mood: 'sleepy', label: 'Sleepy' },
]

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]

type Play = {
  reaction: Reaction
  line?: string
  particles?: [ParticleKind, number]
  haptic?: Haptic
  ms?: number
  bond?: number
}

const GESTURES: Record<Gesture, () => Play> = {
  boop: () => ({
    reaction: 'boop',
    line: pick(['Boop! Right on the nose.', 'Hehe! Still here, still watching.', 'Boop. All systems sunny.']),
    particles: ['sparkle', 3],
    haptic: 'light',
    ms: 900,
    bond: 1,
  }),
  head: () => ({
    reaction: 'pat',
    line: pick(['Head pats are my favorite.', 'Mmm, thank you. I’ll keep guarding.']),
    particles: ['heart', 2],
    haptic: 'soft',
    ms: 1300,
    bond: 2,
  }),
  cheek: () => ({
    reaction: 'blush',
    line: pick(['Hey, that’s my cheek! ☺', 'Oh! You’re making me blush.']),
    particles: ['heart', 2],
    haptic: 'soft',
    ms: 1300,
    bond: 2,
  }),
  ray: () => ({
    reaction: 'giggle',
    line: pick(['Careful, my rays are warm!', 'Hehe, my rays tickle.']),
    particles: ['sparkle', 4],
    haptic: 'light',
    ms: 1100,
    bond: 1,
  }),
  double: () => ({
    reaction: 'spin',
    line: 'Wheee! ✨',
    particles: ['sparkle', 7],
    haptic: 'medium',
    ms: 1000,
    bond: 2,
  }),
  pet: () => ({
    reaction: 'love',
    line: 'Aww… I like that. I’ll keep your wallet extra safe today.',
    particles: ['heart', 3],
    haptic: 'soft',
    ms: 1500,
    bond: 1,
  }),
  dizzy: () => ({
    reaction: 'dizzy',
    line: 'Whoa… everything’s spinning like a memecoin chart.',
    haptic: 'warning',
    ms: 2200,
  }),
}

const ASK_SUGGESTIONS = [
  'Is this airdrop a scam?',
  'What’s a rug pull?',
  'How does your pocket money work?',
  'Explain staking simply',
]

const WATCH_SUGGESTIONS = [
  'Watch BONK for a 10% drop',
  'What should I watch on a new token?',
  'Which red flags make a token risky?',
]

let chatIds = 1

const BOND_LEVELS = ['New friends', 'Buddies', 'Close pals', 'Best friends', 'Sunshine soulmates']
const bondLevel = (bond: number) => Math.min(BOND_LEVELS.length - 1, Math.floor(bond / 20))

const WELLBEING: Record<Mood, number> = { happy: 86, excited: 96, worried: 32, hungry: 58, sleepy: 74 }

const DOZE_AFTER_MS = 45_000
const DOZE_LINE = 'Zzz… (tap me if you need anything)'

function loadBond() {
  try {
    const v = Number(localStorage.getItem('sunny.bond'))
    return Number.isFinite(v) && v > 0 ? Math.min(100, v) : 34
  } catch {
    return 34
  }
}

function saveBond(v: number) {
  try {
    localStorage.setItem('sunny.bond', String(v))
  } catch {
    // Storage unavailable (private mode); the bond just won't persist.
  }
}

function greeting() {
  const h = new Date().getHours()
  if (h < 5) return 'Up late? I’m awake too. Your wallet is safe.'
  if (h < 12) return 'Good morning! I kept watch overnight. Nothing to worry about.'
  if (h < 19) return 'Good afternoon! Missed you. Everything is in order.'
  return 'Good evening! Your wallet had a calm day.'
}

// The mood picker is a demo tool: shown with ?demo, and keys 1–5 switch moods for recordings.
const DEMO = new URLSearchParams(window.location.search).has('demo')

export default function App() {
  const [mood, setMood] = useState<Mood>('happy')
  const [reaction, setReaction] = useState<Reaction | null>(null)
  // Opens with a hello that fades back to Sunny's status line.
  const [said, setSaid] = useState<string | null>(greeting)
  const [particles, setParticles] = useState<Particle[]>([])
  const [frozen, setFrozen] = useState(false)
  const [toppedUp, setToppedUp] = useState(false)
  const [statusOverride, setStatusOverride] = useState<Status | null>(null)
  const [bond, setBond] = useState(loadBond)
  const [dozing, setDozing] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [chatPending, setChatPending] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const timers = useRef<number[]>([])
  const lastTouch = useRef(0)
  const scene = SCENES[mood]

  useEffect(() => {
    const t = window.setTimeout(() => setSaid(null), 4200)
    return () => clearTimeout(t)
  }, [])

  // Like a real pet, Sunny dozes off when left alone, and wakes up when you come back.
  useEffect(() => {
    const touch = () => {
      lastTouch.current = performance.now()
    }
    touch()
    window.addEventListener('pointerdown', touch)
    window.addEventListener('keydown', touch)
    const check = window.setInterval(() => {
      if (performance.now() - lastTouch.current > DOZE_AFTER_MS) setDozing(true)
    }, 3000)
    return () => {
      window.removeEventListener('pointerdown', touch)
      window.removeEventListener('keydown', touch)
      clearInterval(check)
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.weather = scene.weather
  }, [scene.weather])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const i = Number(e.key) - 1
      if (i < 0 || i >= MOODS.length) return
      setMood(MOODS[i].mood)
      setToppedUp(false)
      setSaid(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }

  const changeMood = (next: Mood) => {
    setMood(next)
    setToppedUp(false)
    setSaid(null)
  }

  const play = useCallback((p: Play) => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    setReaction(p.reaction)
    if (p.line) setSaid(p.line)
    if (p.particles) setParticles((prev) => [...prev, ...burst(p.particles![0], p.particles![1])])
    if (p.haptic) haptic(p.haptic)
    timers.current.push(window.setTimeout(() => setReaction(null), p.ms ?? 1400))
    timers.current.push(window.setTimeout(() => setSaid(null), (p.ms ?? 1400) + 2400))
    if (p.bond) {
      setBond((prev) => {
        const next = Math.min(100, prev + p.bond!)
        saveBond(next)
        if (bondLevel(next) > bondLevel(prev)) {
          setSaid(`We’re ${BOND_LEVELS[bondLevel(next)].toLowerCase()} now! ♥`)
          setParticles((ps) => [...ps, ...burst('heart', 9)])
          haptic('success')
        }
        return next
      })
    }
  }, [])

  const onGesture = (g: Gesture) => {
    if (dozing) {
      setDozing(false)
      play({
        reaction: 'giggle',
        line: 'Oh! I’m up, I’m up. Everything’s still safe.',
        particles: ['sparkle', 4],
        haptic: 'light',
        ms: 1200,
      })
      return
    }
    play(GESTURES[g]())
  }

  const onTopUp = () => {
    setToppedUp(true)
    play({
      reaction: 'yum',
      line: `Yum! Pocket refilled to $${POCKET_LIMIT}. Thank you!`,
      particles: ['coin', 6],
      haptic: 'success',
      ms: 1600,
      bond: 3,
    })
    if (mood === 'hungry') later(() => setMood('happy'), 1700)
  }

  const onFreeze = () => {
    if (frozen) {
      setFrozen(false)
      play({ reaction: 'giggle', line: 'Warm again! Pocket unlocked.', particles: ['sparkle', 5], haptic: 'success' })
      return
    }
    setFrozen(true)
    play({
      reaction: 'shiver',
      line: 'Brrr! Pocket frozen. I can’t spend a cent until you unfreeze it.',
      particles: ['snow', 7],
      haptic: 'warning',
      ms: 1800,
    })
  }

  const onSafetyCheck = () => {
    setStatusOverride({ tone: 'info', text: 'Checking $FROG · holders, mint, liquidity…' })
    play({ reaction: 'scan', line: 'On it. Checking $FROG’s holders, mint and liquidity…', haptic: 'light', ms: 2000 })
    later(() => {
      setStatusOverride(null)
      changeMood('worried')
      haptic('warning')
    }, 2000)
  }

  const sunnySays = (text: string, error = false): ChatMessage => ({ id: chatIds++, from: 'sunny', text, error })

  const openChat = (topic: 'ask' | 'watch') => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setChatOpen(true)
    haptic('light')
    if (topic === 'watch') {
      setChat((prev) => [
        ...prev,
        sunnySays(
          'Which token should I keep an eye on, and what move matters to you? Live alerts arrive this week; until then I’ll tell you what to watch for.',
        ),
      ])
      setSuggestions(WATCH_SUGGESTIONS)
    } else if (chat.length === 0) {
      setChat([
        sunnySays(
          inTelegram()
            ? 'Hi! Ask me anything. This is the same chat as Telegram, so we can pick up right where we left off ☀️'
            : 'Hi! Ask me anything about Solana, your wallet or staying safe ☀️',
        ),
      ])
      setSuggestions(ASK_SUGGESTIONS)
    }
  }

  const closeChat = useCallback(() => setChatOpen(false), [])

  const sendChat = async (text: string) => {
    setChat((prev) => [...prev, { id: chatIds++, from: 'you', text }])
    setSuggestions([])
    setChatPending(true)
    setDozing(false)
    try {
      const { reply, cards, live } = await askSunny(text)
      setChat((prev) => [...prev, { ...sunnySays(reply), cards, live }])
      const risky = cards.find((c) => c.risk !== 'low')
      if (risky) {
        play({ reaction: 'alarm', haptic: 'warning', ms: 1600, bond: 1 })
        setStatusOverride({
          tone: 'warn',
          text: `${risky.risk === 'high' ? 'High' : 'Medium'} risk · $${risky.symbol}`,
        })
        later(() => setStatusOverride(null), 8000)
      } else {
        play({ reaction: 'giggle', particles: ['sparkle', 3], haptic: 'light', ms: 900, bond: 1 })
      }
    } catch (err) {
      setChat((prev) => [...prev, sunnySays(err instanceof Error ? err.message : String(err), true)])
      haptic('warning')
    } finally {
      setChatPending(false)
    }
  }

  const line = said ?? (dozing ? DOZE_LINE : scene.line)
  const status: Status =
    statusOverride ?? (frozen ? { tone: 'info', text: 'Pocket frozen · Sunny can’t spend' } : scene.status)
  const pocketLeft = toppedUp ? POCKET_LIMIT : scene.pocketLeft

  return (
    <div className="app" data-chat={chatOpen ? 'open' : undefined}>
      <section className="stage">
        <Sky weather={scene.weather} />

        <header className="topbar">
          <div className="brand">
            <SunMark />
            <span>Sunny</span>
          </div>
          <button className="wallet-pill" type="button" aria-label="Connected wallet 7xKp…3fQa on Solana">
            <SolanaMark size={15} />
            7xKp…3fQa
          </button>
        </header>

        {DEMO && (
          <div className="mood-tray" role="radiogroup" aria-label="Preview Sunny’s moods">
            {MOODS.map((m, i) => (
              <button
                key={m.mood}
                type="button"
                role="radio"
                aria-checked={mood === m.mood}
                className="mood-chip"
                data-active={mood === m.mood}
                onClick={() => changeMood(m.mood)}
              >
                <kbd>{i + 1}</kbd>
                {m.label}
              </button>
            ))}
          </div>
        )}

        <div className="bubble-slot" aria-live="polite">
          {/* Keyed by text: the new line pops in immediately, so Sunny never lags behind a touch. */}
          <motion.div
            key={line}
            className="bubble"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 520, damping: 30 }}
          >
            <span className="bubble-from">Sunny · now</span>
            <p>{line}</p>
          </motion.div>
        </div>

        <div className="sunny-slot">
          <Sunny
            mood={mood}
            reaction={reaction ?? (chatPending ? 'scan' : null)}
            frozen={frozen}
            dozing={dozing}
            size={200}
            onGesture={onGesture}
          />
          <Particles items={particles} onDone={(id) => setParticles((prev) => prev.filter((p) => p.id !== id))} />
        </div>

        <GuardianStatus status={status} />
        <CloudBank />
      </section>

      <main className="content">
        <CareCard energy={(pocketLeft / POCKET_LIMIT) * 100} frozen={frozen} wellbeing={WELLBEING[mood]} bond={bond} />
        <ForecastCard mood={mood} />
        <Watchlist tokens={WATCHLIST} />
        <PocketCard left={pocketLeft} frozen={frozen} onTopUp={onTopUp} onFreeze={onFreeze} />
        <ActivityCard items={ACTIVITY} />
        <div className="built-on">
          <SolanaMark size={14} /> Built on Solana
        </div>
        <p className="footnote">
          Sunny watches and explains. It never invests for you without asking, and it can’t spend past the limits you
          set on Solana.
        </p>
      </main>

      <ChatSheet
        open={chatOpen}
        messages={chat}
        pending={chatPending}
        suggestions={suggestions}
        sameAsTelegram={inTelegram()}
        onSend={sendChat}
        onClose={closeChat}
      />

      <nav className="dock" aria-label="Quick actions">
        <button type="button" className="dock-btn" onClick={onSafetyCheck}>
          <ShieldIcon />
          <span>Safety check</span>
        </button>
        <button type="button" className="dock-main" onClick={() => openChat('ask')}>
          <SunMark size={24} />
          <span>Ask Sunny</span>
        </button>
        <button type="button" className="dock-btn" onClick={() => openChat('watch')}>
          <EyeIcon />
          <span>Watch</span>
        </button>
      </nav>
    </div>
  )
}

function GuardianStatus({ status }: { status: Status }) {
  const IconCmp = status.tone === 'warn' ? AlertIcon : status.tone === 'info' ? MoonIcon : CheckIcon
  return (
    <div className="guardian-slot">
      <motion.div
        key={status.text}
        className={`guardian guardian--${status.tone}`}
        role="status"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 480, damping: 30 }}
      >
        <span className="guardian-icon">
          <IconCmp size={14} strokeWidth={2.4} />
        </span>
        {status.text}
      </motion.div>
    </div>
  )
}

type CareProps = { energy: number; frozen: boolean; wellbeing: number; bond: number }

function CareCard({ energy, frozen, wellbeing, bond }: CareProps) {
  const level = bondLevel(bond)
  const inLevel = level === BOND_LEVELS.length - 1 ? 100 : ((bond % 20) / 20) * 100
  return (
    <section className="card care" aria-label="Sunny’s care">
      <div className="card-head">
        <span className="eyebrow">Sunny’s care</span>
        <span className="bond-title">
          ♥ {BOND_LEVELS[level]} · Lv {level + 1}
        </span>
      </div>
      <div className="care-grid">
        <Meter
          label="Energy"
          hint={frozen ? 'Frozen ❄' : 'Pocket money'}
          value={energy}
          tone={frozen ? 'frozen' : 'energy'}
        />
        <Meter label="Mood" hint="Wallet health" value={wellbeing} tone="mood" />
        <Meter label="Bond" hint="Play with me" value={inLevel} tone="bond" />
      </div>
    </section>
  )
}

function Meter({ label, hint, value, tone }: { label: string; hint: string; value: number; tone: string }) {
  const v = Math.round(Math.max(0, Math.min(100, value)))
  return (
    <div className={`meter meter--${tone}`}>
      <div className="meter-top">
        <span className="meter-label">{label}</span>
        <span className="meter-num">{v}%</span>
      </div>
      <div
        className="meter-bar"
        role="meter"
        aria-label={label}
        aria-valuenow={v}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <motion.span
          className="meter-fill"
          initial={false}
          animate={{ width: `${Math.max(4, v)}%` }}
          transition={{ type: 'spring', stiffness: 110, damping: 20 }}
        />
      </div>
      <span className="meter-hint">{hint}</span>
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
      </div>
      <Sparkline points={scene.spark} />
      <dl className="metrics">
        <div>
          <dt>24h</dt>
          <dd>
            <Delta value={scene.change} />
          </dd>
        </div>
        <div>
          <dt>Risk</dt>
          <dd className={`risk risk--${scene.risk.toLowerCase()}`}>{scene.risk}</dd>
        </div>
        <div>
          <dt>Watching</dt>
          <dd>{WATCHLIST.length} tokens</dd>
        </div>
      </dl>
      <p className="source">Updated 2 min ago · Prices from Jupiter</p>
    </section>
  )
}

function Sparkline({ points }: { points: number[] }) {
  const w = 320
  const h = 70
  // Keep a minimum vertical range so a quiet market draws a calm line, not a jagged one.
  const lo = Math.min(...points)
  const hi = Math.max(...points)
  const mid = (lo + hi) / 2
  const half = Math.max((hi - lo) / 2, mid * 0.12)
  const min = mid - half
  const max = mid + half
  const xy = points.map((p, i) => [(i / (points.length - 1)) * w, h - 8 - ((p - min) / (max - min)) * (h - 18)])
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const [lx, ly] = xy[xy.length - 1]
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--spark)' }} stopOpacity="0.28" />
          <stop offset="1" style={{ stopColor: 'var(--spark)' }} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1="0" x2={w} y1={h * f} y2={h * f} className="spark-grid" vectorEffect="non-scaling-stroke" />
      ))}
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill="url(#spark-fill)" />
      <path
        d={line}
        fill="none"
        stroke="var(--spark)"
        strokeWidth="2.4"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
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
          <article key={t.symbol} className="token" data-safety={t.safety}>
            <div className="token-top">
              <span className="token-avatar" style={{ ['--h' as string]: t.hue }}>
                {t.symbol[0]}
              </span>
              <span className={`token-safety token-safety--${t.safety}`}>
                {t.safety === 'safe' ? (
                  <CheckIcon size={12} strokeWidth={2.6} />
                ) : (
                  <AlertIcon size={12} strokeWidth={2.4} />
                )}
                {t.safety === 'safe' ? 'Checked' : 'Risky'}
              </span>
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

type PocketProps = { left: number; frozen: boolean; onTopUp: () => void; onFreeze: () => void }

function PocketCard({ left, frozen, onTopUp, onFreeze }: PocketProps) {
  const pct = Math.max(0, Math.min(1, left / POCKET_LIMIT))
  const r = 38
  const c = 2 * Math.PI * r
  return (
    <section className="card pocket" data-frozen={frozen}>
      <div className="card-head">
        <span className="eyebrow">Pocket money</span>
        <span className="chain-tag">
          {frozen ? (
            <>
              <SnowIcon size={13} strokeWidth={2.2} /> Frozen on Solana
            </>
          ) : (
            <>
              <SolanaMark size={13} /> <span className="sol-text">Enforced on Solana</span>
            </>
          )}
        </span>
      </div>
      <div className="pocket-body">
        <div className="ring">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <defs>
              <linearGradient id="sol-ring" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0" stopColor="#9945FF" />
                <stop offset="0.55" stopColor="#43B4CA" />
                <stop offset="1" stopColor="#14F195" />
              </linearGradient>
            </defs>
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
            <span className="ring-sub">left of ${POCKET_LIMIT}</span>
          </div>
        </div>
        <ul className="rules">
          <li>
            <span className="rule-icon">
              <StopIcon size={15} />
            </span>
            <span>
              Max <b>{usd(POCKET_PER_TX)}</b> per payment
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
        <button type="button" className="btn btn--primary" onClick={onTopUp} disabled={frozen}>
          <PlusIcon size={17} /> Top up
        </button>
        <button type="button" className="btn btn--ice" onClick={onFreeze} aria-pressed={frozen}>
          <SnowIcon size={17} /> {frozen ? 'Unfreeze' : 'Freeze'}
        </button>
      </div>
      <a className="verify" href="#" onClick={(e) => e.preventDefault()}>
        Rules live in program <code>{POCKET_PROGRAM}</code>
        <ExternalIcon size={14} />
      </a>
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
                <small>
                  {a.meta}
                  {a.sig && (
                    <>
                      {' · '}
                      <a href="#" onClick={(e) => e.preventDefault()} className="sig">
                        <SolanaMark size={11} />
                        {a.sig}
                        <ExternalIcon size={12} />
                      </a>
                    </>
                  )}
                </small>
              </span>
              <span className="activity-time">{a.time}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
