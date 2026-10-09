// Money Sunny may owe a pocket: written down before it moves, refunded until it lands, never
// refunded twice, and if a refund never lands, the person sees it. A restart must not lose any.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sunny-refunds-'))
process.env.SUNNY_DATA_DIR = dir
const { allRefunds, holdPurchase, noteDraw, owe, pendingRefunds, processRefunds, refundNow } = await import('../src/refunds.js')
const { activityOf } = await import('../src/users.js')

const OWNER = 'So11111111111111111111111111111111111111112'
const onDisk = () => JSON.parse(readFileSync(join(dir, 'refunds.json'), 'utf8')) as { id: string; status: string; draw?: unknown }[]
const due = () => {
  for (const r of pendingRefunds()) r.nextAt = 0
}

/** A pretend chain. `mode` decides what the next sends do. */
function fakeChain() {
  const landed = new Set<string>()
  const c = {
    landed,
    built: 0,
    sends: [] as string[],
    // ok: lands. down: never sent. lost: lands, but the answer never comes back. dropped: sent, never lands.
    mode: 'ok' as 'ok' | 'down' | 'lost' | 'dropped',
    expiredNow: false,
    wallet: 0.1,
    balanceDown: false,
    async build() {
      const signature = `refund-${++c.built}`
      return { signature, raw: signature, blockhash: 'bh', validUntil: 100 }
    },
    async submit(sent: { signature: string }) {
      if (c.mode === 'down') throw new Error('RPC down')
      c.sends.push(sent.signature)
      if (c.mode === 'dropped') throw new Error('block height exceeded')
      landed.add(sent.signature)
      if (c.mode === 'lost') throw new Error('timed out waiting for confirmation')
    },
    async status(signature: string) {
      return landed.has(signature) ? ('landed' as const) : ('unknown' as const)
    },
    async expired() {
      return c.expiredNow
    },
    async spendable() {
      if (c.balanceDown) throw new Error('RPC timeout')
      return c.wallet
    },
  }
  return c
}

test('a purchase is on disk before any money moves, and so is its draw', () => {
  const r = holdPurchase(OWNER, 41, 0.1, 'A paid scan that didn’t come back')
  assert.equal(onDisk().find((x) => x.id === r.id)?.status, 'held')
  noteDraw(r, 'draw-1', 100)
  assert.deepEqual(onDisk().find((x) => x.id === r.id)?.draw, { signature: 'draw-1', validUntil: 100 })
  owe(r)
  assert.equal(onDisk().find((x) => x.id === r.id)?.status, 'pending', 'owed before the first try')
})

test('it retries until it lands, and the person sees it in their activity', async () => {
  const chain = fakeChain()
  const r = holdPurchase(OWNER, 42, 0.1, 'A paid scan that didn’t come back')
  owe(r)
  chain.mode = 'down'
  assert.equal(await refundNow(r, chain), null)
  assert.equal(r.status, 'pending', 'a failed try waits for the next one')
  chain.mode = 'ok'
  due()
  await processRefunds(chain)
  assert.equal(r.status, 'done')
  assert.match(activityOf(42)[0].text, /Refunded \$0\.10 to your pocket/)
})

test('a refund whose answer got lost is never paid twice', async () => {
  const chain = fakeChain()
  const r = holdPurchase(OWNER, 44, 0.1, 'A paid scan that didn’t come back')
  owe(r)
  chain.mode = 'lost'
  assert.equal(await refundNow(r, chain), null, 'no answer, so it counts as not done yet')
  chain.mode = 'ok'
  due()
  await processRefunds(chain)
  assert.equal(r.status, 'done')
  assert.equal(chain.built, 1, 'the chain said it landed, so no second refund was made')
  assert.equal(chain.sends.length, 1)
})

test('a refund that may still land is resent as the same transaction; a new one only once it can’t', async () => {
  const chain = fakeChain()
  const r = holdPurchase(OWNER, 45, 0.1, 'A paid scan that didn’t come back')
  owe(r)
  chain.mode = 'dropped'
  await refundNow(r, chain)
  due()
  await processRefunds(chain)
  assert.deepEqual(chain.sends, ['refund-1', 'refund-1'], 'still valid: the same bytes again')
  chain.expiredNow = true
  chain.mode = 'ok'
  due()
  await processRefunds(chain)
  assert.equal(chain.built, 2, 'expired without landing: only now a new one')
  assert.equal(r.status, 'done')
  assert.equal(r.tx, 'https://solscan.io/tx/refund-2?cluster=devnet')
})

test('one that never lands is marked failed and said plainly, never left as "on its way"', async () => {
  const chain = fakeChain()
  const r = holdPurchase(OWNER, 43, 0.1, 'A paid scan that didn’t come back')
  owe(r)
  chain.mode = 'down'
  await refundNow(r, chain)
  for (let i = 0; i < 8; i++) {
    due()
    await processRefunds(chain)
  }
  assert.equal(r.status, 'failed')
  assert.match(activityOf(43)[0].text, /refund didn’t go through/)
})

test('a purchase cut off by a restart is settled from what the chain shows', async () => {
  const chain = fakeChain()
  const old = (r: { createdAt: string }) => (r.createdAt = new Date(Date.now() - 11 * 60_000).toISOString())

  const neverDrew = holdPurchase(OWNER, 50, 0.1, 'A paid scan that didn’t come back')
  const drewAndHeld = holdPurchase(OWNER, 51, 0.1, 'A paid scan that didn’t come back')
  noteDraw(drewAndHeld, 'draw-held', 100)
  chain.landed.add('draw-held')
  const stillInFlight = holdPurchase(OWNER, 52, 0.1, 'A paid scan that didn’t come back')
  noteDraw(stillInFlight, 'draw-unknown', 100)
  const fresh = holdPurchase(OWNER, 53, 0.1, 'A paid scan that didn’t come back')
  for (const r of [neverDrew, drewAndHeld, stillInFlight]) old(r)

  await processRefunds(chain)
  assert.equal(neverDrew.status, 'void', 'no draw was ever signed')
  assert.equal(drewAndHeld.status, 'done', 'the draw landed and the money was still there: refunded')
  assert.equal(stillInFlight.status, 'held', 'its draw could still land: wait')
  assert.equal(fresh.status, 'held', 'a purchase this young may still be running')

  chain.expiredNow = true
  await processRefunds(chain)
  assert.equal(stillInFlight.status, 'void', 'expired without landing: nothing moved')

  const paid = holdPurchase(OWNER, 54, 0.1, 'A paid scan that didn’t come back')
  noteDraw(paid, 'draw-paid', 100)
  chain.landed.add('draw-paid')
  old(paid)
  chain.wallet = 0
  await processRefunds(chain)
  assert.equal(paid.status, 'settled', 'the money was spent on the scan: nothing to refund')
  assert.equal(allRefunds().filter((r) => r.status === 'pending').length, 0)
})

test('a balance that can’t be read keeps the purchase held; it is never taken as empty', async () => {
  const chain = fakeChain()
  const r = holdPurchase(OWNER, 60, 0.1, 'A paid scan that didn’t come back')
  noteDraw(r, 'draw-confirmed', 100)
  chain.landed.add('draw-confirmed')
  r.createdAt = new Date(Date.now() - 11 * 60_000).toISOString()
  chain.balanceDown = true
  await processRefunds(chain)
  assert.equal(r.status, 'held', 'a timeout is not a zero balance: check again next time')
  chain.balanceDown = false
  await processRefunds(chain)
  assert.equal(r.status, 'done', 'once the balance reads, the money still there goes back')
  assert.equal(chain.built, 1)
})
