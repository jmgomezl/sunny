import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, sequentialize, type RunnerHandle } from '@grammyjs/runner'
import { Bot, GrammyError, HttpError, InlineKeyboard, InputFile, type Context } from 'grammy'
import { startApi } from './api.js'
import { startRefunds } from './refunds.js'
import { hasChain } from './solana.js'
import { startAlertChecker } from './alerts.js'
import { forget, hasBrain, reply } from './brain.js'
import { secretWarning, sharedSecret } from './guard.js'
import { startScamLists } from './scams.js'
import { allow, HOUR } from './limits.js'
import { ago, KIND_ICON, latestNews, startNews, type NewsItem } from './news.js'
import { handleGroup, linksIn } from './groups.js'
import { newsSubscribers, setMorning, setNewsAlerts, touch } from './users.js'
import { briefFor, startMorning } from './morning.js'
import { loadStickers, packLink, stickerFor, type Pose } from './stickerpack.js'

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
  { command: 'news', description: 'What’s happening on Solana' },
  { command: 'morning', description: 'My good-morning note' },
  { command: 'stickers', description: 'Get Sunny’s sticker pack' },
  { command: 'pocket', description: 'My pocket money' },
  { command: 'freeze', description: 'Freeze my pocket money' },
  { command: 'help', description: 'What can Sunny do?' },
]

const bot = new Bot(token)
let avatarFileId: string | undefined
let runner: RunnerHandle | undefined

// Updates are handled concurrently, one at a time per chat: a slow link or a long answer in one
// chat never holds up anyone else, and each chat's messages still go in order.
bot.use(sequentialize((ctx) => ctx.chat?.id.toString()))

// In private chats Sunny is a companion. In groups it's a quiet guardian (see groups.ts),
// and channels are left alone.
bot.use(async (ctx, next) => {
  if (ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup') return handleGroup(ctx)
  if (ctx.chat && ctx.chat.type !== 'private') return
  if (ctx.message && ctx.from) touch(ctx.from.id, ctx.from.first_name, ctx.from.language_code)
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
    `Run a Telegram group? Add me and I’ll quietly warn everyone about scam links (in Spanish or English).\n\n` +
    `Ask me anything, or open my sky below.`
  // Scams start in group chats: the second way in is bringing Sunny to yours.
  const keyboard = openSky().row().url('🛡 Add me to your group', `https://t.me/${ctx.me.username}?startgroup=guard`)
  if (avatarFileId || existsSync(AVATAR)) {
    const msg = await ctx.replyWithPhoto(avatarFileId ?? new InputFile(AVATAR), { caption, reply_markup: keyboard })
    avatarFileId ??= msg.photo.at(-1)?.file_id
  } else {
    await ctx.reply(caption, { reply_markup: keyboard })
  }
  const wave = stickerFor('gm')
  if (wave) await ctx.replyWithSticker(wave).catch(() => {})
})

bot.command('home', (ctx) => ctx.reply('Here’s my sky. Tap to come in ☀️', { reply_markup: openSky() }))

bot.command('help', (ctx) =>
  ctx.reply(
    'Here’s what I can do ☀️\n\n' +
      '• Chat with me about Solana, wallets and staying safe\n' +
      '• /home opens my sky: your Sunny wallet, my pocket money and the wallets I watch\n' +
      '• /check BONK and I’ll tell you how risky a token is, or paste a link and I’ll check it for scams\n' +
      '• /watch BONK 10% and I’ll message you if it drops 10%\n' +
      '• /pocket shows my allowance; /freeze stops me from spending anything\n' +
      '• /news shows what’s happening on Solana. I warn you here about hacks and scams (/news off to stop)\n' +
      '• Add me to a group and I’ll quietly guard it from phishing links and risky tokens\n' +
      '• Every morning I send your wallets’ weather and a safety tip (/morning to preview, /morning off to stop)\n' +
      '• Paste a Blink and I’ll tell you what it would do before you sign\n' +
      '• /stickers for my sticker pack ☀️',
  ),
)

/** Answers through Sunny's brain, exactly like a chat message. */
async function askBrain(ctx: Context, text: string) {
  if (!HAS_BRAIN) {
    await ctx.reply('My chatty side is still waking up ☀️ For now, try /help or open my sky.', { reply_markup: openSky() })
    return
  }
  if (!allowed(ctx.from!.id)) {
    const es = (ctx.from!.language_code ?? '').startsWith('es')
    // A pasted recovery phrase gets its warning even when Sunny is resting.
    if (sharedSecret(text)) return void (await ctx.reply(secretWarning(ctx.from!.language_code ?? 'en')))
    await ctx.reply(
      es
        ? 'Necesito descansar un ratito para recargar energía ☀️ Seguimos en unos minutos.'
        : 'I need a little rest to save my energy ☀️ Let’s pick this up in a few minutes.',
    )
    return
  }
  await ctx.replyWithChatAction('typing')
  try {
    const answer = await reply(ctx.chat!.id, ctx.from!.first_name, text, ctx.from!.language_code)
    await ctx.reply(answer.live ? `${answer.text}\n\n📡 Live from Jupiter` : answer.text)
    // A sticker for the moments that deserve one.
    const pose: Pose | null = answer.blinks.some((b) => b.verdict === 'danger')
      ? 'scam'
      : answer.pocket.some((p) => !p.ok)
        ? 'no'
        : answer.scans.length
          ? 'dyor'
          : null
    const sticker = pose && stickerFor(pose)
    if (sticker) await ctx.replyWithSticker(sticker).catch(() => {})
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
const NOT_ADVICE = 'From public sources. It’s news, not financial advice: I’m not an investment advisor.'

bot.command('news', async (ctx) => {
  const arg = ctx.match.trim().toLowerCase()
  if (arg === 'off' || arg === 'on') {
    setNewsAlerts(ctx.from!.id, arg === 'on')
    return ctx.reply(
      arg === 'on'
        ? 'Got it! I’ll warn you here when a Solana hack, exploit or scam hits the news 🚨'
        : 'Okay, no more security alerts from me. /news on brings them back ☀️',
    )
  }
  const latest = latestNews('all', 6)
  if (!latest.length) return ctx.reply('My news desk is still waking up ☀️ Try again in a minute.')
  const lines = latest.map((it) => `${KIND_ICON[it.kind]} ${it.title}\n${it.source} · ${ago(it.at)}\n${it.link}`)
  await ctx.reply(`Here’s what’s happening on Solana ☀️\n\n${lines.join('\n\n')}\n\n${NOT_ADVICE}\n/news off stops security alerts.`, {
    link_preview_options: { is_disabled: true },
  })
})

/** Warns everyone who hasn't opted out about a fresh Solana hack, exploit or scam. */
async function broadcastAlert(item: NewsItem) {
  const text =
    `🚨 Heads up from Sunny\n${item.title}\n${item.source} · ${ago(item.at)}\n${item.link}\n\n` +
    'If you’ve used it: don’t sign anything new from it, and check your token approvals. Ask me if you’re unsure ☀️\n' +
    '(/news off stops these alerts)'
  const people = newsSubscribers()
  console.log(`[sunny] security alert to ${people.length} people: ${item.title}`)
  for (const id of people) {
    await bot.api.sendMessage(id, text).catch((err) => {
      // Blocked the bot or never chatted with it: stop trying.
      if (err instanceof GrammyError && (err.error_code === 403 || err.error_code === 400)) setNewsAlerts(id, false)
    })
    await new Promise((r) => setTimeout(r, 60))
  }
}

bot.command('morning', async (ctx) => {
  const arg = ctx.match.trim().toLowerCase()
  const es = ctx.from?.language_code?.startsWith('es')
  if (arg === 'off' || arg === 'on') {
    setMorning(ctx.from!.id, arg === 'on')
    return ctx.reply(
      arg === 'on'
        ? es
          ? '¡Listo! Te saludo cada mañana con el clima de tus wallets y un consejo ☀️'
          : 'Yay! I’ll say good morning every day with your wallets’ weather and a tip ☀️'
        : es
          ? 'Vale, sin notas de la mañana. /morning on las trae de vuelta.'
          : 'Okay, no more morning notes. /morning on brings them back.',
    )
  }
  // A preview right now, so people see what they'll get.
  await ctx.replyWithChatAction('typing')
  await ctx.reply(await briefFor(ctx.from!.id, ctx.from!.first_name, ctx.from!.language_code), {
    reply_markup: openSky(),
    link_preview_options: { is_disabled: true },
  })
})

bot.command('stickers', async (ctx) => {
  const link = packLink()
  const hi = stickerFor('love')
  if (hi) await ctx.replyWithSticker(hi).catch(() => {})
  await ctx.reply(link ? `Here’s my sticker pack ☀️ ${link}` : 'My stickers are still drying in the sun ☀️')
})

bot.command('pocket', (ctx) => askBrain(ctx, 'How is my pocket money?'))
// Freezing is signed by the owner's own key, which only lives on their phone, so it happens in the sky.
bot.command('freeze', (ctx) =>
  ctx.reply(
    'Only you can freeze me, with your own password ❄️ Open my sky and tap the snowflake under my energy: ' +
      'Solana stops me from spending anything until you warm me up.',
    { reply_markup: openSky() },
  ),
)

bot.on(['message:text', 'message:caption'], async (ctx) => {
  const text = ctx.message.text ?? ctx.message.caption ?? ''
  // A pasted recovery phrase or key is taken out of the chat right away (Sunny's answer explains).
  if (sharedSecret(text)) await ctx.deleteMessage().catch(() => {})
  // Links hidden behind words ("Claim here") or in a photo's caption are part of what was sent.
  const hidden = linksIn(ctx.message).filter((link) => !text.includes(link))
  await askBrain(ctx, hidden.length ? `${text}\n${hidden.join('\n')}` : text)
})

bot.on('message', (ctx) => ctx.reply('I can only read text for now ☀️ Tell me what’s on your mind.'))

bot.catch((err) => {
  const e = err.error
  if (e instanceof GrammyError) console.error('[sunny] telegram error', e.description)
  else if (e instanceof HttpError) console.error('[sunny] network error', e)
  else console.error('[sunny] unexpected error', e)
})

async function main() {
  startScamLists()
  // Security alerts go out only from the live bot, never from a local API-only run.
  startNews(POLLING ? broadcastAlert : undefined)
  startApi(API_PORT, token!)
  // Refunds owed from before a restart are picked up again.
  if (hasChain()) startRefunds()
  if (!POLLING) {
    console.log('[sunny] BOT_POLLING=off: API only')
    return
  }
  await bot.api.setMyCommands(COMMANDS)
  await bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Sunny ☀️', web_app: { url: MINI_APP_URL } } })
  // Price alerts message people in Telegram, with a button back to Sunny's sky.
  startAlertChecker((userId, text) => bot.api.sendMessage(userId, text, { reply_markup: openSky() }))
  // The good-morning note, once a day; people who blocked Sunny are taken off the list.
  startMorning(async (userId, text) => {
    await bot.api
      .sendMessage(userId, text, { reply_markup: openSky(), link_preview_options: { is_disabled: true } })
      .catch((err) => {
        if (err instanceof GrammyError && (err.error_code === 403 || err.error_code === 400)) setMorning(userId, false)
        throw err
      })
  })
  const me = await bot.api.getMe()
  await loadStickers(bot.api, me.username)
  console.log(`[sunny] @${me.username} is awake; Mini App at ${MINI_APP_URL}; free chat ${HAS_BRAIN ? 'on' : 'off'}`)
  await bot.api.deleteWebhook({ drop_pending_updates: true })
  runner = run(bot, { runner: { fetch: { allowed_updates: ['message', 'my_chat_member'] } } })
}

// The API server would keep the process alive on its own, so shutting down exits explicitly.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void Promise.resolve(runner?.isRunning() ? runner.stop() : undefined).finally(() => process.exit(0)))
}
// One request gone wrong must never take Sunny down for everyone: log it and keep going.
process.on('unhandledRejection', (err) => console.error('[sunny] unhandled rejection', err))
process.on('uncaughtException', (err) => console.error('[sunny] uncaught exception', err))

main().catch((err) => {
  console.error('[sunny] failed to start', err)
  process.exit(1)
})
