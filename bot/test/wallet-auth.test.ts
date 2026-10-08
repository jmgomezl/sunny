// Sign in with a wallet (Seeker, Android, desktop): only a fresh, unchanged challenge for this
// site, signed by the address in it, opens a session, and sessions can't be forged.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Keypair } from '@solana/web3.js'
import { ed25519 } from '@noble/curves/ed25519.js'
import { base58 } from '@scure/base'
import { challenge, isWalletUser, sessionFor, verifySignIn, walletOfSession, walletUserId } from '../src/walletAuth.js'

process.env.SUNNY_AGENT_SEED ??= '00'.repeat(32)
const DOMAIN = 'sunny.aivylabs.xyz'
const kp = Keypair.generate()
const address = kp.publicKey.toBase58()
const sign = (message: string, key = kp) => base58.encode(ed25519.sign(new TextEncoder().encode(message), key.secretKey.slice(0, 32)))

test('a signed challenge opens a session for that wallet', () => {
  const message = challenge(address, DOMAIN)
  assert.match(message, /^sunny\.aivylabs\.xyz wants you to sign in with your Solana account:\n/)
  assert.equal(verifySignIn(message, sign(message), DOMAIN), address)
  const session = sessionFor(address)
  assert.equal(walletOfSession(session), address)
})

test('anything off is refused: other signer, edits, another site, old challenges', () => {
  const message = challenge(address, DOMAIN)
  assert.equal(verifySignIn(message, sign(message, Keypair.generate()), DOMAIN), null)
  const edited = message.replace('moves no money', 'moves all money')
  assert.equal(verifySignIn(edited, sign(edited), DOMAIN), null)
  assert.equal(verifySignIn(message, sign(message), 'evil.example'), null)
  const old = challenge(address, DOMAIN, Date.now() - 11 * 60_000)
  assert.equal(verifySignIn(old, sign(old), DOMAIN), null)
  // A message Sunny never issued (made-up nonce), even if properly signed.
  const forged = message.replace(/Nonce: \S+/, 'Nonce: aaaaaaaaaaaaaaaa')
  assert.equal(verifySignIn(forged, sign(forged), DOMAIN), null)
})

test('sessions can’t be forged, moved to another wallet, or used after they expire', () => {
  const session = sessionFor(address)
  const other = Keypair.generate().publicKey.toBase58()
  assert.equal(walletOfSession(session.replace(address, other)), null)
  assert.equal(walletOfSession(`${address}.${Date.now() + 1e9}.${createHash('sha256').update('x').digest('base64url')}`), null)
  assert.equal(walletOfSession(sessionFor(address, Date.now() - 31 * 24 * 3_600_000)), null)
})

test('wallet users get their own id range, apart from guests and Telegram users', () => {
  const id = walletUserId(address)
  assert.ok(isWalletUser(id))
  assert.ok(Number.isSafeInteger(id))
  assert.equal(walletUserId(address), id)
  const guest = -parseInt(createHash('sha256').update('some-guest-id').digest('hex').slice(0, 12), 16)
  assert.ok(!isWalletUser(guest))
  assert.ok(!isWalletUser(123456789))
})
