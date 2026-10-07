import { post } from './api'
import type { WalletReport } from './home'

export type TokenFlag = { level: 'high' | 'medium'; text: string }

/** A live token card from Jupiter, drawn under Sunny's reply. */
export type TokenCard = {
  symbol: string
  name: string
  mint: string
  icon?: string
  price: number | null
  change24h: number | null
  liquidity: number | null
  holders: number | null
  verified: boolean
  risk: 'low' | 'medium' | 'high'
  flags: TokenFlag[]
}

/** Result of checking a link against phishing lists. */
export type LinkCheck = {
  domain: string
  verdict: 'known_scam' | 'suspicious' | 'official' | 'unknown'
  reasons: string[]
}

/** A price alert Sunny just set. */
export type AlertCard = {
  symbol: string
  direction: 'drop' | 'rise'
  percent: number | null
  basePrice: number
  triggerPrice: number
}

/** A pocket-money draw Sunny attempted; the Solana program approved or refused it. */
export type PocketEvent = { amount: number; reason: string; ok: boolean; message: string; explorer?: string }

/** Something that happened in the user's Sunny wallet, described from the chain. */
export type WalletEvent = { at: string | null; what: string; amount: number | null; ok: boolean; explorer: string }

/** A deep scan Sunny bought over x402 with pocket money. */
export type DeepScan = {
  mint: string
  symbol: string
  name: string
  icon?: string
  price: number
  risk: 'low' | 'medium' | 'high'
  holders: {
    total: number | null
    top10Pct: number | null
    largestPct: number | null
    insidersInTop20: number
    insiderNetworks: number
    insiderWallets: number
  }
  top: { address: string; pct: number; insider: boolean }[]
  liquidityUsd: number | null
  lpLockedPct: number | null
  mintAuthority: boolean
  freezeAuthority: boolean
  mutableMetadata: boolean
  transferFeePct: number
  creatorHoldsPct: number | null
  rugged: boolean
  risks: { name: string; level: 'danger' | 'warn' | 'info'; text: string }[]
  paymentTx: string
  drawTx: string
}

/** The user's own Sunny wallet, when they ask about "my wallet". */
export type MyWallet = {
  address: string
  cluster: string
  usdc: number
  pocket: { vault: number; leftToday: number; dailyLimit: number; frozen: boolean } | null
  recent: WalletEvent[]
}

export type ChatReply = {
  reply: string
  cards: TokenCard[]
  links: LinkCheck[]
  alerts: AlertCard[]
  pocket: PocketEvent[]
  mine: MyWallet | null
  wallets: WalletReport[]
  scans: DeepScan[]
  /** Sunny started or stopped watching a wallet, so the home should reload. */
  watchChanged: boolean
  live: boolean
  guest: boolean
}

export { inTelegram } from './api'

export async function askSunny(message: string): Promise<ChatReply> {
  const data = await post<Partial<ChatReply>>('/api/chat', { message })
  if (!data.reply) throw new Error('My thoughts got cloudy for a second. Try me again? ☁️')
  return {
    reply: data.reply,
    cards: data.cards ?? [],
    links: data.links ?? [],
    alerts: data.alerts ?? [],
    pocket: data.pocket ?? [],
    mine: data.mine ?? null,
    wallets: data.wallets ?? [],
    scans: data.scans ?? [],
    watchChanged: Boolean(data.watchChanged),
    live: Boolean(data.live),
    guest: Boolean(data.guest),
  }
}
