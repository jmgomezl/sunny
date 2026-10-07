// End-to-end pocket money on devnet, acting as a Telegram user against a local API
// (BOT_POLLING=off). Creates a self-custodial wallet, opens and tops up a pocket,
// has Sunny draw within limits, shows Solana refusing over-limit and frozen draws,
// then withdraws. Run: node --env-file=../.env --import tsx scripts/e2e-devnet.ts
import { createHmac } from 'node:crypto'
import { ed25519 } from '@noble/curves/ed25519.js'
import { agentDraw, pocketState } from '../src/solana.js'
import { createWallet, describeTransaction } from '../../web/src/lib/vault.js'

const API = process.env.E2E_API || 'http://127.0.0.1:8820/api'
const user = { id: 990000000 + Math.floor(Math.random() * 1e6), first_name: 'E2E', language_code: 'en' }

function initData() {
  const fields = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAHe2e', user: JSON.stringify(user) }
  const check = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_BOT_TOKEN!).digest()
  return new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(check).digest('hex') }).toString()
}

async function call<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, initData: initData() }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`${path} ${res.status}: ${data.error}`)
  return data as T
}

const { record, seed } = await createWallet('correct horse battery')
await call('vault', { op: 'put', record })
console.log('1. wallet created on "device", backup stored:', record.address)

const sign = (message: string) => Buffer.from(ed25519.sign(Buffer.from(message, 'base64'), seed)).toString('base64')
async function ownerDoes(action: object) {
  const p = await call<{ id: string; message: string }>('pocket', { op: 'prepare', ...action })
  const summary = describeTransaction(p.message, record.address)
  const sent = await call<{ explorer: string }>('pocket', { op: 'submit', id: p.id, signature: sign(p.message) })
  console.log(`   ✓ ${summary.join(' · ')}  ${sent.explorer}`)
}

const faucet = await call<{ amount: number; explorer: string }>('pocket', { op: 'faucet' })
console.log(`2. faucet: +${faucet.amount} test USDC  ${faucet.explorer}`)
console.log('3. owner actions, signed on the device:')
await ownerDoes({ action: 'open', daily: 10, perTx: 5 })
await ownerDoes({ action: 'topup', amount: 15 })

const draw = async (usd: number) => {
  try {
    const r = await agentDraw(record.address, usd)
    console.log(`   ✓ Sunny drew $${usd}  ${r.explorer}`)
  } catch (err) {
    console.log(`   ⛔ Sunny tried $${usd}: ${(err as Error).message}`)
  }
}
console.log('4. Sunny draws (limits: $5/payment, $10/day):')
await draw(3)
await draw(6)
await draw(5)
await draw(3)
console.log('5. freeze:')
await ownerDoes({ action: 'freeze' })
await draw(1)
await ownerDoes({ action: 'unfreeze' })
const s = await pocketState(record.address)
console.log(`6. state: vault $${s.vault}, spent today $${s.spentToday}/${s.dailyLimit}, Sunny's wallet $${s.agentUsdc}, frozen ${s.frozen}`)
await ownerDoes({ action: 'withdraw', amount: s.vault })
const end = await pocketState(record.address)
console.log(`7. after withdraw: vault $${end.vault}, owner wallet $${end.ownerUsdc}`)

// Sunny reads all of this back, in plain words, without being given an address.
type Mine = { mine: { address: string; recent: { what: string; amount: number | null; ok: boolean }[] } | null }
const chat = await call<{ reply: string } & Mine>('chat', { message: 'What happened in my wallet?' })
if (chat.mine?.address !== record.address) throw new Error('Sunny did not find the wallet on its own')
console.log(`8. "What happened in my wallet?" → ${chat.mine.recent.length} transactions read from devnet:`)
for (const e of chat.mine.recent) console.log(`   ${e.ok ? '✓' : '✗'} ${e.what}${e.amount !== null ? ` $${e.amount}` : ''}`)
console.log(`   Sunny: ${chat.reply.replace(/\s+/g, ' ').slice(0, 160)}…`)
