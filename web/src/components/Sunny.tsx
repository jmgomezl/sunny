import { useId, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'

export type Mood = 'happy' | 'excited' | 'sleepy' | 'worried' | 'hungry'

const INK = '#3A2114'
const BLUSH = '#FF7C8C'

// Soft "flame petal" rays, pointing up; rotated around the body.
const LONG_RAY = 'M -12 -56 C -15 -74 -7 -90 0 -98 C 7 -90 15 -74 12 -56 Z'
const SHORT_RAY = 'M -10 -56 C -12 -69 -6 -80 0 -86 C 6 -80 12 -69 10 -56 Z'
const SPARKLE = 'M0 -9 C1 -2.5 2.5 -1 9 0 C2.5 1 1 2.5 0 9 C-1 2.5 -2.5 1 -9 0 C-2.5 -1 -1 -2.5 0 -9 Z'

type SunnyProps = {
  mood: Mood
  size?: number
  onPoke?: () => void
}

export function Sunny({ mood, size = 220, onPoke }: SunnyProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const ref = (name: string) => `${uid}-${name}`
  const url = (name: string) => `url(#${ref(name)})`

  return (
    <motion.button
      type="button"
      className={`sunny sunny--${mood}`}
      style={{ width: size, height: size * 1.12 }}
      onClick={onPoke}
      whileTap={{ scaleX: 1.14, scaleY: 0.86 }}
      transition={{ type: 'spring', stiffness: 520, damping: 11 }}
      aria-label={`Sunny is feeling ${mood}. Tap to say hi.`}
    >
      <div className="sunny-bob">
        <svg viewBox="-120 -120 240 240" width={size} height={size} aria-hidden="true">
          <defs>
            <radialGradient id={ref('halo')}>
              <stop offset="0" stopColor="#FFE896" stopOpacity="0.95" />
              <stop offset="0.5" stopColor="#FFC650" stopOpacity="0.38" />
              <stop offset="1" stopColor="#FFB238" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={ref('body')} cx="36%" cy="30%" r="78%">
              <stop offset="0" stopColor="#FFF8D8" />
              <stop offset="0.3" stopColor="#FFE07A" />
              <stop offset="0.68" stopColor="#FFB940" />
              <stop offset="1" stopColor="#F3892C" />
            </radialGradient>
            <radialGradient id={ref('shade')} cx="34%" cy="26%" r="90%">
              <stop offset="0.6" stopColor="#B9470F" stopOpacity="0" />
              <stop offset="1" stopColor="#B9470F" stopOpacity="0.34" />
            </radialGradient>
            <linearGradient id={ref('ray')} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#FFAA35" />
              <stop offset="0.65" stopColor="#FFCB55" />
              <stop offset="1" stopColor="#FFE38A" />
            </linearGradient>
            <radialGradient id={ref('arm')} cx="40%" cy="35%" r="70%">
              <stop offset="0" stopColor="#FFD066" />
              <stop offset="1" stopColor="#F59A33" />
            </radialGradient>
            <linearGradient id={ref('drop')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#D8F1FF" />
              <stop offset="1" stopColor="#7FC4F2" />
            </linearGradient>
            <filter id={ref('blur-s')} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.4" />
            </filter>
            <filter id={ref('blur-m')} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4.5" />
            </filter>
            {/* Plush felt texture: fine noise, tinted warm, kept only inside the body. */}
            <filter id={ref('felt')} x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="1.25" numOctaves="2" seed="11" />
              <feColorMatrix
                type="matrix"
                values="0 0 0 0 0.62  0 0 0 0 0.32  0 0 0 0 0.08  0 0 0 1.1 -0.42"
              />
            </filter>
            <clipPath id={ref('body-clip')}>
              <circle r="62" />
            </clipPath>
          </defs>

          <circle className="sunny-halo" r="114" fill={url('halo')} />

          <g className="sunny-rays-breathe">
            <g className="sunny-rays">
              {Array.from({ length: 10 }, (_, i) => (
                <path
                  key={i}
                  d={i % 2 === 0 ? LONG_RAY : SHORT_RAY}
                  transform={`rotate(${i * 36})`}
                  fill={url('ray')}
                />
              ))}
            </g>
          </g>

          <g className="sunny-arm sunny-arm--l">
            <ellipse cx="-61" cy="26" rx="12" ry="8.5" transform="rotate(-28 -61 26)" fill={url('arm')} />
          </g>
          <g className="sunny-arm sunny-arm--r">
            <ellipse cx="61" cy="26" rx="12" ry="8.5" transform="rotate(28 61 26)" fill={url('arm')} />
          </g>

          <circle r="62" fill={url('body')} />
          <circle r="62" fill={url('shade')} />
          <rect
            x="-62"
            y="-62"
            width="124"
            height="124"
            clipPath={url('body-clip')}
            filter={url('felt')}
            opacity="0.5"
          />
          <ellipse
            cx="-25"
            cy="-33"
            rx="21"
            ry="11"
            transform="rotate(-32 -25 -33)"
            fill="#fff"
            opacity="0.62"
            filter={url('blur-s')}
          />

          <g className="sunny-cheeks" filter={url('blur-s')}>
            <ellipse cx="-33" cy="15" rx="11" ry="7" fill={BLUSH} />
            <ellipse cx="33" cy="15" rx="11" ry="7" fill={BLUSH} />
          </g>

          <AnimatePresence mode="wait" initial={false}>
            <motion.g
              key={mood}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.16 }}
              style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            >
              {FACES[mood](url)}
            </motion.g>
          </AnimatePresence>
        </svg>
      </div>
      <div className="sunny-shadow" />
    </motion.button>
  )
}

function OpenEye({ cx, cy = -4, look = 0, big = false }: { cx: number; cy?: number; look?: number; big?: boolean }) {
  const rx = big ? 9.5 : 8
  const ry = big ? 12 : 10.5
  return (
    <g className="sunny-eye">
      <ellipse cx={cx} cy={cy + look} rx={rx} ry={ry} fill={INK} />
      <circle cx={cx + 2.8} cy={cy - 4.2 + look} r={big ? 4.2 : 3.3} fill="#fff" />
      <circle cx={cx - 2.6} cy={cy + 4 + look} r={big ? 2 : 1.5} fill="#fff" opacity="0.85" />
    </g>
  )
}

const stroke = {
  stroke: INK,
  strokeWidth: 3.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
}

const FACES: Record<Mood, (url: (name: string) => string) => ReactNode> = {
  happy: () => (
    <>
      <OpenEye cx={-21} />
      <OpenEye cx={21} />
      <path d="M -10 15 Q 0 25.5 10 15" {...stroke} />
    </>
  ),
  excited: () => (
    <>
      <path d="M -29 -2 Q -21 -14 -13 -2" {...stroke} strokeWidth={4} />
      <path d="M 13 -2 Q 21 -14 29 -2" {...stroke} strokeWidth={4} />
      <path d="M -13 11 Q 0 34 13 11 Q 0 15 -13 11 Z" fill={INK} />
      <path d="M -6.5 22.5 Q 0 18.5 6.5 22.5 Q 0 28.5 -6.5 22.5 Z" fill="#FF8394" />
      <g className="sunny-sparkles" fill="#FFF3B8">
        <path d={SPARKLE} transform="translate(80 -74) scale(1.1)" />
        <path d={SPARKLE} transform="translate(-86 -46) scale(0.7)" />
        <path d={SPARKLE} transform="translate(88 30) scale(0.55)" />
      </g>
    </>
  ),
  sleepy: () => (
    <>
      <path d="M -29 -3 Q -21 4.5 -13 -3" {...stroke} />
      <path d="M 13 -3 Q 21 4.5 29 -3" {...stroke} />
      <ellipse cx="0" cy="18" rx="3.6" ry="3" fill={INK} opacity="0.85" />
      <g className="sunny-zzz" fill="#FFF6E0">
        <text x="58" y="-62" fontSize="20">z</text>
        <text x="72" y="-80" fontSize="14">z</text>
      </g>
    </>
  ),
  worried: (url) => (
    <>
      <path d="M -31 -19 L -13 -24" {...stroke} strokeWidth={3.2} />
      <path d="M 13 -24 L 31 -19" {...stroke} strokeWidth={3.2} />
      <OpenEye cx={-21} cy={-2} />
      <OpenEye cx={21} cy={-2} />
      <path d="M -10 20 Q -5 15.5 0 20 Q 5 24.5 10 20" {...stroke} strokeWidth={3.2} />
      <path
        className="sunny-drop"
        d="M 47 -38 C 47 -38 39 -27 39 -22 C 39 -17.5 42.6 -14 47 -14 C 51.4 -14 55 -17.5 55 -22 C 55 -27 47 -38 47 -38 Z"
        fill={url('drop')}
      />
    </>
  ),
  hungry: () => (
    <>
      <OpenEye cx={-21} cy={-3} look={-2.5} big />
      <OpenEye cx={21} cy={-3} look={-2.5} big />
      <path d="M -7 20 Q 0 15 7 20" {...stroke} strokeWidth={3.2} />
    </>
  ),
}
