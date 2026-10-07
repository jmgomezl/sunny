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
}

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
  for (const word of text.split(/\s+/)) {
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

/** Draws the story card and returns it as a JPEG. */
export async function drawCard(spec: ShareSpec): Promise<Blob> {
  await Promise.all([
    document.fonts.load('600 84px Fraunces'),
    document.fonts.load('800 40px Figtree'),
    document.fonts.load('500 42px Figtree'),
  ]).catch(() => {})
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')!

  // A warm morning sky, like Sunny's home.
  const sky = g.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, '#8FD0FF')
  sky.addColorStop(0.5, '#FFE6C2')
  sky.addColorStop(1, '#FFC690')
  g.fillStyle = sky
  g.fillRect(0, 0, W, H)
  cloud(g, 90, 300, 1.1)
  cloud(g, 760, 180, 0.8)
  cloud(g, 720, 1000, 0.9)

  // Sunny, in its rounded window.
  const avatar = await loadImage('/sunny-avatar.png')
  g.save()
  g.shadowColor = 'rgba(170, 96, 36, 0.35)'
  g.shadowBlur = 60
  g.shadowOffsetY = 24
  roundRect(g, 220, 200, 640, 640, 140)
  g.fillStyle = '#fff'
  g.fill()
  g.restore()
  g.save()
  roundRect(g, 220, 200, 640, 640, 140)
  g.clip()
  g.drawImage(avatar, 220, 200, 640, 640)
  g.restore()

  // The message card.
  const top = 940
  const cardH = 760
  g.save()
  g.shadowColor = 'rgba(120, 70, 30, 0.25)'
  g.shadowBlur = 50
  g.shadowOffsetY = 20
  roundRect(g, 70, top, W - 140, cardH, 64)
  g.fillStyle = '#FFFDF8'
  g.fill()
  g.restore()

  const tone = TONES[spec.tone]
  g.font = '800 36px Figtree'
  const kicker = spec.kicker.toUpperCase()
  const chipW = g.measureText(kicker).width + 64
  roundRect(g, 130, top + 70, chipW, 70, 35)
  g.fillStyle = tone.bg
  g.fill()
  g.fillStyle = tone.ink
  g.textBaseline = 'middle'
  g.fillText(kicker, 162, top + 106)

  g.textBaseline = 'alphabetic'
  g.fillStyle = INK
  g.font = '600 80px Fraunces'
  const titleLines = wrap(g, spec.title, W - 260, 3)
  titleLines.forEach((l, i) => g.fillText(l, 130, top + 250 + i * 92))

  g.fillStyle = SOFT
  g.font = '500 42px Figtree'
  const detailTop = top + 250 + titleLines.length * 92 + 20
  wrap(g, spec.detail, W - 260, 3).forEach((l, i) => g.fillText(l, 130, detailTop + i * 58))

  // On-chain moments get Solana's colors, and only those.
  if (spec.tone === 'sol') {
    const bar = g.createLinearGradient(130, 0, W - 130, 0)
    bar.addColorStop(0, '#9945FF')
    bar.addColorStop(0.55, '#43B4CA')
    bar.addColorStop(1, '#14F195')
    roundRect(g, 130, top + cardH - 70, W - 260, 12, 6)
    g.fillStyle = bar
    g.fill()
  }

  g.fillStyle = INK
  g.font = '800 46px Figtree'
  g.fillText('☀️ Sunny · your Solana guardian', 110, H - 150)
  g.fillStyle = FAINT
  g.font = '700 38px Figtree'
  g.fillText('t.me/SunnySolBot', 110, H - 92)

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
