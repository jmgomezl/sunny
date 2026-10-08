import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { refundToPocket } from './solana.js'
import { logActivity } from './users.js'

// Refunds Sunny owes a pocket: it drew money for a paid scan that never came back. They're kept
// on disk so a restart can't lose them, retried with growing pauses until they land, and if one
// never does, the person sees that in "What Sunny did" instead of waiting on a promise.

const DATA_DIR = process.env.SUNNY_DATA_DIR || join(process.cwd(), 'data')
const FILE = join(DATA_DIR, 'refunds.json')
// Half a minute, then doubling: about two hours of tries in all.
const PAUSES_MS = [30_000, 60_000, 120_000, 240_000, 480_000, 900_000, 1_800_000, 3_600_000]

export type Refund = {
  id: string
  owner: string
  userId: number
  amount: number
  reason: string
  createdAt: string
  attempts: number
  nextAt: number
  status: 'pending' | 'done' | 'failed'
  tx?: string
  error?: string
}

let refunds: Refund[] | null = null

function load(): Refund[] {
  if (refunds) return refunds
  try {
    refunds = JSON.parse(readFileSync(FILE, 'utf8')) as Refund[]
  } catch {
    refunds = []
  }
  return refunds
}

function save() {
  mkdirSync(DATA_DIR, { recursive: true })
  // Finished ones are kept a week, as a record.
  const week = Date.now() - 7 * 86_400_000
  refunds = load().filter((r) => r.status === 'pending' || Date.parse(r.createdAt) > week)
  writeFileSync(`${FILE}.tmp`, JSON.stringify(refunds))
  renameSync(`${FILE}.tmp`, FILE)
}

/** Records a refund Sunny owes, written to disk before anything else happens. */
export function queueRefund(owner: string, userId: number, amount: number, reason: string): Refund {
  const r: Refund = {
    id: randomUUID(),
    owner,
    userId,
    amount,
    reason,
    createdAt: new Date().toISOString(),
    attempts: 0,
    nextAt: Date.now() + PAUSES_MS[0],
    status: 'pending',
  }
  load().push(r)
  save()
  return r
}

const usd = (n: number) => `$${n.toFixed(2)}`
let running = false

/** Tries every refund that's due. `send` is the transfer (replaced in tests). */
export async function processRefunds(send: (owner: string, amount: number) => Promise<{ explorer: string }> = refundToPocket) {
  if (running) return
  running = true
  try {
    for (const r of load().filter((x) => x.status === 'pending' && x.nextAt <= Date.now())) {
      r.attempts++
      try {
        const sent = await send(r.owner, r.amount)
        r.status = 'done'
        r.tx = sent.explorer
        logActivity(r.userId, 'wallet', `Refunded ${usd(r.amount)} to your pocket`, r.reason)
      } catch (err) {
        r.error = (err instanceof Error ? err.message : String(err)).slice(0, 160)
        if (r.attempts >= PAUSES_MS.length) {
          r.status = 'failed'
          logActivity(r.userId, 'wallet', `A ${usd(r.amount)} refund didn’t go through`, 'It’s still in Sunny’s spending wallet. Ask Sunny about it')
          console.warn('[sunny] refund failed for good', r.owner, r.error)
        } else {
          r.nextAt = Date.now() + PAUSES_MS[r.attempts]
        }
      }
      save()
    }
  } finally {
    running = false
  }
}

/** Picks up refunds left from before a restart, then checks once a minute. */
export function startRefunds() {
  void processRefunds()
  setInterval(() => void processRefunds(), 60_000).unref()
}

/** Refunds still on their way, for anyone who asks. */
export const pendingRefunds = () => load().filter((r) => r.status === 'pending')
