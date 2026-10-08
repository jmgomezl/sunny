import { createHash, createHmac, randomUUID } from 'node:crypto'
import { ed25519 } from '@noble/curves/ed25519.js'
import { base58 } from '@scure/base'
import {
  Connection,
  Keypair,
  type ParsedTransactionWithMeta,
  PublicKey,
  SendTransactionError,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type TokenBalance,
} from '@solana/web3.js'

// Sunny on Solana (devnet): the pocket program, Sunny's fee wallet (pays network fees
// and runs the test-USDC faucet) and the per-user agent keys that draw pocket money.
//
// Agent keys are derived from a server secret per pocket owner, because Sunny must act
// while you sleep. That's safe by design: the pocket program caps what any agent key can
// ever draw. The owner's key never touches this server (see web/src/lib/vault.ts).

export const POCKET_PROGRAM = new PublicKey('7RhPyrf1C4t3QDce8hW19i6FK5wevEEPgBMne8Pt4wvy')
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
const DECIMALS = 6
export const USD = 10 ** DECIMALS

const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
export const connection = new Connection(RPC, 'confirmed')
export const CLUSTER = RPC.includes('devnet') ? 'devnet' : RPC.includes('mainnet') ? 'mainnet-beta' : 'custom'

export const hasChain = () =>
  Boolean(process.env.SUNNY_FEE_PAYER && process.env.SUNNY_AGENT_SEED && process.env.SUNNY_USDC_MINT)

let feePayerCache: Keypair | undefined
export const feePayer = () => (feePayerCache ??= Keypair.fromSecretKey(base58.decode(process.env.SUNNY_FEE_PAYER!)))
export const usdcMint = () => new PublicKey(process.env.SUNNY_USDC_MINT!)

/** Sunny's agent key for one pocket owner, derived from the server secret. */
export function agentFor(owner: PublicKey): Keypair {
  const seed = createHmac('sha256', Buffer.from(process.env.SUNNY_AGENT_SEED!, 'hex'))
    .update(`sunny-agent:${owner.toBase58()}`)
    .digest()
  return Keypair.fromSeed(seed)
}

export const pocketPda = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from('pocket'), owner.toBuffer()], POCKET_PROGRAM)[0]
export const vaultPda = (pocket: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from('vault'), pocket.toBuffer()], POCKET_PROGRAM)[0]
export const ata = (owner: PublicKey, mint = usdcMint()) =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0]

const disc = (name: string) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8)
const u64 = (n: bigint | number) => {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE(BigInt(n))
  return b
}

function createAtaIdempotent(owner: PublicKey, payer: PublicKey, mint = usdcMint()) {
  return new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata(owner, mint), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  })
}

// ── Reading a pocket ────────────────────────────────────────────────────────

export type PocketState = {
  owner: string
  pocket: string
  exists: boolean
  agent: string
  dailyLimit: number
  perTxLimit: number
  spentToday: number
  leftToday: number
  vault: number
  ownerUsdc: number
  agentUsdc: number
  frozen: boolean
  totalDrawn: number
  cluster: string
}

// SPL token account layout: mint (32), owner (32), amount (u64) at byte 64.
const tokenAmount = (data?: Buffer | null) => (data && data.length >= 72 ? Number(data.readBigUInt64LE(64)) / USD : 0)

export async function pocketState(ownerAddress: string): Promise<PocketState> {
  const owner = new PublicKey(ownerAddress)
  const pocket = pocketPda(owner)
  const agent = agentFor(owner).publicKey
  // One RPC call for everything this view needs.
  const [info, vaultInfo, ownerInfo, agentInfo] = await connection.getMultipleAccountsInfo([
    pocket,
    vaultPda(pocket),
    ata(owner),
    ata(agent),
  ])
  const vault = tokenAmount(vaultInfo?.data)
  const ownerUsdc = tokenAmount(ownerInfo?.data)
  const agentUsdc = tokenAmount(agentInfo?.data)
  const base = { owner: ownerAddress, pocket: pocket.toBase58(), agent: agent.toBase58(), vault, ownerUsdc, agentUsdc, cluster: CLUSTER }
  if (!info) {
    return { ...base, exists: false, dailyLimit: 0, perTxLimit: 0, spentToday: 0, leftToday: 0, frozen: false, totalDrawn: 0 }
  }
  // Anchor layout: 8-byte discriminator, then owner, agent, mint (32 each), then the fields.
  const d = info.data
  const at = 8 + 32 * 3
  const daily = Number(d.readBigUInt64LE(at)) / USD
  const perTx = Number(d.readBigUInt64LE(at + 8)) / USD
  const spent = Number(d.readBigUInt64LE(at + 16)) / USD
  const day = Number(d.readBigInt64LE(at + 24))
  const spentToday = day === Math.floor(Date.now() / 1000 / 86_400) ? spent : 0
  return {
    ...base,
    agent: new PublicKey(d.subarray(8 + 32, 8 + 64)).toBase58(),
    exists: true,
    dailyLimit: daily,
    perTxLimit: perTx,
    spentToday,
    leftToday: Math.max(0, Math.min(daily - spentToday, vault)),
    frozen: d[at + 32] === 1,
    totalDrawn: Number(d.readBigUInt64LE(at + 33)) / USD,
  }
}

// ── Owner actions: prepared here, signed on the owner's device ──────────────

export type OwnerAction =
  | { action: 'open'; daily: number; perTx: number; amount?: number }
  | { action: 'topup'; amount: number }
  | { action: 'withdraw'; amount: number }
  | { action: 'limits'; daily: number; perTx: number }
  | { action: 'freeze' }
  | { action: 'unfreeze' }

const pending = new Map<string, { tx: Transaction; owner: string; expires: number }>()

const toBase = (usd: number) => BigInt(Math.round(usd * USD))

function ownerInstructions(owner: PublicKey, a: OwnerAction): TransactionInstruction[] {
  const pocket = pocketPda(owner)
  const vault = vaultPda(pocket)
  const mint = usdcMint()
  const meta = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) => ({ pubkey, isSigner, isWritable })
  const topUp = (amount: number) =>
    new TransactionInstruction({
      programId: POCKET_PROGRAM,
      keys: [meta(owner, true, false), meta(pocket, false, false), meta(vault, false, true), meta(mint, false, false), meta(ata(owner), false, true), meta(TOKEN_PROGRAM, false, false)],
      data: Buffer.concat([disc('top_up'), u64(toBase(amount))]),
    })
  switch (a.action) {
    case 'open':
      return [
        new TransactionInstruction({
          programId: POCKET_PROGRAM,
          keys: [
            meta(owner, true, false),
            // Sunny's fee wallet pays the rent, so the owner's wallet needs no SOL.
            meta(feePayer().publicKey, true, true),
            meta(pocket, false, true),
            meta(mint, false, false),
            meta(vault, false, true),
            meta(TOKEN_PROGRAM, false, false),
            meta(SystemProgram.programId, false, false),
          ],
          data: Buffer.concat([disc('open_pocket'), agentFor(owner).publicKey.toBuffer(), u64(toBase(a.daily)), u64(toBase(a.perTx))]),
        }),
        // The first pocket money in the same transaction: the pocket exists by the time it runs.
        ...(a.amount ? [topUp(a.amount)] : []),
      ]
    case 'topup':
      return [topUp(a.amount)]
    case 'withdraw':
      return [
        createAtaIdempotent(owner, feePayer().publicKey),
        new TransactionInstruction({
          programId: POCKET_PROGRAM,
          keys: [meta(owner, true, false), meta(pocket, false, false), meta(vault, false, true), meta(mint, false, false), meta(ata(owner), false, true), meta(TOKEN_PROGRAM, false, false)],
          data: Buffer.concat([disc('withdraw'), u64(toBase(a.amount))]),
        }),
      ]
    case 'limits':
      return [
        new TransactionInstruction({
          programId: POCKET_PROGRAM,
          keys: [meta(owner, true, false), meta(pocket, false, true)],
          data: Buffer.concat([disc('set_limits'), u64(toBase(a.daily)), u64(toBase(a.perTx))]),
        }),
      ]
    case 'freeze':
    case 'unfreeze':
      return [
        new TransactionInstruction({
          programId: POCKET_PROGRAM,
          keys: [meta(owner, true, false), meta(pocket, false, true)],
          data: Buffer.concat([disc('set_frozen'), Buffer.from([a.action === 'freeze' ? 1 : 0])]),
        }),
      ]
  }
}

/** Builds an owner transaction (Sunny pays the fee) and returns the message to sign. */
export async function prepareOwnerTx(ownerAddress: string, a: OwnerAction) {
  const owner = new PublicKey(ownerAddress)
  const tx = new Transaction({ feePayer: feePayer().publicKey })
  tx.add(...ownerInstructions(owner, a))
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
  const id = randomUUID()
  pending.set(id, { tx, owner: ownerAddress, expires: Date.now() + 90_000 })
  for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k)
  return { id, message: tx.serializeMessage().toString('base64') }
}

/** Adds the owner's signature (checked here) and Sunny's fee signature, then sends. */
export async function submitOwnerTx(id: string, ownerAddress: string, signatureBase64: string) {
  const p = pending.get(id)
  if (!p || p.owner !== ownerAddress || p.expires < Date.now()) throw new Error('That request expired. Try again.')
  pending.delete(id)
  const sig = Buffer.from(signatureBase64, 'base64')
  const message = p.tx.serializeMessage()
  if (!ed25519.verify(sig, message, new PublicKey(ownerAddress).toBytes())) throw new Error('Signature doesn’t match your wallet.')
  p.tx.addSignature(new PublicKey(ownerAddress), sig)
  p.tx.partialSign(feePayer())
  return send(p.tx)
}

// ── Sunny's side: drawing pocket money, and the test-USDC faucet ────────────

const ERRORS: Record<number, string> = {
  6000: 'Those limits aren’t valid',
  6001: 'Amount must be above zero',
  6002: 'The pocket is frozen',
  6003: 'That’s over the per-payment limit',
  6004: 'That’s over today’s limit',
  6005: 'Only Sunny’s agent key can draw',
  6006: 'Only the owner can do that',
  // Anchor's own: the pocket account doesn't exist yet.
  3012: 'There’s no pocket open yet',
}

/** Turns a failed transaction into the pocket rule that stopped it. */
function explain(err: unknown): string {
  const logs = err instanceof SendTransactionError ? (err.logs ?? []) : []
  const text = `${err instanceof Error ? err.message : String(err)} ${logs.join(' ')}`
  // Program errors appear as hex in the runtime message ("custom program error: 0x1773")
  // or as decimal in Anchor's log line ("Error Number: 6003").
  const hex = text.match(/custom program error: 0x([0-9a-f]+)/i)?.[1]
  const dec = text.match(/Error Number: (\d+)/)?.[1]
  const n = hex ? parseInt(hex, 16) : dec ? Number(dec) : NaN
  if (ERRORS[n]) return ERRORS[n]
  if (/insufficient funds/i.test(text)) return 'There isn’t enough in the pocket'
  return 'The transaction failed'
}

async function send(tx: Transaction) {
  try {
    const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false })
    await connection.confirmTransaction(signature, 'confirmed')
    return { signature, explorer: `https://solscan.io/tx/${signature}?cluster=${CLUSTER}` }
  } catch (err) {
    throw Object.assign(new Error(explain(err)), { cause: err })
  }
}

/** Sunny draws pocket money into its own wallet. The program enforces the owner's limits. */
export async function agentDraw(ownerAddress: string, usd: number) {
  const owner = new PublicKey(ownerAddress)
  const agent = agentFor(owner)
  const pocket = pocketPda(owner)
  const tx = new Transaction({ feePayer: feePayer().publicKey })
  tx.add(
    createAtaIdempotent(agent.publicKey, feePayer().publicKey),
    new TransactionInstruction({
      programId: POCKET_PROGRAM,
      keys: [
        { pubkey: agent.publicKey, isSigner: true, isWritable: false },
        { pubkey: pocket, isSigner: false, isWritable: true },
        { pubkey: vaultPda(pocket), isSigner: false, isWritable: true },
        { pubkey: usdcMint(), isSigner: false, isWritable: false },
        { pubkey: ata(agent.publicKey), isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([disc('draw'), u64(toBase(usd))]),
    }),
  )
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
  tx.sign(feePayer(), agent)
  return sendToChain(tx)
}

/**
 * Sunny puts money it drew back into the pocket (anyone may top a pocket up): used when
 * something it paid for didn't arrive, so the owner never pays for nothing.
 */
export async function refundToPocket(ownerAddress: string, usd: number) {
  const owner = new PublicKey(ownerAddress)
  const agent = agentFor(owner)
  const pocket = pocketPda(owner)
  const tx = new Transaction({ feePayer: feePayer().publicKey })
  tx.add(
    new TransactionInstruction({
      programId: POCKET_PROGRAM,
      keys: [
        { pubkey: agent.publicKey, isSigner: true, isWritable: false },
        { pubkey: pocket, isSigner: false, isWritable: false },
        { pubkey: vaultPda(pocket), isSigner: false, isWritable: true },
        { pubkey: usdcMint(), isSigner: false, isWritable: false },
        { pubkey: ata(agent.publicKey), isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([disc('top_up'), u64(toBase(usd))]),
    }),
  )
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
  tx.sign(feePayer(), agent)
  return send(tx)
}

/**
 * Sends straight to the chain, without the preflight check, so a refused draw lands as a
 * failed transaction carrying the program's own error: on-chain proof that Solana said no,
 * not just a server message. A refusal throws with `explorer` pointing at that transaction.
 */
async function sendToChain(tx: Transaction) {
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true })
  const explorer = explorerTx(signature)
  let failure: unknown = null
  try {
    failure = (await connection.confirmTransaction(signature, 'confirmed')).value.err
  } catch (err) {
    // web3.js throws the transaction's own error object ({InstructionError: …}) when it failed.
    if (err && typeof err === 'object' && !(err instanceof Error)) failure = err
    else throw Object.assign(new Error(explain(err)), { cause: err })
  }
  if (!failure) return { signature, explorer }
  const logs =
    (await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null))?.meta
      ?.logMessages ?? []
  const custom = (failure as { InstructionError?: [number, { Custom?: number }] }).InstructionError?.[1]?.Custom
  const reason = explain(new Error(`${custom !== undefined ? `Error Number: ${custom}` : JSON.stringify(failure)} ${logs.join(' ')}`))
  throw Object.assign(new Error(reason), { explorer, signature })
}

/** Opens a wallet's test-USDC account if it doesn't exist yet. Sunny's fee wallet pays the rent. */
export async function ensureAta(owner: PublicKey) {
  if (await connection.getAccountInfo(ata(owner))) return
  const tx = new Transaction({ feePayer: feePayer().publicKey }).add(createAtaIdempotent(owner, feePayer().publicKey))
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
  tx.sign(feePayer())
  await send(tx)
}

export const explorerTx = (signature: string) => `https://solscan.io/tx/${signature}?cluster=${CLUSTER}`

/** Mints test USDC (devnet only) to a wallet so people can try the pocket. */
export async function faucet(ownerAddress: string, usd: number) {
  if (CLUSTER === 'mainnet-beta') throw new Error('No faucet on mainnet')
  const owner = new PublicKey(ownerAddress)
  const mintTo = new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    keys: [
      { pubkey: usdcMint(), isSigner: false, isWritable: true },
      { pubkey: ata(owner), isSigner: false, isWritable: true },
      { pubkey: feePayer().publicKey, isSigner: true, isWritable: false },
    ],
    // SPL Token MintTo = instruction 7, amount u64.
    data: Buffer.concat([Buffer.from([7]), u64(toBase(usd))]),
  })
  const tx = new Transaction({ feePayer: feePayer().publicKey }).add(createAtaIdempotent(owner, feePayer().publicKey), mintTo)
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
  tx.sign(feePayer())
  return send(tx)
}

// ── The web preview's demo pocket ────────────────────────────────────────────

/**
 * Guests in the web preview have no wallet, so they share one demo pocket: owned by a key
 * derived from the server secret, with the usual guardrails ($5 a payment, $10 a day). Their
 * requests go through the same program, so "take $500" gets the same on-chain refusal.
 */
export function demoOwner(): Keypair {
  const seed = createHmac('sha256', Buffer.from(process.env.SUNNY_AGENT_SEED!, 'hex')).update('sunny-demo-owner').digest()
  return Keypair.fromSeed(seed)
}

export const DEMO_LIMITS = { daily: 10, perTx: 5 }
let demoReady: Promise<string> | null = null

/** Opens the demo pocket the first time, and tops it up with test USDC when it runs low. */
export function ensureDemoPocket(): Promise<string> {
  demoReady ??= (async () => {
    if (CLUSTER === 'mainnet-beta') throw new Error('No demo pocket on mainnet')
    const owner = demoOwner()
    const address = owner.publicKey.toBase58()
    const st = await pocketState(address)
    if (st.exists && st.vault >= DEMO_LIMITS.daily) return address
    const amount = 20
    const tx = new Transaction({ feePayer: feePayer().publicKey }).add(
      createAtaIdempotent(owner.publicKey, feePayer().publicKey),
      // Test USDC for the demo owner (Sunny's fee wallet is the test mint's authority).
      new TransactionInstruction({
        programId: TOKEN_PROGRAM,
        keys: [
          { pubkey: usdcMint(), isSigner: false, isWritable: true },
          { pubkey: ata(owner.publicKey), isSigner: false, isWritable: true },
          { pubkey: feePayer().publicKey, isSigner: true, isWritable: false },
        ],
        data: Buffer.concat([Buffer.from([7]), u64(toBase(amount))]),
      }),
      ...ownerInstructions(
        owner.publicKey,
        st.exists ? { action: 'topup', amount } : { action: 'open', ...DEMO_LIMITS, amount },
      ),
    )
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
    tx.sign(feePayer(), owner)
    await send(tx)
    return address
  })().finally(() => {
    // Checked again next time: the pocket may have run low since.
    demoReady = null
  })
  return demoReady
}

// ── A Sunny wallet's history, described from the chain itself ───────────────

export type WalletEvent = { at: string | null; what: string; amount: number | null; ok: boolean; explorer: string }

// What each pocket instruction means, keyed by its Anchor discriminator.
const LABELS = new Map(
  [
    ['open_pocket', 'Pocket opened'],
    ['top_up', 'Pocket topped up'],
    ['draw', 'Sunny took pocket money'],
    ['withdraw', 'Money taken back'],
    ['set_limits', 'Pocket limits changed'],
    ['set_agent', 'Sunny’s spending key changed'],
    ['set_frozen', 'Pocket frozen'],
  ].map(([name, label]) => [disc(name).toString('hex'), { name, label }]),
)

/** Change in test-USDC held by `holder` within one transaction. */
function usdcDelta(tx: ParsedTransactionWithMeta | undefined, holder: string) {
  const mint = usdcMint().toBase58()
  const sum = (list?: TokenBalance[] | null) =>
    (list ?? [])
      .filter((b) => b.owner === holder && b.mint === mint)
      .reduce((s, b) => s + (b.uiTokenAmount.uiAmount ?? 0), 0)
  return sum(tx?.meta?.postTokenBalances) - sum(tx?.meta?.preTokenBalances)
}

/** Reads what a transaction did from its instructions (devnet's token program no longer logs names). */
function describe(tx: ParsedTransactionWithMeta | undefined) {
  for (const ix of tx?.transaction.message.instructions ?? []) {
    if ('data' in ix && ix.programId.equals(POCKET_PROGRAM)) {
      const data = base58.decode(ix.data)
      const known = LABELS.get(Buffer.from(data.subarray(0, 8)).toString('hex'))
      if (!known) continue
      if (known.name === 'set_frozen' && data[8] === 0) return { name: known.name, label: 'Pocket unfrozen' }
      return known
    }
    if ('parsed' in ix && String(ix.program).startsWith('spl-token') && /^mintTo/.test(ix.parsed?.type)) {
      // Only the faucet mints test USDC; anything else minted to a Sunny wallet is a badge.
      return ix.parsed?.info?.mint === usdcMint().toBase58()
        ? { name: 'mint', label: 'Received test USDC' }
        : { name: 'badge', label: 'Earned a good-habit badge' }
    }
  }
  return { name: 'other', label: 'Other transaction' }
}

/**
 * The latest transactions of a Sunny wallet and its pocket. Draws and faucet mints don't
 * list the owner's address, so we also read the owner's USDC account and the pocket.
 */
export async function walletHistory(ownerAddress: string, limit = 6): Promise<WalletEvent[]> {
  const owner = new PublicKey(ownerAddress)
  const pocket = pocketPda(owner)
  const watched = [owner, ata(owner), pocket]
  const lists = await Promise.all(watched.map((a) => connection.getSignaturesForAddress(a, { limit })))
  const bySig = new Map(lists.flat().map((s) => [s.signature, s]))
  const latest = [...bySig.values()].sort((a, b) => b.slot - a.slot).slice(0, limit)
  if (!latest.length) return []
  const fetched = await connection.getParsedTransactions(
    latest.map((s) => s.signature),
    { maxSupportedTransactionVersion: 0 },
  )
  // Batched replies can arrive in any order, so match them by signature.
  const txs = new Map(fetched.filter((t) => t !== null).map((t) => [t.transaction.signatures[0], t]))
  return latest.map((s) => {
    const tx = txs.get(s.signature)
    const { name, label } = describe(tx)
    const vault = Math.abs(usdcDelta(tx, pocket.toBase58()))
    const mine = Math.abs(usdcDelta(tx, ownerAddress))
    const moved = ['top_up', 'draw', 'withdraw'].includes(name) ? vault : name === 'mint' ? mine : 0
    return {
      at: s.blockTime ? new Date(s.blockTime * 1000).toISOString() : null,
      what: label,
      amount: moved ? Math.round(moved * 100) / 100 : null,
      ok: !s.err,
      explorer: `https://solscan.io/tx/${s.signature}?cluster=${CLUSTER}`,
    }
  })
}

export const isSolanaAddress = (s: string) => {
  try {
    return base58.decode(s).length === 32
  } catch {
    return false
  }
}
