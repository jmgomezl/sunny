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
  /** Spent today; left out for a preview of guardrails not set yet. */
  spentToday?: number
  frozen?: boolean
  programUrl?: string
  /** Shown before the pocket exists: these are the guardrails you're about to set. */
  preview?: boolean
}

/** Hours until the daily limit resets (midnight UTC), the way the care card says it. */
function resetsIn() {
  const now = new Date()
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  const h = Math.ceil((midnight - now.getTime()) / 3_600_000)
  return h <= 1 ? 'Resets within the hour' : `Resets in ${h} h`
}

export function Guardrails({ perTx, daily, spentToday, frozen = false, programUrl, preview = false, compact = false }: Props & { compact?: boolean }) {
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
        spentToday === undefined ? (
          'Resets every day'
        ) : (
          // What was actually spent today, against the limit: never what's simply not in the pocket.
          <span className="guardrail-meter" aria-label={`${usd(spentToday)} of ${usd(daily)} used today`}>
            <span className="guardrail-meter-bar">
              <span style={{ width: `${daily > 0 ? Math.min(100, (spentToday / daily) * 100) : 0}%` }} />
            </span>
            {usd(spentToday)} of {usd(daily)} used today · {resetsIn().toLowerCase()}
          </span>
        ),
    },
    {
      key: 'onlySunny',
      icon: <ShieldIcon size={16} />,
      title: 'Only into Sunny’s spending wallet',
      detail: 'So no more than your daily limit can ever leave',
    },
    {
      key: 'freeze',
      icon: <SnowIcon size={16} />,
      title: frozen ? 'Frozen: nothing can be spent' : 'Freeze it with one tap',
      detail: frozen ? 'Warm it up to allow spending again' : 'Only you can freeze or warm it up',
    },
  ]
  return (
    <section
      className={`guardrails${compact ? ' guardrails--compact' : ''}`}
      data-frozen={frozen || undefined}
      aria-label="Sunny’s guardrails"
    >
      <div className="guardrails-head">
        <strong>{preview ? 'The guardrails you’re setting' : 'Sunny’s guardrails'}</strong>
        {!compact && (
          <small>
            Pocket money Sunny can spend, only inside these rules. Solana checks every payment, so not even Sunny can
            bend them.
          </small>
        )}
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
          <SolanaMark size={13} /> Delegated allowance · enforced on-chain by 7RhP…4wvy <ExternalIcon size={12} />
        </a>
      )}
    </section>
  )
}

/** A small badge for a draw Solana refused: which guardrail held. */
export function GuardrailHeld({ reason, perTx, daily }: { reason: string; perTx?: number; daily?: number }) {
  const g = guardrailFor(reason)
  const label = {
    perTx: perTx ? `${usd(perTx)} per payment` : 'Per-payment cap',
    daily: daily ? `${usd(daily)} a day` : 'Daily cap',
    freeze: 'Frozen',
    funds: 'Pocket empty',
    onlySunny: 'Only to Sunny',
  }
  if (!g) return null
  return (
    <span className="guardrail-held">
      <ShieldIcon size={13} strokeWidth={2.4} /> Guardrail held · {label[g]}
    </span>
  )
}

/** The plain facts of a refusal: what was asked against the rule that stopped it. */
export function refusalFacts(amount: number, reason: string, limits: { perTx?: number; daily?: number }) {
  const g = guardrailFor(reason)
  if (g === 'perTx' && limits.perTx) return `Asked ${usd(amount)} · limit ${usd(limits.perTx)} a payment`
  if (g === 'daily' && limits.daily) return `Asked ${usd(amount)} · daily limit ${usd(limits.daily)} reached`
  if (g === 'freeze') return `Asked ${usd(amount)} · the pocket is frozen`
  if (g === 'funds') return `Asked ${usd(amount)} · not that much in the pocket`
  return reason
}
