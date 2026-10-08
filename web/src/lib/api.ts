// Every request carries who's asking: Telegram's signed initData inside Telegram, a wallet
// sign-in session outside it (Seeker, Android, desktop wallets), or else a random guest id.

let memoryGuestId: string | undefined

function guestId() {
  try {
    let id = localStorage.getItem('sunny.guest')
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem('sunny.guest', id)
    }
    return id
  } catch {
    return (memoryGuestId ??= crypto.randomUUID())
  }
}

/** True inside Telegram, where Sunny knows who you are and shares the bot chat. */
export const inTelegram = () => Boolean(window.Telegram?.WebApp?.initData)

/** Signed in with your own wallet, outside Telegram: the session and which wallet app signs. */
export type WalletSession = { session: string; address: string; wallet: string }

const SESSION_KEY = 'sunny.wallet'
let memorySession: WalletSession | null = null

export function walletSession(): WalletSession | null {
  if (inTelegram()) return null
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as WalletSession | null
    return s && typeof s.session === 'string' && typeof s.address === 'string' ? s : null
  } catch {
    return memorySession
  }
}

export function saveWalletSession(s: WalletSession | null) {
  memorySession = s
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // Private mode: the sign-in lasts until the app closes.
  }
}

/** Someone Sunny knows: a Telegram user, or a wallet that signed in. */
export const signedIn = () => inTelegram() || Boolean(walletSession())

export function who() {
  const initData = window.Telegram?.WebApp?.initData
  if (initData) return { initData }
  const s = walletSession()
  return s ? { walletSession: s.session } : { guestId: guestId() }
}

const FALLBACK_ERROR = 'My thoughts got cloudy for a second. Try me again? ☁️'

const send = (path: string, body: Record<string, unknown>) =>
  fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, ...who() }),
  })

export async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  let res: Response
  try {
    res = await send(path, body)
  } catch {
    // Coming back from a wallet app, Android's WebView can fail the very first request while
    // its network wakes up. That failure never reached the server, so one retry is safe.
    try {
      await new Promise((r) => setTimeout(r, 800))
      res = await send(path, body)
    } catch {
      throw new Error('I can’t reach my thoughts right now. Check your connection? ☁️')
    }
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  // An expired wallet sign-in: forget it, so the next step is connecting again.
  if (res.status === 401 && walletSession()) saveWalletSession(null)
  if (!res.ok) throw new Error(data.error || FALLBACK_ERROR)
  return data
}
