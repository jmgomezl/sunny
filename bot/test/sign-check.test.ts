// The wallet only signs Sunny pocket actions, decoded on the device. These tests build
// real server-side transactions and check the Mini App's verifier, including what a
// compromised server might try. Run: node --env-file=../.env --import tsx --test test/sign-check.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'

process.env.SUNNY_USDC_MINT ||= '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
const { feePayer, prepareOwnerTx } = await import('../src/solana.js')
const { describeTransaction } = await import('../../web/src/lib/vault.js')

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
