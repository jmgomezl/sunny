import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Per-person state: the wallet they linked and a short log of what Sunny did for them.
// Telegram users have positive ids; web-preview guests have negative ids.

const DATA_DIR = process.env.SUNNY_DATA_DIR || join(process.cwd(), 'data')
const FILE = join(DATA_DIR, 'users.json')
const MAX_ACTIVITY = 20
const MAX_USERS = 5000

export type ActivityKind = 'check' | 'scam' | 'alert' | 'wallet' | 'watch'
export type ActivityItem = { kind: ActivityKind; text: string; meta: string; at: string }
type UserState = { wallet: string | null; linkedAt: string | null; activity: ActivityItem[]; seenAt: string }

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
  users[key] ??= { wallet: null, linkedAt: null, activity: [], seenAt: new Date().toISOString() }
  users[key].seenAt = new Date().toISOString()
  return users[key]
}

export const walletOf = (id: number) => get(id).wallet

export function setWallet(id: number, wallet: string | null) {
  const u = get(id)
  u.wallet = wallet
  u.linkedAt = wallet ? new Date().toISOString() : null
  scheduleSave()
}

export function logActivity(id: number, kind: ActivityKind, text: string, meta: string) {
  const u = get(id)
  u.activity = [{ kind, text, meta, at: new Date().toISOString() }, ...u.activity].slice(0, MAX_ACTIVITY)
  scheduleSave()
}

export const activityOf = (id: number) => get(id).activity
