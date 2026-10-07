import { argon2id } from 'hash-wasm'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { randomBytes } from '@noble/ciphers/utils.js'
import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { base58, base64urlnopad } from '@scure/base'
import { post } from './api'

// Sunny wallet: a self-custodial Solana key that lives inside Telegram.
// Same design as OculusVault: the key is generated on this device, wrapped with
// Argon2id(password) + XChaCha20-Poly1305, and only the ciphertext is stored, in
// Telegram CloudStorage and as a server backup keyed by the verified Telegram id.
// The server never sees the key or the password, so it can't open the wallet.

export type VaultRecord = {
  version: 1
  /** Public Solana address (safe to store in the clear). */
  address: string
  kdf: { algorithm: 'argon2id'; salt: string; iterations: number; memorySize: number; parallelism: number; hashLength: number }
  nonce: string
  ciphertext: string
  createdAt: string
}

const KDF = { algorithm: 'argon2id' as const, iterations: 3, memorySize: 65536, parallelism: 1, hashLength: 32 }
const CLOUD_KEY = 'sunny_wallet_v1'
export const MIN_PASSWORD = 8
const LOCK_AFTER_MS = 10 * 60_000

async function wrappingKey(password: string, kdf: VaultRecord['kdf']) {
  return argon2id({
    password: new TextEncoder().encode(password),
    salt: base64urlnopad.decode(kdf.salt),
    parallelism: kdf.parallelism,
    iterations: kdf.iterations,
    memorySize: kdf.memorySize,
    hashLength: kdf.hashLength,
    outputType: 'binary',
  })
}

/** Creates a new key on this device and returns it with its encrypted record. */
export async function createWallet(password: string) {
  if (password.length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters.`)
  const seed = randomBytes(32)
  const address = base58.encode(ed25519.getPublicKey(seed))
  const kdf = { ...KDF, salt: base64urlnopad.encode(randomBytes(16)) }
  const key = await wrappingKey(password, kdf)
  const nonce = randomBytes(24)
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(seed)
  key.fill(0)
  const record: VaultRecord = {
    version: 1,
    address,
    kdf,
    nonce: base64urlnopad.encode(nonce),
    ciphertext: base64urlnopad.encode(ciphertext),
    createdAt: new Date().toISOString(),
  }
  return { record, seed }
}

/** Decrypts the key; a wrong password fails the authentication tag. */
export async function unlockWallet(record: VaultRecord, password: string) {
  const key = await wrappingKey(password, record.kdf)
  try {
    const seed = xchacha20poly1305(key, base64urlnopad.decode(record.nonce)).decrypt(base64urlnopad.decode(record.ciphertext))
    if (base58.encode(ed25519.getPublicKey(seed)) !== record.address) throw new Error('mismatch')
    return seed
  } catch {
    throw new Error('That password doesn’t open this wallet.')
  } finally {
    key.fill(0)
  }
}

// ── Storage: Telegram CloudStorage first, server backup second ───────────────

type CloudStorage = {
  getItem: (key: string, cb: (err: string | null, value?: string) => void) => void
  setItem: (key: string, value: string, cb?: (err: string | null) => void) => void
}

const cloud = () => (window.Telegram?.WebApp as { CloudStorage?: CloudStorage } | undefined)?.CloudStorage

function cloudGet(): Promise<string | null> {
  const cs = cloud()
  if (!cs) return Promise.resolve(null)
  return new Promise((resolve) => cs.getItem(CLOUD_KEY, (err, v) => resolve(err || !v ? null : v)))
}

function cloudSet(value: string): Promise<void> {
  const cs = cloud()
  if (!cs) return Promise.resolve()
  return new Promise((resolve, reject) => cs.setItem(CLOUD_KEY, value, (err) => (err ? reject(new Error(err)) : resolve())))
}

/** Loads the encrypted record from Telegram, falling back to the server backup. */
export async function loadRecord(): Promise<VaultRecord | null> {
  const local = await cloudGet().catch(() => null)
  if (local) return JSON.parse(local) as VaultRecord
  const remote = await post<{ record: VaultRecord | null }>('/api/vault', { op: 'get' }).catch(() => ({ record: null }))
  if (remote.record) await cloudSet(JSON.stringify(remote.record)).catch(() => {})
  return remote.record
}

/** Saves the encrypted record in both places. */
export async function saveRecord(record: VaultRecord) {
  await cloudSet(JSON.stringify(record))
  await post('/api/vault', { op: 'put', record })
}

// ── The unlocked key, held in memory only and wiped after a while ────────────

let unlocked: { seed: Uint8Array; address: string; timer: number } | null = null

export function holdKey(seed: Uint8Array, address: string) {
  lock()
  unlocked = { seed, address, timer: window.setTimeout(lock, LOCK_AFTER_MS) }
}

export function lock() {
  if (!unlocked) return
  clearTimeout(unlocked.timer)
  unlocked.seed.fill(0)
  unlocked = null
}

export const isUnlocked = () => unlocked !== null

/** Signs a transaction message prepared by Sunny's server; returns the base64 signature. */
export function signMessage(messageBase64: string) {
  if (!unlocked) throw new Error('Unlock your wallet first.')
  const message = Uint8Array.from(atob(messageBase64), (c) => c.charCodeAt(0))
  const sig = ed25519.sign(message, unlocked.seed)
  return btoa(String.fromCharCode(...sig))
}

/** The raw key, for the user's own backup only. */
export function exportKey() {
  if (!unlocked) throw new Error('Unlock your wallet first.')
  // Solana wallets (Phantom, Solflare) import the 64-byte secret key in base58.
  const full = new Uint8Array(64)
  full.set(unlocked.seed, 0)
  full.set(ed25519.getPublicKey(unlocked.seed), 32)
  return base58.encode(full)
}

// ── Verify before signing ─────────────────────────────────────────────────────
// The server prepares transactions, but this device decides whether to sign them.
// Only Sunny pocket actions (and creating a token account) are allowed, and the
// confirmation text is built from the decoded transaction, never from the server,
// so even a compromised server can't trick the wallet into sending money elsewhere.


export const POCKET_PROGRAM = '7RhPyrf1C4t3QDce8hW19i6FK5wevEEPgBMne8Pt4wvy'
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111'

const anchorIx = (name: string) => Array.from(sha256(new TextEncoder().encode(`global:${name}`)).slice(0, 8)).join(',')
const POCKET_IX: Record<string, string> = {
  [anchorIx('open_pocket')]: 'open_pocket',
  [anchorIx('top_up')]: 'top_up',
  [anchorIx('set_limits')]: 'set_limits',
  [anchorIx('set_frozen')]: 'set_frozen',
  [anchorIx('set_agent')]: 'set_agent',
  [anchorIx('withdraw')]: 'withdraw',
}

function readCompactU16(bytes: Uint8Array, at: number): [number, number] {
  let value = 0
  let size = 0
  for (;;) {
    const b = bytes[at + size]
    value |= (b & 0x7f) << (7 * size)
    size++
    if ((b & 0x80) === 0) return [value, size]
  }
}

const u64 = (d: Uint8Array, at: number) => Number(new DataView(d.buffer, d.byteOffset + at, 8).getBigUint64(0, true))
const usdc = (base: number) => `$${(base / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 2 })}`

/** Decodes a legacy transaction message and describes it, or throws if it isn't a Sunny pocket action. */
export function describeTransaction(messageBase64: string, owner: string): string[] {
  const m = Uint8Array.from(atob(messageBase64), (c) => c.charCodeAt(0))
  if (m[0] & 0x80) throw new Error('Unexpected transaction format. Not signing.')
  const requiredSigners = m[0]
  let at = 3
  const [keyCount, k] = readCompactU16(m, at)
  at += k
  const keys: string[] = []
  for (let i = 0; i < keyCount; i++, at += 32) keys.push(base58.encode(m.slice(at, at + 32)))
  at += 32 // recent blockhash
  const ownerIndex = keys.indexOf(owner)
  if (ownerIndex < 1 || ownerIndex >= requiredSigners) throw new Error('This transaction isn’t for your wallet. Not signing.')

  const [ixCount, n] = readCompactU16(m, at)
  at += n
  const actions: string[] = []
  for (let i = 0; i < ixCount; i++) {
    const program = keys[m[at]]
    at += 1
    const [accLen, a] = readCompactU16(m, at)
    at += a + accLen
    const [dataLen, d] = readCompactU16(m, at)
    at += d
    const data = m.slice(at, at + dataLen)
    at += dataLen
    if (program === ATA_PROGRAM || program === COMPUTE_BUDGET) continue
    if (program !== POCKET_PROGRAM) throw new Error('This transaction touches something other than Sunny’s pocket. Not signing.')
    const name = POCKET_IX[Array.from(data.slice(0, 8)).join(',')]
    switch (name) {
      case 'open_pocket':
        actions.push(`Open Sunny’s pocket: up to ${usdc(u64(data, 40))} a day, ${usdc(u64(data, 48))} per payment`)
        break
      case 'top_up':
        actions.push(`Put ${usdc(u64(data, 8))} into Sunny’s pocket`)
        break
      case 'set_limits':
        actions.push(`Change limits to ${usdc(u64(data, 8))} a day, ${usdc(u64(data, 16))} per payment`)
        break
      case 'set_frozen':
        actions.push(data[8] ? 'Freeze Sunny’s pocket (Sunny can’t spend)' : 'Unfreeze Sunny’s pocket')
        break
      case 'set_agent':
        actions.push('Change Sunny’s agent key')
        break
      case 'withdraw':
        actions.push(`Take ${usdc(u64(data, 8))} back to your wallet`)
        break
      default:
        throw new Error('Unknown pocket action. Not signing.')
    }
  }
  if (!actions.length) throw new Error('Nothing to sign.')
  return actions
}
