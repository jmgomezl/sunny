import { post } from './api'
// The wallet's crypto (Argon2, ed25519, XChaCha) loads only when a pocket action needs it.
const vault = () => import('./vault')

/** Sunny's pocket on Solana, read from the chain by the server. */
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

export type PocketAction =
  | { action: 'open'; daily: number; perTx: number; amount?: number }
  | { action: 'topup'; amount: number }
  | { action: 'withdraw'; amount: number }
  | { action: 'limits'; daily: number; perTx: number }
  | { action: 'freeze' }
  | { action: 'unfreeze' }

export type Sent = { signature: string; explorer: string; state: PocketState }

export const fetchPocket = () =>
  post<{ wallet: string | null; own?: boolean; state: PocketState | null }>('/api/pocket', { op: 'state' }, { retry: true })

/** Step 1: the server prepares the transaction; this device decodes it into plain words. */
export async function preparePocket(a: PocketAction, owner: string) {
  const [prepared, { describeTransaction }] = await Promise.all([
    post<{ id: string; message: string }>('/api/pocket', { op: 'prepare', ...a }, { retry: true }),
    vault(),
  ])
  return { ...prepared, summary: describeTransaction(prepared.message, owner) }
}

/**
 * Step 2: sign on this device (never on the server) and send it. With a Sunny wallet the key
 * signs here; signed in with your own wallet, that wallet app signs (Seed Vault on a Seeker).
 */
export async function submitPocket(prepared: { id: string; message: string }, external = false) {
  const signature = external
    ? await (await import('./wallets')).signPocketTransaction(prepared.message)
    : (await vault()).signMessage(prepared.message)
  // Safe to repeat: the server answers a repeated submit with the first result.
  return post<Sent>('/api/pocket', { op: 'submit', id: prepared.id, signature }, { retry: true })
}

export const pocketFaucet = () => post<Sent & { amount: number }>('/api/pocket', { op: 'faucet' })

export const PROGRAM_URL = (cluster: string) =>
  `https://solscan.io/account/7RhPyrf1C4t3QDce8hW19i6FK5wevEEPgBMne8Pt4wvy?cluster=${cluster}`
