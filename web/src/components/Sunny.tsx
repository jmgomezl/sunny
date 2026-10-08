import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { motion, useAnimate, useMotionTemplate, useMotionValue, useSpring, useTransform } from 'motion/react'

export type Mood = 'happy' | 'excited' | 'sleepy' | 'worried' | 'hungry'
/** Short-lived expressions that play over the current mood. */
export type Reaction =
  | 'giggle'
  | 'love'
  | 'dizzy'
  | 'spin'
  | 'shiver'
  | 'yum'
  | 'scan'
  | 'pat'
  | 'blush'
  | 'boop'
  | 'alarm'
  // A coin is on its way: mouth wide open.
  | 'nom'
  // Woken up at night, before it takes in what's wrong.
  | 'yawn'
/** Where and how Sunny was touched. */
export type Gesture = 'boop' | 'head' | 'cheek' | 'ray' | 'double' | 'pet' | 'dizzy'

const INK = '#3A2114'
const BLUSH = '#FF7C8C'
// A soft warm edge that keeps hands and feet readable against the rays.
const LIMB_EDGE = '#D9761F'
const SHOE_EDGE = '#B9A288'

// Soft "flame petal" rays, pointing up; rotated around the body.
const LONG_RAY = 'M -12 -56 C -15 -74 -7 -90 0 -98 C 7 -90 15 -74 12 -56 Z'
const SHORT_RAY = 'M -10 -56 C -12 -69 -6 -80 0 -86 C 6 -80 12 -69 10 -56 Z'
const SPARKLE = 'M0 -9 C1 -2.5 2.5 -1 9 0 C2.5 1 1 2.5 0 9 C-1 2.5 -2.5 1 -9 0 C-2.5 -1 -1 -2.5 0 -9 Z'
const HEART =
  'M 0 5 C -7 -0.5 -10 -5 -6.2 -8.8 C -3.6 -11.4 -0.9 -10.2 0 -8 C 0.9 -10.2 3.6 -11.4 6.2 -8.8 C 10 -5 7 -0.5 0 5 Z'

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
  /** Keeps Sunny waving (used by the sticker stage). */
  wave?: boolean
  /** Accessories from the good-habit badges Sunny's friend earned. */
  wear?: Wear
  /** At night Sunny dozes holding a little lantern: still on watch. */
  lantern?: boolean
  /** Dark mode: Sunny wears its sunglasses (and peeks over them now and then). */
  cool?: boolean
  onGesture?: (gesture: Gesture) => void
}

export type Wear = { shades?: boolean; shield?: boolean; key?: boolean }

export function Sunny({
  mood,
  reaction = null,
  frozen = false,
  dozing = false,
  size = 220,
  wave = false,
  wear = {},
  lantern = false,
  cool = false,
  onGesture,
}: SunnyProps) {
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
  const settleTimer = useRef<number | undefined>(undefined)

  // ── Realism layer ──────────────────────────────────────────────
  // A spring-smoothed gaze (-1..1) turns Sunny like a sphere toward the pointer:
  // the face slides across the surface, while the gloss, rays and halo shift the
  // other way, so each layer reads at its own depth.
  const gx = useMotionValue(0)
  const gy = useMotionValue(0)
  const sgx = useSpring(gx, { stiffness: 120, damping: 15, mass: 0.8 })
  const sgy = useSpring(gy, { stiffness: 120, damping: 15, mass: 0.8 })
  const faceX = useTransform(sgx, (v) => v * 7)
  const faceY = useTransform(sgy, (v) => v * 5)
  const faceTurn = useTransform(sgx, (v) => 1 - Math.abs(v) * 0.07)
  const cheekX = useTransform(sgx, (v) => v * 6)
  const glossX = useTransform(sgx, (v) => v * -7)
  const glossY = useTransform(sgy, (v) => v * -5)
  const backX = useTransform(sgx, (v) => v * -3.5)
  const backY = useTransform(sgy, (v) => v * -2.5)
  const haloX = useTransform(sgx, (v) => v * -7)
  const haloY = useTransform(sgy, (v) => v * -5)
  const lean = useTransform(sgx, (v) => v * 4)
  const shadowX = useTransform(sgx, (v) => v * -9)

  // Jelly body: pressing squashes Sunny along the line of the touch; letting go
  // springs back past rest and wobbles, like a soft plush toy.
  const squashTarget = useMotionValue(0)
  const squash = useSpring(squashTarget, { stiffness: 480, damping: 8, mass: 0.7 })
  const pressAngle = useMotionValue(90)
  const squashAlong = useTransform(squash, (v) => 1 - v * 0.1)
  const bulgeAcross = useTransform(squash, (v) => 1 + v * 0.075)
  const unrotate = useTransform(pressAngle, (a) => -a)
  const jelly = useMotionTemplate`rotate(${pressAngle}deg) scale(${squashAlong}, ${bulgeAcross}) rotate(${unrotate}deg)`

  // Eyes follow the pointer anywhere on the page.
  useEffect(() => {
    const onMove = (e: globalThis.PointerEvent) => {
      const svg = svgRef.current
      if (!svg) return
      const r = svg.getBoundingClientRect()
      const dx = (e.clientX - (r.left + r.width / 2)) / r.width
      const dy = (e.clientY - (r.top + r.height / 2)) / r.height
      look(svg, clamp(dx * 7, -3.6, 3.6), clamp(dy * 6, -3, 3))
      gx.set(clamp(dx * 1.6, -1, 1))
      gy.set(clamp(dy * 1.6, -1, 1))
      lastLook.current = performance.now()
      window.clearTimeout(settleTimer.current)
      settleTimer.current = window.setTimeout(() => {
        gx.set(0)
        gy.set(0)
      }, 2600)
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [gx, gy])

  // Idle life: glance around now and then, and sometimes wave.
  useEffect(() => {
    let timers: number[] = []
    const schedule = () => {
      timers.push(
        window.setTimeout(
          () => {
            const svg = svgRef.current
            const quiet = performance.now() - lastLook.current > 3000
            if (svg && quiet && mood !== 'sleepy' && !reaction && !dozing) {
              if (Math.random() < 0.35) {
                setIdleWave(true)
                timers.push(window.setTimeout(() => setIdleWave(false), 1400))
              } else {
                glance(svg, -1, 0.2)
                timers.push(window.setTimeout(() => glance(svg, 1, -0.4), 800))
                timers.push(window.setTimeout(() => glance(svg, 0, 0), 1600))
              }
            }
            schedule()
          },
          5500 + Math.random() * 5000,
        ),
      )
    }
    const glance = (svg: SVGSVGElement, x: number, y: number) => {
      look(svg, x * 3.2, y * 2.5)
      gx.set(x * 0.55)
      gy.set(y * 0.4)
    }
    // Micro-saccades: tiny eye flicks, so Sunny never looks frozen in place.
    const saccades = window.setInterval(() => {
      const svg = svgRef.current
      const quiet = performance.now() - lastLook.current > 3000
      if (!svg || !quiet || reaction || dozing || mood === 'sleepy') return
      look(svg, (Math.random() - 0.5) * 2.2, (Math.random() - 0.5) * 1.4)
    }, 1400)
    schedule()
    return () => {
      timers.forEach(clearTimeout)
      timers = []
      clearInterval(saccades)
    }
  }, [mood, reaction, dozing, gx, gy])

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
    pressAngle.set(angleAt(e.clientX, e.clientY))
    squashTarget.set(1)
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
    // While rubbing, the squash follows the finger, so Sunny rolls under your hand.
    pressAngle.set(angleAt(e.clientX, e.clientY))
    squashTarget.set(0.7)
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
    squashTarget.set(0)
  }

  // Angle of the touch from Sunny's centre; a press near the middle squashes straight down.
  const angleAt = (x: number, y: number) => {
    const svg = svgRef.current
    if (!svg) return 90
    const r = svg.getBoundingClientRect()
    const dx = x - (r.left + r.width / 2)
    const dy = y - (r.top + r.height / 2)
    if (Math.hypot(dx, dy) < r.width * 0.08) return 90
    return (Math.atan2(dy, dx) * 180) / Math.PI
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
  if (idleWave || wave) classes.push('sunny--wave')
  if (cool) classes.push('sunny--cool')

  return (
    <motion.button
      type="button"
      className={classes.join(' ')}
      style={{ width: size, height: size * 1.12 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={endPress}
      onLostPointerCapture={() => squashTarget.set(0)}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`Sunny is feeling ${mood}. Tap to say hi, hold to pet.`}
    >
      <div className="sunny-bob">
        <motion.div className="sunny-sway" style={{ rotate: lean }}>
          <div className="sunny-body" ref={scope}>
            <motion.div className="sunny-jelly" style={{ transform: jelly }}>
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
                    {/* Sunny's little outfit: Solana sneakers and sweatbands. */}
                    <linearGradient id={ref('sol-pin')} x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#9945FF" />
                      <stop offset="0.55" stopColor="#43B4CA" />
                      <stop offset="1" stopColor="#14F195" />
                    </linearGradient>
                    <linearGradient id={ref('sol')} x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0" stopColor="#9945FF" />
                      <stop offset="0.55" stopColor="#43B4CA" />
                      <stop offset="1" stopColor="#14F195" />
                    </linearGradient>
                    <radialGradient id={ref('shoe')} cx="40%" cy="25%" r="80%">
                      <stop offset="0" stopColor="#FFFFFF" />
                      <stop offset="0.6" stopColor="#FBF6EE" />
                      <stop offset="1" stopColor="#E9DFD1" />
                    </radialGradient>
                    <radialGradient id={ref('mitten')} cx="38%" cy="30%" r="75%">
                      <stop offset="0" stopColor="#FFF0C2" />
                      <stop offset="0.45" stopColor="#FFCF62" />
                      <stop offset="1" stopColor="#F29230" />
                    </radialGradient>
                    <radialGradient id={ref('lantern-light')} cx="50%" cy="55%" r="60%">
                      <stop offset="0" stopColor="#FFFBE0" />
                      <stop offset="0.5" stopColor="#FFD668" />
                      <stop offset="1" stopColor="#F59A2C" />
                    </radialGradient>
                    <radialGradient id={ref('lantern-glow')}>
                      <stop offset="0" stopColor="#FFE07A" stopOpacity="0.95" />
                      <stop offset="1" stopColor="#FFB238" stopOpacity="0" />
                    </radialGradient>
                    <linearGradient id={ref('lens')} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#3a2f55" />
                      <stop offset="0.55" stopColor="#17111f" />
                      <stop offset="1" stopColor="#0b0810" />
                    </linearGradient>
                    <linearGradient id={ref('lens-sky')} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#ff9fb8" stopOpacity="0" />
                      <stop offset="0.6" stopColor="#ff9fb8" stopOpacity="0.32" />
                      <stop offset="1" stopColor="#ffc46b" stopOpacity="0.5" />
                    </linearGradient>
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
                      <feColorMatrix type="matrix" values="0 0 0 0 0.62  0 0 0 0 0.32  0 0 0 0 0.08  0 0 0 1.1 -0.42" />
                    </filter>
                    <clipPath id={ref('body-clip')}>
                      <circle r="62" />
                    </clipPath>
                  </defs>

                  <motion.g style={{ x: haloX, y: haloY }}>
                    <circle className="sunny-halo" r="114" fill={url('halo')} />
                  </motion.g>

                  <g className="sunny-orbit">
                    <circle r="108" fill="none" stroke={url('orbit')} strokeWidth="1.5" />
                    <circle className="sunny-orbit-dot" cx="0" cy="-108" r="3.6" />
                  </g>

                  <motion.g style={{ x: backX, y: backY }}>
                    <g className="sunny-glow-rays">
                      {Array.from({ length: 10 }, (_, i) => (
                        <ellipse key={i} cx="0" cy="-80" rx="2.4" ry="15" transform={`rotate(${i * 36 + 18})`} />
                      ))}
                    </g>

                    <g className="sunny-rays-breathe">
                      <g className="sunny-rays">
                        {Array.from({ length: 10 }, (_, i) => (
                          <g key={i} transform={`rotate(${i * 36})`}>
                            {/* Each ray flickers on its own rhythm, like a living flame. */}
                            <path
                              className="sunny-ray"
                              d={i % 2 === 0 ? LONG_RAY : SHORT_RAY}
                              fill={url('ray')}
                              style={{ animationDuration: `${1.5 + (i % 3) * 0.45}s`, animationDelay: `${-i * 0.37}s` }}
                            />
                          </g>
                        ))}
                      </g>
                    </g>
                  </motion.g>

                  {/* Little plush arms with mitten hands. Each turns at its shoulder, hidden under the body. */}
                  <Arm side="l" url={url} />
                  <Arm side="r" url={url} holding={lantern ? <Lantern url={url} /> : null} />

                  {/* Feet in little sneakers, peeking out from under the body like a plush toy sitting down. */}
                  <g className="sunny-feet">
                    <Foot side="l" url={url} id={ref} />
                    <Foot side="r" url={url} id={ref} />
                  </g>

                  <circle r="62" fill={url('body')} />
                  <circle r="62" fill={url('shade')} />
                  <circle className="sunny-ambient" r="62" />
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
                  <motion.g style={{ x: glossX, y: glossY }}>
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
                  </motion.g>

                  <circle className="sunny-frost" r="62" fill={url('frost')} />

                  {/* Earned with good habits: a key necklace, a shield pin, sunglasses resting on its head. */}
                  {wear.key && (
                    <g className="sunny-wear sunny-wear--key">
                      <path d="M -30 34 Q 0 58 30 34" fill="none" stroke="#9A5B1E" strokeWidth="1.6" opacity="0.8" />
                      <circle cx="0" cy="48" r="4.6" fill="none" stroke="#C98612" strokeWidth="2.4" />
                      <path
                        d="M 0 52.6 V 60 M 0 57 H 3.4 M 0 60 H 2.6"
                        stroke="#C98612"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                      />
                    </g>
                  )}
                  {wear.shield && (
                    <g className="sunny-wear sunny-wear--shield" transform="translate(-38 27) rotate(-12)">
                      <path
                        d="M 0 -10 L 8.5 -6.5 V 1 C 8.5 6.5 4.5 10 0 12 C -4.5 10 -8.5 6.5 -8.5 1 V -6.5 Z"
                        fill={url('sol-pin')}
                        stroke="#fff"
                        strokeWidth="1.4"
                      />
                      <path
                        d="M -3.6 0.6 L -0.8 3.6 L 4 -2.4"
                        fill="none"
                        stroke="#fff"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </g>
                  )}
                  {wear.shades && !cool && (
                    <g className="sunny-wear sunny-wear--shades" transform="translate(0 -43) rotate(-6)">
                      <path
                        d="M -6 -1 Q 0 -4 6 -1"
                        fill="none"
                        stroke="#2A1A10"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                      />
                      <path
                        d="M -29 -2 L -37 -6 M 29 -2 L 37 -6"
                        stroke="#2A1A10"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                      />
                      <rect x="-29" y="-6" width="23" height="14" rx="6.5" fill="#2A1A10" />
                      <rect x="6" y="-6" width="23" height="14" rx="6.5" fill="#2A1A10" />
                      <path
                        d="M -25 -2.5 L -19 -2.5 M 10 -2.5 L 16 -2.5"
                        stroke="#fff"
                        strokeWidth="2"
                        strokeLinecap="round"
                        opacity="0.65"
                      />
                    </g>
                  )}

                  <motion.g style={{ x: cheekX, y: faceY }}>
                    <g className="sunny-cheeks" filter={url('blur-s')}>
                      <ellipse cx="-33" cy="15" rx="11" ry="7" fill={BLUSH} />
                      <ellipse cx="33" cy="15" rx="11" ry="7" fill={BLUSH} />
                    </g>
                  </motion.g>

                  {/* Keyed by expression: the new face pops in at once, so a fast run of touches never leaves Sunny blank. */}
                  <motion.g
                    style={{
                      x: faceX,
                      y: faceY,
                      scaleX: faceTurn,
                      transformBox: 'fill-box',
                      transformOrigin: 'center',
                    }}
                  >
                    <motion.g
                      key={face}
                      initial={{ scale: 0.88 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 700, damping: 18 }}
                      style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                    >
                      {FACES[face](url)}
                    </motion.g>
                    {cool && <Shades url={url} />}
                  </motion.g>
                </svg>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </div>
      <motion.div className="sunny-shadow-wrap" style={{ x: shadowX }}>
        <div className="sunny-shadow" />
      </motion.div>
    </motion.button>
  )
}

type LimbProps = { side: 'l' | 'r'; url: (name: string) => string }

// One lens of Sunny's sunglasses, a soft rounded wayfarer shape over the left eye.
const LENS = 'M -38 -15 Q -22 -18.5 -7 -15 Q -5.5 -4 -10 3.5 Q -15 8.5 -23 8.5 Q -32.5 8.5 -36 2 Q -39 -5 -38 -15 Z'

/** Dark mode's big black sunglasses, with a sunset in the lenses and a glint. */
function Shades({ url }: { url: (name: string) => string }) {
  return (
    <g className="sunny-cool">
      <path d="M -38 -12 L -50 -17 M 38 -12 L 50 -17" stroke="#0e0a14" strokeWidth="2.6" strokeLinecap="round" />
      {[1, -1].map((k) => (
        <g key={k} transform={`scale(${k} 1)`}>
          <path d={LENS} fill={url('lens')} stroke="#0e0a14" strokeWidth="2.4" strokeLinejoin="round" />
          <path d={LENS} fill={url('lens-sky')} />
          <path d="M -31 -11 L -24 -11 L -33 -1 L -36 -4 Z" fill="#fff" opacity="0.55" />
          <path d="M -21 -11 L -18.5 -11 L -27 -1 L -29 -2 Z" fill="#fff" opacity="0.35" />
        </g>
      ))}
      <path d="M -7.5 -12.5 Q 0 -16.5 7.5 -12.5" fill="none" stroke="#0e0a14" strokeWidth="3" strokeLinecap="round" />
    </g>
  )
}

/**
 * A little brass lantern hanging from the right mitten. The sleepy arm hangs at 18°, so the
 * lantern turns back by the same amount to hang straight, and sways gently.
 */
function Lantern({ url }: { url: (name: string) => string }) {
  const brass = '#9C6A35'
  return (
    <g transform="rotate(-18 77 47) translate(77 47) scale(1.38) translate(-77 -47)">
      <g className="sunny-lantern">
        <circle className="sunny-lantern-glow" cx="77" cy="64" r="23" fill={url('lantern-glow')} />
        <path d="M 71.5 56 Q 77 43 82.5 56" fill="none" stroke={brass} strokeWidth="1.8" strokeLinecap="round" />
        <rect x="70.5" y="53.6" width="13" height="3.6" rx="1.6" fill={brass} />
        <rect x="71.6" y="56.8" width="10.8" height="13.6" rx="3" fill={url('lantern-light')} stroke={brass} strokeWidth="1.3" />
        <path d="M 75.4 57.4 V 69.8 M 78.6 57.4 V 69.8" stroke={brass} strokeWidth="0.9" opacity="0.55" />
        <path
          className="sunny-lantern-flame"
          d="M 77 59.6 C 77 59.6 74.6 62.8 74.6 64.6 C 74.6 66 75.7 67 77 67 C 78.3 67 79.4 66 79.4 64.6 C 79.4 62.8 77 59.6 77 59.6 Z"
          fill="#FFFDF0"
        />
        <rect x="70" y="69.8" width="14" height="3.6" rx="1.6" fill={brass} />
      </g>
    </g>
  )
}

/** An arm from the shoulder at (±56, 20), ending in a round mitten with a little thumb. */
function Arm({ side, url, holding }: LimbProps & { holding?: ReactNode }) {
  const k = side === 'l' ? -1 : 1
  const arm = `M ${56 * k} 20 Q ${66 * k} 26 ${73 * k} 36`
  return (
    <g className={`sunny-arm sunny-arm--${side}`}>
      <path d={arm} fill="none" stroke={LIMB_EDGE} strokeOpacity="0.5" strokeWidth="15" strokeLinecap="round" />
      <path d={arm} fill="none" stroke={url('arm')} strokeWidth="12.4" strokeLinecap="round" />
      <path
        className="sunny-band"
        d={`M ${64.6 * k} 26.4 L ${69 * k} 30.6`}
        stroke={url('sol')}
        strokeWidth="14.6"
        strokeLinecap="butt"
      />
      {/* Whatever the hand holds goes under the mitten, so the fingers close around it. */}
      {holding}
      <ellipse
        cx={68 * k}
        cy="35"
        rx="4"
        ry="5.2"
        transform={`rotate(${-38 * k} ${68 * k} 35)`}
        fill={url('mitten')}
        stroke={LIMB_EDGE}
        strokeOpacity="0.55"
        strokeWidth="1.2"
      />
      <ellipse
        cx={76.5 * k}
        cy="41.5"
        rx="10.6"
        ry="9.8"
        transform={`rotate(${28 * k} ${76.5 * k} 41.5)`}
        fill={url('mitten')}
        stroke={LIMB_EDGE}
        strokeOpacity="0.55"
        strokeWidth="1.2"
      />
      <ellipse cx={79 * k} cy="37.5" rx="4" ry="2.4" fill="#fff" opacity="0.5" />
    </g>
  )
}

// Three slanted bars, like the Solana logo, for the side of each sneaker.
const STRIPES = [0, 1, 2]

/**
 * A foot in a little sneaker: cream upper, Solana sole and three Solana stripes. Its top
 * is tucked under the body, so only the toe, the side and the sole show.
 */
function Foot({ side, url, id }: LimbProps & { id: (name: string) => string }) {
  const k = side === 'l' ? -1 : 1
  const cx = 24 * k
  const turn = `rotate(${12 * k} ${cx} 65)`
  const shoe = <ellipse cx={cx} cy="65" rx="15.5" ry="10" transform={turn} />
  return (
    <g className={`sunny-foot sunny-foot--${side}`}>
      <clipPath id={id(`shoe-${side}`)}>{shoe}</clipPath>
      <ellipse cx={cx} cy="65" rx="15.5" ry="10" transform={turn} fill={url('shoe')} />
      <g clipPath={url(`shoe-${side}`)}>
        <rect x={cx - 20} y="70.4" width="40" height="8" transform={turn} fill={url('sol')} />
        <rect x={cx - 20} y="69.6" width="40" height="1.2" transform={turn} fill="#fff" opacity="0.7" />
      </g>
      <g transform={turn} fill={url('sol')}>
        {STRIPES.map((i) => {
          // Outer side of the shoe; the middle bar leans the other way, as in the logo.
          const x = cx + 5.5 * k
          const y = 59.6 + i * 3.1
          const lean = i === 1 ? -1.3 : 1.3
          return (
            <path
              key={i}
              d={`M ${x - 4} ${y + 1.8} L ${x + 4} ${y + 1.8} L ${x + 4 + lean} ${y} L ${x - 4 + lean} ${y} Z`}
            />
          )
        })}
      </g>
      <ellipse cx={cx} cy="65" rx="15.5" ry="10" transform={turn} fill="none" stroke={SHOE_EDGE} strokeWidth="1.2" />
      <ellipse cx={(24 - 9) * k} cy="63.5" rx="4.5" ry="2.2" transform={turn} fill="#fff" opacity="0.8" />
    </g>
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
  alarm: (url) => FACES.worried(url),
  nom: () => (
    <>
      <path d="M -29 -22 Q -21 -27 -13 -23" {...stroke} strokeWidth={2.6} opacity={0.55} />
      <path d="M 13 -23 Q 21 -27 29 -22" {...stroke} strokeWidth={2.6} opacity={0.55} />
      <OpenEye cx={-21} cy={-5} look={2.5} big />
      <OpenEye cx={21} cy={-5} look={2.5} big />
      <path d="M -12.5 12 Q 0 38 12.5 12 Q 0 8.5 -12.5 12 Z" fill={INK} />
      <path d="M -6.5 25.5 Q 0 21 6.5 25.5 Q 0 31.5 -6.5 25.5 Z" fill="#FF8394" />
    </>
  ),
  yawn: (url) => (
    <>
      <path d="M -29 -3 Q -21 -9.5 -13 -3" {...stroke} />
      <path d="M 13 -3 Q 21 -9.5 29 -3" {...stroke} />
      <ellipse cx="0" cy="20" rx="7.5" ry="10.5" fill={INK} />
      <ellipse cx="0" cy="25.5" rx="4.6" ry="3.6" fill="#FF8394" />
      <path d="M 33 -1 C 33 -1 30.5 2.6 30.5 4.2 C 30.5 5.6 31.6 6.6 33 6.6 C 34.4 6.6 35.5 5.6 35.5 4.2 C 35.5 2.6 33 -1 33 -1 Z" fill={url('drop')} />
    </>
  ),
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
