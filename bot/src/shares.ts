import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Share cards: the Mini App draws a story-sized image ("Sunny caught a phishing link")
// and uploads it here, because Telegram's shareToStory needs a public link to the image.
// Cards are plain JPEGs with nothing private on them, kept for a week.

const DIR = join(process.env.SUNNY_DATA_DIR || join(process.cwd(), 'data'), 'shares')
const KEEP_MS = 7 * 86_400_000
export const MAX_SHARE_BYTES = 900_000
const ID = /^[a-f0-9]{32}$/

/** Saves a card and returns its id, or null if it isn't a reasonable JPEG. */
export function saveShare(image: Buffer): string | null {
  const jpeg = image.length > 1_000 && image.length <= MAX_SHARE_BYTES && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff
  if (!jpeg) return null
  const id = randomUUID().replace(/-/g, '')
  mkdirSync(DIR, { recursive: true })
  writeFileSync(join(DIR, `${id}.jpg`), image)
  return id
}

export function readShare(id: string): Buffer | null {
  if (!ID.test(id)) return null
  try {
    return readFileSync(join(DIR, `${id}.jpg`))
  } catch {
    return null
  }
}

/** Deletes cards older than a week, now and once a day. */
export function startShareCleanup() {
  const clean = () => {
    try {
      for (const f of readdirSync(DIR)) {
        const path = join(DIR, f)
        if (Date.now() - statSync(path).mtimeMs > KEEP_MS) unlinkSync(path)
      }
    } catch {
      // No cards yet.
    }
  }
  clean()
  setInterval(clean, 86_400_000).unref()
}
