import type { Mood } from '../components/Sunny'
import type { Weather } from '../components/Sky'

// Placeholder data for the design prototype; replaced by live wallet + price data later.

export type Token = {
  symbol: string
  name: string
  price: number
  change: number
  hue: number
  safety: 'safe' | 'risky'
}

export type Activity = {
  kind: 'x402' | 'blocked' | 'swap' | 'watch'
  text: string
  meta: string
  time: string
  sig?: string
}

export type Status = {
  tone: 'ok' | 'warn' | 'info'
  text: string
}

export type Scene = {
  weather: Weather
  forecast: string
  line: string
  status: Status
  risk: 'Low' | 'Medium' | 'High'
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
    line: 'All clear. I checked your 5 tokens this morning, and nothing looks risky.',
    status: { tone: 'ok', text: 'All clear · 5 tokens checked · 2 min ago' },
    risk: 'Low',
    value: 1284.52,
    change: 3.2,
    spark: [40, 42, 41, 44, 43, 47, 46, 49, 48, 52, 51, 55, 54, 53, 57, 58, 56, 60, 61, 63, 62, 65, 66, 68],
    pocketLeft: 7.2,
  },
  excited: {
    weather: 'golden',
    forecast: 'Golden hour',
    line: 'JUP is up 12% since yesterday. Want me to remind you to review it tonight?',
    status: { tone: 'ok', text: 'All clear · JUP +12.4% · alert set' },
    risk: 'Low',
    value: 1398.1,
    change: 11.4,
    spark: [30, 31, 33, 32, 35, 38, 37, 41, 45, 44, 49, 53, 52, 57, 61, 60, 66, 70, 69, 74, 79, 83, 86, 92],
    pocketLeft: 7.2,
  },
  sleepy: {
    weather: 'night',
    forecast: 'Clear night',
    line: 'Quiet night. I’ll keep watching your 5 tokens and wake you if anything moves 10%.',
    status: { tone: 'info', text: 'Watching 5 tokens · alerts on' },
    risk: 'Low',
    value: 1279.9,
    change: 0.4,
    spark: [50, 51, 50, 50, 51, 52, 51, 51, 50, 51, 52, 52, 51, 52, 52, 53, 52, 52, 53, 53, 52, 53, 53, 53],
    pocketLeft: 10,
  },
  worried: {
    weather: 'storm',
    forecast: 'Storm warning',
    line: 'Heads up: 3 wallets hold 80% of $FROG and its mint is still open. I’d stay away.',
    status: { tone: 'warn', text: '1 risk found · $FROG' },
    risk: 'High',
    value: 1190.33,
    change: -6.8,
    spark: [70, 69, 70, 67, 66, 68, 64, 62, 63, 59, 57, 58, 54, 52, 53, 50, 48, 49, 46, 45, 47, 44, 42, 41],
    pocketLeft: 6.4,
  },
  hungry: {
    weather: 'hazy',
    forecast: 'Hazy',
    line: 'I’ve used $9.60 of today’s pocket money. Top me up, or I’ll pause paid checks until tomorrow.',
    status: { tone: 'warn', text: '$0.40 left · paid checks pausing soon' },
    risk: 'Low',
    value: 1262.05,
    change: -0.9,
    spark: [55, 56, 55, 54, 55, 53, 54, 52, 53, 52, 51, 53, 52, 51, 50, 51, 52, 50, 51, 50, 49, 50, 50, 49],
    pocketLeft: 0.4,
  },
}

export const WATCHLIST: Token[] = [
  { symbol: 'SOL', name: 'Solana', price: 214.82, change: 2.1, hue: 268, safety: 'safe' },
  { symbol: 'JUP', name: 'Jupiter', price: 1.12, change: 12.4, hue: 150, safety: 'safe' },
  { symbol: 'BONK', name: 'Bonk', price: 0.0000312, change: -4.2, hue: 30, safety: 'safe' },
  { symbol: 'WIF', name: 'dogwifhat', price: 2.31, change: -8.9, hue: 20, safety: 'safe' },
  { symbol: 'FROG', name: 'Frog Coin', price: 0.0042, change: 38.5, hue: 110, safety: 'risky' },
]

export const ACTIVITY: Activity[] = [
  { kind: 'x402', text: 'Safety report on $FROG', meta: 'Paid $0.01 via x402', time: '2 min', sig: '4sXq…9LmP' },
  { kind: 'blocked', text: 'Stopped a $500 swap', meta: 'Over today’s pocket money', time: '1 h' },
  { kind: 'swap', text: 'Bought $5 of JUP', meta: 'Jupiter · within limits', time: '3 h', sig: '2hTc…Qe8w' },
  { kind: 'watch', text: 'Watching BONK for a 10% drop', meta: 'Price alert', time: '1 d' },
]
