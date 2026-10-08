import { Keypair } from '@solana/web3.js'
import { base58 } from '@scure/base'
import { wordlist } from '@scure/bip39/wordlists/english.js'
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

// Each rule may carry an exception: the same words inside an honest question are fine
// ("my friend said to enable developer mode in Phantom, is that safe?").
const WALLET_NEARBY = /\b(phantom|solflare|backpack|wallet|billetera|cartera)\b/i
// Someone asking whether something is a scam is exactly who Sunny is for.
const SAFETY_QUESTION =
  /\b(scam|scammer|safe|legit|risk|risks|risky|phishing|fraud|should i|is (it|this|that) (ok|okay|real|fine)|estafa|segur[oa]|riesgo|fraude|leg[ií]timo|deber[ií]a)\b/i
// Developer mode on a wallet or a phone, asked about as a safety question, is a fair question.
const SAFE_OR_WALLET = new RegExp(`${WALLET_NEARBY.source}|${SAFETY_QUESTION.source}|\\b(phone|tel[eé]fono|celular|android|iphone)\\b`, 'i')
const AI_WORDS =
  '(ai|assistant|chatbot|bot|gpt|chatgpt|llm|model|linux|terminal|shell|interpreter|console|developer|dan|different|another|new|unrestricted|uncensored|evil|jailbroken)'
const AI_WORDS_ES = '(ia|asistente|bot|chatbot|gpt|chatgpt|modelo|terminal|consola|desarrollador|otr[oa]|nuev[oa]|dan|sin restricciones)'

const RULES: [Block, RegExp, RegExp?][] = [
  // Talking Sunny out of its rules or into being something else.
  ['injection', /\b(ignore|disregard|forget|override|bypass)\b[^.?!\n]{0,20}\b(your|all|any|previous|prior|above|earlier|these|those)\b[^.?!\n]{0,20}\b(instructions?|rules|prompts?|guidelines|guardrails)\b/i],
  ['injection', /\b(god|admin|debug|jailbreak|unrestricted|dan)\s+mode\b|\bjailbreak(ing)?\s+(you|yourself|sunny|the bot|this bot)\b|\bjailbroken\b|\bdo anything now\b/i],
  ['injection', /\b(you are|you're|act as|be|become|now)\s+DAN\b/],
  ['injection', /\b(enable|activate|enter|switch to|turn on|go into)\s+(developer|dev)\s+mode\b/i, SAFE_OR_WALLET],
  ['injection', new RegExp(`\\b(you are now|from now on,? you (are|will be|act as)|pretend (to be|you are|you're)|role-?play as|act as)\\s+(an?\\s+|my\\s+|the\\s+)?${AI_WORDS}\\b`, 'i')],
  ['injection', /^\s*(system|assistant|developer)\s*:|<\|?(system|im_start)\|?>|\[(system|inst)\]/im],
  ['injection', /\b(ignora|olvida|omite|salta(te)?)\b[^.?!¿\n]{0,20}\b(tus|todas)\b[^.?!¿\n]{0,20}\b(instrucciones|reglas|prompt|indicaciones)\b|\b(ignora|olvida|omite)\b[^.?!¿\n]{0,20}\b(instrucciones|reglas|indicaciones) (anteriores|previas)\b/i],
  ['injection', /\bmodo (dios|admin|sin restricciones|jailbreak)\b/i],
  ['injection', /\b(activa|entra en|pasa a|cambia a)\s+(el\s+)?modo desarrollador\b/i, SAFE_OR_WALLET],
  ['injection', new RegExp(`\\b(ahora eres|a partir de ahora eres|finge (ser|que eres)|act[uú]a como)\\s+(una?\\s+|mi\\s+|el\\s+|la\\s+)?${AI_WORDS_ES}\\b`, 'i')],
  // Fishing for its instructions (asking about its rules for pocket money is fine).
  // Fishing for its instructions: asking to see them (asking about its rules for pocket money,
  // or "I followed your instructions", is fine).
  ['prompt', /\b(system prompt|initial prompt|hidden prompt|your system message|tu prompt)\b|\b(show|tell|give|repeat|print|reveal|share|list|what are|what's|whats|read)\b[^.?!\n]{0,20}\byour (instructions|prompt)\b(?!\s+(for|on|about|to)\b)|\b(mu[eé]strame|dime|dame|repite|cu[aá]les son|revela)\b[^.?!\n]{0,20}\btus instrucciones\b(?!\s+(para|sobre|de)\b)/i],
  // Writing or running code. Sunny explains Solana; it isn't a coding assistant.
  ['code', /\b(write|create|generate|build|make|give me|send me|show me)\b[^.?!\n]{0,40}\b(python|javascript|typescript|node\.?js|bash|shell script|powershell|script|code|sql|regex|solidity|rust code)\b/i, SAFETY_QUESTION],
  ['code', /\b(write|create|generate|build|make)\b[^.?!\n]{0,40}\b(smart contract|html|css)\b/i, SAFETY_QUESTION],
  ['code', /\b(escribe|escríbeme|crea|créame|genera|hazme|dame|programa)\b[^.?!\n]{0,40}\b(python|javascript|bash|script|código|codigo|sql|html|contrato inteligente)\b/i, SAFETY_QUESTION],
  ['code', /\b(run|execute|eval|exec|compile|ejecuta|corre|compila)\b[^.?!\n]{0,30}\b(script|code|command|commands|python|bash|shell|terminal|código|codigo|comando|comandos)\b/i, SAFETY_QUESTION],
  ['code', /(^|\s)(rm -rf|sudo |chmod |curl [^\s]+\s*\|\s*(ba)?sh|import os|subprocess|os\.system|eval\(|exec\(|__import__)/i],
]

/** Decides before the model runs whether a message is something Sunny won't do. */
export function screen(text: string): Block | null {
  if (text.length > MAX_INPUT_CHARS) return 'too_long'
  // A pasted block of code (three or more lines inside fences) is a coding request.
  if (/```[\s\S]*\n[\s\S]*\n[\s\S]*```/.test(text)) return 'code'
  return RULES.find(([, re, unless]) => re.test(text) && !unless?.test(text))?.[0] ?? null
}

// ── Secrets people paste by mistake ──────────────────────────────────────────
// A recovery phrase or private key never reaches the model, the history or the logs.

const BIP39 = new Set(wordlist)

/** True for a recovery phrase (12+ BIP39 words in a row) or a Solana private key. */
export function sharedSecret(text: string): boolean {
  let run = 0
  for (const word of text.toLowerCase().split(/[^a-z]+/).filter(Boolean)) {
    run = BIP39.has(word) ? run + 1 : 0
    if (run >= 12) return true
  }
  // A 64-byte secret key, in base58 or as a byte array, whose second half is its own public
  // key. (Transaction signatures are also 64 bytes, but never pass that check.)
  const candidates = [
    ...(text.match(/[1-9A-HJ-NP-Za-km-z]{85,90}/g) ?? []).map((k) => {
      try {
        return base58.decode(k)
      } catch {
        return null
      }
    }),
    ...(text.match(/\[\s*(\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/g) ?? []).map((a) => Uint8Array.from(JSON.parse(a) as number[])),
  ]
  return candidates.some((bytes) => {
    if (bytes?.length !== 64) return false
    try {
      Keypair.fromSecretKey(bytes)
      return true
    } catch {
      return false
    }
  })
}

const SECRET_WARNING = {
  en: '🚨 That looks like a recovery phrase or a private key. I didn’t read it or keep it. Anyone who has it can empty that wallet, so move your funds to a new wallet right away, and never share it with anyone, not even me ☀️',
  es: '🚨 Eso parece una frase de recuperación o una llave privada. No la leí ni la guardé. Quien la tenga puede vaciar esa wallet, así que mueve tus fondos a una wallet nueva ya mismo, y nunca la compartas con nadie, ni siquiera conmigo ☀️',
}

/** What Sunny says instead of reading a pasted secret. Not a strike: it's a mistake, not an attack. */
export const secretWarning = (lang: string) => SECRET_WARNING[spanish(lang) ? 'es' : 'en']

// Refusals follow the message itself, so a Spanish question gets a Spanish answer even when
// Telegram is set to English (and the other way round).
const SPANISH_HINTS = /[¿¡ñ]|\b(qu[eé]|c[oó]mo|por qu[eé]|cu[aá]l|eres|tus|dame|hazme|escribe|ignora|olvida|mis|esta|este|para|por favor|hola)\b/i
const ENGLISH_HINTS = /\b(the|what|how|why|is|are|you|your|my|please|write|ignore|give|show|this|that)\b/i

/** The language to answer a message in: what it's written in, else Telegram's setting. */
export function languageOf(text: string, lang: string) {
  if (SPANISH_HINTS.test(text)) return 'es'
  if (ENGLISH_HINTS.test(text)) return 'en'
  return lang
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

// What counts as the person asking to spend: an amount, a spending verb next to the pocket
// or money, or paying for something. "Take a look at BONK" or "use your judgment" isn't.
const POCKET_ASK = [
  // An amount counts next to a spending verb ("SOL dropped to $140" is just news).
  /\b(take|use|spend|pay|draw|grab|toma|tomar|usa|usar|gasta|gastar|paga|pagar|saca|sacar)\b[^.?!\n]{0,30}(\$\s?\d|\d\s?(usd|usdc|dólares|dolares|dollars|bucks)\b)/i,
  /\b(take|use|spend|pay|draw|grab|toma|tomar|usa|usar|gasta|gastar|paga|pagar|saca|sacar)\b[^.?!\n]{0,30}\b(pocket|allowance|money|usdc|funds|bolsillo|dinero|plata|mesada)\b/i,
  /\b(from|de)\s+(your|my|the|tu|mi|el)\s+(pocket|bolsillo)\b/i,
  /\b(pay|paga|pagar)\s+(for|por)\b/i,
]
// A deep scan has a price, so asking for one is asking to spend: "deep scan BONK", "reporte completo".
const PAID_SCAN_ASK =
  /\b(deep[ -]?scan|full (scan|report|check)|premium (scan|report)|(escaneo|análisis|analisis|scan|revisión|revision) (profundo|completo)|(reporte|informe) completo)\b/i

/** Sunny only takes pocket money when the person's own message asks for it. */
export const asksForPocketMoney = (text: string) => POCKET_ASK.some((re) => re.test(text)) || PAID_SCAN_ASK.test(text)

// "Yes" to Sunny's own offer of a deep scan is asking for one, too.
// The whole message must be a yes ("yes", "sure, do it", "sí, dale"), with no "no" anywhere,
// and Sunny's last answer must end by offering a deep scan.
const YES =
  /^\s*((yes|yep|yeah|yup|sure|ok|okay|do it|go ahead|go for it|please|s[ií]|dale|claro|hazlo|de una|por favor|vale)[\s,.!☀️👍]*)+$/iu
const NO = /\b(no|not|don'?t|never|nope|nah|stop|cancel|later|thanks?|gracias|nunca|mejor no)\b/i
const SCAN_OFFER = /deep scan|escaneo profundo|an[aá]lisis profundo|reporte completo/i
// An offer is a question: the answer ends with "?" (maybe an emoji after it) and names the scan near the end.
const offersScan = (answer: string) => /\?\s*\p{Extended_Pictographic}?\uFE0F?\s*$/u.test(answer) && SCAN_OFFER.test(answer.slice(-160))

/** True when the person says yes right after Sunny offered a (paid) deep scan. */
export const acceptsScanOffer = (text: string, lastAnswer: string | undefined) =>
  YES.test(text) && !NO.test(text) && text.length <= 40 && offersScan(lastAnswer ?? '')
