// The visit streak behind the morning note and the Bond meter: a visit a day keeps it
// going, a missed day ends it, and background work never counts. Run: pnpm test
import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.SUNNY_DATA_DIR = mkdtempSync(join(tmpdir(), 'sunny-streak-'))
const { logActivity, morningSubscribers, markBriefSent, streakInfo, touch } = await import('../src/users.js')

const DAY = 86_400_000

test('a visit a day builds the streak, a missed day ends it', () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-07T12:00:00Z') })
  try {
    const id = 555001
    touch(id, 'Ana', 'es')
    assert.deepEqual(streakInfo(id), { days: 1, visitedToday: true })
    touch(id)
    assert.equal(streakInfo(id).days, 1, 'two visits on one day count once')

    mock.timers.tick(DAY)
    assert.deepEqual(streakInfo(id), { days: 1, visitedToday: false }, 'still alive the next morning')
    touch(id)
    assert.deepEqual(streakInfo(id), { days: 2, visitedToday: true })

    logActivity(id, 'check', 'Background check', 'not a visit')
    mock.timers.tick(2 * DAY)
    assert.deepEqual(streakInfo(id), { days: 0, visitedToday: false }, 'background work never keeps it alive')
    touch(id)
    assert.equal(streakInfo(id).days, 1)
  } finally {
    mock.timers.reset()
  }
})

test('the morning note goes to recent visitors once a day, unless they opt out', () => {
  const id = 555002
  touch(id, 'Leo', 'en')
  const today = new Date().toISOString().slice(0, 10)
  assert.ok(morningSubscribers(today).some((p) => p.id === id && p.name === 'Leo' && p.lang === 'en'))
  markBriefSent(id, today)
  assert.ok(!morningSubscribers(today).some((p) => p.id === id), 'not twice on the same day')
})
