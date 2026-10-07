import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Per-person state: the wallets Sunny watches for them and a short log of what Sunny did.
// Telegram users have positive ids; web-preview guests have negative ids.

const DATA_DIR = process.env.SUNNY_DATA_DIR || join(process.cwd(), 'data')
const FILE = join(DATA_DIR, 'users.json')
const MAX_ACTIVITY = 20
const MAX_USERS = 5000
export const MAX_WATCHED = 5

export type ActivityKind = 'check' | 'scam' | 'alert' | 'wallet' | 'watch'
export type ActivityItem = { kind: ActivityKind; text: string; meta: string; at: string }
type UserState = {
  /** Wallets Sunny watches, read-only. Their own Sunny wallet lives in vaults.ts. */
  wallets: string[]
  activity: ActivityItem[]
  seenAt: string
  /** Security alerts from the news desk; on unless the person turns them off. */
  newsAlerts?: boolean
  /** Before multiple watched wallets there was just one; migrated on first read. */
  wallet?: string | null
  linkedAt?: string | null
}

let users: Record<string, UserState> = {}
let loaded = false
let saveTimer: NodeJS.Timeout | undefined

function load() {
  if (loaded) return
  loaded = true
  try {
    users = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, UserState>
  } catch {
    users = {}
  }
}

// Writes are batched so a burst of chat activity doesn't hit the disk on every message.
function scheduleSave() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    const ids = Object.keys(users)
    if (ids.length > MAX_USERS) {
      ids
        .sort((a, b) => users[a].seenAt.localeCompare(users[b].seenAt))
        .slice(0, ids.length - MAX_USERS)
        .forEach((id) => delete users[id])
    }
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(`${FILE}.tmp`, JSON.stringify(users))
    renameSync(`${FILE}.tmp`, FILE)
  }, 2000)
}

function get(id: number): UserState {
  load()
  const key = String(id)
  const u = (users[key] ??= { wallets: [], activity: [], seenAt: new Date().toISOString() })
  if (!u.wallets) {
    u.wallets = u.wallet ? [u.wallet] : []
    delete u.wallet
    delete u.linkedAt
  }
  u.seenAt = new Date().toISOString()
  return u
}

export const watchedOf = (id: number) => get(id).wallets

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`

/** Adds a wallet for Sunny to watch (newest first) and notes it in the activity log. */
export function watchWallet(id: number, address: string): 'added' | 'already' | 'full' {
  const u = get(id)
  if (u.wallets.includes(address)) return 'already'
  if (u.wallets.length >= MAX_WATCHED) return 'full'
  u.wallets = [address, ...u.wallets]
  logActivity(id, 'wallet', `Watching wallet ${short(address)}`, 'Read-only, I’ll keep an eye on it')
  return 'added'
}

export function unwatchWallet(id: number, address: string) {
  const u = get(id)
  if (!u.wallets.includes(address)) return false
  u.wallets = u.wallets.filter((w) => w !== address)
  logActivity(id, 'wallet', `Stopped watching ${short(address)}`, 'It’s off my list')
  return true
}

export function unwatchAll(id: number) {
  get(id).wallets = []
  scheduleSave()
}

export const newsAlertsOn = (id: number) => get(id).newsAlerts !== false

export function setNewsAlerts(id: number, on: boolean) {
  get(id).newsAlerts = on
  scheduleSave()
}

/** Telegram people (positive ids) active in the last 30 days who haven't turned news alerts off. */
export function newsSubscribers() {
  load()
  const since = Date.now() - 30 * 86_400_000
  // Read directly: get() would mark everyone as just seen.
  return Object.entries(users)
    .filter(([id, u]) => Number(id) > 0 && u.newsAlerts !== false && Date.parse(u.seenAt) >= since)
    .map(([id]) => Number(id))
}

export function logActivity(id: number, kind: ActivityKind, text: string, meta: string) {
  const u = get(id)
  u.activity = [{ kind, text, meta, at: new Date().toISOString() }, ...u.activity].slice(0, MAX_ACTIVITY)
  scheduleSave()
}

export const activityOf = (id: number) => get(id).activity
