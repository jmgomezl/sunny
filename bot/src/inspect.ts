import { lookupToken, MAINNET_RPC } from './market.js'
import { checkLink, type LinkCheck } from './scams.js'
import { isAddress, walletReport, type WalletReport } from './wallet.js'
import { checkBlink, looksLikeBlink, probeAccount, type BlinkReport } from './blink.js'

// "Scan or paste anything": works out whether the input is a token, a wallet or a link
// (including Solana Pay QR codes and Solscan/Explorer links) and returns the right report.

const TOKEN_PROGRAMS = new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'])

export type Inspection =
  | ({ kind: 'token' } & Awaited<ReturnType<typeof lookupToken>>)
  | { kind: 'wallet'; report: WalletReport }
  | { kind: 'link'; link: LinkCheck }
  | { kind: 'blink'; report: BlinkReport }
  | { kind: 'unknown'; message: string }

/** Pulls an address out of QR payloads and explorer links. */
export function extractAddress(input: string): string | null {
  const s = input.trim()
  // Solana Pay: solana:<address>?amount=…
  const pay = s.match(/^solana:([1-9A-HJ-NP-Za-km-z]{32,44})/i)
  if (pay) return pay[1]
  if (isAddress(s)) return s
  // Solscan, Explorer, Birdeye, Jupiter links that carry an address in the path.
  const inPath = s.match(/(?:solscan\.io|explorer\.solana\.com|birdeye\.so|jup\.ag)\/(?:token|account|address|tokens|swap)?\/?(?:[^/]*-)?([1-9A-HJ-NP-Za-km-z]{32,44})/i)
  return inPath ? inPath[1] : null
}

async function accountKind(address: string): Promise<'mint' | 'wallet'> {
  const res = await fetch(MAINNET_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [address, { encoding: 'jsonParsed' }] }),
    signal: globalThis.AbortSignal.timeout(8_000),
  })
  const value = ((await res.json()) as { result?: { value?: { owner: string; data: { parsed?: { type?: string } } } } }).result?.value
  return value && TOKEN_PROGRAMS.has(value.owner) && value.data?.parsed?.type === 'mint' ? 'mint' : 'wallet'
}

/** `watched` is a wallet you watch: Blinks are simulated against its real balances. */
export async function inspect(input: string, watched: string | null = null): Promise<Inspection> {
  const text = input.trim()
  if (!text) return { kind: 'unknown', message: 'Paste or scan something first ☀️' }

  const address = extractAddress(text)
  if (address) {
    if ((await accountKind(address)) === 'mint') return { kind: 'token', ...(await lookupToken(address)) }
    return { kind: 'wallet', report: await walletReport(address) }
  }

  if (/^solana-action:/i.test(text) || ((/^https?:\/\//i.test(text) || /\./.test(text)) && (await looksLikeBlink(text)))) {
    const report = await checkBlink(text, watched, probeAccount()).catch(() => null)
    if (report) return { kind: 'blink', report }
  }

  if (/^https?:\/\//i.test(text) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(text)) {
    const link = checkLink(text)
    if ('error' in link) return { kind: 'unknown', message: link.error }
    return { kind: 'link', link }
  }

  // Anything short and word-like is treated as a token symbol or name.
  if (/^\$?[\w .-]{2,32}$/.test(text)) return { kind: 'token', ...(await lookupToken(text)) }
  return { kind: 'unknown', message: 'I couldn’t tell what that is. Try a wallet address, a token address or a link.' }
}
