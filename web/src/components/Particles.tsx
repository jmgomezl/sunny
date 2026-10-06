import { motion, type TargetAndTransition, type Transition } from 'motion/react'

export type ParticleKind = 'heart' | 'sparkle' | 'coin' | 'snow'

export type Particle = {
  id: number
  kind: ParticleKind
  x: number
  rise: number
  rotate: number
  delay: number
  scale: number
}

let nextId = 1

/** Builds a burst of particles that float up and out from Sunny. */
export function burst(kind: ParticleKind, count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => {
    const spread = (i / Math.max(1, count - 1) - 0.5) * 2
    return {
      id: nextId++,
      kind,
      x: spread * (60 + Math.random() * 40),
      rise: 90 + Math.random() * 70,
      rotate: (Math.random() - 0.5) * 70,
      delay: Math.random() * 0.25,
      scale: 0.75 + Math.random() * 0.5,
    }
  })
}

/** Per-kind motion, so each particle obeys its own little physics. */
type ParticleMotion = { initial?: TargetAndTransition; animate: TargetAndTransition; transition: Transition }

function motionFor(p: Particle): ParticleMotion {
  switch (p.kind) {
    // Hearts float up and sway side to side like they're carried by warm air.
    case 'heart':
      return {
        animate: {
          opacity: [0, 1, 1, 0],
          x: [0, p.x * 0.35 + 10, p.x * 0.7 - 10, p.x],
          y: [0, -p.rise * 0.35, -p.rise * 0.7, -p.rise],
          scale: [0.3, p.scale * 1.15, p.scale, p.scale * 0.85],
          rotate: [0, p.rotate * 0.4, -p.rotate * 0.3, p.rotate * 0.2],
        },
        transition: { duration: 1.8, delay: p.delay, ease: 'easeOut' },
      }
    // Coins pop up, flip as they spin, then fall back under gravity.
    case 'coin':
      return {
        animate: {
          opacity: [0, 1, 1, 1, 0],
          x: [0, p.x * 0.45, p.x * 0.8, p.x],
          y: [0, -p.rise * 0.9, -p.rise * 0.75, 30],
          scaleX: [1, -1, 1, -1, 1],
          scale: [0.4, p.scale, p.scale, p.scale * 0.9],
        },
        transition: {
          duration: 1.3,
          delay: p.delay,
          times: [0, 0.38, 0.55, 1],
          ease: ['easeOut', 'easeIn', 'easeIn'],
          scaleX: { duration: 1.3, delay: p.delay, ease: 'linear' },
        },
      }
    // Snow starts above Sunny and drifts down, rocking gently.
    case 'snow':
      return {
        initial: { opacity: 0, x: p.x * 0.6, y: -130, scale: p.scale * 0.8, rotate: 0 },
        animate: {
          opacity: [0, 1, 1, 0],
          x: [p.x * 0.6, p.x * 0.6 + 12, p.x * 0.6 - 10, p.x * 0.6 + 6],
          y: [-130, -60, 10, 70],
          rotate: [0, 60, 120, 180],
        },
        transition: { duration: 2.4, delay: p.delay * 2, ease: 'linear' },
      }
    // Sparkles burst outward fast and twinkle out.
    case 'sparkle':
      return {
        animate: {
          opacity: [0, 1, 0.6, 1, 0],
          x: p.x * 1.1,
          y: -p.rise * 0.8,
          scale: [0, p.scale * 1.3, p.scale * 0.7, p.scale, 0],
          rotate: p.rotate * 2,
        },
        transition: { duration: 1.1, delay: p.delay, ease: [0.15, 0.8, 0.3, 1] },
      }
  }
}

export function Particles({ items, onDone }: { items: Particle[]; onDone: (id: number) => void }) {
  return (
    <div className="particles" aria-hidden="true">
      {items.map((p) => {
        const m = motionFor(p)
        return (
          <motion.span
            key={p.id}
            className={`particle particle--${p.kind}`}
            initial={m.initial ?? { opacity: 0, x: 0, y: 0, scale: 0.3, rotate: 0 }}
            animate={m.animate}
            transition={m.transition}
            onAnimationComplete={() => onDone(p.id)}
          >
            <ParticleShape kind={p.kind} />
          </motion.span>
        )
      })}
    </div>
  )
}

function ParticleShape({ kind }: { kind: ParticleKind }) {
  switch (kind) {
    case 'heart':
      return (
        <svg viewBox="-12 -12 24 24" width="22" height="22">
          <path
            d="M 0 8 C -10 1 -12 -5 -8 -9 C -5 -12 -1.5 -10.5 0 -7.5 C 1.5 -10.5 5 -12 8 -9 C 12 -5 10 1 0 8 Z"
            fill="#FF5C7C"
          />
          <ellipse cx="-4.5" cy="-5.5" rx="2.2" ry="1.4" fill="#fff" opacity="0.7" transform="rotate(-30 -4.5 -5.5)" />
        </svg>
      )
    case 'sparkle':
      return (
        <svg viewBox="-10 -10 20 20" width="18" height="18">
          <path
            d="M0 -9 C1 -2.5 2.5 -1 9 0 C2.5 1 1 2.5 0 9 C-1 2.5 -2.5 1 -9 0 C-2.5 -1 -1 -2.5 0 -9 Z"
            fill="#FFD460"
          />
        </svg>
      )
    case 'coin':
      return (
        <svg viewBox="-12 -12 24 24" width="22" height="22">
          <circle r="10" fill="#F6A623" />
          <circle r="7.6" fill="#FFD25E" />
          <path
            d="M -2.6 -3.2 h4.2 a2 2 0 0 1 0 4 h-3.2 a2 2 0 0 0 0 4 h4.2 M 0 -5.4 v1.8 M 0 4.8 v1.8"
            stroke="#B5650C"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      )
    case 'snow':
      return (
        <svg viewBox="-12 -12 24 24" width="20" height="20">
          <g stroke="#9ED6FF" strokeWidth="2" strokeLinecap="round">
            <path d="M0 -10 V10 M-8.7 -5 L8.7 5 M-8.7 5 L8.7 -5" />
            <path d="M-2.5 -7.5 L0 -5 L2.5 -7.5 M-2.5 7.5 L0 5 L2.5 7.5" />
          </g>
        </svg>
      )
  }
}
