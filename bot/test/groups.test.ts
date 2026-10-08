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
  assert.match(replies[0], /raydlum\.io looks suspicious: pretends to be Raydium/)
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
  assert.match(replies[0], /Suspicious: raydlum\.io/)
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
  assert.match(replies[0], /raydlum\.io parece sospechoso/)
  assert.match(replies[0], /cuidando este grupo/)
  // The group stays in Spanish, even for a bare /check.
  await handleGroup(spanish('/check'))
  assert.match(replies[1], /Envía \/check/)
})
