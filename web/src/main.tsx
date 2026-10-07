import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Inside Telegram: tell the client we're ready and open at full height.
const telegram = window.Telegram?.WebApp
telegram?.ready()
telegram?.expand()
telegram?.setHeaderColor?.('#86cdfb')
telegram?.setBackgroundColor?.('#fff8ec')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
