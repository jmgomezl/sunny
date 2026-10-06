import { useEffect, useRef } from 'react'

export type Weather = 'clear' | 'golden' | 'storm' | 'night' | 'hazy'

const WEATHERS: Weather[] = ['clear', 'golden', 'storm', 'night', 'hazy']

// Deterministic pseudo-random so stars/raindrops don't jump between renders.
function seeded(n: number) {
  const x = Math.sin(n * 9301 + 49297) * 233280
  return x - Math.floor(x)
}

const STARS = Array.from({ length: 34 }, (_, i) => ({
  left: seeded(i) * 100,
  top: seeded(i + 100) * 62,
  size: 1.2 + seeded(i + 200) * 2.2,
  delay: seeded(i + 300) * 4,
}))

const DROPS = Array.from({ length: 46 }, (_, i) => ({
  left: seeded(i + 400) * 100,
  delay: seeded(i + 500) * 1.2,
  duration: 0.55 + seeded(i + 600) * 0.4,
}))

const GLINTS = Array.from({ length: 14 }, (_, i) => ({
  left: 6 + seeded(i + 700) * 88,
  top: 8 + seeded(i + 800) * 60,
  scale: 0.5 + seeded(i + 900) * 0.8,
  delay: seeded(i + 1000) * 3,
}))

const CLOUDS = [
  { top: 13, scale: 0.9, duration: 70, delay: -12 },
  { top: 30, scale: 0.55, duration: 95, delay: -60 },
  { top: 6, scale: 0.45, duration: 120, delay: -30 },
  { top: 44, scale: 0.7, duration: 85, delay: -75 },
]

export function Sky({ weather }: { weather: Weather }) {
  const ref = useRef<HTMLDivElement>(null)

  // Parallax: far layers (stars, sunbeam) barely move, near clouds move more, so the sky has depth.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const el = ref.current
      if (!el) return
      el.style.setProperty('--px', ((e.clientX / window.innerWidth) * 2 - 1).toFixed(3))
      el.style.setProperty('--py', ((e.clientY / window.innerHeight) * 2 - 1).toFixed(3))
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  return (
    <div ref={ref} className={`sky sky--${weather}`} aria-hidden="true">
      {WEATHERS.map((w) => (
        <div key={w} className={`sky-layer sky-layer--${w}`} data-active={w === weather} />
      ))}

      <div className="sky-sunbeam" />

      <div className="sky-stars" data-active={weather === 'night'}>
        {STARS.map((s, i) => (
          <span
            key={i}
            style={{
              left: `${s.left}%`,
              top: `${s.top}%`,
              width: s.size,
              height: s.size,
              animationDelay: `${s.delay}s`,
            }}
          />
        ))}
      </div>

      <div className="sky-clouds">
        {CLOUDS.map((c, i) => (
          <div
            key={i}
            className="sky-cloud"
            style={{
              top: `${c.top}%`,
              animationDuration: `${c.duration}s`,
              animationDelay: `${c.delay}s`,
              ['--s' as string]: c.scale,
            }}
          >
            <CloudShape />
          </div>
        ))}
      </div>

      <div className="sky-rain" data-active={weather === 'storm'}>
        {DROPS.map((d, i) => (
          <span
            key={i}
            style={{ left: `${d.left}%`, animationDelay: `${d.delay}s`, animationDuration: `${d.duration}s` }}
          />
        ))}
      </div>

      <div className="sky-glints" data-active={weather === 'golden'}>
        {GLINTS.map((g, i) => (
          <svg
            key={i}
            viewBox="-10 -10 20 20"
            style={{ left: `${g.left}%`, top: `${g.top}%`, animationDelay: `${g.delay}s`, ['--s' as string]: g.scale }}
          >
            <path d="M0 -9 C1 -2.5 2.5 -1 9 0 C2.5 1 1 2.5 0 9 C-1 2.5 -2.5 1 -9 0 C-2.5 -1 -1 -2.5 0 -9 Z" />
          </svg>
        ))}
      </div>
    </div>
  )
}

function CloudShape() {
  return (
    <svg viewBox="0 0 220 110" width="220" height="110">
      <g className="cloud-body">
        <circle cx="62" cy="68" r="34" />
        <circle cx="104" cy="50" r="42" />
        <circle cx="150" cy="64" r="32" />
        <circle cx="180" cy="80" r="22" />
        <circle cx="34" cy="84" r="20" />
        <rect x="30" y="70" width="160" height="34" rx="17" />
      </g>
      <g className="cloud-shine">
        <ellipse cx="96" cy="34" rx="22" ry="9" />
      </g>
    </svg>
  )
}

/** Puffy cloud horizon that melts the sky into the page below. */
export function CloudBank() {
  return (
    <div className="cloud-bank" aria-hidden="true">
      <svg viewBox="0 0 400 90" preserveAspectRatio="none">
        <path
          className="cloud-bank-back"
          d="M0 44 Q 22 14 52 34 Q 78 4 116 28 Q 148 8 178 32 Q 210 2 250 26 Q 284 8 314 32 Q 346 10 372 30 Q 390 22 400 26 L400 90 L0 90 Z"
        />
        <path
          className="cloud-bank-front"
          d="M0 62 Q 30 34 64 54 Q 96 26 134 50 Q 168 30 200 54 Q 236 26 272 50 Q 306 32 336 54 Q 370 34 400 50 L400 90 L0 90 Z"
        />
      </svg>
    </div>
  )
}
