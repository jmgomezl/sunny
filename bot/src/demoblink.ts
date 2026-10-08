import { createHmac } from 'node:crypto'
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import { MAINNET_RPC } from './market.js'

// Sunny's scam demo: a Blink dressed up as a "free BONK airdrop" whose transaction does what
// real drainers do. It sweeps your SOL and hands your token accounts to an "attacker".
// It is harmless: the transaction also requires a signature from a lock key that is never
// used, so no wallet can ever submit it. It exists so people (and judges) can watch Sunny's
// "Should I sign this?" check catch a drainer, using their own wallet's real balances.

export const DEMO_BLINK_PATH = '/api/blinks/free-airdrop'
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')
const mainnet = new Connection(MAINNET_RPC, 'confirmed')

const derive = (label: string) =>
  Keypair.fromSeed(createHmac('sha256', process.env.SUNNY_AGENT_SEED ?? 'sunny').update(label).digest())
const attacker = () => derive('sunny-demo-attacker').publicKey
// Never signs anything: its signature is the lock that keeps the demo from ever going through.
const lock = () => derive('sunny-demo-lock').publicKey

export function demoBlinkMeta(origin: string) {
  return {
    type: 'action',
    icon: `${origin}/sunny-avatar.png`,
    title: 'FREE $BONK AIRDROP 🎁',
    description:
      'Claim 1,000,000 BONK now, only for early holders! (This is Sunny’s harmless scam demo: the transaction behaves like a drainer, but it can never be completed.)',
    label: 'Claim airdrop',
    links: { actions: [{ type: 'transaction', label: 'Claim 1,000,000 BONK', href: DEMO_BLINK_PATH }] },
  }
}

/** The drainer-shaped transaction for `account`, built from its real mainnet balances. */
export async function demoBlinkTransaction(account: string) {
  const owner = new PublicKey(account)
  const [balance, tokens] = await Promise.all([
    mainnet.getBalance(owner),
    mainnet.getParsedTokenAccountsByOwner(owner, { programId: TOKEN }),
  ])
  const instructions: TransactionInstruction[] = []
  // Sweep nearly all the SOL. From an empty wallet (a guest with no wallet to simulate) it still
  // asks for 0.25 SOL, so the check shows what a drainer requests; the lock keeps it harmless.
  const sweep = Math.max(balance - 2_000_000, 250_000_000)
  if (sweep > 0) instructions.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: attacker(), lamports: sweep }))
  // Hand the token accounts that hold something to the attacker (SetAuthority, AccountOwner).
  for (const a of tokens.value.filter((t) => Number(t.account.data.parsed.info.tokenAmount.uiAmount) > 0).slice(0, 4)) {
    instructions.push(
      new TransactionInstruction({
        programId: TOKEN,
        keys: [
          { pubkey: a.pubkey, isSigner: false, isWritable: true },
          { pubkey: owner, isSigner: true, isWritable: false },
        ],
        data: Buffer.from([6, 2, 1, ...attacker().toBytes()]),
      }),
    )
  }
  // The lock: a memo that needs a signature nobody will ever give.
  instructions.push(
    new TransactionInstruction({
      programId: MEMO,
      keys: [{ pubkey: lock(), isSigner: true, isWritable: false }],
      data: Buffer.from('Sunny demo: this "airdrop" is a drainer. Never sign links like this.'),
    }),
  )
  const { blockhash } = await mainnet.getLatestBlockhash()
  const message = new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions }).compileToV0Message()
  return {
    transaction: Buffer.from(new VersionedTransaction(message).serialize()).toString('base64'),
    message: 'Claiming your airdrop…',
  }
}
