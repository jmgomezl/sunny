import { useId, type SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.2 5 6v5.4c0 4.4 3 8 7 9.4 4-1.4 7-5 7-9.4V6z" />
    <path d="m9 12 2.2 2.2L15.4 10" />
  </Icon>
)

export const EyeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
)

export const CoinIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M14.6 9.3c-.5-.8-1.5-1.3-2.6-1.3-1.5 0-2.6.8-2.6 1.9 0 2.6 5.3 1.4 5.3 4.2 0 1.1-1.2 1.9-2.7 1.9-1.2 0-2.2-.5-2.7-1.3M12 6.5V8m0 8v1.5" />
  </Icon>
)

export const SnowIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6" />
    <path d="m9.5 4 2.5 2 2.5-2M9.5 20l2.5-2 2.5 2" />
  </Icon>
)

export const SwapIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" />
  </Icon>
)

export const StopIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m6 6 12 12" />
  </Icon>
)

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const BoltIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z" />
  </Icon>
)

export function SunMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-12 -12 24 24" aria-hidden="true">
      <g fill="#FFB43C">
        {Array.from({ length: 8 }, (_, i) => (
          <ellipse key={i} cx="0" cy="-9" rx="1.9" ry="2.8" transform={`rotate(${i * 45})`} />
        ))}
      </g>
      <circle r="6" fill="#FFD35E" />
      <circle cx="-2.1" cy="-0.6" r="0.9" fill="#3A2114" />
      <circle cx="2.1" cy="-0.6" r="0.9" fill="#3A2114" />
      <path d="M-1.8 1.8 Q0 3.2 1.8 1.8" stroke="#3A2114" strokeWidth="0.8" fill="none" strokeLinecap="round" />
    </svg>
  )
}

export const ExternalIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 16 16 8M9.5 8H16v6.5" />
  </Icon>
)

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.2 4.2L19 7" />
  </Icon>
)

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5 2.8 19.5h18.4z" />
    <path d="M12 10v4.2M12 17.2v.1" />
  </Icon>
)

export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" />
  </Icon>
)

/** Solana's three-bar mark in the purple-to-green gradient. */
export function SolanaMark({ size = 16 }: { size?: number }) {
  const id = `sol-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <svg width={size} height={size * 0.88} viewBox="0 0 25 22" aria-hidden="true" className="solana-mark">
      <defs>
        <linearGradient id={id} x1="2" y1="21" x2="23" y2="1" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#9945FF" />
          <stop offset="0.55" stopColor="#43B4CA" />
          <stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <g fill={`url(#${id})`}>
        <path d="M4.6 1h19.2a.6.6 0 0 1 .43 1.02L20.4 5.8a1.2 1.2 0 0 1-.85.35H.35A.35.35 0 0 1 .1 5.55L3.75 1.35A1.2 1.2 0 0 1 4.6 1Z" />
        <path d="M4.6 15.85h19.2a.6.6 0 0 1 .43 1.02l-3.83 3.78a1.2 1.2 0 0 1-.85.35H.35a.35.35 0 0 1-.25-.6l3.65-4.2a1.2 1.2 0 0 1 .85-.35Z" />
        <path d="M20.4 8.42a1.2 1.2 0 0 0-.85-.35H.35a.35.35 0 0 0-.25.6l3.65 3.78c.22.23.53.35.85.35h19.2a.6.6 0 0 0 .43-1.02Z" />
      </g>
    </svg>
  )
}

/** Sunglasses, for the dark-mode switch. */
export const ShadesIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 9.5h19" />
    <path d="M3.2 9.5c0 3.4 1.6 5.3 4.1 5.3 2.4 0 3.5-1.9 3.7-5.3M13 9.5c.2 3.4 1.3 5.3 3.7 5.3 2.5 0 4.1-1.9 4.1-5.3" fill="currentColor" />
    <path d="M11 10.6c.6-.5 1.4-.5 2 0" />
  </Icon>
)
