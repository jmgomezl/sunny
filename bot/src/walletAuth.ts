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
const SESSION_MS = 30 * 24 * 3_600_000

const secret = () =>
  createHmac('sha256', Buffer.from(process.env.SUNNY_AGENT_SEED ?? 'sunny-dev', 'hex')).update('sunny-wallet-session').digest()
const mac = (s: string) => createHmac('sha256', secret()).update(s).digest('base64url')
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

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
  try {
    const ok = ed25519.verify(base58.decode(signatureBase58), new TextEncoder().encode(message), new PublicKey(address).toBytes())
    return ok ? address : null
  } catch {
    return null
  }
}

/** A session for a signed-in wallet: its address and expiry, sealed with Sunny's secret. */
export function sessionFor(address: string, now = Date.now()) {
  const body = `${address}.${now + SESSION_MS}`
  return `${body}.${mac(`session:${body}`)}`
}

/** The wallet a session belongs to, or null if it's forged or expired. */
export function walletOfSession(token: string, now = Date.now()): string | null {
  const [address, expires, seal] = token.split('.')
  if (!address || !expires || !seal || !isAddress(address)) return null
  if (!same(seal, mac(`session:${address}.${expires}`)) || Number(expires) < now) return null
  return address
}

/**
 * A stable user id for a signed-in wallet. Negative like guests (no Telegram to message), but
 * from a separate range (guests stay below 2^48), so the two never collide.
 */
export const walletUserId = (address: string) =>
  -(2 ** 50 + parseInt(createHash('sha256').update(`wallet:${address}`).digest('hex').slice(0, 10), 16))

export const isWalletUser = (userId: number) => userId <= -(2 ** 50)
