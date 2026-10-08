import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connection, POCKET_PROGRAM } from './solana.js'
import { groupStats } from './groups.js'

// Sunny's public numbers (sunny.aivylabs.xyz/stats): what it checked and caught, who uses it,
// and what its pocket program did on-chain. Honest by construction: counting starts when this
// shipped, test identities are left out, and the on-chain part is read from Solana itself.

const DATA_DIR = process.env.SUNNY_DATA_DIR || join(process.cwd(), 'data')
const FILE = join(DATA_DIR, 'stats.json')

export type Event =
  | 'linksChecked'
  | 'scamsFlagged'
  | 'tokensChecked'
  | 'walletsChecked'
  | 'blinksChecked'
  | 'drainersFlagged'
  | 'drawsApproved'
  | 'drawsRefused'
  | 'deepScans'

type Kind = 'telegram' | 'wallet' | 'guest'
type Stored = { since: string; events: Partial<Record<Event, number>>; people: Record<Kind, string[]> }

let stats: Stored | null = null
let saveTimer: NodeJS.Timeout | undefined

/** The Telegram ids the end-to-end script and the AI testers use: never counted. */
export const isTestUser = (id: number) => id >= 990_000_000 && id < 992_000_000

const kindOf = (id: number): Kind => (id > 0 ? 'telegram' : id <= -(2 ** 50) ? 'wallet' : 'guest')

function load(): Stored {
  if (stats) return stats
  try {
    stats = JSON.parse(readFileSync(FILE, 'utf8')) as Stored
  } catch {
    stats = { since: new Date().toISOString(), events: {}, people: { telegram: [], wallet: [], guest: [] } }
  }
  return stats
}

function scheduleSave() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(`${FILE}.tmp`, JSON.stringify(stats))
    renameSync(`${FILE}.tmp`, FILE)
  }, 3000)
  saveTimer.unref()
}

/** Counts something Sunny did for a person (never for a test identity). */
export function count(event: Event, userId?: number) {
  if (userId !== undefined && isTestUser(userId)) return
  const s = load()
  s.events[event] = (s.events[event] ?? 0) + 1
  scheduleSave()
}

/** Notes that a person used Sunny (Telegram, a signed-in wallet, or a web-preview guest). */
export function seen(userId: number) {
  if (isTestUser(userId)) return
  const s = load()
  const list = s.people[kindOf(userId)]
  const key = String(userId)
  if (list.includes(key)) return
  list.push(key)
  scheduleSave()
}

// The program's own record, read from devnet at most every ten minutes.
let chain: { at: number; value: Promise<OnChain | null> } | null = null
type OnChain = { pockets: number; transactions: number; failed: number; complete: boolean }

async function readChain(): Promise<OnChain | null> {
  try {
    const accounts = await connection.getProgramAccounts(POCKET_PROGRAM, { dataSlice: { offset: 0, length: 0 } })
    let before: string | undefined
    let transactions = 0
    let failed = 0
    let complete = false
    for (let page = 0; page < 5; page++) {
      const sigs = await connection.getSignaturesForAddress(POCKET_PROGRAM, { limit: 1000, before })
      transactions += sigs.length
      failed += sigs.filter((s) => s.err).length
      if (sigs.length < 1000) {
        complete = true
        break
      }
      before = sigs.at(-1)?.signature
    }
    return { pockets: accounts.length, transactions, failed, complete }
  } catch (err) {
    console.warn('[sunny] stats: chain read failed', String(err))
    return null
  }
}

function onChain() {
  if (!chain || Date.now() - chain.at > 10 * 60_000) chain = { at: Date.now(), value: readChain() }
  return chain.value
}

/** Everything the stats page shows. */
export async function snapshot() {
  const s = load()
  const groups = groupStats()
  return {
    since: s.since,
    people: { telegram: s.people.telegram.length, wallets: s.people.wallet.length, webGuests: s.people.guest.length },
    groups: { guarded: groups.groups, members: groups.members, warnings: groups.warnings, checks: groups.checks },
    checks: {
      links: s.events.linksChecked ?? 0,
      tokens: s.events.tokensChecked ?? 0,
      wallets: s.events.walletsChecked ?? 0,
      blinks: s.events.blinksChecked ?? 0,
    },
    caught: { scamLinks: s.events.scamsFlagged ?? 0, drainerBlinks: s.events.drainersFlagged ?? 0 },
    pocket: {
      approved: s.events.drawsApproved ?? 0,
      refused: s.events.drawsRefused ?? 0,
      deepScans: s.events.deepScans ?? 0,
    },
    onChain: await onChain(),
    updatedAt: new Date().toISOString(),
  }
}
