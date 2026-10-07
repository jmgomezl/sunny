import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Sunny, type Gesture, type Mood, type Reaction } from './components/Sunny'
import { CloudBank, Sky } from './components/Sky'
import { Particles, burst, type Particle, type ParticleKind } from './components/Particles'
import { ChatSheet, type ChatMessage } from './components/ChatSheet'
import { ScanSheet, type ScanMode } from './components/ScanSheet'
import { PocketSheet, type PocketEventKind } from './components/PocketSheet'
import { fetchPocket, PROGRAM_URL, type PocketState } from './lib/pocket'
import { inTelegram as insideTelegram } from './lib/api'
import { askSunny, inTelegram } from './lib/chat'
import {
  fetchHome,
  type ActivityItem,
  type Home,
  type Inspection,
  type NewsItem,
  type WatchChange,
  type WatchedWallet,
  type WatchToken,
} from './lib/home'
import type { Weather } from './components/Sky'
import { haptic, type Haptic } from './lib/haptics'
import {
  AlertIcon,
  CheckIcon,
  CoinIcon,
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

const WATCH_SUGGESTIONS = ['Watch BONK for a 10% drop', 'Watch SOL for a 15% rise', 'What alerts do I have?']

const MOOD_WEATHER: Record<Mood, Weather> = {
  happy: 'clear',
  excited: 'golden',
  worried: 'storm',
  sleepy: 'night',
  hungry: 'hazy',
}

// Late at night a calm Sunny is a sleepy Sunny.
const isNight = () => {
  const h = new Date().getHours()
  return h >= 23 || h < 6
}

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`

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

// A hello that never claims anything about the wallet; the real status line follows.
function greeting() {
  const h = new Date().getHours()
  if (h < 5) return 'Up late? I’m awake too. ☀️'
  if (h < 12) return 'Good morning! ☀️ I’m here.'
  if (h < 19) return 'Good afternoon! Missed you. ☀️'
  return 'Good evening! Nice to see you. ☀️'
}

// The mood picker is a demo tool: shown with ?demo, and keys 1–5 switch moods for recordings.
const DEMO = new URLSearchParams(window.location.search).has('demo')
// Matches the server's limit on watched wallets.
const MAX_WATCHED = 5

// If someone says "later" to making a wallet, Sunny asks again the next day, not every visit.
const HELLO_LATER = 'sunny.hello.later'
const helloSnoozed = () => {
  try {
    return Date.now() - Number(localStorage.getItem(HELLO_LATER) ?? 0) < 86_400_000
  } catch {
    return false
  }
}
const snoozeHello = () => {
  try {
    localStorage.setItem(HELLO_LATER, String(Date.now()))
  } catch {
    // Private mode: Sunny will just say hello again next time.
  }
}

export default function App() {
  // Real data drives Sunny's mood; in ?demo mode a picked mood overrides it with sample scenes.
  const [demoMood, setDemoMood] = useState<Mood | null>(null)
  const [home, setHome] = useState<Home | null>(null)
  const [scan, setScan] = useState<{ open: boolean; mode: ScanMode; input?: string }>({ open: false, mode: 'check' })
  const [reaction, setReaction] = useState<Reaction | null>(null)
  // Opens with a hello that fades back to Sunny's status line.
  const [said, setSaid] = useState<string | null>(greeting)
  const [particles, setParticles] = useState<Particle[]>([])
  // Only used for ?demo recordings; real freezing lives on-chain in the pocket program.
  const [demoFrozen, setFrozen] = useState(false)
  const [pocket, setPocket] = useState<{ wallet: string | null; state: PocketState | null } | null>(null)
  const [pocketSheet, setPocketSheet] = useState<{ open: boolean; intent?: PocketIntent | 'hello' }>({
    open: false,
  })
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
  const ps = pocket?.state
  // Sunny gets hungry when its pocket can't cover a single payment.
  const hungry = Boolean(ps?.exists && !ps.frozen && ps.vault < ps.perTxLimit)
  const liveMood: Mood = home
    ? home.mood === 'worried'
      ? 'worried'
      : hungry
        ? 'hungry'
        : home.mood === 'happy' && isNight()
          ? 'sleepy'
          : home.mood
    : 'happy'
  const mood: Mood = demoMood ?? liveMood
  const demo = demoMood ? SCENES[demoMood] : null
  const weather = MOOD_WEATHER[mood]

  const refreshHome = useCallback(async () => {
    try {
      const h = await fetchHome()
      setHome(h)
      return h
    } catch (err) {
      console.warn('[sunny] home failed', err)
      return null
    }
  }, [])

  const loadPocket = useCallback(async () => {
    const p = insideTelegram() ? await fetchPocket().catch((err) => console.warn('[sunny] pocket failed', err)) : null
    const next = p ?? { wallet: null, state: null }
    if (p || !insideTelegram()) setPocket(next)
    return p ?? null
  }, [])

  useEffect(() => {
    let t = 0
    void loadPocket().then((p) => {
      // First visit: once Sunny has said hi, it offers to make your wallet together.
      if (p && !p.wallet && !DEMO && !helloSnoozed()) {
        t = window.setTimeout(() => setPocketSheet((s) => (s.open ? s : { open: true, intent: 'hello' })), 1600)
      }
    })
    return () => clearTimeout(t)
  }, [loadPocket])

  // Load the real home screen now and keep it fresh while the app is open.
  useEffect(() => {
    void refreshHome()
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshHome()
    }, 90_000)
    return () => clearInterval(t)
  }, [refreshHome])

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
    document.documentElement.dataset.weather = weather
  }, [weather])

  useEffect(() => {
    if (!DEMO) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return
      const i = Number(e.key) - 1
      if (i < 0 || i >= MOODS.length) return
      setDemoMood(MOODS[i].mood)
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
    setDemoMood(next)
    setToppedUp(false)
    setSaid(null)
  }

  const play = useCallback((p: Play) => {
    // Anything Sunny reacts to counts as being together, so it won't doze off mid-chat.
    lastTouch.current = performance.now()
    setDozing(false)
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
    if (demoMood === 'hungry') later(() => setDemoMood('happy'), 1700)
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

  const openScan = (mode: ScanMode, input?: string) => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setChatOpen(false)
    setScan({ open: true, mode, input })
    haptic('light')
  }

  const closePocket = useCallback(
    () =>
      setPocketSheet((s) => {
        if (s.intent === 'hello') snoozeHello()
        return { open: false }
      }),
    [],
  )

  const closeScan = useCallback(() => setScan((s) => ({ ...s, open: false, input: undefined })), [])

  // Sunny reacts to whatever you scanned or pasted.
  const onScanResult = (r: Inspection | null) => {
    const warn = (text: string) => {
      play({ reaction: 'alarm', haptic: 'warning', ms: 1800, bond: 1 })
      setStatusOverride({ tone: 'warn', text })
      later(() => setStatusOverride(null), 8000)
    }
    if (!r) return play({ reaction: 'blush', ms: 900 })
    if (r.kind === 'link' && (r.link.verdict === 'known_scam' || r.link.verdict === 'suspicious')) {
      return warn(`${r.link.verdict === 'known_scam' ? 'Scam site' : 'Suspicious link'} · ${r.link.domain}`)
    }
    if (r.kind === 'token' && r.found && r.card.risk !== 'low') {
      return warn(`${r.card.risk === 'high' ? 'High' : 'Medium'} risk · $${r.card.symbol}`)
    }
    if (r.kind === 'wallet' && r.report.risk !== 'low') return warn(`Wallet risk · ${short(r.report.address)}`)
    play({ reaction: 'giggle', particles: ['sparkle', 4], haptic: 'light', ms: 1000, bond: 1 })
  }

  /** Watches or unwatches a wallet; Sunny says why if it can't (e.g. already watching five). */
  const changeWatch = async (change: WatchChange) => {
    try {
      setHome(await fetchHome(change))
      return true
    } catch (err) {
      const why = err instanceof Error ? err.message : 'I couldn’t read that wallet. Try again?'
      play({ reaction: 'blush', line: why, ms: 1600 })
      return false
    }
  }

  const watchWallet = async (address: string) => {
    closeScan()
    setStatusOverride({ tone: 'info', text: 'Getting to know this wallet…' })
    play({ reaction: 'scan', ms: 15_000 })
    const ok = await changeWatch({ watch: address })
    setStatusOverride(null)
    if (!ok) return
    play({
      reaction: 'giggle',
      line: `Got it! I’m watching ${short(address)} now. ☀️`,
      particles: ['heart', 6],
      haptic: 'success',
      ms: 1400,
      bond: 3,
    })
  }

  const unwatch = async (address: string) => {
    closeScan()
    if (await changeWatch({ unwatch: address })) {
      play({ reaction: 'pat', line: `Okay, I stopped watching ${short(address)}.`, haptic: 'light', ms: 1000 })
    }
  }

  const sunnySays = (text: string, error = false): ChatMessage => ({ id: chatIds++, from: 'sunny', text, error })

  const openChat = (topic: 'ask' | 'watch', symbol?: string) => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    closeScan()
    setChatOpen(true)
    haptic('light')
    if (topic === 'watch') {
      setChat((prev) => [
        ...prev,
        sunnySays(
          symbol
            ? `How should I watch ${symbol}? Pick one or tell me your own, and I’ll message you in Telegram when it happens.`
            : 'Which token should I keep an eye on? Tell me the move that matters, and I’ll message you in Telegram when it happens.',
        ),
      ])
      setSuggestions(symbol ? [`Watch ${symbol} for a 10% drop`, `Watch ${symbol} for a 20% rise`] : WATCH_SUGGESTIONS)
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
      const {
        reply,
        cards,
        links,
        alerts,
        pocket: draws,
        mine,
        wallets,
        scans,
        watchChanged,
        live,
      } = await askSunny(text)
      setChat((prev) => [
        ...prev,
        { ...sunnySays(reply), cards, links, alerts, pocket: draws, mine, wallets, scans, live },
      ])
      if (draws.length || scans.length) void loadPocket()
      if (watchChanged) void refreshHome()
      const risky = cards.find((c) => c.risk !== 'low')
      const scam = links.find((l) => l.verdict === 'known_scam' || l.verdict === 'suspicious')
      const stopped = draws.find((d) => !d.ok)
      if (stopped) {
        // The rules working is good news: Solana said no, exactly as designed.
        play({ reaction: 'shiver', haptic: 'warning', ms: 1400, bond: 1 })
        setStatusOverride({ tone: 'ok', text: `Solana stopped a $${stopped.amount} draw` })
        later(() => setStatusOverride(null), 8000)
      } else if (draws.length) {
        play({ reaction: 'yum', particles: ['coin', 4], haptic: 'success', ms: 1300, bond: 1 })
      } else if (scam) {
        play({ reaction: 'alarm', haptic: 'warning', ms: 1800, bond: 1 })
        setStatusOverride({
          tone: 'warn',
          text: `${scam.verdict === 'known_scam' ? 'Scam site' : 'Suspicious link'} · ${scam.domain}`,
        })
        later(() => setStatusOverride(null), 8000)
      } else if (alerts.length) {
        void refreshHome()
        play({ reaction: 'giggle', particles: ['sparkle', 6], haptic: 'success', ms: 1100, bond: 2 })
        setStatusOverride({ tone: 'ok', text: `Watching ${alerts[0].symbol} · alert set` })
        later(() => setStatusOverride(null), 8000)
      } else if (risky) {
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

  const askFromScan = (question: string) => {
    openChat('ask')
    void sendChat(question)
  }

  const POCKET_REACTIONS: Record<PocketEventKind, Play> = {
    created: {
      reaction: 'giggle',
      line: 'Your Sunny wallet is ready! Only your password opens it.',
      particles: ['heart', 6],
      haptic: 'success',
      bond: 3,
    },
    opened: {
      reaction: 'yum',
      line: 'Pocket open! I’ll always stay inside your limits.',
      particles: ['coin', 6],
      haptic: 'success',
      ms: 1600,
      bond: 3,
    },
    topup: {
      reaction: 'yum',
      line: 'Yum! Pocket topped up. Thank you!',
      particles: ['coin', 6],
      haptic: 'success',
      ms: 1600,
      bond: 2,
    },
    freeze: {
      reaction: 'shiver',
      line: 'Brrr! Frozen on Solana. I can’t spend a cent until you unfreeze me.',
      particles: ['snow', 7],
      haptic: 'warning',
      ms: 1800,
    },
    unfreeze: {
      reaction: 'giggle',
      line: 'Warm again! Pocket unlocked.',
      particles: ['sparkle', 5],
      haptic: 'success',
    },
    withdraw: { reaction: 'pat', line: 'Done. The money is back in your wallet.', haptic: 'success' },
    faucet: { reaction: 'yum', line: 'Test USDC arrived in your wallet!', particles: ['coin', 5], haptic: 'success' },
    limits: { reaction: 'pat', line: 'New limits set on Solana.', haptic: 'success' },
  }

  const onPocketChanged = (state: PocketState | null, event: PocketEventKind) => {
    setPocket((prev) => ({ wallet: state?.owner ?? prev?.wallet ?? null, state: state ?? prev?.state ?? null }))
    if (event === 'created') void loadPocket()
    play(POCKET_REACTIONS[event])
  }

  const frozen = demo ? demoFrozen : Boolean(ps?.frozen)
  const line = said ?? (dozing ? DOZE_LINE : (demo?.line ?? home?.line ?? 'Waking up… checking the sky for you.'))
  const status: Status =
    statusOverride ??
    (frozen
      ? { tone: 'info', text: 'Pocket frozen · Sunny can’t spend' }
      : (demo?.status ?? home?.status ?? { tone: 'info', text: 'Checking the sky…' }))
  // Pocket money goes on-chain next; until then the card shows a preview allowance.
  const pocketLeft = toppedUp ? POCKET_LIMIT : (demo?.pocketLeft ?? 7.2)
  // The status line leads somewhere: watch a wallet, ask why it's stormy, or warm Sunny up.
  const needsWatch = !demo && !statusOverride && !frozen && Boolean(home) && home!.wallets.length === 0
  const statusTap = demo
    ? undefined
    : statusOverride
      ? undefined
      : needsWatch
        ? () => openScan('link')
        : frozen
          ? () => {
              window.scrollTo({ top: 0, behavior: 'smooth' })
              setPocketSheet({ open: true, intent: 'unfreeze' })
            }
          : status.tone === 'warn'
            ? () => askFromScan('Why is my wallet weather stormy, and what should I do?')
            : home
              ? () => document.querySelector('.forecast')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              : undefined

  const pocketView: PocketView = demo
    ? { kind: 'live', left: pocketLeft, daily: POCKET_LIMIT, perTx: POCKET_PER_TX, frozen, cluster: 'devnet' }
    : !pocket
      ? { kind: 'loading' }
      : !pocket.wallet
        ? { kind: 'no-wallet' }
        : !ps?.exists
          ? { kind: 'empty' }
          : {
              kind: 'live',
              left: ps.leftToday,
              daily: ps.dailyLimit,
              perTx: ps.perTxLimit,
              frozen: ps.frozen,
              cluster: ps.cluster,
            }

  const openWallet = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setPocketSheet({ open: true })
  }

  const managePocket = (intent?: PocketIntent) => {
    // In ?demo recordings, tapping the pocket feeds Sunny and the snowflake freezes it.
    if (demo) return intent === 'freeze' || intent === 'unfreeze' ? onFreeze() : onTopUp()
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setPocketSheet({ open: true, intent })
  }

  return (
    <div className="app" data-chat={chatOpen || scan.open || pocketSheet.open ? 'open' : undefined}>
      <section className="stage">
        <Sky weather={weather} />

        <header className="topbar">
          <div className="brand">
            <SunMark />
            <span>Sunny</span>
          </div>
          <button
            className="wallet-pill"
            type="button"
            data-linked={pocket?.wallet ? 'true' : undefined}
            onClick={openWallet}
            aria-label={pocket?.wallet ? `Your Sunny wallet ${pocket.wallet}` : 'Make your Sunny wallet'}
          >
            <SolanaMark size={15} />
            {pocket?.wallet ? short(pocket.wallet) : pocket && insideTelegram() ? 'Make wallet' : 'My wallet'}
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

        <GuardianStatus status={status} onTap={statusTap} watchPrompt={needsWatch} />
        <CloudBank />
      </section>

      <main className="content">
        <CareCard
          wellbeing={WELLBEING[mood]}
          bond={bond}
          streak={demo ? 5 : (home?.streak ?? 0)}
          pocket={pocketView}
          onPocket={managePocket}
        />
        <ForecastCard
          home={home}
          demo={demoMood}
          onWatch={() => openScan('link')}
          onOpen={(address) => openScan('check', address)}
        />
        <Watchlist
          tokens={demo ? WATCHLIST.map(demoToken) : (home?.tokens ?? [])}
          linked={Boolean(home?.wallets.length)}
          loading={!home && !demo}
          onSelect={(mint) => openScan('check', mint)}
          onAdd={() => openChat('watch')}
        />
        {!demo && home && home.news.length > 0 && <NewsCard items={home.news} />}
        <ActivityCard items={demo ? ACTIVITY.map(demoActivity) : (home?.activity ?? [])} />
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

      <PocketSheet
        open={pocketSheet.open}
        state={ps ?? null}
        intent={pocketSheet.intent}
        onClose={closePocket}
        onChanged={onPocketChanged}
        onBusy={(busy) => busy && play({ reaction: 'scan', ms: 20_000 })}
      />

      <ScanSheet
        open={scan.open}
        mode={scan.mode}
        initialInput={scan.input}
        onClose={closeScan}
        onChecking={() => play({ reaction: 'scan', ms: 15_000 })}
        onResult={onScanResult}
        watching={home?.wallets.map((w) => w.address) ?? []}
        onLinkWallet={(a) => void watchWallet(a)}
        onUnwatch={(a) => void unwatch(a)}
        onAsk={askFromScan}
        onWatch={(symbol) => openChat('watch', symbol)}
      />

      <nav className="dock" aria-label="Quick actions">
        <button type="button" className="dock-btn" onClick={() => openScan('check')}>
          <ShieldIcon />
          <span>Scan & check</span>
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

type GuardianProps = { status: Status; onTap?: () => void; watchPrompt?: boolean }

/** Sunny's one-line status. When there's an obvious next step, tapping it takes you there. */
function GuardianStatus({ status, onTap, watchPrompt }: GuardianProps) {
  const IconCmp = watchPrompt
    ? EyeIcon
    : status.tone === 'warn'
      ? AlertIcon
      : status.tone === 'info'
        ? MoonIcon
        : CheckIcon
  const content = (
    <>
      <span className="guardian-icon">
        <IconCmp size={14} strokeWidth={2.4} />
      </span>
      {status.text}
      {onTap && (
        <span className="guardian-go" aria-hidden="true">
          ›
        </span>
      )}
    </>
  )
  const motionProps = {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    transition: { type: 'spring' as const, stiffness: 480, damping: 30 },
  }
  return (
    <div className="guardian-slot">
      {onTap ? (
        <motion.button
          key={status.text}
          type="button"
          className={`guardian guardian--${status.tone} guardian--tap`}
          onClick={onTap}
          {...motionProps}
        >
          {content}
        </motion.button>
      ) : (
        <motion.div key={status.text} className={`guardian guardian--${status.tone}`} role="status" {...motionProps}>
          {content}
        </motion.div>
      )}
    </div>
  )
}

/** What the care card shows about Sunny's pocket, from Solana or from a demo scene. */
type PocketView =
  | { kind: 'loading' }
  | { kind: 'no-wallet' }
  | { kind: 'empty' }
  | { kind: 'live'; left: number; daily: number; perTx: number; frozen: boolean; cluster: string }

type PocketIntent = 'topup' | 'freeze' | 'unfreeze'

type CareProps = {
  wellbeing: number
  bond: number
  streak: number
  pocket: PocketView
  onPocket: (intent?: PocketIntent) => void
}

/** Sunny's needs, like a pet's: its energy is the pocket money you give it, enforced on Solana. */
function CareCard({ wellbeing, bond, streak, pocket, onPocket }: CareProps) {
  const level = bondLevel(bond)
  const inLevel = level === BOND_LEVELS.length - 1 ? 100 : ((bond % 20) / 20) * 100
  const live = pocket.kind === 'live' ? pocket : null
  const frozen = Boolean(live?.frozen)
  const whole = (n: number) => usd(n).replace('.00', '')
  return (
    <section className="card care" aria-label="Sunny’s care" data-frozen={frozen || undefined}>
      <div className="card-head">
        <span className="eyebrow">Sunny’s care</span>
        <span className="bond-title">
          ♥ {BOND_LEVELS[level]} · Lv {level + 1}
        </span>
      </div>
      <div className="care-grid">
        <Meter
          label="Energy"
          hint={frozen ? 'Frozen ❄' : live ? `${whole(live.left)} of ${whole(live.daily)}` : 'Needs a pocket'}
          value={live ? (live.left / live.daily) * 100 : 0}
          tone={frozen ? 'frozen' : 'energy'}
        />
        <Meter label="Mood" hint="Wallet health" value={wellbeing} tone="mood" />
        <Meter
          label="Bond"
          hint={streak >= 2 ? `${streak}-day streak ☀️` : 'Play with me'}
          value={inLevel}
          tone="bond"
        />
      </div>

      <div className="care-pocket">
        <button type="button" className="care-pocket-main" onClick={() => onPocket()}>
          <span className="care-pocket-icon" aria-hidden="true">
            {frozen ? <SnowIcon size={19} strokeWidth={2.1} /> : <CoinIcon size={20} />}
          </span>
          <span className="care-pocket-text">
            {live ? (
              frozen ? (
                <>
                  <strong>I’m frozen</strong>
                  <small>I can’t spend a cent</small>
                </>
              ) : (
                <>
                  <strong>{usd(live.left)} left in my pocket</strong>
                  <small>
                    Max {whole(live.perTx)} each · refills in {refillIn()}
                  </small>
                </>
              )
            ) : pocket.kind === 'empty' ? (
              <>
                <strong>My pocket is empty</strong>
                <small>Give me a small allowance</small>
              </>
            ) : pocket.kind === 'no-wallet' ? (
              <>
                <strong>Let’s make your wallet</strong>
                <small>Locked by your password</small>
              </>
            ) : (
              <>
                <strong>Checking my pocket…</strong>
                <small>Reading it from Solana</small>
              </>
            )}
          </span>
        </button>
        <div className="care-pocket-actions">
          {live && !frozen && (
            <button
              type="button"
              className="btn btn--ice btn--icon"
              onClick={() => onPocket('freeze')}
              aria-label="Freeze my pocket"
            >
              <SnowIcon size={17} />
            </button>
          )}
          {frozen && (
            <button type="button" className="btn btn--primary" onClick={() => onPocket('unfreeze')}>
              Warm up
            </button>
          )}
          {(pocket.kind === 'empty' || pocket.kind === 'no-wallet') && (
            <button type="button" className="btn btn--primary" onClick={() => onPocket()}>
              {pocket.kind === 'empty' ? 'Give' : 'Start'}
            </button>
          )}
        </div>
      </div>
      {live && (
        <a className="verify care-verify" href={PROGRAM_URL(live.cluster)} target="_blank" rel="noreferrer">
          <SolanaMark size={12} /> Limits enforced on Solana · {live.cluster}
          <ExternalIcon size={13} />
        </a>
      )}
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

type WatchedProps = { wallets: WatchedWallet[]; onAdd: () => void; onOpen: (address: string) => void }

/** The wallets Sunny watches, read-only. Tap one for its report; add up to five. */
function WatchedWallets({ wallets, onAdd, onOpen }: WatchedProps) {
  return (
    <div className="watched">
      <div className="watched-head">
        <span>
          <EyeIcon size={14} /> Watching {wallets.length === 1 ? '1 wallet' : `${wallets.length} wallets`}
        </span>
        {wallets.length < MAX_WATCHED && (
          <button type="button" onClick={onAdd}>
            <PlusIcon size={14} /> Add
          </button>
        )}
      </div>
      <ul>
        {wallets.map((w) => (
          <li key={w.address}>
            <button type="button" onClick={() => onOpen(w.address)} aria-label={`Wallet ${w.address}, ${w.risk} risk`}>
              <span className={`watched-dot watched-dot--${w.risk}`} aria-hidden="true" />
              <span className="watched-addr">{short(w.address)}</span>
              <span className="watched-value">{w.value === null ? 'Can’t read now' : usd(w.value)}</span>
              {w.change24h !== null && w.value ? <Delta value={w.change24h} /> : <span />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
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

function ago(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min`
  if (min < 48 * 60) return `${Math.round(min / 60)} h`
  return `${Math.round(min / 1440)} d`
}

type ForecastProps = {
  home: Home | null
  demo: Mood | null
  onWatch: () => void
  onOpen: (address: string) => void
}

/** Wallet weather: the wallets Sunny watches, together (value, 24h curve, risk), or Solana today. */
function ForecastCard({ home, demo, onWatch, onOpen }: ForecastProps) {
  const scene = demo ? SCENES[demo] : null
  const linked = Boolean(home?.wallets.length) || Boolean(scene)
  const value = scene ? scene.value : home?.value
  const change = scene ? scene.change : home?.change24h
  const spark = scene ? scene.spark : home?.spark
  const forecast = scene ? scene.forecast : home?.forecast
  const risk = scene ? scene.risk : (home?.risk ?? 'Low')
  const watching = scene ? WATCHLIST.length : (home?.tokens.length ?? 0)
  const [whole, cents] = value != null ? usd(value).split('.') : ['—', '']

  return (
    <section className="card forecast">
      <div className="card-head">
        <span className="eyebrow">{linked ? 'Wallet weather' : 'Solana today'}</span>
        {forecast && <span className="forecast-tag">{forecast}</span>}
      </div>
      <div className="forecast-value">
        <span className="big-num">
          {whole}
          {cents && <span className="cents">.{cents}</span>}
        </span>
        {!linked && <span className="forecast-sub">SOL price</span>}
      </div>
      {spark && spark.length > 1 ? <Sparkline points={spark} /> : <div className="sparkline sparkline--empty" />}
      <dl className="metrics">
        <div>
          <dt>24h</dt>
          <dd>{change != null ? <Delta value={change} /> : '—'}</dd>
        </div>
        <div>
          <dt>Risk</dt>
          <dd className={`risk risk--${risk.toLowerCase()}`}>{risk}</dd>
        </div>
        <div>
          <dt>{linked ? 'Watching' : 'Market'}</dt>
          <dd>
            {linked ? `${watching} tokens` : home?.fearGreed ? `${home.fearGreed.label} ${home.fearGreed.value}` : '—'}
          </dd>
        </div>
      </dl>
      {!linked && home && (
        <button type="button" className="btn btn--primary forecast-link" onClick={onWatch}>
          <EyeIcon size={17} /> Watch a wallet
        </button>
      )}
      <p className="source">
        {scene
          ? 'Sample data · demo mode'
          : home
            ? `Updated ${ago(home.updatedAt)} · Prices from Jupiter${home.fearGreed && linked ? ` · Market mood ${home.fearGreed.label.toLowerCase()}` : ''}`
            : 'Checking the sky…'}
      </p>
      {home && home.wallets.length > 0 && !scene && (
        <WatchedWallets wallets={home.wallets} onAdd={onWatch} onOpen={onOpen} />
      )}
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
  const half = Math.max((hi - lo) / 2, mid * 0.025)
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

const HUES = [268, 150, 30, 20, 110, 200, 330, 45]
const hueOf = (symbol: string) => HUES[[...symbol].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length]

function demoToken(t: Token): WatchToken {
  return {
    mint: t.symbol,
    symbol: t.symbol,
    name: t.name,
    price: t.price,
    change: t.change,
    risk: t.safety === 'risky' ? 'high' : 'low',
    held: true,
    alert: false,
  }
}

type WatchlistProps = {
  tokens: WatchToken[]
  linked: boolean
  loading: boolean
  onSelect: (mint: string) => void
  onAdd: () => void
}

/** The tokens Sunny watches: what you hold plus anything you set an alert on. Tap one to check it. */
function Watchlist({ tokens, linked, loading, onSelect, onAdd }: WatchlistProps) {
  return (
    <section className="watch">
      <div className="section-head">
        <h2>{linked ? 'Sunny is watching' : 'Popular on Solana'}</h2>
        <button type="button" className="ghost-btn" onClick={onAdd}>
          <PlusIcon size={16} /> Alert
        </button>
      </div>
      <div className="watch-row">
        {loading && [0, 1, 2].map((i) => <article key={i} className="token token--loading" aria-hidden="true" />)}
        {tokens.map((t) => (
          <button
            key={t.mint}
            type="button"
            className="token"
            data-safety={t.risk === 'low' ? 'safe' : 'risky'}
            onClick={() => onSelect(t.mint)}
            aria-label={`${t.symbol}: tap to check`}
          >
            <div className="token-top">
              {t.icon ? (
                <img
                  className="token-avatar token-avatar--img"
                  src={t.icon}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="token-avatar" style={{ ['--h' as string]: hueOf(t.symbol) }}>
                  {t.symbol[0]}
                </span>
              )}
              <span className={`token-safety token-safety--${t.risk === 'low' ? 'safe' : 'risky'}`}>
                {t.risk === 'low' ? (
                  <CheckIcon size={12} strokeWidth={2.6} />
                ) : (
                  <AlertIcon size={12} strokeWidth={2.4} />
                )}
                {t.risk === 'low' ? 'Checked' : t.risk === 'high' ? 'Risky' : 'Careful'}
              </span>
            </div>
            <div className="token-symbol">
              {t.symbol}
              {t.alert && (
                <span className="token-bell" title="Price alert set">
                  🔔
                </span>
              )}
            </div>
            <div className="token-price">{t.price != null ? formatPrice(t.price) : '—'}</div>
            {t.change != null ? <Delta value={t.change} /> : <span className="delta delta--flat">• —</span>}
          </button>
        ))}
      </div>
    </section>
  )
}

/** Time until the pocket's daily limit resets at midnight UTC, as the program counts days. */
function refillIn() {
  const now = Date.now()
  const min = Math.round(((Math.floor(now / 86_400_000) + 1) * 86_400_000 - now) / 60_000)
  return min >= 60 ? `${Math.floor(min / 60)} h` : `${min} min`
}

const ACTIVITY_ICON: Record<ActivityItem['kind'], typeof ShieldIcon> = {
  check: ShieldIcon,
  scam: StopIcon,
  alert: EyeIcon,
  wallet: SwapIcon,
  watch: EyeIcon,
}

const DEMO_KIND: Record<Activity['kind'], ActivityItem['kind']> = {
  x402: 'check',
  blocked: 'scam',
  swap: 'wallet',
  watch: 'watch',
}

function demoActivity(a: Activity): ActivityItem {
  return { kind: DEMO_KIND[a.kind], text: a.text, meta: a.meta, at: '' }
}

/** A real log of what Sunny did for you: checks, flagged scams, alerts, linked wallets. */
const NEWS_KIND = {
  security: { icon: '🚨', label: 'Security' },
  opportunity: { icon: '✨', label: 'Opportunity' },
  news: { icon: '📰', label: 'News' },
} as const

/** What's happening on Solana, from free public sources. Security alerts come first. */
function NewsCard({ items }: { items: NewsItem[] }) {
  return (
    <section className="card news">
      <div className="card-head">
        <span className="eyebrow">What’s happening</span>
        <span className="news-sources">Public sources</span>
      </div>
      <ul>
        {items.map((n) => (
          <li key={n.id} className={`news-item news-item--${n.kind}`}>
            <a href={n.link} target="_blank" rel="noreferrer">
              <span className="news-kind">
                {NEWS_KIND[n.kind].icon} {NEWS_KIND[n.kind].label}
              </span>
              <span className="news-title">{n.title}</span>
              <small>
                {n.source} · {ago(n.at)}
              </small>
            </a>
          </li>
        ))}
      </ul>
      <p className="source">News, not financial advice. Sunny isn’t an investment advisor.</p>
    </section>
  )
}

function ActivityCard({ items }: { items: ActivityItem[] }) {
  return (
    <section className="card activity">
      <div className="card-head">
        <span className="eyebrow">What Sunny did</span>
      </div>
      {items.length === 0 ? (
        <p className="activity-empty">Nothing yet. Ask me to check a token, or scan a wallet or a link.</p>
      ) : (
        <ul>
          {items.slice(0, 6).map((a) => {
            const IconCmp = ACTIVITY_ICON[a.kind]
            return (
              <li key={`${a.at}-${a.text}`} className={`activity-item activity-item--${a.kind}`}>
                <span className="activity-icon">
                  <IconCmp size={17} />
                </span>
                <span className="activity-text">
                  {a.text}
                  <small>{a.meta}</small>
                </span>
                {a.at && <span className="activity-time">{ago(a.at)}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
