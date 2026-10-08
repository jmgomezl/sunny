import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { ed25519 } from '@noble/curves/ed25519.js'
import { base58 } from '@scure/base'
import { PublicKey } from '@solana/web3.js'
import { hasBrain, reply } from './brain.js'
import { buildHome } from './home.js'
import { accountKind, inspect } from './inspect.js'
import { allow, DAY, HOUR } from './limits.js'
import { logActivity, MAX_WATCHED, noteHabit, touch, unwatchAll, unwatchWallet, watchedOf, watchWallet } from './users.js'
import { syncBadges } from './badges.js'
import { isAddress } from './wallet.js'
import { faucet, hasChain, pocketState, prepareOwnerTx, submitOwnerTx, type OwnerAction } from './solana.js'
import { linkWallet, ownerOf, saveVault, usesOwnWallet, validRecord, vaultOf } from './vaults.js'
import { challenge, sessionFor, verifySignIn, walletOfSession, walletUserId } from './walletAuth.js'
import { DEEP_SCAN_PATH, deepScanPreflight, deepScanRoute } from './x402.js'
import { MAX_SHARE_BYTES, readShare, saveShare, startShareCleanup } from './shares.js'
import { DEMO_BLINK_PATH, demoBlinkMeta, demoBlinkTransaction } from './demoblink.js'

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
// Signed-in wallets cost nothing to create, so what Sunny pays for (the model, rent and fees on
// devnet) has a shared daily ceiling for them, on top of the per-person limits.
const WALLET_CHATS_PER_DAY = 600
const WALLET_SIGNINS_PER_DAY = 400
const WALLET_PAID_ACTIONS_PER_DAY = 150

type Person = { id: number; name: string; lang: string; guest: boolean; wallet?: string }

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

type Route = 'chat' | 'home' | 'inspect' | 'wallet' | 'share' | 'badges'

// Per-hour allowances. Chat spends model credits, so it is the tightest; the user's chat
// key is shared with the Telegram chat ("u:<id>").
const LIMITS: Record<Route, { user: number; guest: number; ip: number }> = {
  chat: { user: USER_PER_HOUR, guest: GUEST_PER_HOUR, ip: IP_PER_HOUR },
  home: { user: 240, guest: 120, ip: 400 },
  inspect: { user: 40, guest: 15, ip: 40 },
  wallet: { user: 120, guest: 30, ip: 120 },
  share: { user: 30, guest: 1, ip: 60 },
  badges: { user: 120, guest: 30, ip: 240 },
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
    touch(user.id, user.name, user.lang)
    return { ...user, guest: false }
  }

  // Signed in with their own wallet (outside Telegram: a Seeker, Android or a desktop extension).
  if (typeof body.walletSession === 'string' && body.walletSession) {
    const address = walletOfSession(body.walletSession)
    if (!address) throw new ApiError(401, 'Your wallet sign-in expired. Connect your wallet again ☀️')
    const id = walletUserId(address)
    const key = route === 'chat' ? `u:${id}` : `${route}:u:${id}`
    if (!allow(key, limit.user, HOUR) || !allow(`${route}:ip:${ip}`, limit.ip * 2, HOUR)) {
      throw new ApiError(429, 'I need a little rest to save my energy ☀️ Let’s pick this up in a bit.')
    }
    // Wallet identities are free to make, so the paid model gets a shared daily ceiling too.
    if (route === 'chat' && !allow('wallet-chats', WALLET_CHATS_PER_DAY, DAY)) {
      throw new ApiError(429, 'I’ve had a busy day ☀️ Try me again tomorrow, or open me in Telegram.')
    }
    linkWallet(id, address)
    touch(id, 'friend', 'en')
    return { id, name: 'friend', lang: 'en', guest: false, wallet: address }
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

async function readJson(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > maxBytes) throw new ApiError(413, 'That message is too long for me.')
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
  // A handler that already started answering can't change its status any more.
  if (res.headersSent) return void res.end()
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
    blinks: answer.blinks,
    watchChanged: answer.watchChanged,
    live: answer.live,
    guest: person.guest,
  })
}

const clientIp = (req: IncomingMessage) => String(req.headers['x-real-ip'] ?? req.socket.remoteAddress ?? 'unknown')

/** Starts watching a wallet for this person (read-only), or explains why not. */
async function startWatching(userId: number, input: string) {
  const address = input.trim()
  if (!isAddress(address)) throw new ApiError(400, 'That doesn’t look like a Solana wallet address.')
  if (vaultOf(userId)?.address === address) throw new ApiError(400, 'That’s your Sunny wallet, I already look after it ☀️')
  if ((await accountKind(address).catch(() => 'wallet')) === 'mint') {
    throw new ApiError(400, 'That’s a token’s address, not a wallet. Paste it in Scan & check to see how safe the token is.')
  }
  if (watchWallet(userId, address) === 'full') {
    throw new ApiError(400, `I can watch up to ${MAX_WATCHED} wallets. Stop watching one first.`)
  }
}

/** Home screen data. `watch` / `unwatch` change which wallets Sunny watches for this person. */
async function home(req: IncomingMessage, res: ServerResponse, botToken: string) {
  const body = await readJson(req)
  const person = identify(body, botToken, clientIp(req), 'home')
  if (typeof body.watch === 'string' && body.watch) await startWatching(person.id, body.watch)
  if (typeof body.unwatch === 'string' && body.unwatch) unwatchWallet(person.id, body.unwatch)
  // Older Mini App builds (Telegram caches them) still send `wallet`.
  if (typeof body.wallet === 'string' && body.wallet) await startWatching(person.id, body.wallet)
  if (body.wallet === null) unwatchAll(person.id)
  send(res, 200, { ...(await buildHome(person.id, watchedOf(person.id))), guest: person.guest })
}

/** Scan or paste anything: token, wallet or link. */
async function inspectRoute(req: IncomingMessage, res: ServerResponse, botToken: string) {
  const body = await readJson(req)
  const input = typeof body.input === 'string' ? body.input.trim() : ''
  if (input.length > 2000) throw new ApiError(400, 'That’s too long for me to check. Paste just the link or address.')
  if (!input) throw new ApiError(400, 'Paste or scan something first ☀️')
  const person = identify(body, botToken, clientIp(req), 'inspect')
  const result = await inspect(input, person.guest ? null : (watchedOf(person.id)[0] ?? null))
  const caught =
    (result.kind === 'link' && (result.link.verdict === 'known_scam' || result.link.verdict === 'suspicious')) ||
    (result.kind === 'blink' && result.report.verdict === 'danger')
  if (caught && !person.guest) noteHabit(person.id, 'scamCaught')
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

// Word joiners keep "9AhK…sbkw" on one line wherever it wraps.
const short = (a: string) => `${a.slice(0, 4)}\u2060…\u2060${a.slice(-4)}`

/** The encrypted Sunny wallet backup. Telegram users only: the wallet needs a verified identity. */
async function vaultRoute(req: IncomingMessage, res: ServerResponse, botToken: string) {
  const body = await readJson(req)
  const person = identify(body, botToken, clientIp(req), 'wallet')
  if (person.guest) throw new ApiError(403, 'Your Sunny wallet lives in Telegram. Open me from @SunnySolBot.')
  if (person.wallet) throw new ApiError(403, 'You’re signed in with your own wallet, so there’s no Sunny wallet to make.')
  if (body.op === 'get') return send(res, 200, { record: vaultOf(person.id) })
  if (body.op === 'put') {
    if (!validRecord(body.record)) throw new ApiError(400, 'That wallet record doesn’t look right.')
    const existing = vaultOf(person.id)
    if (existing && existing.address !== body.record.address) {
      throw new ApiError(409, 'You already have a Sunny wallet. Unlock it instead of creating a new one.')
    }
    // A new wallet proves it holds its key, so nobody can claim someone else's address
    // (and its test money and badges).
    if (!existing && !ownsAddress(body.record.address, person.id, body.proof)) {
      throw new ApiError(400, 'I couldn’t confirm this new wallet. Close my sky and open it again, then try once more ☀️')
    }
    saveVault(person.id, body.record)
    if (!existing) logActivity(person.id, 'wallet', `Created your Sunny wallet ${short(body.record.address)}`, 'Locked with your password')
    return send(res, 200, { ok: true })
  }
  throw new ApiError(400, 'Unknown vault request.')
}

/** Checks a new wallet's signature over "Sunny wallet for Telegram user <id>". */
function ownsAddress(address: string, userId: number, proof: unknown) {
  if (typeof proof !== 'string' || proof.length > 100) return false
  try {
    const message = new TextEncoder().encode(`Sunny wallet for Telegram user ${userId}`)
    return ed25519.verify(base58.decode(proof), message, new PublicKey(address).toBytes())
  } catch {
    return false
  }
}

const ACTIONS = new Set(['open', 'topup', 'withdraw', 'limits', 'freeze', 'unfreeze'])

/** Pocket money: read the on-chain state, prepare owner transactions, submit signed ones, faucet. */
async function pocketRoute(req: IncomingMessage, res: ServerResponse, botToken: string) {
  if (!hasChain()) throw new ApiError(503, 'Pocket money is waking up. Try again soon ☀️')
  const body = await readJson(req)
  const person = identify(body, botToken, clientIp(req), 'wallet')
  const wallet = ownerOf(person.id)
  if (body.op === 'state') {
    return send(res, 200, { wallet, own: usesOwnWallet(person.id), state: wallet ? await pocketState(wallet) : null })
  }
  if (person.guest || !wallet) throw new ApiError(403, 'Create your Sunny wallet (or connect yours) first.')

  if (body.op === 'prepare') {
    const action = String(body.action)
    if (!ACTIONS.has(action)) throw new ApiError(400, 'Unknown pocket action.')
    // Real amounts only: no true-as-1, and nothing that rounds to zero cents.
    const num = (v: unknown, max: number) => {
      const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN
      if (!Number.isFinite(n) || n < 0.01 || n > max) throw new ApiError(400, 'That amount doesn’t look right.')
      return n
    }
    const a = (
      action === 'open'
        ? {
            action,
            daily: num(body.daily, 1000),
            perTx: num(body.perTx, 1000),
            // Opening can carry the first pocket money, so it's one signature (feeding Sunny a coin).
            ...(body.amount !== undefined ? { amount: num(body.amount, 10_000) } : {}),
          }
        : action === 'limits'
        ? { action, daily: num(body.daily, 1000), perTx: num(body.perTx, 1000) }
        : action === 'topup' || action === 'withdraw'
          ? { action, amount: num(body.amount, 10_000) }
          : { action }
    ) as OwnerAction
    // Opening a pocket costs Sunny's fee wallet rent: capped for free-to-make wallet sign-ins.
    if (a.action === 'open' && person.wallet && !allow('fee:open:wallets', WALLET_PAID_ACTIONS_PER_DAY, DAY)) {
      throw new ApiError(429, 'I’ve opened lots of pockets today ☀️ Try again tomorrow.')
    }
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
    if (person.wallet && !allow('fee:faucet:wallets', WALLET_PAID_ACTIONS_PER_DAY, DAY)) {
      throw new ApiError(429, 'The test-USDC tap is resting for today ☀️ Try again tomorrow.')
    }
    const sent = await faucet(wallet, FAUCET_USD)
    logActivity(person.id, 'wallet', `Got ${FAUCET_USD} test USDC`, 'Devnet faucet')
    return send(res, 200, { ...sent, amount: FAUCET_USD, state: await pocketState(wallet) })
  }
  throw new ApiError(400, 'Unknown pocket request.')
}

const PUBLIC_URL = process.env.MINI_APP_URL || 'https://sunny.aivylabs.xyz'

// The domain in a sign-in message must be the page's own, or wallets warn about it. Only
// Sunny's site (and a local dev server) can ask for one.
function signInDomain(req: IncomingMessage) {
  const host = String(req.headers.host ?? '')
  const allowed = new URL(PUBLIC_URL).host
  if (host === allowed || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return host
  throw new ApiError(400, 'Sign in from Sunny’s own site.')
}

/** POST /api/auth { op: 'challenge', address } then { op: 'verify', message, signature }: sign in with a wallet. */
async function authRoute(req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req)
  const domain = signInDomain(req)
  if (!allow(`auth:ip:${clientIp(req)}`, 60, HOUR)) throw new ApiError(429, 'Too many sign-in attempts. Try again in a bit.')
  if (body.op === 'challenge') {
    if (typeof body.address !== 'string' || !isAddress(body.address)) throw new ApiError(400, 'That isn’t a Solana address.')
    return send(res, 200, { message: challenge(body.address, domain) })
  }
  if (body.op === 'verify') {
    if (typeof body.message !== 'string' || typeof body.signature !== 'string' || body.message.length > 600) {
      throw new ApiError(400, 'Missing signature.')
    }
    if (!allow('wallet-signins', WALLET_SIGNINS_PER_DAY, DAY)) {
      throw new ApiError(429, 'Lots of new friends today ☀️ Try again tomorrow, or open me in Telegram.')
    }
    const address = verifySignIn(body.message, body.signature, domain)
    if (!address) throw new ApiError(401, 'That signature didn’t check out. Try connecting again.')
    const id = walletUserId(address)
    linkWallet(id, address)
    touch(id, 'friend', 'en')
    // The wallet you signed in with is your real wallet on mainnet too: Sunny watches it
    // (read-only), so the weather and "Should I sign this?" use your actual balances.
    if (!watchedOf(id).includes(address)) watchWallet(id, address)
    return send(res, 200, { session: sessionFor(address), address })
  }
  throw new ApiError(400, 'Unknown sign-in request.')
}

/** POST /api/badges { op: 'sync' | 'backup' }: mints earned badges and returns every badge's status. */
async function badgesRoute(req: IncomingMessage, res: ServerResponse, botToken: string) {
  const body = await readJson(req)
  const person = identify(body, botToken, clientIp(req), 'badges')
  // Backing up a key needs a key: no Sunny wallet, no Key Keeper badge.
  if (body.op === 'backup' && !person.guest && vaultOf(person.id)) noteHabit(person.id, 'keyBackup')
  // Each badge mint costs the fee wallet rent; wallet sign-ins share a daily ceiling.
  send(res, 200, await syncBadges(person.id, person.wallet ? () => allow('fee:badges:wallets', WALLET_PAID_ACTIONS_PER_DAY * 2, DAY) : undefined))
}

/** POST /api/share { image: base64 JPEG }: stores a share card and returns its public link. */
async function shareRoute(req: IncomingMessage, res: ServerResponse, botToken: string) {
  // Base64 adds a third, plus room for initData.
  const body = await readJson(req, Math.ceil(MAX_SHARE_BYTES * 1.4) + 8 * 1024)
  const person = identify(body, botToken, clientIp(req), 'share')
  if (person.guest || person.wallet) throw new ApiError(401, 'Sharing works inside Telegram.')
  const id = typeof body.image === 'string' ? saveShare(Buffer.from(body.image, 'base64')) : null
  if (!id) throw new ApiError(400, 'That doesn’t look like a share card.')
  send(res, 200, { url: `${PUBLIC_URL}/api/share/${id}.jpg` })
}

function shareImage(req: IncomingMessage, res: ServerResponse) {
  const image = readShare(/^\/api\/share\/([a-f0-9]{32})\.jpg$/.exec(req.url ?? '')?.[1] ?? '')
  if (!image) return send(res, 404, { error: 'Not found' })
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800, immutable' })
  res.end(image)
}

// Solana Actions must answer CORS preflights and allow any origin (wallets and blink clients).
const ACTION_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Content-Encoding, Accept-Encoding',
  'Content-Type': 'application/json',
}

/** Sunny's harmless scam-demo Blink (see demoblink.ts). */
async function demoBlinkRoute(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, ACTION_HEADERS)
    return res.end()
  }
  if (!allow(`blink-demo:${clientIp(req)}`, 120, HOUR)) return send(res, 429, { error: 'Too many requests' })
  if (req.method === 'GET') {
    res.writeHead(200, ACTION_HEADERS)
    return res.end(JSON.stringify(demoBlinkMeta(PUBLIC_URL)))
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' })
  const body = await readJson(req)
  if (typeof body.account !== 'string' || !isAddress(body.account)) {
    res.writeHead(400, ACTION_HEADERS)
    return res.end(JSON.stringify({ message: 'Send the account that would sign.' }))
  }
  // Built before any header goes out, so a failure can still answer properly.
  const tx = await demoBlinkTransaction(body.account).catch((err) => {
    console.error('[sunny] demo blink failed', err)
    return null
  })
  res.writeHead(tx ? 200 : 500, ACTION_HEADERS)
  res.end(JSON.stringify(tx ?? { message: 'The demo couldn’t build its transaction right now.' }))
}

export function startApi(port: number, botToken: string) {
  startShareCleanup()
  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/api/health') return send(res, 200, { ok: true, brain: hasBrain() })
      if (req.method === 'POST' && req.url === '/api/chat') return await chat(req, res, botToken)
      if (req.method === 'POST' && req.url === '/api/home') return await home(req, res, botToken)
      if (req.method === 'POST' && req.url === '/api/inspect') return await inspectRoute(req, res, botToken)
      if (req.method === 'POST' && req.url === '/api/vault') return await vaultRoute(req, res, botToken)
      if (req.method === 'POST' && req.url === '/api/pocket') return await pocketRoute(req, res, botToken)
      if (req.method === 'POST' && req.url === '/api/share') return await shareRoute(req, res, botToken)
      if (req.method === 'POST' && req.url === '/api/badges') return await badgesRoute(req, res, botToken)
      if (req.method === 'POST' && req.url === '/api/auth') return await authRoute(req, res)
      if (req.url?.split('?')[0] === DEMO_BLINK_PATH) return await demoBlinkRoute(req, res)
      if (req.method === 'GET' && req.url?.startsWith('/api/share/')) return shareImage(req, res)
      // Public x402 API: anyone can pay for a deep scan, not just Sunny.
      if (req.method === 'OPTIONS' && req.url?.startsWith(DEEP_SCAN_PATH)) return deepScanPreflight(res)
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
