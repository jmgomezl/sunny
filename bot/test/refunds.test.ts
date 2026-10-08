// Refunds Sunny owes a pocket: written to disk at once, retried until they land, and if one
// never does, the person sees it. A restart must not lose them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sunny-refunds-'))
process.env.SUNNY_DATA_DIR = dir
const { pendingRefunds, processRefunds, queueRefund } = await import('../src/refunds.js')
const { activityOf } = await import('../src/users.js')

const OWNER = 'So11111111111111111111111111111111111111112'
const due = () => {
  for (const r of pendingRefunds()) r.nextAt = 0
}

test('a refund is on disk before anything else, so a restart still has it', () => {
  queueRefund(OWNER, 42, 0.1, 'A paid scan that didn’t come back')
  const saved = JSON.parse(readFileSync(join(dir, 'refunds.json'), 'utf8'))
  assert.equal(saved.length, 1)
  assert.equal(saved[0].status, 'pending')
})

test('it retries until it lands, and the person sees it in their activity', async () => {
  due()
  await processRefunds(async () => {
    throw new Error('RPC down')
  })
  assert.equal(pendingRefunds()[0].attempts, 1, 'a failed try waits for the next one')
  due()
  await processRefunds(async () => ({ explorer: 'https://solscan.io/tx/abc?cluster=devnet' }))
  assert.equal(pendingRefunds().length, 0)
  assert.match(activityOf(42)[0].text, /Refunded \$0\.10 to your pocket/)
})

test('one that never lands is marked failed and said plainly, never left as "on its way"', async () => {
  queueRefund(OWNER, 43, 0.1, 'A paid scan that didn’t come back')
  for (let i = 0; i < 8; i++) {
    due()
    await processRefunds(async () => {
      throw new Error('still down')
    })
  }
  assert.equal(pendingRefunds().length, 0)
  assert.match(activityOf(43)[0].text, /refund didn’t go through/)
})
