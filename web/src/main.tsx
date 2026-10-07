import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { StickerStage } from './components/StickerStage.tsx'

// Inside Telegram: tell the client we're ready and open at full height.
const telegram = window.Telegram?.WebApp
telegram?.ready()
telegram?.expand()
telegram?.setHeaderColor?.('#86cdfb')
telegram?.setBackgroundColor?.('#fff8ec')

// ?sticker=<pose> renders a single sticker for the pack (see StickerStage).
const sticker = new URLSearchParams(window.location.search).get('sticker')
if (sticker) document.documentElement.classList.add('sticker-mode')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{sticker ? <StickerStage pose={sticker} /> : <App />}</StrictMode>,
)
