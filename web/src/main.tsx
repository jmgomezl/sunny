import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import './index.css'
import App from './App.tsx'
import { StickerStage } from './components/StickerStage.tsx'

// Inside Telegram: tell the client we're ready and open at full height.
const telegram = window.Telegram?.WebApp
telegram?.ready()
telegram?.expand()
// Hex colors need Telegram 6.9+; on older clients the call throws, so it's skipped there.
if (telegram?.isVersionAtLeast?.('6.9')) {
  try {
    telegram.setHeaderColor?.('#86cdfb')
    telegram.setBackgroundColor?.('#fff8ec')
  } catch {
    // The app looks the same; only Telegram's own bar keeps its color.
  }
}

// ?sticker=<pose> renders a single sticker for the pack (see StickerStage).
const params = new URLSearchParams(window.location.search)
const sticker = params.get('sticker')
if (sticker) document.documentElement.classList.add('sticker-mode')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* People who ask their phone for less motion get Sunny's springs and bounces toned down. */}
    <MotionConfig reducedMotion="user">
      {sticker ? (
        <StickerStage pose={sticker} caption={params.get('caption')} wear={params.get('wear')} bare={params.has('bare')} cool={params.has('cool')} />
      ) : (
        <App />
      )}
    </MotionConfig>
  </StrictMode>,
)
