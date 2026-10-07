// Creates Sunny's Telegram sticker pack from brand/stickers/*.png (captured from the real
// character with the Mini App's ?sticker=<pose> stage). The pack belongs to STICKER_OWNER_ID,
// a Telegram user who has started the bot; they can manage it in @Stickers.
// Run: STICKER_OWNER_ID=<telegram id> node --env-file=../.env --import tsx scripts/stickers.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const token = process.env.TELEGRAM_BOT_TOKEN!
const owner = process.env.STICKER_OWNER_ID
if (!owner) throw new Error('Set STICKER_OWNER_ID to the Telegram id that will own the pack')
const API = `https://api.telegram.org/bot${token}`
const DIR = join(import.meta.dirname, '../../brand/stickers')

// In the order people will see them, with the emoji Telegram suggests each one for.
const STICKERS: [string, string][] = [
  ['gm', '☀️'],
  ['love', '😍'],
  ['wagmi', '🙌'],
  ['scam', '😱'],
  ['no', '🙅'],
  ['frozen', '🥶'],
  ['yum', '🤑'],
  ['dyor', '🔍'],
  ['dizzy', '😵'],
  ['thanks', '☺️'],
  ['hug', '🤗'],
  ['gn', '😴'],
]

const me = (await (await fetch(`${API}/getMe`)).json()) as { result: { username: string } }
const name = `sunny_by_${me.result.username}`

async function call(method: string, fields: Record<string, string>, file: [string, string]) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  form.set('s0', new Blob([readFileSync(join(DIR, `${file[0]}.png`))], { type: 'image/png' }), `${file[0]}.png`)
  const sticker = { sticker: 'attach://s0', format: 'static', emoji_list: [file[1]] }
  form.set(method === 'createNewStickerSet' ? 'stickers' : 'sticker', JSON.stringify(method === 'createNewStickerSet' ? [sticker] : sticker))
  const res = (await (await fetch(`${API}/${method}`, { method: 'POST', body: form })).json()) as { ok: boolean; description?: string }
  if (!res.ok) throw new Error(`${method} ${file[0]}: ${res.description}`)
}

const existing = (await (await fetch(`${API}/getStickerSet?name=${name}`)).json()) as { ok: boolean; result?: { stickers: unknown[] } }
if (existing.ok) {
  console.log(`The pack already exists with ${existing.result!.stickers.length} stickers: https://t.me/addstickers/${name}`)
  process.exit(0)
}
const [first, ...rest] = STICKERS
await call('createNewStickerSet', { user_id: owner, name, title: 'Sunny ☀️ your Solana guardian' }, first)
console.log('created the pack with', first[0])
for (const s of rest) {
  await call('addStickerToSet', { user_id: owner, name }, s)
  console.log('added', s[0])
}
console.log(`Done: https://t.me/addstickers/${name}`)
