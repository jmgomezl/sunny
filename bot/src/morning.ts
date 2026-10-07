import { buildHome } from './home.js'
import { latestNews } from './news.js'
import { hasChain, pocketState } from './solana.js'
import { markBriefSent, morningSubscribers, streakInfo, watchedOf } from './users.js'
import { vaultOf } from './vaults.js'

// Sunny's good-morning ritual: once a day, a short Telegram note with the wallets' weather,
// what's left in the pocket, one headline and one safety tip, plus the visit streak.
// A plain template, no AI: reliable, free, and in English or Spanish.

// 13:00–16:00 UTC is morning across the Americas (8am in Bogotá, Lima and New York in
// winter) and early afternoon in Europe. Someone who joins later gets theirs the next day.
const WINDOW_UTC = [13, 16]
const CHECK_EVERY_MS = 10 * 60_000

type Lang = 'en' | 'es'

const TIPS: Record<Lang, string>[] = [
  { en: 'Real airdrops never ask you to connect your wallet from a DM.', es: 'Los airdrops reales nunca te piden conectar tu wallet por mensaje privado.' },
  { en: 'Never share your seed phrase. No real support team will ever ask for it.', es: 'Nunca compartas tu frase semilla. Ningún soporte real te la va a pedir.' },
  { en: 'Before you sign, read what your wallet says you’ll send. More than you expected? Cancel.', es: 'Antes de firmar, lee lo que tu wallet dice que vas a enviar. ¿Más de lo esperado? Cancela.' },
  { en: 'Check the mint address, not just the name: copycat tokens use the same symbol.', es: 'Revisa la dirección del token, no solo el nombre: las copias usan el mismo símbolo.' },
  { en: 'Once a month, review your token approvals and revoke the ones you don’t recognise.', es: 'Una vez al mes, revisa los permisos de tus tokens y quita los que no reconozcas.' },
  { en: 'Bookmark the real sites you use. Search ads are a favourite spot for phishing.', es: 'Guarda en favoritos los sitios reales que usas. Los anuncios de búsqueda son un nido de phishing.' },
  { en: 'Keep most of your crypto in a wallet you never use to try new apps.', es: 'Guarda la mayor parte de tu cripto en una wallet que no uses para probar apps nuevas.' },
  { en: 'Urgent, guaranteed, limited time? That’s how almost every scam sounds.', es: '¿Urgente, garantizado, por tiempo limitado? Así suena casi toda estafa.' },
  { en: 'Look-alike sites swap one letter: raydlum.io is not raydium.io.', es: 'Los sitios falsos cambian una letra: raydlum.io no es raydium.io.' },
  { en: 'Copy addresses from your own history, never from a random transfer: that’s address poisoning.', es: 'Copia direcciones de tu propio historial, nunca de una transferencia rara: eso es address poisoning.' },
  { en: 'One wallet holding most of a token’s supply can crash its price in a second.', es: 'Si una sola wallet tiene casi todo un token, puede hundir su precio en un segundo.' },
  { en: 'Not sure about a link? Paste it in Scan & check before you connect anything.', es: '¿Dudas de un link? Pégalo en Scan & check antes de conectar nada.' },
  { en: 'You can freeze my pocket any time with the snowflake. Solana stops me instantly.', es: 'Puedes congelar mi bolsillo cuando quieras con el copo de nieve. Solana me frena al instante.' },
]

const FORECAST_ES: Record<string, string> = {
  'Mostly sunny': 'Mayormente soleado',
  'Golden hour': 'Hora dorada',
  'Storm warning': 'Alerta de tormenta',
  Cloudy: 'Nublado',
}
const MOOD_ES: Record<string, string> = {
  'Extreme Fear': 'miedo extremo',
  Fear: 'miedo',
  Neutral: 'neutral',
  Greed: 'codicia',
  'Extreme Greed': 'codicia extrema',
}

const usd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 0 : 2 })}`
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`

/** Today's note for one person. */
export async function briefFor(id: number, name: string | undefined, lang: string | undefined, day = new Date()) {
  const L: Lang = lang?.startsWith('es') ? 'es' : 'en'
  const t = (en: string, es: string) => (L === 'es' ? es : en)
  const wallets = watchedOf(id)
  const [home, pocket] = await Promise.all([
    buildHome(id, wallets).catch(() => null),
    (async () => {
      const owner = vaultOf(id)?.address
      return owner && hasChain() ? pocketState(owner).catch(() => null) : null
    })(),
  ])

  const { days, visitedToday } = streakInfo(id)
  const hello = t(`☀️ Good morning${name ? `, ${name}` : ''}!`, `☀️ ¡Buenos días${name ? `, ${name}` : ''}!`)
  const streakLine = visitedToday
    ? t(`Day ${days} of our sunny streak.`, `Día ${days} de nuestra racha soleada.`)
    : days >= 2
      ? t(`${days} sunny days in a row. Say hi today to keep it going!`, `${days} días soleados seguidos. ¡Salúdame hoy para seguir!`)
      : days === 1
        ? t('Say hi today and we start a sunny streak.', 'Salúdame hoy y empezamos una racha soleada.')
        : t('I missed you! Come say hi ☀️', '¡Te extrañé! Pasa a saludarme ☀️')

  const lines: string[] = []
  if (home && wallets.length && home.value !== null) {
    const change = home.change24h !== null ? ` (${signed(home.change24h)})` : ''
    lines.push(
      `🌤 ${t(wallets.length > 1 ? 'Your wallets' : 'Your wallet', wallets.length > 1 ? 'Tus wallets' : 'Tu wallet')}: ${t(home.forecast, FORECAST_ES[home.forecast] ?? home.forecast)} · ${usd(home.value)}${change}`,
    )
  } else if (home && home.value !== null) {
    const label = home.fearGreed?.label ?? ''
    const mood = home.fearGreed ? t(` · market mood ${label}`, ` · ánimo del mercado: ${MOOD_ES[label] ?? label}`) : ''
    lines.push(`🌤 ${t('Solana today', 'Solana hoy')}: SOL ${usd(home.value)}${home.change24h !== null ? ` (${signed(home.change24h)})` : ''}${mood}`)
  }
  if (pocket?.exists) {
    lines.push(
      pocket.frozen
        ? t('🪙 My pocket is frozen ❄', '🪙 Mi bolsillo está congelado ❄')
        : t(`🪙 My pocket: ${usd(pocket.leftToday)} left today of ${usd(pocket.dailyLimit)}`, `🪙 Mi bolsillo: me quedan ${usd(pocket.leftToday)} hoy de ${usd(pocket.dailyLimit)}`),
    )
  } else if (pocket) {
    lines.push(t('🪙 My pocket is empty. A small allowance lets me buy deep scans.', '🪙 Mi bolsillo está vacío. Una pequeña mesada me deja comprar escaneos profundos.'))
  }
  const story = latestNews('all', 1)[0]
  if (story) lines.push(`${story.kind === 'security' ? '🚨' : '📰'} ${story.title} (${story.source})`)
  const dayIndex = Math.floor(day.getTime() / 86_400_000)
  lines.push(`🛡 ${TIPS[dayIndex % TIPS.length][L]}`)

  const footer = t('/morning off skips these notes. News, not financial advice.', '/morning off desactiva estas notas. Noticias, no consejos financieros.')
  return `${hello} ${streakLine}\n\n${lines.join('\n')}\n\n${footer}`
}

/** Sends the morning note to everyone due, once a day, inside the morning window. */
export function startMorning(send: (id: number, text: string) => Promise<void>) {
  let running = false
  const tick = async () => {
    const now = new Date()
    const hour = now.getUTCHours()
    if (running || hour < WINDOW_UTC[0] || hour >= WINDOW_UTC[1]) return
    running = true
    const day = now.toISOString().slice(0, 10)
    try {
      const due = morningSubscribers(day)
      if (due.length) console.log(`[sunny] morning notes for ${due.length} people`)
      for (const p of due) {
        // Marked first, so a failure never turns into a second note the same day.
        markBriefSent(p.id, day)
        await send(p.id, await briefFor(p.id, p.name, p.lang, now)).catch((err) => console.warn('[sunny] morning note failed', p.id, String(err)))
        await new Promise((r) => setTimeout(r, 150))
      }
    } finally {
      running = false
    }
  }
  void tick()
  setInterval(() => void tick(), CHECK_EVERY_MS).unref()
}
