// A refunds file that can't be read must never be taken as "nothing owed": it's kept aside for a
// person, and no new purchase starts until then.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sunny-refunds-bad-'))
writeFileSync(join(dir, 'refunds.json'), '[{"id":"owed","status":"pending","amou')
process.env.SUNNY_DATA_DIR = dir
const { holdPurchase, pendingRefunds } = await import('../src/refunds.js')

test('an unreadable refunds file is kept aside and pauses purchases', () => {
  assert.deepEqual(pendingRefunds(), [])
  assert.equal(existsSync(join(dir, 'refunds.json')), false)
  assert.equal(readdirSync(dir).filter((f) => f.startsWith('refunds.json.unreadable-')).length, 1, 'the original is kept')
  assert.throws(() => holdPurchase('So11111111111111111111111111111111111111112', 1, 0.1, 'scan'), /paused/)
})
