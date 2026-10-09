// The group guardian, driven like Telegram would drive it: it must warn about look-alike
// phishing links, stay silent about ordinary ones, never repeat itself, and answer /check.
// Run: pnpm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.SUNNY_DATA_DIR = mkdtempSync(join(tmpdir(), 'sunny-groups-'))
const { addressesIn, groupStats, handleGroup, linksIn } = await import('../src/groups.js')

let nextId = 1
function groupMessage(text: string, replies: string[]) {
  const urls = [...text.matchAll(/(https?:\/\/)?[\w-]+\.(io|com|xyz|app)\S*/g)]
  return {
    chat: { id: -1001, type: 'supergroup', title: 'Solana Friends' },
    message: {
      message_id: nextId++,
      from: { id: 7, is_bot: false },
      text,
      entities: urls.map((m) => ({ type: 'url', offset: m.index!, length: m[0].length })),
    },
    reply: async (t: string) => void replies.push(t),
    getChatMemberCount: async () => 120,
  } as never
}

test('finds links and Solana addresses in a message', () => {
  const msg = {
    text: 'claim at raydlum.io/airdrop or see docs',
    entities: [{ type: 'url' as const, offset: 9, length: 18 }, { type: 'text_link' as const, offset: 32, length: 4, url: 'https://jup.ag' }],
  }
  assert.deepEqual(linksIn(msg), ['raydlum.io/airdrop', 'https://jup.ag'])
  assert.deepEqual(addressesIn('mint DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 and https://x.io/So11111111111111111111111111111111111111112'), [
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  ])
})

test('warns once about a look-alike phishing link and stays quiet otherwise', async () => {
  const replies: string[] = []
  await handleGroup(groupMessage('Free airdrop for holders: raydlum.io/claim', replies))
  assert.equal(replies.length, 1)
  assert.match(replies[0], /raydlum\[\.\]io looks suspicious: pretends to be Raydium/)
  assert.match(replies[0], /guarding this group/)

  await handleGroup(groupMessage('again: raydlum.io/claim', replies))
  assert.equal(replies.length, 1, 'the same warning is not repeated within the hour')

  await handleGroup(groupMessage('Nice thread on https://solana.com/news today', replies))
  assert.equal(replies.length, 1, 'ordinary links get no reply')
  assert.equal(groupStats().warnings, 1)
})

test('answers /check for links without the AI', async () => {
  const replies: string[] = []
  await handleGroup(groupMessage('/check@SunnySolBot raydlum.io', replies))
  assert.match(replies[0], /Suspicious: raydlum\[\.\]io/)
  await handleGroup(groupMessage('/check', replies))
  assert.match(replies[1], /Send \/check with a token/)
})

test('a Spanish-speaking group hears Sunny in Spanish', async () => {
  const replies: string[] = []
  const spanish = (text: string) => {
    const m = groupMessage(text, replies) as unknown as { chat: { id: number } }
    m.chat.id = -1002
    return m as never
  }
  await handleGroup(spanish('Hola a todos, ¿alguien sabe si este airdrop es real? raydlum.io/reclamar'))
  assert.equal(replies.length, 1)
  assert.match(replies[0], /raydlum\[\.\]io parece sospechoso: se hace pasar por Raydium/)
  assert.match(replies[0], /cuidando este grupo/)
  // The group stays in Spanish, even for a bare /check.
  await handleGroup(spanish('/check'))
  assert.match(replies[1], /Envía \/check/)
})

test('the guardian reads channel posts, edits and link buttons, and ignores other bots', async () => {
  const replies: string[] = []
  const at = (chat: number, message: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    ({
      chat: { id: chat, type: 'supergroup', title: 'Builders' },
      reply: async (t: string) => void replies.push(t),
      getChatMemberCount: async () => 50,
      ...extra,
      ...message,
    }) as never
  // Posted "as a channel": Telegram's channel bot is the sender, the channel is sender_chat.
  await handleGroup(at(-2001, { message: { message_id: 1, from: { id: 136817688, is_bot: true }, sender_chat: { id: -100999, type: 'channel' }, text: 'raydlum.io', entities: [{ type: 'url', offset: 0, length: 10 }] } }))
  assert.equal(replies.length, 1, 'a channel post is read')
  // A clean message edited into a scam link.
  await handleGroup(at(-2002, { editedMessage: { message_id: 2, from: { id: 8, is_bot: false }, text: 'see jupp.ag', entities: [{ type: 'url', offset: 4, length: 7 }] } }))
  assert.equal(replies.length, 2, 'an edited message is read')
  // An inline bot's "Claim" button.
  await handleGroup(at(-2003, { message: { message_id: 3, from: { id: 9, is_bot: false }, text: '🎁 Free tokens', reply_markup: { inline_keyboard: [[{ text: 'Claim', url: 'https://raydlum.io/claim' }]] } } }))
  assert.equal(replies.length, 3, 'a link button is read')
  // A real bot's message, and a /check meant for another bot, are left alone.
  await handleGroup(at(-2004, { message: { message_id: 4, from: { id: 10, is_bot: true }, text: 'raydlum.io', entities: [{ type: 'url', offset: 0, length: 10 }] } }))
  await handleGroup(at(-2004, { message: { message_id: 5, from: { id: 11, is_bot: false }, text: '/check@OtherBot BONK' } }, { me: { username: 'SunnySolBot' } }))
  assert.equal(replies.length, 3)
})

test('no false alarms for builders, and look-alikes work in /check', async () => {
  const { checkLink } = await import('../src/scams.js')
  const { checkCommand } = await import('../src/groups.js')
  for (const site of ['sunny-demo.vercel.app', 'someone.github.io', 'docs.project.gitbook.io', 'bonk.fun']) {
    const r = checkLink(site)
    assert.ok(!('error' in r) && r.verdict !== 'suspicious' && r.verdict !== 'known_scam', site)
  }
  // A trusted page that wraps an Action is never "official" on its own.
  const wrapped = checkLink('https://dial.to/?action=solana-action:https://claim.example/api/actions/x')
  assert.ok(!('error' in wrapped) && wrapped.verdict !== 'official')
  assert.match(await checkCommand('phаntom.app', 'en'), /Suspicious: phаntom\[\.\]app\nPretends to be Phantom/)
  assert.match(await checkCommand('phаntom.app', 'es'), /Sospechoso: phаntom\[\.\]app\nSe hace pasar por Phantom/)
})
