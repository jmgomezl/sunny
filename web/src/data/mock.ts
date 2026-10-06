import type { Mood } from '../components/Sunny'
import type { Weather } from '../components/Sky'

// Placeholder data for the design prototype; replaced by live wallet + price data later.

export type Token = {
  symbol: string
  name: string
  price: number
  change: number
  hue: number
  flag?: string
}

export type Activity = {
  kind: 'x402' | 'blocked' | 'swap' | 'watch'
  text: string
  meta: string
}

export type Scene = {
  weather: Weather
  forecast: string
  line: string
  value: number
  change: number
  spark: number[]
  pocketLeft: number
}

export const POCKET_LIMIT = 10
export const POCKET_PER_TX = 5

export const SCENES: Record<Mood, Scene> = {
  happy: {
    weather: 'clear',
    forecast: 'Mostly sunny',
    line: 'Good morning! Your wallet is mostly sunny today.',
    value: 1284.52,
    change: 3.2,
    spark: [40, 42, 41, 44, 43, 47, 46, 49, 48, 52, 51, 55, 54, 53, 57, 58, 56, 60, 61, 63, 62, 65, 66, 68],
    pocketLeft: 7.2,
  },
  excited: {
    weather: 'golden',
    forecast: 'Golden hour',
    line: 'JUP climbed 12% while you were away! Want a reminder to review it tonight?',
    value: 1398.1,
    change: 11.4,
    spark: [30, 31, 33, 32, 35, 38, 37, 41, 45, 44, 49, 53, 52, 57, 61, 60, 66, 70, 69, 74, 79, 83, 86, 92],
    pocketLeft: 7.2,
  },
  sleepy: {
    weather: 'night',
    forecast: 'Clear night',
    line: 'Markets are quiet. I’ll keep watch while you sleep.',
    value: 1279.9,
    change: 0.4,
    spark: [50, 51, 50, 50, 51, 52, 51, 51, 50, 51, 52, 52, 51, 52, 52, 53, 52, 52, 53, 53, 52, 53, 53, 53],
    pocketLeft: 10,
  },
  worried: {
    weather: 'storm',
    forecast: 'Storm warning',
    line: 'Careful: 3 wallets hold 80% of $FROG, and its mint isn’t locked. I wouldn’t touch it.',
    value: 1190.33,
    change: -6.8,
    spark: [70, 69, 70, 67, 66, 68, 64, 62, 63, 59, 57, 58, 54, 52, 53, 50, 48, 49, 46, 45, 47, 44, 42, 41],
    pocketLeft: 6.4,
  },
  hungry: {
    weather: 'hazy',
    forecast: 'Hazy',
    line: 'My pocket is almost empty… only $0.40 left for today’s tools.',
    value: 1262.05,
    change: -0.9,
    spark: [55, 56, 55, 54, 55, 53, 54, 52, 53, 52, 51, 53, 52, 51, 50, 51, 52, 50, 51, 50, 49, 50, 50, 49],
    pocketLeft: 0.4,
  },
}

export const WATCHLIST: Token[] = [
  { symbol: 'SOL', name: 'Solana', price: 214.82, change: 2.1, hue: 268 },
  { symbol: 'JUP', name: 'Jupiter', price: 1.12, change: 12.4, hue: 150 },
  { symbol: 'BONK', name: 'Bonk', price: 0.0000312, change: -4.2, hue: 30 },
  { symbol: 'WIF', name: 'dogwifhat', price: 2.31, change: -8.9, hue: 20 },
  { symbol: 'FROG', name: 'Frog Coin', price: 0.0042, change: 38.5, hue: 110, flag: 'Risky' },
]

export const ACTIVITY: Activity[] = [
  { kind: 'x402', text: 'Paid $0.01 for a safety report on $FROG', meta: 'x402 · 2 min ago' },
  { kind: 'blocked', text: 'Stopped a $500 swap: over today’s pocket money', meta: 'On-chain rule · 1 h ago' },
  { kind: 'swap', text: 'Bought $5 of JUP for you', meta: 'Jupiter · 3 h ago' },
  { kind: 'watch', text: 'Started watching BONK for a 10% drop', meta: 'Alert · yesterday' },
]
