import { post } from './api'
import { describeTransaction, signMessage } from './vault'

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

export const fetchPocket = () => post<{ wallet: string | null; state: PocketState | null }>('/api/pocket', { op: 'state' })

/** Step 1: the server prepares the transaction; this device decodes it into plain words. */
export async function preparePocket(a: PocketAction, owner: string) {
  const prepared = await post<{ id: string; message: string }>('/api/pocket', { op: 'prepare', ...a })
  return { ...prepared, summary: describeTransaction(prepared.message, owner) }
}

/** Step 2: sign on this device (never on the server) and send it. */
export function submitPocket(prepared: { id: string; message: string }) {
  return post<Sent>('/api/pocket', { op: 'submit', id: prepared.id, signature: signMessage(prepared.message) })
}

export const pocketFaucet = () => post<Sent & { amount: number }>('/api/pocket', { op: 'faucet' })

export const PROGRAM_URL = (cluster: string) =>
  `https://solscan.io/account/7RhPyrf1C4t3QDce8hW19i6FK5wevEEPgBMne8Pt4wvy?cluster=${cluster}`
