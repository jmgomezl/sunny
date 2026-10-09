// Sliding-window rate limits, shared by the Telegram chat and the Mini App so a
// person's allowance is the same wherever they talk to Sunny.
const windows = new Map<string, number[]>()

export const HOUR = 60 * 60 * 1000
export const DAY = 24 * HOUR

// No window is longer than a day: keys with nothing in the last day are dropped, so the map can't
// grow forever under a stream of fresh ids.
setInterval(() => {
  const cutoff = Date.now() - DAY
  for (const [key, times] of windows) if (!times.some((t) => t > cutoff)) windows.delete(key)
}, 10 * 60_000).unref()

/** How many hits `key` has within `windowMs`, without recording one. */
export function hits(key: string, windowMs: number) {
  const now = Date.now()
  return (windows.get(key) ?? []).filter((t) => now - t < windowMs).length
}

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
