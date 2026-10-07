import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bot, GrammyError, HttpError, InlineKeyboard, InputFile } from 'grammy'
import { forget, reply } from './brain.js'

const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is missing; add it to .env')
if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is missing; add it to .env')

const MINI_APP_URL = process.env.MINI_APP_URL || 'https://sunny.aivylabs.xyz'
const AVATAR = join(dirname(fileURLToPath(import.meta.url)), 'sunny-avatar.png')

// Protects the OpenRouter budget: each person gets a steady trickle of AI replies.
const RATE_WINDOW_MS = 60 * 60 * 1000
const RATE_MAX = 40
const usage = new Map<number, number[]>()

function allowed(userId: number) {
  const now = Date.now()
  const recent = (usage.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (recent.length >= RATE_MAX) return false
  recent.push(now)
  usage.set(userId, recent)
  return true
}

const openSky = () => new InlineKeyboard().webApp('Open Sunny’s sky ☀️', MINI_APP_URL)

const COMMANDS = [
  { command: 'start', description: 'Say hi to Sunny' },
  { command: 'home', description: 'Open Sunny’s sky' },
  { command: 'check', description: 'Is this token safe?' },
  { command: 'watch', description: 'Watch a token for me' },
  { command: 'pocket', description: 'My pocket money' },
  { command: 'freeze', description: 'Freeze my pocket money' },
  { command: 'help', description: 'What can Sunny do?' },
]

const bot = new Bot(token)
let avatarFileId: string | undefined

// Sunny is a personal companion: stay out of groups.
bot.use(async (ctx, next) => {
  if (ctx.chat && ctx.chat.type !== 'private') return
  await next()
})

bot.command('start', async (ctx) => {
  forget(ctx.chat.id)
  const name = ctx.from?.first_name ?? 'friend'
  const caption =
    `Hi ${name}! I’m Sunny ☀️\n\n` +
    `I’m a little sun that keeps your Solana wallet warm and safe. I watch your tokens, ` +
    `warn you about scams, and explain the market in plain words.\n\n` +
    `I only spend the pocket money you give me, and Solana makes sure I can’t go over it.\n\n` +
    `Ask me anything, or open my sky below.`
  const keyboard = openSky()
  if (avatarFileId || existsSync(AVATAR)) {
    const msg = await ctx.replyWithPhoto(avatarFileId ?? new InputFile(AVATAR), { caption, reply_markup: keyboard })
    avatarFileId ??= msg.photo.at(-1)?.file_id
  } else {
    await ctx.reply(caption, { reply_markup: keyboard })
  }
})

bot.command('home', (ctx) => ctx.reply('Here’s my sky. Tap to come in ☀️', { reply_markup: openSky() }))

bot.command('help', (ctx) =>
  ctx.reply(
    'Here’s what I can do ☀️\n\n' +
      '• Chat with me about Solana, wallets and staying safe\n' +
      '• /home opens my sky: your wallet’s weather, the tokens I watch and my pocket money\n\n' +
      'Arriving this week: /check token safety reports, /watch price alerts, and /pocket and /freeze, ' +
      'my on-chain allowance.',
  ),
)

const comingSoon = (what: string) =>
  `${what} is arriving this week ☀️ I’m learning to do it safely first. For now, ask me anything, or open my sky.`

bot.command('check', (ctx) => ctx.reply(comingSoon('Token safety checks'), { reply_markup: openSky() }))
bot.command('watch', (ctx) => ctx.reply(comingSoon('Price alerts'), { reply_markup: openSky() }))
bot.command('pocket', (ctx) =>
  ctx.reply(
    'My pocket money is a small daily allowance you give me on Solana. A program on-chain enforces the limit, ' +
      'so I can pay for safety reports and small swaps but can never spend more than you allowed. ' +
      'Connecting it is arriving this week ☀️',
    { reply_markup: openSky() },
  ),
)
bot.command('freeze', (ctx) =>
  ctx.reply(
    'Freezing stops me from spending anything until you unfreeze me. It goes live together with my pocket money ' +
      'this week ❄️',
  ),
)

bot.on('message:text', async (ctx) => {
  if (!allowed(ctx.from.id)) {
    await ctx.reply('I need a little rest to save my energy ☀️ Let’s pick this up in a bit.')
    return
  }
  await ctx.replyWithChatAction('typing')
  try {
    const answer = await reply(ctx.chat.id, ctx.from.first_name, ctx.message.text)
    await ctx.reply(answer)
  } catch (err) {
    console.error('[sunny] brain error', err)
    await ctx.reply('My thoughts got cloudy for a second. Try me again? ☁️')
  }
})

bot.on('message', (ctx) => ctx.reply('I can only read text for now ☀️ Tell me what’s on your mind.'))

bot.catch((err) => {
  const e = err.error
  if (e instanceof GrammyError) console.error('[sunny] telegram error', e.description)
  else if (e instanceof HttpError) console.error('[sunny] network error', e)
  else console.error('[sunny] unexpected error', e)
})

async function main() {
  await bot.api.setMyCommands(COMMANDS)
  await bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Sunny ☀️', web_app: { url: MINI_APP_URL } } })
  const me = await bot.api.getMe()
  console.log(`[sunny] @${me.username} is awake; Mini App at ${MINI_APP_URL}`)
  await bot.start({ drop_pending_updates: true, allowed_updates: ['message'] })
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => bot.stop())

main().catch((err) => {
  console.error('[sunny] failed to start', err)
  process.exit(1)
})
