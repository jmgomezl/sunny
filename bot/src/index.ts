import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bot, GrammyError, HttpError, InlineKeyboard, InputFile, type Context } from 'grammy'
import { startApi } from './api.js'
import { startAlertChecker } from './alerts.js'
import { forget, hasBrain, reply } from './brain.js'
import { startScamLists } from './scams.js'
import { allow, HOUR } from './limits.js'

const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is missing; add it to .env')
// Without an OpenRouter key Sunny still runs (commands, Mini App), it just can't chat freely yet.
const HAS_BRAIN = hasBrain()
if (!HAS_BRAIN) console.warn('[sunny] OPENROUTER_API_KEY is not set: free chat is off until it is added to .env')

const MINI_APP_URL = process.env.MINI_APP_URL || 'https://sunny.aivylabs.xyz'
const AVATAR = join(dirname(fileURLToPath(import.meta.url)), 'sunny-avatar.png')

// The Mini App's chat API runs in this same process, so both share Sunny's memory.
const API_PORT = Number(process.env.SUNNY_API_PORT || 8820)
// Set BOT_POLLING=off to run only the API locally while the server instance owns the bot.
const POLLING = process.env.BOT_POLLING !== 'off'

// Protects the OpenRouter budget: each person gets a steady trickle of AI replies,
// counted together across the Telegram chat and the Mini App.
const allowed = (userId: number) => allow(`u:${userId}`, 40, HOUR)

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
    `Open my sky to make your Sunny wallet: it takes a password and a few seconds. ` +
    `Then you can give me pocket money, and Solana makes sure I never spend more than you allow.\n\n` +
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
      '• /home opens my sky: your Sunny wallet, my pocket money and the wallets I watch\n' +
      '• /check BONK and I’ll tell you how risky a token is, or paste a link and I’ll check it for scams\n' +
      '• /watch BONK 10% and I’ll message you if it drops 10%\n' +
      '• /pocket shows my allowance; /freeze stops me from spending anything',
  ),
)

/** Answers through Sunny's brain, exactly like a chat message. */
async function askBrain(ctx: Context, text: string) {
  if (!HAS_BRAIN) {
    await ctx.reply('My chatty side is still waking up ☀️ For now, try /help or open my sky.', { reply_markup: openSky() })
    return
  }
  if (!allowed(ctx.from!.id)) {
    await ctx.reply('I need a little rest to save my energy ☀️ Let’s pick this up in a bit.')
    return
  }
  await ctx.replyWithChatAction('typing')
  try {
    const answer = await reply(ctx.chat!.id, ctx.from!.first_name, text, ctx.from!.language_code)
    await ctx.reply(answer.live ? `${answer.text}\n\n📡 Live from Jupiter` : answer.text)
  } catch (err) {
    console.error('[sunny] brain error', err)
    await ctx.reply('My thoughts got cloudy for a second. Try me again? ☁️')
  }
}

bot.command('check', async (ctx) => {
  if (!ctx.match) return ctx.reply('Which token? Try /check BONK, paste a mint address, or scan a QR in my sky ☀️')
  await askBrain(ctx, `Is ${ctx.match} safe?`)
})
bot.command('watch', (ctx) => askBrain(ctx, ctx.match ? `Watch ${ctx.match}` : 'Which price alerts do I have?'))
bot.command('pocket', (ctx) => askBrain(ctx, 'How is my pocket money?'))
// Freezing is signed by the owner's own key, which only lives on their phone, so it happens in the sky.
bot.command('freeze', (ctx) =>
  ctx.reply(
    'Only you can freeze me, with your own password ❄️ Open my sky and tap the snowflake under my energy: ' +
      'Solana stops me from spending anything until you warm me up.',
    { reply_markup: openSky() },
  ),
)

bot.on('message:text', (ctx) => askBrain(ctx, ctx.message.text))

bot.on('message', (ctx) => ctx.reply('I can only read text for now ☀️ Tell me what’s on your mind.'))

bot.catch((err) => {
  const e = err.error
  if (e instanceof GrammyError) console.error('[sunny] telegram error', e.description)
  else if (e instanceof HttpError) console.error('[sunny] network error', e)
  else console.error('[sunny] unexpected error', e)
})

async function main() {
  startScamLists()
  startApi(API_PORT, token!)
  if (!POLLING) {
    console.log('[sunny] BOT_POLLING=off: API only')
    return
  }
  await bot.api.setMyCommands(COMMANDS)
  await bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Sunny ☀️', web_app: { url: MINI_APP_URL } } })
  // Price alerts message people in Telegram, with a button back to Sunny's sky.
  startAlertChecker((userId, text) => bot.api.sendMessage(userId, text, { reply_markup: openSky() }))
  const me = await bot.api.getMe()
  console.log(`[sunny] @${me.username} is awake; Mini App at ${MINI_APP_URL}; free chat ${HAS_BRAIN ? 'on' : 'off'}`)
  await bot.start({ drop_pending_updates: true, allowed_updates: ['message'] })
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => bot.stop())

main().catch((err) => {
  console.error('[sunny] failed to start', err)
  process.exit(1)
})
