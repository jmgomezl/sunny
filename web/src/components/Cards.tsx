import { useState } from 'react'
import { SolanaMark, SunMark } from './Icons'
import { canShareStory, sendToChat, shareStory, type ShareSpec } from '../lib/share'
import type { AlertCard, DeepScan, LinkCheck, MyWallet, PocketEvent, TokenCard } from '../lib/chat'
import type { BlinkReport, WalletReport } from '../lib/home'

// Result cards shared by the chat and the scanner: tokens, links, alerts and wallets.

const RISK_LABEL = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' } as const

export function formatUsd(n: number) {
  if (n >= 1) return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
  return `$${n.toPrecision(3)}`
}

export function compact(n: number) {
  return n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })
}

/** Live token card: price, 24h move and the safety audit, straight from Jupiter. */
export function TokenCardView({ card }: { card: TokenCard }) {
  const [iconFailed, setIconFailed] = useState(false)
  const dir = (card.change24h ?? 0) > 0 ? 'up' : (card.change24h ?? 0) < 0 ? 'down' : 'flat'
  return (
    <div className={`token-card token-card--${card.risk}`}>
      <div className="token-card-top">
        {card.icon && !iconFailed ? (
          <img
            src={card.icon}
            alt=""
            width={30}
            height={30}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setIconFailed(true)}
          />
        ) : (
          <span className="token-card-letter">{card.symbol[0]}</span>
        )}
        <div className="token-card-id">
          <strong>
            {card.symbol}
            {card.verified && (
              <span className="token-card-verified" title="Verified on Jupiter">
                ✓
              </span>
            )}
          </strong>
          <small>{card.name}</small>
        </div>
        <div className="token-card-price">
          <strong>{card.price !== null ? formatUsd(card.price) : '—'}</strong>
          {card.change24h !== null && (
            <small className={`delta delta--${dir}`}>
              {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '•'} {Math.abs(card.change24h)}% 24h
            </small>
          )}
        </div>
      </div>
      <div className="token-card-meta">
        <span className={`risk-pill risk-pill--${card.risk}`}>{RISK_LABEL[card.risk]}</span>
        {card.liquidity !== null && <span>Liquidity ${compact(card.liquidity)}</span>}
        {card.holders !== null && <span>{compact(card.holders)} holders</span>}
      </div>
      {card.flags.length > 0 && (
        <ul className="token-card-flags">
          {card.flags.slice(0, 3).map((f) => (
            <li key={f.text} data-level={f.level}>
              {f.text}
            </li>
          ))}
        </ul>
      )}
      <a
        className="token-card-mint"
        href={`https://solscan.io/token/${card.mint}`}
        target="_blank"
        rel="noreferrer"
        title={card.mint}
      >
        <SolanaMark size={11} /> {card.mint.slice(0, 4)}…{card.mint.slice(-4)}
      </a>
    </div>
  )
}

const VERDICT = {
  known_scam: { label: 'Known scam', icon: '⛔' },
  suspicious: { label: 'Suspicious', icon: '⚠️' },
  official: { label: 'Official site', icon: '✅' },
  unknown: { label: 'Not on scam lists', icon: '🔍' },
} as const

/** Verdict on a link the user asked about (phishing lists + impersonation checks). */
/** Share buttons under a moment worth sharing: a Telegram Story card, or a note to a friend. */
export function ShareRow({ spec }: { spec: ShareSpec }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const story = async () => {
    setBusy(true)
    setError(null)
    try {
      await shareStory(spec)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'I couldn’t make the card. Try again?')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="share-row">
      <button type="button" onClick={() => void story()} disabled={busy}>
        {busy ? 'Making your card…' : canShareStory() ? '📸 Share to Story' : '📸 Share card'}
      </button>
      <button type="button" onClick={() => sendToChat(spec)}>
        💬 Send to a friend
      </button>
      {error && <small>{error}</small>}
    </div>
  )
}

export function LinkCardView({ link }: { link: LinkCheck }) {
  const v = VERDICT[link.verdict]
  const scam = link.verdict === 'known_scam'
  return (
    <div className={`link-card link-card--${link.verdict}`}>
      <div className="link-card-top">
        <span className="link-card-icon" aria-hidden="true">
          {v.icon}
        </span>
        <div>
          <strong>{v.label}</strong>
          <code>{link.domain}</code>
        </div>
      </div>
      <ul>
        {link.reasons.slice(0, 3).map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {(scam || link.verdict === 'suspicious') && (
        <ShareRow
          spec={{
            kicker: 'Scam caught',
            title: `Sunny caught a ${scam ? 'phishing' : 'suspicious'} link`,
            detail: `${link.domain}: ${link.reasons[0]}`,
            tone: 'warn',
            caption: `Sunny just warned me: ${link.domain} is ${scam ? 'a phishing site' : 'suspicious'} 🛡 My Solana guardian lives in Telegram:`,
          }}
        />
      )}
    </div>
  )
}

/** Confirmation of a price alert Sunny will watch and message about in Telegram. */
export function AlertCardView({ alert }: { alert: AlertCard }) {
  const what =
    alert.percent !== null
      ? `${alert.direction === 'drop' ? 'Drops' : 'Rises'} ${alert.percent}%`
      : `${alert.direction === 'drop' ? 'Falls to' : 'Reaches'} ${formatUsd(alert.triggerPrice)}`
  return (
    <div className="alert-card">
      <span className="alert-card-bell" aria-hidden="true">
        🔔
      </span>
      <div>
        <strong>
          Watching {alert.symbol} · {what}
        </strong>
        <small>
          Now {formatUsd(alert.basePrice)} → alert at {formatUsd(alert.triggerPrice)}. I’ll message you in Telegram.
        </small>
      </div>
    </div>
  )
}

function ago(iso: string | null) {
  if (!iso) return null
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 60) return `${days} day${days > 1 ? 's' : ''} ago`
  const months = Math.floor(days / 30)
  return months < 24 ? `${months} months ago` : `${Math.floor(months / 12)} years ago`
}

/** Report for a scanned or pasted wallet: value, holdings, activity and red flags. */
export function WalletCardView({ report }: { report: WalletReport }) {
  const a = report.activity
  return (
    <div className={`token-card wallet-card token-card--${report.risk}`}>
      <div className="token-card-top">
        <span className="wallet-card-icon" aria-hidden="true">
          <SolanaMark size={16} />
        </span>
        <div className="token-card-id">
          <strong>
            {report.address.slice(0, 4)}…{report.address.slice(-4)}
          </strong>
          <small>
            {report.tokenCount} token{report.tokenCount === 1 ? '' : 's'} · {report.sol.toFixed(3)} SOL
          </small>
        </div>
        <div className="token-card-price">
          <strong>{formatUsd(report.total)}</strong>
          {report.change24h !== null && (
            <small className={`delta delta--${report.change24h >= 0 ? 'up' : 'down'}`}>
              {report.change24h >= 0 ? '▲' : '▼'} {Math.abs(report.change24h).toFixed(1)}% 24h
            </small>
          )}
        </div>
      </div>
      <div className="token-card-meta">
        <span className={`risk-pill risk-pill--${report.risk}`}>{RISK_LABEL[report.risk]}</span>
        {a && (
          <span>
            {a.transactions.toLocaleString('en-US')}
            {a.more ? '+' : ''} transactions
          </span>
        )}
        {a?.lastActive && <span>Active {ago(a.lastActive)}</span>}
        {a?.firstSeen && <span>Since {ago(a.firstSeen)}</span>}
        {report.approvals !== null && (
          <span>
            {report.approvals} approval{report.approvals === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {report.top.length > 0 && (
        <div className="wallet-card-top">
          {report.top.map((t) => (
            <span key={t.mint} className={`wallet-chip wallet-chip--${t.risk}`}>
              {t.symbol} <b>{formatUsd(t.value)}</b>
            </span>
          ))}
        </div>
      )}
      {report.flags.length > 0 && (
        <ul className="token-card-flags">
          {report.flags.slice(0, 4).map((f) => (
            <li key={f.text} data-level={f.level}>
              {f.text}
            </li>
          ))}
        </ul>
      )}
      <a
        className="token-card-mint"
        href={`https://solscan.io/account/${report.address}`}
        target="_blank"
        rel="noreferrer"
      >
        <SolanaMark size={11} /> View on Solscan
      </a>
    </div>
  )
}

function since(iso: string | null) {
  if (!iso) return 'recently'
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`
  return `${Math.round(min / 1440)} days ago`
}

/** The user's own Sunny wallet: balances and what happened lately, read from Solana. */
export function MyWalletView({ wallet }: { wallet: MyWallet }) {
  const p = wallet.pocket
  return (
    <div className="token-card my-wallet">
      <div className="token-card-top">
        <span className="wallet-card-icon my-wallet-icon" aria-hidden="true">
          <SunMark size={18} />
        </span>
        <div className="token-card-id">
          <strong>Your Sunny wallet</strong>
          <small>
            {wallet.address.slice(0, 4)}…{wallet.address.slice(-4)} · {wallet.cluster}
          </small>
        </div>
        <div className="token-card-price">
          <strong>{formatUsd(wallet.usdc)}</strong>
          <small>test USDC</small>
        </div>
      </div>
      <div className="token-card-meta">
        {p ? (
          <span>
            {p.frozen ? 'Pocket frozen' : `${formatUsd(p.leftToday)} left today`} · {formatUsd(p.vault)} in my pocket
          </span>
        ) : (
          <span>No pocket yet</span>
        )}
      </div>
      {wallet.recent.length > 0 && (
        <ul className="my-wallet-recent">
          {wallet.recent.slice(0, 5).map((e) => (
            <li key={e.explorer} data-failed={!e.ok || undefined}>
              <span>{e.ok ? e.what : `${e.what} · failed`}</span>
              {e.amount !== null && <b>{formatUsd(e.amount)}</b>}
              <a href={e.explorer} target="_blank" rel="noreferrer">
                {since(e.at)}
              </a>
            </li>
          ))}
        </ul>
      )}
      <a
        className="token-card-mint"
        href={`https://solscan.io/account/${wallet.address}?cluster=${wallet.cluster}`}
        target="_blank"
        rel="noreferrer"
      >
        <SolanaMark size={11} /> View on Solscan
      </a>
    </div>
  )
}

const pct = (n: number | null) => (n === null ? '—' : `${n}%`)

/** A deep scan Sunny bought over x402: who holds the token, what can still change, every risk. */
export function DeepScanView({ scan }: { scan: DeepScan }) {
  const h = scan.holders
  const facts: [string, string, boolean][] = [
    ['Top 10 hold', pct(h.top10Pct), (h.top10Pct ?? 0) > 50],
    ['Holders', h.total === null ? '—' : compact(h.total), false],
    [
      'Insiders',
      h.insiderNetworks ? `${h.insiderNetworks} network${h.insiderNetworks > 1 ? 's' : ''}` : 'None found',
      h.insiderNetworks > 0,
    ],
    [
      'Liquidity',
      scan.liquidityUsd === null ? '—' : `$${compact(scan.liquidityUsd)}`,
      (scan.liquidityUsd ?? 0) < 10_000,
    ],
    ['Mint authority', scan.mintAuthority ? 'On' : 'Off', scan.mintAuthority],
    ['Freeze authority', scan.freezeAuthority ? 'On' : 'Off', scan.freezeAuthority],
    ['Creator holds', pct(scan.creatorHoldsPct), (scan.creatorHoldsPct ?? 0) > 5],
    ['LP locked', pct(scan.lpLockedPct), false],
  ]
  return (
    <div className={`token-card deep-scan token-card--${scan.risk}`}>
      <div className="token-card-top">
        {scan.icon ? (
          <img src={scan.icon} alt="" width={30} height={30} loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className="token-card-letter">{scan.symbol[0]}</span>
        )}
        <div className="token-card-id">
          <strong>Deep scan · {scan.symbol}</strong>
          <small>{scan.name}</small>
        </div>
        <span className={`risk-pill risk-pill--${scan.risk}`}>{RISK_LABEL[scan.risk]}</span>
      </div>
      <dl className="deep-scan-facts">
        {facts.map(([label, value, bad]) => (
          <div key={label} data-bad={bad || undefined}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {scan.risks.length > 0 && (
        <ul className="token-card-flags">
          {scan.risks.slice(0, 4).map((r) => (
            <li key={r.name} data-level={r.level === 'danger' ? 'high' : 'medium'}>
              {r.name}
            </li>
          ))}
        </ul>
      )}
      <ShareRow
        spec={{
          kicker: 'Deep scan',
          title: `Sunny deep-scanned ${scan.symbol}: ${RISK_LABEL[scan.risk].toLowerCase()}`,
          detail: `Top 10 holders own ${pct(h.top10Pct)}. Paid $${scan.price.toFixed(2)} from its own pocket money, over x402.`,
          tone: 'sol',
          caption: `My AI pet Sunny paid $${scan.price.toFixed(2)} from its pocket money to deep-scan ${scan.symbol} over x402 🔍`,
        }}
      />
      <p className="deep-scan-paid">
        <SolanaMark size={11} /> Paid ${scan.price.toFixed(2)} from my pocket over x402 ·{' '}
        <a href={scan.paymentTx} target="_blank" rel="noreferrer">
          Payment
        </a>{' '}
        ·{' '}
        <a href={scan.drawTx} target="_blank" rel="noreferrer">
          Pocket draw
        </a>
      </p>
    </div>
  )
}

const VERDICT_PILL = {
  danger: { label: 'Don’t sign', risk: 'high' },
  caution: { label: 'Be careful', risk: 'medium' },
  ok: { label: 'Looks fine', risk: 'low' },
} as const

const REGISTRY_LABEL = {
  trusted: 'Verified by Dialect',
  malicious: 'Flagged as malicious',
  unknown: 'Not in Dialect’s registry',
}

const amount = (c: BlinkReport['sends'][number]) =>
  `${c.amount.toLocaleString('en-US', { maximumFractionDigits: c.amount < 1 ? 4 : 2 })} ${c.symbol}${c.usd !== null ? ` · ${formatUsd(c.usd)}` : ''}`

/** "Should I sign this?": what a Blink would do to your wallet, before you sign anything. */
export function BlinkCardView({ report }: { report: BlinkReport }) {
  const [iconFailed, setIconFailed] = useState(false)
  const pill = VERDICT_PILL[report.verdict]
  const short = report.wallet ? `${report.wallet.slice(0, 4)}…${report.wallet.slice(-4)}` : ''
  return (
    <div className={`token-card blink-card token-card--${pill.risk}`}>
      <div className="token-card-top">
        {report.icon && !iconFailed ? (
          <img
            src={report.icon}
            alt=""
            width={30}
            height={30}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setIconFailed(true)}
          />
        ) : (
          <span className="token-card-letter">⚡</span>
        )}
        <div className="token-card-id">
          <strong>Should I sign this?</strong>
          <small>
            {report.title} · {report.host}
          </small>
        </div>
        <span className={`risk-pill risk-pill--${pill.risk}`}>{pill.label}</span>
      </div>
      <p className="blink-summary">{report.summary}</p>
      {(report.sends.length > 0 || report.receives.length > 0) && (
        <ul className="blink-flows">
          {report.sends.map((c) => (
            <li key={`s-${c.mint}`} data-dir="out">
              <span>You’d send</span>
              <b>−{amount(c)}</b>
            </li>
          ))}
          {report.receives.map((c) => (
            <li key={`r-${c.mint}`} data-dir="in">
              <span>You’d get</span>
              <b>+{amount(c)}</b>
            </li>
          ))}
        </ul>
      )}
      {report.warnings.length > 0 && (
        <ul className="token-card-flags">
          {report.warnings.map((w) => (
            <li key={w.text} data-level={w.level === 'danger' ? 'high' : 'medium'}>
              {w.text.charAt(0).toUpperCase() + w.text.slice(1)}
            </li>
          ))}
        </ul>
      )}
      <div className="token-card-meta">
        <span>{REGISTRY_LABEL[report.registry]}</span>
        <span>
          {report.outcome === 'simulated' || report.outcome === 'would_fail'
            ? `Simulated with your wallet ${short}`
            : report.outcome === 'not_simulated'
              ? 'Watch a wallet to simulate it'
              : 'No transaction to read'}
        </span>
      </div>
      {report.verdict === 'danger' && (
        <ShareRow
          spec={{
            kicker: 'Drainer caught',
            title: 'Sunny stopped me from signing a drainer',
            detail: report.summary.replace(/^Don’t sign\. /, ''),
            tone: 'warn',
            caption: `This "${report.title}" Blink was a wallet drainer. Sunny read the transaction before I signed 🛡`,
          }}
        />
      )}
    </div>
  )
}

/** A draw from Sunny's pocket: approved, or stopped by the on-chain rules. */
export function PocketEventView({ event }: { event: PocketEvent }) {
  return (
    <div className={`pocket-event pocket-event--${event.ok ? 'ok' : 'stopped'}`}>
      <span className="alert-card-bell" aria-hidden="true">
        {event.ok ? '🪙' : '⛔'}
      </span>
      <div>
        <strong>{event.ok ? `Took $${event.amount} of pocket money` : `Solana stopped a $${event.amount} draw`}</strong>
        <small>
          {event.ok ? `${event.reason} · ${event.message}` : event.message}
          {event.explorer && (
            <>
              {' · '}
              <a href={event.explorer} target="_blank" rel="noreferrer">
                View tx
              </a>
            </>
          )}
        </small>
        {!event.ok && (
          <ShareRow
            spec={{
              kicker: 'My AI can’t overspend',
              title: `Solana stopped Sunny from spending $${event.amount}`,
              detail: `${event.message}. The limits live on-chain, not in the AI.`,
              tone: 'sol',
              caption: `I asked my AI pet Sunny to spend $${event.amount}. Solana said no: ${event.message.toLowerCase()} ☀️`,
            }}
          />
        )}
      </div>
    </div>
  )
}
