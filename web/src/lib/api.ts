// Every request carries who's asking: Telegram's signed initData inside Telegram,
// otherwise a random guest id kept in this browser.

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

export function who() {
  const initData = window.Telegram?.WebApp?.initData
  return initData ? { initData } : { guestId: guestId() }
}

const FALLBACK_ERROR = 'My thoughts got cloudy for a second. Try me again? ☁️'

export async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, ...who() }),
    })
  } catch {
    throw new Error('I can’t reach my thoughts right now. Check your connection? ☁️')
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error || FALLBACK_ERROR)
  return data
}
