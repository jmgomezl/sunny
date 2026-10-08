import { useState } from 'react'

// One token picture for the whole app: a warm first letter until the image arrives, and for
// good if it never does (many token images live on slow or blocked hosts).

const HUES = [268, 150, 30, 20, 110, 200, 330, 45]
const hueOf = (symbol: string) => HUES[[...symbol].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length]

/** A token's picture, or its first letter in a warm color while it loads or if it can't. */
export function TokenAvatar({ symbol, icon }: { symbol: string; icon?: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>(icon ? 'loading' : 'failed')
  return (
    <span className="token-avatar" style={{ ['--h' as string]: hueOf(symbol) }}>
      {state !== 'ok' && (symbol.replace(/^\$/, '')[0] ?? '?')}
      {icon && state !== 'failed' && (
        <img
          src={icon}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          data-loaded={state === 'ok' || undefined}
          onLoad={() => setState('ok')}
          onError={() => setState('failed')}
        />
      )}
    </span>
  )
}

