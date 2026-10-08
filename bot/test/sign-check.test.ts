// The wallet only signs Sunny pocket actions, decoded on the device. These tests build
// real server-side transactions and check the Mini App's verifier, including what a
// compromised server might try. Run: node --env-file=../.env --import tsx --test test/sign-check.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js'
import { base58 } from '@scure/base'

// Throwaway keys when there's no .env (CI): the transactions are only built and read, never sent.
process.env.SUNNY_USDC_MINT ||= '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
process.env.SUNNY_FEE_PAYER ||= base58.encode(Keypair.generate().secretKey)
process.env.SUNNY_AGENT_SEED ||= randomBytes(32).toString('hex')
const { ata, feePayer, pocketPda, prepareOwnerTx, usdcMint, vaultPda } = await import('../src/solana.js')
const { describeTransaction, pocketAccounts } = await import('../../web/src/lib/vault.js')

const owner = Keypair.generate().publicKey.toBase58()

test('describes each pocket action in plain words', async () => {
  const cases = [
    [{ action: 'open', daily: 10, perTx: 5 }, 'Open Sunny’s pocket: up to $10 a day, $5 per payment'],
    [{ action: 'topup', amount: 10 }, 'Put $10 into Sunny’s pocket'],
    [{ action: 'freeze' }, 'Freeze Sunny’s pocket (Sunny can’t spend)'],
    [{ action: 'unfreeze' }, 'Unfreeze Sunny’s pocket'],
    [{ action: 'limits', daily: 20, perTx: 2.5 }, 'Change limits to $20 a day, $2.5 per payment'],
    [{ action: 'withdraw', amount: 7.5 }, 'Take $7.5 back to your wallet'],
  ] as const
  for (const [action, expected] of cases) {
    const p = await prepareOwnerTx(owner, action as never)
    assert.deepEqual(describeTransaction(p.message, owner), [expected])
  }
  // Feeding Sunny its first coin opens the pocket and fills it in one signature.
  const fed = await prepareOwnerTx(owner, { action: 'open', daily: 10, perTx: 5, amount: 5 })
  assert.deepEqual(describeTransaction(fed.message, owner), [
    'Open Sunny’s pocket: up to $10 a day, $5 per payment',
    'Put $5 into Sunny’s pocket',
  ])
})

test('refuses a transaction that moves SOL out of the wallet', () => {
  const evil = new Transaction({ feePayer: feePayer().publicKey, recentBlockhash: '11111111111111111111111111111111' })
  evil.add(SystemProgram.transfer({ fromPubkey: new PublicKey(owner), toPubkey: Keypair.generate().publicKey, lamports: 1e9 }))
  assert.throws(() => describeTransaction(evil.serializeMessage().toString('base64'), owner), /Not signing/)
})

test('refuses a transaction meant for another wallet', async () => {
  const other = await prepareOwnerTx(Keypair.generate().publicKey.toBase58(), { action: 'topup', amount: 1 })
  assert.throws(() => describeTransaction(other.message, owner), /isn’t for your wallet/)
})

test('works out the same pocket addresses as Solana', () => {
  const pocket = pocketPda(new PublicKey(owner))
  assert.deepEqual(pocketAccounts(owner), { pocket: pocket.toBase58(), vault: vaultPda(pocket).toBase58() })
})

test('refuses a top-up that sends your money into someone else’s pocket', () => {
  // The honest text would read "Put $10 into Sunny’s pocket", but the vault is an attacker's.
  const attackerPocket = pocketPda(Keypair.generate().publicKey)
  const me = new PublicKey(owner)
  const evil = new Transaction({ feePayer: feePayer().publicKey, recentBlockhash: '11111111111111111111111111111111' })
  evil.add(
    new TransactionInstruction({
      programId: new PublicKey('7RhPyrf1C4t3QDce8hW19i6FK5wevEEPgBMne8Pt4wvy'),
      keys: [
        { pubkey: me, isSigner: true, isWritable: false },
        { pubkey: attackerPocket, isSigner: false, isWritable: false },
        { pubkey: vaultPda(attackerPocket), isSigner: false, isWritable: true },
        { pubkey: usdcMint(), isSigner: false, isWritable: false },
        { pubkey: ata(me), isSigner: false, isWritable: true },
        { pubkey: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([createHash('sha256').update('global:top_up').digest().subarray(0, 8), Buffer.from(new BigUint64Array([10_000_000n]).buffer)]),
    }),
  )
  assert.throws(() => describeTransaction(evil.serializeMessage().toString('base64'), owner), /isn’t yours/)
})
