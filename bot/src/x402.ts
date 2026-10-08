import { createHmac } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Keypair, PublicKey } from '@solana/web3.js'
import { createKeyPairSignerFromBytes } from '@solana/kit'
import { x402Client } from '@x402/core/client'
import { x402Facilitator } from '@x402/core/facilitator'
import {
  decodePaymentResponseHeader,
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from '@x402/core/http'
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from '@x402/core/types'
import { wrapFetchWithPayment } from '@x402/fetch'
import { SOLANA_DEVNET_CAIP2, toFacilitatorSvmSigner } from '@x402/svm'
import { registerExactSvmScheme as registerClientScheme } from '@x402/svm/exact/client'
import { registerExactSvmScheme as registerFacilitatorScheme } from '@x402/svm/exact/facilitator'
import { deepReport, type DeepReport } from './deepscan.js'
import { accountKind } from './inspect.js'
import { agentDraw, agentFor, ensureAta, explorerTx, feePayer, isSolanaAddress, refundToPocket, USD, usdcMint } from './solana.js'

// Sunny's deep scan is a real x402 API (protocol v2, "exact" scheme on Solana devnet).
// Ask without paying and you get 402 Payment Required with the price; pay by sending a
// partially signed USDC transfer in the PAYMENT-SIGNATURE header. This server verifies it,
// runs the scan, then settles on-chain as the facilitator, with Sunny's fee wallet as the
// sponsor, so payers need no SOL. Sunny itself is one of the clients: it pays out of the
// pocket money you give it, so the Solana program's limits apply to every scan.

export const DEEP_SCAN_PRICE = 0.1
export const DEEP_SCAN_PATH = '/api/x402/deep-scan'
const NETWORK = SOLANA_DEVNET_CAIP2
const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
// The most Sunny's x402 client will ever pay for a single request, whatever a server asks.
const MAX_PER_PAYMENT_USD = 0.5
const PUBLIC_URL = process.env.MINI_APP_URL || 'https://sunny.aivylabs.xyz'
const SELF = `http://127.0.0.1:${process.env.SUNNY_API_PORT || 8820}`

// Scan fees go to the scan service's treasury, derived from the server seed like the agent keys.
let treasuryKey: Keypair | undefined
export const treasury = () =>
  (treasuryKey ??= Keypair.fromSeed(
    createHmac('sha256', process.env.SUNNY_AGENT_SEED!).update('sunny-scan-treasury').digest(),
  ))
let treasuryReady: Promise<void> | undefined

const atomic = (usd: number) => String(Math.round(usd * USD))

function requirements(): PaymentRequirements {
  return {
    scheme: 'exact',
    network: NETWORK,
    asset: usdcMint().toBase58(),
    amount: atomic(DEEP_SCAN_PRICE),
    payTo: treasury().publicKey.toBase58(),
    maxTimeoutSeconds: 60,
    extra: { feePayer: feePayer().publicKey.toBase58() },
  }
}

let facilitator: Promise<x402Facilitator> | undefined
const getFacilitator = () =>
  (facilitator ??= createKeyPairSignerFromBytes(feePayer().secretKey).then((sponsor) => {
    const f = new x402Facilitator()
    registerFacilitatorScheme(f, { signer: toFacilitatorSvmSigner(sponsor, { defaultRpcUrl: RPC }), networks: NETWORK })
    return f
  }))

const EXPOSE = 'PAYMENT-REQUIRED, PAYMENT-RESPONSE'

function reply(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': EXPOSE,
    ...headers,
  })
  res.end(JSON.stringify(body))
}

/** CORS preflight, so browser clients on other sites can pay too. */
export function deepScanPreflight(res: ServerResponse) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'PAYMENT-SIGNATURE, Content-Type',
    'Access-Control-Expose-Headers': EXPOSE,
    'Access-Control-Max-Age': '86400',
  })
  res.end()
}

/** GET /api/x402/deep-scan?mint=… — 402 with the price, or the report once paid. */
export async function deepScanRoute(req: IncomingMessage, res: ServerResponse) {
  const mint = new URL(req.url ?? '/', 'http://localhost').searchParams.get('mint') ?? ''
  if (!isSolanaAddress(mint)) return reply(res, 400, { error: 'Add ?mint=<token mint address>' })
  // Only tokens get a price quote: a wallet address has nothing to scan.
  if ((await accountKind(mint).catch(() => 'mint')) !== 'mint') {
    return reply(res, 400, { error: 'That address is a wallet, not a token mint.' })
  }
  treasuryReady ??= ensureAta(treasury().publicKey).catch((err) => {
    treasuryReady = undefined
    throw err
  })
  await treasuryReady

  const accepts = requirements()
  const header = req.headers['payment-signature']
  if (typeof header !== 'string') {
    const required: PaymentRequired = {
      x402Version: 2,
      error: 'Payment required',
      resource: {
        url: `${PUBLIC_URL}${DEEP_SCAN_PATH}?mint=${mint}`,
        description: 'Sunny deep scan: top holders and insiders, creator stake, authorities, LP lock and every RugCheck risk',
        mimeType: 'application/json',
      },
      accepts: [accepts],
    }
    return reply(res, 402, required, { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(required) })
  }

  let payload: PaymentPayload
  try {
    payload = decodePaymentSignatureHeader(header)
  } catch {
    return reply(res, 400, { error: 'The PAYMENT-SIGNATURE header isn’t a valid x402 payment.' })
  }
  const f = await getFacilitator()
  // A payload that decodes but is missing parts makes the SDK throw: that's a bad request.
  const verified = await f.verify(payload, accepts).catch(() => null)
  if (!verified) return reply(res, 400, { error: 'The PAYMENT-SIGNATURE header isn’t a complete x402 payment.' })
  if (!verified.isValid) {
    return reply(res, 402, { error: verified.invalidMessage ?? verified.invalidReason ?? 'Payment rejected' })
  }
  // Scan first and settle after, so a failed scan never charges anyone.
  const report = await deepReport(mint)
  if (!report) return reply(res, 502, { error: 'I couldn’t scan that token right now. You weren’t charged.' })
  const settled = await f.settle(payload, accepts).catch((err) => {
    console.error('[sunny] x402 settle failed', err)
    return { success: false as const, errorMessage: 'The payment didn’t settle.', errorReason: undefined }
  })
  if (!settled.success) {
    return reply(res, 402, { error: settled.errorMessage ?? settled.errorReason ?? 'The payment didn’t settle.' })
  }
  console.log(`[sunny] x402 deep scan of ${mint} paid by ${settled.payer}: ${settled.transaction}`)
  reply(res, 200, report, { 'PAYMENT-RESPONSE': encodePaymentResponseHeader(settled) })
}

export type PaidScan = { report: DeepReport; price: number; drawTx: string; paymentTx: string }

/**
 * Sunny buys a deep scan with an owner's pocket money: it draws the price from the pocket
 * (the program checks the limits and the freeze), then pays the scan API over x402 from
 * its own wallet. A refused draw throws the program's reason.
 */
export async function sunnyBuysDeepScan(ownerAddress: string, mint: string): Promise<PaidScan> {
  const drawn = await agentDraw(ownerAddress, DEEP_SCAN_PRICE)
  const agent = agentFor(new PublicKey(ownerAddress))
  const client = new x402Client().setSpendControls({
    allowedAssets: [{ network: NETWORK, asset: usdcMint().toBase58(), maxAmountPerPayment: atomic(MAX_PER_PAYMENT_USD) }],
  })
  registerClientScheme(client, { signer: await createKeyPairSignerFromBytes(agent.secretKey), networks: [NETWORK] })
  // The money left the pocket, so if the scan doesn't come back it goes straight back in.
  const refund = async (why: string): Promise<never> => {
    const back = await refundToPocket(ownerAddress, DEEP_SCAN_PRICE).catch(() => null)
    throw Object.assign(
      new Error(
        back
          ? `The scan service failed (${why}), so I put the $${DEEP_SCAN_PRICE.toFixed(2)} back in your pocket.`
          : `The scan service failed (${why}). The $${DEEP_SCAN_PRICE.toFixed(2)} is safe in my wallet; I’ll put it back.`,
      ),
      { refunded: back?.explorer ?? null, drawTx: drawn.explorer },
    )
  }
  const res = await wrapFetchWithPayment(fetch, client)(`${SELF}${DEEP_SCAN_PATH}?mint=${mint}`).catch((err: unknown) =>
    refund(err instanceof Error ? err.message.slice(0, 80) : 'no answer'),
  )
  if (!res.ok) {
    const why = ((await res.json().catch(() => ({}))) as { error?: string }).error
    // Paid but not delivered can't be undone here; unpaid failures refund.
    if (!res.headers.get('payment-response')) await refund(why ?? String(res.status))
    throw new Error(`The scan service said no (${why ?? res.status}).`)
  }
  const receipt = decodePaymentResponseHeader(res.headers.get('payment-response') ?? '')
  return {
    report: (await res.json()) as DeepReport,
    price: DEEP_SCAN_PRICE,
    drawTx: drawn.explorer,
    paymentTx: explorerTx(receipt.transaction),
  }
}
