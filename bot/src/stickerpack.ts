import type { Api } from 'grammy'

// Sunny's Telegram sticker pack (made with scripts/stickers.ts). The bot looks up the file
// ids once, then sends a sticker at the moments that deserve one.

export type Pose = 'gm' | 'love' | 'wagmi' | 'scam' | 'no' | 'frozen' | 'yum' | 'dyor' | 'dizzy' | 'thanks' | 'hug' | 'gn'
const EMOJI: Record<Pose, string> = {
  gm: '☀️',
  love: '😍',
  wagmi: '🙌',
  scam: '😱',
  no: '🙅',
  frozen: '🥶',
  yum: '🤑',
  dyor: '🔍',
  dizzy: '😵',
  thanks: '☺️',
  hug: '🤗',
  gn: '😴',
}

let packName = ''
const byEmoji = new Map<string, string>()

export const packLink = () => (packName ? `https://t.me/addstickers/${packName}` : null)

/** Loads the pack's file ids; Sunny simply sends no stickers if the pack isn't there. */
export async function loadStickers(api: Api, botUsername: string) {
  packName = `sunny_by_${botUsername}`
  try {
    const set = await api.getStickerSet(packName)
    for (const s of set.stickers) if (s.emoji) byEmoji.set(s.emoji, s.file_id)
    console.log(`[sunny] sticker pack: ${set.stickers.length} stickers`)
  } catch {
    console.warn('[sunny] no sticker pack yet')
  }
}

export const stickerFor = (pose: Pose) => byEmoji.get(EMOJI[pose])
