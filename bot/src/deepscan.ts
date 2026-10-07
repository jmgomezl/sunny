import { getJson, type TokenCard } from './market.js'
import { tokenInfo } from './wallet.js'

// Sunny's deep scan: what the free check doesn't show. Who actually holds the token
// (top holders, insiders and insider networks), the creator's stake, the authorities
// still in place, the LP lock on its deepest market, and every risk RugCheck lists.
// It's sold per request over x402 (see x402.ts).

const RUGCHECK = 'https://api.rugcheck.xyz/v1'

type Holder = { address: string; owner?: string; pct?: number; insider?: boolean }
type Market = { lp?: { lpLockedPct?: number; quoteUSD?: number; baseUSD?: number } }
type FullReport = {
  token?: { supply?: number; decimals?: number }
  tokenMeta?: { name?: string; symbol?: string; mutable?: boolean }
  mintAuthority?: unknown
  freezeAuthority?: unknown
  creator?: string | null
  creatorBalance?: number
  topHolders?: Holder[] | null
  totalHolders?: number
  graphInsidersDetected?: number
  insiderNetworks?: { size?: number; activeAccounts?: number }[] | null
  markets?: Market[] | null
  totalMarketLiquidity?: number
  transferFee?: { pct?: number }
  risks?: { name: string; level: string; description: string }[] | null
  rugged?: boolean
}

export type DeepReport = {
  mint: string
  symbol: string
  name: string
  icon?: string
  price: number | null
  risk: TokenCard['risk']
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
  creator: string | null
  creatorHoldsPct: number | null
  rugged: boolean
  risks: { name: string; level: 'danger' | 'warn' | 'info'; text: string }[]
  checkedAt: string
}

const round = (n: number | null | undefined, d = 1) => (n == null || !Number.isFinite(n) ? null : Number(n.toFixed(d)))

/** Builds the deep report for a token mint, or null if RugCheck can't see it. */
export async function deepReport(mint: string): Promise<DeepReport | null> {
  const [rug, jup] = await Promise.all([
    getJson<FullReport>(`${RUGCHECK}/tokens/${mint}/report`).catch(() => null),
    tokenInfo([mint])
      .then((m) => m.get(mint))
      .catch(() => undefined),
  ])
  if (!rug) return null

  const holders = rug.topHolders ?? []
  const deepest = [...(rug.markets ?? [])].sort(
    (a, b) => (b.lp?.quoteUSD ?? 0) + (b.lp?.baseUSD ?? 0) - ((a.lp?.quoteUSD ?? 0) + (a.lp?.baseUSD ?? 0)),
  )[0]
  const supply = rug.token?.supply ?? 0
  const networks = rug.insiderNetworks ?? []
  const risks = (rug.risks ?? []).map((r) => ({
    name: r.name,
    level: (['danger', 'warn'].includes(r.level) ? r.level : 'info') as 'danger' | 'warn' | 'info',
    text: r.description,
  }))
  const dangers = risks.filter((r) => r.level === 'danger').length
  const warnings = risks.filter((r) => r.level === 'warn').length

  return {
    mint,
    symbol: jup?.symbol ?? rug.tokenMeta?.symbol ?? `${mint.slice(0, 4)}…`,
    name: jup?.name ?? rug.tokenMeta?.name ?? 'Unknown token',
    icon: jup?.icon,
    price: jup?.usdPrice ?? null,
    risk: rug.rugged || dangers >= 2 ? 'high' : dangers || warnings >= 2 ? 'medium' : 'low',
    holders: {
      total: rug.totalHolders ?? jup?.holderCount ?? null,
      top10Pct: holders.length ? round(holders.slice(0, 10).reduce((s, h) => s + (h.pct ?? 0), 0)) : null,
      largestPct: holders.length ? round(holders[0].pct) : null,
      insidersInTop20: holders.filter((h) => h.insider).length,
      insiderNetworks: networks.length,
      insiderWallets: rug.graphInsidersDetected ?? networks.reduce((s, n) => s + (n.activeAccounts ?? n.size ?? 0), 0),
    },
    top: holders.slice(0, 5).map((h) => ({ address: h.owner ?? h.address, pct: round(h.pct) ?? 0, insider: Boolean(h.insider) })),
    liquidityUsd: round(rug.totalMarketLiquidity, 0),
    lpLockedPct: round(deepest?.lp?.lpLockedPct, 0),
    mintAuthority: Boolean(rug.mintAuthority),
    freezeAuthority: Boolean(rug.freezeAuthority),
    mutableMetadata: Boolean(rug.tokenMeta?.mutable),
    transferFeePct: rug.transferFee?.pct ?? 0,
    creator: rug.creator ?? null,
    creatorHoldsPct: supply > 0 && rug.creatorBalance != null ? round((rug.creatorBalance / supply) * 100, 2) : null,
    rugged: Boolean(rug.rugged),
    risks,
    checkedAt: new Date().toISOString(),
  }
}
