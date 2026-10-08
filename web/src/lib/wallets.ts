import { getWallets } from '@wallet-standard/app'
import type { Wallet, WalletAccount } from '@wallet-standard/base'
import {
  StandardConnect,
  StandardDisconnect,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
} from '@wallet-standard/features'
import {
  SolanaSignMessage,
  SolanaSignTransaction,
  type SolanaSignMessageFeature,
  type SolanaSignTransactionFeature,
} from '@solana/wallet-standard-features'
import {
  createDefaultAuthorizationCache,
  createDefaultChainSelector,
  createDefaultWalletNotFoundHandler,
  registerMwa,
} from '@solana-mobile/wallet-standard-mobile'
import { base58, base64 } from '@scure/base'
import { post, saveWalletSession, walletSession } from './api'

// Your own wallet, outside Telegram. On a Seeker (Seed Vault) or any Android phone it's Mobile
// Wallet Adapter; on a computer, extensions like Phantom or Solflare. All of them speak Wallet
// Standard, so one path signs Sunny in and signs pocket transactions. Loaded only when needed.

const CHAIN = 'solana:devnet'
let registered = false

/** Registers Mobile Wallet Adapter once: it only appears in Android Chrome or an installed app. */
function setup() {
  if (registered) return
  registered = true
  registerMwa({
    appIdentity: { name: 'Sunny', uri: window.location.origin, icon: 'icon-192.png' },
    authorizationCache: createDefaultAuthorizationCache(),
    chains: [CHAIN],
    chainSelector: createDefaultChainSelector(),
    onWalletNotFound: createDefaultWalletNotFoundHandler(),
  })
}

const usable = (w: Wallet) =>
  StandardConnect in w.features && SolanaSignMessage in w.features && SolanaSignTransaction in w.features

/** Wallets this browser can use, Mobile Wallet Adapter first (on a Seeker it's Seed Vault). */
export function availableWallets(): Wallet[] {
  setup()
  return getWallets()
    .get()
    .filter(usable)
    .sort((a, b) => Number(isMobileAdapter(b)) - Number(isMobileAdapter(a)))
}

export const isMobileAdapter = (w: Wallet) => /mobile wallet adapter/i.test(w.name)

/** Calls back when a wallet appears or goes (extensions register a moment after load). */
export function onWalletsChanged(callback: () => void) {
  setup()
  const wallets = getWallets()
  const off = [wallets.on('register', callback), wallets.on('unregister', callback)]
  return () => off.forEach((f) => f())
}

const connectOf = (w: Wallet) => (w.features as StandardConnectFeature)[StandardConnect]

// Leaving the wallet app without answering never settles Mobile Wallet Adapter's request, and the
// library can't start another one after that. So: give up a few seconds after Sunny is back on
// screen, and start the next attempt from a fresh page.
const CLOSED = 'Your wallet closed without answering. Tap again when you’re ready.'
const STUCK_KEY = 'sunny.walletStuck'

function walletCall<T>(run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let left = false
    let timer = 0
    const away = () => {
      left = true
      clearTimeout(timer)
    }
    const back = () => {
      if (!left || document.visibilityState !== 'visible') return
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        done()
        try {
          sessionStorage.setItem(STUCK_KEY, '1')
        } catch {
          // Without storage the next tap may hang again; a reload still fixes it.
        }
        reject(new Error(CLOSED))
      }, 6000)
    }
    const onVisibility = () => (document.visibilityState === 'hidden' ? away() : back())
    const done = () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', away)
      window.removeEventListener('focus', back)
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', away)
    window.addEventListener('focus', back)
    run().then(
      (v) => {
        done()
        resolve(v)
      },
      (err: unknown) => {
        done()
        reject(new Error(friendly(err)))
      },
    )
  })
}

/** After a wallet left without answering, the next attempt reloads first (and reopens the sheet). */
export function needsFreshStart() {
  try {
    return sessionStorage.getItem(STUCK_KEY) === '1'
  } catch {
    return false
  }
}
export function freshStart() {
  try {
    sessionStorage.removeItem(STUCK_KEY)
    sessionStorage.setItem('sunny.reopenWallet', '1')
  } catch {
    // Fine: the page still reloads.
  }
  window.location.reload()
}

/** Wallet errors, in Sunny's words instead of the wallet library's. */
function friendly(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  if (text === CLOSED) return CLOSED
  if (/declin|reject|cancel|denied|authorization request failed|not signed|user/i.test(text)) {
    return 'No problem, you said no. Tap again whenever you’re ready.'
  }
  if (/cluster|chain/i.test(text)) {
    return 'Your wallet isn’t on devnet. Switch it to devnet (in Phantom: Settings → Developer Settings → Testnet mode), then try again.'
  }
  if (/auth_?token|not valid/i.test(text)) return 'Your wallet’s session ended. Tap again to reconnect.'
  if (/payload|exceeds|implementation limit/i.test(text)) return 'Your wallet couldn’t read this request. Try again, or use another wallet.'
  if (/changed the transaction|isn’t for your wallet|doesn’t look right|Switch your wallet/i.test(text)) return text
  return 'Your wallet had a problem. Try again in a moment.'
}

/** After the wallet app hands back, wait until Sunny is on screen again before going online. */
async function backInFront() {
  if (document.visibilityState !== 'visible') {
    await new Promise<void>((resolve) => {
      const done = () =>
        document.visibilityState === 'visible' && (document.removeEventListener('visibilitychange', done), resolve())
      document.addEventListener('visibilitychange', done)
      setTimeout(resolve, 5000)
    })
  }
  await new Promise((r) => setTimeout(r, 300))
}

/** Connects, signs Sunny's one-time sign-in message, and keeps the session. */
export async function signIn(wallet: Wallet) {
  if (needsFreshStart()) freshStart()
  const { accounts } = await walletCall(() => connectOf(wallet).connect())
  const account = accounts[0]
  if (!account) throw new Error('Your wallet didn’t connect. Tap again to retry.')
  await backInFront()
  const { message } = await post<{ message: string }>('/api/auth', { op: 'challenge', address: account.address }, { retry: true })
  const [signed] = await walletCall(() =>
    (wallet.features as SolanaSignMessageFeature)[SolanaSignMessage].signMessage({
      account,
      message: new TextEncoder().encode(message),
    }),
  )
  await backInFront()
  const { session, address } = await post<{ session: string; address: string }>('/api/auth', {
    op: 'verify',
    message,
    signature: base58.encode(signed.signature),
  })
  saveWalletSession({ session, address, wallet: wallet.name })
  return address
}

export async function signOut() {
  const s = walletSession()
  saveWalletSession(null)
  const wallet = s && availableWallets().find((w) => w.name === s.wallet)
  await (wallet?.features as Partial<StandardDisconnectFeature> | undefined)?.[StandardDisconnect]?.disconnect().catch(
    () => {},
  )
}

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`

/** The signed-in account, reconnecting quietly first and asking only if it has to. */
async function accountFor(wallet: Wallet, address: string): Promise<WalletAccount> {
  const find = (list: readonly WalletAccount[]) => list.find((a) => a.address === address)
  let account = find(wallet.accounts)
  if (!account)
    account = find(
      (
        await connectOf(wallet)
          .connect({ silent: true })
          .catch(() => ({ accounts: [] }))
      ).accounts,
    )
  if (!account) account = find((await walletCall(() => connectOf(wallet).connect())).accounts)
  if (!account) throw new Error(`Switch your wallet to ${short(address)}, the one you signed in with.`)
  return account
}

// Solana's compact length prefix (1–3 bytes).
function readLength(bytes: Uint8Array, at: number): [number, number] {
  let value = 0
  for (let i = 0; i < 3; i++) {
    const b = bytes[at + i]
    value |= (b & 0x7f) << (7 * i)
    if (!(b & 0x80)) return [value, at + i + 1]
  }
  throw new Error('That transaction doesn’t look right.')
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * Has the wallet sign a pocket transaction Sunny prepared (and this phone already decoded into
 * plain words), and returns just the owner's signature. If the wallet changed the transaction
 * at all, nothing is sent: the server only accepts a signature over the exact message.
 */
export async function signPocketTransaction(messageBase64: string): Promise<string> {
  const s = walletSession()
  if (!s) throw new Error('Connect your wallet first.')
  if (needsFreshStart()) freshStart()
  const wallet = availableWallets().find((w) => w.name === s.wallet)
  if (!wallet) throw new Error(`I can’t find ${s.wallet} in this browser. Open me where you connected it.`)
  const account = await accountFor(wallet, s.address)

  const message = base64.decode(messageBase64)
  // A legacy message starts with how many signatures it needs; the wire format is that many
  // empty signature slots, then the message.
  const needed = message[0]
  if (needed === undefined || needed & 0x80 || needed > 3) throw new Error('That transaction doesn’t look right.')
  const unsigned = new Uint8Array(1 + 64 * needed + message.length)
  unsigned[0] = needed
  unsigned.set(message, 1 + 64 * needed)

  const [out] = await walletCall(() =>
    (wallet.features as SolanaSignTransactionFeature)[SolanaSignTransaction].signTransaction({
      account,
      transaction: unsigned,
      chain: CHAIN,
    }),
  )
  await backInFront()
  const signed = out.signedTransaction
  const [count, at] = readLength(signed, 0)
  if (!sameBytes(signed.slice(at + 64 * count), message)) {
    throw new Error('Your wallet changed the transaction, so I didn’t send it. Try again, or use another wallet.')
  }
  // The owner's slot is their position among the message's signing keys.
  const [keys, keysAt] = readLength(message, 3)
  const owner = base58.decode(s.address)
  const slot = Array.from({ length: Math.min(keys, needed) }, (_, i) => i).find((i) =>
    sameBytes(message.slice(keysAt + 32 * i, keysAt + 32 * (i + 1)), owner),
  )
  if (slot === undefined) throw new Error('This transaction isn’t for your wallet.')
  return base64.encode(signed.slice(at + 64 * slot, at + 64 * (slot + 1)))
}
