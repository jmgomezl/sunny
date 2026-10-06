import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { motion, useAnimate } from 'motion/react'

export type Mood = 'happy' | 'excited' | 'sleepy' | 'worried' | 'hungry'
/** Short-lived expressions that play over the current mood. */
export type Reaction = 'giggle' | 'love' | 'dizzy' | 'spin' | 'shiver' | 'yum' | 'scan' | 'pat' | 'blush' | 'boop'
/** Where and how Sunny was touched. */
export type Gesture = 'boop' | 'head' | 'cheek' | 'ray' | 'double' | 'pet' | 'dizzy'

const INK = '#3A2114'
const BLUSH = '#FF7C8C'

// Soft "flame petal" rays, pointing up; rotated around the body.
const LONG_RAY = 'M -12 -56 C -15 -74 -7 -90 0 -98 C 7 -90 15 -74 12 -56 Z'
const SHORT_RAY = 'M -10 -56 C -12 -69 -6 -80 0 -86 C 6 -80 12 -69 10 -56 Z'
const SPARKLE = 'M0 -9 C1 -2.5 2.5 -1 9 0 C2.5 1 1 2.5 0 9 C-1 2.5 -2.5 1 -9 0 C-2.5 -1 -1 -2.5 0 -9 Z'
const HEART = 'M 0 5 C -7 -0.5 -10 -5 -6.2 -8.8 C -3.6 -11.4 -0.9 -10.2 0 -8 C 0.9 -10.2 3.6 -11.4 6.2 -8.8 C 10 -5 7 -0.5 0 5 Z'

const LONG_PRESS_MS = 520
const DOUBLE_TAP_MS = 320
const DIZZY_TAPS = 6
const DIZZY_WINDOW_MS = 2600
const RUB_DISTANCE_PX = 36
const RUB_EVERY_MS = 420
const BODY_RADIUS = 62 / 120 // body radius as a fraction of half the SVG

type SunnyProps = {
  mood: Mood
  reaction?: Reaction | null
  frozen?: boolean
  dozing?: boolean
  size?: number
  onGesture?: (gesture: Gesture) => void
}

export function Sunny({ mood, reaction = null, frozen = false, dozing = false, size = 220, onGesture }: SunnyProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const ref = (name: string) => `${uid}-${name}`
  const url = (name: string) => `url(#${ref(name)})`

  const svgRef = useRef<SVGSVGElement>(null)
  const [scope, animate] = useAnimate<HTMLDivElement>()
  const [idleWave, setIdleWave] = useState(false)
  const lastLook = useRef(0)
  const taps = useRef<number[]>([])
  const pressTimer = useRef<number | undefined>(undefined)
  const pressFired = useRef(false)
  const press = useRef<{ x: number; y: number; dist: number; lastRub: number } | null>(null)

  // Eyes follow the pointer anywhere on the page.
  useEffect(() => {
    const onMove = (e: globalThis.PointerEvent) => {
      const svg = svgRef.current
      if (!svg) return
      const r = svg.getBoundingClientRect()
      const dx = (e.clientX - (r.left + r.width / 2)) / r.width
      const dy = (e.clientY - (r.top + r.height / 2)) / r.height
      look(svg, clamp(dx * 7, -3.6, 3.6), clamp(dy * 6, -3, 3))
      lastLook.current = performance.now()
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  // Idle life: glance around now and then, and sometimes wave.
  useEffect(() => {
    let timers: number[] = []
    const schedule = () => {
      timers.push(
        window.setTimeout(() => {
          const svg = svgRef.current
          const quiet = performance.now() - lastLook.current > 3000
          if (svg && quiet && mood !== 'sleepy' && !reaction && !dozing) {
            if (Math.random() < 0.35) {
              setIdleWave(true)
              timers.push(window.setTimeout(() => setIdleWave(false), 1400))
            } else {
              look(svg, -3.2, 0.5)
              timers.push(window.setTimeout(() => look(svg, 3.2, -1), 750))
              timers.push(window.setTimeout(() => look(svg, 0, 0), 1500))
            }
          }
          schedule()
        }, 5500 + Math.random() * 5000),
      )
    }
    schedule()
    return () => {
      timers.forEach(clearTimeout)
      timers = []
    }
  }, [mood, reaction, dozing])

  // A little pop whenever the mood changes, and a full twirl for the spin reaction.
  const firstMood = useRef(true)
  useEffect(() => {
    if (firstMood.current) {
      firstMood.current = false
      return
    }
    animate(scope.current, { scale: [1, 1.1, 0.95, 1] }, { duration: 0.55, ease: 'easeOut' })
  }, [mood, animate, scope])

  useEffect(() => {
    if (reaction === 'spin') {
      animate(scope.current, { rotate: [0, 360], scale: [1, 1.12, 1] }, { duration: 0.85, ease: [0.5, 0, 0.25, 1] })
    }
  }, [reaction, animate, scope])

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    try {
      // Keep receiving moves while rubbing, even if the finger slides off Sunny.
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Capture can fail for synthetic or already-released pointers; rubbing still works on Sunny.
    }
    press.current = { x: e.clientX, y: e.clientY, dist: 0, lastRub: 0 }
    pressFired.current = false
    window.clearTimeout(pressTimer.current)
    pressTimer.current = window.setTimeout(() => {
      pressFired.current = true
      onGesture?.('pet')
    }, LONG_PRESS_MS)
  }

  // Rubbing back and forth pets Sunny continuously.
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const p = press.current
    if (!p) return
    p.dist += Math.hypot(e.clientX - p.x, e.clientY - p.y)
    p.x = e.clientX
    p.y = e.clientY
    if (p.dist < RUB_DISTANCE_PX) return
    window.clearTimeout(pressTimer.current)
    const now = performance.now()
    if (now - p.lastRub > RUB_EVERY_MS) {
      p.lastRub = now
      pressFired.current = true
      onGesture?.('pet')
    }
  }

  const endPress = () => {
    window.clearTimeout(pressTimer.current)
    press.current = null
  }

  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    endPress()
    if (pressFired.current) return
    const now = performance.now()
    taps.current = [...taps.current.filter((t) => now - t < DIZZY_WINDOW_MS), now]
    const recent = taps.current
    if (recent.length >= DIZZY_TAPS) {
      taps.current = []
      onGesture?.('dizzy')
    } else if (recent.length >= 2 && now - recent[recent.length - 2] < DOUBLE_TAP_MS) {
      onGesture?.('double')
    } else {
      onGesture?.(zoneAt(e.clientX, e.clientY))
    }
  }

  // Which part of Sunny was touched, in body-radius units from its centre.
  const zoneAt = (x: number, y: number): Gesture => {
    const svg = svgRef.current
    if (!svg) return 'boop'
    const r = svg.getBoundingClientRect()
    const nx = (x - (r.left + r.width / 2)) / (r.width / 2) / BODY_RADIUS
    const ny = (y - (r.top + r.height / 2)) / (r.height / 2) / BODY_RADIUS
    if (Math.hypot(nx, ny) > 1.05) return 'ray'
    if (ny < -0.42) return 'head'
    if (Math.abs(nx) > 0.3 && ny > -0.15 && ny < 0.55) return 'cheek'
    return 'boop'
  }

  const face = reaction ?? (dozing ? 'sleepy' : mood)
  const classes = ['sunny', `sunny--${mood}`]
  if (reaction) classes.push(`sunny--r-${reaction}`)
  else if (dozing) classes.push('sunny--dozing')
  if (frozen) classes.push('sunny--frozen')
  if (idleWave) classes.push('sunny--wave')

  return (
    <motion.button
      type="button"
      className={classes.join(' ')}
      style={{ width: size, height: size * 1.12 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={endPress}
      onContextMenu={(e) => e.preventDefault()}
      whileTap={{ scaleX: 1.12, scaleY: 0.88 }}
      transition={{ type: 'spring', stiffness: 520, damping: 11 }}
      aria-label={`Sunny is feeling ${mood}. Tap to say hi, hold to pet.`}
    >
      <div className="sunny-bob">
        <div className="sunny-body" ref={scope}>
          <div className="sunny-react">
            <svg ref={svgRef} viewBox="-120 -120 240 240" width={size} height={size} aria-hidden="true">
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
                <radialGradient id={ref('frost')} cx="40%" cy="30%" r="80%">
                  <stop offset="0" stopColor="#F4FBFF" stopOpacity="0.55" />
                  <stop offset="1" stopColor="#9FD4FF" stopOpacity="0.5" />
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
                <linearGradient id={ref('orbit')} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" style={{ stopColor: 'var(--orbit-a)' }} stopOpacity="0.95" />
                  <stop offset="0.5" style={{ stopColor: 'var(--orbit-b)' }} stopOpacity="0.15" />
                  <stop offset="1" style={{ stopColor: 'var(--orbit-b)' }} stopOpacity="0.85" />
                </linearGradient>
                <linearGradient id={ref('rim')} x1="0.15" y1="0" x2="0.85" y2="1">
                  <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.9" />
                  <stop offset="0.45" stopColor="#FFFFFF" stopOpacity="0" />
                </linearGradient>
                <filter id={ref('blur-s')} x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="2.4" />
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

              <g className="sunny-orbit">
                <circle r="108" fill="none" stroke={url('orbit')} strokeWidth="1.5" />
                <circle className="sunny-orbit-dot" cx="0" cy="-108" r="3.6" />
              </g>

              <g className="sunny-glow-rays">
                {Array.from({ length: 10 }, (_, i) => (
                  <ellipse key={i} cx="0" cy="-80" rx="2.4" ry="15" transform={`rotate(${i * 36 + 18})`} />
                ))}
              </g>

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
              <circle r="60.6" fill="none" stroke={url('rim')} strokeWidth="2.2" />
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

              <circle className="sunny-frost" r="62" fill={url('frost')} />

              <g className="sunny-cheeks" filter={url('blur-s')}>
                <ellipse cx="-33" cy="15" rx="11" ry="7" fill={BLUSH} />
                <ellipse cx="33" cy="15" rx="11" ry="7" fill={BLUSH} />
              </g>

              {/* Keyed by expression: the new face pops in at once, so a fast run of touches never leaves Sunny blank. */}
              <motion.g
                key={face}
                initial={{ scale: 0.88 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 700, damping: 18 }}
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
              >
                {FACES[face](url)}
              </motion.g>
            </svg>
          </div>
        </div>
      </div>
      <div className="sunny-shadow" />
    </motion.button>
  )
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

function look(svg: SVGSVGElement, x: number, y: number) {
  svg.style.setProperty('--lx', `${x.toFixed(2)}px`)
  svg.style.setProperty('--ly', `${y.toFixed(2)}px`)
}

type EyeProps = { cx: number; cy?: number; look?: number; big?: boolean; squint?: boolean }

function OpenEye({ cx, cy = -4, look = 0, big = false, squint = false }: EyeProps) {
  const rx = big ? 9.5 : 8
  const ry = big ? 12 : squint ? 7.5 : 10.5
  return (
    <g className="sunny-eye">
      <g className="sunny-look">
        <ellipse cx={cx} cy={cy + look} rx={rx} ry={ry} fill={INK} />
        <circle cx={cx + 2.8} cy={cy - (squint ? 2.6 : 4.2) + look} r={big ? 4.2 : 3.3} fill="#fff" />
        <circle cx={cx - 2.6} cy={cy + (squint ? 2.4 : 4) + look} r={big ? 2 : 1.5} fill="#fff" opacity="0.85" />
      </g>
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

const happyEyes = (
  <>
    <path d="M -29 -2 Q -21 -14 -13 -2" {...stroke} strokeWidth={4} />
    <path d="M 13 -2 Q 21 -14 29 -2" {...stroke} strokeWidth={4} />
  </>
)

const openSmile = (
  <>
    <path d="M -13 11 Q 0 34 13 11 Q 0 15 -13 11 Z" fill={INK} />
    <path d="M -6.5 22.5 Q 0 18.5 6.5 22.5 Q 0 28.5 -6.5 22.5 Z" fill="#FF8394" />
  </>
)

function Spiral({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g className="sunny-spiral">
      <path
        d={`M ${cx} ${cy} m -1 0 a 1 1 0 1 1 2 0 a 3 3 0 1 1 -6 0 a 5 5 0 1 1 10 0 a 7 7 0 1 1 -14 0`}
        {...stroke}
        strokeWidth={2.6}
      />
    </g>
  )
}

const FACES: Record<Mood | Reaction, (url: (name: string) => string) => ReactNode> = {
  happy: () => (
    <>
      <path d="M -29 -21 Q -21 -25.5 -13 -22" {...stroke} strokeWidth={2.6} opacity={0.55} />
      <path d="M 13 -22 Q 21 -25.5 29 -21" {...stroke} strokeWidth={2.6} opacity={0.55} />
      <OpenEye cx={-21} />
      <OpenEye cx={21} />
      <path d="M -11 14.5 Q 0 24 11 14.5" {...stroke} />
    </>
  ),
  excited: () => (
    <>
      {happyEyes}
      {openSmile}
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
        <text x="58" y="-62" fontSize="20">
          z
        </text>
        <text x="72" y="-80" fontSize="14">
          z
        </text>
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
      <path d="M -30 -20 Q -22 -21 -14 -26" {...stroke} strokeWidth={2.6} opacity={0.55} />
      <path d="M 14 -26 Q 22 -21 30 -20" {...stroke} strokeWidth={2.6} opacity={0.55} />
      <OpenEye cx={-21} cy={-3} look={-2.5} big />
      <OpenEye cx={21} cy={-3} look={-2.5} big />
      <path d="M -7 20 Q 0 15 7 20" {...stroke} strokeWidth={3.2} />
    </>
  ),
  giggle: () => (
    <>
      {happyEyes}
      {openSmile}
    </>
  ),
  spin: () => (
    <>
      {happyEyes}
      {openSmile}
    </>
  ),
  love: () => (
    <>
      <g className="sunny-heart-eyes" fill="#FF4F72">
        <path d={HEART} transform="translate(-21 -1) scale(1.45)" />
        <path d={HEART} transform="translate(21 -1) scale(1.45)" />
      </g>
      <g fill="#fff" opacity="0.85">
        <circle cx="-24.5" cy="-9" r="2" />
        <circle cx="17.5" cy="-9" r="2" />
      </g>
      <path d="M -10 15 Q 0 25 10 15" {...stroke} />
    </>
  ),
  dizzy: () => (
    <>
      <Spiral cx={-21} cy={-3} />
      <Spiral cx={21} cy={-3} />
      <path d="M -11 19 Q -5.5 14 0 19 Q 5.5 24 11 19" {...stroke} strokeWidth={3} />
    </>
  ),
  shiver: () => (
    <>
      <path d="M -30 -21 L -13 -25" {...stroke} strokeWidth={2.8} />
      <path d="M 13 -25 L 30 -21" {...stroke} strokeWidth={2.8} />
      <OpenEye cx={-21} cy={-3} />
      <OpenEye cx={21} cy={-3} />
      <path d="M -11 18 L -7 15 L -3 18 L 1 15 L 5 18 L 9 15" {...stroke} strokeWidth={2.8} />
      <g className="sunny-sparkles" fill="#E9F6FF">
        <path d={SPARKLE} transform="translate(-48 -40) scale(0.6)" />
        <path d={SPARKLE} transform="translate(44 34) scale(0.5)" />
        <path d={SPARKLE} transform="translate(30 -50) scale(0.45)" />
      </g>
    </>
  ),
  yum: () => (
    <>
      {happyEyes}
      <path d="M -11 13 Q 0 24 11 13" {...stroke} />
      <path d="M 1.5 18.5 Q 5.5 17.5 9 19 Q 9 26 4.5 26 Q 0.5 25.5 1.5 18.5 Z" fill="#FF8394" />
    </>
  ),
  pat: () => (
    <>
      {happyEyes}
      <path d="M -10 14 Q 0 23 10 14" {...stroke} />
    </>
  ),
  blush: () => (
    <>
      <OpenEye cx={-21} cy={-3} />
      <OpenEye cx={21} cy={-3} />
      <ellipse cx="0" cy="18" rx="3.8" ry="3.4" fill={INK} />
    </>
  ),
  boop: () => (
    <>
      <path d="M -28 -10 L -15 -3.5 L -28 3" {...stroke} strokeWidth={3.6} />
      <path d="M 28 -10 L 15 -3.5 L 28 3" {...stroke} strokeWidth={3.6} />
      <path d="M -7 13 Q 0 23 7 13 Z" fill={INK} />
    </>
  ),
  scan: () => (
    <>
      <path d="M -31 -21 L -13 -17" {...stroke} strokeWidth={3} />
      <path d="M 13 -17 L 31 -21" {...stroke} strokeWidth={3} />
      <OpenEye cx={-21} cy={-3} squint />
      <OpenEye cx={21} cy={-3} squint />
      <path d="M -8 18 Q 0 20 8 17" {...stroke} strokeWidth={3.2} />
    </>
  ),
}
