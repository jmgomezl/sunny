import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { hasBrain, reply } from './brain.js'
import { buildHome } from './home.js'
import { inspect } from './inspect.js'
import { allow, DAY, HOUR } from './limits.js'
import { logActivity, setWallet, walletOf } from './users.js'
import { isAddress } from './wallet.js'

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

type Route = 'chat' | 'home' | 'inspect'

// Per-hour allowances. Chat spends model credits, so it is the tightest; the user's chat
// key is shared with the Telegram chat ("u:<id>").
const LIMITS: Record<Route, { user: number; guest: number; ip: number }> = {
  chat: { user: USER_PER_HOUR, guest: GUEST_PER_HOUR, ip: IP_PER_HOUR },
  home: { user: 240, guest: 120, ip: 400 },
  inspect: { user: 40, guest: 15, ip: 40 },
}

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
    live: answer.live,
    guest: person.guest,
  })
}

const clientIp = (req: IncomingMessage) => String(req.headers['x-real-ip'] ?? req.socket.remoteAddress ?? 'unknown')

/** Home screen data. Linking a wallet here saves it for this person. */
async function home(req: IncomingMessage, res: ServerResponse, botToken: string) {
  const body = await readJson(req)
  const person = identify(body, botToken, clientIp(req), 'home')
  if (body.wallet === null) setWallet(person.id, null)
  else if (typeof body.wallet === 'string' && body.wallet) {
    if (!isAddress(body.wallet)) throw new ApiError(400, 'That doesn’t look like a Solana wallet address.')
    if (body.wallet !== walletOf(person.id)) {
      setWallet(person.id, body.wallet)
      logActivity(person.id, 'wallet', `Linked wallet ${short(body.wallet)}`, 'I’ll watch it from now on')
    }
  }
  send(res, 200, { ...(await buildHome(person.id, walletOf(person.id))), guest: person.guest })
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

export function startApi(port: number, botToken: string) {
  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/api/health') return send(res, 200, { ok: true, brain: hasBrain() })
      if (req.method === 'POST' && req.url === '/api/chat') return await chat(req, res, botToken)
      if (req.method === 'POST' && req.url === '/api/home') return await home(req, res, botToken)
      if (req.method === 'POST' && req.url === '/api/inspect') return await inspectRoute(req, res, botToken)
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
