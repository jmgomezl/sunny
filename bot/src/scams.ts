// Scam-link checks against free, open phishing lists plus Solana-specific heuristics.
// MetaMask's list is updated daily; Phantom's is Solana-specific (older, still useful).

const METAMASK_LIST = 'https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json'
const PHANTOM_LIST = 'https://raw.githubusercontent.com/phantom/blocklist/master/blocklist.yaml'
const REFRESH_MS = 6 * 60 * 60 * 1000

// Real homes of the Solana apps scammers impersonate most.
const OFFICIAL: Record<string, string[]> = {
  phantom: ['phantom.app', 'phantom.com'],
  solflare: ['solflare.com'],
  jupiter: ['jup.ag'],
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
// Real Solana tools that aren't impersonation targets themselves, but whose names would
// otherwise look like it (solana.fm has "solana" in it, bonkbot.io has "bonk").
const KNOWN_GOOD = [
  'explorer.solana.com',
  'solana.fm',
  'solanabeach.io',
  'birdeye.so',
  'dexscreener.com',
  'rugcheck.xyz',
  'coingecko.com',
  'coinmarketcap.com',
  'bonkbot.io',
  'dial.to',
  'dialect.to',
  'helius.dev',
  'tiplink.io',
  'squads.so',
  'sanctum.so',
  'marginfi.com',
  'metaplex.com',
  'pyth.network',
  'wormhole.com',
]
const TRUSTED = new Set([...Object.values(OFFICIAL).flat(), ...KNOWN_GOOD])
// Sites where anyone can post: the site is real, but the page could be anyone's (fake
// "support" bots live on t.me), so they're never called official.
const PLATFORMS: Record<string, string> = {
  't.me': 'Telegram',
  'telegram.me': 'Telegram',
  'x.com': 'X',
  'twitter.com': 'X',
  'discord.com': 'Discord',
  'discord.gg': 'Discord',
  'github.com': 'GitHub',
  'medium.com': 'Medium',
  'youtube.com': 'YouTube',
  'linktr.ee': 'Linktree',
  'docs.google.com': 'Google Docs',
}
const SUPPORT_BAIT = /support|help|desk|admin|recover|airdrop|claim|verify|validat/i
// Words scam domains glue onto a brand name: phantomwallet-login, solflare-support.
const SCAM_WORDS = /wallet|support|help|official|login|connect|secure|verify|sync|restore|recover|airdrop|claim|bonus|reward/i
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

// Letters scammers swap in because they look alike: "phantorn" reads as "phantom".
const unconfuse = (label: string) => label.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/0/g, 'o').replace(/1/g, 'l')

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

const DISPLAY: Record<string, string> = { magiceden: 'Magic Eden', pump: 'Pump.fun', jup: 'Jupiter' }
const brandName = (brand: string) => DISPLAY[brand] ?? `${brand[0].toUpperCase()}${brand.slice(1)}`

export function checkLink(input: string): LinkCheck | { error: string } {
  let url: URL
  try {
    url = new URL(/^[a-z]+:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`)
  } catch {
    return { error: 'That doesn’t look like a link.' }
  }
  const domain = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
  const parents = domain.split('.').map((_, i, parts) => parts.slice(i).join('.')).filter((d) => d.includes('.'))

  const platform = parents.map((d) => PLATFORMS[d]).find(Boolean)
  if (platform) {
    // A page on Telegram, X or GitHub is only as trustworthy as whoever made it.
    const path = (() => {
      try {
        return decodeURIComponent(url.pathname)
      } catch {
        // A broken %-escape: read the path as it is.
        return url.pathname
      }
    })().toLowerCase()
    const brand = Object.keys(OFFICIAL).find((b) => b.length >= 4 && path.includes(b))
    if (brand && SUPPORT_BAIT.test(path)) {
      return {
        domain,
        verdict: 'suspicious',
        reasons: [`Uses ${brandName(brand)}’s name on ${platform}, where anyone can make an account. Real support never messages you first`],
      }
    }
    const bait = BAIT_WORDS.filter((w) => path.includes(w))
    if (bait.length) {
      return {
        domain,
        verdict: 'suspicious',
        reasons: [`A “${bait[0]}” page on ${platform}, where anyone can post. Real airdrops are announced on the project’s own site`],
      }
    }
    return { domain, verdict: 'unknown', reasons: [`${platform} is real, but anyone can post there: trust this page only if it came from the project’s official site`] }
  }
  if (parents.some((d) => TRUSTED.has(d)) && !parents.some((d) => blocked.has(d))) {
    return { domain, verdict: 'official', reasons: ['This is the real, official site'] }
  }
  if (parents.some((d) => blocked.has(d)) && !parents.some((d) => allowed.has(d))) {
    return { domain, verdict: 'known_scam', reasons: ['Listed as a phishing site by MetaMask/Phantom’s open blocklists'] }
  }

  const reasons: string[] = []
  const bait = BAIT_WORDS.filter((w) => domain.includes(w))
  const freeHost = FREE_HOSTS.some((h) => domain.endsWith(`.${h}`))
  const tld = domain.split('.').pop() ?? ''
  const name = unconfuse(domain.split('.').slice(-2, -1)[0] ?? domain)
  for (const [brand, homes] of Object.entries(OFFICIAL)) {
    if (brand.length < 3) continue
    // "solana" shows up in plenty of honest names, so on its own it needs bait or free hosting.
    // A brand counts as a whole word of the address (phantom-wallet.com), or inside a longer word
    // only with scam bait around it (phantomwallet-support.xyz); tenor.com isn't Tensor, and
    // phantombuster.com isn't Phantom. "solana" is in plenty of honest names, so it always needs bait.
    const labels = domain.split(/[.-]/)
    const baity = bait.length > 0 || freeHost || SCAM_WORDS.test(domain)
    const named = brand.length >= 4 && (brand === 'solana' ? domain.includes(brand) && baity : labels.includes(brand) || (domain.includes(brand) && baity))
    const lookalike = homes.some((h) => {
      const base = h.split('.')[0]
      const distance = editDistance(name, base)
      // Same name once look-alike letters are undone (phantorn.app), or one letter off with the
      // same ending (raydlum.io, jupp.ag) or with bait: meteor.com is just a different site.
      return (distance === 0 && domain !== h) || (distance === 1 && (h.endsWith(`.${tld}`) || baity))
    })
    if (named || lookalike) {
      reasons.push(`Pretends to be ${brandName(brand)}, but the real site is ${homes[0]}`)
      break
    }
  }
  if (bait.length) reasons.push(`Uses bait words in the address (${bait.join(', ')})`)
  if (domain.includes('xn--')) reasons.push('Uses look-alike characters (punycode)')
  if (freeHost) reasons.push('Hosted on a free site builder, common for throwaway scam pages')

  return {
    domain,
    verdict: reasons.length ? 'suspicious' : 'unknown',
    reasons: reasons.length ? reasons : [`Not on any scam list I check (${blocked.size.toLocaleString('en-US')} known sites)${loadedAt ? '' : ' yet'}`],
  }
}
