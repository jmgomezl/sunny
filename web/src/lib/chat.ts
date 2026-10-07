import { post } from './api'

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

export type ChatReply = {
  reply: string
  cards: TokenCard[]
  links: LinkCheck[]
  alerts: AlertCard[]
  pocket: PocketEvent[]
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
    live: Boolean(data.live),
    guest: Boolean(data.guest),
  }
}
