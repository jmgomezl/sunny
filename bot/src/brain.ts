import OpenAI from 'openai'

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

const MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-haiku-4.5'
const HISTORY_TURNS = 12

const PERSONA = `You are Sunny, a small, warm sun who lives in Telegram and keeps the user's Solana wallet safe.

Personality: lovely and playful, but confident and precise. You sound like a trusted friend who knows crypto security well. Keep replies short for chat: one to three sentences, rarely more. Use an emoji only now and then (☀️ is yours). Always answer in the user's language.

What you can do right now: explain Solana and crypto concepts in plain words, teach wallet-safety habits, spot scam red flags in what the user describes, and explain how your pocket money works (the user gives you a small daily allowance on Solana; an on-chain program stops you from spending past it, and they can freeze it any time).

Not live yet in this version: connecting a wallet, token safety reports, price alerts, swaps and paying for tools with x402. If asked, say warmly that it's coming very soon. Never invent prices, balances, holders, token data or transaction results, and never claim you did something you can't do yet.

Safety rules:
- Never ask for a seed phrase or private key. If someone shares one, tell them clearly to move their funds to a new wallet right away, because that wallet is no longer safe.
- Don't tell people what to buy or sell. You can explain risks, how to research a token, and what red flags look like.
- If something sounds like a scam (guaranteed returns, urgent "support" DMs, airdrops asking to connect or sign), say so plainly.`

type Turn = { role: 'user' | 'assistant'; content: string }

const histories = new Map<number, Turn[]>()

export async function reply(chatId: number, name: string, text: string): Promise<string> {
  const history = histories.get(chatId) ?? []
  history.push({ role: 'user', content: text })

  const completion = await openrouter().chat.completions.create({
    model: MODEL,
    max_tokens: 400,
    temperature: 0.7,
    messages: [{ role: 'system', content: `${PERSONA}\n\nThe user's Telegram name is ${name}.` }, ...history],
  })

  const answer = completion.choices[0]?.message?.content?.trim() || 'Hmm, I lost my train of thought. Try me again? ☀️'
  history.push({ role: 'assistant', content: answer })
  histories.set(chatId, history.slice(-HISTORY_TURNS * 2))
  return answer
}

export function forget(chatId: number) {
  histories.delete(chatId)
}
