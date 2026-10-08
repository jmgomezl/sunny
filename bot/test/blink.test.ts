// "Should I sign this?": the checks that read a Blink's transaction, on hand-built
// transactions, so every drainer pattern is proven without depending on live sites.
// Run: pnpm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { applyRule, finish, inspectInstructions } from '../src/blink.js'

const wallet = Keypair.generate().publicKey
const tokenAccount = Keypair.generate().publicKey
const thief = Keypair.generate().publicKey
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')

function read(instructions: TransactionInstruction[]) {
  const message = new TransactionMessage({ payerKey: wallet, recentBlockhash: '11111111111111111111111111111111', instructions }).compileToV0Message()
  const tx = new VersionedTransaction(message)
  return inspectInstructions(tx, instructions, wallet.toBase58(), new Set([tokenAccount.toBase58()]))
}

test('maps website pages to Action APIs like actions.json says', () => {
  const url = new URL('https://alldomains.id/domains/sunny.abc?ref=x')
  assert.equal(applyRule({ pathPattern: '/domains/**', apiPath: '/api/actions/**' }, url), 'https://alldomains.id/api/actions/sunny.abc?ref=x')
  assert.equal(
    applyRule({ pathPattern: '/trade/*', apiPath: 'https://sanctum.dial.to/trade/*' }, new URL('https://app.sanctum.so/trade/SOL-INF')),
    'https://sanctum.dial.to/trade/SOL-INF',
  )
  assert.equal(applyRule({ pathPattern: '/donate/*', apiPath: '/api/donate/*' }, new URL('https://x.io/about')), null)
})

test('catches the ways drainers take over a wallet', () => {
  const assign = read([SystemProgram.assign({ accountPubkey: wallet, programId: thief })])
  assert.match(assign.warnings[0].text, /hands control of your whole wallet/)

  const approve = read([
    new TransactionInstruction({
      programId: TOKEN,
      keys: [
        { pubkey: tokenAccount, isSigner: false, isWritable: true },
        { pubkey: thief, isSigner: false, isWritable: false },
        { pubkey: wallet, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([4, 255, 255, 255, 255, 255, 255, 255, 255]),
    }),
  ])
  assert.equal(approve.warnings[0].level, 'danger')
  assert.match(approve.warnings[0].text, /spend all of your tokens/)

  const handover = read([
    new TransactionInstruction({
      programId: TOKEN,
      keys: [
        { pubkey: tokenAccount, isSigner: false, isWritable: true },
        { pubkey: wallet, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([6, 2, 1, ...thief.toBytes()]),
    }),
  ])
  assert.match(handover.warnings[0].text, /hands one of your token accounts to another wallet/)
})

test('flags a second signer, and leaves a plain transfer alone', () => {
  const memo = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')
  const extra = read([new TransactionInstruction({ programId: memo, keys: [{ pubkey: thief, isSigner: true, isWritable: false }], data: Buffer.from('hi') })])
  assert.match(extra.warnings[0].text, /needs a second signature/)

  const tip = read([SystemProgram.transfer({ fromPubkey: wallet, toPubkey: thief, lamports: 1_000_000 })])
  assert.deepEqual(tip.warnings, [])
  assert.deepEqual(tip.programs, ['System'])

  // A real amount of SOL leaving the wallet is named, even with nothing to simulate against.
  const sweep = read([SystemProgram.transfer({ fromPubkey: wallet, toPubkey: thief, lamports: 250_000_000 })])
  assert.equal(sweep.warnings.length, 1)
  assert.match(sweep.warnings[0].text, /sends 0\.25 SOL from your wallet to/)
  assert.equal(sweep.warnings[0].level, 'caution')
})

test('flags approvals and hand-overs your wallet signs, even with no balances to look at', () => {
  // A token account Sunny never saw (a guest, a group), but the wallet signs as its owner.
  const unknown = Keypair.generate().publicKey
  const approve = new TransactionInstruction({
    programId: TOKEN,
    keys: [
      { pubkey: unknown, isSigner: false, isWritable: true },
      { pubkey: thief, isSigner: false, isWritable: false },
      { pubkey: wallet, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([4]), Buffer.alloc(8, 0xff)]),
  })
  const takeover = new TransactionInstruction({
    programId: TOKEN,
    keys: [
      { pubkey: unknown, isSigner: false, isWritable: true },
      { pubkey: wallet, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([6, 2, 1, ...thief.toBytes()]),
  })
  const found = read([approve, takeover]).warnings.map((w) => w.code)
  assert.deepEqual(found.sort(), ['approve', 'owner'])
})

test('turns findings into a verdict and one plain sentence', () => {
  const base = {
    link: 'https://x.io/a', actionUrl: 'https://x.io/api/a', host: 'x.io', phishing: 'unknown' as const,
    title: 'Tip', description: '', buttons: [], tried: 'Tip', wallet: wallet.toBase58(), yourWallet: true,
    receives: [], programs: ['System'],
  }
  const tip = finish({ ...base, registry: 'trusted', outcome: 'simulated', warnings: [], sends: [{ symbol: 'SOL', mint: 'So1', amount: 0.01, usd: 1.2 }] })
  assert.equal(tip.verdict, 'ok')
  assert.match(tip.summary, /If you sign, you’d send 0\.01 SOL \(~\$1\.2\)\. x\.io is verified/)

  const drain = finish({
    ...base, registry: 'unknown', outcome: 'simulated', sends: [],
    warnings: [
      { level: 'danger', code: 'signer', text: 'it needs a second signature from abcd…wxyz (a Blink should only need yours)' },
      { level: 'danger', code: 'owner', text: 'it hands 2 of your token accounts to another wallet' },
      { level: 'danger', code: 'owner', text: 'it hands 2 of your token accounts to another wallet' },
    ],
  })
  assert.equal(drain.verdict, 'danger')
  assert.equal(drain.warnings.length, 2, 'repeats merge into one line')
  assert.match(drain.summary, /^Don’t sign\. It hands 2 of your token accounts to another wallet and it needs a second signature/)

  const listed = finish({ ...base, registry: 'malicious', outcome: 'simulated', sends: [], warnings: [] })
  assert.match(listed.summary, /Dialect’s registry lists this Blink as malicious/)
})
