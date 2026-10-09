import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from 'grammy'
import type { Message, MessageEntity } from 'grammy/types'
import { allow, HOUR } from './limits.js'
import { lookupToken } from './market.js'
import { checkLink } from './scams.js'
import { checkBlink, looksLikeBlink, probeAccount, type BlinkReport } from './blink.js'
import { DEMO_HOST } from './demoblink.js'
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
      'and warn you when I spot one. Anyone can ask me /check BONK or /check raydium.io.\n\n' +
      'I never DM people first and never ask for keys or seed phrases. Anyone who does is not me.\n\n' +
      'Admins: if I don’t react to links, make me an admin (no permissions needed) so I can read messages.',
    blink: (host: string) => `🚨 Don’t sign this Blink (${host}).`,
    blinkUnread: (host: string) => `🤔 This Blink (${host}) won’t show me the transaction it wants signed. Don’t sign it until a check shows what it does.`,
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
      'Les aviso cuando vea uno. Cualquiera puede preguntarme /check BONK o /check raydium.io.\n\n' +
      'Nunca escribo primero por privado y nunca pido llaves ni frases semilla. Quien lo haga no soy yo.\n\n' +
      'Admins: si no reacciono a los links, háganme admin (sin permisos) para poder leer los mensajes.',
    blink: (host: string) => `🚨 No firmes este Blink (${host}): tiene señales de drainer.`,
    blinkUnread: (host: string) => `🤔 No pude leer qué quiere que firmes este Blink (${host}). No lo firmes hasta que una revisión muestre la transacción.`,
    scam: (d: string) => `⚠️ ${d} es un sitio de phishing conocido. No lo abras, no conectes tu wallet ni firmes nada ahí.`,
    suspicious: (d: string, why: string) => `🤔 ${d} parece sospechoso: ${why}. Revisa el sitio oficial antes de conectar tu wallet.`,
    risky: (sym: string, _flags?: string) => `⚠️ $${sym} tiene señales de alto riesgo según Jupiter y RugCheck. Cuidado antes de comprar.`,
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
const ADVERTISES = /https?:\/\/|\bwww\.|\b[\p{L}\p{N}-]+\.[a-z]{2,}\b|\b(airdrop|claim|official|verified|reclama|oficial|verificad[oa])\b/iu
/** Whatever someone else typed, as one plain line: no links, no line breaks, no control characters. */
const plainLine = (text: string, max = 40) =>
  text
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
    .replace(/https?:\/\/\S+|\bwww\.\S+|\b[\p{L}\p{N}-]+\.[a-z]{2,}\b\S*/giu, '[link]')
    .trim()
    .slice(0, max)
const safeName = (name: string) => plainLine(name)
// A dangerous domain is shown so Telegram won't turn it into a tappable link: raydlum[.]io.
const defang = (domain: string) => domain.replace(/\./g, '[.]')

// Link-check reasons, in Spanish (the checks themselves explain in English).
const reasonEs = (reason: string) =>
  reason
    .replace(/^Pretends to be (.+), but the real site is (.+)$/, 'se hace pasar por $1; el sitio real es $2')
    .replace(/^Uses bait words in the address \((.+)\)$/, 'usa palabras de cebo en la dirección ($1)')
    .replace(/^Uses look-alike characters \(punycode\)$/, 'usa letras que imitan a otras (punycode)')
    .replace(/^Hosted on a free site builder, common for throwaway scam pages$/, 'está en un hosting gratuito, común en páginas de estafa desechables')
    .replace(/^Listed as a phishing site by MetaMask\/Phantom’s open blocklists$/, 'figura como phishing en las listas abiertas de MetaMask y Phantom')
    .replace(/^This is the real, official site$/, 'es el sitio real y oficial')
    .replace(/^Not on any scam list I check \((.+) known sites\)$/, 'no está en ninguna lista de estafas que reviso ($1 sitios conocidos)')

/** A drainer Blink's line: the worst finding, in the group's language. */
function blinkLine(report: BlinkReport, lang: Lang) {
  const t = T[lang]
  // Sunny's own demo drainer says so, so it never looks like Sunny's site is the scam.
  const practice = report.host.toLowerCase().replace(/\.$/, '') === DEMO_HOST
  const host = practice ? (lang === 'es' ? 'el drainer de práctica de Sunny' : 'Sunny’s practice drainer') : defang(report.host)
  if (report.verdict !== 'danger') return t.blinkUnread(host)
  if (lang === 'en') return `${t.blink(host)} ${report.summary.replace(/^Don’t sign\. /, '')}`
  const sol = report.warnings.map((w) => /sends ([\d.,]+) SOL/.exec(w.text)?.[1]).find(Boolean)
  return `${t.blink(host)}${sol ? ` Enviaría ${sol} SOL de la wallet que firma.` : ''}`
}

/** Waits at most `ms` for a network check: a slow site never holds the group up. */
const within = <T>(ms: number, p: Promise<T>) =>
  Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms).unref())])

type Group = {
  title: string
  addedAt: string
  removedAt?: string
  members?: number
  warnings: number
  checks: number
  /** The language of whoever added Sunny, until the group's own messages say otherwise. */
  lang?: Lang
  /** Spanish messages seen in an English group: three of them switch it, one word never does. */
  esVotes?: number
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
export function linksIn(msg: Pick<Message, 'text' | 'caption' | 'entities' | 'caption_entities'> & { reply_markup?: Message['reply_markup'] }, max = 5): string[] {
  const text = msg.text ?? msg.caption ?? ''
  const entities: MessageEntity[] = [...(msg.entities ?? []), ...(msg.caption_entities ?? [])]
  const links = entities.flatMap((e) =>
    e.type === 'url' ? [text.slice(e.offset, e.offset + e.length)] : e.type === 'text_link' ? [e.url] : [],
  )
  // Inline bots post "🎁 Claim" buttons whose link never appears in the text.
  const buttons = (msg.reply_markup?.inline_keyboard ?? []).flat().flatMap((b) => ('url' in b && b.url ? [b.url] : []))
  return [...new Set([...links, ...buttons])].slice(0, max)
}

/** Solana addresses in a message, outside of links. Could be tokens or wallets. */
export function addressesIn(text: string): string[] {
  const bare = text.replace(/https?:\/\/\S+/g, ' ')
  return [...new Set(bare.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g) ?? [])].slice(0, 5)
}

// A whole message's network checks share one budget, so one slow site can't hold a group up.
const GROUP_CHECK_MS = 8_000

type Warning = { key: string; text: string; severe: boolean }

async function warningsFor(msg: Message, lang: Lang): Promise<Warning[]> {
  const t = T[lang]
  const found: Warning[] = []
  const links = linksIn(msg, 20)
  // Blinks need the network: the first five, read together, within the budget.
  const blinks = await Promise.all(
    links.slice(0, 5).map((link) =>
      within(GROUP_CHECK_MS, looksLikeBlink(link).then((is) => (is ? checkBlink(link, null, probeAccount()) : null))),
    ),
  )
  links.forEach((link, i) => {
    const blink = blinks[i]
    if (blink && blink.verdict !== 'ok') {
      found.push({ key: blink.host, text: blinkLine(blink, lang), severe: blink.verdict === 'danger' })
      return
    }
    // Every link gets the instant list and look-alike check, however many a message has.
    const r = checkLink(link)
    if ('error' in r) return
    if (r.verdict === 'known_scam') found.push({ key: r.domain, text: t.scam(defang(r.domain)), severe: true })
    // A page on a platform anyone can post to (Medium, X, GitHub) is for /check, not a group alarm.
    else if (r.verdict === 'suspicious' && !/anyone can/i.test(r.reasons[0])) {
      const reason = lang === 'es' ? reasonEs(r.reasons[0]) : r.reasons[0]
      const why = reason.charAt(0).toLowerCase() + reason.slice(1)
      found.push({ key: r.domain, text: t.suspicious(defang(r.domain), why), severe: false })
    }
  })
  const addresses = addressesIn(msg.text ?? msg.caption ?? '')
  const tokens = await Promise.all(addresses.map((a) => within(GROUP_CHECK_MS, lookupToken(a))))
  addresses.forEach((address, i) => {
    const token = tokens[i]
    if (!token?.found || token.card.mint !== address) return
    // Verified tokens (JitoSOL, mSOL, stablecoins) are pasted all day: /check has their details.
    if (token.card.verified) return
    const symbol = safeName(token.card.symbol)
    // A name that advertises a site or claims to be "official" is a lure, whatever the stats say.
    if (ADVERTISES.test(`${token.card.name} ${token.card.symbol}`)) {
      found.push({ key: address, text: t.advertises(symbol), severe: false })
      return
    }
    // Otherwise only serious red flags are worth interrupting a group for.
    if (token.card.risk === 'high') {
      const flags = token.card.flags
        .filter((f) => f.level === 'high')
        .slice(0, 2)
        .map((f) => f.text.charAt(0).toLowerCase() + f.text.slice(1))
      found.push({ key: address, text: t.risky(symbol, flags.join('; ')), severe: false })
    }
  })
  return found
}

/** A plain-words verdict for /check in a group, without the AI. */
export async function checkCommand(query: string, lang: Lang = 'en') {
  const t = T[lang]
  if (!query) return t.usage
  if (/^(solana(-action)?:)?https?:\/\/|^[\p{L}\p{N}_-]+(\.[\p{L}\p{N}_-]+)+([/?]\S*)?$/iu.test(query) && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(query)) {
    // A Blink is judged by the transaction it wants signed, never by the page around it.
    if (await looksLikeBlink(query)) {
      const blink = await within(GROUP_CHECK_MS * 2, checkBlink(query, null, probeAccount()))
      if (blink) return blink.verdict === 'ok' ? `${t.labels.unknown}: ${blink.host}` : blinkLine(blink, lang)
    }
    const r = checkLink(query)
    if ('error' in r) return t.badLink
    const bad = r.verdict === 'known_scam' || r.verdict === 'suspicious'
    const reason = lang === 'es' ? reasonEs(r.reasons[0]) : r.reasons[0]
    return `${t.labels[r.verdict]}: ${bad ? defang(r.domain) : r.domain}\n${reason.charAt(0).toUpperCase() + reason.slice(1)}`
  }
  const token = await lookupToken(query).catch(() => null)
  if (!token?.found) return t.notFound(plainLine(query))
  const advertises = ADVERTISES.test(`${token.card.name} ${token.card.symbol}`)
  // A name that advertises a site never gets a bare green "Low risk".
  const risk = t.risk[advertises && token.card.risk === 'low' ? 'medium' : token.card.risk]
  const flags = token.card.flags.slice(0, 3).map((f) => `• ${f.text}`)
  const copycats = token.details.other_tokens_with_same_symbol ? `\n${t.copycats(token.details.other_tokens_with_same_symbol)}` : ''
  const exact = token.details.exact_match ? '' : `\n${t.closest(plainLine(query))}`
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

  // Edited messages too: a clean message can be edited into a scam link afterwards.
  const msg = ctx.message ?? ctx.editedMessage
  if (!msg) return
  // Real bots are skipped, but a post "as a channel" arrives from Telegram's channel bot: it's read.
  // The group's own anonymous admins are trusted.
  if (msg.from?.is_bot && !msg.sender_chat) return
  if (msg.sender_chat?.id === ctx.chat!.id) return
  const text = msg.text ?? msg.caption ?? ''
  const g = group(ctx)
  // A group that writes in Spanish hears Sunny in Spanish from then on: after three Spanish
  // messages, so one "hola" in an English group doesn't switch it.
  // A group with no language yet takes its first Spanish message's.
  if (g.lang !== 'es' && langFor({ ...g, lang: 'en' }, text) === 'es' && /\p{L}{4,}/u.test(text)) {
    g.esVotes = (g.esVotes ?? 0) + 1
    if (!g.lang || g.esVotes >= 3) g.lang = 'es'
    save()
  }
  // Warnings come in the group's language once it has one; before that, in the message's.
  const lang = g.lang ?? langFor(g, text)
  const command = /^\/check(?:@(\w+))?(?:\s+([\s\S]*))?$/i.exec(text.trim())
  // "/check@SomeOtherBot" is for another bot.
  if (command && command[1] && ctx.me?.username && command[1].toLowerCase() !== ctx.me.username.toLowerCase()) return
  if (command) {
    if (!allow(`group-check:${ctx.chat!.id}`, 30, HOUR)) return
    g.checks++
    save()
    await ctx.reply(await checkCommand((command[2] ?? '').trim().slice(0, 200), lang), {
      reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
      link_preview_options: { is_disabled: true },
    })
    return
  }

  const found = await warningsFor(msg as Message, lang)
  // The same warning at most once an hour per group, and a cap so a raid can't make Sunny spam.
  // Known phishing and drainers have their own, larger allowance, so look-alike spam can't use up
  // the hour and let a real drainer through.
  const fresh = found.filter((w) => allow(`group-warn:${ctx.chat!.id}:${w.key}`, 1, HOUR))
  const severe = fresh.some((w) => w.severe)
  if (!fresh.length || !allow(`group-warns${severe ? ':severe' : ''}:${ctx.chat!.id}`, severe ? WARNINGS_PER_HOUR * 2 : WARNINGS_PER_HOUR, HOUR)) return
  g.warnings += fresh.length
  save()
  await ctx.reply(`${fresh.map((w) => w.text).join('\n\n')}\n\n${T[lang].signOff}`, {
    reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
    link_preview_options: { is_disabled: true },
  })
}
