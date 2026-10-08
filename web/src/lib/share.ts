import { inTelegram, post } from './api'

// Share cards: when Sunny catches a scam, Solana stops a draw or a deep scan comes back,
// you can share the moment. The card is drawn here as a 1080×1920 story with Sunny's own
// fonts, then posted to your Telegram Story (which needs a public link, so it's uploaded
// first) or sent to a chat. Outside Telegram it uses the system share sheet.

export const BOT_LINK = 'https://t.me/SunnySolBot'

export type ShareSpec = {
  /** Small label above the headline, e.g. "Scam caught". */
  kicker: string
  title: string
  detail: string
  /** warn for scams, sol for on-chain moments, ok for good news. */
  tone: 'warn' | 'sol' | 'ok'
  /** The text that goes with the story or the chat message. */
  caption: string
  /** Sunny's pose for the moment: alarmed with its shield, shivering at a "no", munching… */
  pose?: Pose
  /** An explorer link to the transaction behind the moment, shown as a small proof chip. */
  proof?: string
}

/** Poses captured from the real character (StickerStage with &bare) into /poses. */
export type Pose = 'gm' | 'scam' | 'thanks' | 'frozen' | 'dyor' | 'yum' | 'love'

const W = 1080
const H = 1920
const INK = '#3A2114'
const SOFT = '#7A5A47'
const FAINT = '#A88B76'
const TONES = {
  warn: { ink: '#C4472A', bg: '#FFE3DA' },
  ok: { ink: '#2F8F5B', bg: '#DDF3E5' },
  sol: { ink: '#6B3FD1', bg: '#EFE6FF' },
}
const SOLANA = ['#9945FF', '#43B4CA', '#14F195']

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

function cloud(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.fillStyle = 'rgba(255, 255, 255, 0.85)'
  for (const [dx, dy, r] of [
    [0, 0, 70],
    [70, -30, 90],
    [160, 0, 70],
    [80, 25, 70],
  ]) {
    g.beginPath()
    g.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2)
    g.fill()
  }
}

/** Splits text into lines that fit `width`, keeping at most `max` lines (the last one gets "…"). */
function wrap(g: CanvasRenderingContext2D, text: string, width: number, max: number) {
  const lines: string[] = []
  let line = ''
  // A word wider than the line (a long phishing domain) is split, so it never runs off the card.
  const words = text.split(/\s+/).flatMap((word) => {
    if (g.measureText(word).width <= width) return [word]
    const parts: string[] = []
    let part = ''
    for (const ch of word) {
      if (part && g.measureText(part + ch).width > width) {
        parts.push(part)
        part = ''
      }
      part += ch
    }
    return part ? [...parts, part] : parts
  })
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (g.measureText(next).width <= width) line = next
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  if (lines.length > max) {
    lines.length = max
    lines[max - 1] = `${lines[max - 1].replace(/\s+\S*$/, '')}…`
  }
  return lines
}

const solanaGradient = (g: CanvasRenderingContext2D, x0: number, x1: number) => {
  const grad = g.createLinearGradient(x0, 0, x1, 0)
  SOLANA.forEach((c, i) => grad.addColorStop(i / (SOLANA.length - 1), c))
  return grad
}

/** The short id of a transaction from its explorer link: 5Ge1…Avw. */
const shortTx = (link: string) => {
  const sig = link.split('/').pop()?.split('?')[0] ?? ''
  return sig.length > 12 ? `${sig.slice(0, 4)}…${sig.slice(-4)}` : sig
}

// Card geometry: Sunny stands on the card, its feet just over the top edge.
const POSE = 880
// Where Sunny's feet are in the pose image: the card's top edge goes just above them.
const POSE_FEET = 612
const CARD_X = 70
const CARD_W = W - 140
const PAD = 70
const TEXT_W = CARD_W - PAD * 2
const TITLE_LH = 90
const DETAIL_LH = 58
const PROOF_H = 76

/** Draws the story card and returns it as a JPEG. */
export async function drawCard(spec: ShareSpec): Promise<Blob> {
  await Promise.all([
    document.fonts.load('600 78px Fraunces'),
    document.fonts.load('800 36px Figtree'),
    document.fonts.load('500 42px Figtree'),
  ]).catch(() => {})
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')!

  // Measure first, so the card is exactly as tall as what it says.
  g.font = '600 78px Fraunces'
  const titleLines = wrap(g, spec.title, TEXT_W, 3)
  g.font = '500 42px Figtree'
  const detailLines = wrap(g, spec.detail, TEXT_W, 3)
  const cardH = PAD + 64 + 48 + titleLines.length * TITLE_LH + 8 + detailLines.length * DETAIL_LH + (spec.proof ? 44 + PROOF_H : 0) + PAD - 10
  const block = POSE_FEET + cardH + 70 + 110
  // Centred between Telegram's story header and reply bar.
  const top = Math.max(150, Math.round((H - block) / 2) - 10)
  const cardY = top + POSE_FEET

  // A warm morning sky, like Sunny's home.
  const sky = g.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, '#8FD0FF')
  sky.addColorStop(0.5, '#FFE6C2')
  sky.addColorStop(1, '#FFC690')
  g.fillStyle = sky
  g.fillRect(0, 0, W, H)
  cloud(g, 60, top + 120, 1.1)
  cloud(g, 780, top + 40, 0.8)
  cloud(g, 760, cardY + cardH - 40, 0.9)

  // Sunlight behind Sunny.
  const glow = g.createRadialGradient(W / 2, top + 400, 40, W / 2, top + 400, 480)
  glow.addColorStop(0, 'rgba(255, 238, 170, 0.85)')
  glow.addColorStop(1, 'rgba(255, 238, 170, 0)')
  g.fillStyle = glow
  g.fillRect(0, top - 100, W, 1000)

  // The message card.
  g.save()
  g.shadowColor = 'rgba(120, 70, 30, 0.25)'
  g.shadowBlur = 50
  g.shadowOffsetY = 20
  roundRect(g, CARD_X, cardY, CARD_W, cardH, 64)
  g.fillStyle = '#FFFDF8'
  g.fill()
  g.restore()

  // Sunny in the pose that matches the moment, standing on the card.
  const pose = await loadImage(`/poses/${spec.pose ?? 'gm'}.webp`).catch(() => loadImage('/sunny-avatar.png'))
  g.drawImage(pose, (W - POSE) / 2, top, POSE, POSE)

  const tone = TONES[spec.tone]
  let y = cardY + PAD
  g.font = '800 36px Figtree'
  const kicker = spec.kicker.toUpperCase()
  const chipW = g.measureText(kicker).width + 64
  roundRect(g, CARD_X + PAD, y, chipW, 64, 32)
  g.fillStyle = tone.bg
  g.fill()
  g.fillStyle = tone.ink
  g.textBaseline = 'middle'
  g.fillText(kicker, CARD_X + PAD + 32, y + 33)
  y += 64 + 48

  g.textBaseline = 'alphabetic'
  g.fillStyle = INK
  g.font = '600 78px Fraunces'
  titleLines.forEach((l, i) => g.fillText(l, CARD_X + PAD, y + 62 + i * TITLE_LH))
  y += titleLines.length * TITLE_LH + 8

  g.fillStyle = SOFT
  g.font = '500 42px Figtree'
  detailLines.forEach((l, i) => g.fillText(l, CARD_X + PAD, y + 40 + i * DETAIL_LH))
  y += detailLines.length * DETAIL_LH

  // Proof on Solana: the transaction behind the moment, in Solana's colors (on-chain only).
  if (spec.proof) {
    y += 44
    g.font = '800 34px Figtree'
    const label = `Proof on Solana · ${shortTx(spec.proof)}`
    const w = g.measureText(label).width + 64 + 58
    const x = CARD_X + PAD
    roundRect(g, x, y, w, PROOF_H, PROOF_H / 2)
    g.save()
    g.globalAlpha = 0.13
    g.fillStyle = solanaGradient(g, x, x + w)
    g.fill()
    g.restore()
    g.lineWidth = 3
    g.strokeStyle = solanaGradient(g, x, x + w)
    g.stroke()
    // Solana's three bars.
    g.fillStyle = solanaGradient(g, x + 30, x + 66)
    for (let i = 0; i < 3; i++) {
      const by = y + 22 + i * 12
      const lean = i === 1 ? -6 : 6
      g.beginPath()
      g.moveTo(x + 30 + (lean > 0 ? 0 : 6), by + 8)
      g.lineTo(x + 30 + 30 + (lean > 0 ? 0 : 6), by + 8)
      g.lineTo(x + 30 + 30 + (lean > 0 ? 6 : 0), by)
      g.lineTo(x + 30 + (lean > 0 ? 6 : 0), by)
      g.closePath()
      g.fill()
    }
    g.fillStyle = INK
    g.textBaseline = 'middle'
    g.fillText(label, x + 82, y + PROOF_H / 2 + 2)
    g.textBaseline = 'alphabetic'
  } else if (spec.tone === 'sol') {
    // An on-chain moment without a transaction (Solana refusing one) keeps the Solana line.
    roundRect(g, CARD_X + PAD, cardY + cardH - 46, TEXT_W, 12, 6)
    g.fillStyle = solanaGradient(g, CARD_X + PAD, CARD_X + PAD + TEXT_W)
    g.fill()
  }

  const foot = cardY + cardH + 70
  g.fillStyle = INK
  g.font = '800 46px Figtree'
  g.fillText('☀️ Sunny · your Solana guardian', 110, foot + 46)
  g.fillStyle = FAINT
  g.font = '700 38px Figtree'
  g.fillText('t.me/SunnySolBot', 110, foot + 102)

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t draw the card'))), 'image/jpeg', 0.88),
  )
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = reject
    r.readAsDataURL(blob)
  })

const telegram = () => window.Telegram?.WebApp

/** True when this Telegram can post to Stories (Bot API 7.8 and later). */
export const canShareStory = () =>
  inTelegram() && typeof telegram()?.shareToStory === 'function' && Boolean(telegram()?.isVersionAtLeast?.('7.8'))

/** Draws the card and posts it as a Telegram Story, or uses the system share sheet outside Telegram. */
export async function shareStory(spec: ShareSpec) {
  const blob = await drawCard(spec)
  if (canShareStory()) {
    const { url } = await post<{ url: string }>('/api/share', { image: await toBase64(blob) })
    // Stories allow 200 characters of text for most people.
    telegram()!.shareToStory!(url, { text: `${spec.caption} ${BOT_LINK}`.slice(0, 200) })
    return
  }
  const file = new File([blob], 'sunny.jpg', { type: 'image/jpeg' })
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], text: `${spec.caption} ${BOT_LINK}` }).catch(() => {})
    return
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'sunny.jpg'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

/** Opens Telegram's "share to a chat" with the caption and Sunny's link. */
export function sendToChat(spec: ShareSpec) {
  const link = `https://t.me/share/url?url=${encodeURIComponent(BOT_LINK)}&text=${encodeURIComponent(spec.caption)}`
  const open = telegram()?.openTelegramLink
  if (inTelegram() && open) open(link)
  else window.open(link, '_blank', 'noopener')
}
