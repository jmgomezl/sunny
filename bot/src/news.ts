import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Sunny's news desk: free public feeds, filtered for someone who uses Solana.
// Security news (hacks, exploits, drainers, phishing) becomes a warning in Telegram;
// launches, upgrades and airdrops show up as opportunities, always as news, never advice.
// Headlines come from strangers on the internet, so they're shown as data, never obeyed.

const FEEDS: { source: string; url: string; solana?: boolean }[] = [
  { source: 'Solana', url: 'https://solana.com/news/rss.xml', solana: true },
  { source: 'Cointelegraph', url: 'https://cointelegraph.com/rss/tag/solana', solana: true },
  { source: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { source: 'Decrypt', url: 'https://decrypt.co/feed' },
  { source: 'The Block', url: 'https://www.theblock.co/rss.xml' },
  { source: 'SlowMist', url: 'https://slowmist.medium.com/feed' },
]
const HACKS = 'https://api.llama.fi/hacks'
const REFRESH_MS = 15 * 60_000
const KEEP_NEWS_MS = 4 * 86_400_000
const KEEP_HACKS_MS = 30 * 86_400_000
// Only fresh security news is pushed to people; older items stay in the digest.
const ALERT_WITHIN_MS = 12 * 3_600_000
const MAX_ALERTS_PER_RUN = 2

const DATA_DIR = process.env.SUNNY_DATA_DIR || join(process.cwd(), 'data')
const FILE = join(DATA_DIR, 'news.json')

export type NewsKind = 'security' | 'opportunity' | 'news'
export type NewsItem = {
  id: string
  title: string
  link: string
  source: string
  at: string
  kind: NewsKind
  solana: boolean
  amountUsd?: number
}

const SECURITY =
  /\b(hack(ed|s|er|ers)?|exploit(ed|s|er)?|drain(ed|er|ers)?|phishing|scam(s|mer|mers)?|rug ?pull(ed|s)?|stolen|attack(ed|er|ers)?|vulnerab\w*|breach(ed)?|compromis\w*|malicious|poison\w*|impersonat\w*|theft|heist|fake (app|site|token|airdrop)s?)\b/i
const OPPORTUNITY =
  /\b(airdrops?|launch(es|ed)?|upgrades?|mainnet|integrat(es|ed|ion)|partners?(hip)?|listings?|lists|staking|rewards?|grants?|hackathon|etfs?|approv(es|ed|al)|incentives?)\b/i
const SOLANA =
  /\b(solana|jupiter|phantom|raydium|orca|pump\.?fun|bonk|helius|backpack|marinade|jito|drift|kamino|meteora|tensor|magic eden|solflare|firedancer|agave|seeker|solscan)\b/i

let items: NewsItem[] = []
let alerted = new Set<string>()
let firstRun = true

function load() {
  try {
    const saved = JSON.parse(readFileSync(FILE, 'utf8')) as { alerted?: string[] }
    alerted = new Set(saved.alerted ?? [])
    firstRun = false
  } catch {
    // First start: whatever is in the feeds now counts as already seen.
  }
}

function save() {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(`${FILE}.tmp`, JSON.stringify({ alerted: [...alerted].slice(-500) }))
  renameSync(`${FILE}.tmp`, FILE)
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const clean = (s = '') =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim()
const tag = (xml: string, name: string) => clean(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml)?.[1])

/**
 * Security reads the whole teaser: missing a hack is worse than a false alarm. "Opportunity"
 * is judged on the headline alone, so a passing mention of a launch doesn't earn the label.
 */
export function classify(title: string, description = ''): NewsKind {
  if (SECURITY.test(`${title} ${description}`)) return 'security'
  if (OPPORTUNITY.test(title)) return 'opportunity'
  return 'news'
}

// The same story reaches us through several feeds, with different tracking parameters.
const canonical = (link: string) => link.replace(/[?#].*$/, '').replace(/\/$/, '')

async function readFeed(feed: (typeof FEEDS)[number]): Promise<NewsItem[]> {
  const res = await fetch(feed.url, {
    headers: { 'User-Agent': 'SunnyBot/1.0 (+https://sunny.aivylabs.xyz)' },
    signal: globalThis.AbortSignal.timeout(12_000),
  })
  if (!res.ok) throw new Error(`${feed.source} ${res.status}`)
  const xml = await res.text()
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].flatMap(([raw]) => {
    const title = tag(raw, 'title')
    const link = tag(raw, 'link') || tag(raw, 'guid')
    const at = Date.parse(tag(raw, 'pubDate'))
    if (!title || !/^https?:\/\//.test(link) || !Number.isFinite(at)) return []
    const description = tag(raw, 'description').slice(0, 500)
    const text = `${title} ${description}`
    return [
      {
        id: canonical(link),
        title,
        link: canonical(link),
        source: feed.source,
        at: new Date(at).toISOString(),
        kind: classify(title, description),
        // "SOL" is matched case-sensitively, so the word "sol" in other contexts doesn't count.
        solana: Boolean(feed.solana) || SOLANA.test(text) || /\bSOL\b/.test(title),
      },
    ]
  })
}

type Hack = { name: string; date: number; amount?: number | null; chain?: string[]; technique?: string; classification?: string; source?: string }

const usdShort = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`

async function readHacks(): Promise<NewsItem[]> {
  const res = await fetch(HACKS, { signal: globalThis.AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`DeFiLlama ${res.status}`)
  const since = Date.now() - KEEP_HACKS_MS
  return ((await res.json()) as Hack[])
    .filter((h) => h.date * 1000 >= since)
    .map((h) => ({
      id: `defillama:${h.name}:${h.date}`,
      title: `${h.name}${h.amount ? ` lost ${usdShort(h.amount)}` : ' was hacked'} (${h.technique || h.classification || 'exploit'})`,
      link: /^https?:\/\//.test(h.source ?? '') ? h.source! : 'https://defillama.com/hacks',
      source: 'DeFiLlama',
      at: new Date(h.date * 1000).toISOString(),
      kind: 'security' as const,
      solana: (h.chain ?? []).includes('Solana'),
      amountUsd: h.amount ?? undefined,
    }))
}

async function refresh(notify?: (item: NewsItem) => Promise<void>) {
  const results = await Promise.allSettled([...FEEDS.map(readFeed), readHacks()])
  for (const r of results) if (r.status === 'rejected') console.warn('[sunny] news source failed:', String(r.reason))
  const fresh = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  if (!fresh.length) return
  const keepFrom = Date.now() - KEEP_NEWS_MS
  const byKey = new Map<string, NewsItem>()
  for (const it of fresh) {
    if (it.source !== 'DeFiLlama' && Date.parse(it.at) < keepFrom) continue
    // The same story in two feeds (general and Solana-tagged) is kept once, with the Solana flag.
    const key = it.title.toLowerCase()
    const seen = byKey.get(key)
    byKey.set(key, seen ? { ...seen, solana: seen.solana || it.solana } : it)
  }
  const byId = new Map([...byKey.values()].map((it) => [it.id, it]))
  items = [...byId.values()].sort((a, b) => b.at.localeCompare(a.at))

  const due = items.filter(
    (it) => it.kind === 'security' && it.solana && !alerted.has(it.id) && Date.now() - Date.parse(it.at) < ALERT_WITHIN_MS,
  )
  if (firstRun) {
    for (const it of items) if (it.kind === 'security') alerted.add(it.id)
    firstRun = false
  } else {
    for (const it of due.slice(0, MAX_ALERTS_PER_RUN)) {
      alerted.add(it.id)
      await notify?.(it).catch((err) => console.error('[sunny] news alert failed', err))
    }
    // Anything beyond the cap is still marked, so a burst doesn't trickle out for hours.
    for (const it of due) alerted.add(it.id)
  }
  save()
  console.log(`[sunny] news: ${items.length} items, ${items.filter((i) => i.solana).length} about Solana`)
}

/** "3h ago", "2d ago": short enough for a chat message. */
export function ago(iso: string) {
  const min = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  if (min < 60) return `${min} min ago`
  if (min < 48 * 60) return `${Math.round(min / 60)}h ago`
  return `${Math.round(min / 1440)}d ago`
}

export const KIND_ICON: Record<NewsKind, string> = { security: '🚨', opportunity: '✨', news: '📰' }

/** Reads the feeds now and every 15 minutes. `notify` gets each new Solana security alert. */
export function startNews(notify?: (item: NewsItem) => Promise<void>) {
  load()
  const run = () => refresh(notify).catch((err) => console.error('[sunny] news refresh failed', err))
  void run()
  setInterval(run, REFRESH_MS).unref()
}

/** The latest items, Solana first: security alerts lead, then opportunities and news. */
export function latestNews(focus: 'all' | NewsKind = 'all', limit = 8): NewsItem[] {
  const pool = items.filter((it) => focus === 'all' || it.kind === focus)
  const solana = pool.filter((it) => it.solana)
  const urgent = solana.filter((it) => it.kind === 'security' && Date.now() - Date.parse(it.at) < 3 * 86_400_000)
  const picked = [...urgent, ...solana.filter((it) => !urgent.includes(it))].slice(0, limit)
  // Too little Solana news: fill with general security stories, which affect everyone.
  if (picked.length < limit) {
    picked.push(...pool.filter((it) => !it.solana && it.kind === 'security').slice(0, limit - picked.length))
  }
  return picked
}
