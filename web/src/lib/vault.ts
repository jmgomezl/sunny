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

// CloudStorage needs Telegram 6.9+; older clients (and browsers) throw WebAppMethodUnsupported.
const cloud = () => {
  const app = window.Telegram?.WebApp as
    | { CloudStorage?: CloudStorage; isVersionAtLeast?: (v: string) => boolean }
    | undefined
  return app?.isVersionAtLeast?.('6.9') ? app.CloudStorage : undefined
}

// Some clients never answer CloudStorage calls; don't wait forever, the server backup covers it.
const CLOUD_TIMEOUT_MS = 2000
const withTimeout = <T,>(p: Promise<T>, fallback: T) =>
  Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), CLOUD_TIMEOUT_MS))])

function cloudGet(): Promise<string | null> {
  const cs = cloud()
  if (!cs) return Promise.resolve(null)
  return withTimeout(
    new Promise<string | null>((resolve) => {
      try {
        cs.getItem(CLOUD_KEY, (err, v) => resolve(err || !v ? null : v))
      } catch {
        resolve(null)
      }
    }),
    null,
  )
}

function cloudSet(value: string): Promise<void> {
  const cs = cloud()
  if (!cs) return Promise.resolve()
  return withTimeout(
    new Promise<void>((resolve) => {
      try {
        cs.setItem(CLOUD_KEY, value, () => resolve())
      } catch {
        resolve()
      }
    }),
    undefined,
  )
}

/** Loads the encrypted record from Telegram, falling back to the server backup. */
export async function loadRecord(): Promise<VaultRecord | null> {
  const local = await cloudGet().catch(() => null)
  if (local) return JSON.parse(local) as VaultRecord
  // A failed request is not "no wallet": offering to make a new one then could overwrite the
  // only copy of someone's key in Telegram.
  const remote = await post<{ record: VaultRecord | null }>('/api/vault', { op: 'get' }).catch(() => {
    throw new Error('I couldn’t reach your wallet just now. Your key is safe; let’s try again.')
  })
  if (remote.record) await cloudSet(JSON.stringify(remote.record)).catch(() => {})
  return remote.record
}

/** The message a new wallet signs to show the server it really holds the key. */
export const ownershipMessage = (userId: number) => `Sunny wallet for Telegram user ${userId}`

/** Proof that this device holds the new wallet's key, bound to this Telegram user. */
export function walletProof(seed: Uint8Array, userId: number) {
  return base58.encode(ed25519.sign(utf8(ownershipMessage(userId)), seed))
}

/** Saves the encrypted record in both places. A new wallet comes with its ownership proof. */
export async function saveRecord(record: VaultRecord, proof?: string) {
  // The server first: if it says no (say, this person already has a wallet), Telegram's copy
  // of the existing key is never touched.
  await post('/api/vault', { op: 'put', record, proof })
  await cloudSet(JSON.stringify(record))
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
// Only Sunny pocket actions (and creating a token account) are allowed, every one must
// point at this wallet's own pocket (its address is worked out here, not taken from the
// server), and the confirmation text is built from the decoded transaction, so even a
// compromised server can't trick the wallet into sending money elsewhere.


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

const utf8 = (text: string) => new TextEncoder().encode(text)
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0)
  return out
}

/** A program-derived address, the way Solana computes it: the first bump whose hash is off the curve. */
export function programAddress(seeds: Uint8Array[], programId: string): string {
  const program = base58.decode(programId)
  for (let bump = 255; bump >= 0; bump--) {
    const hash = sha256(concat(...seeds, Uint8Array.of(bump), program, utf8('ProgramDerivedAddress')))
    try {
      ed25519.Point.fromBytes(hash)
    } catch {
      return base58.encode(hash)
    }
  }
  throw new Error('No program address found.')
}

/** This wallet's pocket and its vault: the only accounts a pocket action may touch. */
export function pocketAccounts(owner: string) {
  const pocket = programAddress([utf8('pocket'), base58.decode(owner)], POCKET_PROGRAM)
  return { pocket, vault: programAddress([utf8('vault'), base58.decode(pocket)], POCKET_PROGRAM) }
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
  let mine: ReturnType<typeof pocketAccounts> | null = null
  for (let i = 0; i < ixCount; i++) {
    const program = keys[m[at]]
    at += 1
    const [accLen, a] = readCompactU16(m, at)
    at += a
    const accounts = Array.from(m.slice(at, at + accLen), (index) => keys[index])
    at += accLen
    const [dataLen, d] = readCompactU16(m, at)
    at += d
    const data = m.slice(at, at + dataLen)
    at += dataLen
    if (program === COMPUTE_BUDGET) continue
    if (program === ATA_PROGRAM) {
      // Creating a token account is fine, as long as Sunny pays for it, not you.
      if (accounts[0] === owner) throw new Error('This transaction would make your wallet pay rent. Not signing.')
      continue
    }
    if (program !== POCKET_PROGRAM) throw new Error('This transaction touches something other than Sunny’s pocket. Not signing.')
    const name = POCKET_IX[Array.from(data.slice(0, 8)).join(',')]
    // Account order follows the program: open_pocket is (owner, payer, pocket, mint, vault, …),
    // the others start (owner, pocket, vault?, …).
    mine ??= pocketAccounts(owner)
    const [pocketAt, vaultAt] = name === 'open_pocket' ? [2, 4] : [1, 2]
    const usesVault = name === 'open_pocket' || name === 'top_up' || name === 'withdraw'
    if (accounts[0] !== owner || accounts[pocketAt] !== mine.pocket || (usesVault && accounts[vaultAt] !== mine.vault)) {
      throw new Error('This transaction points at a pocket that isn’t yours. Not signing.')
    }
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
