// Live Solana market data for Sunny, from Jupiter's public API (no key needed).
// Every function returns compact, already-interpreted data so the model never has
// to guess numbers or compute risk itself.

const JUP = 'https://lite-api.jup.ag'
export const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112'
const RUGCHECK = 'https://api.rugcheck.xyz/v1'
const FEAR_GREED = 'https://api.alternative.me/fng/?limit=1'
// Mainnet reads (approvals). Separate from SOLANA_RPC_URL, which points at devnet for Sunny's program.
export const MAINNET_RPC = process.env.SOLANA_MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com'
const TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']
const SOL_MINT = 'So11111111111111111111111111111111111111112'
const CACHE_MS = 30_000
const TIMEOUT_MS = 8_000

export type Stats = { priceChange?: number; buyVolume?: number; sellVolume?: number }

export type JupToken = {
  id: string
  name: string
  symbol: string
  icon?: string
  usdPrice?: number
  mcap?: number
  liquidity?: number
  holderCount?: number
  stats5m?: Stats
  stats1h?: Stats
  stats6h?: Stats
  stats24h?: Stats
  firstPool?: { createdAt?: string }
  audit?: {
    mintAuthorityDisabled?: boolean
    freezeAuthorityDisabled?: boolean
    topHoldersPercentage?: number
    devBalancePercentage?: number
  }
  organicScoreLabel?: string
  isVerified?: boolean
  tags?: string[]
}

export type Flag = { level: 'high' | 'medium'; text: string }

/** What the Mini App draws under Sunny's reply: one live token card. */
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
  flags: Flag[]
}

const cache = new Map<string, { at: number; data: unknown }>()

export async function getJson<T>(path: string): Promise<T> {
  const url = path.startsWith('http') ? path : `${JUP}${path}`
  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data as T
  const res = await fetch(url, { signal: globalThis.AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Jupiter ${res.status} for ${path}`)
  const data = (await res.json()) as T
  cache.set(url, { at: Date.now(), data })
  // At most a few hundred answers, oldest out first (a Map keeps insertion order).
  if (cache.size > 400) for (const key of [...cache.keys()].slice(0, cache.size - 400)) cache.delete(key)
  return data
}

const round = (n: number | undefined, digits = 2) =>
  n === undefined || !Number.isFinite(n) ? null : Number(n.toFixed(digits))

/** Keeps meaningful digits for tiny prices like BONK's 0.0000035. */
const price = (n: number | undefined) =>
  n === undefined || !Number.isFinite(n) ? null : Number(n.toPrecision(n < 1 ? 4 : 6))

function ageDays(t: JupToken) {
  const created = t.firstPool?.createdAt ? Date.parse(t.firstPool.createdAt) : NaN
  return Number.isFinite(created) ? Math.floor((Date.now() - created) / 86_400_000) : null
}

/** Plain-language red flags from Jupiter's audit and market stats. */
export function redFlags(t: JupToken): Flag[] {
  const flags: Flag[] = []
  const a = t.audit ?? {}
  if (a.mintAuthorityDisabled === false) flags.push({ level: 'high', text: 'Mint is still open: the creator can print more tokens' })
  if (a.freezeAuthorityDisabled === false) flags.push({ level: 'high', text: 'Freeze authority is on: holders’ tokens can be frozen' })
  const top = a.topHoldersPercentage
  if (top !== undefined && top > 50) flags.push({ level: 'high', text: `Top holders own ${Math.round(top)}% of the supply` })
  else if (top !== undefined && top > 30) flags.push({ level: 'medium', text: `Top holders own ${Math.round(top)}% of the supply` })
  if ((a.devBalancePercentage ?? 0) > 5) flags.push({ level: 'medium', text: `The creator still holds ${Math.round(a.devBalancePercentage!)}%` })
  const liq = t.liquidity
  if (liq !== undefined && liq < 10_000) flags.push({ level: 'high', text: `Very low liquidity ($${Math.round(liq).toLocaleString('en-US')}): hard to sell` })
  else if (liq !== undefined && liq < 75_000) flags.push({ level: 'medium', text: `Low liquidity ($${Math.round(liq).toLocaleString('en-US')})` })
  const age = ageDays(t)
  if (age !== null && age < 7) flags.push({ level: 'medium', text: `Very new: first pool ${age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`}` })
  if (!t.isVerified) flags.push({ level: 'medium', text: 'Not verified on Jupiter' })
  if (t.organicScoreLabel === 'low') flags.push({ level: 'medium', text: 'Trading looks mostly automated, not real people' })
  return flags
}

export function riskOf(flags: Flag[]): TokenCard['risk'] {
  if (flags.some((f) => f.level === 'high')) return 'high'
  return flags.length >= 2 ? 'medium' : 'low'
}

export function toCard(t: JupToken): TokenCard {
  const flags = redFlags(t)
  return {
    symbol: t.symbol,
    name: t.name,
    mint: t.id,
    icon: t.icon,
    price: price(t.usdPrice),
    change24h: round(t.stats24h?.priceChange, 1),
    liquidity: round(t.liquidity, 0),
    holders: t.holderCount ?? null,
    verified: Boolean(t.isVerified),
    risk: riskOf(flags),
    flags,
  }
}

/** Looks up a token by symbol, name or mint address, preferring the real one over copycats. */
export async function lookupToken(query: string) {
  const q = query.trim().replace(/^\$/, '')
  const results = await getJson<JupToken[]>(`/tokens/v2/search?query=${encodeURIComponent(q)}`)
  if (!results.length) return { found: false as const, query: q }

  // Some symbols carry their own "$" ($WIF), so it's ignored on both sides.
  const exact = results.filter((t) => t.symbol.replace(/^\$/, '').toLowerCase() === q.toLowerCase() || t.id === q)
  const pick =
    exact.find((t) => t.isVerified) ??
    [...exact].sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0))[0] ??
    results[0]
  const rug = await rugcheck(pick.id)
  const card = toCard(pick)
  // RugCheck's dangers become flags too; its softer warnings go to the model as context.
  for (const r of rug?.risks ?? []) {
    if (r.level === 'danger' && !card.flags.some((f) => f.text.startsWith(`RugCheck: ${r.name}`))) {
      card.flags.push({ level: 'high', text: `RugCheck: ${r.name}` })
    }
  }
  card.risk = riskOf(card.flags)
  const v24 = (pick.stats24h?.buyVolume ?? 0) + (pick.stats24h?.sellVolume ?? 0)

  return {
    found: true as const,
    card,
    details: {
      exact_match: exact.length > 0,
      other_tokens_with_same_symbol: Math.max(0, exact.length - 1),
      market_cap_usd: round(pick.mcap, 0),
      volume_24h_usd: round(v24, 0),
      change_1h_pct: round(pick.stats1h?.priceChange, 1),
      age_days: ageDays(pick),
      organic_trading: pick.organicScoreLabel ?? 'unknown',
      tags: (pick.tags ?? []).slice(0, 6),
      rugcheck: rug
        ? {
            rugcheck_risk_0_to_10_higher_is_riskier: rug.score_normalised ?? null,
            lp_locked_pct: round(rug.lpLockedPct, 0),
            risks: (rug.risks ?? []).map((r) => `${r.name} (${r.level})`),
          }
        : 'unavailable',
    },
  }
}

type RugReport = { score_normalised?: number; lpLockedPct?: number; risks?: { name: string; level: string }[] }

/** RugCheck's free summary report: a second opinion on a token's risks. */
async function rugcheck(mint: string): Promise<RugReport | null> {
  try {
    return await getJson<RugReport>(`${RUGCHECK}/tokens/${mint}/report/summary`)
  } catch {
    return null
  }
}

/** Live USD prices for many mints at once (used by price alerts). */
export async function currentPrices(mints: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (let i = 0; i < mints.length; i += 50) {
    const chunk = mints.slice(i, i + 50)
    const data = await getJson<Record<string, { usdPrice: number }>>(`/price/v3?ids=${chunk.join(',')}`)
    for (const [mint, v] of Object.entries(data)) if (v?.usdPrice) out[mint] = v.usdPrice
  }
  return out
}

const CATEGORIES = { trending: 'toptrending', top_traded: 'toptraded', top_organic: 'toporganicscore' } as const

/** SOL's price plus the top tokens on Solana right now. */
export async function marketOverview(category: keyof typeof CATEGORIES = 'trending') {
  const [sol, tokens, mood] = await Promise.all([
    getJson<Record<string, { usdPrice: number; priceChange24h?: number }>>(`/price/v3?ids=${SOL_MINT}`),
    getJson<JupToken[]>(`/tokens/v2/${CATEGORIES[category] ?? 'toptrending'}/24h?limit=8`),
    getJson<{ data: { value: string; value_classification: string }[] }>(FEAR_GREED).catch(() => null),
  ])
  return {
    sol: { price: price(sol[SOL_MINT]?.usdPrice), change_24h_pct: round(sol[SOL_MINT]?.priceChange24h, 1) },
    fear_greed: mood?.data?.[0]
      ? { value: Number(mood.data[0].value), label: mood.data[0].value_classification, source: 'alternative.me (crypto-wide)' }
      : 'unavailable',
    category,
    tokens: tokens.slice(0, 8).map((t) => ({
      symbol: t.symbol,
      price: price(t.usdPrice),
      change_24h_pct: round(t.stats24h?.priceChange, 1),
      market_cap_usd: round(t.mcap, 0),
      verified: Boolean(t.isVerified),
    })),
  }
}

type Holdings = {
  uiAmount?: number
  tokens?: Record<string, { uiAmount?: number }[]>
}

/** Read-only snapshot of a public wallet: SOL plus its most valuable tokens. */
export async function walletSnapshot(address: string) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return { error: 'That doesn’t look like a Solana address.' }
  const holdings = await getJson<Holdings>(`/ultra/v1/holdings/${address}`)
  const all = Object.entries(holdings.tokens ?? {})
    .map(([mint, accounts]) => [mint, accounts.reduce((s, a) => s + (a.uiAmount ?? 0), 0)] as const)
    .filter(([, amount]) => amount > 0)
  // Every token is priced before picking the top ones (a wallet full of spam can't hide its
  // real holdings), up to a sane cap, in Jupiter's batches of 50.
  const amounts = all.slice(0, 200)
  const batches = (list: string[]) => Array.from({ length: Math.ceil(list.length / 50) }, (_, i) => list.slice(i * 50, i * 50 + 50))
  const mintList = amounts.map(([m]) => m)
  const [priceParts, infoParts] = await Promise.all([
    Promise.all(batches([SOL_MINT, ...mintList]).map((ids) => getJson<Record<string, { usdPrice: number }>>(`/price/v3?ids=${ids.join(',')}`))),
    Promise.all(batches(mintList).map((ids) => getJson<JupToken[]>(`/tokens/v2/search?query=${ids.join(',')}`))),
  ])
  const prices = Object.assign({}, ...priceParts) as Record<string, { usdPrice: number }>
  const symbol = new Map(infoParts.flat().map((t) => [t.id, t.symbol]))

  const solAmount = holdings.uiAmount ?? 0
  const solValue = solAmount * (prices[SOL_MINT]?.usdPrice ?? 0)
  const tokens = amounts
    .map(([mint, amount]) => ({
      symbol: symbol.get(mint) ?? `${mint.slice(0, 4)}…`,
      amount: round(amount, 4),
      value_usd: round(amount * (prices[mint]?.usdPrice ?? 0), 2) ?? 0,
    }))
    .sort((a, b) => b.value_usd - a.value_usd)

  const approvals = await tokenApprovals(address, symbol).catch(() => null)
  const total = solValue + tokens.reduce((s, t) => s + t.value_usd, 0)
  const biggest = Math.max(solValue, tokens[0]?.value_usd ?? 0)
  return {
    sol: { amount: round(solAmount, 4), value_usd: round(solValue, 2) },
    top_tokens: tokens.slice(0, 8),
    token_count: all.length,
    total_value_usd: round(total, 2),
    largest_position_pct: total > 0 ? round((biggest / total) * 100, 0) : null,
    // Delegations let another program move these tokens without asking again.
    token_approvals: approvals ?? 'unavailable',
  }
}

type ParsedAccount = {
  account: { data: { parsed: { info: { mint: string; delegate?: string; delegatedAmount?: { uiAmount?: number } } } } }
}

/** Token accounts where the owner has approved someone else to spend (a classic drain risk). */
export async function tokenApprovals(address: string, symbol: Map<string, string>) {
  const found: { token: string; approved_to: string; amount: number | null }[] = []
  for (const programId of TOKEN_PROGRAMS) {
    const res = await fetch(MAINNET_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenAccountsByOwner',
        params: [address, { programId }, { encoding: 'jsonParsed' }],
      }),
      signal: globalThis.AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = (await res.json()) as { result?: { value: ParsedAccount[] } }
    for (const a of body.result?.value ?? []) {
      const info = a.account.data.parsed.info
      if (!info.delegate) continue
      found.push({
        token: symbol.get(info.mint) ?? `${info.mint.slice(0, 4)}…`,
        approved_to: `${info.delegate.slice(0, 4)}…${info.delegate.slice(-4)}`,
        amount: info.delegatedAmount?.uiAmount ?? null,
      })
    }
  }
  return { count: found.length, items: found.slice(0, 6) }
}
