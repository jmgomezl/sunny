import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { currentPrices } from './market.js'
import { logActivity } from './users.js'

// Price alerts ("watch BONK for a 10% drop"), saved to disk so they survive restarts,
// checked every minute against live Jupiter prices. When one triggers, Sunny messages
// the user in Telegram, even if the app is closed.

const DATA_DIR = process.env.SUNNY_DATA_DIR || join(process.cwd(), 'data')
const FILE = join(DATA_DIR, 'alerts.json')
const CHECK_EVERY_MS = 60_000
const MAX_ACTIVE_PER_USER = 10

export type Alert = {
  id: string
  userId: number
  lang: string
  mint: string
  symbol: string
  direction: 'drop' | 'rise'
  /** Percent move from basePrice, or an absolute target price. */
  percent: number | null
  targetPrice: number | null
  basePrice: number
  createdAt: string
  triggeredAt: string | null
  triggeredPrice: number | null
}

let alerts: Alert[] = []

function save() {
  mkdirSync(DATA_DIR, { recursive: true })
  const tmp = `${FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(alerts, null, 1))
  renameSync(tmp, FILE)
}

function loadAlerts() {
  try {
    alerts = JSON.parse(readFileSync(FILE, 'utf8')) as Alert[]
  } catch {
    alerts = []
  }
}

/** The price at which an alert fires. */
export function triggerPrice(a: Alert) {
  if (a.targetPrice !== null) return a.targetPrice
  const p = (a.percent ?? 0) / 100
  return a.direction === 'drop' ? a.basePrice * (1 - p) : a.basePrice * (1 + p)
}

export const activeFor = (userId: number) => alerts.filter((a) => a.userId === userId && !a.triggeredAt)

export function createAlert(input: Omit<Alert, 'id' | 'createdAt' | 'triggeredAt' | 'triggeredPrice'>): Alert | { error: string } {
  if (input.userId <= 0) return { error: 'Price alerts need Telegram so I can message you. Open me from @SunnySolBot.' }
  if (activeFor(input.userId).length >= MAX_ACTIVE_PER_USER) {
    return { error: `You already have ${MAX_ACTIVE_PER_USER} alerts. Cancel one first.` }
  }
  const alert: Alert = {
    ...input,
    id: Math.random().toString(36).slice(2, 8),
    createdAt: new Date().toISOString(),
    triggeredAt: null,
    triggeredPrice: null,
  }
  alerts.push(alert)
  save()
  return alert
}

export function cancelAlerts(userId: number, match: string) {
  const m = match.trim().replace(/^\$/, '').toLowerCase()
  const doomed = activeFor(userId).filter((a) => m === 'all' || a.id === m || a.symbol.toLowerCase() === m)
  alerts = alerts.filter((a) => !doomed.includes(a))
  if (doomed.length) save()
  return doomed
}

function fmt(n: number) {
  return n >= 1 ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : `$${n.toPrecision(3)}`
}

function message(a: Alert, price: number) {
  // The verb already says the direction ("dropped", "subió"), so show the size of the move.
  const moved = `${Math.abs(((price - a.basePrice) / a.basePrice) * 100).toFixed(1)}%`
  if (a.lang.startsWith('es')) {
    return a.direction === 'drop'
      ? `☀️ ¡Aviso! ${a.symbol} bajó ${moved} desde que me pediste vigilarlo: de ${fmt(a.basePrice)} a ${fmt(price)}. Respira, revisa la situación y no tomes decisiones con prisa.`
      : `☀️ ¡Aviso! ${a.symbol} subió ${moved} desde que me pediste vigilarlo: de ${fmt(a.basePrice)} a ${fmt(price)}.`
  }
  return a.direction === 'drop'
    ? `☀️ Heads up! ${a.symbol} dropped ${moved} since you asked me to watch it: from ${fmt(a.basePrice)} to ${fmt(price)}. Take a breath and review calmly; no rush decisions.`
    : `☀️ Heads up! ${a.symbol} is up ${moved} since you asked me to watch it: from ${fmt(a.basePrice)} to ${fmt(price)}.`
}

/** Loads saved alerts and checks them every minute, notifying through `notify`. */
export function startAlertChecker(notify: (userId: number, text: string) => Promise<unknown>) {
  loadAlerts()
  console.log(`[sunny] ${alerts.filter((a) => !a.triggeredAt).length} active price alerts loaded`)

  const check = async () => {
    const active = alerts.filter((a) => !a.triggeredAt)
    if (!active.length) return
    const prices = await currentPrices([...new Set(active.map((a) => a.mint))])
    let changed = false
    for (const a of active) {
      const price = prices[a.mint]
      if (!price) continue
      const target = triggerPrice(a)
      const hit = a.direction === 'drop' ? price <= target : price >= target
      if (!hit) continue
      a.triggeredAt = new Date().toISOString()
      a.triggeredPrice = price
      changed = true
      // Also in the activity feed (and the Mini App's "While you slept" card).
      logActivity(a.userId, 'alert', `Your ${a.symbol} alert fired`, `${a.direction === 'drop' ? 'Dropped' : 'Rose'} to ${fmt(price)}`)
      await notify(a.userId, message(a, price)).catch((err) => console.error('[sunny] alert notify failed', err))
    }
    if (changed) save()
  }

  setInterval(() => check().catch((err) => console.error('[sunny] alert check failed', err)), CHECK_EVERY_MS).unref()
}
