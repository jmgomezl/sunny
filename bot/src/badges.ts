import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  createInitializeNonTransferableMintInstruction,
  createMintToInstruction,
  ExtensionType,
  getAssociatedTokenAddressSync,
  getMintLen,
  LENGTH_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TYPE_SIZE,
} from '@solana/spl-token'
import { createInitializeInstruction, pack, type TokenMetadata } from '@solana/spl-token-metadata'
import { connection, explorerTx, feePayer, hasChain, pocketState } from './solana.js'
import { badgesOf, habitsOf, recordBadge, streakOf, watchedOf } from './users.js'
import { vaultOf } from './vaults.js'

// Good-habit badges: non-transferable Token-2022 tokens on devnet, each with on-chain
// metadata, minted to your Sunny wallet the first time you earn them. The server checks
// every condition itself (the pocket on-chain, watched wallets, the streak), so a badge
// can't be claimed by just asking for it. Sunny wears some of them in the Mini App.

export type BadgeId = 'key-keeper' | 'pocket-parent' | 'wallet-watcher' | 'scam-spotter' | 'deep-diver' | 'sunny-streak'

export const BADGES: { id: BadgeId; name: string; symbol: string; emoji: string; how: string }[] = [
  { id: 'key-keeper', name: 'Key Keeper', symbol: 'SKEY', emoji: '🔑', how: 'Back up your Sunny wallet key' },
  { id: 'pocket-parent', name: 'Pocket Parent', symbol: 'SPOCKET', emoji: '🪙', how: 'Give Sunny its first pocket money' },
  { id: 'wallet-watcher', name: 'Wallet Watcher', symbol: 'SWATCH', emoji: '👀', how: 'Ask Sunny to watch a wallet' },
  { id: 'scam-spotter', name: 'Scam Spotter', symbol: 'SSCAM', emoji: '🛡', how: 'Let Sunny catch a scam for you' },
  { id: 'deep-diver', name: 'Deep Diver', symbol: 'SDIVE', emoji: '🔍', how: 'Buy a deep scan over x402' },
  { id: 'sunny-streak', name: 'Sunny Streak', symbol: 'SSTREAK', emoji: '☀️', how: 'Visit Sunny 3 days in a row' },
]
const STREAK_DAYS = 3
const PUBLIC = process.env.MINI_APP_URL || 'https://sunny.aivylabs.xyz'

/** Badge mints, created once by scripts/badges-setup.ts and kept in SUNNY_BADGES. */
export const badgeMints = (): Partial<Record<BadgeId, string>> => {
  try {
    return JSON.parse(process.env.SUNNY_BADGES || '{}')
  } catch {
    return {}
  }
}

/** Creates one badge's mint: non-transferable, 0 decimals, metadata stored on the mint itself. */
export async function createBadgeMint(badge: (typeof BADGES)[number]) {
  const payer = feePayer()
  const mint = Keypair.generate()
  const metadata: TokenMetadata = {
    mint: mint.publicKey,
    name: `Sunny badge: ${badge.name}`,
    symbol: badge.symbol,
    uri: `${PUBLIC}/badges/${badge.id}.json`,
    updateAuthority: payer.publicKey,
    additionalMetadata: [],
  }
  const mintLen = getMintLen([ExtensionType.NonTransferable, ExtensionType.MetadataPointer])
  // The metadata is appended to the mint account later, so its rent is paid up front.
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + TYPE_SIZE + LENGTH_SIZE + pack(metadata).length)
  const tx = new Transaction({ feePayer: payer.publicKey }).add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeNonTransferableMintInstruction(mint.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeMetadataPointerInstruction(mint.publicKey, payer.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(mint.publicKey, 0, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      mint: mint.publicKey,
      metadata: mint.publicKey,
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
      mintAuthority: payer.publicKey,
      updateAuthority: payer.publicKey,
    }),
  )
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
  tx.sign(payer, mint)
  const signature = await connection.sendRawTransaction(tx.serialize())
  await connection.confirmTransaction(signature, 'confirmed')
  return mint.publicKey.toBase58()
}

/** Mints one badge to an owner's wallet and returns the explorer link. */
async function mintBadge(id: BadgeId, owner: string) {
  const payer = feePayer()
  const mint = new PublicKey(badgeMints()[id]!)
  const ownerKey = new PublicKey(owner)
  const ata = getAssociatedTokenAddressSync(mint, ownerKey, false, TOKEN_2022_PROGRAM_ID)
  const tx = new Transaction({ feePayer: payer.publicKey }).add(
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, ownerKey, mint, TOKEN_2022_PROGRAM_ID),
    createMintToInstruction(mint, ata, payer.publicKey, 1, [], TOKEN_2022_PROGRAM_ID),
  )
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
  tx.sign(payer)
  const signature = await connection.sendRawTransaction(tx.serialize())
  await connection.confirmTransaction(signature, 'confirmed')
  return explorerTx(signature)
}

/** Which badges someone has earned right now, checked from their real state. */
async function earned(userId: number, owner: string | null): Promise<Set<BadgeId>> {
  const habits = habitsOf(userId)
  const got = new Set<BadgeId>()
  if (habits.keyBackup) got.add('key-keeper')
  if (habits.scamCaught) got.add('scam-spotter')
  if (habits.deepScan) got.add('deep-diver')
  if (watchedOf(userId).length) got.add('wallet-watcher')
  if (streakOf(userId) >= STREAK_DAYS) got.add('sunny-streak')
  if (owner && hasChain() && (await pocketState(owner).catch(() => null))?.exists) got.add('pocket-parent')
  return got
}

export type BadgeStatus = {
  id: BadgeId
  name: string
  emoji: string
  how: string
  image: string
  earned: boolean
  /** The mint transaction, once the badge is in the person's Sunny wallet. */
  tx: string | null
}

/**
 * Mints any badge someone has earned but doesn't hold yet (it needs their Sunny wallet), and
 * returns every badge's status. `newly` lists the ones minted just now, for a celebration.
 */
export async function syncBadges(userId: number) {
  const owner = vaultOf(userId)?.address ?? null
  const has = await earned(userId, owner)
  const mints = badgeMints()
  const newly: BadgeId[] = []
  for (const id of has) {
    if (badgesOf(userId)[id] || !owner || !mints[id] || !hasChain()) continue
    try {
      recordBadge(userId, id, await mintBadge(id, owner))
      newly.push(id)
    } catch (err) {
      console.warn('[sunny] badge mint failed', id, String(err))
    }
  }
  const minted = badgesOf(userId)
  const badges: BadgeStatus[] = BADGES.map((b) => ({
    id: b.id,
    name: b.name,
    emoji: b.emoji,
    how: b.how,
    image: `${PUBLIC}/badges/${b.id}.png`,
    earned: has.has(b.id) || Boolean(minted[b.id]),
    tx: minted[b.id]?.tx ?? null,
  }))
  return { badges, newly, wallet: owner }
}
