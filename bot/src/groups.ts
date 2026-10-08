import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from 'grammy'
import type { Message, MessageEntity } from 'grammy/types'
import { allow, HOUR } from './limits.js'
import { lookupToken } from './market.js'
import { checkLink } from './scams.js'
import { checkBlink, looksLikeBlink, probeAccount } from './blink.js'
import { languageOf } from './guard.js'

// Sunny as a group guardian. In a group it stays quiet and only speaks up when someone
// posts a known phishing link, a suspicious look-alike or bait page, or a token with
// serious red flags. Only deterministic checks run here, never the AI: it's fast, free,
// and nothing a group member writes can talk Sunny into anything.

const DATA_DIR = process.env.SUNNY_DATA_DIR || join(process.cwd(), 'data')
const FILE = join(DATA_DIR, 'groups.json')
// A busy group still hears from Sunny at most this often.
const WARNINGS_PER_HOUR = 20
type Lang = 'en' | 'es'
// Sunny's first groups are Spanish-speaking, so everything it says in a group comes in both.
const T = {
  en: {
    signOff: '— Sunny ☀️ guarding this group',
    intro:
      'Hi everyone, I’m Sunny ☀️ I’ll quietly watch this group for phishing links, fake airdrop pages and risky tokens, ' +
      'and warn you when I spot one. Anyone can ask me /check BONK or /check some-link.com.\n\n' +
      'I never DM people first and never ask for keys or seed phrases. Anyone who does is not me.\n\n' +
      'Admins: if I don’t react to links, make me an admin (no permissions needed) so I can read messages.',
    blink: (host: string) => `🚨 Don’t sign this Blink (${host}).`,
    scam: (d: string) => `⚠️ ${d} is a known phishing site. Don’t open it, connect a wallet or sign anything there.`,
    suspicious: (d: string, why: string) => `🤔 ${d} looks suspicious: ${why}. Check the official site before connecting a wallet.`,
    risky: (sym: string, flags: string) => `⚠️ $${sym} has red flags: ${flags}. Be careful before buying.`,
    advertises: (sym: string) =>
      `⚠️ $${sym}’s name advertises a website or an “official” claim. Token names aren’t verified: that’s a common scam. Check the mint, not the name.`,
    usage: 'Send /check with a token, a mint address or a link, like /check BONK ☀️',
    badLink: 'That doesn’t look like a link I can check.',
    labels: { known_scam: '⛔ Known phishing site', suspicious: '🤔 Suspicious', official: '✅ Official site', unknown: '🔎 Not on any scam list' },
    notFound: (q: string) => `I couldn’t find a token called “${q}”.`,
    risk: { low: '🟢 Low risk', medium: '🟠 Medium risk', high: '🔴 High risk' },
    copycats: (n: number) => `${n} other tokens use this name: always check the mint.`,
    closest: (q: string) => `No token is called exactly “${q}”; this is the closest match.`,
    clean: 'No red flags in Jupiter’s and RugCheck’s data.',
    namesCaveat: 'Its name advertises a website or an “official” claim: token names aren’t verified.',
    notAdvice: 'Not financial advice.',
  },
  es: {
    signOff: '— Sunny ☀️ cuidando este grupo',
    intro:
      'Hola a todos, soy Sunny ☀️ Voy a cuidar este grupo en silencio: links de phishing, páginas de airdrops falsos y tokens riesgosos. ' +
      'Les aviso cuando vea uno. Cualquiera puede preguntarme /check BONK o /check algun-link.com.\n\n' +
      'Nunca escribo primero por privado y nunca pido llaves ni frases semilla. Quien lo haga no soy yo.\n\n' +
      'Admins: si no reacciono a los links, háganme admin (sin permisos) para poder leer los mensajes.',
    blink: (host: string) => `🚨 No firmes este Blink (${host}): tiene señales de drainer.`,
    scam: (d: string) => `⚠️ ${d} es un sitio de phishing conocido. No lo abras, no conectes tu wallet ni firmes nada ahí.`,
    suspicious: (d: string) => `🤔 ${d} parece sospechoso. Revisa el sitio oficial antes de conectar tu wallet.`,
    risky: (sym: string) => `⚠️ $${sym} tiene señales de alto riesgo según Jupiter y RugCheck. Cuidado antes de comprar.`,
    advertises: (sym: string) =>
      `⚠️ El nombre de $${sym} anuncia un sitio web o dice ser “oficial”. Los nombres de tokens no se verifican: es una estafa común. Revisa el mint, no el nombre.`,
    usage: 'Envía /check con un token, una dirección de mint o un link, como /check BONK ☀️',
    badLink: 'Eso no parece un link que pueda revisar.',
    labels: { known_scam: '⛔ Sitio de phishing conocido', suspicious: '🤔 Sospechoso', official: '✅ Sitio oficial', unknown: '🔎 No está en ninguna lista de estafas' },
    notFound: (q: string) => `No encontré un token llamado “${q}”.`,
    risk: { low: '🟢 Riesgo bajo', medium: '🟠 Riesgo medio', high: '🔴 Riesgo alto' },
    copycats: (n: number) => `Otros ${n} tokens usan este nombre: revisa siempre el mint.`,
    closest: (q: string) => `Ningún token se llama exactamente “${q}”; este es el más parecido.`,
    clean: 'Sin señales de alerta en los datos de Jupiter y RugCheck.',
    namesCaveat: 'Su nombre anuncia un sitio web o dice ser “oficial”: los nombres de tokens no se verifican.',
    notAdvice: 'No es consejo financiero.',
  },
} as const

// A token's name and symbol are whatever its creator typed: links and "official" claims in them
// are never repeated, and they're a warning sign of their own.
const ADVERTISES =
  /https?:\/\/|\bwww\.|\b[\w-]+\.(app|xyz|io|com|net|org|site|online|fun|top|click|link|gg|live|pro|vip)\b|\b(airdrop|claim|official|verified|reclama|oficial|verificad[oa])\b/i
const safeName = (name: string) =>
  name
    .replace(/https?:\/\/\S+|\bwww\.\S+|\b[\w-]+\.(app|xyz|io|com|net|org|site|online|fun|top|click|link|gg|live|pro|vip)\b\S*/gi, '[link]')
    .slice(0, 40)

type Group = {
  title: string
  addedAt: string
  removedAt?: string
  members?: number
  warnings: number
  checks: number
  /** The language of whoever added Sunny, until the group's own messages say otherwise. */
  lang?: Lang
}
let groups: Record<string, Group> = {}
let loaded = false

function load() {
  if (loaded) return
  loaded = true
  try {
    groups = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, Group>
  } catch {
    groups = {}
  }
}

function save() {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(`${FILE}.tmp`, JSON.stringify(groups))
  renameSync(`${FILE}.tmp`, FILE)
}

function group(ctx: Context) {
  load()
  const key = String(ctx.chat!.id)
  const title = 'title' in ctx.chat! ? (ctx.chat.title ?? 'Group') : 'Group'
  groups[key] ??= { title, addedAt: new Date().toISOString(), warnings: 0, checks: 0 }
  groups[key].title = title
  return groups[key]
}

/** Groups Sunny guards now, and how many people are in them. For the stats. */
export function groupStats() {
  load()
  const active = Object.values(groups).filter((g) => !g.removedAt)
  return {
    groups: active.length,
    members: active.reduce((s, g) => s + (g.members ?? 0), 0),
    warnings: Object.values(groups).reduce((s, g) => s + g.warnings, 0),
    checks: Object.values(groups).reduce((s, g) => s + g.checks, 0),
  }
}

/** Links in a message: Telegram marks them as entities, including text links with other wording. */
export function linksIn(msg: Pick<Message, 'text' | 'caption' | 'entities' | 'caption_entities'>): string[] {
  const text = msg.text ?? msg.caption ?? ''
  const entities: MessageEntity[] = [...(msg.entities ?? []), ...(msg.caption_entities ?? [])]
  const links = entities.flatMap((e) =>
    e.type === 'url' ? [text.slice(e.offset, e.offset + e.length)] : e.type === 'text_link' ? [e.url] : [],
  )
  return [...new Set(links)].slice(0, 5)
}

/** Solana addresses in a message, outside of links. Could be tokens or wallets. */
export function addressesIn(text: string): string[] {
  const bare = text.replace(/https?:\/\/\S+/g, ' ')
  return [...new Set(bare.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g) ?? [])].slice(0, 3)
}

async function warningsFor(msg: Message, lang: Lang): Promise<{ key: string; text: string }[]> {
  const t = T[lang]
  const found: { key: string; text: string }[] = []
  for (const link of linksIn(msg)) {
    // A Blink is read for drainer patterns (no wallet to simulate with in a group).
    if (await looksLikeBlink(link)) {
      const blink = await checkBlink(link, null, probeAccount()).catch(() => null)
      if (blink?.verdict === 'danger') {
        const detail = lang === 'en' ? ` ${blink.summary.replace(/^Don’t sign\. /, '')}` : ''
        found.push({ key: blink.host, text: `${t.blink(blink.host)}${detail}` })
        continue
      }
    }
    const r = checkLink(link)
    if ('error' in r) continue
    if (r.verdict === 'known_scam') {
      found.push({ key: r.domain, text: t.scam(r.domain) })
    } else if (r.verdict === 'suspicious') {
      const why = r.reasons[0].charAt(0).toLowerCase() + r.reasons[0].slice(1)
      found.push({ key: r.domain, text: t.suspicious(r.domain, why) })
    }
  }
  for (const address of addressesIn(msg.text ?? msg.caption ?? '')) {
    const token = await lookupToken(address).catch(() => null)
    if (!token?.found || token.card.mint !== address) continue
    const symbol = safeName(token.card.symbol)
    // A name that advertises a site or claims to be "official" is a lure, whatever the stats say.
    if (ADVERTISES.test(`${token.card.name} ${token.card.symbol}`)) {
      found.push({ key: address, text: t.advertises(symbol) })
      continue
    }
    // Otherwise only serious red flags are worth interrupting a group for.
    if (token.card.risk === 'high') {
      const flags = token.card.flags
        .filter((f) => f.level === 'high')
        .slice(0, 2)
        .map((f) => f.text.charAt(0).toLowerCase() + f.text.slice(1))
      found.push({ key: address, text: t.risky(symbol, flags.join('; ')) })
    }
  }
  return found
}

/** A plain-words verdict for /check in a group, without the AI. */
export async function checkCommand(query: string, lang: Lang = 'en') {
  const t = T[lang]
  if (!query) return t.usage
  if (/^https?:\/\/|^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(query) && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(query)) {
    const r = checkLink(query)
    if ('error' in r) return t.badLink
    return `${t.labels[r.verdict]}: ${r.domain}${lang === 'en' ? `\n${r.reasons[0]}` : ''}`
  }
  const token = await lookupToken(query).catch(() => null)
  if (!token?.found) return t.notFound(query.slice(0, 40))
  const advertises = ADVERTISES.test(`${token.card.name} ${token.card.symbol}`)
  // A name that advertises a site never gets a bare green "Low risk".
  const risk = t.risk[advertises && token.card.risk === 'low' ? 'medium' : token.card.risk]
  const flags = token.card.flags.slice(0, 3).map((f) => `• ${f.text}`)
  const copycats = token.details.other_tokens_with_same_symbol ? `\n${t.copycats(token.details.other_tokens_with_same_symbol)}` : ''
  const exact = token.details.exact_match ? '' : `\n${t.closest(query.slice(0, 40))}`
  const caveat = advertises ? `\n⚠️ ${t.namesCaveat}` : ''
  return `${risk}: $${safeName(token.card.symbol)} (${safeName(token.card.name)})\n${token.card.mint}${exact}${caveat}${flags.length ? `\n${flags.join('\n')}` : advertises ? '' : `\n${t.clean}`}${copycats}\n${t.notAdvice}`
}

/** The group's language: what this message is written in, else the group's own. */
const langFor = (g: Group, text: string): Lang => (languageOf(text, g.lang ?? 'en').startsWith('es') ? 'es' : 'en')

/** Everything Sunny does in groups: say hi when added, guard messages, answer /check. */
export async function handleGroup(ctx: Context) {
  const status = ctx.myChatMember?.new_chat_member.status
  if (status) {
    const g = group(ctx)
    if (status === 'member' || status === 'administrator') {
      const wasIn = ['member', 'administrator'].includes(ctx.myChatMember!.old_chat_member.status)
      g.removedAt = undefined
      g.members = await ctx.getChatMemberCount().catch(() => g.members)
      // Whoever adds Sunny sets the group's starting language.
      if (!wasIn) g.lang = ctx.myChatMember!.from.language_code?.startsWith('es') ? 'es' : 'en'
      save()
      if (!wasIn) await ctx.reply(T[g.lang ?? 'en'].intro).catch(() => {})
    } else if (status === 'left' || status === 'kicked') {
      g.removedAt = new Date().toISOString()
      save()
    }
    return
  }

  const msg = ctx.message
  if (!msg || msg.from?.is_bot) return
  const text = msg.text ?? msg.caption ?? ''
  const g = group(ctx)
  const lang = langFor(g, text)
  // A group that writes in Spanish hears Sunny in Spanish from then on.
  if (lang === 'es' && g.lang !== 'es' && /\p{L}{4,}/u.test(text)) {
    g.lang = 'es'
    save()
  }
  const command = /^\/check(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text.trim())
  if (command) {
    if (!allow(`group-check:${ctx.chat!.id}`, 30, HOUR)) return
    g.checks++
    save()
    await ctx.reply(await checkCommand((command[1] ?? '').trim().slice(0, 200), g.lang ?? 'en'), {
      reply_parameters: { message_id: msg.message_id },
      link_preview_options: { is_disabled: true },
    })
    return
  }

  const found = await warningsFor(msg, lang)
  // The same warning at most once an hour per group, and a cap so a raid can't make Sunny spam.
  const fresh = found.filter((w) => allow(`group-warn:${ctx.chat!.id}:${w.key}`, 1, HOUR))
  if (!fresh.length || !allow(`group-warns:${ctx.chat!.id}`, WARNINGS_PER_HOUR, HOUR)) return
  g.warnings += fresh.length
  save()
  await ctx.reply(`${fresh.map((w) => w.text).join('\n\n')}\n\n${T[lang].signOff}`, {
    reply_parameters: { message_id: msg.message_id },
    link_preview_options: { is_disabled: true },
  })
}
