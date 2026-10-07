import {
  type AddressLookupTableAccount,
  Connection,
  PublicKey,
  type TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import { MAINNET_RPC, SOL_MINT_ADDRESS } from './market.js'
import { checkLink, type LinkCheck } from './scams.js'
import { tokenInfo } from './wallet.js'

// "Should I sign this?" A Blink (Solana Action) is a link that asks your wallet to sign a
// transaction. Sunny opens it the way a wallet would: it finds the Action behind the link,
// asks the site for the transaction it wants signed for your wallet, reads every
// instruction, and simulates it on mainnet against your real balances. Then it says in
// plain words what would leave your wallet. Nothing is ever signed or sent.

const REGISTRY = 'https://actions-registry.dial.to/all'
const REGISTRY_MS = 60 * 60_000
const TIMEOUT_MS = 10_000
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
const json = async <T>(url: string, init?: RequestInit) => {
  const res = await fetch(url, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: globalThis.AbortSignal.timeout(TIMEOUT_MS),
  })
  const body = (await res.json().catch(() => null)) as T | null
  return { ok: res.ok, status: res.status, body }
}

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

/** Is this a Blink? Returns the Action API URL behind it, or null. */
export async function resolveAction(input: string): Promise<string | null> {
  const text = input.trim()
  if (/^solana-action:/i.test(text)) return decodeURIComponent(text.replace(/^solana-action:/i, ''))
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  // Interstitial links: https://dial.to/?action=solana-action:https://…
  const param = url.searchParams.get('action')
  if (param) return decodeURIComponent(param).replace(/^solana-action:/i, '')
  // A website that maps its pages to Actions in /actions.json.
  const map = await json<{ rules?: Rule[] }>(`${url.origin}/actions.json`).catch(() => null)
  for (const rule of map?.body?.rules ?? []) {
    const api = applyRule(rule, url)
    if (api) return api
  }
  // Or the link is an Action API itself.
  const direct = await json<ActionMeta>(url.toString()).catch(() => null)
  if (direct?.ok && direct.body?.title && (direct.body.links?.actions?.length || direct.body.label)) return url.toString()
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
      registry ??= { at: 0, hosts: new Map() }
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
type Code = 'drain' | 'wallet' | 'owner' | 'approve' | 'many' | 'signer' | 'close'
export type Warning = { level: 'danger' | 'caution'; code: Code; text: string }
const ORDER: Code[] = ['drain', 'wallet', 'owner', 'approve', 'many', 'signer', 'close']
const accounts = (n: number) => (n === 1 ? 'one of your token accounts' : `${n} of your token accounts`)

const u64 = (data: Uint8Array, at: number) => {
  let v = 0n
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(data[at + i] ?? 0)
  return v
}
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`

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
  const programs = new Set<string>()
  for (const ix of instructions) {
    const program = ix.programId.toBase58()
    programs.add(PROGRAM_NAMES[program] ?? short(program))
    const data = ix.data
    const k = (n: number) => ix.keys[n]?.pubkey.toBase58() ?? ''
    if (program === SYSTEM && data.length >= 4 && data.readUInt32LE(0) === 1 && k(0) === wallet) {
      warnings.push({ level: 'danger', code: 'wallet', text: 'it hands control of your whole wallet to another program' })
    }
    if (program === TOKEN || program === TOKEN_2022) {
      const op = data[0]
      if ((op === 4 || op === 13) && walletTokenAccounts.has(k(0))) {
        const delegate = op === 4 ? k(1) : k(2)
        const unlimited = u64(data, 1) === 0xffffffffffffffffn
        warnings.push({
          level: unlimited ? 'danger' : 'caution',
          code: 'approve',
          text: `it lets ${short(delegate)} spend ${unlimited ? 'all' : 'some'} of your tokens later, without asking again`,
        })
      }
      if (op === 6 && walletTokenAccounts.has(k(0))) handedOver++
      if (op === 9 && walletTokenAccounts.has(k(0)) && k(1) !== wallet) closed++
    }
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

async function simulate(tx: VersionedTransaction, wallet: PublicKey, held: Map<string, Held>): Promise<Simulation> {
  const allKeys = new Set(tx.message.staticAccountKeys.map((k) => k.toBase58()))
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
      error: fromLogs ?? (insufficient ? 'not enough funds in the wallet' : JSON.stringify(sim.value.err)),
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
export async function checkBlink(link: string, watched: string | null, probe: string): Promise<BlinkReport | null> {
  const actionUrl = await resolveAction(link)
  if (!actionUrl) return null
  const host = new URL(actionUrl).hostname
  const pageHost = (() => {
    try {
      return new URL(/^https?:\/\//i.test(link) ? link : `https://${link.replace(/^solana-action:/i, '')}`).hostname
    } catch {
      return host
    }
  })()
  const [reg, pageReg] = await Promise.all([registryState(host), registryState(pageHost)])
  const registry: BlinkReport['registry'] =
    reg === 'malicious' || pageReg === 'malicious' ? 'malicious' : reg === 'trusted' || pageReg === 'trusted' ? 'trusted' : 'unknown'
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
  const m = meta.body
  Object.assign(base, {
    title: m.title ?? 'Untitled Action',
    description: (m.description ?? '').slice(0, 280),
    icon: m.icon,
    buttons: (m.links?.actions ?? []).map((a) => a.label).slice(0, 6),
  })

  // Ask for the transaction, built for your wallet (or a stand-in, just to read it).
  const button = pickButton(m, actionUrl)
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

  const tx = VersionedTransaction.deserialize(Buffer.from(posted.body.transaction, 'base64'))
  const lookups: AddressLookupTableAccount[] = []
  for (const l of tx.message.addressTableLookups) {
    const table = (await mainnet.getAddressLookupTable(l.accountKey).catch(() => null))?.value
    if (table) lookups.push(table)
  }
  const instructions = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: lookups }).instructions
  const owner = new PublicKey(account)
  const held = await heldTokens(owner).catch(() => new Map<string, Held>())
  const { warnings, programs } = inspectInstructions(tx, instructions, account, new Set(held.keys()))
  base.warnings.push(...warnings)
  base.programs = programs

  if (!watched) return finish({ ...base, outcome: 'not_simulated' })
  const sim = await simulate(tx, owner, held).catch((err) => ({
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
          : `${sentence(dangers.slice(0, 3).map((d) => d.text))}.`
    summary = `Don’t sign. ${why}`
  } else if (r.outcome === 'would_fail') {
    summary = `This transaction would fail right now (${r.failReason}), so signing would only cost you a fee.`
  } else if (r.outcome === 'unavailable') {
    summary = `I couldn’t get a transaction from this Blink: ${r.failReason}`
  } else if (r.outcome === 'not_simulated') {
    summary = `Nothing alarming in the transaction itself${r.warnings.length ? `, but ${sentence(r.warnings.map((w) => w.text)).toLowerCase()}` : ''}. Watch your wallet in my sky and I’ll simulate it against your real balances.`
  } else {
    const registry = r.registry === 'trusted' ? `${r.host} is verified in Dialect’s registry` : `${r.host} isn’t in Dialect’s registry, so be extra careful`
    summary = `${flows ? `If you sign, ${flows}` : 'It doesn’t move your tokens'}. ${registry}.${r.warnings.length ? ` Also, ${sentence(r.warnings.map((w) => w.text)).toLowerCase()}.` : ''}`
  }
  return { ...r, verdict, summary }
}
