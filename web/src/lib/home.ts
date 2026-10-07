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

/** Sunny's home screen, built on the server from the linked wallet and live data. */
export type Home = {
  wallet: string | null
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
  updatedAt: string
  guest: boolean
}

/** Loads the home screen; pass a wallet to link it, or null to unlink. */
export const fetchHome = (wallet?: string | null) => post<Home>('/api/home', wallet === undefined ? {} : { wallet })

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

export type Inspection =
  | { kind: 'token'; found: true; card: TokenCard; details: { exact_match: boolean; other_tokens_with_same_symbol: number } }
  | { kind: 'token'; found: false; query: string }
  | { kind: 'wallet'; report: WalletReport }
  | { kind: 'link'; link: LinkCheck }
  | { kind: 'unknown'; message: string }

/** Works out what a scanned or pasted value is (wallet, token or link) and reports on it. */
export const inspectInput = (input: string) => post<Inspection>('/api/inspect', { input })
