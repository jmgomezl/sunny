import { activeFor, triggerPrice } from './alerts.js'
import { getJson, redFlags, riskOf, SOL_MINT_ADDRESS } from './market.js'
import { latestNews, type NewsItem } from './news.js'
import { activityOf, streakOf } from './users.js'
import { portfolio, tokenInfo, type Holding, type Portfolio } from './wallet.js'

// Builds Sunny's home screen from real data: the weather of the wallets Sunny watches
// (all of them together), the tokens it watches, its mood and what it says.
// Without a watched wallet it shows Solana today.

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

/** One watched wallet, as listed under the wallet weather. */
export type WatchedWallet = {
  address: string
  /** Null when the wallet couldn't be read this time. */
  value: number | null
  change24h: number | null
  risk: 'low' | 'medium' | 'high'
  approvals: number
}

export type Home = {
  wallets: WatchedWallet[]
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
  /** What's happening on Solana, from the news desk: security first. */
  news: NewsItem[]
  /** Days in a row the person visited Sunny. */
  streak: number
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

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`
const worth = (p: Portfolio) => p.holdings.filter((h) => h.value >= 0.5)

function walletRisk(p: Portfolio): WatchedWallet['risk'] {
  if (p.approvals?.count || worth(p).some((h) => h.risk === 'high')) return 'high'
  return worth(p).some((h) => h.risk === 'medium') ? 'medium' : 'low'
}

/** All watched wallets as one: values and curves add up, and the same token in two wallets merges. */
function combine(list: Portfolio[]) {
  const byMint = new Map<string, Holding>()
  for (const h of list.flatMap((p) => p.holdings)) {
    const seen = byMint.get(h.mint)
    byMint.set(h.mint, seen ? { ...seen, amount: seen.amount + h.amount, value: seen.value + h.value } : h)
  }
  const curve = Array.from({ length: 25 }, (_, i) => list.reduce((s, p) => s + (p.curve[i] ?? 0), 0))
  const total = list.reduce((s, p) => s + p.total, 0)
  return {
    total,
    curve,
    change24h: curve[0] > 0 ? ((total - curve[0]) / curve[0]) * 100 : null,
    holdings: [...byMint.values()].sort((a, b) => b.value - a.value),
    approvals: list.reduce((s, p) => s + (p.approvals?.count ?? 0), 0),
  }
}

export async function buildHome(userId: number, wallets: string[]): Promise<Home> {
  const alerts = activeFor(userId)
  const alertMints = new Set(alerts.map((a) => a.mint))
  const fg = await fearGreed()
  const base = {
    fearGreed: fg,
    alerts: alerts.map((a) => ({ symbol: a.symbol, direction: a.direction, percent: a.percent, triggerPrice: triggerPrice(a) })),
    activity: activityOf(userId),
    news: latestNews('all', 4),
    streak: streakOf(userId),
    updatedAt: new Date().toISOString(),
  }

  // One wallet that can't be read shouldn't hide the others.
  const settled = await Promise.allSettled(wallets.map((w) => portfolio(w)))
  const read = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))

  // No wallet yet, or none can be read right now: show Solana today, and keep any watched
  // wallets listed so they can still be removed.
  if (!read.length) {
    const unreadable = wallets.length > 0
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
      wallets: wallets.map((address) => ({ address, value: null, change24h: null, risk: 'low', approvals: 0 })),
      value: p || null,
      change24h: sol?.stats24h?.priceChange ?? null,
      spark: interpolate(anchors),
      sparkLabel: 'SOL price',
      forecast: 'Solana today',
      risk: 'Low',
      mood: 'happy',
      status: unreadable
        ? { tone: 'warn', text: 'I can’t read that wallet' }
        : { tone: 'info', text: 'Give me a wallet to watch over' },
      line: unreadable
        ? 'I couldn’t read the wallet you gave me just now. Check the address, or remove it and add it again.'
        : 'Hi! Show me a wallet and I’ll keep watch over it. For now, here’s Solana today.',
      tokens,
      checked: 0,
      approvals: 0,
    }
  }

  const watched: WatchedWallet[] = wallets.map((address, i) => {
    const r = settled[i]
    if (r.status === 'rejected') return { address, value: null, change24h: null, risk: 'low', approvals: 0 }
    return {
      address,
      value: r.value.total,
      change24h: r.value.change24h,
      risk: walletRisk(r.value),
      approvals: r.value.approvals?.count ?? 0,
    }
  })
  const many = wallets.length > 1
  const p = combine(read)
  const held = p.holdings.filter((h) => h.value >= 0.5)
  // An empty wallet still gets something to look at: the popular tokens, like the no-wallet home.
  const extraMints = [...new Set([...alertMints, ...(held.length ? [] : POPULAR)])].filter(
    (m) => !held.some((h) => h.mint === m),
  )
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
      risk: t.id === SOL_MINT_ADDRESS ? 'low' : riskOf(redFlags(t)),
      held: false,
      alert: alertMints.has(t.id),
    })),
  ]

  const risky = held.find((h) => h.risk === 'high')
  const approvals = p.approvals
  const risk: Home['risk'] = risky || approvals ? 'High' : held.some((h) => h.risk === 'medium') ? 'Medium' : 'Low'
  const change = p.change24h ?? 0
  const mood: Mood = risk === 'High' ? 'worried' : change >= 5 ? 'excited' : 'happy'

  let status: Status
  let line: string
  if (risky) {
    const where = many ? read.find((w) => w.holdings.some((h) => h.mint === risky.mint)) : undefined
    status = { tone: 'warn', text: `Risk found · $${risky.symbol}` }
    line = `Heads up: ${risky.symbol}${where ? ` in ${short(where.address)}` : ''} has red flags (${risky.flags[0]?.text.toLowerCase() ?? 'high risk'}). Tap it to see why.`
  } else if (approvals) {
    status = { tone: 'warn', text: `${approvals} approval${approvals > 1 ? 's' : ''} to review` }
    line = `Another program can move some of your tokens (${approvals} approval${approvals > 1 ? 's' : ''}). Let’s review it together.`
  } else if (change >= 5) {
    status = { tone: 'ok', text: `All clear · up ${change.toFixed(1)}% today` }
    line = `${many ? 'Your wallets are' : 'Your wallet is'} up ${change.toFixed(1)}% today. Golden hour! I checked every token; nothing risky.`
  } else if (!held.length) {
    status = { tone: 'info', text: `Empty wallet${many ? 's' : ''} · nothing to guard yet` }
    line = `${many ? 'These wallets are' : 'This wallet is'} empty for now. When tokens arrive, I’ll check each one.`
  } else {
    status = { tone: 'ok', text: `All clear · ${held.length} token${held.length > 1 ? 's' : ''} checked` }
    line =
      change <= -5
        ? `A cloudy day: ${many ? 'your wallets are' : 'your wallet is'} down ${Math.abs(change).toFixed(1)}%, but nothing looks risky. I’m watching.`
        : `All clear. I checked your ${held.length} token${held.length > 1 ? 's' : ''}, and nothing looks risky.`
  }

  return {
    ...base,
    wallets: watched,
    value: p.total,
    change24h: p.change24h,
    spark: p.curve,
    sparkLabel: many ? `Value of ${wallets.length} wallets` : 'Wallet value',
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
