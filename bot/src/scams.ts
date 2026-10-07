// Scam-link checks against free, open phishing lists plus Solana-specific heuristics.
// MetaMask's list is updated daily; Phantom's is Solana-specific (older, still useful).

const METAMASK_LIST = 'https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json'
const PHANTOM_LIST = 'https://raw.githubusercontent.com/phantom/blocklist/master/blocklist.yaml'
const REFRESH_MS = 6 * 60 * 60 * 1000

// Real homes of the Solana apps scammers impersonate most.
const OFFICIAL: Record<string, string[]> = {
  phantom: ['phantom.app', 'phantom.com'],
  solflare: ['solflare.com'],
  jupiter: ['jup.ag', 'jupiter.ag'],
  jup: ['jup.ag'],
  raydium: ['raydium.io'],
  orca: ['orca.so'],
  magiceden: ['magiceden.io'],
  tensor: ['tensor.trade'],
  pump: ['pump.fun'],
  solana: ['solana.com', 'solana.org'],
  backpack: ['backpack.app', 'backpack.exchange'],
  marinade: ['marinade.finance'],
  kamino: ['kamino.finance'],
  meteora: ['meteora.ag'],
  jito: ['jito.network', 'jito.wtf'],
  drift: ['drift.trade'],
  solscan: ['solscan.io'],
  bonk: ['bonkcoin.com'],
}
const TRUSTED = new Set([
  ...Object.values(OFFICIAL).flat(),
  'x.com',
  'twitter.com',
  'discord.com',
  't.me',
  'github.com',
  'explorer.solana.com',
  'birdeye.so',
  'dexscreener.com',
  'rugcheck.xyz',
  'coingecko.com',
])
const BAIT_WORDS = ['claim', 'airdrop', 'reward', 'bonus', 'free', 'giveaway', 'restore', 'validate', 'sync', 'rectify', 'unlock', 'eligib']
const FREE_HOSTS = ['pages.dev', 'vercel.app', 'netlify.app', 'webflow.io', 'fleek.co', 'github.io', 'web.app', 'firebaseapp.com', 'glitch.me', 'replit.app', 'ipfs.io', 'gitbook.io']

let blocked = new Set<string>()
let allowed = new Set<string>()
let loadedAt = 0

async function load() {
  const [mm, ph] = await Promise.allSettled([
    fetch(METAMASK_LIST, { signal: globalThis.AbortSignal.timeout(20_000) }).then((r) => r.json()),
    fetch(PHANTOM_LIST, { signal: globalThis.AbortSignal.timeout(20_000) }).then((r) => r.text()),
  ])
  const next = new Set<string>()
  if (mm.status === 'fulfilled') {
    for (const d of (mm.value as { blacklist?: string[] }).blacklist ?? []) next.add(d.toLowerCase())
    allowed = new Set(((mm.value as { whitelist?: string[] }).whitelist ?? []).map((d) => d.toLowerCase()))
  }
  if (ph.status === 'fulfilled') {
    for (const m of ph.value.matchAll(/url:\s*(\S+)/g)) next.add(m[1].toLowerCase())
  }
  if (next.size) {
    blocked = next
    loadedAt = Date.now()
    console.log(`[sunny] scam lists loaded: ${next.size.toLocaleString('en-US')} domains`)
  }
}

/** Loads the lists now and refreshes them in the background. */
export function startScamLists() {
  load().catch((err) => console.error('[sunny] scam lists failed to load', err))
  setInterval(() => load().catch(() => {}), REFRESH_MS).unref()
}

function editDistance(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[a.length][b.length]
}

export type LinkCheck = {
  domain: string
  verdict: 'known_scam' | 'suspicious' | 'official' | 'unknown'
  reasons: string[]
}

export function checkLink(input: string): LinkCheck | { error: string } {
  let host: string
  try {
    host = new URL(/^[a-z]+:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`).hostname.toLowerCase()
  } catch {
    return { error: 'That doesn’t look like a link.' }
  }
  const domain = host.replace(/^www\./, '')
  const parents = domain.split('.').map((_, i, parts) => parts.slice(i).join('.')).filter((d) => d.includes('.'))

  if (parents.some((d) => TRUSTED.has(d)) && !parents.some((d) => blocked.has(d))) {
    return { domain, verdict: 'official', reasons: ['This is the real, official site'] }
  }
  if (parents.some((d) => blocked.has(d)) && !parents.some((d) => allowed.has(d))) {
    return { domain, verdict: 'known_scam', reasons: ['Listed as a phishing site by MetaMask/Phantom’s open blocklists'] }
  }

  const reasons: string[] = []
  const label = domain.replace(/\.[^.]+$/, '')
  for (const [brand, homes] of Object.entries(OFFICIAL)) {
    if (brand.length < 4) continue
    const lookalike = homes.some((h) => {
      const base = h.replace(/\.[^.]+$/, '')
      return base.length >= 5 && editDistance(label.split('.').pop() ?? label, base) === 1
    })
    if (domain.includes(brand) || lookalike) {
      reasons.push(`Pretends to be ${brand[0].toUpperCase()}${brand.slice(1)}, but the real site is ${homes[0]}`)
      break
    }
  }
  const bait = BAIT_WORDS.filter((w) => domain.includes(w))
  if (bait.length) reasons.push(`Uses bait words in the address (${bait.join(', ')})`)
  if (domain.includes('xn--')) reasons.push('Uses look-alike characters (punycode)')
  if (FREE_HOSTS.some((h) => domain.endsWith(`.${h}`))) reasons.push('Hosted on a free site builder, common for throwaway scam pages')

  return {
    domain,
    verdict: reasons.length ? 'suspicious' : 'unknown',
    reasons: reasons.length ? reasons : [`Not on any scam list I check (${blocked.size.toLocaleString('en-US')} known sites)${loadedAt ? '' : ' yet'}`],
  }
}
