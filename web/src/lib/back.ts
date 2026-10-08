import { inTelegram } from './api'

declare global {
  interface Window {
    /** Called by the Android app on Back: closes the top sheet, or says there was none. */
    sunnyBack?: () => boolean
  }
}

// Open sheets, newest last, so Back closes the one on top.
const open: (() => void)[] = []
window.sunnyBack = () => {
  const top = open.pop()
  top?.()
  return Boolean(top)
}

// The Android app asks the page directly (window.sunnyBack). Browser history can't do it there:
// Chrome skips history entries a page adds without a tap, like a sheet that opens by itself.
const inAndroidApp = () => navigator.userAgent.includes('Solana Mobile Web Shell')

/**
 * Closes a sheet on "back": Telegram's back button inside Telegram, the Android app's Back through
 * window.sunnyBack, and in a phone browser the system Back through a history entry. Without it,
 * Back on Android left Sunny altogether. Returns the cleanup.
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
  open.push(onClose)
  const unlist = () => {
    const i = open.lastIndexOf(onClose)
    if (i >= 0) open.splice(i, 1)
  }
  if (inAndroidApp()) return unlist
  const mark = Math.random()
  history.pushState({ sunnySheet: mark }, '')
  let popped = false
  const onPop = () => {
    popped = true
    onClose()
  }
  window.addEventListener('popstate', onPop)
  return () => {
    unlist()
    window.removeEventListener('popstate', onPop)
    // Closed another way (×, Escape): take its entry back off the history.
    if (!popped && (history.state as { sunnySheet?: number } | null)?.sunnySheet === mark) history.back()
  }
}
