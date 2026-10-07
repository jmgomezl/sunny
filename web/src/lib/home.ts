import { post } from './api'
import type { AlertCard, LinkCheck, TokenCard, TokenFlag } from './chat'

export type WatchToken = {
  mint: string
  symbol: string
  name: string
  icon?: string
  price: number | null
  change: number | null
  risk: 'low' | 'medium' | 'high'
  held: boolean
  alert: boolean
}

export type ActivityItem = { kind: 'check' | 'scam' | 'alert' | 'wallet' | 'watch'; text: string; meta: string; at: string }

/** A headline from Sunny's news desk: free public sources, filtered for Solana. */
export type NewsItem = {
  id: string
  title: string
  link: string
  source: string
  at: string
  kind: 'security' | 'opportunity' | 'news'
  solana: boolean
}

/** A wallet Sunny watches (read-only), as listed under the wallet weather. */
export type WatchedWallet = {
  address: string
  /** Null when it couldn't be read this time. */
  value: number | null
  change24h: number | null
  risk: 'low' | 'medium' | 'high'
  approvals: number
}

/** Sunny's home screen, built on the server from the watched wallets and live data. */
export type Home = {
  wallets: WatchedWallet[]
  value: number | null
  change24h: number | null
  spark: number[]
  sparkLabel: string
  forecast: string
  risk: 'Low' | 'Medium' | 'High'
  mood: 'happy' | 'excited' | 'worried'
  status: { tone: 'ok' | 'warn' | 'info'; text: string }
  line: string
  tokens: WatchToken[]
  checked: number
  approvals: number
  fearGreed: { value: number; label: string } | null
  alerts: Omit<AlertCard, 'basePrice'>[]
  activity: ActivityItem[]
  news: NewsItem[]
  /** Days in a row you visited Sunny. */
  streak: number
  updatedAt: string
  guest: boolean
}

export type WatchChange = { watch: string } | { unwatch: string }

/** Loads the home screen, optionally watching or unwatching a wallet first. */
export const fetchHome = (change?: WatchChange) => post<Home>('/api/home', change ?? {})

export type WalletReport = {
  address: string
  total: number
  sol: number
  change24h: number | null
  tokenCount: number
  top: { symbol: string; icon?: string; value: number; risk: 'low' | 'medium' | 'high'; mint: string }[]
  activity: { transactions: number; more: boolean; failed: number; lastActive: string | null; firstSeen: string | null } | null
  approvals: number | null
  risk: 'low' | 'medium' | 'high'
  flags: TokenFlag[]
}

/** "Should I sign this?": what a Blink would do to your wallet, read and simulated by Sunny. */
export type BlinkReport = {
  link: string
  actionUrl: string
  host: string
  registry: 'trusted' | 'malicious' | 'unknown'
  phishing: 'known_scam' | 'suspicious' | 'official' | 'unknown' | null
  title: string
  description: string
  icon?: string
  buttons: string[]
  tried: string | null
  wallet: string | null
  yourWallet: boolean
  outcome: 'simulated' | 'would_fail' | 'not_simulated' | 'unavailable'
  failReason?: string
  sends: { symbol: string; mint: string; amount: number; usd: number | null }[]
  receives: { symbol: string; mint: string; amount: number; usd: number | null }[]
  programs: string[]
  warnings: { level: 'danger' | 'caution'; text: string }[]
  verdict: 'danger' | 'caution' | 'ok'
  summary: string
}

export type Inspection =
  | { kind: 'token'; found: true; card: TokenCard; details: { exact_match: boolean; other_tokens_with_same_symbol: number } }
  | { kind: 'token'; found: false; query: string }
  | { kind: 'wallet'; report: WalletReport }
  | { kind: 'link'; link: LinkCheck }
  | { kind: 'blink'; report: BlinkReport }
  | { kind: 'unknown'; message: string }

/** Works out what a scanned or pasted value is (wallet, token or link) and reports on it. */
export const inspectInput = (input: string) => post<Inspection>('/api/inspect', { input })
