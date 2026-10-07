import { post } from './api'

// Good-habit badges: non-transferable tokens Sunny mints to your Sunny wallet on Solana
// the first time you earn them. The server checks every condition itself.

export type Badge = {
  id: string
  name: string
  emoji: string
  how: string
  image: string
  earned: boolean
  /** The mint transaction, once the badge is in your Sunny wallet. */
  tx: string | null
}

export type BadgeSync = { badges: Badge[]; newly: string[]; wallet: string | null }

/** Mints any badge you've earned and returns them all. 'backup' also counts a key backup. */
export const syncBadges = (op: 'sync' | 'backup' = 'sync') => post<BadgeSync>('/api/badges', { op })
