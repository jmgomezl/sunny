import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from 'grammy'
import type { Message, MessageEntity } from 'grammy/types'
import { allow, HOUR } from './limits.js'
import { lookupToken } from './market.js'
import { checkLink } from './scams.js'
import { checkBlink, looksLikeBlink, probeAccount } from './blink.js'

// Sunny as a group guardian. In a group it stays quiet and only speaks up when someone
// posts a known phishing link, a suspicious look-alike or bait page, or a token with
// serious red flags. Only deterministic checks run here, never the AI: it's fast, free,
// and nothing a group member writes can talk Sunny into anything.

const DATA_DIR = process.env.SUNNY_DATA_DIR || join(process.cwd(), 'data')
const FILE = join(DATA_DIR, 'groups.json')
// A busy group still hears from Sunny at most this often.
const WARNINGS_PER_HOUR = 20
const SIGN_OFF = '— Sunny ☀️ guarding this group'

type Group = { title: string; addedAt: string; removedAt?: string; members?: number; warnings: number; checks: number }
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

async function warningsFor(msg: Message): Promise<{ key: string; text: string }[]> {
  const found: { key: string; text: string }[] = []
  for (const link of linksIn(msg)) {
    // A Blink is read for drainer patterns (no wallet to simulate with in a group).
    if (await looksLikeBlink(link)) {
      const blink = await checkBlink(link, null, probeAccount()).catch(() => null)
      if (blink?.verdict === 'danger') {
        found.push({ key: blink.host, text: `🚨 Don’t sign this Blink (${blink.host}). ${blink.summary.replace(/^Don’t sign\. /, '')}` })
        continue
      }
    }
    const r = checkLink(link)
    if ('error' in r) continue
    if (r.verdict === 'known_scam') {
      found.push({
        key: r.domain,
        text: `⚠️ ${r.domain} is a known phishing site. Don’t open it, connect a wallet or sign anything there.`,
      })
    } else if (r.verdict === 'suspicious') {
      const why = r.reasons[0].charAt(0).toLowerCase() + r.reasons[0].slice(1)
      found.push({
        key: r.domain,
        text: `🤔 ${r.domain} looks suspicious: ${why}. Check the official site before connecting a wallet.`,
      })
    }
  }
  for (const address of addressesIn(msg.text ?? msg.caption ?? '')) {
    const t = await lookupToken(address).catch(() => null)
    // Only an exact mint match with serious red flags is worth interrupting a group for.
    if (t?.found && t.card.mint === address && t.card.risk === 'high') {
      const flags = t.card.flags
        .filter((f) => f.level === 'high')
        .slice(0, 2)
        .map((f) => f.text.charAt(0).toLowerCase() + f.text.slice(1))
      found.push({ key: address, text: `⚠️ $${t.card.symbol} has red flags: ${flags.join('; ')}. Be careful before buying.` })
    }
  }
  return found
}

/** A plain-words verdict for /check in a group, without the AI. */
async function checkCommand(query: string) {
  if (!query) return 'Send /check with a token, a mint address or a link, like /check BONK ☀️'
  if (/^https?:\/\/|^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(query) && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(query)) {
    const r = checkLink(query)
    if ('error' in r) return 'That doesn’t look like a link I can check.'
    const label = { known_scam: '⛔ Known phishing site', suspicious: '🤔 Suspicious', official: '✅ Official site', unknown: '🔎 Not on any scam list' }[r.verdict]
    return `${label}: ${r.domain}\n${r.reasons[0]}`
  }
  const t = await lookupToken(query).catch(() => null)
  if (!t?.found) return `I couldn’t find a token called “${query}”.`
  const risk = { low: '🟢 Low risk', medium: '🟠 Medium risk', high: '🔴 High risk' }[t.card.risk]
  const flags = t.card.flags.slice(0, 3).map((f) => `• ${f.text}`)
  const copycats = t.details.other_tokens_with_same_symbol
    ? `\n${t.details.other_tokens_with_same_symbol} other tokens use this name: always check the mint.`
    : ''
  const exact = t.details.exact_match ? '' : `\nNo token is called exactly “${query}”; this is the closest match.`
  return `${risk}: $${t.card.symbol} (${t.card.name})\n${t.card.mint}${exact}${flags.length ? `\n${flags.join('\n')}` : '\nNo red flags in Jupiter’s and RugCheck’s data.'}${copycats}\nNot financial advice.`
}

const INTRO =
  'Hi everyone, I’m Sunny ☀️ I’ll quietly watch this group for phishing links, fake airdrop pages and risky tokens, ' +
  'and warn you when I spot one. Anyone can ask me /check BONK or /check some-link.com.\n\n' +
  'I never DM people first and never ask for keys or seed phrases. Anyone who does is not me.\n\n' +
  'Admins: if I don’t react to links, make me an admin (no permissions needed) so I can read messages.'

/** Everything Sunny does in groups: say hi when added, guard messages, answer /check. */
export async function handleGroup(ctx: Context) {
  const status = ctx.myChatMember?.new_chat_member.status
  if (status) {
    const g = group(ctx)
    if (status === 'member' || status === 'administrator') {
      const wasIn = ['member', 'administrator'].includes(ctx.myChatMember!.old_chat_member.status)
      g.removedAt = undefined
      g.members = await ctx.getChatMemberCount().catch(() => g.members)
      save()
      if (!wasIn) await ctx.reply(INTRO).catch(() => {})
    } else if (status === 'left' || status === 'kicked') {
      g.removedAt = new Date().toISOString()
      save()
    }
    return
  }

  const msg = ctx.message
  if (!msg || msg.from?.is_bot) return
  const text = msg.text ?? msg.caption ?? ''
  const command = /^\/check(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text.trim())
  if (command) {
    if (!allow(`group-check:${ctx.chat!.id}`, 30, HOUR)) return
    group(ctx).checks++
    save()
    await ctx.reply(await checkCommand((command[1] ?? '').trim().slice(0, 200)), {
      reply_parameters: { message_id: msg.message_id },
      link_preview_options: { is_disabled: true },
    })
    return
  }

  const found = await warningsFor(msg)
  // The same warning at most once an hour per group, and a cap so a raid can't make Sunny spam.
  const fresh = found.filter((w) => allow(`group-warn:${ctx.chat!.id}:${w.key}`, 1, HOUR))
  if (!fresh.length || !allow(`group-warns:${ctx.chat!.id}`, WARNINGS_PER_HOUR, HOUR)) return
  group(ctx).warnings += fresh.length
  save()
  await ctx.reply(`${fresh.map((w) => w.text).join('\n\n')}\n\n${SIGN_OFF}`, {
    reply_parameters: { message_id: msg.message_id },
    link_preview_options: { is_disabled: true },
  })
}
