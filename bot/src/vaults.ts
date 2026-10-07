import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Server backup of each person's *encrypted* Sunny wallet (OculusVault-style).
// Keyed by the verified Telegram user id. It holds ciphertext only: without the
// person's password this server can't open it.

const DATA_DIR = process.env.SUNNY_DATA_DIR || join(process.cwd(), 'data')
const FILE = join(DATA_DIR, 'vaults.json')

type Record = { version: 1; address: string; kdf: object; nonce: string; ciphertext: string; createdAt: string }

let vaults: { [userId: string]: Record } | null = null

function all() {
  if (vaults) return vaults
  try {
    vaults = JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    vaults = {}
  }
  return vaults!
}

/** Accepts only records that look encrypted: no field may carry a raw key. */
export function validRecord(r: unknown): r is Record {
  if (!r || typeof r !== 'object') return false
  const x = r as { [k: string]: unknown }
  const b64url = /^[A-Za-z0-9_-]+$/
  return (
    x.version === 1 &&
    typeof x.address === 'string' &&
    /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x.address) &&
    typeof x.nonce === 'string' &&
    b64url.test(x.nonce) &&
    typeof x.ciphertext === 'string' &&
    b64url.test(x.ciphertext) &&
    x.ciphertext.length >= 40 &&
    x.ciphertext.length <= 200 &&
    typeof x.kdf === 'object' &&
    JSON.stringify(r).length < 2048
  )
}

export const vaultOf = (userId: number) => all()[String(userId)] ?? null

export function saveVault(userId: number, record: Record) {
  all()[String(userId)] = record
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(`${FILE}.tmp`, JSON.stringify(vaults))
  renameSync(`${FILE}.tmp`, FILE)
}
