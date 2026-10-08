import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { ed25519 } from '@noble/curves/ed25519.js'
import { base58 } from '@scure/base'
import { PublicKey } from '@solana/web3.js'
import { isAddress } from './wallet.js'

// Sign in with a Solana wallet: how Sunny works outside Telegram, on a Seeker (Seed Vault
// through Mobile Wallet Adapter), any Android phone, or a desktop wallet extension. The person
// signs a one-time message (Sign In With Solana format, so wallets show it as a sign-in) and
// gets a session. That wallet then owns their pocket: the wallet they already have, under the
// same on-chain guardrails. Nothing is stored: challenges and sessions are checked by HMAC.

const CHALLENGE_MS = 10 * 60_000
const SESSION_MS = 14 * 24 * 3_600_000
// Bump to sign everyone out (sessions don't depend on the agent seed's own uses).
const SESSION_VERSION = 'v1'

const secret = () =>
  createHmac('sha256', Buffer.from(process.env.SUNNY_AGENT_SEED ?? 'sunny-dev', 'hex')).update('sunny-wallet-session').digest()
const mac = (s: string) => createHmac('sha256', secret()).update(s).digest('base64url')
// Byte lengths, not string lengths: a non-ASCII input of the same length must not throw.
function same(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

// A signed challenge works once: replaying it inside its 10 minutes is refused.
const usedNonces = new Map<string, number>()
function firstUse(nonce: string, now: number) {
  for (const [n, exp] of usedNonces) if (exp < now) usedNonces.delete(n)
  if (usedNonces.has(nonce)) return false
  usedNonces.set(nonce, now + CHALLENGE_MS)
  return true
}

const STATEMENT = 'Sign in to Sunny. This proves the wallet is yours; it costs nothing and moves no money.'

/** The message to sign, for this site's domain (wallets warn when it doesn't match the page). */
export function challenge(address: string, domain: string, now = Date.now()) {
  if (!isAddress(address)) throw new Error('That isn’t a Solana address.')
  const issued = new Date(now).toISOString()
  const nonce = mac(`challenge:${domain}:${address}:${issued}`).slice(0, 16)
  return [
    `${domain} wants you to sign in with your Solana account:`,
    address,
    '',
    STATEMENT,
    '',
    `Nonce: ${nonce}`,
    `Issued At: ${issued}`,
  ].join('\n')
}

/** Checks a signed challenge: ours, fresh, for this domain, and signed by the address. */
export function verifySignIn(message: string, signatureBase58: string, domain: string, now = Date.now()): string | null {
  const lines = message.split('\n')
  const address = lines[1] ?? ''
  const issued = /^Issued At: (.+)$/.exec(lines[6] ?? '')?.[1] ?? ''
  const at = Date.parse(issued)
  if (!isAddress(address) || !Number.isFinite(at) || now - at > CHALLENGE_MS || at - now > 60_000) return null
  // Rebuilding it from its parts proves Sunny issued it, unchanged.
  if (!same(message, challenge(address, domain, at))) return null
  let ok = false
  try {
    ok = ed25519.verify(base58.decode(signatureBase58), new TextEncoder().encode(message), new PublicKey(address).toBytes())
  } catch {
    return null
  }
  const nonce = /^Nonce: (.+)$/.exec(lines[5] ?? '')?.[1] ?? ''
  return ok && firstUse(nonce, now) ? address : null
}

/** A session for a signed-in wallet: its address and expiry, sealed with Sunny's secret. */
export function sessionFor(address: string, now = Date.now()) {
  const body = `${address}.${now + SESSION_MS}`
  return `${body}.${mac(`session:${SESSION_VERSION}:${body}`)}`
}

/** The wallet a session belongs to, or null if it's forged or expired. */
export function walletOfSession(token: string, now = Date.now()): string | null {
  const [address, expires, seal] = token.split('.')
  if (!address || !expires || !seal || !isAddress(address)) return null
  if (!same(seal, mac(`session:${SESSION_VERSION}:${address}.${expires}`)) || Number(expires) < now) return null
  return address
}

/**
 * A stable user id for a signed-in wallet. Negative like guests (no Telegram to message), but
 * from a separate range (guests stay below 2^48), so the two never collide. 51 bits of hash:
 * finding another wallet with the same id would take ~2^51 keypairs.
 */
export const walletUserId = (address: string) => {
  const h = BigInt(`0x${createHash('sha256').update(`wallet:${address}`).digest('hex').slice(0, 13)}`) % (1n << 51n)
  return -(2 ** 52 + Number(h))
}

export const isWalletUser = (userId: number) => userId <= -(2 ** 50)
