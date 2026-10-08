import { inTelegram } from './api'

/**
 * Closes a sheet on "back": Telegram's back button inside Telegram, and outside it (the Android
 * app, a phone browser) the system Back, through a history entry the sheet adds while it's open.
 * Without it, Back on Android left Sunny altogether. Returns the cleanup.
 */
export function closeOnBack(onClose: () => void) {
  const back = window.Telegram?.WebApp?.BackButton
  if (inTelegram() && back) {
    back.show()
    back.onClick(onClose)
    return () => {
      back.offClick(onClose)
      back.hide()
    }
  }
  const mark = Math.random()
  history.pushState({ sunnySheet: mark }, '')
  let popped = false
  const onPop = () => {
    popped = true
    onClose()
  }
  window.addEventListener('popstate', onPop)
  return () => {
    window.removeEventListener('popstate', onPop)
    // Closed another way (×, Escape): take its entry back off the history.
    if (!popped && (history.state as { sunnySheet?: number } | null)?.sunnySheet === mark) history.back()
  }
}
