import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { explorerTx, refundChain, type SignedRefund } from './solana.js'
import { logActivity } from './users.js'

// Money Sunny may owe a pocket. A purchase is written down before any money moves ('held'), so
// a crash at any point leaves a record to settle from. If what Sunny paid for doesn't arrive,
// the refund is owed ('pending'), and every refund transaction is saved before it's sent: a
// retry first asks the chain what happened to it and resends those same bytes while they can
// still land, so an answer that got lost can never turn into a second refund. If one never
// lands, the person sees that in "What Sunny did" instead of waiting on a promise.

const DATA_DIR = process.env.SUNNY_DATA_DIR || join(process.cwd(), 'data')
const FILE = join(DATA_DIR, 'refunds.json')
// After the first try: half a minute, then doubling. About two hours of tries in all.
const PAUSES_MS = [30_000, 60_000, 120_000, 240_000, 480_000, 900_000, 1_800_000, 3_600_000]
// A purchase takes seconds. One still held after this was cut off by a restart.
const STUCK_MS = 10 * 60_000

export type Refund = {
  id: string
  owner: string
  userId: number
  amount: number
  reason: string
  createdAt: string
  attempts: number
  nextAt: number
  // held: a purchase is under way, its money maybe in Sunny's spending wallet. pending: a refund
  // is owed. settled: the purchase went through. void: no money left the pocket.
  status: 'held' | 'pending' | 'done' | 'failed' | 'settled' | 'void'
  draw?: { signature: string; validUntil: number }
  sent?: SignedRefund
  tx?: string
  error?: string
}

export type RefundChain = Pick<typeof refundChain, 'build' | 'submit' | 'status' | 'expired' | 'spendable'>

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
  // Open ones are always kept; finished ones for a week, as a record.
  const week = Date.now() - 7 * 86_400_000
  refunds = load().filter((r) => r.status === 'pending' || r.status === 'held' || Date.parse(r.createdAt) > week)
  writeFileSync(`${FILE}.tmp`, JSON.stringify(refunds))
  renameSync(`${FILE}.tmp`, FILE)
}

/** Written to disk before Sunny draws money for a purchase. */
export function holdPurchase(owner: string, userId: number, amount: number, reason: string): Refund {
  const r: Refund = {
    id: randomUUID(),
    owner,
    userId,
    amount,
    reason,
    createdAt: new Date().toISOString(),
    attempts: 0,
    nextAt: 0,
    status: 'held',
  }
  load().push(r)
  save()
  return r
}

/** The draw's signature, saved before the draw is sent, so a restart can ask the chain about it. */
export function noteDraw(r: Refund, signature: string, validUntil: number) {
  r.draw = { signature, validUntil }
  save()
}

/** The purchase is over: it went through ('settled'), or no money moved ('void'). */
export function releasePurchase(r: Refund, outcome: 'settled' | 'void') {
  r.status = outcome
  save()
}

/** What Sunny paid for didn't arrive: the pocket is owed this money back. */
export function owe(r: Refund) {
  r.status = 'pending'
  r.nextAt = 0
  save()
}

const usd = (n: number) => `$${n.toFixed(2)}`
const busy = new Set<string>()

/** One try at a refund. Never builds a second transaction while the first one could still land. */
async function tryRefund(r: Refund, chain: RefundChain): Promise<boolean> {
  if (busy.has(r.id) || r.status !== 'pending') return false
  busy.add(r.id)
  r.attempts++
  try {
    if (r.sent) {
      const was = await chain.status(r.sent.signature)
      if (was === 'landed') return finished(r)
      if (was === 'unknown' && !(await chain.expired(r.sent.validUntil))) {
        await chain.submit(r.sent)
        return finished(r)
      }
      // It failed, or it expired without landing: now a new one is safe.
    }
    r.sent = await chain.build(r.owner, r.amount)
    save()
    await chain.submit(r.sent)
    return finished(r)
  } catch (err) {
    r.error = (err instanceof Error ? err.message : String(err)).slice(0, 160)
    if (r.attempts > PAUSES_MS.length) {
      r.status = 'failed'
      logActivity(r.userId, 'wallet', `A ${usd(r.amount)} refund didn’t go through`, 'It’s still in Sunny’s spending wallet. Ask Sunny about it')
      console.warn('[sunny] refund failed for good', r.owner, r.error)
    } else {
      r.nextAt = Date.now() + PAUSES_MS[r.attempts - 1]
    }
    return false
  } finally {
    save()
    busy.delete(r.id)
  }
}

function finished(r: Refund) {
  r.status = 'done'
  r.tx = explorerTx(r.sent!.signature)
  logActivity(r.userId, 'wallet', `Refunded ${usd(r.amount)} to your pocket`, r.reason)
  return true
}

/** Tries a refund right away. Returns its transaction link, or null if it's left to the retries. */
export async function refundNow(r: Refund, chain: RefundChain = refundChain): Promise<string | null> {
  return (await tryRefund(r, chain)) ? r.tx! : null
}

/** A purchase cut off by a restart: the chain says whether money moved, and if it was spent. */
async function recover(r: Refund, chain: RefundChain) {
  if (!r.draw) return releasePurchase(r, 'void')
  const drawn = await chain.status(r.draw.signature)
  if (drawn === 'failed') return releasePurchase(r, 'void')
  if (drawn === 'unknown') {
    if (await chain.expired(r.draw.validUntil)) releasePurchase(r, 'void')
    return
  }
  // The draw landed. If the money is still in Sunny's spending wallet, put it back. That wallet
  // is this owner's alone, so even if the scan did get paid, a refund only moves their own money
  // back into their own pocket; nobody can be paid twice. If the balance can't be read, this
  // throws and the purchase stays held for the next pass: unknown is never taken as empty.
  if ((await chain.spendable(r.owner)) >= r.amount) return owe(r)
  console.warn('[sunny] a purchase was paid but its answer was lost in a restart', r.owner, r.draw.signature)
  releasePurchase(r, 'settled')
}

let running = false

/** Settles purchases a restart cut off, then tries every refund that's due. */
export async function processRefunds(chain: RefundChain = refundChain) {
  if (running) return
  running = true
  try {
    for (const r of load().filter((x) => x.status === 'held' && Date.now() - Date.parse(x.createdAt) > STUCK_MS)) {
      await recover(r, chain).catch((err) => console.warn('[sunny] couldn’t check a held purchase yet', r.id, err))
    }
    for (const r of load().filter((x) => x.status === 'pending' && x.nextAt <= Date.now())) await tryRefund(r, chain)
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

/** Every record, for tests and anyone checking the books. */
export const allRefunds = () => load()
