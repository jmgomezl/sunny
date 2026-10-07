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

export type ChatReply = {
  reply: string
  cards: TokenCard[]
  links: LinkCheck[]
  alerts: AlertCard[]
  live: boolean
  guest: boolean
}

const FALLBACK_ERROR = 'My thoughts got cloudy for a second. Try me again? ☁️'

// Outside Telegram there's no signed user, so the browser keeps a random guest id.
let memoryGuestId: string | undefined
function guestId() {
  try {
    let id = localStorage.getItem('sunny.guest')
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem('sunny.guest', id)
    }
    return id
  } catch {
    return (memoryGuestId ??= crypto.randomUUID())
  }
}

/** True inside Telegram, where the chat is the same conversation as the bot chat. */
export const inTelegram = () => Boolean(window.Telegram?.WebApp?.initData)

export async function askSunny(message: string): Promise<ChatReply> {
  const initData = window.Telegram?.WebApp?.initData
  const body = initData ? { message, initData } : { message, guestId: guestId() }
  let res: Response
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('I can’t reach my thoughts right now. Check your connection? ☁️')
  }
  const data = (await res.json().catch(() => ({}))) as Partial<ChatReply> & { error?: string }
  if (!res.ok || !data.reply) throw new Error(data.error || FALLBACK_ERROR)
  return {
    reply: data.reply,
    cards: data.cards ?? [],
    links: data.links ?? [],
    alerts: data.alerts ?? [],
    live: Boolean(data.live),
    guest: Boolean(data.guest),
  }
}
