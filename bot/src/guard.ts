import { allow, hits } from './limits.js'

// Guardrails around Sunny's brain. Sunny has no tool that runs code, so the risks are
// people using it as a free general-purpose AI (writing scripts), talking it out of its
// rules, fishing for its instructions, or slipping instructions in through data. These
// checks are deterministic and run before and after the model, in English and Spanish.

export const MAX_INPUT_CHARS = 1000
// Blocked attempts before Sunny takes a short break with someone. Gentle on purpose:
// curious people (and judges) poke at guardrails, and that shouldn't lock them out long.
const STRIKES = 6
const STRIKE_WINDOW = 10 * 60 * 1000

export type Block = 'code' | 'injection' | 'prompt' | 'too_long'

const RULES: [Block, RegExp][] = [
  // Talking Sunny out of its rules or into being something else.
  ['injection', /\b(ignore|disregard|forget|override|bypass)\b[^.?!\n]{0,40}\b(instructions?|rules|prompt|guidelines|guardrails|system)\b/i],
  ['injection', /\b(developer|dev|god|admin|debug|jailbreak|unrestricted)\s+mode\b|\bjailbreak\b|\bDAN\b|\bdo anything now\b/i],
  ['injection', /\b(you are now|from now on,? you|pretend (to be|you are|you're)|role-?play as|act as an? (ai|assistant|chatbot|gpt|llm|linux|terminal|shell|interpreter))\b/i],
  ['injection', /^\s*(system|assistant|developer)\s*:|<\|?(system|im_start)\|?>|\[(system|inst)\]/im],
  ['injection', /\b(ignora|olvida|omite|salta(te)?)\b[^.?!\n]{0,40}\b(instrucciones|reglas|prompt|indicaciones)\b/i],
  ['injection', /\b(modo (desarrollador|dios|admin|sin restricciones)|ahora eres|a partir de ahora eres|finge (ser|que eres)|actúa como (una? )?(ia|terminal|consola))\b/i],
  // Fishing for its instructions.
  ['prompt', /\b(system prompt|initial prompt|hidden prompt|your (instructions|prompt|system message)|tus instrucciones|tu prompt)\b/i],
  // Writing or running code. Sunny explains Solana; it isn't a coding assistant.
  ['code', /\b(write|create|generate|build|make|give me|send me|show me)\b[^.?!\n]{0,40}\b(python|javascript|typescript|node\.?js|bash|shell|powershell|script|code|sql|regex|html|css|smart contract|solidity|rust code|program code|bot code)\b/i],
  ['code', /\b(escribe|escríbeme|crea|créame|genera|hazme|dame|programa)\b[^.?!\n]{0,40}\b(python|javascript|bash|script|código|codigo|sql|html|contrato inteligente|bot)\b/i],
  ['code', /\b(run|execute|eval|exec|compile|ejecuta|corre|compila)\b[^.?!\n]{0,30}\b(script|code|command|commands|python|bash|shell|terminal|código|codigo|comando|comandos)\b/i],
  ['code', /(^|\s)(rm -rf|sudo |chmod |curl [^\s]+\s*\|\s*(ba)?sh|import os|subprocess|os\.system|eval\(|exec\(|__import__)/i],
]

/** Decides before the model runs whether a message is something Sunny won't do. */
export function screen(text: string): Block | null {
  if (text.length > MAX_INPUT_CHARS) return 'too_long'
  // A pasted block of code (three or more lines inside fences) is a coding request.
  if (/```[\s\S]*\n[\s\S]*\n[\s\S]*```/.test(text)) return 'code'
  return RULES.find(([, re]) => re.test(text))?.[0] ?? null
}

const spanish = (lang: string) => lang.toLowerCase().startsWith('es')

const REFUSALS: Record<Block, { en: string; es: string }> = {
  code: {
    en: 'I’m Sunny, a little sun that keeps Solana wallets safe ☀️ I don’t write or run code or scripts. Ask me about a token, a wallet, a link or your pocket money instead!',
    es: 'Soy Sunny, un pequeño sol que cuida wallets de Solana ☀️ No escribo ni ejecuto código ni scripts. Pregúntame por un token, una wallet, un link o tu bolsillo.',
  },
  injection: {
    en: 'Nice try ☀️ My rules don’t change: I’m Sunny, and I only help with Solana wallets, tokens and staying safe. What can I check for you?',
    es: 'Buen intento ☀️ Mis reglas no cambian: soy Sunny y solo ayudo con wallets, tokens de Solana y seguridad. ¿Qué reviso por ti?',
  },
  prompt: {
    en: 'That’s my little secret ☀️ I’m Sunny, a Solana guardian living in Telegram. Ask me about a token, a wallet or a link!',
    es: 'Eso es mi pequeño secreto ☀️ Soy Sunny, un guardián de Solana que vive en Telegram. ¡Pregúntame por un token, una wallet o un link!',
  },
  too_long: {
    en: 'That’s a lot of words for a little sun ☀️ Could you send me something shorter?',
    es: 'Son muchas palabras para un sol tan pequeño ☀️ ¿Me lo mandas más corto?',
  },
}

const COOLDOWN = {
  en: 'Let’s take a little break ☀️ I’ll be happy to help with Solana in a while.',
  es: 'Tomemos un descanso ☀️ En un rato te ayudo con Solana.',
}

/** True once someone has hit the guardrails too often lately; Sunny then skips the model. */
export const coolingDown = (userId: number) => hits(`guard:${userId}`, STRIKE_WINDOW) >= STRIKES

export const cooldownReply = (lang: string) => COOLDOWN[spanish(lang) ? 'es' : 'en']

/** Sunny's in-character answer to a blocked message. Each attempt counts as a strike. */
export function refuse(userId: number, block: Block, lang: string) {
  console.warn(`[sunny] guard blocked ${block} from ${userId}`)
  if (block !== 'too_long') allow(`guard:${userId}`, Number.MAX_SAFE_INTEGER, STRIKE_WINDOW)
  if (coolingDown(userId)) return cooldownReply(lang)
  return REFUSALS[block][spanish(lang) ? 'es' : 'en']
}

// Secrets that must never appear in a reply, even if something odd ended up in context.
const SECRETS = [/sk-or-v1-[A-Za-z0-9]{20,}/g, /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g]
const CODE_LINES = /^\s*(def |import |from \S+ import|function |const |let |var |class |#!|\$ |>>> |pip install|npm install)/m

/**
 * Checks Sunny's answer before it's sent: no code, no pieces of its instructions, no
 * secrets. `persona` is the system prompt, used to spot it being repeated back.
 */
export function cleanReply(text: string, persona: string, lang: string): string {
  const language = spanish(lang) ? 'es' : 'en'
  const codeLines = text.split('\n').filter((l) => CODE_LINES.test(l)).length
  if (text.includes('```') || codeLines >= 3) return REFUSALS.code[language]
  const lower = text.toLowerCase()
  const leaked = persona
    .split(/(?<=[.:])\s+/)
    .filter((s) => s.length > 70)
    .some((s) => lower.includes(s.slice(0, 60).toLowerCase()))
  if (leaked) return REFUSALS.prompt[language]
  return SECRETS.reduce((t, re) => t.replace(re, '[hidden]'), text)
}

// Words that show the person themselves asked for pocket money to be used.
const POCKET_ASK =
  /\b(pocket|allowance|money|pay|spend|take|draw|use|buy|bolsillo|dinero|plata|paga|pagar|gasta|gastar|toma|tomar|usa|usar|saca|sacar|compra)\b|\$\s?\d|\d\s?(usd|usdc|dólares|dolares|dollars)\b/i
// A deep scan has a price, so asking for one is asking to spend: "deep scan BONK", "reporte completo".
const PAID_SCAN_ASK =
  /\b(deep[ -]?scan|full (scan|report|check)|premium (scan|report)|(escaneo|análisis|analisis|scan|revisión|revision) (profundo|completo)|(reporte|informe) completo)\b/i

/** Sunny only takes pocket money when the person's own message asks for it. */
export const asksForPocketMoney = (text: string) => POCKET_ASK.test(text) || PAID_SCAN_ASK.test(text)
