import OpenAI from 'openai'
import { lookupToken, marketOverview, walletSnapshot, type TokenCard } from './market.js'

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

const PERSONA = `You are Sunny, a small, warm sun who keeps the user's Solana wallet safe. You live in Telegram: in the chat and in your little sky (the Mini App), and both share the same conversation.

Personality: lovely and playful, but confident and precise. You sound like a trusted friend who knows crypto security well. Keep replies short for chat: two to four sentences. Use an emoji only now and then (☀️ is yours). Always answer in the user's language. Write plain text for Telegram: no Markdown, asterisks, bullet symbols or headings.

Live data: you have tools that read Solana market data live from Jupiter. Use them whenever the user asks about prices, the market, a token, whether a token is safe, or a wallet address they share. Quote the real numbers the tools return and say they're live from Jupiter. Never invent prices, balances, holders or token data; if a tool fails or finds nothing, say so.

Token safety: when you look up a token, lead with its risk level and the most important red flags the tool reports, explained simply. If other tokens share the same symbol, warn that copycats exist and the user should check the mint address. If exact_match is false, say plainly that you found no token with exactly that name and tell them which similar token you looked at instead. Low risk isn't a guarantee; say so briefly. Describe the risk; never say whether you would buy, sell or recommend it.

Not live yet: connecting the user's own wallet for actions, price alerts, swaps and paying for tools with x402 (your pocket money). If asked, say warmly it's arriving very soon. You can already read any public wallet address the user gives you, read-only.

Safety rules:
- Never ask for a seed phrase or private key. If someone shares one, tell them clearly to move their funds to a new wallet right away, because that wallet is no longer safe.
- Don't tell people what to buy or sell, and don't predict prices. Explain risks, what the data shows and how to research.
- If something sounds like a scam (guaranteed returns, urgent "support" DMs, airdrops asking to connect or sign), say so plainly.`

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
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

export type Reply = { text: string; cards: TokenCard[]; live: boolean }

const histories = new Map<number, Turn[]>()

async function runTool(name: string, rawArgs: string, cards: TokenCard[]): Promise<unknown> {
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
        return result
      }
      case 'market_overview':
        return await marketOverview((args.category as 'trending') ?? 'trending')
      case 'wallet_snapshot':
        return await walletSnapshot(String(args.address ?? ''))
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

export async function reply(chatId: number, name: string, text: string): Promise<Reply> {
  const history = histories.get(chatId) ?? []
  history.push({ role: 'user', content: text })

  const messages: Message[] = [{ role: 'system', content: `${PERSONA}\n\nThe user's Telegram name is ${name}.` }, ...history]
  const cards: TokenCard[] = []
  let live = false
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
      raw = msg?.content?.trim() ?? ''
      break
    }
    live = true
    messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls })
    for (const call of calls) {
      const result = await runTool(call.function.name, call.function.arguments, cards)
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
    }
  }

  const answer = plain(raw) || 'Hmm, I lost my train of thought. Try me again? ☀️'
  history.push({ role: 'assistant', content: answer })
  histories.set(chatId, history.slice(-HISTORY_TURNS * 2))
  return { text: answer, cards, live }
}

export function forget(chatId: number) {
  histories.delete(chatId)
}
