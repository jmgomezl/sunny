// One-time devnet setup for Sunny's pocket money. Safe to re-run: every step is skipped
// when it's already done.
//   1. Sunny's fee wallet and agent secret in ../.env
//   2. Fund the fee wallet from the deployer (~/.config/solana/id.json)
//   3. A test-USDC mint (6 decimals) whose mint authority is the fee wallet
//
// Run: node --env-file=../.env --import tsx scripts/devnet-setup.ts [--fund]

import { appendFileSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { base58 } from '@scure/base'
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js'

const ENV = join(import.meta.dirname, '..', '..', '.env')
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const MINT_SIZE = 82

const env = readFileSync(ENV, 'utf8')
const add = (line: string) => appendFileSync(ENV, `${line}\n`)

let feePayer: Keypair
if (process.env.SUNNY_FEE_PAYER) {
  feePayer = Keypair.fromSecretKey(base58.decode(process.env.SUNNY_FEE_PAYER))
} else {
  feePayer = Keypair.generate()
  add('\n# Sunny on Solana (devnet). Fee wallet: pays network fees and is the test-USDC mint authority.')
  add(`SUNNY_FEE_PAYER=${base58.encode(feePayer.secretKey)}`)
}
if (!/^SUNNY_AGENT_SEED=./m.test(env) && !process.env.SUNNY_AGENT_SEED) {
  add('# Secret for deriving each pocket owner’s Sunny agent key.')
  add(`SUNNY_AGENT_SEED=${randomBytes(32).toString('hex')}`)
}
console.log('fee wallet:', feePayer.publicKey.toBase58())

if (!process.argv.includes('--fund')) process.exit(0)

const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed')
// Funding spends from your local Solana CLI wallet, so it only ever runs against devnet: the
// network is checked by its genesis hash, not by the URL's name.
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
const genesis = await connection.getGenesisHash()
if (genesis !== DEVNET_GENESIS) {
  console.error(`Refusing to fund: SOLANA_RPC_URL points at a network that isn't devnet (genesis ${genesis}).`)
  process.exit(1)
}
const deployer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(join(homedir(), '.config/solana/id.json'), 'utf8'))),
)
console.log(
  `network: devnet (genesis ${genesis.slice(0, 8)}…) · paying from ${deployer.publicKey.toBase58()} · ${(await connection.getBalance(deployer.publicKey)) / LAMPORTS_PER_SOL} SOL`,
)

const feeBalance = await connection.getBalance(feePayer.publicKey)
if (feeBalance < 0.5 * LAMPORTS_PER_SOL) {
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: feePayer.publicKey, lamports: LAMPORTS_PER_SOL }),
  )
  await sendAndConfirmTransaction(connection, tx, [deployer])
  console.log('funded fee wallet with 1 SOL')
}

if (!process.env.SUNNY_USDC_MINT) {
  const mint = Keypair.generate()
  const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE)
  // SPL Token InitializeMint2 = 20: decimals, mint authority, no freeze authority.
  const init = new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    keys: [{ pubkey: mint.publicKey, isSigner: false, isWritable: true }],
    data: Buffer.concat([Buffer.from([20, 6]), feePayer.publicKey.toBuffer(), Buffer.from([0])]),
  })
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: feePayer.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports: rent,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM,
    }),
    init,
  )
  await sendAndConfirmTransaction(connection, tx, [feePayer, mint])
  add('# Test USDC on devnet (6 decimals), minted by Sunny’s faucet.')
  add(`SUNNY_USDC_MINT=${mint.publicKey.toBase58()}`)
  console.log('created test-USDC mint:', mint.publicKey.toBase58())
}
console.log('done')
