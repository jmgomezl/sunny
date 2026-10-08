import type { ReactNode } from 'react'
import { CoinIcon, ExternalIcon, ShieldIcon, SnowIcon, SolanaMark, SunMark } from './Icons'

// Sunny's pocket is a delegated allowance with on-chain guardrails: you fund it, Sunny's key can
// spend from it, and a Solana program checks every payment against these rules. This card draws
// them as a rail (in Solana's colors, because they live on-chain), one post per rule.

export type Guardrail = 'perTx' | 'daily' | 'onlySunny' | 'freeze' | 'funds'

/** Which guardrail a refusal from the program came from, read from its plain-words reason. */
export function guardrailFor(reason: string): Guardrail | null {
  if (/per-payment/i.test(reason)) return 'perTx'
  if (/today/i.test(reason)) return 'daily'
  if (/frozen/i.test(reason)) return 'freeze'
  if (/enough in the pocket/i.test(reason)) return 'funds'
  return null
}

const usd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`

type Props = {
  perTx: number
  daily: number
  /** What's left today; left out for a preview of guardrails not set yet. */
  leftToday?: number
  frozen?: boolean
  programUrl?: string
  /** Shown before the pocket exists: these are the guardrails you're about to set. */
  preview?: boolean
}

export function Guardrails({ perTx, daily, leftToday, frozen = false, programUrl, preview = false }: Props) {
  const spent = leftToday === undefined ? 0 : Math.max(0, daily - leftToday)
  const rows: { key: Guardrail; icon: ReactNode; title: string; detail: ReactNode }[] = [
    {
      key: 'perTx',
      icon: <CoinIcon size={16} />,
      title: `Up to ${usd(perTx)} a payment`,
      detail: 'Anything bigger is refused, however it’s asked',
    },
    {
      key: 'daily',
      icon: <SunMark size={16} />,
      title: `Up to ${usd(daily)} a day`,
      detail:
        leftToday === undefined ? (
          'Resets every day at midnight UTC'
        ) : (
          <span className="guardrail-meter" aria-label={`${usd(leftToday)} left today`}>
            <span className="guardrail-meter-bar">
              <span style={{ width: `${Math.min(100, (spent / daily) * 100)}%` }} />
            </span>
            {usd(leftToday)} left today
          </span>
        ),
    },
    {
      key: 'onlySunny',
      icon: <ShieldIcon size={16} />,
      title: 'Only into Sunny’s own account',
      detail: 'It can’t send your money anywhere else',
    },
    {
      key: 'freeze',
      icon: <SnowIcon size={16} />,
      title: frozen ? 'Frozen: nothing can be spent' : 'Freeze it with one tap',
      detail: frozen ? 'Warm it up to allow spending again' : 'Your password, your call, any time',
    },
  ]
  return (
    <section className="guardrails" data-frozen={frozen || undefined} aria-label="Sunny’s guardrails">
      <div className="guardrails-head">
        <strong>{preview ? 'The guardrails you’re setting' : 'Sunny’s guardrails'}</strong>
        <small>
          A delegated allowance: Sunny can spend it, but a Solana program checks every payment against these rules.
          Not the AI.
        </small>
      </div>
      <ol className="guardrails-rail">
        {rows.map((r) => (
          <li key={r.key} data-key={r.key}>
            <span className="guardrail-post" aria-hidden="true">
              {r.icon}
            </span>
            <span className="guardrail-text">
              <b>{r.title}</b>
              <small>{r.detail}</small>
            </span>
          </li>
        ))}
      </ol>
      {programUrl && (
        <a className="guardrails-proof" href={programUrl} target="_blank" rel="noreferrer">
          <SolanaMark size={13} /> Enforced on Solana by program 7RhP…4wvy <ExternalIcon size={12} />
        </a>
      )}
    </section>
  )
}

/** A small badge for a draw Solana refused: which guardrail held. */
export function GuardrailHeld({ reason, perTx }: { reason: string; perTx?: number }) {
  const g = guardrailFor(reason)
  const label = {
    perTx: perTx ? `per-payment limit (${usd(perTx)})` : 'per-payment limit',
    daily: 'daily limit',
    freeze: 'freeze',
    funds: 'only what’s in the pocket',
    onlySunny: 'only to Sunny',
  }
  if (!g) return null
  return (
    <span className="guardrail-held">
      <ShieldIcon size={13} strokeWidth={2.4} /> Guardrail held: {label[g]}
    </span>
  )
}
