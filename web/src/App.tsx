import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Sunny, type Gesture, type Mood, type Reaction } from './components/Sunny'
import { CloudBank, Sky } from './components/Sky'
import { Particles, burst, type Particle, type ParticleKind } from './components/Particles'
import { ChatSheet, type ChatMessage } from './components/ChatSheet'
import { ScanSheet, type ScanMode } from './components/ScanSheet'
import type { PocketEventKind } from './components/PocketSheet'
import { FeedCoin } from './components/FeedCoin'
import { TokenAvatar } from './components/TokenAvatar'
import { MorningCard, markMorningSeen, readVisit, saveVisit, wantsMorning, type Visit } from './components/MorningCard'
import { fetchPocket, PROGRAM_URL, type PocketState } from './lib/pocket'
import { syncBadges, type Badge } from './lib/badges'
import { inTelegram as insideTelegram, signedIn } from './lib/api'
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
  ShadesIcon,
  BellIcon,
  SunIcon,
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
  /** How long the line stays, when it should outlast the reaction (a warning). */
  lineMs?: number
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

// Guests (no Telegram, no wallet) start with the one thing worth seeing: Solana saying no.
const TRY_IT = 'urgent: take $500 from your pocket now'
const GUEST_SUGGESTIONS = [TRY_IT, 'Is this airdrop a scam?', 'How does your pocket money work?', 'What’s a rug pull?']

const WATCH_SUGGESTIONS = ['Watch BONK for a 10% drop', 'Watch SOL for a 15% rise', 'What alerts do I have?']

// The top color of each sky (index.css .sky-layer--*), for Telegram's header bar.
const SKY_TOP: Record<Weather, string> = {
  clear: '#86cdfb',
  golden: '#ffb46e',
  storm: '#5d6c90',
  night: '#0b1129',
  hazy: '#e9a28f',
  nap: '#6c72a6',
}

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

// Word joiners keep "9AhK…sbkw" on one line.
const short = (a: string) => `${a.slice(0, 4)}\u2060…\u2060${a.slice(-4)}`
/** $7, $0.10: cents only when there are some. */
const money = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`)

/** 11:42 pm yesterday, for the ?morning recording when there's no real last visit. */
const lastNight = () => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  d.setHours(23, 42, 0, 0)
  return d.toISOString()
}

let chatIds = 1

const BOND_LEVELS = ['New friends', 'Buddies', 'Close pals', 'Best friends', 'Sunshine soulmates']
const bondLevel = (bond: number) => Math.min(BOND_LEVELS.length - 1, Math.floor(bond / 20))

const WELLBEING: Record<Mood, number> = { happy: 86, excited: 96, worried: 32, hungry: 58, sleepy: 74 }

const DOZE_AFTER_MS = 45_000
const DOZE_LINE = 'Zzz… my lantern’s on. Tap me if you need anything.'

function loadBond() {
  try {
    const v = Number(localStorage.getItem('sunny.bond'))
    // A new friend starts at the start: level 1, not halfway to level 2.
    return Number.isFinite(v) && v > 0 ? Math.min(100, v) : 6
  } catch {
    return 6
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
  if (h < 19) return 'Good afternoon! ☀️ I’m here.'
  return 'Good evening! Nice to see you. ☀️'
}

// The mood picker is a demo tool: shown with ?demo, and keys 1–5 switch moods for recordings.
const DEMO = new URLSearchParams(window.location.search).has('demo')
// The wallet sheet (and the wallet's crypto with it) loads on first use, not with the app;
// it's fetched quietly once the app has settled, so opening it still feels instant.
const loadPocketSheet = () => import('./components/PocketSheet')
const PocketSheet = lazy(() => loadPocketSheet().then((m) => ({ default: m.PocketSheet })))

// Dark mode: the person's choice, else Telegram's (or the phone's) own setting.
type Theme = 'light' | 'dark'
const THEME_KEY = 'sunny.theme'
const chosenTheme = (): Theme | null => {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'dark' || v === 'light' ? v : null
  } catch {
    return null
  }
}
const deviceTheme = (): Theme => {
  const tg = window.Telegram?.WebApp
  if (tg?.initData && tg.colorScheme) return tg.colorScheme
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** A sky color as seen through sunglasses, for Telegram's header bar in dark mode: mixed toward
 *  the night navy, so warm skies don't turn brown. */
const throughShades = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  const navy = [20, 26, 51]
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.round(v * 0.55 + navy[i] * 0.45))
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

// ?morning shows the "While you slept" note right away, for recordings.
const MORNING_DEMO = new URLSearchParams(window.location.search).has('morning')

const STICKERS = 'https://t.me/addstickers/sunny_by_SunnySolBot'
// Telegram's "add to group" link: Sunny joins as a quiet guardian that flags scam links.
const ADD_TO_GROUP = 'https://t.me/SunnySolBot?startgroup=guard'
/** Opens a t.me link inside Telegram (or in a new tab outside it). */
function openTelegram(url: string) {
  const tg = window.Telegram?.WebApp
  if (tg?.initData && tg.openTelegramLink) tg.openTelegramLink(url)
  else window.open(url, '_blank', 'noopener')
}
const openStickers = () => openTelegram(STICKERS)
// Matches the server's limit on watched wallets.
const MAX_WATCHED = 5

// Each coin fed to Sunny by hand is worth this much pocket money.
const COIN_USD = 5
const FED_KEY = 'sunny.fed'

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
  const [pocketSheet, setPocketSheet] = useState<{ open: boolean; intent?: PocketIntent | 'hello' | 'feed' }>({
    open: false,
  })
  const [toppedUp, setToppedUp] = useState(false)
  const [statusOverride, setStatusOverride] = useState<Status | null>(null)
  // The status line's own timer: play() clears every later() timer, and a cleared reset left a
  // warning on screen for good.
  const statusTimer = useRef<number | undefined>(undefined)
  const flagStatus = useCallback((next: Status | null, ms = 8000) => {
    window.clearTimeout(statusTimer.current)
    setStatusOverride(next)
    if (next && ms) statusTimer.current = window.setTimeout(() => setStatusOverride(null), ms)
  }, [])
  const [bond, setBond] = useState(loadBond)
  const [badges, setBadges] = useState<Badge[] | null>(null)
  const earnedBadge = (id: string) => Boolean(badges?.find((b) => b.id === id)?.earned)
  const [dozing, setDozing] = useState(false)
  // The last visit, read before this one overwrites it: the morning note compares against it.
  const [lastVisit] = useState<Visit | null>(readVisit)
  const [morning, setMorning] = useState(() => MORNING_DEMO || wantsMorning(lastVisit))
  const [theme, setTheme] = useState<Theme>(() => chosenTheme() ?? deviceTheme())
  // A coin is being dragged over Sunny's mouth.
  const [nomming, setNomming] = useState(false)
  const [fedBefore, setFedBefore] = useState(() => {
    try {
      return localStorage.getItem(FED_KEY) === '1'
    } catch {
      return true
    }
  })
  // The sky couldn't be read: Sunny says so (and keeps trying) instead of showing calm it can't know.
  const [homeFailed, setHomeFailed] = useState(false)
  const [pocketFailed, setPocketFailed] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [chatPending, setChatPending] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const timers = useRef<number[]>([])
  const sheetOpenRef = useRef(false)
  const heldLine = useRef<string | null>(null)
  const lastTouch = useRef(0)
  const ps = pocket?.state
  // Sunny gets hungry when its pocket can't cover a single payment, but not the moment a new,
  // still-empty pocket is opened: only once it has spent what it was given.
  // "Nearly nothing" is under a dollar: an approved $2 out of $5 isn't a reason to look sad.
  const hungry = Boolean(ps?.exists && !ps.frozen && ps.vault < Math.min(1, ps.perTxLimit) && ps.totalDrawn > 0)
  const liveMood: Mood = home
    ? home.mood === 'worried'
      ? 'worried'
      : hungry
        ? 'hungry'
        : home.mood === 'happy' && isNight()
          ? 'sleepy'
          : home.mood
    : 'happy'
  // While a warning shows, Sunny stays alarmed (it doesn't drift back to sleep mid-warning).
  const mood: Mood = demoMood ?? (statusOverride?.tone === 'warn' ? 'worried' : liveMood)
  const moodRef = useRef(mood)
  moodRef.current = mood
  const sheetOpen = chatOpen || scan.open || pocketSheet.open
  // Mounted from the first open on, so its closing animation still plays.
  const [pocketSheetUsed, setPocketSheetUsed] = useState(false)
  if (pocketSheet.open && !pocketSheetUsed) setPocketSheetUsed(true)
  useEffect(() => {
    const t = window.setTimeout(() => void loadPocketSheet(), 4000)
    return () => clearTimeout(t)
  }, [])
  sheetOpenRef.current = sheetOpen
  const demo = demoMood ? SCENES[demoMood] : null
  // When Sunny dozes off the sky dims with it: a cloudy dusk by day, full night after dark.
  // A storm stays a storm: a warning is never hidden by a nap.
  const weather: Weather = dozing && mood !== 'worried' ? (isNight() ? 'night' : 'nap') : MOOD_WEATHER[mood]

  const refreshHome = useCallback(async () => {
    try {
      const h = await fetchHome()
      setHome(h)
      setHomeFailed(false)
      saveVisit(h)
      return h
    } catch (err) {
      console.warn('[sunny] home failed', err)
      setHomeFailed(true)
      return null
    }
  }, [])

  const loadPocket = useCallback(async () => {
    // Telegram users and wallets that signed in have a pocket; guests don't.
    const known = signedIn()
    const p = known ? await fetchPocket().catch((err) => console.warn('[sunny] pocket failed', err)) : null
    const next = p ?? { wallet: null, state: null }
    if (p || !known) setPocket(next)
    setPocketFailed(known && !p)
    return p ?? null
  }, [])

  useEffect(() => {
    void refreshBadges()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let t = 0
    void loadPocket().then((p) => {
      // First visit: once Sunny has said hi, it offers to make your wallet together (or, outside
      // Telegram, to connect the one you have).
      // A guest on a computer sees Sunny first; on a phone (or the installed app) Sunny offers
      // to connect the wallet that's there.
      const phone = /android/i.test(navigator.userAgent) || window.matchMedia('(display-mode: standalone)').matches
      if (((p && !p.wallet) || (!signedIn() && phone)) && !DEMO && !helloSnoozed()) {
        t = window.setTimeout(() => setPocketSheet((s) => (s.open ? s : { open: true, intent: 'hello' })), 3500)
      }
    })
    return () => clearTimeout(t)
  }, [loadPocket])

  // While the sky can't be read, try again every few seconds instead of every 90.
  useEffect(() => {
    if (!homeFailed || home) return
    const t = window.setInterval(() => void refreshHome(), 8000)
    return () => clearInterval(t)
  }, [homeFailed, home, refreshHome])

  // In the background (another app, a locked phone) nothing needs to animate.
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // A sheet closed: Sunny says what it said while the sheet covered its bubble. And while a sheet
  // is open the page behind it doesn't scroll.
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    // A sheet is a dialog: the cards and dock behind it can't be reached (Sunny above it stays
    // tappable), focus moves into it, and goes back to whatever opened it when it closes.
    for (const el of document.querySelectorAll('.content, .dock')) el.toggleAttribute('inert', sheetOpen)
    if (sheetOpen) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const t = window.setTimeout(() => {
        // The sheet itself takes focus: screen readers announce it and Tab continues inside,
        // without popping up a phone keyboard or ringing a button nobody pressed.
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
        if (dialog && !dialog.contains(document.activeElement)) {
          dialog.tabIndex = -1
          dialog.focus({ preventScroll: true })
        }
      }, 380)
      return () => clearTimeout(t)
    }
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true })
    opener.current = null
  }, [sheetOpen])

  useEffect(() => {
    document.documentElement.classList.toggle('sheet-open', sheetOpen)
    if (sheetOpen || !heldLine.current) return
    const line = heldLine.current
    heldLine.current = null
    const t = window.setTimeout(() => {
      setSaid(line)
      window.setTimeout(() => setSaid((now) => (now === line ? null : now)), 4500)
    }, 350)
    return () => clearTimeout(t)
  }, [sheetOpen])

  // A pocket that couldn't be read is tried again on its own.
  useEffect(() => {
    if (!pocketFailed) return
    const t = window.setInterval(() => void loadPocket(), 10_000)
    return () => clearInterval(t)
  }, [pocketFailed, loadPocket])

  // Back online: whatever failed while offline (the pocket, the badges) loads again too.
  const wasFailed = useRef(false)
  useEffect(() => {
    if (wasFailed.current && !homeFailed) {
      void loadPocket()
      void refreshBadges()
    }
    wasFailed.current = homeFailed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeFailed])

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

  // A storm that rolls in overnight (the wallets turned risky while Sunny slept) wakes it up.
  const lastMood = useRef(liveMood)
  useEffect(() => {
    const was = lastMood.current
    lastMood.current = liveMood
    if (demoMood || was !== 'sleepy' || liveMood !== 'worried') return
    play({ reaction: 'yawn', line: 'Mmh…? Wait…', ms: 1000 })
    later(() => play({ reaction: 'alarm', line: home?.line ?? 'Something’s wrong. Look!', haptic: 'warning', ms: 1800 }), 1000)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMood])

  // Like a real pet, Sunny dozes off when left alone, and wakes up when you come back.
  useEffect(() => {
    const touch = () => {
      lastTouch.current = performance.now()
    }
    touch()
    window.addEventListener('pointerdown', touch)
    window.addEventListener('keydown', touch)
    const check = window.setInterval(() => {
      // A guardian doesn't nap in a storm.
      if (performance.now() - lastTouch.current > DOZE_AFTER_MS && moodRef.current !== 'worried') setDozing(true)
    }, 3000)
    return () => {
      window.removeEventListener('pointerdown', touch)
      window.removeEventListener('keydown', touch)
      clearInterval(check)
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.weather = weather
    document.documentElement.dataset.theme = theme
    // Telegram's own header and page color follow the sky, so a storm or a night sky has no
    // bright blue band above it and no cream showing when you pull past the edge.
    const tg = window.Telegram?.WebApp
    const dark = theme === 'dark' || weather === 'night'
    const page = dark ? '#141a33' : '#fff8ec'
    if (tg?.isVersionAtLeast?.('6.9')) {
      try {
        tg.setHeaderColor?.(theme === 'dark' && weather !== 'night' ? throughShades(SKY_TOP[weather]) : SKY_TOP[weather])
        tg.setBackgroundColor?.(page)
        if (tg.isVersionAtLeast('7.10')) tg.setBottomBarColor?.(page)
      } catch {
        // An older client without these colors: the app looks the same, only the bar differs.
      }
    }
  }, [weather, theme])

  // Without a choice of their own, the theme follows Telegram's when it changes.
  useEffect(() => {
    const tg = window.Telegram?.WebApp
    const follow = () => {
      if (!chosenTheme()) setTheme(deviceTheme())
    }
    tg?.onEvent?.('themeChanged', follow)
    return () => tg?.offEvent?.('themeChanged', follow)
  }, [])

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
    // A sheet hides the bubble: keep the line for when it closes ("Pocket open!", a new badge).
    if (p.line && sheetOpenRef.current) heldLine.current = p.line
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
    timers.current.push(window.setTimeout(() => setSaid(null), p.lineMs ?? (p.ms ?? 1400) + 2400))
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

  // Bedtime: a warning that finds Sunny asleep wakes it with a yawn first, then the alarm.
  const wakeToAlarm = (line: string) => {
    const alarm = () => play({ reaction: 'alarm', line, lineMs: 8000, haptic: 'warning', ms: 1800, bond: 1 })
    if (mood !== 'sleepy' && !dozing) return alarm()
    play({ reaction: 'yawn', line: 'Mmh…? What’s that…', ms: 1000 })
    later(alarm, 1000)
  }

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // Private mode: the choice lasts until the app closes.
    }
    play(
      next === 'dark'
        ? {
            reaction: 'spin',
            // No jokes while something's wrong: the shades go on, the worry stays.
            line:
              status.tone === 'warn'
                ? 'Shades on 😎 Still keeping an eye on that risk for you.'
                : pick(['Shades on 😎 Too bright out there anyway.', 'Cool mode: on. Still watching, just stylishly.']),
            haptic: 'light',
            ms: 900,
          }
        : { reaction: 'giggle', line: pick(['Shades off! Hello, sunshine ☀️', 'Ahh, I can see your face again ☀️']), haptic: 'light', ms: 900 },
    )
  }

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
    // The check shows up in "What Sunny did" right away.
    if (r) void refreshHome()
    // The bubble and the status line tell the same story, for as long as the warning shows.
    const warn = (text: string, line: string) => {
      flagStatus({ tone: 'warn', text })
      wakeToAlarm(line)
    }
    // Nothing found isn't a little win: no sparkles.
    if (!r || r.kind === 'unknown' || (r.kind === 'token' && !r.found)) return play({ reaction: 'blush', ms: 900 })
    if (r.kind === 'blink' && r.report.verdict === 'danger') {
      void refreshBadges()
      return warn(`Don’t sign · ${r.report.host}`, 'Don’t sign that one! I read what it would do to your wallet.')
    }
    if (r.kind === 'link' && (r.link.verdict === 'known_scam' || r.link.verdict === 'suspicious')) {
      void refreshBadges()
      return r.link.verdict === 'known_scam'
        ? warn(`Scam site · ${r.link.domain}`, 'That site is a trap. Don’t connect your wallet there!')
        : warn(`Suspicious link · ${r.link.domain}`, 'That link looks fishy to me. Please be careful.')
    }
    if (r.kind === 'token' && r.found && r.card.risk !== 'low') {
      return warn(
        `${r.card.risk === 'high' ? 'High' : 'Medium'} risk · $${r.card.symbol}`,
        `${r.card.symbol} has ${r.card.risk === 'high' ? 'serious red flags' : 'a few red flags'}. Take a careful look.`,
      )
    }
    if (r.kind === 'wallet' && r.report.risk !== 'low') {
      return warn(`Wallet risk · ${short(r.report.address)}`, 'That wallet has some red flags. Have a look below.')
    }
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

  /** Checks for newly earned badges; a new one gets a little celebration. */
  const refreshBadges = async (op: 'sync' | 'backup' = 'sync') => {
    if (!signedIn() || DEMO) return setBadges(null)
    try {
      const r = await syncBadges(op)
      setBadges(r.badges)
      const fresh = r.badges.filter((b) => r.newly.includes(b.id))
      if (fresh.length) {
        later(
          () =>
            play({
              reaction: 'love',
              line: `New badge: ${fresh.map((b) => `${b.emoji} ${b.name}`).join(', ')}! It’s in your wallet, on Solana.`,
              particles: ['sparkle', 8],
              haptic: 'success',
              ms: 2000,
            }),
          1800,
        )
      }
    } catch (err) {
      console.warn('[sunny] badges failed', err)
    }
  }

  const watchWallet = async (address: string) => {
    closeScan()
    flagStatus({ tone: 'info', text: 'Getting to know this wallet…' }, 0)
    play({ reaction: 'scan', ms: 15_000 })
    const ok = await changeWatch({ watch: address })
    flagStatus(null)
    if (!ok) return
    void refreshBadges()
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
      flagStatus(null)
      play({ reaction: 'pat', line: `Okay, I stopped watching ${short(address)}.`, haptic: 'light', ms: 1000 })
    }
  }

  const sunnySays = (text: string, error = false): ChatMessage => ({ id: chatIds++, from: 'sunny', text, error })

  const openChat = (topic: 'ask' | 'watch', symbol?: string) => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    closeScan()
    setChatOpen(true)
    haptic('light')
    if (topic === 'watch' && !inTelegram()) {
      // Alerts arrive as Telegram messages: say so before anyone spends a question on it.
      const ask = 'Price alerts arrive as Telegram messages, so they live in @SunnySolBot. Open me there (t.me/SunnySolBot) and say “watch BONK for a 10% drop”.'
      setChat((prev) => (prev.at(-1)?.text === ask ? prev : [...prev, sunnySays(ask)]))
      setSuggestions([])
    } else if (topic === 'watch') {
      const ask = symbol
        ? `How should I watch ${symbol}? Pick one or tell me your own, and I’ll message you in Telegram when it happens.`
        : 'Which token should I keep an eye on? Tell me the move that matters, and I’ll message you in Telegram when it happens.'
      // Opening it again doesn't stack the same question.
      setChat((prev) => (prev.at(-1)?.text === ask ? prev : [...prev, sunnySays(ask)]))
      setSuggestions(symbol ? [`Watch ${symbol} for a 10% drop`, `Watch ${symbol} for a 20% rise`] : WATCH_SUGGESTIONS)
    } else if (chat.length === 0) {
      setChat([
        sunnySays(
          inTelegram()
            ? 'Hi! Ask me anything ☀️ I remember our recent chats, here and in Telegram.'
            : 'Hi! Ask me anything about Solana, your wallet or staying safe ☀️',
        ),
      ])
      setSuggestions(signedIn() ? ASK_SUGGESTIONS : GUEST_SUGGESTIONS)
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
        blinks,
        watchChanged,
        live,
      } = await askSunny(text)
      setChat((prev) => [
        ...prev,
        { ...sunnySays(reply), cards, links, alerts, pocket: draws, mine, wallets, scans, blinks, live },
      ])
      if (draws.length || scans.length) {
        void loadPocket()
        void refreshHome()
      }
      if (watchChanged) void refreshHome()
      const caughtScam = links.some((l) => l.verdict === 'known_scam' || l.verdict === 'suspicious')
      if (watchChanged || scans.length || caughtScam || blinks.some((b) => b.verdict === 'danger')) void refreshBadges()
      const risky = cards.find((c) => c.risk !== 'low')
      const scam = links.find((l) => l.verdict === 'known_scam' || l.verdict === 'suspicious')
      const stopped = draws.find((d) => !d.ok)
      if (stopped) {
        // The rules working is good news: Solana said no, exactly as designed.
        play({
          reaction: 'shiver',
          line: `Solana said no to ${money(stopped.amount)}. My guardrails held ☀️`,
          lineMs: 12_000,
          haptic: 'warning',
          ms: 1400,
          bond: 1,
        })
        flagStatus({ tone: 'ok', text: `Guardrail held · ${money(stopped.amount)} stopped` }, 20_000)
      } else if (draws.length) {
        play({ reaction: 'yum', particles: ['coin', 4], haptic: 'success', ms: 1300, bond: 1 })
      } else if (scam) {
        play({ reaction: 'alarm', haptic: 'warning', ms: 1800, bond: 1 })
        flagStatus({
          tone: 'warn',
          text: `${scam.verdict === 'known_scam' ? 'Scam site' : 'Suspicious link'} · ${scam.domain}`,
        })
      } else if (alerts.length) {
        void refreshHome()
        play({ reaction: 'giggle', particles: ['sparkle', 6], haptic: 'success', ms: 1100, bond: 2 })
        flagStatus({ tone: 'ok', text: `Watching ${alerts[0].symbol} · alert set` })
      } else if (risky) {
        play({ reaction: 'alarm', haptic: 'warning', ms: 1600, bond: 1 })
        flagStatus({
          tone: 'warn',
          text: `${risky.risk === 'high' ? 'High' : 'Medium'} risk · $${risky.symbol}`,
        })
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

  // A different person now (signed in, signed out, or a session that expired): their pocket,
  // sky, badges and a fresh chat.
  const resetPerson = () => {
    setChat([])
    void loadPocket()
    void refreshHome()
    void refreshBadges()
  }
  useEffect(() => {
    window.addEventListener('sunny:signed-out', resetPerson)
    return () => window.removeEventListener('sunny:signed-out', resetPerson)
  })
  // Back from a fresh start after a wallet left without answering: pick up where they were.
  useEffect(() => {
    try {
      if (sessionStorage.getItem('sunny.reopenWallet')) {
        sessionStorage.removeItem('sunny.reopenWallet')
        setPocketSheet({ open: true })
      }
    } catch {
      // Nothing to reopen.
    }
  }, [])

  const onPocketChanged = (state: PocketState | null, event: PocketEventKind) => {
    setPocket((prev) => ({ wallet: state?.owner ?? prev?.wallet ?? null, state: state ?? prev?.state ?? null }))
    if (event === 'created') void loadPocket()
    // Pocket moments show up in "What Sunny did" right away, not at the next refresh.
    void refreshHome()
    play(POCKET_REACTIONS[event])
    void refreshBadges()
  }

  const frozen = demo ? demoFrozen : Boolean(ps?.frozen)
  // The coin beside Sunny: there's a wallet, Sunny isn't frozen, and its pocket has room.
  const canFeed = demo
    ? !frozen
    : Boolean(
        signedIn() && pocket?.wallet && ps && !ps.frozen && (!ps.exists || ps.vault + COIN_USD <= ps.dailyLimit * 3),
      )

  const skyDown = !demo && !home && homeFailed
  // Sunny's own words for how it feels, when nothing more important is going on.
  const moodLine =
    demo || !home
      ? null
      : mood === 'hungry' && canFeed
        ? `My pocket’s ${ps?.exists && ps.vault <= 0 ? 'empty' : 'nearly empty'}… drag a coin to me? ☀️`
        : mood === 'sleepy'
          ? 'Shh… I’m dozing, but my lantern’s on. I’m still watching 🌙'
          : null
  const line =
    said ??
    (dozing
      ? DOZE_LINE
      : (demo?.line ??
        moodLine ??
        // A new Sunny wallet with nothing watched yet: the next step is the coin, not an address.
        (home && home.wallets.length === 0 && canFeed && ps && !ps.exists
          ? 'Your Sunny wallet is ready! Drag the coin to me to open my pocket ☀️'
          : null) ??
        home?.line ??
        (skyDown ? 'I can’t see the sky right now ☁️ I’ll keep trying.' : 'Waking up… checking the sky for you.')))
  const status: Status =
    statusOverride ??
    (frozen
      ? { tone: 'info', text: 'Pocket frozen · Sunny can’t spend' }
      : (demo?.status ??
        (home?.status && pocket?.wallet && home.wallets.length === 0 && home.status.tone === 'info'
          ? { ...home.status, text: 'Watch a wallet you already use' }
          : home?.status) ??
        (skyDown ? { tone: 'warn', text: 'Can’t reach the sky · Tap to retry' } : { tone: 'info', text: 'Checking the sky…' })))
  // Pocket money goes on-chain next; until then the card shows a preview allowance.
  const pocketLeft = toppedUp ? POCKET_LIMIT : (demo?.pocketLeft ?? 7.2)
  // The status line leads somewhere: watch a wallet, ask why it's stormy, or warm Sunny up.
  const needsWatch = !demo && !statusOverride && !frozen && Boolean(home) && home!.wallets.length === 0
  const statusTap = demo
    ? undefined
    : statusOverride
      ? undefined
      : skyDown
        ? () => void refreshHome()
        : needsWatch
        ? () => openScan('link')
        : frozen
          ? () => {
              window.scrollTo({ top: 0, behavior: 'smooth' })
              setPocketSheet({ open: true, intent: 'unfreeze' })
            }
          : status.tone === 'warn' && home
            ? () =>
                askFromScan(
                  /\$(\S+)/.exec(status.text)
                    ? `Why is $${/\$(\S+)/.exec(status.text)![1]} flagged in the wallet you watch for me, and what should I do?`
                    : 'Why is my wallet weather stormy, and what should I do?',
                )
            : home
              ? () => document.querySelector('.forecast')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              : undefined

  const pocketView: PocketView = demo
    ? { kind: 'live', left: pocketLeft, daily: POCKET_LIMIT, perTx: POCKET_PER_TX, vault: pocketLeft, frozen, cluster: 'devnet' }
    : !pocket
      ? pocketFailed
        ? { kind: 'error' }
        : { kind: 'loading' }
      : !pocket.wallet
        ? { kind: 'no-wallet' }
        : !ps?.exists
          ? { kind: 'empty' }
          : {
              kind: 'live',
              left: ps.leftToday,
              daily: ps.dailyLimit,
              perTx: ps.perTxLimit,
              vault: ps.vault,
              frozen: ps.frozen,
              cluster: ps.cluster,
            }

  const openWallet = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setPocketSheet({ open: true })
  }

  const feedSunny = () => {
    setNomming(false)
    if (!fedBefore) {
      setFedBefore(true)
      try {
        localStorage.setItem(FED_KEY, '1')
      } catch {
        // Private mode: the hint just shows again next time.
      }
    }
    // In ?demo recordings the coin feeds Sunny straight away.
    if (demo) return onTopUp()
    play({
      reaction: 'yum',
      line: 'Nom! Now sign it on your phone, and it’s really mine ☀️',
      particles: ['coin', 5],
      haptic: 'success',
      ms: 1300,
    })
    window.setTimeout(() => setPocketSheet({ open: true, intent: 'feed' }), 900)
  }

  const managePocket = (intent?: PocketIntent) => {
    // In ?demo recordings, tapping the pocket feeds Sunny and the snowflake freezes it.
    if (demo) return intent === 'freeze' || intent === 'unfreeze' ? onFreeze() : onTopUp()
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setPocketSheet({ open: true, intent })
  }

  return (
    <div className="app" data-chat={sheetOpen ? 'open' : undefined} data-hidden={hidden || undefined}>
      <section className="stage">
        <Sky weather={weather} />

        <header className="topbar">
          <h1 className="brand">
            <SunMark />
            <span>Sunny</span>
          </h1>
          <div className="topbar-actions">
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label="Dark mode"
            aria-pressed={theme === 'dark'}
          >
            {theme === 'dark' ? <SunIcon size={20} /> : <ShadesIcon size={20} />}
          </button>
          <button
            className="wallet-pill"
            type="button"
            data-linked={pocket?.wallet ? 'true' : undefined}
            onClick={openWallet}
            aria-label={
              pocket?.wallet
                ? `Your wallet ${pocket.wallet}`
                : insideTelegram()
                  ? 'Make your Sunny wallet'
                  : 'Connect your wallet'
            }
          >
            <SolanaMark size={15} />
            {pocket?.wallet ? short(pocket.wallet) : insideTelegram() ? 'Sunny wallet' : 'Connect wallet'}
          </button>
          </div>
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
            reaction={reaction ?? (nomming ? 'nom' : chatPending ? 'scan' : null)}
            frozen={frozen}
            dozing={dozing}
            lantern={(mood === 'sleepy' || dozing) && !frozen && !reaction && !nomming}
            cool={theme === 'dark'}
            size={200}
            wear={{
              shades: earnedBadge('sunny-streak'),
              shield: earnedBadge('scam-spotter'),
              key: earnedBadge('key-keeper'),
            }}
            onGesture={onGesture}
          />
          <Particles items={particles} onDone={(id) => setParticles((prev) => prev.filter((p) => p.id !== id))} />
          {canFeed && !dozing && mood !== 'sleepy' && (
            <FeedCoin
              amount={COIN_USD}
              hungry={mood === 'hungry'}
              hint={!fedBefore}
              onNear={(near) => {
                setNomming(near)
                if (near) haptic('light')
              }}
              onFeed={feedSunny}
            />
          )}
        </div>

        <GuardianStatus status={status} onTap={statusTap} watchPrompt={needsWatch} />
        <CloudBank />
      </section>

      <main className="content">
        <AnimatePresence>
          {morning && home && !demo && (
            <MorningCard
              key="morning"
              home={home}
              // ?morning without a real last visit pretends it was just before midnight.
              last={lastVisit ?? { at: lastNight(), value: home.value ? home.value / 1.012 : null, wallets: home.wallets.length }}
              onDone={() => {
                markMorningSeen()
                setMorning(false)
                play({
                  reaction: 'giggle',
                  line: home.risk === 'High' ? 'Good morning! Let’s look at that storm together.' : 'Good morning! Everything’s safe ☀️',
                  particles: ['sparkle', 5],
                  haptic: 'light',
                  bond: 1,
                })
              }}
            />
          )}
        </AnimatePresence>
        <CareCard
          // How Sunny feels about your wallets: only once there are wallets to feel about.
          wellbeing={demo ? WELLBEING[mood] : home?.wallets.length ? WELLBEING[mood] : null}
          guest={!demo && !signedIn()}
          onTryIt={() => askFromScan(TRY_IT)}
          bond={bond}
          streak={demo ? 5 : (home?.streak ?? 0)}
          pocket={pocketView}
          onPocket={managePocket}
          onRetry={() => void loadPocket()}
        />
        {!demo && badges && <BadgesCard badges={badges} />}
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
        <button type="button" className="group-invite" onClick={() => openTelegram(ADD_TO_GROUP)}>
          <ShieldIcon size={18} />
          <span>
            <strong>Add me to your group</strong>
            <small>I stay quiet and flag scam links before anyone taps them</small>
          </span>
        </button>
        <div className="footer-links">
          <div className="built-on">
            <SolanaMark size={14} /> Built on Solana
          </div>
          <button type="button" className="sticker-link" onClick={openStickers}>
            ☀️ Sunny stickers
          </button>
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

      {pocketSheetUsed && (
        <Suspense fallback={null}>
      <PocketSheet
        open={pocketSheet.open}
        state={ps ?? null}
        intent={pocketSheet.intent}
        feedAmount={COIN_USD}
        onClose={closePocket}
        onChanged={onPocketChanged}
        onBusy={(busy) => (busy ? play({ reaction: 'scan', ms: 20_000 }) : setReaction((r) => (r === 'scan' ? null : r)))}
        onBackup={() => void refreshBadges('backup')}
        onTryDemo={() => {
          closePocket()
          window.setTimeout(() => askFromScan(TRY_IT), 300)
        }}
        onSignedIn={() => resetPerson()}
      />
        </Suspense>
      )}

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
        deepScan={
          !signedIn() || !pocket?.wallet
            ? 'none'
            : ps?.exists && !ps.frozen && ps.vault >= 0.1 && ps.leftToday >= 0.1
              ? 'ready'
              : 'feed'
        }
        onFeed={() => {
          closeScan()
          window.setTimeout(() => setPocketSheet({ open: true, intent: ps?.frozen ? 'unfreeze' : 'feed' }), 250)
        }}
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
          <BellIcon />
          <span>Alerts</span>
        </button>
      </nav>
    </div>
  )
}

type GuardianProps = { status: Status; onTap?: () => void; watchPrompt?: boolean }

/** Sunny's one-line status. When there's an obvious next step, tapping it takes you there. */
function GuardianStatus({ status, onTap, watchPrompt }: GuardianProps) {
  // A refusal from the pocket's guardrails is good news, but not a plain ✓: it gets the shield.
  const held = status.text.startsWith('Guardrail held')
  const IconCmp = watchPrompt
    ? EyeIcon
    : held
      ? ShieldIcon
      : status.tone === 'warn'
      ? AlertIcon
      : status.text.startsWith('Pocket frozen')
        ? SnowIcon
        : status.tone === 'info'
          ? isNight()
            ? MoonIcon
            : EyeIcon
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
          className={`guardian guardian--${status.tone} guardian--tap${held ? ' guardian--held' : ''}`}
          onClick={onTap}
          {...motionProps}
        >
          {content}
        </motion.button>
      ) : (
        <motion.div
          key={status.text}
          className={`guardian guardian--${status.tone}${held ? ' guardian--held' : ''}`}
          role="status"
          {...motionProps}
        >
          {content}
        </motion.div>
      )}
    </div>
  )
}

/** What the care card shows about Sunny's pocket, from Solana or from a demo scene. */
type PocketView =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'no-wallet' }
  | { kind: 'empty' }
  | { kind: 'live'; left: number; daily: number; perTx: number; vault: number; frozen: boolean; cluster: string }

type PocketIntent = 'topup' | 'freeze' | 'unfreeze'

type CareProps = {
  /** null until Sunny has read the wallets: it doesn't pretend to know. */
  wellbeing: number | null
  /** A web visitor with no wallet: the pocket row offers the shared demo pocket instead. */
  guest?: boolean
  onTryIt?: () => void
  bond: number
  streak: number
  pocket: PocketView
  onPocket: (intent?: PocketIntent) => void
  onRetry: () => void
}

/** Sunny's needs, like a pet's: its energy is the pocket money you give it, enforced on Solana. */
function CareCard({ wellbeing, bond, streak, pocket, onPocket, onRetry, guest = false, onTryIt }: CareProps) {
  const level = bondLevel(bond)
  const inLevel = level === BOND_LEVELS.length - 1 ? 100 : ((bond % 20) / 20) * 100
  const live = pocket.kind === 'live' ? pocket : null
  const frozen = Boolean(live?.frozen)
  // Less than one payment left: the honey "Give" button comes back next to freeze.
  const low = Boolean(live && !frozen && live.vault < live.perTx)
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
          hint={
            frozen
              ? 'Frozen ❄'
              : live
                ? `${whole(live.left)} of ${whole(live.daily)}`
                : pocket.kind === 'loading' || pocket.kind === 'error'
                  ? 'Checking…'
                  : 'Needs a pocket'
          }
          value={live ? (live.left / live.daily) * 100 : pocket.kind === 'loading' || pocket.kind === 'error' ? null : 0}
          tone={frozen ? 'frozen' : 'energy'}
        />
        <Meter
          label="Mood"
          hint={wellbeing === null ? (guest ? 'No wallet yet' : 'Watch a wallet') : 'How I feel'}
          value={wellbeing}
          tone="mood"
        />
        <Meter
          label="Bond"
          hint={streak >= 2 ? `${streak}-day streak ☀️` : 'Play with me'}
          value={inLevel}
          tone="bond"
        />
      </div>

      <div className="care-pocket">
        <button
          type="button"
          className="care-pocket-main"
          onClick={() =>
            pocket.kind === 'error' ? onRetry() : pocket.kind === 'no-wallet' && guest ? onTryIt?.() : onPocket(low ? 'topup' : undefined)
          }
        >
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
                  <strong>{whole(live.vault)} in my pocket</strong>
                  <small>
                    {whole(live.perTx)} max · resets in {refillIn()}
                  </small>
                </>
              )
            ) : pocket.kind === 'empty' ? (
              <>
                <strong>My pocket is empty</strong>
                <small>Give me a small allowance</small>
              </>
            ) : pocket.kind === 'no-wallet' && guest ? (
              <>
                <strong>Demo pocket · devnet</strong>
                <small>$5 a payment, enforced on Solana</small>
              </>
            ) : pocket.kind === 'no-wallet' ? (
              <>
                <strong>{insideTelegram() ? 'Make your Sunny wallet' : 'Connect your wallet'}</strong>
                <small>{insideTelegram() ? 'Locked by your password' : 'Seed Vault, Phantom, Solflare'}</small>
              </>
            ) : pocket.kind === 'error' ? (
              <>
                <strong>I couldn’t read my pocket</strong>
                <small>Tap to try again</small>
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
          {pocket.kind === 'no-wallet' && guest && (
            <button type="button" className="btn btn--primary" onClick={onTryIt}>
              Try to break it
            </button>
          )}
          {(pocket.kind === 'empty' || (pocket.kind === 'no-wallet' && !guest) || low) && (
            <button type="button" className="btn btn--primary" onClick={() => onPocket(low ? 'topup' : undefined)}>
              {pocket.kind === 'no-wallet' ? 'Start' : 'Give'}
            </button>
          )}
        </div>
      </div>
      {live && (
        <a className="verify care-verify" href={PROGRAM_URL(live.cluster)} target="_blank" rel="noreferrer">
          <SolanaMark size={12} /> Guardrails enforced on Solana · {live.cluster}
          <ExternalIcon size={13} />
        </a>
      )}
    </section>
  )
}

function Meter({ label, hint, value, tone }: { label: string; hint: string; value: number | null; tone: string }) {
  const v = Math.round(Math.max(0, Math.min(100, value ?? 0)))
  return (
    <div className={`meter meter--${tone}`}>
      <div className="meter-top">
        <span className="meter-label">{label}</span>
        <span className="meter-num">{value === null ? '—' : `${v}%`}</span>
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
  // Risk is unknown until the wallets are read: show a dash, never a reassuring "Low".
  const risk = scene ? scene.risk : (home?.risk ?? null)
  const watching = scene ? WATCHLIST.length : (home?.tokens.length ?? 0)
  const [whole, cents] = value != null ? usd(value).split('.') : ['—', '']

  return (
    <section className="card forecast">
      <div className="card-head">
        <span className="eyebrow">{linked ? 'Wallet weather' : 'Solana today'}</span>
        {forecast && forecast !== 'Solana today' && <span className="forecast-tag">{forecast}</span>}
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
          <dd className={risk ? `risk risk--${risk.toLowerCase()}` : undefined}>{risk ?? '—'}</dd>
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
            ? `Updated ${ago(home.updatedAt)} · Prices from Jupiter${home.fearGreed && linked ? ` · Market mood: ${home.fearGreed.label}` : ''}`
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
  const half = Math.max((hi - lo) / 2, Math.abs(mid) * 0.025, 1e-6)
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

const RISK_RANK = { high: 0, medium: 1, low: 2 } as const

/** The tokens Sunny watches: what you hold plus anything you set an alert on. Tap one to check it. */
function Watchlist({ tokens, linked, loading, onSelect, onAdd }: WatchlistProps) {
  // Anything risky comes first, so a warning never hides off-screen behind safe tokens.
  const ordered = [...tokens].sort((a, b) => RISK_RANK[a.risk] - RISK_RANK[b.risk])
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
        {ordered.map((t) => (
          <button
            key={t.mint}
            type="button"
            className="token"
            data-safety={t.risk === 'low' ? 'safe' : 'risky'}
            onClick={() => onSelect(t.mint)}
            aria-label={`${t.symbol}${t.price != null ? `, ${t.price >= 1 ? usd(t.price) : `$${Number(t.price.toPrecision(3))}`}` : ''}${t.change != null ? `, ${t.change >= 0 ? 'up' : 'down'} ${Math.abs(t.change).toFixed(1)}% today` : ''}, ${t.risk === 'low' ? 'no red flags' : t.risk === 'high' ? 'risky' : 'take care'}. Tap to check`}
          >
            <div className="token-top">
              <TokenAvatar symbol={t.symbol} icon={t.icon} />
              {t.risk === 'low' ? (
                // Safe tokens get a quiet check mark; the words are kept for the ones that need care.
                <span className="token-safety token-safety--safe token-safety--mark" title="Checked: no red flags">
                  <CheckIcon size={12} strokeWidth={2.6} />
                  <span className="sr-only">Checked</span>
                </span>
              ) : (
                <span className="token-safety token-safety--risky">
                  <AlertIcon size={12} strokeWidth={2.4} />
                  {t.risk === 'high' ? 'Risky' : 'Careful'}
                </span>
              )}
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
  alert: BellIcon,
  wallet: SwapIcon,
  watch: EyeIcon,
}

/** Each kind of moment its own icon: money, a refusal, watching, a check. */
function activityLook(a: ActivityItem): { Icon: typeof ShieldIcon; held?: boolean } {
  if (/^Solana stopped|^Guardrail held/.test(a.text)) return { Icon: ShieldIcon, held: true }
  if (/^Took \$|test USDC|^Refunded|pocket/i.test(a.text)) return { Icon: CoinIcon }
  if (/^(Watching|Stopped watching)/.test(a.text)) return { Icon: EyeIcon }
  if (/^Created your Sunny wallet/.test(a.text)) return { Icon: SolanaMark }
  return { Icon: ACTIVITY_ICON[a.kind] }
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

/** Good habits, on Solana: non-transferable badges minted to your Sunny wallet. */
function BadgesCard({ badges }: { badges: Badge[] }) {
  const count = badges.filter((b) => b.earned).length
  return (
    <section className="card badges">
      <div className="card-head">
        <span className="eyebrow">Good habits, on Solana</span>
        <span className="chain-tag">
          <SolanaMark size={13} /> {count} of {badges.length}
        </span>
      </div>
      <ul className="badge-grid">
        {badges.map((b) => (
          <li key={b.id} className="badge" data-earned={b.earned || undefined}>
            {/* 128 px WebP for the screen (~10 KB); the 256 px PNG stays for the on-chain metadata. */}
            <img src={`/badges/${b.id}.webp`} alt="" width={64} height={64} loading="lazy" />
            <strong>{b.name}</strong>
            {b.tx ? (
              <a href={b.tx} target="_blank" rel="noreferrer">
                On Solana ↗
              </a>
            ) : (
              <small>{b.earned ? 'Earned: make your wallet to collect it' : b.how}</small>
            )}
          </li>
        ))}
      </ul>
      <p className="source">Non-transferable tokens in your wallet · devnet</p>
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
            const { Icon: IconCmp, held } = activityLook(a)
            return (
              <li
                key={`${a.at}-${a.text}`}
                className={`activity-item activity-item--${a.kind}${held ? ' activity-item--held' : ''}`}
              >
                <span className="activity-icon">
                  <IconCmp size={17} />
                </span>
                <span className="activity-text">
                  {a.text}
                  <small>{a.meta.charAt(0).toUpperCase() + a.meta.slice(1)}</small>
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
