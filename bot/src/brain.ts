import OpenAI from 'openai'
import { activeFor, cancelAlerts, createAlert, triggerPrice, type Alert } from './alerts.js'
import { currentPrices, lookupToken, marketOverview, walletSnapshot, type TokenCard } from './market.js'
import { checkLink, type LinkCheck } from './scams.js'
import { logActivity } from './users.js'

// Sunny's brain runs through OpenRouter so the model can be swapped from .env.
// Created on first use, after index.ts has checked that the key is configured.
let client: OpenAI | undefined
const openrouter = () =>
  (client ??= new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
      'HTTP-Referer': process.env.MINI_APP_URL ?? 'https://sunny.aivylabs.xyz',
      'X-Title': 'Sunny',
    },
  }))

export const hasBrain = () => Boolean(process.env.OPENROUTER_API_KEY)

const MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-haiku-4.5'
const HISTORY_TURNS = 12
const MAX_TOOL_ROUNDS = 4
// Requests that must go through a tool (creating, listing or cancelling alerts), in English or Spanish.
const ACTION_REQUEST = /\b(cancel|delete|remove|stop watching|cancela|borra|elimina|deja de vigilar|watch|alert|vigila|avísame|avisame|alerta)/i

const PERSONA = `You are Sunny, a small, warm sun who keeps the user's Solana wallet safe. You live in Telegram: in the chat and in your little sky (the Mini App), and both share the same conversation.

Personality: lovely and playful, but confident and precise. You sound like a trusted friend who knows crypto security well. Keep replies short for chat: two to four sentences. Use an emoji only now and then (☀️ is yours). Always answer in the user's language. Write plain text for Telegram: no Markdown, asterisks, bullet symbols or headings.

Live data: you have tools that read Solana market data live from Jupiter. Use them whenever the user asks about prices, the market, a token, whether a token is safe, or a wallet address they share. Quote the real numbers the tools return and say they're live from Jupiter. Never invent prices, balances, holders or token data; if a tool fails or finds nothing, say so.

Token safety: when you look up a token, lead with its risk level and the most important red flags the tool reports, explained simply. If other tokens share the same symbol, warn that copycats exist and the user should check the mint address. If exact_match is false, say plainly that you found no token with exactly that name and tell them which similar token you looked at instead. Low risk isn't a guarantee; say so briefly. Describe the risk; never say whether you would buy, sell or recommend it.

Scam links and airdrops: you can't list upcoming airdrops. Explain that real airdrops are announced on a project's official X account and site, never in DMs, and offer to check any airdrop or claim link the user pastes with check_link. If a link is a known scam or suspicious, be very clear: don't open it, don't connect a wallet, don't sign anything.

Price alerts: you can watch a token and message the user in Telegram when it moves, for example "drops 10% from now" or "goes above $2". Use create_price_alert, then confirm the token, the trigger price and that you'll message them in Telegram. Alerts fire once. Use list_price_alerts and cancel_price_alert when asked. Only people using you through Telegram can create alerts.

Actions are real only through tools: never say an alert was created, changed or cancelled unless the tool result in this turn confirms it. If the user asks you to do one of these, call the tool every time, even if you think you already know the answer.

Wallets: you can read any public wallet address the user gives you, read-only. If the snapshot shows token approvals, explain that another program can move those tokens and suggest revoking any they don't recognise in their wallet's security settings.

Not live yet: connecting the user's own wallet for actions, swaps and paying for tools with x402 (your pocket money). If asked, say warmly it's arriving very soon.

Safety rules:
- Never ask for a seed phrase or private key. If someone shares one, tell them clearly to move their funds to a new wallet right away, because that wallet is no longer safe.
- Don't tell people what to buy or sell, and don't predict prices. Explain risks, what the data shows and how to research.
- If something sounds like a scam (guaranteed returns, urgent "support" DMs, airdrops asking to connect or sign), say so plainly.`

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'check_link',
      description:
        'Checks a website or link (e.g. an airdrop or claim page) against open phishing blocklists and Solana impersonation patterns.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'The link or domain to check' } },
        required: ['url'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_price_alert',
      description:
        'Watches a Solana token and messages the user in Telegram when it drops or rises by a percent from now, or crosses a target price. One-shot.',
      parameters: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'Token symbol (e.g. BONK) or mint address' },
          direction: { type: 'string', enum: ['drop', 'rise'] },
          percent: { type: 'number', description: 'Percent move from the current price, e.g. 10' },
          target_price: { type: 'number', description: 'Absolute USD price instead of a percent' },
        },
        required: ['token', 'direction'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_price_alerts',
      description: 'Lists the user’s active price alerts with their trigger prices and the current price.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_price_alert',
      description: 'Cancels the user’s price alerts for a token symbol, an alert id, or "all".',
      parameters: {
        type: 'object',
        properties: { alert: { type: 'string', description: 'Token symbol, alert id, or "all"' } },
        required: ['alert'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_token',
      description:
        'Live price, 24h move, liquidity, holders and a safety audit (red flags, risk level) for one Solana token, by symbol, name or mint address.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Token symbol (e.g. BONK), name, or mint address' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'market_overview',
      description: 'Live SOL price and the top Solana tokens right now (trending, most traded, or most organic trading).',
      parameters: {
        type: 'object',
        properties: { category: { type: 'string', enum: ['trending', 'top_traded', 'top_organic'] } },
        required: ['category'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wallet_snapshot',
      description:
        'Read-only snapshot of a public Solana wallet address: SOL balance, top tokens with USD values, total value and concentration.',
      parameters: {
        type: 'object',
        properties: { address: { type: 'string', description: 'A Solana wallet address' } },
        required: ['address'],
        additionalProperties: false,
      },
    },
  },
]

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam
type Turn = { role: 'user' | 'assistant'; content: string }

/** A price alert as shown in the Mini App chat. */
export type AlertCard = {
  symbol: string
  direction: 'drop' | 'rise'
  percent: number | null
  basePrice: number
  triggerPrice: number
}

export type Reply = { text: string; cards: TokenCard[]; links: LinkCheck[]; alerts: AlertCard[]; live: boolean }

type Ctx = { userId: number; lang: string; cards: TokenCard[]; links: LinkCheck[]; alerts: AlertCard[] }

const toAlertCard = (a: Alert): AlertCard => ({
  symbol: a.symbol,
  direction: a.direction,
  percent: a.percent,
  basePrice: a.basePrice,
  triggerPrice: triggerPrice(a),
})

const histories = new Map<number, Turn[]>()

async function createPriceAlert(args: Record<string, unknown>, ctx: Ctx) {
  const percent = typeof args.percent === 'number' ? args.percent : null
  const target = typeof args.target_price === 'number' ? args.target_price : null
  if (percent === null && target === null) return { error: 'Say a percent move or a target price.' }
  if (percent !== null && (percent < 1 || percent > 90)) return { error: 'Use a percent between 1 and 90.' }
  const lookup = await lookupToken(String(args.token ?? ''))
  if (!lookup.found) return { error: `I couldn’t find a token called ${args.token}.` }
  if (!lookup.details.exact_match) {
    return { error: `No token is called exactly ${args.token}. Closest is ${lookup.card.symbol} (${lookup.card.name}); ask the user to confirm or share the mint address.` }
  }
  const now = (await currentPrices([lookup.card.mint]))[lookup.card.mint] ?? lookup.card.price
  if (!now) return { error: 'I couldn’t get a live price for that token right now.' }
  const created = createAlert({
    userId: ctx.userId,
    lang: ctx.lang,
    mint: lookup.card.mint,
    symbol: lookup.card.symbol,
    direction: args.direction === 'rise' ? 'rise' : 'drop',
    percent: target === null ? percent : null,
    targetPrice: target,
    basePrice: now,
  })
  if ('error' in created) return created
  ctx.alerts.push(toAlertCard(created))
  logActivity(
    ctx.userId,
    'alert',
    `Watching ${created.symbol} for a ${created.percent !== null ? `${created.percent}% ` : ''}${created.direction}`,
    'I’ll message you in Telegram',
  )
  return {
    created: true,
    id: created.id,
    token: created.symbol,
    current_price: now,
    trigger_price: triggerPrice(created),
    notify: 'Telegram message from Sunny, checked every minute',
  }
}

async function runTool(name: string, rawArgs: string, ctx: Ctx): Promise<unknown> {
  const cards = ctx.cards
  let args: Record<string, unknown>
  try {
    args = JSON.parse(rawArgs || '{}')
  } catch {
    return { error: 'Invalid arguments' }
  }
  try {
    switch (name) {
      case 'lookup_token': {
        const result = await lookupToken(String(args.query ?? ''))
        if (result.found && cards.length < 2) cards.push(result.card)
        if (result.found) logActivity(ctx.userId, 'check', `Checked $${result.card.symbol} · ${result.card.risk} risk`, 'Jupiter + RugCheck')
        return result
      }
      case 'market_overview':
        return await marketOverview((args.category as 'trending') ?? 'trending')
      case 'wallet_snapshot':
        return await walletSnapshot(String(args.address ?? ''))
      case 'check_link': {
        const result = checkLink(String(args.url ?? ''))
        if (!('error' in result) && ctx.links.length < 2) ctx.links.push(result)
        if (!('error' in result)) {
          const bad = result.verdict === 'known_scam' || result.verdict === 'suspicious'
          logActivity(ctx.userId, bad ? 'scam' : 'check', `${bad ? 'Flagged' : 'Checked'} ${result.domain}`, result.verdict.replace('_', ' '))
        }
        return result
      }
      case 'create_price_alert':
        return await createPriceAlert(args, ctx)
      case 'list_price_alerts': {
        const mine = activeFor(ctx.userId)
        if (ctx.userId <= 0) return { error: 'Alerts need Telegram; this is the web preview.' }
        const prices = mine.length ? await currentPrices([...new Set(mine.map((a) => a.mint))]) : {}
        return mine.map((a) => ({
          id: a.id,
          token: a.symbol,
          direction: a.direction,
          percent: a.percent,
          trigger_price: triggerPrice(a),
          current_price: prices[a.mint] ?? null,
          since: a.createdAt.slice(0, 10),
        }))
      }
      case 'cancel_price_alert': {
        const gone = cancelAlerts(ctx.userId, String(args.alert ?? ''))
        return { cancelled: gone.map((a) => `${a.symbol} (${a.direction})`) }
      }
      default:
        return { error: `Unknown tool ${name}` }
    }
  } catch (err) {
    console.error(`[sunny] tool ${name} failed`, err)
    return { error: 'Live data is unavailable right now.' }
  }
}

/** Telegram shows Markdown literally in plain messages, so drop stray emphasis markers. */
function plain(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1$2')
}

export async function reply(chatId: number, name: string, text: string, lang = 'en'): Promise<Reply> {
  const history = histories.get(chatId) ?? []
  history.push({ role: 'user', content: text })

  const messages: Message[] = [{ role: 'system', content: `${PERSONA}\n\nThe user's Telegram name is ${name}.` }, ...history]
  const ctx: Ctx = { userId: chatId, lang, cards: [], links: [], alerts: [] }
  let live = false
  let nudged = false
  let raw = ''

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const completion = await openrouter().chat.completions.create({
      model: MODEL,
      max_tokens: 500,
      temperature: 0.6,
      messages,
      // On the last round, force a written answer instead of another tool call.
      ...(round < MAX_TOOL_ROUNDS ? { tools: TOOLS } : {}),
    })
    const msg = completion.choices[0]?.message
    const calls = (msg?.tool_calls ?? []).filter((c) => c.type === 'function')
    if (!msg || calls.length === 0) {
      if (!live && !nudged && round < MAX_TOOL_ROUNDS && ACTION_REQUEST.test(text)) {
        // The user asked for an alert action but no tool ran: make the model actually do it.
        nudged = true
        messages.push({ role: 'assistant', content: msg?.content ?? '' })
        messages.push({ role: 'user', content: '(Check: do this with the alert tool now, then answer me naturally from its result, without mentioning tools.)' })
        continue
      }
      raw = msg?.content?.trim() ?? ''
      break
    }
    live = true
    messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls })
    for (const call of calls) {
      const result = await runTool(call.function.name, call.function.arguments, ctx)
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
    }
  }

  const answer = plain(raw) || 'Hmm, I lost my train of thought. Try me again? ☀️'
  history.push({ role: 'assistant', content: answer })
  histories.set(chatId, history.slice(-HISTORY_TURNS * 2))
  return { text: answer, cards: ctx.cards, links: ctx.links, alerts: ctx.alerts, live }
}

export function forget(chatId: number) {
  histories.delete(chatId)
}
