import { activeFor, triggerPrice } from './alerts.js'
import { getJson, redFlags, riskOf, SOL_MINT_ADDRESS } from './market.js'
import { activityOf } from './users.js'
import { portfolio, tokenInfo } from './wallet.js'

// Builds Sunny's home screen from real data: the linked wallet's weather, the tokens
// Sunny watches, its mood and what it says. Without a wallet it shows Solana today.

const POPULAR = [
  SOL_MINT_ADDRESS,
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
]

type Mood = 'happy' | 'excited' | 'worried'
type Status = { tone: 'ok' | 'warn' | 'info'; text: string }

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

export type Home = {
  wallet: string | null
  value: number | null
  change24h: number | null
  spark: number[]
  sparkLabel: string
  forecast: string
  risk: 'Low' | 'Medium' | 'High'
  mood: Mood
  status: Status
  line: string
  tokens: WatchToken[]
  checked: number
  approvals: number
  fearGreed: { value: number; label: string } | null
  alerts: { symbol: string; direction: 'drop' | 'rise'; percent: number | null; triggerPrice: number }[]
  activity: ReturnType<typeof activityOf>
  updatedAt: string
}

async function fearGreed() {
  try {
    const d = await getJson<{ data: { value: string; value_classification: string }[] }>('https://api.alternative.me/fng/?limit=1')
    return d.data?.[0] ? { value: Number(d.data[0].value), label: d.data[0].value_classification } : null
  } catch {
    return null
  }
}

export async function buildHome(userId: number, wallet: string | null): Promise<Home> {
  const alerts = activeFor(userId)
  const alertMints = new Set(alerts.map((a) => a.mint))
  const fg = await fearGreed()
  const base = {
    fearGreed: fg,
    alerts: alerts.map((a) => ({ symbol: a.symbol, direction: a.direction, percent: a.percent, triggerPrice: triggerPrice(a) })),
    activity: activityOf(userId),
    updatedAt: new Date().toISOString(),
  }

  if (!wallet) {
    const info = await tokenInfo([...new Set([...POPULAR, ...alertMints])])
    const sol = info.get(SOL_MINT_ADDRESS)
    const tokens: WatchToken[] = [...info.values()].map((t) => ({
      mint: t.id,
      symbol: t.symbol,
      name: t.name,
      icon: t.icon,
      price: t.usdPrice ?? null,
      change: t.stats24h?.priceChange ?? null,
      risk: t.id === SOL_MINT_ADDRESS ? 'low' : riskOf(redFlags(t)),
      held: false,
      alert: alertMints.has(t.id),
    }))
    const p = sol?.usdPrice ?? 0
    const at = (c?: number) => p / (1 + (c ?? 0) / 100)
    const anchors: [number, number][] = [
      [-24, at(sol?.stats24h?.priceChange)],
      [-6, at(sol?.stats6h?.priceChange)],
      [-1, at(sol?.stats1h?.priceChange)],
      [0, p],
    ]
    return {
      ...base,
      wallet: null,
      value: p || null,
      change24h: sol?.stats24h?.priceChange ?? null,
      spark: interpolate(anchors),
      sparkLabel: 'SOL price',
      forecast: 'Solana today',
      risk: 'Low',
      mood: 'happy',
      status: { tone: 'info', text: 'Link a wallet so I can watch it' },
      line: 'Hi! Link your wallet and I’ll keep watch over it. For now, here’s Solana today.',
      tokens,
      checked: 0,
      approvals: 0,
    }
  }

  const p = await portfolio(wallet)
  const held = p.holdings.filter((h) => h.value >= 0.5)
  const extraMints = [...alertMints].filter((m) => !held.some((h) => h.mint === m))
  const extra = extraMints.length ? await tokenInfo(extraMints) : new Map()
  const tokens: WatchToken[] = [
    ...held.slice(0, 8).map((h) => ({
      mint: h.mint,
      symbol: h.symbol,
      name: h.name,
      icon: h.icon,
      price: h.price,
      change: h.change24h,
      risk: h.risk,
      held: true,
      alert: alertMints.has(h.mint),
    })),
    ...[...extra.values()].map((t) => ({
      mint: t.id,
      symbol: t.symbol,
      name: t.name,
      icon: t.icon,
      price: t.usdPrice ?? null,
      change: t.stats24h?.priceChange ?? null,
      risk: riskOf(redFlags(t)),
      held: false,
      alert: true,
    })),
  ]

  const risky = held.find((h) => h.risk === 'high')
  const approvals = p.approvals?.count ?? 0
  const risk: Home['risk'] = risky || approvals ? 'High' : held.some((h) => h.risk === 'medium') ? 'Medium' : 'Low'
  const change = p.change24h ?? 0
  const mood: Mood = risk === 'High' ? 'worried' : change >= 5 ? 'excited' : 'happy'

  let status: Status
  let line: string
  if (risky) {
    status = { tone: 'warn', text: `Risk found · $${risky.symbol}` }
    line = `Heads up: ${risky.symbol} has red flags (${risky.flags[0]?.text.toLowerCase() ?? 'high risk'}). Tap it to see why.`
  } else if (approvals) {
    status = { tone: 'warn', text: `${approvals} approval${approvals > 1 ? 's' : ''} to review` }
    line = `Another program can move some of your tokens (${approvals} approval${approvals > 1 ? 's' : ''}). Let’s review it together.`
  } else if (change >= 5) {
    status = { tone: 'ok', text: `All clear · up ${change.toFixed(1)}% today` }
    line = `Your wallet is up ${change.toFixed(1)}% today. Golden hour! I checked every token; nothing risky.`
  } else if (!held.length) {
    status = { tone: 'info', text: 'Empty wallet · nothing to guard yet' }
    line = 'This wallet is empty for now. When tokens arrive, I’ll check each one.'
  } else {
    status = { tone: 'ok', text: `All clear · ${held.length} token${held.length > 1 ? 's' : ''} checked` }
    line =
      change <= -5
        ? `A cloudy day: your wallet is down ${Math.abs(change).toFixed(1)}%, but nothing looks risky. I’m watching.`
        : `All clear. I checked your ${held.length} token${held.length > 1 ? 's' : ''}, and nothing looks risky.`
  }

  return {
    ...base,
    wallet,
    value: p.total,
    change24h: p.change24h,
    spark: p.curve,
    sparkLabel: 'Wallet value',
    forecast: risk === 'High' ? 'Storm warning' : change >= 5 ? 'Golden hour' : change <= -5 ? 'Cloudy' : 'Mostly sunny',
    risk,
    mood,
    status,
    line,
    tokens,
    checked: held.length,
    approvals,
  }
}

function interpolate(anchors: [number, number][]) {
  return Array.from({ length: 25 }, (_, i) => {
    const h = i - 24
    const k = anchors.findIndex(([t]) => t >= h)
    if (k <= 0) return anchors[0][1]
    const [t0, v0] = anchors[k - 1]
    const [t1, v1] = anchors[k]
    return v0 + ((v1 - v0) * (h - t0)) / (t1 - t0)
  })
}
