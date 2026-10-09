import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { seen } from './stats.js'

// Per-person state: the wallets Sunny watches for them and a short log of what Sunny did.
// Telegram users have positive ids; web-preview guests have negative ids.

const DATA_DIR = process.env.SUNNY_DATA_DIR || join(process.cwd(), 'data')
const FILE = join(DATA_DIR, 'users.json')
const MAX_ACTIVITY = 20
const MAX_USERS = 5000
export const MAX_WATCHED = 5

export type ActivityKind = 'check' | 'scam' | 'alert' | 'wallet' | 'watch'
export type Habit = 'keyBackup' | 'scamCaught' | 'deepScan'
export type ActivityItem = { kind: ActivityKind; text: string; meta: string; at: string }
type UserState = {
  /** Wallets Sunny watches, read-only. Their own Sunny wallet lives in vaults.ts. */
  wallets: string[]
  activity: ActivityItem[]
  seenAt: string
  /** Security alerts from the news desk; on unless the person turns them off. */
  newsAlerts?: boolean
  /** First name and language from Telegram, for the morning greeting. */
  name?: string
  lang?: string
  /** Consecutive days with a visit (chat or Mini App), counted in UTC days. */
  streak?: { days: number; lastDay: string }
  /** The good-morning note; on unless the person turns it off. */
  morning?: boolean
  /** UTC day of the last morning note, so it goes out once a day. */
  briefDay?: string
  /** Good habits Sunny noticed (backed up the key, a scam caught, a deep scan bought). */
  flags?: Partial<Record<Habit, true>>
  /** Badges already minted to the person's Sunny wallet, with their transaction. */
  badges?: Record<string, { tx: string; at: string }>
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
      // Web-preview guests (negative ids above the wallet sign-in range) go first, oldest first.
      const guest = (id: string) => Number(id) < 0 && Number(id) > -(2 ** 50)
      ids
        .sort((a, b) => Number(guest(b)) - Number(guest(a)) || users[a].seenAt.localeCompare(users[b].seenAt))
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
  return u
}

const utcDay = (d = new Date()) => d.toISOString().slice(0, 10)

/**
 * A real visit: the person chatted with Sunny or opened the Mini App. Only visits count as
 * activity and build the streak; background work (alerts, briefs) never does.
 */
export function touch(id: number, name?: string, lang?: string) {
  seen(id)
  const u = get(id)
  const today = utcDay()
  const yesterday = utcDay(new Date(Date.now() - 86_400_000))
  u.seenAt = new Date().toISOString()
  if (name) u.name = name.slice(0, 40)
  if (lang) u.lang = lang.slice(0, 8)
  if (u.streak?.lastDay !== today) {
    u.streak = { days: u.streak?.lastDay === yesterday ? u.streak.days + 1 : 1, lastDay: today }
  }
  scheduleSave()
}

/** Days in a row with a visit; still alive if the last visit was today or yesterday. */
export function streakOf(id: number) {
  return streakInfo(id).days
}

export function streakInfo(id: number) {
  const s = get(id).streak
  if (s?.lastDay === utcDay()) return { days: s.days, visitedToday: true }
  if (s?.lastDay === utcDay(new Date(Date.now() - 86_400_000))) return { days: s.days, visitedToday: false }
  return { days: 0, visitedToday: false }
}

export function setMorning(id: number, on: boolean) {
  get(id).morning = on
  scheduleSave()
}

/** Telegram people active in the last 14 days who haven't had today's note and haven't opted out. */
export function morningSubscribers(day: string) {
  load()
  const since = Date.now() - 14 * 86_400_000
  return Object.entries(users)
    .filter(([id, u]) => Number(id) > 0 && u.morning !== false && u.briefDay !== day && Date.parse(u.seenAt) >= since)
    .map(([id, u]) => ({ id: Number(id), name: u.name, lang: u.lang }))
}

export function markBriefSent(id: number, day: string) {
  get(id).briefDay = day
  scheduleSave()
}

export const watchedOf = (id: number) => get(id).wallets

// Word joiners keep "9AhK…sbkw" on one line wherever it wraps.
const short = (a: string) => `${a.slice(0, 4)}\u2060…\u2060${a.slice(-4)}`

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

export function noteHabit(id: number, habit: Habit) {
  const u = get(id)
  if (u.flags?.[habit]) return
  u.flags = { ...u.flags, [habit]: true }
  scheduleSave()
}

export const habitsOf = (id: number) => get(id).flags ?? {}
export const badgesOf = (id: number) => get(id).badges ?? {}

export function recordBadge(id: number, badge: string, tx: string) {
  const u = get(id)
  u.badges = { ...u.badges, [badge]: { tx, at: new Date().toISOString() } }
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
    return Object.entries(users)
    .filter(([id, u]) => Number(id) > 0 && u.newsAlerts !== false && Date.parse(u.seenAt) >= since)
    .map(([id]) => Number(id))
}

export function logActivity(id: number, kind: ActivityKind, text: string, meta: string) {
  const u = get(id)
  const at = new Date().toISOString()
  // The same thing again right after (checking a wallet three times) is one entry, freshened.
  const last = u.activity[0]
  if (last && last.kind === kind && last.text === text && Date.now() - Date.parse(last.at) < 30 * 60_000) {
    u.activity[0] = { ...last, meta, at }
  } else {
    u.activity = [{ kind, text, meta, at }, ...u.activity].slice(0, MAX_ACTIVITY)
  }
  scheduleSave()
}

export const activityOf = (id: number) => get(id).activity
