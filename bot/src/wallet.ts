import { PublicKey } from '@solana/web3.js'
import {
  getJson,
  MAINNET_RPC,
  redFlags,
  riskOf,
  SOL_MINT_ADDRESS,
  tokenApprovals,
  type Flag,
  type JupToken,
  type TokenCard,
} from './market.js'

// Real wallet data for Sunny's home screen and wallet reports: holdings valued with
// Jupiter prices, a 24h value curve rebuilt from each token's 5m/1h/6h/24h moves,
// on-chain activity from the public RPC, and plain-language red flags.

/** A Solana address: base58 that decodes to exactly 32 bytes (44 "z"s pass a regex but aren't a key). */
export function isAddress(s: string) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false
  try {
    new PublicKey(s)
    return true
  } catch {
    return false
  }
}

export type Holding = {
  mint: string
  symbol: string
  name: string
  icon?: string
  amount: number
  price: number | null
  value: number
  change24h: number | null
  verified: boolean
  risk: TokenCard['risk']
  flags: Flag[]
}

export type Portfolio = {
  address: string
  sol: number
  total: number
  change24h: number | null
  /** Wallet value at each of the last 25 hours (oldest first). */
  curve: number[]
  holdings: Holding[]
  approvals: { count: number; items: { token: string; approved_to: string; amount: number | null }[] } | null
}

type Holdings = { uiAmount?: number; tokens?: Record<string, { uiAmount?: number }[]> }

const pct = (t: JupToken | undefined, key: 'stats5m' | 'stats1h' | 'stats6h' | 'stats24h') => t?.[key]?.priceChange ?? 0

/** Batch token info (≤100 mints per call). */
export async function tokenInfo(mints: string[]) {
  const map = new Map<string, JupToken>()
  for (let i = 0; i < mints.length; i += 100) {
    const chunk = mints.slice(i, i + 100)
    const found = await getJson<JupToken[]>(`/tokens/v2/search?query=${chunk.join(',')}`)
    for (const t of found) map.set(t.id, t)
  }
  return map
}

export async function portfolio(address: string): Promise<Portfolio> {
  const raw = await getJson<Holdings>(`/ultra/v1/holdings/${address}`)
  const amounts = new Map<string, number>([[SOL_MINT_ADDRESS, raw.uiAmount ?? 0]])
  for (const [mint, accounts] of Object.entries(raw.tokens ?? {})) {
    const amount = accounts.reduce((s, a) => s + (a.uiAmount ?? 0), 0)
    if (amount > 0) amounts.set(mint, (amounts.get(mint) ?? 0) + amount)
  }

  const info = await tokenInfo([...amounts.keys()].slice(0, 200))
  const holdings: Holding[] = []
  for (const [mint, amount] of amounts) {
    const t = info.get(mint)
    if (!t?.usdPrice) continue
    const flags = redFlags(t)
    holdings.push({
      mint,
      symbol: t.symbol,
      name: t.name,
      icon: t.icon,
      amount,
      price: t.usdPrice,
      value: amount * t.usdPrice,
      change24h: t.stats24h?.priceChange ?? null,
      verified: Boolean(t.isVerified),
      // SOL itself never gets flagged.
      risk: mint === SOL_MINT_ADDRESS ? 'low' : riskOf(flags),
      flags: mint === SOL_MINT_ADDRESS ? [] : flags,
    })
  }
  holdings.sort((a, b) => b.value - a.value)

  // Rebuild the last 24h from each token's 24h/6h/1h/5m moves (amounts held constant).
  const at = (key: 'stats5m' | 'stats1h' | 'stats6h' | 'stats24h') =>
    holdings.reduce((s, h) => s + h.value / (1 + pct(info.get(h.mint), key) / 100), 0)
  const total = holdings.reduce((s, h) => s + h.value, 0)
  const anchors: [number, number][] = [
    [-24, at('stats24h')],
    [-6, at('stats6h')],
    [-1, at('stats1h')],
    [-1 / 12, at('stats5m')],
    [0, total],
  ]
  const curve = Array.from({ length: 25 }, (_, i) => {
    const h = i - 24
    const k = anchors.findIndex(([t]) => t >= h)
    if (k <= 0) return anchors[0][1]
    const [t0, v0] = anchors[k - 1]
    const [t1, v1] = anchors[k]
    return v0 + ((v1 - v0) * (h - t0)) / (t1 - t0)
  })

  const symbols = new Map([...info.values()].map((t) => [t.id, t.symbol]))
  const approvals = await tokenApprovals(address, symbols).catch(() => null)
  const start = anchors[0][1]

  return {
    address,
    sol: raw.uiAmount ?? 0,
    total,
    change24h: start > 0 ? ((total - start) / start) * 100 : null,
    curve,
    holdings,
    approvals,
  }
}

type Signature = { blockTime?: number | null; err: unknown }

/** Transaction count (up to 3,000), first and last activity, from the public RPC. */
export async function walletActivity(address: string) {
  let before: string | undefined
  let count = 0
  let failed = 0
  let newest: number | null = null
  let oldest: number | null = null
  let complete = false
  for (let page = 0; page < 3; page++) {
    const res = await fetch(MAINNET_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignaturesForAddress',
        params: [address, { limit: 1000, ...(before ? { before } : {}) }],
      }),
      signal: globalThis.AbortSignal.timeout(10_000),
    })
    const sigs = ((await res.json()) as { result?: (Signature & { signature: string })[] }).result ?? []
    if (!sigs.length) {
      complete = true
      break
    }
    count += sigs.length
    failed += sigs.filter((s) => s.err).length
    newest ??= sigs[0].blockTime ?? null
    oldest = sigs.at(-1)?.blockTime ?? oldest
    before = sigs.at(-1)?.signature
    if (sigs.length < 1000) {
      complete = true
      break
    }
  }
  const iso = (t: number | null) => (t ? new Date(t * 1000).toISOString() : null)
  return {
    transactions: count,
    more: !complete,
    failed,
    lastActive: iso(newest),
    // Only known when we reached the wallet's very first transaction.
    firstSeen: complete ? iso(oldest) : null,
  }
}

export type WalletReport = {
  address: string
  total: number
  sol: number
  change24h: number | null
  tokenCount: number
  top: Pick<Holding, 'symbol' | 'icon' | 'value' | 'risk' | 'mint'>[]
  activity: Awaited<ReturnType<typeof walletActivity>> | null
  approvals: number | null
  risk: TokenCard['risk']
  flags: Flag[]
}

/** Tokens worth at least this count toward a wallet's risk; below it is dust (often spam airdrops). */
const COUNTS_USD = 1

/**
 * A wallet's red flags from what it holds. The home weather and the wallet card both use
 * these, so the same wallet always gets the same risk.
 */
export function holdingFlags(p: Portfolio): Flag[] {
  const flags: Flag[] = []
  if (p.approvals?.count) {
    flags.push({ level: 'high', text: `${p.approvals.count} token approval${p.approvals.count > 1 ? 's' : ''}: another program can move these tokens` })
  }
  const counted = p.holdings.filter((h) => h.value >= COUNTS_USD)
  const risky = counted.filter((h) => h.risk === 'high')
  if (risky.length) flags.push({ level: 'high', text: `Holds ${risky.length} high-risk token${risky.length > 1 ? 's' : ''} (${risky[0].symbol})` })
  const careful = counted.filter((h) => h.risk === 'medium')
  if (careful.length) {
    flags.push({ level: 'medium', text: `${careful.length} token${careful.length > 1 ? 's' : ''} with some red flags (${careful[0].symbol})` })
  }
  const biggest = p.holdings[0]
  if (biggest && p.total >= 10 && biggest.value / p.total > 0.8) {
    flags.push({ level: 'medium', text: `${Math.round((biggest.value / p.total) * 100)}% of the value is in ${biggest.symbol}` })
  }
  if (p.total > 1 && p.sol < 0.002) flags.push({ level: 'medium', text: 'Almost no SOL left to pay network fees' })
  return flags
}

/** Everything Sunny shows after you scan or paste a wallet address. */
export async function walletReport(address: string): Promise<WalletReport> {
  const [p, activity] = await Promise.all([portfolio(address), walletActivity(address).catch(() => null)])
  const flags = holdingFlags(p)
  const ageDays = activity?.firstSeen ? (Date.now() - Date.parse(activity.firstSeen)) / 86_400_000 : null
  if (ageDays !== null && ageDays < 7) flags.push({ level: 'medium', text: `Brand-new wallet: first transaction ${Math.floor(ageDays)} days ago` })

  return {
    address,
    total: p.total,
    sol: p.sol,
    change24h: p.change24h,
    tokenCount: p.holdings.length,
    top: p.holdings.slice(0, 5).map(({ symbol, icon, value, risk, mint }) => ({ symbol, icon, value, risk, mint })),
    activity,
    approvals: p.approvals?.count ?? null,
    // The level comes from what the wallet holds, exactly like the home weather; the wallet's
    // age is shown as a note but doesn't change it.
    risk: riskOf(holdingFlags(p)),
    flags,
  }
}
