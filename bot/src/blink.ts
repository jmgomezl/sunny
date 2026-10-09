import {
  Connection,
  PublicKey,
  type TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import { DEMO_BLINK_PATH, DEMO_HOST, demoBlinkMeta, demoBlinkTransaction } from './demoblink.js'
import { lookup } from 'node:dns/promises'
import { BlockList, isIP, isIPv4, isIPv6 } from 'node:net'
import { MAINNET_RPC, SOL_MINT_ADDRESS } from './market.js'
import { checkLink, type LinkCheck } from './scams.js'
import { tokenInfo } from './wallet.js'
import { feePayer, hasChain } from './solana.js'

// "Should I sign this?" A Blink (Solana Action) is a link that asks your wallet to sign a
// transaction. Sunny opens it the way a wallet would: it finds the Action behind the link,
// asks the site for the transaction it wants signed for your wallet, reads every
// instruction, and simulates it on mainnet against your real balances. Then it says in
// plain words what would leave your wallet. Nothing is ever signed or sent.

const REGISTRY = 'https://actions-registry.dial.to/all'
const REGISTRY_MS = 60 * 60_000
const TIMEOUT_MS = 10_000
const PACKET_SIZE = 1232
const MAX_LOOKUP_TABLES = 8
const SYSTEM = '11111111111111111111111111111111'
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
const PROGRAM_NAMES: Record<string, string> = {
  [SYSTEM]: 'System',
  [TOKEN]: 'SPL Token',
  [TOKEN_2022]: 'Token-2022',
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: 'Associated Token Account',
  ComputeBudget111111111111111111111111111111: 'Compute Budget',
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: 'Memo',
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: 'Jupiter',
}

const mainnet = new Connection(MAINNET_RPC, 'confirmed')

// ── Fetching links strangers send ────────────────────────────────────────────
// Sunny's server opens whatever link someone pastes, so it must never be pointed at itself
// or its neighbours: only https, only public addresses (checked again on every redirect),
// and only a small answer.

const MAX_BODY = 512 * 1024
const MAX_REDIRECTS = 3
const PRIVATE = new BlockList()
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) PRIVATE.addSubnet(net, bits, 'ipv4')
for (const [net, bits] of [
  ['::', 96], ['::1', 128], ['64:ff9b::', 96], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) PRIVATE.addSubnet(net, bits, 'ipv6')
// Local development only: lets the demo Blink be checked on http://127.0.0.1.
const ALLOW_PRIVATE = process.env.SUNNY_ALLOW_PRIVATE_FETCH === '1'

const isPrivate = (ip: string) => {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1]
  if (v4 || isIPv4(ip)) return PRIVATE.check(v4 ?? ip, 'ipv4')
  return isIPv6(ip) ? PRIVATE.check(ip, 'ipv6') : true
}

/** Throws unless `url` is an https link to a public address. */
export async function assertPublic(url: URL) {
  if (ALLOW_PRIVATE) return
  if (url.protocol !== 'https:') throw new Error('Only https links can be checked.')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
  if (!addresses.length || addresses.some((a) => isPrivate(a.address))) throw new Error('That link points somewhere private.')
}

async function readCapped(res: Response) {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > MAX_BODY) {
      await reader.cancel().catch(() => {})
      throw new Error('The answer was too big.')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** A hostname compared as people read it: lower case, without a trailing dot. */
export const bareHost = (host: string) => host.toLowerCase().replace(/\.$/, '')

// Sunny's own demo Blink is read in-process: no trip out to the internet and back in through
// its own public rate limit, which every visitor shares.
async function ownDemo<T>(url: URL, init?: RequestInit) {
  if (bareHost(url.hostname) !== DEMO_HOST || url.pathname.replace(/\/$/, '') !== DEMO_BLINK_PATH) return null
  const at = `https://${DEMO_HOST}${DEMO_BLINK_PATH}`
  if (init?.method !== 'POST') return { ok: true, status: 200, body: demoBlinkMeta(`https://${DEMO_HOST}`) as T, url: at }
  let account = ''
  try {
    account = String((JSON.parse(String(init.body ?? '{}')) as { account?: unknown }).account ?? '')
  } catch {
    // no account
  }
  const tx = account ? await demoBlinkTransaction(account).catch(() => null) : null
  return { ok: Boolean(tx), status: tx ? 200 : 400, body: (tx ?? { message: 'Send the account that would sign.' }) as T, url: at }
}

const json = async <T>(target: string, init?: RequestInit) => {
  const local = await ownDemo<T>(new URL(target), init)
  if (local) return local
  let url = new URL(target)
  for (let hop = 0; ; hop++) {
    await assertPublic(url)
    const res = await fetch(url, {
      ...init,
      redirect: 'manual',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      signal: globalThis.AbortSignal.timeout(TIMEOUT_MS),
    })
    const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    if (next && hop < MAX_REDIRECTS) {
      await res.body?.cancel().catch(() => {})
      url = new URL(next, url)
      continue
    }
    let body: T | null = null
    try {
      body = JSON.parse(await readCapped(res)) as T
    } catch {
      body = null
    }
    return { ok: res.ok, status: res.status, body, url: url.toString() }
  }
}

/**
 * Without a wallet of yours to simulate with, a Blink is still read using a stand-in address:
 * Sunny's fee wallet, which holds nothing on mainnet.
 */
export const probeAccount = () => (hasChain() ? feePayer().publicKey.toBase58() : '11111111111111111111111111111112')

// ── Finding the Action behind a link ─────────────────────────────────────────

type Rule = { pathPattern: string; apiPath: string }

/** Matches an actions.json rule: `*` is one path segment, `**` any number of them. */
export function applyRule(rule: Rule, url: URL): string | null {
  const pattern = rule.pathPattern.replace(/^https?:\/\/[^/]+/, '')
  const re = new RegExp(
    `^${pattern
      .split(/(\*\*|\*)/)
      .map((p) => (p === '**' ? '(.*)' : p === '*' ? '([^/]+)' : p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')))
      .join('')}$`,
  )
  const m = re.exec(url.pathname)
  if (!m) return null
  let i = 1
  const api = rule.apiPath.replace(/\*\*|\*/g, () => m[i++] ?? '')
  const target = new URL(api, url.origin)
  for (const [k, v] of url.searchParams) if (!target.searchParams.has(k)) target.searchParams.set(k, v)
  return target.toString()
}

/**
 * A cheap first look, so Sunny never fetches random sites (phishing pages included) just to
 * find out: an Action link format, a host in Dialect's registry, or an Action-style API path.
 */
export async function looksLikeBlink(input: string) {
  const text = input.trim()
  if (/^solana-action:/i.test(text)) return true
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
    if (url.searchParams.has('action')) return true
    if (/\/(api\/)?(actions?|blinks?)(\/|$)/i.test(url.pathname)) return true
    return (await registryState(url.hostname)) !== 'unknown'
  } catch {
    return false
  }
}

/**
 * Does a chat message carry a link shaped like a Blink (an Action link, a dial.to link, or an
 * Action-style API path)? No network: it decides whether the Blink reader must run first.
 */
const ACTION_PATH = /\/(api\/)?(actions?|blinks?)(\/|$)/i

export function hasBlinkShapedLink(message: string) {
  // Links wrapped in «», backticks, Markdown or a label ("link:"), or glued to a word ("¡Mira!https…").
  const spaced = message
    .replace(/[«»`*[\]()¿¡<>]/g, ' ')
    .replace(/\b(link|url|enlace):/gi, ' ')
    .replace(/(?<=\S)(?=(solana(-action)?:)?https?:\/\/)/gi, ' ')
  for (const raw of spaced.split(/\s+/)) {
    // Links wrapped in brackets or quotes, or ending a sentence, count too.
    const word = raw.replace(/^[(<[{"'“‘]+|[)>\]}"'”’.,;!?]+$/gu, '')
    if (/^solana(-action)?:/i.test(word) || /(^|\/\/)(www\.)?dial\.to([/?]|$)/i.test(word)) return true
    // Anything that starts with a scheme, or host.tld followed by a path or query (ports and
    // non-ASCII hosts too).
    const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(word)
    if (!scheme && !/^[^\s/?#]+\.[^\s/?#]+[/?]/u.test(word)) continue
    try {
      const url = new URL(scheme ? word : `https://${word}`)
      if (url.searchParams.has('action') || ACTION_PATH.test(url.pathname)) return true
    } catch {
      // not a link
    }
  }
  return false
}

/** Is this a Blink? Returns the Action API URL behind it, or null. */
export async function resolveAction(input: string): Promise<string | null> {
  const text = input.trim()
  if (/^solana(-action)?:https?(:|%3A)/i.test(text)) {
    try {
      return decodeURIComponent(text.replace(/^solana(-action)?:/i, ''))
    } catch {
      return null
    }
  }
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  // Interstitial links: https://dial.to/?action=solana-action:https://…
  const param = url.searchParams.get('action')
  if (param) return decodeURIComponent(param).replace(/^solana-action:/i, '')
  // A website that maps its pages to Actions in /actions.json, or the link is an Action API
  // itself: both asked at once, so a slow site can't use up the check's time twice.
  const [map, direct] = await Promise.all([
    json<{ rules?: Rule[] }>(`${url.origin}/actions.json`).catch(() => null),
    json<ActionMeta>(url.toString()).catch(() => null),
  ])
  for (const rule of map?.body?.rules ?? []) {
    const api = applyRule(rule, url)
    if (api) return api
  }
  if (direct?.ok && direct.body?.title && (direct.body.links?.actions?.length || direct.body.label)) return url.toString()
  // An Action-shaped path that won't answer Sunny (a drainer can hide from checkers) is still read
  // as a Blink, so the verdict is "it won't show me its transaction", never a neutral link.
  if (ACTION_PATH.test(url.pathname)) return url.toString()
  return null
}

// ── Dialect's registry of verified and malicious Actions ─────────────────────

type Registry = { at: number; hosts: Map<string, 'trusted' | 'malicious'> }
let registry: Registry | null = null

export async function registryState(host: string): Promise<'trusted' | 'malicious' | 'unknown'> {
  if (!registry || Date.now() - registry.at > REGISTRY_MS) {
    try {
      const all = (await json<Record<string, { host: string; state: string }[]>>(REGISTRY)).body ?? {}
      const hosts = new Map<string, 'trusted' | 'malicious'>()
      for (const list of Object.values(all)) {
        for (const { host: h, state } of list ?? []) {
          // Malicious wins if a host appears twice.
          if (state === 'malicious' || (state === 'trusted' && !hosts.has(h))) hosts.set(h, state)
        }
      }
      registry = { at: Date.now(), hosts }
    } catch {
      // Unreachable: keep what we had and try again in five minutes, not on every check.
      registry = { at: Date.now() - REGISTRY_MS + 5 * 60_000, hosts: registry?.hosts ?? new Map() }
    }
  }
  return registry.hosts.get(host) ?? 'unknown'
}

// ── Reading the transaction ──────────────────────────────────────────────────

type ActionMeta = {
  title?: string
  description?: string
  icon?: string
  label?: string
  disabled?: boolean
  error?: { message?: string }
  links?: {
    actions?: {
      label: string
      href: string
      parameters?: { name: string; type?: string; min?: string | number; options?: { value: string }[] }[]
    }[]
  }
}

/** What a finding is, so repeats merge into one line and the worst comes first. */
type Code = 'sol' | 'drain' | 'wallet' | 'owner' | 'approve' | 'many' | 'signer' | 'close'
export type Warning = { level: 'danger' | 'caution'; code: Code; text: string }
const ORDER: Code[] = ['drain', 'wallet', 'owner', 'approve', 'many', 'signer', 'sol', 'close']
const accounts = (n: number) => (n === 1 ? 'one of your token accounts' : `${n} of your token accounts`)

const u64 = (data: Uint8Array, at: number) => {
  let v = 0n
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(data[at + i] ?? 0)
  return v
}
// Word joiners keep "9AhK…sbkw" on one line wherever it wraps.
const short = (a: string) => `${a.slice(0, 4)}\u2060…\u2060${a.slice(-4)}`

/**
 * Checks every instruction for the ways drainers take over a wallet: reassigning the wallet,
 * handing a token account to someone else, approving a spender, or needing a second signer.
 */
export function inspectInstructions(
  tx: VersionedTransaction,
  instructions: TransactionInstruction[],
  wallet: string,
  walletTokenAccounts: Set<string>,
): { warnings: Warning[]; programs: string[] } {
  const warnings: Warning[] = []
  const keys = tx.message.staticAccountKeys
  for (let i = 0; i < tx.message.header.numRequiredSignatures; i++) {
    const signer = keys[i]?.toBase58()
    const signed = tx.signatures[i]?.some((b) => b !== 0)
    if (signer && signer !== wallet && !signed) {
      warnings.push({ level: 'danger', code: 'signer', text: `it needs a second signature from ${short(signer)} (a Blink should only need yours)` })
    }
  }
  let handedOver = 0
  let closed = 0
  // SOL sent from your wallet, read straight from the instructions: shown even when there's no
  // wallet to simulate with. Tips and small fees stay quiet.
  const sent = new Map<string, bigint>()
  const programs = new Set<string>()
  for (const ix of instructions) {
    const program = ix.programId.toBase58()
    programs.add(PROGRAM_NAMES[program] ?? short(program))
    const data = ix.data
    const k = (n: number) => ix.keys[n]?.pubkey.toBase58() ?? ''
    if (program === SYSTEM && data.length >= 4 && data.readUInt32LE(0) === 1 && k(0) === wallet) {
      warnings.push({ level: 'danger', code: 'wallet', text: 'it hands control of your whole wallet to another program' })
    }
    if (program === SYSTEM && data.length >= 12 && data.readUInt32LE(0) === 2 && k(0) === wallet && k(1) !== wallet) {
      sent.set(k(1), (sent.get(k(1)) ?? 0n) + data.readBigUInt64LE(4))
    }
    if (program === TOKEN || program === TOKEN_2022) {
      const op = data[0]
      // Yours if it's a token account Sunny saw in your wallet, or if your wallet is the one
      // signing as its owner: without your balances (a guest, a group) the second still shows it.
      const yours = (account: string, authority: string) => walletTokenAccounts.has(account) || authority === wallet
      if ((op === 4 || op === 13) && yours(k(0), op === 4 ? k(2) : k(3))) {
        const delegate = op === 4 ? k(1) : k(2)
        const unlimited = u64(data, 1) === 0xffffffffffffffffn
        warnings.push({
          level: unlimited ? 'danger' : 'caution',
          code: 'approve',
          text: `it lets ${short(delegate)} spend ${unlimited ? 'all' : 'some'} of your tokens later, without asking again`,
        })
      }
      // SetAuthority on a token account's owner or close authority (types 2 and 3).
      if (op === 6 && (data[1] === 2 || data[1] === 3 || walletTokenAccounts.has(k(0))) && yours(k(0), k(1))) handedOver++
      if (op === 9 && yours(k(0), k(2)) && k(1) !== wallet) closed++
    }
  }
  for (const [to, lamports] of sent) {
    if (lamports < 100_000_000n) continue
    const sol = Number(lamports) / 1e9
    warnings.push({ level: 'caution', code: 'sol', text: `it sends ${sol.toLocaleString('en-US', { maximumFractionDigits: 3 })} SOL from the wallet that signs to ${short(to)}` })
  }
  if (handedOver) warnings.push({ level: 'danger', code: 'owner', text: `it hands ${accounts(handedOver)} to another wallet` })
  if (closed) warnings.push({ level: 'caution', code: 'close', text: `it closes ${accounts(closed)} and sends the rent to someone else` })
  return { warnings, programs: [...programs] }
}

// ── Simulating it against your balances ──────────────────────────────────────

export type Change = { symbol: string; mint: string; amount: number; usd: number | null }

type Held = { mint: string; decimals: number; amount: number }

async function heldTokens(wallet: PublicKey) {
  const held = new Map<string, Held>()
  for (const programId of [new PublicKey(TOKEN), new PublicKey(TOKEN_2022)]) {
    const { value } = await mainnet.getParsedTokenAccountsByOwner(wallet, { programId })
    for (const a of value) {
      const info = a.account.data.parsed.info
      held.set(a.pubkey.toBase58(), {
        mint: info.mint,
        decimals: info.tokenAmount.decimals,
        amount: Number(info.tokenAmount.uiAmount ?? 0),
      })
    }
  }
  return held
}

type Simulation = { ok: boolean; error?: string; sends: Change[]; receives: Change[]; warnings: Warning[] }

async function simulate(
  tx: VersionedTransaction,
  wallet: PublicKey,
  held: Map<string, Held>,
  allKeys: Set<string>,
): Promise<Simulation> {
  const watch = [wallet.toBase58(), ...[...held.keys()].filter((a) => allKeys.has(a))]
  const preSol = await mainnet.getBalance(wallet)
  const sim = await mainnet.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    accounts: { encoding: 'base64', addresses: watch },
  })
  if (sim.value.err) {
    const fromLogs = sim.value.logs?.map((l) => /Error Message: (.+?)\.?$/.exec(l)?.[1]).find(Boolean)
    const insufficient = sim.value.logs?.some((l) => /insufficient (funds|lamports)/i.test(l))
    return {
      ok: false,
      error: fromLogs ?? (insufficient ? 'not enough funds in the wallet' : simError(sim.value.err)),
      sends: [],
      receives: [],
      warnings: [],
    }
  }

  const warnings: Warning[] = []
  const deltas: { mint: string; amount: number; share: number }[] = []
  const post = sim.value.accounts ?? []
  const walletAfter = post[0]
  if (walletAfter && walletAfter.owner !== SYSTEM) {
    warnings.push({ level: 'danger', code: 'wallet', text: 'afterwards your wallet would belong to another program' })
  }
  let reassigned = 0
  if (walletAfter) {
    const sol = (walletAfter.lamports - preSol) / 1e9
    if (sol !== 0) deltas.push({ mint: SOL_MINT_ADDRESS, amount: sol, share: preSol ? -sol / (preSol / 1e9) : 0 })
  }
  watch.slice(1).forEach((address, i) => {
    const after = post[i + 1]
    const before = held.get(address)!
    if (!after) {
      // The account is gone: closed, with everything in it.
      if (before.amount > 0) deltas.push({ mint: before.mint, amount: -before.amount, share: 1 })
      return
    }
    const data = Buffer.from(after.data[0], 'base64')
    const owner = new PublicKey(data.subarray(32, 64)).toBase58()
    if (owner !== wallet.toBase58()) reassigned++
    const amount = Number(data.readBigUInt64LE(64)) / 10 ** before.decimals
    const diff = amount - before.amount
    if (Math.abs(diff) > 0) deltas.push({ mint: before.mint, amount: diff, share: before.amount ? -diff / before.amount : 0 })
  })

  const info = await tokenInfo([...new Set(deltas.map((d) => d.mint))]).catch(() => new Map())
  const changes = deltas.map((d) => {
    const t = info.get(d.mint)
    const price = t?.usdPrice ?? null
    return {
      symbol: d.mint === SOL_MINT_ADDRESS ? 'SOL' : (t?.symbol ?? short(d.mint)),
      mint: d.mint,
      amount: d.amount,
      usd: price === null ? null : Math.round(Math.abs(d.amount) * price * 100) / 100,
      share: d.share,
    }
  })
  if (reassigned) warnings.push({ level: 'danger', code: 'owner', text: `it hands ${accounts(reassigned)} to another wallet` })
  const sends = changes.filter((c) => c.amount < 0)
  // Fees are tiny; a drain takes nearly everything, often several assets at once.
  const drained = sends.filter((c) => c.share >= 0.9 && (c.usd ?? 0) >= 1)
  if (drained.length) {
    warnings.push({
      level: 'danger',
      code: 'drain',
      text: `it takes almost all of your ${drained.map((c) => c.symbol).join(' and ')}: ${drained.map((c) => fmt({ ...c, amount: Math.abs(c.amount) })).join(' and ')}`,
    })
  }
  if (sends.filter((c) => (c.usd ?? 0) >= 1).length >= 3) {
    warnings.push({ level: 'danger', code: 'many', text: 'it moves several different tokens out at once, a classic drainer pattern' })
  }
  const strip = ({ symbol, mint, amount, usd }: Change & { share: number }) => ({ symbol, mint, amount: Math.abs(amount), usd })
  return { ok: true, sends: sends.map(strip), receives: changes.filter((c) => c.amount > 0).map(strip), warnings }
}

// ── The report ───────────────────────────────────────────────────────────────

export type BlinkReport = {
  link: string
  actionUrl: string
  host: string
  registry: 'trusted' | 'malicious' | 'unknown'
  phishing: LinkCheck['verdict'] | null
  title: string
  description: string
  icon?: string
  buttons: string[]
  tried: string | null
  /** The wallet the transaction was built and simulated for, and whether it's one you watch. */
  wallet: string | null
  yourWallet: boolean
  outcome: 'safe_to_read' | 'simulated' | 'would_fail' | 'not_simulated' | 'unavailable'
  failReason?: string
  sends: Change[]
  receives: Change[]
  programs: string[]
  warnings: Warning[]
  verdict: 'danger' | 'caution' | 'ok'
  summary: string
}

const fmt = (c: Change) =>
  `${c.amount.toLocaleString('en-US', { maximumFractionDigits: c.amount < 1 ? 4 : 2 })} ${c.symbol}${c.usd !== null ? ` (~$${c.usd.toLocaleString('en-US')})` : ''}`

/** Picks a button to simulate, filling in its inputs with modest example values. */
function pickButton(meta: ActionMeta, actionUrl: string) {
  const actions = meta.links?.actions ?? []
  const plain = actions.find((a) => !/\{[^}]+\}/.test(a.href))
  const chosen = plain ?? actions[0]
  if (!chosen) return { label: meta.label ?? 'Continue', href: actionUrl }
  const href = chosen.href.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const p = chosen.parameters?.find((x) => x.name === name)
    if (p?.options?.length) return encodeURIComponent(p.options[0].value)
    if (p?.type === 'number') return String(p.min ?? '0.1')
    // A unique made-up value, so things like a domain name aren't already taken.
    return `sunny${Math.floor(Date.now() / 1000) % 1_000_000}`
  })
  return { label: chosen.label, href: new URL(href, actionUrl).toString() }
}

/**
 * Checks a Blink for `wallet` (a wallet you watch, so the simulation uses your real
 * balances). Without one, Sunny still reads the transaction, but can't say what you'd lose.
 */
// One answer per check, however slow the site: each request has its own timeout, and the whole
// check (redirects, metadata, the transaction, simulation) has this one.
const CHECK_DEADLINE_MS = 20_000

/** "Should I sign this?" for a link. Null when it isn't a Blink; throws if it takes too long. */
export function checkBlink(link: string, watched: string | null, probe: string): Promise<BlinkReport | null> {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('That site took too long to answer, so I couldn’t read what it wants signed.')), CHECK_DEADLINE_MS)
  })
  return Promise.race([readBlink(link, watched, probe), deadline])
    .catch(async (err) => {
      if (!hasBlinkShapedLink(link) && !/^solana(-action)?:/i.test(link.trim())) throw err
      return unreadable(link)
    })
    .finally(() => clearTimeout(timer))
}

/** A Blink that wouldn't answer in time: caution, with the same host checks as any other. */
async function unreadable(link: string): Promise<BlinkReport> {
  const target = link.trim().replace(/^solana(-action)?:/i, '')
  const host = (() => {
    try {
      return bareHost(new URL(/^https?:\/\//i.test(target) ? target : `https://${target}`).hostname)
    } catch {
      return 'unknown'
    }
  })()
  const phish = checkLink(host)
  return finish({
    link,
    actionUrl: target,
    host,
    registry: await registryState(host).catch(() => 'unknown' as const),
    phishing: 'error' in phish ? null : phish.verdict,
    title: 'Unknown Action',
    description: '',
    buttons: [],
    tried: null,
    wallet: null,
    yourWallet: false,
    sends: [],
    receives: [],
    programs: [],
    warnings: [],
    outcome: 'unavailable',
    failReason: 'It took too long to answer.',
  })
}

const PHISH_RANK = { known_scam: 3, suspicious: 2, unknown: 1, official: 0 } as const

/** Folds another host into a report's checks: malicious or scam anywhere wins; trusted needs all. */
async function alsoCheck(base: { host: string; registry: BlinkReport['registry']; phishing: BlinkReport['phishing'] }, other: string) {
  const host = bareHost(other)
  if (host === bareHost(base.host)) return
  const reg = await registryState(host).catch(() => 'unknown' as const)
  if (reg === 'malicious' || base.registry === 'malicious') base.registry = 'malicious'
  else if (reg !== 'trusted' || base.registry !== 'trusted') base.registry = 'unknown'
  const phish = checkLink(host)
  const verdict = 'error' in phish ? null : phish.verdict
  if (verdict && (!base.phishing || PHISH_RANK[verdict] > PHISH_RANK[base.phishing])) {
    base.phishing = verdict
    base.host = host
  }
}

async function readBlink(link: string, watched: string | null, probe: string): Promise<BlinkReport | null> {
  const actionUrl = await resolveAction(link)
  if (!actionUrl) return null
  const host = new URL(actionUrl).hostname
  const pageHost = (() => {
    try {
      const page = link.replace(/^solana(-action)?:/i, '')
      return new URL(/^https?:\/\//i.test(page) ? page : `https://${page}`).hostname
    } catch {
      return host
    }
  })()
  const [reg, pageReg] = await Promise.all([registryState(host), registryState(pageHost)])
  // Only the Action's own host can be trusted: a trusted page (like dial.to) can wrap any Action,
  // so the page can make things look worse, never better.
  const registry: BlinkReport['registry'] = reg === 'malicious' || pageReg === 'malicious' ? 'malicious' : reg
  const phish = checkLink(host)
  const phishing = 'error' in phish ? null : phish.verdict

  const base = {
    link,
    actionUrl,
    host,
    registry,
    phishing,
    title: 'Unknown Action',
    description: '',
    buttons: [] as string[],
    tried: null as string | null,
    wallet: watched ?? null,
    yourWallet: Boolean(watched),
    sends: [] as Change[],
    receives: [] as Change[],
    programs: [] as string[],
    warnings: [] as Warning[],
  }
  const meta = await json<ActionMeta>(actionUrl).catch(() => null)
  if (!meta?.ok || !meta.body) {
    return finish({ ...base, outcome: 'unavailable', failReason: 'The site didn’t answer like a working Blink.' })
  }
  // A redirect (a link shortener, an open redirect on a trusted site) can't launder a drainer:
  // the host the answer really came from is checked too, and the worst verdict wins.
  const metaUrl = meta.url ?? actionUrl
  await alsoCheck(base, new URL(metaUrl).hostname)
  const m = meta.body
  Object.assign(base, {
    // Solana Pay transaction requests call it a label.
    title: m.title ?? m.label ?? 'Untitled Action',
    description: (m.description ?? '').slice(0, 280),
    icon: m.icon,
    buttons: (m.links?.actions ?? []).map((a) => a.label).slice(0, 6),
  })

  // Ask for the transaction, built for your wallet (or a stand-in, just to read it).
  const button = pickButton(m, metaUrl)
  await alsoCheck(base, new URL(button.href).hostname)
  base.tried = button.label
  const account = watched ?? probe
  const posted = await json<{ transaction?: string; message?: string }>(button.href, {
    method: 'POST',
    body: JSON.stringify({ account }),
  }).catch(() => null)
  if (!posted?.body?.transaction) {
    return finish({
      ...base,
      outcome: 'unavailable',
      failReason: posted?.body?.message ?? (posted ? `The site returned an error (${posted.status}).` : 'The site didn’t answer.'),
    })
  }

  // A real transaction fits in one Solana packet; anything bigger is junk (or an attempt to
  // make Sunny look up thousands of tables).
  const raw = Buffer.from(posted.body.transaction, 'base64')
  let tx: VersionedTransaction | null = null
  try {
    if (raw.length <= PACKET_SIZE) tx = VersionedTransaction.deserialize(raw)
  } catch {
    tx = null
  }
  if (!tx || tx.message.addressTableLookups.length > MAX_LOOKUP_TABLES) {
    return finish({ ...base, outcome: 'unavailable', failReason: 'The site sent something that isn’t a valid Solana transaction.' })
  }
  const lookups = (
    await Promise.all(tx.message.addressTableLookups.map((l) => mainnet.getAddressLookupTable(l.accountKey).catch(() => null)))
  ).flatMap((r) => (r?.value ? [r.value] : []))
  const instructions = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: lookups }).instructions
  const owner = new PublicKey(account)
  const held = await heldTokens(owner).catch(() => new Map<string, Held>())
  const { warnings, programs } = inspectInstructions(tx, instructions, account, new Set(held.keys()))
  base.warnings.push(...warnings)
  base.programs = programs

  if (!watched) return finish({ ...base, outcome: 'not_simulated' })
  // Every account the transaction touches, including the ones it loads through lookup tables:
  // a drainer can reach your token accounts that way without listing them directly.
  const allKeys = new Set(tx.message.staticAccountKeys.map((k) => k.toBase58()))
  try {
    const loaded = tx.message.getAccountKeys({ addressLookupTableAccounts: lookups }).accountKeysFromLookups
    for (const k of [...(loaded?.writable ?? []), ...(loaded?.readonly ?? [])]) allKeys.add(k.toBase58())
  } catch {
    // A table that couldn't be read: the instructions above were read without it too.
  }
  const sim = await simulate(tx, owner, held, allKeys).catch((err) => ({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    sends: [],
    receives: [],
    warnings: [],
  }))
  base.warnings.push(...sim.warnings)
  return finish({
    ...base,
    sends: sim.sends,
    receives: sim.receives,
    outcome: sim.ok ? 'simulated' : 'would_fail',
    failReason: sim.error,
  })
}

/** A simulation error in plain words, instead of {"InstructionError":[3,{"Custom":17}]}. */
function simError(err: unknown): string {
  const ix = (err as { InstructionError?: [number, unknown] })?.InstructionError
  if (ix) {
    const [index, why] = ix
    const code = (why as { Custom?: number })?.Custom
    return `step ${index + 1} of the transaction was refused${code !== undefined ? ` by its program (error ${code})` : typeof why === 'string' ? ` (${why.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()})` : ''}`
  }
  if (typeof err === 'string') return err.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  return 'the network refused it'
}

/** One line per kind of finding (the simulation's version wins), worst first. */
function merge(warnings: Warning[]) {
  const byCode = new Map<Code, Warning>()
  for (const w of warnings) byCode.set(w.code, w)
  return ORDER.flatMap((c) => (byCode.has(c) ? [byCode.get(c)!] : []))
}

const sentence = (parts: string[]) => {
  const s = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? '')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Turns the findings into a verdict and one plain sentence. */
/** Text from a site or a program (untrusted): one line, no quotes, capped. */
export const untrusted = (text: string, max = 120) =>
  text.replace(/[\r\n"“”]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

export function finish(raw: Omit<BlinkReport, 'verdict' | 'summary'>): BlinkReport {
  const r = { ...raw, warnings: merge(raw.warnings) }
  const dangers = r.warnings.filter((w) => w.level === 'danger')
  let verdict: BlinkReport['verdict'] = 'ok'
  if (r.registry === 'malicious' || r.phishing === 'known_scam' || dangers.length) verdict = 'danger'
  else if (
    r.registry !== 'trusted' ||
    r.phishing === 'suspicious' ||
    r.warnings.length ||
    r.outcome === 'would_fail' ||
    r.outcome === 'unavailable'
  )
    verdict = 'caution'

  const what = r.sends.length ? `you’d send ${r.sends.map(fmt).join(' and ')}` : ''
  const gets = r.receives.length ? `you’d get ${r.receives.map(fmt).join(' and ')}` : ''
  const flows = [what, gets].filter(Boolean).join(', and ')
  let summary: string
  if (verdict === 'danger') {
    const why =
      r.registry === 'malicious'
        ? 'Dialect’s registry lists this Blink as malicious.'
        : r.phishing === 'known_scam'
          ? `${r.host} is a known phishing site.`
          : `${sentence([...dangers, ...r.warnings.filter((w) => w.level !== 'danger')].slice(0, 3).map((d) => d.text))}.`
    summary = `Don’t sign. ${why}`
  } else if (r.outcome === 'would_fail') {
    // The reason comes from program logs, which a hostile program can write: kept short.
    summary = `This transaction would fail right now (${untrusted(r.failReason ?? '', 60)}), so signing would only cost you a fee.`
  } else if (r.outcome === 'unavailable') {
    // Whatever the site said instead is its own text, not a reason to trust it.
    summary = 'The site didn’t show me the transaction it wants signed, so I can’t vouch for it. Don’t sign anything from it until a check shows the transaction.'
  } else if (r.outcome === 'not_simulated') {
    // Never "nothing alarming" while something in it moves your funds.
    summary = r.warnings.length
      ? `I can’t see your balances yet, but ${sentence(r.warnings.map((w) => w.text)).toLowerCase()}. Don’t sign until I can simulate it with your wallet: watch it in my sky.`
      : 'Nothing alarming in the transaction itself. Watch your wallet in my sky and I’ll simulate it against your real balances.'
  } else {
    const registry = r.registry === 'trusted' ? `${r.host} is verified in Dialect’s registry` : `${r.host} isn’t in Dialect’s registry, so be extra careful`
    summary = `${flows ? `If you sign, ${flows}` : 'It doesn’t move your tokens'}. ${registry}.${r.warnings.length ? ` Also, ${sentence(r.warnings.map((w) => w.text)).toLowerCase()}.` : ''}`
  }
  return { ...r, verdict, summary }
}
