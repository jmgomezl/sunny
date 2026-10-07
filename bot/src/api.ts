import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { hasBrain, reply } from './brain.js'
import { buildHome } from './home.js'
import { inspect } from './inspect.js'
import { allow, DAY, HOUR } from './limits.js'
import { logActivity, MAX_WATCHED, unwatchAll, unwatchWallet, watchedOf, watchWallet } from './users.js'
import { isAddress } from './wallet.js'
import { faucet, hasChain, pocketState, prepareOwnerTx, submitOwnerTx, type OwnerAction } from './solana.js'
import { saveVault, validRecord, vaultOf } from './vaults.js'
import { DEEP_SCAN_PATH, deepScanRoute } from './x402.js'

// Small HTTP API for the Mini App, served behind nginx at /api/.
// Telegram users are identified from the signed initData, so chatting in the Mini App
// shares Sunny's memory and allowance with the Telegram chat. Visitors outside
// Telegram (e.g. judges opening the link) get a tightly limited guest session.

const MAX_BODY_BYTES = 8 * 1024
const MAX_MESSAGE_CHARS = 800
const INIT_DATA_MAX_AGE_S = DAY / 1000

const USER_PER_HOUR = 40
const GUEST_PER_HOUR = 12
const IP_PER_HOUR = 30
const GUESTS_PER_DAY = 400

type Person = { id: number; name: string; lang: string; guest: boolean }

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** Verifies Telegram Mini App initData and returns the user, or null if it isn't genuine. */
export function verifyInitData(initData: string, botToken: string): { id: number; name: string; lang: string } | null {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const matches = (exclude: string[]) => {
    const check = [...params.entries()]
      .filter(([k]) => !exclude.includes(k))
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('\n')
    const expected = createHmac('sha256', secret).update(check).digest('hex')
    return expected.length === hash.length && timingSafeEqual(Buffer.from(expected), Buffer.from(hash))
  }
  // Telegram's docs have described the check string both with and without `signature`;
  // either form is only producible with the bot token, so accept both.
  if (!matches(['hash']) && !matches(['hash', 'signature'])) return null

  const authDate = Number(params.get('auth_date'))
  if (!authDate || Date.now() / 1000 - authDate > INIT_DATA_MAX_AGE_S) return null

  try {
    const user = JSON.parse(params.get('user') ?? '')
    if (typeof user?.id !== 'number') return null
    return { id: user.id, name: String(user.first_name || 'friend'), lang: String(user.language_code || 'en') }
  } catch {
    return null
  }
}

type Route = 'chat' | 'home' | 'inspect' | 'wallet'

// Per-hour allowances. Chat spends model credits, so it is the tightest; the user's chat
// key is shared with the Telegram chat ("u:<id>").
const LIMITS: Record<Route, { user: number; guest: number; ip: number }> = {
  chat: { user: USER_PER_HOUR, guest: GUEST_PER_HOUR, ip: IP_PER_HOUR },
  home: { user: 240, guest: 120, ip: 400 },
  inspect: { user: 40, guest: 15, ip: 40 },
  wallet: { user: 120, guest: 30, ip: 120 },
}

const FAUCET_USD = 20
const FAUCET_EVERY_MS = 3 * HOUR

function identify(body: Record<string, unknown>, botToken: string, ip: string, route: Route): Person {
  const limit = LIMITS[route]
  if (typeof body.initData === 'string' && body.initData) {
    const user = verifyInitData(body.initData, botToken)
    if (!user) throw new ApiError(401, 'I couldn’t confirm it’s you. Close and reopen me from Telegram?')
    const key = route === 'chat' ? `u:${user.id}` : `${route}:u:${user.id}`
    if (!allow(key, limit.user, HOUR)) throw new ApiError(429, 'I need a little rest to save my energy ☀️ Let’s pick this up in a bit.')
    return { ...user, guest: false }
  }

  const guestId = typeof body.guestId === 'string' ? body.guestId : ''
  if (!/^[A-Za-z0-9-]{8,64}$/.test(guestId)) throw new ApiError(400, 'Something went wrong. Refresh and try again?')
  if (!allow(`${route}:g:${guestId}`, limit.guest, HOUR) || !allow(`${route}:ip:${ip}`, limit.ip, HOUR)) {
    throw new ApiError(429, 'That’s all I can do in the web preview for now ☀️ Open me in Telegram to keep going.')
  }
  if (route === 'chat' && !allow('guests', GUESTS_PER_DAY, DAY)) {
    throw new ApiError(429, 'I’ve had a busy day in the web preview. Open me in Telegram to keep talking ☀️')
  }
  // Negative ids keep guest memories apart from real Telegram users.
  const id = -parseInt(createHash('sha256').update(guestId).digest('hex').slice(0, 12), 16)
  return { id, name: 'friend', lang: 'en', guest: true }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new ApiError(413, 'That message is too long for me.')
    chunks.push(chunk as Buffer)
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
  } catch {
    // Fall through to the error below.
  }
  throw new ApiError(400, 'Something went wrong. Try again?')
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function chat(req: IncomingMessage, res: ServerResponse, botToken: string) {
  if (!hasBrain()) throw new ApiError(503, 'My chatty side is still waking up ☀️ Try again soon.')
  const body = await readJson(req)
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) throw new ApiError(400, 'Tell me something first ☀️')
  if (message.length > MAX_MESSAGE_CHARS) throw new ApiError(413, 'That message is too long for me. Try a shorter one?')

  const person = identify(body, botToken, clientIp(req), 'chat')
  const answer = await reply(person.id, person.name, message, person.lang)
  send(res, 200, {
    reply: answer.text,
    cards: answer.cards,
    links: answer.links,
    alerts: answer.alerts,
    pocket: answer.pocket,
    mine: answer.mine,
    wallets: answer.wallets,
    scans: answer.scans,
    watchChanged: answer.watchChanged,
    live: answer.live,
    guest: person.guest,
  })
}

const clientIp = (req: IncomingMessage) => String(req.headers['x-real-ip'] ?? req.socket.remoteAddress ?? 'unknown')

/** Starts watching a wallet for this person (read-only), or explains why not. */
function startWatching(userId: number, address: string) {
  if (!isAddress(address)) throw new ApiError(400, 'That doesn’t look like a Solana wallet address.')
  if (watchWallet(userId, address) === 'full') {
    throw new ApiError(400, `I can watch up to ${MAX_WATCHED} wallets. Stop watching one first.`)
  }
}

/** Home screen data. `watch` / `unwatch` change which wallets Sunny watches for this person. */
async function home(req: IncomingMessage, res: ServerResponse, botToken: string) {
  const body = await readJson(req)
  const person = identify(body, botToken, clientIp(req), 'home')
  if (typeof body.watch === 'string' && body.watch) startWatching(person.id, body.watch)
  if (typeof body.unwatch === 'string' && body.unwatch) unwatchWallet(person.id, body.unwatch)
  // Older Mini App builds (Telegram caches them) still send `wallet`.
  if (typeof body.wallet === 'string' && body.wallet) startWatching(person.id, body.wallet)
  if (body.wallet === null) unwatchAll(person.id)
  send(res, 200, { ...(await buildHome(person.id, watchedOf(person.id))), guest: person.guest })
}

/** Scan or paste anything: token, wallet or link. */
async function inspectRoute(req: IncomingMessage, res: ServerResponse, botToken: string) {
  const body = await readJson(req)
  const input = typeof body.input === 'string' ? body.input.trim().slice(0, 300) : ''
  if (!input) throw new ApiError(400, 'Paste or scan something first ☀️')
  const person = identify(body, botToken, clientIp(req), 'inspect')
  const result = await inspect(input)
  if (result.kind === 'token' && result.found) {
    logActivity(person.id, 'check', `Checked $${result.card.symbol} · ${result.card.risk} risk`, 'Jupiter + RugCheck')
  } else if (result.kind === 'wallet') {
    logActivity(person.id, 'wallet', `Checked wallet ${short(result.report.address)}`, `${result.report.risk} risk`)
  } else if (result.kind === 'link') {
    const bad = result.link.verdict === 'known_scam' || result.link.verdict === 'suspicious'
    logActivity(person.id, bad ? 'scam' : 'check', `${bad ? 'Flagged' : 'Checked'} ${result.link.domain}`, result.link.verdict.replace('_', ' '))
  }
  send(res, 200, result)
}

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`

/** The encrypted Sunny wallet backup. Telegram users only: the wallet needs a verified identity. */
async function vaultRoute(req: IncomingMessage, res: ServerResponse, botToken: string) {
  const body = await readJson(req)
  const person = identify(body, botToken, clientIp(req), 'wallet')
  if (person.guest) throw new ApiError(403, 'Your Sunny wallet lives in Telegram. Open me from @SunnySolBot.')
  if (body.op === 'get') return send(res, 200, { record: vaultOf(person.id) })
  if (body.op === 'put') {
    if (!validRecord(body.record)) throw new ApiError(400, 'That wallet record doesn’t look right.')
    const existing = vaultOf(person.id)
    if (existing && existing.address !== body.record.address) {
      throw new ApiError(409, 'You already have a Sunny wallet. Unlock it instead of creating a new one.')
    }
    saveVault(person.id, body.record)
    if (!existing) logActivity(person.id, 'wallet', `Created your Sunny wallet ${short(body.record.address)}`, 'Locked with your password')
    return send(res, 200, { ok: true })
  }
  throw new ApiError(400, 'Unknown vault request.')
}

const ACTIONS = new Set(['open', 'topup', 'withdraw', 'limits', 'freeze', 'unfreeze'])

/** Pocket money: read the on-chain state, prepare owner transactions, submit signed ones, faucet. */
async function pocketRoute(req: IncomingMessage, res: ServerResponse, botToken: string) {
  if (!hasChain()) throw new ApiError(503, 'Pocket money is waking up. Try again soon ☀️')
  const body = await readJson(req)
  const person = identify(body, botToken, clientIp(req), 'wallet')
  const wallet = vaultOf(person.id)?.address
  if (body.op === 'state') return send(res, 200, { wallet: wallet ?? null, state: wallet ? await pocketState(wallet) : null })
  if (person.guest || !wallet) throw new ApiError(403, 'Create your Sunny wallet first.')

  if (body.op === 'prepare') {
    const action = String(body.action)
    if (!ACTIONS.has(action)) throw new ApiError(400, 'Unknown pocket action.')
    const num = (v: unknown, max: number) => {
      const n = Number(v)
      if (!Number.isFinite(n) || n <= 0 || n > max) throw new ApiError(400, 'That amount doesn’t look right.')
      return n
    }
    const a = (
      action === 'open' || action === 'limits'
        ? { action, daily: num(body.daily, 1000), perTx: num(body.perTx, 1000) }
        : action === 'topup' || action === 'withdraw'
          ? { action, amount: num(body.amount, 10_000) }
          : { action }
    ) as OwnerAction
    return send(res, 200, await prepareOwnerTx(wallet, a))
  }

  if (body.op === 'submit') {
    if (typeof body.id !== 'string' || typeof body.signature !== 'string') throw new ApiError(400, 'Missing signature.')
    try {
      const sent = await submitOwnerTx(body.id, wallet, body.signature)
      return send(res, 200, { ...sent, state: await pocketState(wallet) })
    } catch (err) {
      throw new ApiError(400, err instanceof Error ? err.message : 'The transaction failed')
    }
  }

  if (body.op === 'faucet') {
    if (!allow(`faucet:${person.id}`, 1, FAUCET_EVERY_MS)) throw new ApiError(429, 'You got test USDC recently. Try again in a few hours.')
    const sent = await faucet(wallet, FAUCET_USD)
    logActivity(person.id, 'wallet', `Got ${FAUCET_USD} test USDC`, 'Devnet faucet')
    return send(res, 200, { ...sent, amount: FAUCET_USD, state: await pocketState(wallet) })
  }
  throw new ApiError(400, 'Unknown pocket request.')
}

export function startApi(port: number, botToken: string) {
  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/api/health') return send(res, 200, { ok: true, brain: hasBrain() })
      if (req.method === 'POST' && req.url === '/api/chat') return await chat(req, res, botToken)
      if (req.method === 'POST' && req.url === '/api/home') return await home(req, res, botToken)
      if (req.method === 'POST' && req.url === '/api/inspect') return await inspectRoute(req, res, botToken)
      if (req.method === 'POST' && req.url === '/api/vault') return await vaultRoute(req, res, botToken)
      if (req.method === 'POST' && req.url === '/api/pocket') return await pocketRoute(req, res, botToken)
      // Public x402 API: anyone can pay for a deep scan, not just Sunny.
      if (req.method === 'GET' && req.url?.startsWith(DEEP_SCAN_PATH)) {
        if (!allow(`x402:${clientIp(req)}`, 120, HOUR)) return send(res, 429, { error: 'Too many scans. Try again later.' })
        return await deepScanRoute(req, res)
      }
      send(res, 404, { error: 'Not found' })
    } catch (err) {
      if (err instanceof ApiError) return send(res, err.status, { error: err.message })
      console.error('[sunny] api error', err)
      send(res, 500, { error: 'My thoughts got cloudy for a second. Try me again? ☁️' })
    }
  })
  server.listen(port, '127.0.0.1', () => console.log(`[sunny] api listening on 127.0.0.1:${port}`))
  return server
}
