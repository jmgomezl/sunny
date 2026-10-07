// Sliding-window rate limits, shared by the Telegram chat and the Mini App so a
// person's allowance is the same wherever they talk to Sunny.
const windows = new Map<string, number[]>()

export const HOUR = 60 * 60 * 1000
export const DAY = 24 * HOUR

/** Records a hit for `key` and returns false once `max` hits fall within `windowMs`. */
export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const recent = (windows.get(key) ?? []).filter((t) => now - t < windowMs)
  if (recent.length >= max) {
    windows.set(key, recent)
    return false
  }
  recent.push(now)
  windows.set(key, recent)
  return true
}
